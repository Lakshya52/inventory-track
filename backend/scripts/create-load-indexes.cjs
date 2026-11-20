/** One-off: create the large-workspace indexes without restarting the API. */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { MongoClient } = require('mongodb');

const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/factory_inventory';
const DB_NAME = process.env.MONGO_DB_NAME || (() => {
  const m = /^mongodb(?:\+srv)?:\/\/[^/]+\/([^/?]+)/i.exec(MONGO_URI);
  return m ? decodeURIComponent(m[1]) : 'factory_inventory';
})();

const INDEXES = [
  ['qr_labels', { tenant_id: 1, dispatch_order_id: 1 }],
  ['batches', { tenant_id: 1, shelf_location_id: 1, status: 1 }],
  ['batches', { tenant_id: 1, status: 1, created_at: -1 }],
  ['dispatch_orders', { tenant_id: 1, status: 1, dispatched_at: 1 }],
];

(async () => {
  const client = new MongoClient(MONGO_URI);
  await client.connect();
  const db = client.db(DB_NAME);
  for (const [name, keys] of INDEXES) {
    const result = await db.collection(name).createIndex(keys);
    console.log(`${name}: ${result}`);
  }
  await client.close();
})().catch((error) => { console.error(error); process.exit(1); });
