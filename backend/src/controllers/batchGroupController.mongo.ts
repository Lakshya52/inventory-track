import { Request, Response } from 'express';
import { randomBytes, randomUUID } from 'crypto';
import { getContext, now, withTransaction } from '../config/database';
import { EntityId } from '../services/queryService';

type InputLine = { product_id: string; quantity: number; uom: string; shelf_location_id: string; unit_price?: number };

export async function createGroup(req: Request, res: Response): Promise<void> {
  const raw = req.body?.items;
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > 100) {
    res.status(400).json({ error: 'Add between 1 and 100 products to the batch' }); return;
  }
  const items: InputLine[] = raw.map((item: any) => ({
    product_id: String(item?.product_id || ''), quantity: Number(item?.quantity),
    uom: String(item?.uom || '').trim().slice(0, 40),
    shelf_location_id: String(item?.shelf_location_id || ''), unit_price: Number(item?.unit_price) || 0,
  }));
  if (items.some((item) => !item.product_id || !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 1000 || !item.uom || !item.shelf_location_id)) {
    res.status(400).json({ error: 'Each product needs a valid quantity, UOM, and active shelf location' }); return;
  }
  if (items.reduce((sum, item) => sum + item.quantity, 0) > 10_000) {
    res.status(400).json({ error: 'A single batch can contain no more than 10,000 QR-labelled units' }); return;
  }
  if (new Set(items.map((item) => item.product_id)).size !== items.length) {
    res.status(400).json({ error: 'Each product can appear only once in a batch' }); return;
  }

  const ctx = await getContext();
  const productMap = new Map<string, any>();
  for (const item of items) {
    const product = await ctx.findOne('products', { id: item.product_id }, { projection: { _id: 0, id: 1, name: 1, sku: 1, price: 1 } });
    if (!product) { res.status(404).json({ error: `Product ${item.product_id} was not found` }); return; }
    const location = await ctx.findOne('shelf_locations', { id: item.shelf_location_id, is_active: 1 }, { projection: { _id: 0, id: 1, location_code: 1 } });
    if (!location) { res.status(400).json({ error: `Select an active shelf location for ${product.name}` }); return; }
    productMap.set(item.product_id, { ...product, location_code: location.location_code });
  }

  const groupId = randomUUID();
  const dateStamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const batchNumber = `BATCH-${dateStamp}-${randomBytes(3).toString('hex').toUpperCase()}`;
  try {
    const created = await withTransaction(async (tx) => {
      await tx.insert('batch_groups', {
        group_key: groupId, batch_number: batchNumber, tenant_id: req.user!.tenantId, created_by: req.user!.userId,
        product_count: items.length, total_quantity: items.reduce((sum, item) => sum + item.quantity, 0), status: 'QC_PASSED',
      });
      const lines: any[] = [];
      const allLabels: any[] = [];
      for (const [index, item] of items.entries()) {
        const product = productMap.get(item.product_id);
        const childNumber = `${product.sku}-${dateStamp}-${groupId.slice(0, 6)}-${String(index + 1).padStart(2, '0')}`;
        const qcBarcode = `QC:${randomUUID()}`;
        const childId = await tx.insert('batches', {
          product_id: item.product_id, batch_number: childNumber, batch_group_id: groupId,
          parent_batch_number: batchNumber, tenant_id: req.user!.tenantId, quantity: item.quantity, uom: item.uom,
          unit_price: item.unit_price || Number(product.price) || 0, shelf_location_id: item.shelf_location_id,
          storage_location: product.location_code, status: 'QC_PASSED', barcode_value: qcBarcode,
        });
        const jobCode = `QRJ-${dateStamp}-${randomBytes(3).toString('hex').toUpperCase()}`;
        const jobId = await tx.insert('qr_print_jobs', {
          job_code: jobCode, product_id: item.product_id, quantity: item.quantity,
          created_by: req.user!.userId, created_by_role: req.user!.role,
        });
        const docs = Array.from({ length: item.quantity }, (_, serial) => ({
          print_job_id: jobId, batch_id: childId, qr_value: `QR:${randomUUID()}`,
          serial_no: serial + 1, print_count: 1, last_printed_at: now(),
        }));
        const labelIds = await tx.insertMany('qr_labels', docs);
        const labels = docs.map((doc, labelIndex) => ({ id: labelIds[labelIndex], qr_value: doc.qr_value, serial_no: allLabels.length + labelIndex + 1, batch_number: batchNumber, child_batch_number: childNumber, product_name: product.name, product_sku: product.sku, print_count: 1 }));
        await tx.insert('qc_records', { batch_id: childId, tester_id: req.user!.userId, result: 'PASS', method: 'AUTO_PASS', remarks: `Created in ${batchNumber}` });
        await tx.updateOne('products', { id: item.product_id }, { $inc: { quantity: item.quantity } });
        lines.push({ batch_id: childId, batch_number: childNumber, product_id: item.product_id, product_name: product.name, product_sku: product.sku, quantity: item.quantity, uom: item.uom, shelf_location_id: item.shelf_location_id, location_code: product.location_code, qr_job: { id: jobId, job_code: jobCode, product_name: product.name, product_sku: product.sku, quantity: item.quantity }, labels });
        allLabels.push(...labels);
      }
      await tx.insert('activity_logs', { user_id: req.user!.userId, user_name: req.user!.name, user_role: req.user!.role, action: 'BATCH_CREATED', description: `Batch ${batchNumber} created with ${items.length} products and ${allLabels.length} QR labels` });
      return { lines, allLabels };
    });
    res.status(201).json({ id: groupId, batch_group_id: groupId, batch_number: batchNumber, product_count: items.length, total_quantity: created.allLabels.length, batches: created.lines, labels: created.allLabels, message: `Batch ${batchNumber} created with ${items.length} products.` });
  } catch (error: any) {
    console.error('Could not create product batch group', error);
    res.status(500).json({ error: error?.message || 'Could not create the batch' });
  }
}
