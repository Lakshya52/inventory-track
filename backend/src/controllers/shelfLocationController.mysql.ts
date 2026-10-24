import { Request, Response } from 'express';
import { query, execute } from '../config/database';
import { RowDataPacket } from 'mysql2';

export async function list(_req: Request, res: Response): Promise<void> {
  const locations = await query<RowDataPacket[]>('SELECT * FROM shelf_locations ORDER BY location_code');
  res.json(locations);
}

export async function create(req: Request, res: Response): Promise<void> {
  const { location_code, description, warehouse, rack, shelf } = req.body;
  if (!location_code) { res.status(400).json({ error: 'Location code is required' }); return; }
  try {
    const result = await execute(
      'INSERT INTO shelf_locations (location_code, description, warehouse, rack, shelf) VALUES (?, ?, ?, ?, ?)',
      [location_code, description || null, warehouse || null, rack || null, shelf || null]
    );
    await execute('INSERT INTO activity_logs (user_name, user_role, action, description) VALUES (?, ?, ?, ?)',
      [req.user?.name || 'System', req.user?.role || 'ADMIN', 'LOCATION_CREATED', `Location "${location_code}" created`]);
    res.status(201).json({ id: result.insertId, location_code, description, warehouse, rack, shelf });
  } catch (err: any) {
    if (err.code === 'ER_DUP_ENTRY') { res.status(400).json({ error: 'Location code already exists' }); return; }
    throw err;
  }
}

export async function update(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  const { location_code, description, warehouse, rack, shelf, is_active } = req.body;
  await execute(
    'UPDATE shelf_locations SET location_code = ?, description = ?, warehouse = ?, rack = ?, shelf = ?, is_active = ? WHERE id = ?',
    [location_code, description || null, warehouse || null, rack || null, shelf || null, is_active ?? 1, id]
  );
  res.json({ message: 'Location updated' });
}

export async function remove(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  await execute('DELETE FROM shelf_locations WHERE id = ?', [id]);
  res.json({ message: 'Location deleted' });
}
