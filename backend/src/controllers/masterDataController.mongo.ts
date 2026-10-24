import { Request, Response } from 'express';
import { getContext, isDuplicateKey } from '../config/database';

type MasterKind = 'grades' | 'bag-quantities';

function collectionName(kind: string): 'grades' | 'bag_quantities' | null {
  if (kind === 'grades') return 'grades';
  if (kind === 'bag-quantities') return 'bag_quantities';
  return null;
}

function masterValues(kind: MasterKind, body: Record<string, unknown>): Record<string, unknown> | null {
  if (kind === 'grades') {
    const name = String(body.name || '').trim();
    return name ? { name, is_active: 1 } : null;
  }
  const quantity = Number(body.quantity);
  const unit = String(body.unit || '').trim();
  if (!Number.isFinite(quantity) || quantity <= 0 || !unit || unit.length > 40) return null;
  return { name: `${quantity} ${unit}`, quantity, unit, is_active: 1 };
}

export async function list(req: Request, res: Response): Promise<void> {
  const collection = collectionName(req.params.kind);
  if (!collection) { res.status(404).json({ error: 'Master type not found' }); return; }
  const ctx = await getContext();
  const items = await ctx.find(collection, {}, { sort: { name: 1 }, projection: { _id: 0 } });
  res.json(items);
}

export async function create(req: Request, res: Response): Promise<void> {
  const collection = collectionName(req.params.kind);
  if (!collection) { res.status(404).json({ error: 'Master type not found' }); return; }
  const values = masterValues(req.params.kind as MasterKind, req.body);
  if (!values) {
    res.status(400).json({
      error: req.params.kind === 'grades'
        ? 'Grade name is required'
        : 'Enter a positive bag quantity and a unit (for example, 25 kg)',
    });
    return;
  }
  const ctx = await getContext();
  try {
    const id = await ctx.insert(collection, values);
    res.status(201).json({ id, ...values });
  } catch (error) {
    if (isDuplicateKey(error)) { res.status(409).json({ error: 'That master value already exists' }); return; }
    throw error;
  }
}

export async function update(req: Request, res: Response): Promise<void> {
  const collection = collectionName(req.params.kind);
  if (!collection) { res.status(404).json({ error: 'Master type not found' }); return; }
  const values = masterValues(req.params.kind as MasterKind, req.body);
  if (!values) {
    res.status(400).json({
      error: req.params.kind === 'grades'
        ? 'Grade name is required'
        : 'Enter a positive bag quantity and a unit (for example, 25 kg)',
    });
    return;
  }
  const ctx = await getContext();
  try {
    const result = await ctx.updateOne(collection, { id: Number(req.params.id) }, { $set: values });
    if (result.matchedCount === 0) { res.status(404).json({ error: 'Master value not found' }); return; }
    res.json({ message: 'Master value updated' });
  } catch (error) {
    if (isDuplicateKey(error)) { res.status(409).json({ error: 'That master value already exists' }); return; }
    throw error;
  }
}

export async function remove(req: Request, res: Response): Promise<void> {
  const collection = collectionName(req.params.kind);
  if (!collection) { res.status(404).json({ error: 'Master type not found' }); return; }
  const ctx = await getContext();
  const result = await ctx.updateOne(collection, { id: Number(req.params.id) }, { $set: { is_active: 0 } });
  if (result.matchedCount === 0) { res.status(404).json({ error: 'Master value not found' }); return; }
  res.json({ message: 'Master value deactivated' });
}
