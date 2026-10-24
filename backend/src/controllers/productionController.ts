import { useMongo } from '../config/database';
import * as mysqlImpl from './productionController.mysql';
import * as mongoImpl from './productionController.mongo';

const implementation = useMongo ? mongoImpl : mysqlImpl;

export const listBatches = implementation.listBatches;
export const fixBatch = implementation.fixBatch;
export const listFixRecords = implementation.listFixRecords;
export const submitForQc = implementation.submitForQc;
