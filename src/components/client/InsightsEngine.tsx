import { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
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
import { queryKeys } from '../../lib/queryKeys';
import { Icon } from '../ui/Icon';

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
  low: { label: 'Quick Fix', color: 'text-emerald-400' },
  medium: { label: 'Moderate Effort', color: 'text-amber-400' },
  high: { label: 'Significant Work', color: 'text-red-400' },
};

// ─── Component ────────────────────────────────────────────────────

export function InsightsEngine({ workspaceId, tier, compact, onNavigate }: InsightsEngineProps) {
  const cart = useCart();
  const qc = useQueryClient();
  const [regenerating, setRegenerating] = useState(false);
  const [expandedPriorities, setExpandedPriorities] = useState<Set<RecPriority>>(new Set(['fix_now']));
  const [expandedRecs, setExpandedRecs] = useState<Set<string>>(new Set());

  const isPremium = tier === 'premium';

  // queryFn returns RecommendationSet — same shape cached by useRecommendations,
  // which uses select to project to Recommendation[]. Both must cache the same type.
  // Uses get() (throws on non-200) so HTTP errors surface via isError, not silent null.
  const { data, isLoading, isError } = useQuery<RecommendationSet>({
    queryKey: queryKeys.shared.recommendations(workspaceId),
    queryFn: (): Promise<RecommendationSet> =>
      get<RecommendationSet>(`/api/public/recommendations/${workspaceId}`),
    staleTime: 60_000,
  });

  // Re-generate
  const handleRegenerate = async () => {
    setRegenerating(true);
    try {
      const set = await post<RecommendationSet>(`/api/public/recommendations/${workspaceId}/generate`);
      qc.setQueryData(queryKeys.shared.recommendations(workspaceId), set);
    } catch { /* silently fail — button stops spinning; user can retry */ }
    setRegenerating(false);
  };

  // Update status (on success)
  const handleStatusUpdate = async (recId: string, status: RecStatus) => {
    try {
      await patch(`/api/public/recommendations/${workspaceId}/${recId}`, { status });
      qc.setQueryData<RecommendationSet | undefined>(queryKeys.shared.recommendations(workspaceId), prev => {
        if (!prev) return prev;
        return { ...prev, recommendations: prev.recommendations.map(r => r.id === recId ? { ...r, status, updatedAt: new Date().toISOString() } : r) };
      });
    } catch (err) { console.error('InsightsEngine operation failed:', err); }
  };

  // Dismiss (on success)
  const handleDismiss = async (recId: string) => {
    try {
      await del(`/api/public/recommendations/${workspaceId}/${recId}`);
      qc.setQueryData<RecommendationSet | undefined>(queryKeys.shared.recommendations(workspaceId), prev => {
        if (!prev) return prev;
        return { ...prev, recommendations: prev.recommendations.map(r => r.id === recId ? { ...r, status: 'dismissed' as RecStatus } : r) };
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

  if (isLoading) {
    return (
      // pr-check-disable-next-line -- InsightsEngine loading state is a top-level client container intentionally using brand signature shape
      <div className="bg-[var(--surface-2)] border border-[var(--brand-border)] p-8 text-center" style={{ borderRadius: 'var(--radius-signature-lg)' }}>
        <Icon as={Loader2} size="xl" className="text-teal-400 animate-spin mx-auto mb-2" />
        <p className="t-caption text-[var(--brand-text-muted)]">Analyzing your site for recommendations...</p>
      </div>
    );
  }

  if (isError && !data) {
    return (
      // pr-check-disable-next-line -- InsightsEngine error state is a top-level client container intentionally using brand signature shape
      <div className="bg-[var(--surface-2)] border border-[var(--brand-border)] p-6 text-center" style={{ borderRadius: 'var(--radius-signature-lg)' }}>
        <Icon as={XCircle} size="xl" className="text-red-400 mx-auto mb-2" />
        <p className="t-caption text-[var(--brand-text)]">Failed to load recommendations</p>
        <button onClick={handleRegenerate} className="mt-2 t-caption text-teal-400 hover:text-teal-300">
          Try again
        </button>
      </div>
    );
  }

  if (!data || data.recommendations.length === 0) {
    return (
      // pr-check-disable-next-line -- InsightsEngine empty state is a top-level client container intentionally using brand signature shape
      <div className="bg-[var(--surface-2)] border border-[var(--brand-border)] p-8 text-center" style={{ borderRadius: 'var(--radius-signature-lg)' }}>
        <Icon as={Shield} size="2xl" className="text-teal-400 mx-auto mb-3" />
        <p className="t-body font-medium text-[var(--brand-text-bright)]">No recommendations yet</p>
        <p className="t-caption text-[var(--brand-text-muted)] mt-1">Run a site audit to generate prioritized recommendations.</p>
      </div>
    );
  }

  // Compact mode for overview tab — just show summary + top 3 fix-now items
  if (compact) {
    const fixNowRecs = grouped.get('fix_now') || [];
    const fixSoonRecs = grouped.get('fix_soon') || [];
    const topRecs = [...fixNowRecs, ...fixSoonRecs].slice(0, 4);

    return (
      // pr-check-disable-next-line -- InsightsEngine compact view is a top-level client container intentionally using brand signature shape
      <div className="bg-[var(--surface-2)] border border-[var(--brand-border)] overflow-hidden" style={{ borderRadius: 'var(--radius-signature-lg)' }}>
        <div className="px-5 py-4 border-b border-[var(--brand-border)]">
          <div className="flex items-center gap-2">
            <Icon as={Lightbulb} size="md" className="text-amber-400" />
            <span className="t-body font-semibold text-[var(--brand-text-bright)]">Action Plan</span>
            <span className="t-caption text-[var(--brand-text-muted)] ml-auto">{activeCount} active · {completedCount} completed</span>
          </div>
          {data.summary.trafficAtRisk > 0 && (
            <p className="t-caption text-[var(--brand-text)] mt-1">
              <span className="text-amber-400 font-medium">{num(data.summary.trafficAtRisk)} organic clicks/mo</span> are at risk from unresolved issues
              {data.summary.estimatedRecoverableClicks > 0 && (
                <span className="ml-1 text-teal-400">· ~{num(data.summary.estimatedRecoverableClicks)} recoverable</span>
              )}
            </p>
          )}
        </div>

        {/* Priority summary pills */}
        <div className="px-5 py-3 flex gap-2 border-b border-[var(--brand-border)]/50">
          {(['fix_now', 'fix_soon', 'fix_later', 'ongoing'] as RecPriority[]).map(p => {
            const config = PRIORITY_CONFIG[p];
            const count = (grouped.get(p) || []).filter(r => r.status === 'pending').length;
            if (count === 0) return null;
            const PriorityIcon = config.icon;
            return (
              <div key={p} className={`flex items-center gap-1.5 px-2.5 py-1 rounded-[var(--radius-md)] t-caption-sm font-medium ${config.bg} border ${config.border} ${config.color}`}>
                <Icon as={PriorityIcon} size="sm" />
                {count} {config.label}
              </div>
            );
          })}
        </div>

        {/* Top recommendations */}
        <div className="divide-y divide-[var(--brand-border)]/50">
          {topRecs.map(rec => {
            const pConfig = PRIORITY_CONFIG[rec.priority];
            const TypeIcon = TYPE_ICONS[rec.type] || Wrench;
            return (
              <div key={rec.id} className="px-5 py-3 flex items-start gap-3">
                <div className={`w-7 h-7 rounded-[var(--radius-md)] ${pConfig.bg} border ${pConfig.border} flex items-center justify-center flex-shrink-0 mt-0.5`}>
                  <Icon as={TypeIcon} size="md" className={pConfig.color} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="t-caption font-medium text-[var(--brand-text-bright)] truncate">{rec.title}</div>
                  <div className="t-caption-sm text-[var(--brand-text-muted)] mt-0.5 line-clamp-1">{rec.insight}</div>
                  {rec.affectedPages.length > 0 && (
                    <div className="flex flex-wrap items-center gap-1 mt-1.5">
                      {rec.affectedPages.slice(0, 3).map((slug, i) => (
                        <span key={i} className="t-caption-sm px-1.5 py-0.5 rounded bg-[var(--surface-3)] text-[var(--brand-text)] border border-[var(--brand-border)] truncate max-w-[180px]">
                          /{slug}
                        </span>
                      ))}
                      {rec.affectedPages.length > 3 && (
                        <span className="t-caption-sm text-[var(--brand-text-dim)]">+{rec.affectedPages.length - 3} more</span>
                      )}
                    </div>
                  )}
                </div>
                {rec.trafficAtRisk > 0 && (
                  <span className="t-caption-sm text-teal-400 flex-shrink-0 flex items-center gap-0.5">
                    <Icon as={MousePointerClick} size="sm" />
                    {num(rec.trafficAtRisk)}
                  </span>
                )}
                {onNavigate && (
                  <button
                    onClick={() => onNavigate(REC_TYPE_TAB[rec.type] || 'seo-audit', { pageSlug: rec.affectedPages[0], recType: rec.type })}
                    className="flex items-center gap-0.5 t-caption-sm text-teal-400 hover:text-teal-300 transition-colors flex-shrink-0"
                  >
                    Fix <Icon as={ArrowUpRight} size="sm" />
                  </button>
                )}
              </div>
            );
          })}
        </div>

        {activeCount > topRecs.length && (
          <div className="px-5 py-2.5 border-t border-[var(--brand-border)] text-center">
            <span className="t-caption text-[var(--brand-text-muted)]">
              + {activeCount - topRecs.length} more recommendations — view in Site Health
            </span>
          </div>
        )}
      </div>
    );
  }

  // ── Full Mode ──────────────────────────────────────────────────

  return (
    // pr-check-disable-next-line -- InsightsEngine full view is a top-level client container intentionally using brand signature shape
    <div className="bg-[var(--surface-2)] border border-[var(--brand-border)] overflow-hidden" style={{ borderRadius: 'var(--radius-signature-lg)' }}>
      {/* Header */}
      <div className="px-5 py-4 border-b border-[var(--brand-border)]">
        <div className="flex items-center gap-2">
          <Icon as={Lightbulb} size="md" className="text-amber-400" />
          <span className="t-body font-semibold text-[var(--brand-text-bright)]">Prioritized Action Plan</span>
          <div className="ml-auto flex items-center gap-2">
            <span className="t-caption text-[var(--brand-text-muted)]">{activeCount} active · {completedCount} done</span>
            <button
              onClick={handleRegenerate}
              disabled={regenerating}
              className="flex items-center gap-1 px-2 py-1 rounded-[var(--radius-md)] t-caption text-[var(--brand-text)] hover:text-[var(--brand-text-bright)] bg-[var(--surface-3)] hover:bg-[var(--brand-border-hover)] transition-colors disabled:opacity-50"
            >
              <Icon as={RefreshCw} size="sm" className={regenerating ? 'animate-spin' : ''} />
              Refresh
            </button>
          </div>
        </div>
        {isPremium ? (
          <p className="t-caption text-[var(--brand-text)] mt-1.5 leading-relaxed">
            <Icon as={Crown} size="sm" className="text-amber-400 inline mr-1" />
            {STUDIO_NAME} is actively working through these recommendations. Items are prioritized by traffic impact.
          </p>
        ) : (
          <p className="t-caption text-[var(--brand-text)] mt-1.5 leading-relaxed">
            We've analyzed your audit, traffic, and SEO strategy to create a prioritized action plan.
            {data.summary.trafficAtRisk > 0 && (
              <> <span className="text-amber-400 font-medium">{num(data.summary.trafficAtRisk)} organic clicks/mo</span> are at risk from unresolved issues{data.summary.estimatedRecoverableClicks > 0 ? ` — addressing fix-now and fix-soon items could recover ~${num(data.summary.estimatedRecoverableClicks)} clicks/mo.` : '.'}</>
            )}
          </p>
        )}
      </div>

      {/* Priority sections */}
      <div className="divide-y divide-[var(--brand-border)]/50">
        {(['fix_now', 'fix_soon', 'fix_later', 'ongoing'] as RecPriority[]).map(priority => {
          const config = PRIORITY_CONFIG[priority];
          const recs = grouped.get(priority) || [];
          if (recs.length === 0) return null;

          const isExpanded = expandedPriorities.has(priority);
          const PriorityIcon = config.icon;
          const pendingCount = recs.filter(r => r.status === 'pending').length;
          const inProgressCount = recs.filter(r => r.status === 'in_progress').length;
          const completedInGroup = recs.filter(r => r.status === 'completed').length;

          return (
            <div key={priority}>
              {/* Priority header */}
              <button
                onClick={() => togglePriority(priority)}
                className="w-full px-5 py-3.5 flex items-center gap-3 hover:bg-[var(--surface-3)]/30 transition-colors text-left"
              >
                <div className={`w-8 h-8 rounded-[var(--radius-md)] ${config.bg} border ${config.border} flex items-center justify-center flex-shrink-0`}>
                  <Icon as={PriorityIcon} size="md" className={config.color} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={`t-body font-semibold ${config.color}`}>{config.label}</span>
                    <span className="t-caption text-[var(--brand-text-muted)]">
                      {pendingCount > 0 && `${pendingCount} pending`}
                      {inProgressCount > 0 && `${pendingCount > 0 ? ' · ' : ''}${inProgressCount} in progress`}
                      {completedInGroup > 0 && `${pendingCount + inProgressCount > 0 ? ' · ' : ''}${completedInGroup} done`}
                    </span>
                  </div>
                  <p className="t-caption-sm text-[var(--brand-text-muted)] mt-0.5">{config.description}</p>
                </div>
                {isExpanded
                  ? <Icon as={ChevronDown} size="md" className="text-[var(--brand-text-muted)] flex-shrink-0" />
                  : <Icon as={ChevronRight} size="md" className="text-[var(--brand-text-muted)] flex-shrink-0" />
                }
              </button>

              {/* Recommendations in this priority */}
              {isExpanded && (
                <div className="border-t border-[var(--brand-border)]/30">
                  {recs.map(rec => {
                    const TypeIcon = TYPE_ICONS[rec.type] || Wrench;
                    const impactBadge = IMPACT_BADGE[rec.impact];
                    const effortBadge = EFFORT_BADGE[rec.effort];
                    const isRecExpanded = expandedRecs.has(rec.id);
                    const isCompleted = rec.status === 'completed';
                    const inCart = rec.productType && cart?.items.some(i => i.productType === rec.productType);

                    return (
                      <div key={rec.id} className={`border-b border-[var(--brand-border)]/20 last:border-b-0 ${isCompleted ? 'opacity-50' : ''}`}>
                        {/* Recommendation row */}
                        <div className="px-5 py-3 flex items-start gap-3">
                          <button
                            onClick={() => toggleRec(rec.id)}
                            className="w-6 h-6 rounded-[var(--radius-sm)] bg-[var(--surface-3)] flex items-center justify-center flex-shrink-0 mt-0.5 hover:bg-[var(--brand-border-hover)] transition-colors"
                          >
                            {isRecExpanded
                              ? <Icon as={ChevronDown} size="sm" className="text-[var(--brand-text)]" />
                              : <Icon as={ChevronRight} size="sm" className="text-[var(--brand-text)]" />
                            }
                          </button>

                          <div className="w-7 h-7 rounded-[var(--radius-md)] bg-[var(--surface-3)] flex items-center justify-center flex-shrink-0 mt-0.5">
                            <Icon as={TypeIcon} size="md" className="text-[var(--brand-text)]" />
                          </div>

                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className={`t-caption font-medium ${isCompleted ? 'text-[var(--brand-text-muted)] line-through' : 'text-[var(--brand-text-bright)]'}`}>
                                {rec.title}
                              </span>
                              <span className={`t-caption-sm px-1.5 py-0.5 rounded ${impactBadge.bg} ${impactBadge.color}`}>
                                {impactBadge.label}
                              </span>
                              <span className={`t-caption-sm ${effortBadge.color}`}>
                                {effortBadge.label}
                              </span>
                              {rec.status === 'in_progress' && (
                                <span className="t-caption-sm px-1.5 py-0.5 rounded bg-teal-500/10 border border-teal-500/20 text-teal-400">
                                  In Progress
                                </span>
                              )}
                              {isCompleted && (
                                <span className="t-caption-sm px-1.5 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 flex items-center gap-0.5">
                                  <Icon as={CheckCircle2} size="sm" /> Done
                                </span>
                              )}
                            </div>

                            {/* Insight preview (always visible) */}
                            {!isRecExpanded && (
                              <p className="t-caption-sm text-[var(--brand-text-muted)] mt-0.5 line-clamp-1">{rec.insight}</p>
                            )}
                          </div>

                          {/* Traffic badge */}
                          {rec.trafficAtRisk > 0 && (
                            <div className="flex items-center gap-1 t-caption-sm text-teal-400 flex-shrink-0">
                              <Icon as={MousePointerClick} size="sm" />
                              {num(rec.trafficAtRisk)} clicks
                            </div>
                          )}
                        </div>

                        {/* Expanded detail */}
                        {isRecExpanded && (
                          <div className="px-5 pb-4 pl-[4.5rem]">
                            {/* Insight */}
                            <div className="flex items-start gap-1.5 mb-3">
                              <Icon as={Lightbulb} size="sm" className="text-amber-400 flex-shrink-0 mt-0.5" />
                              <p className="t-caption text-[var(--brand-text)] leading-relaxed">{rec.insight}</p>
                            </div>

                            {/* Affected pages */}
                            {rec.affectedPages.length > 0 && (
                              <div className="mb-3">
                                <div className="t-caption-sm text-[var(--brand-text-muted)] tracking-wider mb-1.5">Affected Pages</div>
                                <div className="flex flex-wrap gap-1.5">
                                  {rec.affectedPages.slice(0, 8).map((slug, i) => (
                                    <span key={i} className="t-caption px-2 py-0.5 rounded bg-[var(--surface-3)] text-[var(--brand-text)] border border-[var(--brand-border)]">
                                      /{slug}
                                    </span>
                                  ))}
                                  {rec.affectedPages.length > 8 && (
                                    <span className="t-caption text-[var(--brand-text-muted)]">
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
                                  <div className="flex items-center gap-1.5 t-caption">
                                    <Icon as={MousePointerClick} size="sm" className="text-teal-400" />
                                    <span className="text-[var(--brand-text)]">{num(rec.trafficAtRisk)} clicks/mo at risk</span>
                                  </div>
                                )}
                                {rec.impressionsAtRisk > 0 && (
                                  <div className="flex items-center gap-1.5 t-caption">
                                    <Icon as={Eye} size="sm" className="text-[var(--brand-text-muted)]" />
                                    <span className="text-[var(--brand-text-muted)]">{num(rec.impressionsAtRisk)} impressions</span>
                                  </div>
                                )}
                              </div>
                            )}

                            {/* Estimated gain */}
                            <div className="flex items-center gap-1.5 mb-3">
                              <Icon as={TrendingUp} size="sm" className="text-emerald-400" />
                              <span className="t-caption text-emerald-400">{rec.estimatedGain}</span>
                            </div>

                            {/* Action buttons */}
                            <div className="flex items-center gap-2 flex-wrap">
                              {/* Premium: team handles it */}
                              {isPremium ? (
                                <>
                                  {rec.status === 'pending' && (
                                    <button
                                      onClick={() => handleStatusUpdate(rec.id, 'in_progress')}
                                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--radius-md)] t-caption font-medium bg-teal-600 hover:bg-teal-500 text-white transition-colors"
                                    >
                                      <Icon as={ArrowUpRight} size="sm" />
                                      Start Working On This
                                    </button>
                                  )}
                                  {rec.status === 'in_progress' && (
                                    <button
                                      onClick={() => handleStatusUpdate(rec.id, 'completed')}
                                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--radius-md)] t-caption font-medium bg-emerald-600 hover:bg-emerald-500 text-white transition-colors"
                                    >
                                      <Icon as={CheckCircle2} size="sm" />
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
                                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--radius-md)] t-caption font-medium bg-teal-600 hover:bg-teal-500 text-white transition-colors"
                                    >
                                      <Icon as={ShoppingCart} size="sm" />
                                      Let Us Fix This — {fmt(rec.productPrice)}
                                    </button>
                                  ) : inCart ? (
                                    <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--radius-md)] t-caption font-medium bg-teal-500/10 text-teal-400 border border-teal-500/20">
                                      <Icon as={ShoppingCart} size="sm" />
                                      In Cart
                                    </span>
                                  ) : rec.status === 'pending' ? (
                                    <button
                                      onClick={() => handleStatusUpdate(rec.id, 'in_progress')}
                                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--radius-md)] t-caption font-medium bg-[var(--surface-3)] hover:bg-[var(--brand-border-hover)] text-[var(--brand-text-bright)] transition-colors"
                                    >
                                      <Icon as={ArrowUpRight} size="sm" />
                                      I'll Handle This
                                    </button>
                                  ) : rec.status === 'in_progress' ? (
                                    <button
                                      onClick={() => handleStatusUpdate(rec.id, 'completed')}
                                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--radius-md)] t-caption font-medium bg-emerald-600 hover:bg-emerald-500 text-white transition-colors"
                                    >
                                      <Icon as={CheckCircle2} size="sm" />
                                      Mark Done
                                    </button>
                                  ) : null}

                                  {/* Premium upsell for high-value items */}
                                  {rec.impact === 'high' && !isPremium && (
                                    <span className="flex items-center gap-1 t-caption-sm text-amber-400/70">
                                      <Icon as={Crown} size="sm" />
                                      Premium handles this for you
                                    </span>
                                  )}
                                </>
                              )}

                              {/* Dismiss */}
                              {rec.status !== 'completed' && (
                                <button
                                  onClick={() => handleDismiss(rec.id)}
                                  className="t-caption text-[var(--brand-text-dim)] hover:text-[var(--brand-text)] transition-colors ml-auto"
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
        <div className="px-5 py-3.5 border-t border-[var(--brand-border)] bg-gradient-to-r from-amber-500/5 to-teal-500/5">
          <div className="flex items-center gap-3">
            <Icon as={Crown} size="lg" className="text-amber-400 flex-shrink-0" />
            <div className="flex-1">
              <div className="t-caption font-medium text-[var(--brand-text-bright)]">
                Want {STUDIO_NAME} to handle all {data.summary.fixNow + data.summary.fixSoon} urgent items?
              </div>
              <div className="t-caption-sm text-[var(--brand-text-muted)] mt-0.5">
                Premium clients get hands-free SEO — we implement every recommendation for you.
              </div>
            </div>
            <span className="t-caption text-amber-400 font-medium flex-shrink-0">$999/mo</span>
          </div>
        </div>
      )}

      {/* Generated timestamp */}
      <div className="px-5 py-2 border-t border-[var(--brand-border)]/50 text-center">
        <span className="t-caption-sm text-[var(--brand-text-muted)]">
          Generated {new Date(data.generatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
          {' · '}{data.recommendations.length} recommendations from audit + strategy analysis
        </span>
      </div>
    </div>
  );
}
