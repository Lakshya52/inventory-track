import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../services/api';
import {
  Activity, AlertTriangle, CheckCircle, Clock, Loader2, Package,
  RefreshCw, Truck, User, XCircle, Camera,
} from 'lucide-react';

type EventResult = 'OK' | 'DUPLICATE' | 'WRONG_BATCH' | 'UNKNOWN';

const EVENT_STYLES: Record<EventResult, {
  label: string;
  badge: string;
  card: string;
  panel: string;
}> = {
  OK: {
    label: 'OK',
    badge: 'badge-success',
    card: 'border-l-emerald-400',
    panel: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  },
  DUPLICATE: {
    label: 'DUPLICATE',
    badge: 'badge-warning',
    card: 'border-l-amber-400',
    panel: 'border-amber-200 bg-amber-50 text-amber-700',
  },
  WRONG_BATCH: {
    label: 'WRONG_BATCH',
    badge: 'badge-danger',
    card: 'border-l-rose-400',
    panel: 'border-rose-200 bg-rose-50 text-rose-700',
  },
  UNKNOWN: {
    label: 'NO EVENT',
    badge: 'badge-neutral',
    card: 'border-l-surface-300',
    panel: 'border-surface-200 bg-surface-50 text-surface-600',
  },
};

function normalizeResult(value: unknown): EventResult {
  const result = String(value ?? '').toUpperCase();
  if (result === 'OK' || result === 'DUPLICATE' || result === 'WRONG_BATCH') return result;
  return 'UNKNOWN';
}

function timeValue(value?: string | null): number {
  if (!value) return 0;
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? 0 : time;
}

function formatTime(value?: string | null): string {
  if (!value) return '-';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '-' : date.toLocaleTimeString();
}

function formatDateTime(value?: string | null): string {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString(undefined, {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

function progressPercent(scanned: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((scanned / total) * 100)));
}

export default function LoadingMonitor() {
  const [sessions, setSessions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);
  const inFlightRef = useRef(false);
  const mountedRef = useRef(true);

  const load = useCallback(async (showSpinner = false) => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    if (showSpinner) setRefreshing(true);
    try {
      const data = await api.loadingSessions.active();
      if (!mountedRef.current) return;
      setSessions(Array.isArray(data) ? data : []);
      setError('');
      setLastRefreshed(new Date());
    } catch (err: any) {
      if (!mountedRef.current) return;
      setError(err?.message || 'Could not load active loading sessions.');
    } finally {
      inFlightRef.current = false;
      if (mountedRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    void load();
    const interval = window.setInterval(() => {
      void load();
    }, 2000);
    return () => {
      mountedRef.current = false;
      window.clearInterval(interval);
    };
  }, [load]);

  const sortedSessions = useMemo(
    () => [...sessions].sort((a, b) => timeValue(b?.updated_at) - timeValue(a?.updated_at)),
    [sessions]
  );

  const totalScanned = useMemo(
    () => sortedSessions.reduce((sum, session) => sum + Math.max(0, Number(session?.scanned ?? 0)), 0),
    [sortedSessions]
  );
  const totalUnits = useMemo(
    () => sortedSessions.reduce((sum, session) => sum + Math.max(0, Number(session?.total ?? 0)), 0),
    [sortedSessions]
  );

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1 className="page-title flex items-center gap-2">
            <Activity size={20} className="text-brand-500" /> Live Loading Monitor
          </h1>
          <p className="page-subtitle">Read-only live view of every active loading session</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="badge badge-success">
            <span className="mr-1.5 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
            Live · 2s
          </span>
          <span className="hidden text-xs text-surface-400 sm:inline">
            Last refreshed {lastRefreshed ? lastRefreshed.toLocaleTimeString() : '—'}
          </span>
          <button className="btn-secondary btn-sm" onClick={() => void load(true)} disabled={refreshing}>
            <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} /> Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex flex-wrap items-center gap-2 text-xs text-surface-500">
          <span className="font-semibold text-surface-600">Legend:</span>
          <span className="badge badge-success gap-1"><CheckCircle size={12} /> OK — unit counted</span>
          <span className="badge badge-warning gap-1"><AlertTriangle size={12} /> DUPLICATE — already scanned</span>
          <span className="badge badge-danger gap-1"><XCircle size={12} /> WRONG_BATCH — foreign label</span>
        </div>
        {sortedSessions.length > 0 && (
          <div className="ml-auto flex flex-wrap items-center gap-2 text-xs text-surface-500">
            <span className="badge badge-info">{sortedSessions.length} active session{sortedSessions.length === 1 ? '' : 's'}</span>
            <span className="badge badge-neutral">{totalScanned} / {totalUnits} units scanned</span>
          </div>
        )}
      </div>

      {loading && sortedSessions.length === 0 ? (
        <div className="card flex h-64 items-center justify-center p-6">
          <span className="flex items-center gap-2 text-sm text-surface-400">
            <Loader2 size={16} className="animate-spin" /> Loading active sessions...
          </span>
        </div>
      ) : sortedSessions.length === 0 ? (
        <div className="card">
          <div className="empty-state">
            <div className="empty-icon"><Truck size={28} className="text-surface-400" /></div>
            <div className="empty-title">No active loading sessions right now</div>
            <div className="empty-desc">
              When a dispatcher starts a loading session, the live scanned/total counter appears here within 2 seconds.
            </div>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          {sortedSessions.map((session, index) => {
            const sessionKey = String(session?.session_id ?? session?.id ?? index);
            const orderId = session?.order_id ?? session?.dispatch_order_id ?? '-';
            const batchNumber = session?.batch_number ?? session?.batch ?? '-';
            const productName = session?.product_name ?? session?.product ?? 'Product';
            const loaderName = session?.loader_name ?? session?.loader ?? '-';
            const scanned = Math.max(0, Number(session?.scanned ?? 0));
            const total = Math.max(0, Number(session?.total ?? 0));
            const percent = progressPercent(scanned, total);
            const lastEvent = session?.last_event || null;
            const result = normalizeResult(lastEvent?.result);
            const style = EVENT_STYLES[result];
            const qrValue = lastEvent?.qr_value ?? lastEvent?.qr ?? '';
            const eventTime = lastEvent?.scanned_at ?? lastEvent?.created_at ?? null;

            return (
              <div key={sessionKey} className={`card border-l-4 ${style.card} p-5`}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
                        <Package size={18} />
                      </div>
                      <div className="min-w-0">
                        <h2 className="truncate text-sm font-semibold text-surface-900">{productName}</h2>
                        <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                          <span className="rounded bg-surface-100 px-1.5 py-0.5 font-mono text-xs text-surface-700">
                            {batchNumber}
                          </span>
                          <span className="badge badge-info text-[10px]">Order #{orderId}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                  <span className="badge badge-success shrink-0">
                    <span className="mr-1.5 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
                    ACTIVE
                  </span>
                </div>

                <div className="mt-4 flex flex-wrap items-end justify-between gap-3 rounded-2xl bg-surface-50 p-4">
                  <div>
                    <div className="text-xs font-medium uppercase tracking-wider text-surface-500">Scanned / total</div>
                    <div className="mt-0.5 text-3xl font-bold tabular-nums text-surface-900">
                      {scanned} <span className="text-surface-400">/</span> {total}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className={`text-2xl font-bold ${percent >= 100 ? 'text-emerald-600' : 'text-brand-600'}`}>
                      {percent}%
                    </div>
                    <div className="text-xs text-surface-400">complete</div>
                  </div>
                </div>

                <div className="mt-3 h-2.5 w-full overflow-hidden rounded-full bg-surface-200">
                  <div
                    className={`h-full rounded-full transition-all duration-300 ${percent >= 100 ? 'bg-emerald-500' : 'bg-brand-500'}`}
                    style={{ width: `${percent}%` }}
                  />
                </div>

                <div className="mt-4 grid grid-cols-1 gap-2 text-xs sm:grid-cols-2">
                  <div className="flex items-center gap-2 text-surface-500">
                    <User size={13} className="shrink-0 text-surface-400" />
                    <span>Loader: <strong className="text-surface-700">{loaderName}</strong></span>
                  </div>
                  <div className="flex items-center gap-2 text-surface-500">
                    <Clock size={13} className="shrink-0 text-surface-400" />
                    <span>Updated: {formatDateTime(session?.updated_at)}</span>
                  </div>
                  <div className="flex items-center gap-2 text-surface-500 sm:col-span-2">
                    <Activity size={13} className="shrink-0 text-surface-400" />
                    <span>Started: {formatDateTime(session?.started_at)}</span>
                  </div>
                </div>

                <div className={`mt-4 rounded-xl border p-3 ${style.panel}`}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className={`badge gap-1 ${style.badge}`}>
                      {(result === 'DUPLICATE') && <AlertTriangle size={12} />}
                      {(result === 'WRONG_BATCH') && <XCircle size={12} />}
                      {(result === 'OK') && <CheckCircle size={12} />}
                      {(result === 'UNKNOWN') && <Camera size={12} />}
                      {style.label}
                    </span>
                    <span className="text-[11px] opacity-80">{formatTime(eventTime)}</span>
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <Camera size={13} className="shrink-0 opacity-70" />
                    <span className="truncate font-mono text-xs" title={String(qrValue || '')}>
                      {qrValue || (result === 'UNKNOWN' ? 'No scans yet' : '-')}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
