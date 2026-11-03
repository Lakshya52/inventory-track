import { Request, Response } from 'express';
import { query, withTransaction } from '../config/database';
import { ResultSetHeader, RowDataPacket } from 'mysql2';

function validName(value: unknown): string { return typeof value === 'string' ? value.trim().slice(0, 120) : ''; }
function positiveInt(value: unknown, max: number): number { const n = Number(value); return Number.isInteger(n) && n > 0 && n <= max ? n : 0; }
function parseJson(value: any): any[] { if (Array.isArray(value)) return value; if (typeof value !== 'string') return []; try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed : []; } catch { return []; } }
function locationCodeFor(warehouse: string, rack: string, row: number, column: number): string {
  const clean = (value: string, max: number) => value.replace(/\s+/g, '-').toUpperCase().slice(0, max).replace(/-+$/g, '');
  return `${clean(warehouse, 38)}-${clean(rack, 34)}-S${row}-P${column}`.slice(0, 100);
}

async function snapshot(tenantId: string | number, warehouseId: string) {
  const warehouses = await query<RowDataPacket[]>('SELECT * FROM warehouses WHERE id = ? AND tenant_id = ? LIMIT 1', [warehouseId, tenantId]);
  if (!warehouses.length) return null;
  const warehouse = warehouses[0];
  const racks = await query<RowDataPacket[]>('SELECT * FROM storage_racks WHERE warehouse_id = ? AND tenant_id = ? ORDER BY rack_code', [warehouseId, tenantId]);
  const locations = await query<RowDataPacket[]>('SELECT id, location_code FROM shelf_locations WHERE tenant_id = ?', [tenantId]);
  const locationCodes = new Map(locations.map(row => [String(row.id), row.location_code]));
  const cellsAll = racks.flatMap(rack => parseJson(rack.cells));
  const ids = cellsAll.map(cell => String(cell.shelf_location_id));
  let batches: RowDataPacket[] = [];
  if (ids.length) {
    const marks = ids.map(() => '?').join(',');
    batches = await query<RowDataPacket[]>(`SELECT * FROM batches WHERE tenant_id = ? AND shelf_location_id IN (${marks}) AND status NOT IN ('DISPATCHED', 'CANCELLED', 'REJECTED')`, [tenantId, ...ids]);
  }
  const productIds = [...new Set(batches.map(batch => batch.product_id).filter(Boolean).map(String))];
  let products: RowDataPacket[] = [];
  if (productIds.length) {
    const marks = productIds.map(() => '?').join(',');
    products = await query<RowDataPacket[]>(`SELECT id, name, sku, description, cas_number, molecular_formula, purity, grade, storage_conditions, hazard_classification, physical_state, hsn_code, manufacturer FROM products WHERE tenant_id = ? AND id IN (${marks})`, [tenantId, ...productIds]);
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
        await query('UPDATE shelf_locations SET location_code = ?, description = ?, warehouse = ?, rack = ?, shelf = ? WHERE id = ? AND tenant_id = ?', [locationCode, `${warehouse.name} · ${rack.rack_code} · Shelf ${shelf}, Position ${position}`, warehouse.name, rack.rack_code, `${shelf}-${position}`, cell.shelf_location_id, tenantId]);
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
  const rows = await query<RowDataPacket[]>('SELECT id FROM warehouses WHERE tenant_id = ? ORDER BY name', [req.user!.tenantId]);
  res.json((await Promise.all(rows.map(row => snapshot(req.user!.tenantId, String(row.id))))).filter(Boolean));
}

export async function listInventory(req: Request, res: Response): Promise<void> {
  const tenantId = req.user!.tenantId;
  const rows = await query<RowDataPacket[]>(
    `SELECT b.id, b.batch_number, b.parent_batch_number,
            b.quantity, b.dispatched_quantity, b.recalled_quantity, b.uom, b.status,
            b.shelf_location_id, b.storage_location, b.created_at,
            p.name AS master_product_name, p.sku AS master_product_sku,
            s.location_code, s.warehouse, s.rack, s.shelf
     FROM batches b
     LEFT JOIN products p ON p.id = b.product_id AND p.tenant_id = b.tenant_id
     LEFT JOIN shelf_locations s ON s.id = b.shelf_location_id AND s.tenant_id = b.tenant_id
     WHERE b.tenant_id = ? AND b.status NOT IN ('DISPATCHED', 'CANCELLED', 'REJECTED')
     ORDER BY b.created_at DESC`,
    [tenantId],
  );
  const [rackRows, warehouseRows] = await Promise.all([
    query<RowDataPacket[]>('SELECT id, warehouse_id, rack_code, cells FROM storage_racks WHERE tenant_id = ?', [tenantId]),
    query<RowDataPacket[]>('SELECT id, name FROM warehouses WHERE tenant_id = ?', [tenantId]),
  ]);
  const warehousesById = new Map(warehouseRows.map((row) => [String(row.id), row.name]));
  const rackByLocation = new Map<string, { rack_id: string; warehouse_id: string; rack_code: string; warehouse_name: string }>();
  for (const rack of rackRows) {
    for (const cell of parseJson(rack.cells)) {
      if (cell.shelf_location_id) rackByLocation.set(String(cell.shelf_location_id), {
        rack_id: String(rack.id),
        warehouse_id: String(rack.warehouse_id),
        rack_code: rack.rack_code,
        warehouse_name: warehousesById.get(String(rack.warehouse_id)) || '',
      });
    }
  }
  res.json(rows.map((row) => {
    const remaining = Math.max(0, Number(row.quantity || 0) - Number(row.dispatched_quantity || 0) - Number(row.recalled_quantity || 0));
    const rack = rackByLocation.get(String(row.shelf_location_id));
    return {
      id: row.id,
      batch_number: row.parent_batch_number || row.batch_number,
      product_name: row.product_name || row.master_product_name || 'Unknown product',
      product_sku: row.product_sku || row.master_product_sku || null,
      quantity: row.quantity,
      remaining_quantity: remaining,
      uom: row.uom || 'units',
      status: row.status,
      location_code: row.location_code || row.storage_location || null,
      warehouse: row.warehouse || rack?.warehouse_name || null,
      rack: row.rack || rack?.rack_code || null,
      shelf: row.shelf || null,
      warehouse_id: rack?.warehouse_id || null,
      rack_id: rack?.rack_id || null,
      created_at: row.created_at,
    };
  }));
}

export async function createWarehouse(req: Request, res: Response): Promise<void> {
  const name = validName(req.body.name); const capacity = positiveInt(req.body.capacity, 1_000_000_000);
  if (!name || !capacity) { res.status(400).json({ error: 'Enter a warehouse name and a positive capacity.' }); return; }
  const duplicate = await query<RowDataPacket[]>('SELECT id FROM warehouses WHERE tenant_id = ? AND LOWER(name) = LOWER(?) LIMIT 1', [req.user!.tenantId, name]);
  if (duplicate.length) { res.status(409).json({ error: 'A storage location with that name already exists.' }); return; }
  const result = await query<any>('INSERT INTO warehouses (tenant_id, name, capacity, is_active) VALUES (?, ?, ?, 1)', [req.user!.tenantId, name, capacity]);
  res.status(201).json(await snapshot(req.user!.tenantId, String(result.insertId)));
}

export async function getWarehouse(req: Request, res: Response): Promise<void> {
  const warehouse = await snapshot(req.user!.tenantId, req.params.id);
  if (!warehouse) { res.status(404).json({ error: 'Storage location not found.' }); return; }
  res.json(warehouse);
}
export async function listWarehouseRacks(req: Request, res: Response): Promise<void> { await getWarehouse(req, res); }

export async function updateWarehouse(req: Request, res: Response): Promise<void> {
  const name = validName(req.body.name); const capacity = positiveInt(req.body.capacity, 1_000_000_000);
  if (!name || !capacity) { res.status(400).json({ error: 'Enter a warehouse name and positive capacity.' }); return; }
  const current = await snapshot(req.user!.tenantId, req.params.id);
  if (!current) { res.status(404).json({ error: 'Storage location not found.' }); return; }
  const positions = (current.racks || []).reduce((sum: number, rack: any) => sum + (rack.cells || []).length, 0);
  if (capacity < positions) { res.status(409).json({ error: `Capacity cannot be below the ${positions} storage positions already configured.` }); return; }
  if (capacity < Number(current.occupied_capacity)) { res.status(409).json({ error: `Capacity cannot be below the ${current.occupied_capacity} units currently stored.` }); return; }
  const duplicate = await query<RowDataPacket[]>('SELECT id FROM warehouses WHERE tenant_id = ? AND id <> ? AND LOWER(name) = LOWER(?) LIMIT 1', [req.user!.tenantId, req.params.id, name]);
  if (duplicate.length) { res.status(409).json({ error: 'A storage location with that name already exists.' }); return; }
  await query('UPDATE warehouses SET name = ?, capacity = ? WHERE id = ? AND tenant_id = ?', [name, capacity, req.params.id, req.user!.tenantId]);
  res.json(await snapshot(req.user!.tenantId, req.params.id));
}

export async function createRack(req: Request, res: Response): Promise<void> {
  const rackCode = validName(req.body.name); const rows = positiveInt(req.body.rows, 30); const columns = positiveInt(req.body.columns, 30);
  if (!rackCode || !rows || !columns || rows * columns > 300) { res.status(400).json({ error: 'Enter a rack name and dimensions with no more than 300 cells.' }); return; }
  const warehouseRows = await query<RowDataPacket[]>('SELECT * FROM warehouses WHERE id = ? AND tenant_id = ? LIMIT 1', [req.params.id, req.user!.tenantId]);
  if (!warehouseRows.length) { res.status(404).json({ error: 'Storage location not found.' }); return; }
  const duplicate = await query<RowDataPacket[]>('SELECT id FROM storage_racks WHERE tenant_id = ? AND warehouse_id = ? AND LOWER(rack_code) = LOWER(?) LIMIT 1', [req.user!.tenantId, req.params.id, rackCode]);
  if (duplicate.length) { res.status(409).json({ error: 'That rack name already exists in this storage location.' }); return; }
  try {
    await withTransaction(async conn => {
      const [lockedWarehouse] = await (conn as any).execute('SELECT id, name, capacity FROM warehouses WHERE id = ? AND tenant_id = ? FOR UPDATE', [req.params.id, req.user!.tenantId]) as [RowDataPacket[], any];
      if (!lockedWarehouse.length) throw Object.assign(new Error('Storage location not found.'), { statusCode: 404 });
      const [existingRacks] = await (conn as any).execute('SELECT cells FROM storage_racks WHERE tenant_id = ? AND warehouse_id = ? FOR UPDATE', [req.user!.tenantId, req.params.id]) as [RowDataPacket[], any];
      const currentPositions = existingRacks.reduce((sum: number, rack: RowDataPacket) => sum + parseJson(rack.cells).length, 0);
      if (currentPositions + rows * columns > Number(lockedWarehouse[0].capacity)) {
        throw Object.assign(new Error(`This godown can have at most ${lockedWarehouse[0].capacity} positions. It already has ${currentPositions}.`), { statusCode: 409 });
      }
      const cells: any[] = [];
      for (let row = 1; row <= rows; row++) for (let column = 1; column <= columns; column++) {
        const shelf = `S${row}`;
        const position = `P${column}`;
        const locationCode = locationCodeFor(lockedWarehouse[0].name, rackCode, row, column);
        const [loc] = await (conn as any).execute('INSERT INTO shelf_locations (tenant_id, location_code, description, warehouse, rack, shelf, is_active) VALUES (?, ?, ?, ?, ?, ?, 1)', [req.user!.tenantId, locationCode, `${lockedWarehouse[0].name} · ${rackCode} · Shelf ${shelf}, Position ${position}`, lockedWarehouse[0].name, rackCode, `${shelf}-${position}`]) as [ResultSetHeader, any];
        cells.push({ row, column, cell_code: `${rackCode}-${shelf}-${position}`, shelf_location_id: String(loc.insertId), location_code: locationCode });
      }
      await conn.execute('INSERT INTO storage_racks (tenant_id, warehouse_id, rack_code, rows_count, columns_count, cells) VALUES (?, ?, ?, ?, ?, ?)', [req.user!.tenantId, req.params.id, rackCode, rows, columns, JSON.stringify(cells)]);
    });
  } catch (error: any) {
    res.status(error?.statusCode || 500).json({ error: error?.message || 'Could not create rack.' });
    return;
  }
  const updated = await snapshot(req.user!.tenantId, req.params.id);
  res.status(201).json(updated?.racks.find((rack: any) => rack.rack_code === rackCode));
}

export async function updateRack(req: Request, res: Response): Promise<void> {
  const rackCode = validName(req.body.name);
  const rows = positiveInt(req.body.rows, 30);
  const columns = positiveInt(req.body.columns, 30);
  if (!rackCode || !rows || !columns || rows * columns > 300) { res.status(400).json({ error: 'Enter a rack name and dimensions with no more than 300 cells.' }); return; }

  const warehouses = await query<RowDataPacket[]>('SELECT * FROM warehouses WHERE id = ? AND tenant_id = ? LIMIT 1', [req.params.id, req.user!.tenantId]);
  if (!warehouses.length) { res.status(404).json({ error: 'Storage location not found.' }); return; }
  const racks = await query<RowDataPacket[]>('SELECT * FROM storage_racks WHERE id = ? AND warehouse_id = ? AND tenant_id = ? LIMIT 1', [req.params.rackId, req.params.id, req.user!.tenantId]);
  if (!racks.length) { res.status(404).json({ error: 'Rack not found.' }); return; }
  const duplicate = await query<RowDataPacket[]>('SELECT id FROM storage_racks WHERE tenant_id = ? AND warehouse_id = ? AND id <> ? AND LOWER(rack_code) = LOWER(?) LIMIT 1', [req.user!.tenantId, req.params.id, req.params.rackId, rackCode]);
  if (duplicate.length) { res.status(409).json({ error: 'That rack name already exists in this storage location.' }); return; }

  const oldCells = parseJson(racks[0].cells);
  const oldRows = Number(racks[0].rows_count || racks[0].rows || 0);
  const oldColumns = Number(racks[0].columns_count || racks[0].columns || 0);
  const dimensionsChanged = rows !== oldRows || columns !== oldColumns;
  const ids = oldCells.map(cell => String(cell.shelf_location_id)).filter(Boolean);
  if (dimensionsChanged && ids.length) {
    const marks = ids.map(() => '?').join(',');
    const occupied = await query<RowDataPacket[]>(`SELECT id FROM batches WHERE tenant_id = ? AND shelf_location_id IN (${marks}) AND quantity > COALESCE(dispatched_quantity, 0) + COALESCE(recalled_quantity, 0) AND status NOT IN ('DISPATCHED', 'CANCELLED', 'REJECTED') LIMIT 1`, [req.user!.tenantId, ...ids]);
    if (occupied.length) { res.status(409).json({ error: 'Move or dispatch the stock before changing rack dimensions.' }); return; }
  }

  try {
    await withTransaction(async conn => {
      const [lockedWarehouse] = await (conn as any).execute('SELECT id, name, capacity FROM warehouses WHERE id = ? AND tenant_id = ? FOR UPDATE', [req.params.id, req.user!.tenantId]) as [RowDataPacket[], any];
      if (!lockedWarehouse.length) throw Object.assign(new Error('Storage location not found.'), { statusCode: 404 });
      const [allRacks] = await (conn as any).execute('SELECT id, cells FROM storage_racks WHERE tenant_id = ? AND warehouse_id = ? FOR UPDATE', [req.user!.tenantId, req.params.id]) as [RowDataPacket[], any];
      const currentPositions = allRacks.reduce((sum: number, rack: RowDataPacket) =>
        sum + (String(rack.id) === String(req.params.rackId) ? 0 : parseJson(rack.cells).length), 0);
      if (currentPositions + rows * columns > Number(lockedWarehouse[0].capacity)) {
        throw Object.assign(new Error(`This godown can have at most ${lockedWarehouse[0].capacity} positions. Other racks already use ${currentPositions}.`), { statusCode: 409 });
      }
      let nextCells: any[] = [];
      if (dimensionsChanged) {
        if (ids.length) {
          const marks = ids.map(() => '?').join(',');
          await conn.execute(`DELETE FROM shelf_locations WHERE tenant_id = ? AND id IN (${marks})`, [req.user!.tenantId, ...ids]);
        }
        for (let row = 1; row <= rows; row++) for (let column = 1; column <= columns; column++) {
          const shelf = `S${row}`;
          const position = `P${column}`;
          const locationCode = locationCodeFor(warehouses[0].name, rackCode, row, column);
          // mysql2's promise `execute` resolves through a mixin type that TS sees
          // as untyped, so a generic argument is not allowed here.
          const [location] = await (conn as any).execute('INSERT INTO shelf_locations (tenant_id, location_code, description, warehouse, rack, shelf, is_active) VALUES (?, ?, ?, ?, ?, ?, 1)', [req.user!.tenantId, locationCode, `${warehouses[0].name} · ${rackCode} · Shelf ${shelf}, Position ${position}`, warehouses[0].name, rackCode, `${shelf}-${position}`]);
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
        await conn.execute('UPDATE shelf_locations SET location_code = ?, description = ?, warehouse = ?, rack = ?, shelf = ? WHERE id = ? AND tenant_id = ?', [cell.location_code, `${warehouses[0].name} · ${rackCode} · Shelf ${shelf}, Position ${position}`, warehouses[0].name, rackCode, `${shelf}-${position}`, cell.shelf_location_id, req.user!.tenantId]);
      }
      await conn.execute('UPDATE storage_racks SET rack_code = ?, rows_count = ?, columns_count = ?, cells = ? WHERE id = ? AND warehouse_id = ? AND tenant_id = ?', [rackCode, rows, columns, JSON.stringify(nextCells), req.params.rackId, req.params.id, req.user!.tenantId]);
    });
  } catch (error: any) {
    res.status(error?.statusCode || 500).json({ error: error?.message || 'Could not update rack.' });
    return;
  }

  const updated = await snapshot(req.user!.tenantId, req.params.id);
  res.json(updated?.racks.find((rack: any) => String(rack.id) === String(req.params.rackId)));
}

export async function removeRack(req: Request, res: Response): Promise<void> {
  const rows = await query<RowDataPacket[]>('SELECT * FROM storage_racks WHERE id = ? AND warehouse_id = ? AND tenant_id = ? LIMIT 1', [req.params.rackId, req.params.id, req.user!.tenantId]);
  if (!rows.length) { res.status(404).json({ error: 'Rack not found.' }); return; }
  const ids = parseJson(rows[0].cells).map(cell => String(cell.shelf_location_id));
  if (ids.length) {
    const marks = ids.map(() => '?').join(',');
    const occupied = await query<RowDataPacket[]>(`SELECT id FROM batches WHERE tenant_id = ? AND shelf_location_id IN (${marks}) AND quantity > COALESCE(dispatched_quantity, 0) + COALESCE(recalled_quantity, 0) AND status NOT IN ('DISPATCHED', 'CANCELLED', 'REJECTED') LIMIT 1`, [req.user!.tenantId, ...ids]);
    if (occupied.length) { res.status(409).json({ error: 'This rack contains stock and cannot be removed.' }); return; }
  }
  await withTransaction(async conn => {
    if (ids.length) { const marks = ids.map(() => '?').join(','); await conn.execute(`DELETE FROM shelf_locations WHERE tenant_id = ? AND id IN (${marks})`, [req.user!.tenantId, ...ids]); }
    await conn.execute('DELETE FROM storage_racks WHERE id = ? AND tenant_id = ?', [req.params.rackId, req.user!.tenantId]);
  });
  res.json({ id: req.params.rackId, deleted: true });
}
