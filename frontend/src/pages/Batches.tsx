import { useEffect, useState, FormEvent, useRef, useMemo } from 'react';
import JSZip from 'jszip';
import { api } from '../services/api';
import { Product, Batch } from '../types';
import { Layers, Plus, Search, X, Printer, QrCode, PackageCheck, Download } from 'lucide-react';
import { createQrPdfBlob, downloadQrPdf } from '../utils/qrPdf';
import { useAuth } from '../contexts/AuthContext';

const statusColors: Record<string, string> = {
  CREATED: 'badge-neutral',
  QC_PASSED: 'badge-success',
  QC_FAILED: 'badge-danger',
  DISPATCH_ORDER_RAISED: 'badge-purple',
  DISPATCH_APPROVED: 'badge-info',
  DISPATCH_REJECTED: 'badge-warning',
  DISPATCHED: 'badge-info',
};

const statusLabels: Record<string, string> = {
  CREATED: 'Created',
  QC_PASSED: 'QC Passed',
  QC_FAILED: 'QC Failed',
  DISPATCH_ORDER_RAISED: 'Order Raised',
  DISPATCH_APPROVED: 'Approved',
  DISPATCH_REJECTED: 'Rejected',
  DISPATCHED: 'Dispatched',
};

function generateBatchNumber(sku: string, existingBatches: Batch[]): string {
  const today = new Date();
  const dateStr = today.toISOString().slice(0, 10).replace(/-/g, '');
  const prefix = `${sku}-${dateStr}`;
  const lastSequence = existingBatches.reduce((max, batch) => {
    const suffix = batch.batch_number.startsWith(`${prefix}-`)
      ? batch.batch_number.slice(prefix.length + 1)
      : '';
    return /^\d+$/.test(suffix) ? Math.max(max, Number(suffix)) : max;
  }, 0);
  const seq = String(lastSequence + 1).padStart(3, '0');
  return `${prefix}-${seq}`;
}

function safeFileName(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'batches';
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
        setLocations(locationRows.filter((location: any) => location.is_active));
        setVendors(vendorRows.filter((vendor: any) => vendor.is_active !== 0));
        setGrades(gradeRows.filter((grade: any) => grade.is_active !== 0));
        setBagQuantities(bagQuantityRows.filter((value: any) => value.is_active !== 0));
      })
      .catch((err: Error) => setError(err.message));
  }, []);

  const selectedProduct = useMemo(() => products.find(p => p.id === Number(productId)), [productId, products]);

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
    setError('');
    setSuccess('');
    try {
      const batchTotal = Number(batchCount);
      const productTotal = batchTotal * Number(quantity);
      if (!Number.isInteger(batchTotal) || batchTotal < 1 || batchTotal > 100) {
        setError('Enter a whole-number batch count between 1 and 100.');
        return;
      }
      if (productTotal > 10_000) {
        setError('A single generation can contain no more than 10,000 products.');
        return;
      }
      await api.batches.create({
        product_id: Number(productId), batch_number: batchNumber, quantity: Number(quantity),
        batch_count: batchTotal,
        uom: uom || undefined, unit_price: Number(unitPrice) || 0,
        manufacturing_date: manufacturingDate || undefined, expiry_date: expiryDate || undefined,
        notes: notes || undefined,
      });
      setShowForm(false); resetForm();
      setSuccess(`Created ${batchTotal} independent QC batch${batchTotal === 1 ? '' : 'es'} with ${Number(quantity)} product${Number(quantity) === 1 ? '' : 's'} each.`);
      setBatches(await api.batches.list());
    } catch (err: any) { setError(err.message); }
  };

  const handleFinishGoods = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const vendorId = Number(formData.get('vendor_id'));
    const gradeId = Number(formData.get('grade_id'));
    const bagQuantityId = Number(formData.get('bag_quantity_id'));
    if (!finishBatch || ![vendorId, gradeId, bagQuantityId].every(value => Number.isInteger(value) && value > 0)) {
      setError('Choose a supplier, grade, and bag quantity from each dropdown.');
      return;
    }
    setError('');
    try {
      const result = await api.batches.finishGoods(finishBatch.id, {
        vendor_id: vendorId,
        grade_id: gradeId,
        bag_quantity_id: bagQuantityId,
        shelf_location_id: shelfLocationId ? Number(shelfLocationId) : undefined,
      });
      const group = finishBatch.batch_group_id
        ? batchesByGroup.get(finishBatch.batch_group_id)
        : undefined;
      if (group && group.length > 1) {
        setSuccess(`QR labels generated for ${finishBatch.batch_number}. The group ZIP will be available after all ${group.length} batches have finished QC and goods details.`);
      } else {
        await downloadQrPdf(result.labels, result.qr_job);
        setSuccess(`QR labels downloaded for ${finishBatch.batch_number}.`);
      }
      setFinishBatch(null);
      setShelfLocationId('');
      setBatches(await api.batches.list());
    } catch (err: any) {
      setError(err.message || 'Could not complete finished-goods details');
    }
  };

  const handleDownloadGroupZip = async (group: Batch[]) => {
    const groupId = group[0]?.batch_group_id;
    if (!groupId || group.some(batch => !batch.qr_job_id)) {
      setError('Complete QC and finished-goods details for every batch in this group before downloading its ZIP.');
      return;
    }
    setError('');
    setSuccess('');
    setDownloadingGroupId(groupId);
    try {
      const zip = new JSZip();
      const orderedBatches = [...group].sort((a, b) => a.batch_number.localeCompare(b.batch_number, undefined, { numeric: true }));
      const details = await Promise.all(orderedBatches.map(batch => api.qc.qrJobs.get(Number(batch.qr_job_id))));
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
      const detail = await api.qc.qrJobs.get(Number(batch.qr_job_id));
      await downloadQrPdf(detail.labels, detail.job);
    } catch (err: any) {
      setError(err.message || 'Could not download batch QR labels');
    }
  };

  const sendForQcAgain = async (batch: Batch) => {
    const reason = window.prompt(`Why is batch ${batch.batch_number} being sent back for QC?`);
    if (!reason?.trim()) return;
    try {
      await api.qc.reopenFailedBatch(batch.id, reason.trim());
      setBatches(await api.batches.list());
    } catch (err: any) {
      setError(err.message || 'Could not reopen batch for QC');
    }
  };

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1 className="page-title">Batches</h1>
          <p className="page-subtitle">
            {canManageBatches
              ? 'Create batches, manage QC outcomes, complete finished-goods details, and generate or reprint product QR labels.'
              : 'Read-only overview of batches. Batch reports are available in Reports & Logs.'}
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

      {canManageBatches && showForm && (
        <div className="modal-overlay" onClick={() => setShowForm(false)}>
          <div className="modal-content max-w-2xl" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="text-base font-semibold text-surface-900">Create QC Batch</h2>
              <button onClick={() => setShowForm(false)} className="btn-ghost btn-sm"><X size={16} /></button>
            </div>
            <form onSubmit={handleCreate}>
              <div className="modal-body space-y-4">
                <div className="form-grid">
                  <div className="space-y-1.5 md:col-span-2">
                    <label className="input-label">Product *</label>
                    <select className="select" value={productId} onChange={e => {
                      setProductId(e.target.value);
                      const p = products.find(x => x.id === Number(e.target.value));
                      if (p?.price && p.price > 0) setUnitPrice(String(p.price));
                      if (p) setBatchNumber(generateBatchNumber(p.sku, batches));
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
                    <label className="input-label">Batch Number *</label>
                    <input className="input" placeholder="Auto-generated" value={batchNumber} onChange={e => setBatchNumber(e.target.value)} required />
                    <p className="text-xs text-surface-400">For multiple batches, sequential numbers are generated from this number.</p>
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
                        ? `${Number(batchCount) * Number(quantity)} total products / QR labels`
                        : 'QR labels are created after each batch passes QC.'}
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
                    <label className="input-label">Manufacturing Date *</label>
                    <input className="input" type="date" value={manufacturingDate} onChange={e => setManufacturingDate(e.target.value)} required />
                  </div>

                  <div className="space-y-1.5">
                    <label className="input-label">Expiry Date *</label>
                    <input className="input" type="date" value={expiryDate} onChange={e => setExpiryDate(e.target.value)} required />
                  </div>

                  <div className="space-y-1.5 md:col-span-2">
                    <label className="input-label">Notes</label>
                    <textarea className="input" rows={2} placeholder="Additional notes" value={notes} onChange={e => setNotes(e.target.value)} />
                  </div>
                </div>
                {error && <div className="text-sm text-rose-600 bg-rose-50 p-3 rounded-xl">{error}</div>}
                <p className="text-xs text-surface-500">
                  Each generated batch is QC-tracked separately. Its QR labels are created after QC passes and finished-goods details are saved.
                </p>
              </div>
              <div className="modal-footer">
                <button type="button" onClick={() => setShowForm(false)} className="btn-secondary">Cancel</button>
                <button type="submit" className="btn-primary">Create QC Batch</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {finishBatch && (
        <div className="modal-overlay" onClick={() => setFinishBatch(null)}>
          <div className="modal-content max-w-2xl" onClick={event => event.stopPropagation()}>
            <form onSubmit={handleFinishGoods}>
              <div className="modal-header">
                <h2 className="text-base font-semibold text-surface-900">Finished-goods details — {finishBatch.batch_number}</h2>
                <button type="button" onClick={() => setFinishBatch(null)} className="btn-ghost btn-sm"><X size={16} /></button>
              </div>
              <div className="modal-body space-y-4">
                <p className="text-sm text-surface-500">QC has passed. Select the finished-goods master values; individual bag QR labels will be generated when you submit.</p>
                <div className="form-grid">
                  <div className="space-y-1.5">
                    <label className="input-label" htmlFor="finish-vendor">Supplier *</label>
                    <select id="finish-vendor" name="vendor_id" className="select" defaultValue="" required>
                      <option value="">-- Select supplier --</option>
                      {vendors.map(vendor => (
                        <option key={vendor.id} value={vendor.id}>
                          {vendor.vendor_code === 'SELF' ? 'Self (Manufacturing Plant)' : vendor.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <label className="input-label" htmlFor="finish-grade">Grade *</label>
                    <select id="finish-grade" name="grade_id" className="select" defaultValue="" required>
                      <option value="">-- Select grade --</option>
                      {grades.map(grade => <option key={grade.id} value={grade.id}>{grade.name}</option>)}
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <label className="input-label" htmlFor="finish-bag-quantity">Bag quantity *</label>
                    <select id="finish-bag-quantity" name="bag_quantity_id" className="select" defaultValue="" required>
                      <option value="">-- Select bag quantity --</option>
                      {bagQuantities.map(value => <option key={value.id} value={value.id}>{value.quantity} {value.unit}</option>)}
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
                <button type="button" onClick={() => setFinishBatch(null)} className="btn-secondary">Cancel</button>
                <button type="submit" className="btn-primary">
                  <PackageCheck size={15} /> Save details & print bag labels
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
                      {b.qr_job_id && <button onClick={() => handlePrintQR(b)} className="btn-ghost btn-sm" title="Download QR labels"><Printer size={14} /></button>}
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
                            <span className="whitespace-nowrap text-xs text-surface-400" title="ZIP becomes available when every batch has QR labels">
                              QR {readyCount}/{batchGroup.length}
                            </span>
                          ))}
                      {canManageBatches && b.status === 'QC_PASSED' && !b.fg_details_completed_at && !b.qr_job_id && (
                            <button onClick={() => { setFinishBatch(b); setShelfLocationId(''); setError(''); }} className="btn-primary btn-xs">
                          <PackageCheck size={13} /> Finish goods + QR
                        </button>
                      )}
                      {canManageBatches && b.status === 'QC_FAILED' && (
                        <button onClick={() => sendForQcAgain(b)} className="btn-secondary btn-xs">Send for re-QC</button>
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
