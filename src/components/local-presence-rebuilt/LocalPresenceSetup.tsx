// @ds-rebuilt
import { useNavigate } from 'react-router-dom';
import type { LocalSeoReadResponse } from '../../../shared/types/local-seo';
import { adminPath } from '../../routes';
import { Badge, Button, GroupBlock, Icon, MetricTile } from '../ui';

interface LocalPresenceSetupProps {
  workspaceId: string;
  data: LocalSeoReadResponse;
  onOpenSetup: () => void;
}

export function LocalPresenceSetup({ workspaceId, data, onOpenSetup }: LocalPresenceSetupProps) {
  const navigate = useNavigate();
  const activeMarkets = data.markets.filter((market) => market.status === 'active');
  const needsReview = data.markets.filter((market) => market.status === 'needs_review');

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricTile label="Active markets" value={activeMarkets.length} sub={`${data.caps.maxMarkets} max`} accent="var(--blue)" />
        <MetricTile label="Needs review" value={needsReview.length} sub="market rows" accent={needsReview.length > 0 ? 'var(--amber)' : 'var(--emerald)'} />
        <MetricTile label="Suggested" value={data.suggestedMarkets.length} sub="from workspace profile" accent="var(--teal)" />
        <MetricTile label="Refresh budget" value={data.caps.maxKeywordsPerRefresh} sub="keywords per scan" accent="var(--blue)" />
      </div>

      <GroupBlock
        title="Markets and refresh settings"
        meta="Configure local posture, active markets, provider identity, and scan budget."
        flag={{ label: data.report.setupLabel, color: 'var(--teal)', bg: 'var(--brand-mint-dim)', border: 'color-mix(in srgb, var(--teal) 28%, transparent)' }}
      >
        <div className="grid gap-3 p-2 lg:grid-cols-2">
          <div className="rounded-[var(--radius-md)] border border-[var(--brand-border)] bg-[var(--surface-1)] p-3">
            <div className="mb-2 flex items-center gap-2">
              <Icon name="pin" size="sm" className="text-[var(--teal)]" />
              <p className="t-caption font-semibold text-[var(--brand-text-bright)]">Market setup</p>
            </div>
            <p className="t-caption-sm text-[var(--brand-text-muted)]">{data.report.setupDetail}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {data.markets.length > 0 ? data.markets.map((market) => (
                <Badge
                  key={market.id}
                  label={market.label}
                  tone={market.status === 'active' ? 'teal' : market.status === 'needs_review' ? 'amber' : 'zinc'}
                  variant="soft"
                  shape="pill"
                />
              )) : <Badge label="No markets configured" tone="zinc" variant="soft" shape="pill" />}
            </div>
            <Button className="mt-4" size="sm" variant="primary" onClick={onOpenSetup}>
              <Icon name="settings" size="sm" />
              Open setup drawer
            </Button>
          </div>

          <div className="rounded-[var(--radius-md)] border border-[var(--brand-border)] bg-[var(--surface-1)] p-3">
            <div className="mb-2 flex items-center gap-2">
              <Icon name="clipboard" size="sm" className="text-[var(--teal)]" />
              <p className="t-caption font-semibold text-[var(--brand-text-bright)]">Business locations</p>
            </div>
            <p className="t-caption-sm text-[var(--brand-text-muted)]">
              Location records stay in Brand & AI. Authenticated GBP locations map to those records for review sync and local match accuracy.
            </p>
            <Button
              className="mt-4"
              size="sm"
              variant="secondary"
              onClick={() => navigate(`${adminPath(workspaceId, 'brand')}?tab=business-footprint&focus=locations-section`)}
            >
              <Icon name="arrowRight" size="sm" />
              Open location records
            </Button>
          </div>
        </div>
      </GroupBlock>
    </div>
  );
}
