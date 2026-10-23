"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.list = list;
exports.create = create;
exports.update = update;
exports.remove = remove;
const database_1 = require("../config/database");
async function list(_req, res) {
    const clients = await (0, database_1.query)('SELECT * FROM clients ORDER BY name');
    res.json(clients);
}
async function create(req, res) {
    const { name, contact_person, email, phone, address, gst_number } = req.body;
    if (!name) {
        res.status(400).json({ error: 'Client name is required' });
        return;
    }
    const result = await (0, database_1.execute)('INSERT INTO clients (name, contact_person, email, phone, address, gst_number) VALUES (?, ?, ?, ?, ?, ?)', [name, contact_person || null, email || null, phone || null, address || null, gst_number || null]);
    await (0, database_1.execute)('INSERT INTO activity_logs (user_name, user_role, action, description) VALUES (?, ?, ?, ?)', [req.user?.name || 'System', req.user?.role || 'ADMIN', 'CLIENT_CREATED', `Client "${name}" created`]);
    res.status(201).json({ id: result.insertId, name, contact_person, email, phone, address, gst_number });
}
async function update(req, res) {
    const { id } = req.params;
    const { name, contact_person, email, phone, address, gst_number, is_active } = req.body;
    await (0, database_1.execute)('UPDATE clients SET name = ?, contact_person = ?, email = ?, phone = ?, address = ?, gst_number = ?, is_active = ? WHERE id = ?', [name, contact_person || null, email || null, phone || null, address || null, gst_number || null, is_active ?? 1, id]);
    res.json({ message: 'Client updated' });
}
async function remove(req, res) {
    const { id } = req.params;
    await (0, database_1.execute)('DELETE FROM clients WHERE id = ?', [id]);
    res.json({ message: 'Client deleted' });
}
//# sourceMappingURL=clientController.js.map