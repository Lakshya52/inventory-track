import { Request, Response } from 'express';
import { query, execute } from '../config/database';
import { RowDataPacket } from 'mysql2';
import { divisionWhere, divisionStamp } from '../utils/division';

export async function list(req: Request, res: Response): Promise<void> {
  const tenantId = req.user!.tenantId;
  const dv = divisionWhere(req);
  const locations = await query<RowDataPacket[]>(`SELECT * FROM shelf_locations WHERE tenant_id = ?${dv.sql} ORDER BY location_code`, [tenantId, ...dv.params]);
  res.json(locations);
}

export async function create(req: Request, res: Response): Promise<void> {
  const tenantId = req.user!.tenantId;
  const { location_code, description, warehouse, rack, shelf } = req.body;
  if (!location_code) { res.status(400).json({ error: 'Location code is required' }); return; }
  try {
    const result = await execute(
      'INSERT INTO shelf_locations (location_code, description, warehouse, rack, shelf, tenant_id, division_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [location_code, description || null, warehouse || null, rack || null, shelf || null, tenantId, divisionStamp(req)]
    );
    await execute('INSERT INTO activity_logs (user_name, user_role, action, description, tenant_id, division_id) VALUES (?, ?, ?, ?, ?, ?)',
      [req.user?.name || 'System', req.user?.role || 'ADMIN', 'LOCATION_CREATED', `Location "${location_code}" created`, tenantId, divisionStamp(req)]);
    res.status(201).json({ id: result.insertId, location_code, description, warehouse, rack, shelf });
  } catch (err: any) {
    if (err.code === 'ER_DUP_ENTRY') { res.status(400).json({ error: 'Location code already exists' }); return; }
    throw err;
  }
}

export async function update(req: Request, res: Response): Promise<void> {
  const tenantId = req.user!.tenantId;
  const dv = divisionWhere(req);
  const { id } = req.params;
  const { location_code, description, warehouse, rack, shelf, is_active } = req.body;
  const result = await execute(
    `UPDATE shelf_locations SET location_code = ?, description = ?, warehouse = ?, rack = ?, shelf = ?, is_active = ? WHERE id = ? AND tenant_id = ?${dv.sql}`,
    [location_code, description || null, warehouse || null, rack || null, shelf || null, is_active ?? 1, id, tenantId, ...dv.params]
  );
  if (result.affectedRows === 0) { res.status(404).json({ error: 'Location not found' }); return; }
  res.json({ message: 'Location updated' });
}

export async function remove(req: Request, res: Response): Promise<void> {
  const tenantId = req.user!.tenantId;
  const dv = divisionWhere(req);
  const { id } = req.params;
  const result = await execute(`DELETE FROM shelf_locations WHERE id = ? AND tenant_id = ?${dv.sql}`, [id, tenantId, ...dv.params]);
  if (result.affectedRows === 0) { res.status(404).json({ error: 'Location not found' }); return; }
  res.json({ message: 'Location deleted' });
}
