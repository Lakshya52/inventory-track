"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.create = create;
exports.list = list;
exports.getByBarcode = getByBarcode;
exports.search = search;
const database_1 = require("../config/database");
async function create(req, res) {
    const { product_id, batch_number, quantity, unit_price, manufacturing_date, expiry_date, notes } = req.body;
    if (!product_id || !batch_number) {
        res.status(400).json({ error: 'Product ID and batch number are required' });
        return;
    }
    const products = await (0, database_1.query)('SELECT name, sku FROM products WHERE id = ?', [product_id]);
    if (products.length === 0) {
        res.status(404).json({ error: 'Product not found' });
        return;
    }
    const product = products[0];
    const barcode_value = `${product.sku}|${batch_number}`;
    const result = await (0, database_1.execute)('INSERT INTO batches (product_id, batch_number, quantity, unit_price, manufacturing_date, expiry_date, notes, barcode_value) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [product_id, batch_number, quantity || 1, unit_price || 0, manufacturing_date || null, expiry_date || null, notes || null, barcode_value]);
    await (0, database_1.execute)('INSERT INTO activity_logs (user_id, action, description) VALUES (?, ?, ?)', [req.user.userId, 'BATCH_CREATED', `Batch ${batch_number} created for ${product.name}`]);
    res.status(201).json({ id: result.insertId, barcode_value });
}
async function list(req, res) {
    const batches = await (0, database_1.query)(`SELECT b.*, p.name as product_name, p.sku as product_sku
     FROM batches b JOIN products p ON b.product_id = p.id
     ORDER BY b.created_at DESC`);
    res.json(batches);
}
async function getByBarcode(req, res) {
    const { barcode } = req.params;
    const batches = await (0, database_1.query)(`SELECT b.*, p.name as product_name, p.sku as product_sku, p.description as product_description
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
//# sourceMappingURL=batchController.js.map