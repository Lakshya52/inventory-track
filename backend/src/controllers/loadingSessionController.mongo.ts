import { Request, Response } from 'express';
import {
  DbContext,
  getContext,
  idKey,
  isDuplicateKey,
  isValidId,
  now,
  withTransaction,
} from '../config/database';
import { mapByIds, mapNames } from '../services/queryService';
import { SyncError } from '../services/syncService';
import { divisionFilter, divisionStamp } from '../utils/division';
import { publish } from '../realtime/hub';

/** Small helper so every handler returns the same error envelope. */
function errorResponse(res: Response, error: unknown, fallback: string): void {
  if (error instanceof SyncError) {
    res.status(error.httpStatus).json({ error: error.message, code: error.code, ...(error.details || {}) });
    return;
  }
  console.error(fallback, error);
  res.status(500).json({ error: fallback });
}

function trimmed(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function optionalText(value: unknown, maxLength = 4000): string | null {
  const text = trimmed(value);
  return text ? text.slice(0, maxLength) : null;
}

function numeric(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * Grade display name(s) for a set of batches. The batch's grade record wins,
 * with the product's free-text grade as fallback so imported rows still show
 * something. Distinct grades are de-duplicated and comma-joined (a dispatch
 * order can span several batches).
 */
async function gradeNamesFor(
  ctx: DbContext,
  batchIds: Array<string | number | null | undefined>,
  tenantId: string | number,
  df: Record<string, any>
): Promise<string | null> {
  const batches = await mapByIds<Record<string, any>>(ctx, 'batches', batchIds, tenantId, df);
  if (batches.size === 0) return null;
  const [grades, products] = await Promise.all([
    mapByIds<Record<string, any>>(ctx, 'grades', [...batches.values()].map((batch) => batch.grade_id), tenantId, df),
    mapByIds<Record<string, any>>(ctx, 'products', [...batches.values()].map((batch) => batch.product_id), tenantId, df),
  ]);
  const names = [...new Set(
    [...batches.values()]
      .map((batch) => grades.get(idKey(batch.grade_id))?.name ?? products.get(idKey(batch.product_id))?.grade ?? null)
      .filter(Boolean)
  )];
  return names.length > 0 ? names.join(', ') : null;
}

async function logActivity(
  ctx: DbContext,
  user: NonNullable<Request['user']>,
  action: string,
  description: string,
  tenantId: string | number,
  divisionId: string | number | null
): Promise<void> {
  await ctx.insert('activity_logs', {
    user_id: user.userId,
    user_name: user.name || user.role,
    user_role: user.role,
    action,
    description,
    tenant_id: tenantId,
    division_id: divisionId,
  });
}

/**
 * Removes dispatched units from the product's stock counter. Kept byte-for-byte
 * equivalent to the sync service implementation: a single clamped atomic
 * pipeline so concurrent dispatches cannot create a negative balance.
 */
async function deductProductStock(
  ctx: DbContext,
  productId: unknown,
  quantity: number,
  tenantId: string | number,
  divisionScope?: Record<string, any>
): Promise<number | null> {
  if (!isValidId(productId) || !Number.isFinite(quantity) || quantity <= 0) {
    return null;
  }
  const result = await ctx.findOneAndUpdate('products', { id: productId, tenant_id: tenantId, ...divisionScope }, [
    {
      $set: {
        quantity: {
          $cond: [
            { $lt: [{ $subtract: [{ $ifNull: ['$quantity', 0] }, quantity] }, 0] },
            0,
            { $subtract: [{ $ifNull: ['$quantity', 0] }, quantity] },
          ],
        },
        updated_at: now(),
      },
    },
  ], { returnDocument: 'after' });
  return result ? Number((result as Record<string, any>).quantity) : null;
}

/**
 * A scanned unit may only be pulled from a session before the seal is recorded.
 * Mark its OK events RECALLED (keeping the audit trail) and clamp the counters
 * at zero. Returns the number of loaded units that were recalled.
 */
async function recallLoadedEvents(
  ctx: DbContext,
  sessionId: string,
  qrValue: string,
  tenantId: string | number,
  divisionScope?: Record<string, any>
): Promise<number> {
  const loaded = await ctx.find('loading_scan_events', {
    session_id: sessionId,
    qr_value: qrValue,
    result: 'OK',
    tenant_id: tenantId,
    ...divisionScope,
  });
  if (loaded.length === 0) return 0;
  await ctx.updateMany(
    'loading_scan_events',
    { session_id: sessionId, qr_value: qrValue, result: 'OK', tenant_id: tenantId, ...divisionScope },
    { $set: { result: 'RECALLED' } }
  );
  return loaded.length;
}

/** Decrement the matching order line(s) by `units`, dropping lines that reach zero. */
function decrementOrderLines(lines: any[], batchId: unknown, units: number): any[] {
  let remaining = Math.max(0, Math.floor(units));
  const next: any[] = [];
  for (const line of Array.isArray(lines) ? lines : []) {
    if (remaining > 0 && idKey(line?.batch_id) === idKey(batchId)) {
      const quantity = numeric(line?.quantity);
      const taken = Math.min(quantity, remaining);
      const left = quantity - taken;
      remaining -= taken;
      if (left > 0) next.push({ ...line, quantity: left });
    } else {
      next.push(line);
    }
  }
  return next;
}

/**
 * Finds a physical replacement for one recalled unit of `recalledBatch`.
 * Prefers a spare printed label of the same batch (multi-unit batches);
 * otherwise offers another QC-passed bag from the same production group
 * (same product) whose QR label is printed and unassigned — the common case,
 * since batch groups create one child batch per unit. The spare label is
 * reserved for the order immediately. Returns null when no replacement exists.
 */
async function pickReplacementUnit(
  ctx: DbContext,
  recalledBatch: Record<string, any>,
  tenantId: string | number,
  divisionScope?: Record<string, any>
): Promise<{ labelId: unknown; batchId: unknown; batch_number: unknown; uom: unknown; viaSibling: boolean } | null> {
  const unassigned = { print_count: { $gte: 1 }, recall_status: { $ne: 'RECALLED' }, $or: [{ dispatch_order_id: { $exists: false } }, { dispatch_order_id: null }] };
  const sameBatch = await ctx.findOne('qr_labels', { batch_id: recalledBatch.id, tenant_id: tenantId, ...divisionScope, ...unassigned }, { sort: { serial_no: 1 }, projection: { _id: 0, id: 1 } });
  if (sameBatch) {
    return { labelId: sameBatch.id, batchId: recalledBatch.id, batch_number: recalledBatch.batch_number, uom: recalledBatch.uom ?? null, viaSibling: false };
  }
  if (recalledBatch.batch_group_id != null) {
    const siblings = await ctx.find('batches', {
      batch_group_id: recalledBatch.batch_group_id,
      product_id: recalledBatch.product_id,
      status: 'QC_PASSED',
      tenant_id: tenantId,
      ...divisionScope,
    }, { sort: { batch_number: 1 }, projection: { _id: 0, id: 1, batch_number: 1, parent_batch_number: 1, uom: 1, quantity: 1 } });
    for (const sibling of siblings) {
      const label = await ctx.findOne('qr_labels', { batch_id: sibling.id, tenant_id: tenantId, ...divisionScope, ...unassigned }, { sort: { serial_no: 1 }, projection: { _id: 0, id: 1 } });
      if (label) {
        return { labelId: label.id, batchId: sibling.id, batch_number: sibling.batch_number, uom: sibling.uom ?? recalledBatch.uom ?? null, viaSibling: true };
      }
    }
  }
  return null;
}

/**
 * The packing list is frozen at order creation, but recalls and replacement
 * reloads change which bags make the truck. Keep the frozen items in sync
 * with the order's current lines so reprints show reality.
 */
async function syncPackingListItems(
  ctx: DbContext,
  orderId: unknown,
  lines: any[],
  tenantId: string | number,
  divisionScope: Record<string, any> | undefined,
  divisionId: string | number | null
): Promise<void> {
  await ctx.deleteMany('packing_list_items', { dispatch_order_id: orderId, tenant_id: tenantId, ...divisionScope });
  for (const line of Array.isArray(lines) ? lines : []) {
    if (!line?.batch_id) continue;
    const batch = await ctx.findOne('batches', { id: line?.batch_id, tenant_id: tenantId, ...divisionScope });
    if (!batch) continue;
    const location = batch.shelf_location_id
      ? await ctx.findOne('shelf_locations', { id: batch.shelf_location_id, tenant_id: tenantId, ...divisionScope }, { projection: { _id: 0, location_code: 1, description: 1 } })
      : null;
    await ctx.insert('packing_list_items', {
      dispatch_order_id: orderId,
      batch_id: batch.id,
      product_name: line?.product_name ?? null,
      product_sku: line?.product_sku ?? null,
      batch_number: line?.batch_number ?? batch.batch_number ?? null,
      quantity: numeric(line?.quantity),
      uom: line?.uom ?? batch.uom ?? null,
      location: location?.location_code ?? batch.storage_location ?? null,
      location_code: location?.location_code ?? batch.storage_location ?? null,
      location_description: location?.description ?? null,
      tenant_id: tenantId,
      division_id: divisionId,
    });
  }
}

/** Fetch the QR values assigned to the given dispatch order ids, grouped by order. */
async function assignedQrValues(
  ctx: DbContext,
  orderIds: unknown[],
  tenantId: string | number,
  divisionScope?: Record<string, any>
): Promise<Map<string, string[]>> {
  const ids = [...new Set(orderIds.filter((id) => id !== null && id !== undefined).map((id) => idKey(id)))];
  const map = new Map<string, string[]>();
  if (ids.length === 0) return map;
  const labels = await ctx.find('qr_labels', {
    dispatch_order_id: { $in: ids },
    tenant_id: tenantId,
    ...divisionScope,
  }, { sort: { serial_no: 1 }, projection: { _id: 0, dispatch_order_id: 1, qr_value: 1 } });
  for (const label of labels) {
    const key = idKey(label.dispatch_order_id);
    const list = map.get(key) || [];
    if (label.qr_value) list.push(String(label.qr_value));
    map.set(key, list);
  }
  return map;
}

export interface ReplacementReservation {
  /** Units that could NOT be covered by any spare printed label. */
  unfilled: number;
  /** Units covered by a spare label of the SAME batch (line stays put). */
  coveredSame: number;
  /** Units covered by sibling bags, grouped by sibling batch. */
  siblingPicks: Array<{ batch_id: unknown; batch_number: unknown; uom: unknown; quantity: number }>;
}

/**
 * Reserves replacement labels for `units` recalled units of `recalledBatch`,
 * one physical unit at a time. Sibling-bag replacements are reported grouped
 * per sibling batch so callers can append order lines for them.
 */
async function assignReplacements(
  ctx: DbContext,
  orderId: unknown,
  recalledBatch: Record<string, any>,
  units: number,
  tenantId: string | number,
  divisionScope?: Record<string, any>
): Promise<ReplacementReservation> {
  let unfilled = 0;
  let coveredSame = 0;
  const siblingGroups = new Map<string, { batch_id: unknown; batch_number: unknown; uom: unknown; quantity: number }>();
  for (let index = 0; index < Math.max(0, Math.floor(units)); index += 1) {
    const pick = await pickReplacementUnit(ctx, recalledBatch, tenantId, divisionScope);
    if (!pick) {
      unfilled += 1;
      continue;
    }
    await ctx.updateOne(
      'qr_labels',
      {
        id: pick.labelId,
        tenant_id: tenantId,
        ...divisionScope,
        $or: [{ dispatch_order_id: { $exists: false } }, { dispatch_order_id: null }],
      },
      { $set: { dispatch_order_id: orderId } }
    );
    if (pick.viaSibling) {
      const key = idKey(pick.batchId);
      const group = siblingGroups.get(key) ?? { batch_id: pick.batchId, batch_number: pick.batch_number, uom: pick.uom, quantity: 0 };
      group.quantity += 1;
      siblingGroups.set(key, group);
    } else {
      coveredSame += 1;
    }
  }
  return { unfilled, coveredSame, siblingPicks: [...siblingGroups.values()] };
}

interface SessionRow extends Record<string, any> {
  id: string;
}

/** Writes a scan event, omitting client_operation_id when absent so the sparse unique index is honoured. */
async function insertScanEvent(
  ctx: DbContext,
  sessionId: unknown,
  userId: unknown,
  qrValue: string,
  batchId: unknown,
  result: 'OK' | 'DUPLICATE' | 'WRONG_BATCH' | 'QTY_EXCEEDED',
  clientOperationId: string | null,
  tenantId: string | number,
  divisionId: string | number | null
): Promise<string> {
  const document: Record<string, any> = {
    session_id: sessionId,
    qr_value: qrValue,
    batch_id: batchId ?? null,
    result,
    scanned_by: userId,
    scanned_at: now(),
    tenant_id: tenantId,
    division_id: divisionId,
  };
  if (clientOperationId) document.client_operation_id = clientOperationId;
  return ctx.insert('loading_scan_events', document);
}

async function sendScanResponse(
  req: Request,
  res: Response,
  ctx: DbContext,
  session: SessionRow,
  result: 'OK' | 'DUPLICATE' | 'WRONG_BATCH' | 'QTY_EXCEEDED',
  eventId: string | null,
  duplicate: boolean
): Promise<void> {
  const scanned = numeric(session.scanned);
  const total = numeric(session.total);
  if (result === 'QTY_EXCEEDED') {
    res.status(409).json({
      result,
      code: 'QTY_EXCEEDED',
      scanned,
      total,
      error: 'The loaded quantity has reached the batch total',
      event_id: eventId,
      duplicate,
    });
    return;
  }
  res.status(200).json({ result, scanned, total, event_id: eventId, duplicate });
}

async function buildActiveSessions(
  ctx: DbContext,
  req: Request,
  loaderId?: string
): Promise<Record<string, any>[]> {
  const tenantId = req.user!.tenantId;
  const df = divisionFilter(req);
  const filter: Record<string, any> = { status: 'ACTIVE', tenant_id: tenantId, ...df };
  if (loaderId) filter.loader_id = loaderId;
  const sessions = await ctx.find('loading_sessions', filter, {
    sort: { started_at: -1 },
  });
  if (sessions.length === 0) return [];

  const lineBatchIds = sessions.flatMap((session) =>
    Array.isArray(session.order_lines)
      ? session.order_lines.map((line: any) => line?.batch_id)
      : []
  );
  const batches = await mapByIds<Record<string, any>>(
    ctx,
    'batches',
    [...sessions.map((session) => session.batch_id), ...lineBatchIds],
    tenantId,
    df
  );
  const products = await mapByIds<Record<string, any>>(
    ctx,
    'products',
    [...batches.values()].map((batch) => batch.product_id),
    tenantId,
    df
  );
  const grades = await mapByIds<Record<string, any>>(
    ctx,
    'grades',
    [...batches.values()].map((batch) => batch.grade_id),
    tenantId,
    df
  );
  const gradeNameForBatch = (batchId: any): string | null => {
    const batch = batches.get(idKey(batchId));
    if (!batch) return null;
    return grades.get(idKey(batch.grade_id))?.name
      ?? products.get(idKey(batch.product_id))?.grade
      ?? null;
  };
  const loaderNames = await mapNames(
    ctx,
    'dispatch_users',
    sessions.map((session) => session.loader_id)
  );
  // ADMIN may start a session on behalf of the dispatch team.
  const adminLoaders = await mapNames(
    ctx,
    'admins',
    sessions.map((session) => session.loader_id)
  );
  const lastEvents = await Promise.all(
    sessions.map((session) =>
      ctx.find('loading_scan_events', { session_id: session.id, tenant_id: tenantId, ...df }, {
        sort: { scanned_at: -1 },
        limit: 1,
      })
    )
  );
  const orders = await mapByIds<Record<string, any>>(
    ctx,
    'dispatch_orders',
    sessions.map((session) => session.dispatch_order_id),
    tenantId,
    df
  );
  const qrValuesByOrder = await assignedQrValues(
    ctx,
    sessions.map((session) => session.dispatch_order_id),
    tenantId,
    df
  );

  return sessions.map((session, index) => {
    const batch = batches.get(idKey(session.batch_id));
    const product = batch ? products.get(idKey(batch.product_id)) : undefined;
    const lastEvent = lastEvents[index][0];
    const scanned = numeric(session.scanned);
    const total = numeric(session.total);
    return {
      id: session.id,
      session_id: session.id,
      order_number: orders.get(idKey(session.dispatch_order_id))?.order_number ?? null,
      order_lines: session.order_lines ?? [],
      qr_values: qrValuesByOrder.get(idKey(session.dispatch_order_id)) ?? [],
      order_id: session.dispatch_order_id,
      dispatch_order_id: session.dispatch_order_id,
      batch_id: session.batch_id,
      batch_number: batch?.batch_number ?? null,
      product_name: Array.isArray(session.order_lines) && session.order_lines.length
        ? session.order_lines.map((line: any) => line.product_name).filter(Boolean).join(', ')
        : product?.name ?? null,
      grade_name: [...new Set(
        (Array.isArray(session.order_lines) && session.order_lines.length
          ? session.order_lines
          : [{ batch_id: session.batch_id }]
        ).map((line: any) => gradeNameForBatch(line?.batch_id)).filter(Boolean)
      )].join(', ') || session.grade_name || null,
      loader_name: loaderNames.get(idKey(session.loader_id))
        ?? adminLoaders.get(idKey(session.loader_id))
        ?? null,
      scanned,
      total,
      progress: total > 0 ? Math.round((scanned / total) * 100) : 0,
      started_at: session.started_at ?? null,
      updated_at: session.updated_at ?? null,
      last_event: lastEvent
        ? {
            result: lastEvent.result,
            qr_value: lastEvent.qr_value,
            scanned_at: lastEvent.scanned_at,
          }
        : null,
    };
  });
}

/** POST /api/loading-sessions */
export async function start(req: Request, res: Response): Promise<void> {
  const tenantId = req.user!.tenantId;
  const dispatchOrderId = req.body?.dispatch_order_id;
  if (!isValidId(dispatchOrderId)) {
    res.status(400).json({ error: 'A valid dispatch order id is required', code: 'INVALID_DISPATCH_ORDER_ID' });
    return;
  }

  try {
    const result = await withTransaction(async (ctx: DbContext) => {
      const df = divisionFilter(req);
      const order = await ctx.findOne('dispatch_orders', { id: dispatchOrderId, tenant_id: tenantId, ...df });
      if (!order) throw new SyncError('Dispatch order not found', 'ORDER_NOT_FOUND', 404);
      if (String(order.status) !== 'APPROVED') {
        throw new SyncError(
          `Loading can only start for an APPROVED order. Current status: ${order.status}`,
          'ORDER_NOT_APPROVED',
          409,
          { order_id: order.id, order_status: order.status }
        );
      }

      const batch = await ctx.findOne('batches', { id: order.batch_id, tenant_id: tenantId, ...df });
      if (!batch) throw new SyncError('Batch not found', 'BATCH_NOT_FOUND', 404);
      const orderLines = Array.isArray(order.order_lines) && order.order_lines.length
        ? order.order_lines.map((line: any) => ({ batch_id: line.batch_id, quantity: numeric(line.quantity), batch_number: line.batch_number, product_name: line.product_name, product_sku: line.product_sku, uom: line.uom }))
        : [{ batch_id: batch.id, quantity: numeric(order.quantity, numeric(batch.quantity)), batch_number: batch.parent_batch_number || batch.batch_number, product_name: null, product_sku: null, uom: batch.uom }];
      const total = orderLines.reduce((sum: number, line: any) => sum + line.quantity, 0);
      if (total <= 0) {
        throw new SyncError('Batch quantity must be greater than zero', 'INVALID_QUANTITY', 400, {
          batch_id: batch.id,
          quantity: batch.quantity ?? null,
        });
      }
      // Stored on the session so every later read (polls, resume, getById)
      // can show the grade without re-resolving it.
      const gradeName = await gradeNamesFor(
        ctx,
        orderLines.map((line: any) => line.batch_id),
        tenantId,
        df
      );

      const existing = await ctx.findOne(
        'loading_sessions',
        { status: 'ACTIVE', dispatch_order_id: order.id, tenant_id: tenantId, ...df }
      );
      if (existing) {
        throw new SyncError('An active loading session already exists for this order or batch', 'SESSION_EXISTS', 409, {
          session_id: existing.id,
          order_id: existing.dispatch_order_id,
          batch_id: existing.batch_id,
        });
      }

      const startedAt = now();
      let sessionId: string;
      try {
        sessionId = await ctx.insert('loading_sessions', {
          dispatch_order_id: order.id,
          order_number: order.order_number ?? null,
          batch_id: batch.id,
          batch_ids: orderLines.map((line: any) => line.batch_id),
          order_lines: orderLines,
          grade_name: gradeName,
          loader_id: req.user!.userId,
          status: 'ACTIVE',
          total,
          scanned: 0,
          seal_number: null,
          outcome: null,
          remarks: null,
          started_at: startedAt,
          completed_at: null,
          tenant_id: tenantId,
          division_id: divisionStamp(req),
        });
      } catch (error) {
        if (isDuplicateKey(error)) {
          throw new SyncError('An active loading session already exists for this order or batch', 'SESSION_EXISTS', 409);
        }
        throw error;
      }

      const product = batch.product_id
        ? await ctx.findOne('products', { id: batch.product_id, tenant_id: tenantId, ...df })
        : null;

      // The batch is now physically on the truck: move it to LOADING.
      for (const line of orderLines) {
        await ctx.updateOne(
          'batches',
          { id: line.batch_id, status: 'DISPATCH_APPROVED', tenant_id: tenantId, ...df },
          { $set: { status: 'LOADING' } }
        );
      }

      await logActivity(
        ctx,
        req.user!,
        'LOADING_SESSION_STARTED',
        `Loading session started for order ${order.id} / ${orderLines.length} product line(s). Total units: ${total}`,
        tenantId,
        divisionStamp(req)
      );

      const qrValues = (await assignedQrValues(ctx, [order.id], tenantId, df)).get(idKey(order.id)) ?? [];
      return {
        session: {
          id: sessionId,
          status: 'ACTIVE' as const,
          total,
          scanned: 0,
          dispatch_order_id: order.id,
          order_number: order.order_number ?? null,
          batch_id: batch.id,
          order_lines: orderLines,
          grade_name: gradeName,
          qr_values: qrValues,
        },
        order_id: order.id,
        order_number: order.order_number ?? null,
        batch_number: batch.batch_number ?? null,
        product_name: orderLines.map((line: any) => line.product_name).filter(Boolean).join(', ') || product?.name || null,
        grade_name: gradeName,
        order_lines: orderLines,
        qr_values: qrValues,
        total,
      };
    });

    publish(req, 'dispatch.loading-opened', { sessionId: result?.session?.id ?? null, orderId: result?.order_id ?? null, orderNumber: result?.order_number ?? null });
    res.status(201).json(result);
  } catch (error) {
    errorResponse(res, error, 'Could not start loading session');
  }
}

/** POST /api/loading-sessions/:id/scan */
export async function scan(req: Request, res: Response): Promise<void> {
  const tenantId = req.user!.tenantId;
  const id = req.params.id;
  if (!isValidId(id)) {
    res.status(400).json({ error: 'Invalid loading session id', code: 'INVALID_SESSION_ID' });
    return;
  }
  const qrValue = trimmed(req.body?.qr_value);
  if (!qrValue) {
    res.status(400).json({ error: 'qr_value is required', code: 'QR_VALUE_REQUIRED' });
    return;
  }
  const clientOperationId = optionalText(req.body?.client_operation_id, 64);

  try {
    const ctx = await getContext();
    const df = divisionFilter(req);
    const stamp = divisionStamp(req);
    const session = await ctx.findOne('loading_sessions', { id, tenant_id: tenantId, ...df }) as SessionRow | null;
    if (!session) throw new SyncError('Loading session not found', 'SESSION_NOT_FOUND', 404);
    if (String(session.status) !== 'ACTIVE') {
      throw new SyncError('This loading session is already closed', 'SESSION_CLOSED', 409, {
        session_id: session.id,
        status: session.status,
      });
    }

    if (clientOperationId) {
      const original = await ctx.findOne('loading_scan_events', {
        client_operation_id: clientOperationId,
        tenant_id: tenantId,
        ...df,
      });
      if (original) {
        if (idKey(original.session_id) !== idKey(session.id)) {
          throw new SyncError('This client_operation_id belongs to another loading session', 'OPERATION_CONFLICT', 409, {
            session_id: session.id,
            client_operation_id: clientOperationId,
          });
        }
        await sendScanResponse(
          req,
          res,
          ctx,
          session,
          original.result as 'OK' | 'DUPLICATE' | 'WRONG_BATCH' | 'QTY_EXCEEDED',
          original.id,
          true
        );
        return;
      }
    }

    const label = await ctx.findOne('qr_labels', { qr_value: qrValue, tenant_id: tenantId, ...df });
    const resolvedBatchId = label?.batch_id ?? null;
    const allowedBatchIds = Array.isArray(session.batch_ids) ? session.batch_ids : [session.batch_id];
    const batchMatches = Boolean(label) && allowedBatchIds.some((batchId: unknown) => idKey(batchId) === idKey(label!.batch_id)) && idKey(label!.dispatch_order_id) === idKey(session.dispatch_order_id);

    if (!batchMatches) {
      let eventId: string | null = null;
      if (clientOperationId) {
        try {
          eventId = await insertScanEvent(
            ctx,
            session.id,
            req.user!.userId,
            qrValue,
            resolvedBatchId,
            'WRONG_BATCH',
            clientOperationId,
            tenantId,
            stamp
          );
        } catch (error) {
          if (!isDuplicateKey(error)) throw error;
          const original = await ctx.findOne('loading_scan_events', { client_operation_id: clientOperationId, tenant_id: tenantId, ...df });
          eventId = original?.id ?? null;
        }
      }
      await sendScanResponse(req, res, ctx, session, 'WRONG_BATCH', eventId, false);
      return;
    }

    if (label?.recall_status === 'RECALLED') {
      res.status(409).json({ error: 'This QR label has been recalled and cannot be loaded', code: 'QR_RECALLED', result: 'RECALLED', scanned: numeric(session.scanned), total: numeric(session.total) });
      return;
    }

    // Only labels that were physically printed may be loaded onto a truck.
    if (Number(label?.print_count || 0) < 1) {
      res.status(409).json({
        error: 'This QR label was never printed and cannot be loaded',
        code: 'QR_NOT_PRINTED',
        result: 'QR_NOT_PRINTED',
        scanned: numeric(session.scanned),
        total: numeric(session.total),
      });
      return;
    }

    // A label loaded in ANY session of this order is physically on the truck,
    // even if that session was already sealed and the order reopened for a
    // replacement reload. Only currently-RECALLED labels may be offered again.
    const orderSessions = await ctx.find('loading_sessions', {
      dispatch_order_id: session.dispatch_order_id,
      tenant_id: tenantId,
      ...df,
    }, { projection: { _id: 0, id: 1 } });
    const orderSessionIds = orderSessions.map((orderSession) => orderSession.id);
    const alreadyScanned = await ctx.findOne('loading_scan_events', {
      session_id: { $in: orderSessionIds },
      qr_value: qrValue,
      result: 'OK',
      tenant_id: tenantId,
      ...df,
    });
    if (alreadyScanned) {
      let eventId: string | null = null;
      if (clientOperationId) {
        try {
          eventId = await insertScanEvent(
            ctx,
            session.id,
            req.user!.userId,
            qrValue,
            label!.batch_id,
            'DUPLICATE',
            clientOperationId,
            tenantId,
            stamp
          );
        } catch (error) {
          if (!isDuplicateKey(error)) throw error;
          const original = await ctx.findOne('loading_scan_events', { client_operation_id: clientOperationId, tenant_id: tenantId, ...df });
          eventId = original?.id ?? null;
        }
      }
      await sendScanResponse(req, res, ctx, session, 'DUPLICATE', eventId, false);
      return;
    }

    const scanned = numeric(session.scanned);
    const total = numeric(session.total);
    if (scanned >= total) {
      const eventId = await insertScanEvent(
        ctx,
        session.id,
        req.user!.userId,
        qrValue,
        label!.batch_id,
        'QTY_EXCEEDED',
        clientOperationId,
        tenantId,
        stamp
      );
      await sendScanResponse(req, res, ctx, session, 'QTY_EXCEEDED', eventId, false);
      return;
    }

    let eventId: string;
    try {
      eventId = await insertScanEvent(
        ctx,
        session.id,
        req.user!.userId,
        qrValue,
        label!.batch_id,
        'OK',
        clientOperationId,
        tenantId,
        stamp
      );
    } catch (error) {
      if (isDuplicateKey(error) && clientOperationId) {
        const original = await ctx.findOne('loading_scan_events', { client_operation_id: clientOperationId, tenant_id: tenantId, ...df });
        if (original) {
          await sendScanResponse(
            req,
            res,
            ctx,
            session,
            original.result as 'OK' | 'DUPLICATE' | 'WRONG_BATCH' | 'QTY_EXCEEDED',
            original.id,
            true
          );
          return;
        }
      }
      throw error;
    }

    const updated = await ctx.findOneAndUpdate(
      'loading_sessions',
      { id: session.id, status: 'ACTIVE', scanned: { $lt: total }, tenant_id: tenantId, ...df },
      { $inc: { scanned: 1 } },
      { returnDocument: 'after' }
    ) as SessionRow | null;
    if (!updated) {
      // The session closed or another scan took the final slot between the read
      // and the increment. Remove the OK event so the ledger stays consistent.
      try {
        await ctx.deleteOne('loading_scan_events', { id: eventId, tenant_id: tenantId, ...df });
      } catch (cleanupError) {
        console.error('Could not clean up rejected loading scan event', cleanupError);
      }
      throw new SyncError('Loading session was closed or reached its quantity limit', 'SESSION_CONFLICT', 409, {
        session_id: session.id,
        scanned,
        total,
      });
    }

    res.status(200).json({
      result: 'OK',
      scanned: numeric(updated.scanned, scanned + 1),
      total: numeric(updated.total, total),
      event_id: eventId,
      duplicate: false,
    });
  } catch (error) {
    errorResponse(res, error, 'Could not record loading scan');
  }
}

/** POST /api/loading-sessions/:id/recall-qr */
export async function recallQr(req: Request, res: Response): Promise<void> {
  const tenantId = req.user!.tenantId;
  const id = req.params.id;
  const qrValue = trimmed(req.body?.qr_value);
  const reason = trimmed(req.body?.reason).slice(0, 1000);
  const condition = trimmed(req.body?.condition).toUpperCase();
  if (!isValidId(id) || !qrValue || !reason || !['DAMAGED', 'HOLD', 'RETURN_TO_STOCK'].includes(condition)) {
    res.status(400).json({ error: 'Provide a valid QR code, recall reason, and condition', code: 'INVALID_RECALL_DETAILS' });
    return;
  }
  try {
    const result = await withTransaction(async (ctx: DbContext) => {
      const df = divisionFilter(req);
      const stamp = divisionStamp(req);
      const session = await ctx.findOne('loading_sessions', { id, status: 'ACTIVE', tenant_id: tenantId, ...df }) as SessionRow | null;
      if (!session) throw new SyncError('Active loading session not found', 'SESSION_NOT_FOUND', 404);
      if (req.user!.role === 'DISPATCH' && idKey(session.loader_id) !== idKey(req.user!.userId)) {
        throw new SyncError('You can only recall products from your own loading session', 'FORBIDDEN', 403);
      }
      const label = await ctx.findOne('qr_labels', { qr_value: qrValue, tenant_id: tenantId, ...df });
      if (!label) {
        throw new SyncError('This QR code is not in the system. Only QR codes from this batch can be recalled.', 'QR_NOT_FOUND', 404);
      }
      const allowedBatchIds = Array.isArray(session.batch_ids) ? session.batch_ids : [session.batch_id];
      if (!allowedBatchIds.some((batchId: unknown) => idKey(batchId) === idKey(label.batch_id))) {
        throw new SyncError('QR label does not belong to this batch.', 'QR_NOT_IN_BATCH', 404);
      }
      if (idKey(label.dispatch_order_id) !== idKey(session.dispatch_order_id)) {
        throw new SyncError('QR label is not reserved for this dispatch order (it may be unassigned or reserved by another order).', 'QR_NOT_IN_ORDER', 409);
      }
      if (label.recall_status === 'RECALLED') throw new SyncError('This QR label has already been recalled', 'QR_ALREADY_RECALLED', 409);
      // A unit that was already scanned into this session can be recalled before
      // the seal is recorded. Removing it frees the scanned slot so a replacement
      // unit can be scanned in the same session.
      const loadedUnits = await recallLoadedEvents(ctx, session.id, qrValue, tenantId, df);
      if (loadedUnits > 0) {
        await ctx.updateOne('loading_sessions', { id: session.id, status: 'ACTIVE', tenant_id: tenantId, ...df }, [
          { $set: { scanned: { $max: [0, { $subtract: [{ $ifNull: ['$scanned', 0] }, loadedUnits] }] }, updated_at: now() } },
        ]);
      }
      const batch = await ctx.findOne('batches', { id: label.batch_id, tenant_id: tenantId, ...df });
      if (!batch) throw new SyncError('Batch not found', 'BATCH_NOT_FOUND', 404);
      const update = await ctx.updateOne('qr_labels', { id: label.id, recall_status: { $ne: 'RECALLED' }, tenant_id: tenantId, ...df }, { $set: {
        recall_status: 'RECALLED', recall_condition: condition, recall_reason: reason,
        recalled_by: req.user!.userId, recalled_at: now(),
      } });
      if (update.matchedCount !== 1) throw new SyncError('This QR label was already recalled', 'QR_ALREADY_RECALLED', 409);
      if (loadedUnits === 0) {
        const sessionUpdate = await ctx.updateOne('loading_sessions', { id: session.id, status: 'ACTIVE', total: { $gt: numeric(session.scanned) }, tenant_id: tenantId, ...df }, { $inc: { total: -1 } });
        if (sessionUpdate.matchedCount !== 1) throw new SyncError('No unscanned units remain to recall', 'NO_UNSCANNED_UNITS', 409);
      }
      // The unit leaves this order, so the order stops expecting it — unless a
      // replacement bag can be reserved (same batch's spare, or a sibling bag
      // from the same production group), in which case the order simply waits
      // for the replacement to be scanned.
      const recalledUnits = loadedUnits > 0 ? loadedUnits : 1;
      const order = await ctx.findOne('dispatch_orders', { id: session.dispatch_order_id, tenant_id: tenantId, ...df });
      let siblingPicks: Array<{ batch_id: unknown; batch_number: unknown; uom: unknown; quantity: number }> = [];
      let replacementGap = 0;
      let siblingCovered = 0;
      let siblingProduct: Record<string, any> | null = null;
      if (order && loadedUnits > 0 && condition !== 'RETURN_TO_STOCK') {
        siblingProduct = await ctx.findOne('products', { id: batch.product_id, tenant_id: tenantId, ...df });
        const reservation = await assignReplacements(ctx, order.id, batch, loadedUnits, tenantId, df);
        siblingPicks = reservation.siblingPicks;
        replacementGap = reservation.unfilled;
        siblingCovered = reservation.siblingPicks.reduce((sum, pick) => sum + pick.quantity, 0);
      }
      // Lines leave with every recalled unit except units covered by the same
      // batch's spare label (the expectation stays on that batch). The order
      // quantity only shrinks for units with no replacement at all; sibling
      // replacements simply move the expectation to the sibling line.
      const isLoadedReplacement = loadedUnits > 0 && condition !== 'RETURN_TO_STOCK';
      const shrinkBy = loadedUnits > 0
        ? (isLoadedReplacement ? replacementGap : loadedUnits)
        : 1;
      const lineShrink = loadedUnits > 0
        ? (isLoadedReplacement ? siblingCovered + replacementGap : loadedUnits)
        : 1;
      if (order) {
        const orderLines = Array.isArray(order.order_lines) ? order.order_lines : [];
        let nextLines = lineShrink > 0 ? decrementOrderLines(orderLines, label.batch_id, lineShrink) : [...orderLines];
        if (siblingPicks.length) {
          nextLines = [
            ...nextLines,
            ...siblingPicks.map((pick) => ({
              batch_id: pick.batch_id,
              quantity: pick.quantity,
              batch_number: pick.batch_number ?? null,
              product_name: siblingProduct?.name ?? null,
              product_sku: siblingProduct?.sku ?? siblingProduct?.product_sku ?? null,
              uom: pick.uom ?? siblingProduct?.uom ?? null,
            })),
          ];
        }
        // Sibling bags now belong to this order, so the scan gate must accept them.
        if (siblingPicks.length) {
          const siblingUnits = siblingPicks.reduce((sum, pick) => sum + pick.quantity, 0);
          // Their units were never part of the order's reservation, so deduct them now.
          if (order.stock_reserved_at_order) {
            await deductProductStock(ctx, batch.product_id, siblingUnits, tenantId, df);
          }
          const existing = new Set((Array.isArray(session.batch_ids) ? session.batch_ids : [session.batch_id]).map((batchId) => idKey(batchId)));
          const additions = siblingPicks.map((pick) => pick.batch_id).filter((batchId) => !existing.has(idKey(batchId)));
          for (const addition of additions) {
            await ctx.updateOne('loading_sessions', { id: session.id, status: 'ACTIVE', tenant_id: tenantId, ...df }, { $addToSet: { batch_ids: addition } });
          }
          await ctx.updateMany('batches', { id: { $in: siblingPicks.map((pick) => pick.batch_id) }, tenant_id: tenantId, ...df }, { $set: { status: 'LOADING' } });
        }
        // A child batch whose line emptied is done for good: back to stock if
        // the unit returned, otherwise it never shipped.
        const recalledLineGone = !nextLines.some((line) => idKey(line?.batch_id) === idKey(label.batch_id));
        if (recalledLineGone) {
          await ctx.updateOne(
            'batches',
            { id: label.batch_id, tenant_id: tenantId, ...df },
            { $set: { status: condition === 'RETURN_TO_STOCK' ? 'QC_PASSED' : 'NOT_DISPATCHED' } }
          );
        }
        await syncPackingListItems(ctx, order.id, nextLines, tenantId, df, stamp);
        await ctx.updateOne('dispatch_orders', { id: order.id, tenant_id: tenantId, ...df }, [
          {
            $set: {
              order_lines: nextLines,
              quantity: { $max: [0, { $subtract: [{ $ifNull: ['$quantity', 0] }, shrinkBy] }] },
              recalled_quantity: { $add: [{ $ifNull: ['$recalled_quantity', 0] }, recalledUnits] },
              updated_at: now(),
            },
          },
        ]);
      }
      if (shrinkBy > 0 && loadedUnits > 0) {
        // No fresh label was available for the missing unit(s); reduce the
        // session target so the remaining units can complete the load.
        await ctx.updateOne('loading_sessions', { id: session.id, status: 'ACTIVE', tenant_id: tenantId, ...df }, [
          { $set: { total: { $max: [0, { $subtract: [{ $ifNull: ['$total', 0] }, shrinkBy] }] }, updated_at: now() } },
        ]);
      }
      if (condition === 'RETURN_TO_STOCK') {
        await ctx.updateOne('qr_labels', { id: label.id, dispatch_order_id: session.dispatch_order_id, tenant_id: tenantId, ...df }, { $set: { dispatch_order_id: null, recall_status: null, recall_condition: null, recall_reason: null, recalled_by: null, recalled_at: null } });
        // The unit left the stock when the order was created, so it goes back
        // on the shelf now.
        if (order?.stock_reserved_at_order) {
          await ctx.updateOne('products', { id: batch.product_id, tenant_id: tenantId, ...df }, { $inc: { quantity: recalledUnits } });
          await ctx.updateOne('dispatch_orders', { id: session.dispatch_order_id, tenant_id: tenantId, ...df }, { $inc: { returned_to_stock_quantity: recalledUnits } });
        }
      }
      if (loadedUnits > 0) {
        await ctx.updateOne('batches', { id: label.batch_id, tenant_id: tenantId, ...df }, [
          {
            $set: {
              recalled_quantity: { $add: [{ $ifNull: ['$recalled_quantity', 0] }, loadedUnits] },
              updated_at: now(),
            },
          },
        ]);
      }
      await logActivity(ctx, req.user!, 'DISPATCH_QR_RECALLED', `QR ${qrValue} recalled from batch ${batch.batch_number}; condition ${condition}; reason: ${reason}; loaded units recalled: ${loadedUnits}`, tenantId, stamp);
      const updated = await ctx.findOne('loading_sessions', { id: session.id, tenant_id: tenantId, ...df });
      return { message: loadedUnits > 0 ? 'Loaded QR label recalled and removed from the truck load' : 'QR label recalled and excluded from loading', condition, scanned: numeric(updated?.scanned), total: numeric(updated?.total), recalled_units: loadedUnits, unfilled_units: replacementGap };
    });
    res.json(result);
  } catch (error) { errorResponse(res, error, 'Could not recall QR label'); }
}

/**
 * POST /api/loading-sessions/:id/recall-sealed
 *
 * Recalls a unit that was loaded and sealed inside the container (session
 * CLOSED). The scanned events are flipped to RECALLED so the audit trail
 * survives, the batch counters are adjusted, and a `loading_recalls` record is
 * written so the dispatcher can later reload replacement units against the same
 * dispatch order with POST /:id/reload.
 */
export async function recallSealed(req: Request, res: Response): Promise<void> {
  const tenantId = req.user!.tenantId;
  const id = req.params.id;
  const qrValue = trimmed(req.body?.qr_value);
  const reason = trimmed(req.body?.reason).slice(0, 1000);
  const condition = trimmed(req.body?.condition).toUpperCase();
  if (!isValidId(id) || !qrValue || !reason || !['DAMAGED', 'HOLD', 'RETURN_TO_STOCK'].includes(condition)) {
    res.status(400).json({ error: 'Provide a valid QR code, recall reason, and condition', code: 'INVALID_RECALL_DETAILS' });
    return;
  }
  try {
    const result = await withTransaction(async (ctx: DbContext) => {
      const df = divisionFilter(req);
      const stamp = divisionStamp(req);
      const session = await ctx.findOne('loading_sessions', { id, tenant_id: tenantId, ...df }) as SessionRow | null;
      if (!session) throw new SyncError('Loading session not found', 'SESSION_NOT_FOUND', 404);
      if (req.user!.role === 'DISPATCH' && idKey(session.loader_id) !== idKey(req.user!.userId)) {
        throw new SyncError('You can only recall products from your own loading sessions', 'FORBIDDEN', 403);
      }
      if (String(session.status) !== 'CLOSED') {
        throw new SyncError('This container is not sealed yet. Use the in-session recall instead.', 'SESSION_NOT_SEALED', 409, {
          session_id: session.id,
          status: session.status,
        });
      }
      const outcome = trimmed(String(session.outcome ?? '')).toUpperCase();
      const label = await ctx.findOne('qr_labels', { qr_value: qrValue, tenant_id: tenantId, ...df });
      if (!label) {
        throw new SyncError('This QR code is not in the system. Only units loaded in this sealed session can be recalled.', 'QR_NOT_FOUND', 404);
      }
      const allowedBatchIds = Array.isArray(session.batch_ids) ? session.batch_ids : [session.batch_id];
      if (!allowedBatchIds.some((batchId: unknown) => idKey(batchId) === idKey(label.batch_id))) {
        throw new SyncError('QR label does not belong to this batch.', 'QR_NOT_IN_BATCH', 404);
      }
      if (idKey(label.dispatch_order_id) !== idKey(session.dispatch_order_id)) {
        throw new SyncError('QR label is not reserved for this dispatch order.', 'QR_NOT_IN_ORDER', 409);
      }
      if (label.recall_status === 'RECALLED') {
        throw new SyncError('This QR label has already been recalled', 'QR_ALREADY_RECALLED', 409);
      }
      const loadedUnits = await recallLoadedEvents(ctx, session.id, qrValue, tenantId, df);
      if (loadedUnits === 0) {
        throw new SyncError('This QR label was not loaded in the sealed session', 'NOT_LOADED', 409);
      }
      const batch = await ctx.findOne('batches', { id: label.batch_id, tenant_id: tenantId, ...df });
      if (!batch) throw new SyncError('Batch not found', 'BATCH_NOT_FOUND', 404);
      const order = await ctx.findOne('dispatch_orders', { id: session.dispatch_order_id, tenant_id: tenantId, ...df });

      // Flag the label, unless it is being physically returned to stock: then it
      // is unassigned and goes back to the shelf exactly like an in-session recall.
      if (condition === 'RETURN_TO_STOCK') {
        await ctx.updateOne('qr_labels', { id: label.id, tenant_id: tenantId, ...df }, { $set: { dispatch_order_id: null, recall_status: null, recall_condition: null, recall_reason: null, recalled_by: null, recalled_at: null } });
      } else {
        await ctx.updateOne('qr_labels', { id: label.id, recall_status: { $ne: 'RECALLED' }, tenant_id: tenantId, ...df }, { $set: {
          recall_status: 'RECALLED', recall_condition: condition, recall_reason: reason,
          recalled_by: req.user!.userId, recalled_at: now(),
        } });
      }

      // Batch bookkeeping: a recalled unit inflates the recalled counter and,
      // for a dispatched order, releases one unit of the shipped quantity.
      await ctx.updateOne('batches', { id: label.batch_id, tenant_id: tenantId, ...df }, [
        {
          $set: {
            recalled_quantity: { $add: [{ $ifNull: ['$recalled_quantity', 0] }, loadedUnits] },
            dispatched_quantity: { $max: [0, { $subtract: [{ $ifNull: ['$dispatched_quantity', 0] }, outcome === 'DISPATCHED' ? loadedUnits : 0] }] },
            updated_at: now(),
          },
        },
      ]);

      // Stock: exactly one of these deductions happened per unit during the
      // order's lifecycle, and all of them already restored stock at the
      // NOT_DISPATCHED finalise. Only a dispatched unit out on a truck that is
      // returned to the shelf is put back here.
      if (condition === 'RETURN_TO_STOCK' && outcome === 'DISPATCHED' && order) {
        await ctx.updateOne('products', { id: batch.product_id, tenant_id: tenantId, ...df }, { $inc: { quantity: loadedUnits } });
        await ctx.updateOne('dispatch_orders', { id: order.id, tenant_id: tenantId, ...df }, { $inc: { returned_to_stock_quantity: loadedUnits } });
      }

      // Order bookkeeping: account the recall and queue it for a reload.
      if (order) {
        const orderLines = Array.isArray(order.order_lines) ? order.order_lines : [];
        const orderLinesAfter = decrementOrderLines(orderLines, label.batch_id, loadedUnits);
        // A child batch whose line emptied is done and will never ship as
        // part of this order. Leaving it out of the QC_PASSED pool also stops
        // another order from grabbing the returned bag before this order
        // reloads its replacement.
        const recalledBatchGone = !orderLinesAfter.some((line) => idKey(line?.batch_id) === idKey(label.batch_id));
        if (recalledBatchGone) {
          await ctx.updateOne(
            'batches',
            { id: label.batch_id, tenant_id: tenantId, ...df },
            { $set: { status: 'NOT_DISPATCHED' } }
          );
        }
        await syncPackingListItems(ctx, order.id, orderLinesAfter, tenantId, df, stamp);
        await ctx.updateOne('dispatch_orders', { id: order.id, tenant_id: tenantId, ...df }, [
          {
            $set: {
              order_lines: orderLinesAfter,
              quantity: { $max: [0, { $subtract: [{ $ifNull: ['$quantity', 0] }, loadedUnits] }] },
              recalled_quantity: { $add: [{ $ifNull: ['$recalled_quantity', 0] }, loadedUnits] },
              reload_pending: { $add: [{ $ifNull: ['$reload_pending', 0] }, loadedUnits] },
              updated_at: now(),
            },
          },
        ]);
      }
      await ctx.updateOne('loading_sessions', { id: session.id, tenant_id: tenantId, ...df }, [
        {
          $set: {
            recalled_quantity: { $add: [{ $ifNull: ['$recalled_quantity', 0] }, loadedUnits] },
            updated_at: now(),
          },
        },
      ]);
      await ctx.insert('loading_recalls', {
        session_id: session.id,
        dispatch_order_id: session.dispatch_order_id,
        batch_id: label.batch_id,
        qr_value: qrValue,
        condition,
        reason,
        recalled_by: req.user!.userId,
        recalled_at: now(),
        reloaded: false,
        tenant_id: tenantId,
        division_id: stamp,
      });
      await logActivity(ctx, req.user!, 'DISPATCH_SEALED_QR_RECALLED', `Sealed QR ${qrValue} recalled from batch ${batch.batch_number}; condition ${condition}; reason: ${reason}`, tenantId, stamp);
      const updatedOrder = await ctx.findOne('dispatch_orders', { id: session.dispatch_order_id, tenant_id: tenantId, ...df });
      return {
        message: 'Sealed unit recalled. Use "Reload new product" to load a replacement against this order.',
        condition,
        recalled_units: loadedUnits,
        reload_pending: numeric(updatedOrder?.reload_pending),
        order_quantity: numeric(updatedOrder?.quantity),
      };
    });
    publish(req, 'dispatch.loading-recalled', { sessionId: id });
    res.json(result);
  } catch (error) {
    errorResponse(res, error, 'Could not recall the sealed unit');
  }
}

/**
 * POST /api/loading-sessions/:id/reload
 *
 * Reopens a dispatch order whose (sealed) loading session had units recalled so
 * replacement units can be loaded against it. The order goes back to APPROVED
 * with `quantity` equal to the number of recalled units still awaiting a
 * replacement; the dispatcher can then start a fresh loading session on the
 * same order (start-session -> scan -> seal). The original sealed session stays
 * CLOSED as the historical record.
 */
export async function reloadOrder(req: Request, res: Response): Promise<void> {
  const tenantId = req.user!.tenantId;
  const id = req.params.id;
  if (!isValidId(id)) {
    res.status(400).json({ error: 'Invalid loading session id', code: 'INVALID_SESSION_ID' });
    return;
  }
  try {
    const result = await withTransaction(async (ctx: DbContext) => {
      const df = divisionFilter(req);
      const stamp = divisionStamp(req);
      const session = await ctx.findOne('loading_sessions', { id, tenant_id: tenantId, ...df }) as SessionRow | null;
      if (!session) throw new SyncError('Loading session not found', 'SESSION_NOT_FOUND', 404);
      if (req.user!.role === 'DISPATCH' && idKey(session.loader_id) !== idKey(req.user!.userId)) {
        throw new SyncError('You can only reload products for your own loading sessions', 'FORBIDDEN', 403);
      }
      if (String(session.status) !== 'CLOSED') {
        throw new SyncError('Only a sealed (CLOSED) container can be reloaded with new product', 'SESSION_NOT_SEALED', 409, {
          session_id: session.id,
          status: session.status,
        });
      }
      const order = await ctx.findOne('dispatch_orders', { id: session.dispatch_order_id, tenant_id: tenantId, ...df });
      if (!order) throw new SyncError('Dispatch order not found', 'ORDER_NOT_FOUND', 404);
      const recalls = await ctx.find('loading_recalls', {
        dispatch_order_id: order.id,
        reloaded: false,
        tenant_id: tenantId,
        ...df,
      });
      if (recalls.length === 0) {
        throw new SyncError('No recalled units are awaiting a reload for this order', 'NOTHING_TO_RELOAD', 409);
      }

      // Build replacement demand per recalled batch from the pending recall
      // records, then reserve fresh physical units: a spare label printed for
      // the same batch, or a sibling bag from the same production group.
      const byBatch = new Map<string, { batch_id: unknown; quantity: number }>();
      for (const recall of recalls) {
        const key = idKey(recall.batch_id);
        const entry = byBatch.get(key) ?? { batch_id: recall.batch_id, quantity: 0 };
        entry.quantity += 1;
        byBatch.set(key, entry);
      }
      const orderLines: any[] = [];
      let totalPending = 0;
      let unfilledLabels = 0;
      const siblingLines = new Map<string, any>();
      for (const { batch_id, quantity } of byBatch.values()) {
        const recalledBatch = await ctx.findOne('batches', { id: batch_id, tenant_id: tenantId, ...df });
        if (!recalledBatch) throw new SyncError('Batch not found', 'BATCH_NOT_FOUND', 404, { batch_id });
        const product = recalledBatch.product_id
          ? await ctx.findOne('products', { id: recalledBatch.product_id, tenant_id: tenantId, ...df })
          : null;
        const reservation = await assignReplacements(ctx, order.id, recalledBatch, quantity, tenantId, df);
        unfilledLabels += reservation.unfilled;
        if (reservation.coveredSame > 0) {
          orderLines.push({
            batch_id: recalledBatch.id,
            quantity: reservation.coveredSame,
            batch_number: recalledBatch.parent_batch_number || recalledBatch.batch_number || null,
            product_name: product?.name ?? null,
            product_sku: product?.sku ?? product?.product_sku ?? null,
            uom: recalledBatch.uom ?? product?.uom ?? null,
          });
          totalPending += reservation.coveredSame;
        }
        for (const pick of reservation.siblingPicks) {
          const key = idKey(pick.batch_id);
          const line = siblingLines.get(key) ?? {
            batch_id: pick.batch_id,
            quantity: 0,
            batch_number: pick.batch_number ?? null,
            product_name: product?.name ?? null,
            product_sku: product?.sku ?? product?.product_sku ?? null,
            uom: pick.uom ?? product?.uom ?? null,
          };
          line.quantity += pick.quantity;
          siblingLines.set(key, line);
        }
      }
      for (const sibling of siblingLines.values()) {
        orderLines.push(sibling);
        totalPending += sibling.quantity;
      }

      // Reserved orders had stock left the shelf at order creation already; the
      // replacement units are new reservations and must be deducted now.
      if (order.stock_reserved_at_order) {
        for (const line of orderLines) {
          const lineBatch = await ctx.findOne('batches', { id: line.batch_id, tenant_id: tenantId, ...df });
          if (lineBatch?.product_id) {
            await deductProductStock(ctx, lineBatch.product_id, line.quantity, tenantId, df);
          }
        }
      }

      const recalledIds = recalls.map((recall) => recall.id).filter(Boolean);
      if (recalledIds.length) {
        await ctx.updateMany('loading_recalls', { id: { $in: recalledIds }, tenant_id: tenantId, ...df }, { $set: { reloaded: true, reloaded_at: now() } });
      }

      await syncPackingListItems(ctx, order.id, orderLines, tenantId, df, stamp);

      await ctx.updateOne('dispatch_orders', { id: order.id, tenant_id: tenantId, ...df }, {
        $set: {
          status: 'APPROVED',
          quantity: totalPending,
          order_lines: orderLines,
          reload_pending: 0,
          outcome: null,
          seal_number: null,
          remarks: null,
          dispatched_at: null,
          updated_at: now(),
        },
      });

      // Every batch in the reopened order — including sibling bags picked as
      // replacements (they are QC_PASSED) — becomes loadable again.
      for (const line of orderLines) {
        await ctx.updateOne(
          'batches',
          { id: line.batch_id, tenant_id: tenantId, ...df },
          { $set: { status: 'DISPATCH_APPROVED' } }
        );
      }

      await logActivity(
        ctx,
        req.user!,
        'DISPATCH_ORDER_RELOADED',
        `Dispatch order ${order.order_number ?? order.id} reopened for ${totalPending} replacement unit(s) after recalls (session ${session.id})`,
        tenantId,
        stamp
      );
      return {
        message: 'Order reopened for replacement loading',
        order_id: order.id,
        order_number: order.order_number ?? null,
        quantity: totalPending,
        order_lines: orderLines,
        unfilled_units: unfilledLabels,
      };
    });
    publish(req, 'dispatch.loading-reopened', { sessionId: id });
    res.status(200).json(result);
  } catch (error) {
    errorResponse(res, error, 'Could not reload the order');
  }
}

/**
 * GET /api/loading-sessions/by-order/:orderId
 *
 * Returns the latest CLOSED (sealed) loading session for a dispatch order so
 * the orders list can offer post-seal recall / reload actions after the
 * finalise screen is dismissed.
 */
export async function latestClosedByOrder(req: Request, res: Response): Promise<void> {
  const tenantId = req.user!.tenantId;
  const orderId = req.params.orderId;
  if (!isValidId(orderId)) {
    res.status(400).json({ error: 'Invalid dispatch order id', code: 'INVALID_DISPATCH_ORDER_ID' });
    return;
  }
  try {
    const ctx = await getContext();
    const df = divisionFilter(req);
    const order = await ctx.findOne('dispatch_orders', { id: orderId, tenant_id: tenantId, ...df });
    if (!order) {
      res.status(404).json({ error: 'Dispatch order not found', code: 'ORDER_NOT_FOUND' });
      return;
    }
    const session = await ctx.findOne('loading_sessions', { dispatch_order_id: order.id, status: 'CLOSED', tenant_id: tenantId, ...df }, { sort: { completed_at: -1 } });
    res.json({
      session_id: session?.id ?? null,
      reload_pending: numeric(order.reload_pending),
      recalled_quantity: numeric(order.recalled_quantity),
      order_status: order.status ?? null,
      seal_number: session?.seal_number ?? order.seal_number ?? null,
    });
  } catch (error) {
    errorResponse(res, error, 'Could not look up the sealed session');
  }
}

/** GET /api/loading-sessions/active */
export async function active(req: Request, res: Response): Promise<void> {
  try {
    const ctx = await getContext();
    // Dispatchers only see their own session, so the scan screen can resume it.
    const loaderId = req.user?.role === 'DISPATCH' ? idKey(req.user.userId) : undefined;
    res.json(await buildActiveSessions(ctx, req, loaderId));
  } catch (error) {
    errorResponse(res, error, 'Could not load active loading sessions');
  }
}

/** GET /api/loading-sessions/active/stream */
export async function stream(req: Request, res: Response): Promise<void> {
  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  if (typeof res.flushHeaders === 'function') res.flushHeaders();

  let closed = false;
  let timer: NodeJS.Timeout | null = null;

  const cleanup = (): void => {
    if (closed) return;
    closed = true;
    if (timer) clearInterval(timer);
    timer = null;
  };

  const send = async (): Promise<void> => {
    if (closed) return;
    try {
      const ctx = await getContext();
      const payload = await buildActiveSessions(ctx, req);
      if (closed) return;
      res.write(`event: loading\ndata: ${JSON.stringify(payload)}\n\n`);
    } catch (error) {
      // A disconnected client or a transient database error must not crash the
      // process; the next tick simply retries.
      console.error('Loading session stream tick failed:', error);
    }
  };

  req.on('close', cleanup);
  res.on('close', cleanup);
  res.on('error', cleanup);

  await send();
  if (!closed) {
    timer = setInterval(() => {
      void send();
    }, 2000);
  }
}

/** GET /api/loading-sessions/:id */
export async function getById(req: Request, res: Response): Promise<void> {
  const tenantId = req.user!.tenantId;
  const id = req.params.id;
  if (!isValidId(id)) {
    res.status(400).json({ error: 'Invalid loading session id', code: 'INVALID_SESSION_ID' });
    return;
  }

  try {
    const ctx = await getContext();
    const df = divisionFilter(req);
    const session = await ctx.findOne('loading_sessions', { id, tenant_id: tenantId, ...df });
    if (!session) {
      res.status(404).json({ error: 'Loading session not found', code: 'SESSION_NOT_FOUND' });
      return;
    }
    if (req.user!.role === 'DISPATCH' && idKey(session.loader_id) !== idKey(req.user!.userId)) {
      res.status(403).json({ error: 'You can only view your own loading sessions', code: 'FORBIDDEN' });
      return;
    }

    const [batch, events, loader, adminLoader] = await Promise.all([
      ctx.findOne('batches', { id: session.batch_id, tenant_id: tenantId, ...df }),
      ctx.find('loading_scan_events', { session_id: session.id, tenant_id: tenantId, ...df }, {
        sort: { scanned_at: -1 },
        limit: 50,
      }),
      ctx.findOne('dispatch_users', { id: session.loader_id }),
      ctx.findOne('admins', { id: session.loader_id }),
    ]);
    const qrValues = (await assignedQrValues(ctx, [session.dispatch_order_id], tenantId, df)).get(idKey(session.dispatch_order_id)) ?? [];
    const product = batch?.product_id
      ? await ctx.findOne('products', { id: batch.product_id, tenant_id: tenantId, ...df })
      : null;
    // New sessions store grade_name at start; older ones resolve it here from
    // the main batch (the orders list still supplies the full multi-grade
    // string as a fallback on the client).
    const gradeName = session.grade_name
      ?? (batch?.grade_id
        ? (await ctx.findOne('grades', { id: batch.grade_id, tenant_id: tenantId, ...df }, { projection: { _id: 0, name: 1 } }))?.name
        : null)
      ?? product?.grade
      ?? null;

    res.json({
      session: {
        ...session,
        batch_number: batch?.batch_number ?? null,
        qr_values: qrValues,
        product_name: Array.isArray(session.order_lines) && session.order_lines.length
          ? session.order_lines.map((line: any) => line.product_name).filter(Boolean).join(', ')
          : product?.name ?? null,
        grade_name: gradeName,
        loader_name: loader?.name ?? adminLoader?.name ?? null,
      },
      events,
    });
  } catch (error) {
    errorResponse(res, error, 'Could not load loading session');
  }
}

/** POST /api/loading-sessions/:id/finalise */
export async function finalise(req: Request, res: Response): Promise<void> {
  const tenantId = req.user!.tenantId;
  const id = req.params.id;
  if (!isValidId(id)) {
    res.status(400).json({ error: 'Invalid loading session id', code: 'INVALID_SESSION_ID' });
    return;
  }

  const driverName = trimmed(req.body?.driver_name).slice(0, 150);
  const driverPhone = trimmed(req.body?.driver_phone).slice(0, 32) || null;
  const vehicleNumber = trimmed(req.body?.vehicle_number).slice(0, 50);
  const containerNumber = trimmed(req.body?.container_number).slice(0, 100);
  const sealNumber = trimmed(req.body?.seal_number).slice(0, 100) || null;
  const outcome = trimmed(req.body?.outcome).toUpperCase();
  if (!['DISPATCHED', 'NOT_DISPATCHED'].includes(outcome)) {
    res.status(400).json({
      error: "outcome must be 'DISPATCHED' or 'NOT_DISPATCHED'",
      code: 'INVALID_OUTCOME',
    });
    return;
  }
  const remarks = optionalText(req.body?.remarks);
  const clientOperationId = optionalText(req.body?.client_operation_id, 64);

  try {
    const result = await withTransaction(async (ctx: DbContext) => {
      const df = divisionFilter(req);
      const stamp = divisionStamp(req);
      const session = await ctx.findOne('loading_sessions', { id, tenant_id: tenantId, ...df });
      if (!session) throw new SyncError('Loading session not found', 'SESSION_NOT_FOUND', 404);
      if (req.user!.role === 'DISPATCH' && idKey(session.loader_id) !== idKey(req.user!.userId)) {
        throw new SyncError('You can only finalise your own loading sessions', 'FORBIDDEN', 403);
      }
      if (String(session.status) !== 'ACTIVE') {
        throw new SyncError('This loading session is already closed', 'SESSION_CLOSED', 409, {
          session_id: session.id,
          status: session.status,
        });
      }

      const order = await ctx.findOne('dispatch_orders', { id: session.dispatch_order_id, tenant_id: tenantId, ...df });
      if (!order) throw new SyncError('Dispatch order not found', 'ORDER_NOT_FOUND', 404);
      const batch = await ctx.findOne('batches', { id: session.batch_id, tenant_id: tenantId, ...df });
      if (!batch) throw new SyncError('Batch not found', 'BATCH_NOT_FOUND', 404);

      // The transporter details are captured when the order is created, so the
      // finalise step only has to send what the loader wants to correct. Fall
      // back to the values already stored on the order.
      const resolvedDriverName = driverName || String(order.driver_name ?? '').trim().slice(0, 150);
      const resolvedDriverPhone = driverPhone || String(order.driver_phone ?? '').trim().slice(0, 32) || null;
      const resolvedVehicleNumber = vehicleNumber || String(order.vehicle_number ?? '').trim().slice(0, 50);
      const resolvedContainerNumber = containerNumber || String(order.container_number ?? '').trim().slice(0, 100);
      if (!resolvedDriverName || !resolvedVehicleNumber || !resolvedContainerNumber) {
        throw new SyncError(
          'Transporter name, vehicle and container details are required',
          'SHIPMENT_DETAILS_REQUIRED',
          400
        );
      }

      const completedAt = now();
      const sessionUpdate = await ctx.updateOne(
        'loading_sessions',
        { id: session.id, status: 'ACTIVE', tenant_id: tenantId, ...df },
        {
          $set: {
            status: 'CLOSED',
            seal_number: sealNumber,
            outcome,
            remarks,
            completed_at: completedAt,
          },
        }
      );
      if (sessionUpdate.matchedCount !== 1) {
        throw new SyncError('This loading session is already closed', 'SESSION_CLOSED', 409, {
          session_id: session.id,
        });
      }

      const orderStatus = outcome === 'DISPATCHED' ? 'CLOSED_DISPATCHED' : 'CLOSED_NOT_DISPATCHED';
      await ctx.updateOne(
        'dispatch_orders',
        { id: order.id, tenant_id: tenantId, ...df },
        {
          $set: {
            status: orderStatus,
            driver_name: resolvedDriverName,
            driver_phone: resolvedDriverPhone,
            vehicle_number: resolvedVehicleNumber,
            container_number: resolvedContainerNumber,
            seal_number: sealNumber,
            outcome,
            dispatched_at: outcome === 'DISPATCHED' ? completedAt : order.dispatched_at ?? null,
            remarks,
          },
        }
      );

      // The order is closed, so every batch it held reaches its terminal
      // status: shipped out, or returned to stock.
      const finalBatchStatus = outcome === 'DISPATCHED' ? 'DISPATCHED' : 'NOT_DISPATCHED';
      const finalBatchIds = Array.isArray(order.order_lines) && order.order_lines.length
        ? order.order_lines.map((line: any) => line.batch_id).filter((batchId: any) => batchId !== undefined && batchId !== null)
        : [batch.id];
      for (const batchId of finalBatchIds) {
        await ctx.updateOne(
          'batches',
          { id: batchId, tenant_id: tenantId, ...df },
          { $set: { status: finalBatchStatus } }
        );
      }

      const dispatchRecord: Record<string, any> = {
        batch_id: batch.id,
        dispatch_order_id: order.id,
        session_id: session.id,
        dispatched: outcome === 'DISPATCHED' ? 1 : 0,
        dispatcher_id: req.user!.userId,
        remarks,
        tenant_id: tenantId,
        division_id: stamp,
      };
      if (clientOperationId) dispatchRecord.client_operation_id = clientOperationId;
      const dispatchRecordId = await ctx.insert('dispatch_records', dispatchRecord);

      if (outcome === 'NOT_DISPATCHED' && order.stock_reserved_at_order) {
        // The units were taken out of the stock when the order was created.
        // Units that were recalled back to the shelf already went back then,
        // so everything the order still expects to be loaded comes back now.
        const orderLines = Array.isArray(order.order_lines) && order.order_lines.length
          ? order.order_lines
          : [{ batch_id: batch.id, quantity: numeric(order.quantity, numeric(session.total)) }];
        const restores = new Map<string, { productId: unknown; quantity: number }>();
        for (const line of orderLines) {
          const lineQuantity = numeric(line?.quantity);
          if (!lineQuantity) continue;
          const lineBatch = await ctx.findOne(
            'batches',
            { id: line?.batch_id, tenant_id: tenantId, ...df },
            { projection: { _id: 0, product_id: 1 } }
          );
          if (!lineBatch) continue;
          const key = idKey(lineBatch.product_id);
          const existing = restores.get(key);
          restores.set(key, {
            productId: lineBatch.product_id,
            quantity: (existing?.quantity || 0) + lineQuantity,
          });
        }
        for (const entry of restores.values()) {
          await ctx.updateOne('products', { id: entry.productId, tenant_id: tenantId, ...df }, { $inc: { quantity: entry.quantity } });
        }
      } else if (outcome === 'NOT_DISPATCHED' && !order.stock_reserved_at_order) {
        const batchIds = Array.isArray(order.order_lines) && order.order_lines.length
          ? order.order_lines.map((line: any) => line.batch_id)
          : [batch.id];
        await ctx.updateMany('qr_labels', { batch_id: { $in: batchIds }, dispatch_order_id: order.id, recall_status: { $ne: 'RECALLED' }, tenant_id: tenantId, ...df }, { $set: { dispatch_order_id: null } });
      } else if (outcome === 'DISPATCHED' && !order.stock_reserved_at_order && Array.isArray(order.order_lines) && order.order_lines.length > 0) {
        const loadedEvents = await ctx.find('loading_scan_events', { session_id: session.id, result: 'OK', tenant_id: tenantId, ...df }, { projection: { _id: 0, qr_value: 1, batch_id: 1 } });
        for (const line of order.order_lines) {
          const lineBatch = await ctx.findOne('batches', { id: line.batch_id, tenant_id: tenantId, ...df });
          if (!lineBatch) continue;
          const loadedForLine = loadedEvents.filter((event) => idKey(event.batch_id) === idKey(line.batch_id));
          if (loadedForLine.length) {
            await deductProductStock(ctx, lineBatch.product_id, loadedForLine.length, tenantId, df);
            await ctx.updateOne('batches', { id: line.batch_id, tenant_id: tenantId, ...df }, { $inc: { dispatched_quantity: loadedForLine.length } });
          }
          const loadedQrValues = loadedForLine.map((event) => event.qr_value);
          await ctx.updateMany('qr_labels', {
            batch_id: line.batch_id,
            dispatch_order_id: order.id,
            recall_status: { $ne: 'RECALLED' },
            qr_value: { $nin: loadedQrValues },
            tenant_id: tenantId,
            ...df,
          }, { $set: { dispatch_order_id: null } });
        }
      } else if (outcome === 'DISPATCHED' && !order.stock_reserved_at_order) {
        // New orders deduct only the units actually scanned and loaded.
        // Older orders marked stock_reserved_at_order were already deducted
        // when created and must not be charged a second time.
        const quantity = numeric(session.scanned);
        if (quantity > 0) {
          await deductProductStock(ctx, batch.product_id, quantity, tenantId, df);
          await ctx.updateOne('batches', { id: batch.id, tenant_id: tenantId, ...df }, { $inc: { dispatched_quantity: quantity } });
        }
        const loadedLabels = await ctx.find('loading_scan_events', { session_id: session.id, result: 'OK', tenant_id: tenantId, ...df }, { projection: { _id: 0, qr_value: 1 } });
        const loadedQrValues = loadedLabels.map((label) => label.qr_value);
        await ctx.updateMany('qr_labels', {
          batch_id: batch.id,
          dispatch_order_id: order.id,
          recall_status: { $ne: 'RECALLED' },
          qr_value: { $nin: loadedQrValues },
          tenant_id: tenantId,
          ...df,
        }, { $set: { dispatch_order_id: null } });
      }

      await logActivity(
        ctx,
        req.user!,
        'SEAL_NUMBER_RECORDED',
        `Seal number ${sealNumber} recorded for loading session ${session.id} (batch ${batch.batch_number})`,
        tenantId,
        stamp
      );
      await logActivity(
        ctx,
        req.user!,
        outcome,
        `Loading session ${session.id} for batch ${batch.batch_number} finalised as ${outcome}. Scanned ${numeric(session.scanned)} of ${numeric(session.total)}`,
        tenantId,
        stamp
      );

      const scanned = numeric(session.scanned);
      const total = numeric(session.total);
      if (outcome === 'DISPATCHED' && scanned < total) {
        await logActivity(
          ctx,
          req.user!,
          'LOADING_SHORTFALL_DISPATCHED',
          `Shortfall anomaly: dispatch completed for batch ${batch.batch_number} with ${scanned}/${total} units scanned`,
          tenantId,
          stamp
        );
      }

      const closedSession = await ctx.findOne('loading_sessions', { id: session.id, tenant_id: tenantId, ...df });
      return {
        session: closedSession,
        order_status: orderStatus,
        batch_status: finalBatchStatus,
        dispatch_record_id: dispatchRecordId,
        loaded_quantity: outcome === 'DISPATCHED' ? scanned : 0,
      };
    });

    publish(req, 'dispatch.loading-closed', { sessionId: id, status: 'CLOSED' });
    res.status(200).json(result);
  } catch (error) {
    errorResponse(res, error, 'Could not finalise loading session');
  }
}

/**
 * POST /api/loading-sessions/:id/cancel
 *
 * Lets a dispatcher abandon a session they opened by mistake. Only allowed
 * before the first unit is scanned: once anything is loaded the session must be
 * finalised so the dispatch record and stock remain consistent. Cancelling puts
 * the batch back into DISPATCH_APPROVED so the order can be loaded again.
 */
export async function cancel(req: Request, res: Response): Promise<void> {
  const tenantId = req.user!.tenantId;
  const id = req.params.id;
  if (!isValidId(id)) {
    res.status(400).json({ error: 'Invalid loading session id', code: 'INVALID_SESSION_ID' });
    return;
  }

  try {
    const result = await withTransaction(async (ctx: DbContext) => {
      const df = divisionFilter(req);
      const stamp = divisionStamp(req);
      const session = await ctx.findOne('loading_sessions', { id, tenant_id: tenantId, ...df });
      if (!session) throw new SyncError('Loading session not found', 'SESSION_NOT_FOUND', 404);
      if (req.user!.role === 'DISPATCH' && idKey(session.loader_id) !== idKey(req.user!.userId)) {
        throw new SyncError('You can only cancel your own loading sessions', 'FORBIDDEN', 403);
      }
      if (String(session.status) !== 'ACTIVE') {
        throw new SyncError('This loading session is already closed', 'SESSION_CLOSED', 409, {
          session_id: session.id,
          status: session.status,
        });
      }

      const scanned = numeric(session.scanned);
      if (scanned > 0) {
        throw new SyncError(
          'This session already has scanned units and cannot be cancelled. Finalise it instead.',
          'SESSION_HAS_SCANS',
          409,
          { session_id: session.id, scanned, total: numeric(session.total) }
        );
      }

      const cancelledAt = now();
      const updated = await ctx.updateOne(
        'loading_sessions',
        { id: session.id, status: 'ACTIVE', scanned: 0, tenant_id: tenantId, ...df },
        {
          $set: {
            status: 'CANCELLED',
            cancelled_at: cancelledAt,
            completed_at: cancelledAt,
          },
        }
      );
      if (updated.matchedCount !== 1) {
        // A scan slipped in between the read and the update.
        throw new SyncError(
          'This session already has scanned units and cannot be cancelled. Finalise it instead.',
          'SESSION_HAS_SCANS',
          409,
          { session_id: session.id }
        );
      }

      const batch = await ctx.findOne('batches', { id: session.batch_id, tenant_id: tenantId, ...df });
      if (batch) {
        await ctx.updateOne(
          'batches',
          { id: batch.id, status: 'LOADING', tenant_id: tenantId, ...df },
          { $set: { status: 'DISPATCH_APPROVED' } }
        );
      }

      await logActivity(
        ctx,
        req.user!,
        'LOADING_SESSION_CANCELLED',
        `Loading session ${session.id} cancelled before any scan (batch ${batch?.batch_number ?? session.batch_id})`,
        tenantId,
        stamp
      );

      const cancelledSession = await ctx.findOne('loading_sessions', { id: session.id, tenant_id: tenantId, ...df });
      return {
        session: cancelledSession,
        order_status: 'APPROVED',
        batch_status: 'DISPATCH_APPROVED',
      };
    });

    res.status(200).json(result);
  } catch (error) {
    errorResponse(res, error, 'Could not cancel loading session');
  }
}
