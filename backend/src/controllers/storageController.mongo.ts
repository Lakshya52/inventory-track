import { Request, Response } from 'express';
import { getContext, isValidId, withTransaction } from '../config/database';

function validName(value: unknown): string { return typeof value === 'string' ? value.trim().slice(0, 120) : ''; }
function positiveInt(value: unknown, max: number): number { const n = Number(value); return Number.isInteger(n) && n > 0 && n <= max ? n : 0; }
function locationCodeFor(warehouse: string, rack: string, row: number, column: number): string {
  const clean = (value: string, max: number) => value.replace(/\s+/g, '-').toUpperCase().slice(0, max).replace(/-+$/g, '');
  return `${clean(warehouse, 38)}-${clean(rack, 34)}-S${row}-P${column}`.slice(0, 100);
}

async function warehouseSnapshot(tenantId: string | number, warehouseId: string) {
  const ctx = await getContext();
  const warehouse = await ctx.findOne('warehouses', { id: warehouseId, tenant_id: tenantId });
  if (!warehouse) return null;
  const racks = await ctx.find('storage_racks', { tenant_id: tenantId, warehouse_id: warehouseId }, { sort: { rack_code: 1 } });
  const locationIds = racks.flatMap((rack: any) => rack.cells || []).map((cell: any) => cell.shelf_location_id).filter(Boolean);
  const batches = locationIds.length ? await ctx.find('batches', { tenant_id: tenantId, shelf_location_id: { $in: locationIds }, status: { $nin: ['DISPATCHED', 'CANCELLED', 'REJECTED'] } }) : [];
  const productIds = [...new Set(batches.map((batch: any) => batch.product_id).filter(Boolean))];
  const products = productIds.length ? await ctx.find('products', { tenant_id: tenantId, id: { $in: productIds } }) : [];
  const productsById = new Map(products.map((product: any) => [String(product.id), product]));
  const locationToBatches = new Map<string, any[]>();
  for (const batch of batches) {
    const key = String(batch.shelf_location_id);
    locationToBatches.set(key, [...(locationToBatches.get(key) || []), batch]);
  }
  const locations = locationIds.length ? await ctx.find('shelf_locations', { tenant_id: tenantId, id: { $in: locationIds } }) : [];
  const locationCodes = new Map(locations.map((row: any) => [String(row.id), row.location_code]));
  const enrichedRacks = await Promise.all(racks.map(async (rack: any) => {
    const cells = await Promise.all((rack.cells || []).map(async (cell: any) => {
      const stored = locationToBatches.get(String(cell.shelf_location_id)) || [];
      const used = stored.reduce((sum, batch) => sum + Math.max(0, Number(batch.quantity || 0) - Number(batch.dispatched_quantity || 0) - Number(batch.recalled_quantity || 0)), 0);
      const shelf = `S${cell.row}`;
      const position = `P${cell.column}`;
      const locationCode = locationCodeFor(warehouse.name, rack.rack_code, cell.row, cell.column);
      const cellCode = `${rack.rack_code}-${shelf}-${position}`;
      const existingLocationCode = locationCodes.get(String(cell.shelf_location_id));
      if (existingLocationCode && existingLocationCode !== locationCode) {
        await ctx.updateOne('shelf_locations', { id: cell.shelf_location_id, tenant_id: tenantId }, { $set: { location_code: locationCode, description: `${warehouse.name} · ${rack.rack_code} · Shelf ${shelf}, Position ${position}`, warehouse: warehouse.name, rack: rack.rack_code, shelf: `${shelf}-${position}` } });
      }
      return { ...cell, cell_code: cellCode, location_code: locationCode, occupied: used > 0, used_capacity: used, batches: stored.map((batch: any) => {
        const product = productsById.get(String(batch.product_id));
        return {
          id: batch.id,
          batch_number: batch.parent_batch_number || batch.batch_number,
          product_name: batch.product_name || product?.name || null,
          product_sku: batch.product_sku || product?.sku || null,
          quantity: batch.quantity,
          remaining_quantity: Math.max(0, Number(batch.quantity || 0) - Number(batch.dispatched_quantity || 0) - Number(batch.recalled_quantity || 0)),
          uom: batch.uom,
          manufacturing_date: batch.manufacturing_date || null,
          expiry_date: batch.expiry_date || null,
          status: batch.status || null,
          product_details: product ? {
            description: product.description || null,
            cas_number: product.cas_number || null,
            molecular_formula: product.molecular_formula || null,
            purity: product.purity || null,
            grade: product.grade || null,
            storage_conditions: product.storage_conditions || null,
            hazard_classification: product.hazard_classification || null,
            physical_state: product.physical_state || null,
            hsn_code: product.hsn_code || null,
            manufacturer: product.manufacturer || null,
          } : null,
        };
      }) };
    }));
    return { ...rack, cells, occupied_cells: cells.filter((cell: any) => cell.occupied).length, total_cells: cells.length };
  }));
  const occupied = enrichedRacks.flatMap((rack: any) => rack.cells).reduce((sum: number, cell: any) => sum + Number(cell.used_capacity || 0), 0);
  return { ...warehouse, racks: enrichedRacks, occupied_capacity: occupied, utilization_percent: warehouse.capacity ? Math.min(100, Math.round(occupied / warehouse.capacity * 100)) : 0 };
}

export async function listWarehouses(req: Request, res: Response): Promise<void> {
  const ctx = await getContext();
  const rows = await ctx.find('warehouses', { tenant_id: req.user!.tenantId }, { sort: { name: 1 } });
  const data = await Promise.all(rows.map((row: any) => warehouseSnapshot(req.user!.tenantId, String(row.id))));
  res.json(data.filter(Boolean));
}

export async function listInventory(req: Request, res: Response): Promise<void> {
  const tenantId = req.user!.tenantId;
  const ctx = await getContext();
  const batches = await ctx.find('batches', {
    tenant_id: tenantId,
    status: { $nin: ['DISPATCHED', 'CANCELLED', 'REJECTED'] },
  }, { sort: { created_at: -1 } });
  const [products, locations, racks, warehouses] = await Promise.all([
    ctx.find('products', { tenant_id: tenantId }),
    ctx.find('shelf_locations', { tenant_id: tenantId }),
    ctx.find('storage_racks', { tenant_id: tenantId }),
    ctx.find('warehouses', { tenant_id: tenantId }),
  ]);
  const productsById = new Map(products.map((row: any) => [String(row.id), row]));
  const locationsById = new Map(locations.map((row: any) => [String(row.id), row]));
  const warehousesById = new Map(warehouses.map((row: any) => [String(row.id), row.name]));
  const rackByLocation = new Map<string, { rack_id: string; warehouse_id: string; rack_code: string; warehouse_name: string }>();
  for (const rack of racks as any[]) {
    for (const cell of rack.cells || []) {
      if (cell.shelf_location_id) rackByLocation.set(String(cell.shelf_location_id), {
        rack_id: String(rack.id),
        warehouse_id: String(rack.warehouse_id),
        rack_code: rack.rack_code,
        warehouse_name: warehousesById.get(String(rack.warehouse_id)) || '',
      });
    }
  }
  res.json(batches.map((batch: any) => {
    const product = productsById.get(String(batch.product_id));
    const location = locationsById.get(String(batch.shelf_location_id));
    const rack = rackByLocation.get(String(batch.shelf_location_id));
    return {
      id: batch.id,
      batch_number: batch.parent_batch_number || batch.batch_number,
      product_name: batch.product_name || product?.name || 'Unknown product',
      product_sku: batch.product_sku || product?.sku || null,
      quantity: batch.quantity,
      remaining_quantity: Math.max(0, Number(batch.quantity || 0) - Number(batch.dispatched_quantity || 0) - Number(batch.recalled_quantity || 0)),
      uom: batch.uom || 'units',
      status: batch.status,
      location_code: location?.location_code || batch.storage_location || null,
      warehouse: location?.warehouse || rack?.warehouse_name || null,
      rack: location?.rack || rack?.rack_code || null,
      shelf: location?.shelf || null,
      warehouse_id: rack?.warehouse_id || null,
      rack_id: rack?.rack_id || null,
      created_at: batch.created_at,
    };
  }));
}

export async function createWarehouse(req: Request, res: Response): Promise<void> {
  const name = validName(req.body.name); const capacity = positiveInt(req.body.capacity, 1_000_000_000);
  if (!name || !capacity) { res.status(400).json({ error: 'Enter a warehouse name and a positive capacity.' }); return; }
  const ctx = await getContext();
  const existing = await ctx.findOne('warehouses', { tenant_id: req.user!.tenantId, name: { $regex: `^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' } });
  if (existing) { res.status(409).json({ error: 'A storage location with that name already exists.' }); return; }
  const id = await ctx.insert('warehouses', { tenant_id: req.user!.tenantId, name, capacity, is_active: 1 });
  res.status(201).json(await warehouseSnapshot(req.user!.tenantId, id));
}

export async function getWarehouse(req: Request, res: Response): Promise<void> {
  if (!isValidId(req.params.id)) { res.status(400).json({ error: 'Invalid storage location.' }); return; }
  const warehouse = await warehouseSnapshot(req.user!.tenantId, req.params.id);
  if (!warehouse) { res.status(404).json({ error: 'Storage location not found.' }); return; }
  res.json(warehouse);
}

export async function updateWarehouse(req: Request, res: Response): Promise<void> {
  if (!isValidId(req.params.id)) { res.status(400).json({ error: 'Invalid storage location.' }); return; }
  const name = validName(req.body.name); const capacity = positiveInt(req.body.capacity, 1_000_000_000);
  if (!name || !capacity) { res.status(400).json({ error: 'Enter a warehouse name and positive capacity.' }); return; }
  const ctx = await getContext();
  const warehouse = await ctx.findOne('warehouses', { id: req.params.id, tenant_id: req.user!.tenantId });
  if (!warehouse) { res.status(404).json({ error: 'Storage location not found.' }); return; }
  const duplicates = await ctx.findOne('warehouses', { tenant_id: req.user!.tenantId, id: { $ne: req.params.id }, name: { $regex: `^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' } });
  if (duplicates) { res.status(409).json({ error: 'A storage location with that name already exists.' }); return; }
  const snapshot = await warehouseSnapshot(req.user!.tenantId, req.params.id);
  const occupied = Number(snapshot?.occupied_capacity || 0);
  const positions = (snapshot?.racks || []).reduce((sum: number, rack: any) => sum + (rack.cells || []).length, 0);
  if (capacity < positions) { res.status(409).json({ error: `Capacity cannot be below the ${positions} storage positions already configured.` }); return; }
  if (capacity < occupied) { res.status(409).json({ error: `Capacity cannot be below the ${occupied} units currently stored.` }); return; }
  await ctx.updateOne('warehouses', { id: req.params.id, tenant_id: req.user!.tenantId }, { $set: { name, capacity } });
  res.json(await warehouseSnapshot(req.user!.tenantId, req.params.id));
}

export async function listWarehouseRacks(req: Request, res: Response): Promise<void> { await getWarehouse(req, res); }

export async function createRack(req: Request, res: Response): Promise<void> {
  if (!isValidId(req.params.id)) { res.status(400).json({ error: 'Invalid storage location.' }); return; }
  const rackCode = validName(req.body.name); const rows = positiveInt(req.body.rows, 30); const columns = positiveInt(req.body.columns, 30);
  if (!rackCode || !rows || !columns || rows * columns > 300) { res.status(400).json({ error: 'Enter a rack name and dimensions with no more than 300 cells.' }); return; }
  const ctx = await getContext();
  const warehouse = await ctx.findOne('warehouses', { id: req.params.id, tenant_id: req.user!.tenantId });
  if (!warehouse) { res.status(404).json({ error: 'Storage location not found.' }); return; }
  const exists = await ctx.findOne('storage_racks', { tenant_id: req.user!.tenantId, warehouse_id: warehouse.id, rack_code: rackCode });
  if (exists) { res.status(409).json({ error: 'That rack name already exists in this storage location.' }); return; }
  let rackId: string;
  try {
    rackId = await withTransaction(async tx => {
      await tx.updateOne('warehouses', { id: warehouse.id, tenant_id: req.user!.tenantId }, { $set: { capacity: warehouse.capacity } });
      const currentRacks = await tx.find('storage_racks', { tenant_id: req.user!.tenantId, warehouse_id: warehouse.id });
      const currentPositions = currentRacks.reduce((sum: number, rack: any) => sum + (Array.isArray(rack.cells) ? rack.cells.length : 0), 0);
      if (currentPositions + rows * columns > Number(warehouse.capacity)) {
        throw Object.assign(new Error(`This godown can have at most ${warehouse.capacity} positions. It already has ${currentPositions}.`), { statusCode: 409 });
      }
      const cells: any[] = [];
      for (let row = 1; row <= rows; row++) for (let column = 1; column <= columns; column++) {
        const shelf = `S${row}`;
        const position = `P${column}`;
        const locationCode = locationCodeFor(warehouse.name, rackCode, row, column);
        const locationId = await tx.insert('shelf_locations', { tenant_id: req.user!.tenantId, location_code: locationCode, description: `${warehouse.name} · ${rackCode} · Shelf ${shelf}, Position ${position}`, warehouse: warehouse.name, rack: rackCode, shelf: `${shelf}-${position}`, is_active: 1 });
        cells.push({ row, column, cell_code: `${rackCode}-${shelf}-${position}`, shelf_location_id: locationId, location_code: locationCode });
      }
      return tx.insert('storage_racks', { tenant_id: req.user!.tenantId, warehouse_id: warehouse.id, rack_code: rackCode, rows, columns, cells });
    });
  } catch (error: any) {
    res.status(error?.statusCode || 500).json({ error: error?.message || 'Could not create rack.' });
    return;
  }
  const updated = await warehouseSnapshot(req.user!.tenantId, String(warehouse.id));
  res.status(201).json(updated?.racks.find((rack: any) => String(rack.id) === rackId));
}

export async function updateRack(req: Request, res: Response): Promise<void> {
  if (!isValidId(req.params.id) || !isValidId(req.params.rackId)) { res.status(400).json({ error: 'Invalid rack.' }); return; }
  const rackCode = validName(req.body.name);
  const rows = positiveInt(req.body.rows, 30);
  const columns = positiveInt(req.body.columns, 30);
  if (!rackCode || !rows || !columns || rows * columns > 300) { res.status(400).json({ error: 'Enter a rack name and dimensions with no more than 300 cells.' }); return; }

  const ctx = await getContext();
  const warehouse = await ctx.findOne('warehouses', { id: req.params.id, tenant_id: req.user!.tenantId });
  if (!warehouse) { res.status(404).json({ error: 'Storage location not found.' }); return; }
  const rack = await ctx.findOne('storage_racks', { id: req.params.rackId, warehouse_id: warehouse.id, tenant_id: req.user!.tenantId });
  if (!rack) { res.status(404).json({ error: 'Rack not found.' }); return; }
  const duplicate = await ctx.findOne('storage_racks', { tenant_id: req.user!.tenantId, warehouse_id: warehouse.id, id: { $ne: rack.id }, rack_code: { $regex: `^${rackCode.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' } });
  if (duplicate) { res.status(409).json({ error: 'That rack name already exists in this storage location.' }); return; }

  const oldRows = Number(rack.rows || rack.rows_count || 0);
  const oldColumns = Number(rack.columns || rack.columns_count || 0);
  const dimensionsChanged = rows !== oldRows || columns !== oldColumns;
  const oldCells = (rack.cells || []) as any[];
  const oldLocationIds = oldCells.map((cell) => cell.shelf_location_id).filter(Boolean);
  if (dimensionsChanged && oldLocationIds.length) {
    const batches = await ctx.find('batches', { tenant_id: req.user!.tenantId, shelf_location_id: { $in: oldLocationIds }, status: { $nin: ['DISPATCHED', 'CANCELLED', 'REJECTED'] } });
    const hasStock = batches.some((batch: any) => Number(batch.quantity || 0) > Number(batch.dispatched_quantity || 0) + Number(batch.recalled_quantity || 0));
    if (hasStock) { res.status(409).json({ error: 'Move or dispatch the stock before changing rack dimensions.' }); return; }
  }

  let cells: any[];
  try {
    cells = await withTransaction(async (tx) => {
    await tx.updateOne('warehouses', { id: warehouse.id, tenant_id: req.user!.tenantId }, { $set: { capacity: warehouse.capacity } });
    const currentRacks = await tx.find('storage_racks', { tenant_id: req.user!.tenantId, warehouse_id: warehouse.id });
    const currentPositions = currentRacks.reduce((sum: number, current: any) =>
      sum + (String(current.id) === String(rack.id) ? 0 : (Array.isArray(current.cells) ? current.cells.length : 0)), 0);
    if (currentPositions + rows * columns > Number(warehouse.capacity)) {
      throw Object.assign(new Error(`This godown can have at most ${warehouse.capacity} positions. Other racks already use ${currentPositions}.`), { statusCode: 409 });
    }
    const nextCells: any[] = [];
    if (dimensionsChanged) {
      await tx.deleteMany('shelf_locations', { tenant_id: req.user!.tenantId, id: { $in: oldLocationIds } });
      for (let row = 1; row <= rows; row++) for (let column = 1; column <= columns; column++) {
        const shelf = `S${row}`;
        const position = `P${column}`;
        const locationCode = locationCodeFor(warehouse.name, rackCode, row, column);
        const locationId = await tx.insert('shelf_locations', { tenant_id: req.user!.tenantId, location_code: locationCode, description: `${warehouse.name} · ${rackCode} · Shelf ${shelf}, Position ${position}`, warehouse: warehouse.name, rack: rackCode, shelf: `${shelf}-${position}`, is_active: 1 });
        nextCells.push({ row, column, cell_code: `${rackCode}-${shelf}-${position}`, shelf_location_id: locationId, location_code: locationCode });
      }
    } else {
      for (const cell of oldCells) {
        const shelf = `S${cell.row}`;
        const position = `P${cell.column}`;
        const locationCode = locationCodeFor(warehouse.name, rackCode, cell.row, cell.column);
        await tx.updateOne('shelf_locations', { id: cell.shelf_location_id, tenant_id: req.user!.tenantId }, { $set: { location_code: locationCode, description: `${warehouse.name} · ${rackCode} · Shelf ${shelf}, Position ${position}`, warehouse: warehouse.name, rack: rackCode, shelf: `${shelf}-${position}` } });
        nextCells.push({ ...cell, cell_code: `${rackCode}-${shelf}-${position}`, location_code: locationCode });
      }
    }
    await tx.updateOne('storage_racks', { id: rack.id, warehouse_id: warehouse.id, tenant_id: req.user!.tenantId }, { $set: { rack_code: rackCode, rows, columns, cells: nextCells } });
    return nextCells;
    });
  } catch (error: any) {
    res.status(error?.statusCode || 500).json({ error: error?.message || 'Could not update rack.' });
    return;
  }

  const updated = await warehouseSnapshot(req.user!.tenantId, String(warehouse.id));
  res.json(updated?.racks.find((item: any) => String(item.id) === String(rack.id)) || { ...rack, rack_code: rackCode, rows, columns, cells });
}

export async function removeRack(req: Request, res: Response): Promise<void> {
  if (!isValidId(req.params.id) || !isValidId(req.params.rackId)) { res.status(400).json({ error: 'Invalid rack.' }); return; }
  const ctx = await getContext();
  const rack = await ctx.findOne('storage_racks', { id: req.params.rackId, warehouse_id: req.params.id, tenant_id: req.user!.tenantId });
  if (!rack) { res.status(404).json({ error: 'Rack not found.' }); return; }
  const ids = (rack.cells || []).map((cell: any) => cell.shelf_location_id).filter(Boolean);
  const candidateBatches = ids.length ? await ctx.find('batches', { tenant_id: req.user!.tenantId, shelf_location_id: { $in: ids }, status: { $nin: ['DISPATCHED', 'CANCELLED', 'REJECTED'] } }) : [];
  const occupied = candidateBatches.some((batch: any) => Number(batch.quantity || 0) > Number(batch.dispatched_quantity || 0) + Number(batch.recalled_quantity || 0));
  if (occupied) { res.status(409).json({ error: 'This rack contains stock and cannot be removed.' }); return; }
  await withTransaction(async tx => {
    await tx.deleteMany('shelf_locations', { tenant_id: req.user!.tenantId, id: { $in: ids } });
    await tx.deleteOne('storage_racks', { id: rack.id, tenant_id: req.user!.tenantId });
  });
  res.json({ id: rack.id, deleted: true });
}
