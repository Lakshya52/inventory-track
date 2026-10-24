import { useMongo } from '../config/database';
import * as mysqlImpl from './qrLabelController.mysql';
import * as mongoImpl from './qrLabelController.mongo';

const implementation = useMongo ? mongoImpl : mysqlImpl;

export const create = implementation.create;
export const list = implementation.list;
export const getById = implementation.getById;
export const reprint = implementation.reprint;
