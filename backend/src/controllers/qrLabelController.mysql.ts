import { Request, Response } from 'express';
import { ResultSetHeader, RowDataPacket } from 'mysql2';
import { query, withTransaction } from '../config/database.mysql';

const QC_PASSED_STATUSES = new Set([
  'QC_PASSED',
  'DISPATCH_ORDER_RAISED',
  'DISPATCH_APPROVED',
  'LOADING',
  'DISPATCHED',
]);

const FIRST_GROUP_STATUS = `(SELECT COALESCE(bg.status, b.status)
   FROM qr_labels l
   JOIN batches b ON l.batch_id = b.id
   LEFT JOIN batch_groups bg ON bg.group_key = b.batch_group_id
   WHERE l.print_job_id = j.id
   ORDER BY l.serial_no ASC LIMIT 1)`;

function decorateJob(row: Record<string, any>): Record<string, any> {
  const batchStatus = String(row?.batch_status || '').toUpperCase();
  const printedCount = Number(row?.printed_count || 0);
  return {
    ...row,
    total_prints: Number(row?.total_prints || 0),
    label_count: Number(row?.label_count || 0),
    printed_count: printedCount,
    labels_printed: printedCount > 0,
    qc_ready: QC_PASSED_STATUSES.has(batchStatus),
    can_print_initial: printedCount === 0 && QC_PASSED_STATUSES.has(batchStatus),
    batch_status: batchStatus || null,
  };
}

async function jobDetail(id: number, tenantId?: number | string | null): Promise<{ job: any; labels: any[] } | null> {
  const tenantClause = tenantId === undefined || tenantId === null
    ? ''
    : ' AND j.tenant_id = ?';
  const tenantParams = tenantId === undefined || tenantId === null ? [] : [tenantId];
  const jobs = await query<RowDataPacket[]>(
    `SELECT j.*, p.name AS product_name, p.sku AS product_sku,
            COALESCE(q.name, a.name, 'QC User') AS created_by_name,
            (SELECT COALESCE(SUM(l.print_count), 0) FROM qr_labels l WHERE l.print_job_id = j.id) AS total_prints,
            (SELECT COUNT(*) FROM qr_labels l WHERE l.print_job_id = j.id) AS label_count,
            (SELECT COALESCE(SUM(CASE WHEN COALESCE(l.print_count, 0) > 0 THEN 1 ELSE 0 END), 0) FROM qr_labels l WHERE l.print_job_id = j.id) AS printed_count,
            (SELECT MAX(l.last_printed_at) FROM qr_labels l WHERE l.print_job_id = j.id) AS last_printed_at,
            (SELECT b.batch_group_id FROM qr_labels l JOIN batches b ON l.batch_id = b.id WHERE l.print_job_id = j.id ORDER BY l.serial_no ASC LIMIT 1) AS batch_group_id,
            (SELECT COALESCE(bg.batch_number, b.parent_batch_number, b.batch_number) FROM qr_labels l JOIN batches b ON l.batch_id = b.id LEFT JOIN batch_groups bg ON bg.group_key = b.batch_group_id WHERE l.print_job_id = j.id ORDER BY l.serial_no ASC LIMIT 1) AS batch_number,
            ${FIRST_GROUP_STATUS} AS batch_status
     FROM qr_print_jobs j
     JOIN products p ON j.product_id = p.id
     LEFT JOIN qc_users q ON j.created_by = q.id AND j.created_by_role = 'QC'
     LEFT JOIN admins a ON j.created_by = a.id AND j.created_by_role = 'ADMIN'
     WHERE j.id = ?${tenantClause}`,
    [id, ...tenantParams]
  );
  if (jobs.length === 0) return null;
  const labels = await query<RowDataPacket[]>(
    `SELECT l.*, COALESCE(b.parent_batch_number, b.batch_number) AS batch_number,
            b.batch_number AS child_batch_number, COALESCE(bg.status, b.status) AS status,
            b.batch_group_id, j.quantity,
            b.package_quantity, b.uom, p.name AS product_name, p.sku AS product_sku,
            b.shelf_location_id, COALESCE(s.location_code, b.storage_location) AS storage_location,
            s.warehouse AS warehouse_name
     FROM qr_labels l
     JOIN batches b ON l.batch_id = b.id
     LEFT JOIN batch_groups bg ON bg.group_key = b.batch_group_id
     JOIN qr_print_jobs j ON l.print_job_id = j.id
     JOIN products p ON b.product_id = p.id
     LEFT JOIN shelf_locations s ON b.shelf_location_id = s.id
     WHERE l.print_job_id = ?
     ORDER BY l.serial_no ASC`,
    [id]
  );
  return { job: decorateJob(jobs[0]), labels };
}

export async function create(req: Request, res: Response): Promise<void> {
  res.status(410).json({
    error: 'QR labels are generated automatically when QC completes finished-goods details for a passed batch.',
  });
}

export async function list(req: Request, res: Response): Promise<void> {
  const q = String(req.query.q || '').trim();
  // Product names are excluded because one product can own thousands of QR
  // labels; job codes, batch numbers, and label QR values identify a job.
  // Print jobs are tenant-scoped: a workspace never sees another one's jobs.
  const conditions: string[] = ['j.tenant_id = ?'];
  const params: any[] = [req.user!.tenantId];
  if (q) {
    const searchConditions = ['j.job_code LIKE ?'];
    params.push(`%${q}%`);
    searchConditions.push(`j.id IN (
      SELECT l.print_job_id
      FROM qr_labels l
      JOIN batches b ON l.batch_id = b.id
      LEFT JOIN batch_groups bg ON bg.group_key = b.batch_group_id
      WHERE COALESCE(bg.batch_number, b.parent_batch_number, b.batch_number) LIKE ?
    )`);
    params.push(`%${q}%`);
    if (q.length >= 8) {
      searchConditions.push('j.id IN (SELECT l.print_job_id FROM qr_labels l WHERE l.qr_value LIKE ?)');
      params.push(`%${q}%`);
    }
    conditions.push(`(${searchConditions.join(' OR ')})`);
  }
  const where = `WHERE ${conditions.join(' AND ')}`;
  const items = await query<RowDataPacket[]>(
    `SELECT j.*, p.name AS product_name, p.sku AS product_sku,
            COALESCE(qc.name, a.name, 'QC User') AS created_by_name,
            (SELECT COALESCE(SUM(l.print_count), 0) FROM qr_labels l WHERE l.print_job_id = j.id) AS total_prints,
            (SELECT COUNT(*) FROM qr_labels l WHERE l.print_job_id = j.id) AS label_count,
            (SELECT COALESCE(SUM(CASE WHEN COALESCE(l.print_count, 0) > 0 THEN 1 ELSE 0 END), 0) FROM qr_labels l WHERE l.print_job_id = j.id) AS printed_count,
            (SELECT MAX(l.last_printed_at) FROM qr_labels l WHERE l.print_job_id = j.id) AS last_printed_at,
            (SELECT b.batch_group_id FROM qr_labels l JOIN batches b ON l.batch_id = b.id WHERE l.print_job_id = j.id ORDER BY l.serial_no ASC LIMIT 1) AS batch_group_id,
            (SELECT COALESCE(bg.batch_number, b.parent_batch_number, b.batch_number) FROM qr_labels l JOIN batches b ON l.batch_id = b.id LEFT JOIN batch_groups bg ON bg.group_key = b.batch_group_id WHERE l.print_job_id = j.id ORDER BY l.serial_no ASC LIMIT 1) AS batch_number,
            ${FIRST_GROUP_STATUS} AS batch_status
     FROM qr_print_jobs j
     JOIN products p ON j.product_id = p.id
     LEFT JOIN qc_users qc ON j.created_by = qc.id AND j.created_by_role = 'QC'
     LEFT JOIN admins a ON j.created_by = a.id AND j.created_by_role = 'ADMIN'
     ${where}
     ORDER BY j.created_at DESC
     LIMIT 100`,
    params
  );
  res.json({ items: items.map(decorateJob), total: items.length });
}

export async function getById(req: Request, res: Response): Promise<void> {
  const detail = await jobDetail(Number(req.params.id), req.user!.tenantId);
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

export async function printInitial(req: Request, res: Response): Promise<void> {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) {
    res.status(400).json({ error: 'Invalid QR label job id' });
    return;
  }

  const result = await withTransaction(async (conn) => {
    const [jobs] = await conn.execute<RowDataPacket[]>(
      'SELECT * FROM qr_print_jobs WHERE id = ? AND tenant_id = ? FOR UPDATE',
      [id, req.user!.tenantId]
    );
    if (jobs.length === 0) return null;
    const job = jobs[0];

    const [labels] = await conn.execute<RowDataPacket[]>(
      'SELECT * FROM qr_labels WHERE print_job_id = ? ORDER BY serial_no ASC FOR UPDATE',
      [id]
    );
    if (labels.length === 0) return { empty: true as const };
    if (labels.some((label) => Number(label.print_count || 0) > 0)) {
      return { alreadyPrinted: true as const };
    }

    const [statusRows] = await conn.execute<RowDataPacket[]>(
      `SELECT ${FIRST_GROUP_STATUS} AS batch_status
       FROM qr_print_jobs j
       WHERE j.id = ?`,
      [id]
    );
    const batchStatus = String(statusRows[0]?.batch_status || '').toUpperCase();
    if (!QC_PASSED_STATUSES.has(batchStatus)) {
      return { notReady: true as const, status: batchStatus || 'PENDING_QC' };
    }

    await conn.execute(
      `UPDATE qr_labels
       SET print_count = 1, last_printed_at = CURRENT_TIMESTAMP(3)
       WHERE print_job_id = ?`,
      [id]
    );

    // Mark the batches as "QR printed" so a dispatch order can only be raised
    // for stock whose labels have physically been printed.
    await conn.execute(
      `UPDATE batches b
       SET qr_printed_at = CURRENT_TIMESTAMP(3)
       WHERE b.id IN (SELECT DISTINCT batch_id FROM qr_labels WHERE print_job_id = ?)`,
      [id]
    );

    await conn.execute(
      `INSERT INTO activity_logs (user_id, user_name, user_role, action, description)
       VALUES (?, ?, ?, 'QR_LABELS_PRINTED', ?)`,
      [
        req.user!.userId,
        req.user!.name,
        req.user!.role,
        `${labels.length} QR label${labels.length === 1 ? '' : 's'} printed for ${job.job_code} after QC passed`,
      ]
    );

    return { jobId: id, selectedIds: labels.map((label) => Number(label.id)) };
  });

  if (!result) {
    res.status(404).json({ error: 'QR label job not found' });
    return;
  }
  if ('notReady' in result) {
    res.status(409).json({ error: 'QR labels can be printed only after QC passes this batch.' });
    return;
  }
  if ('alreadyPrinted' in result) {
    res.status(409).json({ error: 'These labels were already printed. Request a reprint for another copy.' });
    return;
  }
  if ('empty' in result) {
    res.status(400).json({ error: 'This job has no QR labels to print' });
    return;
  }

  const detail = await jobDetail(result.jobId, req.user!.tenantId);
  const selectedIdSet = new Set(result.selectedIds.map(Number));
  res.json({
    ...(detail ? { job: detail.job, labels: detail.labels.filter((label) => selectedIdSet.has(Number(label.id))) } : {}),
    selected_ids: result.selectedIds,
    selected_count: result.selectedIds.length,
  });
}

export async function reprint(req: Request, res: Response): Promise<void> {
  const id = Number(req.params.id);
  const requestedQuantity = Number(req.body.quantity);
  const requestedIds = Array.isArray(req.body.label_ids)
    ? req.body.label_ids.map((value: any) => Number(value)).filter((value: number) => Number.isInteger(value) && value > 0)
    : [];
  const approvedRequestId = req.body.approved_request_id ? String(req.body.approved_request_id) : '';
  const isAdmin = req.user?.role === 'ADMIN';
  if (!isAdmin && !approvedRequestId) {
    res.status(403).json({ error: 'An administrator-approved reprint request is required.' });
    return;
  }

  const result = await withTransaction(async (conn) => {
    let approvedIds: number[] | null = null;
    if (approvedRequestId) {
      const ownerClause = isAdmin ? '' : ' AND requested_by = ?';
      const [requestRows] = await conn.execute<RowDataPacket[]>(`SELECT * FROM qr_reprint_requests WHERE id = ? AND tenant_id = ? AND qr_job_id = ? AND status = 'APPROVED'${ownerClause} FOR UPDATE`, [approvedRequestId, String(req.user!.tenantId), String(id), ...(isAdmin ? [] : [String(req.user!.userId)])]);
      if (!requestRows.length) return { forbidden: true as const };
      try {
        const ids = JSON.parse(requestRows[0].label_ids || '[]');
        approvedIds = Array.isArray(ids) ? ids.map(Number).filter((value: number) => Number.isInteger(value) && value > 0) : [];
      } catch { approvedIds = []; }
    }
    const [jobs] = await conn.execute<RowDataPacket[]>(
      'SELECT * FROM qr_print_jobs WHERE id = ? AND tenant_id = ? FOR UPDATE',
      [id, req.user!.tenantId]
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

    for (const label of labels) {
      await conn.execute(
        `UPDATE qr_labels
         SET print_count = print_count + 1, last_printed_at = CURRENT_TIMESTAMP(3)
         WHERE id = ?`,
        [label.id]
      );
    }
    if (approvedIds !== null) {
      // An approved reprint request is single use: the print itself consumes
      // the approval, so it can never be replayed for a second copy.
      const [consumed] = await conn.execute<ResultSetHeader>(
        `UPDATE qr_reprint_requests
         SET status = 'FULFILLED', fulfilled_by = ?, fulfilled_by_name = ?, fulfilled_at = CURRENT_TIMESTAMP(3)
         WHERE id = ? AND status = 'APPROVED'`,
        [String(req.user!.userId), req.user!.name, approvedRequestId]
      );
      if (consumed.affectedRows !== 1) return { forbidden: true as const };
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
  const detail = await jobDetail(result.jobId, req.user!.tenantId);
  const selectedIdSet = new Set(result.selectedIds.map(Number));
  res.json({
    ...(detail ? { job: detail.job, labels: detail.labels.filter((label) => selectedIdSet.has(Number(label.id))) } : {}),
    selected_ids: result.selectedIds,
    selected_count: result.selectedIds.length,
  });
}
