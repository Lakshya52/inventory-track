-- 15 Sample Chemical Products for Factory Inventory
-- Run: mysql -u root -p factory_inventory < database/seed_15_products.sql
-- Or paste into your SQL client

USE factory_inventory;

INSERT INTO products (name, description, sku, price, quantity, cas_number, molecular_formula, purity, grade, storage_conditions, hazard_classification, physical_state, hsn_code, manufacturer) VALUES
(
  'Sulfuric Acid',
  'Concentrated sulfuric acid for laboratory and industrial use',
  'CHM-001', 850.00, 500, '7664-93-9', 'H2SO4', '98%',
  'AR (Analytical Reagent)',
  'Store in a cool, dry place away from direct sunlight. Keep in acid cabinet.',
  'Corrosive', 'Liquid', '28070010', 'Self'
),
(
  'Sodium Hydroxide',
  'White hygroscopic pellets for general laboratory use',
  'CHM-002', 450.00, 200, '1310-73-2', 'NaOH', '97%',
  'LR (Laboratory Reagent)',
  'Store in airtight container away from moisture.',
  'Corrosive, Irritant', 'Pellets', '28151100', 'Self'
),
(
  'Acetone',
  'HPLC grade solvent for chromatography and extraction',
  'CHM-003', 320.00, 100, '67-64-1', 'C3H6O', '99.5%',
  'HPLC',
  'Store in flammable cabinet away from heat sources and ignition sources.',
  'Flammable, Irritant', 'Liquid', '29141100', 'Self'
),
(
  'Ethanol Absolute',
  'Absolute ethanol for molecular biology and pharmaceutical applications',
  'CHM-004', 280.00, 300, '64-17-5', 'C2H5OH', '99.9%',
  'ACS',
  'Store in a cool place away from flame. Keep container tightly closed.',
  'Flammable', 'Liquid', '22071000', 'Self'
),
(
  'Hydrochloric Acid',
  'Concentrated hydrochloric acid 35-37% for analytical use',
  'CHM-005', 180.00, 400, '7647-01-0', 'HCl', '35-37%',
  'AR (Analytical Reagent)',
  'Store in acid cabinet in a well-ventilated area.',
  'Corrosive, Irritant', 'Liquid', '28061000', 'Self'
),
(
  'Methanol',
  'HPLC grade methanol for analytical and chromatographic applications',
  'CHM-006', 250.00, 150, '67-56-1', 'CH3OH', '99.8%',
  'HPLC',
  'Store in flammable cabinet. Keep away from heat and open flames.',
  'Flammable, Toxic', 'Liquid', '29051100', 'Self'
),
(
  'Sodium Chloride',
  'High purity sodium chloride for buffer preparation and general use',
  'CHM-007', 120.00, 600, '7647-14-5', 'NaCl', '99.5%',
  'GR (Guaranteed Reagent)',
  'Store in a dry place at room temperature. Hygroscopic — keep container sealed.',
  'Non-hazardous', 'Crystals', '25010010', 'Self'
),
(
  'Potassium Permanganate',
  'Strong oxidizing agent for analytical and water treatment applications',
  'CHM-008', 380.00, 80, '7722-64-7', 'KMnO4', '99%',
  'AR (Analytical Reagent)',
  'Store in a cool, dry place away from organic materials and reducing agents.',
  'Oxidizer, Harmful', 'Crystals', '28416100', 'Self'
),
(
  'Silica Gel',
  'Desiccant beads for drying and chromatography column packing',
  'CHM-009', 200.00, 250, '7631-86-9', 'SiO2', '99%',
  'Technical',
  'Store in a dry place. Keep away from moisture.',
  'Non-hazardous', 'Granules', '28112200', 'Self'
),
(
  'Glycerol',
  'Anhydrous glycerol for pharmaceutical and cosmetic formulations',
  'CHM-010', 340.00, 180, '56-81-5', 'C3H8O3', '99.5%',
  'USP',
  'Store at room temperature in a tightly closed container. Hygroscopic.',
  'Non-hazardous', 'Liquid', '29054500', 'Self'
),
(
  'Ammonium Nitrate',
  'High purity ammonium nitrate for laboratory and fertilizer applications',
  'CHM-011', 290.00, 120, '6484-52-2', 'NH4NO3', '98%',
  'LR (Laboratory Reagent)',
  'Store in a cool, dry place away from combustible materials. Strong oxidizer.',
  'Oxidizer, Explosive', 'Granules', '31023000', 'Self'
),
(
  'Zinc Oxide',
  'Fine white powder for pharmaceutical and cosmetic applications',
  'CHM-012', 260.00, 350, '1314-13-2', 'ZnO', '99%',
  'IP (Indian Pharmacopoeia)',
  'Store in a cool, dry place in a tightly closed container.',
  'Irritant', 'Powder', '28170010', 'Self'
),
(
  'Liquid Nitrogen',
  'High purity liquid nitrogen for cryogenic preservation and cooling',
  'CHM-013', 150.00, 50, '7727-37-9', 'N2', '99.999%',
  'Technical',
  'Store in cryogenic Dewar flask. Handle with cryogenic gloves and face shield.',
  'Compressed Gas', 'Liquefied Gas', '28043000', 'Self'
),
(
  'Paraffin Wax',
  'White refined paraffin wax for laboratory and industrial applications',
  'CHM-014', 180.00, 200, '8002-74-2', NULL, '99%',
  'Technical',
  'Store at room temperature away from direct sunlight.',
  'Non-hazardous', 'Solid', '27121000', 'Self'
),
(
  'Hydrogen Peroxide',
  'Stabilized hydrogen peroxide solution for disinfection and bleaching',
  'CHM-015', 220.00, 160, '7722-84-1', 'H2O2', '30% w/v',
  'LR (Laboratory Reagent)',
  'Store in a cool, dark place away from organic materials and reducing agents. Ventilated container.',
  'Oxidizer, Irritant', 'Liquid', '28470000', 'Self'
);
