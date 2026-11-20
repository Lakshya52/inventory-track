import { Request, Response } from 'express';
import { randomBytes } from 'crypto';
import { getContext, withTransaction } from '../config/database';
import { buildPartyImportTemplate } from '../services/partyImportTemplate';
import {
  parsePartySheet,
  validatePartyRows,
  summarizeParty,
  PartyHelpers,
  PartyKind,
} from '../services/partyImport';
import { importUpload as upload } from '../config/upload';

export { upload };

function makeHelpers(tenantId: string | number, kind: PartyKind): PartyHelpers {
  return {
    // Party masters are small (hundreds at most): one projection scan is
    // cheaper and simpler than chunked $in queries.
    existingNames: async () => {
      const ctx = await getContext();
      const rows = await ctx.find(kind, { tenant_id: tenantId }, { projection: { _id: 0, name: 1 } });
      const names = new Set<string>();
      for (const row of rows) {
        const name = String(row.name ?? '').trim().toLowerCase();
        if (name) names.add(name);
      }
      return names;
    },
    existingCodes: async () => {
      if (kind !== 'vendors') return new Set<string>();
      const ctx = await getContext();
      const rows = await ctx.find('vendors', { tenant_id: tenantId }, { projection: { _id: 0, vendor_code: 1 } });
      const codes = new Set<string>();
      for (const row of rows) {
        const code = String(row.vendor_code ?? '').trim().toLowerCase();
        if (code) codes.add(code);
      }
      return codes;
    },
  };
}

function parse(req: Request, res: Response, kind: PartyKind) {
  if (!req.file) {
    res.status(400).json({ error: 'Choose a filled-in .xlsx file to validate.' });
    return null;
  }
  try {
    return parsePartySheet(req.file.buffer, kind);
  } catch (error: any) {
    res.status(400).json({ error: error.message || 'Could not read the uploaded file' });
    return null;
  }
}

/** GET /api/:kind/import/template */
export async function downloadTemplate(req: Request, res: Response, kind: PartyKind): Promise<void> {
  const tenantId = req.user!.tenantId;
  const ctx = await getContext();
  const samples = await ctx.find(kind, { tenant_id: tenantId, is_active: 1 }, {
    sort: { name: 1 }, limit: 5,
    projection: { _id: 0, name: 1, vendor_code: 1, contact_person: 1, email: 1, phone: 1, address: 1, gst_number: 1 },
  });
  const examples = samples.map((p: any) => ({
    name: String(p.name ?? ''),
    code: p.vendor_code === 'SELF' ? null : (p.vendor_code ?? null),
    contact: p.contact_person ?? null,
    email: p.email ?? null,
    phone: p.phone ?? null,
    address: p.address ?? null,
    gst: p.gst_number ?? null,
  }));
  const buffer = await buildPartyImportTemplate(kind, examples);
  res.setHeader('Content-Disposition', `attachment; filename="${kind}-import.xlsx"`);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buffer);
}

/** POST /api/:kind/import/validate — nothing is written. */
export async function validate(req: Request, res: Response, kind: PartyKind): Promise<void> {
  const tenantId = req.user!.tenantId;
  const rows = parse(req, res, kind);
  if (!rows) return;
  const validated = await validatePartyRows(rows, makeHelpers(tenantId, kind), kind);
  const summary = summarizeParty(validated, kind);
  res.json({
    summary,
    rows: validated
      .filter((row) => row.errors.length > 0 || row.warnings.length > 0)
      .map((row) => ({
        row: row.excelRow,
        label: row.name || '(missing name)',
        code: row.code,
        status: row.status,
        errors: row.errors.map((e) => e.message),
        warnings: row.warnings.map((w) => w.message),
      })),
  });
}

/** POST /api/:kind/import/apply — insert every row that passed validation. */
export async function apply(req: Request, res: Response, kind: PartyKind): Promise<void> {
  const tenantId = req.user!.tenantId;
  const rows = parse(req, res, kind);
  if (!rows) return;
  const validated = await validatePartyRows(rows, makeHelpers(tenantId, kind), kind);
  const summary = summarizeParty(validated, kind);

  const docs: Array<{ row: typeof validated[number]; doc: Record<string, any> }> = [];
  for (const row of validated) {
    if (row.errors.length > 0) continue;
    const doc: Record<string, any> = {
      tenant_id: tenantId,
      name: row.name,
      contact_person: row.contact || null,
      email: row.email || null,
      phone: row.phone || null,
      address: row.address || null,
      gst_number: row.gst || null,
      is_active: 1,
      created_at: new Date(),
    };
    if (kind === 'vendors') {
      doc.vendor_code = row.code || `VND-${randomBytes(3).toString('hex').toUpperCase()}`;
      doc.category = row.category || null;
      doc.payment_terms = row.paymentTerms || null;
      doc.notes = row.notes || null;
    }
    docs.push({ row, doc });
  }

  const imported: string[] = [];
  const failed: Array<{ row: number; message: string }> = [];
  const CHUNK = 1000;
  for (let offset = 0; offset < docs.length; offset += CHUNK) {
    const chunk = docs.slice(offset, offset + CHUNK);
    try {
      await withTransaction(async (tx) => {
        for (const op of chunk) await tx.insert(kind, op.doc);
      });
      for (const op of chunk) imported.push(op.doc.name as string);
    } catch (err: any) {
      const message = err?.message || 'This chunk failed and was rolled back (no rows from it were saved)';
      for (const op of chunk) failed.push({ row: op.row.excelRow, message });
    }
  }

  const ctx = await getContext();
  await ctx.insert('activity_logs', {
    tenant_id: tenantId,
    user_name: req.user?.name || 'System',
    user_role: req.user?.role || 'ADMIN',
    action: kind === 'clients' ? 'IMPORT_CLIENTS' : 'IMPORT_VENDORS',
    description: `Bulk import: ${imported.length} ${kind} imported, ${failed.length} failed${summary.errors > 0 ? `, ${summary.errors} row(s) skipped (invalid)` : ''}`,
  });

  res.json({ imported: imported.length, skippedRows: summary.errors, failed, summary });
}
