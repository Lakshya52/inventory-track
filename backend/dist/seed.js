"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const database_1 = require("./config/database");
async function seed() {
    await (0, database_1.getPool)();
    const adminHash = await bcryptjs_1.default.hash('admin123', 10);
    const qcHash = await bcryptjs_1.default.hash('qc123', 10);
    const dispatchHash = await bcryptjs_1.default.hash('dispatch123', 10);
    await (0, database_1.execute)('DELETE FROM activity_logs');
    await (0, database_1.execute)('DELETE FROM dispatch_records');
    await (0, database_1.execute)('DELETE FROM qc_records');
    await (0, database_1.execute)('DELETE FROM batches');
    await (0, database_1.execute)('DELETE FROM products');
    await (0, database_1.execute)('DELETE FROM users');
    await (0, database_1.execute)('INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)', ['Admin', 'admin@factory.com', adminHash, 'ADMIN']);
    await (0, database_1.execute)('INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)', ['QC Tester', 'qc@factory.com', qcHash, 'QC_TESTER']);
    await (0, database_1.execute)('INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)', ['Dispatcher', 'dispatch@factory.com', dispatchHash, 'DISPATCHER']);
    console.log('Seed completed!');
    console.log('Admin:     admin@factory.com / admin123');
    console.log('QC:        qc@factory.com / qc123');
    console.log('Dispatch:  dispatch@factory.com / dispatch123');
    process.exit(0);
}
seed().catch(err => { console.error('Seed failed:', err); process.exit(1); });
//# sourceMappingURL=seed.js.map