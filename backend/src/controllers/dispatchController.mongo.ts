import { Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { DbContext, getContext, startOfDay, startOfWeek } from '../config/database';
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

function personalOnly(req: Request): boolean {
  return req.user?.role === 'DISPATCH';
}

async function enrichDispatchRecords(
  ctx: DbContext,
  records: Record<string, any>[],
  options: { withDispatcherName?: boolean; withOrderStatus?: boolean } = {}
): Promise<Record<string, any>[]> {
  const batches = await mapByIds<Record<string, any>>(
    ctx,
    'batches',
    records.map((record) => Number(record.batch_id))
  );
  const products = await mapByIds<Record<string, any>>(
    ctx,
    'products',
    [...batches.values()].map((batch) => Number(batch.product_id))
  );
  const dispatchers = options.withDispatcherName
    ? await mapNames(ctx, 'dispatch_users', records.map((record) => Number(record.dispatcher_id)))
    : new Map<number, string>();
  const orderIds = records
    .map((record) => record.dispatch_order_id)
    .filter((id) => id !== null && id !== undefined);
  const orders = options.withOrderStatus && orderIds.length > 0
    ? await mapByIds<Record<string, any>>(ctx, 'dispatch_orders', orderIds.map((id) => Number(id)))
    : new Map<number, Record<string, any>>();

  return records.map((record) => {
    const batch = batches.get(Number(record.batch_id));
    const product = batch ? products.get(Number(batch.product_id)) : undefined;
    return {
      ...record,
      batch_number: batch?.batch_number ?? null,
      barcode_value: batch?.barcode_value ?? null,
      product_name: product?.name ?? null,
      product_sku: product?.sku ?? null,
      ...(options.withDispatcherName
        ? { dispatcher_name: dispatchers.get(Number(record.dispatcher_id)) ?? null }
        : {}),
      ...(options.withOrderStatus
        ? {
            order_status: record.dispatch_order_id
              ? orders.get(Number(record.dispatch_order_id))?.status ?? null
              : null,
          }
        : {}),
    };
  });
}

async function enrichOrders(ctx: DbContext, orders: Record<string, any>[]): Promise<Record<string, any>[]> {
  const batches = await mapByIds<Record<string, any>>(
    ctx,
    'batches',
    orders.map((order) => Number(order.batch_id))
  );
  const products = await mapByIds<Record<string, any>>(
    ctx,
    'products',
    [...batches.values()].map((batch) => Number(batch.product_id))
  );
  const raisedBy = await mapNames(ctx, 'dispatch_users', orders.map((order) => Number(order.raised_by)));
  const admins = await mapNames(ctx, 'admins', orders.map((order) => Number(order.admin_id)));
  const clients = await mapNames(ctx, 'clients', orders.map((order) => Number(order.client_id)));
  const qrStats = await batchQrStats(ctx, orders.map((order) => Number(order.batch_id)));

  return orders.map((order) => {
    const batch = batches.get(Number(order.batch_id));
    const product = batch ? products.get(Number(batch.product_id)) : undefined;
    return {
      ...order,
      batch_number: batch?.batch_number ?? null,
      barcode_value: batch?.barcode_value ?? null,
      quantity: batch?.quantity ?? null,
      uom: batch?.uom ?? null,
      batch_status: batch?.status ?? null,
      storage_location: batch?.storage_location ?? null,
      qr_count: qrStats.get(Number(order.batch_id))?.count ?? 0,
      product_name: product?.name ?? null,
      product_sku: product?.sku ?? null,
      raised_by_name: raisedBy.get(Number(order.raised_by)) ?? null,
      admin_name: admins.get(Number(order.admin_id)) ?? null,
      client_name: clients.get(Number(order.client_id)) ?? null,
    };
  });
}

async function enrichReadyBatches(ctx: DbContext, batches: Record<string, any>[]): Promise<Record<string, any>[]> {
  const products = await mapByIds<Record<string, any>>(
    ctx,
    'products',
    batches.map((batch) => Number(batch.product_id))
  );
  return batches.map((batch) => {
    const product = products.get(Number(batch.product_id));
    return {
      id: batch.id,
      batch_number: batch.batch_number,
      barcode_value: batch.barcode_value,
      quantity: batch.quantity,
      uom: batch.uom,
      storage_location: batch.storage_location,
      created_at: batch.created_at,
      product_name: product?.name ?? null,
      product_sku: product?.sku ?? null,
      age_minutes: batchAgeMinutes(batch.updated_at),
    };
  });
}

export async function submit(req: Request, res: Response): Promise<void> {
  const barcode_value = String(req.body.barcode_value || '').trim();
  const files = (req.files as Express.Multer.File[]) || [];
  const bodyImages = Array.isArray(req.body.images) ? req.body.images : [];
  const images = files.length > 0 ? files.map((file) => file.filename) : bodyImages;

  if (!barcode_value) {
    res.status(400).json({ error: 'Barcode value is required' });
    return;
  }

  const operation: SyncOperationInput = {
    operation_id: req.body.client_operation_id || randomUUID(),
    type: 'DISPATCH_CONFIRM',
    client_timestamp: req.body.client_timestamp || new Date().toISOString(),
    payload: {
      barcode_value,
      remarks: req.body.remarks || null,
      images,
      expected_status: req.body.expected_status || undefined,
      direct: req.body.direct === true || req.body.direct === 'true',
    },
  };

  const applied = await applyOperation(req.user!, null, operation);
  if (applied.status === 'APPLIED' || applied.status === 'DUPLICATE') {
    res.json({ ...(applied.data || {}), duplicate: applied.status === 'DUPLICATE' });
    return;
  }
  res.status(applied.status === 'CONFLICT' ? 409 : 400).json({
    error: applied.error || 'Dispatch failed',
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

  const files = (req.files as Express.Multer.File[]) || [];
  const bodyImages = Array.isArray(req.body.images) ? req.body.images : [];
  const images = files.length > 0 ? files.map((file) => file.filename) : bodyImages;

  if (barcodes.length === 0) {
    res.status(400).json({ error: 'At least one QR code is required' });
    return;
  }

  const operation: SyncOperationInput = {
    operation_id: req.body.client_operation_id || randomUUID(),
    type: 'DISPATCH_CONFIRM_BULK',
    client_timestamp: req.body.client_timestamp || new Date().toISOString(),
    payload: {
      barcodes,
      remarks: req.body.remarks || null,
      images,
      direct: req.body.direct === true || req.body.direct === 'true',
    },
  };

  const applied = await applyOperation(req.user!, null, operation);
  if (applied.status === 'APPLIED' || applied.status === 'DUPLICATE') {
    res.json({ ...(applied.data || {}), duplicate: applied.status === 'DUPLICATE' });
    return;
  }
  res.status(applied.status === 'CONFLICT' ? 409 : 400).json({
    error: applied.error || 'Group dispatch failed',
    code: applied.error_code,
    ...(applied.data || {}),
  });
}

export async function today(req: Request, res: Response): Promise<void> {
  const ctx = await getContext();
  const filter: Record<string, any> = { created_at: { $gte: startOfDay() } };
  if (personalOnly(req)) filter.dispatcher_id = req.user!.userId;
  const records = await ctx.find('dispatch_records', filter, {
    sort: { created_at: -1 },
    limit: 100,
    projection: { _id: 0 },
  });
  res.json(await enrichDispatchRecords(ctx, records));
}

export async function ready(req: Request, res: Response): Promise<void> {
  const { page, limit, offset } = pageParams(req, 20);
  const q = String(req.query.q || '').trim();
  const ctx = await getContext();

  const filter: Record<string, any> = { status: 'QC_PASSED' };
  if (q) {
    const ids = await batchIdsForSearch(ctx, q, { status: 'QC_PASSED' });
    filter.id = { $in: ids };
  }

  const total = await ctx.count('batches', filter);
  const batches = await ctx.find('batches', filter, {
    sort: { updated_at: 1 },
    skip: offset,
    limit,
    projection: { _id: 0 },
  });
  const items = await enrichReadyBatches(ctx, batches);

  res.json({ items, total, page, limit, pages: Math.ceil(total / limit) });
}

export async function approvedOrders(req: Request, res: Response): Promise<void> {
  const ctx = await getContext();
  const approvedBatches = await ctx.find('batches', { status: 'DISPATCH_APPROVED' }, { projection: { id: 1 } });
  const filter: Record<string, any> = {
    status: 'APPROVED',
    dispatched_at: null,
    batch_id: { $in: approvedBatches.map((batch) => Number(batch.id)) },
  };
  if (personalOnly(req)) filter.raised_by = req.user!.userId;

  const orders = await ctx.find('dispatch_orders', filter, {
    sort: { updated_at: -1 },
    limit: 100,
    projection: { _id: 0 },
  });
  res.json(await enrichOrders(ctx, orders));
}

export async function records(req: Request, res: Response): Promise<void> {
  const { page, limit, offset } = pageParams(req, 20);
  const q = String(req.query.q || '').trim();
  const ctx = await getContext();

  const filter: Record<string, any> = {};
  if (personalOnly(req)) filter.dispatcher_id = req.user!.userId;
  if (q) {
    const batchIds = await batchIdsForSearch(ctx, q);
    filter.$or = [{ batch_id: { $in: batchIds } }, { remarks: contains(q) }];
  }

  const total = await ctx.count('dispatch_records', filter);
  const rows = await ctx.find('dispatch_records', filter, {
    sort: { created_at: -1 },
    skip: offset,
    limit,
    projection: { _id: 0 },
  });
  const items = await enrichDispatchRecords(ctx, rows, { withOrderStatus: true });

  res.json({ items, total, page, limit, pages: Math.ceil(total / limit) });
}

export async function stats(req: Request, res: Response): Promise<void> {
  const user = req.user!;
  const personal = personalOnly(req);
  const ctx = await getContext();

  const recordFilter = personal ? { dispatcher_id: user.userId } : {};
  const totalDispatches = await ctx.count('dispatch_records', recordFilter);
  const dispatchedToday = await ctx.count('dispatch_records', {
    ...recordFilter,
    created_at: { $gte: startOfDay() },
  });
  const dispatchedThisWeek = await ctx.count('dispatch_records', {
    ...recordFilter,
    created_at: { $gte: startOfWeek() },
  });
  const readyToDispatch = await ctx.count('batches', { status: 'QC_PASSED' });

  const orderFilter: Record<string, any> = personal ? { raised_by: user.userId } : {};
  const pendingOrdersCount = await ctx.count('dispatch_orders', { ...orderFilter, status: 'PENDING' });

  const approvedBatches = await ctx.find('batches', { status: 'DISPATCH_APPROVED' }, { projection: { id: 1 } });
  const approvedFilter: Record<string, any> = {
    ...orderFilter,
    status: 'APPROVED',
    dispatched_at: null,
    batch_id: { $in: approvedBatches.map((batch) => Number(batch.id)) },
  };
  const approvedOrdersCount = await ctx.count('dispatch_orders', approvedFilter);

  const readyBatchesRaw = await ctx.find('batches', { status: 'QC_PASSED' }, {
    sort: { updated_at: 1 },
    limit: 10,
    projection: { _id: 0 },
  });
  const pendingOrdersRaw = await ctx.find('dispatch_orders', { ...orderFilter, status: 'PENDING' }, {
    sort: { created_at: 1 },
    limit: 10,
    projection: { _id: 0 },
  });
  const approvedOrdersRaw = await ctx.find('dispatch_orders', approvedFilter, {
    sort: { updated_at: 1 },
    limit: 10,
    projection: { _id: 0 },
  });
  const recentRecordsRaw = await ctx.find('dispatch_records', recordFilter, {
    sort: { created_at: -1 },
    limit: 20,
    projection: { _id: 0 },
  });
  const todayRecordsRaw = await ctx.find('dispatch_records', {
    ...recordFilter,
    created_at: { $gte: startOfDay() },
  }, {
    sort: { created_at: -1 },
    projection: { _id: 0 },
  });

  const [readyBatches, pendingOrdersList, approvedOrdersList, recentRecords, todayRecords] = await Promise.all([
    enrichReadyBatches(ctx, readyBatchesRaw),
    enrichOrders(ctx, pendingOrdersRaw),
    enrichOrders(ctx, approvedOrdersRaw),
    enrichDispatchRecords(ctx, recentRecordsRaw, { withDispatcherName: true }),
    enrichDispatchRecords(ctx, todayRecordsRaw, { withDispatcherName: true }),
  ]);

  res.json({
    scope: personal ? 'mine' : 'all',
    totalDispatches,
    dispatchedToday,
    dispatchedThisWeek,
    readyToDispatch,
    pendingOrders: pendingOrdersCount,
    approvedOrders: approvedOrdersCount,
    myDispatchedToday: dispatchedToday,
    myTotalDispatches: totalDispatches,
    readyBatches,
    pendingOrdersList,
    approvedOrdersList,
    recentRecords,
    todayRecords,
  });
}
