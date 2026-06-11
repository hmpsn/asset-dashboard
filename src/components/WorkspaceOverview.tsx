import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useGlobalAdminEvents } from '../hooks/useGlobalAdminEvents';
import { useWorkspaceOverviewData } from '../hooks/admin';
import type { PresenceMap } from '../hooks/admin/useWorkspaceOverview';
import {
  Globe, Shield, MessageSquare, ClipboardCheck, AlertTriangle,
  CheckCircle2, ArrowUpRight, ArrowDownRight, Minus, Loader2,
  Search, BarChart3, Lock, ExternalLink, Bell, Activity, FileText, Zap,
  Map, Rocket, FileSearch, Clock, DollarSign, Flag, Layers, ChevronRight,
} from 'lucide-react';
import { Button, ClickableRow, MetricRingSvg, PageHeader, SectionCard, Badge, StatCard, Icon, cn } from './ui';
import { themeColor } from './ui/constants';
import { STUDIO_NAME } from '../constants';
import { timeAgo } from '../lib/timeAgo';
import { adminPath } from '../routes';

// Types imported from useWorkspaceOverview hook

// ScoreRing replaced by unified <MetricRingSvg /> from ./ui
const ScoreRing = MetricRingSvg;

export { AIUsageSection } from './AIUsageSection';

export function WorkspaceOverview({ onSelectWorkspace }: { onSelectWorkspace: (id: string) => void }) {
  const navigate = useNavigate();
  const { data: overviewData, isLoading: loading } = useWorkspaceOverviewData();

  const [attentionExpanded, setAttentionExpanded] = useState(false);

  // Real-time presence: WebSocket overrides query data via a state + ref trigger
  const [wsPresence, setWsPresence] = useState<PresenceMap | null>(null);
  const handlePresenceUpdate = useCallback((d: unknown) => {
    if (d && typeof d === 'object') setWsPresence(d as PresenceMap);
  }, []);
  useGlobalAdminEvents({ 'presence:update': handlePresenceUpdate });

  // Derive data from query result
  const data = overviewData?.workspaces ?? [];
  const recentActivity = overviewData?.recentActivity ?? [];
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
          <p className="t-body font-semibold mb-1 text-[var(--brand-text-bright)]">Welcome to {STUDIO_NAME}</p>
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
  const avgScore = data.filter(w => w.audit).length > 0
    ? Math.round(data.filter(w => w.audit).reduce((s, w) => s + (w.audit?.score || 0), 0) / data.filter(w => w.audit).length)
    : null;

  // Needs attention items — per workspace, priority sorted
  // Each item deep-links to the relevant admin tab for the specific workspace.
  type AttentionItem = {
    label: string;
    value: string;
    color: string;
    icon: typeof Bell;
    priority: number;
    href: string;
    wsName: string;
    ariaLabel: string;
  };
  const attentionItems: AttentionItem[] = [];

  // Churn risk (priority 1 = critical, 1.5 = warning only) — link to requests page
  for (const ws of data) {
    const critical = ws.churnSignals?.critical || 0;
    const warning = ws.churnSignals?.warning || 0;
    if (critical > 0 || warning > 0) {
      const priority = critical > 0 ? 1 : 1.5;
      const color = critical > 0 ? 'text-accent-danger' : 'text-accent-warning';
      const label = 'At risk of churn';
      attentionItems.push({ label, value: 'Churn', color, icon: Flag, priority, href: adminPath(ws.id, 'requests'), wsName: ws.name, ariaLabel: `${label} · ${ws.name}` });
    }
  }

  // New client requests (priority 2) — link to requests page
  for (const ws of data) {
    if (ws.requests.new > 0) {
      const n = ws.requests.new;
      const label = `${n} new client request${n > 1 ? 's' : ''}`;
      attentionItems.push({ label, value: 'Requests', color: 'text-accent-danger', icon: Bell, priority: 2, href: adminPath(ws.id, 'requests'), wsName: ws.name, ariaLabel: `${label} · ${ws.name}` });
    }
  }

  // Pending approvals (priority 3) — link to seo-editor (where client SEO changes are reviewed)
  for (const ws of data) {
    if (ws.approvals.pending > 0) {
      const n = ws.approvals.pending;
      const label = `${n} pending approval${n > 1 ? 's' : ''}`;
      attentionItems.push({ label, value: 'Approvals', color: 'text-accent-brand', icon: ClipboardCheck, priority: 3, href: adminPath(ws.id, 'seo-editor'), wsName: ws.name, ariaLabel: `${label} · ${ws.name}` });
    }
  }

  // Content briefs awaiting review (priority 4) — link to content-pipeline?tab=briefs
  for (const ws of data) {
    const pending = ws.contentRequests?.pending || 0;
    if (pending > 0) {
      const label = `${pending} content brief${pending > 1 ? 's' : ''} awaiting review`;
      attentionItems.push({ label, value: 'Content', color: 'text-accent-warning', icon: FileText, priority: 4, href: adminPath(ws.id, 'content-pipeline') + '?tab=briefs', wsName: ws.name, ariaLabel: `${label} · ${ws.name}` });
    }
  }

  // Pending work orders (priority 5) — link to requests page (ClientDeliverablesPane)
  for (const ws of data) {
    const pending = ws.workOrders?.pending || 0;
    if (pending > 0) {
      const label = `${pending} purchased fix${pending > 1 ? 'es' : ''} awaiting fulfillment`;
      attentionItems.push({ label, value: 'Work Orders', color: 'text-accent-brand', icon: ClipboardCheck, priority: 5, href: adminPath(ws.id, 'requests'), wsName: ws.name, ariaLabel: `${label} · ${ws.name}` });
    }
  }

  // Rejected changes (priority 6) — link to seo-editor
  for (const ws of data) {
    const rejected = ws.pageStates?.rejected || 0;
    if (rejected > 0) {
      const label = `${rejected} rejected change${rejected > 1 ? 's' : ''} need revision`;
      attentionItems.push({ label, value: 'Rejected', color: 'text-accent-danger', icon: AlertTriangle, priority: 6, href: adminPath(ws.id, 'seo-editor'), wsName: ws.name, ariaLabel: `${label} · ${ws.name}` });
    }
  }

  // Low health score < 60 (priority 7) — link to seo-audit, show per-workspace score
  for (const ws of data) {
    if (ws.audit && ws.audit.score < 60) {
      const label = `Health score ${ws.audit.score} — needs attention`;
      attentionItems.push({ label, value: 'Health', color: 'text-accent-danger', icon: AlertTriangle, priority: 7, href: adminPath(ws.id, 'seo-audit'), wsName: ws.name, ariaLabel: `Health score ${ws.audit.score} · ${ws.name}` });
    }
  }

  // No site linked (priority 8) — link to workspace-settings?tab=connections
  for (const ws of data) {
    if (!ws.webflowSiteId) {
      const label = 'No site linked · connect Webflow';
      attentionItems.push({ label, value: 'Setup', color: 'text-accent-warning', icon: Globe, priority: 8, href: adminPath(ws.id, 'workspace-settings') + '?tab=connections', wsName: ws.name, ariaLabel: `No site linked · connect Webflow · ${ws.name}` });
    }
  }

  attentionItems.sort((a, b) => a.priority - b.priority);

  const ATTENTION_CAP = 8;

  return (
    <div className="space-y-8">
      <PageHeader
        title="Command Center"
        subtitle={`${data.length} workspace${data.length !== 1 ? 's' : ''} · ${new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}`}
        icon={<Icon as={Rocket} size="lg" className="text-accent-brand" />}
        actions={
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" icon={FileSearch} onClick={() => navigate(adminPath('', 'prospect'))} className="px-3 py-1.5 rounded-[var(--radius-lg)] t-caption-sm font-medium text-[var(--brand-text-muted)] hover:text-[var(--brand-text-bright)] bg-[var(--surface-3)] hover:bg-[var(--brand-border-hover)] border border-[var(--brand-border)] hover:border-[var(--brand-border-hover)]">Prospect</Button>
            <Button variant="secondary" size="sm" icon={Map} onClick={() => navigate(adminPath('', 'roadmap'))} className="px-3 py-1.5 rounded-[var(--radius-lg)] t-caption-sm font-medium text-[var(--brand-text-muted)] hover:text-[var(--brand-text-bright)] bg-[var(--surface-3)] hover:bg-[var(--brand-border-hover)] border border-[var(--brand-border)] hover:border-[var(--brand-border-hover)]">Roadmap</Button>
            <Button variant="secondary" size="sm" icon={Zap} onClick={() => navigate(adminPath('', 'ai-usage'))} className="px-3 py-1.5 rounded-[var(--radius-lg)] t-caption-sm font-medium text-accent-warning hover:text-accent-warning bg-amber-500/5 hover:bg-amber-500/10 border border-amber-500/20">AI Usage</Button>
            <Button variant="secondary" size="sm" icon={DollarSign} onClick={() => navigate(adminPath('', 'revenue'))} className="px-3 py-1.5 rounded-[var(--radius-lg)] t-caption-sm font-medium text-accent-success hover:text-accent-success bg-emerald-500/5 hover:bg-emerald-500/10 border border-emerald-500/20">Revenue</Button>
            <Button variant="secondary" size="sm" icon={Layers} onClick={() => navigate(adminPath('', 'features'))} className="px-3 py-1.5 rounded-[var(--radius-lg)] t-caption-sm font-medium text-accent-brand hover:text-accent-brand bg-teal-500/5 hover:bg-teal-500/10 border border-teal-500/20">Features</Button>
          </div>
        }
      />

      {/* ── Needs Attention ── */}
      {attentionItems.length > 0 && (
        <SectionCard title="Needs Attention" titleIcon={<Icon as={AlertTriangle} size="md" className="text-accent-warning" />} noPadding>
          <div className="divide-y divide-[var(--brand-border)]">
            {(attentionExpanded ? attentionItems : attentionItems.slice(0, ATTENTION_CAP)).map((item) => {
              const ItemIcon = item.icon;
              return (
                <ClickableRow
                  key={`${item.href}-${item.value}`}
                  onClick={() => navigate(item.href)}
                  aria-label={item.ariaLabel}
                  className="flex items-center gap-3 px-4 py-2.5"
                >
                  <ItemIcon className={cn('w-3.5 h-3.5 flex-shrink-0', item.color)} />
                  <span className="t-caption text-[var(--brand-text-bright)] flex-1">{item.label}</span>
                  <span className="t-caption-sm text-[var(--brand-text-muted)] flex-shrink-0">{item.wsName}</span>
                  <Badge label={item.value} tone="zinc" />
                  <ChevronRight className="w-3 h-3 flex-shrink-0 text-accent-brand opacity-60" />
                </ClickableRow>
              );
            })}
            {attentionItems.length > ATTENTION_CAP && (
              <Button
                variant="ghost"
                onClick={() => setAttentionExpanded(e => !e)}
                className="w-full px-4 py-2 t-caption-sm text-[var(--brand-text-muted)] hover:text-[var(--brand-text-bright)] justify-start"
              >
                {attentionExpanded
                  ? 'Show less'
                  : `Show ${attentionItems.length - ATTENTION_CAP} more`}
              </Button>
            )}
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
              <div className="relative flex h-3 w-3">
                <div className="animate-ping absolute inline-flex h-full w-full rounded-[var(--radius-pill)] bg-emerald-400 opacity-75" />
                <div className="relative inline-flex rounded-[var(--radius-pill)] h-3 w-3 bg-emerald-500" />
              </div>
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
                    <Badge label={u.role === 'admin' ? 'Admin' : 'Client'} tone={u.role === 'admin' ? 'blue' : 'emerald'} />
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
              <ClickableRow
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
                  <Badge
                    label={`${ws.requests.new} new`}
                    tone="red"
                    variant="solid"
                    shape="pill"
                    size="md"
                    icon={Bell}
                    className="absolute -top-2 -right-2 shadow-lg"
                  />
                )}

                {/* Online users banner */}
                {onlineUsers.length > 0 && (
                  <div className="flex items-center gap-2 px-3 py-1.5 -mx-5 -mt-5 mb-3 rounded-t-xl bg-emerald-500/10 border-b border-emerald-500/20">
                    <div className="relative flex h-2.5 w-2.5">
                      <div className="animate-ping absolute inline-flex h-full w-full rounded-[var(--radius-pill)] bg-emerald-400 opacity-75" />
                      <div className="relative inline-flex rounded-[var(--radius-pill)] h-2.5 w-2.5 bg-emerald-500" />
                    </div>
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
                      <Badge
                        label="At Risk"
                        tone={(ws.churnSignals?.critical || 0) > 0 ? 'red' : 'amber'}
                        variant="outline"
                        icon={Flag}
                        className="flex-shrink-0 font-bold"
                      />
                    )}
                    {ws.isTrial && (
                      <Badge
                        label={`Trial${ws.trialDaysRemaining != null ? ` · ${ws.trialDaysRemaining}d` : ''}`}
                        tone="amber"
                        variant="outline"
                        className="flex-shrink-0 font-bold"
                      />
                    )}
                    {ws.tier && ws.tier !== 'free' && !ws.isTrial && (
                      <Badge label={ws.tier} tone="teal" variant="outline" className="flex-shrink-0 font-bold" />
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
                          {(ws.pageStates?.issueDetected || 0) > 0 && <Badge label={`${ws.pageStates!.issueDetected} issues`} tone="amber" variant="outline" />}
                          {(ws.pageStates?.inReview || 0) > 0 && <Badge label={`${ws.pageStates!.inReview} in review`} tone="teal" variant="outline" />}
                          {(ws.pageStates?.approved || 0) > 0 && <Badge label={`${ws.pageStates!.approved} approved`} tone="emerald" variant="outline" />}
                          {(ws.pageStates?.rejected || 0) > 0 && <Badge label={`${ws.pageStates!.rejected} rejected`} tone="red" variant="outline" />}
                          {(ws.pageStates?.live || 0) > 0 && <Badge label={`${ws.pageStates!.live} live`} tone="teal" variant="outline" />}
                        </div>
                      </div>
                    </>
                  )}
                </div>
              </ClickableRow>
            );
          })}
        </div>
      </div>

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
                rank_tracking_updated: Search,
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
