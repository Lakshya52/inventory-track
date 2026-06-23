import { useEffect, useState, FormEvent } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { api } from '../services/api';

export default function Settings() {
  const { user } = useAuth();
  const [tab, setTab] = useState<'profile' | 'qc' | 'dispatch'>('profile');

  const [name, setName] = useState(user?.name || '');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [profileMsg, setProfileMsg] = useState('');

  const [qcUsers, setQcUsers] = useState<any[]>([]);
  const [dispatchUsers, setDispatchUsers] = useState<any[]>([]);
  const [addType, setAddType] = useState<'qc' | 'dispatch'>('qc');
  const [addName, setAddName] = useState('');
  const [addEmail, setAddEmail] = useState('');
  const [addPassword, setAddPassword] = useState('');
  const [addError, setAddError] = useState('');
  const [addMsg, setAddMsg] = useState('');

  useEffect(() => {
    if (tab === 'qc' || tab === 'dispatch') {
      api.users.list('qc').then(setQcUsers);
      api.users.list('dispatch').then(setDispatchUsers);
    }
  }, [tab]);

  const handleProfileUpdate = async (e: FormEvent) => {
    e.preventDefault();
    setProfileMsg('');
    try {
      await api.profile.update({ name, currentPassword: currentPassword || undefined, newPassword: newPassword || undefined });
      setProfileMsg('Profile updated');
      setCurrentPassword(''); setNewPassword('');
    } catch (err: any) {
      setProfileMsg(`Error: ${err.message}`);
    }
  };

  const handleAddUser = async (e: FormEvent) => {
    e.preventDefault();
    setAddError(''); setAddMsg('');
    try {
      await api.users.add(addType, { name: addName, email: addEmail, password: addPassword });
      setAddMsg(`${addType === 'qc' ? 'QC' : 'Dispatch'} user added`);
      setAddName(''); setAddEmail(''); setAddPassword('');
      const [qc, disp] = await Promise.all([api.users.list('qc'), api.users.list('dispatch')]);
      setQcUsers(qc); setDispatchUsers(disp);
    } catch (err: any) {
      setAddError(err.message);
    }
  };

  const handleDeleteUser = async (type: 'qc' | 'dispatch', id: number) => {
    if (!window.confirm(`Delete this ${type} user?`)) return;
    try {
      await api.users.delete(type, id);
      const [qc, disp] = await Promise.all([api.users.list('qc'), api.users.list('dispatch')]);
      setQcUsers(qc); setDispatchUsers(disp);
    } catch (err: any) {
      setAddError(err.message);
    }
  };

  const tabs = [
    { key: 'profile' as const, label: 'My Profile' },
    { key: 'qc' as const, label: 'QC Users' },
    { key: 'dispatch' as const, label: 'Dispatch Users' },
  ];

  return (
    <div className="p-4 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold mb-4">Settings</h1>
      <div className="flex gap-2 mb-4">
        {tabs.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)} className={`px-4 py-2 rounded text-sm ${tab === t.key ? 'bg-blue-800 text-white' : 'bg-gray-200'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'profile' && (
        <form onSubmit={handleProfileUpdate} className="bg-white p-4 rounded shadow space-y-3">
          <h2 className="font-semibold">Admin Profile</h2>
          <input className="w-full border p-2 rounded" placeholder="Name" value={name} onChange={e => setName(e.target.value)} required />
          <input className="w-full border p-2 rounded bg-gray-100" value={user?.email || ''} disabled />
          <input className="w-full border p-2 rounded" type="password" placeholder="Current password (required to change password)" value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} />
          <input className="w-full border p-2 rounded" type="password" placeholder="New password (leave blank to keep)" value={newPassword} onChange={e => setNewPassword(e.target.value)} />
          {profileMsg && <div className={`text-sm ${profileMsg.startsWith('Error') ? 'text-red-600' : 'text-green-600'}`}>{profileMsg}</div>}
          <button className="w-full bg-blue-800 text-white p-2 rounded hover:bg-blue-900" type="submit">Update Profile</button>
        </form>
      )}

      {(tab === 'qc' || tab === 'dispatch') && (
        <div className="space-y-4">
          <form onSubmit={handleAddUser} className="bg-white p-4 rounded shadow space-y-3">
            <h2 className="font-semibold">Add {tab === 'qc' ? 'QC' : 'Dispatch'} User</h2>
            <div className="flex gap-2">
              <input className="flex-1 border p-2 rounded" placeholder="Name" value={addName} onChange={e => setAddName(e.target.value)} required />
              <input className="flex-1 border p-2 rounded" type="email" placeholder="Email" value={addEmail} onChange={e => setAddEmail(e.target.value)} required />
              <input className="flex-1 border p-2 rounded" type="password" placeholder="Password" value={addPassword} onChange={e => setAddPassword(e.target.value)} required />
            </div>
            {addError && <div className="text-red-600 text-sm">{addError}</div>}
            {addMsg && <div className="text-green-600 text-sm">{addMsg}</div>}
            <button className="w-full bg-green-700 text-white p-2 rounded hover:bg-green-800" type="submit">Add User</button>
          </form>

          <div className="bg-white rounded shadow overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-100">
                <tr>
                  <th className="p-2 text-left">Name</th>
                  <th className="p-2 text-left">Email</th>
                  <th className="p-2 text-left">Actions</th>
                </tr>
              </thead>
              <tbody>
                {(tab === 'qc' ? qcUsers : dispatchUsers).map(u => (
                  <tr key={u.id} className="border-t">
                    <td className="p-2">{u.name}</td>
                    <td className="p-2">{u.email}</td>
                    <td className="p-2">
                      <button onClick={() => handleDeleteUser(tab, u.id)} className="bg-red-600 text-white px-2 py-1 rounded text-xs hover:bg-red-700">Delete</button>
                    </td>
                  </tr>
                ))}
                {(tab === 'qc' ? qcUsers : dispatchUsers).length === 0 && <tr><td colSpan={3} className="p-2 text-gray-500">No users</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
