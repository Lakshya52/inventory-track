import { Request, Response, NextFunction } from 'express';
import { getContext } from '../config/database';
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

    const ctx = await getContext();
    const user = await ctx.findOne(decoded.table, { id: decoded.userId }, {
      projection: { _id: 0, id: 1, is_active: 1, tenant_id: 1 },
    });
    if (!user) {
      res.status(401).json({ error: 'User account no longer exists' });
      return;
    }
    if (Number(user.is_active) !== 1) {
      res.status(403).json({ error: 'Account is deactivated. Contact an administrator.' });
      return;
    }
    if (String(user.tenant_id) !== String(decoded.tenantId)) {
      res.status(401).json({ error: 'Invalid or expired token' });
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
