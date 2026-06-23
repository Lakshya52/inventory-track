import mysql, { Pool, PoolConnection, RowDataPacket, ResultSetHeader } from 'mysql2/promise';

let pool: Pool;

export async function getPool(): Promise<Pool> {
  if (!pool) {
    pool = mysql.createPool({
      host: process.env.DB_HOST || 'localhost',
      port: Number(process.env.DB_PORT) || 3306,
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || '',
      database: process.env.DB_NAME || 'factory_inventory',
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
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
