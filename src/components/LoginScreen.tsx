import { useState } from 'react';
import { Lock } from 'lucide-react';

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
    <div className="flex items-center justify-center h-screen bg-[#0f1219]">
      <div className="w-full max-w-sm px-6">
        <div className="flex flex-col items-center gap-3 mb-8">
          <img src="/logo.svg" alt="hmpsn.studio" className="h-9" />
          <p className="text-xs text-zinc-500">Asset Dashboard</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="relative">
            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="Enter password"
              autoFocus
              className={`w-full pl-10 pr-4 py-2.5 rounded-lg text-sm outline-none bg-zinc-900 text-zinc-200 border ${error ? 'border-red-500' : 'border-zinc-700'}`}
            />
          </div>
          {error && (
            <p className="text-xs text-red-400">Incorrect password</p>
          )}
          <button
            type="submit"
            disabled={loading || !password}
            className="w-full py-2.5 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 bg-teal-400 text-[#0f1219]"
          >
            {loading ? 'Signing in...' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  );
}
