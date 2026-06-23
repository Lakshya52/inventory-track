import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { execute, query, getPool } from './config/database';
import { RowDataPacket } from 'mysql2';

async function seed() {
  await getPool();

  // Create all tables if they don't exist
  await execute(`CREATE TABLE IF NOT EXISTS admins (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(100) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`);
  await execute(`CREATE TABLE IF NOT EXISTS qc_users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(100) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`);
  await execute(`CREATE TABLE IF NOT EXISTS dispatch_users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(100) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`);
  await execute(`CREATE TABLE IF NOT EXISTS products (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(200) NOT NULL,
    description TEXT,
    sku VARCHAR(100) UNIQUE NOT NULL,
    price DECIMAL(12,2) DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`);
  await execute(`CREATE TABLE IF NOT EXISTS batches (
    id INT AUTO_INCREMENT PRIMARY KEY,
    product_id INT NOT NULL,
    batch_number VARCHAR(100) NOT NULL,
    quantity INT NOT NULL DEFAULT 1,
    unit_price DECIMAL(12,2) DEFAULT 0,
    manufacturing_date DATE,
    expiry_date DATE,
    notes TEXT,
    status ENUM('CREATED','QC_PASSED','QC_FAILED','DISPATCHED') DEFAULT 'CREATED',
    barcode_value VARCHAR(255) UNIQUE NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
  )`);
  await execute(`CREATE TABLE IF NOT EXISTS qc_records (
    id INT AUTO_INCREMENT PRIMARY KEY,
    batch_id INT NOT NULL,
    tester_id INT NOT NULL,
    result ENUM('PASS','FAIL') NOT NULL,
    remarks TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (batch_id) REFERENCES batches(id) ON DELETE CASCADE
  )`);
  await execute(`CREATE TABLE IF NOT EXISTS dispatch_records (
    id INT AUTO_INCREMENT PRIMARY KEY,
    batch_id INT NOT NULL,
    dispatcher_id INT NOT NULL,
    remarks TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (batch_id) REFERENCES batches(id) ON DELETE CASCADE
  )`);
  await execute(`CREATE TABLE IF NOT EXISTS activity_logs (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT,
    user_name VARCHAR(100),
    user_role VARCHAR(20),
    action VARCHAR(100) NOT NULL,
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`);

  // Add columns if they're missing (for existing activity_logs from old schema)
  try { await execute('ALTER TABLE activity_logs ADD COLUMN user_name VARCHAR(100) AFTER user_id'); } catch {}
  try { await execute('ALTER TABLE activity_logs ADD COLUMN user_role VARCHAR(20) AFTER user_name'); } catch {}

  // Drop FK constraints if old users table exists
  try {
    const fk1 = await query<RowDataPacket[]>("SELECT CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'qc_records' AND COLUMN_NAME = 'tester_id' AND REFERENCED_TABLE_NAME = 'users'", [process.env.DB_NAME || 'factory_inventory']);
    if (fk1.length > 0) {
      await execute(`ALTER TABLE qc_records DROP FOREIGN KEY ${fk1[0].CONSTRAINT_NAME}`);
    }
  } catch {}
  try {
    const fk2 = await query<RowDataPacket[]>("SELECT CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'dispatch_records' AND COLUMN_NAME = 'dispatcher_id' AND REFERENCED_TABLE_NAME = 'users'", [process.env.DB_NAME || 'factory_inventory']);
    if (fk2.length > 0) {
      await execute(`ALTER TABLE dispatch_records DROP FOREIGN KEY ${fk2[0].CONSTRAINT_NAME}`);
    }
  } catch {}

  await execute('DROP TABLE IF EXISTS users');

  const adminHash = await bcrypt.hash('admin@123', 10);
  const qcHash = await bcrypt.hash('qc@123', 10);
  const dispatchHash = await bcrypt.hash('dispatch@123', 10);

  await execute('DELETE FROM activity_logs');
  await execute('DELETE FROM dispatch_records');
  await execute('DELETE FROM qc_records');
  await execute('DELETE FROM batches');
  await execute('DELETE FROM products');
  await execute('DELETE FROM admins');
  await execute('DELETE FROM qc_users');
  await execute('DELETE FROM dispatch_users');

  await execute('INSERT INTO admins (name, email, password_hash) VALUES (?, ?, ?)', ['Admin', 'admin@gmail.com', adminHash]);
  await execute('INSERT INTO qc_users (name, email, password_hash) VALUES (?, ?, ?)', ['QC Tester', 'qc@gmail.com', qcHash]);
  await execute('INSERT INTO dispatch_users (name, email, password_hash) VALUES (?, ?, ?)', ['Dispatcher', 'dispatch@gmail.com', dispatchHash]);

  console.log('Seed completed!');
  console.log('Admin:    admin@gmail.com / admin@123');
  console.log('QC:       qc@gmail.com / qc@123');
  console.log('Dispatch: dispatch@gmail.com / dispatch@123');
  process.exit(0);
}

seed().catch(err => { console.error('Seed failed:', err); process.exit(1); });
