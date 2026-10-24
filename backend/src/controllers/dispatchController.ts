import { useMongo } from '../config/database';
import * as mysqlImpl from './dispatchController.mysql';
import * as mongoImpl from './dispatchController.mongo';

const implementation = useMongo ? mongoImpl : mysqlImpl;

export const submit = implementation.submit;
export const submitBulk = implementation.submitBulk;
export const today = implementation.today;
export const ready = implementation.ready;
export const approvedOrders = implementation.approvedOrders;
export const records = implementation.records;
export const stats = implementation.stats;
