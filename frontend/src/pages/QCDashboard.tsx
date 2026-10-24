import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../services/api';
import {
  Microscope, CheckCircle, XCircle, Clock, TrendingUp, RefreshCw, Search,
  ChevronLeft, ChevronRight, ArrowRight, Image as ImageIcon, AlertTriangle, QrCode,
  Tags,
} from 'lucide-react';

type PageData = { items: any[]; total: number; page: number; limit: number; pages: number };

function formatAge(minutes: number | string | null | undefined): string {
  const value = Number(minutes || 0);
  if (value < 60) return `${value}m`;
  const hours = Math.floor(value / 60);
  const mins = value % 60;
  return `${hours}h ${mins}m`;
}

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
  const navigate = useNavigate();
  const [stats, setStats] = useState<any>(null);
  const [pending, setPending] = useState<PageData | null>(null);
  const [records, setRecords] = useState<PageData | null>(null);
  const [pendingQuery, setPendingQuery] = useState('');
  const [recordQuery, setRecordQuery] = useState('');
  const [resultFilter, setResultFilter] = useState('');
  const [pendingPage, setPendingPage] = useState(1);
  const [recordPage, setRecordPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const loadStats = useCallback(async () => {
    const data = await api.qc.stats();
    setStats(data);
  }, []);

  const loadPending = useCallback(async (page = 1, q = pendingQuery) => {
    const data = await api.qc.pending({ page, limit: 8, q });
    setPending(data);
    setPendingPage(data.page);
  }, [pendingQuery]);

  const loadRecords = useCallback(async (page = 1, q = recordQuery, result = resultFilter) => {
    const data = await api.qc.records({ page, limit: 8, q, result: result || undefined, scope: 'mine' });
    setRecords(data);
    setRecordPage(data.page);
  }, [recordQuery, resultFilter]);

  const loadAll = useCallback(async (showSpinner = false) => {
    if (showSpinner) setRefreshing(true);
    setError('');
    try {
      await Promise.all([loadStats(), loadPending(pendingPage), loadRecords(recordPage)]);
    } catch (err: any) {
      setError(err.message || 'Could not load the QC dashboard');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [loadStats, loadPending, loadRecords, pendingPage, recordPage]);

  useEffect(() => { loadAll(); }, []); // Initial load only.

  useEffect(() => {
    const timer = setTimeout(() => {
      loadPending(1).catch((err) => setError(err.message));
    }, 300);
    return () => clearTimeout(timer);
  }, [pendingQuery]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const timer = setTimeout(() => {
      loadRecords(1).catch((err) => setError(err.message));
    }, 300);
    return () => clearTimeout(timer);
  }, [recordQuery, resultFilter]); // eslint-disable-line react-hooks/exhaustive-deps

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
    { label: 'Pending QC', value: stats?.pendingQc ?? 0, icon: <Clock size={18} />, color: 'text-purple-600', bg: 'bg-purple-50' },
    { label: 'My Total Tests', value: stats?.myTotalTests ?? 0, icon: <Microscope size={18} />, color: 'text-slate-600', bg: 'bg-slate-50' },
  ];

  const trend = (stats?.trend || []).map((row: any) => ({
    day: new Date(row.day).toLocaleDateString(undefined, { weekday: 'short' }),
    total: Number(row.total || 0),
    passed: Number(row.passed || 0),
    failed: Number(row.failed || 0),
  }));
  const maxTrend = Math.max(1, ...trend.map((row: any) => row.total));

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1 className="page-title">QC Dashboard</h1>
          <p className="page-subtitle">Your testing queue, personal performance, and complete test history</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button className="btn-secondary btn-sm" onClick={() => loadAll(true)} disabled={refreshing}>
            <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} /> Refresh
          </button>
          <Link to="/batches" className="btn-secondary btn-sm">
            <Tags size={14} /> Manage Batches
          </Link>
          <Link to="/qc" className="btn-primary btn-sm">
            <Microscope size={14} /> Start QC Group Scan
          </Link>
        </div>
      </div>

      {error && (
        <div className="mb-4 p-3 rounded-xl text-sm flex items-center gap-2 bg-rose-50 text-rose-700 border border-rose-200">
          <AlertTriangle size={16} /> {error}
        </div>
      )}

      <div className="card mb-6 border border-brand-100 bg-brand-50/60 p-4 sm:p-5">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white text-brand-600 shadow-sm">
            <QrCode size={18} />
          </div>
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-surface-900">When are product QR labels generated?</h2>
            <p className="mt-1 text-sm leading-6 text-surface-600">
              QC manages batches from creation through QC decisions and finished-goods details. After a batch passes,
              complete its details from <strong>Batches</strong> to generate one product QR label per unit.
              QR labels can then be downloaded by Admin or reviewed and reprinted by QC from the QR Labels page.
            </p>
            <Link to="/qc/qr-codes" className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-brand-700 hover:text-brand-800">
              Review QR Labels <ArrowRight size={13} />
            </Link>
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
        <div className="card xl:col-span-2">
          <div className="card-header flex items-center justify-between gap-3">
            <h3 className="section-title flex items-center gap-2">
              <Clock size={16} className="text-purple-500" /> Pending QC Queue
              <span className="badge badge-warning">{pending?.total ?? stats?.pendingQc ?? 0}</span>
            </h3>
            <div className="relative w-56 max-w-full">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-surface-400" />
              <input
                className="input pl-9 py-1.5 text-xs"
                placeholder="Search batch or product"
                value={pendingQuery}
                onChange={(event) => setPendingQuery(event.target.value)}
              />
            </div>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Batch</th><th>Product</th><th>Qty</th><th>Location</th><th>Age</th><th></th></tr>
              </thead>
              <tbody>
                {(pending?.items || []).map((batch: any) => (
                  <tr key={batch.id}>
                    <td>
                      <div className="font-mono text-xs bg-surface-100 px-2 py-1 rounded-lg inline-block">{batch.batch_number}</div>
                      <div className="text-[10px] text-surface-400 mt-1">{batch.barcode_value}</div>
                    </td>
                    <td>
                      <div className="font-medium text-surface-800">{batch.product_name}</div>
                      <div className="text-xs text-surface-400">{batch.product_sku}</div>
                    </td>
                    <td className="text-sm text-surface-600">{batch.quantity} {batch.uom || ''}</td>
                    <td className="text-sm text-surface-500">{batch.storage_location || '-'}</td>
                    <td>
                      <span className={`badge ${Number(batch.age_minutes) > 240 ? 'badge-danger' : Number(batch.age_minutes) > 60 ? 'badge-warning' : 'badge-neutral'}`}>
                        {formatAge(batch.age_minutes)}
                      </span>
                    </td>
                    <td>
                      <button
                        className="btn-primary btn-xs"
                        onClick={() => navigate(`/qc?barcode=${encodeURIComponent(batch.barcode_value)}`)}
                      >
                        Test <ArrowRight size={12} />
                      </button>
                    </td>
                  </tr>
                ))}
                {(!pending || pending.items.length === 0) && (
                  <tr><td colSpan={6}><div className="empty-state"><div className="empty-title">No batches waiting for QC</div></div></td></tr>
                )}
              </tbody>
            </table>
          </div>
          <Pagination page={pendingPage} pages={pending?.pages || 1} onChange={(page) => loadPending(page)} />
        </div>

        <div className="card">
          <div className="card-header"><h3 className="section-title flex items-center gap-2"><TrendingUp size={16} className="text-indigo-500" /> Last 7 Days</h3></div>
          <div className="card-body">
            <div className="flex items-end gap-2 h-40">
              {trend.map((row: any) => (
                <div key={row.day} className="flex-1 flex flex-col items-center gap-1">
                  <span className="text-[10px] font-semibold text-surface-500">{row.total}</span>
                  <div className="w-full flex flex-col justify-end rounded-t-lg overflow-hidden bg-surface-100" style={{ height: `${Math.max(6, (row.total / maxTrend) * 110)}px` }}>
                    {row.total > 0 && (
                      <>
                        <div className="bg-emerald-400" style={{ height: `${(row.passed / row.total) * 100}%` }} />
                        <div className="bg-rose-400" style={{ height: `${(row.failed / row.total) * 100}%` }} />
                      </>
                    )}
                  </div>
                  <span className="text-[10px] text-surface-400">{row.day}</span>
                </div>
              ))}
              {trend.length === 0 && <div className="flex-1 text-center text-xs text-surface-400">No tests yet</div>}
            </div>
            <div className="flex items-center justify-center gap-4 mt-4 text-[10px] text-surface-400">
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-400" /> Pass</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-rose-400" /> Fail</span>
            </div>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-header flex flex-wrap items-center justify-between gap-3">
          <h3 className="section-title flex items-center gap-2">
            <Microscope size={16} className="text-surface-400" /> My Test History
            <span className="badge badge-neutral">{records?.total ?? 0}</span>
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
            <select className="input py-1.5 text-xs w-32" value={resultFilter} onChange={(event) => setResultFilter(event.target.value)}>
              <option value="">All results</option>
              <option value="PASS">PASS</option>
              <option value="FAIL">FAIL</option>
            </select>
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
                    <td><span className={`badge ${record.result === 'PASS' ? 'badge-success' : 'badge-danger'}`}>{record.result}</span></td>
                    <td className="text-sm text-surface-500 max-w-xs truncate">{record.remarks || '-'}</td>
                    <td>{imageCount > 0 ? <span className="text-xs text-surface-500 flex items-center gap-1"><ImageIcon size={13} /> {imageCount}</span> : '-'}</td>
                  </tr>
                );
              })}
              {(!records || records.items.length === 0) && (
                <tr><td colSpan={6}><div className="empty-state"><div className="empty-title">No QC tests match this filter</div></div></td></tr>
              )}
            </tbody>
          </table>
        </div>
        <Pagination page={recordPage} pages={records?.pages || 1} onChange={(page) => loadRecords(page)} />
      </div>
    </div>
  );
}
