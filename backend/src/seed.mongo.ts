import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { getContext } from './config/database.mongo';
import { ensureAdminSchema } from './config/schema.mongo';

/**
 * Collections wiped by the demo seed. The list mirrors the MySQL seed plus the
 * child tables that MySQL removes through ON DELETE CASCADE. Device and token
 * collections are cleared because the referenced demo users are recreated.
 */
const SEED_COLLECTIONS = [
  'activity_logs',
  'loading_scan_events',
  'loading_sessions',
  'dispatch_records',
  'qc_records',
  'dispatch_orders',
  'packing_list_items',
  'fix_records',
  'qr_labels',
  'qr_print_jobs',
  'batch_groups',
  'batches',
  'products',
  'admins',
  'qc_users',
  'dispatch_users',
  'devices',
  'device_sync_state',
  'sync_operations',
  'refresh_tokens',
  'shelf_locations',
  'clients',
  'vendors',
  'bag_quantities',
  'grades',
  'uoms',
  'qr_reprint_requests',
  'storage_racks',
  'warehouses',
  'counters',
  'divisions',
  'tenants',
];

export async function seed(): Promise<void> {
  await ensureAdminSchema();
  const ctx = await getContext();

  for (const name of SEED_COLLECTIONS) {
    await ctx.deleteMany(name, {});
  }

  // Seed the demo workspace tenant and link the three role accounts to it.
  const tenantId = await ctx.insert('tenants', {
    name: 'Aceone Inventory',
    email: 'admin@gmail.com',
    email_key: '__admin_gmail_com__',
    phone: '9000000001',
    slug: 'aceone-inventory',
    printer_label_width_mm: 60,
    printer_label_height_mm: 64,
    is_active: 1,
  });

  const adminHash = await bcrypt.hash('admin@123', 10);
  const qcHash = await bcrypt.hash('qc@123', 10);
  const dispatchHash = await bcrypt.hash('dispatch@123', 10);

  await ctx.insert('admins', { name: 'Admin', email: 'admin@gmail.com', password_hash: adminHash, is_active: 1, tenant_id: tenantId });
  await ctx.insert('qc_users', { name: 'QC Tester', email: 'qc@gmail.com', password_hash: qcHash, is_active: 1, tenant_id: tenantId });
  await ctx.insert('dispatch_users', {
    name: 'Dispatcher',
    email: 'dispatch@gmail.com',
    password_hash: dispatchHash,
    is_active: 1,
    tenant_id: tenantId,
  });

  // Mirror the MySQL seed: internal 'Self' vendor owned by the demo tenant.
  await ctx.insert('vendors', { vendor_code: 'SELF', name: 'Self', category: 'Internal', is_active: 1, tenant_id: tenantId });

  console.log('Seed completed!');
  console.log('Admin:    admin@gmail.com / admin@123');
  console.log('QC:       qc@gmail.com / qc@123');
  console.log('Dispatch: dispatch@gmail.com / dispatch@123');
}

seed()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Seed failed:', err);
    process.exit(1);
  });
