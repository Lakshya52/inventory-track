import { useMongo } from '../config/database';
import * as mysqlAuth from './auth.mysql';
import * as mongoAuth from './auth.mongo';

const implementation = useMongo ? mongoAuth : mysqlAuth;

export const authenticate = implementation.authenticate;
export const authorize = implementation.authorize;
