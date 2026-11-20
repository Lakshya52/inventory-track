import { Request, Response } from 'express';
import { getContext, isValidId } from '../config/database';

export async function list(req: Request, res: Response): Promise<void> {
  const tenantId = req.user!.tenantId;
  const ctx = await getContext();
  const filter: Record<string, any> = { tenant_id: tenantId };
  if (req.user?.role !== 'ADMIN') filter.is_active = 1;
  const clients = await ctx.find('clients', filter, { sort: { name: 1 }, projection: { _id: 0 } });
  res.json(clients);
}

export async function create(req: Request, res: Response): Promise<void> {
  const tenantId = req.user!.tenantId;
  const { name, contact_person, email, phone, address, gst_number } = req.body;
  if (!name || !String(name).trim()) { res.status(400).json({ error: 'Client name is required' }); return; }
  const ctx = await getContext();
  const safe = String(name).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const duplicate = await ctx.findOne('clients', { tenant_id: tenantId, name: { $regex: `^${safe}$`, $options: 'i' } }, { projection: { id: 1 } });
  if (duplicate) { res.status(409).json({ error: 'A client with that name already exists' }); return; }
  const id = await ctx.insert('clients', {
    tenant_id: tenantId,
    name,
    contact_person: contact_person || null,
    email: email || null,
    phone: phone || null,
    address: address || null,
    gst_number: gst_number || null,
    is_active: 1,
  });
  await ctx.insert('activity_logs', {
    tenant_id: tenantId,
    user_name: req.user?.name || 'System',
    user_role: req.user?.role || 'ADMIN',
    action: 'CLIENT_CREATED',
    description: `Client "${name}" created`,
  });
  res.status(201).json({ id, name, contact_person, email, phone, address, gst_number });
}

export async function update(req: Request, res: Response): Promise<void> {
  const tenantId = req.user!.tenantId;
  const id = req.params.id;
  if (!isValidId(id)) { res.status(400).json({ error: 'Invalid client id' }); return; }
  const { name, contact_person, email, phone, address, gst_number, is_active } = req.body;
  const ctx = await getContext();
  const existing = await ctx.findOne('clients', { id, tenant_id: tenantId });
  if (!existing) {
    res.status(404).json({ error: 'Client not found' });
    return;
  }
  const nextName = typeof name === 'string' ? name.trim() : existing.name;
  if (!nextName) {
    res.status(400).json({ error: 'Client name is required' });
    return;
  }
  const safeName = nextName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const duplicate = await ctx.findOne('clients', { tenant_id: tenantId, id: { $ne: id }, name: { $regex: `^${safeName}$`, $options: 'i' } }, { projection: { id: 1 } });
  if (duplicate) { res.status(409).json({ error: 'A client with that name already exists' }); return; }
  const active = is_active === undefined ? existing.is_active : Number(is_active) === 1 ? 1 : 0;
  await ctx.updateOne('clients', { id, tenant_id: tenantId }, {
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
    tenant_id: tenantId,
    user_name: req.user?.name || 'System',
    user_role: req.user?.role || 'ADMIN',
    action: 'CLIENT_UPDATED',
    description: `Client "${nextName}" updated`,
  });
  res.json({ message: 'Client updated' });
}

export async function remove(req: Request, res: Response): Promise<void> {
  const tenantId = req.user!.tenantId;
  const id = req.params.id;
  if (!isValidId(id)) { res.status(400).json({ error: 'Invalid client id' }); return; }
  const ctx = await getContext();
  const client = await ctx.findOne('clients', { id, tenant_id: tenantId }, { projection: { name: 1, is_active: 1 } });
  if (!client) {
    res.status(404).json({ error: 'Client not found' });
    return;
  }
  await ctx.updateOne('clients', { id, tenant_id: tenantId }, { $set: { is_active: 0 } });
  await ctx.insert('activity_logs', {
    tenant_id: tenantId,
    user_name: req.user?.name || 'System',
    user_role: req.user?.role || 'ADMIN',
    action: 'CLIENT_DEACTIVATED',
    description: `Client "${client.name}" deactivated`,
  });
  res.json({ message: 'Client deactivated' });
}
