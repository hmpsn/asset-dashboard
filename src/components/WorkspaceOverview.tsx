import { useState, useEffect, useCallback } from 'react';
import { useWebSocket } from '../hooks/useWebSocket';
import {
  Globe, Shield, MessageSquare, ClipboardCheck, AlertTriangle,
  CheckCircle2, ArrowUpRight, ArrowDownRight, Minus, Loader2,
  Search, BarChart3, Lock, ExternalLink, Bell, Activity, FileText, Zap,
  Map, Rocket, FileSearch,
  TrendingDown,
} from 'lucide-react';
import { MetricRingSvg, PageHeader, SectionCard, Badge, StatCard } from './ui';

interface ActivityEntry {
  id: string;
  workspaceId: string;
  type: string;
  title: string;
  description?: string;
  createdAt: string;
}

interface WorkspaceSummary {
  id: string;
  name: string;
  webflowSiteId: string | null;
  webflowSiteName: string | null;
  hasGsc: boolean;
  hasGa4: boolean;
  hasPassword: boolean;
  audit: {
    score: number;
    totalPages: number;
    errors: number;
    warnings: number;
    previousScore?: number;
    lastAuditDate?: string;
  } | null;
  requests: { total: number; new: number; active: number; latestDate: string | null };
  approvals: { pending: number; total: number };
  contentRequests?: { pending: number; inProgress: number; delivered: number; total: number };
  workOrders?: { pending: number; total: number };
  pageStates?: { issueDetected: number; inReview: number; approved: number; rejected: number; live: number; total: number };
  tier?: 'free' | 'growth' | 'premium';
  isTrial?: boolean;
  trialDaysRemaining?: number;
}


interface AnomalySummary {
  id: string;
  workspaceId: string;
  workspaceName: string;
  severity: 'critical' | 'warning' | 'positive';
  title: string;
  acknowledgedAt?: string;
  dismissedAt?: string;
}

// ScoreRing replaced by unified <MetricRingSvg /> from ./ui
const ScoreRing = MetricRingSvg;


function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function WorkspaceOverview({ onSelectWorkspace, onNavigate }: { onSelectWorkspace: (id: string) => void; onNavigate?: (tab: string) => void }) {
  const [data, setData] = useState<WorkspaceSummary[]>([]);
  const [recentActivity, setRecentActivity] = useState<ActivityEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [anomalies, setAnomalies] = useState<AnomalySummary[]>([]);
  const [presence, setPresence] = useState<Record<string, Array<{ userId: string; email: string; name?: string; role: string; connectedAt: string; lastSeen: string }>>>({});

  type PresenceMap = typeof presence;
  // Real-time presence updates via WebSocket
  const handlePresenceUpdate = useCallback((d: unknown) => {
    if (d && typeof d === 'object') setPresence(d as PresenceMap);
  }, []);
  useWebSocket({ 'presence:update': handlePresenceUpdate });

  useEffect(() => {
    Promise.all([
      fetch('/api/workspace-overview').then(r => r.json()),
      fetch('/api/activity?limit=15').then(r => r.json()).catch(() => []),
      fetch('/api/anomalies').then(r => r.ok ? r.json() : []).catch(() => []),
      fetch('/api/presence').then(r => r.ok ? r.json() : {}).catch(() => ({})),
    ]).then(([d, act, anom, pres]) => {
      if (Array.isArray(d)) setData(d);
      if (Array.isArray(act)) setRecentActivity(act);
      if (Array.isArray(anom)) setAnomalies(anom.filter((a: AnomalySummary) => !a.dismissedAt));
      if (pres && typeof pres === 'object') setPresence(pres as PresenceMap);
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-5 h-5 animate-spin text-teal-400" />
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-6">
        <img src="/logo.svg" alt="hmpsn.studio" className="h-10 opacity-40" />
        <div className="text-center max-w-sm">
          <p className="text-base font-semibold mb-1 text-zinc-200">Welcome to hmpsn studio</p>
          <p className="text-xs leading-relaxed text-zinc-500">Create a workspace to get started.</p>
        </div>
      </div>
    );
  }

  // Summary stats across all workspaces
  const totalNewRequests = data.reduce((s, w) => s + w.requests.new, 0);
  const totalActiveRequests = data.reduce((s, w) => s + w.requests.active, 0);
  const totalPendingApprovals = data.reduce((s, w) => s + w.approvals.pending, 0);
  const totalPendingContent = data.reduce((s, w) => s + (w.contentRequests?.pending || 0), 0);
  const totalInProgressContent = data.reduce((s, w) => s + (w.contentRequests?.inProgress || 0), 0);
  const totalDeliveredContent = data.reduce((s, w) => s + (w.contentRequests?.delivered || 0), 0);
  const totalPendingWorkOrders = data.reduce((s, w) => s + (w.workOrders?.pending || 0), 0);
  const avgScore = data.filter(w => w.audit).length > 0
    ? Math.round(data.filter(w => w.audit).reduce((s, w) => s + (w.audit?.score || 0), 0) / data.filter(w => w.audit).length)
    : null;

  // Anomaly aggregation across workspaces
  const criticalAnomalies = anomalies.filter(a => a.severity === 'critical');
  const warningAnomalies = anomalies.filter(a => a.severity === 'warning');
  const anomalyByWorkspace: Record<string, { critical: number; warning: number; positive: number }> = {};
  anomalies.forEach(a => {
    if (!anomalyByWorkspace[a.workspaceId]) anomalyByWorkspace[a.workspaceId] = { critical: 0, warning: 0, positive: 0 };
    anomalyByWorkspace[a.workspaceId][a.severity]++;
  });

  // Needs attention items — priority sorted (critical first)
  const attentionItems: Array<{ label: string; value: string; color: string; icon: typeof Bell; priority: number }> = [];
  if (criticalAnomalies.length > 0) attentionItems.push({ label: `${criticalAnomalies.length} critical anomal${criticalAnomalies.length > 1 ? 'ies' : 'y'} across ${new Set(criticalAnomalies.map(a => a.workspaceId)).size} workspace${new Set(criticalAnomalies.map(a => a.workspaceId)).size > 1 ? 's' : ''}`, value: 'Anomalies', color: 'text-red-400', icon: TrendingDown, priority: 0 });
  if (warningAnomalies.length > 0) attentionItems.push({ label: `${warningAnomalies.length} warning anomal${warningAnomalies.length > 1 ? 'ies' : 'y'} detected`, value: 'Anomalies', color: 'text-amber-400', icon: TrendingDown, priority: 1 });
  if (totalNewRequests > 0) attentionItems.push({ label: `${totalNewRequests} new client request${totalNewRequests > 1 ? 's' : ''}`, value: 'Requests', color: 'text-red-400', icon: Bell, priority: 2 });
  if (totalPendingApprovals > 0) attentionItems.push({ label: `${totalPendingApprovals} pending approval${totalPendingApprovals > 1 ? 's' : ''}`, value: 'Approvals', color: 'text-teal-400', icon: ClipboardCheck, priority: 3 });
  if (totalPendingContent > 0) attentionItems.push({ label: `${totalPendingContent} content brief${totalPendingContent > 1 ? 's' : ''} awaiting review`, value: 'Content', color: 'text-amber-400', icon: FileText, priority: 4 });
  if (totalPendingWorkOrders > 0) attentionItems.push({ label: `${totalPendingWorkOrders} purchased fix${totalPendingWorkOrders > 1 ? 'es' : ''} awaiting fulfillment`, value: 'Work Orders', color: 'text-teal-400', icon: ClipboardCheck, priority: 5 });
  const rejectedWorkspaces = data.filter(w => (w.pageStates?.rejected || 0) > 0);
  const totalRejected = rejectedWorkspaces.reduce((s, w) => s + (w.pageStates?.rejected || 0), 0);
  if (totalRejected > 0) attentionItems.push({ label: `${totalRejected} rejected change${totalRejected > 1 ? 's' : ''} need revision`, value: 'Rejected', color: 'text-red-400', icon: AlertTriangle, priority: 6 });
  const lowScoreWorkspaces = data.filter(w => w.audit && w.audit.score < 60);
  if (lowScoreWorkspaces.length > 0) attentionItems.push({ label: `${lowScoreWorkspaces.length} workspace${lowScoreWorkspaces.length > 1 ? 's' : ''} with health score below 60`, value: 'Health', color: 'text-red-400', icon: AlertTriangle, priority: 7 });
  const unlinkWorkspaces = data.filter(w => !w.webflowSiteId);
  if (unlinkWorkspaces.length > 0) attentionItems.push({ label: `${unlinkWorkspaces.length} workspace${unlinkWorkspaces.length > 1 ? 's' : ''} with no site linked`, value: 'Setup', color: 'text-amber-400', icon: Globe, priority: 8 });
  attentionItems.sort((a, b) => a.priority - b.priority);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Command Center"
        subtitle={`${data.length} workspace${data.length !== 1 ? 's' : ''} · ${new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}`}
        icon={<Rocket className="w-5 h-5 text-teal-400" />}
        actions={onNavigate && (
          <div className="flex items-center gap-2">
            <button onClick={() => onNavigate('prospect')} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-zinc-400 hover:text-zinc-200 bg-zinc-800/50 hover:bg-zinc-800 border border-zinc-800 transition-all">
              <FileSearch className="w-3.5 h-3.5" /> Prospect
            </button>
            <button onClick={() => onNavigate('roadmap')} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-zinc-400 hover:text-zinc-200 bg-zinc-800/50 hover:bg-zinc-800 border border-zinc-800 transition-all">
              <Map className="w-3.5 h-3.5" /> Roadmap
            </button>
          </div>
        )}
      />

      {/* ── Needs Attention ── */}
      {attentionItems.length > 0 && (
        <SectionCard title="Needs Attention" titleIcon={<AlertTriangle className="w-4 h-4 text-amber-400" />} noPadding>
          <div className="divide-y divide-zinc-800/50">
            {attentionItems.map((item, i) => {
              const Icon = item.icon;
              return (
                <div key={i} className="flex items-center gap-3 px-4 py-2.5">
                  <Icon className={`w-3.5 h-3.5 flex-shrink-0 ${item.color}`} />
                  <span className="text-xs text-zinc-200 flex-1">{item.label}</span>
                  <Badge label={item.value} color="zinc" />
                </div>
              );
            })}
          </div>
        </SectionCard>
      )}

      {/* ── Global Stats ── */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <StatCard label="New Requests" value={totalNewRequests} icon={Bell} iconColor={totalNewRequests > 0 ? '#f87171' : '#71717a'} />
        <StatCard label="Active Requests" value={totalActiveRequests} icon={MessageSquare} iconColor={totalActiveRequests > 0 ? '#fbbf24' : '#71717a'} />
        <StatCard label="Content Pipeline" value={`${totalPendingContent + totalInProgressContent}/${totalDeliveredContent}`} icon={FileText} iconColor={totalPendingContent > 0 ? '#f59e0b' : totalInProgressContent > 0 ? '#60a5fa' : '#71717a'} />
        <StatCard label="Approvals" value={totalPendingApprovals} icon={ClipboardCheck} iconColor={totalPendingApprovals > 0 ? '#2dd4bf' : '#71717a'} />
        <StatCard label="Avg Health" value={avgScore !== null ? avgScore : '—'} icon={Shield} iconColor={avgScore !== null ? (avgScore >= 80 ? '#4ade80' : avgScore >= 60 ? '#fbbf24' : '#f87171') : '#71717a'} />
      </div>

      {/* ── Online Now ── */}
      {(() => {
        const totalOnline = Object.values(presence).flat().length;
        const wsNames: Record<string, string> = {};
        data.forEach(w => { wsNames[w.id] = w.name; });
        if (totalOnline === 0) return null;
        return (
          <SectionCard
            title={`Online Now · ${totalOnline}`}
            titleIcon={
              <span className="relative flex h-3 w-3">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-3 w-3 bg-green-500" />
              </span>
            }
            noPadding
          >
            <div className="divide-y divide-zinc-800/50">
              {Object.entries(presence).map(([wsId, users]) =>
                users.map(u => (
                  <div key={`${wsId}-${u.userId}`} className="flex items-center gap-3 px-4 py-2.5">
                    <div className="flex items-center justify-center w-7 h-7 rounded-full bg-green-500/15 text-green-400 text-xs font-bold flex-shrink-0">
                      {(u.name || u.email)[0].toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <span className="text-xs font-medium text-zinc-200">{u.name || u.email.split('@')[0]}</span>
                      <span className="text-[10px] text-zinc-500 ml-2">{u.email}</span>
                    </div>
                    <span className="text-[10px] text-zinc-500 flex-shrink-0">{wsNames[wsId] || wsId}</span>
                    <Badge label={u.role === 'admin' ? 'Admin' : 'Client'} color={u.role === 'admin' ? 'blue' : 'green'} />
                  </div>
                ))
              )}
            </div>
          </SectionCard>
        );
      })()}

      {/* ── Workspace Cards ── */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <Globe className="w-4 h-4 text-zinc-500" />
          <h2 className="text-sm font-semibold text-zinc-200">Workspaces</h2>
        </div>
        <div className="space-y-3">
          {data.map(ws => {
            const hasAlerts = ws.requests.new > 0 || ws.approvals.pending > 0 || (ws.contentRequests?.pending || 0) > 0;
            const scoreDelta = ws.audit && ws.audit.previousScore != null ? ws.audit.score - ws.audit.previousScore : null;
            const wsAnomalies = anomalyByWorkspace[ws.id];
            const hasAnomalies = wsAnomalies && (wsAnomalies.critical > 0 || wsAnomalies.warning > 0);
            const onlineUsers = presence[ws.id] || [];

            return (
              <button
                key={ws.id}
                onClick={() => onSelectWorkspace(ws.id)}
                className={`w-full text-left rounded-xl p-5 transition-all hover:scale-[1.005] hover:shadow-lg group relative bg-zinc-900 border ${onlineUsers.length > 0 ? 'border-green-500/40' : hasAnomalies && wsAnomalies?.critical ? 'border-red-500/30' : hasAlerts ? 'border-amber-500/30' : 'border-zinc-800'}`}
              >
                {/* New request badge */}
                {ws.requests.new > 0 && (
                  <div className="absolute -top-2 -right-2 flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-red-500 text-white shadow-lg">
                    <Bell className="w-2.5 h-2.5" /> {ws.requests.new} new
                  </div>
                )}

                {/* Online users banner */}
                {onlineUsers.length > 0 && (
                  <div className="flex items-center gap-2 px-3 py-1.5 -mx-5 -mt-5 mb-3 rounded-t-xl bg-green-500/10 border-b border-green-500/20">
                    <span className="relative flex h-2.5 w-2.5">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                      <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-500" />
                    </span>
                    <span className="text-[11px] font-semibold text-green-400">
                      {onlineUsers.map(u => u.name || u.email.split('@')[0]).join(', ')} online now
                    </span>
                  </div>
                )}

                {/* Top row: name + badges + site info */}
                <div className="flex items-center justify-between gap-3 mb-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <h3 className="text-sm font-semibold truncate group-hover:text-teal-400 transition-colors text-zinc-200">{ws.name}</h3>
                    {hasAnomalies && (
                      <span className={`flex-shrink-0 flex items-center gap-1 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider rounded-md border ${
                        wsAnomalies.critical > 0
                          ? 'bg-red-500/15 text-red-400 border-red-500/20'
                          : 'bg-amber-500/15 text-amber-400 border-amber-500/20'
                      }`}>
                        <TrendingDown className="w-2.5 h-2.5" />
                        {wsAnomalies.critical > 0 ? `${wsAnomalies.critical} critical` : `${wsAnomalies.warning} warning`}
                      </span>
                    )}
                    {ws.isTrial && (
                      <span className="flex-shrink-0 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider rounded-md bg-amber-500/15 text-amber-400 border border-amber-500/20">
                        Trial{ws.trialDaysRemaining != null ? ` · ${ws.trialDaysRemaining}d` : ''}
                      </span>
                    )}
                    {ws.tier && ws.tier !== 'free' && !ws.isTrial && (
                      <span className="flex-shrink-0 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider rounded-md border bg-teal-500/15 text-teal-400 border-teal-500/20">{ws.tier}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 text-[11px] text-zinc-500 flex-shrink-0">
                    {ws.webflowSiteName && <span className="flex items-center gap-1"><Globe className="w-2.5 h-2.5" />{ws.webflowSiteName}</span>}
                    {!ws.webflowSiteId && <span className="flex items-center gap-1 text-amber-400"><AlertTriangle className="w-2.5 h-2.5" />No site linked</span>}
                    {ws.hasGsc && <span className="flex items-center gap-1"><Search className="w-2.5 h-2.5" />GSC</span>}
                    {ws.hasGa4 && <span className="flex items-center gap-1"><BarChart3 className="w-2.5 h-2.5" />GA4</span>}
                    {ws.hasPassword && <span className="flex items-center gap-1"><Lock className="w-2.5 h-2.5" />Client</span>}
                    <ExternalLink className="w-3.5 h-3.5 shrink-0 opacity-0 group-hover:opacity-60 transition-opacity" />
                  </div>
                </div>

                {/* Metrics row — single horizontal strip */}
                <div className="flex items-center gap-6 flex-wrap">
                  {/* Audit score */}
                  <div className="flex items-center gap-2.5">
                    {ws.audit ? (
                      <>
                        <ScoreRing score={ws.audit.score} size={40} strokeWidth={3.5} />
                        <div>
                          <div className="flex items-center gap-1.5">
                            <span className="text-[11px] font-medium text-zinc-400">Health</span>
                            {scoreDelta !== null && scoreDelta !== 0 && (
                              <span className={`flex items-center text-[11px] font-medium ${scoreDelta > 0 ? 'text-green-400' : 'text-red-400'}`}>
                                {scoreDelta > 0 ? <ArrowUpRight className="w-2.5 h-2.5" /> : <ArrowDownRight className="w-2.5 h-2.5" />}
                                {Math.abs(scoreDelta)}
                              </span>
                            )}
                            {scoreDelta === 0 && <Minus className="w-2.5 h-2.5 text-zinc-500" />}
                          </div>
                          <div className="text-[11px] text-zinc-500">
                            {ws.audit.errors > 0 && <span className="text-red-400">{ws.audit.errors} err</span>}
                            {ws.audit.errors > 0 && ws.audit.warnings > 0 && ' · '}
                            {ws.audit.warnings > 0 && <span className="text-amber-400">{ws.audit.warnings} warn</span>}
                          </div>
                        </div>
                      </>
                    ) : (
                      <span className="text-[11px] text-zinc-500">No audit</span>
                    )}
                  </div>

                  <div className="w-px h-8 bg-zinc-800" />

                  {/* Requests */}
                  <div>
                    <div className="text-[11px] font-medium text-zinc-500 mb-0.5">Requests</div>
                    {ws.requests.total > 0 ? (
                      <div className="flex items-center gap-2 text-[11px]">
                        {ws.requests.new > 0 && <span className="text-red-400 font-medium">{ws.requests.new} new</span>}
                        {ws.requests.active > 0 && <span className="text-teal-400">{ws.requests.active} active</span>}
                        {ws.requests.latestDate && <span className="text-zinc-500">{timeAgo(ws.requests.latestDate)}</span>}
                      </div>
                    ) : (
                      <div className="text-[11px] text-zinc-500">None</div>
                    )}
                  </div>

                  <div className="w-px h-8 bg-zinc-800" />

                  {/* Approvals */}
                  <div>
                    <div className="text-[11px] font-medium text-zinc-500 mb-0.5">Approvals</div>
                    {ws.approvals.total > 0 ? (
                      ws.approvals.pending > 0 ? (
                        <div className="text-[11px] text-teal-400 font-medium">{ws.approvals.pending} pending</div>
                      ) : (
                        <div className="flex items-center gap-1 text-[11px] text-green-400">
                          <CheckCircle2 className="w-2.5 h-2.5" /> All clear
                        </div>
                      )
                    ) : (
                      <div className="text-[11px] text-zinc-500">None</div>
                    )}
                  </div>

                  <div className="w-px h-8 bg-zinc-800" />

                  {/* Content Pipeline */}
                  <div>
                    <div className="text-[11px] font-medium text-zinc-500 mb-0.5">Content</div>
                    {(ws.contentRequests?.total || 0) > 0 ? (
                      <div className="flex items-center gap-2 text-[11px]">
                        {(ws.contentRequests?.pending || 0) > 0 && <span className="text-amber-400 font-medium">{ws.contentRequests!.pending} pending</span>}
                        {(ws.contentRequests?.inProgress || 0) > 0 && <span className="text-blue-400">{ws.contentRequests!.inProgress} in progress</span>}
                        {(ws.contentRequests?.delivered || 0) > 0 && <span className="text-teal-400">{ws.contentRequests!.delivered} delivered</span>}
                      </div>
                    ) : (
                      <div className="text-[11px] text-zinc-500">None</div>
                    )}
                  </div>

                  {/* SEO Status (inline badges) */}
                  {(ws.pageStates?.total || 0) > 0 && (
                    <>
                      <div className="w-px h-8 bg-zinc-800" />
                      <div>
                        <div className="text-[11px] font-medium text-zinc-500 mb-0.5">SEO Status</div>
                        <div className="flex flex-wrap gap-1">
                          {(ws.pageStates?.issueDetected || 0) > 0 && <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/10 border border-amber-500/20 text-amber-400">{ws.pageStates!.issueDetected} issues</span>}
                          {(ws.pageStates?.inReview || 0) > 0 && <span className="text-[10px] px-1.5 py-0.5 rounded bg-teal-500/10 border border-teal-500/20 text-teal-400">{ws.pageStates!.inReview} in review</span>}
                          {(ws.pageStates?.approved || 0) > 0 && <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-500/10 border border-green-500/20 text-green-400">{ws.pageStates!.approved} approved</span>}
                          {(ws.pageStates?.rejected || 0) > 0 && <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-500/10 border border-red-500/20 text-red-400">{ws.pageStates!.rejected} rejected</span>}
                          {(ws.pageStates?.live || 0) > 0 && <span className="text-[10px] px-1.5 py-0.5 rounded bg-teal-500/10 border border-teal-500/20 text-teal-400">{ws.pageStates!.live} live</span>}
                        </div>
                      </div>
                    </>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── AI Usage ── */}
      <AIUsageSection />

      {/* ── Recent Activity ── */}
      {recentActivity.length > 0 && (
        <SectionCard title="Recent Activity" titleIcon={<Activity className="w-4 h-4 text-zinc-500" />} noPadding>
          <div className="divide-y divide-zinc-800/50">
            {recentActivity.map(entry => {
              const wsName = data.find(w => w.id === entry.workspaceId)?.name || '';
              const iconMap: Record<string, typeof Zap> = {
                audit_completed: Globe,
                content_requested: FileText,
                brief_generated: Zap,
                request_resolved: CheckCircle2,
                approval_applied: ClipboardCheck,
                seo_updated: Globe,
                schema_generated: Shield,
                schema_published: Shield,
                redirects_scanned: AlertTriangle,
                strategy_generated: BarChart3,
                rank_snapshot: Search,
              };
              const Icon = iconMap[entry.type] || Activity;
              return (
                <div
                  key={entry.id}
                  className="flex items-start gap-3 px-4 py-2.5"
                >
                  <Icon className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-teal-400" />
                  <div className="flex-1 min-w-0">
                    <div className="text-xs text-zinc-200">{entry.title}</div>
                    {entry.description && <div className="text-[11px] mt-0.5 text-zinc-500">{entry.description}</div>}
                  </div>
                  <div className="flex-shrink-0 text-right">
                    {wsName && <div className="text-[11px] text-zinc-500">{wsName}</div>}
                    <div className="text-[11px] text-zinc-500">{timeAgo(entry.createdAt)}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </SectionCard>
      )}
    </div>
  );
}

// --- AI Usage Dashboard ---

interface DailyUsage {
  date: string;
  cost: number;
  calls: number;
  totalTokens: number;
  openaiCost: number;
  anthropicCost: number;
  openaiTokens: number;
  anthropicTokens: number;
}

interface FeatureUsage {
  feature: string;
  calls: number;
  totalTokens: number;
  cost: number;
  provider: string;
}

interface SemrushUsage {
  totalCredits: number;
  totalCalls: number;
  cachedCalls: number;
}

interface SemrushDailyUsage {
  date: string;
  credits: number;
  calls: number;
  cachedCalls: number;
}

interface AIUsageData {
  totalTokens: number;
  estimatedCost: number;
  daily: DailyUsage[];
  byFeature: FeatureUsage[];
  semrush: SemrushUsage;
  semrushDaily: SemrushDailyUsage[];
}

function AIUsageSection() {
  const [data, setData] = useState<AIUsageData | null>(null);
  const [days, setDays] = useState(14);
  const [hovered, setHovered] = useState<number | null>(null);

  useEffect(() => {
    fetch(`/api/ai/usage?days=${days}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setData(d); })
      .catch(() => {});
  }, [days]);

  const hasSemrush = data?.semrush && data.semrush.totalCredits > 0;
  if (!data || (data.totalTokens === 0 && data.daily.every(d => d.calls === 0) && !hasSemrush)) return null;

  const totalCost = data.estimatedCost;
  const totalCalls = data.daily.reduce((s, d) => s + d.calls, 0);
  const openaiCost = data.daily.reduce((s, d) => s + d.openaiCost, 0);
  const anthropicCost = data.daily.reduce((s, d) => s + d.anthropicCost, 0);

  // Chart dimensions
  const chartDays = data.daily.slice(-days);
  const maxCost = Math.max(...chartDays.map(d => d.cost), 0.001);
  const barW = 100 / chartDays.length;

  const fmtCost = (v: number) => v < 0.01 ? '<$0.01' : `$${v.toFixed(2)}`;
  const fmtTokens = (v: number) => v >= 1_000_000 ? `${(v / 1_000_000).toFixed(1)}M` : v >= 1000 ? `${(v / 1000).toFixed(1)}K` : String(v);

  const FEATURE_LABELS: Record<string, string> = {
    'content-post-intro': 'Post: Intro',
    'content-post-section': 'Post: Sections',
    'content-post-conclusion': 'Post: Conclusion',
    'content-post-unify': 'Post: Unification',
    'content-post-seo-meta': 'Post: SEO Meta',
    'content-brief': 'Content Brief',
    'seo-rewrite': 'SEO Rewrite',
    'seo-chat': 'Admin Chat',
    'client-chat': 'Client Chat',
    'schema-generation': 'Schema',
    'alt-text': 'Alt Text',
    'strategy': 'Strategy',
    'kb-generate': 'KB Auto-Gen',
    'anomaly-detection': 'Anomaly Detection',
    'chat-summary': 'Chat Summary',
  };

  return (
    <SectionCard
      title="AI Usage"
      titleIcon={<Zap className="w-4 h-4 text-amber-400" />}
      action={
        <div className="flex gap-1">
          {[7, 14, 30].map(d => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${days === d ? 'bg-zinc-700 text-zinc-200' : 'text-zinc-500 hover:text-zinc-300'}`}
            >
              {d}d
            </button>
          ))}
        </div>
      }
    >
      {/* Stat cards */}
      <div className={`grid grid-cols-2 ${hasSemrush ? 'sm:grid-cols-5' : 'sm:grid-cols-4'} gap-3 mb-4`}>
        <div className="rounded-lg bg-zinc-800/50 border border-zinc-800 px-3 py-2.5">
          <div className="text-[11px] text-zinc-500 mb-0.5">AI Cost</div>
          <div className="text-sm font-semibold text-zinc-200">{fmtCost(totalCost)}</div>
        </div>
        <div className="rounded-lg bg-zinc-800/50 border border-zinc-800 px-3 py-2.5">
          <div className="text-[11px] text-zinc-500 mb-0.5">AI Calls</div>
          <div className="text-sm font-semibold text-zinc-200">{totalCalls.toLocaleString()}</div>
        </div>
        <div className="rounded-lg bg-zinc-800/50 border border-zinc-800 px-3 py-2.5">
          <div className="text-[11px] text-zinc-500 mb-0.5">OpenAI</div>
          <div className="text-sm font-semibold text-emerald-400">{fmtCost(openaiCost)}</div>
        </div>
        <div className="rounded-lg bg-zinc-800/50 border border-zinc-800 px-3 py-2.5">
          <div className="text-[11px] text-zinc-500 mb-0.5">Anthropic</div>
          <div className="text-sm font-semibold text-orange-400">{fmtCost(anthropicCost)}</div>
        </div>
        {hasSemrush && (
          <div className="rounded-lg bg-zinc-800/50 border border-zinc-800 px-3 py-2.5">
            <div className="text-[11px] text-zinc-500 mb-0.5">SEMRush Credits</div>
            <div className="text-sm font-semibold text-violet-400">{data.semrush.totalCredits.toLocaleString()}</div>
            <div className="text-[9px] text-zinc-600 mt-0.5">{data.semrush.totalCalls - data.semrush.cachedCalls} API / {data.semrush.cachedCalls} cached</div>
          </div>
        )}
      </div>

      {/* Stacked bar chart — daily cost by provider */}
      <div className="mb-1">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[11px] text-zinc-500">Daily Cost</span>
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1 text-[11px] text-zinc-500"><span className="w-2 h-2 rounded-sm bg-emerald-500 inline-block" /> OpenAI</span>
            <span className="flex items-center gap-1 text-[11px] text-zinc-500"><span className="w-2 h-2 rounded-sm bg-orange-500 inline-block" /> Anthropic</span>
          </div>
        </div>
        <div className="relative" onMouseLeave={() => setHovered(null)}>
          <svg viewBox="0 0 100 50" className="w-full" style={{ height: 120 }} preserveAspectRatio="none">
            {chartDays.map((d, i) => {
              const x = i * barW + barW * 0.15;
              const w = barW * 0.7;
              const oaiH = (d.openaiCost / maxCost) * 44;
              const antH = (d.anthropicCost / maxCost) * 44;
              const isHov = hovered === i;
              return (
                <g key={d.date}>
                  {/* OpenAI (bottom) */}
                  <rect x={x} y={48 - oaiH - antH} width={w} height={oaiH} fill={isHov ? '#34d399' : '#059669'} rx="0.3" opacity={isHov ? 1 : 0.8} />
                  {/* Anthropic (top) */}
                  <rect x={x} y={48 - antH} width={w} height={antH} fill={isHov ? '#fb923c' : '#ea580c'} rx="0.3" opacity={isHov ? 1 : 0.8} />
                  {/* Hover target */}
                  <rect x={i * barW} y={0} width={barW} height={50} fill="transparent" className="cursor-pointer" onMouseEnter={() => setHovered(i)} />
                </g>
              );
            })}
            {/* Baseline */}
            <line x1={0} y1={48} x2={100} y2={48} stroke="#3f3f46" strokeWidth="0.3" vectorEffect="non-scaling-stroke" />
          </svg>
          {/* X-axis labels */}
          <div className="flex justify-between px-0.5 -mt-0.5">
            {chartDays.length > 0 && <span className="text-[9px] text-zinc-600">{chartDays[0].date.slice(5)}</span>}
            {chartDays.length > 7 && <span className="text-[9px] text-zinc-600">{chartDays[Math.floor(chartDays.length / 2)].date.slice(5)}</span>}
            {chartDays.length > 0 && <span className="text-[9px] text-zinc-600">{chartDays[chartDays.length - 1].date.slice(5)}</span>}
          </div>
          {/* Hover tooltip */}
          {hovered !== null && chartDays[hovered] && (
            <div
              className="absolute z-20 top-0 mt-1 pointer-events-none"
              style={{
                left: hovered / chartDays.length < 0.65 ? `${(hovered / chartDays.length) * 100}%` : undefined,
                right: hovered / chartDays.length >= 0.65 ? `${100 - (hovered / chartDays.length) * 100}%` : undefined,
              }}
            >
              <div className="bg-zinc-900 border border-zinc-700 rounded-lg shadow-xl shadow-black/40 min-w-[140px] overflow-hidden">
                <div className="px-3 py-1.5 border-b border-zinc-800 text-[11px] font-semibold text-zinc-200">{chartDays[hovered].date}</div>
                <div className="px-3 py-1.5 space-y-1">
                  <div className="flex justify-between text-[11px]"><span className="text-zinc-500">Total</span><span className="text-zinc-200 font-medium">{fmtCost(chartDays[hovered].cost)}</span></div>
                  <div className="flex justify-between text-[11px]"><span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-sm bg-emerald-500 inline-block" />OpenAI</span><span className="text-emerald-400">{fmtCost(chartDays[hovered].openaiCost)}</span></div>
                  <div className="flex justify-between text-[11px]"><span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-sm bg-orange-500 inline-block" />Anthropic</span><span className="text-orange-400">{fmtCost(chartDays[hovered].anthropicCost)}</span></div>
                  <div className="flex justify-between text-[11px]"><span className="text-zinc-500">Calls</span><span className="text-zinc-300">{chartDays[hovered].calls}</span></div>
                  <div className="flex justify-between text-[11px]"><span className="text-zinc-500">Tokens</span><span className="text-zinc-300">{fmtTokens(chartDays[hovered].totalTokens)}</span></div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Feature breakdown */}
      {data.byFeature.length > 0 && (
        <div className="mt-4">
          <div className="text-[11px] text-zinc-500 mb-2">Cost by Feature</div>
          <div className="space-y-1">
            {data.byFeature.slice(0, 8).map((f, i) => {
              const pct = totalCost > 0 ? (f.cost / totalCost) * 100 : 0;
              return (
                <div key={i} className="flex items-center gap-2">
                  <span className="text-[11px] text-zinc-400 w-32 truncate">{FEATURE_LABELS[f.feature] || f.feature}</span>
                  <div className="flex-1 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full ${f.provider === 'anthropic' ? 'bg-orange-500' : 'bg-emerald-500'}`}
                      style={{ width: `${Math.max(pct, 1)}%` }}
                    />
                  </div>
                  <span className="text-[11px] text-zinc-500 w-12 text-right tabular-nums">{fmtCost(f.cost)}</span>
                  <span className="text-[9px] text-zinc-600 w-10 text-right tabular-nums">{f.calls} calls</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </SectionCard>
  );
}
