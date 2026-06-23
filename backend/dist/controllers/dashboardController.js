"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.stats = stats;
const database_1 = require("../config/database");
async function stats(_req, res) {
    const totalProducts = await (0, database_1.query)('SELECT COUNT(*) as count FROM products');
    const totalBatches = await (0, database_1.query)('SELECT COUNT(*) as count FROM batches');
    const pendingQc = await (0, database_1.query)("SELECT COUNT(*) as count FROM batches WHERE status = 'CREATED'");
    const qcPassed = await (0, database_1.query)("SELECT COUNT(*) as count FROM batches WHERE status = 'QC_PASSED'");
    const qcFailed = await (0, database_1.query)("SELECT COUNT(*) as count FROM batches WHERE status = 'QC_FAILED'");
    const dispatchedToday = await (0, database_1.query)("SELECT COUNT(*) as count FROM dispatch_records WHERE DATE(created_at) = CURDATE()");
    const inventory = await (0, database_1.query)("SELECT COALESCE(SUM(quantity), 0) as qty, COALESCE(SUM(quantity * unit_price), 0) as value FROM batches WHERE status NOT IN ('DISPATCHED')");
    const recentActivity = await (0, database_1.query)(`SELECT al.*, u.name as user_name FROM activity_logs al LEFT JOIN users u ON al.user_id = u.id ORDER BY al.created_at DESC LIMIT 10`);
    res.json({
        totalProducts: totalProducts[0].count,
        totalBatches: totalBatches[0].count,
        pendingQc: pendingQc[0].count,
        qcPassed: qcPassed[0].count,
        qcFailed: qcFailed[0].count,
        dispatchedToday: dispatchedToday[0].count,
        currentInventory: inventory[0].qty,
        inventoryValue: inventory[0].value,
        recentActivity,
    });
}
//# sourceMappingURL=dashboardController.js.map