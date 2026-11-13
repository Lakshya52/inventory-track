import { Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { query, withTransaction } from '../config/database.mysql';
import { RowDataPacket } from 'mysql2';
import type { PoolConnection } from 'mysql2/promise';
import { applyOperation, SyncConflictError, SyncError } from '../services/syncService';
import { SyncOperationInput } from '../types';
import { buildPackingListPdf } from '../services/packingListPdf';

function errorResponse(res: Response, error: unknown, fallback: string): void {
  if (error instanceof SyncError) {
    res.status(error.httpStatus).json({ error: error.message, code: error.code, ...(error.details || {}) });
    return;
  }
  console.error(fallback, error);
  res.status(500).json({ error: fallback });
}

function parseOrderLines(value: unknown): any[] {
  let items: any = value;
  if (typeof items === 'string') {
    try { items = JSON.parse(items); } catch { items = []; }
  }
  return Array.isArray(items) ? items : [];
}

async function gradeNamesForBatches(batchIds: number[]): Promise<Map<string, string | null>> {
  const uniqueIds = [...new Set(batchIds.filter((batchId) => Number.isInteger(batchId) && batchId > 0))];
  if (!uniqueIds.length) return new Map();
  const rows = await query<RowDataPacket[]>(
    `SELECT b.id AS batch_id, COALESCE(g.name, p.grade) AS grade_name
     FROM batches b
     JOIN products p ON b.product_id = p.id
     LEFT JOIN grades g ON g.id = b.grade_id
     WHERE b.id IN (?)`,
    [uniqueIds]
  );
  return new Map(rows.map((row) => [String(row.batch_id), row.grade_name ?? null]));
}

async function withOrderLines(
  orders: any[],
  gradeByBatch?: Map<string, string | null>
): Promise<any[]> {
  const grades = gradeByBatch ?? await gradeNamesForBatches(
    orders.flatMap((order) =>
      parseOrderLines(order.order_lines).map((line: any) => Number(line?.batch_id))
    )
  );
  return orders.map((order) => {
    let items = order.order_lines;
    if (typeof items === 'string') { try { items = JSON.parse(items); } catch { items = []; } }
    if (!Array.isArray(items)) items = [];
    if (!items.length) items = [{ batch_id: order.batch_id, batch_number: order.batch_number, product_name: order.product_name, product_sku: order.product_sku, quantity: order.quantity, uom: order.uom, location: order.storage_location || null }];
    const lineGradeNames = [...new Set(
      items.map((item: any) => grades.get(String(item.batch_id))).filter(Boolean)
    )];
    return {
      ...order,
      items,
      batch_number: items.length === 1 ? items[0].batch_number : 'Multi-product order',
      product_name: items.map((item: any) => item.product_name).filter(Boolean).join(', ') || order.product_name,
      grade_name: lineGradeNames.length > 0 ? lineGradeNames.join(', ') : order.grade_name ?? order.product_grade ?? null,
    };
  });
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
      batch_id: batchId ? Number(batchId) : undefined,
      barcode_value: barcodeValue ? String(barcodeValue) : undefined,
      expected_status: req.body.expected_status || undefined,
      client_id: Number(req.body.client_id),
      quantity: req.body.quantity,
      items: items?.map((item: any) => ({ batch_id: Number(item.batch_id), quantity: item.quantity })),
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
    res.status(applied.status === 'CONFLICT' ? 409 : 400).json({
      error: applied.error || 'Could not raise dispatch order',
      code: applied.error_code,
      ...(applied.data || {}),
    });
  } catch (error) {
    errorResponse(res, error, 'Could not raise dispatch order');
  }
}

function searchClause(q: string): { sql: string; params: string[] } {
  if (!q) return { sql: '', params: [] };
  return {
    sql: 'AND (b.batch_number LIKE ? OR p.name LIKE ? OR p.sku LIKE ? OR d.order_number LIKE ?)',
    params: [`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`],
  };
}

export async function listAll(req: Request, res: Response): Promise<void> {
  const q = String(req.query.q || '').trim();
  const status = String(req.query.status || '').toUpperCase();
  const search = searchClause(q);
  const where = ['1=1'];
  const params: any[] = [];
  if (['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'].includes(status)) {
    where.push('d.status = ?');
    params.push(status);
  }
  params.push(...search.params);
  const orders = await query<RowDataPacket[]>(
    `SELECT d.*, b.batch_number, b.barcode_value, COALESCE(d.quantity, b.quantity) AS quantity, b.uom, b.status AS batch_status,
            p.name AS product_name,
            p.sku AS product_sku, p.grade AS product_grade, g.name AS grade_name,
            q.name AS bag_quantity_name, q.quantity AS bag_quantity, q.unit AS bag_quantity_unit,
            u.name AS raised_by_name, a.name AS admin_name,
            c.name AS client_name, d.container_number,
            COALESCE(aa.name, qu.name, du.name) AS approver_name
     FROM dispatch_orders d
     JOIN batches b ON d.batch_id = b.id
     JOIN products p ON b.product_id = p.id
     LEFT JOIN grades g ON g.id = b.grade_id
     LEFT JOIN bag_quantities q ON q.id = b.bag_quantity_id
     LEFT JOIN dispatch_users u ON d.raised_by = u.id
     LEFT JOIN clients c ON c.id = d.client_id
     LEFT JOIN admins a ON d.admin_id = a.id
     LEFT JOIN admins aa ON d.approved_by_id = aa.id AND d.approved_by_role = 'ADMIN'
     LEFT JOIN qc_users qu ON d.approved_by_id = qu.id AND d.approved_by_role = 'QC'
     LEFT JOIN dispatch_users du ON d.approved_by_id = du.id AND d.approved_by_role = 'DISPATCH'
     WHERE ${where.join(' AND ')} ${search.sql}
     ORDER BY d.created_at DESC LIMIT 100`,
    params
  );
  res.json(await withOrderLines(orders));
}

export async function listMine(req: Request, res: Response): Promise<void> {
  const q = String(req.query.q || '').trim();
  const status = String(req.query.status || '').toUpperCase();
  const search = searchClause(q);
  const where = ['d.raised_by = ?'];
  const params: any[] = [req.user!.userId];
  if (['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'].includes(status)) {
    where.push('d.status = ?');
    params.push(status);
  }
  params.push(...search.params);
  const orders = await query<RowDataPacket[]>(
    `SELECT d.*, b.batch_number, b.barcode_value, COALESCE(d.quantity, b.quantity) AS quantity, b.uom, b.status AS batch_status,
            p.name AS product_name,
            p.sku AS product_sku, p.grade AS product_grade, g.name AS grade_name,
            q.name AS bag_quantity_name, q.quantity AS bag_quantity, q.unit AS bag_quantity_unit,
            a.name AS admin_name, c.name AS client_name,
            d.container_number, COALESCE(aa.name, qu.name, du.name) AS approver_name
     FROM dispatch_orders d
     JOIN batches b ON d.batch_id = b.id
     JOIN products p ON b.product_id = p.id
     LEFT JOIN grades g ON g.id = b.grade_id
     LEFT JOIN bag_quantities q ON q.id = b.bag_quantity_id
     LEFT JOIN admins a ON d.admin_id = a.id
     LEFT JOIN admins aa ON d.approved_by_id = aa.id AND d.approved_by_role = 'ADMIN'
     LEFT JOIN qc_users qu ON d.approved_by_id = qu.id AND d.approved_by_role = 'QC'
     LEFT JOIN dispatch_users du ON d.approved_by_id = du.id AND d.approved_by_role = 'DISPATCH'
     LEFT JOIN clients c ON c.id = d.client_id
     WHERE ${where.join(' AND ')} ${search.sql}
     ORDER BY d.created_at DESC LIMIT 100`,
    params
  );
  res.json(await withOrderLines(orders));
}

/**
 * Dispatch orders need no approval: raising one releases it straight away.
 * A raised order can still be cancelled by the dispatcher who raised it (or
 * an administrator) as long as loading has not started yet. Cancelling frees
 * the reserved QR labels and puts the stock back on the shelf.
 */
export async function cancel(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  const rawRemarks = req.body.admin_remarks ?? req.body.remarks;
  const remarks = rawRemarks === null || rawRemarks === undefined ? '' : String(rawRemarks).trim();
  if (!remarks) {
    res.status(400).json({ error: 'A reason is required to cancel a dispatch order' });
    return;
  }
  try {
    const result = await withTransaction(async (conn) => {
      const [orders] = await conn.execute<RowDataPacket[]>(
        'SELECT * FROM dispatch_orders WHERE id = ? FOR UPDATE',
        [id]
      );
      if (orders.length === 0) throw new SyncError('Dispatch order not found', 'ORDER_NOT_FOUND', 404);
      const order = orders[0];
      if (req.user!.role !== 'ADMIN' && Number(order.raised_by) !== Number(req.user!.userId)) {
        throw new SyncError('You can only cancel a dispatch order you raised', 'FORBIDDEN', 403);
      }
      if (order.status !== 'APPROVED') {
        throw new SyncConflictError(`Order is already ${order.status}`, { order_id: order.id, status: order.status });
      }

      const cancelLines = parseOrderLines(order.order_lines);
      const releaseBatchIds = cancelLines.length
        ? cancelLines.map((line: any) => Number(line?.batch_id)).filter((batchId: number) => Number.isInteger(batchId) && batchId > 0)
        : [Number(order.batch_id)];

      // Loading must not have started: the batch is already on the truck.
      const [loadingBatches] = await conn.execute<RowDataPacket[]>(
        `SELECT id, batch_number, status FROM batches
         WHERE id IN (?) AND status NOT IN ('QC_PASSED', 'DISPATCH_APPROVED') LIMIT 1`,
        [releaseBatchIds]
      );
      if (loadingBatches.length > 0) {
        throw new SyncConflictError('Loading has already started for this order. It cannot be cancelled.', {
          batch_id: loadingBatches[0].id,
          current_status: loadingBatches[0].status,
        });
      }

      await conn.execute(
        `UPDATE dispatch_orders SET status = 'CANCELLED', admin_remarks = ?, updated_at = CURRENT_TIMESTAMP(3)
         WHERE id = ? AND status = 'APPROVED'`,
        [remarks, id]
      );
      // Release the reserved QR labels so the stock becomes orderable again.
      await conn.execute(
        'UPDATE qr_labels SET dispatch_order_id = NULL WHERE dispatch_order_id = ? AND batch_id IN (?)',
        [id, releaseBatchIds]
      );
      for (const batchId of releaseBatchIds) {
        await conn.execute(
          `UPDATE batches SET status = 'QC_PASSED', updated_at = CURRENT_TIMESTAMP(3)
           WHERE id = ? AND status = 'DISPATCH_APPROVED'`,
          [batchId]
        );
      }
      // The order took these units out of the stock when it was created, so
      // cancelling it has to put them back on the shelf.
      if (order.stock_reserved_at_order) {
        await restoreOrderStock(conn, order);
      }
      await conn.execute(
        `INSERT INTO activity_logs (user_id, user_name, user_role, action, description)
         VALUES (?, ?, ?, 'DISPATCH_ORDER_CANCELLED', ?)`,
        [req.user!.userId, req.user!.name, req.user!.role, `Dispatch order #${id} cancelled for batch #${order.batch_id}`]
      );
      return { message: 'Dispatch order cancelled', status: 'CANCELLED' };
    });
    res.json(result);
  } catch (error) {
    errorResponse(res, error, 'Could not cancel dispatch order');
  }
}

type PackingListResult =
  | { ok: true; data: Record<string, any> }
  | { ok: false; statusCode: number; error: string };

/**
 * Puts units back into the product stock. The units were taken out of the
 * stock when the dispatch order was created, so they have to go back when the
 * order is called off or the unit is recalled to the shelf.
 */
async function restoreOrderStock(conn: PoolConnection, order: any): Promise<void> {
  const lines = parseOrderLines(order.order_lines);
  if (!lines.length) lines.push({ batch_id: order.batch_id, quantity: order.quantity });
  const totals = new Map<number, number>();
  for (const line of lines) {
    const quantity = Number(line?.quantity ?? 0);
    if (!quantity) continue;
    const [batches] = await conn.execute<RowDataPacket[]>(
      'SELECT product_id FROM batches WHERE id = ?',
      [line?.batch_id]
    );
    const productId = Number(batches[0]?.product_id);
    if (!productId) continue;
    totals.set(productId, (totals.get(productId) || 0) + quantity);
  }
  for (const [productId, quantity] of totals) {
    await conn.execute(
      'UPDATE products SET quantity = COALESCE(quantity, 0) + ?, updated_at = CURRENT_TIMESTAMP(3) WHERE id = ?',
      [quantity, productId]
    );
  }
}

async function buildPackingListData(req: Request): Promise<PackingListResult> {
  const { id } = req.params;
  const orders = await query<RowDataPacket[]>(
    `SELECT d.*, b.batch_number, b.barcode_value, COALESCE(d.quantity, b.quantity) AS quantity, b.uom,
            COALESCE(s.location_code, b.storage_location) AS storage_location,
            p.name AS product_name, p.sku, u.name AS raised_by_name, COALESCE(aa.name, qu.name) AS approver_name,
            COALESCE(g.name, p.grade) AS grade, v.name AS vendor_name,
            q.quantity AS bag_quantity, q.unit AS bag_quantity_unit,
            c.name AS client_name,
            (SELECT du.name FROM dispatch_records dr
             LEFT JOIN dispatch_users du ON du.id = dr.dispatcher_id
             WHERE dr.dispatch_order_id = d.id ORDER BY dr.created_at DESC LIMIT 1) AS dispatched_by
     FROM dispatch_orders d
     JOIN batches b ON d.batch_id = b.id
     JOIN products p ON b.product_id = p.id
     LEFT JOIN shelf_locations s ON s.id = b.shelf_location_id
     LEFT JOIN grades g ON g.id = b.grade_id
     LEFT JOIN vendors v ON v.id = b.vendor_id
     LEFT JOIN bag_quantities q ON q.id = b.bag_quantity_id
     LEFT JOIN dispatch_users u ON d.raised_by = u.id
     LEFT JOIN admins a ON d.admin_id = a.id
     LEFT JOIN admins aa ON d.approved_by_id = aa.id AND d.approved_by_role = 'ADMIN'
     LEFT JOIN qc_users qu ON d.approved_by_id = qu.id AND d.approved_by_role = 'QC'
     LEFT JOIN clients c ON c.id = d.client_id
     WHERE d.id = ?
       AND d.status IN ('APPROVED', 'CLOSED_DISPATCHED', 'CLOSED_NOT_DISPATCHED')
       AND (? <> 'DISPATCH' OR d.raised_by = ?)`,
    [id, req.user!.role, req.user!.userId]
  );
  if (orders.length === 0) {
    return { ok: false, statusCode: 404, error: 'Approved dispatch order not found' };
  }
  const order = orders[0];
  const storedItems = await query<RowDataPacket[]>(
    'SELECT * FROM packing_list_items WHERE dispatch_order_id = ? ORDER BY id ASC',
    [id]
  );
  // Map each batch line to the human-readable QR IDs (e.g. QRJ-20261113-...)
  // that were assigned to the order, so the packing list shows the QR label
  // text instead of the batch-level QC barcode.
  const qrRows = await query<RowDataPacket[]>(
    'SELECT batch_id, qr_value FROM qr_labels WHERE dispatch_order_id = ? ORDER BY batch_id ASC, serial_no ASC',
    [id]
  );
  const qrByBatch = new Map<string, string[]>();
  for (const row of qrRows) {
    const key = String(row.batch_id);
    const list = qrByBatch.get(key) || [];
    list.push(String(row.qr_value));
    qrByBatch.set(key, list);
  }
  let orderLines = order.order_lines;
  if (typeof orderLines === 'string') { try { orderLines = JSON.parse(orderLines); } catch { orderLines = []; } }
  const baseItems = storedItems.length > 0
    ? storedItems
    : Array.isArray(orderLines) && orderLines.length > 0 ? orderLines : [{
        batch_id: order.batch_id,
        product_name: order.product_name,
        sku: order.sku,
        batch_number: order.batch_number,
        barcode: order.barcode_value,
        quantity: order.quantity,
        uom: order.uom,
        grade: order.grade,
        bag_quantity: order.bag_quantity,
        bag_quantity_unit: order.bag_quantity_unit,
        location: order.storage_location || 'N/A',
      }];
  // Packing-list lines snapshot the product, not its grade. Resolve each line's
  // grade from its batch so the list (screen, print and PDF) can show grades.
  const itemBatchIds = [...new Set(baseItems.map((item: any) => Number(item.batch_id)).filter((id) => Number.isInteger(id) && id > 0))];
  const gradeRows = itemBatchIds.length
    ? await query<RowDataPacket[]>(
        `SELECT b.id AS batch_id, COALESCE(g.name, p.grade) AS grade_name
         FROM batches b
         JOIN products p ON b.product_id = p.id
         LEFT JOIN grades g ON g.id = b.grade_id
         WHERE b.id IN (?)`,
        [itemBatchIds]
      )
    : [];
  const gradeNameByBatch = new Map<string, string | null>(
    gradeRows.map((row) => [String(row.batch_id), row.grade_name ?? null])
  );

  const items = baseItems.map((item: any) => ({
    ...item,
    // Packing-list snapshots store the SKU as product_sku; surface it as sku
    // so the table and PDFs can read a single field.
    sku: item.sku ?? item.product_sku ?? null,
    grade_name: item.grade_name
      ?? gradeNameByBatch.get(String(item.batch_id))
      ?? item.grade
      ?? order.grade
      ?? null,
    qr_values: qrByBatch.get(String(item.batch_id)) || [],
  }));

  return {
    ok: true,
    data: {
      order_id: order.id,
      order_number: order.order_number ?? null,
      quantity: Number(order.quantity),
      status: order.status,
      batch_number: order.batch_number,
      barcode: order.barcode_value,
      raised_by_name: order.raised_by_name || null,
      approver_name: order.approver_name || null,
      admin_remarks: order.admin_remarks || null,
      client: order.client_id ? await getClient(order.client_id) : null,
      client_name: order.client_name || null,
      driver_name: order.driver_name,
      driver_phone: order.driver_phone || null,
      vehicle_number: order.vehicle_number,
      container_number: order.container_number,
      seal_number: order.seal_number || null,
      outcome: order.outcome || null,
      grade: order.grade,
      vendor_name: order.vendor_name,
      dispatched_by: order.dispatched_by || null,
      location: order.storage_location || null,
      dispatched_at: order.dispatched_at || null,
      items,
      generated_at: new Date().toISOString(),
    },
  };
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
    const result = await withTransaction(async (conn) => {
      const [labels] = await conn.execute<RowDataPacket[]>(
        'SELECT * FROM qr_labels WHERE qr_value = ? FOR UPDATE',
        [qrValue]
      );
      if (labels.length === 0) throw new SyncError('QR label not found', 'QR_NOT_FOUND', 404);
      const label = labels[0];
      if (!label.dispatch_order_id) {
        throw new SyncError('This QR label is not assigned to a dispatch order', 'QR_NOT_IN_ORDER', 409);
      }
      const [orders] = await conn.execute<RowDataPacket[]>(
        'SELECT * FROM dispatch_orders WHERE id = ? FOR UPDATE',
        [label.dispatch_order_id]
      );
      if (orders.length === 0) throw new SyncError('Dispatch order not found', 'ORDER_NOT_FOUND', 404);
      const order = orders[0];
      if (req.user!.role !== 'ADMIN' && Number(order.raised_by) !== Number(req.user!.userId)) {
        throw new SyncError('You can only recall labels on orders you raised', 'FORBIDDEN', 403);
      }
      if (order.status !== 'APPROVED') {
        throw new SyncConflictError(`This order is already ${order.status}`, { order_id: order.id, status: order.status });
      }
      if (label.recall_status === 'RECALLED') {
        throw new SyncConflictError('This QR label has already been recalled', { qr_value: qrValue, code: 'QR_ALREADY_RECALLED' });
      }
      // Loading sessions are MongoDB-only, so on MySQL no label can already be
      // loaded and there is no session total to adjust.
      // The unit leaves this order: drop its line and lower the order quantity.
      const orderLines = parseOrderLines(order.order_lines);
      const remainingLines = orderLines.filter(
        (line: any) => Number(line?.batch_id) !== Number(label.batch_id),
      );
      await conn.execute(
        'UPDATE dispatch_orders SET order_lines = ?, quantity = ?, remarks = ?, admin_remarks = ?, updated_at = CURRENT_TIMESTAMP(3) WHERE id = ?',
        [JSON.stringify(remainingLines), Math.max(0, Number(order.quantity || 0) - 1), reason, reason, order.id]
      );

      if (condition === 'RETURN_TO_STOCK') {
        // The label goes back to free stock and its batch returns to the shelf.
        await conn.execute(
          `UPDATE qr_labels SET dispatch_order_id = NULL, recall_status = NULL, recall_condition = NULL,
             recall_reason = NULL, recalled_by = NULL, recalled_at = NULL
           WHERE id = ?`,
          [label.id]
        );
        await conn.execute(
          "UPDATE batches SET status = 'QC_PASSED', updated_at = CURRENT_TIMESTAMP(3) WHERE id = ? AND status = 'DISPATCH_APPROVED'",
          [label.batch_id]
        );
        // The unit left the stock when the order was created, so it goes back
        // on the shelf now.
        if (order.stock_reserved_at_order) {
          const [batches] = await conn.execute<RowDataPacket[]>(
            'SELECT product_id FROM batches WHERE id = ?',
            [label.batch_id]
          );
          const productId = Number(batches[0]?.product_id);
          if (productId) {
            await conn.execute(
              'UPDATE products SET quantity = COALESCE(quantity, 0) + 1, updated_at = CURRENT_TIMESTAMP(3) WHERE id = ?',
              [productId]
            );
          }
          await conn.execute(
            'UPDATE dispatch_orders SET returned_to_stock_quantity = COALESCE(returned_to_stock_quantity, 0) + 1 WHERE id = ?',
            [order.id]
          );
        }
      } else {
        await conn.execute(
          `UPDATE qr_labels SET recall_status = 'RECALLED', recall_condition = ?, recall_reason = ?,
             recalled_by = ?, recalled_at = CURRENT_TIMESTAMP(3)
           WHERE id = ? AND (recall_status IS NULL OR recall_status <> 'RECALLED')`,
          [condition, reason, String(req.user!.userId), label.id]
        );
      }

      await conn.execute(
        `INSERT INTO activity_logs (user_id, user_name, user_role, action, description)
         VALUES (?, ?, ?, 'DISPATCH_QR_RECALLED', ?)`,
        [req.user!.userId, req.user!.name, req.user!.role, `QR ${qrValue} recalled from dispatch order ${order.id}; condition ${condition}; reason: ${reason}`]
      );

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

async function getClient(id: number): Promise<Record<string, unknown> | null> {
  const clients = await query<RowDataPacket[]>(
    'SELECT id, name, contact_person, email, phone, address, gst_number FROM clients WHERE id = ?',
    [id]
  );
  return clients[0] || null;
}
