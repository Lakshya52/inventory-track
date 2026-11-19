import { Request, Response } from 'express';
import { getContext, isDuplicateKey, isValidId } from '../config/database';
import { divisionFilter, divisionStamp } from '../utils/division';

export async function list(req: Request, res: Response): Promise<void> {
  const tenantId = req.user!.tenantId;
  const ctx = await getContext();
  const locations = await ctx.find('shelf_locations', { tenant_id: tenantId, ...divisionFilter(req) }, { sort: { location_code: 1 }, projection: { _id: 0 } });
  res.json(locations);
}

export async function create(req: Request, res: Response): Promise<void> {
  const tenantId = req.user!.tenantId;
  const { location_code, description, warehouse, rack, shelf } = req.body;
  if (!location_code) { res.status(400).json({ error: 'Location code is required' }); return; }
  const ctx = await getContext();
  try {
    const id = await ctx.insert('shelf_locations', {
      location_code,
      description: description || null,
      warehouse: warehouse || null,
      rack: rack || null,
      shelf: shelf || null,
      is_active: 1,
      tenant_id: tenantId,
      division_id: divisionStamp(req),
    });
    await ctx.insert('activity_logs', {
      user_name: req.user?.name || 'System',
      user_role: req.user?.role || 'ADMIN',
      action: 'LOCATION_CREATED',
      description: `Location "${location_code}" created`,
      tenant_id: tenantId,
      division_id: divisionStamp(req),
    });
    res.status(201).json({ id, location_code, description, warehouse, rack, shelf });
  } catch (err: any) {
    if (isDuplicateKey(err)) { res.status(400).json({ error: 'Location code already exists' }); return; }
    throw err;
  }
}

export async function update(req: Request, res: Response): Promise<void> {
  const tenantId = req.user!.tenantId;
  const id = req.params.id;
  if (!isValidId(id)) { res.status(400).json({ error: 'Invalid location id' }); return; }
  const { location_code, description, warehouse, rack, shelf, is_active } = req.body;
  const ctx = await getContext();
  const result = await ctx.updateOne('shelf_locations', { id, tenant_id: tenantId, ...divisionFilter(req) }, {
    $set: {
      location_code,
      description: description || null,
      warehouse: warehouse || null,
      rack: rack || null,
      shelf: shelf || null,
      is_active: is_active ?? 1,
    },
  });
  if (result.matchedCount === 0) { res.status(404).json({ error: 'Location not found' }); return; }
  res.json({ message: 'Location updated' });
}

export async function remove(req: Request, res: Response): Promise<void> {
  const tenantId = req.user!.tenantId;
  const id = req.params.id;
  if (!isValidId(id)) { res.status(400).json({ error: 'Invalid location id' }); return; }
  const ctx = await getContext();
  const result = await ctx.deleteOne('shelf_locations', { id, tenant_id: tenantId, ...divisionFilter(req) });
  if (result.deletedCount === 0) { res.status(404).json({ error: 'Location not found' }); return; }
  res.json({ message: 'Location deleted' });
}
