import { apiRequest } from './api';

/**
 * Dispatch endpoints ready for the dispatch role UI.
 * Keep request/response shapes here so screens only deal with UI state.
 */
export type DispatchOrderRecord = {
  id: number | string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  client_id?: number | string;
  client_name?: string | null;
  driver_name?: string | null;
  vehicle_number?: string | null;
  batch_number?: string | null;
  created_at: string;
};

export type DispatchStats = {
  pendingRequests: number;
  approvedToday: number;
  dispatched: number;
  clients: number;
};

export const dispatchApi = {
  stats: () => apiRequest<DispatchStats>('/dispatch/stats'),
  approvedOrders: () => apiRequest<DispatchOrderRecord[]>('/dispatch/approved-orders'),
  records: () => apiRequest<DispatchOrderRecord[]>('/dispatch/records'),
  submit: (barcodeValue: string, remarks?: string) =>
    apiRequest('/dispatch', {
      method: 'POST',
      body: { barcode_value: barcodeValue, remarks },
    }),
  pendingOrders: () => apiRequest<DispatchOrderRecord[]>('/dispatch-orders/pending'),
  myOrders: () => apiRequest<DispatchOrderRecord[]>('/dispatch-orders/mine'),
  approve: (id: number | string, remarks?: string) =>
    apiRequest(`/dispatch-orders/${id}/approve`, {
      method: 'POST',
      body: { admin_remarks: remarks },
    }),
  reject: (id: number | string, remarks?: string) =>
    apiRequest(`/dispatch-orders/${id}/reject`, {
      method: 'POST',
      body: { admin_remarks: remarks },
    }),
};
