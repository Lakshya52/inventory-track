import { useMongo } from '../config/database';
import * as mysqlImpl from './reportController.mysql';
import * as mongoImpl from './reportController.mongo';

const implementation = useMongo ? mongoImpl : mysqlImpl;

export const summary = implementation.summary;
export const qcReport = implementation.qcReport;
export const dispatchReport = implementation.dispatchReport;
export const dispatchRequests = implementation.dispatchRequests;
export const inventory = implementation.inventory;
export const batchesReport = implementation.batchesReport;
