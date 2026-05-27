import { useState } from 'react';
import {
  DollarSign, BarChart3, Target, TrendingUp,
  Lock, Shield, MousePointerClick, Eye, Layers,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { EmptyState, SectionCard, Button, StatCard, ErrorState, LoadingState, TierGate } from '../ui';
import { Icon } from '../ui/Icon';
import { fmtMoney, fmtMoneyFull } from '../../utils/formatNumbers';
import { useClientROI } from '../../hooks/client';
import { useBetaMode } from './BetaContext';
import { clientPath } from '../../routes';

interface ROIDashboardProps {
  workspaceId: string;
  tier: 'free' | 'growth' | 'premium';
}

export function ROIDashboard({ workspaceId, tier }: ROIDashboardProps) {
  const navigate = useNavigate();
  const betaMode = useBetaMode();
  const [showAllPages, setShowAllPages] = useState(false);
  const {
    data,
    isLoading,
    isError,
    error,
    refetch,
    isFetching,
  } = useClientROI(workspaceId, !!workspaceId);

  // Gate for paid tiers
  if (tier === 'free') {
    return (
      <TierGate
        tier={tier}
        required="growth"
        feature="ROI Dashboard"
        teaser="See the dollar value of your organic traffic and content performance. Available on Growth and Premium."
        onLearnMore={() => navigate(clientPath(workspaceId, 'plans', betaMode))}
      >
        <SectionCard className="text-center" noPadding>
          <div className="p-8">
            <div className="w-12 h-12 rounded-[var(--radius-xl)] bg-[var(--surface-3)] flex items-center justify-center mx-auto mb-4">
              <Icon as={Lock} size="xl" className="text-[var(--brand-text-dim)]" />
            </div>
            <h3 className="t-h2 text-[var(--brand-text-bright)] mb-2">ROI Dashboard</h3>
            <p className="t-body text-[var(--brand-text-muted)] max-w-sm mx-auto">
              See the dollar value of your organic traffic and how much you&apos;d pay for it in Google Ads.
            </p>
          </div>
        </SectionCard>
      </TierGate>
    );
  }

  if (isLoading) {
    return (
      <SectionCard noPadding>
        <div className="p-8">
        <LoadingState message="Calculating your traffic value..." size="md" />
        </div>
      </SectionCard>
    );
  }

  if (isError) {
    const message = error instanceof Error ? error.message : 'Failed to load ROI data';
    return (
      <ErrorState
        type="data"
        title="Couldn’t load ROI data"
        message={message}
        action={{ label: 'Try again', onClick: () => void refetch() }}
      />
    );
  }

  if (!data) {
    return (
      <EmptyState
        icon={DollarSign}
        title="ROI data unavailable"
        description="ROI appears once traffic and keyword cost data are available for this workspace."
        action={(
          <div className="flex items-center justify-center gap-2">
            <Button variant="secondary" size="sm" onClick={() => void refetch()} disabled={isFetching}>
              {isFetching ? 'Refreshing...' : 'Try again'}
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={() => navigate(clientPath(workspaceId, 'strategy', betaMode))}
            >
              Open Strategy
            </Button>
          </div>
        )}
      />
    );
  }

  const pages = showAllPages ? data.pageBreakdown : data.pageBreakdown.slice(0, 10);
  const maxValue = Math.max(...data.pageBreakdown.map(p => p.trafficValue), 1);

  return (
    <div className="space-y-8">
      {/* Hero metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <StatCard
          label="Organic Traffic Value"
          value={fmtMoneyFull(data.organicTrafficValue)}
          icon={DollarSign}
          valueColor="text-accent-success"
          sub={`Monthly value based on ${data.totalClicks.toLocaleString()} clicks × $${data.avgCPC.toFixed(2)} avg CPC`}
          className="bg-gradient-to-br from-emerald-500/10 via-[var(--surface-2)] to-[var(--surface-2)] border-emerald-500/20"
        />

        <StatCard
          label="Ad Spend Equivalent"
          value={fmtMoneyFull(data.adSpendEquivalent)}
          icon={BarChart3}
          valueColor="text-accent-info"
          sub="What this traffic would cost via Google Ads (incl. management fees)"
          className="bg-gradient-to-br from-blue-500/10 via-[var(--surface-2)] to-[var(--surface-2)] border-blue-500/20"
        />

        <StatCard
          label={data.growthPercent != null ? 'Month-over-Month' : 'Pages Tracked'}
          value={
            data.growthPercent != null
              ? `${data.growthPercent >= 0 ? '+' : ''}${data.growthPercent.toFixed(1)}%`
              : data.trackedPages
          }
          icon={data.growthPercent != null ? TrendingUp : Shield}
          valueColor={data.growthPercent != null ? (data.growthPercent >= 0 ? 'text-accent-brand' : 'text-accent-warning') : 'text-accent-brand'}
          sub={
            data.growthPercent != null
              ? `Traffic value growth vs. 30 days ago · ${data.trackedPages} pages tracked`
              : 'Pages generating organic value · growth tracking starts next month'
          }
          className={`bg-gradient-to-br ${data.growthPercent != null ? (data.growthPercent >= 0 ? 'from-teal-500/10 border-teal-500/20' : 'from-amber-500/10 border-amber-500/20') : 'from-teal-500/10 border-teal-500/20'} via-[var(--surface-2)] to-[var(--surface-2)]`}
        />
      </div>

      {/* Page breakdown table */}
      {data.pageBreakdown.length > 0 && (
        <SectionCard
          title="Traffic Value by Page"
          titleIcon={<Icon as={Target} size="md" className="text-accent-brand" />}
          action={<span className="t-caption-sm text-[var(--brand-text-muted)]">{data.pageBreakdown.length} pages</span>}
          noPadding
        >
          <div className="divide-y divide-[var(--brand-border)]/40">
            {pages.map((page, i) => (
              <div key={i} className="px-5 py-3 hover:bg-[var(--surface-3)]/20 transition-colors group">
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex-1 min-w-0 mr-4">
                    <div className="t-ui font-medium text-[var(--brand-text-bright)] truncate">{page.pageTitle || page.pagePath}</div>
                    <div className="flex items-center gap-3 mt-0.5">
                      <span className="t-caption-sm text-accent-brand truncate">&ldquo;{page.primaryKeyword}&rdquo;</span>
                      {page.position && <span className="t-caption-sm text-[var(--brand-text-muted)]">#{page.position.toFixed(1)}</span>}
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <div className="t-stat-sm text-accent-success">{fmtMoney(page.trafficValue)}<span className="t-caption-sm text-[var(--brand-text-muted)] font-normal">/mo</span></div>
                    <div className="flex items-center justify-end gap-2 mt-0.5">
                      <span className="flex items-center gap-0.5 t-caption-sm text-[var(--brand-text-muted)]">
                        <Icon as={MousePointerClick} size="sm" /> {page.clicks}
                      </span>
                      <span className="flex items-center gap-0.5 t-caption-sm text-[var(--brand-text-muted)]">
                        <Icon as={Eye} size="sm" /> {page.impressions.toLocaleString()}
                      </span>
                    </div>
                  </div>
                </div>
                {/* Value bar */}
                <div className="h-1 rounded-[var(--radius-pill)] bg-[var(--surface-3)] overflow-hidden">
                  <div
                    className="h-full rounded-[var(--radius-pill)] bg-gradient-to-r from-emerald-500/60 to-emerald-400/40 transition-all"
                    style={{ width: `${Math.max((page.trafficValue / maxValue) * 100, 2)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>

          {data.pageBreakdown.length > 10 && (
            <div className="px-5 py-2.5 border-t border-[var(--brand-border)]/60 text-center">
              <Button
                variant="ghost"
                onClick={() => setShowAllPages(!showAllPages)}
                className="t-caption-sm text-accent-brand hover:text-accent-brand transition-colors px-0 py-0"
              >
                {showAllPages ? 'Show less' : `Show all ${data.pageBreakdown.length} pages`}
              </Button>
            </div>
          )}
        </SectionCard>
      )}

      {/* Content ROI Attribution */}
      {data.contentItems && data.contentItems.length > 0 && (
        <SectionCard
          title="Content ROI Attribution"
          titleIcon={<Icon as={DollarSign} size="md" className="text-accent-success" />}
          action={
            <div className="flex items-center gap-3">
              {data.contentROI && (
                <>
                  <span className="t-caption-sm text-[var(--brand-text-muted)]">{data.contentROI.postsPublished} published</span>
                  {data.contentROI.totalContentSpend > 0 && (
                    <span className={`t-caption-sm font-medium ${data.contentROI.roi > 0 ? 'text-accent-success' : 'text-[var(--brand-text-muted)]'}`}>
                      {data.contentROI.roi > 0 ? '+' : ''}{data.contentROI.roi.toFixed(0)}% ROI
                    </span>
                  )}
                </>
              )}
            </div>
          }
          noPadding
        >
          <div className="divide-y divide-[var(--brand-border)]/40">
            {data.contentItems.map((item) => (
              <div key={item.requestId} className="px-5 py-3 hover:bg-[var(--surface-3)]/20 transition-colors">
                <div className="flex items-center justify-between mb-1">
                  <div className="flex-1 min-w-0 mr-4">
                    <div className="t-ui font-medium text-[var(--brand-text-bright)] truncate">{item.topic}</div>
                    <div className="flex items-center gap-3 mt-0.5">
                      <span className="t-caption-sm text-accent-brand">&ldquo;{item.targetKeyword}&rdquo;</span>
                      {item.targetPageSlug && <span className="t-caption-sm text-[var(--brand-text-muted)] font-mono">{item.targetPageSlug}</span>}
                      <span className={`t-caption-sm px-1.5 py-0.5 rounded-[var(--radius-pill)] badge-span-ok ${item.status === 'published' ? 'bg-teal-500/10 text-accent-brand' : 'bg-emerald-500/10 text-accent-success'}`}>
                        {item.status === 'published' ? 'Published' : 'Delivered'}
                      </span>
                      {item.source === 'matrix' && (
                        <span className="flex items-center gap-0.5 t-caption-sm px-1.5 py-0.5 rounded-[var(--radius-pill)] badge-span-ok bg-teal-500/10 text-accent-brand">
                          <Icon as={Layers} size="sm" /> Content Plan
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <div className="t-stat-sm text-accent-success">{item.trafficValue > 0 ? fmtMoney(item.trafficValue) : '$0'}<span className="t-caption-sm text-[var(--brand-text-muted)] font-normal">/mo</span></div>
                    <div className="flex items-center justify-end gap-2 mt-0.5">
                      <span className="flex items-center gap-0.5 t-caption-sm text-[var(--brand-text-muted)]">
                        <Icon as={MousePointerClick} size="sm" /> {item.clicks}
                      </span>
                      <span className="flex items-center gap-0.5 t-caption-sm text-[var(--brand-text-muted)]">
                        <Icon as={Eye} size="sm" /> {item.impressions.toLocaleString()}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
          {data.contentROI && data.contentROI.totalContentSpend > 0 && (
            <div className="px-5 py-3 border-t border-[var(--brand-border)]/60 bg-emerald-500/5">
              <div className="flex items-center justify-between t-caption-sm">
                <span className="text-[var(--brand-text)]">Content investment: <span className="text-[var(--brand-text-bright)] font-medium">{fmtMoneyFull(data.contentROI.totalContentSpend)}</span></span>
                <span className="text-[var(--brand-text)]">Annualized traffic value: <span className="text-accent-success font-medium">{fmtMoneyFull(data.contentROI.totalContentValue)}</span></span>
              </div>
            </div>
          )}
        </SectionCard>
      )}

      {/* Methodology note */}
      <div className="t-caption-sm text-[var(--brand-text-muted)] text-center px-4">
        Values calculated from Google Search Console click data and keyword cost estimates.
        Actual value may vary based on conversion rates and business metrics.
      </div>
    </div>
  );
}
