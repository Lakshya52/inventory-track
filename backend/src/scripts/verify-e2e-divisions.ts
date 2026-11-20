import 'dotenv/config';

/**
 * End-to-end division lifecycle probe.
 *
 * Boots nothing itself: point BASE_URL at a running API instance whose
 * database contains ONLY test data. Exercises the full operational chain —
 * warehouse/rack, product, dispatch batch group, QC decision, QR print,
 * dispatch order — for two divisions of one tenant and asserts isolation at
 * every step (read, write, and cross-division reference safety).
 *
 * Exit code 0 = all checks passed, 1 = at least one failure.
 */

const BASE = process.env.BASE_URL || 'http://127.0.0.1:3016';

let failures = 0;
let checks = 0;

function report(ok: boolean, label: string, detail?: string): void {
  checks += 1;
  if (ok) {
    console.log(`  PASS  ${label}`);
  } else {
    failures += 1;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

async function api(token: string | null, method: string, path: string, body?: unknown, division?: string | number | null) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (division !== undefined && division !== null && String(division) !== 'all') headers['X-Division-Id'] = String(division);
  const res = await fetch(`${BASE}/api${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { status: res.status, json };
}

const today = () => new Date().toISOString().slice(0, 10);
const expiry = () => new Date(Date.now() + 180 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

async function main(): Promise<void> {
  console.log(`End-to-end division lifecycle probe against ${BASE}`);
  const stamp = Math.random().toString(16).slice(2, 8);

  console.log('\n[1] Tenant, divisions, division users');
  const reg = await api(null, 'POST', '/auth/register', {
    name: 'E2E Admin', companyName: `E2ETenant${stamp} Industries`, mobile: '9000000301',
    email: `e2e-admin-${stamp}@isolation-test.local`, password: 'e2e-admin-password-1',
  });
  report(reg.status === 201, 'register tenant', `status ${reg.status}`);
  if (reg.status !== 201) process.exit(1);
  const admin = reg.json.token as string;

  const trp = await api(admin, 'POST', '/divisions', { name: `TRP-${stamp}` });
  const xcle = await api(admin, 'POST', '/divisions', { name: `XCLE-${stamp}` });
  report(trp.status === 201 && xcle.status === 201, 'create TRP and XCLE divisions');
  const trpId: string | number = trp.json?.id;
  const xcleId: string | number = xcle.json?.id;

  const mkUser = (suffix: string) => ({
    name: `E2E ${suffix}`, email: `e2e-${suffix.toLowerCase()}-${stamp}@isolation-test.local`,
    password: `e2e-${suffix.toLowerCase()}-password-1`,
  });
  const qcTrpRes = await api(admin, 'POST', '/users', { ...mkUser('QCTRP'), role: 'QC', division_id: trpId });
  const qcXcleRes = await api(admin, 'POST', '/users', { ...mkUser('QCXCLE'), role: 'QC', division_id: xcleId });
  const dspTrpRes = await api(admin, 'POST', '/users', { ...mkUser('DSPTRP'), role: 'DISPATCH', division_id: trpId });
  const dspXcleRes = await api(admin, 'POST', '/users', { ...mkUser('DSPXCLE'), role: 'DISPATCH', division_id: xcleId });
  report(qcTrpRes.status === 201 && qcXcleRes.status === 201 && dspTrpRes.status === 201 && dspXcleRes.status === 201, 'create two QC + two Dispatch users with division assignment');

  const login = async (suffix: string) => {
    const res = await api(null, 'POST', '/auth/login', { email: `e2e-${suffix}-${stamp}@isolation-test.local`, password: `e2e-${suffix}-password-1` });
    return res.json?.token as string;
  };
  const qcTrp = await login('qctrp');
  const qcXcle = await login('qcxcle');
  const dspTrp = await login('dsptrp');
  const dspXcle = await login('dspxcle');
  report(Boolean(qcTrp && qcXcle && dspTrp && dspXcle), 'all four users can log in');

  console.log('\n[2] Per-division warehouse, rack, product');
  const trpWarehouse = await api(admin, 'POST', '/storage', { name: `E2EWH-${stamp}-T`, capacity: 50 }, trpId);
  const xcleWarehouse = await api(admin, 'POST', '/storage', { name: `E2EWH-${stamp}-X`, capacity: 50 }, xcleId);
  report(trpWarehouse.status === 201 || trpWarehouse.status === 200, 'admin creates TRP warehouse', `status ${trpWarehouse.status}`);
  report(xcleWarehouse.status === 201 || xcleWarehouse.status === 200, 'admin creates XCLE warehouse', `status ${xcleWarehouse.status}`);
  const xcleWarehouseId: string | number = xcleWarehouse.json?.id ?? xcleWarehouse.json?.warehouse?.id;

  const trpWarehouseId: string | number = trpWarehouse.json?.id ?? trpWarehouse.json?.warehouse?.id;
  const trpRack = await api(admin, 'POST', `/storage/${trpWarehouseId}/racks`, { name: 'R1', rows: 2, columns: 4 }, trpId);
  report(trpRack.status === 201 || trpRack.status === 200, 'admin creates TRP rack (2x4 cells)', `status ${trpRack.status} ${JSON.stringify(trpRack.json)}`);
  const trpShelfId = trpRack.json?.cells?.[0]?.shelf_location_id;
  report(Boolean(trpShelfId), 'rack cells expose a shelf_location_id');

  const xcleProduct = await api(admin, 'POST', '/products', { name: `E2EXCLEProduct ${stamp}`, sku: `E2E-XCLE-${stamp}`, quantity: 5 }, xcleId);
  const trpProduct = await api(admin, 'POST', '/products', { name: `E2ETRPProduct ${stamp}`, sku: `E2E-TRP-${stamp}`, quantity: 5 }, trpId);
  report(trpProduct.status === 201, 'admin creates TRP product');
  report(xcleProduct.status === 201, 'admin creates XCLE product');
  const trpProductId = trpProduct.json?.id ?? trpProduct.json?.products?.[0]?.id;

  console.log('\n[3] Cross-division references are rejected');
  const xcleRefBatch = await api(dspTrp, 'POST', '/batches/group', {
    items: [{ product_id: trpProductId, quantity: 2, package_quantity: 1, uom: 'pcs', shelf_location_id: null, warehouse_id: xcleWarehouseId, manufacturing_date: today(), expiry_date: expiry() }],
  }, trpId);
  report(xcleRefBatch.status === 400 || xcleRefBatch.status === 404, 'DSP/TRP cannot assign XCLE warehouse to a TRP batch', `status ${xcleRefBatch.status}`);

  console.log('\n[4] Full chain in TRP: batch -> QC pass -> print -> dispatch order');
  const batch = await api(dspTrp, 'POST', '/batches/group', {
    items: [{ product_id: trpProductId, quantity: 2, package_quantity: 1, uom: 'pcs', shelf_location_id: trpShelfId, warehouse_id: trpWarehouseId, manufacturing_date: today(), expiry_date: expiry() }],
  }, trpId);
  report(batch.status === 201 || batch.status === 200, 'DSP/TRP creates batch group', `status ${batch.status} ${JSON.stringify(batch.json)}`);
  const groupKey = batch.json?.id ?? batch.json?.batch_group_id;
  const batchId = batch.json?.batches?.[0]?.batch_id;
  const printJobId = batch.json?.batches?.[0]?.qr_job?.id ?? batch.json?.batches?.[0]?.labels?.[0]?.print_job_id;
  report(Boolean(groupKey && batchId), 'batch response carries group key and batch id');

  const dspXclePending = await api(dspXcle, 'GET', '/batches');
  report(JSON.stringify(dspXclePending.json).includes(`E2ETRPProduct`) === false, 'DSP/XCLE cannot see TRP batches');

  const qcTrpPending = await api(qcTrp, 'GET', '/qc/pending');
  report(JSON.stringify(qcTrpPending.json).includes(`${stamp}`), 'QC/TRP sees the TRP batch in QC pending');

  const qcXclePending = await api(qcXcle, 'GET', '/qc/pending');
  report(JSON.stringify(qcXclePending.json).includes(`${stamp}`) === false, 'QC/XCLE does not see the TRP batch in QC pending');

  const xcleDecide = await api(qcXcle, 'POST', `/qc/batch-groups/${groupKey}/decision`, { result: 'PASS' });
  report(xcleDecide.status === 404, 'QC/XCLE cannot decide the TRP batch', `status ${xcleDecide.status}`);

  const printJobProbe = await api(qcXcle, 'POST', `/qc/qr-jobs/${printJobId}/print`, {});
  report(printJobProbe.status === 404 || printJobProbe.status === 403 || printJobProbe.status === 410, 'QC/XCLE cannot print the TRP QR job', `status ${printJobProbe.status}`);

  const trpClient = await api(admin, 'POST', '/clients', { name: `E2EClient ${stamp}`, phone: '9000000304' });
  report(trpClient.status === 201 || trpClient.status === 200, 'admin creates client', `status ${trpClient.status} ${JSON.stringify(trpClient.json)}`);
  const clientId = trpClient.json?.id;

  const trpDecision = await api(qcTrp, 'POST', `/qc/batch-groups/${groupKey}/decision`, { result: 'PASS', remarks: 'ok' });
  report(trpDecision.status === 200 || trpDecision.status === 201, 'QC/TRP passes the TRP batch', `status ${trpDecision.status} ${JSON.stringify(trpDecision.json)}`);

  const printResult = await api(dspTrp, 'POST', `/qc/qr-jobs/${printJobId}/print`, {});
  report(printResult.status === 200 || printResult.status === 201, 'TRP print job succeeds after QC pass', `status ${printResult.status} ${JSON.stringify(printResult.json)}`);

  const xcleOrderBody = { batch_id: batchId, driver_name: 'E2E Driver', driver_phone: '9000000302', vehicle_number: `MH12TRP${stamp}`, container_number: `CONT${stamp}`, client_id: clientId, quantity: 1 };
  const xcleRaise = await api(dspXcle, 'POST', '/dispatch-orders', xcleOrderBody);
  report(xcleRaise.status === 404 || xcleRaise.status === 400, 'DSP/XCLE cannot raise an order against the TRP batch', `status ${xcleRaise.status}`);

  const trpRaise = await api(dspTrp, 'POST', '/dispatch-orders', xcleOrderBody);
  report(trpRaise.status === 201 || trpRaise.status === 200, 'DSP/TRP raises the dispatch order', `status ${trpRaise.status} ${JSON.stringify(trpRaise.json)}`);

  console.log('\n[5] Post-chain visibility');
  const dspTrpOrders = await api(dspTrp, 'GET', '/dispatch-orders/mine');
  report(JSON.stringify(dspTrpOrders.json).includes(`${stamp}`), 'DSP/TRP sees the dispatch order');
  const dspXcleOrders = await api(dspXcle, 'GET', '/dispatch-orders');
  report(JSON.stringify(dspXcleOrders.json).includes(`${stamp}`) === false, 'DSP/XCLE does not see the TRP dispatch order');

  console.log(`\n${checks} checks, ${failures} failure(s)`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error('E2E probe crashed:', error);
  process.exit(1);
});
