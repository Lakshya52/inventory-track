"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.submit = submit;
exports.today = today;
const database_1 = require("../config/database");
async function submit(req, res) {
    const { barcode_value, remarks } = req.body;
    if (!barcode_value) {
        res.status(400).json({ error: 'Barcode value is required' });
        return;
    }
    const batches = await (0, database_1.query)(`SELECT b.*, p.name as product_name FROM batches b JOIN products p ON b.product_id = p.id WHERE b.barcode_value = ?`, [barcode_value]);
    if (batches.length === 0) {
        res.status(404).json({ error: 'Batch not found' });
        return;
    }
    const batch = batches[0];
    if (batch.status !== 'QC_PASSED') {
        res.status(400).json({
            error: 'Batch cannot be dispatched until QC is passed.',
            currentStatus: batch.status,
        });
        return;
    }
    await (0, database_1.execute)('INSERT INTO dispatch_records (batch_id, dispatcher_id, remarks) VALUES (?, ?, ?)', [batch.id, req.user.userId, remarks || null]);
    await (0, database_1.execute)('UPDATE batches SET status = ? WHERE id = ?', ['DISPATCHED', batch.id]);
    await (0, database_1.execute)('INSERT INTO activity_logs (user_id, action, description) VALUES (?, ?, ?)', [req.user.userId, 'DISPATCHED', `Batch ${batch.batch_number} (${batch.product_name}) dispatched`]);
    res.json({ status: 'DISPATCHED', batch_id: batch.id });
}
async function today(req, res) {
    const records = await (0, database_1.query)(`SELECT dr.*, b.batch_number, p.name as product_name, u.name as dispatcher_name
     FROM dispatch_records dr
     JOIN batches b ON dr.batch_id = b.id
     JOIN products p ON b.product_id = p.id
     JOIN users u ON dr.dispatcher_id = u.id
     WHERE DATE(dr.created_at) = CURDATE()
     ORDER BY dr.created_at DESC`);
    res.json(records);
}
//# sourceMappingURL=dispatchController.js.map