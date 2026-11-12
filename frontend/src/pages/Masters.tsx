import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../services/api';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import type { EntityId } from '../types';
import Clients from './Clients';
import Vendors from './Vendors';
import Products from './Products';
import {
  Building2,
  Factory,
  Package,
  PackageCheck,
  SlidersHorizontal,
  Plus,
  RefreshCw,
  Search,
  Save,
  Trash2,
  Check,
  X,
  Pencil,
  Scale,
  Printer,
} from 'lucide-react';

type MasterTab = 'clients' | 'vendors' | 'products' | 'uoms' | 'printer-label';
type SimpleMasterKind = 'uoms';
type StatusFilter = 'all' | 'active' | 'inactive';

type MasterItem = {
  id: EntityId;
  name: string;
  is_active?: number | boolean | string | null;
};

function isActive(item: MasterItem): boolean {
  return item.is_active === true || Number(item.is_active) === 1;
}

const TABS: { id: MasterTab; label: string; icon: any }[] = [
  { id: 'clients', label: 'Customer', icon: Building2 },
  { id: 'vendors', label: 'Vendors / Suppliers', icon: Factory },
  { id: 'products', label: 'Products & Grades', icon: Package },
  { id: 'uoms', label: 'Units of Measure (UOM)', icon: Scale },
  { id: 'printer-label', label: 'Printer Label Size', icon: Printer },
];

function normalizeTab(value: string | null): MasterTab {
  if (value === 'grades') return 'products';
  return TABS.some((tab) => tab.id === value) ? (value as MasterTab) : 'clients';
}

function PrinterLabelSettings() {
  const [widthMm, setWidthMm] = useState('60');
  const [heightMm, setHeightMm] = useState('64');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    api.auth.printerLabelSize()
      .then((size) => {
        setWidthMm(String(size.widthMm));
        setHeightMm(String(size.heightMm));
      })
      .catch((err: any) => setError(err.message || 'Could not load printer settings.'))
      .finally(() => setLoading(false));
  }, []);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const size = await api.auth.updatePrinterLabelSize({ widthMm: Number(widthMm), heightMm: Number(heightMm) });
      setWidthMm(String(size.widthMm));
      setHeightMm(String(size.heightMm));
      setNotice('Printer label size saved for this organization.');
    } catch (err: any) {
      setError(err.message || 'Could not save printer label size.');
    } finally {
      setSaving(false);
    }
  };

  const previewScale = Math.min(2.5, 220 / Number(widthMm || 60), 150 / Number(heightMm || 64));
  return (
    <section className="overflow-hidden rounded-2xl border-2 border-slate-200 bg-white shadow-xs">
      <div className="border-b border-slate-100 px-5 py-4 sm:px-6">
        <h2 className="text-xl font-bold text-slate-900">QR printer label size</h2>
        <p className="mt-1 text-sm text-slate-500">Set the physical width and height used when QC prints labels after creating a batch.</p>
      </div>
      <form onSubmit={save} className="grid gap-6 p-5 sm:p-6 lg:grid-cols-[minmax(0,1fr)_280px]">
        <div className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block text-sm font-semibold text-slate-700">
              Label width
              <span className="mt-1.5 flex items-center gap-2">
                <input className="input" type="number" min="30" max="200" step="1" value={widthMm} onChange={(event) => setWidthMm(event.target.value)} required disabled={loading || saving} />
                <span className="text-sm font-bold text-slate-500">mm</span>
              </span>
            </label>
            <label className="block text-sm font-semibold text-slate-700">
              Label height
              <span className="mt-1.5 flex items-center gap-2">
                <input className="input" type="number" min="30" max="250" step="1" value={heightMm} onChange={(event) => setHeightMm(event.target.value)} required disabled={loading || saving} />
                <span className="text-sm font-bold text-slate-500">mm</span>
              </span>
            </label>
          </div>
          <p className="text-xs text-slate-500">Each QR label prints as one page at this size. Width: 30–200 mm; height: 30–250 mm.</p>
          {error && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">{error}</p>}
          {notice && <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700">{notice}</p>}
          <button type="submit" className="btn-primary" disabled={loading || saving}>
            <Save size={16} /> {loading ? 'Loading…' : saving ? 'Saving…' : 'Save label size'}
          </button>
        </div>
        <div className="flex min-h-48 flex-col items-center justify-center rounded-2xl bg-slate-50 p-4">
          <span className="mb-3 text-xs font-bold uppercase tracking-wide text-slate-500">Print preview</span>
          <div className="flex flex-col items-center justify-center overflow-hidden rounded-md border border-dashed border-slate-400 bg-white p-2 text-center shadow-sm" style={{ width: `${Number(widthMm || 60) * previewScale}px`, height: `${Number(heightMm || 64) * previewScale}px`, maxWidth: '100%' }}>
            <div className="mb-1 text-[9px] font-bold text-slate-800">Product name</div>
            <div className="mb-1 text-[7px] text-slate-500">Batch · unit number</div>
            <div className="flex aspect-square w-1/2 items-center justify-center bg-slate-900 text-[9px] font-black text-white">QR</div>
            <div className="mt-1 text-[6px] text-slate-400">QR label code</div>
          </div>
          <span className="mt-2 text-xs font-semibold text-slate-600">{widthMm || '—'} × {heightMm || '—'} mm</span>
        </div>
      </form>
    </section>
  );
}

export default function Masters() {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialTab = normalizeTab(searchParams.get('tab'));
  const [activeTab, setActiveTab] = useState<MasterTab>(initialTab);

  const isSimpleMaster = activeTab === 'uoms';
  const simpleKind: SimpleMasterKind = 'uoms';

  const [items, setItems] = useState<MasterItem[]>([]);
  const [name, setName] = useState('');
  const [editId, setEditId] = useState<EntityId | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, 250);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const requestSequence = useRef(0);

  useEffect(() => {
    const tabParam = normalizeTab(searchParams.get('tab'));
    if (searchParams.get('tab') !== tabParam) {
      setSearchParams({ tab: tabParam }, { replace: true });
    }
    if (tabParam !== activeTab) {
      setActiveTab(tabParam);
    }
  }, [searchParams, activeTab, setSearchParams]);

  const switchTab = (tab: MasterTab) => {
    setActiveTab(tab);
    setSearchParams({ tab });
    setError('');
    setNotice('');
    setShowForm(false);
    setSearch('');
    setStatusFilter('all');
  };

  const loadSimpleMaster = useCallback(
    async (selectedKind: SimpleMasterKind = simpleKind) => {
      const requestId = ++requestSequence.current;
      setLoading(true);
      setError('');
      try {
        const rows = await api.masters.list(selectedKind);
        if (requestId === requestSequence.current) setItems(rows || []);
      } catch (err: any) {
        if (requestId === requestSequence.current) {
          setItems([]);
          setError(err.message || 'Could not load master values');
        }
      } finally {
        if (requestId === requestSequence.current) setLoading(false);
      }
    },
    [simpleKind]
  );

  useEffect(() => {
    if (isSimpleMaster) {
      void loadSimpleMaster(simpleKind);
    }
  }, [isSimpleMaster, simpleKind, loadSimpleMaster]);

  useEffect(() => {
    if (!showForm) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeForm();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showForm]);

  const activeCount = items.filter(isActive).length;
  const inactiveCount = items.length - activeCount;

  const filteredItems = useMemo(() => {
    const query = debouncedSearch.trim().toLowerCase();
    return items.filter((item) => {
      const label = item.name || '';
      const matchesSearch = !query || label.toLowerCase().includes(query);
      const matchesStatus =
        statusFilter === 'all' ||
        (statusFilter === 'active' && isActive(item)) ||
        (statusFilter === 'inactive' && !isActive(item));
      return matchesSearch && matchesStatus;
    });
  }, [items, debouncedSearch, statusFilter]);

  const resetForm = () => {
    setName('');
    setEditId(null);
    setError('');
  };

  const openCreateForm = () => {
    resetForm();
    setNotice('');
    setShowForm(true);
  };

  const closeForm = () => {
    setShowForm(false);
    resetForm();
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    setNotice('');
    const data = { name: name.trim() };
    try {
      const result = editId
        ? await api.masters.update(simpleKind, editId, data)
        : await api.masters.create(simpleKind, data);
      setNotice(
        result.reactivated
          ? 'Existing inactive value reactivated and is now available in dropdowns.'
          : editId
          ? 'UOM updated.'
          : 'UOM added.'
      );
      closeForm();
      await loadSimpleMaster();
    } catch (err: any) {
      setError(err.message || 'Could not save master value');
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = (item: MasterItem) => {
    setEditId(item.id);
    setName(item.name || '');
    setError('');
    setNotice('');
    setShowForm(true);
  };

  const itemTitle = 'UOMs';
  const itemLabel = 'UOM';

  const handleDelete = async (item: MasterItem) => {
    const label = item.name;
    if (
      !window.confirm(
        `Delete "${label}" permanently? This cannot be undone.\n\nIf any grade still uses this ${itemLabel}, deletion is blocked until those grades are changed to another ${itemLabel}.`
      )
    ) {
      return;
    }
    setError('');
    setNotice('');
    try {
      const result = await api.masters.remove(simpleKind, item.id);
      setNotice(result?.message || `${itemLabel} deleted.`);
      await loadSimpleMaster();
    } catch (err: any) {
      setError(err.message || `Could not delete ${itemLabel}`);
    }
  };

  const handleActivate = async (item: MasterItem) => {
    setError('');
    setNotice('');
    try {
      await api.masters.setStatus(simpleKind, item.id, true);
      setNotice('UOM activated and is now available.');
      await loadSimpleMaster();
    } catch (err: any) {
      setError(err.message || 'Could not activate master value');
    }
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* 1. TOP HEADER */}
      <div className="bg-white rounded-2xl border-2 border-slate-200 p-5 sm:p-6 shadow-xs flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-brand-100 text-brand-700 flex items-center justify-center shrink-0">
            <SlidersHorizontal size={24} />
          </div>
          <div>
            <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
              Masters Management
            </h1>
            <p className="text-sm sm:text-base text-slate-500 mt-0.5">
              Manage customers, vendors, products and their grades, units of measure, and printer labels.
            </p>
          </div>
        </div>
      </div>

      {/* 2. MASTER TABS SWITCHER */}
      <div className="bg-white rounded-2xl border-2 border-slate-200 p-2 shadow-xs">
        <nav className="flex flex-wrap gap-1 sm:gap-2" aria-label="Master sections">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            const isCurrent = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => switchTab(tab.id)}
                className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold transition-all ${
                  isCurrent
                    ? 'bg-brand-600 text-white shadow-sm'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                }`}
              >
                <Icon size={18} />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </nav>
      </div>

      {/* 3. TAB CONTENTS */}
      {activeTab === 'clients' && <Clients embedded />}
      {activeTab === 'vendors' && <Vendors embedded />}
      {activeTab === 'products' && <Products embedded />}
      {activeTab === 'printer-label' && <PrinterLabelSettings />}
      {/* UOM master register */}
      {isSimpleMaster && (
        <div className="space-y-6">
          <div className="bg-white rounded-2xl border-2 border-slate-200 p-5 shadow-xs flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <h2 className="text-xl font-bold text-slate-900">{itemTitle} Master Register</h2>
              <p className="text-sm text-slate-500 mt-0.5">
                Manage reusable {itemTitle.toLowerCase()} available in product and batch creation ({items.length} total)
              </p>
            </div>
            <button
              onClick={openCreateForm}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-brand-600 hover:bg-brand-700 text-white text-sm font-bold rounded-xl transition-colors shadow-sm shrink-0"
            >
              <Plus size={18} /> Add New {itemLabel}
            </button>
          </div>

          {notice && (
            <div className="p-4 rounded-xl text-sm font-semibold bg-emerald-50 text-emerald-800 border-2 border-emerald-200 flex items-center justify-between">
              <span className="flex items-center gap-2">
                <Check size={18} /> {notice}
              </span>
              <button onClick={() => setNotice('')} className="text-emerald-700 hover:text-emerald-900">
                <X size={18} />
              </button>
            </div>
          )}

          {error && !showForm && (
            <div className="p-4 rounded-xl text-sm font-semibold bg-rose-50 text-rose-800 border-2 border-rose-200 flex items-center justify-between">
              <span>{error}</span>
              <button onClick={() => setError('')} className="text-rose-700 hover:text-rose-900">
                <X size={18} />
              </button>
            </div>
          )}

          {/* Stats */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {[
              { label: `Total ${itemTitle}`, value: items.length, bg: 'bg-blue-100 text-blue-700' },
              { label: 'Active in System', value: activeCount, bg: 'bg-emerald-100 text-emerald-700' },
              { label: 'Inactive', value: inactiveCount, bg: 'bg-slate-100 text-slate-700' },
            ].map((stat) => (
              <div key={stat.label} className="bg-white rounded-2xl border-2 border-slate-200 p-5 shadow-xs">
                <span className="text-xs sm:text-sm font-bold text-slate-600 uppercase tracking-wide">
                  {stat.label}
                </span>
                <div className="text-3xl font-black text-slate-900 mt-1">
                  {loading ? '—' : stat.value}
                </div>
              </div>
            ))}
          </div>

          {/* Table Container */}
          <div className="bg-white rounded-2xl border-2 border-slate-200 overflow-hidden shadow-xs">
            <div className="p-4 border-b border-slate-100 flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-3 flex-1 min-w-[240px]">
                <div className="relative flex-1 max-w-sm">
                  <Search size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    className="w-full pl-10 pr-3.5 py-2 rounded-xl border border-slate-200 bg-slate-50 focus:bg-white text-sm text-slate-900 font-medium placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-500"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder={`Search ${itemTitle.toLowerCase()}...`}
                  />
                </div>

                <select
                  className="px-3.5 py-2 rounded-xl border border-slate-200 bg-slate-50 focus:bg-white text-sm font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-brand-500"
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
                >
                  <option value="all">All Statuses</option>
                  <option value="active">Active Only</option>
                  <option value="inactive">Inactive Only</option>
                </select>
              </div>

              <button
                type="button"
                onClick={() => void loadSimpleMaster()}
                className="inline-flex items-center gap-1.5 px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-bold rounded-xl transition-colors"
                disabled={loading}
              >
                <RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> Refresh
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 border-b-2 border-slate-200 text-slate-600 font-bold uppercase text-xs tracking-wider">
                  <tr>
                    <th className="px-6 py-4">{itemTitle} Name</th>
                    <th className="px-6 py-4">Status</th>
                    <th className="px-6 py-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredItems.map((item) => (
                    <tr key={item.id} className="hover:bg-slate-50/80 transition-colors">
                      <td className="px-6 py-4">
                        <span className="font-bold text-slate-900 text-base">{item.name}</span>
                      </td>
                      <td className="px-6 py-4">
                        {isActive(item) ? (
                          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800 border border-emerald-300">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> Active
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-slate-100 text-slate-700 border border-slate-300">
                            Inactive
                          </span>
                        )}
                      </td>
                      <td className="px-6 py-4 text-right">
                        <div className="flex flex-wrap items-center justify-end gap-2">
                          <button
                            onClick={() => handleEdit(item)}
                            className="inline-flex items-center gap-1.5 rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-bold text-slate-700 transition-colors hover:bg-slate-200"
                            title={`Edit ${itemLabel}`}
                          >
                            <Pencil size={15} /> Edit
                          </button>
                          {!isActive(item) && (
                            <button
                              onClick={() => void handleActivate(item)}
                              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-700 ring-1 ring-emerald-200 transition-colors hover:bg-emerald-100"
                              title={`Activate ${itemLabel}`}
                            >
                              <Check size={15} /> Activate
                            </button>
                          )}
                          <button
                            onClick={() => void handleDelete(item)}
                            className="inline-flex items-center gap-1.5 rounded-lg bg-rose-50 px-3 py-1.5 text-xs font-bold text-rose-700 ring-1 ring-rose-200 transition-colors hover:bg-rose-100"
                            title={`Delete ${itemLabel} permanently`}
                          >
                            <Trash2 size={15} /> Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}

                  {!loading && filteredItems.length === 0 && (
                    <tr>
                      <td colSpan={3} className="py-12 text-center text-slate-400">
                        <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center mx-auto mb-2 text-slate-400">
                          <PackageCheck size={24} />
                        </div>
                        <p className="text-base font-bold text-slate-700">No {itemTitle.toLowerCase()} found</p>
                        <p className="text-sm text-slate-500 mt-0.5">
                          {items.length ? 'Try changing your search term.' : `Add your first ${itemLabel} to get started.`}
                        </p>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Form Modal */}
          {showForm && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
              <div className="bg-white rounded-2xl border-2 border-slate-200 shadow-xl w-full max-w-md overflow-hidden">
                <div className="p-5 border-b border-slate-100 flex items-center justify-between">
                  <div>
                    <h2 className="text-lg font-bold text-slate-900">
                      {editId ? 'Edit' : 'Add New'} {itemLabel}
                    </h2>
                    <p className="text-xs text-slate-500 mt-0.5">
                      This value will be selectable in product dropdowns
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={closeForm}
                    className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100"
                  >
                    <X size={20} />
                  </button>
                </div>

                <form onSubmit={handleSubmit} className="p-6 space-y-4">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 uppercase tracking-wide mb-1.5">
                      {itemTitle} Name *
                    </label>
                    <input
                      className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 bg-white text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand-500"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      maxLength={100}
                      placeholder="e.g. 25 kg Bag, 50 kg Bag, 1000 kg Jumbo"
                      required
                      autoFocus
                    />
                  </div>

                  {error && (
                    <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-sm font-medium text-rose-800">
                      {error}
                    </div>
                  )}

                  <div className="pt-4 flex items-center justify-end gap-3 border-t border-slate-100">
                    <button
                      type="button"
                      onClick={closeForm}
                      className="px-4 py-2 rounded-xl text-sm font-bold text-slate-600 hover:bg-slate-100"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={saving}
                      className="px-5 py-2 rounded-xl text-sm font-bold bg-brand-600 hover:bg-brand-700 text-white shadow-sm"
                    >
                      {saving ? 'Saving...' : editId ? 'Save Changes' : `Add ${itemLabel}`}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
