import { Request, Response } from 'express';
import { DbContext, getContext, idKey, isValidId, now, withTransaction } from '../config/database';
import { contains, EntityId, mapByIds } from '../services/queryService';

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

  return jobs.map((job) => {
    const product = products.get(idKey(job.product_id));
    const creator = job.created_by_role === 'ADMIN'
      ? adminCreators.get(idKey(job.created_by))
      : qcCreators.get(idKey(job.created_by));
    const jobStat = stats.get(idKey(job.id));
    return {
      ...job,
      product_name: product?.name ?? null,
      product_sku: product?.sku ?? null,
      created_by_name: creator?.name ?? 'QC User',
      total_prints: jobStat?.total_prints ?? 0,
      label_count: jobStat?.label_count ?? 0,
      last_printed_at: jobStat?.last_printed_at ?? null,
    };
  });
}

async function jobDetail(id: EntityId): Promise<{ job: Record<string, any>; labels: Record<string, any>[] } | null> {
  const ctx = await getContext();
  const job = await ctx.findOne('qr_print_jobs', { id }, { projection: { _id: 0 } });
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

  return {
    job: enrichedJob,
    labels: labels.map((label) => {
      const batch = batches.get(idKey(label.batch_id));
      return {
        ...label,
        batch_number: batch?.batch_number ?? null,
        status: batch?.status ?? null,
        quantity: batch?.quantity ?? null,
        uom: batch?.uom ?? null,
      };
    }),
  };
}

export async function create(_req: Request, res: Response): Promise<void> {
  res.status(410).json({
    error: 'QR labels are generated automatically when QC completes finished-goods details for a passed batch.',
  });
}

export async function list(req: Request, res: Response): Promise<void> {
  const q = String(req.query.q || '').trim();
  const ctx = await getContext();

  const filter: Record<string, any> = {};
  if (q) {
    const products = await ctx.find('products', {
      $or: [{ name: contains(q) }, { sku: contains(q) }],
    }, { projection: { id: 1 } });
    filter.$or = [
      { product_id: { $in: products.map((product) => idKey(product.id)) } },
      { job_code: contains(q) },
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
  const detail = await jobDetail(req.params.id);
  if (!detail) {
    res.status(404).json({ error: 'QR label job not found' });
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

  const result = await withTransaction(async (ctx: DbContext) => {
    const job = await ctx.findOne('qr_print_jobs', { id }, { projection: { _id: 0 } });
    if (!job) return null;

    let labels: Record<string, any>[];
    if (requestedIds.length > 0) {
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

    for (const label of labels) {
      await ctx.updateOne('qr_labels', { id: label.id }, {
        $inc: { print_count: 1 },
        $set: { last_printed_at: now() },
      });
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
  if ('empty' in result) {
    res.status(400).json({ error: 'No labels were selected for reprint' });
    return;
  }
  const detail = await jobDetail(result.jobId);
  res.json({
    ...(detail || {}),
    selected_ids: result.selectedIds,
    selected_count: result.selectedIds.length,
  });
}
