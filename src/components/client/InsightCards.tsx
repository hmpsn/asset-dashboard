import { TrendingUp, TrendingDown, Clock, Target, Award, Code2, HeartPulse } from 'lucide-react';
import { SectionCard } from '../ui/SectionCard';
import { Skeleton } from '../ui/Skeleton';
import type { AnalyticsInsight, QuickWinData, ContentDecayData, SiteHealthInsightData, CompetitorAlertData, EmergingKeywordData, FreshnessAlertData } from '../../../shared/types/analytics';

interface InsightCardsProps {
  workspaceId: string;
  insights: AnalyticsInsight[];
  tier: 'free' | 'growth' | 'premium';
  loading: boolean;
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
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
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
  const quickWins = insights.filter(i => i.insightType === 'ranking_opportunity');

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
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-4 w-3/4" />
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
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
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

// ── Schema Opportunities ─────────────────────────────────────────

export function SchemaOpportunitiesCard({
  insights,
  tier,
  loading,
}: {
  insights: AnalyticsInsight[];
  tier: 'free' | 'growth' | 'premium';
  loading: boolean;
}) {
  // Pages with health data that could benefit from schema markup
  const healthInsights = insights
    .filter(i => i.insightType === 'page_health')
    .sort((a, b) => ((b.data as Record<string, unknown>).impressions as number ?? 0) - ((a.data as Record<string, unknown>).impressions as number ?? 0));

  const highTrafficPages = healthInsights.filter(i => ((i.data as Record<string, unknown>).impressions as number ?? 0) > 100);

  const cardAction =
    tier === 'premium' ? (
      <span className="text-xs text-zinc-400">Your strategist is tracking this</span>
    ) : tier === 'growth' ? (
      <span className="text-xs text-teal-400 cursor-pointer hover:underline">View Schema tab</span>
    ) : null;

  return (
    <SectionCard
      title="Schema Opportunities"
      titleIcon={<Code2 size={14} className="text-teal-400" />}
      action={cardAction ?? undefined}
    >
      {loading ? (
        <div className="space-y-2">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
        </div>
      ) : tier === 'free' ? (
        <div className="space-y-2">
          <p className="text-sm text-zinc-400">
            {highTrafficPages.length > 0
              ? `${highTrafficPages.length} page${highTrafficPages.length !== 1 ? 's' : ''} could qualify for rich results`
              : 'Schema analysis available'}
          </p>
          <p className="text-xs text-teal-400 cursor-pointer hover:underline">
            Upgrade to Growth to unlock schema insights
          </p>
        </div>
      ) : highTrafficPages.length === 0 ? (
        <p className="text-sm text-zinc-400">No schema opportunity data yet</p>
      ) : (
        <div className="space-y-2 text-sm">
          <p className="text-zinc-200">
            <span className="text-teal-400 font-medium">{highTrafficPages.length} page{highTrafficPages.length !== 1 ? 's' : ''}</span>
            {' '}could qualify for rich results
          </p>
          <ul className="space-y-1">
            {highTrafficPages.slice(0, 3).map(insight => {
              let path: string;
              try { path = new URL(insight.pageId || '').pathname; } catch { path = insight.pageId || 'page'; }
              return (
                <li key={insight.id} className="flex items-center justify-between text-zinc-400 text-xs">
                  <span className="truncate">{path}</span>
                  <span className="text-zinc-500 shrink-0">
                    {(insight.data as Record<string, unknown>).impressions as number} imp
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </SectionCard>
  );
}

// ── Content Health ───────────────────────────────────────────────

export function ContentHealthCard({
  insights,
  tier,
  loading,
}: {
  insights: AnalyticsInsight[];
  tier: 'free' | 'growth' | 'premium';
  loading: boolean;
}) {
  const decayInsights = insights
    .filter(i => i.insightType === 'content_decay')
    .map(i => ({ pageId: i.pageId, ...(i.data as unknown as ContentDecayData) }))
    .sort((a, b) => a.deltaPercent - b.deltaPercent);

  const estimatedRecovery = decayInsights.reduce(
    (sum, d) => sum + Math.round(d.baselineClicks - d.currentClicks),
    0,
  );

  const cardAction =
    tier === 'premium' ? (
      <span className="text-xs text-zinc-400">Your strategist is tracking this</span>
    ) : tier === 'growth' ? (
      <span className="text-xs text-teal-400 cursor-pointer hover:underline">View details</span>
    ) : null;

  return (
    <SectionCard
      title="Content Health"
      titleIcon={<HeartPulse size={14} className="text-teal-400" />}
      action={cardAction ?? undefined}
    >
      {loading ? (
        <div className="space-y-2">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
        </div>
      ) : tier === 'free' ? (
        <div className="space-y-2">
          <p className="text-sm text-zinc-400">
            {decayInsights.length > 0
              ? `${decayInsights.length} post${decayInsights.length !== 1 ? 's' : ''} showing decay`
              : 'Content health analysis available'}
          </p>
          <p className="text-xs text-teal-400 cursor-pointer hover:underline">
            Upgrade to Growth to see content health
          </p>
        </div>
      ) : decayInsights.length === 0 ? (
        <p className="text-sm text-zinc-400">No content decay data yet</p>
      ) : (
        <div className="space-y-2 text-sm">
          <p className="text-zinc-200">
            <span className="text-teal-400 font-medium">{decayInsights.length}</span>
            {' '}post{decayInsights.length !== 1 ? 's' : ''} showing decay
            {estimatedRecovery > 0 && (
              <span className="text-zinc-400 text-xs">
                {' '}— a refresh could restore ~{estimatedRecovery} sessions/mo
              </span>
            )}
          </p>
          <ul className="space-y-1">
            {decayInsights.slice(0, 3).map((d, i) => {
              let path: string;
              try { path = new URL(d.pageId || '').pathname; } catch { path = d.pageId || 'page'; }
              return (
                <li key={i} className="flex items-center justify-between text-zinc-400 text-xs">
                  <span className="truncate">{path}</span>
                  <span className="text-red-400 shrink-0">{d.deltaPercent}%</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </SectionCard>
  );
}

// ── Site Health ──────────────────────────────────────────────────

export function SiteHealthCard({
  insights,
  loading,
}: {
  insights: AnalyticsInsight[];
  loading: boolean;
}) {
  const siteHealthInsights = insights.filter(i => i.insightType === 'site_health');
  const latest = siteHealthInsights[0];
  const data = latest ? (latest.data as unknown as SiteHealthInsightData) : null;

  const deltaPositive = data?.scoreDelta != null && data.scoreDelta > 0;
  const deltaNegative = data?.scoreDelta != null && data.scoreDelta < 0;

  return (
    <SectionCard
      title="Site Health"
      titleIcon={<HeartPulse size={14} className="text-teal-400" />}
    >
      {loading ? (
        <div className="space-y-2">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
        </div>
      ) : !data ? (
        <p className="text-sm text-zinc-400">No site health data yet — run an audit to get started</p>
      ) : (
        <div className="space-y-2 text-sm">
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-semibold text-zinc-100">{data.siteScore}</span>
            <span className="text-zinc-500 text-xs">/ 100</span>
            {data.scoreDelta != null && (
              <span
                className={
                  deltaPositive
                    ? 'text-teal-400 text-xs font-medium'
                    : deltaNegative
                      ? 'text-red-400 text-xs font-medium'
                      : 'text-zinc-500 text-xs'
                }
              >
                {deltaPositive ? '+' : ''}{data.scoreDelta} pts
              </span>
            )}
          </div>
          <div className="flex gap-4 text-xs text-zinc-400">
            {data.errors > 0 && (
              <span>
                <span className="text-red-400 font-medium">{data.errors}</span> error{data.errors !== 1 ? 's' : ''}
              </span>
            )}
            {data.warnings > 0 && (
              <span>
                <span className="text-amber-400 font-medium">{data.warnings}</span> warning{data.warnings !== 1 ? 's' : ''}
              </span>
            )}
            {data.errors === 0 && data.warnings === 0 && (
              <span className="text-teal-400">No critical issues found</span>
            )}
          </div>
        </div>
      )}
    </SectionCard>
  );
}

// ── Competitor Alerts ────────────────────────────────────────────

function CompetitorAlertCard({ insights, loading }: { insights: AnalyticsInsight[]; loading: boolean }) {
  const alerts = insights.filter(i => i.insightType === 'competitor_alert') as AnalyticsInsight<'competitor_alert'>[];
  const topAlert = alerts[0];
  const data = topAlert?.data as CompetitorAlertData | undefined;
  if (!loading && !topAlert) return null;
  return (
    <SectionCard
      title="Competitor Alerts"
      titleIcon={<TrendingDown size={14} className="text-blue-400" />}
    >
      {loading ? (
        <div className="space-y-2">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
        </div>
      ) : data ? (
        <div className="space-y-2 text-sm">
          <p className="text-zinc-200">
            <span className="text-blue-400 font-medium">{data.competitorDomain}</span>
            {data.keyword ? ` — "${data.keyword}"` : ''}
          </p>
          {data.previousPosition != null && data.currentPosition != null && (
            <p className="text-zinc-400 text-xs">
              Position {data.previousPosition} → {data.currentPosition}
              {data.volume ? ` · ${Number(data.volume).toLocaleString()} searches/mo` : ''}
            </p>
          )}
          {alerts.length > 1 && (
            <p className="text-zinc-500 text-xs">{alerts.length - 1} more competitor movement{alerts.length > 2 ? 's' : ''}</p>
          )}
        </div>
      ) : null}
    </SectionCard>
  );
}

// ── Emerging Keywords ────────────────────────────────────────────

function EmergingKeywordCard({ insights, loading }: { insights: AnalyticsInsight[]; loading: boolean }) {
  const emerging = insights.filter(i => i.insightType === 'emerging_keyword') as AnalyticsInsight<'emerging_keyword'>[];
  const top = emerging[0];
  const data = top?.data as EmergingKeywordData | undefined;
  if (!loading && !top) return null;
  return (
    <SectionCard
      title="Rising Search Trends"
      titleIcon={<TrendingUp size={14} className="text-blue-400" />}
    >
      {loading ? (
        <div className="space-y-2">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
        </div>
      ) : data ? (
        <div className="space-y-2 text-sm">
          <p className="text-zinc-200 font-medium">"{data.keyword}"</p>
          <div className="flex items-center gap-2">
            {data.volume != null && (
              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs bg-blue-500/10 text-blue-400">
                {Number(data.volume).toLocaleString()} searches/mo
              </span>
            )}
            {data.difficulty != null && (
              <span className="text-zinc-500 text-xs">KD {data.difficulty}</span>
            )}
          </div>
          {data.currentPosition != null ? (
            <p className="text-zinc-400 text-xs">Currently ranking at position {Math.round(data.currentPosition)}</p>
          ) : (
            <p className="text-zinc-400 text-xs">Not yet ranking — opportunity to get ahead early</p>
          )}
          {emerging.length > 1 && (
            <p className="text-zinc-500 text-xs">{emerging.length - 1} more trending keyword{emerging.length > 2 ? 's' : ''}</p>
          )}
        </div>
      ) : null}
    </SectionCard>
  );
}

// ── Freshness Alerts ─────────────────────────────────────────────

function FreshnessAlertCard({ insights, loading }: { insights: AnalyticsInsight[]; loading: boolean }) {
  const stale = insights.filter(i => i.insightType === 'freshness_alert') as AnalyticsInsight<'freshness_alert'>[];
  const worst = stale.sort((a, b) => b.data.daysSinceLastAnalysis - a.data.daysSinceLastAnalysis)[0];
  const data = worst?.data as FreshnessAlertData | undefined;
  if (!loading && !worst) return null;
  return (
    <SectionCard
      title="Content Freshness"
      titleIcon={<Clock size={14} className="text-amber-400" />}
    >
      {loading ? (
        <div className="space-y-2">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
        </div>
      ) : data ? (
        <div className="space-y-2 text-sm">
          <p className="text-zinc-200 text-xs font-mono truncate">{data.pagePath}</p>
          <p className="text-amber-400 text-xs font-medium">
            {data.daysSinceLastAnalysis} days since last update
          </p>
          {data.impressions != null && (
            <p className="text-zinc-400 text-xs">
              {Number(data.impressions).toLocaleString()} monthly impressions at risk
            </p>
          )}
          {stale.length > 1 && (
            <p className="text-zinc-500 text-xs">{stale.length - 1} more stale page{stale.length > 2 ? 's' : ''}</p>
          )}
        </div>
      ) : null}
    </SectionCard>
  );
}

// ── InsightCards (9-card layout) ─────────────────────────────────

export function InsightCards({ workspaceId: _workspaceId, insights, tier, loading }: InsightCardsProps) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      <TrafficMomentumCard insights={insights} loading={loading} />
      <QuickWinsCard insights={insights} tier={tier} loading={loading} />
      <TopPerformersCard insights={insights} tier={tier} loading={loading} />
      <SchemaOpportunitiesCard insights={insights} tier={tier} loading={loading} />
      <ContentHealthCard insights={insights} tier={tier} loading={loading} />
      <SiteHealthCard insights={insights} loading={loading} />
      <CompetitorAlertCard insights={insights} loading={loading} />
      <EmergingKeywordCard insights={insights} loading={loading} />
      <FreshnessAlertCard insights={insights} loading={loading} />
    </div>
  );
}
