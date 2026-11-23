/**
 * Authentication domain types shared by mock and real authentication services.
 * Role strings mirror the backend role values documented in docs/BACKEND_ANALYSIS.md.
 */
export const USER_ROLES = ['ADMIN', 'QC', 'DISPATCH'] as const;

export type UserRole = (typeof USER_ROLES)[number];

export interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  /** Returned by POST /api/auth/login. */
  tenantId?: string;
}

export interface Session {
  /** Opaque AES-256-GCM token from the backend. Treat as a string, never decode. */
  token: string;
  user: User;
  /** Retained for the future refresh-token flow. */
  refreshToken?: string;
  refreshExpiresAt?: string;
}
