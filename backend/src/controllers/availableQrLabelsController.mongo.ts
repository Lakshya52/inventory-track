import { Request, Response } from 'express';
import { getContext, isValidId } from '../config/database.mongo';
import { divisionFilter } from '../utils/division';

const MAX_BATCH_IDS = 200;

/**
 * Available QR labels for the dispatch order picker: printed, unassigned and
 * not recalled, scoped to the caller's tenant (and division, when set).
 */
export async function availableQrLabels(req: Request, res: Response): Promise<void> {
  const tenantId = req.user!.tenantId;
  const raw = String(req.query.batch_ids ?? '');
  // Ids can be 24-hex ObjectId strings (mongo) or legacy numerics — keep them
  // as trimmed strings and let the mongo layer expand them to ObjectIds.
  const ids = [...new Set(
    raw.split(',').map((value) => value.trim()).filter((value) => isValidId(value))
  )].slice(0, MAX_BATCH_IDS);
  if (ids.length === 0) {
    res.json([]);
    return;
  }
  const ctx = await getContext();
  const labels = await ctx.find(
    'qr_labels',
    {
      tenant_id: tenantId,
      batch_id: { $in: ids },
      print_count: { $gt: 0 },
      recall_status: { $ne: 'RECALLED' },
      $or: [{ dispatch_order_id: { $exists: false } }, { dispatch_order_id: null }],
      ...divisionFilter(req, 'division_id'),
    },
    {
      sort: { batch_id: 1, serial_no: 1 },
      projection: { batch_id: 1, qr_value: 1, serial_no: 1 },
    }
  );
  res.json(labels.map((label: any) => ({
    id: label.id,
    batch_id: label.batch_id,
    qr_value: String(label.qr_value),
    serial_no: Number(label.serial_no ?? 0),
  })));
}
