import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Shield, Search, BarChart3, TrendingUp, TrendingDown, ArrowUpRight,
  Loader2, Bell, FileText, AlertTriangle,
  Globe, Clipboard, Flag, Clock, RefreshCw,
} from 'lucide-react';
import { StatCard, SectionCard, PageHeader } from './ui';
import { InsightsEngine } from './client/InsightsEngine';
import { ErrorBoundary } from './ErrorBoundary';
import { usePageEditStates } from '../hooks/usePageEditStates';
import { useAuditSummary } from '../hooks/useAuditSummary';
import { useWorkspaceEvents } from '../hooks/useWorkspaceEvents';
import { AnomalyAlerts } from './AnomalyAlerts';
import { SeoWorkStatus, ActivityFeed, RankingsSnapshot, ActiveRequestsAnnotations, SeoChangeImpact } from './workspace-home';
import { type Page, adminPath } from '../routes';
import { activity as activityApi, workOrders as workOrdersApi, workspaceHome } from '../api/misc';
import { contentRequests as contentRequestsApi } from '../api/content';
import { requests as requestsApi } from '../api/misc';
import { useWorkspaceData } from '../contexts/WorkspaceDataContext';

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
  const { summary: seoStatus } = usePageEditStates(workspaceId);
  const { audit } = useAuditSummary(workspaceId);
  const wsActivity = useWorkspaceData<ActivityEntry[]>('activity');
  const wsAnnotations = useWorkspaceData<Array<{ id: string; date: string; label: string; color?: string }>>('annotations');
  const wsRanks = useWorkspaceData<Array<{ query: string; position: number; previousPosition?: number; change?: number }>>('ranks');
  const wsGscOverview = useWorkspaceData<{ totalClicks: number; totalImpressions: number; avgCtr: number; avgPosition: number }>('gsc-overview');
  const [loading, setLoading] = useState(true);
  const [searchData, setSearchData] = useState<{ totalClicks: number; totalImpressions: number; avgCtr: number; avgPosition: number } | null>(null);
  const [ga4Data, setGa4Data] = useState<{ totalUsers: number; totalSessions: number; totalPageviews: number; newUserPercentage: number } | null>(null);
  const [comparison, setComparison] = useState<{ users?: { current: number; previous: number }; sessions?: { current: number; previous: number } } | null>(null);
  const [ranks, setRanks] = useState<Array<{ query: string; position: number; previousPosition?: number; change?: number }>>([]);
  const [requests, setRequests] = useState<Array<{ id: string; title: string; status: string; category: string; createdAt: string }>>([]);
  const [contentRequests, setContentRequests] = useState<Array<{ id: string; title?: string; status: string; category?: string }>>([]);
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [annotations, setAnnotations] = useState<Array<{ id: string; date: string; label: string; color?: string }>>([]);
  const [churnSignals, setChurnSignals] = useState<Array<{ id: string; type: string; severity: string; title: string; description: string; detectedAt: string }>>([]);
  const [workOrders, setWorkOrders] = useState<Array<{ id: string; status: string; productType: string }>>([]);
  const [lastFetched, setLastFetched] = useState<Date | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [now, setNow] = useState(() => new Date());

  // Tick every 30s so relative timestamps stay fresh
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);

  // Refetch a single key when a real-time event arrives
  const refetch = useCallback(async (key: string) => {
    try {
      if (key === 'activity') { const d = await activityApi.list(workspaceId); if (Array.isArray(d)) setActivity(d as ActivityEntry[]); }
      if (key === 'requests') { const d = await requestsApi.list({ workspaceId }); if (Array.isArray(d)) setRequests(d as typeof requests); }
      if (key === 'content') { const d = await contentRequestsApi.list(workspaceId); if (Array.isArray(d)) setContentRequests(d as typeof contentRequests); }
      if (key === 'workOrders') { const d = await workOrdersApi.list(workspaceId); if (Array.isArray(d)) setWorkOrders(d as typeof workOrders); }
    } catch { /* ignore */ }
  }, [workspaceId]);

  // Real-time workspace events
  useWorkspaceEvents(workspaceId, {
    'activity:new': () => refetch('activity'),
    'approval:update': () => refetch('activity'),
    'approval:applied': () => refetch('activity'),
    'request:created': () => refetch('requests'),
    'request:update': () => refetch('requests'),
    'content-request:created': () => refetch('content'),
    'content-request:update': () => refetch('content'),
    'audit:complete': (data) => {
      const d = data as { score?: number; previousScore?: number };
      if (d?.score != null) {
        refetch('activity');
      }
    },
  });

  // Single aggregated fetch replaces 10+ parallel calls
  useEffect(() => {
    let cancelled = false;
    workspaceHome.get(workspaceId).then(d => {
      if (cancelled) return;
      if (Array.isArray(d.ranks)) setRanks(d.ranks.slice(0, 10) as typeof ranks);
      if (Array.isArray(d.requests)) setRequests(d.requests as typeof requests);
      if (Array.isArray(d.contentRequests)) setContentRequests(d.contentRequests as typeof contentRequests);
      if (Array.isArray(d.activity)) setActivity(d.activity as ActivityEntry[]);
      if (Array.isArray(d.annotations)) setAnnotations(d.annotations.slice(0, 5) as typeof annotations);
      if (Array.isArray(d.churnSignals)) setChurnSignals((d.churnSignals as Array<{ id: string; type: string; severity: string; title: string; description: string; detectedAt: string }>).filter(s => s.severity === 'critical' || s.severity === 'warning'));
      if (Array.isArray(d.workOrders)) setWorkOrders(d.workOrders as typeof workOrders);
      if (d.searchData) setSearchData(d.searchData);
      if (d.ga4Data) setGa4Data(d.ga4Data);
      if (d.comparison) setComparison(d.comparison);
      setLoading(false);
      setLastFetched(new Date());
    }).catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [workspaceId]);

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

  // Action items
  const actions: Array<{ label: string; sub: string; color: 'red' | 'amber' | 'teal' | 'green'; icon: typeof Bell; tab: string }> = [];
  if (newRequests.length > 0) actions.push({ label: `${newRequests.length} new client request${newRequests.length > 1 ? 's' : ''}`, sub: 'Review and respond', color: 'red', icon: Bell, tab: 'requests' });
  if (pendingContent.length > 0) actions.push({ label: `${pendingContent.length} content brief${pendingContent.length > 1 ? 's' : ''} awaiting review`, sub: 'Approve or edit briefs', color: 'amber', icon: FileText, tab: 'seo-briefs' });
  if (audit && audit.errors > 0) actions.push({ label: `${audit.errors} SEO error${audit.errors > 1 ? 's' : ''} found in audit`, sub: `${audit.warnings} warnings · Score ${audit.siteScore}`, color: audit.errors > 5 ? 'red' : 'amber', icon: AlertTriangle, tab: 'seo-audit' });
  if (rankDown > 3) actions.push({ label: `${rankDown} keywords dropped in position`, sub: `${rankUp} improved`, color: 'amber', icon: TrendingDown, tab: 'seo-ranks' });
  if (!webflowSiteId) actions.push({ label: 'No Webflow site linked', sub: 'Link a site to enable SEO tools', color: 'amber', icon: Globe, tab: 'workspace-settings' });
  if (!gscPropertyUrl) actions.push({ label: 'Google Search Console not connected', sub: 'Connect GSC for search data', color: 'amber', icon: Search, tab: 'workspace-settings' });
  if (!ga4PropertyId) actions.push({ label: 'Google Analytics not connected', sub: 'Connect GA4 for traffic data', color: 'amber', icon: BarChart3, tab: 'workspace-settings' });

  // Data freshness
  const ageMs = lastFetched ? now.getTime() - lastFetched.getTime() : 0;
  const isStale = ageMs > 60 * 60 * 1000; // >1 hour
  const freshnessLabel = !lastFetched ? '' : ageMs < 60_000 ? 'Just now' : ageMs < 3_600_000 ? `${Math.floor(ageMs / 60_000)}m ago` : `${Math.floor(ageMs / 3_600_000)}h ago`;

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      const d = await workspaceHome.get(workspaceId);
      if (Array.isArray(d.ranks)) setRanks(d.ranks.slice(0, 10) as typeof ranks);
      if (Array.isArray(d.requests)) setRequests(d.requests as typeof requests);
      if (Array.isArray(d.contentRequests)) setContentRequests(d.contentRequests as typeof contentRequests);
      if (Array.isArray(d.activity)) setActivity(d.activity as ActivityEntry[]);
      if (Array.isArray(d.annotations)) setAnnotations(d.annotations.slice(0, 5) as typeof annotations);
      if (Array.isArray(d.churnSignals)) setChurnSignals((d.churnSignals as Array<{ id: string; type: string; severity: string; title: string; description: string; detectedAt: string }>).filter(s => s.severity === 'critical' || s.severity === 'warning'));
      if (Array.isArray(d.workOrders)) setWorkOrders(d.workOrders as typeof workOrders);
      if (d.searchData) setSearchData(d.searchData);
      if (d.ga4Data) setGa4Data(d.ga4Data);
      if (d.comparison) setComparison(d.comparison);
      setLastFetched(new Date());
    } catch { /* ignore */ }
    setRefreshing(false);
  };

  const pendingOrders = workOrders.filter(o => o.status === 'pending' || o.status === 'in_progress');
  if (pendingOrders.length > 0) actions.push({ label: `${pendingOrders.length} purchased fix${pendingOrders.length > 1 ? 'es' : ''} awaiting fulfillment`, sub: 'Complete work orders from client purchases', color: 'teal', icon: Clipboard, tab: 'workspace-settings' });
  for (const signal of churnSignals) {
    actions.push({
      label: signal.title,
      sub: signal.description,
      color: signal.severity === 'critical' ? 'red' : 'amber',
      icon: Flag,
      tab: 'workspace-settings',
    });
  }

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

      {/* ── Metric Cards ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
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
          />
        ) : (
          <StatCard label="Site Health" value="—" icon={Shield} iconColor="#71717a" sub="No audit yet" onClick={webflowSiteId ? () => navigate(adminPath(workspaceId, 'seo-audit')) : undefined} />
        )}

        {searchData ? (
          <StatCard
            label="Search Clicks"
            value={fmt(searchData.totalClicks)}
            icon={Search}
            iconColor="#22d3ee"
            sub={`${fmt(searchData.totalImpressions)} impr · ${(searchData.avgCtr * 100).toFixed(1)}% CTR`}
            onClick={() => navigate(adminPath(workspaceId, 'search'))}
          />
        ) : (
          <StatCard label="Search Clicks" value="—" icon={Search} iconColor="#71717a" sub={gscPropertyUrl ? 'Loading...' : 'Connect GSC'} />
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
            onClick={() => navigate(adminPath(workspaceId, 'analytics'))}
          />
        ) : (
          <StatCard label="Users" value="—" icon={BarChart3} iconColor="#71717a" sub={ga4PropertyId ? 'Loading...' : 'Connect GA4'} />
        )}

        <StatCard
          label="Rank Changes"
          value={ranks.length > 0 ? `${ranks.length} tracked` : '—'}
          icon={TrendingUp}
          iconColor={rankUp > rankDown ? '#4ade80' : rankDown > rankUp ? '#f87171' : '#71717a'}
          sub={ranks.length > 0 ? `${rankUp} ↑ · ${rankDown} ↓ · ${ranks.length - rankUp - rankDown} =` : 'No keywords tracked'}
          onClick={ranks.length > 0 ? () => navigate(adminPath(workspaceId, 'seo-ranks')) : undefined}
        />
      </div>

      {/* ── Anomaly Alerts ── */}
      <AnomalyAlerts workspaceId={workspaceId} isAdmin={true} />

      {/* ── SEO Work Status ── */}
      <SeoWorkStatus seoStatus={seoStatus} workspaceId={workspaceId} />

      {/* ── SEO Change Impact Tracker ── */}
      <SeoChangeImpact workspaceId={workspaceId} hasGsc={!!gscPropertyUrl} />

      {/* ── Action Items ── */}
      {actions.length > 0 && (
        <SectionCard title="Needs Attention" titleIcon={<AlertTriangle className="w-4 h-4 text-amber-400" />} noPadding>
          <div className="divide-y divide-zinc-800/50">
            {actions.map((item, i) => {
              const Icon = item.icon;
              const colorMap = { red: 'text-red-400', amber: 'text-amber-400', teal: 'text-teal-400', green: 'text-green-400' };
              return (
                <button
                  key={i}
                  onClick={() => navigate(adminPath(workspaceId, item.tab))}
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
          </div>
        </SectionCard>
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
