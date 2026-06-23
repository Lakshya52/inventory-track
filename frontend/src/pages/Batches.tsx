import { useEffect, useState, FormEvent, useRef } from 'react';
import QRCode from 'qrcode';
import { api } from '../services/api';
import { Product, Batch } from '../types';

const statusColors: Record<string, string> = {
  CREATED: 'bg-gray-100 text-gray-700',
  QC_PASSED: 'bg-green-100 text-green-700',
  QC_FAILED: 'bg-red-100 text-red-700',
  DISPATCHED: 'bg-blue-100 text-blue-700',
};

function QRCodeImage({ value, size = 80 }: { value: string; size?: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (canvasRef.current) {
      QRCode.toCanvas(canvasRef.current, value, { width: size, margin: 1 });
    }
  }, [value, size]);
  return <canvas ref={canvasRef} className="inline-block" />;
}

function QRCodeModal({ value, onClose }: { value: string; onClose: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (canvasRef.current) {
      QRCode.toCanvas(canvasRef.current, value, { width: 200, margin: 2 });
    }
  }, [value]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div className="bg-white p-6 rounded-lg shadow-xl max-w-sm mx-4" onClick={e => e.stopPropagation()}>
        <canvas ref={canvasRef} className="mx-auto" />
        <div className="text-center mt-3 font-mono text-sm break-all">{value}</div>
        <div className="flex gap-3 mt-4 justify-center">
          <button className="bg-blue-800 text-white px-4 py-2 rounded hover:bg-blue-900" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Batches() {
  const [products, setProducts] = useState<Product[]>([]);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [productId, setProductId] = useState('');
  const [batchNumber, setBatchNumber] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [unitPrice, setUnitPrice] = useState('');
  const [manufacturingDate, setManufacturingDate] = useState('');
  const [expiryDate, setExpiryDate] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const [lastQR, setLastQR] = useState<{ value: string; product: string; batch: string } | null>(null);
  const [modalQR, setModalQR] = useState<string | null>(null);

  useEffect(() => {
    api.products.list().then(setProducts);
    api.batches.list().then(setBatches);
  }, []);

  const resetForm = () => {
    setProductId(''); setBatchNumber(''); setQuantity('1'); setUnitPrice('');
    setManufacturingDate(''); setExpiryDate(''); setNotes(''); setError('');
  };

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      const res = await api.batches.create({
        product_id: Number(productId),
        batch_number: batchNumber,
        quantity: Number(quantity),
        unit_price: Number(unitPrice) || 0,
        manufacturing_date: manufacturingDate || undefined,
        expiry_date: expiryDate || undefined,
        notes: notes || undefined,
      });
      setLastQR({ value: res.barcode_value, product: res.product_name, batch: batchNumber });
      setShowForm(false);
      resetForm();
      api.batches.list().then(setBatches);
    } catch (err: any) {
      setError(err.message);
    }
  };

  return (
    <div className="p-4">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold">Batches</h1>
        <button onClick={() => { setShowForm(!showForm); setError(''); setLastQR(null); }} className="bg-blue-800 text-white px-4 py-2 rounded hover:bg-blue-900 text-sm">
          {showForm ? 'Cancel' : '+ New Batch'}
        </button>
      </div>
      {showForm && (
        <form onSubmit={handleCreate} className="bg-white p-4 rounded shadow mb-4 space-y-3 max-w-md">
          <select className="w-full border p-2 rounded" value={productId} onChange={e => { const p = products.find(x => x.id === Number(e.target.value)); setProductId(e.target.value); setUnitPrice(p?.price && p.price > 0 ? String(p.price) : ''); }} required>
            <option value="">Select Product</option>
            {products.map(p => <option key={p.id} value={p.id}>{p.name} ({p.sku})</option>)}
          </select>
          <input className="w-full border p-2 rounded" placeholder="Batch Number" value={batchNumber} onChange={e => setBatchNumber(e.target.value)} required />
          <input className="w-full border p-2 rounded" type="number" min="1" placeholder="Quantity" value={quantity} onChange={e => setQuantity(e.target.value)} required />
          <input className="w-full border p-2 rounded" type="number" step="0.01" placeholder="Unit Price (optional)" value={unitPrice} onChange={e => setUnitPrice(e.target.value)} />
          <div>
            <label className="block text-xs text-gray-500">Manufacturing Date</label>
            <input className="w-full border p-2 rounded" type="date" value={manufacturingDate} onChange={e => setManufacturingDate(e.target.value)} />
          </div>
          <div>
            <label className="block text-xs text-gray-500">Expiry Date</label>
            <input className="w-full border p-2 rounded" type="date" value={expiryDate} onChange={e => setExpiryDate(e.target.value)} />
          </div>
          <textarea className="w-full border p-2 rounded" placeholder="Notes (optional)" value={notes} onChange={e => setNotes(e.target.value)} />
          {error && <div className="text-red-600 text-sm">{error}</div>}
          <button className="w-full bg-green-700 text-white p-2 rounded hover:bg-green-800" type="submit">Create Batch</button>
        </form>
      )}
      {lastQR && (
        <div className="bg-white p-4 rounded shadow mb-4 text-center max-w-md mx-auto">
          <p className="text-sm font-bold mb-2">Batch "{lastQR.batch}" created!</p>
          <QRCodeImage value={lastQR.value} size={160} />
          <p className="text-xs text-gray-500 mt-2 font-mono">{lastQR.value}</p>
          <p className="text-xs text-gray-400 mt-1">{lastQR.product}</p>
          <button onClick={() => { setLastQR(null); }} className="mt-3 bg-gray-300 text-gray-700 px-4 py-1 rounded text-sm hover:bg-gray-400">
            Dismiss
          </button>
        </div>
      )}
      <div className="bg-white rounded shadow overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-100">
            <tr>
              <th className="p-2 text-left">Product</th>
              <th className="p-2 text-left">Batch</th>
              <th className="p-2 text-left">Qty</th>
              <th className="p-2 text-left">Status</th>
              <th className="p-2 text-left">QR Code</th>
              <th className="p-2 text-left">Created</th>
            </tr>
          </thead>
          <tbody>
            {batches.map(b => (
              <tr key={b.id} className="border-t">
                <td className="p-2">{b.product_name} ({b.product_sku})</td>
                <td className="p-2 font-mono text-xs">{b.batch_number}</td>
                <td className="p-2">{b.quantity}</td>
                <td className="p-2">
                  <span className={`inline-block px-2 py-0.5 rounded text-xs font-semibold ${statusColors[b.status] || ''}`}>
                    {b.status}
                  </span>
                </td>
                <td className="p-2">
                  <QRCodeImage value={b.barcode_value} size={40} />
                  <button onClick={() => setModalQR(b.barcode_value)} className="ml-2 text-blue-600 hover:underline text-xs">view</button>
                </td>
                <td className="p-2 text-xs">{new Date(b.created_at).toLocaleDateString()}</td>
              </tr>
            ))}
            {batches.length === 0 && <tr><td colSpan={6} className="p-2 text-gray-500">No batches yet</td></tr>}
          </tbody>
        </table>
      </div>
      {modalQR && <QRCodeModal value={modalQR} onClose={() => setModalQR(null)} />}
    </div>
  );
}
