import { useState, useEffect } from 'react';
import {
  Globe, Shield, MessageSquare, ClipboardCheck, AlertTriangle,
  CheckCircle2, ArrowUpRight, ArrowDownRight, Minus, Loader2,
  Search, BarChart3, Lock, ExternalLink, Bell, Activity, FileText, Zap,
} from 'lucide-react';

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

function ScoreRing({ score, size = 48, stroke = 4 }: { score: number; size?: number; stroke?: number }) {
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score / 100) * circumference;
  const color = score >= 80 ? '#4ade80' : score >= 60 ? '#fbbf24' : '#f87171';
  return (
    <svg width={size} height={size} className="shrink-0">
      <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="var(--brand-border)" strokeWidth={stroke} />
      <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={color} strokeWidth={stroke}
        strokeDasharray={circumference} strokeDashoffset={offset} strokeLinecap="round"
        transform={`rotate(-90 ${size / 2} ${size / 2})`} className="transition-all duration-700" />
      <text x="50%" y="50%" dominantBaseline="central" textAnchor="middle" fontSize={size * 0.28} fontWeight="700" fill={color}>{score}</text>
    </svg>
  );
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

export function WorkspaceOverview({ onSelectWorkspace }: { onSelectWorkspace: (id: string) => void }) {
  const [data, setData] = useState<WorkspaceSummary[]>([]);
  const [recentActivity, setRecentActivity] = useState<ActivityEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch('/api/workspace-overview').then(r => r.json()),
      fetch('/api/activity?limit=15').then(r => r.json()).catch(() => []),
    ]).then(([d, act]) => {
      if (Array.isArray(d)) setData(d);
      if (Array.isArray(act)) setRecentActivity(act);
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-5 h-5 animate-spin" style={{ color: 'var(--brand-text-muted)' }} />
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-6">
        <img src="/logo.svg" alt="hmpsn.studio" className="h-10 opacity-40" />
        <div className="text-center max-w-sm">
          <p className="text-base font-semibold mb-1" style={{ color: 'var(--brand-text-bright)' }}>Welcome to hmpsn studio</p>
          <p className="text-xs leading-relaxed" style={{ color: 'var(--brand-text-muted)' }}>Create a workspace to get started.</p>
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

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-lg font-semibold" style={{ color: 'var(--brand-text-bright)' }}>Workspace Overview</h1>
        <p className="text-xs mt-1" style={{ color: 'var(--brand-text-muted)' }}>
          {data.length} workspace{data.length !== 1 ? 's' : ''} — select one to dive deeper
        </p>
      </div>

      {/* Global stats bar */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {[
          { label: 'New Requests', value: totalNewRequests, color: totalNewRequests > 0 ? '#f87171' : 'var(--brand-text-muted)', icon: Bell },
          { label: 'Active Requests', value: totalActiveRequests, color: totalActiveRequests > 0 ? '#fbbf24' : 'var(--brand-text-muted)', icon: MessageSquare },
          { label: 'Content Briefs', value: totalPendingContent, color: totalPendingContent > 0 ? '#f59e0b' : 'var(--brand-text-muted)', icon: ClipboardCheck },
          { label: 'Pending Approvals', value: totalPendingApprovals, color: totalPendingApprovals > 0 ? '#a78bfa' : 'var(--brand-text-muted)', icon: ClipboardCheck },
          { label: 'Avg Health Score', value: avgScore !== null ? avgScore : '—', color: avgScore !== null ? (avgScore >= 80 ? '#4ade80' : avgScore >= 60 ? '#fbbf24' : '#f87171') : 'var(--brand-text-muted)', icon: Shield },
        ].map(stat => (
          <div key={stat.label} className="rounded-xl px-4 py-3" style={{ backgroundColor: 'var(--brand-bg-elevated)', border: '1px solid var(--brand-border)' }}>
            <div className="flex items-center gap-1.5 mb-1">
              <stat.icon className="w-3 h-3" style={{ color: 'var(--brand-text-muted)' }} />
              <span className="text-[10px] font-medium uppercase tracking-wider" style={{ color: 'var(--brand-text-muted)' }}>{stat.label}</span>
            </div>
            <div className="text-xl font-bold" style={{ color: stat.color }}>{stat.value}</div>
          </div>
        ))}
      </div>

      {/* Workspace cards */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {data.map(ws => {
          const hasAlerts = ws.requests.new > 0 || ws.approvals.pending > 0 || (ws.contentRequests?.pending || 0) > 0;
          const scoreDelta = ws.audit && ws.audit.previousScore != null ? ws.audit.score - ws.audit.previousScore : null;

          return (
            <button
              key={ws.id}
              onClick={() => onSelectWorkspace(ws.id)}
              className="text-left rounded-xl p-5 transition-all hover:scale-[1.01] hover:shadow-lg group relative"
              style={{ backgroundColor: 'var(--brand-bg-elevated)', border: `1px solid ${hasAlerts ? 'rgba(251, 191, 36, 0.3)' : 'var(--brand-border)'}` }}
            >
              {/* New request badge */}
              {ws.requests.new > 0 && (
                <div className="absolute -top-2 -right-2 flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-500 text-white shadow-lg">
                  <Bell className="w-2.5 h-2.5" /> {ws.requests.new} new
                </div>
              )}

              {/* Top row: name + site */}
              <div className="flex items-start justify-between gap-3 mb-4">
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold truncate group-hover:text-teal-400 transition-colors" style={{ color: 'var(--brand-text-bright)' }}>{ws.name}</h3>
                  <div className="flex items-center gap-2 mt-1 text-[10px]" style={{ color: 'var(--brand-text-muted)' }}>
                    {ws.webflowSiteName && <span className="flex items-center gap-1"><Globe className="w-2.5 h-2.5" />{ws.webflowSiteName}</span>}
                    {!ws.webflowSiteId && <span className="flex items-center gap-1 text-amber-400"><AlertTriangle className="w-2.5 h-2.5" />No site linked</span>}
                    {ws.hasGsc && <span className="flex items-center gap-1"><Search className="w-2.5 h-2.5" />GSC</span>}
                    {ws.hasGa4 && <span className="flex items-center gap-1"><BarChart3 className="w-2.5 h-2.5" />GA4</span>}
                    {ws.hasPassword && <span className="flex items-center gap-1"><Lock className="w-2.5 h-2.5" />Client</span>}
                  </div>
                </div>
                <ExternalLink className="w-4 h-4 shrink-0 opacity-0 group-hover:opacity-60 transition-opacity" style={{ color: 'var(--brand-text-muted)' }} />
              </div>

              {/* Metrics row */}
              <div className="grid grid-cols-3 gap-3">
                {/* Audit score */}
                <div className="flex items-center gap-3">
                  {ws.audit ? (
                    <>
                      <ScoreRing score={ws.audit.score} size={44} stroke={3.5} />
                      <div>
                        <div className="text-[10px] font-medium" style={{ color: 'var(--brand-text-muted)' }}>Health</div>
                        <div className="flex items-center gap-1 mt-0.5">
                          {scoreDelta !== null && scoreDelta !== 0 && (
                            <span className={`flex items-center text-[10px] font-medium ${scoreDelta > 0 ? 'text-green-400' : 'text-red-400'}`}>
                              {scoreDelta > 0 ? <ArrowUpRight className="w-2.5 h-2.5" /> : <ArrowDownRight className="w-2.5 h-2.5" />}
                              {Math.abs(scoreDelta)}
                            </span>
                          )}
                          {scoreDelta === 0 && <span className="flex items-center text-[10px] text-zinc-500"><Minus className="w-2.5 h-2.5" /></span>}
                        </div>
                        <div className="text-[9px] mt-0.5" style={{ color: 'var(--brand-text-dim)' }}>
                          {ws.audit.errors > 0 && <span className="text-red-400">{ws.audit.errors} err</span>}
                          {ws.audit.errors > 0 && ws.audit.warnings > 0 && ' · '}
                          {ws.audit.warnings > 0 && <span className="text-amber-400">{ws.audit.warnings} warn</span>}
                        </div>
                      </div>
                    </>
                  ) : (
                    <div className="text-[10px]" style={{ color: 'var(--brand-text-dim)' }}>No audit yet</div>
                  )}
                </div>

                {/* Requests */}
                <div>
                  <div className="text-[10px] font-medium mb-1" style={{ color: 'var(--brand-text-muted)' }}>Requests</div>
                  {ws.requests.total > 0 ? (
                    <div className="space-y-0.5">
                      {ws.requests.new > 0 && <div className="text-[10px] text-red-400 font-medium">{ws.requests.new} new</div>}
                      {ws.requests.active > 0 && <div className="text-[10px] text-teal-400">{ws.requests.active} active</div>}
                      {ws.requests.total - ws.requests.new - ws.requests.active > 0 && (
                        <div className="text-[10px]" style={{ color: 'var(--brand-text-dim)' }}>{ws.requests.total} total</div>
                      )}
                      {ws.requests.latestDate && (
                        <div className="text-[9px]" style={{ color: 'var(--brand-text-dim)' }}>{timeAgo(ws.requests.latestDate)}</div>
                      )}
                    </div>
                  ) : (
                    <div className="text-[10px]" style={{ color: 'var(--brand-text-dim)' }}>None</div>
                  )}
                </div>

                {/* Approvals */}
                <div>
                  <div className="text-[10px] font-medium mb-1" style={{ color: 'var(--brand-text-muted)' }}>Approvals</div>
                  {ws.approvals.total > 0 ? (
                    <div className="space-y-0.5">
                      {ws.approvals.pending > 0 && (
                        <div className="text-[10px] text-violet-400 font-medium">{ws.approvals.pending} pending</div>
                      )}
                      {ws.approvals.pending === 0 && (
                        <div className="flex items-center gap-1 text-[10px] text-green-400">
                          <CheckCircle2 className="w-2.5 h-2.5" /> All clear
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="text-[10px]" style={{ color: 'var(--brand-text-dim)' }}>None</div>
                  )}
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {/* Recent Activity */}
      {recentActivity.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-3">
            <Activity className="w-4 h-4" style={{ color: 'var(--brand-text-muted)' }} />
            <h2 className="text-sm font-semibold" style={{ color: 'var(--brand-text-bright)' }}>Recent Activity</h2>
          </div>
          <div className="rounded-xl overflow-hidden" style={{ backgroundColor: 'var(--brand-bg-elevated)', border: '1px solid var(--brand-border)' }}>
            {recentActivity.map((entry, i) => {
              const wsName = data.find(w => w.id === entry.workspaceId)?.name || '';
              const iconMap: Record<string, typeof Zap> = {
                audit_completed: Globe,
                content_requested: FileText,
                brief_generated: Zap,
                request_resolved: CheckCircle2,
                approval_applied: ClipboardCheck,
                seo_updated: Globe,
              };
              const Icon = iconMap[entry.type] || Activity;
              return (
                <div
                  key={entry.id}
                  className={`flex items-start gap-3 px-4 py-2.5 ${i < recentActivity.length - 1 ? 'border-b' : ''}`}
                  style={{ borderColor: 'var(--brand-border)' }}
                >
                  <Icon className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" style={{ color: 'var(--brand-mint)' }} />
                  <div className="flex-1 min-w-0">
                    <div className="text-xs" style={{ color: 'var(--brand-text-bright)' }}>{entry.title}</div>
                    {entry.description && <div className="text-[10px] mt-0.5" style={{ color: 'var(--brand-text-muted)' }}>{entry.description}</div>}
                  </div>
                  <div className="flex-shrink-0 text-right">
                    {wsName && <div className="text-[9px]" style={{ color: 'var(--brand-text-dim)' }}>{wsName}</div>}
                    <div className="text-[9px]" style={{ color: 'var(--brand-text-dim)' }}>{timeAgo(entry.createdAt)}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
