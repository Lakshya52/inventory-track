export type Role = 'ADMIN' | 'QC' | 'DISPATCH';

/** SQL databases may return numeric IDs; MongoDB returns ObjectId strings. */
export type EntityId = string | number;

export interface User {
  id: EntityId;
  name: string;
  email: string;
  role: Role;
}

export interface MobileProduct {
  id: EntityId;
  name: string;
  sku: string;
  price?: number;
  quantity?: number;
  cas_number?: string | null;
  molecular_formula?: string | null;
  grade?: string | null;
}

export interface MobileVendor {
  id: EntityId;
  name: string;
  vendor_code?: string;
  is_active?: number | boolean;
}

export interface MobileMasterOption {
  id: EntityId;
  name?: string;
  quantity?: number;
  unit?: string;
  is_active?: number | boolean;
}

export interface MobileShelfLocation {
  id: EntityId;
  location_code: string;
  is_active?: number | boolean;
}

export interface QrLabel {
  id: EntityId;
  qr_value: string;
  serial_no: number;
  batch_number?: string;
  print_count?: number;
}

export interface QrPrintJob {
  id: EntityId;
  job_code: string;
  product_name: string;
  product_sku: string;
  quantity: number;
}

export interface QrJobDetails {
  job: QrPrintJob;
  labels: QrLabel[];
}

export interface CreatedBatch {
  id: EntityId;
  batch_number: string;
  barcode_value: string;
  qr_job: QrPrintJob;
  labels: QrLabel[];
}

export interface CreateBatchesResponse {
  id: EntityId;
  barcode_value: string;
  batch_group_id: string;
  batch_count: number;
  batches: CreatedBatch[];
  product_name: string;
  product_sku: string;
  message: string;
}

export interface AuthSession {
  token: string;
  refreshToken: string;
  refreshExpiresAt?: string;
  user: User;
}

export interface Batch {
  id: EntityId;
  product_id: EntityId;
  batch_number: string;
  quantity: number;
  uom: string | null;
  storage_location: string | null;
  shelf_location_id?: EntityId | null;
  location_code?: string | null;
  unit_qr_codes?: string | string[] | null;
  qr_count?: number;
  status: string;
  barcode_value: string;
  created_at: string;
  updated_at: string;
  product_name: string;
  product_sku: string;
  batch_group_id?: string | null;
  unit_price?: number;
  manufacturing_date?: string | null;
  expiry_date?: string | null;
  notes?: string | null;
  qr_job_id?: EntityId | null;
  vendor_id?: EntityId | null;
  vendor_name?: string | null;
  grade_id?: EntityId | null;
  grade_name?: string | null;
  bag_quantity_id?: EntityId | null;
  bag_quantity?: number | null;
  bag_quantity_unit?: string | null;
  fg_details_completed_at?: string | null;
  cas_number?: string | null;
  molecular_formula?: string | null;
  product_grade?: string | null;
  product_purity?: string | null;
  product_description?: string | null;
  product_physical_state?: string | null;
  product_storage_conditions?: string | null;
  hsn_code?: string | null;
  manufacturer?: string | null;
  scanned_qr?: string | null;
  matched_by_batch_number?: boolean;
  hazard_classification?: string | null;
  storage_conditions?: string | null;
  age_minutes?: number;
  local_pending?: number;
}

export interface QcRecord {
  id: EntityId;
  batch_id: EntityId;
  tester_id: EntityId;
  result: 'PASS' | 'FAIL';
  remarks: string | null;
  images: string | null;
  created_at: string;
  batch_number: string;
  product_name: string;
  product_sku: string;
  tester_name?: string | null;
}

export interface DispatchOrder {
  id: EntityId;
  batch_id: EntityId;
  raised_by: EntityId;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  admin_id: EntityId | null;
  admin_remarks: string | null;
  client_id?: EntityId | null;
  driver_name?: string | null;
  vehicle_number?: string | null;
  container_number?: string | null;
  client_name?: string | null;
  created_at: string;
  updated_at: string;
  dispatched_at: string | null;
  batch_number: string;
  barcode_value: string;
  product_name: string;
  product_sku: string;
  quantity: number;
  uom: string | null;
  local_pending?: number;
  client_operation_id?: string | null;
}

export interface DispatchRecord {
  id: EntityId;
  batch_id: EntityId;
  dispatcher_id: EntityId;
  remarks: string | null;
  images: string | null;
  created_at: string;
  dispatch_order_id: EntityId | null;
  batch_number: string;
  product_name: string;
  product_sku: string;
}

export type OperationType =
  | 'QC_SUBMIT'
  | 'QC_SUBMIT_BULK'
  | 'DISPATCH_ORDER_RAISE'
  | 'DISPATCH_CONFIRM'
  | 'DISPATCH_CONFIRM_BULK';

export interface OutboxOperation {
  operation_id: string;
  type: OperationType;
  payload: Record<string, any>;
  client_timestamp: string;
  status: 'PENDING' | 'FAILED' | 'CONFLICT' | 'APPLIED';
  attempts: number;
  last_error: string | null;
  created_at: string;
  next_attempt_at: string | null;
  entity_type: string | null;
  entity_id: EntityId | null;
}

export interface SyncResult {
  operation_id: string;
  status: 'APPLIED' | 'DUPLICATE' | 'CONFLICT' | 'FAILED';
  entity_type: string | null;
  entity_id: EntityId | null;
  data?: Record<string, any> | null;
  error?: string | null;
  error_code?: string | null;
}

export interface SyncPushResponse {
  results: SyncResult[];
  applied: number;
  duplicates: number;
  conflicts: number;
  failed: number;
  server_time: string;
}

export interface SyncPullResponse {
  server_time: string;
  cursor: number;
  since: number;
  has_more: boolean;
  role: Role;
  products: any[];
  shelf_locations: any[];
  clients: any[];
  batches: Batch[];
  qc_records: QcRecord[];
  dispatch_orders: DispatchOrder[];
  dispatch_records: DispatchRecord[];
  work_queue: Batch[];
  my_orders: DispatchOrder[];
  counts: {
    pending_qc: number;
    ready_to_dispatch: number;
    pending_orders: number;
    my_tests_today: number;
    my_dispatches_today: number;
  };
}
