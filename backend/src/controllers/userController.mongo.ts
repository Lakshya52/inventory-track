import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { getContext, isDuplicateKey, isValidId, withTransaction } from '../config/database';
import { equalsIgnoreCase } from '../services/queryService';
import { divisionFilter } from '../utils/division';

type UserTypeInfo = { table: string; role: string };

const USER_TYPES: Record<string, UserTypeInfo> = {
  admin: { table: 'admins', role: 'ADMIN' },
  qc: { table: 'qc_users', role: 'QC' },
  dispatch: { table: 'dispatch_users', role: 'DISPATCH' },
};

async function emailExists(email: string, tenantId: string | number, exclude?: { table: string; id: string }): Promise<boolean> {
  const ctx = await getContext();
  for (const info of Object.values(USER_TYPES)) {
    const rows = await ctx.find(info.table, {
      tenant_id: tenantId,
      email: equalsIgnoreCase(email),
      $nor: [{ email: /^__role_archive_/i }],
    }, {
      projection: { _id: 0, id: 1 },
    });
    if (rows.some(row => exclude?.table !== info.table || String(row.id) !== exclude.id)) return true;
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
  const ctx = await getContext();
  await ctx.insert('activity_logs', {
    tenant_id: req.user?.tenantId,
    user_name: req.user?.name || 'System',
    user_role: req.user?.role || 'ADMIN',
    action,
    description,
  });
}

function publicUser(row: Record<string, any>, role: string, divisionName?: string | null): Record<string, unknown> {
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
  ctx: Awaited<ReturnType<typeof getContext>>,
  rows: Record<string, any>[],
  tenantId: string | number
): Promise<Map<string, string>> {
  const ids = [...new Set(rows.map((row) => row.division_id).filter((id) => id !== null && id !== undefined))];
  if (ids.length === 0) return new Map();
  const divisions = await ctx.find('divisions', { _id: { $in: ids }, tenant_id: tenantId }, { projection: { _id: 1, name: 1 } });
  return new Map(divisions.map((division: any) => [String(division.id), division.name]));
}

/** Resolve the division to assign (or null), validated against the caller's tenant. */
async function resolveDivision(
  ctx: Awaited<ReturnType<typeof getContext>>,
  value: unknown,
  tenantId: string | number
): Promise<{ id: string | number | null; error?: string }> {
  if (value === null || value === undefined || value === '') return { id: null };
  if (!isValidId(value)) return { id: null, error: 'Select a valid division' };
  const division = await ctx.findOne('divisions', { id: value as string, tenant_id: tenantId }, { projection: { _id: 0, id: 1, is_active: 1 } });
  if (!division) return { id: null, error: 'Division not found' };
  if (Number(division.is_active) !== 1) return { id: null, error: 'That division is deactivated' };
  return { id: division.id };
}

export async function listAllUsers(req: Request, res: Response): Promise<void> {
  const ctx = await getContext();
  const results = await Promise.all(
    Object.values(USER_TYPES).map(async info => {
      const rows = await ctx.find(info.table, {
        tenant_id: req.user?.tenantId,
        email: { $not: /^__role_archive_/i },
        ...divisionFilter(req),
      }, {
        sort: { created_at: -1 },
        projection: { _id: 0, id: 1, name: 1, email: 1, is_active: 1, created_at: 1, division_id: 1 },
      });
      return rows.map(row => publicUser(row, info.role));
    })
  );

  const flat = results.flat();
  const names = await divisionNames(ctx, flat, req.user!.tenantId);
  const users = flat
    .map((row: any) => ({ ...row, division_name: row.division_id ? names.get(String(row.division_id)) ?? null : null }))
    .sort((a, b) => new Date(String(b.created_at)).getTime() - new Date(String(a.created_at)).getTime());

  res.json(users);
}

/** GET /api/users/paged — server-side search, filter and pagination for the web UI. */
export async function listUsersPage(req: Request, res: Response): Promise<void> {
  const tenantId = req.user!.tenantId;
  const ctx = await getContext();
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 25));
  const q = String(req.query.q || '').trim().toLowerCase();
  const role = String(req.query.role || 'ALL');
  const status = String(req.query.status || 'all');

  // The single ADMIN account is not part of team management — it is never
  // listed, filtered or paginated alongside QC/Dispatch users.
  const managedTypes = Object.values(USER_TYPES).filter((info) => info.role !== 'ADMIN');
  const results = await Promise.all(
    managedTypes.map(async info => {
      const rows = await ctx.find(info.table, {
        tenant_id: tenantId,
        email: { $not: /^__role_archive_/i },
        ...divisionFilter(req),
      }, {
        sort: { created_at: -1 },
        projection: { _id: 0, id: 1, name: 1, email: 1, is_active: 1, created_at: 1, division_id: 1 },
      });
      return rows.map(row => publicUser(row, info.role));
    })
  );
  const flat = results.flat();
  const names = await divisionNames(ctx, flat, tenantId);
  // A user in a deactivated division is effectively inactive — show them as
  // such even if their own account flag was never flipped.
  const divisionRows = await ctx.find('divisions', { tenant_id: tenantId }, { projection: { _id: 0, id: 1, is_active: 1 } });
  const activeDivisionIds = new Set(divisionRows.filter((d: any) => Number(d.is_active) === 1).map((d: any) => String(d.id)));
  const all = flat
    .map((row: any) => {
      const divisionActive = !row.division_id || activeDivisionIds.has(String(row.division_id));
      return {
        ...row,
        is_active: Number(row.is_active) === 1 && divisionActive ? 1 : 0,
        division_active: divisionActive ? 1 : 0,
        division_name: row.division_id ? names.get(String(row.division_id)) ?? null : null,
      };
    })
    .sort((a: any, b: any) => new Date(String(b.created_at)).getTime() - new Date(String(a.created_at)).getTime());

  const stats = {
    total: all.length,
    active: all.filter((user: any) => Number(user.is_active) === 1).length,
    qc: all.filter((user: any) => user.role === 'QC').length,
    dispatch: all.filter((user: any) => user.role === 'DISPATCH').length,
  };
  const matching = all.filter((user: any) => {
    const matchesSearch = !q || String(user.name || '').toLowerCase().includes(q)
      || String(user.email || '').toLowerCase().includes(q)
      || String(user.division_name || '').toLowerCase().includes(q);
    const matchesRole = role === 'ALL' || user.role === role;
    const matchesStatus = status === 'all'
      || (status === 'active' && Number(user.is_active) === 1)
      || (status === 'inactive' && Number(user.is_active) === 0);
    return matchesSearch && matchesRole && matchesStatus;
  });
  const total = matching.length;
  const pages = Math.max(1, Math.ceil(total / limit));
  res.json({
    items: matching.slice((page - 1) * limit, page * limit),
    total, page, limit, pages, stats,
  });
}

export async function listUsers(req: Request, res: Response): Promise<void> {
  const info = normalizeType(req.params.type);
  if (!info) { res.status(400).json({ error: 'Invalid user type' }); return; }

  const ctx = await getContext();
  const users = await ctx.find(info.table, {
    tenant_id: req.user?.tenantId,
    email: { $not: /^__role_archive_/i },
    ...divisionFilter(req),
  }, {
    sort: { created_at: -1 },
    projection: { _id: 0, id: 1, name: 1, email: 1, is_active: 1, created_at: 1, division_id: 1 },
  });
  const names = await divisionNames(ctx, users, req.user!.tenantId);
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

  const ctx = await getContext();
  try {
    // ADMIN sees every division, so a division assignment is only meaningful
    // for QC / DISPATCH users; it is validated against this tenant.
    const wantsDivision = info.role !== 'ADMIN' && req.body?.division_id !== undefined && req.body?.division_id !== '';
    const division = wantsDivision
      ? await resolveDivision(ctx, req.body.division_id, req.user!.tenantId)
      : { id: null };
    if (division.error) { res.status(400).json({ error: division.error }); return; }

    const normalizedEmail = email.trim().toLowerCase();
    if (await emailExists(normalizedEmail, req.user!.tenantId)) {
      res.status(400).json({ error: 'Email already exists' });
      return;
    }
    const hash = await bcrypt.hash(password, 10);
    const id = await ctx.insert(info.table, {
      tenant_id: req.user!.tenantId,
      division_id: division.id,
      name: name.trim(),
      email: normalizedEmail,
      password_hash: hash,
      is_active: 1,
    });
    await logActivity(req, 'USER_CREATED', `${info.role} user "${name}" (${email}) created`);
    res.status(201).json({ id, name, email, role: info.role, is_active: 1, division_id: division.id });
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

  const ctx = await getContext();
  // Division assignment is only meaningful for QC / DISPATCH; admins see all divisions.
  const wantsDivision = req.body?.division_id !== undefined;
  let division: { id: string | number | null; error?: string } = { id: null };
  if (wantsDivision && targetInfo.role !== 'ADMIN') {
    division = await resolveDivision(ctx, req.body.division_id, req.user!.tenantId);
    if (division.error) { res.status(400).json({ error: division.error }); return; }
  } else if (wantsDivision && targetInfo.role === 'ADMIN') {
    division = { id: null };
  }

  const normalizedEmail = email.trim().toLowerCase();
  if (await emailExists(normalizedEmail, req.user!.tenantId, { table: info.table, id })) {
    res.status(400).json({ error: 'Email already exists' });
    return;
  }

  try {
    if (targetInfo.table === info.table) {
      const update: Record<string, any> = { name: name.trim(), email: normalizedEmail };
      if (wantsDivision) update.division_id = division.id;
      const result = await ctx.updateOne(info.table, { id, tenant_id: req.user!.tenantId }, {
        $set: update,
      });
      if (result.matchedCount === 0) { res.status(404).json({ error: 'User not found' }); return; }
    } else {
      const result = await withTransaction(async ctx => {
        const source = await ctx.findOne(info.table, { id, tenant_id: req.user!.tenantId });
        if (!source) return null;
        const targetId = await ctx.insert(targetInfo.table, {
          tenant_id: req.user!.tenantId,
          division_id: wantsDivision ? division.id : (source.division_id ?? null),
          name: name.trim(),
          email: normalizedEmail,
          password_hash: source.password_hash,
          is_active: Number(source.is_active) === 1 ? 1 : 0,
          created_at: source.created_at,
        });
        const archived = await ctx.updateOne(info.table, { id, tenant_id: req.user!.tenantId }, {
          $set: { email: archiveEmail(info.role, id), is_active: 0 },
        });
        if (archived.matchedCount === 0) throw new Error('User role migration could not be completed');
        await ctx.updateMany('refresh_tokens', {
          user_id: id,
          user_role: info.role,
          user_table: info.table,
          revoked_at: null,
        }, { $set: { revoked_at: new Date() } });
        return targetId;
      });
      if (result === null) { res.status(404).json({ error: 'User not found' }); return; }
    }
    await logActivity(req, targetInfo.role === info.role ? 'USER_UPDATED' : 'USER_ROLE_CHANGED',
      `${info.role} user "${name}" (${email}) ${targetInfo.role === info.role ? 'updated' : `changed to ${targetInfo.role}`}`);
    res.json({ message: 'User updated', role: targetInfo.role });
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
  const result = await ctx.updateOne(info.table, { id, tenant_id: req.user!.tenantId }, { $set: { password_hash: hash } });
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
  // A user cannot be activated while their division is deactivated — the
  // division is what gates their access, so this must be fixed first.
  if (active) {
    const user = await ctx.findOne(info.table, { id, tenant_id: req.user!.tenantId }, { projection: { _id: 0, division_id: 1 } });
    if (!user) { res.status(404).json({ error: 'User not found' }); return; }
    if (user.division_id) {
      const division = await ctx.findOne('divisions', { id: user.division_id, tenant_id: req.user!.tenantId }, { projection: { _id: 0, name: 1, is_active: 1 } });
      if (division && Number(division.is_active) !== 1) {
        res.status(409).json({ error: `Division "${division.name}" is deactivated. Activate the division (or reassign the user) before activating this account.` });
        return;
      }
    }
  }
  const result = await ctx.updateOne(info.table, { id, tenant_id: req.user!.tenantId }, { $set: { is_active: active ? 1 : 0 } });
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
  const result = await ctx.deleteOne(info.table, { id, tenant_id: req.user!.tenantId });
  if (result.deletedCount === 0) { res.status(404).json({ error: 'User not found' }); return; }

  await logActivity(req, 'USER_DELETED', `${info.role} user #${id} deleted`);
  res.json({ message: 'User deleted' });
}

export async function updateProfile(req: Request, res: Response): Promise<void> {
  if (!req.user) { res.status(401).json({ error: 'Not authenticated' }); return; }
  const { name, currentPassword, newPassword } = req.body;
  const ctx = await getContext();
  const user = await ctx.findOne(req.user.table, { id: req.user.userId, tenant_id: req.user.tenantId });
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
    await ctx.updateOne(req.user.table, { id: req.user.userId, tenant_id: req.user.tenantId }, {
      $set: { name: name || req.user.name, password_hash: hash },
    });
  } else {
    await ctx.updateOne(req.user.table, { id: req.user.userId, tenant_id: req.user.tenantId }, {
      $set: { name: name || req.user.name },
    });
  }
  res.json({ message: 'Profile updated' });
}
