import { Request, Response } from 'express';
import { randomBytes, randomUUID } from 'crypto';
import { RowDataPacket } from 'mysql2';
import { query, withTransaction } from '../config/database.mysql';

type InputLine = { product_id: number; quantity: number; package_quantity: number; uom: string; shelf_location_id: number; warehouse_id: number; unit_price?: number; avg_standard_quantity?: number | null };

export async function createGroup(req: Request, res: Response): Promise<void> {
  const raw = req.body?.items;
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > 100) { res.status(400).json({ error: 'Add between 1 and 100 products to the batch' }); return; }
  const items: InputLine[] = raw.map((item: any) => ({
    product_id: Number(item?.product_id),
    quantity: Number(item?.quantity),
    package_quantity: Number(item?.package_quantity),
    uom: String(item?.uom || '').trim().slice(0, 40),
    shelf_location_id: Number(item?.shelf_location_id),
    warehouse_id: Number(item?.warehouse_id),
    unit_price: Number(item?.unit_price) || 0,
    avg_standard_quantity: item?.avg_standard_quantity === undefined || item?.avg_standard_quantity === null || item?.avg_standard_quantity === ''
      ? null
      : Number(item.avg_standard_quantity),
  }));
  if (items.some((item) => !Number.isInteger(item.product_id) || item.product_id < 1 || !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 1000 || !Number.isFinite(item.package_quantity) || item.package_quantity <= 0 || item.package_quantity > 1_000_000 || !item.uom || !Number.isInteger(item.shelf_location_id) || item.shelf_location_id < 1 || !Number.isInteger(item.warehouse_id) || item.warehouse_id < 1)) { res.status(400).json({ error: 'Each product needs a valid package quantity, bag count, UOM, and active godown location' }); return; }
  if (items.some((item) => item.avg_standard_quantity !== null && item.avg_standard_quantity !== undefined && (!Number.isFinite(item.avg_standard_quantity) || item.avg_standard_quantity < 0 || item.avg_standard_quantity > 1_000_000))) { res.status(400).json({ error: 'Average standard quantity must be a number between 0 and 1,000,000' }); return; }
  if (items.reduce((sum, item) => sum + item.quantity, 0) > 10_000) { res.status(400).json({ error: 'A single batch can contain no more than 10,000 QR-labelled units' }); return; }
  if (new Set(items.map((item) => item.product_id)).size !== items.length) { res.status(400).json({ error: 'Each product can appear only once in a batch' }); return; }
  const products = new Map<number, any>();
  for (const item of items) {
    const rows = await query<RowDataPacket[]>('SELECT id, name, sku, price FROM products WHERE id = ?', [item.product_id]);
    if (!rows[0]) { res.status(404).json({ error: `Product ${item.product_id} was not found` }); return; }
    const warehouses = await query<RowDataPacket[]>('SELECT id, name, capacity FROM warehouses WHERE id = ? AND tenant_id = ? AND is_active = 1', [item.warehouse_id, req.user!.tenantId]);
    if (!warehouses[0]) { res.status(400).json({ error: `Select an active godown for ${rows[0].name}` }); return; }
    products.set(item.product_id, { ...rows[0], warehouse_id: Number(warehouses[0].id), warehouse_name: warehouses[0].name });
  }

  const groupId = randomUUID();
  const dateStamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const batchNumber = `BATCH-${dateStamp}-${randomBytes(3).toString('hex').toUpperCase()}`;
  try {
    const created = await withTransaction(async (conn) => {
      const [rackRows] = await conn.execute<RowDataPacket[]>('SELECT id, warehouse_id, cells FROM storage_racks WHERE tenant_id = ? ORDER BY rack_code FOR UPDATE', [req.user!.tenantId]);
      const selectedCells = new Map<string, any>();
      const warehouseCells = new Map<string, any[]>();
      for (const rack of rackRows) {
        let cells: any[] = [];
        try { cells = Array.isArray(rack.cells) ? rack.cells : JSON.parse(String(rack.cells || '[]')); } catch { cells = []; }
        cells.sort((a: any, b: any) => Number(a.row) - Number(b.row) || Number(a.column) - Number(b.column));
        const warehouseId = String(rack.warehouse_id);
        for (const cell of cells) {
          const locationId = String(cell.shelf_location_id || '');
          if (!locationId) continue;
          selectedCells.set(locationId, { ...cell, warehouse_id: warehouseId, rack_id: String(rack.id) });
          warehouseCells.set(warehouseId, [...(warehouseCells.get(warehouseId) || []), { ...cell, warehouse_id: warehouseId, rack_id: String(rack.id) }]);
        }
      }
      for (const item of items) {
        const anchor = selectedCells.get(String(item.shelf_location_id));
        if (!anchor || anchor.warehouse_id !== String(products.get(item.product_id).warehouse_id)) {
          throw Object.assign(new Error(`Select a valid storage position inside the chosen godown for ${products.get(item.product_id).name}.`), { statusCode: 400 });
        }
      }
      const warehouseIds = [...new Set(items.map((item) => String(products.get(item.product_id).warehouse_id)))];
      const touchedRackIds = [...new Set(warehouseIds.flatMap((id) => (warehouseCells.get(id) || []).map((cell: any) => cell.rack_id)))];
      for (const rackId of touchedRackIds) {
        await conn.execute('UPDATE storage_racks SET stock_version = COALESCE(stock_version, 0) + 1 WHERE id = ? AND tenant_id = ?', [rackId, req.user!.tenantId]);
      }
      const allLocationIds = [...selectedCells.keys()];
      const allLocationPlaceholders = allLocationIds.map(() => '?').join(',');
      const [occupiedRows] = allLocationIds.length
        ? await conn.execute<RowDataPacket[]>(`SELECT shelf_location_id, quantity, COALESCE(dispatched_quantity, 0) AS dispatched_quantity, COALESCE(recalled_quantity, 0) AS recalled_quantity FROM batches WHERE tenant_id = ? AND shelf_location_id IN (${allLocationPlaceholders}) AND status NOT IN ('DISPATCHED', 'CANCELLED', 'REJECTED') FOR UPDATE`, [req.user!.tenantId, ...allLocationIds])
        : [[] as any, []] as any;
      const occupiedLocations = new Set(occupiedRows
        .filter((batch: any) => Number(batch.quantity || 0) > Number(batch.dispatched_quantity || 0) + Number(batch.recalled_quantity || 0))
        .map((batch: any) => String(batch.shelf_location_id)));
      const allocatedLocations = new Set<string>();
      const locationsByProduct = new Map<number, any[]>();
      for (const item of items) {
        const product = products.get(item.product_id);
        const candidates = (warehouseCells.get(String(product.warehouse_id)) || []).filter((cell: any) =>
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
        const warehouseId = String(products.get(item.product_id).warehouse_id);
        requestedByWarehouse.set(warehouseId, (requestedByWarehouse.get(warehouseId) || 0) + item.quantity);
      }
      for (const [warehouseId, requested] of requestedByWarehouse) {
        const [warehouseRows] = await conn.execute<RowDataPacket[]>('SELECT id, name, capacity FROM warehouses WHERE id = ? AND tenant_id = ? FOR UPDATE', [warehouseId, req.user!.tenantId]);
        const warehouse = warehouseRows[0];
        const locationIds = (warehouseCells.get(warehouseId) || []).map((cell: any) => String(cell.shelf_location_id));
        const placeholders = locationIds.map(() => '?').join(',');
        const [stockRows] = locationIds.length
          ? await conn.execute<RowDataPacket[]>(`SELECT COALESCE(SUM(GREATEST(quantity - COALESCE(dispatched_quantity, 0) - COALESCE(recalled_quantity, 0), 0)), 0) AS occupied FROM batches WHERE tenant_id = ? AND shelf_location_id IN (${placeholders}) AND status NOT IN ('DISPATCHED', 'CANCELLED', 'REJECTED')`, [req.user!.tenantId, ...locationIds])
          : [[{ occupied: 0 }], []] as any;
        const current = Number(stockRows[0]?.occupied || 0);
        if (warehouse && current + requested > Number(warehouse.capacity)) {
          throw Object.assign(new Error(`${warehouse.name} has only ${Math.max(0, Number(warehouse.capacity) - current)} units of capacity remaining.`), { statusCode: 409 });
        }
      }
      await conn.execute('INSERT INTO batch_groups (group_key, batch_number, tenant_id, created_by, product_count, total_quantity, status) VALUES (?, ?, ?, ?, ?, ?, \'QC_PASSED\')', [groupId, batchNumber, req.user!.tenantId, req.user!.userId, items.length, items.reduce((sum, item) => sum + item.quantity, 0)]);
      const lines: any[] = [];
      const allLabels: any[] = [];
      for (const [index, item] of items.entries()) {
        const product = products.get(item.product_id);
        const childNumbers = (locationsByProduct.get(item.product_id) || []).map((_, serial) =>
          `${String(product.sku).slice(0, 30)}-${dateStamp}-${groupId.slice(0, 6)}-${String(index + 1).padStart(2, '0')}-${String(serial + 1).padStart(4, '0')}`);
        const jobCode = `QRJ-${dateStamp}-${randomBytes(3).toString('hex').toUpperCase()}`;
        const [jobInsert] = await conn.execute<any>('INSERT INTO qr_print_jobs (job_code, product_id, quantity, created_by, created_by_role) VALUES (?, ?, ?, ?, ?)', [jobCode, item.product_id, item.quantity, req.user!.userId, req.user!.role]);
        const jobId = Number(jobInsert.insertId);
        const labels: any[] = [];
        for (const [serial, location] of (locationsByProduct.get(item.product_id) || []).entries()) {
          const [batchInsert] = await conn.execute<any>(
            `INSERT INTO batches (product_id, batch_number, batch_group_id, parent_batch_number, tenant_id, quantity, package_quantity, uom, avg_standard_quantity, unit_price, shelf_location_id, storage_location, status, barcode_value)
             VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, 'QC_PASSED', ?)`,
            [item.product_id, childNumbers[serial], groupId, batchNumber, req.user!.tenantId, item.package_quantity, item.uom, item.avg_standard_quantity ?? null, item.unit_price || Number(product.price) || 0, location.shelf_location_id, location.location_code, `QC:${randomUUID()}`],
          );
          const batchId = Number(batchInsert.insertId);
          labels.push({
            batch_id: batchId,
            qr_value: `${jobCode}-${String(serial + 1).padStart(4, '0')}`,
            serial_no: serial + 1,
          });
        }
        const values = labels.map(() => '(?, ?, ?, ?, 1, CURRENT_TIMESTAMP(3))').join(', ');
        await conn.execute(`INSERT INTO qr_labels (print_job_id, batch_id, qr_value, serial_no, print_count, last_printed_at) VALUES ${values}`, labels.flatMap((label) => [jobId, label.batch_id, label.qr_value, label.serial_no]));
        const [stored] = await conn.execute<RowDataPacket[]>('SELECT id, qr_value, serial_no FROM qr_labels WHERE print_job_id = ? ORDER BY serial_no', [jobId]);
        const resultLabels = stored.map((label, labelIndex) => {
          const location = (locationsByProduct.get(item.product_id) || [])[labelIndex];
          return {
            id: Number(label.id), qr_value: String(label.qr_value), serial_no: labelIndex + 1,
            batch_number: batchNumber, child_batch_number: childNumbers[labelIndex],
            product_name: product.name, product_sku: product.sku,
            package_quantity: item.package_quantity, uom: item.uom, quantity: item.quantity,
            warehouse_name: product.warehouse_name, storage_location_id: String(location.shelf_location_id),
            storage_location: location.location_code, print_count: 1,
          };
        });
        for (const label of labels) {
          await conn.execute(`INSERT INTO qc_records (batch_id, tester_id, result, method, remarks) VALUES (?, ?, 'PASS', 'AUTO_PASS', ?)`, [label.batch_id, req.user!.userId, `Created in ${batchNumber}`]);
        }
        await conn.execute('UPDATE products SET quantity = COALESCE(quantity, 0) + ? WHERE id = ?', [item.quantity, item.product_id]);
        lines.push(...labels.map((label, serial) => {
          const location = (locationsByProduct.get(item.product_id) || [])[serial];
          return {
            batch_id: label.batch_id, batch_number: childNumbers[serial], product_id: item.product_id,
            product_name: product.name, product_sku: product.sku, quantity: 1,
            package_quantity: item.package_quantity, uom: item.uom,
            shelf_location_id: location.shelf_location_id, location_code: location.location_code,
            warehouse_name: product.warehouse_name,
            qr_job: { id: jobId, job_code: jobCode, product_name: product.name, product_sku: product.sku, quantity: item.quantity },
            labels: [resultLabels[serial]],
          };
        }));
        allLabels.push(...resultLabels);
      }
      await conn.execute(`INSERT INTO activity_logs (user_id, user_name, user_role, action, description) VALUES (?, ?, ?, 'BATCH_CREATED', ?)`, [req.user!.userId, req.user!.name, req.user!.role, `Batch ${batchNumber} created with ${items.length} products and ${allLabels.length} QR labels`]);
      return { lines, allLabels };
    });
    res.status(201).json({ id: groupId, batch_group_id: groupId, batch_number: batchNumber, product_count: items.length, total_quantity: created.allLabels.length, batches: created.lines, labels: created.allLabels, message: `Batch ${batchNumber} created with ${items.length} products.` });
  } catch (error: any) {
    console.error('Could not create product batch group', error);
    res.status(error?.statusCode || 500).json({ error: error?.message || 'Could not create the batch' });
  }
}
