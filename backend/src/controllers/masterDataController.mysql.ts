import { Request, Response } from 'express';
import { execute, query } from '../config/database.mysql';
import { RowDataPacket } from 'mysql2';

type MasterKind = 'grades' | 'bag-quantities';

function tableName(kind: string): 'grades' | 'bag_quantities' | null {
  if (kind === 'grades') return 'grades';
  if (kind === 'bag-quantities') return 'bag_quantities';
  return null;
}

function masterValues(kind: MasterKind, body: Record<string, unknown>): { name: string; quantity?: number; unit?: string } | null {
  if (kind === 'grades') {
    const name = String(body.name || '').trim();
    return name ? { name } : null;
  }
  const quantity = Number(body.quantity);
  const unit = String(body.unit || '').trim();
  if (!Number.isFinite(quantity) || quantity <= 0 || !unit || unit.length > 40) return null;
  return { name: `${quantity} ${unit}`, quantity, unit };
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
  const values = masterValues(req.params.kind as MasterKind, req.body);
  if (!values) {
    res.status(400).json({
      error: req.params.kind === 'grades'
        ? 'Grade name is required'
        : 'Enter a positive bag quantity and a unit (for example, 25 kg)',
    });
    return;
  }
  try {
    const result = req.params.kind === 'grades'
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
  const values = masterValues(req.params.kind as MasterKind, req.body);
  if (!values) {
    res.status(400).json({
      error: req.params.kind === 'grades'
        ? 'Grade name is required'
        : 'Enter a positive bag quantity and a unit (for example, 25 kg)',
    });
    return;
  }
  try {
    const result = req.params.kind === 'grades'
      ? await execute(`UPDATE ${table} SET name = ?, is_active = 1 WHERE id = ?`, [values.name, req.params.id])
      : await execute(`UPDATE ${table} SET name = ?, quantity = ?, unit = ?, is_active = 1 WHERE id = ?`, [
          values.name, values.quantity, values.unit, req.params.id,
        ]);
    if (result.affectedRows === 0) {
      const rows = await query<RowDataPacket[]>(`SELECT id FROM ${table} WHERE id = ?`, [req.params.id]);
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
  const result = await execute(`UPDATE ${table} SET is_active = 0 WHERE id = ?`, [req.params.id]);
  if (result.affectedRows === 0) { res.status(404).json({ error: 'Master value not found' }); return; }
  res.json({ message: 'Master value deactivated' });
}
