// @ds-rebuilt
import { BarChart3, MousePointerClick, Search, Users } from 'lucide-react';
import { useMemo } from 'react';
import { AnnotatedTrendChart, type TrendLine } from '../charts/AnnotatedTrendChart';
import { Badge, ChartCard, EmptyState, Skeleton } from '../ui';
import { useAnalyticsOverviewFromData } from '../../hooks/admin/useAnalyticsOverview';
import { useInsightFeed } from '../../hooks/admin/useInsightFeed';
import { useToggleSet } from '../../hooks/useToggleSet';
import { SearchContextBand } from './SearchContextBand';
import { SparkMetricTile } from './SparkMetricTile';
import type { SearchTrafficGa4Data, SearchTrafficSearchData } from './types';
import {
  SERIES,
  buildSparkline,
  formatNumber,
  formatPercent,
  formatPosition,
} from './searchTrafficUtils';

interface OverviewLensProps {
  workspaceId: string;
  gscPropertyUrl?: string;
  ga4PropertyId?: string;
  days: number;
  searchData: SearchTrafficSearchData;
  ga4Data: SearchTrafficGa4Data;
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
  gscPropertyUrl,
  ga4PropertyId,
  days,
  searchData,
  ga4Data,
}: OverviewLensProps) {
  const overview = useAnalyticsOverviewFromData(workspaceId, searchData, ga4Data, {
    gsc: !!gscPropertyUrl,
    ga4: !!ga4PropertyId,
  });
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

      <div>
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
      </div>

      <SearchContextBand
        workspaceId={workspaceId}
        brandedDemand={brandedDemand}
        feed={feed}
        summary={summary}
        loading={feedLoading}
      />
    </div>
  );
}
