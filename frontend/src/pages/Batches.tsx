import { useEffect, useState, FormEvent, useRef, useMemo } from 'react';
import QRCode from 'qrcode';
import { api } from '../services/api';
import { Product, Batch } from '../types';
import { Layers, Plus, Search, X, Printer, QrCode } from 'lucide-react';

const UOMS = ['kg', 'g', 'mg', 'L', 'mL', 'tons', 'lb', 'oz', 'pcs'];

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
  const samePrefix = existingBatches.filter(b => b.batch_number.startsWith(prefix));
  const seq = String(samePrefix.length + 1).padStart(3, '0');
  return `${prefix}-${seq}`;
}

export default function Batches() {
  const [products, setProducts] = useState<Product[]>([]);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [error, setError] = useState('');
  const [printQR, setPrintQR] = useState<{ value: string; product: string; batch: string } | null>(null);

  const [productId, setProductId] = useState('');
  const [batchNumber, setBatchNumber] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [uom, setUom] = useState('kg');
  const [unitPrice, setUnitPrice] = useState('');
  const [manufacturingDate, setManufacturingDate] = useState('');
  const [expiryDate, setExpiryDate] = useState('');
  const [storageLocation, setStorageLocation] = useState('');
  const [notes, setNotes] = useState('');

  useEffect(() => {
    api.products.list().then(setProducts);
    api.batches.list().then(setBatches);
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

  const resetForm = () => {
    setProductId(''); setBatchNumber(''); setQuantity('1'); setUom('kg');
    setUnitPrice(''); setManufacturingDate(''); setExpiryDate('');
    setStorageLocation(''); setNotes(''); setError('');
  };

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      await api.batches.create({
        product_id: Number(productId), batch_number: batchNumber, quantity: Number(quantity),
        uom: uom || undefined, unit_price: Number(unitPrice) || 0,
        manufacturing_date: manufacturingDate || undefined, expiry_date: expiryDate || undefined,
        storage_location: storageLocation || undefined, notes: notes || undefined,
      });
      setShowForm(false); resetForm();
      api.batches.list().then(setBatches);
    } catch (err: any) { setError(err.message); }
  };

  const handlePrintQR = async (batch: Batch) => {
    const dataUrl = await QRCode.toDataURL(batch.barcode_value, { width: 200, margin: 2 });
    const win = window.open('', '_blank');
    if (!win) return;
    win.document.write(`
      <html><head><style>
        @page { margin: 10mm; }
        body { font-family: Arial, sans-serif; display: flex; flex-wrap: wrap; gap: 20px; justify-content: center; padding: 20px; }
        .qr-card { text-align: center; border: 1px dashed #ccc; padding: 15px; page-break-inside: avoid; width: 220px; }
        .qr-card img { display: block; margin: 0 auto 8px; }
        .qr-card .label { font-size: 11px; color: #333; word-break: break-all; }
        .qr-card .batch { font-size: 13px; font-weight: bold; margin-bottom: 4px; }
        .qr-card .product { font-size: 11px; color: #666; margin-bottom: 4px; }
        @media print { body { padding: 0; gap: 10px; } .qr-card { border: none; } }
      </style></head><body>
        <div class="qr-card">
          <div class="product">${batch.product_name}</div>
          <div class="batch">${batch.batch_number}</div>
          <img src="${dataUrl}" width="160" height="160" />
          <div class="label">${batch.barcode_value}</div>
        </div>
        <script>window.onload = function() { window.print(); window.close(); };<\/script>
      </body></html>
    `);
    win.document.close();
  };

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1 className="page-title">Batches</h1>
          <p className="page-subtitle">Create and manage production batches with QR codes</p>
        </div>
        <button onClick={() => { setShowForm(!showForm); resetForm(); }} className="btn-primary">
          <Plus size={16} /> New Batch
        </button>
      </div>

      {showForm && (
        <div className="modal-overlay" onClick={() => setShowForm(false)}>
          <div className="modal-content max-w-2xl" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="text-base font-semibold text-surface-900">Create New Batch</h2>
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
                  </div>

                  <div className="space-y-1.5">
                    <label className="input-label">Quantity *</label>
                    <input className="input" type="number" step="0.001" min="0" value={quantity} onChange={e => setQuantity(e.target.value)} required />
                  </div>

                  <div className="space-y-1.5">
                    <label className="input-label">Unit Price (₹)</label>
                    <input className="input" type="number" step="0.01" value={unitPrice} onChange={e => setUnitPrice(e.target.value)} />
                  </div>

                  <div className="space-y-1.5">
                    <label className="input-label">UOM</label>
                    <select className="select" value={uom} onChange={e => setUom(e.target.value)}>
                      {UOMS.map(u => <option key={u} value={u}>{u}</option>)}
                    </select>
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
                    <label className="input-label">Storage Location</label>
                    <input className="input" placeholder="e.g., Warehouse-A, Rack-3" value={storageLocation} onChange={e => setStorageLocation(e.target.value)} />
                  </div>

                  <div className="space-y-1.5 md:col-span-2">
                    <label className="input-label">Notes</label>
                    <textarea className="input" rows={2} placeholder="Additional notes" value={notes} onChange={e => setNotes(e.target.value)} />
                  </div>
                </div>
                {error && <div className="text-sm text-rose-600 bg-rose-50 p-3 rounded-xl">{error}</div>}
              </div>
              <div className="modal-footer">
                <button type="button" onClick={() => setShowForm(false)} className="btn-secondary">Cancel</button>
                <button type="submit" className="btn-primary">Create Batch</button>
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
              <tr><th>Product</th><th>Batch #</th><th>Qty</th><th>MFG</th><th>Expiry</th><th>Location</th><th>Status</th><th>QR</th><th>Created</th></tr>
            </thead>
            <tbody>
              {filteredBatches.map(b => (
                <tr key={b.id}>
                  <td><div className="font-medium text-surface-800">{b.product_name}</div><div className="text-xs text-surface-400">{b.product_sku}</div></td>
                  <td><span className="font-mono text-xs bg-surface-100 px-2 py-1 rounded-lg">{b.batch_number}</span></td>
                  <td>{b.quantity} {b.uom || ''}</td>
                  <td className="text-xs text-surface-500">{b.manufacturing_date ? new Date(b.manufacturing_date).toLocaleDateString() : '-'}</td>
                  <td className="text-xs text-surface-500">{b.expiry_date ? new Date(b.expiry_date).toLocaleDateString() : '-'}</td>
                  <td className="text-xs">{b.storage_location || '-'}</td>
                  <td><span className={`badge ${statusColors[b.status] || 'badge-neutral'}`}>{statusLabels[b.status] || b.status}</span></td>
                  <td>
                    <button onClick={() => handlePrintQR(b)} className="btn-ghost btn-sm" title="Print QR">
                      <Printer size={14} />
                    </button>
                  </td>
                  <td className="text-xs text-surface-400">{new Date(b.created_at).toLocaleDateString()}</td>
                </tr>
              ))}
              {filteredBatches.length === 0 && (
                <tr><td colSpan={9}><div className="empty-state"><div className="empty-icon"><Layers size={24} className="text-surface-400" /></div><div className="empty-title">No batches found</div><div className="empty-desc">{searchQuery ? 'Try a different search term' : 'Create your first batch'}</div></div></td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
