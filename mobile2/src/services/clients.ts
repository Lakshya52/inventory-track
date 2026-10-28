import { apiRequest } from './api';

export type Client = {
  id: string;
  name: string;
  contact_person: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  gst_number: string | null;
  is_active: 0 | 1;
};

export type ClientPayload = {
  name: string;
  contact_person?: string;
  email?: string;
  phone?: string;
  address?: string;
  gst_number?: string;
};

export async function fetchClients(): Promise<Client[]> {
  return apiRequest<Client[]>('/clients');
}

export async function createClient(payload: ClientPayload): Promise<{ id: string }> {
  return apiRequest('/clients', { method: 'POST', body: payload });
}

export async function updateClient(id: string, payload: ClientPayload): Promise<void> {
  await apiRequest(`/clients/${id}`, { method: 'PUT', body: payload });
}

/** The backend deactivates (soft-delete) rather than hard-deletes clients. */
export async function deleteClient(id: string): Promise<void> {
  await apiRequest(`/clients/${id}`, { method: 'DELETE' });
}
