import { FormEvent, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Eye, EyeOff, Package, UploadCloud } from 'lucide-react';
import { api } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { LogoCropper } from '../components/LogoCropper';

export default function Register() {
  const navigate = useNavigate();
  const { register } = useAuth();
  const [form, setForm] = useState({ name: '', companyName: '', mobile: '', email: '', password: '', confirmPassword: '' });
  const [logo, setLogo] = useState<File | null>(null);
  const [cropCandidate, setCropCandidate] = useState<File | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [logoPreview, setLogoPreview] = useState('');

  useEffect(() => {
    if (!logo) { setLogoPreview(''); return; }
    const url = URL.createObjectURL(logo);
    setLogoPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [logo]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    if (form.password !== form.confirmPassword) { setError('Passwords do not match.'); return; }
    if (cropCandidate) { setError('Finish cropping your logo before creating the workspace.'); return; }
    if (logo && (!logo.type.startsWith('image/') || logo.size > 2 * 1024 * 1024)) { setError('Choose an image under 2 MB for your company logo.'); return; }
    setLoading(true);
    try {
      await register({ name: form.name, companyName: form.companyName, mobile: form.mobile, email: form.email, password: form.password });
      if (logo) {
        try {
          const logoUrl = await api.auth.uploadLogo(logo);
          await api.auth.updateTenant({ name: form.companyName, email: form.email, phone: form.mobile, logoUrl });
        } catch (logoError: any) {
          navigate('/', { replace: true, state: { logoUploadError: logoError.message || 'Logo upload failed.' } });
          return;
        }
      }
      navigate('/', { replace: true });
    } catch (err: any) { setError(err.message || 'Could not create your account.'); }
    finally { setLoading(false); }
  };

  const set = (key: keyof typeof form, value: string) => setForm(current => ({ ...current, [key]: value }));

  return (
    <div className="min-h-screen bg-surface-50 px-4 py-10 sm:flex sm:items-center sm:justify-center">
      <div className="w-full max-w-xl overflow-hidden rounded-2xl bg-white shadow-card">
        <div className="bg-gradient-to-br from-navy-900 via-navy-800 to-brand-900 px-7 py-6 text-white sm:px-9">
          <div className="mb-6 flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/10"><Package size={20} /></span>
            <span><strong className="block">Aceone</strong><small className="text-surface-300">Inventory Management</small></span>
          </div>
          <h1 className="text-2xl font-bold">Create your workspace</h1>
          <p className="mt-1 text-sm text-surface-300">Register your company and invite your QC and dispatch teams.</p>
        </div>
        <form onSubmit={submit} className="space-y-4 p-7 sm:p-9">
          {error && <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700" role="alert">{error}</div>}
          <div className="grid gap-4 sm:grid-cols-2"><div><label className="input-label" htmlFor="tenant-name">Your full name</label><input id="tenant-name" className="input" autoComplete="name" maxLength={200} value={form.name} onChange={e => set('name', e.target.value)} required /></div><div><label className="input-label" htmlFor="company-name">Company name</label><input id="company-name" className="input" autoComplete="organization" maxLength={200} value={form.companyName} onChange={e => set('companyName', e.target.value)} required /></div></div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div><label className="input-label" htmlFor="tenant-mobile">Mobile number</label><input id="tenant-mobile" className="input" type="tel" autoComplete="tel" value={form.mobile} onChange={e => set('mobile', e.target.value)} required /></div>
            <div><label className="input-label" htmlFor="tenant-email">Email address</label><input id="tenant-email" className="input" type="email" autoComplete="email" value={form.email} onChange={e => set('email', e.target.value)} required /></div>
          </div>
          <div>
            <label className="input-label" htmlFor="tenant-logo">Company logo <span className="font-normal normal-case tracking-normal text-surface-400">(optional)</span></label>
            <label htmlFor="tenant-logo" className="flex cursor-pointer items-center gap-3 rounded-xl border border-dashed border-surface-300 p-3 text-sm text-surface-600 hover:border-brand-400 hover:bg-brand-50/40">
              <UploadCloud size={18} className="text-brand-600" /><span className="min-w-0 truncate">{logo?.name || 'Choose an image (max 2 MB)'}</span>
            </label>
            <input id="tenant-logo" className="sr-only" type="file" accept="image/png,image/jpeg,image/webp" onChange={e => { const file = e.target.files?.[0]; if (!file) return; if (file.size > 2 * 1024 * 1024) { setError('Choose an image under 2 MB for your company logo.'); e.target.value = ''; return; } setError(''); setCropCandidate(file); e.target.value = ''; }} />
            {logo && <div className="mt-2 flex items-center gap-3"><img src={logoPreview} alt="Cropped logo preview" className="h-10 w-10 rounded-lg border border-surface-200 object-contain" /><span className="text-xs text-emerald-700">Logo cropped and ready</span><button type="button" className="text-xs font-semibold text-rose-600" onClick={() => setLogo(null)}>Remove</button></div>}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div><label className="input-label" htmlFor="tenant-password">Create password</label><div className="relative"><input id="tenant-password" className="input pr-10" type={showPassword ? 'text' : 'password'} minLength={12} autoComplete="new-password" value={form.password} onChange={e => set('password', e.target.value)} required /><button type="button" className="absolute right-3 top-1/2 -translate-y-1/2 text-surface-400" aria-label={showPassword ? 'Hide password' : 'Show password'} onClick={() => setShowPassword(value => !value)}>{showPassword ? <EyeOff size={16} /> : <Eye size={16} />}</button></div><p className="mt-1 text-xs text-surface-500">Use at least 12 characters.</p></div>
            <div><label className="input-label" htmlFor="tenant-confirm-password">Confirm password</label><input id="tenant-confirm-password" className="input" type={showPassword ? 'text' : 'password'} autoComplete="new-password" value={form.confirmPassword} onChange={e => set('confirmPassword', e.target.value)} required /></div>
          </div>
          <button type="submit" className="btn-primary w-full py-2.5" disabled={loading}>{loading ? 'Creating workspace…' : 'Create workspace'}</button>
          <p className="text-center text-sm text-surface-500">Already have an account? <Link className="font-semibold text-brand-600 hover:text-brand-700" to="/login">Sign in</Link></p>
        </form>
      </div>
      {cropCandidate && <LogoCropper file={cropCandidate} onCancel={() => setCropCandidate(null)} onComplete={cropped => { setLogo(cropped); setCropCandidate(null); }} />}
    </div>
  );
}
