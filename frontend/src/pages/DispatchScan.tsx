import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { BrowserMultiFormatReader } from '@zxing/library';
import { api } from '../services/api';
import {
  AlertTriangle, Camera, CheckCircle, ClipboardList, Clock, Loader2,
  PackageCheck, QrCode, RefreshCw, ShieldCheck, Truck, X, XCircle,
} from 'lucide-react';

const reader = new BrowserMultiFormatReader();

type ScanResult = 'OK' | 'DUPLICATE' | 'WRONG_BATCH' | 'QTY_EXCEEDED';
type MessageKind = 'success' | 'error' | 'warning' | 'info';
type Outcome = 'DISPATCHED' | 'NOT_DISPATCHED';

interface LoadingSession {
  id: string;
  status: string;
  total: number;
  scanned: number;
  dispatch_order_id: string;
  batch_id: string;
}

interface RecentScan {
  key: string;
  qr: string;
  result: ScanResult;
  at: string | null;
}

const MESSAGE_STYLES: Record<MessageKind, string> = {
  success: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  error: 'bg-rose-50 text-rose-700 border-rose-200',
  warning: 'bg-amber-50 text-amber-700 border-amber-200',
  info: 'bg-sky-50 text-sky-700 border-sky-200',
};

const RESULT_LABELS: Record<ScanResult, string> = {
  OK: 'OK',
  DUPLICATE: 'Duplicate',
  WRONG_BATCH: 'Wrong batch',
  QTY_EXCEEDED: 'Qty exceeded',
};

function operationId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    try {
      return crypto.randomUUID();
    } catch {
      // Fall through to the timestamp-based id below.
    }
  }
  return `op-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function resultBadge(result: string): string {
  if (result === 'OK') return 'badge-success';
  if (result === 'DUPLICATE') return 'badge-warning';
  return 'badge-danger';
}

function formatTime(value?: string | null): string {
  if (!value) return '-';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '-' : date.toLocaleTimeString();
}

function timeValue(value?: string | null): number {
  if (!value) return 0;
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? 0 : time;
}

function normalizeScanResult(value: unknown): ScanResult {
  const result = String(value ?? '').toUpperCase();
  if (result === 'DUPLICATE' || result === 'WRONG_BATCH' || result === 'QTY_EXCEEDED') return result;
  return 'OK';
}

function normalizeSession(raw: any, fallback?: any): LoadingSession {
  return {
    id: String(raw?.id ?? raw?.session_id ?? ''),
    status: String(raw?.status ?? 'ACTIVE'),
    total: Math.max(0, Number(raw?.total ?? fallback?.quantity ?? 0)),
    scanned: Math.max(0, Number(raw?.scanned ?? 0)),
    dispatch_order_id: String(raw?.dispatch_order_id ?? fallback?.id ?? ''),
    batch_id: String(raw?.batch_id ?? fallback?.batch_id ?? ''),
  };
}

function normalizeEvent(event: any, index: number): RecentScan {
  const at = event?.scanned_at ?? event?.created_at ?? null;
  return {
    key: String(event?.event_id ?? event?.id ?? `${at ?? 'event'}-${index}`),
    qr: String(event?.qr_value ?? event?.qr ?? ''),
    result: normalizeScanResult(event?.result),
    at: at ? String(at) : null,
  };
}

function percent(scanned: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((scanned / total) * 100)));
}

export default function DispatchScan() {
  const [orders, setOrders] = useState<any[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(true);
  const [orderSearch, setOrderSearch] = useState('');
  const [selectedOrderId, setSelectedOrderId] = useState('');
  const [session, setSession] = useState<LoadingSession | null>(null);
  const [starting, setStarting] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanBusy, setScanBusy] = useState(false);
  const [manualValue, setManualValue] = useState('');
  const [message, setMessage] = useState('');
  const [messageKind, setMessageKind] = useState<MessageKind>('info');
  const [recentScans, setRecentScans] = useState<RecentScan[]>([]);
  const [sealNumber, setSealNumber] = useState('');
  const [outcome, setOutcome] = useState<Outcome>('DISPATCHED');
  const [remarks, setRemarks] = useState('');
  const [finalising, setFinalising] = useState(false);
  const [finaliseResult, setFinaliseResult] = useState<any>(null);
  const [todayDispatches, setTodayDispatches] = useState<any[]>([]);
  const [searchParams, setSearchParams] = useSearchParams();

  const sessionIdRef = useRef<string | null>(null);
  const scanInFlightRef = useRef(false);
  const lastScanRef = useRef<{ qr: string; at: number }>({ qr: '', at: 0 });
  const scanHandlerRef = useRef<(qr: string) => void>(() => {});
  const deepLinkHandledRef = useRef(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    sessionIdRef.current = session?.id ?? null;
  }, [session?.id]);

  const stopCamera = useCallback(() => {
    try {
      reader.reset();
    } catch {
      // The decoder may already be reset.
    }
  }, []);

  useEffect(() => () => stopCamera(), [stopCamera]);

  const loadOrders = useCallback(async () => {
    setOrdersLoading(true);
    try {
      const list = await api.dispatchOrders.mine({ status: 'APPROVED' });
      setOrders(Array.isArray(list) ? list : []);
    } catch (err: any) {
      setMessageKind('error');
      setMessage(err?.message || 'Could not load approved dispatch orders. Please retry.');
    } finally {
      setOrdersLoading(false);
    }
  }, []);

  const loadToday = useCallback(async () => {
    try {
      setTodayDispatches(await api.dispatch.today());
    } catch {
      // Keep the last known list when the network is unavailable.
    }
  }, []);

  useEffect(() => {
    void loadOrders();
    void loadToday();
  }, [loadOrders, loadToday]);

  const selectedOrder = useMemo(
    () => orders.find((order) => String(order.id) === selectedOrderId) || null,
    [orders, selectedOrderId]
  );

  const filteredOrders = useMemo(() => {
    const needle = orderSearch.trim().toLowerCase();
    if (!needle) return orders;
    return orders.filter((order) =>
      [
        order.id, order.batch_number, order.product_name, order.client_name,
        order.driver_name, order.vehicle_number, order.container_number,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(needle))
    );
  }, [orders, orderSearch]);

  // Deep link support: /dispatch?order=<id>
  useEffect(() => {
    if (ordersLoading || deepLinkHandledRef.current) return;
    const requested = searchParams.get('order');
    if (!requested) return;
    deepLinkHandledRef.current = true;
    if (orders.some((order) => String(order.id) === requested)) {
      setSelectedOrderId(requested);
    } else {
      setMessageKind('info');
      setMessage(`Order #${requested} is not in your approved list. Choose another approved order below.`);
    }
    const next = new URLSearchParams(searchParams);
    next.delete('order');
    setSearchParams(next, { replace: true });
  }, [orders, ordersLoading, searchParams, setSearchParams]);

  const selectOrder = (id: string) => {
    if (session) return;
    setSelectedOrderId(id);
    setMessage('');
    setScanning(false);
    stopCamera();
  };

  const startSession = async () => {
    if (!selectedOrder) {
      setMessageKind('error');
      setMessage('Select an approved dispatch order before starting a loading session.');
      return;
    }
    setStarting(true);
    setMessage('');
    setFinaliseResult(null);
    try {
      const response = await api.loadingSessions.start(selectedOrder.id, operationId());
      const next = normalizeSession(response?.session ?? response, selectedOrder);
      if (!next.id) throw new Error('The server did not return a loading session id.');
      setSession(next);
      setRecentScans([]);
      setSealNumber('');
      setRemarks('');
      setOutcome('DISPATCHED');
      setMessageKind('success');
      setMessage(`Loading session started for order #${selectedOrder.id}. Scan each unit QR label.`);
    } catch (err: any) {
      // If the order already has an active session, resume it instead of failing.
      try {
        const active = await api.loadingSessions.active();
        const match = (Array.isArray(active) ? active : []).find(
          (item: any) => String(item.order_id ?? item.dispatch_order_id) === String(selectedOrder.id)
        );
        if (match) {
          const resumed = normalizeSession(match?.session ?? match, selectedOrder);
          if (resumed.id) {
            setSession(resumed);
            setRecentScans([]);
            setSealNumber('');
            setRemarks('');
            setOutcome('DISPATCHED');
            setMessageKind('info');
            setMessage(`Resumed the active loading session for order #${selectedOrder.id}.`);
            return;
          }
        }
      } catch {
        // Fall through to the original error message.
      }
      setMessageKind('error');
      setMessage(err?.message || 'Could not start the loading session.');
    } finally {
      setStarting(false);
    }
  };

  const doScan = useCallback(async (rawValue: string) => {
    const qrValue = rawValue.trim();
    const currentSessionId = sessionIdRef.current;
    if (!qrValue || !currentSessionId || scanInFlightRef.current) return;

    const now = Date.now();
    if (lastScanRef.current.qr === qrValue && now - lastScanRef.current.at < 2000) return;
    lastScanRef.current = { qr: qrValue, at: now };

    scanInFlightRef.current = true;
    setScanBusy(true);
    try {
      const response = await api.loadingSessions.scan(currentSessionId, qrValue, operationId());
      const result = normalizeScanResult(response?.result);
      const scanned = Number(response?.scanned ?? 0);
      const total = Number(response?.total ?? 0);

      setSession((prev) => {
        if (!prev || prev.id !== currentSessionId) return prev;
        return {
          ...prev,
          scanned: Number(response?.scanned ?? prev.scanned),
          total: Number(response?.total ?? prev.total),
        };
      });
      setRecentScans((prev) =>
        [
          {
            key: String(response?.event_id ?? `${Date.now()}-${qrValue}`),
            qr: qrValue,
            result,
            at: new Date().toISOString(),
          },
          ...prev,
        ].slice(0, 12)
      );

      if (result === 'OK') {
        setMessageKind('success');
        setMessage(`Scanned ${scanned}/${total} — unit added to this load.`);
      } else if (result === 'DUPLICATE') {
        setMessageKind('warning');
        setMessage('Already scanned — this QR is already counted in this session.');
      } else if (result === 'WRONG_BATCH') {
        setMessageKind('error');
        setMessage('Belongs to another batch — this QR cannot be loaded for the selected order.');
      } else {
        setMessageKind('error');
        setMessage(`Quantity exceeded — this order already has ${scanned}/${total} units scanned.`);
      }
      setManualValue('');
    } catch (err: any) {
      setMessageKind('error');
      setMessage(err?.message || 'Scan failed. Check the connection and try again.');
    } finally {
      scanInFlightRef.current = false;
      setScanBusy(false);
    }
  }, []);

  useEffect(() => {
    scanHandlerRef.current = (qr: string) => {
      void doScan(qr);
    };
  }, [doScan]);

  const submitManual = () => {
    const value = manualValue.trim();
    if (!value || !session || scanInFlightRef.current) return;
    setManualValue('');
    void doScan(value);
  };

  // Keep the active session in sync (including scans made from another device).
  useEffect(() => {
    const sessionId = session?.id;
    if (!sessionId || session?.status !== 'ACTIVE') return;
    let cancelled = false;

    const tick = async () => {
      if (scanInFlightRef.current) return;
      try {
        const data = await api.loadingSessions.get(sessionId);
        if (cancelled || scanInFlightRef.current) return;
        const raw = data?.session ?? data;
        setSession((prev) => {
          if (!prev || prev.id !== sessionId) return prev;
          return {
            ...prev,
            scanned: Math.max(0, Number(raw?.scanned ?? prev.scanned)),
            total: Math.max(0, Number(raw?.total ?? prev.total)),
            status: String(raw?.status ?? prev.status),
          };
        });
        const events: any[] = Array.isArray(data?.events) ? data.events : [];
        if (events.length > 0) {
          const mapped = events
            .map(normalizeEvent)
            .filter((event) => event.qr)
            .sort((a, b) => timeValue(b.at) - timeValue(a.at));
          setRecentScans(mapped.slice(0, 12));
        }
      } catch {
        // Keep the last known counter; the next poll retries.
      }
    };

    const interval = window.setInterval(() => {
      void tick();
    }, 2000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [session?.id, session?.status]);

  // Camera scanning. The handler reads live state through a ref so the camera
  // is not restarted on every counter update.
  useEffect(() => {
    if (!scanning) return;
    if (!session || session.status !== 'ACTIVE') {
      setScanning(false);
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setMessageKind('error');
      setMessage('Camera is not supported here. Use HTTPS or localhost, or enter the QR code manually.');
      setScanning(false);
      return;
    }
    const video = videoRef.current;
    if (!video) return;
    let cancelled = false;

    (async () => {
      try {
        await reader.decodeFromVideoDevice(null, video, (result) => {
          if (cancelled || !result) return;
          const text = result.getText().trim();
          if (text) scanHandlerRef.current(text);
        });
      } catch (err: any) {
        if (cancelled) return;
        setMessageKind('error');
        setMessage(
          err?.message?.includes?.('Permission')
            ? 'Camera permission denied. Allow camera access or enter the QR code manually.'
            : 'Camera could not start. Enter the QR code manually or try again.'
        );
        setScanning(false);
        stopCamera();
      }
    })();

    return () => {
      cancelled = true;
      stopCamera();
    };
  }, [scanning, session?.id, session?.status, stopCamera]);

  const toggleCamera = () => {
    if (scanning) {
      stopCamera();
      setScanning(false);
    } else {
      setMessage('');
      setScanning(true);
    }
  };

  const finalise = async () => {
    if (!session) return;
    if (!sealNumber.trim()) {
      setMessageKind('error');
      setMessage('Enter the seal number before finalising the loading session.');
      return;
    }
    setFinalising(true);
    setMessage('');
    try {
      const response = await api.loadingSessions.finalise(session.id, {
        seal_number: sealNumber.trim(),
        outcome,
        remarks: remarks.trim() || undefined,
        client_operation_id: operationId(),
      });
      setFinaliseResult(response ?? {});
      setMessageKind('success');
      setMessage(
        outcome === 'DISPATCHED'
          ? 'Loading session finalised. The order is marked dispatched.'
          : 'Loading session finalised. The order is marked NOT dispatched.'
      );
      setScanning(false);
      stopCamera();
      setSession(null);
      setSelectedOrderId('');
      setRecentScans([]);
      setSealNumber('');
      setRemarks('');
      setOutcome('DISPATCHED');
      const next = new URLSearchParams(searchParams);
      next.delete('order');
      setSearchParams(next, { replace: true });
      await Promise.all([loadOrders(), loadToday()]);
    } catch (err: any) {
      setMessageKind('error');
      setMessage(err?.message || 'Could not finalise the loading session. Please retry.');
    } finally {
      setFinalising(false);
    }
  };

  const scannedCount = session?.scanned ?? 0;
  const totalCount = session?.total ?? 0;
  const progress = percent(scannedCount, totalCount);
  const remaining = Math.max(0, totalCount - scannedCount);
  const shortfall = session ? scannedCount < totalCount : false;
  const MessageIcon =
    messageKind === 'success' ? CheckCircle
      : messageKind === 'error' ? XCircle
        : messageKind === 'warning' ? AlertTriangle
          : Clock;

  return (
    <div className="page-container max-w-5xl mx-auto">
      <div className="page-header">
        <div>
          <h1 className="page-title">Loading &amp; Scan</h1>
          <p className="page-subtitle">Start a loading session, scan every unit, then seal and finalise the dispatch.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link to="/dispatch-orders" className="btn-secondary btn-sm"><ClipboardList size={14} /> Dispatch Orders</Link>
          <Link to="/dispatch-dashboard" className="btn-secondary btn-sm"><Truck size={14} /> Dispatch Dashboard</Link>
        </div>
      </div>

      {message && (
        <div className={`mb-4 flex items-start gap-2 rounded-xl border p-3 text-sm ${MESSAGE_STYLES[messageKind]}`}>
          <MessageIcon size={16} className="mt-0.5 shrink-0" />
          <span>{message}</span>
          <button className="ml-auto shrink-0 opacity-60 hover:opacity-100" onClick={() => setMessage('')} aria-label="Dismiss message">
            <X size={14} />
          </button>
        </div>
      )}

      {!session && (
        <>
          {finaliseResult && (
            <div className="card mb-4 border border-emerald-200 bg-emerald-50/40 p-6">
              <div className="flex items-start gap-3">
                <CheckCircle size={22} className="mt-0.5 shrink-0 text-emerald-600" />
                <div className="min-w-0 flex-1">
                  <h2 className="section-title">Loading session finalised</h2>
                  <p className="mt-1 text-xs text-surface-500">
                    The seal and outcome were saved. Order and batch statuses now reflect the result.
                  </p>
                  <div className="mt-4 grid grid-cols-2 gap-3 text-xs md:grid-cols-4">
                    <div>
                      <div className="text-surface-500">Order</div>
                      <div className="font-medium text-surface-800">
                        #{finaliseResult?.session?.dispatch_order_id ?? finaliseResult?.order_id ?? '-'}
                      </div>
                    </div>
                    <div>
                      <div className="text-surface-500">Order status</div>
                      <div className="font-medium text-surface-800">{finaliseResult?.order_status ?? '-'}</div>
                    </div>
                    <div>
                      <div className="text-surface-500">Batch status</div>
                      <div className="font-medium text-surface-800">{finaliseResult?.batch_status ?? '-'}</div>
                    </div>
                    <div>
                      <div className="text-surface-500">Seal number</div>
                      <div className="font-mono font-medium text-surface-800">
                        {finaliseResult?.session?.seal_number ?? '-'}
                      </div>
                    </div>
                  </div>
                  <button className="btn-secondary btn-sm mt-4" onClick={() => setFinaliseResult(null)}>
                    Dismiss
                  </button>
                </div>
              </div>
            </div>
          )}

          <div className="card mb-4 p-6">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="section-title flex items-center gap-2">
                  <PackageCheck size={16} className="text-brand-500" /> Approved dispatch orders
                </h2>
                <p className="mt-1 text-xs text-surface-400">
                  Select the order you are loading. Only QC-approved orders appear here.
                </p>
              </div>
              <button className="btn-secondary btn-sm" onClick={() => void loadOrders()} disabled={ordersLoading}>
                <RefreshCw size={14} className={ordersLoading ? 'animate-spin' : ''} /> Refresh
              </button>
            </div>

            <input
              className="input mb-3 text-sm"
              placeholder="Search by order, product, batch, client, driver, vehicle or container"
              value={orderSearch}
              onChange={(event) => setOrderSearch(event.target.value)}
            />

            <div className="max-h-80 divide-y divide-surface-100 overflow-y-auto rounded-xl border border-surface-200 bg-white">
              {filteredOrders.map((order) => {
                const isSelected = String(order.id) === selectedOrderId;
                return (
                  <button
                    key={String(order.id)}
                    type="button"
                    onClick={() => selectOrder(String(order.id))}
                    className={`flex w-full flex-col gap-2 p-4 text-left transition-colors sm:flex-row sm:items-center sm:justify-between ${
                      isSelected ? 'border-l-4 border-l-brand-600 bg-brand-50' : 'hover:bg-surface-50'
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="truncate text-sm font-semibold text-surface-900">
                          {order.product_name || 'Dispatch order'}
                        </span>
                        <span className="badge badge-info text-[10px]">Order #{order.id}</span>
                        <span className="rounded bg-surface-100 px-1.5 py-0.5 font-mono text-xs text-surface-700">
                          {order.batch_number || '-'}
                        </span>
                      </div>
                      <div className="mt-1.5 grid grid-cols-1 gap-x-4 gap-y-1 text-xs text-surface-500 sm:grid-cols-2 lg:grid-cols-3">
                        <span>Client: <strong className="text-surface-700">{order.client_name || '-'}</strong></span>
                        <span>Quantity: <strong className="text-surface-700">{order.quantity ?? '-'} {order.uom || ''}</strong></span>
                        <span>Driver: {order.driver_name || '-'}</span>
                        <span>Vehicle: {order.vehicle_number || '-'}</span>
                        <span>Container: {order.container_number || '-'}</span>
                      </div>
                    </div>
                    <span className="badge badge-success shrink-0">Approved</span>
                  </button>
                );
              })}
              {filteredOrders.length === 0 && (
                <div className="p-8 text-center">
                  <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-surface-100">
                    <PackageCheck size={22} className="text-surface-400" />
                  </div>
                  <div className="text-sm font-semibold text-surface-700">
                    {ordersLoading
                      ? 'Loading approved orders...'
                      : orderSearch
                        ? 'No approved orders match that search'
                        : 'No approved dispatch orders waiting'}
                  </div>
                  <div className="mt-1 text-xs text-surface-400">
                    {ordersLoading
                      ? 'Please wait a moment.'
                      : orderSearch
                        ? 'Try a different order number, product or client.'
                        : 'QC must approve a dispatch order before loading can start.'}
                  </div>
                </div>
              )}
            </div>
          </div>

          {selectedOrder && (
            <div className="card mb-4 border-l-4 border-l-brand-500 p-6">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="min-w-0">
                  <h2 className="section-title">Ready to load order #{selectedOrder.id}</h2>
                  <p className="mt-1 text-sm text-surface-500">
                    {selectedOrder.product_name || 'Product'} · batch{' '}
                    <span className="font-mono text-surface-700">{selectedOrder.batch_number || '-'}</span> ·{' '}
                    {selectedOrder.quantity ?? '-'} {selectedOrder.uom || 'units'} to scan
                  </p>
                  <p className="mt-1 text-xs text-surface-400">
                    {selectedOrder.client_name || 'Client'} · driver {selectedOrder.driver_name || '-'} ·{' '}
                    {selectedOrder.vehicle_number || 'No vehicle'} · container {selectedOrder.container_number || '-'}
                  </p>
                </div>
                <button className="btn-primary" onClick={() => void startSession()} disabled={starting}>
                  {starting ? <Loader2 size={16} className="animate-spin" /> : <PackageCheck size={16} />}
                  {starting ? 'Starting...' : 'Start Loading Session'}
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {session && (
        <>
          <div className="card mb-4 p-6">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="section-title flex items-center gap-2">
                  <QrCode size={16} className="text-brand-500" /> Loading in progress
                </h2>
                <p className="mt-1 text-xs text-surface-400">
                  Order #{session.dispatch_order_id || selectedOrder?.id || '-'} · batch{' '}
                  <span className="font-mono">{selectedOrder?.batch_number || '-'}</span> ·{' '}
                  {selectedOrder?.client_name || 'Client'}
                </p>
              </div>
              <span className="badge badge-success">
                <span className="mr-1 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
                {session.status}
              </span>
            </div>

            <div className="mt-5 rounded-2xl bg-surface-50 p-5">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <div className="text-xs font-medium uppercase tracking-wider text-surface-500">Scanned / total</div>
                  <div className="mt-1 text-4xl font-bold tabular-nums text-surface-900">
                    {scannedCount} <span className="text-surface-400">/</span> {totalCount}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-2xl font-bold text-brand-600">{progress}%</div>
                  <div className="text-xs text-surface-400">complete</div>
                </div>
              </div>
              <div className="mt-4 h-3 w-full overflow-hidden rounded-full bg-surface-200">
                <div
                  className={`h-full rounded-full transition-all duration-300 ${progress >= 100 ? 'bg-emerald-500' : 'bg-brand-500'}`}
                  style={{ width: `${progress}%` }}
                />
              </div>
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-surface-500">
                <span>{remaining} unit{remaining === 1 ? '' : 's'} remaining</span>
                <span>Counters refresh every 2 seconds</span>
              </div>
            </div>

            <div className="mt-5 flex flex-col gap-2 sm:flex-row">
              <input
                className="input flex-1 font-mono text-sm"
                placeholder="Scan or type a unit QR code, then press Enter"
                value={manualValue}
                onChange={(event) => setManualValue(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') submitManual();
                }}
                disabled={scanBusy}
              />
              <button className="btn-secondary" onClick={submitManual} disabled={!manualValue.trim() || scanBusy}>
                {scanBusy ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle size={16} />}
                {scanBusy ? 'Checking...' : 'Add scan'}
              </button>
              <button className="btn-primary" onClick={toggleCamera}>
                <Camera size={16} /> {scanning ? 'Camera on' : 'Scan with camera'}
              </button>
            </div>

            {scanning && (
              <div className="mt-4 space-y-3">
                <div className="overflow-hidden rounded-xl bg-black">
                  <video
                    ref={videoRef}
                    style={{ width: '100%', height: '300px', objectFit: 'cover' }}
                    playsInline
                    muted
                  />
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="flex items-center gap-2 text-sm text-brand-600">
                    <Camera size={14} /> Keep scanning — the camera stays on between scans.
                  </span>
                  <button className="btn-secondary btn-sm" onClick={toggleCamera}>
                    <X size={14} /> Stop camera
                  </button>
                </div>
              </div>
            )}

            <div className="mt-5 overflow-hidden rounded-xl border border-surface-200">
              <div className="flex items-center justify-between border-b border-surface-100 bg-surface-50 px-4 py-3">
                <h3 className="text-sm font-semibold text-surface-800">Recent scans</h3>
                <span className="badge badge-neutral">{recentScans.length}</span>
              </div>
              <div className="max-h-60 divide-y divide-surface-100 overflow-y-auto">
                {recentScans.map((scan) => (
                  <div key={scan.key} className="flex items-center justify-between gap-3 px-4 py-2.5">
                    <div className="min-w-0">
                      <div className="truncate font-mono text-xs text-surface-700" title={scan.qr}>{scan.qr}</div>
                      <div className="text-[11px] text-surface-400">{formatTime(scan.at)}</div>
                    </div>
                    <span className={`badge shrink-0 ${resultBadge(scan.result)}`}>
                      {RESULT_LABELS[scan.result] || scan.result}
                    </span>
                  </div>
                ))}
                {recentScans.length === 0 && (
                  <div className="px-4 py-8 text-center text-xs text-surface-400">
                    No scans yet. Scan the first unit QR to begin.
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="card mb-6 p-6">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="section-title flex items-center gap-2">
                  <ShieldCheck size={16} className="text-indigo-500" /> Seal &amp; finalise
                </h2>
                <p className="mt-1 text-xs text-surface-400">
                  A seal number is required. Finalising closes the session and updates the order and batch.
                </p>
              </div>
              <span className={`badge ${shortfall ? 'badge-warning' : 'badge-success'}`}>
                {scannedCount}/{totalCount} scanned
              </span>
            </div>

            {shortfall && (
              <div className="mt-4 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-700">
                <AlertTriangle size={15} className="mt-0.5 shrink-0" />
                <span>
                  Only {scannedCount} of {totalCount} units are scanned. Finalising below total is allowed, but add
                  remarks explaining the shortfall.
                </span>
              </div>
            )}

            <div className="form-grid mt-4">
              <div>
                <label className="input-label" htmlFor="seal-number">Seal number *</label>
                <input
                  id="seal-number"
                  className="input font-mono"
                  placeholder="e.g. SEAL-2026-00123"
                  value={sealNumber}
                  onChange={(event) => setSealNumber(event.target.value)}
                  autoComplete="off"
                />
                {!sealNumber.trim() && (
                  <p className="mt-1 text-[11px] text-surface-400">Required before the session can be finalised.</p>
                )}
              </div>
              <div>
                <label className="input-label" htmlFor="outcome">Outcome</label>
                <select
                  id="outcome"
                  className="input"
                  value={outcome}
                  onChange={(event) => setOutcome(event.target.value as Outcome)}
                >
                  <option value="DISPATCHED">DISPATCHED — loaded and dispatched</option>
                  <option value="NOT_DISPATCHED">NOT DISPATCHED — loading not completed</option>
                </select>
              </div>
            </div>

            <div className="mt-4">
              <label className="input-label" htmlFor="remarks">
                Remarks {shortfall ? '(recommended for shortfall)' : '(optional)'}
              </label>
              <textarea
                id="remarks"
                className="input"
                rows={3}
                placeholder={
                  shortfall
                    ? 'Explain why fewer units were loaded than expected'
                    : 'Optional notes about the loading / dispatch'
                }
                value={remarks}
                onChange={(event) => setRemarks(event.target.value)}
              />
            </div>

            <button
              className="btn-primary mt-4 w-full"
              onClick={() => void finalise()}
              disabled={finalising || !sealNumber.trim()}
            >
              {finalising ? <Loader2 size={16} className="animate-spin" /> : <ShieldCheck size={16} />}
              {finalising ? 'Finalising...' : `Finalise ${outcome === 'DISPATCHED' ? 'as dispatched' : 'as not dispatched'}`}
            </button>
            <p className="mt-2 text-center text-xs text-surface-400">
              After finalising, the session is immutable and the scanner is closed.
            </p>
          </div>
        </>
      )}

      <div className="card">
        <div className="card-header">
          <h3 className="section-title flex items-center gap-2">
            <Truck size={16} className="text-surface-400" /> Dispatched Today
          </h3>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Product</th><th>Batch</th><th>Time</th></tr>
            </thead>
            <tbody>
              {todayDispatches.map((dispatch: any) => (
                <tr key={dispatch.id}>
                  <td><span className="font-medium text-surface-800">{dispatch.product_name}</span></td>
                  <td><span className="rounded-lg bg-surface-100 px-2 py-1 font-mono text-xs">{dispatch.batch_number}</span></td>
                  <td className="text-sm text-surface-500">{formatTime(dispatch.created_at)}</td>
                </tr>
              ))}
              {todayDispatches.length === 0 && (
                <tr>
                  <td colSpan={3}>
                    <div className="empty-state">
                      <div className="empty-icon"><Truck size={24} className="text-surface-400" /></div>
                      <div className="empty-title">No dispatches today</div>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
