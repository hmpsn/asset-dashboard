import {
  AlertTriangle, Users, MousePointerClick, Eye, BarChart3, Shield, Target,
  Sparkles, Activity, Loader2, MessageCircle,
} from 'lucide-react';
import { StatCard } from '../ui';
import { MonthlySummary } from './MonthlySummary';
import { InsightsDigest } from './InsightsDigest';
import { ErrorBoundary } from '../ErrorBoundary';
import { QUICK_QUESTIONS } from './types';
import type {
  SearchOverview, PerformanceTrend, WorkspaceInfo, AuditSummary, AuditDetail,
  GA4Overview, GA4DailyTrend, GA4ConversionSummary, GA4NewVsReturning,
  GA4OrganicOverview, GA4Comparison, SearchComparison,
  ClientContentRequest, ClientKeywordStrategy, ClientRequest, ApprovalBatch,
  ClientTab,
} from './types';

interface SearchInsights {
  lowHanging: { query: string; position: number; impressions: number; clicks: number; ctr: number }[];
  topPerformers: { query: string; position: number; clicks: number; impressions: number; ctr: number }[];
  ctrOpps: { query: string; position: number; ctr: number; impressions: number; clicks: number }[];
  highImpLowClick: { query: string; impressions: number; clicks: number; position: number; ctr: number }[];
  page1: number;
  top3: number;
}

interface OverviewTabProps {
  ws: WorkspaceInfo;
  // Data
  overview: SearchOverview | null;
  searchComparison: SearchComparison | null;
  trend: PerformanceTrend[];
  ga4Overview: GA4Overview | null;
  ga4Trend: GA4DailyTrend[];
  ga4Comparison: GA4Comparison | null;
  ga4Organic: GA4OrganicOverview | null;
  ga4Conversions: GA4ConversionSummary[];
  ga4NewVsReturning: GA4NewVsReturning[];
  audit: AuditSummary | null;
  auditDetail: AuditDetail | null;
  strategyData: ClientKeywordStrategy | null;
  insights: SearchInsights | null;
  // Collections
  contentRequests: ClientContentRequest[];
  requests: ClientRequest[];
  approvalBatches: ApprovalBatch[];
  activityLog: { id: string; type: string; title: string; description?: string; actorName?: string; createdAt: string }[];
  // Derived
  pendingApprovals: number;
  unreadTeamNotes: number;
  // Helpers
  eventDisplayName: (eventName: string) => string;
  isEventPinned: (eventName: string) => boolean;
  // Actions
  setTab: (t: ClientTab) => void;
  onAskAi: (q: string) => void;
  onOpenChat: () => void;
  // Auth
  clientUser: { id: string; name: string; email: string; role: string } | null;
  // AI Insight
  proactiveInsight: string | null;
  proactiveInsightLoading: boolean;
}

export function OverviewTab({
  ws,
  overview, searchComparison, trend,
  ga4Overview, ga4Trend, ga4Comparison, ga4Organic, ga4Conversions, ga4NewVsReturning,
  audit, auditDetail, strategyData, insights,
  contentRequests, requests, approvalBatches, activityLog,
  pendingApprovals, unreadTeamNotes,
  eventDisplayName, isEventPinned,
  setTab, onAskAi, onOpenChat,
  clientUser,
  proactiveInsight, proactiveInsightLoading,
}: OverviewTabProps) {
  // Derive a dynamic subtitle from the most significant data signal
  const dynamicSubtitle = (() => {
    if (ga4Comparison) {
      const pct = ga4Comparison.changePercent.users;
      const dir = pct > 0 ? 'up' : pct < 0 ? 'down' : 'flat';
      if (dir !== 'flat') return `Traffic is ${dir} ${Math.abs(pct)}% — here's what's driving it`;
    }
    if (searchComparison) {
      const pct = searchComparison.changePercent.clicks;
      const dir = pct > 0 ? 'up' : pct < 0 ? 'down' : 'flat';
      if (dir !== 'flat') return `Search clicks ${dir} ${Math.abs(pct)}% vs last period`;
    }
    if (audit) {
      if (audit.siteScore >= 80) return `Site health is strong at ${audit.siteScore}/100`;
      return `${audit.errors || 0} site issues need attention`;
    }
    return 'Here are your latest insights';
  })();
  return (<>
    {/* Welcome header */}
    <div className="mb-2">
      <h2 className="text-xl font-semibold text-zinc-100">Welcome back{clientUser ? `, ${clientUser.name.split(' ')[0]}` : ''}</h2>
      <p className="text-sm text-zinc-500 mt-1">{dynamicSubtitle}</p>
    </div>

    {/* Inline AI Hero Insight */}
    {(proactiveInsight || proactiveInsightLoading) && (
      <div className="bg-gradient-to-r from-teal-500/8 via-zinc-900 to-emerald-500/8 rounded-xl border border-teal-500/20 px-5 py-4">
        <div className="flex items-start gap-3">
          <div className="w-8 h-8 rounded-lg bg-teal-500/15 flex items-center justify-center flex-shrink-0 mt-0.5">
            <Sparkles className="w-4 h-4 text-teal-400" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1.5">
              <span className="text-xs font-semibold text-teal-300">Insights Engine</span>
              <span className="text-[10px] text-zinc-600">AI-powered summary</span>
            </div>
            {proactiveInsightLoading ? (
              <div className="flex items-center gap-2 py-1">
                <Loader2 className="w-3.5 h-3.5 text-teal-400 animate-spin" />
                <span className="text-xs text-zinc-500">Analyzing your data...</span>
              </div>
            ) : (
              <p className="text-sm text-zinc-300 leading-relaxed">{proactiveInsight}</p>
            )}
            {proactiveInsight && !proactiveInsightLoading && (
              <button
                onClick={() => { onOpenChat(); setTimeout(() => onAskAi('What should I focus on this week?'), 100); }}
                className="mt-3 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-teal-500/10 hover:bg-teal-500/20 border border-teal-500/20 transition-colors text-xs text-teal-300 font-medium"
              >
                <MessageCircle className="w-3 h-3" /> Continue in chat
              </button>
            )}
          </div>
        </div>
      </div>
    )}

    {/* Action-needed banner */}
    {(() => {
      const actions: { label: string; count: number; tab: ClientTab; color: string }[] = [];
      if (pendingApprovals > 0) actions.push({ label: `${pendingApprovals} SEO change${pendingApprovals > 1 ? 's' : ''} to review`, count: pendingApprovals, tab: 'inbox', color: 'text-amber-400' });
      const contentReviews = contentRequests.filter(r => r.status === 'client_review').length;
      if (contentReviews > 0) actions.push({ label: `${contentReviews} content brief${contentReviews > 1 ? 's' : ''} ready for review`, count: contentReviews, tab: 'inbox', color: 'text-blue-400' });
      if (unreadTeamNotes > 0) actions.push({ label: `${unreadTeamNotes} request${unreadTeamNotes > 1 ? 's' : ''} with new team replies`, count: unreadTeamNotes, tab: 'inbox', color: 'text-teal-400' });
      if (actions.length === 0) return null;
      const total = actions.reduce((s, a) => s + a.count, 0);
      return (
        <div className="bg-gradient-to-r from-amber-600/10 via-zinc-900 to-teal-600/10 border border-amber-500/20 rounded-xl px-5 py-3.5">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-5 h-5 rounded-md bg-amber-500/15 flex items-center justify-center"><AlertTriangle className="w-3 h-3 text-amber-400" /></div>
            <span className="text-xs font-medium text-zinc-200">{total} item{total > 1 ? 's' : ''} need{total === 1 ? 's' : ''} your attention</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {actions.map((a, i) => (
              <button key={i} onClick={() => setTab(a.tab)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-800/60 hover:bg-zinc-800 border border-zinc-700/50 transition-colors text-left">
                <span className={`text-[11px] font-semibold ${a.color}`}>{a.count}</span>
                <span className="text-[11px] text-zinc-400">{a.label.replace(/^\d+\s*/, '')}</span>
              </button>
            ))}
          </div>
        </div>
      );
    })()}

    {/* Key metrics — full-span StatCards */}
    {(() => {
      const cards: { label: string; value: string; icon?: typeof Users; color: string; sub?: string; sparkline?: number[]; delta?: number }[] = [];
      if (ga4Overview) {
        cards.push({ label: 'Visitors', value: ga4Overview.totalUsers.toLocaleString(), icon: Users, color: '#2dd4bf', sub: ga4Overview.dateRange ? `${ga4Overview.dateRange.start} — ${ga4Overview.dateRange.end}` : undefined, sparkline: ga4Trend.map(d => d.users), delta: ga4Comparison?.changePercent.users });
      }
      if (overview) {
        cards.push({ label: 'Search Clicks', value: overview.totalClicks.toLocaleString(), icon: MousePointerClick, color: '#60a5fa', sub: overview.totalImpressions > 0 ? `${((overview.totalClicks / overview.totalImpressions) * 100).toFixed(1)}% CTR` : undefined, sparkline: trend.map(t => t.clicks), delta: searchComparison?.changePercent.clicks });
        cards.push({ label: 'Impressions', value: overview.totalImpressions.toLocaleString(), icon: Eye, color: '#a78bfa', sub: 'Google searches', sparkline: trend.map(t => t.impressions), delta: searchComparison?.changePercent.impressions });
      } else if (ga4Overview) {
        cards.push({ label: 'Sessions', value: ga4Overview.totalSessions.toLocaleString(), icon: BarChart3, color: '#60a5fa', sub: 'last period', sparkline: ga4Trend.map(d => d.sessions), delta: ga4Comparison?.changePercent.sessions });
      }
      if (audit) {
        cards.push({ label: 'Site Health', value: `${audit.siteScore}/100`, icon: Shield, color: audit.siteScore >= 80 ? '#34d399' : audit.siteScore >= 60 ? '#fbbf24' : '#f87171', sub: `${audit.totalPages} pages`, delta: audit.previousScore != null ? audit.siteScore - audit.previousScore : undefined });
      }
      if (strategyData) {
        const ranked = strategyData.pageMap.filter(p => p.currentPosition);
        if (ranked.length > 0) {
          const avgP = ranked.reduce((s, p) => s + (p.currentPosition || 0), 0) / ranked.length;
          cards.push({ label: 'Avg Position', value: `#${avgP.toFixed(1)}`, icon: Target, color: avgP <= 10 ? '#34d399' : avgP <= 20 ? '#fbbf24' : '#60a5fa', sub: `${ranked.length} pages ranking` });
        }
      }
      if (cards.length === 0) return null;
      return (
        <div className={`grid gap-3 ${cards.length <= 3 ? 'grid-cols-' + cards.length : cards.length === 4 ? 'grid-cols-2 sm:grid-cols-4' : 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-5'}`}>
          {cards.map((card, i) => (
            <StatCard
              key={i}
              label={card.label}
              value={card.value}
              icon={card.icon}
              iconColor={card.color}
              valueColor={card.color}
              sub={card.sub}
              sparklineData={card.sparkline && card.sparkline.length > 2 ? card.sparkline : undefined}
              sparklineColor={card.color}
              delta={card.delta}
              deltaLabel="%"
            />
          ))}
        </div>
      );
    })()}

    {/* What happened this month */}
    <ErrorBoundary label="Monthly Summary">
      <MonthlySummary
        contentRequests={contentRequests}
        requests={requests}
        approvalBatches={approvalBatches}
        activityCount={activityLog.length}
      />
    </ErrorBoundary>

    {/* Main content: insights + sidebar */}
    <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
      {/* Left column (3/5) — Insights feed */}
      <div className="lg:col-span-3 space-y-5">
        {/* AI-generated insights digest */}
        <ErrorBoundary label="Insights Digest">
          <InsightsDigest
            overview={overview}
            searchComparison={searchComparison}
            ga4Overview={ga4Overview}
            ga4Comparison={ga4Comparison}
            ga4Organic={ga4Organic}
            ga4Conversions={ga4Conversions}
            ga4NewVsReturning={ga4NewVsReturning}
            audit={audit}
            auditDetail={auditDetail}
            strategyData={strategyData}
            searchInsights={insights ? { lowHanging: insights.lowHanging, topPerformers: insights.topPerformers } : null}
            eventDisplayName={eventDisplayName}
            isEventPinned={isEventPinned}
            onNavigate={setTab}
          />
        </ErrorBoundary>

        {/* Empty state */}
        {!overview && !audit && !ga4Overview && (
          <div className="bg-gradient-to-br from-teal-500/10 via-zinc-900 to-emerald-500/10 rounded-xl border border-zinc-800 p-8 text-center">
            <div className="w-12 h-12 rounded-2xl bg-teal-500/10 flex items-center justify-center mx-auto mb-4"><BarChart3 className="w-6 h-6 text-teal-400" /></div>
            <h2 className="text-lg font-semibold text-zinc-200 mb-2">{ws.name}</h2>
            <p className="text-sm text-zinc-400">We're getting everything set up for you. Your performance data and insights will start appearing here shortly.</p>
          </div>
        )}
      </div>

      {/* Right sidebar (2/5) */}
      <div className="lg:col-span-2 space-y-4">
        {/* Ask the Insights Engine */}
        <div className="bg-gradient-to-br from-teal-500/5 via-zinc-900 to-zinc-900 rounded-xl border border-teal-500/15 p-4">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-6 h-6 rounded-lg bg-teal-500/15 flex items-center justify-center">
              <Sparkles className="w-3.5 h-3.5 text-teal-400" />
            </div>
            <span className="text-xs font-medium text-zinc-300">Ask the Insights Engine</span>
          </div>
          <p className="text-[11px] text-zinc-500 mb-3">Get instant answers about your site's performance, SEO opportunities, and next steps.</p>
          <div className="space-y-1.5">
            {QUICK_QUESTIONS.slice(0, 4).map((q, i) => (
              <button
                key={i}
                onClick={() => { onOpenChat(); setTimeout(() => onAskAi(q), 100); }}
                className="w-full text-left px-3 py-2 rounded-lg bg-zinc-800/40 hover:bg-zinc-800/70 border border-zinc-700/30 hover:border-teal-500/20 transition-colors text-[11px] text-zinc-400 hover:text-zinc-300"
              >
                {q}
              </button>
            ))}
          </div>
        </div>


        {/* Activity timeline */}
        {activityLog.length > 0 && (
          <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
            <div className="flex items-center gap-2 mb-3">
              <Activity className="w-4 h-4 text-teal-400" />
              <span className="text-xs font-medium text-zinc-300">Recent Work</span>
            </div>
            <div className="relative">
              <div className="absolute left-[5px] top-1 bottom-1 w-px bg-zinc-800" />
              <div className="space-y-2.5">
                {activityLog.slice(0, 5).map(entry => {
                  const icons: Record<string, { color: string; label: string }> = {
                    audit_completed: { color: '#60a5fa', label: 'Audit' },
                    request_resolved: { color: '#34d399', label: 'Done' },
                    approval_applied: { color: '#a78bfa', label: 'Applied' },
                    seo_updated: { color: '#fbbf24', label: 'SEO' },
                    images_optimized: { color: '#f472b6', label: 'Media' },
                    links_fixed: { color: '#fb923c', label: 'Links' },
                    content_updated: { color: '#2dd4bf', label: 'Content' },
                    note: { color: '#94a3b8', label: 'Note' },
                  };
                  const cfg = icons[entry.type] || icons.note;
                  return (
                    <div key={entry.id} className="flex items-start gap-2.5 pl-0">
                      <div className="w-[11px] h-[11px] rounded-full border-2 flex-shrink-0 mt-1 z-10" style={{ borderColor: cfg.color, backgroundColor: '#0f1219' }} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-[11px] font-medium px-1 py-0.5 rounded" style={{ backgroundColor: `${cfg.color}15`, color: cfg.color }}>{cfg.label}</span>
                          <span className="text-[11px] text-zinc-500">{new Date(entry.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                        </div>
                        <div className="text-[11px] text-zinc-400 mt-0.5 line-clamp-1">{entry.title}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  </>);
}
