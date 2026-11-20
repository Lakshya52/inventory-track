import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle, CheckCircle, ChevronDown, ChevronLeft, ChevronRight, Download,
  History, Loader2, Package, Printer, QrCode, RefreshCw, Search, X,
} from 'lucide-react';
import { api } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { downloadQrPdf, QrJob, QrLabel } from '../utils/qrPdf';
import { prepareDirectQrPrinter, printQrLabelsDirect } from '../utils/directQrPrinter';
import type { EntityId } from '../types';
import {
  formatDate as formatIsoDate,
  formatDateTime as formatIsoDateTime,
} from '../utils/dateFormat';

type QrJobRow = QrJob & {
  total_prints?: number;
  label_count?: number;
  last_printed_at?: string | null;
  created_by_name?: string;
  batch_number?: string | null;
  batch_group_id?: string | null;
  batch_status?: string | null;
  printed_count?: number;
  labels_printed?: boolean;
  qc_ready?: boolean;
  can_print_initial?: boolean;
};

type BatchGroup = {
  key: string;
  batchNumber: string;
  jobs: QrJobRow[];
  labelCount: number;
  printedCount: number;
  totalPrints: number;
  createdAt?: string | null;
};

function groupStatusBadge(group: BatchGroup): { label: string; className: string } {
  if (group.labelCount > 0 && group.printedCount >= group.labelCount) {
    return { label: 'Printed', className: 'badge-success' };
  }
  if (group.printedCount > 0) {
    return { label: 'Partially printed', className: 'badge-warning' };
  }
  if (group.jobs.some((job) => job.qc_ready)) {
    return { label: 'QC passed', className: 'badge-success' };
  }
  const status = String(group.jobs[0]?.batch_status || 'PENDING_QC').toUpperCase();
  if (status === 'QC_FAILED' || status === 'REJECTED') return { label: 'QC failed', className: 'badge-danger' };
  if (status === 'PENDING_QC') return { label: 'Awaiting QC', className: 'badge-warning' };
  return { label: status.replace(/_/g, ' '), className: 'badge-neutral' };
}

function batchStatusBadge(job: QrJobRow): { label: string; className: string } {
  if (job.labels_printed) return { label: 'Printed', className: 'badge-success' };
  const status = String(job.batch_status || 'PENDING_QC').toUpperCase();
  if (job.qc_ready) return { label: 'QC passed', className: 'badge-success' };
  if (status === 'QC_FAILED' || status === 'REJECTED') return { label: 'QC failed', className: 'badge-danger' };
  if (status === 'PENDING_QC') return { label: 'Awaiting QC', className: 'badge-warning' };
  return { label: status.replace(/_/g, ' '), className: 'badge-neutral' };
}

export default function QRLabels() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';
  const isDispatch = user?.role === 'DISPATCH';
  const canPrintInitial = isAdmin || isDispatch;
  // Only Dispatch raises reprint requests; an administrator approves them.
  const canRequestReprint = isDispatch;
  const [jobs, setJobs] = useState<QrJobRow[]>([]);
  const [jobTotal, setJobTotal] = useState(0);
  const [jobPages, setJobPages] = useState(1);
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'READY' | 'PRINTED' | 'AWAITING_QC'>('ALL');
  const [groupPage, setGroupPage] = useState(1);
  const [groupPageSize, setGroupPageSize] = useState(10);
  const [search, setSearch] = useState('');
  // Single source of truth: `appliedSearch` is the only value that drives the
  // query. A cancellable timer lets typing auto-search after a short debounce,
  // while Search applies immediately and Clear cancels anything pending. Keeping
  // one writer avoids a stale debounce overwriting an explicit button action.
  const [appliedSearch, setAppliedSearch] = useState('');
  const searchTimer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(searchTimer.current), []);

  const applySearch = (value: string, immediate: boolean) => {
    window.clearTimeout(searchTimer.current);
    const next = value.trim();
    if (immediate) {
      setAppliedSearch(next);
    } else {
      searchTimer.current = window.setTimeout(() => setAppliedSearch(next), 300);
    }
    setGroupPage(1);
  };

  const runSearch = () => applySearch(search, true);
  const clearSearch = () => {
    window.clearTimeout(searchTimer.current);
    setSearch('');
    setAppliedSearch('');
    setGroupPage(1);
  };
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
  const [batchPrintingKey, setBatchPrintingKey] = useState<string | null>(null);
  const [reprintMode, setReprintMode] = useState<'LABELS' | 'SKU'>('LABELS');
  const [skuQuery, setSkuQuery] = useState('');
  const [skuCount, setSkuCount] = useState('1');
  const [skuResults, setSkuResults] = useState<Array<{ jobId: EntityId; jobCode: string; labels: QrLabel[] }>>([]);
  const [skuLoading, setSkuLoading] = useState(false);
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
      const jobRows = await api.qc.qrJobs.list({
        q: appliedSearch || undefined,
        page: groupPage,
        limit: groupPageSize,
      });
      if (requestId === listRequest.current) {
        setJobs(jobRows.items || []);
        setJobTotal(jobRows.total);
        setJobPages(jobRows.pages);
      }
      if (requestId === listRequest.current) setReprintRequests(await api.qc.qrJobs.reprintRequests('ALL'));
    } catch (err: any) {
      if (requestId === listRequest.current) setError(err.message || 'Could not load QR labels');
    } finally {
      if (requestId === listRequest.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [appliedSearch, user?.role, groupPage, groupPageSize]);

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
    setReprintMode('LABELS');
    setSkuQuery('');
    setSkuResults([]);
    setSkuCount('1');
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

  /**
   * Print every unprinted job of a batch in a single run. Reuses the exact
   * printInitial endpoint the printer already uses, so print accounting is
   * identical — only the UI sends them together to one printer/PDF job.
   */
  const printBatch = async (group: BatchGroup, mode: 'pdf' | 'print') => {
    const pendingJobs = group.jobs.filter((job) =>
      job.can_print_initial && !job.labels_printed && Number(job.printed_count ?? 0) === 0
    );
    if (pendingJobs.length === 0) {
      setError('Every job in this batch has already been printed. Use reprint for another copy.');
      return;
    }
    setError('');
    setSuccess('');
    setBatchPrintingKey(group.key);
    try {
      const printerName = mode === 'print' ? await prepareDirectQrPrinter() : undefined;
      const allLabels: QrLabel[] = [];
      let firstJob: QrJob | null = null;
      for (const job of pendingJobs) {
        const result = await api.qc.qrJobs.printInitial(job.id);
        allLabels.push(...(result.labels || []));
        if (!firstJob) firstJob = result.job;
      }
      if (!firstJob || allLabels.length === 0) throw new Error('No labels were available for this batch');
      if (mode === 'pdf') {
        await downloadQrPdf(allLabels, firstJob);
        setSuccess(`${allLabels.length} QR labels from ${group.batchNumber} downloaded to one PDF.`);
      } else {
        let labelSize = { widthMm: 60, heightMm: 64 };
        try { labelSize = await api.auth.printerLabelSize(); } catch { /* default size */ }
        await printQrLabelsDirect(allLabels, firstJob, labelSize, printerName!, (sent, total, status) =>
          setSuccess(status || `Sending ${group.batchNumber}: ${sent} / ${total} queued…`));
        setSuccess(`${allLabels.length} QR labels from ${group.batchNumber} sent to the ${printerName} print queue.`);
      }
      await load();
    } catch (err: any) {
      setError(err.message || 'Could not print this batch');
    } finally {
      setBatchPrintingKey(null);
    }
  };

  const findSkuLabels = async () => {
    const query = skuQuery.trim().toLowerCase();
    if (!query || !reprintJob) return;
    setSkuLoading(true);
    setError('');
    try {
      const batchKey = String(reprintJob.batch_group_id || reprintJob.batch_number);
      const batchJobs = jobs.filter((job) =>
        String(job.batch_group_id || job.batch_number) === batchKey
      );
      const details = await Promise.all(batchJobs.map((job) => api.qc.qrJobs.get(job.id)));
      const results = details.map((detail) => ({
        jobId: detail.job.id,
        jobCode: detail.job.job_code,
        labels: (detail.labels || []).filter((label: QrLabel) =>
          String(label.product_sku || '').toLowerCase().includes(query)
        ),
      })).filter((result) => result.labels.length > 0);
      setSkuResults(results);
      const wanted = Math.max(1, Math.min(1000, Number(skuCount) || 1));
      const all = results.flatMap((result) => result.labels);
      setSelectedIds(all.slice(0, wanted).map((label) => label.id));
    } catch (err: any) {
      setError(err.message || 'Could not look up labels for that SKU');
    } finally {
      setSkuLoading(false);
    }
  };

  const requestReprintBySku = async () => {
    if (selectedIds.length === 0) { setError('Find a SKU with at least one label first.'); return; }
    setReprinting(true);
    setError('');
    try {
      let requests = 0;
      let labels = 0;
      for (const result of skuResults) {
        const ids = result.labels.filter((label) => selectedIds.includes(label.id)).map((label) => label.id);
        if (!ids.length) continue;
        await api.qc.qrJobs.requestReprint(result.jobId, ids);
        requests += 1;
        labels += ids.length;
      }
      setReprintJob(null);
      setSuccess(`Reprint requested for ${labels} label(s) of ${skuQuery.trim()} across ${requests} print job(s).`);
      await load();
    } catch (err: any) {
      setError(err.message || 'Could not send the SKU reprint request');
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
  const totalJobs = jobTotal;
  const totalLabels = jobs.reduce((sum, j) => sum + (j.label_count ?? j.quantity ?? 0), 0);
  const totalPrints = jobs.reduce((sum, j) => sum + (j.total_prints ?? j.quantity ?? 0), 0);
  const lastPrinted = jobs.reduce<string | null>((latest, j) => {
    if (!j.last_printed_at) return latest;
    if (!latest) return j.last_printed_at;
    return j.last_printed_at > latest ? j.last_printed_at : latest;
  }, null);

  // Group print jobs by their batch/group so one batch shows as a single
  // expandable row instead of one row per product.
  const groupedJobs = useMemo<BatchGroup[]>(() => {
    const groups = new Map<string, BatchGroup>();
    for (const job of jobs) {
      const key = String(job.batch_group_id || job.batch_number || job.job_code);
      let group = groups.get(key);
      if (!group) {
        group = {
          key,
          batchNumber: job.batch_number || '—',
          jobs: [],
          labelCount: 0,
          printedCount: 0,
          totalPrints: 0,
          createdAt: job.created_at,
        };
        groups.set(key, group);
      }
      group.jobs.push(job);
      group.labelCount += Number(job.label_count ?? job.quantity ?? 0);
      group.printedCount += Number(job.printed_count ?? 0);
      group.totalPrints += Number(job.total_prints ?? job.quantity ?? 0);
    }
    return [...groups.values()];
  }, [jobs]);

  const allGroupsExpanded = groupedJobs.length > 0 &&
    groupedJobs.every((group) => expandedGroups[group.key]);
  const toggleGroup = (key: string) =>
    setExpandedGroups((current) => ({ ...current, [key]: !current[key] }));
  const toggleAllGroups = () =>
    setExpandedGroups(
      allGroupsExpanded
        ? {}
        : Object.fromEntries(groupedJobs.map((group) => [group.key, true])),
    );

  const isReadyGroup = (group: BatchGroup) => {
    const label = groupStatusBadge(group).label;
    return label === 'QC passed' || label === 'Partially printed';
  };
  const readyCount = groupedJobs.filter(isReadyGroup).length;
  const unprintedLabels = Math.max(0, totalLabels - totalPrints);
  const printProgress = totalLabels > 0 ? Math.min(100, Math.round((totalPrints / totalLabels) * 100)) : 0;

  const filteredGroups = groupedJobs.filter((group) => {
    if (statusFilter === 'READY') return isReadyGroup(group);
    if (statusFilter === 'PRINTED') return groupStatusBadge(group).label === 'Printed';
    if (statusFilter === 'AWAITING_QC') return groupStatusBadge(group).label === 'Awaiting QC';
    return true;
  });
  const groupPages = jobPages;
  const pageGroups = filteredGroups;

  const renderJobRow = (job: QrJobRow) => {
    const status = batchStatusBadge(job);
    return (
      <tr key={job.id}>
        <td>
          <div className="border-l-2 border-brand-100 pl-3">
            <div className="font-mono text-xs font-semibold bg-surface-100 px-2 py-1 rounded-lg inline-block text-surface-800">
              {job.job_code}
            </div>
            <div className="text-xs text-surface-400 mt-0.5">by {job.created_by_name || 'QC'}</div>
          </div>
        </td>
        <td>
          <div className="font-medium text-surface-800">{job.product_name}</div>
          <div className="text-xs text-surface-400">{job.product_sku}</div>
        </td>
        <td>
          <div className="flex flex-wrap gap-1">
            <span className={`badge ${status.className}`}>{status.label}</span>
            {job.label_count ? <span className="badge badge-neutral">{job.printed_count ?? 0}/{job.label_count} printed</span> : null}
          </div>
        </td>
        <td>
          <span className="badge badge-neutral">{job.label_count ?? job.quantity}</span>
        </td>
        <td className="text-surface-700">{job.total_prints ?? job.quantity}</td>
        <td className="text-xs text-surface-400">{formatIsoDateTime(job.created_at)}</td>
        <td>
          <div className="flex flex-wrap gap-1.5">
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
            {!job.labels_printed && (
              <span className="text-xs text-surface-400">
                {job.qc_ready ? 'Use Print batch above' : 'Awaiting QC pass'}
              </span>
            )}
          </div>
        </td>
      </tr>
    );
  };

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
      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <button
          type="button"
          onClick={() => { setStatusFilter('READY'); setGroupPage(1); }}
          className={`rounded-2xl border-2 bg-white p-5 text-left shadow-sm transition-colors hover:border-brand-300 ${statusFilter === 'READY' ? 'border-brand-500' : 'border-slate-200'}`}
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Ready to print</div>
              <div className="mt-1 text-3xl font-extrabold tabular-nums text-slate-900">{readyCount}</div>
              <div className="mt-1 text-xs text-slate-500">batches with QC passed</div>
            </div>
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-50 text-brand-600"><Printer size={20} /></span>
          </div>
        </button>
        <button
          type="button"
          onClick={() => { setStatusFilter('ALL'); setGroupPage(1); }}
          className="rounded-2xl border-2 border-slate-200 bg-white p-5 text-left shadow-sm transition-colors hover:border-brand-300"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Labels printed</div>
              <div className="mt-1 text-3xl font-extrabold tabular-nums text-slate-900">
                {totalPrints.toLocaleString()}
                <span className="ml-1 text-base font-semibold text-slate-400">/ {totalLabels.toLocaleString()}</span>
              </div>
              <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                <div className="h-full rounded-full bg-emerald-500" style={{ width: `${printProgress}%` }} />
              </div>
              <div className="mt-1 text-xs text-slate-500">{printProgress}% · {unprintedLabels.toLocaleString()} unprinted on this page</div>
            </div>
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600"><QrCode size={20} /></span>
          </div>
        </button>
        <div className="rounded-2xl border-2 border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Print jobs</div>
              <div className="mt-1 text-3xl font-extrabold tabular-nums text-slate-900">{totalJobs}</div>
              <div className="mt-1 text-xs text-slate-500">{groupedJobs.length} batches on page {groupPage} of {groupPages}</div>
            </div>
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-sky-50 text-sky-600"><History size={20} /></span>
          </div>
        </div>
        <div className="rounded-2xl border-2 border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Last printed</div>
              <div className="mt-2 text-xl font-extrabold text-slate-900">{lastPrinted ? formatIsoDate(lastPrinted) : '—'}</div>
              <div className="mt-1 text-xs text-slate-500">most recent print run</div>
            </div>
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-50 text-amber-600"><Download size={20} /></span>
          </div>
        </div>
      </div>

      {/* ── Print Jobs ──────────────────────────────────────────────────────── */}
      <section className="rounded-2xl border-2 border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-4 border-b border-slate-100 p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-100 text-brand-700">
                <QrCode size={20} />
              </div>
              <div>
                <h2 className="text-lg font-extrabold text-slate-900">Print jobs</h2>
                <p className="mt-0.5 text-xs text-slate-500">One card per batch — expand to see its QR jobs and print actions.</p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <select
                aria-label="Batches per page"
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700"
                value={groupPageSize}
                onChange={(event) => { setGroupPageSize(Number(event.target.value)); setGroupPage(1); }}
              >
                {[10, 25, 50, 100].map((size) => <option key={size} value={size}>{size} / page</option>)}
              </select>
              <button type="button" className="btn-secondary btn-sm" onClick={toggleAllGroups} disabled={groupedJobs.length === 0}>
                <ChevronDown size={14} /> {allGroupsExpanded ? 'Collapse all' : 'Expand all'}
              </button>
              <span className="badge badge-neutral">{filteredGroups.length} batches</span>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap gap-1 border-b border-slate-200">
              {([
                ['ALL', 'All'],
                ['READY', 'Ready to print'],
                ['PRINTED', 'Printed'],
                ['AWAITING_QC', 'Awaiting QC'],
              ] as const).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => { setStatusFilter(value); setGroupPage(1); }}
                  className={`-mb-px inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-xs font-bold transition-colors ${statusFilter === value ? 'border-brand-600 text-brand-600' : 'border-transparent text-slate-500 hover:text-slate-800'}`}
                >
                  {label}
                  <span className={`rounded-md px-1.5 py-0.5 text-[10px] ${statusFilter === value ? 'bg-brand-50 text-brand-700' : 'bg-slate-100 text-slate-500'}`}>
                    {value === 'ALL' ? groupedJobs.length : value === 'READY' ? readyCount : value === 'PRINTED' ? groupedJobs.filter((g) => groupStatusBadge(g).label === 'Printed').length : groupedJobs.filter((g) => groupStatusBadge(g).label === 'Awaiting QC').length}
                  </span>
                </button>
              ))}
            </div>
            <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
              <label className="relative block w-full sm:w-72">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-surface-400" />
                <input
                  className="input pl-9 py-2 text-sm"
                  placeholder="Search job code, batch number, or QR code…"
                  value={search}
                  onChange={(event) => { setSearch(event.target.value); applySearch(event.target.value, false); }}
                  onKeyDown={(event) => { if (event.key === 'Enter') runSearch(); }}
                />
              </label>
              <button type="button" className="btn-primary btn-sm h-10" onClick={runSearch}>
                <Search size={14} /> Search
              </button>
              <button
                type="button"
                className="btn-ghost btn-sm h-10"
                onClick={clearSearch}
                disabled={!search && !appliedSearch}
              >
                <X size={14} /> Clear
              </button>
            </div>
          </div>
        </div>

        <div className="divide-y divide-slate-100">
          {pageGroups.map((group) => {
            const expanded = expandedGroups[group.key] ?? Boolean(appliedSearch);
            const status = groupStatusBadge(group);
            const pct = group.labelCount > 0 ? Math.min(100, Math.round((group.printedCount / group.labelCount) * 100)) : 0;
            return (
              <article key={group.key} className="px-5 py-4">
                <div className="flex w-full items-start gap-3">
                  <button
                    type="button"
                    className="flex min-w-0 flex-1 items-start gap-3 text-left"
                    onClick={() => toggleGroup(group.key)}
                    aria-expanded={expanded}
                  >
                    <ChevronDown size={18} className={`mt-0.5 shrink-0 text-slate-500 transition-transform ${expanded ? '' : '-rotate-90'}`} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-sm font-extrabold text-slate-900">{group.batchNumber}</span>
                        <span className={`badge ${status.className}`}>{status.label}</span>
                        <span className="badge badge-neutral">{group.jobs.length} product{group.jobs.length === 1 ? '' : 's'}</span>
                        <span className="ml-auto text-xs text-surface-400">{formatIsoDateTime(group.createdAt)}</span>
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-3">
                        <div className="h-2 w-40 overflow-hidden rounded-full bg-slate-100">
                          <div className={`h-full rounded-full ${pct >= 100 ? 'bg-emerald-500' : 'bg-brand-500'}`} style={{ width: `${pct}%` }} />
                        </div>
                        <span className="text-xs font-semibold text-slate-600">{group.printedCount}/{group.labelCount} labels printed</span>
                      </div>
                    </div>
                  </button>
                  {canPrintInitial && group.jobs.some((job) => job.can_print_initial) && (() => {
                    const hasPending = group.jobs.some((job) =>
                      job.can_print_initial && !job.labels_printed && Number(job.printed_count ?? 0) === 0);
                    if (!hasPending) return <span className="badge badge-success">All printed</span>;
                    return (
                      <div className="flex shrink-0 flex-wrap gap-2">
                        <button
                          type="button"
                          className="btn-primary btn-sm"
                          disabled={batchPrintingKey !== null}
                          onClick={() => void printBatch(group, 'print')}
                          title="Print every unprinted QR label of this batch in one job"
                        >
                          {batchPrintingKey === group.key ? <Loader2 size={14} className="animate-spin" /> : <Printer size={14} />}
                          Print batch
                        </button>
                        {isAdmin && (
                          <button
                            type="button"
                            className="btn-secondary btn-sm"
                            disabled={batchPrintingKey !== null}
                            onClick={() => void printBatch(group, 'pdf')}
                            title="Download all unprinted labels of this batch as one PDF"
                          >
                            <Download size={14} /> Batch PDF
                          </button>
                        )}
                      </div>
                    );
                  })()}
                </div>
                {expanded && (
                  <div className="mt-3 overflow-x-auto rounded-xl border border-slate-200">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-50 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                        <tr>
                          <th className="px-3 py-2">Job Code</th>
                          <th className="px-3 py-2">Product</th>
                          <th className="px-3 py-2">Batch / Status</th>
                          <th className="px-3 py-2">Labels</th>
                          <th className="px-3 py-2">Prints</th>
                          <th className="px-3 py-2">Created</th>
                          <th className="px-3 py-2">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {group.jobs.map((job) => renderJobRow(job))}
                      </tbody>
                    </table>
                  </div>
                )}
              </article>
            );
          })}
          {filteredGroups.length === 0 && (
            <div className="px-6 py-14 text-center">
              <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600"><Package size={24} /></span>
              <p className="mt-3 text-base font-bold text-slate-800">{appliedSearch ? 'No QR jobs match your search' : 'No batches in this view'}</p>
              <p className="mt-1 text-sm text-slate-500">{appliedSearch ? 'Try another job code, batch number, or QR value.' : 'Switch the filter above to see other batches.'}</p>
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-5 py-3">
          <span className="text-xs font-semibold text-slate-500">Page {groupPage} of {groupPages} · {filteredGroups.length} batches</span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              aria-label="Previous page"
              disabled={groupPage <= 1}
              onClick={() => setGroupPage((page) => page - 1)}
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-600 disabled:opacity-40"
            >
              <ChevronLeft size={15} />
            </button>
            <button
              type="button"
              aria-label="Next page"
              disabled={groupPage >= groupPages}
              onClick={() => setGroupPage((page) => page + 1)}
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-600 disabled:opacity-40"
            >
              <ChevronRight size={15} />
            </button>
          </div>
        </div>
      </section>

      {isAdmin && <section className="card mt-6">
        <div className="card-header flex flex-wrap items-center justify-between gap-3">
          <div><h2 className="section-title">Reprint approvals</h2><p className="mt-1 text-sm text-surface-500">Approve QC or Dispatch requests before a replacement label is printed.</p></div>
          <div className="flex items-center gap-2"><span className="badge badge-warning">{reprintRequests.filter(row => row.status === 'PENDING').length} awaiting review</span><button className="btn-secondary btn-sm" onClick={() => load(true)} disabled={refreshing}><RefreshCw size={13} className={refreshing ? 'animate-spin' : ''} /> Refresh</button></div>
        </div>
        <div className="table-wrap"><table><thead><tr><th>Print job</th><th>Requested by</th><th>Labels</th><th>Requested</th><th>Status</th><th className="text-right">Action</th></tr></thead><tbody>
          {reprintRequests.map((request: any) => <tr key={request.id}>
            <td><span className="font-mono text-xs">{request.job_code || request.qr_job_id}</span></td><td>{request.requested_by_name || 'User'}</td><td>{request.requested_count}</td><td className="text-xs text-surface-500">{formatIsoDateTime(request.requested_at)}</td>
            <td><span className={`badge ${request.status === 'PENDING' ? 'badge-warning' : request.status === 'APPROVED' ? 'badge-success' : request.status === 'REJECTED' ? 'badge-danger' : 'badge-neutral'}`}>{request.status}</span>{request.reviewed_by_name && <div className="mt-1 text-[11px] text-surface-400">Reviewed by {request.reviewed_by_name}{request.review_note ? ` · ${request.review_note}` : ''}</div>}</td>
            <td className="text-right"><div className="inline-flex flex-wrap justify-end gap-1.5">
              {request.status === 'PENDING' && <><button className="btn-primary btn-xs" disabled={reviewingRequestId !== null} onClick={() => void reviewRequest(request, 'APPROVED')}>{reviewingRequestId === request.id ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle size={12} />} Approve</button><button className="btn-secondary btn-xs text-rose-600" disabled={reviewingRequestId !== null} onClick={() => void reviewRequest(request, 'REJECTED')}>Reject</button></>}
              {request.status === 'APPROVED' && <button className="btn-primary btn-xs" onClick={() => openRequestedLabels(request)}><Printer size={12} /> Print approved labels</button>}
              {request.status === 'FULFILLED' && <span className="text-xs text-surface-500">Printed {formatIsoDateTime(request.fulfilled_at)}</span>}
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
            <td><span className="font-mono text-xs">{request.job_code || request.qr_job_id}</span></td><td>{request.requested_count}</td><td className="text-xs text-surface-500">{formatIsoDateTime(request.requested_at)}</td>
            <td><span className={`badge ${request.status === 'PENDING' ? 'badge-warning' : request.status === 'APPROVED' ? 'badge-success' : request.status === 'REJECTED' ? 'badge-danger' : 'badge-neutral'}`}>{request.status}</span>{request.review_note && <div className="mt-1 text-[11px] text-surface-400">{request.review_note}</div>}</td>
            <td className="text-right">{request.status === 'APPROVED' ? <button className="btn-primary btn-xs" onClick={() => openRequestedLabels(request)}><Printer size={12} /> Print approved labels</button> : request.status === 'FULFILLED' ? <span className="text-xs text-surface-500">Printed {formatIsoDateTime(request.fulfilled_at)}</span> : <span className="text-xs text-surface-400">Waiting for admin review</span>}</td>
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
              {canRequestReprint && !fulfillingRequestId && (
                <div className="flex gap-2 border-b border-slate-100 pb-3">
                  <button
                    type="button"
                    onClick={() => setReprintMode('LABELS')}
                    className={`rounded-lg px-3 py-1.5 text-xs font-bold ${reprintMode === 'LABELS' ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600'}`}
                  >
                    By label
                  </button>
                  <button
                    type="button"
                    onClick={() => setReprintMode('SKU')}
                    className={`rounded-lg px-3 py-1.5 text-xs font-bold ${reprintMode === 'SKU' ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600'}`}
                  >
                    By SKU
                  </button>
                </div>
              )}
              {canRequestReprint && reprintMode === 'SKU' && !fulfillingRequestId ? (
                <div className="space-y-3">
                  <div className="flex flex-wrap items-end gap-3">
                    <div className="space-y-1.5">
                      <label className="input-label">SKU</label>
                      <input
                        className="input w-56"
                        placeholder="e.g. KLJ-ASDFAS-001"
                        value={skuQuery}
                        onChange={(event) => setSkuQuery(event.target.value)}
                        onKeyDown={(event) => { if (event.key === 'Enter') void findSkuLabels(); }}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="input-label">Copies</label>
                      <input
                        className="input w-24"
                        type="number"
                        min="1"
                        value={skuCount}
                        onChange={(event) => setSkuCount(event.target.value)}
                      />
                    </div>
                    <button
                      type="button"
                      className="btn-secondary btn-sm"
                      disabled={skuLoading || !skuQuery.trim()}
                      onClick={() => void findSkuLabels()}
                    >
                      {skuLoading ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />} Find labels
                    </button>
                  </div>
                  {skuResults.length > 0 && (
                    <div className="max-h-64 divide-y divide-slate-100 overflow-y-auto rounded-xl border border-slate-200">
                      {skuResults.map((result) => (
                        <div key={String(result.jobId)} className="px-3 py-2.5">
                          <div className="text-xs font-bold text-slate-800">
                            {result.jobCode} · {result.labels.length} matching label{result.labels.length === 1 ? '' : 's'}
                          </div>
                          <div className="mt-0.5 truncate font-mono text-[11px] text-slate-400">
                            {result.labels.slice(0, 3).map((label) => label.qr_value).join(', ')}
                            {result.labels.length > 3 ? ` +${result.labels.length - 3} more` : ''}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  <p className="text-xs text-surface-500">
                    {selectedIds.length} label(s) selected across{" "}
                    {skuResults.filter((result) => result.labels.some((label) => selectedIds.includes(label.id))).length} print job(s). One request is raised per job.
                  </p>
                </div>
              ) : (
              <>
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
              </>
              )}
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
              {canRequestReprint && fulfillingRequestId === null && <button className="btn-primary" onClick={() => void (reprintMode === 'SKU' ? requestReprintBySku() : requestReprint())} disabled={reprinting || selectedIds.length === 0}>{reprinting ? <Loader2 size={15} className="animate-spin" /> : <Printer size={15} />} {reprintMode === 'SKU' ? 'Send SKU reprint requests' : 'Send reprint request'}</button>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
