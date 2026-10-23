"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.summary = summary;
exports.qcReport = qcReport;
exports.dispatchReport = dispatchReport;
exports.dispatchRequests = dispatchRequests;
exports.inventory = inventory;
exports.batchesReport = batchesReport;
const database_1 = require("../config/database");
function dateFilter(req, column, filter) {
    const from = req.query.from;
    const to = req.query.to;
    if (from) {
        filter.where.push(`DATE(${column}) >= ?`);
        filter.params.push(from);
    }
    if (to) {
        filter.where.push(`DATE(${column}) <= ?`);
        filter.params.push(to);
    }
}
function whereSql(filter) {
    return filter.where.length > 0 ? `WHERE ${filter.where.join(' AND ')}` : '';
}
async function summary(_req, res) {
    const [products] = await (0, database_1.query)(`SELECT COUNT(*) AS count, COALESCE(SUM(quantity), 0) AS qty,
            COALESCE(SUM(quantity * price), 0) AS value
     FROM products`);
    const [batches] = await (0, database_1.query)('SELECT COUNT(*) AS count FROM batches');
    const [qc] = await (0, database_1.query)(`SELECT
       COUNT(*) AS total,
       SUM(CASE WHEN result = 'PASS' THEN 1 ELSE 0 END) AS passed,
       SUM(CASE WHEN result = 'FAIL' THEN 1 ELSE 0 END) AS failed
     FROM qc_records`);
    const [pendingQc] = await (0, database_1.query)("SELECT COUNT(*) AS count FROM batches WHERE status = 'CREATED'");
    const [dispatches] = await (0, database_1.query)(`SELECT COUNT(*) AS total,
            SUM(CASE WHEN DATE(created_at) = CURDATE() THEN 1 ELSE 0 END) AS today
     FROM dispatch_records`);
    const [requests] = await (0, database_1.query)(`SELECT
       COUNT(*) AS total,
       SUM(CASE WHEN status = 'PENDING' THEN 1 ELSE 0 END) AS pending,
       SUM(CASE WHEN status = 'APPROVED' THEN 1 ELSE 0 END) AS approved,
       SUM(CASE WHEN status = 'REJECTED' THEN 1 ELSE 0 END) AS rejected
     FROM dispatch_orders`);
    const [vendors] = await (0, database_1.query)(`SELECT COUNT(*) AS total, SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) AS active FROM vendors`);
    const [locations] = await (0, database_1.query)(`SELECT COUNT(*) AS total, SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) AS active FROM shelf_locations`);
    const [users] = await (0, database_1.query)(`SELECT
       (SELECT COUNT(*) FROM admins) + (SELECT COUNT(*) FROM qc_users) +
       (SELECT COUNT(*) FROM dispatch_users) + (SELECT COUNT(*) FROM production_users) AS total,
       (SELECT COUNT(*) FROM admins WHERE is_active = 1) +
       (SELECT COUNT(*) FROM qc_users WHERE is_active = 1) +
       (SELECT COUNT(*) FROM dispatch_users WHERE is_active = 1) +
       (SELECT COUNT(*) FROM production_users WHERE is_active = 1) AS active`);
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
        totalVendors: Number(vendors.total) || 0,
        activeVendors: Number(vendors.active) || 0,
        totalLocations: Number(locations.total) || 0,
        activeLocations: Number(locations.active) || 0,
        totalUsers: Number(users.total) || 0,
        activeUsers: Number(users.active) || 0,
    });
}
async function qcReport(req, res) {
    const filter = { where: [], params: [] };
    dateFilter(req, 'q.created_at', filter);
    if (req.query.result === 'PASS' || req.query.result === 'FAIL') {
        filter.where.push('q.result = ?');
        filter.params.push(req.query.result);
    }
    const records = await (0, database_1.query)(`SELECT q.id, q.batch_id, q.result, q.remarks, q.images, q.created_at,
            b.batch_number, b.barcode_value, b.quantity, b.uom,
            p.name AS product_name, p.sku AS product_sku, p.grade,
            COALESCE(u.name, 'Unknown') AS tester_name
     FROM qc_records q
     JOIN batches b ON q.batch_id = b.id
     JOIN products p ON b.product_id = p.id
     LEFT JOIN qc_users u ON q.tester_id = u.id
     ${whereSql(filter)}
     ORDER BY q.created_at DESC
     LIMIT 1000`, filter.params);
    res.json(records);
}
async function dispatchReport(req, res) {
    const filter = { where: [], params: [] };
    dateFilter(req, 'd.created_at', filter);
    const records = await (0, database_1.query)(`SELECT d.id, d.batch_id, d.remarks, d.images, d.created_at,
            b.batch_number, b.barcode_value, b.quantity, b.uom, b.storage_location,
            p.name AS product_name, p.sku AS product_sku,
            COALESCE(u.name, 'Unknown') AS dispatcher_name
     FROM dispatch_records d
     JOIN batches b ON d.batch_id = b.id
     JOIN products p ON b.product_id = p.id
     LEFT JOIN dispatch_users u ON d.dispatcher_id = u.id
     ${whereSql(filter)}
     ORDER BY d.created_at DESC
     LIMIT 1000`, filter.params);
    res.json(records);
}
async function dispatchRequests(req, res) {
    const filter = { where: [], params: [] };
    dateFilter(req, 'd.created_at', filter);
    if (['PENDING', 'APPROVED', 'REJECTED'].includes(String(req.query.status))) {
        filter.where.push('d.status = ?');
        filter.params.push(req.query.status);
    }
    const orders = await (0, database_1.query)(`SELECT d.id, d.batch_id, d.status, d.admin_remarks, d.created_at, d.updated_at,
            b.batch_number, b.status AS batch_status, b.quantity, b.uom, b.barcode_value,
            p.name AS product_name, p.sku AS product_sku,
            COALESCE(du.name, 'Unknown') AS raised_by_name,
            da.name AS admin_name
     FROM dispatch_orders d
     JOIN batches b ON d.batch_id = b.id
     JOIN products p ON b.product_id = p.id
     LEFT JOIN dispatch_users du ON d.raised_by = du.id
     LEFT JOIN admins da ON d.admin_id = da.id
     ${whereSql(filter)}
     ORDER BY d.created_at DESC
     LIMIT 1000`, filter.params);
    res.json(orders);
}
async function inventory(_req, res) {
    const rows = await (0, database_1.query)(`SELECT p.id, p.name, p.sku, p.description, p.grade, p.purity, p.cas_number,
            p.physical_state, p.hsn_code, p.manufacturer, p.storage_conditions,
            p.price, p.quantity,
            COALESCE(SUM(b.quantity), 0) AS batch_quantity,
            COUNT(b.id) AS batch_count,
            COALESCE(SUM(CASE WHEN b.status = 'QC_PASSED' THEN b.quantity ELSE 0 END), 0) AS qc_passed_quantity,
            COALESCE(SUM(CASE WHEN b.status = 'DISPATCHED' THEN b.quantity ELSE 0 END), 0) AS dispatched_quantity
     FROM products p
     LEFT JOIN batches b ON b.product_id = p.id
     GROUP BY p.id
     ORDER BY p.name ASC`);
    res.json(rows.map(row => ({
        ...row,
        stock_value: Number(row.quantity) * Number(row.price),
    })));
}
async function batchesReport(req, res) {
    const filter = { where: [], params: [] };
    dateFilter(req, 'b.created_at', filter);
    if (req.query.status) {
        filter.where.push('b.status = ?');
        filter.params.push(req.query.status);
    }
    const rows = await (0, database_1.query)(`SELECT b.*, p.name AS product_name, p.sku AS product_sku, p.grade, p.purity
     FROM batches b
     JOIN products p ON b.product_id = p.id
     ${whereSql(filter)}
     ORDER BY b.created_at DESC
     LIMIT 1000`, filter.params);
    res.json(rows);
}
//# sourceMappingURL=reportController.js.map