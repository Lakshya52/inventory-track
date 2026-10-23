import { useEffect, useMemo, useState, FormEvent } from 'react';
import { api } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { User } from '../types';
import {
  Users as UsersIcon, Plus, Search, Pencil, Trash2, X, KeyRound,
  Power, ShieldCheck, UserCheck, UserX, Mail,
} from 'lucide-react';

const ROLE_OPTIONS = [
  { value: 'ADMIN', label: 'Admin' },
  { value: 'QC', label: 'QC Person' },
  { value: 'DISPATCH', label: 'Dispatch Person' },
] as const;

type RoleValue = typeof ROLE_OPTIONS[number]['value'];

const roleBadge: Record<string, string> = {
  ADMIN: 'badge-purple',
  QC: 'badge-info',
  DISPATCH: 'badge-warning',
};

function apiType(role: string): string {
  return role.toLowerCase();
}

export default function Users() {
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState<User[]>([]);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const [showAdd, setShowAdd] = useState(false);
  const [addForm, setAddForm] = useState({ name: '', email: '', password: '', role: 'QC' as RoleValue });
  const [addError, setAddError] = useState('');
  const [saving, setSaving] = useState(false);

  const [editUser, setEditUser] = useState<User | null>(null);
  const [editForm, setEditForm] = useState({ name: '', email: '' });
  const [editError, setEditError] = useState('');

  const [passwordUser, setPasswordUser] = useState<User | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');

  const loadUsers = () => {
    api.users.list().then(setUsers).catch(err => setError(err.message));
  };

  useEffect(() => { loadUsers(); }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return users.filter(u => {
      const matchesSearch = !q || u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q);
      const matchesRole = roleFilter === 'ALL' || u.role === roleFilter;
      const matchesStatus =
        statusFilter === 'all' ||
        (statusFilter === 'active' && u.is_active === 1) ||
        (statusFilter === 'inactive' && u.is_active === 0);
      return matchesSearch && matchesRole && matchesStatus;
    });
  }, [users, search, roleFilter, statusFilter]);

  const activeCount = users.filter(u => u.is_active === 1).length;
  const adminCount = users.filter(u => u.role === 'ADMIN').length;

  const isSelf = (u: User) => u.role === currentUser?.role && u.id === currentUser?.id;

  const handleAdd = async (e: FormEvent) => {
    e.preventDefault();
    setAddError('');
    setSaving(true);
    try {
      await api.users.add(addForm);
      setShowAdd(false);
      setAddForm({ name: '', email: '', password: '', role: 'QC' });
      setNotice('User added successfully');
      loadUsers();
    } catch (err: any) {
      setAddError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const openEdit = (u: User) => {
    setEditUser(u);
    setEditForm({ name: u.name, email: u.email });
    setEditError('');
  };

  const handleEdit = async (e: FormEvent) => {
    e.preventDefault();
    if (!editUser) return;
    setEditError('');
    setSaving(true);
    try {
      await api.users.update(apiType(editUser.role), editUser.id, editForm);
      setEditUser(null);
      setNotice('User updated successfully');
      loadUsers();
    } catch (err: any) {
      setEditError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const openPassword = (u: User) => {
    setPasswordUser(u);
    setNewPassword('');
    setPasswordError('');
  };

  const handlePassword = async (e: FormEvent) => {
    e.preventDefault();
    if (!passwordUser) return;
    setPasswordError('');
    setSaving(true);
    try {
      await api.users.changePassword(apiType(passwordUser.role), passwordUser.id, newPassword);
      setPasswordUser(null);
      setNewPassword('');
      setNotice(`Password updated for ${passwordUser.name}`);
      loadUsers();
    } catch (err: any) {
      setPasswordError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = async (u: User) => {
    const next = u.is_active !== 1;
    if (!window.confirm(`${next ? 'Activate' : 'Deactivate'} ${u.name}?`)) return;
    try {
      await api.users.setStatus(apiType(u.role), u.id, next);
      setNotice(`User ${next ? 'activated' : 'deactivated'}`);
      loadUsers();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleDelete = async (u: User) => {
    if (!window.confirm(`Delete ${u.name} (${u.email}) permanently?`)) return;
    try {
      await api.users.delete(apiType(u.role), u.id);
      setNotice('User deleted');
      loadUsers();
    } catch (err: any) {
      setError(err.message);
    }
  };

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1 className="page-title">Users</h1>
          <p className="page-subtitle">Add, edit, reset passwords, deactivate or remove system users</p>
        </div>
        <button onClick={() => { setShowAdd(true); setAddError(''); }} className="btn-primary"><Plus size={16} /> Add User</button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Total Users', value: users.length, icon: <UsersIcon size={18} />, color: 'text-brand-600', bg: 'bg-brand-50' },
          { label: 'Active', value: activeCount, icon: <UserCheck size={18} />, color: 'text-emerald-600', bg: 'bg-emerald-50' },
          { label: 'Inactive', value: users.length - activeCount, icon: <UserX size={18} />, color: 'text-rose-600', bg: 'bg-rose-50' },
          { label: 'Admins', value: adminCount, icon: <ShieldCheck size={18} />, color: 'text-violet-600', bg: 'bg-violet-50' },
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
      {error && (
        <div className="mb-4 p-3 rounded-xl text-sm bg-rose-50 text-rose-700 border border-rose-200 flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError('')} className="text-rose-600"><X size={14} /></button>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="relative flex-1 min-w-[220px] max-w-sm">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-surface-400" />
          <input className="input pl-9" placeholder="Search by name or email..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <select className="input max-w-[180px]" value={roleFilter} onChange={e => setRoleFilter(e.target.value)}>
          <option value="ALL">All roles</option>
          {ROLE_OPTIONS.map(role => <option key={role.value} value={role.value}>{role.label}</option>)}
        </select>
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
      </div>

      <div className="card">
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>User</th><th>Role</th><th>Status</th><th>Created</th><th className="text-right">Actions</th></tr>
            </thead>
            <tbody>
              {filtered.map(u => {
                const self = isSelf(u);
                return (
                  <tr key={`${u.role}-${u.id}`}>
                    <td>
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-brand-50 text-brand-600 flex items-center justify-center text-xs font-bold shrink-0">
                          {u.name.charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <div className="font-medium text-surface-800 flex items-center gap-2">
                            {u.name}
                            {self && <span className="badge badge-info">You</span>}
                          </div>
                          <div className="text-xs text-surface-400 flex items-center gap-1"><Mail size={11} />{u.email}</div>
                        </div>
                      </div>
                    </td>
                    <td><span className={`badge ${roleBadge[u.role] || 'badge-neutral'}`}>{u.role}</span></td>
                    <td>
                      {u.is_active === 1
                        ? <span className="badge badge-success">Active</span>
                        : <span className="badge badge-danger">Inactive</span>}
                    </td>
                    <td className="text-xs text-surface-400">{u.created_at ? new Date(u.created_at).toLocaleDateString() : '-'}</td>
                    <td>
                      <div className="flex items-center justify-end gap-1">
                        <button onClick={() => openEdit(u)} className="btn-ghost btn-sm" title="Edit user"><Pencil size={14} /></button>
                        <button onClick={() => openPassword(u)} className="btn-ghost btn-sm text-sky-600" title="Change password"><KeyRound size={14} /></button>
                        <button
                          onClick={() => handleToggle(u)}
                          disabled={self}
                          className={`btn-ghost btn-sm ${self ? 'opacity-30 cursor-not-allowed' : u.is_active === 1 ? 'text-amber-600' : 'text-emerald-600'}`}
                          title={self ? 'You cannot deactivate yourself' : u.is_active === 1 ? 'Deactivate user' : 'Activate user'}
                        >
                          <Power size={14} />
                        </button>
                        <button
                          onClick={() => handleDelete(u)}
                          disabled={self}
                          className={`btn-ghost btn-sm ${self ? 'opacity-30 cursor-not-allowed' : 'text-rose-500 hover:text-rose-600'}`}
                          title={self ? 'You cannot delete yourself' : 'Delete user'}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr><td colSpan={5}>
                  <div className="empty-state">
                    <div className="empty-icon"><UsersIcon size={24} className="text-surface-400" /></div>
                    <div className="empty-title">{users.length === 0 ? 'No users yet' : 'No users match your filters'}</div>
                    <div className="empty-desc">{users.length === 0 ? 'Add the first user to get started' : 'Try a different search term, role or status'}</div>
                  </div>
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showAdd && (
        <div className="modal-overlay" onClick={() => setShowAdd(false)}>
          <div className="modal-content max-w-lg" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="text-base font-semibold text-surface-900">Add User</h2>
              <button onClick={() => setShowAdd(false)} className="btn-ghost btn-sm"><X size={16} /></button>
            </div>
            <form onSubmit={handleAdd}>
              <div className="modal-body space-y-4">
                <div className="space-y-1.5">
                  <label className="input-label">Role *</label>
                  <select className="input" value={addForm.role} onChange={e => setAddForm({ ...addForm, role: e.target.value as RoleValue })}>
                    {ROLE_OPTIONS.map(role => <option key={role.value} value={role.value}>{role.label}</option>)}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className="input-label">Full Name *</label>
                  <input className="input" value={addForm.name} onChange={e => setAddForm({ ...addForm, name: e.target.value })} required />
                </div>
                <div className="space-y-1.5">
                  <label className="input-label">Email *</label>
                  <input className="input" type="email" value={addForm.email} onChange={e => setAddForm({ ...addForm, email: e.target.value })} required />
                </div>
                <div className="space-y-1.5">
                  <label className="input-label">Temporary Password *</label>
                  <input className="input" type="password" minLength={6} value={addForm.password} onChange={e => setAddForm({ ...addForm, password: e.target.value })} required />
                  <p className="text-xs text-surface-400">Minimum 6 characters. Share it with the user securely.</p>
                </div>
                {addError && <div className="text-sm text-rose-600 bg-rose-50 p-3 rounded-xl border border-rose-200">{addError}</div>}
              </div>
              <div className="modal-footer">
                <button type="button" onClick={() => setShowAdd(false)} className="btn-secondary">Cancel</button>
                <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Adding...' : 'Add User'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {editUser && (
        <div className="modal-overlay" onClick={() => setEditUser(null)}>
          <div className="modal-content max-w-lg" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h2 className="text-base font-semibold text-surface-900">Edit User</h2>
                <p className="text-xs text-surface-400 mt-0.5">{editUser.role} account</p>
              </div>
              <button onClick={() => setEditUser(null)} className="btn-ghost btn-sm"><X size={16} /></button>
            </div>
            <form onSubmit={handleEdit}>
              <div className="modal-body space-y-4">
                <div className="space-y-1.5">
                  <label className="input-label">Full Name *</label>
                  <input className="input" value={editForm.name} onChange={e => setEditForm({ ...editForm, name: e.target.value })} required />
                </div>
                <div className="space-y-1.5">
                  <label className="input-label">Email *</label>
                  <input className="input" type="email" value={editForm.email} onChange={e => setEditForm({ ...editForm, email: e.target.value })} required />
                </div>
                {editError && <div className="text-sm text-rose-600 bg-rose-50 p-3 rounded-xl border border-rose-200">{editError}</div>}
              </div>
              <div className="modal-footer">
                <button type="button" onClick={() => setEditUser(null)} className="btn-secondary">Cancel</button>
                <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Saving...' : 'Save Changes'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {passwordUser && (
        <div className="modal-overlay" onClick={() => setPasswordUser(null)}>
          <div className="modal-content max-w-md" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h2 className="text-base font-semibold text-surface-900">Change Password</h2>
                <p className="text-xs text-surface-400 mt-0.5">{passwordUser.name} · {passwordUser.email}</p>
              </div>
              <button onClick={() => setPasswordUser(null)} className="btn-ghost btn-sm"><X size={16} /></button>
            </div>
            <form onSubmit={handlePassword}>
              <div className="modal-body space-y-4">
                <div className="space-y-1.5">
                  <label className="input-label">New Password *</label>
                  <input className="input" type="password" minLength={6} value={newPassword} onChange={e => setNewPassword(e.target.value)} required />
                  <p className="text-xs text-surface-400">Minimum 6 characters.</p>
                </div>
                {passwordError && <div className="text-sm text-rose-600 bg-rose-50 p-3 rounded-xl border border-rose-200">{passwordError}</div>}
              </div>
              <div className="modal-footer">
                <button type="button" onClick={() => setPasswordUser(null)} className="btn-secondary">Cancel</button>
                <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Updating...' : 'Update Password'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
