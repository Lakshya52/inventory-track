import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../services/api';
import type { EntityId } from '../types';
import {
  Check, FlaskConical, PackageCheck, Pencil, Plus, RefreshCw,
  Search, Save, Trash2, X,
} from 'lucide-react';

type MasterKind = 'grades' | 'bag-quantities';
type StatusFilter = 'all' | 'active' | 'inactive';
type MasterItem = {
  id: EntityId;
  name: string;
  quantity?: number;
  unit?: string;
  is_active?: number | boolean | string | null;
};

function isActive(item: MasterItem): boolean {
  return item.is_active === true || Number(item.is_active) === 1;
}

const UNIT_SUGGESTIONS = [
  'mg', 'g', 'kg', 'tonne', 'mL', 'L', 'cm3', 'm3', 'pcs', 'units',
  'bags', 'boxes', 'bottles', 'drums', 'rolls', 'sets',
];

export default function Masters() {
  const [kind, setKind] = useState<MasterKind>('grades');
  const [items, setItems] = useState<MasterItem[]>([]);
  const [name, setName] = useState('');
  const [quantity, setQuantity] = useState('');
  const [unit, setUnit] = useState('');
  const [editId, setEditId] = useState<EntityId | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const requestSequence = useRef(0);

  const load = useCallback(async (selectedKind: MasterKind = kind) => {
    const requestId = ++requestSequence.current;
    setLoading(true);
    setError('');
    try {
      const rows = await api.masters.list(selectedKind);
      if (requestId === requestSequence.current) setItems(rows);
    } catch (err: any) {
      if (requestId === requestSequence.current) {
        setItems([]);
        setError(err.message || 'Could not load master values');
      }
    } finally {
      if (requestId === requestSequence.current) setLoading(false);
    }
  }, [kind]);

  useEffect(() => { void load(kind); }, [kind, load]);

  const activeCount = items.filter(isActive).length;
  const inactiveCount = items.length - activeCount;
  const filteredItems = useMemo(() => {
    const query = search.trim().toLowerCase();
    return items.filter(item => {
      const label = kind === 'grades' ? item.name : `${item.quantity ?? ''} ${item.unit ?? ''}`;
      const matchesSearch = !query || label.toLowerCase().includes(query);
      const matchesStatus = statusFilter === 'all'
        || (statusFilter === 'active' && isActive(item))
        || (statusFilter === 'inactive' && !isActive(item));
      return matchesSearch && matchesStatus;
    });
  }, [items, kind, search, statusFilter]);

  const reset = () => {
    setName('');
    setQuantity('');
    setUnit('');
    setEditId(null);
  };

  const closeForm = () => {
    setShowForm(false);
    reset();
    setError('');
  };

  const openCreateForm = () => {
    reset();
    setError('');
    setNotice('');
    setShowForm(true);
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    setNotice('');
    const data = kind === 'grades' ? { name: name.trim() } : { quantity: Number(quantity), unit: unit.trim() };
    try {
      const result = editId
        ? await api.masters.update(kind, editId, data)
        : await api.masters.create(kind, data);
      setNotice(result.reactivated
        ? 'Existing inactive value reactivated and is now available in dropdowns.'
        : editId ? 'Master value updated.' : 'Master value added.');
      closeForm();
      await load();
    } catch (err: any) {
      setError(err.message || 'Could not save master value');
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = (item: MasterItem) => {
    setEditId(item.id);
    setName(kind === 'grades' ? item.name : '');
    setQuantity(item.quantity === undefined ? '' : String(item.quantity));
    setUnit(item.unit || '');
    setError('');
    setNotice('');
    setShowForm(true);
  };

  const handleDeactivate = async (item: MasterItem) => {
    const label = kind === 'grades' ? item.name : `${item.quantity} ${item.unit}`;
    if (!window.confirm(`Deactivate "${label}"? Existing batches will keep this value.`)) return;
    setError('');
    setNotice('');
    try {
      await api.masters.remove(kind, item.id);
      setNotice('Master value deactivated.');
      await load();
    } catch (err: any) {
      setError(err.message || 'Could not deactivate master value');
    }
  };

  const handleActivate = async (item: MasterItem) => {
    setError('');
    setNotice('');
    try {
      await api.masters.setStatus(kind, item.id, true);
      setNotice('Master value activated and is now available in dropdowns.');
      await load();
    } catch (err: any) {
      setError(err.message || 'Could not activate master value');
    }
  };

  const changeKind = (nextKind: MasterKind) => {
    if (kind === nextKind) return;
    requestSequence.current += 1;
    setKind(nextKind);
    setItems([]);
    setLoading(true);
    setSearch('');
    setStatusFilter('all');
    setNotice('');
    setError('');
    closeForm();
  };

  const title = kind === 'grades' ? 'Grades' : 'Bag quantities';
  const itemLabel = kind === 'grades' ? 'grade' : 'bag quantity';

  return (
    <div className="page-container">
      <div className="page-header">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-brand-50 text-brand-600">
            <PackageCheck size={21} />
          </div>
          <div>
            <h1 className="page-title">Masters</h1>
            <p className="page-subtitle">Manage reusable grades and bag quantities for finished goods.</p>
          </div>
        </div>
        <button onClick={openCreateForm} className="btn-primary">
          <Plus size={16} /> Add {itemLabel}
        </button>
      </div>

      {notice && (
        <div className="mb-4 flex items-center justify-between rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">
          <span className="flex items-center gap-2"><Check size={15} />{notice}</span>
          <button onClick={() => setNotice('')} className="text-emerald-700" aria-label="Dismiss notice"><X size={15} /></button>
        </div>
      )}
      {error && !showForm && (
        <div className="mb-4 flex items-center justify-between rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
          <span>{error}</span>
          <button onClick={() => setError('')} className="text-rose-700" aria-label="Dismiss error"><X size={15} /></button>
        </div>
      )}

      <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
        {[
          { label: 'Total values', value: items.length, style: 'bg-brand-50 text-brand-600' },
          { label: 'Active', value: activeCount, style: 'bg-emerald-50 text-emerald-600' },
          { label: 'Inactive', value: inactiveCount, style: 'bg-surface-100 text-surface-500' },
        ].map(stat => (
          <div key={stat.label} className="card flex items-center gap-3 p-4">
            <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${stat.style}`}>
              <FlaskConical size={18} />
            </div>
            <div>
              <div className="text-xs font-medium uppercase tracking-wide text-surface-500">{stat.label}</div>
              <div className="text-xl font-bold text-surface-900">{loading ? '—' : stat.value}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-xl border border-surface-200 bg-white p-1 shadow-sm" role="tablist" aria-label="Master type">
          {([
            { value: 'grades', label: 'Grades' },
            { value: 'bag-quantities', label: 'Bag quantities' },
          ] as const).map(tab => (
            <button
              key={tab.value}
              type="button"
              role="tab"
              aria-selected={kind === tab.value}
              onClick={() => changeKind(tab.value)}
              className={`rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                kind === tab.value ? 'bg-brand-600 text-white shadow-sm' : 'text-surface-600 hover:bg-surface-50'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <button type="button" onClick={() => void load()} className="btn-secondary btn-sm" disabled={loading}>
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      <div className="card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-surface-100 p-4 sm:px-6">
          <div>
            <h2 className="section-title">{title} master</h2>
            <p className="mt-1 text-xs text-surface-500">{activeCount} active value{activeCount === 1 ? '' : 's'}</p>
          </div>
          <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
            <div className="relative min-w-[180px] flex-1 sm:flex-none">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-surface-400" />
              <input
                className="input pl-9"
                placeholder={`Search ${title.toLowerCase()}...`}
                value={search}
                onChange={event => setSearch(event.target.value)}
                aria-label={`Search ${title.toLowerCase()}`}
              />
            </div>
            <div className="relative">
              <select
                className="select min-w-[120px]"
                value={statusFilter}
                onChange={event => setStatusFilter(event.target.value as StatusFilter)}
                aria-label="Filter by status"
              >
                <option value="all">All status</option>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </div>
          </div>
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{kind === 'grades' ? 'Grade' : 'Amount per bag'}</th>
                <th>Status</th>
                <th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredItems.map(item => (
                <tr key={item.id} className={!isActive(item) ? 'opacity-60' : ''}>
                  <td className="font-medium text-surface-800">
                    {kind === 'grades' ? item.name : (
                      <span><span className="font-semibold">{item.quantity}</span> <span className="text-surface-500">{item.unit}</span></span>
                    )}
                  </td>
                  <td>
                    <span className={`badge ${isActive(item) ? 'badge-success' : 'badge-neutral'}`}>
                      {isActive(item) ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td>
                    <div className="flex justify-end gap-1">
                      <button onClick={() => handleEdit(item)} className="btn-ghost btn-sm" title={`Edit ${itemLabel}`} aria-label={`Edit ${itemLabel}`}>
                        <Pencil size={14} />
                      </button>
                      {isActive(item) ? (
                        <button onClick={() => void handleDeactivate(item)} className="btn-ghost btn-sm text-rose-600" title={`Deactivate ${itemLabel}`} aria-label={`Deactivate ${itemLabel}`}>
                          <Trash2 size={14} />
                        </button>
                      ) : (
                        <button onClick={() => void handleActivate(item)} className="btn-ghost btn-sm text-emerald-600" title={`Activate ${itemLabel}`} aria-label={`Activate ${itemLabel}`}>
                          <Check size={14} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {!loading && filteredItems.length === 0 && (
                <tr>
                  <td colSpan={3}>
                    <div className="empty-state">
                      <div className="empty-icon"><PackageCheck size={23} className="text-surface-400" /></div>
                      <div className="empty-title">{items.length ? 'No matching values' : `No ${title.toLowerCase()} yet`}</div>
                      <div className="empty-desc">
                        {items.length ? 'Try a different search or status filter.' : `Add a ${itemLabel} to make it available for finished goods.`}
                      </div>
                    </div>
                  </td>
                </tr>
              )}
              {loading && (
                <tr><td colSpan={3}><div className="empty-state"><div className="empty-title">Loading {title.toLowerCase()}...</div></div></td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showForm && (
        <div className="modal-overlay" onClick={closeForm}>
          <div className="modal-content max-w-md" onClick={event => event.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h2 className="text-base font-semibold text-surface-900">{editId ? 'Edit' : 'Add'} {itemLabel}</h2>
                <p className="mt-0.5 text-xs text-surface-500">This value can be selected when recording finished goods.</p>
              </div>
              <button type="button" onClick={closeForm} className="btn-ghost btn-sm" aria-label="Close form"><X size={16} /></button>
            </div>
            <form onSubmit={handleSubmit}>
              <div className="modal-body space-y-4">
                {kind === 'grades' ? (
                  <div>
                    <label className="input-label" htmlFor="master-grade-name">Grade name *</label>
                    <input id="master-grade-name" className="input" value={name} onChange={event => setName(event.target.value)} maxLength={100} required autoFocus />
                  </div>
                ) : (
                  <>
                    <div>
                      <label className="input-label" htmlFor="master-bag-quantity">Amount per bag *</label>
                      <input id="master-bag-quantity" className="input" type="number" min="0.0001" max="9999999999.9999" step="0.0001" value={quantity} onChange={event => setQuantity(event.target.value)} required autoFocus />
                    </div>
                    <div>
                      <label className="input-label" htmlFor="master-bag-unit">Measuring unit *</label>
                      <input id="master-bag-unit" className="input" list="bag-measurement-units" value={unit} onChange={event => setUnit(event.target.value)} maxLength={40} placeholder="Choose or type a unit" required />
                      <datalist id="bag-measurement-units">
                        {UNIT_SUGGESTIONS.map(value => <option key={value} value={value} />)}
                      </datalist>
                      <p className="mt-1.5 text-xs text-surface-400">Common units are suggested; custom units are also allowed.</p>
                    </div>
                  </>
                )}
                {error && <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</div>}
              </div>
              <div className="modal-footer">
                <button type="button" onClick={closeForm} className="btn-secondary">Cancel</button>
                <button type="submit" className="btn-primary" disabled={saving}>
                  {editId ? <Save size={14} /> : <Plus size={14} />}
                  {saving ? 'Saving...' : editId ? 'Save changes' : `Add ${itemLabel}`}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
