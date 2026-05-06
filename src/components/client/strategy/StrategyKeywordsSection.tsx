import { useEffect, useRef, useState } from 'react';
import { Target, Trash2, X } from 'lucide-react';
import { Button, EmptyState, Icon, SectionCard, Skeleton } from '../../ui';
import {
  ROLE_DISPLAY_LABELS,
  type PriorityKeywordItem,
  type StrategyKeywordTableRow,
} from './strategyKeywordDisplay';

interface StrategyKeywordsSectionProps {
  strategyKeywordRows: StrategyKeywordTableRow[];
  keywordIdeaRows: StrategyKeywordTableRow[];
  newTrackedKeyword: string;
  setNewTrackedKeyword: (keyword: string) => void;
  addingKeyword: boolean;
  removingKeyword: string | null;
  trackedKeywordsLoading: boolean;
  workspaceId?: string;
  openKeywordDrawer: string | null;
  closeDrawer: () => void;
  openOrSwapDrawer: (keyword: string) => void;
  addStrategyKeyword: (keyword: string, options?: { clearInput?: boolean }) => Promise<void>;
  removePriorityKeyword: (item: PriorityKeywordItem) => Promise<void>;
  submitFeedback: (keyword: string, status: 'approved' | 'declined', source: string) => Promise<void>;
  isLoadingFeedback: (keyword: string) => boolean;
}

function roleSubLabel(row: StrategyKeywordTableRow): string {
  const label = ROLE_DISPLAY_LABELS[row.role] ?? row.roleLabel;
  const hasMetrics = (row.volume != null && row.volume > 0) || (row.difficulty != null && row.difficulty > 0);
  if (!hasMetrics) return label;
  const parts: string[] = [label];
  if (row.volume != null && row.volume > 0) {
    parts.push(row.volume >= 1000 ? `${(row.volume / 1000).toFixed(1)}k/mo` : `${row.volume}/mo`);
  }
  if (row.difficulty != null && row.difficulty > 0) parts.push(`KD ${row.difficulty}`);
  return parts.join(' · ');
}

export function StrategyKeywordsSection({
  strategyKeywordRows,
  keywordIdeaRows,
  newTrackedKeyword,
  setNewTrackedKeyword,
  addingKeyword,
  removingKeyword,
  trackedKeywordsLoading,
  workspaceId,
  openKeywordDrawer,
  closeDrawer,
  openOrSwapDrawer,
  addStrategyKeyword,
  removePriorityKeyword,
  submitFeedback,
  isLoadingFeedback,
}: StrategyKeywordsSectionProps) {
  const kwListScrollRef = useRef<HTMLDivElement>(null);
  const [kwListOverflows, setKwListOverflows] = useState(false);

  // effect-layout-ok — overflow measurement depends on rendered DOM dimensions.
  useEffect(() => {
    const el = kwListScrollRef.current;
    if (!el) return;
    setKwListOverflows(el.scrollHeight > el.clientHeight);
  });

  const sortedConfirmed = [...strategyKeywordRows].sort(
    (a, b) => (b.opportunityScore ?? 0) - (a.opportunityScore ?? 0),
  );

  return (
    <SectionCard
      title="Strategy Keywords"
      titleIcon={<Icon as={Target} size="md" className="text-accent-brand" />}
      titleExtra={<span className="t-caption-sm text-[var(--brand-text-muted)]">{strategyKeywordRows.length} keyword{strategyKeywordRows.length === 1 ? '' : 's'} guiding tracking and recommendations</span>}
      noPadding
    >
      {workspaceId && (
        <div className="px-4 py-3 border-b border-[var(--brand-border)]">
          <form
            onSubmit={async e => {
              e.preventDefault();
              await addStrategyKeyword(newTrackedKeyword, { clearInput: true });
            }}
            className="flex gap-2"
          >
            <label htmlFor="strategy-keyword-input" className="sr-only">Add a strategy keyword</label>
            <input
              id="strategy-keyword-input"
              type="text"
              value={newTrackedKeyword}
              onChange={e => setNewTrackedKeyword(e.target.value)}
              placeholder="Search or add a keyword..."
              disabled={addingKeyword}
              className="flex-1 bg-[var(--surface-3)] border border-[var(--brand-border-strong)] rounded-[var(--radius-lg)] px-3 py-2 t-caption-sm text-[var(--brand-text)] placeholder:text-[var(--brand-text-muted)] focus:outline-none focus:border-teal-500 transition-colors"
              maxLength={120}
            />
            <Button
              type="submit"
              variant="primary"
              size="sm"
              loading={addingKeyword}
              disabled={addingKeyword || newTrackedKeyword.trim().length < 2}
            >
              Add
            </Button>
          </form>
        </div>
      )}

      <div className="relative px-4 py-3 flex flex-col gap-4">
        <div>
          <div className="t-label text-[var(--brand-text-muted)] mb-2">
            In strategy · {sortedConfirmed.length}
          </div>
          {trackedKeywordsLoading && sortedConfirmed.length === 0 ? (
            <div className="flex flex-col gap-1">
              <Skeleton className="h-[52px] rounded-[var(--radius-lg)]" />
              <Skeleton className="h-[52px] rounded-[var(--radius-lg)]" />
              <Skeleton className="h-[52px] rounded-[var(--radius-lg)]" />
            </div>
          ) : sortedConfirmed.length === 0 ? (
            <EmptyState
              icon={Target}
              title="No keywords in strategy yet"
              description="Add your first keyword above to start tracking and shaping recommendations."
            />
          ) : (
            <div className="relative">
              <div ref={kwListScrollRef} className="max-h-[420px] overflow-y-auto flex flex-col gap-1">
                {sortedConfirmed.map(row => {
                  const isOpen = openKeywordDrawer === row.normalized;
                  const isRemoving = removingKeyword === row.normalized;
                  return (
                    <div
                      key={row.normalized}
                      role="button"
                      tabIndex={0}
                      className={`flex items-center gap-3 px-3 py-2.5 rounded-[var(--radius-lg)] cursor-pointer transition-colors ${
                        isOpen
                          ? 'bg-[var(--surface-3)] border border-teal-500/40 ring-1 ring-teal-500/10'
                          : 'bg-[var(--surface-3)] border border-transparent hover:border-[var(--brand-border)]'
                      }`}
                      onClick={() => { if (isOpen) closeDrawer(); else openOrSwapDrawer(row.normalized); }}
                      onKeyDown={e => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          if (isOpen) closeDrawer(); else openOrSwapDrawer(row.normalized);
                        }
                      }}
                    >
                      <div
                        aria-hidden="true"
                        className={`w-1.5 h-1.5 rounded-[var(--radius-pill)] flex-shrink-0 mt-0.5 ${
                          row.role === 'content' ? 'bg-emerald-400' :
                          row.role === 'page' ? 'bg-blue-400' :
                          row.role === 'strategy' ? 'bg-teal-400' :
                          'bg-[var(--brand-text-muted)]'
                        }`}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="t-ui font-medium text-[var(--brand-text-bright)] truncate">{row.label}</div>
                        <div className="t-caption text-[var(--brand-text-muted)] truncate">
                          {roleSubLabel(row)}{row.enrichmentStatus === 'unenriched' ? ' · data pending' : ''}
                        </div>
                      </div>
                      {isOpen ? (
                        <span className="text-teal-400 t-caption flex-shrink-0 select-none">→</span>
                      ) : (
                        <button
                          type="button"
                          aria-label={`Remove ${row.label} from strategy`}
                          title="Remove from strategy"
                          className="flex-shrink-0 w-7 h-7 flex items-center justify-center rounded-[var(--radius-sm)] text-[var(--brand-text-muted)] hover:text-red-400 hover:bg-[var(--surface-2)] transition-colors disabled:opacity-40"
                          disabled={isRemoving}
                          onClick={e => {
                            e.stopPropagation();
                            void removePriorityKeyword(row);
                          }}
                        >
                          <Icon as={Trash2} size="xs" />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
              {kwListOverflows && (
                <div className="pointer-events-none absolute bottom-0 left-0 right-0 h-12 bg-gradient-to-t from-[var(--surface-2)] to-transparent" />
              )}
            </div>
          )}
        </div>

        <div>
          <div className="t-label text-[var(--brand-text-muted)] mb-2">
            Suggestions · {keywordIdeaRows.length}
          </div>
          {keywordIdeaRows.length === 0 ? (
            <p className="t-caption text-[var(--brand-text-muted)]">
              No suggestions right now — check back after your next data sync.
            </p>
          ) : (
            <div className="flex flex-col gap-1">
              {keywordIdeaRows.map(row => (
                <div
                  key={row.normalized}
                  role="button"
                  tabIndex={0}
                  className="relative overflow-hidden flex items-center gap-3 px-3 py-2.5 rounded-[var(--radius-lg)] bg-blue-500/5 border border-blue-500/20 cursor-pointer hover:border-blue-500/30 transition-colors"
                  onClick={() => { if (openKeywordDrawer === row.normalized) closeDrawer(); else openOrSwapDrawer(row.normalized); }}
                  onKeyDown={e => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      if (openKeywordDrawer === row.normalized) closeDrawer(); else openOrSwapDrawer(row.normalized);
                    }
                  }}
                >
                  <div
                    aria-hidden="true"
                    className="absolute left-0 top-0 bottom-0 w-0.5 bg-blue-400 rounded-l-[var(--radius-lg)]"
                    style={{ opacity: Math.max(0.2, Math.min(1, (row.opportunityScore ?? 0) / 100)) }}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="t-ui font-medium text-[var(--brand-text-bright)] truncate">{row.label}</div>
                    {((row.volume != null && row.volume > 0) || (row.difficulty != null && row.difficulty > 0)) && (
                      <div className="t-caption text-[var(--brand-text-muted)] truncate">
                        {[
                          (row.volume != null && row.volume > 0) && (row.volume >= 1000 ? `${(row.volume / 1000).toFixed(1)}k/mo` : `${row.volume}/mo`),
                          (row.difficulty != null && row.difficulty > 0) && `KD ${row.difficulty}`,
                        ].filter(Boolean).join(' · ')}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <button
                      type="button"
                      aria-label={`Add ${row.label} to strategy`}
                      className="t-caption text-teal-400 hover:text-teal-300 transition-colors whitespace-nowrap disabled:opacity-40"
                      disabled={addingKeyword}
                      onClick={e => {
                        e.stopPropagation();
                        void addStrategyKeyword(row.label);
                      }}
                    >
                      Add to strategy
                    </button>
                    <button
                      type="button"
                      aria-label={`Dismiss ${row.label}`}
                      className="w-6 h-6 flex items-center justify-center text-[var(--brand-text-muted)] hover:text-[var(--brand-text)] transition-colors disabled:opacity-40"
                      disabled={isLoadingFeedback(row.label)}
                      onClick={e => {
                        e.stopPropagation();
                        void submitFeedback(row.label, 'declined', 'suggestion');
                      }}
                    >
                      <Icon as={X} size="xs" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </SectionCard>
  );
}
