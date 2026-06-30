import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useGlobalAdminEvents } from '../hooks/useGlobalAdminEvents';
import { useWorkspaceOverviewData } from '../hooks/admin';
import type { PresenceMap } from '../hooks/admin/useWorkspaceOverview';
import {
  Globe, Shield, MessageSquare, ClipboardCheck, AlertTriangle,
  CheckCircle2, ArrowUpRight, ArrowDownRight, Loader2,
  Search, BarChart3, Lock, ExternalLink, Bell, Activity, FileText, Zap,
  Map, Rocket, FileSearch, Clock, DollarSign, Flag, Layers,
  MoreHorizontal,
} from 'lucide-react';
import { Button, ClickableRow, MetricRingSvg, PageHeader, SectionCard, Badge, StatCard, Icon, cn, NeedsAttention, Menu, Disclosure } from './ui';
import type { AttentionItem as PrimitiveAttentionItem } from './ui';
import { themeColor, CHART_SERIES_COLORS } from './ui/constants';
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
  const totalActiveRequests = data.reduce((s, w) => s + w.requests.active, 0);
  const totalPendingContent = data.reduce((s, w) => s + (w.contentRequests?.pending || 0), 0);
  const totalInProgressContent = data.reduce((s, w) => s + (w.contentRequests?.inProgress || 0), 0);
  const totalDeliveredContent = data.reduce((s, w) => s + (w.contentRequests?.delivered || 0), 0);
  const avgScore = data.filter(w => w.audit).length > 0
    ? Math.round(data.filter(w => w.audit).reduce((s, w) => s + (w.audit?.score || 0), 0) / data.filter(w => w.audit).length)
    : null;

  // Needs attention items — per workspace, priority sorted
  // Each item deep-links to the relevant admin tab for the specific workspace.
  type InternalAttentionItem = {
    id: string;
    label: string;
    severity: PrimitiveAttentionItem['severity'];
    icon: PrimitiveAttentionItem['icon'];
    priority: number;
    href: string;
    meta: string;
    badge: string;
  };
  const rawAttentionItems: InternalAttentionItem[] = [];

  // Churn risk (priority 1 = critical, 1.5 = warning only) — link to requests page
  for (const ws of data) {
    const critical = ws.churnSignals?.critical || 0;
    const warning = ws.churnSignals?.warning || 0;
    if (critical > 0 || warning > 0) {
      const priority = critical > 0 ? 1 : 1.5;
      const severity: PrimitiveAttentionItem['severity'] = critical > 0 ? 'critical' : 'warning';
      rawAttentionItems.push({ id: `churn-${ws.id}`, label: 'At risk of churn', severity, icon: Flag, priority, href: adminPath(ws.id, 'requests'), meta: ws.name, badge: 'Churn' });
    }
  }

  // New client requests (priority 2) — link to requests page
  for (const ws of data) {
    if (ws.requests.new > 0) {
      const n = ws.requests.new;
      const label = `${n} new client request${n > 1 ? 's' : ''}`;
      rawAttentionItems.push({ id: `requests-${ws.id}`, label, severity: 'critical', icon: Bell, priority: 2, href: adminPath(ws.id, 'requests'), meta: ws.name, badge: 'Requests' });
    }
  }

  // Pending approvals (priority 3) — link to seo-editor (where client SEO changes are reviewed)
  for (const ws of data) {
    if (ws.approvals.pending > 0) {
      const n = ws.approvals.pending;
      const label = `${n} pending approval${n > 1 ? 's' : ''}`;
      rawAttentionItems.push({ id: `approvals-${ws.id}`, label, severity: 'info', icon: ClipboardCheck, priority: 3, href: adminPath(ws.id, 'seo-editor'), meta: ws.name, badge: 'Approvals' });
    }
  }

  // Content briefs awaiting review (priority 4) — link to content-pipeline?tab=briefs
  for (const ws of data) {
    const pending = ws.contentRequests?.pending || 0;
    if (pending > 0) {
      const label = `${pending} content brief${pending > 1 ? 's' : ''} awaiting review`;
      rawAttentionItems.push({ id: `content-${ws.id}`, label, severity: 'warning', icon: FileText, priority: 4, href: adminPath(ws.id, 'content-pipeline') + '?tab=briefs', meta: ws.name, badge: 'Content' });
    }
  }

  // Pending work orders (priority 5) — link to requests page (ClientDeliverablesPane)
  for (const ws of data) {
    const pending = ws.workOrders?.pending || 0;
    if (pending > 0) {
      const label = `${pending} purchased fix${pending > 1 ? 'es' : ''} awaiting fulfillment`;
      rawAttentionItems.push({ id: `workorders-${ws.id}`, label, severity: 'info', icon: ClipboardCheck, priority: 5, href: adminPath(ws.id, 'requests'), meta: ws.name, badge: 'Work Orders' });
    }
  }

  // Rejected changes (priority 6) — link to seo-editor
  for (const ws of data) {
    const rejected = ws.pageStates?.rejected || 0;
    if (rejected > 0) {
      const label = `${rejected} rejected change${rejected > 1 ? 's' : ''} need revision`;
      rawAttentionItems.push({ id: `rejected-${ws.id}`, label, severity: 'critical', icon: AlertTriangle, priority: 6, href: adminPath(ws.id, 'seo-editor'), meta: ws.name, badge: 'Rejected' });
    }
  }

  // Low health score < 60 (priority 7) — link to seo-audit, show per-workspace score
  for (const ws of data) {
    if (ws.audit && ws.audit.score < 60) {
      const label = `Health score ${ws.audit.score} — needs attention`;
      rawAttentionItems.push({ id: `health-${ws.id}`, label, severity: 'critical', icon: AlertTriangle, priority: 7, href: adminPath(ws.id, 'seo-audit'), meta: ws.name, badge: 'Health' });
    }
  }

  // No site linked (priority 8) — link to workspace-settings?tab=connections
  for (const ws of data) {
    if (!ws.webflowSiteId) {
      const label = 'No site linked · connect Webflow';
      rawAttentionItems.push({ id: `nosite-${ws.id}`, label, severity: 'warning', icon: Globe, priority: 8, href: adminPath(ws.id, 'workspace-settings') + '?tab=connections', meta: ws.name, badge: 'Setup' });
    }
  }

  rawAttentionItems.sort((a, b) => a.priority - b.priority);

  // Map to the primitive's AttentionItem shape
  const attentionItems: PrimitiveAttentionItem[] = rawAttentionItems.map(item => ({
    id: item.id,
    label: item.label,
    severity: item.severity,
    icon: item.icon,
    href: item.href,
    meta: item.meta,
    badge: item.badge,
  }));

  return (
    <div className="space-y-8">
      {/* ── Header: one primary action + More overflow ── */}
      <PageHeader
        title="Command Center"
        subtitle={`${data.length} workspace${data.length !== 1 ? 's' : ''} · ${new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}`}
        icon={<Icon as={Rocket} size="lg" className="text-accent-brand" />}
        actions={
          <div className="flex items-center gap-2">
            {/* Single primary CTA — Prospect is the entry action (finding/onboarding clients) */}
            <Button
              variant="primary"
              size="sm"
              icon={FileSearch}
              onClick={() => navigate(adminPath('', 'prospect'))}
              data-testid="header-primary-action"
            >
              Prospect
            </Button>
            {/* All other destinations in a neutral More overflow */}
            <Menu
              trigger={
                <Button variant="secondary" size="sm" icon={MoreHorizontal} data-testid="header-more-menu">
                  More
                </Button>
              }
              items={[
                { label: 'Roadmap', icon: Map, onSelect: () => navigate(adminPath('', 'roadmap')) },
                { label: 'AI Usage', icon: Zap, onSelect: () => navigate(adminPath('', 'ai-usage')) },
                { label: 'Revenue', icon: DollarSign, onSelect: () => navigate(adminPath('', 'revenue')) },
                { label: 'Features', icon: Layers, onSelect: () => navigate(adminPath('', 'features')) },
              ]}
              align="end"
            />
          </div>
        }
      />

      {/* ── T1.2: Needs Attention — hero block, first under PageHeader ── */}
      {attentionItems.length > 0 && (
        <NeedsAttention items={attentionItems} cap={8} showCount />
      )}

      {/* ── T1.3: Global Stats — Hours Saved as hero, drop New Requests + Approvals ── */}
      <div className="grid grid-cols-2 sm:grid-cols-[1fr_1fr_1fr_1fr] lg:grid-cols-[2fr_1fr_1fr_1fr] gap-3">
        <StatCard
          label="Hours Saved"
          value={timeSaved ? `${timeSaved.totalHoursSaved}h` : '—'}
          icon={Clock}
          iconColor={timeSaved && timeSaved.totalHoursSaved > 0 ? CHART_SERIES_COLORS.blue : themeColor('#71717a', '#94a3b8') /* chart-hex-ok — inactive zinc via themeColor */}
          sub={timeSaved ? `${timeSaved.operationCount} AI ops this month` : undefined}
          size="hero"
          className="col-span-2 sm:col-span-2 lg:col-span-1"
        />
        <StatCard
          label="Active Requests"
          value={totalActiveRequests}
          icon={MessageSquare}
          iconColor={totalActiveRequests > 0 ? CHART_SERIES_COLORS.amber : themeColor('#71717a', '#94a3b8') /* chart-hex-ok — inactive zinc via themeColor */}
        />
        <StatCard
          label="Content Pipeline"
          value={`${totalPendingContent + totalInProgressContent}/${totalDeliveredContent}`}
          icon={FileText}
          iconColor={totalPendingContent > 0 ? CHART_SERIES_COLORS.amber : totalInProgressContent > 0 ? CHART_SERIES_COLORS.blue : themeColor('#71717a', '#94a3b8') /* chart-hex-ok — inactive zinc via themeColor */}
        />
        <StatCard
          label="Avg Health"
          value={avgScore !== null ? avgScore : '—'}
          icon={Shield}
          iconColor={avgScore !== null ? (avgScore >= 80 ? CHART_SERIES_COLORS.emerald : avgScore >= 60 ? CHART_SERIES_COLORS.amber : CHART_SERIES_COLORS.red) : themeColor('#71717a', '#94a3b8') /* chart-hex-ok — inactive zinc via themeColor */}
        />
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

      {/* ── T1.4: Workspace Cards — lead with score + name + rollup pill ── */}
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

            // "N need you" rollup — sum of the actionable per-workspace counts.
            // Intentionally EXCLUDES state signals (churn, health<60, no-site-linked):
            // those surface as their own NeedsAttention rows, not action-queue counts.
            const needsYouCount =
              ws.requests.new +
              ws.approvals.pending +
              (ws.contentRequests?.pending || 0) +
              (ws.workOrders?.pending || 0) +
              (ws.pageStates?.rejected || 0);
            // Pill tone follows the highest severity among those items so an
            // approvals/work-orders-only workspace shows info-blue, not a red alarm.
            const needsYouTone =
              (ws.requests.new > 0 || (ws.pageStates?.rejected || 0) > 0) ? 'red'
                : (ws.contentRequests?.pending || 0) > 0 ? 'amber'
                : 'blue';

            return (
              <div
                key={ws.id}
                className={cn(
                  'transition-all hover:shadow-lg group relative bg-[var(--surface-2)] border overflow-hidden',
                  onlineUsers.length > 0 ? 'border-emerald-500/40'
                    : isAtRisk && (ws.churnSignals?.critical || 0) > 0 ? 'border-red-500/30'
                    : hasAlerts || isAtRisk ? 'border-amber-500/30'
                    : 'border-[var(--brand-border)]'
                )}
                style={{ borderRadius: 'var(--radius-signature-lg)' /* pr-check-disable-next-line -- Workspace selector cards are list items with custom presence/risk borders. */ }}
              >
                {/* Online users banner */}
                {onlineUsers.length > 0 && (
                  <div className="flex items-center gap-2 px-4 py-1.5 -mx-0 -mt-0 mb-3 rounded-t-xl bg-emerald-500/10 border-b border-emerald-500/20">
                    <div className="relative flex h-2.5 w-2.5">
                      <div className="animate-ping absolute inline-flex h-full w-full rounded-[var(--radius-pill)] bg-emerald-400 opacity-75" />
                      <div className="relative inline-flex rounded-[var(--radius-pill)] h-2.5 w-2.5 bg-emerald-500" />
                    </div>
                    <span className="t-caption-sm font-semibold text-accent-success">
                      {onlineUsers.map(u => u.name || u.email.split('@')[0]).join(', ')} online now
                    </span>
                  </div>
                )}

                {/* ── Lead row (clickable to open the workspace) ── */}
                <ClickableRow onClick={() => onSelectWorkspace(ws.id)} className="w-full text-left">
                  <div className="flex items-center gap-4 p-5 pb-3">
                  {/* Health score ring — band-colored */}
                  <div className="flex-shrink-0">
                    {ws.audit ? (
                      <ScoreRing score={ws.audit.score} size={44} strokeWidth={3.5} />
                    ) : (
                      <div className="w-11 h-11 rounded-[var(--radius-pill)] bg-[var(--surface-3)] border border-[var(--brand-border)] flex items-center justify-center">
                        <Icon as={Shield} size="md" className="text-[var(--brand-text-muted)]" />
                      </div>
                    )}
                  </div>

                  {/* Name + status badges */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="t-caption font-semibold group-hover:text-accent-brand transition-colors text-[var(--brand-text-bright)] truncate">
                        {ws.name}
                      </h3>
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
                    {/* Score delta + site info line */}
                    <div className="flex items-center gap-2 mt-0.5 t-caption-sm text-[var(--brand-text-muted)]">
                      {ws.audit && scoreDelta !== null && scoreDelta !== 0 && (
                        <span className={cn('flex items-center font-medium', scoreDelta > 0 ? 'text-accent-success' : 'text-accent-danger')}>
                          {scoreDelta > 0 ? <ArrowUpRight className="w-2.5 h-2.5" /> : <ArrowDownRight className="w-2.5 h-2.5" />}
                          {Math.abs(scoreDelta)}
                        </span>
                      )}
                      {ws.webflowSiteName && <span className="flex items-center gap-1"><Icon as={Globe} size="sm" />{ws.webflowSiteName}</span>}
                      {!ws.webflowSiteId && <span className="flex items-center gap-1 text-accent-warning"><Icon as={AlertTriangle} size="sm" />No site linked</span>}
                      {ws.hasGsc && <span className="flex items-center gap-1"><Icon as={Search} size="sm" />GSC</span>}
                      {ws.hasGa4 && <span className="flex items-center gap-1"><Icon as={BarChart3} size="sm" />GA4</span>}
                      {ws.hasPassword && <span className="flex items-center gap-1"><Icon as={Lock} size="sm" />Client</span>}
                    </div>
                  </div>

                  {/* Right: "N need you" rollup pill + open indicator */}
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {needsYouCount > 0 && (
                      <Badge
                        label={`${needsYouCount} need you`}
                        tone={needsYouTone}
                        variant="solid"
                        shape="pill"
                        data-testid="needs-you-pill"
                      />
                    )}
                    <Icon as={ExternalLink} size="sm" className="shrink-0 opacity-0 group-hover:opacity-60 transition-opacity" />
                  </div>
                </div>
                </ClickableRow>

                {/* ── Breakdown: sibling of the row (NOT nested inside the ClickableRow button) ── */}
                <div className="px-5 pb-4">
                  <Disclosure
                    summary={
                      <span className="t-caption-sm text-[var(--brand-text-muted)] font-normal">Details</span>
                    }
                  >
                    <div className="flex items-start gap-6 flex-wrap pt-2">
                      {/* Requests */}
                      <div>
                        <div className="t-caption-sm font-medium text-[var(--brand-text-muted)] mb-0.5">Requests</div>
                        {ws.requests.total > 0 ? (
                          <div className="flex items-center gap-2 t-caption-sm">
                            {ws.requests.new > 0 && <span className="text-accent-danger font-medium">{ws.requests.new} new</span>}
                            {ws.requests.active > 0 && <span className="text-[var(--brand-text)]">{ws.requests.active} active</span>}
                            {ws.requests.latestDate && <span className="text-[var(--brand-text-muted)]">{timeAgo(ws.requests.latestDate)}</span>}
                          </div>
                        ) : (
                          <div className="t-caption-sm text-[var(--brand-text-muted)]">None</div>
                        )}
                      </div>

                      <div className="w-px h-8 bg-[var(--brand-border)] self-center" />

                      {/* Approvals */}
                      <div>
                        <div className="t-caption-sm font-medium text-[var(--brand-text-muted)] mb-0.5">Approvals</div>
                        {ws.approvals.total > 0 ? (
                          ws.approvals.pending > 0 ? (
                            <div className="t-caption-sm text-[var(--brand-text)] font-medium">{ws.approvals.pending} pending</div>
                          ) : (
                            <div className="flex items-center gap-1 t-caption-sm text-accent-success">
                              <CheckCircle2 className="w-2.5 h-2.5" /> All clear
                            </div>
                          )
                        ) : (
                          <div className="t-caption-sm text-[var(--brand-text-muted)]">None</div>
                        )}
                      </div>

                      <div className="w-px h-8 bg-[var(--brand-border)] self-center" />

                      {/* Content Pipeline */}
                      <div>
                        <div className="t-caption-sm font-medium text-[var(--brand-text-muted)] mb-0.5">Content</div>
                        {(ws.contentRequests?.total || 0) > 0 ? (
                          <div className="flex items-center gap-2 t-caption-sm">
                            {(ws.contentRequests?.pending || 0) > 0 && <span className="text-[var(--brand-text)] font-medium">{ws.contentRequests!.pending} pending</span>}
                            {(ws.contentRequests?.inProgress || 0) > 0 && <span className="text-[var(--brand-text)]">{ws.contentRequests!.inProgress} in progress</span>}
                            {(ws.contentRequests?.delivered || 0) > 0 && <span className="text-accent-success">{ws.contentRequests!.delivered} delivered</span>}
                          </div>
                        ) : (
                          <div className="t-caption-sm text-[var(--brand-text-muted)]">None</div>
                        )}
                      </div>

                      {/* SEO Status (inline badges) */}
                      {(ws.pageStates?.total || 0) > 0 && (
                        <>
                          <div className="w-px h-8 bg-[var(--brand-border)] self-center" />
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

                      {/* Health detail */}
                      {ws.audit && (ws.audit.errors > 0 || ws.audit.warnings > 0) && (
                        <>
                          <div className="w-px h-8 bg-[var(--brand-border)] self-center" />
                          <div>
                            <div className="t-caption-sm font-medium text-[var(--brand-text-muted)] mb-0.5">Issues</div>
                            <div className="t-caption-sm">
                              {ws.audit.errors > 0 && <span className="text-accent-danger">{ws.audit.errors} err</span>}
                              {ws.audit.errors > 0 && ws.audit.warnings > 0 && ' · '}
                              {ws.audit.warnings > 0 && <span className="text-accent-warning">{ws.audit.warnings} warn</span>}
                            </div>
                          </div>
                        </>
                      )}
                    </div>
                  </Disclosure>
                </div>
              </div>
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
                  <EntryIcon className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-accent-info" />
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
