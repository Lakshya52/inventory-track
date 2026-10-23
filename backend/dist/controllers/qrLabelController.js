"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.create = create;
exports.list = list;
exports.getById = getById;
exports.reprint = reprint;
const database_1 = require("../config/database");
async function jobDetail(id) {
    const jobs = await (0, database_1.query)(`SELECT j.*, p.name AS product_name, p.sku AS product_sku,
            COALESCE(q.name, a.name, 'QC User') AS created_by_name,
            (SELECT COALESCE(SUM(l.print_count), 0) FROM qr_labels l WHERE l.print_job_id = j.id) AS total_prints,
            (SELECT MAX(l.last_printed_at) FROM qr_labels l WHERE l.print_job_id = j.id) AS last_printed_at
     FROM qr_print_jobs j
     JOIN products p ON j.product_id = p.id
     LEFT JOIN qc_users q ON j.created_by = q.id AND j.created_by_role = 'QC'
     LEFT JOIN admins a ON j.created_by = a.id AND j.created_by_role = 'ADMIN'
     WHERE j.id = ?`, [id]);
    if (jobs.length === 0)
        return null;
    const labels = await (0, database_1.query)(`SELECT l.*, b.batch_number, b.status, b.quantity, b.uom
     FROM qr_labels l
     JOIN batches b ON l.batch_id = b.id
     WHERE l.print_job_id = ?
     ORDER BY l.serial_no ASC`, [id]);
    return { job: jobs[0], labels };
}
async function create(req, res) {
    res.status(410).json({
        error: 'QR labels are generated automatically when an administrator creates a batch.',
    });
}
async function list(req, res) {
    const q = String(req.query.q || '').trim();
    const where = q ? 'WHERE p.name LIKE ? OR p.sku LIKE ? OR j.job_code LIKE ?' : '';
    const params = q ? [`%${q}%`, `%${q}%`, `%${q}%`] : [];
    const items = await (0, database_1.query)(`SELECT j.*, p.name AS product_name, p.sku AS product_sku,
            COALESCE(qc.name, a.name, 'QC User') AS created_by_name,
            (SELECT COALESCE(SUM(l.print_count), 0) FROM qr_labels l WHERE l.print_job_id = j.id) AS total_prints,
            (SELECT COUNT(*) FROM qr_labels l WHERE l.print_job_id = j.id) AS label_count,
            (SELECT MAX(l.last_printed_at) FROM qr_labels l WHERE l.print_job_id = j.id) AS last_printed_at
     FROM qr_print_jobs j
     JOIN products p ON j.product_id = p.id
     LEFT JOIN qc_users qc ON j.created_by = qc.id AND j.created_by_role = 'QC'
     LEFT JOIN admins a ON j.created_by = a.id AND j.created_by_role = 'ADMIN'
     ${where}
     ORDER BY j.created_at DESC
     LIMIT 100`, params);
    res.json({ items, total: items.length });
}
async function getById(req, res) {
    const detail = await jobDetail(Number(req.params.id));
    if (!detail) {
        res.status(404).json({ error: 'QR label job not found' });
        return;
    }
    res.json(detail);
}
async function reprint(req, res) {
    const id = Number(req.params.id);
    const requestedQuantity = Number(req.body.quantity);
    const requestedIds = Array.isArray(req.body.label_ids)
        ? req.body.label_ids.map((value) => Number(value)).filter((value) => Number.isInteger(value) && value > 0)
        : [];
    const result = await (0, database_1.withTransaction)(async (conn) => {
        const [jobs] = await conn.execute('SELECT * FROM qr_print_jobs WHERE id = ? FOR UPDATE', [id]);
        if (jobs.length === 0)
            return null;
        const job = jobs[0];
        let labels = [];
        if (requestedIds.length > 0) {
            const placeholders = requestedIds.map(() => '?').join(',');
            const [rows] = await conn.query(`SELECT * FROM qr_labels
         WHERE print_job_id = ? AND id IN (${placeholders})
         ORDER BY serial_no ASC FOR UPDATE`, [id, ...requestedIds]);
            labels = rows;
        }
        else {
            const quantity = Number.isInteger(requestedQuantity) && requestedQuantity > 0
                ? Math.min(requestedQuantity, Number(job.quantity))
                : Number(job.quantity);
            const [rows] = await conn.execute(`SELECT * FROM qr_labels
         WHERE print_job_id = ?
         ORDER BY serial_no ASC LIMIT ? FOR UPDATE`, [id, quantity]);
            labels = rows;
        }
        if (labels.length === 0)
            return { empty: true };
        for (const label of labels) {
            await conn.execute(`UPDATE qr_labels
         SET print_count = print_count + 1, last_printed_at = CURRENT_TIMESTAMP(3)
         WHERE id = ?`, [label.id]);
        }
        await conn.execute(`INSERT INTO activity_logs (user_id, user_name, user_role, action, description)
       VALUES (?, ?, ?, 'QR_CODES_REPRINTED', ?)`, [
            req.user.userId,
            req.user.name,
            req.user.role,
            `${labels.length} QR label${labels.length === 1 ? '' : 's'} reprinted for ${job.job_code}`,
        ]);
        return { jobId: id, selectedIds: labels.map((label) => Number(label.id)) };
    });
    if (!result) {
        res.status(404).json({ error: 'QR label job not found' });
        return;
    }
    if ('empty' in result) {
        res.status(400).json({ error: 'No labels were selected for reprint' });
        return;
    }
    const detail = await jobDetail(result.jobId);
    res.json({
        ...(detail || {}),
        selected_ids: result.selectedIds,
        selected_count: result.selectedIds.length,
    });
}
//# sourceMappingURL=qrLabelController.js.map