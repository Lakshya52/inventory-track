"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.list = list;
exports.getById = getById;
exports.create = create;
exports.update = update;
exports.setStatus = setStatus;
exports.remove = remove;
const database_1 = require("../config/database");
async function logActivity(req, action, description) {
    await (0, database_1.execute)('INSERT INTO activity_logs (user_name, user_role, action, description) VALUES (?, ?, ?, ?)', [req.user?.name || 'System', req.user?.role || 'ADMIN', action, description]);
}
async function list(req, res) {
    const search = (req.query.q || '').trim();
    const status = req.query.status;
    const where = [];
    const params = [];
    if (search) {
        where.push('(name LIKE ? OR vendor_code LIKE ? OR contact_person LIKE ? OR email LIKE ? OR phone LIKE ?)');
        const like = `%${search}%`;
        params.push(like, like, like, like, like);
    }
    if (status === 'active')
        where.push('is_active = 1');
    if (status === 'inactive')
        where.push('is_active = 0');
    const vendors = await (0, database_1.query)(`SELECT * FROM vendors ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY name ASC`, params);
    res.json(vendors);
}
async function getById(req, res) {
    const vendors = await (0, database_1.query)('SELECT * FROM vendors WHERE id = ?', [req.params.id]);
    if (vendors.length === 0) {
        res.status(404).json({ error: 'Vendor not found' });
        return;
    }
    res.json(vendors[0]);
}
async function create(req, res) {
    const { name, contact_person, email, phone, address, gst_number, category, payment_terms, notes, is_active, } = req.body;
    if (!name || !String(name).trim()) {
        res.status(400).json({ error: 'Vendor name is required' });
        return;
    }
    const tempCode = `_TMP_${Date.now()}`;
    try {
        const result = await (0, database_1.execute)(`INSERT INTO vendors
        (vendor_code, name, contact_person, email, phone, address, gst_number, category, payment_terms, notes, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
            tempCode,
            String(name).trim(),
            contact_person || null,
            email || null,
            phone || null,
            address || null,
            gst_number || null,
            category || null,
            payment_terms || null,
            notes || null,
            is_active === false || is_active === 0 ? 0 : 1,
        ]);
        const vendorCode = `VND-${String(result.insertId).padStart(4, '0')}`;
        await (0, database_1.execute)('UPDATE vendors SET vendor_code = ? WHERE id = ?', [vendorCode, result.insertId]);
        await logActivity(req, 'VENDOR_CREATED', `Vendor "${name}" (${vendorCode}) created`);
        res.status(201).json({ id: result.insertId, vendor_code: vendorCode, name, is_active: 1 });
    }
    catch (err) {
        if (err.code === 'ER_DUP_ENTRY') {
            res.status(400).json({ error: 'A vendor with that code already exists' });
            return;
        }
        throw err;
    }
}
async function update(req, res) {
    const { id } = req.params;
    const { name, contact_person, email, phone, address, gst_number, category, payment_terms, notes, is_active, } = req.body;
    if (!name || !String(name).trim()) {
        res.status(400).json({ error: 'Vendor name is required' });
        return;
    }
    const result = await (0, database_1.execute)(`UPDATE vendors SET
       name = ?, contact_person = ?, email = ?, phone = ?, address = ?, gst_number = ?,
       category = ?, payment_terms = ?, notes = ?, is_active = ?
     WHERE id = ?`, [
        String(name).trim(),
        contact_person || null,
        email || null,
        phone || null,
        address || null,
        gst_number || null,
        category || null,
        payment_terms || null,
        notes || null,
        is_active === false || is_active === 0 ? 0 : 1,
        id,
    ]);
    if (result.affectedRows === 0) {
        res.status(404).json({ error: 'Vendor not found' });
        return;
    }
    await logActivity(req, 'VENDOR_UPDATED', `Vendor "${name}" updated`);
    res.json({ message: 'Vendor updated' });
}
async function setStatus(req, res) {
    const { id } = req.params;
    const active = req.body.is_active === true || req.body.is_active === 1 || req.body.is_active === '1';
    const result = await (0, database_1.execute)('UPDATE vendors SET is_active = ? WHERE id = ?', [active ? 1 : 0, id]);
    if (result.affectedRows === 0) {
        res.status(404).json({ error: 'Vendor not found' });
        return;
    }
    await logActivity(req, active ? 'VENDOR_ACTIVATED' : 'VENDOR_DEACTIVATED', `Vendor #${id} ${active ? 'activated' : 'deactivated'}`);
    res.json({ message: active ? 'Vendor activated' : 'Vendor deactivated', is_active: active ? 1 : 0 });
}
async function remove(req, res) {
    const { id } = req.params;
    const vendors = await (0, database_1.query)('SELECT name FROM vendors WHERE id = ?', [id]);
    if (vendors.length === 0) {
        res.status(404).json({ error: 'Vendor not found' });
        return;
    }
    await (0, database_1.execute)('DELETE FROM vendors WHERE id = ?', [id]);
    await logActivity(req, 'VENDOR_DELETED', `Vendor "${vendors[0].name}" deleted`);
    res.json({ message: 'Vendor deleted' });
}
//# sourceMappingURL=vendorController.js.map