/**
 * Workbook template for the users bulk import.
 * Data sheet ships empty so an unedited template can never re-import duplicates.
 */
import ExcelJS from 'exceljs';
import { USER_IMPORT_COLUMNS } from './userImport';

const NAVY = '1F2A44';
const TEAL = '0F766E';
const SOFT = 'EEF2F7';
const HEADER_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } };
const TEAL_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: TEAL } };
const SOFT_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SOFT } };
const WHITE_FONT: Partial<ExcelJS.Font> = { color: { argb: 'FFFFFF' }, bold: true, name: 'Calibri', size: 11 };

export type UserImportExample = {
  name: string;
  email: string;
  division: string;
  role: string;
};

export async function buildUserImportTemplate(
  examples: UserImportExample[],
  divisions: string[] = [],
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Aceone Inventory';
  workbook.company = 'Aceone Inventory';
  workbook.created = new Date();

  const columns = [...USER_IMPORT_COLUMNS];
  const notes: Record<string, string> = {
    Name: 'Required. Full name of the user.',
    Email: 'Required. Must be unique across all user types and a valid address.',
    Division: 'Optional. Pick from the dropdown (your divisions in Masters → Divisions). Leave blank for a tenant-wide user with no division.',
    Role: 'Required. Pick QC or DISPATCH from the dropdown. The ADMIN account cannot be imported.',
    'Initial password': 'Required. At least 6 characters. Share it securely with the user — it is stored as a hash.',
  };
  const required = new Set(['Name', 'Email', 'Role', 'Initial password']);

  // ---------- Sheet 1 — one-glance guide ----------
  const guide = workbook.addWorksheet('How To Import', {
    views: [{ showGridLines: false, state: 'frozen', ySplit: 2 }],
  });
  guide.getColumn('A').width = 22;
  guide.getColumn('B').width = 16;
  guide.getColumn('C').width = 78;
  guide.mergeCells('A1:C1');
  guide.getCell('A1').value = 'How to import users';
  guide.getCell('A1').font = { bold: true, size: 18, color: { argb: 'FFFFFF' }, name: 'Calibri' };
  guide.getCell('A1').fill = HEADER_FILL;
  guide.getCell('A1').alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  guide.getRow(1).height = 30;
  guide.mergeCells('A2:C2');
  guide.getCell('A2').value = 'Fill the Users sheet (one row per user), then upload it in the app. Invalid rows are never written.';
  guide.getCell('A2').font = { italic: true, size: 10, color: { argb: 'CBD5E1' }, name: 'Calibri' };
  guide.getCell('A2').fill = HEADER_FILL;
  guide.getCell('A2').alignment = { vertical: 'middle', horizontal: 'left', indent: 1, wrapText: true };
  guide.getRow(2).height = 22;

  let row = 4;
  guide.mergeCells(`A${row}:C${row}`);
  guide.getCell(`A${row}`).value = '▌ Columns';
  guide.getCell(`A${row}`).font = { bold: true, size: 12, color: { argb: 'FFFFFF' }, name: 'Calibri' };
  guide.getCell(`A${row}`).fill = TEAL_FILL;
  guide.getCell(`A${row}`).alignment = { vertical: 'middle', indent: 1 };
  row += 1;
  for (const column of columns) {
    guide.getCell(`A${row}`).value = column;
    guide.getCell(`B${row}`).value = required.has(column) ? 'required' : 'optional';
    guide.getCell(`C${row}`).value = notes[column] || '';
    guide.getCell(`A${row}`).font = { bold: true, size: 10, color: { argb: NAVY }, name: 'Calibri' };
    guide.getCell(`B${row}`).font = { bold: true, size: 10, color: { argb: required.has(column) ? 'B91C1C' : '0F766E' }, name: 'Calibri' };
    guide.getCell(`C${row}`).font = { size: 10, color: { argb: '334155' }, name: 'Calibri' };
    guide.getCell(`C${row}`).alignment = { wrapText: true, vertical: 'middle' };
    guide.getRow(row).height = 28;
    row += 1;
  }
  row += 1;
  guide.mergeCells(`A${row}:C${row}`);
  guide.getCell(`A${row}`).value = '▌ Rules';
  guide.getCell(`A${row}`).font = { bold: true, size: 12, color: { argb: 'FFFFFF' }, name: 'Calibri' };
  guide.getCell(`A${row}`).fill = TEAL_FILL;
  guide.getCell(`A${row}`).alignment = { vertical: 'middle', indent: 1 };
  row += 1;
  const rules = [
    'Email must be unique across Admin, QC and Dispatch — duplicates in the file or in the system are rejected.',
    'Only QC and DISPATCH users can be imported — the single ADMIN account is managed inside the app, not from Excel.',
    'Division is optional — pick from the dropdown, or leave it blank to create a user with no division assigned.',
    'Passwords are at least 6 characters and are stored as a hash. Share them securely with each user.',
    'Only rows that pass validation are created. Fix any red rows in the report and re-upload.',
  ];
  for (const [index, rule] of rules.entries()) {
    guide.getCell(`A${row}`).value = String(index + 1);
    guide.getCell(`B${row}`).value = rule;
    guide.mergeCells(`B${row}:C${row}`);
    guide.getCell(`A${row}`).font = { bold: true, size: 10, color: { argb: NAVY }, name: 'Calibri' };
    guide.getCell(`B${row}`).font = { size: 10, color: { argb: '334155' }, name: 'Calibri' };
    guide.getCell(`B${row}`).alignment = { wrapText: true, vertical: 'middle' };
    guide.getRow(row).height = 26;
    row += 1;
  }

  if (examples.length > 0) {
    row += 1;
    guide.mergeCells(`A${row}:C${row}`);
    guide.getCell(`A${row}`).value = '▌ Your data — copy this shape';
    guide.getCell(`A${row}`).font = { bold: true, size: 12, color: { argb: 'FFFFFF' }, name: 'Calibri' };
    guide.getCell(`A${row}`).fill = TEAL_FILL;
    guide.getCell(`A${row}`).alignment = { vertical: 'middle', indent: 1 };
    row += 1;
    for (const [index, column] of columns.entries()) {
      const guideCell = guide.getRow(row).getCell(index + 1);
      guideCell.value = column;
      guideCell.fill = SOFT_FILL;
      guideCell.font = { bold: true, size: 9, name: 'Calibri', color: { argb: NAVY } };
    }
    row += 1;
    for (const example of examples) {
      const values: Record<string, string> = {
        Name: example.name,
        Email: example.email,
        Division: example.division,
        Role: example.role,
        'Initial password': '',
      };
      for (const [index, column] of columns.entries()) {
        const guideCell = guide.getRow(row).getCell(index + 1);
        guideCell.value = values[column] ?? '';
        guideCell.font = { size: 9, color: { argb: NAVY }, name: 'Calibri' };
        guideCell.alignment = { vertical: 'middle' };
      }
      row += 1;
    }
  }

  // ---------- Sheet 2 — data sheet ----------
  const data = workbook.addWorksheet('Users', {
    views: [{ state: 'frozen', ySplit: 1, showGridLines: false }],
  });
  data.columns = columns.map((header, index) => ({ key: `c${index}`, width: Math.max(18, Math.min(40, header.length + 12)) }));
  const headerRow = data.getRow(1);
  columns.forEach((header, index) => {
    const cell = headerRow.getCell(index + 1);
    cell.value = header;
    cell.fill = HEADER_FILL;
    cell.font = WHITE_FONT;
    cell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  });
  headerRow.height = 26;

  // Dropdowns for Division (C) and Role (D). Inline list values cannot exceed
  // 255 chars, so cap the division list as the other import templates do.
  const divisionList = [...new Set(divisions)]
    .map((name) => name.replace(/[",]/g, ' ').trim())
    .filter((name) => name.length > 0)
    .join(',')
    .slice(0, 250);
  for (let r = 2; r <= 5001; r += 1) {
    if (divisionList.length > 0) {
      data.getCell(`C${r}`).dataValidation = {
        type: 'list',
        allowBlank: true,
        formulae: ['"' + divisionList + '"'],
        showErrorMessage: true,
        errorStyle: 'stop',
        errorTitle: 'Unknown division',
        error: 'Pick one of your divisions from the dropdown, or leave the cell blank to create a user with no division.',
      };
    }
    data.getCell(`D${r}`).dataValidation = {
      type: 'list',
      allowBlank: false,
      formulae: ['"QC,DISPATCH"'],
      showErrorMessage: true,
      errorStyle: 'stop',
      errorTitle: 'Invalid role',
      error: 'Only QC and DISPATCH users can be imported from Excel. The ADMIN account is managed inside the app.',
    };
  }

  data.autoFilter = `A1:${data.getColumn(columns.length).letter}1`;

  return Buffer.from(await workbook.xlsx.writeBuffer());
}
