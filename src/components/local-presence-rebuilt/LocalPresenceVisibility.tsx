// @ds-rebuilt
import { useMemo, useState } from 'react';
import { AlertTriangle, BarChart3, CheckCircle2, MapPin, XCircle } from 'lucide-react';
import type { LocalSeoReadResponse } from '../../../shared/types/local-seo';
import { useRankTrackingAddKeyword } from '../../hooks/admin/useKeywordCommandCenter';
import { useToast } from '../Toast';
import { LocalSeoVisibilityPanel } from '../local-seo/LocalSeoVisibilityPanel';
import {
  Button,
  DataTable,
  EmptyState,
  GroupBlock,
  Icon,
  InlineBanner,
  MetricTile,
  Sparkline,
  type DataColumn,
} from '../ui';
import { mutationErrorMessage } from './localPresenceMutationFeedback';
import type { LocalPresenceFilter } from './useLocalPresenceSurfaceState';

interface LocalPresenceVisibilityProps {
  workspaceId: string;
  data: LocalSeoReadResponse;
  search: string;
  filter: LocalPresenceFilter;
}

// The map-pack share-of-voice fields live on the shared LocalSeoRepeatCompetitor type
// (SB-019a), so no local widening / `as` cast is needed.
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

function setupTone(setupState: LocalSeoReadResponse['report']['setupState']): 'info' | 'success' | 'warning' {
  if (setupState === 'has_data') return 'success';
  if (setupState === 'needs_market') return 'warning';
  return 'info';
}

function setupTitle(setupState: LocalSeoReadResponse['report']['setupState']): string {
  if (setupState === 'has_data') return 'Local visibility is active';
  if (setupState === 'ready_no_data') return 'Ready for first scan';
  if (setupState === 'needs_market') return 'Market setup needed';
  return 'Local visibility inactive';
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

export function LocalPresenceVisibility({ workspaceId, data, search, filter }: LocalPresenceVisibilityProps) {
  const { toast } = useToast();
  const addKeyword = useRankTrackingAddKeyword(workspaceId);
  const [trackingPending, setTrackingPending] = useState<Set<string>>(new Set());
  const [trackedKeywords, setTrackedKeywords] = useState<Set<string>>(new Set());
  const [trackingErrors, setTrackingErrors] = useState<Map<string, string>>(new Map());
  const report = data.report;

  const competitorRows = useMemo(() => {
    const query = search.toLowerCase();
    return data.competitorBrands
      .map((competitor) => toCompetitorRecord(competitor))
      .filter((record) => {
        const row = record.source;
        if (filter === 'attention' && row.winsAgainstClient === 0) return false;
        if (query.length === 0) return true;
        return [
          row.title,
          row.domain ?? '',
          row.markets.join(' '),
          row.suggestedTrackingKeywords.join(' '),
        ].join(' ').toLowerCase().includes(query);
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
      width: 'minmax(220px, 1.5fr)',
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
      label: 'SoV',
      width: '110px',
      align: 'right',
      sortable: true,
      render: (_value, record) => {
        const row = (record as CompetitorRecord).source;
        return (
          <div className="flex flex-col items-end gap-1">
            <span className="t-ui tabular-nums font-semibold text-[var(--blue)]">{formatPercent(row.mapPackShareOfVoicePct)}</span>
            <span className="t-caption-sm text-[var(--brand-text-muted)]">
              {typeof row.mapPackShareOfVoiceBasis === 'number' ? `${row.totalAppearances}/${row.mapPackShareOfVoiceBasis}` : 'No basis'}
            </span>
          </div>
        );
      },
    },
    {
      key: 'losses',
      label: 'Losses',
      width: '100px',
      align: 'right',
      sortable: true,
      render: (_value, record) => <span className="tabular-nums font-semibold text-[var(--red)]">{(record as CompetitorRecord).losses}</span>,
    },
    {
      key: 'markets',
      label: 'Markets',
      width: 'minmax(160px, 1fr)',
      render: (_value, record) => {
        const row = (record as CompetitorRecord).source;
        return <span className="t-ui text-[var(--brand-text-muted)]">{row.markets.join(', ') || '—'}</span>;
      },
    },
    {
      key: 'track',
      label: 'Track',
      width: 'minmax(190px, 0.9fr)',
      render: (_value, record) => {
        const row = (record as CompetitorRecord).source;
        const keyword = row.suggestedTrackingKeywords[0];
        if (!keyword) return <span className="t-ui text-[var(--brand-text-muted)]">—</span>;
        const pending = trackingPending.has(keyword);
        const tracked = trackedKeywords.has(keyword);
        const error = trackingErrors.get(keyword);
        return (
          <div className="flex min-w-0 flex-col gap-1">
            <Button size="sm" variant={tracked ? 'ghost' : 'secondary'} disabled={pending || tracked} onClick={() => handleTrackKeyword(keyword)}>
              <Icon name={tracked ? 'check' : 'plus'} size="sm" />
              {tracked ? 'Tracked' : 'Track'}
            </Button>
            <span className="truncate t-ui text-[var(--brand-text-muted)]">{keyword}</span>
            {error && <span role="alert" className="t-caption-sm text-[var(--red)]">{error}</span>}
          </div>
        );
      },
    },
  ], [trackedKeywords, trackingErrors, trackingPending]);

  return (
    <div className="flex flex-col gap-4">
      <InlineBanner tone={setupTone(report.setupState)} title={setupTitle(report.setupState)}>
        <div className="flex flex-col gap-1">
          <span>{report.setupDetail}</span>
          <span>Changing market setup will not overwrite keyword or ranking history.</span>
        </div>
      </InlineBanner>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <MetricTile label="Visible" value={report.visibleCount} sub="confident matches" accent="var(--emerald)" icon={CheckCircle2} />
        <MetricTile label="Possible" value={report.possibleMatchCount} sub="needs review" accent="var(--amber)" icon={AlertTriangle} />
        <MetricTile label="Not visible" value={report.notVisibleCount} sub={`${report.localPackPresentCount} packs found`} accent="var(--red)" icon={XCircle} />
        <MetricTile label="Local packs" value={report.localPackPresentCount} sub="detected packs" accent="var(--blue)" icon={MapPin} />
        <MetricTile label="Scan warnings" value={report.degradedCount} sub="needs attention" accent="var(--amber)" icon={BarChart3} />
      </div>

      <GroupBlock
        title="Market trend"
        meta="Visible keyword counts from retained local visibility snapshots."
        stats={[
          { label: 'Markets', value: data.visibilityTrend.length, color: 'var(--blue)' },
          { label: 'Snapshots', value: report.latestSnapshotCount, color: 'var(--blue)' },
        ]}
      >
        {data.visibilityTrend.length === 0 ? (
          <p className="px-3 py-4 t-body text-[var(--brand-text-muted)]">No retained local visibility snapshots yet. Re-scan after markets are configured.</p>
        ) : (
          <div className="grid gap-2 p-2 md:grid-cols-2">
            {data.visibilityTrend.map((series) => {
              const points = series.points
                .map((point) => point.visibleCount)
                .filter((value) => Number.isFinite(value));
              const latest = series.points.at(-1);
              return (
                <div key={series.marketId} className="rounded-[var(--radius-md)] border border-[var(--brand-border)] bg-[var(--surface-1)] px-3 py-2">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate t-ui font-semibold text-[var(--brand-text-bright)]">{series.marketLabel}</p>
                      <p className="t-caption-sm text-[var(--brand-text-muted)]">
                        {series.points.length > 1 ? `${series.points.length} snapshots` : series.points.length === 1 ? '1 snapshot' : 'Not enough snapshots yet'}
                      </p>
                    </div>
                    <Sparkline data={points} area label={`${series.marketLabel} visible keyword trend`} />
                  </div>
                  {latest && (
                    <p className="mt-2 t-body text-[var(--brand-text-muted)]">
                      {latest.visibleCount}/{latest.checkedCount} visible on {latest.date}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </GroupBlock>

      <DataTable
        columns={columns}
        rows={competitorRows}
        getRowKey={(record) => (record as CompetitorRecord).source.title}
        empty={(
          <EmptyState
            icon={EmptyCompetitorIcon}
            title="No repeat competitors match this view"
            description="Repeat competitors appear after the same business shows up in at least two local-pack snapshots."
          />
        )}
      />

      <LocalSeoVisibilityPanel workspaceId={workspaceId} mode="keywords" showGbpReviews={false} />
    </div>
  );
}
