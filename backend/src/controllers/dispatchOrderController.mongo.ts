import { Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { DbContext, getContext, idKey, isValidId, withTransaction } from '../config/database';
import { applyOperation, SyncConflictError, SyncError } from '../services/syncService';
import { SyncOperationInput } from '../types';
import { batchIdsForSearch, batchQrStats, EntityId, mapByIds, mapNames } from '../services/queryService';

function errorResponse(res: Response, error: unknown, fallback: string): void {
  if (error instanceof SyncError) {
    res.status(error.httpStatus).json({ error: error.message, code: error.code, ...(error.details || {}) });
    return;
  }
  console.error(fallback, error);
  res.status(500).json({ error: fallback });
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
      const qc = await ctx.findOne('qc_users', { id: order.approved_by_id }, { projection: { _id: 0, name: 1 } });
      return [idKey(order.id), qc?.name ?? null] as const;
    }
    const adminName = order.admin_id ? await ctx.findOne('admins', { id: order.admin_id }, { projection: { _id: 0, name: 1 } }) : null;
    return [idKey(order.id), adminName?.name ?? null] as const;
  }));
  const approverNames = new Map(approvers);
  const clients = await mapNames(ctx, 'clients', orders.map((order) => order.client_id));
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
      client_name: clients.get(idKey(order.client_id)) ?? null,
      approver_name: approverNames.get(idKey(order.id)) ?? null,
    };
  });
}

async function orderFilterForSearch(
  ctx: DbContext,
  q: string,
  base: Record<string, any>
): Promise<Record<string, any>> {
  if (!q) return base;
  const batchIds = await batchIdsForSearch(ctx, q);
  return { ...base, batch_id: { $in: batchIds } };
}

export async function raise(req: Request, res: Response): Promise<void> {
  const batchId = req.body.batch_id;
  const barcodeValue = req.body.barcode_value;
  if (!batchId && !barcodeValue) {
    res.status(400).json({ error: 'Batch ID or barcode value is required' });
    return;
  }

  const operation: SyncOperationInput = {
    operation_id: req.body.client_operation_id || randomUUID(),
    type: 'DISPATCH_ORDER_RAISE',
    client_timestamp: req.body.client_timestamp || new Date().toISOString(),
    payload: {
      batch_id: batchId ? (batchId as EntityId) : undefined,
      barcode_value: barcodeValue ? String(barcodeValue) : undefined,
      expected_status: req.body.expected_status || undefined,
      client_id: req.body.client_id as EntityId,
      driver_name: String(req.body.driver_name || ''),
      vehicle_number: String(req.body.vehicle_number || ''),
      container_number: String(req.body.container_number || ''),
    },
  };

  try {
    const applied = await applyOperation(req.user!, null, operation);
    if (applied.status === 'APPLIED' || applied.status === 'DUPLICATE') {
      res.status(applied.status === 'APPLIED' ? 201 : 200).json({
        ...(applied.data || {}),
        duplicate: applied.status === 'DUPLICATE',
      });
      return;
    }
    res.status(applied.status === 'CONFLICT' ? 409 : 400).json({
      error: applied.error || 'Could not raise dispatch order',
      code: applied.error_code,
      ...(applied.data || {}),
    });
  } catch (error) {
    errorResponse(res, error, 'Could not raise dispatch order');
  }
}

export async function listPending(req: Request, res: Response): Promise<void> {
  const q = String(req.query.q || '').trim();
  const ctx = await getContext();
  const filter = await orderFilterForSearch(ctx, q, { status: 'PENDING' });
  const orders = await ctx.find('dispatch_orders', filter, {
    sort: { created_at: 1 },
    limit: 100,
    projection: { _id: 0 },
  });
  res.json(await enrichOrders(ctx, orders));
}

export async function listAll(req: Request, res: Response): Promise<void> {
  const q = String(req.query.q || '').trim();
  const status = String(req.query.status || '').toUpperCase();
  const ctx = await getContext();
  const base: Record<string, any> = {};
  if (['PENDING', 'APPROVED', 'REJECTED'].includes(status)) base.status = status;
  const filter = await orderFilterForSearch(ctx, q, base);
  const orders = await ctx.find('dispatch_orders', filter, {
    sort: { created_at: -1 },
    limit: 100,
    projection: { _id: 0 },
  });
  res.json(await enrichOrders(ctx, orders));
}

export async function listMine(req: Request, res: Response): Promise<void> {
  const q = String(req.query.q || '').trim();
  const status = String(req.query.status || '').toUpperCase();
  const ctx = await getContext();
  const base: Record<string, any> = { raised_by: req.user!.userId };
  if (['PENDING', 'APPROVED', 'REJECTED'].includes(status)) base.status = status;
  const filter = await orderFilterForSearch(ctx, q, base);
  const orders = await ctx.find('dispatch_orders', filter, {
    sort: { created_at: -1 },
    limit: 100,
    projection: { _id: 0 },
  });
  res.json(await enrichOrders(ctx, orders));
}

export async function approve(req: Request, res: Response): Promise<void> {
  const id = req.params.id;
  if (!isValidId(id)) { res.status(400).json({ error: 'Invalid dispatch order id' }); return; }
  const { admin_remarks } = req.body;
  try {
    const result = await withTransaction(async (ctx: DbContext) => {
      const order = await ctx.findOne('dispatch_orders', { id }, { projection: { _id: 0 } });
      if (!order) throw new SyncError('Dispatch order not found', 'ORDER_NOT_FOUND', 404);
      if (order.status !== 'PENDING') {
        throw new SyncConflictError(`Order is already ${order.status}`, { order_id: order.id, status: order.status });
      }

      const batch = await ctx.findOne('batches', { id: order.batch_id }, { projection: { _id: 0 } });
      if (!batch) throw new SyncError('Batch not found', 'BATCH_NOT_FOUND', 404);
      if (batch.status !== 'DISPATCH_ORDER_RAISED') {
        throw new SyncConflictError(`Batch is not awaiting approval. Current status: ${batch.status}`, {
          batch_id: order.batch_id,
          current_status: batch.status,
        });
      }

      const orderUpdate = await ctx.updateOne(
        'dispatch_orders',
        { id, status: 'PENDING' },
        { $set: {
          status: 'APPROVED',
          admin_id: req.user!.role === 'ADMIN' ? req.user!.userId : null,
          approved_by_role: req.user!.role,
          approved_by_id: req.user!.userId,
          admin_remarks: admin_remarks || null,
        } }
      );
      if (orderUpdate.matchedCount !== 1) {
        throw new SyncConflictError('Dispatch order was changed by another user', { order_id: id });
      }

      const batchUpdate = await ctx.updateOne(
        'batches',
        { id: order.batch_id, status: 'DISPATCH_ORDER_RAISED' },
        { $set: { status: 'DISPATCH_APPROVED' } }
      );
      if (batchUpdate.matchedCount !== 1) {
        throw new SyncConflictError('Batch was changed by another user', { batch_id: order.batch_id });
      }

      await ctx.insert('activity_logs', {
        user_id: req.user!.userId,
        user_name: req.user!.name,
        user_role: req.user!.role,
        action: 'DISPATCH_APPROVED',
        description: `Dispatch order #${id} approved for batch #${order.batch_id}`,
      });
      return { message: 'Dispatch order approved', status: 'APPROVED' };
    });
    res.json(result);
  } catch (error) {
    errorResponse(res, error, 'Could not approve dispatch order');
  }
}

export async function reject(req: Request, res: Response): Promise<void> {
  const id = req.params.id;
  if (!isValidId(id)) { res.status(400).json({ error: 'Invalid dispatch order id' }); return; }
  const { admin_remarks } = req.body;
  try {
    const result = await withTransaction(async (ctx: DbContext) => {
      const order = await ctx.findOne('dispatch_orders', { id }, { projection: { _id: 0 } });
      if (!order) throw new SyncError('Dispatch order not found', 'ORDER_NOT_FOUND', 404);
      if (order.status !== 'PENDING') {
        throw new SyncConflictError(`Order is already ${order.status}`, { order_id: order.id, status: order.status });
      }

      const batch = await ctx.findOne('batches', { id: order.batch_id }, { projection: { _id: 0 } });
      if (!batch) throw new SyncError('Batch not found', 'BATCH_NOT_FOUND', 404);

      const orderUpdate = await ctx.updateOne(
        'dispatch_orders',
        { id, status: 'PENDING' },
        { $set: {
          status: 'REJECTED',
          admin_id: req.user!.role === 'ADMIN' ? req.user!.userId : null,
          approved_by_role: req.user!.role,
          approved_by_id: req.user!.userId,
          admin_remarks: admin_remarks || null,
        } }
      );
      if (orderUpdate.matchedCount !== 1) {
        throw new SyncConflictError('Dispatch order was changed by another user', { order_id: id });
      }

      await ctx.updateOne(
        'batches',
        { id: order.batch_id, status: 'DISPATCH_ORDER_RAISED' },
        { $set: { status: 'DISPATCH_REJECTED' } }
      );

      await ctx.insert('activity_logs', {
        user_id: req.user!.userId,
        user_name: req.user!.name,
        user_role: req.user!.role,
        action: 'DISPATCH_REJECTED',
        description: `Dispatch order #${id} rejected for batch #${order.batch_id}`,
      });
      return { message: 'Dispatch order rejected', status: 'REJECTED' };
    });
    res.json(result);
  } catch (error) {
    errorResponse(res, error, 'Could not reject dispatch order');
  }
}

export async function getPackingList(req: Request, res: Response): Promise<void> {
  const id = req.params.id;
  if (!isValidId(id)) { res.status(400).json({ error: 'Invalid dispatch order id' }); return; }
  const ctx = await getContext();
  const queryFilter: Record<string, any> = {
    id,
    status: 'APPROVED',
    dispatched_at: { $ne: null },
  };
  if (req.user!.role !== 'ADMIN') {
    queryFilter.raised_by = req.user!.userId;
  }
  const order = await ctx.findOne(
    'dispatch_orders',
    queryFilter,
    { projection: { _id: 0 } }
  );
  if (!order) {
    res.status(404).json({ error: 'Dispatch order not found' });
    return;
  }

  const [batch, client, storedItems, dispatchRecord] = await Promise.all([
    ctx.findOne('batches', { id: order.batch_id }, { projection: { _id: 0 } }),
    order.client_id
      ? ctx.findOne('clients', { id: order.client_id }, {
          projection: { _id: 0, id: 1, name: 1, contact_person: 1, email: 1, phone: 1, address: 1, gst_number: 1 },
        })
      : null,
    ctx.find('packing_list_items', { dispatch_order_id: id }, { sort: { _id: 1 }, projection: { _id: 0 } }),
    ctx.find('dispatch_records', { dispatch_order_id: id }, {
      sort: { created_at: -1 },
      limit: 1,
      projection: { _id: 0, dispatcher_id: 1 },
    }),
  ]);

  const [product, location, grade, vendor, bagQuantity, raisedBy, admin, dispatcher] = await Promise.all([
    batch ? ctx.findOne('products', { id: batch.product_id }, { projection: { _id: 0 } }) : null,
    batch && batch.shelf_location_id
      ? ctx.findOne('shelf_locations', { id: batch.shelf_location_id }, { projection: { _id: 0, location_code: 1 } })
      : null,
    batch?.grade_id
      ? ctx.findOne('grades', { id: batch.grade_id }, { projection: { _id: 0, name: 1 } })
      : null,
    batch?.vendor_id
      ? ctx.findOne('vendors', { id: batch.vendor_id }, { projection: { _id: 0, name: 1 } })
      : null,
    batch?.bag_quantity_id
      ? ctx.findOne('bag_quantities', { id: batch.bag_quantity_id }, { projection: { _id: 0, name: 1, quantity: 1, unit: 1 } })
      : null,
    ctx.findOne('dispatch_users', { id: order.raised_by }, { projection: { _id: 0, name: 1 } }),
    order.approved_by_role === 'QC'
      ? ctx.findOne('qc_users', { id: order.approved_by_id }, { projection: { _id: 0, name: 1 } })
      : order.admin_id
        ? ctx.findOne('admins', { id: order.admin_id }, { projection: { _id: 0, name: 1 } })
      : null,
    dispatchRecord[0]
      ? ctx.findOne('dispatch_users', { id: dispatchRecord[0].dispatcher_id }, { projection: { _id: 0, name: 1 } })
      : null,
  ]);

  const storageLocation = location?.location_code || batch?.storage_location || null;
  const items = storedItems.length > 0
    ? storedItems
    : [{
        product_name: product?.name ?? null,
        sku: product?.sku ?? null,
        batch_number: batch?.batch_number ?? null,
        barcode: batch?.barcode_value ?? null,
        quantity: batch?.quantity ?? null,
        uom: batch?.uom ?? null,
        grade: grade?.name ?? product?.grade ?? null,
        bag_quantity: bagQuantity?.quantity ?? null,
        bag_quantity_unit: bagQuantity?.unit ?? null,
        location: storageLocation || 'N/A',
      }];

  res.json({
    order_id: order.id,
    status: order.status,
    batch_number: batch?.batch_number ?? null,
    barcode: batch?.barcode_value ?? null,
    raised_by_name: raisedBy?.name ?? null,
    approver_name: admin?.name ?? null,
    admin_remarks: order.admin_remarks || null,
    client: client || null,
    client_name: client?.name ?? null,
    driver_name: order.driver_name,
    vehicle_number: order.vehicle_number,
    container_number: order.container_number,
    grade: grade?.name ?? product?.grade ?? null,
    vendor_name: vendor?.name ?? null,
    dispatched_by: dispatcher?.name ?? null,
    location: storageLocation,
    dispatched_at: order.dispatched_at || null,
    items,
    generated_at: new Date().toISOString(),
  });
}
