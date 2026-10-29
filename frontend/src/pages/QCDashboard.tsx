import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../services/api';
import type { EntityId } from '../types';
import {
  Microscope, CheckCircle, XCircle, Clock, TrendingUp, RefreshCw, Search,
  ChevronLeft, ChevronRight, ArrowRight, Image as ImageIcon, AlertTriangle, QrCode,
  Tags, Plus,
} from 'lucide-react';

type PageData = { items: any[]; total: number; page: number; limit: number; pages: number };

function formatDate(value: string | null | undefined): string {
  if (!value) return '-';
  return new Date(value).toLocaleString(undefined, {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  });
}

function Pagination({ page, pages, onChange }: { page: number; pages: number; onChange: (page: number) => void }) {
  if (pages <= 1) return null;
  return (
    <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-surface-100">
      <button className="btn-secondary btn-xs" disabled={page <= 1} onClick={() => onChange(page - 1)}>
        <ChevronLeft size={14} /> Previous
      </button>
      <span className="text-xs text-surface-400">Page {page} of {pages}</span>
      <button className="btn-secondary btn-xs" disabled={page >= pages} onClick={() => onChange(page + 1)}>
        Next <ChevronRight size={14} />
      </button>
    </div>
  );
}

export default function QCDashboard() {
  const [stats, setStats] = useState<any>(null);
  const [pending, setPending] = useState<any[]>([]);
  const [records, setRecords] = useState<PageData | null>(null);
  const [pendingQuery, setPendingQuery] = useState('');
  const [recordQuery, setRecordQuery] = useState('');
  const [recordPage, setRecordPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [pendingLoading, setPendingLoading] = useState(false);
  const [recordsLoading, setRecordsLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [messageKind, setMessageKind] = useState<'success' | 'error'>('success');
  const [selectedOrder, setSelectedOrder] = useState<any>(null);
  const [remarks, setRemarks] = useState('');
  const [actionLoading, setActionLoading] = useState(false);
  const pendingRequest = useRef(0);
  const recordsRequest = useRef(0);

  const loadStats = useCallback(async () => {
    const data = await api.qc.stats();
    setStats(data);
  }, []);

  const loadPending = useCallback(async (q = '') => {
    const requestId = ++pendingRequest.current;
    setPendingLoading(true);
    try {
      const data = await api.dispatchOrders.pending({ q: q || undefined });
      if (requestId === pendingRequest.current) setPending(data);
    } catch (error) {
      if (requestId === pendingRequest.current) throw error;
    } finally {
      if (requestId === pendingRequest.current) setPendingLoading(false);
    }
  }, []);

  const loadRecords = useCallback(async (page = 1, q = recordQuery) => {
    const requestId = ++recordsRequest.current;
    setRecordsLoading(true);
    try {
      const data = await api.qc.records({ page, limit: 8, q, result: 'PASS', scope: 'mine' });
      if (requestId === recordsRequest.current) {
        setRecords(data);
        setRecordPage(data.page);
      }
    } catch (error) {
      if (requestId === recordsRequest.current) throw error;
    } finally {
      if (requestId === recordsRequest.current) setRecordsLoading(false);
    }
  }, [recordQuery]);

  const loadAll = useCallback(async (showSpinner = false) => {
    if (showSpinner) setRefreshing(true);
    setError('');
    try {
      const results = await Promise.allSettled([loadStats(), loadPending(pendingQuery), loadRecords(recordPage)]);
      const failures = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected');
      if (failures.length) {
        setError(failures.map((failure) => failure.reason?.message || 'Could not load a QC dashboard section').join(' '));
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [loadStats, loadPending, loadRecords, pendingQuery, recordPage]);

  useEffect(() => { loadAll(); }, []); // Initial load only.

  useEffect(() => {
    const timer = setTimeout(() => {
      loadPending(pendingQuery).catch((err) => setError(err.message));
    }, 300);
    return () => clearTimeout(timer);
  }, [pendingQuery]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const timer = setTimeout(() => {
      loadRecords(1).catch((err) => setError(err.message));
    }, 300);
    return () => clearTimeout(timer);
  }, [recordQuery]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!selectedOrder) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !actionLoading) {
        setSelectedOrder(null);
        setRemarks('');
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selectedOrder, actionLoading]);

  const showMessage = (text: string, kind: 'success' | 'error' = 'success') => {
    setMessage(text);
    setMessageKind(kind);
  };

  const refreshAfterAction = async () => {
    await Promise.all([loadStats(), loadPending(pendingQuery)]);
  };

  const handleApprove = async (id: EntityId) => {
    setActionLoading(true);
    setMessage('');
    try {
      await api.dispatchOrders.approve(id, remarks.trim() || undefined);
      showMessage('Dispatch order approved. The packing list is now available to download and dispatch can start loading.');
      setSelectedOrder(null);
      setRemarks('');
      await refreshAfterAction();
    } catch (err: any) {
      showMessage(err.message || 'Could not approve dispatch order', 'error');
    } finally {
      setActionLoading(false);
    }
  };

  const handleReject = async (id: EntityId) => {
    if (!remarks.trim()) {
      showMessage('Enter remarks before rejecting this dispatch order.', 'error');
      return;
    }
    setActionLoading(true);
    setMessage('');
    try {
      await api.dispatchOrders.reject(id, remarks.trim());
      showMessage('Dispatch order rejected. The batch is available to dispatch again.');
      setSelectedOrder(null);
      setRemarks('');
      await refreshAfterAction();
    } catch (err: any) {
      showMessage(err.message || 'Could not reject dispatch order', 'error');
    } finally {
      setActionLoading(false);
    }
  };

  if (loading && !stats) {
    return <div className="page-container flex items-center justify-center h-64"><span className="text-sm text-surface-400">Loading QC dashboard...</span></div>;
  }

  const cards = [
    { label: 'My Tests Today', value: stats?.myTestsToday ?? 0, icon: <Microscope size={18} />, color: 'text-sky-600', bg: 'bg-sky-50' },
    { label: 'My Tests This Week', value: stats?.myTestsThisWeek ?? 0, icon: <TrendingUp size={18} />, color: 'text-indigo-600', bg: 'bg-indigo-50' },
    {
      label: 'My Pass Rate',
      value: `${stats?.myPassRate ?? 0}%`,
      icon: <CheckCircle size={18} />,
      color: (stats?.myPassRate ?? 0) >= 80 ? 'text-emerald-600' : 'text-amber-600',
      bg: (stats?.myPassRate ?? 0) >= 80 ? 'bg-emerald-50' : 'bg-amber-50',
    },
    { label: 'Pending Approvals', value: pending.length, icon: <Clock size={18} />, color: 'text-purple-600', bg: 'bg-purple-50' },
    { label: 'My Total Tests', value: stats?.myTotalTests ?? 0, icon: <Microscope size={18} />, color: 'text-slate-600', bg: 'bg-slate-50' },
  ];

  const trend = (stats?.trend || []).map((row: any) => ({
    day: new Date(row.day).toLocaleDateString(undefined, { weekday: 'short' }),
    passed: Number(row.passed || 0),
  }));
  const maxTrend = Math.max(1, ...trend.map((row: any) => row.passed));

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1 className="page-title">QC Dashboard</h1>
          <p className="page-subtitle">Dispatch order approvals, auto-pass history, and your QC performance</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button className="btn-secondary btn-sm" onClick={() => loadAll(true)} disabled={refreshing}>
            <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} /> Refresh
          </button>
          <Link to="/qc/qr-codes" className="btn-secondary btn-sm">
            <Tags size={14} /> QR Labels
          </Link>
          <Link to="/batches" className="btn-primary btn-sm">
            <Plus size={14} /> Create QC Batch
          </Link>
        </div>
      </div>

      {error && (
        <div className="mb-4 p-3 rounded-xl text-sm flex items-center gap-2 bg-rose-50 text-rose-700 border border-rose-200">
          <AlertTriangle size={16} /> <span className="flex-1">{error}</span>
          <button className="btn-secondary btn-xs" onClick={() => void loadAll(true)} disabled={refreshing}>Retry</button>
        </div>
      )}

      {message && (
        <div className={`mb-4 p-3 rounded-xl text-sm flex items-center gap-2 ${
          messageKind === 'error'
            ? 'bg-rose-50 text-rose-700 border border-rose-200'
            : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
        }`}>
          {messageKind === 'error' ? <AlertTriangle size={16} /> : <CheckCircle size={16} />}
          {message}
        </div>
      )}

      <div className="card mb-6 border border-brand-100 bg-brand-50/60 p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white text-brand-600 shadow-sm"><QrCode size={18} /></div>
            <div>
              <h2 className="text-sm font-semibold text-surface-900">QC work queue</h2>
              <p className="mt-0.5 text-xs text-surface-500">Batches pass automatically. Finish their details, then review dispatch requests.</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 text-xs">
            <Link to="/batches" className="btn-secondary btn-xs"><span className="flex h-5 w-5 items-center justify-center rounded-full bg-brand-100 text-brand-700">1</span> Create & finish batches</Link>
            <a href="#qc-approvals" className="btn-secondary btn-xs"><span className="flex h-5 w-5 items-center justify-center rounded-full bg-brand-100 text-brand-700">2</span> Review dispatch</a>
            <Link to="/qc/qr-codes" className="btn-secondary btn-xs"><span className="flex h-5 w-5 items-center justify-center rounded-full bg-brand-100 text-brand-700">3</span> Print QR labels</Link>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
        {cards.map((card) => (
          <div key={card.label} className="card p-5">
            <div className="flex items-center gap-2 mb-2">
              <div className={`w-8 h-8 rounded-xl ${card.bg} ${card.color} flex items-center justify-center`}>{card.icon}</div>
              <span className="text-xs font-medium text-surface-500 uppercase tracking-wider">{card.label}</span>
            </div>
            <div className="text-2xl font-bold text-surface-900">{card.value}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 mb-6">
        <div id="qc-approvals" className="card xl:col-span-2 scroll-mt-6">
          <div className="card-header flex items-center justify-between gap-3">
            <h3 className="section-title flex items-center gap-2">
              <Clock size={16} className="text-purple-500" /> Dispatch Order Approvals
              <span className="badge badge-warning">{pending.length}{pendingLoading ? ' · updating' : ''}</span>
            </h3>
            <div className="relative w-56 max-w-full">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-surface-400" />
              <input
                className="input pl-9 py-1.5 text-xs"
                placeholder="Search batch, product, or client"
                value={pendingQuery}
                onChange={(event) => setPendingQuery(event.target.value)}
              />
            </div>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Batch</th><th>Product</th><th>Client</th><th>Driver / Vehicle</th><th>Container</th><th>Status</th><th></th></tr>
              </thead>
              <tbody>
                {pending.map((order: any) => (
                  <tr key={order.id}>
                    <td>
                      <div className="font-mono text-xs bg-surface-100 px-2 py-1 rounded-lg inline-block">{order.batch_number || '-'}</div>
                      <div className="text-[10px] text-surface-400 mt-1">Raised by {order.raised_by_name || '-'}</div>
                    </td>
                    <td>
                      <div className="font-medium text-surface-800">{order.product_name}</div>
                      <div className="text-xs text-surface-400">{order.product_sku}</div>
                    </td>
                    <td className="text-sm text-surface-600">{order.client_name || '-'}</td>
                    <td className="text-xs text-surface-600">
                      {order.driver_name || '-'}
                      <div className="text-surface-400">{order.vehicle_number || '-'}</div>
                    </td>
                    <td className="text-xs text-surface-600">{order.container_number || '-'}</td>
                    <td><span className="badge badge-warning">{order.status}</span></td>
                    <td>
                      <button
                        className="btn-primary btn-xs"
                        onClick={() => { setSelectedOrder(order); setRemarks(''); setMessage(''); }}
                      >
                        Review <ArrowRight size={12} />
                      </button>
                    </td>
                  </tr>
                ))}
                {pending.length === 0 && (
                  <tr><td colSpan={7}><div className="empty-state"><div className="empty-title">{pendingLoading ? 'Loading approval queue…' : pendingQuery ? 'No orders match this search' : 'No dispatch orders waiting for QC approval'}</div><div className="empty-desc">{pendingQuery ? 'Try another batch, product, or client name.' : 'New dispatch requests will appear here.'}</div></div></td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card">
          <div className="card-header"><h3 className="section-title flex items-center gap-2"><TrendingUp size={16} className="text-indigo-500" /> Last 7 Days</h3></div>
          <div className="card-body">
            <div className="flex items-end gap-2 h-40">
              {trend.map((row: any, index: number) => (
                <div key={`${row.day}-${index}`} className="flex-1 flex flex-col items-center gap-1">
                  <span className="text-[10px] font-semibold text-surface-500">{row.passed}</span>
                  <div className="w-full flex flex-col justify-end rounded-t-lg overflow-hidden bg-surface-100" style={{ height: `${Math.max(6, (row.passed / maxTrend) * 110)}px` }}>
                    {row.passed > 0 && <div className="bg-emerald-400 w-full h-full" />}
                  </div>
                  <span className="text-[10px] text-surface-400">{row.day}</span>
                </div>
              ))}
              {trend.length === 0 && <div className="flex-1 text-center text-xs text-surface-400">No auto-passed batches yet</div>}
            </div>
            <div className="flex items-center justify-center gap-4 mt-4 text-[10px] text-surface-400">
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-400" /> Auto-passed</span>
            </div>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-header flex flex-wrap items-center justify-between gap-3">
          <h3 className="section-title flex items-center gap-2">
            <Microscope size={16} className="text-surface-400" /> Auto-pass history
            <span className="badge badge-neutral">{records?.total ?? 0}{recordsLoading ? ' · updating' : ''}</span>
          </h3>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative w-52">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-surface-400" />
              <input
                className="input pl-9 py-1.5 text-xs"
                placeholder="Search history"
                value={recordQuery}
                onChange={(event) => setRecordQuery(event.target.value)}
              />
            </div>
            <span className="badge badge-success">PASS only</span>
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Date</th><th>Product</th><th>Batch</th><th>Result</th><th>Remarks</th><th>Photos</th></tr>
            </thead>
            <tbody>
              {(records?.items || []).map((record: any) => {
                let imageCount = 0;
                try { imageCount = record.images ? JSON.parse(record.images).length : 0; } catch { imageCount = 0; }
                return (
                  <tr key={record.id}>
                    <td className="text-xs text-surface-400">{formatDate(record.created_at)}</td>
                    <td>
                      <div className="font-medium text-surface-800">{record.product_name}</div>
                      <div className="text-xs text-surface-400">{record.product_sku}</div>
                    </td>
                    <td><span className="font-mono text-xs bg-surface-100 px-2 py-1 rounded-lg">{record.batch_number}</span></td>
                    <td>
                      <span className="badge badge-success">{record.result}</span>
                      {record.method && <div className="text-[10px] text-surface-400 mt-1">{record.method}</div>}
                    </td>
                    <td className="text-sm text-surface-500 max-w-xs truncate">{record.remarks || '-'}</td>
                    <td>{imageCount > 0 ? <span className="text-xs text-surface-500 flex items-center gap-1"><ImageIcon size={13} /> {imageCount}</span> : '-'}</td>
                  </tr>
                );
              })}
              {(!records || records.items.length === 0) && (
                <tr><td colSpan={6}><div className="empty-state"><div className="empty-title">{recordsLoading ? 'Loading QC history…' : recordQuery ? 'No history matches this search' : 'No auto-pass history yet'}</div><div className="empty-desc">{recordQuery ? 'Try a different batch, product, or SKU.' : 'Batches you create will appear here.'}</div></div></td></tr>
              )}
            </tbody>
          </table>
        </div>
        <Pagination page={recordPage} pages={records?.pages || 1} onChange={(page) => loadRecords(page)} />
      </div>

      {selectedOrder && (
        <div className="modal-overlay z-50" role="presentation" onClick={() => { if (!actionLoading) { setSelectedOrder(null); setRemarks(''); } }}>
          <section className="modal-content max-w-xl" role="dialog" aria-modal="true" aria-labelledby="qc-review-title" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <div className="min-w-0">
                <div className="flex items-center gap-2"><h2 id="qc-review-title" className="text-base font-semibold text-surface-900">Review dispatch request</h2><span className="badge badge-warning">PENDING</span></div>
                <p className="mt-1 text-xs text-surface-500">Order #{selectedOrder.id} · {selectedOrder.product_name || 'Product'}</p>
              </div>
              <button className="btn-ghost btn-sm" aria-label="Close review" disabled={actionLoading} onClick={() => { setSelectedOrder(null); setRemarks(''); }}><XCircle size={16} /></button>
            </div>
            <div className="modal-body space-y-4">
              <div className="grid grid-cols-2 gap-3 rounded-xl border border-surface-100 bg-surface-50 p-4 text-sm">
                <div><span className="block text-xs text-surface-400">Batch</span><span className="font-mono font-medium">{selectedOrder.batch_number || '-'}</span></div>
                <div><span className="block text-xs text-surface-400">Client</span><span className="font-medium">{selectedOrder.client_name || '-'}</span></div>
                <div><span className="block text-xs text-surface-400">Driver / Vehicle</span><span className="font-medium">{selectedOrder.driver_name || '-'} · {selectedOrder.vehicle_number || '-'}</span></div>
                <div><span className="block text-xs text-surface-400">Container</span><span className="font-medium">{selectedOrder.container_number || '-'}</span></div>
                <div className="col-span-2"><span className="block text-xs text-surface-400">Raised by</span><span className="font-medium">{selectedOrder.raised_by_name || '-'}</span></div>
              </div>
              <div className="space-y-1.5">
                <label className="input-label" htmlFor="qc-approval-remarks">QC remarks <span className="font-normal text-surface-400">(required to reject)</span></label>
                <textarea id="qc-approval-remarks" className="input" rows={3} placeholder="Add a note for the dispatch team (optional for approval)" value={remarks} onChange={(event) => setRemarks(event.target.value)} disabled={actionLoading} />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => { setSelectedOrder(null); setRemarks(''); }} disabled={actionLoading}>Cancel</button>
              <button onClick={() => handleReject(selectedOrder.id)} className="btn-secondary text-rose-600 hover:bg-rose-50 border-rose-200" disabled={actionLoading || !remarks.trim()}>
                <XCircle size={16} /> Reject
              </button>
              <button onClick={() => handleApprove(selectedOrder.id)} className="btn-primary" disabled={actionLoading}>
                <CheckCircle size={16} /> {actionLoading ? 'Saving…' : 'Approve order'}
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
