"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.register = register;
exports.push = push;
exports.pull = pull;
exports.status = status;
exports.uploadAttachments = uploadAttachments;
const database_1 = require("../config/database");
const syncService_1 = require("../services/syncService");
function parseCursor(value) {
    if (value === undefined || value === null || value === '')
        return 0;
    if (typeof value === 'number' && Number.isFinite(value))
        return Math.max(0, value);
    const text = String(value);
    const numeric = Number(text);
    if (Number.isFinite(numeric))
        return Math.max(0, numeric);
    const parsed = new Date(text).getTime();
    return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}
function parseLimit(value, fallback = 500) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed))
        return fallback;
    return Math.min(Math.max(Math.floor(parsed), 1), 1000);
}
function lastUpdatedMs(rows, fallback) {
    let max = fallback;
    for (const row of rows) {
        const value = Number(row._updated_ms);
        if (Number.isFinite(value) && value > max)
            max = value;
    }
    return max;
}
async function rowsForPull(sql, params, limit) {
    const rows = await (0, database_1.query)(sql, [...params, limit]);
    return {
        rows,
        hasMore: rows.length >= limit,
        lastMs: lastUpdatedMs(rows, 0),
    };
}
async function register(req, res) {
    if (!req.user) {
        res.status(401).json({ error: 'Authentication required' });
        return;
    }
    const device = await (0, syncService_1.registerDevice)(req.user, req.body || {});
    res.json({ ...device, server_time: new Date().toISOString() });
}
async function push(req, res) {
    if (!req.user) {
        res.status(401).json({ error: 'Authentication required' });
        return;
    }
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
            results.push(await (0, syncService_1.applyOperation)(req.user, deviceUuid, raw));
        }
        catch (error) {
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
    await (0, syncService_1.touchDeviceSync)(deviceUuid, 'push', failed || conflicts ? `${failed} failed, ${conflicts} conflicts` : null);
    res.json({
        results,
        applied: results.filter((result) => result.status === 'APPLIED').length,
        duplicates: results.filter((result) => result.status === 'DUPLICATE').length,
        conflicts,
        failed,
        server_time: new Date().toISOString(),
    });
}
async function pull(req, res) {
    if (!req.user) {
        res.status(401).json({ error: 'Authentication required' });
        return;
    }
    const user = req.user;
    const since = parseCursor(req.query.since);
    const limit = parseLimit(req.query.limit, 500);
    // Re-read a small overlap window so timestamp precision or concurrent
    // writes cannot make a device miss a change. Clients dedupe by id.
    const querySince = Math.max(0, since - 5000);
    const deviceUuid = typeof req.query.device_uuid === 'string' ? req.query.device_uuid : null;
    const products = await rowsForPull(`SELECT p.*, UNIX_TIMESTAMP(p.updated_at) * 1000 AS _updated_ms
     FROM products p
     WHERE UNIX_TIMESTAMP(p.updated_at) * 1000 > ?
     ORDER BY p.updated_at ASC LIMIT ?`, [querySince], limit);
    const locations = await rowsForPull(`SELECT s.*, UNIX_TIMESTAMP(s.updated_at) * 1000 AS _updated_ms
     FROM shelf_locations s
     WHERE UNIX_TIMESTAMP(s.updated_at) * 1000 > ?
     ORDER BY s.updated_at ASC LIMIT ?`, [querySince], limit);
    const batches = await rowsForPull(`SELECT b.*, p.name AS product_name, p.sku AS product_sku, p.cas_number,
            p.molecular_formula, p.grade AS product_grade, p.purity AS product_purity,
            p.hazard_classification, p.storage_conditions, p.manufacturer,
            p.physical_state, p.hsn_code, p.price AS product_price,
            UNIX_TIMESTAMP(b.updated_at) * 1000 AS _updated_ms
     FROM batches b JOIN products p ON b.product_id = p.id
     WHERE UNIX_TIMESTAMP(b.updated_at) * 1000 > ?
     ORDER BY b.updated_at ASC LIMIT ?`, [querySince], limit);
    let qcRecords = {
        rows: [], hasMore: false, lastMs: 0,
    };
    if (user.role === 'QC' || user.role === 'ADMIN') {
        const mine = user.role === 'QC' ? 'AND q.tester_id = ?' : '';
        const params = user.role === 'QC' ? [querySince, user.userId] : [querySince];
        qcRecords = await rowsForPull(`SELECT q.*, b.batch_number, b.barcode_value, p.name AS product_name,
              UNIX_TIMESTAMP(q.created_at) * 1000 AS _updated_ms
       FROM qc_records q
       JOIN batches b ON q.batch_id = b.id
       JOIN products p ON b.product_id = p.id
       WHERE UNIX_TIMESTAMP(q.created_at) * 1000 > ? ${mine}
       ORDER BY q.created_at ASC LIMIT ?`, params, limit);
    }
    let dispatchOrders = {
        rows: [], hasMore: false, lastMs: 0,
    };
    if (user.role === 'DISPATCH' || user.role === 'ADMIN') {
        const mine = user.role === 'DISPATCH' ? 'AND d.raised_by = ?' : '';
        const params = user.role === 'DISPATCH' ? [querySince, user.userId] : [querySince];
        dispatchOrders = await rowsForPull(`SELECT d.*, b.batch_number, b.barcode_value, p.name AS product_name,
              p.sku AS product_sku, u.name AS raised_by_name,
              UNIX_TIMESTAMP(d.updated_at) * 1000 AS _updated_ms
       FROM dispatch_orders d
       JOIN batches b ON d.batch_id = b.id
       JOIN products p ON b.product_id = p.id
       LEFT JOIN dispatch_users u ON d.raised_by = u.id
       WHERE UNIX_TIMESTAMP(d.updated_at) * 1000 > ? ${mine}
       ORDER BY d.updated_at ASC LIMIT ?`, params, limit);
    }
    let dispatchRecords = {
        rows: [], hasMore: false, lastMs: 0,
    };
    if (user.role === 'DISPATCH' || user.role === 'ADMIN') {
        const mine = user.role === 'DISPATCH' ? 'AND dr.dispatcher_id = ?' : '';
        const params = user.role === 'DISPATCH' ? [querySince, user.userId] : [querySince];
        dispatchRecords = await rowsForPull(`SELECT dr.*, b.batch_number, b.barcode_value, p.name AS product_name,
              UNIX_TIMESTAMP(dr.created_at) * 1000 AS _updated_ms
       FROM dispatch_records dr
       JOIN batches b ON dr.batch_id = b.id
       JOIN products p ON b.product_id = p.id
       WHERE UNIX_TIMESTAMP(dr.created_at) * 1000 > ? ${mine}
       ORDER BY dr.created_at ASC LIMIT ?`, params, limit);
    }
    let workQueue = [];
    if (user.role === 'QC') {
        workQueue = await (0, database_1.query)(`SELECT b.*, p.name AS product_name, p.sku AS product_sku, p.cas_number,
              p.molecular_formula, p.grade AS product_grade, p.purity AS product_purity,
              p.hazard_classification, p.storage_conditions,
              TIMESTAMPDIFF(MINUTE, b.created_at, NOW()) AS age_minutes
       FROM batches b JOIN products p ON b.product_id = p.id
       WHERE b.status = 'CREATED'
       ORDER BY b.created_at ASC LIMIT 200`);
    }
    else if (user.role === 'DISPATCH') {
        workQueue = await (0, database_1.query)(`SELECT b.*, p.name AS product_name, p.sku AS product_sku,
              TIMESTAMPDIFF(MINUTE, b.updated_at, NOW()) AS age_minutes
       FROM batches b JOIN products p ON b.product_id = p.id
       WHERE b.status IN ('QC_PASSED', 'DISPATCH_APPROVED')
       ORDER BY b.updated_at ASC LIMIT 200`);
    }
    else if (user.role === 'PRODUCTION') {
        workQueue = await (0, database_1.query)(`SELECT b.*, p.name AS product_name, p.sku AS product_sku,
              TIMESTAMPDIFF(MINUTE, b.updated_at, NOW()) AS age_minutes
       FROM batches b JOIN products p ON b.product_id = p.id
       WHERE b.status IN ('CREATED', 'QC_FAILED', 'DISPATCH_APPROVED')
       ORDER BY b.updated_at ASC LIMIT 200`);
    }
    else {
        workQueue = await (0, database_1.query)(`SELECT b.*, p.name AS product_name, p.sku AS product_sku,
              TIMESTAMPDIFF(MINUTE, b.updated_at, NOW()) AS age_minutes
       FROM batches b JOIN products p ON b.product_id = p.id
       WHERE b.status IN ('CREATED', 'QC_PASSED', 'DISPATCH_ORDER_RAISED', 'DISPATCH_APPROVED')
       ORDER BY b.updated_at ASC LIMIT 200`);
    }
    let myOrders = [];
    if (user.role === 'DISPATCH' || user.role === 'ADMIN') {
        const mine = user.role === 'DISPATCH' ? 'AND d.raised_by = ?' : '';
        const params = user.role === 'DISPATCH' ? [user.userId] : [];
        myOrders = await (0, database_1.query)(`SELECT d.*, b.batch_number, b.barcode_value, p.name AS product_name, p.sku AS product_sku
       FROM dispatch_orders d
       JOIN batches b ON d.batch_id = b.id
       JOIN products p ON b.product_id = p.id
       WHERE d.status IN ('PENDING', 'APPROVED') ${mine}
       ORDER BY d.created_at DESC LIMIT 100`, params);
    }
    const [pendingQcCount] = await (0, database_1.query)(`SELECT COUNT(*) AS count FROM batches WHERE status = 'CREATED'`);
    const [readyCount] = await (0, database_1.query)(`SELECT COUNT(*) AS count FROM batches WHERE status = 'QC_PASSED'`);
    const [pendingOrderCount] = await (0, database_1.query)(`SELECT COUNT(*) AS count FROM dispatch_orders WHERE status = 'PENDING'`);
    const [myTestsToday] = await (0, database_1.query)(`SELECT COUNT(*) AS count FROM qc_records
     WHERE tester_id = ? AND created_at >= CURDATE()`, [user.userId]);
    const [myDispatchesToday] = await (0, database_1.query)(`SELECT COUNT(*) AS count FROM dispatch_records
     WHERE dispatcher_id = ? AND created_at >= CURDATE()`, [user.userId]);
    const pages = [products, locations, batches, qcRecords, dispatchOrders, dispatchRecords];
    const hasMore = pages.some((page) => page.hasMore);
    const maxLast = Math.max(since, products.lastMs, locations.lastMs, batches.lastMs, qcRecords.lastMs, dispatchOrders.lastMs, dispatchRecords.lastMs);
    const limitedLast = pages
        .filter((page) => page.hasMore && page.lastMs > 0)
        .map((page) => page.lastMs);
    const cursor = hasMore && limitedLast.length > 0
        ? Math.max(since, Math.min(...limitedLast) - 1)
        : maxLast;
    await (0, syncService_1.touchDeviceSync)(deviceUuid, 'pull', null);
    res.json({
        server_time: new Date().toISOString(),
        cursor,
        since,
        has_more: hasMore,
        role: user.role,
        products: products.rows,
        shelf_locations: locations.rows,
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
async function status(req, res) {
    if (!req.user) {
        res.status(401).json({ error: 'Authentication required' });
        return;
    }
    const deviceUuid = typeof req.query.device_uuid === 'string' ? req.query.device_uuid : null;
    const deviceRows = deviceUuid
        ? await (0, database_1.query)('SELECT * FROM devices WHERE device_uuid = ? LIMIT 1', [deviceUuid])
        : [];
    const stateRows = deviceUuid
        ? await (0, database_1.query)('SELECT * FROM device_sync_state WHERE device_uuid = ? LIMIT 1', [deviceUuid])
        : [];
    const operationCounts = await (0, database_1.query)(`SELECT status, COUNT(*) AS count FROM sync_operations
     WHERE user_role = ? AND user_id = ? AND server_timestamp > DATE_SUB(NOW(3), INTERVAL 7 DAY)
     GROUP BY status`, [req.user.role, req.user.userId]);
    res.json({
        server_time: new Date().toISOString(),
        device: deviceRows[0] || null,
        sync_state: stateRows[0] || null,
        operation_counts: operationCounts,
    });
}
async function uploadAttachments(req, res) {
    const files = req.files || [];
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
//# sourceMappingURL=syncController.js.map