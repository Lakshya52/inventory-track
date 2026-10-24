import { useMongo } from '../config/database';
import * as mysqlImpl from './vendorController.mysql';
import * as mongoImpl from './vendorController.mongo';

const implementation = useMongo ? mongoImpl : mysqlImpl;

export const list = implementation.list;
export const getById = implementation.getById;
export const create = implementation.create;
export const update = implementation.update;
export const setStatus = implementation.setStatus;
export const remove = implementation.remove;
