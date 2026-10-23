"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const database_1 = require("./config/database");
async function seed() {
    await (0, database_1.getPool)();
    // Create all tables if they don't exist
    await (0, database_1.execute)(`CREATE TABLE IF NOT EXISTS admins (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(100) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`);
    await (0, database_1.execute)(`CREATE TABLE IF NOT EXISTS qc_users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(100) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`);
    await (0, database_1.execute)(`CREATE TABLE IF NOT EXISTS dispatch_users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(100) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`);
    await (0, database_1.execute)(`CREATE TABLE IF NOT EXISTS production_users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(100) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`);
    await (0, database_1.execute)(`CREATE TABLE IF NOT EXISTS vendors (
    id INT AUTO_INCREMENT PRIMARY KEY,
    vendor_code VARCHAR(50) NOT NULL UNIQUE,
    name VARCHAR(200) NOT NULL,
    contact_person VARCHAR(100),
    email VARCHAR(100),
    phone VARCHAR(50),
    address TEXT,
    gst_number VARCHAR(50),
    category VARCHAR(100),
    payment_terms VARCHAR(100),
    notes TEXT,
    is_active TINYINT(1) DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`);
    await (0, database_1.execute)(`CREATE TABLE IF NOT EXISTS products (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(200) NOT NULL,
    description TEXT,
    sku VARCHAR(100) UNIQUE NOT NULL,
    price DECIMAL(12,2) DEFAULT 0,
    quantity DECIMAL(12,3) DEFAULT 0,
    cas_number VARCHAR(50),
    molecular_formula VARCHAR(100),
    purity VARCHAR(50),
    grade VARCHAR(100),
    storage_conditions TEXT,
    physical_state VARCHAR(50),
    hazard_classification VARCHAR(200),
    hsn_code VARCHAR(20),
    manufacturer VARCHAR(200),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`);
    await (0, database_1.execute)(`CREATE TABLE IF NOT EXISTS batches (
    id INT AUTO_INCREMENT PRIMARY KEY,
    product_id INT NOT NULL,
    batch_number VARCHAR(100) NOT NULL,
    quantity DECIMAL(12,3) NOT NULL DEFAULT 1,
    uom VARCHAR(20) DEFAULT 'kg',
    unit_price DECIMAL(12,2) DEFAULT 0,
    manufacturing_date DATE,
    expiry_date DATE,
    storage_location VARCHAR(200),
    notes TEXT,
    status ENUM('CREATED','QC_PASSED','QC_FAILED','DISPATCHED') DEFAULT 'CREATED',
    barcode_value VARCHAR(255) UNIQUE NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
  )`);
    await (0, database_1.execute)(`CREATE TABLE IF NOT EXISTS qc_records (
    id INT AUTO_INCREMENT PRIMARY KEY,
    batch_id INT NOT NULL,
    tester_id INT NOT NULL,
    result ENUM('PASS','FAIL') NOT NULL,
    remarks TEXT,
    images JSON DEFAULT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (batch_id) REFERENCES batches(id) ON DELETE CASCADE
  )`);
    await (0, database_1.execute)(`CREATE TABLE IF NOT EXISTS dispatch_records (
    id INT AUTO_INCREMENT PRIMARY KEY,
    batch_id INT NOT NULL,
    dispatcher_id INT NOT NULL,
    remarks TEXT,
    images JSON DEFAULT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (batch_id) REFERENCES batches(id) ON DELETE CASCADE
  )`);
    // Add images column to existing tables if missing
    try {
        await (0, database_1.execute)('ALTER TABLE qc_records ADD COLUMN images JSON DEFAULT NULL AFTER remarks');
    }
    catch { }
    try {
        await (0, database_1.execute)('ALTER TABLE dispatch_records ADD COLUMN images JSON DEFAULT NULL AFTER remarks');
    }
    catch { }
    await (0, database_1.execute)(`CREATE TABLE IF NOT EXISTS activity_logs (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT,
    user_name VARCHAR(100),
    user_role VARCHAR(20),
    action VARCHAR(100) NOT NULL,
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`);
    // Add columns if they're missing (for existing activity_logs from old schema)
    try {
        await (0, database_1.execute)('ALTER TABLE activity_logs ADD COLUMN user_name VARCHAR(100) AFTER user_id');
    }
    catch { }
    try {
        await (0, database_1.execute)('ALTER TABLE activity_logs ADD COLUMN user_role VARCHAR(20) AFTER user_name');
    }
    catch { }
    // Account activation support for existing installations
    try {
        await (0, database_1.execute)('ALTER TABLE admins ADD COLUMN is_active TINYINT(1) NOT NULL DEFAULT 1');
    }
    catch { }
    try {
        await (0, database_1.execute)('ALTER TABLE qc_users ADD COLUMN is_active TINYINT(1) NOT NULL DEFAULT 1');
    }
    catch { }
    try {
        await (0, database_1.execute)('ALTER TABLE dispatch_users ADD COLUMN is_active TINYINT(1) NOT NULL DEFAULT 1');
    }
    catch { }
    try {
        await (0, database_1.execute)('ALTER TABLE production_users ADD COLUMN is_active TINYINT(1) NOT NULL DEFAULT 1');
    }
    catch { }
    // Migrate products table — add chemical industry columns if missing
    try {
        await (0, database_1.execute)('ALTER TABLE products ADD COLUMN quantity DECIMAL(12,3) DEFAULT 0 AFTER price');
    }
    catch { }
    try {
        await (0, database_1.execute)('ALTER TABLE products ADD COLUMN cas_number VARCHAR(50) AFTER quantity');
    }
    catch { }
    try {
        await (0, database_1.execute)('ALTER TABLE products ADD COLUMN molecular_formula VARCHAR(100) AFTER cas_number');
    }
    catch { }
    try {
        await (0, database_1.execute)('ALTER TABLE products ADD COLUMN purity VARCHAR(50) AFTER molecular_formula');
    }
    catch { }
    try {
        await (0, database_1.execute)('ALTER TABLE products ADD COLUMN grade VARCHAR(100) AFTER purity');
    }
    catch { }
    try {
        await (0, database_1.execute)('ALTER TABLE products ADD COLUMN storage_conditions TEXT AFTER grade');
    }
    catch { }
    try {
        await (0, database_1.execute)('ALTER TABLE products ADD COLUMN hazard_classification VARCHAR(200) AFTER storage_conditions');
    }
    catch { }
    try {
        await (0, database_1.execute)('ALTER TABLE products ADD COLUMN hsn_code VARCHAR(20) AFTER hazard_classification');
    }
    catch { }
    try {
        await (0, database_1.execute)('ALTER TABLE products ADD COLUMN manufacturer VARCHAR(200) AFTER hsn_code');
    }
    catch { }
    try {
        await (0, database_1.execute)('ALTER TABLE products ADD COLUMN physical_state VARCHAR(50) AFTER hazard_classification');
    }
    catch { }
    // Migrate batches table — add uom and storage_location if missing
    try {
        await (0, database_1.execute)("ALTER TABLE batches ADD COLUMN uom VARCHAR(20) DEFAULT 'kg' AFTER quantity");
    }
    catch { }
    try {
        await (0, database_1.execute)('ALTER TABLE batches ADD COLUMN storage_location VARCHAR(200) AFTER expiry_date');
    }
    catch { }
    try {
        await (0, database_1.execute)('ALTER TABLE batches MODIFY COLUMN quantity DECIMAL(12,3) NOT NULL DEFAULT 1');
    }
    catch { }
    // Drop FK constraints if old users table exists
    try {
        const fk1 = await (0, database_1.query)("SELECT CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'qc_records' AND COLUMN_NAME = 'tester_id' AND REFERENCED_TABLE_NAME = 'users'", [process.env.DB_NAME || 'factory_inventory']);
        if (fk1.length > 0) {
            await (0, database_1.execute)(`ALTER TABLE qc_records DROP FOREIGN KEY ${fk1[0].CONSTRAINT_NAME}`);
        }
    }
    catch { }
    try {
        const fk2 = await (0, database_1.query)("SELECT CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'dispatch_records' AND COLUMN_NAME = 'dispatcher_id' AND REFERENCED_TABLE_NAME = 'users'", [process.env.DB_NAME || 'factory_inventory']);
        if (fk2.length > 0) {
            await (0, database_1.execute)(`ALTER TABLE dispatch_records DROP FOREIGN KEY ${fk2[0].CONSTRAINT_NAME}`);
        }
    }
    catch { }
    await (0, database_1.execute)('DROP TABLE IF EXISTS users');
    const adminHash = await bcryptjs_1.default.hash('admin@123', 10);
    const qcHash = await bcryptjs_1.default.hash('qc@123', 10);
    const dispatchHash = await bcryptjs_1.default.hash('dispatch@123', 10);
    await (0, database_1.execute)('DELETE FROM activity_logs');
    await (0, database_1.execute)('DELETE FROM dispatch_records');
    await (0, database_1.execute)('DELETE FROM qc_records');
    await (0, database_1.execute)('DELETE FROM batches');
    await (0, database_1.execute)('DELETE FROM products');
    await (0, database_1.execute)('DELETE FROM admins');
    await (0, database_1.execute)('DELETE FROM qc_users');
    await (0, database_1.execute)('DELETE FROM dispatch_users');
    await (0, database_1.execute)('DELETE FROM vendors');
    await (0, database_1.execute)('INSERT INTO admins (name, email, password_hash) VALUES (?, ?, ?)', ['Admin', 'admin@gmail.com', adminHash]);
    await (0, database_1.execute)('INSERT INTO qc_users (name, email, password_hash) VALUES (?, ?, ?)', ['QC Tester', 'qc@gmail.com', qcHash]);
    await (0, database_1.execute)('INSERT INTO dispatch_users (name, email, password_hash) VALUES (?, ?, ?)', ['Dispatcher', 'dispatch@gmail.com', dispatchHash]);
    console.log('Seed completed!');
    console.log('Admin:    admin@gmail.com / admin@123');
    console.log('QC:       qc@gmail.com / qc@123');
    console.log('Dispatch: dispatch@gmail.com / dispatch@123');
    process.exit(0);
}
seed().catch(err => { console.error('Seed failed:', err); process.exit(1); });
//# sourceMappingURL=seed.js.map