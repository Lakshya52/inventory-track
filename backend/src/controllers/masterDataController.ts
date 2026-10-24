import { useMongo } from '../config/database';
import * as mysqlImpl from './masterDataController.mysql';
import * as mongoImpl from './masterDataController.mongo';

const implementation = useMongo ? mongoImpl : mysqlImpl;

export const list = implementation.list;
export const create = implementation.create;
export const update = implementation.update;
export const remove = implementation.remove;
export const setStatus = implementation.setStatus;
