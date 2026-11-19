import { getContext, DbContext, isDuplicateKey } from './database';
import { nextDispatchOrderNumber } from '../services/orderNumbers';

async function ensureIndexes(ctx: DbContext): Promise<void> {
  const unique = { unique: true } as const;
  const sparseUnique = { unique: true, partialFilterExpression: { client_operation_id: { $type: 'string' } } } as const;

  await Promise.all([
    // Divisions: optional manufacturing units within a tenant.
    ctx.collection('divisions').createIndex({ tenant_id: 1, name: 1 }, unique),
    ctx.collection('divisions').createIndex({ tenant_id: 1 }),
    // Compound indexes — tenant and division scope leading, then the operational
    // filter/sort key. Unblocks covering scans and keyset pagination.
    ctx.collection('products').createIndex({ tenant_id: 1, division_id: 1, is_active: 1, updated_at: -1 }),
    ctx.collection('batches').createIndex({ tenant_id: 1, division_id: 1, updated_at: -1 }),
    ctx.collection('batches').createIndex({ tenant_id: 1, division_id: 1, status: 1, updated_at: -1 }),
    ctx.collection('batch_groups').createIndex({ tenant_id: 1, division_id: 1, created_at: -1 }),
    ctx.collection('qc_records').createIndex({ tenant_id: 1, division_id: 1, created_at: -1 }),
    ctx.collection('qc_records').createIndex({ tenant_id: 1, division_id: 1, batch_id: 1, created_at: -1 }),
    ctx.collection('dispatch_orders').createIndex({ tenant_id: 1, division_id: 1, created_at: -1 }),
    ctx.collection('dispatch_records').createIndex({ tenant_id: 1, division_id: 1, created_at: -1 }),
    ctx.collection('qr_labels').createIndex({ tenant_id: 1, division_id: 1, batch_id: 1 }),
    ctx.collection('qr_print_jobs').createIndex({ tenant_id: 1, division_id: 1, created_at: -1 }),
    ctx.collection('loading_sessions').createIndex({ tenant_id: 1, division_id: 1, updated_at: -1 }),
    ctx.collection('packing_list_items').createIndex({ tenant_id: 1, division_id: 1, created_at: -1 }),
    ctx.collection('admins').createIndex({ division_id: 1 }),
    ctx.collection('qc_users').createIndex({ division_id: 1 }),
    ctx.collection('dispatch_users').createIndex({ division_id: 1 }),
    ctx.collection('products').createIndex({ division_id: 1 }),
    ctx.collection('grades').createIndex({ division_id: 1 }),
    ctx.collection('batches').createIndex({ division_id: 1 }),
    ctx.collection('batch_groups').createIndex({ division_id: 1 }),
    ctx.collection('qc_records').createIndex({ division_id: 1 }),
    ctx.collection('dispatch_records').createIndex({ division_id: 1 }),
    ctx.collection('dispatch_orders').createIndex({ division_id: 1 }),
    ctx.collection('fix_records').createIndex({ division_id: 1 }),
    ctx.collection('packing_list_items').createIndex({ division_id: 1 }),
    ctx.collection('qr_labels').createIndex({ division_id: 1 }),
    ctx.collection('qr_print_jobs').createIndex({ division_id: 1 }),
    ctx.collection('warehouses').createIndex({ division_id: 1 }),
    ctx.collection('storage_racks').createIndex({ division_id: 1 }),
    ctx.collection('shelf_locations').createIndex({ division_id: 1 }),
    ctx.collection('loading_sessions').createIndex({ division_id: 1 }),
    ctx.collection('loading_scan_events').createIndex({ division_id: 1 }),
    ctx.collection('activity_logs').createIndex({ division_id: 1 }),

    ctx.collection('warehouses').createIndex({ tenant_id: 1, name: 1 }, unique),
    ctx.collection('storage_racks').createIndex({ tenant_id: 1, warehouse_id: 1, rack_code: 1 }, unique),
    ctx.collection('tenants').createIndex({ email_key: 1 }, unique),
    ctx.collection('tenants').createIndex({ slug: 1 }, unique),
    ctx.collection('qr_reprint_requests').createIndex({ tenant_id: 1, status: 1, requested_at: -1 }),
    ctx.collection('admins').createIndex({ email: 1 }, unique),
    ctx.collection('qc_users').createIndex({ email: 1 }, unique),
    ctx.collection('dispatch_users').createIndex({ email: 1 }, unique),

    // Tenant-scoped uniqueness: separate workspaces may reuse the same SKU,
    // barcode, order number, master-data name, etc.
    ctx.collection('products').createIndex({ is_active: 1, name: 1 }),
    ctx.collection('products').createIndex({ tenant_id: 1, sku: 1 }, unique),
    ctx.collection('products').createIndex({ updated_at: 1 }),
    ctx.collection('products').createIndex({ name: 1 }),

    ctx.collection('shelf_locations').createIndex({ tenant_id: 1, location_code: 1 }, unique),
    ctx.collection('shelf_locations').createIndex({ updated_at: 1 }),

    ctx.collection('clients').createIndex({ is_active: 1, name: 1 }),
    ctx.collection('clients').createIndex({ updated_at: 1 }),
    ctx.collection('clients').createIndex({ tenant_id: 1 }),

    ctx.collection('vendors').createIndex({ tenant_id: 1, vendor_code: 1 }, unique),
    ctx.collection('vendors').createIndex({ name: 1 }),
    ctx.collection('vendors').createIndex({ is_active: 1 }),
    ctx.collection('vendors').createIndex({ tenant_id: 1 }),
    ctx.collection('grades').createIndex({ tenant_id: 1, name: 1 }, unique),
    ctx.collection('grades').createIndex({ is_active: 1 }),
    ctx.collection('uoms').createIndex({ tenant_id: 1, name: 1 }, unique),
    ctx.collection('uoms').createIndex({ is_active: 1 }),
    ctx.collection('bag_quantities').createIndex({ tenant_id: 1, name: 1 }, unique),
    ctx.collection('bag_quantities').createIndex({ is_active: 1 }),

    ctx.collection('batches').createIndex({ tenant_id: 1, barcode_value: 1 }, unique),
    ctx.collection('batches').createIndex({ tenant_id: 1 }),
    ctx.collection('batches').createIndex({ batch_number: 1 }),
    ctx.collection('batches').createIndex({ product_id: 1, created_at: -1 }),
    ctx.collection('batches').createIndex({ batch_group_id: 1 }),
    ctx.collection('batch_groups').createIndex({ group_key: 1 }, unique),
    ctx.collection('batch_groups').createIndex({ tenant_id: 1, batch_number: 1 }, unique),
    ctx.collection('batch_groups').createIndex({ tenant_id: 1 }),
    ctx.collection('batch_groups').createIndex({ client_operation_id: 1 }, sparseUnique),
    ctx.collection('batches').createIndex({ status: 1, updated_at: 1 }),
    ctx.collection('batches').createIndex({ updated_at: 1 }),
    ctx.collection('batches').createIndex({ shelf_location_id: 1 }),

    ctx.collection('qr_print_jobs').createIndex({ tenant_id: 1, job_code: 1 }, unique),
    ctx.collection('qr_print_jobs').createIndex({ tenant_id: 1 }),
    ctx.collection('qr_print_jobs').createIndex({ product_id: 1, created_at: -1 }),
    ctx.collection('qr_print_jobs').createIndex({ created_at: -1 }),

    ctx.collection('qr_labels').createIndex({ tenant_id: 1, qr_value: 1 }, unique),
    ctx.collection('qr_labels').createIndex({ tenant_id: 1 }),
    ctx.collection('qr_labels').createIndex({ print_job_id: 1, serial_no: 1 }, unique),
    ctx.collection('qr_labels').createIndex({ batch_id: 1 }),
    ctx.collection('qr_labels').createIndex({ print_job_id: 1 }),

    ctx.collection('qc_records').createIndex({ client_operation_id: 1 }, sparseUnique),
    ctx.collection('qc_records').createIndex({ tester_id: 1, created_at: -1 }),
    ctx.collection('qc_records').createIndex({ batch_id: 1, created_at: -1 }),
    ctx.collection('qc_records').createIndex({ created_at: -1 }),
    ctx.collection('qc_records').createIndex({ group_operation_id: 1 }),
    ctx.collection('qc_records').createIndex({ result: 1 }),

    ctx.collection('dispatch_orders').createIndex({ client_operation_id: 1 }, sparseUnique),
    ctx.collection('dispatch_orders').createIndex({ status: 1, created_at: -1 }),
    ctx.collection('dispatch_orders').createIndex({ raised_by: 1, created_at: -1 }),
    ctx.collection('dispatch_orders').createIndex({ batch_id: 1, status: 1 }),
    ctx.collection('dispatch_orders').createIndex({ updated_at: 1 }),
    ctx.collection('dispatch_orders').createIndex({ scheduled_dispatch_at: 1 }),

    ctx.collection('dispatch_records').createIndex({ client_operation_id: 1 }, sparseUnique),
    ctx.collection('dispatch_records').createIndex({ dispatcher_id: 1, created_at: -1 }),
    ctx.collection('dispatch_records').createIndex({ batch_id: 1, created_at: -1 }),
    ctx.collection('dispatch_records').createIndex({ created_at: -1 }),
    ctx.collection('dispatch_records').createIndex({ dispatch_order_id: 1 }),
    ctx.collection('dispatch_records').createIndex({ group_operation_id: 1 }),

    ctx.collection('fix_records').createIndex({ batch_id: 1 }),
    ctx.collection('fix_records').createIndex({ tenant_id: 1 }),
    ctx.collection('fix_records').createIndex({ created_at: -1 }),

    ctx.collection('packing_list_items').createIndex({ dispatch_order_id: 1 }),
    ctx.collection('packing_list_items').createIndex({ batch_id: 1 }),
    ctx.collection('packing_list_items').createIndex({ tenant_id: 1 }),

    ctx.collection('loading_sessions').createIndex({ dispatch_order_id: 1 }),
    ctx.collection('loading_sessions').createIndex({ batch_id: 1 }),
    ctx.collection('loading_sessions').createIndex({ tenant_id: 1 }),
    ctx.collection('loading_sessions').createIndex({ status: 1, started_at: -1 }),
    ctx.collection('loading_sessions').createIndex({ loader_id: 1, started_at: -1 }),
    ctx.collection('loading_sessions').createIndex({ updated_at: 1 }),
    // Explicit names are required: the plain dispatch_order_id_1 / batch_id_1
    // indexes above already claim the auto-generated index names.
    // Uniqueness is per tenant: one active loading session per order/batch
    // within a single workspace, never across workspaces.
    ctx.collection('loading_sessions').createIndex(
      { tenant_id: 1, dispatch_order_id: 1 },
      { name: 'uniq_active_session_per_tenant_order', unique: true, partialFilterExpression: { status: 'ACTIVE' } }
    ),
    ctx.collection('loading_sessions').createIndex(
      { tenant_id: 1, batch_id: 1 },
      { name: 'uniq_active_session_per_tenant_batch', unique: true, partialFilterExpression: { status: 'ACTIVE' } }
    ),

    ctx.collection('loading_scan_events').createIndex({ session_id: 1, scanned_at: 1 }),
    ctx.collection('loading_scan_events').createIndex({ tenant_id: 1 }),
    ctx.collection('loading_scan_events').createIndex({ result: 1 }),
    ctx.collection('loading_scan_events').createIndex({ client_operation_id: 1 }, sparseUnique),
    ctx.collection('loading_scan_events').createIndex({ session_id: 1, qr_value: 1, result: 1 }),
    ctx.collection('loading_recalls').createIndex({ session_id: 1 }),
    ctx.collection('loading_recalls').createIndex({ dispatch_order_id: 1, reloaded: 1 }),
    ctx.collection('loading_recalls').createIndex({ tenant_id: 1 }),

    ctx.collection('activity_logs').createIndex({ created_at: -1 }),
    ctx.collection('activity_logs').createIndex({ tenant_id: 1, created_at: -1 }),
    ctx.collection('activity_logs').createIndex({ user_role: 1, user_id: 1, created_at: -1 }),

    ctx.collection('devices').createIndex({ device_uuid: 1 }, unique),
    ctx.collection('devices').createIndex({ tenant_id: 1 }),
    ctx.collection('devices').createIndex({ user_role: 1, user_id: 1 }),
    ctx.collection('devices').createIndex({ last_seen_at: 1 }),

    ctx.collection('device_sync_state').createIndex({ device_uuid: 1 }, unique),

    ctx.collection('sync_operations').createIndex({ operation_id: 1 }, unique),
    ctx.collection('sync_operations').createIndex({ tenant_id: 1 }),
    ctx.collection('sync_operations').createIndex({ user_role: 1, user_id: 1, server_timestamp: -1 }),
    ctx.collection('sync_operations').createIndex({ device_uuid: 1, server_timestamp: -1 }),
    ctx.collection('sync_operations').createIndex({ status: 1, server_timestamp: -1 }),

    ctx.collection('refresh_tokens').createIndex({ token_hash: 1 }, unique),
    ctx.collection('refresh_tokens').createIndex({ user_role: 1, user_id: 1 }),
    ctx.collection('refresh_tokens').createIndex({ expires_at: 1 }),
  ]);
}

/**
 * Idempotent startup migration. MongoDB creates collections on first write,
 * so this creates indexes and normalizes legacy active flags used by
 * master-data dropdowns. Existing document IDs are left untouched.
 */
export async function ensureAdminSchema(): Promise<void> {
  const ctx = await getContext();
  await ensureIndexes(ctx);
  await ctx.collection('tenants').createIndex({ email_key: 1 }, { unique: true });
  await ctx.collection('tenants').createIndex({ slug: 1 }, { unique: true });
  for (const table of ['admins', 'qc_users', 'dispatch_users']) {
    await ctx.collection(table).createIndex({ tenant_id: 1, email: 1 }, { unique: true, partialFilterExpression: { tenant_id: { $type: 'number' } } });
  }
  const firstAdmin = await ctx.findOne('admins', {}, { projection: { _id: 0, id: 1, name: 1, email: 1 } });
  let legacyTenant = await ctx.findOne('tenants', { slug: 'legacy-workspace' }, { projection: { _id: 0, id: 1 } });
  if (!legacyTenant && firstAdmin) {
    try {
      const id = await ctx.insert('tenants', { name: 'Legacy workspace', email: firstAdmin.email || 'legacy@invalid.local', email_key: '__legacy_workspace__', phone: '0000000000', slug: 'legacy-workspace', is_active: 1 });
      legacyTenant = { id };
    } catch (error) { if (!isDuplicateKey(error)) throw error; legacyTenant = await ctx.findOne('tenants', { slug: 'legacy-workspace' }, { projection: { _id: 0, id: 1 } }); }
  }
  if (legacyTenant) {
    for (const collection of ['admins', 'qc_users', 'dispatch_users', 'products', 'batches', 'qc_records', 'dispatch_records', 'dispatch_orders', 'clients', 'vendors', 'shelf_locations', 'activity_logs', 'qr_print_jobs']) {
      await ctx.updateMany(collection, { tenant_id: { $exists: false } }, { $set: { tenant_id: legacyTenant.id } });
      await ctx.updateMany(collection, { tenant_id: null }, { $set: { tenant_id: legacyTenant.id } });
    }
  }

  // Parent-derived tenant backfills for the collections that belong to a batch
  // or a dispatch order, so their rows inherit the right workspace.
  const parentBackfills: Array<{ collection: string; from: string; localField: string }> = [
    { collection: 'qr_labels', from: 'batches', localField: 'batch_id' },
    { collection: 'fix_records', from: 'batches', localField: 'batch_id' },
    { collection: 'packing_list_items', from: 'dispatch_orders', localField: 'dispatch_order_id' },
    { collection: 'loading_sessions', from: 'dispatch_orders', localField: 'dispatch_order_id' },
    { collection: 'loading_sessions', from: 'batches', localField: 'batch_id' },
    { collection: 'loading_scan_events', from: 'loading_sessions', localField: 'session_id' },
  ];
  for (const { collection, from, localField } of parentBackfills) {
    await ctx.collection(collection).aggregate([
      { $match: { $or: [{ tenant_id: { $exists: false } }, { tenant_id: null }] } },
      { $lookup: { from, localField, foreignField: '_id', as: 'parent' } },
      { $match: { 'parent.0.tenant_id': { $exists: true, $ne: null } } },
      { $set: { tenant_id: { $first: '$parent.tenant_id' } } },
      { $unset: 'parent' },
      { $merge: { into: collection, whenMatched: 'replace', whenNotMatched: 'discard' } },
    ]).toArray();
  }
  // Everything else still missing a tenant (master data, devices, sync log, and
  // rows without a resolvable parent) belongs to the legacy workspace.
  if (legacyTenant) {
    for (const collection of ['qr_labels', 'fix_records', 'packing_list_items', 'loading_sessions', 'loading_scan_events', 'grades', 'bag_quantities', 'uoms', 'devices', 'device_sync_state', 'sync_operations', 'batch_groups', 'production_users']) {
      await ctx.updateMany(collection, { tenant_id: { $exists: false } }, { $set: { tenant_id: legacyTenant.id } });
      await ctx.updateMany(collection, { tenant_id: null }, { $set: { tenant_id: legacyTenant.id } });
    }
    try {
      await ctx.collection('production_users').createIndex({ tenant_id: 1 });
    } catch {
      // Optional legacy collection — nothing to index if absent.
    }
  }

  // Drop legacy global unique indexes; tenant-scoped composite uniques were
  // created by ensureIndexes above.
  const legacyUniqueIndexes: Array<[string, string]> = [
    ['products', 'sku_1'],
    ['shelf_locations', 'location_code_1'],
    ['vendors', 'vendor_code_1'],
    ['batches', 'barcode_value_1'],
    ['qr_print_jobs', 'job_code_1'],
    ['qr_labels', 'qr_value_1'],
    ['grades', 'name_1'],
    ['uoms', 'name_1'],
    ['bag_quantities', 'name_1'],
    ['batch_groups', 'batch_number_1'],
    ['loading_sessions', 'uniq_active_session_per_order'],
    ['loading_sessions', 'uniq_active_session_per_batch'],
  ];
  for (const [collection, index] of legacyUniqueIndexes) {
    try {
      await ctx.collection(collection).dropIndex(index);
    } catch {
      // Index does not exist (fresh install) — nothing to drop.
    }
  }

  // Existing print jobs belong to the workspace of the batch they printed.
  // Backfill so tenant-scoped print-job queries keep returning the old stock.
  await ctx.collection('qr_print_jobs').aggregate([
    { $lookup: { from: 'qr_labels', localField: '_id', foreignField: 'print_job_id', as: 'labels' } },
    { $match: { 'labels.0': { $exists: true } } },
    { $lookup: { from: 'batches', localField: 'labels.batch_id', foreignField: '_id', as: 'batches' } },
    { $match: { 'batches.0': { $exists: true } } },
    { $set: { tenant_id: { $ifNull: [{ $first: '$batches.tenant_id' }, '$tenant_id'] } } },
    { $merge: { into: 'qr_print_jobs', whenMatched: 'replace', whenNotMatched: 'discard' } },
  ]).toArray();

  // Existing batches whose labels were already printed count as printed, so
  // current stock stays orderable after the print gate was introduced.
  await ctx.collection('batches').aggregate([
    { $lookup: { from: 'qr_labels', localField: '_id', foreignField: 'batch_id', as: 'labels' } },
    { $match: { 'labels.0': { $exists: true }, qr_printed_at: { $exists: false } } },
    { $set: { qr_printed_at: { $max: '$labels.last_printed_at' } } },
    { $unset: 'labels' },
    { $merge: { into: 'batches', whenMatched: 'replace', whenNotMatched: 'discard' } },
  ]).toArray();
  for (const collection of ['grades', 'bag_quantities', 'vendors', 'shelf_locations', 'products']) {
    await ctx.updateMany(
      collection,
      {
        $or: [
          { is_active: { $exists: false } },
          { is_active: null },
          { is_active: true },
          { is_active: '1' },
          { is_active: 'true' },
        ],
      },
      { $set: { is_active: 1 } }
    );
    await ctx.updateMany(collection, { is_active: { $in: [false, '0', 'false'] } }, { $set: { is_active: 0 } });
  }
  const selfVendor = await ctx.findOne('vendors', { vendor_code: 'SELF' }, { projection: { _id: 0, id: 1 } });
  if (selfVendor) {
    await ctx.updateOne('vendors', { id: selfVendor.id }, {
      $set: { name: 'Self', category: 'Internal', is_active: 1 },
    });
  } else {
    try {
      await ctx.insert('vendors', {
        vendor_code: 'SELF',
        name: 'Self',
        category: 'Internal',
        is_active: 1,
      });
    } catch (error) {
      if (!isDuplicateKey(error)) throw error;
      await ctx.updateOne('vendors', { vendor_code: 'SELF' }, {
        $set: { name: 'Self', category: 'Internal', is_active: 1 },
      });
    }
  }
  const products = await ctx.find(
    'products',
    { grade: { $type: 'string', $ne: '' } },
    { projection: { grade: 1, tenant_id: 1 } }
  );
  // Keyed by tenant + grade so each workspace gets its own master rows.
  const legacyGrades = new Map<string, { name: string; tenant_id: unknown }>();
  const existingGrades = await ctx.find('grades', {}, { projection: { name: 1, tenant_id: 1 } });
  const knownGrades = new Set(
    existingGrades
      .map((grade) => `${grade.tenant_id ?? ''}:${typeof grade.name === 'string' ? grade.name.trim().toLocaleLowerCase() : ''}`)
      .filter((key) => key !== ':')
  );
  for (const product of products) {
    const grade = typeof product.grade === 'string' ? product.grade.trim() : '';
    const key = `${product.tenant_id ?? ''}:${grade.toLocaleLowerCase()}`;
    if (grade && !knownGrades.has(key)) legacyGrades.set(key, { name: grade, tenant_id: product.tenant_id ?? null });
  }
  for (const { name: grade, tenant_id } of legacyGrades.values()) {
    try {
      await ctx.updateOne(
        'grades',
        { name: grade, tenant_id },
        { $setOnInsert: { name: grade, tenant_id, is_active: 1 } },
        { upsert: true }
      );
    } catch (error) {
      if (!isDuplicateKey(error)) throw error;
    }
  }

  // Human-readable order numbers for dispatch orders (DO-<YYYY>-<n>),
  // allocated per tenant + year in the counters collection.
  await backfillDispatchOrderNumbers(ctx);
}

/** Number dispatch orders created before order_number existed, oldest first. */
async function backfillDispatchOrderNumbers(ctx: DbContext): Promise<void> {
  const missing = await ctx.find(
    'dispatch_orders',
    { order_number: { $exists: false } },
    { sort: { created_at: 1 }, projection: { _id: 0, id: 1, tenant_id: 1, created_at: 1 } }
  );
  if (missing.length === 0) return;
  for (const order of missing) {
    const year = new Date(order.created_at ?? Date.now()).getUTCFullYear();
    const seq = await nextDispatchOrderNumber(ctx, String(order.tenant_id ?? ''));
    await ctx.updateOne('dispatch_orders', { id: order.id }, { $set: { order_number: seq } });
  }
}
