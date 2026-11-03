import { Request, Response } from 'express';
import { RowDataPacket } from 'mysql2';
import { query, withTransaction } from '../config/database.mysql';

async function jobDetail(id: number): Promise<{ job: any; labels: any[] } | null> {
  const jobs = await query<RowDataPacket[]>(
    `SELECT j.*, p.name AS product_name, p.sku AS product_sku,
            COALESCE(q.name, a.name, 'QC User') AS created_by_name,
            (SELECT COALESCE(SUM(l.print_count), 0) FROM qr_labels l WHERE l.print_job_id = j.id) AS total_prints,
            (SELECT MAX(l.last_printed_at) FROM qr_labels l WHERE l.print_job_id = j.id) AS last_printed_at
     FROM qr_print_jobs j
     JOIN products p ON j.product_id = p.id
     LEFT JOIN qc_users q ON j.created_by = q.id AND j.created_by_role = 'QC'
     LEFT JOIN admins a ON j.created_by = a.id AND j.created_by_role = 'ADMIN'
     WHERE j.id = ?`,
    [id]
  );
  if (jobs.length === 0) return null;
  const labels = await query<RowDataPacket[]>(
    `SELECT l.*, COALESCE(b.parent_batch_number, b.batch_number) AS batch_number,
            b.batch_number AS child_batch_number, b.status, j.quantity,
            b.package_quantity, b.uom, p.name AS product_name, p.sku AS product_sku,
            b.shelf_location_id, COALESCE(s.location_code, b.storage_location) AS storage_location,
            s.warehouse AS warehouse_name
     FROM qr_labels l
     JOIN batches b ON l.batch_id = b.id
     JOIN qr_print_jobs j ON l.print_job_id = j.id
     JOIN products p ON b.product_id = p.id
     LEFT JOIN shelf_locations s ON b.shelf_location_id = s.id
     WHERE l.print_job_id = ?
     ORDER BY l.serial_no ASC`,
    [id]
  );
  return { job: jobs[0], labels };
}

export async function create(req: Request, res: Response): Promise<void> {
  res.status(410).json({
    error: 'QR labels are generated automatically when QC completes finished-goods details for a passed batch.',
  });
}

export async function list(req: Request, res: Response): Promise<void> {
  const q = String(req.query.q || '').trim();
  // Only job codes and label QR values are searchable. Product names are
  // intentionally excluded: one product can own thousands of QR labels, so a
  // name match floods the list instead of finding the scanned label.
  const conditions: string[] = [];
  const params: any[] = [];
  if (q) {
    conditions.push('j.job_code LIKE ?');
    params.push(`%${q}%`);
    if (q.length >= 8) {
      conditions.push('j.id IN (SELECT l.print_job_id FROM qr_labels l WHERE l.qr_value LIKE ?)');
      params.push(`%${q}%`);
    }
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(' OR ')}` : '';
  const items = await query<RowDataPacket[]>(
    `SELECT j.*, p.name AS product_name, p.sku AS product_sku,
            COALESCE(qc.name, a.name, 'QC User') AS created_by_name,
            (SELECT COALESCE(SUM(l.print_count), 0) FROM qr_labels l WHERE l.print_job_id = j.id) AS total_prints,
            (SELECT COUNT(*) FROM qr_labels l WHERE l.print_job_id = j.id) AS label_count,
            (SELECT MAX(l.last_printed_at) FROM qr_labels l WHERE l.print_job_id = j.id) AS last_printed_at
     FROM qr_print_jobs j
     JOIN products p ON j.product_id = p.id
     LEFT JOIN qc_users qc ON j.created_by = qc.id AND j.created_by_role = 'QC'
     LEFT JOIN admins a ON j.created_by = a.id AND j.created_by_role = 'ADMIN'
     ${where}
     ORDER BY j.created_at DESC
     LIMIT 100`,
    params
  );
  res.json({ items, total: items.length });
}

export async function getById(req: Request, res: Response): Promise<void> {
  const detail = await jobDetail(Number(req.params.id));
  if (!detail) {
    res.status(404).json({ error: 'QR label job not found' });
    return;
  }
  if (req.user?.role === 'QC') {
    res.json({ ...detail, labels: detail.labels.map(({ qr_value, ...label }) => label) });
    return;
  }
  res.json(detail);
}

export async function reprint(req: Request, res: Response): Promise<void> {
  const id = Number(req.params.id);
  const requestedQuantity = Number(req.body.quantity);
  const requestedIds = Array.isArray(req.body.label_ids)
    ? req.body.label_ids.map((value: any) => Number(value)).filter((value: number) => Number.isInteger(value) && value > 0)
    : [];
  const approvedRequestId = req.body.approved_request_id ? String(req.body.approved_request_id) : '';
  if (req.user?.role === 'QC' && !approvedRequestId) {
    res.status(403).json({ error: 'An administrator-approved reprint request is required.' });
    return;
  }

  const result = await withTransaction(async (conn) => {
    let approvedIds: number[] | null = null;
    if (approvedRequestId) {
      const ownerClause = req.user?.role === 'QC' ? ' AND requested_by = ?' : '';
      const [requestRows] = await conn.execute<RowDataPacket[]>(`SELECT * FROM qr_reprint_requests WHERE id = ? AND tenant_id = ? AND qr_job_id = ? AND status = 'APPROVED'${ownerClause} FOR UPDATE`, [approvedRequestId, String(req.user!.tenantId), String(id), ...(req.user?.role === 'QC' ? [String(req.user.userId)] : [])]);
      if (!requestRows.length) return { forbidden: true as const };
      try {
        const ids = JSON.parse(requestRows[0].label_ids || '[]');
        approvedIds = Array.isArray(ids) ? ids.map(Number).filter((value: number) => Number.isInteger(value) && value > 0) : [];
      } catch { approvedIds = []; }
    }
    const [jobs] = await conn.execute<RowDataPacket[]>(
      'SELECT * FROM qr_print_jobs WHERE id = ? FOR UPDATE',
      [id]
    );
    if (jobs.length === 0) return null;
    const job = jobs[0];

    let labels: RowDataPacket[] = [];
    if (approvedIds !== null) {
      const placeholders = approvedIds.map(() => '?').join(',');
      const [rows] = approvedIds.length ? await conn.query<RowDataPacket[]>(`SELECT * FROM qr_labels WHERE print_job_id = ? AND id IN (${placeholders}) ORDER BY serial_no ASC FOR UPDATE`, [id, ...approvedIds]) : [[] as any, []] as any;
      labels = rows;
      if (labels.length !== approvedIds.length) return { empty: true as const };
    } else if (requestedIds.length > 0) {
      const placeholders = requestedIds.map(() => '?').join(',');
      const [rows] = await conn.query<RowDataPacket[]>(
        `SELECT * FROM qr_labels
         WHERE print_job_id = ? AND id IN (${placeholders})
         ORDER BY serial_no ASC FOR UPDATE`,
        [id, ...requestedIds]
      );
      labels = rows;
    } else {
      const quantity = Number.isInteger(requestedQuantity) && requestedQuantity > 0
        ? Math.min(requestedQuantity, Number(job.quantity))
        : Number(job.quantity);
      const [rows] = await conn.execute<RowDataPacket[]>(
        `SELECT * FROM qr_labels
         WHERE print_job_id = ?
         ORDER BY serial_no ASC LIMIT ? FOR UPDATE`,
        [id, quantity]
      );
      labels = rows;
    }

    if (labels.length === 0) return { empty: true as const };

    if (approvedIds === null) for (const label of labels) {
      await conn.execute(
        `UPDATE qr_labels
         SET print_count = print_count + 1, last_printed_at = CURRENT_TIMESTAMP(3)
         WHERE id = ?`,
        [label.id]
      );
    }

    await conn.execute(
      `INSERT INTO activity_logs (user_id, user_name, user_role, action, description)
       VALUES (?, ?, ?, 'QR_CODES_REPRINTED', ?)`,
      [
        req.user!.userId,
        req.user!.name,
        req.user!.role,
        `${labels.length} QR label${labels.length === 1 ? '' : 's'} reprinted for ${job.job_code}`,
      ]
    );
    return { jobId: id, selectedIds: labels.map((label) => Number(label.id)) };
  });

  if (!result) {
    res.status(404).json({ error: 'QR label job not found' });
    return;
  }
  if ('forbidden' in result) {
    res.status(403).json({ error: 'This approved reprint request is unavailable to your account.' });
    return;
  }
  if ('empty' in result) {
    res.status(400).json({ error: 'No labels were selected for reprint' });
    return;
  }
  const detail = await jobDetail(result.jobId);
  const selectedIdSet = new Set(result.selectedIds.map(Number));
  res.json({
    ...(detail ? { job: detail.job, labels: detail.labels.filter((label) => selectedIdSet.has(Number(label.id))) } : {}),
    selected_ids: result.selectedIds,
    selected_count: result.selectedIds.length,
  });
}
