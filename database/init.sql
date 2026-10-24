-- ============================================================
-- Aceone Factory Inventory - fresh database schema
-- Compatible with MariaDB 10.4+ / MySQL 8.0+
-- ============================================================
CREATE DATABASE IF NOT EXISTS factory_inventory
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE factory_inventory;

CREATE TABLE IF NOT EXISTS admins (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS qc_users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS dispatch_users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS products (
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
    hazard_classification VARCHAR(200),
    physical_state VARCHAR(50),
    hsn_code VARCHAR(20),
    manufacturer VARCHAR(200),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    KEY idx_products_updated (updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS shelf_locations (
    id INT AUTO_INCREMENT PRIMARY KEY,
    location_code VARCHAR(50) UNIQUE NOT NULL,
    description VARCHAR(255),
    warehouse VARCHAR(100),
    rack VARCHAR(50),
    shelf VARCHAR(50),
    is_active TINYINT(1) DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    KEY idx_locations_updated (updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Client records are selected for dispatch requests.
CREATE TABLE IF NOT EXISTS clients (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(200) NOT NULL,
    contact_person VARCHAR(100),
    email VARCHAR(100),
    phone VARCHAR(50),
    address TEXT,
    gst_number VARCHAR(50),
    is_active TINYINT(1) DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    KEY idx_clients_updated (updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS vendors (
    id INT AUTO_INCREMENT PRIMARY KEY,
    vendor_code VARCHAR(30) UNIQUE NOT NULL,
    name VARCHAR(200) NOT NULL,
    contact_person VARCHAR(100),
    email VARCHAR(100),
    phone VARCHAR(50),
    address TEXT,
    gst_number VARCHAR(50),
    category VARCHAR(100),
    payment_terms VARCHAR(100),
    notes TEXT,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    KEY idx_vendors_name (name),
    KEY idx_vendors_active (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO vendors (vendor_code, name, category, is_active)
VALUES ('SELF', 'Self', 'Internal', 1)
ON DUPLICATE KEY UPDATE name = 'Self', category = 'Internal', is_active = 1;

CREATE TABLE IF NOT EXISTS grades (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL UNIQUE,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS bag_quantities (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(120) NOT NULL UNIQUE,
    quantity DECIMAL(14,4) NOT NULL,
    unit VARCHAR(40) NOT NULL,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS batches (
    id INT AUTO_INCREMENT PRIMARY KEY,
    product_id INT NOT NULL,
    batch_number VARCHAR(100) NOT NULL,
    batch_group_id CHAR(36) NULL,
    quantity DECIMAL(12,3) NOT NULL DEFAULT 1,
    uom VARCHAR(20) DEFAULT 'kg',
    unit_price DECIMAL(12,2) DEFAULT 0,
    manufacturing_date DATE,
    expiry_date DATE,
    vendor_id INT NULL,
    grade_id INT NULL,
    bag_quantity_id INT NULL,
    fg_details_completed_at DATETIME(3) NULL,
    shelf_location_id INT NULL,
    storage_location VARCHAR(200),
    notes TEXT,
    status ENUM(
        'CREATED',
        'QC_PASSED',
        'QC_FAILED',
        'DISPATCH_ORDER_RAISED',
        'DISPATCH_APPROVED',
        'DISPATCH_REJECTED',
        'DISPATCHED'
    ) DEFAULT 'CREATED',
    barcode_value VARCHAR(255) UNIQUE NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    KEY idx_batches_status_updated (status, updated_at),
    KEY idx_batches_updated (updated_at),
    KEY idx_batches_product_created (product_id, created_at),
    KEY idx_batches_group (batch_group_id),
    KEY idx_batches_shelf_location (shelf_location_id),
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS qr_print_jobs (
    id INT AUTO_INCREMENT PRIMARY KEY,
    job_code VARCHAR(50) UNIQUE NOT NULL,
    product_id INT NOT NULL,
    quantity INT NOT NULL,
    created_by INT NOT NULL,
    created_by_role VARCHAR(20) NOT NULL DEFAULT 'QC',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    KEY idx_qr_jobs_product_created (product_id, created_at),
    KEY idx_qr_jobs_created (created_at),
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS qr_labels (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    print_job_id INT NOT NULL,
    batch_id INT NOT NULL,
    qr_value VARCHAR(255) NOT NULL,
    serial_no INT NOT NULL,
    print_count INT NOT NULL DEFAULT 1,
    last_printed_at DATETIME(3) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_qr_label_value (qr_value),
    UNIQUE KEY uq_qr_label_serial (print_job_id, serial_no),
    KEY idx_qr_labels_job (print_job_id),
    FOREIGN KEY (print_job_id) REFERENCES qr_print_jobs(id) ON DELETE CASCADE,
    FOREIGN KEY (batch_id) REFERENCES batches(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS qc_records (
    id INT AUTO_INCREMENT PRIMARY KEY,
    batch_id INT NOT NULL,
    tester_id INT NOT NULL,
    result ENUM('PASS','FAIL') NOT NULL,
    remarks TEXT,
    images LONGTEXT,
    client_operation_id VARCHAR(64) NULL,
    group_operation_id VARCHAR(64) NULL,
    client_created_at DATETIME(3) NULL,
    device_uuid VARCHAR(100) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_qc_client_operation (client_operation_id),
    KEY idx_qc_tester_created (tester_id, created_at),
    KEY idx_qc_batch_created (batch_id, created_at),
    KEY idx_qc_created (created_at),
    KEY idx_qc_group_operation (group_operation_id),
    FOREIGN KEY (batch_id) REFERENCES batches(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS dispatch_orders (
    id INT AUTO_INCREMENT PRIMARY KEY,
    batch_id INT NOT NULL,
    raised_by INT NOT NULL COMMENT 'dispatch_users id',
    status ENUM('PENDING','APPROVED','REJECTED') DEFAULT 'PENDING',
    admin_id INT NULL COMMENT 'admins id who approved/rejected',
    admin_remarks TEXT,
    client_id INT NULL,
    driver_name VARCHAR(150) NULL,
    vehicle_number VARCHAR(50) NULL,
    container_number VARCHAR(100) NULL,
    approved_by_role VARCHAR(20) NULL,
    approved_by_id INT NULL,
    client_operation_id VARCHAR(64) NULL,
    client_created_at DATETIME(3) NULL,
    device_uuid VARCHAR(100) NULL,
    dispatched_at DATETIME(3) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_dispatch_order_client_operation (client_operation_id),
    KEY idx_orders_status_created (status, created_at),
    KEY idx_orders_raised_created (raised_by, created_at),
    KEY idx_orders_batch_status (batch_id, status),
    FOREIGN KEY (batch_id) REFERENCES batches(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS dispatch_records (
    id INT AUTO_INCREMENT PRIMARY KEY,
    batch_id INT NOT NULL,
    dispatcher_id INT NOT NULL,
    remarks TEXT,
    images LONGTEXT,
    dispatch_order_id INT NULL,
    client_operation_id VARCHAR(64) NULL,
    group_operation_id VARCHAR(64) NULL,
    client_created_at DATETIME(3) NULL,
    device_uuid VARCHAR(100) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_dispatch_client_operation (client_operation_id),
    KEY idx_dispatch_user_created (dispatcher_id, created_at),
    KEY idx_dispatch_batch_created (batch_id, created_at),
    KEY idx_dispatch_created (created_at),
    KEY idx_dispatch_order (dispatch_order_id),
    KEY idx_dispatch_group_operation (group_operation_id),
    FOREIGN KEY (batch_id) REFERENCES batches(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS fix_records (
    id INT AUTO_INCREMENT PRIMARY KEY,
    batch_id INT NOT NULL,
    fixed_by INT NOT NULL COMMENT 'Legacy reference for historical records',
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (batch_id) REFERENCES batches(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS activity_logs (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT,
    user_name VARCHAR(100),
    user_role VARCHAR(20),
    action VARCHAR(100) NOT NULL,
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    KEY idx_activity_created (created_at),
    KEY idx_activity_user_created (user_role, user_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- Offline / mobile sync infrastructure
-- ============================================================
CREATE TABLE IF NOT EXISTS devices (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    device_uuid VARCHAR(100) NOT NULL,
    user_id INT NOT NULL,
    user_role VARCHAR(20) NOT NULL,
    platform VARCHAR(20) NOT NULL DEFAULT 'unknown',
    app_version VARCHAR(30) NULL,
    push_token VARCHAR(255) NULL,
    last_seen_at DATETIME(3) NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    UNIQUE KEY uq_devices_uuid (device_uuid),
    KEY idx_devices_user (user_role, user_id),
    KEY idx_devices_last_seen (last_seen_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS device_sync_state (
    device_uuid VARCHAR(100) NOT NULL PRIMARY KEY,
    last_pull_at DATETIME(3) NULL,
    last_push_at DATETIME(3) NULL,
    last_error TEXT NULL,
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sync_operations (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    operation_id VARCHAR(64) NOT NULL,
    device_uuid VARCHAR(100) NULL,
    user_id INT NOT NULL,
    user_role VARCHAR(20) NOT NULL,
    operation_type VARCHAR(50) NOT NULL,
    entity_type VARCHAR(50) NULL,
    entity_id BIGINT NULL,
    status ENUM('APPLIED','DUPLICATE','CONFLICT','FAILED') NOT NULL,
    error_code VARCHAR(50) NULL,
    error_message TEXT NULL,
    payload LONGTEXT NULL,
    result LONGTEXT NULL,
    client_timestamp DATETIME(3) NULL,
    server_timestamp DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE KEY uq_sync_operation (operation_id),
    KEY idx_sync_user_time (user_role, user_id, server_timestamp),
    KEY idx_sync_device_time (device_uuid, server_timestamp),
    KEY idx_sync_status_time (status, server_timestamp)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS refresh_tokens (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    token_hash CHAR(64) NOT NULL,
    user_id INT NOT NULL,
    user_role VARCHAR(20) NOT NULL,
    user_table VARCHAR(30) NOT NULL,
    device_uuid VARCHAR(100) NULL,
    expires_at DATETIME(3) NOT NULL,
    revoked_at DATETIME(3) NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE KEY uq_refresh_token (token_hash),
    KEY idx_refresh_user (user_role, user_id),
    KEY idx_refresh_expiry (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
