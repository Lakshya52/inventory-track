import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { RowDataPacket } from 'mysql2';
import { query } from '../config/database';
import { JwtPayload, Role } from '../types';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';
const USER_TABLES = new Set(['admins', 'qc_users', 'dispatch_users', 'production_users']);

declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}

export async function authenticate(req: Request, res: Response, next: NextFunction): Promise<void> {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }
  try {
    const token = header.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET) as JwtPayload;
    if (!USER_TABLES.has(decoded.table)) {
      res.status(401).json({ error: 'Invalid or expired token' });
      return;
    }

    const rows = await query<RowDataPacket[]>(
      `SELECT id, is_active FROM ${decoded.table} WHERE id = ?`,
      [decoded.userId]
    );
    if (rows.length === 0) {
      res.status(401).json({ error: 'User account no longer exists' });
      return;
    }
    if (Number(rows[0].is_active) !== 1) {
      res.status(403).json({ error: 'Account is deactivated. Contact an administrator.' });
      return;
    }

    req.user = decoded;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

export function authorize(...roles: Role[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }
    if (!roles.includes(req.user.role)) {
      res.status(403).json({ error: 'Insufficient permissions' });
      return;
    }
    next();
  };
}
