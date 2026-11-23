/**
 * Shared inventory response builder used by both Mongo and MySQL backends.
 *
 * Each input row is one pre-aggregated stock group (product + grade + package)
 * coming out of the database. Keeping the grouping/summary here means the API
 * ships a handful of compact rows instead of hundreds of thousands of raw
 * batches and full master collections.
 */
export type InventoryAggregate = {
  product_id?: string | number | null;
  grade_id?: string | number | null;
  product_name?: string | null;
  product_sku?: string | null;
  product_grade?: string | null;
  grade_name?: string | null;
  bag_quantity_id?: string | number | null;
  bag_quantity_name?: string | null;
  bag_quantity?: number | string | null;
  bag_quantity_unit?: string | null;
  package_quantity?: number | string | null;
  uom?: string | null;
  /** Sum of remaining quantity for this group. */
  remaining_quantity?: number | string | null;
  /** Distinct occupied storage position ids for this group. */
  location_keys?: string[];
};

export type PackageStock = {
  key: string;
  name: string;
  detail: string;
  count: number;
  countUnit: string;
  totalContent: number;
  contentUnit: string;
};

export type StockRow = {
  key: string;
  productKey: string;
  grade: string;
  product: string;
  sku: string;
  packages: PackageStock[];
};

export type InventorySummary = {
  stockByUom: Array<{ uom: string; quantity: number }>;
  productCount: number;
  gradeCount: number;
  occupiedPositions: number;
};

export type InventoryResponse = {
  rows: StockRow[];
  total: number;
  page: number;
  limit: number;
  pages: number;
  summary: InventorySummary;
};

function buildRows(aggregates: InventoryAggregate[]): StockRow[] {
  const grouped = new Map<string, StockRow>();
  for (const item of aggregates) {
    const quantity = Number(item.remaining_quantity ?? 0);
    if (!Number.isFinite(quantity) || quantity <= 0) continue;

    const product = item.product_name || "Unknown product";
    const grade =
      item.grade_name || item.product_grade || "Standard Grade";
    const productKey = String(
      item.product_id ?? (item.product_sku || product),
    );
    const key = JSON.stringify([productKey, grade]);
    let row = grouped.get(key);
    if (!row) {
      row = {
        key,
        productKey,
        grade,
        product,
        sku: item.product_sku || "—",
        packages: [],
      };
      grouped.set(key, row);
    }

    const packageSize = Number(
      item.package_quantity ?? item.bag_quantity ?? 0,
    );
    const hasPackageSize = Number.isFinite(packageSize) && packageSize > 0;
    const packageName = item.bag_quantity_name?.trim() || "";
    const hasPackaging = hasPackageSize || Boolean(packageName);
    const contentUnit = item.uom?.trim() || "units";
    const packageUnit =
      item.package_quantity != null
        ? contentUnit
        : item.bag_quantity_unit?.trim() || contentUnit;
    const packageSizeLabel = hasPackageSize
      ? `${packageSize.toLocaleString()} ${packageUnit}`
      : "";
    const packageLabel =
      packageName ||
      (hasPackageSize
        ? `${packageSizeLabel} pack`
        : "Packaging not recorded");
    const detail = hasPackageSize
      ? `${packageSizeLabel} per pack`
      : hasPackaging
        ? "Package size not recorded"
        : "Packaging not recorded";
    const countUnit = hasPackaging ? "packs" : contentUnit;
    const totalContentUnit = hasPackageSize
      ? packageUnit
      : hasPackaging
        ? "packs"
        : contentUnit;
    const packageKey = JSON.stringify([
      packageLabel,
      hasPackageSize ? packageSize : null,
      packageUnit.toLowerCase(),
      countUnit.toLowerCase(),
    ]);
    const stock = row.packages.find((entry) => entry.key === packageKey);
    if (stock) {
      stock.count += quantity;
      stock.totalContent += quantity * (hasPackageSize ? packageSize : 1);
    } else {
      row.packages.push({
        key: packageKey,
        name: packageLabel,
        detail,
        count: quantity,
        countUnit,
        totalContent: quantity * (hasPackageSize ? packageSize : 1),
        contentUnit: totalContentUnit,
      });
    }
  }
  return [...grouped.values()].sort(
    (a, b) =>
      a.grade.localeCompare(b.grade) || a.product.localeCompare(b.product),
  );
}

function buildSummary(
  rows: StockRow[],
  aggregates: InventoryAggregate[],
): InventorySummary {
  const quantitiesByUom = new Map<string, { uom: string; quantity: number }>();
  for (const row of rows) {
    for (const stock of row.packages) {
      const key = stock.contentUnit.toLowerCase();
      const existing = quantitiesByUom.get(key);
      quantitiesByUom.set(key, {
        uom: existing?.uom ?? stock.contentUnit,
        quantity: (existing?.quantity ?? 0) + stock.totalContent,
      });
    }
  }
  const locations = new Set<string>();
  for (const item of aggregates) {
    for (const key of item.location_keys || []) {
      if (key) locations.add(key);
    }
  }
  return {
    stockByUom: [...quantitiesByUom.values()],
    productCount: new Set(rows.map((row) => row.productKey)).size,
    gradeCount: rows.length,
    occupiedPositions: locations.size,
  };
}

// A short-lived cache keeps search/pagination from re-running the full stock
// aggregation on every keystroke. The UI's Refresh button bypasses it.
const aggregateCache = new Map<string, { at: number; data: unknown }>();
const CACHE_TTL_MS = 5_000;

export function getCached<T>(cacheKey: string): T | null {
  const entry = aggregateCache.get(cacheKey);
  if (entry && Date.now() - entry.at < CACHE_TTL_MS) return entry.data as T;
  return null;
}

export function setCached<T>(cacheKey: string, data: T): void {
  aggregateCache.set(cacheKey, { at: Date.now(), data });
  // Bound memory when many tenants/divisions are active.
  if (aggregateCache.size > 100) {
    const oldest = [...aggregateCache.entries()].sort((a, b) => a[1].at - b[1].at)[0];
    if (oldest) aggregateCache.delete(oldest[0]);
  }
}

export function buildInventoryResponse(
  aggregates: InventoryAggregate[],
  options: {
    q?: string;
    page?: number;
    limit?: number;
    occupiedPositions?: number;
  } = {},
): InventoryResponse {
  const rows = buildRows(aggregates);
  const summary = buildSummary(rows, aggregates);
  if (Number.isFinite(options.occupiedPositions)) {
    summary.occupiedPositions = Number(options.occupiedPositions);
  }
  const q = String(options.q || "").trim().toLowerCase();
  const filtered = q
    ? rows.filter(
        (row) =>
          [row.grade, row.product, row.sku].some((value) =>
            value.toLowerCase().includes(q),
          ) ||
          row.packages.some((stock) =>
            `${stock.name} ${stock.detail}`.toLowerCase().includes(q),
          ),
      )
    : rows;
  const page = Math.max(1, Number(options.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(options.limit) || 25));
  const total = filtered.length;
  const pages = Math.max(1, Math.ceil(total / limit));
  return {
    rows: filtered.slice((page - 1) * limit, page * limit),
    total,
    page,
    limit,
    pages,
    summary,
  };
}
