import { Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { query, withTransaction } from '../config/database.mysql';
import { RowDataPacket } from 'mysql2';
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

function withOrderLines(order: any): any {
  let items = order.order_lines;
  if (typeof items === 'string') { try { items = JSON.parse(items); } catch { items = []; } }
  if (!Array.isArray(items)) items = [];
  if (!items.length) items = [{ batch_id: order.batch_id, batch_number: order.batch_number, product_name: order.product_name, product_sku: order.product_sku, quantity: order.quantity, uom: order.uom, location: order.storage_location || null }];
  return { ...order, items, batch_number: items.length === 1 ? items[0].batch_number : 'Multi-product order', product_name: items.map((item: any) => item.product_name).filter(Boolean).join(', ') || order.product_name };
}

export async function raise(req: Request, res: Response): Promise<void> {
  const batchId = req.body.batch_id;
  const barcodeValue = req.body.barcode_value;
  const items = Array.isArray(req.body.items) ? req.body.items : null;
  if (!batchId && !barcodeValue && (!items || items.length === 0)) {
    res.status(400).json({ error: 'Batch ID or barcode value is required' });
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
      driver_name: '',
      vehicle_number: '',
      container_number: '',
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
    sql: 'AND (b.batch_number LIKE ? OR p.name LIKE ? OR p.sku LIKE ?)',
    params: [`%${q}%`, `%${q}%`, `%${q}%`],
  };
}

export async function listPending(req: Request, res: Response): Promise<void> {
  const q = String(req.query.q || '').trim();
  const search = searchClause(q);
  const orders = await query<RowDataPacket[]>(
    `SELECT d.*, b.batch_number, b.barcode_value, COALESCE(d.quantity, b.quantity) AS quantity, b.uom, p.name AS product_name,
            p.sku AS product_sku, p.grade AS product_grade, g.name AS grade_name,
            q.name AS bag_quantity_name, q.quantity AS bag_quantity, q.unit AS bag_quantity_unit,
            u.name AS raised_by_name, c.name AS client_name,
            d.container_number, COALESCE(aa.name, qu.name) AS approver_name
     FROM dispatch_orders d
     JOIN batches b ON d.batch_id = b.id
     JOIN products p ON b.product_id = p.id
     LEFT JOIN grades g ON g.id = b.grade_id
     LEFT JOIN bag_quantities q ON q.id = b.bag_quantity_id
     LEFT JOIN dispatch_users u ON d.raised_by = u.id
     LEFT JOIN clients c ON c.id = d.client_id
     LEFT JOIN admins aa ON aa.id = d.approved_by_id AND d.approved_by_role = 'ADMIN'
     LEFT JOIN qc_users qu ON qu.id = d.approved_by_id AND d.approved_by_role = 'QC'
     WHERE d.status = 'PENDING' ${search.sql}
     ORDER BY d.created_at ASC LIMIT 100`,
    search.params
  );
  res.json(orders.map(withOrderLines));
}

export async function listAll(req: Request, res: Response): Promise<void> {
  const q = String(req.query.q || '').trim();
  const status = String(req.query.status || '').toUpperCase();
  const search = searchClause(q);
  const where = ['1=1'];
  const params: any[] = [];
  if (['PENDING', 'APPROVED', 'REJECTED'].includes(status)) {
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
            COALESCE(aa.name, qu.name) AS approver_name
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
     WHERE ${where.join(' AND ')} ${search.sql}
     ORDER BY d.created_at DESC LIMIT 100`,
    params
  );
  res.json(orders.map(withOrderLines));
}

export async function listMine(req: Request, res: Response): Promise<void> {
  const q = String(req.query.q || '').trim();
  const status = String(req.query.status || '').toUpperCase();
  const search = searchClause(q);
  const where = ['d.raised_by = ?'];
  const params: any[] = [req.user!.userId];
  if (['PENDING', 'APPROVED', 'REJECTED'].includes(status)) {
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
            d.container_number, COALESCE(aa.name, qu.name) AS approver_name
     FROM dispatch_orders d
     JOIN batches b ON d.batch_id = b.id
     JOIN products p ON b.product_id = p.id
     LEFT JOIN grades g ON g.id = b.grade_id
     LEFT JOIN bag_quantities q ON q.id = b.bag_quantity_id
     LEFT JOIN admins a ON d.admin_id = a.id
     LEFT JOIN admins aa ON d.approved_by_id = aa.id AND d.approved_by_role = 'ADMIN'
     LEFT JOIN qc_users qu ON d.approved_by_id = qu.id AND d.approved_by_role = 'QC'
     LEFT JOIN clients c ON c.id = d.client_id
     WHERE ${where.join(' AND ')} ${search.sql}
     ORDER BY d.created_at DESC LIMIT 100`,
    params
  );
  res.json(orders.map(withOrderLines));
}

export async function approve(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  const admin_remarks = req.body.admin_remarks ?? req.body.remarks;
  try {
    const result = await withTransaction(async (conn) => {
      const [orders] = await conn.execute<RowDataPacket[]>(
        'SELECT * FROM dispatch_orders WHERE id = ? FOR UPDATE',
        [id]
      );
      if (orders.length === 0) throw new SyncError('Dispatch order not found', 'ORDER_NOT_FOUND', 404);
      const order = orders[0];
      if (order.status !== 'PENDING') {
        throw new SyncConflictError(`Order is already ${order.status}`, { order_id: order.id, status: order.status });
      }

      const [batches] = await conn.execute<RowDataPacket[]>(
        'SELECT * FROM batches WHERE id = ? FOR UPDATE',
        [order.batch_id]
      );
      if (batches.length === 0) throw new SyncError('Batch not found', 'BATCH_NOT_FOUND', 404);
      if (batches[0].status !== 'DISPATCH_ORDER_RAISED') {
        throw new SyncConflictError(`Batch is not awaiting approval. Current status: ${batches[0].status}`, {
          batch_id: order.batch_id,
          current_status: batches[0].status,
        });
      }

      await conn.execute(
        `UPDATE dispatch_orders SET status = 'APPROVED', admin_id = ?, approved_by_role = ?, approved_by_id = ?,
         admin_remarks = ?, updated_at = CURRENT_TIMESTAMP(3)
         WHERE id = ? AND status = 'PENDING'`,
        [req.user!.role === 'ADMIN' ? req.user!.userId : null, req.user!.role, req.user!.userId, admin_remarks || null, id]
      );
      const [batchUpdate] = await conn.execute(
        `UPDATE batches SET status = 'DISPATCH_APPROVED', updated_at = CURRENT_TIMESTAMP(3)
         WHERE id = ? AND status = 'DISPATCH_ORDER_RAISED'`,
        [order.batch_id]
      );
      if ((batchUpdate as any).affectedRows !== 1) {
        throw new SyncConflictError('Batch was changed by another user', { batch_id: order.batch_id });
      }
      await conn.execute(
        `INSERT INTO activity_logs (user_id, user_name, user_role, action, description)
         VALUES (?, ?, ?, 'DISPATCH_APPROVED', ?)`,
        [req.user!.userId, req.user!.name, req.user!.role, `Dispatch order #${id} approved for batch #${order.batch_id}`]
      );
      return { message: 'Dispatch order approved', status: 'APPROVED' };
    });
    res.json(result);
  } catch (error) {
    errorResponse(res, error, 'Could not approve dispatch order');
  }
}

export async function reject(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  const admin_remarks = req.body.admin_remarks ?? req.body.remarks;
  try {
    const result = await withTransaction(async (conn) => {
      const [orders] = await conn.execute<RowDataPacket[]>(
        'SELECT * FROM dispatch_orders WHERE id = ? FOR UPDATE',
        [id]
      );
      if (orders.length === 0) throw new SyncError('Dispatch order not found', 'ORDER_NOT_FOUND', 404);
      const order = orders[0];
      if (order.status !== 'PENDING') {
        throw new SyncConflictError(`Order is already ${order.status}`, { order_id: order.id, status: order.status });
      }

      const [batches] = await conn.execute<RowDataPacket[]>(
        'SELECT * FROM batches WHERE id = ? FOR UPDATE',
        [order.batch_id]
      );
      if (batches.length === 0) throw new SyncError('Batch not found', 'BATCH_NOT_FOUND', 404);

      await conn.execute(
        `UPDATE dispatch_orders SET status = 'REJECTED', admin_id = ?, approved_by_role = ?, approved_by_id = ?,
         admin_remarks = ?, updated_at = CURRENT_TIMESTAMP(3)
         WHERE id = ? AND status = 'PENDING'`,
        [req.user!.role === 'ADMIN' ? req.user!.userId : null, req.user!.role, req.user!.userId, admin_remarks || null, id]
      );
      await conn.execute(
        `UPDATE batches SET status = 'DISPATCH_REJECTED', updated_at = CURRENT_TIMESTAMP(3)
         WHERE id = ? AND status = 'DISPATCH_ORDER_RAISED'`,
        [order.batch_id]
      );
      await conn.execute(
        `INSERT INTO activity_logs (user_id, user_name, user_role, action, description)
         VALUES (?, ?, ?, 'DISPATCH_REJECTED', ?)`,
        [req.user!.userId, req.user!.name, req.user!.role, `Dispatch order #${id} rejected for batch #${order.batch_id}`]
      );
      return { message: 'Dispatch order rejected', status: 'REJECTED' };
    });
    res.json(result);
  } catch (error) {
    errorResponse(res, error, 'Could not reject dispatch order');
  }
}

type PackingListResult =
  | { ok: true; data: Record<string, any> }
  | { ok: false; statusCode: number; error: string };

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
  let orderLines = order.order_lines;
  if (typeof orderLines === 'string') { try { orderLines = JSON.parse(orderLines); } catch { orderLines = []; } }
  const items = storedItems.length > 0
    ? storedItems
    : Array.isArray(orderLines) && orderLines.length > 0 ? orderLines : [{
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

  return {
    ok: true,
    data: {
      order_id: order.id,
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
