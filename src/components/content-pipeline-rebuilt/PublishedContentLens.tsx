// @ds-rebuilt
import { useMemo, useState } from 'react';
import type { ContentPerformanceItem } from '../../../shared/types/content';
import {
  useAdminContentPerformance,
  useAdminContentPerformanceRefresh,
  useAdminContentPerformanceTrend,
} from '../../hooks/admin/useAdminContentPerformance';
import { useToast } from '../Toast';
import {
  Badge,
  Button,
  DataTable,
  Drawer,
  EmptyState,
  ErrorState,
  FilterChip,
  FormSelect,
  GroupBlock,
  Icon,
  InlineBanner,
  KeyValueRow,
  MetricTile,
  OutcomeReadbackChip,
  Skeleton,
  Sparkline,
  Toolbar,
  ToolbarSpacer,
  type DataColumn,
} from '../ui';
import { mutationErrorMessage } from './contentPipelineMutationFeedback';
import {
  buildLiveContentUrl,
  contentSourceLabel,
  contentSourceTone,
  contentStatusTone,
  coverageLabel,
  coverageTone,
  formatContentDate,
  formatEngagement,
  formatInteger,
  formatPercentValue,
  formatPosition,
} from './contentPipelineFormatters';

interface PublishedContentLensProps {
  workspaceId: string;
  siteLabel?: string | null;
}

type SortKey = 'clicks' | 'impressions' | 'sessions' | 'days';
type StatusFilter = 'all' | 'published' | 'delivered';

type PublishedRecord = Record<string, unknown> & {
  source: ContentPerformanceItem;
  topic: string;
  status: string;
  clicks: number;
  impressions: number;
  sessions: number;
  days: number;
};

const STATUS_FILTERS: Array<{ id: StatusFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'published', label: 'Published' },
  { id: 'delivered', label: 'Delivered' },
];

const SORT_OPTIONS: Array<{ value: SortKey; label: string }> = [
  { value: 'clicks', label: 'Clicks' },
  { value: 'impressions', label: 'Impressions' },
  { value: 'sessions', label: 'Sessions' },
  { value: 'days', label: 'Age' },
];

function PublishedEmptyIcon({ className }: { className?: string }) {
  return <Icon name="file" className={className} />;
}

function SearchEmptyIcon({ className }: { className?: string }) {
  return <Icon name="search" className={className} />;
}

function toRecord(item: ContentPerformanceItem): PublishedRecord {
  return {
    source: item,
    topic: item.topic,
    status: item.status,
    clicks: item.gsc?.clicks ?? 0,
    impressions: item.gsc?.impressions ?? 0,
    sessions: item.ga4?.sessions ?? 0,
    days: item.daysSincePublish,
  };
}

function sortItems(items: ContentPerformanceItem[], sortKey: SortKey): ContentPerformanceItem[] {
  return [...items].sort((a, b) => {
    if (sortKey === 'impressions') return (b.gsc?.impressions ?? 0) - (a.gsc?.impressions ?? 0);
    if (sortKey === 'sessions') return (b.ga4?.sessions ?? 0) - (a.ga4?.sessions ?? 0);
    if (sortKey === 'days') return b.daysSincePublish - a.daysSincePublish;
    return (b.gsc?.clicks ?? 0) - (a.gsc?.clicks ?? 0);
  });
}

function averagePosition(items: ContentPerformanceItem[]): string {
  const positions = items
    .map((item) => item.gsc?.position)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  if (positions.length === 0) return '—';
  return formatPosition(positions.reduce((sum, value) => sum + value, 0) / positions.length);
}

function statusCounts(items: ContentPerformanceItem[]): Record<StatusFilter, number> {
  return {
    all: items.length,
    published: items.filter((item) => item.status === 'published').length,
    delivered: items.filter((item) => item.status === 'delivered').length,
  };
}

function TrendPanel({
  workspaceId,
  item,
}: {
  workspaceId: string;
  item: ContentPerformanceItem | null;
}) {
  const trend = useAdminContentPerformanceTrend(workspaceId, item?.requestId);
  const points = trend.data?.trend ?? [];
  const clickSeries = points
    .map((point) => point.clicks)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));

  if (!item) return null;

  if (trend.isLoading) {
    return (
      <div className="flex flex-col gap-2" aria-label="Loading content trend">
        <Skeleton className="h-[96px] w-full" />
        <Skeleton className="h-3 w-40" />
      </div>
    );
  }

  if (trend.isError) {
    return (
      <InlineBanner tone="warning" title="Trend did not load">
        <div className="flex flex-wrap items-center gap-2">
          <span>The published metrics are still shown. Retry the daily trend when the data source is healthy.</span>
          <Button size="sm" variant="secondary" onClick={() => trend.refetch()}>
            Retry trend
          </Button>
        </div>
      </InlineBanner>
    );
  }

  return (
    <div className="rounded-[var(--radius-lg)] border border-[var(--brand-border)] bg-[var(--surface-2)] p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="t-label text-[var(--brand-text)]">Daily clicks trend</p>
          <p className="t-caption-sm text-[var(--brand-text-muted)]">
            {points.length > 1 ? `${points.length} daily points` : 'Not enough daily points yet'}
          </p>
        </div>
        {points.length > 0 && (
          <span className="t-caption-sm text-[var(--brand-text-muted)]">
            {points[0]?.date} - {points[points.length - 1]?.date}
          </span>
        )}
      </div>
      {clickSeries.length > 0 ? (
        <Sparkline
          data={clickSeries}
          width={320}
          height={84}
          color="var(--blue)"
          area
          label={`${item.topic} daily clicks`}
          className="w-full"
        />
      ) : (
        <p className="t-caption-sm text-[var(--brand-text-muted)]">
          No daily click history is available for this piece yet.
        </p>
      )}
    </div>
  );
}

function PublishedDetail({
  workspaceId,
  item,
  siteLabel,
}: {
  workspaceId: string;
  item: ContentPerformanceItem | null;
  siteLabel?: string | null;
}) {
  if (!item) return null;
  const liveUrl = buildLiveContentUrl(siteLabel, item.targetPageSlug);
  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricTile label="Clicks" value={formatInteger(item.gsc?.clicks)} sub="GSC, trailing window" accent="var(--blue)" />
        <MetricTile label="Impressions" value={formatInteger(item.gsc?.impressions)} sub="GSC, trailing window" accent="var(--blue)" />
        <MetricTile label="Sessions" value={formatInteger(item.ga4?.sessions)} sub="GA4, trailing window" accent="var(--blue)" />
        <MetricTile label="Coverage" value={coverageLabel(item)} sub="Brief execution" accent={item.coverage.status === 'strong' ? 'var(--emerald)' : 'var(--amber)'} />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <div className="rounded-[var(--radius-lg)] border border-[var(--brand-border)] bg-[var(--surface-2)] p-3">
          <div className="mb-2 flex items-center gap-2">
            <Icon name="chart" size="sm" className="text-[var(--blue)]" aria-hidden="true" />
            <h3 className="t-label text-[var(--brand-text)]">Search Performance</h3>
          </div>
          <KeyValueRow label="Clicks" value={formatInteger(item.gsc?.clicks)} divider={false} />
          <KeyValueRow label="Impressions" value={formatInteger(item.gsc?.impressions)} />
          <KeyValueRow label="CTR" value={formatPercentValue(item.gsc?.ctr)} />
          <KeyValueRow label="Avg position" value={formatPosition(item.gsc?.position)} />
        </div>

        <div className="rounded-[var(--radius-lg)] border border-[var(--brand-border)] bg-[var(--surface-2)] p-3">
          <div className="mb-2 flex items-center gap-2">
            <Icon name="traffic" size="sm" className="text-[var(--blue)]" aria-hidden="true" />
            <h3 className="t-label text-[var(--brand-text)]">Site Analytics</h3>
          </div>
          <KeyValueRow label="Sessions" value={formatInteger(item.ga4?.sessions)} divider={false} />
          <KeyValueRow label="Users" value={formatInteger(item.ga4?.users)} />
          <KeyValueRow label="Bounce rate" value={formatPercentValue(item.ga4?.bounceRate)} />
          <KeyValueRow label="Avg engagement" value={formatEngagement(item.ga4?.avgEngagementTime)} />
        </div>
      </div>

      {item.outcome && (
        <div className="rounded-[var(--radius-lg)] border border-[var(--brand-border)] bg-[var(--surface-2)] p-3">
          <div className="mb-2 flex items-center gap-2">
            <Icon name="trophy" size="sm" className="text-[var(--emerald)]" aria-hidden="true" />
            <h3 className="t-label text-[var(--brand-text)]">Outcome Readback</h3>
          </div>
          <OutcomeReadbackChip outcome={item.outcome} />
        </div>
      )}

      <GroupBlock
        title="Brief Execution"
        meta="Required-term coverage and source evidence for this published piece."
        stats={[
          { label: 'Matched', value: item.coverage.matchedCount, color: 'var(--emerald)' },
          { label: 'Required', value: item.coverage.requiredCount, color: 'var(--blue)' },
          { label: 'Missing', value: item.coverage.missingCount, color: item.coverage.missingCount > 0 ? 'var(--amber)' : 'var(--emerald)' },
        ]}
        defaultOpen
      >
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge label={coverageLabel(item)} tone={coverageTone(item.coverage.status)} variant="soft" size="sm" />
            {item.joinback?.briefTitle && <Badge label={item.joinback.briefTitle} tone="blue" variant="outline" size="sm" />}
            {item.joinback?.postTitle && <Badge label={item.joinback.postTitle} tone="teal" variant="outline" size="sm" />}
            {item.joinback?.hasSourceEvidence && <Badge label="Source evidence" tone="emerald" variant="soft" size="sm" />}
          </div>
          {item.coverage.status === 'unavailable' ? (
            <p className="t-caption-sm text-[var(--brand-text-muted)]">
              {item.coverage.reason || 'Coverage grading is unavailable for this item.'}
            </p>
          ) : item.coverage.missingTerms.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {item.coverage.missingTerms.map((term) => (
                <Badge key={term} label={term} tone="amber" variant="outline" size="sm" />
              ))}
            </div>
          ) : (
            <p className="t-caption-sm text-[var(--brand-text-muted)]">All prescribed terms are covered.</p>
          )}
        </div>
      </GroupBlock>

      <TrendPanel workspaceId={workspaceId} item={item} />

      <div className="rounded-[var(--radius-lg)] border border-[var(--brand-border)] bg-[var(--surface-2)] p-3">
        <KeyValueRow label="Status" value={item.status.replace(/_/g, ' ')} divider={false} />
        <KeyValueRow label="Source" value={contentSourceLabel(item.source)} />
        <KeyValueRow label="Target keyword" value={item.targetKeyword || '—'} />
        <KeyValueRow label="Page slug" value={item.targetPageSlug || '—'} mono />
        <KeyValueRow label="Published" value={formatContentDate(item.publishedAt)} />
        <KeyValueRow label="Age" value={`${item.daysSincePublish}d`} />
      </div>

      {liveUrl && (
        <Button size="sm" variant="secondary" onClick={() => window.open(liveUrl, '_blank', 'noopener,noreferrer')}>
          <Icon name="external" size="sm" />
          View live
        </Button>
      )}
    </div>
  );
}

export function PublishedContentLens({ workspaceId, siteLabel }: PublishedContentLensProps) {
  const { toast } = useToast();
  const query = useAdminContentPerformance(workspaceId);
  const refresh = useAdminContentPerformanceRefresh(workspaceId);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [sortKey, setSortKey] = useState<SortKey>('clicks');
  const [selectedItem, setSelectedItem] = useState<ContentPerformanceItem | null>(null);
  const items = query.data?.items ?? [];
  const counts = statusCounts(items);

  const filteredItems = useMemo(() => {
    const visible = statusFilter === 'all'
      ? items
      : items.filter((item) => item.status === statusFilter);
    return sortItems(visible, sortKey);
  }, [items, sortKey, statusFilter]);

  const totals = useMemo(() => ({
    clicks: items.reduce((sum, item) => sum + (item.gsc?.clicks ?? 0), 0),
    outcomes: items.filter((item) => item.outcome).length,
    wins: items.filter((item) => item.outcome?.score === 'win').length,
  }), [items]);

  const handleRefresh = () => {
    toast('Content performance refresh started', 'info');
    refresh.mutate(undefined, {
      onSuccess: () => toast('Content performance refreshed', 'success'),
      onError: (error) => toast(mutationErrorMessage(error, 'Content performance refresh failed'), 'error'),
    });
  };

  const columns = useMemo<DataColumn[]>(() => [
    {
      key: 'topic',
      label: 'Piece',
      width: 'minmax(260px, 1.8fr)',
      sortable: true,
      render: (_value, record) => {
        const item = (record as PublishedRecord).source;
        return (
          <div className="min-w-0">
            <span className="block truncate font-semibold text-[var(--brand-text-bright)]">{item.topic}</span>
            <span className="mt-1 block truncate t-caption-sm text-[var(--brand-text-muted)]">
              {item.targetKeyword || 'No keyword'}{item.targetPageSlug ? ` · ${item.targetPageSlug}` : ''}
            </span>
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              <Badge label={item.status.replace(/_/g, ' ')} tone={contentStatusTone(item.status)} variant="soft" size="sm" />
              <Badge label={contentSourceLabel(item.source)} tone={contentSourceTone(item.source)} variant="outline" size="sm" />
              {item.pageType && <Badge label={item.pageType} tone="blue" variant="outline" size="sm" />}
              {item.outcome && <Badge label="Readback" tone="emerald" variant="soft" size="sm" />}
            </div>
          </div>
        );
      },
    },
    {
      key: 'clicks',
      label: 'Clicks',
      width: '92px',
      align: 'right',
      sortable: true,
      render: (_value, record) => formatInteger((record as PublishedRecord).source.gsc?.clicks),
    },
    {
      key: 'impressions',
      label: 'Impr',
      width: '104px',
      align: 'right',
      sortable: true,
      render: (_value, record) => formatInteger((record as PublishedRecord).source.gsc?.impressions),
    },
    {
      key: 'sessions',
      label: 'Sessions',
      width: '104px',
      align: 'right',
      sortable: true,
      render: (_value, record) => formatInteger((record as PublishedRecord).source.ga4?.sessions),
    },
    {
      key: 'coverage',
      label: 'Coverage',
      width: '150px',
      render: (_value, record) => {
        const item = (record as PublishedRecord).source;
        return <Badge label={coverageLabel(item)} tone={coverageTone(item.coverage.status)} variant="soft" size="sm" />;
      },
    },
    {
      key: 'days',
      label: 'Age',
      width: '76px',
      align: 'right',
      sortable: true,
      render: (_value, record) => `${(record as PublishedRecord).source.daysSincePublish}d`,
    },
  ], []);

  if (query.isLoading && !query.data) {
    return (
      <div className="flex flex-col gap-3" aria-label="Loading published content performance">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          {Array.from({ length: 5 }).map((_, index) => <Skeleton key={index} className="h-[92px] w-full" />)}
        </div>
        <Skeleton className="h-[360px] w-full" />
      </div>
    );
  }

  if (query.isError && !query.data) {
    return (
      <ErrorState
        type="data"
        title="Published content did not load"
        message={mutationErrorMessage(query.error, 'Content performance did not load')}
        action={{ label: 'Retry', onClick: () => query.refetch() }}
        className="min-h-[360px]"
      />
    );
  }

  if (items.length === 0) {
    return (
      <div data-testid="content-pipeline-published-lens">
        <EmptyState
          icon={PublishedEmptyIcon}
          title="No published content yet"
          description="Pieces land here once they go live, with their measured outcome readback."
          action={(
            <Button size="sm" variant="secondary" onClick={handleRefresh} disabled={refresh.isPending}>
              <Icon name="refresh" size="sm" />
              Re-scan
            </Button>
          )}
        />
      </div>
    );
  }

  const tableRows = filteredItems.map(toRecord);

  return (
    <div className="flex flex-col gap-5" data-testid="content-pipeline-published-lens">
      {query.isError && query.data && (
        <InlineBanner tone="warning" title="Published data may be stale">
          The latest content-performance read did not refresh, so the last loaded numbers are still shown.
        </InlineBanner>
      )}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricTile label="Pieces Live" value={counts.published} accent="var(--emerald)" />
        <MetricTile label="Total Clicks" value={formatInteger(totals.clicks)} accent="var(--blue)" />
        <MetricTile label="Avg Position" value={averagePosition(items)} accent="var(--blue)" />
        <MetricTile label="Wins to Graduate" value={totals.wins} sub={`${totals.outcomes} measured readback${totals.outcomes === 1 ? '' : 's'}`} accent="var(--emerald)" />
      </div>

      <Toolbar label="Published content controls" className="w-full">
        <div className="flex flex-wrap gap-2" aria-label="Published status filters">
          {STATUS_FILTERS.map((filter) => (
            <FilterChip
              key={filter.id}
              label={filter.label}
              count={counts[filter.id]}
              active={statusFilter === filter.id}
              onClick={() => setStatusFilter(filter.id)}
            />
          ))}
        </div>
        <ToolbarSpacer />
        <FormSelect
          aria-label="Published content sort"
          value={sortKey}
          onChange={(value) => setSortKey(value as SortKey)}
          options={SORT_OPTIONS}
          className="w-[180px]"
        />
        <Button size="sm" variant="secondary" onClick={handleRefresh} disabled={refresh.isPending}>
          <Icon name="refresh" size="sm" />
          Re-scan
        </Button>
      </Toolbar>

      <DataTable
        columns={columns}
        rows={tableRows}
        loading={query.isFetching && tableRows.length === 0}
        getRowKey={(record) => (record as PublishedRecord).source.requestId}
        onRowClick={(record) => setSelectedItem((record as PublishedRecord).source)}
        empty={(
          <EmptyState
            icon={SearchEmptyIcon}
            title="No pieces match this status"
            description="Clear the status filter to show every tracked content piece."
            action={<Button size="sm" variant="secondary" onClick={() => setStatusFilter('all')}>Clear filter</Button>}
          />
        )}
      />

      <Drawer
        open={selectedItem != null}
        onClose={() => setSelectedItem(null)}
        title={selectedItem?.topic ?? 'Published content'}
        subtitle={selectedItem ? `${selectedItem.targetKeyword || 'No keyword'} · ${selectedItem.daysSincePublish}d` : undefined}
        eyebrow="Published readback"
        width={760}
      >
        <PublishedDetail workspaceId={workspaceId} item={selectedItem} siteLabel={siteLabel} />
      </Drawer>
    </div>
  );
}
