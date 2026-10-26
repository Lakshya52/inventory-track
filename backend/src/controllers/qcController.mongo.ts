import { Request, Response } from 'express';
import { randomUUID } from 'crypto';
import {
  DbContext,
  daysAgo,
  getContext,
  idKey,
  isValidId,
  startOfDay,
  startOfWeek,
  withTransaction,
} from '../config/database';
import { applyOperation } from '../services/syncService';
import { SyncOperationInput } from '../types';
import {
  batchAgeMinutes,
  batchIdsForSearch,
  batchQrStats,
  contains,
  mapByIds,
  mapNames,
} from '../services/queryService';

function pageParams(req: Request, defaultLimit = 20): { page: number; limit: number; offset: number } {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || defaultLimit));
  return { page, limit, offset: (page - 1) * limit };
}

async function enrichPendingBatches(ctx: DbContext, batches: Record<string, any>[]): Promise<Record<string, any>[]> {
  const products = await mapByIds<Record<string, any>>(
    ctx,
    'products',
    batches.map((batch) => batch.product_id)
  );
  const stats = await batchQrStats(ctx, batches.map((batch) => batch.id));
  return batches.map((batch) => {
    const product = products.get(idKey(batch.product_id));
    return {
      id: batch.id,
      batch_number: batch.batch_number,
      barcode_value: batch.barcode_value,
      quantity: batch.quantity,
      uom: batch.uom,
      storage_location: batch.storage_location,
      qr_count: stats.get(idKey(batch.id))?.count ?? 0,
      created_at: batch.created_at,
      product_name: product?.name ?? null,
      product_sku: product?.sku ?? null,
      cas_number: product?.cas_number ?? null,
      product_grade: product?.grade ?? null,
      product_purity: product?.purity ?? null,
      age_minutes: batchAgeMinutes(batch.created_at),
    };
  });
}

async function enrichQcRecords(ctx: DbContext, records: Record<string, any>[]): Promise<Record<string, any>[]> {
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
  const testers = await mapNames(ctx, 'qc_users', records.map((record) => record.tester_id));
  return records.map((record) => {
    const batch = batches.get(idKey(record.batch_id));
    const product = batch ? products.get(idKey(batch.product_id)) : undefined;
    return {
      ...record,
      batch_number: batch?.batch_number ?? null,
      barcode_value: batch?.barcode_value ?? null,
      product_name: product?.name ?? null,
      product_sku: product?.sku ?? null,
      tester_name: testers.get(idKey(record.tester_id)) ?? null,
    };
  });
}

export async function submit(req: Request, res: Response): Promise<void> {
  const barcode_value = String(req.body.barcode_value || '').trim();
  const result = String(req.body.result || '').toUpperCase();
  const remarks = req.body.remarks;
  const files = (req.files as Express.Multer.File[]) || [];
  const bodyImages = Array.isArray(req.body.images) ? req.body.images : [];
  const images = files.length > 0 ? files.map((file) => file.filename) : bodyImages;

  if (!barcode_value || !result) {
    res.status(400).json({ error: 'Barcode value and result are required' });
    return;
  }
  if (!['PASS', 'FAIL'].includes(result)) {
    res.status(400).json({ error: 'Result must be PASS or FAIL' });
    return;
  }

  const operation: SyncOperationInput = {
    operation_id: req.body.client_operation_id || randomUUID(),
    type: 'QC_SUBMIT',
    client_timestamp: req.body.client_timestamp || new Date().toISOString(),
    payload: {
      barcode_value,
      result,
      remarks: remarks || null,
      images,
      expected_status: req.body.expected_status || undefined,
    },
  };

  const applied = await applyOperation(req.user!, null, operation);
  if (applied.status === 'APPLIED' || applied.status === 'DUPLICATE') {
    res.json({ ...(applied.data || {}), duplicate: applied.status === 'DUPLICATE' });
    return;
  }
  res.status(applied.status === 'CONFLICT' ? 409 : 400).json({
    error: applied.error || 'QC submission failed',
    code: applied.error_code,
    ...(applied.data || {}),
  });
}

export async function submitBulk(req: Request, res: Response): Promise<void> {
  let barcodes: string[] = [];
  if (Array.isArray(req.body.barcodes)) {
    barcodes = req.body.barcodes.map((value: any) => String(value || '').trim()).filter(Boolean);
  } else if (typeof req.body.barcodes === 'string') {
    try {
      const parsed = JSON.parse(req.body.barcodes);
      if (Array.isArray(parsed)) {
        barcodes = parsed.map((value: any) => String(value || '').trim()).filter(Boolean);
      }
    } catch {
      barcodes = [];
    }
  } else if (typeof req.body.barcode_value === 'string') {
    barcodes = [req.body.barcode_value.trim()];
  }
  barcodes = [...new Set(barcodes)];

  const result = String(req.body.result || '').toUpperCase();
  const remarks = req.body.remarks;
  const files = (req.files as Express.Multer.File[]) || [];
  const bodyImages = Array.isArray(req.body.images) ? req.body.images : [];
  const images = files.length > 0 ? files.map((file) => file.filename) : bodyImages;

  if (barcodes.length === 0 || !result) {
    res.status(400).json({ error: 'At least one QR code and a result are required' });
    return;
  }
  if (!['PASS', 'FAIL'].includes(result)) {
    res.status(400).json({ error: 'Result must be PASS or FAIL' });
    return;
  }

  const operation: SyncOperationInput = {
    operation_id: req.body.client_operation_id || randomUUID(),
    type: 'QC_SUBMIT_BULK',
    client_timestamp: req.body.client_timestamp || new Date().toISOString(),
    payload: {
      barcodes,
      result,
      remarks: remarks || null,
      images,
    },
  };

  const applied = await applyOperation(req.user!, null, operation);
  if (applied.status === 'APPLIED' || applied.status === 'DUPLICATE') {
    res.json({ ...(applied.data || {}), duplicate: applied.status === 'DUPLICATE' });
    return;
  }
  res.status(applied.status === 'CONFLICT' ? 409 : 400).json({
    error: applied.error || 'Group QC submission failed',
    code: applied.error_code,
    ...(applied.data || {}),
  });
}

export async function reopenFailedBatch(req: Request, res: Response): Promise<void> {
  const reason = String(req.body.reason || '').trim();
  if (!reason) {
    res.status(400).json({ error: 'A reason is required to send a failed batch back for QC' });
    return;
  }
  const result = await withTransaction(async (ctx: DbContext) => {
    const id = req.params.id;
    if (!isValidId(id)) return { error: 'Invalid batch id', statusCode: 400 } as const;
    const batch = await ctx.findOne('batches', { id }, { projection: { _id: 0 } });
    if (!batch) return { error: 'Batch not found', statusCode: 404 } as const;
    if (batch.status !== 'QC_FAILED') {
      return { error: 'Only QC-failed batches can be sent back for re-QC', statusCode: 409 } as const;
    }
    const update = await ctx.updateOne(
      'batches',
      { id: batch.id, status: 'QC_FAILED' },
      { $set: { status: 'CREATED' } }
    );
    if (update.matchedCount !== 1) {
      return { error: 'Batch was changed by another user', statusCode: 409 } as const;
    }
    await ctx.insert('activity_logs', {
      user_id: req.user!.userId,
      user_name: req.user!.name,
      user_role: req.user!.role,
      action: 'BATCH_SENT_FOR_REQC',
      description: `Batch ${batch.batch_number} sent back for QC: ${reason.slice(0, 1000)}`,
    });
    return { batch_id: batch.id, status: 'CREATED' } as const;
  });
  if ('error' in result) {
    res.status(result.statusCode ?? 500).json({ error: result.error });
    return;
  }
  res.json(result);
}

export async function stats(req: Request, res: Response): Promise<void> {
  const user = req.user!;
  const personal = user.role === 'QC';
  const ctx = await getContext();
  const scopeFilter = personal ? { tester_id: user.userId } : {};

  const totalTests = await ctx.count('qc_records', scopeFilter);
  const testsToday = await ctx.count('qc_records', { ...scopeFilter, created_at: { $gte: startOfDay() } });
  const testsThisWeek = await ctx.count('qc_records', { ...scopeFilter, created_at: { $gte: startOfWeek() } });
  const passed = await ctx.count('qc_records', { ...scopeFilter, result: 'PASS' });
  const failed = await ctx.count('qc_records', { ...scopeFilter, result: 'FAIL' });

  const pendingRows = await ctx.find('batches', { status: 'CREATED' }, {
    sort: { created_at: 1 },
    limit: 50,
    projection: { _id: 0 },
  });
  const pendingQc = await ctx.count('batches', { status: 'CREATED' });

  const recent = await ctx.find('qc_records', scopeFilter, {
    sort: { created_at: -1 },
    limit: 20,
    projection: { _id: 0 },
  });
  const today = await ctx.find('qc_records', { ...scopeFilter, created_at: { $gte: startOfDay() } }, {
    sort: { created_at: -1 },
    projection: { _id: 0 },
  });

  const trendRows = await ctx.aggregate('qc_records', [
    {
      $match: {
        ...scopeFilter,
        created_at: { $gte: daysAgo(6) },
      },
    },
    {
      $group: {
        _id: { $dateToString: { format: '%Y-%m-%d', date: '$created_at', timezone: 'UTC' } },
        passed: { $sum: { $cond: [{ $eq: ['$result', 'PASS'] }, 1, 0] } },
        failed: { $sum: { $cond: [{ $eq: ['$result', 'FAIL'] }, 1, 0] } },
        total: { $sum: 1 },
      },
    },
    { $sort: { _id: 1 } },
  ]);

  const [pendingBatches, recentRecords, todayRecords] = await Promise.all([
    enrichPendingBatches(ctx, pendingRows),
    enrichQcRecords(ctx, recent),
    enrichQcRecords(ctx, today),
  ]);

  res.json({
    scope: personal ? 'mine' : 'all',
    totalTests,
    testsToday,
    testsThisWeek,
    passed,
    failed,
    pendingQc,
    passRate: totalTests > 0 ? Math.round((passed / totalTests) * 100) : 0,
    myTestsToday: testsToday,
    myTestsThisWeek: testsThisWeek,
    myTotalTests: totalTests,
    myPassed: passed,
    myFailed: failed,
    myPassRate: totalTests > 0 ? Math.round((passed / totalTests) * 100) : 0,
    pendingBatches,
    recentRecords,
    todayRecords,
    trend: trendRows.map((row) => ({
      day: row._id,
      passed: Number(row.passed || 0),
      failed: Number(row.failed || 0),
      total: Number(row.total || 0),
    })),
  });
}

export async function pending(req: Request, res: Response): Promise<void> {
  const { page, limit, offset } = pageParams(req, 20);
  const q = String(req.query.q || '').trim();
  const ctx = await getContext();

  const filter: Record<string, any> = { status: 'CREATED' };
  if (q) {
    const ids = await batchIdsForSearch(ctx, q, { status: 'CREATED' });
    filter.id = { $in: ids };
  }

  const total = await ctx.count('batches', filter);
  const batches = await ctx.find('batches', filter, {
    sort: { created_at: 1 },
    skip: offset,
    limit,
    projection: { _id: 0 },
  });
  const items = await enrichPendingBatches(ctx, batches);

  res.json({ items, total, page, limit, pages: Math.ceil(total / limit) });
}

export async function records(req: Request, res: Response): Promise<void> {
  const user = req.user!;
  const { page, limit, offset } = pageParams(req, 20);
  const requestedScope = String(req.query.scope || (user.role === 'QC' ? 'mine' : 'all'));
  const scope = user.role === 'QC' ? 'mine' : requestedScope;
  const result = String(req.query.result || '').toUpperCase();
  const q = String(req.query.q || '').trim();
  const ctx = await getContext();

  const filter: Record<string, any> = {};
  if (scope === 'mine') filter.tester_id = user.userId;
  if (result === 'PASS' || result === 'FAIL') filter.result = result;
  if (q) {
    const batchIds = await batchIdsForSearch(ctx, q);
    filter.$or = [{ batch_id: { $in: batchIds } }, { remarks: contains(q) }];
  }

  const total = await ctx.count('qc_records', filter);
  const rows = await ctx.find('qc_records', filter, {
    sort: { created_at: -1 },
    skip: offset,
    limit,
    projection: { _id: 0 },
  });
  const items = await enrichQcRecords(ctx, rows);

  res.json({ items, total, page, limit, pages: Math.ceil(total / limit), scope });
}
