"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getPool = getPool;
exports.query = query;
exports.execute = execute;
const promise_1 = __importDefault(require("mysql2/promise"));
let pool;
async function getPool() {
    if (!pool) {
        pool = promise_1.default.createPool({
            host: process.env.DB_HOST || 'localhost',
            port: Number(process.env.DB_PORT) || 3306,
            user: process.env.DB_USER || 'root',
            password: process.env.DB_PASSWORD || 'rootpassword',
            database: process.env.DB_NAME || 'factory_inventory',
            waitForConnections: true,
            connectionLimit: 10,
            queueLimit: 0,
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
//# sourceMappingURL=database.js.map