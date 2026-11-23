export interface Product {
  id: string | number;
  name: string;
  sku: string;
  grade?: string;
  quantity?: number;
  description?: string;
  bag_quantity_id?: number | null;
  storage_conditions?: string;
  [key: string]: unknown;
}

export interface ShelfLocation {
  id: string | number;
  location_code: string;
  description?: string;
  warehouse?: string;
  rack?: string;
  shelf?: string;
  is_active?: number;
}

export interface Warehouse {
  id: string | number;
  name: string;
  racks?: Array<{
    cells?: Array<{ shelf_location_id?: number; location_code?: string }>;
  }>;
}

export interface Client {
  id: string | number;
  name: string;
  contact_person?: string;
  phone?: string;
  email?: string;
  [key: string]: unknown;
}

export interface BatchGroupItem {
  product_id: string | number;
  quantity: number;
  package_quantity: number;
  uom: string;
  shelf_location_id: string | number;
  warehouse_id: string | number;
  avg_standard_quantity?: number;
  manufacturing_date: string;
  expiry_date: string;
}

export interface CreatedBatch {
  batch_id: string | number;
  batch_number: string;
  product_name: string;
  product_sku: string;
  quantity: number;
  labels?: QrLabel[];
  [key: string]: unknown;
}

export interface CreateBatchResponse {
  id: string;
  batch_group_id: string;
  batch_number: string;
  product_count: number;
  total_quantity: number;
  batches: CreatedBatch[];
  labels: QrLabel[];
  status: string;
  message: string;
  duplicate?: boolean;
}

export interface BatchGroup {
  group_key: string;
  batch_number: string;
  product_count: number;
  total_quantity: number;
  status: string;
  created_at: string;
  batches?: Array<Record<string, unknown>>;
  [key: string]: unknown;
}

export interface QrLabel {
  id: string | number;
  qr_value: string;
  serial_no: number;
  print_count: number;
  last_printed_at?: string | null;
  batch_number?: string;
  child_batch_number?: string;
  status?: string;
  product_name?: string;
  product_sku?: string;
  quantity?: number;
  package_quantity?: number;
  uom?: string;
  storage_location?: string;
  [key: string]: unknown;
}

export interface QrJob {
  id: string | number;
  job_code: string;
  quantity: number;
  product_name?: string;
  product_sku?: string;
  batch_group_id?: string;
  batch_number?: string;
  batch_status?: string;
  label_count?: number;
  printed_count?: number;
  can_print_initial?: boolean;
  labels_printed?: boolean;
  qc_ready?: boolean;
  last_printed_at?: string | null;
  [key: string]: unknown;
}

export interface QrJobDetail {
  job: QrJob;
  labels: QrLabel[];
}

export interface DispatchOrder {
  id: string | number;
  order_number: string;
  status: string;
  batch_id?: number;
  batch_number?: string;
  product_name?: string;
  quantity?: number;
  client_id?: string | number;
  client_name?: string;
  driver_name?: string;
  driver_phone?: string;
  vehicle_number?: string;
  container_number?: string;
  scheduled_dispatch_at?: string;
  created_at?: string;
  items?: Array<Record<string, unknown>>;
  [key: string]: unknown;
}

export interface PackingList {
  order_id: number;
  order_number: string;
  quantity: number;
  client?: { name?: string } | null;
  client_name?: string;
  driver_name?: string;
  driver_phone?: string;
  vehicle_number?: string;
  container_number?: string;
  seal_number?: string | null;
  items?: Array<Record<string, unknown>>;
  [key: string]: unknown;
}

export interface ActiveSession {
  id: string;
  session_id?: string;
  order_id: string | number;
  dispatch_order_id?: string | number;
  order_number: string;
  batch_id: string | number;
  batch_number?: string;
  product_name?: string;
  grade_name?: string;
  order_lines?: Array<{ batch_id: number; quantity: number; [key: string]: unknown }>;
  qr_values?: string[];
  scanned: number;
  total: number;
  progress?: number;
  started_at?: string;
  [key: string]: unknown;
}

export interface ScanEvent {
  id: string;
  qr_value: string;
  result: string;
  scanned_at: string;
  [key: string]: unknown;
}

export interface SessionDetail {
  session: ActiveSession & { status?: string; [key: string]: unknown };
  events: ScanEvent[];
}

export interface DashboardData {
  totalProducts: number;
  totalBatches: number;
  pendingQc: number;
  qcPassed: number;
  qcFailed: number;
  dispatchedToday: number;
  pendingDispatchOrders: number;
  dispatchQueueStats?: { awaiting_approval?: number; approved_ready?: number };
  [key: string]: unknown;
}
