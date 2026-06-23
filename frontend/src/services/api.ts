const BASE_URL = '/api';

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
    login: (email: string, password: string) =>
      request<{ token: string; user: any }>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      }),
    me: () => request<any>('/auth/me'),
  },
  profile: {
    update: (data: { name?: string; currentPassword?: string; newPassword?: string }) =>
      request<any>('/profile', { method: 'PUT', body: JSON.stringify(data) }),
  },
  users: {
    list: (type: 'qc' | 'dispatch') => request<any[]>(`/users/${type}`),
    add: (type: 'qc' | 'dispatch', data: { name: string; email: string; password: string }) =>
      request<any>(`/users/${type}`, { method: 'POST', body: JSON.stringify(data) }),
    delete: (type: 'qc' | 'dispatch', id: number) =>
      request<any>(`/users/${type}/${id}`, { method: 'DELETE' }),
  },
  products: {
    list: () => request<any[]>('/products'),
    create: (data: any) =>
      request<any>('/products', { method: 'POST', body: JSON.stringify(data) }),
    search: (q: string) => request<any[]>(`/products/search?q=${encodeURIComponent(q)}`),
    update: (id: number, data: any) => request<any>(`/products/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    delete: (id: number) => request<any>(`/products/${id}`, { method: 'DELETE' }),
  },
  batches: {
    list: () => request<any[]>('/batches'),
    create: (data: any) =>
      request<any>('/batches', { method: 'POST', body: JSON.stringify(data) }),
    getByBarcode: (barcode: string) =>
      request<any>(`/batches/barcode/${encodeURIComponent(barcode)}`),
    search: (q: string) => request<any[]>(`/batches/search?q=${encodeURIComponent(q)}`),
  },
  qc: {
    submit: (data: { barcode_value: string; result: 'PASS' | 'FAIL'; remarks?: string }) =>
      request<any>('/qc', { method: 'POST', body: JSON.stringify(data) }),
  },
  dispatch: {
    submit: (data: { barcode_value: string; remarks?: string }) =>
      request<any>('/dispatch', { method: 'POST', body: JSON.stringify(data) }),
    today: () => request<any[]>('/dispatch/today'),
  },
  dashboard: {
    stats: () => request<any>('/dashboard'),
  },
  activity: {
    list: (page = 1, limit = 50) =>
      request<{ logs: any[]; total: number }>(`/activity?page=${page}&limit=${limit}`),
  },
};
