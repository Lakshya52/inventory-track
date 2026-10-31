import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './contexts/AuthContext';
import { ProtectedRoute } from './components/ProtectedRoute';
import { AppLayout } from './components/AppLayout';

const Login = lazy(() => import('./pages/Login'));
const Register = lazy(() => import('./pages/Register'));
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Products = lazy(() => import('./pages/Products'));
const Clients = lazy(() => import('./pages/Clients'));
const Batches = lazy(() => import('./pages/Batches'));
const QCBatches = lazy(() => import('./pages/QCBatches'));
const QCDashboard = lazy(() => import('./pages/QCDashboard'));
const LoadingMonitor = lazy(() => import('./pages/LoadingMonitor'));
const DispatchDashboard = lazy(() => import('./pages/DispatchDashboard'));
const DispatchScan = lazy(() => import('./pages/DispatchScan'));
const Reports = lazy(() => import('./pages/Reports'));
const Settings = lazy(() => import('./pages/Settings'));
const ShelfLocations = lazy(() => import('./pages/ShelfLocations'));
const Users = lazy(() => import('./pages/Users'));
const DispatchOrders = lazy(() => import('./pages/DispatchOrders'));
const DispatchWorkspaceOrders = lazy(() => import('./pages/DispatchWorkspaceOrders'));
const PackingList = lazy(() => import('./pages/PackingList'));
const QRLabels = lazy(() => import('./pages/QRLabels'));
const Vendors = lazy(() => import('./pages/Vendors'));
const Masters = lazy(() => import('./pages/Masters'));

export default function App() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-surface-50">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-linear-to-br from-brand-400 to-brand-600 flex items-center justify-center text-white font-bold animate-pulse">
            A
          </div>
          <span className="text-sm text-surface-400 font-medium">Loading...</span>
        </div>
      </div>
    );
  }

  const redirectHome = () => {
    if (user?.role === 'QC') return '/qc-dashboard';
    if (user?.role === 'DISPATCH') return '/dispatch-dashboard';
    return '/';
  };

  return (
    <Suspense fallback={(
      <div className="flex min-h-[40vh] items-center justify-center text-sm font-medium text-surface-500" role="status">
        Loading page...
      </div>
    )}>
    <Routes>
      <Route path="/login" element={user ? <Navigate to={redirectHome()} replace /> : <Login />} />
      <Route path="/register" element={user ? <Navigate to={redirectHome()} replace /> : <Register />} />

      <Route element={<AppLayout />}>
        <Route path="/" element={<ProtectedRoute roles={['ADMIN']}><Dashboard /></ProtectedRoute>} />

        {/* Admin management */}
        <Route path="/users" element={<ProtectedRoute roles={['ADMIN']}><Users /></ProtectedRoute>} />
        <Route path="/shelf-locations" element={<Navigate to="/masters?tab=shelf-locations" replace />} />
        <Route path="/reports" element={<ProtectedRoute roles={['ADMIN']}><Reports /></ProtectedRoute>} />
        <Route path="/settings" element={<ProtectedRoute roles={['ADMIN', 'QC', 'DISPATCH']}><Settings /></ProtectedRoute>} />

        <Route path="/clients" element={<Navigate to="/masters?tab=clients" replace />} />
        <Route path="/vendors" element={<Navigate to="/masters?tab=vendors" replace />} />
        <Route path="/masters" element={<ProtectedRoute roles={['ADMIN']}><Masters /></ProtectedRoute>} />
        <Route path="/batches" element={<ProtectedRoute roles={['ADMIN', 'QC']}>{user?.role === 'QC' ? <QCBatches /> : <Batches />}</ProtectedRoute>} />
        <Route path="/products" element={<ProtectedRoute roles={['ADMIN', 'QC']}><Products readOnly={user?.role !== 'ADMIN'} /></ProtectedRoute>} />
        <Route path="/loading-monitor" element={<ProtectedRoute roles={['ADMIN', 'QC']}><LoadingMonitor /></ProtectedRoute>} />

        {/* QC */}
        <Route path="/qc" element={<Navigate to="/batches" replace />} />
        <Route path="/qc/qr-codes" element={<ProtectedRoute roles={['ADMIN', 'QC']}><QRLabels /></ProtectedRoute>} />
        <Route path="/qc-dashboard" element={<ProtectedRoute roles={['QC']}><QCDashboard /></ProtectedRoute>} />

        {/* Dispatch */}
        <Route path="/dispatch" element={<ProtectedRoute roles={['DISPATCH']}><DispatchScan /></ProtectedRoute>} />
        <Route path="/dispatch-dashboard" element={<ProtectedRoute roles={['DISPATCH']}><DispatchDashboard /></ProtectedRoute>} />
        <Route path="/dispatch-orders" element={<ProtectedRoute roles={['ADMIN', 'DISPATCH']}>{user?.role === 'DISPATCH' ? <DispatchWorkspaceOrders /> : <DispatchOrders />}</ProtectedRoute>} />
        <Route path="/packing-list" element={<ProtectedRoute roles={['ADMIN', 'DISPATCH']}><PackingList /></ProtectedRoute>} />

        <Route path="*" element={<Navigate to={redirectHome()} replace />} />
      </Route>
    </Routes>
    </Suspense>
  );
}
