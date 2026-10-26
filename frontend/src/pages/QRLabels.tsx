import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle, CheckCircle, Download, History, Loader2, Package,
  Printer, RefreshCw, Search, X,
} from 'lucide-react';
import { api } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { downloadQrPdf, printQrLabels, QrJob, QrLabel } from '../utils/qrPdf';
import type { EntityId } from '../types';

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
  const canReprint = user?.role === 'QC';
  const [jobs, setJobs] = useState<QrJobRow[]>([]);
  const [search, setSearch] = useState('');
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

  const load = useCallback(async (showSpinner = false) => {
    if (showSpinner) setRefreshing(true);
    setError('');
    try {
      const jobRows = await api.qc.qrJobs.list(search || undefined);
      setJobs(jobRows.items || []);
    } catch (err: any) {
      setError(err.message || 'Could not load QR labels');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [search]);

  useEffect(() => {
    load();
    // Initial load only; search has its own debounce below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      api.qc.qrJobs.list(search || undefined)
        .then((result) => setJobs(result.items || []))
        .catch((err) => setError(err.message));
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const openReprint = async (job: QrJobRow) => {
    setError('');
    setSuccess('');
    setReprintJob(job);
    setReprintLabels([]);
    setSelectedIds([]);
    setReprintQty('1');
    setReprintLoading(true);
    try {
      const detail = await api.qc.qrJobs.get(job.id);
      setReprintLabels(detail.labels || []);
      setSelectedIds((detail.labels || []).slice(0, 1).map((label: QrLabel) => label.id));
    } catch (err: any) {
      setError(err.message || 'Could not load QR labels');
      setReprintJob(null);
    } finally {
      setReprintLoading(false);
    }
  };

  const applyQuantity = (value: string) => {
    setReprintQty(value);
    const count = Number(value);
    if (!Number.isInteger(count) || count < 0) return;
    setSelectedIds(reprintLabels.slice(0, Math.min(count, reprintLabels.length)).map((label) => label.id));
  };

  const toggleLabel = (id: EntityId) => {
    setSelectedIds((current) =>
      current.includes(id) ? current.filter((value) => value !== id) : [...current, id]
    );
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
      await load();
    } catch (err: any) {
      setError(err.message || 'Could not reprint QR labels');
    } finally {
      setReprinting(false);
    }
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

  if (loading) {
    return <div className="page-container flex items-center justify-center h-64"><span className="text-sm text-surface-400">Loading QR labels...</span></div>;
  }

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1 className="page-title">QR Code Labels</h1>
          <p className="page-subtitle">
            {canReprint
              ? 'Review, download, and reprint product labels generated from QC-managed batches.'
              : 'View and download QR labels generated for batches managed by QC.'}
            {' '}New labels are created when QC completes finished-goods details for a passed batch.
          </p>
        </div>
        <button className="btn-secondary btn-sm" onClick={() => load(true)} disabled={refreshing}>
          <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      {error && (
        <div className="mb-4 p-3 rounded-xl text-sm flex items-center gap-2 bg-rose-50 text-rose-700 border border-rose-200">
          <AlertTriangle size={16} /> {error}
        </div>
      )}
      {success && (
        <div className="mb-4 p-3 rounded-xl text-sm flex items-center gap-2 bg-emerald-50 text-emerald-700 border border-emerald-200">
          <CheckCircle size={16} /> {success}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 mb-6">
        <div className="card">
          <div className="card-header flex flex-wrap items-center justify-between gap-3">
            <h3 className="section-title flex items-center gap-2"><History size={16} className="text-surface-400" /> QR Print Jobs</h3>
            <div className="relative w-64 max-w-full">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-surface-400" />
              <input className="input pl-9 py-1.5 text-xs" placeholder="Search job, product, SKU" value={search} onChange={(event) => setSearch(event.target.value)} />
            </div>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Job</th><th>Product</th><th>Labels</th><th>Prints</th><th>Created</th><th>Actions</th></tr>
              </thead>
              <tbody>
                {jobs.map((job) => (
                  <tr key={job.id}>
                    <td>
                      <div className="font-mono text-xs bg-surface-100 px-2 py-1 rounded-lg inline-block">{job.job_code}</div>
                      <div className="text-[10px] text-surface-400 mt-1">by {job.created_by_name || 'QC'}</div>
                    </td>
                    <td>
                      <div className="font-medium text-surface-800">{job.product_name}</div>
                      <div className="text-xs text-surface-400">{job.product_sku}</div>
                    </td>
                    <td><span className="badge badge-neutral">{job.label_count ?? job.quantity}</span></td>
                    <td className="text-sm text-surface-600">{job.total_prints ?? job.quantity}</td>
                    <td className="text-xs text-surface-400">{formatDate(job.created_at)}</td>
                    <td>
                      <div className="flex flex-wrap gap-1.5">
                        <button className="btn-secondary btn-xs" onClick={() => downloadJob(job)}>
                          <Download size={13} /> PDF
                        </button>
                        {canReprint && (
                          <button className="btn-primary btn-xs" onClick={() => openReprint(job)}>
                            <Printer size={13} /> Reprint
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {jobs.length === 0 && (
                  <tr><td colSpan={6}><div className="empty-state"><div className="empty-icon"><Package size={24} className="text-surface-400" /></div><div className="empty-title">No QR labels generated yet</div><div className="empty-desc">In Batches, finish goods for a QC-passed batch. The system then creates one product label per unit.</div></div></td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {canReprint && reprintJob && (
        <div className="modal-overlay" onClick={() => !reprinting && setReprintJob(null)}>
          <div className="modal-content max-w-3xl" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h2 className="text-base font-semibold text-surface-900">Reprint QR Labels</h2>
                <p className="text-xs text-surface-400 mt-0.5">{reprintJob.job_code} · {reprintJob.product_name}</p>
              </div>
              <button className="btn-ghost btn-sm" onClick={() => setReprintJob(null)} disabled={reprinting}><X size={16} /></button>
            </div>
            <div className="modal-body space-y-4">
              <div className="flex flex-wrap items-end gap-3 rounded-xl bg-surface-50 border border-surface-100 p-3">
                <div className="space-y-1.5">
                  <label className="input-label">Reprint quantity</label>
                  <input
                    className="input w-32"
                    type="number"
                    min="1"
                    max={reprintLabels.length}
                    value={reprintQty}
                    onChange={(event) => applyQuantity(event.target.value)}
                  />
                </div>
                <button className="btn-secondary btn-sm" onClick={() => applyQuantity(reprintQty)}>Select first N</button>
                <button className="btn-ghost btn-sm" onClick={() => setSelectedIds(reprintLabels.map((label) => label.id))}>Select all</button>
                <button className="btn-ghost btn-sm" onClick={() => setSelectedIds([])}>Clear</button>
                <span className="text-xs text-surface-500 ml-auto">{selectedIds.length} of {reprintLabels.length} selected</span>
              </div>

              <div className="max-h-80 overflow-y-auto border border-surface-200 rounded-xl divide-y divide-surface-100">
                {reprintLoading && <div className="p-6 text-center text-sm text-surface-400">Loading labels...</div>}
                {!reprintLoading && reprintLabels.map((label) => (
                  <label key={label.id} className="flex items-center gap-3 px-3 py-2.5 cursor-pointer hover:bg-surface-50">
                    <input
                      type="checkbox"
                      checked={selectedIds.includes(label.id)}
                      onChange={() => toggleLabel(label.id)}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium text-surface-800">Label {label.serial_no} · {label.batch_number}</div>
                      <div className="text-[10px] text-surface-400 font-mono break-all">{label.qr_value}</div>
                    </div>
                    <span className="badge badge-neutral">printed {label.print_count ?? 1}x</span>
                  </label>
                ))}
              </div>

              <p className="text-xs text-surface-400">
                Only the labels you select are included in the reprint PDF. This keeps the printed count exact.
              </p>
            </div>
            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => setReprintJob(null)} disabled={reprinting}>Cancel</button>
              <button className="btn-secondary" onClick={() => runReprint('print')} disabled={reprinting || selectedIds.length === 0}>
                <Printer size={15} /> Print selected
              </button>
              <button className="btn-primary" onClick={() => runReprint('pdf')} disabled={reprinting || selectedIds.length === 0}>
                {reprinting ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}
                {reprinting ? 'Preparing...' : 'Download reprint PDF'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
