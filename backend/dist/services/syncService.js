"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SyncConflictError = exports.SyncError = void 0;
exports.applyOperation = applyOperation;
exports.registerDevice = registerDevice;
exports.touchDeviceSync = touchDeviceSync;
const database_1 = require("../config/database");
class SyncError extends Error {
    code;
    httpStatus;
    details;
    constructor(message, code = 'SYNC_ERROR', httpStatus = 400, details) {
        super(message);
        this.code = code;
        this.httpStatus = httpStatus;
        this.details = details;
        this.name = 'SyncError';
    }
}
exports.SyncError = SyncError;
class SyncConflictError extends SyncError {
    constructor(message, details) {
        super(message, 'CONFLICT', 409, details);
        this.name = 'SyncConflictError';
    }
}
exports.SyncConflictError = SyncConflictError;
const OPERATION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/;
const DEVICE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9:_-]{7,99}$/;
const ALLOWED_TYPES = new Set([
    'QC_SUBMIT',
    'DISPATCH_ORDER_RAISE',
    'DISPATCH_CONFIRM',
    'PRODUCTION_FIX',
]);
function safeJson(value) {
    try {
        return JSON.parse(String(value));
    }
    catch {
        return null;
    }
}
function toDate(value) {
    if (!value)
        return null;
    const date = new Date(String(value));
    return Number.isNaN(date.getTime()) ? null : date;
}
function toJson(value) {
    if (value === null || value === undefined)
        return null;
    try {
        return JSON.stringify(value);
    }
    catch {
        return null;
    }
}
function isDuplicateKey(error) {
    return Boolean(error && typeof error === 'object' && error.code === 'ER_DUP_ENTRY');
}
function validateOperation(input) {
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
async function findExistingOperation(conn, operationId) {
    const sql = `SELECT operation_id, user_id, user_role, status, entity_type, entity_id,
                      error_code, error_message, result
               FROM sync_operations WHERE operation_id = ? LIMIT 1`;
    let rows;
    if (conn) {
        const [result] = await conn.execute(sql, [operationId]);
        rows = result;
    }
    else {
        rows = await (0, database_1.query)(sql, [operationId]);
    }
    if (!rows || rows.length === 0)
        return null;
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
async function recordOperation(conn, user, deviceUuid, input, status, errorCode, errorMessage, result) {
    const sql = `INSERT INTO sync_operations
    (operation_id, device_uuid, user_id, user_role, operation_type, entity_type, entity_id,
     status, error_code, error_message, payload, result, client_timestamp)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE operation_id = VALUES(operation_id)`;
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
    }
    else {
        await (0, database_1.execute)(sql, params);
    }
}
async function getBatchForUpdate(conn, payload) {
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
    const [rows] = await conn.execute(sql, [barcode || batchId]);
    if (rows.length === 0) {
        throw new SyncError('Batch not found', 'BATCH_NOT_FOUND', 404);
    }
    return rows[0];
}
function assertStatus(batch, expected, message) {
    if (!expected.includes(String(batch.status))) {
        throw new SyncConflictError(message, {
            batch_id: batch.id,
            batch_number: batch.batch_number,
            current_status: batch.status,
        });
    }
}
function imageList(payload) {
    if (!Array.isArray(payload.images))
        return [];
    return payload.images
        .filter((item) => typeof item === 'string' && item.length > 0 && item.length <= 255)
        .slice(0, 5);
}
async function logActivity(conn, user, action, description) {
    await conn.execute(`INSERT INTO activity_logs (user_id, user_name, user_role, action, description)
     VALUES (?, ?, ?, ?, ?)`, [user.userId, user.name || user.role, user.role, action, description]);
}
async function applyQcSubmit(conn, user, deviceUuid, input) {
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
    const [insert] = await conn.execute(`INSERT INTO qc_records
      (batch_id, tester_id, result, remarks, images, client_operation_id, client_created_at, device_uuid)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [
        batch.id,
        user.userId,
        result,
        remarks,
        images.length > 0 ? JSON.stringify(images) : null,
        input.operation_id,
        toDate(input.client_timestamp),
        deviceUuid,
    ]);
    const [update] = await conn.execute(`UPDATE batches SET status = ?, updated_at = CURRENT_TIMESTAMP(3)
     WHERE id = ? AND status = 'CREATED'`, [newStatus, batch.id]);
    if (update.affectedRows !== 1) {
        throw new SyncConflictError('Batch was changed by another user. Refresh and try again.', {
            batch_id: batch.id,
            current_status: batch.status,
        });
    }
    await logActivity(conn, user, result === 'PASS' ? 'QC_PASSED' : 'QC_FAILED', `Batch ${batch.batch_number} (${batch.product_name}) - ${result}`);
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
async function applyDispatchOrderRaise(conn, user, deviceUuid, input) {
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
    assertStatus(batch, ['QC_PASSED', 'DISPATCH_REJECTED'], `Dispatch order can only be raised for QC_PASSED or DISPATCH_REJECTED batches. Current status: ${batch.status}`);
    const [existing] = await conn.execute(`SELECT id, status FROM dispatch_orders
     WHERE batch_id = ? AND status IN ('PENDING', 'APPROVED')
     ORDER BY id DESC LIMIT 1 FOR UPDATE`, [batch.id]);
    if (existing.length > 0) {
        throw new SyncConflictError(existing[0].status === 'APPROVED'
            ? 'This batch already has an approved dispatch order'
            : 'A dispatch order is already pending for this batch', { order_id: existing[0].id, order_status: existing[0].status });
    }
    const [insert] = await conn.execute(`INSERT INTO dispatch_orders
      (batch_id, raised_by, status, client_operation_id, client_created_at, device_uuid)
     VALUES (?, ?, 'PENDING', ?, ?, ?)`, [
        batch.id,
        user.userId,
        input.operation_id,
        toDate(input.client_timestamp),
        deviceUuid,
    ]);
    const [update] = await conn.execute(`UPDATE batches SET status = 'DISPATCH_ORDER_RAISED', updated_at = CURRENT_TIMESTAMP(3)
     WHERE id = ? AND status = ?`, [batch.id, batch.status]);
    if (update.affectedRows !== 1) {
        throw new SyncConflictError('Batch was changed by another user. Refresh and try again.', {
            batch_id: batch.id,
            current_status: batch.status,
        });
    }
    await logActivity(conn, user, 'DISPATCH_ORDER_RAISED', `Dispatch order raised for batch ${batch.batch_number} (${batch.product_name})`);
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
async function applyDispatchConfirm(conn, user, deviceUuid, input) {
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
    let orderId = null;
    if (batch.status === 'DISPATCH_APPROVED') {
        const [orders] = await conn.execute(`SELECT id FROM dispatch_orders
       WHERE batch_id = ? AND status = 'APPROVED'
       ORDER BY id DESC LIMIT 1 FOR UPDATE`, [batch.id]);
        if (orders.length === 0) {
            throw new SyncConflictError('No approved dispatch order was found for this batch', {
                batch_id: batch.id,
                current_status: batch.status,
            });
        }
        orderId = Number(orders[0].id);
    }
    else if (batch.status === 'QC_PASSED') {
        const directAllowed = payload.direct === true && (user.role === 'ADMIN' || process.env.ALLOW_DIRECT_DISPATCH === 'true');
        if (!directAllowed) {
            throw new SyncConflictError('Raise a dispatch order and wait for admin approval before dispatching', {
                batch_id: batch.id,
                current_status: batch.status,
            });
        }
    }
    else {
        throw new SyncConflictError(`Batch cannot be dispatched from status ${batch.status}`, {
            batch_id: batch.id,
            current_status: batch.status,
        });
    }
    const [insert] = await conn.execute(`INSERT INTO dispatch_records
      (batch_id, dispatcher_id, remarks, images, dispatch_order_id,
       client_operation_id, client_created_at, device_uuid)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [
        batch.id,
        user.userId,
        remarks,
        images.length > 0 ? JSON.stringify(images) : null,
        orderId,
        input.operation_id,
        toDate(input.client_timestamp),
        deviceUuid,
    ]);
    const [update] = await conn.execute(`UPDATE batches SET status = 'DISPATCHED', updated_at = CURRENT_TIMESTAMP(3)
     WHERE id = ? AND status = ?`, [batch.id, batch.status]);
    if (update.affectedRows !== 1) {
        throw new SyncConflictError('Batch was changed by another user. Refresh and try again.', {
            batch_id: batch.id,
            current_status: batch.status,
        });
    }
    if (orderId) {
        await conn.execute('UPDATE dispatch_orders SET dispatched_at = CURRENT_TIMESTAMP(3) WHERE id = ?', [orderId]);
    }
    await logActivity(conn, user, 'DISPATCHED', `Batch ${batch.batch_number} (${batch.product_name}) dispatched`);
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
async function applyProductionFix(conn, user, input) {
    if (!['PRODUCTION', 'ADMIN'].includes(user.role)) {
        throw new SyncError('Only production or admin users can record a batch fix', 'FORBIDDEN', 403);
    }
    const batch = await getBatchForUpdate(conn, input.payload);
    assertStatus(batch, ['QC_FAILED'], `Only QC_FAILED batches can be fixed. Current status: ${batch.status}`);
    const description = typeof input.payload.description === 'string'
        ? input.payload.description.slice(0, 4000)
        : null;
    const [insert] = await conn.execute(`INSERT INTO fix_records (batch_id, fixed_by, description) VALUES (?, ?, ?)`, [batch.id, user.userId, description]);
    const [update] = await conn.execute(`UPDATE batches SET status = 'CREATED', updated_at = CURRENT_TIMESTAMP(3)
     WHERE id = ? AND status = 'QC_FAILED'`, [batch.id]);
    if (update.affectedRows !== 1) {
        throw new SyncConflictError('Batch was changed by another user. Refresh and try again.', {
            batch_id: batch.id,
            current_status: batch.status,
        });
    }
    await logActivity(conn, user, 'BATCH_FIXED', `Batch ${batch.batch_number} fixed and sent back to QC`);
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
async function applyOperation(user, deviceUuid, input) {
    validateOperation(input);
    try {
        return await (0, database_1.withTransaction)(async (conn) => {
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
                return existing;
            }
            let applied;
            switch (input.type) {
                case 'QC_SUBMIT':
                    applied = await applyQcSubmit(conn, user, deviceUuid, input);
                    break;
                case 'DISPATCH_ORDER_RAISE':
                    applied = await applyDispatchOrderRaise(conn, user, deviceUuid, input);
                    break;
                case 'DISPATCH_CONFIRM':
                    applied = await applyDispatchConfirm(conn, user, deviceUuid, input);
                    break;
                case 'PRODUCTION_FIX':
                    applied = await applyProductionFix(conn, user, input);
                    break;
                default:
                    throw new SyncError(`Unsupported operation type: ${input.type}`, 'INVALID_OPERATION_TYPE');
            }
            const result = {
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
    }
    catch (error) {
        if (isDuplicateKey(error)) {
            const existing = await findExistingOperation(null, input.operation_id);
            if (existing)
                return existing;
        }
        const isKnown = error instanceof SyncError;
        const status = isKnown && error.code === 'CONFLICT' ? 'CONFLICT' : 'FAILED';
        const result = {
            operation_id: input.operation_id,
            status,
            entity_type: null,
            entity_id: null,
            error: error instanceof Error ? error.message : 'Unknown sync error',
            error_code: isKnown ? error.code : 'INTERNAL_ERROR',
        };
        try {
            await recordOperation(null, user, deviceUuid, input, status, result.error_code || null, result.error || null, result);
        }
        catch (recordError) {
            console.error('Could not record failed sync operation:', recordError);
        }
        if (!isKnown) {
            console.error(`Unexpected sync error for ${input.operation_id}:`, error);
        }
        return result;
    }
}
async function registerDevice(user, input) {
    const deviceUuid = String(input.device_uuid || '');
    if (!DEVICE_ID_PATTERN.test(deviceUuid)) {
        throw new SyncError('device_uuid must be 8-100 URL-safe characters', 'INVALID_DEVICE_ID');
    }
    const platform = String(input.platform || 'unknown').slice(0, 20);
    const appVersion = input.app_version ? String(input.app_version).slice(0, 30) : null;
    const pushToken = input.push_token ? String(input.push_token).slice(0, 255) : null;
    await (0, database_1.execute)(`INSERT INTO devices (device_uuid, user_id, user_role, platform, app_version, push_token, last_seen_at)
     VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP(3))
     ON DUPLICATE KEY UPDATE
       user_id = VALUES(user_id), user_role = VALUES(user_role), platform = VALUES(platform),
       app_version = VALUES(app_version), push_token = COALESCE(VALUES(push_token), push_token),
       last_seen_at = CURRENT_TIMESTAMP(3)`, [deviceUuid, user.userId, user.role, platform, appVersion, pushToken]);
    await (0, database_1.execute)(`INSERT INTO device_sync_state (device_uuid, updated_at)
     VALUES (?, CURRENT_TIMESTAMP(3))
     ON DUPLICATE KEY UPDATE updated_at = CURRENT_TIMESTAMP(3)`, [deviceUuid]);
    return { device_uuid: deviceUuid };
}
async function touchDeviceSync(deviceUuid, kind, error) {
    if (!deviceUuid || !DEVICE_ID_PATTERN.test(deviceUuid))
        return;
    const column = kind === 'pull' ? 'last_pull_at' : 'last_push_at';
    await (0, database_1.execute)(`INSERT INTO device_sync_state (device_uuid, ${column}, last_error, updated_at)
     VALUES (?, CURRENT_TIMESTAMP(3), ?, CURRENT_TIMESTAMP(3))
     ON DUPLICATE KEY UPDATE ${column} = CURRENT_TIMESTAMP(3),
       last_error = VALUES(last_error), updated_at = CURRENT_TIMESTAMP(3)`, [deviceUuid, error || null]);
}
//# sourceMappingURL=syncService.js.map