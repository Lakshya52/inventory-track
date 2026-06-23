import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt, { SignOptions } from 'jsonwebtoken';
import { query } from '../config/database';
import { RowDataPacket } from 'mysql2';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';
const JWT_EXPIRES_IN: SignOptions['expiresIn'] = (process.env.JWT_EXPIRES_IN || '24h') as any;

export async function login(req: Request, res: Response): Promise<void> {
  const { email, password } = req.body;
  if (!email || !password) {
    res.status(400).json({ error: 'Email and password required' });
    return;
  }

  type UserTable = { id: number; name: string; email: string; password_hash: string; role: string; table: string };

  const checks: { table: string; role: string }[] = [
    { table: 'admins', role: 'ADMIN' },
    { table: 'qc_users', role: 'QC' },
    { table: 'dispatch_users', role: 'DISPATCH' },
  ];

  for (const c of checks) {
    const rows = await query<RowDataPacket[]>(`SELECT * FROM ${c.table} WHERE email = ?`, [email]);
    if (rows.length > 0) {
      const user = rows[0];
      const valid = await bcrypt.compare(password, user.password_hash);
      if (!valid) {
        res.status(401).json({ error: 'Invalid credentials' });
        return;
      }
      const token = jwt.sign(
        { userId: user.id, role: c.role, name: user.name, email: user.email, table: c.table },
        JWT_SECRET,
        { expiresIn: JWT_EXPIRES_IN }
      );
      res.json({ token, user: { id: user.id, name: user.name, email: user.email, role: c.role } });
      return;
    }
  }

  res.status(401).json({ error: 'Invalid credentials' });
}

export async function me(_req: Request, res: Response): Promise<void> {
  if (!_req.user) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }
  const rows = await query<RowDataPacket[]>(
    `SELECT id, name, email, created_at FROM ${_req.user.table} WHERE id = ?`,
    [_req.user.userId]
  );
  if (rows.length === 0) {
    res.status(404).json({ error: 'User not found' });
    return;
  }
  res.json({ ...rows[0], role: _req.user.role });
}
