import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../services/api';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import type { EntityId } from '../types';
import Clients from './Clients';
import Vendors from './Vendors';
import ShelfLocations from './ShelfLocations';
import {
  Building2,
  Factory,
  Warehouse,
  FlaskConical,
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
} from 'lucide-react';

type MasterTab = 'clients' | 'vendors' | 'shelf-locations' | 'grades' | 'uoms';
type SimpleMasterKind = 'grades' | 'uoms';
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
  { id: 'clients', label: 'Clients', icon: Building2 },
  { id: 'vendors', label: 'Vendors / Suppliers', icon: Factory },
  { id: 'shelf-locations', label: 'Shelf Locations', icon: Warehouse },
  { id: 'grades', label: 'Product Grades', icon: FlaskConical },
  { id: 'uoms', label: 'Units of Measure (UOM)', icon: Scale },
];

export default function Masters() {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialTab = (searchParams.get('tab') as MasterTab) || 'clients';
  const [activeTab, setActiveTab] = useState<MasterTab>(
    TABS.some((t) => t.id === initialTab) ? initialTab : 'clients'
  );

  const isSimpleMaster = activeTab === 'grades' || activeTab === 'uoms';
  const simpleKind = (isSimpleMaster ? activeTab : 'grades') as SimpleMasterKind;

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
    const tabParam = searchParams.get('tab') as MasterTab;
    if (tabParam && TABS.some((t) => t.id === tabParam) && tabParam !== activeTab) {
      setActiveTab(tabParam);
    }
  }, [searchParams, activeTab]);

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
          ? `${simpleKind === 'grades' ? 'Grade' : 'UOM'} updated.`
          : `${simpleKind === 'grades' ? 'Grade' : 'UOM'} added.`
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

  const handleDeactivate = async (item: MasterItem) => {
    const label = item.name;
    const typeLabel = simpleKind === 'grades' ? 'grade' : 'UOM';
    if (!window.confirm(`Deactivate "${label}"? Existing records will keep this value.`)) return;
    setError('');
    setNotice('');
    try {
      await api.masters.remove(simpleKind, item.id);
      setNotice(`${typeLabel.toUpperCase()} deactivated.`);
      await loadSimpleMaster();
    } catch (err: any) {
      setError(err.message || 'Could not deactivate master value');
    }
  };

  const handleActivate = async (item: MasterItem) => {
    const typeLabel = simpleKind === 'grades' ? 'grade' : 'UOM';
    setError('');
    setNotice('');
    try {
      await api.masters.setStatus(simpleKind, item.id, true);
      setNotice(`${typeLabel.toUpperCase()} activated and is now available.`);
      await loadSimpleMaster();
    } catch (err: any) {
      setError(err.message || 'Could not activate master value');
    }
  };

  const itemTitle = simpleKind === 'grades' ? 'Grades' : 'UOMs';
  const itemLabel = simpleKind === 'grades' ? 'grade' : 'UOM';

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
              Centralized master registries for Clients, Vendors, Shelf Locations, Product Grades, and Units of Measure.
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
      {activeTab === 'shelf-locations' && <ShelfLocations embedded />}

      {/* Grades & UOMs Tab Content */}
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
              { label: 'Deactivated / Inactive', value: inactiveCount, bg: 'bg-slate-100 text-slate-700' },
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
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => handleEdit(item)}
                            className="p-2 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors"
                            title={`Edit ${itemLabel}`}
                          >
                            <Pencil size={17} />
                          </button>
                          {isActive(item) ? (
                            <button
                              onClick={() => void handleDeactivate(item)}
                              className="p-2 text-rose-600 hover:text-rose-800 hover:bg-rose-50 rounded-lg transition-colors"
                              title={`Deactivate ${itemLabel}`}
                            >
                              <Trash2 size={17} />
                            </button>
                          ) : (
                            <button
                              onClick={() => void handleActivate(item)}
                              className="p-2 text-emerald-600 hover:text-emerald-800 hover:bg-emerald-50 rounded-lg transition-colors"
                              title={`Activate ${itemLabel}`}
                            >
                              <Check size={17} />
                            </button>
                          )}
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
                      placeholder={
                        simpleKind === 'grades'
                          ? 'e.g. Industrial, Commercial, Pharma Grade'
                          : 'e.g. 25 kg Bag, 50 kg Bag, 1000 kg Jumbo'
                      }
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
