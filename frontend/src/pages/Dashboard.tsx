import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../services/api';
import { AdminStats } from '../types';
import {
  Package, Layers, Microscope, Truck, Users, MapPin, Handshake,
  CheckCircle, XCircle, Clock, TrendingUp, ArrowRight, ClipboardList,
  FileBarChart, IndianRupee, Boxes,
} from 'lucide-react';

const statusBadge: Record<string, string> = {
  PASS: 'badge-success',
  FAIL: 'badge-danger',
  PENDING: 'badge-warning',
  APPROVED: 'badge-success',
  REJECTED: 'badge-danger',
};

export default function Dashboard() {
  const [data, setData] = useState<{
    stats: AdminStats;
    recentQc: any[];
    recentDispatches: any[];
    pendingRequests: any[];
    recentActivity: any[];
  } | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.dashboard.admin().then(setData).catch(err => setError(err.message));
  }, []);

  if (error) return <div className="page-container"><div className="card p-6 text-rose-600">{error}</div></div>;
  if (!data) return (
    <div className="page-container flex items-center justify-center h-64">
      <div className="flex flex-col items-center gap-2">
        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-brand-400 to-brand-600 animate-pulse" />
        <span className="text-sm text-surface-400">Loading admin dashboard...</span>
      </div>
    </div>
  );

  const s = data.stats;

  const stats = [
    { label: 'Products', value: s.totalProducts, icon: <Package size={20} />, light: 'bg-brand-50 text-brand-600' },
    { label: 'Inventory Value', value: `₹${Number(s.inventoryValue).toLocaleString('en-IN')}`, icon: <IndianRupee size={20} />, light: 'bg-emerald-50 text-emerald-600' },
    { label: 'Active Users', value: `${s.activeUsers}/${s.totalUsers}`, icon: <Users size={20} />, light: 'bg-violet-50 text-violet-600' },
    { label: 'QC Passed', value: s.qcPassed, icon: <CheckCircle size={20} />, light: 'bg-emerald-50 text-emerald-600' },
    { label: 'QC Failed', value: s.qcFailed, icon: <XCircle size={20} />, light: 'bg-rose-50 text-rose-600' },
    { label: 'Pending Dispatch Requests', value: s.pendingRequests, icon: <Clock size={20} />, light: 'bg-amber-50 text-amber-600' },
    { label: 'Shelf Locations', value: `${s.activeLocations}/${s.totalLocations}`, icon: <MapPin size={20} />, light: 'bg-slate-50 text-slate-600' },
  ];

  const quickActions = [
    { label: 'Clients', desc: 'Manage dispatch destinations', path: '/clients', icon: <Handshake size={18} />, color: 'bg-teal-50 text-teal-600' },
    { label: 'Users', desc: 'Accounts, roles and access', path: '/users', icon: <Users size={18} />, color: 'bg-violet-50 text-violet-600' },
    { label: 'Products', desc: 'Product catalogue and stock', path: '/products', icon: <Package size={18} />, color: 'bg-brand-50 text-brand-600' },
    { label: 'Shelf Locations', desc: 'Warehouse storage master', path: '/shelf-locations', icon: <MapPin size={18} />, color: 'bg-slate-50 text-slate-600' },
    { label: 'QC Reports', desc: 'Every quality check result', path: '/reports?tab=qc', icon: <Microscope size={18} />, color: 'bg-emerald-50 text-emerald-600' },
    { label: 'Dispatch Reports', desc: 'Completed dispatches', path: '/reports?tab=dispatch', icon: <Truck size={18} />, color: 'bg-sky-50 text-sky-600' },
    { label: 'Dispatch Requests', desc: 'Review and approve requests', path: '/reports?tab=requests', icon: <ClipboardList size={18} />, color: 'bg-amber-50 text-amber-600' },
    { label: 'Inventory Reports', desc: 'Product and batch inventory', path: '/reports?tab=inventory', icon: <Boxes size={18} />, color: 'bg-rose-50 text-rose-600' },
  ];

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1 className="page-title">Admin Dashboard</h1>
          <p className="page-subtitle">Manage clients, users, products and review every operation in one place</p>
        </div>
        <Link to="/reports" className="btn-primary">
          <FileBarChart size={16} /> Open Reports
        </Link>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {stats.map(c => (
          <div key={c.label} className="card p-5 relative overflow-hidden group">
            <div className={`absolute top-3 right-3 w-9 h-9 rounded-xl ${c.light} flex items-center justify-center transition-transform group-hover:scale-110`}>
              {c.icon}
            </div>
            <div className="text-xs font-medium text-surface-500 uppercase tracking-wider mb-1.5">{c.label}</div>
            <div className="text-2xl font-bold text-surface-900">{c.value}</div>
          </div>
        ))}
      </div>

      <div className="card mb-6">
        <div className="card-header">
          <h3 className="text-sm font-semibold text-surface-800">Quick Actions</h3>
        </div>
        <div className="card-body grid grid-cols-2 md:grid-cols-4 gap-3">
          {quickActions.map(action => (
            <Link key={action.label} to={action.path} className="group flex items-start gap-3 p-3 rounded-xl border border-surface-100 hover:border-brand-200 hover:bg-brand-50/40 transition-all">
              <div className={`w-9 h-9 rounded-xl ${action.color} flex items-center justify-center shrink-0`}>{action.icon}</div>
              <div className="min-w-0">
                <div className="text-sm font-semibold text-surface-800 group-hover:text-brand-700">{action.label}</div>
                <div className="text-xs text-surface-400 mt-0.5">{action.desc}</div>
              </div>
            </Link>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        <div className="card">
          <div className="card-header flex items-center justify-between">
            <h3 className="text-sm font-semibold text-surface-800 flex items-center gap-2">
              <ClipboardList size={16} className="text-surface-400" />
              Pending Dispatch Requests
            </h3>
            <Link to="/reports?tab=requests" className="text-xs text-brand-600 hover:text-brand-700 flex items-center gap-1">
              View all <ArrowRight size={12} />
            </Link>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Product</th><th>Batch</th><th>Raised By</th><th>Status</th></tr>
              </thead>
              <tbody>
                {data.pendingRequests.map((r: any) => (
                  <tr key={r.id}>
                    <td>
                      <div className="font-medium text-surface-800">{r.product_name}</div>
                      <div className="text-xs text-surface-400">{r.product_sku}</div>
                    </td>
                    <td><span className="font-mono text-xs bg-surface-100 px-2 py-1 rounded-lg">{r.batch_number}</span></td>
                    <td className="text-sm">{r.raised_by_name || '-'}</td>
                    <td><span className={`badge ${statusBadge[r.status] || 'badge-neutral'}`}>{r.status}</span></td>
                  </tr>
                ))}
                {data.pendingRequests.length === 0 && (
                  <tr><td colSpan={4}><div className="empty-state py-8"><div className="empty-title text-sm">No pending requests</div><div className="empty-desc text-xs">Dispatch requests will appear here for approval</div></div></td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card">
          <div className="card-header flex items-center justify-between">
            <h3 className="text-sm font-semibold text-surface-800 flex items-center gap-2">
              <Microscope size={16} className="text-surface-400" />
              Recent QC Results
            </h3>
            <Link to="/reports?tab=qc" className="text-xs text-brand-600 hover:text-brand-700 flex items-center gap-1">
              View all <ArrowRight size={12} />
            </Link>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Product</th><th>Batch</th><th>Result</th><th>Date</th></tr>
              </thead>
              <tbody>
                {data.recentQc.map((r: any) => (
                  <tr key={r.id}>
                    <td>
                      <div className="font-medium text-surface-800">{r.product_name}</div>
                      <div className="text-xs text-surface-400">{r.product_sku}</div>
                    </td>
                    <td><span className="font-mono text-xs bg-surface-100 px-2 py-1 rounded-lg">{r.batch_number}</span></td>
                    <td><span className={`badge ${statusBadge[r.result] || 'badge-neutral'}`}>{r.result}</span></td>
                    <td className="text-xs text-surface-400">{new Date(r.created_at).toLocaleDateString()}</td>
                  </tr>
                ))}
                {data.recentQc.length === 0 && (
                  <tr><td colSpan={4}><div className="empty-state py-8"><div className="empty-title">No QC results yet</div></div></td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="card">
          <div className="card-header flex items-center justify-between">
            <h3 className="text-sm font-semibold text-surface-800 flex items-center gap-2">
              <Truck size={16} className="text-surface-400" />
              Recent Dispatches
            </h3>
            <Link to="/reports?tab=dispatch" className="text-xs text-brand-600 hover:text-brand-700 flex items-center gap-1">
              View all <ArrowRight size={12} />
            </Link>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Product</th><th>Batch</th><th>Date</th></tr>
              </thead>
              <tbody>
                {data.recentDispatches.map((r: any) => (
                  <tr key={r.id}>
                    <td>
                      <div className="font-medium text-surface-800">{r.product_name}</div>
                      <div className="text-xs text-surface-400">{r.product_sku}</div>
                    </td>
                    <td><span className="font-mono text-xs bg-surface-100 px-2 py-1 rounded-lg">{r.batch_number}</span></td>
                    <td className="text-xs text-surface-400">{new Date(r.created_at).toLocaleString()}</td>
                  </tr>
                ))}
                {data.recentDispatches.length === 0 && (
                  <tr><td colSpan={3}><div className="empty-state py-8"><div className="empty-title">No dispatches yet</div></div></td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <h3 className="text-sm font-semibold text-surface-800 flex items-center gap-2">
              <TrendingUp size={16} className="text-surface-400" />
              Recent Activity
            </h3>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Time</th><th>Action</th><th>Description</th></tr>
              </thead>
              <tbody>
                {data.recentActivity.map((log: any) => (
                  <tr key={log.id}>
                    <td className="text-xs text-surface-400">{new Date(log.created_at).toLocaleString()}</td>
                    <td><span className="badge badge-neutral">{log.action}</span></td>
                    <td className="text-sm text-surface-600">{log.description || '-'}</td>
                  </tr>
                ))}
                {data.recentActivity.length === 0 && (
                  <tr><td colSpan={3}><div className="empty-state py-8"><div className="empty-title">No activity yet</div></div></td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6">
        {[
          { label: 'Total Batches', value: s.totalBatches, icon: <Layers size={16} /> },
          { label: 'QC Pass Rate', value: `${s.qcPassRate}%`, icon: <CheckCircle size={16} /> },
          { label: 'Dispatched Today', value: s.dispatchedToday, icon: <Truck size={16} /> },
          { label: 'Pending QC', value: s.pendingQc, icon: <Clock size={16} /> },
        ].map(item => (
          <div key={item.label} className="card p-4 flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-surface-100 text-surface-500 flex items-center justify-center">{item.icon}</div>
            <div>
              <div className="text-lg font-bold text-surface-900">{item.value}</div>
              <div className="text-xs text-surface-400">{item.label}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
