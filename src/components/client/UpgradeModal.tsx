import { Sparkles, CheckCircle2 } from 'lucide-react';
import { post } from '../../api/client';
import { STUDIO_NAME } from '../../constants';

interface Props {
  workspaceId: string;
  onClose: () => void;
  onError: (msg: string) => void;
}

export function UpgradeModal({ workspaceId, onClose, onError }: Props) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-zinc-900 border border-zinc-700 p-8 max-w-md w-full mx-4 text-center shadow-2xl" style={{ borderRadius: '10px 24px 10px 24px' }} onClick={e => e.stopPropagation()}>
        <div className="w-14 h-14 rounded-full bg-teal-500/10 border border-teal-500/20 flex items-center justify-center mx-auto mb-4">
          <Sparkles className="w-7 h-7 text-teal-400" />
        </div>
        <h3 className="text-lg font-semibold text-zinc-100 mb-2">SEO Strategy — Premium Feature</h3>
        <p className="text-sm text-zinc-400 leading-relaxed mb-6">
          Unlock your full keyword strategy with page-level keyword targets, competitor gap analysis, and growth opportunities tailored to your business.
        </p>
        <div className="space-y-2 text-left mb-6">
          {['Target keywords mapped to every page', 'Competitor keyword gap analysis', 'Content opportunity recommendations', `Ongoing strategy refinement by ${STUDIO_NAME}`].map(f => (
            <div key={f} className="flex items-center gap-2 text-xs text-zinc-300">
              <CheckCircle2 className="w-3.5 h-3.5 text-teal-400 flex-shrink-0" />
              {f}
            </div>
          ))}
        </div>
        <button onClick={async () => {
          try {
            const data = await post<{ url?: string }>(`/api/public/upgrade-checkout/${workspaceId}`, { planId: 'premium' });
            if (data.url) window.location.href = data.url;
          } catch (err) {
            onError(err instanceof Error ? err.message : 'Upgrade failed. Please try again.');
          }
        }}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-teal-600 hover:bg-teal-500 text-white text-sm font-medium transition-colors cursor-pointer">
          <Sparkles className="w-4 h-4" /> Upgrade to Premium
        </button>
        <button onClick={onClose} className="block mx-auto mt-3 text-xs text-zinc-500 hover:text-zinc-400 transition-colors">
          Maybe later
        </button>
      </div>
    </div>
  );
}
