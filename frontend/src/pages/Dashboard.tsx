import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { AdminStats } from '../types';
import {
  Package,
  Boxes,
  Truck,
  Users,
  Warehouse,
  Building2,
  Factory,
  CheckCircle2,
  Clock,
  ArrowRight,
  ClipboardList,
  FileBarChart,
  IndianRupee,
  Activity,
  SlidersHorizontal,
  QrCode,
  Search,
  ExternalLink,
  ShieldCheck,
  TrendingUp,
  Radio,
} from 'lucide-react';

const statusBadge: Record<string, string> = {
  PASS: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  PENDING: 'bg-amber-50 text-amber-700 border-amber-200',
  APPROVED: 'bg-blue-50 text-blue-700 border-blue-200',
  DISPATCH_APPROVED: 'bg-blue-50 text-blue-700 border-blue-200',
  REJECTED: 'bg-rose-50 text-rose-700 border-rose-200',
  CLOSED_DISPATCHED: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  DISPATCHED: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  CLOSED_NOT_DISPATCHED: 'bg-rose-50 text-rose-700 border-rose-200',
  NOT_DISPATCHED: 'bg-rose-50 text-rose-700 border-rose-200',
  LOADING: 'bg-amber-50 text-amber-800 border-amber-200',
};

const statusLabel: Record<string, string> = {
  PASS: 'QC Passed',
  PENDING: 'Pending QC',
  APPROVED: 'Approved',
  DISPATCH_APPROVED: 'Approved',
  REJECTED: 'Rejected',
  CLOSED_DISPATCHED: 'Dispatched',
  DISPATCHED: 'Dispatched',
  CLOSED_NOT_DISPATCHED: 'Not Dispatched',
  NOT_DISPATCHED: 'Not Dispatched',
  LOADING: 'Loading In Progress',
};

type ActiveTab = 'dispatch_queue' | 'dispatches' | 'qc_records' | 'activity';

export default function Dashboard() {
  const { user } = useAuth();
  const [data, setData] = useState<{
    stats: AdminStats;
    recentQc: any[];
    recentDispatches: any[];
    pendingRequests: any[];
    recentActivity: any[];
  } | null>(null);
  const [activeSessions, setActiveSessions] = useState<any[]>([]);
  const [error, setError] = useState('');
  const [retryCount, setRetryCount] = useState(0);
  const [activeTab, setActiveTab] = useState<ActiveTab>('dispatch_queue');
  const [tableSearch, setTableSearch] = useState('');

  useEffect(() => {
    // Load admin dashboard summary and live loading sessions
    Promise.allSettled([api.dashboard.admin(), api.loadingSessions.active()])
      .then(([dashRes, sessionsRes]) => {
        if (dashRes.status === 'fulfilled') {
          setData(dashRes.value);
        } else {
          setError(dashRes.reason?.message || 'Could not load dashboard data');
        }

        if (sessionsRes.status === 'fulfilled' && Array.isArray(sessionsRes.value)) {
          setActiveSessions(sessionsRes.value);
        }
      })
      .catch((err) => setError(err.message));
  }, [retryCount]);

  useEffect(() => {
    let active = true;
    const refreshSessions = async () => {
      try {
        const sessions = await api.loadingSessions.active();
        if (active && Array.isArray(sessions)) setActiveSessions(sessions);
      } catch {
        // Keep the most recently loaded session snapshot visible during brief network interruptions.
      }
    };
    const interval = window.setInterval(() => { void refreshSessions(); }, 5000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, []);

  // Filter items in active tab by search string (Hooks must always run unconditionally at the top)
  const pendingRequests = data?.pendingRequests || [];
  const recentDispatches = data?.recentDispatches || [];
  const recentQc = data?.recentQc || [];
  const recentActivity = data?.recentActivity || [];

  const filteredQueue = useMemo(() => {
    if (!tableSearch.trim()) return pendingRequests;
    const q = tableSearch.toLowerCase();
    return pendingRequests.filter(
      (r) =>
        r.product_name?.toLowerCase().includes(q) ||
        r.product_sku?.toLowerCase().includes(q) ||
        r.batch_number?.toLowerCase().includes(q) ||
        r.raised_by_name?.toLowerCase().includes(q)
    );
  }, [pendingRequests, tableSearch]);

  const filteredDispatches = useMemo(() => {
    if (!tableSearch.trim()) return recentDispatches;
    const q = tableSearch.toLowerCase();
    return recentDispatches.filter(
      (r) =>
        r.product_name?.toLowerCase().includes(q) ||
        r.product_sku?.toLowerCase().includes(q) ||
        r.batch_number?.toLowerCase().includes(q)
    );
  }, [recentDispatches, tableSearch]);

  const filteredQc = useMemo(() => {
    if (!tableSearch.trim()) return recentQc;
    const q = tableSearch.toLowerCase();
    return recentQc.filter(
      (r) =>
        r.product_name?.toLowerCase().includes(q) ||
        r.product_sku?.toLowerCase().includes(q) ||
        r.batch_number?.toLowerCase().includes(q)
    );
  }, [recentQc, tableSearch]);

  const filteredActivity = useMemo(() => {
    if (!tableSearch.trim()) return recentActivity;
    const q = tableSearch.toLowerCase();
    return recentActivity.filter(
      (l) =>
        l.action?.toLowerCase().includes(q) ||
        l.description?.toLowerCase().includes(q) ||
        l.user_name?.toLowerCase().includes(q)
    );
  }, [recentActivity, tableSearch]);

  if (error) {
    return (
      <div className="max-w-7xl mx-auto p-4 sm:p-6 lg:p-8">
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-6 text-rose-800">
          <h3 className="font-bold text-base">Dashboard Error</h3>
          <p className="text-sm mt-1">{error}</p>
          <button
            type="button"
            onClick={() => { setError(''); setRetryCount(count => count + 1); }}
            className="btn-secondary btn-sm mt-4"
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="max-w-7xl mx-auto p-4 sm:p-6 lg:p-8 flex items-center justify-center min-h-[400px]">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-brand-600 to-indigo-500 flex items-center justify-center text-white font-bold animate-pulse shadow-md">
            A
          </div>
          <span className="text-sm text-slate-500 font-medium">Loading operations dashboard...</span>
        </div>
      </div>
    );
  }

  const s = data.stats;

  // Unique quick actions with distinct icons
  const quickActions = [
    {
      label: 'Products',
      desc: 'Catalogue & stock counts',
      path: '/products',
      icon: <Package size={18} />,
      color: 'bg-brand-50 text-brand-600 border-brand-100',
    },
    {
      label: 'Batches',
      desc: 'Production & auto-passed lots',
      path: '/batches',
      icon: <Boxes size={18} />,
      color: 'bg-indigo-50 text-indigo-600 border-indigo-100',
    },
    {
      label: 'Clients',
      desc: 'Corporate dispatch destinations',
      path: '/clients',
      icon: <Building2 size={18} />,
      color: 'bg-blue-50 text-blue-600 border-blue-100',
    },
    {
      label: 'Vendors',
      desc: 'Raw material suppliers & sources',
      path: '/vendors',
      icon: <Factory size={18} />,
      color: 'bg-amber-50 text-amber-600 border-amber-100',
    },
    {
      label: 'Shelf Locations',
      desc: 'Warehouse zone & shelf master',
      path: '/shelf-locations',
      icon: <Warehouse size={18} />,
      color: 'bg-emerald-50 text-emerald-600 border-emerald-100',
    },
    {
      label: 'Masters Config',
      desc: 'Grades & bag quantities',
      path: '/masters',
      icon: <SlidersHorizontal size={18} />,
      color: 'bg-purple-50 text-purple-600 border-purple-100',
    },
    {
      label: 'User Accounts',
      desc: 'QC & Dispatch personnel',
      path: '/users',
      icon: <Users size={18} />,
      color: 'bg-slate-50 text-slate-600 border-slate-200',
    },
    {
      label: 'QR Labels',
      desc: 'Print & reprint unit tags',
      path: '/qc/qr-codes',
      icon: <QrCode size={18} />,
      color: 'bg-teal-50 text-teal-600 border-teal-100',
    },
  ];

  return (
    <div className="space-y-6">
      {/* 1. HERO HEADER */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 pb-2 border-b border-slate-200">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-extrabold text-slate-900 tracking-tight">
              Admin Overview
            </h1>
            <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-brand-50 text-brand-700 border border-brand-200">
              Live Control
            </span>
          </div>
          <p className="text-sm text-slate-500 mt-1">
            Welcome back, <span className="font-semibold text-slate-700">{user?.name}</span>. Real-time overview of inventory, QC compliance, and dispatch progress.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <Link
            to="/loading-monitor"
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 transition-colors shadow-2xs"
          >
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span>Live Loading Monitor</span>
          </Link>

          <Link
            to="/reports"
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold bg-brand-600 text-white hover:bg-brand-700 transition-colors shadow-xs"
          >
            <FileBarChart size={15} />
            <span>Reports &amp; Logs</span>
          </Link>
        </div>
      </div>

      {/* 2. CORE 4 KPI CARDS */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Products in Catalog */}
        <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-xs relative overflow-hidden group hover:border-brand-300 transition-colors">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">
              Catalog Products
            </span>
            <div className="w-9 h-9 rounded-xl bg-brand-50 text-brand-600 flex items-center justify-center transition-transform group-hover:scale-110">
              <Package size={20} />
            </div>
          </div>
          <div className="mt-3">
            <div className="text-2xl font-black text-slate-900">{s.totalProducts}</div>
            <div className="text-xs text-slate-500 mt-1 flex items-center gap-1">
              <span className="font-semibold text-slate-700">{s.totalBatches} lots</span> across storage
            </div>
          </div>
        </div>

        {/* Inventory Valuation */}
        <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-xs relative overflow-hidden group hover:border-emerald-300 transition-colors">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">
              Inventory Valuation
            </span>
            <div className="w-9 h-9 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center transition-transform group-hover:scale-110">
              <IndianRupee size={20} />
            </div>
          </div>
          <div className="mt-3">
            <div className="text-2xl font-black text-slate-900">
              ₹{Number(s.inventoryValue).toLocaleString('en-IN')}
            </div>
            <div className="text-xs text-slate-500 mt-1 flex items-center gap-1 truncate">
              <span className="text-emerald-600 font-semibold">Live valuation</span> of finished goods
            </div>
          </div>
        </div>

        {/* QC Auto-Pass Lots */}
        <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-xs relative overflow-hidden group hover:border-teal-300 transition-colors">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">
              QC Passes
            </span>
            <div className="w-9 h-9 rounded-xl bg-teal-50 text-teal-600 flex items-center justify-center transition-transform group-hover:scale-110">
              <CheckCircle2 size={20} />
            </div>
          </div>
          <div className="mt-3">
            <div className="text-2xl font-black text-slate-900">{s.qcPassed}</div>
            <div className="text-xs text-slate-500 mt-1 flex items-center gap-1">
              <span className="font-semibold text-teal-700">{s.qcPassRate}% pass rate</span> across recorded QC checks
            </div>
          </div>
        </div>

        {/* Dispatch Pipeline */}
        <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-xs relative overflow-hidden group hover:border-amber-300 transition-colors">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">
              Dispatch Pipeline
            </span>
            <div className="w-9 h-9 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center transition-transform group-hover:scale-110">
              <Truck size={20} />
            </div>
          </div>
          <div className="mt-3">
            <div className="text-2xl font-black text-slate-900">{s.pendingRequests} Pending</div>
            <div className="text-xs text-slate-500 mt-1 flex items-center gap-1">
              <span className="font-semibold text-slate-700">{s.dispatchedToday} loads</span> dispatched today
            </div>
          </div>
        </div>
      </div>

      {/* 3. LIVE LOADING SPOTLIGHT WIDGET (SRS v2.0 Live Loading Preview) */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-3 border-b border-slate-100">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center">
              <Radio size={16} className="animate-pulse" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-slate-900 tracking-tight flex items-center gap-2">
                Live Loading Sessions
                <span className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-emerald-100 text-emerald-800">
                  {activeSessions.length} Active
                </span>
              </h2>
              <p className="text-xs text-slate-500">
                Real-time scan counter visible to admins during truck loading (Refreshed live)
              </p>
            </div>
          </div>

          <Link
            to="/loading-monitor"
            className="text-xs font-bold text-brand-600 hover:text-brand-700 inline-flex items-center gap-1"
          >
            Open Dedicated Monitor <ExternalLink size={13} />
          </Link>
        </div>

        {activeSessions.length === 0 ? (
          <div className="py-6 flex flex-col items-center justify-center text-center">
            <div className="w-10 h-10 rounded-full bg-slate-100 text-slate-400 flex items-center justify-center mb-2">
              <Truck size={20} />
            </div>
            <p className="text-xs font-semibold text-slate-700">Loading dock currently idle</p>
            <p className="text-[11px] text-slate-400 mt-0.5">
              When a dispatch user starts scanning an approved order, the live scanned/total counter will appear here.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5 mt-3.5">
            {activeSessions.map((session) => {
              const scanned = Number(session.scanned || 0);
              const total = Number(session.total || 1);
              const pct = Math.min(100, Math.round((scanned / total) * 100));

              return (
                <div
                  key={session.id || session.session_id}
                  className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 relative overflow-hidden"
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="text-sm font-bold text-slate-900">{session.product_name || 'Product'}</div>
                      <div className="text-xs text-slate-500 mt-0.5">
                        Batch: <span className="font-mono font-medium text-slate-700">{session.batch_number}</span> · Order #{session.order_id || session.dispatch_order_id}
                      </div>
                      <div className="text-[11px] text-slate-400 mt-0.5">
                        Loader: {session.loader_name || 'Dispatch Team'}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-xl font-extrabold text-brand-600 font-mono">
                        {scanned} / {total}
                      </div>
                      <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wide">
                        Units Loaded ({pct}%)
                      </div>
                    </div>
                  </div>

                  <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-slate-200">
                    <div
                      className="h-full rounded-full bg-brand-600 transition-all duration-300"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 4. SIMPLIFIED TABBED OPERATIONS & ACTIVITY CENTER */}
      <div className="rounded-2xl border border-slate-200 bg-white shadow-xs overflow-hidden">
        {/* Tab Controls Header */}
        <div className="p-4 sm:p-5 border-b border-slate-100 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0 scrollbar-none">
            <button
              onClick={() => {
                setActiveTab('dispatch_queue');
                setTableSearch('');
              }}
              className={`px-3.5 py-2 rounded-xl text-xs font-bold transition-colors whitespace-nowrap flex items-center gap-2 ${
                activeTab === 'dispatch_queue'
                  ? 'bg-brand-600 text-white shadow-2xs'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
              }`}
            >
              <ClipboardList size={15} />
              <span>Dispatch Queue</span>
              <span
                className={`text-[10px] px-1.5 py-0.2 rounded-full font-bold ${
                  activeTab === 'dispatch_queue' ? 'bg-white/20 text-white' : 'bg-slate-200 text-slate-700'
                }`}
              >
                {data.pendingRequests.length}
              </span>
            </button>

            <button
              onClick={() => {
                setActiveTab('dispatches');
                setTableSearch('');
              }}
              className={`px-3.5 py-2 rounded-xl text-xs font-bold transition-colors whitespace-nowrap flex items-center gap-2 ${
                activeTab === 'dispatches'
                  ? 'bg-brand-600 text-white shadow-2xs'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
              }`}
            >
              <Truck size={15} />
              <span>Dispatches</span>
              <span
                className={`text-[10px] px-1.5 py-0.2 rounded-full font-bold ${
                  activeTab === 'dispatches' ? 'bg-white/20 text-white' : 'bg-slate-200 text-slate-700'
                }`}
              >
                {data.recentDispatches.length}
              </span>
            </button>

            <button
              onClick={() => {
                setActiveTab('qc_records');
                setTableSearch('');
              }}
              className={`px-3.5 py-2 rounded-xl text-xs font-bold transition-colors whitespace-nowrap flex items-center gap-2 ${
                activeTab === 'qc_records'
                  ? 'bg-brand-600 text-white shadow-2xs'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
              }`}
            >
              <ShieldCheck size={15} />
              <span>QC Passed Batches</span>
              <span
                className={`text-[10px] px-1.5 py-0.2 rounded-full font-bold ${
                  activeTab === 'qc_records' ? 'bg-white/20 text-white' : 'bg-slate-200 text-slate-700'
                }`}
              >
                {data.recentQc.length}
              </span>
            </button>

            <button
              onClick={() => {
                setActiveTab('activity');
                setTableSearch('');
              }}
              className={`px-3.5 py-2 rounded-xl text-xs font-bold transition-colors whitespace-nowrap flex items-center gap-2 ${
                activeTab === 'activity'
                  ? 'bg-brand-600 text-white shadow-2xs'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
              }`}
            >
              <TrendingUp size={15} />
              <span>Audit Activity</span>
              <span
                className={`text-[10px] px-1.5 py-0.2 rounded-full font-bold ${
                  activeTab === 'activity' ? 'bg-white/20 text-white' : 'bg-slate-200 text-slate-700'
                }`}
              >
                {data.recentActivity.length}
              </span>
            </button>
          </div>

          {/* Search box for table */}
          <div className="relative min-w-[200px] sm:w-64">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={tableSearch}
              onChange={(e) => setTableSearch(e.target.value)}
              placeholder="Filter current view..."
              className="w-full pl-8 pr-3 py-1.5 text-xs rounded-xl border border-slate-200 bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-500 text-slate-800 placeholder-slate-400 transition-all"
            />
          </div>
        </div>

        {/* Tab Content Display */}
        <div className="overflow-x-auto">
          {activeTab === 'dispatch_queue' && (
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 uppercase tracking-wider font-semibold">
                <tr>
                  <th className="px-5 py-3">Product Name</th>
                  <th className="px-5 py-3">Batch Number</th>
                  <th className="px-5 py-3">Raised By</th>
                  <th className="px-5 py-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredQueue.map((r: any) => (
                  <tr key={r.id} className="hover:bg-slate-50/70 transition-colors">
                    <td className="px-5 py-3">
                      <div className="font-semibold text-slate-900">{r.product_name}</div>
                      <div className="text-[11px] text-slate-400">{r.product_sku || 'SKU N/A'}</div>
                    </td>
                    <td className="px-5 py-3">
                      <span className="font-mono font-medium px-2 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-200">
                        {r.batch_number}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-slate-600">{r.raised_by_name || 'Dispatch Team'}</td>
                    <td className="px-5 py-3">
                      <span
                        className={`inline-block px-2.5 py-0.5 rounded-full text-[10.5px] font-bold border ${
                          statusBadge[r.status] || 'bg-slate-100 text-slate-700 border-slate-200'
                        }`}
                      >
                        {statusLabel[r.status] || r.status}
                      </span>
                    </td>
                  </tr>
                ))}
                {filteredQueue.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-5 py-8 text-center text-slate-400">
                      No dispatch orders found matching your filter.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}

          {activeTab === 'dispatches' && (
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 uppercase tracking-wider font-semibold">
                <tr>
                  <th className="px-5 py-3">Product</th>
                  <th className="px-5 py-3">Batch Number</th>
                  <th className="px-5 py-3">Dispatched At</th>
                  <th className="px-5 py-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredDispatches.map((r: any) => (
                  <tr key={r.id} className="hover:bg-slate-50/70 transition-colors">
                    <td className="px-5 py-3">
                      <div className="font-semibold text-slate-900">{r.product_name}</div>
                      <div className="text-[11px] text-slate-400">{r.product_sku || 'SKU N/A'}</div>
                    </td>
                    <td className="px-5 py-3">
                      <span className="font-mono font-medium px-2 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-200">
                        {r.batch_number}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-slate-500">
                      {new Date(r.created_at).toLocaleString()}
                    </td>
                    <td className="px-5 py-3">
                      <span className="px-2.5 py-0.5 rounded-full text-[10.5px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                        Dispatched
                      </span>
                    </td>
                  </tr>
                ))}
                {filteredDispatches.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-5 py-8 text-center text-slate-400">
                      No completed dispatches recorded yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}

          {activeTab === 'qc_records' && (
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 uppercase tracking-wider font-semibold">
                <tr>
                  <th className="px-5 py-3">Product</th>
                  <th className="px-5 py-3">Batch Lot</th>
                  <th className="px-5 py-3">Inspection Standard</th>
                  <th className="px-5 py-3">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredQc.map((r: any) => (
                  <tr key={r.id} className="hover:bg-slate-50/70 transition-colors">
                    <td className="px-5 py-3">
                      <div className="font-semibold text-slate-900">{r.product_name}</div>
                      <div className="text-[11px] text-slate-400">{r.product_sku || 'SKU N/A'}</div>
                    </td>
                    <td className="px-5 py-3">
                      <span className="font-mono font-medium px-2 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-200">
                        {r.batch_number}
                      </span>
                    </td>
                    <td className="px-5 py-3">
                      <span className="px-2.5 py-0.5 rounded-full text-[10.5px] font-bold bg-teal-50 text-teal-700 border border-teal-200">
                        Auto-Pass (SRS v2.0)
                      </span>
                    </td>
                    <td className="px-5 py-3 text-slate-500">
                      {new Date(r.created_at).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
                {filteredQc.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-5 py-8 text-center text-slate-400">
                      No QC batches recorded yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}

          {activeTab === 'activity' && (
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 uppercase tracking-wider font-semibold">
                <tr>
                  <th className="px-5 py-3">Timestamp</th>
                  <th className="px-5 py-3">Action</th>
                  <th className="px-5 py-3">Description</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredActivity.map((log: any) => (
                  <tr key={log.id} className="hover:bg-slate-50/70 transition-colors">
                    <td className="px-5 py-3 text-slate-400 whitespace-nowrap">
                      {new Date(log.created_at).toLocaleString()}
                    </td>
                    <td className="px-5 py-3">
                      <span className="font-mono text-[11px] font-semibold px-2 py-0.5 rounded bg-slate-100 text-slate-700">
                        {log.action}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-slate-600 max-w-md truncate">
                      {log.description || '-'}
                    </td>
                  </tr>
                ))}
                {filteredActivity.length === 0 && (
                  <tr>
                    <td colSpan={3} className="px-5 py-8 text-center text-slate-400">
                      No recent activity recorded yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>

        {/* Tab Footer */}
        <div className="p-3 bg-slate-50/80 border-t border-slate-100 flex items-center justify-between">
          <span className="text-[11px] text-slate-400">
            Showing latest entries · Live database ledger
          </span>
          <Link
            to="/reports"
            className="text-xs font-bold text-brand-600 hover:text-brand-700 inline-flex items-center gap-1"
          >
            <span>Open Comprehensive Reports</span>
            <ArrowRight size={13} />
          </Link>
        </div>
      </div>

      {/* 5. STREAMLINED QUICK ACTIONS DOCK (Unique Icons for each) */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
        <div className="flex items-center justify-between mb-3.5">
          <div>
            <h2 className="text-sm font-bold text-slate-900 tracking-tight">Quick Shortcuts</h2>
            <p className="text-xs text-slate-500">Fast access to key management modules</p>
          </div>
          <span className="text-xs text-slate-400">8 modules</span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
          {quickActions.map((action) => (
            <Link
              key={action.label}
              to={action.path}
              className="flex flex-col items-center text-center p-3 rounded-xl border border-slate-200 hover:border-brand-300 hover:bg-brand-50/30 transition-all group shadow-2xs"
            >
              <div
                className={`w-10 h-10 rounded-xl ${action.color} border flex items-center justify-center transition-transform group-hover:scale-110`}
              >
                {action.icon}
              </div>
              <span className="text-xs font-bold text-slate-800 mt-2 group-hover:text-brand-600 truncate w-full">
                {action.label}
              </span>
              <span className="text-[10px] text-slate-400 mt-0.5 line-clamp-1 w-full">
                {action.desc}
              </span>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
