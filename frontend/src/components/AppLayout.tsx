import { useAuth } from '../contexts/AuthContext';
import { useNavigate, useLocation, Link, Outlet } from 'react-router-dom';
import { useEffect, useState } from 'react';
import {
  LayoutDashboard,
  Package,
  Boxes,
  Warehouse,
  Building2,
  Factory,
  Users,
  BarChart3,
  Camera,
  ClipboardList,
  FileText,
  FileBarChart,
  LogOut,
  ChevronLeft,
  ChevronRight,
  UserCircle,
  Menu,
  X,
  Wifi,
  WifiOff,
  QrCode,
  SlidersHorizontal,
  Activity,
  Sparkles,
} from 'lucide-react';

type NavItem = {
  label: string;
  path: string;
  icon: React.ReactNode;
  roles: string[];
  badge?: string;
};

const navSections: { title: string; items: NavItem[] }[] = [
  {
    title: 'Workspace',
    items: [
      { label: 'Dashboard', path: '/', icon: <LayoutDashboard size={18} />, roles: ['ADMIN'] },
      {
        label: 'Live Loading Monitor',
        path: '/loading-monitor',
        icon: <Activity size={18} />,
        roles: ['ADMIN', 'QC'],
        badge: 'LIVE',
      },
      { label: 'Reports & Audit', path: '/reports', icon: <FileBarChart size={18} />, roles: ['ADMIN'] },
    ],
  },
  {
    title: 'Master Catalog',
    items: [
      { label: 'Products', path: '/products', icon: <Package size={18} />, roles: ['ADMIN', 'QC'] },
      { label: 'Batches', path: '/batches', icon: <Boxes size={18} />, roles: ['ADMIN', 'QC'] },
      { label: 'Clients', path: '/clients', icon: <Building2 size={18} />, roles: ['ADMIN'] },
      { label: 'Vendors', path: '/vendors', icon: <Factory size={18} />, roles: ['ADMIN'] },
      { label: 'Shelf Locations', path: '/shelf-locations', icon: <Warehouse size={18} />, roles: ['ADMIN'] },
      { label: 'Masters', path: '/masters', icon: <SlidersHorizontal size={18} />, roles: ['ADMIN'] },
    ],
  },
  {
    title: 'Logistics & Tracking',
    items: [
      { label: 'QC Dashboard', path: '/qc-dashboard', icon: <BarChart3 size={18} />, roles: ['QC'] },
      { label: 'Dispatch Dashboard', path: '/dispatch-dashboard', icon: <BarChart3 size={18} />, roles: ['DISPATCH'] },
      { label: 'Loading & Scan', path: '/dispatch', icon: <Camera size={18} />, roles: ['DISPATCH'] },
      { label: 'Dispatch Orders', path: '/dispatch-orders', icon: <ClipboardList size={18} />, roles: ['ADMIN', 'QC', 'DISPATCH'] },
      { label: 'Packing Lists', path: '/packing-list', icon: <FileText size={18} />, roles: ['ADMIN', 'QC', 'DISPATCH'] },
      { label: 'QR Labels', path: '/qc/qr-codes', icon: <QrCode size={18} />, roles: ['ADMIN', 'QC'] },
    ],
  },
  {
    title: 'Administration',
    items: [
      { label: 'User Accounts', path: '/users', icon: <Users size={18} />, roles: ['ADMIN'] },
      { label: 'My Settings', path: '/settings', icon: <UserCircle size={18} />, roles: ['ADMIN', 'QC', 'DISPATCH'] },
    ],
  },
];

export function AppLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);

  useEffect(() => {
    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  if (!user) return <Outlet />;

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const isActive = (path: string) => {
    if (path === '/' || path === '/qc' || path === '/dispatch') return location.pathname === path;
    return location.pathname === path || location.pathname.startsWith(`${path}/`);
  };

  const filteredSections = navSections
    .map((s) => ({ ...s, items: s.items.filter((item) => item.roles.includes(user.role)) }))
    .filter((s) => s.items.length > 0);

  const currentPageLabel =
    navSections
      .flatMap((s) => s.items)
      .find((i) => isActive(i.path))?.label || 'Dashboard';

  const sidebar = (
    <>
      {/* Brand Header */}
      <div className="flex items-center gap-3 px-4 h-16 border-b border-white/10 shrink-0 bg-slate-900/60 backdrop-blur-sm">
        {collapsed ? (
          <button
            className="group w-9 h-9 rounded-xl bg-gradient-to-tr from-brand-600 to-indigo-500 flex items-center justify-center text-white font-extrabold text-sm shrink-0 shadow-sm transition-transform hover:scale-105"
            onClick={() => setCollapsed(false)}
            title="Expand sidebar"
          >
            <span className="group-hover:hidden font-mono text-base">A</span>
            <span className="hidden group-hover:block">
              <ChevronRight size={18} />
            </span>
          </button>
        ) : (
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-brand-600 to-indigo-500 flex items-center justify-center text-white font-extrabold text-sm shrink-0 shadow-sm">
              {/* <Sparkles size={18} className="text-white" /> */}
              A
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-white font-bold text-sm tracking-tight flex items-center gap-1.5">
                <span>Aceone</span>
              </div>
              <div className="text-[11px] text-slate-400 truncate">Product Scanning</div>
            </div>
          </div>
        )}

        <button
          className="lg:hidden ml-auto p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
          onClick={() => setMobileOpen(false)}
        >
          <X size={18} />
        </button>

        {!collapsed && (
          <button
            className="hidden lg:flex ml-auto p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
            onClick={() => setCollapsed(true)}
            title="Collapse sidebar"
          >
            <ChevronLeft size={16} />
          </button>
        )}
      </div>

      {/* Nav List */}
      <nav className="flex-1 overflow-y-auto py-4 px-2.5 space-y-5 scrollbar-thin">
        {filteredSections.map((section) => (
          <div key={section.title}>
            {!collapsed && (
              <p className="px-3 mb-1.5 text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                {section.title}
              </p>
            )}
            <div className="space-y-1">
              {section.items.map((item) => {
                const active = isActive(item.path);
                return (
                  <Link
                    key={item.path}
                    to={item.path}
                    onClick={() => setMobileOpen(false)}
                    className={`flex items-center gap-3 px-3 py-2 rounded-xl text-sm font-medium transition-all duration-150 group relative ${
                      active
                        ? 'bg-brand-600 text-white shadow-sm'
                        : 'text-slate-300 hover:text-white hover:bg-white/10'
                    }`}
                    title={collapsed ? item.label : undefined}
                  >
                    <span
                      className={`shrink-0 transition-transform ${
                        active ? 'text-white' : 'text-slate-400 group-hover:text-white group-hover:scale-110'
                      }`}
                    >
                      {item.icon}
                    </span>

                    {!collapsed && (
                      <span className="truncate flex-1">{item.label}</span>
                    )}

                    {!collapsed && item.badge && (
                      <span className="shrink-0 flex items-center gap-1 text-[9.5px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                        {item.badge}
                      </span>
                    )}

                    {collapsed && item.badge && (
                      <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                    )}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* Profile & Logout Footer */}
      <div className="border-t border-white/10 p-3 space-y-1 shrink-0 bg-slate-900/60">
        <div className="flex items-center gap-3 px-2.5 py-2 rounded-xl bg-white/5">
          <div className="w-8 h-8 rounded-full bg-brand-500/30 border border-brand-400/40 flex items-center justify-center shrink-0">
            <span className="text-xs font-bold text-brand-200">
              {user.name ? user.name.slice(0, 2).toUpperCase() : 'AD'}
            </span>
          </div>
          {!collapsed && (
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold text-white truncate">{user.name}</p>
              <div className="flex items-center gap-1.5 mt-0.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                <span className="text-[10px] text-slate-400 font-mono tracking-wide uppercase">
                  {user.role}
                </span>
              </div>
            </div>
          )}
        </div>

        <button
          onClick={handleLogout}
          className="flex items-center gap-3 px-3 py-2 rounded-xl text-xs font-medium text-slate-400 hover:text-rose-300 hover:bg-rose-500/10 transition-colors w-full mt-1"
          title={collapsed ? 'Logout' : undefined}
        >
          <LogOut size={16} className="shrink-0" />
          {!collapsed && <span>Sign Out</span>}
        </button>
      </div>
    </>
  );

  return (
    <div className="min-h-screen w-full bg-slate-50 flex">
      {/* Mobile Backdrop */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-slate-900/60 backdrop-blur-xs lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed top-0 left-0 h-full z-50 bg-[#0F172A] border-r border-slate-800 transition-all duration-300 flex flex-col ${
          collapsed ? 'w-64 lg:w-16' : 'w-64'
        } ${mobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}`}
      >
        {sidebar}
      </aside>

      {/* Main Content Area */}
      <div
        className={`flex min-w-0 flex-1 flex-col transition-all duration-300 ${
          collapsed ? 'lg:ml-16' : 'lg:ml-64'
        }`}
      >
        {/* Top Header */}
        <header className="h-16 flex items-center justify-between px-4 sm:px-6 lg:px-8 bg-white border-b border-slate-200 sticky top-0 z-30 shrink-0">
          <div className="flex items-center gap-3">
            <button
              className="lg:hidden p-2 rounded-lg hover:bg-slate-100 text-slate-600 transition-colors"
              onClick={() => setMobileOpen(true)}
              aria-label="Open sidebar"
            >
              <Menu size={20} />
            </button>
            <div className="flex items-center gap-2">
              <h1 className="text-base font-bold text-slate-800 tracking-tight">
                {currentPageLabel}
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <div
              className={`flex items-center gap-2 px-2.5 py-1 rounded-full text-xs font-medium border ${
                online
                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                  : 'bg-amber-50 text-amber-700 border-amber-200'
              }`}
            >
              <span
                className={`w-2 h-2 rounded-full ${
                  online ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500'
                }`}
              />
              <span className="hidden sm:inline">
                {online ? 'Network connected' : 'Network disconnected'}
              </span>
            </div>
          </div>
        </header>

        {/* Page Content */}
        <main className="min-w-0 flex-1 p-4 sm:p-6 lg:p-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
