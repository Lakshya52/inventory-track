"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ensureAdminSchema = ensureAdminSchema;
const database_1 = require("./database");
const USER_TABLES = ['admins', 'qc_users', 'dispatch_users', 'production_users'];
async function columnExists(table, column) {
    const rows = await (0, database_1.query)(`SELECT COLUMN_NAME FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`, [table, column]);
    return rows.length > 0;
}
async function addColumnIfMissing(table, column, definition) {
    if (!(await columnExists(table, column))) {
        await (0, database_1.execute)(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${definition}`);
    }
}
async function indexExists(table, index) {
    const rows = await (0, database_1.query)(`SELECT INDEX_NAME FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ? LIMIT 1`, [table, index]);
    return rows.length > 0;
}
async function addIndexIfMissing(table, index, columns) {
    if (!(await indexExists(table, index))) {
        await (0, database_1.execute)(`ALTER TABLE \`${table}\` ADD INDEX \`${index}\` (${columns})`);
    }
}
async function addUniqueIndexIfMissing(table, index, columns) {
    if (!(await indexExists(table, index))) {
        await (0, database_1.execute)(`ALTER TABLE \`${table}\` ADD UNIQUE INDEX \`${index}\` (${columns})`);
    }
}
/**
 * Idempotent startup migration. It keeps existing installations upgradeable
 * without a destructive seed. Every statement must be safe to run repeatedly.
 */
async function ensureAdminSchema() {
    await (0, database_1.execute)(`CREATE TABLE IF NOT EXISTS vendors (
    id INT AUTO_INCREMENT PRIMARY KEY,
    vendor_code VARCHAR(50) UNIQUE NOT NULL,
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
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    for (const table of USER_TABLES) {
        await addColumnIfMissing(table, 'is_active', 'TINYINT(1) NOT NULL DEFAULT 1');
    }
    // Sync cursors and soft ordering columns.
    await addColumnIfMissing('products', 'updated_at', 'TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP');
    await addColumnIfMissing('batches', 'updated_at', 'TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP');
    await addColumnIfMissing('shelf_locations', 'updated_at', 'TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP');
    await addColumnIfMissing('clients', 'updated_at', 'TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP');
    await addColumnIfMissing('vendors', 'updated_at', 'TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP');
    // Offline idempotency / provenance columns. The server timestamp stays in
    // created_at; client_created_at preserves the time the field user acted.
    for (const table of ['qc_records', 'dispatch_records', 'dispatch_orders']) {
        await addColumnIfMissing(table, 'client_operation_id', 'VARCHAR(64) NULL');
        await addColumnIfMissing(table, 'client_created_at', 'DATETIME(3) NULL');
        await addColumnIfMissing(table, 'device_uuid', 'VARCHAR(100) NULL');
    }
    await addColumnIfMissing('qc_records', 'updated_at', 'TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP');
    await addColumnIfMissing('dispatch_records', 'updated_at', 'TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP');
    await addColumnIfMissing('fix_records', 'updated_at', 'TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP');
    await addColumnIfMissing('dispatch_orders', 'dispatched_at', 'DATETIME(3) NULL');
    await addColumnIfMissing('dispatch_records', 'dispatch_order_id', 'INT NULL');
    // A nullable unique column is valid in MariaDB/MySQL: multiple NULLs are
    // allowed while a non-null client operation can only be applied once.
    await addUniqueIndexIfMissing('qc_records', 'uq_qc_client_operation', 'client_operation_id');
    await addUniqueIndexIfMissing('dispatch_records', 'uq_dispatch_client_operation', 'client_operation_id');
    await addUniqueIndexIfMissing('dispatch_orders', 'uq_dispatch_order_client_operation', 'client_operation_id');
    await (0, database_1.execute)(`CREATE TABLE IF NOT EXISTS devices (
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
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    await (0, database_1.execute)(`CREATE TABLE IF NOT EXISTS device_sync_state (
    device_uuid VARCHAR(100) NOT NULL PRIMARY KEY,
    last_pull_at DATETIME(3) NULL,
    last_push_at DATETIME(3) NULL,
    last_error TEXT NULL,
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    await (0, database_1.execute)(`CREATE TABLE IF NOT EXISTS sync_operations (
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
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    await (0, database_1.execute)(`CREATE TABLE IF NOT EXISTS refresh_tokens (
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
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    // Query indexes for the operational screens and sync cursors.
    await addIndexIfMissing('products', 'idx_products_updated', 'updated_at');
    await addIndexIfMissing('batches', 'idx_batches_status_updated', 'status, updated_at');
    await addIndexIfMissing('batches', 'idx_batches_updated', 'updated_at');
    await addIndexIfMissing('batches', 'idx_batches_product_created', 'product_id, created_at');
    await addIndexIfMissing('qc_records', 'idx_qc_tester_created', 'tester_id, created_at');
    await addIndexIfMissing('qc_records', 'idx_qc_batch_created', 'batch_id, created_at');
    await addIndexIfMissing('qc_records', 'idx_qc_created', 'created_at');
    await addIndexIfMissing('dispatch_records', 'idx_dispatch_user_created', 'dispatcher_id, created_at');
    await addIndexIfMissing('dispatch_records', 'idx_dispatch_batch_created', 'batch_id, created_at');
    await addIndexIfMissing('dispatch_records', 'idx_dispatch_created', 'created_at');
    await addIndexIfMissing('dispatch_records', 'idx_dispatch_order', 'dispatch_order_id');
    await addIndexIfMissing('dispatch_orders', 'idx_orders_status_created', 'status, created_at');
    await addIndexIfMissing('dispatch_orders', 'idx_orders_raised_created', 'raised_by, created_at');
    await addIndexIfMissing('dispatch_orders', 'idx_orders_batch_status', 'batch_id, status');
    await addIndexIfMissing('activity_logs', 'idx_activity_created', 'created_at');
    await addIndexIfMissing('activity_logs', 'idx_activity_user_created', 'user_role, user_id, created_at');
    await addIndexIfMissing('shelf_locations', 'idx_locations_updated', 'updated_at');
    await addIndexIfMissing('clients', 'idx_clients_updated', 'updated_at');
    await addIndexIfMissing('vendors', 'idx_vendors_updated', 'updated_at');
}
//# sourceMappingURL=schema.js.map