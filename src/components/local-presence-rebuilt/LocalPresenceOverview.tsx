// @ds-rebuilt
import { useNavigate } from 'react-router-dom';
import type { LocalSeoReadResponse } from '../../../shared/types/local-seo';
import type { GbpReviewsReadResponse } from '../../api/localSeo';
import { adminPath } from '../../routes';
import {
  Badge,
  Button,
  CompactStatBar,
  Icon,
  MetricRingSvg,
  SectionCard,
} from '../ui';

interface LocalPresenceOverviewProps {
  workspaceId: string;
  data: LocalSeoReadResponse;
  gbp?: GbpReviewsReadResponse;
  onOpenSetup: () => void;
}

const NUMBER_FORMAT = new Intl.NumberFormat('en-US');

function formatRating(value?: number): string {
  return typeof value === 'number' ? value.toFixed(1) : '—';
}

function formatNumber(value?: number): string {
  return typeof value === 'number' ? NUMBER_FORMAT.format(value) : '—';
}

function postureTone(posture: LocalSeoReadResponse['report']['workspacePosture']): 'blue' | 'emerald' | 'zinc' {
  if (posture === 'local') return 'emerald';
  if (posture === 'hybrid') return 'blue';
  return 'zinc';
}

export function LocalPresenceOverview({ workspaceId, data, gbp, onOpenSetup }: LocalPresenceOverviewProps) {
  const navigate = useNavigate();
  const report = data.report;
  const owned = gbp?.owned ?? null;
  const primaryMarket = data.markets.find((market) => market.isPrimary) ?? data.markets[0] ?? null;
  const profileName = owned?.title ?? primaryMarket?.label ?? 'Local profile';
  const profileDetail = [owned?.category, primaryMarket?.label]
    .filter((value, index, values): value is string => Boolean(value) && values.indexOf(value) === index)
    .join(' · ');
  const summaryItems: Array<{ label: string; value: string | number; sub: string; valueColor: string }> = [
    { label: 'Markets', value: report.activeMarketCount, sub: `${report.configuredMarketCount} configured`, valueColor: 'text-[var(--blue)]' },
    { label: 'Checked', value: report.checkedKeywordCount, sub: `${report.latestSnapshotCount} snapshots`, valueColor: 'text-[var(--blue)]' },
    { label: 'Visible', value: report.visibleCount, sub: 'confident matches', valueColor: 'text-[var(--emerald)]' },
    { label: 'Local packs', value: report.localPackPresentCount, sub: 'packs detected', valueColor: 'text-[var(--blue)]' },
  ];

  if (owned) {
    summaryItems.push(
      { label: 'Rating', value: formatRating(owned.rating), sub: 'GBP aggregate', valueColor: 'text-[var(--brand-yellow)]' },
      { label: 'Reviews', value: formatNumber(owned.reviewCount), sub: 'GBP aggregate', valueColor: 'text-[var(--blue)]' },
    );
  }

  return (
    <SectionCard noPadding className="overflow-hidden">
      <div className="grid gap-5 px-5 py-5 md:grid-cols-[auto_minmax(0,1fr)_auto] md:items-center md:px-6">
        <div className="flex h-[60px] w-[60px] items-center justify-center rounded-[var(--radius-lg)] bg-[var(--surface-3)] t-h1 font-bold text-[var(--blue)]">
          {profileName.slice(0, 1).toUpperCase()}
        </div>

        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="truncate t-page font-bold text-[var(--brand-text-bright)]">{profileName}</h2>
            <Badge
              label={report.workspacePosture.replace(/_/g, ' ')}
              tone={postureTone(report.workspacePosture)}
              variant="outline"
              shape="pill"
            />
          </div>
          <p className="mt-1 t-body text-[var(--brand-text-muted)]">
            {profileDetail || report.setupDetail}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {data.markets.slice(0, 4).map((market) => (
              <Badge
                key={market.id}
                label={market.label}
                tone={market.status === 'active' ? 'teal' : market.status === 'needs_review' ? 'amber' : 'zinc'}
                variant="soft"
                shape="pill"
              />
            ))}
            <Button size="sm" variant="secondary" onClick={onOpenSetup}>
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

        {gbp?.completenessScore != null ? (
          <div className="flex items-center gap-3 md:flex-col md:text-center">
            <MetricRingSvg score={gbp.completenessScore} size={64} strokeWidth={6} />
            <span className="t-micro uppercase tracking-[0.05em] text-[var(--brand-text-dim)]">Profile complete</span>
          </div>
        ) : (
          <div className="flex max-w-[180px] items-start gap-2 rounded-[var(--radius-md)] border border-[var(--brand-border)] bg-[var(--surface-1)] px-3 py-2 text-[var(--brand-text-muted)]">
            <Icon name="info" size="sm" className="mt-0.5 shrink-0 text-[var(--blue)]" />
            <span className="t-caption-sm">Profile health appears after a GBP aggregate refresh.</span>
          </div>
        )}
      </div>

      <CompactStatBar
        items={summaryItems}
        className="rounded-none border-x-0 border-b-0 bg-[var(--surface-1)] px-5 py-3 md:px-6"
      />
    </SectionCard>
  );
}
