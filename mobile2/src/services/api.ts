import Constants from 'expo-constants';

/**
 * Backend origin + `/api` prefix.
 *
 * Set `EXPO_PUBLIC_API_URL` in `.env.local` to point at your server, for example:
 *   EXPO_PUBLIC_API_URL=http://localhost:3001/api
 *
 * When the variable is missing we fall back to the host Metro is served from,
 * which keeps physical devices working in local development.
 */
function resolveBaseUrl(): string {
  const configured = process.env.EXPO_PUBLIC_API_URL?.trim();
  if (configured) {
    return configured.replace(/\/+$/, '');
  }

  const metroHost = Constants.expoConfig?.hostUri?.split(':')[0];
  if (metroHost) {
    return `http://${metroHost}:3001/api`;
  }

  return 'http://localhost:3001/api';
}

export const API_BASE_URL = resolveBaseUrl();

let accessToken: string | null = null;

/** Kept in sync by the auth service after login, restore and logout. */
export function setAccessToken(token: string | null) {
  accessToken = token;
}

export function getAccessToken() {
  return accessToken;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

type RequestOptions = {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  headers?: Record<string, string>;
  token?: string | null;
  signal?: AbortSignal;
  timeoutMs?: number;
};

function buildHeaders(options: RequestOptions): Record<string, string> {
  const token = options.token === undefined ? accessToken : options.token;
  return {
    Accept: 'application/json',
    ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...options.headers,
  };
}

async function readBody(response: Response): Promise<unknown> {
  if (response.status === 204) return null;
  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    return response.json().catch(() => null);
  }
  return response.text();
}

function toApiError(payload: unknown, status: number): ApiError {
  if (payload && typeof payload === 'object' && 'error' in payload) {
    const record = payload as { error: unknown; code?: unknown };
    return new ApiError(
      String(record.error),
      status,
      typeof record.code === 'string' ? record.code : undefined,
    );
  }
  return new ApiError(`Request failed (${status})`, status);
}

/**
 * JSON request helper used by every role service.
 * Throws `ApiError` with a user-friendly message on network and HTTP errors.
 */
export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 20_000);
  const abort = () => controller.abort();

  options.signal?.addEventListener('abort', abort);

  try {
    const response = await fetch(`${API_BASE_URL}${path}`, {
      method: options.method ?? 'GET',
      headers: buildHeaders(options),
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: controller.signal,
    });

    const payload = await readBody(response);
    if (!response.ok) {
      throw toApiError(payload, response.status);
    }
    return payload as T;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error instanceof Error && error.name === 'AbortError') {
      throw new ApiError('The server took too long to respond. Please try again.', 0);
    }
    throw new ApiError('Cannot reach the server. Check your connection and API URL.', 0);
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener('abort', abort);
  }
}

/** Multipart helper for image/QR uploads that will be added to the QC and dispatch flows. */
export async function apiUpload<T>(
  path: string,
  formData: FormData,
  options: Omit<RequestOptions, 'body'> = {},
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 45_000);

  try {
    const token = options.token === undefined ? accessToken : options.token;
    const response = await fetch(`${API_BASE_URL}${path}`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...options.headers,
      },
      body: formData,
      signal: controller.signal,
    });

    const payload = await readBody(response);
    if (!response.ok) {
      throw toApiError(payload, response.status);
    }
    return payload as T;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error instanceof Error && error.name === 'AbortError') {
      throw new ApiError('The upload took too long. Please try again.', 0);
    }
    throw new ApiError('Cannot reach the server. Check your connection and API URL.', 0);
  } finally {
    clearTimeout(timeout);
  }
}
