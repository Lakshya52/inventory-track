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

async function logActivity(
  ctx: DbContext,
  user: NonNullable<Request['user']>,
  action: string,
  description: string
): Promise<void> {
  await ctx.insert('activity_logs', {
    user_id: user.userId,
    user_name: user.name || user.role,
    user_role: user.role,
    action,
    description,
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
  quantity: number
): Promise<number | null> {
  if (!isValidId(productId) || !Number.isFinite(quantity) || quantity <= 0) {
    return null;
  }
  const result = await ctx.findOneAndUpdate('products', { id: productId }, [
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
  clientOperationId: string | null
): Promise<string> {
  const document: Record<string, any> = {
    session_id: sessionId,
    qr_value: qrValue,
    batch_id: batchId ?? null,
    result,
    scanned_by: userId,
    scanned_at: now(),
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
  loaderId?: string
): Promise<Record<string, any>[]> {
  const filter: Record<string, any> = { status: 'ACTIVE' };
  if (loaderId) filter.loader_id = loaderId;
  const sessions = await ctx.find('loading_sessions', filter, {
    sort: { started_at: -1 },
  });
  if (sessions.length === 0) return [];

  const batches = await mapByIds<Record<string, any>>(
    ctx,
    'batches',
    sessions.map((session) => session.batch_id)
  );
  const products = await mapByIds<Record<string, any>>(
    ctx,
    'products',
    [...batches.values()].map((batch) => batch.product_id)
  );
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
      ctx.find('loading_scan_events', { session_id: session.id }, {
        sort: { scanned_at: -1 },
        limit: 1,
      })
    )
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
      order_lines: session.order_lines ?? [],
      order_id: session.dispatch_order_id,
      dispatch_order_id: session.dispatch_order_id,
      batch_id: session.batch_id,
      batch_number: batch?.batch_number ?? null,
      product_name: Array.isArray(session.order_lines) && session.order_lines.length
        ? session.order_lines.map((line: any) => line.product_name).filter(Boolean).join(', ')
        : product?.name ?? null,
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
  const dispatchOrderId = req.body?.dispatch_order_id;
  if (!isValidId(dispatchOrderId)) {
    res.status(400).json({ error: 'A valid dispatch order id is required', code: 'INVALID_DISPATCH_ORDER_ID' });
    return;
  }

  try {
    const result = await withTransaction(async (ctx: DbContext) => {
      const order = await ctx.findOne('dispatch_orders', { id: dispatchOrderId });
      if (!order) throw new SyncError('Dispatch order not found', 'ORDER_NOT_FOUND', 404);
      if (String(order.status) !== 'APPROVED') {
        throw new SyncError(
          `Loading can only start for an APPROVED order. Current status: ${order.status}`,
          'ORDER_NOT_APPROVED',
          409,
          { order_id: order.id, order_status: order.status }
        );
      }

      const batch = await ctx.findOne('batches', { id: order.batch_id });
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

      const existing = await ctx.findOne(
        'loading_sessions',
        { status: 'ACTIVE', dispatch_order_id: order.id }
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
          batch_id: batch.id,
          batch_ids: orderLines.map((line: any) => line.batch_id),
          order_lines: orderLines,
          loader_id: req.user!.userId,
          status: 'ACTIVE',
          total,
          scanned: 0,
          seal_number: null,
          outcome: null,
          remarks: null,
          started_at: startedAt,
          completed_at: null,
        });
      } catch (error) {
        if (isDuplicateKey(error)) {
          throw new SyncError('An active loading session already exists for this order or batch', 'SESSION_EXISTS', 409);
        }
        throw error;
      }

      const product = batch.product_id
        ? await ctx.findOne('products', { id: batch.product_id })
        : null;

      await logActivity(
        ctx,
        req.user!,
        'LOADING_SESSION_STARTED',
        `Loading session started for order ${order.id} / ${orderLines.length} product line(s). Total units: ${total}`
      );

      return {
        session: {
          id: sessionId,
          status: 'ACTIVE' as const,
          total,
          scanned: 0,
          dispatch_order_id: order.id,
          batch_id: batch.id,
          order_lines: orderLines,
        },
        order_id: order.id,
        batch_number: batch.batch_number ?? null,
        product_name: orderLines.map((line: any) => line.product_name).filter(Boolean).join(', ') || product?.name || null,
        order_lines: orderLines,
        total,
      };
    });

    res.status(201).json(result);
  } catch (error) {
    errorResponse(res, error, 'Could not start loading session');
  }
}

/** POST /api/loading-sessions/:id/scan */
export async function scan(req: Request, res: Response): Promise<void> {
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
    const session = await ctx.findOne('loading_sessions', { id }) as SessionRow | null;
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

    const label = await ctx.findOne('qr_labels', { qr_value: qrValue });
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
            clientOperationId
          );
        } catch (error) {
          if (!isDuplicateKey(error)) throw error;
          const original = await ctx.findOne('loading_scan_events', { client_operation_id: clientOperationId });
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

    const alreadyScanned = await ctx.findOne('loading_scan_events', {
      session_id: session.id,
      qr_value: qrValue,
      result: 'OK',
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
            clientOperationId
          );
        } catch (error) {
          if (!isDuplicateKey(error)) throw error;
          const original = await ctx.findOne('loading_scan_events', { client_operation_id: clientOperationId });
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
        clientOperationId
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
        clientOperationId
      );
    } catch (error) {
      if (isDuplicateKey(error) && clientOperationId) {
        const original = await ctx.findOne('loading_scan_events', { client_operation_id: clientOperationId });
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
      { id: session.id, status: 'ACTIVE', scanned: { $lt: total } },
      { $inc: { scanned: 1 } },
      { returnDocument: 'after' }
    ) as SessionRow | null;
    if (!updated) {
      // The session closed or another scan took the final slot between the read
      // and the increment. Remove the OK event so the ledger stays consistent.
      try {
        await ctx.deleteOne('loading_scan_events', { id: eventId });
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
      const session = await ctx.findOne('loading_sessions', { id, status: 'ACTIVE' }) as SessionRow | null;
      if (!session) throw new SyncError('Active loading session not found', 'SESSION_NOT_FOUND', 404);
      if (req.user!.role === 'DISPATCH' && idKey(session.loader_id) !== idKey(req.user!.userId)) {
        throw new SyncError('You can only recall products from your own loading session', 'FORBIDDEN', 403);
      }
      const label = await ctx.findOne('qr_labels', { qr_value: qrValue, dispatch_order_id: session.dispatch_order_id });
      if (!label) throw new SyncError('QR label does not belong to this batch', 'QR_NOT_IN_BATCH', 404);
      const allowedBatchIds = Array.isArray(session.batch_ids) ? session.batch_ids : [session.batch_id];
      if (!allowedBatchIds.some((batchId: unknown) => idKey(batchId) === idKey(label.batch_id))) throw new SyncError('QR label does not belong to this dispatch order', 'QR_NOT_IN_BATCH', 404);
      if (label.recall_status === 'RECALLED') throw new SyncError('This QR label has already been recalled', 'QR_ALREADY_RECALLED', 409);
      const scanned = await ctx.findOne('loading_scan_events', { session_id: session.id, qr_value: qrValue, result: 'OK' });
      if (scanned) throw new SyncError('This QR was already accepted as loaded and cannot be recalled from this session', 'QR_ALREADY_LOADED', 409);
      const batch = await ctx.findOne('batches', { id: label.batch_id });
      if (!batch) throw new SyncError('Batch not found', 'BATCH_NOT_FOUND', 404);
      const update = await ctx.updateOne('qr_labels', { id: label.id, recall_status: { $ne: 'RECALLED' } }, { $set: {
        recall_status: 'RECALLED', recall_condition: condition, recall_reason: reason,
        recalled_by: req.user!.userId, recalled_at: now(),
      } });
      if (update.matchedCount !== 1) throw new SyncError('This QR label was already recalled', 'QR_ALREADY_RECALLED', 409);
      const sessionUpdate = await ctx.updateOne('loading_sessions', { id: session.id, status: 'ACTIVE', total: { $gt: numeric(session.scanned) } }, { $inc: { total: -1 } });
      if (sessionUpdate.matchedCount !== 1) throw new SyncError('No unscanned units remain to recall', 'NO_UNSCANNED_UNITS', 409);
      // New orders do not reduce stock until dispatch finalization. For a
      // legacy order that reserved stock at creation, restore this unit now.
      if (condition === 'RETURN_TO_STOCK') {
        await ctx.updateOne('qr_labels', { id: label.id, dispatch_order_id: session.dispatch_order_id }, { $set: { dispatch_order_id: null, recall_status: null, recall_condition: null, recall_reason: null, recalled_by: null, recalled_at: null } });
        const order = await ctx.findOne('dispatch_orders', { id: session.dispatch_order_id });
        if (order?.stock_reserved_at_order) {
          await ctx.updateOne('products', { id: batch.product_id }, { $inc: { quantity: 1 } });
          await ctx.updateOne('dispatch_orders', { id: session.dispatch_order_id }, { $inc: { returned_to_stock_quantity: 1 } });
        }
      }
      await logActivity(ctx, req.user!, 'DISPATCH_QR_RECALLED', `QR ${qrValue} recalled from batch ${batch.batch_number}; condition ${condition}; reason: ${reason}`);
      const updated = await ctx.findOne('loading_sessions', { id: session.id });
      return { message: 'QR label recalled and excluded from loading', condition, scanned: numeric(updated?.scanned), total: numeric(updated?.total) };
    });
    res.json(result);
  } catch (error) { errorResponse(res, error, 'Could not recall QR label'); }
}

/** GET /api/loading-sessions/active */
export async function active(req: Request, res: Response): Promise<void> {
  try {
    const ctx = await getContext();
    // Dispatchers only see their own session, so the scan screen can resume it.
    const loaderId = req.user?.role === 'DISPATCH' ? idKey(req.user.userId) : undefined;
    res.json(await buildActiveSessions(ctx, loaderId));
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
      const payload = await buildActiveSessions(ctx);
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
  const id = req.params.id;
  if (!isValidId(id)) {
    res.status(400).json({ error: 'Invalid loading session id', code: 'INVALID_SESSION_ID' });
    return;
  }

  try {
    const ctx = await getContext();
    const session = await ctx.findOne('loading_sessions', { id });
    if (!session) {
      res.status(404).json({ error: 'Loading session not found', code: 'SESSION_NOT_FOUND' });
      return;
    }
    if (req.user!.role === 'DISPATCH' && idKey(session.loader_id) !== idKey(req.user!.userId)) {
      res.status(403).json({ error: 'You can only view your own loading sessions', code: 'FORBIDDEN' });
      return;
    }

    const [batch, events, loader, adminLoader] = await Promise.all([
      ctx.findOne('batches', { id: session.batch_id }),
      ctx.find('loading_scan_events', { session_id: session.id }, {
        sort: { scanned_at: -1 },
        limit: 50,
      }),
      ctx.findOne('dispatch_users', { id: session.loader_id }),
      ctx.findOne('admins', { id: session.loader_id }),
    ]);
    const product = batch?.product_id
      ? await ctx.findOne('products', { id: batch.product_id })
      : null;

    res.json({
      session: {
        ...session,
        batch_number: batch?.batch_number ?? null,
        product_name: Array.isArray(session.order_lines) && session.order_lines.length
          ? session.order_lines.map((line: any) => line.product_name).filter(Boolean).join(', ')
          : product?.name ?? null,
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
  if (!driverName || !vehicleNumber || !containerNumber) {
    res.status(400).json({ error: 'Driver, vehicle, and container details are required', code: 'SHIPMENT_DETAILS_REQUIRED' });
    return;
  }
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
      const session = await ctx.findOne('loading_sessions', { id });
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

      const order = await ctx.findOne('dispatch_orders', { id: session.dispatch_order_id });
      if (!order) throw new SyncError('Dispatch order not found', 'ORDER_NOT_FOUND', 404);
      const batch = await ctx.findOne('batches', { id: session.batch_id });
      if (!batch) throw new SyncError('Batch not found', 'BATCH_NOT_FOUND', 404);

      const completedAt = now();
      const sessionUpdate = await ctx.updateOne(
        'loading_sessions',
        { id: session.id, status: 'ACTIVE' },
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
        { id: order.id },
        {
          $set: {
            status: orderStatus,
            driver_name: driverName,
            driver_phone: driverPhone,
            vehicle_number: vehicleNumber,
            container_number: containerNumber,
            seal_number: sealNumber,
            outcome,
            dispatched_at: outcome === 'DISPATCHED' ? completedAt : order.dispatched_at ?? null,
            remarks,
          },
        }
      );

      const batchStatus = batch.status;

      const dispatchRecord: Record<string, any> = {
        batch_id: batch.id,
        dispatch_order_id: order.id,
        session_id: session.id,
        dispatched: outcome === 'DISPATCHED' ? 1 : 0,
        dispatcher_id: req.user!.userId,
        remarks,
      };
      if (clientOperationId) dispatchRecord.client_operation_id = clientOperationId;
      const dispatchRecordId = await ctx.insert('dispatch_records', dispatchRecord);

      if (outcome === 'NOT_DISPATCHED' && order.stock_reserved_at_order) {
        const returnedLabels = await ctx.count('qr_labels', { batch_id: batch.id, dispatch_order_id: order.id, recall_condition: 'RETURN_TO_STOCK' });
        const restoreQuantity = Math.max(0, numeric(order.quantity, numeric(session.total)) - Math.max(returnedLabels, numeric(order.returned_to_stock_quantity)));
        if (restoreQuantity > 0) {
          await ctx.updateOne('products', { id: batch.product_id }, { $inc: { quantity: restoreQuantity } });
        }
      } else if (outcome === 'NOT_DISPATCHED' && !order.stock_reserved_at_order) {
        const batchIds = Array.isArray(order.order_lines) && order.order_lines.length
          ? order.order_lines.map((line: any) => line.batch_id)
          : [batch.id];
        await ctx.updateMany('qr_labels', { batch_id: { $in: batchIds }, dispatch_order_id: order.id, recall_status: { $ne: 'RECALLED' } }, { $set: { dispatch_order_id: null } });
      } else if (outcome === 'DISPATCHED' && !order.stock_reserved_at_order && Array.isArray(order.order_lines) && order.order_lines.length > 0) {
        const loadedEvents = await ctx.find('loading_scan_events', { session_id: session.id, result: 'OK' }, { projection: { _id: 0, qr_value: 1, batch_id: 1 } });
        for (const line of order.order_lines) {
          const lineBatch = await ctx.findOne('batches', { id: line.batch_id });
          if (!lineBatch) continue;
          const loadedForLine = loadedEvents.filter((event) => idKey(event.batch_id) === idKey(line.batch_id));
          if (loadedForLine.length) await deductProductStock(ctx, lineBatch.product_id, loadedForLine.length);
          const loadedQrValues = loadedForLine.map((event) => event.qr_value);
          await ctx.updateMany('qr_labels', {
            batch_id: line.batch_id,
            dispatch_order_id: order.id,
            recall_status: { $ne: 'RECALLED' },
            qr_value: { $nin: loadedQrValues },
          }, { $set: { dispatch_order_id: null } });
        }
      } else if (outcome === 'DISPATCHED' && !order.stock_reserved_at_order) {
        // New orders deduct only the units actually scanned and loaded.
        // Older orders marked stock_reserved_at_order were already deducted
        // when created and must not be charged a second time.
        const quantity = numeric(session.scanned);
        if (quantity > 0) await deductProductStock(ctx, batch.product_id, quantity);
        const loadedLabels = await ctx.find('loading_scan_events', { session_id: session.id, result: 'OK' }, { projection: { _id: 0, qr_value: 1 } });
        const loadedQrValues = loadedLabels.map((label) => label.qr_value);
        await ctx.updateMany('qr_labels', {
          batch_id: batch.id,
          dispatch_order_id: order.id,
          recall_status: { $ne: 'RECALLED' },
          qr_value: { $nin: loadedQrValues },
        }, { $set: { dispatch_order_id: null } });
      }

      await logActivity(
        ctx,
        req.user!,
        'SEAL_NUMBER_RECORDED',
        `Seal number ${sealNumber} recorded for loading session ${session.id} (batch ${batch.batch_number})`
      );
      await logActivity(
        ctx,
        req.user!,
        outcome,
        `Loading session ${session.id} for batch ${batch.batch_number} finalised as ${outcome}. Scanned ${numeric(session.scanned)} of ${numeric(session.total)}`
      );

      const scanned = numeric(session.scanned);
      const total = numeric(session.total);
      if (outcome === 'DISPATCHED' && scanned < total) {
        await logActivity(
          ctx,
          req.user!,
          'LOADING_SHORTFALL_DISPATCHED',
          `Shortfall anomaly: dispatch completed for batch ${batch.batch_number} with ${scanned}/${total} units scanned`
        );
      }

      const closedSession = await ctx.findOne('loading_sessions', { id: session.id });
      return {
        session: closedSession,
        order_status: orderStatus,
        batch_status: batchStatus,
        dispatch_record_id: dispatchRecordId,
        loaded_quantity: outcome === 'DISPATCHED' ? scanned : 0,
      };
    });

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
  const id = req.params.id;
  if (!isValidId(id)) {
    res.status(400).json({ error: 'Invalid loading session id', code: 'INVALID_SESSION_ID' });
    return;
  }

  try {
    const result = await withTransaction(async (ctx: DbContext) => {
      const session = await ctx.findOne('loading_sessions', { id });
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
        { id: session.id, status: 'ACTIVE', scanned: 0 },
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

      const batch = await ctx.findOne('batches', { id: session.batch_id });
      if (batch) {
        await ctx.updateOne(
          'batches',
          { id: batch.id, status: 'LOADING' },
          { $set: { status: 'DISPATCH_APPROVED' } }
        );
      }

      await logActivity(
        ctx,
        req.user!,
        'LOADING_SESSION_CANCELLED',
        `Loading session ${session.id} cancelled before any scan (batch ${batch?.batch_number ?? session.batch_id})`
      );

      const cancelledSession = await ctx.findOne('loading_sessions', { id: session.id });
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
