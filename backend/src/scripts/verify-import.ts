import 'dotenv/config';
import ExcelJS from 'exceljs';

/**
 * Live probe for the products bulk-import wizard backend.
 *
 * Boots nothing itself: point BASE_URL at a running API whose database contains
 * ONLY test data (the script registers a throwaway tenant and creates throwaway
 * divisions). Nothing is written to production data.
 *
 *   1. Registers a tenant, creates two divisions + a QC user in one of them.
 *   2. Downloads the template (validates the two sheets + Products header).
 *   3. Builds a test workbook covering valid / warning / error rows.
 *   4. POST /products/import/validate and asserts the summary + row findings.
 *   5. Asserts a QC user is forbidden from validate/apply but allowed to download.
 *   6. POST /products/import/apply and asserts inserts, division stamping,
 *      auto-SKU, manufacturer default and error-row skipping.
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

async function upload(token: string, path: string, filename: string, buffer: Buffer) {
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(buffer)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), filename);
  const res = await fetch(`${BASE}/api${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  const text = await res.text();
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { status: res.status, json };
}

async function downloadTemplate(token: string, division?: string | number | null) {
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  const query = division === undefined ? '' : division === null ? '?division=all' : `?division=${encodeURIComponent(String(division))}`;
  const res = await fetch(`${BASE}/api/products/import/template${query}`, { headers });
  const buffer = Buffer.from(await res.arrayBuffer());
  return { status: res.status, headers: res.headers, buffer };
}

async function buildTestWorkbook(divisionA: string, divisionB: string, kgName: string, bagName: string): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Products');
  sheet.addRow(['Division', 'Product', 'Grade', 'SKU', 'Manufacturer', 'UOM', 'Description']);
  const rows: Array<[string, string, string, string, string, string, string]> = [
    [divisionA, 'IMP-TEST XLPE', 'IMP BK 9406', 'IMP-TEST-001', 'Acme Resins', kgName, 'Black sheath grade'], // valid + UOM (uoms master)
    [divisionA, 'IMP-TEST XLPE', 'IMP WH 9407', '', '', '', ''], // blank SKU + blank manufacturer + blank UOM -> auto-SKU + SELF + counted once
    ['', '', 'IMP ORPHAN', 'IMP-TEST-002', '', '', ''], // missing product -> error
    [divisionA, 'IMP-TEST EPR', '', 'IMP-TEST-003', '', '', ''], // missing grade -> error
    [divisionA, 'IMP-TEST DUP', 'IMP DUPE A', 'IMP-DUPE-001', '', '', ''], // duplicate in file (pair)
    [divisionB, 'IMP-TEST DUP', 'IMP DUPE B', 'IMP-DUPE-001', '', '', ''], // duplicate in file (pair)
    [divisionA, 'IMP-TEST DB DUP', 'IMP DBDUP', 'IMP-EXISTING-001', '', '', ''], // duplicate in DB -> error
    ['NOSUCHDIV', 'IMP-TEST GHOST', 'IMP GHOST', 'IMP-TEST-004', '', 'NOSUCHUOM', ''], // unknown division + unknown UOM -> errors
    ['', 'IMP-TEST SHARED', 'IMP SHARED', 'IMP-TEST-005', '', bagName, ''], // blank division -> warning (all divisions), resolves via bag_quantities master
  ];
  for (const row of rows) sheet.addRow(row);
  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

async function main(): Promise<void> {
  console.log(`Import probe against ${BASE}`);
  const stamp = Math.random().toString(16).slice(2, 8);

  console.log('\n[1] Tenant + divisions setup');
  const reg = await api(null, 'POST', '/auth/register', {
    name: 'Import Admin', companyName: `ImportTenant${stamp} Industries`, mobile: '9000000401',
    email: `import-admin-${stamp}@isolation-test.local`, password: 'import-admin-password-1',
  });
  report(reg.status === 201, 'register tenant', `status ${reg.status} ${JSON.stringify(reg.json)}`);
  if (reg.status !== 201) process.exit(1);
  const admin = reg.json.token as string;

  const trpName = `IMP TRP ${stamp}`;
  const xcleName = `IMP XCLE ${stamp}`;
  const trp = await api(admin, 'POST', '/divisions', { name: trpName });
  const xcle = await api(admin, 'POST', '/divisions', { name: xcleName });
  report(trp.status === 201, 'create division A', `status ${trp.status}`);
  report(xcle.status === 201, 'create division B', `status ${xcle.status}`);
  const trpId: string | number = trp.json?.id;
  const xcleId: string | number = xcle.json?.id;

  const qc = await api(admin, 'POST', '/users', { name: 'QC Import', email: `qc-import-${stamp}@isolation-test.local`, password: 'qc-import-password-1', role: 'QC', division_id: trpId });
  report(qc.status === 201, 'create QC user in division A', `status ${qc.status}`);
  const qcLogin = await api(null, 'POST', '/auth/login', { email: `qc-import-${stamp}@isolation-test.local`, password: 'qc-import-password-1' });
  const qcToken = qcLogin.json?.token as string;
  report(Boolean(qcToken), 'QC user can log in');

  // Pre-existing catalogue row with a SKU we will try to re-import
  const existing = await api(admin, 'POST', '/products', { name: 'IMP-TEST EXISTING', sku: 'IMP-EXISTING-001', price: 1, quantity: 1 }, trpId);
  report(existing.status === 201, 'pre-existing product created', `status ${existing.status} ${JSON.stringify(existing.json)}`);

  const kg = await api(admin, 'POST', '/masters/uoms', { name: `IMP-KG ${stamp}` });
  const bag25 = await api(admin, 'POST', '/masters/bag-quantities', { quantity: 25, unit: 'Kg' });
  const kgName = `IMP-KG ${stamp}`;
  const bag25Name = '25 Kg';
  report(kg.status === 201 || kg.status === 200, 'create UOM IMP-KG', `status ${kg.status} ${JSON.stringify(kg.json)}`);
  report(bag25.status === 201 || bag25.status === 200, 'create bag quantity 25 Kg', `status ${bag25.status} ${JSON.stringify(bag25.json)}`);
  const kgId = kg.json?.id;
  const bag25Id = bag25.json?.id;
  report(Boolean(kgId) && Boolean(bag25Id), 'UOM/bag ids returned', `kg=${kgId} bag=${bag25Id}`);

  console.log('\n[2a] Template — downloaded for a specific division');
  const template = await downloadTemplate(admin, trpId);
  report(template.status === 200, 'template downloads (200)', `status ${template.status}`);
  report((template.headers.get('content-type') || '').includes('spreadsheetml'), 'template content-type is xlsx', template.headers.get('content-type') ?? 'none');
  report(template.buffer.length > 2000, 'template workbook is non-trivial', `${template.buffer.length} bytes`);

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(template.buffer as any);
  const sheetNames = wb.worksheets.map((s) => s.name);
  report(sheetNames.join('|') === 'How To Import|Products|__import_meta', 'division template has guide + Products + hidden marker sheets', sheetNames.join('|'));
  const data = wb.getWorksheet('Products');
  const headerValues = (data?.getRow(1).values as unknown as string[]).slice(1);
  report(JSON.stringify(headerValues) === JSON.stringify(['Product', 'Grade', 'SKU', 'Manufacturer', 'UOM', 'Description (optional)']), 'division template has NO Division column but keeps UOM', JSON.stringify(headerValues));
  const meta = wb.getWorksheet('__import_meta');
  report(meta?.state === 'veryHidden', 'marker sheet is very hidden', String(meta?.state));
  report(String(meta?.getCell('A2').value) === trpName, 'marker carries the selected division name', String(meta?.getCell('A2').value));
  const uomCell = data?.getCell('E2');
  report(uomCell?.dataValidation?.type === 'list', 'division template: UOM column has dropdown validation', JSON.stringify(uomCell?.dataValidation ?? null));
  let dataHasValues = false;
  if (data) {
    for (let r = 2; r <= data.rowCount; r += 1) {
      const values = (data.getRow(r).values as unknown[]) || [];
      if (values.slice(1).some((v) => v !== null && v !== undefined && String(v).trim() !== '')) { dataHasValues = true; break; }
    }
  }
  report(!dataHasValues, 'Products sheet ships empty (header only)', 'a data row contains values');
  const guide = wb.getWorksheet('How To Import');
  let guideText = '';
  guide?.eachRow((row) => { guideText += (row.values as unknown as unknown[]).join(' ') + '\n'; });
  report(guideText.includes('IMP-EXISTING-001'), 'guide contains real catalog examples', 'IMP-EXISTING-001 not found');
  report(guideText.toLowerCase().includes('how to import'), 'guide contains the training title');
  report(guideText.includes(trpName), 'guide references the selected division');

  console.log('\n[2b] Template — downloaded for All divisions');
  const templateForAll = await downloadTemplate(admin, null);
  report(templateForAll.status === 200, 'template downloads for All Divisions', `status ${templateForAll.status}`);
  const wbAll = new ExcelJS.Workbook();
  await wbAll.xlsx.load(templateForAll.buffer as any);
  report(JSON.stringify((wbAll.getWorksheet('Products')?.getRow(1).values as unknown as string[]).slice(1)) === JSON.stringify(['Division', 'Product', 'Grade', 'SKU', 'Manufacturer', 'UOM', 'Description (optional)']), 'all-divisions template keeps the Division column AND UOM');
  const allUomCell = wbAll.getWorksheet('Products')?.getCell('F2');
  report(allUomCell?.dataValidation?.type === 'list', 'all-divisions template: UOM column has dropdown validation', JSON.stringify(allUomCell?.dataValidation ?? null));
  report(!wbAll.worksheets.some((s) => s.name === '__import_meta'), 'all-divisions template has NO marker sheet');
  report(templateForAll.buffer.length > 2000, 'all-divisions template workbook is non-trivial', `${templateForAll.buffer.length} bytes`);
  let allGuideText = '';
  wbAll.getWorksheet('How To Import')?.eachRow((row) => { allGuideText += (row.values as unknown as unknown[]).join(' ') + '\n'; });
  report(allGuideText.includes('IMP-EXISTING-001'), 'all-divisions guide contains real catalog examples', 'IMP-EXISTING-001 not found');

  const templateQc = await downloadTemplate(qcToken, trpId);
  report(templateQc.status === 200, 'QC (non-admin) may download the template', `status ${templateQc.status}`);

  console.log('\n[3] Validate the test workbook');
  const workbook = await buildTestWorkbook(trpName, xcleName, kgName, bag25Name);
  const validate = await upload(admin, '/products/import/validate', 'import-test.xlsx', workbook);
  report(validate.status === 200, 'validate returns 200', `status ${validate.status} ${JSON.stringify(validate.json)}`);
  if (validate.status !== 200) process.exit(1);
  const { summary, rows } = validate.json;
  report(summary.total === 9, 'summary.total = 9', JSON.stringify(summary));
  report(summary.valid === 3, 'summary.valid = 3 (clean + defaults rows, ready to import)', JSON.stringify(summary));
  report(summary.errors === 6, 'summary.errors = 6', JSON.stringify(summary));
  report(summary.warnings === 0, 'summary.warnings = 0 (defaults are not warnings anymore)', JSON.stringify(summary));
  report(summary.duplicatesInFile === 2, 'summary.duplicatesInFile = 2', JSON.stringify(summary));
  report(summary.duplicatesInDb === 1, 'summary.duplicatesInDb = 1', JSON.stringify(summary));
  report(summary.noDivision === 2, 'summary.noDivision = 2 (blank-division rows 4 and 10)', JSON.stringify(summary));
  report(summary.missingSku === 1, 'summary.missingSku = 1 (row 3, auto-generated)', JSON.stringify(summary));
  report(summary.missingManufacturer === 8, 'summary.missingManufacturer = 8', JSON.stringify(summary));
  report(summary.defaults === 8, 'summary.defaults = 8 (rows 3-10)', JSON.stringify(summary));
  report(summary.missingUom === 6, 'summary.missingUom = 6 (rows 3-8)', JSON.stringify(summary));

  report(rows.length === 6, 'findings response lists only the 6 error rows', `rows.length = ${rows.length}`);

  const byRow = new Map<number, any>(rows.map((r: any) => [r.row, r]));
  report(!byRow.has(2) && !byRow.has(3) && !byRow.has(10), 'clean rows produce no findings entries');
  report(byRow.get(4)?.errors?.some((e: string) => /Product name is required/.test(e)), 'row 4 missing product flagged');
  report(byRow.get(5)?.errors?.some((e: string) => /Grade name is required/.test(e)), 'row 5 missing grade flagged');
  report(byRow.get(6)?.errors?.some((e: string) => /appears 2 times/.test(e)) && byRow.get(7)?.errors?.some((e: string) => /appears 2 times/.test(e)), 'rows 6+7 duplicate SKU in file flagged');
  report(byRow.get(8)?.errors?.some((e: string) => /already exists/.test(e)), 'row 8 SKU exists in catalogue flagged');
  report(byRow.get(9)?.errors?.some((e: string) => /does not exist/.test(e)), 'row 9 unknown division flagged');
  report(byRow.get(9)?.errors?.some((e: string) => /UOM/i.test(e)), 'row 9 unknown UOM flagged');

  console.log('\n[4] Authorization boundaries');
  const qcValidate = await upload(qcToken, '/products/import/validate', 'import-test.xlsx', workbook);
  report(qcValidate.status === 403, 'QC cannot validate (403)', `status ${qcValidate.status}`);
  const qcApply = await upload(qcToken, '/products/import/apply', 'import-test.xlsx', workbook);
  report(qcApply.status === 403, 'QC cannot apply (403)', `status ${qcApply.status}`);

  console.log('\n[5] Apply the import');
  const apply = await upload(admin, '/products/import/apply', 'import-test.xlsx', workbook);
  report(apply.status === 200, 'apply returns 200', `status ${apply.status} ${JSON.stringify(apply.json)}`);
  if (apply.status !== 200) process.exit(1);
  report(apply.json.imported === 3, 'apply imported exactly 3 rows', `imported ${apply.json.imported}`);
  report(apply.json.skippedRows === 6, 'apply skipped the 6 invalid rows', `skippedRows ${apply.json.skippedRows}`);

  const products = await api(admin, 'GET', '/products/search?q=IMP-TEST&limit=50');
  const flat: any[] = Array.isArray(products.json) ? products.json : [];
  const bySku = new Map<string, any>(flat.map((p) => [String(p.sku), p]));
  report(bySku.has('IMP-TEST-001'), 'row 2 (IMP-TEST-001) is in the catalogue');
  report(bySku.has('IMP-TEST-005'), 'shared row (IMP-TEST-005) is in the catalogue');
  const auto = flat.find((p) => p.name === 'IMP-TEST XLPE' && p.grade === 'IMP WH 9407');
  report(Boolean(auto), 'auto-SKU row inserted', 'row with grade IMP WH 9407 not found');
  if (auto) {
    report(/^KLJ-IMPTES-\d{3}$/i.test(String(auto.sku)), 'auto-SKU follows KLJ-<NAME>-NNN', `sku ${auto.sku}`);
    report(String(auto.manufacturer).toUpperCase().includes('SELF'), 'blank manufacturer defaulted to SELF (KLJ)', String(auto.manufacturer));
  }
  const row2 = bySku.get('IMP-TEST-001');
  if (row2) report(String(row2.division_id) === String(trpId), 'row 2 stamped with division A', JSON.stringify(row2.division_id));
  else report(false, 'row 2 stamped with division A', 'row not found');
  report(row2 && String(row2.bag_quantity_id) === String(kgId), 'row 2 carries the UOM (uoms master) on insert', JSON.stringify(row2?.bag_quantity_id));
  const row10 = bySku.get('IMP-TEST-005');
  report(row10 && String(row10.bag_quantity_id) === String(bag25Id), 'shared row carries the bag-quantity id (bag_quantities master) on insert', JSON.stringify(row10?.bag_quantity_id));
  const row9 = bySku.get('IMP-TEST-005');
  if (row9) report(row9.division_id === null || row9.division_id === undefined, 'shared row has no division (all divisions)', JSON.stringify(row9.division_id));
  else report(false, 'shared row has no division (all divisions)', 'row not found');
  report(!bySku.has('IMP-TEST-002') && !bySku.has('IMP-TEST-003') && !bySku.has('IMP-TEST-004'), 'error rows were not inserted');
  report(!bySku.has('IMP-DUPE-001'), 'duplicate-in-file rows were not inserted');
  report(bySku.size >= 3, 'at least 3 IMP-TEST rows present', `count ${bySku.size}`);

  console.log('\n[6] Grade master list updated');
  const gradeCheck = await api(admin, 'GET', '/masters/grades');
  const grades: any[] = Array.isArray(gradeCheck.json) ? gradeCheck.json : gradeCheck.json?.grades ?? [];
  const gradeText = JSON.stringify(grades);
  report(gradeText.includes('IMP BK 9406'), 'grade IMP BK 9406 added to master list', gradeText.slice(0, 200));

  console.log('\n[7] Template for a specific division names the division in the guide');
  const trpTemplate = await downloadTemplate(admin, trpId);
  const wb2 = new ExcelJS.Workbook();
  await wb2.xlsx.load(trpTemplate.buffer as any);
  let guide2 = '';
  wb2.getWorksheet('How To Import')?.eachRow((row) => { guide2 += (row.values as unknown as unknown[]).join(' ') + '\n'; });
  report(guide2.includes(trpName), 'division-specific template names the division');

  console.log('\n[8] Division template end-to-end — rows land in the picked division, no Division column');
  const divTpl = await downloadTemplate(admin, trpId);
  const wb3 = new ExcelJS.Workbook();
  await wb3.xlsx.load(divTpl.buffer as any);
  const p3 = wb3.getWorksheet('Products')!;
  p3.addRow(['IMP-TPL XLPE', 'IMP TPL GRADE 1', 'IMP-TPL-001', 'Acme Resins', kgName, 'from the division template']);
  p3.addRow(['IMP-TPL XLPE', 'IMP TPL GRADE 2', '', '', kgName, '']);
  const divBuffer = Buffer.from(await wb3.xlsx.writeBuffer());
  const val3 = await upload(admin, '/products/import/validate', 'div-template.xlsx', divBuffer);
  report(val3.status === 200, 'validate accepts the filled division template', `status ${val3.status} ${JSON.stringify(val3.json)}`);
  if (val3.status === 200) {
    report(val3.json.templateDivision === trpName, 'validate reports the template division', JSON.stringify(val3.json.templateDivision));
    report(val3.json.summary.total === 2 && val3.json.summary.errors === 0, 'both rows are valid to import', JSON.stringify(val3.json.summary));
    report(val3.json.summary.noDivision === 0, 'no all-divisions warning for a division template', JSON.stringify(val3.json.summary));
    report(val3.json.summary.missingSku === 1 && val3.json.summary.missingManufacturer === 1 && val3.json.summary.defaults === 1, 'defaults counted once, not per row', JSON.stringify(val3.json.summary));
    report((val3.json.rows as any[]).length === 0, 'no per-row findings for rows using defaults', `rows.length = ${(val3.json.rows as any[]).length}`);
  }
  const app3 = await upload(admin, '/products/import/apply', 'div-template.xlsx', divBuffer);
  report(app3.status === 200 && app3.json.imported === 2, 'apply imports both division-template rows', `status ${app3.status} imported ${app3.json?.imported}`);
  report(app3.json?.templateDivision === trpName, 'apply reports the template division', JSON.stringify(app3.json?.templateDivision));
  const tplProducts = await api(admin, 'GET', '/products/search?q=IMP-TPL&limit=10');
  const tplRows: any[] = Array.isArray(tplProducts.json) ? tplProducts.json : [];
  report(tplRows.length >= 2, 'division-template products are in the catalogue', `count ${tplRows.length}`);
  report(tplRows.every((r) => String(r.division_id) === String(trpId)), 'division-template rows are stamped with division A', JSON.stringify(tplRows.map((r) => r.division_id)));
  const tplLine = tplRows.find((r) => r.sku === 'IMP-TPL-001');
  report(tplLine && String(tplLine.bag_quantity_id) === String(kgId), 'division-template row carries the UOM on insert', JSON.stringify(tplLine?.bag_quantity_id));

  console.log('\n[9] Families list sorts naturally (P1 < P9 < P89 < P90)');
  const orderCases: Array<[string, string]> = [
    [`ORD-A P9-${stamp}`, `ORD-A-P9-${stamp}`],
    [`ORD-A P89-${stamp}`, `ORD-A-P89-${stamp}`],
    [`ORD-A P1-${stamp}`, `ORD-A-P1-${stamp}`],
    [`ORD-A P90-${stamp}`, `ORD-A-P90-${stamp}`],
  ];
  for (const [name, sku] of orderCases) {
    const created = await api(admin, 'POST', '/products', { name, sku, price: 1, quantity: 1 }, trpId);
    if (created.status !== 201) report(false, `seed family ${name}`, `status ${created.status} ${JSON.stringify(created.json)}`);
  }
  const familiesRes = await api(admin, 'GET', '/products/families');
  const families: any[] = Array.isArray(familiesRes.json) ? familiesRes.json : [];
  const orderOf = (marker: string) => families.findIndex((f) => String(f.name) === marker);
  const p1 = orderOf(`ORD-A P1-${stamp}`), p9 = orderOf(`ORD-A P9-${stamp}`), p89 = orderOf(`ORD-A P89-${stamp}`), p90 = orderOf(`ORD-A P90-${stamp}`);
  report([p1, p9, p89, p90].every((i) => i >= 0), 'seeded order-test families are all returned', JSON.stringify({ p1, p9, p89, p90 }));
  report(p1 < p9 && p9 < p89 && p89 < p90, 'families list sorts numerically, not lexicographically', `order P1=${p1} P9=${p9} P89=${p89} P90=${p90}`);

  console.log(`\n${checks} checks, ${failures} failures`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error('Probe crashed:', error);
  process.exit(1);
});
