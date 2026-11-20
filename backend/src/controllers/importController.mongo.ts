import { Request, Response } from 'express';
import { getContext, isDuplicateKey, withTransaction } from '../config/database';
import { buildImportTemplate } from '../services/importTemplate';
import {
  cleanText,
  familySkuPrefix,
  parseImportSheet,
  summarize,
  validateImportRows,
  ValidateHelpers,
  ValidatedRow,
} from '../services/importValidation';
import { importUpload as upload } from '../config/upload';
import { divisionStamp } from '../utils/division';

export { upload };

/**
 * GET /api/products/import/template — two-sheet workbook.
 * Step 1 of the wizard (division already picked in the UI).
 */
export async function downloadTemplate(req: Request, res: Response): Promise<void> {
  const tenantId = req.user!.tenantId;
  const selectedDivisionId: string | number | null =
    req.query.division === 'all' || req.query.division === 'null' ? null : (req.query.division as string | undefined) ?? null;
  const ctx = await getContext();
  const divisionsDocs = await ctx.find('divisions', { tenant_id: tenantId, is_active: 1 }, { sort: { name: 1 }, projection: { _id: 0, id: 1, name: 1 } });
  const divisions = divisionsDocs.map((d: any) => String(d.name));
  const uomRows = await ctx.find('uoms', { tenant_id: tenantId, is_active: 1 }, { sort: { name: 1 }, projection: { _id: 0, name: 1 } });
  const uoms = uomRows.map((u: any) => String(u.name));
  let selectedDivision: string | null = null;
  if (selectedDivisionId !== null) {
    const found = divisionsDocs.find((d: any) => String(d.id) === String(selectedDivisionId));
    selectedDivision = found ? String(found.name) : null;
  }
  const samples = await ctx.find('products', { tenant_id: tenantId, is_active: 1 }, { sort: { created_at: -1 }, limit: 5, projection: { _id: 0, name: 1, grade: 1, sku: 1, manufacturer: 1, description: 1, bag_quantity_id: 1 } });
  // Resolve each product's UOM / bag name (polymorphic id → uoms then bag_quantities)
  const rawIds = [...new Set(samples.map((p: any) => (p.bag_quantity_id === null || p.bag_quantity_id === undefined ? null : String(p.bag_quantity_id))).filter(Boolean))] as string[];
  const uomNameById = new Map<string, string>();
  if (rawIds.length > 0) {
    const uomRows = await ctx.find('uoms', { tenant_id: tenantId, id: { $in: rawIds } }, { projection: { _id: 0, id: 1, name: 1 } });
    for (const r of uomRows as any[]) uomNameById.set(String(r.id), String(r.name ?? ''));
    const missing = rawIds.filter((id) => !uomNameById.has(id));
    if (missing.length > 0) {
      const bagRows = await ctx.find('bag_quantities', { tenant_id: tenantId, id: { $in: missing } }, { projection: { _id: 0, id: 1, name: 1 } });
      for (const r of bagRows as any[]) uomNameById.set(String(r.id), String(r.name ?? ''));
    }
  }
  const examples = samples.map((p: any) => ({
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
      const ctx = await getContext();
      const safe = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const uom = await ctx.findOne('uoms',
        { tenant_id: tenantId, is_active: 1, name: { $regex: `^${safe}$`, $options: 'i' } },
        { projection: { _id: 0, id: 1, name: 1 } });
      if (uom) return { id: uom.id as string | number, name: String(uom.name) };
      const bag = await ctx.findOne('bag_quantities',
        { tenant_id: tenantId, is_active: 1, name: { $regex: `^${safe}$`, $options: 'i' } },
        { projection: { _id: 0, id: 1, name: 1 } });
      return bag ? { id: bag.id as string | number, name: String(bag.name) } : null;
    },
    findDivisionByName: async (name) => {
      const ctx = await getContext();
      const safe = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const division = await ctx.findOne('divisions', { tenant_id: tenantId, is_active: 1, name: { $regex: `^${safe}$`, $options: 'i' } }, { projection: { _id: 0, id: 1, name: 1 } });
      return division ? { id: division.id as string | number, name: String(division.name) } : null;
    },
    existingSkus: async (skus) => {
      const ctx = await getContext();
      if (skus.length === 0) return new Set<string>();
      // Query in chunks to stay well within Mongo $in limits (32766 bytes of query args).
      const existing = new Set<string>();
      const CHUNK = 500;
      for (let i = 0; i < skus.length; i += CHUNK) {
        const slice = skus.slice(i, i + CHUNK).map((s) => s.toUpperCase());
        const rows = await ctx.find('products', { tenant_id: tenantId, sku: { $in: slice } }, { projection: { _id: 0, sku: 1 } });
        for (const row of rows) existing.add(String(row.sku).toLowerCase());
      }
      return existing;
    },
  };
}

/**
 * POST /api/products/import/validate — step 3: parse, validate, summarize.
 * Nothing is written to the database.
 */
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

/**
 * POST /api/products/import/apply — step 4: insert every row that passes validation.
 * Invalid rows are skipped and reported.
 */
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

  const ctx = await getContext();
  // SKU auto-generation base: prefix → next available sequence per family.
  // Computed ONCE for the whole file because sequences must not collide with
  // in-flight rows from earlier chunks.
  const familyNext = new Map<string, number>();
  const familyMaxes = new Map<string, number>();
  for (const row of validated) {
    if (row.errors.length === 0 && !row.sku) {
      const prefix = familySkuPrefix(row.product);
      if (!familyMaxes.has(prefix)) {
        const regex = new RegExp(`^${prefix}-(\\d+)$`, 'i');
        const existing = await ctx.find('products', { tenant_id: tenantId, sku: { $regex: `^${prefix}-\\d+$`, $options: 'i' } }, { projection: { _id: 0, sku: 1 }, limit: 10000 });
        let sequence = 1;
        for (const entry of existing) {
          const match = regex.exec(String(entry.sku || ''));
          if (match) sequence = Math.max(sequence, Number(match[1]) + 1);
        }
        familyMaxes.set(prefix, sequence);
        familyNext.set(prefix, sequence);
      }
    }
  }

  // Pre-resolve every document so chunks can be inserted inside one transaction
  // without cross-row state leaking in.
  const insertOps: Array<{ row: typeof validated[number]; doc: Record<string, any> }> = [];
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
      doc: {
        tenant_id: tenantId,
        division_id: row.resolved.divisionId,
        is_active: 1,
        name: row.product,
        description: row.description || null,
        sku,
        quantity: 0,
        grade: row.grade,
        manufacturer: row.resolved.manufacturer,
        bag_quantity_id: row.resolved.bagQuantityId,
        created_at: new Date(),
      },
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
      await withTransaction(async (tx) => {
        for (const op of chunk) await tx.insert('products', op.doc);
      });
      for (const op of chunk) inserted.push({ sku: op.doc.sku as string, family: op.row.product });
    } catch (err: any) {
      const message = err?.message || 'This chunk failed and was rolled back (no rows from it were saved)';
      for (const op of chunk) failed.push({ row: op.row.excelRow, message });
    }
  }

  // Grades master list: add the new grade names (idempotent)
  for (const row of validated) {
    if (row.errors.length > 0) continue;
    if (!row.grade) continue;
    try {
      await ctx.insert('grades', { tenant_id: tenantId, name: row.grade, is_active: 1 });
    } catch (err: any) {
      if (!isDuplicateKey(err)) {
        // Ignore duplicate keys (already in grades list) — log only real errors
        // via console so one bad row doesn't abort the rest.
        console.error('grade insert failed', err);
      }
    }
  }

  await ctx.insert('activity_logs', {
    user_name: req.user?.name || 'System',
    user_role: req.user?.role || 'ADMIN',
    action: 'IMPORT_PRODUCTS',
    description: `Bulk import: ${inserted.length} rows imported, ${failed.length} failed${summary.errors > 0 ? `, ${summary.errors} row(s) skipped (invalid)` : ''}`,
    tenant_id: tenantId,
    division_id: divisionStamp(req),
  });

  res.json({
    templateDivision: parsed.templateDivision,
    imported: inserted.length,
    skippedRows: summary.errors,
    failed,
    summary,
  });
}
