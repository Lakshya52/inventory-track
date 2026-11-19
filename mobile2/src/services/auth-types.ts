/** Roles exactly as the backend returns them. */
export type BackendRole = 'ADMIN' | 'QC' | 'DISPATCH';

export type AuthUser = {
  id: number | string;
  name: string;
  email: string;
  role: BackendRole;
  phone?: string | null;
  company?: string | null;
};

export type AuthSession = {
  token: string;
  refreshToken?: string;
  refreshExpiresAt?: string;
  user: AuthUser;
};

/** Organization (tenant) the signed-in account belongs to, as returned by GET /auth/tenant. */
export type AuthTenant = {
  id: number | string;
  name: string;
  email: string;
  phone: string;
  logoUrl: string | null;
  slug: string;
  updatedAt?: string | null;
};
