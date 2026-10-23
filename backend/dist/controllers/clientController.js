"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.list = list;
exports.create = create;
exports.update = update;
exports.remove = remove;
const database_1 = require("../config/database");
async function list(req, res) {
    const clients = await (0, database_1.query)(`SELECT * FROM clients ${req.user?.role === 'ADMIN' ? '' : 'WHERE is_active = 1'} ORDER BY name`);
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
    const existing = await (0, database_1.query)('SELECT * FROM clients WHERE id = ?', [id]);
    if (existing.length === 0) {
        res.status(404).json({ error: 'Client not found' });
        return;
    }
    const nextName = typeof name === 'string' ? name.trim() : existing[0].name;
    if (!nextName) {
        res.status(400).json({ error: 'Client name is required' });
        return;
    }
    const active = is_active === undefined ? existing[0].is_active : Number(is_active) === 1 ? 1 : 0;
    await (0, database_1.execute)('UPDATE clients SET name = ?, contact_person = ?, email = ?, phone = ?, address = ?, gst_number = ?, is_active = ? WHERE id = ?', [
        nextName,
        contact_person === undefined ? existing[0].contact_person : contact_person || null,
        email === undefined ? existing[0].email : email || null,
        phone === undefined ? existing[0].phone : phone || null,
        address === undefined ? existing[0].address : address || null,
        gst_number === undefined ? existing[0].gst_number : gst_number || null,
        active,
        id,
    ]);
    await (0, database_1.execute)('INSERT INTO activity_logs (user_name, user_role, action, description) VALUES (?, ?, ?, ?)', [req.user?.name || 'System', req.user?.role || 'ADMIN', 'CLIENT_UPDATED', `Client "${nextName}" updated`]);
    res.json({ message: 'Client updated' });
}
async function remove(req, res) {
    const { id } = req.params;
    const clients = await (0, database_1.query)('SELECT name, is_active FROM clients WHERE id = ?', [id]);
    if (clients.length === 0) {
        res.status(404).json({ error: 'Client not found' });
        return;
    }
    await (0, database_1.execute)('UPDATE clients SET is_active = 0 WHERE id = ?', [id]);
    await (0, database_1.execute)('INSERT INTO activity_logs (user_name, user_role, action, description) VALUES (?, ?, ?, ?)', [req.user?.name || 'System', req.user?.role || 'ADMIN', 'CLIENT_DEACTIVATED', `Client "${clients[0].name}" deactivated`]);
    res.json({ message: 'Client deactivated' });
}
//# sourceMappingURL=clientController.js.map