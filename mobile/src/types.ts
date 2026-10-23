export type Role = 'ADMIN' | 'QC' | 'DISPATCH' | 'PRODUCTION';

export interface User {
  id: number;
  name: string;
  email: string;
  role: Role;
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
  status: string;
  barcode_value: string;
  created_at: string;
  updated_at: string;
  product_name: string;
  product_sku: string;
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
  | 'DISPATCH_CONFIRM_BULK'
  | 'PRODUCTION_FIX';

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
