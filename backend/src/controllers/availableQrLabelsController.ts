import { useMongo } from '../config/database';
import * as mysqlImpl from './availableQrLabelsController.mysql';
import * as mongoImpl from './availableQrLabelsController.mongo';

const implementation = useMongo ? mongoImpl : mysqlImpl;

export const availableQrLabels = implementation.availableQrLabels;
