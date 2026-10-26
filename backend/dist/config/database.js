"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.dayKey = exports.ageMinutes = exports.daysAgo = exports.startOfWeek = exports.endOfDay = exports.startOfDay = exports.parseDateValue = exports.isDuplicateKey = exports.isValidId = exports.idKey = exports.stripIds = exports.stripId = exports.now = exports.DbContext = exports.getContext = exports.getDb = exports.getClient = exports.execute = exports.query = exports.getPool = exports.useMongo = void 0;
exports.withTransaction = withTransaction;
exports.checkDatabase = checkDatabase;
exports.closePool = closePool;
const mysql = __importStar(require("./database.mysql"));
const mongo = __importStar(require("./database.mongo"));
/**
 * Database switch. MySQL remains the production default; set
 * DB_CLIENT=mongo to run the same API on MongoDB (for example on Vercel).
 */
exports.useMongo = (process.env.DB_CLIENT || 'mysql').toLowerCase() === 'mongo';
// --- MySQL (default / production) -----------------------------------------
exports.getPool = mysql.getPool;
exports.query = mysql.query;
exports.execute = mysql.execute;
// --- MongoDB --------------------------------------------------------------
exports.getClient = mongo.getClient;
exports.getDb = mongo.getDb;
exports.getContext = mongo.getContext;
var database_mongo_1 = require("./database.mongo");
Object.defineProperty(exports, "DbContext", { enumerable: true, get: function () { return database_mongo_1.DbContext; } });
exports.now = mongo.now;
exports.stripId = mongo.stripId;
exports.stripIds = mongo.stripIds;
exports.idKey = mongo.idKey;
exports.isValidId = mongo.isValidId;
exports.isDuplicateKey = mongo.isDuplicateKey;
exports.parseDateValue = mongo.parseDateValue;
exports.startOfDay = mongo.startOfDay;
exports.endOfDay = mongo.endOfDay;
exports.startOfWeek = mongo.startOfWeek;
exports.daysAgo = mongo.daysAgo;
exports.ageMinutes = mongo.ageMinutes;
exports.dayKey = mongo.dayKey;
// --- Shared API -----------------------------------------------------------
function withTransaction(fn) {
    return exports.useMongo
        ? mongo.withTransaction(fn)
        : mysql.withTransaction(fn);
}
function checkDatabase() {
    return exports.useMongo ? mongo.checkDatabase() : mysql.checkDatabase();
}
function closePool() {
    return exports.useMongo ? mongo.closePool() : mysql.closePool();
}
//# sourceMappingURL=database.js.map