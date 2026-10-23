-- Migration: Add chemical industry fields to products table
ALTER TABLE products ADD COLUMN IF NOT EXISTS quantity DECIMAL(12,3) DEFAULT 0 AFTER price;
ALTER TABLE products ADD COLUMN IF NOT EXISTS cas_number VARCHAR(50) AFTER quantity;
ALTER TABLE products ADD COLUMN IF NOT EXISTS molecular_formula VARCHAR(100) AFTER cas_number;
ALTER TABLE products ADD COLUMN IF NOT EXISTS purity VARCHAR(50) AFTER molecular_formula;
ALTER TABLE products ADD COLUMN IF NOT EXISTS grade VARCHAR(100) AFTER purity;
ALTER TABLE products ADD COLUMN IF NOT EXISTS storage_conditions TEXT AFTER grade;
ALTER TABLE products ADD COLUMN IF NOT EXISTS hazard_classification VARCHAR(200) AFTER storage_conditions;
ALTER TABLE products ADD COLUMN IF NOT EXISTS physical_state VARCHAR(50) AFTER hazard_classification;
ALTER TABLE products ADD COLUMN IF NOT EXISTS hsn_code VARCHAR(20) AFTER physical_state;
ALTER TABLE products ADD COLUMN IF NOT EXISTS manufacturer VARCHAR(200) AFTER hsn_code;

-- Migration: Add batch fields
ALTER TABLE batches ADD COLUMN IF NOT EXISTS uom VARCHAR(20) DEFAULT 'kg' AFTER quantity;
ALTER TABLE batches ADD COLUMN IF NOT EXISTS storage_location VARCHAR(200) AFTER expiry_date;
ALTER TABLE batches MODIFY COLUMN quantity DECIMAL(12,3) NOT NULL DEFAULT 1;
