"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getPool = getPool;
exports.query = query;
exports.execute = execute;
exports.withTransaction = withTransaction;
exports.checkDatabase = checkDatabase;
exports.closePool = closePool;
const promise_1 = __importDefault(require("mysql2/promise"));
let pool;
/**
 * A single pool is shared by the whole Node process. In production each API
 * instance gets its own pool; the database remains the source of truth.
 */
async function getPool() {
    if (!pool) {
        const connectionLimit = Number(process.env.DB_POOL_SIZE) || 20;
        pool = promise_1.default.createPool({
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
async function query(sql, params) {
    const p = await getPool();
    const [rows] = await p.query(sql, params);
    return rows;
}
async function execute(sql, params) {
    const p = await getPool();
    const [result] = await p.execute(sql, params);
    return result;
}
/**
 * Runs a unit of work in a single transaction. Callers must use the provided
 * connection for every statement that belongs to the transaction.
 */
async function withTransaction(fn) {
    const p = await getPool();
    const conn = await p.getConnection();
    try {
        await conn.beginTransaction();
        const result = await fn(conn);
        await conn.commit();
        return result;
    }
    catch (error) {
        try {
            await conn.rollback();
        }
        catch {
            // The original error is more useful than a rollback failure.
        }
        throw error;
    }
    finally {
        conn.release();
    }
}
async function checkDatabase() {
    try {
        const rows = await query('SELECT 1 AS ok');
        return Number(rows[0]?.ok) === 1;
    }
    catch {
        return false;
    }
}
async function closePool() {
    if (pool) {
        await pool.end();
        pool = undefined;
    }
}
//# sourceMappingURL=database.js.map