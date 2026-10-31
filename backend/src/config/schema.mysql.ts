import { execute, query } from "./database";
import { RowDataPacket } from "mysql2";

const USER_TABLES = ["admins", "qc_users", "dispatch_users"];

async function columnExists(table: string, column: string): Promise<boolean> {
  const rows = await query<RowDataPacket[]>(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column],
  );
  return rows.length > 0;
}

async function addColumnIfMissing(
  table: string,
  column: string,
  definition: string,
): Promise<void> {
  if (!(await columnExists(table, column))) {
    await execute(
      `ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${definition}`,
    );
  }
}

async function indexExists(table: string, index: string): Promise<boolean> {
  const rows = await query<RowDataPacket[]>(
    `SELECT INDEX_NAME FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ? LIMIT 1`,
    [table, index],
  );
  return rows.length > 0;
}

async function addIndexIfMissing(
  table: string,
  index: string,
  columns: string,
): Promise<void> {
  if (!(await indexExists(table, index))) {
    await execute(
      `ALTER TABLE \`${table}\` ADD INDEX \`${index}\` (${columns})`,
    );
  }
}

async function addUniqueIndexIfMissing(
  table: string,
  index: string,
  columns: string,
): Promise<void> {
  const rows = await query<RowDataPacket[]>(
    `SELECT INDEX_NAME, NON_UNIQUE FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ? LIMIT 1`,
    [table, index],
  );
  if (rows.length > 0 && Number(rows[0].NON_UNIQUE) === 0) return;
  if (rows.length > 0) {
    // Upgrade an earlier non-unique index without leaving a duplicate index.
    await execute(`ALTER TABLE \`${table}\` DROP INDEX \`${index}\``);
  }
  await execute(
    `ALTER TABLE \`${table}\` ADD UNIQUE INDEX \`${index}\` (${columns})`,
  );
}

/**
 * Idempotent startup migration. It keeps existing installations upgradeable
 * without a destructive seed. Every statement must be safe to run repeatedly.
 */
export async function ensureAdminSchema(): Promise<void> {
  await execute(`CREATE TABLE IF NOT EXISTS qr_reprint_requests (
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
    INDEX idx_qr_reprint_tenant_status (tenant_id, status, requested_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  await execute(`CREATE TABLE IF NOT EXISTS tenants (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(200) NOT NULL,
    email VARCHAR(254) NOT NULL,
    email_key VARCHAR(254) NOT NULL UNIQUE,
    phone VARCHAR(32) NOT NULL,
    logo_url VARCHAR(500) NULL,
    logo_data LONGTEXT NULL,
    logo_mime_type VARCHAR(100) NULL,
    slug VARCHAR(100) NOT NULL UNIQUE,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  await addColumnIfMissing('tenants', 'updated_at', 'TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP');
  await addColumnIfMissing('tenants', 'logo_data', 'LONGTEXT NULL');
  await addColumnIfMissing('tenants', 'logo_mime_type', 'VARCHAR(100) NULL');
  await addColumnIfMissing('admins', 'tenant_id', 'BIGINT UNSIGNED NULL');
  await addColumnIfMissing('qc_users', 'tenant_id', 'BIGINT UNSIGNED NULL');
  await addColumnIfMissing('dispatch_users', 'tenant_id', 'BIGINT UNSIGNED NULL');
  await addColumnIfMissing('products', 'tenant_id', 'BIGINT UNSIGNED NULL');
  await addColumnIfMissing('batches', 'tenant_id', 'BIGINT UNSIGNED NULL');
  await addColumnIfMissing('qc_records', 'tenant_id', 'BIGINT UNSIGNED NULL');
  await addColumnIfMissing('dispatch_records', 'tenant_id', 'BIGINT UNSIGNED NULL');
  await addColumnIfMissing('dispatch_orders', 'tenant_id', 'BIGINT UNSIGNED NULL');
  await addColumnIfMissing('dispatch_orders', 'order_lines', 'JSON NULL');
  await addColumnIfMissing('clients', 'tenant_id', 'BIGINT UNSIGNED NULL');
  await addColumnIfMissing('vendors', 'tenant_id', 'BIGINT UNSIGNED NULL');
  await addColumnIfMissing('shelf_locations', 'tenant_id', 'BIGINT UNSIGNED NULL');
  await addColumnIfMissing('activity_logs', 'tenant_id', 'BIGINT UNSIGNED NULL');
  await addIndexIfMissing('admins', 'idx_admins_tenant', 'tenant_id');
  await addIndexIfMissing('qc_users', 'idx_qc_tenant', 'tenant_id');
  await addIndexIfMissing('dispatch_users', 'idx_dispatch_tenant', 'tenant_id');
  const legacyTenants = await query<RowDataPacket[]>("SELECT id FROM tenants WHERE email_key = '__legacy_workspace__' LIMIT 1");
  let legacyTenantId = legacyTenants[0]?.id as number | undefined;
  if (!legacyTenantId) {
    const users = await query<RowDataPacket[]>("SELECT id, name, email FROM admins ORDER BY id LIMIT 1");
    if (users.length) {
      try {
        const result = await execute("INSERT INTO tenants (name, email, email_key, phone, slug) VALUES ('Legacy workspace', ?, '__legacy_workspace__', '0000000000', 'legacy-workspace')", [users[0].email || 'legacy@invalid.local']);
        legacyTenantId = result.insertId;
      } catch {
        const fallback = await query<RowDataPacket[]>("SELECT id FROM tenants WHERE slug = 'legacy-workspace' LIMIT 1");
        legacyTenantId = fallback[0]?.id as number | undefined;
      }
    }
  }
  if (legacyTenantId) {
    for (const table of USER_TABLES) await execute(`UPDATE \`${table}\` SET tenant_id = ? WHERE tenant_id IS NULL`, [legacyTenantId]);
    for (const table of ['products', 'batches', 'qc_records', 'dispatch_records', 'dispatch_orders', 'clients', 'vendors', 'shelf_locations', 'activity_logs']) {
      await execute(`UPDATE \`${table}\` SET tenant_id = ? WHERE tenant_id IS NULL`, [legacyTenantId]);
    }
  }
  for (const table of USER_TABLES) {
    await addColumnIfMissing(
      table,
      "is_active",
      "TINYINT(1) NOT NULL DEFAULT 1",
    );
  }

  // Sync cursors and soft ordering columns.
  await addColumnIfMissing(
    "products",
    "updated_at",
    "TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP",
  );
  await addColumnIfMissing("products", "bag_quantity_id", "INT NULL");
  await addColumnIfMissing(
    "batches",
    "updated_at",
    "TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP",
  );
  await addColumnIfMissing(
    "shelf_locations",
    "updated_at",
    "TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP",
  );
  await addColumnIfMissing(
    "clients",
    "updated_at",
    "TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP",
  );
  await addColumnIfMissing("batches", "shelf_location_id", "INT NULL");
  await addColumnIfMissing("dispatch_orders", "client_id", "INT NULL");
  await addColumnIfMissing(
    "dispatch_orders",
    "driver_name",
    "VARCHAR(150) NULL",
  );
  await addColumnIfMissing("dispatch_orders", "driver_phone", "VARCHAR(32) NULL");
  await addColumnIfMissing("dispatch_orders", "stock_reserved_at_order", "DATETIME(3) NULL");
  await addColumnIfMissing("dispatch_orders", "quantity", "INT UNSIGNED NULL");
  await addColumnIfMissing("qr_labels", "dispatch_order_id", "INT NULL");
  await addColumnIfMissing("qr_labels", "recall_status", "VARCHAR(20) NULL");
  await addColumnIfMissing("qr_labels", "recall_condition", "VARCHAR(30) NULL");
  await addColumnIfMissing("qr_labels", "recall_reason", "VARCHAR(1000) NULL");
  await addColumnIfMissing("qr_labels", "recalled_by", "VARCHAR(64) NULL");
  await addColumnIfMissing("qr_labels", "recalled_at", "DATETIME(3) NULL");
  await addColumnIfMissing(
    "dispatch_orders",
    "vehicle_number",
    "VARCHAR(50) NULL",
  );
  await addColumnIfMissing(
    "dispatch_orders",
    "container_number",
    "VARCHAR(100) NULL",
  );
  await addColumnIfMissing(
    "dispatch_orders",
    "approved_by_role",
    "VARCHAR(20) NULL",
  );
  await addColumnIfMissing("dispatch_orders", "approved_by_id", "INT NULL");
  await addColumnIfMissing("batches", "vendor_id", "INT NULL");
  await addColumnIfMissing("batches", "grade_id", "INT NULL");
  await addColumnIfMissing("batches", "bag_quantity_id", "INT NULL");
  await addColumnIfMissing(
    "batches",
    "fg_details_completed_at",
    "DATETIME(3) NULL",
  );
  await addColumnIfMissing("batches", "batch_group_id", "CHAR(36) NULL");
  await addColumnIfMissing("batches", "parent_batch_number", "VARCHAR(100) NULL");
  await addIndexIfMissing("batches", "idx_batches_group", "batch_group_id");

  await execute(`CREATE TABLE IF NOT EXISTS batch_groups (
    group_key CHAR(36) PRIMARY KEY,
    batch_number VARCHAR(100) NOT NULL UNIQUE,
    tenant_id BIGINT UNSIGNED NULL,
    created_by INT NOT NULL,
    product_count INT NOT NULL,
    total_quantity INT NOT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'QC_PASSED',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    KEY idx_batch_groups_created (created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  await addColumnIfMissing('batch_groups', 'tenant_id', 'BIGINT UNSIGNED NULL');
  await addIndexIfMissing('batch_groups', 'idx_batch_groups_tenant', 'tenant_id');

  // Offline idempotency / provenance columns. The server timestamp stays in
  // created_at; client_created_at preserves the time the field user acted.
  for (const table of ["qc_records", "dispatch_records", "dispatch_orders"]) {
    await addColumnIfMissing(table, "client_operation_id", "VARCHAR(64) NULL");
    await addColumnIfMissing(table, "client_created_at", "DATETIME(3) NULL");
    await addColumnIfMissing(table, "device_uuid", "VARCHAR(100) NULL");
  }

  await addColumnIfMissing(
    "qc_records",
    "updated_at",
    "TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP",
  );
  await addColumnIfMissing("qc_records", "method", "VARCHAR(30) NULL");
  await addColumnIfMissing(
    "dispatch_records",
    "updated_at",
    "TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP",
  );
  await addColumnIfMissing(
    "qc_records",
    "group_operation_id",
    "VARCHAR(64) NULL",
  );
  await addColumnIfMissing(
    "dispatch_records",
    "group_operation_id",
    "VARCHAR(64) NULL",
  );
  await addColumnIfMissing(
    "fix_records",
    "updated_at",
    "TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP",
  );
  await addColumnIfMissing(
    "dispatch_orders",
    "dispatched_at",
    "DATETIME(3) NULL",
  );
  await addColumnIfMissing("dispatch_records", "dispatch_order_id", "INT NULL");

  await execute(`CREATE TABLE IF NOT EXISTS vendors (
    id INT AUTO_INCREMENT PRIMARY KEY,
    vendor_code VARCHAR(30) UNIQUE NOT NULL,
    name VARCHAR(200) NOT NULL,
    contact_person VARCHAR(100) NULL,
    email VARCHAR(100) NULL,
    phone VARCHAR(50) NULL,
    address TEXT NULL,
    gst_number VARCHAR(50) NULL,
    category VARCHAR(100) NULL,
    payment_terms VARCHAR(100) NULL,
    notes TEXT NULL,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    KEY idx_vendors_name (name),
    KEY idx_vendors_active (is_active)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

  await execute(`CREATE TABLE IF NOT EXISTS uoms (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL UNIQUE,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

  await execute(`INSERT INTO vendors (vendor_code, name, category, is_active)
    VALUES ('SELF', 'Self', 'Internal', 1)
    ON DUPLICATE KEY UPDATE name = 'Self', category = 'Internal', is_active = 1`);

  await execute(`CREATE TABLE IF NOT EXISTS grades (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL UNIQUE,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

  await execute(`CREATE TABLE IF NOT EXISTS uoms (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL UNIQUE,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

  await execute(`INSERT INTO grades (name)
    SELECT DISTINCT TRIM(p.grade)
    FROM products p
    LEFT JOIN grades g ON g.name = TRIM(p.grade)
    WHERE p.grade IS NOT NULL AND TRIM(p.grade) <> '' AND g.id IS NULL`);

  await execute(`CREATE TABLE IF NOT EXISTS uoms (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL UNIQUE,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

  await execute(`CREATE TABLE IF NOT EXISTS bag_quantities (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(120) NOT NULL UNIQUE,
    quantity DECIMAL(14,4) NOT NULL,
    unit VARCHAR(40) NOT NULL,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

  await execute(`CREATE TABLE IF NOT EXISTS uoms (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL UNIQUE,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

  // A nullable unique column is valid in MariaDB/MySQL: multiple NULLs are
  // allowed while a non-null client operation can only be applied once.
  await addUniqueIndexIfMissing(
    "qc_records",
    "uq_qc_client_operation",
    "client_operation_id",
  );
  await addUniqueIndexIfMissing(
    "dispatch_records",
    "uq_dispatch_client_operation",
    "client_operation_id",
  );
  await addUniqueIndexIfMissing(
    "dispatch_orders",
    "uq_dispatch_order_client_operation",
    "client_operation_id",
  );

  await execute(`CREATE TABLE IF NOT EXISTS devices (
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

  await execute(`CREATE TABLE IF NOT EXISTS uoms (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL UNIQUE,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

  await execute(`CREATE TABLE IF NOT EXISTS device_sync_state (
    device_uuid VARCHAR(100) NOT NULL PRIMARY KEY,
    last_pull_at DATETIME(3) NULL,
    last_push_at DATETIME(3) NULL,
    last_error TEXT NULL,
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

  await execute(`CREATE TABLE IF NOT EXISTS uoms (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL UNIQUE,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

  await execute(`CREATE TABLE IF NOT EXISTS sync_operations (
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

  await execute(`CREATE TABLE IF NOT EXISTS uoms (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL UNIQUE,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

  await execute(`CREATE TABLE IF NOT EXISTS refresh_tokens (
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

  await execute(`CREATE TABLE IF NOT EXISTS uoms (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL UNIQUE,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

  // Each QR label identifies one unit within a single batch.
  await execute(`CREATE TABLE IF NOT EXISTS qr_print_jobs (
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
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

  await execute(`CREATE TABLE IF NOT EXISTS uoms (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL UNIQUE,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

  await execute(`CREATE TABLE IF NOT EXISTS qr_labels (
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
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

  await execute(`CREATE TABLE IF NOT EXISTS uoms (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL UNIQUE,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

  // Preserve the foreign-key index before removing the legacy unique index.
  await addIndexIfMissing("qr_labels", "idx_qr_labels_batch", "batch_id");
  if (await indexExists("qr_labels", "uq_qr_label_batch")) {
    await execute("ALTER TABLE qr_labels DROP INDEX uq_qr_label_batch");
  }

  // Query indexes for the operational screens and sync cursors.
  await addIndexIfMissing("products", "idx_products_updated", "updated_at");
  await addIndexIfMissing(
    "batches",
    "idx_batches_status_updated",
    "status, updated_at",
  );
  await addIndexIfMissing("batches", "idx_batches_updated", "updated_at");
  await addIndexIfMissing(
    "batches",
    "idx_batches_product_created",
    "product_id, created_at",
  );
  await addIndexIfMissing(
    "qc_records",
    "idx_qc_tester_created",
    "tester_id, created_at",
  );
  await addIndexIfMissing(
    "qc_records",
    "idx_qc_batch_created",
    "batch_id, created_at",
  );
  await addIndexIfMissing("qc_records", "idx_qc_created", "created_at");
  await addIndexIfMissing(
    "qc_records",
    "idx_qc_group_operation",
    "group_operation_id",
  );
  await addIndexIfMissing(
    "dispatch_records",
    "idx_dispatch_user_created",
    "dispatcher_id, created_at",
  );
  await addIndexIfMissing(
    "dispatch_records",
    "idx_dispatch_group_operation",
    "group_operation_id",
  );
  await addIndexIfMissing(
    "dispatch_records",
    "idx_dispatch_batch_created",
    "batch_id, created_at",
  );
  await addIndexIfMissing(
    "dispatch_records",
    "idx_dispatch_created",
    "created_at",
  );
  await addIndexIfMissing(
    "dispatch_records",
    "idx_dispatch_order",
    "dispatch_order_id",
  );
  await addIndexIfMissing(
    "dispatch_orders",
    "idx_orders_status_created",
    "status, created_at",
  );
  await addIndexIfMissing(
    "dispatch_orders",
    "idx_orders_raised_created",
    "raised_by, created_at",
  );
  await addIndexIfMissing(
    "dispatch_orders",
    "idx_orders_batch_status",
    "batch_id, status",
  );
  await addIndexIfMissing(
    "activity_logs",
    "idx_activity_created",
    "created_at",
  );
  await addIndexIfMissing(
    "activity_logs",
    "idx_activity_user_created",
    "user_role, user_id, created_at",
  );
  await addIndexIfMissing(
    "shelf_locations",
    "idx_locations_updated",
    "updated_at",
  );
  await addIndexIfMissing("clients", "idx_clients_updated", "updated_at");
  await addIndexIfMissing(
    "batches",
    "idx_batches_shelf_location",
    "shelf_location_id",
  );
}
