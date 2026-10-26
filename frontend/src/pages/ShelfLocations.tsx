import { useEffect, useState, FormEvent } from 'react';
import { api } from '../services/api';
import { EntityId, ShelfLocation } from '../types';
import { MapPin, Plus, Pencil, Trash2, X, Power } from 'lucide-react';

export default function ShelfLocations() {
  const [locations, setLocations] = useState<ShelfLocation[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<EntityId | null>(null);
  const [code, setCode] = useState('');
  const [desc, setDesc] = useState('');
  const [warehouse, setWarehouse] = useState('');
  const [rack, setRack] = useState('');
  const [shelf, setShelf] = useState('');
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');

  useEffect(() => {
    api.shelfLocations.list().then(setLocations).catch(err => setError(err.message || 'Could not load shelf locations'));
  }, []);

  const resetForm = () => { setCode(''); setDesc(''); setWarehouse(''); setRack(''); setShelf(''); setError(''); setEditId(null); };

  const handleEdit = (loc: ShelfLocation) => {
    setEditId(loc.id); setCode(loc.location_code); setDesc(loc.description || '');
    setWarehouse(loc.warehouse || ''); setRack(loc.rack || ''); setShelf(loc.shelf || ''); setShowForm(true);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault(); setError('');
    try {
      if (editId) {
        await api.shelfLocations.update(editId, { location_code: code, description: desc, warehouse, rack, shelf });
      } else {
        await api.shelfLocations.create({ location_code: code, description: desc, warehouse, rack, shelf });
      }
      setShowForm(false); resetForm();
      api.shelfLocations.list().then(setLocations);
    } catch (err: any) { setError(err.message); }
  };

  const handleDelete = async (id: EntityId) => {
    if (!window.confirm('Delete this location?')) return;
    try {
      await api.shelfLocations.delete(id);
      api.shelfLocations.list().then(setLocations);
    } catch (err: any) { setError(err.message); }
  };

  const handleToggle = async (loc: ShelfLocation) => {
    const next = loc.is_active !== 1;
    if (!window.confirm(`${next ? 'Activate' : 'Deactivate'} location "${loc.location_code}"?`)) return;
    try {
      await api.shelfLocations.update(loc.id, {
        location_code: loc.location_code,
        description: loc.description || '',
        warehouse: loc.warehouse || '',
        rack: loc.rack || '',
        shelf: loc.shelf || '',
        is_active: next ? 1 : 0,
      });
      api.shelfLocations.list().then(setLocations);
    } catch (err: any) {
      setError(err.message);
    }
  };

  const filteredLocations = locations.filter(l =>
    !search ||
    l.location_code.toLowerCase().includes(search.toLowerCase()) ||
    (l.description || '').toLowerCase().includes(search.toLowerCase()) ||
    (l.warehouse || '').toLowerCase().includes(search.toLowerCase()) ||
    (l.rack || '').toLowerCase().includes(search.toLowerCase()) ||
    (l.shelf || '').toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1 className="page-title">Shelf Locations</h1>
          <p className="page-subtitle">Define and manage warehouse storage locations</p>
        </div>
        <button onClick={() => { setShowForm(!showForm); resetForm(); }} className="btn-primary">
          <Plus size={16} /> Add Location
        </button>
      </div>

      {error && !showForm && (
        <div className="mb-4 p-3 rounded-xl text-sm flex items-center justify-between bg-rose-50 text-rose-700 border border-rose-200">
          <span>{error}</span>
          <button onClick={() => setError('')} className="text-rose-500 hover:text-rose-700"><X size={15} /></button>
        </div>
      )}

      <div className="flex items-center gap-3 mb-4">
        <div className="relative flex-1 max-w-full sm:max-w-xs">
          <input
            className="input"
            placeholder="Search locations..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        {search && <button onClick={() => setSearch('')} className="btn-ghost btn-sm shrink-0"><X size={14} /> Clear</button>}
      </div>

      {showForm && (
        <div className="modal-overlay" onClick={() => setShowForm(false)}>
          <div className="modal-content max-w-lg" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="text-base font-semibold text-surface-900">{editId ? 'Edit' : 'Add'} Location</h2>
              <button onClick={() => setShowForm(false)} className="btn-ghost btn-sm"><X size={16} /></button>
            </div>
            <form onSubmit={handleSubmit}>
              <div className="modal-body space-y-4">
                <div className="form-grid">
                  <div className="space-y-1.5"><label className="input-label">Location Code *</label><input className="input" value={code} onChange={e => setCode(e.target.value.toUpperCase())} required placeholder="e.g., WH-A-R3-S2" /></div>
                  <div className="space-y-1.5"><label className="input-label">Description</label><input className="input" value={desc} onChange={e => setDesc(e.target.value)} placeholder="e.g., Aisle 3, Left Side" /></div>
                  <div className="space-y-1.5"><label className="input-label">Warehouse</label><input className="input" value={warehouse} onChange={e => setWarehouse(e.target.value)} placeholder="e.g., Main Warehouse" /></div>
                  <div className="space-y-1.5"><label className="input-label">Rack</label><input className="input" value={rack} onChange={e => setRack(e.target.value)} placeholder="e.g., R-03" /></div>
                  <div className="space-y-1.5"><label className="input-label">Shelf</label><input className="input" value={shelf} onChange={e => setShelf(e.target.value)} placeholder="e.g., S-02" /></div>
                </div>
                {error && <div className="text-sm text-rose-600 bg-rose-50 p-3 rounded-xl">{error}</div>}
              </div>
              <div className="modal-footer">
                <button type="button" onClick={() => setShowForm(false)} className="btn-secondary">Cancel</button>
                <button type="submit" className="btn-primary">{editId ? 'Update' : 'Create'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      <div className="card">
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Code</th><th>Description</th><th>Warehouse</th><th>Rack</th><th>Shelf</th><th>Status</th><th>Actions</th></tr>
            </thead>
            <tbody>
              {filteredLocations.map(l => (
                <tr key={l.id}>
                  <td><span className="font-mono text-sm font-semibold text-surface-800">{l.location_code}</span></td>
                  <td className="text-sm">{l.description || '-'}</td>
                  <td>{l.warehouse || '-'}</td>
                  <td>{l.rack || '-'}</td>
                  <td>{l.shelf || '-'}</td>
                  <td>{l.is_active ? <span className="badge badge-success">Active</span> : <span className="badge badge-danger">Inactive</span>}</td>
                  <td>
                    <div className="flex gap-1">
                      <button onClick={() => handleEdit(l)} className="btn-ghost btn-sm" title="Edit location"><Pencil size={14} /></button>
                      <button
                        onClick={() => handleToggle(l)}
                        className={`btn-ghost btn-sm ${l.is_active ? 'text-amber-600' : 'text-emerald-600'}`}
                        title={l.is_active ? 'Deactivate location' : 'Activate location'}
                      >
                        <Power size={14} />
                      </button>
                      <button onClick={() => handleDelete(l.id)} className="btn-ghost btn-sm text-rose-500" title="Delete location"><Trash2 size={14} /></button>
                    </div>
                  </td>
                </tr>
              ))}
              {filteredLocations.length === 0 && (
                <tr><td colSpan={7}><div className="empty-state"><div className="empty-icon"><MapPin size={24} className="text-surface-400" /></div><div className="empty-title">{search ? 'No matching locations found' : 'No locations defined'}</div><div className="empty-desc">{search ? 'Try a different search term' : 'Add your first storage location'}</div></div></td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
