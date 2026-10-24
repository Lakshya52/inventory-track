import { Request, Response } from 'express';
import { randomBytes, randomUUID } from 'crypto';
import { getContext, now, parseDateValue, withTransaction } from '../config/database';
import { batchQrStats, contains, mapByIds } from '../services/queryService';
import { buildBatchNumbers } from '../utils/batchNumbers';

export async function create(req: Request, res: Response): Promise<void> {
  const { product_id, batch_number, quantity, batch_count = 1, uom, unit_price, manufacturing_date, expiry_date, shelf_location_id, storage_location, notes } = req.body;
  if (!product_id || !String(batch_number || '').trim()) {
    res.status(400).json({ error: 'Product ID and batch number are required' });
    return;
  }
  const productId = Number(product_id);
  if (!Number.isInteger(productId) || productId < 1) {
    res.status(400).json({ error: 'Select a valid product' });
    return;
  }
  if (!manufacturing_date || !expiry_date) {
    res.status(400).json({ error: 'Manufacturing date and expiry date are required' });
    return;
  }
  const bagCount = Number(quantity);
  if (!Number.isInteger(bagCount) || bagCount < 1 || bagCount > 1000) {
    res.status(400).json({ error: 'Products per batch must be a whole number between 1 and 1000' });
    return;
  }
  const batchCount = Number(batch_count);
  if (!Number.isInteger(batchCount) || batchCount < 1 || batchCount > 100) {
    res.status(400).json({ error: 'Number of batches must be a whole number between 1 and 100' });
    return;
  }
  if (batchCount * bagCount > 10_000) {
    res.status(400).json({ error: 'A single generation can contain no more than 10,000 products' });
    return;
  }
  const batchNumbers = buildBatchNumbers(String(batch_number).trim(), batchCount);
  if (batchNumbers.some((number) => number.length > 100)) {
    res.status(400).json({ error: 'Generated batch numbers must not exceed 100 characters' });
    return;
  }
  const ctx = await getContext();
  const product = await ctx.findOne('products', { id: productId }, {
    projection: { _id: 0, id: 1, name: 1, sku: 1, price: 1 },
  });
  if (!product) { res.status(404).json({ error: 'Product not found' }); return; }

  const existing = await ctx.findOne('batches', { batch_number: { $in: batchNumbers } }, { projection: { id: 1, batch_number: 1 } });
  if (existing) { res.status(409).json({ error: `Batch number "${existing.batch_number}" already exists` }); return; }
  if (shelf_location_id) {
    const location = await ctx.findOne('shelf_locations', { id: Number(shelf_location_id), is_active: 1 }, { projection: { id: 1 } });
    if (!location) { res.status(400).json({ error: 'Select an active shelf location' }); return; }
  }

  const batchGroupId = randomUUID();
  const result = await withTransaction(async (tx) => {
    const createdBatches: Array<{ id: number; batch_number: string; barcode_value: string }> = [];
    for (const number of batchNumbers) {
      const qcBarcode = `QC:${randomUUID()}`;
      const batchId = await tx.insert('batches', {
        product_id: productId,
        batch_number: number,
        batch_group_id: batchGroupId,
        quantity: bagCount,
        uom: 'pcs',
        unit_price: Number(unit_price) || 0,
        manufacturing_date: parseDateValue(manufacturing_date),
        expiry_date: parseDateValue(expiry_date),
        shelf_location_id: shelf_location_id || null,
        storage_location: storage_location || null,
        notes: notes || null,
        status: 'CREATED',
        barcode_value: qcBarcode,
      });
      createdBatches.push({ id: batchId, batch_number: number, barcode_value: qcBarcode });
      await tx.insert('activity_logs', {
        user_id: req.user!.userId,
        user_name: req.user!.name,
        user_role: req.user!.role,
        action: 'BATCH_CREATED',
        description: `QC batch ${number} created for ${product.name} with ${bagCount} products`,
      });
    }
    return createdBatches;
  });

  res.status(201).json({
    id: result[0].id,
    barcode_value: result[0].barcode_value,
    batch_group_id: batchGroupId,
    batch_count: batchCount,
    batches: result,
    product_name: product.name,
    product_sku: product.sku,
    message: `${batchCount} QC batch${batchCount === 1 ? '' : 'es'} created. Finish-goods details and bag labels are available after QC passes.`,
  });
}

export async function finishGoods(req: Request, res: Response): Promise<void> {
  const id = Number(req.params.id);
  const vendorId = Number(req.body.vendor_id);
  const gradeId = Number(req.body.grade_id);
  const bagQuantityId = Number(req.body.bag_quantity_id);
  const locationId = req.body.shelf_location_id ? Number(req.body.shelf_location_id) : null;
  if (![vendorId, gradeId, bagQuantityId].every((value) => Number.isInteger(value) && value > 0)) {
    res.status(400).json({ error: 'Select a supplier, grade, and bag quantity' });
    return;
  }
  const ctx = await getContext();
  const batch = await ctx.findOne('batches', { id }, { projection: { _id: 0 } });
  if (!batch) { res.status(404).json({ error: 'Batch not found' }); return; }
  if (batch.status !== 'QC_PASSED') {
    res.status(409).json({ error: 'Finished-goods details can only be entered after QC passes' });
    return;
  }
  if (batch.fg_details_completed_at || (await ctx.count('qr_labels', { batch_id: id })) > 0) {
    res.status(409).json({ error: 'Finished-goods details and QR labels already exist for this batch' });
    return;
  }
  const [vendor, grade, bagQuantity, location] = await Promise.all([
    ctx.findOne('vendors', { id: vendorId, is_active: 1 }, { projection: { _id: 0, id: 1 } }),
    ctx.findOne('grades', { id: gradeId, is_active: 1 }, { projection: { _id: 0, id: 1 } }),
    ctx.findOne('bag_quantities', { id: bagQuantityId, is_active: 1 }, { projection: { _id: 0, id: 1 } }),
    locationId ? ctx.findOne('shelf_locations', { id: locationId, is_active: 1 }, { projection: { _id: 0, id: 1 } }) : Promise.resolve(null),
  ]);
  if (!vendor || !grade || !bagQuantity || (locationId && !location)) {
    res.status(400).json({ error: 'Select active supplier, grade, bag quantity, and shelf location values' });
    return;
  }
  const product = await ctx.findOne('products', { id: Number(batch.product_id) }, { projection: { _id: 0 } });
  if (!product) { res.status(404).json({ error: 'Product not found' }); return; }
  const jobCode = `QRJ-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${randomBytes(3).toString('hex').toUpperCase()}`;
  const result = await withTransaction(async (tx) => {
    const current = await tx.findOne('batches', { id, status: 'QC_PASSED' }, { projection: { _id: 0 } });
    if (!current) throw new Error('Batch is no longer QC-passed');
    if (current.fg_details_completed_at || (await tx.count('qr_labels', { batch_id: id })) > 0) {
      throw new Error('Finished-goods details and QR labels already exist for this batch');
    }
    const jobId = await tx.insert('qr_print_jobs', {
      job_code: jobCode,
      product_id: Number(batch.product_id),
      quantity: Number(batch.quantity),
      created_by: req.user!.userId,
      created_by_role: 'ADMIN',
    });
    let firstBarcode = '';
    const labelDocuments = Array.from({ length: Number(batch.quantity) }, (_, index) => {
      const qrValue = `QR:${randomUUID()}`;
      if (index === 0) firstBarcode = qrValue;
      return {
        print_job_id: jobId,
        batch_id: id,
        qr_value: qrValue,
        serial_no: index + 1,
        print_count: 1,
        last_printed_at: now(),
      };
    });
    const labelIds = await tx.insertMany('qr_labels', labelDocuments);
    const labels = labelDocuments.map((label, index) => ({
      id: labelIds[index],
      qr_value: label.qr_value,
      serial_no: label.serial_no,
      batch_number: batch.batch_number,
      print_count: 1,
    }));
    const updated = await tx.updateOne(
      'batches',
      { id, status: 'QC_PASSED', fg_details_completed_at: { $exists: false } },
      { $set: {
        vendor_id: vendorId,
        grade_id: gradeId,
        bag_quantity_id: bagQuantityId,
        shelf_location_id: locationId,
        fg_details_completed_at: now(),
        barcode_value: firstBarcode,
      } }
    );
    if (updated.matchedCount !== 1) {
      throw new Error('Batch finished-goods details changed while labels were being generated');
    }
    await tx.insert('activity_logs', {
      user_id: req.user!.userId,
      user_name: req.user!.name,
      user_role: req.user!.role,
      action: 'FINISHED_GOODS_COMPLETED',
      description: `Finished-goods details completed for batch ${batch.batch_number}; ${labels.length} bag QR labels generated`,
    });
    return { jobId, labels, barcode_value: firstBarcode };
  });
  res.status(201).json({
    qr_job: {
      id: result.jobId,
      job_code: jobCode,
      product_name: product.name,
      product_sku: product.sku,
      quantity: Number(batch.quantity),
    },
    labels: result.labels,
    barcode_value: result.barcode_value,
  });
}

export async function list(_req: Request, res: Response): Promise<void> {
  const ctx = await getContext();
  const batches = await ctx.find('batches', {}, { sort: { created_at: -1 }, projection: { _id: 0 } });
  const products = await mapByIds<{ id: number; name: string; sku: string; grade?: string | null }>(
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
  const vendors = await mapByIds<Record<string, any>>(ctx, 'vendors', batches.map((batch) => Number(batch.vendor_id)));
  const grades = await mapByIds<Record<string, any>>(ctx, 'grades', batches.map((batch) => Number(batch.grade_id)));
  const bagQuantities = await mapByIds<Record<string, any>>(ctx, 'bag_quantities', batches.map((batch) => Number(batch.bag_quantity_id)));
  res.json(batches.map((batch) => {
    const product = products.get(Number(batch.product_id));
    const location = locations.get(Number(batch.shelf_location_id));
    const stats = qr.get(Number(batch.id));
    return {
      ...batch,
      product_name: product?.name ?? null,
      product_sku: product?.sku ?? null,
      vendor_name: vendors.get(Number(batch.vendor_id))?.name ?? null,
      grade_name: grades.get(Number(batch.grade_id))?.name ?? product?.grade ?? null,
      bag_quantity_name: bagQuantities.get(Number(batch.bag_quantity_id))?.name ?? null,
      bag_quantity: bagQuantities.get(Number(batch.bag_quantity_id))?.quantity ?? null,
      bag_quantity_unit: bagQuantities.get(Number(batch.bag_quantity_id))?.unit ?? null,
      product_grade: product?.grade ?? null,
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
  let matchedByBatchNumber = false;
  if (!batch && label) {
    batch = await ctx.findOne('batches', { id: Number(label.batch_id) }, { projection: { _id: 0 } });
  }
  if (!batch) {
    const matchingBatches = await ctx.find('batches', { batch_number: barcode }, {
      limit: 2,
      projection: { _id: 0 },
    });
    if (matchingBatches.length > 1) {
      res.status(409).json({ error: 'Batch number matches more than one batch. Scan its QR or barcode instead.' });
      return;
    }
    if (matchingBatches.length === 1) {
      batch = await ctx.findOne('batches', { id: Number(matchingBatches[0].id) }, { projection: { _id: 0 } });
      matchedByBatchNumber = Boolean(batch);
    }
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
    matched_by_batch_number: matchedByBatchNumber,
    location_code: location?.location_code ?? null,
    qr_count: qrCount,
    grade_name: batch.grade_id
      ? (await ctx.findOne('grades', { id: Number(batch.grade_id) }, { projection: { _id: 0, name: 1 } }))?.name ?? product?.grade ?? null
      : product?.grade ?? null,
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
