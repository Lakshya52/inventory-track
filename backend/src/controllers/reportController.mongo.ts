import { Request, Response } from 'express';
import { endOfDay, getContext, idKey, parseDateValue, startOfDay } from '../config/database';
import { mapByIds } from '../services/queryService';

function dateRange(req: Request): Record<string, Date> | null {
  const from = req.query.from as string | undefined;
  const to = req.query.to as string | undefined;
  const range: Record<string, Date> = {};
  if (from) {
    const parsed = parseDateValue(from);
    if (parsed) range.$gte = startOfDay(parsed);
  }
  if (to) {
    const parsed = parseDateValue(to);
    if (parsed) range.$lte = endOfDay(parsed);
  }
  return Object.keys(range).length > 0 ? range : null;
}

export async function summary(_req: Request, res: Response): Promise<void> {
  const ctx = await getContext();

  const [
    totalProducts,
    totalBatches,
    qcTotal,
    qcPassed,
    qcFailed,
    pendingQc,
    dispatchTotal,
    dispatchedToday,
    totalRequests,
    pendingRequests,
    approvedRequests,
    rejectedRequests,
    totalLocations,
    activeLocations,
    adminCount,
    qcUserCount,
    dispatchUserCount,
    activeAdminCount,
    activeQcCount,
    activeDispatchCount,
    inventory,
  ] = await Promise.all([
    ctx.count('products'),
    ctx.count('batches'),
    ctx.count('qc_records'),
    ctx.count('qc_records', { result: 'PASS' }),
    ctx.count('qc_records', { result: 'FAIL' }),
    ctx.count('batches', { status: 'CREATED' }),
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
    ctx.aggregate('products', [
      {
        $group: {
          _id: null,
          qty: { $sum: { $ifNull: ['$quantity', 0] } },
          value: { $sum: { $multiply: [{ $ifNull: ['$quantity', 0] }, { $ifNull: ['$price', 0] }] } },
        },
      },
    ]),
  ]);

  res.json({
    totalProducts,
    totalBatches,
    inventoryQty: Number(inventory[0]?.qty || 0),
    inventoryValue: Number(inventory[0]?.value || 0),
    qcTotal,
    qcPassed,
    qcFailed,
    qcPassRate: qcTotal > 0 ? Math.round((qcPassed / qcTotal) * 100) : 0,
    pendingQc,
    dispatchTotal,
    dispatchedToday,
    totalRequests,
    pendingRequests,
    approvedRequests,
    rejectedRequests,
    totalLocations,
    activeLocations,
    totalUsers: adminCount + qcUserCount + dispatchUserCount,
    activeUsers: activeAdminCount + activeQcCount + activeDispatchCount,
  });
}

export async function qcReport(req: Request, res: Response): Promise<void> {
  const ctx = await getContext();
  const filter: Record<string, any> = {};
  const range = dateRange(req);
  if (range) filter.created_at = range;
  if (req.query.result === 'PASS' || req.query.result === 'FAIL') filter.result = req.query.result;

  const records = await ctx.find('qc_records', filter, {
    sort: { created_at: -1 },
    limit: 1000,
    projection: { _id: 0 },
  });

  const batches = await mapByIds<Record<string, any>>(ctx, 'batches', records.map((record) => idKey(record.batch_id)));
  const products = await mapByIds<Record<string, any>>(
    ctx,
    'products',
    [...batches.values()].map((batch) => idKey(batch.product_id))
  );
  const testers = await mapByIds<Record<string, any>>(ctx, 'qc_users', records.map((record) => idKey(record.tester_id)));

  res.json(records.map((record) => {
    const batch = batches.get(idKey(record.batch_id));
    const product = batch ? products.get(idKey(batch.product_id)) : undefined;
    return {
      id: record.id,
      batch_id: record.batch_id,
      result: record.result,
      remarks: record.remarks,
      images: record.images,
      created_at: record.created_at,
      batch_number: batch?.batch_number ?? null,
      barcode_value: batch?.barcode_value ?? null,
      quantity: batch?.quantity ?? null,
      uom: batch?.uom ?? null,
      product_name: product?.name ?? null,
      product_sku: product?.sku ?? null,
      grade: product?.grade ?? null,
      tester_name: testers.get(idKey(record.tester_id))?.name ?? 'Unknown',
    };
  }));
}

export async function dispatchReport(req: Request, res: Response): Promise<void> {
  const ctx = await getContext();
  const filter: Record<string, any> = {};
  const range = dateRange(req);
  if (range) filter.created_at = range;

  const records = await ctx.find('dispatch_records', filter, {
    sort: { created_at: -1 },
    limit: 1000,
    projection: { _id: 0 },
  });

  const batches = await mapByIds<Record<string, any>>(ctx, 'batches', records.map((record) => idKey(record.batch_id)));
  const products = await mapByIds<Record<string, any>>(
    ctx,
    'products',
    [...batches.values()].map((batch) => idKey(batch.product_id))
  );
  const dispatchers = await mapByIds<Record<string, any>>(
    ctx,
    'dispatch_users',
    records.map((record) => idKey(record.dispatcher_id))
  );
  const orders = await mapByIds<Record<string, any>>(
    ctx,
    'dispatch_orders',
    records.map((record) => idKey(record.dispatch_order_id))
  );
  const clients = await mapByIds<Record<string, any>>(ctx, 'clients', [...orders.values()].map((order) => idKey(order.client_id)));
  const grades = await mapByIds<Record<string, any>>(ctx, 'grades', [...batches.values()].map((batch) => idKey(batch.grade_id)));
  const bagQuantities = await mapByIds<Record<string, any>>(ctx, 'bag_quantities', [...batches.values()].map((batch) => idKey(batch.bag_quantity_id)));

  res.json(records.map((record) => {
    const batch = batches.get(idKey(record.batch_id));
    const product = batch ? products.get(idKey(batch.product_id)) : undefined;
    const order = orders.get(idKey(record.dispatch_order_id));
    return {
      id: record.id,
      batch_id: record.batch_id,
      remarks: record.remarks,
      images: record.images,
      created_at: record.created_at,
      batch_number: batch?.batch_number ?? null,
      barcode_value: batch?.barcode_value ?? null,
      quantity: batch?.quantity ?? null,
      uom: batch?.uom ?? null,
      storage_location: batch?.storage_location ?? null,
      product_name: product?.name ?? null,
      product_sku: product?.sku ?? null,
      grade: grades.get(idKey(batch?.grade_id))?.name ?? product?.grade ?? null,
      bag_quantity: bagQuantities.get(idKey(batch?.bag_quantity_id))?.quantity ?? null,
      bag_quantity_unit: bagQuantities.get(idKey(batch?.bag_quantity_id))?.unit ?? null,
      client_name: clients.get(idKey(order?.client_id))?.name ?? null,
      container_number: order?.container_number ?? null,
      vehicle_number: order?.vehicle_number ?? null,
      dispatch_order_id: order?.id ?? null,
      dispatcher_name: dispatchers.get(idKey(record.dispatcher_id))?.name ?? 'Unknown',
    };
  }));
}

export async function dispatchRequests(req: Request, res: Response): Promise<void> {
  const ctx = await getContext();
  const filter: Record<string, any> = {};
  const range = dateRange(req);
  if (range) filter.created_at = range;
  if (['PENDING', 'APPROVED', 'REJECTED'].includes(String(req.query.status))) {
    filter.status = req.query.status;
  }

  const orders = await ctx.find('dispatch_orders', filter, {
    sort: { created_at: -1 },
    limit: 1000,
    projection: { _id: 0 },
  });

  const batches = await mapByIds<Record<string, any>>(ctx, 'batches', orders.map((order) => idKey(order.batch_id)));
  const products = await mapByIds<Record<string, any>>(
    ctx,
    'products',
    [...batches.values()].map((batch) => idKey(batch.product_id))
  );
  const grades = await mapByIds<Record<string, any>>(ctx, 'grades', [...batches.values()].map((batch) => idKey(batch.grade_id)));
  const bagQuantities = await mapByIds<Record<string, any>>(ctx, 'bag_quantities', [...batches.values()].map((batch) => idKey(batch.bag_quantity_id)));
  const clients = await mapByIds<Record<string, any>>(ctx, 'clients', orders.map((order) => idKey(order.client_id)));
  const raisedBy = await mapByIds<Record<string, any>>(
    ctx,
    'dispatch_users',
    orders.map((order) => idKey(order.raised_by))
  );
  const admins = await mapByIds<Record<string, any>>(ctx, 'admins', orders.map((order) => idKey(order.admin_id)));

  res.json(orders.map((order) => {
    const batch = batches.get(idKey(order.batch_id));
    const product = batch ? products.get(idKey(batch.product_id)) : undefined;
    const client = clients.get(idKey(order.client_id));
    return {
      id: order.id,
      batch_id: order.batch_id,
      status: order.status,
      admin_remarks: order.admin_remarks,
      created_at: order.created_at,
      updated_at: order.updated_at,
      driver_name: order.driver_name,
      vehicle_number: order.vehicle_number,
      container_number: order.container_number,
      batch_number: batch?.batch_number ?? null,
      batch_status: batch?.status ?? null,
      quantity: batch?.quantity ?? null,
      uom: batch?.uom ?? null,
      barcode_value: batch?.barcode_value ?? null,
      product_name: product?.name ?? null,
      product_sku: product?.sku ?? null,
      product_grade: product?.grade ?? null,
      grade_name: grades.get(idKey(batch?.grade_id))?.name ?? product?.grade ?? null,
      bag_quantity_name: bagQuantities.get(idKey(batch?.bag_quantity_id))?.name ?? null,
      bag_quantity: bagQuantities.get(idKey(batch?.bag_quantity_id))?.quantity ?? null,
      bag_quantity_unit: bagQuantities.get(idKey(batch?.bag_quantity_id))?.unit ?? null,
      grade: grades.get(idKey(batch?.grade_id))?.name ?? product?.grade ?? null,
      client_name: client?.name ?? null,
      client_contact: client?.contact_person ?? null,
      client_email: client?.email ?? null,
      client_phone: client?.phone ?? null,
      client_address: client?.address ?? null,
      raised_by_name: raisedBy.get(idKey(order.raised_by))?.name ?? 'Unknown',
      admin_name: admins.get(idKey(order.admin_id))?.name ?? null,
    };
  }));
}

export async function inventory(_req: Request, res: Response): Promise<void> {
  const ctx = await getContext();
  const [products, batchStats] = await Promise.all([
    ctx.find('products', {}, { sort: { name: 1 }, projection: { _id: 0 } }),
    ctx.aggregate('batches', [
      {
        $group: {
          _id: '$product_id',
          batch_quantity: { $sum: { $ifNull: ['$quantity', 0] } },
          batch_count: { $sum: 1 },
          qc_passed_quantity: {
            $sum: { $cond: [{ $eq: ['$status', 'QC_PASSED'] }, { $ifNull: ['$quantity', 0] }, 0] },
          },
          dispatched_quantity: {
            $sum: { $cond: [{ $eq: ['$status', 'DISPATCHED'] }, { $ifNull: ['$quantity', 0] }, 0] },
          },
        },
      },
    ]),
  ]);

  const statsByProduct = new Map(batchStats.map((row) => [idKey(row._id), row]));
  res.json(products.map((product) => {
    const stats = statsByProduct.get(idKey(product.id));
    return {
      id: product.id,
      name: product.name,
      sku: product.sku,
      description: product.description,
      grade: product.grade,
      purity: product.purity,
      cas_number: product.cas_number,
      physical_state: product.physical_state,
      hsn_code: product.hsn_code,
      manufacturer: product.manufacturer,
      storage_conditions: product.storage_conditions,
      price: product.price,
      quantity: product.quantity,
      batch_quantity: Number(stats?.batch_quantity || 0),
      batch_count: Number(stats?.batch_count || 0),
      qc_passed_quantity: Number(stats?.qc_passed_quantity || 0),
      dispatched_quantity: Number(stats?.dispatched_quantity || 0),
      stock_value: Number(product.quantity || 0) * Number(product.price || 0),
    };
  }));
}

export async function batchesReport(req: Request, res: Response): Promise<void> {
  const ctx = await getContext();
  const filter: Record<string, any> = {};
  const range = dateRange(req);
  if (range) filter.created_at = range;
  if (req.query.status) filter.status = req.query.status;

  const rows = await ctx.find('batches', filter, {
    sort: { created_at: -1 },
    limit: 1000,
    projection: { _id: 0 },
  });
  const products = await mapByIds<Record<string, any>>(
    ctx,
    'products',
    rows.map((batch) => idKey(batch.product_id))
  );

  res.json(rows.map((batch) => {
    const product = products.get(idKey(batch.product_id));
    return {
      ...batch,
      product_name: product?.name ?? null,
      product_sku: product?.sku ?? null,
      grade: product?.grade ?? null,
      purity: product?.purity ?? null,
    };
  }));
}
