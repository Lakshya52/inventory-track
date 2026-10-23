"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.listAllUsers = listAllUsers;
exports.listUsers = listUsers;
exports.addUser = addUser;
exports.updateUser = updateUser;
exports.changePassword = changePassword;
exports.setUserStatus = setUserStatus;
exports.deleteUser = deleteUser;
exports.updateProfile = updateProfile;
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const database_1 = require("../config/database");
const USER_TYPES = {
    admin: { table: 'admins', role: 'ADMIN' },
    qc: { table: 'qc_users', role: 'QC' },
    dispatch: { table: 'dispatch_users', role: 'DISPATCH' },
    production: { table: 'production_users', role: 'PRODUCTION' },
};
function normalizeType(value) {
    if (!value)
        return null;
    const key = value.toLowerCase().replace(/s$/, '');
    return USER_TYPES[key] || null;
}
function normalizeRole(value) {
    if (!value)
        return null;
    return normalizeType(value.toLowerCase());
}
async function logActivity(req, action, description) {
    await (0, database_1.execute)('INSERT INTO activity_logs (user_name, user_role, action, description) VALUES (?, ?, ?, ?)', [req.user?.name || 'System', req.user?.role || 'ADMIN', action, description]);
}
function publicUser(row, role) {
    return {
        id: row.id,
        name: row.name,
        email: row.email,
        role,
        is_active: Number(row.is_active) === 1 ? 1 : 0,
        created_at: row.created_at,
    };
}
async function listAllUsers(_req, res) {
    const results = await Promise.all(Object.values(USER_TYPES).map(async (info) => {
        const rows = await (0, database_1.query)(`SELECT id, name, email, is_active, created_at FROM ${info.table} ORDER BY created_at DESC`);
        return rows.map(row => publicUser(row, info.role));
    }));
    const users = results
        .flat()
        .sort((a, b) => new Date(String(b.created_at)).getTime() - new Date(String(a.created_at)).getTime());
    res.json(users);
}
async function listUsers(req, res) {
    const info = normalizeType(req.params.type);
    if (!info) {
        res.status(400).json({ error: 'Invalid user type' });
        return;
    }
    const users = await (0, database_1.query)(`SELECT id, name, email, is_active, created_at FROM ${info.table} ORDER BY created_at DESC`);
    res.json(users.map(row => publicUser(row, info.role)));
}
async function addUser(req, res) {
    const info = normalizeType(req.params.type) || normalizeRole(req.body.role);
    if (!info) {
        res.status(400).json({ error: 'A valid role is required' });
        return;
    }
    const { name, email, password } = req.body;
    if (!name || !email || !password) {
        res.status(400).json({ error: 'Name, email, and password are required' });
        return;
    }
    if (String(password).length < 6) {
        res.status(400).json({ error: 'Password must be at least 6 characters' });
        return;
    }
    try {
        const hash = await bcryptjs_1.default.hash(password, 10);
        const result = await (0, database_1.execute)(`INSERT INTO ${info.table} (name, email, password_hash, is_active) VALUES (?, ?, ?, 1)`, [name.trim(), email.trim().toLowerCase(), hash]);
        await logActivity(req, 'USER_CREATED', `${info.role} user "${name}" (${email}) created`);
        res.status(201).json({ id: result.insertId, name, email, role: info.role, is_active: 1 });
    }
    catch (err) {
        if (err.code === 'ER_DUP_ENTRY') {
            res.status(400).json({ error: 'Email already exists' });
            return;
        }
        throw err;
    }
}
async function updateUser(req, res) {
    const info = normalizeType(req.params.type);
    if (!info) {
        res.status(400).json({ error: 'Invalid user type' });
        return;
    }
    const { id } = req.params;
    const { name, email } = req.body;
    if (!name || !email) {
        res.status(400).json({ error: 'Name and email are required' });
        return;
    }
    try {
        const result = await (0, database_1.execute)(`UPDATE ${info.table} SET name = ?, email = ? WHERE id = ?`, [name.trim(), email.trim().toLowerCase(), id]);
        if (result.affectedRows === 0) {
            res.status(404).json({ error: 'User not found' });
            return;
        }
        await logActivity(req, 'USER_UPDATED', `${info.role} user "${name}" (${email}) updated`);
        res.json({ message: 'User updated' });
    }
    catch (err) {
        if (err.code === 'ER_DUP_ENTRY') {
            res.status(400).json({ error: 'Email already exists' });
            return;
        }
        throw err;
    }
}
async function changePassword(req, res) {
    const info = normalizeType(req.params.type);
    if (!info) {
        res.status(400).json({ error: 'Invalid user type' });
        return;
    }
    const { id } = req.params;
    const { password } = req.body;
    if (!password || String(password).length < 6) {
        res.status(400).json({ error: 'Password must be at least 6 characters' });
        return;
    }
    const hash = await bcryptjs_1.default.hash(password, 10);
    const result = await (0, database_1.execute)(`UPDATE ${info.table} SET password_hash = ? WHERE id = ?`, [hash, id]);
    if (result.affectedRows === 0) {
        res.status(404).json({ error: 'User not found' });
        return;
    }
    await logActivity(req, 'USER_PASSWORD_CHANGED', `Password changed for ${info.role} user #${id}`);
    res.json({ message: 'Password updated' });
}
async function setUserStatus(req, res) {
    const info = normalizeType(req.params.type);
    if (!info) {
        res.status(400).json({ error: 'Invalid user type' });
        return;
    }
    const { id } = req.params;
    const active = req.body.is_active === true || req.body.is_active === 1 || req.body.is_active === '1';
    const isSelf = info.role === req.user?.role && Number(id) === req.user?.userId;
    if (isSelf && !active) {
        res.status(400).json({ error: 'You cannot deactivate your own account' });
        return;
    }
    const result = await (0, database_1.execute)(`UPDATE ${info.table} SET is_active = ? WHERE id = ?`, [active ? 1 : 0, id]);
    if (result.affectedRows === 0) {
        res.status(404).json({ error: 'User not found' });
        return;
    }
    await logActivity(req, active ? 'USER_ACTIVATED' : 'USER_DEACTIVATED', `${info.role} user #${id} ${active ? 'activated' : 'deactivated'}`);
    res.json({ message: active ? 'User activated' : 'User deactivated', is_active: active ? 1 : 0 });
}
async function deleteUser(req, res) {
    const info = normalizeType(req.params.type);
    if (!info) {
        res.status(400).json({ error: 'Invalid user type' });
        return;
    }
    const { id } = req.params;
    if (info.role === req.user?.role && Number(id) === req.user?.userId) {
        res.status(400).json({ error: 'You cannot delete your own account' });
        return;
    }
    const result = await (0, database_1.execute)(`DELETE FROM ${info.table} WHERE id = ?`, [id]);
    if (result.affectedRows === 0) {
        res.status(404).json({ error: 'User not found' });
        return;
    }
    await logActivity(req, 'USER_DELETED', `${info.role} user #${id} deleted`);
    res.json({ message: 'User deleted' });
}
async function updateProfile(req, res) {
    if (!req.user) {
        res.status(401).json({ error: 'Not authenticated' });
        return;
    }
    const { name, currentPassword, newPassword } = req.body;
    const rows = await (0, database_1.query)(`SELECT * FROM ${req.user.table} WHERE id = ?`, [req.user.userId]);
    if (rows.length === 0) {
        res.status(404).json({ error: 'User not found' });
        return;
    }
    if (newPassword) {
        if (!currentPassword) {
            res.status(400).json({ error: 'Current password is required to set a new password' });
            return;
        }
        const valid = await bcryptjs_1.default.compare(currentPassword, rows[0].password_hash);
        if (!valid) {
            res.status(400).json({ error: 'Current password is incorrect' });
            return;
        }
        const hash = await bcryptjs_1.default.hash(newPassword, 10);
        await (0, database_1.execute)(`UPDATE ${req.user.table} SET name = ?, password_hash = ? WHERE id = ?`, [name || req.user.name, hash, req.user.userId]);
    }
    else {
        await (0, database_1.execute)(`UPDATE ${req.user.table} SET name = ? WHERE id = ?`, [name || req.user.name, req.user.userId]);
    }
    res.json({ message: 'Profile updated' });
}
//# sourceMappingURL=userController.js.map