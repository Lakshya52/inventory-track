/**
 * Flood the configured MongoDB with realistic factory data for load testing.
 *
 * NEVER started by the app — run it yourself:
 *   cd backend
 *   npx tsx ../backend/scripts/flood-database.cjs --smoke        # tiny rehearsal
 *   node scripts/flood-database.cjs --days=30 --bags-per-day=6000 --orders-per-day=40
 *   node scripts/flood-database.cjs --cleanup --yes              # remove flood tenants
 *
 * 150 tons/day at 25 kg/bag = 6,000 bags/day. The defaults above generate a
 * full month (~180,000 bags, QR labels, batches, QC records, dispatch orders,
 * loading sessions and scan events) in a NEW tenant, so real data is untouched.
 *
 * Options: --days --bags-per-day --families --grades-per-family
 *          --orders-per-day --bags-per-order --tenant-id=<hex> --cleanup --yes
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { MongoClient, ObjectId } = require('mongodb');
const bcrypt = require('bcryptjs');
const { randomUUID, randomBytes } = require('crypto');

const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/factory_inventory';
const DB_NAME = process.env.MONGO_DB_NAME || (() => {
  const m = /^mongodb(?:\+srv)?:\/\/[^/]+\/([^/?]+)/i.exec(MONGO_URI);
  return m ? decodeURIComponent(m[1]) : 'factory_inventory';
})();

const args = Object.fromEntries(
  process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => {
    const [key, ...rest] = a.slice(2).split('=');
    return [key, rest.length ? rest.join('=') : '1'];
  })
);

function num(name, fallback) {
  const value = Number(args[name]);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

const SMOKE = Boolean(args.smoke);
const DAYS = SMOKE ? 1 : num('days', 30);
const BAGS_PER_DAY = SMOKE ? 100 : num('bags-per-day', 6000); // 150 t/day @ 25 kg
const FAMILIES = SMOKE ? 2 : num('families', 10);
const GRADES_PER_FAMILY = SMOKE ? 5 : num('grades-per-family', 20);
const ORDERS_PER_DAY = SMOKE ? 3 : num('orders-per-day', 40);
const BAGS_PER_ORDER = SMOKE ? 10 : num('bags-per-order', 50);
const CHUNK = 4000;

const FAMILY_NAMES = [
  'LLDPE COMPOUND', 'HDPE COMPOUND', 'MDPE COMPOUND', 'PVC COMPOUND',
  'XLPE BK COMPOUND', 'CPE COMPOUND', 'HFFR COMPOUND', 'TPE COMPOUND',
  'PEX COMPOUND', 'EPR COMPOUND', 'EVA COMPOUND', 'ABS COMPOUND',
];
const FAMILY_CODES = ['LLD', 'HDP', 'MDP', 'PVC', 'XBK', 'CPE', 'HFR', 'TPE', 'PEX', 'EPR', 'EVA', 'ABS'];
const COLORS = ['BK', 'WH', 'RD', 'BL', 'GR', 'YE'];

const oid = () => new ObjectId();
const stamp = () => Date.now().toString(36);
const dayDate = (index) => {
  const d = new Date();
  d.setUTCHours(8, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - (DAYS - 1 - index));
  return d;
};
const dateStamp = (d) => d.toISOString().slice(0, 10).replace(/-/g, '');
const addDays = (d, n) => new Date(d.getTime() + n * 86_400_000);

async function insertChunks(collection, docs, label, totals) {
  if (!docs.length) return;
  for (let i = 0; i < docs.length; i += CHUNK) {
    await collection.insertMany(docs.slice(i, i + CHUNK), { ordered: false });
  }
  totals[label] = (totals[label] || 0) + docs.length;
}

async function cleanup(db) {
  const tenants = await db.collection('tenants').find({ name: /^FLOOD TEST / }).toArray();
  if (!tenants.length) {
    console.log('No FLOOD TEST tenants found.');
    return;
  }
  const collections = [
    'activity_logs', 'loading_scan_events', 'loading_sessions', 'dispatch_records',
    'qc_records', 'dispatch_orders', 'packing_list_items', 'qr_labels', 'qr_print_jobs',
    'batch_groups', 'batches', 'products', 'grades', 'uoms', 'bag_quantities',
    'clients', 'vendors', 'warehouses', 'storage_racks', 'shelf_locations', 'counters',
    'admins', 'qc_users', 'dispatch_users',
  ];
  for (const tenant of tenants) {
    const tenantId = String(tenant._id);
    for (const name of collections) {
      await db.collection(name).deleteMany({ tenant_id: tenantId });
    }
    await db.collection('counters').deleteMany({ _id: { $regex: `^${tenantId}:` } });
    await db.collection('tenants').deleteOne({ _id: tenant._id });
    console.log(`Removed flood tenant ${tenant.name} (${tenantId})`);
  }
}

async function main() {
  const client = new MongoClient(MONGO_URI, { maxPoolSize: 30 });
  await client.connect();
  const db = client.db(DB_NAME);
  console.log(`MongoDB ${MONGO_URI} → ${DB_NAME}`);

  if (args['list-tenants']) {
    const rows = await db.collection('tenants').find({}, { projection: { name: 1, email: 1 } }).toArray();
    for (const t of rows) console.log(`${String(t._id)}  ${t.name}  ${t.email || ''}`);
    await client.close();
    return;
  }

  if (args.cleanup) {
    await cleanup(db);
    await client.close();
    return;
  }

  const tag = stamp();
  const tenantHex = args['tenant-id'] || null;
  const createdTenant = !tenantHex;
  // When joining an existing workspace, tag generated names to avoid clashing
  // with that tenant's real masters and unique indexes.
  const suffix = tenantHex ? tag.toUpperCase() : '';
  let tenantId = tenantHex;
  const adminEmail = `flood-admin-${tag}@example.test`;
  const qcEmail = `flood-qc-${tag}@example.test`;
  const dispatchEmail = `flood-dispatch-${tag}@example.test`;

  if (!tenantId) {
    const tenantOid = oid();
    tenantId = tenantOid.toHexString();
    await db.collection('tenants').insertOne({
      _id: tenantOid,
      name: `FLOOD TEST ${new Date().toISOString()}`,
      email: adminEmail,
      email_key: adminEmail.toLowerCase().replace(/[^a-z0-9]/g, ''),
      phone: '9000000999',
      slug: `flood-${tag}`,
      printer_label_width_mm: 60,
      printer_label_height_mm: 64,
      is_active: 1,
      created_at: new Date(),
      updated_at: new Date(),
    });
    const hash = (pw) => bcrypt.hashSync(pw, 8);
    await db.collection('admins').insertOne({ _id: oid(), name: 'Flood Admin', email: adminEmail, password_hash: hash('admin@123'), is_active: 1, tenant_id: tenantId, division_id: null, created_at: new Date() });
    await db.collection('qc_users').insertOne({ _id: oid(), name: 'Flood QC', email: qcEmail, password_hash: hash('qc@123'), is_active: 1, tenant_id: tenantId, division_id: null, created_at: new Date() });
    await db.collection('dispatch_users').insertOne({ _id: oid(), name: 'Flood Dispatch', email: dispatchEmail, password_hash: hash('dispatch@123'), is_active: 1, tenant_id: tenantId, division_id: null, created_at: new Date() });
    console.log(`Created tenant ${tenantId}`);
  } else {
    console.log(`Flooding existing tenant ${tenantId}`);
  }

  // --- masters -------------------------------------------------------------
  const admin = await db.collection('admins').findOne({ tenant_id: tenantId });
  const qc = await db.collection('qc_users').findOne({ tenant_id: tenantId });
  const dispatch = await db.collection('dispatch_users').findOne({ tenant_id: tenantId });
  if (!admin || !qc || !dispatch) throw new Error('Tenant is missing admin/qc/dispatch users — aborting');

  let divisionDocs = await db.collection('divisions').find({ tenant_id: tenantId }).toArray();
  if (!divisionDocs.length) {
    const rows = [1, 2, 3].map((i) => ({
      _id: oid(), tenant_id: tenantId, name: `Flood Division ${i}`,
      description: `Load-test division ${i}`, is_active: 1, created_at: new Date(), updated_at: new Date(),
    }));
    await db.collection('divisions').insertMany(rows);
    divisionDocs = rows;
  }
  const divisions = divisionDocs.map((d) => String(d._id));

  let uomDoc = await db.collection('uoms').findOne({ tenant_id: tenantId, name: 'Kg' });
  if (!uomDoc) {
    uomDoc = { _id: oid(), tenant_id: tenantId, name: 'Kg', is_active: 1, created_at: new Date(), updated_at: new Date() };
    await db.collection('uoms').insertOne(uomDoc);
  }
  let bagDoc = await db.collection('bag_quantities').findOne({ tenant_id: tenantId, name: '25 Kg' });
  if (!bagDoc) {
    bagDoc = { _id: oid(), tenant_id: tenantId, name: '25 Kg', quantity: 25, unit: 'Kg', is_active: 1, created_at: new Date(), updated_at: new Date() };
    await db.collection('bag_quantities').insertOne(bagDoc);
  }

  const vendorDocs = Array.from({ length: 5 }, (_, i) => ({
    _id: oid(), tenant_id: tenantId, vendor_code: `FLD-${tag}-V${i + 1}`,
    name: `Flood Vendor ${i + 1}`, category: 'Raw material', is_active: 1, created_at: new Date(),
  }));
  await db.collection('vendors').insertMany(vendorDocs);

  const clientDocs = Array.from({ length: 12 }, (_, i) => ({
    _id: oid(), tenant_id: tenantId, name: `Flood Client ${i + 1}`,
    contact_person: `Contact ${i + 1}`, phone: `9000000${String(i).padStart(3, '0')}`,
    is_active: 1, created_at: new Date(),
  }));
  await db.collection('clients').insertMany(clientDocs);

  // Warehouse → racks → shelf locations (a bounded pool reused across bags).
  const locationPool = [];
  const warehouseDocs = [];
  const rackDocs = [];
  for (let w = 0; w < 2; w += 1) {
    const warehouseId = oid();
    warehouseDocs.push({ _id: warehouseId, tenant_id: tenantId, name: `Flood Godown ${w + 1}${suffix ? ` ${suffix}` : ''}`, capacity: BAGS_PER_DAY * DAYS, is_active: 1, division_id: divisions[w % divisions.length], created_at: new Date(), updated_at: new Date() });
    for (let r = 0; r < 2; r += 1) {
      const rackId = oid();
      const cells = [];
      for (let row = 1; row <= 10; row += 1) {
        for (let col = 1; col <= 10; col += 1) {
          const locationId = oid();
          const code = `FLD-${suffix ? `${suffix}-` : ''}${w + 1}-${r + 1}-${String(row).padStart(2, '0')}-${String(col).padStart(2, '0')}`;
          locationPool.push({ id: locationId, code });
          cells.push({ row, column: col, cell_code: `${w + 1}${r + 1}-${row}-${col}`, shelf_location_id: locationId, location_code: code });
        }
      }
      rackDocs.push({ _id: rackId, tenant_id: tenantId, warehouse_id: warehouseId, rack_code: `F-RACK-${w + 1}-${r + 1}${suffix ? `-${suffix}` : ''}`, rows: 10, columns: 10, cells, division_id: divisions[w % divisions.length], created_at: new Date(), updated_at: new Date() });
    }
  }
  await db.collection('warehouses').insertMany(warehouseDocs);
  await db.collection('storage_racks').insertMany(rackDocs);
  await db.collection('shelf_locations').insertMany(locationPool.map((loc) => ({
    _id: loc.id, tenant_id: tenantId, location_code: loc.code,
    description: `Flood test position ${loc.code}`, warehouse: `Flood Godown`, rack: 'F-RACK',
    shelf: loc.code, is_active: 1, division_id: divisions[0], created_at: new Date(), updated_at: new Date(),
  })));

  // Product families + grades (one product document per grade, as the app does).
  const gradesDocs = [];
  const productDocs = [];
  const productsByFamily = {};
  for (let f = 0; f < FAMILIES; f += 1) {
    const family = FAMILY_NAMES[f % FAMILY_NAMES.length];
    const code = FAMILY_CODES[f % FAMILY_CODES.length];
    productsByFamily[family] = [];
    for (let g = 1; g <= GRADES_PER_FAMILY; g += 1) {
      const gradeName = `${code} ${COLORS[(g - 1) % COLORS.length]} ${String(g).padStart(4, '0')}${suffix ? ` ${suffix}` : ''}`;
      const productId = oid();
      gradesDocs.push({ _id: oid(), tenant_id: tenantId, division_id: divisions[f % divisions.length], name: gradeName, is_active: 1, created_at: new Date() });
      productDocs.push({
        _id: productId, tenant_id: tenantId, division_id: divisions[f % divisions.length],
        name: family, grade: gradeName, sku: `FLD-${code}${suffix ? `-${suffix}` : ''}-${String(g).padStart(5, '0')}`,
        description: 'Flood-test product', manufacturer: 'SELF (KLJ)', price: 100, quantity: BAGS_PER_DAY * DAYS,
        bag_quantity_id: bagDoc._id, is_active: 1, created_at: new Date(), updated_at: new Date(),
      });
      productsByFamily[family].push({ id: productId, grade: gradeName, sku: `FLD-${code}${suffix ? `-${suffix}` : ''}-${String(g).padStart(5, '0')}` });
    }
  }
  await db.collection('grades').insertMany(gradesDocs);
  await db.collection('products').insertMany(productDocs);
  console.log(`Masters ready: ${FAMILIES} families / ${productDocs.length} grades, ${locationPool.length} storage positions`);

  // --- transactional-style fact data ---------------------------------------
  const totals = {};
  const year = new Date().getUTCFullYear();
  const counterKey = `${tenantId}:dispatch_order:${year}`;
  const counter = await db.collection('counters').findOne({ _id: counterKey });
  let orderSeq = Number(counter?.seq || 0);

  const targetDispatched = ORDERS_PER_DAY * BAGS_PER_ORDER;
  for (let day = 0; day < DAYS; day += 1) {
    const d = dayDate(day);
    const dayStamp = dateStamp(d);
    const mfg = addDays(d, -2);
    const exp = addDays(d, 180);
    const bagsToday = BAGS_PER_DAY;
    const bagsPerFamily = Math.floor(bagsToday / FAMILIES);
    const bags = [];

    const groups = [];
    const jobs = [];
    const batches = [];
    const batchById = new Map();
    const labels = [];
    const qcRecords = [];

    for (let f = 0; f < FAMILIES; f += 1) {
      const family = FAMILY_NAMES[f % FAMILY_NAMES.length];
      const groupId = oid();
      const groupNumber = `FLOOD-${dayStamp}-${randomBytes(3).toString('hex').toUpperCase()}`;
      const jobId = oid();
      const jobCode = `QRJ-${dayStamp}-${randomBytes(3).toString('hex').toUpperCase()}`;
      const division = divisions[f % divisions.length];
      groups.push({
        _id: groupId, group_key: groupId.toHexString(), batch_number: groupNumber,
        tenant_id: tenantId, division_id: division, created_by: dispatch._id,
        product_count: GRADES_PER_FAMILY, total_quantity: bagsPerFamily,
        status: 'QC_PASSED', client_operation_id: randomUUID(),
        created_at: d, updated_at: d,
      });
      jobs.push({
        _id: jobId, job_code: jobCode, product_id: productsByFamily[family][0].id,
        quantity: bagsPerFamily, created_by: dispatch._id, created_by_role: 'DISPATCH',
        tenant_id: tenantId, division_id: division, created_at: d,
      });
      const products = productsByFamily[family];
      for (let b = 0; b < bagsPerFamily; b += 1) {
        const product = products[b % products.length];
        const serial = b + 1;
        const batchId = oid();
        const labelId = oid();
        const location = locationPool[(day * bagsToday + f * bagsPerFamily + b) % locationPool.length];
        const batchNumber = `${product.sku}-${dayStamp}-${groupId.toHexString().slice(0, 6)}-${String((b % products.length) + 1).padStart(2, '0')}-${String(serial).padStart(4, '0')}`;
        const qrValue = `${jobCode}-${String(serial).padStart(4, '0')}`;
        const batchDoc = {
          _id: batchId, tenant_id: tenantId, division_id: division,
          product_id: product.id, batch_group_id: groupId, parent_batch_number: groupNumber,
          batch_number: batchNumber, barcode_value: `QC:${randomUUID()}`, quantity: 1,
          uom: 'Kg', package_quantity: 25, avg_standard_quantity: null, unit_price: 100,
          manufacturing_date: mfg, expiry_date: exp,
          shelf_location_id: location.id, storage_location: location.code,
          status: 'QC_PASSED', created_at: d, updated_at: d,
        };
        batches.push(batchDoc);
        batchById.set(batchId.toHexString(), batchDoc);
        const label = {
          _id: labelId, tenant_id: tenantId, division_id: division,
          print_job_id: jobId, batch_id: batchId, qr_value: qrValue, serial_no: serial,
          print_count: 1, last_printed_at: d, dispatch_order_id: null,
          recall_status: null, created_at: d,
        };
        labels.push(label);
        qcRecords.push({
          _id: oid(), tenant_id: tenantId, division_id: division,
          batch_id: batchId, tester_id: qc._id, result: 'PASS', method: 'MANUAL_REVIEW',
          remarks: 'Flood test QC', created_at: d,
        });
        bags.push({ batchId, batchNumber, labelId, productId: product.id, grade: product.grade, sku: product.sku, division, qrValue, location: location.code, label });
      }
    }

    // Dispatch a slice of today's stock, in order-sized chunks.
    const dispatchCount = Math.min(bags.length, targetDispatched);
    const orders = [];
    const sessions = [];
    const scanEvents = [];
    const dispatchRecords = [];
    const packingItems = [];
    const activities = [];
    const dispatchBags = bags.slice(0, dispatchCount);
    // A dispatched bag reaches its terminal status at finalise() time.
    for (const bag of dispatchBags) {
      const batchDoc = batchById.get(String(bag.batchId));
      if (batchDoc) {
        batchDoc.status = 'DISPATCHED';
        batchDoc.dispatched_quantity = 1;
        batchDoc.updated_at = d;
      }
    }
    for (let o = 0; o < ORDERS_PER_DAY && o * BAGS_PER_ORDER < dispatchBags.length; o += 1) {
      const selected = dispatchBags.slice(o * BAGS_PER_ORDER, (o + 1) * BAGS_PER_ORDER);
      if (!selected.length) break;
      orderSeq += 1;
      const orderId = oid();
      const sessionId = oid();
      const client = clientDocs[(day + o) % clientDocs.length];
      const orderNumber = `DO-${year}-${String(orderSeq).padStart(6, '0')}`;
      const division = selected[0].division;
      const lines = selected.map((bag) => ({
        batch_id: bag.batchId, batch_number: bag.batchNumber,
        product_name: bag.grade, product_sku: bag.sku, quantity: 1, uom: 'Kg',
        location: bag.location, location_code: bag.location, location_description: bag.location,
      }));
      const gradeName = [...new Set(selected.map((bag) => bag.grade))].join(', ');
      const sealNumber = `FLD-SEAL-${dayStamp}-${String(o + 1).padStart(3, '0')}`;

      orders.push({
        _id: orderId, tenant_id: tenantId, division_id: division,
        batch_id: selected[0].batchId, order_number: orderNumber, order_lines: lines,
        raised_by: dispatch._id, status: 'CLOSED_DISPATCHED', admin_id: null,
        approved_by_role: 'DISPATCH', approved_by_id: dispatch._id, approved_at: d,
        client_id: client._id, quantity: lines.length, stock_reserved_at_order: d,
        scheduled_dispatch_at: null, client_operation_id: randomUUID(),
        client_created_at: d, device_uuid: 'flood-script',
        driver_name: `Flood Driver ${o + 1}`, driver_phone: '9000000123',
        vehicle_number: `MH12FL${String(o).padStart(4, '0')}`,
        container_number: `CNTR-FLD-${o + 1}`, seal_number: sealNumber, outcome: 'DISPATCHED',
        dispatched_at: addDays(d, 0), remarks: 'Flood test order',
        created_at: d, updated_at: d,
      });
      sessions.push({
        _id: sessionId, tenant_id: tenantId, division_id: division,
        dispatch_order_id: orderId, order_number: orderNumber,
        batch_id: selected[0].batchId, batch_ids: [...new Set(selected.map((b) => b.batchId))],
        order_lines: lines, grade_name: gradeName, loader_id: dispatch._id,
        status: 'CLOSED', total: lines.length, scanned: lines.length,
        seal_number: sealNumber, outcome: 'DISPATCHED', remarks: 'Flood test session',
        started_at: d, completed_at: addDays(d, 0), created_at: d, updated_at: d,
      });
      for (const [index, line] of lines.entries()) {
        const bag = selected[index];
        bag.label.dispatch_order_id = orderId;
        scanEvents.push({
          _id: oid(), tenant_id: tenantId, division_id: division,
          session_id: sessionId, qr_value: bag.qrValue, batch_id: bag.batchId,
          result: 'OK', scanned_by: dispatch._id,
          scanned_at: new Date(d.getTime() + index * 1000), created_at: d,
        });
        packingItems.push({
          _id: oid(), tenant_id: tenantId, division_id: division,
          dispatch_order_id: orderId, ...line, created_at: d,
        });
      }
      dispatchRecords.push({
        _id: oid(), tenant_id: tenantId, division_id: division,
        batch_id: selected[0].batchId, dispatch_order_id: orderId, session_id: sessionId,
        dispatched: 1, dispatcher_id: dispatch._id, remarks: 'Flood test dispatch',
        client_operation_id: randomUUID(), created_at: d,
      });
      activities.push({
        _id: oid(), tenant_id: tenantId, division_id: division,
        user_id: dispatch._id, user_name: 'Flood Dispatch', user_role: 'DISPATCH',
        action: 'DISPATCH_ORDER_CREATED', description: `Flood order ${orderNumber} with ${lines.length} units`,
        created_at: d,
      });
    }

    await insertChunks(db.collection('batch_groups'), groups, 'batch_groups', totals);
    await insertChunks(db.collection('qr_print_jobs'), jobs, 'qr_print_jobs', totals);
    await insertChunks(db.collection('batches'), batches, 'batches', totals);
    await insertChunks(db.collection('qr_labels'), labels, 'qr_labels', totals);
    await insertChunks(db.collection('qc_records'), qcRecords, 'qc_records', totals);
    await insertChunks(db.collection('dispatch_orders'), orders, 'dispatch_orders', totals);
    await insertChunks(db.collection('loading_sessions'), sessions, 'loading_sessions', totals);
    await insertChunks(db.collection('loading_scan_events'), scanEvents, 'loading_scan_events', totals);
    await insertChunks(db.collection('dispatch_records'), dispatchRecords, 'dispatch_records', totals);
    await insertChunks(db.collection('packing_list_items'), packingItems, 'packing_list_items', totals);
    await insertChunks(db.collection('activity_logs'), activities, 'activity_logs', totals);

    console.log(`Day ${day + 1}/${DAYS} (${dayStamp}): ${bags.length} bags, ${orders.length} orders, ${scanEvents.length} scans`);
  }

  await db.collection('counters').updateOne(
    { _id: counterKey },
    { $set: { seq: orderSeq, tenant_id: tenantId, year, updated_at: new Date() } },
    { upsert: true }
  );

  console.log('\n=== Flood complete ===');
  for (const [name, count] of Object.entries(totals)) console.log(`${name.padEnd(22)} ${count.toLocaleString()}`);
  console.log(`products                ${productDocs.length.toLocaleString()}`);
  console.log(`grades                  ${gradesDocs.length.toLocaleString()}`);
  console.log(`storage locations       ${locationPool.length.toLocaleString()}`);
  if (createdTenant) {
    console.log('\nLogin with the new tenant:');
    console.log(`  admin    ${adminEmail} / admin@123`);
    console.log(`  qc       ${qcEmail} / qc@123`);
    console.log(`  dispatch ${dispatchEmail} / dispatch@123`);
  }
  console.log('\nCleanup dedicated test tenants: node scripts/flood-database.cjs --cleanup --yes');
  await client.close();
}

main().catch((error) => {
  console.error('Flood failed:', error);
  process.exit(1);
});
