import { JwtPayload, SyncOperationInput, SyncOperationResult } from '../types';
export declare class SyncError extends Error {
    readonly code: string;
    readonly httpStatus: number;
    readonly details?: Record<string, any> | undefined;
    constructor(message: string, code?: string, httpStatus?: number, details?: Record<string, any> | undefined);
}
export declare class SyncConflictError extends SyncError {
    constructor(message: string, details?: Record<string, any>);
}
/**
 * Applies one offline operation in its own transaction. The unique
 * operation_id is the idempotency key; retries return the original outcome.
 */
export declare function applyOperation(user: JwtPayload, deviceUuid: string | null, input: SyncOperationInput): Promise<SyncOperationResult>;
export declare function registerDevice(user: JwtPayload, input: {
    device_uuid?: string;
    platform?: string;
    app_version?: string;
    push_token?: string;
}): Promise<{
    device_uuid: string;
}>;
export declare function touchDeviceSync(deviceUuid: string | null, kind: 'pull' | 'push', error?: string | null): Promise<void>;
//# sourceMappingURL=syncService.d.ts.map