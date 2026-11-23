/**
 * Centralized API client. Every backend request goes through `apiRequest`.
 * The base URL comes from EXPO_PUBLIC_API_URL and must include the /api prefix.
 */

const BASE_URL = (process.env.EXPO_PUBLIC_API_URL ?? '').replace(/\/+$/, '');

export interface ApiRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  token?: string | null;
  divisionId?: string | null;
  signal?: AbortSignal;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly details?: unknown;

  constructor(status: number, message: string, code?: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function getApiBaseUrl(): string {
  return BASE_URL;
}

export async function apiRequest<T>(
  path: string,
  options: ApiRequestOptions = {},
): Promise<T> {
  if (!BASE_URL) {
    throw new ApiError(0, 'EXPO_PUBLIC_API_URL is not configured.');
  }

  const headers: Record<string, string> = {
    Accept: 'application/json',
  };
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  if (options.token) {
    headers.Authorization = `Bearer ${options.token}`;
  }
  if (options.divisionId) {
    headers['X-Division-Id'] = options.divisionId;
  }

  let response: Response;
  try {
    response = await fetch(`${BASE_URL}${path}`, {
      method: options.method ?? 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal,
    });
  } catch (cause) {
    throw new ApiError(0, 'Network request failed.', undefined, cause);
  }

  const text = await response.text();
  let payload: unknown = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      throw new ApiError(response.status, 'Invalid JSON response from server.');
    }
  }

  if (!response.ok) {
    const errorPayload = payload as { error?: string; code?: string } | null;
    throw new ApiError(
      response.status,
      errorPayload?.error ?? `Request failed with status ${response.status}`,
      errorPayload?.code,
      payload,
    );
  }

  return payload as T;
}
