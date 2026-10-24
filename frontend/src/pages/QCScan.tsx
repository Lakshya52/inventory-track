import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { BrowserMultiFormatReader } from '@zxing/library';
import { api } from '../services/api';
import {
  AlertTriangle, Camera, CheckCircle, ImagePlus, Loader2, Microscope,
  QrCode, RefreshCw, Trash2, X, XCircle,
} from 'lucide-react';

const reader = new BrowserMultiFormatReader();

function expectedQrCount(batch: any): number {
  if (Array.isArray(batch.unit_qr_codes)) return batch.unit_qr_codes.length;
  if (typeof batch.unit_qr_codes === 'string') {
    try {
      const codes = JSON.parse(batch.unit_qr_codes);
      if (Array.isArray(codes)) return codes.length;
    } catch {
      return Math.max(1, Math.floor(Number(batch.quantity) || 1));
    }
  }
  return Math.max(1, Math.floor(Number(batch.qr_count) || 1));
}

export default function QCScan() {
  const [scanning, setScanning] = useState(false);
  const [scanned, setScanned] = useState<any[]>([]);
  const [result, setResult] = useState<'PASS' | 'FAIL' | ''>('');
  const [remarks, setRemarks] = useState('');
  const [message, setMessage] = useState('');
  const [messageKind, setMessageKind] = useState<'success' | 'error' | 'info'>('info');
  const [images, setImages] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [manualValue, setManualValue] = useState('');
  const [lookupLoading, setLookupLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [queue, setQueue] = useState<any[]>([]);
  const [queueSearch, setQueueSearch] = useState('');
  const [queueLoading, setQueueLoading] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const scannedRef = useRef<any[]>([]);
  const previewsRef = useRef<string[]>([]);
  const inFlightRef = useRef<Set<string>>(new Set());
  const lastScanRef = useRef<{ text: string; at: number }>({ text: '', at: 0 });
  const deepLinkRef = useRef(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  const cleanup = useCallback(() => { try { reader.reset(); } catch {} }, []);

  useEffect(() => { previewsRef.current = previews; }, [previews]);

  const clearImages = useCallback(() => {
    previewsRef.current.forEach((url) => URL.revokeObjectURL(url));
    previewsRef.current = [];
    setImages([]);
    setPreviews([]);
  }, []);

  const resetGroup = useCallback(() => {
    scannedRef.current = [];
    setScanned([]);
    setResult('');
    setRemarks('');
    setManualValue('');
    setScanning(false);
    clearImages();
  }, [clearImages]);

  useEffect(() => () => {
    cleanup();
    previewsRef.current.forEach((url) => URL.revokeObjectURL(url));
  }, [cleanup]);

  const loadQueue = useCallback(async () => {
    setQueueLoading(true);
    try {
      const result = await api.qc.pending({ limit: 20 });
      setQueue(result.items || []);
    } catch (err: any) {
      setMessageKind('error');
      setMessage(err.message || 'Could not load the pending QC queue. You can still look up a batch by its number.');
    } finally {
      setQueueLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadQueue();
  }, [loadQueue]);

  const addFoundBatch = useCallback((found: any, silent = false): boolean => {
    const barcode = String(found?.scanned_qr || found?.barcode_value || '').trim();
    if (!barcode) return false;
    if (scannedRef.current.some((batch) => batch.barcode_value === barcode)) {
      if (!silent) {
        setMessageKind('info');
        setMessage('That QR code is already in this group.');
      }
      return false;
    }
    if (found.status !== 'CREATED') {
      if (!silent) {
        setMessageKind('error');
        setMessage(`${found.batch_number} is ${String(found.status).replace(/_/g, ' ')} and cannot be QC tested again.`);
      }
      return false;
    }
    if (Number(found.quantity) > 1 && Number(found.qr_count) > 0 && !found.scanned_qr) {
      if (!silent) {
        setMessageKind('info');
        setMessage('Scan every individual QR label on this batch. The queue shortcut cannot replace a unit scan.');
      }
      return false;
    }
    if (scannedRef.current.length >= 1000) {
      if (!silent) {
        setMessageKind('error');
        setMessage('A group can contain at most 1,000 QR codes.');
      }
      return false;
    }
    const next = [...scannedRef.current, { ...found, barcode_value: barcode }];
    scannedRef.current = next;
    setScanned(next);
    if (!silent) {
      setMessageKind('success');
      setMessage(`${found.batch_number} added. ${next.length} QR code${next.length === 1 ? '' : 's'} in this group.`);
    }
    return true;
  }, []);

  const addBatch = useCallback(async (value: string) => {
    const barcode = value.trim();
    if (!barcode) return;
    if (scannedRef.current.some((batch) => batch.barcode_value === barcode)) {
      setMessageKind('info');
      setMessage('That QR code is already in this group.');
      return;
    }
    if (inFlightRef.current.has(barcode)) return;
    inFlightRef.current.add(barcode);
    setLookupLoading(true);
    setMessage('');
    try {
      const found = await api.batches.getByBarcode(barcode);
      if (addFoundBatch(found)) setManualValue('');
    } catch (err: any) {
      setMessageKind('error');
      setMessage(err.message || `No batch found for QR: ${barcode}`);
    } finally {
      inFlightRef.current.delete(barcode);
      setLookupLoading(false);
    }
  }, [addFoundBatch]);

  useEffect(() => {
    const barcode = searchParams.get('barcode');
    if (!barcode) {
      deepLinkRef.current = false;
      return;
    }
    if (deepLinkRef.current) return;
    deepLinkRef.current = true;
    void addBatch(barcode);
    const next = new URLSearchParams(searchParams);
    next.delete('barcode');
    setSearchParams(next, { replace: true });
  }, [addBatch, searchParams, setSearchParams]);

  useEffect(() => {
    if (!scanning) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      setMessageKind('error');
      setMessage('Camera not supported here. Use HTTPS or localhost, or enter the QR value manually.');
      setScanning(false);
      return;
    }
    const video = videoRef.current;
    if (!video) return;
    let cancelled = false;
    (async () => {
      try {
        await reader.decodeFromVideoDevice(null, video, (decoded) => {
          if (cancelled || !decoded) return;
          const text = decoded.getText().trim();
          if (!text) return;

          // Keep the camera running and ignore the same code while it is still
          // in view. Manual entry remains available for any code.
          const now = Date.now();
          if (lastScanRef.current.text === text && now - lastScanRef.current.at < 2500) return;
          lastScanRef.current = { text, at: now };
          if (scannedRef.current.some((batch) => batch.barcode_value === text)) return;

          void addBatch(text);
        });
      } catch (err: any) {
        if (cancelled) return;
        setMessageKind('error');
        setMessage(err?.message?.includes('Permission') ? 'Camera permission denied' : 'Camera error');
        cleanup();
        setScanning(false);
      }
    })();
    return () => { cancelled = true; cleanup(); };
  }, [scanning, addBatch, cleanup]);

  const handleImages = (files: FileList | null) => {
    if (!files) return;
    const newImages = Array.from(files).slice(0, Math.max(0, 5 - images.length));
    setImages((prev) => [...prev, ...newImages].slice(0, 5));
    newImages.forEach((file) => {
      const url = URL.createObjectURL(file);
      setPreviews((prev) => [...prev, url]);
    });
  };

  const removeImage = (index: number) => {
    setImages((prev) => prev.filter((_, i) => i !== index));
    setPreviews((prev) => {
      URL.revokeObjectURL(prev[index]);
      return prev.filter((_, i) => i !== index);
    });
  };

  const removeBatch = (barcode: string) => {
    const next = scannedRef.current.filter((batch) => batch.barcode_value !== barcode);
    scannedRef.current = next;
    setScanned(next);
    setMessage('');
  };

  const filteredQueue = useMemo(() => {
    const needle = queueSearch.trim().toLowerCase();
    return queue.filter((batch) => {
      if (scanned.some((item) => item.barcode_value === batch.barcode_value)) return false;
      if (!needle) return true;
      return [batch.batch_number, batch.product_name, batch.product_sku, batch.barcode_value]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(needle));
    });
  }, [queue, queueSearch, scanned]);

  const handleSubmit = async () => {
    if (!result || scannedRef.current.length === 0) {
      setMessageKind('error');
      setMessage('Scan at least one QR code and select PASS or FAIL.');
      return;
    }
    const batchCounts = new Map<number, { batch: any; count: number }>();
    for (const item of scannedRef.current) {
      const current = batchCounts.get(Number(item.id));
      batchCounts.set(Number(item.id), { batch: item, count: (current?.count || 0) + 1 });
    }
    const incomplete = [...batchCounts.values()].find(({ batch, count }) => count !== expectedQrCount(batch));
    if (incomplete) {
      setMessageKind('error');
      setMessage(
        `Scan every QR for ${incomplete.batch.batch_number} (${incomplete.count}/${expectedQrCount(incomplete.batch)} scanned) before submitting QC.`
      );
      return;
    }
    setSubmitting(true);
    setMessage('');
    try {
      const response = await api.qc.submitBulk({
        barcodes: scannedRef.current.map((batch) => batch.barcode_value),
        result,
        remarks: remarks || undefined,
        images: images.length > 0 ? images : undefined,
      });
      const count = Number(response?.count || scannedRef.current.length);
      setMessageKind('success');
      setMessage(`QC ${result} applied to all ${count} QR code${count === 1 ? '' : 's'} in this group.`);
      resetGroup();
      void loadQueue();
    } catch (err: any) {
      setMessageKind('error');
      setMessage(err.message || 'Group QC submission failed. No codes were changed.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="page-container max-w-4xl mx-auto">
      <div className="page-header">
        <div>
          <h1 className="page-title">QC Group Testing</h1>
          <p className="page-subtitle">Scan multiple QR codes, then apply one result and remark set to the whole group</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link to="/qc/qr-codes" className="btn-secondary btn-sm">
            <QrCode size={14} /> QR Code Labels
          </Link>
          <Link to="/qc-dashboard" className="btn-secondary btn-sm">
            <Microscope size={14} /> QC Dashboard
          </Link>
        </div>
      </div>

      {message && (
        <div className={`mb-4 p-3 rounded-xl text-sm flex items-center gap-2 ${
          messageKind === 'error'
            ? 'bg-rose-50 text-rose-700 border border-rose-200'
            : messageKind === 'success'
              ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
              : 'bg-sky-50 text-sky-700 border border-sky-200'
        }`}>
          {messageKind === 'error' ? <AlertTriangle size={16} /> : messageKind === 'success' ? <CheckCircle size={16} /> : <Microscope size={16} />}
          {message}
        </div>
      )}

      <div className="card p-6 mb-4">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
          <h2 className="section-title flex items-center gap-2">
            <Camera size={16} className="text-brand-500" /> Add QR codes
          </h2>
          <span className="text-xs text-surface-400">Only batches still waiting for QC can be added</span>
        </div>

        <div className="flex flex-col sm:flex-row gap-2">
          <input
            className="input flex-1"
            placeholder="Scan or type a QR / barcode value or batch number"
            value={manualValue}
            onChange={(event) => setManualValue(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter') void addBatch(manualValue); }}
          />
          <button className="btn-secondary" onClick={() => void addBatch(manualValue)} disabled={lookupLoading || !manualValue.trim()}>
            {lookupLoading ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle size={16} />}
            {lookupLoading ? 'Checking...' : 'Add / find batch'}
          </button>
          <button
            className="btn-primary"
            onClick={() => { setMessage(''); setScanning(true); }}
            disabled={scanning}
          >
            <Camera size={16} /> {scanning ? 'Camera active' : 'Scan with camera'}
          </button>
        </div>

        {scanning && (
          <div className="mt-4 space-y-3">
            <div className="rounded-xl overflow-hidden bg-black">
              <video ref={videoRef} style={{ width: '100%', height: '300px', objectFit: 'cover' }} playsInline />
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm text-brand-600 flex items-center gap-2">
                <Camera size={14} /> Keep scanning — {scanned.length} in group. The camera stays on.
              </span>
              <button className="btn-secondary btn-sm" onClick={() => { cleanup(); setScanning(false); }}><X size={14} /> Stop</button>
            </div>
          </div>
        )}

        <p className="text-xs text-surface-400 mt-3">
          QC is recorded against the lot tracking code. Bag-specific QR labels are created only after QC passes.
        </p>

        <div className="mt-4 pt-4 border-t border-surface-100">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
            <div>
              <div className="input-label mb-0">Pending batches</div>
              <p className="text-[11px] text-surface-400 mt-1">For pre-finished QC batches, use Add lot; previously labeled batches still require every unit QR.</p>
            </div>
            <div className="flex items-center gap-2">
              <button className="btn-secondary btn-xs" onClick={() => void loadQueue()} disabled={queueLoading}>
                <RefreshCw size={12} className={queueLoading ? 'animate-spin' : ''} /> Refresh
              </button>
            </div>
          </div>

          <input
            className="input text-xs mb-2"
            placeholder="Filter pending batches by batch, product, or SKU"
            value={queueSearch}
            onChange={(event) => setQueueSearch(event.target.value)}
          />

          <div className="max-h-52 overflow-y-auto rounded-xl border border-surface-200 divide-y divide-surface-100 bg-white">
            {filteredQueue.slice(0, 12).map((batch) => (
              <div key={batch.id} className="flex items-center justify-between gap-3 p-3 hover:bg-surface-50 transition-colors">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-semibold text-surface-900 truncate">{batch.product_name}</span>
                    <span className="font-mono text-xs bg-surface-100 px-1.5 py-0.5 rounded text-surface-700">{batch.batch_number}</span>
                    <span className="badge badge-warning text-[10px]">Waiting QC</span>
                  </div>
                  <div className="text-xs text-surface-400 mt-0.5">
                    SKU: {batch.product_sku} · {batch.quantity} {batch.uom || 'units'}
                  </div>
                </div>
                {Number(batch.qr_count) === 0
                  ? <button className="btn-primary btn-xs shrink-0" onClick={() => void addBatch(batch.barcode_value)}>Add QC lot</button>
                  : <span className="text-xs font-medium text-brand-600 bg-brand-50 px-2 py-1 rounded-lg shrink-0">Scan {expectedQrCount(batch)} labels</span>}
              </div>
            ))}
            {filteredQueue.length === 0 && (
              <div className="p-4 text-center text-xs text-surface-400">
                {queueLoading ? 'Loading pending batches...' : queueSearch ? 'No pending batches match that filter.' : 'No pending batches on the QC queue.'}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="card mb-4">
        <div className="card-header flex flex-wrap items-center justify-between gap-2">
          <h3 className="section-title flex items-center gap-2">
            <Microscope size={16} className="text-sky-500" /> Scanned group
          </h3>
          <div className="flex items-center gap-2">
            <span className="badge badge-info">{scanned.length} QR code{scanned.length === 1 ? '' : 's'}</span>
            {scanned.length > 0 && (
              <button className="btn-ghost btn-xs" onClick={resetGroup}><Trash2 size={13} /> Clear group</button>
            )}
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Batch</th><th>Product</th><th>SKU</th><th>Qty</th><th>QR value</th><th></th></tr>
            </thead>
            <tbody>
              {scanned.map((batch) => (
                <tr key={batch.barcode_value}>
                  <td><span className="font-mono text-xs bg-surface-100 px-2 py-1 rounded-lg">{batch.batch_number}</span></td>
                  <td>
                    <div className="font-medium text-surface-800">{batch.product_name}</div>
                    <div className="text-xs text-surface-400">{batch.product_grade || batch.cas_number || '-'}</div>
                  </td>
                  <td className="text-sm text-surface-600">{batch.product_sku}</td>
                  <td className="text-sm text-surface-600">{batch.quantity} {batch.uom || ''}</td>
                  <td className="text-[10px] text-surface-400 font-mono break-all max-w-[220px]">{batch.barcode_value}</td>
                  <td>
                    <button className="btn-ghost btn-xs text-rose-500" onClick={() => removeBatch(batch.barcode_value)}>
                      <X size={13} /> Remove
                    </button>
                  </td>
                </tr>
              ))}
              {scanned.length === 0 && (
                <tr>
                  <td colSpan={6}>
                    <div className="empty-state">
                      <div className="empty-icon"><Microscope size={24} className="text-surface-400" /></div>
                      <div className="empty-title">No QR codes in this group yet</div>
                      <div className="empty-desc">Scan or enter QR codes above. Every code you add will receive the same QC result.</div>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card p-6">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
          <div>
            <h3 className="section-title flex items-center gap-2">
              <CheckCircle size={16} className="text-emerald-500" /> Apply one result to the whole group
            </h3>
            <p className="text-xs text-surface-400 mt-1">The result, remarks, and photos below apply to every scanned QR code.</p>
          </div>
          <span className="badge badge-neutral">{scanned.length} selected</span>
        </div>

        <div className="flex gap-3 mb-4">
          <label className={`flex-1 flex items-center justify-center gap-2 p-4 rounded-xl border-2 cursor-pointer transition-all ${result === 'PASS' ? 'border-emerald-500 bg-emerald-50' : 'border-surface-200 hover:border-emerald-300'}`}>
            <input type="radio" name="qc-result" value="PASS" checked={result === 'PASS'} onChange={() => setResult('PASS')} className="sr-only" />
            <CheckCircle size={20} className={result === 'PASS' ? 'text-emerald-600' : 'text-surface-300'} />
            <span className={`font-semibold ${result === 'PASS' ? 'text-emerald-700' : 'text-surface-500'}`}>PASS ALL</span>
          </label>
          <label className={`flex-1 flex items-center justify-center gap-2 p-4 rounded-xl border-2 cursor-pointer transition-all ${result === 'FAIL' ? 'border-rose-500 bg-rose-50' : 'border-surface-200 hover:border-rose-300'}`}>
            <input type="radio" name="qc-result" value="FAIL" checked={result === 'FAIL'} onChange={() => setResult('FAIL')} className="sr-only" />
            <XCircle size={20} className={result === 'FAIL' ? 'text-rose-600' : 'text-surface-300'} />
            <span className={`font-semibold ${result === 'FAIL' ? 'text-rose-700' : 'text-surface-500'}`}>FAIL ALL</span>
          </label>
        </div>

        <textarea
          className="input mb-4"
          rows={3}
          placeholder="Shared remarks for every QR code in this group (optional)"
          value={remarks}
          onChange={(event) => setRemarks(event.target.value)}
        />

        <div className="mb-4">
          <label className="input-label mb-2">Shared photos (optional, max 5)</label>
          <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" capture="environment" onChange={(event) => { handleImages(event.target.files); event.target.value = ''; }} />
          <div className="flex flex-wrap gap-2">
            {previews.map((url, index) => (
              <div key={url} className="relative w-16 h-16 rounded-xl overflow-hidden border border-surface-200 group">
                <img src={url} alt="preview" className="w-full h-full object-cover" />
                <button onClick={() => removeImage(index)} className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                  <Trash2 size={14} className="text-white" />
                </button>
              </div>
            ))}
            {previews.length < 5 && (
              <button onClick={() => fileRef.current?.click()} className="w-16 h-16 rounded-xl border-2 border-dashed border-surface-300 flex items-center justify-center text-surface-400 hover:text-brand-600 hover:border-brand-400 transition-colors">
                <ImagePlus size={20} />
              </button>
            )}
          </div>
        </div>

        <button className="btn-primary w-full" onClick={handleSubmit} disabled={submitting || scanned.length === 0 || !result}>
          {submitting ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle size={16} />}
          {submitting ? 'Applying to all QR codes...' : `Submit QC ${result || 'result'} for ${scanned.length} QR code${scanned.length === 1 ? '' : 's'}`}
        </button>
        <p className="text-xs text-surface-400 text-center mt-2">
          This is an all-or-nothing group submission. If any QR code changed since scanning, the whole group is rejected and nothing is saved.
        </p>
      </div>
    </div>
  );
}
