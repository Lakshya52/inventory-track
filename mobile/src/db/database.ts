import * as SQLite from 'expo-sqlite';
import type {
  Batch,
  DispatchOrder,
  DispatchRecord,
  OperationType,
  OutboxOperation,
  QcRecord,
  SyncPullResponse,
} from '../types';

let databasePromise: Promise<SQLite.SQLiteDatabase> | null = null;

export async function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!databasePromise) {
    databasePromise = SQLite.openDatabaseAsync('aceone_inventory.db');
  }
  return databasePromise;
}

export async function initDatabase(): Promise<void> {
  const db = await getDb();
  await db.execAsync(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      sku TEXT,
      cas_number TEXT,
      grade TEXT,
      purity TEXT,
      hazard_classification TEXT,
      storage_conditions TEXT,
      manufacturer TEXT,
      physical_state TEXT,
      hsn_code TEXT,
      updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS shelf_locations (
      id INTEGER PRIMARY KEY,
      location_code TEXT,
      description TEXT,
      warehouse TEXT,
      rack TEXT,
      shelf TEXT,
      is_active INTEGER DEFAULT 1,
      updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS clients (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      contact_person TEXT,
      email TEXT,
      phone TEXT,
      address TEXT,
      gst_number TEXT,
      is_active INTEGER DEFAULT 1,
      updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS batches (
      id INTEGER PRIMARY KEY,
      product_id INTEGER,
      batch_number TEXT,
      quantity REAL DEFAULT 0,
      uom TEXT,
      storage_location TEXT,
      shelf_location_id INTEGER,
      location_code TEXT,
      unit_qr_codes TEXT,
      status TEXT,
      barcode_value TEXT UNIQUE,
      created_at TEXT,
      updated_at TEXT,
      product_name TEXT,
      product_sku TEXT,
      cas_number TEXT,
      molecular_formula TEXT,
      product_grade TEXT,
      product_purity TEXT,
      hazard_classification TEXT,
      storage_conditions TEXT,
      age_minutes INTEGER DEFAULT 0,
      local_pending INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_mobile_batches_status ON batches(status);
    CREATE INDEX IF NOT EXISTS idx_mobile_batches_barcode ON batches(barcode_value);

    CREATE TABLE IF NOT EXISTS qr_labels (
      qr_value TEXT PRIMARY KEY,
      batch_id INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_mobile_qr_labels_batch ON qr_labels(batch_id);

    CREATE TABLE IF NOT EXISTS qc_records (
      id INTEGER PRIMARY KEY,
      batch_id INTEGER,
      tester_id INTEGER,
      result TEXT,
      remarks TEXT,
      images TEXT,
      created_at TEXT,
      client_operation_id TEXT UNIQUE,
      device_uuid TEXT,
      batch_number TEXT,
      product_name TEXT,
      product_sku TEXT,
      tester_name TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_mobile_qc_created ON qc_records(created_at DESC);

    CREATE TABLE IF NOT EXISTS dispatch_orders (
      id INTEGER PRIMARY KEY,
      batch_id INTEGER,
      raised_by INTEGER,
      status TEXT,
      admin_id INTEGER,
      admin_remarks TEXT,
      client_id INTEGER,
      driver_name TEXT,
      vehicle_number TEXT,
      client_name TEXT,
      created_at TEXT,
      updated_at TEXT,
      dispatched_at TEXT,
      batch_number TEXT,
      barcode_value TEXT,
      product_name TEXT,
      product_sku TEXT,
      quantity REAL,
      uom TEXT,
      local_pending INTEGER NOT NULL DEFAULT 0,
      client_operation_id TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_mobile_orders_status ON dispatch_orders(status);

    CREATE TABLE IF NOT EXISTS dispatch_records (
      id INTEGER PRIMARY KEY,
      batch_id INTEGER,
      dispatcher_id INTEGER,
      remarks TEXT,
      images TEXT,
      created_at TEXT,
      dispatch_order_id INTEGER,
      batch_number TEXT,
      product_name TEXT,
      product_sku TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_mobile_dispatch_created ON dispatch_records(created_at DESC);

    CREATE TABLE IF NOT EXISTS outbox (
      operation_id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      payload TEXT NOT NULL,
      client_timestamp TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'PENDING',
      attempts INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      created_at TEXT NOT NULL,
      next_attempt_at TEXT,
      entity_type TEXT,
      entity_id INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_mobile_outbox_status ON outbox(status, next_attempt_at);

    CREATE TABLE IF NOT EXISTS sync_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    PRAGMA user_version = 1;
  `);
  await addColumnIfMissing(db, 'batches', 'shelf_location_id', 'INTEGER');
  await addColumnIfMissing(db, 'batches', 'location_code', 'TEXT');
  await addColumnIfMissing(db, 'batches', 'unit_qr_codes', 'TEXT');
  await addColumnIfMissing(db, 'dispatch_orders', 'client_id', 'INTEGER');
  await addColumnIfMissing(db, 'dispatch_orders', 'driver_name', 'TEXT');
  await addColumnIfMissing(db, 'dispatch_orders', 'vehicle_number', 'TEXT');
  await addColumnIfMissing(db, 'dispatch_orders', 'client_name', 'TEXT');
}

async function addColumnIfMissing(
  db: SQLite.SQLiteDatabase,
  table: string,
  column: string,
  definition: string
): Promise<void> {
  const columns = await db.getAllAsync<{ name: string }>(`PRAGMA table_info(${table})`);
  if (!columns.some((item) => item.name === column)) {
    await db.execAsync(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

function nowIso(): string {
  return new Date().toISOString();
}

function toIso(value: any): string {
  if (!value) return nowIso();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? nowIso() : date.toISOString();
}

function imagesToJson(value: any): string | null {
  if (!value) return null;
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

export async function getMeta(key: string): Promise<string | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ value: string }>('SELECT value FROM sync_meta WHERE key = ?', [key]);
  return row?.value ?? null;
}

export async function setMeta(key: string, value: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    'INSERT INTO sync_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    [key, value]
  );
}

export async function clearAllData(): Promise<void> {
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    await db.execAsync(`
      DELETE FROM outbox;
      DELETE FROM qc_records;
      DELETE FROM dispatch_records;
      DELETE FROM dispatch_orders;
      DELETE FROM qr_labels;
      DELETE FROM batches;
      DELETE FROM products;
      DELETE FROM shelf_locations;
      DELETE FROM clients;
      DELETE FROM sync_meta;
    `);
  });
}

async function upsertProduct(db: SQLite.SQLiteDatabase, product: any): Promise<void> {
  await db.runAsync(
    `INSERT INTO products (id, name, sku, cas_number, grade, purity, hazard_classification,
       storage_conditions, manufacturer, physical_state, hsn_code, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name, sku = excluded.sku, cas_number = excluded.cas_number,
       grade = excluded.grade, purity = excluded.purity,
       hazard_classification = excluded.hazard_classification,
       storage_conditions = excluded.storage_conditions, manufacturer = excluded.manufacturer,
       physical_state = excluded.physical_state, hsn_code = excluded.hsn_code,
       updated_at = excluded.updated_at`,
    [
      product.id, product.name, product.sku || null, product.cas_number || null,
      product.grade || null, product.purity || null, product.hazard_classification || null,
      product.storage_conditions || null, product.manufacturer || null,
      product.physical_state || null, product.hsn_code || null,
      toIso(product.updated_at || product.created_at),
    ]
  );
}

async function upsertLocation(db: SQLite.SQLiteDatabase, location: any): Promise<void> {
  await db.runAsync(
    `INSERT INTO shelf_locations (id, location_code, description, warehouse, rack, shelf, is_active, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       location_code = excluded.location_code, description = excluded.description,
       warehouse = excluded.warehouse, rack = excluded.rack, shelf = excluded.shelf,
       is_active = excluded.is_active, updated_at = excluded.updated_at`,
    [
      location.id, location.location_code || null, location.description || null,
      location.warehouse || null, location.rack || null, location.shelf || null,
      Number(location.is_active ?? 1), toIso(location.updated_at || location.created_at),
    ]
  );
}

async function upsertClient(db: SQLite.SQLiteDatabase, client: any): Promise<void> {
  await db.runAsync(
    `INSERT INTO clients (id, name, contact_person, email, phone, address, gst_number, is_active, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name, contact_person = excluded.contact_person, email = excluded.email,
       phone = excluded.phone, address = excluded.address, gst_number = excluded.gst_number,
       is_active = excluded.is_active, updated_at = excluded.updated_at`,
    [
      client.id, client.name, client.contact_person || null, client.email || null,
      client.phone || null, client.address || null, client.gst_number || null,
      Number(client.is_active ?? 1), toIso(client.updated_at || client.created_at),
    ]
  );
}

async function upsertBatch(db: SQLite.SQLiteDatabase, batch: any): Promise<void> {
  const unitCodes = Array.isArray(batch.unit_qr_codes)
    ? batch.unit_qr_codes
    : typeof batch.unit_qr_codes === 'string'
      ? JSON.parse(batch.unit_qr_codes || '[]')
      : [];
  await db.runAsync(
    `INSERT INTO batches (id, product_id, batch_number, quantity, uom, storage_location, status,
       barcode_value, created_at, updated_at, product_name, product_sku, cas_number,
       molecular_formula, product_grade, product_purity, hazard_classification,
       storage_conditions, age_minutes, shelf_location_id, location_code, unit_qr_codes, local_pending)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
     ON CONFLICT(id) DO UPDATE SET
       product_id = excluded.product_id, batch_number = excluded.batch_number,
       quantity = excluded.quantity, uom = excluded.uom,
       storage_location = excluded.storage_location,
       status = CASE WHEN batches.local_pending = 1 THEN batches.status ELSE excluded.status END,
       barcode_value = excluded.barcode_value,
       created_at = excluded.created_at,
       updated_at = CASE WHEN batches.local_pending = 1 THEN batches.updated_at ELSE excluded.updated_at END,
       product_name = excluded.product_name, product_sku = excluded.product_sku,
       cas_number = excluded.cas_number, molecular_formula = excluded.molecular_formula,
       product_grade = excluded.product_grade, product_purity = excluded.product_purity,
       hazard_classification = excluded.hazard_classification,
       storage_conditions = excluded.storage_conditions,
       age_minutes = excluded.age_minutes, shelf_location_id = excluded.shelf_location_id,
       location_code = excluded.location_code, unit_qr_codes = excluded.unit_qr_codes`,
    [
      batch.id, batch.product_id, batch.batch_number, Number(batch.quantity || 0),
      batch.uom || null, batch.storage_location || null, batch.status,
      batch.barcode_value, toIso(batch.created_at), toIso(batch.updated_at),
      batch.product_name || '', batch.product_sku || '', batch.cas_number || null,
      batch.molecular_formula || null, batch.product_grade || null,
      batch.product_purity || null, batch.hazard_classification || null,
      batch.storage_conditions || null, Number(batch.age_minutes || 0),
      batch.shelf_location_id ?? null, batch.location_code || batch.storage_location || null,
      JSON.stringify(unitCodes),
    ]
  );
  await db.runAsync('DELETE FROM qr_labels WHERE batch_id = ?', [batch.id]);
  for (const code of unitCodes) {
    await db.runAsync(
      'INSERT INTO qr_labels (qr_value, batch_id) VALUES (?, ?) ON CONFLICT(qr_value) DO UPDATE SET batch_id = excluded.batch_id',
      [code, batch.id]
    );
  }
}

async function upsertQcRecord(db: SQLite.SQLiteDatabase, record: any): Promise<void> {
  await db.runAsync(
    `INSERT INTO qc_records (id, batch_id, tester_id, result, remarks, images, created_at,
       client_operation_id, device_uuid, batch_number, product_name, product_sku, tester_name)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       result = excluded.result, remarks = excluded.remarks, images = excluded.images,
       batch_number = excluded.batch_number, product_name = excluded.product_name,
       product_sku = excluded.product_sku, tester_name = excluded.tester_name`,
    [
      record.id, record.batch_id, record.tester_id, record.result, record.remarks || null,
      imagesToJson(record.images), toIso(record.created_at),
      record.client_operation_id || null, record.device_uuid || null,
      record.batch_number || '', record.product_name || '', record.product_sku || '',
      record.tester_name || null,
    ]
  );
}

async function upsertDispatchOrder(db: SQLite.SQLiteDatabase, order: any): Promise<void> {
  await db.runAsync(
    `INSERT INTO dispatch_orders (id, batch_id, raised_by, status, admin_id, admin_remarks,
       client_id, driver_name, vehicle_number, client_name,
       created_at, updated_at, dispatched_at, batch_number, barcode_value, product_name,
       product_sku, quantity, uom, local_pending, client_operation_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
     ON CONFLICT(id) DO UPDATE SET
       status = CASE WHEN dispatch_orders.local_pending = 1 THEN dispatch_orders.status ELSE excluded.status END,
       admin_id = excluded.admin_id, admin_remarks = excluded.admin_remarks,
       client_id = excluded.client_id, driver_name = excluded.driver_name,
       vehicle_number = excluded.vehicle_number, client_name = excluded.client_name,
       updated_at = CASE WHEN dispatch_orders.local_pending = 1 THEN dispatch_orders.updated_at ELSE excluded.updated_at END,
       dispatched_at = excluded.dispatched_at, batch_number = excluded.batch_number,
       barcode_value = excluded.barcode_value, product_name = excluded.product_name,
       product_sku = excluded.product_sku, quantity = excluded.quantity, uom = excluded.uom`,
    [
      order.id, order.batch_id, order.raised_by, order.status, order.admin_id ?? null,
      order.admin_remarks || null, order.client_id ?? null, order.driver_name || null,
      order.vehicle_number || null, order.client_name || null,
      toIso(order.created_at), toIso(order.updated_at),
      order.dispatched_at ? toIso(order.dispatched_at) : null,
      order.batch_number || '', order.barcode_value || '', order.product_name || '',
      order.product_sku || '', Number(order.quantity || 0), order.uom || null,
      order.client_operation_id || null,
    ]
  );
}

async function upsertDispatchRecord(db: SQLite.SQLiteDatabase, record: any): Promise<void> {
  await db.runAsync(
    `INSERT INTO dispatch_records (id, batch_id, dispatcher_id, remarks, images, created_at,
       dispatch_order_id, batch_number, product_name, product_sku)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       remarks = excluded.remarks, images = excluded.images,
       dispatch_order_id = excluded.dispatch_order_id, batch_number = excluded.batch_number,
       product_name = excluded.product_name, product_sku = excluded.product_sku`,
    [
      record.id, record.batch_id, record.dispatcher_id, record.remarks || null,
      imagesToJson(record.images), toIso(record.created_at),
      record.dispatch_order_id ?? null, record.batch_number || '',
      record.product_name || '', record.product_sku || '',
    ]
  );
}

export async function applyPull(data: SyncPullResponse): Promise<void> {
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    for (const product of data.products || []) await upsertProduct(db, product);
    for (const location of data.shelf_locations || []) await upsertLocation(db, location);
    for (const client of data.clients || []) await upsertClient(db, client);
    for (const batch of data.batches || []) await upsertBatch(db, batch);
    for (const batch of data.work_queue || []) await upsertBatch(db, batch);
    for (const record of data.qc_records || []) await upsertQcRecord(db, record);
    for (const order of data.dispatch_orders || []) await upsertDispatchOrder(db, order);
    for (const order of data.my_orders || []) await upsertDispatchOrder(db, order);
    for (const record of data.dispatch_records || []) await upsertDispatchRecord(db, record);
  });
}

export async function getActiveClients(): Promise<Array<{
  id: number;
  name: string;
  contact_person: string | null;
}>> {
  const db = await getDb();
  return db.getAllAsync(
    'SELECT id, name, contact_person FROM clients WHERE is_active = 1 ORDER BY name ASC'
  );
}

export async function getBatchByBarcode(barcode: string): Promise<Batch | null> {
  const db = await getDb();
  const batch = await db.getFirstAsync<Batch>(
    `SELECT b.* FROM batches b
     LEFT JOIN qr_labels l ON l.batch_id = b.id AND l.qr_value = ?
     WHERE b.barcode_value = ? OR l.qr_value = ?`,
    [barcode, barcode, barcode]
  );
  return batch ? { ...batch, barcode_value: barcode } : null;
}

export async function getBatchById(id: number): Promise<Batch | null> {
  const db = await getDb();
  return db.getFirstAsync<Batch>('SELECT * FROM batches WHERE id = ?', [id]);
}

export async function getBatchesByStatus(statuses: string[], limit = 100): Promise<Batch[]> {
  const db = await getDb();
  const placeholders = statuses.map(() => '?').join(',');
  return db.getAllAsync<Batch>(
    `SELECT * FROM batches WHERE status IN (${placeholders}) ORDER BY created_at ASC LIMIT ?`,
    [...statuses, limit]
  );
}

export async function searchBatches(query: string, statuses?: string[], limit = 100): Promise<Batch[]> {
  const db = await getDb();
  const params: any[] = [];
  const clauses: string[] = [];
  if (statuses && statuses.length > 0) {
    clauses.push(`status IN (${statuses.map(() => '?').join(',')})`);
    params.push(...statuses);
  }
  if (query.trim()) {
    clauses.push('(batch_number LIKE ? OR barcode_value LIKE ? OR product_name LIKE ? OR product_sku LIKE ?)');
    const like = `%${query.trim()}%`;
    params.push(like, like, like, like);
  }
  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  params.push(limit);
  return db.getAllAsync<Batch>(
    `SELECT * FROM batches ${where} ORDER BY created_at ASC LIMIT ?`,
    params
  );
}

export async function getQcRecords(limit = 50, offset = 0, testerId?: number): Promise<QcRecord[]> {
  const db = await getDb();
  if (testerId !== undefined) {
    return db.getAllAsync<QcRecord>(
      'SELECT * FROM qc_records WHERE tester_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?',
      [testerId, limit, offset]
    );
  }
  return db.getAllAsync<QcRecord>(
    'SELECT * FROM qc_records ORDER BY created_at DESC LIMIT ? OFFSET ?',
    [limit, offset]
  );
}

export async function getDispatchRecords(limit = 50, offset = 0): Promise<DispatchRecord[]> {
  const db = await getDb();
  return db.getAllAsync<DispatchRecord>(
    'SELECT * FROM dispatch_records ORDER BY created_at DESC LIMIT ? OFFSET ?',
    [limit, offset]
  );
}

export async function getDispatchOrders(statuses?: string[], limit = 100): Promise<DispatchOrder[]> {
  const db = await getDb();
  if (!statuses || statuses.length === 0) {
    return db.getAllAsync<DispatchOrder>('SELECT * FROM dispatch_orders ORDER BY created_at DESC LIMIT ?', [limit]);
  }
  const placeholders = statuses.map(() => '?').join(',');
  return db.getAllAsync<DispatchOrder>(
    `SELECT * FROM dispatch_orders WHERE status IN (${placeholders}) ORDER BY created_at DESC LIMIT ?`,
    [...statuses, limit]
  );
}

export interface QcLocalStats {
  total: number;
  today: number;
  week: number;
  passed: number;
  failed: number;
  pending: number;
}

function startOfToday(): string {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date.toISOString();
}

function startOfWeek(): string {
  const date = new Date();
  const day = date.getDay();
  const diff = (day + 6) % 7;
  date.setDate(date.getDate() - diff);
  date.setHours(0, 0, 0, 0);
  return date.toISOString();
}

export async function getQcLocalStats(userId: number): Promise<QcLocalStats> {
  const db = await getDb();
  const today = startOfToday();
  const week = startOfWeek();
  const records = await db.getFirstAsync<{
    total: number; today: number; week: number; passed: number; failed: number;
  }>(
    `SELECT
       COUNT(*) AS total,
       SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) AS today,
       SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) AS week,
       SUM(CASE WHEN result = 'PASS' THEN 1 ELSE 0 END) AS passed,
       SUM(CASE WHEN result = 'FAIL' THEN 1 ELSE 0 END) AS failed
     FROM qc_records WHERE tester_id = ?`,
    [today, week, userId]
  );
  const pending = await db.getFirstAsync<{ count: number }>(
    "SELECT COUNT(*) AS count FROM batches WHERE status = 'CREATED'"
  );
  return {
    total: Number(records?.total || 0),
    today: Number(records?.today || 0),
    week: Number(records?.week || 0),
    passed: Number(records?.passed || 0),
    failed: Number(records?.failed || 0),
    pending: Number(pending?.count || 0),
  };
}

export interface DispatchLocalStats {
  ready: number;
  pendingOrders: number;
  approvedOrders: number;
  dispatchedToday: number;
  totalDispatches: number;
}

export async function getDispatchLocalStats(userId: number): Promise<DispatchLocalStats> {
  const db = await getDb();
  const today = startOfToday();
  const [ready, pendingOrders, approvedOrders, dispatchedToday, total] = await Promise.all([
    db.getFirstAsync<{ count: number }>(
      "SELECT COUNT(*) AS count FROM batches WHERE status IN ('QC_PASSED', 'DISPATCH_REJECTED')"
    ),
    db.getFirstAsync<{ count: number }>(
      "SELECT COUNT(*) AS count FROM dispatch_orders WHERE status = 'PENDING' AND (raised_by = ? OR raised_by IS NULL)",
      [userId]
    ),
    db.getFirstAsync<{ count: number }>(
      `SELECT COUNT(*) AS count
       FROM dispatch_orders d
       JOIN batches b ON d.batch_id = b.id
       WHERE d.status = 'APPROVED'
         AND d.dispatched_at IS NULL
         AND b.status = 'DISPATCH_APPROVED'
         AND (d.raised_by = ? OR d.raised_by IS NULL)`,
      [userId]
    ),
    db.getFirstAsync<{ count: number }>(
      'SELECT COUNT(*) AS count FROM dispatch_records WHERE dispatcher_id = ? AND created_at >= ?',
      [userId, today]
    ),
    db.getFirstAsync<{ count: number }>(
      'SELECT COUNT(*) AS count FROM dispatch_records WHERE dispatcher_id = ?',
      [userId]
    ),
  ]);
  return {
    ready: Number(ready?.count || 0),
    pendingOrders: Number(pendingOrders?.count || 0),
    approvedOrders: Number(approvedOrders?.count || 0),
    dispatchedToday: Number(dispatchedToday?.count || 0),
    totalDispatches: Number(total?.count || 0),
  };
}

export async function enqueueOperation(input: {
  operation_id: string;
  type: OperationType;
  payload: Record<string, any>;
  client_timestamp?: string;
  entity_type?: string;
  entity_id?: number;
}): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT INTO outbox (operation_id, type, payload, client_timestamp, status, attempts,
       last_error, created_at, next_attempt_at, entity_type, entity_id)
     VALUES (?, ?, ?, ?, 'PENDING', 0, NULL, ?, NULL, ?, ?)`,
    [
      input.operation_id, input.type, JSON.stringify(input.payload),
      input.client_timestamp || nowIso(), nowIso(),
      input.entity_type || null, input.entity_id ?? null,
    ]
  );
}

/**
 * Queues a group operation and marks every affected batch locally in the same
 * SQLite transaction. The screen can then clear immediately while the row stays
 * pending until the server confirms it.
 */
export async function queueBulkOperation(input: {
  operation_id: string;
  type: OperationType;
  payload: Record<string, any>;
  batch_ids: number[];
  local_status: string;
  entity_type?: string;
}): Promise<void> {
  const db = await getDb();
  const timestamp = nowIso();
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `INSERT INTO outbox (operation_id, type, payload, client_timestamp, status, attempts,
         last_error, created_at, next_attempt_at, entity_type, entity_id)
       VALUES (?, ?, ?, ?, 'PENDING', 0, NULL, ?, NULL, ?, NULL)`,
      [
        input.operation_id,
        input.type,
        JSON.stringify(input.payload),
        timestamp,
        timestamp,
        input.entity_type || null,
      ]
    );
    for (const batchId of input.batch_ids) {
      await db.runAsync(
        'UPDATE batches SET status = ?, local_pending = 1, updated_at = ? WHERE id = ?',
        [input.local_status, timestamp, batchId]
      );
    }
  });
}

export async function getOutboxOperations(includeApplied = false, limit = 100): Promise<OutboxOperation[]> {
  const db = await getDb();
  const where = includeApplied ? '' : "WHERE status IN ('PENDING','FAILED','CONFLICT')";
  const rows = await db.getAllAsync<any>(
    `SELECT * FROM outbox ${where} ORDER BY created_at DESC LIMIT ?`,
    [limit]
  );
  return rows.map((row) => ({
    ...row,
    payload: (() => { try { return JSON.parse(row.payload); } catch { return {}; } })(),
    attempts: Number(row.attempts || 0),
  }));
}

export async function getPendingOutboxCount(): Promise<number> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ count: number }>(
    "SELECT COUNT(*) AS count FROM outbox WHERE status IN ('PENDING','FAILED')"
  );
  return Number(row?.count || 0);
}

export async function getConflictCount(): Promise<number> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ count: number }>(
    "SELECT COUNT(*) AS count FROM outbox WHERE status = 'CONFLICT'"
  );
  return Number(row?.count || 0);
}

export async function getDueOperations(limit = 50): Promise<OutboxOperation[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<any>(
    `SELECT * FROM outbox
     WHERE status IN ('PENDING','FAILED')
       AND attempts < 6
       AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
     ORDER BY created_at ASC LIMIT ?`,
    [nowIso(), limit]
  );
  return rows.map((row) => ({
    ...row,
    payload: (() => { try { return JSON.parse(row.payload); } catch { return {}; } })(),
    attempts: Number(row.attempts || 0),
  }));
}

export async function updateOutboxPayload(operationId: string, payload: Record<string, any>): Promise<void> {
  const db = await getDb();
  await db.runAsync('UPDATE outbox SET payload = ? WHERE operation_id = ?', [JSON.stringify(payload), operationId]);
}

export async function markOutboxApplied(
  operationId: string,
  entityType: string | null,
  entityId: number | null
): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `UPDATE outbox SET status = 'APPLIED', last_error = NULL, entity_type = ?,
       entity_id = ?, next_attempt_at = NULL WHERE operation_id = ?`,
    [entityType, entityId, operationId]
  );
}

export async function markOutboxIssue(
  operationId: string,
  status: 'FAILED' | 'CONFLICT',
  message: string,
  attempts: number,
  nextAttemptAt: string | null
): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `UPDATE outbox SET status = ?, last_error = ?, attempts = ?, next_attempt_at = ?
     WHERE operation_id = ?`,
    [status, message, attempts, nextAttemptAt, operationId]
  );
}

export async function retryOutbox(operationId: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `UPDATE outbox SET status = 'PENDING', attempts = 0, last_error = NULL,
       next_attempt_at = NULL WHERE operation_id = ?`,
    [operationId]
  );
}

export async function deleteOutbox(operationId: string): Promise<void> {
  const db = await getDb();
  await db.runAsync('DELETE FROM outbox WHERE operation_id = ?', [operationId]);
}

/**
 * Removes a failed/conflicting operation and rolls back the optimistic local
 * batch state that was applied when it was queued. The next pull reconciles
 * the device with the server (important when a response was lost after the
 * server had already committed the operation).
 */
export async function discardOutboxOperation(operationId: string): Promise<void> {
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    const operation = await db.getFirstAsync<{
      type: OperationType;
      payload: string;
      entity_id: number | null;
    }>('SELECT type, payload, entity_id FROM outbox WHERE operation_id = ?', [operationId]);
    if (!operation) return;

    let payload: Record<string, any> = {};
    try {
      payload = JSON.parse(operation.payload || '{}');
    } catch {
      payload = {};
    }

    const batchIds = Array.isArray(payload.batch_ids)
      ? [...new Set<number>(
          payload.batch_ids
            .map((value: unknown) => Number(value))
            .filter((value: number) => Number.isInteger(value) && value > 0)
        )]
      : [];
    const barcodes = Array.isArray(payload.barcodes)
      ? [...new Set<string>(
          payload.barcodes
            .filter((value: unknown) => typeof value === 'string' && value.trim())
            .map((value: string) => value.trim())
        )]
      : typeof payload.barcode_value === 'string' && payload.barcode_value.trim()
        ? [payload.barcode_value.trim()]
        : [];

    const revertGroup = async (status: string): Promise<void> => {
      const column = batchIds.length > 0 ? 'id' : barcodes.length > 0 ? 'barcode_value' : null;
      const values: (number | string)[] = batchIds.length > 0 ? batchIds : barcodes;
      if (!column || values.length === 0) return;
      const placeholders = values.map(() => '?').join(',');
      await db.runAsync(
        `UPDATE batches SET status = ?, local_pending = 0, updated_at = ?
         WHERE ${column} IN (${placeholders})`,
        [status, nowIso(), ...values]
      );
    };

    switch (operation.type) {
      case 'QC_SUBMIT_BULK':
      case 'QC_SUBMIT':
        await revertGroup('CREATED');
        break;

      case 'DISPATCH_CONFIRM_BULK':
      case 'DISPATCH_CONFIRM':
        await revertGroup('DISPATCH_APPROVED');
        break;

      case 'DISPATCH_ORDER_RAISE': {
        await db.runAsync(
          'DELETE FROM dispatch_orders WHERE client_operation_id = ? AND id < 0',
          [operationId]
        );
        const batchId = Number(payload.batch_id ?? operation.entity_id);
        if (Number.isInteger(batchId) && batchId > 0) {
          const previous = typeof payload.expected_status === 'string' && payload.expected_status
            ? payload.expected_status
            : 'QC_PASSED';
          await db.runAsync(
            'UPDATE batches SET status = ?, local_pending = 0, updated_at = ? WHERE id = ?',
            [previous, nowIso(), batchId]
          );
        }
        break;
      }

      default:
        break;
    }

    await db.runAsync('DELETE FROM outbox WHERE operation_id = ?', [operationId]);
  });
}

export async function setBatchLocalStatus(
  batchId: number,
  status: string,
  pending: number
): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    'UPDATE batches SET status = ?, local_pending = ?, updated_at = ? WHERE id = ?',
    [status, pending, nowIso(), batchId]
  );
}

export async function queueDispatchOrderRequests(orders: Array<{
  operation_id: string;
  local_id: number;
  batch: Batch;
  raised_by: number;
  client_id: number;
  client_name: string;
  driver_name: string;
  vehicle_number: string;
}>): Promise<void> {
  const db = await getDb();
  const timestamp = nowIso();
  await db.withTransactionAsync(async () => {
    for (const order of orders) {
      const payload = {
        batch_id: order.batch.id,
        barcode_value: order.batch.barcode_value,
        expected_status: order.batch.status,
        client_id: order.client_id,
        driver_name: order.driver_name,
        vehicle_number: order.vehicle_number,
      };
      await db.runAsync(
        `INSERT INTO outbox (operation_id, type, payload, client_timestamp, status, attempts,
           last_error, created_at, next_attempt_at, entity_type, entity_id)
         VALUES (?, 'DISPATCH_ORDER_RAISE', ?, ?, 'PENDING', 0, NULL, ?, NULL, 'dispatch_order', ?)`,
        [order.operation_id, JSON.stringify(payload), timestamp, timestamp, order.batch.id]
      );
      await db.runAsync(
        `INSERT INTO dispatch_orders (id, batch_id, raised_by, status, admin_id, admin_remarks,
           client_id, driver_name, vehicle_number, client_name, created_at, updated_at,
           dispatched_at, batch_number, barcode_value, product_name, product_sku, quantity,
           uom, local_pending, client_operation_id)
         VALUES (?, ?, ?, 'PENDING', NULL, NULL, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, 1, ?)`,
        [
          order.local_id, order.batch.id, order.raised_by, order.client_id,
          order.driver_name, order.vehicle_number, order.client_name, timestamp, timestamp,
          order.batch.batch_number, order.batch.barcode_value, order.batch.product_name,
          order.batch.product_sku, Number(order.batch.quantity || 0), order.batch.uom,
          order.operation_id,
        ]
      );
      await db.runAsync(
        "UPDATE batches SET status = 'DISPATCH_ORDER_RAISED', local_pending = 1, updated_at = ? WHERE id = ?",
        [timestamp, order.batch.id]
      );
    }
  });
}

export async function deleteLocalOrderByOperation(operationId: string): Promise<void> {
  const db = await getDb();
  await db.runAsync('DELETE FROM dispatch_orders WHERE client_operation_id = ? AND id < 0', [operationId]);
}

export async function clearLocalPendingForBatch(batchId: number): Promise<void> {
  const db = await getDb();
  await db.runAsync('UPDATE batches SET local_pending = 0 WHERE id = ?', [batchId]);
}
