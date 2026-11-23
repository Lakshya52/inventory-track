import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { PropsWithChildren } from 'react';

import { authService } from '@/services/auth/authService';
import { sessionStore } from '@/services/auth/sessionStore';
import type { AuthCredentials } from '@/services/auth/types';
import type { Session, UserRole } from '@/types/auth';

interface AuthContextValue {
  session: Session | null;
  isLoading: boolean;
  signIn: (credentials: AuthCredentials) => Promise<Session>;
  signOut: () => Promise<void>;
  refreshSession: () => Promise<Session | null>;
  hasRole: (role: UserRole) => boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: PropsWithChildren) {
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const applySession = useCallback((next: Session | null) => {
    setSession(next);
    sessionStore.set(next);
  }, []);

  useEffect(() => {
    let active = true;
    console.log('[mobile4] restoring session');

    const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), 4000));

    Promise.race([authService.restoreSession().catch(() => null), timeout]).then((restored) => {
      console.log('[mobile4] session restored:', restored?.user.role ?? null);
      if (active) {
        applySession(restored);
        setIsLoading(false);
      }
    });

    return () => {
      active = false;
    };
  }, [applySession]);

  // The API layer calls this when a request receives 401. It rotates the
  // refresh token and keeps React state, storage and the store in sync.
  useEffect(() => {
    sessionStore.setRefreshHandler(async (current) => {
      if (!current.refreshToken) return null;
      try {
        const next = await authService.refresh(current);
        applySession(next);
        return next;
      } catch {
        await authService.signOut();
        applySession(null);
        return null;
      }
    });
    return () => sessionStore.setRefreshHandler(null);
  }, [applySession]);

  const signIn = useCallback(
    async (credentials: AuthCredentials) => {
      const next = await authService.signIn(credentials);
      applySession(next);
      return next;
    },
    [applySession],
  );

  const signOut = useCallback(async () => {
    await authService.signOut();
    applySession(null);
  }, [applySession]);

  const refreshSession = useCallback(async () => sessionStore.refresh(), []);

  const hasRole = useCallback((role: UserRole) => session?.user.role === role, [session]);

  const value = useMemo(
    () => ({ session, isLoading, signIn, signOut, refreshSession, hasRole }),
    [session, isLoading, signIn, signOut, refreshSession, hasRole],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) {
    throw new Error('useAuth must be used inside <AuthProvider>.');
  }
  return value;
}
