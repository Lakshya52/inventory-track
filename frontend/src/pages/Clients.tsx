import { useEffect, useState, FormEvent } from 'react';
import { api } from '../services/api';
import { Client } from '../types';
import { Handshake, Plus, Pencil, Trash2, X } from 'lucide-react';

export default function Clients() {
  const [clients, setClients] = useState<Client[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [name, setName] = useState('');
  const [contact, setContact] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [gst, setGst] = useState('');
  const [error, setError] = useState('');

  useEffect(() => { api.clients.list().then(setClients); }, []);

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
      api.clients.list().then(setClients);
    } catch (err: any) { setError(err.message); }
  };

  const handleDelete = async (id: number) => {
    if (!window.confirm('Delete this client?')) return;
    await api.clients.delete(id);
    api.clients.list().then(setClients);
  };

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1 className="page-title">Clients</h1>
          <p className="page-subtitle">Manage your client and customer relationships</p>
        </div>
        <button onClick={() => { setShowForm(!showForm); resetForm(); }} className="btn-primary"><Plus size={16} /> Add Client</button>
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
              {clients.map(c => (
                <tr key={c.id}>
                  <td><div className="font-medium text-surface-800">{c.name}</div></td>
                  <td className="text-sm">{c.contact_person || '-'}</td>
                  <td className="text-sm">{c.email || '-'}</td>
                  <td className="text-sm">{c.phone || '-'}</td>
                  <td><span className="font-mono text-xs bg-surface-100 px-2 py-1 rounded-lg">{c.gst_number || '-'}</span></td>
                  <td>{c.is_active ? <span className="badge badge-success">Active</span> : <span className="badge badge-danger">Inactive</span>}</td>
                  <td>
                    <div className="flex gap-1">
                      <button onClick={() => handleEdit(c)} className="btn-ghost btn-sm"><Pencil size={14} /></button>
                      <button onClick={() => handleDelete(c.id)} className="btn-ghost btn-sm text-rose-500"><Trash2 size={14} /></button>
                    </div>
                  </td>
                </tr>
              ))}
              {clients.length === 0 && (
                <tr><td colSpan={7}><div className="empty-state"><div className="empty-icon"><Handshake size={24} className="text-surface-400" /></div><div className="empty-title">No clients added</div><div className="empty-desc">Add your first client to get started</div></div></td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
