import { Request, Response } from 'express';
import { getContext, idKey } from '../config/database';
import { mapByIds, mapNames } from '../services/queryService';

export async function listBatches(_req: Request, res: Response): Promise<void> {
  const ctx = await getContext();
  // Legacy production queue: batches are auto QC-passed in SRS v2, so only
  // show lots that still exist downstream of creation.
  const batches = await ctx.find('batches', {
    status: { $in: ['QC_PASSED', 'DISPATCH_APPROVED', 'LOADING'] },
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

export async function fixBatch(_req: Request, res: Response): Promise<void> {
  // SRS v2 removes failed-QC batches and the fix/reopen loop.
  res.status(410).json({
    error: 'Fix batches is retired: batches are created QC-passed automatically.',
  });
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

export async function submitForQc(_req: Request, res: Response): Promise<void> {
  // SRS v2 has no manual QC submission step: batches are born QC-passed.
  res.status(410).json({
    error: 'Manual QC submission is retired: batches are created QC-passed automatically.',
  });
}
