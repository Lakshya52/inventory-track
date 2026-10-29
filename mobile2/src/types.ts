export type Role = 'admin' | 'qc' | 'dispatch';

export type AppUser = {
  role: Role;
  name: string;
  email: string;
  phone: string;
  company: string;
  initials: string;
};

export type ReportScope = 'admin' | 'qc' | 'dispatch';

export type ReportKind = 'quality' | 'dispatch';

export type ReportPeriod = 'Monthly' | 'Weekly' | 'Yearly' | 'Custom';

export type BatchActivity = {
  id: string;
  batch: string;
  markedBy: string;
  email: string;
  product: string;
  sku: string;
  quantity: number;
  date: string;
  status: 'passed' | 'failed';
};

export type DispatchOrderStatus =
  | 'PENDING'
  | 'APPROVED'
  | 'REJECTED'
  | 'CLOSED_DISPATCHED'
  | 'CLOSED_NOT_DISPATCHED';

export type DispatchOrder = {
  id: string;
  batch_id?: string;
  batch_number?: string | null;
  barcode_value?: string | null;
  product_name?: string | null;
  product_sku?: string | null;
  client_id?: string | null;
  client_name?: string | null;
  driver_name?: string | null;
  vehicle_number?: string | null;
  container_number?: string | null;
  quantity?: number | null;
  uom?: string | null;
  storage_location?: string | null;
  vendor_name?: string | null;
  grade_name?: string | null;
  bag_quantity?: number | null;
  bag_quantity_unit?: string | null;
  status: DispatchOrderStatus | string;
  outcome?: 'DISPATCHED' | 'NOT_DISPATCHED' | null;
  seal_number?: string | null;
  remarks?: string | null;
  admin_remarks?: string | null;
  dispatched_at?: string | null;
  approved_at?: string | null;
  approver_name?: string | null;
  raised_by_name?: string | null;
  created_at?: string;
  // Legacy / UI compatibility fields
  order?: string;
  raisedOn?: string;
  customer?: string;
  items?: string;
  product?: string;
  driver?: string;
};

export type DispatchBatch = {
  id: string;
  batch_number: string;
  barcode_value: string;
  product_id: string;
  product_name?: string | null;
  product_sku?: string | null;
  quantity: number;
  uom?: string | null;
  shelf_location_id?: string | null;
  location_code?: string | null;
  storage_location?: string | null;
  vendor_name?: string | null;
  grade_name?: string | null;
  bag_quantity_name?: string | null;
  bag_quantity?: number | null;
  bag_quantity_unit?: string | null;
  status: 'QC_PASSED' | 'DISPATCH_ORDER_RAISED' | 'DISPATCH_APPROVED' | 'LOADING' | 'DISPATCHED' | 'NOT_DISPATCHED' | string;
  created_at: string;
};

export type ScanResult = 'OK' | 'DUPLICATE' | 'WRONG_BATCH' | 'QTY_EXCEEDED';

export type LoadingSession = {
  id: string;
  session_id?: string;
  order_id?: string;
  dispatch_order_id: string;
  batch_id: string;
  batch_number?: string | null;
  product_name?: string | null;
  loader_name?: string | null;
  status: 'ACTIVE' | 'CLOSED' | string;
  total: number;
  scanned: number;
  progress?: number;
  seal_number?: string | null;
  outcome?: 'DISPATCHED' | 'NOT_DISPATCHED' | null;
  remarks?: string | null;
  started_at?: string | null;
  completed_at?: string | null;
  updated_at?: string | null;
  last_event?: {
    result: ScanResult;
    qr_value: string;
    scanned_at: string;
  } | null;
};

export type LoadingScanEvent = {
  id?: string;
  event_id?: string;
  session_id: string;
  qr_value: string;
  batch_id?: string | null;
  result: ScanResult;
  scanned_at: string;
  duplicate?: boolean;
};

export type PackingListItem = {
  id?: string;
  product_name?: string | null;
  sku?: string | null;
  batch_number?: string | null;
  barcode?: string | null;
  quantity?: number | null;
  uom?: string | null;
  grade?: string | null;
  bag_quantity?: number | null;
  bag_quantity_unit?: string | null;
  location?: string | null;
  location_code?: string | null;
  location_description?: string | null;
};

export type PackingListData = {
  order_id: string;
  status: string;
  batch_number?: string | null;
  barcode?: string | null;
  client_name?: string | null;
  driver_name?: string | null;
  vehicle_number?: string | null;
  container_number?: string | null;
  seal_number?: string | null;
  remarks?: string | null;
  items: PackingListItem[];
  generated_at?: string;
};

export type ManagedEntity = {
  id: string;
  title: string;
  subtitle: string;
  meta?: string;
};
