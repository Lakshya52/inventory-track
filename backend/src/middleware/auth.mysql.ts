import { Request, Response, NextFunction } from 'express';
import { RowDataPacket } from 'mysql2';
import { query } from '../config/database';
import { JwtPayload, Role } from '../types';
import { readAccessToken } from '../services/tokens';

const USER_TABLES = new Set(['admins', 'qc_users', 'dispatch_users']);

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
    const decoded = readAccessToken(token);
    if (!USER_TABLES.has(decoded.table)) {
      res.status(401).json({ error: 'Invalid or expired token' });
      return;
    }

    const rows = await query<RowDataPacket[]>(
      `SELECT id, is_active, tenant_id, division_id FROM ${decoded.table} WHERE id = ?`,
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
    if (String(rows[0].tenant_id) !== String(decoded.tenantId)) {
      res.status(401).json({ error: 'Invalid or expired token' });
      return;
    }
    // Division-locked non-admin users cannot operate in a deactivated division.
    if (decoded.role !== 'ADMIN' && rows[0].division_id) {
      const divisions = await query<RowDataPacket[]>(
        'SELECT is_active FROM divisions WHERE id = ? AND tenant_id = ? LIMIT 1',
        [rows[0].division_id, decoded.tenantId]
      );
      if (divisions.length === 0 || Number(divisions[0].is_active) !== 1) {
        res.status(403).json({ error: 'Your division is deactivated — contact your administrator.' });
        return;
      }
    }

    // Division selection for the single ADMIN — any other role keeps its own
    // assigned division (or none). Admins can narrow the whole request to one
    // division with the `X-Division-Id` header ('all' or absent = tenant-wide).
    let divisionId = rows[0].division_id ?? null;
    const selection = String(req.headers['x-division-id'] ?? '').trim();
    if (decoded.role === 'ADMIN') {
      if (!selection || selection === 'all') {
        divisionId = null;
      } else {
        const [selected] = await query<RowDataPacket[]>(
          'SELECT id FROM divisions WHERE id = ? AND tenant_id = ? LIMIT 1',
          [selection, decoded.tenantId]
        );
        if (!selected) {
          res.status(403).json({ error: 'Division not found in this organization' });
          return;
        }
        divisionId = selected.id;
      }
    }

    req.user = { ...decoded, divisionId };
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
