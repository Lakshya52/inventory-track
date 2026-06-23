import { Request, Response } from 'express';
import { query } from '../config/database';
import { RowDataPacket } from 'mysql2';

export async function list(req: Request, res: Response): Promise<void> {
  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 50;
  const offset = (page - 1) * limit;
  const logs = await query<RowDataPacket[]>(
    `SELECT * FROM activity_logs ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    [limit, offset]
  );
  const countResult = await query<RowDataPacket[]>('SELECT COUNT(*) as count FROM activity_logs');
  res.json({ logs, total: countResult[0].count, page, limit });
}
