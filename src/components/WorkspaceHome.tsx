import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Shield, Search, BarChart3, TrendingUp, TrendingDown, ArrowUpRight,
  Loader2, Bell, FileText, AlertTriangle,
  Globe, Clipboard, Flag,
} from 'lucide-react';
import { StatCard, SectionCard, PageHeader } from './ui';
import { InsightsEngine } from './client/InsightsEngine';
import { ErrorBoundary } from './ErrorBoundary';
import { usePageEditStates } from '../hooks/usePageEditStates';
import { useAuditSummary } from '../hooks/useAuditSummary';
import { useWorkspaceEvents } from '../hooks/useWorkspaceEvents';
import { AnomalyAlerts } from './AnomalyAlerts';
import { SeoWorkStatus, ActivityFeed, RankingsSnapshot, ActiveRequestsAnnotations, SeoChangeImpact } from './workspace-home';
import { adminPath } from '../routes';

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

  // Refetch a single key when a real-time event arrives
  const refetch = useCallback(async (key: string, url: string) => {
    try {
      const r = await fetch(url);
      if (!r.ok) return;
      const d = await r.json();
      if (key === 'activity' && Array.isArray(d)) setActivity(d);
      if (key === 'requests' && Array.isArray(d)) setRequests(d);
      if (key === 'content' && Array.isArray(d)) setContentRequests(d);
      if (key === 'workOrders' && Array.isArray(d)) setWorkOrders(d);
    } catch { /* ignore */ }
  }, []);

  // Real-time workspace events
  useWorkspaceEvents(workspaceId, {
    'activity:new': () => refetch('activity', `/api/activity?workspaceId=${workspaceId}&limit=8`),
    'approval:update': () => refetch('activity', `/api/activity?workspaceId=${workspaceId}&limit=8`),
    'approval:applied': () => refetch('activity', `/api/activity?workspaceId=${workspaceId}&limit=8`),
    'request:created': () => refetch('requests', `/api/requests?workspaceId=${workspaceId}`),
    'request:update': () => refetch('requests', `/api/requests?workspaceId=${workspaceId}`),
    'content-request:created': () => refetch('content', `/api/content-requests/${workspaceId}`),
    'content-request:update': () => refetch('content', `/api/content-requests/${workspaceId}`),
    'audit:complete': (data) => {
      const d = data as { score?: number; previousScore?: number };
      if (d?.score != null) {
        // Audit hook will refresh on next render, just trigger activity refresh
        refetch('activity', `/api/activity?workspaceId=${workspaceId}&limit=8`);
      }
    },
  });

  useEffect(() => {
    let cancelled = false;
    const days = 28;
    const qs = `?days=${days}`;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const f = async (url: string): Promise<any> => {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 15000);
        const r = await fetch(url, { signal: controller.signal });
        clearTimeout(timer);
        if (!r.ok) return null;
        return r.json();
      } catch { return null; }
    };

    const urls: Array<{ key: string; url: string }> = [
      { key: 'ranks', url: `/api/rank-tracking/${workspaceId}/latest` },
      { key: 'requests', url: `/api/requests?workspaceId=${workspaceId}` },
      { key: 'content', url: `/api/content-requests/${workspaceId}` },
      { key: 'activity', url: `/api/activity?workspaceId=${workspaceId}&limit=8` },
      { key: 'annotations', url: `/api/annotations/${workspaceId}` },
      { key: 'churn', url: `/api/churn-signals/${workspaceId}` },
      { key: 'workOrders', url: `/api/work-orders/${workspaceId}` },
    ];
    if (gscPropertyUrl) urls.push({ key: 'search', url: `/api/public/search-overview/${workspaceId}${qs}` });
    if (ga4PropertyId) {
      urls.push({ key: 'ga4', url: `/api/public/analytics-overview/${workspaceId}${qs}` });
      urls.push({ key: 'comparison', url: `/api/public/analytics-comparison/${workspaceId}${qs}` });
    }

    Promise.all(urls.map(({ key, url }) => f(url).then(d => ({ key, d })))).then(results => {
      if (cancelled) return;
      for (const { key, d } of results) {
        if (!d) continue;
        if (key === 'search' && d.totalClicks !== undefined) setSearchData({ totalClicks: d.totalClicks, totalImpressions: d.totalImpressions, avgCtr: d.avgCtr, avgPosition: d.avgPosition });
        if (key === 'ga4' && d.totalUsers !== undefined) setGa4Data(d);
        if (key === 'comparison' && !d.error) setComparison(d);
        if (key === 'ranks' && Array.isArray(d)) setRanks(d.slice(0, 10));
        if (key === 'requests' && Array.isArray(d)) setRequests(d);
        if (key === 'content' && Array.isArray(d)) setContentRequests(d);
        if (key === 'activity' && Array.isArray(d)) setActivity(d);
        if (key === 'annotations' && Array.isArray(d)) setAnnotations(d.slice(0, 5));
        if (key === 'churn' && Array.isArray(d)) setChurnSignals(d.filter((s: { severity: string }) => s.severity === 'critical' || s.severity === 'warning'));
        if (key === 'workOrders' && Array.isArray(d)) setWorkOrders(d);
      }
      setLoading(false);
    }).catch(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [workspaceId, gscPropertyUrl, ga4PropertyId]);

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
          <button
            onClick={() => navigate(adminPath(workspaceId, 'workspace-settings'))}
            className="text-[11px] text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            Settings →
          </button>
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
          <InsightsEngine workspaceId={workspaceId} tier="premium" compact />
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
