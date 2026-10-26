import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import NetInfo, { NetInfoState } from '@react-native-community/netinfo';
import { useAuth } from '../auth/AuthContext';
import { getConflictCount, getMeta, getPendingOutboxCount, discardOutboxOperation, retryOutbox } from '../db/database';
import { syncNow } from '../sync/syncEngine';
import { SYNC_INTERVAL_MS } from '../config';

interface SyncContextValue {
  online: boolean;
  syncing: boolean;
  lastSyncAt: string | null;
  pendingCount: number;
  conflictCount: number;
  error: string | null;
  sync: () => Promise<void>;
  refreshLocal: () => Promise<void>;
  retry: (operationId: string) => Promise<void>;
  dismiss: (operationId: string) => Promise<void>;
  clearError: () => void;
}

const SyncContext = createContext<SyncContextValue | null>(null);

function isOnline(state: NetInfoState): boolean {
  // This app syncs with a hosted backend. A connected Wi-Fi network without
  // internet access is still offline for sync purposes.
  return state.isConnected === true && state.isInternetReachable !== false;
}

export function SyncProvider({ children }: { children: React.ReactNode }) {
  const { session } = useAuth();
  // Wait for NetInfo's first result before starting API calls. Otherwise a
  // cold launch in airplane mode starts a sync that only fails after timeout.
  const [online, setOnline] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const [pendingCount, setPendingCount] = useState(0);
  const [conflictCount, setConflictCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const syncingRef = useRef(false);
  const runSyncRef = useRef<() => Promise<void>>(async () => undefined);

  const refreshLocal = useCallback(async () => {
    const [last, pending, conflicts] = await Promise.all([
      getMeta('last_sync_at'),
      getPendingOutboxCount(),
      getConflictCount(),
    ]);
    setLastSyncAt(last);
    setPendingCount(pending);
    setConflictCount(conflicts);
  }, []);

  const runSync = useCallback(async () => {
    if (!session || !online || syncingRef.current) return;
    syncingRef.current = true;
    setSyncing(true);
    setError(null);
    console.log('🔄 Sync started');
    try {
      await syncNow(session);
      console.log('✅ Sync completed');
    } catch (err: any) {
      console.error('❌ Sync error:', err);
      setError(err?.message || 'Sync failed. Your work remains queued on this device.');
    } finally {
      syncingRef.current = false;
      setSyncing(false);
      await refreshLocal();
    }
  }, [session, online, refreshLocal]);

  useEffect(() => {
    runSyncRef.current = runSync;
  }, [runSync]);

  useEffect(() => {
    let mounted = true;
    NetInfo.fetch()
      .then((state) => { if (mounted) setOnline(isOnline(state)); })
      .catch(() => undefined);
    const unsubscribe = NetInfo.addEventListener((state) => {
      const next = isOnline(state);
      setOnline(next);
      if (next) void runSyncRef.current();
    });
    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- load cached sync status when the provider mounts
    void refreshLocal();
    if (!session) return;
    void runSync();
    const timer = setInterval(() => { void runSyncRef.current(); }, SYNC_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [session, online, refreshLocal, runSync]);

  const retry = useCallback(async (operationId: string) => {
    await retryOutbox(operationId);
    await refreshLocal();
    await runSyncRef.current();
  }, [refreshLocal]);

  const dismiss = useCallback(async (operationId: string) => {
    await discardOutboxOperation(operationId);
    await refreshLocal();
    // Reconcile with the server in case a lost response hid a commit. If the
    // device is offline this is a no-op and the next pull will reconcile.
    await runSyncRef.current();
  }, [refreshLocal]);

  const value = useMemo(
    () => ({
      online,
      syncing,
      lastSyncAt,
      pendingCount,
      conflictCount,
      error,
      sync: runSync,
      refreshLocal,
      retry,
      dismiss,
      clearError: () => setError(null),
    }),
    [online, syncing, lastSyncAt, pendingCount, conflictCount, error, runSync, refreshLocal, retry, dismiss]
  );

  return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>;
}

export function useSync(): SyncContextValue {
  const context = useContext(SyncContext);
  if (!context) throw new Error('useSync must be used inside SyncProvider');
  return context;
}
