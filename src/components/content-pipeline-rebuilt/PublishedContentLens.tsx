// @ds-rebuilt
import { useEffect, useMemo, useState } from 'react';
import type { ContentPerformanceItem, ContentPerformanceSummary } from '../../../shared/types/content';
import type { OutcomeReadback } from '../../../shared/types/outcome-tracking';
import {
  useAdminContentPerformance,
  useAdminContentPerformanceTrend,
} from '../../hooks/admin/useAdminContentPerformance';
import {
  Badge,
  Button,
  ClickableRow,
  CompactStatBar,
  Drawer,
  EmptyState,
  ErrorState,
  FilterChip,
  FormSelect,
  GroupBlock,
  Icon,
  InlineBanner,
  KeyValueRow,
  OutcomeReadbackChip,
  Skeleton,
  Sparkline,
  Toolbar,
  ToolbarSpacer,
} from '../ui';
import {
  buildLiveContentUrl,
  contentSourceLabel,
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
  selectedItemId?: string | null;
  onOpenItem?: (itemId: string) => void;
  onCloseItem?: () => void;
}

type SortKey = 'clicks' | 'impressions' | 'sessions' | 'days';
type StatusFilter = 'all' | 'published' | 'delivered';

const STATUS_FILTERS: Array<{ id: StatusFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'published', label: 'Published' },
  { id: 'delivered', label: 'Delivered' },
];

const SORT_OPTIONS: Array<{ value: SortKey; label: string }> = [
  { value: 'clicks', label: 'Most clicks' },
  { value: 'impressions', label: 'Most impressions' },
  { value: 'sessions', label: 'Most sessions' },
  { value: 'days', label: 'Longest live' },
];

function PublishedEmptyIcon({ className }: { className?: string }) {
  return <Icon name="file" className={className} />;
}

function sortItems(items: ContentPerformanceItem[], sortKey: SortKey): ContentPerformanceItem[] {
  return [...items].sort((a, b) => {
    if (sortKey === 'impressions') return (b.gsc?.impressions ?? 0) - (a.gsc?.impressions ?? 0);
    if (sortKey === 'sessions') return (b.ga4?.sessions ?? 0) - (a.ga4?.sessions ?? 0);
    if (sortKey === 'days') return b.daysSincePublish - a.daysSincePublish;
    return (b.gsc?.clicks ?? 0) - (a.gsc?.clicks ?? 0);
  });
}

function verdict(outcome: OutcomeReadback | undefined): {
  label: string;
  tone: 'emerald' | 'blue' | 'zinc' | 'red';
  rail: string;
} {
  if (outcome?.score === 'strong_win' || outcome?.score === 'win') {
    return { label: outcome.score === 'strong_win' ? 'Strong win' : 'Win', tone: 'emerald', rail: 'var(--emerald)' };
  }
  if (outcome?.score === 'loss') return { label: 'Loss', tone: 'red', rail: 'var(--red)' };
  if (outcome?.score === 'insufficient_data' || outcome?.score === 'inconclusive') {
    return { label: 'Early', tone: 'blue', rail: 'var(--blue)' };
  }
  return { label: 'Flat', tone: 'zinc', rail: 'var(--brand-border-hover)' };
}

function movement(item: ContentPerformanceItem): string {
  const outcome = item.outcome;
  if (outcome?.baselinePosition != null && outcome.currentPosition != null) {
    return `#${Math.round(outcome.baselinePosition)} → #${Math.round(outcome.currentPosition)}`;
  }
  return formatPosition(item.gsc?.position);
}

function ResultTrend({ workspaceId, item }: { workspaceId: string; item: ContentPerformanceItem }) {
  const trend = useAdminContentPerformanceTrend(workspaceId, item.itemId);
  const points = trend.data?.trend ?? [];
  const clicks = points.map((point) => point.clicks);
  const impressions = points.map((point) => point.impressions);

  if (trend.isLoading) return <Skeleton className="h-[58px] w-full" />;
  if (trend.isError) {
    return (
      <div className="rounded-[var(--radius-md)] border border-[var(--brand-border)] bg-[var(--surface-2)] px-3 py-2">
        <span className="t-caption-sm text-[var(--brand-text-muted)]">Daily trend unavailable</span>
      </div>
    );
  }
  if (trend.data?.availability !== 'available' || points.length < 2) {
    return (
      <div className="rounded-[var(--radius-md)] border border-[var(--brand-border)] bg-[var(--surface-2)] px-3 py-2">
        <p className="t-caption-sm text-[var(--brand-text-muted)]">
          {trend.data?.reason ?? 'Daily search trend will appear when enough mapped GSC history is available.'}
        </p>
      </div>
    );
  }

  return (
    <div className="grid gap-2 rounded-[var(--radius-md)] border border-[var(--brand-border)] bg-[var(--surface-2)] px-3 py-2 sm:grid-cols-[142px_1fr] sm:items-center">
      <div>
        <p className="t-micro uppercase tracking-[0.08em] text-[var(--brand-text-dim)]">Since publish</p>
        <p className="mt-1 t-caption-sm text-[var(--brand-text-muted)]">{item.daysSincePublish} days live</p>
      </div>
      <div className="grid gap-1.5">
        <div className="grid grid-cols-[72px_1fr] items-center gap-2">
          <span className="t-micro text-[var(--brand-text-muted)]">Clicks</span>
          <Sparkline data={clicks} width={420} height={22} color="var(--blue)" area label={`${item.topic} daily clicks`} className="h-[22px] w-full" />
        </div>
        <div className="grid grid-cols-[72px_1fr] items-center gap-2">
          <span className="t-micro text-[var(--brand-text-muted)]">Impressions</span>
          <Sparkline data={impressions} width={420} height={22} color="var(--teal)" label={`${item.topic} daily impressions`} className="h-[22px] w-full" />
        </div>
      </div>
    </div>
  );
}

function ResultTile({ label, value, detail, positive = false }: { label: string; value: string; detail: string; positive?: boolean }) {
  // stat-primitive-ok -- prototype result cards intentionally use compact inline metric shells.
  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--brand-border)] bg-[var(--surface-2)] px-3 py-2.5">
      <p className="t-micro uppercase tracking-[0.08em] text-[var(--brand-text-dim)]">{label}</p>
      {/* stat-primitive-ok -- compact result-card metric shell from the prototype. */}
      <p className={`mt-1.5 t-stat-sm ${positive ? 'text-[var(--emerald)]' : 'text-[var(--brand-text-bright)]'}`}>{value}</p>
      <p className="mt-1 truncate t-micro text-[var(--brand-text-dim)]">{detail}</p>
    </div>
  );
}

function ResultCard({ item, onOpen }: { item: ContentPerformanceItem; onOpen: () => void }) {
  const result = verdict(item.outcome);
  return (
    <ClickableRow
      className="relative w-full overflow-hidden rounded-[var(--radius-lg)] border border-[var(--brand-border)] bg-[var(--surface-1)] p-4 text-left transition-[border-color,transform] duration-[var(--dur-fast)] hover:-translate-y-px hover:border-[var(--brand-border-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--teal)]"
      style={{ borderLeftColor: result.rail, borderLeftWidth: 3 }}
      onClick={onOpen}
      aria-label={`Open published readback for ${item.topic}`}
    >
      <div className="flex flex-wrap items-center gap-2.5">
        <Badge label={result.label} tone={result.tone} variant="soft" size="sm" />
        <h3 className="min-w-[220px] flex-1 truncate t-body font-semibold text-[var(--brand-text-bright)]">{item.topic}</h3>
        <span className="t-caption-sm text-[var(--teal)]">View readback <Icon name="arrowRight" size="xs" className="ml-1 inline" /></span>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 t-caption-sm text-[var(--brand-text-muted)]">
        <Icon name="key" size="xs" className="text-[var(--brand-text-dim)]" />
        <span>{item.targetKeyword || 'No target keyword'}</span><span aria-hidden="true">·</span>
        <span>{item.pageType || 'Page type unavailable'}</span><span aria-hidden="true">·</span>
        <span>{item.publishedAt ? `published ${formatContentDate(item.publishedAt)}` : item.status}</span><span aria-hidden="true">·</span>
        <span>{item.daysSincePublish} days live</span>
      </div>
      <div className="mt-3 rounded-[var(--radius-md)] border border-[var(--brand-border)] bg-[var(--surface-2)] px-3 py-2">
        <p className="t-caption-sm text-[var(--brand-text-muted)]">Open the readback for the paired daily clicks and impressions trend.</p>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 lg:grid-cols-4">
        <ResultTile label="Clicks" value={formatInteger(item.gsc?.clicks)} detail="Trailing window" positive={item.outcome?.direction === 'improved'} />
        <ResultTile label="Position" value={movement(item)} detail="Average search rank" positive={item.outcome?.direction === 'improved'} />
        <ResultTile label="Impressions" value={formatInteger(item.gsc?.impressions)} detail="Trailing window" />
        <ResultTile label="Engagement" value={formatEngagement(item.ga4?.avgEngagementTime)} detail={`${formatInteger(item.ga4?.sessions)} sessions`} />
      </div>
    </ClickableRow>
  );
}

function SummaryStats({ summary }: { summary: ContentPerformanceSummary }) {
  // stat-primitive-ok -- prototype parity calls for one compact four-cell summary band.
  // Position gain = baseline − current, so >0 is an improvement (search positions are
  // lower-is-better). Sign the arrow so a decline can't render as a green ▲ "improvement".
  const posGain = summary.averagePositionGain;
  const posGainValue = posGain == null
    ? '—'
    : posGain > 0
      ? `▲${posGain.toFixed(1)}`
      : posGain < 0
        ? `▼${Math.abs(posGain).toFixed(1)}`
        : '0.0';
  const stats = [
    { label: 'Pieces live', value: summary.piecesPublished, positive: false },
    { label: 'Total clicks', value: formatInteger(summary.totalClicks), positive: true },
    { label: 'Avg. position gain', value: posGainValue, positive: posGain != null && posGain > 0 },
    { label: 'Wins to graduate', value: summary.wins, positive: false },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {stats.map((stat) => (
        <div key={stat.label} className="rounded-[var(--radius-lg)] border border-[var(--brand-border)] bg-[var(--surface-2)] px-4 py-3.5">
          {/* stat-primitive-ok -- compact four-cell summary band from the prototype. */}
          <strong className={`t-stat block ${stat.positive ? 'text-[var(--emerald)]' : 'text-[var(--brand-text-bright)]'}`}>{stat.value}</strong>
          <span className="mt-1.5 block t-caption-sm text-[var(--brand-text-muted)]">{stat.label}</span>
        </div>
      ))}
    </div>
  );
}

function PublishedAggregateEvidence({
  summary,
  items,
}: {
  summary: ContentPerformanceSummary;
  items: ContentPerformanceItem[];
}) {
  const searchAvailable = items.some((item) => item.gsc != null);
  const analyticsAvailable = items.some((item) => item.ga4 != null);

  return (
    <section aria-label="Published aggregate evidence">
      <CompactStatBar
        items={[
          {
            label: 'Impressions',
            value: searchAvailable ? formatInteger(summary.totalImpressions) : '—',
            valueColor: searchAvailable ? 'text-[var(--blue)]' : 'text-[var(--brand-text-dim)]',
          },
          {
            label: 'Sessions',
            value: analyticsAvailable ? formatInteger(summary.totalSessions) : '—',
            valueColor: analyticsAvailable ? 'text-[var(--blue)]' : 'text-[var(--brand-text-dim)]',
          },
        ]}
        className="w-full"
      />
    </section>
  );
}

function PublishedDetail({ workspaceId, item, siteLabel }: { workspaceId: string; item: ContentPerformanceItem | null; siteLabel?: string | null }) {
  if (!item) return null;
  const liveUrl = buildLiveContentUrl(siteLabel, item.targetPageSlug);
  return (
    <div className="flex flex-col gap-4">
      {item.outcome && <OutcomeReadbackChip outcome={item.outcome} />}
      <ResultTrend workspaceId={workspaceId} item={item} />
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-[var(--radius-lg)] border border-[var(--brand-border)] bg-[var(--surface-2)] p-3">
          <h3 className="mb-2 t-label text-[var(--brand-text)]">Search performance</h3>
          <KeyValueRow label="Clicks" value={formatInteger(item.gsc?.clicks)} divider={false} />
          <KeyValueRow label="Impressions" value={formatInteger(item.gsc?.impressions)} />
          <KeyValueRow label="CTR" value={formatPercentValue(item.gsc?.ctr)} />
          <KeyValueRow label="Avg position" value={formatPosition(item.gsc?.position)} />
        </div>
        <div className="rounded-[var(--radius-lg)] border border-[var(--brand-border)] bg-[var(--surface-2)] p-3">
          <h3 className="mb-2 t-label text-[var(--brand-text)]">Site analytics</h3>
          <KeyValueRow label="Sessions" value={formatInteger(item.ga4?.sessions)} divider={false} />
          <KeyValueRow label="Users" value={formatInteger(item.ga4?.users)} />
          <KeyValueRow label="Bounce rate" value={formatPercentValue(item.ga4?.bounceRate)} />
          <KeyValueRow label="Avg engagement" value={formatEngagement(item.ga4?.avgEngagementTime)} />
        </div>
      </div>
      <GroupBlock
        title="Brief execution & source coverage"
        meta="Production joinback retained behind this readback detail."
        stats={[
          { label: 'Matched', value: item.coverage.matchedCount, color: 'var(--emerald)' },
          { label: 'Required', value: item.coverage.requiredCount, color: 'var(--blue)' },
          { label: 'Missing', value: item.coverage.missingCount, color: item.coverage.missingCount > 0 ? 'var(--amber)' : 'var(--emerald)' },
        ]}
        defaultOpen
      >
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-1.5">
            <Badge label={coverageLabel(item)} tone={coverageTone(item.coverage.status)} variant="soft" size="sm" />
            {item.joinback?.briefTitle && <Badge label={item.joinback.briefTitle} tone="blue" variant="outline" size="sm" />}
            {item.joinback?.postTitle && <Badge label={item.joinback.postTitle} tone="teal" variant="outline" size="sm" />}
            {item.joinback?.hasSourceEvidence && <Badge label="Source evidence" tone="emerald" variant="soft" size="sm" />}
          </div>
          {item.coverage.reason && <p className="t-caption-sm text-[var(--brand-text-muted)]">{item.coverage.reason}</p>}
          {item.coverage.missingTerms.length > 0 && (
            <div className="flex flex-wrap gap-1.5">{item.coverage.missingTerms.map((term) => <Badge key={term} label={term} tone="amber" variant="outline" size="sm" />)}</div>
          )}
        </div>
      </GroupBlock>
      <div className="rounded-[var(--radius-lg)] border border-[var(--brand-border)] bg-[var(--surface-2)] p-3">
        <KeyValueRow label="Status" value={item.status.replace(/_/g, ' ')} divider={false} />
        <KeyValueRow label="Source" value={contentSourceLabel(item.source)} />
        <KeyValueRow label="Target keyword" value={item.targetKeyword || '—'} />
        <KeyValueRow label="Page slug" value={item.targetPageSlug || '—'} mono />
        <KeyValueRow label="Published" value={formatContentDate(item.publishedAt)} />
      </div>
      {liveUrl && <Button size="sm" variant="secondary" onClick={() => window.open(liveUrl, '_blank', 'noopener,noreferrer')}><Icon name="external" size="sm" />View live</Button>}
    </div>
  );
}

export function PublishedContentLens({ workspaceId, siteLabel, selectedItemId = null, onOpenItem, onCloseItem }: PublishedContentLensProps) {
  const query = useAdminContentPerformance(workspaceId);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [sortKey, setSortKey] = useState<SortKey>('clicks');
  const items = query.data?.items ?? [];
  const selectedItem = items.find((item) => item.itemId === selectedItemId) ?? null;
  const counts = useMemo(() => ({
    all: items.length,
    published: items.filter((item) => item.status === 'published').length,
    delivered: items.filter((item) => item.status === 'delivered').length,
  }), [items]);
  const filteredItems = useMemo(() => sortItems(
    statusFilter === 'all' ? items : items.filter((item) => item.status === statusFilter),
    sortKey,
  ), [items, sortKey, statusFilter]);

  useEffect(() => {
    if (!query.data || !selectedItemId || selectedItem) return;
    onCloseItem?.();
  }, [onCloseItem, query.data, selectedItem, selectedItemId]);

  if (query.isLoading && !query.data) return <div className="flex flex-col gap-3" aria-label="Loading published content performance"><div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{Array.from({ length: 4 }).map((_, index) => <Skeleton key={index} className="h-[84px]" />)}</div><Skeleton className="h-[300px]" /></div>;
  if (query.isError && !query.data) return <ErrorState type="data" title="Published content did not load" message="Content performance did not load." action={{ label: 'Retry', onClick: () => query.refetch() }} className="min-h-[360px]" />;
  if (items.length === 0) return <div data-testid="content-pipeline-published-lens"><EmptyState icon={PublishedEmptyIcon} title="No published content yet" description="Pieces land here once they go live, with their measured outcome readback." action={<Button size="sm" variant="secondary" onClick={() => void query.refetch()} disabled={query.isFetching}><Icon name="refresh" size="sm" />Re-scan</Button>} /></div>;

  return (
    <div className="flex flex-col gap-4" data-testid="content-pipeline-published-lens">
      {query.isError && query.data && <InlineBanner tone="warning" title="Published data may be stale">The last loaded results remain visible. Re-scan when the source is healthy.</InlineBanner>}
      <SummaryStats summary={query.data!.summary} />
      <PublishedAggregateEvidence summary={query.data!.summary} items={items} />
      <Toolbar label="Published content controls" className="w-full py-1.5">
        <div className="flex flex-wrap gap-1.5">{STATUS_FILTERS.map((filter) => <FilterChip key={filter.id} label={filter.label} count={counts[filter.id]} active={statusFilter === filter.id} onClick={() => setStatusFilter(filter.id)} />)}</div>
        <ToolbarSpacer />
        <FormSelect aria-label="Published content sort" value={sortKey} onChange={(value) => setSortKey(value as SortKey)} options={SORT_OPTIONS} className="w-[170px]" />
        <Button size="sm" variant="secondary" onClick={() => void query.refetch()} disabled={query.isFetching}><Icon name="refresh" size="sm" />Re-scan</Button>
      </Toolbar>
      <div className="flex flex-col gap-2.5">
        {filteredItems.map((item) => <ResultCard key={item.itemId} item={item} onOpen={() => onOpenItem?.(item.itemId)} />)}
        {filteredItems.length === 0 && <EmptyState icon={PublishedEmptyIcon} title="No pieces match this status" description="Clear the status filter to show every tracked content piece." action={<Button size="sm" variant="secondary" onClick={() => setStatusFilter('all')}>Clear filter</Button>} />}
      </div>
      <Drawer open={selectedItem != null} onClose={() => onCloseItem?.()} title={selectedItem?.topic ?? 'Published content'} subtitle={selectedItem ? `${selectedItem.targetKeyword || 'No keyword'} · ${selectedItem.daysSincePublish}d` : undefined} eyebrow="Published readback" width={720}>
        <PublishedDetail workspaceId={workspaceId} item={selectedItem} siteLabel={siteLabel} />
      </Drawer>
    </div>
  );
}
