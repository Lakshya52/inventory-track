import { Request, Response } from 'express';
import { DbContext, daysAgo, getContext, idKey, startOfDay, startOfWeek } from '../config/database';
import { batchIdsForSearch, contains, mapByIds, mapNames } from '../services/queryService';

function pageParams(req: Request, defaultLimit = 20): { page: number; limit: number; offset: number } {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || defaultLimit));
  return { page, limit, offset: (page - 1) * limit };
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

export async function submit(_req: Request, res: Response): Promise<void> {
  res.status(410).json({
    error: 'Manual QC submission has been retired. Batches are auto-passed when created.',
  });
}

export async function submitBulk(_req: Request, res: Response): Promise<void> {
  res.status(410).json({
    error: 'Bulk QC submission has been retired. Batches are auto-passed when created.',
  });
}

export async function reopenFailedBatch(_req: Request, res: Response): Promise<void> {
  res.status(410).json({
    error: 'Reopening failed batches has been retired; failed QC batches are no longer recorded.',
  });
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
  const failed = 0;

  const pendingQc = 0;

  const recent = await ctx.find('qc_records', { ...scopeFilter, result: 'PASS' }, {
    sort: { created_at: -1 },
    limit: 20,
    projection: { _id: 0 },
  });
  const today = await ctx.find('qc_records', { ...scopeFilter, result: 'PASS', created_at: { $gte: startOfDay() } }, {
    sort: { created_at: -1 },
    projection: { _id: 0 },
  });

  const trendRows = await ctx.aggregate('qc_records', [
    {
      $match: {
        ...scopeFilter,
        result: 'PASS',
        created_at: { $gte: daysAgo(6) },
      },
    },
    {
      $group: {
        _id: { $dateToString: { format: '%Y-%m-%d', date: '$created_at', timezone: 'UTC' } },
        passed: { $sum: 1 },
        total: { $sum: 1 },
      },
    },
    { $sort: { _id: 1 } },
  ]);

  const [recentRecords, todayRecords] = await Promise.all([
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
    pendingBatches: [],
    recentRecords,
    todayRecords,
    trend: trendRows.map((row) => ({
      day: row._id,
      passed: Number(row.passed || 0),
      failed: 0,
      total: Number(row.total || 0),
    })),
  });
}

export async function pending(req: Request, res: Response): Promise<void> {
  const { page, limit } = pageParams(req, 20);
  res.json({ items: [], total: 0, page, limit, pages: 0 });
}

export async function records(req: Request, res: Response): Promise<void> {
  const user = req.user!;
  const { page, limit, offset } = pageParams(req, 20);
  const requestedScope = String(req.query.scope || (user.role === 'QC' ? 'mine' : 'all'));
  const scope = user.role === 'QC' ? 'mine' : requestedScope;
  const q = String(req.query.q || '').trim();
  const ctx = await getContext();

  const filter: Record<string, any> = { result: 'PASS' };
  if (scope === 'mine') filter.tester_id = user.userId;
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
