import { Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { query } from '../config/database';
import { RowDataPacket } from 'mysql2';
import { applyOperation } from '../services/syncService';
import { SyncOperationInput } from '../types';

function pageParams(req: Request, defaultLimit = 20): { page: number; limit: number; offset: number } {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || defaultLimit));
  return { page, limit, offset: (page - 1) * limit };
}

function userScope(req: Request, column: string): { sql: string; params: any[] } {
  if (req.user?.role === 'DISPATCH') {
    return { sql: `AND ${column} = ?`, params: [req.user.userId] };
  }
  return { sql: '', params: [] };
}

export async function submit(req: Request, res: Response): Promise<void> {
  const barcode_value = String(req.body.barcode_value || '').trim();
  const files = (req.files as Express.Multer.File[]) || [];
  const bodyImages = Array.isArray(req.body.images) ? req.body.images : [];
  const images = files.length > 0 ? files.map((file) => file.filename) : bodyImages;

  if (!barcode_value) {
    res.status(400).json({ error: 'Barcode value is required' });
    return;
  }

  const operation: SyncOperationInput = {
    operation_id: req.body.client_operation_id || randomUUID(),
    type: 'DISPATCH_CONFIRM',
    client_timestamp: req.body.client_timestamp || new Date().toISOString(),
    payload: {
      barcode_value,
      remarks: req.body.remarks || null,
      images,
      expected_status: req.body.expected_status || undefined,
      direct: req.body.direct === true || req.body.direct === 'true',
    },
  };

  const applied = await applyOperation(req.user!, null, operation);
  if (applied.status === 'APPLIED' || applied.status === 'DUPLICATE') {
    res.json({ ...(applied.data || {}), duplicate: applied.status === 'DUPLICATE' });
    return;
  }
  res.status(applied.status === 'CONFLICT' ? 409 : 400).json({
    error: applied.error || 'Dispatch failed',
    code: applied.error_code,
    ...(applied.data || {}),
  });
}

export async function submitBulk(req: Request, res: Response): Promise<void> {
  let barcodes: string[] = [];
  if (Array.isArray(req.body.barcodes)) {
    barcodes = req.body.barcodes.map((value: any) => String(value || '').trim()).filter(Boolean);
  } else if (typeof req.body.barcodes === 'string') {
    try {
      const parsed = JSON.parse(req.body.barcodes);
      if (Array.isArray(parsed)) {
        barcodes = parsed.map((value: any) => String(value || '').trim()).filter(Boolean);
      }
    } catch {
      barcodes = [];
    }
  } else if (typeof req.body.barcode_value === 'string') {
    barcodes = [req.body.barcode_value.trim()];
  }
  barcodes = [...new Set(barcodes)];

  const files = (req.files as Express.Multer.File[]) || [];
  const bodyImages = Array.isArray(req.body.images) ? req.body.images : [];
  const images = files.length > 0 ? files.map((file) => file.filename) : bodyImages;

  if (barcodes.length === 0) {
    res.status(400).json({ error: 'At least one QR code is required' });
    return;
  }

  const operation: SyncOperationInput = {
    operation_id: req.body.client_operation_id || randomUUID(),
    type: 'DISPATCH_CONFIRM_BULK',
    client_timestamp: req.body.client_timestamp || new Date().toISOString(),
    payload: {
      barcodes,
      remarks: req.body.remarks || null,
      images,
      direct: req.body.direct === true || req.body.direct === 'true',
    },
  };

  const applied = await applyOperation(req.user!, null, operation);
  if (applied.status === 'APPLIED' || applied.status === 'DUPLICATE') {
    res.json({ ...(applied.data || {}), duplicate: applied.status === 'DUPLICATE' });
    return;
  }
  res.status(applied.status === 'CONFLICT' ? 409 : 400).json({
    error: applied.error || 'Group dispatch failed',
    code: applied.error_code,
    ...(applied.data || {}),
  });
}

export async function today(req: Request, res: Response): Promise<void> {
  const scope = userScope(req, 'dr.dispatcher_id');
  const records = await query<RowDataPacket[]>(
    `SELECT dr.*, b.batch_number, b.barcode_value, p.name AS product_name, p.sku AS product_sku
     FROM dispatch_records dr
     JOIN batches b ON dr.batch_id = b.id
     JOIN products p ON b.product_id = p.id
     WHERE dr.created_at >= CURDATE() ${scope.sql}
     ORDER BY dr.created_at DESC LIMIT 100`,
    scope.params
  );
  res.json(records);
}

export async function ready(req: Request, res: Response): Promise<void> {
  const { page, limit, offset } = pageParams(req, 20);
  const q = String(req.query.q || '').trim();
  const where = ["b.status = 'QC_PASSED'"];
  const params: any[] = [];
  if (q) {
    where.push('(b.batch_number LIKE ? OR b.barcode_value LIKE ? OR p.name LIKE ? OR p.sku LIKE ?)');
    const like = `%${q}%`;
    params.push(like, like, like, like);
  }
  const whereSql = `WHERE ${where.join(' AND ')}`;
  const totalRows = await query<RowDataPacket[]>(
    `SELECT COUNT(*) AS count FROM batches b JOIN products p ON b.product_id = p.id ${whereSql}`,
    params
  );
  const items = await query<RowDataPacket[]>(
    `SELECT b.id, b.batch_number, b.barcode_value, b.quantity, b.uom, b.storage_location,
            b.created_at, p.name AS product_name, p.sku AS product_sku,
            TIMESTAMPDIFF(MINUTE, b.updated_at, NOW()) AS age_minutes
     FROM batches b JOIN products p ON b.product_id = p.id
     ${whereSql}
     ORDER BY b.updated_at ASC
     LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  const total = Number(totalRows[0]?.count || 0);
  res.json({ items, total, page, limit, pages: Math.ceil(total / limit) });
}

export async function approvedOrders(req: Request, res: Response): Promise<void> {
  const scope = userScope(req, 'd.raised_by');
  const orders = await query<RowDataPacket[]>(
    `SELECT d.*, b.batch_number, b.barcode_value, b.quantity, b.uom, b.storage_location,
            p.name AS product_name, p.sku AS product_sku,
            u.name AS raised_by_name
     FROM dispatch_orders d
     JOIN batches b ON d.batch_id = b.id
     JOIN products p ON b.product_id = p.id
     LEFT JOIN dispatch_users u ON d.raised_by = u.id
     WHERE d.status = 'APPROVED'
       AND d.dispatched_at IS NULL
       AND b.status = 'DISPATCH_APPROVED' ${scope.sql}
     ORDER BY d.updated_at DESC LIMIT 100`,
    scope.params
  );
  res.json(orders);
}

export async function records(req: Request, res: Response): Promise<void> {
  const { page, limit, offset } = pageParams(req, 20);
  const scope = userScope(req, 'dr.dispatcher_id');
  const q = String(req.query.q || '').trim();
  const where: string[] = [];
  const params: any[] = [];
  if (scope.sql) {
    where.push(scope.sql.replace(/^AND /, ''));
    params.push(...scope.params);
  }
  if (q) {
    where.push('(b.batch_number LIKE ? OR b.barcode_value LIKE ? OR p.name LIKE ? OR p.sku LIKE ? OR dr.remarks LIKE ?)');
    const like = `%${q}%`;
    params.push(like, like, like, like, like);
  }
  const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  const totalRows = await query<RowDataPacket[]>(
    `SELECT COUNT(*) AS count
     FROM dispatch_records dr
     JOIN batches b ON dr.batch_id = b.id
     JOIN products p ON b.product_id = p.id
     ${whereSql}`,
    params
  );
  const items = await query<RowDataPacket[]>(
    `SELECT dr.*, b.batch_number, b.barcode_value, p.name AS product_name, p.sku AS product_sku,
            d.status AS order_status
     FROM dispatch_records dr
     JOIN batches b ON dr.batch_id = b.id
     JOIN products p ON b.product_id = p.id
     LEFT JOIN dispatch_orders d ON dr.dispatch_order_id = d.id
     ${whereSql}
     ORDER BY dr.created_at DESC
     LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  const total = Number(totalRows[0]?.count || 0);
  res.json({ items, total, page, limit, pages: Math.ceil(total / limit) });
}

export async function stats(req: Request, res: Response): Promise<void> {
  const user = req.user!;
  const personal = user.role === 'DISPATCH';
  const recordScope = personal ? 'AND dr.dispatcher_id = ?' : '';
  const recordParams = personal ? [user.userId] : [];

  const count = async (sql: string, params: any[] = []): Promise<number> => {
    const rows = await query<RowDataPacket[]>(sql, params);
    return Number(rows[0]?.count || 0);
  };

  const totalDispatches = await count(
    `SELECT COUNT(*) AS count FROM dispatch_records dr WHERE 1=1 ${recordScope}`,
    recordParams
  );
  const dispatchedToday = await count(
    `SELECT COUNT(*) AS count FROM dispatch_records dr WHERE dr.created_at >= CURDATE() ${recordScope}`,
    recordParams
  );
  const dispatchedThisWeek = await count(
    `SELECT COUNT(*) AS count FROM dispatch_records dr
     WHERE dr.created_at >= DATE_SUB(CURDATE(), INTERVAL WEEKDAY(CURDATE()) DAY) ${recordScope}`,
    recordParams
  );
  const readyToDispatch = await count(`SELECT COUNT(*) AS count FROM batches WHERE status = 'QC_PASSED'`);

  const orderScope = personal ? 'AND raised_by = ?' : '';
  const orderParams = personal ? [user.userId] : [];
  const pendingOrdersCount = await count(
    `SELECT COUNT(*) AS count FROM dispatch_orders WHERE status = 'PENDING' ${orderScope}`,
    orderParams
  );
  const approvedOrdersCount = await count(
    `SELECT COUNT(*) AS count
     FROM dispatch_orders d
     JOIN batches b ON d.batch_id = b.id
     WHERE d.status = 'APPROVED'
       AND d.dispatched_at IS NULL
       AND b.status = 'DISPATCH_APPROVED' ${orderScope}`,
    orderParams
  );

  const readyBatches = await query<RowDataPacket[]>(
    `SELECT b.id, b.batch_number, b.barcode_value, b.quantity, b.uom, b.storage_location,
            b.created_at, p.name AS product_name, p.sku AS product_sku,
            TIMESTAMPDIFF(MINUTE, b.updated_at, NOW()) AS age_minutes
     FROM batches b JOIN products p ON b.product_id = p.id
     WHERE b.status = 'QC_PASSED'
     ORDER BY b.updated_at ASC LIMIT 10`
  );
  const pendingOrders = await query<RowDataPacket[]>(
    `SELECT d.*, b.batch_number, p.name AS product_name, p.sku AS product_sku,
            u.name AS raised_by_name
     FROM dispatch_orders d
     JOIN batches b ON d.batch_id = b.id
     JOIN products p ON b.product_id = p.id
     LEFT JOIN dispatch_users u ON d.raised_by = u.id
     WHERE d.status = 'PENDING' ${orderScope}
     ORDER BY d.created_at ASC LIMIT 10`,
    orderParams
  );
  const approvedOrders = await query<RowDataPacket[]>(
    `SELECT d.*, b.batch_number, b.barcode_value, p.name AS product_name, p.sku AS product_sku
     FROM dispatch_orders d
     JOIN batches b ON d.batch_id = b.id
     JOIN products p ON b.product_id = p.id
     WHERE d.status = 'APPROVED'
       AND d.dispatched_at IS NULL
       AND b.status = 'DISPATCH_APPROVED' ${orderScope}
     ORDER BY d.updated_at ASC LIMIT 10`,
    orderParams
  );
  const recentRecords = await query<RowDataPacket[]>(
    `SELECT dr.*, b.batch_number, b.barcode_value, p.name AS product_name, p.sku AS product_sku,
            u.name AS dispatcher_name
     FROM dispatch_records dr
     JOIN batches b ON dr.batch_id = b.id
     JOIN products p ON b.product_id = p.id
     LEFT JOIN dispatch_users u ON dr.dispatcher_id = u.id
     WHERE 1=1 ${recordScope}
     ORDER BY dr.created_at DESC LIMIT 20`,
    recordParams
  );
  const todayRecords = await query<RowDataPacket[]>(
    `SELECT dr.*, b.batch_number, b.barcode_value, p.name AS product_name,
            u.name AS dispatcher_name
     FROM dispatch_records dr
     JOIN batches b ON dr.batch_id = b.id
     JOIN products p ON b.product_id = p.id
     LEFT JOIN dispatch_users u ON dr.dispatcher_id = u.id
     WHERE dr.created_at >= CURDATE() ${recordScope}
     ORDER BY dr.created_at DESC`,
    recordParams
  );

  res.json({
    scope: personal ? 'mine' : 'all',
    totalDispatches,
    dispatchedToday,
    dispatchedThisWeek,
    readyToDispatch,
    pendingOrders: pendingOrdersCount,
    approvedOrders: approvedOrdersCount,
    myDispatchedToday: dispatchedToday,
    myTotalDispatches: totalDispatches,
    readyBatches,
    pendingOrdersList: pendingOrders,
    approvedOrdersList: approvedOrders,
    recentRecords,
    todayRecords,
  });
}
