import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { api } from '../services/api';
import { Tenant, User } from '../types';

interface AuthContextType {
  user: User | null;
  tenant: Tenant | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (data: { name: string; companyName: string; mobile: string; email: string; password: string }) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
  refreshTenant: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>(null!);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshUser = async () => {
    const t = localStorage.getItem('token');
    if (t) {
      try {
        const u = await api.auth.me();
        setUser(u);
        const tData = await api.auth.tenant();
        setTenant(tData);
      } catch {
        api.auth.clearSession();
        setUser(null);
        setTenant(null);
      }
    }
  };

  useEffect(() => {
    const t = localStorage.getItem('token');
    if (t) {
      Promise.all([api.auth.me(), api.auth.tenant()])
        .then(([nextUser, nextTenant]) => { setUser(nextUser); setTenant(nextTenant); })
        .catch(() => { api.auth.clearSession(); setUser(null); setTenant(null); })
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, []);

  const login = async (email: string, password: string) => {
    const res = await api.auth.login(email, password);
    api.auth.persistSession(res);
    setUser(res.user);
    setTenant(await api.auth.tenant());
  };

  const register = async (data: { name: string; companyName: string; mobile: string; email: string; password: string }) => {
    const res = await api.auth.register(data);
    api.auth.persistSession(res);
    setUser(res.user);
    setTenant(res.tenant);
  };

  const logout = async () => {
    const refreshToken = localStorage.getItem('refreshToken');
    try {
      if (refreshToken) await api.auth.logout(refreshToken);
    } catch (error) {
      console.error('Could not revoke the refresh token during logout:', error);
    } finally {
      api.auth.clearSession();
      setUser(null);
      setTenant(null);
    }
  };

  const refreshTenant = async () => setTenant(await api.auth.tenant());

  return (
    <AuthContext.Provider value={{ user, tenant, loading, login, register, logout, refreshUser, refreshTenant }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
