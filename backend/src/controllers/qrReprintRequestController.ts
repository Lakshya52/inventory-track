import { Request, Response } from 'express';
import { execute, getContext, isValidId, query, useMongo } from '../config/database';

export async function createQrReprintRequest(req: Request, res: Response): Promise<void> {
  const jobId = req.params.id;
  const rawIds = Array.isArray(req.body.label_ids) ? req.body.label_ids : [];
  const labelIds = [...new Set(rawIds.map((value: unknown) => String(value).trim()).filter(Boolean))].slice(0, 1000);
  if (!isValidId(jobId) || labelIds.length === 0 || labelIds.some((id) => !isValidId(id))) { res.status(400).json({ error: 'Select valid QR labels to reprint.' }); return; }
  if (useMongo) {
    const ctx = await getContext();
    const job = await ctx.findOne('qr_print_jobs', { id: jobId }, { projection: { id: 1, job_code: 1 } });
    if (!job) { res.status(404).json({ error: 'QR print job not found.' }); return; }
    const labels = await ctx.find('qr_labels', { print_job_id: job.id, id: { $in: labelIds } }, { projection: { id: 1 } });
    if (labels.length !== labelIds.length) { res.status(400).json({ error: 'One or more selected labels do not belong to this print job.' }); return; }
    const matchedIds = labels.map((label: any) => String(label.id));
    const requestId = await ctx.insert('qr_reprint_requests', { tenant_id: req.user!.tenantId, qr_job_id: job.id, job_code: job.job_code, label_ids: matchedIds, requested_count: matchedIds.length, requested_by: req.user!.userId, requested_by_name: req.user!.name, status: 'PENDING', requested_at: new Date() });
    await ctx.insert('activity_logs', {
      user_id: req.user!.userId,
      user_name: req.user!.name,
      user_role: req.user!.role,
      action: 'QR_REPRINT_REQUESTED',
      description: `Reprint requested for ${matchedIds.length} label(s) of ${job.job_code}`,
    });
    res.status(201).json({ id: requestId, status: 'PENDING', requested_count: matchedIds.length });
    return;
  }
  const jobs = await query<any[]>('SELECT id, job_code FROM qr_print_jobs WHERE id = ? LIMIT 1', [jobId]);
  if (!jobs.length) { res.status(404).json({ error: 'QR print job not found.' }); return; }
  const placeholders = labelIds.map(() => '?').join(',');
  const labels = await query<any[]>(`SELECT id FROM qr_labels WHERE print_job_id = ? AND id IN (${placeholders})`, [jobs[0].id, ...labelIds]);
  if (labels.length !== labelIds.length) { res.status(400).json({ error: 'One or more selected labels do not belong to this print job.' }); return; }
  const matchedIds = labels.map((label: any) => String(label.id));
  const result = await execute('INSERT INTO qr_reprint_requests (tenant_id, qr_job_id, job_code, label_ids, requested_count, requested_by, requested_by_name, status) VALUES (?, ?, ?, ?, ?, ?, ?, \'PENDING\')', [String(req.user!.tenantId), String(jobs[0].id), jobs[0].job_code, JSON.stringify(matchedIds), matchedIds.length, String(req.user!.userId), req.user!.name]);
  await execute(
    'INSERT INTO activity_logs (user_id, user_name, user_role, action, description) VALUES (?, ?, ?, \'QR_REPRINT_REQUESTED\', ?)',
    [String(req.user!.userId), req.user!.name, req.user!.role, `Reprint requested for ${matchedIds.length} label(s) of ${jobs[0].job_code}`]
  );
  res.status(201).json({ id: result.insertId, status: 'PENDING', requested_count: matchedIds.length });
}

export async function listQrReprintRequests(req: Request, res: Response): Promise<void> {
  const isAdmin = req.user?.role === 'ADMIN';
  const status = String(req.query.status || (isAdmin ? 'PENDING' : 'ALL')).toUpperCase();
  const ownerFilter = isAdmin ? {} : { requested_by: req.user!.userId };
  if (useMongo) {
    const ctx = await getContext();
    res.json(await ctx.find('qr_reprint_requests', { tenant_id: req.user!.tenantId, ...ownerFilter, ...(status === 'ALL' ? {} : { status }) }, { sort: { requested_at: -1 }, limit: 100, projection: { _id: 0 } }));
    return;
  }
  const where = [`tenant_id = ?`];
  const params: any[] = [String(req.user!.tenantId)];
  if (!isAdmin) { where.push('requested_by = ?'); params.push(String(req.user!.userId)); }
  if (status !== 'ALL') { where.push('status = ?'); params.push(status); }
  const rows = await query<any[]>(`SELECT * FROM qr_reprint_requests WHERE ${where.join(' AND ')} ORDER BY requested_at DESC LIMIT 100`, params);
  res.json(rows.map((row) => ({ ...row, label_ids: JSON.parse(row.label_ids || '[]') })));
}

export async function completeQrReprintRequest(req: Request, res: Response): Promise<void> {
  const id = req.params.requestId;
  if (!isValidId(id)) { res.status(400).json({ error: 'Invalid reprint request id.' }); return; }
  const isAdmin = req.user?.role === 'ADMIN';
  const ownerFilter = isAdmin ? {} : { requested_by: req.user!.userId };
  if (useMongo) {
    const ctx = await getContext();
    // Printing already consumes the approval, so a request that is already
    // fulfilled is simply reported as done instead of failing.
    const alreadyDone = await ctx.findOne('qr_reprint_requests', { id, tenant_id: req.user!.tenantId, status: 'FULFILLED', ...ownerFilter });
    if (alreadyDone) { res.json({ id, status: 'FULFILLED' }); return; }
    const request = await ctx.findOne('qr_reprint_requests', { id, tenant_id: req.user!.tenantId, status: 'APPROVED', ...ownerFilter });
    if (!request) { res.status(404).json({ error: 'Approved reprint request not found.' }); return; }
    const labelIds = Array.isArray(request.label_ids) ? request.label_ids : [];
    for (const labelId of labelIds) await ctx.updateOne('qr_labels', { id: labelId, print_job_id: request.qr_job_id }, { $inc: { print_count: 1 }, $set: { last_printed_at: new Date() } });
    const updated = await ctx.updateOne('qr_reprint_requests', { id, tenant_id: req.user!.tenantId, status: 'APPROVED', ...ownerFilter }, { $set: { status: 'FULFILLED', fulfilled_by: req.user!.userId, fulfilled_by_name: req.user!.name, fulfilled_at: new Date() } });
    if (!updated.matchedCount) { res.status(404).json({ error: 'Approved reprint request not found.' }); return; }
  } else {
    const ownerClause = isAdmin ? '' : ' AND requested_by = ?';
    // Printing already consumes the approval, so a request that is already
    // fulfilled is simply reported as done instead of failing.
    const alreadyDone = await query<any[]>(`SELECT * FROM qr_reprint_requests WHERE id = ? AND tenant_id = ? AND status = 'FULFILLED'${ownerClause} LIMIT 1`, [id, String(req.user!.tenantId), ...(isAdmin ? [] : [String(req.user!.userId)])]);
    if (alreadyDone.length) { res.json({ id, status: 'FULFILLED' }); return; }
    const requestRows = await query<any[]>(`SELECT * FROM qr_reprint_requests WHERE id = ? AND tenant_id = ? AND status = 'APPROVED'${ownerClause} LIMIT 1`, [id, String(req.user!.tenantId), ...(isAdmin ? [] : [String(req.user!.userId)])]);
    if (!requestRows.length) { res.status(404).json({ error: 'Approved reprint request not found.' }); return; }
    const request = requestRows[0];
    let labelIds: any[] = [];
    try { labelIds = JSON.parse(request.label_ids || '[]'); } catch { labelIds = []; }
    if (labelIds.length) {
      const placeholders = labelIds.map(() => '?').join(',');
      await execute(`UPDATE qr_labels SET print_count = print_count + 1, last_printed_at = CURRENT_TIMESTAMP(3) WHERE print_job_id = ? AND id IN (${placeholders})`, [request.qr_job_id, ...labelIds]);
    }
    const updated = await execute(`UPDATE qr_reprint_requests SET status = 'FULFILLED', fulfilled_by = ?, fulfilled_by_name = ?, fulfilled_at = CURRENT_TIMESTAMP(3) WHERE id = ? AND tenant_id = ? AND status = 'APPROVED'${ownerClause}`, [String(req.user!.userId), req.user!.name, id, String(req.user!.tenantId), ...(isAdmin ? [] : [String(req.user!.userId)])]);
    if (!updated.affectedRows) { res.status(404).json({ error: 'Approved reprint request not found.' }); return; }
  }
  res.json({ id, status: 'FULFILLED' });
}

export async function reviewQrReprintRequest(req: Request, res: Response): Promise<void> {
  const id = req.params.requestId;
  const decision = String(req.body?.decision || '').toUpperCase();
  const note = typeof req.body?.note === 'string' ? req.body.note.trim().slice(0, 500) : '';
  if (!isValidId(id) || !['APPROVED', 'REJECTED'].includes(decision)) {
    res.status(400).json({ error: 'Choose approve or reject for a valid request.' }); return;
  }
  const reviewFields = {
    status: decision,
    reviewed_by: req.user!.userId,
    reviewed_by_name: req.user!.name,
    reviewed_at: new Date(),
    review_note: note || null,
  };
  if (useMongo) {
    const ctx = await getContext();
    const updated = await ctx.updateOne('qr_reprint_requests', { id, tenant_id: req.user!.tenantId, status: 'PENDING' }, { $set: reviewFields });
    if (!updated.matchedCount) { res.status(404).json({ error: 'Pending reprint request not found.' }); return; }
    await ctx.insert('activity_logs', {
      user_id: req.user!.userId,
      user_name: req.user!.name,
      user_role: req.user!.role,
      action: decision === 'APPROVED' ? 'QR_REPRINT_APPROVED' : 'QR_REPRINT_REJECTED',
      description: `Reprint request #${id} ${decision.toLowerCase()}${note ? `: ${note}` : ''}`,
    });
  } else {
    const updated = await execute('UPDATE qr_reprint_requests SET status = ?, reviewed_by = ?, reviewed_by_name = ?, reviewed_at = CURRENT_TIMESTAMP(3), review_note = ? WHERE id = ? AND tenant_id = ? AND status = \'PENDING\'', [decision, String(req.user!.userId), req.user!.name, note || null, id, String(req.user!.tenantId)]);
    if (!updated.affectedRows) { res.status(404).json({ error: 'Pending reprint request not found.' }); return; }
    await execute(
      'INSERT INTO activity_logs (user_id, user_name, user_role, action, description) VALUES (?, ?, ?, ?, ?)',
      [String(req.user!.userId), req.user!.name, req.user!.role, decision === 'APPROVED' ? 'QR_REPRINT_APPROVED' : 'QR_REPRINT_REJECTED', `Reprint request #${id} ${decision.toLowerCase()}${note ? `: ${note}` : ''}`]
    );
  }
  res.json({ id, status: decision });
}
