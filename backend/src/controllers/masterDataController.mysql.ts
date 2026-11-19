import { Request, Response } from 'express';
import { execute, query } from '../config/database.mysql';
import { RowDataPacket } from 'mysql2';
import { divisionWhere, divisionStamp } from '../utils/division';

type DivisionScope = { sql: string; params: unknown[] };
const NO_DIVISION: DivisionScope = { sql: '', params: [] };

type MasterKind = 'grades' | 'bag-quantities' | 'uoms';
type MasterValues = { name: string; quantity?: number; unit?: string };

/** Division scope applies to the grades table only (bag_quantities and uoms stay tenant-wide). */
function scopeFor(kind: MasterKind, req: Request): DivisionScope {
  return kind === 'grades' ? divisionWhere(req) : NO_DIVISION;
}

function tableName(kind: string): 'grades' | 'bag_quantities' | 'uoms' | null {
  if (kind === 'grades') return 'grades';
  if (kind === 'bag-quantities') return 'bag_quantities';
  if (kind === 'uoms') return 'uoms';
  return null;
}

function masterValues(kind: MasterKind, body: Record<string, unknown>): MasterValues | null {
  if (kind === 'grades' || kind === 'uoms') {
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    return name && name.length <= 100 ? { name } : null;
  }
  const rawQuantity = Number(body.quantity);
  const quantity = Math.round((rawQuantity + Number.EPSILON) * 10_000) / 10_000;
  const unit = typeof body.unit === 'string' ? body.unit.trim() : '';
  if (
    !Number.isFinite(rawQuantity) || rawQuantity <= 0 || rawQuantity > 9_999_999_999.9999 ||
    Math.abs(rawQuantity - quantity) > 1e-10 || !unit || unit.length > 40
  ) return null;
  return { name: `${quantity} ${unit}`, quantity, unit };
}

async function findMatchingMaster(kind: MasterKind, values: MasterValues, excludeId: number | undefined, tenantId: string | number, dv: DivisionScope = NO_DIVISION): Promise<RowDataPacket | undefined> {
  const table = tableName(kind)!;
  const where = kind === 'grades' || kind === 'uoms'
    ? 'LOWER(TRIM(name)) = LOWER(?)'
    : 'quantity = ? AND LOWER(TRIM(unit)) = LOWER(?)';
  const params = kind === 'grades' || kind === 'uoms' ? [values.name] : [values.quantity, values.unit];
  const select = kind === 'bag-quantities' ? 'id, name, quantity, unit, is_active' : 'id, name, is_active';
  const matches = await query<RowDataPacket[]>(`SELECT ${select} FROM ${table} WHERE tenant_id = ? AND ${where}${dv.sql}`, [tenantId, ...params, ...dv.params]);
  return matches.find(item => Number(item.id) !== excludeId);
}

function parseId(value: string): number | null {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

export async function list(req: Request, res: Response): Promise<void> {
  const tenantId = req.user!.tenantId;
  const table = tableName(req.params.kind);
  if (!table) { res.status(404).json({ error: 'Master type not found' }); return; }
  const dv = scopeFor(req.params.kind as MasterKind, req);
  const items = await query<RowDataPacket[]>(`SELECT * FROM ${table} WHERE tenant_id = ?${dv.sql} ORDER BY name ASC`, [tenantId, ...dv.params]);
  res.json(items);
}

export async function create(req: Request, res: Response): Promise<void> {
  const tenantId = req.user!.tenantId;
  const table = tableName(req.params.kind);
  if (!table) { res.status(404).json({ error: 'Master type not found' }); return; }
  const kind = req.params.kind as MasterKind;
  const dv = scopeFor(kind, req);
  const values = masterValues(kind, req.body);
  if (!values) {
    res.status(400).json({
      error: kind === 'grades' || kind === 'uoms'
        ? `Enter a ${kind === 'grades' ? 'grade' : 'UOM'} name with no more than 100 characters`
        : 'Enter a positive bag quantity (up to four decimal places) and a unit of no more than 40 characters',
    });
    return;
  }
  const existing = await findMatchingMaster(kind, values, undefined, tenantId, dv);
  if (existing) {
    if (Number(existing.is_active) === 1) {
      res.status(409).json({ error: 'That master value already exists and is active' });
      return;
    }
    const table = tableName(kind)!;
    if (kind === 'grades' || kind === 'uoms') {
      await execute(`UPDATE ${table} SET name = ?, is_active = 1 WHERE id = ? AND tenant_id = ?${dv.sql}`, [values.name, existing.id, tenantId, ...dv.params]);
    } else {
      await execute(`UPDATE ${table} SET name = ?, quantity = ?, unit = ?, is_active = 1 WHERE id = ? AND tenant_id = ?${dv.sql}`, [
        values.name, values.quantity, values.unit, existing.id, tenantId, ...dv.params,
      ]);
    }
    res.json({ id: Number(existing.id), ...values, is_active: 1, reactivated: true });
    return;
  }
  try {
    const result = kind === 'grades'
      ? await execute(`INSERT INTO ${table} (name, tenant_id, division_id) VALUES (?, ?, ?)`, [values.name, tenantId, divisionStamp(req)])
      : kind === 'uoms'
        ? await execute(`INSERT INTO ${table} (name, tenant_id) VALUES (?, ?)`, [values.name, tenantId])
        : await execute(`INSERT INTO ${table} (name, quantity, unit, tenant_id) VALUES (?, ?, ?, ?)`, [
            values.name, values.quantity, values.unit, tenantId,
          ]);
    res.status(201).json({ id: result.insertId, ...values, is_active: 1 });
  } catch (error: any) {
    if (error.code === 'ER_DUP_ENTRY') { res.status(409).json({ error: 'That master value already exists' }); return; }
    throw error;
  }
}

export async function update(req: Request, res: Response): Promise<void> {
  const tenantId = req.user!.tenantId;
  const table = tableName(req.params.kind);
  if (!table) { res.status(404).json({ error: 'Master type not found' }); return; }
  const kind = req.params.kind as MasterKind;
  const dv = scopeFor(kind, req);
  const values = masterValues(kind, req.body);
  if (!values) {
    res.status(400).json({
      error: kind === 'grades' || kind === 'uoms'
        ? `Enter a ${kind === 'grades' ? 'grade' : 'UOM'} name with no more than 100 characters`
        : 'Enter a positive bag quantity (up to four decimal places) and a unit of no more than 40 characters',
    });
    return;
  }
  const id = parseId(req.params.id);
  if (!id) { res.status(400).json({ error: 'Invalid master value ID' }); return; }
  const duplicate = await findMatchingMaster(kind, values, id, tenantId, dv);
  if (duplicate) {
    res.status(409).json({ error: 'Another master value with the same name or amount and unit already exists' });
    return;
  }
  try {
    const result = kind === 'grades' || kind === 'uoms'
      ? await execute(`UPDATE ${table} SET name = ?, is_active = 1 WHERE id = ? AND tenant_id = ?${dv.sql}`, [values.name, id, tenantId, ...dv.params])
      : await execute(`UPDATE ${table} SET name = ?, quantity = ?, unit = ?, is_active = 1 WHERE id = ? AND tenant_id = ?${dv.sql}`, [
          values.name, values.quantity, values.unit, id, tenantId, ...dv.params,
        ]);
    if (result.affectedRows === 0) {
      const rows = await query<RowDataPacket[]>(`SELECT id FROM ${table} WHERE id = ? AND tenant_id = ?${dv.sql}`, [id, tenantId, ...dv.params]);
      if (rows.length === 0) { res.status(404).json({ error: 'Master value not found' }); return; }
    }
    res.json({ message: 'Master value updated' });
  } catch (error: any) {
    if (error.code === 'ER_DUP_ENTRY') { res.status(409).json({ error: 'That master value already exists' }); return; }
    throw error;
  }
}

export async function remove(req: Request, res: Response): Promise<void> {
  const tenantId = req.user!.tenantId;
  const table = tableName(req.params.kind);
  if (!table) { res.status(404).json({ error: 'Master type not found' }); return; }
  const id = parseId(req.params.id);
  if (!id) { res.status(400).json({ error: 'Invalid master value ID' }); return; }
  if (req.params.kind === 'uoms') {
    const pdv = divisionWhere(req);
    const used = await query<RowDataPacket[]>(
      `SELECT COUNT(*) AS total FROM products WHERE bag_quantity_id = ? AND tenant_id = ?${pdv.sql}`,
      [id, tenantId, ...pdv.params]
    );
    const total = Number(used[0]?.total || 0);
    if (total > 0) {
      res.status(409).json({
        error: `This UOM is used by ${total} product grade${total === 1 ? '' : 's'}. Change those grades to another UOM before deleting.`,
      });
      return;
    }
    const deleted = await execute('DELETE FROM uoms WHERE id = ? AND tenant_id = ?', [id, tenantId]);
    if (deleted.affectedRows === 0) { res.status(404).json({ error: 'UOM not found' }); return; }
    res.json({ message: 'UOM deleted' });
    return;
  }
  const dv = scopeFor(req.params.kind as MasterKind, req);
  const result = await execute(`UPDATE ${table} SET is_active = 0 WHERE id = ? AND is_active <> 0 AND tenant_id = ?${dv.sql}`, [id, tenantId, ...dv.params]);
  if (result.affectedRows === 0) {
    const rows = await query<RowDataPacket[]>(`SELECT id FROM ${table} WHERE id = ? AND tenant_id = ?${dv.sql}`, [id, tenantId, ...dv.params]);
    if (rows.length === 0) { res.status(404).json({ error: 'Master value not found' }); return; }
  }
  res.json({ message: 'Master value deactivated' });
}

export async function setStatus(req: Request, res: Response): Promise<void> {
  const tenantId = req.user!.tenantId;
  const table = tableName(req.params.kind);
  if (!table) { res.status(404).json({ error: 'Master type not found' }); return; }
  const kind = req.params.kind as MasterKind;
  const dv = scopeFor(kind, req);
  const id = parseId(req.params.id);
  if (!id) { res.status(400).json({ error: 'Invalid master value ID' }); return; }
  const isActive = req.body.is_active === true || req.body.is_active === 1 || req.body.is_active === '1';
  const isInactive = req.body.is_active === false || req.body.is_active === 0 || req.body.is_active === '0';
  if (!isActive && !isInactive) { res.status(400).json({ error: 'is_active must be true or false' }); return; }
  if (isActive) {
    const item = await query<RowDataPacket[]>(`SELECT name, quantity, unit FROM ${table} WHERE id = ? AND tenant_id = ?${dv.sql}`, [id, tenantId, ...dv.params]);
    if (item.length === 0) { res.status(404).json({ error: 'Master value not found' }); return; }
    const values: MasterValues = kind === 'grades' || kind === 'uoms'
      ? { name: String(item[0].name) }
      : { name: String(item[0].name), quantity: Number(item[0].quantity), unit: String(item[0].unit) };
    if (await findMatchingMaster(kind, values, id, tenantId, dv)) {
      res.status(409).json({ error: 'Another master value with the same name or amount and unit already exists' });
      return;
    }
  }
  const result = await execute(`UPDATE ${table} SET is_active = ? WHERE id = ? AND tenant_id = ?${dv.sql}`, [isActive ? 1 : 0, id, tenantId, ...dv.params]);
  if (result.affectedRows === 0) {
    const rows = await query<RowDataPacket[]>(`SELECT id FROM ${table} WHERE id = ? AND tenant_id = ?${dv.sql}`, [id, tenantId, ...dv.params]);
    if (rows.length === 0) { res.status(404).json({ error: 'Master value not found' }); return; }
  }
  res.json({ message: isActive ? 'Master value activated' : 'Master value deactivated', is_active: isActive ? 1 : 0 });
}
