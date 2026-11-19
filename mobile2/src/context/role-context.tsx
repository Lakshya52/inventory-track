import type { Href } from 'expo-router';
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from 'react';

import { fetchTenant, login, logout, restoreSession } from '@/services/auth';
import type { AuthTenant, AuthUser } from '@/services/auth-types';
import type { AppUser, Role } from '@/types';

/**
 * Fallback profile data used for display fields the API does not return
 * (company, phone) and while the session is being restored.
 */
export const roleProfiles: Record<Role, AppUser> = {
  admin: {
    role: 'admin',
    name: 'Ram prakash yadav',
    email: 'asdf@gmail.com',
    phone: '+91 96696 96969',
    company: 'KLJ Polymers & Chemicals Limited',
    initials: 'RY',
  },
  qc: {
    role: 'qc',
    name: 'Neha Sharma',
    email: 'qc@klj.com',
    phone: '+91 98765 12480',
    company: 'KLJ Polymers & Chemicals Limited',
    initials: 'NS',
  },
  dispatch: {
    role: 'dispatch',
    name: 'Aarav Khan',
    email: 'dispatch@klj.com',
    phone: '+91 98765 44321',
    company: 'KLJ Polymers & Chemicals Limited',
    initials: 'AK',
  },
};

export const roleHomeHref: Record<Role, Href> = {
  admin: '/(admin)/home',
  qc: '/(qc)/home',
  dispatch: '/(dispatch)/home',
};

/** Settings stays reachable from the header, even when a role has only two tabs. */
export const roleSettingsHref: Record<Role, Href> = {
  admin: '/(admin)/settings',
  qc: '/(qc)/settings',
  dispatch: '/(dispatch)/settings',
};

const backendRoleToAppRole: Record<AuthUser['role'], Role> = {
  ADMIN: 'admin',
  QC: 'qc',
  DISPATCH: 'dispatch',
};

function initialsFromName(name: string): string {
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
  const fallback = roleProfiles[role];

  return {
    role,
    name: authUser.name?.trim() || fallback.name,
    email: authUser.email?.trim() || fallback.email,
    phone: authUser.phone?.trim() || fallback.phone,
    company: authUser.company?.trim() || fallback.company,
    initials: initialsFromName(authUser.name) || fallback.initials,
  };
}

type RoleContextValue = {
  user: AppUser | null;
  role: Role;
  /** Organization the signed-in account belongs to (name, logo). Null until loaded / signed out. */
  tenant: AuthTenant | null;
  /** True while the saved session is being restored on app launch. */
  isRestoring: boolean;
  signIn: (email: string, password: string) => Promise<Role>;
  signOut: () => Promise<void>;
  updateProfile: (values: Partial<AppUser>) => void;
  refreshTenant: () => Promise<void>;
};

const RoleContext = createContext<RoleContextValue | null>(null);

export function RoleProvider({ children }: PropsWithChildren) {
  const [user, setUser] = useState<AppUser | null>(null);
  const [tenant, setTenant] = useState<AuthTenant | null>(null);
  const [isRestoring, setIsRestoring] = useState(true);

  useEffect(() => {
    let active = true;

    restoreSession()
      .then((session) => {
        if (active && session) {
          setUser(toAppUser(session.user));
          // Tenant (organization name + logo) is a separate request; don't block session restore.
          fetchTenant()
            .then((nextTenant) => {
              if (active) setTenant(nextTenant);
            })
            .catch(() => {
              // The header falls back to cached profile data when the tenant cannot be loaded.
            });
        }
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
      tenant,
      isRestoring,
      signIn: async (email: string, password: string) => {
        const session = await login(email, password);
        const appUser = toAppUser(session.user);
        setUser(appUser);
        try {
          setTenant(await fetchTenant());
        } catch {
          // Login itself succeeded; leave the tenant unset and let the header fall back.
        }
        return appUser.role;
      },
      signOut: async () => {
        await logout();
        setUser(null);
        setTenant(null);
      },
      updateProfile: (values) =>
        setUser((current) => (current ? { ...current, ...values } : current)),
      refreshTenant: async () => {
        setTenant(await fetchTenant());
      },
    }),
    [user, tenant, isRestoring],
  );

  return <RoleContext.Provider value={value}>{children}</RoleContext.Provider>;
}

export function useRole() {
  const value = useContext(RoleContext);
  if (!value) {
    throw new Error('useRole must be used inside a RoleProvider');
  }
  return value;
}
