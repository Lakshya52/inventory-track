/** Shape returned by GET /api/auth/tenant in the existing backend. */
export interface Tenant {
  id: string;
  name: string;
  email: string;
  phone?: string;
  /** Backend returns "/api/tenants/<id>/logo" when a logo is uploaded, else null. */
  logoUrl: string | null;
  slug?: string;
  updatedAt?: string;
}
