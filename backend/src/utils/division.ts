import { Request } from 'express';

/**
 * Division visibility rules.
 *
 * A tenant (organization) can run several divisions (plants / manufacturing
 * units) that share tenant-level directory data (clients, vendors, UOMs, bag
 * quantities) but keep their operational data — products, grades, batches, QR
 * labels, QC, dispatch, loading sessions, warehouses, racks and shelf
 * locations, plus their activity logs — separated from each other.
 *
 * How visibility is resolved per request:
 * - Any requester with a division assigned/selected sees rows of that division,
 *   plus shared ("tenant-wide", division_id NULL) rows. That covers QC / DISPATCH
 *   members with a fixed division, and the single ADMIN when they have one
 *   picked in the top-right switcher.
 * - An unassigned non-admin user sees everything in the tenant (pre-divisions behavior).
 * - The ADMIN with the switcher on "All divisions" (or no selection) sees everything
 *   and their created rows are shared — 'all' or absent stamps NULL.
 *
 * Inbound rows are stamped with the effective division: own division for
 * assigned users, the admin's selected division, or NULL (shared) otherwise.
 */

export const DIVISION_SCOPED_TABLES = [
  'products',
  'grades',
  'batches',
  'batch_groups',
  'qc_records',
  'dispatch_records',
  'dispatch_orders',
  'fix_records',
  'packing_list_items',
  'qr_labels',
  'qr_print_jobs',
  'warehouses',
  'storage_racks',
  'shelf_locations',
  'loading_sessions',
  'loading_scan_events',
  'activity_logs',
] as const;

/**
 * True when this request's READS are restricted to one division. Anyone with
 * a division set on the request is restricted — QC / DISPATCH members by their
 * assigned division, the single ADMIN by the division selected in the top-right
 * switcher ('all' or absent selection = unrestricted, tenant-wide).
 */
export function hasDivisionScope(req: Request): boolean {
  return req.user?.divisionId !== undefined && req.user?.divisionId !== null;
}

/**
 * SQL fragment that AND-appends division visibility, e.g.
 * ` AND (division_id = ? OR division_id IS NULL)`, plus its bind parameter.
 * Returns an empty fragment when the requester is not division-restricted.
 */
export function divisionWhere(req: Request, column = 'division_id'): { sql: string; params: any[] } {
  if (!hasDivisionScope(req)) return { sql: '', params: [] };
  return { sql: ` AND (${column} = ? OR ${column} IS NULL)`, params: [req.user!.divisionId!] };
}

/**
 * Mongo filter that composes with any existing filter (single `$in` key, so it
 * never collides with an `$or` already present in the filter object).
 */
export function divisionFilter(req: Request, field = 'division_id'): Record<string, any> {
  if (!hasDivisionScope(req)) return {};
  return { [field]: { $in: [req.user!.divisionId!, null] } };
}

/** division_id to stamp on newly created rows (null = shared / tenant-wide). */
export function divisionStamp(req: Request): string | number | null {
  return req.user?.divisionId ?? null;
}
