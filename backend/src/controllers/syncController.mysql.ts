import { Request, Response } from 'express';
import { query } from '../config/database';
import { RowDataPacket } from 'mysql2';
import { applyOperation, registerDevice, touchDeviceSync } from '../services/syncService';
import { SyncOperationInput } from '../types';
import { divisionWhere } from '../utils/division';

function parseCursor(value: unknown): number {
  if (value === undefined || value === null || value === '') return 0;
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, value);
  const text = String(value);
  const numeric = Number(text);
  if (Number.isFinite(numeric)) return Math.max(0, numeric);
  const parsed = new Date(text).getTime();
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

function parseLimit(value: unknown, fallback = 500): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(Math.floor(parsed), 1), 1000);
}

function lastUpdatedMs(rows: RowDataPacket[], fallback: number): number {
  let max = fallback;
  for (const row of rows) {
    const value = Number(row._updated_ms);
    if (Number.isFinite(value) && value > max) max = value;
  }
  return max;
}

async function rowsForPull(
  sql: string,
  params: any[],
  limit: number
): Promise<{ rows: RowDataPacket[]; hasMore: boolean; lastMs: number }> {
  const rows = await query<RowDataPacket[]>(sql, [...params, limit]);
  return {
    rows,
    hasMore: rows.length >= limit,
    lastMs: lastUpdatedMs(rows, 0),
  };
}

export async function register(req: Request, res: Response): Promise<void> {
  if (!req.user) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }
  const device = await registerDevice(req.user, req.body || {});
  console.info('[sync] device registered', JSON.stringify({
    request_id: (req as Request & { requestId?: string }).requestId || null,
    user_role: req.user.role,
    user_id: req.user.userId,
    device_uuid: device.device_uuid,
  }));
  res.json({ ...device, server_time: new Date().toISOString() });
}

export async function push(req: Request, res: Response): Promise<void> {
  if (!req.user) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }
  const tenantId = req.user!.tenantId;
  const operations = Array.isArray(req.body?.operations) ? req.body.operations : null;
  if (!operations) {
    res.status(400).json({ error: 'operations must be an array' });
    return;
  }
  if (operations.length > 100) {
    res.status(413).json({ error: 'A maximum of 100 operations can be pushed at once' });
    return;
  }

  const deviceUuid = typeof req.body?.device_uuid === 'string' ? req.body.device_uuid : null;
  const results = [];
  for (const raw of operations) {
    try {
      results.push(await applyOperation(req.user, deviceUuid, raw as SyncOperationInput));
    } catch (error) {
      results.push({
        operation_id: raw?.operation_id || null,
        status: 'FAILED',
        entity_type: null,
        entity_id: null,
        error: error instanceof Error ? error.message : 'Unexpected sync error',
        error_code: 'INTERNAL_ERROR',
      });
    }
  }

  const failed = results.filter((result) => result.status === 'FAILED').length;
  const conflicts = results.filter((result) => result.status === 'CONFLICT').length;
  await touchDeviceSync(deviceUuid, 'push', failed || conflicts ? `${failed} failed, ${conflicts} conflicts` : null, tenantId);

  const operationIssues = results
    .filter((result) => result.status === 'FAILED' || result.status === 'CONFLICT')
    .map((result) => ({
      operation_id: result.operation_id,
      status: result.status,
      error_code: result.error_code,
      error: result.error,
    }));
  console.info('[sync] push completed', JSON.stringify({
    request_id: (req as Request & { requestId?: string }).requestId || null,
    user_role: req.user.role,
    user_id: req.user.userId,
    device_uuid: deviceUuid,
    received: operations.length,
    applied: results.filter((result) => result.status === 'APPLIED').length,
    duplicates: results.filter((result) => result.status === 'DUPLICATE').length,
    conflicts,
    failed,
    operation_issues: operationIssues,
  }));

  res.json({
    results,
    applied: results.filter((result) => result.status === 'APPLIED').length,
    duplicates: results.filter((result) => result.status === 'DUPLICATE').length,
    conflicts,
    failed,
    server_time: new Date().toISOString(),
  });
}

export async function pull(req: Request, res: Response): Promise<void> {
  if (!req.user) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }
  const user = req.user;
  const tenantId = req.user!.tenantId;
  const since = parseCursor(req.query.since);
  const limit = parseLimit(req.query.limit, 500);
  // Re-read a small overlap window so timestamp precision or concurrent
  // writes cannot make a device miss a change. Clients dedupe by id.
  const querySince = Math.max(0, since - 5000);
  const deviceUuid = typeof req.query.device_uuid === 'string' ? req.query.device_uuid : null;
  const dv = divisionWhere(req);
  const dvL = divisionWhere(req, 'l.division_id');
  const dvS = divisionWhere(req, 's.division_id');
  const dvB = divisionWhere(req, 'b.division_id');
  const dvP = divisionWhere(req, 'p.division_id');

  const products = await rowsForPull(
    `SELECT p.*, UNIX_TIMESTAMP(p.updated_at) * 1000 AS _updated_ms
     FROM products p
     WHERE UNIX_TIMESTAMP(p.updated_at) * 1000 > ? AND p.tenant_id = ? AND p.is_active = 1${dv.sql}
     ORDER BY p.updated_at ASC LIMIT ?`,
    [querySince, tenantId, ...dv.params],
    limit
  );

  const locations = await rowsForPull(
    `SELECT s.*, UNIX_TIMESTAMP(s.updated_at) * 1000 AS _updated_ms
     FROM shelf_locations s
     WHERE UNIX_TIMESTAMP(s.updated_at) * 1000 > ? AND s.tenant_id = ?${dv.sql}
     ORDER BY s.updated_at ASC LIMIT ?`,
    [querySince, tenantId, ...dv.params],
    limit
  );

  const clients = await rowsForPull(
    `SELECT c.*, UNIX_TIMESTAMP(c.updated_at) * 1000 AS _updated_ms
     FROM clients c
     WHERE UNIX_TIMESTAMP(c.updated_at) * 1000 > ? AND c.tenant_id = ?
     ORDER BY c.updated_at ASC LIMIT ?`,
    [querySince, tenantId],
    limit
  );

  const batches = await rowsForPull(
    `SELECT b.*, p.name AS product_name, p.sku AS product_sku, p.cas_number,
            p.molecular_formula, p.grade AS product_grade, p.purity AS product_purity,
            p.hazard_classification, p.storage_conditions, p.manufacturer,
            p.physical_state, p.hsn_code,
            s.location_code,
            (SELECT JSON_ARRAYAGG(l.qr_value) FROM qr_labels l WHERE l.batch_id = b.id AND l.tenant_id = ?${dvL.sql}) AS unit_qr_codes,
            UNIX_TIMESTAMP(b.updated_at) * 1000 AS _updated_ms
     FROM batches b JOIN products p ON b.product_id = p.id
     LEFT JOIN shelf_locations s ON s.id = b.shelf_location_id AND s.tenant_id = ?${dvS.sql}
     WHERE UNIX_TIMESTAMP(b.updated_at) * 1000 > ? AND b.tenant_id = ?${dvB.sql} AND p.tenant_id = ?${dvP.sql}
     ORDER BY b.updated_at ASC LIMIT ?`,
    [tenantId, ...dvL.params, tenantId, ...dvS.params, querySince, tenantId, ...dvB.params, tenantId, ...dvP.params],
    limit
  );

  let qcRecords: { rows: RowDataPacket[]; hasMore: boolean; lastMs: number } = {
    rows: [], hasMore: false, lastMs: 0,
  };
  if (user.role === 'QC' || user.role === 'ADMIN') {
    const dvQ = divisionWhere(req, 'q.division_id');
    const mine = user.role === 'QC' ? 'AND q.tester_id = ?' : '';
    const params = [querySince, tenantId, ...dvQ.params, tenantId, ...dvB.params, tenantId, ...dvP.params, ...(user.role === 'QC' ? [user.userId] : [])];
    qcRecords = await rowsForPull(
      `SELECT q.*, b.batch_number, b.barcode_value, p.name AS product_name,
              UNIX_TIMESTAMP(q.created_at) * 1000 AS _updated_ms
       FROM qc_records q
       JOIN batches b ON q.batch_id = b.id
       JOIN products p ON b.product_id = p.id
       WHERE UNIX_TIMESTAMP(q.created_at) * 1000 > ? AND q.tenant_id = ?${dvQ.sql} AND b.tenant_id = ?${dvB.sql} AND p.tenant_id = ?${dvP.sql} ${mine}
       ORDER BY q.created_at ASC LIMIT ?`,
      params,
      limit
    );
  }

  let dispatchOrders: { rows: RowDataPacket[]; hasMore: boolean; lastMs: number } = {
    rows: [], hasMore: false, lastMs: 0,
  };
  if (user.role === 'DISPATCH' || user.role === 'ADMIN') {
    const dvD = divisionWhere(req, 'd.division_id');
    const mine = user.role === 'DISPATCH' ? 'AND d.raised_by = ?' : '';
    const params = [tenantId, tenantId, querySince, tenantId, ...dvD.params, tenantId, ...dvB.params, tenantId, ...dvP.params, ...(user.role === 'DISPATCH' ? [user.userId] : [])];
    dispatchOrders = await rowsForPull(
      `SELECT d.*, b.batch_number, b.barcode_value, p.name AS product_name,
              p.sku AS product_sku, u.name AS raised_by_name, c.name AS client_name,
              UNIX_TIMESTAMP(d.updated_at) * 1000 AS _updated_ms
       FROM dispatch_orders d
       JOIN batches b ON d.batch_id = b.id
       JOIN products p ON b.product_id = p.id
       LEFT JOIN dispatch_users u ON d.raised_by = u.id AND u.tenant_id = ?
       LEFT JOIN clients c ON c.id = d.client_id AND c.tenant_id = ?
       WHERE UNIX_TIMESTAMP(d.updated_at) * 1000 > ? AND d.tenant_id = ?${dvD.sql} AND b.tenant_id = ?${dvB.sql} AND p.tenant_id = ?${dvP.sql} ${mine}
       ORDER BY d.updated_at ASC LIMIT ?`,
      params,
      limit
    );
  }

  let dispatchRecords: { rows: RowDataPacket[]; hasMore: boolean; lastMs: number } = {
    rows: [], hasMore: false, lastMs: 0,
  };
  if (user.role === 'DISPATCH' || user.role === 'ADMIN') {
    const dvDR = divisionWhere(req, 'dr.division_id');
    const mine = user.role === 'DISPATCH' ? 'AND dr.dispatcher_id = ?' : '';
    const params = [querySince, tenantId, ...dvDR.params, tenantId, ...dvB.params, tenantId, ...dvP.params, ...(user.role === 'DISPATCH' ? [user.userId] : [])];
    dispatchRecords = await rowsForPull(
      `SELECT dr.*, b.batch_number, b.barcode_value, p.name AS product_name,
              UNIX_TIMESTAMP(dr.created_at) * 1000 AS _updated_ms
       FROM dispatch_records dr
       JOIN batches b ON dr.batch_id = b.id
       JOIN products p ON b.product_id = p.id
       WHERE UNIX_TIMESTAMP(dr.created_at) * 1000 > ? AND dr.tenant_id = ?${dvDR.sql} AND b.tenant_id = ?${dvB.sql} AND p.tenant_id = ?${dvP.sql} ${mine}
       ORDER BY dr.created_at ASC LIMIT ?`,
      params,
      limit
    );
  }

  let workQueue: RowDataPacket[] = [];
  if (user.role === 'QC') {
    workQueue = await query<RowDataPacket[]>(
      `SELECT b.*, p.name AS product_name, p.sku AS product_sku, p.cas_number,
              p.molecular_formula, p.grade AS product_grade, p.purity AS product_purity,
              p.hazard_classification, p.storage_conditions,
              (SELECT JSON_ARRAYAGG(l.qr_value) FROM qr_labels l WHERE l.batch_id = b.id AND l.tenant_id = ?${dvL.sql}) AS unit_qr_codes,
              TIMESTAMPDIFF(MINUTE, b.created_at, NOW()) AS age_minutes
       FROM batches b JOIN products p ON b.product_id = p.id
       WHERE b.status = 'CREATED' AND b.tenant_id = ?${dvB.sql} AND p.tenant_id = ?${dvP.sql}
       ORDER BY b.created_at ASC LIMIT 200`,
      [tenantId, ...dvL.params, tenantId, ...dvB.params, tenantId, ...dvP.params]
    );
  } else if (user.role === 'DISPATCH') {
    workQueue = await query<RowDataPacket[]>(
      `SELECT b.*, p.name AS product_name, p.sku AS product_sku,
              (SELECT JSON_ARRAYAGG(l.qr_value) FROM qr_labels l WHERE l.batch_id = b.id AND l.tenant_id = ?${dvL.sql}) AS unit_qr_codes,
              TIMESTAMPDIFF(MINUTE, b.updated_at, NOW()) AS age_minutes
       FROM batches b JOIN products p ON b.product_id = p.id
       WHERE b.status IN ('QC_PASSED', 'DISPATCH_REJECTED', 'DISPATCH_APPROVED') AND b.tenant_id = ?${dvB.sql} AND p.tenant_id = ?${dvP.sql}
       ORDER BY b.updated_at ASC LIMIT 200`,
      [tenantId, ...dvL.params, tenantId, ...dvB.params, tenantId, ...dvP.params]
    );
  } else {
    workQueue = await query<RowDataPacket[]>(
      `SELECT b.*, p.name AS product_name, p.sku AS product_sku,
              (SELECT JSON_ARRAYAGG(l.qr_value) FROM qr_labels l WHERE l.batch_id = b.id AND l.tenant_id = ?${dvL.sql}) AS unit_qr_codes,
              TIMESTAMPDIFF(MINUTE, b.updated_at, NOW()) AS age_minutes
       FROM batches b JOIN products p ON b.product_id = p.id
       WHERE b.status IN ('CREATED', 'QC_PASSED', 'DISPATCH_ORDER_RAISED', 'DISPATCH_APPROVED') AND b.tenant_id = ?${dvB.sql} AND p.tenant_id = ?${dvP.sql}
       ORDER BY b.updated_at ASC LIMIT 200`,
      [tenantId, ...dvL.params, tenantId, ...dvB.params, tenantId, ...dvP.params]
    );
  }

  let myOrders: RowDataPacket[] = [];
  if (user.role === 'DISPATCH' || user.role === 'ADMIN') {
    const dvD = divisionWhere(req, 'd.division_id');
    const mine = user.role === 'DISPATCH' ? 'AND d.raised_by = ?' : '';
    const params = [tenantId, tenantId, ...dvD.params, tenantId, ...dvB.params, tenantId, ...dvP.params, ...(user.role === 'DISPATCH' ? [user.userId] : [])];
    myOrders = await query<RowDataPacket[]>(
      `SELECT d.*, b.batch_number, b.barcode_value, p.name AS product_name, p.sku AS product_sku,
              c.name AS client_name
       FROM dispatch_orders d
       JOIN batches b ON d.batch_id = b.id
       JOIN products p ON b.product_id = p.id
       LEFT JOIN clients c ON c.id = d.client_id AND c.tenant_id = ?
       WHERE d.status IN ('PENDING', 'APPROVED')
         AND d.dispatched_at IS NULL AND d.tenant_id = ?${dvD.sql} AND b.tenant_id = ?${dvB.sql} AND p.tenant_id = ?${dvP.sql} ${mine}
       ORDER BY d.created_at DESC LIMIT 100`,
      params
    );
  }

  const [pendingQcCount] = await query<RowDataPacket[]>(
    `SELECT COUNT(*) AS count FROM batches WHERE status = 'CREATED' AND tenant_id = ?${dv.sql}`,
    [tenantId, ...dv.params]
  );
  const [readyCount] = await query<RowDataPacket[]>(
    `SELECT COUNT(*) AS count FROM batches WHERE status IN ('QC_PASSED', 'DISPATCH_REJECTED') AND tenant_id = ?${dv.sql}`,
    [tenantId, ...dv.params]
  );
  const [pendingOrderCount] = await query<RowDataPacket[]>(
    `SELECT COUNT(*) AS count FROM dispatch_orders WHERE status = 'PENDING' AND tenant_id = ?${dv.sql}`,
    [tenantId, ...dv.params]
  );
  const [myTestsToday] = await query<RowDataPacket[]>(
    `SELECT COUNT(*) AS count FROM qc_records
     WHERE tester_id = ? AND created_at >= CURDATE() AND tenant_id = ?${dv.sql}`,
    [user.userId, tenantId, ...dv.params]
  );
  const [myDispatchesToday] = await query<RowDataPacket[]>(
    `SELECT COUNT(*) AS count FROM dispatch_records
     WHERE dispatcher_id = ? AND created_at >= CURDATE() AND tenant_id = ?${dv.sql}`,
    [user.userId, tenantId, ...dv.params]
  );

  const pages = [products, locations, clients, batches, qcRecords, dispatchOrders, dispatchRecords];
  const hasMore = pages.some((page) => page.hasMore);
  const maxLast = Math.max(
    since,
    products.lastMs,
    locations.lastMs,
    clients.lastMs,
    batches.lastMs,
    qcRecords.lastMs,
    dispatchOrders.lastMs,
    dispatchRecords.lastMs
  );
  const limitedLast = pages
    .filter((page) => page.hasMore && page.lastMs > 0)
    .map((page) => page.lastMs);
  const cursor = hasMore && limitedLast.length > 0
    ? Math.max(since, Math.min(...limitedLast) - 1)
    : maxLast;

  await touchDeviceSync(deviceUuid, 'pull', null, tenantId);

  console.info('[sync] pull completed', JSON.stringify({
    request_id: (req as Request & { requestId?: string }).requestId || null,
    user_role: user.role,
    user_id: user.userId,
    device_uuid: deviceUuid,
    since,
    cursor,
    has_more: hasMore,
    products: products.rows.length,
    shelf_locations: locations.rows.length,
    clients: clients.rows.length,
    batches: batches.rows.length,
    qc_records: qcRecords.rows.length,
    dispatch_orders: dispatchOrders.rows.length,
    dispatch_records: dispatchRecords.rows.length,
  }));

  res.json({
    server_time: new Date().toISOString(),
    cursor,
    since,
    has_more: hasMore,
    role: user.role,
    products: products.rows,
    shelf_locations: locations.rows,
    clients: clients.rows,
    batches: batches.rows,
    qc_records: qcRecords.rows,
    dispatch_orders: dispatchOrders.rows,
    dispatch_records: dispatchRecords.rows,
    work_queue: workQueue,
    my_orders: myOrders,
    counts: {
      pending_qc: Number(pendingQcCount?.count || 0),
      ready_to_dispatch: Number(readyCount?.count || 0),
      pending_orders: Number(pendingOrderCount?.count || 0),
      my_tests_today: Number(myTestsToday?.count || 0),
      my_dispatches_today: Number(myDispatchesToday?.count || 0),
    },
  });
}

export async function status(req: Request, res: Response): Promise<void> {
  if (!req.user) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }
  const tenantId = req.user!.tenantId;
  const deviceUuid = typeof req.query.device_uuid === 'string' ? req.query.device_uuid : null;
  const deviceRows = deviceUuid
    ? await query<RowDataPacket[]>('SELECT * FROM devices WHERE device_uuid = ? AND tenant_id = ? LIMIT 1', [deviceUuid, tenantId])
    : [];
  const stateRows = deviceUuid
    ? await query<RowDataPacket[]>('SELECT * FROM device_sync_state WHERE device_uuid = ? AND tenant_id = ? LIMIT 1', [deviceUuid, tenantId])
    : [];
  const operationCounts = await query<RowDataPacket[]>(
    `SELECT status, COUNT(*) AS count FROM sync_operations
     WHERE user_role = ? AND user_id = ? AND server_timestamp > DATE_SUB(NOW(3), INTERVAL 7 DAY) AND tenant_id = ?
     GROUP BY status`,
    [req.user.role, req.user.userId, tenantId]
  );

  res.json({
    server_time: new Date().toISOString(),
    device: deviceRows[0] || null,
    sync_state: stateRows[0] || null,
    operation_counts: operationCounts,
  });
}

export async function uploadAttachments(req: Request, res: Response): Promise<void> {
  const files = (req.files as Express.Multer.File[]) || [];
  if (files.length === 0) {
    res.status(400).json({ error: 'At least one image is required' });
    return;
  }
  res.json({
    files: files.map((file) => ({
      filename: file.filename,
      url: `/uploads/${file.filename}`,
      size: file.size,
      mime_type: file.mimetype,
    })),
  });
}
