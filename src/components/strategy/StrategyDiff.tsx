import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Badge, Button, ClickableRow, Icon, InlineBanner } from '../ui';
import { RefreshCw, Plus, Minus, ArrowRight, ArrowUpRight, ChevronDown, Eye, Lightbulb } from 'lucide-react';
import { keywords } from '../../api/seo';
import { formatDate } from '../../utils/formatDates';
import { adminPath } from '../../routes';
import { queryKeys } from '../../lib/queryKeys';
import { strategyNextActionTarget } from '../../lib/strategyNextActionTarget';

export interface StrategyDiffProps {
  workspaceId: string;
  defaultExpanded?: boolean;
}

export function StrategyDiff({ workspaceId, defaultExpanded = false }: StrategyDiffProps) {
  const navigate = useNavigate();
  const [expandedOverride, setExpandedOverride] = useState<boolean | null>(null);
  const expanded = expandedOverride ?? defaultExpanded;

  // useQuery (keyed on admin.strategyDiff) so the diff refetches when a strategy regen broadcasts
  // strategy:updated — strategyMutationKeys invalidates this key. The previous raw useEffect never
  // re-fetched, leaving the diff stale until the component remounted.
  const { data: diff, isLoading: loading, isError, refetch } = useQuery({
    queryKey: queryKeys.admin.strategyDiff(workspaceId),
    queryFn: () => keywords.strategyDiff(workspaceId),
    enabled: !!workspaceId,
  });

  if (loading) return null;
  if (isError) {
    return defaultExpanded ? (
      <InlineBanner
        tone="error"
        title="Strategy comparison did not load"
        message="Retry the comparison before reviewing what changed."
        data-testid="strategy-diff-error"
      >
        <Button variant="link" size="sm" onClick={() => void refetch()}>
          Retry comparison
        </Button>
      </InlineBanner>
    ) : null;
  }
  if (!diff) {
    return defaultExpanded ? (
      <InlineBanner
        tone="info"
        title="No previous strategy comparison"
        message="The first comparison will appear after the next strategy refresh."
        data-testid="strategy-diff-empty"
      />
    ) : null;
  }

  const retired = (diff.summary?.deprecated ?? 0) + (diff.summary?.replaced ?? 0);
  const totalChanges = diff.summary
    ? diff.summary.added + diff.lostKeywords.length + diff.summary.reassigned + retired + diff.summary.newContentGaps + diff.summary.resolvedContentGaps
    : diff.newKeywords.length + diff.lostKeywords.length + diff.newGaps.length + diff.resolvedGaps.length + diff.keywordChanges.length;
  const hasChanges = totalChanges > 0 || (diff.summary?.preserved ?? 0) > 0 || diff.lostKeywords.length > 0;

  if (!hasChanges) {
    return defaultExpanded ? (
      <InlineBanner
        tone="info"
        title="No strategy changes since the last run"
        message="The current strategy matches the previous comparison."
        data-testid="strategy-diff-empty"
      />
    ) : null;
  }
  const explanationPreview = diff.explanations?.filter(explanation => !explanation.rawEvidenceOnly).slice(0, 3) ?? [];

  return (
    // pr-check-disable-next-line -- brand asymmetric signature on StrategyDiff "What Changed" callout; amber-bordered non-SectionCard chrome
    <div className="bg-[var(--surface-2)] border border-amber-500/20 overflow-hidden rounded-[var(--radius-signature-lg)]">
      <ClickableRow
        onClick={() => setExpandedOverride(!expanded)}
        aria-expanded={expanded}
        className="flex items-center justify-between px-4 py-3 hover:bg-[var(--surface-3)]/50"
      >
        <div className="flex items-center gap-2">
          <Icon as={RefreshCw} size="md" className="text-amber-400" />
          <span className="t-body font-semibold text-amber-300">What Changed</span>
          <span className="t-caption-sm text-[var(--brand-text-muted)]">
            {totalChanges} strategy update{totalChanges !== 1 ? 's' : ''} since {formatDate(diff.previousGeneratedAt)}
          </span>
        </div>
        <Icon as={ChevronDown} size="md" className={`text-[var(--brand-text-muted)] transition-transform ${expanded ? '' : '-rotate-90'}`} />
      </ClickableRow>

      {expanded && (
        <div className="px-4 pb-4 border-t border-[var(--brand-border)]/50 space-y-3 mt-3">
          {diff.summary && (
            <div className="grid grid-cols-2 md:grid-cols-5 gap-2 pt-3">
              {[
                ['Added', diff.summary.added + diff.summary.newContentGaps, 'text-emerald-400'],
                ['Retained', diff.summary.retained, 'text-blue-400'],
                ['Reassigned', diff.summary.reassigned, 'text-amber-400'],
                ['Retired', retired, 'text-red-400'],
                ['Preserved', diff.summary.preserved, 'text-teal-400'],
              ].map(([label, value, color]) => (
                <div key={label} className="rounded-[var(--radius-lg)] bg-[var(--surface-3)]/50 border border-[var(--brand-border)] px-3 py-2">
                  <div className={`t-page font-semibold ${color}`}>{value}</div>
                  <div className="t-caption-sm text-[var(--brand-text-muted)]">{label}</div>
                </div>
              ))}
            </div>
          )}

          {explanationPreview.length > 0 && (
            <div>
              <div className="t-micro text-[var(--brand-text-muted)] uppercase tracking-wider font-medium mb-1.5 flex items-center gap-1.5">
                <Icon as={Lightbulb} size="sm" className="text-teal-400" /> Why these matter
              </div>
              <div className="space-y-1.5">
                {explanationPreview.map(explanation => {
                  const target = strategyNextActionTarget(explanation);
                  return (
                    <div key={`${explanation.role}-${explanation.normalizedKeyword}`} className="rounded-[var(--radius-lg)] bg-[var(--surface-3)]/40 border border-[var(--brand-border)] px-3 py-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="t-caption font-medium text-[var(--brand-text-bright)]">{explanation.keyword}</span>
                        {target ? (
                          // Actionable next action → teal CTA (action-color law). Passive ones stay a Badge.
                          <Button
                            onClick={() => navigate(
                              adminPath(workspaceId, target.tab) + (target.search ?? ''),
                              target.fixContext ? { state: { fixContext: target.fixContext } } : undefined,
                            )}
                            variant="ghost"
                            size="sm"
                            className="gap-1 px-2.5 py-1 rounded-[var(--radius-lg)] bg-teal-600/20 border border-teal-500/30 t-caption-sm text-teal-300 font-medium hover:bg-teal-600/40 flex-shrink-0"
                            aria-label={`${explanation.nextAction.label}: ${explanation.keyword}`}
                          >
                            {explanation.nextAction.label} <Icon as={ArrowUpRight} size="sm" className="text-teal-300" />
                          </Button>
                        ) : (
                          // watch / review_evidence — informational, neutral tone (not a CTA).
                          <Badge tone="zinc" size="sm" label={explanation.nextAction.label} />
                        )}
                      </div>
                      <p className="t-caption-sm text-[var(--brand-text-muted)] mt-1">{explanation.reasons[0]}</p>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {diff.rawEvidenceNote && (
            <div className="flex items-start gap-2 rounded-[var(--radius-lg)] border border-blue-500/20 bg-blue-500/10 px-3 py-2">
              <Icon as={Eye} size="sm" className="text-blue-400 mt-0.5" />
              <p className="t-caption-sm text-blue-200">{diff.rawEvidenceNote}</p>
            </div>
          )}

          {/* New site keywords */}
          {diff.newKeywords.length > 0 && (
            <div>
              <div className="t-micro text-[var(--brand-text-muted)] uppercase tracking-wider font-medium mb-1.5">New Keywords</div>
              <div className="flex flex-wrap gap-1">
                {diff.newKeywords.map(kw => (
                  <span key={kw} className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/20 t-caption-sm text-emerald-400">
                    <Icon as={Plus} size="sm" />{kw}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Lost site keywords */}
          {diff.lostKeywords.length > 0 && (
            <div>
              <div className="t-micro text-[var(--brand-text-muted)] uppercase tracking-wider font-medium mb-1.5">Removed Keywords</div>
              <div className="flex flex-wrap gap-1">
                {diff.lostKeywords.map(kw => (
                  <span key={kw} className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded bg-red-500/10 border border-red-500/20 t-caption-sm text-red-400">
                    <Icon as={Minus} size="sm" />{kw}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* New content gaps */}
          {diff.newGaps.length > 0 && (
            <div>
              <div className="t-micro text-[var(--brand-text-muted)] uppercase tracking-wider font-medium mb-1.5">New Content Gaps</div>
              <div className="flex flex-wrap gap-1">
                {diff.newGaps.map(kw => (
                  <span key={kw} className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/20 t-caption-sm text-emerald-400">
                    <Icon as={Plus} size="sm" />{kw}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Resolved content gaps */}
          {diff.resolvedGaps.length > 0 && (
            <div>
              <div className="t-micro text-[var(--brand-text-muted)] uppercase tracking-wider font-medium mb-1.5">Resolved Gaps</div>
              <div className="flex flex-wrap gap-1">
                {diff.resolvedGaps.map(kw => (
                  <span key={kw} className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded bg-[var(--surface-3)]/30 border border-[var(--brand-border)]/20 t-caption-sm text-[var(--brand-text)] line-through">
                    {kw}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Keyword reassignments */}
          {diff.keywordChanges.length > 0 && (
            <div>
              <div className="t-micro text-[var(--brand-text-muted)] uppercase tracking-wider font-medium mb-1.5">Keyword Reassignments</div>
              <div className="space-y-1">
                {diff.keywordChanges.map((ch, i) => (
                  <div key={i} className="flex items-center gap-2 t-caption-sm px-2 py-1 bg-[var(--surface-3)]/40 rounded border border-[var(--brand-border)]">
                    <span className="t-mono text-[var(--brand-text-muted)] truncate max-w-[200px]">{ch.pagePath}</span>
                    <span className="text-amber-400">{ch.oldKeyword}</span>
                    <Icon as={ArrowRight} size="sm" className="text-[var(--brand-text-dim)] flex-shrink-0" />
                    <span className="text-teal-400">{ch.newKeyword}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
