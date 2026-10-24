import { randomUUID } from 'crypto';
import {
  DbContext,
  getContext,
  isDuplicateKey,
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
import { batchQrStats } from './queryService';

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
    entity_id: row.entity_id === null || row.entity_id === undefined ? null : Number(row.entity_id),
    data: result?.data ?? null,
    error: row.error_message || null,
    error_code: row.error_code || null,
    user_id: Number(row.user_id),
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
  const batchId = Number(payload.batch_id);
  if (!barcode && !Number.isFinite(batchId)) {
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
        batch = await ctx.findOne('batches', { id: Number(label.batch_id) }, { projection: { _id: 0 } });
      }
    }
  } else {
    batch = await ctx.findOne('batches', { id: batchId }, { projection: { _id: 0 } });
  }
  if (!batch) {
    throw new SyncError('Batch not found', 'BATCH_NOT_FOUND', 404);
  }

  const product = await ctx.findOne('products', { id: Number(batch.product_id) }, { projection: { _id: 0 } });
  const stats = await batchQrStats(ctx, [Number(batch.id)]);
  return {
    ...batch,
    product_name: product?.name ?? null,
    product_sku: product?.sku ?? null,
    cas_number: product?.cas_number ?? null,
    molecular_formula: product?.molecular_formula ?? null,
    product_grade: product?.grade ?? null,
    product_purity: product?.purity ?? null,
    qr_count: stats.get(Number(batch.id))?.count ?? 0,
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
  const codeToBatch = new Map<string, number>();
  for (const row of labelRows) codeToBatch.set(String(row.qr_value), Number(row.batch_id));
  for (const row of legacyRows) codeToBatch.set(String(row.barcode_value), Number(row.id));
  const missing = barcodes.filter((barcode) => !codeToBatch.has(barcode));
  if (missing.length > 0) {
    throw new SyncConflictError('Some QR codes were not found', { missing_barcodes: missing });
  }

  const batchIds = [...new Set(barcodes.map((barcode) => codeToBatch.get(barcode)!))];
  const batches = await ctx.find('batches', { id: { $in: batchIds } }, {
    sort: { id: 1 },
    projection: { _id: 0 },
  });
  const productIds = batches.map((batch) => Number(batch.product_id));
  const products = productIds.length > 0
    ? await ctx.find('products', { id: { $in: productIds } }, { projection: { _id: 0 } })
    : [];
  const productMap = new Map(products.map((product) => [Number(product.id), product]));
  const stats = await batchQrStats(ctx, batchIds);
  const enriched: Record<string, any>[] = batches.map((batch) => {
    const product = productMap.get(Number(batch.product_id));
    return {
      ...batch,
      product_name: product?.name ?? null,
      product_sku: product?.sku ?? null,
      qr_count: stats.get(Number(batch.id))?.count ?? 0,
    };
  });

  const scannedCounts = new Map<number, number>();
  const scannedCodes = new Map<number, Set<string>>();
  for (const barcode of barcodes) {
    const batchId = codeToBatch.get(barcode)!;
    scannedCounts.set(batchId, (scannedCounts.get(batchId) || 0) + 1);
    const codes = scannedCodes.get(batchId) || new Set<string>();
    codes.add(barcode);
    scannedCodes.set(batchId, codes);
  }
  const expectedLabelRows = await ctx.find('qr_labels', { batch_id: { $in: batchIds } }, {
    projection: { _id: 0, batch_id: 1, qr_value: 1 },
  });
  const expectedCodes = new Map<number, Set<string>>();
  for (const row of expectedLabelRows) {
    const batchId = Number(row.batch_id);
    const codes = expectedCodes.get(batchId) || new Set<string>();
    codes.add(String(row.qr_value));
    expectedCodes.set(batchId, codes);
  }
  const incomplete = enriched.filter((batch) =>
    Number(batch.qr_count) > 0 &&
    (Number(batch.qr_count) !== Number(batch.quantity) ||
      scannedCounts.get(Number(batch.id)) !== Number(batch.qr_count) ||
      [...(expectedCodes.get(Number(batch.id)) || [])].some(
        (code) => !scannedCodes.get(Number(batch.id))?.has(code)
      ))
  );
  if (incomplete.length > 0) {
    throw new SyncConflictError('Scan every unit QR code in each batch before submitting this group', {
      incomplete_batches: incomplete.map((batch) => ({
        batch_id: batch.id,
        batch_number: batch.batch_number,
        expected_qr_count: Number(batch.qr_count),
        scanned_qr_count: scannedCounts.get(Number(batch.id)) || 0,
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
  productId: number,
  quantity: number
): Promise<number | null> {
  if (!Number.isFinite(productId) || productId <= 0 || !Number.isFinite(quantity) || quantity <= 0) {
    return null;
  }
  const result = await ctx.collection('products').findOneAndUpdate(
    { id: productId },
    [
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
    ],
    {
      returnDocument: 'after',
      ...(ctx.session ? { session: ctx.session } : {}),
    }
  );
  return result ? Number((result as Record<string, any>).quantity) : null;
}

async function applyQcSubmit(
  ctx: DbContext,
  user: JwtPayload,
  deviceUuid: string | null,
  input: SyncOperationInput
): Promise<{ entityType: string; entityId: number; data: Record<string, any> }> {
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
): Promise<{ entityType: string; entityId: number; data: Record<string, any> }> {
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
  const recordIds: number[] = [];
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
): Promise<{ entityType: string; entityId: number; data: Record<string, any> }> {
  if (!['DISPATCH', 'ADMIN'].includes(user.role)) {
    throw new SyncError('Only dispatch or admin users can raise dispatch orders', 'FORBIDDEN', 403);
  }
  const clientId = Number(input.payload.client_id);
  const driverName = String(input.payload.driver_name || '').trim().slice(0, 150);
  const vehicleNumber = String(input.payload.vehicle_number || '').trim().slice(0, 50);
  const containerNumber = String(input.payload.container_number || '').trim().slice(0, 100);
  if (!Number.isInteger(clientId) || clientId <= 0 || !driverName || !vehicleNumber || !containerNumber) {
    throw new SyncError('Select a client and provide the driver, vehicle, and container details', 'DISPATCH_DETAILS_REQUIRED');
  }
  const client = await ctx.findOne('clients', { id: clientId, is_active: 1 }, { projection: { id: 1 } });
  if (!client) {
    throw new SyncError('Selected client is no longer active', 'CLIENT_NOT_FOUND', 404);
  }
  const batch = await getBatchForUpdate(ctx, input.payload);
  if (input.payload.expected_status && String(input.payload.expected_status) !== String(batch.status)) {
    throw new SyncConflictError('Batch status changed while this order was offline', {
      batch_id: batch.id,
      expected_status: input.payload.expected_status,
      current_status: batch.status,
    });
  }
  assertStatus(
    batch,
    ['QC_PASSED', 'DISPATCH_REJECTED'],
    `Dispatch order can only be raised for QC_PASSED or DISPATCH_REJECTED batches. Current status: ${batch.status}`
  );
  if (!batch.fg_details_completed_at) {
    const labelCount = await ctx.count('qr_labels', { batch_id: Number(batch.id) });
    if (labelCount !== Number(batch.quantity)) {
      throw new SyncConflictError('Complete finished-goods details and generate bag QR labels before raising a dispatch order', {
        batch_id: batch.id,
        expected_qr_count: Number(batch.quantity),
        actual_qr_count: labelCount,
      });
    }
  }
  if (Number(batch.quantity) > 1) {
    const labelCount = await ctx.count('qr_labels', { batch_id: Number(batch.id) });
    if (labelCount !== Number(batch.quantity)) {
      throw new SyncConflictError('Batch unit QR labels are incomplete. Contact an administrator.', {
        batch_id: batch.id,
        expected_qr_count: Number(batch.quantity),
        actual_qr_count: labelCount,
      });
    }
  }

  const existing = await ctx.find('dispatch_orders', {
    batch_id: batch.id,
    status: { $in: ['PENDING', 'APPROVED'] },
  }, { sort: { id: -1 }, limit: 1, projection: { _id: 0, id: 1, status: 1 } });
  if (existing.length > 0) {
    throw new SyncConflictError(
      existing[0].status === 'APPROVED'
        ? 'This batch already has an approved dispatch order'
        : 'A dispatch order is already pending for this batch',
      { order_id: existing[0].id, order_status: existing[0].status }
    );
  }

  const orderId = await ctx.insert('dispatch_orders', {
    batch_id: batch.id,
    raised_by: user.userId,
    status: 'PENDING',
    admin_id: null,
    admin_remarks: null,
    client_id: clientId,
    driver_name: driverName,
    vehicle_number: vehicleNumber,
    container_number: containerNumber,
    client_operation_id: input.operation_id,
    client_created_at: toDate(input.client_timestamp),
    device_uuid: deviceUuid,
    dispatched_at: null,
  });

  const update = await ctx.updateOne('batches', { id: batch.id, status: batch.status }, {
    $set: { status: 'DISPATCH_ORDER_RAISED' },
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
    'DISPATCH_ORDER_RAISED',
    `Dispatch order raised for batch ${batch.batch_number} (${batch.product_name})`
  );

  return {
    entityType: 'dispatch_order',
    entityId: orderId,
    data: {
      id: orderId,
      batch_id: batch.id,
      batch_number: batch.batch_number,
      product_name: batch.product_name,
      status: 'PENDING',
    },
  };
}

async function applyDispatchConfirm(
  ctx: DbContext,
  user: JwtPayload,
  deviceUuid: string | null,
  input: SyncOperationInput
): Promise<{ entityType: string; entityId: number; data: Record<string, any> }> {
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

  let orderId: number | null = null;
  if (batch.status === 'DISPATCH_APPROVED') {
    const orders = await ctx.find('dispatch_orders', {
      batch_id: batch.id,
      status: 'APPROVED',
    }, { sort: { id: -1 }, limit: 1, projection: { _id: 0, id: 1 } });
    if (orders.length === 0) {
      throw new SyncConflictError('No approved dispatch order was found for this batch', {
        batch_id: batch.id,
        current_status: batch.status,
      });
    }
    orderId = Number(orders[0].id);
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
    await ctx.updateOne('dispatch_orders', { id: orderId }, { $set: { dispatched_at: now() } });
  }

  const dispatchedQuantity = Number(batch.quantity) || 0;
  const remainingStock = await deductProductStock(
    ctx,
    Number(batch.product_id),
    dispatchedQuantity
  );

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
      product_id: Number(batch.product_id),
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
): Promise<{ entityType: string; entityId: number; data: Record<string, any> }> {
  if (!['DISPATCH', 'ADMIN'].includes(user.role)) {
    throw new SyncError('Only dispatch or admin users can confirm dispatches', 'FORBIDDEN', 403);
  }
  const payload = input.payload;
  const remarks = typeof payload.remarks === 'string' ? payload.remarks.slice(0, 4000) : null;
  const images = imageList(payload);
  const barcodes = bulkBarcodes(payload);
  const requestedOrderId = Number(payload.dispatch_order_id);
  const batches = await getBatchesForUpdate(ctx, barcodes);

  const directAllowed = payload.direct === true &&
    (user.role === 'ADMIN' || process.env.ALLOW_DIRECT_DISPATCH === 'true');
  const recordIds: number[] = [];
  const orderIds: number[] = [];
  const stockDeductions: Array<{
    batch_id: number;
    product_id: number;
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

    let orderId: number | null = null;
    if (batch.status === 'DISPATCH_APPROVED') {
      const orders = await ctx.find('dispatch_orders', {
        batch_id: batch.id,
        status: 'APPROVED',
      }, { sort: { id: -1 }, limit: 1, projection: { _id: 0, id: 1 } });
      if (orders.length === 0) {
        throw new SyncConflictError('No approved dispatch order was found for a scanned QR code', {
          batch_id: batch.id,
          barcode_value: batch.barcode_value,
          current_status: batch.status,
        });
      }
      orderId = Number(orders[0].id);
      if (!Number.isInteger(requestedOrderId) || requestedOrderId !== orderId) {
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
      await ctx.updateOne('dispatch_orders', { id: orderId }, { $set: { dispatched_at: now() } });
    }

    const dispatchedQuantity = Number(batch.quantity) || 0;
    const remainingStock = await deductProductStock(
      ctx,
      Number(batch.product_id),
      dispatchedQuantity
    );
    if (remainingStock !== null) {
      stockDeductions.push({
        batch_id: Number(batch.id),
        product_id: Number(batch.product_id),
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

      let applied: { entityType: string; entityId: number; data: Record<string, any> };
      switch (input.type) {
        case 'QC_SUBMIT':
          applied = await applyQcSubmit(ctx, user, deviceUuid, input);
          break;
        case 'QC_SUBMIT_BULK':
          applied = await applyQcSubmitBulk(ctx, user, deviceUuid, input);
          break;
        case 'DISPATCH_ORDER_RAISE':
          applied = await applyDispatchOrderRaise(ctx, user, deviceUuid, input);
          break;
        case 'DISPATCH_CONFIRM':
          applied = await applyDispatchConfirm(ctx, user, deviceUuid, input);
          break;
        case 'DISPATCH_CONFIRM_BULK':
          applied = await applyDispatchConfirmBulk(ctx, user, deviceUuid, input);
          break;
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
