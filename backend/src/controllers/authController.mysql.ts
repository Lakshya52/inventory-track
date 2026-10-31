import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { createHash, randomBytes } from 'crypto';
import { query, withTransaction } from '../config/database.mysql';
import { RowDataPacket } from 'mysql2';
import { JwtPayload, Role } from '../types';
import { issueAccessToken } from '../services/tokens';

const REFRESH_TOKEN_DAYS = Number(process.env.REFRESH_TOKEN_DAYS) || 30;

const USER_TABLES: { table: JwtPayload['table']; role: Role }[] = [
  { table: 'admins', role: 'ADMIN' },
  { table: 'qc_users', role: 'QC' },
  { table: 'dispatch_users', role: 'DISPATCH' },
];

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

async function issueRefreshToken(
  user: { id: number },
  role: Role,
  table: JwtPayload['table'],
  deviceUuid?: string
): Promise<{ refreshToken: string; refreshExpiresAt: string }> {
  const refreshToken = randomBytes(48).toString('hex');
  const tokenHash = hashToken(refreshToken);
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_DAYS * 24 * 60 * 60 * 1000);
  await query(
    `INSERT INTO refresh_tokens (token_hash, user_id, user_role, user_table, device_uuid, expires_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [tokenHash, user.id, role, table, deviceUuid || null, expiresAt]
  );
  return { refreshToken, refreshExpiresAt: expiresAt.toISOString() };
}

async function findActiveUser(role: Role, table: JwtPayload['table'], id: number): Promise<RowDataPacket | null> {
  const rows = await query<RowDataPacket[]>(
    `SELECT id, name, email, is_active, tenant_id FROM \`${table}\` WHERE id = ?`,
    [id]
  );
  if (rows.length === 0 || Number(rows[0].is_active) !== 1) return null;
  return rows[0];
}

export async function login(req: Request, res: Response): Promise<void> {
  const { email, password, device_uuid } = req.body;
  if (!email || !password) {
    res.status(400).json({ error: 'Email and password required' });
    return;
  }

  for (const c of USER_TABLES) {
  const rows = await query<RowDataPacket[]>(`SELECT * FROM \`${c.table}\` WHERE LOWER(email) = LOWER(?)`, [email]);
    if (rows.length > 0) {
      const user = rows[0];
      const valid = await bcrypt.compare(password, user.password_hash);
      if (!valid) {
        res.status(401).json({ error: 'Invalid credentials' });
        return;
      }
      if (Number(user.is_active) !== 1) {
        res.status(403).json({ error: 'Account is deactivated. Contact an administrator.' });
        return;
      }
      if (!user.tenant_id) { res.status(403).json({ error: 'This account is not assigned to a tenant. Contact support.' }); return; }
      const account = user as unknown as { id: number; name: string; email: string };
      const token = issueAccessToken(account, c.role, c.table, user.tenant_id);
      const refresh = await issueRefreshToken(account, c.role, c.table, device_uuid);
      res.json({
        token,
        refreshToken: refresh.refreshToken,
        refreshExpiresAt: refresh.refreshExpiresAt,
        user: { id: user.id, tenantId: user.tenant_id, name: user.name, email: user.email, role: c.role },
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
    const result = await withTransaction(async (conn) => {
      const [rows] = await conn.execute<RowDataPacket[]>(
        `SELECT * FROM refresh_tokens
         WHERE token_hash = ? AND revoked_at IS NULL AND expires_at > NOW(3)
         FOR UPDATE`,
        [hashToken(refreshToken)]
      );
      if (rows.length === 0) return null;
      const record = rows[0];
      const supportedTables: Record<string, Role> = {
        admins: 'ADMIN',
        qc_users: 'QC',
        dispatch_users: 'DISPATCH',
      };
      if (supportedTables[record.user_table] !== record.user_role) return null;

      const user = await findActiveUser(record.user_role as Role, record.user_table as JwtPayload['table'], record.user_id);
      if (!user || user.tenant_id == null) return null;

      await conn.execute(
        'UPDATE refresh_tokens SET revoked_at = NOW(3) WHERE id = ? AND revoked_at IS NULL',
        [record.id]
      );

      const next = randomBytes(48).toString('hex');
      const expiresAt = new Date(Date.now() + REFRESH_TOKEN_DAYS * 24 * 60 * 60 * 1000);
      await conn.execute(
        `INSERT INTO refresh_tokens (token_hash, user_id, user_role, user_table, device_uuid, expires_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [hashToken(next), record.user_id, record.user_role, record.user_table, device_uuid || record.device_uuid, expiresAt]
      );

      const account = user as unknown as { id: number; name: string; email: string };
      return {
        token: issueAccessToken(account, record.user_role as Role, record.user_table as JwtPayload['table'], user.tenant_id),
        refreshToken: next,
        refreshExpiresAt: expiresAt.toISOString(),
        user: { id: account.id, tenantId: user.tenant_id, name: account.name, email: account.email, role: record.user_role },
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
  const { refreshToken, allDevices } = req.body || {};
  if (refreshToken && typeof refreshToken === 'string') {
    await query(
      `UPDATE refresh_tokens SET revoked_at = NOW(3)
       WHERE token_hash = ? AND user_id = ? AND user_role = ? AND revoked_at IS NULL`,
      [hashToken(refreshToken), req.user.userId, req.user.role]
    );
  } else if (allDevices) {
    await query(
      `UPDATE refresh_tokens SET revoked_at = NOW(3)
       WHERE user_id = ? AND user_role = ? AND revoked_at IS NULL`,
      [req.user.userId, req.user.role]
    );
  }
  res.json({ message: 'Signed out' });
}

export async function me(_req: Request, res: Response): Promise<void> {
  if (!_req.user) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }
  const rows = await query<RowDataPacket[]>(
    `SELECT id, name, email, is_active, created_at, tenant_id FROM \`${_req.user.table}\` WHERE id = ? AND tenant_id = ?`,
    [_req.user.userId, _req.user.tenantId]
  );
  if (rows.length === 0) {
    res.status(404).json({ error: 'User not found' });
    return;
  }
  if (Number(rows[0].is_active) !== 1) {
    res.status(403).json({ error: 'Account is deactivated. Contact an administrator.' });
    return;
  }
  res.json({ ...rows[0], tenantId: rows[0].tenant_id, role: _req.user.role });
}
