import { Redirect } from 'expo-router';
import type { PropsWithChildren } from 'react';

import { roleHomeHref, useRole } from '@/context/role-context';
import type { Role } from '@/types';

type RoleGuardProps = PropsWithChildren<{
  /** The role this route group is allowed to render. */
  role: Role;
}>;

/**
 * Keeps each tab group private and role-specific.
 * Unauthenticated users go to login; signed-in users are sent to their own group.
 */
export function RoleGuard({ role, children }: RoleGuardProps) {
  const { user, isRestoring } = useRole();

  if (isRestoring) return null;
  if (!user) return <Redirect href="/login" />;
  if (user.role !== role) return <Redirect href={roleHomeHref[user.role]} />;

  return <>{children}</>;
}
