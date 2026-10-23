import { Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { query, withTransaction } from '../config/database';
import { RowDataPacket } from 'mysql2';
import { applyOperation, SyncConflictError, SyncError } from '../services/syncService';
import { SyncOperationInput } from '../types';

function errorResponse(res: Response, error: unknown, fallback: string): void {
  if (error instanceof SyncError) {
    res.status(error.httpStatus).json({ error: error.message, code: error.code, ...(error.details || {}) });
    return;
  }
  console.error(fallback, error);
  res.status(500).json({ error: fallback });
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
      batch_id: batchId ? Number(batchId) : undefined,
      barcode_value: barcodeValue ? String(barcodeValue) : undefined,
      expected_status: req.body.expected_status || undefined,
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
    `SELECT d.*, b.batch_number, b.barcode_value, b.quantity, b.uom, p.name AS product_name,
            p.sku AS product_sku, u.name AS raised_by_name
     FROM dispatch_orders d
     JOIN batches b ON d.batch_id = b.id
     JOIN products p ON b.product_id = p.id
     LEFT JOIN dispatch_users u ON d.raised_by = u.id
     WHERE d.status = 'PENDING' ${search.sql}
     ORDER BY d.created_at ASC LIMIT 100`,
    search.params
  );
  res.json(orders);
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
    `SELECT d.*, b.batch_number, b.barcode_value, b.quantity, b.uom, p.name AS product_name,
            p.sku AS product_sku, u.name AS raised_by_name, a.name AS admin_name
     FROM dispatch_orders d
     JOIN batches b ON d.batch_id = b.id
     JOIN products p ON b.product_id = p.id
     LEFT JOIN dispatch_users u ON d.raised_by = u.id
     LEFT JOIN admins a ON d.admin_id = a.id
     WHERE ${where.join(' AND ')} ${search.sql}
     ORDER BY d.created_at DESC LIMIT 100`,
    params
  );
  res.json(orders);
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
    `SELECT d.*, b.batch_number, b.barcode_value, b.quantity, b.uom, p.name AS product_name,
            p.sku AS product_sku, a.name AS admin_name
     FROM dispatch_orders d
     JOIN batches b ON d.batch_id = b.id
     JOIN products p ON b.product_id = p.id
     LEFT JOIN admins a ON d.admin_id = a.id
     WHERE ${where.join(' AND ')} ${search.sql}
     ORDER BY d.created_at DESC LIMIT 100`,
    params
  );
  res.json(orders);
}

export async function approve(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  const { admin_remarks } = req.body;
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
        `UPDATE dispatch_orders SET status = 'APPROVED', admin_id = ?, admin_remarks = ?, updated_at = CURRENT_TIMESTAMP(3)
         WHERE id = ? AND status = 'PENDING'`,
        [req.user!.userId, admin_remarks || null, id]
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
  const { admin_remarks } = req.body;
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
        `UPDATE dispatch_orders SET status = 'REJECTED', admin_id = ?, admin_remarks = ?, updated_at = CURRENT_TIMESTAMP(3)
         WHERE id = ? AND status = 'PENDING'`,
        [req.user!.userId, admin_remarks || null, id]
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

export async function getPackingList(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  const orders = await query<RowDataPacket[]>(
    `SELECT d.*, b.batch_number, b.barcode_value, b.quantity, b.uom, b.storage_location,
            p.name AS product_name, p.sku, u.name AS raised_by_name, a.name AS admin_name
     FROM dispatch_orders d
     JOIN batches b ON d.batch_id = b.id
     JOIN products p ON b.product_id = p.id
     LEFT JOIN dispatch_users u ON d.raised_by = u.id
     LEFT JOIN admins a ON d.admin_id = a.id
     WHERE d.id = ?`,
    [id]
  );
  if (orders.length === 0) {
    res.status(404).json({ error: 'Dispatch order not found' });
    return;
  }
  const order = orders[0];
  const storedItems = await query<RowDataPacket[]>(
    'SELECT * FROM packing_list_items WHERE dispatch_order_id = ? ORDER BY id ASC',
    [id]
  );
  const items = storedItems.length > 0
    ? storedItems
    : [{
        product_name: order.product_name,
        sku: order.sku,
        batch_number: order.batch_number,
        barcode: order.barcode_value,
        quantity: order.quantity,
        uom: order.uom,
        location: order.storage_location || 'N/A',
      }];

  res.json({
    order_id: order.id,
    status: order.status,
    batch_number: order.batch_number,
    barcode: order.barcode_value,
    raised_by_name: order.raised_by_name || null,
    admin_name: order.admin_name || null,
    admin_remarks: order.admin_remarks || null,
    dispatched_at: order.dispatched_at || null,
    items,
    generated_at: new Date().toISOString(),
  });
}
