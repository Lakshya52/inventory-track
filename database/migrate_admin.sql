-- ============================================================
-- Admin Dashboard Migration
-- Adds vendor master data and account activation support.
-- The backend also applies these idempotently on startup.
-- ============================================================

CREATE TABLE IF NOT EXISTS vendors (
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
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE admins ADD COLUMN is_active TINYINT(1) NOT NULL DEFAULT 1;
ALTER TABLE qc_users ADD COLUMN is_active TINYINT(1) NOT NULL DEFAULT 1;
ALTER TABLE dispatch_users ADD COLUMN is_active TINYINT(1) NOT NULL DEFAULT 1;
ALTER TABLE production_users ADD COLUMN is_active TINYINT(1) NOT NULL DEFAULT 1;
