"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.list = list;
exports.create = create;
exports.update = update;
exports.remove = remove;
const database_1 = require("../config/database");
async function list(_req, res) {
    const locations = await (0, database_1.query)('SELECT * FROM shelf_locations ORDER BY location_code');
    res.json(locations);
}
async function create(req, res) {
    const { location_code, description, warehouse, rack, shelf } = req.body;
    if (!location_code) {
        res.status(400).json({ error: 'Location code is required' });
        return;
    }
    try {
        const result = await (0, database_1.execute)('INSERT INTO shelf_locations (location_code, description, warehouse, rack, shelf) VALUES (?, ?, ?, ?, ?)', [location_code, description || null, warehouse || null, rack || null, shelf || null]);
        await (0, database_1.execute)('INSERT INTO activity_logs (user_name, user_role, action, description) VALUES (?, ?, ?, ?)', [req.user?.name || 'System', req.user?.role || 'ADMIN', 'LOCATION_CREATED', `Location "${location_code}" created`]);
        res.status(201).json({ id: result.insertId, location_code, description, warehouse, rack, shelf });
    }
    catch (err) {
        if (err.code === 'ER_DUP_ENTRY') {
            res.status(400).json({ error: 'Location code already exists' });
            return;
        }
        throw err;
    }
}
async function update(req, res) {
    const { id } = req.params;
    const { location_code, description, warehouse, rack, shelf, is_active } = req.body;
    await (0, database_1.execute)('UPDATE shelf_locations SET location_code = ?, description = ?, warehouse = ?, rack = ?, shelf = ?, is_active = ? WHERE id = ?', [location_code, description || null, warehouse || null, rack || null, shelf || null, is_active ?? 1, id]);
    res.json({ message: 'Location updated' });
}
async function remove(req, res) {
    const { id } = req.params;
    await (0, database_1.execute)('DELETE FROM shelf_locations WHERE id = ?', [id]);
    res.json({ message: 'Location deleted' });
}
//# sourceMappingURL=shelfLocationController.js.map