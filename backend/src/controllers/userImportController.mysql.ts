import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { execute, query, withTransaction } from '../config/database';
import { RowDataPacket } from 'mysql2';
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
      const emails = new Set<string>();
      await Promise.all(Object.values(ROLE_TABLES).map(async (table) => {
        const rows = await query<RowDataPacket[]>(
          `SELECT email FROM \`${table}\` WHERE tenant_id = ?`, [tenantId]
        );
        for (const row of rows) {
          const email = String(row.email ?? '').trim().toLowerCase();
          if (email && !email.startsWith('__role_archive_')) emails.add(email);
        }
      }));
      return emails;
    },
    divisionNames: async () => {
      const rows = await query<RowDataPacket[]>(
        'SELECT name FROM divisions WHERE tenant_id = ? AND is_active = 1', [tenantId]
      );
      return new Set(rows.map((row) => String(row.name ?? '').trim().toLowerCase()).filter(Boolean));
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
  const divisionRows = await query<RowDataPacket[]>(
    'SELECT name FROM divisions WHERE tenant_id = ? AND is_active = 1 ORDER BY name',
    [req.user!.tenantId],
  );
  const buffer = await buildUserImportTemplate(
    [],
    divisionRows.map((row) => String(row.name ?? '')),
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

  const divisionRows = await query<RowDataPacket[]>(
    'SELECT id, name FROM divisions WHERE tenant_id = ? AND is_active = 1', [tenantId]
  );
  const divisionIdByName = new Map(divisionRows.map((row) => [String(row.name ?? '').trim().toLowerCase(), row.id]));

  const operations: Array<{ row: typeof validated[number]; sql: string; args: any[] }> = [];
  for (const row of validated) {
    if (row.errors.length > 0) continue;
    const role = row.resolved.role;
    const table = ROLE_TABLES[role];
    if (!table) continue;
    // Division is optional — blank means no division (tenant-wide user).
    const divisionId = divisionIdByName.get(row.division.trim().toLowerCase()) ?? null;
    const hash = await bcrypt.hash(row.password, 10);
    operations.push({
      row,
      sql: `INSERT INTO \`${table}\` (tenant_id, division_id, name, email, password_hash, is_active, created_at) VALUES (?, ?, ?, ?, ?, 1, NOW())`,
      args: [tenantId, divisionId, row.name, row.resolved.email, hash],
    });
  }

  let imported = 0;
  const failed: Array<{ row: number; message: string }> = [];
  const CHUNK = 500;
  for (let offset = 0; offset < operations.length; offset += CHUNK) {
    const chunk = operations.slice(offset, offset + CHUNK);
    try {
      await withTransaction(async (conn) => {
        for (const op of chunk) await (conn as any).query(op.sql, op.args);
      });
      imported += chunk.length;
    } catch (error: any) {
      const message = error?.code === 'ER_DUP_ENTRY'
        ? 'Duplicate email in this chunk (transaction rolled back — no rows from it were saved)'
        : (error?.message || 'This chunk failed and was rolled back (no rows from it were saved)');
      for (const op of chunk) failed.push({ row: op.row.excelRow, message });
    }
  }

  await execute(
    'INSERT INTO activity_logs (user_name, user_role, action, description, tenant_id) VALUES (?, ?, ?, ?, ?)',
    [req.user?.name || 'System', req.user?.role || 'ADMIN', 'IMPORT_USERS',
      `Bulk import: ${imported} user(s) imported, ${failed.length} failed${summary.errors > 0 ? `, ${summary.errors} row(s) skipped (invalid)` : ''}`,
      tenantId]
  );

  res.json({ imported, skippedRows: summary.errors, failed, summary });
}
