import { useEffect, useState, FormEvent } from 'react';
import { api } from '../services/api';
import { Product } from '../types';

export default function Products() {
  const [products, setProducts] = useState<Product[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [name, setName] = useState('');
  const [sku, setSku] = useState('');
  const [description, setDescription] = useState('');
  const [price, setPrice] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    api.products.list().then(setProducts);
  }, []);

  const resetForm = () => {
    setName(''); setSku(''); setDescription(''); setPrice(''); setError(''); setEditing(null);
  };

  const openNew = () => {
    resetForm();
    setShowForm(true);
  };

  const openEdit = (p: Product) => {
    setName(p.name); setSku(p.sku); setDescription(p.description || '');
    setPrice(String(p.price || ''));
    setEditing(p);
    setShowForm(true);
    setError('');
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      const data = { name, sku, description: description || undefined, price: Number(price) || 0 };
      if (editing) {
        await api.products.update(editing.id, data);
      } else {
        await api.products.create(data);
      }
      setShowForm(false);
      resetForm();
      api.products.list().then(setProducts);
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleDelete = async (id: number, productName: string) => {
    if (!window.confirm(`Delete product "${productName}"?`)) return;
    try {
      await api.products.delete(id);
      api.products.list().then(setProducts);
    } catch (err: any) {
      setError(err.message);
    }
  };

  return (
    <div className="p-4">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold">Products</h1>
        <button onClick={() => { if (showForm) resetForm(); setShowForm(!showForm); setError(''); }} className="bg-blue-800 text-white px-4 py-2 rounded hover:bg-blue-900 text-sm">
          {showForm ? 'Cancel' : '+ New Product'}
        </button>
      </div>
      {showForm && (
        <div className='w-dvw flex items-center justify-center flex-col' >
          <h1 className='text-2xl font-bold mb-2' >
            Add Product
          </h1>
        <form onSubmit={handleSubmit} className="bg-white p-4 rounded shadow mb-4 space-y-3 max-w-md">
          <h2 className="font-semibold">{editing ? `Edit: ${editing.name}` : 'New Product'}</h2>
          <input className="w-full border p-2 rounded" placeholder="Product Name" value={name} onChange={e => setName(e.target.value)} required />
          <input className="w-full border p-2 rounded" placeholder="SKU (e.g., PRD-001)" value={sku} onChange={e => setSku(e.target.value)} required />
          <textarea className="w-full border p-2 rounded" placeholder="Description (optional)" value={description} onChange={e => setDescription(e.target.value)} />
          <input className="w-full border p-2 rounded" type="number" step="0.01" placeholder="Price (optional)" value={price} onChange={e => setPrice(e.target.value)} />
          {error && <div className="text-red-600 text-sm">{error}</div>}
          <div className="flex gap-2">
            <button className="flex-1 bg-green-700 text-white p-2 rounded hover:bg-green-800" type="submit">
              {editing ? 'Update Product' : 'Create Product'}
            </button>
            <button className="px-4 bg-gray-300 text-gray-700 rounded hover:bg-gray-400" type="button" onClick={() => { setShowForm(false); resetForm(); }}>Cancel</button>
          </div>
        </form>
        </div>
      )}
      <div className="bg-white rounded shadow overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-100">
            <tr>
              <th className="p-2 text-left">Name</th>
              <th className="p-2 text-left">SKU</th>
              <th className="p-2 text-left">Price</th>
              <th className="p-2 text-left">Created</th>
              <th className="p-2 text-left">Actions</th>
            </tr>
          </thead>
          <tbody>
            {products.map(p => (
              <tr key={p.id} className="border-t">
                <td className="p-2">{p.name}</td>
                <td className="p-2 font-mono text-xs">{p.sku}</td>
                <td className="p-2">{p.price > 0 ? `₹${Number(p.price).toLocaleString()}` : '-'}</td>
                <td className="p-2 text-xs">{new Date(p.created_at).toLocaleDateString()}</td>
                <td className="p-2">
                  <div className="flex gap-1">
                    <button onClick={() => openEdit(p)} className="bg-yellow-500 text-white px-2 py-1 rounded text-xs hover:bg-yellow-600">Edit</button>
                    <button onClick={() => handleDelete(p.id, p.name)} className="bg-red-600 text-white px-2 py-1 rounded text-xs hover:bg-red-700">Delete</button>
                  </div>
                </td>
              </tr>
            ))}
            {products.length === 0 && <tr><td colSpan={5} className="p-2 text-gray-500">No products yet</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
