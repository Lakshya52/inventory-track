import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { getContext, withTransaction } from '../config/database';
import { buildUserImportTemplate } from '../services/userImportTemplate';
import {
  parseUserSheet,
  validateUserRows,
  summarizeUserImport,
  UserImportHelpers,
} from '../services/userImport';
import { importUpload as upload } from '../config/upload';

export { upload };

const ROLE_TABLES: Record<string, string> = {
  ADMIN: 'admins',
  QC: 'qc_users',
  DISPATCH: 'dispatch_users',
};

function makeHelpers(tenantId: string | number): UserImportHelpers {
  return {
    existingEmails: async () => {
      const ctx = await getContext();
      const emails = new Set<string>();
      await Promise.all(Object.values(ROLE_TABLES).map(async (table) => {
        const rows = await ctx.find(table, { tenant_id: tenantId }, { projection: { _id: 0, email: 1 } });
        for (const row of rows) {
          const email = String(row.email ?? '').trim().toLowerCase();
          if (email && !email.startsWith('__role_archive_')) emails.add(email);
        }
      }));
      return emails;
    },
    divisionNames: async () => {
      const ctx = await getContext();
      const rows = await ctx.find('divisions', { tenant_id: tenantId, is_active: 1 }, { projection: { _id: 0, name: 1 } });
      return new Set(rows.map((row: any) => String(row.name ?? '').trim().toLowerCase()).filter(Boolean));
    },
  };
}

function parse(req: Request, res: Response) {
  if (!req.file) {
    res.status(400).json({ error: 'Choose a filled-in .xlsx file to validate.' });
    return null;
  }
  try {
    return parseUserSheet(req.file.buffer);
  } catch (error: any) {
    res.status(400).json({ error: error.message || 'Could not read the uploaded file' });
    return null;
  }
}

/** GET /api/users/import/template */
export async function downloadTemplate(req: Request, res: Response): Promise<void> {
  // No live examples: user emails/passwords should not be echoed into a download.
  const ctx = await getContext();
  const divisions = await ctx.find(
    'divisions',
    { tenant_id: req.user!.tenantId, is_active: 1 },
    { sort: { name: 1 }, projection: { _id: 0, name: 1 } },
  );
  const buffer = await buildUserImportTemplate(
    [],
    divisions.map((division: any) => String(division.name ?? '')),
  );
  res.setHeader('Content-Disposition', 'attachment; filename="users-import.xlsx"');
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buffer);
}

/** POST /api/users/import/validate — nothing is written. */
export async function validate(req: Request, res: Response): Promise<void> {
  const tenantId = req.user!.tenantId;
  const rows = parse(req, res);
  if (!rows) return;
  const validated = await validateUserRows(rows, makeHelpers(tenantId));
  const summary = summarizeUserImport(validated);
  res.json({
    summary,
    rows: validated
      .filter((row) => row.errors.length > 0 || row.warnings.length > 0)
      .map((row) => ({
        row: row.excelRow,
        label: row.name || '(missing name)',
        status: row.status,
        errors: row.errors.map((error) => error.message),
        warnings: row.warnings.map((warning) => warning.message),
      })),
  });
}

/** POST /api/users/import/apply — insert every row that passed validation. */
export async function apply(req: Request, res: Response): Promise<void> {
  const tenantId = req.user!.tenantId;
  const rows = parse(req, res);
  if (!rows) return;
  const validated = await validateUserRows(rows, makeHelpers(tenantId));
  const summary = summarizeUserImport(validated);

  const ctx = await getContext();
  const divisions = await ctx.find('divisions', { tenant_id: tenantId, is_active: 1 }, { projection: { _id: 0, id: 1, name: 1 } });
  const divisionIdByName = new Map(divisions.map((division: any) => [String(division.name ?? '').trim().toLowerCase(), division.id]));

  const operations: Array<{ row: typeof validated[number]; table: string; doc: Record<string, any> }> = [];
  for (const row of validated) {
    if (row.errors.length > 0) continue;
    const role = row.resolved.role;
    const table = ROLE_TABLES[role];
    if (!table) continue;
    // Division is optional — blank means no division (tenant-wide user).
    const divisionId = divisionIdByName.get(row.division.trim().toLowerCase()) ?? null;
    operations.push({
      row,
      table,
      doc: {
        tenant_id: tenantId,
        division_id: divisionId,
        name: row.name,
        email: row.resolved.email,
        password_hash: await bcrypt.hash(row.password, 10),
        is_active: 1,
        created_at: new Date(),
      },
    });
  }

  let imported = 0;
  const failed: Array<{ row: number; message: string }> = [];
  const CHUNK = 500;
  for (let offset = 0; offset < operations.length; offset += CHUNK) {
    const chunk = operations.slice(offset, offset + CHUNK);
    try {
      await withTransaction(async (tx) => {
        for (const op of chunk) await tx.insert(op.table, op.doc);
      });
      imported += chunk.length;
    } catch (error: any) {
      const message = error?.message || 'This chunk failed and was rolled back (no rows from it were saved)';
      for (const op of chunk) failed.push({ row: op.row.excelRow, message });
    }
  }

  await ctx.insert('activity_logs', {
    tenant_id: tenantId,
    user_name: req.user?.name || 'System',
    user_role: req.user?.role || 'ADMIN',
    action: 'IMPORT_USERS',
    description: `Bulk import: ${imported} user(s) imported, ${failed.length} failed${summary.errors > 0 ? `, ${summary.errors} row(s) skipped (invalid)` : ''}`,
  });

  res.json({ imported, skippedRows: summary.errors, failed, summary });
}
