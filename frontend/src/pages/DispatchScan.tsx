import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { BrowserMultiFormatReader } from '@zxing/library';
import { api } from '../services/api';
import {
  AlertTriangle, Camera, CheckCircle, ClipboardList, Clock, ImagePlus,
  ListPlus, Loader2, PackageCheck, RefreshCw, Trash2, Truck, X,
} from 'lucide-react';

const reader = new BrowserMultiFormatReader();

function statusBadge(status: string): string {
  if (status === 'QC_PASSED') return 'badge-success';
  if (status === 'DISPATCH_ORDER_RAISED') return 'badge-warning';
  if (status === 'DISPATCH_APPROVED') return 'badge-info';
  if (status === 'DISPATCHED') return 'badge-neutral';
  if (status === 'DISPATCH_REJECTED' || status === 'QC_FAILED') return 'badge-danger';
  return 'badge-neutral';
}

export default function DispatchScan() {
  const [scanning, setScanning] = useState(false);
  const [scanned, setScanned] = useState<any[]>([]);
  const [remarks, setRemarks] = useState('');
  const [message, setMessage] = useState('');
  const [messageKind, setMessageKind] = useState<'success' | 'error' | 'info'>('info');
  const [todayDispatches, setTodayDispatches] = useState<any[]>([]);
  const [images, setImages] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [manualValue, setManualValue] = useState('');
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
    setRemarks('');
    setManualValue('');
    setScanning(false);
    clearImages();
  }, [clearImages]);

  const loadToday = useCallback(async () => {
    try {
      setTodayDispatches(await api.dispatch.today());
    } catch {
      // Keep the last known list when the network is unavailable.
    }
  }, []);

  useEffect(() => {
    void loadToday();
    return () => {
      cleanup();
      previewsRef.current.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [cleanup, loadToday]);

  const loadQueue = useCallback(async () => {
    setQueueLoading(true);
    try {
      const orders = await api.dispatch.approvedOrders();
      setQueue(
        orders.map((order: any) => ({
          ...order,
          id: Number(order.batch_id || order.id),
          status: 'DISPATCH_APPROVED',
        }))
      );
    } catch {
      // Manual scanning still works if the approved-order list cannot load.
    } finally {
      setQueueLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadQueue();
  }, [loadQueue]);

  const addFoundBatch = useCallback((found: any, silent = false): boolean => {
    const barcode = String(found?.barcode_value || '').trim();
    if (!barcode) return false;
    if (scannedRef.current.some((batch) => batch.barcode_value === barcode)) {
      if (!silent) {
        setMessageKind('info');
        setMessage('That QR code is already in this dispatch group.');
      }
      return false;
    }
    if (found.status !== 'DISPATCH_APPROVED') {
      if (!silent) {
        if (found.status === 'QC_PASSED') {
          setMessageKind('info');
          setMessage('QC passed, but no approved dispatch order exists yet. Raise an order from the dashboard first.');
        } else if (found.status === 'DISPATCH_ORDER_RAISED') {
          setMessageKind('info');
          setMessage('A dispatch order is still awaiting admin approval.');
        } else if (found.status === 'DISPATCHED') {
          setMessageKind('error');
          setMessage('That QR code has already been dispatched.');
        } else {
          setMessageKind('error');
          setMessage(`${found.batch_number} is ${String(found.status).replace(/_/g, ' ')} and cannot be dispatched.`);
        }
      }
      return false;
    }
    if (scannedRef.current.length >= 500) {
      if (!silent) {
        setMessageKind('error');
        setMessage('A dispatch group can contain at most 500 QR codes.');
      }
      return false;
    }
    const next = [...scannedRef.current, found];
    scannedRef.current = next;
    setScanned(next);
    if (!silent) {
      setMessageKind('success');
      setMessage(`${found.batch_number} added. ${next.length} approved QR code${next.length === 1 ? '' : 's'} in this group.`);
    }
    return true;
  }, []);

  const addBatch = useCallback(async (value: string) => {
    const barcode = value.trim();
    if (!barcode) return;
    if (scannedRef.current.some((batch) => batch.barcode_value === barcode)) {
      setMessageKind('info');
      setMessage('That QR code is already in this dispatch group.');
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
      setMessage('Camera not supported here. Use HTTPS or localhost, or enter the code manually.');
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
          const text = result.getText().trim();
          if (!text) return;

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

  const removeBatch = (id: number) => {
    const next = scannedRef.current.filter((batch) => batch.id !== id);
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

  const addVisibleFromQueue = () => {
    const visible = filteredQueue.slice(0, 12);
    let added = 0;
    for (const batch of visible) {
      if (addFoundBatch(batch, true)) added += 1;
    }
    if (added > 0) {
      setMessageKind('success');
      setMessage(`${added} approved batch${added === 1 ? '' : 'es'} added in one tap. ${scannedRef.current.length} QR code${scannedRef.current.length === 1 ? '' : 's'} in this group.`);
    } else if (filteredQueue.length === 0) {
      setMessageKind('info');
      setMessage('There are no more approved batches to add.');
    } else {
      setMessageKind('info');
      setMessage('Those orders are no longer approved. Refresh the queue and try again.');
    }
  };

  const confirmDispatch = async () => {
    if (scannedRef.current.length === 0) {
      setMessageKind('error');
      setMessage('Scan at least one approved QR code before dispatching.');
      return;
    }
    setSubmitting(true);
    setMessage('');
    try {
      const response = await api.dispatch.submitBulk({
        barcodes: scannedRef.current.map((batch) => batch.barcode_value),
        remarks: remarks || undefined,
        images: images.length > 0 ? images : undefined,
      });
      const count = Number(response?.count || scannedRef.current.length);
      setMessageKind('success');
      setMessage(`${count} QR code${count === 1 ? '' : 's'} dispatched successfully in one group.`);
      resetGroup();
      await loadToday();
      void loadQueue();
    } catch (err: any) {
      setMessageKind('error');
      setMessage(err.message || 'Group dispatch failed. No codes were changed.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="page-container max-w-4xl mx-auto">
      <div className="page-header">
        <div>
          <h1 className="page-title">Dispatch Group Scan</h1>
          <p className="page-subtitle">Scan multiple approved QR codes and confirm them in one atomic dispatch</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link to="/dispatch-orders" className="btn-secondary btn-sm"><ClipboardList size={14} /> Dispatch Orders</Link>
          <Link to="/dispatch-dashboard" className="btn-secondary btn-sm"><Truck size={14} /> Dispatch Dashboard</Link>
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
          {messageKind === 'error' ? <AlertTriangle size={16} /> : messageKind === 'success' ? <CheckCircle size={16} /> : <Clock size={16} />}
          {message}
        </div>
      )}

      <div className="card p-6 mb-4">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
          <h2 className="section-title flex items-center gap-2">
            <Camera size={16} className="text-brand-500" /> Add approved QR codes
          </h2>
          <span className="text-xs text-surface-400">Only DISPATCH APPROVED batches can be added</span>
        </div>

        <div className="flex flex-col sm:flex-row gap-2">
          <input
            className="input flex-1"
            placeholder="Scan or type a QR / barcode value"
            value={manualValue}
            onChange={(event) => setManualValue(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter') void addBatch(manualValue); }}
          />
          <button className="btn-secondary" onClick={() => void addBatch(manualValue)} disabled={lookupLoading || !manualValue.trim()}>
            {lookupLoading ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle size={16} />}
            {lookupLoading ? 'Checking...' : 'Add code'}
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
                <Camera size={14} /> Keep scanning — {scanned.length} approved in group. The camera stays on.
              </span>
              <button className="btn-secondary btn-sm" onClick={() => { cleanup(); setScanning(false); }}><X size={14} /> Stop</button>
            </div>
          </div>
        )}

        <p className="text-xs text-surface-400 mt-3">
          Add up to 500 approved QR codes. The group is validated and dispatched atomically; one invalid code rejects the whole group.
        </p>

        <div className="mt-4 pt-4 border-t border-surface-100">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
            <div>
              <div className="input-label mb-0">Quick add approved orders</div>
              <p className="text-[11px] text-surface-400 mt-1">Use the approved queue when the labels are not in hand.</p>
            </div>
            <div className="flex items-center gap-2">
              <button className="btn-secondary btn-xs" onClick={() => void loadQueue()} disabled={queueLoading}>
                <RefreshCw size={12} className={queueLoading ? 'animate-spin' : ''} /> Refresh
              </button>
              <button
                className="btn-primary btn-xs"
                onClick={addVisibleFromQueue}
                disabled={filteredQueue.length === 0}
              >
                <ListPlus size={12} /> {filteredQueue.length > 12 ? 'Add first 12' : `Add all shown (${filteredQueue.length})`}
              </button>
            </div>
          </div>

          <input
            className="input text-xs mb-2"
            placeholder="Filter approved batches by batch, product, or SKU"
            value={queueSearch}
            onChange={(event) => setQueueSearch(event.target.value)}
          />

          <div className="max-h-52 overflow-y-auto rounded-xl border border-surface-100 divide-y divide-surface-100">
            {filteredQueue.slice(0, 12).map((batch) => (
              <div key={batch.id} className="flex items-center gap-3 p-2.5">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-surface-800 truncate">{batch.product_name}</div>
                  <div className="text-[10px] text-surface-400 truncate">
                    {batch.batch_number} · {batch.product_sku} · {batch.quantity} {batch.uom || ''}
                  </div>
                </div>
                <button className="btn-primary btn-xs" onClick={() => addFoundBatch(batch)}>
                  Add
                </button>
              </div>
            ))}
            {filteredQueue.length === 0 && (
              <div className="p-4 text-center text-xs text-surface-400">
                {queueLoading ? 'Loading approved orders...' : queueSearch ? 'No approved orders match that filter.' : 'No approved dispatch orders are waiting.'}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="card mb-4">
        <div className="card-header flex flex-wrap items-center justify-between gap-2">
          <h3 className="section-title flex items-center gap-2">
            <PackageCheck size={16} className="text-emerald-500" /> Scanned dispatch group
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
              <tr><th>Batch</th><th>Product</th><th>SKU</th><th>Qty</th><th>Status</th><th></th></tr>
            </thead>
            <tbody>
              {scanned.map((batch) => (
                <tr key={batch.id}>
                  <td><span className="font-mono text-xs bg-surface-100 px-2 py-1 rounded-lg">{batch.batch_number}</span></td>
                  <td>
                    <div className="font-medium text-surface-800">{batch.product_name}</div>
                    <div className="text-xs text-surface-400">{batch.storage_location || batch.cas_number || '-'}</div>
                  </td>
                  <td className="text-sm text-surface-600">{batch.product_sku}</td>
                  <td className="text-sm text-surface-600">{batch.quantity} {batch.uom || ''}</td>
                  <td><span className={`badge ${statusBadge(batch.status)}`}>{String(batch.status).replace(/_/g, ' ')}</span></td>
                  <td>
                    <button className="btn-ghost btn-xs text-rose-500" onClick={() => removeBatch(batch.id)}>
                      <X size={13} /> Remove
                    </button>
                  </td>
                </tr>
              ))}
              {scanned.length === 0 && (
                <tr>
                  <td colSpan={6}>
                    <div className="empty-state">
                      <div className="empty-icon"><Truck size={24} className="text-surface-400" /></div>
                      <div className="empty-title">No approved QR codes in this group yet</div>
                      <div className="empty-desc">Scan or enter approved QR codes above. All of them will be dispatched together.</div>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card p-6 mb-6">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
          <div>
            <h3 className="section-title flex items-center gap-2">
              <Truck size={16} className="text-indigo-500" /> Confirm group dispatch
            </h3>
            <p className="text-xs text-surface-400 mt-1">The remarks and photos below apply to every QR code in this group.</p>
          </div>
          <span className="badge badge-neutral">{scanned.length} selected</span>
        </div>

        <textarea
          className="input mb-4"
          rows={3}
          placeholder="Shared dispatch remarks / destination for the whole group (optional)"
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

        <button className="btn-primary w-full" onClick={confirmDispatch} disabled={submitting || scanned.length === 0}>
          {submitting ? <Loader2 size={16} className="animate-spin" /> : <Truck size={16} />}
          {submitting ? 'Dispatching the group...' : `Confirm dispatch for ${scanned.length} QR code${scanned.length === 1 ? '' : 's'}`}
        </button>
        <p className="text-xs text-surface-400 text-center mt-2">
          This is an all-or-nothing group dispatch. If any QR code is no longer approved, the whole group is rejected and nothing is saved.
        </p>
      </div>

      <div className="card">
        <div className="card-header"><h3 className="section-title flex items-center gap-2"><Truck size={16} className="text-surface-400" /> Dispatched Today</h3></div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Product</th><th>Batch</th><th>Time</th></tr></thead>
            <tbody>
              {todayDispatches.map((dispatch: any) => (
                <tr key={dispatch.id}>
                  <td><span className="font-medium text-surface-800">{dispatch.product_name}</span></td>
                  <td><span className="font-mono text-xs bg-surface-100 px-2 py-1 rounded-lg">{dispatch.batch_number}</span></td>
                  <td className="text-sm text-surface-500">{new Date(dispatch.created_at).toLocaleTimeString()}</td>
                </tr>
              ))}
              {todayDispatches.length === 0 && <tr><td colSpan={3}><div className="empty-state"><div className="empty-title">No dispatches today</div></div></td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
