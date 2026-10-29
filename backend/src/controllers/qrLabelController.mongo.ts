import { Request, Response } from 'express';
import { randomBytes, randomUUID } from 'crypto';
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

export async function create(req: Request, res: Response): Promise<void> {
  const productId = req.body.product_id as EntityId;
  const quantity = Number(req.body.quantity);
  const batchId = req.body.batch_id ? (req.body.batch_id as EntityId) : null;

  if (!isValidId(productId)) {
    res.status(400).json({ error: 'Select a valid product' });
    return;
  }
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 10_000) {
    res.status(400).json({ error: 'Quantity must be a whole number between 1 and 10,000' });
    return;
  }
  if (batchId !== null && !isValidId(batchId)) {
    res.status(400).json({ error: 'Invalid batch id' });
    return;
  }

  const ctx = await getContext();
  const product = await ctx.findOne('products', { id: productId }, {
    projection: { _id: 0, id: 1, name: 1, sku: 1 },
  });
  if (!product) {
    res.status(404).json({ error: 'Product not found' });
    return;
  }

  const jobCode = `QRJ-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${randomBytes(3).toString('hex').toUpperCase()}`;
  const result = await withTransaction(async (tx: DbContext) => {
    const jobId = await tx.insert('qr_print_jobs', {
      job_code: jobCode,
      product_id: productId,
      quantity,
      batch_id: batchId,
      created_by: req.user!.userId,
      created_by_role: req.user!.role,
    });
    const labelDocuments = Array.from({ length: quantity }, (_, index) => ({
      print_job_id: jobId,
      batch_id: batchId,
      qr_value: `QR:${randomUUID()}`,
      serial_no: index + 1,
      print_count: 1,
      last_printed_at: now(),
    }));
    const labelIds = await tx.insertMany('qr_labels', labelDocuments);
    await tx.insert('activity_logs', {
      user_id: req.user!.userId,
      user_name: req.user!.name,
      user_role: req.user!.role,
      action: 'QR_JOB_CREATED',
      description: `${quantity} QR label${quantity === 1 ? '' : 's'} created for ${product.name}`,
    });
    return {
      jobId,
      labels: labelDocuments.map((label, index) => ({
        id: labelIds[index],
        qr_value: label.qr_value,
        serial_no: label.serial_no,
        batch_id: label.batch_id,
        print_count: label.print_count,
        last_printed_at: label.last_printed_at,
      })),
    };
  });

  res.status(201).json({
    job: {
      id: result.jobId,
      job_code: jobCode,
      product_id: productId,
      product_name: product.name,
      product_sku: product.sku,
      quantity,
      batch_id: batchId,
      created_by: req.user!.userId,
      created_by_role: req.user!.role,
    },
    labels: result.labels,
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
