import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../services/api';
import {
  Activity,
  AlertTriangle,
  CheckCircle,
  Clock,
  Loader2,
  Package,
  RefreshCw,
  Truck,
  User,
  XCircle,
  QrCode,
  Radio,
} from 'lucide-react';

type EventResult = 'OK' | 'DUPLICATE' | 'WRONG_BATCH' | 'UNKNOWN';

const EVENT_STYLES: Record<EventResult, {
  label: string;
  badgeBg: string;
  badgeText: string;
  borderColor: string;
  panelBg: string;
}> = {
  OK: {
    label: 'Bag Counted (OK)',
    badgeBg: 'bg-emerald-100 text-emerald-800 border-emerald-300',
    badgeText: 'text-emerald-700',
    borderColor: 'border-l-emerald-500',
    panelBg: 'bg-emerald-50/70 border-emerald-200 text-emerald-900',
  },
  DUPLICATE: {
    label: 'Duplicate Warning (Already Scanned)',
    badgeBg: 'bg-amber-100 text-amber-900 border-amber-300',
    badgeText: 'text-amber-700',
    borderColor: 'border-l-amber-500',
    panelBg: 'bg-amber-50/80 border-amber-200 text-amber-950',
  },
  WRONG_BATCH: {
    label: 'Wrong Batch Alert (Foreign QR)',
    badgeBg: 'bg-rose-100 text-rose-900 border-rose-300',
    badgeText: 'text-rose-700',
    borderColor: 'border-l-rose-500',
    panelBg: 'bg-rose-50/80 border-rose-200 text-rose-950',
  },
  UNKNOWN: {
    label: 'Ready for First Scan',
    badgeBg: 'bg-slate-100 text-slate-700 border-slate-300',
    badgeText: 'text-slate-600',
    borderColor: 'border-l-slate-400',
    panelBg: 'bg-slate-50 border-slate-200 text-slate-700',
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
  return Number.isNaN(date.getTime()) ? '-' : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function formatDateTime(value?: string | null): string {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString(undefined, {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
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
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* 1. PAGE HEADER */}
      <div className="bg-white rounded-2xl border-2 border-slate-200 p-5 sm:p-6 shadow-xs flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-emerald-100 text-emerald-800 flex items-center justify-center">
              <Radio size={24} className="animate-pulse" />
            </div>
            <div>
              <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
                Live Truck Loading Monitor
              </h1>
              <p className="text-sm sm:text-base text-slate-500 mt-0.5">
                Real-time scanning counter as warehouse staff load bags onto dispatch trucks.
              </p>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 shrink-0">
          <span className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full text-xs sm:text-sm font-bold bg-emerald-100 text-emerald-800 border border-emerald-300">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
            Live · Refreshes every 2s
          </span>

          <button
            onClick={() => void load(true)}
            disabled={refreshing}
            className="inline-flex items-center gap-2 px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-800 text-sm font-bold rounded-xl transition-colors border border-slate-200"
          >
            <RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} />
            <span>Refresh Now</span>
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-2xl border-2 border-rose-200 bg-rose-50 p-4 text-sm font-medium text-rose-800 flex items-center gap-3">
          <AlertTriangle size={20} className="text-rose-600 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* 2. SUMMARY & SCAN LEGEND (Large, readable) */}
      <div className="bg-white rounded-2xl border-2 border-slate-200 p-4 sm:p-5 shadow-xs flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm font-bold text-slate-700">Scan Results:</span>
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs sm:text-sm font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
            <CheckCircle size={15} /> OK — Bag Counted
          </span>
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs sm:text-sm font-bold bg-amber-100 text-amber-900 border border-amber-200">
            <AlertTriangle size={15} /> Duplicate — Already Counted
          </span>
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs sm:text-sm font-bold bg-rose-100 text-rose-900 border border-rose-200">
            <XCircle size={15} /> Wrong Batch — Reject
          </span>
        </div>

        {sortedSessions.length > 0 && (
          <div className="flex items-center gap-3 shrink-0">
            <span className="text-sm font-bold px-3 py-1 bg-blue-100 text-blue-900 rounded-lg">
              {sortedSessions.length} Truck{sortedSessions.length === 1 ? '' : 's'} Loading
            </span>
            <span className="text-sm font-bold px-3 py-1 bg-slate-100 text-slate-800 rounded-lg">
              Total: {totalScanned} / {totalUnits} Bags
            </span>
          </div>
        )}
      </div>

      {/* 3. ACTIVE SESSIONS LIST */}
      {loading && sortedSessions.length === 0 ? (
        <div className="bg-white rounded-2xl border-2 border-slate-200 flex h-64 items-center justify-center p-6 shadow-xs">
          <span className="flex items-center gap-3 text-base font-semibold text-slate-500">
            <Loader2 size={22} className="animate-spin text-brand-600" /> Connecting to loading docks...
          </span>
        </div>
      ) : sortedSessions.length === 0 ? (
        <div className="bg-white rounded-2xl border-2 border-slate-200 p-12 text-center shadow-xs">
          <div className="w-16 h-16 rounded-full bg-slate-100 text-slate-400 flex items-center justify-center mx-auto mb-3">
            <Truck size={32} />
          </div>
          <h2 className="text-xl font-bold text-slate-800">
            No trucks are currently loading at the dock
          </h2>
          <p className="text-base text-slate-500 mt-1 max-w-md mx-auto">
            When dispatch workers start scanning bags for an approved order, the live counter and bag progress bar will appear here in real-time.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
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
              <div
                key={sessionKey}
                className={`bg-white rounded-2xl border-2 border-slate-200 border-l-8 ${style.borderColor} p-6 shadow-xs space-y-4`}
              >
                {/* Truck / Order Header */}
                <div className="flex flex-wrap items-start justify-between gap-3 pb-3 border-b border-slate-100">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-3">
                      <div className="w-11 h-11 rounded-xl bg-brand-100 text-brand-700 flex items-center justify-center shrink-0">
                        <Package size={22} />
                      </div>
                      <div className="min-w-0">
                        <h2 className="text-lg font-bold text-slate-900 truncate">{productName}</h2>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="font-mono text-xs font-bold px-2 py-0.5 rounded bg-slate-100 text-slate-800 border border-slate-200">
                            Batch: {batchNumber}
                          </span>
                          <span className="text-xs font-semibold px-2 py-0.5 rounded bg-blue-100 text-blue-800">
                            Order #{orderId}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>

                  <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800 border border-emerald-300">
                    <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                    LOADING IN PROGRESS
                  </span>
                </div>

                {/* Big Counter Box */}
                <div className="rounded-2xl bg-slate-50 border border-slate-200 p-4 sm:p-5 flex items-center justify-between">
                  <div>
                    <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                      Bags Loaded
                    </span>
                    <div className="text-3xl sm:text-4xl font-black text-slate-900 font-mono mt-0.5">
                      {scanned} <span className="text-slate-400 font-normal">/</span> {total}
                    </div>
                  </div>

                  <div className="text-right">
                    <div className={`text-3xl font-black ${percent >= 100 ? 'text-emerald-600' : 'text-brand-600'}`}>
                      {percent}%
                    </div>
                    <span className="text-xs font-bold text-slate-500 uppercase">
                      {percent >= 100 ? 'Completed' : 'Loaded'}
                    </span>
                  </div>
                </div>

                {/* Progress Bar */}
                <div className="h-4 w-full overflow-hidden rounded-full bg-slate-200">
                  <div
                    className={`h-full rounded-full transition-all duration-300 ${percent >= 100 ? 'bg-emerald-600' : 'bg-brand-600'}`}
                    style={{ width: `${percent}%` }}
                  />
                </div>

                {/* Session Info */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm text-slate-600 pt-1">
                  <div className="flex items-center gap-2">
                    <User size={16} className="text-slate-400 shrink-0" />
                    <span>Worker: <strong className="text-slate-800 font-bold">{loaderName}</strong></span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Clock size={16} className="text-slate-400 shrink-0" />
                    <span>Started: <strong className="text-slate-800 font-medium">{formatDateTime(session?.started_at)}</strong></span>
                  </div>
                </div>

                {/* Latest Scan Event Box (High Visibility) */}
                <div className={`rounded-xl border-2 p-3.5 ${style.panelBg}`}>
                  <div className="flex items-center justify-between">
                    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-bold border ${style.badgeBg}`}>
                      {result === 'OK' && <CheckCircle size={14} />}
                      {result === 'DUPLICATE' && <AlertTriangle size={14} />}
                      {result === 'WRONG_BATCH' && <XCircle size={14} />}
                      {result === 'UNKNOWN' && <QrCode size={14} />}
                      {style.label}
                    </span>
                    <span className="text-xs font-semibold opacity-80">
                      {eventTime ? formatTime(eventTime) : 'Waiting'}
                    </span>
                  </div>

                  {qrValue && (
                    <div className="mt-2 text-xs font-mono truncate text-slate-700 bg-white/60 p-1.5 rounded border border-slate-200/50">
                      Tag: {qrValue}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
