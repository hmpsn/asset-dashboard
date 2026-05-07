import type { Dispatch, RefObject, SetStateAction } from 'react';
import { ChevronDown, X } from 'lucide-react';
import { Button, Icon } from '../../ui';
import { kdFraming } from '../../../lib/kdFraming.js';
import {
  ROLE_DISPLAY_LABELS,
  SIGNAL_LABELS,
  confidenceColor,
  confidenceStatement,
  fmtAudience,
  fmtMomentum,
  fmtNum,
  intentColor,
  roleBadgeClass,
  type PriorityKeywordItem,
  type StrategyKeywordTableRow,
} from './strategyKeywordDisplay';

interface StrategyKeywordDrawerProps {
  drawerRow: StrategyKeywordTableRow;
  drawerClosing: boolean;
  drawerRef: RefObject<HTMLDivElement | null>;
  drawerEvidenceOpen: boolean;
  setDrawerEvidenceOpen: Dispatch<SetStateAction<boolean>>;
  removingKeyword: string | null;
  addingKeyword: boolean;
  closeDrawer: () => void;
  onTabChange?: (tab: string) => void;
  removePriorityKeyword: (item: PriorityKeywordItem) => Promise<void>;
  addStrategyKeyword: (keyword: string, options?: { clearInput?: boolean }) => Promise<void>;
  submitFeedback: (
    keyword: string,
    status: 'approved' | 'declined',
    source: string,
    reason?: string,
    options?: { toast?: boolean; rethrow?: boolean; clearOnError?: boolean },
  ) => Promise<void>;
  isLoadingFeedback: (keyword: string) => boolean;
}

export function StrategyKeywordDrawer({
  drawerRow,
  drawerClosing,
  drawerRef,
  drawerEvidenceOpen,
  setDrawerEvidenceOpen,
  removingKeyword,
  addingKeyword,
  closeDrawer,
  onTabChange,
  removePriorityKeyword,
  addStrategyKeyword,
  submitFeedback,
  isLoadingFeedback,
}: StrategyKeywordDrawerProps) {
  const isConfirmed = drawerRow.status === 'client' || drawerRow.status === 'strategy';
  const isRemoving = removingKeyword === drawerRow.normalized;
  const unenriched = drawerRow.enrichmentStatus === 'unenriched';

  return (
    <>
      <div
        className="fixed inset-0 z-[var(--z-modal-backdrop)]" // fixed-inset-ok — keyword detail drawer backdrop
        onClick={closeDrawer}
        aria-hidden="true"
      />

      <div
        ref={drawerRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Keyword details: ${drawerRow.label}`}
        tabIndex={-1}
        className={`fixed inset-x-0 bottom-0 h-[70vh] sm:inset-x-auto sm:inset-y-0 sm:right-0 sm:h-auto sm:w-full sm:max-w-sm bg-[var(--surface-2)] border-t border-[var(--brand-border)] sm:border-t-0 sm:border-l z-[var(--z-modal)] flex flex-col overflow-hidden duration-200 rounded-t-[var(--radius-signature-lg)] sm:rounded-none outline-none ${drawerClosing ? 'animate-out slide-out-to-right fill-mode-forwards' : 'animate-in slide-in-from-right'}`} // pr-check-disable-next-line -- Brand signature radius intentional for bottom-sheet drawer top corners on mobile
      >
        <div className="flex items-start justify-between gap-3 px-4 pt-4 pb-3 border-b border-[var(--brand-border)] flex-shrink-0">
          <div className="min-w-0 flex-1">
            <div className="t-page font-semibold text-[var(--brand-text-bright)] leading-snug break-words mb-1.5">
              {drawerRow.label}
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`inline-flex items-center px-2 py-0.5 rounded-[var(--radius-pill)] border t-caption-sm font-medium ${roleBadgeClass(drawerRow.role)}`}>
                {ROLE_DISPLAY_LABELS[drawerRow.role] ?? drawerRow.roleLabel}
              </span>
              <span className={`t-caption-sm font-medium ${confidenceColor(drawerRow)}`}>
                {confidenceStatement(drawerRow)}
              </span>
            </div>
          </div>
          <button
            type="button"
            aria-label="Close keyword detail"
            className="flex-shrink-0 mt-0.5 w-7 h-7 flex items-center justify-center rounded-[var(--radius-sm)] text-[var(--brand-text-muted)] hover:text-[var(--brand-text-bright)] hover:bg-[var(--surface-3)] transition-colors"
            onClick={closeDrawer}
          >
            <Icon as={X} size="sm" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto flex flex-col gap-5 px-4 py-4">
          {unenriched ? (
            <div className="rounded-[var(--radius-lg)] bg-[var(--surface-3)] px-3 py-3 flex items-start gap-2.5">
              <div className="w-1.5 h-1.5 rounded-[var(--radius-pill)] bg-[var(--brand-text-muted)] mt-1.5 animate-pulse flex-shrink-0" />
              <p className="t-caption text-[var(--brand-text-muted)] leading-relaxed">
                We're collecting search data for this keyword. Volume and competition metrics will appear within 24 hours.
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-1.5">
              <div className="t-caption-sm font-medium text-[var(--brand-text-muted)] uppercase tracking-wider mb-0.5">Opportunity</div>
              <div className="grid grid-cols-1 gap-1">
                <div className="flex items-center justify-between py-1.5 border-b border-[var(--brand-border)]/40">
                  <span className="t-caption text-[var(--brand-text-muted)]">Audience</span>
                  <span className="t-caption font-medium text-[var(--brand-text)]">{fmtAudience(drawerRow.volume)}</span>
                </div>
                <div className="flex items-center justify-between py-1.5 border-b border-[var(--brand-border)]/40">
                  <span className="t-caption text-[var(--brand-text-muted)]">Competition</span>
                  <span className="t-caption font-medium text-[var(--brand-text)]">{kdFraming(drawerRow.difficulty ?? undefined) ?? 'Gathering…'}</span>
                </div>
                <div className="flex items-center justify-between py-1.5">
                  <span className="t-caption text-[var(--brand-text-muted)]">Momentum</span>
                  <span className={`t-caption font-medium ${
                    drawerRow.trendDirection === 'rising' ? 'text-emerald-400' :
                    drawerRow.trendDirection === 'declining' ? 'text-red-400' :
                    'text-[var(--brand-text)]'
                  }`}>{fmtMomentum(drawerRow.trendDirection)}</span>
                </div>
              </div>
            </div>
          )}

          {(drawerRow.currentPosition != null || (drawerRow.impressions != null && drawerRow.impressions > 0)) && (
            <div>
              <div className="t-caption-sm font-medium text-[var(--brand-text-muted)] uppercase tracking-wider mb-1.5">Your position</div>
              <div className="grid grid-cols-2 gap-3">
                {drawerRow.currentPosition != null && (
                  <div className="bg-[var(--surface-3)] rounded-[var(--radius-lg)] px-3 py-2.5">
                    <div className="t-caption-sm text-[var(--brand-text-muted)] mb-0.5">Current rank</div>
                    <div className={`t-stat-sm font-semibold ${
                      drawerRow.currentPosition <= 10 ? 'text-emerald-400' :
                      drawerRow.currentPosition <= 30 ? 'text-amber-400' :
                      'text-[var(--brand-text)]'
                    }`}>#{drawerRow.currentPosition}</div>
                    <div className="t-caption-sm text-[var(--brand-text-muted)] mt-0.5">
                      {drawerRow.currentPosition <= 10 ? 'On page 1' :
                       drawerRow.currentPosition <= 20 ? 'Top of page 2' : 'Page 2+'}
                    </div>
                  </div>
                )}
                {drawerRow.impressions != null && drawerRow.impressions > 0 && (
                  <div className="bg-[var(--surface-3)] rounded-[var(--radius-lg)] px-3 py-2.5">
                    <div className="t-caption-sm text-[var(--brand-text-muted)] mb-0.5">Monthly impressions</div>
                    <div className="t-stat-sm font-semibold text-blue-400">
                      {drawerRow.impressions >= 1000 ? `${(drawerRow.impressions / 1000).toFixed(1)}k` : drawerRow.impressions}
                    </div>
                    <div className="t-caption-sm text-[var(--brand-text-muted)] mt-0.5">via Google Search</div>
                  </div>
                )}
              </div>
            </div>
          )}

          {(drawerRow.rationale ?? drawerRow.opportunityDetail) && (
            <div>
              <div className="t-caption-sm font-medium text-[var(--brand-text-muted)] uppercase tracking-wider mb-1.5">Why it's in the strategy</div>
              <p className="t-body text-[var(--brand-text-muted)] leading-relaxed">
                {drawerRow.rationale ?? drawerRow.opportunityDetail}
              </p>
            </div>
          )}

          <div className="bg-[var(--surface-3)] rounded-[var(--radius-lg)] p-3">
            <div className="t-caption-sm font-medium text-[var(--brand-text-muted)] uppercase tracking-wider mb-1.5">Next move</div>
            <p className="t-body text-[var(--brand-text)] leading-relaxed mb-3">
              {drawerRow.nextMoveDetail}
            </p>
            {drawerRow.role === 'content' && (
              <Button variant="primary" size="sm" onClick={() => { onTabChange?.('content'); closeDrawer(); }}>
                Request content
              </Button>
            )}
            {(drawerRow.role === 'page' || drawerRow.role === 'strategy') && drawerRow.pagePath && (
              <Button variant="secondary" size="sm" onClick={() => { onTabChange?.('health'); closeDrawer(); }}>
                Go to page
              </Button>
            )}
          </div>

          <div>
            <button
              type="button"
              className="flex items-center gap-1.5 t-caption-sm text-[var(--brand-text-muted)] hover:text-[var(--brand-text-bright)] transition-colors"
              onClick={() => setDrawerEvidenceOpen(v => !v)}
              aria-expanded={drawerEvidenceOpen}
            >
              <ChevronDown className={`w-3.5 h-3.5 transition-transform ${drawerEvidenceOpen ? '' : '-rotate-90'}`} />
              See the numbers
            </button>
            {drawerEvidenceOpen && (
              <div className="mt-2 flex flex-col gap-2.5">
                {!unenriched && (
                  <div className="flex flex-wrap gap-x-4 gap-y-1">
                    {drawerRow.volume != null && (
                      <span className="t-caption text-[var(--brand-text-muted)]">
                        Volume: <span className="text-[var(--brand-text)]">{drawerRow.volume ? `${fmtNum(drawerRow.volume)}/mo` : '—'}</span>
                      </span>
                    )}
                    {drawerRow.difficulty != null && (
                      <span className="t-caption text-[var(--brand-text-muted)]">
                        KD: <span className="text-[var(--brand-text)]">{drawerRow.difficulty}</span>
                      </span>
                    )}
                  </div>
                )}
                {drawerRow.contextSources.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {drawerRow.searchIntent && (
                      <span className={`px-2 py-0.5 rounded-[var(--radius-sm)] border t-caption capitalize ${intentColor(drawerRow.searchIntent)}`}>
                        {drawerRow.searchIntent} intent
                      </span>
                    )}
                    {drawerRow.contextSources.map(src => (
                      <span
                        key={src}
                        className="px-2 py-0.5 bg-[var(--surface-3)] border border-[var(--brand-border)] rounded-[var(--radius-sm)] t-caption text-[var(--brand-text-muted)]"
                      >
                        {SIGNAL_LABELS[src] ?? src}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="px-4 py-3 border-t border-[var(--brand-border)] flex-shrink-0">
          {isConfirmed ? (
            <button
              type="button"
              className="t-caption text-[var(--brand-text-muted)] hover:text-red-400 transition-colors disabled:opacity-50"
              disabled={isRemoving}
              onClick={async () => {
                await removePriorityKeyword(drawerRow);
                closeDrawer();
              }}
            >
              {isRemoving ? 'Removing…' : 'Remove from strategy'}
            </button>
          ) : (
            <div className="flex items-center gap-3">
              <Button
                variant="primary"
                size="sm"
                loading={addingKeyword}
                disabled={addingKeyword}
                onClick={async () => { await addStrategyKeyword(drawerRow.label); closeDrawer(); }}
              >
                Add to strategy
              </Button>
              <button
                type="button"
                className="t-caption text-[var(--brand-text-muted)] hover:text-[var(--brand-text-bright)] transition-colors disabled:opacity-40"
                disabled={isLoadingFeedback(drawerRow.label)}
                onClick={async () => { await submitFeedback(drawerRow.label, 'declined', 'suggestion'); closeDrawer(); }}
              >
                Dismiss
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
