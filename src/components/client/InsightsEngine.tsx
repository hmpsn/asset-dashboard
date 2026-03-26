import { useState, useEffect, useMemo } from 'react';
import {
  Lightbulb, Zap, Clock, CalendarClock, RefreshCw,
  TrendingUp, TrendingDown, ShoppingCart, Crown, ChevronDown, ChevronRight,
  CheckCircle2, MousePointerClick, Eye,
  FileText, Code2, Image, Wrench, Target, PenTool, Sparkles,
  Loader2, XCircle, ArrowUpRight, Shield,
} from 'lucide-react';
import { useCart } from './useCart';
import type { ProductType } from '../../../shared/types/payments.ts';
import type { RecPriority, RecType, RecStatus, Recommendation, RecommendationSet } from '../../../shared/types/recommendations.ts';
import { STUDIO_NAME } from '../../constants';
import { get, post, patch, del } from '../../api/client';

// ─── Props ────────────────────────────────────────────────────────

interface InsightsEngineProps {
  workspaceId: string;
  tier?: 'free' | 'growth' | 'premium';
  compact?: boolean; // for embedding in overview tab
  onNavigate?: (tab: string, context?: { pageSlug?: string; recType?: string }) => void;
}

// Map recommendation types to the admin dashboard tab that handles them
const REC_TYPE_TAB: Record<RecType, string> = {
  metadata: 'seo-editor',
  schema: 'seo-schema',
  technical: 'seo-audit',
  performance: 'performance',
  accessibility: 'seo-audit',
  content: 'seo-briefs',
  content_refresh: 'seo-briefs',
  strategy: 'seo-strategy',
  aeo: 'seo-audit',
};

// ─── Helpers ──────────────────────────────────────────────────────

const fmt = (usd: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0 }).format(usd);

const num = (n: number) => n >= 1000 ? `${(n / 1000).toFixed(1)}k` : n.toLocaleString();

const PRIORITY_CONFIG: Record<RecPriority, { label: string; icon: typeof Zap; color: string; bg: string; border: string; description: string }> = {
  fix_now: {
    label: 'Fix Now',
    icon: Zap,
    color: 'text-red-400',
    bg: 'bg-red-500/10',
    border: 'border-red-500/20',
    description: 'Critical issues on high-traffic pages — fix these first for the biggest impact',
  },
  fix_soon: {
    label: 'Fix Soon',
    icon: Clock,
    color: 'text-amber-400',
    bg: 'bg-amber-500/10',
    border: 'border-amber-500/20',
    description: 'Important improvements that will strengthen your rankings over the next few weeks',
  },
  fix_later: {
    label: 'Fix Later',
    icon: CalendarClock,
    color: 'text-blue-400',
    bg: 'bg-blue-500/10',
    border: 'border-blue-500/20',
    description: 'Lower-priority optimizations — good to address when you have capacity',
  },
  ongoing: {
    label: 'Continuously Improve',
    icon: RefreshCw,
    color: 'text-teal-400',
    bg: 'bg-teal-500/10',
    border: 'border-teal-500/20',
    description: 'Content opportunities and strategic improvements to work on over time',
  },
};

const TYPE_ICONS: Record<RecType, typeof FileText> = {
  metadata: FileText,
  schema: Code2,
  accessibility: Image,
  performance: Zap,
  technical: Wrench,
  content: PenTool,
  content_refresh: TrendingDown,
  strategy: Target,
  aeo: Sparkles,
};

const IMPACT_BADGE: Record<string, { label: string; color: string; bg: string }> = {
  high: { label: 'High Impact', color: 'text-red-400', bg: 'bg-red-500/10' },
  medium: { label: 'Medium Impact', color: 'text-amber-400', bg: 'bg-amber-500/10' },
  low: { label: 'Low Impact', color: 'text-blue-400', bg: 'bg-blue-500/10' },
};

const EFFORT_BADGE: Record<string, { label: string; color: string }> = {
  low: { label: 'Quick Fix', color: 'text-green-400' },
  medium: { label: 'Moderate Effort', color: 'text-amber-400' },
  high: { label: 'Significant Work', color: 'text-red-400' },
};

// ─── Component ────────────────────────────────────────────────────

export function InsightsEngine({ workspaceId, tier, compact, onNavigate }: InsightsEngineProps) {
  const cart = useCart();
  const [data, setData] = useState<RecommendationSet | null>(null);
  const [loading, setLoading] = useState(true);
  const [regenerating, setRegenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedPriorities, setExpandedPriorities] = useState<Set<RecPriority>>(new Set(['fix_now']));
  const [expandedRecs, setExpandedRecs] = useState<Set<string>>(new Set());

  const isPremium = tier === 'premium';

  // Fetch recommendations
  useEffect(() => {
    get<RecommendationSet>(`/api/public/recommendations/${workspaceId}`)
      .then(set => { setData(set); setLoading(false); })
      .catch(err => { setError(typeof err === 'string' ? err : 'Failed to load recommendations'); setLoading(false); });
  }, [workspaceId]);

  // Re-generate
  const handleRegenerate = async () => {
    setRegenerating(true);
    try {
      const set = await post<RecommendationSet>(`/api/public/recommendations/${workspaceId}/generate`);
      setData(set);
    } catch { setError('Failed to regenerate'); }
    setRegenerating(false);
  };

  // Update status
  const handleStatusUpdate = async (recId: string, status: RecStatus) => {
    try {
      await patch(`/api/public/recommendations/${workspaceId}/${recId}`, { status });
      setData(prev => {
        if (!prev) return prev;
        return {
          ...prev,
          recommendations: prev.recommendations.map(r =>
            r.id === recId ? { ...r, status, updatedAt: new Date().toISOString() } : r
          ),
        };
      });
    } catch (err) { console.error('InsightsEngine operation failed:', err); }
  };

  // Dismiss
  const handleDismiss = async (recId: string) => {
    try {
      await del(`/api/public/recommendations/${workspaceId}/${recId}`);
      setData(prev => {
        if (!prev) return prev;
        return {
          ...prev,
          recommendations: prev.recommendations.map(r =>
            r.id === recId ? { ...r, status: 'dismissed' as RecStatus } : r
          ),
        };
      });
    } catch (err) { console.error('InsightsEngine operation failed:', err); }
  };

  const togglePriority = (p: RecPriority) =>
    setExpandedPriorities(prev => { const n = new Set(prev); if (n.has(p)) n.delete(p); else n.add(p); return n; });

  const toggleRec = (id: string) =>
    setExpandedRecs(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  // Group recommendations by priority, excluding dismissed
  const grouped = useMemo(() => {
    if (!data) return new Map<RecPriority, Recommendation[]>();
    const map = new Map<RecPriority, Recommendation[]>();
    const priorities: RecPriority[] = ['fix_now', 'fix_soon', 'fix_later', 'ongoing'];
    for (const p of priorities) map.set(p, []);
    for (const rec of data.recommendations) {
      if (rec.status === 'dismissed') continue;
      map.get(rec.priority)?.push(rec);
    }
    return map;
  }, [data]);

  // Counts for summary badges
  const activeCount = data ? data.recommendations.filter(r => r.status !== 'dismissed' && r.status !== 'completed').length : 0;
  const completedCount = data ? data.recommendations.filter(r => r.status === 'completed').length : 0;

  if (loading) {
    return (
      <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-8 text-center">
        <Loader2 className="w-6 h-6 text-teal-400 animate-spin mx-auto mb-2" />
        <p className="text-xs text-zinc-500">Analyzing your site for recommendations...</p>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-6 text-center">
        <XCircle className="w-6 h-6 text-red-400 mx-auto mb-2" />
        <p className="text-xs text-zinc-400">{error}</p>
        <button onClick={handleRegenerate} className="mt-2 text-xs text-teal-400 hover:text-teal-300">
          Try again
        </button>
      </div>
    );
  }

  if (!data || data.recommendations.length === 0) {
    return (
      <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-8 text-center">
        <Shield className="w-8 h-8 text-teal-400 mx-auto mb-3" />
        <p className="text-sm font-medium text-zinc-300">No recommendations yet</p>
        <p className="text-xs text-zinc-500 mt-1">Run a site audit to generate prioritized recommendations.</p>
      </div>
    );
  }

  // Compact mode for overview tab — just show summary + top 3 fix-now items
  if (compact) {
    const fixNowRecs = grouped.get('fix_now') || [];
    const fixSoonRecs = grouped.get('fix_soon') || [];
    const topRecs = [...fixNowRecs, ...fixSoonRecs].slice(0, 4);

    return (
      <div className="bg-zinc-900 rounded-xl border border-zinc-800 overflow-hidden">
        <div className="px-5 py-4 border-b border-zinc-800">
          <div className="flex items-center gap-2">
            <Lightbulb className="w-4 h-4 text-amber-400" />
            <span className="text-sm font-semibold text-zinc-200">Action Plan</span>
            <span className="text-[11px] text-zinc-500 ml-auto">{activeCount} active · {completedCount} completed</span>
          </div>
          {data.summary.trafficAtRisk > 0 && (
            <p className="text-[12px] text-zinc-400 mt-1">
              <span className="text-amber-400 font-medium">{num(data.summary.trafficAtRisk)} organic clicks/mo</span> are at risk from unresolved issues
              {data.summary.estimatedRecoverableClicks > 0 && (
                <span className="ml-1 text-teal-400">· ~{num(data.summary.estimatedRecoverableClicks)} recoverable</span>
              )}
            </p>
          )}
        </div>

        {/* Priority summary pills */}
        <div className="px-5 py-3 flex gap-2 border-b border-zinc-800/50">
          {(['fix_now', 'fix_soon', 'fix_later', 'ongoing'] as RecPriority[]).map(p => {
            const config = PRIORITY_CONFIG[p];
            const count = (grouped.get(p) || []).filter(r => r.status === 'pending').length;
            if (count === 0) return null;
            const Icon = config.icon;
            return (
              <div key={p} className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium ${config.bg} border ${config.border} ${config.color}`}>
                <Icon className="w-3 h-3" />
                {count} {config.label}
              </div>
            );
          })}
        </div>

        {/* Top recommendations */}
        <div className="divide-y divide-zinc-800/50">
          {topRecs.map(rec => {
            const pConfig = PRIORITY_CONFIG[rec.priority];
            const TypeIcon = TYPE_ICONS[rec.type] || Wrench;
            return (
              <div key={rec.id} className="px-5 py-3 flex items-start gap-3">
                <div className={`w-7 h-7 rounded-lg ${pConfig.bg} border ${pConfig.border} flex items-center justify-center flex-shrink-0 mt-0.5`}>
                  <TypeIcon className={`w-3.5 h-3.5 ${pConfig.color}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[12px] font-medium text-zinc-300 truncate">{rec.title}</div>
                  <div className="text-[11px] text-zinc-500 mt-0.5 line-clamp-1">{rec.insight}</div>
                  {rec.affectedPages.length > 0 && (
                    <div className="flex flex-wrap items-center gap-1 mt-1.5">
                      {rec.affectedPages.slice(0, 3).map((slug, i) => (
                        <span key={i} className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 border border-zinc-700/50 truncate max-w-[180px]">
                          /{slug}
                        </span>
                      ))}
                      {rec.affectedPages.length > 3 && (
                        <span className="text-[10px] text-zinc-600">+{rec.affectedPages.length - 3} more</span>
                      )}
                    </div>
                  )}
                </div>
                {rec.trafficAtRisk > 0 && (
                  <span className="text-[10px] text-teal-400 flex-shrink-0 flex items-center gap-0.5">
                    <MousePointerClick className="w-3 h-3" />
                    {num(rec.trafficAtRisk)}
                  </span>
                )}
                {onNavigate && (
                  <button
                    onClick={() => onNavigate(REC_TYPE_TAB[rec.type] || 'seo-audit', { pageSlug: rec.affectedPages[0], recType: rec.type })}
                    className="flex items-center gap-0.5 text-[10px] text-teal-400 hover:text-teal-300 transition-colors flex-shrink-0"
                  >
                    Fix <ArrowUpRight className="w-3 h-3" />
                  </button>
                )}
              </div>
            );
          })}
        </div>

        {activeCount > topRecs.length && (
          <div className="px-5 py-2.5 border-t border-zinc-800 text-center">
            <span className="text-[11px] text-zinc-500">
              + {activeCount - topRecs.length} more recommendations — view in Site Health
            </span>
          </div>
        )}
      </div>
    );
  }

  // ── Full Mode ──────────────────────────────────────────────────

  return (
    <div className="bg-zinc-900 rounded-xl border border-zinc-800 overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4 border-b border-zinc-800">
        <div className="flex items-center gap-2">
          <Lightbulb className="w-4 h-4 text-amber-400" />
          <span className="text-sm font-semibold text-zinc-200">Prioritized Action Plan</span>
          <div className="ml-auto flex items-center gap-2">
            <span className="text-[11px] text-zinc-500">{activeCount} active · {completedCount} done</span>
            <button
              onClick={handleRegenerate}
              disabled={regenerating}
              className="flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] text-zinc-400 hover:text-zinc-200 bg-zinc-800 hover:bg-zinc-700 transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`w-3 h-3 ${regenerating ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          </div>
        </div>
        {isPremium ? (
          <p className="text-[12px] text-zinc-400 mt-1.5 leading-relaxed">
            <Crown className="w-3 h-3 text-amber-400 inline mr-1" />
            {STUDIO_NAME} is actively working through these recommendations. Items are prioritized by traffic impact.
          </p>
        ) : (
          <p className="text-[12px] text-zinc-400 mt-1.5 leading-relaxed">
            We've analyzed your audit, traffic, and SEO strategy to create a prioritized action plan.
            {data.summary.trafficAtRisk > 0 && (
              <> <span className="text-amber-400 font-medium">{num(data.summary.trafficAtRisk)} organic clicks/mo</span> are at risk from unresolved issues{data.summary.estimatedRecoverableClicks > 0 ? ` — addressing fix-now and fix-soon items could recover ~${num(data.summary.estimatedRecoverableClicks)} clicks/mo.` : '.'}</>
            )}
          </p>
        )}
      </div>

      {/* Priority sections */}
      <div className="divide-y divide-zinc-800/50">
        {(['fix_now', 'fix_soon', 'fix_later', 'ongoing'] as RecPriority[]).map(priority => {
          const config = PRIORITY_CONFIG[priority];
          const recs = grouped.get(priority) || [];
          if (recs.length === 0) return null;

          const isExpanded = expandedPriorities.has(priority);
          const Icon = config.icon;
          const pendingCount = recs.filter(r => r.status === 'pending').length;
          const inProgressCount = recs.filter(r => r.status === 'in_progress').length;
          const completedInGroup = recs.filter(r => r.status === 'completed').length;

          return (
            <div key={priority}>
              {/* Priority header */}
              <button
                onClick={() => togglePriority(priority)}
                className="w-full px-5 py-3.5 flex items-center gap-3 hover:bg-zinc-800/30 transition-colors text-left"
              >
                <div className={`w-8 h-8 rounded-lg ${config.bg} border ${config.border} flex items-center justify-center flex-shrink-0`}>
                  <Icon className={`w-4 h-4 ${config.color}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={`text-sm font-semibold ${config.color}`}>{config.label}</span>
                    <span className="text-[11px] text-zinc-500">
                      {pendingCount > 0 && `${pendingCount} pending`}
                      {inProgressCount > 0 && `${pendingCount > 0 ? ' · ' : ''}${inProgressCount} in progress`}
                      {completedInGroup > 0 && `${pendingCount + inProgressCount > 0 ? ' · ' : ''}${completedInGroup} done`}
                    </span>
                  </div>
                  <p className="text-[11px] text-zinc-500 mt-0.5">{config.description}</p>
                </div>
                {isExpanded
                  ? <ChevronDown className="w-4 h-4 text-zinc-500 flex-shrink-0" />
                  : <ChevronRight className="w-4 h-4 text-zinc-500 flex-shrink-0" />
                }
              </button>

              {/* Recommendations in this priority */}
              {isExpanded && (
                <div className="border-t border-zinc-800/30">
                  {recs.map(rec => {
                    const TypeIcon = TYPE_ICONS[rec.type] || Wrench;
                    const impactBadge = IMPACT_BADGE[rec.impact];
                    const effortBadge = EFFORT_BADGE[rec.effort];
                    const isRecExpanded = expandedRecs.has(rec.id);
                    const isCompleted = rec.status === 'completed';
                    const inCart = rec.productType && cart?.items.some(i => i.productType === rec.productType);

                    return (
                      <div key={rec.id} className={`border-b border-zinc-800/20 last:border-b-0 ${isCompleted ? 'opacity-50' : ''}`}>
                        {/* Recommendation row */}
                        <div className="px-5 py-3 flex items-start gap-3">
                          <button
                            onClick={() => toggleRec(rec.id)}
                            className="w-6 h-6 rounded-md bg-zinc-800 flex items-center justify-center flex-shrink-0 mt-0.5 hover:bg-zinc-700 transition-colors"
                          >
                            {isRecExpanded
                              ? <ChevronDown className="w-3 h-3 text-zinc-400" />
                              : <ChevronRight className="w-3 h-3 text-zinc-400" />
                            }
                          </button>

                          <div className="w-7 h-7 rounded-lg bg-zinc-800 flex items-center justify-center flex-shrink-0 mt-0.5">
                            <TypeIcon className="w-3.5 h-3.5 text-zinc-400" />
                          </div>

                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className={`text-[12px] font-medium ${isCompleted ? 'text-zinc-500 line-through' : 'text-zinc-200'}`}>
                                {rec.title}
                              </span>
                              <span className={`text-[10px] px-1.5 py-0.5 rounded ${impactBadge.bg} ${impactBadge.color}`}>
                                {impactBadge.label}
                              </span>
                              <span className={`text-[10px] ${effortBadge.color}`}>
                                {effortBadge.label}
                              </span>
                              {rec.status === 'in_progress' && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-teal-500/10 border border-teal-500/20 text-teal-400">
                                  In Progress
                                </span>
                              )}
                              {isCompleted && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-500/10 border border-green-500/20 text-green-400 flex items-center gap-0.5">
                                  <CheckCircle2 className="w-3 h-3" /> Done
                                </span>
                              )}
                            </div>

                            {/* Insight preview (always visible) */}
                            {!isRecExpanded && (
                              <p className="text-[11px] text-zinc-500 mt-0.5 line-clamp-1">{rec.insight}</p>
                            )}
                          </div>

                          {/* Traffic badge */}
                          {rec.trafficAtRisk > 0 && (
                            <div className="flex items-center gap-1 text-[10px] text-teal-400 flex-shrink-0">
                              <MousePointerClick className="w-3 h-3" />
                              {num(rec.trafficAtRisk)} clicks
                            </div>
                          )}
                        </div>

                        {/* Expanded detail */}
                        {isRecExpanded && (
                          <div className="px-5 pb-4 pl-[4.5rem]">
                            {/* Insight */}
                            <div className="flex items-start gap-1.5 mb-3">
                              <Lightbulb className="w-3 h-3 text-amber-400 flex-shrink-0 mt-0.5" />
                              <p className="text-[12px] text-zinc-400 leading-relaxed">{rec.insight}</p>
                            </div>

                            {/* Affected pages */}
                            {rec.affectedPages.length > 0 && (
                              <div className="mb-3">
                                <div className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1.5">Affected Pages</div>
                                <div className="flex flex-wrap gap-1.5">
                                  {rec.affectedPages.slice(0, 8).map((slug, i) => (
                                    <span key={i} className="text-[11px] px-2 py-0.5 rounded bg-zinc-800 text-zinc-400 border border-zinc-700">
                                      /{slug}
                                    </span>
                                  ))}
                                  {rec.affectedPages.length > 8 && (
                                    <span className="text-[11px] text-zinc-500">
                                      + {rec.affectedPages.length - 8} more
                                    </span>
                                  )}
                                </div>
                              </div>
                            )}

                            {/* Traffic metrics */}
                            {(rec.trafficAtRisk > 0 || rec.impressionsAtRisk > 0) && (
                              <div className="flex gap-4 mb-3">
                                {rec.trafficAtRisk > 0 && (
                                  <div className="flex items-center gap-1.5 text-[11px]">
                                    <MousePointerClick className="w-3 h-3 text-teal-400" />
                                    <span className="text-zinc-400">{num(rec.trafficAtRisk)} clicks/mo at risk</span>
                                  </div>
                                )}
                                {rec.impressionsAtRisk > 0 && (
                                  <div className="flex items-center gap-1.5 text-[11px]">
                                    <Eye className="w-3 h-3 text-zinc-500" />
                                    <span className="text-zinc-500">{num(rec.impressionsAtRisk)} impressions</span>
                                  </div>
                                )}
                              </div>
                            )}

                            {/* Estimated gain */}
                            <div className="flex items-center gap-1.5 mb-3">
                              <TrendingUp className="w-3 h-3 text-green-400" />
                              <span className="text-[11px] text-green-400">{rec.estimatedGain}</span>
                            </div>

                            {/* Action buttons */}
                            <div className="flex items-center gap-2 flex-wrap">
                              {/* Premium: team handles it */}
                              {isPremium ? (
                                <>
                                  {rec.status === 'pending' && (
                                    <button
                                      onClick={() => handleStatusUpdate(rec.id, 'in_progress')}
                                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium bg-teal-600 hover:bg-teal-500 text-white transition-colors"
                                    >
                                      <ArrowUpRight className="w-3 h-3" />
                                      Start Working On This
                                    </button>
                                  )}
                                  {rec.status === 'in_progress' && (
                                    <button
                                      onClick={() => handleStatusUpdate(rec.id, 'completed')}
                                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium bg-green-600 hover:bg-green-500 text-white transition-colors"
                                    >
                                      <CheckCircle2 className="w-3 h-3" />
                                      Mark Complete
                                    </button>
                                  )}
                                </>
                              ) : (
                                <>
                                  {/* Growth/Free: purchase CTA or action guidance */}
                                  {rec.productType && rec.productPrice && !inCart ? (
                                    <button
                                      onClick={() => cart?.addItem({
                                        productType: rec.productType as ProductType,
                                        displayName: rec.title,
                                        priceUsd: rec.productPrice!,
                                        quantity: 1,
                                      })}
                                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium bg-teal-600 hover:bg-teal-500 text-white transition-colors"
                                    >
                                      <ShoppingCart className="w-3 h-3" />
                                      Let Us Fix This — {fmt(rec.productPrice)}
                                    </button>
                                  ) : inCart ? (
                                    <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium bg-teal-500/10 text-teal-400 border border-teal-500/20">
                                      <ShoppingCart className="w-3 h-3" />
                                      In Cart
                                    </span>
                                  ) : rec.status === 'pending' ? (
                                    <button
                                      onClick={() => handleStatusUpdate(rec.id, 'in_progress')}
                                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium bg-zinc-700 hover:bg-zinc-600 text-zinc-200 transition-colors"
                                    >
                                      <ArrowUpRight className="w-3 h-3" />
                                      I'll Handle This
                                    </button>
                                  ) : rec.status === 'in_progress' ? (
                                    <button
                                      onClick={() => handleStatusUpdate(rec.id, 'completed')}
                                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium bg-green-600 hover:bg-green-500 text-white transition-colors"
                                    >
                                      <CheckCircle2 className="w-3 h-3" />
                                      Mark Done
                                    </button>
                                  ) : null}

                                  {/* Premium upsell for high-value items */}
                                  {rec.impact === 'high' && !isPremium && (
                                    <span className="flex items-center gap-1 text-[10px] text-amber-400/70">
                                      <Crown className="w-3 h-3" />
                                      Premium handles this for you
                                    </span>
                                  )}
                                </>
                              )}

                              {/* Dismiss */}
                              {rec.status !== 'completed' && (
                                <button
                                  onClick={() => handleDismiss(rec.id)}
                                  className="text-[11px] text-zinc-600 hover:text-zinc-400 transition-colors ml-auto"
                                >
                                  Dismiss
                                </button>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Footer with Premium upsell */}
      {!isPremium && data.summary.fixNow + data.summary.fixSoon > 3 && (
        <div className="px-5 py-3.5 border-t border-zinc-800 bg-gradient-to-r from-amber-500/5 to-teal-500/5">
          <div className="flex items-center gap-3">
            <Crown className="w-5 h-5 text-amber-400 flex-shrink-0" />
            <div className="flex-1">
              <div className="text-[12px] font-medium text-zinc-300">
                Want {STUDIO_NAME} to handle all {data.summary.fixNow + data.summary.fixSoon} urgent items?
              </div>
              <div className="text-[11px] text-zinc-500 mt-0.5">
                Premium clients get hands-free SEO — we implement every recommendation for you.
              </div>
            </div>
            <span className="text-[11px] text-amber-400 font-medium flex-shrink-0">$999/mo</span>
          </div>
        </div>
      )}

      {/* Generated timestamp */}
      <div className="px-5 py-2 border-t border-zinc-800/50 text-center">
        <span className="text-[10px] text-zinc-600">
          Generated {new Date(data.generatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
          {' · '}{data.recommendations.length} recommendations from audit + strategy analysis
        </span>
      </div>
    </div>
  );
}
