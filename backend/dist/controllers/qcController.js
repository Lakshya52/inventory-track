"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.submit = submit;
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