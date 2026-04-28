import {
  AlertTriangle, Users, MousePointerClick, Eye, BarChart3, Shield, Target,
  Sparkles, Activity, FileText, Search,
} from 'lucide-react';
import { MonthlyDigest } from './MonthlyDigest';
import { IntelligenceSummaryCard } from './IntelligenceSummaryCard';
import { HealthScoreCard } from './HealthScoreCard';
import { PredictionShowcaseCard } from './PredictionShowcaseCard';
import { useClientIntelligence } from '../../hooks/client';
import type { Tier } from '../ui/TierGate';
import { useNavigate } from 'react-router-dom';
import { StatCard, MetricRing, Icon} from '../ui';
import { Explainer } from './SeoGlossary';
import { useBetaMode } from './BetaContext';
import { InsightsDigest } from './InsightsDigest';
import { ErrorBoundary } from '../ErrorBoundary';
import { QUICK_QUESTIONS, LEARN_SEO_QUESTIONS } from './types';
import { clientPath } from '../../routes';
import { themeColor } from '../ui/constants';
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
  workspaceId: string;
  onAskAi: (q: string) => void;
  onOpenChat: () => void;
  // Auth
  clientUser: { id: string; name: string; email: string; role: string } | null;
  // Content Plan
  contentPlanSummary?: { totalCells: number; publishedCells: number; reviewCells: number; approvedCells: number; inProgressCells: number; matrixCount: number } | null;
}

export function OverviewTab({
  ws,
  overview, searchComparison,
  ga4Overview, ga4Comparison, ga4Organic, ga4Conversions, ga4NewVsReturning,
  audit, auditDetail, strategyData, insights,
  contentRequests, activityLog,
  pendingApprovals, unreadTeamNotes,
  eventDisplayName, isEventPinned,
  workspaceId, onAskAi, onOpenChat,
  clientUser, contentPlanSummary,
}: OverviewTabProps) {
  const navigate = useNavigate();
  const betaMode = useBetaMode();
  const { data: clientIntel } = useClientIntelligence(workspaceId);
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
      <h2 className="text-xl font-semibold text-[var(--brand-text)]">Welcome back{clientUser ? `, ${clientUser.name.split(' ')[0]}` : ''}</h2>
      <p className="t-body text-[var(--brand-text-muted)] mt-1 leading-relaxed">{dynamicSubtitle}</p>
    </div>

    {/* Headline health score */}
    <HealthScoreCard score={clientIntel?.compositeHealthScore} />

    {/* Key metrics — full-span StatCards */}
    {(() => {
      const cards: { label: React.ReactNode; value: string; icon?: typeof Users; color: string; sub?: string; delta?: number }[] = [];
      if (ga4Overview) {
        cards.push({ label: 'Visitors', value: ga4Overview.totalUsers.toLocaleString(), icon: Users, color: '#2dd4bf', sub: ga4Overview.dateRange ? `${ga4Overview.dateRange.start} — ${ga4Overview.dateRange.end}` : undefined, delta: ga4Comparison?.changePercent.users });
      }
      if (overview) {
        cards.push({ label: <><span>Search Clicks</span><Explainer term="clicks" /></>, value: overview.totalClicks.toLocaleString(), icon: MousePointerClick, color: '#60a5fa', sub: overview.totalImpressions > 0 ? `${((overview.totalClicks / overview.totalImpressions) * 100).toFixed(1)}% CTR` : undefined, delta: searchComparison?.changePercent.clicks });
        cards.push({ label: <><span>Impressions</span><Explainer term="impressions" /></>, value: overview.totalImpressions.toLocaleString(), icon: Eye, color: '#60a5fa', sub: 'Google searches', delta: searchComparison?.changePercent.impressions });
      } else if (ga4Overview) {
        cards.push({ label: 'Sessions', value: ga4Overview.totalSessions.toLocaleString(), icon: BarChart3, color: '#60a5fa', sub: 'last period', delta: ga4Comparison?.changePercent.sessions });
      }
      if (strategyData) {
        const ranked = strategyData.pageMap.filter(p => p.currentPosition);
        if (ranked.length > 0) {
          const avgP = ranked.reduce((s, p) => s + (p.currentPosition || 0), 0) / ranked.length;
          cards.push({ label: <><span>Avg Position</span><Explainer term="position" /></>, value: `#${avgP.toFixed(1)}`, icon: Target, color: avgP <= 10 ? '#34d399' : avgP <= 20 ? '#fbbf24' : '#60a5fa', sub: `${ranked.length} pages ranking` });
        }
      }
      const totalItems = cards.length + (audit ? 1 : 0);
      if (totalItems === 0) return null;
      return (
        <div className={`grid gap-3 ${totalItems <= 3 ? 'grid-cols-' + totalItems : totalItems === 4 ? 'grid-cols-2 sm:grid-cols-4' : 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-5'}`}>
          {audit && (
            <div className="bg-[var(--surface-2)] border border-[var(--brand-border)] p-3 text-left" style={{ borderRadius: 'var(--radius-signature)' }}>
              <div className="flex items-center gap-1.5 mb-2">
                <Icon as={Shield} size="md" className="flex-shrink-0 text-[var(--brand-text-muted)]" />
                <span className="t-caption-sm text-[var(--brand-text-muted)] uppercase tracking-wider font-medium leading-none">Site Health</span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-2xl font-bold leading-none text-[var(--brand-text)]">{audit.siteScore}</div>
                  <div className="t-caption-sm text-[var(--brand-text-muted)] mt-1">of 100</div>
                </div>
                <MetricRing score={audit.siteScore} size={44} />
              </div>
            </div>
          )}
          {cards.map((card, i) => (
            <StatCard
              key={i}
              size="hero"
              label={card.label}
              value={card.value}
              icon={card.icon}
              iconColor={card.color}
              valueColor={card.color}
              sub={card.sub}
              delta={card.delta}
              deltaLabel="%"
              staggerIndex={i}
            />
          ))}
        </div>
      );
    })()}

    {/* Action-needed banner — full-width, above content grid */}
    {(() => {
      const actions: { label: string; count: number; tab: ClientTab; color: string; icon: string }[] = [];
      if (pendingApprovals > 0) actions.push({ label: `${pendingApprovals} SEO change${pendingApprovals > 1 ? 's' : ''} to review`, count: pendingApprovals, tab: 'inbox', color: 'text-amber-400', icon: 'approval' });
      const briefReviews = contentRequests.filter(r => r.status === 'client_review').length;
      const postReviews = contentRequests.filter(r => r.status === 'post_review').length;
      if (!betaMode && briefReviews > 0) actions.push({ label: `${briefReviews} content brief${briefReviews > 1 ? 's' : ''} ready for review`, count: briefReviews, tab: 'inbox', color: 'text-blue-400', icon: 'content' });
      if (!betaMode && postReviews > 0) actions.push({ label: `${postReviews} post${postReviews > 1 ? 's' : ''} ready for review`, count: postReviews, tab: 'inbox', color: 'text-blue-400', icon: 'content' });
      if (unreadTeamNotes > 0) actions.push({ label: `${unreadTeamNotes} request${unreadTeamNotes > 1 ? 's' : ''} with new team replies`, count: unreadTeamNotes, tab: 'inbox', color: 'text-teal-400', icon: 'reply' });
      if (contentPlanSummary && contentPlanSummary.reviewCells > 0) actions.push({ label: `${contentPlanSummary.reviewCells} content plan page${contentPlanSummary.reviewCells > 1 ? 's' : ''} to review`, count: contentPlanSummary.reviewCells, tab: 'content-plan', color: 'text-blue-400', icon: 'content-plan' });
      if (actions.length === 0) return null;
      const total = actions.reduce((s, a) => s + a.count, 0);
      return (
        <div className="bg-gradient-to-r from-amber-600/10 via-zinc-900 to-teal-600/10 border border-amber-500/20 px-4 py-3" style={{ borderRadius: 'var(--radius-signature)' }}>
          <div className="flex items-center gap-2 mb-2">
            <div className="w-5 h-5 rounded-md bg-amber-500/15 flex items-center justify-center"><Icon as={AlertTriangle} size="sm" className="text-amber-400" /></div>
            <span className="t-caption font-medium text-[var(--brand-text)]">{total} item{total > 1 ? 's' : ''} need{total === 1 ? 's' : ''} your attention</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {actions.map((a, i) => (
              <button key={i} onClick={() => navigate(clientPath(workspaceId, a.tab, betaMode))} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-[var(--radius-lg)] bg-[var(--surface-3)]/60 hover:bg-[var(--surface-3)] border border-[var(--brand-border)]/50 transition-colors text-left">
                <span className={`t-caption-sm font-semibold ${a.color}`}>{a.count}</span>
                <span className="t-caption-sm text-[var(--brand-text-muted)]">{a.label.replace(/^\d+\s*/, '')}</span>
              </button>
            ))}
          </div>
        </div>
      );
    })()}

    {/* Primary CTA Banner - contextual next action */}
    {(() => {
      // Determine the most valuable next action
      const briefReviews = contentRequests.filter(r => r.status === 'client_review').length;
      const postReviews = contentRequests.filter(r => r.status === 'post_review').length;
      if (strategyData && briefReviews + postReviews === 0) {
        return (
          <div className="bg-gradient-to-r from-teal-600/10 via-zinc-900 to-emerald-600/10 border border-teal-500/20 px-4 py-3" style={{ borderRadius: 'var(--radius-signature)' }}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-[var(--radius-lg)] bg-teal-500/15 flex items-center justify-center">
                  <Icon as={FileText} size="md" className="text-teal-400" />
                </div>
                <div>
                  <h3 className="t-body font-medium text-[var(--brand-text)]">Ready to create content?</h3>
                  <p className="t-caption-sm text-[var(--brand-text-muted)]">Your keyword strategy is set up. Generate your first content brief.</p>
                </div>
              </div>
              <button 
                onClick={() => navigate(clientPath(workspaceId, 'inbox', betaMode))}
                className="px-3 py-1.5 bg-teal-600 hover:bg-teal-500 rounded-[var(--radius-lg)] t-caption font-medium transition-colors"
              >
                Generate Brief
              </button>
            </div>
          </div>
        );
      }
      
      if (audit && audit.siteScore < 80) {
        return (
          <div className="bg-gradient-to-r from-amber-600/10 via-zinc-900 to-orange-600/10 border border-amber-500/20 px-4 py-3" style={{ borderRadius: 'var(--radius-signature)' }}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-[var(--radius-lg)] bg-amber-500/15 flex items-center justify-center">
                  <Icon as={Shield} size="md" className="text-amber-400" />
                </div>
                <div>
                  <h3 className="t-body font-medium text-[var(--brand-text)]">Improve your site health</h3>
                  <p className="t-caption-sm text-[var(--brand-text-muted)]">Your site score is {audit.siteScore}/100. Fix issues to boost rankings.</p>
                </div>
              </div>
              <button 
                onClick={() => navigate(clientPath(workspaceId, 'health', betaMode))}
                className="px-3 py-1.5 bg-amber-600 hover:bg-amber-500 rounded-[var(--radius-lg)] t-caption font-medium transition-colors"
              >
                View Issues
              </button>
            </div>
          </div>
        );
      }
      
      if (overview && overview.totalClicks < 100) {
        return (
          <div className="bg-gradient-to-r from-blue-600/10 via-zinc-900 to-cyan-600/10 border border-blue-500/20 px-4 py-3" style={{ borderRadius: 'var(--radius-signature)' }}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-[var(--radius-lg)] bg-blue-500/15 flex items-center justify-center">
                  <Icon as={Target} size="md" className="text-blue-400" />
                </div>
                <div>
                  <h3 className="t-body font-medium text-[var(--brand-text)]">Grow your search traffic</h3>
                  <p className="t-caption-sm text-[var(--brand-text-muted)]">You got {overview.totalClicks} clicks last month. Let's increase that.</p>
                </div>
              </div>
              <button 
                onClick={() => navigate(clientPath(workspaceId, 'search', betaMode))}
                className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 rounded-[var(--radius-lg)] t-caption font-medium transition-colors"
              >
                Find Keywords
              </button>
            </div>
          </div>
        );
      }
      
      return null;
    })()}

    {/* Monthly performance digest */}
    <ErrorBoundary label="Monthly Digest">
      <MonthlyDigest workspaceId={workspaceId} tier={(betaMode ? 'premium' : (ws.tier as Tier)) || 'free'} />
    </ErrorBoundary>

    {/* Intelligence summary — insights, pipeline, win rate */}
    {ws.siteIntelligenceClientView !== false && (
    <ErrorBoundary label="Intelligence Summary">
      <IntelligenceSummaryCard workspaceId={workspaceId} tier={(betaMode ? 'premium' : (ws.tier as Tier)) || 'free'} />
    </ErrorBoundary>
    )}

    {/* Predictions that came true — only render when server has populated the field (gated to growth+) */}
    {clientIntel?.weCalledIt !== undefined && <PredictionShowcaseCard predictions={clientIntel.weCalledIt} />}

    {/* Main content: insights + sidebar */}
    <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
      {/* Left column (3/5) — Insights feed */}
      <div className="lg:col-span-3 space-y-8">
        {/* Unified insights feed (server-computed + locally-generated) */}
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
            workspaceId={workspaceId}
            contentPlanSummary={contentPlanSummary}
            siteIntelligenceEnabled={ws.siteIntelligenceClientView !== false}
          />
        </ErrorBoundary>

        {/* Empty state with setup guidance */}
        {!overview && !audit && !ga4Overview && ( // pr-check-disable-next-line -- Brand signature radius intentional
          <div className="bg-gradient-to-br from-teal-500/10 via-zinc-900 to-emerald-500/10 border border-[var(--brand-border)] p-8" style={{ borderRadius: 'var(--radius-signature-lg)' }}>
            <div className="w-12 h-12 rounded-[var(--radius-xl)] bg-teal-500/10 flex items-center justify-center mx-auto mb-4"><Icon as={BarChart3} size="xl" className="text-teal-400" /></div>
            <h2 className="text-lg font-semibold text-[var(--brand-text)] mb-2">{ws.name}</h2>
            <p className="t-body text-[var(--brand-text-muted)] mb-6 leading-relaxed">We're getting everything set up for you. Here's what we need:</p>
            
            <div className="space-y-3 max-w-md mx-auto">
              <div className="flex items-center gap-3 t-body">
                <div className="w-6 h-6 rounded-full bg-[var(--surface-3)] flex items-center justify-center flex-shrink-0">
                  <Icon as={Search} size="sm" className="text-[var(--brand-text-muted)]" />
                </div>
                <span className="text-[var(--brand-text)]">Connect Google Search Console</span>
              </div>
              <div className="flex items-center gap-3 t-body">
                <div className="w-6 h-6 rounded-full bg-[var(--surface-3)] flex items-center justify-center flex-shrink-0">
                  <Icon as={BarChart3} size="sm" className="text-[var(--brand-text-muted)]" />
                </div>
                <span className="text-[var(--brand-text)]">Connect Google Analytics</span>
              </div>
              <div className="flex items-center gap-3 t-body">
                <div className="w-6 h-6 rounded-full bg-[var(--surface-3)] flex items-center justify-center flex-shrink-0">
                  <Icon as={Shield} size="sm" className="text-[var(--brand-text-muted)]" />
                </div>
                <span className="text-[var(--brand-text)]">Run first site audit</span>
              </div>
            </div>
            
            <div className="mt-6 pt-6 border-t border-[var(--brand-border)]">
              <p className="t-caption text-[var(--brand-text-muted)]">Once connected, you'll see traffic data, SEO insights, and actionable recommendations here.</p>
            </div>
          </div>
        )}
      </div>

      {/* Right sidebar (2/5) */}
      <div className="lg:col-span-2 space-y-8">
        {/* Ask the Insights Engine */}
        {/* pr-check-disable-next-line -- Brand signature radius intentional */}
        <div className="bg-gradient-to-br from-teal-500/5 via-zinc-900 to-zinc-900 border border-teal-500/15 p-5" style={{ borderRadius: 'var(--radius-signature-lg)' }}>
          <div className="flex items-center gap-2 mb-3">
            <div className="w-6 h-6 rounded-[var(--radius-lg)] bg-teal-500/15 flex items-center justify-center">
              <Icon as={Sparkles} size="md" className="text-teal-400" />
            </div>
            <span className="t-caption font-medium text-[var(--brand-text)]">Ask the Insights Engine</span>
          </div>
          <p className="t-caption-sm text-[var(--brand-text-muted)] mb-3">Get instant answers about your site's performance, SEO opportunities, and next steps.</p>
          <div className="space-y-1.5">
            {QUICK_QUESTIONS.slice(0, 4).map((q, i) => (
              <button
                key={i}
                onClick={() => { onOpenChat(); setTimeout(() => onAskAi(q), 100); }}
                className="w-full text-left px-3 py-2 rounded-[var(--radius-lg)] bg-[var(--surface-3)]/40 hover:bg-[var(--surface-3)]/70 border border-[var(--brand-border)]/30 hover:border-teal-500/20 transition-colors t-caption-sm text-[var(--brand-text-muted)] hover:text-[var(--brand-text)]"
              >
                {q}
              </button>
            ))}
          </div>
          <div className="mt-3 pt-3 border-t border-[var(--brand-border)]/50">
            <p className="t-caption-sm text-[var(--brand-text-faint)] tracking-wider font-medium mb-2">New to SEO? Ask the AI</p>
            <div className="space-y-1">
              {LEARN_SEO_QUESTIONS.slice(0, 3).map((q, i) => (
                <button
                  key={i}
                  onClick={() => { onOpenChat(); setTimeout(() => onAskAi(q), 100); }}
                  className="w-full text-left px-3 py-1.5 rounded-[var(--radius-lg)] hover:bg-emerald-500/5 border border-transparent hover:border-emerald-500/15 transition-colors t-caption-sm text-emerald-400/70 hover:text-emerald-400"
                >
                  💡 {q}
                </button>
              ))}
            </div>
          </div>
        </div>


        {/* Content opportunities preview — revenue moment */}
        {(() => {
          const gaps = strategyData?.contentGaps?.slice(0, 2);
          if (!gaps || gaps.length === 0) return null;
          return ( // pr-check-disable-next-line -- Brand signature radius intentional
            <div className="bg-gradient-to-br from-teal-950/30 via-zinc-900 to-zinc-900 border border-teal-500/15 p-5" style={{ borderRadius: 'var(--radius-signature-lg)' }}>
              <div className="flex items-center gap-2 mb-3">
                <div className="w-6 h-6 rounded-[var(--radius-lg)] bg-teal-500/15 flex items-center justify-center">
                  <Icon as={FileText} size="md" className="text-teal-400" />
                </div>
                <span className="t-caption font-medium text-[var(--brand-text)]">Content Opportunities</span>
              </div>
              <div className="space-y-2">
                {gaps.map((gap, i) => (
                  <div key={i} className="px-3 py-2 rounded-[var(--radius-lg)] bg-[var(--surface-3)]/40 border border-[var(--brand-border)]/60">
                    <div className="t-caption-sm font-medium text-[var(--brand-text)] mb-0.5">{gap.topic}</div>
                    <div className="t-caption-sm text-[var(--brand-text-muted)] line-clamp-1">{gap.rationale}</div>
                  </div>
                ))}
              </div>
              <button
                onClick={() => navigate(clientPath(workspaceId, 'strategy', betaMode))}
                className="mt-2 w-full text-center px-3 py-1.5 rounded-[var(--radius-lg)] bg-teal-600/15 border border-teal-500/20 t-caption-sm text-teal-300 font-medium hover:bg-teal-600/25 transition-colors"
              >
                View all {strategyData?.contentGaps?.length ?? 0} opportunities
              </button>
            </div>
          );
        })()}

        {/* Activity timeline — only real team work, no system/anomaly entries */}
        {(() => {
          const WORK_TYPES = new Set(['audit_completed', 'request_resolved', 'approval_applied', 'seo_updated', 'images_optimized', 'links_fixed', 'content_updated']);
          const workEntries = activityLog.filter(e => WORK_TYPES.has(e.type)).slice(0, 5);
          if (workEntries.length === 0) return null;
          const icons: Record<string, { color: string; label: string }> = {
            audit_completed: { color: '#60a5fa', label: 'Audit' },
            request_resolved: { color: '#34d399', label: 'Done' },
            approval_applied: { color: '#2dd4bf', label: 'Applied' },
            seo_updated: { color: '#fbbf24', label: 'SEO' },
            images_optimized: { color: '#38bdf8', label: 'Media' },
            links_fixed: { color: '#fb923c', label: 'Links' },
            content_updated: { color: '#2dd4bf', label: 'Content' },
          };
          return ( // pr-check-disable-next-line -- Brand signature radius intentional
            <div className="bg-[var(--surface-2)] border border-[var(--brand-border)] p-5" style={{ borderRadius: 'var(--radius-signature-lg)' }}>
              <div className="flex items-center gap-2 mb-3">
                <Icon as={Activity} size="md" className="text-teal-400" />
                <span className="t-caption font-medium text-[var(--brand-text)]">Recent Work</span>
              </div>
              <div className="relative">
                <div className="absolute left-[5px] top-1 bottom-1 w-px bg-[var(--surface-3)]" />
                <div className="space-y-2.5">
                  {workEntries.map(entry => {
                    const cfg = icons[entry.type] || { color: '#94a3b8', label: 'Note' };
                    return (
                      <div key={entry.id} className="flex items-start gap-2.5 pl-0">
                        <div className="w-[11px] h-[11px] rounded-full border-2 flex-shrink-0 mt-1 z-[var(--z-sticky)]" style={{ borderColor: cfg.color, backgroundColor: themeColor('#0f1219', '#f8fafc') }} />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="t-caption-sm font-medium px-1 py-0.5 rounded" style={{ backgroundColor: `${cfg.color}15`, color: cfg.color }}>{cfg.label}</span>
                            <span className="t-caption-sm text-[var(--brand-text-muted)]">{new Date(entry.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                          </div>
                          <div className="t-caption-sm text-[var(--brand-text-muted)] mt-0.5 line-clamp-1">{entry.type === 'audit_completed' && audit ? entry.title.replace(/score \d+/, `score ${audit.siteScore}`) : entry.title}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          );
        })()}
      </div>
    </div>
  </>);
}
