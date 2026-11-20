import { Request, Response } from 'express';
import { query, execute } from '../config/database';
import { RowDataPacket } from 'mysql2';

async function logActivity(req: Request, action: string, description: string): Promise<void> {
  const tenantId = req.user!.tenantId;
  await execute(
    'INSERT INTO activity_logs (user_name, user_role, action, description, tenant_id) VALUES (?, ?, ?, ?, ?)',
    [req.user?.name || 'System', req.user?.role || 'ADMIN', action, description, tenantId]
  );
}

export async function list(req: Request, res: Response): Promise<void> {
  const tenantId = req.user!.tenantId;
  const search = (req.query.q as string || '').trim();
  const status = req.query.status as string | undefined;

  const where: string[] = ['tenant_id = ?'];
  const params: any[] = [tenantId];

  if (search) {
    where.push('(name LIKE ? OR vendor_code LIKE ? OR contact_person LIKE ? OR email LIKE ? OR phone LIKE ?)');
    const like = `${search}%`;
    params.push(like, like, like, like, like);
  }
  if (status === 'active') where.push('is_active = 1');
  if (status === 'inactive') where.push('is_active = 0');

  const vendors = await query<RowDataPacket[]>(
    `SELECT * FROM vendors WHERE ${where.join(' AND ')} ORDER BY name ASC`,
    params
  );
  res.json(vendors);
}

export async function getById(req: Request, res: Response): Promise<void> {
  const tenantId = req.user!.tenantId;
  const vendors = await query<RowDataPacket[]>('SELECT * FROM vendors WHERE id = ? AND tenant_id = ?', [req.params.id, tenantId]);
  if (vendors.length === 0) { res.status(404).json({ error: 'Vendor not found' }); return; }
  res.json(vendors[0]);
}

export async function create(req: Request, res: Response): Promise<void> {
  const tenantId = req.user!.tenantId;
  const {
    name, contact_person, email, phone, address, gst_number,
    category, payment_terms, notes, is_active,
  } = req.body;

  if (!name || !String(name).trim()) {
    res.status(400).json({ error: 'Vendor name is required' });
    return;
  }
  const trimmedName = String(name).trim();
  const duplicates = await query<RowDataPacket[]>('SELECT id FROM vendors WHERE tenant_id = ? AND LOWER(TRIM(name)) = LOWER(TRIM(?)) LIMIT 1', [tenantId, trimmedName]);
  if (duplicates.length > 0) { res.status(409).json({ error: 'A vendor with that name already exists' }); return; }

  const tempCode = `_TMP_${Date.now()}`;
  try {
    const result = await execute(
      `INSERT INTO vendors
        (vendor_code, name, contact_person, email, phone, address, gst_number, category, payment_terms, notes, is_active, tenant_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        tempCode,
        String(name).trim(),
        contact_person || null,
        email || null,
        phone || null,
        address || null,
        gst_number || null,
        category || null,
        payment_terms || null,
        notes || null,
        is_active === false || is_active === 0 ? 0 : 1,
        tenantId,
      ]
    );

    const vendorCode = `VND-${String(result.insertId).padStart(4, '0')}`;
    await execute('UPDATE vendors SET vendor_code = ? WHERE id = ? AND tenant_id = ?', [vendorCode, result.insertId, tenantId]);
    await logActivity(req, 'VENDOR_CREATED', `Vendor "${name}" (${vendorCode}) created`);

    res.status(201).json({ id: result.insertId, vendor_code: vendorCode, name, is_active: 1 });
  } catch (err: any) {
    if (err.code === 'ER_DUP_ENTRY') {
      res.status(400).json({ error: 'A vendor with that code already exists' });
      return;
    }
    throw err;
  }
}

export async function update(req: Request, res: Response): Promise<void> {
  const tenantId = req.user!.tenantId;
  const { id } = req.params;
  const {
    name, contact_person, email, phone, address, gst_number,
    category, payment_terms, notes, is_active,
  } = req.body;

  if (!name || !String(name).trim()) {
    res.status(400).json({ error: 'Vendor name is required' });
    return;
  }

  const existing = await query<RowDataPacket[]>('SELECT vendor_code FROM vendors WHERE id = ? AND tenant_id = ?', [id, tenantId]);
  if (existing.length === 0) { res.status(404).json({ error: 'Vendor not found' }); return; }
  if (existing[0].vendor_code === 'SELF') {
    res.status(400).json({ error: 'The built-in Self supplier cannot be edited' });
    return;
  }
  const duplicates = await query<RowDataPacket[]>('SELECT id FROM vendors WHERE tenant_id = ? AND id <> ? AND LOWER(TRIM(name)) = LOWER(TRIM(?)) LIMIT 1', [tenantId, id, String(name).trim()]);
  if (duplicates.length > 0) { res.status(409).json({ error: 'A vendor with that name already exists' }); return; }

  const result = await execute(
    `UPDATE vendors SET
       name = ?, contact_person = ?, email = ?, phone = ?, address = ?, gst_number = ?,
       category = ?, payment_terms = ?, notes = ?, is_active = ?
     WHERE id = ? AND tenant_id = ?`,
    [
      String(name).trim(),
      contact_person || null,
      email || null,
      phone || null,
      address || null,
      gst_number || null,
      category || null,
      payment_terms || null,
      notes || null,
      is_active === false || is_active === 0 ? 0 : 1,
      id,
      tenantId,
    ]
  );

  if (result.affectedRows === 0) { res.status(404).json({ error: 'Vendor not found' }); return; }
  await logActivity(req, 'VENDOR_UPDATED', `Vendor "${name}" updated`);
  res.json({ message: 'Vendor updated' });
}

export async function setStatus(req: Request, res: Response): Promise<void> {
  const tenantId = req.user!.tenantId;
  const { id } = req.params;
  const active = req.body.is_active === true || req.body.is_active === 1 || req.body.is_active === '1';
  const existing = await query<RowDataPacket[]>('SELECT vendor_code FROM vendors WHERE id = ? AND tenant_id = ?', [id, tenantId]);
  if (existing.length === 0) { res.status(404).json({ error: 'Vendor not found' }); return; }
  if (existing[0].vendor_code === 'SELF' && !active) {
    res.status(400).json({ error: 'The built-in Self supplier cannot be deactivated' });
    return;
  }
  const result = await execute('UPDATE vendors SET is_active = ? WHERE id = ? AND tenant_id = ?', [active ? 1 : 0, id, tenantId]);
  if (result.affectedRows === 0) { res.status(404).json({ error: 'Vendor not found' }); return; }

  await logActivity(req, active ? 'VENDOR_ACTIVATED' : 'VENDOR_DEACTIVATED', `Vendor #${id} ${active ? 'activated' : 'deactivated'}`);
  res.json({ message: active ? 'Vendor activated' : 'Vendor deactivated', is_active: active ? 1 : 0 });
}

export async function remove(req: Request, res: Response): Promise<void> {
  const tenantId = req.user!.tenantId;
  const { id } = req.params;
  const vendors = await query<RowDataPacket[]>('SELECT name, vendor_code FROM vendors WHERE id = ? AND tenant_id = ?', [id, tenantId]);
  if (vendors.length === 0) { res.status(404).json({ error: 'Vendor not found' }); return; }
  if (vendors[0].vendor_code === 'SELF') {
    res.status(400).json({ error: 'The built-in Self supplier cannot be deleted' });
    return;
  }

  await execute('DELETE FROM vendors WHERE id = ? AND tenant_id = ?', [id, tenantId]);
  await logActivity(req, 'VENDOR_DELETED', `Vendor "${vendors[0].name}" deleted`);
  res.json({ message: 'Vendor deleted' });
}
