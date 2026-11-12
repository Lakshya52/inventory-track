import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle, CheckCircle, Download, History, Loader2, Package,
  Printer, QrCode, RefreshCw, Search, X,
} from 'lucide-react';
import { api } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { downloadQrPdf, QrJob, QrLabel } from '../utils/qrPdf';
import { prepareDirectQrPrinter, printQrLabelsDirect } from '../utils/directQrPrinter';
import type { EntityId } from '../types';
import { useDebouncedValue } from '../hooks/useDebouncedValue';

type QrJobRow = QrJob & {
  total_prints?: number;
  label_count?: number;
  last_printed_at?: string | null;
  created_by_name?: string;
  batch_number?: string | null;
  batch_status?: string | null;
  printed_count?: number;
  labels_printed?: boolean;
  qc_ready?: boolean;
  can_print_initial?: boolean;
};

function batchStatusBadge(job: QrJobRow): { label: string; className: string } {
  if (job.labels_printed) return { label: 'Printed', className: 'badge-success' };
  const status = String(job.batch_status || 'PENDING_QC').toUpperCase();
  if (job.qc_ready) return { label: 'QC passed', className: 'badge-success' };
  if (status === 'QC_FAILED' || status === 'REJECTED') return { label: 'QC failed', className: 'badge-danger' };
  if (status === 'PENDING_QC') return { label: 'Awaiting QC', className: 'badge-warning' };
  return { label: status.replace(/_/g, ' '), className: 'badge-neutral' };
}

function formatDate(value?: string | null): string {
  if (!value) return '-';
  return new Date(value).toLocaleString(undefined, {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

export default function QRLabels() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';
  const isDispatch = user?.role === 'DISPATCH';
  const canPrintInitial = isAdmin || isDispatch;
  // Only Dispatch raises reprint requests; an administrator approves them.
  const canRequestReprint = isDispatch;
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
  const [initialPrintingId, setInitialPrintingId] = useState<EntityId | null>(null);
  const [reprintRequests, setReprintRequests] = useState<any[]>([]);
  const [fulfillingRequestId, setFulfillingRequestId] = useState<EntityId | null>(null);
  const [reviewingRequestId, setReviewingRequestId] = useState<EntityId | null>(null);
  const listRequest = useRef(0);
  const detailRequest = useRef(0);

  const load = useCallback(async (showSpinner = false) => {
    const requestId = ++listRequest.current;
    if (showSpinner) setRefreshing(true);
    if (requestId === listRequest.current) setError('');
    try {
      const jobRows = await api.qc.qrJobs.list(debouncedSearch || undefined);
      if (requestId === listRequest.current) setJobs(jobRows.items || []);
      if (requestId === listRequest.current) setReprintRequests(await api.qc.qrJobs.reprintRequests('ALL'));
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
    if (!requestedIds?.length) setFulfillingRequestId(null);
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
      const printerName = mode === 'print' ? await prepareDirectQrPrinter() : undefined;
      const result = await api.qc.qrJobs.reprint(reprintJob.id, {
        quantity: selectedIds.length,
        label_ids: selectedIds,
        ...(fulfillingRequestId !== null ? { approved_request_id: fulfillingRequestId } : {}),
      });
      if (mode === 'pdf') {
        await downloadQrPdf(result.labels, result.job);
        setSuccess(`${result.labels.length} QR label${result.labels.length === 1 ? '' : 's'} reprinted to PDF.`);
      } else {
        let labelSize = { widthMm: 60, heightMm: 64 };
        try { labelSize = await api.auth.printerLabelSize(); } catch { /* Use the default label size if settings cannot load. */ }
        await printQrLabelsDirect(result.labels, result.job, labelSize, printerName!, (sent, total, status) => setSuccess(status || `Sending labels to ${printerName}: ${sent} / ${total} queued…`));
        setSuccess(`${result.labels.length} QR label${result.labels.length === 1 ? '' : 's'} sent to the ${printerName} print queue.`);
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

  const printInitialLabels = async (job: QrJobRow, mode: 'pdf' | 'print') => {
    setError('');
    setSuccess('');
    setInitialPrintingId(job.id);
    try {
      const printerName = mode === 'print' ? await prepareDirectQrPrinter() : undefined;
      const result = await api.qc.qrJobs.printInitial(job.id);
      if (mode === 'pdf') {
        await downloadQrPdf(result.labels, result.job);
        setSuccess(`${result.labels.length} QR label${result.labels.length === 1 ? '' : 's'} downloaded to PDF.`);
      } else {
        let labelSize = { widthMm: 60, heightMm: 64 };
        try { labelSize = await api.auth.printerLabelSize(); } catch { /* Use the default label size if settings cannot load. */ }
        await printQrLabelsDirect(result.labels, result.job, labelSize, printerName!, (sent, total, status) => setSuccess(status || `Sending labels to ${printerName}: ${sent} / ${total} queued…`));
        setSuccess(`${result.labels.length} QR label${result.labels.length === 1 ? '' : 's'} sent to the ${printerName} print queue.`);
      }
      await load();
    } catch (err: any) {
      setError(err.message || 'Could not print QR labels');
    } finally {
      setInitialPrintingId(null);
    }
  };

  const requestReprint = async () => {
    if (!reprintJob || selectedIds.length === 0) { setError('Select at least one label to request.'); return; }
    setReprinting(true); setError(''); setSuccess('');
    try {
      await api.qc.qrJobs.requestReprint(reprintJob.id, selectedIds);
      setReprintJob(null);
      setSuccess('Reprint request sent to an administrator.');
      await load();
    } catch (err: any) { setError(err.message || 'Could not send reprint request'); }
    finally { setReprinting(false); }
  };

  const openRequestedLabels = (request: any) => {
    if (request.status !== 'APPROVED') { setError('Approve this request before printing the replacement labels.'); return; }
    setFulfillingRequestId(request.id);
    const job = jobs.find(row => String(row.id) === String(request.qr_job_id));
    if (job) {
      void openReprint(job, request.label_ids || []);
      return;
    }
    void api.qc.qrJobs.get(request.qr_job_id).then((detail) => {
      const fetchedJob = detail.job as QrJobRow;
      void openReprint(fetchedJob, request.label_ids || []);
    }).catch((err: any) => {
      setFulfillingRequestId(null);
      setError(err.message || `QR job ${request.job_code || request.qr_job_id} is not available.`);
    });
  };

  const reviewRequest = async (request: any, decision: 'APPROVED' | 'REJECTED') => {
    const verb = decision === 'APPROVED' ? 'approve' : 'reject';
    if (decision === 'REJECTED' && !window.confirm(`Reject the reprint request for ${request.job_code || 'this print job'}?`)) return;
    setReviewingRequestId(request.id); setError(''); setSuccess('');
    try {
      await api.qc.qrJobs.reviewReprintRequest(request.id, decision);
      setSuccess(decision === 'APPROVED' ? 'Reprint request approved. It is ready to print.' : 'Reprint request rejected.');
      await load();
    } catch (err: any) { setError(err.message || `Could not ${verb} reprint request`); }
    finally { setReviewingRequestId(null); }
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
            {isDispatch
              ? 'Print each batch’s QR labels once QC passes. Any reprint needs administrator approval.'
              : 'Review QR print jobs and handle replacement requests.'}
            {isAdmin && ' Initial labels are generated with each batch and printed by dispatch after QC passes.'}
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
              placeholder="Search job code or QR code…"
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
                <th>Batch / Status</th>
                <th>Labels</th>
                <th>Prints</th>
                <th>Created</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((job) => {
                const status = batchStatusBadge(job);
                return (
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
                    <div className="text-xs font-medium text-surface-700">{job.batch_number || '—'}</div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      <span className={`badge ${status.className}`}>{status.label}</span>
                      {job.label_count ? <span className="badge badge-neutral">{job.printed_count ?? 0}/{job.label_count} printed</span> : null}
                    </div>
                  </td>
                  <td>
                    <span className="badge badge-neutral">{job.label_count ?? job.quantity}</span>
                  </td>
                  <td className="text-surface-700">{job.total_prints ?? job.quantity}</td>
                  <td className="text-xs text-surface-400">{formatDate(job.created_at)}</td>
                  <td>
                    <div className="flex flex-wrap gap-1.5">
                      {canPrintInitial && job.can_print_initial && (
                        <>
                          <button className="btn-primary btn-sm" disabled={initialPrintingId !== null} onClick={() => void printInitialLabels(job, 'print')}>
                            {initialPrintingId === job.id ? <Loader2 size={13} className="animate-spin" /> : <Printer size={13} />} Print labels
                          </button>
                          {isAdmin && (
                            <button className="btn-secondary btn-sm" disabled={initialPrintingId !== null} onClick={() => void printInitialLabels(job, 'pdf')}>
                              <Download size={13} /> PDF
                            </button>
                          )}
                        </>
                      )}
                      {isAdmin && job.labels_printed && (
                        <>
                          <button className="btn-secondary btn-sm" onClick={() => downloadJob(job)}>
                            <Download size={13} /> Download PDF
                          </button>
                          <button className="btn-primary btn-sm" onClick={() => openReprint(job)}><Printer size={13} /> Reprint</button>
                        </>
                      )}
                      {canRequestReprint && job.labels_printed && (
                        <button className="btn-primary btn-sm" onClick={() => openReprint(job)}>
                          <Printer size={13} /> Request reprint
                        </button>
                      )}
                      {!job.labels_printed && (!job.can_print_initial || !canPrintInitial) && (
                        <span className="text-xs text-surface-400">{job.qc_ready ? 'Waiting for dispatch to print' : 'Awaiting QC pass'}</span>
                      )}
                    </div>
                  </td>
                </tr>
                );
              })}
              {jobs.length === 0 && (
                <tr>
                  <td colSpan={7}>
                    <div className="empty-state">
                      <div className="empty-icon"><Package size={24} className="text-surface-400" /></div>
                      <div className="empty-title">
                        {search ? 'No QR jobs match your search' : 'No QR labels generated yet'}
                      </div>
                      <div className="empty-desc">
                        {search
                          ? 'Try another job code or scan the QR code again.'
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

      {isAdmin && <section className="card mt-6">
        <div className="card-header flex flex-wrap items-center justify-between gap-3">
          <div><h2 className="section-title">Reprint approvals</h2><p className="mt-1 text-sm text-surface-500">Approve QC or Dispatch requests before a replacement label is printed.</p></div>
          <div className="flex items-center gap-2"><span className="badge badge-warning">{reprintRequests.filter(row => row.status === 'PENDING').length} awaiting review</span><button className="btn-secondary btn-sm" onClick={() => load(true)} disabled={refreshing}><RefreshCw size={13} className={refreshing ? 'animate-spin' : ''} /> Refresh</button></div>
        </div>
        <div className="table-wrap"><table><thead><tr><th>Print job</th><th>Requested by</th><th>Labels</th><th>Requested</th><th>Status</th><th className="text-right">Action</th></tr></thead><tbody>
          {reprintRequests.map((request: any) => <tr key={request.id}>
            <td><span className="font-mono text-xs">{request.job_code || request.qr_job_id}</span></td><td>{request.requested_by_name || 'User'}</td><td>{request.requested_count}</td><td className="text-xs text-surface-500">{formatDate(request.requested_at)}</td>
            <td><span className={`badge ${request.status === 'PENDING' ? 'badge-warning' : request.status === 'APPROVED' ? 'badge-success' : request.status === 'REJECTED' ? 'badge-danger' : 'badge-neutral'}`}>{request.status}</span>{request.reviewed_by_name && <div className="mt-1 text-[11px] text-surface-400">Reviewed by {request.reviewed_by_name}{request.review_note ? ` · ${request.review_note}` : ''}</div>}</td>
            <td className="text-right"><div className="inline-flex flex-wrap justify-end gap-1.5">
              {request.status === 'PENDING' && <><button className="btn-primary btn-xs" disabled={reviewingRequestId !== null} onClick={() => void reviewRequest(request, 'APPROVED')}>{reviewingRequestId === request.id ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle size={12} />} Approve</button><button className="btn-secondary btn-xs text-rose-600" disabled={reviewingRequestId !== null} onClick={() => void reviewRequest(request, 'REJECTED')}>Reject</button></>}
              {request.status === 'APPROVED' && <button className="btn-primary btn-xs" onClick={() => openRequestedLabels(request)}><Printer size={12} /> Print approved labels</button>}
              {request.status === 'FULFILLED' && <span className="text-xs text-surface-500">Printed {formatDate(request.fulfilled_at)}</span>}
            </div></td>
          </tr>)}
          {reprintRequests.length === 0 && <tr><td colSpan={6}><div className="empty-state"><div className="empty-title">No reprint requests yet</div><div className="empty-desc">QC and Dispatch requests will appear here for review.</div></div></td></tr>}
        </tbody></table></div>
      </section>}

      {canRequestReprint && <section className="card mt-6">
        <div className="card-header flex flex-wrap items-center justify-between gap-3">
          <div><h2 className="section-title">My reprint requests</h2><p className="mt-1 text-sm text-surface-500">Approved requests can be printed here once an administrator approves them.</p></div>
          <button className="btn-secondary btn-sm" onClick={() => load(true)} disabled={refreshing}><RefreshCw size={13} className={refreshing ? 'animate-spin' : ''} /> Refresh</button>
        </div>
        <div className="table-wrap"><table><thead><tr><th>Print job</th><th>Labels</th><th>Requested</th><th>Status</th><th className="text-right">Action</th></tr></thead><tbody>
          {reprintRequests.map((request: any) => <tr key={request.id}>
            <td><span className="font-mono text-xs">{request.job_code || request.qr_job_id}</span></td><td>{request.requested_count}</td><td className="text-xs text-surface-500">{formatDate(request.requested_at)}</td>
            <td><span className={`badge ${request.status === 'PENDING' ? 'badge-warning' : request.status === 'APPROVED' ? 'badge-success' : request.status === 'REJECTED' ? 'badge-danger' : 'badge-neutral'}`}>{request.status}</span>{request.review_note && <div className="mt-1 text-[11px] text-surface-400">{request.review_note}</div>}</td>
            <td className="text-right">{request.status === 'APPROVED' ? <button className="btn-primary btn-xs" onClick={() => openRequestedLabels(request)}><Printer size={12} /> Print approved labels</button> : request.status === 'FULFILLED' ? <span className="text-xs text-surface-500">Printed {formatDate(request.fulfilled_at)}</span> : <span className="text-xs text-surface-400">Waiting for admin review</span>}</td>
          </tr>)}
          {reprintRequests.length === 0 && <tr><td colSpan={5}><div className="empty-state"><div className="empty-title">No reprint requests yet</div><div className="empty-desc">Requests and their approval status will appear here.</div></div></td></tr>}
        </tbody></table></div>
      </section>}

      {/* ── Reprint Modal ──────────────────────────────────────────────────── */}
      {(isAdmin || canRequestReprint) && reprintJob && (
        <div className="modal-overlay">
          <div className="modal-content max-w-3xl" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h2 className="text-base font-semibold text-surface-900">{isAdmin ? 'Reprint QR labels' : 'Request QR reprint'}</h2>
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
              {!fulfillingRequestId && <div className="flex flex-wrap items-end gap-3 rounded-xl bg-surface-50 border border-surface-100 p-3">
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
              </div>}

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
                    className={`flex items-center gap-3 px-3 py-2.5 ${fulfillingRequestId ? 'cursor-default' : 'cursor-pointer hover:bg-surface-50'}`}
                  >
                    <input
                      type="checkbox"
                      checked={selectedIds.includes(label.id)}
                      onChange={() => toggleLabel(label.id)}
                      disabled={fulfillingRequestId !== null}
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

              <p className="text-xs text-surface-400">{fulfillingRequestId ? 'Only the labels included in the approved request will be printed.' : !isAdmin ? 'The selected label list will be sent to an administrator for reprinting.' : 'Only selected labels are included in the reprint.'}</p>
            </div>

            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => setReprintJob(null)} disabled={reprinting || reprintLoading}>
                Cancel
              </button>
              {isAdmin && fulfillingRequestId === null && <button
                className="btn-secondary"
                onClick={() => runReprint('print')}
                disabled={reprinting || selectedIds.length === 0}
              >
                <Printer size={15} /> Print selected
              </button>}
              {isAdmin && <button
                className="btn-primary"
                onClick={() => runReprint('pdf')}
                disabled={reprinting || selectedIds.length === 0}
              >
                {reprinting ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}
                {reprinting ? 'Preparing…' : 'Download Reprint PDF'}
              </button>}
              {canRequestReprint && fulfillingRequestId !== null && <button className="btn-primary" onClick={() => void runReprint('print')} disabled={reprinting || reprintLoading || selectedIds.length === 0}>{reprinting ? <Loader2 size={15} className="animate-spin" /> : <Printer size={15} />} Print approved labels</button>}
              {canRequestReprint && fulfillingRequestId === null && <button className="btn-primary" onClick={() => void requestReprint()} disabled={reprinting || selectedIds.length === 0}>{reprinting ? <Loader2 size={15} className="animate-spin" /> : <Printer size={15} />} Send reprint request</button>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
