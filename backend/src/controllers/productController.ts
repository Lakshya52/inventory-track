import { Request, Response } from 'express';
import { query, execute } from '../config/database';
import { RowDataPacket } from 'mysql2';

export async function create(req: Request, res: Response): Promise<void> {
  const { name, description, sku, price } = req.body;
  if (!name || !sku) {
    res.status(400).json({ error: 'Name and SKU are required' });
    return;
  }
  try {
    const result = await execute('INSERT INTO products (name, description, sku, price) VALUES (?, ?, ?, ?)', [name, description || null, sku, price || 0]);
    await execute('INSERT INTO activity_logs (user_name, user_role, action, description) VALUES (?, ?, ?, ?)',
      [req.user?.name || 'System', req.user?.role || 'ADMIN', 'PRODUCT_CREATED', `Product "${name}" (${sku}) created`]);
    res.status(201).json({ id: result.insertId, name, description, sku, price });
  } catch (err: any) {
    if (err.code === 'ER_DUP_ENTRY') {
      res.status(400).json({ error: 'SKU already exists' });
      return;
    }
    throw err;
  }
}

export async function list(_req: Request, res: Response): Promise<void> {
  const products = await query<RowDataPacket[]>('SELECT * FROM products ORDER BY created_at DESC');
  res.json(products);
}

export async function getById(req: Request, res: Response): Promise<void> {
  const products = await query<RowDataPacket[]>('SELECT * FROM products WHERE id = ?', [req.params.id]);
  if (products.length === 0) { res.status(404).json({ error: 'Product not found' }); return; }
  res.json(products[0]);
}

export async function search(req: Request, res: Response): Promise<void> {
  const q = req.query.q as string || '';
  const products = await query<RowDataPacket[]>(
    'SELECT * FROM products WHERE name LIKE ? OR sku LIKE ? ORDER BY created_at DESC',
    [`%${q}%`, `%${q}%`]
  );
  res.json(products);
}

export async function remove(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  const result = await execute('DELETE FROM products WHERE id = ?', [id]);
  if (result.affectedRows === 0) {
    res.status(404).json({ error: 'Product not found' });
    return;
  }
  await execute('INSERT INTO activity_logs (user_name, user_role, action, description) VALUES (?, ?, ?, ?)',
    [req.user?.name || 'System', req.user?.role || 'ADMIN', 'PRODUCT_DELETED', `Product #${id} deleted`]);
  res.json({ message: 'Product deleted' });
}

export async function update(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  const { name, description, sku, price } = req.body;
  if (!name || !sku) {
    res.status(400).json({ error: 'Name and SKU are required' });
    return;
  }
  const result = await execute('UPDATE products SET name = ?, description = ?, sku = ?, price = ? WHERE id = ?', [name, description || null, sku, price || 0, id]);
  if (result.affectedRows === 0) {
    res.status(404).json({ error: 'Product not found' });
    return;
  }
  await execute('INSERT INTO activity_logs (user_name, user_role, action, description) VALUES (?, ?, ?, ?)',
    [req.user?.name || 'System', req.user?.role || 'ADMIN', 'PRODUCT_UPDATED', `Product "${name}" (${sku}) updated`]);
  res.json({ message: 'Product updated' });
}
