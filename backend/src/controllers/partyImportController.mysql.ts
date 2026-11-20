import { Request, Response } from 'express';
import { randomBytes } from 'crypto';
import { execute, query, withTransaction } from '../config/database';
import { RowDataPacket } from 'mysql2';
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
    existingNames: async () => {
      const rows = await query<RowDataPacket[]>(`SELECT name FROM ${kind} WHERE tenant_id = ?`, [tenantId]);
      const names = new Set<string>();
      for (const row of rows) {
        const name = String(row.name ?? '').trim().toLowerCase();
        if (name) names.add(name);
      }
      return names;
    },
    existingCodes: async () => {
      if (kind !== 'vendors') return new Set<string>();
      const rows = await query<RowDataPacket[]>('SELECT vendor_code FROM vendors WHERE tenant_id = ?', [tenantId]);
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
  const samples = await query<RowDataPacket[]>(
    `SELECT name, vendor_code, contact_person, email, phone, address, gst_number FROM ${kind} WHERE tenant_id = ? AND is_active = 1 ORDER BY name ASC LIMIT 5`,
    [tenantId]
  );
  const examples = samples.map((p) => ({
    name: String(p.name ?? ''),
    code: String(p.vendor_code ?? '') === 'SELF' ? null : (p.vendor_code ?? null),
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

  const inserts: Array<{ row: typeof validated[number]; sql: string; args: any[] }> = [];
  for (const row of validated) {
    if (row.errors.length > 0) continue;
    if (kind === 'clients') {
      inserts.push({
        row,
        sql: 'INSERT INTO clients (tenant_id, name, contact_person, email, phone, address, gst_number, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, 1)',
        args: [tenantId, row.name, row.contact || null, row.email || null, row.phone || null, row.address || null, row.gst || null],
      });
    } else {
      inserts.push({
        row,
        sql: 'INSERT INTO vendors (tenant_id, vendor_code, name, contact_person, email, phone, address, gst_number, category, payment_terms, notes, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)',
        args: [
          tenantId,
          row.code || `VND-${randomBytes(3).toString('hex').toUpperCase()}`,
          row.name, row.contact || null, row.email || null, row.phone || null,
          row.address || null, row.gst || null, row.category || null,
          row.paymentTerms || null, row.notes || null,
        ],
      });
    }
  }

  let imported = 0;
  const failed: Array<{ row: number; message: string }> = [];
  const CHUNK = 1000;
  for (let offset = 0; offset < inserts.length; offset += CHUNK) {
    const chunk = inserts.slice(offset, offset + CHUNK);
    try {
      await withTransaction(async (conn) => {
        for (const op of chunk) await conn.query(op.sql, op.args);
      });
      imported += chunk.length;
    } catch (err: any) {
      const message = err?.code === 'ER_DUP_ENTRY'
        ? 'Duplicate name or vendor code in this chunk (transaction rolled back — no rows from it were saved)'
        : (err?.message || 'This chunk failed and was rolled back (no rows from it were saved)');
      for (const op of chunk) failed.push({ row: op.row.excelRow, message });
    }
  }

  await execute(
    'INSERT INTO activity_logs (user_name, user_role, action, description, tenant_id) VALUES (?, ?, ?, ?, ?)',
    [req.user?.name || 'System', req.user?.role || 'ADMIN',
     kind === 'clients' ? 'IMPORT_CLIENTS' : 'IMPORT_VENDORS',
     `Bulk import: ${imported} ${kind} imported, ${failed.length} failed${summary.errors > 0 ? `, ${summary.errors} row(s) skipped (invalid)` : ''}`,
     tenantId]
  );

  res.json({ imported, skippedRows: summary.errors, failed, summary });
}
