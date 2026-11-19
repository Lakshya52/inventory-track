import { Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { query } from '../config/database';
import { RowDataPacket } from 'mysql2';
import { applyOperation } from '../services/syncService';
import { SyncOperationInput } from '../types';
import { divisionWhere } from '../utils/division';

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
  const tenantId = req.user!.tenantId;
  const dv = divisionWhere(req);
  const barcode_value = String(req.body.barcode_value || '').trim();
  const files = (req.files as Express.Multer.File[]) || [];
  const bodyImages = Array.isArray(req.body.images) ? req.body.images : [];
  const images = files.length > 0 ? files.map((file) => file.filename) : bodyImages;

  if (!barcode_value) {
    res.status(400).json({ error: 'Barcode value is required' });
    return;
  }

  const rawOrderId = req.body.dispatch_order_id;
  if (rawOrderId !== undefined && rawOrderId !== null && rawOrderId !== '') {
    const orderId = Number(rawOrderId);
    const orderRows = Number.isFinite(orderId)
      ? await query<RowDataPacket[]>(
        `SELECT id FROM dispatch_orders WHERE id = ? AND tenant_id = ? ${dv.sql} LIMIT 1`,
        [orderId, tenantId, ...dv.params]
      )
      : [];
    if (orderRows.length === 0) {
      res.status(404).json({ error: 'Dispatch order not found' });
      return;
    }
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
      dispatch_order_id: Number(req.body.dispatch_order_id) || undefined,
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
  const tenantId = req.user!.tenantId;
  const dv = divisionWhere(req);
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

  const rawOrderId = req.body.dispatch_order_id;
  if (rawOrderId !== undefined && rawOrderId !== null && rawOrderId !== '') {
    const orderId = Number(rawOrderId);
    const orderRows = Number.isFinite(orderId)
      ? await query<RowDataPacket[]>(
        `SELECT id FROM dispatch_orders WHERE id = ? AND tenant_id = ? ${dv.sql} LIMIT 1`,
        [orderId, tenantId, ...dv.params]
      )
      : [];
    if (orderRows.length === 0) {
      res.status(404).json({ error: 'Dispatch order not found' });
      return;
    }
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
      dispatch_order_id: Number(req.body.dispatch_order_id) || undefined,
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
  const tenantId = req.user!.tenantId;
  const scope = userScope(req, 'dr.dispatcher_id');
  const dvDr = divisionWhere(req, 'dr.division_id');
  const dvB = divisionWhere(req, 'b.division_id');
  const dvP = divisionWhere(req, 'p.division_id');
  const records = await query<RowDataPacket[]>(
    `SELECT dr.*, b.batch_number, b.barcode_value, p.name AS product_name, p.sku AS product_sku
     FROM dispatch_records dr
     JOIN batches b ON dr.batch_id = b.id ${dvB.sql}
     JOIN products p ON b.product_id = p.id ${dvP.sql}
     WHERE dr.tenant_id = ? AND b.tenant_id = ? AND p.tenant_id = ? AND dr.created_at >= CURDATE() ${scope.sql} ${dvDr.sql}
     ORDER BY dr.created_at DESC LIMIT 100`,
    [...dvB.params, ...dvP.params, tenantId, tenantId, tenantId, ...scope.params, ...dvDr.params]
  );
  res.json(records);
}

export async function ready(req: Request, res: Response): Promise<void> {
  const tenantId = req.user!.tenantId;
  const { page, limit, offset } = pageParams(req, 20);
  const q = String(req.query.q || '').trim();
  const dvB = divisionWhere(req, 'b.division_id');
  const dvP = divisionWhere(req, 'p.division_id');
  const where = ["b.status = 'QC_PASSED'", 'b.tenant_id = ?', 'p.tenant_id = ?'];
  const params: any[] = [tenantId, tenantId];
  if (dvB.sql) {
    where.push(dvB.sql.replace(/^ AND /, ''));
    params.push(...dvB.params);
  }
  if (q) {
    where.push('(b.batch_number LIKE ? OR b.barcode_value LIKE ? OR p.name LIKE ? OR p.sku LIKE ?)');
    const like = `${q}%`;
    params.push(like, like, like, like);
  }
  const whereSql = `WHERE ${where.join(' AND ')}`;
  const totalRows = await query<RowDataPacket[]>(
    `SELECT COUNT(*) AS count FROM batches b JOIN products p ON b.product_id = p.id ${dvP.sql} ${whereSql}`,
    [...dvP.params, ...params]
  );
  const items = await query<RowDataPacket[]>(
    `SELECT b.id, b.batch_number, b.barcode_value, b.quantity, b.uom, b.storage_location,
            b.created_at, p.name AS product_name, p.sku AS product_sku,
            TIMESTAMPDIFF(MINUTE, b.updated_at, NOW()) AS age_minutes
     FROM batches b JOIN products p ON b.product_id = p.id ${dvP.sql}
     ${whereSql}
     ORDER BY b.updated_at ASC
     LIMIT ? OFFSET ?`,
    [...dvP.params, ...params, limit, offset]
  );
  const total = Number(totalRows[0]?.count || 0);
  res.json({ items, total, page, limit, pages: Math.ceil(total / limit) });
}

export async function approvedOrders(req: Request, res: Response): Promise<void> {
  const tenantId = req.user!.tenantId;
  const scope = userScope(req, 'd.raised_by');
  const dvD = divisionWhere(req, 'd.division_id');
  const dvB = divisionWhere(req, 'b.division_id');
  const dvP = divisionWhere(req, 'p.division_id');
  const dvL = divisionWhere(req, 'l.division_id');
  const dvG = divisionWhere(req, 'g.division_id');
  const orders = await query<RowDataPacket[]>(
    `SELECT d.*, b.batch_number, b.barcode_value, b.quantity, b.uom, b.storage_location,
            g.name AS grade_name, q.name AS bag_quantity_name, q.quantity AS bag_quantity,
            q.unit AS bag_quantity_unit, c.name AS client_name,
            (SELECT COUNT(*) FROM qr_labels l WHERE l.batch_id = b.id AND l.tenant_id = ? ${dvL.sql}) AS qr_count,
            p.name AS product_name, p.sku AS product_sku,
            u.name AS raised_by_name
     FROM dispatch_orders d
     JOIN batches b ON d.batch_id = b.id ${dvB.sql}
     JOIN products p ON b.product_id = p.id ${dvP.sql}
     LEFT JOIN grades g ON g.id = b.grade_id AND g.tenant_id = ? ${dvG.sql}
     LEFT JOIN bag_quantities q ON q.id = b.bag_quantity_id AND q.tenant_id = ?
     LEFT JOIN clients c ON c.id = d.client_id AND c.tenant_id = ?
     LEFT JOIN dispatch_users u ON d.raised_by = u.id AND u.tenant_id = ?
     WHERE d.tenant_id = ? AND b.tenant_id = ? AND p.tenant_id = ?
       AND d.status = 'APPROVED'
       AND d.dispatched_at IS NULL
       AND b.status = 'DISPATCH_APPROVED' ${scope.sql} ${dvD.sql}
     ORDER BY d.updated_at DESC LIMIT 100`,
    [tenantId, ...dvL.params, ...dvB.params, ...dvP.params, tenantId, ...dvG.params, tenantId, tenantId, tenantId, tenantId, tenantId, tenantId, ...scope.params, ...dvD.params]
  );
  res.json(orders);
}

export async function records(req: Request, res: Response): Promise<void> {
  const tenantId = req.user!.tenantId;
  const { page, limit, offset } = pageParams(req, 20);
  const scope = userScope(req, 'dr.dispatcher_id');
  const dvDr = divisionWhere(req, 'dr.division_id');
  const dvB = divisionWhere(req, 'b.division_id');
  const dvP = divisionWhere(req, 'p.division_id');
  const dvD = divisionWhere(req, 'd.division_id');
  const q = String(req.query.q || '').trim();
  const where: string[] = ['dr.tenant_id = ?', 'b.tenant_id = ?', 'p.tenant_id = ?'];
  const params: any[] = [tenantId, tenantId, tenantId];
  if (dvDr.sql) {
    where.push(dvDr.sql.replace(/^ AND /, ''));
    params.push(...dvDr.params);
  }
  if (scope.sql) {
    where.push(scope.sql.replace(/^AND /, ''));
    params.push(...scope.params);
  }
  if (q) {
    where.push('(b.batch_number LIKE ? OR b.barcode_value LIKE ? OR p.name LIKE ? OR p.sku LIKE ? OR dr.remarks LIKE ?)');
    const like = `${q}%`;
    params.push(like, like, like, like, like);
  }
  const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  const totalRows = await query<RowDataPacket[]>(
    `SELECT COUNT(*) AS count
     FROM dispatch_records dr
     JOIN batches b ON dr.batch_id = b.id ${dvB.sql}
     JOIN products p ON b.product_id = p.id ${dvP.sql}
     ${whereSql}`,
    [...dvB.params, ...dvP.params, ...params]
  );
  const items = await query<RowDataPacket[]>(
    `SELECT dr.*, b.batch_number, b.barcode_value, p.name AS product_name, p.sku AS product_sku,
            d.status AS order_status
     FROM dispatch_records dr
     JOIN batches b ON dr.batch_id = b.id ${dvB.sql}
     JOIN products p ON b.product_id = p.id ${dvP.sql}
     LEFT JOIN dispatch_orders d ON dr.dispatch_order_id = d.id AND d.tenant_id = ? ${dvD.sql}
     ${whereSql}
     ORDER BY dr.created_at DESC
     LIMIT ? OFFSET ?`,
    [...dvB.params, ...dvP.params, tenantId, ...dvD.params, ...params, limit, offset]
  );
  const total = Number(totalRows[0]?.count || 0);
  res.json({ items, total, page, limit, pages: Math.ceil(total / limit) });
}

export async function stats(req: Request, res: Response): Promise<void> {
  const tenantId = req.user!.tenantId;
  const user = req.user!;
  const personal = user.role === 'DISPATCH';
  const recordScope = personal ? 'AND dr.dispatcher_id = ?' : '';
  const recordParams = personal ? [user.userId] : [];
  const dv = divisionWhere(req);
  const dvDr = divisionWhere(req, 'dr.division_id');
  const dvB = divisionWhere(req, 'b.division_id');
  const dvP = divisionWhere(req, 'p.division_id');
  const dvD = divisionWhere(req, 'd.division_id');
  const dvL = divisionWhere(req, 'l.division_id');

  const count = async (sql: string, params: any[] = []): Promise<number> => {
    const rows = await query<RowDataPacket[]>(sql, params);
    return Number(rows[0]?.count || 0);
  };

  const totalDispatches = await count(
    `SELECT COUNT(*) AS count FROM dispatch_records dr WHERE dr.tenant_id = ? ${recordScope} ${dvDr.sql}`,
    [tenantId, ...recordParams, ...dvDr.params]
  );
  const dispatchedToday = await count(
    `SELECT COUNT(*) AS count FROM dispatch_records dr WHERE dr.tenant_id = ? AND dr.created_at >= CURDATE() ${recordScope} ${dvDr.sql}`,
    [tenantId, ...recordParams, ...dvDr.params]
  );
  const dispatchedThisWeek = await count(
    `SELECT COUNT(*) AS count FROM dispatch_records dr
     WHERE dr.tenant_id = ? AND dr.created_at >= DATE_SUB(CURDATE(), INTERVAL WEEKDAY(CURDATE()) DAY) ${recordScope} ${dvDr.sql}`,
    [tenantId, ...recordParams, ...dvDr.params]
  );
  const readyToDispatch = await count(
    `SELECT COUNT(*) AS count FROM batches b
     WHERE b.tenant_id = ? AND b.status = 'QC_PASSED'
       AND (SELECT COUNT(*) FROM qr_labels l WHERE l.batch_id = b.id AND l.tenant_id = ? ${dvL.sql}) = b.quantity ${dvB.sql}`,
    [tenantId, tenantId, ...dvL.params, ...dvB.params]
  );

  const orderScope = personal ? 'AND raised_by = ?' : '';
  const orderParams = personal ? [user.userId] : [];
  // Orders need no approval, so nothing sits in a pending queue any more.
  const cancelledOrdersCount = await count(
    `SELECT COUNT(*) AS count FROM dispatch_orders WHERE tenant_id = ? AND status = 'CANCELLED' ${orderScope} ${dv.sql}`,
    [tenantId, ...orderParams, ...dv.params]
  );
  const approvedOrdersCount = await count(
    `SELECT COUNT(*) AS count
     FROM dispatch_orders d
     JOIN batches b ON d.batch_id = b.id ${dvB.sql}
     WHERE d.tenant_id = ? AND b.tenant_id = ? AND d.status = 'APPROVED'
       AND d.dispatched_at IS NULL
       AND b.status = 'DISPATCH_APPROVED' ${orderScope} ${dvD.sql}`,
    [...dvB.params, tenantId, tenantId, ...orderParams, ...dvD.params]
  );

  const readyBatches = await query<RowDataPacket[]>(
    `SELECT b.id, b.batch_number, b.barcode_value, b.quantity, b.uom, b.storage_location,
            b.created_at, p.name AS product_name, p.sku AS product_sku,
            TIMESTAMPDIFF(MINUTE, b.updated_at, NOW()) AS age_minutes
     FROM batches b JOIN products p ON b.product_id = p.id ${dvP.sql}
     WHERE b.tenant_id = ? AND p.tenant_id = ? AND b.status = 'QC_PASSED'
       AND (SELECT COUNT(*) FROM qr_labels l WHERE l.batch_id = b.id AND l.tenant_id = ? ${dvL.sql}) = b.quantity ${dvB.sql}
     ORDER BY b.updated_at ASC LIMIT 10`,
    [...dvP.params, tenantId, tenantId, tenantId, ...dvL.params, ...dvB.params]
  );
  const cancelledOrders = await query<RowDataPacket[]>(
    `SELECT d.*, b.batch_number, p.name AS product_name, p.sku AS product_sku,
            u.name AS raised_by_name
     FROM dispatch_orders d
     JOIN batches b ON d.batch_id = b.id ${dvB.sql}
     JOIN products p ON b.product_id = p.id ${dvP.sql}
     LEFT JOIN dispatch_users u ON d.raised_by = u.id AND u.tenant_id = ?
     WHERE d.tenant_id = ? AND b.tenant_id = ? AND p.tenant_id = ? AND d.status = 'CANCELLED' ${orderScope} ${dvD.sql}
     ORDER BY d.created_at DESC LIMIT 10`,
    [...dvB.params, ...dvP.params, tenantId, tenantId, tenantId, tenantId, ...orderParams, ...dvD.params]
  );
  const approvedOrders = await query<RowDataPacket[]>(
    `SELECT d.*, b.batch_number, b.barcode_value, p.name AS product_name, p.sku AS product_sku
     FROM dispatch_orders d
     JOIN batches b ON d.batch_id = b.id ${dvB.sql}
     JOIN products p ON b.product_id = p.id ${dvP.sql}
     WHERE d.tenant_id = ? AND b.tenant_id = ? AND p.tenant_id = ?
       AND d.status = 'APPROVED'
       AND d.dispatched_at IS NULL
       AND b.status = 'DISPATCH_APPROVED' ${orderScope} ${dvD.sql}
     ORDER BY d.updated_at ASC LIMIT 10`,
    [...dvB.params, ...dvP.params, tenantId, tenantId, tenantId, ...orderParams, ...dvD.params]
  );
  const recentRecords = await query<RowDataPacket[]>(
    `SELECT dr.*, b.batch_number, b.barcode_value, p.name AS product_name, p.sku AS product_sku,
            u.name AS dispatcher_name
     FROM dispatch_records dr
     JOIN batches b ON dr.batch_id = b.id ${dvB.sql}
     JOIN products p ON b.product_id = p.id ${dvP.sql}
     LEFT JOIN dispatch_users u ON dr.dispatcher_id = u.id AND u.tenant_id = ?
     WHERE dr.tenant_id = ? AND b.tenant_id = ? AND p.tenant_id = ? ${recordScope} ${dvDr.sql}
     ORDER BY dr.created_at DESC LIMIT 20`,
    [...dvB.params, ...dvP.params, tenantId, tenantId, tenantId, tenantId, ...recordParams, ...dvDr.params]
  );
  const todayRecords = await query<RowDataPacket[]>(
    `SELECT dr.*, b.batch_number, b.barcode_value, p.name AS product_name,
            u.name AS dispatcher_name
     FROM dispatch_records dr
     JOIN batches b ON dr.batch_id = b.id ${dvB.sql}
     JOIN products p ON b.product_id = p.id ${dvP.sql}
     LEFT JOIN dispatch_users u ON dr.dispatcher_id = u.id AND u.tenant_id = ?
     WHERE dr.tenant_id = ? AND b.tenant_id = ? AND p.tenant_id = ? AND dr.created_at >= CURDATE() ${recordScope} ${dvDr.sql}
     ORDER BY dr.created_at DESC`,
    [...dvB.params, ...dvP.params, tenantId, tenantId, tenantId, tenantId, ...recordParams, ...dvDr.params]
  );

  res.json({
    scope: personal ? 'mine' : 'all',
    totalDispatches,
    dispatchedToday,
    dispatchedThisWeek,
    readyToDispatch,
    cancelledOrders: cancelledOrdersCount,
    approvedOrders: approvedOrdersCount,
    myDispatchedToday: dispatchedToday,
    myTotalDispatches: totalDispatches,
    readyBatches,
    cancelledOrdersList: cancelledOrders,
    approvedOrdersList: approvedOrders,
    recentRecords,
    todayRecords,
  });
}
