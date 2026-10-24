import { useMongo } from '../config/database';
import * as mysqlImpl from './qcController.mysql';
import * as mongoImpl from './qcController.mongo';

const implementation = useMongo ? mongoImpl : mysqlImpl;

export const submit = implementation.submit;
export const submitBulk = implementation.submitBulk;
export const reopenFailedBatch = implementation.reopenFailedBatch;
export const stats = implementation.stats;
export const pending = implementation.pending;
export const records = implementation.records;
