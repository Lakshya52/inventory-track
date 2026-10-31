import { useEffect, useState, FormEvent } from 'react';
import { api } from '../services/api';
import { Client, EntityId } from '../types';
import { Building2, Plus, Pencil, Trash2, X, Handshake } from 'lucide-react';
import { useDebouncedValue } from '../hooks/useDebouncedValue';

export default function Clients({ embedded = false }: { embedded?: boolean }) {
  const [clients, setClients] = useState<Client[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<EntityId | null>(null);
  const [name, setName] = useState('');
  const [contact, setContact] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [gst, setGst] = useState('');
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, 250);

  const loadClients = async () => {
    try {
      setClients(await api.clients.list());
    } catch (err: any) {
      setError(err.message || 'Could not load clients');
    }
  };

  useEffect(() => { void loadClients(); }, []);

  const resetForm = () => { setName(''); setContact(''); setEmail(''); setPhone(''); setAddress(''); setGst(''); setError(''); setEditId(null); };

  const handleEdit = (c: Client) => {
    setEditId(c.id); setName(c.name); setContact(c.contact_person || ''); setEmail(c.email || '');
    setPhone(c.phone || ''); setAddress(c.address || ''); setGst(c.gst_number || ''); setShowForm(true);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault(); setError('');
    try {
      const data = { name, contact_person: contact, email, phone, address, gst_number: gst };
      if (editId) { await api.clients.update(editId, data); } else { await api.clients.create(data); }
      setShowForm(false); resetForm();
      await loadClients();
    } catch (err: any) { setError(err.message); }
  };

  const handleDelete = async (id: EntityId) => {
    if (!window.confirm('Delete this client?')) return;
    try {
      await api.clients.delete(id);
      await loadClients();
    } catch (err: any) { setError(err.message); }
  };

  const filteredClients = clients.filter(c =>
    !debouncedSearch ||
    c.name.toLowerCase().includes(debouncedSearch.toLowerCase()) ||
    (c.contact_person || '').toLowerCase().includes(debouncedSearch.toLowerCase()) ||
    (c.gst_number || '').toLowerCase().includes(debouncedSearch.toLowerCase()) ||
    (c.email || '').toLowerCase().includes(debouncedSearch.toLowerCase())
  );

  return (
    <div className={embedded ? 'space-y-4' : 'page-container'}>
      {!embedded ? (
        <div className="page-header">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 border border-blue-200/60 flex items-center justify-center shrink-0">
              <Building2 size={20} />
            </div>
            <div>
              <h1 className="page-title">Clients</h1>
              <p className="page-subtitle">Manage client accounts and dispatch delivery destinations</p>
            </div>
          </div>
          <button onClick={() => { setShowForm(!showForm); resetForm(); }} className="btn-primary"><Plus size={16} /> Add Client</button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3 mb-2">
          <div>
            <h2 className="section-title">Client Master</h2>
            <p className="text-xs text-surface-500 mt-0.5">Manage corporate client accounts and delivery destinations ({clients.length} total)</p>
          </div>
          <button onClick={() => { setShowForm(!showForm); resetForm(); }} className="btn-primary">
            <Plus size={16} /> Add Client
          </button>
        </div>
      )}

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
            placeholder="Search clients..."
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
              <h2 className="text-base font-semibold text-surface-900">{editId ? 'Edit' : 'Add'} Client</h2>
              <button onClick={() => setShowForm(false)} className="btn-ghost btn-sm"><X size={16} /></button>
            </div>
            <form onSubmit={handleSubmit}>
              <div className="modal-body space-y-4">
                <div className="space-y-1.5"><label className="input-label">Client Name *</label><input className="input" value={name} onChange={e => setName(e.target.value)} required /></div>
                <div className="form-grid">
                  <div className="space-y-1.5"><label className="input-label">Contact Person</label><input className="input" value={contact} onChange={e => setContact(e.target.value)} /></div>
                  <div className="space-y-1.5"><label className="input-label">Email</label><input className="input" type="email" value={email} onChange={e => setEmail(e.target.value)} /></div>
                  <div className="space-y-1.5"><label className="input-label">Phone</label><input className="input" value={phone} onChange={e => setPhone(e.target.value)} /></div>
                  <div className="space-y-1.5"><label className="input-label">GST Number</label><input className="input" value={gst} onChange={e => setGst(e.target.value)} /></div>
                </div>
                <div className="space-y-1.5"><label className="input-label">Address</label><textarea className="input" rows={2} value={address} onChange={e => setAddress(e.target.value)} /></div>
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
              <tr><th>Name</th><th>Contact</th><th>Email</th><th>Phone</th><th>GST</th><th>Status</th><th>Actions</th></tr>
            </thead>
            <tbody>
              {filteredClients.map(c => (
                <tr key={c.id}>
                  <td><div className="font-medium text-surface-800">{c.name}</div></td>
                  <td className="text-sm">{c.contact_person || '-'}</td>
                  <td className="text-sm">{c.email || '-'}</td>
                  <td className="text-sm">{c.phone || '-'}</td>
                  <td><span className="font-mono text-xs bg-surface-100 px-2 py-1 rounded-lg">{c.gst_number || '-'}</span></td>
                  <td>{c.is_active ? <span className="badge badge-success">Active</span> : <span className="badge badge-danger">Inactive</span>}</td>
                  <td>
                    <div className="flex gap-1">
                      <button onClick={() => handleEdit(c)} className="btn-ghost btn-sm" title="Edit client"><Pencil size={14} /></button>
                      <button onClick={() => handleDelete(c.id)} className="btn-ghost btn-sm text-rose-500" title="Delete client"><Trash2 size={14} /></button>
                    </div>
                  </td>
                </tr>
              ))}
              {filteredClients.length === 0 && (
                <tr><td colSpan={7}><div className="empty-state"><div className="empty-icon"><Handshake size={24} className="text-surface-400" /></div><div className="empty-title">{search ? 'No matching clients found' : 'No clients added'}</div><div className="empty-desc">{search ? 'Try a different search term' : 'Add your first client to get started'}</div></div></td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
