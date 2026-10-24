import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { query, execute } from '../config/database';
import { RowDataPacket } from 'mysql2';

type UserTypeInfo = { table: string; role: string };

const USER_TYPES: Record<string, UserTypeInfo> = {
  admin: { table: 'admins', role: 'ADMIN' },
  qc: { table: 'qc_users', role: 'QC' },
  dispatch: { table: 'dispatch_users', role: 'DISPATCH' },
};

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
    'INSERT INTO activity_logs (user_name, user_role, action, description) VALUES (?, ?, ?, ?)',
    [req.user?.name || 'System', req.user?.role || 'ADMIN', action, description]
  );
}

function publicUser(row: RowDataPacket, role: string): Record<string, unknown> {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role,
    is_active: Number(row.is_active) === 1 ? 1 : 0,
    created_at: row.created_at,
  };
}

export async function listAllUsers(_req: Request, res: Response): Promise<void> {
  const results = await Promise.all(
    Object.values(USER_TYPES).map(async info => {
      const rows = await query<RowDataPacket[]>(
        `SELECT id, name, email, is_active, created_at FROM ${info.table} ORDER BY created_at DESC`
      );
      return rows.map(row => publicUser(row, info.role));
    })
  );

  const users = results
    .flat()
    .sort((a, b) => new Date(String(b.created_at)).getTime() - new Date(String(a.created_at)).getTime());

  res.json(users);
}

export async function listUsers(req: Request, res: Response): Promise<void> {
  const info = normalizeType(req.params.type);
  if (!info) { res.status(400).json({ error: 'Invalid user type' }); return; }

  const users = await query<RowDataPacket[]>(
    `SELECT id, name, email, is_active, created_at FROM ${info.table} ORDER BY created_at DESC`
  );
  res.json(users.map(row => publicUser(row, info.role)));
}

export async function addUser(req: Request, res: Response): Promise<void> {
  const info = normalizeType(req.params.type) || normalizeRole(req.body.role);
  if (!info) { res.status(400).json({ error: 'A valid role is required' }); return; }

  const { name, email, password } = req.body;
  if (!name || !email || !password) {
    res.status(400).json({ error: 'Name, email, and password are required' });
    return;
  }
  if (String(password).length < 6) {
    res.status(400).json({ error: 'Password must be at least 6 characters' });
    return;
  }

  try {
    const hash = await bcrypt.hash(password, 10);
    const result = await execute(
      `INSERT INTO ${info.table} (name, email, password_hash, is_active) VALUES (?, ?, ?, 1)`,
      [name.trim(), email.trim().toLowerCase(), hash]
    );
    await logActivity(req, 'USER_CREATED', `${info.role} user "${name}" (${email}) created`);
    res.status(201).json({ id: result.insertId, name, email, role: info.role, is_active: 1 });
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
  if (!name || !email) {
    res.status(400).json({ error: 'Name and email are required' });
    return;
  }

  try {
    const result = await execute(
      `UPDATE ${info.table} SET name = ?, email = ? WHERE id = ?`,
      [name.trim(), email.trim().toLowerCase(), id]
    );
    if (result.affectedRows === 0) { res.status(404).json({ error: 'User not found' }); return; }
    await logActivity(req, 'USER_UPDATED', `${info.role} user "${name}" (${email}) updated`);
    res.json({ message: 'User updated' });
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
  const result = await execute(`UPDATE ${info.table} SET password_hash = ? WHERE id = ?`, [hash, id]);
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

  const result = await execute(`UPDATE ${info.table} SET is_active = ? WHERE id = ?`, [active ? 1 : 0, id]);
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

  const result = await execute(`DELETE FROM ${info.table} WHERE id = ?`, [id]);
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
