/**
 * Workbook template for the clients / vendors bulk import.
 * Data sheet ships empty so an unedited template can never re-import duplicates.
 * Live catalogue rows (if any) appear only as examples in the guide sheet.
 */
import ExcelJS from 'exceljs';
import { PARTY_COLUMNS, PartyKind } from './partyImport';

export type PartyExample = {
  name: string;
  code?: string | null;
  contact?: string | null;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  gst?: string | null;
};

const NAVY = '1F2A44';
const TEAL = '0F766E';
const SOFT = 'EEF2F7';
const HEADER_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } };
const TEAL_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: TEAL } };
const SOFT_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SOFT } };
const WHITE_FONT: Partial<ExcelJS.Font> = { color: { argb: 'FFFFFF' }, bold: true, name: 'Calibri', size: 11 };

export async function buildPartyImportTemplate(kind: PartyKind, examples: PartyExample[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Aceone Inventory';
  workbook.company = 'Aceone Inventory';
  workbook.created = new Date();

  const label = kind === 'clients' ? 'Client' : 'Vendor';
  const columns = PARTY_COLUMNS[kind];

  // ---------- Sheet 1 — one-glance guide ----------
  const guide = workbook.addWorksheet('How To Import', {
    views: [{ showGridLines: false, state: 'frozen', ySplit: 2 }],
  });
  guide.getColumn('A').width = 20;
  guide.getColumn('B').width = 16;
  guide.getColumn('C').width = 70;
  guide.mergeCells('A1:C1');
  guide.getCell('A1').value = `How to import ${kind}`;
  guide.getCell('A1').font = { bold: true, size: 18, color: { argb: 'FFFFFF' }, name: 'Calibri' };
  guide.getCell('A1').fill = HEADER_FILL;
  guide.getCell('A1').alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  guide.getRow(1).height = 30;
  guide.mergeCells('A2:C2');
  guide.getCell('A2').value = `Fill the ${label}s sheet (one row per ${label.toLowerCase()}), then upload it in the app. Invalid rows are never written.`;
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

  const notes: Record<string, string> = {
    Name: `Required. Unique within your organisation — duplicates are rejected.`,
    'Vendor code': 'Optional. Unique. Blank = auto-generated VND-XXXXXX.',
    'Contact person': 'Optional.',
    Email: 'Optional. Must be a valid address when filled.',
    Phone: 'Optional. Digits, spaces and + - ( ).',
    Address: 'Optional.',
    'GST number': 'Optional.',
    Category: 'Optional (e.g. Raw material, Packaging).',
    'Payment terms': 'Optional (e.g. 30 days).',
    Notes: 'Optional.',
  };
  const required = new Set(['Name']);
  for (const column of columns) {
    guide.getCell(`A${row}`).value = column;
    guide.getCell(`B${row}`).value = required.has(column) ? 'required' : 'optional';
    guide.getCell(`C${row}`).value = notes[column] || '';
    guide.getCell(`A${row}`).font = { bold: true, size: 10, color: { argb: NAVY }, name: 'Calibri' };
    guide.getCell(`B${row}`).font = { bold: true, size: 10, color: { argb: required.has(column) ? 'B91C1C' : '0F766E' }, name: 'Calibri' };
    guide.getCell(`C${row}`).font = { size: 10, color: { argb: '334155' }, name: 'Calibri' };
    guide.getCell(`C${row}`).alignment = { wrapText: true, vertical: 'middle' };
    guide.getRow(row).height = 20;
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
    `${label} name is required and must be unique — duplicates in the file or in your catalogue are rejected.`,
    kind === 'vendors'
      ? 'Vendor code is unique. Leave it blank to auto-generate VND-XXXXXX.'
      : `${label}s are shared across every division of your organisation — there is no Division column.`,
    'Only rows that pass validation are imported. Fix any red rows in the report and re-upload.',
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
      const cell = guide.getRow(row).getCell(index + 1);
      cell.value = column;
      cell.fill = SOFT_FILL;
      cell.font = { bold: true, size: 9, name: 'Calibri', color: { argb: NAVY } };
    }
    row += 1;
    for (const example of examples) {
      const values: Record<string, string> = {
        Name: example.name,
        'Vendor code': example.code ?? '',
        'Contact person': example.contact ?? '',
        Email: example.email ?? '',
        Phone: example.phone ?? '',
        Address: example.address ?? '',
        'GST number': example.gst ?? '',
        Category: '', 'Payment terms': '', Notes: '',
      };
      for (const [index, column] of columns.entries()) {
        const cell = guide.getRow(row).getCell(index + 1);
        cell.value = values[column] ?? '';
        cell.font = { size: 9, color: { argb: NAVY }, name: 'Calibri' };
        cell.alignment = { vertical: 'middle' };
      }
      row += 1;
    }
  }

  // ---------- Sheet 2 — data sheet ----------
  const data = workbook.addWorksheet(label + 's', {
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
  data.autoFilter = `A1:${data.getColumn(columns.length).letter}1`;

  return Buffer.from(await workbook.xlsx.writeBuffer());
}
