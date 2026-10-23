-- ============================================================
-- 003_qr_batches.sql
-- QC QR-label generation, reprint tracking, and grouped QC/dispatch.
--
-- A QR print job creates a quantity-bearing batch with one separately
-- scannable label per physical unit. QC and dispatch operate on whole batches.
--
-- Safe to run more than once. The API also applies these changes at startup.
-- ============================================================
USE factory_inventory;

ALTER TABLE qc_records
    ADD COLUMN IF NOT EXISTS group_operation_id VARCHAR(64) NULL AFTER client_operation_id;

ALTER TABLE dispatch_records
    ADD COLUMN IF NOT EXISTS group_operation_id VARCHAR(64) NULL AFTER client_operation_id;

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
    KEY idx_qr_labels_batch (batch_id),
    KEY idx_qr_labels_job (print_job_id),
    FOREIGN KEY (print_job_id) REFERENCES qr_print_jobs(id) ON DELETE CASCADE,
    FOREIGN KEY (batch_id) REFERENCES batches(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

DROP PROCEDURE IF EXISTS ensure_qr_index;
DELIMITER //
CREATE PROCEDURE ensure_qr_index(
    IN p_table VARCHAR(64),
    IN p_index VARCHAR(64),
    IN p_columns TEXT
)
BEGIN
    DECLARE existing INT DEFAULT 0;
    SELECT COUNT(*) INTO existing
      FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = p_table
       AND INDEX_NAME = p_index;
    IF existing = 0 THEN
        SET @ddl = CONCAT('ALTER TABLE `', p_table, '` ADD INDEX `', p_index, '` (', p_columns, ')');
        PREPARE stmt FROM @ddl;
        EXECUTE stmt;
        DEALLOCATE PREPARE stmt;
    END IF;
END //
DELIMITER ;

CALL ensure_qr_index('qc_records', 'idx_qc_group_operation', 'group_operation_id');
CALL ensure_qr_index('dispatch_records', 'idx_dispatch_group_operation', 'group_operation_id');
CALL ensure_qr_index('qr_labels', 'idx_qr_labels_job', 'print_job_id');
CALL ensure_qr_index('qr_labels', 'idx_qr_labels_batch', 'batch_id');

DROP PROCEDURE IF EXISTS ensure_qr_index;
