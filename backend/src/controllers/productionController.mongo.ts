import { Request, Response } from 'express';
import { getContext, idKey, isValidId } from '../config/database';
import { mapByIds, mapNames } from '../services/queryService';

export async function listBatches(_req: Request, res: Response): Promise<void> {
  const ctx = await getContext();
  const batches = await ctx.find('batches', {
    status: { $in: ['CREATED', 'QC_FAILED', 'DISPATCH_APPROVED'] },
  }, {
    sort: { created_at: -1 },
    projection: { _id: 0 },
  });
  const products = await mapByIds<Record<string, any>>(
    ctx,
    'products',
    batches.map((batch) => batch.product_id)
  );
  res.json(batches.map((batch) => {
    const product = products.get(idKey(batch.product_id));
    return {
      ...batch,
      product_name: product?.name ?? null,
      product_sku: product?.sku ?? null,
    };
  }));
}

export async function fixBatch(req: Request, res: Response): Promise<void> {
  const { batch_id, description } = req.body;
  if (!batch_id || !isValidId(batch_id)) {
    res.status(400).json({ error: 'Batch ID required' });
    return;
  }
  const ctx = await getContext();
  const batch = await ctx.findOne('batches', { id: batch_id }, { projection: { _id: 0 } });
  if (!batch) {
    res.status(404).json({ error: 'Batch not found' });
    return;
  }
  if (batch.status !== 'QC_FAILED') {
    res.status(400).json({ error: `Can only fix QC_FAILED batches. Current status: ${batch.status}` });
    return;
  }

  await ctx.insert('fix_records', {
    batch_id,
    fixed_by: req.user!.userId,
    description: description || null,
  });
  await ctx.updateOne('batches', { id: batch_id }, { $set: { status: 'CREATED' } });
  await ctx.insert('activity_logs', {
    user_name: req.user?.name || 'Production',
    user_role: req.user?.role || 'PRODUCTION',
    action: 'BATCH_FIXED',
    description: `Batch ${batch.batch_number} fixed and sent back to QC`,
  });

  res.json({ status: 'CREATED', batch_id });
}

export async function listFixRecords(_req: Request, res: Response): Promise<void> {
  const ctx = await getContext();
  const records = await ctx.find('fix_records', {}, {
    sort: { created_at: -1 },
    limit: 50,
    projection: { _id: 0 },
  });
  const batches = await mapByIds<Record<string, any>>(
    ctx,
    'batches',
    records.map((record) => record.batch_id)
  );
  const products = await mapByIds<Record<string, any>>(
    ctx,
    'products',
    [...batches.values()].map((batch) => batch.product_id)
  );
  const fixedBy = await mapNames(ctx, 'production_users', records.map((record) => record.fixed_by));

  res.json(records.map((record) => {
    const batch = batches.get(idKey(record.batch_id));
    const product = batch ? products.get(idKey(batch.product_id)) : undefined;
    return {
      ...record,
      batch_number: batch?.batch_number ?? null,
      product_name: product?.name ?? null,
      fixed_by_name: fixedBy.get(idKey(record.fixed_by)) ?? null,
    };
  }));
}

export async function submitForQc(req: Request, res: Response): Promise<void> {
  const { barcode_value } = req.body;
  if (!barcode_value) {
    res.status(400).json({ error: 'Barcode value required' });
    return;
  }
  const ctx = await getContext();
  const batch = await ctx.findOne('batches', { barcode_value: String(barcode_value) }, { projection: { _id: 0 } });
  if (!batch) {
    res.status(404).json({ error: 'Batch not found' });
    return;
  }
  if (batch.status !== 'CREATED') {
    res.status(400).json({ error: `Can only submit CREATED batches to QC. Current status: ${batch.status}` });
    return;
  }
  const product = await ctx.findOne('products', { id: batch.product_id }, { projection: { _id: 0, name: 1 } });
  await ctx.insert('activity_logs', {
    user_name: req.user?.name || 'Production',
    user_role: req.user?.role || 'PRODUCTION',
    action: 'SUBMITTED_FOR_QC',
    description: `Batch ${batch.batch_number} (${product?.name ?? ''}) submitted for QC`,
  });
  res.json({ status: 'CREATED', batch_id: batch.id, message: 'Batch submitted for QC verification' });
}
