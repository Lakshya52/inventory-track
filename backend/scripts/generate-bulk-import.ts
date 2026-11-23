/**
 * Generate a filled product-import workbook: 5 products x 10,000 grades.
 * Uses the app's own template builder so headers/guide match exactly.
 * Run: npx tsx scripts/generate-bulk-import.ts
 */
import ExcelJS from 'exceljs';
import fs from 'node:fs';
import path from 'node:path';
import { buildImportTemplate } from '../src/services/importTemplate';

const PRODUCTS = [
  'BULK IMPORT PRODUCT 01',
  'BULK IMPORT PRODUCT 02',
  'BULK IMPORT PRODUCT 03',
  'BULK IMPORT PRODUCT 04',
  'BULK IMPORT PRODUCT 05',
];
const GRADES_PER_PRODUCT = 10_000;

async function main() {
  const template = await buildImportTemplate({
    selectedDivision: null,
    divisions: [],
    uoms: ['KG'],
    examples: [],
  });

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(template as any);
  const sheet = workbook.getWorksheet('Products');
  if (!sheet) throw new Error('Products sheet missing from generated template');

  let excelRow = 2;
  for (let productIndex = 0; productIndex < PRODUCTS.length; productIndex += 1) {
    const product = PRODUCTS[productIndex];
    const code = `BIP${String(productIndex + 1).padStart(2, '0')}`;
    for (let gradeNumber = 1; gradeNumber <= GRADES_PER_PRODUCT; gradeNumber += 1) {
      const seq = String(gradeNumber).padStart(5, '0');
      // Blank Division => visible in all divisions (wizard asks to confirm).
      sheet.getCell(excelRow, 1).value = '';
      sheet.getCell(excelRow, 2).value = product;
      sheet.getCell(excelRow, 3).value = `${code}-GRADE-${seq}`;
      sheet.getCell(excelRow, 4).value = `${code}-${seq}`;
      sheet.getCell(excelRow, 5).value = 'SELF (KLJ)';
      sheet.getCell(excelRow, 6).value = 'KG';
      sheet.getCell(excelRow, 7).value = `Bulk import grade ${seq} for ${product}`;
      excelRow += 1;
    }
  }

  const outPath = path.resolve(
    __dirname,
    '../../Bulk_Import_5_Products_50000_Grades.xlsx',
  );
  await workbook.xlsx.writeFile(outPath);
  const sizeMb = (fs.statSync(outPath).size / 1024 / 1024).toFixed(2);
  console.log(`Wrote ${excelRow - 2} grade rows to ${outPath} (${sizeMb} MB)`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
