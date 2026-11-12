import { useMongo } from '../config/database';
import * as mysqlImpl from './dispatchOrderController.mysql';
import * as mongoImpl from './dispatchOrderController.mongo';

const implementation = useMongo ? mongoImpl : mysqlImpl;

export const raise = implementation.raise;
export const listAll = implementation.listAll;
export const listMine = implementation.listMine;
export const cancel = implementation.cancel;
export const recallQr = implementation.recallQr;
export const getPackingList = implementation.getPackingList;
export const getPackingListPdf = implementation.getPackingListPdf;
