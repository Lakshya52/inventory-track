import { useEffect, useMemo, useState, FormEvent } from 'react';
import { api } from '../services/api';
import { Vendor } from '../types';
import {
  Handshake, Plus, Search, Pencil, Trash2, X, Power, Building2,
  Mail, Phone, MapPin, BadgeCheck,
} from 'lucide-react';

const emptyForm = {
  name: '',
  contact_person: '',
  email: '',
  phone: '',
  address: '',
  gst_number: '',
  category: '',
  payment_terms: '',
  notes: '',
  is_active: true,
};

export default function Vendors() {
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false);

  const loadVendors = () => {
    api.vendors.list().then(setVendors).catch(err => setError(err.message));
  };

  useEffect(() => { loadVendors(); }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return vendors.filter(v => {
      const matchesSearch = !q || [v.name, v.vendor_code, v.contact_person, v.email, v.phone, v.gst_number, v.category]
        .some(value => (value || '').toLowerCase().includes(q));
      const matchesStatus =
        statusFilter === 'all' ||
        (statusFilter === 'active' && v.is_active === 1) ||
        (statusFilter === 'inactive' && v.is_active === 0);
      return matchesSearch && matchesStatus;
    });
  }, [vendors, search, statusFilter]);

  const activeCount = vendors.filter(v => v.is_active === 1).length;

  const resetForm = () => {
    setForm(emptyForm);
    setEditId(null);
    setError('');
  };

  const openCreate = () => {
    resetForm();
    setNotice('');
    setShowForm(true);
  };

  const openEdit = (vendor: Vendor) => {
    setForm({
      name: vendor.name,
      contact_person: vendor.contact_person || '',
      email: vendor.email || '',
      phone: vendor.phone || '',
      address: vendor.address || '',
      gst_number: vendor.gst_number || '',
      category: vendor.category || '',
      payment_terms: vendor.payment_terms || '',
      notes: vendor.notes || '',
      is_active: vendor.is_active === 1,
    });
    setEditId(vendor.id);
    setError('');
    setNotice('');
    setShowForm(true);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      if (editId) {
        await api.vendors.update(editId, form);
        setNotice('Vendor updated successfully');
      } else {
        await api.vendors.create(form);
        setNotice('Vendor added successfully');
      }
      setShowForm(false);
      resetForm();
      loadVendors();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = async (vendor: Vendor) => {
    const next = vendor.is_active !== 1;
    if (!window.confirm(`${next ? 'Activate' : 'Deactivate'} "${vendor.name}"?`)) return;
    try {
      await api.vendors.setStatus(vendor.id, next);
      setNotice(`Vendor ${next ? 'activated' : 'deactivated'}`);
      loadVendors();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleDelete = async (vendor: Vendor) => {
    if (!window.confirm(`Delete vendor "${vendor.name}" permanently? This cannot be undone.`)) return;
    try {
      await api.vendors.delete(vendor.id);
      setNotice('Vendor deleted');
      loadVendors();
    } catch (err: any) {
      setError(err.message);
    }
  };

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1 className="page-title">Vendors</h1>
          <p className="page-subtitle">Add, update, deactivate and remove vendor records</p>
        </div>
        <button onClick={openCreate} className="btn-primary"><Plus size={16} /> Add Vendor</button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Total Vendors', value: vendors.length, icon: <Handshake size={18} />, color: 'text-brand-600', bg: 'bg-brand-50' },
          { label: 'Active', value: activeCount, icon: <BadgeCheck size={18} />, color: 'text-emerald-600', bg: 'bg-emerald-50' },
          { label: 'Inactive', value: vendors.length - activeCount, icon: <Power size={18} />, color: 'text-rose-600', bg: 'bg-rose-50' },
          { label: 'Categories', value: new Set(vendors.map(v => v.category).filter(Boolean)).size, icon: <Building2 size={18} />, color: 'text-violet-600', bg: 'bg-violet-50' },
        ].map(card => (
          <div key={card.label} className="card p-5">
            <div className="flex items-center gap-2 mb-2">
              <div className={`w-8 h-8 rounded-xl ${card.bg} ${card.color} flex items-center justify-center`}>{card.icon}</div>
              <span className="text-xs font-medium text-surface-500 uppercase tracking-wider">{card.label}</span>
            </div>
            <div className="text-2xl font-bold text-surface-900">{card.value}</div>
          </div>
        ))}
      </div>

      {notice && (
        <div className="mb-4 p-3 rounded-xl text-sm bg-emerald-50 text-emerald-700 border border-emerald-200 flex items-center justify-between">
          <span>{notice}</span>
          <button onClick={() => setNotice('')} className="text-emerald-600"><X size={14} /></button>
        </div>
      )}
      {error && !showForm && (
        <div className="mb-4 p-3 rounded-xl text-sm bg-rose-50 text-rose-700 border border-rose-200 flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError('')} className="text-rose-600"><X size={14} /></button>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="relative flex-1 min-w-[220px] max-w-sm">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-surface-400" />
          <input className="input pl-9" placeholder="Search vendors..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <div className="flex gap-1 p-1 bg-surface-100 rounded-xl">
          {(['all', 'active', 'inactive'] as const).map(status => (
            <button
              key={status}
              onClick={() => setStatusFilter(status)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium capitalize transition-all ${
                statusFilter === status ? 'bg-white text-surface-900 shadow-sm' : 'text-surface-500 hover:text-surface-700'
              }`}
            >
              {status}
            </button>
          ))}
        </div>
        {(search || statusFilter !== 'all') && (
          <button onClick={() => { setSearch(''); setStatusFilter('all'); }} className="btn-ghost btn-sm">
            <X size={14} /> Clear
          </button>
        )}
      </div>

      <div className="card">
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Vendor</th><th>Contact</th><th>Email / Phone</th><th>GST</th><th>Category</th><th>Status</th><th className="text-right">Actions</th></tr>
            </thead>
            <tbody>
              {filtered.map(vendor => (
                <tr key={vendor.id}>
                  <td>
                    <div className="font-medium text-surface-800">{vendor.name}</div>
                    <div className="font-mono text-xs text-surface-400">{vendor.vendor_code}</div>
                    {vendor.vendor_code === 'SELF' && <span className="badge badge-info mt-1">Built-in plant supplier</span>}
                  </td>
                  <td className="text-sm">{vendor.contact_person || '-'}</td>
                  <td>
                    <div className="text-sm flex items-center gap-1.5"><Mail size={12} className="text-surface-400" />{vendor.email || '-'}</div>
                    <div className="text-xs text-surface-400 flex items-center gap-1.5 mt-0.5"><Phone size={12} />{vendor.phone || '-'}</div>
                  </td>
                  <td><span className="font-mono text-xs bg-surface-100 px-2 py-1 rounded-lg">{vendor.gst_number || '-'}</span></td>
                  <td className="text-sm">{vendor.category || '-'}</td>
                  <td>
                    {vendor.is_active === 1
                      ? <span className="badge badge-success">Active</span>
                      : <span className="badge badge-danger">Inactive</span>}
                  </td>
                  <td>
                    <div className="flex items-center justify-end gap-1">
                      {vendor.vendor_code === 'SELF'
                        ? <span className="text-xs text-surface-400">Always available</span>
                        : <>
                          <button onClick={() => openEdit(vendor)} className="btn-ghost btn-sm" title="Edit vendor"><Pencil size={14} /></button>
                          <button
                            onClick={() => handleToggle(vendor)}
                            className={`btn-ghost btn-sm ${vendor.is_active === 1 ? 'text-amber-600' : 'text-emerald-600'}`}
                            title={vendor.is_active === 1 ? 'Deactivate vendor' : 'Activate vendor'}
                          >
                            <Power size={14} />
                          </button>
                          <button onClick={() => handleDelete(vendor)} className="btn-ghost btn-sm text-rose-500 hover:text-rose-600" title="Delete vendor"><Trash2 size={14} /></button>
                        </>}
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={7}>
                  <div className="empty-state">
                    <div className="empty-icon"><Handshake size={24} className="text-surface-400" /></div>
                    <div className="empty-title">{vendors.length === 0 ? 'No vendors added yet' : 'No vendors match your filters'}</div>
                    <div className="empty-desc">{vendors.length === 0 ? 'Add your first vendor to get started' : 'Try a different search term or status'}</div>
                  </div>
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showForm && (
        <div className="modal-overlay" onClick={() => setShowForm(false)}>
          <div className="modal-content max-w-2xl" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h2 className="text-base font-semibold text-surface-900">{editId ? 'Edit Vendor' : 'Add Vendor'}</h2>
                <p className="text-xs text-surface-400 mt-0.5">Vendor codes are generated automatically</p>
              </div>
              <button onClick={() => setShowForm(false)} className="btn-ghost btn-sm"><X size={16} /></button>
            </div>
            <form onSubmit={handleSubmit}>
              <div className="modal-body space-y-4">
                <div className="form-grid">
                  <div className="space-y-1.5 md:col-span-2">
                    <label className="input-label">Vendor Name *</label>
                    <input className="input" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required />
                  </div>
                  <div className="space-y-1.5">
                    <label className="input-label">Contact Person</label>
                    <input className="input" value={form.contact_person} onChange={e => setForm({ ...form, contact_person: e.target.value })} />
                  </div>
                  <div className="space-y-1.5">
                    <label className="input-label">Category</label>
                    <input className="input" placeholder="Raw material, packaging..." value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} />
                  </div>
                  <div className="space-y-1.5">
                    <label className="input-label">Email</label>
                    <input className="input" type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} />
                  </div>
                  <div className="space-y-1.5">
                    <label className="input-label">Phone</label>
                    <input className="input" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} />
                  </div>
                  <div className="space-y-1.5">
                    <label className="input-label">GST Number</label>
                    <input className="input" value={form.gst_number} onChange={e => setForm({ ...form, gst_number: e.target.value })} />
                  </div>
                  <div className="space-y-1.5">
                    <label className="input-label">Payment Terms</label>
                    <input className="input" placeholder="e.g. Net 30" value={form.payment_terms} onChange={e => setForm({ ...form, payment_terms: e.target.value })} />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <label className="input-label">Address</label>
                  <textarea className="input" rows={2} value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <label className="input-label">Notes</label>
                  <textarea className="input" rows={2} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} />
                </div>
                <label className="flex items-center gap-2 text-sm text-surface-700">
                  <input type="checkbox" checked={form.is_active} onChange={e => setForm({ ...form, is_active: e.target.checked })} />
                  Vendor is active
                </label>
                {error && <div className="text-sm text-rose-600 bg-rose-50 p-3 rounded-xl border border-rose-200">{error}</div>}
              </div>
              <div className="modal-footer">
                <button type="button" onClick={() => setShowForm(false)} className="btn-secondary">Cancel</button>
                <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Saving...' : editId ? 'Update Vendor' : 'Add Vendor'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
