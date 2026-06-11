import { TrendingUp } from 'lucide-react'; // trend-icon-ok — decorative section icon, not a metric trend indicator
import { ChartCard, EmptyState, Icon, Skeleton, TierGate, tierAtLeast, type Tier } from '../../ui';
import { RankHistoryChart } from '../../shared/RankTable';
import { TRACKED_KEYWORD_SOURCE, type TrackedKeyword } from '../../../../shared/types/rank-tracking';
import { useRequestedKeywordRankTrend } from './useRequestedKeywordRankTrend';

interface StrategyRequestedKeywordTrendSectionProps {
  workspaceId?: string;
  trackedKeywords: TrackedKeyword[];
  effectiveTier: Tier;
}

/**
 * A4 (audit #15): 180-day rank trend for the keywords the client requested
 * themselves. Closes the feedback loop on "Add a keyword you care about" —
 * after requesting a keyword, the client can watch its ranking move here.
 * Renders nothing when the client has not requested any keywords; the growth
 * TierGate is applied INSIDE that check so free-tier clients never see an
 * upsell card for a feature they have no data for (gate-scope minimality).
 */
export function StrategyRequestedKeywordTrendSection({
  workspaceId,
  trackedKeywords,
  effectiveTier,
}: StrategyRequestedKeywordTrendSectionProps) {
  const requestedKeywords = trackedKeywords
    .filter(keyword => keyword.source === TRACKED_KEYWORD_SOURCE.CLIENT_REQUESTED)
    .map(keyword => keyword.query);

  // Don't fetch when tier-locked — the gate renders a teaser, not the chart.
  const tierAllowed = tierAtLeast(effectiveTier, 'growth');
  const trendQuery = useRequestedKeywordRankTrend({
    workspaceId,
    keywords: tierAllowed ? requestedKeywords : [],
  });

  if (requestedKeywords.length === 0) return null;

  const history = trendQuery.data ?? [];
  // Days with at least one position reading for a requested keyword.
  const seriesDays = history.filter(entry => Object.keys(entry.positions).length > 0);
  const hasSeries = seriesDays.length >= 2;

  const card = (
    <ChartCard
      title="Your requested keywords"
      titleIcon={(
        <div className="w-6 h-6 rounded-[var(--radius-lg)] bg-blue-500/20 flex items-center justify-center">
          <Icon as={TrendingUp} size="md" className="text-blue-400" />
        </div>
      )}
    >
      <p className="t-caption-sm text-[var(--brand-text-muted)] mb-3">
        Ranking positions over the last 180 days for keywords you asked us to target. Lower is better — position 1 is the top of Google.
      </p>
      {trendQuery.isLoading ? (
        <Skeleton className="h-28 w-full" />
      ) : hasSeries ? (
        <RankHistoryChart rankHistory={seriesDays} maxKeywords={5} />
      ) : (
        <EmptyState
          icon={TrendingUp}
          title="No ranking data yet"
          description="We track your requested keywords daily. Trend data appears here once a few ranking snapshots are collected — usually within a week."
        />
      )}
    </ChartCard>
  );

  return (
    <TierGate
      tier={effectiveTier}
      required="growth"
      feature="Requested Keyword Trends"
      teaser={`${requestedKeywords.length} requested keyword${requestedKeywords.length === 1 ? '' : 's'}`}
    >
      {card}
    </TierGate>
  );
}
