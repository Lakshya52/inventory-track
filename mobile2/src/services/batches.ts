import { apiRequest } from './api';

export type BatchRecord = {
  id: string | number;
  batch_number: string;
  barcode_value?: string;
  product_id: string | number;
  product_name?: string;
  product_sku?: string;
  quantity: number;
  uom?: string;
  status: string;
  qr_count?: number;
  storage_location?: string | null;
  location_code?: string | null;
  vendor_name?: string | null;
  grade_name?: string | null;
  created_at?: string;
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
