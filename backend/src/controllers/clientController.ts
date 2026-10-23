import { Request, Response } from 'express';
import { query, execute } from '../config/database';
import { RowDataPacket } from 'mysql2';

export async function list(_req: Request, res: Response): Promise<void> {
  const clients = await query<RowDataPacket[]>('SELECT * FROM clients ORDER BY name');
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
  await execute(
    'UPDATE clients SET name = ?, contact_person = ?, email = ?, phone = ?, address = ?, gst_number = ?, is_active = ? WHERE id = ?',
    [name, contact_person || null, email || null, phone || null, address || null, gst_number || null, is_active ?? 1, id]
  );
  res.json({ message: 'Client updated' });
}

export async function remove(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  await execute('DELETE FROM clients WHERE id = ?', [id]);
  res.json({ message: 'Client deleted' });
}
