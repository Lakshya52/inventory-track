import { authenticatedRequest } from '@/services/api/authenticated';
import { API_ENDPOINTS } from '@/services/api/endpoints';
import type {
  ActiveSession,
  BatchGroupItem,
  Client,
  CreateBatchResponse,
  DashboardData,
  DispatchOrder,
  PackingList,
  Product,
  QrJob,
  QrJobDetail,
  SessionDetail,
  ShelfLocation,
  Warehouse,
} from '@/types/domain';

interface BatchGroupsResponse {
  items: Array<Record<string, unknown>>;
  children?: Array<Record<string, unknown>>;
  total: number;
  page: number;
  pages: number;
  limit: number;
}

interface QrJobsResponse {
  items: QrJob[];
  total: number;
  page: number;
  pages: number;
}

interface ScanResponse {
  result: string;
  scanned: number;
  total: number;
  event_id?: string;
  duplicate?: boolean;
  error?: string;
  code?: string;
}

export const domainApi = {
  products: () => authenticatedRequest<Product[]>(API_ENDPOINTS.products.list),
  searchProducts: (q: string) => authenticatedRequest<Product[]>(API_ENDPOINTS.products.search(q)),
  shelfLocations: () => authenticatedRequest<ShelfLocation[]>(API_ENDPOINTS.shelfLocations.list),
  warehouses: () => authenticatedRequest<Warehouse[]>(API_ENDPOINTS.storage.list),
  clients: () => authenticatedRequest<Client[]>(API_ENDPOINTS.clients.list),

  batchGroups: () => authenticatedRequest<BatchGroupsResponse>(API_ENDPOINTS.batches.groups('limit=100')),
  eligibleBatches: () =>
    authenticatedRequest<BatchGroupsResponse>(API_ENDPOINTS.batches.groups('status=QC_PASSED&limit=100')),
  createBatch: (items: BatchGroupItem[]) =>
    authenticatedRequest<CreateBatchResponse>(API_ENDPOINTS.batches.createGroup, {
      method: 'POST',
      body: { items },
    }),

  qrJobs: () => authenticatedRequest<QrJobsResponse>(API_ENDPOINTS.qc.qrJobs('limit=100')),
  qrJob: (id: string | number) => authenticatedRequest<QrJobDetail>(API_ENDPOINTS.qc.qrJob(id)),
  printQrJob: (id: string | number) =>
    authenticatedRequest<{ job: QrJob; labels: unknown[]; selected_count: number }>(API_ENDPOINTS.qc.qrJobPrint(id), {
      method: 'POST',
    }),
  reprintLabels: (id: string | number, labelIds: Array<string | number>) =>
    authenticatedRequest<{ job: QrJob; labels: unknown[] }>(API_ENDPOINTS.qc.qrJobReprint(id), {
      method: 'POST',
      body: { quantity: labelIds.length, label_ids: labelIds },
    }),
  printResult: (jobIds: Array<string | number>, outcome: 'PRINTED' | 'CANCELLED' | 'FAILED') =>
    authenticatedRequest<{ updated: number; outcome: string }>(API_ENDPOINTS.qc.printResult, {
      method: 'POST',
      body: { job_ids: jobIds, outcome },
    }),

  dispatchOrders: () => authenticatedRequest<DispatchOrder[]>(API_ENDPOINTS.dispatchOrders.mine),
  createDispatchOrder: (payload: Record<string, unknown>) =>
    authenticatedRequest<DispatchOrder & { duplicate?: boolean }>(API_ENDPOINTS.dispatchOrders.create, {
      method: 'POST',
      body: payload,
    }),
  availableLabels: (batchIds: string) =>
    authenticatedRequest<Array<{ id: number; batch_id: number; qr_value: string; serial_no: number }>>(
      API_ENDPOINTS.dispatchOrders.availableLabels(batchIds),
    ),
  packingList: (id: string | number) => authenticatedRequest<PackingList>(API_ENDPOINTS.dispatchOrders.packingList(id)),
  recallStandaloneQr: (payload: { qr_value: string; reason: string; condition: string }) =>
    authenticatedRequest<{ message: string; condition: string; order_id?: number; batch_id?: number }>(
      API_ENDPOINTS.dispatchOrders.recallQr,
      { method: 'POST', body: payload },
    ),
  dispatchToday: () => authenticatedRequest<unknown[]>(API_ENDPOINTS.dispatch.today),
  dashboard: () => authenticatedRequest<DashboardData>(API_ENDPOINTS.dashboard.summary),

  activeSessions: () => authenticatedRequest<ActiveSession[]>(API_ENDPOINTS.loadingSessions.active),
  createLoadingSession: (dispatchOrderId: string | number) =>
    authenticatedRequest<{ session: ActiveSession; total: number }>(API_ENDPOINTS.loadingSessions.create, {
      method: 'POST',
      body: { dispatch_order_id: dispatchOrderId },
    }),
  session: (id: string) => authenticatedRequest<SessionDetail>(API_ENDPOINTS.loadingSessions.byId(id)),
  scan: (id: string, qrValue: string) =>
    authenticatedRequest<ScanResponse>(API_ENDPOINTS.loadingSessions.scan(id), {
      method: 'POST',
      body: { qr_value: qrValue },
    }),
  recallQr: (id: string, payload: { qr_value: string; reason: string; condition: string }) =>
    authenticatedRequest<{ message: string; condition: string; scanned: number; total: number }>(
      API_ENDPOINTS.loadingSessions.recallQr(id),
      { method: 'POST', body: payload },
    ),
  sealSession: (id: string, sealNumber: string) =>
    authenticatedRequest<{ session_id: string; order_id: number; seal_number: string }>(API_ENDPOINTS.loadingSessions.seal(id), {
      method: 'PATCH',
      body: { seal_number: sealNumber },
    }),
  finaliseSession: (
    id: string,
    payload: {
      driver_name: string;
      driver_phone?: string;
      vehicle_number: string;
      container_number: string;
      seal_number?: string;
      outcome: 'DISPATCHED' | 'NOT_DISPATCHED';
      remarks?: string;
    },
  ) =>
    authenticatedRequest<{ session: ActiveSession; order_status: string; loaded_quantity: number }>(
      API_ENDPOINTS.loadingSessions.finalise(id),
      { method: 'POST', body: payload },
    ),
};
