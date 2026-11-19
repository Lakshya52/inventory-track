import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { query, execute } from '../config/database';
import { withTransaction } from '../config/database.mysql';
import { ResultSetHeader, RowDataPacket } from 'mysql2';

type UserTypeInfo = { table: string; role: string };

const USER_TYPES: Record<string, UserTypeInfo> = {
  admin: { table: 'admins', role: 'ADMIN' },
  qc: { table: 'qc_users', role: 'QC' },
  dispatch: { table: 'dispatch_users', role: 'DISPATCH' },
};

const USER_TABLES = Object.values(USER_TYPES);

async function emailExists(email: string, tenantId: string | number, exclude?: { table: string; id: string }): Promise<boolean> {
  for (const info of USER_TABLES) {
    const params: unknown[] = [tenantId, email];
    let sql = `SELECT id FROM ${info.table} WHERE tenant_id = ? AND LEFT(email, 15) <> '__role_archive_' AND LOWER(email) = LOWER(?)`;
    if (exclude?.table === info.table) {
      sql += ' AND id <> ?';
      params.push(exclude.id);
    }
    sql += ' LIMIT 1';
    const rows = await query<RowDataPacket[]>(sql, params);
    if (rows.length > 0) return true;
  }
  return false;
}

function archiveEmail(role: string, id: string): string {
  return `__role_archive_${role.toLowerCase()}_${id}_${Date.now()}@invalid.local`;
}

function validUserDetails(name: unknown, email: unknown): name is string {
  return typeof name === 'string' && name.trim().length > 0 &&
    typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

function normalizeType(value: string | undefined): UserTypeInfo | null {
  if (!value) return null;
  const key = value.toLowerCase().replace(/s$/, '');
  return USER_TYPES[key] || null;
}

function normalizeRole(value: string | undefined): UserTypeInfo | null {
  if (!value) return null;
  return normalizeType(value.toLowerCase());
}

async function logActivity(req: Request, action: string, description: string): Promise<void> {
  await execute(
    'INSERT INTO activity_logs (user_name, user_role, action, description, tenant_id, division_id) VALUES (?, ?, ?, ?, ?, ?)',
    [req.user?.name || 'System', req.user?.role || 'ADMIN', action, description, req.user?.tenantId ?? null, req.user?.divisionId ?? null]
  );
}

function publicUser(row: RowDataPacket, role: string, divisionName?: string | null): Record<string, unknown> {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role,
    is_active: Number(row.is_active) === 1 ? 1 : 0,
    created_at: row.created_at,
    division_id: row.division_id ?? null,
    division_name: divisionName ?? null,
  };
}

/** Batch-resolve division names for rows that carry division_id. */
async function divisionNames(
  rows: Array<RowDataPacket | Record<string, any>>,
  tenantId: string | number
): Promise<Map<string, string>> {
  const ids = [...new Set(rows.map((row) => row.division_id).filter((id) => id !== null && id !== undefined))];
  if (ids.length === 0) return new Map();
  const placeholders = ids.map(() => '?').join(', ');
  const divisions = await query<RowDataPacket[]>(`SELECT id, name FROM divisions WHERE tenant_id = ? AND id IN (${placeholders})`, [tenantId, ...ids]);
  return new Map(divisions.map((division) => [String(division.id), division.name]));
}

/** Resolve the division to assign (or null), validated against the caller's tenant. */
async function resolveDivision(
  value: unknown,
  tenantId: string | number
): Promise<{ id: number | null; error?: string }> {
  if (value === null || value === undefined || value === '') return { id: null };
  const num = Number(value);
  if (!Number.isSafeInteger(num) || num < 1) return { id: null, error: 'Select a valid division' };
  const rows = await query<RowDataPacket[]>('SELECT id, is_active FROM divisions WHERE id = ? AND tenant_id = ? LIMIT 1', [num, tenantId]);
  if (rows.length === 0) return { id: null, error: 'Division not found' };
  if (Number(rows[0].is_active) !== 1) return { id: null, error: 'That division is deactivated' };
  return { id: num };
}

export async function listAllUsers(req: Request, res: Response): Promise<void> {
  const results = await Promise.all(
    Object.values(USER_TYPES).map(async info => {
      const rows = await query<RowDataPacket[]>(
        `SELECT id, name, email, is_active, created_at, division_id FROM ${info.table} WHERE tenant_id = ? AND LEFT(email, 15) <> '__role_archive_' ORDER BY created_at DESC`, [req.user?.tenantId]
      );
      return rows.map(row => publicUser(row, info.role));
    })
  );

  const flat = results.flat();
  const names = await divisionNames(flat, req.user!.tenantId);
  const users = flat
    .map((row: any) => ({ ...row, division_name: row.division_id ? names.get(String(row.division_id)) ?? null : null }))
    .sort((a, b) => new Date(String(b.created_at)).getTime() - new Date(String(a.created_at)).getTime());

  res.json(users);
}

export async function listUsers(req: Request, res: Response): Promise<void> {
  const info = normalizeType(req.params.type);
  if (!info) { res.status(400).json({ error: 'Invalid user type' }); return; }

  const users = await query<RowDataPacket[]>(
    `SELECT id, name, email, is_active, created_at, division_id FROM ${info.table} WHERE tenant_id = ? AND LEFT(email, 15) <> '__role_archive_' ORDER BY created_at DESC`, [req.user?.tenantId]
  );
  const names = await divisionNames(users, req.user!.tenantId);
  res.json(users.map(row => publicUser(row, info.role, row.division_id ? names.get(String(row.division_id)) ?? null : null)));
}

export async function addUser(req: Request, res: Response): Promise<void> {
  const info = normalizeType(req.params.type) || normalizeRole(req.body.role);
  if (!info) { res.status(400).json({ error: 'A valid role is required' }); return; }

  const { name, email, password } = req.body;
  if (!validUserDetails(name, email) || typeof password !== 'string' || !password) {
    res.status(400).json({ error: 'A valid name, email, and password are required' });
    return;
  }
  if (String(password).length < 6) {
    res.status(400).json({ error: 'Password must be at least 6 characters' });
    return;
  }

  try {
    // ADMIN sees every division; a division assignment is only meaningful for QC / DISPATCH.
    const wantsDivision = info.role !== 'ADMIN' && req.body?.division_id !== undefined && req.body?.division_id !== '';
    const division = wantsDivision
      ? await resolveDivision(req.body.division_id, req.user!.tenantId)
      : { id: null };
    if (division.error) { res.status(400).json({ error: division.error }); return; }

    const normalizedEmail = email.trim().toLowerCase();
    if (await emailExists(normalizedEmail, req.user!.tenantId)) {
      res.status(400).json({ error: 'Email already exists' });
      return;
    }
    const hash = await bcrypt.hash(password, 10);
    const result = await execute(
      `INSERT INTO ${info.table} (tenant_id, division_id, name, email, password_hash, is_active) VALUES (?, ?, ?, ?, ?, 1)`,
      [req.user!.tenantId, division.id, name.trim(), normalizedEmail, hash]
    );
    await logActivity(req, 'USER_CREATED', `${info.role} user "${name}" (${email}) created`);
    res.status(201).json({ id: result.insertId, name, email, role: info.role, is_active: 1, division_id: division.id });
  } catch (err: any) {
    if (err.code === 'ER_DUP_ENTRY') {
      res.status(400).json({ error: 'Email already exists' });
      return;
    }
    throw err;
  }
}

export async function updateUser(req: Request, res: Response): Promise<void> {
  const info = normalizeType(req.params.type);
  if (!info) { res.status(400).json({ error: 'Invalid user type' }); return; }

  const { id } = req.params;
  const { name, email } = req.body;
  const targetInfo = req.body.role === undefined ? info : normalizeRole(req.body.role);
  if (!targetInfo) { res.status(400).json({ error: 'A valid role is required' }); return; }
  if (!validUserDetails(name, email)) {
    res.status(400).json({ error: 'A valid name and email are required' });
    return;
  }

  const isSelf = info.role === req.user?.role && String(id) === String(req.user?.userId);
  if (isSelf && targetInfo.role !== info.role) {
    res.status(400).json({ error: 'You cannot change your own role' });
    return;
  }

  // Division assignment is only meaningful for QC / DISPATCH; admins see all divisions.
  const wantsDivision = req.body?.division_id !== undefined;
  let division: { id: number | null; error?: string } = { id: null };
  if (wantsDivision && targetInfo.role !== 'ADMIN') {
    division = await resolveDivision(req.body.division_id, req.user!.tenantId);
    if (division.error) { res.status(400).json({ error: division.error }); return; }
  }

  const normalizedEmail = email.trim().toLowerCase();
  if (await emailExists(normalizedEmail, req.user!.tenantId, { table: info.table, id })) {
    res.status(400).json({ error: 'Email already exists' });
    return;
  }

  try {
    if (targetInfo.table === info.table) {
      const divisionSql = wantsDivision && targetInfo.role !== 'ADMIN' ? ', division_id = ?' : (wantsDivision ? ', division_id = NULL' : '');
      const divisionParams = wantsDivision && targetInfo.role !== 'ADMIN' ? [division.id] : [];
      const result = await execute(
        `UPDATE ${info.table} SET name = ?, email = ?${divisionSql} WHERE id = ? AND tenant_id = ?`,
        [name.trim(), normalizedEmail, ...divisionParams, id, req.user!.tenantId]
      );
      if (result.affectedRows === 0) {
        const rows = await query<RowDataPacket[]>(`SELECT id FROM ${info.table} WHERE id = ? AND tenant_id = ? LIMIT 1`, [id, req.user!.tenantId]);
        if (rows.length === 0) { res.status(404).json({ error: 'User not found' }); return; }
      }
    } else {
      const targetId = await withTransaction(async conn => {
        const [rows] = await conn.execute<RowDataPacket[]>(
          `SELECT id, password_hash, is_active, created_at, division_id FROM ${info.table} WHERE id = ? AND tenant_id = ? FOR UPDATE`, [id, req.user!.tenantId]
        );
        if (rows.length === 0) return null;
        const source = rows[0];
        const divisionForInsert = wantsDivision && targetInfo.role !== 'ADMIN'
          ? division.id
          : (targetInfo.role === 'ADMIN' ? null : (source.division_id ?? null));
        const [inserted] = await conn.execute<ResultSetHeader>(
          `INSERT INTO ${targetInfo.table} (tenant_id, division_id, name, email, password_hash, is_active, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [req.user!.tenantId, divisionForInsert, name.trim(), normalizedEmail, source.password_hash, Number(source.is_active) === 1 ? 1 : 0, source.created_at]
        );
        await conn.execute(
          `UPDATE ${info.table} SET email = ?, is_active = 0 WHERE id = ? AND tenant_id = ?`,
          [archiveEmail(info.role, id), id, req.user!.tenantId]
        );
        await conn.execute(
          'UPDATE refresh_tokens SET revoked_at = CURRENT_TIMESTAMP(3) WHERE user_id = ? AND user_role = ? AND user_table = ? AND revoked_at IS NULL',
          [id, info.role, info.table]
        );
        return inserted.insertId;
      });
      if (targetId === null) { res.status(404).json({ error: 'User not found' }); return; }
    }
    await logActivity(req, targetInfo.role === info.role ? 'USER_UPDATED' : 'USER_ROLE_CHANGED',
      `${info.role} user "${name}" (${email}) ${targetInfo.role === info.role ? 'updated' : `changed to ${targetInfo.role}`}`);
    res.json({ message: 'User updated', role: targetInfo.role });
  } catch (err: any) {
    if (err.code === 'ER_DUP_ENTRY') {
      res.status(400).json({ error: 'Email already exists' });
      return;
    }
    throw err;
  }
}

export async function changePassword(req: Request, res: Response): Promise<void> {
  const info = normalizeType(req.params.type);
  if (!info) { res.status(400).json({ error: 'Invalid user type' }); return; }

  const { id } = req.params;
  const { password } = req.body;
  if (!password || String(password).length < 6) {
    res.status(400).json({ error: 'Password must be at least 6 characters' });
    return;
  }

  const hash = await bcrypt.hash(password, 10);
  const result = await execute(`UPDATE ${info.table} SET password_hash = ? WHERE id = ? AND tenant_id = ?`, [hash, id, req.user!.tenantId]);
  if (result.affectedRows === 0) { res.status(404).json({ error: 'User not found' }); return; }

  await logActivity(req, 'USER_PASSWORD_CHANGED', `Password changed for ${info.role} user #${id}`);
  res.json({ message: 'Password updated' });
}

export async function setUserStatus(req: Request, res: Response): Promise<void> {
  const info = normalizeType(req.params.type);
  if (!info) { res.status(400).json({ error: 'Invalid user type' }); return; }

  const { id } = req.params;
  const active = req.body.is_active === true || req.body.is_active === 1 || req.body.is_active === '1';
  const isSelf = info.role === req.user?.role && Number(id) === req.user?.userId;

  if (isSelf && !active) {
    res.status(400).json({ error: 'You cannot deactivate your own account' });
    return;
  }

  const result = await execute(`UPDATE ${info.table} SET is_active = ? WHERE id = ? AND tenant_id = ?`, [active ? 1 : 0, id, req.user!.tenantId]);
  if (result.affectedRows === 0) { res.status(404).json({ error: 'User not found' }); return; }

  await logActivity(
    req,
    active ? 'USER_ACTIVATED' : 'USER_DEACTIVATED',
    `${info.role} user #${id} ${active ? 'activated' : 'deactivated'}`
  );
  res.json({ message: active ? 'User activated' : 'User deactivated', is_active: active ? 1 : 0 });
}

export async function deleteUser(req: Request, res: Response): Promise<void> {
  const info = normalizeType(req.params.type);
  if (!info) { res.status(400).json({ error: 'Invalid user type' }); return; }

  const { id } = req.params;
  if (info.role === req.user?.role && Number(id) === req.user?.userId) {
    res.status(400).json({ error: 'You cannot delete your own account' });
    return;
  }

  const result = await execute(`DELETE FROM ${info.table} WHERE id = ? AND tenant_id = ?`, [id, req.user!.tenantId]);
  if (result.affectedRows === 0) { res.status(404).json({ error: 'User not found' }); return; }

  await logActivity(req, 'USER_DELETED', `${info.role} user #${id} deleted`);
  res.json({ message: 'User deleted' });
}

export async function updateProfile(req: Request, res: Response): Promise<void> {
  if (!req.user) { res.status(401).json({ error: 'Not authenticated' }); return; }
  const { name, currentPassword, newPassword } = req.body;
  const rows = await query<RowDataPacket[]>(
    `SELECT * FROM ${req.user.table} WHERE id = ?`, [req.user.userId]
  );
  if (rows.length === 0) { res.status(404).json({ error: 'User not found' }); return; }

  if (newPassword) {
    if (!currentPassword) {
      res.status(400).json({ error: 'Current password is required to set a new password' });
      return;
    }
    const valid = await bcrypt.compare(currentPassword, rows[0].password_hash);
    if (!valid) {
      res.status(400).json({ error: 'Current password is incorrect' });
      return;
    }
    const hash = await bcrypt.hash(newPassword, 10);
    await execute(`UPDATE ${req.user.table} SET name = ?, password_hash = ? WHERE id = ?`, [name || req.user.name, hash, req.user.userId]);
  } else {
    await execute(`UPDATE ${req.user.table} SET name = ? WHERE id = ?`, [name || req.user.name, req.user.userId]);
  }
  res.json({ message: 'Profile updated' });
}
