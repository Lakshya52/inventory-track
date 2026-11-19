import { useMongo } from '../config/database';
import * as mysqlImpl from './importController.mysql';
import * as mongoImpl from './importController.mongo';

const implementation = useMongo ? mongoImpl : mysqlImpl;

export const upload = implementation.upload;
export const downloadTemplate = implementation.downloadTemplate;
export const validateImport = implementation.validateImport;
export const applyImport = implementation.applyImport;
