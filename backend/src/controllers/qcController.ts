import { Request, Response } from 'express';
import { query, execute } from '../config/database';
import { RowDataPacket } from 'mysql2';

export async function submit(req: Request, res: Response): Promise<void> {
  const { barcode_value, result, remarks } = req.body;
  if (!barcode_value || !result) {
    res.status(400).json({ error: 'Barcode value and result are required' });
    return;
  }
  if (!['PASS', 'FAIL'].includes(result)) {
    res.status(400).json({ error: 'Result must be PASS or FAIL' });
    return;
  }
  const batches = await query<RowDataPacket[]>(
    `SELECT b.*, p.name as product_name FROM batches b JOIN products p ON b.product_id = p.id WHERE b.barcode_value = ?`,
    [barcode_value]
  );
  if (batches.length === 0) { res.status(404).json({ error: 'Batch not found' }); return; }
  const batch = batches[0];
  if (batch.status === 'DISPATCHED') {
    res.status(400).json({ error: 'Cannot QC — batch already dispatched' });
    return;
  }
  if (batch.status === 'QC_PASSED') {
    res.status(400).json({ error: 'QC already PASSED for this batch' });
    return;
  }
  if (batch.status === 'QC_FAILED') {
    res.status(400).json({ error: 'QC already FAILED for this batch' });
    return;
  }
  const newStatus = result === 'PASS' ? 'QC_PASSED' : 'QC_FAILED';
  await execute('INSERT INTO qc_records (batch_id, tester_id, result, remarks) VALUES (?, ?, ?, ?)',
    [batch.id, req.user!.userId, result, remarks || null]);
  await execute('UPDATE batches SET status = ? WHERE id = ?', [newStatus, batch.id]);
  await execute('INSERT INTO activity_logs (user_name, user_role, action, description) VALUES (?, ?, ?, ?)',
    [req.user?.name || 'QC', req.user?.role || 'QC', result === 'PASS' ? 'QC_PASSED' : 'QC_FAILED',
     `Batch ${batch.batch_number} (${batch.product_name}) - ${result}`]);
  res.json({ status: newStatus, batch_id: batch.id });
}
