import { Request, Response } from 'express';
import { randomBytes, randomUUID } from 'crypto';
import { getContext, parseDateValue, withTransaction } from '../config/database';

type InputLine = { product_id: string; quantity: number; package_quantity: number; uom: string; shelf_location_id: string; warehouse_id: string; unit_price?: number; avg_standard_quantity?: number | null; manufacturing_date: string; expiry_date: string };

export async function createGroup(req: Request, res: Response): Promise<void> {
  const raw = req.body?.items;
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > 100) {
    res.status(400).json({ error: 'Add between 1 and 100 products to the batch' }); return;
  }
  const items: InputLine[] = raw.map((item: any) => ({
    product_id: String(item?.product_id || ''), quantity: Number(item?.quantity),
    package_quantity: Number(item?.package_quantity),
    uom: String(item?.uom || '').trim().slice(0, 40),
    shelf_location_id: String(item?.shelf_location_id || ''),
    warehouse_id: String(item?.warehouse_id || ''),
    unit_price: Number(item?.unit_price) || 0,
    avg_standard_quantity: item?.avg_standard_quantity === undefined || item?.avg_standard_quantity === null || item?.avg_standard_quantity === ''
      ? null
      : Number(item.avg_standard_quantity),
    manufacturing_date: String(item?.manufacturing_date || '').trim().slice(0, 10),
    expiry_date: String(item?.expiry_date || '').trim().slice(0, 10),
  }));
  if (items.some((item) => !item.product_id || !item.warehouse_id || !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 1000 || !Number.isFinite(item.package_quantity) || item.package_quantity <= 0 || item.package_quantity > 1_000_000 || !item.uom || !item.shelf_location_id)) {
    res.status(400).json({ error: 'Each product needs a valid package quantity, bag count, UOM, and active godown location' }); return;
  }
  const isValidDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value));
  if (items.some((item) => !isValidDate(item.manufacturing_date) || !isValidDate(item.expiry_date) || item.expiry_date < item.manufacturing_date)) {
    res.status(400).json({ error: 'Each product needs a valid manufacturing date and an expiry date on or after it' }); return;
  }
  if (items.some((item) => item.avg_standard_quantity !== null && item.avg_standard_quantity !== undefined && (!Number.isFinite(item.avg_standard_quantity) || item.avg_standard_quantity < 0 || item.avg_standard_quantity > 1_000_000))) {
    res.status(400).json({ error: 'Average standard quantity must be a number between 0 and 1,000,000' }); return;
  }
  if (items.reduce((sum, item) => sum + item.quantity, 0) > 10_000) {
    res.status(400).json({ error: 'A single batch can contain no more than 10,000 QR-labelled units' }); return;
  }
  if (new Set(items.map((item) => item.product_id)).size !== items.length) {
    res.status(400).json({ error: 'Each product can appear only once in a batch' }); return;
  }
  const ctx = await getContext();
  // Idempotency: a retried submission with the same client_operation_id
  // returns the batch that was already created instead of a duplicate.
  const operationId = typeof req.body?.client_operation_id === 'string'
    ? req.body.client_operation_id.trim().slice(0, 64)
    : '';
  if (operationId) {
    const existing = await ctx.findOne('batch_groups', { client_operation_id: operationId, tenant_id: req.user!.tenantId }, { projection: { _id: 0 } });
    if (existing) {
      const existingBatches = await ctx.find('batches', { batch_group_id: existing.group_key }, { sort: { batch_number: 1 }, projection: { _id: 0 } });
      const existingLabels = await ctx.find('qr_labels', { batch_id: { $in: existingBatches.map((batch: any) => batch.id) } }, { sort: { serial_no: 1 }, projection: { _id: 0 } });
      res.status(200).json({
        id: existing.group_key,
        batch_group_id: existing.group_key,
        batch_number: existing.batch_number,
        product_count: existing.product_count,
        total_quantity: existing.total_quantity,
        status: existing.status,
        duplicate: true,
        batches: existingBatches,
        labels: existingLabels,
        message: `Batch ${existing.batch_number} was already created.`,
      });
      return;
    }
  }
  const productMap = new Map<string, any>();
  for (const item of items) {
    const product = await ctx.findOne('products', { id: item.product_id }, { projection: { _id: 0, id: 1, name: 1, sku: 1, price: 1 } });
    if (!product) { res.status(404).json({ error: `Product ${item.product_id} was not found` }); return; }
    const warehouse = item.warehouse_id
      ? await ctx.findOne('warehouses', { id: item.warehouse_id, tenant_id: req.user!.tenantId, is_active: 1 }, { projection: { _id: 0, id: 1, name: 1, capacity: 1 } })
      : null;
    if (!warehouse) { res.status(400).json({ error: `Select an active godown for ${product.name}` }); return; }
    productMap.set(item.product_id, { ...product, warehouse_id: String(warehouse.id), warehouse_name: warehouse.name });
  }

  const groupId = randomUUID();
  const dateStamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const batchNumber = `BATCH-${dateStamp}-${randomBytes(3).toString('hex').toUpperCase()}`;
  try {
    const created = await withTransaction(async (tx) => {
      const racks = await tx.find('storage_racks', { tenant_id: req.user!.tenantId }, { sort: { rack_code: 1 } });
      const selectedCells = new Map<string, any>();
      const warehouseCells = new Map<string, any[]>();
      for (const rack of racks as any[]) {
        const cells = (Array.isArray(rack.cells) ? rack.cells : []).slice().sort((a: any, b: any) => Number(a.row) - Number(b.row) || Number(a.column) - Number(b.column));
        const warehouseId = String(rack.warehouse_id);
        for (const cell of cells) {
          const locationId = String(cell.shelf_location_id || '');
          if (!locationId) continue;
          selectedCells.set(locationId, { ...cell, warehouse_id: warehouseId, rack_id: String(rack.id) });
          warehouseCells.set(warehouseId, [...(warehouseCells.get(warehouseId) || []), { ...cell, warehouse_id: warehouseId, rack_id: String(rack.id) }]);
        }
      }
      for (const item of items) {
        const anchor = selectedCells.get(item.shelf_location_id);
        if (!anchor || anchor.warehouse_id !== productMap.get(item.product_id).warehouse_id) {
          throw Object.assign(new Error(`Select a valid storage position inside the chosen godown for ${productMap.get(item.product_id).name}.`), { statusCode: 400 });
        }
      }
      const touchedRackIds = [...new Set(items.flatMap((item) => (warehouseCells.get(productMap.get(item.product_id).warehouse_id) || []).map((cell: any) => cell.rack_id)))];
      for (const rackId of touchedRackIds) {
        await tx.updateOne('storage_racks', { id: rackId, tenant_id: req.user!.tenantId }, { $inc: { stock_version: 1 } });
      }
      const occupiedBatches = await tx.find('batches', {
        tenant_id: req.user!.tenantId,
        shelf_location_id: { $in: [...selectedCells.keys()] },
        status: { $nin: ['DISPATCHED', 'CANCELLED', 'REJECTED'] },
      });
      const occupiedLocations = new Set(occupiedBatches
        .filter((batch: any) => Number(batch.quantity || 0) > Number(batch.dispatched_quantity || 0) + Number(batch.recalled_quantity || 0))
        .map((batch: any) => String(batch.shelf_location_id)));
      const allocatedLocations = new Set<string>();
      const locationsByProduct = new Map<string, any[]>();
      for (const item of items) {
        const product = productMap.get(item.product_id);
        const candidates = (warehouseCells.get(product.warehouse_id) || []).filter((cell: any) =>
          !occupiedLocations.has(String(cell.shelf_location_id)) && !allocatedLocations.has(String(cell.shelf_location_id)));
        if (candidates.length < item.quantity) {
          throw Object.assign(new Error(`${product.warehouse_name} has only ${candidates.length} empty positions for ${item.quantity} bags of ${product.name}.`), { statusCode: 409 });
        }
        const allocated = candidates.slice(0, item.quantity);
        allocated.forEach((cell: any) => allocatedLocations.add(String(cell.shelf_location_id)));
        locationsByProduct.set(item.product_id, allocated);
      }
      const requestedByWarehouse = new Map<string, number>();
      for (const item of items) {
        const warehouseId = productMap.get(item.product_id).warehouse_id;
        requestedByWarehouse.set(warehouseId, (requestedByWarehouse.get(warehouseId) || 0) + item.quantity);
      }
      for (const [warehouseId, requested] of requestedByWarehouse) {
        const warehouse = await tx.findOne('warehouses', { id: warehouseId, tenant_id: req.user!.tenantId });
        const cells = (warehouseCells.get(warehouseId) || []).map((cell: any) => String(cell.shelf_location_id));
        const stored = cells.length ? await tx.find('batches', {
          tenant_id: req.user!.tenantId,
          shelf_location_id: { $in: cells },
          status: { $nin: ['DISPATCHED', 'CANCELLED', 'REJECTED'] },
        }) : [];
        const current = stored.reduce((sum: number, batch: any) => sum + Math.max(0, Number(batch.quantity || 0) - Number(batch.dispatched_quantity || 0) - Number(batch.recalled_quantity || 0)), 0);
        if (warehouse && current + requested > Number(warehouse.capacity)) {
          throw Object.assign(new Error(`${warehouse.name} has only ${Math.max(0, Number(warehouse.capacity) - current)} units of capacity remaining.`), { statusCode: 409 });
        }
      }
      await tx.insert('batch_groups', {
        group_key: groupId, batch_number: batchNumber, tenant_id: req.user!.tenantId, created_by: req.user!.userId,
        product_count: items.length, total_quantity: items.reduce((sum, item) => sum + item.quantity, 0), status: 'PENDING_QC',
        ...(operationId ? { client_operation_id: operationId } : {}),
      });
      const lines: any[] = [];
      const allLabels: any[] = [];
      for (const [index, item] of items.entries()) {
        const product = productMap.get(item.product_id);
        const childNumbers = (locationsByProduct.get(item.product_id) || []).map((_, serial) =>
          `${String(product.sku).slice(0, 30)}-${dateStamp}-${groupId.slice(0, 6)}-${String(index + 1).padStart(2, '0')}-${String(serial + 1).padStart(4, '0')}`);
        const jobCode = `QRJ-${dateStamp}-${randomBytes(3).toString('hex').toUpperCase()}`;
        const jobId = await tx.insert('qr_print_jobs', {
          job_code: jobCode, product_id: item.product_id, quantity: item.quantity,
          created_by: req.user!.userId, created_by_role: req.user!.role,
          tenant_id: req.user!.tenantId,
        });
        const docs: any[] = [];
        for (const [serial, location] of (locationsByProduct.get(item.product_id) || []).entries()) {
          const childId = await tx.insert('batches', {
            product_id: item.product_id, batch_number: childNumbers[serial], batch_group_id: groupId,
            parent_batch_number: batchNumber, tenant_id: req.user!.tenantId, quantity: 1, uom: item.uom,
            avg_standard_quantity: item.avg_standard_quantity ?? null,
            package_quantity: item.package_quantity,
            manufacturing_date: parseDateValue(item.manufacturing_date),
            expiry_date: parseDateValue(item.expiry_date),
            unit_price: item.unit_price || Number(product.price) || 0, shelf_location_id: location.shelf_location_id,
            storage_location: location.location_code, status: 'PENDING_QC', barcode_value: `QC:${randomUUID()}`,
          });
          docs.push({
            print_job_id: jobId, batch_id: childId,
            qr_value: `${jobCode}-${String(serial + 1).padStart(4, '0')}`,
            serial_no: serial + 1, print_count: 0, last_printed_at: null,
          });
        }
        const labelIds = await tx.insertMany('qr_labels', docs);
        const labels = docs.map((doc, labelIndex) => {
          const location = (locationsByProduct.get(item.product_id) || [])[labelIndex];
          return {
            id: labelIds[labelIndex], qr_value: doc.qr_value, serial_no: labelIndex + 1,
            batch_number: batchNumber, child_batch_number: childNumbers[labelIndex],
            product_name: product.name, product_sku: product.sku,
            package_quantity: item.package_quantity, uom: item.uom, quantity: item.quantity,
            warehouse_name: product.warehouse_name, storage_location_id: String(location.shelf_location_id),
            storage_location: location.location_code, print_count: 0,
          };
        });
        lines.push(...docs.map((doc, serial) => {
          const location = (locationsByProduct.get(item.product_id) || [])[serial];
          return {
            batch_id: doc.batch_id, batch_number: childNumbers[serial], product_id: item.product_id,
            product_name: product.name, product_sku: product.sku, quantity: 1,
            package_quantity: item.package_quantity, uom: item.uom,
            shelf_location_id: location.shelf_location_id, location_code: location.location_code,
            warehouse_name: product.warehouse_name,
            qr_job: { id: jobId, job_code: jobCode, product_name: product.name, product_sku: product.sku, quantity: item.quantity },
            labels: [labels[serial]],
          };
        }));
        allLabels.push(...labels);
      }
      await tx.insert('activity_logs', { user_id: req.user!.userId, user_name: req.user!.name, user_role: req.user!.role, action: 'BATCH_CREATED', description: `Batch ${batchNumber} created with ${items.length} products and ${allLabels.length} units; waiting for QC review` });
      return { lines, allLabels };
    });
    res.status(201).json({ id: groupId, batch_group_id: groupId, batch_number: batchNumber, product_count: items.length, total_quantity: created.allLabels.length, batches: created.lines, labels: created.allLabels, status: 'PENDING_QC', message: `Batch ${batchNumber} created with ${items.length} products and sent to QC for review.` });
  } catch (error: any) {
    console.error('Could not create product batch group', error);
    res.status(error?.statusCode || 500).json({ error: error?.message || 'Could not create the batch' });
  }
}
