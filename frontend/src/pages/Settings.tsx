import { useState, FormEvent } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { api } from '../services/api';
import { User, ShieldCheck, Save, KeyRound } from 'lucide-react';

export default function Settings() {
  const { user, refreshUser } = useAuth();
  const [name, setName] = useState(user?.name || '');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setMessage('');
    setError('');

    if (newPassword && newPassword !== confirmPassword) {
      setError('New password and confirmation do not match');
      return;
    }
    if (newPassword && newPassword.length < 6) {
      setError('New password must be at least 6 characters');
      return;
    }

    try {
      await api.profile.update({
        name,
        currentPassword: currentPassword || undefined,
        newPassword: newPassword || undefined,
      });
      await refreshUser();
      setMessage('Profile updated successfully');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err: any) {
      setError(err.message);
    }
  };

  return (
    <div className="page-container max-w-2xl mx-auto">
      <div className="page-header">
        <div>
          <h1 className="page-title">My Profile</h1>
          <p className="page-subtitle">Update your name or change your password</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="card p-6 space-y-5">
        <div className="flex items-center gap-3 pb-4 border-b border-surface-200">
          <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-brand-400 to-brand-600 flex items-center justify-center text-white font-bold text-lg">
            {user?.name?.charAt(0) || 'A'}
          </div>
          <div>
            <p className="font-semibold text-surface-800 flex items-center gap-2">
              {user?.name}
              <span className="badge badge-neutral">{user?.role}</span>
            </p>
            <p className="text-xs text-surface-400">{user?.email}</p>
          </div>
        </div>

        <div className="space-y-1.5">
          <label className="input-label flex items-center gap-1.5"><User size={13} /> Name</label>
          <input className="input" value={name} onChange={e => setName(e.target.value)} required />
        </div>

        <div className="space-y-1.5">
          <label className="input-label">Email</label>
          <input className="input bg-surface-100 text-surface-400 cursor-not-allowed" value={user?.email || ''} disabled />
          <p className="text-xs text-surface-400">Ask an administrator if your email needs to change.</p>
        </div>

        <div className="divider" />

        <div>
          <h2 className="text-sm font-semibold text-surface-800 flex items-center gap-2 mb-1"><KeyRound size={15} /> Change Password</h2>
          <p className="text-xs text-surface-400 mb-4">Leave these fields blank to keep your current password.</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="space-y-1.5">
              <label className="input-label">Current Password</label>
              <input className="input" type="password" value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <label className="input-label">New Password</label>
              <input className="input" type="password" minLength={6} value={newPassword} onChange={e => setNewPassword(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <label className="input-label">Confirm Password</label>
              <input className="input" type="password" minLength={6} value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} />
            </div>
          </div>
        </div>

        {message && (
          <div className="p-3 rounded-xl text-sm bg-emerald-50 text-emerald-700 border border-emerald-200 flex items-center gap-2">
            <ShieldCheck size={16} /> {message}
          </div>
        )}
        {error && <div className="p-3 rounded-xl text-sm bg-rose-50 text-rose-700 border border-rose-200">{error}</div>}

        <button className="btn-primary w-full"><Save size={16} /> Save Changes</button>
      </form>
    </div>
  );
}
