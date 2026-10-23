"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.authenticate = authenticate;
exports.authorize = authorize;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const database_1 = require("../config/database");
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';
const USER_TABLES = new Set(['admins', 'qc_users', 'dispatch_users', 'production_users']);
async function authenticate(req, res, next) {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
        res.status(401).json({ error: 'Authentication required' });
        return;
    }
    try {
        const token = header.split(' ')[1];
        const decoded = jsonwebtoken_1.default.verify(token, JWT_SECRET);
        if (!USER_TABLES.has(decoded.table)) {
            res.status(401).json({ error: 'Invalid or expired token' });
            return;
        }
        const rows = await (0, database_1.query)(`SELECT id, is_active FROM ${decoded.table} WHERE id = ?`, [decoded.userId]);
        if (rows.length === 0) {
            res.status(401).json({ error: 'User account no longer exists' });
            return;
        }
        if (Number(rows[0].is_active) !== 1) {
            res.status(403).json({ error: 'Account is deactivated. Contact an administrator.' });
            return;
        }
        req.user = decoded;
        next();
    }
    catch {
        res.status(401).json({ error: 'Invalid or expired token' });
    }
}
function authorize(...roles) {
    return (req, res, next) => {
        if (!req.user) {
            res.status(401).json({ error: 'Authentication required' });
            return;
        }
        if (!roles.includes(req.user.role)) {
            res.status(403).json({ error: 'Insufficient permissions' });
            return;
        }
        next();
    };
}
//# sourceMappingURL=auth.js.map