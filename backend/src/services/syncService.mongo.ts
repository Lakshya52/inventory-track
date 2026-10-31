import { randomUUID } from 'crypto';
import {
  DbContext,
  getContext,
  idKey,
  isDuplicateKey,
  isValidId,
  now,
  parseDateValue,
  withTransaction,
} from '../config/database.mongo';
import {
  JwtPayload,
  SyncOperationInput,
  SyncOperationResult,
  SyncOperationStatus,
  SyncOperationType,
} from '../types';
import { batchQrStats, EntityId } from './queryService';

export class SyncError extends Error {
  constructor(
    message: string,
    public readonly code: string = 'SYNC_ERROR',
    public readonly httpStatus: number = 400,
    public readonly details?: Record<string, any>
  ) {
    super(message);
    this.name = 'SyncError';
  }
}

export class SyncConflictError extends SyncError {
  constructor(message: string, details?: Record<string, any>) {
    super(message, 'CONFLICT', 409, details);
    this.name = 'SyncConflictError';
  }
}

const OPERATION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/;
const DEVICE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9:_-]{7,99}$/;
const ALLOWED_TYPES = new Set<SyncOperationType>([
  'QC_SUBMIT',
  'QC_SUBMIT_BULK',
  'DISPATCH_ORDER_RAISE',
  'DISPATCH_CONFIRM',
  'DISPATCH_CONFIRM_BULK',
  'BATCH_CREATE_AUTO_PASS',
  'QC_ORDER_APPROVE',
  'QC_ORDER_REJECT',
  'LOADING_SESSION_START',
  'LOADING_SESSION_SCAN',
  'LOADING_SESSION_FINALISE',
]);

function safeJson(value: unknown): any {
  try {
    return JSON.parse(String(value));
  } catch {
    return null;
  }
}

function toDate(value: unknown): Date | null {
  return parseDateValue(value);
}

function toJson(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

function validateOperation(input: SyncOperationInput): void {
  if (!input || typeof input !== 'object') {
    throw new SyncError('Invalid sync operation', 'INVALID_OPERATION');
  }
  if (!input.operation_id || !OPERATION_ID_PATTERN.test(input.operation_id)) {
    throw new SyncError('operation_id must be 8-64 URL-safe characters', 'INVALID_OPERATION_ID');
  }
  if (!ALLOWED_TYPES.has(input.type)) {
    throw new SyncError(`Unsupported operation type: ${String(input.type)}`, 'INVALID_OPERATION_TYPE');
  }
  if (!input.payload || typeof input.payload !== 'object' || Array.isArray(input.payload)) {
    throw new SyncError('payload must be an object', 'INVALID_PAYLOAD');
  }
}

async function findExistingOperation(
  ctx: DbContext,
  operationId: string
): Promise<SyncOperationResult | null> {
  const row = await ctx.findOne('sync_operations', { operation_id: operationId });
  if (!row) return null;
  const result = row.result ? safeJson(row.result) : null;
  return {
    operation_id: row.operation_id,
    status: row.status === 'APPLIED' ? 'DUPLICATE' : row.status,
    entity_type: row.entity_type || null,
    entity_id: row.entity_id === null || row.entity_id === undefined ? null : row.entity_id,
    data: result?.data ?? null,
    error: row.error_message || null,
    error_code: row.error_code || null,
    user_id: row.user_id,
    user_role: row.user_role,
  };
}

async function recordOperation(
  ctx: DbContext,
  user: JwtPayload,
  deviceUuid: string | null,
  input: SyncOperationInput,
  status: SyncOperationStatus,
  errorCode: string | null,
  errorMessage: string | null,
  result: SyncOperationResult
): Promise<void> {
  await ctx.updateOne('sync_operations', { operation_id: input.operation_id }, {
    $set: {
      operation_id: input.operation_id,
      device_uuid: deviceUuid,
      user_id: user.userId,
      user_role: user.role,
      operation_type: input.type,
      entity_type: result.entity_type,
      entity_id: result.entity_id,
      status,
      error_code: errorCode,
      error_message: errorMessage,
      payload: toJson(input.payload),
      result: toJson({ data: result.data ?? null }),
      client_timestamp: toDate(input.client_timestamp),
      server_timestamp: now(),
    },
  }, { upsert: true });
}

async function getBatchForUpdate(
  ctx: DbContext,
  payload: Record<string, any>
): Promise<Record<string, any>> {
  const barcode = typeof payload.barcode_value === 'string' ? payload.barcode_value.trim() : '';
  const batchId = payload.batch_id;
  if (!barcode && !isValidId(batchId)) {
    throw new SyncError('barcode_value or batch_id is required', 'BATCH_REFERENCE_REQUIRED');
  }

  let batch: Record<string, any> | null = null;
  if (barcode) {
    batch = await ctx.findOne('batches', { barcode_value: barcode }, { projection: { _id: 0 } });
    if (!batch) {
      const label = await ctx.findOne('qr_labels', { qr_value: barcode }, {
        projection: { _id: 0, batch_id: 1 },
      });
      if (label) {
        batch = await ctx.findOne('batches', { id: label.batch_id }, { projection: { _id: 0 } });
      }
    }
  } else {
    batch = await ctx.findOne('batches', { id: batchId }, { projection: { _id: 0 } });
  }
  if (!batch) {
    throw new SyncError('Batch not found', 'BATCH_NOT_FOUND', 404);
  }

  const product = await ctx.findOne('products', { id: batch.product_id }, { projection: { _id: 0 } });
  const stats = await batchQrStats(ctx, [batch.id as EntityId]);
  return {
    ...batch,
    product_name: product?.name ?? null,
    product_sku: product?.sku ?? null,
    cas_number: product?.cas_number ?? null,
    molecular_formula: product?.molecular_formula ?? null,
    product_grade: product?.grade ?? null,
    product_purity: product?.purity ?? null,
    qr_count: stats.get(idKey(batch.id))?.count ?? 0,
  };
}

function assertStatus(batch: Record<string, any>, expected: string[], message: string): void {
  if (!expected.includes(String(batch.status))) {
    throw new SyncConflictError(message, {
      batch_id: batch.id,
      batch_number: batch.batch_number,
      current_status: batch.status,
    });
  }
}

function imageList(payload: Record<string, any>): string[] {
  if (!Array.isArray(payload.images)) return [];
  return payload.images
    .filter((item: unknown) => typeof item === 'string' && item.length > 0 && item.length <= 255)
    .slice(0, 5);
}

function bulkBarcodes(payload: Record<string, any>): string[] {
  const raw = Array.isArray(payload.barcodes)
    ? payload.barcodes
    : typeof payload.barcode_value === 'string'
      ? [payload.barcode_value]
      : [];
  const seen = new Set<string>();
  for (const value of raw) {
    if (typeof value !== 'string') continue;
    const barcode = value.trim();
    if (!barcode) continue;
    seen.add(barcode);
    if (seen.size >= 1000) break;
  }
  return [...seen];
}

async function getBatchesForUpdate(
  ctx: DbContext,
  barcodes: string[]
): Promise<Record<string, any>[]> {
  if (barcodes.length === 0) {
    throw new SyncError('At least one QR code is required', 'BATCH_REFERENCE_REQUIRED');
  }

  const [labelRows, legacyRows] = await Promise.all([
    ctx.find('qr_labels', { qr_value: { $in: barcodes } }, {
      projection: { _id: 0, qr_value: 1, batch_id: 1 },
    }),
    ctx.find('batches', { barcode_value: { $in: barcodes } }, {
      projection: { _id: 0, barcode_value: 1, id: 1 },
    }),
  ]);
  const codeToBatch = new Map<string, EntityId>();
  for (const row of labelRows) codeToBatch.set(String(row.qr_value), row.batch_id as EntityId);
  for (const row of legacyRows) codeToBatch.set(String(row.barcode_value), row.id as EntityId);
  const missing = barcodes.filter((barcode) => !codeToBatch.has(barcode));
  if (missing.length > 0) {
    throw new SyncConflictError('Some QR codes were not found', { missing_barcodes: missing });
  }

  const seenBatchIds = new Set<string>();
  const batchIds: EntityId[] = [];
  for (const barcode of barcodes) {
    const batchId = codeToBatch.get(barcode)!;
    const key = idKey(batchId);
    if (seenBatchIds.has(key)) continue;
    seenBatchIds.add(key);
    batchIds.push(batchId);
  }
  const batches = await ctx.find('batches', { id: { $in: batchIds } }, {
    sort: { created_at: 1 },
    projection: { _id: 0 },
  });
  const productIds = batches.map((batch) => batch.product_id as EntityId);
  const products = productIds.length > 0
    ? await ctx.find('products', { id: { $in: productIds } }, { projection: { _id: 0 } })
    : [];
  const productMap = new Map(products.map((product) => [idKey(product.id), product]));
  const stats = await batchQrStats(ctx, batchIds);
  const enriched: Record<string, any>[] = batches.map((batch) => {
    const product = productMap.get(idKey(batch.product_id));
    return {
      ...batch,
      product_name: product?.name ?? null,
      product_sku: product?.sku ?? null,
      qr_count: stats.get(idKey(batch.id))?.count ?? 0,
    };
  });

  const scannedCounts = new Map<string, number>();
  const scannedCodes = new Map<string, Set<string>>();
  for (const barcode of barcodes) {
    const batchId = idKey(codeToBatch.get(barcode)!);
    scannedCounts.set(batchId, (scannedCounts.get(batchId) || 0) + 1);
    const codes = scannedCodes.get(batchId) || new Set<string>();
    codes.add(barcode);
    scannedCodes.set(batchId, codes);
  }
  const expectedLabelRows = await ctx.find('qr_labels', { batch_id: { $in: batchIds } }, {
    projection: { _id: 0, batch_id: 1, qr_value: 1 },
  });
  const expectedCodes = new Map<string, Set<string>>();
  for (const row of expectedLabelRows) {
    const batchId = idKey(row.batch_id);
    const codes = expectedCodes.get(batchId) || new Set<string>();
    codes.add(String(row.qr_value));
    expectedCodes.set(batchId, codes);
  }
  const incomplete = enriched.filter((batch) =>
    Number(batch.qr_count) > 0 &&
    (Number(batch.qr_count) !== Number(batch.quantity) ||
      scannedCounts.get(idKey(batch.id)) !== Number(batch.qr_count) ||
      [...(expectedCodes.get(idKey(batch.id)) || [])].some(
        (code) => !scannedCodes.get(idKey(batch.id))?.has(code)
      ))
  );
  if (incomplete.length > 0) {
    throw new SyncConflictError('Scan every unit QR code in each batch before submitting this group', {
      incomplete_batches: incomplete.map((batch) => ({
        batch_id: batch.id,
        batch_number: batch.batch_number,
        expected_qr_count: Number(batch.qr_count),
        scanned_qr_count: scannedCounts.get(idKey(batch.id)) || 0,
      })),
    });
  }
  return enriched;
}

async function logActivity(
  ctx: DbContext,
  user: JwtPayload,
  action: string,
  description: string
): Promise<void> {
  await ctx.insert('activity_logs', {
    user_id: user.userId,
    user_name: user.name || user.role,
    user_role: user.role,
    action,
    description,
  });
}

/**
 * Removes dispatched units from the product's stock counter. Stock is clamped
 * at zero so a missing production entry can never create a negative balance.
 * The update is a single atomic pipeline so concurrent dispatches cannot
 * overwrite each other on standalone MongoDB (which has no transactions).
 */
async function deductProductStock(
  ctx: DbContext,
  productId: EntityId,
  quantity: number
): Promise<number | null> {
  if (!isValidId(productId) || !Number.isFinite(quantity) || quantity <= 0) {
    return null;
  }
  const result = await ctx.findOneAndUpdate('products', { id: productId }, [
    {
      $set: {
        quantity: {
          $cond: [
            { $lt: [{ $subtract: [{ $ifNull: ['$quantity', 0] }, quantity] }, 0] },
            0,
            { $subtract: [{ $ifNull: ['$quantity', 0] }, quantity] },
          ],
        },
        updated_at: now(),
      },
    },
  ], { returnDocument: 'after' });
  return result ? Number((result as Record<string, any>).quantity) : null;
}

async function applyQcSubmit(
  ctx: DbContext,
  user: JwtPayload,
  deviceUuid: string | null,
  input: SyncOperationInput
): Promise<{ entityType: string; entityId: EntityId; data: Record<string, any> }> {
  if (!['QC', 'ADMIN'].includes(user.role)) {
    throw new SyncError('Only QC or admin users can submit QC results', 'FORBIDDEN', 403);
  }
  const payload = input.payload;
  const result = String(payload.result || '').toUpperCase();
  if (!['PASS', 'FAIL'].includes(result)) {
    throw new SyncError('result must be PASS or FAIL', 'INVALID_RESULT');
  }
  const remarks = typeof payload.remarks === 'string' ? payload.remarks.slice(0, 4000) : null;
  const images = imageList(payload);

  const batch = await getBatchForUpdate(ctx, payload);
  if (Number(batch.qr_count) > 0) {
    throw new SyncConflictError('Scan every unit QR code in the batch before submitting QC', {
      batch_id: batch.id,
      batch_number: batch.batch_number,
      expected_qr_count: Number(batch.qr_count),
      scanned_qr_count: 1,
    });
  }
  if (payload.expected_status && String(payload.expected_status) !== String(batch.status)) {
    throw new SyncConflictError('Batch status changed while this QC test was offline', {
      batch_id: batch.id,
      expected_status: payload.expected_status,
      current_status: batch.status,
    });
  }
  assertStatus(batch, ['CREATED'], `QC can only be submitted for CREATED batches. Current status: ${batch.status}`);

  const newStatus = result === 'PASS' ? 'QC_PASSED' : 'QC_FAILED';
  const qcRecordId = await ctx.insert('qc_records', {
    batch_id: batch.id,
    tester_id: user.userId,
    result,
    remarks,
    images: images.length > 0 ? JSON.stringify(images) : null,
    client_operation_id: input.operation_id,
    client_created_at: toDate(input.client_timestamp),
    device_uuid: deviceUuid,
  });

  const update = await ctx.updateOne('batches', { id: batch.id, status: 'CREATED' }, {
    $set: { status: newStatus },
  });
  if (update.matchedCount !== 1) {
    throw new SyncConflictError('Batch was changed by another user. Refresh and try again.', {
      batch_id: batch.id,
      current_status: batch.status,
    });
  }

  await logActivity(
    ctx,
    user,
    result === 'PASS' ? 'QC_PASSED' : 'QC_FAILED',
    `Batch ${batch.batch_number} (${batch.product_name}) - ${result}`
  );

  return {
    entityType: 'qc_record',
    entityId: qcRecordId,
    data: {
      status: newStatus,
      batch_id: batch.id,
      batch_number: batch.batch_number,
      qc_record_id: qcRecordId,
      result,
      images,
    },
  };
}

async function applyQcSubmitBulk(
  ctx: DbContext,
  user: JwtPayload,
  deviceUuid: string | null,
  input: SyncOperationInput
): Promise<{ entityType: string; entityId: EntityId; data: Record<string, any> }> {
  if (!['QC', 'ADMIN'].includes(user.role)) {
    throw new SyncError('Only QC or admin users can submit QC results', 'FORBIDDEN', 403);
  }
  const payload = input.payload;
  const result = String(payload.result || '').toUpperCase();
  if (!['PASS', 'FAIL'].includes(result)) {
    throw new SyncError('result must be PASS or FAIL', 'INVALID_RESULT');
  }
  const remarks = typeof payload.remarks === 'string' ? payload.remarks.slice(0, 4000) : null;
  const images = imageList(payload);
  const barcodes = bulkBarcodes(payload);
  const batches = await getBatchesForUpdate(ctx, barcodes);

  const invalid = batches.filter((batch) => String(batch.status) !== 'CREATED');
  if (invalid.length > 0) {
    throw new SyncConflictError('One or more QR codes are no longer waiting for QC', {
      invalid_batches: invalid.map((batch) => ({
        batch_id: batch.id,
        batch_number: batch.batch_number,
        barcode_value: batch.barcode_value,
        current_status: batch.status,
      })),
    });
  }

  const newStatus = result === 'PASS' ? 'QC_PASSED' : 'QC_FAILED';
  const recordIds: EntityId[] = [];
  for (const batch of batches) {
    const recordId = await ctx.insert('qc_records', {
      batch_id: batch.id,
      tester_id: user.userId,
      result,
      remarks,
      images: images.length > 0 ? JSON.stringify(images) : null,
      group_operation_id: input.operation_id,
      client_created_at: toDate(input.client_timestamp),
      device_uuid: deviceUuid,
    });
    recordIds.push(recordId);
    const update = await ctx.updateOne('batches', { id: batch.id, status: 'CREATED' }, {
      $set: { status: newStatus },
    });
    if (update.matchedCount !== 1) {
      throw new SyncConflictError('A QR code was changed by another user. Refresh and try again.', {
        batch_id: batch.id,
        current_status: batch.status,
      });
    }
  }

  await logActivity(
    ctx,
    user,
    result === 'PASS' ? 'QC_PASSED_GROUP' : 'QC_FAILED_GROUP',
    `QC ${result} applied to ${batches.length} QR code${batches.length === 1 ? '' : 's'}`
  );

  return {
    entityType: 'qc_group',
    entityId: recordIds[0],
    data: {
      status: newStatus,
      count: batches.length,
      batch_ids: batches.map((batch) => batch.id),
      batch_numbers: batches.map((batch) => batch.batch_number),
      qc_record_ids: recordIds,
      result,
      images,
    },
  };
}

async function applyDispatchOrderRaise(
  ctx: DbContext,
  user: JwtPayload,
  deviceUuid: string | null,
  input: SyncOperationInput
): Promise<{ entityType: string; entityId: EntityId; data: Record<string, any> }> {
  if (!['DISPATCH', 'ADMIN'].includes(user.role)) {
    throw new SyncError('Only dispatch or admin users can raise dispatch orders', 'FORBIDDEN', 403);
  }
  const clientId = input.payload.client_id as EntityId;
  if (!isValidId(clientId)) {
    throw new SyncError('Select a client for this dispatch order', 'DISPATCH_CLIENT_REQUIRED');
  }
  const client = await ctx.findOne('clients', { id: clientId, is_active: 1 }, { projection: { id: 1 } });
  if (!client) {
    throw new SyncError('Selected client is no longer active', 'CLIENT_NOT_FOUND', 404);
  }
  if (Array.isArray(input.payload.items)) {
    const requested = input.payload.items as Array<Record<string, any>>;
    if (requested.length < 1 || requested.length > 100) throw new SyncError('An order must contain between 1 and 100 product lines', 'INVALID_ORDER_LINES');
    const seen = new Set<string>();
    const lines: Array<Record<string, any>> = [];
    const assignments: Array<{ batchId: EntityId; labelIds: EntityId[] }> = [];
    for (const line of requested) {
      const batch = await getBatchForUpdate(ctx, { batch_id: line.batch_id });
      const batchKey = idKey(batch.id);
      if (seen.has(batchKey)) throw new SyncError('A batch can appear only once in a dispatch order', 'DUPLICATE_ORDER_LINE');
      seen.add(batchKey);
      const quantity = Number(line.quantity);
      if (!Number.isInteger(quantity) || quantity < 1) throw new SyncError('Each product line needs a whole-number quantity greater than zero', 'INVALID_DISPATCH_QUANTITY');
      if (!['QC_PASSED', 'DISPATCH_APPROVED'].includes(String(batch.status))) throw new SyncError(`Batch ${batch.batch_number} is not available for dispatch`, 'INVALID_BATCH_STATE', 409);
      const qrCount = await ctx.count('qr_labels', { batch_id: batch.id });
      if (qrCount !== Number(batch.quantity)) throw new SyncConflictError(`QR labels are incomplete for ${batch.batch_number}`, { batch_id: batch.id, expected: Number(batch.quantity), actual: qrCount });
      const reserved = await ctx.count('qr_labels', { batch_id: batch.id, dispatch_order_id: { $exists: true, $ne: null } });
      const recalled = await ctx.count('qr_labels', { batch_id: batch.id, recall_status: 'RECALLED' });
      const available = Math.max(0, Number(batch.quantity) - reserved - recalled);
      if (quantity > available) throw new SyncConflictError(`Only ${available} units remain for ${batch.product_name}`, { batch_id: batch.id, available_quantity: available, requested_quantity: quantity });
      const labels = await ctx.find('qr_labels', { batch_id: batch.id, recall_status: { $ne: 'RECALLED' }, $or: [{ dispatch_order_id: { $exists: false } }, { dispatch_order_id: null }] }, { sort: { serial_no: 1 }, limit: quantity, projection: { _id: 0, id: 1 } });
      if (labels.length !== quantity) throw new SyncConflictError(`Not enough unassigned QR labels remain for ${batch.product_name}`, { available_quantity: labels.length, requested_quantity: quantity });
      const location = batch.shelf_location_id ? await ctx.findOne('shelf_locations', { id: batch.shelf_location_id }, { projection: { _id: 0, location_code: 1, description: 1 } }) : null;
      const lineSnapshot = { batch_id: batch.id, batch_number: batch.parent_batch_number || batch.batch_number, product_name: batch.product_name, product_sku: batch.product_sku, quantity, uom: batch.uom, location: location?.location_code || batch.storage_location || 'N/A', location_code: location?.location_code ?? null, location_description: location?.description ?? null };
      lines.push(lineSnapshot);
      assignments.push({ batchId: batch.id as EntityId, labelIds: labels.map((label) => label.id as EntityId) });
    }
    const total = lines.reduce((sum, line) => sum + Number(line.quantity), 0);
    const orderId = await ctx.insert('dispatch_orders', { batch_id: lines[0].batch_id, order_lines: lines, tenant_id: user.tenantId, raised_by: user.userId, status: 'APPROVED', admin_id: null, client_id: clientId, quantity: total, client_operation_id: input.operation_id, client_created_at: toDate(input.client_timestamp), device_uuid: deviceUuid, driver_name: null, driver_phone: null, vehicle_number: null, container_number: null, dispatched_at: null });
    for (const assignment of assignments) for (const labelId of assignment.labelIds) {
      const assigned = await ctx.updateOne('qr_labels', { id: labelId, batch_id: assignment.batchId, $or: [{ dispatch_order_id: { $exists: false } }, { dispatch_order_id: null }] }, { $set: { dispatch_order_id: orderId } });
      if (assigned.matchedCount !== 1) throw new SyncConflictError('A QR label was assigned to another order. Refresh and retry.', { batch_id: assignment.batchId });
    }
    for (const line of lines) await ctx.insert('packing_list_items', { dispatch_order_id: orderId, ...line });
    await logActivity(ctx, user, 'DISPATCH_ORDER_RAISED', `Dispatch order ${orderId} created with ${lines.length} product lines and ${total} units`);
    return { entityType: 'dispatch_order', entityId: orderId, data: { id: orderId, batch_id: lines[0].batch_id, batch_number: lines.length === 1 ? lines[0].batch_number : `Multi-product order`, product_name: lines.length === 1 ? lines[0].product_name : `${lines.length} products`, quantity: total, items: lines, status: 'APPROVED' } };
  }
  const batch = await getBatchForUpdate(ctx, input.payload);
  const requestedQuantity = Number(input.payload.quantity);
  if (!Number.isInteger(requestedQuantity) || requestedQuantity < 1) {
    throw new SyncError('Enter a whole-number dispatch quantity greater than zero', 'INVALID_DISPATCH_QUANTITY');
  }
  if (input.payload.expected_status && String(input.payload.expected_status) !== String(batch.status)) {
    throw new SyncConflictError('Batch status changed while this order was offline', {
      batch_id: batch.id,
      expected_status: input.payload.expected_status,
      current_status: batch.status,
    });
  }
  if (!['QC_PASSED', 'DISPATCH_APPROVED'].includes(String(batch.status))) {
    throw new SyncError(
      `Dispatch order can only be raised for QC_PASSED batches. Current status: ${batch.status}`,
      'INVALID_BATCH_STATE',
      409,
      {
        batch_id: batch.id,
        batch_number: batch.batch_number,
        current_status: batch.status,
      }
    );
  }
  if (!batch.fg_details_completed_at) {
    const labelCount = await ctx.count('qr_labels', { batch_id: batch.id });
    if (labelCount !== Number(batch.quantity)) {
      throw new SyncConflictError('Complete finished-goods details and generate bag QR labels before raising a dispatch order', {
        batch_id: batch.id,
        expected_qr_count: Number(batch.quantity),
        actual_qr_count: labelCount,
      });
    }
  }
  if (Number(batch.quantity) > 1) {
    const labelCount = await ctx.count('qr_labels', { batch_id: batch.id });
    if (labelCount !== Number(batch.quantity)) {
      throw new SyncConflictError('Batch unit QR labels are incomplete. Contact an administrator.', {
        batch_id: batch.id,
        expected_qr_count: Number(batch.quantity),
        actual_qr_count: labelCount,
      });
    }
  }

  const reservedLabels = await ctx.count('qr_labels', { batch_id: batch.id, dispatch_order_id: { $exists: true, $ne: null } });
  const recalledLabels = await ctx.count('qr_labels', { batch_id: batch.id, recall_status: 'RECALLED' });
  const availableQuantity = Math.max(0, Number(batch.quantity) - reservedLabels - recalledLabels);
  if (requestedQuantity > availableQuantity) {
    throw new SyncConflictError(`Only ${availableQuantity} units remain available in this batch`, { batch_id: batch.id, available_quantity: availableQuantity, requested_quantity: requestedQuantity });
  }
  const labels = await ctx.find('qr_labels', { batch_id: batch.id, recall_status: { $ne: 'RECALLED' }, $or: [{ dispatch_order_id: { $exists: false } }, { dispatch_order_id: null }] }, { sort: { serial_no: 1 }, limit: requestedQuantity, projection: { _id: 0, id: 1 } });
  if (labels.length < requestedQuantity) throw new SyncConflictError('Not enough unassigned QR labels remain in this batch', { available_quantity: labels.length, requested_quantity: requestedQuantity });

  const orderId = await ctx.insert('dispatch_orders', {
    batch_id: batch.id,
    raised_by: user.userId,
    status: 'APPROVED',
    admin_id: null,
    admin_remarks: null,
    client_id: clientId,
    quantity: requestedQuantity,
    driver_name: null,
    driver_phone: null,
    vehicle_number: null,
    container_number: null,
    client_operation_id: input.operation_id,
    client_created_at: toDate(input.client_timestamp),
    device_uuid: deviceUuid,
    dispatched_at: null,
  });

  for (const label of labels) {
    const assigned = await ctx.updateOne('qr_labels', { id: label.id, batch_id: batch.id, $or: [{ dispatch_order_id: { $exists: false } }, { dispatch_order_id: null }] }, { $set: { dispatch_order_id: orderId } });
    if (assigned.matchedCount !== 1) throw new SyncConflictError('A QR label was assigned to another order. Refresh and retry.', { batch_id: batch.id });
  }

  await logActivity(
    ctx,
    user,
    'DISPATCH_ORDER_RAISED',
    `Dispatch order created for batch ${batch.batch_number} (${batch.product_name}); ${requestedQuantity} units allocated for loading`
  );

  return {
    entityType: 'dispatch_order',
    entityId: orderId,
    data: {
      id: orderId,
      batch_id: batch.id,
      batch_number: batch.batch_number,
      product_name: batch.product_name,
      quantity: requestedQuantity,
    status: 'APPROVED',
    },
  };
}

async function applyDispatchConfirm(
  ctx: DbContext,
  user: JwtPayload,
  deviceUuid: string | null,
  input: SyncOperationInput
): Promise<{ entityType: string; entityId: EntityId; data: Record<string, any> }> {
  if (!['DISPATCH', 'ADMIN'].includes(user.role)) {
    throw new SyncError('Only dispatch or admin users can confirm dispatches', 'FORBIDDEN', 403);
  }
  const payload = input.payload;
  const remarks = typeof payload.remarks === 'string' ? payload.remarks.slice(0, 4000) : null;
  const images = imageList(payload);
  const batch = await getBatchForUpdate(ctx, payload);
  if (Number(batch.quantity) > 1) {
    throw new SyncConflictError('Scan every unit QR code in the batch before completing dispatch', {
      batch_id: batch.id,
      batch_number: batch.batch_number,
      expected_qr_count: Number(batch.quantity),
      scanned_qr_count: 1,
    });
  }

  if (payload.expected_status && String(payload.expected_status) !== String(batch.status)) {
    throw new SyncConflictError('Batch status changed while this dispatch was offline', {
      batch_id: batch.id,
      expected_status: payload.expected_status,
      current_status: batch.status,
    });
  }

  if (batch.status === 'DISPATCHED') {
    throw new SyncConflictError('Batch is already dispatched', {
      batch_id: batch.id,
      current_status: batch.status,
    });
  }
  if (batch.status === 'DISPATCH_ORDER_RAISED') {
    throw new SyncConflictError('Dispatch order is still awaiting admin approval', {
      batch_id: batch.id,
      current_status: batch.status,
    });
  }

  let orderId: EntityId | null = null;
  let stockReservedAtOrder = false;
  if (batch.status === 'DISPATCH_APPROVED') {
    const orders = await ctx.find('dispatch_orders', {
      batch_id: batch.id,
      status: 'APPROVED',
    }, { sort: { created_at: -1 }, limit: 1, projection: { _id: 0, id: 1, stock_reserved_at_order: 1 } });
    if (orders.length === 0) {
      throw new SyncConflictError('No approved dispatch order was found for this batch', {
        batch_id: batch.id,
        current_status: batch.status,
      });
    }
    orderId = orders[0].id as EntityId;
    stockReservedAtOrder = Boolean(orders[0].stock_reserved_at_order);
  } else if (batch.status === 'QC_PASSED') {
    const directAllowed = payload.direct === true && (user.role === 'ADMIN' || process.env.ALLOW_DIRECT_DISPATCH === 'true');
    if (!directAllowed) {
      throw new SyncConflictError('Raise a dispatch order and wait for admin approval before dispatching', {
        batch_id: batch.id,
        current_status: batch.status,
      });
    }
  } else {
    throw new SyncConflictError(`Batch cannot be dispatched from status ${batch.status}`, {
      batch_id: batch.id,
      current_status: batch.status,
    });
  }

  const dispatchRecordId = await ctx.insert('dispatch_records', {
    batch_id: batch.id,
    dispatcher_id: user.userId,
    remarks,
    images: images.length > 0 ? JSON.stringify(images) : null,
    dispatch_order_id: orderId,
    client_operation_id: input.operation_id,
    client_created_at: toDate(input.client_timestamp),
    device_uuid: deviceUuid,
  });

  const update = await ctx.updateOne('batches', { id: batch.id, status: batch.status }, {
    $set: { status: 'DISPATCHED' },
  });
  if (update.matchedCount !== 1) {
    throw new SyncConflictError('Batch was changed by another user. Refresh and try again.', {
      batch_id: batch.id,
      current_status: batch.status,
    });
  }

  if (orderId) {
    await ctx.updateOne('dispatch_orders', { id: orderId }, { $set: { status: 'CLOSED_DISPATCHED', outcome: 'DISPATCHED', dispatched_at: now() } });
  }

  const dispatchedQuantity = Number(batch.quantity) || 0;
  const remainingStock = stockReservedAtOrder ? null : await deductProductStock(ctx, batch.product_id as EntityId, dispatchedQuantity);

  await logActivity(
    ctx,
    user,
    'DISPATCHED',
    `Batch ${batch.batch_number} (${batch.product_name}) dispatched` +
      (remainingStock === null
        ? ''
        : `. Stock deducted: ${dispatchedQuantity}; ${remainingStock} remaining`)
  );

  return {
    entityType: 'dispatch_record',
    entityId: dispatchRecordId,
    data: {
      status: 'DISPATCHED',
      batch_id: batch.id,
      batch_number: batch.batch_number,
      dispatch_record_id: dispatchRecordId,
      dispatch_order_id: orderId,
      images,
      product_id: batch.product_id,
      dispatched_quantity: dispatchedQuantity,
      remaining_stock: remainingStock,
    },
  };
}

async function applyDispatchConfirmBulk(
  ctx: DbContext,
  user: JwtPayload,
  deviceUuid: string | null,
  input: SyncOperationInput
): Promise<{ entityType: string; entityId: EntityId; data: Record<string, any> }> {
  if (!['DISPATCH', 'ADMIN'].includes(user.role)) {
    throw new SyncError('Only dispatch or admin users can confirm dispatches', 'FORBIDDEN', 403);
  }
  const payload = input.payload;
  const remarks = typeof payload.remarks === 'string' ? payload.remarks.slice(0, 4000) : null;
  const images = imageList(payload);
  const barcodes = bulkBarcodes(payload);
  const requestedOrderId = payload.dispatch_order_id as EntityId;
  // Web dispatch selects one approved order up front, while the offline mobile
  // group scan only knows the approved batches. Enforce the selected order only
  // when the client actually sent one; otherwise each batch is dispatched
  // against its own approved order below.
  const hasRequestedOrderId = requestedOrderId !== undefined &&
    requestedOrderId !== null &&
    String(requestedOrderId).trim() !== '';
  const batches = await getBatchesForUpdate(ctx, barcodes);

  const directAllowed = payload.direct === true &&
    (user.role === 'ADMIN' || process.env.ALLOW_DIRECT_DISPATCH === 'true');
  const recordIds: EntityId[] = [];
  const orderIds: EntityId[] = [];
  const stockDeductions: Array<{
    batch_id: EntityId;
    product_id: EntityId;
    quantity: number;
    remaining_stock: number | null;
  }> = [];

  for (const batch of batches) {
    if (batch.status === 'DISPATCHED') {
      throw new SyncConflictError('One or more QR codes are already dispatched', {
        batch_id: batch.id,
        barcode_value: batch.barcode_value,
        current_status: batch.status,
      });
    }
    if (batch.status === 'DISPATCH_ORDER_RAISED') {
      throw new SyncConflictError('A dispatch order is still awaiting admin approval', {
        batch_id: batch.id,
        barcode_value: batch.barcode_value,
        current_status: batch.status,
      });
    }

    let orderId: EntityId | null = null;
    let stockReservedAtOrder = false;
    if (batch.status === 'DISPATCH_APPROVED') {
      const orders = await ctx.find('dispatch_orders', {
        batch_id: batch.id,
        status: 'APPROVED',
      }, { sort: { created_at: -1 }, limit: 1, projection: { _id: 0, id: 1, stock_reserved_at_order: 1 } });
      if (orders.length === 0) {
        throw new SyncConflictError('No approved dispatch order was found for a scanned QR code', {
          batch_id: batch.id,
          barcode_value: batch.barcode_value,
          current_status: batch.status,
        });
      }
      orderId = orders[0].id as EntityId;
      stockReservedAtOrder = Boolean(orders[0].stock_reserved_at_order);
      if (hasRequestedOrderId && (!isValidId(requestedOrderId) || idKey(requestedOrderId) !== idKey(orderId))) {
        throw new SyncConflictError('Scan bags for one approved dispatch order at a time', {
          batch_id: batch.id,
          expected_order_id: orderId,
          requested_order_id: payload.dispatch_order_id ?? null,
        });
      }
      orderIds.push(orderId);
    } else if (batch.status === 'QC_PASSED') {
      if (!directAllowed) {
        throw new SyncConflictError('Raise dispatch orders and wait for admin approval before dispatching', {
          batch_id: batch.id,
          barcode_value: batch.barcode_value,
          current_status: batch.status,
        });
      }
    } else {
      throw new SyncConflictError(`QR code cannot be dispatched from status ${batch.status}`, {
        batch_id: batch.id,
        barcode_value: batch.barcode_value,
        current_status: batch.status,
      });
    }

    const recordId = await ctx.insert('dispatch_records', {
      batch_id: batch.id,
      dispatcher_id: user.userId,
      remarks,
      images: images.length > 0 ? JSON.stringify(images) : null,
      dispatch_order_id: orderId,
      group_operation_id: input.operation_id,
      client_created_at: toDate(input.client_timestamp),
      device_uuid: deviceUuid,
    });
    recordIds.push(recordId);

    const update = await ctx.updateOne('batches', { id: batch.id, status: batch.status }, {
      $set: { status: 'DISPATCHED' },
    });
    if (update.matchedCount !== 1) {
      throw new SyncConflictError('A QR code was changed by another user. Refresh and try again.', {
        batch_id: batch.id,
        current_status: batch.status,
      });
    }
    if (orderId) {
      await ctx.updateOne('dispatch_orders', { id: orderId }, { $set: { status: 'CLOSED_DISPATCHED', outcome: 'DISPATCHED', dispatched_at: now() } });
    }

    const dispatchedQuantity = Number(batch.quantity) || 0;
    const remainingStock = stockReservedAtOrder ? null : await deductProductStock(ctx, batch.product_id as EntityId, dispatchedQuantity);
    if (remainingStock !== null) {
      stockDeductions.push({
        batch_id: batch.id as EntityId,
        product_id: batch.product_id as EntityId,
        quantity: dispatchedQuantity,
        remaining_stock: remainingStock,
      });
    }
  }

  await logActivity(
    ctx,
    user,
    'DISPATCHED_GROUP',
    `Dispatch confirmed for ${batches.length} QR code${batches.length === 1 ? '' : 's'}` +
      (stockDeductions.length > 0 ? '. Product stock updated' : '')
  );

  return {
    entityType: 'dispatch_group',
    entityId: recordIds[0],
    data: {
      status: 'DISPATCHED',
      count: batches.length,
      batch_ids: batches.map((batch) => batch.id),
      batch_numbers: batches.map((batch) => batch.batch_number),
      dispatch_record_ids: recordIds,
      dispatch_order_ids: orderIds,
      stock_deductions: stockDeductions,
      images,
    },
  };
}

/**
 * Applies one offline operation in its own transaction. The unique
 * operation_id is the idempotency key; retries return the original outcome.
 */
export async function applyOperation(
  user: JwtPayload,
  deviceUuid: string | null,
  input: SyncOperationInput
): Promise<SyncOperationResult> {
  validateOperation(input);

  try {
    return await withTransaction(async (ctx) => {
      const existing = await findExistingOperation(ctx, input.operation_id);
      if (existing) {
        if (existing.user_id !== undefined && existing.user_id !== user.userId) {
          return {
            operation_id: input.operation_id,
            status: 'FAILED',
            entity_type: null,
            entity_id: null,
            error: 'Operation belongs to another user',
            error_code: 'OPERATION_OWNER_MISMATCH',
          };
        }
        if (existing.status === 'APPLIED' || existing.status === 'DUPLICATE') {
          return existing;
        }
        // A FAILED or CONFLICT operation never committed any business writes:
        // its transaction was rolled back. Allow a manual/retry pass with the
        // same idempotency key to re-evaluate the current server state.
        await ctx.deleteOne('sync_operations', { operation_id: input.operation_id });
      }

      let applied: { entityType: string; entityId: EntityId; data: Record<string, any> };
      switch (input.type) {
        case 'DISPATCH_ORDER_RAISE':
          applied = await applyDispatchOrderRaise(ctx, user, deviceUuid, input);
          break;
        // SRS v2 retires manual QC PASS/FAIL and the legacy bulk dispatch:
        // batches are born QC-passed and dispatch only completes through a
        // loading session with a seal number. Refuse stale offline clients
        // instead of silently writing QC_FAILED or skipping the seal step.
        case 'QC_SUBMIT':
        case 'QC_SUBMIT_BULK':
        case 'DISPATCH_CONFIRM':
        case 'DISPATCH_CONFIRM_BULK':
          throw new SyncError(
            'This offline operation is retired: batches are auto QC-passed and dispatch is completed through a loading session with a seal number.',
            'UNSUPPORTED_OPERATION',
            410
          );
        case 'BATCH_CREATE_AUTO_PASS':
        case 'QC_ORDER_APPROVE':
        case 'QC_ORDER_REJECT':
        case 'LOADING_SESSION_START':
        case 'LOADING_SESSION_SCAN':
        case 'LOADING_SESSION_FINALISE':
          throw new SyncError('Operation not supported by this endpoint', 'UNSUPPORTED_OPERATION', 400);
        default:
          throw new SyncError(`Unsupported operation type: ${input.type}`, 'INVALID_OPERATION_TYPE');
      }

      const result: SyncOperationResult = {
        operation_id: input.operation_id,
        status: 'APPLIED',
        entity_type: applied.entityType,
        entity_id: applied.entityId,
        data: applied.data,
        error: null,
        error_code: null,
      };
      await recordOperation(ctx, user, deviceUuid, input, 'APPLIED', null, null, result);
      return result;
    });
  } catch (error) {
    if (isDuplicateKey(error)) {
      const existing = await findExistingOperation(await getContext(), input.operation_id);
      if (existing) return existing;
    }

    const isKnown = error instanceof SyncError;
    const status: SyncOperationStatus = isKnown && error.code === 'CONFLICT' ? 'CONFLICT' : 'FAILED';
    const result: SyncOperationResult = {
      operation_id: input.operation_id,
      status,
      entity_type: null,
      entity_id: null,
      error: error instanceof Error ? error.message : 'Unknown sync error',
      error_code: isKnown ? error.code : 'INTERNAL_ERROR',
    };

    try {
      await recordOperation(
        await getContext(),
        user,
        deviceUuid,
        input,
        status,
        result.error_code || null,
        result.error || null,
        result
      );
    } catch (recordError) {
      console.error('Could not record failed sync operation:', recordError);
    }

    if (!isKnown) {
      console.error(`Unexpected sync error for ${input.operation_id}:`, error);
    }
    return result;
  }
}

export async function registerDevice(
  user: JwtPayload,
  input: { device_uuid?: string; platform?: string; app_version?: string; push_token?: string }
): Promise<{ device_uuid: string }> {
  const deviceUuid = String(input.device_uuid || '');
  if (!DEVICE_ID_PATTERN.test(deviceUuid)) {
    throw new SyncError('device_uuid must be 8-100 URL-safe characters', 'INVALID_DEVICE_ID');
  }
  const platform = String(input.platform || 'unknown').slice(0, 20);
  const appVersion = input.app_version ? String(input.app_version).slice(0, 30) : null;
  const pushToken = input.push_token ? String(input.push_token).slice(0, 255) : null;

  const ctx = await getContext();
  const deviceUpdate: Record<string, any> = {
    $set: {
      user_id: user.userId,
      user_role: user.role,
      platform,
      app_version: appVersion,
      last_seen_at: now(),
    },
    $setOnInsert: { created_at: now() },
  };
  if (pushToken) deviceUpdate.$set.push_token = pushToken;
  await ctx.updateOne('devices', { device_uuid: deviceUuid }, deviceUpdate, { upsert: true });

  await ctx.updateOne('device_sync_state', { device_uuid: deviceUuid }, {
    $set: { updated_at: now() },
    $setOnInsert: { last_pull_at: null, last_push_at: null, last_error: null },
  }, { upsert: true });
  return { device_uuid: deviceUuid };
}


export async function touchDeviceSync(
  deviceUuid: string | null,
  kind: 'pull' | 'push',
  error?: string | null
): Promise<void> {
  if (!deviceUuid || !DEVICE_ID_PATTERN.test(deviceUuid)) return;

  const ctx = await getContext();
  const column = kind === 'pull' ? 'last_pull_at' : 'last_push_at';
  const timestamp = now();

  await ctx.updateOne(
    'device_sync_state',
    { device_uuid: deviceUuid },
    {
      $set: {
        [column]: timestamp,
        last_error: error || null,
        updated_at: timestamp,
      },
      $setOnInsert: {
        device_uuid: deviceUuid,
        ...(kind === 'push'
          ? { last_pull_at: null }
          : { last_push_at: null }),
      },
    },
    { upsert: true }
  );
}
