-- ============================================================
-- 002_offline_sync.sql
-- Offline-first mobile sync, device registration, refresh tokens,
-- dispatch-order workflow, and updated_at sync cursors.
--
-- Safe to run more than once. The backend also runs the same checks
-- at startup (backend/src/config/schema.ts), so a fresh install can
-- simply start the API.
-- ============================================================
USE factory_inventory;

-- ------------------------------------------------------------
-- Columns
-- ------------------------------------------------------------
ALTER TABLE products        ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP;
ALTER TABLE batches         ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP;
ALTER TABLE shelf_locations ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP;
ALTER TABLE clients         ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP;

ALTER TABLE qc_records       ADD COLUMN IF NOT EXISTS images LONGTEXT AFTER remarks;
ALTER TABLE qc_records       ADD COLUMN IF NOT EXISTS client_operation_id VARCHAR(64) NULL;
ALTER TABLE qc_records       ADD COLUMN IF NOT EXISTS client_created_at DATETIME(3) NULL;
ALTER TABLE qc_records       ADD COLUMN IF NOT EXISTS device_uuid VARCHAR(100) NULL;
ALTER TABLE qc_records       ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP;

ALTER TABLE dispatch_records ADD COLUMN IF NOT EXISTS images LONGTEXT AFTER remarks;
ALTER TABLE dispatch_records ADD COLUMN IF NOT EXISTS dispatch_order_id INT NULL;
ALTER TABLE dispatch_records ADD COLUMN IF NOT EXISTS client_operation_id VARCHAR(64) NULL;
ALTER TABLE dispatch_records ADD COLUMN IF NOT EXISTS client_created_at DATETIME(3) NULL;
ALTER TABLE dispatch_records ADD COLUMN IF NOT EXISTS device_uuid VARCHAR(100) NULL;
ALTER TABLE dispatch_records ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP;

ALTER TABLE dispatch_orders  ADD COLUMN IF NOT EXISTS client_operation_id VARCHAR(64) NULL;
ALTER TABLE dispatch_orders  ADD COLUMN IF NOT EXISTS client_created_at DATETIME(3) NULL;
ALTER TABLE dispatch_orders  ADD COLUMN IF NOT EXISTS device_uuid VARCHAR(100) NULL;
ALTER TABLE dispatch_orders  ADD COLUMN IF NOT EXISTS dispatched_at DATETIME(3) NULL;

ALTER TABLE fix_records      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP;

ALTER TABLE admins           ADD COLUMN IF NOT EXISTS is_active TINYINT(1) NOT NULL DEFAULT 1;
ALTER TABLE qc_users         ADD COLUMN IF NOT EXISTS is_active TINYINT(1) NOT NULL DEFAULT 1;
ALTER TABLE dispatch_users   ADD COLUMN IF NOT EXISTS is_active TINYINT(1) NOT NULL DEFAULT 1;

-- ------------------------------------------------------------
-- New tables
-- ------------------------------------------------------------
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

-- ------------------------------------------------------------
-- Indexes (idempotent helper)
-- ------------------------------------------------------------
DROP PROCEDURE IF EXISTS ensure_sync_index;
DELIMITER //
CREATE PROCEDURE ensure_sync_index(
    IN p_table VARCHAR(64),
    IN p_index VARCHAR(64),
    IN p_columns TEXT,
    IN p_unique TINYINT
)
BEGIN
    DECLARE existing INT DEFAULT 0;
    DECLARE unique_existing INT DEFAULT 0;

    SELECT COUNT(*) INTO existing
      FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = p_table
       AND INDEX_NAME = p_index;

    IF existing = 0 THEN
        SET @ddl = CONCAT(
            'ALTER TABLE `', p_table, '` ADD ',
            IF(p_unique = 1, 'UNIQUE ', ''),
            'INDEX `', p_index, '` (', p_columns, ')'
        );
        PREPARE stmt FROM @ddl;
        EXECUTE stmt;
        DEALLOCATE PREPARE stmt;
    ELSEIF p_unique = 1 THEN
        SELECT COUNT(*) INTO unique_existing
          FROM information_schema.STATISTICS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = p_table
           AND INDEX_NAME = p_index
           AND NON_UNIQUE = 0;
        IF unique_existing = 0 THEN
            SET @ddl = CONCAT('ALTER TABLE `', p_table, '` DROP INDEX `', p_index, '`');
            PREPARE stmt FROM @ddl;
            EXECUTE stmt;
            DEALLOCATE PREPARE stmt;
            SET @ddl = CONCAT('ALTER TABLE `', p_table, '` ADD UNIQUE INDEX `', p_index, '` (', p_columns, ')');
            PREPARE stmt FROM @ddl;
            EXECUTE stmt;
            DEALLOCATE PREPARE stmt;
        END IF;
    END IF;
END //
DELIMITER ;

CALL ensure_sync_index('products', 'idx_products_updated', 'updated_at', 0);
CALL ensure_sync_index('batches', 'idx_batches_status_updated', 'status, updated_at', 0);
CALL ensure_sync_index('batches', 'idx_batches_updated', 'updated_at', 0);
CALL ensure_sync_index('batches', 'idx_batches_product_created', 'product_id, created_at', 0);
CALL ensure_sync_index('qc_records', 'idx_qc_tester_created', 'tester_id, created_at', 0);
CALL ensure_sync_index('qc_records', 'idx_qc_batch_created', 'batch_id, created_at', 0);
CALL ensure_sync_index('qc_records', 'idx_qc_created', 'created_at', 0);
CALL ensure_sync_index('qc_records', 'uq_qc_client_operation', 'client_operation_id', 1);
CALL ensure_sync_index('dispatch_records', 'idx_dispatch_user_created', 'dispatcher_id, created_at', 0);
CALL ensure_sync_index('dispatch_records', 'idx_dispatch_batch_created', 'batch_id, created_at', 0);
CALL ensure_sync_index('dispatch_records', 'idx_dispatch_created', 'created_at', 0);
CALL ensure_sync_index('dispatch_records', 'idx_dispatch_order', 'dispatch_order_id', 0);
CALL ensure_sync_index('dispatch_records', 'uq_dispatch_client_operation', 'client_operation_id', 1);
CALL ensure_sync_index('dispatch_orders', 'idx_orders_status_created', 'status, created_at', 0);
CALL ensure_sync_index('dispatch_orders', 'idx_orders_raised_created', 'raised_by, created_at', 0);
CALL ensure_sync_index('dispatch_orders', 'idx_orders_batch_status', 'batch_id, status', 0);
CALL ensure_sync_index('dispatch_orders', 'uq_dispatch_order_client_operation', 'client_operation_id', 1);
CALL ensure_sync_index('activity_logs', 'idx_activity_created', 'created_at', 0);
CALL ensure_sync_index('activity_logs', 'idx_activity_user_created', 'user_role, user_id, created_at', 0);
CALL ensure_sync_index('shelf_locations', 'idx_locations_updated', 'updated_at', 0);
CALL ensure_sync_index('clients', 'idx_clients_updated', 'updated_at', 0);

DROP PROCEDURE IF EXISTS ensure_sync_index;
