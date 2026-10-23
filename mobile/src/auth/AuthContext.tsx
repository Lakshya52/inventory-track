import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, setApiSession, setSessionUpdateHandler } from '../api/client';
import {
  clearSession,
  getDeviceId,
  loadSession,
  saveSession,
} from './authStorage';
import {
  clearAllData,
  getConflictCount,
  getMeta,
  getPendingOutboxCount,
  setMeta,
} from '../db/database';
import { initialSync } from '../sync/syncEngine';
import type { AuthSession } from '../types';

function sessionOwner(session: AuthSession): string {
  return `${session.user.role}:${session.user.id}`;
}

interface AuthContextValue {
  session: AuthSession | null;
  initializing: boolean;
  authError: string | null;
  login: (email: string, password: string) => Promise<AuthSession>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [initializing, setInitializing] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);

  useEffect(() => {
    setSessionUpdateHandler(async (next) => {
      await saveSession(next);
      await setMeta('local_owner', sessionOwner(next));
      setSession(next);
      setApiSession(next);
    });
    return () => setSessionUpdateHandler(null);
  }, []);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const stored = await loadSession();
        if (!stored) return;
        const storedOwner = await getMeta('local_owner');
        if (!storedOwner) await setMeta('local_owner', sessionOwner(stored));
        setApiSession(stored);
        setSession(stored);
        try {
          const me = await api.me();
          if (Number(me.is_active) !== 1) {
            throw Object.assign(new Error('Account is deactivated. Contact an administrator.'), { status: 403 });
          }
          const refreshed: AuthSession = {
            ...stored,
            user: {
              ...stored.user,
              name: me.name || stored.user.name,
              email: me.email || stored.user.email,
              role: (me as any).role || stored.user.role,
            },
          };
          await saveSession(refreshed);
          setApiSession(refreshed);
          if (mounted) setSession(refreshed);
        } catch (error: any) {
          // Offline restore is allowed. Only discard the session when the
          // server explicitly says it is invalid or the user was deactivated.
          if (error?.status === 401 || error?.status === 403) {
            await clearSession();
            setApiSession(null);
            if (mounted) {
              setSession(null);
              setAuthError(error.message || 'Session expired. Please sign in again.');
            }
          }
        }
      } finally {
        if (mounted) setInitializing(false);
      }
    })();
    return () => { mounted = false; };
  }, []);

  const login = useCallback(async (email: string, password: string): Promise<AuthSession> => {
    setAuthError(null);
    const deviceId = await getDeviceId();
    const next = await api.login(email.trim().toLowerCase(), password, deviceId);
    const owner = sessionOwner(next);
    const previousOwner = await getMeta('local_owner');
    const pending = await getPendingOutboxCount();

    // Re-authenticating as the same user must not wipe queued field work.
    // Only reset local data when the owner is known to be different, or when
    // there is no owner marker and no pending work to protect.
    if (previousOwner !== owner && (previousOwner || pending === 0)) {
      await clearAllData();
    }
    await setMeta('local_owner', owner);

    await saveSession(next);
    setApiSession(next);
    setSession(next);
    try {
      await initialSync(next);
    } catch {
      // The session is valid even if the first data pull fails. Sync will
      // retry automatically as soon as connectivity returns.
    }
    return next;
  }, []);

  const logout = useCallback(async (): Promise<void> => {
    const pending = await getPendingOutboxCount();
    const conflicts = await getConflictCount();
    if (pending + conflicts > 0) {
      throw new Error(
        `You have ${pending + conflicts} unsynced change${pending + conflicts === 1 ? '' : 's'}. Sync before signing out so no field work is lost.`
      );
    }
    await api.logout();
    await clearSession();
    setApiSession(null);
    setSession(null);
    await clearAllData();
  }, []);

  const value = useMemo(
    () => ({ session, initializing, authError, login, logout }),
    [session, initializing, authError, login, logout]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
}
