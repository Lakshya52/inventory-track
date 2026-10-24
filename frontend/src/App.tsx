import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './contexts/AuthContext';
import { ProtectedRoute } from './components/ProtectedRoute';
import { AppLayout } from './components/AppLayout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Products from './pages/Products';
import Clients from './pages/Clients';
import Batches from './pages/Batches';
import QCScan from './pages/QCScan';
import QCDashboard from './pages/QCDashboard';
import DispatchDashboard from './pages/DispatchDashboard';
import DispatchScan from './pages/DispatchScan';
import Reports from './pages/Reports';
import Settings from './pages/Settings';
import ShelfLocations from './pages/ShelfLocations';
import Users from './pages/Users';
import DispatchOrders from './pages/DispatchOrders';
import PackingList from './pages/PackingList';
import QRLabels from './pages/QRLabels';
import Vendors from './pages/Vendors';
import Masters from './pages/Masters';

export default function App() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-surface-50">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-brand-400 to-brand-600 flex items-center justify-center text-white font-bold animate-pulse">
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
    <Routes>
      <Route path="/login" element={user ? <Navigate to={redirectHome()} replace /> : <Login />} />

      <Route element={<AppLayout />}>
        <Route path="/" element={<ProtectedRoute roles={['ADMIN']}><Dashboard /></ProtectedRoute>} />

        {/* Admin management */}
        <Route path="/users" element={<ProtectedRoute roles={['ADMIN']}><Users /></ProtectedRoute>} />
        <Route path="/shelf-locations" element={<ProtectedRoute roles={['ADMIN']}><ShelfLocations /></ProtectedRoute>} />
        <Route path="/reports" element={<ProtectedRoute roles={['ADMIN']}><Reports /></ProtectedRoute>} />
        <Route path="/settings" element={<ProtectedRoute roles={['ADMIN', 'QC', 'DISPATCH']}><Settings /></ProtectedRoute>} />

        <Route path="/clients" element={<ProtectedRoute roles={['ADMIN']}><Clients /></ProtectedRoute>} />
        <Route path="/vendors" element={<ProtectedRoute roles={['ADMIN']}><Vendors /></ProtectedRoute>} />
        <Route path="/masters" element={<ProtectedRoute roles={['ADMIN']}><Masters /></ProtectedRoute>} />
        <Route path="/batches" element={<ProtectedRoute roles={['ADMIN', 'QC']}><Batches /></ProtectedRoute>} />
        <Route path="/products" element={<ProtectedRoute roles={['ADMIN', 'QC']}><Products readOnly={user?.role !== 'ADMIN'} /></ProtectedRoute>} />

        {/* QC */}
        <Route path="/qc" element={<ProtectedRoute roles={['QC']}><QCScan /></ProtectedRoute>} />
        <Route path="/qc/qr-codes" element={<ProtectedRoute roles={['ADMIN', 'QC']}><QRLabels /></ProtectedRoute>} />
        <Route path="/qc-dashboard" element={<ProtectedRoute roles={['QC']}><QCDashboard /></ProtectedRoute>} />

        {/* Dispatch */}
        <Route path="/dispatch" element={<ProtectedRoute roles={['DISPATCH']}><DispatchScan /></ProtectedRoute>} />
        <Route path="/dispatch-dashboard" element={<ProtectedRoute roles={['DISPATCH']}><DispatchDashboard /></ProtectedRoute>} />
        <Route path="/dispatch-orders" element={<ProtectedRoute roles={['ADMIN', 'QC', 'DISPATCH']}><DispatchOrders /></ProtectedRoute>} />
        <Route path="/packing-list" element={<ProtectedRoute roles={['DISPATCH']}><PackingList /></ProtectedRoute>} />

        <Route path="*" element={<Navigate to={redirectHome()} replace />} />
      </Route>
    </Routes>
  );
}
