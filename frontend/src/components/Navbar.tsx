import { useAuth } from '../contexts/AuthContext';
import { useNavigate, Link } from 'react-router-dom';

export function Navbar() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  if (!user) return null;

  const isAdmin = user.role === 'ADMIN';
  const isQC = user.role === 'QC';
  const isDispatch = user.role === 'DISPATCH';

  return (
    <nav className="bg-blue-800 text-white p-3 flex items-center justify-between flex-wrap gap-2">
      <div className="flex items-center gap-4 flex-wrap">
        <Link to="/" className="font-bold text-lg">Aceone Inventory</Link>
        <Link to="/" className="hover:underline text-sm">Dashboard</Link>
        {isAdmin && (
          <>
            <Link to="/products" className="hover:underline text-sm">Products</Link>
            <Link to="/batches" className="hover:underline text-sm">Batches</Link>
            <Link to="/reports" className="hover:underline text-sm">Reports & Logs</Link>
            <Link to="/settings" className="hover:underline text-sm">Settings</Link>
          </>
        )}
        {(isAdmin || isQC) && <Link to="/qc" className="hover:underline text-sm">QC Scan</Link>}
        {(isAdmin || isDispatch) && <Link to="/dispatch" className="hover:underline text-sm">Dispatch Scan</Link>}
      </div>
      <div className="flex items-center gap-3">
        <span className="text-sm">{user.name} ({user.role})</span>
        <button onClick={handleLogout} className="bg-red-600 px-3 py-1 rounded text-sm hover:bg-red-700">Logout</button>
      </div>
    </nav>
  );
}
