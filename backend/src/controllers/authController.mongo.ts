import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt, { SignOptions } from 'jsonwebtoken';
import { createHash, randomBytes } from 'crypto';
import { DbContext, getContext, now, withTransaction } from '../config/database';
import { JwtPayload, Role } from '../types';
import { equalsIgnoreCase } from '../services/queryService';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';
const JWT_EXPIRES_IN: SignOptions['expiresIn'] = (process.env.JWT_EXPIRES_IN || '24h') as any;
const REFRESH_TOKEN_DAYS = Number(process.env.REFRESH_TOKEN_DAYS) || 30;

const USER_TABLES: { table: JwtPayload['table']; role: Role }[] = [
  { table: 'admins', role: 'ADMIN' },
  { table: 'qc_users', role: 'QC' },
  { table: 'dispatch_users', role: 'DISPATCH' },
];

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function signAccessToken(user: { id: number; name: string; email: string }, role: Role, table: JwtPayload['table']): string {
  return jwt.sign(
    { userId: user.id, role, name: user.name, email: user.email, table },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
}

async function issueRefreshToken(
  ctx: DbContext,
  user: { id: number },
  role: Role,
  table: JwtPayload['table'],
  deviceUuid?: string
): Promise<{ refreshToken: string; refreshExpiresAt: string }> {
  const refreshToken = randomBytes(48).toString('hex');
  const tokenHash = hashToken(refreshToken);
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_DAYS * 24 * 60 * 60 * 1000);
  await ctx.insert('refresh_tokens', {
    token_hash: tokenHash,
    user_id: user.id,
    user_role: role,
    user_table: table,
    device_uuid: deviceUuid || null,
    expires_at: expiresAt,
    revoked_at: null,
  });
  return { refreshToken, refreshExpiresAt: expiresAt.toISOString() };
}

async function findActiveUser(
  ctx: DbContext,
  role: Role,
  table: JwtPayload['table'],
  id: number
): Promise<Record<string, any> | null> {
  const user = await ctx.findOne(table, { id: Number(id) }, {
    projection: { _id: 0, id: 1, name: 1, email: 1, is_active: 1 },
  });
  if (!user || Number(user.is_active) !== 1) return null;
  return user;
}

export async function login(req: Request, res: Response): Promise<void> {
  const { email, password, device_uuid } = req.body;
  if (!email || !password) {
    res.status(400).json({ error: 'Email and password required' });
    return;
  }

  const ctx = await getContext();
  for (const c of USER_TABLES) {
    const user = await ctx.findOne(c.table, { email: equalsIgnoreCase(String(email)) });
    if (user) {
      const valid = await bcrypt.compare(password, user.password_hash);
      if (!valid) {
        res.status(401).json({ error: 'Invalid credentials' });
        return;
      }
      if (Number(user.is_active) !== 1) {
        res.status(403).json({ error: 'Account is deactivated. Contact an administrator.' });
        return;
      }
      const account = user as unknown as { id: number; name: string; email: string };
      const token = signAccessToken(account, c.role, c.table);
      const refresh = await issueRefreshToken(ctx, account, c.role, c.table, device_uuid);
      res.json({
        token,
        refreshToken: refresh.refreshToken,
        refreshExpiresAt: refresh.refreshExpiresAt,
        user: { id: user.id, name: user.name, email: user.email, role: c.role },
      });
      return;
    }
  }

  res.status(401).json({ error: 'Invalid credentials' });
}

export async function refresh(req: Request, res: Response): Promise<void> {
  const { refreshToken, device_uuid } = req.body;
  if (!refreshToken || typeof refreshToken !== 'string') {
    res.status(400).json({ error: 'Refresh token required' });
    return;
  }

  try {
    const result = await withTransaction(async (ctx) => {
      const record = await ctx.findOne('refresh_tokens', {
        token_hash: hashToken(refreshToken),
        revoked_at: null,
        expires_at: { $gt: now() },
      });
      if (!record) return null;
      const supportedTables: Record<string, Role> = {
        admins: 'ADMIN',
        qc_users: 'QC',
        dispatch_users: 'DISPATCH',
      };
      if (supportedTables[record.user_table] !== record.user_role) return null;

      const user = await findActiveUser(
        ctx,
        record.user_role as Role,
        record.user_table as JwtPayload['table'],
        Number(record.user_id)
      );
      if (!user) return null;

      await ctx.updateOne(
        'refresh_tokens',
        { id: Number(record.id), revoked_at: null },
        { $set: { revoked_at: now() } }
      );

      const next = randomBytes(48).toString('hex');
      const expiresAt = new Date(Date.now() + REFRESH_TOKEN_DAYS * 24 * 60 * 60 * 1000);
      await ctx.insert('refresh_tokens', {
        token_hash: hashToken(next),
        user_id: Number(record.user_id),
        user_role: record.user_role,
        user_table: record.user_table,
        device_uuid: device_uuid || record.device_uuid,
        expires_at: expiresAt,
        revoked_at: null,
      });

      const account = user as unknown as { id: number; name: string; email: string };
      return {
        token: signAccessToken(account, record.user_role as Role, record.user_table as JwtPayload['table']),
        refreshToken: next,
        refreshExpiresAt: expiresAt.toISOString(),
        user: { id: account.id, name: account.name, email: account.email, role: record.user_role },
      };
    });

    if (!result) {
      res.status(401).json({ error: 'Invalid or expired refresh token' });
      return;
    }
    res.json(result);
  } catch (error) {
    console.error('Refresh token error:', error);
    res.status(500).json({ error: 'Could not refresh session' });
  }
}

export async function logout(req: Request, res: Response): Promise<void> {
  if (!req.user) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }
  const ctx = await getContext();
  const { refreshToken, allDevices } = req.body || {};
  if (refreshToken && typeof refreshToken === 'string') {
    await ctx.updateMany(
      'refresh_tokens',
      {
        token_hash: hashToken(refreshToken),
        user_id: req.user.userId,
        user_role: req.user.role,
        revoked_at: null,
      },
      { $set: { revoked_at: now() } }
    );
  } else if (allDevices) {
    await ctx.updateMany(
      'refresh_tokens',
      { user_id: req.user.userId, user_role: req.user.role, revoked_at: null },
      { $set: { revoked_at: now() } }
    );
  }
  res.json({ message: 'Signed out' });
}

export async function me(_req: Request, res: Response): Promise<void> {
  if (!_req.user) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }
  const ctx = await getContext();
  const user = await ctx.findOne(_req.user.table, { id: _req.user.userId }, {
    projection: { _id: 0, id: 1, name: 1, email: 1, is_active: 1, created_at: 1 },
  });
  if (!user) {
    res.status(404).json({ error: 'User not found' });
    return;
  }
  if (Number(user.is_active) !== 1) {
    res.status(403).json({ error: 'Account is deactivated. Contact an administrator.' });
    return;
  }
  res.json({ ...user, role: _req.user.role });
}
