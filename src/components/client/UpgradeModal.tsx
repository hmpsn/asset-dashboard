import { Sparkles, CheckCircle2 } from 'lucide-react';
import { post } from '../../api/client';
import { STUDIO_NAME } from '../../constants';
import { Icon } from '../ui';
import { Modal } from '../ui/overlay/Modal';

interface Props {
  workspaceId: string;
  onClose: () => void;
  onError: (msg: string) => void;
}

export function UpgradeModal({ workspaceId, onClose, onError }: Props) {
  return (
    <Modal open onClose={onClose} size="sm">
      <Modal.Body>
        <div className="text-center">
          <div className="w-14 h-14 rounded-full bg-teal-500/10 border border-teal-500/20 flex items-center justify-center mx-auto mb-4">
            <Icon as={Sparkles} size="2xl" className="text-teal-400" />
          </div>
          <h3 className="text-lg font-semibold text-[var(--brand-text-bright)] mb-2">SEO Strategy — Premium Feature</h3>
          <p className="t-body text-[var(--brand-text)] leading-relaxed mb-6">
            Unlock your full keyword strategy with page-level keyword targets, competitor gap analysis, and growth opportunities tailored to your business.
          </p>
          <div className="space-y-2 text-left mb-6">
            {['Target keywords mapped to every page', 'Competitor keyword gap analysis', 'Content opportunity recommendations', `Ongoing strategy refinement by ${STUDIO_NAME}`].map(f => (
              <div key={f} className="flex items-center gap-2 t-caption text-[var(--brand-text)]">
                <Icon as={CheckCircle2} size="sm" className="text-teal-400 flex-shrink-0" />
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
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-[var(--radius-lg)] bg-teal-600 hover:bg-teal-500 text-white t-body font-medium transition-colors cursor-pointer">
            <Icon as={Sparkles} size="md" /> Upgrade to Premium
          </button>
          <button onClick={onClose} className="block mx-auto mt-3 t-caption text-[var(--brand-text-muted)] hover:text-[var(--brand-text)] transition-colors">
            Maybe later
          </button>
        </div>
      </Modal.Body>
    </Modal>
  );
}
