import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './contexts/AuthContext';
import { ProtectedRoute } from './components/ProtectedRoute';
import { Navbar } from './components/Navbar';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Products from './pages/Products';
import Batches from './pages/Batches';
import QCScan from './pages/QCScan';
import DispatchScan from './pages/DispatchScan';
import Reports from './pages/Reports';
import Settings from './pages/Settings';

export default function App() {
  const { user, loading } = useAuth();

  if (loading) {
    return <div className="flex items-center justify-center min-h-screen text-lg">Loading...</div>;
  }

  return (
    <div className="min-h-screen bg-gray-100">
      {user && <Navbar />}
      <Routes>
        <Route path="/login" element={user ? <Navigate to="/" replace /> : <Login />} />
        <Route path="/" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
        <Route path="/products" element={<ProtectedRoute roles={['ADMIN']}><Products /></ProtectedRoute>} />
        <Route path="/batches" element={<ProtectedRoute roles={['ADMIN']}><Batches /></ProtectedRoute>} />
        <Route path="/qc" element={<ProtectedRoute roles={['ADMIN', 'QC']}><QCScan /></ProtectedRoute>} />
        <Route path="/dispatch" element={<ProtectedRoute roles={['ADMIN', 'DISPATCH']}><DispatchScan /></ProtectedRoute>} />
        <Route path="/reports" element={<ProtectedRoute roles={['ADMIN', 'QC', 'DISPATCH']}><Reports /></ProtectedRoute>} />
        <Route path="/settings" element={<ProtectedRoute roles={['ADMIN']}><Settings /></ProtectedRoute>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  );
}
