"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.create = create;
exports.list = list;
exports.getByBarcode = getByBarcode;
exports.search = search;
exports.update = update;
exports.getById = getById;
const crypto_1 = require("crypto");
const database_1 = require("../config/database");
async function create(req, res) {
    const { product_id, batch_number, quantity, uom, unit_price, manufacturing_date, expiry_date, shelf_location_id, storage_location, notes } = req.body;
    if (!product_id || !batch_number) {
        res.status(400).json({ error: 'Product ID and batch number are required' });
        return;
    }
    if (!manufacturing_date || !expiry_date) {
        res.status(400).json({ error: 'Manufacturing date and expiry date are required' });
        return;
    }
    const labelCount = Number(quantity);
    if (!Number.isInteger(labelCount) || labelCount < 1 || labelCount > 1000) {
        res.status(400).json({ error: 'Batch quantity must be a whole number between 1 and 1000 because one QR label is generated per unit' });
        return;
    }
    const products = await (0, database_1.query)('SELECT id, name, sku, price FROM products WHERE id = ?', [product_id]);
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
    if (shelf_location_id) {
        const locations = await (0, database_1.query)('SELECT id, location_code FROM shelf_locations WHERE id = ? AND is_active = 1', [shelf_location_id]);
        if (locations.length === 0) {
            res.status(400).json({ error: 'Select an active shelf location' });
            return;
        }
    }
    const jobCode = `QRJ-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${(0, crypto_1.randomBytes)(3).toString('hex').toUpperCase()}`;
    const result = await (0, database_1.withTransaction)(async (conn) => {
        const [batchInsert] = await conn.execute(`INSERT INTO batches
        (product_id, batch_number, quantity, uom, unit_price, manufacturing_date, expiry_date,
         shelf_location_id, storage_location, notes, barcode_value)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
            product_id, batch_number, labelCount, 'pcs', Number(unit_price) || 0,
            manufacturing_date, expiry_date, shelf_location_id || null,
            storage_location || null, notes || null, `_TEMP_${(0, crypto_1.randomUUID)()}`,
        ]);
        const batchId = Number(batchInsert.insertId);
        const [jobInsert] = await conn.execute(`INSERT INTO qr_print_jobs (job_code, product_id, quantity, created_by, created_by_role)
       VALUES (?, ?, ?, ?, 'ADMIN')`, [jobCode, product_id, labelCount, req.user.userId]);
        const jobId = Number(jobInsert.insertId);
        const labels = [];
        let firstBarcode = '';
        for (let serial = 1; serial <= labelCount; serial += 1) {
            const qrValue = `QR:${(0, crypto_1.randomUUID)()}`;
            if (serial === 1)
                firstBarcode = qrValue;
            const [labelInsert] = await conn.execute(`INSERT INTO qr_labels (print_job_id, batch_id, qr_value, serial_no, print_count, last_printed_at)
         VALUES (?, ?, ?, ?, 1, CURRENT_TIMESTAMP(3))`, [jobId, batchId, qrValue, serial]);
            labels.push({
                id: Number(labelInsert.insertId),
                qr_value: qrValue,
                serial_no: serial,
                batch_number,
                print_count: 1,
            });
        }
        await conn.execute('UPDATE batches SET barcode_value = ? WHERE id = ?', [firstBarcode, batchId]);
        await conn.execute(`INSERT INTO activity_logs (user_id, user_name, user_role, action, description)
       VALUES (?, ?, ?, 'BATCH_CREATED', ?)`, [req.user.userId, req.user.name, req.user.role, `Batch ${batch_number} created for ${product.name} with ${labelCount} unit QR labels`]);
        return { batchId, jobId, labels, barcode_value: firstBarcode };
    });
    res.status(201).json({
        id: result.batchId,
        barcode_value: result.barcode_value,
        product_name: product.name,
        product_sku: product.sku,
        qr_job: {
            id: result.jobId,
            job_code: jobCode,
            product_name: product.name,
            product_sku: product.sku,
            quantity: labelCount,
        },
        labels: result.labels,
    });
}
async function list(req, res) {
    const batches = await (0, database_1.query)(`SELECT b.*, p.name as product_name, p.sku as product_sku, s.location_code,
            (SELECT COUNT(*) FROM qr_labels l WHERE l.batch_id = b.id) AS qr_count,
            (SELECT MIN(l.print_job_id) FROM qr_labels l WHERE l.batch_id = b.id) AS qr_job_id
     FROM batches b JOIN products p ON b.product_id = p.id
     LEFT JOIN shelf_locations s ON s.id = b.shelf_location_id
     ORDER BY b.created_at DESC`);
    res.json(batches);
}
async function getByBarcode(req, res) {
    const { barcode } = req.params;
    const batches = await (0, database_1.query)(`SELECT b.*,
            p.name as product_name, p.sku as product_sku, p.description as product_description,
            p.cas_number, p.molecular_formula, p.purity as product_purity, p.grade as product_grade,
            p.storage_conditions as product_storage_conditions, p.hazard_classification,
            p.physical_state as product_physical_state, p.hsn_code, p.manufacturer,
            l.qr_value AS scanned_qr, s.location_code,
            (SELECT COUNT(*) FROM qr_labels units WHERE units.batch_id = b.id) AS qr_count
     FROM batches b JOIN products p ON b.product_id = p.id
     LEFT JOIN qr_labels l ON l.batch_id = b.id AND l.qr_value = ?
     LEFT JOIN shelf_locations s ON s.id = b.shelf_location_id
     WHERE b.barcode_value = ? OR l.qr_value = ?`, [barcode, barcode, barcode]);
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
    const { shelf_location_id, storage_location, notes, quantity, unit_price, manufacturing_date, expiry_date } = req.body;
    const batches = await (0, database_1.query)('SELECT b.id, b.quantity FROM batches b WHERE b.id = ?', [id]);
    if (batches.length === 0) {
        res.status(404).json({ error: 'Batch not found' });
        return;
    }
    if (quantity !== undefined && Number(quantity) !== Number(batches[0].quantity)) {
        res.status(400).json({ error: 'Batch quantity cannot be changed after unit QR labels are generated. Create a new batch with the correct quantity.' });
        return;
    }
    const locationId = shelf_location_id === undefined || shelf_location_id === null || shelf_location_id === ''
        ? null
        : Number(shelf_location_id);
    if (locationId !== null) {
        if (!Number.isInteger(locationId) || locationId <= 0) {
            res.status(400).json({ error: 'Select a valid shelf location' });
            return;
        }
        const locations = await (0, database_1.query)('SELECT id FROM shelf_locations WHERE id = ? AND is_active = 1', [locationId]);
        if (locations.length === 0) {
            res.status(400).json({ error: 'Select an active shelf location' });
            return;
        }
    }
    await (0, database_1.execute)('UPDATE batches SET shelf_location_id = ?, storage_location = ?, notes = ?, unit_price = ?, manufacturing_date = ?, expiry_date = ? WHERE id = ?', [locationId, storage_location || null, notes || null, unit_price || 0, manufacturing_date || null, expiry_date || null, id]);
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