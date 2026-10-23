-- ============================================================
-- Admin Dashboard Migration
-- Adds account activation support for the three active roles.
-- The backend also applies these idempotently on startup.
-- ============================================================

ALTER TABLE admins ADD COLUMN is_active TINYINT(1) NOT NULL DEFAULT 1;
ALTER TABLE qc_users ADD COLUMN is_active TINYINT(1) NOT NULL DEFAULT 1;
ALTER TABLE dispatch_users ADD COLUMN is_active TINYINT(1) NOT NULL DEFAULT 1;
