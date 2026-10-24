import { useMongo } from '../config/database';
import * as mysqlImpl from './productController.mysql';
import * as mongoImpl from './productController.mongo';

const implementation = useMongo ? mongoImpl : mysqlImpl;

export const create = implementation.create;
export const list = implementation.list;
export const getById = implementation.getById;
export const search = implementation.search;
export const remove = implementation.remove;
export const update = implementation.update;
