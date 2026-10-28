import { apiRequest } from './api';

/**
 * QC endpoints ready for the QC role UI.
 * Add new calls here as the QC screens are built; keep components free of fetch logic.
 */
export type QcStats = {
  pendingQc: number;
  qcPassed: number;
  qcFailed: number;
  batchesToday: number;
};

export type QcRecord = {
  id: number | string;
  batch_id: number | string;
  batch_number?: string;
  product_name?: string;
  result: 'PASS' | 'FAIL';
  remarks?: string | null;
  created_at: string;
};

export const qcApi = {
  stats: () => apiRequest<QcStats>('/qc/stats'),
  pending: () => apiRequest<QcRecord[]>('/qc/pending'),
  records: () => apiRequest<QcRecord[]>('/qc/records'),
  submit: (barcodeValue: string, result: 'PASS' | 'FAIL', remarks?: string) =>
    apiRequest('/qc', {
      method: 'POST',
      body: { barcode_value: barcodeValue, result, remarks },
    }),
};
