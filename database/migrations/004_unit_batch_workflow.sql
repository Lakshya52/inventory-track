-- Idempotent unit-label, batch-location, and dispatch metadata upgrade.
-- The API also applies these schema checks at startup.
USE factory_inventory;

ALTER TABLE batches
  ADD COLUMN IF NOT EXISTS shelf_location_id INT NULL;

ALTER TABLE dispatch_orders
  ADD COLUMN IF NOT EXISTS client_id INT NULL,
  ADD COLUMN IF NOT EXISTS driver_name VARCHAR(150) NULL,
  ADD COLUMN IF NOT EXISTS vehicle_number VARCHAR(50) NULL;

DROP PROCEDURE IF EXISTS ensure_unit_batch_workflow_index;
DELIMITER //
CREATE PROCEDURE ensure_unit_batch_workflow_index()
BEGIN
  DECLARE old_index_count INT DEFAULT 0;
  DECLARE batch_index_count INT DEFAULT 0;
  DECLARE location_index_count INT DEFAULT 0;

  SELECT COUNT(*) INTO batch_index_count
    FROM information_schema.STATISTICS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'qr_labels'
     AND INDEX_NAME = 'idx_qr_labels_batch';
  IF batch_index_count = 0 THEN
    ALTER TABLE qr_labels ADD INDEX idx_qr_labels_batch (batch_id);
  END IF;

  SELECT COUNT(*) INTO old_index_count
    FROM information_schema.STATISTICS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'qr_labels'
     AND INDEX_NAME = 'uq_qr_label_batch';
  IF old_index_count > 0 THEN
    ALTER TABLE qr_labels DROP INDEX uq_qr_label_batch;
  END IF;

  SELECT COUNT(*) INTO location_index_count
    FROM information_schema.STATISTICS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'batches'
     AND INDEX_NAME = 'idx_batches_shelf_location';
  IF location_index_count = 0 THEN
    ALTER TABLE batches ADD INDEX idx_batches_shelf_location (shelf_location_id);
  END IF;
END //
DELIMITER ;

CALL ensure_unit_batch_workflow_index();
DROP PROCEDURE IF EXISTS ensure_unit_batch_workflow_index;
