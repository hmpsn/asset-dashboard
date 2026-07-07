// @ds-rebuilt
import { BarChart3, CheckCircle2, MapPin, Search, Star } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import type { LocalSeoReadResponse } from '../../../shared/types/local-seo';
import type { GbpReviewsReadResponse } from '../../api/localSeo';
import { adminPath } from '../../routes';
import {
  Badge,
  Button,
  DataTable,
  EmptyState,
  Icon,
  Meter,
  MetricTile,
  type DataColumn,
} from '../ui';

interface LocalPresenceOverviewProps {
  workspaceId: string;
  data: LocalSeoReadResponse;
  gbp?: GbpReviewsReadResponse;
  onOpenSetup: () => void;
}

// The map-pack share-of-voice fields live on the shared LocalSeoRepeatCompetitor type
// (SB-019a), so no local widening / `as` cast is needed.
type CompetitorWithShareOfVoice = LocalSeoReadResponse['competitorBrands'][number];

type CompetitorRecord = Record<string, unknown> & {
  source: CompetitorWithShareOfVoice;
  title: string;
  share: number | null;
  appearances: number;
  wins: number;
};

const NUMBER_FORMAT = new Intl.NumberFormat('en-US');

function EmptyCompetitorIcon({ className }: { className?: string }) {
  return <Icon name="swords" className={className} />;
}

function setupTone(setupState: LocalSeoReadResponse['report']['setupState']): 'blue' | 'emerald' | 'amber' | 'zinc' {
  if (setupState === 'has_data') return 'emerald';
  if (setupState === 'ready_no_data') return 'blue';
  if (setupState === 'needs_market') return 'amber';
  return 'zinc';
}

function formatDate(value?: string): string {
  if (!value) return 'No scan yet';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return 'No scan yet';
  return parsed.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatRating(value?: number): string {
  return typeof value === 'number' ? value.toFixed(1) : '—';
}

function formatNumber(value?: number): string {
  return typeof value === 'number' ? NUMBER_FORMAT.format(value) : '—';
}

function formatPercent(value?: number): string {
  return typeof value === 'number' ? `${value.toFixed(value % 1 === 0 ? 0 : 1)}%` : '—';
}

function signalTone(active: boolean): 'emerald' | 'amber' | 'zinc' {
  return active ? 'emerald' : 'zinc';
}

function toCompetitorRecord(competitor: CompetitorWithShareOfVoice): CompetitorRecord {
  return {
    source: competitor,
    title: competitor.title,
    share: typeof competitor.mapPackShareOfVoicePct === 'number' ? competitor.mapPackShareOfVoicePct : null,
    appearances: competitor.totalAppearances,
    wins: competitor.winsAgainstClient,
  };
}

const COMPETITOR_COLUMNS: DataColumn[] = [
  {
    key: 'title',
    label: 'Competitor',
    width: 'minmax(220px, 1.5fr)',
    render: (_value, record) => {
      const row = (record as CompetitorRecord).source;
      return (
        <div className="min-w-0">
          <span className="block truncate font-semibold text-[var(--brand-text-bright)]">{row.title}</span>
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
          <span className="tabular-nums font-semibold text-[var(--blue)]">
            {formatPercent(row.mapPackShareOfVoicePct)}
          </span>
          <span className="t-caption-sm text-[var(--brand-text-muted)]">
            {typeof row.mapPackShareOfVoiceBasis === 'number' ? `${row.totalAppearances}/${row.mapPackShareOfVoiceBasis} checks` : 'No basis'}
          </span>
        </div>
      );
    },
  },
  {
    key: 'appearances',
    label: 'Appearances',
    width: '130px',
    align: 'right',
    sortable: true,
  },
  {
    key: 'wins',
    label: 'Losses',
    width: '100px',
    align: 'right',
    sortable: true,
    render: (_value, record) => (
      <span className="tabular-nums font-semibold text-[var(--red)]">{(record as CompetitorRecord).wins}</span>
    ),
  },
  {
    key: 'markets',
    label: 'Markets',
    width: 'minmax(160px, 1fr)',
    render: (_value, record) => {
      const row = (record as CompetitorRecord).source;
      return <span className="t-caption-sm text-[var(--brand-text-muted)]">{row.markets.join(', ') || '—'}</span>;
    },
  },
];

export function LocalPresenceOverview({ workspaceId, data, gbp, onOpenSetup }: LocalPresenceOverviewProps) {
  const navigate = useNavigate();
  const report = data.report;
  const owned = gbp?.owned ?? null;
  const topCompetitor = gbp?.competitors[0] ?? null;
  const competitorRows = data.competitorBrands.map((competitor) => toCompetitorRecord(competitor));
  const photosCount = owned?.totalPhotos ?? 0;
  const attributeCount = owned?.attributes.length ?? 0;
  const hasCategory = Boolean(owned?.category?.trim());

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1.4fr)_minmax(300px,0.8fr)]">
        <div className="rounded-[var(--radius-lg)] border border-[var(--brand-border)] bg-[var(--surface-2)] p-4">
          <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="t-ui font-semibold text-[var(--brand-text-bright)]">Local operating status</h2>
              <p className="mt-1 t-caption-sm text-[var(--brand-text-muted)]">{report.setupDetail}</p>
            </div>
            <Badge label={report.workspacePosture.replace(/_/g, ' ')} tone={setupTone(report.setupState)} variant="outline" shape="pill" />
          </div>
          <p className="t-caption font-semibold text-[var(--brand-text-bright)]">{report.setupLabel}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {data.markets.length > 0 ? data.markets.slice(0, 6).map((market) => (
              <Badge
                key={market.id}
                label={market.label}
                tone={market.status === 'active' ? 'teal' : market.status === 'needs_review' ? 'amber' : 'zinc'}
                variant="soft"
                shape="pill"
              />
            )) : <Badge label="No markets" tone="zinc" variant="soft" shape="pill" />}
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button size="sm" variant={report.setupState === 'needs_market' ? 'primary' : 'secondary'} onClick={onOpenSetup}>
              <Icon name="settings" size="sm" />
              {report.setupState === 'needs_market' ? 'Configure market' : 'Edit markets'}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => navigate(`${adminPath(workspaceId, 'brand')}?tab=business-footprint&focus=locations-section`)}
            >
              <Icon name="pin" size="sm" />
              Location records
            </Button>
          </div>
        </div>

        <div className="rounded-[var(--radius-lg)] border border-[var(--brand-border)] bg-[var(--surface-2)] p-4">
          <div className="mb-3 flex items-start justify-between gap-3">
            <div>
              <h2 className="t-ui font-semibold text-[var(--brand-text-bright)]">GBP aggregate</h2>
              <p className="mt-1 t-caption-sm text-[var(--brand-text-muted)]">Rating, reviews, and the three profile signals currently available.</p>
            </div>
            <Badge label="Aggregate only" tone="zinc" variant="soft" shape="pill" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <MetricTile label="Rating" value={formatRating(owned?.rating)} sub={owned?.title ?? 'Owned listing'} accent="var(--blue)" icon={Star} />
            <MetricTile label="Reviews" value={formatNumber(owned?.reviewCount)} sub={topCompetitor?.reviewCount != null ? `Leader ${topCompetitor.reviewCount}` : 'No competitor basis'} accent="var(--blue)" icon={Search} />
          </div>
          {gbp?.completenessScore != null ? (
            <div className="mt-4">
              <Meter value={gbp.completenessScore} label="Profile completeness" showValue gradient ariaLabel="GBP profile completeness" />
              <div className="mt-3 flex flex-wrap gap-2">
                <Badge label={photosCount > 0 ? `${photosCount} photos` : 'No photos captured'} tone={signalTone(photosCount > 0)} variant="soft" shape="pill" />
                <Badge label={attributeCount > 0 ? `${attributeCount} attributes` : 'No attributes captured'} tone={signalTone(attributeCount > 0)} variant="soft" shape="pill" />
                <Badge label={hasCategory ? owned?.category ?? 'Category captured' : 'No category captured'} tone={signalTone(hasCategory)} variant="soft" shape="pill" />
              </div>
            </div>
          ) : (
            <p className="mt-4 t-caption-sm text-[var(--brand-text-muted)]">Run a GBP + reviews refresh to capture aggregate profile health.</p>
          )}
        </div>
      </div>

      <DataTable
        columns={COMPETITOR_COLUMNS}
        rows={competitorRows}
        getRowKey={(record) => (record as CompetitorRecord).source.title}
        empty={(
          <EmptyState
            icon={EmptyCompetitorIcon}
            title="No repeat map-pack competitors yet"
            description="Competitor share of voice appears after local-pack snapshots capture the same competitor at least twice."
          />
        )}
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricTile label="Markets" value={report.activeMarketCount} sub={`${report.configuredMarketCount} configured`} accent="var(--blue)" icon={MapPin} />
        <MetricTile label="Checked" value={report.checkedKeywordCount} sub={formatDate(report.lastCapturedAt)} accent="var(--blue)" icon={BarChart3} />
        <MetricTile label="Visible" value={report.visibleCount} sub="local matches" accent="var(--emerald)" icon={CheckCircle2} />
        <MetricTile label="Local packs" value={report.localPackPresentCount} sub="packs detected" accent="var(--blue)" icon={Search} />
      </div>
    </div>
  );
}
