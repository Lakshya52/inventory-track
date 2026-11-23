/**
 * Bulk import for users (ADMIN / QC / DISPATCH).
 * Mirrors the clients/vendors import: template → validate (no writes) → apply.
 * Engine-agnostic — database lookups are supplied by the controller.
 */
import XLSX from 'xlsx';

export const USER_IMPORT_COLUMNS = [
  'Name',
  'Email',
  'Division',
  'Role',
  'Initial password',
] as const;

/** Only operational users are importable — the single ADMIN account is managed in the app. */
export const USER_ROLES = ['QC', 'DISPATCH'] as const;

export type UserImportRow = {
  /** 1-based Excel row number (header = row 1, first data row = 2) */
  excelRow: number;
  name: string;
  email: string;
  division: string;
  role: string;
  password: string;
};

export type RowFinding = {
  severity: 'error' | 'warning';
  message: string;
  code: string;
};

export type ValidatedUserRow = UserImportRow & {
  errors: RowFinding[];
  warnings: RowFinding[];
  status: 'valid' | 'warning' | 'error';
  /** Normalized values applied on import. */
  resolved: {
    email: string;
    role: (typeof USER_ROLES)[number];
    divisionId: string | number | null;
  };
};

export type UserImportHelpers = {
  /** Lower-cased emails already used by any user role in this tenant. */
  existingEmails: (emails: string[]) => Promise<Set<string>>;
  /** Lower-cased names of this tenant's active divisions. */
  divisionNames: () => Promise<Set<string>>;
};

function text(value: unknown, max: number): string {
  if (typeof value === 'string') return value.trim().slice(0, max);
  if (typeof value === 'number') return String(value);
  return '';
}

function headerKey(value: string): string {
  return value.trim().toLowerCase().replace(/[\s_\-]+/g, '');
}

/** Header names are matched case/space/underscore insensitive. */
function cell(row: Record<string, unknown>, header: string, max: number): string {
  const wanted = headerKey(header);
  const key = Object.keys(row).find((candidate) => headerKey(candidate) === wanted);
  return key ? text(row[key], max) : '';
}

/** Reads the sheet named "Users" (any case), ignoring fully blank rows. */
export function parseUserSheet(buffer: Buffer): UserImportRow[] {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const sheetName = workbook.SheetNames.find((name) => name.trim().toLowerCase() === 'users')
    ?? workbook.SheetNames[0];
  const sheet = sheetName ? workbook.Sheets[sheetName] : undefined;
  if (!sheet) throw new Error('The uploaded file does not contain a sheet with the Users table');
  const raw = XLSX.utils.sheet_to_json(sheet, { defval: '' }) as Array<Record<string, unknown>>;
  if (raw.length === 0) throw new Error('The Users sheet is empty — fill in at least one user before importing');
  const range = XLSX.utils.decode_range(sheet['!ref'] ?? 'A1');
  const rows: UserImportRow[] = [];
  raw.forEach((row, index) => {
    const parsed: UserImportRow = {
      excelRow: range.s.r + 2 + index,
      name: cell(row, 'Name', 100),
      email: cell(row, 'Email', 150).toLowerCase(),
      division: cell(row, 'Division', 120),
      role: cell(row, 'Role', 20).toUpperCase(),
      password: cell(row, 'Initial password', 200),
    };
    const hasData = [parsed.name, parsed.email, parsed.division, parsed.role, parsed.password]
      .some((value) => value.length > 0);
    if (hasData) rows.push(parsed);
  });
  if (rows.length === 0) throw new Error('The Users sheet has no filled-in rows');
  return rows;
}

/** Validate every row. Duplicate emails and bad values are hard errors. */
export async function validateUserRows(
  rows: UserImportRow[],
  helpers: UserImportHelpers,
): Promise<ValidatedUserRow[]> {
  const emailCounts = new Map<string, number>();
  for (const row of rows) {
    const key = row.email.trim().toLowerCase();
    if (key) emailCounts.set(key, (emailCounts.get(key) ?? 0) + 1);
  }
  const emailsInDb = await helpers.existingEmails(rows.map((row) => row.email).filter(Boolean));
  const knownDivisions = await helpers.divisionNames();

  return rows.map((row) => {
    const errors: RowFinding[] = [];
    const warnings: RowFinding[] = [];
    const email = row.email.trim().toLowerCase();

    if (!row.name) {
      errors.push({ severity: 'error', code: 'MISSING_NAME', message: 'Name is required' });
    }
    if (!email) {
      errors.push({ severity: 'error', code: 'MISSING_EMAIL', message: 'Email is required' });
    } else {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        errors.push({ severity: 'error', code: 'BAD_EMAIL', message: `Email "${email}" is not a valid address` });
      }
      if ((emailCounts.get(email) ?? 0) > 1) {
        errors.push({ severity: 'error', code: 'DUPLICATE_EMAIL_IN_FILE', message: `Email "${email}" appears ${emailCounts.get(email)} times in this file` });
      }
      if (emailsInDb.has(email)) {
        errors.push({ severity: 'error', code: 'DUPLICATE_EMAIL_IN_DB', message: `Email "${email}" already exists — pick a different address` });
      }
    }

    const roleKey = row.role.trim().toUpperCase();
    const role = USER_ROLES.find((candidate) => candidate === roleKey);
    if (!role) {
      errors.push({
        severity: 'error', code: 'BAD_ROLE',
        message: roleKey === 'ADMIN'
          ? 'ADMIN cannot be imported from Excel — there is one admin account, managed in the app. Use QC or DISPATCH.'
          : `Role "${row.role || '(blank)'}" is invalid — use QC or DISPATCH`,
      });
    }

    if (!row.password) {
      errors.push({ severity: 'error', code: 'MISSING_PASSWORD', message: 'Initial password is required' });
    } else if (row.password.length < 6) {
      errors.push({ severity: 'error', code: 'SHORT_PASSWORD', message: 'Initial password must be at least 6 characters' });
    }

    // Division is optional. Blank = tenant-wide (no division_id). A filled
    // value must match one of this tenant's divisions.
    if (row.division.trim() && !knownDivisions.has(row.division.trim().toLowerCase())) {
      errors.push({
        severity: 'error', code: 'UNKNOWN_DIVISION',
        message: `Division "${row.division}" does not exist — pick one from the dropdown or leave it blank`,
      });
    }

    return {
      ...row,
      errors,
      warnings,
      status: errors.length > 0 ? 'error' : warnings.length > 0 ? 'warning' : 'valid',
      resolved: { email, role: role ?? 'QC', divisionId: null },
    };
  });
}

export type UserImportSummary = {
  total: number;
  valid: number;
  warnings: number;
  errors: number;
  /** Rows ready to import, split by role. */
  qcCount: number;
  dispatchCount: number;
  duplicatesInFile: number;
  duplicatesInDb: number;
  /** Kept so the shared frontend summary type stays satisfied. */
  noDivision: number;
  missingSku: number;
  missingManufacturer: number;
  defaults: number;
  missingUom: number;
  missingCode: number;
};

export function summarizeUserImport(rows: ValidatedUserRow[]): UserImportSummary {
  const summary: UserImportSummary = {
    total: rows.length, valid: 0, warnings: 0, errors: 0,
    qcCount: 0, dispatchCount: 0,
    duplicatesInFile: 0, duplicatesInDb: 0, noDivision: 0,
    missingSku: 0, missingManufacturer: 0, defaults: 0, missingUom: 0, missingCode: 0,
  };
  for (const row of rows) {
    if (row.errors.length > 0) summary.errors += 1;
    else if (row.warnings.length > 0) summary.warnings += 1;
    else summary.valid += 1;
    // Count rows that will actually be written (warnings still import).
    if (row.errors.length === 0) {
      if (row.resolved.role === 'QC') summary.qcCount += 1;
      if (row.resolved.role === 'DISPATCH') summary.dispatchCount += 1;
    }
    if (row.errors.some((error) => error.code === 'DUPLICATE_EMAIL_IN_FILE')) summary.duplicatesInFile += 1;
    if (row.errors.some((error) => error.code === 'DUPLICATE_EMAIL_IN_DB')) summary.duplicatesInDb += 1;
  }
  return summary;
}
