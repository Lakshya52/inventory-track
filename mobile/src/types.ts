export type Role = 'ADMIN' | 'QC' | 'DISPATCH';

export interface User {
  id: number;
  name: string;
  email: string;
  role: Role;
}

export interface MobileProduct {
  id: number;
  name: string;
  sku: string;
  price?: number;
  quantity?: number;
  cas_number?: string | null;
  molecular_formula?: string | null;
  grade?: string | null;
}

export interface MobileVendor {
  id: number;
  name: string;
  vendor_code?: string;
  is_active?: number | boolean;
}

export interface MobileMasterOption {
  id: number;
  name?: string;
  quantity?: number;
  unit?: string;
  is_active?: number | boolean;
}

export interface MobileShelfLocation {
  id: number;
  location_code: string;
  is_active?: number | boolean;
}

export interface QrLabel {
  id: number;
  qr_value: string;
  serial_no: number;
  batch_number?: string;
  print_count?: number;
}

export interface QrPrintJob {
  id: number;
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
  id: number;
  batch_number: string;
  barcode_value: string;
  qr_job: QrPrintJob;
  labels: QrLabel[];
}

export interface CreateBatchesResponse {
  id: number;
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
  id: number;
  product_id: number;
  batch_number: string;
  quantity: number;
  uom: string | null;
  storage_location: string | null;
  shelf_location_id?: number | null;
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
  qr_job_id?: number | null;
  vendor_id?: number | null;
  vendor_name?: string | null;
  grade_id?: number | null;
  grade_name?: string | null;
  bag_quantity_id?: number | null;
  bag_quantity?: number | null;
  bag_quantity_unit?: string | null;
  fg_details_completed_at?: string | null;
  cas_number?: string | null;
  molecular_formula?: string | null;
  product_grade?: string | null;
  product_purity?: string | null;
  hazard_classification?: string | null;
  storage_conditions?: string | null;
  age_minutes?: number;
  local_pending?: number;
}

export interface QcRecord {
  id: number;
  batch_id: number;
  tester_id: number;
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
  id: number;
  batch_id: number;
  raised_by: number;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  admin_id: number | null;
  admin_remarks: string | null;
  client_id?: number | null;
  driver_name?: string | null;
  vehicle_number?: string | null;
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
  id: number;
  batch_id: number;
  dispatcher_id: number;
  remarks: string | null;
  images: string | null;
  created_at: string;
  dispatch_order_id: number | null;
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
  entity_id: number | null;
}

export interface SyncResult {
  operation_id: string;
  status: 'APPLIED' | 'DUPLICATE' | 'CONFLICT' | 'FAILED';
  entity_type: string | null;
  entity_id: number | null;
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
