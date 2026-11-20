import type { Href } from 'expo-router';
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from 'react';

import { login, logout, restoreSession } from '@/services/auth';
import type { AuthUser } from '@/services/auth-types';
import type { AppUser, Role } from '@/types';

const backendRoleToAppRole: Record<AuthUser['role'], Role> = {
  ADMIN: 'admin',
  QC: 'qc',
  DISPATCH: 'dispatch',
};

export const roleHomeHref: Record<Role, Href> = {
  admin: '/(admin)/home' as Href,
  qc: '/(qc)/home' as Href,
  dispatch: '/(dispatch)/home' as Href,
};

function initialsFromName(name?: string): string {
  if (!name) return '';
  return name
    .split(' ')
    .filter(Boolean)
    .map((part) => part[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

export function toAppUser(authUser: AuthUser): AppUser {
  const role = backendRoleToAppRole[authUser.role] ?? 'admin';
  return {
    role,
    name: authUser.name?.trim() || role.toUpperCase(),
    email: authUser.email?.trim() || '',
    phone: authUser.phone,
    company: authUser.company,
    initials: initialsFromName(authUser.name),
  };
}

type RoleContextValue = {
  user: AppUser | null;
  role: Role;
  /** True while the saved session is being restored on app launch. */
  isRestoring: boolean;
  signIn: (email: string, password: string) => Promise<Role>;
  signOut: () => Promise<void>;
};

const RoleContext = createContext<RoleContextValue | null>(null);

export function RoleProvider({ children }: PropsWithChildren) {
  const [user, setUser] = useState<AppUser | null>(null);
  const [isRestoring, setIsRestoring] = useState(true);

  useEffect(() => {
    let active = true;

    restoreSession()
      .then((session) => {
        if (active && session) setUser(toAppUser(session.user));
      })
      .finally(() => {
        if (active) setIsRestoring(false);
      });

    return () => {
      active = false;
    };
  }, []);

  const value = useMemo<RoleContextValue>(
    () => ({
      user,
      role: user?.role ?? 'admin',
      isRestoring,
      signIn: async (email: string, password: string) => {
        const session = await login(email, password);
        const appUser = toAppUser(session.user);
        setUser(appUser);
        return appUser.role;
      },
      signOut: async () => {
        await logout();
        setUser(null);
      },
    }),
    [user, isRestoring],
  );

  return <RoleContext.Provider value={value}>{children}</RoleContext.Provider>;
}

export function useRole() {
  const value = useContext(RoleContext);
  if (!value) throw new Error('useRole must be used inside a RoleProvider');
  return value;
}
