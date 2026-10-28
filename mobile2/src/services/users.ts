import { apiRequest } from './api';

export type UserRole = 'ADMIN' | 'QC' | 'DISPATCH';

export type AppUser = {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  is_active: 0 | 1;
  created_at: string;
};

/** Maps role enum → URL path segment used by the backend. */
const ROLE_PATH: Record<UserRole, string> = {
  ADMIN: 'admin',
  QC: 'qc',
  DISPATCH: 'dispatch',
};

export async function fetchAllUsers(): Promise<AppUser[]> {
  return apiRequest<AppUser[]>('/users');
}

export async function createUser(payload: {
  name: string;
  email: string;
  password: string;
  role: UserRole;
}): Promise<{ id: string }> {
  const typePath = ROLE_PATH[payload.role];
  return apiRequest(`/users/${typePath}`, {
    method: 'POST',
    body: { name: payload.name, email: payload.email, password: payload.password },
  });
}

export async function updateUser(
  id: string,
  role: UserRole,
  payload: { name: string; email: string },
): Promise<void> {
  const typePath = ROLE_PATH[role];
  await apiRequest(`/users/${typePath}/${id}`, { method: 'PUT', body: payload });
}

export async function deleteUser(id: string, role: UserRole): Promise<void> {
  const typePath = ROLE_PATH[role];
  await apiRequest(`/users/${typePath}/${id}`, { method: 'DELETE' });
}
