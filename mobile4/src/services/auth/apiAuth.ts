import { apiRequest } from '@/services/api/client';
import { API_ENDPOINTS } from '@/services/api/endpoints';
import { isUserRole } from '@/constants/roles';
import { storage } from '@/services/storage';
import type { Session, User } from '@/types/auth';

import type { AuthCredentials, AuthService } from './types';

/**
 * Backend-backed authentication.
 *
 * Source of truth: backend/src/controllers/authController.*.ts
 * POST /api/auth/login    -> { token, refreshToken, refreshExpiresAt,
 *                              user: { id, tenantId, name, email, role } }
 * POST /api/auth/refresh  -> same shape, with a rotated refresh token
 * POST /api/auth/logout   -> { message: 'Signed out' }
 */
export interface LoginResponse {
  token: string;
  refreshToken?: string;
  refreshExpiresAt?: string;
  user: {
    id: string;
    tenantId?: string;
    name: string;
    email: string;
    role: string;
  };
}

function normalizeRole(role: string) {
  const normalized = role.toUpperCase();
  if (!isUserRole(normalized)) {
    throw new Error(`Unsupported role returned by backend: ${role}`);
  }
  return normalized;
}

export function sessionFromAuthResponse(response: LoginResponse): Session {
  const user: User = {
    id: response.user.id,
    name: response.user.name,
    email: response.user.email,
    role: normalizeRole(response.user.role),
    tenantId: response.user.tenantId,
  };
  return {
    token: response.token,
    user,
    refreshToken: response.refreshToken,
    refreshExpiresAt: response.refreshExpiresAt,
  };
}

async function persist(session: Session | null): Promise<void> {
  if (session) {
    await storage.set(storage.sessionKey, JSON.stringify(session));
  } else {
    await storage.remove(storage.sessionKey);
  }
}

export const apiAuthService: AuthService = {
  async signIn(credentials: AuthCredentials) {
    const response = await apiRequest<LoginResponse>(API_ENDPOINTS.auth.login, {
      method: 'POST',
      body: credentials,
    });
    const session = sessionFromAuthResponse(response);
    await persist(session);
    return session;
  },

  async refresh(session: Session) {
    if (!session.refreshToken) {
      throw new Error('No refresh token available.');
    }
    const response = await apiRequest<LoginResponse>(API_ENDPOINTS.auth.refresh, {
      method: 'POST',
      body: { refreshToken: session.refreshToken },
    });
    const next = sessionFromAuthResponse(response);
    await persist(next);
    return next;
  },

  async restoreSession() {
    const raw = await storage.get(storage.sessionKey);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as Session;
    } catch {
      await storage.remove(storage.sessionKey);
      return null;
    }
  },

  async signOut() {
    const raw = await storage.get(storage.sessionKey);
    if (raw) {
      try {
        const session = JSON.parse(raw) as Session;
        await apiRequest(API_ENDPOINTS.auth.logout, {
          method: 'POST',
          token: session.token,
          body: session.refreshToken ? { refreshToken: session.refreshToken } : {},
        });
      } catch {
        // Offline or expired session: still clear the local session.
      }
    }
    await persist(null);
  },
};
