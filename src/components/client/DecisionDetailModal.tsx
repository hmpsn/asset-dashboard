// src/components/client/DecisionDetailModal.tsx
import { useState, useEffect, useCallback } from 'react';
import { X, Flag } from 'lucide-react';
import { Button, FormInput, Icon, IconButton } from '../ui';
import type { NormalizedDecision, FlaggedItem } from '../../../shared/types/decision';
import type { ApprovalBatch, ApprovalItem } from '../../../shared/types/approvals';
import type { ClientAction, AeoChangePayload, InternalLinkPayload, RedirectProposalPayload } from '../../../shared/types/client-actions';

// ── Approval batch item row ────────────────────────────────────────────────

function ApprovalItemRow({
  item,
  flagged,
  onFlag,
  onUnflag,
}: {
  item: ApprovalItem;
  flagged: boolean;
  onFlag: (note: string) => void;
  onUnflag: () => void;
}) {
  const [flagging, setFlagging] = useState(false);
  const [note, setNote] = useState('');

  return (
    <div
      className={`py-3 border-b border-[var(--brand-border)] last:border-b-0 ${
        flagged ? 'border-l-2 border-l-amber-500/60 pl-3 -ml-3' : ''
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <p className="t-caption-sm font-medium text-[var(--brand-text-muted)] uppercase tracking-wider mb-0.5">
            {item.pageTitle || item.pageSlug} — {item.field}
          </p>
          <div className="grid grid-cols-2 gap-3 mt-1">
            <div>
              <p className="t-caption-sm text-[var(--brand-text-muted)] mb-0.5">Current</p>
              <p className="t-caption text-[var(--brand-text)] line-clamp-2">
                {item.currentValue || '—'}
              </p>
            </div>
            <div>
              <p className="t-caption-sm text-accent-brand mb-0.5">Proposed</p>
              <p className="t-caption text-[var(--brand-text)] line-clamp-2">
                {item.proposedValue}
              </p>
            </div>
          </div>
        </div>
        <div className="flex-shrink-0">
          {flagged ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={onUnflag}
              className="t-caption-sm text-accent-warning hover:text-[var(--brand-text)] transition-colors px-2 py-1"
            >
              Unflag
            </Button>
          ) : !flagging ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setFlagging(true)}
              className="flex items-center gap-1 px-2 py-1 rounded-[var(--radius-md)] t-caption-sm text-[var(--brand-text-muted)] hover:text-accent-warning hover:bg-amber-500/10 transition-colors border border-transparent hover:border-amber-500/20"
            >
              <Icon as={Flag} size="sm" />
              Flag
            </Button>
          ) : (
            <div className="flex items-center gap-2">
              <FormInput
                type="text"
                value={note}
                onChange={setNote}
                placeholder="What's your concern? (optional)"
                className="t-caption placeholder:text-[var(--brand-text-muted)] outline-none w-48"
                autoFocus
              />
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  onFlag(note.trim());
                  setFlagging(false);
                  setNote('');
                }}
                className="t-caption-sm font-medium text-accent-warning px-2 py-1 hover:bg-amber-500/10 rounded-[var(--radius-md)] transition-colors"
              >
                Flag it
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setFlagging(false);
                  setNote('');
                }}
                className="t-caption-sm text-[var(--brand-text-muted)] hover:text-[var(--brand-text)] transition-colors px-1"
              >
                ✕
              </Button>
            </div>
          )}
        </div>
      </div>
      {flagged && (
        <p className="t-caption-sm text-accent-warning mt-1 flex items-center gap-1">
          <Icon as={Flag} size="sm" /> Flagged — your team will hold this change for review.
        </p>
      )}
    </div>
  );
}

// ── Client action payload renderers ───────────────────────────────────────

function AeoRenderer({ payload }: { payload: AeoChangePayload }) {
  const diffs = payload.diffs ?? [];
  if (diffs.length === 0) {
    return (
      <p className="t-body text-[var(--brand-text-muted)]">No changes in this batch.</p>
    );
  }
  return (
    <div className="space-y-4">
      {diffs.map((d, i) => (
        <div key={i} className="space-y-1">
          <p className="t-caption-sm font-semibold text-[var(--brand-text-muted)] uppercase tracking-wider">
            {d.page}
            {d.section ? ` — ${d.section}` : ''}
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="t-caption-sm text-[var(--brand-text-muted)] mb-0.5">Current</p>
              <p className="t-caption text-[var(--brand-text)] bg-[var(--surface-3)] p-2 rounded-[var(--radius-md)]">
                {d.current}
              </p>
            </div>
            <div>
              <p className="t-caption-sm text-accent-brand mb-0.5">Proposed</p>
              <p className="t-caption text-[var(--brand-text)] bg-teal-500/5 border border-teal-500/20 p-2 rounded-[var(--radius-md)]">
                {d.proposed}
              </p>
            </div>
          </div>
          {d.rationale && (
            <p className="t-caption-sm text-[var(--brand-text-muted)] italic">
              Why: {d.rationale}
            </p>
          )}
        </div>
      ))}
    </div>
  );
}

function InternalLinkRenderer({ payload }: { payload: InternalLinkPayload }) {
  const suggestions = payload.suggestions ?? [];
  if (suggestions.length === 0) {
    return (
      <p className="t-body text-[var(--brand-text-muted)]">No link suggestions.</p>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left border-collapse">
        <thead>
          <tr className="border-b border-[var(--brand-border)]">
            <th className="py-2 pr-4 t-caption-sm font-semibold text-[var(--brand-text-muted)] uppercase tracking-wider">
              Anchor text
            </th>
            <th className="py-2 pr-4 t-caption-sm font-semibold text-[var(--brand-text-muted)] uppercase tracking-wider">
              Target URL
            </th>
            <th className="py-2 t-caption-sm font-semibold text-[var(--brand-text-muted)] uppercase tracking-wider">
              Source page
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--brand-border)]">
          {suggestions.map((s, i) => (
            <tr key={i}>
              <td className="py-3 pr-4 t-ui font-medium text-[var(--brand-text-bright)] align-top">
                {s.anchorText}
              </td>
              <td className="py-3 pr-4 align-top">
                <span className="t-caption text-accent-brand">
                  {s.targetTitle || s.targetUrl}
                </span>
              </td>
              <td className="py-3 t-caption text-[var(--brand-text-muted)] align-top">
                {s.sourcePage || '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RedirectRenderer({ payload }: { payload: RedirectProposalPayload }) {
  const redirects = payload.redirects ?? [];
  if (redirects.length === 0) {
    return <p className="t-body text-[var(--brand-text-muted)]">No redirects.</p>;
  }
  return (
    <div className="space-y-3">
      {redirects.map((r, i) => (
        <div
          key={i}
          className="flex items-start gap-3 py-2 border-b border-[var(--brand-border)] last:border-b-0"
        >
          <p className="t-caption text-[var(--brand-text)] flex-1 min-w-0 break-all">
            {r.source}
          </p>
          <span className="t-caption-sm text-[var(--brand-text-muted)] flex-shrink-0">→</span>
          <p className="t-caption text-accent-brand flex-1 min-w-0 break-all">{r.target}</p>
        </div>
      ))}
    </div>
  );
}

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
