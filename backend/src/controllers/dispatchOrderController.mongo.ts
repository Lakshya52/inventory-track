import { Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { DbContext, getContext, idKey, isValidId, now, withTransaction } from '../config/database';
import { applyOperation, SyncConflictError, SyncError } from '../services/syncService';
import { SyncOperationInput } from '../types';
import { batchIdsForSearch, batchQrStats, EntityId, mapByIds, mapNames } from '../services/queryService';
import { buildPackingListPdf } from '../services/packingListPdf';

const ORDER_STATUS_FILTERS = [
  'PENDING',
  'APPROVED',
  'REJECTED',
  'CANCELLED',
  'CLOSED_DISPATCHED',
  'CLOSED_NOT_DISPATCHED',
];

const PACKING_LIST_STATUSES = [
  'APPROVED',
  'CLOSED_DISPATCHED',
  'CLOSED_NOT_DISPATCHED',
  'DISPATCHED',
];

function errorResponse(res: Response, error: unknown, fallback: string): void {
  if (error instanceof SyncError) {
    res.status(error.httpStatus).json({ error: error.message, code: error.code, ...(error.details || {}) });
    return;
  }
  console.error(fallback, error);
  res.status(500).json({ error: fallback });
}

async function enrichOrders(ctx: DbContext, orders: Record<string, any>[]): Promise<Record<string, any>[]> {
  const orderLineBatchIds = orders.flatMap((order) =>
    Array.isArray(order.order_lines) ? order.order_lines.map((line: any) => line?.batch_id) : []
  );
  const batches = await mapByIds<Record<string, any>>(
    ctx,
    'batches',
    [...orders.map((order) => order.batch_id), ...orderLineBatchIds]
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
    // Orders are released by the dispatcher who raised them.
    if (order.approved_by_role === 'DISPATCH') {
      const dispatcher = await ctx.findOne('dispatch_users', { id: order.approved_by_id }, { projection: { _id: 0, name: 1 } });
      return [idKey(order.id), dispatcher?.name ?? null] as const;
    }
    const adminName = order.admin_id ? await ctx.findOne('admins', { id: order.admin_id }, { projection: { _id: 0, name: 1 } }) : null;
    return [idKey(order.id), adminName?.name ?? null] as const;
  }));
  const approverNames = new Map(approvers);
  const clients = await mapNames(ctx, 'clients', orders.map((order) => order.client_id));
  const qrStats = await batchQrStats(ctx, orders.map((order) => order.batch_id));
  const orderLabels = await ctx.find('qr_labels', { dispatch_order_id: { $in: orders.map((order) => order.id) } }, { projection: { _id: 0, dispatch_order_id: 1 } });
  const orderQrCounts = new Map<string, number>();
  for (const label of orderLabels) {
    const key = idKey(label.dispatch_order_id);
    orderQrCounts.set(key, (orderQrCounts.get(key) || 0) + 1);
  }

  const gradeNameForBatch = (batchId: any): string | null => {
    const batch = batches.get(idKey(batchId));
    if (!batch) return null;
    return grades.get(idKey(batch.grade_id))?.name
      ?? products.get(idKey(batch.product_id))?.grade
      ?? null;
  };

  return orders.flatMap((order) => {
    const batch = batches.get(idKey(order.batch_id));
    const orderQuantity = Number(order.quantity ?? batch?.quantity ?? 0);
    const product = batch ? products.get(idKey(batch.product_id)) : undefined;
    // Historical/imported order rows can lack a real QC batch relationship.
    // They cannot be loaded safely because no batch QR labels can be validated.
    if (!batch || !product || !Number.isFinite(orderQuantity) || orderQuantity < 1) return [];
    const outcome = order.outcome
      ?? (order.status === 'CLOSED_DISPATCHED' ? 'DISPATCHED'
        : order.status === 'CLOSED_NOT_DISPATCHED' ? 'NOT_DISPATCHED' : null);
    const items = Array.isArray(order.order_lines) && order.order_lines.length ? order.order_lines : [{
      batch_id: batch.id,
      batch_number: batch.parent_batch_number || batch.batch_number,
      child_batch_number: batch.batch_number,
      product_name: product?.name ?? null,
      product_sku: product?.sku ?? null,
      quantity: orderQuantity,
      uom: batch.uom ?? null,
      location: batch.storage_location ?? null,
    }];
    return [{
      ...order,
      outcome,
      batch_number: items.length === 1 ? items[0].batch_number : 'Multi-product order',
      barcode_value: batch?.barcode_value ?? null,
      quantity: orderQuantity,
      items,
      uom: batch?.uom ?? null,
      batch_status: batch?.status ?? null,
      storage_location: batch?.storage_location ?? null,
      vendor_name: vendors.get(idKey(batch?.vendor_id))?.name ?? null,
      grade_name: [...new Set(items.map((item: any) => gradeNameForBatch(item.batch_id)).filter(Boolean))].join(', ')
        || grades.get(idKey(batch?.grade_id))?.name
        || product?.grade
        || null,
      bag_quantity_name: bagQuantities.get(idKey(batch?.bag_quantity_id))?.name ?? null,
      bag_quantity: bagQuantities.get(idKey(batch?.bag_quantity_id))?.quantity ?? null,
      bag_quantity_unit: bagQuantities.get(idKey(batch?.bag_quantity_id))?.unit ?? null,
      qr_count: orderQrCounts.get(idKey(order.id)) ?? qrStats.get(idKey(order.batch_id))?.count ?? 0,
      product_name: items.map((item: any) => item.product_name).filter(Boolean).join(', ') || product?.name || null,
      product_sku: items.length === 1 ? items[0].product_sku : null,
      raised_by_name: raisedBy.get(idKey(order.raised_by)) ?? null,
      admin_name: approverNames.get(idKey(order.id)) ?? null,
      client_name: clients.get(idKey(order.client_id)) ?? null,
      approver_name: approverNames.get(idKey(order.id)) ?? null,
    }];
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
  const items = Array.isArray(req.body.items) ? req.body.items : null;
  if (!batchId && !barcodeValue && (!items || items.length === 0)) {
    res.status(400).json({ error: 'Batch ID or barcode value is required' });
    return;
  }

  // Transporter details belong to the order, so they are captured up front
  // rather than only when the loading session is finalised.
  const transport = {
    driver_name: String(req.body.driver_name ?? '').trim(),
    driver_phone: String(req.body.driver_phone ?? '').trim(),
    vehicle_number: String(req.body.vehicle_number ?? '').trim(),
    container_number: String(req.body.container_number ?? '').trim(),
  };
  const missingTransport = [
    ['transporter name', transport.driver_name],
    ['transporter mobile number', transport.driver_phone],
    ['vehicle number', transport.vehicle_number],
    ['container number', transport.container_number],
  ].filter(([, value]) => !value).map(([label]) => label);
  if (missingTransport.length > 0) {
    res.status(400).json({
      error: `Missing transporter details: ${missingTransport.join(', ')}`,
      code: 'MISSING_TRANSPORT_DETAILS',
    });
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
      quantity: req.body.quantity,
      items: items?.map((item: any) => ({ batch_id: item.batch_id, quantity: item.quantity })),
      client_id: req.body.client_id as EntityId,
      // Transport details are captured here and can be corrected when the
      // loading session is finalised.
      driver_name: transport.driver_name,
      driver_phone: transport.driver_phone,
      vehicle_number: transport.vehicle_number,
      container_number: transport.container_number,
      scheduled_dispatch_at: req.body.scheduled_dispatch_at || undefined,
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
    res.status(
      applied.status === 'CONFLICT' ||
      applied.error_code === 'INVALID_BATCH_STATE' ||
      applied.error_code === 'OPEN_ORDER_EXISTS'
        ? 409
        : 400
    ).json({
      error: applied.error || 'Could not raise dispatch order',
      code: applied.error_code,
      ...(applied.data || {}),
    });
  } catch (error) {
    errorResponse(res, error, 'Could not raise dispatch order');
  }
}

export async function listAll(req: Request, res: Response): Promise<void> {
  const q = String(req.query.q || '').trim();
  const status = String(req.query.status || '').toUpperCase();
  const ctx = await getContext();
  const base: Record<string, any> = {};
  if (ORDER_STATUS_FILTERS.includes(status)) base.status = status;
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
  if (ORDER_STATUS_FILTERS.includes(status)) base.status = status;
  const filter = await orderFilterForSearch(ctx, q, base);
  const orders = await ctx.find('dispatch_orders', filter, {
    sort: { created_at: -1 },
    limit: 100,
    projection: { _id: 0 },
  });
  res.json(await enrichOrders(ctx, orders));
}

/**
 * Puts units back into the product stock. The units were taken out of the
 * stock when the dispatch order was created, so they have to go back when the
 * order is called off or the unit is recalled to the shelf.
 */
async function restoreProductStock(
  ctx: DbContext,
  entries: Array<{ productId: EntityId; quantity: number }>
): Promise<void> {
  const totals = new Map<string, { productId: EntityId; quantity: number }>();
  for (const entry of entries) {
    if (!entry.quantity) continue;
    const key = idKey(entry.productId);
    const existing = totals.get(key);
    totals.set(key, {
      productId: entry.productId,
      quantity: (existing?.quantity || 0) + entry.quantity,
    });
  }
  for (const entry of totals.values()) {
    await ctx.findOneAndUpdate('products', { id: entry.productId }, [
      {
        $set: {
          quantity: { $add: [{ $ifNull: ['$quantity', 0] }, entry.quantity] },
          updated_at: now(),
        },
      },
    ], { returnDocument: 'after' });
  }
}

/**
 * The units an order is still holding, grouped per product, so they can be
 * returned to the stock. Units that were already recalled back to the shelf
 * are not included: those went back when they were recalled.
 */
async function orderStockEntries(
  ctx: DbContext,
  order: Record<string, any>
): Promise<Array<{ productId: EntityId; quantity: number }>> {
  const lines = Array.isArray(order.order_lines) && order.order_lines.length
    ? order.order_lines
    : [{ batch_id: order.batch_id, quantity: order.quantity }];
  const entries: Array<{ productId: EntityId; quantity: number }> = [];
  for (const line of lines) {
    const quantity = Number(line?.quantity ?? 0);
    if (!quantity) continue;
    const batch = await ctx.findOne(
      'batches',
      { id: line?.batch_id },
      { projection: { _id: 0, product_id: 1 } }
    );
    if (!batch) continue;
    entries.push({ productId: batch.product_id as EntityId, quantity });
  }
  return entries;
}

/**
 * Dispatch orders need no approval: raising one releases it straight away.
 * A raised order can still be cancelled by the dispatcher who raised it (or
 * an administrator) as long as loading has not started yet. Cancelling frees
 * the reserved QR labels and puts the stock back on the shelf.
 */
export async function cancel(req: Request, res: Response): Promise<void> {
  const id = req.params.id;
  if (!isValidId(id)) { res.status(400).json({ error: 'Invalid dispatch order id' }); return; }
  const rawRemarks = req.body.remarks ?? req.body.admin_remarks;
  const remarks = rawRemarks === null || rawRemarks === undefined ? '' : String(rawRemarks).trim();
  if (!remarks) {
    res.status(400).json({ error: 'A reason is required to cancel a dispatch order' });
    return;
  }
  try {
    const result = await withTransaction(async (ctx: DbContext) => {
      const order = await ctx.findOne('dispatch_orders', { id }, { projection: { _id: 0 } });
      if (!order) throw new SyncError('Dispatch order not found', 'ORDER_NOT_FOUND', 404);
      if (req.user!.role !== 'ADMIN' && idKey(order.raised_by) !== idKey(req.user!.userId)) {
        throw new SyncError('You can only cancel a dispatch order you raised', 'FORBIDDEN', 403);
      }
      if (order.status !== 'APPROVED') {
        throw new SyncConflictError(`Order is already ${order.status}`, { order_id: order.id, status: order.status });
      }

      const releasedBatchIds = Array.isArray(order.order_lines) && order.order_lines.length
        ? order.order_lines.map((line: any) => line?.batch_id).filter((batchId: any) => batchId !== undefined && batchId !== null)
        : [order.batch_id];

      // Loading must not have started: the batch is already on the truck.
      const loadingBatch = await ctx.findOne(
        'batches',
        { id: { $in: releasedBatchIds }, status: { $nin: ['QC_PASSED', 'DISPATCH_APPROVED'] } },
        { projection: { _id: 0, id: 1, batch_number: 1, status: 1 } }
      );
      if (loadingBatch) {
        throw new SyncConflictError('Loading has already started for this order. It cannot be cancelled.', {
          batch_id: loadingBatch.id,
          current_status: loadingBatch.status,
        });
      }

      const cancelledAt = now();
      const orderUpdate = await ctx.updateOne(
        'dispatch_orders',
        { id, status: 'APPROVED' },
        { $set: {
          status: 'CANCELLED',
          remarks,
          admin_remarks: remarks,
          dispatched_at: null,
        } }
      );
      if (orderUpdate.matchedCount !== 1) {
        throw new SyncConflictError('Dispatch order was changed by another user', { order_id: id });
      }

      // Release the reserved QR labels so the stock becomes orderable again.
      await ctx.updateMany(
        'qr_labels',
        { batch_id: { $in: releasedBatchIds }, dispatch_order_id: id },
        { $set: { dispatch_order_id: null } }
      );
      for (const batchId of releasedBatchIds) {
        await ctx.updateOne(
          'batches',
          { id: batchId, status: 'DISPATCH_APPROVED' },
          { $set: { status: 'QC_PASSED' } }
        );
      }
      await ctx.deleteMany('packing_list_items', { dispatch_order_id: id });

      // The order took these units out of the stock when it was created, so
      // cancelling it has to put them back on the shelf.
      if (order.stock_reserved_at_order) {
        await restoreProductStock(ctx, await orderStockEntries(ctx, order));
      }

      await ctx.insert('activity_logs', {
        user_id: req.user!.userId,
        user_name: req.user!.name,
        user_role: req.user!.role,
        action: 'DISPATCH_ORDER_CANCELLED',
        description: `Dispatch order #${id} cancelled for batch #${order.batch_id}: ${remarks.slice(0, 1000)}`,
      });
      return { message: 'Dispatch order cancelled', status: 'CANCELLED', remarks };
    });
    res.json(result);
  } catch (error) {
    errorResponse(res, error, 'Could not cancel dispatch order');
  }
}

/**
 * Standalone QR recall. Pulls a printed label out of one of the caller's own
 * open dispatch orders, with or without an active loading session. The unit
 * stops being expected on this order, so the order quantity drops by one.
 *
 * - DAMAGED / HOLD  the label stays with the order but is flagged as recalled
 * - RETURN_TO_STOCK the label goes back to free stock and its batch returns to
 *   the shelf
 */
export async function recallQr(req: Request, res: Response): Promise<void> {
  const qrValue = String(req.body?.qr_value ?? '').trim();
  const reason = String(req.body?.reason ?? '').trim().slice(0, 1000);
  const condition = String(req.body?.condition ?? '').trim().toUpperCase();
  if (!qrValue || !reason || !['DAMAGED', 'HOLD', 'RETURN_TO_STOCK'].includes(condition)) {
    res.status(400).json({ error: 'Provide a valid QR code, reason and condition', code: 'INVALID_RECALL_DETAILS' });
    return;
  }
  try {
    const result = await withTransaction(async (ctx: DbContext) => {
      const label = await ctx.findOne('qr_labels', { qr_value: qrValue });
      if (!label) throw new SyncError('QR label not found', 'QR_NOT_FOUND', 404);
      if (!label.dispatch_order_id) {
        throw new SyncError('This QR label is not assigned to a dispatch order', 'QR_NOT_IN_ORDER', 409);
      }
      const order = await ctx.findOne('dispatch_orders', { id: label.dispatch_order_id });
      if (!order) throw new SyncError('Dispatch order not found', 'ORDER_NOT_FOUND', 404);
      if (req.user!.role !== 'ADMIN' && idKey(order.raised_by) !== idKey(req.user!.userId)) {
        throw new SyncError('You can only recall labels on orders you raised', 'FORBIDDEN', 403);
      }
      if (order.status !== 'APPROVED') {
        throw new SyncConflictError(`This order is already ${order.status}`, { order_id: order.id, status: order.status });
      }
      if (label.recall_status === 'RECALLED') {
        throw new SyncConflictError('This QR label has already been recalled', { qr_value: qrValue, code: 'QR_ALREADY_RECALLED' });
      }
      const loadedEvent = await ctx.findOne('loading_scan_events', { qr_value: qrValue, result: 'OK' });
      if (loadedEvent) {
        throw new SyncConflictError('This QR code has already been loaded and cannot be recalled', { qr_value: qrValue, code: 'QR_ALREADY_LOADED' });
      }
      const batch = await ctx.findOne('batches', { id: label.batch_id }, { projection: { _id: 0, product_id: 1 } });

      // The unit leaves this order: drop its line and lower the order quantity.
      const orderLines = Array.isArray(order.order_lines) ? order.order_lines : [];
      const remainingLines = orderLines.filter(
        (line: any) => idKey(line?.batch_id) !== idKey(label.batch_id),
      );
      await ctx.updateOne('dispatch_orders', { id: order.id }, {
        $set: {
          order_lines: remainingLines,
          quantity: Math.max(0, Number(order.quantity || 0) - 1),
          remarks: reason,
          admin_remarks: reason,
        },
      });

      // An open loading session must stop counting the recalled unit.
      const activeSession = await ctx.findOne('loading_sessions', {
        dispatch_order_id: order.id,
        status: 'ACTIVE',
      });
      if (activeSession) {
        await ctx.updateOne(
          'loading_sessions',
          { id: activeSession.id, status: 'ACTIVE' },
          { $inc: { total: -1 } },
        );
      }

      if (condition === 'RETURN_TO_STOCK') {
        // The label goes back to free stock and its batch returns to the shelf.
        await ctx.updateOne('qr_labels', { id: label.id }, { $set: {
          dispatch_order_id: null,
          recall_status: null,
          recall_condition: null,
          recall_reason: null,
          recalled_by: null,
          recalled_at: null,
        } });
        await ctx.updateOne('batches', { id: label.batch_id, status: 'DISPATCH_APPROVED' }, { $set: { status: 'QC_PASSED' } });
        // The unit left the stock when the order was created, so it goes back
        // on the shelf now.
        if (order.stock_reserved_at_order && batch) {
          await restoreProductStock(ctx, [{ productId: batch.product_id as EntityId, quantity: 1 }]);
          await ctx.updateOne(
            'dispatch_orders',
            { id: order.id },
            { $inc: { returned_to_stock_quantity: 1 } },
          );
        }
      } else {
        await ctx.updateOne('qr_labels', { id: label.id, recall_status: { $ne: 'RECALLED' } }, { $set: {
          recall_status: 'RECALLED',
          recall_condition: condition,
          recall_reason: reason,
          recalled_by: req.user!.userId,
          recalled_at: now(),
        } });
      }

      await ctx.insert('activity_logs', {
        user_id: req.user!.userId,
        user_name: req.user!.name,
        user_role: req.user!.role,
        action: 'DISPATCH_QR_RECALLED',
        description: `QR ${qrValue} recalled from dispatch order ${order.id}; condition ${condition}; reason: ${reason}`,
      });

      return {
        message: condition === 'RETURN_TO_STOCK'
          ? 'QR label recalled and returned to stock'
          : 'QR label recalled and excluded from loading',
        condition,
        order_id: order.id,
        batch_id: label.batch_id,
      };
    });
    res.json(result);
  } catch (error) {
    errorResponse(res, error, 'Could not recall QR label');
  }
}

type PackingListBuildResult =
  | { ok: true; data: Record<string, any> }
  | { ok: false; statusCode: number; error: string };

async function buildPackingListData(req: Request): Promise<PackingListBuildResult> {
  const id = req.params.id;
  if (!isValidId(id)) {
    return { ok: false, statusCode: 400, error: 'Invalid dispatch order id' };
  }
  const ctx = await getContext();
  const order = await ctx.findOne('dispatch_orders', { id }, { projection: { _id: 0 } });
  if (!order) {
    return { ok: false, statusCode: 404, error: 'Dispatch order not found' };
  }
  if (!PACKING_LIST_STATUSES.includes(String(order.status))) {
    return {
      ok: false,
      statusCode: 409,
      error: 'Packing list is only available for approved or dispatched orders',
    };
  }

  const [batch, client, storedItems, dispatchRecord, qrLabels] = await Promise.all([
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
    // Human-readable QR IDs assigned to this order, grouped by batch line.
    ctx.find('qr_labels', { dispatch_order_id: id }, {
      sort: { batch_id: 1, serial_no: 1 },
      projection: { _id: 0, batch_id: 1, qr_value: 1 },
    }),
  ]);

  const qrByBatch = new Map<string, string[]>();
  for (const label of qrLabels) {
    const key = String(label.batch_id);
    const list = qrByBatch.get(key) || [];
    list.push(String(label.qr_value));
    qrByBatch.set(key, list);
  }

  const [product, location, grade, vendor, bagQuantity, raisedBy, admin, dispatcher] = await Promise.all([
    batch ? ctx.findOne('products', { id: batch.product_id }, { projection: { _id: 0 } }) : null,
    batch && batch.shelf_location_id
      ? ctx.findOne('shelf_locations', { id: batch.shelf_location_id }, {
          projection: { _id: 0, location_code: 1, description: 1 },
        })
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
      : order.approved_by_role === 'DISPATCH'
        ? ctx.findOne('dispatch_users', { id: order.approved_by_id }, { projection: { _id: 0, name: 1 } })
        : order.admin_id
          ? ctx.findOne('admins', { id: order.admin_id }, { projection: { _id: 0, name: 1 } })
          : null,
    dispatchRecord[0]
      ? ctx.findOne('dispatch_users', { id: dispatchRecord[0].dispatcher_id }, { projection: { _id: 0, name: 1 } })
      : null,
  ]);

  const storageLocation = location?.location_code || batch?.storage_location || null;
  const orderQuantity = Number(order.quantity ?? batch?.quantity ?? 0);
  const baseItems = storedItems.length > 0
    ? storedItems
    : [{
        batch_id: batch?.id ?? null,
        product_name: product?.name ?? null,
        sku: product?.sku ?? null,
        batch_number: batch?.batch_number ?? null,
        barcode: batch?.barcode_value ?? null,
        quantity: orderQuantity,
        uom: batch?.uom ?? null,
        grade: grade?.name ?? product?.grade ?? null,
        bag_quantity: bagQuantity?.quantity ?? null,
        bag_quantity_unit: bagQuantity?.unit ?? null,
        location: storageLocation || 'N/A',
        location_code: location?.location_code ?? null,
        location_description: location?.description ?? storageLocation ?? null,
      }];
  // Packing-list lines snapshot the product, not its grade. Resolve each line's
  // grade from its batch so the list (screen, print and PDF) can show grades.
  const lineBatchIds = [...new Set(baseItems.map((item: any) => item.batch_id).filter(Boolean))];
  const lineBatches = await mapByIds<Record<string, any>>(ctx, 'batches', lineBatchIds);
  const lineGrades = await mapByIds<Record<string, any>>(
    ctx,
    'grades',
    [...lineBatches.values()].map((lineBatch) => lineBatch.grade_id)
  );
  const lineProducts = await mapByIds<Record<string, any>>(
    ctx,
    'products',
    [...lineBatches.values()].map((lineBatch) => lineBatch.product_id)
  );
  const gradeNameByBatch = new Map<string, string | null>();
  for (const [key, lineBatch] of lineBatches) {
    gradeNameByBatch.set(
      key,
      lineGrades.get(idKey(lineBatch.grade_id))?.name
        ?? lineProducts.get(idKey(lineBatch.product_id))?.grade
        ?? null,
    );
  }

  const items = baseItems.map((item: any) => ({
    ...item,
    // Packing-list snapshots store the SKU as product_sku; surface it as sku
    // so the table and PDFs can read a single field.
    sku: item.sku ?? item.product_sku ?? null,
    grade_name: item.grade_name
      ?? gradeNameByBatch.get(String(item.batch_id))
      ?? item.grade
      ?? grade?.name
      ?? product?.grade
      ?? null,
    qr_values: qrByBatch.get(String(item.batch_id)) || [],
  }));

  return {
    ok: true,
    data: {
      order_id: order.id,
      quantity: orderQuantity,
      status: order.status,
      batch_number: batch?.batch_number ?? null,
      barcode: batch?.barcode_value ?? null,
      raised_by_name: raisedBy?.name ?? null,
      approver_name: admin?.name ?? null,
      admin_remarks: order.admin_remarks || null,
      remarks: order.remarks ?? order.admin_remarks ?? null,
      client: client || null,
      client_name: client?.name ?? null,
      driver_name: order.driver_name,
      driver_phone: order.driver_phone ?? null,
      vehicle_number: order.vehicle_number,
      container_number: order.container_number,
      seal_number: order.seal_number ?? null,
      outcome: order.outcome
        ?? (order.status === 'CLOSED_DISPATCHED' ? 'DISPATCHED'
          : order.status === 'CLOSED_NOT_DISPATCHED' ? 'NOT_DISPATCHED' : null),
      grade: grade?.name ?? product?.grade ?? null,
      vendor_name: vendor?.name ?? null,
      dispatched_by: dispatcher?.name ?? null,
      location: storageLocation,
      dispatched_at: order.dispatched_at || null,
      items,
      generated_at: new Date().toISOString(),
    },
  };
}

export async function getPackingList(req: Request, res: Response): Promise<void> {
  const result = await buildPackingListData(req);
  if (!result.ok) {
    res.status(result.statusCode).json({ error: result.error });
    return;
  }
  res.json(result.data);
}

export async function getPackingListPdf(req: Request, res: Response): Promise<void> {
  const result = await buildPackingListData(req);
  if (!result.ok) {
    res.status(result.statusCode).json({ error: result.error });
    return;
  }
  try {
    const pdf = buildPackingListPdf(result.data);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="packing-list-${String(result.data.order_id)}.pdf"`);
    res.setHeader('Content-Length', String(pdf.length));
    res.end(pdf);
  } catch (error) {
    console.error('Could not generate packing list PDF', error);
    res.status(500).json({ error: 'Could not generate packing list PDF' });
  }
}
