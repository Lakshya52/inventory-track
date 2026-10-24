import { useAuth } from '../contexts/AuthContext';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { useState } from 'react';

type NavItem = {
  label: string;
  path: string;
  icon: string;
  roles: string[];
};

const navSections: { title: string; items: NavItem[] }[] = [
  {
    title: 'Overview',
    items: [
      { label: 'Admin Dashboard', path: '/', icon: '⊞', roles: ['ADMIN'] },
      { label: 'Reports & Logs', path: '/reports', icon: '📈', roles: ['ADMIN'] },
    ],
  },
  {
    title: 'Management',
    items: [
      { label: 'Vendors', path: '/vendors', icon: '🤝', roles: ['ADMIN'] },
      { label: 'Clients', path: '/clients', icon: '🤝', roles: ['ADMIN'] },
      { label: 'Users', path: '/users', icon: '👥', roles: ['ADMIN'] },
      { label: 'Products', path: '/products', icon: '📦', roles: ['ADMIN'] },
      { label: 'Shelf Locations', path: '/shelf-locations', icon: '📍', roles: ['ADMIN'] },
      { label: 'Batches', path: '/batches', icon: '🏷', roles: ['ADMIN', 'QC'] },
    ],
  },
  {
    title: 'Quality',
    items: [
      { label: 'QC Scan', path: '/qc', icon: '🔬', roles: ['QC'] },
      { label: 'QR Labels', path: '/qc/qr-codes', icon: '🔳', roles: ['ADMIN', 'QC'] },
      { label: 'QC Dashboard', path: '/qc-dashboard', icon: '📊', roles: ['QC'] },
    ],
  },
  {
    title: 'Dispatch',
    items: [
      { label: 'Dispatch Scan', path: '/dispatch', icon: '📷', roles: ['DISPATCH'] },
      { label: 'Dispatch Orders', path: '/dispatch-orders', icon: '📋', roles: ['DISPATCH'] },
      { label: 'Packing List', path: '/packing-list', icon: '📄', roles: ['DISPATCH'] },
    ],
  },
  {
    title: 'Account',
    items: [
      { label: 'My Profile', path: '/settings', icon: '👤', roles: ['ADMIN', 'QC', 'DISPATCH'] },
    ],
  },
];

const roleHome: Record<string, string> = {
  ADMIN: '/',
  QC: '/qc-dashboard',
  DISPATCH: '/dispatch-dashboard',
};

export function Navbar() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(false);

  if (!user) return null;

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const isActive = (path: string) => {
    if (path === '/') return location.pathname === '/';
    if (path === '/qc' || path === '/dispatch') return location.pathname === path;
    return location.pathname === path || location.pathname.startsWith(`${path}/`);
  };

  const filteredSections = navSections
    .map(s => ({
      ...s,
      items: s.items.filter(item => item.roles.includes(user.role)),
    }))
    .filter(s => s.items.length > 0);

  return (
    <>
      <aside className={`fixed top-0 left-0 h-full z-30 bg-navy-900 transition-all duration-300 flex flex-col ${collapsed ? 'w-16' : 'w-60'}`}>
        <div className="flex items-center gap-3 px-4 h-16 border-b border-white/5">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-brand-400 to-brand-600 flex items-center justify-center text-white font-bold text-sm shrink-0">
            A
          </div>
          {!collapsed && <span className="text-white font-semibold text-sm tracking-wide">Aceone</span>}
        </div>

        <div className="flex-1 overflow-y-auto py-4 px-2 space-y-6">
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
                      className={`flex items-center gap-3 px-3 py-2 rounded-xl text-sm transition-all duration-150 group ${
                        active
                          ? 'bg-brand-600/20 text-brand-300 font-medium'
                          : 'text-surface-400 hover:text-white hover:bg-white/5'
                      }`}
                      title={collapsed ? item.label : undefined}
                    >
                      <span className={`text-lg shrink-0 ${active ? '' : 'group-hover:scale-110'} transition-transform`}>
                        {item.icon}
                      </span>
                      {!collapsed && <span>{item.label}</span>}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        <div className="border-t border-white/5 p-3 space-y-2">
          <div className="flex items-center gap-3 px-3 py-2">
            <div className="w-7 h-7 rounded-full bg-brand-500/20 flex items-center justify-center text-xs font-semibold text-brand-300 shrink-0">
              {user.name.charAt(0).toUpperCase()}
            </div>
            {!collapsed && (
              <div className="min-w-0">
                <p className="text-sm font-medium text-white truncate">{user.name}</p>
                <p className="text-[10px] text-surface-400 uppercase tracking-wide">{user.role}</p>
              </div>
            )}
          </div>
          <button
            onClick={handleLogout}
            className="flex items-center gap-3 px-3 py-2 rounded-xl text-sm text-surface-400 hover:text-rose-400 hover:bg-rose-500/10 transition-all w-full"
          >
            <span className="text-lg shrink-0">🚪</span>
            {!collapsed && <span>Logout</span>}
          </button>
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="flex items-center gap-3 px-3 py-2 rounded-xl text-sm text-surface-500 hover:text-white hover:bg-white/5 transition-all w-full"
          >
            <span className="text-sm shrink-0">{collapsed ? '→' : '←'}</span>
            {!collapsed && <span>Collapse</span>}
          </button>
        </div>
      </aside>

      <div className={`transition-all duration-300 ${collapsed ? 'ml-16' : 'ml-60'}`}>
        <div className="h-16 flex items-center justify-between px-6 lg:px-8 bg-white/80 backdrop-blur-md border-b border-surface-200 sticky top-0 z-20">
          <h2 className="text-sm font-medium text-surface-600">
            {navSections.flatMap(s => s.items).find(i => isActive(i.path))?.label || 'Dashboard'}
          </h2>
          <div className="flex items-center gap-3">
            <div className="hidden sm:flex items-center gap-2 text-xs text-surface-400">
              <span className="w-2 h-2 rounded-full bg-emerald-500" />
              System Online
            </div>
          </div>
        </div>
        <main>
          {/* Page content renders here via children / outlet */}
        </main>
      </div>
    </>
  );
}
