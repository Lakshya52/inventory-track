import { useState, useEffect, FormEvent } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { api, resolveUploadUrl } from '../services/api';
import { LogoCropper } from '../components/LogoCropper';
import { User, ShieldCheck, Save, KeyRound, AlertTriangle, CheckCircle, Mail, LockKeyhole, Building2, Phone, ImagePlus } from 'lucide-react';

export default function Settings() {
  const { user, tenant, refreshUser, refreshTenant } = useAuth();
  const [name, setName] = useState(user?.name || '');
  const [companyName, setCompanyName] = useState(tenant?.name || '');
  const [companyEmail, setCompanyEmail] = useState(tenant?.email || '');
  const [companyPhone, setCompanyPhone] = useState(tenant?.phone || '');
  const [logoUrl, setLogoUrl] = useState(tenant?.logoUrl || '');
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [removeLogo, setRemoveLogo] = useState(false);
  const [cropCandidate, setCropCandidate] = useState<File | null>(null);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [savingOrganization, setSavingOrganization] = useState(false);
  const [savingLogo, setSavingLogo] = useState(false);
  const [logoPreview, setLogoPreview] = useState('');

  useEffect(() => {
    if (!logoFile) { setLogoPreview(''); return; }
    const url = URL.createObjectURL(logoFile);
    setLogoPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [logoFile]);

  useEffect(() => {
    setCompanyName(tenant?.name || '');
    setCompanyEmail(tenant?.email || '');
    setCompanyPhone(tenant?.phone || '');
    setLogoUrl(tenant?.logoUrl || '');
  }, [tenant]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setMessage('');
    setError('');

    if (newPassword && newPassword !== confirmPassword) {
      setError('New password and confirmation do not match.');
      return;
    }
    if (newPassword && newPassword.length < 6) {
      setError('New password must be at least 6 characters.');
      return;
    }

    setSaving(true);
    try {
      await api.profile.update({
        name,
        currentPassword: currentPassword || undefined,
        newPassword: newPassword || undefined,
      });
      await refreshUser();
      setMessage('Profile updated successfully.');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleOrganizationSubmit = async (e: FormEvent) => {
    e.preventDefault(); setMessage(''); setError(''); setSavingOrganization(true);
    let uploadedLogoUrl: string | null = null;
    try {
      let nextLogoUrl = removeLogo ? null : (logoUrl || null);
      if (logoFile) {
        nextLogoUrl = await api.auth.uploadLogo(logoFile);
        if (!nextLogoUrl) throw new Error('The upload completed without returning a logo URL.');
        uploadedLogoUrl = nextLogoUrl;
      }
      const updated = await api.auth.updateTenant({ name: companyName, email: companyEmail, phone: companyPhone, logoUrl: removeLogo ? null : (logoFile ? nextLogoUrl : logoUrl || null) });
      setLogoUrl(updated.logoUrl || ''); setLogoFile(null); setRemoveLogo(false);
      await refreshTenant(); setMessage('Organization details updated successfully.');
    } catch (err: any) {
      if (uploadedLogoUrl) { setLogoUrl(uploadedLogoUrl); setLogoFile(null); setRemoveLogo(false); await refreshTenant().catch(() => undefined); }
      setError(uploadedLogoUrl ? `Logo uploaded and saved, but another organization detail failed to save: ${err.message}` : (err.message || 'Could not update organization details.'));
    }
    finally { setSavingOrganization(false); }
  };

  const handleLogoCropped = async (cropped: File) => {
    setCropCandidate(null);
    setSavingLogo(true);
    setError('');
    setMessage('');
    try {
      const savedLogoUrl = await api.auth.uploadLogo(cropped);
      setLogoUrl(savedLogoUrl);
      setLogoFile(null);
      setRemoveLogo(false);
      await refreshTenant();
      setMessage('Organization logo uploaded and saved.');
    } catch (err: any) {
      setError(err.message || 'Could not save organization logo.');
    } finally {
      setSavingLogo(false);
    }
  };

  const initials = (user?.name || 'A')
    .split(' ')
    .map(w => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);

  return (
    <div className="page-container space-y-6">
      <header className="page-header">
        <div>
          <h1 className="page-title">Account Settings</h1>
          <p className="page-subtitle">Manage your profile information and sign-in security.</p>
        </div>
      </header>

      <div className="max-w-4xl space-y-6">
        {user?.role === 'ADMIN' && <form onSubmit={handleOrganizationSubmit} className="space-y-6">
          <section className="card overflow-hidden">
            <div className="card-header flex items-center gap-3"><div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-50 text-brand-600"><Building2 size={19} /></div><div><h2 className="text-base font-semibold text-surface-900">Organization details</h2><p className="mt-0.5 text-sm text-surface-500">This name and logo appear in the navigation sidebar.</p></div></div>
            <div className="card-body space-y-5">
              <div className="flex flex-wrap items-center gap-4 rounded-xl border border-surface-100 bg-surface-50 p-4">
                <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-2xl border border-surface-200 bg-white text-brand-600">{logoPreview || (logoUrl && !removeLogo) ? <img src={logoPreview || `${resolveUploadUrl(logoUrl)}?v=${encodeURIComponent(tenant?.updatedAt || String(tenant?.id || ''))}`} alt="Organization logo" className="h-full w-full object-contain" onError={() => setError('The saved logo could not be loaded from the server.')} /> : <Building2 size={26} />}</div>
                <div className="min-w-0 flex-1"><p className="font-semibold text-surface-900">{companyName || 'Your organization'}</p><p className="text-sm text-surface-500">PNG, JPG, WEBP or SVG · up to 2 MB</p></div>
                <label className={`btn-secondary cursor-pointer ${savingLogo ? 'pointer-events-none opacity-60' : ''}`}><ImagePlus size={16} />{savingLogo ? 'Saving logo…' : logoUrl ? 'Change logo' : 'Upload logo'}<input className="sr-only" type="file" accept="image/png,image/jpeg,image/webp" disabled={savingLogo} onChange={e => { const file = e.target.files?.[0]; if (!file) return; if (file.size > 2 * 1024 * 1024) { setError('Choose an image under 2 MB for your company logo.'); e.target.value = ''; return; } setError(''); setRemoveLogo(false); setCropCandidate(file); e.target.value = ''; }} /></label>
                {(logoUrl || logoFile) && <button type="button" onClick={() => { setLogoUrl(''); setLogoFile(null); setRemoveLogo(true); }} className="btn-ghost text-rose-600">Remove</button>}
              </div>
              <div className="grid gap-5 sm:grid-cols-2">
                <div><label className="input-label" htmlFor="org-name">Organization name</label><div className="relative"><Building2 size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-surface-400" /><input id="org-name" className="input pl-9" maxLength={200} value={companyName} onChange={e => setCompanyName(e.target.value)} required /></div></div>
                <div><label className="input-label" htmlFor="org-email">Organization email</label><div className="relative"><Mail size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-surface-400" /><input id="org-email" className="input pl-9" type="email" value={companyEmail} onChange={e => setCompanyEmail(e.target.value)} required /></div></div>
                <div><label className="input-label" htmlFor="org-phone">Organization phone</label><div className="relative"><Phone size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-surface-400" /><input id="org-phone" className="input pl-9" type="tel" value={companyPhone} onChange={e => setCompanyPhone(e.target.value)} required /></div></div>
              </div>
              <div className="flex justify-end border-t border-surface-100 pt-4"><button type="submit" className="btn-primary" disabled={savingOrganization || savingLogo}>{savingOrganization ? <><ShieldCheck size={16} className="animate-pulse" />Saving…</> : <><Save size={16} />Save organization</>}</button></div>
            </div>
          </section>
        </form>}
        <form onSubmit={handleSubmit} className="space-y-6">
        <section className="card overflow-hidden">
          <div className="card-header flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
              <User size={19} />
            </div>
            <div>
              <h2 className="text-base font-semibold text-surface-900">Profile information</h2>
              <p className="mt-0.5 text-sm text-surface-500">Update the name associated with your account.</p>
            </div>
          </div>
          <div className="card-body space-y-6">
            <div className="flex items-center gap-4 rounded-xl border border-surface-100 bg-surface-50 p-4">
              <div className="flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-2xl bg-brand-600 text-lg font-bold text-white">
                {initials}
              </div>
              <div className="min-w-0">
                <p className="truncate font-semibold text-surface-900">{user?.name}</p>
                <p className="mt-0.5 truncate text-sm text-surface-500">{user?.email}</p>
                <span className="badge badge-purple mt-2">{user?.role}</span>
              </div>
            </div>

            <div className="grid gap-5 sm:grid-cols-2">
              <div>
                <label className="input-label" htmlFor="settings-name">Display name</label>
                <div className="relative">
                  <User size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-surface-400" />
                  <input
                    id="settings-name"
                    className="input pl-9"
                    value={name}
                    onChange={e => setName(e.target.value)}
                    placeholder="Your full name"
                    autoComplete="name"
                    required
                  />
                </div>
              </div>
              <div>
                <label className="input-label" htmlFor="settings-email">Email address</label>
                <div className="relative">
                  <Mail size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-surface-400" />
                  <input id="settings-email" className="input cursor-not-allowed bg-surface-50 pl-9 text-surface-500" value={user?.email || ''} disabled />
                </div>
                <p className="mt-1.5 text-xs text-surface-500">Contact an administrator to change your email address.</p>
              </div>
            </div>
          </div>
        </section>

        <section className="card overflow-hidden">
          <div className="card-header flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-50 text-amber-600">
              <KeyRound size={19} />
            </div>
            <div>
              <h2 className="text-base font-semibold text-surface-900">Password &amp; security</h2>
              <p className="mt-0.5 text-sm text-surface-500">Change your password to keep your account secure.</p>
            </div>
          </div>
          <div className="card-body space-y-5">
            <div className="flex items-start gap-3 rounded-xl border border-brand-100 bg-brand-50/60 p-3.5 text-sm text-brand-800">
              <LockKeyhole size={17} className="mt-0.5 flex-shrink-0" />
              <p>Leave these fields blank if you don’t want to change your password. Your current password is required to set a new one.</p>
            </div>
            <div className="grid gap-5 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className="input-label" htmlFor="current-password">Current password</label>
                <input id="current-password" className="input" type="password" value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} placeholder="Enter your current password" autoComplete="current-password" />
              </div>
              <div>
                <label className="input-label" htmlFor="new-password">New password</label>
                <input id="new-password" className="input" type="password" minLength={6} value={newPassword} onChange={e => setNewPassword(e.target.value)} placeholder="At least 6 characters" autoComplete="new-password" />
              </div>
              <div>
                <label className="input-label" htmlFor="confirm-password">Confirm new password</label>
                <input id="confirm-password" className="input" type="password" minLength={6} value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} placeholder="Re-enter new password" autoComplete="new-password" />
              </div>
            </div>
          </div>
        </section>

        {(message || error) && (
          <div className={`flex items-center gap-2 rounded-xl border p-3.5 text-sm ${message ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-rose-200 bg-rose-50 text-rose-700'}`} role="status">
            {message ? <CheckCircle size={17} className="flex-shrink-0" /> : <AlertTriangle size={17} className="flex-shrink-0" />}
            {message || error}
          </div>
        )}

        <div className="flex justify-end border-t border-surface-200 pt-5">
          <button type="submit" className="btn-primary min-w-36" disabled={saving}>
            {saving ? <><ShieldCheck size={16} className="animate-pulse" /> Saving…</> : <><Save size={16} /> Save changes</>}
          </button>
        </div>
        </form>
        {cropCandidate && <LogoCropper file={cropCandidate} onCancel={() => setCropCandidate(null)} onComplete={cropped => { void handleLogoCropped(cropped); }} />}
      </div>
    </div>
  );
}
