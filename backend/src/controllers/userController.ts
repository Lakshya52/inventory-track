import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { query, execute } from '../config/database';
import { RowDataPacket } from 'mysql2';

export async function listUsers(req: Request, res: Response): Promise<void> {
  const table = req.params.type; // 'qc' or 'dispatch'
  const dbTable = table === 'qc' ? 'qc_users' : 'dispatch_users';
  const users = await query<RowDataPacket[]>(`SELECT id, name, email, created_at FROM ${dbTable} ORDER BY created_at DESC`);
  res.json(users);
}

export async function addUser(req: Request, res: Response): Promise<void> {
  const table = req.params.type;
  const dbTable = table === 'qc' ? 'qc_users' : 'dispatch_users';
  const { name, email, password } = req.body;
  if (!name || !email || !password) {
    res.status(400).json({ error: 'Name, email, and password are required' });
    return;
  }
  try {
    const hash = await bcrypt.hash(password, 10);
    const result = await execute(`INSERT INTO ${dbTable} (name, email, password_hash) VALUES (?, ?, ?)`, [name, email, hash]);
    res.status(201).json({ id: result.insertId, name, email });
  } catch (err: any) {
    if (err.code === 'ER_DUP_ENTRY') {
      res.status(400).json({ error: 'Email already exists' });
      return;
    }
    throw err;
  }
}

export async function deleteUser(req: Request, res: Response): Promise<void> {
  const table = req.params.type;
  const dbTable = table === 'qc' ? 'qc_users' : 'dispatch_users';
  const { id } = req.params;
  const result = await execute(`DELETE FROM ${dbTable} WHERE id = ?`, [id]);
  if (result.affectedRows === 0) {
    res.status(404).json({ error: 'User not found' });
    return;
  }
  res.json({ message: 'User deleted' });
}

export async function updateProfile(req: Request, res: Response): Promise<void> {
  if (!req.user) { res.status(401).json({ error: 'Not authenticated' }); return; }
  const { name, currentPassword, newPassword } = req.body;
  const rows = await query<RowDataPacket[]>(
    `SELECT * FROM ${req.user.table} WHERE id = ?`, [req.user.userId]
  );
  if (rows.length === 0) { res.status(404).json({ error: 'User not found' }); return; }

  if (newPassword) {
    if (!currentPassword) {
      res.status(400).json({ error: 'Current password is required to set a new password' });
      return;
    }
    const valid = await bcrypt.compare(currentPassword, rows[0].password_hash);
    if (!valid) {
      res.status(400).json({ error: 'Current password is incorrect' });
      return;
    }
    const hash = await bcrypt.hash(newPassword, 10);
    await execute(`UPDATE ${req.user.table} SET name = ?, password_hash = ? WHERE id = ?`, [name || req.user.name, hash, req.user.userId]);
  } else {
    await execute(`UPDATE ${req.user.table} SET name = ? WHERE id = ?`, [name || req.user.name, req.user.userId]);
  }
  res.json({ message: 'Profile updated' });
}
