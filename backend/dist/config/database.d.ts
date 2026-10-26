import * as mysql from './database.mysql';
import * as mongo from './database.mongo';
/**
 * Database switch. MySQL remains the production default; set
 * DB_CLIENT=mongo to run the same API on MongoDB (for example on Vercel).
 */
export declare const useMongo: boolean;
export declare const getPool: typeof mysql.getPool;
export declare const query: typeof mysql.query;
export declare const execute: typeof mysql.execute;
export declare const getClient: typeof mongo.getClient;
export declare const getDb: typeof mongo.getDb;
export declare const getContext: typeof mongo.getContext;
export { DbContext } from './database.mongo';
export declare const now: typeof mongo.now;
export declare const stripId: typeof mongo.stripId;
export declare const stripIds: typeof mongo.stripIds;
export declare const idKey: typeof mongo.idKey;
export declare const isValidId: typeof mongo.isValidId;
export declare const isDuplicateKey: typeof mongo.isDuplicateKey;
export declare const parseDateValue: typeof mongo.parseDateValue;
export declare const startOfDay: typeof mongo.startOfDay;
export declare const endOfDay: typeof mongo.endOfDay;
export declare const startOfWeek: typeof mongo.startOfWeek;
export declare const daysAgo: typeof mongo.daysAgo;
export declare const ageMinutes: typeof mongo.ageMinutes;
export declare const dayKey: typeof mongo.dayKey;
export declare function withTransaction<T>(fn: (client: any) => Promise<T>): Promise<T>;
export declare function checkDatabase(): Promise<boolean>;
export declare function closePool(): Promise<void>;
//# sourceMappingURL=database.d.ts.map