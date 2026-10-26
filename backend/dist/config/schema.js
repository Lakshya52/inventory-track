"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ensureAdminSchema = ensureAdminSchema;
const database_1 = require("./database");
const schema_mysql_1 = require("./schema.mysql");
const schema_mongo_1 = require("./schema.mongo");
/**
 * Idempotent startup migration for the selected database.
 * MySQL keeps the original SQL DDL; MongoDB creates its indexes.
 */
async function ensureAdminSchema() {
    if (database_1.useMongo) {
        await (0, schema_mongo_1.ensureAdminSchema)();
        return;
    }
    await (0, schema_mysql_1.ensureAdminSchema)();
}
//# sourceMappingURL=schema.js.map