-- ============================================================
-- Aceone Factory Inventory - fresh database schema
-- Compatible with MariaDB 10.4+ / MySQL 8.0+
--
-- Multi-tenant: every business table carries a tenant_id pointing at
-- `tenants`. Uniqueness that must hold per workspace
-- (SKU, barcode, order number, master names, ...) is declared as a
-- composite (tenant_id, ...) unique key. Globally unique keys that
-- remain span identities that are unique per installation
-- (user email, idempotency operation ids, refresh-token hashes).
-- ============================================================
CREATE DATABASE IF NOT EXISTS factory_inventory
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE factory_inventory;

-- ------------------------------------------------------------
-- Tenants (workspace root)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tenants (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(200) NOT NULL,
    email VARCHAR(254) NOT NULL,
    email_key VARCHAR(254) NOT NULL UNIQUE,
    phone VARCHAR(32) NOT NULL,
    logo_url VARCHAR(500) NULL,
    logo_data LONGTEXT NULL,
    logo_mime_type VARCHAR(100) NULL,
    slug VARCHAR(100) NOT NULL UNIQUE,
    printer_label_width_mm SMALLINT UNSIGNED NOT NULL DEFAULT 60,
    printer_label_height_mm SMALLINT UNSIGNED NOT NULL DEFAULT 64,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- Divisions (optional manufacturing units within a tenant)
-- division_id NULL = shared across divisions (legacy rows and
-- records created by tenant-wide users).
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS divisions (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    tenant_id BIGINT UNSIGNED NOT NULL,
    name VARCHAR(120) NOT NULL,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_divisions_tenant_name (tenant_id, name),
    KEY idx_divisions_tenant (tenant_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- Users / auth (email stays globally unique: single identity per install)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS admins (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    tenant_id BIGINT UNSIGNED NULL,
    division_id BIGINT UNSIGNED NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    KEY idx_admins_tenant (tenant_id),
    KEY idx_admins_division (division_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS qc_users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    tenant_id BIGINT UNSIGNED NULL,
    division_id BIGINT UNSIGNED NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    KEY idx_qc_tenant (tenant_id),
    KEY idx_qc_division (division_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS dispatch_users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    tenant_id BIGINT UNSIGNED NULL,
    division_id BIGINT UNSIGNED NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    KEY idx_dispatch_tenant (tenant_id),
    KEY idx_dispatch_division (division_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- Masters
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS products (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(200) NOT NULL,
    description TEXT,
    sku VARCHAR(100) NOT NULL,
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
    bag_quantity_id INT NULL,
    tenant_id BIGINT UNSIGNED NULL,
    division_id BIGINT UNSIGNED NULL,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    KEY idx_products_updated (updated_at),
    KEY idx_products_active (is_active),
    KEY idx_products_tenant (tenant_id),
    KEY idx_products_division (division_id),
    UNIQUE KEY uq_products_tenant_sku (tenant_id, sku)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS shelf_locations (
    id INT AUTO_INCREMENT PRIMARY KEY,
    location_code VARCHAR(50) NOT NULL,
    description VARCHAR(255),
    warehouse VARCHAR(100),
    rack VARCHAR(50),
    shelf VARCHAR(50),
    is_active TINYINT(1) DEFAULT 1,
    tenant_id BIGINT UNSIGNED NULL,
    division_id BIGINT UNSIGNED NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    KEY idx_locations_tenant (tenant_id),
    KEY idx_locations_division (division_id),
    KEY idx_locations_updated (updated_at),
    UNIQUE KEY uq_locations_tenant_code (tenant_id, location_code)
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
    tenant_id BIGINT UNSIGNED NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    KEY idx_clients_tenant (tenant_id),
    KEY idx_clients_updated (updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS vendors (
    id INT AUTO_INCREMENT PRIMARY KEY,
    vendor_code VARCHAR(30) NOT NULL,
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
    tenant_id BIGINT UNSIGNED NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    KEY idx_vendors_name (name),
    KEY idx_vendors_active (is_active),
    KEY idx_vendors_tenant (tenant_id),
    UNIQUE KEY uq_vendors_tenant_code (tenant_id, vendor_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS grades (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    tenant_id BIGINT UNSIGNED NULL,
    division_id BIGINT UNSIGNED NULL,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    KEY idx_grades_tenant (tenant_id),
    KEY idx_grades_division (division_id),
    UNIQUE KEY uq_grades_tenant_name (tenant_id, name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS bag_quantities (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(120) NOT NULL,
    quantity DECIMAL(14,4) NOT NULL,
    unit VARCHAR(40) NOT NULL,
    tenant_id BIGINT UNSIGNED NULL,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    KEY idx_bag_quantities_tenant (tenant_id),
    UNIQUE KEY uq_bag_quantities_tenant_name (tenant_id, name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS uoms (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    tenant_id BIGINT UNSIGNED NULL,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    KEY idx_uoms_tenant (tenant_id),
    UNIQUE KEY uq_uoms_tenant_name (tenant_id, name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- Batches / QR
-- ------------------------------------------------------------
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
    barcode_value VARCHAR(255) NOT NULL,
    client_operation_id VARCHAR(64) NULL,
    client_created_at DATETIME(3) NULL,
    device_uuid VARCHAR(100) NULL,
    qr_printed_at DATETIME(3) NULL,
    dispatched_quantity INT UNSIGNED NOT NULL DEFAULT 0,
    recalled_quantity INT UNSIGNED NOT NULL DEFAULT 0,
    tenant_id BIGINT UNSIGNED NULL,
    division_id BIGINT UNSIGNED NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    KEY idx_batches_status_updated (status, updated_at),
    KEY idx_batches_updated (updated_at),
    KEY idx_batches_product_created (product_id, created_at),
    KEY idx_batches_group (batch_group_id),
    KEY idx_batches_shelf_location (shelf_location_id),
    KEY idx_batches_tenant (tenant_id),
    KEY idx_batches_division (division_id),
    UNIQUE KEY uq_batches_tenant_barcode (tenant_id, barcode_value),
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS batch_groups (
    group_key CHAR(36) PRIMARY KEY,
    batch_number VARCHAR(100) NOT NULL,
    tenant_id BIGINT UNSIGNED NULL,
    division_id BIGINT UNSIGNED NULL,
    created_by INT NOT NULL,
    product_count INT NOT NULL,
    total_quantity INT NOT NULL,
    client_operation_id VARCHAR(64) NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'PENDING_QC',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    KEY idx_batch_groups_created (created_at),
    KEY idx_batch_groups_tenant (tenant_id),
    KEY idx_batch_groups_division (division_id),
    UNIQUE KEY uq_batch_groups_tenant_number (tenant_id, batch_number),
    UNIQUE KEY uq_batch_groups_client_operation (client_operation_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS qr_print_jobs (
    id INT AUTO_INCREMENT PRIMARY KEY,
    job_code VARCHAR(50) NOT NULL,
    product_id INT NOT NULL,
    quantity INT NOT NULL,
    created_by INT NOT NULL,
    created_by_role VARCHAR(20) NOT NULL DEFAULT 'QC',
    tenant_id BIGINT UNSIGNED NULL,
    division_id BIGINT UNSIGNED NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    KEY idx_qr_jobs_product_created (product_id, created_at),
    KEY idx_qr_jobs_created (created_at),
    KEY idx_qr_jobs_tenant (tenant_id),
    KEY idx_qr_jobs_division (division_id),
    UNIQUE KEY uq_qr_jobs_tenant_code (tenant_id, job_code),
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS qr_labels (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    print_job_id INT NOT NULL,
    batch_id INT NOT NULL,
    qr_value VARCHAR(1000) NOT NULL,
    serial_no INT NOT NULL,
    print_count INT NOT NULL DEFAULT 1,
    last_printed_at DATETIME(3) NULL,
    dispatch_order_id INT NULL,
    recall_status VARCHAR(20) NULL,
    recall_condition VARCHAR(30) NULL,
    recall_reason VARCHAR(1000) NULL,
    recalled_by VARCHAR(64) NULL,
    recalled_at DATETIME(3) NULL,
    tenant_id BIGINT UNSIGNED NULL,
    division_id BIGINT UNSIGNED NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_qr_label_tenant_value (tenant_id, qr_value(191)),
    UNIQUE KEY uq_qr_label_serial (print_job_id, serial_no),
    KEY idx_qr_labels_tenant (tenant_id),
    KEY idx_qr_labels_division (division_id),
    KEY idx_qr_labels_batch (batch_id),
    KEY idx_qr_labels_job (print_job_id),
    KEY idx_qr_labels_order (dispatch_order_id),
    FOREIGN KEY (print_job_id) REFERENCES qr_print_jobs(id) ON DELETE CASCADE,
    FOREIGN KEY (batch_id) REFERENCES batches(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS qc_records (
    id INT AUTO_INCREMENT PRIMARY KEY,
    batch_id INT NOT NULL,
    tester_id INT NOT NULL,
    result ENUM('PASS','FAIL') NOT NULL,
    method VARCHAR(30) NULL,
    remarks TEXT,
    images LONGTEXT,
    client_operation_id VARCHAR(64) NULL,
    group_operation_id VARCHAR(64) NULL,
    client_created_at DATETIME(3) NULL,
    device_uuid VARCHAR(100) NULL,
    tenant_id BIGINT UNSIGNED NULL,
    division_id BIGINT UNSIGNED NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_qc_client_operation (client_operation_id),
    KEY idx_qc_tester_created (tester_id, created_at),
    KEY idx_qc_batch_created (batch_id, created_at),
    KEY idx_qc_created (created_at),
    KEY idx_qc_tenant (tenant_id),
    KEY idx_qc_division (division_id),
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
    order_number VARCHAR(20) NULL,
    order_lines JSON NULL,
    client_id INT NULL,
    driver_name VARCHAR(150) NULL,
    driver_phone VARCHAR(32) NULL,
    vehicle_number VARCHAR(50) NULL,
    container_number VARCHAR(100) NULL,
    quantity INT UNSIGNED NULL,
    scheduled_dispatch_at DATETIME(3) NULL,
    approved_by_role VARCHAR(20) NULL,
    approved_by_id INT NULL,
    stock_reserved_at_order DATETIME(3) NULL,
    returned_to_stock_quantity INT UNSIGNED NULL,
    recalled_quantity INT UNSIGNED NOT NULL DEFAULT 0,
    reload_pending INT UNSIGNED NOT NULL DEFAULT 0,
    client_operation_id VARCHAR(64) NULL,
    client_created_at DATETIME(3) NULL,
    device_uuid VARCHAR(100) NULL,
    dispatched_at DATETIME(3) NULL,
    tenant_id BIGINT UNSIGNED NULL,
    division_id BIGINT UNSIGNED NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_dispatch_order_client_operation (client_operation_id),
    UNIQUE KEY uq_orders_tenant_number (tenant_id, order_number),
    KEY idx_orders_status_created (status, created_at),
    KEY idx_orders_raised_created (raised_by, created_at),
    KEY idx_orders_batch_status (batch_id, status),
    KEY idx_dispatch_orders_scheduled (scheduled_dispatch_at),
    KEY idx_orders_tenant (tenant_id),
    KEY idx_orders_division (division_id),
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
    tenant_id BIGINT UNSIGNED NULL,
    division_id BIGINT UNSIGNED NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_dispatch_client_operation (client_operation_id),
    KEY idx_dispatch_user_created (dispatcher_id, created_at),
    KEY idx_dispatch_batch_created (batch_id, created_at),
    KEY idx_dispatch_created (created_at),
    KEY idx_dispatch_order (dispatch_order_id),
    KEY idx_dispatch_tenant (tenant_id),
    KEY idx_dispatch_division (division_id),
    KEY idx_dispatch_group_operation (group_operation_id),
    FOREIGN KEY (batch_id) REFERENCES batches(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS fix_records (
    id INT AUTO_INCREMENT PRIMARY KEY,
    batch_id INT NOT NULL,
    fixed_by INT NOT NULL COMMENT 'Legacy reference for historical records',
    description TEXT,
    tenant_id BIGINT UNSIGNED NULL,
    division_id BIGINT UNSIGNED NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    KEY idx_fix_records_tenant (tenant_id),
    KEY idx_fix_records_division (division_id),
    FOREIGN KEY (batch_id) REFERENCES batches(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS packing_list_items (
    id INT AUTO_INCREMENT PRIMARY KEY,
    dispatch_order_id INT NOT NULL,
    batch_id INT NOT NULL,
    product_name VARCHAR(200),
    product_sku VARCHAR(100) NULL,
    batch_number VARCHAR(100),
    quantity DECIMAL(12,3),
    uom VARCHAR(20),
    location_code VARCHAR(50),
    location_description VARCHAR(255),
    tenant_id BIGINT UNSIGNED NULL,
    division_id BIGINT UNSIGNED NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    KEY idx_packing_list_items_tenant (tenant_id),
    KEY idx_packing_list_items_division (division_id),
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
    tenant_id BIGINT UNSIGNED NULL,
    division_id BIGINT UNSIGNED NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    KEY idx_activity_tenant_created (tenant_id, created_at),
    KEY idx_activity_division_created (division_id, created_at),
    KEY idx_activity_created (created_at),
    KEY idx_activity_user_created (user_role, user_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- Warehouses / storage (tenant-scoped from day one)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS warehouses (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    tenant_id BIGINT UNSIGNED NOT NULL,
    division_id BIGINT UNSIGNED NULL,
    name VARCHAR(120) NOT NULL,
    capacity BIGINT UNSIGNED NOT NULL,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_warehouse_tenant_name (tenant_id, name),
    INDEX idx_warehouse_tenant (tenant_id),
    INDEX idx_warehouse_division (division_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS storage_racks (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    tenant_id BIGINT UNSIGNED NOT NULL,
    division_id BIGINT UNSIGNED NULL,
    warehouse_id BIGINT UNSIGNED NOT NULL,
    rack_code VARCHAR(120) NOT NULL,
    rows_count SMALLINT UNSIGNED NOT NULL,
    columns_count SMALLINT UNSIGNED NOT NULL,
    cells JSON NOT NULL,
    stock_version BIGINT UNSIGNED NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_storage_rack_name (tenant_id, warehouse_id, rack_code),
    INDEX idx_storage_rack_warehouse (tenant_id, warehouse_id),
    INDEX idx_storage_rack_division (division_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS qr_reprint_requests (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    tenant_id VARCHAR(64) NOT NULL,
    qr_job_id VARCHAR(64) NOT NULL,
    job_code VARCHAR(100) NULL,
    label_ids LONGTEXT NOT NULL,
    requested_count INT UNSIGNED NOT NULL,
    requested_by VARCHAR(64) NOT NULL,
    requested_by_name VARCHAR(200) NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    requested_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    fulfilled_by VARCHAR(64) NULL,
    fulfilled_by_name VARCHAR(200) NULL,
    fulfilled_at TIMESTAMP NULL,
    reviewed_by VARCHAR(64) NULL,
    reviewed_by_name VARCHAR(200) NULL,
    reviewed_at TIMESTAMP NULL,
    review_note VARCHAR(500) NULL,
    INDEX idx_qr_reprint_tenant_status (tenant_id, status, requested_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Counters for the DO-<YYYY>-<n> order numbers (key embeds the tenant)
CREATE TABLE IF NOT EXISTS counters (
    counter_key VARCHAR(160) NOT NULL PRIMARY KEY,
    seq BIGINT UNSIGNED NOT NULL DEFAULT 0,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
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
    tenant_id BIGINT UNSIGNED NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    UNIQUE KEY uq_devices_uuid (device_uuid),
    KEY idx_devices_tenant (tenant_id),
    KEY idx_devices_user (user_role, user_id),
    KEY idx_devices_last_seen (last_seen_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS device_sync_state (
    device_uuid VARCHAR(100) NOT NULL PRIMARY KEY,
    last_pull_at DATETIME(3) NULL,
    last_push_at DATETIME(3) NULL,
    last_error TEXT NULL,
    tenant_id BIGINT UNSIGNED NULL,
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    KEY idx_device_sync_state_tenant (tenant_id)
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
    tenant_id BIGINT UNSIGNED NULL,
    UNIQUE KEY uq_sync_operation (operation_id),
    KEY idx_sync_operations_tenant (tenant_id),
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

-- Note: loading_sessions / loading_scan_events are MongoDB-only features and
-- are not created in MySQL.
