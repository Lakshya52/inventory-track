import { Pool, PoolConnection, RowDataPacket, ResultSetHeader } from 'mysql2/promise';
/**
 * A single pool is shared by the whole Node process. In production each API
 * instance gets its own pool; the database remains the source of truth.
 */
export declare function getPool(): Promise<Pool>;
export declare function query<T extends RowDataPacket[]>(sql: string, params?: any[]): Promise<T>;
export declare function execute(sql: string, params?: any[]): Promise<ResultSetHeader>;
/**
 * Runs a unit of work in a single transaction. Callers must use the provided
 * connection for every statement that belongs to the transaction.
 */
export declare function withTransaction<T>(fn: (conn: PoolConnection) => Promise<T>): Promise<T>;
export declare function checkDatabase(): Promise<boolean>;
export declare function closePool(): Promise<void>;
//# sourceMappingURL=database.d.ts.map