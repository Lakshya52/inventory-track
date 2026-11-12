import { Request, Response } from 'express';
import { DbContext, getContext, idKey, isValidId, now, withTransaction } from '../config/database';
import { contains, EntityId, mapByIds } from '../services/queryService';

const QC_PASSED_STATUSES = new Set([
  'QC_PASSED',
  'DISPATCH_ORDER_RAISED',
  'DISPATCH_APPROVED',
  'LOADING',
  'DISPATCHED',
]);

async function jobStats(
  ctx: DbContext,
  jobIds: EntityId[]
): Promise<Map<string, { total_prints: number; label_count: number; last_printed_at: Date | null }>> {
  if (jobIds.length === 0) return new Map();
  const rows = await ctx.aggregate('qr_labels', [
    { $match: { print_job_id: { $in: jobIds } } },
    {
      $group: {
        _id: '$print_job_id',
        total_prints: { $sum: { $ifNull: ['$print_count', 0] } },
        label_count: { $sum: 1 },
        last_printed_at: { $max: '$last_printed_at' },
      },
    },
  ]);
  return new Map(rows.map((row) => [
    idKey(row._id),
    {
      total_prints: Number(row.total_prints || 0),
      label_count: Number(row.label_count || 0),
      last_printed_at: row.last_printed_at || null,
    },
  ]));
}

async function enrichJobs(ctx: DbContext, jobs: Record<string, any>[]): Promise<Record<string, any>[]> {
  const products = await mapByIds<Record<string, any>>(
    ctx,
    'products',
    jobs.map((job) => job.product_id)
  );
  const qcCreators = await mapByIds<Record<string, any>>(
    ctx,
    'qc_users',
    jobs.filter((job) => job.created_by_role === 'QC').map((job) => job.created_by)
  );
  const adminCreators = await mapByIds<Record<string, any>>(
    ctx,
    'admins',
    jobs.filter((job) => job.created_by_role === 'ADMIN').map((job) => job.created_by)
  );
  const stats = await jobStats(ctx, jobs.map((job) => job.id));

  const jobIds = jobs.map((job) => job.id);
  const firstLabels = jobIds.length
    ? await ctx.aggregate('qr_labels', [
        { $match: { print_job_id: { $in: jobIds } } },
        { $sort: { serial_no: 1 } },
        {
          $group: {
            _id: '$print_job_id',
            batch_id: { $first: '$batch_id' },
            printed_count: {
              $sum: { $cond: [{ $gt: [{ $ifNull: ['$print_count', 0] }, 0] }, 1, 0] },
            },
          },
        },
      ])
    : [];
  const batches = await mapByIds<Record<string, any>>(
    ctx,
    'batches',
    firstLabels.map((row) => row.batch_id)
  );
  const groupKeys = [...new Set(
    [...batches.values()]
      .map((batch) => batch.batch_group_id)
      .filter((key) => key !== null && key !== undefined && key !== '')
  )];
  const groupRows = groupKeys.length
    ? await ctx.find('batch_groups', { group_key: { $in: groupKeys } }, {
        projection: { _id: 0, group_key: 1, batch_number: 1, status: 1 },
      })
    : [];
  const groupsByKey = new Map(groupRows.map((group) => [String(group.group_key), group]));
  const labelInfoByJob = new Map(firstLabels.map((row) => [idKey(row._id), row]));

  return jobs.map((job) => {
    const product = products.get(idKey(job.product_id));
    const creator = job.created_by_role === 'ADMIN'
      ? adminCreators.get(idKey(job.created_by))
      : qcCreators.get(idKey(job.created_by));
    const jobStat = stats.get(idKey(job.id));
    const labelInfo = labelInfoByJob.get(idKey(job.id));
    const batch = labelInfo ? batches.get(idKey(labelInfo.batch_id)) : undefined;
    const group = batch?.batch_group_id ? groupsByKey.get(String(batch.batch_group_id)) : undefined;
    const batchStatus = String(group?.status || batch?.status || '').toUpperCase();
    const printedCount = Number(labelInfo?.printed_count || 0);
    return {
      ...job,
      product_name: product?.name ?? null,
      product_sku: product?.sku ?? null,
      created_by_name: creator?.name ?? 'QC User',
      total_prints: jobStat?.total_prints ?? 0,
      label_count: jobStat?.label_count ?? 0,
      last_printed_at: jobStat?.last_printed_at ?? null,
      batch_group_id: batch?.batch_group_id ?? null,
      batch_number: group?.batch_number ?? batch?.parent_batch_number ?? batch?.batch_number ?? null,
      batch_status: batchStatus || null,
      printed_count: printedCount,
      labels_printed: printedCount > 0,
      qc_ready: QC_PASSED_STATUSES.has(batchStatus),
      can_print_initial: printedCount === 0 && QC_PASSED_STATUSES.has(batchStatus),
    };
  });
}

async function jobDetail(
  id: EntityId,
  tenantId?: EntityId
): Promise<{ job: Record<string, any>; labels: Record<string, any>[] } | null> {
  const ctx = await getContext();
  const jobFilter: Record<string, any> = { id };
  if (tenantId !== undefined && tenantId !== null) jobFilter.tenant_id = tenantId;
  const job = await ctx.findOne('qr_print_jobs', jobFilter, { projection: { _id: 0 } });
  if (!job) return null;

  const [enrichedJob] = await enrichJobs(ctx, [job]);
  const labels = await ctx.find('qr_labels', { print_job_id: id }, {
    sort: { serial_no: 1 },
    projection: { _id: 0 },
  });
  const batches = await mapByIds<Record<string, any>>(
    ctx,
    'batches',
    labels.map((label) => label.batch_id)
  );
  const products = await mapByIds<Record<string, any>>(
    ctx,
    'products',
    labels.map((label) => batches.get(idKey(label.batch_id))?.product_id)
  );
  const locations = await mapByIds<Record<string, any>>(
    ctx,
    'shelf_locations',
    labels.map((label) => batches.get(idKey(label.batch_id))?.shelf_location_id)
  );

  return {
    job: enrichedJob,
    labels: labels.map((label) => {
      const batch = batches.get(idKey(label.batch_id));
      const product = products.get(idKey(batch?.product_id));
      const location = locations.get(idKey(batch?.shelf_location_id));
      return {
        ...label,
        batch_number: batch?.parent_batch_number ?? batch?.batch_number ?? null,
        child_batch_number: batch?.batch_number ?? null,
        status: batch?.status ?? null,
        quantity: job.quantity ?? batch?.quantity ?? null,
        package_quantity: batch?.package_quantity ?? null,
        uom: batch?.uom ?? null,
        product_name: product?.name ?? null,
        product_sku: product?.sku ?? null,
        warehouse_name: location?.warehouse ?? null,
        storage_location_id: batch?.shelf_location_id ?? null,
        storage_location: location?.location_code ?? batch?.storage_location ?? null,
      };
    }),
  };
}

export async function create(_req: Request, res: Response): Promise<void> {
  res.status(410).json({
    error: 'QR labels are generated with each batch. Dispatch prints them after QC passes.',
  });
}

export async function printInitial(req: Request, res: Response): Promise<void> {
  const id = req.params.id;
  if (!isValidId(id)) {
    res.status(400).json({ error: 'Invalid QR label job id' });
    return;
  }

  const result = await withTransaction(async (ctx: DbContext) => {
    const job = await ctx.findOne('qr_print_jobs', { id, tenant_id: req.user!.tenantId }, { projection: { _id: 0 } });
    if (!job) return null;

    const labels = await ctx.find('qr_labels', { print_job_id: id }, {
      sort: { serial_no: 1 },
      projection: { _id: 0 },
    });
    if (labels.length === 0) return { empty: true as const };
    if (labels.some((label) => Number(label.print_count || 0) > 0)) {
      return { alreadyPrinted: true as const };
    }

    const firstBatch = labels[0].batch_id
      ? await ctx.findOne('batches', { id: labels[0].batch_id }, { projection: { _id: 0 } })
      : null;
    const group = firstBatch?.batch_group_id
      ? await ctx.findOne('batch_groups', { group_key: firstBatch.batch_group_id }, {
          projection: { _id: 0, group_key: 1, batch_number: 1, status: 1 },
        })
      : null;
    const batchStatus = String(group?.status || firstBatch?.status || '').toUpperCase();
    if (!QC_PASSED_STATUSES.has(batchStatus)) {
      return { notReady: true as const, status: batchStatus || 'PENDING_QC' };
    }

    for (const label of labels) {
      await ctx.updateOne('qr_labels', { id: label.id }, {
        $set: { print_count: 1, last_printed_at: now() },
      });
    }

    // Mark the batches as "QR printed" so a dispatch order can only be raised
    // for stock whose labels have physically been printed.
    const printedAt = now();
    const printedBatchIds = [...new Set(
      labels.map((label) => label.batch_id).filter((batchId) => batchId !== null && batchId !== undefined)
    )];
    for (const batchId of printedBatchIds) {
      await ctx.updateOne('batches', { id: batchId }, {
        $set: { qr_printed_at: printedAt },
      });
    }

    await ctx.insert('activity_logs', {
      user_id: req.user!.userId,
      user_name: req.user!.name,
      user_role: req.user!.role,
      action: 'QR_LABELS_PRINTED',
      description: `${labels.length} QR label${labels.length === 1 ? '' : 's'} printed for ${job.job_code} after QC passed`,
    });

    return { jobId: id, selectedIds: labels.map((label) => label.id as EntityId) };
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

  const detail = await jobDetail(result.jobId);
  const selectedIdSet = new Set(result.selectedIds.map(idKey));
  res.json({
    ...(detail ? { job: detail.job, labels: detail.labels.filter((label) => selectedIdSet.has(idKey(label.id))) } : {}),
    selected_ids: result.selectedIds,
    selected_count: result.selectedIds.length,
  });
}

export async function list(req: Request, res: Response): Promise<void> {
  const q = String(req.query.q || '').trim();
  const ctx = await getContext();

  // Print jobs are tenant-scoped: a workspace never sees another one's jobs.
  const filter: Record<string, any> = { tenant_id: req.user!.tenantId };
  if (q) {
    // Only job codes and label QR values are searchable. Product names are
    // intentionally excluded: one product can own thousands of QR labels, so a
    // name match floods the list instead of finding the scanned label.
    const qrLabels = q.length >= 8
      ? await ctx.find('qr_labels', { qr_value: contains(q) }, {
          limit: 50,
          projection: { print_job_id: 1 },
        })
      : [];
    const qrJobIds = qrLabels
      .map((label) => label.print_job_id)
      .filter((id) => id !== null && id !== undefined);
    filter.$or = [
      { job_code: contains(q) },
      ...(qrJobIds.length > 0 ? [{ id: { $in: qrJobIds.map(idKey) } }] : []),
    ];
  }

  const jobs = await ctx.find('qr_print_jobs', filter, {
    sort: { created_at: -1 },
    limit: 100,
    projection: { _id: 0 },
  });
  const items = await enrichJobs(ctx, jobs);
  res.json({ items, total: items.length });
}

export async function getById(req: Request, res: Response): Promise<void> {
  if (!isValidId(req.params.id)) {
    res.status(400).json({ error: 'Invalid QR label job id' });
    return;
  }
  const detail = await jobDetail(req.params.id, req.user!.tenantId);
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
  const id = req.params.id;
  if (!isValidId(id)) {
    res.status(400).json({ error: 'Invalid QR label job id' });
    return;
  }
  const requestedQuantity = Number(req.body.quantity);
  const requestedIds: EntityId[] = Array.isArray(req.body.label_ids)
    ? req.body.label_ids.filter((value: any) => isValidId(value))
    : [];
  const approvedRequestId = req.body.approved_request_id ? String(req.body.approved_request_id) : '';
  const isAdmin = req.user?.role === 'ADMIN';
  if (!isAdmin && !approvedRequestId) {
    res.status(403).json({ error: 'An administrator-approved reprint request is required.' });
    return;
  }

  const result = await withTransaction(async (ctx: DbContext) => {
    let approvedRequest: Record<string, any> | null = null;
    if (approvedRequestId) {
      approvedRequest = await ctx.findOne('qr_reprint_requests', {
        id: approvedRequestId,
        tenant_id: req.user!.tenantId,
        qr_job_id: id,
        status: 'APPROVED',
        ...(isAdmin ? {} : { requested_by: req.user!.userId }),
      });
      if (!approvedRequest) return { forbidden: true as const };
    }
    const job = await ctx.findOne('qr_print_jobs', { id, tenant_id: req.user!.tenantId }, { projection: { _id: 0 } });
    if (!job) return null;

    let labels: Record<string, any>[];
    if (approvedRequest) {
      const approvedIds = Array.isArray(approvedRequest.label_ids) ? approvedRequest.label_ids : [];
      labels = approvedIds.length ? await ctx.find('qr_labels', {
        print_job_id: id,
        id: { $in: approvedIds },
      }, { sort: { serial_no: 1 }, projection: { _id: 0 } }) : [];
      if (labels.length !== approvedIds.length) return { empty: true as const };
    } else if (requestedIds.length > 0) {
      labels = await ctx.find('qr_labels', {
        print_job_id: id,
        id: { $in: requestedIds },
      }, {
        sort: { serial_no: 1 },
        projection: { _id: 0 },
      });
    } else {
      const quantity = Number.isInteger(requestedQuantity) && requestedQuantity > 0
        ? Math.min(requestedQuantity, Number(job.quantity))
        : Number(job.quantity);
      labels = await ctx.find('qr_labels', { print_job_id: id }, {
        sort: { serial_no: 1 },
        limit: quantity,
        projection: { _id: 0 },
      });
    }

    if (labels.length === 0) return { empty: true as const };

    if (!approvedRequest) for (const label of labels) {
      await ctx.updateOne('qr_labels', { id: label.id }, {
        $inc: { print_count: 1 },
        $set: { last_printed_at: now() },
      });
    } else {
      // An approved reprint request is single use: the print itself consumes
      // the approval, so it can never be replayed for a second copy.
      for (const label of labels) {
        await ctx.updateOne('qr_labels', { id: label.id }, {
          $inc: { print_count: 1 },
          $set: { last_printed_at: now() },
        });
      }
      const consumed = await ctx.updateOne(
        'qr_reprint_requests',
        { id: approvedRequest.id, status: 'APPROVED' },
        {
          $set: {
            status: 'FULFILLED',
            fulfilled_by: req.user!.userId,
            fulfilled_by_name: req.user!.name,
            fulfilled_at: now(),
          },
        }
      );
      if (consumed.matchedCount !== 1) {
        return { forbidden: true as const };
      }
    }

    await ctx.insert('activity_logs', {
      user_id: req.user!.userId,
      user_name: req.user!.name,
      user_role: req.user!.role,
      action: 'QR_CODES_REPRINTED',
      description: `${labels.length} QR label${labels.length === 1 ? '' : 's'} reprinted for ${job.job_code}`,
    });
    return { jobId: id, selectedIds: labels.map((label) => label.id as EntityId) };
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
  const selectedIdSet = new Set(result.selectedIds.map(idKey));
  res.json({
    ...(detail ? { job: detail.job, labels: detail.labels.filter((label) => selectedIdSet.has(idKey(label.id))) } : {}),
    selected_ids: result.selectedIds,
    selected_count: result.selectedIds.length,
  });
}
