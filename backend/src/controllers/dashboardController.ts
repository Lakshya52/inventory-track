import { Request, Response } from 'express';
import { query } from '../config/database';
import { RowDataPacket } from 'mysql2';

export async function stats(_req: Request, res: Response): Promise<void> {
  const totalProducts = await query<RowDataPacket[]>('SELECT COUNT(*) as count FROM products');
  const totalBatches = await query<RowDataPacket[]>('SELECT COUNT(*) as count FROM batches');
  const pendingQc = await query<RowDataPacket[]>("SELECT COUNT(*) as count FROM batches WHERE status = 'CREATED'");
  const qcPassed = await query<RowDataPacket[]>("SELECT COUNT(*) as count FROM batches WHERE status = 'QC_PASSED'");
  const qcFailed = await query<RowDataPacket[]>("SELECT COUNT(*) as count FROM batches WHERE status = 'QC_FAILED'");
  const dispatchedToday = await query<RowDataPacket[]>(
    "SELECT COUNT(*) as count FROM dispatch_records WHERE DATE(created_at) = CURDATE()"
  );
  const inventory = await query<RowDataPacket[]>(
    "SELECT COALESCE(SUM(quantity), 0) as qty, COALESCE(SUM(quantity * unit_price), 0) as value FROM batches WHERE status NOT IN ('DISPATCHED')"
  );
  const recentActivity = await query<RowDataPacket[]>(
    `SELECT * FROM activity_logs ORDER BY created_at DESC LIMIT 10`
  );
  const recentBatches = await query<RowDataPacket[]>(
    `SELECT b.id, b.batch_number, b.quantity, b.barcode_value, b.status, b.created_at,
            p.name as product_name, p.sku as product_sku
     FROM batches b JOIN products p ON b.product_id = p.id
     ORDER BY b.created_at DESC LIMIT 10`
  );

  res.json({
    totalProducts: totalProducts[0].count,
    totalBatches: totalBatches[0].count,
    pendingQc: pendingQc[0].count,
    qcPassed: qcPassed[0].count,
    qcFailed: qcFailed[0].count,
    dispatchedToday: dispatchedToday[0].count,
    currentInventory: inventory[0].qty,
    inventoryValue: inventory[0].value,
    recentActivity,
    recentBatches,
  });
}
