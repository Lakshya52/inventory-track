import { FormEvent, Fragment, useEffect, useState } from 'react';
import { Building2, Plus, Pencil, Check, X, Power, RefreshCw, Users, Package, Trash2, AlertTriangle } from 'lucide-react';
import { api } from '../services/api';
import { Division } from '../types';

export default function Divisions({ embedded = false }: { embedded?: boolean }) {
  const [divisions, setDivisions] = useState<Division[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);

  const [editId, setEditId] = useState<Division['id'] | null>(null);
  const [editName, setEditName] = useState('');
  const [savingId, setSavingId] = useState<Division['id'] | null>(null);
  const [deleteId, setDeleteId] = useState<Division['id'] | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = async (manual = false) => {
    if (manual) setRefreshing(true); else setLoading(true);
    setError('');
    try {
      setDivisions(await api.divisions.list());
    } catch (err: any) {
      setError(err?.message || 'Failed to load divisions');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault();
    const name = newName.replace(/\s+/g, ' ').trim();
    if (name.length < 2) {
      setError('Enter a division name (at least 2 characters).');
      return;
    }
    setCreating(true);
    setError('');
    setNotice('');
    try {
      await api.divisions.create(name);
      setNewName('');
      setNotice(`Division "${name}" created. Assign QC and Dispatch users to it from User Management.`);
      await load(true);
    } catch (err: any) {
      setError(err?.message || 'Could not create the division');
    } finally {
      setCreating(false);
    }
  };

  const startRename = (division: Division) => {
    setEditId(division.id);
    setEditName(division.name);
    setError('');
    setNotice('');
  };

  const saveRename = async (division: Division) => {
    const name = editName.replace(/\s+/g, ' ').trim();
    if (name.length < 2) {
      setError('Enter a division name (at least 2 characters).');
      return;
    }
    if (name === division.name) {
      setEditId(null);
      return;
    }
    setSavingId(division.id);
    setError('');
    try {
      await api.divisions.update(division.id, { name });
      setNotice(`Division renamed to "${name}".`);
      setEditId(null);
      await load(true);
    } catch (err: any) {
      setError(err?.message || 'Could not rename the division');
    } finally {
      setSavingId(null);
    }
  };

  const handleDelete = async (division: Division) => {
    setDeleting(true);
    setError('');
    setNotice('');
    try {
      await api.divisions.remove(division.id);
      setNotice(`Division "${division.name}" deleted.`);
      setDeleteId(null);
      await load(true);
    } catch (err: any) {
      setError(err?.message || 'Could not delete the division. It may still be in use — deactivate it instead.');
    } finally {
      setDeleting(false);
    }
  };

  const toggleActive = async (division: Division) => {
    const next = division.is_active === 1 ? 0 : 1;
    setSavingId(division.id);
    setError('');
    setNotice('');
    try {
      await api.divisions.update(division.id, { is_active: next as 0 | 1 });
      setNotice(next === 1 ? `Division "${division.name}" activated.` : `Division "${division.name}" deactivated. Its members keep their data but no new users can be assigned to it.`);
      await load(true);
    } catch (err: any) {
      setError(err?.message || 'Could not update the division');
    } finally {
      setSavingId(null);
    }
  };

  const activeCount = divisions.filter((d) => d.is_active === 1).length;

  return (
    <div className={embedded ? 'space-y-6' : 'p-6 lg:p-8 max-w-5xl mx-auto space-y-6'}>
      {/* Header — embedded shows the master-card style like Products/UOM; standalone keeps the larger page title */}
      {embedded ? (
        <div className="rounded-2xl border-2 border-slate-200 bg-white p-5 shadow-xs sm:p-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-brand-100 text-brand-700">
              <Building2 size={24} />
            </div>
            <div>
              <h2 className="text-xl font-extrabold tracking-tight text-slate-900">Divisions Master</h2>
              <p className="mt-0.5 text-sm text-slate-500">Manufacturing units inside this organization ({divisions.length} total). QC & Dispatch members see only their division's stock.</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => void load(true)}
            disabled={refreshing}
            className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-bold text-slate-700 border border-slate-200 rounded-xl hover:bg-slate-50 disabled:opacity-50 shrink-0"
            title="Refresh list"
          >
            <RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>
      ) : (
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-brand-50 text-brand-600 flex items-center justify-center">
              <Building2 size={24} />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-slate-900">Divisions</h1>
              <p className="text-sm text-slate-500 mt-0.5">
                Split the plant into manufacturing units. QC and Dispatch members see only their division's
                products, batches, warehouses and orders — while you (admin) see everything.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => void load(true)}
            disabled={refreshing}
            className="inline-flex items-center gap-2 px-3 py-2 text-sm font-semibold text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-50"
            title="Refresh"
          >
            <RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>
      )}

      {(error || notice) && (
        <div className={`p-3 rounded-xl text-sm font-medium border ${error ? 'bg-rose-50 border-rose-200 text-rose-800' : 'bg-emerald-50 border-emerald-200 text-emerald-800'}`}>
          {error || notice}
        </div>
      )}

      {/* Create */}
      <form onSubmit={handleCreate} className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
        <label htmlFor="new-division" className="block text-xs font-bold text-slate-700 uppercase tracking-wide mb-2">
          New Division
        </label>
        <div className="flex gap-3">
          <input
            id="new-division"
            className="flex-1 px-3.5 py-2.5 rounded-xl border border-slate-200 bg-slate-50 focus:bg-white text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand-500"
            placeholder="e.g. TRP Compound Plant, XCLE Unit …"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            maxLength={120}
          />
          <button
            type="submit"
            disabled={creating}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold bg-brand-600 hover:bg-brand-700 text-white shadow-sm disabled:opacity-60"
          >
            <Plus size={18} />
            {creating ? 'Creating…' : 'Add Division'}
          </button>
        </div>
        <p className="text-xs text-slate-500 mt-2">
          Members are assigned to a division when you create them from <span className="font-semibold">User Management</span> (QC and Dispatch roles).
          Warehouses, racks, shelf locations, products, batches, QC, dispatch orders and loading sessions are kept separate per division.
        </p>
      </form>

      {/* List */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
          <h2 className="text-sm font-bold text-slate-700 uppercase tracking-wide">All Divisions</h2>
          <span className="text-xs font-semibold text-slate-500">{activeCount} active / {divisions.length} total</span>
        </div>

        {loading ? (
          <div className="p-10 text-center text-sm text-slate-500">Loading divisions…</div>
        ) : divisions.length === 0 ? (
          <div className="p-10 text-center">
            <Building2 size={36} className="mx-auto text-slate-300 mb-3" />
            <p className="text-sm font-semibold text-slate-600">No divisions yet</p>
            <p className="text-xs text-slate-500 mt-1 max-w-md mx-auto">
              Create your first division above — for example “TRP Compound” and “XCLE Compound” —
              then assign QC and Dispatch members to each.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-slate-500 bg-slate-50">
                  <th className="px-5 py-3">Division</th>
                  <th className="px-5 py-3">Members</th>
                  <th className="px-5 py-3">Products</th>
                  <th className="px-5 py-3">Status</th>
                  <th className="px-5 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {divisions.map((division) => (
                  <Fragment key={division.id}>
                  <tr className="hover:bg-slate-50/70">
                    <td className="px-5 py-3">
                      {editId === division.id ? (
                        <div className="flex items-center gap-2">
                          <input
                            autoFocus
                            className="px-2.5 py-1.5 text-sm rounded-lg border border-brand-400 bg-white focus:outline-none focus:ring-2 focus:ring-brand-500"
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') void saveRename(division);
                              if (e.key === 'Escape') setEditId(null);
                            }}
                            maxLength={120}
                          />
                          <button
                            type="button"
                            onClick={() => void saveRename(division)}
                            disabled={savingId === division.id}
                            className="p-1.5 rounded-lg text-emerald-600 hover:bg-emerald-50"
                            title="Save"
                          >
                            <Check size={16} />
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditId(null)}
                            className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100"
                            title="Cancel"
                          >
                            <X size={16} />
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => startRename(division)}
                          className="flex items-center gap-2 font-semibold text-slate-800 hover:text-brand-700"
                          title="Rename"
                        >
                          <Building2 size={16} className="text-brand-500" />
                          {division.name}
                          <Pencil size={13} className="text-slate-400" />
                        </button>
                      )}
                    </td>
                    <td className="px-5 py-3">
                      <span className="inline-flex items-center gap-1.5 text-slate-600 font-medium">
                        <Users size={14} className="text-slate-400" /> {division.users ?? 0}
                      </span>
                    </td>
                    <td className="px-5 py-3">
                      <span className="inline-flex items-center gap-1.5 text-slate-600 font-medium">
                        <Package size={14} className="text-slate-400" /> {division.products ?? 0}
                      </span>
                    </td>
                    <td className="px-5 py-3">
                      {division.is_active === 1 ? (
                        <span className="inline-block px-2.5 py-1 rounded-full text-[11px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">ACTIVE</span>
                      ) : (
                        <span className="inline-block px-2.5 py-1 rounded-full text-[11px] font-bold bg-slate-100 text-slate-500 border border-slate-200">INACTIVE</span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-right">
                      <div className="inline-flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => void toggleActive(division)}
                          disabled={savingId === division.id}
                          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border disabled:opacity-60 ${
                            division.is_active === 1
                              ? 'text-amber-700 border-amber-200 bg-amber-50 hover:bg-amber-100'
                              : 'text-emerald-700 border-emerald-200 bg-emerald-50 hover:bg-emerald-100'
                          }`}
                        >
                          <Power size={13} />
                          {division.is_active === 1 ? 'Deactivate' : 'Activate'}
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeleteId(deleteId === division.id ? null : division.id)}
                          disabled={deleting}
                          className="p-1.5 rounded-lg text-rose-600 border border-rose-200 bg-rose-50 hover:bg-rose-100 disabled:opacity-60"
                          title="Delete division (only when unused)"
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </td>
                  </tr>
                  {deleteId === division.id && (
                    <tr className="bg-rose-50/70">
                      <td colSpan={5} className="px-5 py-3">
                        <div className="flex items-center gap-3 flex-wrap">
                          <span className="flex items-center gap-2 text-sm font-medium text-rose-800">
                            <AlertTriangle size={16} />
                            Delete division “{division.name}”? This works only if it has no products, batches or other business records. Any QC/dispatch users assigned to it will be deactivated — they will not be able to log in until an administrator assigns them to another division.
                          </span>
                          <div className="flex items-center gap-2 ml-auto">
                            <button
                              type="button"
                              onClick={() => setDeleteId(null)}
                              className="px-3 py-1.5 rounded-lg text-xs font-bold text-slate-600 hover:bg-slate-100"
                            >
                              Cancel
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleDelete(division)}
                              disabled={deleting}
                              className="px-3 py-1.5 rounded-lg text-xs font-bold bg-rose-600 hover:bg-rose-700 text-white disabled:opacity-60"
                            >
                              {deleting ? 'Deleting…' : 'Delete Division'}
                            </button>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
