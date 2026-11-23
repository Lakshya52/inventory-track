import { Request, Response } from 'express';
import { DbContext, getContext, isDuplicateKey, isValidId, withTransaction } from '../config/database';
import { prefix, EntityId } from '../services/queryService';
import { divisionFilter, divisionStamp } from '../utils/division';

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

async function deleteProductCascade(ctx: DbContext, productId: EntityId, tenantId: string | number, divisionScope: Record<string, any> = {}): Promise<void> {
  const batches = await ctx.find('batches', { product_id: productId, tenant_id: tenantId, ...divisionScope }, { projection: { id: 1 } });
  const batchIds = batches.map((batch) => batch.id as EntityId);
  if (batchIds.length > 0) {
    await Promise.all([
      ctx.deleteMany('qc_records', { batch_id: { $in: batchIds }, tenant_id: tenantId, ...divisionScope }),
      ctx.deleteMany('dispatch_records', { batch_id: { $in: batchIds }, tenant_id: tenantId, ...divisionScope }),
      ctx.deleteMany('fix_records', { batch_id: { $in: batchIds }, tenant_id: tenantId, ...divisionScope }),
      ctx.deleteMany('packing_list_items', { batch_id: { $in: batchIds }, tenant_id: tenantId, ...divisionScope }),
      ctx.deleteMany('dispatch_orders', { batch_id: { $in: batchIds }, tenant_id: tenantId, ...divisionScope }),
      ctx.deleteMany('qr_labels', { batch_id: { $in: batchIds }, tenant_id: tenantId, ...divisionScope }),
    ]);
  }
  const jobs = await ctx.find('qr_print_jobs', { product_id: productId, tenant_id: tenantId, ...divisionScope }, { projection: { id: 1 } });
  const jobIds = jobs.map((job) => job.id as EntityId);
  if (jobIds.length > 0) {
    await ctx.deleteMany('qr_labels', { print_job_id: { $in: jobIds }, tenant_id: tenantId, ...divisionScope });
    await ctx.deleteMany('qr_print_jobs', { id: { $in: jobIds }, tenant_id: tenantId, ...divisionScope });
  }
  await ctx.deleteMany('batches', { product_id: productId, tenant_id: tenantId, ...divisionScope });
  await ctx.deleteOne('products', { id: productId, tenant_id: tenantId, ...divisionScope });
}

export async function create(req: Request, res: Response): Promise<void> {
  const tenantId = req.user!.tenantId;
  const { name, description, sku, quantity, cas_number, molecular_formula, purity, grade, bag_quantity_id, storage_conditions, hazard_classification, physical_state, hsn_code, manufacturer } = req.body;
  if (!name || !sku) {
    res.status(400).json({ error: 'Name and SKU are required' });
    return;
  }
  const ctx = await getContext();
  if (bag_quantity_id) {
    // bag_quantity_id may reference EITHER the uoms master or the bag_quantities master (polymorphic)
    const bag = await ctx.findOne('bag_quantities', { id: bag_quantity_id, tenant_id: tenantId }, { projection: { id: 1 } });
    if (!bag) {
      const uom = await ctx.findOne('uoms', { id: bag_quantity_id, tenant_id: tenantId }, { projection: { id: 1 } });
      if (!uom) {
        res.status(400).json({ error: 'UOM/Bag not found' });
        return;
      }
    }
  }
  try { 
    const id = await ctx.insert('products', {
      tenant_id: tenantId,
      division_id: divisionStamp(req),
      is_active: 1,
      name,
      description: description || null,
      sku,
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
      tenant_id: tenantId,
      division_id: divisionStamp(req),
      user_name: req.user?.name || 'System',
      user_role: req.user?.role || 'ADMIN',
      action: 'PRODUCT_CREATED',
      description: `Product "${name}" (${sku}) created`,
    });
    res.status(201).json({ id, name, description, sku, quantity, cas_number, molecular_formula, purity, grade, bag_quantity_id: bag_quantity_id || null, storage_conditions, hazard_classification, physical_state, hsn_code, manufacturer });
  } catch (err: any) {
    if (isDuplicateKey(err)) {
      res.status(400).json({ error: 'SKU already exists' });
      return;
    }
    throw err;
  }
}

export async function listFamilies(req: Request, res: Response): Promise<void> {
  const tenantId = req.user!.tenantId;
  const ctx = await getContext();
  const dv = divisionFilter(req);
  const includeInactive = String(req.query.include || '').trim().toLowerCase() === 'inactive';
  // $sort with a numeric collation so embedded digit runs compare as numbers
  // ("P9" < "P89" < "P90") — plain string order would interleave "P9" with the P8x/P9x family.
  const NATURAL_COLLATION = { locale: 'en', numericOrdering: true } as const;
  const families = await ctx.aggregate('products', [
    { $match: { tenant_id: tenantId, ...(includeInactive ? { is_active: 0 } : { is_active: 1 }), ...dv } },
    // Drop large fields before grouping — a 50k-grade catalogue otherwise
    // drags full documents through the aggregation pipeline.
    { $project: { name: 1, description: 1, manufacturer: 1, division_id: 1 } },
    {
      $group: {
        _id: { $toLower: '$name' },
        name: { $first: '$name' },
        description: { $max: '$description' },
        manufacturer: { $max: '$manufacturer' },
        count: { $sum: 1 },
        divisionIds: { $addToSet: '$division_id' },
      },
    },
    { $sort: { name: 1 } },
    { $project: { _id: 0, name: 1, description: 1, manufacturer: 1, count: 1, totalCount: '$count', divisionIds: 1 } },
  ], { collation: NATURAL_COLLATION } as any);
  res.json(families);
}

/** Page-sized variant for the product groups table (the full list above stays for pickers). */
export async function listFamiliesPage(req: Request, res: Response): Promise<void> {
  const tenantId = req.user!.tenantId;
  const ctx = await getContext();
  const dv = divisionFilter(req);
  const includeInactive = String(req.query.include || '').trim().toLowerCase() === 'inactive';
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(200, Math.max(1, Number(req.query.limit) || 25));
  const NATURAL_COLLATION = { locale: 'en', numericOrdering: true } as const;
  // One pass with $facet computes both the total and the requested page.
  // The old version grouped the whole catalogue twice (once for count, once
  // for rows) on every load — the main cost when a division is selected.
  const [result] = await ctx.aggregate('products', [
    { $match: { tenant_id: tenantId, ...(includeInactive ? { is_active: 0 } : { is_active: 1 }), ...dv } },
    { $project: { name: 1, description: 1, manufacturer: 1, division_id: 1 } },
    {
      $group: {
        _id: { $toLower: '$name' },
        name: { $first: '$name' },
        description: { $max: '$description' },
        manufacturer: { $max: '$manufacturer' },
        count: { $sum: 1 },
        divisionIds: { $addToSet: '$division_id' },
      },
    },
    {
      $facet: {
        count: [{ $count: 'total' }],
        // All families in the same pass, so the UI no longer needs a second
        // full aggregation just to populate its typeahead and counters.
        all: [
          { $sort: { name: 1 } },
          { $project: { _id: 0, name: 1, description: 1, manufacturer: 1, count: 1, totalCount: '$count', divisionIds: 1 } },
        ],
        items: [
          { $sort: { name: 1 } },
          { $skip: (page - 1) * pageSize },
          { $limit: pageSize },
          { $project: { _id: 0, name: 1, description: 1, manufacturer: 1, count: 1, totalCount: '$count', divisionIds: 1 } },
        ],
      },
    },
  ], { collation: NATURAL_COLLATION } as any);
  const items = (result as any)?.items ?? [];
  const allFamilies = (result as any)?.all ?? [];
  const total = Number((result as any)?.count?.[0]?.total ?? 0);
  res.json({ items, allFamilies, total, page, pages: Math.max(1, Math.ceil(total / pageSize)), pageSize });
}

export async function listFamilyProducts(req: Request, res: Response): Promise<void> {
  const tenantId = req.user!.tenantId;
  const family = String(req.params.name || '').trim();
  if (!family) { res.status(400).json({ error: 'Family name is required.' }); return; }
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 100));
  const q = String(req.query.q || '').trim();
  const ctx = await getContext();
  const dv = divisionFilter(req);
  const filter: Record<string, any> = { tenant_id: tenantId, is_active: 1, ...dv, name: family };
  if (q) {
    const pattern = prefix(q);
    filter.$or = [
      { grade: pattern },
      { sku: pattern },
      { manufacturer: pattern },
      { description: pattern },
    ];
  }
  const total = await ctx.count('products', filter);
  const NATURAL_COLLATION = { locale: 'en', numericOrdering: true } as const;
  const products = await ctx.find('products', filter, {
    sort: { grade: 1, sku: 1 },
    collation: NATURAL_COLLATION,
    skip: (page - 1) * limit,
    limit,
    projection: { _id: 0 },
  });
  res.json({ products, total, page, limit, totalPages: Math.max(1, Math.ceil(total / limit)) });
}

export async function nextSku(req: Request, res: Response): Promise<void> {
  const tenantId = req.user!.tenantId;
  const name = String(req.query.name || '').trim();
  if (!name) { res.status(400).json({ error: 'name query parameter is required.' }); return; }
  const ctx = await getContext();
  const prefix = familySkuPrefix(name);
  const regex = new RegExp(`^${prefix}-(\\d+)$`, 'i');
  const existing = await ctx.find('products', {
    tenant_id: tenantId,
    sku: { $regex: `^${prefix}-\\d+$`, $options: 'i' },
  }, { projection: { _id: 0, sku: 1 }, limit: 10000 });
  let sequence = 1;
  for (const row of existing) {
    const match = regex.exec(String(row.sku || ''));
    if (match) sequence = Math.max(sequence, Number(match[1]) + 1);
  }
  res.json({ sku: `${prefix}-${String(sequence).padStart(3, '0')}` });
}

export async function list(req: Request, res: Response): Promise<void> {
  const tenantId = req.user!.tenantId;
  const ctx = await getContext();
  const products = await ctx.find('products', { tenant_id: tenantId, is_active: 1, ...divisionFilter(req) }, { sort: { created_at: -1 }, projection: { _id: 0 } });
  res.json(products);
}

export async function getById(req: Request, res: Response): Promise<void> {
  const tenantId = req.user!.tenantId;
  if (!isValidId(req.params.id)) { res.status(400).json({ error: 'Invalid product id' }); return; }
  const ctx = await getContext();
  const product = await ctx.findOne('products', { id: req.params.id, tenant_id: tenantId, is_active: 1, ...divisionFilter(req) }, { projection: { _id: 0 } });
  if (!product) { res.status(404).json({ error: 'Product not found' }); return; }
  res.json(product);
}

export async function search(req: Request, res: Response): Promise<void> {
  const tenantId = req.user!.tenantId;
  const q = req.query.q as string || '';
  if (!q) { res.json([]); return; }
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 100));
  const pattern = prefix(q);
  const ctx = await getContext();
  const products = await ctx.find('products', {
    tenant_id: tenantId,
    is_active: 1,
    ...divisionFilter(req),
    $or: [{ name: pattern }, { sku: pattern }],
  }, { sort: { created_at: -1 }, projection: { _id: 0 }, limit });
  res.json(products);
}

export async function remove(req: Request, res: Response): Promise<void> {
  const tenantId = req.user!.tenantId;
  const id = req.params.id;
  if (!isValidId(id)) { res.status(400).json({ error: 'Invalid product id' }); return; }
  const ctx = await getContext();
  const existing = await ctx.findOne('products', { id, tenant_id: tenantId, ...divisionFilter(req) }, { projection: { id: 1 } });
  if (!existing) {
    res.status(404).json({ error: 'Product not found' });
    return;
  }
  const batchCount = await ctx.count('batches', { product_id: id, tenant_id: tenantId, ...divisionFilter(req) });
  if (batchCount > 0) {
    res.status(409).json({
      error: 'This grade already has batches and cannot be deleted. Keep it so batch history stays intact.',
    });
    return;
  }
  await withTransaction(async (tx) => deleteProductCascade(tx, id, tenantId, divisionFilter(req)));
  await ctx.insert('activity_logs', {
    tenant_id: tenantId,
    division_id: divisionStamp(req),
    user_name: req.user?.name || 'System',
    user_role: req.user?.role || 'ADMIN',
    action: 'PRODUCT_DELETED',
    description: `Product #${id} deleted`,
  });
  res.json({ message: 'Product deleted' });
}

export async function update(req: Request, res: Response): Promise<void> {
  const tenantId = req.user!.tenantId;
  const id = req.params.id;
  if (!isValidId(id)) { res.status(400).json({ error: 'Invalid product id' }); return; }
  const { name, description, sku, quantity, cas_number, molecular_formula, purity, grade, bag_quantity_id, storage_conditions, hazard_classification, physical_state, hsn_code, manufacturer } = req.body;
  if (!name || !sku) {
    res.status(400).json({ error: 'Name and SKU are required' });
    return;
  }
  const ctx = await getContext();
  if (bag_quantity_id) {
    // bag_quantity_id may reference EITHER the uoms master or the bag_quantities master (polymorphic)
    const bag = await ctx.findOne('bag_quantities', { id: bag_quantity_id, tenant_id: tenantId }, { projection: { id: 1 } });
    if (!bag) {
      const uom = await ctx.findOne('uoms', { id: bag_quantity_id, tenant_id: tenantId }, { projection: { id: 1 } });
      if (!uom) {
        res.status(400).json({ error: 'UOM/Bag not found' });
        return;
      }
    }
  }
  const sibling = await ctx.findOne('products', {
    tenant_id: tenantId,
    ...divisionFilter(req),
    id: { $ne: id },
    name: { $regex: `^${String(name).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' },
    grade: { $regex: `^${String(grade || '').trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' },
  }, { projection: { id: 1 } });
  if (sibling) {
    res.status(409).json({ error: `Grade "${grade}" already exists for product : ${name}` });
    return;
  }
  const result = await ctx.updateOne('products', { id, tenant_id: tenantId, ...divisionFilter(req) }, {
    $set: {
      name,
      description: description || null,
      sku,
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
    tenant_id: tenantId,
    division_id: divisionStamp(req),
    user_name: req.user?.name || 'System',
    user_role: req.user?.role || 'ADMIN',
    action: 'PRODUCT_UPDATED',
    description: `Product "${name}" (${sku}) updated`,
  });
  res.json({ message: 'Product updated' });
}

export async function createFamily(req: Request, res: Response): Promise<void> {
  const tenantId = req.user!.tenantId;
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
  const bagLikeIds = Array.from(new Set(grades.map((grade) => grade.bag_quantity_id).filter((id): id is string => Boolean(id))));
  if (bagLikeIds.length > 0) {
    // bag_quantity_id may reference EITHER the uoms master or the bag_quantities master (polymorphic)
    const bags = await ctx.find('bag_quantities', { tenant_id: tenantId, id: { $in: bagLikeIds } }, { projection: { id: 1 } });
    const uoms = await ctx.find('uoms', { tenant_id: tenantId, id: { $in: bagLikeIds } }, { projection: { id: 1 } });
    const known = new Set([...bags.map((r: any) => String(r.id)), ...uoms.map((r: any) => String(r.id))]);
    const missing = bagLikeIds.filter((id) => !known.has(String(id)));
    if (missing.length > 0) {
      res.status(400).json({ error: `UOM/Bag "${missing[0]}" not found` });
      return;
    }
  }
  const existing = await ctx.find('products', { tenant_id: tenantId, ...divisionFilter(req) }, { projection: { _id: 0, id: 1, name: 1, grade: 1, sku: 1 } });
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
      res.status(409).json({ error: `Grade "${grade.grade}" already exists for product : ${name}` });
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
          tenant_id: tenantId,
          division_id: divisionStamp(req),
          is_active: 1,
          name,
          description: grade.description || description,
          sku: grade.sku,
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
      tenant_id: tenantId,
      division_id: divisionStamp(req),
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
  const tenantId = req.user!.tenantId;
  const currentName = cleanText(req.body?.currentName, 150);
  const name = cleanText(req.body?.name, 150);
  const description =
    req.body?.description === undefined ? undefined : cleanText(req.body?.description, 500);
  if (!currentName || !name) {
    res.status(400).json({ error: 'Enter the current and new product name' });
    return;
  }
  const ctx = await getContext();
  const products = await ctx.find('products', { tenant_id: tenantId, ...divisionFilter(req) }, { projection: { _id: 0, id: 1, name: 1 } });
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
    { id: { $in: family.map((product) => product.id) }, tenant_id: tenantId, ...divisionFilter(req) },
    { $set: update }
  );
  await ctx.insert('activity_logs', {
    tenant_id: tenantId,
    division_id: divisionStamp(req),
    user_name: req.user?.name || 'System',
    user_role: req.user?.role || 'ADMIN',
    action: 'PRODUCT_UPDATED',
    description: `Product "${currentName}" renamed to "${name}"`,
  });
  res.json({ message: `Product renamed to ${name}.`, updated: family.length });
}

/**
 * Reactivate an entire family — every grade row of the product goes back to is_active = 1.
 * The rows reappear in the catalogue, search, etc. No history is recreated.
 */
export async function reactivateFamily(req: Request, res: Response): Promise<void> {
  const tenantId = req.user!.tenantId;
  const name = cleanText(req.params.name, 150);
  if (!name) {
    res.status(400).json({ error: 'Product name is required' });
    return;
  }
  const ctx = await getContext();
  const safeName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const familyRegex = new RegExp(`^${safeName}$`, 'i');
  const dv = divisionFilter(req);
  const products = await ctx.find('products', { tenant_id: tenantId, ...dv, name: familyRegex }, { projection: { _id: 0, id: 1, is_active: 1 } });
  if (products.length === 0) {
    res.status(404).json({ error: `Product "${name}" not found or already active` });
    return;
  }
  const alreadyActive = products.filter((row) => Number(row.is_active) === 1);
  if (alreadyActive.length === products.length) {
    res.json({ reactivated: 0, alreadyActive: true, message: `"${name}" is already active.` });
    return;
  }
  const result = await ctx.updateMany(
    'products',
    { tenant_id: tenantId, ...dv, name: familyRegex, is_active: 0 },
    { $set: { is_active: 1 } }
  );
  const modified = Number(result.modifiedCount ?? 0);
  await ctx.insert('activity_logs', {
    tenant_id: tenantId,
    division_id: divisionStamp(req),
    user_name: req.user?.name || 'System',
    user_role: req.user?.role || 'ADMIN',
    action: 'PRODUCT_FAMILY_REACTIVATED',
    description: `Product family "${name}" reactivated with ${modified} grade${modified === 1 ? '' : 's'}`,
  });
  res.json({ reactivated: modified, message: `"${name}" and its ${modified} grade${modified === 1 ? '' : 's'} were reactivated.` });
}

/**
 * Deactivate an entire family — every grade row of the product.
 * The product and its grades stay in the database for history, but stop being
 * visible or usable anywhere (catalogue, search, QC, dispatch, picking, print…).
 * Related records (batches, QC, dispatch, QR labels) are left untouched.
 * Deletion stays possible afterwards via DELETE /products/families/:name.
 */
export async function deactivateFamily(req: Request, res: Response): Promise<void> {
  const tenantId = req.user!.tenantId;
  const name = cleanText(req.params.name, 150);
  if (!name) {
    res.status(400).json({ error: 'Product name is required' });
    return;
  }
  const ctx = await getContext();
  const safeName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const familyRegex = new RegExp(`^${safeName}$`, 'i');
  const dv = divisionFilter(req);
  const products = await ctx.find('products', { tenant_id: tenantId, ...dv, name: familyRegex }, { projection: { _id: 0, id: 1, is_active: 1 } });
  if (products.length === 0) {
    res.json({ deactivated: 0, message: 'Nothing to deactivate — there are no grades in this product.' });
    return;
  }
  const alreadyInactive = products.filter((row) => Number(row.is_active) === 0);
  if (alreadyInactive.length === products.length) {
    res.json({ deactivated: 0, alreadyDeactivated: true, message: `"${name}" is already deactivated.` });
    return;
  }
  const result = await ctx.updateMany(
    'products',
    { tenant_id: tenantId, ...dv, name: familyRegex, is_active: 1 },
    { $set: { is_active: 0 } }
  );
  const modified = Number(result.modifiedCount ?? 0);
  await ctx.insert('activity_logs', {
    tenant_id: tenantId,
    division_id: divisionStamp(req),
    user_name: req.user?.name || 'System',
    user_role: req.user?.role || 'ADMIN',
    action: 'PRODUCT_FAMILY_DEACTIVATED',
    description: `Product family "${name}" deactivated with ${modified} grade${modified === 1 ? '' : 's'}`,
  });
  res.json({ deactivated: modified, message: `"${name}" and its ${modified} grade${modified === 1 ? '' : 's'} were deactivated.` });
}



/**
 * Delete an entire family — every grade row of the product.
 * Refuses the WHOLE operation when any grade already has batches, naming the grades.
 * An empty family returns { deleted: 0 } silently.
 */
export async function removeFamily(req: Request, res: Response): Promise<void> {
  const tenantId = req.user!.tenantId;
  const name = cleanText(req.params.name, 150);
  if (!name) {
    res.status(400).json({ error: 'Product name is required' });
    return;
  }
  const ctx = await getContext();
  const safeName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const familyRegex = new RegExp(`^${safeName}$`, 'i');
  const dv = divisionFilter(req);
  const products = await ctx.find('products', { tenant_id: tenantId, ...dv, name: familyRegex }, { projection: { _id: 0, id: 1, name: 1, grade: 1 } });
  if (products.length === 0) {
    res.json({ deleted: 0, message: 'Nothing to delete — there are no grades left.' });
    return;
  }
  const ids = products.map((product) => product.id as EntityId);
  const batchRows = await ctx.find('batches', { product_id: { $in: ids }, tenant_id: tenantId, ...dv }, { projection: { _id: 0, product_id: 1 } });
  if (batchRows.length > 0) {
    const gradeById = new Map(products.map((product) => [String(product.id), product.grade ?? '(no grade)']));
    const gradesWithBatches = [...new Set(batchRows.map((batch) => gradeById.get(String(batch.product_id)) || '(unknown grade)'))];
    res.status(409).json({
      error: `Cannot delete "${name}" — these grades have batches: ${gradesWithBatches.join(', ')}. Keep them so batch history stays intact.`,
    });
    return;
  }
  await withTransaction(async (tx) => {
    for (const id of ids) {
      await deleteProductCascade(tx, id, tenantId, dv);
    }
  });
  await ctx.insert('activity_logs', {
    tenant_id: tenantId,
    division_id: divisionStamp(req),
    user_name: req.user?.name || 'System',
    user_role: req.user?.role || 'ADMIN',
    action: 'PRODUCT_FAMILY_DELETED',
    description: `Product family "${name}" deleted with ${products.length} grade${products.length === 1 ? '' : 's'}`,
  });
  res.json({ deleted: products.length, message: `"${name}" and its ${products.length} grade${products.length === 1 ? '' : 's'} were deleted.` });
}
