import { TrendingUp, Target, Award } from 'lucide-react';
import { SectionCard } from '../ui/SectionCard';
import type { AnalyticsInsight, QuickWinData } from '../../../shared/types/analytics';

interface InsightCardsProps {
  workspaceId: string;
  insights: AnalyticsInsight[];
  tier: 'free' | 'growth' | 'premium';
  loading: boolean;
}

function SkeletonBlock({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse bg-zinc-800 rounded ${className}`} />;
}

// ── Traffic Momentum ─────────────────────────────────────────────

function TrafficMomentumCard({ insights, loading }: { insights: AnalyticsInsight[]; loading: boolean }) {
  const pageHealthInsights = insights.filter(i => i.insightType === 'page_health');
  const decayInsights = insights.filter(i => i.insightType === 'content_decay');

  const improvingCount = pageHealthInsights.filter(i => (i.data as Record<string, unknown>).trend === 'improving').length;
  const decliningCount = decayInsights.length;

  return (
    <SectionCard
      title="Traffic Momentum"
      titleIcon={<TrendingUp size={14} className="text-teal-400" />}
    >
      {loading ? (
        <div className="space-y-2">
          <SkeletonBlock className="h-4 w-3/4" />
          <SkeletonBlock className="h-4 w-1/2" />
        </div>
      ) : (
        <div className="space-y-2 text-sm">
          {improvingCount > 0 ? (
            <p className="text-zinc-200">
              <span className="text-teal-400 font-medium">{improvingCount} page{improvingCount !== 1 ? 's' : ''}</span>
              {' '}gaining momentum this month
            </p>
          ) : (
            <p className="text-zinc-400">No momentum data yet — check back after analytics sync</p>
          )}
          {decliningCount > 0 && (
            <p className="text-zinc-400 text-xs">
              {decliningCount} page{decliningCount !== 1 ? 's' : ''} showing decay signals
            </p>
          )}
        </div>
      )}
    </SectionCard>
  );
}

// ── Quick Wins ───────────────────────────────────────────────────

function QuickWinsCard({
  insights,
  tier,
  loading,
}: {
  insights: AnalyticsInsight[];
  tier: 'free' | 'growth' | 'premium';
  loading: boolean;
}) {
  const quickWins = insights.filter(i => i.insightType === 'quick_win');

  const cardAction =
    tier === 'premium' ? (
      <span className="text-xs text-zinc-400">Your strategist is tracking this</span>
    ) : tier === 'growth' ? (
      <span className="text-xs text-teal-400 cursor-pointer hover:underline">View in Strategy</span>
    ) : null;

  return (
    <SectionCard
      title="Quick Wins"
      titleIcon={<Target size={14} className="text-teal-400" />}
      action={cardAction ?? undefined}
    >
      {loading ? (
        <div className="space-y-2">
          <SkeletonBlock className="h-4 w-full" />
          <SkeletonBlock className="h-4 w-2/3" />
          <SkeletonBlock className="h-4 w-3/4" />
        </div>
      ) : tier === 'free' ? (
        <div className="space-y-2">
          <p className="text-sm text-zinc-400">
            {quickWins.length > 0
              ? `${quickWins.length} page${quickWins.length !== 1 ? 's' : ''} close to page 1`
              : 'Quick wins analysis available'}
          </p>
          <p className="text-xs text-teal-400 cursor-pointer hover:underline">
            Upgrade to Growth to unlock quick wins
          </p>
        </div>
      ) : quickWins.length === 0 ? (
        <p className="text-sm text-zinc-400">No quick wins identified yet</p>
      ) : (
        <ul className="space-y-2">
          {quickWins.slice(0, 3).map(insight => {
            const d = insight.data as unknown as QuickWinData;
            return (
              <li key={insight.id} className="flex items-start justify-between gap-2 text-sm">
                <span className="text-zinc-300 truncate">{d.pageUrl || insight.pageId}</span>
                <span className="text-zinc-500 shrink-0">pos {d.currentPosition}</span>
              </li>
            );
          })}
        </ul>
      )}
    </SectionCard>
  );
}

// ── Top Performers ───────────────────────────────────────────────

function TopPerformersCard({
  insights,
  tier,
  loading,
}: {
  insights: AnalyticsInsight[];
  tier: 'free' | 'growth' | 'premium';
  loading: boolean;
}) {
  const conversionInsights = insights.filter(i => i.insightType === 'conversion_attribution');
  const topPages = insights
    .filter(i => i.insightType === 'page_health')
    .sort((a, b) => ((b.data as Record<string, unknown>).score as number ?? 0) - ((a.data as Record<string, unknown>).score as number ?? 0))
    .slice(0, 3);

  const totalConversions = conversionInsights.reduce(
    (sum, i) => sum + ((i.data as Record<string, unknown>).conversions as number ?? 0),
    0,
  );

  const premiumCta =
    tier === 'premium' ? (
      <span className="text-xs text-zinc-400">Your strategist is tracking this</span>
    ) : null;

  return (
    <SectionCard
      title="Top Performers"
      titleIcon={<Award size={14} className="text-teal-400" />}
      action={premiumCta ?? undefined}
    >
      {loading ? (
        <div className="space-y-2">
          <SkeletonBlock className="h-4 w-3/4" />
          <SkeletonBlock className="h-4 w-1/2" />
        </div>
      ) : (
        <div className="space-y-2 text-sm">
          {totalConversions > 0 && (
            <p className="text-zinc-200">
              Your best content drove{' '}
              <span className="text-teal-400 font-medium">{totalConversions} conversions</span>
            </p>
          )}
          {topPages.length > 0 ? (
            <ul className="space-y-1">
              {topPages.map(insight => (
                <li key={insight.id} className="flex items-center justify-between text-zinc-400 text-xs">
                  <span className="truncate">{insight.pageId ?? 'site'}</span>
                  <span className="text-zinc-500 shrink-0">
                    score {(insight.data as Record<string, unknown>).score as number}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-zinc-400">No performance data yet</p>
          )}
        </div>
      )}
    </SectionCard>
  );
}

// ── InsightCards (3-card layout) ─────────────────────────────────

export function InsightCards({ workspaceId: _workspaceId, insights, tier, loading }: InsightCardsProps) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
      <TrafficMomentumCard insights={insights} loading={loading} />
      <QuickWinsCard insights={insights} tier={tier} loading={loading} />
      <TopPerformersCard insights={insights} tier={tier} loading={loading} />
    </div>
  );
}
