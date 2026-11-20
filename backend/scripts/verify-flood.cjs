/**
 * Read-only consistency check for a flood-test tenant.
 *   node scripts/verify-flood.cjs <tenant-id-hex>
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { MongoClient, ObjectId } = require('mongodb');

const tenantId = process.argv[2];
if (!tenantId) {
  console.error('Usage: node scripts/verify-flood.cjs <tenant-id-hex>');
  process.exit(1);
}

const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/factory_inventory';
const DB_NAME = process.env.MONGO_DB_NAME || (() => {
  const m = /^mongodb(?:\+srv)?:\/\/[^/]+\/([^/?]+)/i.exec(MONGO_URI);
  return m ? decodeURIComponent(m[1]) : 'factory_inventory';
})();

async function main() {
  const client = new MongoClient(MONGO_URI);
  await client.connect();
  const db = client.db(DB_NAME);
  const count = (name, filter = {}) => db.collection(name).countDocuments({ tenant_id: tenantId, ...filter });

  const report = {
    products: await count('products'),
    batches: await count('batches'),
    qr_labels: await count('qr_labels'),
    dispatch_orders: await count('dispatch_orders'),
    loading_sessions: await count('loading_sessions'),
    scan_events: await count('loading_scan_events'),
    labels_reserved: await count('qr_labels', { dispatch_order_id: { $type: 'objectId' } }),
    batches_dispatched: await count('batches', { status: 'DISPATCHED' }),
    batches_qc_passed: await count('batches', { status: 'QC_PASSED' }),
    sessions_closed: await count('loading_sessions', { status: 'CLOSED' }),
  };

  const order = await db.collection('dispatch_orders').findOne({ tenant_id: tenantId });
  const label = await db.collection('qr_labels').findOne({ tenant_id: tenantId });
  const batch = await db.collection('batches').findOne({ tenant_id: tenantId });
  report.sample = {
    order_number: order?.order_number,
    order_lines: order?.order_lines?.length,
    order_status: order?.status,
    label_dispatch_id: label?.dispatch_order_id ? String(label.dispatch_order_id) : null,
    label_qr: label?.qr_value,
    batch_status: batch?.status,
    batch_number: batch?.batch_number,
  };

  // Reference integrity on a bounded sample.
  const sampleBatches = await db.collection('batches').find({ tenant_id: tenantId }).limit(500).toArray();
  const productIds = new Set((await db.collection('products').find({ tenant_id: tenantId }, { projection: { _id: 1 } }).toArray()).map((p) => String(p._id)));
  report.sample_orphan_batches = sampleBatches.filter((b) => !productIds.has(String(b.product_id))).length;

  console.log(JSON.stringify(report, null, 2));
  await client.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
