import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Activity, Boxes, Package, Plus, QrCode, RefreshCw } from 'lucide-react';
import { api } from '../services/api';

export default function QCDashboard() {
  const [products, setProducts] = useState<any[]>([]);
  const [batches, setBatches] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const [productRows, batchRows] = await Promise.all([api.products.list(), api.batches.list()]);
      setProducts(productRows);
      setBatches(batchRows);
    } catch (err: any) {
      setError(err.message || 'Could not load QC workspace');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  const recentBatches = [...batches].sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime()).slice(0, 8);

  return <div className="page-container space-y-6">
    <header className="page-header">
      <div><h1 className="page-title">QC workspace</h1><p className="page-subtitle">Create stocked batches, print their QR labels once, and track live loading.</p></div>
      <button className="btn-secondary btn-sm" onClick={() => void load()} disabled={loading}><RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh</button>
    </header>
    {error && <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</div>}
    <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <Link to="/batches" className="card group p-5 hover:border-brand-300"><div className="flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-50 text-brand-600"><Plus size={18} /></span><div><p className="font-semibold text-surface-900">Create batch</p><p className="text-sm text-surface-500">Add one or more products</p></div></div></Link>
      <Link to="/products" className="card group p-5 hover:border-brand-300"><div className="flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-sky-50 text-sky-600"><Package size={18} /></span><div><p className="font-semibold text-surface-900">Product catalog</p><p className="text-sm text-surface-500">{products.length} products available</p></div></div></Link>
      <Link to="/loading-monitor" className="card group p-5 hover:border-brand-300"><div className="flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600"><Activity size={18} /></span><div><p className="font-semibold text-surface-900">Live loading</p><p className="text-sm text-surface-500">Watch dispatch progress</p></div></div></Link>
      <Link to="/qc/qr-codes" className="card group p-5 hover:border-brand-300"><div className="flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-50 text-violet-600"><QrCode size={18} /></span><div><p className="font-semibold text-surface-900">Print requests</p><p className="text-sm text-surface-500">Request a replacement print</p></div></div></Link>
    </section>
    <section className="card">
      <div className="card-header flex items-center justify-between"><div><h2 className="section-title flex items-center gap-2"><Boxes size={17} /> Recent batches</h2><p className="mt-1 text-sm text-surface-500">New batches are available to Dispatch immediately.</p></div><Link to="/batches" className="btn-primary btn-sm">All batches <Boxes size={14} /></Link></div>
      <div className="table-wrap"><table><thead><tr><th>Batch</th><th>Product</th><th>Quantity</th><th>Status</th><th>Created</th></tr></thead><tbody>
        {recentBatches.map(batch => <tr key={batch.id}><td className="font-mono text-xs">{batch.batch_number}</td><td><span className="font-medium">{batch.product_name}</span><span className="ml-2 text-xs text-surface-400">{batch.product_sku}</span></td><td>{batch.quantity} {batch.uom || ''}</td><td><span className="badge badge-success">{batch.status || 'In stock'}</span></td><td className="text-xs text-surface-500">{batch.created_at ? new Date(batch.created_at).toLocaleString() : '-'}</td></tr>)}
        {!loading && recentBatches.length === 0 && <tr><td colSpan={5}><div className="empty-state"><div className="empty-title">No batches yet</div><div className="empty-desc">Create a batch to add stock and generate its QR labels.</div></div></td></tr>}
      </tbody></table></div>
    </section>
  </div>;
}
