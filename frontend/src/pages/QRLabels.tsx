import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle, CheckCircle, Download, History, Loader2, Package,
  Printer, QrCode, RefreshCw, Search, X,
} from 'lucide-react';
import { api } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { downloadQrPdf, printQrLabels, QrJob, QrLabel } from '../utils/qrPdf';
import type { EntityId } from '../types';
import { useDebouncedValue } from '../hooks/useDebouncedValue';

type QrJobRow = QrJob & {
  total_prints?: number;
  label_count?: number;
  last_printed_at?: string | null;
  created_by_name?: string;
};

function formatDate(value?: string | null): string {
  if (!value) return '-';
  return new Date(value).toLocaleString(undefined, {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

export default function QRLabels() {
  const { user } = useAuth();
  const isQc = user?.role === 'QC';
  const canReprint = user?.role === 'ADMIN';
  const [jobs, setJobs] = useState<QrJobRow[]>([]);
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, 300);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [reprintJob, setReprintJob] = useState<QrJobRow | null>(null);
  const [reprintLabels, setReprintLabels] = useState<QrLabel[]>([]);
  const [selectedIds, setSelectedIds] = useState<EntityId[]>([]);
  const [reprintQty, setReprintQty] = useState('1');
  const [reprintLoading, setReprintLoading] = useState(false);
  const [reprinting, setReprinting] = useState(false);
  const [reprintRequests, setReprintRequests] = useState<any[]>([]);
  const [fulfillingRequestId, setFulfillingRequestId] = useState<EntityId | null>(null);
  const listRequest = useRef(0);
  const detailRequest = useRef(0);

  const load = useCallback(async (showSpinner = false) => {
    const requestId = ++listRequest.current;
    if (showSpinner) setRefreshing(true);
    if (requestId === listRequest.current) setError('');
    try {
      const jobRows = await api.qc.qrJobs.list(debouncedSearch || undefined);
      if (requestId === listRequest.current) setJobs(jobRows.items || []);
      if (user?.role === 'ADMIN' && requestId === listRequest.current) setReprintRequests(await api.qc.qrJobs.reprintRequests());
    } catch (err: any) {
      if (requestId === listRequest.current) setError(err.message || 'Could not load QR labels');
    } finally {
      if (requestId === listRequest.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [debouncedSearch, user?.role]);

  useEffect(() => {
    const timer = setTimeout(() => { void load(); }, 0);
    return () => clearTimeout(timer);
  }, [load]);

  // Esc key closes reprint modal
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && reprintJob && !reprinting && !reprintLoading) {
        setReprintJob(null);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [reprintJob, reprinting, reprintLoading]);

  const openReprint = async (job: QrJobRow, requestedIds?: EntityId[]) => {
    const requestId = ++detailRequest.current;
    setError('');
    setSuccess('');
    setReprintJob(job);
    setReprintLabels([]);
    setSelectedIds([]);
    setReprintQty('1');
    setReprintLoading(true);
    try {
      const detail = await api.qc.qrJobs.get(job.id);
      if (requestId !== detailRequest.current) return;
      setReprintLabels(detail.labels || []);
      const initialSelection = requestedIds?.length
        ? (detail.labels || []).filter((label: QrLabel) => requestedIds.some(id => String(id) === String(label.id))).map((label: QrLabel) => label.id)
        : (detail.labels || []).slice(0, 1).map((label: QrLabel) => label.id);
      setSelectedIds(initialSelection);
      setReprintQty(String(initialSelection.length));
    } catch (err: any) {
      if (requestId !== detailRequest.current) return;
      setError(err.message || 'Could not load QR labels');
      setReprintJob(null);
    } finally {
      if (requestId === detailRequest.current) setReprintLoading(false);
    }
  };

  const applyQuantity = (value: string) => {
    setReprintQty(value);
    const count = Number(value);
    if (!Number.isInteger(count) || count < 0) return;
    setSelectedIds(reprintLabels.slice(0, Math.min(count, reprintLabels.length)).map((label) => label.id));
  };

  const toggleLabel = (id: EntityId) => {
    setSelectedIds((current) => {
      const next = current.includes(id) ? current.filter((v) => v !== id) : [...current, id];
      setReprintQty(String(next.length));
      return next;
    });
  };

  const runReprint = async (mode: 'pdf' | 'print') => {
    if (!reprintJob || selectedIds.length === 0) {
      setError('Select at least one label to reprint');
      return;
    }
    setError('');
    setSuccess('');
    setReprinting(true);
    try {
      const result = await api.qc.qrJobs.reprint(reprintJob.id, {
        quantity: selectedIds.length,
        label_ids: selectedIds,
      });
      if (mode === 'pdf') {
        await downloadQrPdf(result.labels, result.job);
        setSuccess(`${result.labels.length} QR label${result.labels.length === 1 ? '' : 's'} reprinted to PDF.`);
      } else {
        await printQrLabels(result.labels, result.job);
        setSuccess(`${result.labels.length} QR label${result.labels.length === 1 ? '' : 's'} sent to print.`);
      }
      if (fulfillingRequestId !== null) {
        await api.qc.qrJobs.completeReprintRequest(fulfillingRequestId);
        setReprintRequests(current => current.filter(row => String(row.id) !== String(fulfillingRequestId)));
        setFulfillingRequestId(null);
        setSuccess('Requested QR labels printed and the request was marked fulfilled.');
      }
      await load();
    } catch (err: any) {
      setError(err.message || 'Could not reprint QR labels');
    } finally {
      setReprinting(false);
    }
  };

  const requestReprint = async () => {
    if (!reprintJob || selectedIds.length === 0) { setError('Select at least one label to request.'); return; }
    setReprinting(true); setError(''); setSuccess('');
    try {
      await api.qc.qrJobs.requestReprint(reprintJob.id, selectedIds);
      setReprintJob(null);
      setSuccess('Reprint request sent to an administrator.');
    } catch (err: any) { setError(err.message || 'Could not send reprint request'); }
    finally { setReprinting(false); }
  };

  const openRequestedLabels = (request: any) => {
    const job = jobs.find(row => String(row.id) === String(request.qr_job_id));
    if (!job) { setError(`QR job ${request.job_code || request.qr_job_id} is not available.`); return; }
    setFulfillingRequestId(request.id);
    void openReprint(job, request.label_ids || []);
  };

  const downloadJob = async (job: QrJobRow) => {
    setError('');
    setSuccess('');
    try {
      const detail = await api.qc.qrJobs.get(job.id);
      await downloadQrPdf(detail.labels, detail.job);
      setSuccess(`Downloaded ${detail.labels.length} labels from ${job.job_code}.`);
    } catch (err: any) {
      setError(err.message || 'Could not download QR labels');
    }
  };

  // KPI values
  const totalJobs = jobs.length;
  const totalLabels = jobs.reduce((sum, j) => sum + (j.label_count ?? j.quantity ?? 0), 0);
  const totalPrints = jobs.reduce((sum, j) => sum + (j.total_prints ?? j.quantity ?? 0), 0);
  const lastPrinted = jobs.reduce<string | null>((latest, j) => {
    if (!j.last_printed_at) return latest;
    if (!latest) return j.last_printed_at;
    return j.last_printed_at > latest ? j.last_printed_at : latest;
  }, null);

  if (loading) {
    return (
      <div className="page-container flex items-center justify-center h-64">
        <Loader2 size={24} className="animate-spin text-brand-500 mr-3" />
        <span className="text-surface-500">Loading QR labels…</span>
      </div>
    );
  }

  return (
    <div className="page-container">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="page-header">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <div className="w-10 h-10 rounded-xl bg-brand-100 flex items-center justify-center flex-shrink-0">
              <QrCode size={20} className="text-brand-600" />
            </div>
            <h1 className="page-title text-xl">QR Code Labels</h1>
          </div>
          <p className="page-subtitle ml-[52px]">
            {isQc ? 'Request replacement labels from an administrator when a print is damaged or lost.' : 'Review QR print jobs and handle QC replacement requests.'}
            {' '}Initial labels are generated with each batch.
          </p>
        </div>
        <button className="btn-secondary" onClick={() => load(true)} disabled={refreshing}>
          <RefreshCw size={15} className={refreshing ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      {/* ── Alerts ─────────────────────────────────────────────────────────── */}
      {error && (
        <div className="mb-4 p-3 rounded-xl flex items-center gap-2 bg-rose-50 text-rose-700 border border-rose-200 text-sm">
          <AlertTriangle size={16} className="flex-shrink-0" /> {error}
        </div>
      )}
      {success && (
        <div className="mb-4 p-3 rounded-xl flex items-center gap-2 bg-emerald-50 text-emerald-700 border border-emerald-200 text-sm">
          <CheckCircle size={16} className="flex-shrink-0" /> {success}
        </div>
      )}

      {/* ── KPI Cards ──────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
        {/* Total Jobs */}
        <div className="stat-card">
          <div className="stat-label">Total Print Jobs</div>
          <div className="stat-value">{totalJobs}</div>
          <div className="stat-icon bg-brand-50">
            <History size={20} className="text-brand-600" />
          </div>
        </div>
        {/* Labels Generated */}
        <div className="stat-card">
          <div className="stat-label">Labels Generated</div>
          <div className="stat-value">{totalLabels}</div>
          <div className="stat-icon bg-emerald-50">
            <QrCode size={20} className="text-emerald-600" />
          </div>
        </div>
        {/* Total Prints */}
        <div className="stat-card">
          <div className="stat-label">Total Prints</div>
          <div className="stat-value">{totalPrints}</div>
          <div className="stat-icon bg-sky-50">
            <Printer size={20} className="text-sky-600" />
          </div>
        </div>
        {/* Last Printed */}
        <div className="stat-card">
          <div className="stat-label">Last Printed</div>
          <div className="stat-value text-lg">
            {lastPrinted
              ? new Date(lastPrinted).toLocaleDateString(undefined, { day: '2-digit', month: 'short' })
              : '—'}
          </div>
          <div className="stat-icon bg-amber-50">
            <Download size={20} className="text-amber-600" />
          </div>
        </div>
      </div>

      {/* ── Print Jobs Table ────────────────────────────────────────────────── */}
      <div className="card">
        <div className="card-header flex flex-wrap items-center justify-between gap-3">
          <h3 className="section-title flex items-center gap-2">
            <History size={16} className="text-surface-400" /> QR Print Jobs
          </h3>
          <div className="relative w-64 max-w-full">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-surface-400" />
            <input
              className="input pl-9 py-1.5 text-sm"
              placeholder="Search job, product, SKU…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Job Code</th>
                <th>Product</th>
                <th>Labels</th>
                <th>Prints</th>
                <th>Created</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((job) => (
                <tr key={job.id}>
                  <td>
                    <div className="font-mono text-xs font-semibold bg-surface-100 px-2 py-1 rounded-lg inline-block text-surface-800">
                      {job.job_code}
                    </div>
                    <div className="text-xs text-surface-400 mt-0.5">by {job.created_by_name || 'QC'}</div>
                  </td>
                  <td>
                    <div className="font-medium text-surface-800">{job.product_name}</div>
                    <div className="text-xs text-surface-400">{job.product_sku}</div>
                  </td>
                  <td>
                    <span className="badge badge-neutral">{job.label_count ?? job.quantity}</span>
                  </td>
                  <td className="text-surface-700">{job.total_prints ?? job.quantity}</td>
                  <td className="text-xs text-surface-400">{formatDate(job.created_at)}</td>
                  <td>
                    <div className="flex flex-wrap gap-1.5">
                      {!isQc && <button className="btn-secondary btn-sm" onClick={() => downloadJob(job)}>
                        <Download size={13} /> Download PDF
                      </button>}
                      {isQc && (
                        <button className="btn-primary btn-sm" onClick={() => openReprint(job)}>
                          <Printer size={13} /> Request reprint
                        </button>
                      )}
                      {canReprint && <button className="btn-primary btn-sm" onClick={() => openReprint(job)}><Printer size={13} /> Reprint</button>}
                    </div>
                  </td>
                </tr>
              ))}
              {jobs.length === 0 && (
                <tr>
                  <td colSpan={6}>
                    <div className="empty-state">
                      <div className="empty-icon"><Package size={24} className="text-surface-400" /></div>
                      <div className="empty-title">
                        {search ? 'No QR jobs match your search' : 'No QR labels generated yet'}
                      </div>
                      <div className="empty-desc">
                        {search
                          ? 'Try another job code, product name, or SKU.'
                          : 'Initial labels are generated automatically when QC creates a batch.'}
                      </div>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {canReprint && <section className="card mt-6"><div className="card-header flex items-center justify-between"><div><h2 className="section-title">QC reprint requests</h2><p className="mt-1 text-sm text-surface-500">Open a request to print its selected labels. It will be completed after printing.</p></div><span className="badge badge-warning">{reprintRequests.length} pending</span></div><div className="table-wrap"><table><thead><tr><th>Job</th><th>Requested by</th><th>Labels</th><th>Requested</th><th /></tr></thead><tbody>{reprintRequests.map((request: any) => <tr key={request.id}><td className="font-mono text-xs">{request.job_code}</td><td>{request.requested_by_name || '-'}</td><td>{request.requested_count}</td><td className="text-xs text-surface-500">{formatDate(request.requested_at)}</td><td className="text-right"><button className="btn-primary btn-xs" onClick={() => openRequestedLabels(request)}>Open request</button></td></tr>)}{reprintRequests.length === 0 && <tr><td colSpan={5}><div className="empty-state"><div className="empty-title">No pending reprint requests</div></div></td></tr>}</tbody></table></div></section>}

      {/* ── Reprint Modal ──────────────────────────────────────────────────── */}
      {(canReprint || isQc) && reprintJob && (
        <div className="modal-overlay">
          <div className="modal-content max-w-3xl" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h2 className="text-base font-semibold text-surface-900">{isQc ? 'Request QR reprint' : 'Reprint QR labels'}</h2>
                <p className="text-xs text-surface-400 mt-0.5">{reprintJob.job_code} · {reprintJob.product_name}</p>
              </div>
              <button
                className="btn-ghost btn-sm"
                onClick={() => setReprintJob(null)}
                disabled={reprinting || reprintLoading}
                aria-label="Close reprint dialog"
              >
                <X size={16} />
              </button>
            </div>

            <div className="modal-body space-y-4">
              {/* Quantity controls */}
              <div className="flex flex-wrap items-end gap-3 rounded-xl bg-surface-50 border border-surface-100 p-3">
                <div className="space-y-1.5">
                  <label className="input-label">Reprint quantity</label>
                  <input
                    className="input w-32"
                    type="number"
                    min="1"
                    max={reprintLabels.length}
                    value={reprintQty}
                    onChange={(e) => applyQuantity(e.target.value)}
                  />
                </div>
                <button className="btn-secondary btn-sm" onClick={() => applyQuantity(reprintQty)}>
                  Select first N
                </button>
                <button className="btn-ghost btn-sm" onClick={() => { setSelectedIds(reprintLabels.map((l) => l.id)); setReprintQty(String(reprintLabels.length)); }}>
                  Select all
                </button>
                <button className="btn-ghost btn-sm" onClick={() => { setSelectedIds([]); setReprintQty('0'); }}>
                  Clear
                </button>
                <span className="text-xs text-surface-500 ml-auto">{selectedIds.length} of {reprintLabels.length} selected</span>
              </div>

              {/* Label list */}
              <div className="max-h-80 overflow-y-auto border border-surface-200 rounded-xl divide-y divide-surface-100">
                {reprintLoading && (
                  <div className="p-6 text-center text-sm text-surface-400 flex items-center justify-center gap-2">
                    <Loader2 size={16} className="animate-spin" /> Loading labels…
                  </div>
                )}
                {!reprintLoading && reprintLabels.map((label) => (
                  <label
                    key={label.id}
                    className="flex items-center gap-3 px-3 py-2.5 cursor-pointer hover:bg-surface-50"
                  >
                    <input
                      type="checkbox"
                      checked={selectedIds.includes(label.id)}
                      onChange={() => toggleLabel(label.id)}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium text-surface-800">
                        Label {label.serial_no} · {label.batch_number}
                      </div>
                      <div className="text-[10px] text-surface-400 font-mono break-all">{label.qr_value}</div>
                    </div>
                    <span className="badge badge-neutral">printed {label.print_count ?? 1}×</span>
                  </label>
                ))}
              </div>

              <p className="text-xs text-surface-400">{isQc ? 'The selected label list will be sent to an administrator for reprinting.' : 'Only selected labels are included in the reprint.'}</p>
            </div>

            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => setReprintJob(null)} disabled={reprinting || reprintLoading}>
                Cancel
              </button>
              {canReprint && <button
                className="btn-secondary"
                onClick={() => runReprint('print')}
                disabled={reprinting || selectedIds.length === 0}
              >
                <Printer size={15} /> Print selected
              </button>}
              {canReprint && <button
                className="btn-primary"
                onClick={() => runReprint('pdf')}
                disabled={reprinting || selectedIds.length === 0}
              >
                {reprinting ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}
                {reprinting ? 'Preparing…' : 'Download Reprint PDF'}
              </button>}
              {isQc && <button className="btn-primary" onClick={() => void requestReprint()} disabled={reprinting || selectedIds.length === 0}>{reprinting ? <Loader2 size={15} className="animate-spin" /> : <Printer size={15} />} Send reprint request</button>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
