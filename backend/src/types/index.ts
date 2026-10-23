export type Role = 'ADMIN' | 'QC' | 'DISPATCH' | 'PRODUCTION';

export type BatchStatus = 'CREATED' | 'QC_PASSED' | 'QC_FAILED'
  | 'DISPATCH_ORDER_RAISED' | 'DISPATCH_APPROVED' | 'DISPATCH_REJECTED' | 'DISPATCHED';

export type DispatchOrderStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

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

export interface JwtPayload {
  userId: number;
  role: Role;
  name: string;
  email: string;
  table: 'admins' | 'qc_users' | 'dispatch_users' | 'production_users';
}

export type SyncOperationType =
  | 'QC_SUBMIT'
  | 'QC_SUBMIT_BULK'
  | 'DISPATCH_ORDER_RAISE'
  | 'DISPATCH_CONFIRM'
  | 'DISPATCH_CONFIRM_BULK'
  | 'PRODUCTION_FIX';

export type SyncOperationStatus = 'APPLIED' | 'DUPLICATE' | 'CONFLICT' | 'FAILED';

export interface SyncOperationInput {
  operation_id: string;
  type: SyncOperationType;
  payload: Record<string, any>;
  client_timestamp?: string;
}

export interface SyncOperationResult {
  operation_id: string;
  status: SyncOperationStatus;
  entity_type: string | null;
  entity_id: number | null;
  data?: Record<string, any> | null;
  error?: string | null;
  error_code?: string | null;
  /** Internal ownership fields, used to stop cross-user idempotency reuse. */
  user_id?: number;
  user_role?: string;
}

export interface DeviceRegistration {
  device_uuid: string;
  platform: string;
  app_version?: string;
  push_token?: string;
}

export interface RefreshTokenRecord {
  id: number;
  token_hash: string;
  user_id: number;
  user_role: Role;
  user_table: JwtPayload['table'];
  device_uuid: string | null;
  expires_at: string;
  revoked_at: string | null;
}

export interface BatchWithProduct extends Batch {
  product_name: string;
  product_sku: string;
  product_description: string | null;
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
}
