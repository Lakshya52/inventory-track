"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
/**
 * Seeds whichever database is selected. MySQL keeps the original script;
 * MongoDB uses the equivalent collections seed with native ObjectIds.
 */
const useMongo = (process.env.DB_CLIENT || 'mysql').toLowerCase() === 'mongo';
if (useMongo) {
    require('./seed.mongo');
}
else {
    require('./seed.mysql');
}
//# sourceMappingURL=seed.js.map