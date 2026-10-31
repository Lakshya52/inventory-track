import { useMongo } from '../config/database';
import * as mysqlImpl from './authController.mysql';
import * as mongoImpl from './authController.mongo';
import { registerTenant } from './tenantController';

const implementation = useMongo ? mongoImpl : mysqlImpl;

export const login = implementation.login;
export const refresh = implementation.refresh;
export const logout = implementation.logout;
export const me = implementation.me;
export { registerTenant };
