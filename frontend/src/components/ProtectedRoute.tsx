import { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { Role } from '../types';
import { PageLoader } from './PageLoader';

const roleHome: Record<Role, string> = {
  ADMIN: '/',
  QC: '/qc-dashboard',
  DISPATCH: '/dispatch-dashboard',
};

export function ProtectedRoute({ children, roles }: { children: ReactNode; roles?: Role[] }) {
  const { user, loading } = useAuth();
  if (loading) return <PageLoader label="Checking access…" />;
  if (!user) return <Navigate to="/login" replace />;
  if (roles && !roles.includes(user.role)) return <Navigate to={roleHome[user.role]} replace />;
  return <>{children}</>;
}
