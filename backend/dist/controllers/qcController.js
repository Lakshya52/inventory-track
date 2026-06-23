"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.submit = submit;
const database_1 = require("../config/database");
async function submit(req, res) {
    const { barcode_value, result, remarks } = req.body;
    if (!barcode_value || !result) {
        res.status(400).json({ error: 'Barcode value and result are required' });
        return;
    }
    if (!['PASS', 'FAIL'].includes(result)) {
        res.status(400).json({ error: 'Result must be PASS or FAIL' });
        return;
    }
    const batches = await (0, database_1.query)(`SELECT b.*, p.name as product_name FROM batches b JOIN products p ON b.product_id = p.id WHERE b.barcode_value = ?`, [barcode_value]);
    if (batches.length === 0) {
        res.status(404).json({ error: 'Batch not found' });
        return;
    }
    const batch = batches[0];
    if (batch.status === 'DISPATCHED') {
        res.status(400).json({ error: 'Cannot QC an already dispatched batch' });
        return;
    }
    const newStatus = result === 'PASS' ? 'QC_PASSED' : 'QC_FAILED';
    await (0, database_1.execute)('INSERT INTO qc_records (batch_id, tester_id, result, remarks) VALUES (?, ?, ?, ?)', [batch.id, req.user.userId, result, remarks || null]);
    await (0, database_1.execute)('UPDATE batches SET status = ? WHERE id = ?', [newStatus, batch.id]);
    await (0, database_1.execute)('INSERT INTO activity_logs (user_id, action, description) VALUES (?, ?, ?)', [req.user.userId, result === 'PASS' ? 'QC_PASSED' : 'QC_FAILED',
        `Batch ${batch.batch_number} (${batch.product_name}) - ${result}`]);
    res.json({ status: newStatus, batch_id: batch.id });
}
//# sourceMappingURL=qcController.js.map