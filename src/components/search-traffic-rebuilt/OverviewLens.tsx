// @ds-rebuilt
import { BarChart3, MousePointerClick, Search, Users } from 'lucide-react';
import { useMemo } from 'react';
import { AnnotatedTrendChart, type TrendLine } from '../charts/AnnotatedTrendChart';
import { InsightFeed } from '../insights';
import { Badge, ChartCard, EmptyState, GroupBlock, InlineBanner, KeyValueRow, Skeleton } from '../ui';
import { useAnalyticsOverview } from '../../hooks/admin/useAnalyticsOverview';
import { useInsightFeed } from '../../hooks/admin/useInsightFeed';
import { useToggleSet } from '../../hooks/useToggleSet';
import { SparkMetricTile } from './SparkMetricTile';
import type { SearchTrafficSearchData } from './types';
import {
  SERIES,
  buildSparkline,
  formatNumber,
  formatPercent,
  formatPosition,
} from './searchTrafficUtils';

interface OverviewLensProps {
  workspaceId: string;
  siteId?: string;
  gscPropertyUrl?: string;
  ga4PropertyId?: string;
  days: number;
  searchData: SearchTrafficSearchData;
}

type OverviewMetricKey = 'clicks' | 'impressions' | 'ctr' | 'position' | 'users' | 'sessions';

const OVERVIEW_LINES: TrendLine[] = [
  { key: 'clicks', color: SERIES.clicks, yAxisId: 'left', label: 'Clicks' },
  { key: 'impressions', color: SERIES.impressions, yAxisId: 'left', label: 'Impressions' },
  { key: 'ctr', color: SERIES.ctr, yAxisId: 'right', label: 'CTR' },
  { key: 'position', color: SERIES.position, yAxisId: 'right', label: 'Position' },
  { key: 'users', color: SERIES.users, yAxisId: 'left', label: 'Users' },
  { key: 'sessions', color: SERIES.sessions, yAxisId: 'left', label: 'Sessions' },
];

function LoadingGrid() {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6" aria-label="Loading overview metrics">
      {Array.from({ length: 6 }).map((_, index) => <Skeleton key={index} className="h-[92px] w-full" />)}
    </div>
  );
}

export function OverviewLens({
  workspaceId,
  siteId,
  gscPropertyUrl,
  ga4PropertyId,
  days,
  searchData,
}: OverviewLensProps) {
  const overview = useAnalyticsOverview(workspaceId, siteId, gscPropertyUrl, ga4PropertyId, days);
  const { feed, summary, isLoading: feedLoading } = useInsightFeed(workspaceId);
  const [activeLines, toggleLine] = useToggleSet(['clicks', 'users']);

  const visibleMetricKeys = useMemo(() => {
    const keys = new Set<OverviewMetricKey>();
    if (overview.hasGsc) {
      keys.add('clicks');
      keys.add('impressions');
      keys.add('ctr');
      keys.add('position');
    }
    if (overview.hasGa4) {
      keys.add('users');
      keys.add('sessions');
    }
    return keys;
  }, [overview.hasGa4, overview.hasGsc]);

  if (overview.isLoading) {
    return (
      <div className="flex flex-col gap-4">
        <LoadingGrid />
        <Skeleton className="h-[320px] w-full" />
      </div>
    );
  }

  if (!overview.hasGsc && !overview.hasGa4) {
    return (
      <EmptyState
        icon={BarChart3}
        title="No analytics connected"
        description="Connect Search Console or GA4 in Workspace Settings before reviewing traffic."
      />
    );
  }

  const effectiveActive = new Set([...activeLines].filter((key) => visibleMetricKeys.has(key as OverviewMetricKey)));
  const chartLines = OVERVIEW_LINES
    .filter((line) => visibleMetricKeys.has(line.key as OverviewMetricKey))
    .map((line) => ({ ...line, active: effectiveActive.has(line.key) }));
  const brandedDemand = searchData.overview?.brandedDemand;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        {overview.hasGsc && (
          <>
            <SparkMetricTile
              label="Clicks"
              value={formatNumber(overview.gscClicks)}
              sparkline={buildSparkline(overview.trendData, (row) => row.clicks)}
              sparklineLabel="Search clicks daily trend"
              delta={overview.gscClicksDelta ?? undefined}
              deltaLabel="vs prior"
              accent={SERIES.clicks}
              icon={MousePointerClick}
              onClick={() => toggleLine('clicks')}
              className={effectiveActive.has('clicks') ? 'border-[var(--teal)]' : undefined}
            />
            <SparkMetricTile
              label="Impressions"
              value={formatNumber(overview.gscImpressions)}
              sparkline={buildSparkline(overview.trendData, (row) => row.impressions)}
              sparklineLabel="Search impressions daily trend"
              delta={overview.gscImpressionsDelta ?? undefined}
              deltaLabel="vs prior"
              accent={SERIES.impressions}
              icon={Search}
              onClick={() => toggleLine('impressions')}
              className={effectiveActive.has('impressions') ? 'border-[var(--teal)]' : undefined}
            />
            <SparkMetricTile
              label="CTR"
              value={formatPercent(searchData.overview?.avgCtr)}
              sparkline={buildSparkline(overview.trendData, (row) => row.ctr)}
              sparklineLabel="Search CTR daily trend"
              delta={searchData.comparison?.change.ctr}
              deltaLabel="pt"
              accent={SERIES.ctr}
              onClick={() => toggleLine('ctr')}
              className={effectiveActive.has('ctr') ? 'border-[var(--teal)]' : undefined}
            />
            <SparkMetricTile
              label="Position"
              value={formatPosition(overview.gscPosition)}
              sparkline={buildSparkline(overview.trendData, (row) => row.position)}
              sparklineLabel="Search position daily trend"
              delta={overview.gscPositionDelta ?? undefined}
              deltaLabel="spots"
              invertDelta
              accent={SERIES.position}
              onClick={() => toggleLine('position')}
              className={effectiveActive.has('position') ? 'border-[var(--teal)]' : undefined}
            />
          </>
        )}
        {overview.hasGa4 && (
          <>
            <SparkMetricTile
              label="Users"
              value={formatNumber(overview.ga4Users)}
              sparkline={buildSparkline(overview.trendData, (row) => row.users)}
              sparklineLabel="GA4 users daily trend"
              delta={overview.ga4UsersDelta ?? undefined}
              deltaLabel="vs prior"
              accent={SERIES.users}
              icon={Users}
              onClick={() => toggleLine('users')}
              className={effectiveActive.has('users') ? 'border-[var(--teal)]' : undefined}
            />
            <SparkMetricTile
              label="Sessions"
              value={formatNumber(overview.ga4Sessions)}
              sparkline={buildSparkline(overview.trendData, (row) => row.sessions)}
              sparklineLabel="GA4 sessions daily trend"
              delta={overview.ga4SessionsDelta ?? undefined}
              deltaLabel="vs prior"
              accent={SERIES.sessions}
              onClick={() => toggleLine('sessions')}
              className={effectiveActive.has('sessions') ? 'border-[var(--teal)]' : undefined}
            />
          </>
        )}
      </div>

      {brandedDemand?.status === 'error' && (
        <InlineBanner tone="warning" title="Branded split may be stale">
          {brandedDemand.error ?? 'Search overview loaded, but the branded/non-branded split did not refresh.'}
        </InlineBanner>
      )}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.7fr)_minmax(320px,0.8fr)]">
        <ChartCard title="Search + traffic trend" action={<Badge label={`${days}d`} tone="zinc" variant="soft" size="sm" />}>
          {overview.trendData.length > 0 ? (
            <AnnotatedTrendChart
              data={overview.trendData}
              lines={chartLines}
              annotations={overview.annotations}
              onCreateAnnotation={(date, label, category) => overview.createAnnotation.mutate({ date, label, category })}
              onToggleLine={toggleLine}
              height={300}
            />
          ) : (
            <EmptyState icon={BarChart3} title="No trend points yet" description="The connected providers did not return daily trend rows for this window." />
          )}
        </ChartCard>

        <GroupBlock
          icon={Search}
          iconColor={SERIES.clicks}
          title="Demand mix"
          meta="Server-computed from Search Console query rows."
          stats={brandedDemand?.status === 'ready' ? [
            { label: 'branded', value: formatPercent(brandedDemand.branded?.sharePct), color: 'var(--teal)' },
            { label: 'non-brand', value: formatPercent(brandedDemand.nonBranded?.sharePct), color: 'var(--blue)' },
          ] : []}
        >
          {brandedDemand?.status === 'ready' ? (
            <div className="px-2 pb-2">
              <KeyValueRow label="Branded clicks" value={formatNumber(brandedDemand.branded?.clicks)} valueColor="var(--teal)" divider={false} />
              <KeyValueRow label="Non-branded clicks" value={formatNumber(brandedDemand.nonBranded?.clicks)} valueColor="var(--blue)" />
              <KeyValueRow label="Rows sampled" value={formatNumber(brandedDemand.queryRowsSampled)} />
              <p className="t-caption-sm text-[var(--brand-text-muted)]">
                Share uses impressions as the denominator; missing query rows remain in the non-branded remainder.
              </p>
            </div>
          ) : (
            <div className="px-2 pb-2 t-caption text-[var(--brand-text-muted)]">
              {brandedDemand?.status === 'error' ? 'Split unavailable for this refresh.' : 'Brand tokens were not available for this workspace.'}
            </div>
          )}
        </GroupBlock>
      </div>

      <ChartCard title="Priority insights">
        <InsightFeed
          feed={feed}
          summary={summary}
          loading={feedLoading}
          showPills
          workspaceId={workspaceId}
          limit={6}
        />
      </ChartCard>
    </div>
  );
}
