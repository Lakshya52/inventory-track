import { useMongo } from '../config/database';
import * as mysqlImpl from './batchGroupController.mysql';
import * as mongoImpl from './batchGroupController.mongo';

const implementation = useMongo ? mongoImpl : mysqlImpl;
export const createGroup = implementation.createGroup;
