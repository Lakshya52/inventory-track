import { useMongo } from '../config/database';
import * as mysqlImpl from './syncController.mysql';
import * as mongoImpl from './syncController.mongo';

const implementation = useMongo ? mongoImpl : mysqlImpl;

export const register = implementation.register;
export const push = implementation.push;
export const pull = implementation.pull;
export const status = implementation.status;
export const uploadAttachments = implementation.uploadAttachments;
