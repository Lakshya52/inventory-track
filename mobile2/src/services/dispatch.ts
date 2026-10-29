import { API_BASE_URL, apiRequest } from './api';
import type {
  DispatchBatch,
  DispatchOrder,
  LoadingScanEvent,
  LoadingSession,
  PackingListData,
  ScanResult,
} from '@/types';

export type DispatchOrderRecord = DispatchOrder;

export type DispatchHistoryRecord = {
  id?: string;
  dispatch_order_id?: string | null;
  session_id?: string | null;
  batch_number?: string | null;
  product_name?: string | null;
  product_sku?: string | null;
  client_name?: string | null;
  dispatched?: number | boolean;
  order_status?: string | null;
  seal_number?: string | null;
  remarks?: string | null;
  created_at?: string | null;
};

export type DispatchHistoryPage = {
  items: DispatchHistoryRecord[];
  total: number;
  page: number;
  limit: number;
  pages: number;
};

export type DispatchStats = {
  scope: 'mine' | 'all';
  totalDispatches: number;
  dispatchedToday: number;
  dispatchedThisWeek: number;
  readyToDispatch: number;
  pendingOrders: number;
  approvedOrders: number;
};

export type RaiseOrderPayload = {
  batch_id?: string;
  barcode_value?: string;
  client_id: string;
  driver_name: string;
  vehicle_number: string;
  container_number: string;
  client_operation_id?: string;
};

export type FinaliseSessionPayload = {
  seal_number: string;
  outcome: 'DISPATCHED' | 'NOT_DISPATCHED';
  remarks?: string;
  client_operation_id?: string;
};

export type ScanResponse = {
  result: ScanResult;
  scanned: number;
  total: number;
  event_id: string | null;
  duplicate: boolean;
  error?: string;
  code?: string;
};

function generateOpId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    try {
      return crypto.randomUUID();
    } catch {
      // Fall through to timestamp-based id
    }
  }
  return `mob-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

export const dispatchApi = {
  /** Summary dashboard statistics */
  stats: () => apiRequest<DispatchStats>('/dispatch/stats'),

  /** Orders raised by the logged-in dispatch user */
  myOrders: async (params?: { q?: string; status?: string }): Promise<DispatchOrder[]> => {
    const searchParams = new URLSearchParams();
    if (params?.q) searchParams.set('q', params.q);
    if (params?.status) searchParams.set('status', params.status);
    const query = searchParams.toString();
    return apiRequest<DispatchOrder[]>(`/dispatch-orders/mine${query ? `?${query}` : ''}`);
  },

  /** Batches available for raising a dispatch order (QC_PASSED) */
  readyBatches: async (params?: { q?: string }): Promise<DispatchBatch[]> => {
    const batches = await apiRequest<DispatchBatch[]>('/batches');
    const needle = params?.q?.trim().toLowerCase();
    return batches.filter((batch) => {
      const isEligible = batch.status === 'QC_PASSED' || batch.status === 'DISPATCH_ORDER_RAISED';
      if (!isEligible) return false;
      if (!needle) return true;
      return (
        batch.batch_number?.toLowerCase().includes(needle) ||
        batch.product_name?.toLowerCase().includes(needle) ||
        batch.product_sku?.toLowerCase().includes(needle) ||
        batch.barcode_value?.toLowerCase().includes(needle)
      );
    });
  },

  /** Raise a new dispatch order request for a batch */
  raiseOrder: (payload: RaiseOrderPayload) =>
    apiRequest<{ id: string; status: string; order: DispatchOrder }>('/dispatch-orders', {
      method: 'POST',
      body: {
        ...payload,
        client_operation_id: payload.client_operation_id || generateOpId(),
      },
    }),

  /** Get frozen packing list data for an approved order */
  getPackingList: async (orderId: string | number): Promise<PackingListData> => {
    const res = await apiRequest<{ ok?: boolean; data?: PackingListData } | PackingListData>(
      `/dispatch-orders/${orderId}/packing-list`
    );
    if (res && typeof res === 'object' && 'data' in res && res.data) {
      return res.data;
    }
    return res as PackingListData;
  },

  /** URL to download or view the print-ready PDF packing list */
  packingListPdfUrl: (orderId: string | number): string =>
    `${API_BASE_URL}/dispatch-orders/${orderId}/packing-list.pdf`,

  /** Fetch active loading sessions for the current dispatcher */
  activeLoadingSessions: () => apiRequest<LoadingSession[]>('/loading-sessions/active'),

  /** Start a scan-based loading session on an approved order */
  startLoadingSession: (dispatchOrderId: string | number, clientOperationId?: string) =>
    apiRequest<{
      session: LoadingSession;
      order_id: string;
      batch_number: string | null;
      product_name: string | null;
      total: number;
    }>('/loading-sessions', {
      method: 'POST',
      body: {
        dispatch_order_id: dispatchOrderId,
        client_operation_id: clientOperationId || generateOpId(),
      },
    }),

  /** Get loading session details and recent scan events */
  getLoadingSession: (sessionId: string) =>
    apiRequest<{
      session: LoadingSession;
      events: LoadingScanEvent[];
    }>(`/loading-sessions/${sessionId}`),

  /** Scan a unit QR code into an active session */
  scan: (sessionId: string, qrValue: string, clientOperationId?: string) =>
    apiRequest<ScanResponse>(`/loading-sessions/${sessionId}/scan`, {
      method: 'POST',
      body: {
        qr_value: qrValue.trim(),
        client_operation_id: clientOperationId || generateOpId(),
      },
    }),

  /** Finalise a loading session with required seal number and outcome */
  finalise: (sessionId: string, payload: FinaliseSessionPayload) =>
    apiRequest<{
      session: LoadingSession;
      order_status: string;
      batch_status: string;
      dispatch_record_id?: string;
    }>(`/loading-sessions/${sessionId}/finalise`, {
      method: 'POST',
      body: {
        ...payload,
        client_operation_id: payload.client_operation_id || generateOpId(),
      },
    }),

  /** Today's dispatches log */
  today: () => apiRequest<any[]>('/dispatch/today'),

  /** Completed dispatch records for the current dispatcher (scoped by the API). */
  history: (params?: { page?: number; limit?: number; q?: string }) => {
    const searchParams = new URLSearchParams();
    if (params?.page) searchParams.set('page', String(params.page));
    if (params?.limit) searchParams.set('limit', String(params.limit));
    if (params?.q) searchParams.set('q', params.q);
    const query = searchParams.toString();
    return apiRequest<DispatchHistoryPage>(`/dispatch/records${query ? `?${query}` : ''}`);
  },

  // Retain legacy method signatures for existing code compatibility
  approvedOrders: () => apiRequest<DispatchOrderRecord[]>('/dispatch/approved-orders'),
  records: () => apiRequest<DispatchOrderRecord[]>('/dispatch/records'),
  submit: (barcodeValue: string, remarks?: string) =>
    apiRequest('/dispatch', {
      method: 'POST',
      body: { barcode_value: barcodeValue, remarks },
    }),
  pendingOrders: () => apiRequest<DispatchOrderRecord[]>('/dispatch-orders/pending'),
  allOrders: () => apiRequest<DispatchOrderRecord[]>('/dispatch-orders/all'),
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
