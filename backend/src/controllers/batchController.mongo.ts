import { Request, Response } from 'express';
import { randomBytes, randomUUID } from 'crypto';
import { getContext, now, parseDateValue, withTransaction } from '../config/database';
import { batchQrStats, contains, mapByIds } from '../services/queryService';

export async function create(req: Request, res: Response): Promise<void> {
  const { product_id, batch_number, quantity, uom, unit_price, manufacturing_date, expiry_date, shelf_location_id, storage_location, notes } = req.body;
  if (!product_id || !batch_number) {
    res.status(400).json({ error: 'Product ID and batch number are required' });
    return;
  }
  if (!manufacturing_date || !expiry_date) {
    res.status(400).json({ error: 'Manufacturing date and expiry date are required' });
    return;
  }
  const labelCount = Number(quantity);
  if (!Number.isInteger(labelCount) || labelCount < 1 || labelCount > 1000) {
    res.status(400).json({ error: 'Batch quantity must be a whole number between 1 and 1000 because one QR label is generated per unit' });
    return;
  }
  const ctx = await getContext();
  const product = await ctx.findOne('products', { id: Number(product_id) }, {
    projection: { _id: 0, id: 1, name: 1, sku: 1, price: 1 },
  });
  if (!product) { res.status(404).json({ error: 'Product not found' }); return; }

  const existing = await ctx.findOne('batches', { batch_number }, { projection: { id: 1 } });
  if (existing) { res.status(409).json({ error: `Batch number "${batch_number}" already exists` }); return; }
  if (shelf_location_id) {
    const location = await ctx.findOne('shelf_locations', { id: Number(shelf_location_id), is_active: 1 }, { projection: { id: 1 } });
    if (!location) { res.status(400).json({ error: 'Select an active shelf location' }); return; }
  }

  const jobCode = `QRJ-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${randomBytes(3).toString('hex').toUpperCase()}`;
  const result = await withTransaction(async (tx) => {
    const batchId = await tx.insert('batches', {
      product_id: Number(product_id),
      batch_number,
      quantity: labelCount,
      uom: 'pcs',
      unit_price: Number(unit_price) || 0,
      manufacturing_date: parseDateValue(manufacturing_date),
      expiry_date: parseDateValue(expiry_date),
      shelf_location_id: shelf_location_id || null,
      storage_location: storage_location || null,
      notes: notes || null,
      status: 'CREATED',
      barcode_value: `_TEMP_${randomUUID()}`,
    });
    const jobId = await tx.insert('qr_print_jobs', {
      job_code: jobCode,
      product_id: Number(product_id),
      quantity: labelCount,
      created_by: req.user!.userId,
      created_by_role: 'ADMIN',
    });

    let firstBarcode = '';
    const labelDocuments = Array.from({ length: labelCount }, (_, index) => {
      const serial = index + 1;
      const qrValue = `QR:${randomUUID()}`;
      if (serial === 1) firstBarcode = qrValue;
      return {
        print_job_id: jobId,
        batch_id: batchId,
        qr_value: qrValue,
        serial_no: serial,
        print_count: 1,
        last_printed_at: now(),
      };
    });
    const labelIds = await tx.insertMany('qr_labels', labelDocuments);
    const labels = labelDocuments.map((label, index) => ({
      id: labelIds[index],
      qr_value: label.qr_value,
      serial_no: label.serial_no,
      batch_number,
      print_count: 1,
    }));

    await tx.updateOne('batches', { id: batchId }, { $set: { barcode_value: firstBarcode } });
    await tx.insert('activity_logs', {
      user_id: req.user!.userId,
      user_name: req.user!.name,
      user_role: req.user!.role,
      action: 'BATCH_CREATED',
      description: `Batch ${batch_number} created for ${product.name} with ${labelCount} unit QR labels`,
    });
    return { batchId, jobId, labels, barcode_value: firstBarcode };
  });

  res.status(201).json({
    id: result.batchId,
    barcode_value: result.barcode_value,
    product_name: product.name,
    product_sku: product.sku,
    qr_job: {
      id: result.jobId,
      job_code: jobCode,
      product_name: product.name,
      product_sku: product.sku,
      quantity: labelCount,
    },
    labels: result.labels,
  });
}

export async function list(_req: Request, res: Response): Promise<void> {
  const ctx = await getContext();
  const batches = await ctx.find('batches', {}, { sort: { created_at: -1 }, projection: { _id: 0 } });
  const products = await mapByIds<{ id: number; name: string; sku: string }>(
    ctx,
    'products',
    batches.map((batch) => Number(batch.product_id))
  );
  const locations = await mapByIds<{ id: number; location_code: string }>(
    ctx,
    'shelf_locations',
    batches.map((batch) => batch.shelf_location_id)
  );
  const qr = await batchQrStats(ctx, batches.map((batch) => Number(batch.id)));
  res.json(batches.map((batch) => {
    const product = products.get(Number(batch.product_id));
    const location = locations.get(Number(batch.shelf_location_id));
    const stats = qr.get(Number(batch.id));
    return {
      ...batch,
      product_name: product?.name ?? null,
      product_sku: product?.sku ?? null,
      location_code: location?.location_code ?? null,
      qr_count: stats?.count ?? 0,
      qr_job_id: stats?.jobId ?? null,
    };
  }));
}

export async function getByBarcode(req: Request, res: Response): Promise<void> {
  const { barcode } = req.params;
  const ctx = await getContext();
  const label = await ctx.findOne('qr_labels', { qr_value: barcode }, { projection: { _id: 0, batch_id: 1 } });
  let batch = await ctx.findOne('batches', { barcode_value: barcode }, { projection: { _id: 0 } });
  if (!batch && label) {
    batch = await ctx.findOne('batches', { id: Number(label.batch_id) }, { projection: { _id: 0 } });
  }
  if (!batch) { res.status(404).json({ error: 'Batch not found' }); return; }

  const product = await ctx.findOne('products', { id: Number(batch.product_id) }, { projection: { _id: 0 } });
  const location = batch.shelf_location_id
    ? await ctx.findOne('shelf_locations', { id: Number(batch.shelf_location_id) }, { projection: { _id: 0, location_code: 1 } })
    : null;
  const qrCount = await ctx.count('qr_labels', { batch_id: Number(batch.id) });

  res.json({
    ...batch,
    product_name: product?.name ?? null,
    product_sku: product?.sku ?? null,
    product_description: product?.description ?? null,
    cas_number: product?.cas_number ?? null,
    molecular_formula: product?.molecular_formula ?? null,
    product_purity: product?.purity ?? null,
    product_grade: product?.grade ?? null,
    product_storage_conditions: product?.storage_conditions ?? null,
    hazard_classification: product?.hazard_classification ?? null,
    product_physical_state: product?.physical_state ?? null,
    hsn_code: product?.hsn_code ?? null,
    manufacturer: product?.manufacturer ?? null,
    scanned_qr: label && Number(label.batch_id) === Number(batch.id) ? barcode : null,
    location_code: location?.location_code ?? null,
    qr_count: qrCount,
  });
}

export async function search(req: Request, res: Response): Promise<void> {
  const q = req.query.q as string || '';
  const ctx = await getContext();
  const pattern = contains(q);
  const products = await ctx.find('products', {
    $or: [{ name: pattern }, { sku: pattern }],
  }, { projection: { id: 1 } });
  const productIds = products.map((product) => Number(product.id));
  const batches = await ctx.find('batches', {
    $or: [
      { product_id: { $in: productIds } },
      { batch_number: pattern },
    ],
  }, { sort: { created_at: -1 }, limit: 50, projection: { _id: 0 } });
  const productMap = await mapByIds<{ id: number; name: string; sku: string }>(
    ctx,
    'products',
    batches.map((batch) => Number(batch.product_id))
  );
  res.json(batches.map((batch) => {
    const product = productMap.get(Number(batch.product_id));
    return {
      ...batch,
      product_name: product?.name ?? null,
      product_sku: product?.sku ?? null,
    };
  }));
}

export async function update(req: Request, res: Response): Promise<void> {
  const id = Number(req.params.id);
  const { shelf_location_id, storage_location, notes, quantity, unit_price, manufacturing_date, expiry_date } = req.body;
  const ctx = await getContext();
  const batch = await ctx.findOne('batches', { id }, { projection: { _id: 0, id: 1, quantity: 1 } });
  if (!batch) {
    res.status(404).json({ error: 'Batch not found' });
    return;
  }
  if (quantity !== undefined && Number(quantity) !== Number(batch.quantity)) {
    res.status(400).json({ error: 'Batch quantity cannot be changed after unit QR labels are generated. Create a new batch with the correct quantity.' });
    return;
  }
  const locationId = shelf_location_id === undefined || shelf_location_id === null || shelf_location_id === ''
    ? null
    : Number(shelf_location_id);
  if (locationId !== null) {
    if (!Number.isInteger(locationId) || locationId <= 0) {
      res.status(400).json({ error: 'Select a valid shelf location' });
      return;
    }
    const location = await ctx.findOne('shelf_locations', { id: locationId, is_active: 1 }, { projection: { id: 1 } });
    if (!location) {
      res.status(400).json({ error: 'Select an active shelf location' });
      return;
    }
  }
  await ctx.updateOne('batches', { id }, {
    $set: {
      shelf_location_id: locationId,
      storage_location: storage_location || null,
      notes: notes || null,
      unit_price: unit_price || 0,
      manufacturing_date: parseDateValue(manufacturing_date),
      expiry_date: parseDateValue(expiry_date),
    },
  });
  await ctx.insert('activity_logs', {
    user_name: req.user?.name || 'System',
    user_role: req.user?.role || 'ADMIN',
    action: 'BATCH_UPDATED',
    description: `Batch #${id} updated`,
  });
  res.json({ message: 'Batch updated' });
}

export async function getById(req: Request, res: Response): Promise<void> {
  const ctx = await getContext();
  const batch = await ctx.findOne('batches', { id: Number(req.params.id) }, { projection: { _id: 0 } });
  if (!batch) { res.status(404).json({ error: 'Batch not found' }); return; }
  const product = await ctx.findOne('products', { id: Number(batch.product_id) }, {
    projection: { _id: 0, name: 1, sku: 1 },
  });
  res.json({
    ...batch,
    product_name: product?.name ?? null,
    product_sku: product?.sku ?? null,
  });
}
