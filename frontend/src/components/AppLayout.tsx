import { useAuth } from "../contexts/AuthContext";
import { resolveUploadUrl } from "../services/api";
import { useNavigate, useLocation, Link, Outlet } from "react-router-dom";
import { useEffect, useState } from "react";
import {
  LayoutDashboard,
  LayoutGrid,
  Package,
  Boxes,
  Users,
  BarChart3,
  Camera,
  ClipboardList,
  FileText,
  FileBarChart,
  LogOut,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  UserCircle,
  Menu,
  X,
  QrCode,
  SlidersHorizontal,
  Activity,
  Layers,
  ShieldCheck,
} from "lucide-react";

type SubNavItem = {
  label: string;
  path: string;
  icon?: React.ReactNode;
  badge?: string;
  roles?: string[];
};

type NavItem = {
  label: string;
  path?: string;
  icon: React.ReactNode;
  roles: string[];
  badge?: string;
  subItems?: SubNavItem[];
};

const navSections: { title: string; items: NavItem[] }[] = [
  {
    title: "",
    items: [
      {
        label: "Dashboard",
        icon: <LayoutDashboard size={20} />,
        roles: ["ADMIN"],
        subItems: [
          {
            label: "Overview",
            path: "/",
            icon: <LayoutGrid size={18} />,
            roles: ["ADMIN"],
          },
          {
            label: "Live Loading",
            path: "/loading-monitor",
            icon: <Activity size={18} />,
            badge: "LIVE",
            roles: ["ADMIN"],
          },
        ],
      },
    ],
  },
  {
    title: "Management",
    items: [
      {
        label: "Products",
        path: "/products",
        icon: <Package size={20} />,
        roles: ["ADMIN"],
      },
      {
        label: "Masters",
        path: "/masters",
        icon: <SlidersHorizontal size={20} />,
        roles: ["ADMIN"],
      },
      {
        label: "Views",
        icon: <Layers size={20} />,
        roles: ["ADMIN"],
        subItems: [
          { label: "Batches", path: "/batches", icon: <Boxes size={18} /> },
          {
            label: "Dispatch Orders",
            path: "/dispatch-orders",
            icon: <ClipboardList size={18} />,
          },
          {
            label: "Packaging Lists",
            path: "/packing-list",
            icon: <FileText size={18} />,
          },
          {
            label: "QR Labels",
            path: "/qc/qr-codes",
            icon: <QrCode size={18} />,
          },
        ],
      },
      {
        label: "Administrations",
        icon: <ShieldCheck size={20} />,
        roles: ["ADMIN"],
        subItems: [
          {
            label: "Reports",
            path: "/reports",
            icon: <FileBarChart size={18} />,
          },
          {
            label: "User Management",
            path: "/users",
            icon: <Users size={18} />,
          },
          // { label: 'Settings', path: '/settings', icon: <UserCircle size={18} /> },
        ],
      },
      {
        label: "Settings",
        icon: <UserCircle size={18} />,
        path: "/settings",
        roles: ["ADMIN"],
      },
    ],
  },
  {
    title: "Operations",
    items: [
      {
        label: "QC Dashboard",
        path: "/qc-dashboard",
        icon: <BarChart3 size={20} />,
        roles: ["QC"],
      },
      // {
      //   label: "Live Loading",
      //   path: "/loading-monitor",
      //   icon: <Activity size={20} />,
      //   roles: ["QC"],
      //   badge: "LIVE",
      // },
      // {
      //   label: "Products",
      //   path: "/products",
      //   icon: <Package size={20} />,
      //   roles: ["QC"],
      // },
      {
        label: "Batches",
        path: "/batches",
        icon: <Boxes size={20} />,
        roles: ["QC"],
      },
      {
        label: "Print Requests",
        path: "/qc/qr-codes",
        icon: <QrCode size={20} />,
        roles: ["QC"],
      },
      {
        label: "Dispatch Dashboard",
        path: "/dispatch-dashboard",
        icon: <BarChart3 size={20} />,
        roles: ["DISPATCH"],
      },
      {
        label: "Loading & Scan",
        path: "/dispatch",
        icon: <Camera size={20} />,
        roles: ["DISPATCH"],
      },
      {
        label: "Dispatch Orders",
        path: "/dispatch-orders",
        icon: <ClipboardList size={20} />,
        roles: ["DISPATCH"],
      },
      {
        label: "Packaging Lists",
        path: "/packing-list",
        icon: <FileText size={20} />,
        roles: ["DISPATCH"],
      },
      {
        label: "Settings",
        path: "/settings",
        icon: <UserCircle size={20} />,
        roles: ["QC", "DISPATCH"],
      },
    ],
  },
];

export function AppLayout() {
  const { user, tenant, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [online, setOnline] = useState(
    typeof navigator === "undefined" ? true : navigator.onLine,
  );
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({
    Dashboard: true,
    Views: true,
    Administrations: true,
  });

  useEffect(() => {
    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  const isPathActive = (path?: string) => {
    if (!path) return false;
    if (path === "/" || path === "/qc" || path === "/dispatch") {
      return location.pathname === path && !location.search;
    }
    return (
      location.pathname === path || location.pathname.startsWith(`${path}/`)
    );
  };

  const isSubActive = (subPath: string) => {
    if (subPath === "/") {
      return location.pathname === "/" && !location.search;
    }
    if (subPath.includes("?")) {
      const fullCurrent = location.pathname + location.search;
      return fullCurrent === subPath;
    }
    return (
      location.pathname === subPath ||
      location.pathname.startsWith(`${subPath}/`)
    );
  };

  // Auto-expand group when a child path becomes active
  useEffect(() => {
    navSections.forEach((section) => {
      section.items.forEach((item) => {
        if (item.subItems) {
          const hasActiveChild = item.subItems.some((sub) =>
            isSubActive(sub.path),
          );
          if (hasActiveChild) {
            setOpenGroups((prev) =>
              prev[item.label] ? prev : { ...prev, [item.label]: true },
            );
          }
        }
      });
    });
  }, [location.pathname, location.search]);

  if (!user) return <Outlet />;

  const handleLogout = () => {
    logout();
    navigate("/login");
  };

  const toggleGroup = (label: string, e?: React.MouseEvent) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    setOpenGroups((prev) => ({ ...prev, [label]: !prev[label] }));
  };

  const filteredSections = navSections
    .map((s) => ({
      ...s,
      items: s.items
        .filter((item) => item.roles.includes(user.role))
        .map((item) => ({
          ...item,
          subItems: item.subItems?.filter(
            (sub) => !sub.roles || sub.roles.includes(user.role),
          ),
        })),
    }))
    .filter((s) => s.items.length > 0);

  // Compute breadcrumb / page label
  const getCurrentPageLabel = () => {
    for (const section of navSections) {
      for (const item of section.items) {
        if (item.subItems) {
          const activeSub = item.subItems.find((sub) => isSubActive(sub.path));
          if (activeSub) {
            return `${item.label} › ${activeSub.label}`;
          }
        }
      }
    }
    for (const section of navSections) {
      for (const item of section.items) {
        if (item.path && isPathActive(item.path)) {
          return item.label;
        }
      }
    }
    return "Dashboard";
  };

  const currentPageLabel = getCurrentPageLabel();

  const sidebar = (
    <>
      {/* Brand Header */}
      <div className="flex items-center gap-3 px-4 h-16 border-b border-white/10 shrink-0 bg-slate-900/60 backdrop-blur-sm">
        {collapsed ? (
          <button
            className="group w-10 h-10 rounded-xl bg-linear-to-tr from-brand-600 to-indigo-500 flex items-center justify-center text-white font-extrabold text-base shrink-0 shadow-sm transition-transform hover:scale-105"
            onClick={() => setCollapsed(false)}
            title="Expand sidebar"
          >
            {tenant?.logoUrl && <img src={`${resolveUploadUrl(tenant.logoUrl)}?v=${encodeURIComponent(tenant.updatedAt || String(tenant.id))}`} alt={`${tenant.name} logo`} className="h-full w-full rounded-xl bg-white object-contain p-1 group-hover:hidden" />}
            <span className="hidden group-hover:block">
              <ChevronRight size={20} />
            </span>
          </button>
        ) : (
          <div className="flex items-center gap-3 min-w-0 flex-1">
            {tenant?.logoUrl && <div className="w-10 h-10 rounded-xl border border-white/10 bg-white flex items-center justify-center shrink-0 shadow-sm overflow-hidden">
              <img src={`${resolveUploadUrl(tenant.logoUrl)}?v=${encodeURIComponent(tenant.updatedAt || String(tenant.id))}`} alt={`${tenant.name} logo`} className="h-full w-full object-contain" onError={event => { event.currentTarget.style.display = 'none'; }} />
            </div>}
            <div className="min-w-0 flex-1">
              <div className="text-white font-bold text-base tracking-tight flex items-center gap-1.5">
                <span className="truncate">{tenant?.name || 'Aceone'}</span>
              </div>
              <div className="text-xs text-slate-400 truncate">Product Scanning</div>
            </div>
          </div>
        )}

        <button
          className="lg:hidden ml-auto p-2 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
          onClick={() => setMobileOpen(false)}
        >
          <X size={20} />
        </button>

        {!collapsed && (
          <button
            className="hidden lg:flex ml-auto p-2 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
            onClick={() => setCollapsed(true)}
            title="Collapse sidebar"
          >
            <ChevronLeft size={18} />
          </button>
        )}
      </div>

      {/* Nav List */}
      <nav className="flex-1 overflow-y-auto py-4 px-3 space-y-4 scrollbar-thin">
        {filteredSections.map((section, sIdx) => (
          <div key={section.title || `section-${sIdx}`} className="space-y-1">
            {!collapsed && section.title && (
              <p className="px-3.5 pt-3 pb-1 text-xs font-bold text-slate-400 uppercase tracking-wider">
                {section.title}
              </p>
            )}
            <div className="space-y-1">
              {section.items.map((item) => {
                const hasSubItems = Boolean(
                  item.subItems && item.subItems.length > 0,
                );
                const hasActiveChild = Boolean(
                  item.subItems?.some((sub) => isSubActive(sub.path)),
                );
                const isDirectActive =
                  isPathActive(item.path) && !hasActiveChild;
                const isOpen = openGroups[item.label] ?? false;

                if (collapsed) {
                  return (
                    <div key={item.label} className="relative group">
                      <button
                        type="button"
                        onClick={() => {
                          setCollapsed(false);
                          setOpenGroups((prev) => ({
                            ...prev,
                            [item.label]: true,
                          }));
                        }}
                        className={`flex items-center justify-center w-full h-11 rounded-xl transition-all duration-150 ${
                          isDirectActive || hasActiveChild
                            ? "bg-brand-600 text-white shadow-sm"
                            : "text-slate-300 hover:text-white hover:bg-white/10"
                        }`}
                        title={
                          hasSubItems
                            ? `${item.label}: ${item.subItems?.map((s) => s.label).join(", ")}`
                            : item.label
                        }
                      >
                        <span className="shrink-0">{item.icon}</span>
                        {item.badge && (
                          <span className="absolute top-1.5 right-1.5 w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
                        )}
                      </button>
                    </div>
                  );
                }

                return (
                  <div key={item.label} className="space-y-1">
                    {hasSubItems ? (
                      /* Main tab with sub-items: Click toggles expansion (no direct page navigation) */
                      <button
                        type="button"
                        onClick={() => toggleGroup(item.label)}
                        className={`w-full flex items-center justify-between gap-3 px-3.5 py-2.5 rounded-xl text-[15px] font-medium transition-all duration-150 group ${
                          hasActiveChild
                            ? "bg-white/10 text-white font-semibold"
                            : "text-slate-200 hover:text-white hover:bg-white/10"
                        }`}
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <span
                            className={`shrink-0 transition-transform ${
                              hasActiveChild
                                ? "text-brand-300"
                                : "text-slate-400 group-hover:text-white group-hover:scale-105"
                            }`}
                          >
                            {item.icon}
                          </span>
                          <span className="truncate">{item.label}</span>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          {item.badge && (
                            <span className="flex items-center gap-1.5 text-xs font-bold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                              {item.badge}
                            </span>
                          )}
                          <ChevronDown
                            size={18}
                            className={`transition-transform duration-200 text-slate-400 group-hover:text-slate-200 ${
                              isOpen ? "rotate-0 text-brand-300" : "-rotate-90"
                            }`}
                          />
                        </div>
                      </button>
                    ) : (
                      /* Standalone main tab without sub-items (e.g., Products, Masters) */
                      <Link
                        to={item.path!}
                        onClick={() => setMobileOpen(false)}
                        className={`flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-[15px] font-medium transition-all duration-150 group ${
                          isDirectActive
                            ? "bg-brand-600 text-white shadow-sm font-semibold"
                            : "text-slate-200 hover:text-white hover:bg-white/10"
                        }`}
                      >
                        <span
                          className={`shrink-0 transition-transform ${
                            isDirectActive
                              ? "text-white"
                              : "text-slate-400 group-hover:text-white group-hover:scale-105"
                          }`}
                        >
                          {item.icon}
                        </span>

                        <span className="truncate flex-1">{item.label}</span>

                        {item.badge && (
                          <span className="shrink-0 flex items-center gap-1.5 text-xs font-bold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                            {item.badge}
                          </span>
                        )}
                      </Link>
                    )}

                    {/* Sub-items dropdown */}
                    {hasSubItems && isOpen && (
                      <div className="ml-6 pl-3 py-1 space-y-1 border-l-2 border-slate-700/70">
                        {item.subItems!.map((sub) => {
                          const subActive = isSubActive(sub.path);
                          return (
                            <Link
                              key={sub.path}
                              to={sub.path}
                              onClick={() => setMobileOpen(false)}
                              className={`flex items-center justify-between gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-all group ${
                                subActive
                                  ? "bg-brand-500/20 text-brand-300 font-semibold border border-brand-500/30 shadow-xs"
                                  : "text-slate-300 hover:text-white hover:bg-white/5"
                              }`}
                            >
                              <div className="flex items-center gap-2.5 truncate">
                                {sub.icon ? (
                                  <span
                                    className={`shrink-0 ${
                                      subActive
                                        ? "text-brand-300"
                                        : "text-slate-400 group-hover:text-slate-200"
                                    }`}
                                  >
                                    {sub.icon}
                                  </span>
                                ) : (
                                  <span
                                    className={`w-2 h-2 rounded-full shrink-0 ${
                                      subActive
                                        ? "bg-brand-400"
                                        : "bg-slate-500 group-hover:bg-slate-300"
                                    }`}
                                  />
                                )}
                                <span className="truncate">{sub.label}</span>
                              </div>

                              {sub.badge && (
                                <span className="shrink-0 flex items-center gap-1.5 text-xs font-bold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                                  {sub.badge}
                                </span>
                              )}
                            </Link>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* Profile & Logout Footer */}
      <div className="border-t border-white/10 p-3.5 space-y-2 shrink-0 bg-slate-900/60">
        <div className="flex items-center gap-3 px-3 py-2 rounded-xl bg-white/5">
          <div className="w-9 h-9 rounded-full bg-brand-500/30 border border-brand-400/40 flex items-center justify-center shrink-0">
            <span className="text-sm font-bold text-brand-200">
              {user.name ? user.name.slice(0, 2).toUpperCase() : "AD"}
            </span>
          </div>
          {!collapsed && (
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-white truncate">
                {user.name}
              </p>
              <div className="flex items-center gap-1.5 mt-0.5">
                <span className="w-2 h-2 rounded-full bg-emerald-400" />
                <span className="text-xs text-slate-400 font-mono tracking-wide uppercase">
                  {user.role}
                </span>
              </div>
            </div>
          )}
        </div>

        <button
          onClick={handleLogout}
          className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-slate-300 hover:text-rose-300 hover:bg-rose-500/10 transition-colors w-full"
          title={collapsed ? "Logout" : undefined}
        >
          <LogOut size={18} className="shrink-0" />
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
          collapsed ? "w-72 lg:w-20" : "w-72"
        } ${mobileOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"}`}
      >
        {sidebar}
      </aside>

      {/* Main Content Area */}
      <div
        className={`flex min-w-0 flex-1 flex-col transition-all duration-300 ${
          collapsed ? "lg:ml-20" : "lg:ml-72"
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
              className={`flex items-center gap-2 px-3 py-1 rounded-full text-xs font-medium border ${
                online
                  ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                  : "bg-amber-50 text-amber-700 border-amber-200"
              }`}
            >
              <span
                className={`w-2 h-2 rounded-full ${
                  online ? "bg-emerald-500 animate-pulse" : "bg-amber-500"
                }`}
              />
              <span className="hidden sm:inline">
                {online ? "Network connected" : "Network disconnected"}
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
