import 'dotenv/config';

/**
 * Smoke probe for the family-delete flow.
 * Requires BASE_URL pointing at a running API with a throwaway database.
 * Exits 0 when every check passes, 1 otherwise.
 */

const BASE = process.env.BASE_URL || 'http://127.0.0.1:3019';

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

async function api(token: string | null, method: string, path: string, body?: unknown) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
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
  console.log(`Family delete probe against ${BASE}`);
  const stamp = Math.random().toString(16).slice(2, 8);

  const reg = await api(null, 'POST', '/auth/register', {
    name: 'Del Admin', companyName: `DelTenant${stamp} Industries`, mobile: '9000000501',
    email: `del-admin-${stamp}@isolation-test.local`, password: 'del-admin-password-1',
  });
  report(reg.status === 201, 'register tenant', `status ${reg.status} ${JSON.stringify(reg.json)}`);
  if (reg.status !== 201) process.exit(1);
  const admin = reg.json.token as string;

  console.log('\n[1] Create a family with two grades via /products/family');
  const familyName = `DELFAM ${stamp}`;
  const created = await api(admin, 'POST', '/products/family', {
    name: familyName,
    description: 'delete me',
    manufacturer: 'SELF (KLJ)',
    grades: [
      { grade: `DEL GRADE A ${stamp}`, sku: `DEL-A-${stamp}` },
      { grade: `DEL GRADE B ${stamp}`, sku: `DEL-B-${stamp}` },
      { grade: `DEL GRADE C ${stamp}`, sku: `DEL-C-${stamp}` },
    ],
  });
  report(created.status === 201 || created.status === 200, 'family created', `status ${created.status} ${JSON.stringify(created.json)}`);

  const families = await api(admin, 'GET', '/products/families');
  const family = Array.isArray(families.json) ? families.json.find((f: any) => f.name === familyName) : null;
  report(Boolean(family), 'family appears in families list');
  report(family && family.count === 3, 'family count = 3', JSON.stringify(family));
  console.log('\n[2] Delete the whole family (all grades deleted)');
  const del = await api(admin, 'DELETE', `/products/families/${encodeURIComponent(familyName)}`);
  report(del.status === 200, 'DELETE /products/families/:name returns 200', `status ${del.status} ${JSON.stringify(del.json)}`);
  report(del.json?.deleted === 3, 'reports deleted = 3', JSON.stringify(del.json));

  const after = await api(admin, 'GET', '/products/families');
  const gone: any[] = Array.isArray(after.json) ? after.json.filter((f: any) => f.name === familyName) : [];
  report(gone.length === 0, 'family is gone from the list after delete');

  console.log('\n[3] Deleting an already-empty family is a silent success (scenario 2)');
  const delAgain = await api(admin, 'DELETE', `/products/families/${encodeURIComponent(familyName)}`);
  report(delAgain.status === 200 && delAgain.json?.deleted === 0, 'empty family deletes silently (deleted = 0)', `status ${delAgain.status} ${JSON.stringify(delAgain.json)}`);

  console.log('\n[4] Grades with batches block the family delete (409, atomic)');
  const familyName2 = `DELBAT ${stamp}`;
  const created2 = await api(admin, 'POST', '/products/family', {
    name: familyName2,
    grades: [
      { grade: `DELBAT GRADE 1 ${stamp}`, sku: `DELBAT-1-${stamp}` },
      { grade: `DELBAT GRADE 2 ${stamp}`, sku: `DELBAT-2-${stamp}` },
    ],
  });
  report(created2.status === 201 || created2.status === 200, 'second family created with two grades', `status ${created2.status} ${JSON.stringify(created2.json)}`);

  const productList = await api(admin, 'GET', `/products/search?q=DELBAT-1&limit=5`);
  const product1: any = Array.isArray(productList.json) ? productList.json[0] : null;
  report(Boolean(product1?.id), 'found the grade-1 product id', JSON.stringify(productList.json));

  const warehouse = await api(admin, 'POST', '/storage', { name: `DEL-WH-${stamp}`, capacity: 100 });
  report(warehouse.status === 201 || warehouse.status === 200, 'create warehouse', `status ${warehouse.status} ${JSON.stringify(warehouse.json)}`);
  const warehouseId: string | number = warehouse.json?.id ?? warehouse.json?.warehouse?.id;
  const rack = await api(admin, 'POST', `/storage/${warehouseId}/racks`, { name: 'R1', rows: 1, columns: 2 });
  report(rack.status === 201 || rack.status === 200, 'create rack (1x2 cells)', `status ${rack.status} ${JSON.stringify(rack.json)}`);
  const shelfId: string | number | null = rack.json?.cells?.[0]?.shelf_location_id ?? null;
  report(Boolean(shelfId), 'rack cells expose a shelf_location_id', JSON.stringify(rack.json));

  if (product1?.id && shelfId && warehouseId) {
    const now = new Date();
    const manufacturing = now.toISOString().slice(0, 10);
    const expiry = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const batch = await api(admin, 'POST', '/batches/group', {
      items: [{ product_id: product1.id, quantity: 1, package_quantity: 1, uom: 'Kg', shelf_location_id: shelfId, warehouse_id: warehouseId, manufacturing_date: manufacturing, expiry_date: expiry }],
    });
    report(batch.status === 201 || batch.status === 200, 'create batch group for the grade', `status ${batch.status} ${JSON.stringify(batch.json)}`);

    if (batch.status === 201 || batch.status === 200) {
      const delBlocked = await api(admin, 'DELETE', `/products/families/${encodeURIComponent(familyName2)}`);
      report(delBlocked.status === 409, 'family delete refused with 409 when a grade has batches', `status ${delBlocked.status} ${JSON.stringify(delBlocked.json)}`);
      report(typeof delBlocked.json?.error === 'string' && /DELBAT GRADE 1/.test(delBlocked.json.error), '409 message names the offending grade', JSON.stringify(delBlocked.json));

      const afterBlocked = await api(admin, 'GET', '/products/families');
      const stillThere = Array.isArray(afterBlocked.json) ? afterBlocked.json.find((f: any) => f.name === familyName2) : null;
      report(stillThere && stillThere.count === 2, 'both grades still present — nothing was deleted', JSON.stringify(stillThere));
    }
  }

  console.log('\n[5] Authorization — non-admins cannot delete');
  const qc = await api(admin, 'POST', '/users', { name: 'QC Del', email: `qc-del-${stamp}@isolation-test.local`, password: 'qc-del-password-1', role: 'QC' });
  report(qc.status === 201, 'create QC user', `status ${qc.status}`);
  const qcLogin = await api(null, 'POST', '/auth/login', { email: `qc-del-${stamp}@isolation-test.local`, password: 'qc-del-password-1' });
  const qcToken = qcLogin.json?.token as string;
  const delByQc = await api(qcToken, 'DELETE', `/products/families/${encodeURIComponent(familyName2)}`);
  report(delByQc.status === 403, 'QC cannot delete a family (403)', `status ${delByQc.status}`);

  console.log('\n[6] Deactivation — family + grades vanish from every read; data kept');
  const deactivate = await api(admin, 'POST', `/products/families/${encodeURIComponent(familyName2)}/deactivate`);
  report(deactivate.status === 200, 'deactivate returns 200', `status ${deactivate.status} ${JSON.stringify(deactivate.json)}`);
  report(deactivate.json?.deactivated === 2, 'deactivates 2 grades', JSON.stringify(deactivate.json));

  // Inactive view: the deactivated family is visible ONLY through include=inactive
  const inactiveList = await api(admin, 'GET', '/products/families?include=inactive');
  const inactiveFamily = Array.isArray(inactiveList.json) ? inactiveList.json.find((f: any) => f.name === familyName2) : null;
  report(Boolean(inactiveFamily), 'inactive view lists the deactivated family', JSON.stringify(inactiveList.json));
  report(inactiveFamily && inactiveFamily.count === 2, 'inactive view reports count = 2', JSON.stringify(inactiveFamily));

  // Reactivation of the deactivated family
  const reactivate = await api(admin, 'POST', `/products/families/${encodeURIComponent(familyName2)}/reactivate`);
  report(reactivate.status === 200, 'reactivate returns 200', `status ${reactivate.status} ${JSON.stringify(reactivate.json)}`);
  report(reactivate.json?.reactivated === 2, 'reactivates 2 grades', JSON.stringify(reactivate.json));

  const afterReactivate = await api(admin, 'GET', '/products/families');
  const restoredFamily = Array.isArray(afterReactivate.json) ? afterReactivate.json.find((f: any) => f.name === familyName2) : null;
  report(Boolean(restoredFamily) && restoredFamily.count === 2, 'reactivated family is back in families list with its grades', JSON.stringify(restoredFamily));

  const reactivateAgain = await api(admin, 'POST', `/products/families/${encodeURIComponent(familyName2)}/reactivate`);
  report(reactivateAgain.status === 200 && reactivateAgain.json?.alreadyActive === true, 'reactivation is idempotent', JSON.stringify(reactivateAgain.json));

  // Now deactivate again to confirm the full round trip works inside the same family
  const deactivateAgain = await api(admin, 'POST', `/products/families/${encodeURIComponent(familyName2)}/deactivate`);
  report(deactivateAgain.status === 200 && deactivateAgain.json?.deactivated === 2, 'round trip 2: deactivate after reactivate', JSON.stringify(deactivateAgain.json));

  const reactivateAgain2 = await api(admin, 'POST', `/products/families/${encodeURIComponent(familyName2)}/reactivate`);
  report(reactivateAgain2.status === 200 && reactivateAgain2.json?.reactivated === 2, 'round trip 2: reactivate again', JSON.stringify(reactivateAgain2.json));

  // The batch that was created during [4] is still there — bookkeeping across hide/show cycles
  const batchesListAfterCycles = await api(admin, 'GET', '/batches');
  const batchesAfterArray: any[] = Array.isArray(batchesListAfterCycles.json) ? batchesListAfterCycles.json : [];
  report(batchesAfterArray.length >= 1, 'batches still present after deactivation round trips');

  // Deactivation again, now verifying the counts still line up
  const deactivateFinal = await api(admin, 'POST', `/products/families/${encodeURIComponent(familyName2)}/deactivate`);
  report(deactivateFinal.status === 200 && deactivateFinal.json?.deactivated === 2, 'final deactivate for delete-path tests', JSON.stringify(deactivateFinal.json));


  const afterDeactivate = await api(admin, 'GET', '/products/families');
  const stillListed = Array.isArray(afterDeactivate.json) ? afterDeactivate.json.find((f: any) => f.name === familyName2) : null;
  report(!stillListed, 'deactivated family is gone from families list', JSON.stringify(stillListed));

  const searchDeactivated = await api(admin, 'GET', `/products/search?q=DELBAT-2&limit=5`);
  const searched = Array.isArray(searchDeactivated.json) ? searchDeactivated.json : [];
  report(searched.length === 0, 'deactivated product is hidden from search', JSON.stringify(searched));

  const deactivatedViaFamily = await api(admin, 'GET', `/products/families/${encodeURIComponent(familyName2)}/products`);
  report(deactivatedViaFamily.json?.total === 0, 'deactivated family products endpoint returns total 0', `status ${deactivatedViaFamily.status} ${JSON.stringify(deactivatedViaFamily.json)}`);

  const deactivateThird = await api(admin, 'POST', `/products/families/${encodeURIComponent(familyName2)}/deactivate`);
  report(deactivateThird.status === 200 && deactivateThird.json?.alreadyDeactivated === true, 'third deactivate is idempotent', JSON.stringify(deactivateThird.json));

  // DELETE /products must also omit the deactivated family
  const listAfterDeactivate = await api(admin, 'GET', '/products');
  const listText = JSON.stringify(listAfterDeactivate.json);
  report(listAfterDeactivate.status === 200 && !listText.includes('DELBAT-2-') && !listText.includes('DELBAT-1-'), 'deactivated products absent from /products list', `status ${listAfterDeactivate.status}`);

  // Build a separate family with no batch history for the delete-after-deactivate scenario
  const deleteFamilyName = `DECDEL FAM ${stamp}`;
  const created3 = await api(admin, 'POST', '/products/family', {
    name: deleteFamilyName,
    grades: [
      { grade: `DECDEL GRADE 1 ${stamp}`, sku: `DECDEL-1-${stamp}` },
      { grade: `DECDEL GRADE 2 ${stamp}`, sku: `DECDEL-2-${stamp}` },
    ],
  });
  report(created3.status === 201 || created3.status === 200, 'separate no-batch family created for delete-after-deactivate', `status ${created3.status}`);
  const deactivateDeleteTarget = await api(admin, 'POST', `/products/families/${encodeURIComponent(deleteFamilyName)}/deactivate`);
  report(deactivateDeleteTarget.status === 200 && deactivateDeleteTarget.json?.deactivated === 2, 'family without batches deactivates cleanly', `status ${deactivateDeleteTarget.status} ${JSON.stringify(deactivateDeleteTarget.json)}`);

  const deleteAfterDeactivate = await api(admin, 'DELETE', `/products/families/${encodeURIComponent(deleteFamilyName)}`);
  report(deleteAfterDeactivate.status === 200, 'deactivated family can still be permanently deleted', `status ${deleteAfterDeactivate.status} ${JSON.stringify(deleteAfterDeactivate.json)}`);

  console.log('\n[7] Deactivation is a no-op for a family that does not exist');
  const deactivateMissing = await api(admin, 'POST', `/products/families/${encodeURIComponent('TOTALLY MISSING ' + stamp)}/deactivate`);
  report(deactivateMissing.status === 200 && deactivateMissing.json?.deactivated === 0, 'nonexistent family returns 200 with deactivated = 0');

  console.log(`\n${checks} checks, ${failures} failures`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error('Probe crashed:', error);
  process.exit(1);
});
