import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, Boxes, CheckCircle2, ClipboardList, MapPin, Package, RefreshCw, ScanLine, Truck } from 'lucide-react';
import { api } from '../services/api';

export default function DispatchDashboard() {
  const navigate = useNavigate();
  const [orders, setOrders] = useState<any[]>([]);
  const [readyBatches, setReadyBatches] = useState<any[]>([]);
  const [loadingSessions, setLoadingSessions] = useState<any[]>([]);
  const [today, setToday] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const [ownOrders, allBatches, activeLoads, dispatchedToday] = await Promise.all([
        api.dispatchOrders.mine(), api.batches.list(), api.loadingSessions.active(), api.dispatch.today(),
      ]);
      setOrders(ownOrders.filter((order: any) => Number(order.quantity) > 0 && order.batch_id && order.product_name));
      setReadyBatches(allBatches.filter((batch: any) =>
        ['QC_PASSED', 'DISPATCH_APPROVED'].includes(batch.status) &&
        Number(batch.qr_count) === Number(batch.quantity) && Number(batch.available_quantity ?? batch.quantity) > 0,
      ));
      setLoadingSessions(Array.isArray(activeLoads) ? activeLoads : []);
      setToday(Array.isArray(dispatchedToday) ? dispatchedToday : []);
    } catch (err: any) { setError(err.message || 'Could not load dispatch workspace'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);
  const openOrders = useMemo(() => orders.filter(order => order.status === 'APPROVED'), [orders]);
  const totalAvailableUnits = readyBatches.reduce((sum, batch) => sum + Number(batch.available_quantity ?? batch.quantity ?? 0), 0);
  const stats = [
    { label: 'Orders ready to load', value: openOrders.length, icon: ClipboardList, style: 'bg-blue-50 text-blue-700' },
    { label: 'Active loading sessions', value: loadingSessions.length, icon: ScanLine, style: 'bg-violet-50 text-violet-700' },
    { label: 'Batches with stock', value: readyBatches.length, icon: Boxes, style: 'bg-amber-50 text-amber-700' },
    { label: 'Dispatched today', value: today.length, icon: Truck, style: 'bg-emerald-50 text-emerald-700' },
  ];

  return <div className="page-container space-y-6">
    <header className="relative overflow-hidden rounded-2xl border border-surface-200 bg-white px-6 py-6 shadow-sm sm:px-8 sm:py-8">
      <div className="pointer-events-none absolute -right-10 -top-20 h-64 w-64 rounded-full bg-brand-50" />
      <div className="relative flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
        <div><div className="mb-3 inline-flex items-center gap-2 rounded-full bg-brand-50 px-3 py-1 text-xs font-bold uppercase tracking-wider text-brand-700"><Truck size={13} /> Dispatch operations</div><h1 className="text-3xl font-extrabold tracking-tight text-surface-950 sm:text-4xl">Good day. Let’s move orders.</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-surface-500">Create a customer order, load its allocated QR labels, then complete shipment details. Inventory updates when the load is dispatched.</p></div>
        <div className="flex shrink-0 gap-2"><button className="btn-secondary btn-sm" onClick={() => void load()} disabled={loading}><RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh</button><Link to="/dispatch-orders" className="btn-primary btn-sm"><ClipboardList size={15} /> New dispatch order</Link></div>
      </div>
    </header>

    {error && <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</div>}

    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {stats.map(({ label, value, icon: Icon, style }) => <div key={label} className="rounded-2xl border border-surface-200 bg-white p-4 shadow-sm"><div className="flex items-center justify-between"><span className={`flex h-10 w-10 items-center justify-center rounded-xl ${style}`}><Icon size={19} /></span><span className="text-3xl font-extrabold tabular-nums text-surface-900">{value}</span></div><p className="mt-3 text-sm font-medium text-surface-500">{label}</p></div>)}
    </section>

    <section className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.45fr)_minmax(320px,.8fr)]">
      <div className="card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-surface-100 px-5 py-4 sm:px-6"><div><h2 className="section-title flex items-center gap-2"><ClipboardList size={18} className="text-brand-600" /> Orders ready to load</h2><p className="mt-1 text-sm text-surface-500">Work from the customer dispatch order and its exact allocated quantity.</p></div><span className="badge badge-info">{openOrders.length} ready</span></div>
        <div className="divide-y divide-surface-100">
          {openOrders.map(order => <article key={order.id} className="flex flex-col gap-4 px-5 py-4 transition-colors hover:bg-surface-50/70 sm:flex-row sm:items-center sm:justify-between sm:px-6"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className="text-sm font-bold text-surface-900">{order.product_name}</span><span className="badge badge-info">Order #{order.id}</span><span className="font-mono text-xs text-surface-500">{order.items?.length > 1 ? `${order.items.length} product lines` : order.batch_number}</span></div>{order.items?.length > 1 && <div className="mt-2 flex flex-wrap gap-1.5">{order.items.map((item: any) => <span key={String(item.batch_id)} className="rounded-md border border-surface-200 bg-surface-50 px-2 py-1 text-[11px] text-surface-600"><strong className="text-surface-800">{item.product_name}</strong> · {item.batch_number} · {Number(item.quantity).toLocaleString()} {item.uom || 'units'}</span>)}</div>}<div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-surface-500"><span>Customer <strong className="text-surface-700">{order.client_name || '—'}</strong></span><span>Total qty <strong className="text-surface-700">{Number(order.quantity).toLocaleString()} units</strong></span>{order.storage_location && <span className="inline-flex items-center gap-1"><MapPin size={12} />{order.storage_location}</span>}</div></div><button className="btn-primary btn-sm shrink-0" onClick={() => navigate(`/dispatch?order=${encodeURIComponent(order.id)}`)}>Load order <ArrowRight size={14} /></button></article>)}
          {!loading && openOrders.length === 0 && <div className="px-6 py-12 text-center"><span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600"><CheckCircle2 size={22} /></span><p className="mt-3 text-sm font-semibold text-surface-800">You’re all caught up</p><p className="mt-1 text-xs text-surface-500">New orders will appear here as soon as they’re created.</p></div>}
          {loading && <div className="px-6 py-10 text-center text-sm text-surface-400">Loading dispatch orders…</div>}
        </div>
        <div className="border-t border-surface-100 px-5 py-3 sm:px-6"><Link to="/dispatch-orders" className="inline-flex items-center gap-1 text-xs font-semibold text-brand-700 hover:text-brand-800">View all dispatches <ArrowRight size={13} /></Link></div>
      </div>

      <div className="card overflow-hidden">
        <div className="border-b border-surface-100 px-5 py-4"><h2 className="section-title flex items-center gap-2"><Package size={18} className="text-amber-600" /> Available QC stock</h2><p className="mt-1 text-sm text-surface-500">Select stock while creating a dispatch order.</p></div>
        <div className="flex items-center justify-between bg-surface-50/70 px-5 py-3"><span className="text-xs font-medium text-surface-500">{readyBatches.length} batches available</span><span className="text-sm font-bold tabular-nums text-surface-800">{totalAvailableUnits.toLocaleString()} units</span></div>
        <div className="max-h-[360px] divide-y divide-surface-100 overflow-y-auto">{readyBatches.slice(0, 8).map(batch => <div key={batch.id} className="flex items-center justify-between gap-3 px-5 py-3"><div className="min-w-0"><p className="truncate text-sm font-semibold text-surface-800">{batch.product_name}</p><p className="mt-0.5 truncate font-mono text-[11px] text-surface-500">{batch.batch_number}{batch.storage_location ? ` · ${batch.storage_location}` : ''}</p></div><span className="shrink-0 rounded-lg bg-amber-50 px-2.5 py-1.5 text-xs font-bold tabular-nums text-amber-800">{Number(batch.available_quantity ?? batch.quantity).toLocaleString()} {batch.uom || ''}</span></div>)}{readyBatches.length === 0 && <div className="px-5 py-8 text-center text-xs text-surface-400">No batches have available stock.</div>}</div>
        <div className="border-t border-surface-100 p-4"><Link to="/dispatch-orders" className="btn-secondary flex w-full justify-center">Create order from stock <ArrowRight size={14} /></Link></div>
      </div>
    </section>
  </div>;
}
