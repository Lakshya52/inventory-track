import { Request, Response } from 'express';
import { ResultSetHeader, RowDataPacket } from 'mysql2';
import { query, withTransaction } from '../config/database.mysql';
import { divisionStamp, divisionWhere } from '../utils/division';
import { publish } from '../realtime/hub';

const QC_PASSED_STATUSES = new Set([
  'QC_PASSED',
  'DISPATCH_ORDER_RAISED',
  'DISPATCH_APPROVED',
  'LOADING',
  'DISPATCHED',
]);

/**
 * Division fragments bind the requester's division id exactly once each.
 * `divisionCollector` returns a `dvv(column)` helper; calling it appends the
 * SQL fragment to the template under construction and pushes the bound
 * parameter into `divParams` in the same (textual) order. Anything interpolated
 * into the SELECT/FROM is collected this way, while fragments for the main
 * WHERE are kept in a separate `dv` so they can be appended after the
 * pre-existing WHERE parameters.
 */
type DivisionFragment = { sql: string; params: unknown[] };
type DivisionFragmentFor = (column: string) => DivisionFragment;

const NO_DIVISION_FRAGMENT: DivisionFragment = { sql: '', params: [] };

function divisionCollector(divisionReq?: Request): { divParams: any[]; dvv: DivisionFragmentFor } {
  const divParams: any[] = [];
  const dvv: DivisionFragmentFor = (column: string) => {
    if (!divisionReq) return { sql: '', params: [] };
    const fragment = divisionWhere(divisionReq, column);
    divParams.push(...fragment.params);
    return fragment;
  };
  return { divParams, dvv };
}

function firstGroupStatus(dvv: DivisionFragmentFor): string {
  return `(SELECT COALESCE(bg.status, b.status)
   FROM qr_labels l
   JOIN batches b ON l.batch_id = b.id${dvv('b.division_id').sql}
   LEFT JOIN batch_groups bg ON bg.group_key = b.batch_group_id${dvv('bg.division_id').sql}
   WHERE l.print_job_id = j.id${dvv('l.division_id').sql}
   ORDER BY l.serial_no ASC LIMIT 1)`;
}

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

async function jobDetail(id: number, tenantId?: number | string | null, divisionReq?: Request): Promise<{ job: any; labels: any[] } | null> {
  const tenantClause = tenantId === undefined || tenantId === null
    ? ''
    : ' AND j.tenant_id = ?';
  const tenantParams = tenantId === undefined || tenantId === null ? [] : [tenantId];
  const dvJ = divisionReq ? divisionWhere(divisionReq, 'j.division_id') : NO_DIVISION_FRAGMENT;
  const jobsQuery = divisionCollector(divisionReq);
  const dvv = jobsQuery.dvv;
  const jobsSql =
    `SELECT j.*, p.name AS product_name, p.sku AS product_sku,
            COALESCE(q.name, a.name, 'QC User') AS created_by_name,
            (SELECT COALESCE(SUM(l.print_count), 0) FROM qr_labels l WHERE l.print_job_id = j.id${dvv('l.division_id').sql}) AS total_prints,
            (SELECT COUNT(*) FROM qr_labels l WHERE l.print_job_id = j.id${dvv('l.division_id').sql}) AS label_count,
            (SELECT COALESCE(SUM(CASE WHEN COALESCE(l.print_count, 0) > 0 THEN 1 ELSE 0 END), 0) FROM qr_labels l WHERE l.print_job_id = j.id${dvv('l.division_id').sql}) AS printed_count,
            (SELECT MAX(l.last_printed_at) FROM qr_labels l WHERE l.print_job_id = j.id${dvv('l.division_id').sql}) AS last_printed_at,
            (SELECT b.batch_group_id FROM qr_labels l JOIN batches b ON l.batch_id = b.id${dvv('b.division_id').sql} WHERE l.print_job_id = j.id${dvv('l.division_id').sql} ORDER BY l.serial_no ASC LIMIT 1) AS batch_group_id,
            (SELECT COALESCE(bg.batch_number, b.parent_batch_number, b.batch_number) FROM qr_labels l JOIN batches b ON l.batch_id = b.id${dvv('b.division_id').sql} LEFT JOIN batch_groups bg ON bg.group_key = b.batch_group_id${dvv('bg.division_id').sql} WHERE l.print_job_id = j.id${dvv('l.division_id').sql} ORDER BY l.serial_no ASC LIMIT 1) AS batch_number,
            ${firstGroupStatus(dvv)} AS batch_status
     FROM qr_print_jobs j
     JOIN products p ON j.product_id = p.id${dvv('p.division_id').sql}
     LEFT JOIN qc_users q ON j.created_by = q.id AND j.created_by_role = 'QC'
     LEFT JOIN admins a ON j.created_by = a.id AND j.created_by_role = 'ADMIN'
     WHERE j.id = ?${tenantClause}${dvJ.sql}`;
  const jobs = await query<RowDataPacket[]>(jobsSql, [...jobsQuery.divParams, id, ...tenantParams, ...dvJ.params]);
  const labelsTenantClause = tenantId === undefined || tenantId === null
    ? ''
    : ' AND l.tenant_id = ?';
  const labelsTenantParams = tenantId === undefined || tenantId === null ? [] : [tenantId];
  if (jobs.length === 0) return null;
  const labelsQuery = divisionCollector(divisionReq);
  const ldvv = labelsQuery.dvv;
  const dvL = divisionReq ? divisionWhere(divisionReq, 'l.division_id') : NO_DIVISION_FRAGMENT;
  const labelsSql =
    `SELECT l.*, COALESCE(b.parent_batch_number, b.batch_number) AS batch_number,
            b.batch_number AS child_batch_number, COALESCE(bg.status, b.status) AS status,
            b.batch_group_id, j.quantity,
            b.package_quantity, b.uom, p.name AS product_name, p.sku AS product_sku,
            b.shelf_location_id, COALESCE(s.location_code, b.storage_location) AS storage_location,
            s.warehouse AS warehouse_name
     FROM qr_labels l
     JOIN batches b ON l.batch_id = b.id AND b.tenant_id = l.tenant_id${ldvv('b.division_id').sql}
     LEFT JOIN batch_groups bg ON bg.group_key = b.batch_group_id${ldvv('bg.division_id').sql}
     JOIN qr_print_jobs j ON l.print_job_id = j.id${ldvv('j.division_id').sql}
     JOIN products p ON b.product_id = p.id${ldvv('p.division_id').sql}
     LEFT JOIN shelf_locations s ON b.shelf_location_id = s.id${ldvv('s.division_id').sql}
     WHERE l.print_job_id = ?${labelsTenantClause}${dvL.sql}
     ORDER BY l.serial_no ASC`;
  const labels = await query<RowDataPacket[]>(labelsSql, [...labelsQuery.divParams, id, ...labelsTenantParams, ...dvL.params]);
  return { job: decorateJob(jobs[0]), labels };
}

export async function create(req: Request, res: Response): Promise<void> {
  res.status(410).json({
    error: 'QR labels are generated automatically when QC completes finished-goods details for a passed batch.',
  });
}

/** Confirm the terminal outcome of print jobs after the Windows queue reports back. */
export async function reportPrintResult(req: Request, res: Response): Promise<void> {
  const rawIds = Array.isArray(req.body?.job_ids) ? req.body.job_ids : [];
  const jobIds = [...new Set(rawIds.map((value: unknown) => String(value).trim()).filter(Boolean))].slice(0, 500);
  const outcome = String(req.body?.outcome || '').toUpperCase();
  if (jobIds.length === 0 || !['PRINTED', 'CANCELLED', 'FAILED'].includes(outcome)) {
    res.status(400).json({ error: 'Provide job_ids and an outcome of PRINTED, CANCELLED or FAILED.' });
    return;
  }
  const tenantId = req.user!.tenantId;
  const dvJ = divisionWhere(req, 'division_id');
  const dvB = divisionWhere(req, 'division_id');
  const marks = jobIds.map(() => '?').join(',');
  const jobs = await query<RowDataPacket[]>(
    `SELECT id, job_code FROM qr_print_jobs WHERE tenant_id = ? AND id IN (${marks})${dvJ.sql}`,
    [tenantId, ...jobIds, ...dvJ.params] as any[]
  );
  if (jobs.length === 0) { res.status(404).json({ error: 'Print jobs not found' }); return; }
  const foundIds = jobs.map((job) => Number(job.id));
  const foundMarks = foundIds.map(() => '?').join(',');

  await query(
    `UPDATE qr_print_jobs SET print_outcome = ?, print_confirmed_at = NOW()
     WHERE tenant_id = ? AND id IN (${foundMarks})${dvJ.sql}`,
    [outcome, tenantId, ...foundIds, ...dvJ.params] as any[]
  );

  if (outcome !== 'PRINTED') {
    const dvL = divisionWhere(req, 'l.division_id');
    const labels = await query<RowDataPacket[]>(
      `SELECT l.id, l.batch_id FROM qr_labels l WHERE l.tenant_id = ? AND l.print_job_id IN (${foundMarks})${dvL.sql}`,
      [tenantId, ...foundIds, ...dvL.params] as any[]
    );
    const batchIds = [...new Set(labels.map((label) => Number(label.batch_id)).filter(Boolean))];
    const dvLabelUpdate = divisionWhere(req, 'division_id');
    await query(
      `UPDATE qr_labels SET print_count = 0, last_printed_at = NULL
       WHERE tenant_id = ? AND print_job_id IN (${foundMarks})${dvLabelUpdate.sql}`,
      [tenantId, ...foundIds, ...dvLabelUpdate.params] as any[]
    );
    for (const batchId of batchIds) {
      const labelDivision = divisionWhere(req, 'division_id');
      const [remaining] = await query<RowDataPacket[]>(
        `SELECT COUNT(*) AS total FROM qr_labels WHERE tenant_id = ? AND batch_id = ? AND print_count > 0${labelDivision.sql}`,
        [tenantId, batchId, ...labelDivision.params] as any[]
      );
      if (Number(remaining[0]?.total || 0) === 0) {
        await query(
          `UPDATE batches SET qr_printed_at = NULL WHERE id = ? AND tenant_id = ?${dvB.sql}`,
          [batchId, tenantId, ...dvB.params] as any[]
        );
      }
    }
  }

  await query(
    `INSERT INTO activity_logs (user_id, user_name, user_role, action, description, tenant_id, division_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [req.user!.userId, req.user!.name, req.user!.role,
      outcome === 'PRINTED' ? 'QR_PRINT_CONFIRMED' : outcome === 'CANCELLED' ? 'QR_PRINT_CANCELLED' : 'QR_PRINT_FAILED',
      `${outcome}: ${jobs.map((job) => job.job_code).join(', ')}`,
      tenantId, divisionStamp(req)] as any[]
  );
  res.json({ updated: foundIds.length, outcome });
}

export async function list(req: Request, res: Response): Promise<void> {
  const q = String(req.query.q || '').trim();
  // Product names are excluded because one product can own thousands of QR
  // labels; job codes, batch numbers, and label QR values identify a job.
  // Print jobs are tenant-scoped: a workspace never sees another one's jobs.
  const dv = divisionWhere(req, 'j.division_id');
  const conditions: string[] = ['j.tenant_id = ?'];
  const params: any[] = [req.user!.tenantId];
  if (q) {
    const searchConditions = ['j.job_code LIKE ?'];
    params.push(`${q}%`);
    const dvAB = divisionWhere(req, 'b.division_id');
    const dvABG = divisionWhere(req, 'bg.division_id');
    const dvAL = divisionWhere(req, 'l.division_id');
    searchConditions.push(`j.id IN (
      SELECT l.print_job_id
      FROM qr_labels l
      JOIN batches b ON l.batch_id = b.id${dvAB.sql}
      LEFT JOIN batch_groups bg ON bg.group_key = b.batch_group_id${dvABG.sql}
      WHERE COALESCE(bg.batch_number, b.parent_batch_number, b.batch_number) LIKE ?${dvAL.sql}
    )`);
    params.push(...dvAB.params, ...dvABG.params, `${q}%`, ...dvAL.params);
    if (q.length >= 8) {
      const dvBL = divisionWhere(req, 'l.division_id');
      searchConditions.push(`j.id IN (SELECT l.print_job_id FROM qr_labels l WHERE l.qr_value LIKE ?${dvBL.sql})`);
      params.push(`${q}%`, ...dvBL.params);
    }
    conditions.push(`(${searchConditions.join(' OR ')})`);
  }
  const where = `WHERE ${conditions.join(' AND ')}`;
  const listQuery = divisionCollector(req);
  const dvv = listQuery.dvv;
  const listSql =
    `SELECT j.*, p.name AS product_name, p.sku AS product_sku,
            COALESCE(qc.name, a.name, 'QC User') AS created_by_name,
            (SELECT COALESCE(SUM(l.print_count), 0) FROM qr_labels l WHERE l.print_job_id = j.id${dvv('l.division_id').sql}) AS total_prints,
            (SELECT COUNT(*) FROM qr_labels l WHERE l.print_job_id = j.id${dvv('l.division_id').sql}) AS label_count,
            (SELECT COALESCE(SUM(CASE WHEN COALESCE(l.print_count, 0) > 0 THEN 1 ELSE 0 END), 0) FROM qr_labels l WHERE l.print_job_id = j.id${dvv('l.division_id').sql}) AS printed_count,
            (SELECT MAX(l.last_printed_at) FROM qr_labels l WHERE l.print_job_id = j.id${dvv('l.division_id').sql}) AS last_printed_at,
            (SELECT b.batch_group_id FROM qr_labels l JOIN batches b ON l.batch_id = b.id${dvv('b.division_id').sql} WHERE l.print_job_id = j.id${dvv('l.division_id').sql} ORDER BY l.serial_no ASC LIMIT 1) AS batch_group_id,
            (SELECT COALESCE(bg.batch_number, b.parent_batch_number, b.batch_number) FROM qr_labels l JOIN batches b ON l.batch_id = b.id${dvv('b.division_id').sql} LEFT JOIN batch_groups bg ON bg.group_key = b.batch_group_id${dvv('bg.division_id').sql} WHERE l.print_job_id = j.id${dvv('l.division_id').sql} ORDER BY l.serial_no ASC LIMIT 1) AS batch_number,
            ${firstGroupStatus(dvv)} AS batch_status
     FROM qr_print_jobs j
     JOIN products p ON j.product_id = p.id${dvv('p.division_id').sql}
     LEFT JOIN qc_users qc ON j.created_by = qc.id AND j.created_by_role = 'QC'
     LEFT JOIN admins a ON j.created_by = a.id AND j.created_by_role = 'ADMIN'
     ${where}${dv.sql}
     ORDER BY j.created_at DESC
     LIMIT ? OFFSET ?`;
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 25));
  const [countRows] = await query<RowDataPacket[]>(
    `SELECT COUNT(*) AS count FROM qr_print_jobs j ${where}${dv.sql}`,
    [...params, ...dv.params] as any[]
  );
  const items = await query<RowDataPacket[]>(listSql, [...listQuery.divParams, ...params, ...dv.params, limit, (page - 1) * limit] as any[]);
  const total = Number(countRows[0]?.count || 0);
  res.json({ items: items.map(decorateJob), total, page, limit, pages: Math.max(1, Math.ceil(total / limit)) });
}

export async function getById(req: Request, res: Response): Promise<void> {
  const detail = await jobDetail(Number(req.params.id), req.user!.tenantId, req);
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
    const dv = divisionWhere(req);
    const [jobs] = await conn.execute<RowDataPacket[]>(
      `SELECT * FROM qr_print_jobs WHERE id = ? AND tenant_id = ?${dv.sql} FOR UPDATE`,
      [id, req.user!.tenantId, ...dv.params] as any[]
    );
    if (jobs.length === 0) return null;
    const job = jobs[0];

    const [labels] = await conn.execute<RowDataPacket[]>(
      `SELECT * FROM qr_labels WHERE print_job_id = ? AND tenant_id = ?${dv.sql} ORDER BY serial_no ASC FOR UPDATE`,
      [id, req.user!.tenantId, ...dv.params] as any[]
    );
    if (labels.length === 0) return { empty: true as const };
    if (labels.some((label) => Number(label.print_count || 0) > 0)) {
      return { alreadyPrinted: true as const };
    }

    const statusQuery = divisionCollector(req);
    const statusDvv = statusQuery.dvv;
    const dvStatusJ = divisionWhere(req, 'j.division_id');
    const [statusRows] = await conn.execute<RowDataPacket[]>(
      `SELECT ${firstGroupStatus(statusDvv)} AS batch_status
       FROM qr_print_jobs j
       WHERE j.id = ? AND j.tenant_id = ?${dvStatusJ.sql}`,
      [...statusQuery.divParams, id, req.user!.tenantId, ...dvStatusJ.params] as any[]
    );
    const batchStatus = String(statusRows[0]?.batch_status || '').toUpperCase();
    if (!QC_PASSED_STATUSES.has(batchStatus)) {
      return { notReady: true as const, status: batchStatus || 'PENDING_QC' };
    }

    // Print accounting is provisional until the Windows queue confirms the job.
    await conn.execute(
      `UPDATE qr_print_jobs SET print_outcome = 'PENDING', print_confirmed_at = NULL
       WHERE id = ? AND tenant_id = ?`,
      [id, req.user!.tenantId] as any[]
    );
    await conn.execute(
      `UPDATE qr_labels
       SET print_count = 1, last_printed_at = CURRENT_TIMESTAMP(3)
       WHERE print_job_id = ? AND tenant_id = ?${dv.sql}`,
      [id, req.user!.tenantId, ...dv.params] as any[]
    );

    // Mark the batches as "QR printed" so a dispatch order can only be raised
    // for stock whose labels have physically been printed.
    const dvLabelsSub = divisionWhere(req, 'division_id');
    const dvBatch = divisionWhere(req, 'b.division_id');
    await conn.execute(
      `UPDATE batches b
       SET qr_printed_at = CURRENT_TIMESTAMP(3)
       WHERE b.tenant_id = ?
         AND b.id IN (SELECT DISTINCT batch_id FROM qr_labels WHERE print_job_id = ?${dvLabelsSub.sql})${dvBatch.sql}`,
      [req.user!.tenantId, id, ...dvLabelsSub.params, ...dvBatch.params] as any[]
    );

    await conn.execute(
      `INSERT INTO activity_logs (user_id, user_name, user_role, action, description, tenant_id, division_id)
       VALUES (?, ?, ?, 'QR_LABELS_PRINTED', ?, ?, ?)`,
      [
        req.user!.userId,
        req.user!.name,
        req.user!.role,
        `${labels.length} QR label${labels.length === 1 ? '' : 's'} printed for ${job.job_code} after QC passed`,
        req.user!.tenantId,
        divisionStamp(req),
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

  publish(req, 'batch.printed', { jobId: result.jobId, selectedCount: result.selectedIds.length });
  const detail = await jobDetail(result.jobId, req.user!.tenantId, req);
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
    const dv = divisionWhere(req);
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
      `SELECT * FROM qr_print_jobs WHERE id = ? AND tenant_id = ?${dv.sql} FOR UPDATE`,
      [id, req.user!.tenantId, ...dv.params] as any[]
    );
    if (jobs.length === 0) return null;
    const job = jobs[0];

    let labels: RowDataPacket[] = [];
    if (approvedIds !== null) {
      const placeholders = approvedIds.map(() => '?').join(',');
      const [rows] = approvedIds.length ? await conn.query<RowDataPacket[]>(`SELECT * FROM qr_labels WHERE print_job_id = ? AND tenant_id = ? AND id IN (${placeholders})${dv.sql} ORDER BY serial_no ASC FOR UPDATE`, [id, req.user!.tenantId, ...approvedIds, ...dv.params] as any[]) : [[] as any, []] as any;
      labels = rows;
      if (labels.length !== approvedIds.length) return { empty: true as const };
    } else if (requestedIds.length > 0) {
      const placeholders = requestedIds.map(() => '?').join(',');
      const [rows] = await conn.query<RowDataPacket[]>(
        `SELECT * FROM qr_labels
         WHERE print_job_id = ? AND tenant_id = ? AND id IN (${placeholders})${dv.sql}
         ORDER BY serial_no ASC FOR UPDATE`,
        [id, req.user!.tenantId, ...requestedIds, ...dv.params] as any[]
      );
      labels = rows;
    } else {
      const quantity = Number.isInteger(requestedQuantity) && requestedQuantity > 0
        ? Math.min(requestedQuantity, Number(job.quantity))
        : Number(job.quantity);
      const [rows] = await conn.execute<RowDataPacket[]>(
        `SELECT * FROM qr_labels
         WHERE print_job_id = ? AND tenant_id = ?${dv.sql}
         ORDER BY serial_no ASC LIMIT ? FOR UPDATE`,
        [id, req.user!.tenantId, ...(dv.params as any[]), quantity]
      );
      labels = rows;
    }

    if (labels.length === 0) return { empty: true as const };

    for (const label of labels) {
      await conn.execute(
        `UPDATE qr_labels
         SET print_count = print_count + 1, last_printed_at = CURRENT_TIMESTAMP(3)
         WHERE id = ? AND tenant_id = ?${dv.sql}`,
        [label.id, req.user!.tenantId, ...dv.params] as any[]
      );
    }
    if (approvedIds !== null) {
      // An approved reprint request is single use: the print itself consumes
      // the approval, so it can never be replayed for a second copy.
      const [consumed] = await conn.execute<ResultSetHeader>(
        `UPDATE qr_reprint_requests
         SET status = 'FULFILLED', fulfilled_by = ?, fulfilled_by_name = ?, fulfilled_at = CURRENT_TIMESTAMP(3)
         WHERE id = ? AND tenant_id = ? AND status = 'APPROVED'`,
        [String(req.user!.userId), req.user!.name, approvedRequestId, String(req.user!.tenantId)]
      );
      if (consumed.affectedRows !== 1) return { forbidden: true as const };
    }

    await conn.execute(
      `INSERT INTO activity_logs (user_id, user_name, user_role, action, description, tenant_id, division_id)
       VALUES (?, ?, ?, 'QR_CODES_REPRINTED', ?, ?, ?)`,
      [
        req.user!.userId,
        req.user!.name,
        req.user!.role,
        `${labels.length} QR label${labels.length === 1 ? '' : 's'} reprinted for ${job.job_code}`,
        req.user!.tenantId,
        divisionStamp(req),
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
  publish(req, 'batch.printed', { jobId: result.jobId, selectedCount: result.selectedIds.length });
  const detail = await jobDetail(result.jobId, req.user!.tenantId, req);
  const selectedIdSet = new Set(result.selectedIds.map(Number));
  res.json({
    ...(detail ? { job: detail.job, labels: detail.labels.filter((label) => selectedIdSet.has(Number(label.id))) } : {}),
    selected_ids: result.selectedIds,
    selected_count: result.selectedIds.length,
  });
}
