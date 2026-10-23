import { Request, Response } from 'express';
import { randomBytes } from 'crypto';
import { RowDataPacket } from 'mysql2';
import { query, withTransaction } from '../config/database';

function todayCode(): string {
  return new Date().toISOString().slice(0, 10).replace(/-/g, '');
}

function jobCode(): string {
  return `QRJ-${todayCode()}-${randomBytes(3).toString('hex').toUpperCase()}`;
}

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
    `SELECT l.*, b.batch_number, b.status, b.quantity, b.uom
     FROM qr_labels l
     JOIN batches b ON l.batch_id = b.id
     WHERE l.print_job_id = ?
     ORDER BY l.serial_no ASC`,
    [id]
  );
  return { job: jobs[0], labels };
}

export async function create(req: Request, res: Response): Promise<void> {
  const productId = Number(req.body.product_id);
  const quantity = Number(req.body.quantity);
  if (!Number.isInteger(productId) || productId <= 0) {
    res.status(400).json({ error: 'Select a product' });
    return;
  }
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 1000) {
    res.status(400).json({ error: 'Quantity must be a whole number between 1 and 1000' });
    return;
  }

  const products = await query<RowDataPacket[]>(
    'SELECT id, name, sku, price FROM products WHERE id = ?',
    [productId]
  );
  if (products.length === 0) {
    res.status(404).json({ error: 'Product not found' });
    return;
  }
  const product = products[0];
  const code = jobCode();
  const date = todayCode();

  const result = await withTransaction(async (conn) => {
    const [job] = await conn.execute<any>(
      `INSERT INTO qr_print_jobs (job_code, product_id, quantity, created_by, created_by_role)
       VALUES (?, ?, ?, ?, ?)`,
      [code, productId, quantity, req.user!.userId, req.user!.role]
    );
    const jobId = Number(job.insertId);

    for (let serial = 1; serial <= quantity; serial += 1) {
      const serialText = String(serial).padStart(4, '0');
      const barcode = `QR:${product.sku}:${code}:${serialText}`;
      const batchNumber = `${String(product.sku).slice(0, 30)}-${date}-${code.slice(-6)}-${serialText}`;
      const [batch] = await conn.execute<any>(
        `INSERT INTO batches
          (product_id, batch_number, quantity, uom, unit_price, storage_location, notes,
           status, barcode_value)
         VALUES (?, ?, 1, 'pcs', ?, NULL, ?, 'CREATED', ?)`,
        [
          productId,
          batchNumber,
          Number(product.price || 0),
          `QR label job ${code} / label ${serial}`,
          barcode,
        ]
      );
      await conn.execute(
        `INSERT INTO qr_labels
          (print_job_id, batch_id, qr_value, serial_no, print_count, last_printed_at)
         VALUES (?, ?, ?, ?, 1, CURRENT_TIMESTAMP(3))`,
        [jobId, batch.insertId, barcode, serial]
      );
    }

    await conn.execute(
      `INSERT INTO activity_logs (user_id, user_name, user_role, action, description)
       VALUES (?, ?, ?, 'QR_CODES_GENERATED', ?)`,
      [
        req.user!.userId,
        req.user!.name,
        req.user!.role,
        `${quantity} QR labels generated for ${product.name} (${code})`,
      ]
    );
    return { jobId, code };
  });

  const detail = await jobDetail(result.jobId);
  res.status(201).json(detail);
}

export async function list(req: Request, res: Response): Promise<void> {
  const q = String(req.query.q || '').trim();
  const where = q ? 'WHERE p.name LIKE ? OR p.sku LIKE ? OR j.job_code LIKE ?' : '';
  const params = q ? [`%${q}%`, `%${q}%`, `%${q}%`] : [];
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
  res.json(detail);
}

export async function reprint(req: Request, res: Response): Promise<void> {
  const id = Number(req.params.id);
  const requestedQuantity = Number(req.body.quantity);
  const requestedIds = Array.isArray(req.body.label_ids)
    ? req.body.label_ids.map((value: any) => Number(value)).filter((value: number) => Number.isInteger(value) && value > 0)
    : [];

  const result = await withTransaction(async (conn) => {
    const [jobs] = await conn.execute<RowDataPacket[]>(
      'SELECT * FROM qr_print_jobs WHERE id = ? FOR UPDATE',
      [id]
    );
    if (jobs.length === 0) return null;
    const job = jobs[0];

    let labels: RowDataPacket[] = [];
    if (requestedIds.length > 0) {
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
