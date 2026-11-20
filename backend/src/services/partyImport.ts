/**
 * Bulk import for the tenant-wide party masters (clients and vendors).
 *
 * Mirrors the products import rules: template download → validate (no writes)
 * → apply (only rows that passed). Engine-agnostic — database lookups are
 * supplied by the controller as small callbacks.
 */
import XLSX from 'xlsx';

export type PartyKind = 'clients' | 'vendors';

export type PartyRow = {
  /** 1-based Excel row number (header = row 1, first data row = 2) */
  excelRow: number;
  name: string;
  /** Vendor code (vendors only) — blank for clients */
  code: string;
  contact: string;
  email: string;
  phone: string;
  address: string;
  gst: string;
  category: string;
  paymentTerms: string;
  notes: string;
};

export type RowFinding = {
  severity: 'error' | 'warning';
  message: string;
  code: string;
};

export type ValidatedPartyRow = PartyRow & {
  errors: RowFinding[];
  warnings: RowFinding[];
  status: 'valid' | 'warning' | 'error';
};

export type PartyHelpers = {
  /** Lower-cased names already in this tenant's master */
  existingNames: (names: string[]) => Promise<Set<string>>;
  /** Lower-cased vendor codes already in this tenant's master (vendors only) */
  existingCodes: (codes: string[]) => Promise<Set<string>>;
};

export const PARTY_COLUMNS: Record<PartyKind, string[]> = {
  clients: ['Name', 'Contact person', 'Email', 'Phone', 'Address', 'GST number'],
  vendors: [
    'Name', 'Vendor code', 'Contact person', 'Email', 'Phone',
    'Address', 'GST number', 'Category', 'Payment terms', 'Notes',
  ],
};

function text(value: unknown, max: number): string {
  if (typeof value === 'string') return value.trim().slice(0, max);
  if (typeof value === 'number') return String(value);
  return '';
}

function headerKey(value: string): string {
  return value.trim().toLowerCase().replace(/[\s_\-]+/g, '');
}

/** Header names are matched case/space insensitive ("GST Number" === "gst_number"). */
function cell(row: Record<string, unknown>, header: string, max: number): string {
  const wanted = headerKey(header);
  const key = Object.keys(row).find((candidate) => headerKey(candidate) === wanted);
  return key ? text(row[key], max) : '';
}

/**
 * Finds the data sheet by name (`Clients` / `Vendors`, any case) and reads it.
 * Fully blank rows (formatting only) are ignored so they are not counted as
 * importable — or reported as errors.
 */
export function parsePartySheet(buffer: Buffer, kind: PartyKind): PartyRow[] {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const sheetName = workbook.SheetNames.find((name) => name.trim().toLowerCase() === kind)
    ?? workbook.SheetNames[0];
  const sheet = sheetName ? workbook.Sheets[sheetName] : undefined;
  if (!sheet) throw new Error(`The uploaded file does not contain a sheet with the ${kind} table`);
  const raw: Array<Record<string, unknown>> = XLSX.utils.sheet_to_json(sheet, { defval: '' });
  if (raw.length === 0) {
    throw new Error(`The ${kind} sheet is empty — fill in at least one row before importing`);
  }
  const range = XLSX.utils.decode_range(sheet['!ref'] ?? 'A1');
  const rows: PartyRow[] = [];
  raw.forEach((row, index) => {
    const parsed: PartyRow = {
      excelRow: range.s.r + 2 + index,
      name: cell(row, 'Name', 200),
      code: kind === 'vendors' ? cell(row, 'Vendor code', 30).toUpperCase() : '',
      contact: cell(row, 'Contact person', 100),
      email: cell(row, 'Email', 100),
      phone: cell(row, 'Phone', 50),
      address: cell(row, 'Address', 1000),
      gst: cell(row, 'GST number', 50).toUpperCase(),
      category: cell(row, 'Category', 100),
      paymentTerms: cell(row, 'Payment terms', 100),
      notes: cell(row, 'Notes', 1000),
    };
    const hasData = Object.values(parsed).some((value, field) =>
      field > 0 && typeof value === 'string' && value.length > 0
    );
    if (hasData) rows.push(parsed);
  });
  if (rows.length === 0) {
    throw new Error(`The ${kind} sheet has no filled-in rows`);
  }
  return rows;
}

/** Validates every row; duplicates (in file and in catalogue) are hard errors. */
export async function validatePartyRows(
  rows: PartyRow[],
  helpers: PartyHelpers,
  kind: PartyKind
): Promise<ValidatedPartyRow[]> {
  const nameCounts = new Map<string, number>();
  const codeCounts = new Map<string, number>();
  for (const row of rows) {
    if (row.name) {
      const key = row.name.toLowerCase();
      nameCounts.set(key, (nameCounts.get(key) ?? 0) + 1);
    }
    if (row.code) {
      const key = row.code.toLowerCase();
      codeCounts.set(key, (codeCounts.get(key) ?? 0) + 1);
    }
  }
  const namesInDb = await helpers.existingNames(rows.map((row) => row.name.toLowerCase()).filter(Boolean));
  const codesInDb = kind === 'vendors'
    ? await helpers.existingCodes(rows.map((row) => row.code.toLowerCase()).filter(Boolean))
    : new Set<string>();

  return rows.map((row) => {
    const errors: RowFinding[] = [];
    const warnings: RowFinding[] = [];

    if (!row.name) {
      errors.push({ severity: 'error', code: 'MISSING_NAME', message: `${kind === 'clients' ? 'Client' : 'Vendor'} name is required` });
    } else {
      const key = row.name.toLowerCase();
      if ((nameCounts.get(key) ?? 0) > 1) {
        errors.push({ severity: 'error', code: 'DUPLICATE_NAME_IN_FILE', message: `Name "${row.name}" appears ${nameCounts.get(key)} times in this file` });
      }
      if (namesInDb.has(key)) {
        errors.push({ severity: 'error', code: 'DUPLICATE_NAME_IN_DB', message: `"${row.name}" already exists in the catalogue — pick a different name` });
      }
    }

    if (kind === 'vendors' && row.code) {
      if (!/^[A-Za-z0-9][A-Za-z0-9\-_]{0,29}$/.test(row.code)) {
        errors.push({ severity: 'error', code: 'BAD_CODE_FORMAT', message: `Vendor code "${row.code}" may only contain letters, numbers, dashes and underscores (max 30)` });
      }
      const key = row.code.toLowerCase();
      if ((codeCounts.get(key) ?? 0) > 1) {
        errors.push({ severity: 'error', code: 'DUPLICATE_CODE_IN_FILE', message: `Vendor code "${row.code}" appears ${codeCounts.get(key)} times in this file` });
      }
      if (codesInDb.has(key)) {
        errors.push({ severity: 'error', code: 'DUPLICATE_CODE_IN_DB', message: `Vendor code "${row.code}" already exists — pick a different code` });
      }
    }

    if (row.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.email)) {
      errors.push({ severity: 'error', code: 'BAD_EMAIL', message: `Email "${row.email}" is not a valid address` });
    }
    if (row.phone && !/^[0-9+\-()\s]{5,50}$/.test(row.phone)) {
      errors.push({ severity: 'error', code: 'BAD_PHONE', message: `Phone "${row.phone}" may only contain digits, spaces and + - ( )` });
    }

    return {
      ...row,
      errors,
      warnings,
      status: errors.length > 0 ? 'error' : warnings.length > 0 ? 'warning' : 'valid',
    };
  });
}

export type PartyImportSummary = {
  total: number;
  valid: number;
  warnings: number;
  errors: number;
  duplicatesInFile: number;
  duplicatesInDb: number;
  /** Vendors with a blank Vendor code — an auto-generated code will be assigned */
  missingCode: number;
};

export function summarizeParty(rows: ValidatedPartyRow[], kind: PartyKind): PartyImportSummary {
  const summary: PartyImportSummary = {
    total: rows.length, valid: 0, warnings: 0, errors: 0,
    duplicatesInFile: 0, duplicatesInDb: 0, missingCode: 0,
  };
  for (const row of rows) {
    if (row.errors.length > 0) summary.errors += 1;
    else if (row.warnings.length > 0) summary.warnings += 1;
    else summary.valid += 1;
    if (row.errors.some((e) => e.code.endsWith('_IN_FILE'))) summary.duplicatesInFile += 1;
    if (row.errors.some((e) => e.code.endsWith('_IN_DB'))) summary.duplicatesInDb += 1;
    if (kind === 'vendors' && !row.code) summary.missingCode += 1;
  }
  return summary;
}
