import * as mysqlImpl from './authController.mysql';
import { registerTenant } from './tenantController';
export declare const login: typeof mysqlImpl.login;
export declare const refresh: typeof mysqlImpl.refresh;
export declare const logout: typeof mysqlImpl.logout;
export declare const me: typeof mysqlImpl.me;
export { registerTenant };
//# sourceMappingURL=authController.d.ts.map