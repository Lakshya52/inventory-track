"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.raise = raise;
exports.listPending = listPending;
exports.listAll = listAll;
exports.listMine = listMine;
exports.approve = approve;
exports.reject = reject;
exports.getPackingList = getPackingList;
const crypto_1 = require("crypto");
const database_1 = require("../config/database");
const syncService_1 = require("../services/syncService");
function errorResponse(res, error, fallback) {
    if (error instanceof syncService_1.SyncError) {
        res.status(error.httpStatus).json({ error: error.message, code: error.code, ...(error.details || {}) });
        return;
    }
    console.error(fallback, error);
    res.status(500).json({ error: fallback });
}
async function raise(req, res) {
    const batchId = req.body.batch_id;
    const barcodeValue = req.body.barcode_value;
    if (!batchId && !barcodeValue) {
        res.status(400).json({ error: 'Batch ID or barcode value is required' });
        return;
    }
    const operation = {
        operation_id: req.body.client_operation_id || (0, crypto_1.randomUUID)(),
        type: 'DISPATCH_ORDER_RAISE',
        client_timestamp: req.body.client_timestamp || new Date().toISOString(),
        payload: {
            batch_id: batchId ? Number(batchId) : undefined,
            barcode_value: barcodeValue ? String(barcodeValue) : undefined,
            expected_status: req.body.expected_status || undefined,
            client_id: Number(req.body.client_id),
            driver_name: String(req.body.driver_name || ''),
            vehicle_number: String(req.body.vehicle_number || ''),
        },
    };
    try {
        const applied = await (0, syncService_1.applyOperation)(req.user, null, operation);
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
    }
    catch (error) {
        errorResponse(res, error, 'Could not raise dispatch order');
    }
}
function searchClause(q) {
    if (!q)
        return { sql: '', params: [] };
    return {
        sql: 'AND (b.batch_number LIKE ? OR p.name LIKE ? OR p.sku LIKE ?)',
        params: [`%${q}%`, `%${q}%`, `%${q}%`],
    };
}
async function listPending(req, res) {
    const q = String(req.query.q || '').trim();
    const search = searchClause(q);
    const orders = await (0, database_1.query)(`SELECT d.*, b.batch_number, b.barcode_value, b.quantity, b.uom, p.name AS product_name,
            p.sku AS product_sku, u.name AS raised_by_name, c.name AS client_name
     FROM dispatch_orders d
     JOIN batches b ON d.batch_id = b.id
     JOIN products p ON b.product_id = p.id
     LEFT JOIN dispatch_users u ON d.raised_by = u.id
     LEFT JOIN clients c ON c.id = d.client_id
     WHERE d.status = 'PENDING' ${search.sql}
     ORDER BY d.created_at ASC LIMIT 100`, search.params);
    res.json(orders);
}
async function listAll(req, res) {
    const q = String(req.query.q || '').trim();
    const status = String(req.query.status || '').toUpperCase();
    const search = searchClause(q);
    const where = ['1=1'];
    const params = [];
    if (['PENDING', 'APPROVED', 'REJECTED'].includes(status)) {
        where.push('d.status = ?');
        params.push(status);
    }
    params.push(...search.params);
    const orders = await (0, database_1.query)(`SELECT d.*, b.batch_number, b.barcode_value, b.quantity, b.uom, b.status AS batch_status,
            p.name AS product_name,
            p.sku AS product_sku, u.name AS raised_by_name, a.name AS admin_name,
            c.name AS client_name
     FROM dispatch_orders d
     JOIN batches b ON d.batch_id = b.id
     JOIN products p ON b.product_id = p.id
     LEFT JOIN dispatch_users u ON d.raised_by = u.id
     LEFT JOIN clients c ON c.id = d.client_id
     LEFT JOIN admins a ON d.admin_id = a.id
     WHERE ${where.join(' AND ')} ${search.sql}
     ORDER BY d.created_at DESC LIMIT 100`, params);
    res.json(orders);
}
async function listMine(req, res) {
    const q = String(req.query.q || '').trim();
    const status = String(req.query.status || '').toUpperCase();
    const search = searchClause(q);
    const where = ['d.raised_by = ?'];
    const params = [req.user.userId];
    if (['PENDING', 'APPROVED', 'REJECTED'].includes(status)) {
        where.push('d.status = ?');
        params.push(status);
    }
    params.push(...search.params);
    const orders = await (0, database_1.query)(`SELECT d.*, b.batch_number, b.barcode_value, b.quantity, b.uom, b.status AS batch_status,
            p.name AS product_name,
            p.sku AS product_sku, a.name AS admin_name, c.name AS client_name
     FROM dispatch_orders d
     JOIN batches b ON d.batch_id = b.id
     JOIN products p ON b.product_id = p.id
     LEFT JOIN admins a ON d.admin_id = a.id
     LEFT JOIN clients c ON c.id = d.client_id
     WHERE ${where.join(' AND ')} ${search.sql}
     ORDER BY d.created_at DESC LIMIT 100`, params);
    res.json(orders);
}
async function approve(req, res) {
    const { id } = req.params;
    const { admin_remarks } = req.body;
    try {
        const result = await (0, database_1.withTransaction)(async (conn) => {
            const [orders] = await conn.execute('SELECT * FROM dispatch_orders WHERE id = ? FOR UPDATE', [id]);
            if (orders.length === 0)
                throw new syncService_1.SyncError('Dispatch order not found', 'ORDER_NOT_FOUND', 404);
            const order = orders[0];
            if (order.status !== 'PENDING') {
                throw new syncService_1.SyncConflictError(`Order is already ${order.status}`, { order_id: order.id, status: order.status });
            }
            const [batches] = await conn.execute('SELECT * FROM batches WHERE id = ? FOR UPDATE', [order.batch_id]);
            if (batches.length === 0)
                throw new syncService_1.SyncError('Batch not found', 'BATCH_NOT_FOUND', 404);
            if (batches[0].status !== 'DISPATCH_ORDER_RAISED') {
                throw new syncService_1.SyncConflictError(`Batch is not awaiting approval. Current status: ${batches[0].status}`, {
                    batch_id: order.batch_id,
                    current_status: batches[0].status,
                });
            }
            await conn.execute(`UPDATE dispatch_orders SET status = 'APPROVED', admin_id = ?, admin_remarks = ?, updated_at = CURRENT_TIMESTAMP(3)
         WHERE id = ? AND status = 'PENDING'`, [req.user.userId, admin_remarks || null, id]);
            const [batchUpdate] = await conn.execute(`UPDATE batches SET status = 'DISPATCH_APPROVED', updated_at = CURRENT_TIMESTAMP(3)
         WHERE id = ? AND status = 'DISPATCH_ORDER_RAISED'`, [order.batch_id]);
            if (batchUpdate.affectedRows !== 1) {
                throw new syncService_1.SyncConflictError('Batch was changed by another user', { batch_id: order.batch_id });
            }
            await conn.execute(`INSERT INTO activity_logs (user_id, user_name, user_role, action, description)
         VALUES (?, ?, ?, 'DISPATCH_APPROVED', ?)`, [req.user.userId, req.user.name, req.user.role, `Dispatch order #${id} approved for batch #${order.batch_id}`]);
            return { message: 'Dispatch order approved', status: 'APPROVED' };
        });
        res.json(result);
    }
    catch (error) {
        errorResponse(res, error, 'Could not approve dispatch order');
    }
}
async function reject(req, res) {
    const { id } = req.params;
    const { admin_remarks } = req.body;
    try {
        const result = await (0, database_1.withTransaction)(async (conn) => {
            const [orders] = await conn.execute('SELECT * FROM dispatch_orders WHERE id = ? FOR UPDATE', [id]);
            if (orders.length === 0)
                throw new syncService_1.SyncError('Dispatch order not found', 'ORDER_NOT_FOUND', 404);
            const order = orders[0];
            if (order.status !== 'PENDING') {
                throw new syncService_1.SyncConflictError(`Order is already ${order.status}`, { order_id: order.id, status: order.status });
            }
            const [batches] = await conn.execute('SELECT * FROM batches WHERE id = ? FOR UPDATE', [order.batch_id]);
            if (batches.length === 0)
                throw new syncService_1.SyncError('Batch not found', 'BATCH_NOT_FOUND', 404);
            await conn.execute(`UPDATE dispatch_orders SET status = 'REJECTED', admin_id = ?, admin_remarks = ?, updated_at = CURRENT_TIMESTAMP(3)
         WHERE id = ? AND status = 'PENDING'`, [req.user.userId, admin_remarks || null, id]);
            await conn.execute(`UPDATE batches SET status = 'DISPATCH_REJECTED', updated_at = CURRENT_TIMESTAMP(3)
         WHERE id = ? AND status = 'DISPATCH_ORDER_RAISED'`, [order.batch_id]);
            await conn.execute(`INSERT INTO activity_logs (user_id, user_name, user_role, action, description)
         VALUES (?, ?, ?, 'DISPATCH_REJECTED', ?)`, [req.user.userId, req.user.name, req.user.role, `Dispatch order #${id} rejected for batch #${order.batch_id}`]);
            return { message: 'Dispatch order rejected', status: 'REJECTED' };
        });
        res.json(result);
    }
    catch (error) {
        errorResponse(res, error, 'Could not reject dispatch order');
    }
}
async function getPackingList(req, res) {
    const { id } = req.params;
    const orders = await (0, database_1.query)(`SELECT d.*, b.batch_number, b.barcode_value, b.quantity, b.uom,
            COALESCE(s.location_code, b.storage_location) AS storage_location,
            p.name AS product_name, p.sku, u.name AS raised_by_name, a.name AS admin_name,
            c.name AS client_name,
            (SELECT du.name FROM dispatch_records dr
             LEFT JOIN dispatch_users du ON du.id = dr.dispatcher_id
             WHERE dr.dispatch_order_id = d.id ORDER BY dr.created_at DESC LIMIT 1) AS dispatched_by
     FROM dispatch_orders d
     JOIN batches b ON d.batch_id = b.id
     JOIN products p ON b.product_id = p.id
     LEFT JOIN shelf_locations s ON s.id = b.shelf_location_id
     LEFT JOIN dispatch_users u ON d.raised_by = u.id
     LEFT JOIN admins a ON d.admin_id = a.id
     LEFT JOIN clients c ON c.id = d.client_id
     WHERE d.id = ? AND d.raised_by = ? AND d.status = 'APPROVED'`, [id, req.user.userId]);
    if (orders.length === 0) {
        res.status(404).json({ error: 'Dispatch order not found' });
        return;
    }
    const order = orders[0];
    const storedItems = await (0, database_1.query)('SELECT * FROM packing_list_items WHERE dispatch_order_id = ? ORDER BY id ASC', [id]);
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
        client: order.client_id ? await getClient(order.client_id) : null,
        client_name: order.client_name || null,
        driver_name: order.driver_name,
        vehicle_number: order.vehicle_number,
        dispatched_by: order.dispatched_by || null,
        location: order.storage_location || null,
        dispatched_at: order.dispatched_at || null,
        items,
        generated_at: new Date().toISOString(),
    });
}
async function getClient(id) {
    const clients = await (0, database_1.query)('SELECT id, name, contact_person, email, phone, address, gst_number FROM clients WHERE id = ?', [id]);
    return clients[0] || null;
}
//# sourceMappingURL=dispatchOrderController.js.map