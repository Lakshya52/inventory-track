import { Request, Response } from 'express';
import { getContext } from '../config/database';

export async function list(req: Request, res: Response): Promise<void> {
  const ctx = await getContext();
  const filter = req.user?.role === 'ADMIN' ? {} : { is_active: 1 };
  const clients = await ctx.find('clients', filter, { sort: { name: 1 }, projection: { _id: 0 } });
  res.json(clients);
}

export async function create(req: Request, res: Response): Promise<void> {
  const { name, contact_person, email, phone, address, gst_number } = req.body;
  if (!name) { res.status(400).json({ error: 'Client name is required' }); return; }
  const ctx = await getContext();
  const id = await ctx.insert('clients', {
    name,
    contact_person: contact_person || null,
    email: email || null,
    phone: phone || null,
    address: address || null,
    gst_number: gst_number || null,
    is_active: 1,
  });
  await ctx.insert('activity_logs', {
    user_name: req.user?.name || 'System',
    user_role: req.user?.role || 'ADMIN',
    action: 'CLIENT_CREATED',
    description: `Client "${name}" created`,
  });
  res.status(201).json({ id, name, contact_person, email, phone, address, gst_number });
}

export async function update(req: Request, res: Response): Promise<void> {
  const id = Number(req.params.id);
  const { name, contact_person, email, phone, address, gst_number, is_active } = req.body;
  const ctx = await getContext();
  const existing = await ctx.findOne('clients', { id });
  if (!existing) {
    res.status(404).json({ error: 'Client not found' });
    return;
  }
  const nextName = typeof name === 'string' ? name.trim() : existing.name;
  if (!nextName) {
    res.status(400).json({ error: 'Client name is required' });
    return;
  }
  const active = is_active === undefined ? existing.is_active : Number(is_active) === 1 ? 1 : 0;
  await ctx.updateOne('clients', { id }, {
    $set: {
      name: nextName,
      contact_person: contact_person === undefined ? existing.contact_person : contact_person || null,
      email: email === undefined ? existing.email : email || null,
      phone: phone === undefined ? existing.phone : phone || null,
      address: address === undefined ? existing.address : address || null,
      gst_number: gst_number === undefined ? existing.gst_number : gst_number || null,
      is_active: active,
    },
  });
  await ctx.insert('activity_logs', {
    user_name: req.user?.name || 'System',
    user_role: req.user?.role || 'ADMIN',
    action: 'CLIENT_UPDATED',
    description: `Client "${nextName}" updated`,
  });
  res.json({ message: 'Client updated' });
}

export async function remove(req: Request, res: Response): Promise<void> {
  const id = Number(req.params.id);
  const ctx = await getContext();
  const client = await ctx.findOne('clients', { id }, { projection: { name: 1, is_active: 1 } });
  if (!client) {
    res.status(404).json({ error: 'Client not found' });
    return;
  }
  await ctx.updateOne('clients', { id }, { $set: { is_active: 0 } });
  await ctx.insert('activity_logs', {
    user_name: req.user?.name || 'System',
    user_role: req.user?.role || 'ADMIN',
    action: 'CLIENT_DEACTIVATED',
    description: `Client "${client.name}" deactivated`,
  });
  res.json({ message: 'Client deactivated' });
}
