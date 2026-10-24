import { useMongo } from '../config/database';
import * as mysqlImpl from './dashboardController.mysql';
import * as mongoImpl from './dashboardController.mongo';

const implementation = useMongo ? mongoImpl : mysqlImpl;

export const stats = implementation.stats;
export const adminStats = implementation.adminStats;
