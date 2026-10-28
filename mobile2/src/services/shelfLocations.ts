import { apiRequest } from './api';

export type ShelfLocation = {
  id: string;
  location_code: string;
  description: string | null;
  warehouse: string | null;
  rack: string | null;
  shelf: string | null;
  is_active: 0 | 1;
};

export type ShelfLocationPayload = {
  location_code: string;
  description?: string;
  warehouse?: string;
  rack?: string;
  shelf?: string;
};

export async function fetchShelfLocations(): Promise<ShelfLocation[]> {
  return apiRequest<ShelfLocation[]>('/shelf-locations');
}

export async function createShelfLocation(payload: ShelfLocationPayload): Promise<{ id: string }> {
  return apiRequest('/shelf-locations', { method: 'POST', body: payload });
}

export async function updateShelfLocation(
  id: string,
  payload: ShelfLocationPayload,
): Promise<void> {
  await apiRequest(`/shelf-locations/${id}`, { method: 'PUT', body: payload });
}

export async function deleteShelfLocation(id: string): Promise<void> {
  await apiRequest(`/shelf-locations/${id}`, { method: 'DELETE' });
}
