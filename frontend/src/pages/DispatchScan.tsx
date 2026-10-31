import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { BrowserMultiFormatReader } from '@zxing/library';
import { api } from '../services/api';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import {
  AlertTriangle, Boxes, Camera, CheckCircle, ClipboardList, Clock, Loader2, RotateCcw,
  PackageCheck, QrCode, RefreshCw, ScanLine, ShieldCheck, Truck, X, XCircle,
} from 'lucide-react';

const reader = new BrowserMultiFormatReader();

type ScanResult = 'OK' | 'DUPLICATE' | 'WRONG_BATCH' | 'QTY_EXCEEDED';
type InlineResult = ScanResult | 'ERROR';
type MessageKind = 'success' | 'error' | 'warning' | 'info';
type Outcome = 'DISPATCHED' | 'NOT_DISPATCHED';

interface LoadingSession {
  id: string;
  status: string;
  total: number;
  scanned: number;
  dispatch_order_id: string;
  batch_id: string;
  batch_number: string | null;
  product_name: string | null;
  client_name: string | null;
  driver_name: string | null;
  vehicle_number: string | null;
  container_number: string | null;
  order_lines?: Array<{ batch_id: string; batch_number: string; product_name: string; product_sku?: string; quantity: number; uom?: string }>;
  uom: string | null;
  started_at: string | null;
}

interface RecentScan {
  key: string;
  qr: string;
  result: ScanResult;
  at: string | null;
}

interface InlineScan {
  qr: string;
  result: InlineResult;
  at: number;
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

const INLINE_STYLES: Record<InlineResult, { wrap: string; label: string }> = {
  OK: { wrap: 'border-emerald-200 bg-emerald-50 text-emerald-800', label: 'Unit accepted' },
  DUPLICATE: { wrap: 'border-amber-200 bg-amber-50 text-amber-800', label: 'Already scanned' },
  WRONG_BATCH: { wrap: 'border-rose-200 bg-rose-50 text-rose-800', label: 'Belongs to another batch' },
  QTY_EXCEEDED: { wrap: 'border-rose-200 bg-rose-50 text-rose-800', label: 'Quantity exceeded' },
  ERROR: { wrap: 'border-rose-200 bg-rose-50 text-rose-800', label: 'Scan failed' },
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

function text(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const valueText = String(value).trim();
  return valueText || null;
}

function formatTime(value?: string | number | null): string {
  if (value === null || value === undefined || value === '') return '-';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '-' : date.toLocaleTimeString();
}

function formatDateTime(value?: string | null): string {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString([], {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
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
  const source = raw?.session ?? raw ?? {};
  const base = fallback ?? {};
  return {
    id: String(source?.id ?? source?.session_id ?? ''),
    status: String(source?.status ?? 'ACTIVE'),
    total: Math.max(0, Number(source?.total ?? base?.quantity ?? base?.total ?? 0)),
    scanned: Math.max(0, Number(source?.scanned ?? 0)),
    dispatch_order_id: String(source?.dispatch_order_id ?? source?.order_id ?? base?.id ?? ''),
    batch_id: String(source?.batch_id ?? base?.batch_id ?? ''),
    batch_number: text(source?.batch_number) ?? text(base?.batch_number),
    order_lines: source?.order_lines ?? base?.items ?? [],
    product_name: text(source?.product_name) ?? text(base?.product_name),
    client_name: text(source?.client_name) ?? text(base?.client_name),
    driver_name: text(source?.driver_name) ?? text(base?.driver_name),
    vehicle_number: text(source?.vehicle_number) ?? text(base?.vehicle_number),
    container_number: text(source?.container_number) ?? text(base?.container_number),
    uom: text(source?.uom) ?? text(base?.uom),
    started_at: text(source?.started_at) ?? text(base?.started_at),
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

function mapRecentEvents(events: any[]): RecentScan[] {
  return events
    .map(normalizeEvent)
    .filter((event) => event.qr)
    .sort((a, b) => timeValue(b.at) - timeValue(a.at))
    .slice(0, 12);
}

function percent(scanned: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((scanned / total) * 100)));
}

function DetailRow({ label, value, mono = false }: { label: string; value?: string | null; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-surface-100 py-1.5 last:border-0">
      <dt className="shrink-0 text-surface-400">{label}</dt>
      <dd
        className={`min-w-0 truncate text-right font-medium text-surface-700 ${mono ? 'font-mono' : ''}`}
        title={value || undefined}
      >
        {value || '-'}
      </dd>
    </div>
  );
}

export default function DispatchScan() {
  const [orders, setOrders] = useState<any[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(true);
  const [orderSearch, setOrderSearch] = useState('');
  const debouncedOrderSearch = useDebouncedValue(orderSearch, 250);
  const [selectedOrderId, setSelectedOrderId] = useState('');
  const [session, setSession] = useState<LoadingSession | null>(null);
  const [activeSession, setActiveSession] = useState<LoadingSession | null>(null);
  const [checkingActive, setCheckingActive] = useState(true);
  const [starting, setStarting] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanBusy, setScanBusy] = useState(false);
  const [manualValue, setManualValue] = useState('');
  const [message, setMessage] = useState('');
  const [messageKind, setMessageKind] = useState<MessageKind>('info');
  const [recentScans, setRecentScans] = useState<RecentScan[]>([]);
  const [lastScan, setLastScan] = useState<InlineScan | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);
  const [pollError, setPollError] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [sealNumber, setSealNumber] = useState('');
  const [recallQr, setRecallQr] = useState('');
  const [recallReason, setRecallReason] = useState('');
  const [recallCondition, setRecallCondition] = useState<'DAMAGED' | 'HOLD' | 'OTHER'>('DAMAGED');
  const [recalling, setRecalling] = useState(false);
  const [driverName, setDriverName] = useState('');
  const [driverPhone, setDriverPhone] = useState('');
  const [vehicleNumber, setVehicleNumber] = useState('');
  const [containerNumber, setContainerNumber] = useState('');
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

  const allScanned = Boolean(session && session.total > 0 && session.scanned >= session.total);

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
      const readyOrders = Array.isArray(list) ? list.filter((order: any) =>
        order.status === 'APPROVED' &&
        Number(order.quantity) > 0 &&
        Boolean(order.batch_id) &&
        Boolean(order.product_name) &&
        Number(order.qr_count ?? order.quantity) >= Number(order.quantity),
      ) : [];
      setOrders(readyOrders);
    } catch (err: any) {
      setMessageKind('error');
      setMessage(err?.message || 'Could not load dispatch orders. Please retry.');
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

  const loadActiveSession = useCallback(async () => {
    setCheckingActive(true);
    try {
      const list = await api.loadingSessions.active();
      const rows = Array.isArray(list) ? list : [];
      if (rows.length > 0) {
        setActiveSession(normalizeSession(rows[0]));
      } else {
        setActiveSession(null);
      }
    } catch {
      // The resume banner is best-effort; the scan flow still works without it.
    } finally {
      setCheckingActive(false);
    }
  }, []);

  useEffect(() => {
    void loadOrders();
    void loadToday();
    void loadActiveSession();
  }, [loadOrders, loadToday, loadActiveSession]);

  const selectedOrder = useMemo(
    () => orders.find((order) => String(order.id) === selectedOrderId) || null,
    [orders, selectedOrderId]
  );

  const filteredOrders = useMemo(() => {
    const needle = debouncedOrderSearch.trim().toLowerCase();
    if (!needle) return orders;
    return orders.filter((order) =>
      [
        order.id, order.batch_number, order.product_name, order.product_sku, order.client_name,
        order.driver_name, order.vehicle_number, order.container_number,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(needle))
    );
  }, [orders, debouncedOrderSearch]);

  // Enrich the resume banner with client/driver details once the order list arrives.
  useEffect(() => {
    if (!activeSession) return;
    const order = orders.find((item) => String(item.id) === activeSession.dispatch_order_id);
    if (!order) return;
    const enriched = normalizeSession(activeSession, order);
    if (JSON.stringify(enriched) !== JSON.stringify(activeSession)) {
      setActiveSession(enriched);
    }
  }, [orders, activeSession]);

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
      setMessage(`Order #${requested} is not in your open dispatches. Choose another order below.`);
    }
    const next = new URLSearchParams(searchParams);
    next.delete('order');
    setSearchParams(next, { replace: true });
  }, [orders, ordersLoading, searchParams, setSearchParams]);

  const selectOrder = (id: string) => {
    if (session) return;
    setSelectedOrderId(id);
    setMessage('');
    setLastScan(null);
    setScanning(false);
    stopCamera();
  };

  const resetToOrders = useCallback(() => {
    setSession(null);
    setSelectedOrderId('');
    setRecentScans([]);
    setLastScan(null);
    setLastSyncedAt(null);
    setPollError(false);
    setSealNumber('');
    setDriverName('');
    setDriverPhone('');
    setVehicleNumber('');
    setContainerNumber('');
    setRemarks('');
    setOutcome('DISPATCHED');
    setScanning(false);
    stopCamera();
  }, [stopCamera]);

  const resumeSession = async (target: LoadingSession) => {
    const order = orders.find((item) => String(item.id) === target.dispatch_order_id) || null;
    let next = normalizeSession(target, order);
    let events: any[] = [];
    try {
      const data = await api.loadingSessions.get(target.id);
      const raw = data?.session ?? data;
      if (raw) next = normalizeSession(raw, target);
      events = Array.isArray(data?.events) ? data.events : [];
    } catch {
      // The 2-second poll will hydrate the counters shortly.
    }

    if (next.status !== 'ACTIVE') {
      setActiveSession(null);
      setMessageKind('warning');
      setMessage('That loading session is no longer active. Choose an open dispatch order to start again.');
      await Promise.all([loadOrders(), loadActiveSession()]);
      return;
    }

    setSession(next);
    setActiveSession(null);
    setSelectedOrderId(next.dispatch_order_id);
    setRecentScans(mapRecentEvents(events));
    setLastScan(null);
    setLastSyncedAt(Date.now());
    setPollError(false);
    setSealNumber('');
    setDriverName(next.driver_name || '');
    setDriverPhone(order?.driver_phone || '');
    setVehicleNumber(next.vehicle_number || '');
    setContainerNumber(next.container_number || '');
    setRemarks('');
    setOutcome('DISPATCHED');
    setScanning(false);
    setMessageKind('info');
    setMessage(
      `Resumed loading session for order #${next.dispatch_order_id} — ${next.scanned}/${next.total} units already scanned.`
    );
  };

  const startSession = async () => {
    if (!selectedOrder) {
      setMessageKind('error');
      setMessage('Select a dispatch order before starting a loading session.');
      return;
    }
    setStarting(true);
    setMessage('');
    setFinaliseResult(null);
    setLastScan(null);
    setScanning(false);
    stopCamera();
    try {
      const response = await api.loadingSessions.start(selectedOrder.id, operationId());
      const payload = response?.session ?? response;
      const next = normalizeSession(
        {
          ...payload,
          batch_number: response?.batch_number ?? payload?.batch_number,
          product_name: response?.product_name ?? payload?.product_name,
        },
        selectedOrder
      );
      if (!next.id) throw new Error('The server did not return a loading session id.');
      setSession(next);
      setActiveSession(null);
      setRecentScans([]);
      setLastSyncedAt(Date.now());
      setPollError(false);
      setSealNumber('');
      setDriverName(selectedOrder.driver_name || '');
      setDriverPhone(selectedOrder.driver_phone || '');
      setVehicleNumber(selectedOrder.vehicle_number || '');
      setContainerNumber(selectedOrder.container_number || '');
      setRemarks('');
      setOutcome('DISPATCHED');
      setMessageKind('success');
      setMessage(`Loading session started for order #${selectedOrder.id} — scan ${next.total} units.`);
    } catch (err: any) {
      // If the order already has an active session, resume it instead of failing.
      try {
        const active = await api.loadingSessions.active();
        const match = (Array.isArray(active) ? active : []).find(
          (item: any) => String(item.order_id ?? item.dispatch_order_id) === String(selectedOrder.id)
        );
        if (match) {
          await resumeSession(normalizeSession(match, selectedOrder));
          return;
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
      setLastScan({ qr: qrValue, result, at: Date.now() });
      setLastSyncedAt(Date.now());
      setPollError(false);
      setMessage('');

      if (result === 'OK') {
        setMessageKind('success');
      } else if (result === 'DUPLICATE') {
        setMessageKind('warning');
      } else {
        setMessageKind('error');
      }
      setManualValue('');
    } catch (err: any) {
      setLastScan({ qr: qrValue, result: 'ERROR', at: Date.now() });
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
    if (!value || !session || session.status !== 'ACTIVE' || scanInFlightRef.current) return;
    setManualValue('');
    void doScan(value);
  };

  const submitRecall = async () => {
    if (!session || !recallQr.trim() || !recallReason.trim() || recalling) return;
    setRecalling(true);
    setMessage('');
    try {
      const result = await api.loadingSessions.recallQr(session.id, {
        qr_value: recallQr.trim(), condition: recallCondition, reason: recallReason.trim(),
      });
      setSession(current => current && current.id === session.id
        ? { ...current, total: Number(result?.total ?? Math.max(0, current.total - 1)), scanned: Number(result?.scanned ?? current.scanned) }
        : current);
      setRecallQr(''); setRecallReason('');
      setMessageKind('success');
      setMessage(`QR recalled (${recallCondition.toLowerCase()}) and excluded from this loading order.`);
      setLastSyncedAt(Date.now());
    } catch (err: any) {
      setMessageKind('error');
      setMessage(err?.message || 'Could not recall this QR label.');
    } finally { setRecalling(false); }
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
        const status = String(raw?.status ?? 'ACTIVE');

        setSession((prev) => {
          if (!prev || prev.id !== sessionId) return prev;
          const merged = normalizeSession(raw, prev);
          return {
            ...prev,
            status,
            scanned: Math.max(0, Number(raw?.scanned ?? prev.scanned)),
            total: Math.max(0, Number(raw?.total ?? prev.total)),
            batch_number: merged.batch_number ?? prev.batch_number,
            product_name: merged.product_name ?? prev.product_name,
            started_at: merged.started_at ?? prev.started_at,
          };
        });
        setPollError(false);
        setLastSyncedAt(Date.now());

        const events: any[] = Array.isArray(data?.events) ? data.events : [];
        if (events.length > 0) {
          setRecentScans(mapRecentEvents(events));
        }

        if (status !== 'ACTIVE') {
          setScanning(false);
          stopCamera();
          setActiveSession(null);
          setSession(null);
          setSelectedOrderId('');
          setMessageKind(status === 'CANCELLED' ? 'warning' : 'info');
          setMessage(
            status === 'CANCELLED'
              ? 'This loading session was cancelled. Choose an open dispatch order to start again.'
              : 'This loading session was closed on another device.'
          );
          void Promise.all([loadOrders(), loadToday()]);
        }
      } catch {
        // Keep the last known counter; the next poll retries.
        if (!cancelled) setPollError(true);
      }
    };

    const interval = window.setInterval(() => {
      void tick();
    }, 2000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [session?.id, session?.status, loadOrders, loadToday, stopCamera]);

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
          const value = result.getText().trim();
          if (value) scanHandlerRef.current(value);
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

  // Once every unit is counted, stop the camera so stray scans do not fire errors.
  useEffect(() => {
    if (scanning && session && session.total > 0 && session.scanned >= session.total) {
      stopCamera();
      setScanning(false);
    }
  }, [scanning, session?.total, session?.scanned, stopCamera]);

  const toggleCamera = () => {
    if (!session || session.status !== 'ACTIVE' || allScanned) return;
    if (scanning) {
      stopCamera();
      setScanning(false);
    } else {
      setMessage('');
      setScanning(true);
    }
  };

  const openCancelDialog = () => {
    const target = session ?? activeSession;
    if (!target) return;
    if (target.scanned > 0) {
      setMessageKind('warning');
      setMessage('Cancelling is only possible before the first scan. Finalise this session instead.');
      return;
    }
    setScanning(false);
    stopCamera();
    setCancelOpen(true);
  };

  const cancelSession = async () => {
    const target = session ?? activeSession;
    if (!target || cancelling) return;
    setCancelling(true);
    try {
      await api.loadingSessions.cancel(target.id);
      const orderId = target.dispatch_order_id;
      setCancelOpen(false);
      setSession(null);
      setActiveSession(null);
      setRecentScans([]);
      setLastScan(null);
      setLastSyncedAt(null);
      setPollError(false);
      setScanning(false);
      stopCamera();
      setSealNumber('');
      setRemarks('');
      setOutcome('DISPATCHED');
      setSelectedOrderId(orderId);
      setMessageKind('success');
      setMessage(`Loading session cancelled for order #${orderId}. The batch is ready to be loaded again.`);
      await Promise.all([loadOrders(), loadToday()]);
    } catch (err: any) {
      setCancelOpen(false);
      setMessageKind('error');
      setMessage(err?.message || 'Could not cancel the loading session. Please retry.');
      await Promise.all([loadOrders(), loadActiveSession()]);
    } finally {
      setCancelling(false);
    }
  };

  const finalise = async () => {
    if (!session) return;
    if (!driverName.trim() || !vehicleNumber.trim() || !containerNumber.trim()) {
      setMessageKind('error');
      setMessage('Enter the driver, vehicle, and container details before marking the order dispatched.');
      return;
    }
    setFinalising(true);
    setMessage('');
    try {
      const response = await api.loadingSessions.finalise(session.id, {
        seal_number: sealNumber.trim(),
        outcome,
        driver_name: driverName.trim(),
        driver_phone: driverPhone.trim() || undefined,
        vehicle_number: vehicleNumber.trim(),
        container_number: containerNumber.trim(),
        remarks: remarks.trim() || undefined,
        client_operation_id: operationId(),
      });
      setFinaliseResult(response ?? {});
      setMessageKind('success');
      setMessage(
        outcome === 'DISPATCHED'
          ? `Loading session finalised. ${Number(response?.loaded_quantity ?? session.scanned).toLocaleString()} loaded units were removed from inventory and the order is marked dispatched.`
          : 'Loading session finalised. The order is marked NOT dispatched.'
      );
      setScanning(false);
      stopCamera();
      setSession(null);
      setActiveSession(null);
      setSelectedOrderId('');
      setRecentScans([]);
      setLastScan(null);
      setLastSyncedAt(null);
      setPollError(false);
      setSealNumber('');
      setDriverName('');
      setDriverPhone('');
      setVehicleNumber('');
      setContainerNumber('');
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

  const cancelTarget = session ?? activeSession;
  const canCancelSession = Boolean(cancelTarget && cancelTarget.status === 'ACTIVE' && cancelTarget.scanned === 0);

  const MessageIcon =
    messageKind === 'success' ? CheckCircle
      : messageKind === 'error' ? XCircle
        : messageKind === 'warning' ? AlertTriangle
          : Clock;

  const LastScanIcon =
    lastScan?.result === 'OK' ? CheckCircle
      : lastScan?.result === 'DUPLICATE' ? AlertTriangle
        : XCircle;

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
        <div className={`mb-4 flex items-start gap-2 rounded-xl border p-3 text-sm ${MESSAGE_STYLES[messageKind]}`} role="status" aria-live="polite">
          <MessageIcon size={16} className="mt-0.5 shrink-0" />
          <span className="min-w-0">{message}</span>
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
                    The seal and outcome were saved. Loaded units have been deducted from inventory.
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
                      <div className="text-surface-500">Units deducted</div>
                      <div className="font-semibold text-emerald-700">{Number(finaliseResult?.loaded_quantity ?? 0).toLocaleString()}</div>
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

          {activeSession && (
            <div className="card mb-4 overflow-hidden border border-brand-200">
              <div className="flex flex-wrap items-start justify-between gap-4 border-l-4 border-l-brand-500 p-6">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="badge badge-success">
                      <span className="mr-1.5 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
                      ACTIVE SESSION
                    </span>
                    <span className="badge badge-info">Order #{activeSession.dispatch_order_id || '-'}</span>
                    <span className="rounded-lg bg-surface-100 px-2 py-1 font-mono text-xs text-surface-700">
                      Batch {activeSession.batch_number || '-'}
                    </span>
                  </div>
                  <h2 className="mt-2 flex items-center gap-2 text-base font-bold text-surface-900">
                    <QrCode size={18} className="text-brand-500" />
                    Loading already in progress
                  </h2>
                  <p className="mt-1 text-sm text-surface-500">
                    {activeSession.product_name || 'Product'} · {activeSession.scanned}/{activeSession.total} units scanned
                    {activeSession.client_name ? ` · ${activeSession.client_name}` : ''}
                  </p>
                  <p className="mt-1 text-xs text-surface-400">
                    Started {formatDateTime(activeSession.started_at)}. Resume it to keep scanning instead of starting a duplicate.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button className="btn-primary" onClick={() => void resumeSession(activeSession)}>
                    <QrCode size={16} /> Resume session
                  </button>
                  {activeSession.scanned === 0 && (
                    <button
                      className="btn-secondary border-rose-200 text-rose-600 hover:bg-rose-50"
                      onClick={openCancelDialog}
                      disabled={cancelling}
                    >
                      <XCircle size={16} /> Cancel session
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}

          <div className="card mb-4 p-6">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="section-title flex items-center gap-2">
                  <PackageCheck size={16} className="text-brand-500" /> Ready for loading
                  <span className="badge badge-neutral">{filteredOrders.length}</span>
                  {checkingActive && <Loader2 size={13} className="animate-spin text-surface-400" aria-label="Checking active sessions" />}
                </h2>
                <p className="mt-1 text-xs text-surface-400">
                  Select a dispatch order to start scanning. Orders are ready as soon as Dispatch creates them.
                </p>
              </div>
              <button className="btn-secondary btn-sm" onClick={() => void Promise.all([loadOrders(), loadActiveSession()])} disabled={ordersLoading}>
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
                          {order.product_name}
                        </span>
                        <span className="badge badge-info text-[10px]">Order #{order.id}</span>
                        <span className="rounded bg-surface-100 px-1.5 py-0.5 font-mono text-xs text-surface-700">
                          {order.items?.length > 1 ? `${order.items.length} product lines` : order.batch_number}
                        </span>
                      </div>
                      {order.items?.length > 1 && <div className="mt-2 flex flex-wrap gap-1.5">{order.items.map((item: any) => <span key={String(item.batch_id)} className="rounded-md border border-surface-200 bg-surface-50 px-2 py-1 text-[11px] text-surface-600"><strong className="text-surface-800">{item.product_name}</strong> · {item.batch_number} · {Number(item.quantity).toLocaleString()} x {item.uom || 'units'}</span>)}</div>}
                      <div className="mt-1.5 grid grid-cols-1 gap-x-4 gap-y-1 text-xs text-surface-500 sm:grid-cols-2 lg:grid-cols-3">
                        <span>Client: <strong className="text-surface-700">{order.client_name || '-'}</strong></span>
                        <span>To load: <strong className="text-surface-700">{Number(order.quantity).toLocaleString()} {order.uom || 'units'}</strong></span>
                        <span>Driver: {order.driver_name || '-'}</span>
                        <span>Vehicle: {order.vehicle_number || '-'}</span>
                        <span>Container: {order.container_number || '-'}</span>
                      </div>
                    </div>
                    <span className="badge badge-success shrink-0">Ready to load</span>
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
                      ? 'Loading dispatch orders...'
                      : orderSearch
                        ? 'No dispatch orders match that search'
                        : 'No dispatch orders ready for loading'}
                  </div>
                  <div className="mt-1 text-xs text-surface-400">
                    {ordersLoading
                      ? 'Please wait a moment.'
                      : orderSearch
                        ? 'Try a different order number, product or client.'
                      : 'Create a dispatch order from a stocked batch to begin loading.'}
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

      {session && session.status !== 'ACTIVE' && (
        <div className="card mb-4 border border-amber-200 bg-amber-50/50 p-6">
          <div className="flex items-start gap-3">
            <AlertTriangle size={22} className="mt-0.5 shrink-0 text-amber-600" />
            <div className="min-w-0 flex-1">
              <h2 className="section-title">Session {session.status}</h2>
              <p className="mt-1 text-sm text-surface-600">
                This loading session is no longer active. Choose an open dispatch order to start a new session.
              </p>
              <button className="btn-secondary btn-sm mt-4" onClick={resetToOrders}>
                Back to orders
              </button>
            </div>
          </div>
        </div>
      )}

      {session && session.status === 'ACTIVE' && (
        <>
          <div className="card mb-4 overflow-hidden">
            <div className="border-b border-surface-100 bg-surface-50/70 px-6 py-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="badge badge-success">
                      <span className="mr-1.5 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
                      {session.status}
                    </span>
                    <span className="badge badge-info">Order #{session.dispatch_order_id || '-'}</span>
                    <span className="rounded-lg bg-white px-2 py-1 font-mono text-xs text-surface-700 ring-1 ring-surface-200">
                      Batch {session.batch_number || '-'}
                    </span>
                  </div>
                  <h2 className="mt-2 flex items-center gap-2 text-lg font-bold tracking-tight text-surface-900">
                    <QrCode size={18} className="text-brand-500" />
                    {session.product_name || 'Loading in progress'}
                  </h2>
                  <p className="mt-1 text-xs text-surface-500">
                    {session.client_name || 'Client'} · Driver {session.driver_name || '-'} ·{' '}
                    {session.vehicle_number || 'No vehicle'}
                    {session.container_number ? ` · Container ${session.container_number}` : ''}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {canCancelSession ? (
                    <button
                      className="btn-secondary btn-sm border-rose-200 text-rose-600 hover:bg-rose-50"
                      onClick={openCancelDialog}
                      disabled={cancelling}
                    >
                      <XCircle size={14} /> Cancel session
                    </button>
                  ) : (
                    <span className="text-[11px] text-surface-400" title="Cancelling is only available before the first scan">
                      Cancel available before first scan
                    </span>
                  )}
                </div>
              </div>
            </div>

            <div className="grid gap-6 p-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
              <div className="min-w-0 space-y-4">
                <div className="rounded-2xl border border-surface-200 bg-surface-50 p-5">
                  <div className="flex flex-wrap items-end justify-between gap-3">
                    <div>
                      <div className="text-[11px] font-semibold uppercase tracking-wider text-surface-500">Scanned units</div>
                      <div className="mt-1 text-4xl font-bold tabular-nums text-surface-900">
                        {scannedCount} <span className="text-2xl text-surface-400">/ {totalCount}</span>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className={`text-2xl font-bold ${progress >= 100 ? 'text-emerald-600' : 'text-brand-600'}`}>
                        {progress}%
                      </div>
                      <div className="text-xs text-surface-400">
                        {remaining === 0 ? 'All units scanned' : `${remaining} unit${remaining === 1 ? '' : 's'} remaining`}
                      </div>
                    </div>
                  </div>
                  <div
                    className="mt-4 h-3 w-full overflow-hidden rounded-full bg-surface-200"
                    role="progressbar"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={progress}
                    aria-label="Loading progress"
                  >
                    <div
                      className={`h-full rounded-full transition-all duration-300 ${progress >= 100 ? 'bg-emerald-500' : 'bg-brand-500'}`}
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                  <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-surface-400">
                    <span>{lastSyncedAt ? `Last sync ${formatTime(lastSyncedAt)}` : 'Live counter'}</span>
                    {pollError ? (
                      <span className="flex items-center gap-1 text-amber-600">
                        <AlertTriangle size={12} /> Connection issue — retrying
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-emerald-600">
                        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" /> Live
                      </span>
                    )}
                  </div>
                </div>

                <div>
                  <label className="input-label" htmlFor="manual-scan">Unit QR code</label>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <input
                      id="manual-scan"
                      className="input flex-1 font-mono text-sm"
                      placeholder={allScanned ? 'All units scanned — ready to finalise' : 'Scan or type a unit QR code, then press Enter'}
                      value={manualValue}
                      onChange={(event) => setManualValue(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') submitManual();
                      }}
                      disabled={scanBusy || allScanned}
                      autoComplete="off"
                      spellCheck={false}
                      autoFocus
                    />
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={submitManual}
                      disabled={!manualValue.trim() || scanBusy || allScanned}
                    >
                      {scanBusy ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle size={16} />}
                      {scanBusy ? 'Checking...' : 'Add scan'}
                    </button>
                    <button type="button" className="btn-primary" onClick={toggleCamera} disabled={allScanned}>
                      {scanning ? <X size={16} /> : <Camera size={16} />}
                      {scanning ? 'Stop camera' : 'Scan with camera'}
                    </button>
                  </div>
                  <p className={`mt-1.5 text-[11px] ${allScanned ? 'font-medium text-emerald-600' : 'text-surface-400'}`}>
                    {allScanned
                      ? 'All units are scanned. Add the seal number below and finalise the dispatch.'
                      : 'The camera stays on between scans. Press Enter to submit a typed code.'}
                  </p>
                </div>

                <div className="rounded-2xl bg-amber-50/70 p-4">
                  <div className="flex items-start gap-2"><RotateCcw size={17} className="mt-0.5 text-amber-700" /><div><h3 className="text-sm font-bold text-slate-900">Recall a product</h3><p className="mt-0.5 text-xs text-slate-600">Use this if an item is damaged or cannot be loaded. Recalled QR codes are excluded from the loading count.</p></div></div>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    <div><label className="input-label" htmlFor="recall-qr">Product QR code</label><input id="recall-qr" className="input font-mono text-sm" value={recallQr} onChange={event => setRecallQr(event.target.value)} placeholder="Scan or enter QR code" autoComplete="off" /></div>
                    <div><label className="input-label" htmlFor="recall-condition">Condition</label><select id="recall-condition" className="input" value={recallCondition} onChange={event => setRecallCondition(event.target.value as typeof recallCondition)}><option value="DAMAGED">Damaged</option><option value="HOLD">Hold for review</option><option value="OTHER">Other</option></select></div>
                    <div className="sm:col-span-2"><label className="input-label" htmlFor="recall-reason">Reason</label><div className="flex flex-col gap-2 sm:flex-row"><input id="recall-reason" className="input flex-1" value={recallReason} onChange={event => setRecallReason(event.target.value)} placeholder="Describe why this item is being recalled" /><button type="button" className="btn-secondary shrink-0" onClick={() => void submitRecall()} disabled={recalling || !recallQr.trim() || !recallReason.trim()}>{recalling ? <Loader2 size={15} className="animate-spin" /> : <RotateCcw size={15} />}{recalling ? 'Recalling…' : 'Recall QR'}</button></div></div>
                  </div>
                </div>

                {lastScan && (
                  <div
                    className={`flex items-start gap-3 rounded-xl border p-3 ${INLINE_STYLES[lastScan.result].wrap}`}
                    role="status"
                    aria-live="polite"
                  >
                    <LastScanIcon size={20} className="mt-0.5 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold">{INLINE_STYLES[lastScan.result].label}</div>
                      <div className="truncate font-mono text-[11px] opacity-75" title={lastScan.qr}>{lastScan.qr}</div>
                    </div>
                    <span className="shrink-0 text-[11px] opacity-70">{formatTime(lastScan.at)}</span>
                  </div>
                )}

                {scanning && (
                  <div className="space-y-3">
                    <div className="relative overflow-hidden rounded-2xl bg-black ring-1 ring-surface-200">
                      <video
                        ref={videoRef}
                        className="h-[320px] w-full object-cover"
                        playsInline
                        muted
                      />
                      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                        <div className="h-48 w-48 rounded-2xl border-2 border-white/80 shadow-[0_0_0_9999px_rgba(15,23,42,0.35)]" />
                      </div>
                      <span className="absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-full bg-black/60 px-2.5 py-1 text-[11px] font-medium text-white">
                        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" /> Scanning
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="flex items-center gap-2 text-xs text-surface-500">
                        <Camera size={14} /> Hold the QR inside the frame.
                      </span>
                      <button className="btn-secondary btn-sm" onClick={toggleCamera}>
                        <X size={14} /> Stop camera
                      </button>
                    </div>
                  </div>
                )}
              </div>

              <div className="min-w-0 space-y-4">
                <div className="rounded-2xl border border-surface-200 bg-white p-4">
                  <h3 className="flex items-center gap-2 text-sm font-semibold text-surface-800">
                    <Boxes size={15} className="text-brand-500" /> Batch &amp; vehicle
                  </h3>
                  <dl className="mt-3 text-xs">
                    <DetailRow label="Product" value={session.product_name} />
                    <DetailRow label="Batch" value={session.batch_number} mono />
                    <DetailRow label="Client" value={session.client_name} />
                    <DetailRow label="Driver" value={session.driver_name} />
                    <DetailRow label="Vehicle" value={session.vehicle_number} mono />
                    <DetailRow label="Container" value={session.container_number} mono />
                    <DetailRow label="Started" value={formatDateTime(session.started_at)} />
                  </dl>
                </div>

                <div className="overflow-hidden rounded-2xl border border-surface-200 bg-white">
                  <div className="flex items-center justify-between gap-2 border-b border-surface-100 px-4 py-3">
                    <h3 className="flex items-center gap-2 text-sm font-semibold text-surface-800">
                      <ScanLine size={15} className="text-brand-500" /> Recent scans
                    </h3>
                    <span className="badge badge-neutral">{recentScans.length}</span>
                  </div>
                  <div className="max-h-[320px] divide-y divide-surface-100 overflow-y-auto">
                    {recentScans.map((scan) => (
                      <div key={scan.key} className="flex items-center justify-between gap-3 px-4 py-2.5">
                        <div className="min-w-0">
                          <div className="truncate font-mono text-[11px] text-surface-700" title={scan.qr}>{scan.qr}</div>
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
            </div>
          </div>

          <div className="card mb-6 p-6">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="section-title flex items-center gap-2">
                  <ShieldCheck size={16} className="text-indigo-500" /> Seal &amp; finalise
                </h2>
                <p className="mt-1 text-xs text-surface-400">
                  Complete the shipment details after loading, then mark the order dispatched. Driver mobile is optional.
                </p>
              </div>
              <span className={`badge ${shortfall ? 'badge-warning' : 'badge-success'}`}>
                {scannedCount}/{totalCount} scanned
              </span>
            </div>

            {shortfall ? (
              <div className="mt-4 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-700">
                <AlertTriangle size={15} className="mt-0.5 shrink-0" />
                <span>
                  Only {scannedCount} of {totalCount} units are scanned. Finalising below total is allowed, but add
                  remarks explaining the shortfall.
                </span>
              </div>
            ) : (
              scannedCount > 0 && (
                <div className="mt-4 flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-700">
                  <CheckCircle size={15} className="mt-0.5 shrink-0" />
                  <span>All {totalCount} units are scanned. Complete the shipment details below to dispatch this order.</span>
                </div>
              )
            )}

            <div className="form-grid mt-4">
              <div>
                <label className="input-label" htmlFor="driver-name">Driver name *</label>
                <input
                  id="driver-name"
                  className="input"
                  value={driverName}
                  onChange={(event) => setDriverName(event.target.value)}
                  autoComplete="off"
                />
              </div>
              <div>
                <label className="input-label" htmlFor="driver-phone">Driver mobile (optional)</label>
                <input id="driver-phone" className="input" type="tel" value={driverPhone} onChange={(event) => setDriverPhone(event.target.value)} autoComplete="tel" />
              </div>
              <div>
                <label className="input-label" htmlFor="vehicle-number">Vehicle number *</label>
                <input id="vehicle-number" className="input font-mono" value={vehicleNumber} onChange={(event) => setVehicleNumber(event.target.value)} autoComplete="off" />
              </div>
              <div>
                <label className="input-label" htmlFor="container-number">Container number *</label>
                <input id="container-number" className="input font-mono" value={containerNumber} onChange={(event) => setContainerNumber(event.target.value)} autoComplete="off" />
              </div>
              <div>
                <label className="input-label" htmlFor="seal-number">Seal number (optional)</label>
                <input id="seal-number" className="input font-mono" value={sealNumber} onChange={(event) => setSealNumber(event.target.value)} autoComplete="off" />
              </div>
              <div>
                <label className="input-label" htmlFor="outcome">Order outcome</label>
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
              disabled={finalising || !driverName.trim() || !vehicleNumber.trim() || !containerNumber.trim() || scanBusy}
            >
              {finalising ? <Loader2 size={16} className="animate-spin" /> : <ShieldCheck size={16} />}
              {finalising ? 'Finalising...' : `Finalise ${outcome === 'DISPATCHED' ? 'as dispatched' : 'as not dispatched'}`}
            </button>
            <p className="mt-2 text-center text-xs text-surface-400">
              Inventory is reserved when the dispatch order is created. The final status and shipment details are saved here.
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

      {cancelOpen && cancelTarget && (
        <div
          className="modal-overlay z-[60]"
          role="presentation"
          onClick={() => {
            if (!cancelling) setCancelOpen(false);
          }}
        >
          <section
            className="modal-content max-w-md"
            role="dialog"
            aria-modal="true"
            aria-labelledby="cancel-session-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="modal-header">
              <div className="min-w-0">
                <h2 id="cancel-session-title" className="text-base font-semibold text-surface-900">
                  Cancel loading session?
                </h2>
                <p className="mt-1 text-xs text-surface-500">
                  Order #{cancelTarget.dispatch_order_id || '-'} · batch {cancelTarget.batch_number || '-'}
                </p>
              </div>
              <button
                className="btn-ghost btn-sm"
                aria-label="Close cancel dialog"
                disabled={cancelling}
                onClick={() => setCancelOpen(false)}
              >
                <X size={16} />
              </button>
            </div>
            <div className="modal-body space-y-3 text-sm text-surface-600">
              <p>No units have been scanned yet, so this session can be cancelled safely.</p>
              <div className="rounded-xl border border-surface-100 bg-surface-50 p-3 text-xs">
                <div className="flex justify-between gap-3">
                  <span className="text-surface-400">Product</span>
                  <span className="truncate font-medium text-surface-700">{cancelTarget.product_name || '-'}</span>
                </div>
                <div className="mt-1 flex justify-between gap-3">
                  <span className="text-surface-400">Batch</span>
                  <span className="font-mono font-medium text-surface-700">{cancelTarget.batch_number || '-'}</span>
                </div>
                <div className="mt-1 flex justify-between gap-3">
                  <span className="text-surface-400">Scanned</span>
                  <span className="font-medium text-surface-700">0 of {cancelTarget.total}</span>
                </div>
              </div>
              <p className="text-xs text-surface-500">
                The batch returns to DISPATCH_APPROVED so it can be loaded again. No stock change or dispatch record is created.
              </p>
            </div>
            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => setCancelOpen(false)} disabled={cancelling}>
                Keep loading
              </button>
              <button className="btn-danger" onClick={() => void cancelSession()} disabled={cancelling}>
                {cancelling ? <Loader2 size={16} className="animate-spin" /> : <XCircle size={16} />}
                {cancelling ? 'Cancelling...' : 'Cancel session'}
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
