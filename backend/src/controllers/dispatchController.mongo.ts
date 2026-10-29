import { Request, Response } from 'express';
import { DbContext, getContext, idKey, startOfDay, startOfWeek } from '../config/database';
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
    records.map((record) => record.batch_id)
  );
  const products = await mapByIds<Record<string, any>>(
    ctx,
    'products',
    [...batches.values()].map((batch) => batch.product_id)
  );
  const vendors = await mapByIds<Record<string, any>>(ctx, 'vendors', [...batches.values()].map((batch) => batch.vendor_id));
  const grades = await mapByIds<Record<string, any>>(ctx, 'grades', [...batches.values()].map((batch) => batch.grade_id));
  const bagQuantities = await mapByIds<Record<string, any>>(ctx, 'bag_quantities', [...batches.values()].map((batch) => batch.bag_quantity_id));
  const dispatchers = options.withDispatcherName
    ? await mapNames(ctx, 'dispatch_users', records.map((record) => record.dispatcher_id))
    : new Map<string, string>();
  const orderIds = records
    .map((record) => record.dispatch_order_id)
    .filter((id) => id !== null && id !== undefined);
  const orders = options.withOrderStatus && orderIds.length > 0
    ? await mapByIds<Record<string, any>>(ctx, 'dispatch_orders', orderIds)
    : new Map<string, Record<string, any>>();

  return records.map((record) => {
    const batch = batches.get(idKey(record.batch_id));
    const product = batch ? products.get(idKey(batch.product_id)) : undefined;
    return {
      ...record,
      batch_number: batch?.batch_number ?? null,
      barcode_value: batch?.barcode_value ?? null,
      product_name: product?.name ?? null,
      product_sku: product?.sku ?? null,
      vendor_name: vendors.get(idKey(batch?.vendor_id))?.name ?? null,
      grade_name: grades.get(idKey(batch?.grade_id))?.name ?? product?.grade ?? null,
      bag_quantity_name: bagQuantities.get(idKey(batch?.bag_quantity_id))?.name ?? null,
      bag_quantity: bagQuantities.get(idKey(batch?.bag_quantity_id))?.quantity ?? null,
      bag_quantity_unit: bagQuantities.get(idKey(batch?.bag_quantity_id))?.unit ?? null,
      ...(options.withDispatcherName
        ? { dispatcher_name: dispatchers.get(idKey(record.dispatcher_id)) ?? null }
        : {}),
      ...(options.withOrderStatus
        ? {
            order_status: record.dispatch_order_id
              ? orders.get(idKey(record.dispatch_order_id))?.status ?? null
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
    orders.map((order) => order.batch_id)
  );
  const products = await mapByIds<Record<string, any>>(
    ctx,
    'products',
    [...batches.values()].map((batch) => batch.product_id)
  );
  const vendors = await mapByIds<Record<string, any>>(ctx, 'vendors', [...batches.values()].map((batch) => batch.vendor_id));
  const grades = await mapByIds<Record<string, any>>(ctx, 'grades', [...batches.values()].map((batch) => batch.grade_id));
  const bagQuantities = await mapByIds<Record<string, any>>(ctx, 'bag_quantities', [...batches.values()].map((batch) => batch.bag_quantity_id));
  const raisedBy = await mapNames(ctx, 'dispatch_users', orders.map((order) => order.raised_by));
  const approvers = await Promise.all(orders.map(async (order) => {
    if (order.approved_by_role === 'QC') {
      const user = await ctx.findOne('qc_users', { id: order.approved_by_id }, { projection: { _id: 0, name: 1 } });
      return [idKey(order.id), user?.name ?? null] as const;
    }
    const user = order.admin_id
      ? await ctx.findOne('admins', { id: order.admin_id }, { projection: { _id: 0, name: 1 } })
      : null;
    return [idKey(order.id), user?.name ?? null] as const;
  }));
  const clients = await mapNames(ctx, 'clients', orders.map((order) => order.client_id));
  const approverNames = new Map(approvers);
  const qrStats = await batchQrStats(ctx, orders.map((order) => order.batch_id));

  return orders.map((order) => {
    const batch = batches.get(idKey(order.batch_id));
    const product = batch ? products.get(idKey(batch.product_id)) : undefined;
    return {
      ...order,
      batch_number: batch?.batch_number ?? null,
      barcode_value: batch?.barcode_value ?? null,
      quantity: batch?.quantity ?? null,
      uom: batch?.uom ?? null,
      batch_status: batch?.status ?? null,
      storage_location: batch?.storage_location ?? null,
      vendor_name: vendors.get(idKey(batch?.vendor_id))?.name ?? null,
      grade_name: grades.get(idKey(batch?.grade_id))?.name ?? product?.grade ?? null,
      bag_quantity_name: bagQuantities.get(idKey(batch?.bag_quantity_id))?.name ?? null,
      bag_quantity: bagQuantities.get(idKey(batch?.bag_quantity_id))?.quantity ?? null,
      bag_quantity_unit: bagQuantities.get(idKey(batch?.bag_quantity_id))?.unit ?? null,
      qr_count: qrStats.get(idKey(order.batch_id))?.count ?? 0,
      product_name: product?.name ?? null,
      product_sku: product?.sku ?? null,
      raised_by_name: raisedBy.get(idKey(order.raised_by)) ?? null,
      admin_name: approverNames.get(idKey(order.id)) ?? null,
      approver_name: approverNames.get(idKey(order.id)) ?? null,
      client_name: clients.get(idKey(order.client_id)) ?? null,
    };
  });
}

async function enrichReadyBatches(ctx: DbContext, batches: Record<string, any>[]): Promise<Record<string, any>[]> {
  const products = await mapByIds<Record<string, any>>(
    ctx,
    'products',
    batches.map((batch) => batch.product_id)
  );
  return batches.map((batch) => {
    const product = products.get(idKey(batch.product_id));
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

export async function submit(_req: Request, res: Response): Promise<void> {
  // SRS v2 completes dispatch through a loading session with a seal number.
  res.status(410).json({
    error: 'Direct dispatch submission is retired. Start a loading session and finalise with a seal number.',
  });
}

export async function submitBulk(_req: Request, res: Response): Promise<void> {
  // SRS v2 completes dispatch through a loading session with a seal number.
  res.status(410).json({
    error: 'Bulk dispatch submission is retired. Start a loading session and finalise with a seal number.',
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
    batch_id: { $in: approvedBatches.map((batch) => idKey(batch.id)) },
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
  const qcPassedBatches = await ctx.find('batches', { status: 'QC_PASSED' }, {
    sort: { updated_at: 1 },
    projection: { _id: 0 },
  });
  const qcPassedBatchIds = qcPassedBatches.map((batch) => idKey(batch.id));
  const labels = qcPassedBatchIds.length > 0
    ? await ctx.find('qr_labels', { batch_id: { $in: qcPassedBatchIds } }, {
      projection: { _id: 0, batch_id: 1 },
    })
    : [];
  const qrCounts = new Map<string, number>();
  labels.forEach((label) => {
    const batchId = idKey(label.batch_id);
    qrCounts.set(batchId, (qrCounts.get(batchId) || 0) + 1);
  });
  const dispatchReadyBatches = qcPassedBatches.filter(
    (batch) => (qrCounts.get(idKey(batch.id)) || 0) === Number(batch.quantity)
  );
  const readyToDispatch = dispatchReadyBatches.length;

  const orderFilter: Record<string, any> = personal ? { raised_by: user.userId } : {};
  const pendingOrdersCount = await ctx.count('dispatch_orders', { ...orderFilter, status: 'PENDING' });

  const approvedBatches = await ctx.find('batches', { status: 'DISPATCH_APPROVED' }, { projection: { id: 1 } });
  const approvedFilter: Record<string, any> = {
    ...orderFilter,
    status: 'APPROVED',
    dispatched_at: null,
    batch_id: { $in: approvedBatches.map((batch) => idKey(batch.id)) },
  };
  const approvedOrdersCount = await ctx.count('dispatch_orders', approvedFilter);

  const readyBatchesRaw = dispatchReadyBatches.slice(0, 10);
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

  const [readyBatchList, pendingOrdersList, approvedOrdersList, recentRecords, todayRecords] = await Promise.all([
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
    readyBatches: readyBatchList,
    pendingOrdersList,
    approvedOrdersList,
    recentRecords,
    todayRecords,
  });
}
