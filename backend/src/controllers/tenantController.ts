import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import { execute, getContext, isDuplicateKey, query, useMongo } from '../config/database';
import { issueAccessToken } from '../services/tokens';

function tenantError(status: number, message: string): Error & { status: number } {
  return Object.assign(new Error(message), { status });
}

async function tenantForUser(tenantId: string | number): Promise<Record<string, any> | null> {
  if (useMongo) return (await getContext()).findOne('tenants', { id: tenantId });
  const rows = await query<any[]>('SELECT id, name, email, phone, logo_url, logo_data, logo_mime_type, slug, updated_at FROM tenants WHERE id = ?', [tenantId]);
  return rows[0] || null;
}

export async function getCurrentTenant(req: Request, res: Response): Promise<void> {
  if (!req.user) { res.status(401).json({ error: 'Authentication required' }); return; }
  const tenant = await tenantForUser(req.user.tenantId);
  if (!tenant) { res.status(404).json({ error: 'Organization not found' }); return; }
  res.json({ id: tenant.id, name: tenant.name, email: tenant.email, phone: tenant.phone, logoUrl: tenant.logo_url || null, slug: tenant.slug, updatedAt: tenant.updated_at || null });
}

export async function getCurrentTenantLogo(req: Request, res: Response): Promise<void> {
  const tenantId = clean(req.params.tenantId, 100);
  if (!tenantId) { res.status(400).json({ error: 'Invalid organization identifier' }); return; }
  const tenant = await tenantForUser(tenantId);
  if (!tenant?.logo_data || !tenant?.logo_mime_type) { res.status(404).json({ error: 'Organization logo not found' }); return; }
  res.setHeader('Content-Type', tenant.logo_mime_type);
  res.setHeader('Content-Length', Buffer.byteLength(tenant.logo_data, 'base64'));
  res.setHeader('Cache-Control', 'private, max-age=300');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.send(Buffer.from(tenant.logo_data, 'base64'));
}

export async function updateCurrentTenant(req: Request, res: Response): Promise<void> {
  if (!req.user) { res.status(401).json({ error: 'Authentication required' }); return; }
  const name = clean(req.body.name, 200);
  const email = clean(req.body.email, 254).toLowerCase();
  const phone = clean(req.body.phone, 32);
  const logoUrl = req.body.logoUrl === null ? null : clean(req.body.logoUrl, 500);
  if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !/^\+?[0-9 ()-]{7,32}$/.test(phone) || (logoUrl && logoUrl !== `/api/tenants/${req.user.tenantId}/logo`)) {
    res.status(400).json({ error: 'Enter valid organization name, email, phone, and logo details.' });
    return;
  }
  try {
    if (useMongo) {
      const ctx = await getContext();
      const existing = await ctx.findOne('tenants', { email_key: email, id: { $ne: req.user.tenantId } }, { projection: { _id: 0, id: 1 } });
      if (existing) throw tenantError(409, 'That organization email is already in use.');
      const fields: Record<string, unknown> = { name, email, email_key: email, phone };
      if (logoUrl !== null) fields.logo_url = logoUrl;
      else { fields.logo_url = null; fields.logo_data = null; fields.logo_mime_type = null; }
      const result = await ctx.updateOne('tenants', { id: req.user.tenantId }, { $set: fields });
      if (!result.matchedCount) throw tenantError(404, 'Organization not found.');
    } else {
      const duplicates = await query<any[]>('SELECT id FROM tenants WHERE email_key = ? AND id <> ? LIMIT 1', [email, req.user.tenantId]);
      if (duplicates.length) throw tenantError(409, 'That organization email is already in use.');
      const result = logoUrl === null
        ? await execute('UPDATE tenants SET name = ?, email = ?, email_key = ?, phone = ?, logo_url = NULL, logo_data = NULL, logo_mime_type = NULL WHERE id = ?', [name, email, email, phone, req.user.tenantId])
        : await execute('UPDATE tenants SET name = ?, email = ?, email_key = ?, phone = ? WHERE id = ?', [name, email, email, phone, req.user.tenantId]);
      if (!result.affectedRows) throw tenantError(404, 'Organization not found.');
    }
    const tenant = await tenantForUser(req.user.tenantId);
    res.json({ id: tenant?.id, name: tenant?.name, email: tenant?.email, phone: tenant?.phone, logoUrl: tenant?.logo_url || null, slug: tenant?.slug, updatedAt: tenant?.updated_at || null });
  } catch (error: any) {
    if (error?.status) { res.status(error.status).json({ error: error.message }); return; }
    if (isDuplicateKey(error) || error?.code === 'ER_DUP_ENTRY') { res.status(409).json({ error: 'That organization email is already in use.' }); return; }
    throw error;
  }
}

function clean(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function tenantSlug(name: string): string {
  return `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 70) || 'tenant'}-${randomBytes(4).toString('hex')}`;
}

export async function registerTenant(req: Request, res: Response): Promise<void> {
  const adminName = clean(req.body.name, 200);
  const name = clean(req.body.companyName, 200);
  const email = clean(req.body.email, 254).toLowerCase();
  const phone = clean(req.body.mobile ?? req.body.phone, 32);
  const password = req.body.password;
  // Tenant logos are uploaded after the tenant and admin have been created,
  // then stored on the tenant record by /api/tenant-logo.
  const logoUrl = null;
  if (!adminName || !name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !/^\+?[0-9 ()-]{7,32}$/.test(phone) || typeof password !== 'string' || password.length < 12) {
    res.status(400).json({ error: 'Enter your name, organization name, valid email, mobile number, and a password of at least 12 characters.' });
    return;
  }
  const passwordHash = await bcrypt.hash(password, 12);
  const slug = tenantSlug(name);
  try {
    let tenantId: string | number;
    let userId: string | number;
    if (useMongo) {
      const { withTransaction } = await import('../config/database');
      const { tenant: insertedTenant, user: insertedUser } = await withTransaction(async mongoCtx => {
        const tenantId = await mongoCtx.insert('tenants', { name, email, email_key: email, phone, logo_url: logoUrl, slug, is_active: 1 });
        const userId = await mongoCtx.insert('admins', { tenant_id: tenantId, name: adminName, email, password_hash: passwordHash, is_active: 1 });
        return { tenant: tenantId, user: userId };
      });
      tenantId = insertedTenant;
      userId = insertedUser;
    } else {
      const { withTransaction } = await import('../config/database.mysql');
      const ids = await withTransaction(async conn => {
      const [tenant] = await conn.execute<any>('INSERT INTO tenants (name, email, email_key, phone, logo_url, slug) VALUES (?, ?, ?, ?, ?, ?)', [name, email, email, phone, logoUrl, slug]);
        const tenantId = tenant.insertId as number;
        const [admin] = await conn.execute<any>('INSERT INTO admins (tenant_id, name, email, password_hash, is_active) VALUES (?, ?, ?, ?, 1)', [tenantId, adminName, email, passwordHash]);
        return { tenantId, userId: admin.insertId as number };
      });
      tenantId = ids.tenantId;
      userId = ids.userId;
    }
    res.status(201).json({
      token: issueAccessToken({ id: userId, name: adminName, email }, 'ADMIN', 'admins', tenantId),
      user: { id: userId, tenantId, name: adminName, email, role: 'ADMIN' },
      tenant: { id: tenantId, name, email, phone, slug, logoUrl, updatedAt: new Date().toISOString() },
    });
  } catch (error: any) {
    if (isDuplicateKey(error) || error?.code === 'ER_DUP_ENTRY') {
      res.status(409).json({ error: 'An account with this email already exists.' });
      return;
    }
    throw error;
  }
}
