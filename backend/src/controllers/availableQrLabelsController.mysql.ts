import { Request, Response } from 'express';
import { RowDataPacket } from 'mysql2';
import { query } from '../config/database.mysql';
import { divisionWhere } from '../utils/division';

const MAX_BATCH_IDS = 200;

/**
 * Available QR labels for the dispatch order picker: printed, unassigned and
 * not recalled, scoped to the caller's tenant (and division, when set).
 */
export async function availableQrLabels(req: Request, res: Response): Promise<void> {
  const tenantId = req.user!.tenantId;
  const raw = String(req.query.batch_ids ?? '');
  const ids = [...new Set(
    raw.split(',').map((value) => Number(value.trim())).filter((value) => Number.isInteger(value) && value > 0)
  )].slice(0, MAX_BATCH_IDS);
  if (ids.length === 0) {
    res.json([]);
    return;
  }
  const dv = divisionWhere(req, 'l.division_id');
  const rows = await query<RowDataPacket[]>(
    `SELECT l.id, l.batch_id, l.qr_value, l.serial_no
     FROM qr_labels l
     WHERE l.tenant_id = ? AND l.batch_id IN (?)
       AND COALESCE(l.print_count, 0) > 0
       AND l.dispatch_order_id IS NULL
       AND (l.recall_status IS NULL OR l.recall_status <> 'RECALLED')${dv.sql}
     ORDER BY l.batch_id ASC, l.serial_no ASC`,
    [tenantId, ids, ...dv.params]
  );
  res.json(rows.map((row) => ({
    id: Number(row.id),
    batch_id: Number(row.batch_id),
    qr_value: String(row.qr_value),
    serial_no: Number(row.serial_no),
  })));
}
