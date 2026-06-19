import type { ReactNode } from 'react';
import type { NavigateFunction } from 'react-router-dom';
import { ArrowUpRight, BarChart3 } from 'lucide-react';
import { SectionCard, CompactStatBar, ClickableRow, Icon, EmptyState } from '../ui';
import { RankingDistribution } from './RankingDistribution';
import { adminPath } from '../../routes';
import type { StrategyMetrics } from './types';

/** flag-ON: keyword surfaces injected at the top of the "Keywords & Rankings" tab. */
interface KeywordSurfaces {
  siteKeywords: ReactNode;
  opportunities: ReactNode;
  clientFeedback: ReactNode;
}

interface StrategyRankingsTabProps {
  metrics: StrategyMetrics;
  workspaceId: string;
  navigate: NavigateFunction;
  /**
   * flag-ON only: if provided, the tab renders as "Keywords & Rankings" with a Hub deep-link
   * at the very top, followed by these keyword surfaces, then the existing distribution/movements.
   * flag-OFF: omit this prop — the tab renders as today's thin Rankings summary.
   */
  keywordSurfaces?: KeywordSurfaces;
}

/**
 * Strategy Rankings tab.
 *
 * flag-OFF ("Rankings"): SUMMARY of ranking position + movements that deep-links into the
 * Keyword Hub for the actual tracking (history, alerts, per-keyword management). Deliberately
 * does NOT rebuild the Hub: distribution + movements + "open the Hub" deep-link only.
 *
 * flag-ON ("Keywords & Rankings"): Hub deep-link at top, then SiteTargetKeywords + KeywordOpportunities
 * + ClientKeywordFeedback + IntelligenceSignals, then existing distribution/movements below.
 */
export function StrategyRankingsTab({ metrics, workspaceId, navigate, keywordSurfaces }: StrategyRankingsTabProps) {
  const commandCenterEnabled = !!keywordSurfaces;

  // flag-ON empty state: still useful — keyword surfaces render even without ranking data.
  if (metrics.ranked.length === 0 && !commandCenterEnabled) {
    return (
      <EmptyState
        icon={BarChart3}
        title="No ranking data yet"
        description="Connect Search Console and refresh your strategy to see ranking distribution and movements."
      />
    );
  }

  const m = metrics.movements;

  // flag-ON: "Hub deep-link at top" link (reuses the same adminPath helper as the bottom link).
  const hubLinkTop = commandCenterEnabled ? (
    <ClickableRow
      onClick={() => navigate(adminPath(workspaceId, 'seo-keywords'))}
      title="Open the Keyword Hub"
      className="flex items-center justify-between gap-2 t-caption text-accent-brand hover:text-teal-300 transition-colors px-1 -mx-1"
    >
      <span>Full keyword tracking, history &amp; alerts → Keyword Hub</span>
      <Icon as={ArrowUpRight} size="sm" />
    </ClickableRow>
  ) : null;

  return (
    <div className="space-y-8">
      {/* flag-ON: Hub deep-link + keyword surfaces ABOVE distribution/movements */}
      {commandCenterEnabled && (
        <>
          {hubLinkTop}
          {keywordSurfaces!.siteKeywords}
          {keywordSurfaces!.opportunities}
          {keywordSurfaces!.clientFeedback}
        </>
      )}

      {/* Ranking distribution — only when ranking data exists */}
      {metrics.ranked.length > 0 && (
        <>
          <RankingDistribution
            filteredPageMap={metrics.filteredPageMap}
            ranked={metrics.ranked}
            top3={metrics.top3}
            top10={metrics.top10}
            top20={metrics.top20}
            beyond20={metrics.beyond20}
            notRankingCount={metrics.notRankingCount}
            intentCounts={metrics.intentCounts}
            workspaceId={workspaceId}
            navigate={navigate}
          />

          {/* Movements only render when there is REAL movement data. `previousPosition` is rotated on
              each strategy refresh server-side (persistKeywordStrategy → page_keywords), so the first
              refresh has no prior to compare against and every page is "New" — this gate hides the
              misleading all-zero / all-"New" card until a second refresh produces real improved/declined/lost. */}
          {(m.improved + m.declined + m.lost) > 0 && (
            <SectionCard
              title="Position movements"
              titleExtra={<span className="t-caption-sm text-[var(--brand-text-muted)] ml-2">since the previous refresh</span>}
            >
              <CompactStatBar
                className="bg-[var(--surface-3)]/40"
                items={[
                  { label: 'Improved', value: m.improved, valueColor: 'text-emerald-400' },
                  { label: 'Declined', value: m.declined, valueColor: 'text-red-400' },
                  { label: 'New', value: m.new, valueColor: 'text-blue-400' },
                  { label: 'Lost', value: m.lost, valueColor: 'text-[var(--brand-text-muted)]' },
                ]}
              />
            </SectionCard>
          )}
        </>
      )}

      {/* flag-OFF: bottom Hub deep-link (today's behaviour). flag-ON: already shown at top. */}
      {!commandCenterEnabled && (
        <ClickableRow
          onClick={() => navigate(adminPath(workspaceId, 'seo-keywords'))}
          title="Open the Keyword Hub"
          className="flex items-center justify-between gap-2 t-caption text-accent-brand hover:text-teal-300 transition-colors px-1 -mx-1"
        >
          <span>Full keyword tracking, history &amp; alerts live in the Keyword Hub</span>
          <Icon as={ArrowUpRight} size="sm" />
        </ClickableRow>
      )}
    </div>
  );
}
