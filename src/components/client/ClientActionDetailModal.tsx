// src/components/client/ClientActionDetailModal.tsx
/**
 * ClientActionDetailModal — Tier-3 full-screen modal for client action cards
 * that have complex payloads requiring full-width review before deciding.
 *
 * Source types with modals: internal_link, redirect_proposal,
 * keyword_strategy, aeo_change.
 * (content_decay is Tier 1 — inline approve/reject in the action card.)
 */
import { useState, useEffect } from 'react';
import { X, ExternalLink, ArrowRight, AlertCircle } from 'lucide-react';
import { Button } from '../ui';
import type {
  ClientAction,
  ClientActionSourceType,
  InternalLinkPayload,
  InternalLinkItem,
  RedirectProposalPayload,
  RedirectItem,
  KeywordStrategyPayload,
  AeoChangePayload,
  AeoChangeDiff,
} from '../../../shared/types/client-actions';

interface ClientActionDetailModalProps {
  action: ClientAction;
  onApprove: () => void;
  onRequestChanges: (note: string) => void;
  onClose: () => void;
  submitting?: boolean;
}

// ── Payload renderers ──────────────────────────────────────────────────────

function InternalLinkRenderer({ payload }: { payload: InternalLinkPayload }) {
  const { suggestions } = payload;
  if (!suggestions?.length) {
    return (
      <div className="flex items-center gap-2 text-[var(--brand-text-muted)]">
        <AlertCircle className="w-4 h-4 flex-shrink-0" />
        <span className="t-body">No link suggestions found in this action.</span>
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <p className="t-body text-[var(--brand-text-muted)]">
        {suggestions.length} internal link suggestion{suggestions.length !== 1 ? 's' : ''} to review.
      </p>
      <div className="space-y-3">
        {suggestions.map((item: InternalLinkItem, i: number) => (
          <div
            key={i}
            className="rounded-[var(--radius-md)] border border-[var(--brand-border)] bg-[var(--surface-2)] p-4 space-y-2"
          >
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <span className="t-body font-medium text-[var(--brand-text-bright)]">
                &ldquo;{item.anchorText}&rdquo;
              </span>
              <a
                href={item.targetUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 t-caption text-teal-400 hover:text-teal-300 transition-colors"
              >
                {item.targetTitle ?? item.targetUrl}
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>
            {item.sourcePage && (
              <p className="t-caption text-[var(--brand-text-muted)]">
                Source: <span className="text-[var(--brand-text)]">{item.sourcePage}</span>
              </p>
            )}
            {item.contextSnippet && (
              <blockquote className="border-l-2 border-[var(--brand-border)] pl-3 t-caption text-[var(--brand-text-muted)] italic">
                {item.contextSnippet}
              </blockquote>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function RedirectProposalRenderer({ payload }: { payload: RedirectProposalPayload }) {
  const { redirects } = payload;
  if (!redirects?.length) {
    return (
      <div className="flex items-center gap-2 text-[var(--brand-text-muted)]">
        <AlertCircle className="w-4 h-4 flex-shrink-0" />
        <span className="t-body">No redirect entries found in this action.</span>
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <p className="t-body text-[var(--brand-text-muted)]">
        {redirects.length} redirect{redirects.length !== 1 ? 's' : ''} proposed.
      </p>
      <div className="space-y-3">
        {redirects.map((r: RedirectItem, i: number) => (
          <div
            key={i}
            className="rounded-[var(--radius-md)] border border-[var(--brand-border)] bg-[var(--surface-2)] p-4 space-y-2"
          >
            <div className="flex items-center gap-2 flex-wrap t-body">
              <span className="text-[var(--brand-text-muted)] font-mono break-all">{r.source}</span>
              <ArrowRight className="w-4 h-4 flex-shrink-0 text-[var(--brand-text-muted)]" />
              <span className="text-[var(--brand-text-bright)] font-mono break-all">{r.target}</span>
              {r.type && (
                <span className="t-caption-sm text-[var(--brand-text-muted)] px-1.5 py-0.5 rounded-[var(--radius-pill)] border border-[var(--brand-border)] bg-[var(--surface-3)] capitalize">
                  {r.type}
                </span>
              )}
            </div>
            {r.rationale && (
              <p className="t-caption text-[var(--brand-text-muted)]">{r.rationale}</p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function KeywordStrategyRenderer({ payload }: { payload: KeywordStrategyPayload }) {
  const { mappedPages = [], quickWins = [], contentGaps = [], opportunities = [] } = payload;
  return (
    <div className="space-y-6">
      {mappedPages.length > 0 && (
        <section>
          <h3 className="t-label text-[var(--brand-text)] mb-3">Mapped Pages</h3>
          <div className="rounded-[var(--radius-md)] border border-[var(--brand-border)] overflow-hidden">
            <table className="w-full t-caption text-[var(--brand-text)]">
              <thead className="bg-[var(--surface-3)] border-b border-[var(--brand-border)]">
                <tr>
                  <th className="text-left px-4 py-2 text-[var(--brand-text-muted)] font-medium">Page</th>
                  <th className="text-left px-4 py-2 text-[var(--brand-text-muted)] font-medium">Keyword</th>
                  <th className="text-right px-4 py-2 text-[var(--brand-text-muted)] font-medium">Position</th>
                </tr>
              </thead>
              <tbody>
                {mappedPages.map((mp, i) => (
                  <tr key={i} className="border-b border-[var(--brand-border)] last:border-b-0 bg-[var(--surface-2)]">
                    <td className="px-4 py-2 text-[var(--brand-text)] break-all">{mp.page}</td>
                    <td className="px-4 py-2 text-[var(--brand-text-bright)]">{mp.keyword}</td>
                    <td className="px-4 py-2 text-right text-[var(--brand-text-muted)]">
                      {mp.currentPosition != null ? `#${mp.currentPosition}` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      {quickWins.length > 0 && (
        <section>
          <h3 className="t-label text-[var(--brand-text)] mb-3">Quick Wins</h3>
          <div className="space-y-2">
            {quickWins.map((qw, i) => (
              <div key={i} className="rounded-[var(--radius-md)] border border-[var(--brand-border)] bg-[var(--surface-2)] px-4 py-3">
                <span className="t-body font-medium text-[var(--brand-text-bright)]">{qw.keyword}</span>
                {qw.opportunity && (
                  <p className="t-caption text-[var(--brand-text-muted)] mt-0.5">{qw.opportunity}</p>
                )}
              </div>
            ))}
          </div>
        </section>
      )}
      {contentGaps.length > 0 && (
        <section>
          <h3 className="t-label text-[var(--brand-text)] mb-3">Content Gaps</h3>
          <ul className="space-y-1.5">
            {contentGaps.map((gap, i) => (
              <li key={i} className="flex items-start gap-2 t-body text-[var(--brand-text)]">
                <span className="mt-1.5 w-1.5 h-1.5 rounded-[50%] bg-amber-400 flex-shrink-0" />
                {gap}
              </li>
            ))}
          </ul>
        </section>
      )}
      {opportunities.length > 0 && (
        <section>
          <h3 className="t-label text-[var(--brand-text)] mb-3">Opportunities</h3>
          <ul className="space-y-1.5">
            {opportunities.map((opp, i) => (
              <li key={i} className="flex items-start gap-2 t-body text-[var(--brand-text)]">
                <span className="mt-1.5 w-1.5 h-1.5 rounded-[50%] bg-teal-400 flex-shrink-0" />
                {opp}
              </li>
            ))}
          </ul>
        </section>
      )}
      {!mappedPages.length && !quickWins.length && !contentGaps.length && !opportunities.length && (
        <div className="flex items-center gap-2 text-[var(--brand-text-muted)]">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          <span className="t-body">No keyword strategy data found in this action.</span>
        </div>
      )}
    </div>
  );
}

function AeoChangeRenderer({ payload }: { payload: AeoChangePayload }) {
  const { diffs } = payload;
  if (!diffs?.length) {
    return (
      <div className="flex items-center gap-2 text-[var(--brand-text-muted)]">
        <AlertCircle className="w-4 h-4 flex-shrink-0" />
        <span className="t-body">No AEO change diffs found in this action.</span>
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <p className="t-body text-[var(--brand-text-muted)]">
        {diffs.length} page change{diffs.length !== 1 ? 's' : ''} proposed.
      </p>
      <div className="space-y-4">
        {diffs.map((diff: AeoChangeDiff, i: number) => (
          <div key={i} className="rounded-[var(--radius-md)] border border-[var(--brand-border)] bg-[var(--surface-2)] overflow-hidden">
            <div className="px-4 py-2 border-b border-[var(--brand-border)] bg-[var(--surface-3)] flex items-center gap-2 flex-wrap">
              <span className="t-label text-[var(--brand-text-bright)]">{diff.page}</span>
              {diff.section && (
                <span className="t-caption-sm text-[var(--brand-text-muted)]">— {diff.section}</span>
              )}
            </div>
            <div className="grid grid-cols-[1fr_1fr] divide-x divide-[var(--brand-border)]">
              <div className="p-4">
                <p className="t-caption text-[var(--brand-text-muted)] mb-2 font-medium uppercase tracking-wide">Current</p>
                <p className="t-body text-[var(--brand-text)]">{diff.current}</p>
              </div>
              <div className="p-4 bg-teal-500/5">
                <p className="t-caption text-teal-400 mb-2 font-medium uppercase tracking-wide">Proposed</p>
                <p className="t-body text-[var(--brand-text-bright)]">{diff.proposed}</p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Modal shell ────────────────────────────────────────────────────────────

export function ClientActionDetailModal({
  action,
  onApprove,
  onRequestChanges,
  onClose,
  submitting = false,
}: ClientActionDetailModalProps) {
  const [changeNote, setChangeNote] = useState('');
  const [showChangeForm, setShowChangeForm] = useState(false);

  // Escape to close — WAI-ARIA dialog requirement
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); }
    };
    document.addEventListener('keydown', handleKey); // keydown-ok — full-screen modal intentionally handles Escape globally while open
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const renderPayload = () => {
    const p = action.payload;
    switch (action.sourceType as ClientActionSourceType) {
      case 'internal_link':
        return <InternalLinkRenderer payload={p as unknown as InternalLinkPayload} />;
      case 'redirect_proposal':
        return <RedirectProposalRenderer payload={p as unknown as RedirectProposalPayload} />;
      case 'keyword_strategy':
        return <KeywordStrategyRenderer payload={p as unknown as KeywordStrategyPayload} />;
      case 'aeo_change':
        return <AeoChangeRenderer payload={p as unknown as AeoChangePayload} />;
      default:
        return (
          <pre className="t-mono t-caption text-[var(--brand-text-muted)] whitespace-pre-wrap">
            {JSON.stringify(p, null, 2)}
          </pre>
        );
    }
  };

  return (
    <div
      className={'fixed inset-0 z-[var(--z-modal-fullscreen)] flex flex-col bg-[var(--surface-1)]'} // fixed-inset-ok -- Full-screen action review takeover; not a centered reusable dialog.
      role="dialog"
      aria-modal="true"
      aria-labelledby="client-action-modal-title"
    >
      {/* Header */}
      <div className="flex items-start justify-between px-6 py-4 border-b border-[var(--brand-border)] flex-shrink-0 gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="t-caption-sm font-medium px-2 py-0.5 rounded-[var(--radius-pill)] bg-[var(--surface-3)] text-[var(--brand-text-muted)] border border-[var(--brand-border)] capitalize">
              {action.sourceType.replace(/_/g, ' ')}
            </span>
          </div>
          <h2 id="client-action-modal-title" className="t-h2 text-[var(--brand-text-bright)] truncate">{action.title}</h2>
          {action.summary && (
            <p className="t-body text-[var(--brand-text-muted)] mt-0.5 line-clamp-2">{action.summary}</p>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          autoFocus
          className="flex-shrink-0 flex items-center justify-center w-9 h-9 rounded-[var(--radius-md)] text-[var(--brand-text-muted)] hover:text-[var(--brand-text-bright)] hover:bg-[var(--surface-3)] transition-colors"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto px-6 py-6 max-w-5xl mx-auto w-full">
        {renderPayload()}
      </div>

      {/* Footer — approve / request changes */}
      <div className="flex-shrink-0 border-t border-[var(--brand-border)] px-6 py-4 flex items-center gap-3 flex-wrap">
        {!showChangeForm ? (
          <>
            <Button variant="primary" disabled={submitting} onClick={onApprove}>
              {submitting ? 'Saving…' : 'Approve'}
            </Button>
            <Button variant="ghost" onClick={() => setShowChangeForm(true)}>
              Request changes
            </Button>
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
          </>
        ) : (
          <>
            <input
              type="text"
              value={changeNote}
              onChange={e => setChangeNote(e.target.value)}
              placeholder="Describe what needs to change…"
              className="flex-1 min-w-[200px] px-3 py-2 rounded-[var(--radius-md)] t-body bg-[var(--surface-3)] border border-[var(--brand-border)] text-[var(--brand-text)] placeholder:text-[var(--brand-text-muted)] outline-none focus:border-teal-500/50"
            />
            <Button variant="primary" disabled={submitting || !changeNote.trim()} onClick={() => onRequestChanges(changeNote.trim())}>
              {submitting ? 'Sending…' : 'Send feedback'}
            </Button>
            <Button variant="ghost" onClick={() => { setShowChangeForm(false); setChangeNote(''); }}>
              Back
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
