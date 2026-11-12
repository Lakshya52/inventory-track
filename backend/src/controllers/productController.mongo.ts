import { Request, Response } from 'express';
import { DbContext, getContext, isDuplicateKey, isValidId, withTransaction } from '../config/database';
import { contains, EntityId } from '../services/queryService';

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

async function deleteProductCascade(ctx: DbContext, productId: EntityId): Promise<void> {
  const batches = await ctx.find('batches', { product_id: productId }, { projection: { id: 1 } });
  const batchIds = batches.map((batch) => batch.id as EntityId);
  if (batchIds.length > 0) {
    await Promise.all([
      ctx.deleteMany('qc_records', { batch_id: { $in: batchIds } }),
      ctx.deleteMany('dispatch_records', { batch_id: { $in: batchIds } }),
      ctx.deleteMany('fix_records', { batch_id: { $in: batchIds } }),
      ctx.deleteMany('packing_list_items', { batch_id: { $in: batchIds } }),
      ctx.deleteMany('dispatch_orders', { batch_id: { $in: batchIds } }),
      ctx.deleteMany('qr_labels', { batch_id: { $in: batchIds } }),
    ]);
  }
  const jobs = await ctx.find('qr_print_jobs', { product_id: productId }, { projection: { id: 1 } });
  const jobIds = jobs.map((job) => job.id as EntityId);
  if (jobIds.length > 0) {
    await ctx.deleteMany('qr_labels', { print_job_id: { $in: jobIds } });
    await ctx.deleteMany('qr_print_jobs', { id: { $in: jobIds } });
  }
  await ctx.deleteMany('batches', { product_id: productId });
  await ctx.deleteOne('products', { id: productId });
}

export async function create(req: Request, res: Response): Promise<void> {
  const { name, description, sku, price, quantity, cas_number, molecular_formula, purity, grade, bag_quantity_id, storage_conditions, hazard_classification, physical_state, hsn_code, manufacturer } = req.body;
  if (!name || !sku) {
    res.status(400).json({ error: 'Name and SKU are required' });
    return;
  }
  const ctx = await getContext();
  try { 
    const id = await ctx.insert('products', {
      name,
      description: description || null,
      sku,
      price: price || 0,
      quantity: quantity || 0,
      cas_number: cas_number || null,
      molecular_formula: molecular_formula || null,
      purity: purity || null,
      grade: grade || null,
      bag_quantity_id: bag_quantity_id || null,
      storage_conditions: storage_conditions || null,
      hazard_classification: hazard_classification || null,
      physical_state: physical_state || null,
      hsn_code: hsn_code || null,
      manufacturer: manufacturer || null,
    });
    await ctx.insert('activity_logs', {
      user_name: req.user?.name || 'System',
      user_role: req.user?.role || 'ADMIN',
      action: 'PRODUCT_CREATED',
      description: `Product "${name}" (${sku}) created`,
    });
    res.status(201).json({ id, name, description, sku, price, quantity, cas_number, molecular_formula, purity, grade, bag_quantity_id: bag_quantity_id || null, storage_conditions, hazard_classification, physical_state, hsn_code, manufacturer });
  } catch (err: any) {
    if (isDuplicateKey(err)) {
      res.status(400).json({ error: 'SKU already exists' });
      return;
    }
    throw err;
  }
}

export async function list(_req: Request, res: Response): Promise<void> {
  const ctx = await getContext();
  const products = await ctx.find('products', {}, { sort: { created_at: -1 }, projection: { _id: 0 } });
  res.json(products);
}

export async function getById(req: Request, res: Response): Promise<void> {
  if (!isValidId(req.params.id)) { res.status(400).json({ error: 'Invalid product id' }); return; }
  const ctx = await getContext();
  const product = await ctx.findOne('products', { id: req.params.id }, { projection: { _id: 0 } });
  if (!product) { res.status(404).json({ error: 'Product not found' }); return; }
  res.json(product);
}

export async function search(req: Request, res: Response): Promise<void> {
  const q = req.query.q as string || '';
  const pattern = contains(q);
  const ctx = await getContext();
  const products = await ctx.find('products', {
    $or: [{ name: pattern }, { sku: pattern }],
  }, { sort: { created_at: -1 }, projection: { _id: 0 } });
  res.json(products);
}

export async function remove(req: Request, res: Response): Promise<void> {
  const id = req.params.id;
  if (!isValidId(id)) { res.status(400).json({ error: 'Invalid product id' }); return; }
  const ctx = await getContext();
  const existing = await ctx.findOne('products', { id }, { projection: { id: 1 } });
  if (!existing) {
    res.status(404).json({ error: 'Product not found' });
    return;
  }
  const batchCount = await ctx.count('batches', { product_id: id });
  if (batchCount > 0) {
    res.status(409).json({
      error: 'This grade already has batches and cannot be deleted. Keep it so batch history stays intact.',
    });
    return;
  }
  await withTransaction(async (tx) => deleteProductCascade(tx, id));
  await ctx.insert('activity_logs', {
    user_name: req.user?.name || 'System',
    user_role: req.user?.role || 'ADMIN',
    action: 'PRODUCT_DELETED',
    description: `Product #${id} deleted`,
  });
  res.json({ message: 'Product deleted' });
}

export async function update(req: Request, res: Response): Promise<void> {
  const id = req.params.id;
  if (!isValidId(id)) { res.status(400).json({ error: 'Invalid product id' }); return; }
  const { name, description, sku, price, quantity, cas_number, molecular_formula, purity, grade, bag_quantity_id, storage_conditions, hazard_classification, physical_state, hsn_code, manufacturer } = req.body;
  if (!name || !sku) {
    res.status(400).json({ error: 'Name and SKU are required' });
    return;
  }
  const ctx = await getContext();
  const sibling = await ctx.findOne('products', {
    id: { $ne: id },
    name: { $regex: `^${String(name).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' },
    grade: { $regex: `^${String(grade || '').trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' },
  }, { projection: { id: 1 } });
  if (sibling) {
    res.status(409).json({ error: `Grade "${grade}" already exists for ${name}` });
    return;
  }
  const result = await ctx.updateOne('products', { id }, {
    $set: {
      name,
      description: description || null,
      sku,
      price: price || 0,
      quantity: quantity || 0,
      cas_number: cas_number || null,
      molecular_formula: molecular_formula || null,
      purity: purity || null,
      grade: grade || null,
      bag_quantity_id: bag_quantity_id || null,
      storage_conditions: storage_conditions || null,
      hazard_classification: hazard_classification || null,
      physical_state: physical_state || null,
      hsn_code: hsn_code || null,
      manufacturer: manufacturer || null,
    },
  });
  if (result.matchedCount === 0) {
    res.status(404).json({ error: 'Product not found' });
    return;
  }
  await ctx.insert('activity_logs', {
    user_name: req.user?.name || 'System',
    user_role: req.user?.role || 'ADMIN',
    action: 'PRODUCT_UPDATED',
    description: `Product "${name}" (${sku}) updated`,
  });
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
  const ctx = await getContext();
  const existing = await ctx.find('products', {}, { projection: { _id: 0, id: 1, name: 1, grade: 1, sku: 1 } });
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
      res.status(409).json({ error: `Grade "${grade.grade}" already exists for ${name}` });
      return;
    }
    if (grade.sku) {
      const skuKey = grade.sku.toLowerCase();
      if (usedSkus.has(skuKey)) {
        res.status(400).json({ error: `SKU "${grade.sku}" already exists` });
        return;
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
  try {
    const created = await withTransaction(async (tx) => {
      const rows: Record<string, unknown>[] = [];
      for (const grade of grades) {
        const id = await tx.insert('products', {
          name,
          description: grade.description || description,
          sku: grade.sku,
          price: 0,
          quantity: grade.quantity,
          cas_number: null,
          molecular_formula: null,
          purity: null,
          grade: grade.grade,
          bag_quantity_id: grade.bag_quantity_id,
          storage_conditions: null,
          hazard_classification: null,
          physical_state: null,
          hsn_code: grade.hsn_code,
          manufacturer: grade.manufacturer || manufacturer,
        });
        rows.push({
          id,
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
      return rows;
    });
    await ctx.insert('activity_logs', {
      user_name: req.user?.name || 'System',
      user_role: req.user?.role || 'ADMIN',
      action: 'PRODUCT_CREATED',
      description: `Product "${name}" created with ${created.length} grade${created.length === 1 ? '' : 's'}`,
    });
    res.status(201).json({
      products: created,
      message: `${name} created with ${created.length} grade${created.length === 1 ? '' : 's'}.`,
    });
  } catch (err: any) {
    if (isDuplicateKey(err)) {
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
  const ctx = await getContext();
  const products = await ctx.find('products', {}, { projection: { _id: 0, id: 1, name: 1 } });
  const family = products.filter(
    (product) => String(product.name || '').trim().toLowerCase() === currentName.toLowerCase()
  );
  if (family.length === 0) {
    res.status(404).json({ error: 'Product not found' });
    return;
  }
  const collides = products.some(
    (product) =>
      String(product.name || '').trim().toLowerCase() === name.toLowerCase() &&
      !family.some((member) => String(member.id) === String(product.id))
  );
  if (collides) {
    res.status(409).json({ error: 'Another product already uses that name' });
    return;
  }
  const update: Record<string, unknown> = { name };
  if (description !== undefined) update.description = description || null;
  await ctx.updateMany(
    'products',
    { id: { $in: family.map((product) => product.id) } },
    { $set: update }
  );
  await ctx.insert('activity_logs', {
    user_name: req.user?.name || 'System',
    user_role: req.user?.role || 'ADMIN',
    action: 'PRODUCT_UPDATED',
    description: `Product "${currentName}" renamed to "${name}"`,
  });
  res.json({ message: `Product renamed to ${name}.`, updated: family.length });
}
