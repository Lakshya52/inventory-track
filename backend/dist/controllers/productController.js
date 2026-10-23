"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.create = create;
exports.list = list;
exports.getById = getById;
exports.search = search;
exports.remove = remove;
exports.update = update;
const database_1 = require("../config/database");
async function create(req, res) {
    const { name, description, sku, price, quantity, cas_number, molecular_formula, purity, grade, storage_conditions, hazard_classification, physical_state, hsn_code, manufacturer } = req.body;
    if (!name || !sku) {
        res.status(400).json({ error: 'Name and SKU are required' });
        return;
    }
    try {
        const result = await (0, database_1.execute)('INSERT INTO products (name, description, sku, price, quantity, cas_number, molecular_formula, purity, grade, storage_conditions, hazard_classification, physical_state, hsn_code, manufacturer) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [name, description || null, sku, price || 0, quantity || 0, cas_number || null, molecular_formula || null, purity || null, grade || null, storage_conditions || null, hazard_classification || null, physical_state || null, hsn_code || null, manufacturer || null]);
        await (0, database_1.execute)('INSERT INTO activity_logs (user_name, user_role, action, description) VALUES (?, ?, ?, ?)', [req.user?.name || 'System', req.user?.role || 'ADMIN', 'PRODUCT_CREATED', `Product "${name}" (${sku}) created`]);
        res.status(201).json({ id: result.insertId, name, description, sku, price, quantity, cas_number, molecular_formula, purity, grade, storage_conditions, hazard_classification, physical_state, hsn_code, manufacturer });
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
async function remove(req, res) {
    const { id } = req.params;
    const result = await (0, database_1.execute)('DELETE FROM products WHERE id = ?', [id]);
    if (result.affectedRows === 0) {
        res.status(404).json({ error: 'Product not found' });
        return;
    }
    await (0, database_1.execute)('INSERT INTO activity_logs (user_name, user_role, action, description) VALUES (?, ?, ?, ?)', [req.user?.name || 'System', req.user?.role || 'ADMIN', 'PRODUCT_DELETED', `Product #${id} deleted`]);
    res.json({ message: 'Product deleted' });
}
async function update(req, res) {
    const { id } = req.params;
    const { name, description, sku, price, quantity, cas_number, molecular_formula, purity, grade, storage_conditions, hazard_classification, physical_state, hsn_code, manufacturer } = req.body;
    if (!name || !sku) {
        res.status(400).json({ error: 'Name and SKU are required' });
        return;
    }
    const result = await (0, database_1.execute)('UPDATE products SET name = ?, description = ?, sku = ?, price = ?, quantity = ?, cas_number = ?, molecular_formula = ?, purity = ?, grade = ?, storage_conditions = ?, hazard_classification = ?, physical_state = ?, hsn_code = ?, manufacturer = ? WHERE id = ?', [name, description || null, sku, price || 0, quantity || 0, cas_number || null, molecular_formula || null, purity || null, grade || null, storage_conditions || null, hazard_classification || null, physical_state || null, hsn_code || null, manufacturer || null, id]);
    if (result.affectedRows === 0) {
        res.status(404).json({ error: 'Product not found' });
        return;
    }
    await (0, database_1.execute)('INSERT INTO activity_logs (user_name, user_role, action, description) VALUES (?, ?, ?, ?)', [req.user?.name || 'System', req.user?.role || 'ADMIN', 'PRODUCT_UPDATED', `Product "${name}" (${sku}) updated`]);
    res.json({ message: 'Product updated' });
}
//# sourceMappingURL=productController.js.map