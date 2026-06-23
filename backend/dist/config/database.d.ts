import { Pool, RowDataPacket, ResultSetHeader } from 'mysql2/promise';
export declare function getPool(): Promise<Pool>;
export declare function query<T extends RowDataPacket[]>(sql: string, params?: any[]): Promise<T>;
export declare function execute(sql: string, params?: any[]): Promise<ResultSetHeader>;
//# sourceMappingURL=database.d.ts.map