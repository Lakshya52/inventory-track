/**
 * Builds the import template workbook. Two flavors:
 *
 *   A) Division template (downloaded while a division is selected in the wizard):
 *      - Sheet "How To Import"  — a one-glance card (columns, rules, live examples).
 *      - Sheet "Products"       — the data sheet: Product | Grade | SKU | Manufacturer | Description.
 *                                 Every row imports into the division picked in the wizard — no
 *                                 Division column to fill in.
 *      - Sheet "__import_meta"  — very-hidden marker carrying the target division name,
 *                                 read back by the importer to stamp every row.
 *
 *   B) All-divisions template (downloaded with "All divisions" selected):
 *      - Sheet "How To Import"  — same card, including the Division column row.
 *      - Sheet "Products"       — Division | Product | Grade | SKU | Manufacturer | Description
 *                                 (Division has a dropdown; blank = visible in EVERY division).
 */
import ExcelJS from 'exceljs';
import { META_SHEET } from './importValidation';

export type TemplateInput = {
  /** Display name of the division the user selected, or null when "all divisions" */
  selectedDivision: string | null;
  /** The tenant's real divisions, for the dropdown (all-divisions template only) */
  divisions: string[];
  /** The tenant's active UOM names, for the dropdown */
  uoms: string[];
  /** Up to N real catalog rows to use as live examples in the guide */
  examples: {
    division: string | null;
    product: string;
    grade: string;
    sku: string;
    manufacturer: string;
    uom: string | null;
    description: string | null;
  }[];
};

const DIVISION_COLUMNS = [
  { key: 'division', header: 'Division', width: 24 },
  { key: 'product', header: 'Product', width: 30 },
  { key: 'grade', header: 'Grade', width: 28 },
  { key: 'sku', header: 'SKU', width: 20 },
  { key: 'manufacturer', header: 'Manufacturer', width: 24 },
  { key: 'uom', header: 'UOM', width: 22 },
  { key: 'description', header: 'Description (optional)', width: 40 },
] as const;

const SHARED_COLUMNS = DIVISION_COLUMNS.filter((c) => c.key !== 'division');

const NAVY = '1F2A44';
const TEAL = '0F766E';
const SOFT = 'EEF2F7';
const HEADER_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } };
const TEAL_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: TEAL } };
const SOFT_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SOFT } };
const WHITE_FONT: Partial<ExcelJS.Font> = { color: { argb: 'FFFFFF' }, bold: true, name: 'Calibri', size: 11 };

function bodyRow(ws: ExcelJS.Worksheet, row: number, colA: string, colB: string, fill?: boolean, height = 22) {
  const a = ws.getCell(`A${row}`);
  const b = ws.getCell(`B${row}`);
  a.value = colA;
  b.value = colB;
  a.font = { bold: true, name: 'Calibri', size: 10, color: { argb: NAVY } };
  b.font = { name: 'Calibri', size: 10, color: { argb: '334155' } };
  b.alignment = { wrapText: true, vertical: 'middle' };
  a.alignment = { vertical: 'middle' };
  ws.mergeCells(`B${row}:G${row}`);
  if (fill) {
    for (const col of ['A', 'B', 'C', 'D', 'E', 'F', 'G']) ws.getCell(`${col}${row}`).fill = SOFT_FILL;
  }
  ws.getRow(row).height = height;
  return row + 1;
}

function sectionHeader(ws: ExcelJS.Worksheet, row: number, text: string): number {
  ws.mergeCells(`A${row}:G${row}`);
  const cell = ws.getCell(`A${row}`);
  cell.value = text;
  cell.font = { bold: true, size: 12, color: { argb: 'FFFFFF' }, name: 'Calibri' };
  cell.fill = TEAL_FILL;
  cell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  ws.getRow(row).height = 22;
  return row + 1;
}

export async function buildImportTemplate(input: TemplateInput): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Aceone Inventory';
  workbook.company = 'Aceone Inventory';
  workbook.created = new Date();

  const isDivision = Boolean(input.selectedDivision);
  const DATA_COLUMNS = isDivision ? SHARED_COLUMNS : DIVISION_COLUMNS;

  // ---------- Sheet 1 — one-glance guide ----------
  const guide = workbook.addWorksheet('How To Import', {
    views: [{ showGridLines: false, state: 'frozen', ySplit: 2 }],
  });
  guide.getColumn('A').width = 18;
  guide.getColumn('B').width = 26;
  guide.getColumn('C').width = 34;
  guide.getColumn('D').width = 22;
  guide.getColumn('E').width = 22;
  guide.getColumn('F').width = 22;
  guide.getColumn('G').width = 40;

  guide.mergeCells('A1:G1');
  guide.getCell('A1').value = 'How to import';
  guide.getCell('A1').font = { bold: true, size: 18, color: { argb: 'FFFFFF' }, name: 'Calibri' };
  guide.getCell('A1').fill = HEADER_FILL;
  guide.getCell('A1').alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  guide.getRow(1).height = 30;

  guide.mergeCells('A2:G2');
  guide.getCell('A2').value = isDivision
    ? `Fill the Products sheet (one row per grade), then upload it in the app — every row imports into ${input.selectedDivision}.`
    : 'Fill the Products sheet (one row per grade), then upload it in the app. Blank Division = visible in every division.';
  guide.getCell('A2').font = { italic: true, size: 10, color: { argb: 'CBD5E1' }, name: 'Calibri' };
  guide.getCell('A2').fill = HEADER_FILL;
  guide.getCell('A2').alignment = { vertical: 'middle', horizontal: 'left', indent: 1, wrapText: true };
  guide.getRow(2).height = 22;

  let row = 4;

  // ---- Columns (compact table)
  row = sectionHeader(guide, row, '▌ Columns');
  const columnRows: Array<[string, string, string]> = isDivision
    ? [
        ['Product', 'required', 'One product can have many grades.'],
        ['Grade', 'required', 'The sellable grade — must exist in your grades list.'],
        ['SKU', 'optional', 'Unique code. Blank = auto-generated (KLJ-<name>-NNN).'],
        ['Manufacturer', 'optional', 'Blank = SELF (KLJ).'],
        ['UOM', 'optional', "Pick from the dropdown (e.g. \"Kg\", \"Bag\", \"25 Kg\") — blank is allowed, unknown values are rejected."],
        ['Description', 'optional', 'Free text.'],
      ]
    : [
        ['Division', 'optional', 'Pick from the dropdown. Blank = visible in every division.'],
        ['Product', 'required', 'One product can have many grades.'],
        ['Grade', 'required', 'The sellable grade — must exist in your grades list.'],
        ['SKU', 'optional', 'Unique code. Blank = auto-generated (KLJ-<name>-NNN).'],
        ['Manufacturer', 'optional', 'Blank = SELF (KLJ).'],
        ['UOM', 'optional', "Pick from the dropdown (e.g. \"Kg\", \"Bag\", \"25 Kg\") — blank is allowed, unknown values are rejected."],
        ['Description', 'optional', 'Free text.'],
      ];
  for (const [col, required, note] of columnRows) {
    guide.getCell(`A${row}`).value = col;
    guide.getCell(`B${row}`).value = required;
    guide.mergeCells(`C${row}:G${row}`);
    guide.getCell(`C${row}`).value = note;
    guide.getCell(`A${row}`).font = { bold: true, name: 'Calibri', size: 10, color: { argb: NAVY } };
    guide.getCell(`B${row}`).font = { name: 'Calibri', size: 10, bold: true, color: { argb: required === 'required' ? 'B91C1C' : '0F766E' } };
    guide.getCell(`C${row}`).font = { name: 'Calibri', size: 10, color: { argb: '334155' } };
    guide.getCell(`A${row}`).alignment = { vertical: 'middle' };
    guide.getCell(`B${row}`).alignment = { vertical: 'middle', horizontal: 'center' };
    guide.getCell(`C${row}`).alignment = { vertical: 'middle', wrapText: true };
    for (const c of ['A', 'B', 'C', 'D', 'E', 'F', 'G']) {
      guide.getCell(`${c}${row}`).border = { bottom: { style: 'hair', color: { argb: 'E2E8F0' } } };
    }
    guide.getRow(row).height = 20;
    row += 1;
  }
  row += 1;

  // ---- Rules (four one-liners)
  row = sectionHeader(guide, row, '▌ Rules');
  if (isDivision) {
    row = bodyRow(guide, row, '1', `Every row imports into ${input.selectedDivision} — no Division column needed.`, true);
    row = bodyRow(guide, row, '2', 'Product and Grade are required — a row missing either is rejected.');
    row = bodyRow(guide, row, '3', 'SKU must be unique, in the file and in the catalogue — duplicates are rejected.', true);
    row = bodyRow(guide, row, '4', 'Blank Manufacturer = SELF (KLJ) · blank SKU = auto-generated · blank UOM = saved without one.');
  } else {
    row = bodyRow(guide, row, '1', 'Product and Grade are required — a row missing either is rejected.', true);
    row = bodyRow(guide, row, '2', 'SKU must be unique, in the file and in the catalogue — duplicates are rejected.');
    row = bodyRow(guide, row, '3', 'Blank Division = imported into ALL divisions. The app will ask you to confirm this.', true);
    row = bodyRow(guide, row, '4', 'Blank Manufacturer = SELF (KLJ) · blank SKU = auto-generated · blank UOM = saved without one.');
  }
  row += 1;

  // ---- Examples from the live catalog (if any)
  if (input.examples.length > 0) {
    row = sectionHeader(guide, row, '▌ Your data — copy this shape');
    const cols = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];
    const labels = isDivision
      ? ['Product', 'Grade', 'SKU', 'Manufacturer', 'UOM', 'Description']
      : ['Division', 'Product', 'Grade', 'SKU', 'Manufacturer', 'UOM', 'Description'];
    const valueAt = (example: (typeof input.examples)[number], label: string): string => {
      switch (label) {
        case 'Division': return example.division ?? '(all divisions)';
        case 'Product': return example.product;
        case 'Grade': return example.grade;
        case 'SKU': return example.sku;
        case 'Manufacturer': return example.manufacturer;
        case 'UOM': return example.uom ?? '';
        default: return example.description ?? '';
      }
    };
    for (const [index, label] of labels.entries()) {
      guide.getCell(`${cols[index]}${row}`).value = label;
      guide.getCell(`${cols[index]}${row}`).fill = SOFT_FILL;
      guide.getCell(`${cols[index]}${row}`).font = { bold: true, size: 9, name: 'Calibri', color: { argb: NAVY } };
      guide.getCell(`${cols[index]}${row}`).alignment = { vertical: 'middle' };
    }
    guide.getRow(row).height = 18;
    row += 1;
    for (const example of input.examples) {
      for (const [index, label] of labels.entries()) {
        guide.getCell(`${cols[index]}${row}`).value = String(valueAt(example, label));
        guide.getCell(`${cols[index]}${row}`).font = { name: 'Calibri', size: 9, color: { argb: '1F2A44' } };
        guide.getCell(`${cols[index]}${row}`).alignment = { vertical: 'middle', wrapText: true };
        guide.getCell(`${cols[index]}${row}`).border = { bottom: { style: 'hair', color: { argb: 'E2E8F0' } } };
      }
      guide.getRow(row).height = 20;
      row += 1;
    }
  } else {
    row = bodyRow(guide, row, 'No products yet', 'Add a product in the app first — this sheet will then show live examples from your own data.');
  }

  // ---------- Sheet 2 — Products data sheet ----------
  const data = workbook.addWorksheet('Products', {
    views: [{ state: 'frozen', ySplit: 1, showGridLines: false }],
  });
  data.columns = DATA_COLUMNS.map(({ key, width }) => ({ key, width }));
  const headerRow = data.getRow(1);
  for (const [index, { header }] of DATA_COLUMNS.entries()) {
    const cell = headerRow.getCell(index + 1);
    cell.value = header;
    cell.fill = HEADER_FILL;
    cell.font = WHITE_FONT;
    cell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  }
  headerRow.height = 26;

  // Data sheet ships EMPTY on purpose — the guide carries the live examples,
  // so an unedited template cannot re-import duplicate rows.
  // Division dropdown (inline list; strips commas/quotes/caps at 250 chars)
  if (!isDivision) {
    const DROPDOWN_LAST_ROW = 1001;
    const divisionList = [...new Set(input.divisions)]
      .map((name) => name.replace(/[",]/g, ' ').trim())
      .filter((name) => name.length > 0)
      .join(',')
      .slice(0, 250);
    if (divisionList.length > 0) {
      for (let r = 2; r <= DROPDOWN_LAST_ROW; r += 1) {
        data.getCell(`A${r}`).dataValidation = {
          type: 'list',
          allowBlank: true,
          formulae: ['"' + divisionList + '"'],
          showErrorMessage: true,
          errorStyle: 'warning',
          errorTitle: 'Unknown division',
          error: 'Pick one of your divisions from the dropdown, or leave blank to share this product across all divisions.',
        };
      }
    }
  }

  // UOM dropdown — column E in the division flavor, column F in the all-divisions flavor
  {
    const DROPDOWN_LAST_ROW = 1001;
    const uomList = [...new Set(input.uoms)]
      .map((name) => name.replace(/[",]/g, ' ').trim())
      .filter((name) => name.length > 0)
      .join(',')
      .slice(0, 250);
    if (uomList.length > 0) {
      const uomColumn = isDivision ? 'E' : 'F';
      for (let r = 2; r <= DROPDOWN_LAST_ROW; r += 1) {
        data.getCell(`${uomColumn}${r}`).dataValidation = {
          type: 'list',
          allowBlank: true,
          formulae: ['"' + uomList + '"'],
          showErrorMessage: true,
          errorStyle: 'warning',
          errorTitle: 'Unknown UOM',
          error: 'Pick one of your units from the dropdown, or leave blank to save without a UOM.',
        };
      }
    }
  }

  data.autoFilter = isDivision ? 'A1:F1' : 'A1:G1';

  // ---------- Sheet 3 — very-hidden marker (division templates only) ----------
  if (isDivision && input.selectedDivision) {
    const meta = workbook.addWorksheet(META_SHEET, { state: 'veryHidden' });
    meta.getCell('A1').value = 'division_name';
    meta.getCell('A2').value = input.selectedDivision;
  }

  const buf = await workbook.xlsx.writeBuffer();
  return Buffer.from(buf);
}
