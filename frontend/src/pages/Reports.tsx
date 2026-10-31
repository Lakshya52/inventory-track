import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { jsPDF } from 'jspdf';
import { api, uploadUrl } from '../services/api';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import {
  FileBarChart, Microscope, Truck, ClipboardList, Boxes, Layers,
  Activity, Download, Search, CheckCircle, Eye, X,
  IndianRupee, AlertCircle,
} from 'lucide-react';

type Tab = 'overview' | 'qc' | 'dispatch' | 'requests' | 'inventory' | 'batches' | 'activity';

const TABS: { key: Tab; label: string; icon: any }[] = [
  { key: 'overview', label: 'Overview', icon: FileBarChart },
  { key: 'qc', label: 'QC Reports', icon: Microscope },
  { key: 'dispatch', label: 'Dispatch Reports', icon: Truck },
  { key: 'requests', label: 'Dispatch Requests', icon: ClipboardList },
  { key: 'inventory', label: 'Inventory', icon: Boxes },
  { key: 'batches', label: 'Batches', icon: Layers },
  { key: 'activity', label: 'Activity Log', icon: Activity },
];

const statusBadge: Record<string, string> = {
  QC_PASSED: 'badge-success',
  DISPATCH_ORDER_RAISED: 'badge-purple',
  DISPATCH_APPROVED: 'badge-info',
  LOADING: 'badge-info',
  DISPATCHED: 'badge-success',
  NOT_DISPATCHED: 'badge-danger',
  PASS: 'badge-success',
  PENDING: 'badge-warning',
  APPROVED: 'badge-success',
  REJECTED: 'badge-danger',
  CLOSED_DISPATCHED: 'badge-success',
  CLOSED_NOT_DISPATCHED: 'badge-danger',
};

const statusLabel: Record<string, string> = {
  QC_PASSED: 'QC Passed',
  DISPATCH_ORDER_RAISED: 'Order Raised',
  DISPATCH_APPROVED: 'Approved',
  LOADING: 'Loading',
  DISPATCHED: 'Dispatched',
  NOT_DISPATCHED: 'Not Dispatched',
  PENDING: 'Pending',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  CLOSED_DISPATCHED: 'Dispatched',
  CLOSED_NOT_DISPATCHED: 'Not Dispatched',
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
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function downloadPdf(filename: string, title: string, headers: string[], rows: (string | number)[][]): void {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 10;
  const tableWidth = pageWidth - margin * 2;
  const columnWidth = tableWidth / headers.length;
  let y = 12;

  const drawHeader = () => {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.text(title, margin, y);
    y += 8;
    doc.setFontSize(7);
    const cells = headers.map((header, index) => ({
      text: doc.splitTextToSize(header, columnWidth - 2),
      x: margin + index * columnWidth + 1,
    }));
    const height = Math.max(...cells.map((cell) => cell.text.length)) * 3.4 + 3;
    doc.setFillColor(240, 244, 248);
    doc.rect(margin, y - 3, tableWidth, height, 'F');
    cells.forEach((cell) => doc.text(cell.text, cell.x, y));
    y += height;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.5);
  };

  drawHeader();
  rows.forEach((row) => {
    const cells = headers.map((_, index) => ({
      text: doc.splitTextToSize(String(row[index] ?? '').replace(/\s+/g, ' ').slice(0, 180), columnWidth - 2),
      x: margin + index * columnWidth + 1,
    }));
    const height = Math.max(...cells.map((cell) => cell.text.length)) * 3 + 3;
    if (y + height > pageHeight - margin) {
      doc.addPage();
      y = 12;
      drawHeader();
    }
    cells.forEach((cell) => doc.text(cell.text, cell.x, y));
    doc.setDrawColor(225, 231, 238);
    doc.line(margin, y + height - 2, pageWidth - margin, y + height - 2);
    y += height;
  });

  doc.save(filename);
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
  const debouncedSearch = useDebouncedValue(search, 250);
  const [exportFormat, setExportFormat] = useState<'CSV' | 'PDF'>('CSV');

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
    const q = debouncedSearch.trim().toLowerCase();
    if (!q) return true;
    return values.some(value => String(value ?? '').toLowerCase().includes(q));
  };

  const filteredQc = useMemo(() => qcRecords.filter(r => matchesSearch([
    r.product_name, r.product_sku, r.batch_number, r.tester_name, r.remarks, r.result,
  ])), [qcRecords, debouncedSearch]);

  const filteredDispatch = useMemo(() => dispatchRecords.filter(r => matchesSearch([
    r.created_at, r.client_name, r.grade, r.batch_number, r.container_number,
    r.vehicle_number, r.product_name, r.product_sku, r.dispatcher_name, r.remarks,
  ])), [dispatchRecords, debouncedSearch]);

  const filteredRequests = useMemo(() => requests.filter(r => matchesSearch([
    r.product_name, r.product_sku, r.batch_number, r.raised_by_name, r.status, r.admin_remarks,
    r.client_name, r.driver_name, r.vehicle_number, r.container_number, r.grade_name,
  ])), [requests, debouncedSearch]);

  const filteredInventory = useMemo(() => inventory.filter(r => matchesSearch([
    r.name, r.sku, r.grade, r.purity, r.cas_number, r.manufacturer,
  ])), [inventory, debouncedSearch]);

  const filteredBatches = useMemo(() => batches.filter(r => matchesSearch([
    r.product_name, r.product_sku, r.batch_number, r.status, r.storage_location,
  ])), [batches, debouncedSearch]);

  const filteredLogs = useMemo(() => logs.filter(r => matchesSearch([
    r.user_name, r.user_role, r.action, r.description,
  ])), [logs, debouncedSearch]);

  const handleExport = () => {
    let filename = `report_${new Date().toISOString().slice(0, 10)}`;
    let title = 'Inventory report';
    let headers: string[] = [];
    let rows: (string | number)[][] = [];
    if (tab === 'qc') {
      filename = `qc_report_${new Date().toISOString().slice(0, 10)}`;
      title = 'QC report';
      headers = ['Date', 'Product', 'SKU', 'Batch', 'Tester', 'Result', 'Remarks'];
      rows = filteredQc.map(r => [new Date(r.created_at).toLocaleString(), r.product_name, r.product_sku, r.batch_number, r.tester_name, r.result, r.remarks || '']);
    } else if (tab === 'dispatch') {
      filename = `dispatch_report_${new Date().toISOString().slice(0, 10)}`;
      title = 'Dispatch report';
      headers = ['Date', 'Party', 'Product', 'SKU', 'Grade', 'Lot', 'Bags', 'Bag Content', 'Container', 'Vehicle', 'Dispatched By', 'Remarks'];
      rows = filteredDispatch.map(r => [
        new Date(r.created_at).toLocaleString(), r.client_name || '', r.product_name, r.product_sku,
        r.grade || '', r.batch_number, r.quantity, [r.bag_quantity, r.bag_quantity_unit].filter(Boolean).join(' '),
        r.container_number || '', r.vehicle_number || '', r.dispatcher_name, r.remarks || '',
      ]);
    } else if (tab === 'requests') {
      filename = `dispatch_requests_${new Date().toISOString().slice(0, 10)}`;
      title = 'Dispatch requests';
      headers = ['Date', 'Product', 'SKU', 'Grade', 'Lot', 'Bags', 'Client', 'Driver', 'Vehicle', 'Container', 'Raised By', 'Status', 'Approver Remarks'];
      rows = filteredRequests.map(r => [new Date(r.created_at).toLocaleString(), r.product_name, r.product_sku, r.grade_name || r.product_grade || '', r.batch_number, r.quantity, r.client_name || '', r.driver_name || '', r.vehicle_number || '', r.container_number || '', r.raised_by_name, r.status, r.admin_remarks || '']);
    } else if (tab === 'inventory') {
      filename = `inventory_report_${new Date().toISOString().slice(0, 10)}`;
      title = 'Inventory report';
      headers = ['Product', 'SKU', 'Grade', 'Purity', 'CAS', 'Price', 'Stock Qty', 'Batch Qty', 'QC Passed Qty', 'Stock Value', 'Batches'];
      rows = filteredInventory.map(r => [r.name, r.sku, r.grade || '', r.purity || '', r.cas_number || '', r.price, r.quantity, r.batch_quantity, r.qc_passed_quantity, r.stock_value, r.batch_count]);
    } else if (tab === 'batches') {
      filename = `batches_report_${new Date().toISOString().slice(0, 10)}`;
      title = 'Batch report';
      headers = ['Created', 'Product', 'SKU', 'Batch', 'Quantity', 'UOM', 'Status', 'Mfg Date', 'Expiry Date', 'Location'];
      rows = filteredBatches.map(r => [new Date(r.created_at).toLocaleString(), r.product_name, r.product_sku, r.batch_number, r.quantity, r.uom || '', r.status, r.manufacturing_date || '', r.expiry_date || '', r.storage_location || '']);
    } else if (tab === 'activity') {
      filename = `activity_log_${new Date().toISOString().slice(0, 10)}`;
      title = 'Activity log';
      headers = ['Time', 'User', 'Role', 'Action', 'Description'];
      rows = filteredLogs.map(r => [new Date(r.created_at).toLocaleString(), r.user_name || '', r.user_role || '', r.action, r.description || '']);
    }
    if (headers.length === 0) return;
    if (exportFormat === 'PDF') downloadPdf(`${filename}.pdf`, title, headers, rows);
    else downloadCsv(`${filename}.csv`, headers, rows);
  };

  const showFilters = ['qc', 'dispatch', 'requests', 'batches'].includes(tab);
  const showSearch = ['qc', 'dispatch', 'requests', 'inventory', 'batches', 'activity'].includes(tab);

  const overviewCards = summary ? [
    { label: 'QC Checks', value: summary.qcTotal, icon: <Microscope size={22} />, color: 'text-emerald-600', bg: 'bg-emerald-50' },
    { label: 'QC Pass Rate', value: `${summary.qcPassRate}%`, icon: <CheckCircle size={22} />, color: 'text-brand-600', bg: 'bg-brand-50' },
    { label: 'Dispatches', value: summary.dispatchTotal, icon: <Truck size={22} />, color: 'text-sky-600', bg: 'bg-sky-50' },
    { label: 'Pending Requests', value: summary.pendingRequests, icon: <ClipboardList size={22} />, color: 'text-amber-600', bg: 'bg-amber-50' },
    { label: 'Products', value: summary.totalProducts, icon: <Boxes size={22} />, color: 'text-violet-600', bg: 'bg-violet-50' },
    { label: 'Inventory Value', value: `₹${Number(summary.inventoryValue).toLocaleString('en-IN')}`, icon: <IndianRupee size={22} />, color: 'text-teal-600', bg: 'bg-teal-50' },
  ] : [];

  return (
    <div className="page-container space-y-6 max-w-7xl mx-auto">
      {/* ── Page Header ─────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <div className="w-10 h-10 rounded-xl bg-brand-100 flex items-center justify-center">
              <FileBarChart size={20} className="text-brand-600" />
            </div>
            <h1 className="text-2xl font-bold text-slate-900">Reports &amp; Audit Logs</h1>
          </div>
          <p className="text-base text-slate-500 ml-[52px]">
            Comprehensive audit ledgers, QC results, dispatch reports, and inventory exports.
          </p>
        </div>
        {['qc', 'dispatch', 'requests', 'inventory', 'batches', 'activity'].includes(tab) && (
          <div className="flex items-center gap-3">
            <select
              aria-label="Report export format"
              className="input text-base py-2.5 min-w-[170px]"
              value={exportFormat}
              onChange={(event) => setExportFormat(event.target.value as 'CSV' | 'PDF')}
            >
              <option value="CSV">CSV (Excel-compatible)</option>
              <option value="PDF">PDF</option>
            </select>
            <button onClick={handleExport} className="btn-secondary flex items-center gap-2 px-4 py-2.5 text-base font-medium">
              <Download size={18} /> Export {exportFormat}
            </button>
          </div>
        )}
      </div>

      {/* ── Error Banner ─────────────────────────────────────────────────────── */}
      {error && (
        <div className="p-4 rounded-2xl text-base bg-rose-50 text-rose-700 border-2 border-rose-200 flex items-center justify-between gap-3">
          <span className="flex items-center gap-2"><AlertCircle size={20} />{error}</span>
          <button onClick={() => setError('')} className="text-rose-400 hover:text-rose-600"><X size={18} /></button>
        </div>
      )}

      {/* ── KPI Summary Cards ─────────────────────────────────────────────────── */}
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">
          {overviewCards.map(card => (
            <div key={card.label} className="bg-white rounded-2xl border-2 border-slate-200 p-5 shadow-xs">
              <div className={`w-11 h-11 rounded-xl ${card.bg} ${card.color} flex items-center justify-center mb-3`}>
                {card.icon}
              </div>
              <div className="text-3xl font-bold text-slate-900 mb-1">{card.value}</div>
              <div className="text-sm font-medium text-slate-500">{card.label}</div>
            </div>
          ))}
        </div>
      )}

      {/* ── Tab Bar ──────────────────────────────────────────────────────────── */}
      <div className="border-b-2 border-slate-200">
        <nav className="-mb-0.5 flex flex-wrap gap-1 sm:gap-2" aria-label="Report sections">
          {TABS.map(t => {
            const Icon = t.icon;
            const isCurrent = tab === t.key;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => setTab(t.key)}
                className={`inline-flex items-center gap-2 border-b-2 px-4 py-3 text-base font-semibold transition-colors ${
                  isCurrent
                    ? 'border-brand-600 text-brand-600'
                    : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700'
                }`}
              >
                <Icon size={18} />
                {t.label}
              </button>
            );
          })}
        </nav>
      </div>

      {/* ── Filters / Search Bar ─────────────────────────────────────────────── */}
      {(showFilters || showSearch) && (
        <div className="bg-white rounded-2xl border-2 border-slate-200 p-5 shadow-xs">
          <div className="flex flex-wrap items-end gap-4">
            {showSearch && (
              <div className="relative flex-1 min-w-[240px]">
                <Search size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  className="input pl-10 py-2.5 text-base"
                  placeholder="Search records…"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                />
              </div>
            )}
            {showFilters && (
              <>
                <div className="space-y-1.5">
                  <label className="text-sm font-semibold text-slate-600">From</label>
                  <input type="date" className="input py-2.5 text-base" value={from} onChange={e => setFrom(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-semibold text-slate-600">To</label>
                  <input type="date" className="input py-2.5 text-base" value={to} onChange={e => setTo(e.target.value)} />
                </div>
              </>
            )}
            {tab === 'qc' && (
              <div className="space-y-1.5">
                <label className="text-sm font-semibold text-slate-600">Result</label>
                <select className="input py-2.5 text-base min-w-[140px]" value={qcResult} onChange={e => setQcResult(e.target.value)}>
                  <option value="ALL">All results</option>
                  <option value="PASS">Pass (auto)</option>
                </select>
              </div>
            )}
            {tab === 'requests' && (
              <div className="space-y-1.5">
                <label className="text-sm font-semibold text-slate-600">Status</label>
                <select className="input py-2.5 text-base min-w-[160px]" value={requestStatus} onChange={e => setRequestStatus(e.target.value)}>
                  <option value="ALL">All statuses</option>
                  <option value="PENDING">Pending</option>
                  <option value="APPROVED">Approved</option>
                  <option value="REJECTED">Rejected</option>
                  <option value="CLOSED_DISPATCHED">Dispatched</option>
                  <option value="CLOSED_NOT_DISPATCHED">Not Dispatched</option>
                </select>
              </div>
            )}
            {tab === 'batches' && (
              <div className="space-y-1.5">
                <label className="text-sm font-semibold text-slate-600">Status</label>
                <select className="input py-2.5 text-base min-w-[180px]" value={batchStatus} onChange={e => setBatchStatus(e.target.value)}>
                  <option value="ALL">All statuses</option>
                  <option value="QC_PASSED">QC Passed</option>
                  <option value="DISPATCH_ORDER_RAISED">Order Raised</option>
                  <option value="DISPATCH_APPROVED">Approved</option>
                  <option value="LOADING">Loading</option>
                  <option value="DISPATCHED">Dispatched</option>
                  <option value="NOT_DISPATCHED">Not Dispatched</option>
                </select>
              </div>
            )}
            {(from || to || qcResult !== 'ALL' || requestStatus !== 'ALL' || batchStatus !== 'ALL' || search) && (
              <button
                onClick={() => { setFrom(''); setTo(''); setQcResult('ALL'); setRequestStatus('ALL'); setBatchStatus('ALL'); setSearch(''); }}
                className="btn-ghost flex items-center gap-2 py-2.5 px-4 text-base"
              >
                <X size={16} /> Clear Filters
              </button>
            )}
          </div>
        </div>
      )}

      {/* ── Loading State ─────────────────────────────────────────────────────── */}
      {loading && (
        <div className="bg-white rounded-2xl border-2 border-slate-200 p-14 text-center text-base text-slate-400 shadow-xs">
          Loading report data…
        </div>
      )}

      {/* ── Overview Tab ─────────────────────────────────────────────────────── */}
      {!loading && tab === 'overview' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <div className="bg-white rounded-2xl border-2 border-slate-200 shadow-xs overflow-hidden">
            <div className="p-5 border-b-2 border-slate-100 flex items-center justify-between">
              <h3 className="text-base font-bold text-slate-800 flex items-center gap-2">
                <ClipboardList size={18} className="text-amber-500" /> Pending Dispatch Requests
              </h3>
              <button onClick={() => setTab('requests')} className="text-sm text-brand-600 font-semibold hover:underline">View all</button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="bg-slate-50 border-b-2 border-slate-100">
                    <th className="px-4 py-3 text-left text-sm font-semibold text-slate-600">Product</th>
                    <th className="px-4 py-3 text-left text-sm font-semibold text-slate-600">Batch</th>
                    <th className="px-4 py-3 text-left text-sm font-semibold text-slate-600">Raised By</th>
                    <th className="px-4 py-3 text-left text-sm font-semibold text-slate-600">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredRequests.slice(0, 8).map(r => (
                    <tr key={r.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3">
                        <div className="text-base font-semibold text-slate-900">{r.product_name}</div>
                        <div className="text-sm text-slate-400">{r.product_sku}</div>
                      </td>
                      <td className="px-4 py-3"><span className="font-mono text-sm bg-slate-100 px-2 py-1 rounded-lg">{r.batch_number}</span></td>
                      <td className="px-4 py-3 text-base text-slate-700">{r.raised_by_name || '-'}</td>
                      <td className="px-4 py-3"><span className={`badge ${statusBadge[r.status] || 'badge-neutral'}`}>{statusLabel[r.status] || r.status}</span></td>
                    </tr>
                  ))}
                  {filteredRequests.length === 0 && (
                    <tr><td colSpan={4} className="px-4 py-10 text-center text-base text-slate-400">No pending requests</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="bg-white rounded-2xl border-2 border-slate-200 shadow-xs overflow-hidden">
            <div className="p-5 border-b-2 border-slate-100 flex items-center justify-between">
              <h3 className="text-base font-bold text-slate-800 flex items-center gap-2">
                <Microscope size={18} className="text-emerald-500" /> Recent QC Results
              </h3>
              <button onClick={() => setTab('qc')} className="text-sm text-brand-600 font-semibold hover:underline">View all</button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="bg-slate-50 border-b-2 border-slate-100">
                    <th className="px-4 py-3 text-left text-sm font-semibold text-slate-600">Product</th>
                    <th className="px-4 py-3 text-left text-sm font-semibold text-slate-600">Batch</th>
                    <th className="px-4 py-3 text-left text-sm font-semibold text-slate-600">Result</th>
                    <th className="px-4 py-3 text-left text-sm font-semibold text-slate-600">Date</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredQc.slice(0, 8).map(r => (
                    <tr key={r.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3">
                        <div className="text-base font-semibold text-slate-900">{r.product_name}</div>
                        <div className="text-sm text-slate-400">{r.product_sku}</div>
                      </td>
                      <td className="px-4 py-3"><span className="font-mono text-sm bg-slate-100 px-2 py-1 rounded-lg">{r.batch_number}</span></td>
                      <td className="px-4 py-3"><span className={`badge ${statusBadge[r.result] || 'badge-neutral'}`}>{r.result}</span></td>
                      <td className="px-4 py-3 text-sm text-slate-400">{formatDate(r.created_at)}</td>
                    </tr>
                  ))}
                  {filteredQc.length === 0 && (
                    <tr><td colSpan={4} className="px-4 py-10 text-center text-base text-slate-400">No QC records yet</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="bg-white rounded-2xl border-2 border-slate-200 shadow-xs overflow-hidden lg:col-span-2">
            <div className="p-5 border-b-2 border-slate-100 flex items-center justify-between">
              <h3 className="text-base font-bold text-slate-800 flex items-center gap-2">
                <Truck size={18} className="text-sky-500" /> Recent Dispatches
              </h3>
              <button onClick={() => setTab('dispatch')} className="text-sm text-brand-600 font-semibold hover:underline">View all</button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="bg-slate-50 border-b-2 border-slate-100">
                    <th className="px-4 py-3 text-left text-sm font-semibold text-slate-600">Date</th>
                    <th className="px-4 py-3 text-left text-sm font-semibold text-slate-600">Product</th>
                    <th className="px-4 py-3 text-left text-sm font-semibold text-slate-600">Batch</th>
                    <th className="px-4 py-3 text-left text-sm font-semibold text-slate-600">Qty</th>
                    <th className="px-4 py-3 text-left text-sm font-semibold text-slate-600">Dispatched By</th>
                    <th className="px-4 py-3 text-left text-sm font-semibold text-slate-600">Remarks</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredDispatch.slice(0, 8).map(r => (
                    <tr key={r.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3 text-sm text-slate-400">{new Date(r.created_at).toLocaleString()}</td>
                      <td className="px-4 py-3">
                        <div className="text-base font-semibold text-slate-900">{r.product_name}</div>
                        <div className="text-sm text-slate-400">{r.product_sku}</div>
                      </td>
                      <td className="px-4 py-3"><span className="font-mono text-sm bg-slate-100 px-2 py-1 rounded-lg">{r.batch_number}</span></td>
                      <td className="px-4 py-3 text-base font-medium text-slate-700">{r.quantity} {r.uom || ''}</td>
                      <td className="px-4 py-3 text-base text-slate-700">{r.dispatcher_name || '-'}</td>
                      <td className="px-4 py-3 text-base text-slate-500">{r.remarks || '-'}</td>
                    </tr>
                  ))}
                  {filteredDispatch.length === 0 && (
                    <tr><td colSpan={6} className="px-4 py-10 text-center text-base text-slate-400">No dispatches yet</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ── QC Tab ───────────────────────────────────────────────────────────── */}
      {!loading && tab === 'qc' && (
        <div className="bg-white rounded-2xl border-2 border-slate-200 shadow-xs overflow-hidden">
          <div className="p-5 border-b-2 border-slate-100 flex items-center justify-between">
            <h3 className="text-base font-bold text-slate-800 flex items-center gap-2">
              <Microscope size={18} className="text-emerald-500" /> QC Reports
            </h3>
            <span className="text-sm font-medium text-slate-400">{filteredQc.length} records</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-slate-50 border-b-2 border-slate-200">
                  {['Date','Product','Batch','Tester','Result','Remarks','Evidence'].map(h => (
                    <th key={h} className="px-5 py-3.5 text-left text-sm font-semibold text-slate-600">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredQc.map(r => {
                  const images = parseImages(r.images);
                  return (
                    <tr key={r.id} className="hover:bg-slate-50">
                      <td className="px-5 py-4 text-sm text-slate-400">{new Date(r.created_at).toLocaleString()}</td>
                      <td className="px-5 py-4">
                        <div className="text-base font-semibold text-slate-900">{r.product_name}</div>
                        <div className="text-sm text-slate-400">{r.product_sku}{r.grade ? ` · ${r.grade}` : ''}</div>
                      </td>
                      <td className="px-5 py-4"><span className="font-mono text-sm bg-slate-100 px-2 py-1 rounded-lg">{r.batch_number}</span></td>
                      <td className="px-5 py-4 text-base text-slate-700">{r.tester_name || '-'}</td>
                      <td className="px-5 py-4"><span className={`badge ${statusBadge[r.result] || 'badge-neutral'}`}>{r.result}</span></td>
                      <td className="px-5 py-4 text-base text-slate-500 max-w-[220px]">{r.remarks || '-'}</td>
                      <td className="px-5 py-4">
                        {images.length > 0
                          ? <button onClick={() => setImageViewer({ title: `${r.product_name} · ${r.batch_number}`, images })} className="btn-secondary btn-xs flex items-center gap-1.5"><Eye size={14} /> {images.length}</button>
                          : <span className="text-sm text-slate-400">—</span>}
                      </td>
                    </tr>
                  );
                })}
                {filteredQc.length === 0 && (
                  <tr><td colSpan={7} className="px-5 py-14 text-center text-base text-slate-400">No QC records found. Try changing the date range or result filter.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Dispatch Reports Tab ─────────────────────────────────────────────── */}
      {!loading && tab === 'dispatch' && (
        <div className="bg-white rounded-2xl border-2 border-slate-200 shadow-xs overflow-hidden">
          <div className="p-5 border-b-2 border-slate-100 flex items-center justify-between">
            <h3 className="text-base font-bold text-slate-800 flex items-center gap-2">
              <Truck size={18} className="text-sky-500" /> Dispatch Reports
            </h3>
            <span className="text-sm font-medium text-slate-400">{filteredDispatch.length} records</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-slate-50 border-b-2 border-slate-200">
                  {['Date','Party','Product','Grade','Lot','Bags','Bag Content','Container','Vehicle','Location','Dispatched By','Remarks','Evidence'].map(h => (
                    <th key={h} className="px-5 py-3.5 text-left text-sm font-semibold text-slate-600 whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredDispatch.map(r => {
                  const images = parseImages(r.images);
                  return (
                    <tr key={r.id} className="hover:bg-slate-50">
                      <td className="px-5 py-4 text-sm text-slate-400 whitespace-nowrap">{new Date(r.created_at).toLocaleString()}</td>
                      <td className="px-5 py-4 text-base text-slate-700">{r.client_name || '-'}</td>
                      <td className="px-5 py-4">
                        <div className="text-base font-semibold text-slate-900">{r.product_name}</div>
                        <div className="text-sm text-slate-400">{r.product_sku}</div>
                      </td>
                      <td className="px-5 py-4 text-base text-slate-700">{r.grade || '-'}</td>
                      <td className="px-5 py-4"><span className="font-mono text-sm bg-slate-100 px-2 py-1 rounded-lg">{r.batch_number}</span></td>
                      <td className="px-5 py-4 text-base font-medium text-slate-700">{r.quantity} bags</td>
                      <td className="px-5 py-4 text-base text-slate-700">{r.bag_quantity ? `${r.bag_quantity} ${r.bag_quantity_unit || ''}` : '-'}</td>
                      <td className="px-5 py-4 text-base text-slate-700">{r.container_number || '-'}</td>
                      <td className="px-5 py-4 text-base text-slate-700">{r.vehicle_number || '-'}</td>
                      <td className="px-5 py-4 text-base text-slate-700">{r.storage_location || '-'}</td>
                      <td className="px-5 py-4 text-base text-slate-700">{r.dispatcher_name || '-'}</td>
                      <td className="px-5 py-4 text-base text-slate-500 max-w-[200px]">{r.remarks || '-'}</td>
                      <td className="px-5 py-4">
                        {images.length > 0
                          ? <button onClick={() => setImageViewer({ title: `${r.product_name} · ${r.batch_number}`, images })} className="btn-secondary btn-xs flex items-center gap-1.5"><Eye size={14} /> {images.length}</button>
                          : <span className="text-sm text-slate-400">—</span>}
                      </td>
                    </tr>
                  );
                })}
                {filteredDispatch.length === 0 && (
                  <tr><td colSpan={13} className="px-5 py-14 text-center text-base text-slate-400">No dispatch records found. Search by party, grade, lot, container, vehicle, or change the date range.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Dispatch Requests Tab ────────────────────────────────────────────── */}
      {!loading && tab === 'requests' && (
        <div className="bg-white rounded-2xl border-2 border-slate-200 shadow-xs overflow-hidden">
          <div className="p-5 border-b-2 border-slate-100 flex items-center justify-between">
            <h3 className="text-base font-bold text-slate-800 flex items-center gap-2">
              <ClipboardList size={18} className="text-amber-500" /> Dispatch Requests
            </h3>
            <span className="text-sm font-medium text-slate-400">{filteredRequests.length} records</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-slate-50 border-b-2 border-slate-200">
                  {['Date','Product / Grade','Lot','Bags','Client / Transport','Container','Raised By','Status','Remarks','Reviewed By'].map(h => (
                    <th key={h} className="px-5 py-3.5 text-left text-sm font-semibold text-slate-600 whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredRequests.map(r => (
                  <tr key={r.id} className="hover:bg-slate-50">
                    <td className="px-5 py-4 text-sm text-slate-400 whitespace-nowrap">{new Date(r.created_at).toLocaleString()}</td>
                    <td className="px-5 py-4">
                      <div className="text-base font-semibold text-slate-900">{r.product_name}</div>
                      <div className="text-sm text-slate-400">{r.product_sku} · {r.grade_name || r.product_grade || '-'}</div>
                    </td>
                    <td className="px-5 py-4"><span className="font-mono text-sm bg-slate-100 px-2 py-1 rounded-lg">{r.batch_number}</span></td>
                    <td className="px-5 py-4 text-base font-medium text-slate-700">{r.quantity} {r.uom || ''}</td>
                    <td className="px-5 py-4 text-base text-slate-700">
                      <div>{r.client_name || '-'}</div>
                      <div className="text-sm text-slate-400">{r.driver_name || '-'} / {r.vehicle_number || '-'}</div>
                    </td>
                    <td className="px-5 py-4 text-base text-slate-700">{r.container_number || '-'}</td>
                    <td className="px-5 py-4 text-base text-slate-700">{r.raised_by_name || '-'}</td>
                    <td className="px-5 py-4"><span className={`badge ${statusBadge[r.status] || 'badge-neutral'}`}>{statusLabel[r.status] || r.status}</span></td>
                    <td className="px-5 py-4 text-base text-slate-500 max-w-[200px]">{r.admin_remarks || '-'}</td>
                    <td className="px-5 py-4 text-sm text-slate-400">{r.approver_name ? `by ${r.approver_name}` : '-'}</td>
                  </tr>
                ))}
                {filteredRequests.length === 0 && (
                  <tr><td colSpan={10} className="px-5 py-14 text-center text-base text-slate-400">No dispatch requests found. Try changing the date range or status filter.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Inventory Tab ────────────────────────────────────────────────────── */}
      {!loading && tab === 'inventory' && (
        <div className="bg-white rounded-2xl border-2 border-slate-200 shadow-xs overflow-hidden">
          <div className="p-5 border-b-2 border-slate-100 flex items-center justify-between">
            <h3 className="text-base font-bold text-slate-800 flex items-center gap-2">
              <Boxes size={18} className="text-violet-500" /> Products &amp; Inventory
            </h3>
            <span className="text-sm font-medium text-slate-400">{filteredInventory.length} products</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-slate-50 border-b-2 border-slate-200">
                  {['Product','Grade / Purity','Price','Stock Qty','Batch Qty','QC Passed Qty','Stock Value','Batches'].map(h => (
                    <th key={h} className="px-5 py-3.5 text-left text-sm font-semibold text-slate-600 whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredInventory.map(r => (
                  <tr key={r.id} className="hover:bg-slate-50">
                    <td className="px-5 py-4">
                      <div className="text-base font-semibold text-slate-900">{r.name}</div>
                      <div className="text-sm text-slate-400">{r.sku}{r.cas_number ? ` · CAS ${r.cas_number}` : ''}</div>
                    </td>
                    <td className="px-5 py-4 text-base text-slate-700">{r.grade || '-'}{r.purity ? ` · ${r.purity}` : ''}</td>
                    <td className="px-5 py-4 text-base text-slate-700">{Number(r.price) > 0 ? `₹${Number(r.price).toLocaleString('en-IN')}` : '-'}</td>
                    <td className="px-5 py-4 text-base font-semibold text-slate-900">{Number(r.quantity).toLocaleString('en-IN')}</td>
                    <td className="px-5 py-4 text-base text-slate-700">{Number(r.batch_quantity).toLocaleString('en-IN')}</td>
                    <td className="px-5 py-4 text-base font-semibold text-emerald-600">{Number(r.qc_passed_quantity).toLocaleString('en-IN')}</td>
                    <td className="px-5 py-4 text-base font-semibold text-slate-900">₹{Number(r.stock_value).toLocaleString('en-IN')}</td>
                    <td className="px-5 py-4 text-base text-slate-700">{r.batch_count}</td>
                  </tr>
                ))}
                {filteredInventory.length === 0 && (
                  <tr><td colSpan={8} className="px-5 py-14 text-center text-base text-slate-400">No products found.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Batches Tab ──────────────────────────────────────────────────────── */}
      {!loading && tab === 'batches' && (
        <div className="bg-white rounded-2xl border-2 border-slate-200 shadow-xs overflow-hidden">
          <div className="p-5 border-b-2 border-slate-100 flex items-center justify-between">
            <h3 className="text-base font-bold text-slate-800 flex items-center gap-2">
              <Layers size={18} className="text-brand-500" /> Batch Report
            </h3>
            <span className="text-sm font-medium text-slate-400">{filteredBatches.length} batches</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-slate-50 border-b-2 border-slate-200">
                  {['Created','Product','Batch','Qty','Status','Mfg Date','Expiry Date','Location'].map(h => (
                    <th key={h} className="px-5 py-3.5 text-left text-sm font-semibold text-slate-600 whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredBatches.map(r => (
                  <tr key={r.id} className="hover:bg-slate-50">
                    <td className="px-5 py-4 text-sm text-slate-400">{formatDate(r.created_at)}</td>
                    <td className="px-5 py-4">
                      <div className="text-base font-semibold text-slate-900">{r.product_name}</div>
                      <div className="text-sm text-slate-400">{r.product_sku}</div>
                    </td>
                    <td className="px-5 py-4"><span className="font-mono text-sm bg-slate-100 px-2 py-1 rounded-lg">{r.batch_number}</span></td>
                    <td className="px-5 py-4 text-base font-medium text-slate-700">{r.quantity} {r.uom || ''}</td>
                    <td className="px-5 py-4"><span className={`badge ${statusBadge[r.status] || 'badge-neutral'}`}>{statusLabel[r.status] || r.status}</span></td>
                    <td className="px-5 py-4 text-sm text-slate-400">{formatDate(r.manufacturing_date)}</td>
                    <td className="px-5 py-4 text-sm text-slate-400">{formatDate(r.expiry_date)}</td>
                    <td className="px-5 py-4 text-base text-slate-700">{r.storage_location || '-'}</td>
                  </tr>
                ))}
                {filteredBatches.length === 0 && (
                  <tr><td colSpan={8} className="px-5 py-14 text-center text-base text-slate-400">No batches found. Try changing the date range or status filter.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Activity Log Tab ─────────────────────────────────────────────────── */}
      {!loading && tab === 'activity' && (
        <div className="bg-white rounded-2xl border-2 border-slate-200 shadow-xs overflow-hidden">
          <div className="p-5 border-b-2 border-slate-100 flex items-center justify-between">
            <h3 className="text-base font-bold text-slate-800 flex items-center gap-2">
              <Activity size={18} className="text-slate-500" /> System Activity Log
            </h3>
            <span className="text-sm font-medium text-slate-400">{filteredLogs.length} entries</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-slate-50 border-b-2 border-slate-200">
                  {['Time','User','Role','Action','Description'].map(h => (
                    <th key={h} className="px-5 py-3.5 text-left text-sm font-semibold text-slate-600">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredLogs.map(r => (
                  <tr key={r.id} className="hover:bg-slate-50">
                    <td className="px-5 py-4 text-sm text-slate-400 whitespace-nowrap">{new Date(r.created_at).toLocaleString()}</td>
                    <td className="px-5 py-4 text-base font-medium text-slate-800">{r.user_name || '-'}</td>
                    <td className="px-5 py-4">
                      <span className="inline-block bg-slate-100 text-slate-600 text-sm font-semibold px-2.5 py-1 rounded-lg">
                        {r.user_role || '-'}
                      </span>
                    </td>
                    <td className="px-5 py-4"><span className="badge badge-neutral text-sm">{r.action}</span></td>
                    <td className="px-5 py-4 text-base text-slate-500">{r.description || '-'}</td>
                  </tr>
                ))}
                {filteredLogs.length === 0 && (
                  <tr><td colSpan={5} className="px-5 py-14 text-center text-base text-slate-400">No activity found.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Image Evidence Viewer ────────────────────────────────────────────── */}
      {imageViewer && (
        <div className="modal-overlay">
          <div className="modal-content max-w-3xl" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="text-xl font-bold text-slate-900">Evidence · {imageViewer.title}</h2>
              <button onClick={() => setImageViewer(null)} className="btn-ghost btn-sm"><X size={18} /></button>
            </div>
            <div className="modal-body grid grid-cols-1 sm:grid-cols-2 gap-4">
              {imageViewer.images.map((image, index) => (
                <a key={`${image}-${index}`} href={uploadUrl(image)} target="_blank" rel="noreferrer" className="block rounded-2xl overflow-hidden border-2 border-slate-200 hover:border-brand-300">
                  <img src={uploadUrl(image)} alt={`Evidence ${index + 1}`} className="w-full h-48 object-cover" />
                </a>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
