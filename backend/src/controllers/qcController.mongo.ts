import { Request, Response } from 'express';
import { DbContext, daysAgo, getContext, idKey, startOfDay, startOfWeek, withTransaction } from '../config/database';
import { batchIdsForSearch, contains, EntityId, mapByIds, mapNames } from '../services/queryService';

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

export async function decideBatchGroup(req: Request, res: Response): Promise<void> {
  const groupId = String(req.params.id || '').trim();
  const result = String(req.body?.result || '').toUpperCase();
  const remarks = typeof req.body?.remarks === 'string' ? req.body.remarks.trim().slice(0, 1000) : '';
  if (!groupId) {
    res.status(400).json({ error: 'Batch ID is required' });
    return;
  }
  if (!['PASS', 'FAIL'].includes(result)) {
    res.status(400).json({ error: 'QC result must be PASS or FAIL' });
    return;
  }

  try {
    const outcome = await withTransaction(async (tx) => {
      const group = await tx.findOne('batch_groups', { group_key: groupId }, { projection: { _id: 0 } });
      if (!group) {
        throw Object.assign(new Error('Batch not found'), { statusCode: 404 });
      }
      const currentStatus = String(group.status || '').toUpperCase();
      if (currentStatus !== 'PENDING_QC') {
        throw Object.assign(
          new Error(`This batch has already been reviewed (${currentStatus.replace(/_/g, ' ')}). Only batches waiting for QC can be marked.`),
          { statusCode: 409 }
        );
      }
      const children = await tx.find('batches', { batch_group_id: groupId }, {
        projection: { _id: 0, id: 1, product_id: 1, quantity: 1 },
      });
      if (children.length === 0) {
        throw Object.assign(new Error('This batch has no units to review'), { statusCode: 409 });
      }

      const status = result === 'PASS' ? 'QC_PASSED' : 'QC_FAILED';
      await tx.updateOne('batch_groups', { group_key: groupId }, { $set: { status } });
      await tx.updateMany('batches', { batch_group_id: groupId }, { $set: { status } });

      for (const child of children) {
        await tx.insert('qc_records', {
          batch_id: child.id,
          tester_id: req.user!.userId,
          result,
          method: 'MANUAL_REVIEW',
          remarks: remarks || `Marked ${result} during QC review of ${group.batch_number}`,
        });
      }

      const quantityByProduct = new Map<string, { id: unknown; quantity: number }>();
      for (const child of children) {
        const key = idKey(child.product_id);
        const line = quantityByProduct.get(key) || { id: child.product_id, quantity: 0 };
        line.quantity += Number(child.quantity || 0);
        quantityByProduct.set(key, line);
      }

      if (result === 'PASS') {
        for (const line of quantityByProduct.values()) {
          if (line.quantity > 0) {
            await tx.updateOne('products', { id: line.id }, { $inc: { quantity: line.quantity } });
          }
        }
      }

      await tx.insert('activity_logs', {
        user_id: req.user!.userId,
        user_name: req.user!.name,
        user_role: req.user!.role,
        action: result === 'PASS' ? 'BATCH_QC_PASSED' : 'BATCH_QC_FAILED',
        description: `Batch ${group.batch_number} marked ${result} by QC review (${children.length} unit${children.length === 1 ? '' : 's'})${remarks ? `: ${remarks}` : ''}`,
      });

      return {
        group_id: groupId,
        batch_number: group.batch_number,
        status,
        result,
        unit_count: children.length,
        product_count: quantityByProduct.size,
        remarks: remarks || null,
      };
    });

    res.json({
      ...outcome,
      message: `Batch ${outcome.batch_number} marked ${result}.${result === 'PASS' ? ' Stock is now available for Dispatch.' : ' Stock was not added.'}`,
    });
  } catch (error: any) {
    res.status(error?.statusCode || 500).json({ error: error?.message || 'Could not save the QC decision' });
  }
}

/**
 * Marks several waiting batches as PASS in one call.
 *
 * Each batch group is still decided on its own: a group that is no longer
 * waiting is reported as skipped instead of failing the whole request, so a
 * stale selection can never overwrite a decision somebody else already made.
 */
export async function decideBatchGroupsBulk(req: Request, res: Response): Promise<void> {
  const rawIds: unknown[] = Array.isArray(req.body?.group_ids) ? req.body.group_ids : [];
  const groupIds: string[] = [...new Set(rawIds.map((value) => String(value).trim()).filter(Boolean))].slice(0, 100);
  const remarks = typeof req.body?.remarks === 'string' ? req.body.remarks.trim().slice(0, 1000) : '';
  if (groupIds.length === 0) {
    res.status(400).json({ error: 'Select at least one batch to pass' });
    return;
  }

  const ctx = await getContext();
  const passed: string[] = [];
  const skipped: Array<{ group_id: string; reason: string }> = [];

  for (const groupId of groupIds) {
    const group = await ctx.findOne('batch_groups', { group_key: groupId }, { projection: { _id: 0, status: 1 } }) as Record<string, any> | null;
    if (!group) { skipped.push({ group_id: groupId, reason: 'not found' }); continue; }
    const groupStatus = String(group.status || '').toUpperCase();
    if (groupStatus !== 'PENDING_QC') {
      skipped.push({ group_id: groupId, reason: `already ${groupStatus.replace(/_/g, ' ').toLowerCase()}` });
      continue;
    }
    try {
      await withTransaction(async (tx) => {
        const fresh = await tx.findOne('batch_groups', { group_key: groupId }, { projection: { _id: 0, status: 1, batch_number: 1 } }) as Record<string, any> | null;
        if (!fresh || String(fresh.status || '').toUpperCase() !== 'PENDING_QC') {
          throw Object.assign(new Error('Batch is no longer waiting for QC'), { statusCode: 409 });
        }
        const children = await tx.find('batches', { batch_group_id: groupId }, {
          projection: { _id: 0, id: 1, product_id: 1, quantity: 1 },
        });
        if (children.length === 0) {
          throw Object.assign(new Error('Batch has no units to review'), { statusCode: 409 });
        }

        await tx.updateOne('batch_groups', { group_key: groupId }, { $set: { status: 'QC_PASSED' } });
        await tx.updateMany('batches', { batch_group_id: groupId }, { $set: { status: 'QC_PASSED' } });

        for (const child of children) {
          await tx.insert('qc_records', {
            batch_id: child.id,
            tester_id: req.user!.userId,
            result: 'PASS',
            method: 'MANUAL_REVIEW',
            remarks: remarks || `Marked PASS during bulk QC review of ${fresh.batch_number}`,
          });
        }

        const quantityByProduct = new Map<string, { id: unknown; quantity: number }>();
        for (const child of children) {
          const key = idKey(child.product_id);
          const line = quantityByProduct.get(key) || { id: child.product_id, quantity: 0 };
          line.quantity += Number(child.quantity || 0);
          quantityByProduct.set(key, line);
        }
        for (const line of quantityByProduct.values()) {
          if (line.quantity > 0) {
            await tx.updateOne('products', { id: line.id }, { $inc: { quantity: line.quantity } });
          }
        }

        await tx.insert('activity_logs', {
          user_id: req.user!.userId,
          user_name: req.user!.name,
          user_role: req.user!.role,
          action: 'BATCH_QC_PASSED',
          description: `Batch ${fresh.batch_number} marked PASS in a bulk QC review (${children.length} unit${children.length === 1 ? '' : 's'})${remarks ? `: ${remarks}` : ''}`,
        });
      });
      passed.push(groupId);
    } catch (error: any) {
      skipped.push({ group_id: groupId, reason: error?.message || 'could not be passed' });
    }
  }

  res.json({
    passed_count: passed.length,
    skipped_count: skipped.length,
    passed_group_ids: passed,
    skipped,
    message: `${passed.length} batch${passed.length === 1 ? '' : 'es'} passed${skipped.length ? `, ${skipped.length} skipped` : ''}.`,
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
  const failed = await ctx.count('qc_records', { ...scopeFilter, result: 'FAIL' });

  const pendingQc = await ctx.count('batch_groups', { status: 'PENDING_QC' });
  const pendingRows = await ctx.find('batches', { status: 'PENDING_QC' }, {
    sort: { created_at: 1 },
    limit: 50,
    projection: { _id: 0 },
  });
  const pendingProducts = await mapByIds<Record<string, any>>(
    ctx,
    'products',
    pendingRows.map((batch) => batch.product_id)
  );
  const pendingBatches = pendingRows.map((batch) => {
    const product = pendingProducts.get(idKey(batch.product_id));
    return {
      ...batch,
      product_name: product?.name ?? null,
      product_sku: product?.sku ?? null,
    };
  });

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

  const [recentRecords, todayRecords] = await Promise.all([
    enrichQcRecords(ctx, recent),
    enrichQcRecords(ctx, today),
  ]);

  // Per-QC-person performance: how many batches each QC user reviewed,
  // how many passed, and how many are still waiting for them.
  const perUserRows = await ctx.aggregate('qc_records', [
    {
      $group: {
        _id: '$tester_id',
        total: { $sum: 1 },
        passed: { $sum: { $cond: [{ $eq: ['$result', 'PASS'] }, 1, 0] } },
        failed: { $sum: { $cond: [{ $eq: ['$result', 'FAIL'] }, 1, 0] } },
      },
    },
  ]);
  const testerIds: EntityId[] = perUserRows
    .map((row: any) => row._id)
    .filter((id: any) => id !== null && id !== undefined);
  const testerNames = await mapNames(ctx, 'qc_users', testerIds);
  const perUserToday = await ctx.aggregate('qc_records', [
    { $match: { created_at: { $gte: startOfDay() } } },
    { $group: { _id: '$tester_id', total: { $sum: 1 } } },
  ]);
  const todayByUser = new Map(
    perUserToday.map((row: any) => [idKey(row._id), Number(row.total || 0)]),
  );
  const perUser = perUserRows
    .map((row: any) => ({
      user_id: String(row._id ?? ''),
      name: testerNames.get(idKey(row._id)) ?? 'QC user',
      total: Number(row.total || 0),
      passed: Number(row.passed || 0),
      failed: Number(row.failed || 0),
      pass_rate: Number(row.total || 0) > 0
        ? Math.round((Number(row.passed || 0) / Number(row.total || 0)) * 100)
        : 0,
      today: todayByUser.get(idKey(row._id)) || 0,
    }))
    .sort((a, b) => b.total - a.total);

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
    perUser,
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

  const filter: Record<string, any> = { status: 'PENDING_QC' };
  if (q) {
    const batchIds = await batchIdsForSearch(ctx, q);
    filter.$or = [{ id: { $in: batchIds } }, { batch_number: contains(q) }];
  }

  const total = await ctx.count('batches', filter);
  const rows = await ctx.find('batches', filter, {
    sort: { created_at: 1 },
    skip: offset,
    limit,
    projection: { _id: 0 },
  });
  const products = await mapByIds<Record<string, any>>(
    ctx,
    'products',
    rows.map((batch) => batch.product_id)
  );
  // Show who raised each batch so QC knows who to ask about it. The creator
  // is recorded on the batch group, not on each unit batch.
  const groupRows = await ctx.find('batch_groups', {
    group_key: { $in: [...new Set(rows.map((batch) => batch.batch_group_id).filter(Boolean))] },
  }, { projection: { _id: 0, group_key: 1, created_by: 1 } });
  const groupsByKey = new Map(groupRows.map((group) => [String(group.group_key), group]));
  const creatorIds = [...new Set(groupRows.map((group) => group.created_by).filter(Boolean))];
  const creators = await mapNames(ctx, 'dispatch_users', creatorIds);
  const items = rows.map((batch) => {
    const product = products.get(idKey(batch.product_id));
    const group = groupsByKey.get(String(batch.batch_group_id));
    return {
      ...batch,
      product_name: product?.name ?? null,
      product_sku: product?.sku ?? null,
      created_by_name: group ? creators.get(idKey(group.created_by)) ?? null : null,
    };
  });

  res.json({ items, total, page, limit, pages: Math.ceil(total / limit) });
}

export async function records(req: Request, res: Response): Promise<void> {
  const user = req.user!;
  const { page, limit, offset } = pageParams(req, 20);
  const requestedScope = String(req.query.scope || (user.role === 'QC' ? 'mine' : 'all'));
  const scope = user.role === 'QC' ? 'mine' : requestedScope;
  const q = String(req.query.q || '').trim();
  const result = String(req.query.result || '').toUpperCase();
  const ctx = await getContext();

  const filter: Record<string, any> = {};
  if (result === 'PASS' || result === 'FAIL') filter.result = result;
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
