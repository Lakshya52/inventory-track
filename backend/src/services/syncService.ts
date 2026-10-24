import { useMongo } from '../config/database';
import * as mysqlImpl from './syncService.mysql';
import * as mongoImpl from './syncService.mongo';

const implementation = useMongo ? mongoImpl : mysqlImpl;

export const applyOperation = implementation.applyOperation;
export const registerDevice = implementation.registerDevice;
export const touchDeviceSync = implementation.touchDeviceSync;
export const SyncError = implementation.SyncError;
export const SyncConflictError = implementation.SyncConflictError;
