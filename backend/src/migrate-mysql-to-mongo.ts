import 'dotenv/config';
import mysql from 'mysql2/promise';
import { closePool, getDb } from './config/database.mongo';
import { ensureAdminSchema } from './config/schema.mongo';

/**
 * One-way copy of the existing MySQL database (the one phpMyAdmin manages)
 * into MongoDB. Numeric IDs and all relationships are preserved so the API
 * contract does not change.
 *
 * Usage:
 *   npm run migrate:mongo             # only runs when the target is empty
 *   npm run migrate:mongo -- --fresh  # replaces MongoDB data with MySQL data
 *   npm run migrate:mongo -- --dry-run
 */

type TableSpec = {
  name: string;
  /** Column used as the numeric id. Omit for tables keyed by a string. */
  idField?: string;
  /** String primary key for tables without a numeric id. */
  keyField?: string;
};

const TABLES: TableSpec[] = [
  { name: 'admins', idField: 'id' },
  { name: 'qc_users', idField: 'id' },
  { name: 'dispatch_users', idField: 'id' },
  { name: 'production_users', idField: 'id' },
  { name: 'shelf_locations', idField: 'id' },
  { name: 'clients', idField: 'id' },
  { name: 'vendors', idField: 'id' },
  { name: 'products', idField: 'id' },
  { name: 'batches', idField: 'id' },
  { name: 'qr_print_jobs', idField: 'id' },
  { name: 'qr_labels', idField: 'id' },
  { name: 'qc_records', idField: 'id' },
  { name: 'dispatch_orders', idField: 'id' },
  { name: 'dispatch_records', idField: 'id' },
  { name: 'fix_records', idField: 'id' },
  { name: 'packing_list_items', idField: 'id' },
  { name: 'activity_logs', idField: 'id' },
  { name: 'devices', idField: 'id' },
  { name: 'device_sync_state', keyField: 'device_uuid' },
  { name: 'sync_operations', idField: 'id' },
  { name: 'refresh_tokens', idField: 'id' },
];

const NUMERIC_FIELDS = new Set([
  'id',
  'product_id',
  'batch_id',
  'tester_id',
  'dispatcher_id',
  'raised_by',
  'admin_id',
  'client_id',
  'dispatch_order_id',
  'fixed_by',
  'user_id',
  'entity_id',
  'print_job_id',
  'serial_no',
  'print_count',
  'quantity',
  'unit_price',
  'price',
  'is_active',
]);

function transformRow(row: Record<string, any>): Record<string, any> {
  const output: Record<string, any> = {};
  for (const [key, value] of Object.entries(row)) {
    if (value === null || value === undefined) {
      output[key] = null;
    } else if (value instanceof Date) {
      output[key] = value;
    } else if (typeof value === 'bigint') {
      output[key] = Number(value);
    } else if (typeof value === 'string' && NUMERIC_FIELDS.has(key)) {
      const numeric = Number(value);
      output[key] = Number.isFinite(numeric) ? numeric : value;
    } else if (key === 'images' && typeof value !== 'string') {
      try {
        output[key] = JSON.stringify(value);
      } catch {
        output[key] = null;
      }
    } else {
      output[key] = value;
    }
  }
  return output;
}

function prepareDocument(spec: TableSpec, row: Record<string, any>): Record<string, any> {
  const document = transformRow(row);
  if (spec.idField) {
    const id = Number(document[spec.idField]);
    return { ...document, id, _id: id };
  }
  if (spec.keyField) {
    return { ...document, _id: document[spec.keyField] };
  }
  return document;
}

function mysqlConfig() {
  return {
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'factory_inventory',
    dateStrings: false as const,
  };
}

async function main(): Promise<void> {
  const fresh = process.argv.includes('--fresh');
  const dryRun = process.argv.includes('--dry-run');

  const connection = await mysql.createConnection(mysqlConfig());
  const db = await getDb();

  try {
    const [tableRows] = await connection.query<mysql.RowDataPacket[]>('SHOW TABLES');
    const sourceTables = new Set(tableRows.map((row) => String(Object.values(row)[0])));
    const missing = TABLES.filter((spec) => !sourceTables.has(spec.name)).map((spec) => spec.name);

    console.log(`Source MySQL: ${mysqlConfig().database} (${sourceTables.size} tables)`);
    console.log(`Target MongoDB: ${db.databaseName}`);
    if (missing.length > 0) console.log(`Skipping missing source tables: ${missing.join(', ')}`);

    await ensureAdminSchema();

    if (!fresh) {
      const nonEmpty: string[] = [];
      for (const spec of TABLES) {
        const count = await db.collection(spec.name).countDocuments();
        if (count > 0) nonEmpty.push(`${spec.name} (${count})`);
      }
      if (nonEmpty.length > 0) {
        console.error('MongoDB already contains data:');
        for (const entry of nonEmpty) console.error(`  - ${entry}`);
        console.error('Re-run with --fresh to replace it with the MySQL data.');
        process.exitCode = 1;
        return;
      }
    }

    if (fresh && !dryRun) {
      for (const spec of TABLES) {
        await db.collection(spec.name).deleteMany({});
      }
      console.log('Cleared existing MongoDB collections.');
    }

    let totalRows = 0;
    for (const spec of TABLES) {
      if (!sourceTables.has(spec.name)) continue;
      const [rows] = await connection.query<mysql.RowDataPacket[]>(`SELECT * FROM \`${spec.name}\``);
      const documents = rows.map((row) => prepareDocument(spec, row as Record<string, any>));
      totalRows += documents.length;

      if (!dryRun && documents.length > 0) {
        const chunkSize = 500;
        for (let index = 0; index < documents.length; index += chunkSize) {
          await db.collection(spec.name).insertMany(documents.slice(index, index + chunkSize), { ordered: true });
        }
      }

      console.log(`${dryRun ? 'Would copy' : 'Copied'} ${documents.length.toString().padStart(5)}  ${spec.name}`);
    }

    if (!dryRun) {
      console.log('\nVerification:');
      for (const spec of TABLES) {
        if (!sourceTables.has(spec.name)) continue;
        const [countRows] = await connection.query<mysql.RowDataPacket[]>(`SELECT COUNT(*) AS count FROM \`${spec.name}\``);
        const sourceCount = Number(countRows[0]?.count || 0);
        const targetCount = await db.collection(spec.name).countDocuments();
        const marker = sourceCount === targetCount ? 'OK ' : 'MISMATCH';
        console.log(`${marker} ${spec.name}: MySQL ${sourceCount}, MongoDB ${targetCount}`);
      }
    }

    console.log(`\n${dryRun ? 'Dry run complete' : 'Migration complete'}: ${totalRows} rows.`);
  } finally {
    await connection.end();
    await closePool();
  }
}

main().catch((error) => {
  console.error('Migration failed:', error);
  process.exit(1);
});
