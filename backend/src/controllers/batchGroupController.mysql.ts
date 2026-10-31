import { Request, Response } from 'express';
import { randomBytes, randomUUID } from 'crypto';
import { RowDataPacket } from 'mysql2';
import { query, withTransaction } from '../config/database.mysql';

type InputLine = { product_id: number; quantity: number; uom: string; shelf_location_id: number; unit_price?: number };

export async function createGroup(req: Request, res: Response): Promise<void> {
  const raw = req.body?.items;
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > 100) { res.status(400).json({ error: 'Add between 1 and 100 products to the batch' }); return; }
  const items: InputLine[] = raw.map((item: any) => ({ product_id: Number(item?.product_id), quantity: Number(item?.quantity), uom: String(item?.uom || '').trim().slice(0, 40), shelf_location_id: Number(item?.shelf_location_id), unit_price: Number(item?.unit_price) || 0 }));
  if (items.some((item) => !Number.isInteger(item.product_id) || item.product_id < 1 || !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 1000 || !item.uom || !Number.isInteger(item.shelf_location_id) || item.shelf_location_id < 1)) { res.status(400).json({ error: 'Each product needs a valid quantity, UOM, and active shelf location' }); return; }
  if (items.reduce((sum, item) => sum + item.quantity, 0) > 10_000) { res.status(400).json({ error: 'A single batch can contain no more than 10,000 QR-labelled units' }); return; }
  if (new Set(items.map((item) => item.product_id)).size !== items.length) { res.status(400).json({ error: 'Each product can appear only once in a batch' }); return; }

  const products = new Map<number, any>();
  for (const item of items) {
    const rows = await query<RowDataPacket[]>('SELECT id, name, sku, price FROM products WHERE id = ?', [item.product_id]);
    if (!rows[0]) { res.status(404).json({ error: `Product ${item.product_id} was not found` }); return; }
    const locations = await query<RowDataPacket[]>('SELECT id, location_code FROM shelf_locations WHERE id = ? AND is_active = 1', [item.shelf_location_id]);
    if (!locations[0]) { res.status(400).json({ error: `Select an active shelf location for ${rows[0].name}` }); return; }
    products.set(item.product_id, { ...rows[0], location_code: locations[0].location_code });
  }

  const groupId = randomUUID();
  const dateStamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const batchNumber = `BATCH-${dateStamp}-${randomBytes(3).toString('hex').toUpperCase()}`;
  try {
    const created = await withTransaction(async (conn) => {
      await conn.execute('INSERT INTO batch_groups (group_key, batch_number, tenant_id, created_by, product_count, total_quantity, status) VALUES (?, ?, ?, ?, ?, ?, \'QC_PASSED\')', [groupId, batchNumber, req.user!.tenantId, req.user!.userId, items.length, items.reduce((sum, item) => sum + item.quantity, 0)]);
      const lines: any[] = [];
      const allLabels: any[] = [];
      for (const [index, item] of items.entries()) {
        const product = products.get(item.product_id);
        const childNumber = `${product.sku}-${dateStamp}-${groupId.slice(0, 6)}-${String(index + 1).padStart(2, '0')}`;
        const qcBarcode = `QC:${randomUUID()}`;
        const [batchInsert] = await conn.execute<any>(`INSERT INTO batches (product_id, batch_number, batch_group_id, parent_batch_number, tenant_id, quantity, uom, unit_price, shelf_location_id, storage_location, status, barcode_value) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'QC_PASSED', ?)`, [item.product_id, childNumber, groupId, batchNumber, req.user!.tenantId, item.quantity, item.uom, item.unit_price || Number(product.price) || 0, item.shelf_location_id, product.location_code, qcBarcode]);
        const batchId = Number(batchInsert.insertId);
        const jobCode = `QRJ-${dateStamp}-${randomBytes(3).toString('hex').toUpperCase()}`;
        const [jobInsert] = await conn.execute<any>('INSERT INTO qr_print_jobs (job_code, product_id, quantity, created_by, created_by_role) VALUES (?, ?, ?, ?, ?)', [jobCode, item.product_id, item.quantity, req.user!.userId, req.user!.role]);
        const jobId = Number(jobInsert.insertId);
        const labels = Array.from({ length: item.quantity }, (_, serial) => ({ qr_value: `QR:${randomUUID()}`, serial_no: serial + 1 }));
        const values = labels.map(() => '(?, ?, ?, ?, 1, CURRENT_TIMESTAMP(3))').join(', ');
        await conn.execute(`INSERT INTO qr_labels (print_job_id, batch_id, qr_value, serial_no, print_count, last_printed_at) VALUES ${values}`, labels.flatMap((label) => [jobId, batchId, label.qr_value, label.serial_no]));
        const [stored] = await conn.execute<RowDataPacket[]>('SELECT id, qr_value, serial_no FROM qr_labels WHERE print_job_id = ? ORDER BY serial_no', [jobId]);
        const resultLabels = stored.map((label, labelIndex) => ({ id: Number(label.id), qr_value: String(label.qr_value), serial_no: allLabels.length + labelIndex + 1, batch_number: batchNumber, child_batch_number: childNumber, product_name: product.name, product_sku: product.sku, print_count: 1 }));
        await conn.execute(`INSERT INTO qc_records (batch_id, tester_id, result, method, remarks) VALUES (?, ?, 'PASS', 'AUTO_PASS', ?)`, [batchId, req.user!.userId, `Created in ${batchNumber}`]);
        await conn.execute('UPDATE products SET quantity = COALESCE(quantity, 0) + ? WHERE id = ?', [item.quantity, item.product_id]);
        lines.push({ batch_id: batchId, batch_number: childNumber, product_id: item.product_id, product_name: product.name, product_sku: product.sku, quantity: item.quantity, uom: item.uom, shelf_location_id: item.shelf_location_id, location_code: product.location_code, qr_job: { id: jobId, job_code: jobCode, product_name: product.name, product_sku: product.sku, quantity: item.quantity }, labels: resultLabels });
        allLabels.push(...resultLabels);
      }
      await conn.execute(`INSERT INTO activity_logs (user_id, user_name, user_role, action, description) VALUES (?, ?, ?, 'BATCH_CREATED', ?)`, [req.user!.userId, req.user!.name, req.user!.role, `Batch ${batchNumber} created with ${items.length} products and ${allLabels.length} QR labels`]);
      return { lines, allLabels };
    });
    res.status(201).json({ id: groupId, batch_group_id: groupId, batch_number: batchNumber, product_count: items.length, total_quantity: created.allLabels.length, batches: created.lines, labels: created.allLabels, message: `Batch ${batchNumber} created with ${items.length} products.` });
  } catch (error: any) {
    console.error('Could not create product batch group', error);
    res.status(500).json({ error: error?.message || 'Could not create the batch' });
  }
}
