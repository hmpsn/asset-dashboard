import { useState } from 'react';
import { Zap, Lock } from 'lucide-react';

interface Props {
  onLogin: (password: string) => Promise<boolean>;
}

export function LoginScreen({ onLogin }: Props) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(false);
    setLoading(true);
    const ok = await onLogin(password);
    setLoading(false);
    if (!ok) {
      setError(true);
      setPassword('');
    }
  };

  return (
    <div className="flex items-center justify-center h-screen" style={{ backgroundColor: 'var(--brand-bg)' }}>
      <div className="w-full max-w-sm px-6">
        <div className="flex flex-col items-center gap-4 mb-8">
          <div
            className="w-12 h-12 rounded-xl flex items-center justify-center"
            style={{ background: 'linear-gradient(135deg, var(--brand-mint), #1a9e8f)' }}
          >
            <Zap className="w-6 h-6 text-white" />
          </div>
          <div className="text-center">
            <h1 className="text-lg font-semibold" style={{ color: 'var(--brand-text-bright)' }}>
              hmpsn<span style={{ color: 'var(--brand-mint)' }}>.studio</span>
            </h1>
            <p className="text-xs mt-1" style={{ color: 'var(--brand-text-muted)' }}>Asset Dashboard</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="relative">
            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: 'var(--brand-text-muted)' }} />
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="Enter password"
              autoFocus
              className="w-full pl-10 pr-4 py-2.5 rounded-lg text-sm outline-none"
              style={{
                backgroundColor: 'var(--brand-bg-surface)',
                border: `1px solid ${error ? '#ef4444' : 'var(--brand-border-hover)'}`,
                color: 'var(--brand-text-bright)',
              }}
            />
          </div>
          {error && (
            <p className="text-xs text-red-400">Incorrect password</p>
          )}
          <button
            type="submit"
            disabled={loading || !password}
            className="w-full py-2.5 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
            style={{
              backgroundColor: 'var(--brand-mint)',
              color: '#0f1219',
            }}
          >
            {loading ? 'Signing in...' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  );
}
