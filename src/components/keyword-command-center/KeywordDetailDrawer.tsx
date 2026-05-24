import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckCircle2, History, Search, X } from 'lucide-react';

import { adminPath } from '../../routes';
import type { KeywordCommandCenterNextAction, KeywordCommandCenterRow } from '../../../shared/types/keyword-command-center';
import { LocalSeoVisibilityBadge } from '../local-seo/LocalSeoVisibilityPanel';
import { Badge, Button, EmptyState, Icon, IconButton, StatusBadge, TableSkeleton } from '../ui';
import { KeywordDetailPanel } from './KeywordDetailPanel';
import {
  actionVariant,
  compactNumber,
  localPriorityTone,
  percent,
} from './kccDisplayHelpers';

interface KeywordDetailDrawerProps {
  open: boolean;
  row: KeywordCommandCenterRow | null;
  workspaceId: string;
  isLoading?: boolean;
  loadingAction?: string;
  onAction: (action: KeywordCommandCenterNextAction) => void;
  onClose: () => void;
}

export function KeywordDetailDrawer({
  open,
  row,
  workspaceId,
  isLoading,
  loadingAction,
  onAction,
  onClose,
}: KeywordDetailDrawerProps) {
  const navigate = useNavigate();
  const drawerRef = useRef<HTMLElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    previouslyFocusedRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusTimer = window.setTimeout(() => {
      closeButtonRef.current?.focus();
    }, 0);

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
        return;
      }
      const target = event.target instanceof HTMLElement ? event.target : null;
      const isTextInput = target instanceof HTMLInputElement
        || target instanceof HTMLTextAreaElement
        || target instanceof HTMLSelectElement
        || target?.isContentEditable === true;
      if (isTextInput && event.key !== 'Tab') return;
      if (event.key !== 'Tab' || !drawerRef.current) return;

      const focusable = Array.from(
        drawerRef.current.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter(element => !element.hasAttribute('disabled') && element.getAttribute('aria-hidden') !== 'true');

      if (focusable.length === 0) {
        event.preventDefault();
        drawerRef.current.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown); // keydown-ok: modal drawer Escape/Tab trap
    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener('keydown', handleKeyDown);
      if (previouslyFocusedRef.current && document.contains(previouslyFocusedRef.current)) {
        previouslyFocusedRef.current.focus();
      }
      previouslyFocusedRef.current = null;
    };
  }, [open, onClose]);

  if (!open) return null;

  const isAwaitingSignal = row?.tracking.status === 'active' && row.tracking.hasSignal === false;
  const trackingLabel = row?.tracking.status === 'not_tracked'
    ? 'Not tracked'
    : isAwaitingSignal
      ? 'Active - waiting for first signal'
      : row?.tracking.status.replace(/_/g, ' ');
  const trackingSourceLabel = row?.tracking.source && row.tracking.source !== 'unknown'
    ? row.tracking.source.replace(/_/g, ' ')
    : row?.tracking.status === 'not_tracked'
      ? null
      : 'Source not recorded';

  return (
    <>
      <div
        className="fixed inset-0 z-[var(--z-modal-backdrop)] bg-black/30" // fixed-inset-ok -- keyword detail drawer backdrop
        onClick={onClose}
        aria-hidden="true"
      />
      <aside
        ref={drawerRef}
        role="dialog"
        aria-modal="true"
        aria-label={row ? `Keyword details: ${row.keyword}` : 'Keyword details'}
        tabIndex={-1}
        className="fixed inset-x-0 bottom-0 h-[78vh] sm:inset-x-auto sm:inset-y-0 sm:right-0 sm:h-auto sm:w-full sm:max-w-[440px] bg-[var(--surface-2)] border-t border-[var(--brand-border)] sm:border-t-0 sm:border-l z-[var(--z-modal)] flex flex-col overflow-hidden rounded-t-[var(--radius-signature-lg)] sm:rounded-none outline-none animate-in slide-in-from-right" // pr-check-disable-next-line -- Brand signature radius intentional for bottom-sheet drawer top corners on mobile
        style={{ boxShadow: 'var(--brand-shadow-md)' }}
      >
        <div className="flex items-start justify-between gap-3 px-4 pt-4 pb-3 border-b border-[var(--brand-border)] flex-shrink-0">
          <div className="min-w-0 flex-1">
            <h2 className="t-page font-semibold text-[var(--brand-text-bright)] leading-snug break-words">
              {row?.keyword ?? 'Keyword Detail'}
            </h2>
            {row && (
              <div className="mt-2 flex items-center gap-2 flex-wrap">
                <StatusBadge
                  domain="keyword-command-center"
                  status={row.lifecycleStatus}
                  variant="outline"
                  shape="pill"
                  fallback="neutral"
                />
                {row.isProtected && <Badge label="Protected" tone="amber" variant="soft" shape="pill" />}
                {row.isLostVisibility && <Badge label="Lost visibility" tone="amber" variant="outline" shape="pill" />}
              </div>
            )}
          </div>
          <IconButton
            ref={closeButtonRef}
            icon={X}
            label="Close keyword detail"
            size="sm"
            variant="ghost"
            className="flex-shrink-0 mt-0.5 w-7 h-7 rounded-[var(--radius-sm)] text-[var(--brand-text-muted)] hover:text-[var(--brand-text-bright)] hover:bg-[var(--surface-3)]"
            onClick={onClose}
          />
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4">
          {isLoading ? (
            <TableSkeleton rows={6} columns={1} />
          ) : !row ? (
            <EmptyState
              icon={Search}
              title="Select a keyword"
              description="Pick a row to see evidence, tracking state, feedback, and safe next actions."
            />
          ) : (
            <div className="space-y-5">
              <div className="grid grid-cols-3 gap-2">
                <KeywordDetailPanel>
                  <p className="t-caption-sm text-[var(--brand-text-muted)]">Volume</p>
                  <p className="t-caption font-semibold text-blue-400 tabular-nums">{compactNumber(row.metrics.volume)}</p>
                </KeywordDetailPanel>
                <KeywordDetailPanel>
                  <p className="t-caption-sm text-[var(--brand-text-muted)]">Rank</p>
                  <p className="t-caption font-semibold text-[var(--brand-text-bright)] tabular-nums">
                    {row.metrics.currentPosition ? `#${row.metrics.currentPosition.toFixed(1)}` : '-'}
                  </p>
                </KeywordDetailPanel>
                <KeywordDetailPanel>
                  <p className="t-caption-sm text-[var(--brand-text-muted)]">CTR</p>
                  <p className="t-caption font-semibold text-blue-400 tabular-nums">{percent(row.metrics.ctr)}</p>
                </KeywordDetailPanel>
              </div>

              <div>
                <p className="t-label text-[var(--brand-text-muted)] mb-2">Where It Came From</p>
                <div className="flex flex-wrap gap-1.5">
                  {row.sourceLabels.length > 0 ? row.sourceLabels.map(source => (
                    <Badge
                      key={`${source.kind}-${source.label}-${source.detail ?? ''}`}
                      label={source.detail ? `${source.label}: ${source.detail}` : source.label}
                      tone={source.kind === 'raw_evidence' ? 'zinc' : source.kind === 'rank_data' || source.kind === 'local_visibility' ? 'blue' : source.kind === 'local_candidate' ? 'amber' : 'teal'}
                      variant="outline"
                    />
                  )) : (
                    <p className="t-caption-sm text-[var(--brand-text-muted)]">No source labels recorded yet.</p>
                  )}
                </div>
              </div>

              {row.lifecycleStatus === 'in_strategy' && !row.assignment?.pageTitle && !row.assignment?.pagePath && (
                <KeywordDetailPanel tone="amber" className="py-2">
                  <p className="t-caption-sm text-amber-400/90">
                    <span className="font-semibold">Not yet mapped to a page.</span> This keyword is in the strategy but is not assigned to a page.
                  </p>
                </KeywordDetailPanel>
              )}

              {row.explanation && (
                <div>
                  <p className="t-label text-[var(--brand-text-muted)] mb-2">Why It Matters</p>
                  <div className="space-y-2">
                    {row.explanation.reasons.map(reason => (
                      <KeywordDetailPanel key={reason} className="flex gap-2 py-2">
                        <Icon as={CheckCircle2} size="sm" className="text-teal-400 mt-0.5 flex-shrink-0" />
                        <p className="t-caption-sm text-[var(--brand-text)] break-words">{reason}</p>
                      </KeywordDetailPanel>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <p className="t-label text-[var(--brand-text-muted)] mb-2">Tracking State</p>
                <KeywordDetailPanel>
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="t-caption font-medium text-[var(--brand-text-bright)] capitalize">{trackingLabel}</p>
                      {trackingSourceLabel && (
                        <p className="t-caption-sm text-[var(--brand-text-muted)]">{trackingSourceLabel}</p>
                      )}
                      {isAwaitingSignal && (
                        <p className="t-caption-sm text-[var(--brand-text-muted)] mt-1">
                          First Search Console clicks, impressions, or rank data will appear after the next usable snapshot.
                        </p>
                      )}
                    </div>
                    {row.tracking.status !== 'not_tracked' && (
                      <Button
                        variant="ghost"
                        size="sm"
                        icon={History}
                        onClick={() => navigate(adminPath(workspaceId, 'seo-ranks'))}
                      >
                        Rank Tracker
                      </Button>
                    )}
                  </div>
                  {row.protectionReason && (
                    <p className="t-caption-sm text-amber-400/80 mt-2">{row.protectionReason} is protected from accidental retirement.</p>
                  )}
                </KeywordDetailPanel>
              </div>

              {row.feedback?.status && (
                <div>
                  <p className="t-label text-[var(--brand-text-muted)] mb-2">Feedback</p>
                  <KeywordDetailPanel>
                    <StatusBadge
                      domain="keyword-command-center"
                      status={row.feedback.status}
                      variant="outline"
                      fallback="neutral"
                    />
                    {row.feedback.reason && <p className="t-caption-sm text-[var(--brand-text)] mt-2 break-words">{row.feedback.reason}</p>}
                  </KeywordDetailPanel>
                </div>
              )}

              {row.localSeoState && (
                <div>
                  <p className="t-label text-[var(--brand-text-muted)] mb-2">Local Visibility</p>
                  <KeywordDetailPanel tone="blue">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="t-caption font-medium text-[var(--brand-text-bright)]">
                          {row.localSeoState.marketLabel ?? row.localSeoState.lifecycleLabel}
                        </p>
                        <p className="t-caption-sm text-[var(--brand-text-muted)]">{row.localSeoState.detail}</p>
                      </div>
                      <div className="flex flex-wrap justify-end gap-1.5">
                        <Badge label={row.localSeoState.priorityLabel} tone={localPriorityTone(row.localSeoState.priority)} variant="outline" shape="pill" />
                        {row.localSeo ? (
                          <LocalSeoVisibilityBadge visibility={row.localSeo} />
                        ) : (
                          <StatusBadge
                            domain="keyword-command-center"
                            status={row.localSeoState.lifecycle}
                            variant="soft"
                            shape="pill"
                            fallback="neutral"
                          />
                        )}
                      </div>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {row.localSeoState.sourceLabels.map(source => (
                        <Badge key={source} label={source} tone="blue" variant="soft" />
                      ))}
                      {row.localSeoState.localPackPresent != null && (
                        <Badge
                          label={row.localSeoState.localPackPresent ? 'Local pack present' : 'No local pack'}
                          tone={row.localSeoState.localPackPresent ? 'blue' : 'zinc'}
                          variant="outline"
                        />
                      )}
                      {row.localSeoState.businessMatchConfidence && (
                        <Badge label={row.localSeoState.businessMatchConfidence.replace(/_/g, ' ')} tone="amber" variant="outline" />
                      )}
                    </div>
                    {row.localSeo?.topCompetitors && row.localSeo.topCompetitors.length > 0 && (
                      <KeywordDetailPanel className="mt-3">
                        <p className="t-caption-sm font-semibold text-[var(--brand-text-bright)] mb-2">Top local result evidence</p>
                        <div className="space-y-1.5">
                          {row.localSeo.topCompetitors.slice(0, 3).map(result => (
                            <div key={`${result.rank ?? 'rank'}-${result.title}`} className="flex items-center justify-between gap-3">
                              <p className="t-caption-sm text-[var(--brand-text)] truncate">
                                {result.rank ? `#${result.rank} ` : ''}{result.title}
                              </p>
                              {result.domain && <span className="t-caption-sm text-blue-400 truncate">{result.domain}</span>}
                            </div>
                          ))}
                        </div>
                      </KeywordDetailPanel>
                    )}
                    <p className="t-caption-sm text-[var(--brand-text-muted)] mt-2">
                      Local SEO is market-specific local-pack visibility. Rank Tracker remains Search Console measurement.
                    </p>
                  </KeywordDetailPanel>
                </div>
              )}
            </div>
          )}
        </div>

        {row && (
          <div className="px-4 py-3 border-t border-[var(--brand-border)] flex-shrink-0 bg-[var(--surface-2)]">
            <p className="t-label text-[var(--brand-text-muted)] mb-2">Safe Next Actions</p>
            <div className="flex flex-wrap gap-2">
              {row.nextActions.map(action => (
                <Button
                  key={`${action.type}-${action.label}`}
                  size="sm"
                  variant={actionVariant(action)}
                  disabled={action.disabled}
                  loading={loadingAction === action.type}
                  title={action.disabledReason || action.detail}
                  onClick={() => onAction(action)}
                >
                  {action.label}
                </Button>
              ))}
            </div>
            <p className="t-caption-sm text-[var(--brand-text-muted)] mt-3">
              These actions change keyword lifecycle state or navigate to a planning surface. They do not publish content or write live metadata.
            </p>
          </div>
        )}
      </aside>
    </>
  );
}
