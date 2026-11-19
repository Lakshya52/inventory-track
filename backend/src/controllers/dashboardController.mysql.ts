import { Request, Response } from 'express';
import { query } from '../config/database';
import { RowDataPacket } from 'mysql2';
import { divisionWhere } from '../utils/division';

export async function stats(req: Request, res: Response): Promise<void> {
  const tenantId = req.user!.tenantId;
  const dv = divisionWhere(req);
  const dvB = divisionWhere(req, 'b.division_id');
  const dvP = divisionWhere(req, 'p.division_id');
  const totalProducts = await query<RowDataPacket[]>(`SELECT COUNT(*) as count FROM products WHERE tenant_id = ?${dv.sql}`, [tenantId, ...dv.params]);
  const totalBatches = await query<RowDataPacket[]>(`SELECT COUNT(*) as count FROM batches WHERE tenant_id = ?${dv.sql}`, [tenantId, ...dv.params]);
  const pendingQc = await query<RowDataPacket[]>(`SELECT COUNT(*) as count FROM batches WHERE status IN ('CREATED', 'QC_PASSED') AND tenant_id = ?${dv.sql}`, [tenantId, ...dv.params]);
  const qcPassed = await query<RowDataPacket[]>(`SELECT COUNT(*) as count FROM batches WHERE status = 'QC_PASSED' AND tenant_id = ?${dv.sql}`, [tenantId, ...dv.params]);
  const qcFailed = await query<RowDataPacket[]>(`SELECT COUNT(*) as count FROM batches WHERE status = 'QC_FAILED' AND tenant_id = ?${dv.sql}`, [tenantId, ...dv.params]);
  const dispatchedToday = await query<RowDataPacket[]>(
    `SELECT COUNT(*) as count FROM dispatch_records WHERE DATE(created_at) = CURDATE() AND tenant_id = ?${dv.sql}`, [tenantId, ...dv.params]
  );
  const inventory = await query<RowDataPacket[]>(
    `SELECT COALESCE(SUM(quantity), 0) as qty, COALESCE(SUM(quantity * price), 0) as value FROM products WHERE tenant_id = ?${dv.sql}`, [tenantId, ...dv.params]
  );
  const pendingOrders = await query<RowDataPacket[]>(
    `SELECT COUNT(*) as count FROM dispatch_orders WHERE status = 'APPROVED' AND tenant_id = ?${dv.sql}`, [tenantId, ...dv.params]
  );
  const activeClients = await query<RowDataPacket[]>(
    "SELECT COUNT(*) as count FROM clients WHERE is_active = 1 AND tenant_id = ?", [tenantId]
  );
  const totalLocations = await query<RowDataPacket[]>(
    `SELECT COUNT(*) as count FROM shelf_locations WHERE is_active = 1 AND tenant_id = ?${dv.sql}`, [tenantId, ...dv.params]
  );
  const recentActivity = await query<RowDataPacket[]>(
    `SELECT * FROM activity_logs WHERE tenant_id = ?${dv.sql} ORDER BY created_at DESC LIMIT 10`, [tenantId, ...dv.params]
  );
  const recentBatches = await query<RowDataPacket[]>(
    `SELECT b.id, b.batch_number, b.quantity, b.barcode_value, b.status, b.created_at,
            p.name as product_name, p.sku as product_sku
     FROM batches b JOIN products p ON b.product_id = p.id
     WHERE b.tenant_id = ?${dvB.sql} AND p.tenant_id = ?${dvP.sql}
     ORDER BY b.created_at DESC LIMIT 10`,
    [tenantId, ...dvB.params, tenantId, ...dvP.params]
  );
  const productionStats = await query<RowDataPacket[]>(
    `SELECT
       SUM(CASE WHEN status = 'CREATED' THEN 1 ELSE 0 END) as in_production,
       SUM(CASE WHEN status = 'QC_FAILED' THEN 1 ELSE 0 END) as needs_fix
     FROM batches WHERE status IN ('CREATED','QC_FAILED') AND tenant_id = ?${dv.sql}`,
    [tenantId, ...dv.params]
  );
  const dispatchQueueStats = await query<RowDataPacket[]>(
    `SELECT
       SUM(CASE WHEN status = 'LOADING' THEN 1 ELSE 0 END) as awaiting_approval,
       SUM(CASE WHEN status = 'DISPATCH_APPROVED' THEN 1 ELSE 0 END) as approved_ready
     FROM batches WHERE status IN ('LOADING','DISPATCH_APPROVED') AND tenant_id = ?${dv.sql}`,
    [tenantId, ...dv.params]
  );

  res.json({
    totalProducts: totalProducts[0].count,
    totalBatches: totalBatches[0].count,
    pendingQc: pendingQc[0].count,
    qcPassed: qcPassed[0].count,
    qcFailed: qcFailed[0].count,
    dispatchedToday: dispatchedToday[0].count,
    currentInventory: inventory[0].qty,
    inventoryValue: inventory[0].value,
    pendingDispatchOrders: pendingOrders[0].count,
    activeClients: activeClients[0].count,
    totalLocations: totalLocations[0].count,
    productionStats: productionStats[0],
    dispatchQueueStats: dispatchQueueStats[0],
    recentActivity,
    recentBatches,
  });
}

export async function adminStats(req: Request, res: Response): Promise<void> {
  const tenantId = req.user!.tenantId;
  const dv = divisionWhere(req);
  const dvB = divisionWhere(req, 'b.division_id');
  const dvP = divisionWhere(req, 'p.division_id');
  const dvQ = divisionWhere(req, 'q.division_id');
  const dvD = divisionWhere(req, 'd.division_id');
  const summary = await query<RowDataPacket[]>(
    `SELECT
       (SELECT COUNT(*) FROM products WHERE tenant_id = ?${dv.sql}) AS total_products,
       (SELECT COALESCE(SUM(quantity), 0) FROM products WHERE tenant_id = ?${dv.sql}) AS inventory_qty,
       (SELECT COALESCE(SUM(quantity * price), 0) FROM products WHERE tenant_id = ?${dv.sql}) AS inventory_value,
       (SELECT COUNT(*) FROM batches WHERE tenant_id = ?${dv.sql}) AS total_batches,
       (SELECT COUNT(*) FROM batches WHERE status = 'CREATED' AND tenant_id = ?${dv.sql}) AS pending_qc,
       (SELECT COUNT(*) FROM qc_records WHERE tenant_id = ?${dv.sql}) AS qc_total,
       (SELECT COUNT(*) FROM qc_records WHERE result = 'PASS' AND tenant_id = ?${dv.sql}) AS qc_passed,
       (SELECT COUNT(*) FROM qc_records WHERE result = 'FAIL' AND tenant_id = ?${dv.sql}) AS qc_failed,
       (SELECT COUNT(*) FROM dispatch_records WHERE tenant_id = ?${dv.sql}) AS dispatch_total,
       (SELECT COUNT(*) FROM dispatch_records WHERE DATE(created_at) = CURDATE() AND tenant_id = ?${dv.sql}) AS dispatched_today,
       (SELECT COUNT(*) FROM dispatch_orders WHERE tenant_id = ?${dv.sql}) AS request_total,
       (SELECT COUNT(*) FROM dispatch_orders WHERE status = 'PENDING' AND tenant_id = ?${dv.sql}) AS request_pending,
       (SELECT COUNT(*) FROM dispatch_orders WHERE status = 'APPROVED' AND tenant_id = ?${dv.sql}) AS request_approved,
       (SELECT COUNT(*) FROM dispatch_orders WHERE status = 'REJECTED' AND tenant_id = ?${dv.sql}) AS request_rejected,
       (SELECT COUNT(*) FROM shelf_locations WHERE tenant_id = ?${dv.sql}) AS total_locations,
       (SELECT COUNT(*) FROM shelf_locations WHERE is_active = 1 AND tenant_id = ?${dv.sql}) AS active_locations,
       (SELECT COUNT(*) FROM admins WHERE LEFT(email, 15) <> '__role_archive_' AND tenant_id = ?) +
         (SELECT COUNT(*) FROM qc_users WHERE LEFT(email, 15) <> '__role_archive_' AND tenant_id = ?) +
         (SELECT COUNT(*) FROM dispatch_users WHERE LEFT(email, 15) <> '__role_archive_' AND tenant_id = ?) AS total_users,
       (SELECT COUNT(*) FROM admins WHERE is_active = 1 AND tenant_id = ?) +
         (SELECT COUNT(*) FROM qc_users WHERE is_active = 1 AND tenant_id = ?) +
         (SELECT COUNT(*) FROM dispatch_users WHERE is_active = 1 AND tenant_id = ?) AS active_users`,
    [
      tenantId, ...dv.params, tenantId, ...dv.params, tenantId, ...dv.params, tenantId, ...dv.params,
      tenantId, ...dv.params, tenantId, ...dv.params, tenantId, ...dv.params, tenantId, ...dv.params,
      tenantId, ...dv.params, tenantId, ...dv.params, tenantId, ...dv.params, tenantId, ...dv.params,
      tenantId, ...dv.params, tenantId, ...dv.params, tenantId, ...dv.params, tenantId, ...dv.params,
      tenantId, tenantId, tenantId, tenantId, tenantId, tenantId,
    ]
  );

  const recentQc = await query<RowDataPacket[]>(
    `SELECT q.id, q.result, q.remarks, q.created_at, b.batch_number,
            p.name AS product_name, p.sku AS product_sku
     FROM qc_records q
     JOIN batches b ON q.batch_id = b.id
     JOIN products p ON b.product_id = p.id
     WHERE q.tenant_id = ?${dvQ.sql} AND b.tenant_id = ?${dvB.sql} AND p.tenant_id = ?${dvP.sql}
     ORDER BY q.created_at DESC LIMIT 5`,
    [tenantId, ...dvQ.params, tenantId, ...dvB.params, tenantId, ...dvP.params]
  );
  const recentDispatches = await query<RowDataPacket[]>(
    `SELECT d.id, d.remarks, d.created_at, b.batch_number,
            p.name AS product_name, p.sku AS product_sku
     FROM dispatch_records d
     JOIN batches b ON d.batch_id = b.id
     JOIN products p ON b.product_id = p.id
     WHERE d.tenant_id = ?${dvD.sql} AND b.tenant_id = ?${dvB.sql} AND p.tenant_id = ?${dvP.sql}
     ORDER BY d.created_at DESC LIMIT 5`,
    [tenantId, ...dvD.params, tenantId, ...dvB.params, tenantId, ...dvP.params]
  );
  const pendingRequests = await query<RowDataPacket[]>(
    `SELECT d.id, d.status, d.created_at, b.batch_number, b.quantity, b.uom,
            p.name AS product_name, p.sku AS product_sku,
            COALESCE(du.name, 'Unknown') AS raised_by_name
     FROM dispatch_orders d
     JOIN batches b ON d.batch_id = b.id
     JOIN products p ON b.product_id = p.id
     LEFT JOIN dispatch_users du ON d.raised_by = du.id AND du.tenant_id = ?
     WHERE d.tenant_id = ?${dvD.sql} AND b.tenant_id = ?${dvB.sql} AND p.tenant_id = ?${dvP.sql}
     ORDER BY d.created_at DESC LIMIT 5`,
    [tenantId, tenantId, ...dvD.params, tenantId, ...dvB.params, tenantId, ...dvP.params]
  );
  const recentActivity = await query<RowDataPacket[]>(
    `SELECT * FROM activity_logs WHERE tenant_id = ?${dv.sql} ORDER BY created_at DESC LIMIT 8`,
    [tenantId, ...dv.params]
  );

  const s = summary[0];
  const qcTotal = Number(s.qc_total) || 0;
  const qcPassed = Number(s.qc_passed) || 0;

  res.json({
    stats: {
      totalProducts: Number(s.total_products) || 0,
      inventoryQty: Number(s.inventory_qty) || 0,
      inventoryValue: Number(s.inventory_value) || 0,
      totalBatches: Number(s.total_batches) || 0,
      pendingQc: Number(s.pending_qc) || 0,
      qcTotal,
      qcPassed,
      qcFailed: Number(s.qc_failed) || 0,
      qcPassRate: qcTotal > 0 ? Math.round((qcPassed / qcTotal) * 100) : 0,
      dispatchTotal: Number(s.dispatch_total) || 0,
      dispatchedToday: Number(s.dispatched_today) || 0,
      totalRequests: Number(s.request_total) || 0,
      pendingRequests: Number(s.request_pending) || 0,
      approvedRequests: Number(s.request_approved) || 0,
      rejectedRequests: Number(s.request_rejected) || 0,
      totalLocations: Number(s.total_locations) || 0,
      activeLocations: Number(s.active_locations) || 0,
      totalUsers: Number(s.total_users) || 0,
      activeUsers: Number(s.active_users) || 0,
    },
    recentQc,
    recentDispatches,
    pendingRequests,
    recentActivity,
  });
}
