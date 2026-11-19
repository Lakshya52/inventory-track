/**
 * Bulk product import — shared parsing and row validation.
 *
 * Engine-agnostic: controllers supply small DB helpers (division lookup,
 * SKU existence checks) as callbacks, so the same rules apply to MySQL and
 * MongoDB implementations alike.
 */
import XLSX from 'xlsx';

export type ImportSeverity = 'error' | 'warning';

export type ImportRow = {
  /** 1-based Excel row number (header = row 1, first data row = 2) */
  excelRow: number;
  division: string;
  product: string;
  grade: string;
  sku: string;
  manufacturer: string;
  /** Raw text from the UOM / Bag quantity column, if any */
  uom: string;
  description: string;
};

export type RowFinding = {
  severity: ImportSeverity;
  message: string;
  /** Machine-readable code for the frontend, e.g. MISSING_PRODUCT, DUPLICATE_SKU */
  code: string;
};

export type ValidatedRow = ImportRow & {
  errors: RowFinding[];
  warnings: RowFinding[];
  status: 'valid' | 'warning' | 'error';
  /** Resolved values after defaults are applied */
  resolved: {
    divisionId: string | number | null;
    manufacturer: string;
    sku: string | null;
    /** Resolved master id: UOM or bag-quantity id, tenant's; null when the column was blank */
    bagQuantityId: string | number | null;
    /** Canonical display name of the matched UOM/bag (as stored), or null when blank */
    uomName: string | null;
  };
};

export type ValidateHelpers = {
  /** Case-insensitive lookup of a division name for this tenant. Returns null when missing. */
  findDivisionByName: (name: string) => Promise<{ id: string | number; name: string } | null>;
  /** Returns the subset of the given SKUs that already exist in the products table for this tenant. */
  existingSkus: (skus: string[]) => Promise<Set<string>>;
  /**
   * Resolve a UOM / bag-quantity value typed by the user (case-insensitive, exact).
   * Returns null when nothing matches. Look up uoms first, then bag_quantities.
   */
  findUom: (name: string) => Promise<{ id: string | number; name: string } | null>;
};

export const META_SHEET = '__import_meta';
export const IMPORT_COLUMNS = ['Division', 'Product', 'Grade', 'SKU', 'Manufacturer', 'UOM', 'Description (optional)'] as const;
/** Columns of a division-stamped template — no Division column needed. */
export const IMPORT_COLUMNS_NO_DIVISION = ['Product', 'Grade', 'SKU', 'Manufacturer', 'UOM', 'Description (optional)'] as const;

export function cleanText(value: unknown, maxLength: number): string {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : String(value ?? '').trim().slice(0, maxLength);
}

export function familySkuPrefix(name: string): string {
  const code = name.replace(/[^a-zA-Z0-9]/g, '').slice(0, 6).toUpperCase();
  return `KLJ-${code || 'PROD'}`;
}

/**
 * Parses the uploaded workbook. Finds the data sheet by name ("Products", any
 * case). Division-stamped templates (downloaded for a specific division) carry
 * a very-hidden `__import_meta` sheet naming their target division — every row
 * inherits it when the Division column is absent or left blank in a row.
 */
export function parseImportSheet(buffer: Buffer): { rows: ImportRow[]; templateDivision: string | null } {
  const workbook = XLSX.read(buffer, { type: 'buffer' });

  let templateDivision: string | null = null;
  const meta = workbook.Sheets[META_SHEET];
  if (meta) {
    const metaRows: Array<Record<string, unknown>> = XLSX.utils.sheet_to_json(meta, { defval: '' });
    const name = cleanText(metaRows[0]?.division_name, 120);
    if (name) templateDivision = name;
  }

  const names = workbook.SheetNames.filter((n) => n !== META_SHEET);
  const sheetName = names.find((n) => n.trim().toLowerCase() === 'products') ?? names[0];
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) throw new Error('The uploaded file does not contain a sheet with the products table');
  const raw: Array<Record<string, unknown>> = XLSX.utils.sheet_to_json(sheet, { defval: '' });
  if (raw.length === 0) throw new Error('The products sheet is empty — fill in at least one row before importing');
  // Find the actual header row number (sheet_to_json drops it because row 1 is the header)
  const range = XLSX.utils.decode_range(sheet['!ref'] ?? 'A1');
  return {
    templateDivision,
    rows: raw.map((row, index) => ({
      excelRow: range.s.r + 2 + index,
      // Explicit Division cell wins; otherwise the division-template marker applies
      division: cleanText(row['Division'], 120) || templateDivision || '',
      product: cleanText(row['Product'], 150),
      grade: cleanText(row['Grade'], 150),
      sku: cleanText(row['SKU'], 80).toUpperCase(),
      manufacturer: cleanText(row['Manufacturer'], 150),
      uom: cleanText(row['UOM'], 120),
      description: cleanText(row['Description'], 500),
    })),
  };
}

/**
 * Validates every row and applies defaults.
 */
export async function validateImportRows(
  rows: ImportRow[],
  helpers: ValidateHelpers
): Promise<ValidatedRow[]> {
  // Pre-compute SKU duplicates within the file (case-insensitive)
  const skuCounts = new Map<string, number>();
  for (const row of rows) {
    if (!row.sku) continue;
    const key = row.sku.toLowerCase();
    skuCounts.set(key, (skuCounts.get(key) ?? 0) + 1);
  }
  const skusInFile = [...new Set(rows.filter((r) => r.sku).map((r) => r.sku.toUpperCase()))];
  const skusInDb = await helpers.existingSkus(skusInFile);

  // Resolve divisions and UOMs (cached per name to avoid repeated lookups)
  const divisionCache = new Map<string, { id: string | number; name: string } | null>();
  const uomCache = new Map<string, { id: string | number; name: string } | null>();
  // Auto-generation preview needs used SKUs per family — skip expensive pre-read.
  const validated: ValidatedRow[] = [];

  for (const row of rows) {
    const errors: RowFinding[] = [];
    const warnings: RowFinding[] = [];

    // --- Compulsory: product and grade
    if (!row.product) errors.push({ severity: 'error', code: 'MISSING_PRODUCT', message: 'Product name is required' });
    if (!row.grade) errors.push({ severity: 'error', code: 'MISSING_GRADE', message: 'Grade name is required (e.g. "XLPE BK 9406")' });

    // --- SKU checks
    if (row.sku) {
      if (!/^[A-Za-z0-9][A-Za-z0-9\-_\.]{0,79}$/.test(row.sku)) {
        errors.push({ severity: 'error', code: 'BAD_SKU_FORMAT', message: `SKU "${row.sku}" may only contain letters, numbers, dashes and dots` });
      }
      const key = row.sku.toLowerCase();
      if ((skuCounts.get(key) ?? 0) > 1) {
        errors.push({ severity: 'error', code: 'DUPLICATE_SKU_IN_FILE', message: `SKU "${row.sku}" appears ${skuCounts.get(key)} times in this file` });
      }
      if (skusInDb.has(key)) {
        errors.push({ severity: 'error', code: 'DUPLICATE_SKU_IN_DB', message: `SKU "${row.sku}" already exists in the catalogue — pick a different SKU` });
      }
    }

    // --- UOM / bag-quantity resolution. Blank is simply counted in the summary; an
    // unknown value is a hard error (a typo must not silently become NULL).
    let bagQuantityId: string | number | null = null;
    let uomName: string | null = null;
    if (row.uom) {
      const key = row.uom.toLowerCase();
      if (!uomCache.has(key)) {
        uomCache.set(key, await helpers.findUom(row.uom));
      }
      const match = uomCache.get(key) ?? null;
      if (!match) {
        errors.push({ severity: 'error', code: 'UNKNOWN_UOM', message: `UOM "${row.uom}" not found — add it in Masters → UOMs (or leave the cell blank)` });
      } else {
        bagQuantityId = match.id;
        uomName = match.name;
      }
    }

    // --- Manufacturer / SKU / division defaults are NOT per-row warnings —
    // they are counted once for the whole file (see summarize). A 10,000-row
    // sheet with blank SKU/manufacturer would otherwise produce 10,000 findings.

    // --- Division resolution
    let divisionId: string | number | null = null;
    if (row.division) {
      const key = row.division.toLowerCase();
      if (!divisionCache.has(key)) {
        divisionCache.set(key, await helpers.findDivisionByName(row.division));
      }
      const division = divisionCache.get(key) ?? null;
      if (!division) {
        errors.push({ severity: 'error', code: 'UNKNOWN_DIVISION', message: `Division "${row.division}" does not exist — check spelling or create it in Masters → Divisions` });
      } else {
        divisionId = division.id;
      }
    }

    const status: ValidatedRow['status'] = errors.length > 0 ? 'error' : warnings.length > 0 ? 'warning' : 'valid';
    validated.push({
      ...row,
      errors,
      warnings,
      status,
      resolved: {
        divisionId,
        manufacturer: row.manufacturer || 'SELF (KLJ)',
        sku: row.sku || null,
        bagQuantityId,
        uomName,
      },
    });
  }
  return validated;
}

export type ImportSummary = {
  total: number;
  valid: number;
  warnings: number;
  errors: number;
  duplicatesInFile: number;
  duplicatesInDb: number;
  /** Rows with no Division value (imported into ALL divisions — the wizard asks the user to confirm) */
  noDivision: number;
  /** Rows with a blank SKU — an auto-generated code will be assigned */
  missingSku: number;
  /** Rows with a blank Manufacturer — saved as "SELF (KLJ)" */
  missingManufacturer: number;
  /** Rows missing SKU and/or Manufacturer (defaults will apply) — shown once as a combined notice */
  defaults: number;
  /** Rows with a blank UOM — saved without a UOM (counted once, not per row) */
  missingUom: number;
};

export function summarize(rows: ValidatedRow[]): ImportSummary {
  const summary: ImportSummary = {
    total: rows.length,
    valid: 0,
    warnings: 0,
    errors: 0,
    duplicatesInFile: 0,
    duplicatesInDb: 0,
    noDivision: 0,
    missingSku: 0,
    missingManufacturer: 0,
    defaults: 0,
    missingUom: 0,
  };
  for (const row of rows) {
    if (row.errors.length > 0) summary.errors += 1;
    else if (row.warnings.length > 0) summary.warnings += 1;
    else summary.valid += 1;
    if (row.errors.some((e) => e.code === 'DUPLICATE_SKU_IN_FILE')) summary.duplicatesInFile += 1;
    if (row.errors.some((e) => e.code === 'DUPLICATE_SKU_IN_DB')) summary.duplicatesInDb += 1;
    if (!row.division) summary.noDivision += 1;
    if (!row.sku) summary.missingSku += 1;
    if (!row.manufacturer) summary.missingManufacturer += 1;
    if (!row.sku || !row.manufacturer) summary.defaults += 1;
    if (!row.uom) summary.missingUom += 1;
  }
  return summary;
}
