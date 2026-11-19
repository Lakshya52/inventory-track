import { Request, Response } from 'express';
import { query, execute } from '../config/database';
import { RowDataPacket } from 'mysql2';
import { divisionFilter, divisionWhere, divisionStamp } from '../utils/division';

export async function listBatches(req: Request, res: Response): Promise<void> {
  const tenantId = req.user!.tenantId;
  const dv = divisionWhere(req, 'b.division_id');
  const dvp = divisionWhere(req, 'p.division_id');
  const batches = await query<RowDataPacket[]>(
    `SELECT b.*, p.name as product_name, p.sku as product_sku
     FROM batches b JOIN products p ON b.product_id = p.id${dvp.sql}
     WHERE b.status IN ('CREATED', 'QC_FAILED', 'DISPATCH_APPROVED') AND b.tenant_id = ? AND p.tenant_id = ?${dv.sql}
     ORDER BY b.created_at DESC`,
    [...dvp.params, tenantId, tenantId, ...dv.params]
  );
  res.json(batches);
}

export async function fixBatch(req: Request, res: Response): Promise<void> {
  const tenantId = req.user!.tenantId;
  const dv = divisionWhere(req);
  const { batch_id, description } = req.body;
  if (!batch_id) { res.status(400).json({ error: 'Batch ID required' }); return; }
  const batches = await query<RowDataPacket[]>(`SELECT * FROM batches WHERE id = ? AND tenant_id = ?${dv.sql}`, [batch_id, tenantId, ...dv.params]);
  if (batches.length === 0) { res.status(404).json({ error: 'Batch not found' }); return; }
  const batch = batches[0];
  if (batch.status !== 'QC_FAILED') {
    res.status(400).json({ error: `Can only fix QC_FAILED batches. Current status: ${batch.status}` });
    return;
  }
  await execute('INSERT INTO fix_records (batch_id, fixed_by, description, tenant_id, division_id) VALUES (?, ?, ?, ?, ?)',
    [batch_id, req.user!.userId, description || null, tenantId, divisionStamp(req)]);
  await execute(`UPDATE batches SET status = ? WHERE id = ? AND tenant_id = ?${dv.sql}`, ['CREATED', batch_id, tenantId, ...dv.params]);
  await execute('INSERT INTO activity_logs (user_name, user_role, action, description, tenant_id, division_id) VALUES (?, ?, ?, ?, ?, ?)',
    [req.user?.name || 'Production', req.user?.role || 'PRODUCTION', 'BATCH_FIXED',
     `Batch ${batch.batch_number} fixed and sent back to QC`, tenantId, divisionStamp(req)]);
  res.json({ status: 'CREATED', batch_id });
}

export async function listFixRecords(req: Request, res: Response): Promise<void> {
  const tenantId = req.user!.tenantId;
  const dv = divisionWhere(req, 'f.division_id');
  const dvb = divisionWhere(req, 'b.division_id');
  const dvp = divisionWhere(req, 'p.division_id');
  const records = await query<RowDataPacket[]>(
    `SELECT f.*, b.batch_number, p.name as product_name, u.name as fixed_by_name
     FROM fix_records f
     JOIN batches b ON f.batch_id = b.id${dvb.sql}
     JOIN products p ON b.product_id = p.id${dvp.sql}
     LEFT JOIN production_users u ON f.fixed_by = u.id AND u.tenant_id = ?
     WHERE f.tenant_id = ? AND b.tenant_id = ? AND p.tenant_id = ?${dv.sql}
     ORDER BY f.created_at DESC LIMIT 50`,
    [...dvb.params, ...dvp.params, tenantId, tenantId, tenantId, tenantId, ...dv.params]
  );
  res.json(records);
}

export async function submitForQc(req: Request, res: Response): Promise<void> {
  const tenantId = req.user!.tenantId;
  const dv = divisionWhere(req, 'b.division_id');
  const dvp = divisionWhere(req, 'p.division_id');
  const { barcode_value } = req.body;
  if (!barcode_value) { res.status(400).json({ error: 'Barcode value required' }); return; }
  const batches = await query<RowDataPacket[]>(
    `SELECT b.*, p.name as product_name FROM batches b JOIN products p ON b.product_id = p.id${dvp.sql} WHERE b.barcode_value = ? AND b.tenant_id = ? AND p.tenant_id = ?${dv.sql}`,
    [...dvp.params, barcode_value, tenantId, tenantId, ...dv.params]
  );
  if (batches.length === 0) { res.status(404).json({ error: 'Batch not found' }); return; }
  const batch = batches[0];
  if (batch.status !== 'CREATED') {
    res.status(400).json({ error: `Can only submit CREATED batches to QC. Current status: ${batch.status}` });
    return;
  }
  await execute('INSERT INTO activity_logs (user_name, user_role, action, description, tenant_id, division_id) VALUES (?, ?, ?, ?, ?, ?)',
    [req.user?.name || 'Production', req.user?.role || 'PRODUCTION', 'SUBMITTED_FOR_QC',
     `Batch ${batch.batch_number} (${batch.product_name}) submitted for QC`, tenantId, divisionStamp(req)]);
  res.json({ status: 'CREATED', batch_id: batch.id, message: 'Batch submitted for QC verification' });
}
