import { useState, useCallback } from 'react';
import { patch, post } from '../api/client';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useGlobalAdminEvents } from '../hooks/useGlobalAdminEvents';
import { useWorkspaceOverviewData } from '../hooks/admin';
import type { FeedbackItem, PresenceMap, WorkspaceOverviewData } from '../hooks/admin/useWorkspaceOverview';
import {
  Globe, Shield, MessageSquare, ClipboardCheck, AlertTriangle,
  CheckCircle2, ArrowUpRight, ArrowDownRight, Minus, Loader2,
  Search, BarChart3, Lock, ExternalLink, Bell, Activity, FileText, Zap,
  Map, Rocket, FileSearch, Clock, DollarSign, Flag, Layers,
  MessageSquarePlus, Bug, Lightbulb, MessageCircle, Send,
} from 'lucide-react';
import { MetricRingSvg, PageHeader, SectionCard, Badge, StatCard, Icon, cn } from './ui';
import { themeColor } from './ui/constants';
import { STUDIO_NAME } from '../constants';
import { timeAgo } from '../lib/timeAgo';

// Types imported from useWorkspaceOverview hook

// ScoreRing replaced by unified <MetricRingSvg /> from ./ui
const ScoreRing = MetricRingSvg;

export { AIUsageSection } from './AIUsageSection';

export function WorkspaceOverview({ onSelectWorkspace }: { onSelectWorkspace: (id: string) => void }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: overviewData, isLoading: loading } = useWorkspaceOverviewData();
  const [feedbackReply, setFeedbackReply] = useState<Record<string, string>>({});

  // Real-time presence: WebSocket overrides query data via a state + ref trigger
  const [wsPresence, setWsPresence] = useState<PresenceMap | null>(null);
  const handlePresenceUpdate = useCallback((d: unknown) => {
    if (d && typeof d === 'object') setWsPresence(d as PresenceMap);
  }, []);
  useGlobalAdminEvents({ 'presence:update': handlePresenceUpdate });

  // Derive data from query result
  const data = overviewData?.workspaces ?? [];
  const recentActivity = overviewData?.recentActivity ?? [];
  const feedback = overviewData?.feedback ?? [];
  const timeSaved = overviewData?.timeSaved ?? null;
  // Prefer live WebSocket presence, fall back to query snapshot
  const presence: PresenceMap = wsPresence ?? overviewData?.presence ?? {};

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Icon as={Loader2} size="lg" className="animate-spin text-accent-brand" />
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-6">
        <img src="/logo.svg" alt={STUDIO_NAME} className="h-10 opacity-40" />
        <div className="text-center max-w-sm">
          <p className="text-base font-semibold mb-1 text-[var(--brand-text-bright)]">Welcome to {STUDIO_NAME}</p>
          <p className="t-caption-sm text-[var(--brand-text-muted)]">Create a workspace to get started.</p>
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

  // Needs attention items — priority sorted
  const attentionItems: Array<{ label: string; value: string; color: string; icon: typeof Bell; priority: number }> = [];
  if (totalNewRequests > 0) attentionItems.push({ label: `${totalNewRequests} new client request${totalNewRequests > 1 ? 's' : ''}`, value: 'Requests', color: 'text-accent-danger', icon: Bell, priority: 2 });
  if (totalPendingApprovals > 0) attentionItems.push({ label: `${totalPendingApprovals} pending approval${totalPendingApprovals > 1 ? 's' : ''}`, value: 'Approvals', color: 'text-accent-brand', icon: ClipboardCheck, priority: 3 });
  if (totalPendingContent > 0) attentionItems.push({ label: `${totalPendingContent} content brief${totalPendingContent > 1 ? 's' : ''} awaiting review`, value: 'Content', color: 'text-accent-warning', icon: FileText, priority: 4 });
  if (totalPendingWorkOrders > 0) attentionItems.push({ label: `${totalPendingWorkOrders} purchased fix${totalPendingWorkOrders > 1 ? 'es' : ''} awaiting fulfillment`, value: 'Work Orders', color: 'text-accent-brand', icon: ClipboardCheck, priority: 5 });
  const rejectedWorkspaces = data.filter(w => (w.pageStates?.rejected || 0) > 0);
  const totalRejected = rejectedWorkspaces.reduce((s, w) => s + (w.pageStates?.rejected || 0), 0);
  if (totalRejected > 0) attentionItems.push({ label: `${totalRejected} rejected change${totalRejected > 1 ? 's' : ''} need revision`, value: 'Rejected', color: 'text-accent-danger', icon: AlertTriangle, priority: 6 });
  const lowScoreWorkspaces = data.filter(w => w.audit && w.audit.score < 60);
  if (lowScoreWorkspaces.length > 0) attentionItems.push({ label: `${lowScoreWorkspaces.length} workspace${lowScoreWorkspaces.length > 1 ? 's' : ''} with health score below 60`, value: 'Health', color: 'text-accent-danger', icon: AlertTriangle, priority: 7 });
  const unlinkWorkspaces = data.filter(w => !w.webflowSiteId);
  if (unlinkWorkspaces.length > 0) attentionItems.push({ label: `${unlinkWorkspaces.length} workspace${unlinkWorkspaces.length > 1 ? 's' : ''} with no site linked`, value: 'Setup', color: 'text-accent-warning', icon: Globe, priority: 8 });
  const atRiskWorkspaces = data.filter(w => (w.churnSignals?.critical || 0) > 0 || (w.churnSignals?.warning || 0) > 0);
  if (atRiskWorkspaces.length > 0) attentionItems.push({ label: `${atRiskWorkspaces.length} workspace${atRiskWorkspaces.length > 1 ? 's' : ''} at risk of churn`, value: 'Churn', color: atRiskWorkspaces.some(w => (w.churnSignals?.critical || 0) > 0) ? 'text-accent-danger' : 'text-accent-warning', icon: Flag, priority: 1.5 });
  attentionItems.sort((a, b) => a.priority - b.priority);

  return (
    <div className="space-y-8">
      <PageHeader
        title="Command Center"
        subtitle={`${data.length} workspace${data.length !== 1 ? 's' : ''} · ${new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}`}
        icon={<Icon as={Rocket} size="lg" className="text-accent-brand" />}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={() => navigate('/prospect')} className="flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--radius-lg)] t-caption-sm font-medium text-[var(--brand-text-muted)] hover:text-[var(--brand-text-bright)] bg-[var(--surface-3)] hover:bg-[var(--brand-border-hover)] border border-[var(--brand-border)] hover:border-[var(--brand-border-hover)] transition-all">
              <Icon as={FileSearch} size="sm" /> Prospect
            </button>
            <button onClick={() => navigate('/roadmap')} className="flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--radius-lg)] t-caption-sm font-medium text-[var(--brand-text-muted)] hover:text-[var(--brand-text-bright)] bg-[var(--surface-3)] hover:bg-[var(--brand-border-hover)] border border-[var(--brand-border)] hover:border-[var(--brand-border-hover)] transition-all">
              <Icon as={Map} size="sm" /> Roadmap
            </button>
            <button onClick={() => navigate('/ai-usage')} className="flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--radius-lg)] t-caption-sm font-medium text-accent-warning hover:text-accent-warning bg-amber-500/5 hover:bg-amber-500/10 border border-amber-500/20 transition-all">
              <Icon as={Zap} size="sm" /> AI Usage
            </button>
            <button onClick={() => navigate('/revenue')} className="flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--radius-lg)] t-caption-sm font-medium text-accent-success hover:text-accent-success bg-emerald-500/5 hover:bg-emerald-500/10 border border-emerald-500/20 transition-all">
              <Icon as={DollarSign} size="sm" /> Revenue
            </button>
            <button onClick={() => navigate('/features')} className="flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--radius-lg)] t-caption-sm font-medium text-accent-brand hover:text-accent-brand bg-teal-500/5 hover:bg-teal-500/10 border border-teal-500/20 transition-all">
              <Icon as={Layers} size="sm" /> Features
            </button>
          </div>
        }
      />

      {/* ── Needs Attention ── */}
      {attentionItems.length > 0 && (
        <SectionCard title="Needs Attention" titleIcon={<Icon as={AlertTriangle} size="md" className="text-accent-warning" />} noPadding>
          <div className="divide-y divide-[var(--brand-border)]">
            {attentionItems.map((item, i) => {
              const ItemIcon = item.icon;
              return (
                <div key={i} className="flex items-center gap-3 px-4 py-2.5">
                  <ItemIcon className={cn('w-3.5 h-3.5 flex-shrink-0', item.color)} />
                  <span className="t-caption text-[var(--brand-text-bright)] flex-1">{item.label}</span>
                  <Badge label={item.value} color="zinc" />
                </div>
              );
            })}
          </div>
        </SectionCard>
      )}

      {/* ── Global Stats ── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <StatCard label="New Requests" value={totalNewRequests} icon={Bell} iconColor={totalNewRequests > 0 ? '#f87171' : themeColor('#71717a', '#94a3b8')} />
        <StatCard label="Active Requests" value={totalActiveRequests} icon={MessageSquare} iconColor={totalActiveRequests > 0 ? '#fbbf24' : themeColor('#71717a', '#94a3b8')} />
        <StatCard label="Content Pipeline" value={`${totalPendingContent + totalInProgressContent}/${totalDeliveredContent}`} icon={FileText} iconColor={totalPendingContent > 0 ? '#f59e0b' : totalInProgressContent > 0 ? '#60a5fa' : themeColor('#71717a', '#94a3b8')} />
        <StatCard label="Approvals" value={totalPendingApprovals} icon={ClipboardCheck} iconColor={totalPendingApprovals > 0 ? '#2dd4bf' : themeColor('#71717a', '#94a3b8')} />
        <StatCard label="Avg Health" value={avgScore !== null ? avgScore : '—'} icon={Shield} iconColor={avgScore !== null ? (avgScore >= 80 ? '#4ade80' : avgScore >= 60 ? '#fbbf24' : '#f87171') : themeColor('#71717a', '#94a3b8')} />
        <StatCard label="Hours Saved" value={timeSaved ? `${timeSaved.totalHoursSaved}h` : '—'} icon={Clock} iconColor={timeSaved && timeSaved.totalHoursSaved > 0 ? '#60a5fa' : themeColor('#71717a', '#94a3b8')} sub={timeSaved ? `${timeSaved.operationCount} AI ops this month` : undefined} />
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
                <span className="animate-ping absolute inline-flex h-full w-full rounded-[var(--radius-pill)] bg-emerald-400 opacity-75" />
                <span className="relative inline-flex rounded-[var(--radius-pill)] h-3 w-3 bg-emerald-500" />
              </span>
            }
            noPadding
          >
            <div className="divide-y divide-[var(--brand-border)]">
              {Object.entries(presence).map(([wsId, users]) =>
                users.map(u => (
                  <div key={`${wsId}-${u.userId}`} className="flex items-center gap-3 px-4 py-2.5">
                    <div className="flex items-center justify-center w-7 h-7 rounded-[var(--radius-pill)] bg-emerald-500/15 text-accent-success t-caption font-bold flex-shrink-0">
                      {(u.name || u.email)[0].toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <span className="t-caption font-medium text-[var(--brand-text-bright)]">{u.name || u.email.split('@')[0]}</span>
                      <span className="t-micro text-[var(--brand-text-muted)] ml-2">{u.email}</span>
                    </div>
                    <span className="t-micro text-[var(--brand-text-muted)] flex-shrink-0">{wsNames[wsId] || wsId}</span>
                    <Badge label={u.role === 'admin' ? 'Admin' : 'Client'} color={u.role === 'admin' ? 'blue' : 'emerald'} />
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
          <Icon as={Globe} size="md" className="text-[var(--brand-text-muted)]" />
          <h2 className="t-caption font-semibold text-[var(--brand-text-bright)]">Workspaces</h2>
        </div>
        <div className="space-y-3">
          {data.map(ws => {
            const hasAlerts = ws.requests.new > 0 || ws.approvals.pending > 0 || (ws.contentRequests?.pending || 0) > 0;
            const scoreDelta = ws.audit && ws.audit.previousScore != null ? ws.audit.score - ws.audit.previousScore : null;
            const isAtRisk = (ws.churnSignals?.critical || 0) > 0 || (ws.churnSignals?.warning || 0) > 0;
            const onlineUsers = presence[ws.id] || [];

            return (
              <button
                key={ws.id}
                onClick={() => onSelectWorkspace(ws.id)}
                className={cn(
                  'w-full text-left p-5 transition-all hover:scale-[1.005] hover:shadow-lg group relative bg-[var(--surface-2)] border',
                  onlineUsers.length > 0 ? 'border-emerald-500/40'
                    : isAtRisk && (ws.churnSignals?.critical || 0) > 0 ? 'border-red-500/30'
                    : hasAlerts || isAtRisk ? 'border-amber-500/30'
                    : 'border-[var(--brand-border)]'
                )}
                style={{ borderRadius: 'var(--radius-signature-lg)' /* pr-check-disable-next-line -- Workspace selector rows are interactive list items with custom presence/risk borders. */ }}
              >
                {/* New request badge */}
                {ws.requests.new > 0 && (
                  <div className="absolute -top-2 -right-2 flex items-center gap-1 px-2 py-0.5 rounded-[var(--radius-pill)] t-caption-sm font-bold bg-red-500 text-white shadow-lg">
                    <Icon as={Bell} size="sm" /> {ws.requests.new} new
                  </div>
                )}

                {/* Online users banner */}
                {onlineUsers.length > 0 && (
                  <div className="flex items-center gap-2 px-3 py-1.5 -mx-5 -mt-5 mb-3 rounded-t-xl bg-emerald-500/10 border-b border-emerald-500/20">
                    <span className="relative flex h-2.5 w-2.5">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-[var(--radius-pill)] bg-emerald-400 opacity-75" />
                      <span className="relative inline-flex rounded-[var(--radius-pill)] h-2.5 w-2.5 bg-emerald-500" />
                    </span>
                    <span className="t-caption-sm font-semibold text-accent-success">
                      {onlineUsers.map(u => u.name || u.email.split('@')[0]).join(', ')} online now
                    </span>
                  </div>
                )}

                {/* Top row: name + badges + site info */}
                <div className="flex items-center justify-between gap-3 mb-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <h3 className="t-caption font-semibold truncate group-hover:text-accent-brand transition-colors text-[var(--brand-text-bright)]">{ws.name}</h3>
                    {isAtRisk && (
                      <span className={cn(
                        'flex-shrink-0 flex items-center gap-1 px-1.5 py-0.5 t-micro font-bold rounded-[var(--radius-md)] border',
                        (ws.churnSignals?.critical || 0) > 0
                          ? 'bg-red-500/15 text-accent-danger border-red-500/20'
                          : 'bg-amber-500/15 text-accent-warning border-amber-500/20'
                      )}>
                        <Icon as={Flag} size="sm" />
                        At Risk
                      </span>
                    )}
                    {ws.isTrial && (
                      <span className="flex-shrink-0 px-1.5 py-0.5 t-micro font-bold rounded-[var(--radius-md)] bg-amber-500/15 text-accent-warning border border-amber-500/20">
                        Trial{ws.trialDaysRemaining != null ? ` · ${ws.trialDaysRemaining}d` : ''}
                      </span>
                    )}
                    {ws.tier && ws.tier !== 'free' && !ws.isTrial && (
                      <span className="flex-shrink-0 px-1.5 py-0.5 t-micro font-bold rounded-[var(--radius-md)] border bg-teal-500/15 text-accent-brand border-teal-500/20">{ws.tier}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 t-caption-sm text-[var(--brand-text-muted)] flex-shrink-0">
                    {ws.webflowSiteName && <span className="flex items-center gap-1"><Icon as={Globe} size="sm" />{ws.webflowSiteName}</span>}
                    {!ws.webflowSiteId && <span className="flex items-center gap-1 text-accent-warning"><Icon as={AlertTriangle} size="sm" />No site linked</span>}
                    {ws.hasGsc && <span className="flex items-center gap-1"><Icon as={Search} size="sm" />GSC</span>}
                    {ws.hasGa4 && <span className="flex items-center gap-1"><Icon as={BarChart3} size="sm" />GA4</span>}
                    {ws.hasPassword && <span className="flex items-center gap-1"><Icon as={Lock} size="sm" />Client</span>}
                    <Icon as={ExternalLink} size="sm" className="shrink-0 opacity-0 group-hover:opacity-60 transition-opacity" />
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
                            <span className="t-caption-sm font-medium text-[var(--brand-text-muted)]">Health</span>
                            {scoreDelta !== null && scoreDelta !== 0 && (
                              <span className={cn('flex items-center t-caption-sm font-medium', scoreDelta > 0 ? 'text-accent-success' : 'text-accent-danger')}>
                                {scoreDelta > 0 ? <ArrowUpRight className="w-2.5 h-2.5" /> : <ArrowDownRight className="w-2.5 h-2.5" />}
                                {Math.abs(scoreDelta)}
                              </span>
                            )}
                            {scoreDelta === 0 && <Minus className="w-2.5 h-2.5 text-[var(--brand-text-muted)]" />}
                          </div>
                          <div className="t-caption-sm text-[var(--brand-text-muted)]">
                            {ws.audit.errors > 0 && <span className="text-accent-danger">{ws.audit.errors} err</span>}
                            {ws.audit.errors > 0 && ws.audit.warnings > 0 && ' · '}
                            {ws.audit.warnings > 0 && <span className="text-accent-warning">{ws.audit.warnings} warn</span>}
                          </div>
                        </div>
                      </>
                    ) : (
                      <span className="t-caption-sm text-[var(--brand-text-muted)]">No audit</span>
                    )}
                  </div>

                  <div className="w-px h-8 bg-[var(--brand-border)]" />

                  {/* Requests */}
                  <div>
                    <div className="t-caption-sm font-medium text-[var(--brand-text-muted)] mb-0.5">Requests</div>
                    {ws.requests.total > 0 ? (
                      <div className="flex items-center gap-2 t-caption-sm">
                        {ws.requests.new > 0 && <span className="text-accent-danger font-medium">{ws.requests.new} new</span>}
                        {ws.requests.active > 0 && <span className="text-accent-brand">{ws.requests.active} active</span>}
                        {ws.requests.latestDate && <span className="text-[var(--brand-text-muted)]">{timeAgo(ws.requests.latestDate)}</span>}
                      </div>
                    ) : (
                      <div className="t-caption-sm text-[var(--brand-text-muted)]">None</div>
                    )}
                  </div>

                  <div className="w-px h-8 bg-[var(--brand-border)]" />

                  {/* Approvals */}
                  <div>
                    <div className="t-caption-sm font-medium text-[var(--brand-text-muted)] mb-0.5">Approvals</div>
                    {ws.approvals.total > 0 ? (
                      ws.approvals.pending > 0 ? (
                        <div className="t-caption-sm text-accent-brand font-medium">{ws.approvals.pending} pending</div>
                      ) : (
                        <div className="flex items-center gap-1 t-caption-sm text-accent-success">
                          <CheckCircle2 className="w-2.5 h-2.5" /> All clear
                        </div>
                      )
                    ) : (
                      <div className="t-caption-sm text-[var(--brand-text-muted)]">None</div>
                    )}
                  </div>

                  <div className="w-px h-8 bg-[var(--brand-border)]" />

                  {/* Content Pipeline */}
                  <div>
                    <div className="t-caption-sm font-medium text-[var(--brand-text-muted)] mb-0.5">Content</div>
                    {(ws.contentRequests?.total || 0) > 0 ? (
                      <div className="flex items-center gap-2 t-caption-sm">
                        {(ws.contentRequests?.pending || 0) > 0 && <span className="text-accent-warning font-medium">{ws.contentRequests!.pending} pending</span>}
                        {(ws.contentRequests?.inProgress || 0) > 0 && <span className="text-accent-info">{ws.contentRequests!.inProgress} in progress</span>}
                        {(ws.contentRequests?.delivered || 0) > 0 && <span className="text-accent-brand">{ws.contentRequests!.delivered} delivered</span>}
                      </div>
                    ) : (
                      <div className="t-caption-sm text-[var(--brand-text-muted)]">None</div>
                    )}
                  </div>

                  {/* SEO Status (inline badges) */}
                  {(ws.pageStates?.total || 0) > 0 && (
                    <>
                      <div className="w-px h-8 bg-[var(--brand-border)]" />
                      <div>
                        <div className="t-caption-sm font-medium text-[var(--brand-text-muted)] mb-0.5">SEO Status</div>
                        <div className="flex flex-wrap gap-1">
                          {(ws.pageStates?.issueDetected || 0) > 0 && <span className="t-micro px-1.5 py-0.5 rounded bg-amber-500/10 border border-amber-500/20 text-accent-warning">{ws.pageStates!.issueDetected} issues</span>}
                          {(ws.pageStates?.inReview || 0) > 0 && <span className="t-micro px-1.5 py-0.5 rounded bg-teal-500/10 border border-teal-500/20 text-accent-brand">{ws.pageStates!.inReview} in review</span>}
                          {(ws.pageStates?.approved || 0) > 0 && <span className="t-micro px-1.5 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/20 text-accent-success">{ws.pageStates!.approved} approved</span>}
                          {(ws.pageStates?.rejected || 0) > 0 && <span className="t-micro px-1.5 py-0.5 rounded bg-red-500/10 border border-red-500/20 text-accent-danger">{ws.pageStates!.rejected} rejected</span>}
                          {(ws.pageStates?.live || 0) > 0 && <span className="t-micro px-1.5 py-0.5 rounded bg-teal-500/10 border border-teal-500/20 text-accent-brand">{ws.pageStates!.live} live</span>}
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

      {/* ── Client Feedback ── */}
      {feedback.length > 0 && (() => {
        const fbTypeIcon: Record<string, typeof Bug> = { bug: Bug, feature: Lightbulb, general: MessageCircle };
        const fbTypeColor: Record<string, string> = { bug: 'text-accent-danger', feature: 'text-accent-warning', general: 'text-accent-brand' };
        const fbTypeBg: Record<string, string> = { bug: 'bg-red-500/10', feature: 'bg-amber-500/10', general: 'bg-teal-500/10' };
        const fbStatusColor: Record<string, string> = { new: 'text-accent-info bg-blue-500/10', acknowledged: 'text-accent-warning bg-amber-500/10', fixed: 'text-accent-success bg-emerald-500/10', wontfix: 'text-[var(--brand-text-muted)] bg-[var(--surface-3)]' };
        const fbStatusLabel: Record<string, string> = { new: 'New', acknowledged: 'Acknowledged', fixed: 'Resolved', wontfix: 'Noted' };
        const newCount = feedback.filter(f => f.status === 'new').length;

        const handleStatusChange = async (wsId: string, id: string, status: string) => {
          const updated = await patch<FeedbackItem>(`/api/feedback/${wsId}/${id}`, { status });
          queryClient.setQueryData<WorkspaceOverviewData>(['admin-workspace-overview'], old => {
            if (!old) return old;
            return { ...old, feedback: old.feedback.map(f => f.id === updated.id ? updated : f) };
          });
        };

        const handleReply = async (wsId: string, id: string) => {
          const content = feedbackReply[id]?.trim();
          if (!content) return;
          const updated = await post<FeedbackItem>(`/api/feedback/${wsId}/${id}/reply`, { content });
          queryClient.setQueryData<WorkspaceOverviewData>(['admin-workspace-overview'], old => {
            if (!old) return old;
            return { ...old, feedback: old.feedback.map(f => f.id === updated.id ? updated : f) };
          });
          setFeedbackReply(prev => ({ ...prev, [id]: '' }));
        };

        return (
          <SectionCard
            title={`Client Feedback${newCount > 0 ? ` · ${newCount} new` : ''}`}
            titleIcon={<Icon as={MessageSquarePlus} size="md" className="text-accent-brand" />}
            noPadding
          >
            <div className="divide-y divide-[var(--brand-border)]">
              {feedback.slice(0, 20).map(item => {
                const ItemIcon = fbTypeIcon[item.type] || MessageCircle;
                const wsName = data.find(w => w.id === item.workspaceId)?.name || item.workspaceId;
                return (
                  <div key={item.id} className="px-4 py-3">
                    <div className="flex items-start gap-3">
                      <div className={cn('w-7 h-7 rounded-[var(--radius-lg)]', fbTypeBg[item.type], 'flex items-center justify-center flex-shrink-0 mt-0.5')}>
                        <ItemIcon className={cn('w-3.5 h-3.5', fbTypeColor[item.type])} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="t-caption font-medium text-[var(--brand-text-bright)]">{item.title}</span>
                          <span className={cn('t-micro px-1.5 py-0.5 rounded font-medium', fbStatusColor[item.status])}>{fbStatusLabel[item.status]}</span>
                          <span className="t-micro text-[var(--brand-text-muted)] capitalize">{item.type}</span>
                        </div>
                        <p className="t-caption-sm text-[var(--brand-text-muted)] mt-1 line-clamp-2">{item.description}</p>
                        <div className="flex items-center gap-3 mt-1.5">
                          <span className="t-micro text-[var(--brand-text-muted)]">{wsName}</span>
                          <span className="t-micro text-[var(--brand-text-muted)]">{timeAgo(item.createdAt)}</span>
                          {item.context?.currentTab && <span className="t-micro text-[var(--brand-text-muted)]">from: {item.context.currentTab}</span>}
                          {item.submittedBy && <span className="t-micro text-[var(--brand-text-muted)]">by: {item.submittedBy}</span>}
                        </div>

                        {/* Replies */}
                        {item.replies.length > 0 && (
                          <div className="mt-2 space-y-1.5">
                            {item.replies.map(r => (
                              <div key={r.id} className={cn('rounded-[var(--radius-lg)] px-2.5 py-1.5 t-caption-sm', r.author === 'team' ? 'bg-teal-500/5 border border-teal-500/10 text-accent-brand' : 'bg-[var(--surface-3)] border border-[var(--brand-border-hover)] text-[var(--brand-text)]')}>
                                <span className="font-medium">{r.author === 'team' ? 'You' : 'Client'}:</span> {r.content}
                              </div>
                            ))}
                          </div>
                        )}

                        {/* Actions */}
                        <div className="flex items-center gap-2 mt-2">
                          {item.status === 'new' && (
                            <button onClick={() => handleStatusChange(item.workspaceId, item.id, 'acknowledged')} className="t-micro px-2 py-1 rounded bg-amber-500/10 text-accent-warning hover:bg-amber-500/20 transition-colors">Acknowledge</button>
                          )}
                          {(item.status === 'new' || item.status === 'acknowledged') && (
                            <button onClick={() => handleStatusChange(item.workspaceId, item.id, 'fixed')} className="t-micro px-2 py-1 rounded bg-emerald-500/10 text-accent-success hover:bg-emerald-500/20 transition-colors">Resolve</button>
                          )}
                          {item.status !== 'wontfix' && item.status !== 'fixed' && (
                            <button onClick={() => handleStatusChange(item.workspaceId, item.id, 'wontfix')} className="t-micro px-2 py-1 rounded bg-[var(--surface-3)] text-[var(--brand-text-muted)] hover:bg-[var(--brand-border-hover)] hover:border-[var(--brand-border-hover)] border border-[var(--brand-border)] transition-colors">Won't Fix</button>
                          )}
                        </div>

                        {/* Reply input */}
                        {item.status !== 'fixed' && item.status !== 'wontfix' && (
                          <div className="flex gap-1.5 mt-2">
                            <input
                              type="text"
                              value={feedbackReply[item.id] || ''}
                              onChange={e => setFeedbackReply(prev => ({ ...prev, [item.id]: e.target.value }))}
                              onKeyDown={e => e.key === 'Enter' && handleReply(item.workspaceId, item.id)}
                              placeholder="Reply to client..."
                              className="flex-1 bg-[var(--surface-3)] border border-[var(--brand-border)] rounded-[var(--radius-lg)] px-2.5 py-1.5 t-caption-sm text-[var(--brand-text)] placeholder-[var(--brand-text-muted)] focus:outline-none focus:border-teal-500"
                            />
                            <button onClick={() => handleReply(item.workspaceId, item.id)} disabled={!feedbackReply[item.id]?.trim()} className="px-2 py-1.5 bg-teal-600 hover:bg-teal-500 disabled:opacity-40 rounded-[var(--radius-lg)] transition-colors">
                              <Icon as={Send} size="sm" className="text-white" />
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </SectionCard>
        );
      })()}

      {/* ── Recent Activity ── */}
      {recentActivity.length > 0 && (
        <SectionCard title="Recent Activity" titleIcon={<Icon as={Activity} size="md" className="text-[var(--brand-text-muted)]" />} noPadding>
          <div className="divide-y divide-[var(--brand-border)]">
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
              const EntryIcon = iconMap[entry.type] || Activity;
              return (
                <div
                  key={entry.id}
                  className="flex items-start gap-3 px-4 py-2.5"
                >
                  <EntryIcon className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-accent-brand" />
                  <div className="flex-1 min-w-0">
                    <div className="t-caption text-[var(--brand-text-bright)]">{entry.title}</div>
                    {entry.description && <div className="t-caption-sm mt-0.5 text-[var(--brand-text-muted)]">{entry.description}</div>}
                  </div>
                  <div className="flex-shrink-0 text-right">
                    {wsName && <div className="t-caption-sm text-[var(--brand-text-muted)]">{wsName}</div>}
                    <div className="t-caption-sm text-[var(--brand-text-muted)]">{timeAgo(entry.createdAt)}</div>
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
