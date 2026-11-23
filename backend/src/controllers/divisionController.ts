import { Request, Response } from 'express';
import { execute, getContext, isDuplicateKey, query, useMongo, withTransaction } from '../config/database';
import { RowDataPacket } from 'mysql2';

function cleanName(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, 120) : '';
}

async function countFor(tenantId: string | number, table: string): Promise<number> {
  if (useMongo) {
    const ctx = await getContext();
    return ctx.count(table, { tenant_id: tenantId });
  }
  const rows = await query<RowDataPacket[]>(`SELECT COUNT(*) AS total FROM \`${table}\` WHERE tenant_id = ?`, [tenantId]);
  return Number(rows[0]?.total || 0);
}

/** GET /api/divisions — all divisions of the caller's tenant (ADMIN only). */
export async function listDivisions(req: Request, res: Response): Promise<void> {
  const tenantId = req.user!.tenantId;
  if (useMongo) {
    const ctx = await getContext();
    const divisions = await ctx.find('divisions', { tenant_id: tenantId }, { sort: { name: 1 }, projection: { _id: 0 } });
    const [userCounts, productCounts] = await Promise.all([
      Promise.all(['qc_users', 'dispatch_users'].map((table) => ctx.find(table, { tenant_id: tenantId, division_id: { $ne: null }, is_active: 1, email: { $not: /^__role_archive_/i } }, { projection: { division_id: 1 } }))),
      Promise.all(['products'].map((table) => ctx.find(table, { tenant_id: tenantId, division_id: { $ne: null }, is_active: 1 }, { projection: { division_id: 1 } }))),
    ]);
    const countBy = (arrays: Array<Array<Record<string, any>>>) => {
      const map = new Map<string, number>();
      for (const docs of arrays) {
        for (const doc of docs) {
          const key = String(doc.division_id);
          map.set(key, (map.get(key) || 0) + 1);
        }
      }
      return map;
    };
    const userMap = countBy(userCounts);
    const productMap = countBy(productCounts);
    res.json(divisions.map((division: any) => ({
      ...division,
      users: userMap.get(String(division.id)) || 0,
      products: productMap.get(String(division.id)) || 0,
    })));
    return;
  }
  const rows = await query<RowDataPacket[]>(
    `SELECT d.*,
            (SELECT COUNT(*) FROM qc_users u WHERE u.tenant_id = d.tenant_id AND u.division_id = d.id AND u.is_active = 1 AND u.email NOT LIKE '__role_archive_%') +
            (SELECT COUNT(*) FROM dispatch_users u WHERE u.tenant_id = d.tenant_id AND u.division_id = d.id AND u.is_active = 1 AND u.email NOT LIKE '__role_archive_%') AS users,
            (SELECT COUNT(*) FROM products p WHERE p.tenant_id = d.tenant_id AND p.division_id = d.id AND p.is_active = 1) AS products
       FROM divisions d
      WHERE d.tenant_id = ?
      ORDER BY d.name ASC`,
    [tenantId]
  );
  res.json(rows);
}

/** POST /api/divisions — create a division for the caller's tenant (ADMIN only). */
export async function createDivision(req: Request, res: Response): Promise<void> {
  const tenantId = req.user!.tenantId;
  const name = cleanName(req.body?.name);
  if (name.length < 2) { res.status(400).json({ error: 'Enter a division name (at least 2 characters).' }); return; }
  try {
    if (useMongo) {
      const ctx = await getContext();
      const existing = await ctx.findOne('divisions', { tenant_id: tenantId, name: { $regex: `^${escapeRegExp(name)}$`, $options: 'i' } }, { projection: { _id: 0, id: 1 } });
      if (existing) { res.status(409).json({ error: 'A division with that name already exists.' }); return; }
      const id = await ctx.insert('divisions', { tenant_id: tenantId, name, is_active: 1 });
      res.status(201).json({ id, name, is_active: 1 });
      return;
    }
    const dup = await query<RowDataPacket[]>('SELECT id FROM divisions WHERE tenant_id = ? AND LOWER(TRIM(name)) = LOWER(TRIM(?)) LIMIT 1', [tenantId, name]);
    if (dup.length > 0) { res.status(409).json({ error: 'A division with that name already exists.' }); return; }
    const result = await execute('INSERT INTO divisions (tenant_id, name, is_active) VALUES (?, ?, 1)', [tenantId, name]);
    res.status(201).json({ id: result.insertId, name, is_active: 1 });
  } catch (error: any) {
    if (isDuplicateKey(error) || error?.code === 'ER_DUP_ENTRY') {
      res.status(409).json({ error: 'A division with that name already exists.' });
      return;
    }
    throw error;
  }
}

/** PUT /api/divisions/:id — rename or (de)activate a division (ADMIN only). */
export async function updateDivision(req: Request, res: Response): Promise<void> {
  const tenantId = req.user!.tenantId;
  const id = req.params.id;
  const name = req.body?.name === undefined ? undefined : cleanName(req.body.name);
  if (name !== undefined && name.length < 2) { res.status(400).json({ error: 'Enter a division name (at least 2 characters).' }); return; }
  const isActive = req.body?.is_active === undefined ? undefined : (Number(req.body.is_active) === 1 ? 1 : 0);
  try {
    if (useMongo) {
      const ctx = await getContext();
      const division = await ctx.findOne('divisions', { id, tenant_id: tenantId }, { projection: { _id: 0, id: 1 } });
      if (!division) { res.status(404).json({ error: 'Division not found.' }); return; }
      const update: Record<string, any> = {};
      if (name !== undefined) update.name = name;
      if (isActive !== undefined) update.is_active = isActive;
      if (Object.keys(update).length === 0) { res.status(400).json({ error: 'Nothing to update.' }); return; }
      if (name !== undefined) {
        const dup = await ctx.findOne('divisions', { tenant_id: tenantId, name: { $regex: `^${escapeRegExp(name)}$`, $options: 'i' }, id: { $ne: id } }, { projection: { _id: 0, id: 1 } });
        if (dup) { res.status(409).json({ error: 'A division with that name already exists.' }); return; }
      }
      await ctx.updateOne('divisions', { id, tenant_id: tenantId }, { $set: update });
      res.json({ message: 'Division updated' });
      return;
    }
    const division = await query<RowDataPacket[]>('SELECT id FROM divisions WHERE id = ? AND tenant_id = ?', [id, tenantId]);
    if (division.length === 0) { res.status(404).json({ error: 'Division not found.' }); return; }
    const sets: string[] = [];
    const params: any[] = [];
    if (name !== undefined) {
      const dup = await query<RowDataPacket[]>('SELECT id FROM divisions WHERE tenant_id = ? AND LOWER(TRIM(name)) = LOWER(TRIM(?)) AND id <> ? LIMIT 1', [tenantId, name, id]);
      if (dup.length > 0) { res.status(409).json({ error: 'A division with that name already exists.' }); return; }
      sets.push('name = ?'); params.push(name);
    }
    if (isActive !== undefined) { sets.push('is_active = ?'); params.push(isActive); }
    if (sets.length === 0) { res.status(400).json({ error: 'Nothing to update.' }); return; }
    params.push(id, tenantId);
    await execute(`UPDATE divisions SET ${sets.join(', ')} WHERE id = ? AND tenant_id = ?`, params);
    res.json({ message: 'Division updated' });
  } catch (error: any) {
    if (isDuplicateKey(error) || error?.code === 'ER_DUP_ENTRY') {
      res.status(409).json({ error: 'A division with that name already exists.' });
      return;
    }
    throw error;
  }
}

/** DELETE /api/divisions/:id — remove an empty division (ADMIN only).
 *  Users assigned to the division are DEACTIVATED, so they can no longer log in
 *  (the login page tells them to contact an administrator). Their division_id
 *  is left pointing at the removed division on purpose — that dangling link is
 *  what the login check uses to give the division-specific message. Activity
 *  history is kept as-is. Only real business records prevent deletion. */
export async function deleteDivision(req: Request, res: Response): Promise<void> {
  const tenantId = req.user!.tenantId;
  const id = req.params.id;
  const userTables = ['admins', 'qc_users', 'dispatch_users'];
  // Historical logs are intentionally NOT blockers — old activity must not
  // prevent an admin from cleaning up an otherwise empty division.
  const blockingTables = [
    'products', 'batches', 'batch_groups', 'qc_records', 'dispatch_records',
    'dispatch_orders', 'fix_records', 'packing_list_items', 'qr_labels',
    'qr_print_jobs', 'warehouses', 'storage_racks', 'shelf_locations',
    'loading_sessions', 'loading_scan_events',
  ];
  try {
    if (useMongo) {
      const ctx = await getContext();
      const division = await ctx.findOne('divisions', { id, tenant_id: tenantId }, { projection: { _id: 0, id: 1, name: 1 } });
      if (!division) { res.status(404).json({ error: 'Division not found.' }); return; }
      const blockers: string[] = [];
      for (const table of blockingTables) {
        const refs = await ctx.count(table, { tenant_id: tenantId, division_id: id });
        if (refs > 0) blockers.push(`${refs} ${table.replace(/_/g, ' ')}`);
      }
      if (blockers.length > 0) {
        res.status(409).json({ error: `Division "${division.name}" is in use (${blockers.join(', ')}). Move or delete those records first.` });
        return;
      }
      await withTransaction(async (tx) => {
        for (const table of userTables) {
          await tx.updateMany(table, { tenant_id: tenantId, division_id: id }, { $set: { is_active: 0 } });
        }
        await tx.deleteOne('divisions', { id, tenant_id: tenantId });
      });
      res.json({ message: 'Division deleted. Users assigned to it were deactivated.' });
      return;
    }
    const division = await query<RowDataPacket[]>('SELECT id, name FROM divisions WHERE id = ? AND tenant_id = ?', [id, tenantId]);
    if (division.length === 0) { res.status(404).json({ error: 'Division not found.' }); return; }
    const tables = blockingTables.filter((table) => !['loading_sessions', 'loading_scan_events'].includes(table));
    const blockers: string[] = [];
    for (const table of tables) {
      const refs = await query<RowDataPacket[]>(`SELECT COUNT(*) AS total FROM \`${table}\` WHERE tenant_id = ? AND division_id = ?`, [tenantId, id]);
      const count = Number(refs[0]?.total || 0);
      if (count > 0) blockers.push(`${count} ${table.replace(/_/g, ' ')}`);
    }
    if (blockers.length > 0) {
      res.status(409).json({ error: `Division "${division[0].name}" is in use (${blockers.join(', ')}). Move or delete those records first.` });
      return;
    }
    await withTransaction(async (conn) => {
      for (const table of userTables) {
        await (conn as any).execute(`UPDATE \`${table}\` SET is_active = 0 WHERE tenant_id = ? AND division_id = ?`, [tenantId, id]);
      }
      await (conn as any).execute('DELETE FROM divisions WHERE id = ? AND tenant_id = ?', [id, tenantId]);
    });
    res.json({ message: 'Division deleted. Users assigned to it were deactivated.' });
  } catch (error) {
    throw error;
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
