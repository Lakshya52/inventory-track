import { useMongo } from '../config/database';
import * as mysqlImpl from './importController.mysql';
import * as mongoImpl from './importController.mongo';

const implementation = useMongo ? mongoImpl : mysqlImpl;

export const upload = implementation.upload;
export const importProducts = implementation.importProducts;
export const downloadSample = implementation.downloadSample;
