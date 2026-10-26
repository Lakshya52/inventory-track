import { Request, Response } from 'express';
import { DbContext, getContext, idKey, startOfDay } from '../config/database';
import { mapByIds } from '../services/queryService';

async function enrichBatches(ctx: DbContext, batches: Record<string, any>[]): Promise<Record<string, any>[]> {
  const products = await mapByIds<Record<string, any>>(
    ctx,
    'products',
    batches.map((batch) => batch.product_id)
  );
  return batches.map((batch) => {
    const product = products.get(idKey(batch.product_id));
    return {
      ...batch,
      product_name: product?.name ?? null,
      product_sku: product?.sku ?? null,
    };
  });
}

async function inventoryTotals(ctx: DbContext): Promise<{ qty: number; value: number }> {
  const rows = await ctx.aggregate('products', [
    {
      $group: {
        _id: null,
        qty: { $sum: { $ifNull: ['$quantity', 0] } },
        value: {
          $sum: {
            $multiply: [{ $ifNull: ['$quantity', 0] }, { $ifNull: ['$price', 0] }],
          },
        },
      },
    },
  ]);
  return { qty: Number(rows[0]?.qty || 0), value: Number(rows[0]?.value || 0) };
}

export async function stats(_req: Request, res: Response): Promise<void> {
  const ctx = await getContext();
  const inventory = await inventoryTotals(ctx);

  const [
    totalProducts,
    totalBatches,
    pendingQc,
    qcPassed,
    qcFailed,
    dispatchedToday,
    pendingDispatchOrders,
    activeClients,
    totalLocations,
    recentActivity,
    recentBatchesRaw,
    inProduction,
    needsFix,
    awaitingApproval,
    approvedReady,
  ] = await Promise.all([
    ctx.count('products'),
    ctx.count('batches'),
    ctx.count('batches', { status: { $in: ['CREATED', 'QC_PASSED'] } }),
    ctx.count('batches', { status: 'QC_PASSED' }),
    ctx.count('batches', { status: 'QC_FAILED' }),
    ctx.count('dispatch_records', { created_at: { $gte: startOfDay() } }),
    ctx.count('dispatch_orders', { status: 'PENDING' }),
    ctx.count('clients', { is_active: 1 }),
    ctx.count('shelf_locations', { is_active: 1 }),
    ctx.find('activity_logs', {}, { sort: { created_at: -1 }, limit: 10, projection: { _id: 0 } }),
    ctx.find('batches', {}, { sort: { created_at: -1 }, limit: 10, projection: { _id: 0 } }),
    ctx.count('batches', { status: 'CREATED' }),
    ctx.count('batches', { status: 'QC_FAILED' }),
    ctx.count('batches', { status: 'DISPATCH_ORDER_RAISED' }),
    ctx.count('batches', { status: 'DISPATCH_APPROVED' }),
  ]);

  const recentBatches = await enrichBatches(ctx, recentBatchesRaw);

  res.json({
    totalProducts,
    totalBatches,
    pendingQc,
    qcPassed,
    qcFailed,
    dispatchedToday,
    currentInventory: inventory.qty,
    inventoryValue: inventory.value,
    pendingDispatchOrders,
    activeClients,
    totalLocations,
    productionStats: { in_production: inProduction, needs_fix: needsFix },
    dispatchQueueStats: { awaiting_approval: awaitingApproval, approved_ready: approvedReady },
    recentActivity,
    recentBatches,
  });
}

export async function adminStats(_req: Request, res: Response): Promise<void> {
  const ctx = await getContext();
  const inventory = await inventoryTotals(ctx);

  const [
    totalBatches,
    pendingQc,
    qcTotal,
    qcPassed,
    qcFailed,
    dispatchTotal,
    dispatchedToday,
    requestTotal,
    requestPending,
    requestApproved,
    requestRejected,
    totalLocations,
    activeLocations,
    adminCount,
    qcUserCount,
    dispatchUserCount,
    activeAdminCount,
    activeQcCount,
    activeDispatchCount,
  ] = await Promise.all([
    ctx.count('batches'),
    ctx.count('batches', { status: 'CREATED' }),
    ctx.count('qc_records'),
    ctx.count('qc_records', { result: 'PASS' }),
    ctx.count('qc_records', { result: 'FAIL' }),
    ctx.count('dispatch_records'),
    ctx.count('dispatch_records', { created_at: { $gte: startOfDay() } }),
    ctx.count('dispatch_orders'),
    ctx.count('dispatch_orders', { status: 'PENDING' }),
    ctx.count('dispatch_orders', { status: 'APPROVED' }),
    ctx.count('dispatch_orders', { status: 'REJECTED' }),
    ctx.count('shelf_locations'),
    ctx.count('shelf_locations', { is_active: 1 }),
    ctx.count('admins'),
    ctx.count('qc_users'),
    ctx.count('dispatch_users'),
    ctx.count('admins', { is_active: 1 }),
    ctx.count('qc_users', { is_active: 1 }),
    ctx.count('dispatch_users', { is_active: 1 }),
  ]);

  const [recentQcRaw, recentDispatchesRaw, pendingRequestsRaw, recentActivity] = await Promise.all([
    ctx.find('qc_records', {}, { sort: { created_at: -1 }, limit: 5, projection: { _id: 0 } }),
    ctx.find('dispatch_records', {}, { sort: { created_at: -1 }, limit: 5, projection: { _id: 0 } }),
    ctx.find('dispatch_orders', { status: 'PENDING' }, { sort: { created_at: -1 }, limit: 5, projection: { _id: 0 } }),
    ctx.find('activity_logs', {}, { sort: { created_at: -1 }, limit: 8, projection: { _id: 0 } }),
  ]);

  const [recentQc, recentDispatches, pendingRequests] = await Promise.all([
    enrichQc(ctx, recentQcRaw),
    enrichDispatches(ctx, recentDispatchesRaw),
    enrichPendingRequests(ctx, pendingRequestsRaw),
  ]);

  const passRate = qcTotal > 0 ? Math.round((qcPassed / qcTotal) * 100) : 0;

  res.json({
    stats: {
      totalProducts: await ctx.count('products'),
      inventoryQty: inventory.qty,
      inventoryValue: inventory.value,
      totalBatches,
      pendingQc,
      qcTotal,
      qcPassed,
      qcFailed,
      qcPassRate: passRate,
      dispatchTotal,
      dispatchedToday,
      totalRequests: requestTotal,
      pendingRequests: requestPending,
      approvedRequests: requestApproved,
      rejectedRequests: requestRejected,
      totalLocations,
      activeLocations,
      totalUsers: adminCount + qcUserCount + dispatchUserCount,
      activeUsers: activeAdminCount + activeQcCount + activeDispatchCount,
    },
    recentQc,
    recentDispatches,
    pendingRequests,
    recentActivity,
  });
}

async function enrichQc(ctx: DbContext, records: Record<string, any>[]): Promise<Record<string, any>[]> {
  const batches = await mapByIds<Record<string, any>>(ctx, 'batches', records.map((record) => idKey(record.batch_id)));
  const products = await mapByIds<Record<string, any>>(
    ctx,
    'products',
    [...batches.values()].map((batch) => idKey(batch.product_id))
  );
  return records.map((record) => {
    const batch = batches.get(idKey(record.batch_id));
    const product = batch ? products.get(idKey(batch.product_id)) : undefined;
    return {
      id: record.id,
      result: record.result,
      remarks: record.remarks,
      created_at: record.created_at,
      batch_number: batch?.batch_number ?? null,
      product_name: product?.name ?? null,
      product_sku: product?.sku ?? null,
    };
  });
}

async function enrichDispatches(ctx: DbContext, records: Record<string, any>[]): Promise<Record<string, any>[]> {
  const batches = await mapByIds<Record<string, any>>(ctx, 'batches', records.map((record) => idKey(record.batch_id)));
  const products = await mapByIds<Record<string, any>>(
    ctx,
    'products',
    [...batches.values()].map((batch) => idKey(batch.product_id))
  );
  return records.map((record) => {
    const batch = batches.get(idKey(record.batch_id));
    const product = batch ? products.get(idKey(batch.product_id)) : undefined;
    return {
      id: record.id,
      remarks: record.remarks,
      created_at: record.created_at,
      batch_number: batch?.batch_number ?? null,
      product_name: product?.name ?? null,
      product_sku: product?.sku ?? null,
    };
  });
}

async function enrichPendingRequests(ctx: DbContext, orders: Record<string, any>[]): Promise<Record<string, any>[]> {
  const batches = await mapByIds<Record<string, any>>(ctx, 'batches', orders.map((order) => idKey(order.batch_id)));
  const products = await mapByIds<Record<string, any>>(
    ctx,
    'products',
    [...batches.values()].map((batch) => idKey(batch.product_id))
  );
  const raisedBy = await mapByIds<Record<string, any>>(
    ctx,
    'dispatch_users',
    orders.map((order) => idKey(order.raised_by))
  );
  return orders.map((order) => {
    const batch = batches.get(idKey(order.batch_id));
    const product = batch ? products.get(idKey(batch.product_id)) : undefined;
    return {
      id: order.id,
      status: order.status,
      created_at: order.created_at,
      batch_number: batch?.batch_number ?? null,
      quantity: batch?.quantity ?? null,
      uom: batch?.uom ?? null,
      product_name: product?.name ?? null,
      product_sku: product?.sku ?? null,
      raised_by_name: raisedBy.get(idKey(order.raised_by))?.name ?? 'Unknown',
    };
  });
}
