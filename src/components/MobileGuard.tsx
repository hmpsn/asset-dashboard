import { useState, useEffect } from 'react';
import { Monitor, X } from 'lucide-react';

/**
 * Shows a dismissible banner on small screens (<768px) recommending desktop.
 * Allows read-only mobile access instead of blocking entirely.
 * Stores dismissal in sessionStorage.
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
    try { sessionStorage.setItem('mobile_guard_dismissed', '1'); } catch (err) { console.error('MobileGuard operation failed:', err); }
  };

  return (
    <>
      {isMobile && !dismissed && (
        <div className="fixed top-0 left-0 right-0 z-[9999] bg-amber-500/10 border-b border-amber-500/20 px-4 py-3">
          <div className="flex items-center justify-between max-w-screen-xl mx-auto">
            <div className="flex items-center gap-2">
              <Monitor className="w-4 h-4 text-amber-400 flex-shrink-0" />
              <p className="text-xs text-amber-300">
                <span className="font-medium">Best on desktop.</span>{' '}
                <span className="text-amber-400/80">Editing tools are limited on mobile.</span>
              </p>
            </div>
            <button
              onClick={dismiss}
              className="p-1 rounded text-amber-400/60 hover:text-amber-300 hover:bg-amber-500/10 transition-colors flex-shrink-0"
              aria-label="Dismiss mobile warning"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
      <div className={isMobile && !dismissed ? 'pt-12' : ''}>
        {children}
      </div>
    </>
  );
}
