"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.login = login;
exports.refresh = refresh;
exports.logout = logout;
exports.me = me;
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const crypto_1 = require("crypto");
const database_1 = require("../config/database");
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';
const JWT_EXPIRES_IN = (process.env.JWT_EXPIRES_IN || '24h');
const REFRESH_TOKEN_DAYS = Number(process.env.REFRESH_TOKEN_DAYS) || 30;
const USER_TABLES = [
    { table: 'admins', role: 'ADMIN' },
    { table: 'qc_users', role: 'QC' },
    { table: 'dispatch_users', role: 'DISPATCH' },
];
function hashToken(token) {
    return (0, crypto_1.createHash)('sha256').update(token).digest('hex');
}
function signAccessToken(user, role, table) {
    return jsonwebtoken_1.default.sign({ userId: user.id, role, name: user.name, email: user.email, table }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}
async function issueRefreshToken(user, role, table, deviceUuid) {
    const refreshToken = (0, crypto_1.randomBytes)(48).toString('hex');
    const tokenHash = hashToken(refreshToken);
    const expiresAt = new Date(Date.now() + REFRESH_TOKEN_DAYS * 24 * 60 * 60 * 1000);
    await (0, database_1.query)(`INSERT INTO refresh_tokens (token_hash, user_id, user_role, user_table, device_uuid, expires_at)
     VALUES (?, ?, ?, ?, ?, ?)`, [tokenHash, user.id, role, table, deviceUuid || null, expiresAt]);
    return { refreshToken, refreshExpiresAt: expiresAt.toISOString() };
}
async function findActiveUser(role, table, id) {
    const rows = await (0, database_1.query)(`SELECT id, name, email, is_active FROM \`${table}\` WHERE id = ?`, [id]);
    if (rows.length === 0 || Number(rows[0].is_active) !== 1)
        return null;
    return rows[0];
}
async function login(req, res) {
    const { email, password, device_uuid } = req.body;
    if (!email || !password) {
        res.status(400).json({ error: 'Email and password required' });
        return;
    }
    for (const c of USER_TABLES) {
        const rows = await (0, database_1.query)(`SELECT * FROM \`${c.table}\` WHERE email = ?`, [email]);
        if (rows.length > 0) {
            const user = rows[0];
            const valid = await bcryptjs_1.default.compare(password, user.password_hash);
            if (!valid) {
                res.status(401).json({ error: 'Invalid credentials' });
                return;
            }
            if (Number(user.is_active) !== 1) {
                res.status(403).json({ error: 'Account is deactivated. Contact an administrator.' });
                return;
            }
            const account = user;
            const token = signAccessToken(account, c.role, c.table);
            const refresh = await issueRefreshToken(account, c.role, c.table, device_uuid);
            res.json({
                token,
                refreshToken: refresh.refreshToken,
                refreshExpiresAt: refresh.refreshExpiresAt,
                user: { id: user.id, name: user.name, email: user.email, role: c.role },
            });
            return;
        }
    }
    res.status(401).json({ error: 'Invalid credentials' });
}
async function refresh(req, res) {
    const { refreshToken, device_uuid } = req.body;
    if (!refreshToken || typeof refreshToken !== 'string') {
        res.status(400).json({ error: 'Refresh token required' });
        return;
    }
    try {
        const result = await (0, database_1.withTransaction)(async (conn) => {
            const [rows] = await conn.execute(`SELECT * FROM refresh_tokens
         WHERE token_hash = ? AND revoked_at IS NULL AND expires_at > NOW(3)
         FOR UPDATE`, [hashToken(refreshToken)]);
            if (rows.length === 0)
                return null;
            const record = rows[0];
            const supportedTables = {
                admins: 'ADMIN',
                qc_users: 'QC',
                dispatch_users: 'DISPATCH',
            };
            if (supportedTables[record.user_table] !== record.user_role)
                return null;
            const user = await findActiveUser(record.user_role, record.user_table, record.user_id);
            if (!user)
                return null;
            await conn.execute('UPDATE refresh_tokens SET revoked_at = NOW(3) WHERE id = ? AND revoked_at IS NULL', [record.id]);
            const next = (0, crypto_1.randomBytes)(48).toString('hex');
            const expiresAt = new Date(Date.now() + REFRESH_TOKEN_DAYS * 24 * 60 * 60 * 1000);
            await conn.execute(`INSERT INTO refresh_tokens (token_hash, user_id, user_role, user_table, device_uuid, expires_at)
         VALUES (?, ?, ?, ?, ?, ?)`, [hashToken(next), record.user_id, record.user_role, record.user_table, device_uuid || record.device_uuid, expiresAt]);
            const account = user;
            return {
                token: signAccessToken(account, record.user_role, record.user_table),
                refreshToken: next,
                refreshExpiresAt: expiresAt.toISOString(),
                user: { id: account.id, name: account.name, email: account.email, role: record.user_role },
            };
        });
        if (!result) {
            res.status(401).json({ error: 'Invalid or expired refresh token' });
            return;
        }
        res.json(result);
    }
    catch (error) {
        console.error('Refresh token error:', error);
        res.status(500).json({ error: 'Could not refresh session' });
    }
}
async function logout(req, res) {
    if (!req.user) {
        res.status(401).json({ error: 'Not authenticated' });
        return;
    }
    const { refreshToken, allDevices } = req.body || {};
    if (refreshToken && typeof refreshToken === 'string') {
        await (0, database_1.query)(`UPDATE refresh_tokens SET revoked_at = NOW(3)
       WHERE token_hash = ? AND user_id = ? AND user_role = ? AND revoked_at IS NULL`, [hashToken(refreshToken), req.user.userId, req.user.role]);
    }
    else if (allDevices) {
        await (0, database_1.query)(`UPDATE refresh_tokens SET revoked_at = NOW(3)
       WHERE user_id = ? AND user_role = ? AND revoked_at IS NULL`, [req.user.userId, req.user.role]);
    }
    res.json({ message: 'Signed out' });
}
async function me(_req, res) {
    if (!_req.user) {
        res.status(401).json({ error: 'Not authenticated' });
        return;
    }
    const rows = await (0, database_1.query)(`SELECT id, name, email, is_active, created_at FROM \`${_req.user.table}\` WHERE id = ?`, [_req.user.userId]);
    if (rows.length === 0) {
        res.status(404).json({ error: 'User not found' });
        return;
    }
    if (Number(rows[0].is_active) !== 1) {
        res.status(403).json({ error: 'Account is deactivated. Contact an administrator.' });
        return;
    }
    res.json({ ...rows[0], role: _req.user.role });
}
//# sourceMappingURL=authController.js.map