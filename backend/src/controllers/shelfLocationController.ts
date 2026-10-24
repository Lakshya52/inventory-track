import { useMongo } from '../config/database';
import * as mysqlImpl from './shelfLocationController.mysql';
import * as mongoImpl from './shelfLocationController.mongo';

const implementation = useMongo ? mongoImpl : mysqlImpl;

export const list = implementation.list;
export const create = implementation.create;
export const update = implementation.update;
export const remove = implementation.remove;
