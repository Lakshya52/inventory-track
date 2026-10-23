export type Role = 'ADMIN' | 'QC' | 'DISPATCH' | 'PRODUCTION';

export type BatchStatus = 'CREATED' | 'QC_PASSED' | 'QC_FAILED'
  | 'DISPATCH_ORDER_RAISED' | 'DISPATCH_APPROVED' | 'DISPATCH_REJECTED' | 'DISPATCHED';

export type DispatchOrderStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export interface User {
  id: number;
  name: string;
  email: string;
  role: Role;
  is_active?: number;
  created_at?: string;
}

export interface Product {
  id: number;
  name: string;
  description: string | null;
  sku: string;
  price: number;
  quantity: number;
  cas_number: string | null;
  molecular_formula: string | null;
  purity: string | null;
  grade: string | null;
  storage_conditions: string | null;
  hazard_classification: string | null;
  physical_state: string | null;
  hsn_code: string | null;
  manufacturer: string | null;
  created_at: string;
}

export interface Batch {
  id: number;
  product_id: number;
  batch_number: string;
  quantity: number;
  uom: string | null;
  unit_price: number;
  manufacturing_date: string | null;
  expiry_date: string | null;
  storage_location: string | null;
  notes: string | null;
  status: BatchStatus;
  barcode_value: string;
  created_at: string;
  product_name?: string;
  product_sku?: string;
  product_description?: string | null;
}

export interface ActivityLog {
  id: number;
  user_id: number | null;
  user_name: string | null;
  user_role: string | null;
  action: string;
  description: string | null;
  created_at: string;
}

export interface DashboardStats {
  totalProducts: number;
  totalBatches: number;
  pendingQc: number;
  qcPassed: number;
  qcFailed: number;
  dispatchedToday: number;
  currentInventory: number;
  inventoryValue: number;
  pendingDispatchOrders: number;
  activeClients: number;
  totalLocations: number;
  productionStats: { in_production: number; needs_fix: number };
  dispatchQueueStats: { awaiting_approval: number; approved_ready: number };
  recentActivity: ActivityLog[];
  recentBatches: Batch[];
}

export interface QcRecord {
  id: number;
  batch_id: number;
  tester_id: number;
  result: 'PASS' | 'FAIL';
  remarks: string | null;
  created_at: string;
}

export interface DispatchRecord {
  id: number;
  batch_id: number;
  dispatcher_id: number;
  remarks: string | null;
  created_at: string;
}

export interface DispatchOrder {
  id: number;
  batch_id: number;
  raised_by: number;
  status: DispatchOrderStatus;
  admin_id: number | null;
  admin_remarks: string | null;
  created_at: string;
  updated_at: string;
  batch_number?: string;
  product_name?: string;
  product_sku?: string;
  raised_by_name?: string;
  admin_name?: string;
}

export interface Vendor {
  id: number;
  vendor_code: string;
  name: string;
  contact_person: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  gst_number: string | null;
  category: string | null;
  payment_terms: string | null;
  notes: string | null;
  is_active: number;
  created_at: string;
}

export interface AdminStats {
  totalProducts: number;
  inventoryQty: number;
  inventoryValue: number;
  totalBatches: number;
  pendingQc: number;
  qcTotal: number;
  qcPassed: number;
  qcFailed: number;
  qcPassRate: number;
  dispatchTotal: number;
  dispatchedToday: number;
  totalRequests: number;
  pendingRequests: number;
  approvedRequests: number;
  rejectedRequests: number;
  totalVendors: number;
  activeVendors: number;
  totalLocations: number;
  activeLocations: number;
  totalUsers: number;
  activeUsers: number;
}

export interface ShelfLocation {
  id: number;
  location_code: string;
  description: string | null;
  warehouse: string | null;
  rack: string | null;
  shelf: string | null;
  is_active: number;
  created_at: string;
}

export interface Client {
  id: number;
  name: string;
  contact_person: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  gst_number: string | null;
  is_active: number;
  created_at: string;
}

export interface PackingListItem {
  id: number;
  dispatch_order_id: number;
  batch_id: number;
  product_name: string | null;
  batch_number: string | null;
  quantity: number | null;
  uom: string | null;
  location_code: string | null;
  location_description: string | null;
  created_at: string;
}

export interface FixRecord {
  id: number;
  batch_id: number;
  fixed_by: number;
  description: string | null;
  created_at: string;
  batch_number?: string;
  product_name?: string;
  fixed_by_name?: string;
}
