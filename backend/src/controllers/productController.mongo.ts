import { Request, Response } from 'express';
import { DbContext, getContext, isDuplicateKey, isValidId, withTransaction } from '../config/database';
import { contains, EntityId } from '../services/queryService';

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
