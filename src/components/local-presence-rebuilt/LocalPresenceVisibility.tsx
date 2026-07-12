// @ds-rebuilt
import { useMemo, useState } from 'react';
import type { LocalSeoReadResponse } from '../../../shared/types/local-seo';
import type { GbpReviewsReadResponse } from '../../api/localSeo';
import { useRankTrackingAddKeyword } from '../../hooks/admin/useKeywordCommandCenter';
import { useToast } from '../Toast';
import {
  Badge,
  Button,
  CompactStatBar,
  DataTable,
  EmptyState,
  FilterChip,
  Icon,
  InlineBanner,
  SearchField,
  SectionCard,
  Sparkline,
  type DataColumn,
} from '../ui';
import { mutationErrorMessage } from './localPresenceMutationFeedback';
import { LOCAL_PRESENCE_FILTERS, type LocalPresenceFilter } from './useLocalPresenceSurfaceState';

interface LocalPresenceVisibilityProps {
  workspaceId: string;
  data: LocalSeoReadResponse;
  gbp?: GbpReviewsReadResponse;
  search: string;
  searchInput: string;
  filter: LocalPresenceFilter;
  onSearchInputChange: (value: string) => void;
  onFilterChange: (filter: LocalPresenceFilter) => void;
  onOpenReviews: () => void;
}

type CompetitorWithShareOfVoice = LocalSeoReadResponse['competitorBrands'][number];

type CompetitorRecord = Record<string, unknown> & {
  source: CompetitorWithShareOfVoice;
  title: string;
  share: number | null;
  losses: number;
  appearances: number;
};

function EmptyCompetitorIcon({ className }: { className?: string }) {
  return <Icon name="swords" className={className} />;
}

function formatPercent(value?: number): string {
  return typeof value === 'number' ? `${value.toFixed(value % 1 === 0 ? 0 : 1)}%` : '—';
}

function toCompetitorRecord(competitor: CompetitorWithShareOfVoice): CompetitorRecord {
  return {
    source: competitor,
    title: competitor.title,
    share: typeof competitor.mapPackShareOfVoicePct === 'number' ? competitor.mapPackShareOfVoicePct : null,
    losses: competitor.winsAgainstClient,
    appearances: competitor.totalAppearances,
  };
}

export function LocalPresenceVisibility({
  workspaceId,
  data,
  gbp,
  search,
  searchInput,
  filter,
  onSearchInputChange,
  onFilterChange,
  onOpenReviews,
}: LocalPresenceVisibilityProps) {
  const { toast } = useToast();
  const addKeyword = useRankTrackingAddKeyword(workspaceId);
  const [trackingPending, setTrackingPending] = useState<Set<string>>(new Set());
  const [trackedKeywords, setTrackedKeywords] = useState<Set<string>>(new Set());
  const [trackingErrors, setTrackingErrors] = useState<Map<string, string>>(new Map());
  const report = data.report;
  const owned = gbp?.owned ?? null;
  const healthRows = [
    {
      label: 'Active markets',
      value: `${report.activeMarketCount}/${report.configuredMarketCount}`,
      healthy: report.activeMarketCount > 0,
    },
    {
      label: 'Keyword checks',
      value: report.checkedKeywordCount,
      healthy: report.checkedKeywordCount > 0,
    },
    {
      label: 'Scan warnings',
      value: report.degradedCount,
      healthy: report.degradedCount === 0,
    },
  ];

  const competitorRows = useMemo(() => {
    const query = search.toLowerCase();
    return data.competitorBrands
      .map(toCompetitorRecord)
      .filter((record) => {
        const row = record.source;
        if (filter === 'attention' && row.winsAgainstClient === 0) return false;
        if (filter === 'configured' && row.markets.length === 0) return false;
        if (filter === 'no_data' && typeof row.mapPackShareOfVoicePct === 'number') return false;
        if (!query) return true;
        return [row.title, row.domain ?? '', row.markets.join(' '), row.suggestedTrackingKeywords.join(' ')]
          .join(' ')
          .toLowerCase()
          .includes(query);
      });
  }, [data.competitorBrands, filter, search]);

  const handleTrackKeyword = (keyword: string) => {
    setTrackingPending((current) => new Set(current).add(keyword));
    setTrackingErrors((current) => {
      const next = new Map(current);
      next.delete(keyword);
      return next;
    });
    addKeyword.mutate(keyword, {
      onSuccess: () => {
        setTrackedKeywords((current) => new Set(current).add(keyword));
        toast('Keyword added to rank tracking', 'success');
      },
      onError: (error) => {
        const message = mutationErrorMessage(error, 'Keyword add failed');
        setTrackingErrors((current) => new Map(current).set(keyword, message));
        toast(message, 'error');
      },
      onSettled: () => {
        setTrackingPending((current) => {
          const next = new Set(current);
          next.delete(keyword);
          return next;
        });
      },
    });
  };

  const columns = useMemo<DataColumn[]>(() => [
    {
      key: 'title',
      label: 'Competitor',
      width: 'minmax(210px,1.5fr)',
      render: (_value, record) => {
        const row = (record as CompetitorRecord).source;
        return (
          <div className="min-w-0">
            <span className="block truncate t-ui font-semibold text-[var(--brand-text-bright)]">{row.title}</span>
            <span className="block truncate t-caption-sm text-[var(--brand-text-muted)]">{row.domain ?? 'No domain captured'}</span>
          </div>
        );
      },
    },
    {
      key: 'share',
      label: 'Share',
      width: '90px',
      align: 'right',
      sortable: true,
      render: (_value, record) => <span className="t-stat-sm tabular-nums text-[var(--blue)]">{formatPercent((record as CompetitorRecord).source.mapPackShareOfVoicePct)}</span>,
    },
    { key: 'appearances', label: 'Appearances', width: '110px', align: 'right', sortable: true },
    {
      key: 'losses',
      label: 'Losses',
      width: '80px',
      align: 'right',
      sortable: true,
      render: (_value, record) => <span className="tabular-nums font-semibold text-[var(--red)]">{(record as CompetitorRecord).losses}</span>,
    },
    {
      key: 'track',
      label: 'Track',
      width: '150px',
      render: (_value, record) => {
        const keyword = (record as CompetitorRecord).source.suggestedTrackingKeywords[0];
        if (!keyword) return <span className="text-[var(--brand-text-muted)]">—</span>;
        const pending = trackingPending.has(keyword);
        const tracked = trackedKeywords.has(keyword);
        const error = trackingErrors.get(keyword);
        return (
          <div className="flex min-w-0 flex-col gap-1">
            <Button size="sm" variant={tracked ? 'ghost' : 'secondary'} disabled={pending || tracked} onClick={() => handleTrackKeyword(keyword)}>
              <Icon name={tracked ? 'check' : 'plus'} size="sm" />
              {tracked ? 'Tracked' : 'Track'}
            </Button>
            <span className="truncate t-caption-sm text-[var(--brand-text-muted)]">{keyword}</span>
            {error && <span role="alert" className="t-caption-sm text-[var(--red)]">{error}</span>}
          </div>
        );
      },
    },
  ], [trackedKeywords, trackingErrors, trackingPending]);

  return (
    <div className="flex flex-col gap-[14px]">
      <div className="grid gap-[14px] lg:grid-cols-[minmax(0,706px)_340px]">
        <SectionCard
          title="Local visibility"
          subtitle="Retained keyword checks across configured markets."
          titleIcon={<Icon name="pin" size="sm" className="text-[var(--blue)]" />}
          iconChip
        >
          <CompactStatBar
            items={[
              { label: 'Visible', value: report.visibleCount, valueColor: 'text-[var(--emerald)]' },
              { label: 'Possible', value: report.possibleMatchCount, valueColor: 'text-[var(--amber)]' },
              { label: 'Not visible', value: report.notVisibleCount, valueColor: 'text-[var(--red)]' },
              { label: 'Local packs', value: report.localPackPresentCount, valueColor: 'text-[var(--blue)]' },
            ]}
            className="border-0 bg-[var(--surface-1)] px-3"
          />

          <div className="mt-4 border-t border-[var(--brand-border)] pt-3">
            <div className="mb-2 flex items-center justify-between gap-3">
              <div>
                <h3 className="t-ui font-semibold text-[var(--brand-text-bright)]">Market trend</h3>
                <p className="t-caption-sm text-[var(--brand-text-muted)]">Visible counts from retained local snapshots.</p>
              </div>
              <Badge label={`${report.latestSnapshotCount} snapshots`} tone="blue" variant="soft" shape="pill" />
            </div>
            {data.visibilityTrend.length === 0 ? (
              <p className="rounded-[var(--radius-md)] bg-[var(--surface-1)] px-3 py-4 t-body text-[var(--brand-text-muted)]">No retained trend yet. Re-scan after a market is configured.</p>
            ) : data.visibilityTrend.map((series) => {
              const points = series.points.map((point) => point.visibleCount).filter(Number.isFinite);
              const latest = series.points.at(-1);
              return (
                <div key={series.marketId} className="flex items-center gap-4 rounded-[var(--radius-md)] border border-[var(--brand-border)] bg-[var(--surface-1)] px-3 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate t-ui font-semibold text-[var(--brand-text-bright)]">{series.marketLabel}</p>
                    {latest && <p className="t-body text-[var(--brand-text-muted)]">{latest.visibleCount}/{latest.checkedCount} visible on {latest.date}</p>}
                  </div>
                  <Sparkline data={points} area label={`${series.marketLabel} visible keyword trend`} />
                </div>
              );
            })}
          </div>
        </SectionCard>

        <div className="flex flex-col gap-[14px]">
          <SectionCard title="Profile health" subtitle={report.setupLabel} titleIcon={<Icon name="user" size="sm" className="text-[var(--blue)]" />} iconChip>
            <div className="space-y-2">
              {healthRows.map((row) => (
                <div key={row.label} className="flex items-center gap-2 border-b border-[var(--brand-border)] py-2 last:border-b-0">
                  <Icon name={row.healthy ? 'check' : 'alert'} size="sm" className={row.healthy ? 'text-[var(--emerald)]' : 'text-[var(--amber)]'} />
                  <span className="t-body text-[var(--brand-text)]">{row.label}</span>
                  <span className="ml-auto t-mono text-[var(--brand-text-bright)]">{row.value}</span>
                </div>
              ))}
            </div>
          </SectionCard>

          <SectionCard title="Reviews" subtitle="Authenticated profile aggregate" titleIcon={<Icon name="message" size="sm" className="text-[var(--blue)]" />} iconChip action={<Button size="sm" variant="ghost" onClick={onOpenReviews}>Open</Button>}>
            {owned ? (
              <CompactStatBar
                items={[
                  { label: 'Rating', value: owned.rating?.toFixed(1) ?? '—', valueColor: 'text-[var(--brand-yellow)]' },
                  { label: 'Reviews', value: owned.reviewCount ?? '—', valueColor: 'text-[var(--blue)]' },
                ]}
                className="border-0 bg-[var(--surface-1)] px-3"
              />
            ) : <p className="t-body text-[var(--brand-text-muted)]">No GBP aggregate has been captured for this workspace.</p>}
          </SectionCard>
        </div>
      </div>

      <SectionCard title="Map-pack share of voice" subtitle="Repeat competitors found across retained local-pack snapshots." noPadding>
        <div className="flex flex-wrap items-center gap-2 border-b border-[var(--brand-border)] px-3 py-2">
          <SearchField value={searchInput} onChange={onSearchInputChange} placeholder="Search competitors" className="min-w-[210px] flex-1" />
          {LOCAL_PRESENCE_FILTERS.map((option) => (
            <FilterChip
              key={option.id}
              label={option.label}
              active={filter === option.id}
              onClick={() => onFilterChange(option.id)}
            />
          ))}
        </div>
        <DataTable
          columns={columns}
          rows={competitorRows}
          getRowKey={(record) => (record as CompetitorRecord).source.title}
          className="rounded-none border-0"
          empty={<EmptyState icon={EmptyCompetitorIcon} title="No repeat competitors match this view" description="Repeat competitors appear after the same business shows up in at least two local-pack snapshots." />}
        />
      </SectionCard>

      <InlineBanner tone="info" title="Local movement graduates only when it changes a business outcome">
        Rank movement remains evidence here. It becomes an Insights Engine story after calls, directions, bookings, or another measured outcome moves with it.
      </InlineBanner>
    </div>
  );
}
