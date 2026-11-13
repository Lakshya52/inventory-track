import { DbContext } from '../config/database';
import type { PoolConnection } from 'mysql2/promise';
import type { RowDataPacket } from 'mysql2';

/**
 * Human-readable dispatch order numbers, shown instead of the raw Mongo `_id`.
 * Format: `DO-<YYYY>-<6-digit sequence>` (e.g. DO-2026-000123).
 *
 * The counter lives in the `counters` collection, keyed per tenant + year, so
 * numbering is independent per company and per calendar year. The increment
 * happens inside the same transaction that creates the order.
 */

export function formatDispatchOrderNumber(year: number, seq: number): string {
  return `DO-${year}-${String(seq).padStart(6, '0')}`;
}

export function dispatchOrderCounterKey(tenantId: string | number, year: number): string {
  return `${tenantId}:dispatch_order:${year}`;
}

/** Atomically increments the tenant+year sequence and returns the new number. */
export async function nextDispatchOrderNumber(
  ctx: DbContext,
  tenantId: string | number
): Promise<string> {
  const year = new Date().getUTCFullYear();
  const counter = await ctx.findOneAndUpdate(
    'counters',
    { _id: dispatchOrderCounterKey(tenantId, year) } as any,
    [
      {
        $set: {
          seq: { $add: [{ $ifNull: ['$seq', 0] }, 1] },
          tenant_id: String(tenantId),
          year,
          updated_at: new Date().toISOString(),
        },
      },
    ],
    { returnDocument: 'after', upsert: true }
  );
  const seq = Number(counter?.seq ?? 1);
  return formatDispatchOrderNumber(year, seq);
}

/** MySQL path of nextDispatchOrderNumber, run inside the create-order transaction. */
export async function nextDispatchOrderNumberSql(
  conn: PoolConnection,
  tenantId: string | number
): Promise<string> {
  const year = new Date().getUTCFullYear();
  const counterKey = dispatchOrderCounterKey(tenantId, year);
  await conn.execute(
    `INSERT INTO counters (counter_key, seq) VALUES (?, 1)
     ON DUPLICATE KEY UPDATE seq = LAST_INSERT_ID(seq + 1)`,
    [counterKey],
  );
  const [rows] = await conn.query<RowDataPacket[]>(`SELECT LAST_INSERT_ID() AS seq`);
  const seq = Number(rows[0]?.seq ?? 1);
  return formatDispatchOrderNumber(year, seq);
}
