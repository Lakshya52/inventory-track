import mysql, { Pool, PoolConnection, RowDataPacket, ResultSetHeader } from 'mysql2/promise';

let pool: Pool;

/**
 * A single pool is shared by the whole Node process. In production each API
 * instance gets its own pool; the database remains the source of truth.
 */
export async function getPool(): Promise<Pool> {
  if (!pool) {
    const connectionLimit = Number(process.env.DB_POOL_SIZE) || 20;
    pool = mysql.createPool({
      host: process.env.DB_HOST || 'localhost',
      port: Number(process.env.DB_PORT) || 3306,
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || '',
      database: process.env.DB_NAME || 'factory_inventory',
      waitForConnections: true,
      connectionLimit,
      maxIdle: connectionLimit,
      idleTimeout: 60_000,
      queueLimit: Number(process.env.DB_QUEUE_LIMIT) || 0,
      enableKeepAlive: true,
      keepAliveInitialDelay: 0,
      connectTimeout: Number(process.env.DB_CONNECT_TIMEOUT_MS) || 10_000,
      timezone: 'Z',
      decimalNumbers: true,
    });
  }
  return pool;
}

export async function query<T extends RowDataPacket[]>(
  sql: string,
  params?: any[]
): Promise<T> {
  const p = await getPool();
  const [rows] = await p.query<T>(sql, params);
  return rows;
}

export async function execute(
  sql: string,
  params?: any[]
): Promise<ResultSetHeader> {
  const p = await getPool();
  const [result] = await p.execute<ResultSetHeader>(sql, params);
  return result;
}

/**
 * Runs a unit of work in a single transaction. Callers must use the provided
 * connection for every statement that belongs to the transaction.
 */
export async function withTransaction<T>(
  fn: (conn: PoolConnection) => Promise<T>
): Promise<T> {
  const p = await getPool();
  const conn = await p.getConnection();
  try {
    await conn.beginTransaction();
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (error) {
    try {
      await conn.rollback();
    } catch {
      // The original error is more useful than a rollback failure.
    }
    throw error;
  } finally {
    conn.release();
  }
}

export async function checkDatabase(): Promise<boolean> {
  try {
    const rows = await query<RowDataPacket[]>('SELECT 1 AS ok');
    return Number(rows[0]?.ok) === 1;
  } catch {
    return false;
  }
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = undefined as unknown as Pool;
  }
}
