import { Request, Response } from 'express';
import { query, execute } from '../config/database';
import { RowDataPacket } from 'mysql2';

export async function submit(req: Request, res: Response): Promise<void> {
  const { barcode_value, remarks } = req.body;
  if (!barcode_value) {
    res.status(400).json({ error: 'Barcode value is required' });
    return;
  }
  const batches = await query<RowDataPacket[]>(
    `SELECT b.*, p.name as product_name FROM batches b JOIN products p ON b.product_id = p.id WHERE b.barcode_value = ?`,
    [barcode_value]
  );
  if (batches.length === 0) { res.status(404).json({ error: 'Batch not found' }); return; }
  const batch = batches[0];
  if (batch.status === 'DISPATCHED') {
    res.status(400).json({ error: 'Batch already dispatched' });
    return;
  }
  if (batch.status !== 'QC_PASSED') {
    res.status(400).json({
      error: `Batch cannot be dispatched. Current status: ${batch.status}. Must be QC_PASSED.`,
    });
    return;
  }
  await execute('INSERT INTO dispatch_records (batch_id, dispatcher_id, remarks) VALUES (?, ?, ?)',
    [batch.id, req.user!.userId, remarks || null]);
  await execute('UPDATE batches SET status = ? WHERE id = ?', ['DISPATCHED', batch.id]);
  await execute('INSERT INTO activity_logs (user_name, user_role, action, description) VALUES (?, ?, ?, ?)',
    [req.user?.name || 'Dispatch', req.user?.role || 'DISPATCH', 'DISPATCHED', `Batch ${batch.batch_number} (${batch.product_name}) dispatched`]);
  res.json({ status: 'DISPATCHED', batch_id: batch.id });
}

export async function today(req: Request, res: Response): Promise<void> {
  const records = await query<RowDataPacket[]>(
    `SELECT dr.*, b.batch_number, p.name as product_name
     FROM dispatch_records dr
     JOIN batches b ON dr.batch_id = b.id
     JOIN products p ON b.product_id = p.id
     WHERE DATE(dr.created_at) = CURDATE()
     ORDER BY dr.created_at DESC`
  );
  res.json(records);
}
