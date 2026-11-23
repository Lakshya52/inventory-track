import { Request, Response } from 'express';
import { query, withTransaction } from '../config/database';
import { ResultSetHeader, RowDataPacket } from 'mysql2';
import { divisionStamp, divisionWhere } from '../utils/division';
import {
  buildInventoryResponse,
  getCached,
  InventoryAggregate,
  setCached,
} from './inventoryShared';

function validName(value: unknown): string { return typeof value === 'string' ? value.trim().slice(0, 120) : ''; }
function positiveInt(value: unknown, max: number): number { const n = Number(value); return Number.isInteger(n) && n > 0 && n <= max ? n : 0; }
function parseJson(value: any): any[] { if (Array.isArray(value)) return value; if (typeof value !== 'string') return []; try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed : []; } catch { return []; } }
function locationCodeFor(warehouse: string, rack: string, row: number, column: number): string {
  const clean = (value: string, max: number) => value.replace(/\s+/g, '-').toUpperCase().slice(0, max).replace(/-+$/g, '');
  return `${clean(warehouse, 38)}-${clean(rack, 34)}-S${row}-P${column}`.slice(0, 100);
}

async function snapshot(req: Request, warehouseId: string) {
  const tenantId = req.user!.tenantId;
  const dv = divisionWhere(req);
  const warehouses = await query<RowDataPacket[]>(`SELECT * FROM warehouses WHERE id = ? AND tenant_id = ?${dv.sql} LIMIT 1`, [warehouseId, tenantId, ...dv.params]);
  if (!warehouses.length) return null;
  const warehouse = warehouses[0];
  // Creation order (auto-increment id) — not alphabetical, so Rack10 never
  // jumps next to Rack1 ahead of Rack2.
  const racks = await query<RowDataPacket[]>(`SELECT * FROM storage_racks WHERE warehouse_id = ? AND tenant_id = ?${dv.sql} ORDER BY id ASC`, [warehouseId, tenantId, ...dv.params]);
  const locations = await query<RowDataPacket[]>(`SELECT id, location_code FROM shelf_locations WHERE tenant_id = ?${dv.sql}`, [tenantId, ...dv.params]);
  const locationCodes = new Map(locations.map(row => [String(row.id), row.location_code]));
  const cellsAll = racks.flatMap(rack => parseJson(rack.cells));
  const ids = cellsAll.map(cell => String(cell.shelf_location_id));
  let batches: RowDataPacket[] = [];
  if (ids.length) {
    const marks = ids.map(() => '?').join(',');
    batches = await query<RowDataPacket[]>(`SELECT * FROM batches WHERE tenant_id = ?${dv.sql} AND shelf_location_id IN (${marks}) AND status NOT IN ('DISPATCHED', 'CANCELLED', 'REJECTED')`, [tenantId, ...dv.params, ...ids]);
  }
  const productIds = [...new Set(batches.map(batch => batch.product_id).filter(Boolean).map(String))];
  let products: RowDataPacket[] = [];
  if (productIds.length) {
    const marks = productIds.map(() => '?').join(',');
    products = await query<RowDataPacket[]>(`SELECT id, name, sku, description, cas_number, molecular_formula, purity, grade, storage_conditions, hazard_classification, physical_state, hsn_code, manufacturer FROM products WHERE tenant_id = ?${dv.sql} AND id IN (${marks})`, [tenantId, ...dv.params, ...productIds]);
  }
  const productsById = new Map(products.map(product => [String(product.id), product]));
  const perLocation = new Map<string, any[]>();
  batches.forEach(batch => perLocation.set(String(batch.shelf_location_id), [...(perLocation.get(String(batch.shelf_location_id)) || []), batch]));
  const enriched = await Promise.all(racks.map(async rack => {
    const cells = await Promise.all(parseJson(rack.cells).map(async cell => {
      const stored = perLocation.get(String(cell.shelf_location_id)) || [];
      const used = stored.reduce((sum, batch) => sum + Math.max(0, Number(batch.quantity || 0) - Number(batch.dispatched_quantity || 0) - Number(batch.recalled_quantity || 0)), 0);
      const shelf = `S${cell.row}`;
      const position = `P${cell.column}`;
      const locationCode = locationCodeFor(warehouse.name, rack.rack_code, cell.row, cell.column);
      const cellCode = `${rack.rack_code}-${shelf}-${position}`;
      const existingLocationCode = locationCodes.get(String(cell.shelf_location_id));
      if (existingLocationCode && existingLocationCode !== locationCode) {
        await query(`UPDATE shelf_locations SET location_code = ?, description = ?, warehouse = ?, rack = ?, shelf = ? WHERE id = ? AND tenant_id = ?${dv.sql}`, [locationCode, `${warehouse.name} · ${rack.rack_code} · Shelf ${shelf}, Position ${position}`, warehouse.name, rack.rack_code, `${shelf}-${position}`, cell.shelf_location_id, tenantId, ...dv.params]);
      }
      return { ...cell, cell_code: cellCode, location_code: locationCode, occupied: used > 0, used_capacity: used, batches: stored.map(batch => {
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
    return { ...rack, cells, occupied_cells: cells.filter(cell => cell.occupied).length, total_cells: cells.length };
  }));
  const occupied = enriched.flatMap(rack => rack.cells).reduce((sum, cell) => sum + Number(cell.used_capacity || 0), 0);
  return { ...warehouse, racks: enriched, occupied_capacity: occupied, utilization_percent: warehouse.capacity ? Math.min(100, Math.round(occupied / warehouse.capacity * 100)) : 0 };
}

export async function listWarehouses(req: Request, res: Response): Promise<void> {
  const dv = divisionWhere(req);
  const rows = await query<RowDataPacket[]>(`SELECT id FROM warehouses WHERE tenant_id = ?${dv.sql} ORDER BY name`, [req.user!.tenantId, ...dv.params]);
  res.json((await Promise.all(rows.map(row => snapshot(req, String(row.id))))).filter(Boolean));
}

export async function listInventory(req: Request, res: Response): Promise<void> {
  const tenantId = req.user!.tenantId;
  const dv = divisionWhere(req);
  const dvP = divisionWhere(req, 'p.division_id');
  const dvG = divisionWhere(req, 'g.division_id');
  const cacheKey = `${tenantId}|${JSON.stringify(dv)}|${JSON.stringify(dvP)}|${JSON.stringify(dvG)}`;
  const forceRefresh = String(req.query.refresh || '') === '1';
  type CachedStock = { aggregates: InventoryAggregate[]; occupiedPositions: number };
  let cached = forceRefresh ? null : getCached<CachedStock>(cacheKey);

  if (!cached) {
  // Aggregate inside MySQL. The old query streamed every live batch (100k+)
  // into Node with joins, then grouped it in JS. One GROUP BY returns a handful
  // of compact rows and keeps the totals correct across the whole warehouse.
  const [rows, positionRows] = await Promise.all([
    query<RowDataPacket[]>(
      `SELECT b.product_id, b.grade_id, b.bag_quantity_id, b.package_quantity, b.uom,
              SUM(GREATEST(b.quantity - COALESCE(b.dispatched_quantity, 0) - COALESCE(b.recalled_quantity, 0), 0)) AS remaining,
              p.name AS product_name, p.sku AS product_sku, p.grade AS product_grade,
              g.name AS grade_name,
              q.name AS bag_quantity_name, q.quantity AS bag_quantity,
              q.unit AS bag_quantity_unit
       FROM batches b
       LEFT JOIN products p ON p.id = b.product_id AND p.tenant_id = b.tenant_id${dvP.sql}
       LEFT JOIN grades g ON g.id = b.grade_id${dvG.sql}
       LEFT JOIN bag_quantities q ON q.id = b.bag_quantity_id
       WHERE b.tenant_id = ?${dv.sql}
         AND b.status NOT IN ('DISPATCHED', 'CANCELLED', 'REJECTED')
       GROUP BY b.product_id, b.grade_id, b.bag_quantity_id, b.package_quantity, b.uom,
                p.name, p.sku, p.grade, g.name, q.name, q.quantity, q.unit
       HAVING SUM(GREATEST(b.quantity - COALESCE(b.dispatched_quantity, 0) - COALESCE(b.recalled_quantity, 0), 0)) > 0`,
      [...dvP.params, ...dvG.params, tenantId, ...dv.params],
    ),
    query<RowDataPacket[]>(
      `SELECT COUNT(DISTINCT shelf_location_id) AS count
       FROM batches
       WHERE tenant_id = ?${dv.sql}
         AND status NOT IN ('DISPATCHED', 'CANCELLED', 'REJECTED')
         AND quantity > COALESCE(dispatched_quantity, 0) + COALESCE(recalled_quantity, 0)`,
      [tenantId, ...dv.params],
    ),
  ]);
  const aggregates: InventoryAggregate[] = rows.map((row) => ({
    product_id: row.product_id,
    grade_id: row.grade_id,
    product_name: row.product_name || null,
    product_sku: row.product_sku || null,
    product_grade: row.product_grade || null,
    grade_name: row.grade_name || null,
    bag_quantity_id: row.bag_quantity_id || null,
    bag_quantity_name: row.bag_quantity_name || null,
    bag_quantity: row.bag_quantity ?? null,
    bag_quantity_unit: row.bag_quantity_unit || null,
    package_quantity: row.package_quantity ?? null,
    uom: row.uom || 'units',
    remaining_quantity: row.remaining,
  }));
    cached = {
      aggregates,
      occupiedPositions: Number(positionRows[0]?.count || 0),
    };
    setCached(cacheKey, cached);
  }

  res.json(buildInventoryResponse(cached.aggregates, {
    q: String(req.query.q || ''),
    page: Number(req.query.page),
    limit: Number(req.query.limit),
    occupiedPositions: cached.occupiedPositions,
  }));
}

/** Storage locations always belong to one concrete division. */
async function resolveWarehouseDivision(tenantId: string | number, divisionId: unknown): Promise<{ id?: number; error?: string }> {
  const id = Number(divisionId);
  if (!divisionId || !Number.isSafeInteger(id) || id < 1) return { error: 'Select a division for this storage location.' };
  const rows = await query<RowDataPacket[]>('SELECT id FROM divisions WHERE id = ? AND tenant_id = ? AND is_active = 1', [id, tenantId]);
  if (rows.length === 0) return { error: 'That division was not found or is deactivated.' };
  return { id: Number(rows[0].id) };
}

export async function createWarehouse(req: Request, res: Response): Promise<void> {
  const name = validName(req.body.name); const capacity = positiveInt(req.body.capacity, 1_000_000_000);
  if (!name || !capacity) { res.status(400).json({ error: 'Enter a warehouse name and a positive capacity.' }); return; }
  const division = await resolveWarehouseDivision(req.user!.tenantId, req.body.division_id);
  if (division.error) { res.status(400).json({ error: division.error }); return; }
  const duplicate = await query<RowDataPacket[]>('SELECT id FROM warehouses WHERE tenant_id = ? AND division_id = ? AND LOWER(name) = LOWER(?) LIMIT 1', [req.user!.tenantId, division.id, name]);
  if (duplicate.length) { res.status(409).json({ error: 'A storage location with that name already exists in this division.' }); return; }
  const result = await query<any>('INSERT INTO warehouses (tenant_id, name, capacity, is_active, division_id) VALUES (?, ?, ?, 1, ?)', [req.user!.tenantId, name, capacity, division.id]);
  res.status(201).json(await snapshot(req, String(result.insertId)));
}

export async function getWarehouse(req: Request, res: Response): Promise<void> {
  const warehouse = await snapshot(req, req.params.id);
  if (!warehouse) { res.status(404).json({ error: 'Storage location not found.' }); return; }
  res.json(warehouse);
}
export async function listWarehouseRacks(req: Request, res: Response): Promise<void> { await getWarehouse(req, res); }

export async function updateWarehouse(req: Request, res: Response): Promise<void> {
  const name = validName(req.body.name); const capacity = positiveInt(req.body.capacity, 1_000_000_000);
  if (!name || !capacity) { res.status(400).json({ error: 'Enter a warehouse name and positive capacity.' }); return; }
  const dv = divisionWhere(req);
  const current = await snapshot(req, req.params.id);
  if (!current) { res.status(404).json({ error: 'Storage location not found.' }); return; }
  const positions = (current.racks || []).reduce((sum: number, rack: any) => sum + (rack.cells || []).length, 0);
  if (capacity < positions) { res.status(409).json({ error: `Capacity cannot be below the ${positions} storage positions already configured.` }); return; }
  if (capacity < Number(current.occupied_capacity)) { res.status(409).json({ error: `Capacity cannot be below the ${current.occupied_capacity} units currently stored.` }); return; }
  const division = await resolveWarehouseDivision(req.user!.tenantId, req.body.division_id);
  if (division.error) { res.status(400).json({ error: division.error }); return; }
  const duplicate = await query<RowDataPacket[]>('SELECT id FROM warehouses WHERE tenant_id = ? AND id <> ? AND division_id = ? AND LOWER(name) = LOWER(?) LIMIT 1', [req.user!.tenantId, req.params.id, division.id, name]);
  if (duplicate.length) { res.status(409).json({ error: 'A storage location with that name already exists in this division.' }); return; }
  await query(`UPDATE warehouses SET name = ?, capacity = ?, division_id = ? WHERE id = ? AND tenant_id = ?${dv.sql}`, [name, capacity, division.id, req.params.id, req.user!.tenantId, ...dv.params]);
  res.json(await snapshot(req, req.params.id));
}

export async function createRack(req: Request, res: Response): Promise<void> {
  const rackCode = validName(req.body.name); const rows = positiveInt(req.body.rows, 30); const columns = positiveInt(req.body.columns, 30);
  if (!rackCode || !rows || !columns || rows * columns > 300) { res.status(400).json({ error: 'Enter a rack name and dimensions with no more than 300 cells.' }); return; }
  const dv = divisionWhere(req);
  const warehouseRows = await query<RowDataPacket[]>(`SELECT * FROM warehouses WHERE id = ? AND tenant_id = ?${dv.sql} LIMIT 1`, [req.params.id, req.user!.tenantId, ...dv.params]);
  if (!warehouseRows.length) { res.status(404).json({ error: 'Storage location not found.' }); return; }
  const duplicate = await query<RowDataPacket[]>(`SELECT id FROM storage_racks WHERE tenant_id = ? AND warehouse_id = ? AND LOWER(rack_code) = LOWER(?)${dv.sql} LIMIT 1`, [req.user!.tenantId, req.params.id, rackCode, ...dv.params]);
  if (duplicate.length) { res.status(409).json({ error: 'That rack name already exists in this storage location.' }); return; }
  try {
    await withTransaction(async conn => {
      const dv = divisionWhere(req);
      const [lockedWarehouse] = await (conn as any).execute(`SELECT id, name, capacity, division_id FROM warehouses WHERE id = ? AND tenant_id = ?${dv.sql} FOR UPDATE`, [req.params.id, req.user!.tenantId, ...dv.params]) as [RowDataPacket[], any];
      if (!lockedWarehouse.length) throw Object.assign(new Error('Storage location not found.'), { statusCode: 404 });
      const warehouseDivisionId = lockedWarehouse[0].division_id ?? null;
      const [existingRacks] = await (conn as any).execute(`SELECT cells FROM storage_racks WHERE tenant_id = ? AND warehouse_id = ?${dv.sql} FOR UPDATE`, [req.user!.tenantId, req.params.id, ...dv.params]) as [RowDataPacket[], any];
      const currentPositions = existingRacks.reduce((sum: number, rack: RowDataPacket) => sum + parseJson(rack.cells).length, 0);
      if (currentPositions + rows * columns > Number(lockedWarehouse[0].capacity)) {
        throw Object.assign(new Error(`This godown can have at most ${lockedWarehouse[0].capacity} positions. It already has ${currentPositions}.`), { statusCode: 409 });
      }
      const cells: any[] = [];
      for (let row = 1; row <= rows; row++) for (let column = 1; column <= columns; column++) {
        const shelf = `S${row}`;
        const position = `P${column}`;
        const locationCode = locationCodeFor(lockedWarehouse[0].name, rackCode, row, column);
        const [loc] = await (conn as any).execute('INSERT INTO shelf_locations (tenant_id, location_code, description, warehouse, rack, shelf, is_active, division_id) VALUES (?, ?, ?, ?, ?, ?, 1, ?)', [req.user!.tenantId, locationCode, `${lockedWarehouse[0].name} · ${rackCode} · Shelf ${shelf}, Position ${position}`, lockedWarehouse[0].name, rackCode, `${shelf}-${position}`, warehouseDivisionId]) as [ResultSetHeader, any];
        cells.push({ row, column, cell_code: `${rackCode}-${shelf}-${position}`, shelf_location_id: String(loc.insertId), location_code: locationCode });
      }
      await conn.execute('INSERT INTO storage_racks (tenant_id, warehouse_id, rack_code, rows_count, columns_count, cells, division_id) VALUES (?, ?, ?, ?, ?, ?, ?)', [req.user!.tenantId, req.params.id, rackCode, rows, columns, JSON.stringify(cells), divisionStamp(req)]);
    });
  } catch (error: any) {
    res.status(error?.statusCode || 500).json({ error: error?.message || 'Could not create rack.' });
    return;
  }
  const updated = await snapshot(req, req.params.id);
  res.status(201).json(updated?.racks.find((rack: any) => rack.rack_code === rackCode));
}

export async function updateRack(req: Request, res: Response): Promise<void> {
  const rackCode = validName(req.body.name);
  const rows = positiveInt(req.body.rows, 30);
  const columns = positiveInt(req.body.columns, 30);
  if (!rackCode || !rows || !columns || rows * columns > 300) { res.status(400).json({ error: 'Enter a rack name and dimensions with no more than 300 cells.' }); return; }
  const dv = divisionWhere(req);

  const warehouses = await query<RowDataPacket[]>(`SELECT * FROM warehouses WHERE id = ? AND tenant_id = ?${dv.sql} LIMIT 1`, [req.params.id, req.user!.tenantId, ...dv.params]);
  if (!warehouses.length) { res.status(404).json({ error: 'Storage location not found.' }); return; }
  const racks = await query<RowDataPacket[]>(`SELECT * FROM storage_racks WHERE id = ? AND warehouse_id = ? AND tenant_id = ?${dv.sql} LIMIT 1`, [req.params.rackId, req.params.id, req.user!.tenantId, ...dv.params]);
  if (!racks.length) { res.status(404).json({ error: 'Rack not found.' }); return; }
  const duplicate = await query<RowDataPacket[]>(`SELECT id FROM storage_racks WHERE tenant_id = ? AND warehouse_id = ? AND id <> ? AND LOWER(rack_code) = LOWER(?)${dv.sql} LIMIT 1`, [req.user!.tenantId, req.params.id, req.params.rackId, rackCode, ...dv.params]);
  if (duplicate.length) { res.status(409).json({ error: 'That rack name already exists in this storage location.' }); return; }

  const oldCells = parseJson(racks[0].cells);
  const oldRows = Number(racks[0].rows_count || racks[0].rows || 0);
  const oldColumns = Number(racks[0].columns_count || racks[0].columns || 0);
  const dimensionsChanged = rows !== oldRows || columns !== oldColumns;
  const ids = oldCells.map(cell => String(cell.shelf_location_id)).filter(Boolean);
  if (dimensionsChanged && ids.length) {
    const marks = ids.map(() => '?').join(',');
    const occupied = await query<RowDataPacket[]>(`SELECT id FROM batches WHERE tenant_id = ?${dv.sql} AND shelf_location_id IN (${marks}) AND quantity > COALESCE(dispatched_quantity, 0) + COALESCE(recalled_quantity, 0) AND status NOT IN ('DISPATCHED', 'CANCELLED', 'REJECTED') LIMIT 1`, [req.user!.tenantId, ...dv.params, ...ids]);
    if (occupied.length) { res.status(409).json({ error: 'Move or dispatch the stock before changing rack dimensions.' }); return; }
  }

  try {
    await withTransaction(async conn => {
      const dv = divisionWhere(req);
      const [lockedWarehouse] = await (conn as any).execute(`SELECT id, name, capacity, division_id FROM warehouses WHERE id = ? AND tenant_id = ?${dv.sql} FOR UPDATE`, [req.params.id, req.user!.tenantId, ...dv.params]) as [RowDataPacket[], any];
      if (!lockedWarehouse.length) throw Object.assign(new Error('Storage location not found.'), { statusCode: 404 });
      const warehouseDivisionId = lockedWarehouse[0].division_id ?? null;
      const [allRacks] = await (conn as any).execute(`SELECT id, cells FROM storage_racks WHERE tenant_id = ? AND warehouse_id = ?${dv.sql} FOR UPDATE`, [req.user!.tenantId, req.params.id, ...dv.params]) as [RowDataPacket[], any];
      const currentPositions = allRacks.reduce((sum: number, rack: RowDataPacket) =>
        sum + (String(rack.id) === String(req.params.rackId) ? 0 : parseJson(rack.cells).length), 0);
      if (currentPositions + rows * columns > Number(lockedWarehouse[0].capacity)) {
        throw Object.assign(new Error(`This godown can have at most ${lockedWarehouse[0].capacity} positions. Other racks already use ${currentPositions}.`), { statusCode: 409 });
      }
      let nextCells: any[] = [];
      if (dimensionsChanged) {
        if (ids.length) {
          const marks = ids.map(() => '?').join(',');
          await conn.execute(`DELETE FROM shelf_locations WHERE tenant_id = ?${dv.sql} AND id IN (${marks})`, [req.user!.tenantId, ...dv.params, ...ids]);
        }
        for (let row = 1; row <= rows; row++) for (let column = 1; column <= columns; column++) {
          const shelf = `S${row}`;
          const position = `P${column}`;
          const locationCode = locationCodeFor(warehouses[0].name, rackCode, row, column);
          // mysql2's promise `execute` resolves through a mixin type that TS sees
          // as untyped, so a generic argument is not allowed here.
          const [location] = await (conn as any).execute('INSERT INTO shelf_locations (tenant_id, location_code, description, warehouse, rack, shelf, is_active, division_id) VALUES (?, ?, ?, ?, ?, ?, 1, ?)', [req.user!.tenantId, locationCode, `${warehouses[0].name} · ${rackCode} · Shelf ${shelf}, Position ${position}`, warehouses[0].name, rackCode, `${shelf}-${position}`, warehouseDivisionId]);
          nextCells.push({ row, column, cell_code: `${rackCode}-${shelf}-${position}`, shelf_location_id: String(location.insertId), location_code: locationCode });
        }
      } else {
        nextCells = oldCells.map(cell => {
          const shelf = `S${cell.row}`;
          const position = `P${cell.column}`;
          const locationCode = locationCodeFor(warehouses[0].name, rackCode, cell.row, cell.column);
          return { ...cell, cell_code: `${rackCode}-${shelf}-${position}`, location_code: locationCode };
        });
      }
      for (const cell of nextCells) {
        const shelf = `S${cell.row}`;
        const position = `P${cell.column}`;
        await conn.execute(`UPDATE shelf_locations SET location_code = ?, description = ?, warehouse = ?, rack = ?, shelf = ? WHERE id = ? AND tenant_id = ?${dv.sql}`, [cell.location_code, `${warehouses[0].name} · ${rackCode} · Shelf ${shelf}, Position ${position}`, warehouses[0].name, rackCode, `${shelf}-${position}`, cell.shelf_location_id, req.user!.tenantId, ...dv.params]);
      }
      await conn.execute(`UPDATE storage_racks SET rack_code = ?, rows_count = ?, columns_count = ?, cells = ? WHERE id = ? AND warehouse_id = ? AND tenant_id = ?${dv.sql}`, [rackCode, rows, columns, JSON.stringify(nextCells), req.params.rackId, req.params.id, req.user!.tenantId, ...dv.params]);
    });
  } catch (error: any) {
    res.status(error?.statusCode || 500).json({ error: error?.message || 'Could not update rack.' });
    return;
  }

  const updated = await snapshot(req, req.params.id);
  res.json(updated?.racks.find((rack: any) => String(rack.id) === String(req.params.rackId)));
}

export async function removeWarehouse(req: Request, res: Response): Promise<void> {
  const dv = divisionWhere(req);
  const rows = await query<RowDataPacket[]>(`SELECT id FROM warehouses WHERE id = ? AND tenant_id = ?${dv.sql} LIMIT 1`, [req.params.id, req.user!.tenantId, ...dv.params]);
  if (!rows.length) { res.status(404).json({ error: 'Storage location not found.' }); return; }
  const racks = await query<RowDataPacket[]>(`SELECT id, cells FROM storage_racks WHERE tenant_id = ? AND warehouse_id = ?${dv.sql}`, [req.user!.tenantId, req.params.id, ...dv.params]);
  const ids = racks.flatMap(rack => parseJson(rack.cells).map(cell => String(cell.shelf_location_id)));
  if (ids.length) {
    const marks = ids.map(() => '?').join(',');
    // Refuse to remove a godown that still holds stock — removing it would
    // orphan those batches. Dispatched/cancelled batches do not count as stock.
    const occupied = await query<RowDataPacket[]>(`SELECT id FROM batches WHERE tenant_id = ?${dv.sql} AND shelf_location_id IN (${marks}) AND quantity > COALESCE(dispatched_quantity, 0) + COALESCE(recalled_quantity, 0) AND status NOT IN ('DISPATCHED', 'CANCELLED', 'REJECTED') LIMIT 1`, [req.user!.tenantId, ...dv.params, ...ids]);
    if (occupied.length) { res.status(409).json({ error: 'This storage location contains stock. Move or dispatch the stock before deleting it.' }); return; }
  }
  await withTransaction(async conn => {
    const dv = divisionWhere(req);
    if (ids.length) {
      const marks = ids.map(() => '?').join(',');
      await conn.execute(`DELETE FROM shelf_locations WHERE tenant_id = ?${dv.sql} AND id IN (${marks})`, [req.user!.tenantId, ...dv.params, ...ids]);
    }
    await conn.execute(`DELETE FROM storage_racks WHERE tenant_id = ? AND warehouse_id = ?${dv.sql}`, [req.user!.tenantId, req.params.id, ...dv.params]);
    await conn.execute(`DELETE FROM warehouses WHERE id = ? AND tenant_id = ?${dv.sql}`, [req.params.id, req.user!.tenantId, ...dv.params]);
  });
  res.json({ id: req.params.id, deleted: true });
}

export async function removeRack(req: Request, res: Response): Promise<void> {
  const dv = divisionWhere(req);
  const rows = await query<RowDataPacket[]>(`SELECT * FROM storage_racks WHERE id = ? AND warehouse_id = ? AND tenant_id = ?${dv.sql} LIMIT 1`, [req.params.rackId, req.params.id, req.user!.tenantId, ...dv.params]);
  if (!rows.length) { res.status(404).json({ error: 'Rack not found.' }); return; }
  const ids = parseJson(rows[0].cells).map(cell => String(cell.shelf_location_id));
  if (ids.length) {
    const marks = ids.map(() => '?').join(',');
    const occupied = await query<RowDataPacket[]>(`SELECT id FROM batches WHERE tenant_id = ?${dv.sql} AND shelf_location_id IN (${marks}) AND quantity > COALESCE(dispatched_quantity, 0) + COALESCE(recalled_quantity, 0) AND status NOT IN ('DISPATCHED', 'CANCELLED', 'REJECTED') LIMIT 1`, [req.user!.tenantId, ...dv.params, ...ids]);
    if (occupied.length) { res.status(409).json({ error: 'This rack contains stock and cannot be removed.' }); return; }
  }
  await withTransaction(async conn => {
    const dv = divisionWhere(req);
    if (ids.length) { const marks = ids.map(() => '?').join(','); await conn.execute(`DELETE FROM shelf_locations WHERE tenant_id = ?${dv.sql} AND id IN (${marks})`, [req.user!.tenantId, ...dv.params, ...ids]); }
    await conn.execute(`DELETE FROM storage_racks WHERE id = ? AND tenant_id = ?${dv.sql}`, [req.params.rackId, req.user!.tenantId, ...dv.params]);
  });
  res.json({ id: req.params.rackId, deleted: true });
}
