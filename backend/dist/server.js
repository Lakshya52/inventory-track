"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};

Object.defineProperty(exports, "__esModule", { value: true });


const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const auth_1 = __importDefault(require("./routes/auth"));
const products_1 = __importDefault(require("./routes/products"));
const batches_1 = __importDefault(require("./routes/batches"));
const qc_1 = __importDefault(require("./routes/qc"));
const dispatch_1 = __importDefault(require("./routes/dispatch"));
const dashboard_1 = __importDefault(require("./routes/dashboard"));
const activity_1 = __importDefault(require("./routes/activity"));
const errorHandler_1 = require("./middleware/errorHandler");

const app = (0, express_1.default)();
const PORT = Number(process.env.PORT) || 3001;

app.use((0, cors_1.default)({ origin: true, credentials: true }));
app.use(express_1.default.json());

// app.use('/api/auth', auth_1.default);
app.use('/api/products', products_1.default);
app.use('/api/batches', batches_1.default);
app.use('/api/qc', qc_1.default);
app.use('/api/dispatch', dispatch_1.default);
app.use('/api/dashboard', dashboard_1.default);
app.use('/api/activity', activity_1.default);
app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));

app.use(errorHandler_1.errorHandler);

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Backend running on http://0.0.0.0:${PORT}`);
});

//# sourceMappingURL=server.js.map