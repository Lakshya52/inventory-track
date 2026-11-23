import { Request, Response } from 'express';
import { getContext, isValidId, withTransaction } from '../config/database';
import { divisionFilter, divisionStamp } from '../utils/division';
import {
  buildInventoryResponse,
  getCached,
  InventoryAggregate,
  setCached,
} from './inventoryShared';

function validName(value: unknown): string { return typeof value === 'string' ? value.trim().slice(0, 120) : ''; }
function positiveInt(value: unknown, max: number): number { const n = Number(value); return Number.isInteger(n) && n > 0 && n <= max ? n : 0; }
function locationCodeFor(warehouse: string, rack: string, row: number, column: number): string {
  const clean = (value: string, max: number) => value.replace(/\s+/g, '-').toUpperCase().slice(0, max).replace(/-+$/g, '');
  return `${clean(warehouse, 38)}-${clean(rack, 34)}-S${row}-P${column}`.slice(0, 100);
}

async function warehouseSnapshot(req: Request, warehouseId: string) {
  const tenantId = req.user!.tenantId;
  const df = divisionFilter(req);
  const ctx = await getContext();
  const warehouse = await ctx.findOne('warehouses', { id: warehouseId, tenant_id: tenantId, ...df });
  if (!warehouse) return null;
  // Creation order (ObjectId is time-ordered) — not alphabetical, so Rack10
  // never jumps next to Rack1 ahead of Rack2.
  const racks = await ctx.find('storage_racks', { tenant_id: tenantId, warehouse_id: warehouseId, ...df }, { sort: { _id: 1 } });
  const locationIds = racks.flatMap((rack: any) => rack.cells || []).map((cell: any) => cell.shelf_location_id).filter(Boolean);
  // Load-test data puts thousands of bags in each position. Aggregate counts
  // and a bounded sample inside MongoDB instead of shipping every batch here.
  const batchMatch: Record<string, any> = {
    tenant_id: tenantId,
    shelf_location_id: { $in: locationIds },
    status: { $nin: ['DISPATCHED', 'CANCELLED', 'REJECTED'] },
    ...df,
  };
  const [usageRows, detailRows] = locationIds.length ? await Promise.all([
    ctx.aggregate('batches', [
      { $match: batchMatch },
      { $group: {
        _id: '$shelf_location_id',
        used: { $sum: { $max: [
          { $subtract: [
            { $subtract: [
              { $ifNull: ['$quantity', 0] },
              { $ifNull: ['$dispatched_quantity', 0] },
            ] },
            { $ifNull: ['$recalled_quantity', 0] },
          ] },
          0,
        ] } },
      } },
    ]),
    ctx.aggregate('batches', [
      { $match: batchMatch },
      { $sort: { _id: -1 } },
      { $group: { _id: '$shelf_location_id', batches: { $push: {
        id: '$_id',
        product_id: '$product_id',
        batch_number: { $ifNull: ['$parent_batch_number', '$batch_number'] },
        product_name: '$product_name',
        product_sku: '$product_sku',
        quantity: '$quantity',
        dispatched_quantity: '$dispatched_quantity',
        recalled_quantity: '$recalled_quantity',
        uom: '$uom',
        manufacturing_date: '$manufacturing_date',
        expiry_date: '$expiry_date',
        status: '$status',
      } } } },
      { $project: { batches: { $slice: ['$batches', 10] } } },
    ]),
  ]) : [[], []];
  const usedByLocation = new Map(usageRows.map((row: any) => [String(row._id), Number(row.used || 0)]));
  const locationToBatches = new Map(detailRows.map((row: any) => [String(row._id), row.batches || []]));
  const productIds = [...new Set(detailRows.flatMap((row: any) => (row.batches || []).map((batch: any) => batch.product_id)).filter(Boolean))];
  const products = productIds.length ? await ctx.find('products', { tenant_id: tenantId, id: { $in: productIds }, ...df }) : [];
  const productsById = new Map(products.map((product: any) => [String(product.id), product]));
  const locations = locationIds.length ? await ctx.find('shelf_locations', { tenant_id: tenantId, id: { $in: locationIds }, ...df }) : [];
  const locationCodes = new Map(locations.map((row: any) => [String(row.id), row.location_code]));
  const enrichedRacks = await Promise.all(racks.map(async (rack: any) => {
    const cells = await Promise.all((rack.cells || []).map(async (cell: any) => {
      const stored = locationToBatches.get(String(cell.shelf_location_id)) || [];
      const used = usedByLocation.get(String(cell.shelf_location_id)) || 0;
      const shelf = `S${cell.row}`;
      const position = `P${cell.column}`;
      const locationCode = locationCodeFor(warehouse.name, rack.rack_code, cell.row, cell.column);
      const cellCode = `${rack.rack_code}-${shelf}-${position}`;
      const existingLocationCode = locationCodes.get(String(cell.shelf_location_id));
      if (existingLocationCode && existingLocationCode !== locationCode) {
        await ctx.updateOne('shelf_locations', { id: cell.shelf_location_id, tenant_id: tenantId, ...df }, { $set: { location_code: locationCode, description: `${warehouse.name} · ${rack.rack_code} · Shelf ${shelf}, Position ${position}`, warehouse: warehouse.name, rack: rack.rack_code, shelf: `${shelf}-${position}` } });
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
  const rows = await ctx.find('warehouses', { tenant_id: req.user!.tenantId, ...divisionFilter(req) }, { sort: { name: 1 } });
  const data = await Promise.all(rows.map((row: any) => warehouseSnapshot(req, String(row.id))));
  res.json(data.filter(Boolean));
}

export async function listInventory(req: Request, res: Response): Promise<void> {
  const tenantId = req.user!.tenantId;
  const df = divisionFilter(req);
  const ctx = await getContext();
  const cacheKey = `${tenantId}|${JSON.stringify(df)}`;
  const forceRefresh = String(req.query.refresh || '') === '1';
  let aggregates = forceRefresh ? null : getCached<InventoryAggregate[]>(cacheKey);

  if (!aggregates) {
  // Do the heavy work inside MongoDB. The previous version shipped up to 500
  // raw batches PLUS six complete master collections (10k products, 4k shelf
  // locations...) and grouped them in the browser — slow and, because of the
  // 500-row cap, it only ever counted the most recent batches. One grouped
  // pass over every live batch fixes both problems.
  const groups = await ctx.aggregate('batches', [
    {
      $match: {
        tenant_id: tenantId,
        status: { $nin: ['DISPATCHED', 'CANCELLED', 'REJECTED'] },
        ...df,
      },
    },
    {
      $addFields: {
        remaining: {
          $max: [{
            $subtract: [
              {
                $subtract: [
                  { $ifNull: ['$quantity', 0] },
                  { $ifNull: ['$dispatched_quantity', 0] },
                ],
              },
              { $ifNull: ['$recalled_quantity', 0] },
            ],
          }, 0],
        },
      },
    },
    { $match: { remaining: { $gt: 0 } } },
    {
      $group: {
        _id: {
          product_id: { $ifNull: ['$product_id', ''] },
          grade_id: { $ifNull: ['$grade_id', ''] },
          bag_quantity_id: { $ifNull: ['$bag_quantity_id', ''] },
          package_quantity: { $ifNull: ['$package_quantity', ''] },
          uom: { $ifNull: ['$uom', ''] },
        },
        count: { $sum: '$remaining' },
        totalContent: {
          $sum: {
            $multiply: [
              '$remaining',
              {
                $cond: [
                  { $gt: [{ $ifNull: ['$package_quantity', 0] }, 0] },
                  { $ifNull: ['$package_quantity', 1] },
                  1,
                ],
              },
            ],
          },
        },
        product_name: { $first: '$product_name' },
        product_sku: { $first: '$product_sku' },
        bag_quantity_id: { $first: '$bag_quantity_id' },
        package_quantity: { $first: '$package_quantity' },
        uom: { $first: '$uom' },
        locations: { $addToSet: '$shelf_location_id' },
      },
    },
  ]);

  // Resolve only the masters actually referenced by the grouped rows, with a
  // small projection, instead of loading every product/grade/bag in the tenant.
  const productIds = [...new Set(groups.map((row: any) => String(row._id.product_id)).filter(Boolean))];
  const gradeIds = [...new Set(groups.map((row: any) => String(row._id.grade_id)).filter(Boolean))];
  const bagIds = [...new Set(groups.map((row: any) => String(row.bag_quantity_id)).filter(Boolean))];
  const [products, grades, bags] = await Promise.all([
    productIds.length
      ? ctx.find('products', { tenant_id: tenantId, id: { $in: productIds }, ...df }, { projection: { _id: 0, id: 1, name: 1, sku: 1, grade: 1 } })
      : [],
    gradeIds.length
      ? ctx.find('grades', { id: { $in: gradeIds }, ...df }, { projection: { _id: 0, id: 1, name: 1 } })
      : [],
    bagIds.length
      ? ctx.find('bag_quantities', { id: { $in: bagIds } }, { projection: { _id: 0, id: 1, name: 1, quantity: 1, unit: 1 } })
      : [],
  ]);
  const productsById = new Map(products.map((row: any) => [String(row.id), row]));
  const gradesById = new Map(grades.map((row: any) => [String(row.id), row]));
  const bagsById = new Map(bags.map((row: any) => [String(row.id), row]));

  aggregates = groups.map((row: any) => {
    const product = productsById.get(String(row._id.product_id));
    const bag = bagsById.get(String(row.bag_quantity_id));
    return {
      product_id: row._id.product_id,
      grade_id: row._id.grade_id,
      product_name: row.product_name || product?.name || null,
      product_sku: row.product_sku || product?.sku || null,
      product_grade: product?.grade || null,
      grade_name: gradesById.get(String(row._id.grade_id))?.name || null,
      bag_quantity_id: row.bag_quantity_id || null,
      bag_quantity_name: bag?.name || null,
      bag_quantity: bag?.quantity ?? null,
      bag_quantity_unit: bag?.unit || null,
      package_quantity: row.package_quantity ?? null,
      uom: row.uom || 'units',
      remaining_quantity: row.count,
      location_keys: (row.locations || []).map((location: any) => String(location ?? '')),
    };
  });
    setCached(cacheKey, aggregates);
  }

  res.json(buildInventoryResponse(aggregates, {
    q: String(req.query.q || ''),
    page: Number(req.query.page),
    limit: Number(req.query.limit),
  }));
}

/** Storage locations always belong to one concrete division. */
async function resolveWarehouseDivision(ctx: any, tenantId: string | number, divisionId: unknown): Promise<{ id?: string; error?: string }> {
  const id = String(divisionId ?? '').trim();
  if (!id || !isValidId(id)) return { error: 'Select a division for this storage location.' };
  const division = await ctx.findOne('divisions', { id, tenant_id: tenantId, is_active: 1 }, { projection: { _id: 0, id: 1 } });
  if (!division) return { error: 'That division was not found or is deactivated.' };
  return { id: String(division.id) };
}

export async function createWarehouse(req: Request, res: Response): Promise<void> {
  const name = validName(req.body.name); const capacity = positiveInt(req.body.capacity, 1_000_000_000);
  if (!name || !capacity) { res.status(400).json({ error: 'Enter a warehouse name and a positive capacity.' }); return; }
  const ctx = await getContext();
  const division = await resolveWarehouseDivision(ctx, req.user!.tenantId, req.body.division_id);
  if (division.error) { res.status(400).json({ error: division.error }); return; }
  const existing = await ctx.findOne('warehouses', { tenant_id: req.user!.tenantId, division_id: division.id, name: { $regex: `^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' } });
  if (existing) { res.status(409).json({ error: 'A storage location with that name already exists in this division.' }); return; }
  const id = await ctx.insert('warehouses', { tenant_id: req.user!.tenantId, name, capacity, is_active: 1, division_id: division.id });
  res.status(201).json(await warehouseSnapshot(req, id));
}

export async function getWarehouse(req: Request, res: Response): Promise<void> {
  if (!isValidId(req.params.id)) { res.status(400).json({ error: 'Invalid storage location.' }); return; }
  const warehouse = await warehouseSnapshot(req, req.params.id);
  if (!warehouse) { res.status(404).json({ error: 'Storage location not found.' }); return; }
  res.json(warehouse);
}

export async function updateWarehouse(req: Request, res: Response): Promise<void> {
  if (!isValidId(req.params.id)) { res.status(400).json({ error: 'Invalid storage location.' }); return; }
  const name = validName(req.body.name); const capacity = positiveInt(req.body.capacity, 1_000_000_000);
  if (!name || !capacity) { res.status(400).json({ error: 'Enter a warehouse name and positive capacity.' }); return; }
  const ctx = await getContext();
  const df = divisionFilter(req);
  const warehouse = await ctx.findOne('warehouses', { id: req.params.id, tenant_id: req.user!.tenantId, ...df });
  if (!warehouse) { res.status(404).json({ error: 'Storage location not found.' }); return; }
  const division = await resolveWarehouseDivision(ctx, req.user!.tenantId, req.body.division_id);
  if (division.error) { res.status(400).json({ error: division.error }); return; }
  const duplicates = await ctx.findOne('warehouses', { tenant_id: req.user!.tenantId, id: { $ne: req.params.id }, division_id: division.id, name: { $regex: `^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' } });
  if (duplicates) { res.status(409).json({ error: 'A storage location with that name already exists in this division.' }); return; }
  const snapshot = await warehouseSnapshot(req, req.params.id);
  const occupied = Number(snapshot?.occupied_capacity || 0);
  const positions = (snapshot?.racks || []).reduce((sum: number, rack: any) => sum + (rack.cells || []).length, 0);
  if (capacity < positions) { res.status(409).json({ error: `Capacity cannot be below the ${positions} storage positions already configured.` }); return; }
  if (capacity < occupied) { res.status(409).json({ error: `Capacity cannot be below the ${occupied} units currently stored.` }); return; }
  await ctx.updateOne('warehouses', { id: req.params.id, tenant_id: req.user!.tenantId, ...df }, { $set: { name, capacity, division_id: division.id } });
  res.json(await warehouseSnapshot(req, req.params.id) ?? { id: req.params.id, name, capacity, division_id: division.id });
}

export async function listWarehouseRacks(req: Request, res: Response): Promise<void> { await getWarehouse(req, res); }

export async function createRack(req: Request, res: Response): Promise<void> {
  if (!isValidId(req.params.id)) { res.status(400).json({ error: 'Invalid storage location.' }); return; }
  const rackCode = validName(req.body.name); const rows = positiveInt(req.body.rows, 30); const columns = positiveInt(req.body.columns, 30);
  if (!rackCode || !rows || !columns || rows * columns > 300) { res.status(400).json({ error: 'Enter a rack name and dimensions with no more than 300 cells.' }); return; }
  const ctx = await getContext();
  const df = divisionFilter(req);
  const warehouse = await ctx.findOne('warehouses', { id: req.params.id, tenant_id: req.user!.tenantId, ...df });
  if (!warehouse) { res.status(404).json({ error: 'Storage location not found.' }); return; }
  const exists = await ctx.findOne('storage_racks', { tenant_id: req.user!.tenantId, warehouse_id: warehouse.id, rack_code: rackCode, ...df });
  if (exists) { res.status(409).json({ error: 'That rack name already exists in this storage location.' }); return; }
  let rackId: string;
  try {
    rackId = await withTransaction(async tx => {
      await tx.updateOne('warehouses', { id: warehouse.id, tenant_id: req.user!.tenantId, ...df }, { $set: { capacity: warehouse.capacity } });
      const currentRacks = await tx.find('storage_racks', { tenant_id: req.user!.tenantId, warehouse_id: warehouse.id, ...df });
      const currentPositions = currentRacks.reduce((sum: number, rack: any) => sum + (Array.isArray(rack.cells) ? rack.cells.length : 0), 0);
      if (currentPositions + rows * columns > Number(warehouse.capacity)) {
        throw Object.assign(new Error(`This godown can have at most ${warehouse.capacity} positions. It already has ${currentPositions}.`), { statusCode: 409 });
      }
      const cells: any[] = [];
      for (let row = 1; row <= rows; row++) for (let column = 1; column <= columns; column++) {
        const shelf = `S${row}`;
        const position = `P${column}`;
        const locationCode = locationCodeFor(warehouse.name, rackCode, row, column);
        const locationId = await tx.insert('shelf_locations', { tenant_id: req.user!.tenantId, location_code: locationCode, description: `${warehouse.name} · ${rackCode} · Shelf ${shelf}, Position ${position}`, warehouse: warehouse.name, rack: rackCode, shelf: `${shelf}-${position}`, is_active: 1, division_id: warehouse.division_id ?? null });
        cells.push({ row, column, cell_code: `${rackCode}-${shelf}-${position}`, shelf_location_id: locationId, location_code: locationCode });
      }
      return tx.insert('storage_racks', { tenant_id: req.user!.tenantId, warehouse_id: warehouse.id, rack_code: rackCode, rows, columns, cells, division_id: divisionStamp(req) });
    });
  } catch (error: any) {
    res.status(error?.statusCode || 500).json({ error: error?.message || 'Could not create rack.' });
    return;
  }
  const updated = await warehouseSnapshot(req, String(warehouse.id));
  res.status(201).json(updated?.racks.find((rack: any) => String(rack.id) === rackId));
}

export async function updateRack(req: Request, res: Response): Promise<void> {
  if (!isValidId(req.params.id) || !isValidId(req.params.rackId)) { res.status(400).json({ error: 'Invalid rack.' }); return; }
  const rackCode = validName(req.body.name);
  const rows = positiveInt(req.body.rows, 30);
  const columns = positiveInt(req.body.columns, 30);
  if (!rackCode || !rows || !columns || rows * columns > 300) { res.status(400).json({ error: 'Enter a rack name and dimensions with no more than 300 cells.' }); return; }

  const ctx = await getContext();
  const df = divisionFilter(req);
  const warehouse = await ctx.findOne('warehouses', { id: req.params.id, tenant_id: req.user!.tenantId, ...df });
  if (!warehouse) { res.status(404).json({ error: 'Storage location not found.' }); return; }
  const rack = await ctx.findOne('storage_racks', { id: req.params.rackId, warehouse_id: warehouse.id, tenant_id: req.user!.tenantId, ...df });
  if (!rack) { res.status(404).json({ error: 'Rack not found.' }); return; }
  const duplicate = await ctx.findOne('storage_racks', { tenant_id: req.user!.tenantId, warehouse_id: warehouse.id, id: { $ne: rack.id }, ...df, rack_code: { $regex: `^${rackCode.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' } });
  if (duplicate) { res.status(409).json({ error: 'That rack name already exists in this storage location.' }); return; }

  const oldRows = Number(rack.rows || rack.rows_count || 0);
  const oldColumns = Number(rack.columns || rack.columns_count || 0);
  const dimensionsChanged = rows !== oldRows || columns !== oldColumns;
  const oldCells = (rack.cells || []) as any[];
  const oldLocationIds = oldCells.map((cell) => cell.shelf_location_id).filter(Boolean);
  if (dimensionsChanged && oldLocationIds.length) {
    const batches = await ctx.find('batches', { tenant_id: req.user!.tenantId, shelf_location_id: { $in: oldLocationIds }, status: { $nin: ['DISPATCHED', 'CANCELLED', 'REJECTED'] }, ...df });
    const hasStock = batches.some((batch: any) => Number(batch.quantity || 0) > Number(batch.dispatched_quantity || 0) + Number(batch.recalled_quantity || 0));
    if (hasStock) { res.status(409).json({ error: 'Move or dispatch the stock before changing rack dimensions.' }); return; }
  }

  let cells: any[];
  try {
    cells = await withTransaction(async (tx) => {
    await tx.updateOne('warehouses', { id: warehouse.id, tenant_id: req.user!.tenantId, ...df }, { $set: { capacity: warehouse.capacity } });
    const currentRacks = await tx.find('storage_racks', { tenant_id: req.user!.tenantId, warehouse_id: warehouse.id, ...df });
    const currentPositions = currentRacks.reduce((sum: number, current: any) =>
      sum + (String(current.id) === String(rack.id) ? 0 : (Array.isArray(current.cells) ? current.cells.length : 0)), 0);
    if (currentPositions + rows * columns > Number(warehouse.capacity)) {
      throw Object.assign(new Error(`This godown can have at most ${warehouse.capacity} positions. Other racks already use ${currentPositions}.`), { statusCode: 409 });
    }
    const nextCells: any[] = [];
    if (dimensionsChanged) {
      await tx.deleteMany('shelf_locations', { tenant_id: req.user!.tenantId, id: { $in: oldLocationIds }, ...df });
      for (let row = 1; row <= rows; row++) for (let column = 1; column <= columns; column++) {
        const shelf = `S${row}`;
        const position = `P${column}`;
        const locationCode = locationCodeFor(warehouse.name, rackCode, row, column);
        const locationId = await tx.insert('shelf_locations', { tenant_id: req.user!.tenantId, location_code: locationCode, description: `${warehouse.name} · ${rackCode} · Shelf ${shelf}, Position ${position}`, warehouse: warehouse.name, rack: rackCode, shelf: `${shelf}-${position}`, is_active: 1, division_id: warehouse.division_id ?? null });
        nextCells.push({ row, column, cell_code: `${rackCode}-${shelf}-${position}`, shelf_location_id: locationId, location_code: locationCode });
      }
    } else {
      for (const cell of oldCells) {
        const shelf = `S${cell.row}`;
        const position = `P${cell.column}`;
        const locationCode = locationCodeFor(warehouse.name, rackCode, cell.row, cell.column);
        await tx.updateOne('shelf_locations', { id: cell.shelf_location_id, tenant_id: req.user!.tenantId, ...df }, { $set: { location_code: locationCode, description: `${warehouse.name} · ${rackCode} · Shelf ${shelf}, Position ${position}`, warehouse: warehouse.name, rack: rackCode, shelf: `${shelf}-${position}` } });
        nextCells.push({ ...cell, cell_code: `${rackCode}-${shelf}-${position}`, location_code: locationCode });
      }
    }
    await tx.updateOne('storage_racks', { id: rack.id, warehouse_id: warehouse.id, tenant_id: req.user!.tenantId, ...df }, { $set: { rack_code: rackCode, rows, columns, cells: nextCells } });
    return nextCells;
    });
  } catch (error: any) {
    res.status(error?.statusCode || 500).json({ error: error?.message || 'Could not update rack.' });
    return;
  }

  const updated = await warehouseSnapshot(req, String(warehouse.id));
  res.json(updated?.racks.find((item: any) => String(item.id) === String(rack.id)) || { ...rack, rack_code: rackCode, rows, columns, cells });
}

export async function removeWarehouse(req: Request, res: Response): Promise<void> {
  if (!isValidId(req.params.id)) { res.status(400).json({ error: 'Invalid storage location.' }); return; }
  const ctx = await getContext();
  const df = divisionFilter(req);
  const warehouse = await ctx.findOne('warehouses', { id: req.params.id, tenant_id: req.user!.tenantId, ...df });
  if (!warehouse) { res.status(404).json({ error: 'Storage location not found.' }); return; }

  const racks = await ctx.find('storage_racks', { tenant_id: req.user!.tenantId, warehouse_id: warehouse.id, ...df });
  const rackIds = racks.map((rack: any) => rack.id);
  const locationIds = racks.flatMap((rack: any) => (rack.cells || []).map((cell: any) => cell.shelf_location_id).filter(Boolean));
  // Refuse to remove a godown that still holds stock — removing it would orphan
  // those batches. Dispatched/cancelled batches do not count as live stock.
  const candidateBatches = locationIds.length
    ? await ctx.find('batches', {
        tenant_id: req.user!.tenantId,
        shelf_location_id: { $in: locationIds },
        status: { $nin: ['DISPATCHED', 'CANCELLED', 'REJECTED'] },
        ...df,
      })
    : [];
  const occupied = candidateBatches.some((batch: any) =>
    Number(batch.quantity || 0) > Number(batch.dispatched_quantity || 0) + Number(batch.recalled_quantity || 0));
  if (occupied) {
    res.status(409).json({ error: 'This storage location contains stock. Move or dispatch the stock before deleting it.' });
    return;
  }

  await withTransaction(async (tx) => {
    if (locationIds.length) await tx.deleteMany('shelf_locations', { tenant_id: req.user!.tenantId, id: { $in: locationIds }, ...df });
    if (rackIds.length) await tx.deleteMany('storage_racks', { tenant_id: req.user!.tenantId, id: { $in: rackIds }, ...df });
    await tx.deleteOne('warehouses', { id: warehouse.id, tenant_id: req.user!.tenantId, ...df });
  });
  res.json({ id: warehouse.id, deleted: true });
}

export async function removeRack(req: Request, res: Response): Promise<void> {
  if (!isValidId(req.params.id) || !isValidId(req.params.rackId)) { res.status(400).json({ error: 'Invalid rack.' }); return; }
  const ctx = await getContext();
  const df = divisionFilter(req);
  const rack = await ctx.findOne('storage_racks', { id: req.params.rackId, warehouse_id: req.params.id, tenant_id: req.user!.tenantId, ...df });
  if (!rack) { res.status(404).json({ error: 'Rack not found.' }); return; }
  const ids = (rack.cells || []).map((cell: any) => cell.shelf_location_id).filter(Boolean);
  const candidateBatches = ids.length ? await ctx.find('batches', { tenant_id: req.user!.tenantId, shelf_location_id: { $in: ids }, status: { $nin: ['DISPATCHED', 'CANCELLED', 'REJECTED'] }, ...df }) : [];
  const occupied = candidateBatches.some((batch: any) => Number(batch.quantity || 0) > Number(batch.dispatched_quantity || 0) + Number(batch.recalled_quantity || 0));
  if (occupied) { res.status(409).json({ error: 'This rack contains stock and cannot be removed.' }); return; }
  await withTransaction(async tx => {
    await tx.deleteMany('shelf_locations', { tenant_id: req.user!.tenantId, id: { $in: ids }, ...df });
    await tx.deleteOne('storage_racks', { id: rack.id, tenant_id: req.user!.tenantId, ...df });
  });
  res.json({ id: rack.id, deleted: true });
}
