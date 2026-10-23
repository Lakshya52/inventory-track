import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../services/api';
import {
  FileBarChart, Microscope, Truck, ClipboardList, Boxes, Layers,
  Activity, Download, Search, CheckCircle, XCircle, Eye, X, Calendar,
  IndianRupee, AlertCircle,
} from 'lucide-react';

type Tab = 'overview' | 'qc' | 'dispatch' | 'requests' | 'inventory' | 'batches' | 'activity';

const TABS: { key: Tab; label: string; icon: React.ReactNode }[] = [
  { key: 'overview', label: 'Overview', icon: <FileBarChart size={15} /> },
  { key: 'qc', label: 'QC Reports', icon: <Microscope size={15} /> },
  { key: 'dispatch', label: 'Dispatch Reports', icon: <Truck size={15} /> },
  { key: 'requests', label: 'Dispatch Requests', icon: <ClipboardList size={15} /> },
  { key: 'inventory', label: 'Inventory', icon: <Boxes size={15} /> },
  { key: 'batches', label: 'Batches', icon: <Layers size={15} /> },
  { key: 'activity', label: 'Activity Log', icon: <Activity size={15} /> },
];

const statusBadge: Record<string, string> = {
  CREATED: 'badge-neutral',
  QC_PASSED: 'badge-success',
  QC_FAILED: 'badge-danger',
  DISPATCH_ORDER_RAISED: 'badge-purple',
  DISPATCH_APPROVED: 'badge-info',
  DISPATCH_REJECTED: 'badge-warning',
  DISPATCHED: 'badge-info',
  PASS: 'badge-success',
  FAIL: 'badge-danger',
  PENDING: 'badge-warning',
  APPROVED: 'badge-success',
  REJECTED: 'badge-danger',
};

function parseImages(raw: unknown): string[] {
  if (!raw) return [];
  try {
    const value = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Array.isArray(value) ? value.filter(v => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

function downloadCsv(filename: string, headers: string[], rows: (string | number)[][]): void {
  const escape = (value: string | number) => `"${String(value ?? '').replace(/"/g, '""')}"`;
  const csv = [headers, ...rows].map(row => row.map(escape).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function formatDate(value?: string | null): string {
  if (!value) return '-';
  return new Date(value).toLocaleDateString();
}

export default function Reports() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get('tab') as Tab | null;
  const tab: Tab = TABS.some(t => t.key === tabParam) ? (tabParam as Tab) : 'overview';

  const [summary, setSummary] = useState<any>(null);
  const [qcRecords, setQcRecords] = useState<any[]>([]);
  const [dispatchRecords, setDispatchRecords] = useState<any[]>([]);
  const [requests, setRequests] = useState<any[]>([]);
  const [inventory, setInventory] = useState<any[]>([]);
  const [batches, setBatches] = useState<any[]>([]);
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [qcResult, setQcResult] = useState('ALL');
  const [requestStatus, setRequestStatus] = useState('ALL');
  const [batchStatus, setBatchStatus] = useState('ALL');
  const [search, setSearch] = useState('');

  const [reviewRequest, setReviewRequest] = useState<any | null>(null);
  const [remarks, setRemarks] = useState('');
  const [actionMessage, setActionMessage] = useState('');
  const [imageViewer, setImageViewer] = useState<{ title: string; images: string[] } | null>(null);

  const setTab = (next: Tab) => {
    setSearchParams(next === 'overview' ? {} : { tab: next });
    setSearch('');
    setError('');
  };

  const loadSummary = () => {
    api.reports.summary().then(setSummary).catch(err => setError(err.message));
  };

  useEffect(() => { loadSummary(); }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');

    const run = async () => {
      try {
        if (tab === 'overview') {
          const [pending, recentQc, recentDispatch] = await Promise.all([
            api.reports.dispatchRequests({ status: 'PENDING' }),
            api.reports.qc(),
            api.reports.dispatch(),
          ]);
          if (!cancelled) {
            setRequests(pending);
            setQcRecords(recentQc);
            setDispatchRecords(recentDispatch);
          }
        } else if (tab === 'qc') {
          const data = await api.reports.qc({
            from: from || undefined,
            to: to || undefined,
            result: qcResult === 'ALL' ? undefined : qcResult,
          });
          if (!cancelled) setQcRecords(data);
        } else if (tab === 'dispatch') {
          const data = await api.reports.dispatch({ from: from || undefined, to: to || undefined });
          if (!cancelled) setDispatchRecords(data);
        } else if (tab === 'requests') {
          const data = await api.reports.dispatchRequests({
            from: from || undefined,
            to: to || undefined,
            status: requestStatus === 'ALL' ? undefined : requestStatus,
          });
          if (!cancelled) setRequests(data);
        } else if (tab === 'inventory') {
          const data = await api.reports.inventory();
          if (!cancelled) setInventory(data);
        } else if (tab === 'batches') {
          const data = await api.reports.batches({
            from: from || undefined,
            to: to || undefined,
            status: batchStatus === 'ALL' ? undefined : batchStatus,
          });
          if (!cancelled) setBatches(data);
        } else if (tab === 'activity') {
          const data = await api.activity.list(1, 250);
          if (!cancelled) setLogs(data.logs);
        }
      } catch (err: any) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    run();
    return () => { cancelled = true; };
  }, [tab, from, to, qcResult, requestStatus, batchStatus]);

  const matchesSearch = (values: (string | number | null | undefined)[]) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return values.some(value => String(value ?? '').toLowerCase().includes(q));
  };

  const filteredQc = useMemo(() => qcRecords.filter(r => matchesSearch([
    r.product_name, r.product_sku, r.batch_number, r.tester_name, r.remarks, r.result,
  ])), [qcRecords, search]);

  const filteredDispatch = useMemo(() => dispatchRecords.filter(r => matchesSearch([
    r.product_name, r.product_sku, r.batch_number, r.dispatcher_name, r.remarks,
  ])), [dispatchRecords, search]);

  const filteredRequests = useMemo(() => requests.filter(r => matchesSearch([
    r.product_name, r.product_sku, r.batch_number, r.raised_by_name, r.status, r.admin_remarks,
  ])), [requests, search]);

  const filteredInventory = useMemo(() => inventory.filter(r => matchesSearch([
    r.name, r.sku, r.grade, r.purity, r.cas_number, r.manufacturer,
  ])), [inventory, search]);

  const filteredBatches = useMemo(() => batches.filter(r => matchesSearch([
    r.product_name, r.product_sku, r.batch_number, r.status, r.storage_location,
  ])), [batches, search]);

  const filteredLogs = useMemo(() => logs.filter(r => matchesSearch([
    r.user_name, r.user_role, r.action, r.description,
  ])), [logs, search]);

  const handleExport = () => {
    if (tab === 'qc') {
      downloadCsv(`qc_report_${new Date().toISOString().slice(0, 10)}.csv`,
        ['Date', 'Product', 'SKU', 'Batch', 'Tester', 'Result', 'Remarks'],
        filteredQc.map(r => [new Date(r.created_at).toLocaleString(), r.product_name, r.product_sku, r.batch_number, r.tester_name, r.result, r.remarks || '']));
    } else if (tab === 'dispatch') {
      downloadCsv(`dispatch_report_${new Date().toISOString().slice(0, 10)}.csv`,
        ['Date', 'Product', 'SKU', 'Batch', 'Quantity', 'UOM', 'Dispatched By', 'Remarks'],
        filteredDispatch.map(r => [new Date(r.created_at).toLocaleString(), r.product_name, r.product_sku, r.batch_number, r.quantity, r.uom || '', r.dispatcher_name, r.remarks || '']));
    } else if (tab === 'requests') {
      downloadCsv(`dispatch_requests_${new Date().toISOString().slice(0, 10)}.csv`,
        ['Date', 'Product', 'SKU', 'Batch', 'Quantity', 'Raised By', 'Status', 'Admin Remarks'],
        filteredRequests.map(r => [new Date(r.created_at).toLocaleString(), r.product_name, r.product_sku, r.batch_number, r.quantity, r.raised_by_name, r.status, r.admin_remarks || '']));
    } else if (tab === 'inventory') {
      downloadCsv(`inventory_report_${new Date().toISOString().slice(0, 10)}.csv`,
        ['Product', 'SKU', 'Grade', 'Purity', 'CAS', 'Price', 'Stock Qty', 'Batch Qty', 'QC Passed Qty', 'Stock Value', 'Batches'],
        filteredInventory.map(r => [r.name, r.sku, r.grade || '', r.purity || '', r.cas_number || '', r.price, r.quantity, r.batch_quantity, r.qc_passed_quantity, r.stock_value, r.batch_count]));
    } else if (tab === 'batches') {
      downloadCsv(`batches_report_${new Date().toISOString().slice(0, 10)}.csv`,
        ['Created', 'Product', 'SKU', 'Batch', 'Quantity', 'UOM', 'Status', 'Mfg Date', 'Expiry Date', 'Location'],
        filteredBatches.map(r => [new Date(r.created_at).toLocaleString(), r.product_name, r.product_sku, r.batch_number, r.quantity, r.uom || '', r.status, r.manufacturing_date || '', r.expiry_date || '', r.storage_location || '']));
    } else if (tab === 'activity') {
      downloadCsv(`activity_log_${new Date().toISOString().slice(0, 10)}.csv`,
        ['Time', 'User', 'Role', 'Action', 'Description'],
        filteredLogs.map(r => [new Date(r.created_at).toLocaleString(), r.user_name || '', r.user_role || '', r.action, r.description || '']));
    }
  };

  const handleReview = (request: any) => {
    setReviewRequest(request);
    setRemarks(request.admin_remarks || '');
    setActionMessage('');
  };

  const handleAction = async (action: 'approve' | 'reject') => {
    if (!reviewRequest) return;
    try {
      if (action === 'approve') {
        await api.dispatchOrders.approve(reviewRequest.id, remarks || undefined);
        setActionMessage('Dispatch request approved');
      } else {
        await api.dispatchOrders.reject(reviewRequest.id, remarks || undefined);
        setActionMessage('Dispatch request rejected');
      }
      setReviewRequest(null);
      setRemarks('');
      loadSummary();
      const data = await api.reports.dispatchRequests({
        from: from || undefined,
        to: to || undefined,
        status: requestStatus === 'ALL' ? undefined : requestStatus,
      });
      setRequests(data);
    } catch (err: any) {
      setActionMessage(`Error: ${err.message}`);
    }
  };

  const showFilters = ['qc', 'dispatch', 'requests', 'batches'].includes(tab);
  const showSearch = ['qc', 'dispatch', 'requests', 'inventory', 'batches', 'activity'].includes(tab);

  const overviewCards = summary ? [
    { label: 'QC Checks', value: summary.qcTotal, icon: <Microscope size={18} />, color: 'text-emerald-600', bg: 'bg-emerald-50' },
    { label: 'QC Pass Rate', value: `${summary.qcPassRate}%`, icon: <CheckCircle size={18} />, color: 'text-brand-600', bg: 'bg-brand-50' },
    { label: 'Dispatches', value: summary.dispatchTotal, icon: <Truck size={18} />, color: 'text-sky-600', bg: 'bg-sky-50' },
    { label: 'Pending Requests', value: summary.pendingRequests, icon: <ClipboardList size={18} />, color: 'text-amber-600', bg: 'bg-amber-50' },
    { label: 'Products', value: summary.totalProducts, icon: <Boxes size={18} />, color: 'text-violet-600', bg: 'bg-violet-50' },
    { label: 'Inventory Value', value: `₹${Number(summary.inventoryValue).toLocaleString('en-IN')}`, icon: <IndianRupee size={18} />, color: 'text-teal-600', bg: 'bg-teal-50' },
  ] : [];

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1 className="page-title">Reports & Logs</h1>
          <p className="page-subtitle">Every QC check, dispatch, dispatch request, product and inventory record</p>
        </div>
        {['qc', 'dispatch', 'requests', 'inventory', 'batches', 'activity'].includes(tab) && (
          <button onClick={handleExport} className="btn-secondary"><Download size={16} /> Export CSV</button>
        )}
      </div>

      {error && (
        <div className="mb-4 p-3 rounded-xl text-sm bg-rose-50 text-rose-700 border border-rose-200 flex items-center justify-between">
          <span className="flex items-center gap-2"><AlertCircle size={16} />{error}</span>
          <button onClick={() => setError('')}><X size={14} /></button>
        </div>
      )}

      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 mb-6">
          {overviewCards.map(card => (
            <div key={card.label} className="card p-4">
              <div className={`w-8 h-8 rounded-xl ${card.bg} ${card.color} flex items-center justify-center mb-2`}>{card.icon}</div>
              <div className="text-xl font-bold text-surface-900">{card.value}</div>
              <div className="text-xs text-surface-400">{card.label}</div>
            </div>
          ))}
        </div>
      )}

      <div className="flex gap-1 mb-4 overflow-x-auto pb-1">
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium whitespace-nowrap transition-all ${
              tab === t.key ? 'bg-brand-600 text-white shadow-sm' : 'bg-white text-surface-600 hover:bg-surface-100'
            }`}
          >
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {(showFilters || showSearch) && (
        <div className="card p-4 mb-4">
          <div className="flex flex-wrap items-end gap-3">
            {showSearch && (
              <div className="relative flex-1 min-w-[220px]">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-surface-400" />
                <input className="input pl-9" placeholder="Search records..." value={search} onChange={e => setSearch(e.target.value)} />
              </div>
            )}
            {showFilters && (
              <>
                <div>
                  <label className="input-label">From</label>
                  <input type="date" className="input" value={from} onChange={e => setFrom(e.target.value)} />
                </div>
                <div>
                  <label className="input-label">To</label>
                  <input type="date" className="input" value={to} onChange={e => setTo(e.target.value)} />
                </div>
              </>
            )}
            {tab === 'qc' && (
              <div>
                <label className="input-label">Result</label>
                <select className="input min-w-[130px]" value={qcResult} onChange={e => setQcResult(e.target.value)}>
                  <option value="ALL">All results</option>
                  <option value="PASS">Pass</option>
                  <option value="FAIL">Fail</option>
                </select>
              </div>
            )}
            {tab === 'requests' && (
              <div>
                <label className="input-label">Status</label>
                <select className="input min-w-[140px]" value={requestStatus} onChange={e => setRequestStatus(e.target.value)}>
                  <option value="ALL">All statuses</option>
                  <option value="PENDING">Pending</option>
                  <option value="APPROVED">Approved</option>
                  <option value="REJECTED">Rejected</option>
                </select>
              </div>
            )}
            {tab === 'batches' && (
              <div>
                <label className="input-label">Status</label>
                <select className="input min-w-[170px]" value={batchStatus} onChange={e => setBatchStatus(e.target.value)}>
                  <option value="ALL">All statuses</option>
                  <option value="CREATED">Created</option>
                  <option value="QC_PASSED">QC Passed</option>
                  <option value="QC_FAILED">QC Failed</option>
                  <option value="DISPATCH_ORDER_RAISED">Order Raised</option>
                  <option value="DISPATCH_APPROVED">Approved</option>
                  <option value="DISPATCH_REJECTED">Rejected</option>
                  <option value="DISPATCHED">Dispatched</option>
                </select>
              </div>
            )}
            {(from || to || qcResult !== 'ALL' || requestStatus !== 'ALL' || batchStatus !== 'ALL' || search) && (
              <button
                onClick={() => { setFrom(''); setTo(''); setQcResult('ALL'); setRequestStatus('ALL'); setBatchStatus('ALL'); setSearch(''); }}
                className="btn-ghost btn-sm"
              >
                <X size={14} /> Clear
              </button>
            )}
          </div>
        </div>
      )}

      {loading && (
        <div className="card p-10 text-center text-sm text-surface-400">Loading report data...</div>
      )}

      {!loading && tab === 'overview' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="card">
            <div className="card-header flex items-center justify-between">
              <h3 className="section-title flex items-center gap-2"><ClipboardList size={16} className="text-amber-500" /> Pending Dispatch Requests</h3>
              <button onClick={() => setTab('requests')} className="text-xs text-brand-600">View all</button>
            </div>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Product</th><th>Batch</th><th>Raised By</th><th>Action</th></tr></thead>
                <tbody>
                  {filteredRequests.slice(0, 8).map(r => (
                    <tr key={r.id}>
                      <td>
                        <div className="font-medium text-surface-800">{r.product_name}</div>
                        <div className="text-xs text-surface-400">{r.product_sku}</div>
                      </td>
                      <td><span className="font-mono text-xs bg-surface-100 px-2 py-1 rounded-lg">{r.batch_number}</span></td>
                      <td className="text-sm">{r.raised_by_name || '-'}</td>
                      <td><button onClick={() => handleReview(r)} className="btn-primary btn-xs">Review</button></td>
                    </tr>
                  ))}
                  {filteredRequests.length === 0 && <tr><td colSpan={4}><div className="empty-state py-8"><div className="empty-title">No pending requests</div></div></td></tr>}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card">
            <div className="card-header flex items-center justify-between">
              <h3 className="section-title flex items-center gap-2"><Microscope size={16} className="text-emerald-500" /> Recent QC Results</h3>
              <button onClick={() => setTab('qc')} className="text-xs text-brand-600">View all</button>
            </div>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Product</th><th>Batch</th><th>Result</th><th>Date</th></tr></thead>
                <tbody>
                  {filteredQc.slice(0, 8).map(r => (
                    <tr key={r.id}>
                      <td>
                        <div className="font-medium text-surface-800">{r.product_name}</div>
                        <div className="text-xs text-surface-400">{r.product_sku}</div>
                      </td>
                      <td><span className="font-mono text-xs bg-surface-100 px-2 py-1 rounded-lg">{r.batch_number}</span></td>
                      <td><span className={`badge ${statusBadge[r.result] || 'badge-neutral'}`}>{r.result}</span></td>
                      <td className="text-xs text-surface-400">{formatDate(r.created_at)}</td>
                    </tr>
                  ))}
                  {filteredQc.length === 0 && <tr><td colSpan={4}><div className="empty-state py-8"><div className="empty-title">No QC records yet</div></div></td></tr>}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card lg:col-span-2">
            <div className="card-header flex items-center justify-between">
              <h3 className="section-title flex items-center gap-2"><Truck size={16} className="text-sky-500" /> Recent Dispatches</h3>
              <button onClick={() => setTab('dispatch')} className="text-xs text-brand-600">View all</button>
            </div>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Date</th><th>Product</th><th>Batch</th><th>Qty</th><th>Dispatched By</th><th>Remarks</th></tr></thead>
                <tbody>
                  {filteredDispatch.slice(0, 8).map(r => (
                    <tr key={r.id}>
                      <td className="text-xs text-surface-400">{new Date(r.created_at).toLocaleString()}</td>
                      <td><span className="font-medium text-surface-800">{r.product_name}</span><div className="text-xs text-surface-400">{r.product_sku}</div></td>
                      <td><span className="font-mono text-xs bg-surface-100 px-2 py-1 rounded-lg">{r.batch_number}</span></td>
                      <td className="text-sm">{r.quantity} {r.uom || ''}</td>
                      <td className="text-sm">{r.dispatcher_name || '-'}</td>
                      <td className="text-sm text-surface-500">{r.remarks || '-'}</td>
                    </tr>
                  ))}
                  {filteredDispatch.length === 0 && <tr><td colSpan={6}><div className="empty-state py-8"><div className="empty-title">No dispatches yet</div></div></td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {!loading && tab === 'qc' && (
        <div className="card">
          <div className="card-header flex items-center justify-between">
            <h3 className="section-title flex items-center gap-2"><Microscope size={16} className="text-emerald-500" /> QC Reports</h3>
            <span className="text-xs text-surface-400">{filteredQc.length} records</span>
          </div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Date</th><th>Product</th><th>Batch</th><th>Tester</th><th>Result</th><th>Remarks</th><th>Evidence</th></tr></thead>
              <tbody>
                {filteredQc.map(r => {
                  const images = parseImages(r.images);
                  return (
                    <tr key={r.id}>
                      <td className="text-xs text-surface-400">{new Date(r.created_at).toLocaleString()}</td>
                      <td><div className="font-medium text-surface-800">{r.product_name}</div><div className="text-xs text-surface-400">{r.product_sku}{r.grade ? ` · ${r.grade}` : ''}</div></td>
                      <td><span className="font-mono text-xs bg-surface-100 px-2 py-1 rounded-lg">{r.batch_number}</span></td>
                      <td className="text-sm">{r.tester_name || '-'}</td>
                      <td><span className={`badge ${statusBadge[r.result] || 'badge-neutral'}`}>{r.result}</span></td>
                      <td className="text-sm text-surface-500 max-w-[220px]">{r.remarks || '-'}</td>
                      <td>
                        {images.length > 0
                          ? <button onClick={() => setImageViewer({ title: `${r.product_name} · ${r.batch_number}`, images })} className="btn-secondary btn-xs"><Eye size={12} /> {images.length}</button>
                          : <span className="text-xs text-surface-400">-</span>}
                      </td>
                    </tr>
                  );
                })}
                {filteredQc.length === 0 && <tr><td colSpan={7}><div className="empty-state"><div className="empty-title">No QC records found</div><div className="empty-desc">Try changing the date range or result filter</div></div></td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {!loading && tab === 'dispatch' && (
        <div className="card">
          <div className="card-header flex items-center justify-between">
            <h3 className="section-title flex items-center gap-2"><Truck size={16} className="text-sky-500" /> Dispatch Reports</h3>
            <span className="text-xs text-surface-400">{filteredDispatch.length} records</span>
          </div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Date</th><th>Product</th><th>Batch</th><th>Qty</th><th>Location</th><th>Dispatched By</th><th>Remarks</th><th>Evidence</th></tr></thead>
              <tbody>
                {filteredDispatch.map(r => {
                  const images = parseImages(r.images);
                  return (
                    <tr key={r.id}>
                      <td className="text-xs text-surface-400">{new Date(r.created_at).toLocaleString()}</td>
                      <td><div className="font-medium text-surface-800">{r.product_name}</div><div className="text-xs text-surface-400">{r.product_sku}</div></td>
                      <td><span className="font-mono text-xs bg-surface-100 px-2 py-1 rounded-lg">{r.batch_number}</span></td>
                      <td className="text-sm">{r.quantity} {r.uom || ''}</td>
                      <td className="text-sm">{r.storage_location || '-'}</td>
                      <td className="text-sm">{r.dispatcher_name || '-'}</td>
                      <td className="text-sm text-surface-500 max-w-[220px]">{r.remarks || '-'}</td>
                      <td>
                        {images.length > 0
                          ? <button onClick={() => setImageViewer({ title: `${r.product_name} · ${r.batch_number}`, images })} className="btn-secondary btn-xs"><Eye size={12} /> {images.length}</button>
                          : <span className="text-xs text-surface-400">-</span>}
                      </td>
                    </tr>
                  );
                })}
                {filteredDispatch.length === 0 && <tr><td colSpan={8}><div className="empty-state"><div className="empty-title">No dispatch records found</div><div className="empty-desc">Try changing the date range</div></div></td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {!loading && tab === 'requests' && (
        <div className="card">
          <div className="card-header flex items-center justify-between">
            <h3 className="section-title flex items-center gap-2"><ClipboardList size={16} className="text-amber-500" /> Dispatch Requests</h3>
            <span className="text-xs text-surface-400">{filteredRequests.length} records</span>
          </div>
          {actionMessage && (
            <div className={`mx-6 mt-4 p-3 rounded-xl text-sm ${actionMessage.startsWith('Error') ? 'bg-rose-50 text-rose-700 border border-rose-200' : 'bg-emerald-50 text-emerald-700 border border-emerald-200'}`}>
              {actionMessage}
            </div>
          )}
          <div className="table-wrap">
            <table>
              <thead><tr><th>Date</th><th>Product</th><th>Batch</th><th>Qty</th><th>Raised By</th><th>Status</th><th>Admin Remarks</th><th>Actions</th></tr></thead>
              <tbody>
                {filteredRequests.map(r => (
                  <tr key={r.id}>
                    <td className="text-xs text-surface-400">{new Date(r.created_at).toLocaleString()}</td>
                    <td><div className="font-medium text-surface-800">{r.product_name}</div><div className="text-xs text-surface-400">{r.product_sku}</div></td>
                    <td><span className="font-mono text-xs bg-surface-100 px-2 py-1 rounded-lg">{r.batch_number}</span></td>
                    <td className="text-sm">{r.quantity} {r.uom || ''}</td>
                    <td className="text-sm">{r.raised_by_name || '-'}</td>
                    <td><span className={`badge ${statusBadge[r.status] || 'badge-neutral'}`}>{r.status}</span></td>
                    <td className="text-sm text-surface-500 max-w-[220px]">{r.admin_remarks || '-'}</td>
                    <td>
                      {r.status === 'PENDING'
                        ? <button onClick={() => handleReview(r)} className="btn-primary btn-xs">Review</button>
                        : <span className="text-xs text-surface-400">{r.admin_name ? `by ${r.admin_name}` : '-'}</span>}
                    </td>
                  </tr>
                ))}
                {filteredRequests.length === 0 && <tr><td colSpan={8}><div className="empty-state"><div className="empty-title">No dispatch requests found</div><div className="empty-desc">Try changing the date range or status filter</div></div></td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {!loading && tab === 'inventory' && (
        <div className="card">
          <div className="card-header flex items-center justify-between">
            <h3 className="section-title flex items-center gap-2"><Boxes size={16} className="text-violet-500" /> Products & Inventory</h3>
            <span className="text-xs text-surface-400">{filteredInventory.length} products</span>
          </div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Product</th><th>Grade / Purity</th><th>Price</th><th>Stock Qty</th><th>Batch Qty</th><th>QC Passed Qty</th><th>Stock Value</th><th>Batches</th></tr></thead>
              <tbody>
                {filteredInventory.map(r => (
                  <tr key={r.id}>
                    <td>
                      <div className="font-medium text-surface-800">{r.name}</div>
                      <div className="text-xs text-surface-400">{r.sku}{r.cas_number ? ` · CAS ${r.cas_number}` : ''}</div>
                    </td>
                    <td className="text-sm">{r.grade || '-'}{r.purity ? ` · ${r.purity}` : ''}</td>
                    <td className="text-sm">{Number(r.price) > 0 ? `₹${Number(r.price).toLocaleString('en-IN')}` : '-'}</td>
                    <td className="text-sm font-medium">{Number(r.quantity).toLocaleString('en-IN')}</td>
                    <td className="text-sm">{Number(r.batch_quantity).toLocaleString('en-IN')}</td>
                    <td className="text-sm text-emerald-600">{Number(r.qc_passed_quantity).toLocaleString('en-IN')}</td>
                    <td className="text-sm font-medium">₹{Number(r.stock_value).toLocaleString('en-IN')}</td>
                    <td className="text-sm">{r.batch_count}</td>
                  </tr>
                ))}
                {filteredInventory.length === 0 && <tr><td colSpan={8}><div className="empty-state"><div className="empty-title">No products found</div></div></td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {!loading && tab === 'batches' && (
        <div className="card">
          <div className="card-header flex items-center justify-between">
            <h3 className="section-title flex items-center gap-2"><Layers size={16} className="text-brand-500" /> Batch Report</h3>
            <span className="text-xs text-surface-400">{filteredBatches.length} batches</span>
          </div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Created</th><th>Product</th><th>Batch</th><th>Qty</th><th>Status</th><th>Mfg Date</th><th>Expiry Date</th><th>Location</th></tr></thead>
              <tbody>
                {filteredBatches.map(r => (
                  <tr key={r.id}>
                    <td className="text-xs text-surface-400">{formatDate(r.created_at)}</td>
                    <td><div className="font-medium text-surface-800">{r.product_name}</div><div className="text-xs text-surface-400">{r.product_sku}</div></td>
                    <td><span className="font-mono text-xs bg-surface-100 px-2 py-1 rounded-lg">{r.batch_number}</span></td>
                    <td className="text-sm">{r.quantity} {r.uom || ''}</td>
                    <td><span className={`badge ${statusBadge[r.status] || 'badge-neutral'}`}>{r.status}</span></td>
                    <td className="text-xs text-surface-400">{formatDate(r.manufacturing_date)}</td>
                    <td className="text-xs text-surface-400">{formatDate(r.expiry_date)}</td>
                    <td className="text-sm">{r.storage_location || '-'}</td>
                  </tr>
                ))}
                {filteredBatches.length === 0 && <tr><td colSpan={8}><div className="empty-state"><div className="empty-title">No batches found</div><div className="empty-desc">Try changing the date range or status filter</div></div></td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {!loading && tab === 'activity' && (
        <div className="card">
          <div className="card-header flex items-center justify-between">
            <h3 className="section-title flex items-center gap-2"><Activity size={16} className="text-surface-500" /> System Activity Log</h3>
            <span className="text-xs text-surface-400">{filteredLogs.length} entries</span>
          </div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Time</th><th>User</th><th>Role</th><th>Action</th><th>Description</th></tr></thead>
              <tbody>
                {filteredLogs.map(r => (
                  <tr key={r.id}>
                    <td className="text-xs text-surface-400">{new Date(r.created_at).toLocaleString()}</td>
                    <td className="text-sm">{r.user_name || '-'}</td>
                    <td className="text-sm">{r.user_role || '-'}</td>
                    <td><span className="badge badge-neutral">{r.action}</span></td>
                    <td className="text-sm text-surface-500">{r.description || '-'}</td>
                  </tr>
                ))}
                {filteredLogs.length === 0 && <tr><td colSpan={5}><div className="empty-state"><div className="empty-title">No activity found</div></div></td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {reviewRequest && (
        <div className="modal-overlay" onClick={() => setReviewRequest(null)}>
          <div className="modal-content max-w-lg" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h2 className="text-base font-semibold text-surface-900">Review Dispatch Request</h2>
                <p className="text-xs text-surface-400 mt-0.5">Order #{reviewRequest.id} · {reviewRequest.product_name} · {reviewRequest.batch_number}</p>
              </div>
              <button onClick={() => setReviewRequest(null)} className="btn-ghost btn-sm"><X size={16} /></button>
            </div>
            <div className="modal-body space-y-4">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="bg-surface-50 rounded-xl p-3"><div className="text-xs text-surface-400">Product</div><div className="font-medium text-surface-800">{reviewRequest.product_name}</div></div>
                <div className="bg-surface-50 rounded-xl p-3"><div className="text-xs text-surface-400">Batch</div><div className="font-mono text-xs text-surface-800">{reviewRequest.batch_number}</div></div>
                <div className="bg-surface-50 rounded-xl p-3"><div className="text-xs text-surface-400">Quantity</div><div className="font-medium text-surface-800">{reviewRequest.quantity} {reviewRequest.uom || ''}</div></div>
                <div className="bg-surface-50 rounded-xl p-3"><div className="text-xs text-surface-400">Raised By</div><div className="font-medium text-surface-800">{reviewRequest.raised_by_name || '-'}</div></div>
              </div>
              <div className="space-y-1.5">
                <label className="input-label">Admin Remarks</label>
                <textarea className="input" rows={3} value={remarks} onChange={e => setRemarks(e.target.value)} placeholder="Optional remarks for the dispatch team" />
              </div>
            </div>
            <div className="modal-footer">
              <button onClick={() => setReviewRequest(null)} className="btn-secondary">Cancel</button>
              <button onClick={() => handleAction('reject')} className="btn-danger"><XCircle size={16} /> Reject</button>
              <button onClick={() => handleAction('approve')} className="btn-primary"><CheckCircle size={16} /> Approve</button>
            </div>
          </div>
        </div>
      )}

      {imageViewer && (
        <div className="modal-overlay" onClick={() => setImageViewer(null)}>
          <div className="modal-content max-w-3xl" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="text-base font-semibold text-surface-900">Evidence · {imageViewer.title}</h2>
              <button onClick={() => setImageViewer(null)} className="btn-ghost btn-sm"><X size={16} /></button>
            </div>
            <div className="modal-body grid grid-cols-1 sm:grid-cols-2 gap-4">
              {imageViewer.images.map((image, index) => (
                <a key={`${image}-${index}`} href={`/uploads/${image}`} target="_blank" rel="noreferrer" className="block rounded-xl overflow-hidden border border-surface-200 hover:border-brand-300">
                  <img src={`/uploads/${image}`} alt={`Evidence ${index + 1}`} className="w-full h-48 object-cover" />
                </a>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
