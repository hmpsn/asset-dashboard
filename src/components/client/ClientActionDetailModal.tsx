// src/components/client/ClientActionDetailModal.tsx
/**
 * ClientActionDetailModal — Tier-3 full-screen modal for client action cards
 * that have complex payloads requiring full-width review before deciding.
 *
 * Source types with modals: internal_link, redirect_proposal, aeo_change.
 * (content_decay is Tier 1 — inline approve/reject in the action card.)
 */
import { useState, useEffect } from 'react';
import { X, ExternalLink, ArrowRight, AlertCircle } from 'lucide-react';
import { Button, FormInput } from '../ui';
import type {
  ClientAction,
  InternalLinkPayload,
  InternalLinkItem,
  RedirectProposalPayload,
  RedirectItem,
  AeoChangePayload,
  AeoChangeDiff,
} from '../../../shared/types/client-actions';

/** Allow only http/https URLs in rendered <a> tags — blocks javascript: and data: schemes. */
function safeHref(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? url : undefined;
  } catch {
    return undefined; // relative or malformed URL — don't render as href
  }
}

interface ClientActionDetailModalProps {
  action: ClientAction;
  onApprove: () => void;
  onRequestChanges: (note: string) => void;
  onClose: () => void;
  submitting?: boolean;
}

// ── Payload renderers ──────────────────────────────────────────────────────

function InternalLinkRenderer({ payload }: { payload: InternalLinkPayload }) {
  const suggestions: InternalLinkItem[] = payload.suggestions ?? [];
  if (suggestions.length === 0) {
    return <p className="t-body text-[var(--brand-text-muted)]">No link suggestions in this batch.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left border-collapse">
        <thead>
          <tr className="border-b border-[var(--brand-border)]">
            <th className="py-2 pr-4 t-caption-sm font-semibold text-[var(--brand-text-muted)] uppercase tracking-wider">Anchor text</th>
            <th className="py-2 pr-4 t-caption-sm font-semibold text-[var(--brand-text-muted)] uppercase tracking-wider">Target URL</th>
            <th className="py-2 pr-4 t-caption-sm font-semibold text-[var(--brand-text-muted)] uppercase tracking-wider">Source page</th>
            <th className="py-2 t-caption-sm font-semibold text-[var(--brand-text-muted)] uppercase tracking-wider">Context</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--brand-border)]">
          {suggestions.map((s, i) => (
            <tr key={i}>
              <td className="py-3 pr-4 t-ui font-medium text-[var(--brand-text-bright)] align-top">{s.anchorText}</td>
              <td className="py-3 pr-4 align-top">
                <a
                  href={safeHref(s.targetUrl)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="t-caption text-accent-brand hover:underline flex items-center gap-1"
                >
                  {s.targetTitle || s.targetUrl}
                  <ExternalLink className="w-3 h-3 flex-shrink-0" />
                </a>
              </td>
              <td className="py-3 pr-4 t-caption text-[var(--brand-text-muted)] align-top">{s.sourcePage || '—'}</td>
              <td className="py-3 t-caption text-[var(--brand-text-muted)] align-top max-w-xs">{s.contextSnippet || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
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
                <p className="t-caption text-accent-brand mb-2 font-medium uppercase tracking-wide">Proposed</p>
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
      if (e.key === 'Escape') {
        if (submitting) return;
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', handleKey); // keydown-ok — full-screen modal intentionally handles Escape globally while open
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose, submitting]);

  const renderPayload = () => {
    const p = action.payload;
    switch (action.sourceType) {
      case 'internal_link':
        return <InternalLinkRenderer payload={p as unknown as InternalLinkPayload} />;
      case 'redirect_proposal':
        return <RedirectProposalRenderer payload={p as unknown as RedirectProposalPayload} />;
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
        <Button
          variant="ghost"
          size="sm"
          onClick={onClose}
          aria-label="Close action review"
          autoFocus
          className="flex-shrink-0 w-9 h-9 p-0 rounded-[var(--radius-md)] text-[var(--brand-text-muted)] hover:text-[var(--brand-text)] hover:bg-[var(--surface-3)]"
        >
          <X className="w-5 h-5" />
        </Button>
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
            <FormInput
              type="text"
              value={changeNote}
              onChange={setChangeNote}
              placeholder="Describe what needs to change…"
              aria-label="Describe what needs to change"
              className="flex-1 min-w-[200px] t-body placeholder:text-[var(--brand-text-muted)] outline-none"
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
