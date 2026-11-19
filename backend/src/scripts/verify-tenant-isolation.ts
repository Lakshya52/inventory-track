import 'dotenv/config';

/**
 * Live cross-tenant isolation probe.
 *
 * Boots nothing itself: point BASE_URL at a running API instance whose
 * database contains ONLY test data (e.g. factory_inventory_tenant_test).
 * The script registers two fresh tenants, seeds tenant A with data, then
 * probes every read and write path from tenant B (and vice versa).
 *
 * Exit code 0 = all checks passed, 1 = at least one leak/failure.
 */

const BASE = process.env.BASE_URL || 'http://127.0.0.1:3011';

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

async function api(token: string | null, method: string, path: string, body?: unknown): Promise<{ status: number; json: any }> {
  const res = await fetch(`${BASE}/api${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { status: res.status, json };
}

function scan(json: unknown, markers: string[]): string[] {
  const text = JSON.stringify(json);
  return markers.filter((marker) => text.includes(marker));
}

const A_MARKERS = ['ISO-PROD-A-001', 'IsoTenantA Product', 'IsoClientA', 'IsoVendorA', 'ISO-RACK-A-01', 'ISOGRADEA', 'ISOUOMA', 'IsoWarehouseA'];
const B_MARKERS = ['ISO-PROD-B-001', 'IsoTenantB Product', 'IsoClientB', 'IsoVendorB', 'ISO-RACK-B-01', 'ISOGRADEB', 'ISOUOMB', 'IsoWarehouseB'];

async function main(): Promise<void> {
  console.log(`Tenant isolation probe against ${BASE}`);

  console.log('\n[1] Registration');
  const stamp = Math.random().toString(16).slice(2, 8);
  const regA = await api(null, 'POST', '/auth/register', {
    name: 'Iso A Admin', companyName: 'IsoTenantA Industries', mobile: '9000000101',
    email: `iso-a-${stamp}@isolation-test.local`, password: 'iso-a-password-1',
  });
  const regB = await api(null, 'POST', '/auth/register', {
    name: 'Iso B Admin', companyName: 'IsoTenantB Industries', mobile: '9000000102',
    email: `iso-b-${stamp}@isolation-test.local`, password: 'iso-b-password-1',
  });
  report(regA.status === 201, 'register tenant A', `status ${regA.status} ${JSON.stringify(regA.json)}`);
  report(regB.status === 201, 'register tenant B', `status ${regB.status} ${JSON.stringify(regB.json)}`);
  if (regA.status !== 201 || regB.status !== 201) process.exit(1);

  const tokenA: string = regA.json.token;
  const tokenB: string = regB.json.token;
  report(regA.json.user?.tenantId !== undefined && regB.json.user?.tenantId !== undefined, 'register response carries tenantId');
  report(String(regA.json.user?.tenantId) !== String(regB.json.user?.tenantId), 'tenant ids differ');

  const meA = await api(tokenA, 'GET', '/auth/me');
  const meB = await api(tokenB, 'GET', '/auth/me');
  report(meA.status === 200 && meB.status === 200, 'GET /auth/me works for both');

  console.log('\n[2] Tenant A creates data');
  const productA = await api(tokenA, 'POST', '/products', {
    name: 'IsoTenantA Product', sku: 'ISO-PROD-A-001', price: 10, quantity: 100,
  });
  report(productA.status === 201, 'A creates product', `status ${productA.status} ${JSON.stringify(productA.json)}`);
  const productAId = productA.json?.id ?? productA.json?.products?.[0]?.id;

  const clientA = await api(tokenA, 'POST', '/clients', { name: 'IsoClientA', phone: '9000000103' });
  report(clientA.status === 201 || clientA.status === 200, 'A creates client', `status ${clientA.status}`);
  const vendorA = await api(tokenA, 'POST', '/vendors', { name: 'IsoVendorA' });
  report(vendorA.status === 201 || vendorA.status === 200, 'A creates vendor', `status ${vendorA.status} ${JSON.stringify(vendorA.json)}`);
  const shelfA = await api(tokenA, 'POST', '/shelf-locations', { location_code: 'ISO-RACK-A-01', warehouse: 'IsoWarehouseA' });
  report(shelfA.status === 201 || shelfA.status === 200, 'A creates shelf location', `status ${shelfA.status} ${JSON.stringify(shelfA.json)}`);
  const gradeA = await api(tokenA, 'POST', '/masters/grades', { name: 'ISOGRADEA' });
  report(gradeA.status === 201 || gradeA.status === 200, 'A creates grade', `status ${gradeA.status} ${JSON.stringify(gradeA.json)}`);
  const uomA = await api(tokenA, 'POST', '/masters/uoms', { name: 'ISOUOMA' });
  report(uomA.status === 201 || uomA.status === 200, 'A creates UOM', `status ${uomA.status} ${JSON.stringify(uomA.json)}`);
  const bagA = await api(tokenA, 'POST', '/masters/bag-quantities', { quantity: 25, unit: 'kg' });
  report(bagA.status === 201 || bagA.status === 200, 'A creates bag quantity', `status ${bagA.status} ${JSON.stringify(bagA.json)}`);
  const warehouseA = await api(tokenA, 'POST', '/storage', { name: 'IsoWarehouseA', capacity: 1000 });
  report(warehouseA.status === 201 || warehouseA.status === 200, 'A creates warehouse', `status ${warehouseA.status} ${JSON.stringify(warehouseA.json)}`);

  console.log('\n[3] Tenant B cannot SEE tenant A data');
  const bProducts = await api(tokenB, 'GET', '/products');
  report(scan(bProducts.json, A_MARKERS).length === 0, 'B product list is empty of A data', JSON.stringify(scan(bProducts.json, A_MARKERS)));
  report(scan((await api(tokenB, 'GET', '/products/search?q=ISO-PROD-A-001')).json, A_MARKERS).length === 0, 'B product search finds nothing');
  if (productAId !== undefined) {
    const bGetA = await api(tokenB, 'GET', `/products/${productAId}`);
    report(bGetA.status === 404 || bGetA.status === 403, `B GET /products/${productAId} is rejected`, `status ${bGetA.status}`);
    const bPutA = await api(tokenB, 'PUT', `/products/${productAId}`, { name: 'IsoTenantA Product', sku: 'ISO-PROD-A-001' });
    report(bPutA.status === 404 || bPutA.status === 403 || bPutA.status === 400, `B PUT /products/${productAId} is rejected`, `status ${bPutA.status}`);
    const bDelA = await api(tokenB, 'DELETE', `/products/${productAId}`);
    report(bDelA.status === 404 || bDelA.status === 403, `B DELETE /products/${productAId} is rejected`, `status ${bDelA.status}`);
  }
  for (const [label, path] of [
    ['clients', '/clients'], ['vendors', '/vendors'], ['shelf locations', '/shelf-locations'],
    ['grades', '/masters/grades'], ['uoms', '/masters/uoms'], ['bag quantities', '/masters/bag-quantities'],
    ['warehouses', '/storage'], ['dashboard', '/dashboard'], ['dashboard admin', '/dashboard/admin'],
    ['report summary', '/reports/summary'], ['report inventory', '/reports/inventory'], ['report batches', '/reports/batches'],
    ['report qc', '/reports/qc'], ['report dispatch', '/reports/dispatch'], ['report dispatch-requests', '/reports/dispatch-requests'],
    ['activity feed', '/activity'], ['sync pull', '/sync/pull'], ['sync status', '/sync/status'],
  ] as Array<[string, string]>) {
    const { status, json } = await api(tokenB, 'GET', path);
    const leaked = scan(json, A_MARKERS);
    report(leaked.length === 0, `B ${label} shows no A data`, leaked.length ? `leaked ${leaked.join(', ')}` : `status ${status}`);
  }

  console.log('\n[4] Tenant B can reuse tenant A identifiers (composite uniqueness)');
  const dupSku = await api(tokenB, 'POST', '/products', { name: 'IsoTenantB Product', sku: 'ISO-PROD-A-001', price: 12, quantity: 5 });
  report(dupSku.status === 201, 'B creates product with same SKU as A', `status ${dupSku.status} ${JSON.stringify(dupSku.json)}`);
  const dupShelf = await api(tokenB, 'POST', '/shelf-locations', { location_code: 'ISO-RACK-A-01', warehouse: 'IsoWarehouseB' });
  report(dupShelf.status === 201 || dupShelf.status === 200, 'B creates shelf location with same code as A', `status ${dupShelf.status}`);

  console.log('\n[5] Tenant A sees only its own data');
  const aProducts = await api(tokenA, 'GET', '/products');
  report(scan(aProducts.json, B_MARKERS).length === 0, 'A product list shows no B data', JSON.stringify(scan(aProducts.json, B_MARKERS)));
  const aActivity = await api(tokenA, 'GET', '/activity');
  report(scan(aActivity.json, B_MARKERS).length === 0, 'A activity feed shows no B data');
  const aPull = await api(tokenA, 'GET', '/sync/pull');
  report(scan(aPull.json, B_MARKERS).length === 0, 'A sync pull shows no B data');

  console.log('\n[6] Cross-tenant write attempts via ids from the other tenant');
  const frontShelf = await api(tokenA, 'GET', '/shelf-locations');
  const aShelfId = Array.isArray(frontShelf.json) ? frontShelf.json[0]?.id : frontShelf.json?.locations?.[0]?.id ?? frontShelf.json?.[0]?.id;
  if (aShelfId !== undefined && aShelfId !== null) {
    const bUpdateAShelf = await api(tokenB, 'PUT', `/shelf-locations/${aShelfId}`, { location_code: 'ISO-RACK-A-01', warehouse: 'IsoWarehouseB' });
    report(bUpdateAShelf.status === 404 || bUpdateAShelf.status === 403, `B PUT /shelf-locations/${aShelfId} rejected`, `status ${bUpdateAShelf.status}`);
  } else {
    report(false, 'could not resolve A shelf-location id for write probe');
  }

  console.log(`\n${checks} checks, ${failures} failure(s)`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error('Isolation probe crashed:', error);
  process.exit(1);
});
