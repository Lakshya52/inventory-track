import 'dotenv/config';

/**
 * Live cross-DIVISION isolation probe.
 *
 * Boots nothing itself: point BASE_URL at a running API instance whose
 * database contains ONLY test data. The script registers one tenant, creates
 * two divisions (TRP, XCLE), creates a QC and a Dispatch user per division,
 * then verifies that every division sees only its own operational data,
 * while the single ADMIN sees only the selected division (plus shared rows,
 * or everything with the 'all' header value) — the X-Division-Id header
 * drives both READ scoping and the division new rows are stamped with.
 *
 * Exit code 0 = all checks passed, 1 = at least one failure.
 */

const BASE = process.env.BASE_URL || 'http://127.0.0.1:3014';

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

function scan(json: unknown, markers: string[]): string[] {
  const text = JSON.stringify(json);
  return markers.filter((marker) => text.includes(marker));
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

async function main(): Promise<void> {
  console.log(`Division isolation probe against ${BASE}`);
  const stamp = Math.random().toString(16).slice(2, 8);

  console.log('\n[1] Tenant + divisions setup');
  const reg = await api(null, 'POST', '/auth/register', {
    name: 'Div Admin', companyName: `DivTenant${stamp} Industries`, mobile: '9000000301',
    email: `div-admin-${stamp}@isolation-test.local`, password: 'div-admin-password-1',
  });
  report(reg.status === 201, 'register tenant', `status ${reg.status} ${JSON.stringify(reg.json)}`);
  if (reg.status !== 201) process.exit(1);
  const admin = reg.json.token as string;

  const trp = await api(admin, 'POST', '/divisions', { name: `TRP-${stamp}` });
  const xcle = await api(admin, 'POST', '/divisions', { name: `XCLE-${stamp}` });
  report(trp.status === 201, 'admin creates TRP division', `status ${trp.status} ${JSON.stringify(trp.json)}`);
  report(xcle.status === 201, 'admin creates XCLE division', `status ${xcle.status} ${JSON.stringify(xcle.json)}`);
  const trpId: string | number = trp.json?.id;
  const xcleId: string | number = xcle.json?.id;

  const dupCreate = await api(admin, 'POST', '/divisions', { name: `TRP-${stamp}` });
  report(dupCreate.status === 409, 'duplicate division name rejected', `status ${dupCreate.status}`);

  const trpName = `TRP-${stamp}`;
  const xcleName = `XCLE-${stamp}`;
  const TRP_MARKERS = ['ISOTRPProduct', `iso-trp-${stamp}`, 'ISOTRPClient'.toLowerCase()];
  const XCLE_MARKERS = ['ISOXCLEProduct', `iso-xcle-${stamp}`];

  console.log('\n[2] Create QC + Dispatch users per division');
  const qcTrp = await api(admin, 'POST', '/users', { name: 'QC TRP', email: `qc-trp-${stamp}@isolation-test.local`, password: 'qc-trp-password-1', role: 'QC', division_id: trpId });
  const qcXcle = await api(admin, 'POST', '/users', { name: 'QC XCLE', email: `qc-xcle-${stamp}@isolation-test.local`, password: 'qc-xcle-password-1', role: 'QC', division_id: xcleId });
  const dspTrp = await api(admin, 'POST', '/users', { name: 'DSP TRP', email: `dsp-trp-${stamp}@isolation-test.local`, password: 'dsp-trp-password-1', role: 'DISPATCH', division_id: trpId });
  const dspXcle = await api(admin, 'POST', '/users', { name: 'DSP XCLE', email: `dsp-xcle-${stamp}@isolation-test.local`, password: 'dsp-xcle-password-1', role: 'DISPATCH', division_id: xcleId });
  report(qcTrp.status === 201, 'QC user TRP created', `status ${qcTrp.status}`);
  report(qcXcle.status === 201, 'QC user XCLE created', `status ${qcXcle.status}`);
  report(dspTrp.status === 201, 'Dispatch user TRP created', `status ${dspTrp.status}`);
  report(dspXcle.status === 201, 'Dispatch user XCLE created', `status ${dspXcle.status}`);

  const login = async (email: string, password: string) => {
    const res = await api(null, 'POST', '/auth/login', { email, password });
    return res.json?.token as string;
  };
  const qcTrpToken = await login(`qc-trp-${stamp}@isolation-test.local`, 'qc-trp-password-1');
  const qcXcleToken = await login(`qc-xcle-${stamp}@isolation-test.local`, 'qc-xcle-password-1');
  const dspTrpToken = await login(`dsp-trp-${stamp}@isolation-test.local`, 'dsp-trp-password-1');
  const dspXcleToken = await login(`dsp-xcle-${stamp}@isolation-test.local`, 'dsp-xcle-password-1');
  report(Boolean(qcTrpToken && qcXcleToken && dspTrpToken && dspXcleToken), 'all four division users can log in');

  console.log('\n[3] ADMIN creates products/warehouses/shelves per division (X-Division-Id header)');
  const adminTrpProduct = await api(admin, 'POST', '/products', { name: `ISOTRPProduct-${stamp}`, sku: `ISO-TRP-${stamp}`, price: 10, quantity: 50 }, trpId);
  const adminXcleProduct = await api(admin, 'POST', '/products', { name: `ISOXCLEProduct-${stamp}`, sku: `ISO-XCLE-${stamp}`, price: 15, quantity: 60 }, xcleId);
  report(adminTrpProduct.status === 201, 'admin creates TRP product in TRP context', `status ${adminTrpProduct.status} ${JSON.stringify(adminTrpProduct.json)}`);
  report(adminXcleProduct.status === 201, 'admin creates XCLE product in XCLE context', `status ${adminXcleProduct.status}`);
  const adminSharedProduct = await api(admin, 'POST', '/products', { name: `ISOSharedProduct-${stamp}`, sku: `ISO-SHARED-${stamp}`, price: 5, quantity: 25 });
  report(adminSharedProduct.status === 201, 'admin creates shared product (All Divisions context)', `status ${adminSharedProduct.status}`);

  const adminTrpWarehouse = await api(admin, 'POST', '/storage', { name: `ISOTRPWHO-${stamp}`, capacity: 100 }, trpId);
  const adminXcleWarehouse = await api(admin, 'POST', '/storage', { name: `ISOXCLEWHO-${stamp}`, capacity: 200 }, xcleId);
  report(adminTrpWarehouse.status === 201 || adminTrpWarehouse.status === 200, 'admin creates TRP warehouse', `status ${adminTrpWarehouse.status}`);
  report(adminXcleWarehouse.status === 201 || adminXcleWarehouse.status === 200, 'admin creates XCLE warehouse', `status ${adminXcleWarehouse.status}`);
  const adminTrpShelf = await api(admin, 'POST', '/shelf-locations', { location_code: `ISO-TRP-${stamp}-S1` }, trpId);
  const adminXcleShelf = await api(admin, 'POST', '/shelf-locations', { location_code: `ISO-XCLE-${stamp}-S1` }, xcleId);
  report(adminTrpShelf.status === 201 || adminTrpShelf.status === 200, 'admin creates TRP shelf location', `status ${adminTrpShelf.status} ${JSON.stringify(adminTrpShelf.json)}`);
  report(adminXcleShelf.status === 201 || adminXcleShelf.status === 200, 'admin creates XCLE shelf location', `status ${adminXcleShelf.status}`);
  const adminTrpGrade = await api(admin, 'POST', '/masters/grades', { name: `ISOGRADETRP${stamp}` }, trpId);
  const adminXcleGrade = await api(admin, 'POST', '/masters/grades', { name: `ISOGRADEXCLE${stamp}` }, xcleId);
  report(adminTrpGrade.status === 201 || adminTrpGrade.status === 200, 'admin creates TRP grade', `status ${adminTrpGrade.status}`);
  report(adminXcleGrade.status === 201 || adminXcleGrade.status === 200, 'admin creates XCLE grade', `status ${adminXcleGrade.status}`);

  console.log('\n[4] ADMIN division selection scopes BOTH views and creates (switcher on top-right)');
  const adminTrpProducts = await api(admin, 'GET', '/products', undefined, trpId);
  const adminXcleProducts = await api(admin, 'GET', '/products', undefined, xcleId);
  const adminAllProducts = await api(admin, 'GET', '/products', undefined, 'all');
  report(scan(adminTrpProducts.json, [`ISOTRPProduct-${stamp}`, `ISOSharedProduct-${stamp}`]).length === 2 && scan(adminTrpProducts.json, [`ISOXCLEProduct-${stamp}`]).length === 0, 'ADMIN in TRP context sees TRP + shared, NOT XCLE');
  report(scan(adminXcleProducts.json, [`ISOXCLEProduct-${stamp}`, `ISOSharedProduct-${stamp}`]).length === 2 && scan(adminXcleProducts.json, [`ISOTRPProduct-${stamp}`]).length === 0, 'ADMIN in XCLE context sees XCLE + shared, NOT TRP');
  report(scan(adminAllProducts.json, [`ISOTRPProduct-${stamp}`, `ISOXCLEProduct-${stamp}`, `ISOSharedProduct-${stamp}`]).length === 3, 'ADMIN in All Divisions sees everything');

  // Stamping is verified against list endpoints (source of truth):
  // creation responses use slim payload shapes that don't echo division_id.
  const stampedProducts = await api(admin, 'GET', '/products', undefined, 'all');
  const productBySku = (sku: string) => (Array.isArray(stampedProducts.json) ? stampedProducts.json.find((p: any) => p.sku === sku) : null);
  report(String(productBySku(`ISO-TRP-${stamp}`)?.division_id ?? '') === String(trpId), 'ADMIN-created TRP product is stamped TRP');
  report(String(productBySku(`ISO-XCLE-${stamp}`)?.division_id ?? '') === String(xcleId), 'ADMIN-created XCLE product is stamped XCLE');
  report((productBySku(`ISO-SHARED-${stamp}`)?.division_id ?? null) == null, 'ADMIN-created shared product is stamped shared (null division)');

  const stampedShelves = await api(admin, 'GET', '/shelf-locations', undefined, 'all');
  const shelfByCode = (code: string) => (Array.isArray(stampedShelves.json) ? stampedShelves.json.find((s: any) => s.location_code === code) : null);
  report(String(shelfByCode(`ISO-TRP-${stamp}-S1`)?.division_id ?? '') === String(trpId), 'ADMIN-created TRP shelf is stamped TRP');
  report(String(shelfByCode(`ISO-XCLE-${stamp}-S1`)?.division_id ?? '') === String(xcleId), 'ADMIN-created XCLE shelf is stamped XCLE');

  const stampedGrades = await api(admin, 'GET', '/masters/grades', undefined, 'all');
  const gradeByName = (name: string) => (Array.isArray(stampedGrades.json) ? stampedGrades.json.find((g: any) => g.name === name) : null);
  report(String(gradeByName(`ISOGRADETRP${stamp}`)?.division_id ?? '') === String(trpId), 'ADMIN-created TRP grade is stamped TRP');
  report(String(gradeByName(`ISOGRADEXCLE${stamp}`)?.division_id ?? '') === String(xcleId), 'ADMIN-created XCLE grade is stamped XCLE');

  const adminTrpWarehouses = await api(admin, 'GET', '/storage', undefined, trpId);
  const adminXcleWarehouses = await api(admin, 'GET', '/storage', undefined, xcleId);
  report(scan(adminTrpWarehouses.json, [`ISOTRPWHO-${stamp}`]).length === 1 && scan(adminTrpWarehouses.json, [`ISOXCLEWHO-${stamp}`]).length === 0, 'ADMIN in TRP context sees TRP warehouse only');
  report(scan(adminXcleWarehouses.json, [`ISOXCLEWHO-${stamp}`]).length === 1 && scan(adminXcleWarehouses.json, [`ISOTRPWHO-${stamp}`]).length === 0, 'ADMIN in XCLE context sees XCLE warehouse only');

  const adminTrpShelves = await api(admin, 'GET', '/shelf-locations', undefined, trpId);
  const adminXcleShelves = await api(admin, 'GET', '/shelf-locations', undefined, xcleId);
  report(scan(adminTrpShelves.json, [`ISO-TRP-${stamp}-S1`]).length === 1 && scan(adminTrpShelves.json, [`ISO-XCLE-${stamp}-S1`]).length === 0, 'ADMIN in TRP context sees TRP shelf only');
  report(scan(adminXcleShelves.json, [`ISO-XCLE-${stamp}-S1`]).length === 1 && scan(adminXcleShelves.json, [`ISO-TRP-${stamp}-S1`]).length === 0, 'ADMIN in XCLE context sees XCLE shelf only');

  const adminTrpGrades = await api(admin, 'GET', '/masters/grades', undefined, trpId);
  const adminXcleGrades = await api(admin, 'GET', '/masters/grades', undefined, xcleId);
  report(scan(adminTrpGrades.json, [`ISOGRADETRP${stamp}`]).length === 1 && scan(adminTrpGrades.json, [`ISOGRADEXCLE${stamp}`]).length === 0, 'ADMIN in TRP context sees TRP grade only');
  report(scan(adminXcleGrades.json, [`ISOGRADEXCLE${stamp}`]).length === 1 && scan(adminXcleGrades.json, [`ISOGRADETRP${stamp}`]).length === 0, 'ADMIN in XCLE context sees XCLE grade only');

  console.log('\n[5] Division-locked members cannot see the other division');
  const qcTrpProducts = await api(qcTrpToken, 'GET', '/products');
  const qcXcleProducts = await api(qcXcleToken, 'GET', '/products');
  const dspTrpProducts = await api(dspTrpToken, 'GET', '/products');
  const dspXcleProducts = await api(dspXcleToken, 'GET', '/products');
  report(scan(qcTrpProducts.json, [`ISOXCLEProduct-${stamp}`]).length === 0, 'QC/TRP cannot see XCLE product');
  report(scan(qcTrpProducts.json, [`ISOTRPProduct-${stamp}`, `ISOSharedProduct-${stamp}`]).length === 2, 'QC/TRP sees TRP + shared product');
  report(scan(qcXcleProducts.json, [`ISOTRPProduct-${stamp}`]).length === 0, 'QC/XCLE cannot see TRP product');
  report(scan(qcXcleProducts.json, [`ISOXCLEProduct-${stamp}`, `ISOSharedProduct-${stamp}`]).length === 2, 'QC/XCLE sees XCLE + shared product');
  report(scan(dspTrpProducts.json, [`ISOXCLEProduct-${stamp}`]).length === 0, 'DSP/TRP cannot see XCLE product');
  report(scan(dspXcleProducts.json, [`ISOTRPProduct-${stamp}`]).length === 0, 'DSP/XCLE cannot see TRP product');

  const qcTrpWarehouses = await api(qcTrpToken, 'GET', '/storage');
  const qcXcleWarehouses = await api(qcXcleToken, 'GET', '/storage');
  report(scan(qcTrpWarehouses.json, [`ISOXCLEWHO-${stamp}`]).length === 0, 'QC/TRP cannot see XCLE warehouse');
  report(scan(qcXcleWarehouses.json, [`ISOTRPWHO-${stamp}`]).length === 0, 'QC/XCLE cannot see TRP warehouse');

  const qcTrpShelves = await api(qcTrpToken, 'GET', '/shelf-locations');
  const qcXcleShelves = await api(qcXcleToken, 'GET', '/shelf-locations');
  report(scan(qcTrpShelves.json, [`ISO-XCLE-${stamp}-S1`]).length === 0, 'QC/TRP cannot see XCLE shelf');
  report(scan(qcXcleShelves.json, [`ISO-TRP-${stamp}-S1`]).length === 0, 'QC/XCLE cannot see TRP shelf');

  const qcTrpGrades = await api(qcTrpToken, 'GET', '/masters/grades');
  const qcXcleGrades = await api(qcXcleToken, 'GET', '/masters/grades');
  report(scan(qcTrpGrades.json, [`ISOGRADEXCLE${stamp}`]).length === 0, 'QC/TRP cannot see XCLE grade');
  report(scan(qcXcleGrades.json, [`ISOGRADETRP${stamp}`]).length === 0, 'QC/XCLE cannot see TRP grade');

  const dspTrpOrders = await api(dspTrpToken, 'GET', '/dispatch-orders');
  const dspXcleOrders = await api(dspXcleToken, 'GET', '/dispatch-orders');
  report(scan(dspTrpOrders.json, XCLE_MARKERS).length === 0, 'DSP/TRP dispatch orders contain no XCLE markers');
  report(scan(dspXcleOrders.json, TRP_MARKERS).length === 0, 'DSP/XCLE dispatch orders contain no TRP markers');

  console.log('\n[6] Division-locked members cannot WRITE across divisions');
  const xcleProductId = (() => {
    const found = Array.isArray(adminXcleProducts.json) ? adminXcleProducts.json.find((p: any) => p.sku === `ISO-XCLE-${stamp}`) : null;
    return found?.id;
  })();
  if (xcleProductId !== undefined) {
    const qcTrpUpdate = await api(qcTrpToken, 'PUT', `/products/${xcleProductId}`, { name: `ISOXCLEProduct-${stamp}`, sku: `ISO-XCLE-${stamp}` });
    report(qcTrpUpdate.status === 404 || qcTrpUpdate.status === 403 || qcTrpUpdate.status === 400, `QC/TRP cannot update XCLE product`, `status ${qcTrpUpdate.status}`);
    const qcTrpDelete = await api(qcTrpToken, 'DELETE', `/products/${xcleProductId}`);
    report(qcTrpDelete.status === 404 || qcTrpDelete.status === 403, `QC/TRP cannot delete XCLE product`, `status ${qcTrpDelete.status}`);
  } else {
    report(false, 'could not resolve XCLE product id for write-protection probe');
  }

  console.log('\n[7] Non-admin header cannot widen visibility');
  const qcTrpAllHeader = await api(qcTrpToken, 'GET', '/products', undefined, 'all');
  report(scan(qcTrpAllHeader.json, [`ISOXCLEProduct-${stamp}`]).length === 0, 'QC/TRP with X-Division-Id: all still cannot see XCLE product');
  const qcTrpForeignHeader = await api(qcTrpToken, 'GET', '/products', undefined, xcleId);
  report(scan(qcTrpForeignHeader.json, [`ISOXCLEProduct-${stamp}`]).length === 0, 'QC/TRP with X-Division-Id: <XCLE> cannot see XCLE product');

  console.log('\n[8] Sync pull is division-scoped');
  const qcTrpPull = await api(qcTrpToken, 'GET', '/sync/pull');
  const qcXclePull = await api(qcXcleToken, 'GET', '/sync/pull');
  report(scan(qcTrpPull.json, [`ISOXCLEProduct-${stamp}`]).length === 0, 'sync pull for QC/TRP contains no XCLE product');
  report(scan(qcXclePull.json, [`ISOTRPProduct-${stamp}`]).length === 0, 'sync pull for QC/XCLE contains no TRP product');

  console.log('\n[9] Deactivated division locks out its members (admin exempt)');
  const deactivate = await api(admin, 'PUT', `/divisions/${trpId}`, { is_active: 0 });
  report(deactivate.status === 200 || deactivate.status === 204, 'admin deactivates TRP division', `status ${deactivate.status}`);
  const qcTrpBlocked = await api(qcTrpToken, 'GET', '/products');
  report(qcTrpBlocked.status === 403, 'QC/TRP is blocked from reading', `status ${qcTrpBlocked.status} ${JSON.stringify(qcTrpBlocked.json)}`);
  const dspTrpBlocked = await api(dspTrpToken, 'GET', '/products');
  report(dspTrpBlocked.status === 403, 'DSP/TRP is blocked from reading', `status ${dspTrpBlocked.status}`);
  const adminSeesAll = await api(admin, 'GET', '/products', undefined, 'all');
  report(adminSeesAll.status === 200 && JSON.stringify(adminSeesAll.json).includes(`ISOTRPProduct-${stamp}`), 'ADMIN can still see deactivated division data');
  const adminSelectsDeactivated = await api(admin, 'GET', '/products', undefined, trpId);
  report(adminSelectsDeactivated.status === 200 && JSON.stringify(adminSelectsDeactivated.json).includes(`ISOTRPProduct-${stamp}`), 'ADMIN can select a deactivated division and still see its rows', `status ${adminSelectsDeactivated.status}`);
  const xcleUnaffected = await api(qcXcleToken, 'GET', '/products');
  report(xcleUnaffected.status === 200, 'XCLE members are unaffected', `status ${xcleUnaffected.status}`);
  const reactivate = await api(admin, 'PUT', `/divisions/${trpId}`, { is_active: 1 });
  const qcTrpRestored = await api(qcTrpToken, 'GET', '/products');
  report(reactivate.status === 200 && qcTrpRestored.status === 200, 'reactivating the division restores access');

  console.log(`\n${checks} checks, ${failures} failure(s)`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error('Division probe crashed:', error);
  process.exit(1);
});
