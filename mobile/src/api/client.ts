import { API_URL, REQUEST_TIMEOUT_MS } from '../config';
import type {
  AuthSession,
  Batch,
  SyncPullResponse,
  SyncPushResponse,
  User,
} from '../types';

export class ApiError extends Error {
  status: number;
  body: any;

  constructor(message: string, status = 0, body: any = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

let currentSession: AuthSession | null = null;
let sessionUpdateHandler: ((session: AuthSession) => Promise<void> | void) | null = null;

export function setApiSession(session: AuthSession | null): void {
  currentSession = session;
}

export function setSessionUpdateHandler(
  handler: ((session: AuthSession) => Promise<void> | void) | null
): void {
  sessionUpdateHandler = handler;
}

async function parseResponse(response: Response): Promise<any> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function rawRequest(
  path: string,
  options: RequestInit = {},
  token?: string | null
): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const isFormData = typeof FormData !== 'undefined' && options.body instanceof FormData;
  const headers: Record<string, string> = {
    ...(isFormData ? {} : { 'content-type': 'application/json' }),
    ...(options.headers as Record<string, string> | undefined),
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  try {
    const response = await fetch(`${API_URL}${path}`, {
      ...options,
      headers,
      signal: controller.signal,
    });
    const body = await parseResponse(response);
    if (!response.ok) {
      const message =
        (body && typeof body === 'object' && (body.error || body.message)) ||
        (typeof body === 'string' && body) ||
        `Request failed (${response.status})`;
      throw new ApiError(String(message), response.status, body);
    }
    return body;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if ((error as any)?.name === 'AbortError') {
      throw new ApiError('The server took too long to respond. Your work is saved offline.', 0);
    }
    throw new ApiError('Server unreachable. Your work is saved offline and will sync later.', 0);
  } finally {
    clearTimeout(timer);
  }
}

async function refreshSession(): Promise<AuthSession> {
  if (!currentSession?.refreshToken) {
    throw new ApiError('Session expired. Please sign in again.', 401);
  }
  const body = await rawRequest('/api/auth/refresh', {
    method: 'POST',
    body: JSON.stringify({ refreshToken: currentSession.refreshToken }),
  });
  const next: AuthSession = {
    ...currentSession,
    token: body.token,
    refreshToken: body.refreshToken,
    refreshExpiresAt: body.refreshExpiresAt,
    user: body.user || currentSession.user,
  };
  currentSession = next;
  if (sessionUpdateHandler) await sessionUpdateHandler(next);
  return next;
}

async function request<T>(
  path: string,
  options: RequestInit = {},
  retryOnUnauthorized = true
): Promise<T> {
  try {
    return (await rawRequest(path, options, currentSession?.token)) as T;
  } catch (error) {
    if (
      error instanceof ApiError &&
      error.status === 401 &&
      retryOnUnauthorized &&
      currentSession?.refreshToken
    ) {
      await refreshSession();
      return (await rawRequest(path, options, currentSession?.token)) as T;
    }
    throw error;
  }
}

export const api = {
  async login(email: string, password: string, deviceUuid: string): Promise<AuthSession> {
    const body = await rawRequest('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password, device_uuid: deviceUuid }),
    });
    const session: AuthSession = {
      token: body.token,
      refreshToken: body.refreshToken,
      refreshExpiresAt: body.refreshExpiresAt,
      user: body.user as User,
    };
    currentSession = session;
    return session;
  },

  async me(): Promise<User & { is_active: number }> {
    return request<User & { is_active: number }>('/api/auth/me');
  },

  async logout(): Promise<void> {
    try {
      await request('/api/auth/logout', {
        method: 'POST',
        body: JSON.stringify({ refreshToken: currentSession?.refreshToken }),
      });
    } catch {
      // Local sign-out must work even if the network is down.
    }
  },

  async registerDevice(deviceUuid: string): Promise<void> {
    await request('/api/sync/register', {
      method: 'POST',
      body: JSON.stringify({
        device_uuid: deviceUuid,
        platform: 'mobile',
        app_version: '1.0.0',
      }),
    });
  },

  async push(
    deviceUuid: string,
    operations: { operation_id: string; type: string; payload: any; client_timestamp: string }[]
  ): Promise<SyncPushResponse> {
    return request<SyncPushResponse>('/api/sync/push', {
      method: 'POST',
      body: JSON.stringify({ device_uuid: deviceUuid, operations }),
    });
  },

  async pull(since: number, deviceUuid: string, limit = 500): Promise<SyncPullResponse> {
    return request<SyncPullResponse>(
      `/api/sync/pull?since=${encodeURIComponent(String(since))}&limit=${limit}&device_uuid=${encodeURIComponent(deviceUuid)}`
    );
  },

  async uploadAttachments(uris: string[]): Promise<string[]> {
    if (uris.length === 0) return [];
    const form = new FormData();
    uris.forEach((uri, index) => {
      const name = uri.split('/').pop() || `photo-${Date.now()}-${index}.jpg`;
      const lower = name.toLowerCase();
      const type = lower.endsWith('.png') ? 'image/png' : 'image/jpeg';
      form.append('images', { uri, name, type } as any);
    });

    const body = await request<{ files?: { filename: string }[] }>('/api/sync/attachments', {
      method: 'POST',
      body: form,
    });
    return (body.files || []).map((file) => String(file.filename));
  },

  async batchByBarcode(barcode: string): Promise<Batch> {
    return request<Batch>(`/api/batches/barcode/${encodeURIComponent(barcode)}`);
  },

  async health(): Promise<{ status: string; database: string }> {
    return rawRequest('/api/health');
  },
};
