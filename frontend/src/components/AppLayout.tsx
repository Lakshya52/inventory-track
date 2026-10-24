import { useAuth } from '../contexts/AuthContext';
import { useNavigate, useLocation, Link, Outlet } from 'react-router-dom';
import { useEffect, useState } from 'react';
import {
  LayoutDashboard, Package, Tags, MapPin, Handshake, Users,
  Microscope, BarChart3, Camera, ClipboardList, FileText, FileBarChart,
  LogOut, ChevronLeft, ChevronRight, UserCircle, Menu, X, Wifi, WifiOff, QrCode, Settings2,
} from 'lucide-react';

type NavItem = {
  label: string;
  path: string;
  icon: React.ReactNode;
  roles: string[];
};

const navSections: { title: string; items: NavItem[] }[] = [
  {
    title: 'Overview',
    items: [
      { label: 'Admin Dashboard', path: '/', icon: <LayoutDashboard size={18} />, roles: ['ADMIN'] },
      { label: 'Reports & Logs', path: '/reports', icon: <FileBarChart size={18} />, roles: ['ADMIN'] },
    ],
  },
  {
    title: 'Management',
    items: [
      { label: 'Products', path: '/products', icon: <Package size={18} />, roles: ['ADMIN', 'QC'] },
      { label: 'Shelf Locations', path: '/shelf-locations', icon: <MapPin size={18} />, roles: ['ADMIN'] },
      { label: 'Batches', path: '/batches', icon: <Tags size={18} />, roles: ['ADMIN', 'QC'] },
      { label: 'Clients', path: '/clients', icon: <Handshake size={18} />, roles: ['ADMIN'] },
      { label: 'Vendors', path: '/vendors', icon: <Handshake size={18} />, roles: ['ADMIN'] },
      { label: 'Masters', path: '/masters', icon: <Settings2 size={18} />, roles: ['ADMIN'] },
      { label: 'Users', path: '/users', icon: <Users size={18} />, roles: ['ADMIN'] },
    ],
  },
  {
    title: 'Quality',
    items: [
      { label: 'QC Dashboard', path: '/qc-dashboard', icon: <BarChart3 size={18} />, roles: ['QC'] },
      { label: 'QC Group Scan', path: '/qc', icon: <Microscope size={18} />, roles: ['QC'] },
      { label: 'QR Labels', path: '/qc/qr-codes', icon: <QrCode size={18} />, roles: ['ADMIN', 'QC'] },
    ],
  },
  {
    title: 'Dispatch',
    items: [
      { label: 'Dispatch Dashboard', path: '/dispatch-dashboard', icon: <BarChart3 size={18} />, roles: ['DISPATCH'] },
      { label: 'Dispatch Group Scan', path: '/dispatch', icon: <Camera size={18} />, roles: ['DISPATCH'] },
      { label: 'Dispatch Orders', path: '/dispatch-orders', icon: <ClipboardList size={18} />, roles: ['ADMIN', 'QC', 'DISPATCH'] },
      { label: 'Packing List', path: '/packing-list', icon: <FileText size={18} />, roles: ['DISPATCH'] },
    ],
  },
  {
    title: 'Account',
    items: [
      { label: 'My Profile', path: '/settings', icon: <UserCircle size={18} />, roles: ['ADMIN', 'QC', 'DISPATCH'] },
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
    .map(s => ({ ...s, items: s.items.filter(item => item.roles.includes(user.role)) }))
    .filter(s => s.items.length > 0);

  const currentPageLabel = navSections
    .flatMap(s => s.items)
    .find(i => isActive(i.path))?.label || 'Dashboard';

  const sidebar = (
    <>
      <div className="flex items-center gap-3 px-4 h-16 border-b border-white/5 shrink-0">
        <div className="w-8 h-8 rounded-lg bg-linear-to-br from-brand-400 to-brand-600 flex items-center justify-center text-white font-bold text-sm shrink-0">
          A
        </div>
        {!collapsed && <span className="text-white font-semibold text-sm tracking-wide">Aceone</span>}
        <button className="lg:hidden ml-auto p-1 rounded-lg text-surface-400 hover:text-white hover:bg-white/5" onClick={() => setMobileOpen(false)}>
          <X size={18} />
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto py-4 px-2 space-y-6 scrollbar-thin">
        {filteredSections.map(section => (
          <div key={section.title}>
            {!collapsed && (
              <p className="px-3 mb-2 text-[10px] font-semibold text-surface-400 uppercase tracking-widest">
                {section.title}
              </p>
            )}
            <div className="space-y-0.5">
              {section.items.map(item => {
                const active = isActive(item.path);
                return (
                  <Link
                    key={item.path}
                    to={item.path}
                    onClick={() => setMobileOpen(false)}
                    className={`flex items-center gap-3 px-3 py-2 rounded-xl text-sm transition-all duration-150 group ${
                      active
                        ? 'bg-brand-600/20 text-brand-300 font-medium'
                        : 'text-surface-400 hover:text-white hover:bg-white/5'
                    }`}
                    title={collapsed ? item.label : undefined}
                  >
                    <span className={`shrink-0 ${active ? '' : 'group-hover:scale-110'} transition-transform`}>
                      {item.icon}
                    </span>
                    {!collapsed && <span>{item.label}</span>}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      <div className="border-t border-white/5 p-3 space-y-1 shrink-0">
        <div className="flex items-center gap-3 px-3 py-2">
          <div className="w-7 h-7 rounded-full bg-brand-500/20 flex items-center justify-center shrink-0">
            <UserCircle size={16} className="text-brand-300" />
          </div>
          {!collapsed && (
            <div className="min-w-0">
              <p className="text-sm font-medium text-white truncate">{user.name}</p>
              <p className="text-[10px] text-surface-400 uppercase tracking-wide">{user.role}</p>
            </div>
          )}
        </div>
        <button onClick={handleLogout} className="flex items-center gap-3 px-3 py-2 rounded-xl text-sm text-surface-400 hover:text-rose-400 hover:bg-rose-500/10 transition-all w-full">
          <LogOut size={16} className="shrink-0" />
          {!collapsed && <span>Logout</span>}
        </button>
        <button onClick={() => setCollapsed(!collapsed)} className="hidden lg:flex items-center gap-3 px-3 py-2 rounded-xl text-sm text-surface-500 hover:text-white hover:bg-white/5 transition-all w-full">
          {collapsed ? <ChevronRight size={16} className="shrink-0" /> : <ChevronLeft size={16} className="shrink-0" />}
          {!collapsed && <span>Collapse</span>}
        </button>
      </div>
    </>
  );

  return (
    <div className="min-h-screen w-full bg-surface-50">
      {mobileOpen && (
        <div className="fixed inset-0 z-30 bg-black/40 lg:hidden" onClick={() => setMobileOpen(false)} />
      )}

      <aside className={`fixed top-0 left-0 h-full z-40 bg-navy-900 transition-all duration-300 flex flex-col ${collapsed ? 'w-60 lg:w-16' : 'w-60'} ${mobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}`}>
        {sidebar}
      </aside>

      <div className={`flex min-w-0 flex-col transition-all duration-300 ${collapsed ? 'lg:ml-16' : 'lg:ml-60'}`}>
        <header className="h-16 flex items-center justify-between px-4 lg:px-8 bg-white/80 backdrop-blur-md border-b border-surface-200 sticky top-0 z-20 shrink-0">
          <div className="flex items-center gap-3">
            <button className="lg:hidden p-1.5 rounded-lg hover:bg-surface-100 text-surface-500" onClick={() => setMobileOpen(true)}>
              <Menu size={20} />
            </button>
            <h2 className="text-sm font-semibold text-surface-800">{currentPageLabel}</h2>
          </div>
          <div className="flex items-center gap-3">
            <span className={`flex items-center gap-2 text-xs ${online ? 'text-emerald-600' : 'text-amber-600'}`}>
              {online ? <Wifi size={14} /> : <WifiOff size={14} />}
              <span className="hidden sm:inline">{online ? 'Online' : 'Offline — reconnect to continue'}</span>
            </span>
          </div>
        </header>
        <main className="min-w-0 flex-1">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
