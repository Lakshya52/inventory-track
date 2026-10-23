import { useEffect, useState, FormEvent } from 'react';
import { api } from '../services/api';
import { Product } from '../types';
import { useAuth } from '../contexts/AuthContext';
import { Package, Plus, Search, Download, Upload, Pencil, Trash2, X } from 'lucide-react';

export default function Products({ readOnly = false }: { readOnly?: boolean }) {
  const { user } = useAuth();
  const canManage = !readOnly && user?.role === 'ADMIN';
  const [products, setProducts] = useState<Product[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');

  const initForm = { name: '', description: '', sku: '', price: '', quantity: '', cas_number: '', molecular_formula: '', purity: '', grade: '', storage_conditions: '', hazard_classification: '', physical_state: '', hsn_code: '', manufacturer: '' };
  const [form, setForm] = useState(initForm);

  useEffect(() => { api.products.list().then(setProducts); }, []);

  const filtered = products.filter(p =>
    !search || p.name.toLowerCase().includes(search.toLowerCase()) || p.sku.toLowerCase().includes(search.toLowerCase())
  );

  const resetForm = () => { setForm(initForm); setError(''); setEditId(null); };

  const handleEdit = (p: Product) => {
    setForm({
      name: p.name, description: p.description || '', sku: p.sku, price: String(p.price),
      quantity: String(p.quantity), cas_number: p.cas_number || '', molecular_formula: p.molecular_formula || '',
      purity: p.purity || '', grade: p.grade || '', storage_conditions: p.storage_conditions || '',
      hazard_classification: p.hazard_classification || '', physical_state: p.physical_state || '',
      hsn_code: p.hsn_code || '', manufacturer: p.manufacturer || '',
    });
    setEditId(p.id); setShowForm(true);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault(); setError('');
    try {
      const data = { ...form, price: Number(form.price) || 0, quantity: Number(form.quantity) || 0 };
      if (editId) {
        await api.products.update(editId, data);
      } else {
        await api.products.create(data);
      }
      setShowForm(false); resetForm();
      api.products.list().then(setProducts);
    } catch (err: any) { setError(err.message); }
  };

  const handleDelete = async (id: number) => {
    if (!window.confirm('Delete this product?')) return;
    await api.products.delete(id);
    api.products.list().then(setProducts);
  };

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1 className="page-title">Products</h1>
          <p className="page-subtitle">Manage your product catalog and inventory</p>
        </div>
        {canManage && <div className="flex flex-wrap gap-2">
          <button onClick={() => api.products.downloadSample()} className="btn-secondary btn-sm">
            <Download size={14} /> Sample
          </button>
          <label className="btn-secondary btn-sm cursor-pointer">
            <Upload size={14} /> Import
            <input type="file" accept=".xlsx,.xls" className="hidden" onChange={async e => { const f = e.target.files?.[0]; if (f) { try { await api.products.importExcel(f); api.products.list().then(setProducts); } catch (err: any) { alert(err.message); } } }} />
          </label>
          <button onClick={() => { setShowForm(!showForm); resetForm(); }} className="btn-primary">
            <Plus size={16} /> Add Product
          </button>
        </div>}
      </div>

      {canManage && showForm && (
        <div className="modal-overlay" onClick={() => setShowForm(false)}>
          <div className="modal-content max-w-2xl" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="text-base font-semibold text-surface-900">{editId ? 'Edit' : 'Add'} Product</h2>
              <button onClick={() => setShowForm(false)} className="btn-ghost btn-sm"><X size={16} /></button>
            </div>
            <form onSubmit={handleSubmit}>
              <div className="modal-body space-y-4">
                <div className="form-grid">
                  <div className="space-y-1.5"><label className="input-label">Name *</label><input className="input" value={form.name} onChange={e => setForm({...form, name: e.target.value})} required /></div>
                  <div className="space-y-1.5"><label className="input-label">SKU *</label><input className="input" value={form.sku} onChange={e => setForm({...form, sku: e.target.value})} required /></div>
                  <div className="space-y-1.5"><label className="input-label">Price (₹)</label><input className="input" type="number" step="0.01" value={form.price} onChange={e => setForm({...form, price: e.target.value})} /></div>
                  <div className="space-y-1.5"><label className="input-label">Quantity</label><input className="input" type="number" step="0.001" value={form.quantity} onChange={e => setForm({...form, quantity: e.target.value})} /></div>
                  <div className="space-y-1.5"><label className="input-label">CAS Number</label><input className="input" value={form.cas_number} onChange={e => setForm({...form, cas_number: e.target.value})} /></div>
                  <div className="space-y-1.5"><label className="input-label">Molecular Formula</label><input className="input" value={form.molecular_formula} onChange={e => setForm({...form, molecular_formula: e.target.value})} /></div>
                  <div className="space-y-1.5"><label className="input-label">Purity</label><input className="input" value={form.purity} onChange={e => setForm({...form, purity: e.target.value})} /></div>
                  <div className="space-y-1.5"><label className="input-label">Grade</label><input className="input" value={form.grade} onChange={e => setForm({...form, grade: e.target.value})} /></div>
                  <div className="space-y-1.5"><label className="input-label">Physical State</label><input className="input" value={form.physical_state} onChange={e => setForm({...form, physical_state: e.target.value})} /></div>
                  <div className="space-y-1.5"><label className="input-label">HSN Code</label><input className="input" value={form.hsn_code} onChange={e => setForm({...form, hsn_code: e.target.value})} /></div>
                  <div className="space-y-1.5"><label className="input-label">Manufacturer</label><input className="input" value={form.manufacturer} onChange={e => setForm({...form, manufacturer: e.target.value})} /></div>
                  <div className="space-y-1.5"><label className="input-label">Hazard Classification</label><input className="input" value={form.hazard_classification} onChange={e => setForm({...form, hazard_classification: e.target.value})} /></div>
                </div>
                <div className="space-y-1.5"><label className="input-label">Description</label><textarea className="input" rows={2} value={form.description} onChange={e => setForm({...form, description: e.target.value})} /></div>
                <div className="space-y-1.5"><label className="input-label">Storage Conditions</label><textarea className="input" rows={2} value={form.storage_conditions} onChange={e => setForm({...form, storage_conditions: e.target.value})} /></div>
                {error && <div className="text-sm text-rose-600 bg-rose-50 p-3 rounded-xl">{error}</div>}
              </div>
              <div className="modal-footer">
                <button type="button" onClick={() => setShowForm(false)} className="btn-secondary">Cancel</button>
                <button type="submit" className="btn-primary">{editId ? 'Update' : 'Create'} Product</button>
              </div>
            </form>
          </div>
        </div>
      )}

      <div className="flex items-center gap-3 mb-4">
        <div className="relative flex-1 max-w-full sm:max-w-xs">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-surface-400" />
          <input className="input pl-9" placeholder="Search products..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        {search && <button onClick={() => setSearch('')} className="btn-ghost btn-sm shrink-0"><X size={14} /> Clear</button>}
      </div>

      <div className="card">
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Name</th><th>SKU</th><th>Price</th><th>Qty</th><th>CAS</th><th>Grade</th>{canManage && <th>Actions</th>}</tr>
            </thead>
            <tbody>
              {filtered.map(p => (
                <tr key={p.id}>
                  <td><div className="font-medium text-surface-800">{p.name}</div>{p.description && <div className="text-xs text-surface-400 truncate max-w-[200px]">{p.description}</div>}</td>
                  <td><span className="font-mono text-xs bg-surface-100 px-2 py-1 rounded-lg">{p.sku}</span></td>
                  <td>{p.price > 0 ? `₹${Number(p.price).toLocaleString()}` : '-'}</td>
                  <td>{p.quantity}</td>
                  <td className="font-mono text-xs">{p.cas_number || '-'}</td>
                  <td>{p.grade || '-'}</td>
                  {canManage && <td>
                    <div className="flex gap-1">
                      <button onClick={() => handleEdit(p)} className="btn-ghost btn-sm"><Pencil size={14} /></button>
                      <button onClick={() => handleDelete(p.id)} className="btn-ghost btn-sm text-rose-500 hover:text-rose-600"><Trash2 size={14} /></button>
                    </div>
                  </td>}
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={canManage ? 7 : 6}><div className="empty-state"><div className="empty-icon"><Package size={24} className="text-surface-400" /></div><div className="empty-title">No products found</div><div className="empty-desc">{search ? 'Try a different search term' : 'No products are available yet'}</div></div></td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
