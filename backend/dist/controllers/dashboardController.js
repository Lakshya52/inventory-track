"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.stats = stats;
exports.adminStats = adminStats;
const database_1 = require("../config/database");
async function stats(_req, res) {
    const totalProducts = await (0, database_1.query)('SELECT COUNT(*) as count FROM products');
    const totalBatches = await (0, database_1.query)('SELECT COUNT(*) as count FROM batches');
    const pendingQc = await (0, database_1.query)("SELECT COUNT(*) as count FROM batches WHERE status IN ('CREATED', 'QC_PASSED')");
    const qcPassed = await (0, database_1.query)("SELECT COUNT(*) as count FROM batches WHERE status = 'QC_PASSED'");
    const qcFailed = await (0, database_1.query)("SELECT COUNT(*) as count FROM batches WHERE status = 'QC_FAILED'");
    const dispatchedToday = await (0, database_1.query)("SELECT COUNT(*) as count FROM dispatch_records WHERE DATE(created_at) = CURDATE()");
    const inventory = await (0, database_1.query)("SELECT COALESCE(SUM(quantity), 0) as qty, COALESCE(SUM(quantity * price), 0) as value FROM products");
    const pendingOrders = await (0, database_1.query)("SELECT COUNT(*) as count FROM dispatch_orders WHERE status = 'PENDING'");
    const activeClients = await (0, database_1.query)("SELECT COUNT(*) as count FROM clients WHERE is_active = 1");
    const totalLocations = await (0, database_1.query)("SELECT COUNT(*) as count FROM shelf_locations WHERE is_active = 1");
    const recentActivity = await (0, database_1.query)(`SELECT * FROM activity_logs ORDER BY created_at DESC LIMIT 10`);
    const recentBatches = await (0, database_1.query)(`SELECT b.id, b.batch_number, b.quantity, b.barcode_value, b.status, b.created_at,
            p.name as product_name, p.sku as product_sku
     FROM batches b JOIN products p ON b.product_id = p.id
     ORDER BY b.created_at DESC LIMIT 10`);
    const productionStats = await (0, database_1.query)(`SELECT
       SUM(CASE WHEN status = 'CREATED' THEN 1 ELSE 0 END) as in_production,
       SUM(CASE WHEN status = 'QC_FAILED' THEN 1 ELSE 0 END) as needs_fix
     FROM batches WHERE status IN ('CREATED','QC_FAILED')`);
    const dispatchQueueStats = await (0, database_1.query)(`SELECT
       SUM(CASE WHEN status = 'DISPATCH_ORDER_RAISED' THEN 1 ELSE 0 END) as awaiting_approval,
       SUM(CASE WHEN status = 'DISPATCH_APPROVED' THEN 1 ELSE 0 END) as approved_ready
     FROM batches WHERE status IN ('DISPATCH_ORDER_RAISED','DISPATCH_APPROVED','DISPATCH_REJECTED')`);
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
async function adminStats(_req, res) {
    const summary = await (0, database_1.query)(`SELECT
       (SELECT COUNT(*) FROM products) AS total_products,
       (SELECT COALESCE(SUM(quantity), 0) FROM products) AS inventory_qty,
       (SELECT COALESCE(SUM(quantity * price), 0) FROM products) AS inventory_value,
       (SELECT COUNT(*) FROM batches) AS total_batches,
       (SELECT COUNT(*) FROM batches WHERE status = 'CREATED') AS pending_qc,
       (SELECT COUNT(*) FROM qc_records) AS qc_total,
       (SELECT COUNT(*) FROM qc_records WHERE result = 'PASS') AS qc_passed,
       (SELECT COUNT(*) FROM qc_records WHERE result = 'FAIL') AS qc_failed,
       (SELECT COUNT(*) FROM dispatch_records) AS dispatch_total,
       (SELECT COUNT(*) FROM dispatch_records WHERE DATE(created_at) = CURDATE()) AS dispatched_today,
       (SELECT COUNT(*) FROM dispatch_orders) AS request_total,
       (SELECT COUNT(*) FROM dispatch_orders WHERE status = 'PENDING') AS request_pending,
       (SELECT COUNT(*) FROM dispatch_orders WHERE status = 'APPROVED') AS request_approved,
       (SELECT COUNT(*) FROM dispatch_orders WHERE status = 'REJECTED') AS request_rejected,
       (SELECT COUNT(*) FROM vendors) AS total_vendors,
       (SELECT COUNT(*) FROM vendors WHERE is_active = 1) AS active_vendors,
       (SELECT COUNT(*) FROM shelf_locations) AS total_locations,
       (SELECT COUNT(*) FROM shelf_locations WHERE is_active = 1) AS active_locations,
       (SELECT COUNT(*) FROM admins) + (SELECT COUNT(*) FROM qc_users) +
         (SELECT COUNT(*) FROM dispatch_users) + (SELECT COUNT(*) FROM production_users) AS total_users,
       (SELECT COUNT(*) FROM admins WHERE is_active = 1) +
         (SELECT COUNT(*) FROM qc_users WHERE is_active = 1) +
         (SELECT COUNT(*) FROM dispatch_users WHERE is_active = 1) +
         (SELECT COUNT(*) FROM production_users WHERE is_active = 1) AS active_users`);
    const recentQc = await (0, database_1.query)(`SELECT q.id, q.result, q.remarks, q.created_at, b.batch_number,
            p.name AS product_name, p.sku AS product_sku
     FROM qc_records q
     JOIN batches b ON q.batch_id = b.id
     JOIN products p ON b.product_id = p.id
     ORDER BY q.created_at DESC LIMIT 5`);
    const recentDispatches = await (0, database_1.query)(`SELECT d.id, d.remarks, d.created_at, b.batch_number,
            p.name AS product_name, p.sku AS product_sku
     FROM dispatch_records d
     JOIN batches b ON d.batch_id = b.id
     JOIN products p ON b.product_id = p.id
     ORDER BY d.created_at DESC LIMIT 5`);
    const pendingRequests = await (0, database_1.query)(`SELECT d.id, d.status, d.created_at, b.batch_number, b.quantity, b.uom,
            p.name AS product_name, p.sku AS product_sku,
            COALESCE(du.name, 'Unknown') AS raised_by_name
     FROM dispatch_orders d
     JOIN batches b ON d.batch_id = b.id
     JOIN products p ON b.product_id = p.id
     LEFT JOIN dispatch_users du ON d.raised_by = du.id
     WHERE d.status = 'PENDING'
     ORDER BY d.created_at DESC LIMIT 5`);
    const recentActivity = await (0, database_1.query)('SELECT * FROM activity_logs ORDER BY created_at DESC LIMIT 8');
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
            totalVendors: Number(s.total_vendors) || 0,
            activeVendors: Number(s.active_vendors) || 0,
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
//# sourceMappingURL=dashboardController.js.map