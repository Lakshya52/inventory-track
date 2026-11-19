import { Request, Response } from 'express';
import { getContext } from '../config/database';
import { divisionFilter } from '../utils/division';

export async function list(req: Request, res: Response): Promise<void> {
  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 50;
  const offset = (page - 1) * limit;
  const ctx = await getContext();
  const tenantId = req.user!.tenantId;
  const logs = await ctx.find('activity_logs', { tenant_id: tenantId, ...divisionFilter(req) }, {
    sort: { created_at: -1 },
    skip: offset,
    limit,
    projection: { _id: 0 },
  });
  const total = await ctx.count('activity_logs', { tenant_id: tenantId, ...divisionFilter(req) });
  res.json({ logs, total, page, limit });
}
