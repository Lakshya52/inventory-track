"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.submit = submit;
exports.submitBulk = submitBulk;
exports.reopenFailedBatch = reopenFailedBatch;
exports.stats = stats;
exports.pending = pending;
exports.records = records;
const crypto_1 = require("crypto");
const database_1 = require("../config/database");
const syncService_1 = require("../services/syncService");
function pageParams(req, defaultLimit = 20) {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || defaultLimit));
    return { page, limit, offset: (page - 1) * limit };
}
async function submit(req, res) {
    const barcode_value = String(req.body.barcode_value || '').trim();
    const result = String(req.body.result || '').toUpperCase();
    const remarks = req.body.remarks;
    const files = req.files || [];
    const bodyImages = Array.isArray(req.body.images) ? req.body.images : [];
    const images = files.length > 0 ? files.map((file) => file.filename) : bodyImages;
    if (!barcode_value || !result) {
        res.status(400).json({ error: 'Barcode value and result are required' });
        return;
    }
    if (!['PASS', 'FAIL'].includes(result)) {
        res.status(400).json({ error: 'Result must be PASS or FAIL' });
        return;
    }
    const operation = {
        operation_id: req.body.client_operation_id || (0, crypto_1.randomUUID)(),
        type: 'QC_SUBMIT',
        client_timestamp: req.body.client_timestamp || new Date().toISOString(),
        payload: {
            barcode_value,
            result,
            remarks: remarks || null,
            images,
            expected_status: req.body.expected_status || undefined,
        },
    };
    const applied = await (0, syncService_1.applyOperation)(req.user, null, operation);
    if (applied.status === 'APPLIED' || applied.status === 'DUPLICATE') {
        res.json({ ...(applied.data || {}), duplicate: applied.status === 'DUPLICATE' });
        return;
    }
    res.status(applied.status === 'CONFLICT' ? 409 : 400).json({
        error: applied.error || 'QC submission failed',
        code: applied.error_code,
        ...(applied.data || {}),
    });
}
async function submitBulk(req, res) {
    let barcodes = [];
    if (Array.isArray(req.body.barcodes)) {
        barcodes = req.body.barcodes.map((value) => String(value || '').trim()).filter(Boolean);
    }
    else if (typeof req.body.barcodes === 'string') {
        try {
            const parsed = JSON.parse(req.body.barcodes);
            if (Array.isArray(parsed)) {
                barcodes = parsed.map((value) => String(value || '').trim()).filter(Boolean);
            }
        }
        catch {
            barcodes = [];
        }
    }
    else if (typeof req.body.barcode_value === 'string') {
        barcodes = [req.body.barcode_value.trim()];
    }
    barcodes = [...new Set(barcodes)];
    const result = String(req.body.result || '').toUpperCase();
    const remarks = req.body.remarks;
    const files = req.files || [];
    const bodyImages = Array.isArray(req.body.images) ? req.body.images : [];
    const images = files.length > 0 ? files.map((file) => file.filename) : bodyImages;
    if (barcodes.length === 0 || !result) {
        res.status(400).json({ error: 'At least one QR code and a result are required' });
        return;
    }
    if (!['PASS', 'FAIL'].includes(result)) {
        res.status(400).json({ error: 'Result must be PASS or FAIL' });
        return;
    }
    const operation = {
        operation_id: req.body.client_operation_id || (0, crypto_1.randomUUID)(),
        type: 'QC_SUBMIT_BULK',
        client_timestamp: req.body.client_timestamp || new Date().toISOString(),
        payload: {
            barcodes,
            result,
            remarks: remarks || null,
            images,
        },
    };
    const applied = await (0, syncService_1.applyOperation)(req.user, null, operation);
    if (applied.status === 'APPLIED' || applied.status === 'DUPLICATE') {
        res.json({ ...(applied.data || {}), duplicate: applied.status === 'DUPLICATE' });
        return;
    }
    res.status(applied.status === 'CONFLICT' ? 409 : 400).json({
        error: applied.error || 'Group QC submission failed',
        code: applied.error_code,
        ...(applied.data || {}),
    });
}
async function reopenFailedBatch(req, res) {
    const reason = String(req.body.reason || '').trim();
    if (!reason) {
        res.status(400).json({ error: 'A reason is required to send a failed batch back for QC' });
        return;
    }
    const result = await (0, database_1.withTransaction)(async (conn) => {
        const [rows] = await conn.execute('SELECT id, batch_number, status FROM batches WHERE id = ? FOR UPDATE', [req.params.id]);
        if (rows.length === 0)
            return { error: 'Batch not found', statusCode: 404 };
        if (rows[0].status !== 'QC_FAILED') {
            return { error: 'Only QC-failed batches can be sent back for re-QC', statusCode: 409 };
        }
        await conn.execute(`UPDATE batches SET status = 'CREATED', updated_at = CURRENT_TIMESTAMP(3)
       WHERE id = ? AND status = 'QC_FAILED'`, [req.params.id]);
        await conn.execute(`INSERT INTO activity_logs (user_id, user_name, user_role, action, description)
       VALUES (?, ?, ?, 'BATCH_SENT_FOR_REQC', ?)`, [req.user.userId, req.user.name, req.user.role, `Batch ${rows[0].batch_number} sent back for QC: ${reason.slice(0, 1000)}`]);
        return { batch_id: Number(rows[0].id), status: 'CREATED' };
    });
    if ('error' in result) {
        res.status(result.statusCode ?? 500).json({ error: result.error });
        return;
    }
    res.json(result);
}
async function stats(req, res) {
    const user = req.user;
    const personal = user.role === 'QC';
    const scope = personal ? 'AND tester_id = ?' : '';
    const params = personal ? [user.userId] : [];
    const count = async (sql, extraParams = []) => {
        const rows = await (0, database_1.query)(sql, [...params, ...extraParams]);
        return Number(rows[0]?.count || 0);
    };
    const totalTests = await count(`SELECT COUNT(*) AS count FROM qc_records WHERE 1=1 ${scope}`);
    const testsToday = await count(`SELECT COUNT(*) AS count FROM qc_records WHERE created_at >= CURDATE() ${scope}`);
    const testsThisWeek = await count(`SELECT COUNT(*) AS count FROM qc_records
     WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL WEEKDAY(CURDATE()) DAY) ${scope}`);
    const passed = await count(`SELECT COUNT(*) AS count FROM qc_records WHERE result = 'PASS' ${scope}`);
    const failed = await count(`SELECT COUNT(*) AS count FROM qc_records WHERE result = 'FAIL' ${scope}`);
    const pendingRows = await (0, database_1.query)(`SELECT b.id, b.batch_number, b.barcode_value, b.quantity, b.uom, b.storage_location,
            (SELECT COUNT(*) FROM qr_labels l WHERE l.batch_id = b.id) AS qr_count,
            b.created_at, p.name AS product_name, p.sku AS product_sku, p.cas_number,
            p.grade AS product_grade, p.purity AS product_purity,
            TIMESTAMPDIFF(MINUTE, b.created_at, NOW()) AS age_minutes
     FROM batches b JOIN products p ON b.product_id = p.id
     WHERE b.status = 'CREATED'
     ORDER BY b.created_at ASC LIMIT 50`);
    const pendingQcRows = await (0, database_1.query)(`SELECT COUNT(*) AS count FROM batches WHERE status = 'CREATED'`);
    const recordWhere = personal ? 'WHERE q.tester_id = ?' : '';
    const recordParams = personal ? [user.userId] : [];
    const recentRecords = await (0, database_1.query)(`SELECT q.*, b.batch_number, b.barcode_value, p.name AS product_name, p.sku AS product_sku,
            u.name AS tester_name
     FROM qc_records q
     JOIN batches b ON q.batch_id = b.id
     JOIN products p ON b.product_id = p.id
     LEFT JOIN qc_users u ON q.tester_id = u.id
     ${recordWhere}
     ORDER BY q.created_at DESC LIMIT 20`, recordParams);
    const todayRecords = await (0, database_1.query)(`SELECT q.*, b.batch_number, b.barcode_value, p.name AS product_name,
            u.name AS tester_name
     FROM qc_records q
     JOIN batches b ON q.batch_id = b.id
     JOIN products p ON b.product_id = p.id
     LEFT JOIN qc_users u ON q.tester_id = u.id
     WHERE q.created_at >= CURDATE() ${personal ? 'AND q.tester_id = ?' : ''}
     ORDER BY q.created_at DESC`, recordParams);
    const trend = await (0, database_1.query)(`SELECT DATE(created_at) AS day,
            SUM(result = 'PASS') AS passed,
            SUM(result = 'FAIL') AS failed,
            COUNT(*) AS total
     FROM qc_records
     WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL 6 DAY) ${scope}
     GROUP BY DATE(created_at)
     ORDER BY day ASC`, params);
    res.json({
        scope: personal ? 'mine' : 'all',
        totalTests,
        testsToday,
        testsThisWeek,
        passed,
        failed,
        pendingQc: Number(pendingQcRows[0]?.count || 0),
        passRate: totalTests > 0 ? Math.round((passed / totalTests) * 100) : 0,
        myTestsToday: testsToday,
        myTestsThisWeek: testsThisWeek,
        myTotalTests: totalTests,
        myPassed: passed,
        myFailed: failed,
        myPassRate: totalTests > 0 ? Math.round((passed / totalTests) * 100) : 0,
        pendingBatches: pendingRows,
        recentRecords,
        todayRecords,
        trend,
    });
}
async function pending(req, res) {
    const { page, limit, offset } = pageParams(req, 20);
    const q = String(req.query.q || '').trim();
    const where = ["b.status = 'CREATED'"];
    const params = [];
    if (q) {
        where.push('(b.batch_number LIKE ? OR b.barcode_value LIKE ? OR p.name LIKE ? OR p.sku LIKE ?)');
        const like = `%${q}%`;
        params.push(like, like, like, like);
    }
    const whereSql = `WHERE ${where.join(' AND ')}`;
    const totalRows = await (0, database_1.query)(`SELECT COUNT(*) AS count FROM batches b JOIN products p ON b.product_id = p.id ${whereSql}`, params);
    const items = await (0, database_1.query)(`SELECT b.id, b.batch_number, b.barcode_value, b.quantity, b.uom, b.storage_location,
            (SELECT COUNT(*) FROM qr_labels l WHERE l.batch_id = b.id) AS qr_count,
            b.created_at, p.name AS product_name, p.sku AS product_sku, p.cas_number,
            p.grade AS product_grade, p.purity AS product_purity,
            TIMESTAMPDIFF(MINUTE, b.created_at, NOW()) AS age_minutes
     FROM batches b JOIN products p ON b.product_id = p.id
     ${whereSql}
     ORDER BY b.created_at ASC
     LIMIT ? OFFSET ?`, [...params, limit, offset]);
    const total = Number(totalRows[0]?.count || 0);
    res.json({ items, total, page, limit, pages: Math.ceil(total / limit) });
}
async function records(req, res) {
    const user = req.user;
    const { page, limit, offset } = pageParams(req, 20);
    const requestedScope = String(req.query.scope || (user.role === 'QC' ? 'mine' : 'all'));
    const scope = user.role === 'QC' ? 'mine' : requestedScope;
    const result = String(req.query.result || '').toUpperCase();
    const q = String(req.query.q || '').trim();
    const where = [];
    const params = [];
    if (scope === 'mine') {
        where.push('q.tester_id = ?');
        params.push(user.userId);
    }
    if (result === 'PASS' || result === 'FAIL') {
        where.push('q.result = ?');
        params.push(result);
    }
    if (q) {
        where.push('(b.batch_number LIKE ? OR b.barcode_value LIKE ? OR p.name LIKE ? OR p.sku LIKE ? OR q.remarks LIKE ?)');
        const like = `%${q}%`;
        params.push(like, like, like, like, like);
    }
    const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
    const totalRows = await (0, database_1.query)(`SELECT COUNT(*) AS count
     FROM qc_records q
     JOIN batches b ON q.batch_id = b.id
     JOIN products p ON b.product_id = p.id
     ${whereSql}`, params);
    const items = await (0, database_1.query)(`SELECT q.*, b.batch_number, b.barcode_value, p.name AS product_name, p.sku AS product_sku,
            u.name AS tester_name
     FROM qc_records q
     JOIN batches b ON q.batch_id = b.id
     JOIN products p ON b.product_id = p.id
     LEFT JOIN qc_users u ON q.tester_id = u.id
     ${whereSql}
     ORDER BY q.created_at DESC
     LIMIT ? OFFSET ?`, [...params, limit, offset]);
    const total = Number(totalRows[0]?.count || 0);
    res.json({ items, total, page, limit, pages: Math.ceil(total / limit), scope });
}
//# sourceMappingURL=qcController.js.map