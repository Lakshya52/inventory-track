"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.create = create;
exports.list = list;
exports.getByBarcode = getByBarcode;
exports.search = search;
exports.update = update;
exports.getById = getById;
const database_1 = require("../config/database");
async function create(req, res) {
    const { product_id, batch_number, quantity, uom, unit_price, manufacturing_date, expiry_date, storage_location, notes } = req.body;
    if (!product_id || !batch_number) {
        res.status(400).json({ error: 'Product ID and batch number are required' });
        return;
    }
    if (!manufacturing_date || !expiry_date) {
        res.status(400).json({ error: 'Manufacturing date and expiry date are required' });
        return;
    }
    const products = await (0, database_1.query)('SELECT name, sku FROM products WHERE id = ?', [product_id]);
    if (products.length === 0) {
        res.status(404).json({ error: 'Product not found' });
        return;
    }
    const product = products[0];
    const existing = await (0, database_1.query)('SELECT id FROM batches WHERE batch_number = ?', [batch_number]);
    if (existing.length > 0) {
        res.status(409).json({ error: `Batch number "${batch_number}" already exists` });
        return;
    }
    const tempId = `_TEMP_${Date.now()}`;
    const result = await (0, database_1.execute)('INSERT INTO batches (product_id, batch_number, quantity, uom, unit_price, manufacturing_date, expiry_date, storage_location, notes, barcode_value) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [product_id, batch_number, quantity || 1, uom || 'kg', unit_price || 0, manufacturing_date || null, expiry_date || null, storage_location || null, notes || null, tempId]);
    const batchId = result.insertId;
    const barcode_value = `QR:${product.sku}:${batchId}`;
    await (0, database_1.execute)('UPDATE batches SET barcode_value = ? WHERE id = ?', [barcode_value, batchId]);
    await (0, database_1.execute)('INSERT INTO activity_logs (user_name, user_role, action, description) VALUES (?, ?, ?, ?)', [req.user?.name || 'System', req.user?.role || 'ADMIN', 'BATCH_CREATED', `Batch ${batch_number} created for ${product.name}`]);
    res.status(201).json({ id: batchId, barcode_value, product_name: product.name, product_sku: product.sku });
}
async function list(req, res) {
    const batches = await (0, database_1.query)(`SELECT b.*, p.name as product_name, p.sku as product_sku
     FROM batches b JOIN products p ON b.product_id = p.id
     ORDER BY b.created_at DESC`);
    res.json(batches);
}
async function getByBarcode(req, res) {
    const { barcode } = req.params;
    const batches = await (0, database_1.query)(`SELECT b.*,
            p.name as product_name, p.sku as product_sku, p.description as product_description,
            p.cas_number, p.molecular_formula, p.purity as product_purity, p.grade as product_grade,
            p.storage_conditions as product_storage_conditions, p.hazard_classification,
            p.physical_state as product_physical_state, p.hsn_code, p.manufacturer
     FROM batches b JOIN products p ON b.product_id = p.id
     WHERE b.barcode_value = ?`, [barcode]);
    if (batches.length === 0) {
        res.status(404).json({ error: 'Batch not found' });
        return;
    }
    res.json(batches[0]);
}
async function search(req, res) {
    const q = req.query.q || '';
    const batches = await (0, database_1.query)(`SELECT b.*, p.name as product_name, p.sku as product_sku
     FROM batches b JOIN products p ON b.product_id = p.id
     WHERE p.name LIKE ? OR p.sku LIKE ? OR b.batch_number LIKE ?
     ORDER BY b.created_at DESC LIMIT 50`, [`%${q}%`, `%${q}%`, `%${q}%`]);
    res.json(batches);
}
async function update(req, res) {
    const { id } = req.params;
    const { storage_location, notes, quantity, uom, unit_price, manufacturing_date, expiry_date } = req.body;
    await (0, database_1.execute)('UPDATE batches SET storage_location = ?, notes = ?, quantity = ?, uom = ?, unit_price = ?, manufacturing_date = ?, expiry_date = ? WHERE id = ?', [storage_location || null, notes || null, quantity, uom || 'kg', unit_price || 0, manufacturing_date || null, expiry_date || null, id]);
    await (0, database_1.execute)('INSERT INTO activity_logs (user_name, user_role, action, description) VALUES (?, ?, ?, ?)', [req.user?.name || 'System', req.user?.role || 'ADMIN', 'BATCH_UPDATED', `Batch #${id} updated`]);
    res.json({ message: 'Batch updated' });
}
async function getById(req, res) {
    const batches = await (0, database_1.query)(`SELECT b.*, p.name as product_name, p.sku as product_sku
     FROM batches b JOIN products p ON b.product_id = p.id WHERE b.id = ?`, [req.params.id]);
    if (batches.length === 0) {
        res.status(404).json({ error: 'Batch not found' });
        return;
    }
    res.json(batches[0]);
}
//# sourceMappingURL=batchController.js.map