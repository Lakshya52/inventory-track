import { useState, FormEvent } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import { Package, Eye, EyeOff } from 'lucide-react';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(email, password);
      navigate('/');
    } catch (err: any) {
      setError(err.message);
    }
    setLoading(false);
  };

  return (
    <div className="min-h-screen flex flex-col sm:flex-row-reverse">
      <div className="flex-1 flex items-center justify-center p-6 sm:p-8 bg-white">
        <div className="w-full max-w-sm">
          <div className="flex items-center gap-3 mb-8">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-brand-400 to-brand-600 flex items-center justify-center text-white font-bold">
              <Package size={20} />
            </div>
            <div>
              <h1 className="text-lg font-bold text-surface-900">Aceone</h1>
              <p className="text-xs text-surface-400">Inventory Management</p>
            </div>
          </div>

          <h2 className="text-xl font-bold text-surface-900 mb-1">Welcome back</h2>
          <p className="text-sm text-surface-500 mb-8">Sign in to your account to continue</p>

          <form onSubmit={handleSubmit} className="space-y-5">
            {error && (
              <div className="flex items-center gap-2 p-3 rounded-xl bg-rose-50 border border-rose-200 text-sm text-rose-700">
                <span>⚠</span>
                <span>{error}</span>
              </div>
            )}

            <div className="space-y-1.5">
              <label className="input-label">Email</label>
              <input
                className="input"
                type="email"
                placeholder="you@company.com"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
              />
            </div>

            <div className="space-y-1.5">
              <label className="input-label">Password</label>
              <div className="relative">
                <input
                  className="input pr-10"
                  type={showPw ? 'text' : 'password'}
                  placeholder="Enter your password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  required
                />
                <button type="button" onClick={() => setShowPw(!showPw)} className="absolute right-3 top-1/2 -translate-y-1/2 text-surface-400 hover:text-surface-600">
                  {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            <button className="btn-primary w-full" type="submit" disabled={loading}>
              {loading ? 'Signing in...' : 'Sign in'}
            </button>
          </form>
        </div>
      </div>

      <div className="hidden sm:flex flex-1 bg-gradient-to-br from-navy-900 via-navy-800 to-brand-900 items-center justify-center p-12 relative overflow-hidden min-h-[200px]">
        <div className="relative text-center max-w-md">
          <div className="w-16 h-16 rounded-2xl bg-white/10 backdrop-blur-sm flex items-center justify-center mx-auto mb-6">
            <Package size={32} className="text-brand-300" />
          </div>
          <h2 className="text-2xl font-bold text-white mb-3">Factory Inventory System</h2>
          <p className="text-surface-300 text-sm leading-relaxed">
            End-to-end batch tracking, quality control, and dispatch management for chemical and pharmaceutical manufacturing.
          </p>
          <div className="mt-8 flex justify-center gap-3 flex-wrap">
            <span className="px-3 py-1.5 rounded-lg bg-white/5 text-surface-300 text-xs">Batch Tracking</span>
            <span className="px-3 py-1.5 rounded-lg bg-white/5 text-surface-300 text-xs">QC Verification</span>
            <span className="px-3 py-1.5 rounded-lg bg-white/5 text-surface-300 text-xs">Dispatch</span>
          </div>
        </div>
      </div>
    </div>
  );
}
