import { useState, useEffect } from 'react';
import {
  DollarSign, BarChart3, Target, TrendingUp,
  Lock, Shield, MousePointerClick, Eye, Layers,
} from 'lucide-react';
import { EmptyState } from '../ui';
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
      <div className="bg-zinc-900/60 border border-zinc-800 p-8 text-center" style={{ borderRadius: '10px 24px 10px 24px' }}>
        <div className="w-12 h-12 rounded-2xl bg-zinc-800 flex items-center justify-center mx-auto mb-4">
          <Lock className="w-6 h-6 text-zinc-600" />
        </div>
        <h3 className="text-lg font-semibold text-zinc-300 mb-2">ROI Dashboard</h3>
        <p className="text-sm text-zinc-500 max-w-sm mx-auto">
          See the dollar value of your organic traffic and how much you&apos;d pay for it in Google Ads.
          Available on Growth and Premium plans.
        </p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="bg-zinc-900/60 border border-zinc-800 p-8" style={{ borderRadius: '10px 24px 10px 24px' }}>
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
        <div className="bg-gradient-to-br from-emerald-500/10 via-zinc-900 to-zinc-900 border border-emerald-500/20 p-5" style={{ borderRadius: '6px 12px 6px 12px' }}>
          <div className="flex items-center gap-2 mb-3">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/15 flex items-center justify-center">
              <DollarSign className="w-4 h-4 text-emerald-400" />
            </div>
            <span className="text-xs text-zinc-400 font-medium">Organic Traffic Value</span>
          </div>
          <div className="text-2xl font-bold text-emerald-300 tracking-tight">{fmtMoneyFull(data.organicTrafficValue)}</div>
          <div className="text-[11px] text-zinc-500 mt-1">
            Monthly value based on {data.totalClicks.toLocaleString()} clicks × ${data.avgCPC.toFixed(2)} avg CPC
          </div>
        </div>

        {/* Ad Spend Equivalent */}
        <div className="bg-gradient-to-br from-blue-500/10 via-zinc-900 to-zinc-900 border border-blue-500/20 p-5" style={{ borderRadius: '6px 12px 6px 12px' }}>
          <div className="flex items-center gap-2 mb-3">
            <div className="w-8 h-8 rounded-lg bg-blue-500/15 flex items-center justify-center">
              <BarChart3 className="w-4 h-4 text-blue-400" />
            </div>
            <span className="text-xs text-zinc-400 font-medium">Ad Spend Equivalent</span>
          </div>
          <div className="text-2xl font-bold text-blue-300 tracking-tight">{fmtMoneyFull(data.adSpendEquivalent)}</div>
          <div className="text-[11px] text-zinc-500 mt-1">
            What this traffic would cost via Google Ads (incl. management fees)
          </div>
        </div>

        {/* MoM Growth or Pages Tracked */}
        <div className={`bg-gradient-to-br ${data.growthPercent != null ? (data.growthPercent >= 0 ? 'from-teal-500/10' : 'from-amber-500/10') : 'from-teal-500/10'} via-zinc-900 to-zinc-900 border ${data.growthPercent != null ? (data.growthPercent >= 0 ? 'border-teal-500/20' : 'border-amber-500/20') : 'border-teal-500/20'} p-5`} style={{ borderRadius: '6px 12px 6px 12px' }}>
          <div className="flex items-center gap-2 mb-3">
            <div className={`w-8 h-8 rounded-lg ${data.growthPercent != null ? (data.growthPercent >= 0 ? 'bg-teal-500/15' : 'bg-amber-500/15') : 'bg-teal-500/15'} flex items-center justify-center`}>
              {data.growthPercent != null
                ? <TrendingUp className={`w-4 h-4 ${data.growthPercent >= 0 ? 'text-teal-400' : 'text-amber-400'}`} />
                : <Shield className="w-4 h-4 text-teal-400" />}
            </div>
            <span className="text-xs text-zinc-400 font-medium">
              {data.growthPercent != null ? 'Month-over-Month' : 'Pages Tracked'}
            </span>
          </div>
          {data.growthPercent != null ? (
            <>
              <div className={`text-2xl font-bold tracking-tight ${data.growthPercent >= 0 ? 'text-teal-300' : 'text-amber-300'}`}>
                {data.growthPercent >= 0 ? '+' : ''}{data.growthPercent.toFixed(1)}%
              </div>
              <div className="text-[11px] text-zinc-500 mt-1">
                Traffic value growth vs. 30 days ago · {data.trackedPages} pages tracked
              </div>
            </>
          ) : (
            <>
              <div className="text-2xl font-bold text-teal-300 tracking-tight">{data.trackedPages}</div>
              <div className="text-[11px] text-zinc-500 mt-1">
                Pages generating organic value · growth tracking starts next month
              </div>
            </>
          )}
        </div>
      </div>

      {/* Page breakdown table */}
      {data.pageBreakdown.length > 0 && (
        <div className="bg-zinc-900/60 border border-zinc-800 overflow-hidden" style={{ borderRadius: '10px 24px 10px 24px' }}>
          <div className="px-5 py-3.5 border-b border-zinc-800/60 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Target className="w-4 h-4 text-teal-400" />
              <span className="text-xs font-semibold text-zinc-200">Traffic Value by Page</span>
            </div>
            <span className="text-[10px] text-zinc-500">{data.pageBreakdown.length} pages</span>
          </div>

          <div className="divide-y divide-zinc-800/40">
            {pages.map((page, i) => (
              <div key={i} className="px-5 py-3 hover:bg-zinc-800/20 transition-colors group">
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex-1 min-w-0 mr-4">
                    <div className="text-xs font-medium text-zinc-200 truncate">{page.pageTitle || page.pagePath}</div>
                    <div className="flex items-center gap-3 mt-0.5">
                      <span className="text-[10px] text-teal-400/70 truncate">&ldquo;{page.primaryKeyword}&rdquo;</span>
                      {page.position && <span className="text-[10px] text-zinc-500">#{page.position.toFixed(1)}</span>}
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <div className="text-xs font-bold text-emerald-300">{fmtMoney(page.trafficValue)}<span className="text-zinc-600 font-normal">/mo</span></div>
                    <div className="flex items-center justify-end gap-2 mt-0.5">
                      <span className="flex items-center gap-0.5 text-[10px] text-zinc-500">
                        <MousePointerClick className="w-2.5 h-2.5" /> {page.clicks}
                      </span>
                      <span className="flex items-center gap-0.5 text-[10px] text-zinc-500">
                        <Eye className="w-2.5 h-2.5" /> {page.impressions.toLocaleString()}
                      </span>
                    </div>
                  </div>
                </div>
                {/* Value bar */}
                <div className="h-1 rounded-full bg-zinc-800 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-emerald-500/60 to-emerald-400/40 transition-all"
                    style={{ width: `${Math.max((page.trafficValue / maxValue) * 100, 2)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>

          {data.pageBreakdown.length > 10 && (
            <div className="px-5 py-2.5 border-t border-zinc-800/60 text-center">
              <button
                onClick={() => setShowAllPages(!showAllPages)}
                className="text-[11px] text-teal-400 hover:text-teal-300 transition-colors"
              >
                {showAllPages ? 'Show less' : `Show all ${data.pageBreakdown.length} pages`}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Content ROI Attribution */}
      {data.contentItems && data.contentItems.length > 0 && (
        <div className="bg-zinc-900/60 border border-zinc-800 overflow-hidden" style={{ borderRadius: '10px 24px 10px 24px' }}>
          <div className="px-5 py-3.5 border-b border-zinc-800/60 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <DollarSign className="w-4 h-4 text-emerald-400" />
              <span className="text-xs font-semibold text-zinc-200">Content ROI Attribution</span>
            </div>
            <div className="flex items-center gap-3">
              {data.contentROI && (
                <>
                  <span className="text-[10px] text-zinc-500">{data.contentROI.postsPublished} published</span>
                  {data.contentROI.totalContentSpend > 0 && (
                    <span className={`text-[10px] font-medium ${data.contentROI.roi > 0 ? 'text-emerald-400' : 'text-zinc-500'}`}>
                      {data.contentROI.roi > 0 ? '+' : ''}{data.contentROI.roi.toFixed(0)}% ROI
                    </span>
                  )}
                </>
              )}
            </div>
          </div>
          <div className="divide-y divide-zinc-800/40">
            {data.contentItems.map((item) => (
              <div key={item.requestId} className="px-5 py-3 hover:bg-zinc-800/20 transition-colors">
                <div className="flex items-center justify-between mb-1">
                  <div className="flex-1 min-w-0 mr-4">
                    <div className="text-xs font-medium text-zinc-200 truncate">{item.topic}</div>
                    <div className="flex items-center gap-3 mt-0.5">
                      <span className="text-[10px] text-teal-400/70">&ldquo;{item.targetKeyword}&rdquo;</span>
                      {item.targetPageSlug && <span className="text-[10px] text-zinc-500 font-mono">{item.targetPageSlug}</span>}
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${item.status === 'published' ? 'bg-teal-500/10 text-teal-400' : 'bg-green-500/10 text-emerald-400'}`}>
                        {item.status === 'published' ? 'Published' : 'Delivered'}
                      </span>
                      {item.source === 'matrix' && (
                        <span className="flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full bg-teal-500/10 text-teal-400">
                          <Layers className="w-2.5 h-2.5" /> Content Plan
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <div className="text-xs font-bold text-emerald-300">{item.trafficValue > 0 ? fmtMoney(item.trafficValue) : '$0'}<span className="text-zinc-600 font-normal">/mo</span></div>
                    <div className="flex items-center justify-end gap-2 mt-0.5">
                      <span className="flex items-center gap-0.5 text-[10px] text-zinc-500">
                        <MousePointerClick className="w-2.5 h-2.5" /> {item.clicks}
                      </span>
                      <span className="flex items-center gap-0.5 text-[10px] text-zinc-500">
                        <Eye className="w-2.5 h-2.5" /> {item.impressions.toLocaleString()}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
          {data.contentROI && data.contentROI.totalContentSpend > 0 && (
            <div className="px-5 py-3 border-t border-zinc-800/60 bg-emerald-500/5">
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-zinc-400">Content investment: <span className="text-zinc-300 font-medium">{fmtMoneyFull(data.contentROI.totalContentSpend)}</span></span>
                <span className="text-zinc-400">Annualized traffic value: <span className="text-emerald-400 font-medium">{fmtMoneyFull(data.contentROI.totalContentValue)}</span></span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Methodology note */}
      <div className="text-[10px] text-zinc-600 text-center px-4">
        Values calculated from Google Search Console click data × SEMRush CPC estimates.
        Actual value may vary based on conversion rates and business metrics.
      </div>
    </div>
  );
}
