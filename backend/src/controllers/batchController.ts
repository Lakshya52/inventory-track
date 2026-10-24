import { useMongo } from '../config/database';
import * as mysqlImpl from './batchController.mysql';
import * as mongoImpl from './batchController.mongo';

const implementation = useMongo ? mongoImpl : mysqlImpl;

export const create = implementation.create;
export const list = implementation.list;
export const getByBarcode = implementation.getByBarcode;
export const search = implementation.search;
export const update = implementation.update;
export const getById = implementation.getById;
