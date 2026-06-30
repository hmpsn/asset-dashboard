// src/components/client/DecisionDetailModal.tsx
import { useState, useEffect, useCallback } from 'react';
import { X } from 'lucide-react';
import { Button, IconButton } from '../ui';
import type { NormalizedDecision, FlaggedItem } from '../../../shared/types/decision';
import type { ApprovalBatch } from '../../../shared/types/approvals';
import type { ClientAction, AeoChangePayload, CannibalizationPayload, InternalLinkPayload, RedirectProposalPayload } from '../../../shared/types/client-actions';
import {
  ApprovalItemRow,
  AeoRenderer,
  InternalLinkRenderer,
  RedirectRenderer,
  CannibalizationRenderer,
} from './decision-renderers';

// ── Main component ─────────────────────────────────────────────────────────

interface DecisionDetailModalProps {
  decision: NormalizedDecision;
  originalData:
    | { type: 'client_action'; action: ClientAction }
    | { type: 'approval_batch'; batch: ApprovalBatch };
  onApprove: (flaggedItems: FlaggedItem[]) => Promise<void>;
  onDismiss: () => void;
  submitting?: boolean;
}

export function DecisionDetailModal({
  decision,
  originalData,
  onApprove,
  onDismiss,
  submitting = false,
}: DecisionDetailModalProps) {
  const [flaggedItems, setFlaggedItems] = useState<Map<string, string>>(new Map());

  const flagItem = useCallback((id: string, note: string) => {
    setFlaggedItems((prev) => new Map(prev).set(id, note));
  }, []);

  const unflagItem = useCallback((id: string) => {
    setFlaggedItems((prev) => {
      const m = new Map(prev);
      m.delete(id);
      return m;
    });
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        target.isContentEditable
      )
        return;
      if (e.key === 'Escape') onDismiss();
    };
    document.addEventListener('keydown', handler); // keydown-ok — isContentEditable guard is in the handler body above
    return () => document.removeEventListener('keydown', handler);
  }, [onDismiss]);

  const totalItems = decision.itemCount;
  const flaggedCount = flaggedItems.size;
  const unflaggedCount = totalItems - flaggedCount;

  const handleApprove = async () => {
    const flaggedList: FlaggedItem[] = Array.from(flaggedItems.entries()).map(
      ([itemId, note]) => ({ itemId, note }),
    );
    await onApprove(flaggedList);
  };

  let body: React.ReactNode;

  if (originalData.type === 'approval_batch') {
    const { batch } = originalData;
    body = (
      <div>
        {batch.items.map((item) => (
          <ApprovalItemRow
            key={item.id}
            item={item}
            flagged={flaggedItems.has(item.id)}
            onFlag={(note) => flagItem(item.id, note)}
            onUnflag={() => unflagItem(item.id)}
          />
        ))}
      </div>
    );
  } else {
    const { action } = originalData;
    const p = action.payload as unknown;
    if (action.sourceType === 'aeo_change') {
      body = <AeoRenderer payload={p as AeoChangePayload} />;
    } else if (action.sourceType === 'internal_link') {
      body = <InternalLinkRenderer payload={p as InternalLinkPayload} />;
    } else if (action.sourceType === 'redirect_proposal') {
      body = <RedirectRenderer payload={p as RedirectProposalPayload} />;
    } else if (action.sourceType === 'cannibalization') {
      body = <CannibalizationRenderer payload={p as CannibalizationPayload} />;
    } else {
      body = (
        <pre className="t-caption text-[var(--brand-text-muted)] overflow-auto">
          {JSON.stringify(action.payload, null, 2)}
        </pre>
      );
    }
  }

  const ctaLabel = submitting
    ? 'Submitting…'
    : flaggedCount > 0
      ? `Looks good — implement ${unflaggedCount} of ${totalItems} →`
      : `Looks good — implement ${totalItems} →`;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="decision-modal-title"
      className="fixed inset-0 z-[var(--z-modal-fullscreen)] flex flex-col" // fixed-inset-ok — full-screen trust-first panel; escape key + backdrop click handled in component body
    >
      <div
        className="absolute inset-0 bg-black/80 backdrop-blur-sm"
        onClick={onDismiss}
      />
      <div
        className="relative z-[var(--z-sticky)] flex flex-col h-full max-w-3xl mx-auto w-full bg-[var(--surface-1)] shadow-2xl overflow-hidden"
        style={{ borderRadius: `0 0 var(--radius-xl) var(--radius-xl)` }}
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-6 py-4 border-b border-[var(--brand-border)] flex-shrink-0">
          <IconButton
            autoFocus
            onClick={onDismiss}
            icon={X}
            label="Close"
            size="sm"
            variant="ghost"
            className="p-1.5 rounded-[var(--radius-md)] hover:bg-[var(--surface-3)] transition-colors"
          />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-0.5">
              <span className="t-caption-sm font-medium px-2 py-0.5 rounded-[var(--radius-pill)] bg-[var(--surface-3)] text-[var(--brand-text-muted)] border border-[var(--brand-border)]">
                {decision.badge}
              </span>
              {decision.priority === 'high' && (
                <span className="t-caption-sm font-medium text-accent-warning">High priority</span>
              )}
            </div>
            <h2
              id="decision-modal-title"
              className="t-h2 text-[var(--brand-text-bright)] truncate"
            >
              {decision.title}
            </h2>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5">{body}</div>

        {/* Footer */}
        <div className="flex-shrink-0 px-6 py-4 border-t border-[var(--brand-border)] bg-[var(--surface-2)] space-y-2">
          <Button
            variant="primary"
            className="w-full"
            disabled={submitting}
            onClick={handleApprove}
          >
            {ctaLabel}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={onDismiss}
            className="w-full t-caption text-[var(--brand-text-muted)] hover:text-[var(--brand-text)] transition-colors py-1"
          >
            Save for later
          </Button>
        </div>
      </div>
    </div>
  );
}
