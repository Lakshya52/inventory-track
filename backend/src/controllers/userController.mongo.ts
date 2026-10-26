import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { getContext, isDuplicateKey, isValidId } from '../config/database';

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
  const ctx = await getContext();
  await ctx.insert('activity_logs', {
    user_name: req.user?.name || 'System',
    user_role: req.user?.role || 'ADMIN',
    action,
    description,
  });
}

function publicUser(row: Record<string, any>, role: string): Record<string, unknown> {
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
  const ctx = await getContext();
  const results = await Promise.all(
    Object.values(USER_TYPES).map(async info => {
      const rows = await ctx.find(info.table, {}, {
        sort: { created_at: -1 },
        projection: { _id: 0, id: 1, name: 1, email: 1, is_active: 1, created_at: 1 },
      });
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

  const ctx = await getContext();
  const users = await ctx.find(info.table, {}, {
    sort: { created_at: -1 },
    projection: { _id: 0, id: 1, name: 1, email: 1, is_active: 1, created_at: 1 },
  });
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

  const ctx = await getContext();
  try {
    const hash = await bcrypt.hash(password, 10);
    const id = await ctx.insert(info.table, {
      name: name.trim(),
      email: email.trim().toLowerCase(),
      password_hash: hash,
      is_active: 1,
    });
    await logActivity(req, 'USER_CREATED', `${info.role} user "${name}" (${email}) created`);
    res.status(201).json({ id, name, email, role: info.role, is_active: 1 });
  } catch (err: any) {
    if (isDuplicateKey(err)) {
      res.status(400).json({ error: 'Email already exists' });
      return;
    }
    throw err;
  }
}

export async function updateUser(req: Request, res: Response): Promise<void> {
  const info = normalizeType(req.params.type);
  if (!info) { res.status(400).json({ error: 'Invalid user type' }); return; }

  const id = req.params.id;
  if (!isValidId(id)) { res.status(400).json({ error: 'Invalid user id' }); return; }
  const { name, email } = req.body;
  if (!name || !email) {
    res.status(400).json({ error: 'Name and email are required' });
    return;
  }

  const ctx = await getContext();
  try {
    const result = await ctx.updateOne(info.table, { id }, {
      $set: { name: name.trim(), email: email.trim().toLowerCase() },
    });
    if (result.matchedCount === 0) { res.status(404).json({ error: 'User not found' }); return; }
    await logActivity(req, 'USER_UPDATED', `${info.role} user "${name}" (${email}) updated`);
    res.json({ message: 'User updated' });
  } catch (err: any) {
    if (isDuplicateKey(err)) {
      res.status(400).json({ error: 'Email already exists' });
      return;
    }
    throw err;
  }
}

export async function changePassword(req: Request, res: Response): Promise<void> {
  const info = normalizeType(req.params.type);
  if (!info) { res.status(400).json({ error: 'Invalid user type' }); return; }

  const id = req.params.id;
  if (!isValidId(id)) { res.status(400).json({ error: 'Invalid user id' }); return; }
  const { password } = req.body;
  if (!password || String(password).length < 6) {
    res.status(400).json({ error: 'Password must be at least 6 characters' });
    return;
  }

  const hash = await bcrypt.hash(password, 10);
  const ctx = await getContext();
  const result = await ctx.updateOne(info.table, { id }, { $set: { password_hash: hash } });
  if (result.matchedCount === 0) { res.status(404).json({ error: 'User not found' }); return; }

  await logActivity(req, 'USER_PASSWORD_CHANGED', `Password changed for ${info.role} user #${id}`);
  res.json({ message: 'Password updated' });
}

export async function setUserStatus(req: Request, res: Response): Promise<void> {
  const info = normalizeType(req.params.type);
  if (!info) { res.status(400).json({ error: 'Invalid user type' }); return; }

  const id = req.params.id;
  if (!isValidId(id)) { res.status(400).json({ error: 'Invalid user id' }); return; }
  const active = req.body.is_active === true || req.body.is_active === 1 || req.body.is_active === '1';
  const isSelf = info.role === req.user?.role && String(id) === String(req.user?.userId);

  if (isSelf && !active) {
    res.status(400).json({ error: 'You cannot deactivate your own account' });
    return;
  }

  const ctx = await getContext();
  const result = await ctx.updateOne(info.table, { id }, { $set: { is_active: active ? 1 : 0 } });
  if (result.matchedCount === 0) { res.status(404).json({ error: 'User not found' }); return; }

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

  const id = req.params.id;
  if (!isValidId(id)) { res.status(400).json({ error: 'Invalid user id' }); return; }
  if (info.role === req.user?.role && String(id) === String(req.user?.userId)) {
    res.status(400).json({ error: 'You cannot delete your own account' });
    return;
  }

  const ctx = await getContext();
  const result = await ctx.deleteOne(info.table, { id });
  if (result.deletedCount === 0) { res.status(404).json({ error: 'User not found' }); return; }

  await logActivity(req, 'USER_DELETED', `${info.role} user #${id} deleted`);
  res.json({ message: 'User deleted' });
}

export async function updateProfile(req: Request, res: Response): Promise<void> {
  if (!req.user) { res.status(401).json({ error: 'Not authenticated' }); return; }
  const { name, currentPassword, newPassword } = req.body;
  const ctx = await getContext();
  const user = await ctx.findOne(req.user.table, { id: req.user.userId });
  if (!user) { res.status(404).json({ error: 'User not found' }); return; }

  if (newPassword) {
    if (!currentPassword) {
      res.status(400).json({ error: 'Current password is required to set a new password' });
      return;
    }
    const valid = await bcrypt.compare(currentPassword, user.password_hash);
    if (!valid) {
      res.status(400).json({ error: 'Current password is incorrect' });
      return;
    }
    const hash = await bcrypt.hash(newPassword, 10);
    await ctx.updateOne(req.user.table, { id: req.user.userId }, {
      $set: { name: name || req.user.name, password_hash: hash },
    });
  } else {
    await ctx.updateOne(req.user.table, { id: req.user.userId }, {
      $set: { name: name || req.user.name },
    });
  }
  res.json({ message: 'Profile updated' });
}
