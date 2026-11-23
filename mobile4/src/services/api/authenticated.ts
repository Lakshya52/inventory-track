import { sessionStore } from '@/services/auth/sessionStore';

import { apiRequest, ApiError, type ApiRequestOptions } from './client';

/**
 * Request helper for protected endpoints. Attaches the current bearer token
 * automatically and, on 401, rotates the token once and retries the request.
 */
export async function authenticatedRequest<T>(
  path: string,
  options: ApiRequestOptions = {},
): Promise<T> {
  const token = sessionStore.get()?.token ?? null;

  try {
    return await apiRequest<T>(path, { ...options, token });
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      const refreshed = await sessionStore.refresh();
      if (refreshed) {
        return apiRequest<T>(path, { ...options, token: refreshed.token });
      }
    }
    throw error;
  }
}
