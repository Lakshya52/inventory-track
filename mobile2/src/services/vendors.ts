import { apiRequest } from './api';

export type Vendor = {
  id: string;
  vendor_code: string;
  name: string;
  contact_person: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  gst_number: string | null;
  category: string | null;
  payment_terms: string | null;
  notes: string | null;
  is_active: 0 | 1;
};

export type VendorPayload = {
  name: string;
  contact_person?: string;
  email?: string;
  phone?: string;
  address?: string;
  gst_number?: string;
  category?: string;
  payment_terms?: string;
  notes?: string;
  is_active?: 0 | 1;
};

/** Fetch all vendors (optionally filtered by search query). */
export async function fetchVendors(search?: string): Promise<Vendor[]> {
  const qs = search ? `?q=${encodeURIComponent(search)}` : '';
  return apiRequest<Vendor[]>(`/vendors${qs}`);
}

/** Create a new vendor. Returns the created vendor stub. */
export async function createVendor(
  payload: VendorPayload,
): Promise<{ id: string; vendor_code: string; name: string }> {
  return apiRequest(`/vendors`, { method: 'POST', body: payload });
}

/** Update an existing vendor by id. */
export async function updateVendor(id: string, payload: VendorPayload): Promise<void> {
  await apiRequest(`/vendors/${id}`, { method: 'PUT', body: payload });
}

/** Delete a vendor by id. */
export async function deleteVendor(id: string): Promise<void> {
  await apiRequest(`/vendors/${id}`, { method: 'DELETE' });
}
