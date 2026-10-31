import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { api } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { AdminStats } from '../types';
import {
  Package,
  Boxes,
  Truck,
  CheckCircle2,
  Clock,
  ArrowRight,
  Radio,
  FileText,
  Activity,
  AlertCircle,
  RefreshCw,
} from 'lucide-react';

const statusBadge: Record<string, { bg: string; text: string; label: string }> = {
  PENDING: { bg: 'bg-amber-100 border-amber-300 text-amber-900', text: 'text-amber-800', label: 'Pending Approval' },
  APPROVED: { bg: 'bg-blue-100 border-blue-300 text-blue-900', text: 'text-blue-800', label: 'Ready for Loading' },
  DISPATCH_APPROVED: { bg: 'bg-blue-100 border-blue-300 text-blue-900', text: 'text-blue-800', label: 'Ready for Loading' },
  LOADING: { bg: 'bg-indigo-100 border-indigo-300 text-indigo-900', text: 'text-indigo-800', label: 'Currently Loading' },
  DISPATCHED: { bg: 'bg-emerald-100 border-emerald-300 text-emerald-900', text: 'text-emerald-800', label: 'Dispatched (Completed)' },
  CLOSED_DISPATCHED: { bg: 'bg-emerald-100 border-emerald-300 text-emerald-900', text: 'text-emerald-800', label: 'Dispatched (Completed)' },
  REJECTED: { bg: 'bg-rose-100 border-rose-300 text-rose-900', text: 'text-rose-800', label: 'Rejected' },
  CLOSED_NOT_DISPATCHED: { bg: 'bg-slate-100 border-slate-300 text-slate-800', text: 'text-slate-700', label: 'Cancelled' },
  NOT_DISPATCHED: { bg: 'bg-slate-100 border-slate-300 text-slate-800', text: 'text-slate-700', label: 'Not Dispatched' },
};

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good Morning';
  if (hour < 17) return 'Good Afternoon';
  return 'Good Evening';
}

function getFormattedDate(): string {
  return new Intl.DateTimeFormat('en-IN', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date());
}

export default function Dashboard() {
  const { user } = useAuth();
  const location = useLocation();
  const logoUploadNotice = (location.state as { logoUploadError?: string } | null)?.logoUploadError;
  const [data, setData] = useState<{
    stats: AdminStats;
    recentQc: any[];
    recentDispatches: any[];
    pendingRequests: any[];
    recentActivity: any[];
  } | null>(null);
  const [activeSessions, setActiveSessions] = useState<any[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const loadData = async () => {
    setError('');
    try {
      const [dashRes, sessionsRes] = await Promise.allSettled([
        api.dashboard.admin(),
        api.loadingSessions.active(),
      ]);

      if (dashRes.status === 'fulfilled') {
        setData(dashRes.value);
      } else {
        setError(dashRes.reason?.message || 'Could not connect to database');
      }

      if (sessionsRes.status === 'fulfilled' && Array.isArray(sessionsRes.value)) {
        setActiveSessions(sessionsRes.value);
      }
    } catch (err: any) {
      setError(err.message || 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, []);

  // Poll active loading sessions every 6 seconds so truck progress updates live
  useEffect(() => {
    let active = true;
    const interval = window.setInterval(async () => {
      try {
        const sessions = await api.loadingSessions.active();
        if (active && Array.isArray(sessions)) setActiveSessions(sessions);
      } catch {
        // Keep previous state on temporary network hiccups
      }
    }, 6000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, []);

  if (loading) {
    return (
      <div className="py-20 flex flex-col items-center justify-center">
        <div className="w-12 h-12 rounded-2xl bg-brand-600 flex items-center justify-center text-white text-xl font-bold animate-pulse shadow-md">
          A
        </div>
        <p className="mt-4 text-base font-medium text-slate-600">Loading factory dashboard...</p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="p-6 max-w-2xl mx-auto rounded-2xl bg-rose-50 border-2 border-rose-200 text-rose-900 mt-6">
        <div className="flex items-center gap-3">
          <AlertCircle size={24} className="text-rose-600 shrink-0" />
          <div>
            <h2 className="text-lg font-bold">Could not load dashboard information</h2>
            <p className="text-sm text-rose-700 mt-1">{error || 'Unable to fetch data from the server.'}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => {
            setLoading(true);
            void loadData();
          }}
          className="mt-4 inline-flex items-center gap-2 px-4 py-2 bg-rose-600 text-white font-semibold text-sm rounded-xl hover:bg-rose-700 transition-colors shadow-xs"
        >
          <RefreshCw size={16} /> Try Loading Again
        </button>
      </div>
    );
  }

  const s = data.stats;
  const greeting = getGreeting();
  const todayDate = getFormattedDate();
  const pendingOrders = data.pendingRequests || [];
  const recentLogs = (data.recentActivity || []).slice(0, 6);

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {logoUploadNotice && <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800" role="status">Your workspace was created, but the logo could not be saved ({logoUploadNotice}). You can upload it later in <Link to="/settings" className="font-semibold underline">Settings</Link>.</div>}
      {/* 1. WELCOME HEADER (Big, friendly, clear date) */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5 sm:p-6 shadow-xs flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
              {greeting}, {user?.name || 'Administrator'}
            </h1>
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800 border border-emerald-300">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              System Active
            </span>
          </div>
          <p className="text-base text-slate-600 mt-1 font-medium">
            Today is <span className="text-slate-900 font-semibold">{todayDate}</span>. Here is your daily factory summary:
          </p>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <Link
            to="/loading-monitor"
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold bg-emerald-600 text-white hover:bg-emerald-700 transition-colors shadow-sm"
          >
            <Radio size={18} className="animate-pulse" />
            <span>Live Truck Loading</span>
          </Link>

          <Link
            to="/dispatch-orders"
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold bg-slate-800 text-white hover:bg-slate-900 transition-colors shadow-sm"
          >
            <FileText size={18} />
            <span>Dispatch Orders</span>
          </Link>
        </div>
      </div>

      {/* 2. CORE 4 METRICS CARDS (Large text, easy to read with glasses, high contrast) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-5">
        {/* Card 1: Total Products */}
        <Link
          to="/products"
          className="bg-white rounded-2xl border-2 border-slate-200 p-5 shadow-xs hover:border-brand-500 hover:shadow-md transition-all group flex flex-col justify-between"
        >
          <div>
            <div className="flex items-center justify-between">
              <span className="text-sm font-bold text-slate-600 uppercase tracking-wide">
                Products
              </span>
              <div className="w-11 h-11 rounded-xl bg-blue-100 text-blue-700 flex items-center justify-center group-hover:scale-105 transition-transform">
                <Package size={22} />
              </div>
            </div>
            <div className="mt-3">
              <div className="text-3xl sm:text-4xl font-extrabold text-slate-900">
                {s.totalProducts}
              </div>
              <p className="text-sm text-slate-500 mt-1 font-medium">
                Registered in catalogue
              </p>
            </div>
          </div>
          <div className="mt-4 pt-3 border-t border-slate-100 flex items-center text-sm font-bold text-brand-600 group-hover:text-brand-700">
            <span>Manage Products</span>
            <ArrowRight size={16} className="ml-1 group-hover:translate-x-1 transition-transform" />
          </div>
        </Link>

        {/* Card 2: Batches in Stock */}
        <Link
          to="/batches"
          className="bg-white rounded-2xl border-2 border-slate-200 p-5 shadow-xs hover:border-emerald-500 hover:shadow-md transition-all group flex flex-col justify-between"
        >
          <div>
            <div className="flex items-center justify-between">
              <span className="text-sm font-bold text-slate-600 uppercase tracking-wide">
                Batches in Stock
              </span>
              <div className="w-11 h-11 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center group-hover:scale-105 transition-transform">
                <Boxes size={22} />
              </div>
            </div>
            <div className="mt-3">
              <div className="text-3xl sm:text-4xl font-extrabold text-slate-900">
                {s.totalBatches}
              </div>
              <p className="text-sm text-slate-500 mt-1 font-medium">
                Ready lots in warehouse
              </p>
            </div>
          </div>
          <div className="mt-4 pt-3 border-t border-slate-100 flex items-center text-sm font-bold text-emerald-700 group-hover:text-emerald-800">
            <span>View All Batches</span>
            <ArrowRight size={16} className="ml-1 group-hover:translate-x-1 transition-transform" />
          </div>
        </Link>

        {/* Card 3: Pending Dispatches */}
        <Link
          to="/dispatch-orders"
          className={`bg-white rounded-2xl border-2 p-5 shadow-xs hover:shadow-md transition-all group flex flex-col justify-between ${
            s.pendingRequests > 0
              ? 'border-amber-300 bg-amber-50/20'
              : 'border-slate-200'
          }`}
        >
          <div>
            <div className="flex items-center justify-between">
              <span className="text-sm font-bold text-slate-600 uppercase tracking-wide">
                Dispatch Orders
              </span>
              <div className={`w-11 h-11 rounded-xl flex items-center justify-center group-hover:scale-105 transition-transform ${
                s.pendingRequests > 0 ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-700'
              }`}>
                <Truck size={22} />
              </div>
            </div>
            <div className="mt-3">
              <div className="text-3xl sm:text-4xl font-extrabold text-slate-900 flex items-center gap-2">
                <span>{s.pendingRequests}</span>
                {s.pendingRequests > 0 ? (
                  <span className="text-xs font-bold px-2 py-0.5 rounded-md bg-amber-200 text-amber-900">
                    Needs Action
                  </span>
                ) : (
                  <span className="text-xs font-bold px-2 py-0.5 rounded-md bg-emerald-100 text-emerald-800">
                    All Clear
                  </span>
                )}
              </div>
              <p className="text-sm text-slate-500 mt-1 font-medium">
                {s.pendingRequests > 0 ? 'Orders waiting for processing' : 'No orders pending'}
              </p>
            </div>
          </div>
          <div className="mt-4 pt-3 border-t border-slate-100 flex items-center text-sm font-bold text-slate-800 group-hover:text-slate-900">
            <span>Open Orders</span>
            <ArrowRight size={16} className="ml-1 group-hover:translate-x-1 transition-transform" />
          </div>
        </Link>

        {/* Card 4: Quality Check (QC) Passes */}
        <Link
          to="/reports?tab=qc"
          className="bg-white rounded-2xl border-2 border-slate-200 p-5 shadow-xs hover:border-teal-500 hover:shadow-md transition-all group flex flex-col justify-between"
        >
          <div>
            <div className="flex items-center justify-between">
              <span className="text-sm font-bold text-slate-600 uppercase tracking-wide">
                QC Compliance
              </span>
              <div className="w-11 h-11 rounded-xl bg-teal-100 text-teal-700 flex items-center justify-center group-hover:scale-105 transition-transform">
                <CheckCircle2 size={22} />
              </div>
            </div>
            <div className="mt-3">
              <div className="text-3xl sm:text-4xl font-extrabold text-slate-900">
                {s.qcPassRate}%
              </div>
              <p className="text-sm text-slate-500 mt-1 font-medium">
                {s.qcPassed} batches passed inspection
              </p>
            </div>
          </div>
          <div className="mt-4 pt-3 border-t border-slate-100 flex items-center text-sm font-bold text-teal-700 group-hover:text-teal-800">
            <span>View QC Reports</span>
            <ArrowRight size={16} className="ml-1 group-hover:translate-x-1 transition-transform" />
          </div>
        </Link>
      </div>

      {/* 3. LIVE TRUCK LOADING STATUS (Very prominent & clear) */}
      <div className="bg-white rounded-2xl border-2 border-slate-200 p-5 sm:p-6 shadow-xs">
        <div className="flex items-center justify-between pb-4 border-b border-slate-100">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-100 text-emerald-800 flex items-center justify-center">
              <Radio size={20} className="animate-pulse" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-900">
                Loading Dock Status
              </h2>
              <p className="text-sm text-slate-500">
                Real-time scanning counter as workers load bags into trucks
              </p>
            </div>
          </div>

          <Link
            to="/loading-monitor"
            className="inline-flex items-center gap-1.5 text-sm font-bold text-brand-600 hover:text-brand-800 bg-brand-50 px-3.5 py-1.5 rounded-xl border border-brand-200 transition-colors"
          >
            <span>Full Screen Monitor</span>
            <ArrowRight size={16} />
          </Link>
        </div>

        {activeSessions.length === 0 ? (
          <div className="py-8 flex flex-col items-center justify-center text-center">
            <div className="w-12 h-12 rounded-full bg-slate-100 text-slate-400 flex items-center justify-center mb-2">
              <Truck size={24} />
            </div>
            <p className="text-base font-bold text-slate-800">No trucks currently loading at the dock</p>
            <p className="text-sm text-slate-500 mt-1 max-w-md">
              When the dispatch team begins scanning an approved order, the live counter and progress bar will automatically appear here.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
            {activeSessions.map((session) => {
              const scanned = Number(session.scanned || 0);
              const total = Number(session.total || 1);
              const pct = Math.min(100, Math.round((scanned / total) * 100));

              return (
                <div
                  key={session.id || session.session_id}
                  className="rounded-xl border-2 border-emerald-200 bg-emerald-50/40 p-4 relative"
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="text-base font-bold text-slate-900">
                        {session.product_name || 'Product'}
                      </div>
                      <div className="text-sm text-slate-600 mt-0.5">
                        Batch No: <span className="font-mono font-bold text-slate-800">{session.batch_number}</span>
                      </div>
                      <div className="text-xs text-slate-500 mt-1">
                        Loader: <span className="font-semibold">{session.loader_name || 'Dispatch Worker'}</span>
                      </div>
                    </div>

                    <div className="text-right">
                      <div className="text-2xl font-black text-emerald-800 font-mono">
                        {scanned} / {total}
                      </div>
                      <div className="text-xs font-bold text-emerald-700 uppercase">
                        Bags Loaded ({pct}%)
                      </div>
                    </div>
                  </div>

                  {/* Progress Bar */}
                  <div className="mt-3.5 h-3.5 w-full overflow-hidden rounded-full bg-slate-200">
                    <div
                      className="h-full rounded-full bg-emerald-600 transition-all duration-300"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 4. TWO MAIN SECTIONS: PENDING ORDERS & RECENT ACTIVITY */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left 2 Cols: Latest Dispatch Orders */}
        <div className="lg:col-span-2 bg-white rounded-2xl border-2 border-slate-200 p-5 sm:p-6 shadow-xs flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between pb-4 border-b border-slate-100">
              <div className="flex items-center gap-2.5">
                <Truck size={20} className="text-slate-700" />
                <h2 className="text-lg font-bold text-slate-900">
                  Recent Dispatch Orders
                </h2>
              </div>
              <span className="text-xs font-semibold text-slate-500 bg-slate-100 px-2.5 py-1 rounded-lg">
                {pendingOrders.length} Recent
              </span>
            </div>

            {pendingOrders.length === 0 ? (
              <div className="py-12 text-center text-slate-500 text-sm">
                No recent dispatch orders recorded.
              </div>
            ) : (
              <div className="divide-y divide-slate-100 mt-2">
                {pendingOrders.slice(0, 5).map((order: any) => {
                  const badge = statusBadge[order.status] || {
                    bg: 'bg-slate-100 border-slate-200 text-slate-700',
                    label: order.status || 'Unknown',
                  };

                  return (
                    <div
                      key={order.id}
                      className="py-3.5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 hover:bg-slate-50 px-2 rounded-xl transition-colors"
                    >
                      <div>
                        <div className="text-base font-bold text-slate-900">
                          {order.product_name}
                        </div>
                        <div className="text-sm text-slate-500 flex items-center gap-2 mt-0.5">
                          <span>Batch: <span className="font-mono font-semibold text-slate-700">{order.batch_number}</span></span>
                          <span>•</span>
                          <span>By: <span className="text-slate-700 font-medium">{order.raised_by_name || 'Staff'}</span></span>
                        </div>
                      </div>

                      <div className="flex items-center gap-3">
                        <span className={`px-3 py-1 rounded-full text-xs font-bold border ${badge.bg}`}>
                          {badge.label}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="pt-4 mt-2 border-t border-slate-100">
            <Link
              to="/dispatch-orders"
              className="w-full inline-flex items-center justify-center gap-2 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold text-sm rounded-xl transition-colors"
            >
              <span>View All Dispatch Orders</span>
              <ArrowRight size={16} />
            </Link>
          </div>
        </div>

        {/* Right 1 Col: Recent Factory Activity */}
        <div className="bg-white rounded-2xl border-2 border-slate-200 p-5 sm:p-6 shadow-xs flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between pb-4 border-b border-slate-100">
              <div className="flex items-center gap-2.5">
                <Activity size={20} className="text-slate-700" />
                <h2 className="text-lg font-bold text-slate-900">
                  Recent Activity
                </h2>
              </div>
              <Clock size={16} className="text-slate-400" />
            </div>

            {recentLogs.length === 0 ? (
              <div className="py-12 text-center text-slate-500 text-sm">
                No recent activity recorded yet.
              </div>
            ) : (
              <div className="space-y-4 mt-4">
                {recentLogs.map((log: any) => (
                  <div key={log.id} className="flex items-start gap-3 text-sm">
                    <span className="w-2.5 h-2.5 rounded-full bg-brand-500 mt-1.5 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-slate-900 leading-snug">
                        {log.description || log.action}
                      </p>
                      <div className="flex items-center gap-2 text-xs text-slate-400 mt-0.5">
                        <span className="font-medium text-slate-600">{log.user_name || 'System'}</span>
                        <span>•</span>
                        <span>
                          {log.created_at
                            ? new Date(log.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                            : 'Just now'}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="pt-4 mt-4 border-t border-slate-100">
            <Link
              to="/reports?tab=activity"
              className="w-full inline-flex items-center justify-center gap-2 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold text-sm rounded-xl transition-colors"
            >
              <span>View Audit Logs</span>
              <ArrowRight size={16} />
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
