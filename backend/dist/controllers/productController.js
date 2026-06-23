"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.create = create;
exports.list = list;
exports.getById = getById;
exports.search = search;
const database_1 = require("../config/database");
async function create(req, res) {
    const { name, description, sku, price } = req.body;
    if (!name || !sku) {
        res.status(400).json({ error: 'Name and SKU are required' });
        return;
    }
    try {
        const result = await (0, database_1.execute)('INSERT INTO products (name, description, sku, price) VALUES (?, ?, ?, ?)', [name, description || null, sku, price || 0]);
        await (0, database_1.execute)('INSERT INTO activity_logs (user_id, action, description) VALUES (?, ?, ?)', [req.user.userId, 'PRODUCT_CREATED', `Product "${name}" (${sku}) created`]);
        res.status(201).json({ id: result.insertId, name, description, sku, price });
    }
    catch (err) {
        if (err.code === 'ER_DUP_ENTRY') {
            res.status(400).json({ error: 'SKU already exists' });
            return;
        }
        throw err;
    }
}
async function list(_req, res) {
    const products = await (0, database_1.query)('SELECT * FROM products ORDER BY created_at DESC');
    res.json(products);
}
async function getById(req, res) {
    const products = await (0, database_1.query)('SELECT * FROM products WHERE id = ?', [req.params.id]);
    if (products.length === 0) {
        res.status(404).json({ error: 'Product not found' });
        return;
    }
    res.json(products[0]);
}
async function search(req, res) {
    const q = req.query.q || '';
    const products = await (0, database_1.query)('SELECT * FROM products WHERE name LIKE ? OR sku LIKE ? ORDER BY created_at DESC', [`%${q}%`, `%${q}%`]);
    res.json(products);
}
//# sourceMappingURL=productController.js.map