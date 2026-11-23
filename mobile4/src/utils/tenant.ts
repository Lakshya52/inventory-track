import { getApiBaseUrl } from '@/services/api/client';
import type { Tenant } from '@/types/tenant';

/**
 * Builds the absolute URI for the tenant logo served by
 * GET /api/tenants/:tenantId/logo (a public backend endpoint).
 */
export function getTenantLogoUri(tenant: Tenant | null): string | null {
  if (!tenant?.logoUrl) return null;

  if (/^https?:\/\//i.test(tenant.logoUrl)) {
    return tenant.logoUrl;
  }

  // EXPO_PUBLIC_API_URL already ends with /api, so drop the prefix from the
  // relative URL returned by the backend to avoid duplicating it.
  const path = tenant.logoUrl.startsWith('/api/')
    ? tenant.logoUrl.slice('/api'.length)
    : tenant.logoUrl;

  return `${getApiBaseUrl()}${path.startsWith('/') ? path : `/${path}`}`;
}
