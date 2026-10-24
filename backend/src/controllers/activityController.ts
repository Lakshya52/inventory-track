import { useMongo } from '../config/database';
import * as mysqlImpl from './activityController.mysql';
import * as mongoImpl from './activityController.mongo';

const implementation = useMongo ? mongoImpl : mysqlImpl;

export const list = implementation.list;