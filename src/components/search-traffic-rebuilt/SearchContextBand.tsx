// @ds-rebuilt
import { Search } from 'lucide-react';
import { InsightFeed } from '../insights';
import { ChartCard, GroupBlock, InlineBanner, KeyValueRow } from '../ui';
import type { FeedInsight, SummaryCount } from '../../../shared/types/insights';
import type { BrandedDemandSplit } from './types';
import { SERIES, formatNumber, formatPercent } from './searchTrafficUtils';

interface SearchContextBandProps {
  workspaceId: string;
  brandedDemand?: BrandedDemandSplit;
  feed: FeedInsight[];
  summary?: SummaryCount[];
  loading: boolean;
}

/** Search-derived context retained below the focused report and legacy Overview receiver. */
export function SearchContextBand({ workspaceId, brandedDemand, feed, summary, loading }: SearchContextBandProps) {
  return (
    <div className="flex flex-col gap-4">
      {brandedDemand?.status === 'error' && (
        <InlineBanner tone="warning" title="Branded split may be stale">
          {brandedDemand.error ?? 'Search overview loaded, but the branded/non-branded split did not refresh.'}
        </InlineBanner>
      )}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
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
              <p className="t-body text-[var(--brand-text-muted)]">
                Share uses impressions as the denominator; missing query rows remain in the non-branded remainder.
              </p>
            </div>
          ) : (
            <div className="px-2 pb-2 t-body text-[var(--brand-text-muted)]">
              {brandedDemand?.status === 'error' ? 'Split unavailable for this refresh.' : 'Brand tokens were not available for this workspace.'}
            </div>
          )}
        </GroupBlock>

        <ChartCard title="Priority insights">
          <InsightFeed
            feed={feed}
            summary={summary}
            loading={loading}
            showPills
            workspaceId={workspaceId}
            limit={6}
          />
        </ChartCard>
      </div>
    </div>
  );
}
