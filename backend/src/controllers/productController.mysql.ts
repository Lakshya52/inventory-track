import { Request, Response } from 'express';
import { query, execute } from '../config/database';
import { withTransaction } from '../config/database.mysql';
import { ResultSetHeader, RowDataPacket } from 'mysql2';

const MAX_GRADES_PER_PRODUCT = 50;

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
  const { name, description, sku, price, quantity, cas_number, molecular_formula, purity, grade, bag_quantity_id, storage_conditions, hazard_classification, physical_state, hsn_code, manufacturer } = req.body;
  if (!name || !sku) {
    res.status(400).json({ error: 'Name and SKU are required' });
    return;
  }
  try {
    const result = await execute(
      'INSERT INTO products (name, description, sku, price, quantity, cas_number, molecular_formula, purity, grade, bag_quantity_id, storage_conditions, hazard_classification, physical_state, hsn_code, manufacturer) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [name, description || null, sku, price || 0, quantity || 0, cas_number || null, molecular_formula || null, purity || null, grade || null, bag_quantity_id || null, storage_conditions || null, hazard_classification || null, physical_state || null, hsn_code || null, manufacturer || null]
    );
    await execute('INSERT INTO activity_logs (user_name, user_role, action, description) VALUES (?, ?, ?, ?)',
      [req.user?.name || 'System', req.user?.role || 'ADMIN', 'PRODUCT_CREATED', `Product "${name}" (${sku}) created`]);
    res.status(201).json({ id: result.insertId, name, description, sku, price, quantity, cas_number, molecular_formula, purity, grade, bag_quantity_id: bag_quantity_id || null, storage_conditions, hazard_classification, physical_state, hsn_code, manufacturer });
  } catch (err: any) {
    if (err.code === 'ER_DUP_ENTRY') {
      res.status(400).json({ error: 'SKU already exists' });
      return;
    }
    throw err;
  }
}

export async function list(_req: Request, res: Response): Promise<void> {
  const products = await query<RowDataPacket[]>('SELECT * FROM products ORDER BY created_at DESC');
  res.json(products);
}

export async function getById(req: Request, res: Response): Promise<void> {
  const products = await query<RowDataPacket[]>('SELECT * FROM products WHERE id = ?', [req.params.id]);
  if (products.length === 0) { res.status(404).json({ error: 'Product not found' }); return; }
  res.json(products[0]);
}

export async function search(req: Request, res: Response): Promise<void> {
  const q = req.query.q as string || '';
  const products = await query<RowDataPacket[]>(
    'SELECT * FROM products WHERE name LIKE ? OR sku LIKE ? ORDER BY created_at DESC',
    [`%${q}%`, `%${q}%`]
  );
  res.json(products);
}

export async function remove(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  const batches = await query<RowDataPacket[]>('SELECT COUNT(*) AS total FROM batches WHERE product_id = ?', [id]);
  if (Number(batches[0]?.total || 0) > 0) {
    res.status(409).json({
      error: 'This grade already has batches and cannot be deleted. Keep it so batch history stays intact.',
    });
    return;
  }
  const result = await execute('DELETE FROM products WHERE id = ?', [id]);
  if (result.affectedRows === 0) {
    res.status(404).json({ error: 'Product not found' });
    return;
  }
  await execute('INSERT INTO activity_logs (user_name, user_role, action, description) VALUES (?, ?, ?, ?)',
    [req.user?.name || 'System', req.user?.role || 'ADMIN', 'PRODUCT_DELETED', `Product #${id} deleted`]);
  res.json({ message: 'Product deleted' });
}

export async function update(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  const { name, description, sku, price, quantity, cas_number, molecular_formula, purity, grade, bag_quantity_id, storage_conditions, hazard_classification, physical_state, hsn_code, manufacturer } = req.body;
  if (!name || !sku) {
    res.status(400).json({ error: 'Name and SKU are required' });
    return;
  }
  const sibling = await query<RowDataPacket[]>(
    'SELECT id FROM products WHERE id <> ? AND LOWER(TRIM(name)) = LOWER(TRIM(?)) AND LOWER(TRIM(COALESCE(grade, ""))) = LOWER(TRIM(?)) LIMIT 1',
    [id, name, grade || '']
  );
  if (sibling.length > 0) {
    res.status(409).json({ error: `Grade "${grade}" already exists for ${name}` });
    return;
  }
  const result = await execute(
    'UPDATE products SET name = ?, description = ?, sku = ?, price = ?, quantity = ?, cas_number = ?, molecular_formula = ?, purity = ?, grade = ?, bag_quantity_id = ?, storage_conditions = ?, hazard_classification = ?, physical_state = ?, hsn_code = ?, manufacturer = ? WHERE id = ?',
    [name, description || null, sku, price || 0, quantity || 0, cas_number || null, molecular_formula || null, purity || null, grade || null, bag_quantity_id || null, storage_conditions || null, hazard_classification || null, physical_state || null, hsn_code || null, manufacturer || null, id]
  );
  if (result.affectedRows === 0) {
    res.status(404).json({ error: 'Product not found' });
    return;
  }
  await execute('INSERT INTO activity_logs (user_name, user_role, action, description) VALUES (?, ?, ?, ?)',
    [req.user?.name || 'System', req.user?.role || 'ADMIN', 'PRODUCT_UPDATED', `Product "${name}" (${sku}) updated`]);
  res.json({ message: 'Product updated' });
}

export async function createFamily(req: Request, res: Response): Promise<void> {
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
  try {
    const created = await withTransaction(async (conn) => {
      const [existing] = await conn.query<RowDataPacket[]>(
        'SELECT id, name, grade, sku FROM products'
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
          throw Object.assign(new Error(`Grade "${grade.grade}" already exists for ${name}`), { statusCode: 409 });
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
          'INSERT INTO products (name, description, sku, price, quantity, cas_number, molecular_formula, purity, grade, bag_quantity_id, storage_conditions, hazard_classification, physical_state, hsn_code, manufacturer) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [
            name,
            grade.description || description,
            grade.sku,
            0,
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
          ]
        );
        rows.push({
          id: result.insertId,
          name,
          description: grade.description || description,
          sku: grade.sku,
          price: 0,
          quantity: grade.quantity,
          grade: grade.grade,
          bag_quantity_id: grade.bag_quantity_id,
          manufacturer: grade.manufacturer || manufacturer,
          hsn_code: grade.hsn_code,
        });
      }
      await conn.execute(
        'INSERT INTO activity_logs (user_name, user_role, action, description) VALUES (?, ?, ?, ?)',
        [
          req.user?.name || 'System',
          req.user?.role || 'ADMIN',
          'PRODUCT_CREATED',
          `Product "${name}" created with ${rows.length} grade${rows.length === 1 ? '' : 's'}`,
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
      const [products] = await conn.query<RowDataPacket[]>('SELECT id, name FROM products');
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
        'UPDATE products SET name = ?, description = COALESCE(?, description) WHERE id IN (?)',
        [name, description ?? null, family.map((product) => product.id)]
      );
      await conn.execute(
        'INSERT INTO activity_logs (user_name, user_role, action, description) VALUES (?, ?, ?, ?)',
        [
          req.user?.name || 'System',
          req.user?.role || 'ADMIN',
          'PRODUCT_UPDATED',
          `Product "${currentName}" renamed to "${name}"`,
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
