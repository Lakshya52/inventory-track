import { Request, Response } from 'express';
import { execute, query, withTransaction } from '../config/database';
import { RowDataPacket } from 'mysql2';
import { buildImportTemplate } from '../services/importTemplate';
import {
  familySkuPrefix,
  parseImportSheet,
  summarize,
  validateImportRows,
  ValidateHelpers,
} from '../services/importValidation';
import { importUpload as upload } from '../config/upload';
import { divisionStamp } from '../utils/division';

export { upload };

/**
 * GET /api/products/import/template — two-sheet workbook.
 */
export async function downloadTemplate(req: Request, res: Response): Promise<void> {
  const tenantId = req.user!.tenantId;
  const selectedDivisionId: string | number | null =
    req.query.division === 'all' || req.query.division === 'null' ? null : (req.query.division as string | undefined) ?? null;
  const divisionRows = await query<RowDataPacket[]>(
    'SELECT id, name FROM divisions WHERE tenant_id = ? AND is_active = 1 ORDER BY name ASC',
    [tenantId]
  );
  const divisions = divisionRows.map((d) => String(d.name));
  const uomRows = await query<RowDataPacket[]>('SELECT name FROM uoms WHERE tenant_id = ? AND is_active = 1 ORDER BY name ASC', [tenantId]);
  const uoms = uomRows.map((u) => String(u.name));
  let selectedDivision: string | null = null;
  if (selectedDivisionId !== null) {
    const found = divisionRows.find((d) => String(d.id) === String(selectedDivisionId));
    selectedDivision = found ? String(found.name) : null;
  }
  const samples = await query<RowDataPacket[]>(
    'SELECT name, grade, sku, manufacturer, description, bag_quantity_id FROM products WHERE tenant_id = ? AND is_active = 1 ORDER BY created_at DESC LIMIT 5',
    [tenantId]
  );
  // Resolve each product's UOM / bag name (polymorphic id → uoms then bag_quantities)
  const rawIds = [...new Set(samples.map((p) => (p.bag_quantity_id === null || p.bag_quantity_id === undefined ? null : String(p.bag_quantity_id))).filter(Boolean))] as string[];
  const uomNameById = new Map<string, string>();
  if (rawIds.length > 0) {
    const placeholders = rawIds.map(() => '?').join(',');
    const uomRows = await query<RowDataPacket[]>(`SELECT id, name FROM uoms WHERE tenant_id = ? AND id IN (${placeholders})`, [tenantId, ...rawIds]);
    for (const r of uomRows) uomNameById.set(String(r.id), String(r.name ?? ''));
    const missing = rawIds.filter((id) => !uomNameById.has(id));
    if (missing.length > 0) {
      const bagPlaceholders = missing.map(() => '?').join(',');
      const bagRows = await query<RowDataPacket[]>(`SELECT id, name FROM bag_quantities WHERE tenant_id = ? AND id IN (${bagPlaceholders})`, [tenantId, ...missing]);
      for (const r of bagRows) uomNameById.set(String(r.id), String(r.name ?? ''));
    }
  }
  const examples = samples.map((p) => ({
    division: selectedDivision,
    product: String(p.name ?? ''),
    grade: String(p.grade ?? ''),
    sku: String(p.sku ?? ''),
    manufacturer: String(p.manufacturer ?? ''),
    uom: p.bag_quantity_id === null || p.bag_quantity_id === undefined ? null : uomNameById.get(String(p.bag_quantity_id)) ?? null,
    description: p.description ?? null,
  }));

  const buffer = await buildImportTemplate({ selectedDivision, divisions, uoms, examples });
  res.setHeader('Content-Disposition', `attachment; filename="products-import-${selectedDivision ? selectedDivision.toLowerCase().replace(/[^a-z0-9]+/g, '-') : 'all-divisions'}.xlsx"`);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buffer);
}

function makeHelpers(tenantId: string | number): ValidateHelpers {
  return {
    findUom: async (name) => {
      const trimmed = String(name ?? '').trim();
      if (!trimmed) return null;
      const uoms = await query<RowDataPacket[]>(
        `SELECT id, name FROM uoms WHERE tenant_id = ? AND is_active = 1 AND LOWER(TRIM(name)) = LOWER(TRIM(?)) LIMIT 1`,
        [tenantId, trimmed]
      );
      if (uoms.length > 0) return { id: uoms[0].id as number, name: String(uoms[0].name) };
      const bags = await query<RowDataPacket[]>(
        `SELECT id, name FROM bag_quantities WHERE tenant_id = ? AND is_active = 1 AND LOWER(TRIM(name)) = LOWER(TRIM(?)) LIMIT 1`,
        [tenantId, trimmed]
      );
      return bags.length > 0 ? { id: bags[0].id as number, name: String(bags[0].name) } : null;
    },
    findDivisionByName: async (name) => {
      const rows = await query<RowDataPacket[]>(
        `SELECT id, name FROM divisions WHERE tenant_id = ? AND is_active = 1 AND LOWER(TRIM(name)) = LOWER(TRIM(?)) LIMIT 1`,
        [tenantId, name]
      );
      return rows.length > 0 ? { id: rows[0].id as number, name: String(rows[0].name) } : null;
    },
    existingSkus: async (skus) => {
      if (skus.length === 0) return new Set<string>();
      const slice = skus.map((s) => s.toUpperCase());
      const existing = new Set<string>();
      const CHUNK = 500;
      for (let i = 0; i < slice.length; i += CHUNK) {
        const chunk = slice.slice(i, i + CHUNK);
        const placeholders = chunk.map(() => '?').join(',');
        const rows = await query<RowDataPacket[]>(`SELECT sku FROM products WHERE tenant_id = ? AND UPPER(sku) IN (${placeholders})`, [tenantId, ...chunk]);
        for (const row of rows) existing.add(String(row.sku).toLowerCase());
      }
      return existing;
    },
  };
}

/** POST /api/products/import/validate — step 3. Nothing is written. */
export async function validateImport(req: Request, res: Response): Promise<void> {
  const tenantId = req.user!.tenantId;
  const file = req.file;
  if (!file) { res.status(400).json({ error: 'Choose a filled-in .xlsx file to validate.' }); return; }

  let parsed;
  try {
    parsed = parseImportSheet(file.buffer);
  } catch (error: any) {
    res.status(400).json({ error: error.message || 'Could not read the uploaded file' });
    return;
  }
  const rows = parsed.rows;

  const validated = await validateImportRows(rows, makeHelpers(tenantId));
  const summary = summarize(validated);

  res.json({
    templateDivision: parsed.templateDivision,
    summary,
    rows: validated
      .filter((row) => row.errors.length > 0 || row.warnings.length > 0)
      .map((row) => ({
      row: row.excelRow,
      division: row.division,
      product: row.product,
      grade: row.grade,
      sku: row.resolved.sku,
      manufacturer: row.resolved.manufacturer,
      description: row.description,
      status: row.status,
      errors: row.errors.map((e) => e.message),
      warnings: row.warnings.map((w) => w.message),
    })),
  });
}

/** POST /api/products/import/apply — step 4: insert every valid row. */
export async function applyImport(req: Request, res: Response): Promise<void> {
  const tenantId = req.user!.tenantId;
  const file = req.file;
  if (!file) { res.status(400).json({ error: 'The uploaded file is missing — please pick it again and confirm.' }); return; }

  let parsed;
  try {
    parsed = parseImportSheet(file.buffer);
  } catch (error: any) {
    res.status(400).json({ error: error.message || 'Could not read the uploaded file' });
    return;
  }
  const rows = parsed.rows;

  const validated = await validateImportRows(rows, makeHelpers(tenantId));
  const summary = summarize(validated);

  // SKU auto-generation base per family
  const familyNext = new Map<string, number>();
  for (const row of validated) {
    if (row.errors.length > 0 || row.sku) continue;
    const prefix = familySkuPrefix(row.product);
    if (!familyNext.has(prefix)) {
      const like = `${prefix}-%`;
      const rows2 = await query<RowDataPacket[]>('SELECT sku FROM products WHERE tenant_id = ? AND sku LIKE ?', [tenantId, like]);
      let sequence = 1;
      const regex = new RegExp(`^${prefix}-(\\d+)$`, 'i');
      for (const entry of rows2) {
        const match = regex.exec(String(entry.sku || ''));
        if (match) sequence = Math.max(sequence, Number(match[1]) + 1);
      }
      familyNext.set(prefix, sequence);
    }
  }

  // Pre-resolve every row so chunks can be inserted inside one transaction
  // without depending on global state mid-loop.
  const insertOps: Array<{ row: typeof validated[number]; args: any[] }> = [];
  for (const row of validated) {
    if (row.errors.length > 0) continue;
    const prefix = familySkuPrefix(row.product);
    let sku = row.resolved.sku;
    if (!sku) {
      const seq = familyNext.get(prefix) ?? 1;
      familyNext.set(prefix, seq + 1);
      sku = `${prefix}-${String(seq).padStart(3, '0')}`;
    }
    insertOps.push({
      row,
      args: [tenantId, row.resolved.divisionId, row.product, row.description || null, sku, 0, row.grade, row.resolved.manufacturer, row.resolved.bagQuantityId],
    });
  }

  // Chunked insert (~2,000 rows per transaction). A rollback rolls back that chunk
  // only — not the whole file — and invalid rows never enter this loop.
  const inserted: Array<{ sku: string; family: string }> = [];
  const failed: Array<{ row: number; message: string }> = [];
  const CHUNK = 2000;
  for (let offset = 0; offset < insertOps.length; offset += CHUNK) {
    const chunk = insertOps.slice(offset, offset + CHUNK);
    try {
      await withTransaction(async (conn) => {
        for (const op of chunk) {
          await conn.query(
            'INSERT INTO products (tenant_id, division_id, name, description, sku, quantity, grade, manufacturer, bag_quantity_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
            op.args
          );
        }
      });
      for (const op of chunk) inserted.push({ sku: String(op.args[4]), family: op.row.product });
    } catch (err: any) {
      const message = err?.code === 'ER_DUP_ENTRY'
        ? 'Duplicate SKU in this chunk (transaction rolled back — no rows from it were saved)'
        : (err?.message || 'This chunk failed and was rolled back (no rows from it were saved)');
      for (const op of chunk) failed.push({ row: op.row.excelRow, message });
    }
  }

  // Grades master list (idempotent)
  for (const op of insertOps) {
    if (!op.row.grade) continue;
    try {
      await execute('INSERT INTO grades (tenant_id, name, is_active) VALUES (?, ?, 1)', [tenantId, op.row.grade]);
    } catch (gradeErr: any) {
      if (gradeErr?.code !== 'ER_DUP_ENTRY') console.error('grade insert failed', gradeErr);
    }
  }

  await execute(
    'INSERT INTO activity_logs (user_name, user_role, action, description, tenant_id, division_id) VALUES (?, ?, ?, ?, ?, ?)',
    [req.user?.name || 'System', req.user?.role || 'ADMIN', 'IMPORT_PRODUCTS',
     `Bulk import: ${inserted.length} rows imported, ${failed.length} failed${summary.errors > 0 ? `, ${summary.errors} row(s) skipped (invalid)` : ''}`,
     tenantId, divisionStamp(req)]
  );

  res.json({
    templateDivision: parsed.templateDivision,
    imported: inserted.length,
    skippedRows: summary.errors,
    failed,
    summary,
  });
}
