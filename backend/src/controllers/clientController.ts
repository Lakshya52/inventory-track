import { useMongo } from '../config/database';
import * as mysqlImpl from './clientController.mysql';
import * as mongoImpl from './clientController.mongo';

const implementation = useMongo ? mongoImpl : mysqlImpl;

export const list = implementation.list;
export const create = implementation.create;
export const update = implementation.update;
export const remove = implementation.remove;
