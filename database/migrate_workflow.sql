-- ============================================================
-- Workflow Migration: Adds tables & columns for multi-lane workflow
-- ============================================================

-- 1. Production users table (new role)
CREATE TABLE IF NOT EXISTS production_users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 2. Shelf locations (Admin Masters module)
CREATE TABLE IF NOT EXISTS shelf_locations (
    id INT AUTO_INCREMENT PRIMARY KEY,
    location_code VARCHAR(50) UNIQUE NOT NULL,
    description VARCHAR(255),
    warehouse VARCHAR(100),
    rack VARCHAR(50),
    shelf VARCHAR(50),
    is_active TINYINT(1) DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 3. Clients (Admin Masters module)
CREATE TABLE IF NOT EXISTS clients (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(200) NOT NULL,
    contact_person VARCHAR(100),
    email VARCHAR(100),
    phone VARCHAR(50),
    address TEXT,
    gst_number VARCHAR(50),
    is_active TINYINT(1) DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 4. Update batches status ENUM to include new states
ALTER TABLE batches
  MODIFY COLUMN status ENUM(
    'CREATED',
    'QC_PASSED',
    'QC_FAILED',
    'DISPATCH_ORDER_RAISED',
    'DISPATCH_APPROVED',
    'DISPATCH_REJECTED',
    'DISPATCHED'
  ) DEFAULT 'CREATED';

-- 5. Dispatch orders (separate from dispatch_records)
CREATE TABLE IF NOT EXISTS dispatch_orders (
    id INT AUTO_INCREMENT PRIMARY KEY,
    batch_id INT NOT NULL,
    raised_by INT NOT NULL COMMENT 'dispatch_users id',
    status ENUM('PENDING','APPROVED','REJECTED') DEFAULT 'PENDING',
    admin_id INT NULL COMMENT 'admins id who approved/rejected',
    admin_remarks TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (batch_id) REFERENCES batches(id) ON DELETE CASCADE
);

-- 6. Packing list items
CREATE TABLE IF NOT EXISTS packing_list_items (
    id INT AUTO_INCREMENT PRIMARY KEY,
    dispatch_order_id INT NOT NULL,
    batch_id INT NOT NULL,
    product_name VARCHAR(200),
    batch_number VARCHAR(100),
    quantity DECIMAL(12,3),
    uom VARCHAR(20),
    location_code VARCHAR(50),
    location_description VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (dispatch_order_id) REFERENCES dispatch_orders(id) ON DELETE CASCADE,
    FOREIGN KEY (batch_id) REFERENCES batches(id) ON DELETE CASCADE
);

-- 7. Fix problem records (production fixes QC_FAILED batches)
CREATE TABLE IF NOT EXISTS fix_records (
    id INT AUTO_INCREMENT PRIMARY KEY,
    batch_id INT NOT NULL,
    fixed_by INT NOT NULL COMMENT 'production_users id',
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (batch_id) REFERENCES batches(id) ON DELETE CASCADE
);
