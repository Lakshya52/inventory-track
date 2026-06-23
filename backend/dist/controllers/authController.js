"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.login = login;
exports.me = me;
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const database_1 = require("../config/database");
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';
const JWT_EXPIRES_IN = (process.env.JWT_EXPIRES_IN || '24h');
async function login(req, res) {
    const { email, password } = req.body;
    if (!email || !password) {
        res.status(400).json({ error: 'Email and password required' });
        return;
    }
    const users = await (0, database_1.query)('SELECT * FROM users WHERE email = ?', [email]);
    if (users.length === 0) {
        res.status(401).json({ error: 'Invalid credentials' });
        return;
    }
    const user = users[0];
    const valid = await bcryptjs_1.default.compare(password, user.password_hash);
    if (!valid) {
        res.status(401).json({ error: 'Invalid credentials' });
        return;
    }
    const payload = { userId: user.id, role: user.role };
    const token = jsonwebtoken_1.default.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
    await (0, database_1.execute)('INSERT INTO activity_logs (user_id, action, description) VALUES (?, ?, ?)', [
        user.id, 'LOGIN', `User ${user.name} logged in`,
    ]);
    res.json({ token, user: { id: user.id, name: user.name, email: user.email, role: user.role } });
}
async function me(_req, res) {
    if (!_req.user) {
        res.status(401).json({ error: 'Not authenticated' });
        return;
    }
    const users = await (0, database_1.query)('SELECT id, name, email, role, created_at FROM users WHERE id = ?', [_req.user.userId]);
    if (users.length === 0) {
        res.status(404).json({ error: 'User not found' });
        return;
    }
    res.json(users[0]);
}
//# sourceMappingURL=authController.js.map