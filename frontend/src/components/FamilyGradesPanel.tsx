import { useCallback, useEffect, useState } from 'react';
import { Search, Trash2, Pencil, Loader2, X } from 'lucide-react';
import { api } from '../services/api';
import { EntityId, Product } from '../types';
import { useDebouncedValue } from '../hooks/useDebouncedValue';

const GRADE_PAGE_SIZE = 100;
export const FAMILY_PANEL_MAX_HEIGHT = '26rem';

type Props = {
  familyName: string;
  /** Increment from the parent to force a fresh page-1 reload. */
  refreshKey: number;
  canManage: boolean;
  formatUom: (id: EntityId | null | undefined) => string;
  onEdit: (product: Product) => void;
  onDelete: (product: Product) => void;
};

export default function FamilyGradesPanel({
  familyName,
  refreshKey,
  canManage,
  formatUom,
  onEdit,
  onDelete,
}: Props) {
  const [query, setQuery] = useState('');
  const debouncedQuery = useDebouncedValue(query, 300);
  const [products, setProducts] = useState<Product[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(
    async (pageToLoad: number, q: string, append: boolean) => {
      setLoading(true);
      setError('');
      try {
        const result = await api.products.familyProducts(familyName, pageToLoad, GRADE_PAGE_SIZE, q);
        setProducts((current) => (append ? [...current, ...result.products] : result.products));
        setTotal(Number(result.total || 0));
        setPage(Number(result.page || pageToLoad));
        setTotalPages(Number(result.totalPages || 1));
      } catch (err: any) {
        setError(err.message || 'Could not load grades');
      } finally {
        setLoading(false);
      }
    },
    [familyName]
  );

  // Initial load + any change in the (server-side) query
  useEffect(() => {
    void load(1, debouncedQuery, false);
  }, [debouncedQuery, load]);

  // Parent bumped the refresh key (create/update/delete happened) — reload page 1
  useEffect(() => {
    if (refreshKey > 0) void load(1, debouncedQuery, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  return (
    <div className="flex flex-col border-t border-slate-100 bg-white">
      {/* Per-family search toolbar */}
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 bg-slate-50/70 px-4 py-2.5">
        <div className="relative min-w-[220px] flex-1">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search grade or SKU in this product…"
            className="w-full rounded-lg border border-slate-200 bg-white py-1.5 pl-9 pr-8 text-sm font-medium text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-500"
            aria-label={`Search grades in ${familyName}`}
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-slate-400 hover:text-slate-700"
              aria-label="Clear search"
            >
              <X size={15} />
            </button>
          )}
        </div>
        <span className="text-[11px] font-semibold text-slate-500">
          {total.toLocaleString()} match{total === 1 ? '' : 'es'}
        </span>
      </div>

      {/* Scrollable table area */}
      <div className="overflow-auto" style={{ maxHeight: FAMILY_PANEL_MAX_HEIGHT }}>
        <table className="w-full text-left text-sm">
          <thead className="sticky top-0 z-10 border-b-2 border-slate-200 bg-slate-50 text-xs font-bold uppercase tracking-wider text-slate-600">
            <tr>
              <th className="px-5 py-3">Grade</th>
              <th className="px-5 py-3">SKU</th>
              <th className="px-5 py-3">UOM</th>
              <th className="px-5 py-3">Manufacturer</th>
              {canManage && <th className="px-5 py-3 text-right">Actions</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading && products.length === 0 ? (
              <tr>
                <td colSpan={canManage ? 5 : 4} className="px-5 py-10 text-center text-sm font-semibold text-slate-500">
                  <Loader2 size={18} className="mx-auto mb-2 animate-spin text-slate-400" />
                  Loading grades…
                </td>
              </tr>
            ) : error ? (
              <tr>
                <td colSpan={canManage ? 5 : 4} className="px-5 py-10 text-center text-sm font-semibold text-rose-700">
                  {error}
                </td>
              </tr>
            ) : products.length === 0 ? (
              <tr>
                <td colSpan={canManage ? 5 : 4} className="px-5 py-10 text-center text-sm font-semibold text-slate-500">
                  No grades match “{query.trim()}”.
                </td>
              </tr>
            ) : (
              products.map((product) => (
                <tr key={product.id} className="transition-colors hover:bg-slate-50/80">
                  <td className="px-5 py-3">
                    <span className="text-base font-bold text-slate-900">
                      {product.grade || 'Standard'}
                    </span>
                  </td>
                  <td className="px-5 py-3">
                    <span className="rounded border border-slate-200 bg-slate-100 px-2 py-1 font-mono text-xs font-bold text-slate-800">
                      {product.sku}
                    </span>
                  </td>
                  <td className="px-5 py-3">
                    <span className="inline-block rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-xs font-bold text-emerald-700">
                      {formatUom(product.bag_quantity_id)}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-sm font-medium text-slate-700">
                    {product.manufacturer || 'SELF (KLJ)'}
                  </td>
                  {canManage && (
                    <td className="px-5 py-3 text-right">
                      <button type="button" onClick={() => onEdit(product)} className="mr-2 p-2 text-slate-500 hover:text-slate-800" aria-label="Edit grade">
                        <Pencil size={16} />
                      </button>
                      <button type="button" onClick={() => onDelete(product)} className="p-2 text-slate-500 hover:text-rose-600" aria-label="Delete grade">
                        <Trash2 size={16} />
                      </button>
                    </td>
                  )}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination footer */}
      <div className="flex items-center justify-between gap-4 border-t border-slate-100 bg-slate-50 px-5 py-3">
        <p className="text-xs font-semibold text-slate-500">
          Showing {products.length.toLocaleString()} of {total.toLocaleString()} grade{total === 1 ? '' : 's'}
        </p>
        {page < totalPages && (
          <button
            type="button"
            onClick={() => void load(page + 1, debouncedQuery, true)}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-bold text-slate-700 transition-colors hover:bg-slate-100 disabled:opacity-60"
          >
            {loading ? 'Loading…' : `Load ${Math.min(GRADE_PAGE_SIZE, Math.max(0, total - products.length))} more`}
          </button>
        )}
      </div>
    </div>
  );
}
