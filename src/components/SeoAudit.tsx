import { useState, useEffect, useCallback } from 'react';
import {
  Loader2, Search as SearchIcon, ChevronDown, ChevronRight, Download,
  AlertTriangle, AlertCircle, Info, CheckCircle, Globe, FileText,
  RefreshCw, X, Pencil, Link2Off, Clock, Share2, Copy, ExternalLink,
  TrendingUp, TrendingDown, Minus, Plus, ListChecks, Trash2, Circle, Code2,
} from 'lucide-react';
import { SeoEditor } from './SeoEditor';
import { LinkChecker } from './LinkChecker';
import { KeywordAnalysis } from './KeywordAnalysis';
import { SchemaSuggester } from './SchemaSuggester';

type Severity = 'error' | 'warning' | 'info';

type CheckCategory = 'content' | 'technical' | 'social' | 'performance' | 'accessibility';

interface SeoIssue {
  check: string;
  severity: Severity;
  category?: CheckCategory;
  message: string;
  recommendation: string;
  value?: string;
  suggestedFix?: string;
}

const CATEGORY_CONFIG: Record<CheckCategory, { label: string; color: string }> = {
  content: { label: 'Content', color: 'text-emerald-400' },
  technical: { label: 'Technical', color: 'text-violet-400' },
  social: { label: 'Social', color: 'text-pink-400' },
  performance: { label: 'Performance', color: 'text-orange-400' },
  accessibility: { label: 'Accessibility', color: 'text-sky-400' },
};

interface PageSeoResult {
  page: string;
  slug: string;
  url: string;
  score: number;
  issues: SeoIssue[];
}

interface SeoAuditResult {
  siteScore: number;
  totalPages: number;
  errors: number;
  warnings: number;
  infos: number;
  pages: PageSeoResult[];
  siteWideIssues: SeoIssue[];
}

type SubTab = 'audit' | 'editor' | 'links' | 'keywords' | 'schema' | 'history';

interface SnapshotSummary {
  id: string;
  createdAt: string;
  siteScore: number;
  totalPages: number;
  errors: number;
  warnings: number;
  infos: number;
}

interface Props {
  siteId: string;
}

const SEVERITY_CONFIG: Record<Severity, { label: string; color: string; bg: string; icon: typeof AlertTriangle }> = {
  error: { label: 'Error', color: 'text-red-400', bg: 'bg-red-500/10 border-red-500/30', icon: AlertCircle },
  warning: { label: 'Warning', color: 'text-amber-400', bg: 'bg-amber-500/10 border-amber-500/30', icon: AlertTriangle },
  info: { label: 'Info', color: 'text-blue-400', bg: 'bg-blue-500/10 border-blue-500/30', icon: Info },
};

function scoreColor(score: number): string {
  if (score >= 80) return 'text-green-400';
  if (score >= 60) return 'text-amber-400';
  if (score >= 40) return 'text-orange-400';
  return 'text-red-400';
}

function scoreBg(score: number): string {
  if (score >= 80) return 'bg-green-500';
  if (score >= 60) return 'bg-amber-500';
  if (score >= 40) return 'bg-orange-500';
  return 'bg-red-500';
}

function ScoreTrendChart({ history }: { history: SnapshotSummary[] }) {
  const points = [...history].reverse().slice(-12); // last 12, chronological
  if (points.length < 2) return null;

  const W = 600, H = 160, PAD = 32;
  const scores = points.map(p => p.siteScore);
  const minS = Math.max(0, Math.min(...scores) - 10);
  const maxS = Math.min(100, Math.max(...scores) + 10);
  const range = maxS - minS || 1;

  const coords = points.map((p, i) => ({
    x: PAD + (i / (points.length - 1)) * (W - PAD * 2),
    y: PAD + (1 - (p.siteScore - minS) / range) * (H - PAD * 2),
    score: p.siteScore,
    date: new Date(p.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
  }));

  const pathD = coords.map((c, i) => `${i === 0 ? 'M' : 'L'}${c.x},${c.y}`).join(' ');

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ maxHeight: 180 }}>
      {/* Grid lines */}
      {[0, 0.25, 0.5, 0.75, 1].map(f => {
        const y = PAD + (1 - f) * (H - PAD * 2);
        const label = Math.round(minS + f * range);
        return (
          <g key={f}>
            <line x1={PAD} y1={y} x2={W - PAD} y2={y} stroke="rgba(255,255,255,0.04)" />
            <text x={PAD - 6} y={y + 3} textAnchor="end" fill="#64748b" fontSize="9">{label}</text>
          </g>
        );
      })}
      {/* Line */}
      <path d={pathD} fill="none" stroke="#2ed9c3" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      {/* Area fill */}
      <path d={`${pathD} L${coords[coords.length - 1].x},${H - PAD} L${coords[0].x},${H - PAD} Z`} fill="url(#trendGrad)" />
      <defs>
        <linearGradient id="trendGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#2ed9c3" stopOpacity="0.15" />
          <stop offset="100%" stopColor="#2ed9c3" stopOpacity="0" />
        </linearGradient>
      </defs>
      {/* Points + labels */}
      {coords.map((c, i) => (
        <g key={i}>
          <circle cx={c.x} cy={c.y} r="3.5" fill="#0f1219" stroke="#2ed9c3" strokeWidth="2" />
          {(i === 0 || i === coords.length - 1 || points.length <= 6) && (
            <text x={c.x} y={H - 6} textAnchor="middle" fill="#64748b" fontSize="8">{c.date}</text>
          )}
        </g>
      ))}
    </svg>
  );
}

interface ActionItem {
  id: string;
  snapshotId: string;
  title: string;
  description: string;
  status: 'planned' | 'in-progress' | 'completed';
  priority: 'high' | 'medium' | 'low';
  category?: string;
  createdAt: string;
  updatedAt: string;
}

const STATUS_CONFIG = {
  planned: { label: 'Planned', color: 'text-zinc-400', bg: 'bg-zinc-500/10 border-zinc-500/30', icon: Circle },
  'in-progress': { label: 'In Progress', color: 'text-blue-400', bg: 'bg-blue-500/10 border-blue-500/30', icon: Loader2 },
  completed: { label: 'Done', color: 'text-green-400', bg: 'bg-green-500/10 border-green-500/30', icon: CheckCircle },
} as const;

const PRIORITY_CONFIG = {
  high: { label: 'High', dot: 'bg-red-400' },
  medium: { label: 'Med', dot: 'bg-amber-400' },
  low: { label: 'Low', dot: 'bg-green-400' },
} as const;

function ActionItemsPanel({ snapshotId }: { snapshotId: string }) {
  const [items, setItems] = useState<ActionItem[]>([]);
  const [adding, setAdding] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newPriority, setNewPriority] = useState<'high' | 'medium' | 'low'>('medium');

  const load = useCallback(() => {
    fetch(`/api/reports/snapshot/${snapshotId}/actions`)
      .then(r => r.json())
      .then(d => { if (Array.isArray(d)) setItems(d); })
      .catch(() => {});
  }, [snapshotId]);

  useEffect(() => { load(); }, [load]);

  const addItem = async () => {
    if (!newTitle.trim()) return;
    await fetch(`/api/reports/snapshot/${snapshotId}/actions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: newTitle.trim(), description: newDesc.trim(), priority: newPriority }),
    });
    setNewTitle('');
    setNewDesc('');
    setAdding(false);
    load();
  };

  const cycleStatus = async (item: ActionItem) => {
    const next = item.status === 'planned' ? 'in-progress' : item.status === 'in-progress' ? 'completed' : 'planned';
    await fetch(`/api/reports/snapshot/${snapshotId}/actions/${item.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: next }),
    });
    load();
  };

  const deleteItem = async (id: string) => {
    await fetch(`/api/reports/snapshot/${snapshotId}/actions/${id}`, { method: 'DELETE' });
    load();
  };

  const sorted = [...items].sort((a, b) => {
    const order = { 'in-progress': 0, planned: 1, completed: 2 };
    return (order[a.status] ?? 1) - (order[b.status] ?? 1);
  });

  const counts = {
    completed: items.filter(i => i.status === 'completed').length,
    'in-progress': items.filter(i => i.status === 'in-progress').length,
    planned: items.filter(i => i.status === 'planned').length,
  };

  return (
    <div className="bg-zinc-900 rounded-xl border border-zinc-800 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
        <div className="flex items-center gap-2">
          <ListChecks className="w-4 h-4" style={{ color: 'var(--brand-mint)' }} />
          <span className="text-sm font-medium text-zinc-300">Action Items</span>
          {items.length > 0 && (
            <span className="text-xs text-zinc-500">
              {counts.completed}/{items.length} done
            </span>
          )}
        </div>
        <button
          onClick={() => setAdding(!adding)}
          className="flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium hover:bg-zinc-800 transition-colors"
          style={{ color: 'var(--brand-mint)' }}
        >
          <Plus className="w-3 h-3" /> Add
        </button>
      </div>

      {/* Progress bar */}
      {items.length > 0 && (
        <div className="px-4 pt-3">
          <div className="flex gap-1 h-1.5 rounded-full overflow-hidden bg-zinc-800">
            {counts.completed > 0 && <div className="bg-green-500 rounded-full" style={{ width: `${(counts.completed / items.length) * 100}%` }} />}
            {counts['in-progress'] > 0 && <div className="bg-blue-500 rounded-full" style={{ width: `${(counts['in-progress'] / items.length) * 100}%` }} />}
          </div>
        </div>
      )}

      {/* Add form */}
      {adding && (
        <div className="px-4 py-3 border-b border-zinc-800 space-y-2">
          <input
            value={newTitle}
            onChange={e => setNewTitle(e.target.value)}
            placeholder="What needs to be done?"
            className="w-full px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-sm text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-zinc-600"
            onKeyDown={e => e.key === 'Enter' && addItem()}
            autoFocus
          />
          <input
            value={newDesc}
            onChange={e => setNewDesc(e.target.value)}
            placeholder="Description (optional)"
            className="w-full px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-sm text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-zinc-600"
          />
          <div className="flex items-center justify-between">
            <div className="flex gap-1">
              {(['high', 'medium', 'low'] as const).map(p => (
                <button
                  key={p}
                  onClick={() => setNewPriority(p)}
                  className={`px-2 py-1 rounded text-xs font-medium border ${newPriority === p ? 'border-zinc-600 bg-zinc-800 text-zinc-200' : 'border-transparent text-zinc-500'}`}
                >
                  <span className={`inline-block w-1.5 h-1.5 rounded-full ${PRIORITY_CONFIG[p].dot} mr-1`} />
                  {PRIORITY_CONFIG[p].label}
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              <button onClick={() => setAdding(false)} className="px-3 py-1.5 rounded-md text-xs text-zinc-400 hover:text-zinc-200">Cancel</button>
              <button onClick={addItem} className="px-3 py-1.5 rounded-md text-xs font-medium" style={{ background: 'var(--brand-mint)', color: '#0f1219' }}>Add</button>
            </div>
          </div>
        </div>
      )}

      {/* Items list */}
      <div className="divide-y divide-zinc-800/50">
        {sorted.map(item => {
          const cfg = STATUS_CONFIG[item.status];
          const Icon = cfg.icon;
          return (
            <div key={item.id} className="flex items-start gap-3 px-4 py-3 group">
              <button onClick={() => cycleStatus(item)} className={`mt-0.5 ${cfg.color}`} title={`Click to change status (${cfg.label})`}>
                <Icon className={`w-4 h-4 ${item.status === 'in-progress' ? 'animate-spin' : ''}`} />
              </button>
              <div className="flex-1 min-w-0">
                <div className={`text-sm ${item.status === 'completed' ? 'line-through text-zinc-500' : 'text-zinc-200'}`}>{item.title}</div>
                {item.description && <div className="text-xs text-zinc-500 mt-0.5">{item.description}</div>}
              </div>
              <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                <span className={`w-1.5 h-1.5 rounded-full ${PRIORITY_CONFIG[item.priority]?.dot || 'bg-zinc-500'}`} title={item.priority} />
                <button onClick={() => deleteItem(item.id)} className="text-zinc-600 hover:text-red-400">
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            </div>
          );
        })}
        {items.length === 0 && !adding && (
          <div className="px-4 py-6 text-center text-xs text-zinc-600">
            No action items yet. Click "Add" to track work for this report.
          </div>
        )}
      </div>
    </div>
  );
}

function AuditHistory({ siteId, history, onRefresh }: { siteId: string; history: SnapshotSummary[]; onRefresh: () => void }) {
  const [loadingId, setLoadingId] = useState<string | null>(null);

  const openReport = (id: string) => {
    window.open(`/report/${id}`, '_blank');
  };

  const copyLink = (id: string) => {
    setLoadingId(id);
    navigator.clipboard.writeText(`${window.location.origin}/report/${id}`);
    setTimeout(() => setLoadingId(null), 1500);
  };

  if (history.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-4">
        <div className="w-16 h-16 rounded-2xl bg-zinc-900 flex items-center justify-center">
          <Clock className="w-8 h-8 text-zinc-600" />
        </div>
        <p className="text-zinc-400 text-sm">No audit history yet</p>
        <p className="text-xs text-zinc-600 max-w-md text-center">
          Run an SEO audit and click "Save & Share" to start tracking changes over time
        </p>
      </div>
    );
  }

  // Score change indicators
  const latest = history[0];
  const previous = history.length > 1 ? history[1] : null;
  const scoreDelta = previous ? latest.siteScore - previous.siteScore : 0;
  const errorDelta = previous ? latest.errors - previous.errors : 0;

  return (
    <div className="space-y-5">
      {/* Summary */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-zinc-900 rounded-xl p-4 border border-zinc-800">
          <div className="text-xs text-zinc-500 mb-1">Latest Score</div>
          <div className="flex items-end gap-2">
            <span className={`text-3xl font-bold ${scoreColor(latest.siteScore)}`}>{latest.siteScore}</span>
            {scoreDelta !== 0 && (
              <span className={`flex items-center gap-0.5 text-xs font-medium pb-1 ${scoreDelta > 0 ? 'text-green-400' : 'text-red-400'}`}>
                {scoreDelta > 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                {scoreDelta > 0 ? '+' : ''}{scoreDelta}
              </span>
            )}
            {scoreDelta === 0 && previous && (
              <span className="flex items-center gap-0.5 text-xs text-zinc-500 pb-1"><Minus className="w-3 h-3" /> No change</span>
            )}
          </div>
        </div>
        <div className="bg-zinc-900 rounded-xl p-4 border border-zinc-800">
          <div className="text-xs text-zinc-500 mb-1">Total Audits</div>
          <div className="text-3xl font-bold text-zinc-200">{history.length}</div>
        </div>
        <div className="bg-zinc-900 rounded-xl p-4 border border-zinc-800">
          <div className="text-xs text-zinc-500 mb-1">Error Trend</div>
          <div className="flex items-end gap-2">
            <span className="text-3xl font-bold text-red-400">{latest.errors}</span>
            {errorDelta !== 0 && previous && (
              <span className={`text-xs font-medium pb-1 ${errorDelta < 0 ? 'text-green-400' : 'text-red-400'}`}>
                {errorDelta > 0 ? '+' : ''}{errorDelta}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Score trend chart */}
      {history.length >= 2 && (
        <div className="bg-zinc-900 rounded-xl p-4 border border-zinc-800">
          <div className="text-sm font-medium text-zinc-300 mb-3">Score Trend</div>
          <ScoreTrendChart history={history} />
        </div>
      )}

      {/* Action items for latest snapshot */}
      {history.length > 0 && <ActionItemsPanel snapshotId={history[0].id} />}

      {/* Client dashboard link */}
      <div className="flex items-center gap-3 px-4 py-3 rounded-lg bg-zinc-900 border border-zinc-800">
        <Globe className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--brand-mint)' }} />
        <div className="flex-1 min-w-0">
          <div className="text-xs font-medium text-zinc-300">Client Dashboard</div>
          <div className="text-xs text-zinc-500 truncate font-mono">{window.location.origin}/client/{siteId}</div>
        </div>
        <button
          onClick={() => {
            navigator.clipboard.writeText(`${window.location.origin}/client/${siteId}`);
          }}
          className="flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-medium bg-zinc-800 hover:bg-zinc-700 transition-colors"
        >
          <Copy className="w-3 h-3" /> Copy
        </button>
        <a href={`/client/${siteId}`} target="_blank" rel="noopener noreferrer" className="p-1.5 rounded-md hover:bg-zinc-800" style={{ color: 'var(--brand-mint)' }}>
          <ExternalLink className="w-3.5 h-3.5" />
        </a>
      </div>

      {/* Snapshot list */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <div className="text-sm font-medium text-zinc-300">Audit History</div>
          <button onClick={onRefresh} className="text-xs text-zinc-500 hover:text-zinc-300 flex items-center gap-1">
            <RefreshCw className="w-3 h-3" /> Refresh
          </button>
        </div>
        <div className="space-y-1">
          {history.map((snap, i) => {
            const date = new Date(snap.createdAt);
            const prev = history[i + 1];
            const delta = prev ? snap.siteScore - prev.siteScore : 0;
            return (
              <div key={snap.id} className="flex items-center gap-3 px-4 py-3 rounded-lg hover:bg-zinc-900/50 transition-colors group">
                <div className={`text-lg font-bold tabular-nums w-10 ${scoreColor(snap.siteScore)}`}>{snap.siteScore}</div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-zinc-300">
                    {date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                    <span className="text-zinc-600 ml-2">{date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}</span>
                  </div>
                  <div className="text-xs text-zinc-500">
                    {snap.totalPages} pages · {snap.errors} errors · {snap.warnings} warnings
                    {delta !== 0 && (
                      <span className={`ml-2 ${delta > 0 ? 'text-green-400' : 'text-red-400'}`}>
                        ({delta > 0 ? '+' : ''}{delta} pts)
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={() => copyLink(snap.id)}
                    className="p-1.5 rounded-md hover:bg-zinc-800 text-zinc-500 hover:text-zinc-300"
                    title="Copy share link"
                  >
                    {loadingId === snap.id ? <CheckCircle className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                  <button
                    onClick={() => openReport(snap.id)}
                    className="p-1.5 rounded-md hover:bg-zinc-800 text-zinc-500 hover:text-zinc-300"
                    title="View report"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function SeoAudit({ siteId }: Props) {
  const [subTab, setSubTab] = useState<SubTab>('audit');
  const [data, setData] = useState<SeoAuditResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [hasRun, setHasRun] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [severityFilter, setSeverityFilter] = useState<Severity | 'all'>('all');
  const [categoryFilter, setCategoryFilter] = useState<CheckCategory | 'all'>('all');
  const [reportModal, setReportModal] = useState(false);
  const [reportView, setReportView] = useState<'html' | 'csv' | null>(null);
  const [history, setHistory] = useState<SnapshotSummary[]>([]);
  const [saving, setSaving] = useState(false);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const [auditError, setAuditError] = useState<string | null>(null);

  const runAudit = () => {
    setLoading(true);
    setHasRun(true);
    setAuditError(null);
    fetch(`/api/webflow/seo-audit/${siteId}`)
      .then(r => {
        if (!r.ok) throw new Error(`Server error: ${r.status}`);
        return r.json();
      })
      .then(d => {
        if (!d || !Array.isArray(d.pages)) throw new Error(d?.error || 'Invalid audit response');
        setData(d);
      })
      .catch((e) => { setAuditError(e.message || 'Audit failed'); })
      .finally(() => setLoading(false));
  };

  const loadHistory = useCallback(() => {
    fetch(`/api/reports/${siteId}/history`)
      .then(r => r.json())
      .then(h => setHistory(Array.isArray(h) ? h : []))
      .catch(() => {});
  }, [siteId]);

  useEffect(() => {
    setData(null);
    setHasRun(false);
    setSubTab('audit');
    setAuditError(null);
    loadHistory();
  }, [siteId, loadHistory]);

  const handleSaveAndShare = async () => {
    if (!data) return;
    setSaving(true);
    setShareUrl(null);
    try {
      const res = await fetch(`/api/reports/${siteId}/snapshot`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ siteName: siteId, audit: data }),
      });
      const result = await res.json();
      const url = `${window.location.origin}/report/${result.id}`;
      setShareUrl(url);
      loadHistory();
    } catch { /* ignore */ }
    setSaving(false);
  };

  const copyShareUrl = () => {
    if (!shareUrl) return;
    navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const toggleExpand = (page: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(page)) next.delete(page); else next.add(page);
      return next;
    });
  };

  const getCSV = (): string => {
    if (!data) return '';
    const rows = [['Page', 'Slug', 'Score', 'Severity', 'Check', 'Message', 'Recommendation', 'Value', 'AI Suggestion']];
    for (const issue of data.siteWideIssues) {
      rows.push(['[Site-Wide]', '', '', issue.severity, issue.check, issue.message, issue.recommendation, issue.value || '', issue.suggestedFix || '']);
    }
    for (const page of data.pages) {
      for (const issue of page.issues) {
        rows.push([page.page, page.slug, String(page.score), issue.severity, issue.check, issue.message, issue.recommendation, issue.value || '', issue.suggestedFix || '']);
      }
    }
    return rows.map(r => r.map(c => `"${c.replace(/"/g, '""')}"`).join(',')).join('\n');
  };

  const generateHtmlReport = (): string => {
    if (!data) return '';
    const now = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    const errorPages = data.pages.filter(p => p.score < 60);
    const goodPages = data.pages.filter(p => p.score >= 80);

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>SEO Audit Report</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #1a1a2e; background: #fff; line-height: 1.6; }
  .container { max-width: 900px; margin: 0 auto; padding: 40px 24px; }
  h1 { font-size: 28px; font-weight: 700; margin-bottom: 4px; }
  .subtitle { color: #666; font-size: 14px; margin-bottom: 32px; }
  .score-card { display: flex; align-items: center; gap: 24px; padding: 24px; background: #f8f9fa; border-radius: 12px; margin-bottom: 32px; }
  .score-circle { width: 80px; height: 80px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 28px; font-weight: 700; color: white; }
  .score-green { background: #22c55e; } .score-amber { background: #f59e0b; } .score-orange { background: #f97316; } .score-red { background: #ef4444; }
  .stats { display: flex; gap: 24px; }
  .stat { text-align: center; } .stat-num { font-size: 24px; font-weight: 700; } .stat-label { font-size: 12px; color: #666; text-transform: uppercase; letter-spacing: 0.5px; }
  h2 { font-size: 20px; font-weight: 600; margin: 32px 0 16px; padding-bottom: 8px; border-bottom: 2px solid #eee; }
  .issue-row { display: flex; gap: 12px; padding: 12px 0; border-bottom: 1px solid #f0f0f0; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 600; text-transform: uppercase; }
  .badge-error { background: #fef2f2; color: #dc2626; } .badge-warning { background: #fffbeb; color: #d97706; } .badge-info { background: #eff6ff; color: #2563eb; }
  .issue-content { flex: 1; }
  .issue-msg { font-weight: 500; font-size: 14px; } .issue-rec { font-size: 13px; color: #666; margin-top: 2px; } .issue-val { font-size: 12px; color: #999; font-style: italic; margin-top: 2px; }
  .page-block { background: #f8f9fa; border-radius: 8px; padding: 16px; margin-bottom: 16px; }
  .page-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
  .page-name { font-weight: 600; font-size: 15px; } .page-score { font-weight: 700; font-size: 14px; }
  .summary-box { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 32px; }
  .summary-item { padding: 16px; background: #f8f9fa; border-radius: 8px; }
  .summary-item h3 { font-size: 14px; font-weight: 600; margin-bottom: 8px; }
  .summary-item p { font-size: 13px; color: #666; }
  @media print { body { font-size: 12px; } .container { padding: 20px; } }
</style>
</head>
<body>
<div class="container">
  <h1>SEO Audit Report</h1>
  <p class="subtitle">Generated ${now} &middot; ${data.totalPages} pages analyzed</p>

  <div class="score-card">
    <div class="score-circle ${data.siteScore >= 80 ? 'score-green' : data.siteScore >= 60 ? 'score-amber' : data.siteScore >= 40 ? 'score-orange' : 'score-red'}">${data.siteScore}</div>
    <div>
      <div style="font-size:18px;font-weight:600">Overall Site Score</div>
      <div class="stats" style="margin-top:8px">
        <div class="stat"><div class="stat-num" style="color:#dc2626">${data.errors}</div><div class="stat-label">Errors</div></div>
        <div class="stat"><div class="stat-num" style="color:#d97706">${data.warnings}</div><div class="stat-label">Warnings</div></div>
        <div class="stat"><div class="stat-num" style="color:#2563eb">${data.infos}</div><div class="stat-label">Info</div></div>
      </div>
    </div>
  </div>

  <div class="summary-box">
    <div class="summary-item">
      <h3>Executive Summary</h3>
      <p>${data.errors > 0 ? `Found <strong>${data.errors} critical error${data.errors > 1 ? 's' : ''}</strong> that need immediate attention. ` : 'No critical errors found. '}${data.warnings > 0 ? `There are <strong>${data.warnings} warning${data.warnings > 1 ? 's' : ''}</strong> that should be addressed for better rankings.` : 'All warnings have been addressed.'}</p>
    </div>
    <div class="summary-item">
      <h3>Key Metrics</h3>
      <p><strong>${goodPages.length}</strong> of ${data.totalPages} pages score 80+<br>
      <strong>${errorPages.length}</strong> pages need significant improvement<br>
      Average page score: <strong>${data.siteScore}</strong>/100</p>
    </div>
  </div>

  ${data.siteWideIssues.length > 0 ? `<h2>Site-Wide Issues</h2>${data.siteWideIssues.map(i => `
  <div class="issue-row">
    <span class="badge badge-${i.severity}">${i.severity}</span>
    <div class="issue-content">
      <div class="issue-msg">${i.message}</div>
      <div class="issue-rec">${i.recommendation}</div>
      ${i.value ? `<div class="issue-val">${i.value}</div>` : ''}
      ${i.suggestedFix ? `<div style="margin-top:6px;padding:6px 10px;background:#064e3b20;border:1px solid #06533830;border-radius:6px"><div style="font-size:9px;color:#10b981;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:2px">AI Suggestion</div><div style="font-size:12px;color:#34d399">${i.suggestedFix}</div></div>` : ''}
    </div>
  </div>`).join('')}` : ''}

  <h2>Page-by-Page Results</h2>
  ${data.pages.map(p => `
  <div class="page-block">
    <div class="page-header">
      <span class="page-name">${p.page} <span style="color:#999;font-weight:400">/${p.slug}</span></span>
      <span class="page-score" style="color:${p.score >= 80 ? '#22c55e' : p.score >= 60 ? '#f59e0b' : '#ef4444'}">${p.score}/100</span>
    </div>
    ${p.issues.length === 0 ? '<div style="color:#22c55e;font-size:13px">No issues found</div>' : p.issues.map(i => `
    <div class="issue-row">
      <span class="badge badge-${i.severity}">${i.severity}</span>
      <div class="issue-content">
        <div class="issue-msg">${i.message}</div>
        <div class="issue-rec">${i.recommendation}</div>
        ${i.value ? `<div class="issue-val">${i.value}</div>` : ''}
        ${i.suggestedFix ? `<div style="margin-top:6px;padding:6px 10px;background:#064e3b20;border:1px solid #06533830;border-radius:6px"><div style="font-size:9px;color:#10b981;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:2px">AI Suggestion</div><div style="font-size:12px;color:#34d399">${i.suggestedFix}</div></div>` : ''}
      </div>
    </div>`).join('')}
  </div>`).join('')}

  <div style="margin-top:40px;padding-top:16px;border-top:2px solid #eee;text-align:center;color:#999;font-size:12px">
    Generated by Asset Dashboard SEO Auditor &middot; ${now}
  </div>
</div>
</body>
</html>`;
  };

  const handleExportReport = () => {
    setReportModal(false);
    setReportView('html');
  };

  const handleExportCSV = () => {
    setReportModal(false);
    setReportView('csv');
  };

  // Sub-tab navigation (always visible)
  const subTabs: { id: SubTab; label: string; icon: typeof Globe }[] = [
    { id: 'audit', label: 'Audit', icon: Globe },
    { id: 'editor', label: 'Edit SEO', icon: Pencil },
    { id: 'links', label: 'Dead Links', icon: Link2Off },
    { id: 'keywords', label: 'Keywords', icon: SearchIcon },
    { id: 'schema', label: 'Schema', icon: Code2 },
    { id: 'history', label: 'History', icon: Clock },
  ];
  const tabNav = (
    <div className="flex items-center gap-0.5 mb-4">
      {subTabs.map(t => {
        const Icon = t.icon;
        const active = subTab === t.id;
        return (
          <button
            key={t.id}
            onClick={() => setSubTab(t.id)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium"
            style={active ? {
              backgroundColor: 'var(--brand-mint-dim)',
              color: 'var(--brand-mint)',
            } : {
              color: 'var(--brand-text-muted)',
            }}
          >
            <Icon className="w-3 h-3" /> {t.label}
          </button>
        );
      })}
    </div>
  );

  if (subTab === 'editor') return <>{tabNav}<SeoEditor siteId={siteId} /></>;
  if (subTab === 'links') return <>{tabNav}<LinkChecker siteId={siteId} /></>;
  if (subTab === 'keywords') return <>{tabNav}<KeywordAnalysis siteId={siteId} /></>;
  if (subTab === 'schema') return <>{tabNav}<SchemaSuggester siteId={siteId} /></>;
  if (subTab === 'history') return <>{tabNav}<AuditHistory siteId={siteId} history={history} onRefresh={loadHistory} /></>;

  // Audit tab
  if (!hasRun) {
    return (
      <>
        {tabNav}
        <div className="flex flex-col items-center justify-center py-16 gap-4">
          <div className="w-16 h-16 rounded-2xl bg-zinc-900 flex items-center justify-center">
            <Globe className="w-8 h-8 text-zinc-600" />
          </div>
          <p className="text-zinc-400 text-sm">Comprehensive SEO audit for your Webflow site</p>
          <p className="text-xs text-zinc-600 max-w-md text-center">
            Checks titles, meta descriptions, headings, Open Graph, canonical tags, structured data, content length, and more
          </p>
          <button
            onClick={runAudit}
            className="px-5 py-2.5 bg-teal-600 hover:bg-teal-500 rounded-lg text-sm font-medium transition-colors"
          >
            Run SEO Audit
          </button>
        </div>
      </>
    );
  }

  if (loading) {
    return (
      <>
        {tabNav}
        <div className="flex flex-col items-center justify-center py-16 gap-3 text-zinc-500">
          <Loader2 className="w-6 h-6 animate-spin" />
          <p className="text-sm">Scanning pages for SEO issues...</p>
          <p className="text-xs text-zinc-600">Fetching metadata and published HTML for each page</p>
        </div>
      </>
    );
  }

  if (!data) return (
    <>
      {tabNav}
      {auditError && (
        <div className="flex flex-col items-center justify-center py-16 gap-4">
          <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-3 max-w-md text-center">
            <p className="text-red-400 text-sm font-medium mb-1">SEO Audit Failed</p>
            <p className="text-xs text-red-400/70">{auditError}</p>
          </div>
          <button onClick={runAudit} className="px-4 py-2 rounded-lg text-sm font-medium" style={{ background: 'var(--brand-mint)', color: '#0f1219' }}>
            Try Again
          </button>
        </div>
      )}
    </>
  );

  const filteredPages = data.pages
    .filter(p => {
      if (severityFilter === 'all') return true;
      return p.issues.some(i => i.severity === severityFilter);
    })
    .filter(p => {
      if (categoryFilter === 'all') return true;
      return p.issues.some(i => i.category === categoryFilter);
    })
    .filter(p => {
      if (!search) return true;
      const q = search.toLowerCase();
      return p.page.toLowerCase().includes(q) || p.slug.toLowerCase().includes(q) ||
        p.issues.some(i => i.message.toLowerCase().includes(q) || i.check.toLowerCase().includes(q));
    });

  return (
    <div className="space-y-5">
      {tabNav}
      {/* Summary cards */}
      <div className="grid grid-cols-5 gap-3">
        <div className="bg-zinc-900 rounded-xl p-4 border border-zinc-800 col-span-1">
          <div className={`text-4xl font-bold ${scoreColor(data.siteScore)}`}>{data.siteScore}</div>
          <div className="text-xs text-zinc-500 mt-1">Site Score</div>
          <div className="mt-2 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
            <div className={`h-full rounded-full ${scoreBg(data.siteScore)}`} style={{ width: `${data.siteScore}%` }} />
          </div>
        </div>
        <div className="bg-zinc-900 rounded-xl p-4 border border-zinc-800">
          <div className="text-3xl font-bold text-zinc-200">{data.totalPages}</div>
          <div className="text-xs text-zinc-500 mt-1">Pages Scanned</div>
        </div>
        <button
          onClick={() => setSeverityFilter(severityFilter === 'error' ? 'all' : 'error')}
          className={`bg-zinc-900 rounded-xl p-4 border text-left transition-colors ${severityFilter === 'error' ? 'border-red-500/50' : 'border-zinc-800 hover:border-zinc-700'}`}
        >
          <div className="text-3xl font-bold text-red-400">{data.errors}</div>
          <div className="text-xs text-zinc-500 mt-1">Errors</div>
        </button>
        <button
          onClick={() => setSeverityFilter(severityFilter === 'warning' ? 'all' : 'warning')}
          className={`bg-zinc-900 rounded-xl p-4 border text-left transition-colors ${severityFilter === 'warning' ? 'border-amber-500/50' : 'border-zinc-800 hover:border-zinc-700'}`}
        >
          <div className="text-3xl font-bold text-amber-400">{data.warnings}</div>
          <div className="text-xs text-zinc-500 mt-1">Warnings</div>
        </button>
        <button
          onClick={() => setSeverityFilter(severityFilter === 'info' ? 'all' : 'info')}
          className={`bg-zinc-900 rounded-xl p-4 border text-left transition-colors ${severityFilter === 'info' ? 'border-blue-500/50' : 'border-zinc-800 hover:border-zinc-700'}`}
        >
          <div className="text-3xl font-bold text-blue-400">{data.infos}</div>
          <div className="text-xs text-zinc-500 mt-1">Info</div>
        </button>
      </div>

      {/* Site-wide issues */}
      {data.siteWideIssues.length > 0 && (
        <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4 space-y-2">
          <div className="text-sm font-medium text-zinc-300 mb-2">Site-Wide Issues</div>
          {data.siteWideIssues.map((issue, idx) => {
            const cfg = SEVERITY_CONFIG[issue.severity];
            const Icon = cfg.icon;
            return (
              <div key={idx} className="flex items-start gap-3 px-3 py-2 rounded-lg bg-zinc-950/50">
                <Icon className={`w-4 h-4 mt-0.5 flex-shrink-0 ${cfg.color}`} />
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-zinc-300">{issue.message}</div>
                  <div className="text-xs text-zinc-500 mt-0.5">{issue.recommendation}</div>
                  {issue.value && <div className="text-xs text-zinc-600 mt-0.5 italic truncate">{issue.value}</div>}
                  {issue.suggestedFix && (
                    <div className="mt-1.5 px-2 py-1.5 rounded bg-emerald-950/40 border border-emerald-800/30">
                      <div className="text-[9px] text-emerald-500 font-semibold uppercase tracking-wider mb-0.5">AI Suggestion</div>
                      <div className="text-xs text-emerald-300">{issue.suggestedFix}</div>
                    </div>
                  )}
                </div>
                <span className={`text-[10px] px-1.5 py-0.5 rounded border flex-shrink-0 ${cfg.bg} ${cfg.color}`}>
                  {cfg.label}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* Toolbar */}
      <div className="sticky top-0 z-10 bg-zinc-950/95 backdrop-blur-sm py-2 space-y-3">
        <div className="flex items-center gap-3">
          <div className="relative flex-1">
            <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search pages or issues..."
              className="w-full pl-10 pr-4 py-2 bg-zinc-900 border border-zinc-800 rounded-lg text-sm focus:outline-none focus:border-zinc-600"
            />
          </div>
          <button
            onClick={handleSaveAndShare}
            disabled={saving}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-colors"
            style={{ backgroundColor: 'var(--brand-mint)', color: '#0f1219' }}
          >
            <Share2 className="w-3.5 h-3.5" /> {saving ? 'Saving...' : 'Save & Share'}
          </button>
          <button
            onClick={() => setReportModal(true)}
            className="flex items-center gap-1.5 px-3 py-2 bg-zinc-800 hover:bg-zinc-700 rounded-lg text-xs font-medium transition-colors"
          >
            <FileText className="w-3.5 h-3.5" /> Export
          </button>
          <button
            onClick={runAudit}
            className="flex items-center gap-1.5 px-3 py-2 bg-zinc-800 hover:bg-zinc-700 rounded-lg text-xs font-medium transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" /> Re-scan
          </button>
        </div>
      </div>

      {/* Share URL banner */}
      {shareUrl && (
        <div className="flex items-center gap-3 px-4 py-3 rounded-lg" style={{ backgroundColor: 'var(--brand-mint-dim)', border: '1px solid rgba(46,217,195,0.2)' }}>
          <Share2 className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--brand-mint)' }} />
          <div className="flex-1 min-w-0">
            <div className="text-xs font-medium" style={{ color: 'var(--brand-mint)' }}>Report saved! Share this link with clients:</div>
            <div className="text-xs text-zinc-300 truncate mt-0.5 font-mono">{shareUrl}</div>
          </div>
          <button onClick={copyShareUrl} className="flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors" style={{ backgroundColor: 'var(--brand-mint)', color: '#0f1219' }}>
            <Copy className="w-3 h-3" /> {copied ? 'Copied!' : 'Copy'}
          </button>
          <a href={shareUrl} target="_blank" rel="noopener noreferrer" className="p-1.5 rounded-md hover:bg-white/10" style={{ color: 'var(--brand-mint)' }}>
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
          <button onClick={() => setShareUrl(null)} className="p-1 rounded hover:bg-white/10">
            <X className="w-3.5 h-3.5 text-zinc-400" />
          </button>
        </div>
      )}

      {/* Category filter pills */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="text-[10px] text-zinc-600 uppercase tracking-wider mr-1">Category:</span>
        {(['all', ...Object.keys(CATEGORY_CONFIG)] as (CheckCategory | 'all')[]).map(cat => {
          const active = categoryFilter === cat;
          const cfg = cat !== 'all' ? CATEGORY_CONFIG[cat] : null;
          return (
            <button
              key={cat}
              onClick={() => setCategoryFilter(active ? 'all' : cat)}
              className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors border ${
                active
                  ? 'border-zinc-500 bg-zinc-800 text-zinc-200'
                  : 'border-zinc-800 text-zinc-500 hover:border-zinc-700 hover:text-zinc-400'
              }`}
            >
              {cat === 'all' ? 'All' : cfg?.label}
            </button>
          );
        })}
      </div>

      {/* Showing count */}
      <div className="text-xs text-zinc-600 px-1">
        Showing {filteredPages.length} of {data.pages.length} pages
        {(severityFilter !== 'all' || categoryFilter !== 'all') && (
          <button onClick={() => { setSeverityFilter('all'); setCategoryFilter('all'); }} className="ml-2 text-zinc-500 hover:text-zinc-300 underline">
            Clear filters
          </button>
        )}
      </div>

      {/* Page list */}
      <div className="space-y-1">
        {filteredPages.map(page => {
          const isExpanded = expanded.has(page.page);
          const errorCount = page.issues.filter(i => i.severity === 'error').length;
          const warningCount = page.issues.filter(i => i.severity === 'warning').length;

          return (
            <div key={page.slug || page.page}>
              <button
                onClick={() => toggleExpand(page.page)}
                className="w-full flex items-center gap-3 px-4 py-3 rounded-lg hover:bg-zinc-900/50 transition-colors text-left"
              >
                {isExpanded ? (
                  <ChevronDown className="w-3.5 h-3.5 text-zinc-500 flex-shrink-0" />
                ) : (
                  <ChevronRight className="w-3.5 h-3.5 text-zinc-500 flex-shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-zinc-300 truncate">{page.page}</div>
                  <div className="text-xs text-zinc-600 truncate">/{page.slug}</div>
                </div>
                <div className="flex items-center gap-3 flex-shrink-0">
                  {errorCount > 0 && <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-500/10 border border-red-500/30 text-red-400">{errorCount} error{errorCount > 1 ? 's' : ''}</span>}
                  {warningCount > 0 && <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/10 border border-amber-500/30 text-amber-400">{warningCount} warn</span>}
                  {page.issues.length === 0 && <CheckCircle className="w-4 h-4 text-green-500" />}
                  <span className={`text-sm font-bold tabular-nums ${scoreColor(page.score)}`}>{page.score}</span>
                </div>
              </button>

              {isExpanded && (
                <div className="ml-8 mb-2 space-y-1">
                  {page.issues.length === 0 ? (
                    <div className="text-xs text-green-500 px-4 py-2">No issues found</div>
                  ) : (
                    page.issues
                      .filter(i => severityFilter === 'all' || i.severity === severityFilter)
                      .filter(i => categoryFilter === 'all' || i.category === categoryFilter)
                      .map((issue, idx) => {
                        const cfg = SEVERITY_CONFIG[issue.severity];
                        const catCfg = issue.category ? CATEGORY_CONFIG[issue.category] : null;
                        const Icon = cfg.icon;
                        return (
                          <div key={idx} className="flex items-start gap-3 px-4 py-2 rounded-lg hover:bg-zinc-900/30 transition-colors">
                            <Icon className={`w-3.5 h-3.5 mt-0.5 flex-shrink-0 ${cfg.color}`} />
                            <div className="flex-1 min-w-0">
                              <div className="text-xs text-zinc-300">{issue.message}</div>
                              <div className="text-[11px] text-zinc-500 mt-0.5">{issue.recommendation}</div>
                              {issue.value && <div className="text-[10px] text-zinc-600 mt-0.5 italic truncate">{issue.value}</div>}
                              {issue.suggestedFix && (
                                <div className="mt-1.5 px-2 py-1.5 rounded bg-emerald-950/40 border border-emerald-800/30">
                                  <div className="text-[9px] text-emerald-500 font-semibold uppercase tracking-wider mb-0.5">AI Suggestion</div>
                                  <div className="text-[11px] text-emerald-300">{issue.suggestedFix}</div>
                                </div>
                              )}
                            </div>
                            <div className="flex items-center gap-1 flex-shrink-0">
                              {catCfg && (
                                <span className={`text-[9px] px-1 py-0.5 rounded border border-zinc-800 ${catCfg.color}`}>
                                  {catCfg.label}
                                </span>
                              )}
                              <span className={`text-[9px] px-1 py-0.5 rounded border ${cfg.bg} ${cfg.color}`}>
                                {issue.check}
                              </span>
                            </div>
                          </div>
                        );
                      })
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Report format chooser */}
      {reportModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm" onClick={() => setReportModal(false)}>
          <div className="relative max-w-md w-full mx-4 bg-zinc-900 rounded-xl border border-zinc-700 p-6" onClick={e => e.stopPropagation()}>
            <button onClick={() => setReportModal(false)} className="absolute top-4 right-4 text-zinc-400 hover:text-white"><X className="w-4 h-4" /></button>
            <h3 className="text-lg font-semibold mb-1">Export SEO Report</h3>
            <p className="text-xs text-zinc-500 mb-5">Choose a format to view the audit results</p>
            <div className="space-y-3">
              <button
                onClick={handleExportReport}
                className="w-full flex items-center gap-3 px-4 py-3 bg-teal-600 hover:bg-teal-500 rounded-lg transition-colors text-left"
              >
                <FileText className="w-5 h-5" />
                <div>
                  <div className="text-sm font-medium">HTML Report</div>
                  <div className="text-xs text-teal-200">Beautifully formatted, client-ready report. Print to PDF.</div>
                </div>
              </button>
              <button
                onClick={handleExportCSV}
                className="w-full flex items-center gap-3 px-4 py-3 bg-zinc-800 hover:bg-zinc-700 rounded-lg transition-colors text-left"
              >
                <Download className="w-5 h-5" />
                <div>
                  <div className="text-sm font-medium">CSV Spreadsheet</div>
                  <div className="text-xs text-zinc-400">Raw data for analysis in Excel or Google Sheets.</div>
                </div>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Inline report viewer */}
      {reportView && (
        <div className="fixed inset-0 z-50 flex flex-col bg-black/90 backdrop-blur-sm">
          <div className="flex items-center justify-between px-4 py-3 bg-zinc-900 border-b border-zinc-800">
            <div className="text-sm font-medium text-zinc-200">
              {reportView === 'html' ? 'SEO Audit Report' : 'CSV Export'}
            </div>
            <div className="flex items-center gap-2">
              {reportView === 'csv' && (
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(getCSV());
                  }}
                  className="px-3 py-1.5 bg-teal-600 hover:bg-teal-500 rounded-lg text-xs font-medium transition-colors"
                >
                  Copy to Clipboard
                </button>
              )}
              {reportView === 'html' && (
                <button
                  onClick={() => {
                    const iframe = document.getElementById('report-iframe') as HTMLIFrameElement;
                    if (iframe?.contentWindow) iframe.contentWindow.print();
                  }}
                  className="px-3 py-1.5 bg-teal-600 hover:bg-teal-500 rounded-lg text-xs font-medium transition-colors"
                >
                  Print / Save as PDF
                </button>
              )}
              <button
                onClick={() => setReportView(null)}
                className="p-1.5 hover:bg-zinc-800 rounded-lg transition-colors"
              >
                <X className="w-4 h-4 text-zinc-400" />
              </button>
            </div>
          </div>
          <div className="flex-1 overflow-auto">
            {reportView === 'html' ? (
              <iframe
                id="report-iframe"
                srcDoc={generateHtmlReport()}
                className="w-full h-full border-0 bg-white"
                title="SEO Report"
              />
            ) : (
              <textarea
                readOnly
                value={getCSV()}
                className="w-full h-full p-4 bg-zinc-950 text-zinc-300 text-xs font-mono resize-none focus:outline-none"
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export { SeoAudit };
