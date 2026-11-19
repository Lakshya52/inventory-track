import { Request, Response } from 'express';
import { DbContext, getContext, idKey, startOfDay } from '../config/database';
import { mapByIds } from '../services/queryService';
import { divisionFilter } from '../utils/division';

async function enrichBatches(ctx: DbContext, batches: Record<string, any>[], tenantId: string | number, divisionScope?: Record<string, any>): Promise<Record<string, any>[]> {
  const products = await mapByIds<Record<string, any>>(
    ctx,
    'products',
    batches.map((batch) => batch.product_id),
    tenantId,
    divisionScope
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

async function inventoryTotals(ctx: DbContext, tenantId: string | number, divisionScope?: Record<string, any>): Promise<{ qty: number; value: number }> {
  const rows = await ctx.aggregate('products', [
    { $match: { tenant_id: tenantId, is_active: 1, ...(divisionScope ?? {}) } },
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

export async function stats(req: Request, res: Response): Promise<void> {
  const tenantId = req.user!.tenantId;
  const ctx = await getContext();
  const division = divisionFilter(req);
  const inventory = await inventoryTotals(ctx, tenantId, division);

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
    ctx.count('products', { tenant_id: tenantId, is_active: 1, ...division }),
    ctx.count('batches', { tenant_id: tenantId, ...division }),
    Promise.resolve(0),
    ctx.count('batches', { status: { $in: ['QC_PASSED', 'DISPATCH_ORDER_RAISED', 'DISPATCH_APPROVED', 'LOADING'] }, tenant_id: tenantId, ...division }),
    Promise.resolve(0),
    ctx.count('dispatch_records', { created_at: { $gte: startOfDay() }, tenant_id: tenantId, ...division }),
    ctx.count('dispatch_orders', { status: 'APPROVED', tenant_id: tenantId, ...division }),
    ctx.count('clients', { is_active: 1, tenant_id: tenantId }),
    ctx.count('shelf_locations', { is_active: 1, tenant_id: tenantId, ...division }),
    ctx.find('activity_logs', { tenant_id: tenantId, ...division }, { sort: { created_at: -1 }, limit: 10, projection: { _id: 0 } }),
    ctx.find('batches', { tenant_id: tenantId, ...division }, { sort: { created_at: -1 }, limit: 10, projection: { _id: 0 } }),
    Promise.resolve(0),
    Promise.resolve(0),
    ctx.count('batches', { status: 'LOADING', tenant_id: tenantId, ...division }),
    ctx.count('batches', { status: 'DISPATCH_APPROVED', tenant_id: tenantId, ...division }),
  ]);

  const recentBatches = await enrichBatches(ctx, recentBatchesRaw, tenantId, division);

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

export async function adminStats(req: Request, res: Response): Promise<void> {
  const tenantId = req.user!.tenantId;
  const ctx = await getContext();
  const division = divisionFilter(req);
  const inventory = await inventoryTotals(ctx, tenantId, division);

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
    ctx.count('batches', { tenant_id: tenantId, ...division }),
    ctx.count('batches', { status: 'CREATED', tenant_id: tenantId, ...division }),
    ctx.count('qc_records', { tenant_id: tenantId, ...division }),
    ctx.count('qc_records', { result: 'PASS', tenant_id: tenantId, ...division }),
    ctx.count('qc_records', { result: 'FAIL', tenant_id: tenantId, ...division }),
    ctx.count('dispatch_records', { tenant_id: tenantId, ...division }),
    ctx.count('dispatch_records', { created_at: { $gte: startOfDay() }, tenant_id: tenantId, ...division }),
    ctx.count('dispatch_orders', { tenant_id: tenantId, ...division }),
    ctx.count('dispatch_orders', { status: 'APPROVED', tenant_id: tenantId, ...division }),
    ctx.count('dispatch_orders', { status: 'APPROVED', tenant_id: tenantId, ...division }),
    ctx.count('dispatch_orders', { status: { $in: ['REJECTED', 'CANCELLED'] }, tenant_id: tenantId, ...division }),
    ctx.count('shelf_locations', { tenant_id: tenantId, ...division }),
    ctx.count('shelf_locations', { is_active: 1, tenant_id: tenantId, ...division }),
    ctx.count('admins', { email: { $not: /^__role_archive_/i }, tenant_id: tenantId }),
    ctx.count('qc_users', { email: { $not: /^__role_archive_/i }, tenant_id: tenantId }),
    ctx.count('dispatch_users', { email: { $not: /^__role_archive_/i }, tenant_id: tenantId }),
    ctx.count('admins', { is_active: 1, tenant_id: tenantId }),
    ctx.count('qc_users', { is_active: 1, tenant_id: tenantId }),
    ctx.count('dispatch_users', { is_active: 1, tenant_id: tenantId }),
  ]);

  const [recentQcRaw, recentDispatchesRaw, pendingRequestsRaw, recentActivity] = await Promise.all([
    ctx.find('qc_records', { tenant_id: tenantId, ...division }, { sort: { created_at: -1 }, limit: 5, projection: { _id: 0 } }),
    ctx.find('dispatch_records', { tenant_id: tenantId, ...division }, { sort: { created_at: -1 }, limit: 5, projection: { _id: 0 } }),
    ctx.find('dispatch_orders', { tenant_id: tenantId, ...division }, { sort: { created_at: -1 }, limit: 5, projection: { _id: 0 } }),
    ctx.find('activity_logs', { tenant_id: tenantId, ...division }, { sort: { created_at: -1 }, limit: 8, projection: { _id: 0 } }),
  ]);

  const [recentQc, recentDispatches, pendingRequests] = await Promise.all([
    enrichQc(ctx, recentQcRaw, tenantId, division),
    enrichDispatches(ctx, recentDispatchesRaw, tenantId, division),
    enrichPendingRequests(ctx, pendingRequestsRaw, tenantId, division),
  ]);

  const passRate = qcTotal > 0 ? Math.round((qcPassed / qcTotal) * 100) : 0;

  res.json({
    stats: {
      totalProducts: await ctx.count('products', { tenant_id: tenantId, is_active: 1, ...division }),
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

async function enrichQc(ctx: DbContext, records: Record<string, any>[], tenantId: string | number, divisionScope?: Record<string, any>): Promise<Record<string, any>[]> {
  const batches = await mapByIds<Record<string, any>>(ctx, 'batches', records.map((record) => idKey(record.batch_id)), tenantId, divisionScope);
  const products = await mapByIds<Record<string, any>>(
    ctx,
    'products',
    [...batches.values()].map((batch) => idKey(batch.product_id)),
    tenantId,
    divisionScope
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

async function enrichDispatches(ctx: DbContext, records: Record<string, any>[], tenantId: string | number, divisionScope?: Record<string, any>): Promise<Record<string, any>[]> {
  const batches = await mapByIds<Record<string, any>>(ctx, 'batches', records.map((record) => idKey(record.batch_id)), tenantId, divisionScope);
  const products = await mapByIds<Record<string, any>>(
    ctx,
    'products',
    [...batches.values()].map((batch) => idKey(batch.product_id)),
    tenantId,
    divisionScope
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

async function enrichPendingRequests(ctx: DbContext, orders: Record<string, any>[], tenantId: string | number, divisionScope?: Record<string, any>): Promise<Record<string, any>[]> {
  const batches = await mapByIds<Record<string, any>>(ctx, 'batches', orders.map((order) => idKey(order.batch_id)), tenantId, divisionScope);
  const products = await mapByIds<Record<string, any>>(
    ctx,
    'products',
    [...batches.values()].map((batch) => idKey(batch.product_id)),
    tenantId,
    divisionScope
  );
  const raisedBy = await mapByIds<Record<string, any>>(
    ctx,
    'dispatch_users',
    orders.map((order) => idKey(order.raised_by)),
    tenantId
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
