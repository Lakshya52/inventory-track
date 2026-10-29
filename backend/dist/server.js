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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const compression_1 = __importDefault(require("compression"));
const helmet_1 = __importDefault(require("helmet"));
const crypto_1 = require("crypto");
const auth_1 = __importDefault(require("./routes/auth"));
const products_1 = __importDefault(require("./routes/products"));
const batches_1 = __importDefault(require("./routes/batches"));
const qc_1 = __importDefault(require("./routes/qc"));
const dispatch_1 = __importDefault(require("./routes/dispatch"));
const dispatchOrders_1 = __importDefault(require("./routes/dispatchOrders"));
const dashboard_1 = __importDefault(require("./routes/dashboard"));
const activity_1 = __importDefault(require("./routes/activity"));
const users_1 = __importStar(require("./routes/users"));
const import_1 = __importDefault(require("./routes/import"));
const shelfLocations_1 = __importDefault(require("./routes/shelfLocations"));
const clients_1 = __importDefault(require("./routes/clients"));
const vendors_1 = __importDefault(require("./routes/vendors"));
const masters_1 = __importDefault(require("./routes/masters"));
const reports_1 = __importDefault(require("./routes/reports"));
const sync_1 = __importDefault(require("./routes/sync"));
const production_1 = __importDefault(require("./routes/production"));
const loadingSessions_1 = __importDefault(require("./routes/loadingSessions"));
const errorHandler_1 = require("./middleware/errorHandler");
const rateLimit_1 = require("./middleware/rateLimit");
const schema_1 = require("./config/schema");
const database_1 = require("./config/database");
const uploadController_1 = require("./controllers/uploadController");
const app = (0, express_1.default)();
const PORT = Number(process.env.PORT) || 3001;
const allowedOrigins = (process.env.CORS_ORIGIN || 'http://localhost:3000')
    .split(',')
    .map((origin) => origin.trim().replace(/\/+$/, ''))
    .filter(Boolean);
function isOriginAllowed(origin) {
    return allowedOrigins.some((allowed) => {
        if (allowed === '*')
            return true;
        if (!allowed.includes('*'))
            return origin === allowed;
        const [prefix, suffix] = allowed.split('*');
        return origin.startsWith(prefix) && origin.endsWith(suffix);
    });
}
app.set('trust proxy', 1);
app.use((0, helmet_1.default)({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
}));
app.use((0, compression_1.default)());
app.use((0, cors_1.default)({
    origin: allowedOrigins.length === 0
        ? true
        : (origin, callback) => {
            if (!origin || isOriginAllowed(origin)) {
                callback(null, true);
                return;
            }
            callback(new Error(`Origin ${origin} is not allowed by CORS`));
        },
    credentials: true,
    exposedHeaders: ['RateLimit-Limit', 'RateLimit-Remaining', 'RateLimit-Reset', 'X-Request-Id'],
}));
app.use(express_1.default.json({ limit: '2mb' }));
app.use((req, res, next) => {
    const requestId = String(req.headers['x-request-id'] || (0, crypto_1.randomUUID)());
    res.setHeader('X-Request-Id', requestId);
    req.requestId = requestId;
    next();
});
app.use('/api', (0, rateLimit_1.rateLimit)({
    windowMs: 60_000,
    max: Number(process.env.API_RATE_LIMIT_PER_MINUTE) || 600,
}));
app.get('/uploads/:filename', (req, res) => { void (0, uploadController_1.getUpload)(req, res); });
app.use('/api/auth/login', (0, rateLimit_1.rateLimit)({
    windowMs: 60_000,
    max: Number(process.env.LOGIN_RATE_LIMIT_PER_MINUTE) || 20,
    message: 'Too many sign-in attempts. Please wait a minute and try again.',
}));
app.use('/api/auth', auth_1.default);
app.use('/api/users', users_1.default);
app.use('/api/profile', (0, users_1.profileRoutes)());
app.use('/api/products', products_1.default);
app.use('/api/batches', batches_1.default);
app.use('/api/qc', qc_1.default);
app.use('/api/dispatch', dispatch_1.default);
app.use('/api/dispatch-orders', dispatchOrders_1.default);
app.use('/api/dashboard', dashboard_1.default);
app.use('/api/activity', activity_1.default);
app.use('/api/products/import', import_1.default);
app.use('/api/shelf-locations', shelfLocations_1.default);
app.use('/api/clients', clients_1.default);
app.use('/api/vendors', vendors_1.default);
app.use('/api/masters', masters_1.default);
app.use('/api/reports', reports_1.default);
app.use('/api/sync', sync_1.default);
app.use('/api/production', production_1.default);
app.use('/api/loading-sessions', loadingSessions_1.default);
app.get('/api/health', async (_req, res) => {
    const db = await (0, database_1.checkDatabase)();
    res.status(db ? 200 : 503).json({
        status: db ? 'ok' : 'degraded',
        database: db ? 'up' : 'down',
        uptime_seconds: Math.round(process.uptime()),
        server_time: new Date().toISOString(),
    });
});
app.use(errorHandler_1.errorHandler);
let server = null;
async function start() {
    await (0, schema_1.ensureAdminSchema)();
    server = app.listen(PORT, '0.0.0.0', () => {
        console.log(`Backend running on http://0.0.0.0:${PORT}`);
    });
}
async function shutdown(signal) {
    console.log(`${signal} received, shutting down...`);
    const timer = setTimeout(() => process.exit(1), 10_000);
    timer.unref();
    if (server) {
        await new Promise((resolve) => server.close(() => resolve()));
    }
    await (0, database_1.closePool)();
    clearTimeout(timer);
    process.exit(0);
}
process.on('SIGTERM', () => { void shutdown('SIGTERM'); });
process.on('SIGINT', () => { void shutdown('SIGINT'); });
start().catch((err) => {
    console.error('Failed to start server:', err);
    process.exit(1);
});
exports.default = app;
//# sourceMappingURL=server.js.map