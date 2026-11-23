import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './contexts/AuthContext';
import { ProtectedRoute } from './components/ProtectedRoute';
import { AppLayout } from './components/AppLayout';
import { PageLoader } from './components/PageLoader';

const Login = lazy(() => import('./pages/Login'));
const Register = lazy(() => import('./pages/Register'));
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Clients = lazy(() => import('./pages/Clients'));
const QCBatches = lazy(() => import('./pages/QCBatches'));
const QCDashboard = lazy(() => import('./pages/QCDashboard'));
const LoadingMonitor = lazy(() => import('./pages/LoadingMonitor'));
const DispatchDashboard = lazy(() => import('./pages/DispatchDashboard'));
const DispatchBatches = lazy(() => import('./pages/DispatchBatches'));
const DispatchScan = lazy(() => import('./pages/DispatchScan'));
const Reports = lazy(() => import('./pages/Reports'));
const Settings = lazy(() => import('./pages/Settings'));
const ShelfLocations = lazy(() => import('./pages/ShelfLocations'));
const DispatchWorkspaceOrders = lazy(() => import('./pages/DispatchWorkspaceOrders'));
const DispatchOrdersHistory = lazy(() => import('./pages/DispatchOrdersHistory'));
const PackingList = lazy(() => import('./pages/PackingList'));
const QRLabels = lazy(() => import('./pages/QRLabels'));
const Vendors = lazy(() => import('./pages/Vendors'));
const Masters = lazy(() => import('./pages/Masters'));
const Storage = lazy(() => import('./pages/Storage'));
const StorageLocation = lazy(() => import('./pages/StorageLocation'));
const StorageRack = lazy(() => import('./pages/StorageRack'));
const Inventory = lazy(() => import('./pages/Inventory'));

// Only used for the standalone auth screens, which have no app shell.
const FullPageLoader = () => <PageLoader label="Loading…" className="min-h-screen bg-surface-50" />;

export default function App() {
  const { user, loading } = useAuth();

  const redirectHome = () => {
    if (user?.role === 'QC') return '/qc-dashboard';
    if (user?.role === 'DISPATCH') return '/dispatch-dashboard';
    return '/';
  };

  return (
    <Suspense fallback={<FullPageLoader />}>
    <Routes>
      <Route path="/login" element={user ? <Navigate to={redirectHome()} replace /> : loading ? <FullPageLoader /> : <Login />} />
      <Route path="/register" element={user ? <Navigate to={redirectHome()} replace /> : loading ? <FullPageLoader /> : <Register />} />

      <Route element={<AppLayout />}>
        <Route path="/" element={<ProtectedRoute roles={['ADMIN']}><Dashboard /></ProtectedRoute>} />

        {/* Admin management */}
        <Route path="/users" element={<Navigate to="/masters?tab=users" replace />} />
        <Route path="/divisions" element={<Navigate to="/masters?tab=divisions" replace />} />
        <Route path="/shelf-locations" element={<ProtectedRoute roles={['ADMIN', 'QC']}><ShelfLocations /></ProtectedRoute>} />
        <Route path="/reports" element={<ProtectedRoute roles={['ADMIN']}><Reports /></ProtectedRoute>} />
        <Route path="/settings" element={<ProtectedRoute roles={['ADMIN', 'QC', 'DISPATCH']}><Settings /></ProtectedRoute>} />

        <Route path="/clients" element={<Navigate to="/masters?tab=clients" replace />} />
        <Route path="/vendors" element={<Navigate to="/masters?tab=vendors" replace />} />
        <Route path="/masters" element={<ProtectedRoute roles={['ADMIN']}><Masters /></ProtectedRoute>} />
        {/* One shared screen for both roles: the QC decision queue. */}
        <Route path="/batches" element={<ProtectedRoute roles={['ADMIN', 'QC']}><QCBatches /></ProtectedRoute>} />
        <Route path="/products" element={<ProtectedRoute roles={['ADMIN']}><Navigate to="/masters?tab=products" replace /></ProtectedRoute>} />
        <Route path="/loading-monitor" element={<ProtectedRoute roles={['ADMIN', 'QC']}><LoadingMonitor /></ProtectedRoute>} />

        {/* QC */}
        <Route path="/qc" element={<Navigate to="/batches" replace />} />
        <Route path="/qc/qr-codes" element={<ProtectedRoute roles={['ADMIN']}><QRLabels /></ProtectedRoute>} />
        <Route path="/qc-dashboard" element={<ProtectedRoute roles={['ADMIN', 'QC']}><QCDashboard /></ProtectedRoute>} />

        {/* Dispatch */}
        <Route path="/dispatch" element={<ProtectedRoute roles={['ADMIN', 'DISPATCH']}><DispatchScan /></ProtectedRoute>} />
        <Route path="/dispatch-dashboard" element={<ProtectedRoute roles={['ADMIN', 'DISPATCH']}><DispatchDashboard /></ProtectedRoute>} />
        <Route path="/dispatch/batches" element={<ProtectedRoute roles={['ADMIN', 'DISPATCH']}><DispatchBatches /></ProtectedRoute>} />
        <Route path="/dispatch/qr-labels" element={<ProtectedRoute roles={['ADMIN', 'DISPATCH']}><QRLabels /></ProtectedRoute>} />
        {/* One shared screen for both roles: the dispatch workspace. */}
        <Route path="/dispatch-orders" element={<ProtectedRoute roles={['ADMIN', 'DISPATCH']}><DispatchWorkspaceOrders /></ProtectedRoute>} />
        <Route path="/dispatch-orders/history" element={<ProtectedRoute roles={['ADMIN', 'DISPATCH']}><DispatchOrdersHistory /></ProtectedRoute>} />
        <Route path="/packing-list" element={<ProtectedRoute roles={['ADMIN', 'DISPATCH']}><PackingList /></ProtectedRoute>} />

        {/* Storage locations, warehouse details, and rack details */}
        <Route path="/storage" element={<ProtectedRoute roles={['ADMIN', 'QC', 'DISPATCH']}><Storage /></ProtectedRoute>} />
        <Route path="/storage/:warehouseId" element={<ProtectedRoute roles={['ADMIN', 'QC', 'DISPATCH']}><StorageLocation /></ProtectedRoute>} />
        <Route path="/storage/:warehouseId/racks/:rackId" element={<ProtectedRoute roles={['ADMIN', 'QC', 'DISPATCH']}><StorageRack /></ProtectedRoute>} />
        <Route path="/inventory" element={<ProtectedRoute roles={['ADMIN', 'QC', 'DISPATCH']}><Inventory /></ProtectedRoute>} />

        <Route path="*" element={<Navigate to={redirectHome()} replace />} />
      </Route>
    </Routes>
    </Suspense>
  );
}
