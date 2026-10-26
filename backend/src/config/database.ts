import * as mysql from './database.mysql';
import * as mongo from './database.mongo';

/**
 * Database switch. MySQL remains the production default; set
 * DB_CLIENT=mongo to run the same API on MongoDB (for example on Vercel).
 */
export const useMongo = (process.env.DB_CLIENT || 'mysql').toLowerCase() === 'mongo';

// --- MySQL (default / production) -----------------------------------------
export const getPool = mysql.getPool;
export const query = mysql.query;
export const execute = mysql.execute;

// --- MongoDB --------------------------------------------------------------
export const getClient = mongo.getClient;
export const getDb = mongo.getDb;
export const getContext = mongo.getContext;
export { DbContext } from './database.mongo';
export const now = mongo.now;
export const stripId = mongo.stripId;
export const stripIds = mongo.stripIds;
export const idKey = mongo.idKey;
export const isValidId = mongo.isValidId;
export const isDuplicateKey = mongo.isDuplicateKey;
export const parseDateValue = mongo.parseDateValue;
export const startOfDay = mongo.startOfDay;
export const endOfDay = mongo.endOfDay;
export const startOfWeek = mongo.startOfWeek;
export const daysAgo = mongo.daysAgo;
export const ageMinutes = mongo.ageMinutes;
export const dayKey = mongo.dayKey;

// --- Shared API -----------------------------------------------------------
export function withTransaction<T>(fn: (client: any) => Promise<T>): Promise<T> {
  return useMongo
    ? mongo.withTransaction(fn)
    : mysql.withTransaction(fn as any);
}

export function checkDatabase(): Promise<boolean> {
  return useMongo ? mongo.checkDatabase() : mysql.checkDatabase();
}

export function closePool(): Promise<void> {
  return useMongo ? mongo.closePool() : mysql.closePool();
}
