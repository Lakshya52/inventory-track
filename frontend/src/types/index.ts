export type Role = 'ADMIN' | 'QC' | 'DISPATCH';

export type BatchStatus = 'QC_PASSED' | 'DISPATCH_ORDER_RAISED' | 'DISPATCH_APPROVED'
  | 'LOADING' | 'DISPATCHED' | 'NOT_DISPATCHED';

export type DispatchOrderStatus = 'PENDING' | 'APPROVED' | 'REJECTED'
  | 'CLOSED_DISPATCHED' | 'CLOSED_NOT_DISPATCHED';

export type LoadingScanResult = 'OK' | 'DUPLICATE' | 'WRONG_BATCH' | 'QTY_EXCEEDED';
export type DispatchOutcome = 'DISPATCHED' | 'NOT_DISPATCHED';

export interface LoadingSession {
  id: EntityId;
  dispatch_order_id: EntityId;
  batch_id: EntityId;
  loader_id: EntityId;
  loader_name?: string | null;
  status: 'ACTIVE' | 'CLOSED';
  total: number;
  scanned: number;
  seal_number: string | null;
  outcome: DispatchOutcome | null;
  remarks: string | null;
  started_at: string;
  completed_at: string | null;
  updated_at: string;
  order_id?: EntityId;
  batch_number?: string | null;
  product_name?: string | null;
  last_event?: {
    result: LoadingScanResult;
    qr_value: string;
    scanned_at: string;
  } | null;
}

export interface LoadingScanEvent {
  id: EntityId;
  session_id: EntityId;
  qr_value: string;
  batch_id: EntityId | null;
  result: LoadingScanResult;
  scanned_by: EntityId;
  scanned_at: string;
}

/** IDs are numeric on MySQL and strings (Mongo ObjectIds) on MongoDB. */
export type EntityId = string | number;

export interface User {
  id: EntityId;
  name: string;
  email: string;
  role: Role;
  is_active?: number;
  created_at?: string;
}

export interface Product {
  id: EntityId;
  name: string;
  description: string | null;
  sku: string;
  price: number;
  quantity: number;
  cas_number: string | null;
  molecular_formula: string | null;
  purity: string | null;
  grade: string | null;
  bag_quantity_id?: EntityId | null;
  storage_conditions: string | null;
  hazard_classification: string | null;
  physical_state: string | null;
  hsn_code: string | null;
  manufacturer: string | null;
  created_at: string;
}

export interface Batch {
  id: EntityId;
  product_id: EntityId;
  batch_number: string;
  batch_group_id?: string | null;
  quantity: number;
  uom: string | null;
  unit_price: number;
  manufacturing_date: string | null;
  expiry_date: string | null;
  storage_location: string | null;
  shelf_location_id?: EntityId | null;
  location_code?: string | null;
  qr_count?: number;
  qr_job_id?: EntityId | null;
  notes: string | null;
  status: BatchStatus;
  barcode_value: string;
  created_at: string;
  product_name?: string;
  product_sku?: string;
  product_grade?: string | null;
  product_description?: string | null;
  vendor_id?: EntityId | null;
  vendor_name?: string | null;
  grade_id?: EntityId | null;
  grade_name?: string | null;
  bag_quantity_id?: EntityId | null;
  bag_quantity?: number | null;
  bag_quantity_unit?: string | null;
  fg_details_completed_at?: string | null;
}

export interface ActivityLog {
  id: EntityId;
  user_id: EntityId | null;
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
  id: EntityId;
  batch_id: EntityId;
  tester_id: EntityId;
  result: 'PASS';
  method?: 'AUTO_PASS' | string;
  remarks: string | null;
  created_at: string;
}

export interface DispatchRecord {
  id: EntityId;
  batch_id: EntityId;
  dispatcher_id: EntityId;
  remarks: string | null;
  created_at: string;
}

export interface DispatchOrder {
  id: EntityId;
  batch_id: EntityId;
  raised_by: EntityId;
  status: DispatchOrderStatus;
  admin_id: EntityId | null;
  admin_remarks: string | null;
  approved_by_id?: EntityId | null;
  approved_by_role?: string | null;
  approved_at?: string | null;
  seal_number?: string | null;
  dispatched_at?: string | null;
  client_id: EntityId;
  driver_name: string;
  vehicle_number: string;
  container_number?: string | null;
  created_at: string;
  updated_at: string;
  batch_number?: string;
  product_name?: string;
  product_sku?: string;
  raised_by_name?: string;
  admin_name?: string;
  approver_name?: string;
  client_name?: string;
  batch_status?: BatchStatus;
}

export interface Vendor {
  id: EntityId;
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
  totalLocations: number;
  activeLocations: number;
  totalUsers: number;
  activeUsers: number;
}

export interface ShelfLocation {
  id: EntityId;
  location_code: string;
  description: string | null;
  warehouse: string | null;
  rack: string | null;
  shelf: string | null;
  is_active: number;
  created_at: string;
}

export interface Client {
  id: EntityId;
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
  id: EntityId;
  dispatch_order_id: EntityId;
  batch_id: EntityId;
  product_name: string | null;
  batch_number: string | null;
  quantity: number | null;
  uom: string | null;
  location_code: string | null;
  location_description: string | null;
  created_at: string;
}

export interface FixRecord {
  id: EntityId;
  batch_id: EntityId;
  fixed_by: EntityId;
  description: string | null;
  created_at: string;
  batch_number?: string;
  product_name?: string;
  fixed_by_name?: string;
}
