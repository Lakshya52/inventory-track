import AsyncStorage from '@react-native-async-storage/async-storage';
import { apiRequest } from './api';

/**
 * Offline dispatch sync.
 *
 * When the device has no connectivity, loading-session scans / finalisations
 * are persisted locally and pushed to the backend through the bulk sync
 * endpoint (`POST /api/sync/push`) once the network is back.
 */

export type OfflineSyncOperationType =
  | 'LOADING_SESSION_START'
  | 'LOADING_SESSION_SCAN'
  | 'LOADING_SESSION_FINALISE';

export type OfflineSyncOperation = {
  operation_id: string;
  type: OfflineSyncOperationType;
  payload: Record<string, any>;
  client_timestamp: string;
};

export type OfflineQueueStats = {
  pending: number;
  attempted: number;
  applied: number;
  failed: number;
};

const QUEUE_KEY = 'offline_loading_sync_queue';
const DEVICE_UUID_KEY = 'offline_device_uuid';
const MAX_QUEUED_OPERATIONS = 200;

/** True when a failure was caused by missing connectivity (not an API-level error). */
export function isOfflineError(error: unknown): boolean {
  const err = error as { status?: number; code?: string; message?: string } | null;
  if (!err) return false;
  if (err.status === 0) return true;
  const message = String(err.message || '').toLowerCase();
  return (
    message.includes('cannot reach the server') ||
    message.includes('network') ||
    message.includes('failed to fetch') ||
    message.includes('timed out') ||
    err.code === 'NETWORK_ERROR'
  );
}

function createOperationId(type: OfflineSyncOperationType): string {
  // Backend requires: /^[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/
  const prefix = type.slice(0, 2);
  const stamp = Date.now().toString(36).toUpperCase();
  const rand = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `${prefix}${stamp}${rand}`.slice(0, 64);
}

async function getDeviceUuid(): Promise<string> {
  const stored = await AsyncStorage.getItem(DEVICE_UUID_KEY);
  const uuid = typeof stored === 'string' && stored.trim().length > 0 ? stored.trim() : `DISPATCH-${Date.now().toString(36).toUpperCase()}${Math.random()
    .toString(36)
    .slice(2, 8)
    .toUpperCase()}`;
  await AsyncStorage.setItem(DEVICE_UUID_KEY, uuid);
  return uuid;
}

export async function getOfflineOperations(): Promise<OfflineSyncOperation[]> {
  const raw = await AsyncStorage.getItem(QUEUE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as OfflineSyncOperation[]) : [];
  } catch {
    return [];
  }
}

async function saveOfflineOperations(operations: OfflineSyncOperation[]): Promise<void> {
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(operations.slice(0, MAX_QUEUED_OPERATIONS)));
}

export async function getOfflineQueueStats(): Promise<OfflineQueueStats> {
  const operations = await getOfflineOperations();
  return {
    pending: operations.length,
    attempted: operations.length,
    applied: 0,
    failed: 0,
  };
}

export async function enqueueOfflineOperation(
  operation: OfflineSyncOperation,
): Promise<OfflineSyncOperation> {
  const operations = await getOfflineOperations();
  const next = [operation, ...operations.filter((item) => item.operation_id !== operation.operation_id)];
  await saveOfflineOperations(next);
  return operation;
}

export async function enqueueLoadingSessionScan(
  qrValue: string,
  clientOperationId?: string,
): Promise<OfflineSyncOperation> {
  const operationId = clientOperationId && clientOperationId.trim() ? clientOperationId : createOperationId('LOADING_SESSION_SCAN');
  const operation: OfflineSyncOperation = {
    operation_id: operationId,
    type: 'LOADING_SESSION_SCAN',
    payload: {
      qr_value: qrValue.trim(),
      client_operation_id: operationId,
    },
    client_timestamp: new Date().toISOString(),
  };
  return enqueueOfflineOperation(operation);
}

export async function enqueueLoadingSessionStart(
  dispatchOrderId: string | number,
  clientOperationId?: string,
): Promise<OfflineSyncOperation> {
  const operationId = clientOperationId && clientOperationId.trim() ? clientOperationId : createOperationId('LOADING_SESSION_START');
  const operation: OfflineSyncOperation = {
    operation_id: operationId,
    type: 'LOADING_SESSION_START',
    payload: {
      dispatch_order_id: String(dispatchOrderId),
      client_operation_id: operationId,
    },
    client_timestamp: new Date().toISOString(),
  };
  return enqueueOfflineOperation(operation);
}

export async function enqueueLoadingSessionFinalise(
  payload: Record<string, any>,
  clientOperationId?: string,
): Promise<OfflineSyncOperation> {
  const operationId = clientOperationId && clientOperationId.trim() ? clientOperationId : createOperationId('LOADING_SESSION_FINALISE');
  const operation: OfflineSyncOperation = {
    operation_id: operationId,
    type: 'LOADING_SESSION_FINALISE',
    payload: {
      ...payload,
      client_operation_id: operationId,
    },
    client_timestamp: new Date().toISOString(),
  };
  return enqueueOfflineOperation(operation);
}

export async function flushOfflineOperations(): Promise<OfflineQueueStats> {
  const operations = await getOfflineOperations();
  if (operations.length === 0) {
    return { pending: 0, attempted: 0, applied: 0, failed: 0 };
  }

  const response = await apiRequest<{ results?: { operation_id?: string; status?: string }[] }>('/sync/push', {
    method: 'POST',
    body: {
      device_uuid: await getDeviceUuid(),
      operations,
    },
  });

  const results = Array.isArray(response?.results) ? response.results : [];
  const appliedIds = new Set<string>();
  for (const result of results) {
    if (result?.status === 'APPLIED' || result?.status === 'DUPLICATE') {
      const id = typeof result?.operation_id === 'string' ? result.operation_id : null;
      if (id) {
        appliedIds.add(id);
      }
    }
  }

  const failed = operations.filter((operation) => !appliedIds.has(operation.operation_id));
  await saveOfflineOperations(failed);

  return {
    pending: failed.length,
    attempted: operations.length,
    applied: operations.length - failed.length,
    failed: failed.length,
  };
}

export async function clearOfflineOperations(): Promise<void> {
  await saveOfflineOperations([]);
}
