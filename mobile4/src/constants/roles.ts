import type { UserRole } from '@/types/auth';

export const ROLE_LABELS: Record<UserRole, string> = {
  ADMIN: 'Admin',
  QC: 'QC',
  DISPATCH: 'Dispatch',
};

export function isUserRole(value: unknown): value is UserRole {
  return value === 'ADMIN' || value === 'QC' || value === 'DISPATCH';
}
