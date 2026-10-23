import { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { Role } from '../types';

const roleHome: Record<Role, string> = {
  ADMIN: '/',
  QC: '/qc-dashboard',
  DISPATCH: '/dispatch-dashboard',
};

export function ProtectedRoute({ children, roles }: { children: ReactNode; roles?: Role[] }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="flex items-center justify-center min-h-screen text-lg">Loading...</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (roles && !roles.includes(user.role)) return <Navigate to={roleHome[user.role]} replace />;
  return <>{children}</>;
}
