import { useState, useEffect } from 'react';
import {
  DollarSign, BarChart3, Target, TrendingUp,
  Lock, Shield, MousePointerClick, Eye, Layers,
} from 'lucide-react';
import { EmptyState } from '../ui';
import { Icon } from '../ui/Icon';
import { fmtMoney, fmtMoneyFull } from '../../utils/formatNumbers';
import { get } from '../../api/client';
import { LoadingState } from '../ui';

interface PageROI {
  pagePath: string;
  pageTitle: string;
  primaryKeyword: string;
  clicks: number;
  impressions: number;
  cpc: number;
  trafficValue: number;
  position: number | null;
}

interface ContentItemROI {
  requestId: string;
  topic: string;
  targetKeyword: string;
  targetPageId: string;
  targetPageSlug?: string;
  status: string;
  clicks: number;
  impressions: number;
  trafficValue: number;
  source?: 'request' | 'matrix';
}

interface ROIData {
  organicTrafficValue: number;
  adSpendEquivalent: number;
  growthPercent: number | null;
  pageBreakdown: PageROI[];
  totalClicks: number;
  totalImpressions: number;
  avgCPC: number;
  trackedPages: number;
  contentROI: { totalContentSpend: number; totalContentValue: number; roi: number; postsPublished: number } | null;
  contentItems: ContentItemROI[];
  computedAt: string;
}

interface ROIDashboardProps {
  workspaceId: string;
  tier: 'free' | 'growth' | 'premium';
}

export function ROIDashboard({ workspaceId, tier }: ROIDashboardProps) {
  const [data, setData] = useState<ROIData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAllPages, setShowAllPages] = useState(false);

  useEffect(() => {
    get<ROIData>(`/api/public/roi/${workspaceId}`)
      .then(d => { setData(d); setError(null); })
      .catch(e => setError(e instanceof Error ? e.message : 'Failed to load ROI data'))
      .finally(() => setLoading(false));
  }, [workspaceId]);

  // Gate for premium tier
  if (tier !== 'premium' && tier !== 'growth') {
    return (
      // pr-check-disable-next-line -- ROIDashboard tier-gate is a top-level container intentionally using brand signature shape
      <div className="bg-[var(--surface-2)] border border-[var(--brand-border)] p-8 text-center" style={{ borderRadius: 'var(--radius-signature-lg)' }}>
        <div className="w-12 h-12 rounded-[var(--radius-xl)] bg-[var(--surface-3)] flex items-center justify-center mx-auto mb-4">
          <Icon as={Lock} size="xl" className="text-[var(--brand-text-dim)]" />
        </div>
        <h3 className="text-lg font-semibold text-[var(--brand-text-bright)] mb-2">ROI Dashboard</h3>
        <p className="t-body text-[var(--brand-text-muted)] max-w-sm mx-auto">
          See the dollar value of your organic traffic and how much you&apos;d pay for it in Google Ads.
          Available on Growth and Premium plans.
        </p>
      </div>
    );
  }

  if (loading) {
    return (
      // pr-check-disable-next-line -- ROIDashboard loading state is a top-level container intentionally using brand signature shape
      <div className="bg-[var(--surface-2)] border border-[var(--brand-border)] p-8" style={{ borderRadius: 'var(--radius-signature-lg)' }}>
        <LoadingState message="Calculating your traffic value..." size="md" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <EmptyState icon={DollarSign} title="ROI data unavailable" description={error || 'ROI data requires a keyword strategy with CPC data. Run a strategy with SEMRush enrichment to unlock this.'} />
    );
  }

  const pages = showAllPages ? data.pageBreakdown : data.pageBreakdown.slice(0, 10);
  const maxValue = Math.max(...data.pageBreakdown.map(p => p.trafficValue), 1);

  return (
    <div className="space-y-8">
      {/* Hero metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {/* Organic Traffic Value */}
        <div className="bg-gradient-to-br from-emerald-500/10 via-[var(--surface-2)] to-[var(--surface-2)] border border-emerald-500/20 p-5" style={{ borderRadius: 'var(--radius-signature)' }}>
          <div className="flex items-center gap-2 mb-3">
            <div className="w-8 h-8 rounded-[var(--radius-md)] bg-emerald-500/15 flex items-center justify-center">
              <Icon as={DollarSign} size="md" className="text-accent-success" />
            </div>
            <span className="t-caption text-[var(--brand-text)] font-medium">Organic Traffic Value</span>
          </div>
          <div className="text-2xl font-bold text-accent-success tracking-tight">{fmtMoneyFull(data.organicTrafficValue)}</div>
          <div className="t-caption-sm text-[var(--brand-text-muted)] mt-1">
            Monthly value based on {data.totalClicks.toLocaleString()} clicks × ${data.avgCPC.toFixed(2)} avg CPC
          </div>
        </div>

        {/* Ad Spend Equivalent */}
        <div className="bg-gradient-to-br from-blue-500/10 via-[var(--surface-2)] to-[var(--surface-2)] border border-blue-500/20 p-5" style={{ borderRadius: 'var(--radius-signature)' }}>
          <div className="flex items-center gap-2 mb-3">
            <div className="w-8 h-8 rounded-[var(--radius-md)] bg-blue-500/15 flex items-center justify-center">
              <Icon as={BarChart3} size="md" className="text-accent-info" />
            </div>
            <span className="t-caption text-[var(--brand-text)] font-medium">Ad Spend Equivalent</span>
          </div>
          <div className="text-2xl font-bold text-accent-info tracking-tight">{fmtMoneyFull(data.adSpendEquivalent)}</div>
          <div className="t-caption-sm text-[var(--brand-text-muted)] mt-1">
            What this traffic would cost via Google Ads (incl. management fees)
          </div>
        </div>

        {/* MoM Growth or Pages Tracked */}
        <div className={`bg-gradient-to-br ${data.growthPercent != null ? (data.growthPercent >= 0 ? 'from-teal-500/10' : 'from-amber-500/10') : 'from-teal-500/10'} via-[var(--surface-2)] to-[var(--surface-2)] border ${data.growthPercent != null ? (data.growthPercent >= 0 ? 'border-teal-500/20' : 'border-amber-500/20') : 'border-teal-500/20'} p-5`} style={{ borderRadius: 'var(--radius-signature)' }}>
          <div className="flex items-center gap-2 mb-3">
            <div className={`w-8 h-8 rounded-[var(--radius-md)] ${data.growthPercent != null ? (data.growthPercent >= 0 ? 'bg-teal-500/15' : 'bg-amber-500/15') : 'bg-teal-500/15'} flex items-center justify-center`}>
              {data.growthPercent != null
                ? <Icon as={TrendingUp} size="md" className={data.growthPercent >= 0 ? 'text-accent-brand' : 'text-accent-warning'} />
                : <Icon as={Shield} size="md" className="text-accent-brand" />}
            </div>
            <span className="t-caption text-[var(--brand-text)] font-medium">
              {data.growthPercent != null ? 'Month-over-Month' : 'Pages Tracked'}
            </span>
          </div>
          {data.growthPercent != null ? (
            <>
              <div className={`text-2xl font-bold tracking-tight ${data.growthPercent >= 0 ? 'text-accent-brand' : 'text-accent-warning'}`}>
                {data.growthPercent >= 0 ? '+' : ''}{data.growthPercent.toFixed(1)}%
              </div>
              <div className="t-caption-sm text-[var(--brand-text-muted)] mt-1">
                Traffic value growth vs. 30 days ago · {data.trackedPages} pages tracked
              </div>
            </>
          ) : (
            <>
              <div className="text-2xl font-bold text-accent-brand tracking-tight">{data.trackedPages}</div>
              <div className="t-caption-sm text-[var(--brand-text-muted)] mt-1">
                Pages generating organic value · growth tracking starts next month
              </div>
            </>
          )}
        </div>
      </div>

      {/* Page breakdown table */}
      {data.pageBreakdown.length > 0 && (
        // pr-check-disable-next-line -- ROIDashboard page breakdown panel is a top-level data container intentionally using brand signature shape
        <div className="bg-[var(--surface-2)] border border-[var(--brand-border)] overflow-hidden" style={{ borderRadius: 'var(--radius-signature-lg)' }}>
          <div className="px-5 py-3.5 border-b border-[var(--brand-border)]/60 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Icon as={Target} size="md" className="text-accent-brand" />
              <span className="t-caption font-semibold text-[var(--brand-text-bright)]">Traffic Value by Page</span>
            </div>
            <span className="t-caption-sm text-[var(--brand-text-muted)]">{data.pageBreakdown.length} pages</span>
          </div>

          <div className="divide-y divide-[var(--brand-border)]/40">
            {pages.map((page, i) => (
              <div key={i} className="px-5 py-3 hover:bg-[var(--surface-3)]/20 transition-colors group">
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex-1 min-w-0 mr-4">
                    <div className="t-caption font-medium text-[var(--brand-text-bright)] truncate">{page.pageTitle || page.pagePath}</div>
                    <div className="flex items-center gap-3 mt-0.5">
                      <span className="t-caption-sm text-accent-brand truncate">&ldquo;{page.primaryKeyword}&rdquo;</span>
                      {page.position && <span className="t-caption-sm text-[var(--brand-text-muted)]">#{page.position.toFixed(1)}</span>}
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <div className="t-caption font-bold text-accent-success">{fmtMoney(page.trafficValue)}<span className="text-[var(--brand-text-dim)] font-normal">/mo</span></div>
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
              <button
                onClick={() => setShowAllPages(!showAllPages)}
                className="t-caption-sm text-accent-brand hover:text-accent-brand transition-colors"
              >
                {showAllPages ? 'Show less' : `Show all ${data.pageBreakdown.length} pages`}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Content ROI Attribution */}
      {data.contentItems && data.contentItems.length > 0 && (
        // pr-check-disable-next-line -- ROIDashboard content ROI panel is a top-level data container intentionally using brand signature shape
        <div className="bg-[var(--surface-2)] border border-[var(--brand-border)] overflow-hidden" style={{ borderRadius: 'var(--radius-signature-lg)' }}>
          <div className="px-5 py-3.5 border-b border-[var(--brand-border)]/60 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Icon as={DollarSign} size="md" className="text-accent-success" />
              <span className="t-caption font-semibold text-[var(--brand-text-bright)]">Content ROI Attribution</span>
            </div>
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
          </div>
          <div className="divide-y divide-[var(--brand-border)]/40">
            {data.contentItems.map((item) => (
              <div key={item.requestId} className="px-5 py-3 hover:bg-[var(--surface-3)]/20 transition-colors">
                <div className="flex items-center justify-between mb-1">
                  <div className="flex-1 min-w-0 mr-4">
                    <div className="t-caption font-medium text-[var(--brand-text-bright)] truncate">{item.topic}</div>
                    <div className="flex items-center gap-3 mt-0.5">
                      <span className="t-caption-sm text-accent-brand">&ldquo;{item.targetKeyword}&rdquo;</span>
                      {item.targetPageSlug && <span className="t-caption-sm text-[var(--brand-text-muted)] font-mono">{item.targetPageSlug}</span>}
                      <span className={`t-caption-sm px-1.5 py-0.5 rounded-[var(--radius-pill)] ${item.status === 'published' ? 'bg-teal-500/10 text-accent-brand' : 'bg-emerald-500/10 text-accent-success'}`}>
                        {item.status === 'published' ? 'Published' : 'Delivered'}
                      </span>
                      {item.source === 'matrix' && (
                        <span className="flex items-center gap-0.5 t-caption-sm px-1.5 py-0.5 rounded-[var(--radius-pill)] bg-teal-500/10 text-accent-brand">
                          <Icon as={Layers} size="sm" /> Content Plan
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <div className="t-caption font-bold text-accent-success">{item.trafficValue > 0 ? fmtMoney(item.trafficValue) : '$0'}<span className="text-[var(--brand-text-dim)] font-normal">/mo</span></div>
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
        </div>
      )}

      {/* Methodology note */}
      <div className="t-caption-sm text-[var(--brand-text-dim)] text-center px-4">
        Values calculated from Google Search Console click data × SEMRush CPC estimates.
        Actual value may vary based on conversion rates and business metrics.
      </div>
    </div>
  );
}
