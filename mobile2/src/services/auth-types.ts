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
