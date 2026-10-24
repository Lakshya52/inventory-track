import { DbContext } from '../config/database';

/** Escape user-provided text before using it inside a MongoDB regular expression. */
export function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Case-insensitive "contains" matcher used by every search endpoint. */
export function contains(value: string): RegExp {
  return new RegExp(escapeRegex(value.trim()), 'i');
}

/** Case-insensitive exact matcher, matching the MySQL utf8mb4_unicode_ci collation. */
export function equalsIgnoreCase(value: string): RegExp {
  return new RegExp(`^${escapeRegex(value.trim())}$`, 'i');
}

export function toNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function toNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function mapByIds<T extends Record<string, any> = Record<string, any>>(
  ctx: DbContext,
  collection: string,
  ids: Array<number | null | undefined>
): Promise<Map<number, T>> {
  const unique = [...new Set(
    ids
      .filter((id): id is number => id !== null && id !== undefined && Number.isFinite(Number(id)))
      .map((id) => Number(id))
  )];
  if (unique.length === 0) return new Map();
  const documents = await ctx.find<T & { id: number }>(collection, { id: { $in: unique } } as any, { projection: { _id: 0 } });
  return new Map(documents.map((document) => [Number(document.id), document as T]));
}

export async function mapNames(
  ctx: DbContext,
  collection: string,
  ids: Array<number | null | undefined>
): Promise<Map<number, string>> {
  const documents = await mapByIds<{ id: number; name: string }>(ctx, collection, ids);
  return new Map([...documents.entries()].map(([id, document]) => [id, document.name]));
}

/**
 * Finds batch IDs whose number, barcode, or product name/SKU match a search
 * term. Used by list screens that previously relied on SQL JOIN searches.
 */
export async function batchIdsForSearch(
  ctx: DbContext,
  term: string,
  extraFilter: Record<string, any> = {}
): Promise<number[]> {
  if (!term) return [];
  const pattern = contains(term);
  const products = await ctx.find('products', {
    $or: [{ name: pattern }, { sku: pattern }],
  }, { projection: { id: 1 } });
  const productIds = products.map((product) => Number(product.id));
  const batches = await ctx.find('batches', {
    ...extraFilter,
    $or: [
      { batch_number: pattern },
      { barcode_value: pattern },
      { product_id: { $in: productIds } },
    ],
  }, { projection: { id: 1 } });
  return batches.map((batch) => Number(batch.id));
}

export function mergeDefined(...values: Array<Record<string, any> | null | undefined>): Record<string, any> {
  const result: Record<string, any> = {};
  for (const value of values) {
    if (!value) continue;
    for (const [key, entry] of Object.entries(value)) {
      if (entry !== undefined) result[key] = entry;
    }
  }
  return result;
}

export function pagination(page: number, limit: number, offset: number): { page: number; limit: number; offset: number } {
  return { page, limit, offset };
}

/** Per-batch label count and the print job that produced the labels. */
export async function batchQrStats(
  ctx: DbContext,
  batchIds: Array<number | null | undefined>
): Promise<Map<number, { count: number; jobId: number | null }>> {
  const unique = [...new Set(
    batchIds
      .filter((id): id is number => id !== null && id !== undefined)
      .map((id) => Number(id))
  )];
  if (unique.length === 0) return new Map();
  const rows = await ctx.aggregate('qr_labels', [
    { $match: { batch_id: { $in: unique } } },
    {
      $group: {
        _id: '$batch_id',
        count: { $sum: 1 },
        jobId: { $min: '$print_job_id' },
      },
    },
  ]);
  return new Map(rows.map((row) => [
    Number(row._id),
    { count: Number(row.count || 0), jobId: row.jobId === null || row.jobId === undefined ? null : Number(row.jobId) },
  ]));
}

/** All unit QR values keyed by batch ID (used by the offline pull endpoint). */
export async function batchQrValues(
  ctx: DbContext,
  batchIds: Array<number | null | undefined>
): Promise<Map<number, string[]>> {
  const unique = [...new Set(
    batchIds
      .filter((id): id is number => id !== null && id !== undefined)
      .map((id) => Number(id))
  )];
  if (unique.length === 0) return new Map();
  const labels = await ctx.find('qr_labels', { batch_id: { $in: unique } }, {
    sort: { serial_no: 1 },
    projection: { _id: 0, batch_id: 1, qr_value: 1 },
  });
  const result = new Map<number, string[]>();
  for (const label of labels) {
    const batchId = Number(label.batch_id);
    const values = result.get(batchId) || [];
    values.push(String(label.qr_value));
    result.set(batchId, values);
  }
  return result;
}

export function batchAgeMinutes(value: unknown): number {
  if (!value) return 0;
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) return 0;
  return Math.max(0, Math.floor((Date.now() - date.getTime()) / 60_000));
}
