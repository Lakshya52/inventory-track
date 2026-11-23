import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { PropsWithChildren } from 'react';

import { useAuth } from '@/contexts/AuthContext';
import { authenticatedRequest } from '@/services/api/authenticated';
import { API_ENDPOINTS } from '@/services/api/endpoints';
import type { Tenant } from '@/types/tenant';
import { getTenantLogoUri } from '@/utils/tenant';

interface TenantContextValue {
  tenant: Tenant | null;
  logoUri: string | null;
  isLoading: boolean;
  refresh: () => Promise<void>;
}

const TenantContext = createContext<TenantContextValue | null>(null);

/** Loads the signed-in tenant once per session and exposes its logo URI. */
export function TenantProvider({ children }: PropsWithChildren) {
  const { session } = useAuth();
  const token = session?.token ?? null;
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const load = useCallback(async () => {
    if (!token) {
      setTenant(null);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    try {
      setTenant(await authenticatedRequest<Tenant>(API_ENDPOINTS.auth.tenant));
    } catch {
      setTenant(null);
    } finally {
      setIsLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  const value = useMemo(
    () => ({ tenant, logoUri: getTenantLogoUri(tenant), isLoading, refresh: load }),
    [tenant, isLoading, load],
  );

  return <TenantContext.Provider value={value}>{children}</TenantContext.Provider>;
}

export function useTenant(): TenantContextValue {
  const value = useContext(TenantContext);
  if (!value) {
    throw new Error('useTenant must be used inside <TenantProvider>.');
  }
  return value;
}
