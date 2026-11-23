import { createContext, useContext, useEffect, useMemo, useState } from 'react';
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
}

const TenantContext = createContext<TenantContextValue | null>(null);

/** Loads the signed-in tenant once per session and exposes its logo URI. */
export function TenantProvider({ children }: PropsWithChildren) {
  const { session } = useAuth();
  const token = session?.token ?? null;
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let active = true;

    if (!token) {
      setTenant(null);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    authenticatedRequest<Tenant>(API_ENDPOINTS.auth.tenant)
      .then((data) => {
        if (active) setTenant(data);
      })
      .catch(() => {
        if (active) setTenant(null);
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });

    return () => {
      active = false;
    };
  }, [token]);

  const value = useMemo(
    () => ({ tenant, logoUri: getTenantLogoUri(tenant), isLoading }),
    [tenant, isLoading],
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
