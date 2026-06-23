import { Request, Response } from 'express';
import { query, execute } from '../config/database';
import { RowDataPacket } from 'mysql2';

export async function create(req: Request, res: Response): Promise<void> {
  const { product_id, batch_number, quantity, unit_price, manufacturing_date, expiry_date, notes } = req.body;
  if (!product_id || !batch_number) {
    res.status(400).json({ error: 'Product ID and batch number are required' });
    return;
  }
  const products = await query<RowDataPacket[]>('SELECT name, sku FROM products WHERE id = ?', [product_id]);
  if (products.length === 0) { res.status(404).json({ error: 'Product not found' }); return; }
  const product = products[0];

  const existing = await query<RowDataPacket[]>('SELECT id FROM batches WHERE batch_number = ?', [batch_number]);
  if (existing.length > 0) { res.status(409).json({ error: `Batch number "${batch_number}" already exists` }); return; }

  const tempId = `_TEMP_${Date.now()}`;
  const result = await execute(
    'INSERT INTO batches (product_id, batch_number, quantity, unit_price, manufacturing_date, expiry_date, notes, barcode_value) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [product_id, batch_number, quantity || 1, unit_price || 0, manufacturing_date || null, expiry_date || null, notes || null, tempId]
  );
  const batchId = result.insertId;
  const barcode_value = `QR:${product.sku}:${batchId}`;
  await execute('UPDATE batches SET barcode_value = ? WHERE id = ?', [barcode_value, batchId]);

  await execute('INSERT INTO activity_logs (user_name, user_role, action, description) VALUES (?, ?, ?, ?)',
    [req.user?.name || 'System', req.user?.role || 'ADMIN', 'BATCH_CREATED', `Batch ${batch_number} created for ${product.name}`]);
  res.status(201).json({ id: batchId, barcode_value, product_name: product.name, product_sku: product.sku });
}

export async function list(req: Request, res: Response): Promise<void> {
  const batches = await query<RowDataPacket[]>(
    `SELECT b.*, p.name as product_name, p.sku as product_sku
     FROM batches b JOIN products p ON b.product_id = p.id
     ORDER BY b.created_at DESC`
  );
  res.json(batches);
}

export async function getByBarcode(req: Request, res: Response): Promise<void> {
  const { barcode } = req.params;
  const batches = await query<RowDataPacket[]>(
    `SELECT b.*, p.name as product_name, p.sku as product_sku, p.description as product_description
     FROM batches b JOIN products p ON b.product_id = p.id
     WHERE b.barcode_value = ?`, [barcode]
  );
  if (batches.length === 0) { res.status(404).json({ error: 'Batch not found' }); return; }
  res.json(batches[0]);
}

export async function search(req: Request, res: Response): Promise<void> {
  const q = req.query.q as string || '';
  const batches = await query<RowDataPacket[]>(
    `SELECT b.*, p.name as product_name, p.sku as product_sku
     FROM batches b JOIN products p ON b.product_id = p.id
     WHERE p.name LIKE ? OR p.sku LIKE ? OR b.batch_number LIKE ?
     ORDER BY b.created_at DESC LIMIT 50`,
    [`%${q}%`, `%${q}%`, `%${q}%`]
  );
  res.json(batches);
}
