/**
 * OpportunitiesList — the Act band's merged, actionable opportunity surface.
 *
 * Replaces the two separate Quick Wins + Low-Hanging Fruit cards (legacy layout) with one
 * SectionCard carrying both as labeled subsections, plus a per-row "Optimize page" Fix CTA
 * that deep-links into Page Intelligence (auto-expands the page via fixContext.pageSlug).
 * Rendered only in the decision-bands layout (flag on). Quick Wins that already own a page
 * suppress the duplicate Low-Hanging Fruit row (see buildOpportunityRows).
 */
import { useNavigate } from 'react-router-dom';
import { Zap, ArrowUpRight } from 'lucide-react';
import { Button, Icon, SectionCard, positionColor } from '../ui';
import { adminPath } from '../../routes';
import { buildOpportunityRows } from './buildOpportunityRows';
import type { OpportunitiesListProps } from './types';

export function OpportunitiesList({ quickWins, lowHangingFruit, workspaceId }: OpportunitiesListProps) {
  const navigate = useNavigate();
  const rows = buildOpportunityRows(quickWins, lowHangingFruit);
  if (rows.length === 0) return null;

  const optimize = (pagePath: string) =>
    navigate(adminPath(workspaceId, 'page-intelligence'), {
      state: { fixContext: { targetRoute: 'page-intelligence', pageSlug: pagePath, pageName: pagePath } },
    });

  const fixButton = (pagePath: string) => (
    <Button
      onClick={() => optimize(pagePath)}
      variant="ghost"
      size="sm"
      className="gap-1 px-2.5 py-1 rounded-[var(--radius-lg)] bg-teal-600/20 border border-teal-500/30 t-caption-sm text-teal-300 font-medium hover:bg-teal-600/40 flex-shrink-0"
    >
      <Icon as={ArrowUpRight} size="sm" className="text-teal-300" /> Optimize page
    </Button>
  );

  const quickWinRows = rows.filter(r => r.kind === 'quick_win');
  const lhfRows = rows.filter(r => r.kind === 'low_hanging');

  return (
    <SectionCard id="quick-wins-section" title="Opportunities" titleIcon={<Icon as={Zap} size="md" className="text-accent-brand" />}>
      <p className="t-caption-sm text-[var(--brand-text-muted)] mb-3">High-impact changes to make now — ranked by expected return.</p>

      {quickWinRows.length > 0 && (
        <div className="mb-4">
          <h5 className="t-caption-sm font-semibold text-emerald-300 mb-2 flex items-center gap-1.5">
            <Icon as={Zap} size="sm" className="text-emerald-300" /> Quick Wins
          </h5>
          <div className="space-y-2">
            {quickWinRows.map((row, i) => {
              if (row.kind !== 'quick_win') return null;
              const impactColor = row.estimatedImpact === 'high'
                ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20'
                : row.estimatedImpact === 'medium'
                  ? 'text-amber-400 bg-amber-500/10 border-amber-500/20'
                  : 'text-[var(--brand-text)] bg-[var(--surface-3)]/30 border-[var(--brand-border)]/20';
              return (
                <div key={`qw-${i}`} className="px-3 py-2.5 bg-[var(--surface-3)]/40 rounded-[var(--radius-lg)] border border-[var(--brand-border)]">
                  <div className="flex items-center justify-between gap-2">
                    <span className="t-mono text-[var(--brand-text-muted)] truncate">{row.pagePath}</span>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className={`t-caption-sm font-medium px-1.5 py-0.5 rounded border ${impactColor}`}>{row.estimatedImpact} impact</span>
                      {row.roiScore != null && row.roiScore > 0 && (
                        <span className="t-mono text-blue-400 bg-blue-500/10 border border-blue-500/20 px-1.5 py-0.5 rounded">ROI {row.roiScore}</span>
                      )}
                    </div>
                  </div>
                  <div className="t-caption-sm text-[var(--brand-text-bright)] mt-1 font-medium">{row.action}</div>
                  <div className="flex items-end justify-between gap-3 mt-0.5">
                    <div className="t-caption-sm text-[var(--brand-text-muted)]">{row.rationale}</div>
                    {fixButton(row.pagePath)}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {lhfRows.length > 0 && (
        <div>
          <h5 className="t-caption-sm font-semibold text-amber-300 mb-2 flex items-center gap-1.5">
            <Icon as={Zap} size="sm" className="text-amber-300" /> Low-Hanging Fruit
          </h5>
          <p className="t-caption-sm text-[var(--brand-text-muted)] mb-2">Pages ranking #4–20 with impressions — small improvements drive major traffic gains.</p>
          <div className="space-y-1.5">
            {lhfRows.map((row, i) => {
              if (row.kind !== 'low_hanging') return null;
              return (
                <div key={`lhf-${i}`} className="flex items-center justify-between gap-3 px-3 py-2 bg-[var(--surface-3)]/50 rounded-[var(--radius-lg)]">
                  <div className="flex-1 min-w-0">
                    <div className="t-caption-sm text-[var(--brand-text-bright)] truncate">{row.pageTitle}</div>
                    <div className="t-mono text-[var(--brand-text-muted)] truncate">{row.pagePath}</div>
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0">
                    <span className="t-caption-sm text-teal-400 bg-teal-500/10 px-1.5 py-0.5 rounded truncate max-w-[160px]">{row.primaryKeyword}</span>
                    <span className={`t-mono font-medium ${positionColor(row.currentPosition)}`}>#{row.currentPosition?.toFixed(0)}</span>
                    <span className="t-caption-sm text-[var(--brand-text-muted)]">{(row.impressions || 0).toLocaleString()} imp</span>
                    {fixButton(row.pagePath)}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </SectionCard>
  );
}
