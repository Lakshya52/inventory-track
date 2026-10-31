import { Request, Response } from 'express';
import { getContext, idKey, isDuplicateKey, isValidId } from '../config/database';
import { EntityId } from '../services/queryService';

type MasterKind = 'grades' | 'bag-quantities' | 'uoms';
type MasterValues = { name: string; quantity?: number; unit?: string; is_active?: number };

function collectionName(kind: string): 'grades' | 'bag_quantities' | 'uoms' | null {
  if (kind === 'grades') return 'grades';
  if (kind === 'bag-quantities') return 'bag_quantities';
  if (kind === 'uoms') return 'uoms';
  return null;
}

function masterValues(kind: MasterKind, body: Record<string, unknown>): MasterValues | null {
  if (kind === 'grades' || kind === 'uoms') {
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    return name && name.length <= 100 ? { name, is_active: 1 } : null;
  }
  const rawQuantity = Number(body.quantity);
  const quantity = Math.round((rawQuantity + Number.EPSILON) * 10_000) / 10_000;
  const unit = typeof body.unit === 'string' ? body.unit.trim() : '';
  if (
    !Number.isFinite(rawQuantity) || rawQuantity <= 0 || rawQuantity > 9_999_999_999.9999 ||
    Math.abs(rawQuantity - quantity) > 1e-10 || !unit || unit.length > 40
  ) return null;
  return { name: `${quantity} ${unit}`, quantity, unit, is_active: 1 };
}

function isSameMaster(item: Record<string, any>, kind: MasterKind, values: MasterValues): boolean {
  if (kind === 'grades' || kind === 'uoms') {
    return String(item.name || '').trim().toLowerCase() === values.name.toLowerCase();
  }
  const sameAmount = Number(item.quantity) === values.quantity;
  const sameUnit = String(item.unit || '').trim().toLowerCase() === String(values.unit).toLowerCase();
  const sameName = String(item.name || '').trim().toLowerCase() === values.name.toLowerCase();
  return (sameAmount && sameUnit) || sameName;
}

async function findMatchingMaster(
  ctx: Awaited<ReturnType<typeof getContext>>,
  collection: 'grades' | 'bag_quantities' | 'uoms',
  kind: MasterKind,
  values: MasterValues,
  excludeId?: EntityId
): Promise<Record<string, any> | undefined> {
  const items = await ctx.find(collection, {}, {
    projection: { _id: 0, id: 1, name: 1, quantity: 1, unit: 1, is_active: 1 },
  });
  return items.find(item => (excludeId === undefined || idKey(item.id) !== idKey(excludeId)) && isSameMaster(item, kind, values));
}

function parseId(value: string): string | null {
  return isValidId(value) ? value : null;
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
  const ctx = await getContext();
  const existing = await findMatchingMaster(ctx, collection, kind, values);
  if (existing) {
    if (Number(existing.is_active) === 1 || existing.is_active === true) {
      res.status(409).json({ error: 'That master value already exists and is active' });
      return;
    }
    await ctx.updateOne(collection, { id: existing.id }, { $set: values });
    res.json({ id: existing.id, ...values, reactivated: true });
    return;
  }
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
  const ctx = await getContext();
  const duplicate = await findMatchingMaster(ctx, collection, kind, values, id);
  if (duplicate) {
    res.status(409).json({ error: 'Another master value with the same name or amount and unit already exists' });
    return;
  }
  try {
    const result = await ctx.updateOne(collection, { id }, { $set: values });
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
  const id = parseId(req.params.id);
  if (!id) { res.status(400).json({ error: 'Invalid master value ID' }); return; }
  const ctx = await getContext();
  const result = await ctx.updateOne(collection, { id }, { $set: { is_active: 0 } });
  if (result.matchedCount === 0) { res.status(404).json({ error: 'Master value not found' }); return; }
  res.json({ message: 'Master value deactivated' });
}

export async function setStatus(req: Request, res: Response): Promise<void> {
  const collection = collectionName(req.params.kind);
  if (!collection) { res.status(404).json({ error: 'Master type not found' }); return; }
  const kind = req.params.kind as MasterKind;
  const id = parseId(req.params.id);
  if (!id) { res.status(400).json({ error: 'Invalid master value ID' }); return; }
  const isActive = req.body.is_active === true || req.body.is_active === 1 || req.body.is_active === '1';
  const isInactive = req.body.is_active === false || req.body.is_active === 0 || req.body.is_active === '0';
  if (!isActive && !isInactive) { res.status(400).json({ error: 'is_active must be true or false' }); return; }
  const ctx = await getContext();
  if (isActive) {
    const item = await ctx.findOne(collection, { id }, { projection: { _id: 0, id: 1, name: 1, quantity: 1, unit: 1 } });
    if (!item) { res.status(404).json({ error: 'Master value not found' }); return; }
    const values: MasterValues = kind === 'grades' || kind === 'uoms'
      ? { name: String(item.name) }
      : { name: String(item.name), quantity: Number(item.quantity), unit: String(item.unit) };
    if (await findMatchingMaster(ctx, collection, kind, values, id)) {
      res.status(409).json({ error: 'Another master value with the same name or amount and unit already exists' });
      return;
    }
  }
  const result = await ctx.updateOne(collection, { id }, { $set: { is_active: isActive ? 1 : 0 } });
  if (result.matchedCount === 0) { res.status(404).json({ error: 'Master value not found' }); return; }
  res.json({ message: isActive ? 'Master value activated' : 'Master value deactivated', is_active: isActive ? 1 : 0 });
}
