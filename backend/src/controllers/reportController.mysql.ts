import { Request, Response } from 'express';
import { query } from '../config/database';
import { RowDataPacket } from 'mysql2';
import { divisionWhere } from '../utils/division';

type Filter = { where: string[]; params: any[] };

function dateFilter(req: Request, column: string, filter: Filter): void {
  const from = req.query.from as string | undefined;
  const to = req.query.to as string | undefined;
  if (from) { filter.where.push(`DATE(${column}) >= ?`); filter.params.push(from); }
  if (to) { filter.where.push(`DATE(${column}) <= ?`); filter.params.push(to); }
}

function whereSql(filter: Filter): string {
  return filter.where.length > 0 ? `WHERE ${filter.where.join(' AND ')}` : '';
}

export async function summary(req: Request, res: Response): Promise<void> {
  const tenantId = req.user!.tenantId;
  const dv = divisionWhere(req);
  const [products] = await query<RowDataPacket[]>(
    `SELECT COUNT(*) AS count, COALESCE(SUM(quantity), 0) AS qty
     FROM products WHERE tenant_id = ?${dv.sql}`,
    [tenantId, ...dv.params]
  );
  const [batches] = await query<RowDataPacket[]>(`SELECT COUNT(*) AS count FROM batches WHERE tenant_id = ?${dv.sql}`, [tenantId, ...dv.params]);
  const [qc] = await query<RowDataPacket[]>(
    `SELECT
       COUNT(*) AS total,
       SUM(CASE WHEN result = 'PASS' THEN 1 ELSE 0 END) AS passed,
       SUM(CASE WHEN result = 'FAIL' THEN 1 ELSE 0 END) AS failed
     FROM qc_records
     WHERE tenant_id = ?${dv.sql}`,
    [tenantId, ...dv.params]
  );
  const [pendingQc] = await query<RowDataPacket[]>(
    `SELECT COUNT(*) AS count FROM batches WHERE status = 'CREATED' AND tenant_id = ?${dv.sql}`,
    [tenantId, ...dv.params]
  );
  const [dispatches] = await query<RowDataPacket[]>(
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN DATE(created_at) = CURDATE() THEN 1 ELSE 0 END) AS today
     FROM dispatch_records
     WHERE tenant_id = ?${dv.sql}`,
    [tenantId, ...dv.params]
  );
  const [requests] = await query<RowDataPacket[]>(
    `SELECT
       COUNT(*) AS total,
       SUM(CASE WHEN status = 'APPROVED' THEN 1 ELSE 0 END) AS pending,
       SUM(CASE WHEN status IN ('APPROVED','CLOSED_DISPATCHED','CLOSED_NOT_DISPATCHED') THEN 1 ELSE 0 END) AS approved,
       SUM(CASE WHEN status IN ('REJECTED','CANCELLED') THEN 1 ELSE 0 END) AS rejected
     FROM dispatch_orders
     WHERE tenant_id = ?${dv.sql}`,
    [tenantId, ...dv.params]
  );
  const [locations] = await query<RowDataPacket[]>(
    `SELECT COUNT(*) AS total, SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) AS active FROM shelf_locations WHERE tenant_id = ?${dv.sql}`,
    [tenantId, ...dv.params]
  );
  const [users] = await query<RowDataPacket[]>(
    `SELECT
       (SELECT COUNT(*) FROM admins WHERE tenant_id = ?) + (SELECT COUNT(*) FROM qc_users WHERE tenant_id = ?) +
       (SELECT COUNT(*) FROM dispatch_users WHERE tenant_id = ?) AS total,
       (SELECT COUNT(*) FROM admins WHERE is_active = 1 AND tenant_id = ?) +
       (SELECT COUNT(*) FROM qc_users WHERE is_active = 1 AND tenant_id = ?) +
       (SELECT COUNT(*) FROM dispatch_users WHERE is_active = 1 AND tenant_id = ?) AS active`,
    [tenantId, tenantId, tenantId, tenantId, tenantId, tenantId]
  );

  const qcTotal = Number(qc.total) || 0;
  const qcPassed = Number(qc.passed) || 0;
  res.json({
    totalProducts: Number(products.count) || 0,
    totalBatches: Number(batches.count) || 0,
    inventoryQty: Number(products.qty) || 0,
    inventoryValue: Number(products.value) || 0,
    qcTotal,
    qcPassed,
    qcFailed: Number(qc.failed) || 0,
    qcPassRate: qcTotal > 0 ? Math.round((qcPassed / qcTotal) * 100) : 0,
    pendingQc: Number(pendingQc.count) || 0,
    dispatchTotal: Number(dispatches.total) || 0,
    dispatchedToday: Number(dispatches.today) || 0,
    totalRequests: Number(requests.total) || 0,
    pendingRequests: Number(requests.pending) || 0,
    approvedRequests: Number(requests.approved) || 0,
    rejectedRequests: Number(requests.rejected) || 0,
    totalLocations: Number(locations.total) || 0,
    activeLocations: Number(locations.active) || 0,
    totalUsers: Number(users.total) || 0,
    activeUsers: Number(users.active) || 0,
  });
}

export async function qcReport(req: Request, res: Response): Promise<void> {
  const tenantId = req.user!.tenantId;
  const dvQ = divisionWhere(req, 'q.division_id');
  const dvB = divisionWhere(req, 'b.division_id');
  const dvP = divisionWhere(req, 'p.division_id');
  const filter: Filter = { where: ['q.tenant_id = ?', 'b.tenant_id = ?', 'p.tenant_id = ?'], params: [tenantId, tenantId, tenantId] };
  dateFilter(req, 'q.created_at', filter);
  if (req.query.result === 'PASS' || req.query.result === 'FAIL') {
    filter.where.push('q.result = ?');
    filter.params.push(req.query.result);
  }

  const records = await query<RowDataPacket[]>(
    `SELECT q.id, q.batch_id, q.result, q.remarks, q.images, q.created_at,
            b.batch_number, b.barcode_value, b.quantity, b.uom,
            p.name AS product_name, p.sku AS product_sku, p.grade,
            COALESCE(u.name, 'Unknown') AS tester_name
     FROM qc_records q
     JOIN batches b ON q.batch_id = b.id
     JOIN products p ON b.product_id = p.id
     LEFT JOIN qc_users u ON q.tester_id = u.id AND u.tenant_id = ?
     ${whereSql(filter)}${dvQ.sql}${dvB.sql}${dvP.sql}
     ORDER BY q.created_at DESC
     LIMIT 1000`,
    [tenantId, ...filter.params, ...dvQ.params, ...dvB.params, ...dvP.params]
  );
  res.json(records);
}

export async function dispatchReport(req: Request, res: Response): Promise<void> {
  const tenantId = req.user!.tenantId;
  const dvD = divisionWhere(req, 'd.division_id');
  const dvB = divisionWhere(req, 'b.division_id');
  const dvP = divisionWhere(req, 'p.division_id');
  const dvO = divisionWhere(req, 'o.division_id');
  const dvG = divisionWhere(req, 'g.division_id');
  const filter: Filter = { where: ['d.tenant_id = ?', 'b.tenant_id = ?', 'p.tenant_id = ?'], params: [tenantId, tenantId, tenantId] };
  dateFilter(req, 'd.created_at', filter);

  const records = await query<RowDataPacket[]>(
    `SELECT d.id, d.batch_id, d.dispatch_order_id, d.remarks, d.images, d.created_at,
            b.batch_number, b.barcode_value, b.quantity, b.uom, b.storage_location,
            p.name AS product_name, p.sku AS product_sku, COALESCE(g.name, p.grade) AS grade,
            q.quantity AS bag_quantity, q.unit AS bag_quantity_unit,
            c.name AS client_name, o.container_number, o.vehicle_number,
            COALESCE(u.name, 'Unknown') AS dispatcher_name
     FROM dispatch_records d
     JOIN batches b ON d.batch_id = b.id
     JOIN products p ON b.product_id = p.id
     LEFT JOIN dispatch_orders o ON o.id = d.dispatch_order_id AND o.tenant_id = ?${dvO.sql}
     LEFT JOIN clients c ON c.id = o.client_id AND c.tenant_id = ?
     LEFT JOIN grades g ON g.id = b.grade_id AND g.tenant_id = ?${dvG.sql}
     LEFT JOIN bag_quantities q ON q.id = b.bag_quantity_id AND q.tenant_id = ?
     LEFT JOIN dispatch_users u ON d.dispatcher_id = u.id AND u.tenant_id = ?
     ${whereSql(filter)}${dvD.sql}${dvB.sql}${dvP.sql}
     ORDER BY d.created_at DESC
     LIMIT 1000`,
    [tenantId, ...dvO.params, tenantId, tenantId, ...dvG.params, tenantId, tenantId, ...filter.params, ...dvD.params, ...dvB.params, ...dvP.params]
  );
  res.json(records);
}

export async function dispatchRequests(req: Request, res: Response): Promise<void> {
  const tenantId = req.user!.tenantId;
  const dvD = divisionWhere(req, 'd.division_id');
  const dvB = divisionWhere(req, 'b.division_id');
  const dvP = divisionWhere(req, 'p.division_id');
  const dvG = divisionWhere(req, 'g.division_id');
  const filter: Filter = { where: ['d.tenant_id = ?', 'b.tenant_id = ?', 'p.tenant_id = ?'], params: [tenantId, tenantId, tenantId] };
  dateFilter(req, 'd.created_at', filter);
  if (['PENDING', 'APPROVED', 'REJECTED'].includes(String(req.query.status))) {
    filter.where.push('d.status = ?');
    filter.params.push(req.query.status);
  }

  const orders = await query<RowDataPacket[]>(
    `SELECT d.id, d.batch_id, d.status, d.admin_remarks, d.created_at, d.updated_at,
            d.driver_name, d.vehicle_number, d.container_number,
            b.batch_number, b.status AS batch_status, b.quantity, b.uom, b.barcode_value,
            p.name AS product_name, p.sku AS product_sku, p.grade AS product_grade,
            g.name AS grade_name, q.name AS bag_quantity_name,
            q.quantity AS bag_quantity, q.unit AS bag_quantity_unit,
            c.name AS client_name, c.contact_person AS client_contact,
            c.email AS client_email, c.phone AS client_phone, c.address AS client_address,
            COALESCE(du.name, 'Unknown') AS raised_by_name,
            COALESCE(aa.name, qu.name) AS admin_name
     FROM dispatch_orders d
     JOIN batches b ON d.batch_id = b.id
     JOIN products p ON b.product_id = p.id
     LEFT JOIN grades g ON g.id = b.grade_id AND g.tenant_id = ?${dvG.sql}
     LEFT JOIN bag_quantities q ON q.id = b.bag_quantity_id AND q.tenant_id = ?
     LEFT JOIN clients c ON c.id = d.client_id AND c.tenant_id = ?
     LEFT JOIN dispatch_users du ON d.raised_by = du.id AND du.tenant_id = ?
     LEFT JOIN admins da ON d.admin_id = da.id AND da.tenant_id = ?
     LEFT JOIN admins aa ON d.approved_by_id = aa.id AND d.approved_by_role = 'ADMIN' AND aa.tenant_id = ?
     LEFT JOIN qc_users qu ON d.approved_by_id = qu.id AND d.approved_by_role = 'QC' AND qu.tenant_id = ?
     ${whereSql(filter)}${dvD.sql}${dvB.sql}${dvP.sql}
     ORDER BY d.created_at DESC
     LIMIT 1000`,
    [tenantId, ...dvG.params, tenantId, tenantId, tenantId, tenantId, tenantId, tenantId, ...filter.params, ...dvD.params, ...dvB.params, ...dvP.params]
  );
  res.json(orders);
}

export async function inventory(req: Request, res: Response): Promise<void> {
  const tenantId = req.user!.tenantId;
  const dv = divisionWhere(req);
  const dvB = divisionWhere(req, 'b.division_id');
  const rows = await query<RowDataPacket[]>(
    `SELECT p.id, p.name, p.sku, p.description, p.grade, p.purity, p.cas_number,
            p.physical_state, p.hsn_code, p.manufacturer, p.storage_conditions,
            p.quantity,
            COALESCE(SUM(b.quantity), 0) AS batch_quantity,
            COUNT(b.id) AS batch_count,
            COALESCE(SUM(CASE WHEN b.status = 'QC_PASSED' THEN b.quantity ELSE 0 END), 0) AS qc_passed_quantity,
            COALESCE(SUM(CASE WHEN b.status = 'DISPATCHED' THEN b.quantity ELSE 0 END), 0) AS dispatched_quantity
     FROM products p
     LEFT JOIN batches b ON b.product_id = p.id AND b.tenant_id = ?${dvB.sql}
     WHERE p.tenant_id = ?${dv.sql}
     GROUP BY p.id
     ORDER BY p.name ASC`,
    [tenantId, ...dvB.params, tenantId, ...dv.params]
  );
  res.json(rows.map(row => ({
    ...row,
  })));
}

export async function batchesReport(req: Request, res: Response): Promise<void> {
  const tenantId = req.user!.tenantId;
  const dvB = divisionWhere(req, 'b.division_id');
  const dvP = divisionWhere(req, 'p.division_id');
  const filter: Filter = { where: ['b.tenant_id = ?', 'p.tenant_id = ?'], params: [tenantId, tenantId] };
  dateFilter(req, 'b.created_at', filter);
  if (req.query.status) {
    filter.where.push('b.status = ?');
    filter.params.push(req.query.status);
  }

  const rows = await query<RowDataPacket[]>(
    `SELECT b.*, p.name AS product_name, p.sku AS product_sku, p.grade, p.purity
     FROM batches b
     JOIN products p ON b.product_id = p.id
     ${whereSql(filter)}${dvB.sql}${dvP.sql}
     ORDER BY b.created_at DESC
     LIMIT 1000`,
    [...filter.params, ...dvB.params, ...dvP.params]
  );
  res.json(rows);
}
