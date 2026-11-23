import * as Sharing from 'expo-sharing';
import { File, Paths } from 'expo-file-system';

import { getApiBaseUrl } from '@/services/api/client';
import { API_ENDPOINTS } from '@/services/api/endpoints';
import { sessionStore } from '@/services/auth/sessionStore';

/**
 * Downloads the packing-list PDF for a dispatch order and opens the native
 * share/save sheet so the dispatcher can store or send the file.
 * Returns the local file URI.
 */
export async function downloadPackingListPdf(orderId: string | number): Promise<string> {
  const token = sessionStore.get()?.token;
  if (!token) throw new Error('Your session has expired. Please sign in again.');

  const baseUrl = getApiBaseUrl();
  if (!baseUrl) throw new Error('API URL is not configured.');

  const destination = new File(Paths.cache, `packing-list-${orderId}.pdf`);
  const file = await File.downloadFileAsync(
    `${baseUrl}${API_ENDPOINTS.dispatchOrders.packingListPdf(orderId)}`,
    destination,
    { headers: { Authorization: `Bearer ${token}` }, idempotent: true },
  );

  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(file.uri, {
      mimeType: 'application/pdf',
      dialogTitle: 'Packing List',
      UTI: 'com.adobe.pdf',
    });
  }

  return file.uri;
}
