import { Request, Response } from 'express';
import { getContext, isDuplicateKey, isValidId } from '../config/database';

export async function list(_req: Request, res: Response): Promise<void> {
  const ctx = await getContext();
  const locations = await ctx.find('shelf_locations', {}, { sort: { location_code: 1 }, projection: { _id: 0 } });
  res.json(locations);
}

export async function create(req: Request, res: Response): Promise<void> {
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
    });
    await ctx.insert('activity_logs', {
      user_name: req.user?.name || 'System',
      user_role: req.user?.role || 'ADMIN',
      action: 'LOCATION_CREATED',
      description: `Location "${location_code}" created`,
    });
    res.status(201).json({ id, location_code, description, warehouse, rack, shelf });
  } catch (err: any) {
    if (isDuplicateKey(err)) { res.status(400).json({ error: 'Location code already exists' }); return; }
    throw err;
  }
}

export async function update(req: Request, res: Response): Promise<void> {
  const id = req.params.id;
  if (!isValidId(id)) { res.status(400).json({ error: 'Invalid location id' }); return; }
  const { location_code, description, warehouse, rack, shelf, is_active } = req.body;
  const ctx = await getContext();
  await ctx.updateOne('shelf_locations', { id }, {
    $set: {
      location_code,
      description: description || null,
      warehouse: warehouse || null,
      rack: rack || null,
      shelf: shelf || null,
      is_active: is_active ?? 1,
    },
  });
  res.json({ message: 'Location updated' });
}

export async function remove(req: Request, res: Response): Promise<void> {
  const id = req.params.id;
  if (!isValidId(id)) { res.status(400).json({ error: 'Invalid location id' }); return; }
  const ctx = await getContext();
  await ctx.deleteOne('shelf_locations', { id });
  res.json({ message: 'Location deleted' });
}
