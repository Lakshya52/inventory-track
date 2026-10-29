import { useMongo } from '../config/database';
import * as mysqlImpl from './dispatchOrderController.mysql';
import * as mongoImpl from './dispatchOrderController.mongo';

const implementation = useMongo ? mongoImpl : mysqlImpl;

export const raise = implementation.raise;
export const listPending = implementation.listPending;
export const listAll = implementation.listAll;
export const listMine = implementation.listMine;
export const approve = implementation.approve;
export const reject = implementation.reject;
export const getPackingList = implementation.getPackingList;
export const getPackingListPdf = implementation.getPackingListPdf;
