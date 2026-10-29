import { useEffect, useState, FormEvent, useRef, useMemo } from 'react';
import JSZip from 'jszip';
import { api } from '../services/api';
import { Product, Batch } from '../types';
import { Layers, Plus, Search, X, PackageCheck, Download } from 'lucide-react';
import { createQrPdfBlob, downloadQrPdf, type QrJob, type QrLabel } from '../utils/qrPdf';
import { useAuth } from '../contexts/AuthContext';

const statusColors: Record<string, string> = {
  QC_PASSED: 'badge-success',
  DISPATCH_ORDER_RAISED: 'badge-purple',
  DISPATCH_APPROVED: 'badge-info',
  LOADING: 'badge-warning',
  DISPATCHED: 'badge-success',
  NOT_DISPATCHED: 'badge-danger',
};

const statusLabels: Record<string, string> = {
  QC_PASSED: 'QC Passed',
  DISPATCH_ORDER_RAISED: 'Order Raised',
  DISPATCH_APPROVED: 'Approved',
  LOADING: 'Loading',
  DISPATCHED: 'Dispatched',
  NOT_DISPATCHED: 'Not Dispatched',
};

function safeFileName(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'batches';
}

async function downloadCreatedQrPdfs(
  batches: { batch_number: string; qr_job: QrJob; labels: QrLabel[] }[]
): Promise<void> {
  if (batches.length === 0) throw new Error('The server returned no QR labels for the created batches.');
  for (const batch of batches) {
    if (batch.labels.length !== Number(batch.qr_job.quantity)) {
      throw new Error(`Batch ${batch.batch_number} has ${batch.labels.length} QR labels; expected ${batch.qr_job.quantity}.`);
    }
  }
  if (batches.length === 1) {
    await downloadQrPdf(batches[0].labels, batches[0].qr_job);
    return;
  }

  const zip = new JSZip();
  for (const batch of batches) {
    zip.file(`${safeFileName(batch.batch_number)}.pdf`, await createQrPdfBlob(batch.labels, batch.qr_job));
  }
  const archive = await zip.generateAsync({ type: 'blob' });
  const url = URL.createObjectURL(archive);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `QR-${safeFileName(batches[0].qr_job.product_sku || batches[0].qr_job.product_name)}-batches.zip`;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function hasUsableMasterId(row: any): boolean {
  const id = row?.id;
  return (typeof id === 'string' && id.trim().length > 0) ||
    (typeof id === 'number' && Number.isSafeInteger(id) && id > 0);
}

function isActiveMaster(row: any): boolean {
  return row?.is_active == null || row.is_active === true || Number(row.is_active) === 1;
}

export default function Batches() {
  const { user } = useAuth();
  const canManageBatches = user?.role === 'QC';
  const canDownloadQr = user?.role === 'ADMIN' || canManageBatches;
  const [products, setProducts] = useState<Product[]>([]);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [locations, setLocations] = useState<any[]>([]);
  const [vendors, setVendors] = useState<any[]>([]);
  const [grades, setGrades] = useState<any[]>([]);
  const [bagQuantities, setBagQuantities] = useState<any[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [finishBatch, setFinishBatch] = useState<Batch | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [creatingBatch, setCreatingBatch] = useState(false);
  const [savingFinishGoods, setSavingFinishGoods] = useState(false);
  const [batchCount, setBatchCount] = useState('1');
  const [downloadingGroupId, setDownloadingGroupId] = useState<string | null>(null);
  const [printQR, setPrintQR] = useState<{ value: string; product: string; batch: string } | null>(null);

  const [productId, setProductId] = useState('');
  const [batchNumber, setBatchNumber] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [uom, setUom] = useState('pcs');
  const [unitPrice, setUnitPrice] = useState('');
  const [manufacturingDate, setManufacturingDate] = useState('');
  const [expiryDate, setExpiryDate] = useState('');
  const [shelfLocationId, setShelfLocationId] = useState('');
  const [notes, setNotes] = useState('');
  const [finishGoodsSelection, setFinishGoodsSelection] = useState({
    vendorId: '',
    gradeId: '',
    bagQuantityId: '',
  });

  useEffect(() => {
    Promise.all([
      api.products.list(),
      api.batches.list(),
      api.shelfLocations.list(),
      api.vendors.list({ status: 'active' }),
      api.masters.list('grades'),
      api.masters.list('bag-quantities'),
    ])
      .then(([productRows, batchRows, locationRows, vendorRows, gradeRows, bagQuantityRows]) => {
        setProducts(productRows);
        setBatches(batchRows);
        setLocations(locationRows.filter((location: any) => hasUsableMasterId(location) && isActiveMaster(location)));
        setVendors(vendorRows.filter((vendor: any) => hasUsableMasterId(vendor) && isActiveMaster(vendor)));
        setGrades(gradeRows.filter((grade: any) => hasUsableMasterId(grade) && isActiveMaster(grade)));
        setBagQuantities(bagQuantityRows.filter((value: any) => hasUsableMasterId(value) && isActiveMaster(value)));
      })
      .catch((err: Error) => setError(err.message));
  }, []);

  const selectedProduct = useMemo(() => products.find(p => String(p.id) === productId), [productId, products]);

  const filteredBatches = useMemo(() => {
    if (!searchQuery) return batches;
    const q = searchQuery.toLowerCase();
    return batches.filter(b =>
      (b.product_name || '').toLowerCase().includes(q) ||
      (b.product_sku || '').toLowerCase().includes(q) ||
      b.batch_number.toLowerCase().includes(q) ||
      b.barcode_value.toLowerCase().includes(q)
    );
  }, [batches, searchQuery]);

  const batchesByGroup = useMemo(() => {
    const groups = new Map<string, Batch[]>();
    batches.forEach(batch => {
      if (!batch.batch_group_id) return;
      const group = groups.get(batch.batch_group_id) || [];
      group.push(batch);
      groups.set(batch.batch_group_id, group);
    });
    return groups;
  }, [batches]);

  const resetForm = () => {
    setProductId(''); setBatchNumber(''); setBatchCount('1'); setQuantity('1'); setUom('pcs');
    setUnitPrice(''); setManufacturingDate(''); setExpiryDate('');
    setShelfLocationId(''); setNotes(''); setError('');
  };

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault();
    if (creatingBatch) return;
    setError('');
    setSuccess('');
    const batchTotal = Number(batchCount);
    const unitCount = Number(quantity);
    const price = unitPrice.trim() ? Number(unitPrice) : 0;
    if (!Number.isInteger(batchTotal) || batchTotal < 1 || batchTotal > 100) {
      setError('Enter a whole-number batch count between 1 and 100.');
      return;
    }
    if (!Number.isInteger(unitCount) || unitCount < 1 || unitCount > 1000) {
      setError('Enter a whole-number product count between 1 and 1,000.');
      return;
    }
    if (batchTotal * unitCount > 10_000) {
      setError('A single generation can contain no more than 10,000 products.');
      return;
    }
    if (!Number.isFinite(price) || price < 0) {
      setError('Enter a valid non-negative unit price.');
      return;
    }
    if (manufacturingDate && expiryDate && expiryDate < manufacturingDate) {
      setError('Expiry date cannot be earlier than the manufacturing date.');
      return;
    }
    setCreatingBatch(true);
    try {
      const created = await api.batches.create({
        product_id: productId,
        quantity: Number(quantity),
        batch_count: batchTotal,
        uom: uom || undefined,
        unit_price: price,
        manufacturing_date: manufacturingDate || undefined,
        expiry_date: expiryDate || undefined,
        notes: notes || undefined,
        // Batch number is optional in the new workflow — omit it so the backend generates one.
        ...(batchNumber.trim() ? { batch_number: batchNumber.trim() } : {}),
      } as Parameters<typeof api.batches.create>[0]);
      setShowForm(false); resetForm();
      setSuccess(`Created ${batchTotal} auto QC-passed batch${batchTotal === 1 ? '' : 'es'} with ${batchTotal * Number(quantity)} unit QR labels.`);
      try {
        await downloadCreatedQrPdfs(created.batches);
        setSuccess(batchTotal === 1
          ? `Batch ${created.batches[0].batch_number} created QC-passed and its QR PDF downloaded.`
          : `${batchTotal} QC-passed batches created and their QR PDFs downloaded as a ZIP.`);
      } catch (downloadError: any) {
        setError(`Batches were created, but the QR download could not be completed: ${downloadError.message || 'QR PDF unavailable.'}`);
      }
      try {
        setBatches(await api.batches.list());
      } catch (refreshError: any) {
        setError((current) => current
          ? `${current} Batch list could not be refreshed: ${refreshError.message || 'Request failed.'}`
          : `Batches were created, but the list could not be refreshed: ${refreshError.message || 'Request failed.'}`);
      }
    } catch (err: any) { setError(err.message || 'Could not create QC batch'); }
    finally { setCreatingBatch(false); }
  };

  const handleFinishGoods = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (savingFinishGoods) return;
    const vendorId = finishGoodsSelection.vendorId;
    const gradeId = finishGoodsSelection.gradeId;
    const bagQuantityId = finishGoodsSelection.bagQuantityId;
    const isValidSelection = (id: string, rows: any[]) =>
      id.length > 0 && rows.some(row => String(row.id) === id && isActiveMaster(row));
    if (!finishBatch) return;
    if (
      !isValidSelection(vendorId, vendors) ||
      !isValidSelection(gradeId, grades) ||
      !isValidSelection(bagQuantityId, bagQuantities)
    ) {
      setError('One or more selected supplier, grade, or bag-size records are no longer available. Refresh the page and select active values again.');
      return;
    }
    setError('');
    setSavingFinishGoods(true);
    try {
      const result = await api.batches.finishGoods(finishBatch.id, {
        vendor_id: vendorId,
        grade_id: gradeId,
        bag_quantity_id: bagQuantityId,
        shelf_location_id: shelfLocationId || undefined,
      });
      setSuccess(`Finished-goods details saved for ${finishBatch.batch_number}. Its ${result.labels.length} QR labels remain available to download.`);
      setFinishBatch(null);
      setShelfLocationId('');
      setFinishGoodsSelection({ vendorId: '', gradeId: '', bagQuantityId: '' });
      setBatches(await api.batches.list());
    } catch (err: any) {
      setError(err.message || 'Could not complete finished-goods details');
    } finally { setSavingFinishGoods(false); }
  };

  const handleDownloadGroupZip = async (group: Batch[]) => {
    const groupId = group[0]?.batch_group_id;
    if (!groupId || group.some(batch => !batch.qr_job_id)) {
      setError('QR labels are missing for one or more batches in this group. Finish-goods details for legacy batches to generate their labels.');
      return;
    }
    setError('');
    setSuccess('');
    setDownloadingGroupId(groupId);
    try {
      const zip = new JSZip();
      const orderedBatches = [...group].sort((a, b) => a.batch_number.localeCompare(b.batch_number, undefined, { numeric: true }));
      const details = await Promise.all(orderedBatches.map(async (batch) => {
        const detail = await api.qc.qrJobs.get(batch.qr_job_id!);
        return api.qc.qrJobs.reprint(batch.qr_job_id!, {
          label_ids: detail.labels.map((label: QrLabel) => label.id),
        });
      }));
      for (let index = 0; index < orderedBatches.length; index += 1) {
        const batch = orderedBatches[index];
        const detail = details[index];
        if (!Array.isArray(detail.labels) || detail.labels.length !== Number(batch.quantity)) {
          throw new Error(`Batch ${batch.batch_number} has ${detail.labels?.length ?? 0} QR labels; expected ${batch.quantity}.`);
        }
        const pdf = await createQrPdfBlob(detail.labels, detail.job);
        zip.file(`${safeFileName(batch.batch_number)}.pdf`, pdf);
      }
      const archive = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(archive);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `QR-${safeFileName(orderedBatches[0].product_sku || orderedBatches[0].product_name || 'batches')}-${safeFileName(groupId.slice(0, 8))}.zip`;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setSuccess(`Downloaded ${orderedBatches.length} batch PDFs as a ZIP. Each PDF contains ${orderedBatches[0].quantity} QR labels.`);
    } catch (err: any) {
      setError(err.message || 'Could not create the batch QR ZIP.');
    } finally {
      setDownloadingGroupId(null);
    }
  };

  const handlePrintQR = async (batch: Batch) => {
    if (!batch.qr_job_id) {
      setError('This older batch has no unit QR labels. Generate labels by creating a new batch.');
      return;
    }
    try {
      const detail = await api.qc.qrJobs.get(batch.qr_job_id);
      const reprinted = await api.qc.qrJobs.reprint(batch.qr_job_id, {
        label_ids: detail.labels.map((label: QrLabel) => label.id),
      });
      await downloadQrPdf(reprinted.labels, reprinted.job);
      setSuccess(`Downloaded ${reprinted.labels.length} QR labels for ${batch.batch_number}.`);
    } catch (err: any) {
      setError(err.message || 'Could not download batch QR labels');
    }
  };

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1 className="page-title">Batches</h1>
          <p className="page-subtitle">
            {canManageBatches
              ? 'Create QC-passed batches with downloadable unit QR labels, complete finished-goods details, and track dispatch status. Batches are created QC-passed automatically; no failed-QC batches are recorded.'
              : 'Read-only overview of batches. Batches are created QC-passed automatically; no failed-QC batches are recorded. Batch reports are available in Reports & Logs.'}
          </p>
        </div>
        {canManageBatches && (
          <button onClick={() => { setShowForm(!showForm); resetForm(); }} className="btn-primary">
            <Plus size={16} /> New Batch
          </button>
        )}
      </div>

      {success && (
        <div className="mb-4 flex items-center justify-between rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">
          <span>{success}</span>
          <button onClick={() => setSuccess('')} className="text-emerald-700" aria-label="Dismiss message"><X size={15} /></button>
        </div>
      )}
      {error && !showForm && !finishBatch && (
        <div className="mb-4 flex items-center justify-between rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
          <span>{error}</span>
          <button onClick={() => setError('')} className="text-rose-700" aria-label="Dismiss error"><X size={15} /></button>
        </div>
      )}

      {canManageBatches && showForm && (
        <div className="modal-overlay" onClick={() => { if (!creatingBatch) setShowForm(false); }}>
          <div className="modal-content max-w-2xl" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="text-base font-semibold text-surface-900">Create Auto-Passed QC Batch</h2>
              <button onClick={() => setShowForm(false)} className="btn-ghost btn-sm" disabled={creatingBatch} aria-label="Close batch form"><X size={16} /></button>
            </div>
            <form onSubmit={handleCreate}>
              <div className="modal-body space-y-4">
                <div className="form-grid">
                  <div className="space-y-1.5 md:col-span-2">
                    <label className="input-label">Product *</label>
                    <select className="select" value={productId} onChange={e => {
                      setProductId(e.target.value);
                      const p = products.find(x => String(x.id) === e.target.value);
                      if (p?.price && p.price > 0) setUnitPrice(String(p.price));
                    }} required>
                      <option value="">-- Select Product --</option>
                      {products.map(p => (
                        <option key={p.id} value={p.id}>{p.name} ({p.sku}){p.cas_number ? ` | CAS: ${p.cas_number}` : ''}</option>
                      ))}
                    </select>
                    {selectedProduct && (
                      <div className="flex flex-wrap gap-2 text-xs text-surface-500 mt-1">
                        {selectedProduct.quantity > 0 && <span className="bg-surface-50 px-2 py-1 rounded-lg">Stock: <strong>{selectedProduct.quantity}</strong></span>}
                        {selectedProduct.cas_number && <span className="bg-surface-50 px-2 py-1 rounded-lg">CAS: <strong>{selectedProduct.cas_number}</strong></span>}
                        {selectedProduct.molecular_formula && <span className="bg-surface-50 px-2 py-1 rounded-lg">Formula: <strong>{selectedProduct.molecular_formula}</strong></span>}
                        {selectedProduct.grade && <span className="bg-surface-50 px-2 py-1 rounded-lg">Grade: <strong>{selectedProduct.grade}</strong></span>}
                      </div>
                    )}
                  </div>

                  <div className="space-y-1.5">
                    <label className="input-label">Batch Number</label>
                    <input className="input" placeholder="Auto-generated" value={batchNumber} onChange={e => setBatchNumber(e.target.value)} />
                    <p className="text-xs text-surface-400">Optional. Leave blank to auto-generate; for multiple batches, sequential numbers are generated.</p>
                  </div>

                  <div className="space-y-1.5">
                    <label className="input-label">Number of batches *</label>
                    <input className="input" type="number" step="1" min="1" max="100" value={batchCount} onChange={e => setBatchCount(e.target.value)} required />
                  </div>

                  <div className="space-y-1.5">
                    <label className="input-label">Products / units per batch *</label>
                    <input className="input" type="number" step="1" min="1" max="1000" value={quantity} onChange={e => setQuantity(e.target.value)} required />
                    <p className="text-xs text-surface-400">
                      {Number(batchCount) > 0 && Number(quantity) > 0
                        ? `${Number(batchCount) * Number(quantity)} total products / QR labels ready when created`
                        : 'QR labels are ready to download as soon as batches are created.'}
                    </p>
                  </div>

                  <div className="space-y-1.5">
                    <label className="input-label">Unit Price (₹)</label>
                    <input className="input" type="number" step="0.01" value={unitPrice} onChange={e => setUnitPrice(e.target.value)} />
                  </div>

                  <div className="space-y-1.5">
                    <label className="input-label">Batch Unit</label>
                    <input className="input" value="pcs" readOnly />
                  </div>

                  <div className="space-y-1.5">
                    <label className="input-label">Manufacturing Date</label>
                    <input className="input" type="date" value={manufacturingDate} onChange={e => setManufacturingDate(e.target.value)} />
                  </div>

                  <div className="space-y-1.5">
                    <label className="input-label">Expiry Date</label>
                    <input className="input" type="date" value={expiryDate} onChange={e => setExpiryDate(e.target.value)} />
                  </div>

                  <div className="space-y-1.5 md:col-span-2">
                    <label className="input-label">Notes</label>
                    <textarea className="input" rows={2} placeholder="Additional notes" value={notes} onChange={e => setNotes(e.target.value)} />
                  </div>
                </div>
                {error && <div className="text-sm text-rose-600 bg-rose-50 p-3 rounded-xl">{error}</div>}
                <p className="text-xs text-surface-500">
                  Each batch is created with status <strong>QC_PASSED</strong> automatically and an <strong>AUTO_PASS</strong> QC record is written for audit.
                  There is no fail step — no failed-QC batches are recorded. Unit QR labels are ready to download as soon as the batch is created, and finished-goods details can be completed afterwards.
                </p>
              </div>
              <div className="modal-footer">
                <button type="button" onClick={() => setShowForm(false)} className="btn-secondary" disabled={creatingBatch}>Cancel</button>
                <button type="submit" className="btn-primary" disabled={creatingBatch || !products.length}>
                  {creatingBatch ? 'Creating batches and QR labels…' : 'Create Auto-Passed QC Batch'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {finishBatch && (
        <div className="modal-overlay" onClick={() => { if (!savingFinishGoods) setFinishBatch(null); }}>
          <div className="modal-content max-w-2xl" onClick={event => event.stopPropagation()}>
            <form onSubmit={handleFinishGoods}>
              <div className="modal-header">
                <h2 className="text-base font-semibold text-surface-900">Finished-goods details — {finishBatch.batch_number}</h2>
                <button type="button" onClick={() => setFinishBatch(null)} className="btn-ghost btn-sm" disabled={savingFinishGoods} aria-label="Close finished-goods form"><X size={16} /></button>
              </div>
              <div className="modal-body space-y-4">
                <p className="text-sm text-surface-500">This batch is auto QC-passed. Select the finished-goods master values; this updates the batch without creating duplicate QR labels.</p>
                {(!vendors.length || !grades.length || !bagQuantities.length) && (
                  <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                    Some required dropdowns have no active records with valid IDs.
                    {!vendors.length && ' Add or activate a supplier.'}
                    {!grades.length && ' Add or activate a grade.'}
                    {!bagQuantities.length && ' Add or activate a bag quantity.'}
                  </div>
                )}
                <div className="form-grid">
                  <div className="space-y-1.5">
                    <label className="input-label" htmlFor="finish-vendor">Supplier *</label>
                    <select
                      id="finish-vendor"
                      name="vendor_id"
                      className="select"
                      value={finishGoodsSelection.vendorId}
                      onChange={event => {
                        setFinishGoodsSelection(current => ({ ...current, vendorId: event.target.value }));
                        setError('');
                      }}
                      required
                    >
                      <option value="">-- Select supplier --</option>
                      {vendors.map(vendor => (
                        <option key={vendor.id} value={String(vendor.id)}>
                          {vendor.vendor_code === 'SELF' ? 'Self (Manufacturing Plant)' : vendor.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <label className="input-label" htmlFor="finish-grade">Grade *</label>
                    <select
                      id="finish-grade"
                      name="grade_id"
                      className="select"
                      value={finishGoodsSelection.gradeId}
                      onChange={event => {
                        setFinishGoodsSelection(current => ({ ...current, gradeId: event.target.value }));
                        setError('');
                      }}
                      required
                    >
                      <option value="">-- Select grade --</option>
                      {grades.map(grade => (
                        <option key={grade.id} value={String(grade.id)}>{grade.name}</option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <label className="input-label" htmlFor="finish-bag-quantity">Bag quantity *</label>
                    <select
                      id="finish-bag-quantity"
                      name="bag_quantity_id"
                      className="select"
                      value={finishGoodsSelection.bagQuantityId}
                      onChange={event => {
                        setFinishGoodsSelection(current => ({ ...current, bagQuantityId: event.target.value }));
                        setError('');
                      }}
                      required
                    >
                      <option value="">-- Select bag quantity --</option>
                      {bagQuantities.map(value => (
                        <option key={value.id} value={String(value.id)}>{value.quantity} {value.unit}</option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <label className="input-label" htmlFor="finish-location">Godown / shelf location</label>
                    <select id="finish-location" className="select" value={shelfLocationId} onChange={event => setShelfLocationId(event.target.value)}>
                      <option value="">-- Select location --</option>
                      {locations.map(location => <option key={location.id} value={location.id}>{location.location_code}</option>)}
                    </select>
                  </div>
                </div>
                {error && <div className="text-sm text-rose-600 bg-rose-50 p-3 rounded-xl">{error}</div>}
              </div>
              <div className="modal-footer">
                <button type="button" onClick={() => setFinishBatch(null)} className="btn-secondary" disabled={savingFinishGoods}>Cancel</button>
                <button type="submit" className="btn-primary" disabled={savingFinishGoods}>
                  <PackageCheck size={15} /> {savingFinishGoods ? 'Saving…' : 'Save finished-goods details'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <div className="flex items-center gap-3 mb-4">
        <div className="relative flex-1 max-w-full sm:max-w-xs">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-surface-400" />
          <input className="input pl-9" placeholder="Search batches..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} />
        </div>
        {searchQuery && <button onClick={() => setSearchQuery('')} className="btn-ghost btn-sm shrink-0"><X size={14} /> Clear</button>}
      </div>

      <div className="card">
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Product</th><th>Lot #</th><th>Products / contents</th><th>Supplier / grade</th><th>MFG</th><th>Expiry</th><th>Location</th><th>Status</th>{canDownloadQr && <th>Actions</th>}<th>Created</th></tr>
            </thead>
            <tbody>
              {filteredBatches.map(b => {
                const batchGroup = b.batch_group_id ? batchesByGroup.get(b.batch_group_id) : undefined;
                const isFirstInGroup = batchGroup?.[0].id === b.id;
                const readyCount = batchGroup?.filter(batch => batch.qr_job_id).length ?? 0;
                return (
                <tr key={b.id}>
                  <td><div className="font-medium text-surface-800">{b.product_name}</div><div className="text-xs text-surface-400">{b.product_sku}</div></td>
                  <td><span className="font-mono text-xs bg-surface-100 px-2 py-1 rounded-lg">{b.batch_number}</span></td>
                  <td>{b.quantity} units{b.bag_quantity ? <div className="text-xs text-surface-400">{b.bag_quantity} {b.bag_quantity_unit} each</div> : null}</td>
                  <td className="text-xs">{b.vendor_name || '-'}<div className="text-surface-400">{b.grade_name || b.product_grade || '-'}</div></td>
                  <td className="text-xs text-surface-500">{b.manufacturing_date ? new Date(b.manufacturing_date).toLocaleDateString() : '-'}</td>
                  <td className="text-xs text-surface-500">{b.expiry_date ? new Date(b.expiry_date).toLocaleDateString() : '-'}</td>
                  <td className="text-xs">{b.location_code || b.storage_location || '-'}</td>
                  <td><span className={`badge ${statusColors[b.status] || 'badge-neutral'}`}>{statusLabels[b.status] || b.status}</span></td>
                  {canDownloadQr && <td>
                    <div className="flex items-center gap-1">
                      {b.qr_job_id && <button onClick={() => handlePrintQR(b)} className="btn-ghost btn-sm" title="Download QR labels"><Download size={14} /></button>}
                      {batchGroup && batchGroup.length > 1 && isFirstInGroup &&
                        (readyCount === batchGroup.length ? (
                            <button
                              onClick={() => void handleDownloadGroupZip(batchGroup)}
                              className="btn-secondary btn-xs"
                              disabled={downloadingGroupId === b.batch_group_id}
                              title="Download one PDF per batch in a ZIP"
                            >
                              <Download size={13} /> {downloadingGroupId === b.batch_group_id ? 'Building ZIP…' : `QR ZIP (${batchGroup.length})`}
                            </button>
                          ) : (
                            <span className="whitespace-nowrap text-xs text-surface-400" title="QR labels are generated at batch creation; legacy batches may need finished-goods completion">
                              QR {readyCount}/{batchGroup.length}
                            </span>
                          ))}
                      {canManageBatches && b.status === 'QC_PASSED' && !b.fg_details_completed_at && (
                            <button onClick={() => {
                              setFinishGoodsSelection({ vendorId: '', gradeId: '', bagQuantityId: '' });
                              setFinishBatch(b);
                              setShelfLocationId('');
                              setError('');
                            }} className="btn-primary btn-xs">
                          <PackageCheck size={13} /> Finish goods details
                        </button>
                      )}
                    </div>
                  </td>}
                  <td className="text-xs text-surface-400">{new Date(b.created_at).toLocaleDateString()}</td>
                </tr>
                );
              })}
              {filteredBatches.length === 0 && (
                <tr><td colSpan={canDownloadQr ? 10 : 9}><div className="empty-state"><div className="empty-icon"><Layers size={24} className="text-surface-400" /></div><div className="empty-title">No batches found</div><div className="empty-desc">{searchQuery ? 'Try a different search term' : canManageBatches ? 'Create your first batch' : 'Batches created by QC will appear here'}</div></div></td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
