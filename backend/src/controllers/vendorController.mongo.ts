import { Request, Response } from 'express';
import { randomBytes } from 'crypto';
import { getContext, isDuplicateKey, isValidId } from '../config/database';
import { contains } from '../services/queryService';

async function logActivity(req: Request, action: string, description: string): Promise<void> {
  const ctx = await getContext();
  await ctx.insert('activity_logs', {
    user_name: req.user?.name || 'System',
    user_role: req.user?.role || 'ADMIN',
    action,
    description,
  });
}

export async function list(req: Request, res: Response): Promise<void> {
  const search = (req.query.q as string || '').trim();
  const status = req.query.status as string | undefined;

  const filter: Record<string, any> = {};
  if (search) {
    const pattern = contains(search);
    filter.$or = [
      { name: pattern },
      { vendor_code: pattern },
      { contact_person: pattern },
      { email: pattern },
      { phone: pattern },
    ];
  }
  if (status === 'active') filter.is_active = 1;
  if (status === 'inactive') filter.is_active = 0;

  const ctx = await getContext();
  const vendors = await ctx.find('vendors', filter, { sort: { name: 1 }, projection: { _id: 0 } });
  res.json(vendors);
}

export async function getById(req: Request, res: Response): Promise<void> {
  if (!isValidId(req.params.id)) { res.status(400).json({ error: 'Invalid vendor id' }); return; }
  const ctx = await getContext();
  const vendor = await ctx.findOne('vendors', { id: req.params.id }, { projection: { _id: 0 } });
  if (!vendor) { res.status(404).json({ error: 'Vendor not found' }); return; }
  res.json(vendor);
}

export async function create(req: Request, res: Response): Promise<void> {
  const {
    name, contact_person, email, phone, address, gst_number,
    category, payment_terms, notes, is_active,
  } = req.body;

  if (!name || !String(name).trim()) {
    res.status(400).json({ error: 'Vendor name is required' });
    return;
  }

  const ctx = await getContext();
  const tempCode = `_TMP_${Date.now()}`;
  try {
    const id = await ctx.insert('vendors', {
      vendor_code: tempCode,
      name: String(name).trim(),
      contact_person: contact_person || null,
      email: email || null,
      phone: phone || null,
      address: address || null,
      gst_number: gst_number || null,
      category: category || null,
      payment_terms: payment_terms || null,
      notes: notes || null,
      is_active: is_active === false || is_active === 0 ? 0 : 1,
    });

    const vendorCode = `VND-${randomBytes(3).toString('hex').toUpperCase()}`;
    await ctx.updateOne('vendors', { id }, { $set: { vendor_code: vendorCode } });
    await logActivity(req, 'VENDOR_CREATED', `Vendor "${name}" (${vendorCode}) created`);

    res.status(201).json({ id, vendor_code: vendorCode, name, is_active: 1 });
  } catch (err: any) {
    if (isDuplicateKey(err)) {
      res.status(400).json({ error: 'A vendor with that code already exists' });
      return;
    }
    throw err;
  }
}

export async function update(req: Request, res: Response): Promise<void> {
  const id = req.params.id;
  if (!isValidId(id)) { res.status(400).json({ error: 'Invalid vendor id' }); return; }
  const {
    name, contact_person, email, phone, address, gst_number,
    category, payment_terms, notes, is_active,
  } = req.body;

  if (!name || !String(name).trim()) {
    res.status(400).json({ error: 'Vendor name is required' });
    return;
  }

  const ctx = await getContext();
  const existing = await ctx.findOne('vendors', { id }, { projection: { _id: 0, vendor_code: 1 } });
  if (!existing) { res.status(404).json({ error: 'Vendor not found' }); return; }
  if (existing.vendor_code === 'SELF') {
    res.status(400).json({ error: 'The built-in Self supplier cannot be edited' });
    return;
  }
  const result = await ctx.updateOne('vendors', { id }, {
    $set: {
      name: String(name).trim(),
      contact_person: contact_person || null,
      email: email || null,
      phone: phone || null,
      address: address || null,
      gst_number: gst_number || null,
      category: category || null,
      payment_terms: payment_terms || null,
      notes: notes || null,
      is_active: is_active === false || is_active === 0 ? 0 : 1,
    },
  });

  if (result.matchedCount === 0) { res.status(404).json({ error: 'Vendor not found' }); return; }
  await logActivity(req, 'VENDOR_UPDATED', `Vendor "${name}" updated`);
  res.json({ message: 'Vendor updated' });
}

export async function setStatus(req: Request, res: Response): Promise<void> {
  const id = req.params.id;
  if (!isValidId(id)) { res.status(400).json({ error: 'Invalid vendor id' }); return; }
  const active = req.body.is_active === true || req.body.is_active === 1 || req.body.is_active === '1';
  const ctx = await getContext();
  const existing = await ctx.findOne('vendors', { id }, { projection: { _id: 0, vendor_code: 1 } });
  if (!existing) { res.status(404).json({ error: 'Vendor not found' }); return; }
  if (existing.vendor_code === 'SELF' && !active) {
    res.status(400).json({ error: 'The built-in Self supplier cannot be deactivated' });
    return;
  }
  const result = await ctx.updateOne('vendors', { id }, { $set: { is_active: active ? 1 : 0 } });
  if (result.matchedCount === 0) { res.status(404).json({ error: 'Vendor not found' }); return; }

  await logActivity(req, active ? 'VENDOR_ACTIVATED' : 'VENDOR_DEACTIVATED', `Vendor #${id} ${active ? 'activated' : 'deactivated'}`);
  res.json({ message: active ? 'Vendor activated' : 'Vendor deactivated', is_active: active ? 1 : 0 });
}

export async function remove(req: Request, res: Response): Promise<void> {
  const id = req.params.id;
  if (!isValidId(id)) { res.status(400).json({ error: 'Invalid vendor id' }); return; }
  const ctx = await getContext();
  const vendor = await ctx.findOne('vendors', { id }, { projection: { name: 1, vendor_code: 1 } });
  if (!vendor) { res.status(404).json({ error: 'Vendor not found' }); return; }
  if (vendor.vendor_code === 'SELF') {
    res.status(400).json({ error: 'The built-in Self supplier cannot be deleted' });
    return;
  }

  await ctx.deleteOne('vendors', { id });
  await logActivity(req, 'VENDOR_DELETED', `Vendor "${vendor.name}" deleted`);
  res.json({ message: 'Vendor deleted' });
}
