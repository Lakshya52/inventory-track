import { useEffect, useMemo, useState, FormEvent } from 'react';
import { api } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { User } from '../types';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import {
  Users as UsersIcon,
  Plus,
  Search,
  Pencil,
  Trash2,
  X,
  KeyRound,
  Power,
  ShieldCheck,
  UserCheck,
  UserX,
  Mail,
  Shield,
  UserPlus,
} from 'lucide-react';

const ROLE_OPTIONS = [
  { value: 'ADMIN', label: 'Admin (Full Access)' },
  { value: 'QC', label: 'QC Person (Quality Control)' },
  { value: 'DISPATCH', label: 'Dispatch Person (Loading & Shipping)' },
] as const;

type RoleValue = typeof ROLE_OPTIONS[number]['value'];

const roleBadgeStyle: Record<string, { bg: string; text: string; label: string }> = {
  ADMIN: { bg: 'bg-purple-100 border-purple-200 text-purple-900', text: 'text-purple-700', label: 'Administrator' },
  QC: { bg: 'bg-blue-100 border-blue-200 text-blue-900', text: 'text-blue-700', label: 'QC Team' },
  DISPATCH: { bg: 'bg-amber-100 border-amber-200 text-amber-900', text: 'text-amber-700', label: 'Dispatch Team' },
};

function apiType(role: string): string {
  return role.toLowerCase();
}

export default function Users() {
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState<User[]>([]);
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, 250);
  const [roleFilter, setRoleFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const [showAdd, setShowAdd] = useState(false);
  const [addForm, setAddForm] = useState({ name: '', email: '', password: '', role: 'QC' as RoleValue });
  const [addError, setAddError] = useState('');
  const [saving, setSaving] = useState(false);

  const [editUser, setEditUser] = useState<User | null>(null);
  const [editForm, setEditForm] = useState({ name: '', email: '', role: 'QC' as RoleValue });
  const [editError, setEditError] = useState('');

  const [passwordUser, setPasswordUser] = useState<User | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');

  const loadUsers = async () => {
    try {
      setUsers(await api.users.list());
      setError('');
    } catch (err: any) {
      setError(err.message || 'Unable to load users');
    }
  };

  useEffect(() => {
    void loadUsers();
  }, []);

  // Listen for Escape key to close modals
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setShowAdd(false);
        setEditUser(null);
        setPasswordUser(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const filtered = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
    return users.filter((u) => {
      const matchesSearch = !q || u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q);
      const matchesRole = roleFilter === 'ALL' || u.role === roleFilter;
      const matchesStatus =
        statusFilter === 'all' ||
        (statusFilter === 'active' && u.is_active === 1) ||
        (statusFilter === 'inactive' && u.is_active === 0);
      return matchesSearch && matchesRole && matchesStatus;
    });
  }, [users, debouncedSearch, roleFilter, statusFilter]);

  const activeCount = users.filter((u) => u.is_active === 1).length;
  const adminCount = users.filter((u) => u.role === 'ADMIN').length;

  const isSelf = (u: User) => u.role === currentUser?.role && String(u.id) === String(currentUser?.id);

  const handleAdd = async (e: FormEvent) => {
    e.preventDefault();
    setAddError('');
    setSaving(true);
    try {
      await api.users.add({ ...addForm, name: addForm.name.trim(), email: addForm.email.trim().toLowerCase() });
      await loadUsers();
      setShowAdd(false);
      setAddForm({ name: '', email: '', password: '', role: 'QC' });
      setNotice('User added successfully');
    } catch (err: any) {
      setAddError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const openEdit = (u: User) => {
    setEditUser(u);
    setEditForm({ name: u.name, email: u.email, role: u.role as RoleValue });
    setEditError('');
  };

  const handleEdit = async (e: FormEvent) => {
    e.preventDefault();
    if (!editUser) return;
    setEditError('');
    setSaving(true);
    try {
      await api.users.update(apiType(editUser.role), editUser.id, {
        name: editForm.name.trim(),
        email: editForm.email.trim().toLowerCase(),
        role: editForm.role,
      });
      await loadUsers();
      setEditUser(null);
      setNotice('User updated successfully');
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
      setNotice('Password updated successfully');
    } catch (err: any) {
      setPasswordError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = async (u: User) => {
    if (isSelf(u)) return;
    const next = u.is_active === 1 ? false : true;
    try {
      await api.users.setStatus(apiType(u.role), u.id, next);
      setNotice(`User account ${next ? 'activated' : 'deactivated'}`);
      await loadUsers();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleDelete = async (u: User) => {
    if (isSelf(u)) return;
    if (!window.confirm(`Permanently delete account for "${u.name}" (${u.email})?`)) return;
    try {
      await api.users.delete(apiType(u.role), u.id);
      setNotice('User deleted successfully');
      await loadUsers();
    } catch (err: any) {
      setError(err.message);
    }
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* 1. PAGE HEADER */}
      <div className="bg-white rounded-2xl border-2 border-slate-200 p-5 sm:p-6 shadow-xs flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-brand-100 text-brand-700 flex items-center justify-center shrink-0">
            <UsersIcon size={24} />
          </div>
          <div>
            <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
              User Management
            </h1>
            <p className="text-sm sm:text-base text-slate-500 mt-0.5">
              Add team members, assign access roles (Admin, QC, Dispatch), and manage login credentials.
            </p>
          </div>
        </div>

        <button
          onClick={() => {
            setShowAdd(true);
            setAddError('');
          }}
          className="inline-flex items-center gap-2 px-5 py-2.5 bg-brand-600 hover:bg-brand-700 text-white text-sm font-bold rounded-xl transition-colors shadow-sm shrink-0"
        >
          <UserPlus size={18} />
          <span>Add New User</span>
        </button>
      </div>

      {/* 2. STATS CARDS */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Total Users', value: users.length, icon: <UsersIcon size={20} />, bg: 'bg-blue-100 text-blue-700' },
          { label: 'Active Accounts', value: activeCount, icon: <UserCheck size={20} />, bg: 'bg-emerald-100 text-emerald-700' },
          { label: 'Deactivated', value: users.length - activeCount, icon: <UserX size={20} />, bg: 'bg-rose-100 text-rose-700' },
          { label: 'Administrators', value: adminCount, icon: <ShieldCheck size={20} />, bg: 'bg-purple-100 text-purple-700' },
        ].map((card) => (
          <div key={card.label} className="bg-white rounded-2xl border-2 border-slate-200 p-5 shadow-xs">
            <div className="flex items-center gap-2.5 mb-2">
              <div className={`w-9 h-9 rounded-xl ${card.bg} flex items-center justify-center`}>
                {card.icon}
              </div>
              <span className="text-xs sm:text-sm font-bold text-slate-600 uppercase tracking-wide">
                {card.label}
              </span>
            </div>
            <div className="text-3xl font-black text-slate-900 mt-1">{card.value}</div>
          </div>
        ))}
      </div>

      {notice && (
        <div className="p-4 rounded-xl text-sm font-semibold bg-emerald-50 text-emerald-800 border-2 border-emerald-200 flex items-center justify-between">
          <span>{notice}</span>
          <button onClick={() => setNotice('')} className="text-emerald-700 hover:text-emerald-900">
            <X size={18} />
          </button>
        </div>
      )}

      {error && (
        <div className="p-4 rounded-xl text-sm font-semibold bg-rose-50 text-rose-800 border-2 border-rose-200 flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError('')} className="text-rose-700 hover:text-rose-900">
            <X size={18} />
          </button>
        </div>
      )}

      {/* 3. SEARCH & FILTERS BAR */}
      <div className="bg-white rounded-2xl border-2 border-slate-200 p-4 shadow-xs flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[240px]">
          <Search size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            className="w-full pl-10 pr-3.5 py-2 rounded-xl border border-slate-200 bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-500 text-sm text-slate-800 placeholder-slate-400 font-medium"
            placeholder="Search by user name or email..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <select
          className="px-3.5 py-2 rounded-xl border border-slate-200 bg-slate-50 focus:bg-white text-sm font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-brand-500"
          value={roleFilter}
          onChange={(e) => setRoleFilter(e.target.value)}
        >
          <option value="ALL">All Roles</option>
          {ROLE_OPTIONS.map((role) => (
            <option key={role.value} value={role.value}>
              {role.label}
            </option>
          ))}
        </select>

        <div className="flex gap-1 p-1 bg-slate-100 rounded-xl">
          {(['all', 'active', 'inactive'] as const).map((status) => (
            <button
              key={status}
              onClick={() => setStatusFilter(status)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold capitalize transition-all ${
                statusFilter === status
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {status}
            </button>
          ))}
        </div>
      </div>

      {/* 4. USER LIST TABLE */}
      <div className="bg-white rounded-2xl border-2 border-slate-200 overflow-hidden shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 border-b-2 border-slate-200 text-slate-600 font-bold uppercase text-xs tracking-wider">
              <tr>
                <th className="px-6 py-4">User Details</th>
                <th className="px-6 py-4">Assigned Role</th>
                <th className="px-6 py-4">Account Status</th>
                <th className="px-6 py-4">Created Date</th>
                <th className="px-6 py-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map((u) => {
                const self = isSelf(u);
                const roleBadge = roleBadgeStyle[u.role] || {
                  bg: 'bg-slate-100 text-slate-800 border-slate-200',
                  label: u.role,
                };

                return (
                  <tr key={`${u.role}-${u.id}`} className="hover:bg-slate-50/80 transition-colors">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3.5">
                        <div className="w-10 h-10 rounded-full bg-brand-100 text-brand-700 flex items-center justify-center text-sm font-black shrink-0">
                          {u.name.charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <div className="font-bold text-slate-900 text-base flex items-center gap-2">
                            {u.name}
                            {self && (
                              <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-brand-100 text-brand-800 border border-brand-200">
                                You
                              </span>
                            )}
                          </div>
                          <div className="text-sm text-slate-500 flex items-center gap-1.5 mt-0.5 font-medium">
                            <Mail size={14} className="text-slate-400" />
                            {u.email}
                          </div>
                        </div>
                      </div>
                    </td>

                    <td className="px-6 py-4">
                      <span className={`inline-block px-3 py-1 rounded-full text-xs font-bold border ${roleBadge.bg}`}>
                        {roleBadge.label}
                      </span>
                    </td>

                    <td className="px-6 py-4">
                      {u.is_active === 1 ? (
                        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800 border border-emerald-300">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                          Active
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-rose-100 text-rose-800 border border-rose-300">
                          <span className="w-1.5 h-1.5 rounded-full bg-rose-500" />
                          Deactivated
                        </span>
                      )}
                    </td>

                    <td className="px-6 py-4 text-sm font-medium text-slate-500">
                      {u.created_at ? new Date(u.created_at).toLocaleDateString() : '-'}
                    </td>

                    <td className="px-6 py-4 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          onClick={() => openEdit(u)}
                          className="p-2 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors"
                          title="Edit User Details"
                        >
                          <Pencil size={17} />
                        </button>

                        <button
                          onClick={() => openPassword(u)}
                          className="p-2 text-blue-600 hover:text-blue-800 hover:bg-blue-50 rounded-lg transition-colors"
                          title="Change Password"
                        >
                          <KeyRound size={17} />
                        </button>

                        <button
                          onClick={() => handleToggle(u)}
                          disabled={self}
                          className={`p-2 rounded-lg transition-colors ${
                            self
                              ? 'opacity-25 cursor-not-allowed'
                              : u.is_active === 1
                              ? 'text-amber-600 hover:text-amber-800 hover:bg-amber-50'
                              : 'text-emerald-600 hover:text-emerald-800 hover:bg-emerald-50'
                          }`}
                          title={self ? 'You cannot deactivate yourself' : u.is_active === 1 ? 'Deactivate User' : 'Activate User'}
                        >
                          <Power size={17} />
                        </button>

                        <button
                          onClick={() => handleDelete(u)}
                          disabled={self}
                          className={`p-2 rounded-lg transition-colors ${
                            self ? 'opacity-25 cursor-not-allowed' : 'text-rose-600 hover:text-rose-800 hover:bg-rose-50'
                          }`}
                          title={self ? 'You cannot delete yourself' : 'Delete User Permanently'}
                        >
                          <Trash2 size={17} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}

              {filtered.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-12 text-center text-slate-400">
                    <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center mx-auto mb-2 text-slate-400">
                      <UsersIcon size={24} />
                    </div>
                    <p className="text-base font-bold text-slate-700">No users found</p>
                    <p className="text-sm text-slate-500 mt-0.5">Try searching for a different name or changing the role filter.</p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 5. ADD USER MODAL (Esc & X to close; outer click disabled) */}
      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="bg-white rounded-2xl border-2 border-slate-200 shadow-xl w-full max-w-lg overflow-hidden">
            <div className="p-5 border-b border-slate-100 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold text-slate-900">Add New User</h2>
                <p className="text-xs text-slate-500 mt-0.5">Create a login account for a team member</p>
              </div>
              <button
                type="button"
                onClick={() => setShowAdd(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100"
              >
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleAdd} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wide mb-1.5">
                  Access Role *
                </label>
                <select
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 bg-slate-50 focus:bg-white text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand-500"
                  value={addForm.role}
                  onChange={(e) => setAddForm({ ...addForm, role: e.target.value as RoleValue })}
                >
                  {ROLE_OPTIONS.map((role) => (
                    <option key={role.value} value={role.value}>
                      {role.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wide mb-1.5">
                  Full Name *
                </label>
                <input
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 bg-white text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand-500"
                  placeholder="e.g. Ramesh Kumar"
                  value={addForm.name}
                  onChange={(e) => setAddForm({ ...addForm, name: e.target.value })}
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wide mb-1.5">
                  Email Address *
                </label>
                <input
                  type="email"
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 bg-white text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand-500"
                  placeholder="e.g. ramesh@factory.com"
                  value={addForm.email}
                  onChange={(e) => setAddForm({ ...addForm, email: e.target.value })}
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wide mb-1.5">
                  Initial Password *
                </label>
                <input
                  type="password"
                  minLength={6}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 bg-white text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand-500"
                  placeholder="Minimum 6 characters"
                  value={addForm.password}
                  onChange={(e) => setAddForm({ ...addForm, password: e.target.value })}
                  required
                />
              </div>

              {addError && (
                <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-sm font-medium text-rose-800">
                  {addError}
                </div>
              )}

              <div className="pt-4 flex items-center justify-end gap-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowAdd(false)}
                  className="px-4 py-2 rounded-xl text-sm font-bold text-slate-600 hover:bg-slate-100"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-5 py-2 rounded-xl text-sm font-bold bg-brand-600 hover:bg-brand-700 text-white shadow-sm"
                >
                  {saving ? 'Creating...' : 'Create Account'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 6. EDIT USER MODAL */}
      {editUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="bg-white rounded-2xl border-2 border-slate-200 shadow-xl w-full max-w-lg overflow-hidden">
            <div className="p-5 border-b border-slate-100 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold text-slate-900">Edit User Details</h2>
                <p className="text-xs text-slate-500 mt-0.5">Update team member name, email or access role</p>
              </div>
              <button
                type="button"
                onClick={() => setEditUser(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100"
              >
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleEdit} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wide mb-1.5">
                  Access Role *
                </label>
                <select
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 bg-slate-50 focus:bg-white text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand-500"
                  value={editForm.role}
                  onChange={(e) => setEditForm({ ...editForm, role: e.target.value as RoleValue })}
                  disabled={String(editUser.id) === String(currentUser?.id) && editUser.role === currentUser?.role}
                >
                  {ROLE_OPTIONS.map((role) => (
                    <option key={role.value} value={role.value}>
                      {role.label}
                    </option>
                  ))}
                </select>
                {String(editUser.id) === String(currentUser?.id) && editUser.role === currentUser?.role && (
                  <p className="text-xs text-slate-400 mt-1">You cannot change your own admin role.</p>
                )}
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wide mb-1.5">
                  Full Name *
                </label>
                <input
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 bg-white text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand-500"
                  value={editForm.name}
                  onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wide mb-1.5">
                  Email Address *
                </label>
                <input
                  type="email"
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 bg-white text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand-500"
                  value={editForm.email}
                  onChange={(e) => setEditForm({ ...editForm, email: e.target.value })}
                  required
                />
              </div>

              {editError && (
                <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-sm font-medium text-rose-800">
                  {editError}
                </div>
              )}

              <div className="pt-4 flex items-center justify-end gap-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setEditUser(null)}
                  className="px-4 py-2 rounded-xl text-sm font-bold text-slate-600 hover:bg-slate-100"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-5 py-2 rounded-xl text-sm font-bold bg-brand-600 hover:bg-brand-700 text-white shadow-sm"
                >
                  {saving ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 7. CHANGE PASSWORD MODAL */}
      {passwordUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="bg-white rounded-2xl border-2 border-slate-200 shadow-xl w-full max-w-md overflow-hidden">
            <div className="p-5 border-b border-slate-100 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold text-slate-900">Change Password</h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Reset password for <strong className="text-slate-800">{passwordUser.name}</strong>
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPasswordUser(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100"
              >
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handlePassword} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wide mb-1.5">
                  New Password *
                </label>
                <input
                  type="password"
                  minLength={6}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 bg-white text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand-500"
                  placeholder="Minimum 6 characters"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  required
                />
              </div>

              {passwordError && (
                <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-sm font-medium text-rose-800">
                  {passwordError}
                </div>
              )}

              <div className="pt-4 flex items-center justify-end gap-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setPasswordUser(null)}
                  className="px-4 py-2 rounded-xl text-sm font-bold text-slate-600 hover:bg-slate-100"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-5 py-2 rounded-xl text-sm font-bold bg-brand-600 hover:bg-brand-700 text-white shadow-sm"
                >
                  {saving ? 'Updating...' : 'Set Password'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
