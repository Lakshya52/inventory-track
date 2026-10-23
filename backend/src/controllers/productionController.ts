import { Request, Response } from 'express';
import { query, execute } from '../config/database';
import { RowDataPacket } from 'mysql2';

export async function listBatches(_req: Request, res: Response): Promise<void> {
  const batches = await query<RowDataPacket[]>(
    `SELECT b.*, p.name as product_name, p.sku as product_sku
     FROM batches b JOIN products p ON b.product_id = p.id
     WHERE b.status IN ('CREATED', 'QC_FAILED', 'DISPATCH_APPROVED')
     ORDER BY b.created_at DESC`
  );
  res.json(batches);
}

export async function fixBatch(req: Request, res: Response): Promise<void> {
  const { batch_id, description } = req.body;
  if (!batch_id) { res.status(400).json({ error: 'Batch ID required' }); return; }
  const batches = await query<RowDataPacket[]>('SELECT * FROM batches WHERE id = ?', [batch_id]);
  if (batches.length === 0) { res.status(404).json({ error: 'Batch not found' }); return; }
  const batch = batches[0];
  if (batch.status !== 'QC_FAILED') {
    res.status(400).json({ error: `Can only fix QC_FAILED batches. Current status: ${batch.status}` });
    return;
  }
  await execute('INSERT INTO fix_records (batch_id, fixed_by, description) VALUES (?, ?, ?)',
    [batch_id, req.user!.userId, description || null]);
  await execute('UPDATE batches SET status = ? WHERE id = ?', ['CREATED', batch_id]);
  await execute('INSERT INTO activity_logs (user_name, user_role, action, description) VALUES (?, ?, ?, ?)',
    [req.user?.name || 'Production', req.user?.role || 'PRODUCTION', 'BATCH_FIXED',
     `Batch ${batch.batch_number} fixed and sent back to QC`]);
  res.json({ status: 'CREATED', batch_id });
}

export async function listFixRecords(_req: Request, res: Response): Promise<void> {
  const records = await query<RowDataPacket[]>(
    `SELECT f.*, b.batch_number, p.name as product_name, u.name as fixed_by_name
     FROM fix_records f
     JOIN batches b ON f.batch_id = b.id
     JOIN products p ON b.product_id = p.id
     LEFT JOIN production_users u ON f.fixed_by = u.id
     ORDER BY f.created_at DESC LIMIT 50`
  );
  res.json(records);
}

export async function submitForQc(req: Request, res: Response): Promise<void> {
  const { barcode_value } = req.body;
  if (!barcode_value) { res.status(400).json({ error: 'Barcode value required' }); return; }
  const batches = await query<RowDataPacket[]>(
    `SELECT b.*, p.name as product_name FROM batches b JOIN products p ON b.product_id = p.id WHERE b.barcode_value = ?`,
    [barcode_value]
  );
  if (batches.length === 0) { res.status(404).json({ error: 'Batch not found' }); return; }
  const batch = batches[0];
  if (batch.status !== 'CREATED') {
    res.status(400).json({ error: `Can only submit CREATED batches to QC. Current status: ${batch.status}` });
    return;
  }
  await execute('INSERT INTO activity_logs (user_name, user_role, action, description) VALUES (?, ?, ?, ?)',
    [req.user?.name || 'Production', req.user?.role || 'PRODUCTION', 'SUBMITTED_FOR_QC',
     `Batch ${batch.batch_number} (${batch.product_name}) submitted for QC`]);
  res.json({ status: 'CREATED', batch_id: batch.id, message: 'Batch submitted for QC verification' });
}
