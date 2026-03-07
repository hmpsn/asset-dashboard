import { useState, useEffect } from 'react';
import {
  Globe, Shield, MessageSquare, ClipboardCheck, AlertTriangle,
  CheckCircle2, ArrowUpRight, ArrowDownRight, Minus, Loader2,
  Search, BarChart3, Lock, ExternalLink, Bell, Activity, FileText, Zap,
  Map, Clock, Circle, Rocket, Wifi, WifiOff, Key, Mail, FileSearch, CreditCard,
} from 'lucide-react';
import { MetricRingSvg, PageHeader, SectionCard, Badge, StatCard } from './ui';
import { StripeSettings } from './StripeSettings';

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
  contentRequests?: { pending: number; total: number };
}

interface HealthStatus {
  hasOpenAIKey: boolean;
  hasWebflowToken: boolean;
  hasGoogleAuth: boolean;
  hasEmailConfig: boolean;
  hasStripe: boolean;
}

// ScoreRing replaced by unified <MetricRingSvg /> from ./ui
const ScoreRing = MetricRingSvg;

/* ── Roadmap sprint shape from API ── */
interface RoadmapSprint {
  id: string;
  name: string;
  hours: string;
  items: Array<{ id: number; status: string }>;
}

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
  const [roadmapSprints, setRoadmapSprints] = useState<RoadmapSprint[]>([]);
  const [health, setHealth] = useState<HealthStatus | null>(null);

  useEffect(() => {
    Promise.all([
      fetch('/api/workspace-overview').then(r => r.json()),
      fetch('/api/activity?limit=15').then(r => r.json()).catch(() => []),
      fetch('/api/roadmap').then(r => r.ok ? r.json() : null).catch(() => null),
      fetch('/api/health').then(r => r.json()).catch(() => null),
    ]).then(([d, act, rm, h]) => {
      if (Array.isArray(d)) setData(d);
      if (Array.isArray(act)) setRecentActivity(act);
      if (rm?.sprints && Array.isArray(rm.sprints)) setRoadmapSprints(rm.sprints);
      if (h) setHealth(h as HealthStatus);
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
  const avgScore = data.filter(w => w.audit).length > 0
    ? Math.round(data.filter(w => w.audit).reduce((s, w) => s + (w.audit?.score || 0), 0) / data.filter(w => w.audit).length)
    : null;

  // Roadmap stats (derived from API data)
  const allRoadmapItems = roadmapSprints.flatMap(s => s.items);
  const totalRoadmapItems = allRoadmapItems.length;
  const roadmapDone = allRoadmapItems.filter(i => i.status === 'done').length;
  const roadmapInProgress = allRoadmapItems.filter(i => i.status === 'in_progress').length;
  const roadmapPct = totalRoadmapItems > 0 ? Math.round((roadmapDone / totalRoadmapItems) * 100) : 0;

  // Current sprint (first sprint with incomplete items)
  const currentSprint = roadmapSprints.find(s =>
    s.items.some(i => i.status !== 'done')
  );

  // Needs attention items
  const attentionItems: Array<{ label: string; value: string; color: string; icon: typeof Bell }> = [];
  if (totalNewRequests > 0) attentionItems.push({ label: `${totalNewRequests} new client request${totalNewRequests > 1 ? 's' : ''}`, value: 'Requests', color: 'text-red-400', icon: Bell });
  if (totalPendingApprovals > 0) attentionItems.push({ label: `${totalPendingApprovals} pending approval${totalPendingApprovals > 1 ? 's' : ''}`, value: 'Approvals', color: 'text-teal-400', icon: ClipboardCheck });
  if (totalPendingContent > 0) attentionItems.push({ label: `${totalPendingContent} content brief${totalPendingContent > 1 ? 's' : ''} awaiting review`, value: 'Content', color: 'text-amber-400', icon: FileText });
  const lowScoreWorkspaces = data.filter(w => w.audit && w.audit.score < 60);
  if (lowScoreWorkspaces.length > 0) attentionItems.push({ label: `${lowScoreWorkspaces.length} workspace${lowScoreWorkspaces.length > 1 ? 's' : ''} with health score below 60`, value: 'Health', color: 'text-red-400', icon: AlertTriangle });
  const unlinkWorkspaces = data.filter(w => !w.webflowSiteId);
  if (unlinkWorkspaces.length > 0) attentionItems.push({ label: `${unlinkWorkspaces.length} workspace${unlinkWorkspaces.length > 1 ? 's' : ''} with no site linked`, value: 'Setup', color: 'text-amber-400', icon: Globe });

  // Platform connections
  const connections = [
    { label: 'OpenAI', ok: health?.hasOpenAIKey, icon: Key },
    { label: 'Webflow', ok: health?.hasWebflowToken, icon: Globe },
    { label: 'Google Auth', ok: health?.hasGoogleAuth, icon: Search },
    { label: 'Email', ok: health?.hasEmailConfig, icon: Mail },
    { label: 'Stripe', ok: health?.hasStripe, icon: CreditCard },
  ];

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
        <StatCard label="Content Briefs" value={totalPendingContent} icon={ClipboardCheck} iconColor={totalPendingContent > 0 ? '#f59e0b' : '#71717a'} />
        <StatCard label="Approvals" value={totalPendingApprovals} icon={ClipboardCheck} iconColor={totalPendingApprovals > 0 ? '#2dd4bf' : '#71717a'} />
        <StatCard label="Avg Health" value={avgScore !== null ? avgScore : '—'} icon={Shield} iconColor={avgScore !== null ? (avgScore >= 80 ? '#4ade80' : avgScore >= 60 ? '#fbbf24' : '#f87171') : '#71717a'} />
      </div>

      {/* ── Workspace Cards ── */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <Globe className="w-4 h-4 text-zinc-500" />
          <h2 className="text-sm font-semibold text-zinc-200">Workspaces</h2>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {data.map(ws => {
            const hasAlerts = ws.requests.new > 0 || ws.approvals.pending > 0 || (ws.contentRequests?.pending || 0) > 0;
            const scoreDelta = ws.audit && ws.audit.previousScore != null ? ws.audit.score - ws.audit.previousScore : null;

            return (
              <button
                key={ws.id}
                onClick={() => onSelectWorkspace(ws.id)}
                className={`text-left rounded-xl p-5 transition-all hover:scale-[1.01] hover:shadow-lg group relative bg-zinc-900 border ${hasAlerts ? 'border-amber-500/30' : 'border-zinc-800'}`}
              >
                {/* New request badge */}
                {ws.requests.new > 0 && (
                  <div className="absolute -top-2 -right-2 flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-red-500 text-white shadow-lg">
                    <Bell className="w-2.5 h-2.5" /> {ws.requests.new} new
                  </div>
                )}

                {/* Top row: name + site */}
                <div className="flex items-start justify-between gap-3 mb-4">
                  <div className="min-w-0">
                    <h3 className="text-sm font-semibold truncate group-hover:text-teal-400 transition-colors text-zinc-200">{ws.name}</h3>
                    <div className="flex items-center gap-2 mt-1 text-[11px] text-zinc-500">
                      {ws.webflowSiteName && <span className="flex items-center gap-1"><Globe className="w-2.5 h-2.5" />{ws.webflowSiteName}</span>}
                      {!ws.webflowSiteId && <span className="flex items-center gap-1 text-amber-400"><AlertTriangle className="w-2.5 h-2.5" />No site linked</span>}
                      {ws.hasGsc && <span className="flex items-center gap-1"><Search className="w-2.5 h-2.5" />GSC</span>}
                      {ws.hasGa4 && <span className="flex items-center gap-1"><BarChart3 className="w-2.5 h-2.5" />GA4</span>}
                      {ws.hasPassword && <span className="flex items-center gap-1"><Lock className="w-2.5 h-2.5" />Client</span>}
                    </div>
                  </div>
                  <ExternalLink className="w-4 h-4 shrink-0 opacity-0 group-hover:opacity-60 transition-opacity text-zinc-500" />
                </div>

                {/* Metrics row */}
                <div className="grid grid-cols-3 gap-3">
                  {/* Audit score */}
                  <div className="flex items-center gap-3">
                    {ws.audit ? (
                      <>
                        <ScoreRing score={ws.audit.score} size={44} strokeWidth={3.5} />
                        <div>
                          <div className="text-[11px] font-medium text-zinc-500">Health</div>
                          <div className="flex items-center gap-1 mt-0.5">
                            {scoreDelta !== null && scoreDelta !== 0 && (
                              <span className={`flex items-center text-[11px] font-medium ${scoreDelta > 0 ? 'text-green-400' : 'text-red-400'}`}>
                                {scoreDelta > 0 ? <ArrowUpRight className="w-2.5 h-2.5" /> : <ArrowDownRight className="w-2.5 h-2.5" />}
                                {Math.abs(scoreDelta)}
                              </span>
                            )}
                            {scoreDelta === 0 && <span className="flex items-center text-[11px] text-zinc-500"><Minus className="w-2.5 h-2.5" /></span>}
                          </div>
                          <div className="text-[11px] mt-0.5 text-zinc-500">
                            {ws.audit.errors > 0 && <span className="text-red-400">{ws.audit.errors} err</span>}
                            {ws.audit.errors > 0 && ws.audit.warnings > 0 && ' · '}
                            {ws.audit.warnings > 0 && <span className="text-amber-400">{ws.audit.warnings} warn</span>}
                          </div>
                        </div>
                      </>
                    ) : (
                      <div className="text-[11px] text-zinc-500">No audit yet</div>
                    )}
                  </div>

                  {/* Requests */}
                  <div>
                    <div className="text-[11px] font-medium mb-1 text-zinc-500">Requests</div>
                    {ws.requests.total > 0 ? (
                      <div className="space-y-0.5">
                        {ws.requests.new > 0 && <div className="text-[11px] text-red-400 font-medium">{ws.requests.new} new</div>}
                        {ws.requests.active > 0 && <div className="text-[11px] text-teal-400">{ws.requests.active} active</div>}
                        {ws.requests.total - ws.requests.new - ws.requests.active > 0 && (
                          <div className="text-[11px] text-zinc-500">{ws.requests.total} total</div>
                        )}
                        {ws.requests.latestDate && (
                          <div className="text-[11px] text-zinc-500">{timeAgo(ws.requests.latestDate)}</div>
                        )}
                      </div>
                    ) : (
                      <div className="text-[11px] text-zinc-500">None</div>
                    )}
                  </div>

                  {/* Approvals */}
                  <div>
                    <div className="text-[11px] font-medium mb-1 text-zinc-500">Approvals</div>
                    {ws.approvals.total > 0 ? (
                      <div className="space-y-0.5">
                        {ws.approvals.pending > 0 && (
                          <div className="text-[11px] text-teal-400 font-medium">{ws.approvals.pending} pending</div>
                        )}
                        {ws.approvals.pending === 0 && (
                          <div className="flex items-center gap-1 text-[11px] text-green-400">
                            <CheckCircle2 className="w-2.5 h-2.5" /> All clear
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="text-[11px] text-zinc-500">None</div>
                    )}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Two-column: Roadmap + Platform Health ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Roadmap Progress */}
        <SectionCard
          title="Roadmap Progress"
          titleIcon={<Map className="w-4 h-4 text-teal-400" />}
          action={onNavigate && (
            <button onClick={() => onNavigate('roadmap')} className="text-[11px] text-teal-400 hover:text-teal-300 transition-colors">
              View Full →
            </button>
          )}
          className="lg:col-span-2"
        >
          {/* Overall progress */}
          <div className="mb-4">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs text-zinc-400">{roadmapDone}/{totalRoadmapItems} items complete</span>
              <span className="text-xs font-medium text-teal-400">{roadmapPct}%</span>
            </div>
            <div className="h-2.5 bg-zinc-800 rounded-full overflow-hidden flex">
              {roadmapDone > 0 && <div className="h-full bg-green-500 transition-all" style={{ width: `${totalRoadmapItems > 0 ? (roadmapDone / totalRoadmapItems) * 100 : 0}%` }} />}
              {roadmapInProgress > 0 && <div className="h-full bg-teal-400 transition-all" style={{ width: `${totalRoadmapItems > 0 ? (roadmapInProgress / totalRoadmapItems) * 100 : 0}%` }} />}
            </div>
          </div>

          {/* Sprint list */}
          <div className="space-y-2">
            {roadmapSprints.map(sprint => {
              const sprintDone = sprint.items.filter(i => i.status === 'done').length;
              const sprintActive = sprint.items.filter(i => i.status === 'in_progress').length;
              const sprintTotal = sprint.items.length;
              const isCurrent = sprint.id === currentSprint?.id;
              const isComplete = sprintDone === sprintTotal;

              return (
                <div key={sprint.id} className={`flex items-center gap-3 px-3 py-2 rounded-lg ${isCurrent ? 'bg-teal-500/5 border border-teal-500/20' : 'bg-zinc-800/30'}`}>
                  <div className="flex-shrink-0">
                    {isComplete ? <CheckCircle2 className="w-3.5 h-3.5 text-green-400" />
                      : sprintActive > 0 ? <Clock className="w-3.5 h-3.5 text-teal-400 animate-pulse" />
                      : <Circle className="w-3.5 h-3.5 text-zinc-600" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={`text-xs font-medium truncate ${isComplete ? 'text-zinc-500 line-through' : isCurrent ? 'text-teal-300' : 'text-zinc-300'}`}>
                        {sprint.name}
                      </span>
                      {isCurrent && <Badge label="Current" color="teal" />}
                    </div>
                  </div>
                  <span className="text-[11px] text-zinc-500 flex-shrink-0">{sprint.hours}h</span>
                  <span className="text-[11px] text-zinc-400 flex-shrink-0 tabular-nums w-8 text-right">{sprintDone}/{sprintTotal}</span>
                </div>
              );
            })}
          </div>
        </SectionCard>

        {/* Platform Health */}
        <SectionCard title="Platform" titleIcon={<Shield className="w-4 h-4 text-teal-400" />}>
          <div className="space-y-4">
            {/* Connection status */}
            <div>
              <div className="text-[11px] text-zinc-500 font-medium uppercase tracking-wider mb-2">Connections</div>
              <div className="space-y-1.5">
                {connections.map(c => {
                  const Icon = c.icon;
                  return (
                    <div key={c.label} className="flex items-center gap-2">
                      <Icon className="w-3 h-3 text-zinc-500" />
                      <span className="text-xs text-zinc-300 flex-1">{c.label}</span>
                      {c.ok ? <Wifi className="w-3 h-3 text-green-400" /> : <WifiOff className="w-3 h-3 text-zinc-600" />}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Workspace stats */}
            <div>
              <div className="text-[11px] text-zinc-500 font-medium uppercase tracking-wider mb-2">Workspaces</div>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-zinc-400">Total</span>
                  <span className="text-xs font-medium text-zinc-200">{data.length}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-zinc-400">With GSC</span>
                  <span className="text-xs font-medium text-zinc-200">{data.filter(w => w.hasGsc).length}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-zinc-400">With GA4</span>
                  <span className="text-xs font-medium text-zinc-200">{data.filter(w => w.hasGa4).length}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-zinc-400">Client portals</span>
                  <span className="text-xs font-medium text-zinc-200">{data.filter(w => w.hasPassword).length}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-zinc-400">Audited</span>
                  <span className="text-xs font-medium text-zinc-200">{data.filter(w => w.audit).length}</span>
                </div>
              </div>
            </div>

            {/* Feature count */}
            <div>
              <div className="text-[11px] text-zinc-500 font-medium uppercase tracking-wider mb-2">Platform</div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-zinc-400">Features shipped</span>
                <span className="text-xs font-bold text-teal-400">37</span>
              </div>
              <div className="flex items-center justify-between mt-1">
                <span className="text-xs text-zinc-400">Roadmap items</span>
                <span className="text-xs font-medium text-zinc-200">{totalRoadmapItems}</span>
              </div>
            </div>
          </div>
        </SectionCard>
      </div>

      {/* ── Stripe Payments ── */}
      <StripeSettings />

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
