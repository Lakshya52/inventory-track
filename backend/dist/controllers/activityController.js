"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.list = list;
const database_1 = require("../config/database");
async function list(req, res) {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const offset = (page - 1) * limit;
    const logs = await (0, database_1.query)(`SELECT al.*, u.name as user_name FROM activity_logs al LEFT JOIN users u ON al.user_id = u.id ORDER BY al.created_at DESC LIMIT ? OFFSET ?`, [limit, offset]);
    const countResult = await (0, database_1.query)('SELECT COUNT(*) as count FROM activity_logs');
    res.json({ logs, total: countResult[0].count, page, limit });
}
//# sourceMappingURL=activityController.js.map