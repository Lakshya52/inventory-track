import { Request, Response } from 'express';
import { execute, query } from '../config/database.mysql';
import { RowDataPacket } from 'mysql2';

type MasterKind = 'grades' | 'bag-quantities' | 'uoms';
type MasterValues = { name: string; quantity?: number; unit?: string };

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

async function findMatchingMaster(kind: MasterKind, values: MasterValues, excludeId?: number): Promise<RowDataPacket | undefined> {
  const table = tableName(kind)!;
  const where = kind === 'grades' || kind === 'uoms'
    ? 'LOWER(TRIM(name)) = LOWER(?)'
    : 'quantity = ? AND LOWER(TRIM(unit)) = LOWER(?)';
  const params = kind === 'grades' || kind === 'uoms' ? [values.name] : [values.quantity, values.unit];
  const matches = await query<RowDataPacket[]>(`SELECT id, name, quantity, unit, is_active FROM ${table} WHERE ${where}`, params);
  return matches.find(item => Number(item.id) !== excludeId);
}

function parseId(value: string): number | null {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

export async function list(req: Request, res: Response): Promise<void> {
  const table = tableName(req.params.kind);
  if (!table) { res.status(404).json({ error: 'Master type not found' }); return; }
  const items = await query<RowDataPacket[]>(`SELECT * FROM ${table} ORDER BY name ASC`);
  res.json(items);
}

export async function create(req: Request, res: Response): Promise<void> {
  const table = tableName(req.params.kind);
  if (!table) { res.status(404).json({ error: 'Master type not found' }); return; }
  const kind = req.params.kind as MasterKind;
  const values = masterValues(kind, req.body);
  if (!values) {
    res.status(400).json({
      error: kind === 'grades' || kind === 'uoms'
        ? `Enter a ${kind === 'grades' ? 'grade' : 'UOM'} name with no more than 100 characters`
        : 'Enter a positive bag quantity (up to four decimal places) and a unit of no more than 40 characters',
    });
    return;
  }
  const existing = await findMatchingMaster(kind, values);
  if (existing) {
    if (Number(existing.is_active) === 1) {
      res.status(409).json({ error: 'That master value already exists and is active' });
      return;
    }
    const table = tableName(kind)!;
    if (kind === 'grades' || kind === 'uoms') {
      await execute(`UPDATE ${table} SET name = ?, is_active = 1 WHERE id = ?`, [values.name, existing.id]);
    } else {
      await execute(`UPDATE ${table} SET name = ?, quantity = ?, unit = ?, is_active = 1 WHERE id = ?`, [
        values.name, values.quantity, values.unit, existing.id,
      ]);
    }
    res.json({ id: Number(existing.id), ...values, is_active: 1, reactivated: true });
    return;
  }
  try {
    const result = kind === 'grades' || kind === 'uoms'
      ? await execute(`INSERT INTO ${table} (name) VALUES (?)`, [values.name])
      : await execute(`INSERT INTO ${table} (name, quantity, unit) VALUES (?, ?, ?)`, [
          values.name, values.quantity, values.unit,
        ]);
    res.status(201).json({ id: result.insertId, ...values, is_active: 1 });
  } catch (error: any) {
    if (error.code === 'ER_DUP_ENTRY') { res.status(409).json({ error: 'That master value already exists' }); return; }
    throw error;
  }
}

export async function update(req: Request, res: Response): Promise<void> {
  const table = tableName(req.params.kind);
  if (!table) { res.status(404).json({ error: 'Master type not found' }); return; }
  const kind = req.params.kind as MasterKind;
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
  const duplicate = await findMatchingMaster(kind, values, id);
  if (duplicate) {
    res.status(409).json({ error: 'Another master value with the same name or amount and unit already exists' });
    return;
  }
  try {
    const result = kind === 'grades' || kind === 'uoms'
      ? await execute(`UPDATE ${table} SET name = ?, is_active = 1 WHERE id = ?`, [values.name, id])
      : await execute(`UPDATE ${table} SET name = ?, quantity = ?, unit = ?, is_active = 1 WHERE id = ?`, [
          values.name, values.quantity, values.unit, id,
        ]);
    if (result.affectedRows === 0) {
      const rows = await query<RowDataPacket[]>(`SELECT id FROM ${table} WHERE id = ?`, [id]);
      if (rows.length === 0) { res.status(404).json({ error: 'Master value not found' }); return; }
    }
    res.json({ message: 'Master value updated' });
  } catch (error: any) {
    if (error.code === 'ER_DUP_ENTRY') { res.status(409).json({ error: 'That master value already exists' }); return; }
    throw error;
  }
}

export async function remove(req: Request, res: Response): Promise<void> {
  const table = tableName(req.params.kind);
  if (!table) { res.status(404).json({ error: 'Master type not found' }); return; }
  const id = parseId(req.params.id);
  if (!id) { res.status(400).json({ error: 'Invalid master value ID' }); return; }
  const result = await execute(`UPDATE ${table} SET is_active = 0 WHERE id = ? AND is_active <> 0`, [id]);
  if (result.affectedRows === 0) {
    const rows = await query<RowDataPacket[]>(`SELECT id FROM ${table} WHERE id = ?`, [id]);
    if (rows.length === 0) { res.status(404).json({ error: 'Master value not found' }); return; }
  }
  res.json({ message: 'Master value deactivated' });
}

export async function setStatus(req: Request, res: Response): Promise<void> {
  const table = tableName(req.params.kind);
  if (!table) { res.status(404).json({ error: 'Master type not found' }); return; }
  const kind = req.params.kind as MasterKind;
  const id = parseId(req.params.id);
  if (!id) { res.status(400).json({ error: 'Invalid master value ID' }); return; }
  const isActive = req.body.is_active === true || req.body.is_active === 1 || req.body.is_active === '1';
  const isInactive = req.body.is_active === false || req.body.is_active === 0 || req.body.is_active === '0';
  if (!isActive && !isInactive) { res.status(400).json({ error: 'is_active must be true or false' }); return; }
  if (isActive) {
    const item = await query<RowDataPacket[]>(`SELECT name, quantity, unit FROM ${table} WHERE id = ?`, [id]);
    if (item.length === 0) { res.status(404).json({ error: 'Master value not found' }); return; }
    const values: MasterValues = kind === 'grades' || kind === 'uoms'
      ? { name: String(item[0].name) }
      : { name: String(item[0].name), quantity: Number(item[0].quantity), unit: String(item[0].unit) };
    if (await findMatchingMaster(kind, values, id)) {
      res.status(409).json({ error: 'Another master value with the same name or amount and unit already exists' });
      return;
    }
  }
  const result = await execute(`UPDATE ${table} SET is_active = ? WHERE id = ?`, [isActive ? 1 : 0, id]);
  if (result.affectedRows === 0) {
    const rows = await query<RowDataPacket[]>(`SELECT id FROM ${table} WHERE id = ?`, [id]);
    if (rows.length === 0) { res.status(404).json({ error: 'Master value not found' }); return; }
  }
  res.json({ message: isActive ? 'Master value activated' : 'Master value deactivated', is_active: isActive ? 1 : 0 });
}
