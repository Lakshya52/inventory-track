// In local development API_URL is unset and Vite proxies /api to the backend.
// On Vercel, set API_URL to the Render service origin.
import type { QrJob, QrLabel } from '../utils/qrPdf';
import type { EntityId, Role } from '../types';
import type { Tenant } from '../types';

const API_ORIGIN = (import.meta.env.API_URL || '').replace(/\/+$/, '').replace(/\/api$/i, '');
const BASE_URL = `${API_ORIGIN}/api`;

function apiOrigin(): string {
  return API_ORIGIN;
}

function idPath(id: EntityId): string {
  return encodeURIComponent(String(id));
}

export function uploadUrl(filename: string): string {
  return `${apiOrigin()}/uploads/${filename}`;
}

export function resolveUploadUrl(url: string | null | undefined): string {
  if (!url) return '';
  if (/^https?:\/\//i.test(url)) return url;
  if (url.startsWith('/api/tenants/') && url.endsWith('/logo')) return `${API_ORIGIN}${url}`;
  const prefix = '/uploads/';
  return url.startsWith(prefix) ? `${apiOrigin()}${url}` : url;
}

function token(): string | null {
  return localStorage.getItem('token');
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((options.headers as Record<string, string>) || {}),
  };
  const t = token();
  if (t) headers['Authorization'] = `Bearer ${t}`;
  const res = await fetch(`${BASE_URL}${path}`, { ...options, headers });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || 'Request failed');
  }
  return res.json();
}

export const api = {
  auth: {
    register: (data: { name: string; companyName: string; mobile: string; email: string; password: string }) =>
      request<{ token: string; user: any; tenant: any }>('/auth/register', { method: 'POST', body: JSON.stringify(data) }),
    uploadLogo: async (file: File): Promise<string> => {
      const form = new FormData();
      form.append('file', file);
      const headers: Record<string, string> = {};
      const authToken = token();
      if (authToken) headers.Authorization = `Bearer ${authToken}`;
      const response = await fetch(`${BASE_URL}/tenant-logo`, { method: 'POST', body: form, headers });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Logo upload failed');
      if (typeof data.logoUrl !== 'string' || !/^\/api\/tenants\/[^/]+\/logo$/.test(data.logoUrl)) {
        throw new Error('Upload succeeded but the server returned an invalid logo URL.');
      }
      return data.logoUrl;
    },
    login: (email: string, password: string) =>
      request<{ token: string; user: any }>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      }),
    me: () => request<any>('/auth/me'),
    tenant: () => request<Tenant>('/auth/tenant'),
    updateTenant: (data: Pick<Tenant, 'name' | 'email' | 'phone' | 'logoUrl'>) =>
      request<Tenant>('/auth/tenant', { method: 'PUT', body: JSON.stringify(data) }),
    refresh: (refreshToken: string) =>
      request<any>('/auth/refresh', { method: 'POST', body: JSON.stringify({ refreshToken }) }),
    logout: (refreshToken?: string) =>
      request<any>('/auth/logout', { method: 'POST', body: JSON.stringify({ refreshToken }) }),
  },
  profile: {
    update: (data: { name?: string; currentPassword?: string; newPassword?: string }) =>
      request<any>('/profile', { method: 'PUT', body: JSON.stringify(data) }),
  },
  users: {
    list: () => request<any[]>('/users'),
    add: (data: { name: string; email: string; password: string; role: 'ADMIN' | 'QC' | 'DISPATCH' }) =>
      request<any>('/users', { method: 'POST', body: JSON.stringify(data) }),
    update: (type: string, id: EntityId, data: { name: string; email: string; role: Role }) =>
      request<any>(`/users/${type}/${idPath(id)}`, { method: 'PUT', body: JSON.stringify(data) }),
    changePassword: (type: string, id: EntityId, password: string) =>
      request<any>(`/users/${type}/${idPath(id)}/password`, { method: 'PUT', body: JSON.stringify({ password }) }),
    setStatus: (type: string, id: EntityId, is_active: boolean) =>
      request<any>(`/users/${type}/${idPath(id)}/status`, { method: 'PATCH', body: JSON.stringify({ is_active }) }),
    delete: (type: string, id: EntityId) =>
      request<any>(`/users/${type}/${idPath(id)}`, { method: 'DELETE' }),
  },
  masters: {
    list: (kind: 'grades' | 'bag-quantities' | 'uoms') => request<any[]>(`/masters/${kind}`),
    create: (kind: 'grades' | 'bag-quantities' | 'uoms', data: any) =>
      request<any>(`/masters/${kind}`, { method: 'POST', body: JSON.stringify(data) }),
    update: (kind: 'grades' | 'bag-quantities' | 'uoms', id: EntityId, data: any) =>
      request<any>(`/masters/${kind}/${idPath(id)}`, { method: 'PUT', body: JSON.stringify(data) }),
    setStatus: (kind: 'grades' | 'bag-quantities' | 'uoms', id: EntityId, is_active: boolean) =>
      request<any>(`/masters/${kind}/${idPath(id)}/status`, { method: 'PATCH', body: JSON.stringify({ is_active }) }),
    remove: (kind: 'grades' | 'bag-quantities' | 'uoms', id: EntityId) =>
      request<any>(`/masters/${kind}/${idPath(id)}`, { method: 'DELETE' }),
  },
  vendors: {
    list: (params?: { q?: string; status?: string }) => {
      const qs = new URLSearchParams();
      if (params?.q) qs.set('q', params.q);
      if (params?.status) qs.set('status', params.status);
      const suffix = qs.toString() ? `?${qs.toString()}` : '';
      return request<any[]>(`/vendors${suffix}`);
    },
    create: (data: any) => request<any>('/vendors', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: EntityId, data: any) => request<any>(`/vendors/${idPath(id)}`, { method: 'PUT', body: JSON.stringify(data) }),
    setStatus: (id: EntityId, is_active: boolean) =>
      request<any>(`/vendors/${idPath(id)}/status`, { method: 'PATCH', body: JSON.stringify({ is_active }) }),
    delete: (id: EntityId) => request<any>(`/vendors/${idPath(id)}`, { method: 'DELETE' }),
  },
  reports: {
    summary: () => request<any>('/reports/summary'),
    qc: (params?: { from?: string; to?: string; result?: string }) => {
      const qs = new URLSearchParams();
      if (params?.from) qs.set('from', params.from);
      if (params?.to) qs.set('to', params.to);
      if (params?.result) qs.set('result', params.result);
      return request<any[]>(`/reports/qc${qs.toString() ? `?${qs}` : ''}`);
    },
    dispatch: (params?: { from?: string; to?: string }) => {
      const qs = new URLSearchParams();
      if (params?.from) qs.set('from', params.from);
      if (params?.to) qs.set('to', params.to);
      return request<any[]>(`/reports/dispatch${qs.toString() ? `?${qs}` : ''}`);
    },
    dispatchRequests: (params?: { from?: string; to?: string; status?: string }) => {
      const qs = new URLSearchParams();
      if (params?.from) qs.set('from', params.from);
      if (params?.to) qs.set('to', params.to);
      if (params?.status) qs.set('status', params.status);
      return request<any[]>(`/reports/dispatch-requests${qs.toString() ? `?${qs}` : ''}`);
    },
    inventory: () => request<any[]>('/reports/inventory'),
    batches: (params?: { from?: string; to?: string; status?: string }) => {
      const qs = new URLSearchParams();
      if (params?.from) qs.set('from', params.from);
      if (params?.to) qs.set('to', params.to);
      if (params?.status) qs.set('status', params.status);
      return request<any[]>(`/reports/batches${qs.toString() ? `?${qs}` : ''}`);
    },
  },
  products: {
    list: () => request<any[]>('/products'),
    create: (data: any) =>
      request<any>('/products', { method: 'POST', body: JSON.stringify(data) }),
    search: (q: string) => request<any[]>(`/products/search?q=${encodeURIComponent(q)}`),
    update: (id: EntityId, data: any) => request<any>(`/products/${idPath(id)}`, { method: 'PUT', body: JSON.stringify(data) }),
    delete: (id: EntityId) => request<any>(`/products/${idPath(id)}`, { method: 'DELETE' }),
    importExcel: (file: File) => {
      const formData = new FormData();
      formData.append('file', file);
      const headers: Record<string, string> = {};
      const t = token();
      if (t) headers['Authorization'] = `Bearer ${t}`;
      return fetch(`${BASE_URL}/products/import`, { method: 'POST', body: formData, headers }).then(async res => {
        if (!res.ok) { const err = await res.json().catch(() => ({ error: res.statusText })); throw new Error(err.error || 'Import failed'); }
        return res.json();
      });
    },
    downloadSample: () => {
      const headers: Record<string, string> = {};
      const t = token();
      if (t) headers['Authorization'] = `Bearer ${t}`;
      return fetch(`${BASE_URL}/products/import/sample`, { headers }).then(async res => {
        if (!res.ok) throw new Error('Download failed');
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'sample_products_import.xlsx';
        a.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      });
    },
  },
  batches: {
    list: (params?: { status?: string }) => {
      const suffix = params?.status ? `?status=${encodeURIComponent(params.status)}` : '';
      return request<any[]>(`/batches${suffix}`);
    },
    create: (data: {
      product_id: EntityId;
      batch_number?: string;
      quantity: number;
      batch_count?: number;
      uom?: string;
      shelf_location_id?: EntityId;
      unit_price?: number;
      manufacturing_date?: string;
      expiry_date?: string;
      notes?: string;
    }): Promise<{
      batch_group_id: string;
      batch_count: number;
      batches: Array<{
        id: EntityId;
        batch_number: string;
        barcode_value: string;
        qr_job: QrJob;
        labels: QrLabel[];
      }>;
      message: string;
    }> =>
      request('/batches', { method: 'POST', body: JSON.stringify(data) }),
    createGroup: (data: { items: Array<{ product_id: EntityId; quantity: number; uom: string; shelf_location_id: EntityId; unit_price?: number }> }) =>
      request<{ id: string; batch_group_id: string; batch_number: string; product_count: number; total_quantity: number; batches: Array<any>; labels: Array<QrLabel>; message: string }>('/batches/group', { method: 'POST', body: JSON.stringify(data) }),
    finishGoods: (id: EntityId, data: { vendor_id: EntityId; grade_id: EntityId; bag_quantity_id: EntityId; shelf_location_id?: EntityId }) =>
      request<any>(`/batches/${idPath(id)}/finish-goods`, { method: 'POST', body: JSON.stringify(data) }),
    getByBarcode: (barcode: string) =>
      request<any>(`/batches/barcode/${encodeURIComponent(barcode)}`),
    getById: (id: EntityId) => request<any>(`/batches/${idPath(id)}`),
    update: (id: EntityId, data: any) => request<any>(`/batches/${idPath(id)}`, { method: 'PUT', body: JSON.stringify(data) }),
    search: (q: string) => request<any[]>(`/batches/search?q=${encodeURIComponent(q)}`),
  },
  qc: {
    qrJobs: {
      list: (q?: string) => request<{ items: any[]; total: number }>(`/qc/qr-jobs${q ? `?q=${encodeURIComponent(q)}` : ''}`),
      create: (data: { product_id: EntityId; quantity: number }) =>
        request<any>('/qc/qr-jobs', { method: 'POST', body: JSON.stringify(data) }),
      get: (id: EntityId) => request<any>(`/qc/qr-jobs/${idPath(id)}`),
      reprint: (id: EntityId, data: { quantity?: number; label_ids?: EntityId[] }) =>
        request<any>(`/qc/qr-jobs/${idPath(id)}/reprint`, { method: 'POST', body: JSON.stringify(data) }),
    requestReprint: (id: EntityId, label_ids: EntityId[]) =>
      request<any>(`/qc/qr-jobs/${idPath(id)}/reprint-request`, { method: 'POST', body: JSON.stringify({ label_ids }) }),
    reprintRequests: () => request<any[]>('/qc/qr-jobs/reprint-requests'),
    completeReprintRequest: (id: EntityId) =>
      request<any>(`/qc/qr-jobs/reprint-requests/${idPath(id)}/complete`, { method: 'POST', body: '{}' }),
    },
    stats: () => request<any>('/qc/stats'),
    pending: (params?: { page?: number; limit?: number; q?: string }) => {
      const qs = new URLSearchParams();
      if (params?.page) qs.set('page', String(params.page));
      if (params?.limit) qs.set('limit', String(params.limit));
      if (params?.q) qs.set('q', params.q);
      return request<{ items: any[]; total: number; page: number; limit: number; pages: number }>(
        `/qc/pending${qs.toString() ? `?${qs}` : ''}`
      );
    },
    records: (params?: { page?: number; limit?: number; q?: string; result?: string; scope?: 'mine' | 'all' }) => {
      const qs = new URLSearchParams();
      if (params?.page) qs.set('page', String(params.page));
      if (params?.limit) qs.set('limit', String(params.limit));
      if (params?.q) qs.set('q', params.q);
      if (params?.result) qs.set('result', params.result);
      if (params?.scope) qs.set('scope', params.scope);
      return request<{ items: any[]; total: number; page: number; limit: number; pages: number; scope: string }>(
        `/qc/records${qs.toString() ? `?${qs}` : ''}`
      );
    },
  },
  dispatch: {
    today: () => request<any[]>('/dispatch/today'),
    stats: () => request<any>('/dispatch/stats'),
    ready: (params?: { page?: number; limit?: number; q?: string }) => {
      const qs = new URLSearchParams();
      if (params?.page) qs.set('page', String(params.page));
      if (params?.limit) qs.set('limit', String(params.limit));
      if (params?.q) qs.set('q', params.q);
      return request<{ items: any[]; total: number; page: number; limit: number; pages: number }>(
        `/dispatch/ready${qs.toString() ? `?${qs}` : ''}`
      );
    },
    records: (params?: { page?: number; limit?: number; q?: string }) => {
      const qs = new URLSearchParams();
      if (params?.page) qs.set('page', String(params.page));
      if (params?.limit) qs.set('limit', String(params.limit));
      if (params?.q) qs.set('q', params.q);
      return request<{ items: any[]; total: number; page: number; limit: number; pages: number }>(
        `/dispatch/records${qs.toString() ? `?${qs}` : ''}`
      );
    },
    approvedOrders: () => request<any[]>('/dispatch/approved-orders'),
  },
  dispatchOrders: {
    raise: (data: { batch_id?: EntityId; barcode_value?: string; expected_status?: string; client_id: EntityId; quantity?: number; items?: Array<{ batch_id: EntityId; quantity: number }>; client_operation_id?: string }) =>
      request<any>('/dispatch-orders', { method: 'POST', body: JSON.stringify(data) }),
    pending: (params?: { q?: string }) => {
      const qs = new URLSearchParams();
      if (params?.q) qs.set('q', params.q);
      return request<any[]>(`/dispatch-orders/pending${qs.toString() ? `?${qs}` : ''}`);
    },
    all: (params?: { q?: string; status?: string }) => {
      const qs = new URLSearchParams();
      if (params?.q) qs.set('q', params.q);
      if (params?.status) qs.set('status', params.status);
      return request<any[]>(`/dispatch-orders/all${qs.toString() ? `?${qs}` : ''}`);
    },
    mine: (params?: { q?: string; status?: string }) => {
      const qs = new URLSearchParams();
      if (params?.q) qs.set('q', params.q);
      if (params?.status) qs.set('status', params.status);
      return request<any[]>(`/dispatch-orders/mine${qs.toString() ? `?${qs}` : ''}`);
    },
    approve: (id: EntityId, remarks?: string) =>
      request<any>(`/dispatch-orders/${idPath(id)}/approve`, { method: 'POST', body: JSON.stringify({ remarks }) }),
    reject: (id: EntityId, remarks: string) =>
      request<any>(`/dispatch-orders/${idPath(id)}/reject`, { method: 'POST', body: JSON.stringify({ remarks }) }),
    packingList: (id: EntityId) =>
      request<any>(`/dispatch-orders/${idPath(id)}/packing-list`),
    downloadPackingListPdf: async (id: EntityId, filename?: string) => {
      const headers: Record<string, string> = {};
      const t = token();
      if (t) headers['Authorization'] = `Bearer ${t}`;
      const res = await fetch(`${BASE_URL}/dispatch-orders/${idPath(id)}/packing-list.pdf`, { headers });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error || 'Could not download packing list');
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filename || `packing-list-${id}.pdf`;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    },
  },
  loadingSessions: {
    start: (dispatch_order_id: EntityId, client_operation_id?: string) =>
      request<any>('/loading-sessions', {
        method: 'POST',
        body: JSON.stringify({ dispatch_order_id, client_operation_id }),
      }),
    scan: (id: EntityId, qr_value: string, client_operation_id?: string) =>
      request<{
        result: 'OK' | 'DUPLICATE' | 'WRONG_BATCH' | 'QTY_EXCEEDED';
        scanned: number;
        total: number;
        event_id?: EntityId;
        duplicate?: boolean;
        error?: string;
        code?: string;
      }>(`/loading-sessions/${idPath(id)}/scan`, {
        method: 'POST',
        body: JSON.stringify({ qr_value, client_operation_id }),
      }),
    recallQr: (id: EntityId, data: { qr_value: string; condition: 'DAMAGED' | 'HOLD' | 'OTHER'; reason: string }) =>
      request<any>(`/loading-sessions/${idPath(id)}/recall-qr`, { method: 'POST', body: JSON.stringify(data) }),
    get: (id: EntityId) => request<any>(`/loading-sessions/${idPath(id)}`),
    active: () => request<any[]>('/loading-sessions/active'),
    cancel: (id: EntityId) => request<any>(`/loading-sessions/${idPath(id)}/cancel`, { method: 'POST' }),
    finalise: (id: EntityId, data: {
      seal_number: string;
      outcome: 'DISPATCHED' | 'NOT_DISPATCHED';
      driver_name: string;
      driver_phone?: string;
      vehicle_number: string;
      container_number: string;
      remarks?: string;
      client_operation_id?: string;
    }) => request<any>(`/loading-sessions/${idPath(id)}/finalise`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  },
  sync: {
    register: (data: { device_uuid: string; platform?: string; app_version?: string }) =>
      request<any>('/sync/register', { method: 'POST', body: JSON.stringify(data) }),
    pull: (since = 0, deviceUuid?: string) => {
      const qs = new URLSearchParams({ since: String(since), limit: '500' });
      if (deviceUuid) qs.set('device_uuid', deviceUuid);
      return request<any>(`/sync/pull?${qs.toString()}`);
    },
    push: (operations: any[], deviceUuid?: string) =>
      request<any>('/sync/push', { method: 'POST', body: JSON.stringify({ operations, device_uuid: deviceUuid }) }),
    status: (deviceUuid?: string) =>
      request<any>(`/sync/status${deviceUuid ? `?device_uuid=${encodeURIComponent(deviceUuid)}` : ''}`),
  },
  shelfLocations: {
    list: () => request<any[]>('/shelf-locations'),
    create: (data: any) =>
      request<any>('/shelf-locations', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: EntityId, data: any) => request<any>(`/shelf-locations/${idPath(id)}`, { method: 'PUT', body: JSON.stringify(data) }),
    delete: (id: EntityId) => request<any>(`/shelf-locations/${idPath(id)}`, { method: 'DELETE' }),
  },
  clients: {
    list: () => request<any[]>('/clients'),
    create: (data: any) =>
      request<any>('/clients', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: EntityId, data: any) => request<any>(`/clients/${idPath(id)}`, { method: 'PUT', body: JSON.stringify(data) }),
    delete: (id: EntityId) => request<any>(`/clients/${idPath(id)}`, { method: 'DELETE' }),
  },
  dashboard: {
    stats: () => request<any>('/dashboard'),
    admin: () => request<any>('/dashboard/admin'),
  },
  activity: {
    list: (page = 1, limit = 50) =>
      request<{ logs: any[]; total: number }>(`/activity?page=${page}&limit=${limit}`),
  },
};
