// In local development API_URL is unset and Vite proxies /api to the backend.
// On Vercel, set API_URL to the Render service origin.
import type { QrJob, QrLabel } from '../utils/qrPdf';

const API_ORIGIN = (import.meta.env.API_URL || '').replace(/\/+$/, '');
const BASE_URL = `${API_ORIGIN}/api`;

export function uploadUrl(filename: string): string {
  return `${API_ORIGIN}/uploads/${filename}`;
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

async function uploadForm<T>(path: string, formData: FormData): Promise<T> {
  const headers: Record<string, string> = {};
  const t = token();
  if (t) headers['Authorization'] = `Bearer ${t}`;
  const res = await fetch(`${BASE_URL}${path}`, { method: 'POST', body: formData, headers });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || 'Request failed');
  }
  return res.json();
}

export const api = {
  auth: {
    login: (email: string, password: string) =>
      request<{ token: string; user: any }>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      }),
    me: () => request<any>('/auth/me'),
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
    update: (type: string, id: number, data: { name: string; email: string }) =>
      request<any>(`/users/${type}/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    changePassword: (type: string, id: number, password: string) =>
      request<any>(`/users/${type}/${id}/password`, { method: 'PUT', body: JSON.stringify({ password }) }),
    setStatus: (type: string, id: number, is_active: boolean) =>
      request<any>(`/users/${type}/${id}/status`, { method: 'PATCH', body: JSON.stringify({ is_active }) }),
    delete: (type: string, id: number) =>
      request<any>(`/users/${type}/${id}`, { method: 'DELETE' }),
  },
  masters: {
    list: (kind: 'grades' | 'bag-quantities') => request<any[]>(`/masters/${kind}`),
    create: (kind: 'grades' | 'bag-quantities', data: any) =>
      request<any>(`/masters/${kind}`, { method: 'POST', body: JSON.stringify(data) }),
    update: (kind: 'grades' | 'bag-quantities', id: number, data: any) =>
      request<any>(`/masters/${kind}/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    setStatus: (kind: 'grades' | 'bag-quantities', id: number, is_active: boolean) =>
      request<any>(`/masters/${kind}/${id}/status`, { method: 'PATCH', body: JSON.stringify({ is_active }) }),
    remove: (kind: 'grades' | 'bag-quantities', id: number) =>
      request<any>(`/masters/${kind}/${id}`, { method: 'DELETE' }),
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
    update: (id: number, data: any) => request<any>(`/vendors/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    setStatus: (id: number, is_active: boolean) =>
      request<any>(`/vendors/${id}/status`, { method: 'PATCH', body: JSON.stringify({ is_active }) }),
    delete: (id: number) => request<any>(`/vendors/${id}`, { method: 'DELETE' }),
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
    update: (id: number, data: any) => request<any>(`/products/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    delete: (id: number) => request<any>(`/products/${id}`, { method: 'DELETE' }),
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
        URL.revokeObjectURL(url);
      });
    },
  },
  batches: {
    list: () => request<any[]>('/batches'),
    create: (data: {
      product_id: number;
      batch_number: string;
      quantity: number;
      batch_count?: number;
      uom?: string;
      unit_price?: number;
      manufacturing_date?: string;
      expiry_date?: string;
      notes?: string;
    }): Promise<{
      batch_group_id: string;
      batch_count: number;
      batches: Array<{
        id: number;
        batch_number: string;
        barcode_value: string;
        qr_job: QrJob;
        labels: QrLabel[];
      }>;
      message: string;
    }> =>
      request('/batches', { method: 'POST', body: JSON.stringify(data) }),
    finishGoods: (id: number, data: { vendor_id: number; grade_id: number; bag_quantity_id: number; shelf_location_id?: number }) =>
      request<any>(`/batches/${id}/finish-goods`, { method: 'POST', body: JSON.stringify(data) }),
    getByBarcode: (barcode: string) =>
      request<any>(`/batches/barcode/${encodeURIComponent(barcode)}`),
    getById: (id: number) => request<any>(`/batches/${id}`),
    update: (id: number, data: any) => request<any>(`/batches/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    search: (q: string) => request<any[]>(`/batches/search?q=${encodeURIComponent(q)}`),
  },
  qc: {
    submit: (data: { barcode_value: string; result: 'PASS' | 'FAIL'; remarks?: string; images?: File[] }) => {
      if (data.images && data.images.length > 0) {
        const fd = new FormData();
        fd.append('barcode_value', data.barcode_value);
        fd.append('result', data.result);
        if (data.remarks) fd.append('remarks', data.remarks);
        data.images.forEach(f => fd.append('images', f));
        return uploadForm<any>('/qc', fd);
      }
      return request<any>('/qc', { method: 'POST', body: JSON.stringify(data) });
    },
    submitBulk: (data: { barcodes: string[]; result: 'PASS' | 'FAIL'; remarks?: string; images?: File[] }) => {
      if (data.images && data.images.length > 0) {
        const fd = new FormData();
        fd.append('barcodes', JSON.stringify(data.barcodes));
        fd.append('result', data.result);
        if (data.remarks) fd.append('remarks', data.remarks);
        data.images.forEach(f => fd.append('images', f));
        return uploadForm<any>('/qc/bulk', fd);
      }
      return request<any>('/qc/bulk', {
        method: 'POST',
        body: JSON.stringify({ barcodes: data.barcodes, result: data.result, remarks: data.remarks }),
      });
    },
    reopenFailedBatch: (id: number, reason: string) =>
      request<any>(`/qc/batches/${id}/reopen`, { method: 'POST', body: JSON.stringify({ reason }) }),
    qrJobs: {
      list: (q?: string) => request<{ items: any[]; total: number }>(`/qc/qr-jobs${q ? `?q=${encodeURIComponent(q)}` : ''}`),
      create: (data: { product_id: number; quantity: number }) =>
        request<any>('/qc/qr-jobs', { method: 'POST', body: JSON.stringify(data) }),
      get: (id: number) => request<any>(`/qc/qr-jobs/${id}`),
      reprint: (id: number, data: { quantity?: number; label_ids?: number[] }) =>
        request<any>(`/qc/qr-jobs/${id}/reprint`, { method: 'POST', body: JSON.stringify(data) }),
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
    submit: (data: { barcode_value: string; remarks?: string; images?: File[]; expected_status?: string; direct?: boolean }) => {
      if (data.images && data.images.length > 0) {
        const fd = new FormData();
        fd.append('barcode_value', data.barcode_value);
        if (data.remarks) fd.append('remarks', data.remarks);
        if (data.expected_status) fd.append('expected_status', data.expected_status);
        if (data.direct) fd.append('direct', 'true');
        data.images.forEach(f => fd.append('images', f));
        return uploadForm<any>('/dispatch', fd);
      }
      return request<any>('/dispatch', { method: 'POST', body: JSON.stringify(data) });
    },
    submitBulk: (data: { barcodes: string[]; remarks?: string; images?: File[]; direct?: boolean; dispatch_order_id?: number }) => {
      if (data.images && data.images.length > 0) {
        const fd = new FormData();
        fd.append('barcodes', JSON.stringify(data.barcodes));
        if (data.remarks) fd.append('remarks', data.remarks);
        if (data.direct) fd.append('direct', 'true');
        if (data.dispatch_order_id) fd.append('dispatch_order_id', String(data.dispatch_order_id));
        data.images.forEach(f => fd.append('images', f));
        return uploadForm<any>('/dispatch/bulk', fd);
      }
      return request<any>('/dispatch/bulk', {
        method: 'POST',
        body: JSON.stringify({
          barcodes: data.barcodes,
          remarks: data.remarks,
          direct: data.direct,
          dispatch_order_id: data.dispatch_order_id,
        }),
      });
    },
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
    raise: (data: { batch_id?: number; barcode_value?: string; expected_status?: string; client_id: number; driver_name: string; vehicle_number: string; container_number: string }) =>
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
    approve: (id: number, remarks?: string) =>
      request<any>(`/dispatch-orders/${id}/approve`, { method: 'POST', body: JSON.stringify({ admin_remarks: remarks }) }),
    reject: (id: number, remarks?: string) =>
      request<any>(`/dispatch-orders/${id}/reject`, { method: 'POST', body: JSON.stringify({ admin_remarks: remarks }) }),
    packingList: (id: number) =>
      request<any>(`/dispatch-orders/${id}/packing-list`),
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
    update: (id: number, data: any) => request<any>(`/shelf-locations/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    delete: (id: number) => request<any>(`/shelf-locations/${id}`, { method: 'DELETE' }),
  },
  clients: {
    list: () => request<any[]>('/clients'),
    create: (data: any) =>
      request<any>('/clients', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: number, data: any) => request<any>(`/clients/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    delete: (id: number) => request<any>(`/clients/${id}`, { method: 'DELETE' }),
  },
  production: {
    batches: () => request<any[]>('/production/batches'),
    submitForQc: (barcode_value: string) =>
      request<any>('/production/submit-for-qc', { method: 'POST', body: JSON.stringify({ barcode_value }) }),
    fixBatch: (batch_id: number, description: string) =>
      request<any>('/production/fix-batch', { method: 'POST', body: JSON.stringify({ batch_id, description }) }),
    fixRecords: () => request<any[]>('/production/fix-records'),
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
