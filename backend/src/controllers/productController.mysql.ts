import { Request, Response } from 'express';
import { query, execute } from '../config/database';
import { withTransaction } from '../config/database.mysql';
import { ResultSetHeader, RowDataPacket } from 'mysql2';
import { divisionWhere, divisionStamp } from '../utils/division';
import { naturalSortBy } from '../services/naturalSort';

const MAX_GRADES_PER_PRODUCT = 50;

/** GROUP_CONCAT returns a comma-separated string — expose it as an array like Mongo does. */
function withDivisionIds(rows: RowDataPacket[]): Array<RowDataPacket & { divisionIds: string[] }> {
  return rows.map((row) => ({
    ...row,
    divisionIds: row.division_ids
      ? String(row.division_ids).split(',').filter(Boolean)
      : [],
  }));
}

type FamilyGradeInput = {
  grade: string;
  sku: string;
  quantity: number;
  bag_quantity_id: string | null;
  description: string | null;
  manufacturer: string | null;
  hsn_code: string | null;
};

function cleanText(value: unknown, maxLength: number): string {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function familySkuPrefix(name: string): string {
  const code = name.replace(/[^a-zA-Z0-9]/g, '').slice(0, 6).toUpperCase();
  return `KLJ-${code || 'PROD'}`;
}

function nextAvailableSku(prefix: string, usedSkus: Set<string>): string {
  const numbered = new RegExp(`^${prefix}-(\\d+)$`, 'i');
  let sequence = 1;
  for (const sku of usedSkus) {
    const match = numbered.exec(sku);
    if (match) sequence = Math.max(sequence, Number(match[1]) + 1);
  }
  let candidate = `${prefix}-${String(sequence).padStart(3, '0')}`;
  while (usedSkus.has(candidate.toLowerCase())) {
    sequence += 1;
    candidate = `${prefix}-${String(sequence).padStart(3, '0')}`;
  }
  return candidate;
}

function parseFamilyGrades(raw: unknown): { grades: FamilyGradeInput[]; error?: string } {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > MAX_GRADES_PER_PRODUCT) {
    return { grades: [], error: `Add between 1 and ${MAX_GRADES_PER_PRODUCT} grades` };
  }
  const grades: FamilyGradeInput[] = [];
  const seenGrades = new Set<string>();
  for (const item of raw as Record<string, unknown>[]) {
    const grade = cleanText(item?.grade, 100);
    if (!grade) return { grades: [], error: 'Every grade needs a grade name' };
    const gradeKey = grade.toLowerCase();
    if (seenGrades.has(gradeKey)) {
      return { grades: [], error: `Grade "${grade}" is listed more than once` };
    }
    seenGrades.add(gradeKey);
    const quantity = item?.quantity === undefined || item?.quantity === null || item?.quantity === ''
      ? 0
      : Number(item.quantity);
    if (!Number.isFinite(quantity) || quantity < 0) {
      return { grades: [], error: `Enter a valid quantity for grade "${grade}"` };
    }
    const bag = item?.bag_quantity_id;
    grades.push({
      grade,
      sku: cleanText(item?.sku, 80),
      quantity,
      bag_quantity_id: bag === null || bag === undefined || bag === '' ? null : String(bag),
      description: cleanText(item?.description, 500) || null,
      manufacturer: cleanText(item?.manufacturer, 150) || null,
      hsn_code: cleanText(item?.hsn_code, 40) || null,
    });
  }
  return { grades };
}

export async function create(req: Request, res: Response): Promise<void> {
  const tenantId = req.user!.tenantId;
  const { name, description, sku, quantity, cas_number, molecular_formula, purity, grade, bag_quantity_id, storage_conditions, hazard_classification, physical_state, hsn_code, manufacturer } = req.body;
  if (!name || !sku) {
    res.status(400).json({ error: 'Name and SKU are required' });
    return;
  }
  if (bag_quantity_id) {
    // bag_quantity_id may reference EITHER the uoms master or the bag_quantities master (polymorphic)
    const bag = await query<RowDataPacket[]>('SELECT id FROM bag_quantities WHERE id = ? AND tenant_id = ?', [bag_quantity_id, tenantId]);
    if (bag.length === 0) {
      const uom = await query<RowDataPacket[]>('SELECT id FROM uoms WHERE id = ? AND tenant_id = ?', [bag_quantity_id, tenantId]);
      if (uom.length === 0) {
        res.status(400).json({ error: 'UOM/Bag not found' });
        return;
      }
    }
  }
  try {
    const result = await execute(
      'INSERT INTO products (name, description, sku, quantity, cas_number, molecular_formula, purity, grade, bag_quantity_id, storage_conditions, hazard_classification, physical_state, hsn_code, manufacturer, tenant_id, division_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [name, description || null, sku, quantity || 0, cas_number || null, molecular_formula || null, purity || null, grade || null, bag_quantity_id || null, storage_conditions || null, hazard_classification || null, physical_state || null, hsn_code || null, manufacturer || null, tenantId, divisionStamp(req)]
    );
    await execute('INSERT INTO activity_logs (user_name, user_role, action, description, tenant_id, division_id) VALUES (?, ?, ?, ?, ?, ?)',
      [req.user?.name || 'System', req.user?.role || 'ADMIN', 'PRODUCT_CREATED', `Product "${name}" (${sku}) created`, tenantId, divisionStamp(req)]);
    res.status(201).json({ id: result.insertId, name, description, sku, quantity, cas_number, molecular_formula, purity, grade, bag_quantity_id: bag_quantity_id || null, storage_conditions, hazard_classification, physical_state, hsn_code, manufacturer });
  } catch (err: any) {
    if (err.code === 'ER_DUP_ENTRY') {
      res.status(400).json({ error: 'SKU already exists' });
      return;
    }
    throw err;
  }
}

export async function listFamilies(req: Request, res: Response): Promise<void> {
  const tenantId = req.user!.tenantId;
  const dv = divisionWhere(req);
  const includeInactive = String(req.query.include || '').trim().toLowerCase() === 'inactive';
  const grouped = await query<RowDataPacket[]>(
    `SELECT name, MAX(description) AS description, MAX(manufacturer) AS manufacturer, COUNT(*) AS count, COUNT(*) AS totalCount,
            GROUP_CONCAT(DISTINCT division_id SEPARATOR ',') AS division_ids
     FROM products
     WHERE tenant_id = ?${dv.sql} AND is_active = ?
     GROUP BY name`,
    [tenantId, ...dv.params, includeInactive ? 0 : 1]
  );
  // Natural (numeric-aware) sort so "P9" < "P89" < "P90" — MySQL has no natural collation.
  const families = withDivisionIds(naturalSortBy(grouped, (row) => String(row.name ?? '')));
  res.json(families);
}

/** Page-sized variant for the product groups table (the full list above stays for pickers). */
export async function listFamiliesPage(req: Request, res: Response): Promise<void> {
  const tenantId = req.user!.tenantId;
  const dv = divisionWhere(req);
  const includeInactive = String(req.query.include || '').trim().toLowerCase() === 'inactive';
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(200, Math.max(1, Number(req.query.limit) || 25));
  const grouped = await query<RowDataPacket[]>(
    `SELECT name, MAX(description) AS description, MAX(manufacturer) AS manufacturer, COUNT(*) AS count, COUNT(*) AS totalCount,
            GROUP_CONCAT(DISTINCT division_id SEPARATOR ',') AS division_ids
     FROM products
     WHERE tenant_id = ?${dv.sql} AND is_active = ?
     GROUP BY name`,
    [tenantId, ...dv.params, includeInactive ? 0 : 1]
  );
  const families = withDivisionIds(naturalSortBy(grouped, (row) => String(row.name ?? '')));
  const start = (page - 1) * pageSize;
  const total = families.length;
  res.json({
    items: families.slice(start, start + pageSize),
    allFamilies: families,
    total,
    page,
    pages: Math.max(1, Math.ceil(total / pageSize)),
    pageSize,
  });
}

export async function listFamilyProducts(req: Request, res: Response): Promise<void> {
  const tenantId = req.user!.tenantId;
  const dv = divisionWhere(req);
  const family = String(req.params.name || '').trim();
  if (!family) { res.status(400).json({ error: 'Family name is required.' }); return; }
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 100));
  const q = String(req.query.q || '').trim();
  const offset = (page - 1) * limit;
  const whereSql = q
    ? ` AND (grade LIKE ? OR sku LIKE ? OR manufacturer LIKE ? OR description LIKE ?)`
    : '';
  const whereParams = q
    ? [`${q}%`, `${q}%`, `${q}%`, `${q}%`]
    : [];
  const countRows = await query<RowDataPacket[]>(
    `SELECT COUNT(*) AS total FROM products WHERE tenant_id = ?${dv.sql} AND is_active = 1 AND name = ?${whereSql}`,
    [tenantId, ...dv.params, family, ...whereParams]
  );
  const total = Number(countRows[0]?.total || 0);
  // Natural (numeric-aware) sort so grades order 1, 2, 9, 10, 89, 90 — fetched unordered and sorted in JS
  // because MySQL has no natural collation. Sliced to the requested page after sorting.
  const matching = await query<RowDataPacket[]>(
    `SELECT * FROM products WHERE tenant_id = ?${dv.sql} AND is_active = 1 AND name = ?${whereSql}`,
    [tenantId, ...dv.params, family, ...whereParams]
  );
  const products = naturalSortBy(matching, (row) => String(row.grade ?? ''), (row) => String(row.sku ?? '')).slice(offset, offset + limit);
  res.json({ products, total, page, limit, totalPages: Math.max(1, Math.ceil(total / limit)) });
}

export async function nextSku(req: Request, res: Response): Promise<void> {
  const tenantId = req.user!.tenantId;
  const name = String(req.query.name || '').trim();
  if (!name) { res.status(400).json({ error: 'name query parameter is required.' }); return; }
  const dv = divisionWhere(req);
  const prefix = familySkuPrefix(name);
  const skus = await query<RowDataPacket[]>(
    `SELECT sku FROM products WHERE tenant_id = ?${dv.sql} AND sku LIKE ?`,
    [tenantId, ...dv.params, `${prefix}-%`]
  );
  let sequence = 1;
  const regex = new RegExp(`^${prefix.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')}-(\\d+)$`, 'i');
  for (const row of skus) {
    const match = regex.exec(String(row.sku || ''));
    if (match) sequence = Math.max(sequence, Number(match[1]) + 1);
  }
  res.json({ sku: `${prefix}-${String(sequence).padStart(3, '0')}` });
}

export async function list(req: Request, res: Response): Promise<void> {
  const tenantId = req.user!.tenantId;
  const dv = divisionWhere(req);
  const products = await query<RowDataPacket[]>(`SELECT * FROM products WHERE tenant_id = ?${dv.sql} AND is_active = 1 ORDER BY created_at DESC`, [tenantId, ...dv.params]);
  res.json(products);
}

export async function getById(req: Request, res: Response): Promise<void> {
  const tenantId = req.user!.tenantId;
  const dv = divisionWhere(req);
  const products = await query<RowDataPacket[]>(`SELECT * FROM products WHERE id = ? AND tenant_id = ?${dv.sql} AND is_active = 1`, [req.params.id, tenantId, ...dv.params]);
  if (products.length === 0) { res.status(404).json({ error: 'Product not found' }); return; }
  res.json(products[0]);
}

export async function search(req: Request, res: Response): Promise<void> {
  const tenantId = req.user!.tenantId;
  const dv = divisionWhere(req);
  const q = req.query.q as string || '';
  if (!q) { res.json([]); return; }
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 100));
  const products = await query<RowDataPacket[]>(
    `SELECT * FROM products WHERE tenant_id = ?${dv.sql} AND is_active = 1 AND (name LIKE ? OR sku LIKE ?) ORDER BY created_at DESC LIMIT ?`,
    [tenantId, ...dv.params, `${q}%`, `${q}%`, limit]
  );
  res.json(products);
}

export async function remove(req: Request, res: Response): Promise<void> {
  const tenantId = req.user!.tenantId;
  const dv = divisionWhere(req);
  const { id } = req.params;
  const batches = await query<RowDataPacket[]>(`SELECT COUNT(*) AS total FROM batches WHERE product_id = ? AND tenant_id = ?${dv.sql}`, [id, tenantId, ...dv.params]);
  if (Number(batches[0]?.total || 0) > 0) {
    res.status(409).json({
      error: 'This grade already has batches and cannot be deleted. Keep it so batch history stays intact.',
    });
    return;
  }
  const result = await execute(`DELETE FROM products WHERE id = ? AND tenant_id = ?${dv.sql}`, [id, tenantId, ...dv.params]);
  if (result.affectedRows === 0) {
    res.status(404).json({ error: 'Product not found' });
    return;
  }
  await execute('INSERT INTO activity_logs (user_name, user_role, action, description, tenant_id, division_id) VALUES (?, ?, ?, ?, ?, ?)',
    [req.user?.name || 'System', req.user?.role || 'ADMIN', 'PRODUCT_DELETED', `Product #${id} deleted`, tenantId, divisionStamp(req)]);
  res.json({ message: 'Product deleted' });
}

export async function update(req: Request, res: Response): Promise<void> {
  const tenantId = req.user!.tenantId;
  const { id } = req.params;
  const dv = divisionWhere(req);
  const { name, description, sku, quantity, cas_number, molecular_formula, purity, grade, bag_quantity_id, storage_conditions, hazard_classification, physical_state, hsn_code, manufacturer } = req.body;
  if (!name || !sku) {
    res.status(400).json({ error: 'Name and SKU are required' });
    return;
  }
  if (bag_quantity_id) {
    // bag_quantity_id may reference EITHER the uoms master or the bag_quantities master (polymorphic)
    const bag = await query<RowDataPacket[]>('SELECT id FROM bag_quantities WHERE id = ? AND tenant_id = ?', [bag_quantity_id, tenantId]);
    if (bag.length === 0) {
      const uom = await query<RowDataPacket[]>('SELECT id FROM uoms WHERE id = ? AND tenant_id = ?', [bag_quantity_id, tenantId]);
      if (uom.length === 0) {
        res.status(400).json({ error: 'UOM/Bag not found' });
        return;
      }
    }
  }
  const sibling = await query<RowDataPacket[]>(
    `SELECT id FROM products WHERE tenant_id = ?${dv.sql} AND id <> ? AND LOWER(TRIM(name)) = LOWER(TRIM(?)) AND LOWER(TRIM(COALESCE(grade, ""))) = LOWER(TRIM(?)) LIMIT 1`,
    [tenantId, ...dv.params, id, name, grade || '']
  );
  if (sibling.length > 0) {
    res.status(409).json({ error: `Grade "${grade}" already exists for product : ${name}` });
    return;
  }
  const result = await execute(
    `UPDATE products SET name = ?, description = ?, sku = ?, quantity = ?, cas_number = ?, molecular_formula = ?, purity = ?, grade = ?, bag_quantity_id = ?, storage_conditions = ?, hazard_classification = ?, physical_state = ?, hsn_code = ?, manufacturer = ? WHERE id = ? AND tenant_id = ?${dv.sql}`,
    [name, description || null, sku, quantity || 0, cas_number || null, molecular_formula || null, purity || null, grade || null, bag_quantity_id || null, storage_conditions || null, hazard_classification || null, physical_state || null, hsn_code || null, manufacturer || null, id, tenantId, ...dv.params]
  );
  if (result.affectedRows === 0) {
    res.status(404).json({ error: 'Product not found' });
    return;
  }
  await execute('INSERT INTO activity_logs (user_name, user_role, action, description, tenant_id, division_id) VALUES (?, ?, ?, ?, ?, ?)',
    [req.user?.name || 'System', req.user?.role || 'ADMIN', 'PRODUCT_UPDATED', `Product "${name}" (${sku}) updated`, tenantId, divisionStamp(req)]);
  res.json({ message: 'Product updated' });
}

export async function createFamily(req: Request, res: Response): Promise<void> {
  const tenantId = req.user!.tenantId;
  const dv = divisionWhere(req);
  const name = cleanText(req.body?.name, 150);
  const description = cleanText(req.body?.description, 500) || null;
  const manufacturer = cleanText(req.body?.manufacturer, 150) || null;
  if (!name) {
    res.status(400).json({ error: 'Enter a product name' });
    return;
  }
  const parsed = parseFamilyGrades(req.body?.grades);
  if (parsed.error) {
    res.status(400).json({ error: parsed.error });
    return;
  }
  const grades = parsed.grades;
  const bagLikeIds = Array.from(new Set(grades.map((grade) => grade.bag_quantity_id).filter((id): id is string => Boolean(id))));
  if (bagLikeIds.length > 0) {
    // bag_quantity_id may reference EITHER the uoms master or the bag_quantities master (polymorphic)
    const bags = await query<RowDataPacket[]>('SELECT id FROM bag_quantities WHERE tenant_id = ? AND id IN (?)', [tenantId, bagLikeIds]);
    const uoms = await query<RowDataPacket[]>('SELECT id FROM uoms WHERE tenant_id = ? AND id IN (?)', [tenantId, bagLikeIds]);
    const known = new Set([...bags.map((r) => String(r.id)), ...uoms.map((r) => String(r.id))]);
    const missing = bagLikeIds.filter((id) => !known.has(String(id)));
    if (missing.length > 0) {
      res.status(400).json({ error: `UOM/Bag "${missing[0]}" not found` });
      return;
    }
  }
  try {
    const created = await withTransaction(async (conn) => {
      const [existing] = await conn.query<RowDataPacket[]>(
        `SELECT id, name, grade, sku FROM products WHERE tenant_id = ?${dv.sql}`,
        [tenantId, ...dv.params]
      );
      const usedSkus = new Set(
        existing
          .map((product) => String(product.sku || '').trim().toLowerCase())
          .filter(Boolean)
      );
      const familyGrades = new Set(
        existing
          .filter((product) => String(product.name || '').trim().toLowerCase() === name.toLowerCase())
          .map((product) => String(product.grade || '').trim().toLowerCase())
          .filter(Boolean)
      );
      for (const grade of grades) {
        if (familyGrades.has(grade.grade.toLowerCase())) {
          throw Object.assign(new Error(`Grade "${grade.grade}" already exists for product : ${name}`), { statusCode: 409 });
        }
        if (grade.sku) {
          const skuKey = grade.sku.toLowerCase();
          if (usedSkus.has(skuKey)) {
            throw Object.assign(new Error(`SKU "${grade.sku}" already exists`), { statusCode: 400 });
          }
          usedSkus.add(skuKey);
        }
      }
      const prefix = familySkuPrefix(name);
      for (const grade of grades) {
        if (!grade.sku) {
          grade.sku = nextAvailableSku(prefix, usedSkus);
          usedSkus.add(grade.sku.toLowerCase());
        }
      }
      const rows: Record<string, unknown>[] = [];
      for (const grade of grades) {
        const [result] = await conn.execute<ResultSetHeader>(
          'INSERT INTO products (name, description, sku, quantity, cas_number, molecular_formula, purity, grade, bag_quantity_id, storage_conditions, hazard_classification, physical_state, hsn_code, manufacturer, tenant_id, division_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [
            name,
            grade.description || description,
            grade.sku,
            grade.quantity,
            null,
            null,
            null,
            grade.grade,
            grade.bag_quantity_id,
            null,
            null,
            null,
            grade.hsn_code,
            grade.manufacturer || manufacturer,
            tenantId,
            divisionStamp(req),
          ]
        );
        rows.push({
          id: result.insertId,
          name,
          description: grade.description || description,
          sku: grade.sku,
          quantity: grade.quantity,
          grade: grade.grade,
          bag_quantity_id: grade.bag_quantity_id,
          manufacturer: grade.manufacturer || manufacturer,
          hsn_code: grade.hsn_code,
        });
      }
      await conn.execute(
        'INSERT INTO activity_logs (user_name, user_role, action, description, tenant_id, division_id) VALUES (?, ?, ?, ?, ?, ?)',
        [
          req.user?.name || 'System',
          req.user?.role || 'ADMIN',
          'PRODUCT_CREATED',
          `Product "${name}" created with ${rows.length} grade${rows.length === 1 ? '' : 's'}`,
          tenantId,
          divisionStamp(req),
        ]
      );
      return rows;
    });
    res.status(201).json({
      products: created,
      message: `${name} created with ${created.length} grade${created.length === 1 ? '' : 's'}.`,
    });
  } catch (err: any) {
    if (err?.statusCode) {
      res.status(err.statusCode).json({ error: err.message });
      return;
    }
    if (err?.code === 'ER_DUP_ENTRY') {
      res.status(400).json({ error: 'A grade with that SKU already exists' });
      return;
    }
    throw err;
  }
}

export async function renameFamily(req: Request, res: Response): Promise<void> {
  const tenantId = req.user!.tenantId;
  const dv = divisionWhere(req);
  const currentName = cleanText(req.body?.currentName, 150);
  const name = cleanText(req.body?.name, 150);
  const description =
    req.body?.description === undefined ? undefined : cleanText(req.body?.description, 500);
  if (!currentName || !name) {
    res.status(400).json({ error: 'Enter the current and new product name' });
    return;
  }
  try {
    await withTransaction(async (conn) => {
      const [products] = await conn.query<RowDataPacket[]>(`SELECT id, name FROM products WHERE tenant_id = ?${dv.sql}`, [tenantId, ...dv.params]);
      const family = products.filter(
        (product) => String(product.name || '').trim().toLowerCase() === currentName.toLowerCase()
      );
      if (family.length === 0) {
        throw Object.assign(new Error('Product not found'), { statusCode: 404 });
      }
      const collides = products.some(
        (product) =>
          String(product.name || '').trim().toLowerCase() === name.toLowerCase() &&
          !family.some((member) => String(member.id) === String(product.id))
      );
      if (collides) {
        throw Object.assign(new Error('Another product already uses that name'), { statusCode: 409 });
      }
      await conn.query(
        `UPDATE products SET name = ?, description = COALESCE(?, description) WHERE id IN (?) AND tenant_id = ?${dv.sql}`,
        [name, description ?? null, family.map((product) => product.id), tenantId, ...dv.params]
      );
      await conn.execute(
        'INSERT INTO activity_logs (user_name, user_role, action, description, tenant_id, division_id) VALUES (?, ?, ?, ?, ?, ?)',
        [
          req.user?.name || 'System',
          req.user?.role || 'ADMIN',
          'PRODUCT_UPDATED',
          `Product "${currentName}" renamed to "${name}"`,
          tenantId,
          divisionStamp(req),
        ]
      );
    });
    res.json({ message: `Product renamed to ${name}.` });
  } catch (err: any) {
    if (err?.statusCode) {
      res.status(err.statusCode).json({ error: err.message });
      return;
    }
    throw err;
  }
}

/**
 * Delete an entire family — every grade row of the product.
 * Refuses the WHOLE operation when any grade already has batches, naming the grades.
 * An empty family returns { deleted: 0 } silently.
 */
/**
 * Deactivate an entire family — every grade row of the product.
 * The product and its grades stay in the database for history, but stop being
 * visible or usable anywhere (catalogue, search, QC, dispatch, picking, print…).
 * Related records (batches, QC, dispatch, QR labels) are left untouched.
 * Deletion stays possible afterwards via DELETE /products/families/:name.
 */
/**
 * Reactivate an entire family — every grade row goes back to is_active = 1.
 * The rows reappear in the catalogue, search, etc. No history is recreated.
 */
export async function reactivateFamily(req: Request, res: Response): Promise<void> {
  const tenantId = req.user!.tenantId;
  const dv = divisionWhere(req);
  const name = cleanText(req.params.name, 150);
  if (!name) {
    res.status(400).json({ error: 'Product name is required' });
    return;
  }
  const products = await query<RowDataPacket[]>(
    `SELECT id, is_active FROM products WHERE tenant_id = ?${dv.sql} AND LOWER(TRIM(name)) = LOWER(TRIM(?))`,
    [tenantId, ...dv.params, name]
  );
  if (products.length === 0) {
    res.status(404).json({ error: `Product "${name}" not found or already active` });
    return;
  }
  const alreadyActive = products.filter((row) => Number(row.is_active) === 1);
  if (alreadyActive.length === products.length) {
    res.json({ reactivated: 0, alreadyActive: true, message: `"${name}" is already active.` });
    return;
  }
  try {
    await withTransaction(async (conn) => {
      const [result] = await conn.query<ResultSetHeader>(
        `UPDATE products SET is_active = 1 WHERE tenant_id = ?${dv.sql} AND LOWER(TRIM(name)) = LOWER(TRIM(?)) AND is_active = 0`,
        [tenantId, ...dv.params, name]
      );
      await conn.execute(
        'INSERT INTO activity_logs (user_name, user_role, action, description, tenant_id, division_id) VALUES (?, ?, ?, ?, ?, ?)',
        [
          req.user?.name || 'System',
          req.user?.role || 'ADMIN',
          'PRODUCT_FAMILY_REACTIVATED',
          `Product family "${name}" reactivated with ${result.affectedRows} grade${result.affectedRows === 1 ? '' : 's'}`,
          tenantId,
          divisionStamp(req),
        ]
      );
    });
    res.json({ reactivated: products.length - alreadyActive.length, message: `"${name}" and its grades were reactivated.` });
  } catch (err: any) {
    throw err;
  }
}

export async function deactivateFamily(req: Request, res: Response): Promise<void> {
  const tenantId = req.user!.tenantId;
  const dv = divisionWhere(req);
  const name = cleanText(req.params.name, 150);
  if (!name) {
    res.status(400).json({ error: 'Product name is required' });
    return;
  }
  const products = await query<RowDataPacket[]>(
    `SELECT id, is_active FROM products WHERE tenant_id = ?${dv.sql} AND LOWER(TRIM(name)) = LOWER(TRIM(?))`,
    [tenantId, ...dv.params, name]
  );
  if (products.length === 0) {
    res.json({ deactivated: 0, message: 'Nothing to deactivate — there are no grades in this product.' });
    return;
  }
  const alreadyInactive = products.filter((row) => Number(row.is_active) === 0);
  if (alreadyInactive.length === products.length) {
    res.json({ deactivated: 0, alreadyDeactivated: true, message: `"${name}" is already deactivated.` });
    return;
  }
  try {
    await withTransaction(async (conn) => {
      const [result] = await conn.query<ResultSetHeader>(
        `UPDATE products SET is_active = 0 WHERE tenant_id = ?${dv.sql} AND LOWER(TRIM(name)) = LOWER(TRIM(?)) AND is_active = 1`,
        [tenantId, ...dv.params, name]
      );
      await conn.execute(
        'INSERT INTO activity_logs (user_name, user_role, action, description, tenant_id, division_id) VALUES (?, ?, ?, ?, ?, ?)',
        [
          req.user?.name || 'System',
          req.user?.role || 'ADMIN',
          'PRODUCT_FAMILY_DEACTIVATED',
          `Product family "${name}" deactivated with ${result.affectedRows} grade${result.affectedRows === 1 ? '' : 's'}`,
          tenantId,
          divisionStamp(req),
        ]
      );
    });
    res.json({ deactivated: products.length - alreadyInactive.length, message: `"${name}" and its grades were deactivated.` });
  } catch (err: any) {
    throw err;
  }
}

export async function removeFamily(req: Request, res: Response): Promise<void> {
  const tenantId = req.user!.tenantId;
  const dv = divisionWhere(req);
  const name = cleanText(req.params.name, 150);
  if (!name) {
    res.status(400).json({ error: 'Product name is required' });
    return;
  }
  const products = await query<RowDataPacket[]>(
    `SELECT id, grade FROM products WHERE tenant_id = ?${dv.sql} AND LOWER(TRIM(name)) = LOWER(TRIM(?))`,
    [tenantId, ...dv.params, name]
  );
  if (products.length === 0) {
    res.json({ deleted: 0, message: 'Nothing to delete — there are no grades left.' });
    return;
  }
  const ids = products.map((product) => product.id as number);
  const placeholders = ids.map(() => '?').join(',');
  const batchRows = await query<RowDataPacket[]>(
    `SELECT product_id FROM batches WHERE product_id IN (${placeholders}) AND tenant_id = ?${dv.sql}`,
    [...ids, tenantId, ...dv.params]
  );
  if (batchRows.length > 0) {
    const gradeById = new Map(products.map((product) => [String(product.id), product.grade ?? '(no grade)']));
    const gradesWithBatches = [...new Set(batchRows.map((batch) => gradeById.get(String(batch.product_id)) || '(unknown grade)'))];
    res.status(409).json({
      error: `Cannot delete "${name}" — these grades have batches: ${gradesWithBatches.join(', ')}. Keep them so batch history stays intact.`,
    });
    return;
  }
  try {
    await withTransaction(async (conn) => {
      const [result] = await conn.query<ResultSetHeader>(
        `DELETE FROM products WHERE tenant_id = ?${dv.sql} AND LOWER(TRIM(name)) = LOWER(TRIM(?))`,
        [tenantId, ...dv.params, name]
      );
      await conn.execute(
        'INSERT INTO activity_logs (user_name, user_role, action, description, tenant_id, division_id) VALUES (?, ?, ?, ?, ?, ?)',
        [
          req.user?.name || 'System',
          req.user?.role || 'ADMIN',
          'PRODUCT_FAMILY_DELETED',
          `Product family "${name}" deleted with ${result.affectedRows} grade${result.affectedRows === 1 ? '' : 's'}`,
          tenantId,
          divisionStamp(req),
        ]
      );
    });
    res.json({ deleted: products.length, message: `"${name}" and its ${products.length} grade${products.length === 1 ? '' : 's'} were deleted.` });
  } catch (err: any) {
    throw err;
  }
}
