import { api } from '../api/client';
import { getDeviceId } from '../auth/authStorage';
import {
  applyPull,
  clearLocalPendingForBatch,
  deleteLocalOrderByOperation,
  getDueOperations,
  getMeta,
  markOutboxApplied,
  markOutboxIssue,
  setBatchLocalStatus,
  setMeta,
  updateOutboxPayload,
} from '../db/database';
import type { AuthSession, EntityId, OutboxOperation, SyncResult } from '../types';
import { MAX_SYNC_BATCH } from '../config';

const BACKOFF_MS = [30_000, 120_000, 300_000, 900_000, 3_600_000, 14_400_000];

function isLocalImage(uri: string): boolean {
  return /^(file|content|ph|assets-library):\/\//.test(uri);
}

function nextAttemptAt(attempts: number): string | null {
  if (attempts >= BACKOFF_MS.length) return null;
  return new Date(Date.now() + BACKOFF_MS[Math.max(0, attempts - 1)]).toISOString();
}

async function prepareOperation(operation: OutboxOperation): Promise<OutboxOperation> {
  const payload = { ...operation.payload };
  if (Array.isArray(payload.images)) {
    const local = payload.images.filter((uri: unknown) => typeof uri === 'string' && isLocalImage(uri));
    if (local.length > 0) {
      const uploaded = await api.uploadAttachments(local);
      payload.images = [
        ...payload.images.filter((uri: unknown) => typeof uri === 'string' && !isLocalImage(uri)),
        ...uploaded,
      ];
      await updateOutboxPayload(operation.operation_id, payload);
    }
  }
  return { ...operation, payload };
}

async function applyLocalPending(operation: OutboxOperation): Promise<void> {
  const batchIds = affectedBatchIds(operation);
  if (batchIds.length === 0) return;
  const status = operation.type.startsWith('QC_SUBMIT')
    ? (String(operation.payload.result).toUpperCase() === 'PASS' ? 'QC_PASSED' : 'QC_FAILED')
    : operation.type.startsWith('DISPATCH_CONFIRM') ? 'DISPATCHED'
      : operation.type === 'DISPATCH_ORDER_RAISE' ? 'DISPATCH_ORDER_RAISED' : null;
  if (!status) return;
  for (const batchId of batchIds) await setBatchLocalStatus(batchId, status, 1);
}

function affectedBatchIds(operation: OutboxOperation, result?: SyncResult): EntityId[] {
  const values = result?.data?.batch_ids ?? operation.payload.batch_ids;
  if (Array.isArray(values)) {
    const ids = values.filter((value): value is EntityId =>
      typeof value === 'string' ? value.trim().length > 0 : typeof value === 'number' && Number.isFinite(value)
    );
    return [...new Map(ids.map((id) => [String(id), id])).values()];
  }
  const single = result?.data?.batch_id ?? operation.payload.batch_id;
  return typeof single === 'string' ? (single.trim() ? [single] : [])
    : typeof single === 'number' && Number.isFinite(single) ? [single] : [];
}

async function applyLocalSuccess(operation: OutboxOperation, result: SyncResult): Promise<void> {
  const batchIds = affectedBatchIds(operation, result);
  if (operation.type === 'QC_SUBMIT' || operation.type === 'QC_SUBMIT_BULK') {
    const status =
      result.data?.status ||
      (String(operation.payload.result).toUpperCase() === 'PASS' ? 'QC_PASSED' : 'QC_FAILED');
    for (const batchId of batchIds) await setBatchLocalStatus(batchId, status, 0);
    return;
  }
  if (operation.type === 'DISPATCH_ORDER_RAISE') {
    await deleteLocalOrderByOperation(operation.operation_id);
    for (const batchId of batchIds) await setBatchLocalStatus(batchId, 'DISPATCH_ORDER_RAISED', 0);
    return;
  }
  if (operation.type === 'DISPATCH_CONFIRM' || operation.type === 'DISPATCH_CONFIRM_BULK') {
    for (const batchId of batchIds) await setBatchLocalStatus(batchId, 'DISPATCHED', 0);
  }
}

async function applyLocalIssue(operation: OutboxOperation): Promise<void> {
  const batchIds = affectedBatchIds(operation);
  if (operation.type === 'DISPATCH_ORDER_RAISE') {
    await deleteLocalOrderByOperation(operation.operation_id);
  }
  const fallbackStatus = operation.type.startsWith('QC_SUBMIT') ? 'CREATED'
    : operation.type.startsWith('DISPATCH_CONFIRM') ? 'DISPATCH_APPROVED'
      : operation.type === 'DISPATCH_ORDER_RAISE' ? 'QC_PASSED' : null;
  for (const batchId of batchIds) {
    const savedStatus = operation.payload.previous_statuses?.[String(batchId)];
    const expectedStatus = operation.type === 'DISPATCH_ORDER_RAISE'
      ? operation.payload.expected_status : undefined;
    const previousStatus = typeof savedStatus === 'string' && savedStatus
      ? savedStatus
      : typeof expectedStatus === 'string' && expectedStatus
        ? expectedStatus : fallbackStatus;
    if (previousStatus) await setBatchLocalStatus(batchId, previousStatus, 0);
    else await clearLocalPendingForBatch(batchId);
  }
}

async function handleResult(operation: OutboxOperation, result: SyncResult): Promise<void> {
  if (result.status === 'APPLIED' || result.status === 'DUPLICATE') {
    await markOutboxApplied(operation.operation_id, result.entity_type, result.entity_id);
    await applyLocalSuccess(operation, result);
    return;
  }
  if (result.status === 'CONFLICT') {
    await markOutboxIssue(
      operation.operation_id,
      'CONFLICT',
      result.error || 'This record changed on the server while you were offline.',
      operation.attempts + 1,
      null
    );
    await applyLocalIssue(operation);
    return;
  }
  const attempts = operation.attempts + 1;
  await markOutboxIssue(
    operation.operation_id,
    'FAILED',
    result.error || 'The server could not apply this operation.',
    attempts,
    nextAttemptAt(attempts)
  );
  await applyLocalIssue(operation);
}

export interface PushSummary {
  pushed: number;
  applied: number;
  duplicates: number;
  conflicts: number;
  failed: number;
}

export async function pushOutbox(session: AuthSession): Promise<PushSummary> {
  const operations = await getDueOperations(MAX_SYNC_BATCH);
  if (operations.length === 0) {
    return { pushed: 0, applied: 0, duplicates: 0, conflicts: 0, failed: 0 };
  }

  const prepared: OutboxOperation[] = [];
  for (const operation of operations) {
    // Failed rows can become due for automatic retry after their backoff.
    // Reapply the optimistic state before sending so the cache stays aligned
    // with the pending work while that retry is in flight.
    await applyLocalPending(operation);
    prepared.push(await prepareOperation(operation));
  }

  const deviceId = await getDeviceId();
  const response = await api.push(
    deviceId,
    prepared.map((operation) => {
      // This rollback snapshot belongs only to the local SQLite cache; the
      // backend needs the operation itself, not device-specific UI state.
      const payload = { ...operation.payload };
      delete payload.previous_statuses;
      return {
        operation_id: operation.operation_id,
        type: operation.type,
        payload,
        client_timestamp: operation.client_timestamp,
      };
    })
  );

  for (let i = 0; i < prepared.length; i += 1) {
    const result = response.results[i];
    if (result) await handleResult(prepared[i], result);
  }

  return {
    pushed: prepared.length,
    applied: response.applied,
    duplicates: response.duplicates,
    conflicts: response.conflicts,
    failed: response.failed,
  };
}

export async function pullChanges(session: AuthSession): Promise<void> {
  let cursor = Number((await getMeta('cursor')) || 0);
  const deviceId = await getDeviceId();
  let lastCounts: unknown = null;

  for (let page = 0; page < 20; page += 1) {
    const data = await api.pull(cursor, deviceId);
    await applyPull(data);
    cursor = Number(data.cursor || cursor);
    await setMeta('cursor', String(cursor));
    lastCounts = data.counts;
    if (!data.has_more) break;
  }

  await setMeta('last_sync_at', new Date().toISOString());
  if (lastCounts) await setMeta('last_counts', JSON.stringify(lastCounts));
}

export async function syncNow(session: AuthSession): Promise<PushSummary> {
  const summary = await pushOutbox(session);
  await pullChanges(session);
  return summary;
}

export async function initialSync(session: AuthSession): Promise<void> {
  const deviceId = await getDeviceId();
  await api.registerDevice(deviceId);
  // Flush queued offline work before pulling so local field changes are not
  // overwritten by a server snapshot when the user signs back in.
  await pushOutbox(session);
  await pullChanges(session);
}
