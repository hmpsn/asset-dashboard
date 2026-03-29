import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  Shield, Search, BarChart3, TrendingUp, TrendingDown, ArrowUpRight,
  Loader2, Bell, FileText, AlertTriangle, ChevronDown,
  Globe, Clipboard, Flag, Clock, RefreshCw, Layers, DollarSign,
} from 'lucide-react';
import { StatCard, SectionCard, PageHeader } from './ui';
import { InsightsEngine } from './client/InsightsEngine';
import { ErrorBoundary } from './ErrorBoundary';
import { usePageEditStates } from '../hooks/usePageEditStates';
import { useAuditSummary } from '../hooks/useAuditSummary';
import { useWorkspaceEvents } from '../hooks/useWorkspaceEvents';
import { AnomalyAlerts } from './AnomalyAlerts';
import { SeoWorkStatus, ActivityFeed, RankingsSnapshot, ActiveRequestsAnnotations, SeoChangeImpact, WeeklyAccomplishments } from './workspace-home';
import { type Page, adminPath } from '../routes';
import { useWorkspaceHomeData, useAdminROI } from '../hooks/admin';

interface WorkspaceHomeProps {
  workspaceId: string;
  workspaceName: string;
  webflowSiteId?: string;
  webflowSiteName?: string;
  gscPropertyUrl?: string;
  ga4PropertyId?: string;
}

interface ActivityEntry {
  id: string;
  type: string;
  title: string;
  description?: string;
  createdAt: string;
}

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export function WorkspaceHome({ workspaceId, workspaceName, webflowSiteId, webflowSiteName, gscPropertyUrl, ga4PropertyId }: WorkspaceHomeProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { summary: seoStatus } = usePageEditStates(workspaceId);
  const { audit } = useAuditSummary(workspaceId);
  const { data: homeData, isLoading: loading, isFetching: refreshing, dataUpdatedAt } = useWorkspaceHomeData(workspaceId);
  const { data: roiData } = useAdminROI(workspaceId);
  const [now, setNow] = useState(() => new Date());
  const [showMoreActions, setShowMoreActions] = useState(false);
  const [showSetupSuggestions, setShowSetupSuggestions] = useState(false);

  // Tick every 30s so relative timestamps stay fresh
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);

  // Real-time workspace events — invalidate the single query
  const invalidateHome = () => queryClient.invalidateQueries({ queryKey: ['admin-workspace-home', workspaceId] });
  useWorkspaceEvents(workspaceId, {
    'activity:new': invalidateHome,
    'approval:update': invalidateHome,
    'approval:applied': invalidateHome,
    'request:created': invalidateHome,
    'request:update': invalidateHome,
    'content-request:created': invalidateHome,
    'content-request:update': invalidateHome,
    'audit:complete': invalidateHome,
  });

  // Derive data from query result
  const d = homeData;
  const searchData = d?.searchData ?? null;
  const ga4Data = d?.ga4Data ?? null;
  const comparison = d?.comparison ?? null;
  const ranks = (Array.isArray(d?.ranks) ? d.ranks.slice(0, 10) : []) as Array<{ query: string; position: number; previousPosition?: number; change?: number }>;
  const requests = (Array.isArray(d?.requests) ? d.requests : []) as Array<{ id: string; title: string; status: string; category: string; createdAt: string }>;
  const contentRequests = (Array.isArray(d?.contentRequests) ? d.contentRequests : []) as Array<{ id: string; title?: string; status: string; category?: string }>;
  const activity = (Array.isArray(d?.activity) ? d.activity : []) as ActivityEntry[];
  const annotations = (Array.isArray(d?.annotations) ? d.annotations.slice(0, 5) : []) as Array<{ id: string; date: string; label: string; color?: string }>;
  const churnSignals = (Array.isArray(d?.churnSignals) ? (d.churnSignals as Array<{ id: string; type: string; severity: string; title: string; description: string; detectedAt: string }>).filter(s => s.severity === 'critical' || s.severity === 'warning') : []);
  const workOrders = (Array.isArray(d?.workOrders) ? d.workOrders : []) as Array<{ id: string; status: string; productType: string }>;
  const contentPipeline = d?.contentPipeline ?? null;
  const contentDecayData = d?.contentDecay ?? null;
  const weeklySummary = d?.weeklySummary ?? null;
  const lastFetched = dataUpdatedAt ? new Date(dataUpdatedAt) : null;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="w-5 h-5 animate-spin text-teal-400" />
      </div>
    );
  }

  // Derived data
  const scoreDelta = audit && audit.previousScore != null ? audit.siteScore - audit.previousScore : null;
  const newRequests = requests.filter(r => r.status === 'new' || r.status === 'open');
  const activeRequests = requests.filter(r => r.status !== 'closed' && r.status !== 'resolved');
  const pendingContent = contentRequests.filter(r => r.status === 'requested');
  const rankUp = ranks.filter(r => r.change && r.change > 0).length;
  const rankDown = ranks.filter(r => r.change && r.change < 0).length;

  const usersDelta = comparison?.users
    ? Math.round(((comparison.users.current - comparison.users.previous) / (comparison.users.previous || 1)) * 100)
    : null;

  // Action items — priority: 1=critical, 2=important, 3=setup suggestions
  type ActionItem = { label: string; sub: string; color: 'red' | 'amber' | 'teal' | 'green'; icon: typeof Bell; tab: string; priority: 1 | 2 | 3; queryString?: string };
  const actions: ActionItem[] = [];
  if (newRequests.length > 0) actions.push({ label: `${newRequests.length} new client request${newRequests.length > 1 ? 's' : ''}`, sub: 'Review and respond', color: 'red', icon: Bell, tab: 'requests', priority: 1 });
  const pendingOrders = workOrders.filter(o => o.status === 'pending' || o.status === 'in_progress');
  if (pendingOrders.length > 0) actions.push({ label: `${pendingOrders.length} purchased fix${pendingOrders.length > 1 ? 'es' : ''} awaiting fulfillment`, sub: 'Complete work orders from client purchases', color: 'teal', icon: Clipboard, tab: 'workspace-settings', priority: 2 });
  for (const signal of churnSignals) {
    actions.push({
      label: signal.title,
      sub: signal.description,
      color: signal.severity === 'critical' ? 'red' : 'amber',
      icon: Flag,
      tab: 'workspace-settings',
      priority: signal.severity === 'critical' ? 1 : 2,
    });
  }
  if (contentDecayData && (contentDecayData.critical > 0 || contentDecayData.warning > 0)) {
    const total = contentDecayData.critical + contentDecayData.warning;
    actions.push({
      label: `${total} page${total > 1 ? 's' : ''} losing search traffic`,
      sub: contentDecayData.critical > 0 ? `${contentDecayData.critical} critical · ${contentDecayData.warning} at risk — refresh content` : `${contentDecayData.warning} pages declining in clicks`,
      color: contentDecayData.critical > 0 ? 'red' : 'amber',
      icon: TrendingDown,
      tab: 'seo-audit',
      queryString: 'sub=content-decay',
      priority: contentDecayData.critical > 0 ? 1 : 2,
    });
  }
  if (pendingContent.length > 0) actions.push({ label: `${pendingContent.length} content brief${pendingContent.length > 1 ? 's' : ''} awaiting review`, sub: 'Approve or edit briefs', color: 'amber', icon: FileText, tab: 'content-pipeline', priority: 2 });
  if (audit && audit.errors > 0) actions.push({ label: `${audit.errors} SEO error${audit.errors > 1 ? 's' : ''} found in audit`, sub: `${audit.warnings} warnings · Score ${audit.siteScore}`, color: audit.errors > 5 ? 'red' : 'amber', icon: AlertTriangle, tab: 'seo-audit', priority: 2 });
  if (rankDown > 3) actions.push({ label: `${rankDown} keywords dropped in position`, sub: `${rankUp} improved`, color: 'amber', icon: TrendingDown, tab: 'seo-ranks', priority: 2 });
  if (contentPipeline && contentPipeline.reviewCells > 0) actions.push({ label: `${contentPipeline.reviewCells} content plan page${contentPipeline.reviewCells > 1 ? 's' : ''} need${contentPipeline.reviewCells === 1 ? 's' : ''} review`, sub: 'Client flagged or awaiting approval', color: 'teal', icon: Layers, tab: 'content-pipeline', priority: 2 });
  if (!webflowSiteId) actions.push({ label: 'No Webflow site linked', sub: 'Link a site to enable SEO tools', color: 'amber', icon: Globe, tab: 'workspace-settings', priority: 3 });
  if (!gscPropertyUrl) actions.push({ label: 'Google Search Console not connected', sub: 'Connect GSC for search data', color: 'amber', icon: Search, tab: 'workspace-settings', priority: 3 });
  if (!ga4PropertyId) actions.push({ label: 'Google Analytics not connected', sub: 'Connect GA4 for traffic data', color: 'amber', icon: BarChart3, tab: 'workspace-settings', priority: 3 });

  // Sort by priority and separate setup items from urgent
  actions.sort((a, b) => a.priority - b.priority);
  const setupActions = actions.filter(a => a.priority === 3);
  const urgentActions = actions.filter(a => a.priority < 3);
  const hasP1 = urgentActions.some(a => a.priority === 1);

  // Data freshness
  const ageMs = lastFetched ? now.getTime() - lastFetched.getTime() : 0;
  const isStale = ageMs > 60 * 60 * 1000; // >1 hour
  const freshnessLabel = !lastFetched ? '' : ageMs < 60_000 ? 'Just now' : ageMs < 3_600_000 ? `${Math.floor(ageMs / 60_000)}m ago` : `${Math.floor(ageMs / 3_600_000)}h ago`;

  const handleRefresh = () => queryClient.invalidateQueries({ queryKey: ['admin-workspace-home', workspaceId] });

  return (
    <div className="space-y-6">
      <PageHeader
        title={workspaceName}
        subtitle={webflowSiteName || 'Workspace Dashboard'}
        icon={<Globe className="w-5 h-5 text-teal-400" />}
        actions={
          <div className="flex items-center gap-3">
            {lastFetched && (
              <span className={`flex items-center gap-1 text-[11px] ${isStale ? 'text-amber-400' : 'text-zinc-500'}`} title={`Data loaded at ${lastFetched.toLocaleTimeString()}`}>
                <Clock className="w-3 h-3" />
                {isStale ? 'Stale — ' : ''}{freshnessLabel}
              </span>
            )}
            <button
              onClick={handleRefresh}
              disabled={refreshing}
              className="flex items-center gap-1 text-[11px] text-zinc-500 hover:text-teal-400 transition-colors disabled:opacity-50"
              title="Refresh all data"
            >
              <RefreshCw className={`w-3 h-3 ${refreshing ? 'animate-spin' : ''}`} />
              Refresh
            </button>
            <button
              onClick={() => navigate(adminPath(workspaceId, 'workspace-settings'))}
              className="text-[11px] text-zinc-500 hover:text-zinc-300 transition-colors"
            >
              Settings →
            </button>
          </div>
        }
      />

      {/* ── Weekly Accomplishments ── */}
      {weeklySummary && <WeeklyAccomplishments summary={weeklySummary} />}

      {/* ── Metric Cards ── */}
      <div className={`grid grid-cols-2 ${contentPipeline && contentPipeline.totalCells > 0 ? 'lg:grid-cols-5' : 'lg:grid-cols-4'} gap-3`}>
        {audit ? (
          <StatCard
            label="Site Health"
            value={audit.siteScore}
            icon={Shield}
            iconColor={audit.siteScore >= 80 ? '#4ade80' : audit.siteScore >= 60 ? '#fbbf24' : '#f87171'}
            delta={scoreDelta ?? undefined}
            deltaLabel=" pts"
            sub={`${audit.errors} errors · ${audit.warnings} warnings`}
            onClick={() => navigate(adminPath(workspaceId, 'seo-audit'))}
            size="hero"
          />
        ) : (
          <StatCard label="Site Health" value="—" icon={Shield} iconColor="#71717a" sub="No audit yet" onClick={webflowSiteId ? () => navigate(adminPath(workspaceId, 'seo-audit')) : undefined} size="hero" />
        )}

        {searchData ? (
          <StatCard
            label="Search Clicks"
            value={fmt(searchData.totalClicks)}
            icon={Search}
            iconColor="#22d3ee"
            sub={`${fmt(searchData.totalImpressions)} impr · ${(searchData.avgCtr * 100).toFixed(1)}% CTR`}
            onClick={() => navigate(adminPath(workspaceId, 'analytics-hub'))}
            size="hero"
          />
        ) : (
          <StatCard label="Search Clicks" value="—" icon={Search} iconColor="#71717a" sub={gscPropertyUrl ? 'Loading...' : 'Connect GSC'} size="hero" />
        )}

        {ga4Data ? (
          <StatCard
            label="Users"
            value={fmt(ga4Data.totalUsers)}
            icon={BarChart3}
            iconColor="#a78bfa"
            delta={usersDelta ?? undefined}
            deltaLabel="%"
            sub={`${fmt(ga4Data.totalSessions)} sessions · ${ga4Data.newUserPercentage}% new`}
            onClick={() => navigate(adminPath(workspaceId, 'analytics-hub'))}
            size="hero"
          />
        ) : (
          <StatCard label="Users" value="—" icon={BarChart3} iconColor="#71717a" sub={ga4PropertyId ? 'Loading...' : 'Connect GA4'} size="hero" />
        )}

        <StatCard
          label="Rank Changes"
          value={ranks.length > 0 ? `${ranks.length} tracked` : '—'}
          icon={TrendingUp}
          iconColor={rankUp > rankDown ? '#4ade80' : rankDown > rankUp ? '#f87171' : '#71717a'}
          sub={ranks.length > 0 ? `${rankUp} ↑ · ${rankDown} ↓ · ${ranks.length - rankUp - rankDown} =` : 'No keywords tracked'}
          onClick={ranks.length > 0 ? () => navigate(adminPath(workspaceId, 'seo-ranks')) : undefined}
          size="hero"
        />

        {roiData && (
          <StatCard
            label="Traffic Value"
            value={`$${fmt(roiData.organicTrafficValue)}`}
            icon={DollarSign}
            iconColor="#22c55e"
            sub={`≈ $${fmt(roiData.adSpendEquivalent)} ad spend`}
            onClick={() => navigate(`/client/${workspaceId}/roi`)}
            size="hero"
          />
        )}

        {contentDecayData && contentDecayData.totalDecaying > 0 && (
          <StatCard
            label="Content Decay"
            value={contentDecayData.totalDecaying}
            icon={TrendingDown}
            iconColor={contentDecayData.critical > 0 ? '#f87171' : '#fbbf24'}
            sub={contentDecayData.critical > 0 ? `${contentDecayData.critical} critical · ${contentDecayData.warning} at risk` : `${contentDecayData.warning} pages declining`}
            onClick={() => navigate(`${adminPath(workspaceId, 'seo-audit')}?sub=content-decay`)}
            size="hero"
          />
        )}

        {contentPipeline && contentPipeline.totalCells > 0 && (() => {
          const pct = Math.round((contentPipeline.publishedCells / contentPipeline.totalCells) * 100);
          return (
            <StatCard
              label="Content Pipeline"
              value={`${pct}%`}
              icon={Layers}
              iconColor="#71717a"
              sub={`${contentPipeline.publishedCells}/${contentPipeline.totalCells} published`}
              onClick={() => navigate(adminPath(workspaceId, 'content'))}
              size="hero"
            />
          );
        })()}
      </div>

      {/* ── Needs Attention ── */}
      {(urgentActions.length > 0 || setupActions.length > 0) && (() => {
        const colorMap = { red: 'text-red-400', amber: 'text-amber-400', teal: 'text-teal-400', green: 'text-green-400' };
        const visibleUrgent = showMoreActions ? urgentActions : urgentActions.slice(0, 5);
        const hiddenCount = urgentActions.length - visibleUrgent.length;
        return (
          <SectionCard title="Needs Attention" titleIcon={<AlertTriangle className="w-4 h-4 text-amber-400" />} noPadding>
            <div className="divide-y divide-zinc-800/50">
              {visibleUrgent.map((item, i) => {
                const Icon = item.icon;
                return (
                  <button
                    key={i}
                    onClick={() => navigate(adminPath(workspaceId, item.tab as Page) + (item.queryString ? `?${item.queryString}` : ''))}
                    className="w-full flex items-center gap-3 px-4 py-3 hover:bg-zinc-800/30 transition-colors text-left"
                  >
                    <Icon className={`w-4 h-4 flex-shrink-0 ${colorMap[item.color]}`} />
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-medium text-zinc-200">{item.label}</div>
                      <div className="text-[11px] text-zinc-500 mt-0.5">{item.sub}</div>
                    </div>
                    <ArrowUpRight className="w-3.5 h-3.5 text-zinc-600 flex-shrink-0" />
                  </button>
                );
              })}
              {hiddenCount > 0 && (
                <button
                  onClick={() => setShowMoreActions(true)}
                  className="w-full flex items-center gap-2 px-4 py-2.5 hover:bg-zinc-800/30 transition-colors text-left"
                >
                  <ChevronDown className="w-3.5 h-3.5 text-zinc-600" />
                  <span className="text-[11px] text-zinc-500">{hiddenCount} more item{hiddenCount > 1 ? 's' : ''}</span>
                </button>
              )}
              {setupActions.length > 0 && !hasP1 && (
                <>
                  <button
                    onClick={() => setShowSetupSuggestions(s => !s)}
                    className="w-full flex items-center gap-2 px-4 py-2.5 hover:bg-zinc-800/30 transition-colors text-left"
                  >
                    <ChevronDown className={`w-3.5 h-3.5 text-zinc-600 transition-transform ${showSetupSuggestions ? 'rotate-180' : ''}`} />
                    <span className="text-[11px] text-zinc-500">{setupActions.length} setup suggestion{setupActions.length > 1 ? 's' : ''}</span>
                  </button>
                  {showSetupSuggestions && setupActions.map((item, i) => {
                    const Icon = item.icon;
                    return (
                      <button
                        key={`setup-${i}`}
                        onClick={() => navigate(adminPath(workspaceId, item.tab as Page) + (item.queryString ? `?${item.queryString}` : ''))}
                        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-zinc-800/30 transition-colors text-left opacity-60"
                      >
                        <Icon className={`w-4 h-4 flex-shrink-0 ${colorMap[item.color]}`} />
                        <div className="flex-1 min-w-0">
                          <div className="text-xs font-medium text-zinc-200">{item.label}</div>
                          <div className="text-[11px] text-zinc-500 mt-0.5">{item.sub}</div>
                        </div>
                        <ArrowUpRight className="w-3.5 h-3.5 text-zinc-600 flex-shrink-0" />
                      </button>
                    );
                  })}
                </>
              )}
            </div>
          </SectionCard>
        );
      })()}

      {/* ── Anomaly Alerts ── */}
      <AnomalyAlerts workspaceId={workspaceId} isAdmin={true} />

      {/* ── SEO Pipeline (Work Status + Change Tracker) ── */}
      {seoStatus.total > 0 ? (
        <SectionCard title="SEO Pipeline" titleIcon={<Layers className="w-4 h-4 text-teal-400" />} noPadding>
          <SeoWorkStatus seoStatus={seoStatus} workspaceId={workspaceId} embedded />
          <SeoChangeImpact workspaceId={workspaceId} hasGsc={!!gscPropertyUrl} embedded />
        </SectionCard>
      ) : (
        <SeoChangeImpact workspaceId={workspaceId} hasGsc={!!gscPropertyUrl} />
      )}

      {/* ── Action Plan (InsightsEngine) ── */}
      {workspaceId && (
        <ErrorBoundary label="Action Plan">
          <InsightsEngine workspaceId={workspaceId} tier="premium" compact onNavigate={(tab) => navigate(adminPath(workspaceId, tab as Page))} />
        </ErrorBoundary>
      )}

      {/* ── Two-column: Activity + Rankings ── */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        <ActivityFeed activity={activity} className="lg:col-span-3" />
        <RankingsSnapshot ranks={ranks} gscPropertyUrl={gscPropertyUrl} workspaceId={workspaceId} className="lg:col-span-2" />
      </div>

      {/* ── Active Requests + Annotations ── */}
      <ActiveRequestsAnnotations requests={activeRequests} annotations={annotations} workspaceId={workspaceId} />

    </div>
  );
}
