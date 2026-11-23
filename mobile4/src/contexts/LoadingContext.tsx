import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import type { PropsWithChildren } from 'react';

import { domainApi } from '@/services/domain';
import type { ActiveSession } from '@/types/domain';

interface LoadingContextValue {
  sessions: ActiveSession[];
  activeSession: ActiveSession | null;
  isLoading: boolean;
  refresh: () => Promise<void>;
  selectSession: (id: string | null) => void;
  startSession: (orderId: string | number) => Promise<ActiveSession>;
}

const LoadingContext = createContext<LoadingContextValue | null>(null);

export function LoadingProvider({ children }: PropsWithChildren) {
  const [sessions, setSessions] = useState<ActiveSession[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await domainApi.activeSessions();
      setSessions(data);
      setActiveId((current) => (current && data.some((s) => s.id === current) ? current : (data[0]?.id ?? null)));
    } catch {
      setSessions([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const startSession = useCallback(
    async (orderId: string | number) => {
      const result = await domainApi.createLoadingSession(orderId);
      await refresh();
      setActiveId(result.session.id);
      return result.session;
    },
    [refresh],
  );

  const activeSession = useMemo(() => sessions.find((s) => s.id === activeId) ?? null, [sessions, activeId]);

  const value = useMemo(
    () => ({ sessions, activeSession, isLoading, refresh, selectSession: setActiveId, startSession }),
    [sessions, activeSession, isLoading, refresh, startSession],
  );

  return <LoadingContext.Provider value={value}>{children}</LoadingContext.Provider>;
}

export function useLoading(): LoadingContextValue {
  const value = useContext(LoadingContext);
  if (!value) throw new Error('useLoading must be used inside <LoadingProvider>.');
  return value;
}
