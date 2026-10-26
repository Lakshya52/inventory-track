import { Request, Response } from 'express';
import { DbContext, daysAgo, getContext, idKey, startOfDay } from '../config/database';
import { applyOperation, registerDevice, touchDeviceSync } from '../services/syncService';
import { SyncOperationInput } from '../types';
import { batchAgeMinutes, batchQrValues, mapByIds, mapNames } from '../services/queryService';

function parseCursor(value: unknown): number {
  if (value === undefined || value === null || value === '') return 0;
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, value);
  const text = String(value);
  const numeric = Number(text);
  if (Number.isFinite(numeric)) return Math.max(0, numeric);
  const parsed = new Date(text).getTime();
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

function parseLimit(value: unknown, fallback = 500): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(Math.floor(parsed), 1), 1000);
}

function updatedMs(value: unknown): number {
  if (!value) return 0;
  const date = value instanceof Date ? value : new Date(String(value));
  const ms = date.getTime();
  return Number.isFinite(ms) ? ms : 0;
}

function lastUpdatedMs(rows: Record<string, any>[], fallback: number): number {
  let max = fallback;
  for (const row of rows) {
    const value = Number(row._updated_ms);
    if (Number.isFinite(value) && value > max) max = value;
  }
  return max;
}

type PullPage = { rows: Record<string, any>[]; hasMore: boolean; lastMs: number };

async function rowsForPull(
  ctx: DbContext,
  collection: string,
  filter: Record<string, any>,
  field: string,
  limit: number
): Promise<PullPage> {
  const rows = await ctx.find(collection, filter, {
    sort: { [field]: 1 },
    limit,
    projection: { _id: 0 },
  });
  const decorated = rows.map((row) => ({ ...row, _updated_ms: updatedMs(row[field]) }));
  return {
    rows: decorated,
    hasMore: rows.length >= limit,
    lastMs: lastUpdatedMs(decorated, 0),
  };
}

async function enrichBatches(ctx: DbContext, batches: Record<string, any>[]): Promise<Record<string, any>[]> {
  const products = await mapByIds<Record<string, any>>(
    ctx,
    'products',
    batches.map((batch) => idKey(batch.product_id))
  );
  const locations = await mapByIds<Record<string, any>>(
    ctx,
    'shelf_locations',
    batches.map((batch) => batch.shelf_location_id)
  );
  const qrValues = await batchQrValues(ctx, batches.map((batch) => idKey(batch.id)));

  return batches.map((batch) => {
    const product = products.get(idKey(batch.product_id));
    const location = locations.get(idKey(batch.shelf_location_id));
    return {
      ...batch,
      product_name: product?.name ?? null,
      product_sku: product?.sku ?? null,
      cas_number: product?.cas_number ?? null,
      molecular_formula: product?.molecular_formula ?? null,
      product_grade: product?.grade ?? null,
      product_purity: product?.purity ?? null,
      hazard_classification: product?.hazard_classification ?? null,
      storage_conditions: product?.storage_conditions ?? null,
      manufacturer: product?.manufacturer ?? null,
      physical_state: product?.physical_state ?? null,
      hsn_code: product?.hsn_code ?? null,
      product_price: product?.price ?? null,
      location_code: location?.location_code ?? null,
      unit_qr_codes: qrValues.get(idKey(batch.id)) || [],
    };
  });
}

async function enrichQcRecords(ctx: DbContext, records: Record<string, any>[]): Promise<Record<string, any>[]> {
  const batches = await mapByIds<Record<string, any>>(
    ctx,
    'batches',
    records.map((record) => idKey(record.batch_id))
  );
  const products = await mapByIds<Record<string, any>>(
    ctx,
    'products',
    [...batches.values()].map((batch) => idKey(batch.product_id))
  );
  return records.map((record) => {
    const batch = batches.get(idKey(record.batch_id));
    const product = batch ? products.get(idKey(batch.product_id)) : undefined;
    return {
      ...record,
      batch_number: batch?.batch_number ?? null,
      barcode_value: batch?.barcode_value ?? null,
      product_name: product?.name ?? null,
    };
  });
}

async function enrichDispatchOrders(ctx: DbContext, orders: Record<string, any>[]): Promise<Record<string, any>[]> {
  const batches = await mapByIds<Record<string, any>>(
    ctx,
    'batches',
    orders.map((order) => idKey(order.batch_id))
  );
  const products = await mapByIds<Record<string, any>>(
    ctx,
    'products',
    [...batches.values()].map((batch) => idKey(batch.product_id))
  );
  const raisedBy = await mapNames(ctx, 'dispatch_users', orders.map((order) => idKey(order.raised_by)));
  const clients = await mapNames(ctx, 'clients', orders.map((order) => idKey(order.client_id)));

  return orders.map((order) => {
    const batch = batches.get(idKey(order.batch_id));
    const product = batch ? products.get(idKey(batch.product_id)) : undefined;
    return {
      ...order,
      batch_number: batch?.batch_number ?? null,
      barcode_value: batch?.barcode_value ?? null,
      product_name: product?.name ?? null,
      product_sku: product?.sku ?? null,
      raised_by_name: raisedBy.get(idKey(order.raised_by)) ?? null,
      client_name: clients.get(idKey(order.client_id)) ?? null,
    };
  });
}

async function enrichDispatchRecords(ctx: DbContext, records: Record<string, any>[]): Promise<Record<string, any>[]> {
  const batches = await mapByIds<Record<string, any>>(
    ctx,
    'batches',
    records.map((record) => idKey(record.batch_id))
  );
  const products = await mapByIds<Record<string, any>>(
    ctx,
    'products',
    [...batches.values()].map((batch) => idKey(batch.product_id))
  );
  return records.map((record) => {
    const batch = batches.get(idKey(record.batch_id));
    const product = batch ? products.get(idKey(batch.product_id)) : undefined;
    return {
      ...record,
      batch_number: batch?.batch_number ?? null,
      barcode_value: batch?.barcode_value ?? null,
      product_name: product?.name ?? null,
    };
  });
}

async function workQueue(
  ctx: DbContext,
  role: string
): Promise<Record<string, any>[]> {
  let filter: Record<string, any>;
  let sortField: string;
  if (role === 'QC') {
    filter = { status: 'CREATED' };
    sortField = 'created_at';
  } else if (role === 'DISPATCH') {
    filter = { status: { $in: ['QC_PASSED', 'DISPATCH_REJECTED', 'DISPATCH_APPROVED'] } };
    sortField = 'updated_at';
  } else {
    filter = { status: { $in: ['CREATED', 'QC_PASSED', 'DISPATCH_ORDER_RAISED', 'DISPATCH_APPROVED'] } };
    sortField = 'updated_at';
  }

  const batches = await ctx.find('batches', filter, {
    sort: { [sortField]: 1 },
    limit: 200,
    projection: { _id: 0 },
  });
  const products = await mapByIds<Record<string, any>>(
    ctx,
    'products',
    batches.map((batch) => idKey(batch.product_id))
  );

  return batches.map((batch) => {
    const product = products.get(idKey(batch.product_id));
    const base: Record<string, any> = {
      ...batch,
      product_name: product?.name ?? null,
      product_sku: product?.sku ?? null,
      age_minutes: batchAgeMinutes(batch[sortField]),
    };
    if (role === 'QC') {
      base.cas_number = product?.cas_number ?? null;
      base.molecular_formula = product?.molecular_formula ?? null;
      base.product_grade = product?.grade ?? null;
      base.product_purity = product?.purity ?? null;
      base.hazard_classification = product?.hazard_classification ?? null;
      base.storage_conditions = product?.storage_conditions ?? null;
    }
    return base;
  });
}

export async function register(req: Request, res: Response): Promise<void> {
  if (!req.user) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }
  const device = await registerDevice(req.user, req.body || {});
  console.info('[sync] device registered', JSON.stringify({
    request_id: (req as Request & { requestId?: string }).requestId || null,
    user_role: req.user.role,
    user_id: req.user.userId,
    device_uuid: device.device_uuid,
  }));
  res.json({ ...device, server_time: new Date().toISOString() });
}

export async function push(req: Request, res: Response): Promise<void> {
  if (!req.user) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }
  const operations = Array.isArray(req.body?.operations) ? req.body.operations : null;
  if (!operations) {
    res.status(400).json({ error: 'operations must be an array' });
    return;
  }
  if (operations.length > 100) {
    res.status(413).json({ error: 'A maximum of 100 operations can be pushed at once' });
    return;
  }

  const deviceUuid = typeof req.body?.device_uuid === 'string' ? req.body.device_uuid : null;
  const results = [];
  for (const raw of operations) {
    try {
      results.push(await applyOperation(req.user, deviceUuid, raw as SyncOperationInput));
    } catch (error) {
      results.push({
        operation_id: raw?.operation_id || null,
        status: 'FAILED',
        entity_type: null,
        entity_id: null,
        error: error instanceof Error ? error.message : 'Unexpected sync error',
        error_code: 'INTERNAL_ERROR',
      });
    }
  }

  const failed = results.filter((result) => result.status === 'FAILED').length;
  const conflicts = results.filter((result) => result.status === 'CONFLICT').length;
  await touchDeviceSync(deviceUuid, 'push', failed || conflicts ? `${failed} failed, ${conflicts} conflicts` : null);

  const operationIssues = results
    .filter((result) => result.status === 'FAILED' || result.status === 'CONFLICT')
    .map((result) => ({
      operation_id: result.operation_id,
      status: result.status,
      error_code: result.error_code,
      error: result.error,
    }));
  console.info('[sync] push completed', JSON.stringify({
    request_id: (req as Request & { requestId?: string }).requestId || null,
    user_role: req.user.role,
    user_id: req.user.userId,
    device_uuid: deviceUuid,
    received: operations.length,
    applied: results.filter((result) => result.status === 'APPLIED').length,
    duplicates: results.filter((result) => result.status === 'DUPLICATE').length,
    conflicts,
    failed,
    operation_issues: operationIssues,
  }));

  res.json({
    results,
    applied: results.filter((result) => result.status === 'APPLIED').length,
    duplicates: results.filter((result) => result.status === 'DUPLICATE').length,
    conflicts,
    failed,
    server_time: new Date().toISOString(),
  });
}

export async function pull(req: Request, res: Response): Promise<void> {
  if (!req.user) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }
  const user = req.user;
  const since = parseCursor(req.query.since);
  const limit = parseLimit(req.query.limit, 500);
  const querySince = Math.max(0, since - 5000);
  const deviceUuid = typeof req.query.device_uuid === 'string' ? req.query.device_uuid : null;
  const ctx = await getContext();

  const products = await rowsForPull(ctx, 'products', { updated_at: { $gt: new Date(querySince) } }, 'updated_at', limit);
  const locations = await rowsForPull(ctx, 'shelf_locations', { updated_at: { $gt: new Date(querySince) } }, 'updated_at', limit);
  const clients = await rowsForPull(ctx, 'clients', { updated_at: { $gt: new Date(querySince) } }, 'updated_at', limit);

  const batchRows = await ctx.find('batches', { updated_at: { $gt: new Date(querySince) } }, {
    sort: { updated_at: 1 },
    limit,
    projection: { _id: 0 },
  });
  const enrichedBatchRows = (await enrichBatches(ctx, batchRows))
    .map((batch) => ({ ...batch, _updated_ms: updatedMs(batch.updated_at) }));
  const batches: PullPage = {
    rows: enrichedBatchRows,
    hasMore: batchRows.length >= limit,
    lastMs: lastUpdatedMs(enrichedBatchRows, 0),
  };

  let qcRecords: PullPage = { rows: [], hasMore: false, lastMs: 0 };
  if (user.role === 'QC' || user.role === 'ADMIN') {
    const filter: Record<string, any> = { created_at: { $gt: new Date(querySince) } };
    if (user.role === 'QC') filter.tester_id = user.userId;
    const page = await rowsForPull(ctx, 'qc_records', filter, 'created_at', limit);
    qcRecords = { ...page, rows: await enrichQcRecords(ctx, page.rows) };
  }

  let dispatchOrders: PullPage = { rows: [], hasMore: false, lastMs: 0 };
  if (user.role === 'DISPATCH' || user.role === 'ADMIN') {
    const filter: Record<string, any> = { updated_at: { $gt: new Date(querySince) } };
    if (user.role === 'DISPATCH') filter.raised_by = user.userId;
    const page = await rowsForPull(ctx, 'dispatch_orders', filter, 'updated_at', limit);
    dispatchOrders = { ...page, rows: await enrichDispatchOrders(ctx, page.rows) };
  }

  let dispatchRecords: PullPage = { rows: [], hasMore: false, lastMs: 0 };
  if (user.role === 'DISPATCH' || user.role === 'ADMIN') {
    const filter: Record<string, any> = { created_at: { $gt: new Date(querySince) } };
    if (user.role === 'DISPATCH') filter.dispatcher_id = user.userId;
    const page = await rowsForPull(ctx, 'dispatch_records', filter, 'created_at', limit);
    dispatchRecords = { ...page, rows: await enrichDispatchRecords(ctx, page.rows) };
  }

  const workQueueRows = await workQueue(ctx, user.role);

  let myOrders: Record<string, any>[] = [];
  if (user.role === 'DISPATCH' || user.role === 'ADMIN') {
    const filter: Record<string, any> = {
      status: { $in: ['PENDING', 'APPROVED'] },
      dispatched_at: null,
    };
    if (user.role === 'DISPATCH') filter.raised_by = user.userId;
    const orders = await ctx.find('dispatch_orders', filter, {
      sort: { created_at: -1 },
      limit: 100,
      projection: { _id: 0 },
    });
    myOrders = await enrichDispatchOrders(ctx, orders);
  }

  const [pendingQcCount, readyCount, pendingOrderCount, myTestsToday, myDispatchesToday] = await Promise.all([
    ctx.count('batches', { status: 'CREATED' }),
    ctx.count('batches', { status: { $in: ['QC_PASSED', 'DISPATCH_REJECTED'] } }),
    ctx.count('dispatch_orders', { status: 'PENDING' }),
    ctx.count('qc_records', { tester_id: user.userId, created_at: { $gte: startOfDay() } }),
    ctx.count('dispatch_records', { dispatcher_id: user.userId, created_at: { $gte: startOfDay() } }),
  ]);

  const pages = [products, locations, clients, batches, qcRecords, dispatchOrders, dispatchRecords];
  const hasMore = pages.some((page) => page.hasMore);
  const maxLast = Math.max(
    since,
    products.lastMs,
    locations.lastMs,
    clients.lastMs,
    batches.lastMs,
    qcRecords.lastMs,
    dispatchOrders.lastMs,
    dispatchRecords.lastMs
  );
  const limitedLast = pages
    .filter((page) => page.hasMore && page.lastMs > 0)
    .map((page) => page.lastMs);
  const cursor = hasMore && limitedLast.length > 0
    ? Math.max(since, Math.min(...limitedLast) - 1)
    : maxLast;

  await touchDeviceSync(deviceUuid, 'pull', null);

  console.info('[sync] pull completed', JSON.stringify({
    request_id: (req as Request & { requestId?: string }).requestId || null,
    user_role: user.role,
    user_id: user.userId,
    device_uuid: deviceUuid,
    since,
    cursor,
    has_more: hasMore,
    products: products.rows.length,
    shelf_locations: locations.rows.length,
    clients: clients.rows.length,
    batches: batches.rows.length,
    qc_records: qcRecords.rows.length,
    dispatch_orders: dispatchOrders.rows.length,
    dispatch_records: dispatchRecords.rows.length,
  }));

  res.json({
    server_time: new Date().toISOString(),
    cursor,
    since,
    has_more: hasMore,
    role: user.role,
    products: products.rows,
    shelf_locations: locations.rows,
    clients: clients.rows,
    batches: batches.rows,
    qc_records: qcRecords.rows,
    dispatch_orders: dispatchOrders.rows,
    dispatch_records: dispatchRecords.rows,
    work_queue: workQueueRows,
    my_orders: myOrders,
    counts: {
      pending_qc: pendingQcCount,
      ready_to_dispatch: readyCount,
      pending_orders: pendingOrderCount,
      my_tests_today: myTestsToday,
      my_dispatches_today: myDispatchesToday,
    },
  });
}

export async function status(req: Request, res: Response): Promise<void> {
  if (!req.user) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }
  const deviceUuid = typeof req.query.device_uuid === 'string' ? req.query.device_uuid : null;
  const ctx = await getContext();

  const [device, syncState, operationCounts] = await Promise.all([
    deviceUuid
      ? ctx.findOne('devices', { device_uuid: deviceUuid }, { projection: { _id: 0 } })
      : null,
    deviceUuid
      ? ctx.findOne('device_sync_state', { device_uuid: deviceUuid }, { projection: { _id: 0 } })
      : null,
    ctx.aggregate('sync_operations', [
      {
        $match: {
          user_role: req.user.role,
          user_id: req.user.userId,
          server_timestamp: { $gt: daysAgo(7) },
        },
      },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]),
  ]);

  res.json({
    server_time: new Date().toISOString(),
    device: device || null,
    sync_state: syncState || null,
    operation_counts: operationCounts.map((row) => ({
      status: row._id,
      count: Number(row.count || 0),
    })),
  });
}

export async function uploadAttachments(req: Request, res: Response): Promise<void> {
  const files = (req.files as Express.Multer.File[]) || [];
  if (files.length === 0) {
    res.status(400).json({ error: 'At least one image is required' });
    return;
  }
  res.json({
    files: files.map((file) => ({
      filename: file.filename,
      url: `/uploads/${file.filename}`,
      size: file.size,
      mime_type: file.mimetype,
    })),
  });
}
