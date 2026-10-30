import { apiRequest } from './api';

export type BatchRecord = {
  id: string | number;
  batch_number: string;
  barcode_value?: string;
  product_id: string | number;
  product_name?: string | null;
  product_sku?: string | null;
  quantity: number;
  uom?: string | null;
  status: string;
  qr_count?: number;
  qr_job_id?: string | number | null;
  storage_location?: string | null;
  location_code?: string | null;
  shelf_location_id?: string | number | null;
  vendor_id?: string | number | null;
  vendor_name?: string | null;
  grade_id?: string | number | null;
  grade_name?: string | null;
  bag_quantity_id?: string | number | null;
  bag_quantity_name?: string | null;
  bag_quantity?: number | null;
  bag_quantity_unit?: string | null;
  unit_price?: number | null;
  manufacturing_date?: string | null;
  expiry_date?: string | null;
  notes?: string | null;
  batch_group_id?: string | null;
  fg_details_completed_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;

  // Product master details included by GET /batches/barcode/:barcode
  product_description?: string | null;
  product_purity?: string | null;
  product_grade?: string | null;
  product_physical_state?: string | null;
  product_storage_conditions?: string | null;
  cas_number?: string | null;
  molecular_formula?: string | null;
  hazard_classification?: string | null;
  hsn_code?: string | null;
  manufacturer?: string | null;

  // Scan metadata
  scanned_qr?: string | null;
  matched_by_batch_number?: number | boolean | null;

  /** Future-proof: the API may expose additional columns we still want to show. */
  [key: string]: unknown;
};

export type BatchCreateResult = {
  batch_count: number;
  batches: { id: string | number; batch_number: string; labels: unknown[] }[];
};

export const batchApi = {
  list: () => apiRequest<BatchRecord[]>('/batches'),
  getByBarcode: (barcode: string) => apiRequest<BatchRecord>(`/batches/barcode/${encodeURIComponent(barcode)}`),
  create: (payload: { product_id: string; quantity: number; batch_count: number; uom: string; batch_number?: string }) =>
    apiRequest<BatchCreateResult>('/batches', { method: 'POST', body: payload }),
};
