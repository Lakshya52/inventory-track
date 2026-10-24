import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../services/api';
import {
  Truck, Clock, CheckCircle, TrendingUp, RefreshCw, ClipboardList,
  ArrowRight, PackageCheck, AlertTriangle, XCircle, FileText,
} from 'lucide-react';

function formatAge(minutes: number | string | null | undefined): string {
  const value = Number(minutes || 0);
  if (value < 60) return `${value}m`;
  const hours = Math.floor(value / 60);
  const mins = value % 60;
  return `${hours}h ${mins}m`;
}

function formatDate(value: string | null | undefined): string {
  if (!value) return '-';
  return new Date(value).toLocaleString(undefined, {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  });
}

export default function DispatchDashboard() {
  const navigate = useNavigate();
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const load = useCallback(async (showSpinner = false) => {
    if (showSpinner) setRefreshing(true);
    setError('');
    try {
      setStats(await api.dispatch.stats());
    } catch (err: any) {
      setError(err.message || 'Could not load the dispatch dashboard');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading && !stats) {
    return <div className="page-container flex items-center justify-center h-64"><span className="text-sm text-surface-400">Loading dispatch dashboard...</span></div>;
  }

  const cards = [
    { label: 'Ready to Dispatch', value: stats?.readyToDispatch ?? 0, icon: <PackageCheck size={18} />, color: 'text-emerald-600', bg: 'bg-emerald-50' },
    { label: 'Awaiting Approval', value: stats?.pendingOrders ?? 0, icon: <Clock size={18} />, color: 'text-amber-600', bg: 'bg-amber-50' },
    { label: 'Approved Orders', value: stats?.approvedOrders ?? 0, icon: <CheckCircle size={18} />, color: 'text-sky-600', bg: 'bg-sky-50' },
    { label: 'Dispatched Today', value: stats?.dispatchedToday ?? 0, icon: <Truck size={18} />, color: 'text-indigo-600', bg: 'bg-indigo-50' },
    { label: 'My Total Dispatches', value: stats?.myTotalDispatches ?? 0, icon: <TrendingUp size={18} />, color: 'text-slate-600', bg: 'bg-slate-50' },
  ];

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1 className="page-title">Dispatch Dashboard</h1>
          <p className="page-subtitle">Raise dispatch orders, track approvals, and confirm dispatches</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button className="btn-secondary btn-sm" onClick={() => load(true)} disabled={refreshing}>
            <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} /> Refresh
          </button>
          <Link to="/dispatch-orders" className="btn-secondary btn-sm">
            <ClipboardList size={14} /> All Orders
          </Link>
          <Link to="/dispatch" className="btn-primary btn-sm">
            <Truck size={14} /> Group Dispatch Scan
          </Link>
        </div>
      </div>

      {error && (
        <div className="mb-4 p-3 rounded-xl text-sm flex items-center gap-2 bg-rose-50 text-rose-700 border border-rose-200">
          <AlertTriangle size={16} /> {error}
        </div>
      )}
      {message && (
        <div className="mb-4 p-3 rounded-xl text-sm flex items-center gap-2 bg-emerald-50 text-emerald-700 border border-emerald-200">
          <CheckCircle size={16} /> {message}
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
        {cards.map((card) => (
          <div key={card.label} className="card p-5">
            <div className="flex items-center gap-2 mb-2">
              <div className={`w-8 h-8 rounded-xl ${card.bg} ${card.color} flex items-center justify-center`}>{card.icon}</div>
              <span className="text-xs font-medium text-surface-500 uppercase tracking-wider">{card.label}</span>
            </div>
            <div className="text-2xl font-bold text-surface-900">{card.value}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 mb-6">
        <div className="card">
          <div className="card-header flex items-center justify-between">
            <h3 className="section-title flex items-center gap-2"><PackageCheck size={16} className="text-emerald-500" /> Ready to Dispatch</h3>
            <span className="badge badge-success">{stats?.readyBatches?.length || 0}</span>
          </div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Batch</th><th>Product</th><th>Qty</th><th>Waiting</th><th></th></tr></thead>
              <tbody>
                {(stats?.readyBatches || []).map((batch: any) => (
                  <tr key={batch.id}>
                    <td><span className="font-mono text-xs bg-surface-100 px-2 py-1 rounded-lg">{batch.batch_number}</span></td>
                    <td>
                      <div className="font-medium text-surface-800">{batch.product_name}</div>
                      <div className="text-xs text-surface-400">{batch.product_sku}</div>
                    </td>
                    <td className="text-sm text-surface-600">{batch.quantity} {batch.uom || ''}</td>
                    <td><span className={`badge ${Number(batch.age_minutes) > 240 ? 'badge-danger' : 'badge-neutral'}`}>{formatAge(batch.age_minutes)}</span></td>
                    <td>
                      <Link to="/dispatch-orders" className="btn-primary btn-xs">Raise Order</Link>
                    </td>
                  </tr>
                ))}
                {(!stats?.readyBatches || stats.readyBatches.length === 0) && (
                  <tr><td colSpan={5}><div className="empty-state"><div className="empty-title">No QC-passed batches with complete bag labels are waiting</div></div></td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card">
          <div className="card-header flex items-center justify-between">
            <h3 className="section-title flex items-center gap-2"><Clock size={16} className="text-amber-500" /> Awaiting Admin Approval</h3>
            <span className="badge badge-warning">{stats?.pendingOrdersList?.length || 0}</span>
          </div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Order</th><th>Batch</th><th>Product</th><th>Raised</th></tr></thead>
              <tbody>
                {(stats?.pendingOrdersList || []).map((order: any) => (
                  <tr key={order.id}>
                    <td className="text-sm font-medium text-surface-700">#{order.id}</td>
                    <td><span className="font-mono text-xs bg-surface-100 px-2 py-1 rounded-lg">{order.batch_number}</span></td>
                    <td className="text-sm text-surface-700">{order.product_name}</td>
                    <td className="text-xs text-surface-400">{formatDate(order.created_at)}</td>
                  </tr>
                ))}
                {(!stats?.pendingOrdersList || stats.pendingOrdersList.length === 0) && (
                  <tr><td colSpan={4}><div className="empty-state"><div className="empty-title">No orders waiting for approval</div></div></td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="card mb-6">
        <div className="card-header flex items-center justify-between">
          <h3 className="section-title flex items-center gap-2"><CheckCircle size={16} className="text-sky-500" /> Approved — Ready to Confirm Dispatch</h3>
          <span className="badge badge-info">{stats?.approvedOrdersList?.length || 0}</span>
        </div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Order</th><th>Batch</th><th>Product</th><th>Qty</th><th>Approved</th><th></th></tr></thead>
            <tbody>
              {(stats?.approvedOrdersList || []).map((order: any) => (
                <tr key={order.id}>
                  <td className="text-sm font-medium text-surface-700">#{order.id}</td>
                  <td><span className="font-mono text-xs bg-surface-100 px-2 py-1 rounded-lg">{order.batch_number}</span></td>
                  <td className="text-sm text-surface-700">{order.product_name}</td>
                  <td className="text-sm text-surface-600">{order.quantity} {order.uom || ''}</td>
                  <td className="text-xs text-surface-400">{formatDate(order.updated_at)}</td>
                  <td>
                    <button className="btn-primary btn-xs" onClick={() => navigate(`/dispatch?order=${encodeURIComponent(order.id)}`)}>
                      Dispatch <ArrowRight size={12} />
                    </button>
                  </td>
                </tr>
              ))}
              {(!stats?.approvedOrdersList || stats.approvedOrdersList.length === 0) && (
                <tr><td colSpan={6}><div className="empty-state"><div className="empty-title">No approved orders are waiting for dispatch</div></div></td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <div className="card-header flex items-center justify-between">
          <h3 className="section-title flex items-center gap-2"><Truck size={16} className="text-surface-400" /> Recent Dispatches</h3>
          <Link to="/packing-list" className="btn-secondary btn-xs"><FileText size={12} /> Packing Lists</Link>
        </div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Date</th><th>Product</th><th>Batch</th><th>Dispatched By</th><th>Remarks</th></tr></thead>
            <tbody>
              {(stats?.recentRecords || []).map((record: any) => (
                <tr key={record.id}>
                  <td className="text-xs text-surface-400">{formatDate(record.created_at)}</td>
                  <td><span className="font-medium text-surface-800">{record.product_name}</span></td>
                  <td><span className="font-mono text-xs bg-surface-100 px-2 py-1 rounded-lg">{record.batch_number}</span></td>
                  <td className="text-sm">{record.dispatcher_name || '-'}</td>
                  <td className="text-sm text-surface-500">{record.remarks || '-'}</td>
                </tr>
              ))}
              {(!stats?.recentRecords || stats.recentRecords.length === 0) && (
                <tr><td colSpan={5}><div className="empty-state"><div className="empty-title">No dispatches yet</div></div></td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
