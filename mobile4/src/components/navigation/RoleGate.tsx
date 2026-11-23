import type { PropsWithChildren } from 'react';
import { Redirect } from 'expo-router';

import { ROLE_DASHBOARD_ROUTE, ROUTES } from '@/constants/routes';
import { useAuth } from '@/contexts/AuthContext';
import type { UserRole } from '@/types/auth';

interface RoleGateProps extends PropsWithChildren {
  allowedRole: UserRole;
}

/**
 * Defense-in-depth for role-specific layout groups. The primary protection
 * lives in the root navigator via Expo Router's <Stack.Protected>.
 */
export function RoleGate({ allowedRole, children }: RoleGateProps) {
  const { session, isLoading } = useAuth();

  if (isLoading) return null;

  if (!session) {
    return <Redirect href={ROUTES.login} />;
  }

  if (session.user.role !== allowedRole) {
    return <Redirect href={ROLE_DASHBOARD_ROUTE[session.user.role]} />;
  }

  return <>{children}</>;
}
