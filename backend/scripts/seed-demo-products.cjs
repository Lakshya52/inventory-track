/**
 * Seeds 10 polymer-compound product families, 10,000 grades each (100,000 rows),
 * into the live dev MongoDB (factory_inventory), matching the existing product
 * document shape exactly:
 *   - tenant_id copied from existing `products` rows
 *   - manufacturer "SELF (KLJ)"
 *   - bag_quantity_id pointing at the existing "Kg" UOM
 *   - SKU "KLJ-<family-code>-<4-digit sequence>" (unique per product)
 *   - grade field = grade master name, e.g. "XLPE BK 000001"
 *   - grades stored once in `products` per grade (as usual) AND once in the
 *     `grades` master list (the app cross-references it)
 *
 * Usage: node scripts/seed-demo-products.cjs
 * Safe to re-run: rows whose SKU already exists are skipped.
 */
const { MongoClient } = require('mongodb');

const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/factory_inventory';
const DB_NAME = process.env.MONGO_DB_NAME || 'factory_inventory';

const FAMILIES = [
  { name: 'LLDPE COMPOUND', code: 'LLD', desc: 'Linear low-density polyethylene compound for cable sheathing and extrusion' },
  { name: 'HDPE COMPOUND', code: 'HDP', desc: 'High-density polyethylene compound for industrial pipe and conduit jacketing' },
  { name: 'MDPE COMPOUND', code: 'MDP', desc: 'Medium-density polyethylene compound for telecommunications ducts' },
  { name: 'PVC COMPOUND', code: 'PVC', desc: 'Lead-free PVC compound for wire and cable insulation' },
  { name: 'XLPE BK COMPOUND', code: 'XBK', desc: 'Black pigmented XLPE compound for outdoor cable sheathing' },
  { name: 'CPE COMPOUND', code: 'CPE', desc: 'Chlorinated polyethylene compound for flame-retardant jacketing' },
  { name: 'HFFR COMPOUND', code: 'HFFR', desc: 'Halogen-free flame-retardant compound for safety-critical wiring' },
  { name: 'TPE COMPOUND', code: 'TPE', desc: 'Thermoplastic elastomer compound for flexible cable applications' },
  { name: 'PEX COMPOUND', code: 'PEX', desc: 'Cross-linked polyethylene compound for high-temperature insulation' },
  { name: 'EPR COMPOUND', code: 'EPR', desc: 'Ethylene propylene rubber compound for medium/high-voltage cable insulation' },
];

const COLOR_CODES = ['BK', 'WH', 'RD', 'BL', 'GR', 'YE', 'GN', 'VT', 'OR', 'GY'];

const GRADES_PER_FAMILY = 10_000;

async function main() {
  const client = new MongoClient(MONGO_URI);
  await client.connect();
  const db = client.db(DB_NAME);
  const products = db.collection('products');
  const grades = db.collection('grades');

  const existing = await products.findOne({}, { projection: { tenant_id: 1 } });
  const tenantId = existing?.tenant_id;
  if (!tenantId) throw new Error('No products found — cannot determine tenant_id for seeding');

  const kgUom = await db.collection('uoms').findOne({ name: 'Kg' });
  const bagUom = kgUom?._id ?? null;
  if (!bagUom) throw new Error('Kg UOM not found in dev DB — aborting rather than guessing a UOM reference');

  const now = new Date();
  let created = 0;
  let skipped = 0;

  for (const family of FAMILIES) {
    console.log(`Seeding ${family.name} (${GRADES_PER_FAMILY} grades)...`);
    const existingCodes = new Set(
      (await products.find({ sku: { $regex: `^KLJ-${family.code}-` } }, { projection: { sku: 1 } }).toArray()).map((p) => p.sku)
    );

    const productDocs = [];
    const gradeDocs = [];

    for (let i = 1; i <= GRADES_PER_FAMILY; i += 1) {
      const seq = String(i).padStart(4, '0');
      const sku = `KLJ-${family.code}-${seq}`;
      if (existingCodes.has(sku)) {
        skipped += 1;
        continue;
      }
      const color = COLOR_CODES[(i - 1) % COLOR_CODES.length];
      const gradeName = `${family.code} ${color} ${String(i).padStart(4, '0')}`;
      productDocs.push({
        name: family.name,
        description: family.desc,
        sku,
        price: 0,
        quantity: 0,
        cas_number: null,
        molecular_formula: null,
        purity: null,
        grade: gradeName,
        bag_quantity_id: bagUom,
        storage_conditions: null,
        hazard_classification: null,
        physical_state: null,
        hsn_code: null,
        manufacturer: 'SELF (KLJ)',
        created_at: now,
        updated_at: now,
        tenant_id: tenantId,
      });
      gradeDocs.push({ tenant_id: tenantId, name: gradeName, is_active: 1, created_at: now, updated_at: now });
    }

    // Insert in chunks to keep the driver happy.
    const CHUNK = 1000;
    for (let c = 0; c < productDocs.length; c += CHUNK) {
      await products.insertMany(productDocs.slice(c, c + CHUNK), { ordered: false });
      await grades.insertMany(gradeDocs.slice(c, c + CHUNK), { ordered: false }).catch((err) => {
        // Tolerate duplicate key errors on grade names (idempotency): ignore and continue.
        if (err?.code !== 11000) throw err;
      });
      created += CHUNK;
    }
  }

  console.log(`Done. Rows inserted (approx): ${created}; skipped duplicates: ${skipped}`);
  const counts = await Promise.all([
    products.countDocuments(),
    grades.countDocuments(),
  ]);
  console.log(`products: ${counts[0]}, grades master: ${counts[1]}`);
  await client.close();
}

main().catch((err) => {
  console.error('Seeding failed:', err);
  process.exit(1);
});
