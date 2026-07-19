// @ds-rebuilt
import { Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { getStrategyKeywordSet } from '../../api/keyword-strategy';
import { useInsightFeed } from '../../hooks/admin/useInsightFeed';
import { useAnalyticsAnnotations, useCreateAnnotation } from '../../hooks/admin/useAnalyticsAnnotations';
import { useToggleSet } from '../../hooks/useToggleSet';
import { queryKeys } from '../../lib/queryKeys';
import { normalizePageUrl } from '../../lib/pathUtils';
import { adminPath } from '../../routes';
import { useQuery } from '@tanstack/react-query';
import { AnnotatedTrendChart, type ChartCallout, type TrendLine } from '../charts/AnnotatedTrendChart';
import { InsightFeed } from '../insights';
import { AnomalyAlerts } from '../AnomalyAlerts';
import {
  Badge,
  Button,
  ChartCard,
  DataTable,
  Disclosure,
  EmptyState,
  Icon,
  InlineBanner,
  SearchField,
  Segmented,
  Skeleton,
} from '../ui';
import type { DataColumn } from '../ui';
import type { FeedInsight } from '../../../shared/types/insights';
import type { SearchPage, SearchQuery } from '../../../shared/types/analytics';
import { SparkMetricTile } from './SparkMetricTile';
import { SearchContextBand } from './SearchContextBand';
import { ReportSectionHeader } from './ReportSectionHeader';
import type { SearchTrafficSearchData, SearchTrafficTableMode } from './types';
import {
  SERIES,
  buildSparkline,
  formatNumber,
  formatPercent,
  formatPosition,
} from './searchTrafficUtils';

interface SearchLensProps {
  workspaceId: string;
  data: SearchTrafficSearchData;
  tableMode: SearchTrafficTableMode;
  onTableModeChange: (mode: SearchTrafficTableMode) => void;
  onOpenBreakdowns: () => void;
  configured: boolean;
}

const SEARCH_LINES: TrendLine[] = [
  { key: 'clicks', color: SERIES.clicks, yAxisId: 'left', label: 'Clicks' },
  { key: 'impressions', color: SERIES.impressions, yAxisId: 'left', label: 'Impressions' },
  { key: 'ctr', color: SERIES.ctr, yAxisId: 'right', label: 'CTR' },
  { key: 'position', color: SERIES.position, yAxisId: 'right', label: 'Position' },
  { key: 'clicksPrior', color: SERIES.previous, yAxisId: 'left', label: 'Prior clicks' },
];

const DETAIL_ROW_LIMIT = 25;

function badgeFor(insight: FeedInsight) {
  if (insight.type === 'ctr_opportunity') return { label: 'Low CTR', tone: 'red' as const };
  if (insight.type === 'ranking_opportunity') return { label: 'Near P1', tone: 'amber' as const };
  if (insight.type === 'ranking_mover') return { label: insight.severity === 'positive' ? 'Rank up' : 'Rank drop', tone: insight.severity === 'positive' ? 'emerald' as const : 'red' as const };
  if (insight.type === 'cannibalization') return { label: 'Cannibal', tone: 'amber' as const };
  if (insight.type === 'content_decay') return { label: 'Decay', tone: 'red' as const };
  return null;
}

function buildBadgeMap(feed: FeedInsight[]) {
  const map = new Map<string, ReturnType<typeof badgeFor>>();
  for (const item of feed) {
    if (item.domain !== 'search' && item.domain !== 'cross') continue;
    if (!item.pageUrl) continue;
    const badge = badgeFor(item);
    if (badge && !map.has(item.pageUrl)) map.set(item.pageUrl, badge);
  }
  return map;
}

function queryColumns(strategyKeywords: Set<string>, badgeMap: Map<string, ReturnType<typeof badgeFor>>): DataColumn[] {
  return [
    {
      key: 'query',
      label: 'Query',
      width: 'minmax(260px,2fr)',
      render: (value, row) => {
        const query = String(value);
        const badge = badgeMap.get(query);
        return (
          <div className="flex min-w-0 items-center gap-2">
            {strategyKeywords.has(query.toLowerCase()) && <Icon name="star" size="sm" className="flex-none text-[var(--teal)]" aria-label="Strategy keyword" />}
            <span className="whitespace-normal break-words text-[var(--brand-text-bright)]">{query}</span>
            {badge && <Badge label={badge.label} tone={badge.tone} variant="soft" size="sm" />}
            {row.position != null && Number(row.position) <= 20 && <Badge label="Top 20" tone="blue" variant="soft" size="sm" />}
          </div>
        );
      },
      sortable: true,
    },
    { key: 'clicks', label: 'Clicks', align: 'right', sortable: true, render: (value) => formatNumber(value as number) },
    { key: 'impressions', label: 'Impr.', align: 'right', sortable: true, render: (value) => formatNumber(value as number) },
    { key: 'ctr', label: 'CTR', align: 'right', sortable: true, render: (value) => formatPercent(value as number) },
    { key: 'position', label: 'Pos.', align: 'right', sortable: true, render: (value) => formatPosition(value as number) },
  ];
}

function pageColumns(badgeMap: Map<string, ReturnType<typeof badgeFor>>): DataColumn[] {
  return [
    {
      key: 'page',
      label: 'Page',
      width: 'minmax(280px,2fr)',
      render: (value) => {
        const page = String(value);
        const badge = badgeMap.get(page);
        return (
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate font-mono text-[var(--brand-text-bright)]">{normalizePageUrl(page)}</span>
            <a href={page} target="_blank" rel="noopener noreferrer" className="text-[var(--brand-text-muted)] hover:text-[var(--teal)]">
              <Icon name="external" size="sm" aria-label="Open page" />
            </a>
            {badge && <Badge label={badge.label} tone={badge.tone} variant="soft" size="sm" />}
          </div>
        );
      },
      sortable: true,
    },
    { key: 'clicks', label: 'Clicks', align: 'right', sortable: true, render: (value) => formatNumber(value as number) },
    { key: 'impressions', label: 'Impr.', align: 'right', sortable: true, render: (value) => formatNumber(value as number) },
    { key: 'ctr', label: 'CTR', align: 'right', sortable: true, render: (value) => formatPercent(value as number) },
    { key: 'position', label: 'Pos.', align: 'right', sortable: true, render: (value) => formatPosition(value as number) },
  ];
}

function MovementList({ items, positive }: { items: FeedInsight[]; positive: boolean }) {
  if (items.length === 0) {
    return (
      <EmptyState
        icon={Search}
        title={positive ? 'No recorded ranking gains' : 'No ranking risks need attention'}
        description={positive
          ? 'Ranking movement will appear here when the insight feed records a gain.'
          : 'The insight feed has not recorded a ranking drop in this window.'}
        className="py-5"
      />
    );
  }

  return (
    <div className="divide-y divide-[var(--brand-border)]">
      {items.map((item) => (
        <div key={item.id} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
          <span
            className={`mt-0.5 inline-flex h-7 w-7 flex-none items-center justify-center rounded-[var(--radius-pill)] ${positive ? 'bg-[color:color-mix(in_srgb,var(--emerald)_12%,transparent)] text-[var(--emerald)]' : 'bg-[color:color-mix(in_srgb,var(--red)_12%,transparent)] text-[var(--red)]'}`}
          >
            <Icon name={positive ? 'arrowUp' : 'arrowDown'} size="sm" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="t-ui font-semibold text-[var(--brand-text-bright)]">{item.headline}</p>
              <Badge label={positive ? 'Gain' : 'Needs attention'} tone={positive ? 'emerald' : 'red'} variant="soft" size="sm" />
            </div>
            {item.title !== item.headline && <p className="mt-0.5 t-caption text-[var(--brand-text)]">{item.title}</p>}
            {item.context && <p className="mt-1 t-caption-sm text-[var(--brand-text-muted)]">{item.context}</p>}
          </div>
        </div>
      ))}
    </div>
  );
}

export function SearchLens({ workspaceId, data, tableMode, onTableModeChange, onOpenBreakdowns, configured }: SearchLensProps) {
  const navigate = useNavigate();
  const [activeLines, toggleLine] = useToggleSet(['clicks', 'impressions']);
  const { feed, summary, isLoading: feedLoading } = useInsightFeed(workspaceId);
  const { data: annotations = [] } = useAnalyticsAnnotations(workspaceId);
  const createAnnotation = useCreateAnnotation(workspaceId);
  const strategySet = useQuery({
    queryKey: queryKeys.admin.strategyKeywordSet(workspaceId),
    queryFn: () => getStrategyKeywordSet(workspaceId),
    enabled: !!workspaceId,
  });
  const strategyKeywords = useMemo(() => new Set((strategySet.data?.keywords ?? []).map((item) => item.keyword.toLowerCase())), [strategySet.data?.keywords]);
  const badgeMap = useMemo(() => buildBadgeMap(feed), [feed]);
  const [showAllInsights, setShowAllInsights] = useState(false);
  const [tableFilter, setTableFilter] = useState('');
  const [showAllRows, setShowAllRows] = useState(false);
  const contextBand = (
    <SearchContextBand
      workspaceId={workspaceId}
      brandedDemand={data.overview?.brandedDemand}
      feed={feed}
      summary={summary}
      loading={feedLoading}
      unavailableMessage={
        !configured
          ? 'Connect Search Console to calculate demand mix.'
          : !data.overview
            ? 'Search Console did not return overview data for this window.'
            : undefined
      }
    />
  );

  if (!configured) {
    return (
      <div className="flex flex-col gap-4">
        <EmptyState
          icon={Search}
          title="Search Console not configured"
          description="Select a Search Console property in Workspace Settings to view search performance."
          action={(
            <Button size="sm" variant="primary" onClick={() => navigate(`${adminPath(workspaceId, 'workspace-settings')}?tab=connections`)}>
              <Icon name="settings" size="sm" />
              Open Workspace Settings
            </Button>
          )}
        />
        {contextBand}
      </div>
    );
  }

  if (data.isLoading && !data.overview) {
    return (
      <div className="flex flex-col gap-4" aria-label="Loading search performance">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => <Skeleton key={index} className="h-[92px] w-full" />)}
        </div>
        <Skeleton className="h-[320px] w-full" />
      </div>
    );
  }

  if (!data.overview) {
    return (
      <div className="flex flex-col gap-4">
        <EmptyState
          icon={Search}
          title={data.error ? 'Search data unavailable' : 'No search data'}
          description={data.error
            ? `${data.error}. Search Console did not return overview data for this window.`
            : 'Search Console did not return overview rows for this workspace and window.'}
        />
        {contextBand}
      </div>
    );
  }

  const chartData = data.trend.map((row, index) => ({
    ...row,
    clicksPrior: data.priorTrend[index]?.clicks ?? null,
    priorDate: data.priorTrend[index]?.date ?? null,
  }));
  const chartLines = SEARCH_LINES.map((line) => ({
    ...line,
    active: line.key === 'clicksPrior' ? data.priorTrend.length > 0 && activeLines.has('clicks') : activeLines.has(line.key),
  }));
  const searchFeed = feed.filter((item) => item.domain === 'search' || item.domain === 'cross');
  const positiveMovers = searchFeed.filter((item) => item.type === 'ranking_mover' && item.severity === 'positive').slice(0, 4);
  const negativeMovers = searchFeed.filter((item) => item.type === 'ranking_mover' && item.severity !== 'positive').slice(0, 4);
  const lastDate = chartData[chartData.length - 1]?.date ?? '';
  const callouts: ChartCallout[] = searchFeed
    .filter((item) => item.type === 'ranking_mover' && (item.severity === 'critical' || item.severity === 'warning'))
    .slice(0, 3)
    .map((item) => ({
      date: item.detectedAt?.slice(0, 10) ?? lastDate,
      label: item.headline,
      detail: item.title,
      color: SERIES.position,
    }));
  const rows = tableMode === 'queries'
    ? data.overview.topQueries.map((row: SearchQuery) => ({ ...row }))
    : data.overview.topPages.map((row: SearchPage) => ({ ...row }));
  const rowCount = tableMode === 'queries' ? data.overview.topQueries.length : data.overview.topPages.length;
  const normalizedTableFilter = tableFilter.trim().toLowerCase();
  const filteredRows = normalizedTableFilter
    ? rows.filter((row) => String('query' in row ? row.query : row.page).toLowerCase().includes(normalizedTableFilter))
    : rows;
  const visibleRows = showAllRows ? filteredRows : filteredRows.slice(0, DETAIL_ROW_LIMIT);
  const rowCountLabel = normalizedTableFilter
    ? `Showing ${visibleRows.length} of ${filteredRows.length} matching rows (${rowCount} total)`
    : `Showing ${visibleRows.length} of ${rowCount} rows`;

  return (
    <div className="flex flex-col gap-4">
      {data.error && (
        <InlineBanner tone="warning" title="Search data may be stale">
          {data.error}. The last loaded Search Console rows are still shown when available.
        </InlineBanner>
      )}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SparkMetricTile
          label="Clicks"
          value={formatNumber(data.overview.totalClicks)}
          sparkline={buildSparkline(data.trend, (row) => row.clicks)}
          sparklineLabel="Search clicks daily trend"
          delta={data.comparison?.changePercent.clicks}
          deltaLabel="vs prior"
          accent={SERIES.clicks}
          onClick={() => toggleLine('clicks')}
          className={activeLines.has('clicks') ? 'border-[var(--teal)]' : undefined}
        />
        <SparkMetricTile
          label="Impressions"
          value={formatNumber(data.overview.totalImpressions)}
          sparkline={buildSparkline(data.trend, (row) => row.impressions)}
          sparklineLabel="Search impressions daily trend"
          delta={data.comparison?.changePercent.impressions}
          deltaLabel="vs prior"
          accent={SERIES.impressions}
          onClick={() => toggleLine('impressions')}
          className={activeLines.has('impressions') ? 'border-[var(--teal)]' : undefined}
        />
        <SparkMetricTile
          label="CTR"
          value={formatPercent(data.overview.avgCtr)}
          sparkline={buildSparkline(data.trend, (row) => row.ctr)}
          sparklineLabel="Search CTR daily trend"
          delta={data.comparison?.change.ctr}
          deltaLabel="pt"
          accent={SERIES.ctr}
          onClick={() => toggleLine('ctr')}
          className={activeLines.has('ctr') ? 'border-[var(--teal)]' : undefined}
        />
        <SparkMetricTile
          label="Position"
          value={formatPosition(data.overview.avgPosition)}
          sparkline={buildSparkline(data.trend, (row) => row.position)}
          sparklineLabel="Search position daily trend"
          delta={data.comparison?.change.position}
          deltaLabel="spots"
          invertDelta
          accent={SERIES.position}
          onClick={() => toggleLine('position')}
          className={activeLines.has('position') ? 'border-[var(--teal)]' : undefined}
        />
      </div>

      <ChartCard
        title="Search performance trend"
        action={(
          <div className="flex items-center gap-2">
            {data.priorIsLoading && <Badge label="prior loading" tone="zinc" variant="soft" size="sm" />}
            <Button size="sm" variant="secondary" onClick={onOpenBreakdowns}>
              <Icon name="layers" size="sm" aria-hidden="true" />
              Breakdowns
            </Button>
          </div>
        )}
      >
        {chartData.length > 0 ? (
          <AnnotatedTrendChart
            data={chartData}
            lines={chartLines}
            annotations={annotations}
            callouts={callouts}
            onCreateAnnotation={(date, label, category) => createAnnotation.mutate({ date, label, category })}
            onToggleLine={toggleLine}
            height={300}
          />
        ) : (
          <EmptyState icon={Search} title="No daily trend rows" description="Search Console did not return a dated trend series for this window." />
        )}
      </ChartCard>

      <ReportSectionHeader
        number="01"
        title="Movement"
        description="Recorded ranking gains and losses from the current insight window."
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Biggest gains" titleIcon={<Icon name="arrowUp" size="md" className="text-[var(--emerald)]" aria-hidden="true" />}>
          <MovementList items={positiveMovers} positive />
        </ChartCard>
        <ChartCard title="Needs attention" titleIcon={<Icon name="arrowDown" size="md" className="text-[var(--red)]" aria-hidden="true" />}>
          <MovementList items={negativeMovers} positive={false} />
        </ChartCard>
      </div>

      <ReportSectionHeader
        number="02"
        title="Detail"
        description="Query and page rows from the same Search Console window."
      />

      <ChartCard
        title={tableMode === 'queries' ? 'Top queries' : 'Top pages'}
        action={(
          <div className="flex flex-wrap items-center justify-end gap-3">
            <span className="t-caption-sm text-[var(--brand-text-muted)]">
              {rowCountLabel}
            </span>
            <Segmented
              options={[
                { value: 'queries', label: 'Queries' },
                { value: 'pages', label: 'Pages' },
              ]}
              value={tableMode}
              onChange={(value) => {
                setTableFilter('');
                setShowAllRows(false);
                onTableModeChange(value as SearchTrafficTableMode);
              }}
            />
          </div>
        )}
      >
        <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center">
          <SearchField
            value={tableFilter}
            onChange={setTableFilter}
            placeholder={tableMode === 'queries' ? 'Search queries…' : 'Search pages…'}
            className="min-w-0 flex-1"
          />
          {filteredRows.length > DETAIL_ROW_LIMIT && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowAllRows((current) => !current)}
              className="flex-none"
            >
              {showAllRows ? `Show first ${DETAIL_ROW_LIMIT}` : `Show all ${filteredRows.length}`}
            </Button>
          )}
        </div>
        <div
          data-testid="search-detail-table-region"
          className={showAllRows ? 'max-h-[60vh] overflow-auto' : undefined}
        >
          <DataTable
            columns={tableMode === 'queries' ? queryColumns(strategyKeywords, badgeMap) : pageColumns(badgeMap)}
            rows={visibleRows as unknown as Record<string, unknown>[]}
            getRowKey={(row, index) => `${tableMode}-${String(row.query ?? row.page)}-${index}`}
            empty={<EmptyState icon={Search} title={tableMode === 'queries' ? 'No queries' : 'No pages'} description="No row-level Search Console data returned for this window." />}
          />
        </div>
      </ChartCard>

      {contextBand}

      <Disclosure summary="Monitoring & insights" badges={[{ label: `${searchFeed.length} signals`, tone: 'blue' }]}>
        <div className="flex flex-col gap-4 pt-2">
          <AnomalyAlerts workspaceId={workspaceId} isAdmin />
          <ChartCard title="Search insights" action={<Link className="t-ui text-[var(--teal)] hover:text-[var(--brand-mint-light)]" to={adminPath(workspaceId, 'seo-keywords')}>Open Keyword Hub</Link>}>
            <InsightFeed
              feed={feed}
              loading={feedLoading}
              domain="search"
              showFilterChips
              workspaceId={workspaceId}
              limit={showAllInsights ? undefined : 5}
              onViewAll={() => setShowAllInsights(true)}
            />
          </ChartCard>
        </div>
      </Disclosure>
    </div>
  );
}
