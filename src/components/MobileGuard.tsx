import { useState, useEffect } from 'react';
import { Monitor, X } from 'lucide-react';

/**
 * Shows a dismissible interstitial on small screens (<768px)
 * recommending the desktop experience. Stores dismissal in sessionStorage.
 */
export function MobileGuard({ children }: { children: React.ReactNode }) {
  const [dismissed, setDismissed] = useState(() => {
    try { return sessionStorage.getItem('mobile_guard_dismissed') === '1'; } catch { return false; }
  });
  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' && window.innerWidth < 768);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  const dismiss = () => {
    setDismissed(true);
    try { sessionStorage.setItem('mobile_guard_dismissed', '1'); } catch { /* skip */ }
  };

  if (!isMobile || dismissed) return <>{children}</>;

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-[#0f1219] p-6">
      <div className="max-w-sm w-full text-center space-y-5">
        <div className="mx-auto w-14 h-14 rounded-2xl bg-teal-500/10 flex items-center justify-center">
          <Monitor className="w-7 h-7 text-teal-400" />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-zinc-100">Best on Desktop</h2>
          <p className="text-sm text-zinc-400 mt-2 leading-relaxed">
            This dashboard is optimized for desktop screens. For the best experience, please visit on a laptop or desktop computer.
          </p>
        </div>
        <button
          onClick={dismiss}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium bg-zinc-800 text-zinc-300 hover:bg-zinc-700 transition-colors"
        >
          <X className="w-3.5 h-3.5" />
          Continue anyway
        </button>
      </div>
    </div>
  );
}
