import { Request, Response } from 'express';
import { query, execute } from '../config/database';
import { RowDataPacket } from 'mysql2';

export async function list(req: Request, res: Response): Promise<void> {
  const clients = await query<RowDataPacket[]>(
    `SELECT * FROM clients ${req.user?.role === 'ADMIN' ? '' : 'WHERE is_active = 1'} ORDER BY name`
  );
  res.json(clients);
}

export async function create(req: Request, res: Response): Promise<void> {
  const { name, contact_person, email, phone, address, gst_number } = req.body;
  if (!name) { res.status(400).json({ error: 'Client name is required' }); return; }
  const result = await execute(
    'INSERT INTO clients (name, contact_person, email, phone, address, gst_number) VALUES (?, ?, ?, ?, ?, ?)',
    [name, contact_person || null, email || null, phone || null, address || null, gst_number || null]
  );
  await execute('INSERT INTO activity_logs (user_name, user_role, action, description) VALUES (?, ?, ?, ?)',
    [req.user?.name || 'System', req.user?.role || 'ADMIN', 'CLIENT_CREATED', `Client "${name}" created`]);
  res.status(201).json({ id: result.insertId, name, contact_person, email, phone, address, gst_number });
}

export async function update(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  const { name, contact_person, email, phone, address, gst_number, is_active } = req.body;
  const existing = await query<RowDataPacket[]>('SELECT * FROM clients WHERE id = ?', [id]);
  if (existing.length === 0) {
    res.status(404).json({ error: 'Client not found' });
    return;
  }
  const nextName = typeof name === 'string' ? name.trim() : existing[0].name;
  if (!nextName) {
    res.status(400).json({ error: 'Client name is required' });
    return;
  }
  const active = is_active === undefined ? existing[0].is_active : Number(is_active) === 1 ? 1 : 0;
  await execute(
    'UPDATE clients SET name = ?, contact_person = ?, email = ?, phone = ?, address = ?, gst_number = ?, is_active = ? WHERE id = ?',
    [
      nextName,
      contact_person === undefined ? existing[0].contact_person : contact_person || null,
      email === undefined ? existing[0].email : email || null,
      phone === undefined ? existing[0].phone : phone || null,
      address === undefined ? existing[0].address : address || null,
      gst_number === undefined ? existing[0].gst_number : gst_number || null,
      active,
      id,
    ]
  );
  await execute('INSERT INTO activity_logs (user_name, user_role, action, description) VALUES (?, ?, ?, ?)',
    [req.user?.name || 'System', req.user?.role || 'ADMIN', 'CLIENT_UPDATED', `Client "${nextName}" updated`]);
  res.json({ message: 'Client updated' });
}

export async function remove(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  const clients = await query<RowDataPacket[]>('SELECT name, is_active FROM clients WHERE id = ?', [id]);
  if (clients.length === 0) {
    res.status(404).json({ error: 'Client not found' });
    return;
  }
  await execute('UPDATE clients SET is_active = 0 WHERE id = ?', [id]);
  await execute('INSERT INTO activity_logs (user_name, user_role, action, description) VALUES (?, ?, ?, ?)',
    [req.user?.name || 'System', req.user?.role || 'ADMIN', 'CLIENT_DEACTIVATED', `Client "${clients[0].name}" deactivated`]);
  res.json({ message: 'Client deactivated' });
}
