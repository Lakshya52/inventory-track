import { Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { query, withTransaction } from '../config/database.mysql';
import { RowDataPacket } from 'mysql2';
import { applyOperation } from '../services/syncService';
import { SyncOperationInput } from '../types';

function pageParams(req: Request, defaultLimit = 20): { page: number; limit: number; offset: number } {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || defaultLimit));
  return { page, limit, offset: (page - 1) * limit };
}

export async function submit(req: Request, res: Response): Promise<void> {
  const barcode_value = String(req.body.barcode_value || '').trim();
  const result = String(req.body.result || '').toUpperCase();
  const remarks = req.body.remarks;
  const files = (req.files as Express.Multer.File[]) || [];
  const bodyImages = Array.isArray(req.body.images) ? req.body.images : [];
  const images = files.length > 0 ? files.map((file) => file.filename) : bodyImages;

  if (!barcode_value || !result) {
    res.status(400).json({ error: 'Barcode value and result are required' });
    return;
  }
  if (!['PASS', 'FAIL'].includes(result)) {
    res.status(400).json({ error: 'Result must be PASS or FAIL' });
    return;
  }

  const operation: SyncOperationInput = {
    operation_id: req.body.client_operation_id || randomUUID(),
    type: 'QC_SUBMIT',
    client_timestamp: req.body.client_timestamp || new Date().toISOString(),
    payload: {
      barcode_value,
      result,
      remarks: remarks || null,
      images,
      expected_status: req.body.expected_status || undefined,
    },
  };

  const applied = await applyOperation(req.user!, null, operation);
  if (applied.status === 'APPLIED' || applied.status === 'DUPLICATE') {
    res.json({ ...(applied.data || {}), duplicate: applied.status === 'DUPLICATE' });
    return;
  }
  res.status(applied.status === 'CONFLICT' ? 409 : 400).json({
    error: applied.error || 'QC submission failed',
    code: applied.error_code,
    ...(applied.data || {}),
  });
}

export async function submitBulk(req: Request, res: Response): Promise<void> {
  let barcodes: string[] = [];
  if (Array.isArray(req.body.barcodes)) {
    barcodes = req.body.barcodes.map((value: any) => String(value || '').trim()).filter(Boolean);
  } else if (typeof req.body.barcodes === 'string') {
    try {
      const parsed = JSON.parse(req.body.barcodes);
      if (Array.isArray(parsed)) {
        barcodes = parsed.map((value: any) => String(value || '').trim()).filter(Boolean);
      }

    } catch {
      barcodes = [];
    }
  } else if (typeof req.body.barcode_value === 'string') {
    barcodes = [req.body.barcode_value.trim()];
  }
  barcodes = [...new Set(barcodes)];

  const result = String(req.body.result || '').toUpperCase();
  const remarks = req.body.remarks;
  const files = (req.files as Express.Multer.File[]) || [];
  const bodyImages = Array.isArray(req.body.images) ? req.body.images : [];
  const images = files.length > 0 ? files.map((file) => file.filename) : bodyImages;

  if (barcodes.length === 0 || !result) {
    res.status(400).json({ error: 'At least one QR code and a result are required' });
    return;
  }
  if (!['PASS', 'FAIL'].includes(result)) {
    res.status(400).json({ error: 'Result must be PASS or FAIL' });
    return;
  }

  const operation: SyncOperationInput = {
    operation_id: req.body.client_operation_id || randomUUID(),
    type: 'QC_SUBMIT_BULK',
    client_timestamp: req.body.client_timestamp || new Date().toISOString(),
    payload: {
      barcodes,
      result,
      remarks: remarks || null,
      images,
    },
  };

  const applied = await applyOperation(req.user!, null, operation);
  if (applied.status === 'APPLIED' || applied.status === 'DUPLICATE') {
    res.json({ ...(applied.data || {}), duplicate: applied.status === 'DUPLICATE' });
    return;
  }
  res.status(applied.status === 'CONFLICT' ? 409 : 400).json({
    error: applied.error || 'Group QC submission failed',
    code: applied.error_code,
    ...(applied.data || {}),
  });
}

export async function reopenFailedBatch(req: Request, res: Response): Promise<void> {
  const reason = String(req.body.reason || '').trim();
  if (!reason) {
    res.status(400).json({ error: 'A reason is required to send a failed batch back for QC' });
    return;
  }
  const result = await withTransaction(async (conn) => {
    const [rows] = await conn.execute<RowDataPacket[]>(
      'SELECT id, batch_number, status FROM batches WHERE id = ? FOR UPDATE',
      [req.params.id]
    );
    if (rows.length === 0) return { error: 'Batch not found', statusCode: 404 } as const;
    if (rows[0].status !== 'QC_FAILED') {
      return { error: 'Only QC-failed batches can be sent back for re-QC', statusCode: 409 } as const;
    }
    await conn.execute(
      `UPDATE batches SET status = 'CREATED', updated_at = CURRENT_TIMESTAMP(3)
       WHERE id = ? AND status = 'QC_FAILED'`,
      [req.params.id]
    );
    await conn.execute(
      `INSERT INTO activity_logs (user_id, user_name, user_role, action, description)
       VALUES (?, ?, ?, 'BATCH_SENT_FOR_REQC', ?)`,
      [req.user!.userId, req.user!.name, req.user!.role, `Batch ${rows[0].batch_number} sent back for QC: ${reason.slice(0, 1000)}`]
    );
    return { batch_id: Number(rows[0].id), status: 'CREATED' } as const;
  });
  if ('error' in result) {
    res.status(result.statusCode ?? 500).json({ error: result.error });
    return;
  }
  res.json(result);
}

export async function decideBatchGroup(req: Request, res: Response): Promise<void> {
  const groupId = String(req.params.id || '').trim();
  const result = String(req.body?.result || '').toUpperCase();
  const remarks = typeof req.body?.remarks === 'string' ? req.body.remarks.trim().slice(0, 1000) : '';
  if (!groupId) {
    res.status(400).json({ error: 'Batch ID is required' });
    return;
  }
  if (!['PASS', 'FAIL'].includes(result)) {
    res.status(400).json({ error: 'QC result must be PASS or FAIL' });
    return;
  }

  try {
    const outcome = await withTransaction(async (conn): Promise<
      | { error: string; statusCode: number }
      | {
          group_id: string;
          batch_number: string;
          status: string;
          result: string;
          unit_count: number;
          product_count: number;
          remarks: string | null;
        }
    > => {
      const [groupRows] = await conn.execute<RowDataPacket[]>(
        'SELECT group_key, batch_number, status FROM batch_groups WHERE group_key = ? FOR UPDATE',
        [groupId]
      );
      const group = groupRows[0];
      if (!group) return { error: 'Batch not found', statusCode: 404 } as const;
      const currentStatus = String(group.status || '').toUpperCase();
      if (currentStatus !== 'PENDING_QC') {
        return {
          error: `This batch has already been reviewed (${currentStatus.replace(/_/g, ' ')}). Only batches waiting for QC can be marked.`,
          statusCode: 409,
        } as const;
      }

      const [children] = await conn.execute<RowDataPacket[]>(
        'SELECT id, product_id, quantity FROM batches WHERE batch_group_id = ? FOR UPDATE',
        [groupId]
      );
      if (children.length === 0) {
        return { error: 'This batch has no units to review', statusCode: 409 } as const;
      }

      const status = result === 'PASS' ? 'QC_PASSED' : 'QC_FAILED';
      await conn.execute('UPDATE batch_groups SET status = ? WHERE group_key = ?', [status, groupId]);
      await conn.execute('UPDATE batches SET status = ? WHERE batch_group_id = ?', [status, groupId]);

      for (const child of children) {
        await conn.execute(
          `INSERT INTO qc_records (batch_id, tester_id, result, method, remarks)
           VALUES (?, ?, ?, 'MANUAL_REVIEW', ?)`,
          [
            child.id,
            req.user!.userId,
            result,
            remarks || `Marked ${result} during QC review of ${group.batch_number}`,
          ]
        );
      }

      const productIds = new Set<number>(children.map((child) => Number(child.product_id)));
      if (result === 'PASS') {
        const quantityByProduct = new Map<number, number>();
        for (const child of children) {
          const productId = Number(child.product_id);
          quantityByProduct.set(productId, (quantityByProduct.get(productId) || 0) + Number(child.quantity || 0));
        }
        for (const [productId, quantity] of quantityByProduct) {
          if (quantity > 0) {
            await conn.execute('UPDATE products SET quantity = COALESCE(quantity, 0) + ? WHERE id = ?', [quantity, productId]);
          }
        }
      }

      await conn.execute(
        `INSERT INTO activity_logs (user_id, user_name, user_role, action, description)
         VALUES (?, ?, ?, ?, ?)`,
        [
          req.user!.userId,
          req.user!.name,
          req.user!.role,
          result === 'PASS' ? 'BATCH_QC_PASSED' : 'BATCH_QC_FAILED',
          `Batch ${group.batch_number} marked ${result} by QC review (${children.length} unit${children.length === 1 ? '' : 's'})${remarks ? `: ${remarks}` : ''}`,
        ]
      );

      return {
        group_id: groupId,
        batch_number: String(group.batch_number),
        status,
        result,
        unit_count: children.length,
        product_count: productIds.size,
        remarks: remarks || null,
      } as const;
    });

    if ('error' in outcome) {
      res.status(outcome.statusCode ?? 500).json({ error: outcome.error });
      return;
    }
    res.json({
      ...outcome,
      message: `Batch ${outcome.batch_number} marked ${result}.${result === 'PASS' ? ' Stock is now available for Dispatch.' : ' Stock was not added.'}`,
    });
  } catch (error: any) {
    res.status(error?.statusCode || 500).json({ error: error?.message || 'Could not save the QC decision' });
  }
}

/**
 * Marks several waiting batches as PASS in one call.
 *
 * Each batch group is still decided on its own: a group that is no longer
 * waiting is reported as skipped instead of failing the whole request, so a
 * stale selection can never overwrite a decision somebody else already made.
 */
export async function decideBatchGroupsBulk(req: Request, res: Response): Promise<void> {
  const rawIds: unknown[] = Array.isArray(req.body?.group_ids) ? req.body.group_ids : [];
  const groupIds: string[] = [...new Set(rawIds.map((value) => String(value).trim()).filter(Boolean))].slice(0, 100);
  const remarks = typeof req.body?.remarks === 'string' ? req.body.remarks.trim().slice(0, 1000) : '';
  if (groupIds.length === 0) {
    res.status(400).json({ error: 'Select at least one batch to pass' });
    return;
  }

  const passed: string[] = [];
  const skipped: Array<{ group_id: string; reason: string }> = [];

  for (const groupId of groupIds) {
    try {
      const outcome = await withTransaction(async (conn) => {
        const [groupRows] = await conn.execute<RowDataPacket[]>(
          'SELECT group_key, batch_number, status FROM batch_groups WHERE group_key = ? FOR UPDATE',
          [groupId]
        );
        const group = groupRows[0] as Record<string, any> | undefined;
        if (!group) return { error: 'Batch not found' } as const;
        const groupStatus = String(group.status || '').toUpperCase();
        if (groupStatus !== 'PENDING_QC') {
          return { error: `already ${groupStatus.replace(/_/g, ' ').toLowerCase()}` } as const;
        }

        const [children] = await conn.execute<RowDataPacket[]>(
          'SELECT id, product_id, quantity FROM batches WHERE batch_group_id = ? FOR UPDATE',
          [groupId]
        );
        if (children.length === 0) return { error: 'batch has no units to review' } as const;

        await conn.execute("UPDATE batch_groups SET status = 'QC_PASSED' WHERE group_key = ?", [groupId]);
        await conn.execute("UPDATE batches SET status = 'QC_PASSED' WHERE batch_group_id = ?", [groupId]);

        for (const child of children) {
          await conn.execute(
            `INSERT INTO qc_records (batch_id, tester_id, result, method, remarks)
             VALUES (?, ?, 'PASS', 'MANUAL_REVIEW', ?)`,
            [child.id, req.user!.userId, remarks || `Marked PASS during bulk QC review of ${group.batch_number}`]
          );
        }

        const quantityByProduct = new Map<number, number>();
        for (const child of children) {
          const productId = Number(child.product_id);
          quantityByProduct.set(productId, (quantityByProduct.get(productId) || 0) + Number(child.quantity || 0));
        }
        for (const [productId, quantity] of quantityByProduct) {
          if (quantity > 0) {
            await conn.execute('UPDATE products SET quantity = COALESCE(quantity, 0) + ? WHERE id = ?', [quantity, productId]);
          }
        }

        await conn.execute(
          `INSERT INTO activity_logs (user_id, user_name, user_role, action, description)
           VALUES (?, ?, ?, 'BATCH_QC_PASSED', ?)`,
          [
            req.user!.userId,
            req.user!.name,
            req.user!.role,
            `Batch ${group.batch_number} marked PASS in a bulk QC review (${children.length} unit${children.length === 1 ? '' : 's'})${remarks ? `: ${remarks}` : ''}`,
          ]
        );

        return { ok: true } as const;
      });

      if ('error' in outcome) {
        skipped.push({ group_id: groupId, reason: String(outcome.error) });
        continue;
      }
      passed.push(groupId);
    } catch (error: any) {
      skipped.push({ group_id: groupId, reason: error?.message || 'could not be passed' });
    }
  }

  res.json({
    passed_count: passed.length,
    skipped_count: skipped.length,
    passed_group_ids: passed,
    skipped,
    message: `${passed.length} batch${passed.length === 1 ? '' : 'es'} passed${skipped.length ? `, ${skipped.length} skipped` : ''}.`,
  });
}

export async function stats(req: Request, res: Response): Promise<void> {
  const user = req.user!;
  const personal = user.role === 'QC';
  const scope = personal ? 'AND tester_id = ?' : '';
  const params = personal ? [user.userId] : [];

  const count = async (sql: string, extraParams: any[] = []): Promise<number> => {
    const rows = await query<RowDataPacket[]>(sql, [...params, ...extraParams]);
    return Number(rows[0]?.count || 0);
  };

  const totalTests = await count(`SELECT COUNT(*) AS count FROM qc_records WHERE 1=1 ${scope}`);
  const testsToday = await count(
    `SELECT COUNT(*) AS count FROM qc_records WHERE created_at >= CURDATE() ${scope}`
  );
  const testsThisWeek = await count(
    `SELECT COUNT(*) AS count FROM qc_records
     WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL WEEKDAY(CURDATE()) DAY) ${scope}`
  );
  const passed = await count(`SELECT COUNT(*) AS count FROM qc_records WHERE result = 'PASS' ${scope}`);
  const failed = await count(`SELECT COUNT(*) AS count FROM qc_records WHERE result = 'FAIL' ${scope}`);

  const pendingRows = await query<RowDataPacket[]>(
    `SELECT b.id, b.batch_number, b.barcode_value, b.quantity, b.uom, b.storage_location,
            (SELECT COUNT(*) FROM qr_labels l WHERE l.batch_id = b.id) AS qr_count,
            b.created_at, p.name AS product_name, p.sku AS product_sku, p.cas_number,
            p.grade AS product_grade, p.purity AS product_purity,
            TIMESTAMPDIFF(MINUTE, b.created_at, NOW()) AS age_minutes
     FROM batches b JOIN products p ON b.product_id = p.id
     WHERE b.status = 'PENDING_QC'
     ORDER BY b.created_at ASC LIMIT 50`
  );
  const pendingQcRows = await query<RowDataPacket[]>(
    `SELECT COUNT(*) AS count FROM batches WHERE status = 'PENDING_QC'`
  );

  const recordWhere = personal ? 'WHERE q.tester_id = ?' : '';
  const recordParams = personal ? [user.userId] : [];
  const recentRecords = await query<RowDataPacket[]>(
    `SELECT q.*, b.batch_number, b.barcode_value, p.name AS product_name, p.sku AS product_sku,
            u.name AS tester_name
     FROM qc_records q
     JOIN batches b ON q.batch_id = b.id
     JOIN products p ON b.product_id = p.id
     LEFT JOIN qc_users u ON q.tester_id = u.id
     ${recordWhere}
     ORDER BY q.created_at DESC LIMIT 20`,
    recordParams
  );
  const todayRecords = await query<RowDataPacket[]>(
    `SELECT q.*, b.batch_number, b.barcode_value, p.name AS product_name,
            u.name AS tester_name
     FROM qc_records q
     JOIN batches b ON q.batch_id = b.id
     JOIN products p ON b.product_id = p.id
     LEFT JOIN qc_users u ON q.tester_id = u.id
     WHERE q.created_at >= CURDATE() ${personal ? 'AND q.tester_id = ?' : ''}
     ORDER BY q.created_at DESC`,
    recordParams
  );
  const trend = await query<RowDataPacket[]>(
    `SELECT DATE(created_at) AS day,
            SUM(result = 'PASS') AS passed,
            SUM(result = 'FAIL') AS failed,
            COUNT(*) AS total
     FROM qc_records
     WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL 6 DAY) ${scope}
     GROUP BY DATE(created_at)
     ORDER BY day ASC`,
    params
  );

  // Per-QC-person performance: how many batches each QC user reviewed,
  // how many passed, and how many are still waiting for them.
  const perUserRows = await query<RowDataPacket[]>(
    `SELECT q.tester_id, u.name,
            COUNT(*) AS total,
            SUM(q.result = 'PASS') AS passed,
            SUM(q.result = 'FAIL') AS failed,
            SUM(q.created_at >= CURDATE()) AS today_count
     FROM qc_records q
     LEFT JOIN qc_users u ON u.id = q.tester_id
     GROUP BY q.tester_id, u.name
     ORDER BY total DESC`
  );
  const perUser = perUserRows.map((row: any) => {
    const total = Number(row.total || 0);
    const passed = Number(row.passed || 0);
    return {
      user_id: String(row.tester_id ?? ''),
      name: row.name || 'QC user',
      total,
      passed,
      failed: Number(row.failed || 0),
      today: Number(row.today_count || 0),
      pass_rate: total > 0 ? Math.round((passed / total) * 100) : 0,
    };
  });

  res.json({
    scope: personal ? 'mine' : 'all',
    totalTests,
    testsToday,
    testsThisWeek,
    passed,
    failed,
    pendingQc: Number(pendingQcRows[0]?.count || 0),
    passRate: totalTests > 0 ? Math.round((passed / totalTests) * 100) : 0,
    myTestsToday: testsToday,
    myTestsThisWeek: testsThisWeek,
    myTotalTests: totalTests,
    myPassed: passed,
    myFailed: failed,
    myPassRate: totalTests > 0 ? Math.round((passed / totalTests) * 100) : 0,
    pendingBatches: pendingRows,
    recentRecords,
    todayRecords,
    perUser,
    trend,
  });
}

export async function pending(req: Request, res: Response): Promise<void> {
  const { page, limit, offset } = pageParams(req, 20);
  const q = String(req.query.q || '').trim();
  const where = ["b.status = 'PENDING_QC'"];
  const params: any[] = [];
  if (q) {
    where.push('(b.batch_number LIKE ? OR b.barcode_value LIKE ? OR p.name LIKE ? OR p.sku LIKE ?)');
    const like = `%${q}%`;
    params.push(like, like, like, like);
  }
  const whereSql = `WHERE ${where.join(' AND ')}`;

  const totalRows = await query<RowDataPacket[]>(
    `SELECT COUNT(*) AS count FROM batches b JOIN products p ON b.product_id = p.id ${whereSql}`,
    params
  );
  const items = await query<RowDataPacket[]>(
    `SELECT b.id, b.batch_number, b.barcode_value, b.quantity, b.uom, b.storage_location,
            (SELECT COUNT(*) FROM qr_labels l WHERE l.batch_id = b.id) AS qr_count,
            b.created_at, b.batch_group_id, p.name AS product_name, p.sku AS product_sku, p.cas_number,
            p.grade AS product_grade, p.purity AS product_purity,
            TIMESTAMPDIFF(MINUTE, b.created_at, NOW()) AS age_minutes
     FROM batches b JOIN products p ON b.product_id = p.id
     ${whereSql}
     ORDER BY b.created_at ASC
     LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  // Show who raised each batch so QC knows who to ask about it. The creator is
  // recorded on the batch group, not on each unit batch.
  const groupKeys = [...new Set(items.map((row: any) => String(row.batch_group_id ?? '')).filter(Boolean))];
  const groupRows = groupKeys.length
    ? await query<RowDataPacket[]>(
        `SELECT group_key, created_by FROM batch_groups WHERE group_key IN (${groupKeys.map(() => '?').join(',')})`,
        groupKeys,
      )
    : [];
  const creatorIds = [...new Set(groupRows.map((row: any) => String(row.created_by ?? '')).filter(Boolean))];
  const creatorRows = creatorIds.length
    ? await query<RowDataPacket[]>(
        `SELECT id, name FROM dispatch_users WHERE id IN (${creatorIds.map(() => '?').join(',')})`,
        creatorIds,
      )
    : [];
  const creatorNames = new Map(creatorRows.map((row: any) => [String(row.id), row.name]));
  const creatorByGroup = new Map(groupRows.map((row: any) => [String(row.group_key), creatorNames.get(String(row.created_by ?? '')) ?? null]));
  for (const row of items) {
    (row as any).created_by_name = creatorByGroup.get(String(row.batch_group_id ?? '')) ?? null;
  }
  const total = Number(totalRows[0]?.count || 0);
  res.json({ items, total, page, limit, pages: Math.ceil(total / limit) });
}

export async function records(req: Request, res: Response): Promise<void> {
  const user = req.user!;
  const { page, limit, offset } = pageParams(req, 20);
  const requestedScope = String(req.query.scope || (user.role === 'QC' ? 'mine' : 'all'));
  const scope = user.role === 'QC' ? 'mine' : requestedScope;
  const result = String(req.query.result || '').toUpperCase();
  const q = String(req.query.q || '').trim();

  const where: string[] = [];
  const params: any[] = [];
  if (scope === 'mine') {
    where.push('q.tester_id = ?');
    params.push(user.userId);
  }
  if (result === 'PASS' || result === 'FAIL') {
    where.push('q.result = ?');
    params.push(result);
  }
  if (q) {
    where.push('(b.batch_number LIKE ? OR b.barcode_value LIKE ? OR p.name LIKE ? OR p.sku LIKE ? OR q.remarks LIKE ?)');
    const like = `%${q}%`;
    params.push(like, like, like, like, like);
  }
  const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

  const totalRows = await query<RowDataPacket[]>(
    `SELECT COUNT(*) AS count
     FROM qc_records q
     JOIN batches b ON q.batch_id = b.id
     JOIN products p ON b.product_id = p.id
     ${whereSql}`,
    params
  );
  const items = await query<RowDataPacket[]>(
    `SELECT q.*, b.batch_number, b.barcode_value, p.name AS product_name, p.sku AS product_sku,
            u.name AS tester_name
     FROM qc_records q
     JOIN batches b ON q.batch_id = b.id
     JOIN products p ON b.product_id = p.id
     LEFT JOIN qc_users u ON q.tester_id = u.id
     ${whereSql}
     ORDER BY q.created_at DESC
     LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  const total = Number(totalRows[0]?.count || 0);
  res.json({ items, total, page, limit, pages: Math.ceil(total / limit), scope });
}
