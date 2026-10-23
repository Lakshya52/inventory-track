import { PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { execute, query, withTransaction } from '../config/database';
import {
  JwtPayload,
  SyncOperationInput,
  SyncOperationResult,
  SyncOperationStatus,
  SyncOperationType,
} from '../types';

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
  'PRODUCTION_FIX',
]);

function safeJson(value: unknown): any {
  try {
    return JSON.parse(String(value));
  } catch {
    return null;
  }
}

function toDate(value: unknown): Date | null {
  if (!value) return null;
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

function toJson(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

function isDuplicateKey(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && (error as any).code === 'ER_DUP_ENTRY');
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
  conn: PoolConnection | null,
  operationId: string
): Promise<SyncOperationResult | null> {
  const sql = `SELECT operation_id, user_id, user_role, status, entity_type, entity_id,
                      error_code, error_message, result
               FROM sync_operations WHERE operation_id = ? LIMIT 1${conn ? ' FOR UPDATE' : ''}`;
  let rows: RowDataPacket[];
  if (conn) {
    const [result] = await conn.execute<RowDataPacket[]>(sql, [operationId]);
    rows = result;
  } else {
    rows = await query<RowDataPacket[]>(sql, [operationId]);
  }

  if (!rows || rows.length === 0) return null;
  const row = rows[0];
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
  conn: PoolConnection | null,
  user: JwtPayload,
  deviceUuid: string | null,
  input: SyncOperationInput,
  status: SyncOperationStatus,
  errorCode: string | null,
  errorMessage: string | null,
  result: SyncOperationResult
): Promise<void> {
  const sql = `INSERT INTO sync_operations
    (operation_id, device_uuid, user_id, user_role, operation_type, entity_type, entity_id,
     status, error_code, error_message, payload, result, client_timestamp)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      device_uuid = VALUES(device_uuid),
      user_id = VALUES(user_id),
      user_role = VALUES(user_role),
      operation_type = VALUES(operation_type),
      entity_type = VALUES(entity_type),
      entity_id = VALUES(entity_id),
      status = VALUES(status),
      error_code = VALUES(error_code),
      error_message = VALUES(error_message),
      payload = VALUES(payload),
      result = VALUES(result),
      client_timestamp = VALUES(client_timestamp),
      server_timestamp = CURRENT_TIMESTAMP(3)`;
  const params = [
    input.operation_id,
    deviceUuid,
    user.userId,
    user.role,
    input.type,
    result.entity_type,
    result.entity_id,
    status,
    errorCode,
    errorMessage,
    toJson(input.payload),
    toJson({ data: result.data ?? null }),
    toDate(input.client_timestamp),
  ];
  if (conn) {
    await conn.execute(sql, params);
  } else {
    await execute(sql, params);
  }
}

async function getBatchForUpdate(
  conn: PoolConnection,
  payload: Record<string, any>
): Promise<RowDataPacket> {
  const barcode = typeof payload.barcode_value === 'string' ? payload.barcode_value.trim() : '';
  const batchId = Number(payload.batch_id);
  if (!barcode && !Number.isFinite(batchId)) {
    throw new SyncError('barcode_value or batch_id is required', 'BATCH_REFERENCE_REQUIRED');
  }

  const sql = barcode
    ? `SELECT b.*, p.name AS product_name, p.sku AS product_sku, p.cas_number,
              p.molecular_formula, p.grade AS product_grade, p.purity AS product_purity
       FROM batches b JOIN products p ON b.product_id = p.id
       WHERE b.barcode_value = ? FOR UPDATE`
    : `SELECT b.*, p.name AS product_name, p.sku AS product_sku, p.cas_number,
              p.molecular_formula, p.grade AS product_grade, p.purity AS product_purity
       FROM batches b JOIN products p ON b.product_id = p.id
       WHERE b.id = ? FOR UPDATE`;
  const [rows] = await conn.execute<RowDataPacket[]>(sql, [barcode || batchId]);
  if (rows.length === 0) {
    throw new SyncError('Batch not found', 'BATCH_NOT_FOUND', 404);
  }
  return rows[0];
}

function assertStatus(batch: RowDataPacket, expected: string[], message: string): void {
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
    if (seen.size >= 500) break;
  }
  return [...seen];
}

async function getBatchesForUpdate(
  conn: PoolConnection,
  barcodes: string[]
): Promise<RowDataPacket[]> {
  if (barcodes.length === 0) {
    throw new SyncError('At least one QR code is required', 'BATCH_REFERENCE_REQUIRED');
  }
  const placeholders = barcodes.map(() => '?').join(',');
  const [rows] = await conn.query<RowDataPacket[]>(
    `SELECT b.*, p.name AS product_name, p.sku AS product_sku
     FROM batches b JOIN products p ON b.product_id = p.id
     WHERE b.barcode_value IN (${placeholders})
     FOR UPDATE`,
    barcodes
  );
  if (rows.length !== barcodes.length) {
    const found = new Set(rows.map((row) => String(row.barcode_value)));
    throw new SyncConflictError('Some QR codes were not found', {
      missing_barcodes: barcodes.filter((barcode) => !found.has(barcode)),
    });
  }
  const byBarcode = new Map(rows.map((row) => [String(row.barcode_value), row]));
  return barcodes.map((barcode) => byBarcode.get(barcode)!);
}

async function logActivity(
  conn: PoolConnection,
  user: JwtPayload,
  action: string,
  description: string
): Promise<void> {
  await conn.execute(
    `INSERT INTO activity_logs (user_id, user_name, user_role, action, description)
     VALUES (?, ?, ?, ?, ?)`,
    [user.userId, user.name || user.role, user.role, action, description]
  );
}

async function applyQcSubmit(
  conn: PoolConnection,
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

  const batch = await getBatchForUpdate(conn, payload);
  if (payload.expected_status && String(payload.expected_status) !== String(batch.status)) {
    throw new SyncConflictError('Batch status changed while this QC test was offline', {
      batch_id: batch.id,
      expected_status: payload.expected_status,
      current_status: batch.status,
    });
  }
  assertStatus(batch, ['CREATED'], `QC can only be submitted for CREATED batches. Current status: ${batch.status}`);

  const newStatus = result === 'PASS' ? 'QC_PASSED' : 'QC_FAILED';
  const [insert] = await conn.execute<ResultSetHeader>(
    `INSERT INTO qc_records
      (batch_id, tester_id, result, remarks, images, client_operation_id, client_created_at, device_uuid)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      batch.id,
      user.userId,
      result,
      remarks,
      images.length > 0 ? JSON.stringify(images) : null,
      input.operation_id,
      toDate(input.client_timestamp),
      deviceUuid,
    ]
  );

  const [update] = await conn.execute<ResultSetHeader>(
    `UPDATE batches SET status = ?, updated_at = CURRENT_TIMESTAMP(3)
     WHERE id = ? AND status = 'CREATED'`,
    [newStatus, batch.id]
  );
  if (update.affectedRows !== 1) {
    throw new SyncConflictError('Batch was changed by another user. Refresh and try again.', {
      batch_id: batch.id,
      current_status: batch.status,
    });
  }

  await logActivity(
    conn,
    user,
    result === 'PASS' ? 'QC_PASSED' : 'QC_FAILED',
    `Batch ${batch.batch_number} (${batch.product_name}) - ${result}`
  );

  return {
    entityType: 'qc_record',
    entityId: insert.insertId,
    data: {
      status: newStatus,
      batch_id: batch.id,
      batch_number: batch.batch_number,
      qc_record_id: insert.insertId,
      result,
      images,
    },
  };
}

async function applyQcSubmitBulk(
  conn: PoolConnection,
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
  const batches = await getBatchesForUpdate(conn, barcodes);

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
    const [insert] = await conn.execute<ResultSetHeader>(
      `INSERT INTO qc_records
        (batch_id, tester_id, result, remarks, images, group_operation_id,
         client_created_at, device_uuid)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        batch.id,
        user.userId,
        result,
        remarks,
        images.length > 0 ? JSON.stringify(images) : null,
        input.operation_id,
        toDate(input.client_timestamp),
        deviceUuid,
      ]
    );
    recordIds.push(insert.insertId);
    const [update] = await conn.execute<ResultSetHeader>(
      `UPDATE batches SET status = ?, updated_at = CURRENT_TIMESTAMP(3)
       WHERE id = ? AND status = 'CREATED'`,
      [newStatus, batch.id]
    );
    if (update.affectedRows !== 1) {
      throw new SyncConflictError('A QR code was changed by another user. Refresh and try again.', {
        batch_id: batch.id,
        current_status: batch.status,
      });
    }
  }

  await logActivity(
    conn,
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
  conn: PoolConnection,
  user: JwtPayload,
  deviceUuid: string | null,
  input: SyncOperationInput
): Promise<{ entityType: string; entityId: number; data: Record<string, any> }> {
  if (!['DISPATCH', 'ADMIN'].includes(user.role)) {
    throw new SyncError('Only dispatch or admin users can raise dispatch orders', 'FORBIDDEN', 403);
  }
  const batch = await getBatchForUpdate(conn, input.payload);
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

  const [existing] = await conn.execute<RowDataPacket[]>(
    `SELECT id, status FROM dispatch_orders
     WHERE batch_id = ? AND status IN ('PENDING', 'APPROVED')
     ORDER BY id DESC LIMIT 1 FOR UPDATE`,
    [batch.id]
  );
  if (existing.length > 0) {
    throw new SyncConflictError(
      existing[0].status === 'APPROVED'
        ? 'This batch already has an approved dispatch order'
        : 'A dispatch order is already pending for this batch',
      { order_id: existing[0].id, order_status: existing[0].status }
    );
  }

  const [insert] = await conn.execute<ResultSetHeader>(
    `INSERT INTO dispatch_orders
      (batch_id, raised_by, status, client_operation_id, client_created_at, device_uuid)
     VALUES (?, ?, 'PENDING', ?, ?, ?)`,
    [
      batch.id,
      user.userId,
      input.operation_id,
      toDate(input.client_timestamp),
      deviceUuid,
    ]
  );

  const [update] = await conn.execute<ResultSetHeader>(
    `UPDATE batches SET status = 'DISPATCH_ORDER_RAISED', updated_at = CURRENT_TIMESTAMP(3)
     WHERE id = ? AND status = ?`,
    [batch.id, batch.status]
  );
  if (update.affectedRows !== 1) {
    throw new SyncConflictError('Batch was changed by another user. Refresh and try again.', {
      batch_id: batch.id,
      current_status: batch.status,
    });
  }

  await logActivity(
    conn,
    user,
    'DISPATCH_ORDER_RAISED',
    `Dispatch order raised for batch ${batch.batch_number} (${batch.product_name})`
  );

  return {
    entityType: 'dispatch_order',
    entityId: insert.insertId,
    data: {
      id: insert.insertId,
      batch_id: batch.id,
      batch_number: batch.batch_number,
      product_name: batch.product_name,
      status: 'PENDING',
    },
  };
}

async function applyDispatchConfirm(
  conn: PoolConnection,
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
  const batch = await getBatchForUpdate(conn, payload);

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
    const [orders] = await conn.execute<RowDataPacket[]>(
      `SELECT id FROM dispatch_orders
       WHERE batch_id = ? AND status = 'APPROVED'
       ORDER BY id DESC LIMIT 1 FOR UPDATE`,
      [batch.id]
    );
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

  const [insert] = await conn.execute<ResultSetHeader>(
    `INSERT INTO dispatch_records
      (batch_id, dispatcher_id, remarks, images, dispatch_order_id,
       client_operation_id, client_created_at, device_uuid)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      batch.id,
      user.userId,
      remarks,
      images.length > 0 ? JSON.stringify(images) : null,
      orderId,
      input.operation_id,
      toDate(input.client_timestamp),
      deviceUuid,
    ]
  );

  const [update] = await conn.execute<ResultSetHeader>(
    `UPDATE batches SET status = 'DISPATCHED', updated_at = CURRENT_TIMESTAMP(3)
     WHERE id = ? AND status = ?`,
    [batch.id, batch.status]
  );
  if (update.affectedRows !== 1) {
    throw new SyncConflictError('Batch was changed by another user. Refresh and try again.', {
      batch_id: batch.id,
      current_status: batch.status,
    });
  }

  if (orderId) {
    await conn.execute(
      'UPDATE dispatch_orders SET dispatched_at = CURRENT_TIMESTAMP(3) WHERE id = ?',
      [orderId]
    );
  }

  await logActivity(
    conn,
    user,
    'DISPATCHED',
    `Batch ${batch.batch_number} (${batch.product_name}) dispatched`
  );

  return {
    entityType: 'dispatch_record',
    entityId: insert.insertId,
    data: {
      status: 'DISPATCHED',
      batch_id: batch.id,
      batch_number: batch.batch_number,
      dispatch_record_id: insert.insertId,
      dispatch_order_id: orderId,
      images,
    },
  };
}

async function applyDispatchConfirmBulk(
  conn: PoolConnection,
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
  const batches = await getBatchesForUpdate(conn, barcodes);

  const directAllowed = payload.direct === true &&
    (user.role === 'ADMIN' || process.env.ALLOW_DIRECT_DISPATCH === 'true');
  const recordIds: number[] = [];
  const orderIds: number[] = [];

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
      const [orders] = await conn.execute<RowDataPacket[]>(
        `SELECT id FROM dispatch_orders
         WHERE batch_id = ? AND status = 'APPROVED'
         ORDER BY id DESC LIMIT 1 FOR UPDATE`,
        [batch.id]
      );
      if (orders.length === 0) {
        throw new SyncConflictError('No approved dispatch order was found for a scanned QR code', {
          batch_id: batch.id,
          barcode_value: batch.barcode_value,
          current_status: batch.status,
        });
      }
      orderId = Number(orders[0].id);
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

    const [insert] = await conn.execute<ResultSetHeader>(
      `INSERT INTO dispatch_records
        (batch_id, dispatcher_id, remarks, images, dispatch_order_id,
         group_operation_id, client_created_at, device_uuid)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        batch.id,
        user.userId,
        remarks,
        images.length > 0 ? JSON.stringify(images) : null,
        orderId,
        input.operation_id,
        toDate(input.client_timestamp),
        deviceUuid,
      ]
    );
    recordIds.push(insert.insertId);

    const [update] = await conn.execute<ResultSetHeader>(
      `UPDATE batches SET status = 'DISPATCHED', updated_at = CURRENT_TIMESTAMP(3)
       WHERE id = ? AND status = ?`,
      [batch.id, batch.status]
    );
    if (update.affectedRows !== 1) {
      throw new SyncConflictError('A QR code was changed by another user. Refresh and try again.', {
        batch_id: batch.id,
        current_status: batch.status,
      });
    }
    if (orderId) {
      await conn.execute(
        'UPDATE dispatch_orders SET dispatched_at = CURRENT_TIMESTAMP(3) WHERE id = ?',
        [orderId]
      );
    }
  }

  await logActivity(
    conn,
    user,
    'DISPATCHED_GROUP',
    `Dispatch confirmed for ${batches.length} QR code${batches.length === 1 ? '' : 's'}`
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
      images,
    },
  };
}

async function applyProductionFix(
  conn: PoolConnection,
  user: JwtPayload,
  input: SyncOperationInput
): Promise<{ entityType: string; entityId: number; data: Record<string, any> }> {
  if (!['PRODUCTION', 'ADMIN'].includes(user.role)) {
    throw new SyncError('Only production or admin users can record a batch fix', 'FORBIDDEN', 403);
  }
  const batch = await getBatchForUpdate(conn, input.payload);
  assertStatus(batch, ['QC_FAILED'], `Only QC_FAILED batches can be fixed. Current status: ${batch.status}`);
  const description = typeof input.payload.description === 'string'
    ? input.payload.description.slice(0, 4000)
    : null;

  const [insert] = await conn.execute<ResultSetHeader>(
    `INSERT INTO fix_records (batch_id, fixed_by, description) VALUES (?, ?, ?)`,
    [batch.id, user.userId, description]
  );
  const [update] = await conn.execute<ResultSetHeader>(
    `UPDATE batches SET status = 'CREATED', updated_at = CURRENT_TIMESTAMP(3)
     WHERE id = ? AND status = 'QC_FAILED'`,
    [batch.id]
  );
  if (update.affectedRows !== 1) {
    throw new SyncConflictError('Batch was changed by another user. Refresh and try again.', {
      batch_id: batch.id,
      current_status: batch.status,
    });
  }
  await logActivity(
    conn,
    user,
    'BATCH_FIXED',
    `Batch ${batch.batch_number} fixed and sent back to QC`
  );

  return {
    entityType: 'fix_record',
    entityId: insert.insertId,
    data: { status: 'CREATED', batch_id: batch.id, batch_number: batch.batch_number },
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
    return await withTransaction(async (conn) => {
      const existing = await findExistingOperation(conn, input.operation_id);
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
        await conn.execute('DELETE FROM sync_operations WHERE operation_id = ?', [input.operation_id]);
      }

      let applied: { entityType: string; entityId: number; data: Record<string, any> };
      switch (input.type) {
        case 'QC_SUBMIT':
          applied = await applyQcSubmit(conn, user, deviceUuid, input);
          break;
        case 'QC_SUBMIT_BULK':
          applied = await applyQcSubmitBulk(conn, user, deviceUuid, input);
          break;
        case 'DISPATCH_ORDER_RAISE':
          applied = await applyDispatchOrderRaise(conn, user, deviceUuid, input);
          break;
        case 'DISPATCH_CONFIRM':
          applied = await applyDispatchConfirm(conn, user, deviceUuid, input);
          break;
        case 'DISPATCH_CONFIRM_BULK':
          applied = await applyDispatchConfirmBulk(conn, user, deviceUuid, input);
          break;
        case 'PRODUCTION_FIX':
          applied = await applyProductionFix(conn, user, input);
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
      await recordOperation(conn, user, deviceUuid, input, 'APPLIED', null, null, result);
      return result;
    });
  } catch (error) {
    if (isDuplicateKey(error)) {
      const existing = await findExistingOperation(null, input.operation_id);
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
        null,
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

  await execute(
    `INSERT INTO devices (device_uuid, user_id, user_role, platform, app_version, push_token, last_seen_at)
     VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP(3))
     ON DUPLICATE KEY UPDATE
       user_id = VALUES(user_id), user_role = VALUES(user_role), platform = VALUES(platform),
       app_version = VALUES(app_version), push_token = COALESCE(VALUES(push_token), push_token),
       last_seen_at = CURRENT_TIMESTAMP(3)`,
    [deviceUuid, user.userId, user.role, platform, appVersion, pushToken]
  );
  await execute(
    `INSERT INTO device_sync_state (device_uuid, updated_at)
     VALUES (?, CURRENT_TIMESTAMP(3))
     ON DUPLICATE KEY UPDATE updated_at = CURRENT_TIMESTAMP(3)`,
    [deviceUuid]
  );
  return { device_uuid: deviceUuid };
}

export async function touchDeviceSync(
  deviceUuid: string | null,
  kind: 'pull' | 'push',
  error?: string | null
): Promise<void> {
  if (!deviceUuid || !DEVICE_ID_PATTERN.test(deviceUuid)) return;
  const column = kind === 'pull' ? 'last_pull_at' : 'last_push_at';
  await execute(
    `INSERT INTO device_sync_state (device_uuid, ${column}, last_error, updated_at)
     VALUES (?, CURRENT_TIMESTAMP(3), ?, CURRENT_TIMESTAMP(3))
     ON DUPLICATE KEY UPDATE ${column} = CURRENT_TIMESTAMP(3),
       last_error = VALUES(last_error), updated_at = CURRENT_TIMESTAMP(3)`,
    [deviceUuid, error || null]
  );
}
