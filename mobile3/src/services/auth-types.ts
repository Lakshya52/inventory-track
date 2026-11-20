export type BackendRole = 'ADMIN' | 'QC' | 'DISPATCH';

export type AuthUser = {
  id?: number | string;
  name?: string;
  email?: string;
  phone?: string;
  company?: string;
  role: BackendRole;
};

export type AuthSession = {
  token: string;
  refreshToken?: string;
  refreshExpiresAt?: string;
  user: AuthUser;
};
