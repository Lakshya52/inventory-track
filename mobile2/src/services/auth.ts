import { apiRequest, setAccessToken } from './api';
import type { AuthSession, AuthUser } from './auth-types';
import { clearSession, loadSession, saveSession } from './storage';

export type { AuthSession, AuthUser, BackendRole } from './auth-types';

/** POST /auth/login — the backend checks admins, qc_users and dispatch_users. */
export async function login(email: string, password: string): Promise<AuthSession> {
  const session = await apiRequest<AuthSession>('/auth/login', {
    method: 'POST',
    body: { email: email.trim(), password },
  });

  setAccessToken(session.token);
  await saveSession(session);
  return session;
}

/** GET /auth/me — returns the signed-in account for the current bearer token. */
export async function fetchMe(): Promise<AuthUser> {
  return apiRequest<AuthUser>('/auth/me');
}

/**
 * Reads the saved session, revalidates the token with the backend and keeps the
 * cached user in sync. A stale or rejected token is cleared automatically.
 */
export async function restoreSession(): Promise<AuthSession | null> {
  const cached = await loadSession();
  if (!cached?.token) return null;

  setAccessToken(cached.token);

  try {
    const user = await fetchMe();
    const session: AuthSession = { ...cached, user: { ...cached.user, ...user } };
    await saveSession(session);
    return session;
  } catch {
    await clearSession();
    setAccessToken(null);
    return null;
  }
}

/** Best-effort server logout, then always clears the local session. */
export async function logout(): Promise<void> {
  try {
    await apiRequest('/auth/logout', { method: 'POST', body: {} });
  } catch {
    // The local session must be cleared even when the server is unreachable.
  } finally {
    await clearSession();
    setAccessToken(null);
  }
}
