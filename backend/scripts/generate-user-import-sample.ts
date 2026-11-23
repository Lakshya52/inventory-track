/**
 * Generate a filled USER import sample covering every role × division
 * combination. Uses the app's own template so dropdowns/headers match.
 * This only writes an .xlsx file — it does NOT import anything.
 * Run: cd backend && npx tsx scripts/generate-user-import-sample.ts
 */
import ExcelJS from 'exceljs';
import fs from 'node:fs';
import path from 'node:path';
import { MongoClient } from 'mongodb';
import { buildUserImportTemplate } from '../src/services/userImportTemplate';

const PASSWORD = 'Sample@123';

async function main() {
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/factory_inventory';
  const dbName = process.env.MONGO_DB_NAME || (() => {
    const match = /^mongodb(?:\+srv)?:\/\/[^/]+\/([^/?]+)/i.exec(uri);
    return match ? decodeURIComponent(match[1]) : 'factory_inventory';
  })();
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(dbName);
  const tenant = await db.collection('tenants').findOne({ name: 'KLJ' });
  if (!tenant) throw new Error('KLJ tenant not found');
  const divisions = (await db.collection('divisions')
    .find({ tenant_id: String(tenant._id), is_active: 1 }, { projection: { name: 1 } })
    .sort({ name: 1 })
    .toArray())
    .map((doc: any) => String(doc.name ?? ''));
  await client.close();
  if (divisions.length === 0) throw new Error('No active divisions found for KLJ');

  const [firstDivision, secondDivision] = divisions;
  const rows: Array<[string, string, string, string]> = [
    // Role, Division, sample label — every role × division combination.
    ['QC', firstDivision, 'qc-div1-a'],
    ['QC', firstDivision, 'qc-div1-b'],
    ['QC', secondDivision, 'qc-div2-a'],
    ['QC', secondDivision, 'qc-div2-b'],
    ['QC', '', 'qc-no-div'],
    ['DISPATCH', firstDivision, 'dispatch-div1-a'],
    ['DISPATCH', firstDivision, 'dispatch-div1-b'],
    ['DISPATCH', secondDivision, 'dispatch-div2-a'],
    ['DISPATCH', secondDivision, 'dispatch-div2-b'],
    ['DISPATCH', '', 'dispatch-no-div'],
  ];

  const template = await buildUserImportTemplate([], divisions);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(template as any);
  const sheet = workbook.getWorksheet('Users');
  if (!sheet) throw new Error('Users sheet missing from template');

  rows.forEach(([role, division, label], index) => {
    const excelRow = index + 2;
    sheet.getCell(excelRow, 1).value = `Sample ${label}`;
    sheet.getCell(excelRow, 2).value = `sample.${label}@example.test`;
    sheet.getCell(excelRow, 3).value = division;
    sheet.getCell(excelRow, 4).value = role;
    sheet.getCell(excelRow, 5).value = PASSWORD;
  });

  const outPath = path.resolve(__dirname, '../../User_Import_Sample_All_Combinations.xlsx');
  await workbook.xlsx.writeFile(outPath);
  console.log(`Wrote ${rows.length} users to ${outPath}`);
  console.log('Divisions used:', divisions.join(' | '));
  console.log('Password for all rows:', PASSWORD);
  rows.forEach(([role, division, label], index) =>
    console.log(`  row ${index + 2}: ${role} | ${division || '(blank)'} | sample.${label}@example.test`));
}

main().catch((error) => { console.error(error); process.exit(1); });
