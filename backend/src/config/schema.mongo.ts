import { getContext, DbContext, isDuplicateKey } from './database';

async function ensureIndexes(ctx: DbContext): Promise<void> {
  const unique = { unique: true } as const;
  const sparseUnique = { unique: true, partialFilterExpression: { client_operation_id: { $type: 'string' } } } as const;

  await Promise.all([
    ctx.collection('admins').createIndex({ email: 1 }, unique),
    ctx.collection('qc_users').createIndex({ email: 1 }, unique),
    ctx.collection('dispatch_users').createIndex({ email: 1 }, unique),

    ctx.collection('products').createIndex({ sku: 1 }, unique),
    ctx.collection('products').createIndex({ updated_at: 1 }),
    ctx.collection('products').createIndex({ name: 1 }),

    ctx.collection('shelf_locations').createIndex({ location_code: 1 }, unique),
    ctx.collection('shelf_locations').createIndex({ updated_at: 1 }),

    ctx.collection('clients').createIndex({ is_active: 1, name: 1 }),
    ctx.collection('clients').createIndex({ updated_at: 1 }),

    ctx.collection('vendors').createIndex({ vendor_code: 1 }, unique),
    ctx.collection('vendors').createIndex({ name: 1 }),
    ctx.collection('vendors').createIndex({ is_active: 1 }),
    ctx.collection('grades').createIndex({ name: 1 }, unique),
    ctx.collection('grades').createIndex({ is_active: 1 }),
    ctx.collection('bag_quantities').createIndex({ name: 1 }, unique),
    ctx.collection('bag_quantities').createIndex({ is_active: 1 }),

    ctx.collection('batches').createIndex({ barcode_value: 1 }, unique),
    ctx.collection('batches').createIndex({ batch_number: 1 }),
    ctx.collection('batches').createIndex({ product_id: 1, created_at: -1 }),
    ctx.collection('batches').createIndex({ batch_group_id: 1 }),
    ctx.collection('batches').createIndex({ status: 1, updated_at: 1 }),
    ctx.collection('batches').createIndex({ updated_at: 1 }),
    ctx.collection('batches').createIndex({ shelf_location_id: 1 }),

    ctx.collection('qr_print_jobs').createIndex({ job_code: 1 }, unique),
    ctx.collection('qr_print_jobs').createIndex({ product_id: 1, created_at: -1 }),
    ctx.collection('qr_print_jobs').createIndex({ created_at: -1 }),

    ctx.collection('qr_labels').createIndex({ qr_value: 1 }, unique),
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

    ctx.collection('dispatch_records').createIndex({ client_operation_id: 1 }, sparseUnique),
    ctx.collection('dispatch_records').createIndex({ dispatcher_id: 1, created_at: -1 }),
    ctx.collection('dispatch_records').createIndex({ batch_id: 1, created_at: -1 }),
    ctx.collection('dispatch_records').createIndex({ created_at: -1 }),
    ctx.collection('dispatch_records').createIndex({ dispatch_order_id: 1 }),
    ctx.collection('dispatch_records').createIndex({ group_operation_id: 1 }),

    ctx.collection('fix_records').createIndex({ batch_id: 1 }),
    ctx.collection('fix_records').createIndex({ created_at: -1 }),

    ctx.collection('packing_list_items').createIndex({ dispatch_order_id: 1 }),
    ctx.collection('packing_list_items').createIndex({ batch_id: 1 }),

    ctx.collection('activity_logs').createIndex({ created_at: -1 }),
    ctx.collection('activity_logs').createIndex({ user_role: 1, user_id: 1, created_at: -1 }),

    ctx.collection('devices').createIndex({ device_uuid: 1 }, unique),
    ctx.collection('devices').createIndex({ user_role: 1, user_id: 1 }),
    ctx.collection('devices').createIndex({ last_seen_at: 1 }),

    ctx.collection('device_sync_state').createIndex({ device_uuid: 1 }, unique),

    ctx.collection('sync_operations').createIndex({ operation_id: 1 }, unique),
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
  for (const collection of ['grades', 'bag_quantities', 'vendors', 'shelf_locations']) {
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
    { projection: { grade: 1 } }
  );
  const legacyGrades = new Map<string, string>();
  const existingGrades = await ctx.find('grades', {}, { projection: { name: 1 } });
  const knownGrades = new Set(
    existingGrades
      .map((grade) => typeof grade.name === 'string' ? grade.name.trim().toLocaleLowerCase() : '')
      .filter(Boolean)
  );
  for (const product of products) {
    const grade = typeof product.grade === 'string' ? product.grade.trim() : '';
    const key = grade.toLocaleLowerCase();
    if (grade && !knownGrades.has(key)) legacyGrades.set(key, grade);
  }
  for (const grade of legacyGrades.values()) {
    try {
      await ctx.updateOne(
        'grades',
        { name: grade },
        { $setOnInsert: { name: grade, is_active: 1 } },
        { upsert: true }
      );
    } catch (error) {
      if (!isDuplicateKey(error)) throw error;
    }
  }
}
