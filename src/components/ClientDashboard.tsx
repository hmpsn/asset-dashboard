import { useState, useEffect, useRef } from 'react';
import {
  Loader2, Search, TrendingDown, Eye, MousePointer,
  BarChart3, ArrowUpDown, Sparkles, Send, AlertTriangle,
  Target, Zap, Shield, MessageSquare, X, ChevronDown, ChevronUp,
  CheckCircle2, Info, LayoutDashboard, LineChart, Lock,
  Users, Globe, Activity, Filter, ClipboardCheck, Check, Edit3,
} from 'lucide-react';

interface SearchQuery { query: string; clicks: number; impressions: number; ctr: number; position: number; }
interface SearchPage { page: string; clicks: number; impressions: number; ctr: number; position: number; }
interface SearchOverview {
  totalClicks: number; totalImpressions: number; avgCtr: number; avgPosition: number;
  topQueries: SearchQuery[]; topPages: SearchPage[];
  dateRange: { start: string; end: string };
}
interface PerformanceTrend { date: string; clicks: number; impressions: number; ctr: number; position: number; }
interface EventGroup { id: string; name: string; order: number; color: string; }
interface EventDisplayConfig { eventName: string; displayName: string; pinned: boolean; group?: string; }
interface WorkspaceInfo { id: string; name: string; webflowSiteId?: string; webflowSiteName?: string; gscPropertyUrl?: string; ga4PropertyId?: string; liveDomain?: string; eventConfig?: EventDisplayConfig[]; eventGroups?: EventGroup[]; requiresPassword?: boolean; }
interface AuditSummary { id: string; createdAt: string; siteScore: number; totalPages: number; errors: number; warnings: number; previousScore?: number; }
interface SeoIssue { check: string; severity: 'error' | 'warning' | 'info'; category?: string; message: string; recommendation: string; value?: string; }
interface PageAuditResult { pageId: string; page: string; slug: string; url: string; score: number; issues: SeoIssue[]; }
interface AuditDetail {
  id: string; createdAt: string; siteName: string; logoUrl?: string; previousScore?: number;
  audit: { siteScore: number; totalPages: number; errors: number; warnings: number; infos: number; pages: PageAuditResult[]; siteWideIssues: SeoIssue[]; };
  scoreHistory: Array<{ id: string; createdAt: string; siteScore: number }>;
}
interface ChatMessage { role: 'user' | 'assistant'; content: string; }
interface GA4Overview {
  totalUsers: number; totalSessions: number; totalPageviews: number;
  avgSessionDuration: number; bounceRate: number; newUserPercentage: number;
  dateRange: { start: string; end: string };
}
interface GA4DailyTrend { date: string; users: number; sessions: number; pageviews: number; }
interface GA4TopPage { path: string; pageviews: number; users: number; avgEngagementTime: number; }
interface GA4TopSource { source: string; medium: string; users: number; sessions: number; }
interface GA4DeviceBreakdown { device: string; users: number; sessions: number; percentage: number; }
interface GA4CountryBreakdown { country: string; users: number; sessions: number; }
interface GA4Event { eventName: string; eventCount: number; users: number; }
interface GA4EventTrend { date: string; eventCount: number; }
interface GA4ConversionSummary { eventName: string; conversions: number; users: number; rate: number; }
interface GA4EventPageBreakdown { eventName: string; pagePath: string; eventCount: number; users: number; }
interface Props { workspaceId: string; }

type SortKey = 'clicks' | 'impressions' | 'ctr' | 'position';
type ClientTab = 'overview' | 'search' | 'health' | 'analytics' | 'approvals';

interface ApprovalItem {
  id: string; pageId: string; pageTitle: string; pageSlug: string;
  field: 'seoTitle' | 'seoDescription'; currentValue: string; proposedValue: string;
  clientValue?: string; status: 'pending' | 'approved' | 'rejected' | 'applied'; clientNote?: string;
}
interface ApprovalBatch {
  id: string; workspaceId: string; siteId: string; name: string;
  items: ApprovalItem[]; status: string; createdAt: string;
}

const SEV = {
  error: { bg: 'bg-red-500/10', border: 'border-red-500/20', text: 'text-red-400' },
  warning: { bg: 'bg-amber-500/10', border: 'border-amber-500/20', text: 'text-amber-400' },
  info: { bg: 'bg-blue-500/10', border: 'border-blue-500/20', text: 'text-blue-400' },
} as const;

const CAT_LABELS: Record<string, { label: string; color: string }> = {
  content: { label: 'Content', color: '#60a5fa' }, technical: { label: 'Technical', color: '#2dd4bf' },
  social: { label: 'Social', color: '#f472b6' }, performance: { label: 'Performance', color: '#fbbf24' },
  accessibility: { label: 'Accessibility', color: '#34d399' },
};

const QUICK_QUESTIONS = [
  'What are my biggest opportunities right now?',
  'Which pages drive the most conversions?',
  'Summarize my traffic and event trends this month',
  'What should I focus on to improve performance?',
  'What content should I create next based on search data?',
];

function MiniSparkline({ data, color }: { data: number[]; color: string }) {
  if (data.length < 2) return null;
  const max = Math.max(...data), min = Math.min(...data), range = max - min || 1, w = 120, h = 32;
  const points = data.map((v, i) => `${(i / (data.length - 1)) * w},${h - ((v - min) / range) * (h - 4) - 2}`).join(' ');
  return <svg width={w} height={h} className="flex-shrink-0"><polyline fill="none" stroke={color} strokeWidth="1.5" points={points} strokeLinejoin="round" /></svg>;
}

function TrendChart({ data, metric, color }: { data: PerformanceTrend[]; metric: keyof PerformanceTrend; color: string }) {
  if (data.length < 2) return null;
  const values = data.map(d => d[metric] as number);
  const max = Math.max(...values), min = Math.min(...values), range = max - min || 1, w = 100;
  const points = values.map((v, i) => `${(i / (values.length - 1)) * w},${100 - ((v - min) / range) * 90 - 5}`).join(' ');
  return (
    <svg viewBox={`0 0 ${w} 100`} className="w-full" style={{ height: 80 }} preserveAspectRatio="none">
      <defs><linearGradient id={`cg-${metric}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={color} stopOpacity="0.2" /><stop offset="100%" stopColor={color} stopOpacity="0" /></linearGradient></defs>
      <polygon fill={`url(#cg-${metric})`} points={`0,100 ${points} ${w},100`} />
      <polyline fill="none" stroke={color} strokeWidth="1.5" points={points} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  );
}

function DualTrendChart({ data }: { data: PerformanceTrend[] }) {
  if (data.length < 2) return null;
  const clicks = data.map(d => d.clicks);
  const imps = data.map(d => d.impressions);
  const cMax = Math.max(...clicks), cMin = Math.min(...clicks), cRange = cMax - cMin || 1;
  const iMax = Math.max(...imps), iMin = Math.min(...imps), iRange = iMax - iMin || 1;
  const w = 100;
  const cPoints = clicks.map((v, i) => `${(i / (clicks.length - 1)) * w},${100 - ((v - cMin) / cRange) * 85 - 7}`).join(' ');
  const iPoints = imps.map((v, i) => `${(i / (imps.length - 1)) * w},${100 - ((v - iMin) / iRange) * 85 - 7}`).join(' ');
  return (
    <div>
      <div className="flex items-center gap-4 mb-2">
        <div className="flex items-center gap-1.5"><div className="w-2.5 h-0.5 rounded bg-blue-400" /><span className="text-[10px] text-blue-400">Clicks</span></div>
        <div className="flex items-center gap-1.5"><div className="w-2.5 h-0.5 rounded bg-teal-400" /><span className="text-[10px] text-teal-400">Impressions</span></div>
      </div>
      <svg viewBox={`0 0 ${w} 100`} className="w-full" style={{ height: 120 }} preserveAspectRatio="none">
        <defs>
          <linearGradient id="cg-clicks-dual" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#60a5fa" stopOpacity="0.15" /><stop offset="100%" stopColor="#60a5fa" stopOpacity="0" /></linearGradient>
          <linearGradient id="cg-imps-dual" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#2dd4bf" stopOpacity="0.1" /><stop offset="100%" stopColor="#2dd4bf" stopOpacity="0" /></linearGradient>
        </defs>
        <polygon fill="url(#cg-imps-dual)" points={`0,100 ${iPoints} ${w},100`} />
        <polyline fill="none" stroke="#2dd4bf" strokeWidth="1.2" points={iPoints} vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeOpacity="0.6" />
        <polygon fill="url(#cg-clicks-dual)" points={`0,100 ${cPoints} ${w},100`} />
        <polyline fill="none" stroke="#60a5fa" strokeWidth="1.5" points={cPoints} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

function ScoreRing({ score, size = 120 }: { score: number; size?: number }) {
  const sw = 8, r = (size - sw) / 2, c = 2 * Math.PI * r, offset = c - (score / 100) * c;
  const color = score >= 80 ? '#34d399' : score >= 60 ? '#fbbf24' : '#f87171';
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="transform -rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#27272a" strokeWidth={sw} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={sw}
          strokeDasharray={c} strokeDashoffset={offset} strokeLinecap="round" className="transition-all duration-1000" />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center"><span className="font-bold" style={{ color, fontSize: size * 0.28 }}>{score}</span></div>
    </div>
  );
}

function ScoreHistoryChart({ history }: { history: Array<{ id: string; createdAt: string; siteScore: number }> }) {
  if (history.length < 2) return null;
  const scores = history.slice().reverse().map(h => h.siteScore);
  const max = Math.max(...scores, 100), min = Math.min(...scores, 0), range = max - min || 1, w = 100;
  const points = scores.map((v, i) => `${(i / (scores.length - 1)) * w},${100 - ((v - min) / range) * 85 - 5}`).join(' ');
  return (
    <div>
      <svg viewBox={`0 0 ${w} 100`} className="w-full" style={{ height: 60 }} preserveAspectRatio="none">
        <defs><linearGradient id="sh-g" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#34d399" stopOpacity="0.15" /><stop offset="100%" stopColor="#34d399" stopOpacity="0" /></linearGradient></defs>
        <polygon fill="url(#sh-g)" points={`0,100 ${points} ${w},100`} />
        <polyline fill="none" stroke="#34d399" strokeWidth="2" points={points} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
      </svg>
      <div className="flex justify-between text-[9px] text-zinc-600 mt-1">
        {history.slice().reverse().map((h, i) => (i === 0 || i === history.length - 1)
          ? <span key={h.id}>{new Date(h.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
          : <span key={h.id} />
        )}
      </div>
    </div>
  );
}

function RenderMarkdown({ text }: { text: string }) {
  const lines = text.split('\n');
  return (
    <div className="space-y-1.5">
      {lines.map((line, i) => {
        if (line.startsWith('### ')) return <h4 key={i} className="text-xs font-semibold text-zinc-200 mt-2">{line.slice(4)}</h4>;
        if (line.startsWith('## ')) return <h3 key={i} className="text-sm font-semibold text-zinc-200 mt-2">{line.slice(3)}</h3>;
        if (line.startsWith('- **')) {
          const m = line.match(/^- \*\*(.+?)\*\*(.*)$/);
          if (m) return <div key={i} className="flex gap-1.5 text-[11px]"><span className="text-zinc-500">•</span><span><strong className="text-zinc-200">{m[1]}</strong><span className="text-zinc-400">{m[2]}</span></span></div>;
        }
        if (line.startsWith('- ')) return <div key={i} className="flex gap-1.5 text-[11px] text-zinc-400"><span className="text-zinc-500">•</span><span>{line.slice(2)}</span></div>;
        if (line.match(/^\d+\. /)) return <div key={i} className="text-[11px] text-zinc-400 ml-2">{line}</div>;
        if (line.trim() === '') return <div key={i} className="h-1" />;
        const parsed = line.replace(/\*\*(.+?)\*\*/g, '<b class="text-zinc-200">$1</b>').replace(/`(.+?)`/g, '<code class="bg-zinc-800 px-1 rounded text-zinc-300 text-[10px]">$1</code>');
        return <p key={i} className="text-[11px] text-zinc-400 leading-relaxed" dangerouslySetInnerHTML={{ __html: parsed }} />;
      })}
    </div>
  );
}

/** Rewrite webflow.io URLs to live domain, or show just the path */
function toLiveUrl(url: string, liveDomain?: string): string {
  if (!url) return url;
  if (liveDomain) {
    return url.replace(/https?:\/\/[^/]+\.webflow\.io/, liveDomain.replace(/\/$/, ''));
  }
  // No live domain — strip the staging domain and show just the path
  try {
    const path = new URL(url).pathname;
    return path || '/';
  } catch {
    return url.replace(/https?:\/\/[^/]+/, '') || '/';
  }
}

export function ClientDashboard({ workspaceId }: Props) {
  const [ws, setWs] = useState<WorkspaceInfo | null>(null);
  const [overview, setOverview] = useState<SearchOverview | null>(null);
  const [trend, setTrend] = useState<PerformanceTrend[]>([]);
  const [audit, setAudit] = useState<AuditSummary | null>(null);
  const [auditDetail, setAuditDetail] = useState<AuditDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<ClientTab>('overview');
  const [days, setDays] = useState(28);
  const [sortKey, setSortKey] = useState<SortKey>('clicks');
  const [sortAsc, setSortAsc] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const [severityFilter, setSeverityFilter] = useState<'all' | 'error' | 'warning' | 'info'>('all');
  const [expandedPages, setExpandedPages] = useState<Set<string>>(new Set());
  const [auditSearch, setAuditSearch] = useState('');
  const [ga4Overview, setGa4Overview] = useState<GA4Overview | null>(null);
  const [ga4Trend, setGa4Trend] = useState<GA4DailyTrend[]>([]);
  const [ga4Pages, setGa4Pages] = useState<GA4TopPage[]>([]);
  const [ga4Sources, setGa4Sources] = useState<GA4TopSource[]>([]);
  const [ga4Devices, setGa4Devices] = useState<GA4DeviceBreakdown[]>([]);
  const [ga4Countries, setGa4Countries] = useState<GA4CountryBreakdown[]>([]);
  const [ga4Events, setGa4Events] = useState<GA4Event[]>([]);
  const [ga4Conversions, setGa4Conversions] = useState<GA4ConversionSummary[]>([]);
  const [ga4SelectedEvent, setGa4SelectedEvent] = useState<string | null>(null);
  const [ga4EventTrend, setGa4EventTrend] = useState<GA4EventTrend[]>([]);
  const [explorerData, setExplorerData] = useState<GA4EventPageBreakdown[]>([]);
  const [explorerEvent, setExplorerEvent] = useState('');
  const [explorerPage, setExplorerPage] = useState('');
  const [explorerLoading, setExplorerLoading] = useState(false);
  const [showExplorer, setShowExplorer] = useState(false);
  const [eventsPageFilter, setEventsPageFilter] = useState('');
  const [eventsPageData, setEventsPageData] = useState<GA4ConversionSummary[] | null>(null);
  const [eventsPageLoading, setEventsPageLoading] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [passwordInput, setPasswordInput] = useState('');
  const [authError, setAuthError] = useState('');
  const [authLoading, setAuthLoading] = useState(false);
  const [approvalBatches, setApprovalBatches] = useState<ApprovalBatch[]>([]);
  const [approvalsLoading, setApprovalsLoading] = useState(false);
  const [applyingBatch, setApplyingBatch] = useState<string | null>(null);
  const [editingApproval, setEditingApproval] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [chatMessages]);

  // Load workspace info first (includes requiresPassword flag)
  useEffect(() => {
    setLoading(true);
    fetch(`/api/public/workspace/${workspaceId}`)
      .then(r => r.json())
      .then((data: WorkspaceInfo) => {
        if (!data.id) { setError('Workspace not found'); setLoading(false); return; }
        setWs(data);
        // Check if already authenticated via sessionStorage
        if (data.requiresPassword) {
          const stored = sessionStorage.getItem(`dash_auth_${workspaceId}`);
          if (stored === 'true') {
            setAuthenticated(true);
            loadDashboardData(data);
          }
        } else {
          setAuthenticated(true);
          loadDashboardData(data);
        }
        setLoading(false);
      })
      .catch(() => { setError('Failed to load dashboard'); setLoading(false); });
  }, [workspaceId]);

  const loadApprovals = async (wsId: string) => {
    setApprovalsLoading(true);
    try {
      const res = await fetch(`/api/public/approvals/${wsId}`);
      const data = await res.json();
      if (Array.isArray(data)) setApprovalBatches(data);
    } catch { /* skip */ }
    setApprovalsLoading(false);
  };

  const loadDashboardData = (data: WorkspaceInfo) => {
    if (data.gscPropertyUrl) loadSearchData(data.id, 28);
    fetch(`/api/public/audit-summary/${data.id}`).then(r => r.json()).then(a => { if (a?.id) setAudit(a); }).catch(() => {});
    fetch(`/api/public/audit-detail/${data.id}`).then(r => r.json()).then(d => { if (d?.id) setAuditDetail(d); }).catch(() => {});
    if (data.ga4PropertyId) loadGA4Data(data.id, 28);
    loadApprovals(data.id);
  };

  const loadGA4Data = async (wsId: string, numDays: number) => {
    try {
      const [ovRes, trRes, pgRes, srcRes, devRes, ctryRes, evtRes, convRes] = await Promise.all([
        fetch(`/api/public/analytics-overview/${wsId}?days=${numDays}`),
        fetch(`/api/public/analytics-trend/${wsId}?days=${numDays}`),
        fetch(`/api/public/analytics-top-pages/${wsId}?days=${numDays}`),
        fetch(`/api/public/analytics-sources/${wsId}?days=${numDays}`),
        fetch(`/api/public/analytics-devices/${wsId}?days=${numDays}`),
        fetch(`/api/public/analytics-countries/${wsId}?days=${numDays}`),
        fetch(`/api/public/analytics-events/${wsId}?days=${numDays}`),
        fetch(`/api/public/analytics-conversions/${wsId}?days=${numDays}`),
      ]);
      const [ov, tr, pg, src, dev, ctry, evt, conv] = await Promise.all([ovRes.json(), trRes.json(), pgRes.json(), srcRes.json(), devRes.json(), ctryRes.json(), evtRes.json(), convRes.json()]);
      if (!ov.error) setGa4Overview(ov);
      if (Array.isArray(tr)) setGa4Trend(tr);
      if (Array.isArray(pg)) setGa4Pages(pg);
      if (Array.isArray(src)) setGa4Sources(src);
      if (Array.isArray(dev)) setGa4Devices(dev);
      if (Array.isArray(ctry)) setGa4Countries(ctry);
      if (Array.isArray(evt)) setGa4Events(evt);
      if (Array.isArray(conv)) setGa4Conversions(conv);
    } catch (err) {
      console.error('GA4 data load error:', err);
    }
  };

  const eventDisplayName = (eventName: string): string => {
    const cfg = ws?.eventConfig?.find(c => c.eventName === eventName);
    return cfg?.displayName && cfg.displayName !== eventName ? cfg.displayName : eventName.replace(/_/g, ' ');
  };

  const isEventPinned = (eventName: string): boolean => {
    return ws?.eventConfig?.find(c => c.eventName === eventName)?.pinned || false;
  };

  const sortedConversions = [...ga4Conversions].sort((a, b) => {
    const ap = isEventPinned(a.eventName) ? 1 : 0;
    const bp = isEventPinned(b.eventName) ? 1 : 0;
    return bp - ap;
  });

  const fetchEventsForPage = async (pagePath: string) => {
    if (!ws) return;
    if (!pagePath) { setEventsPageData(null); return; }
    setEventsPageLoading(true);
    try {
      const params = new URLSearchParams({ days: String(days), page: pagePath });
      const res = await fetch(`/api/public/analytics-event-explorer/${ws.id}?${params}`);
      const data = await res.json();
      if (Array.isArray(data)) {
        // Aggregate by event name into conversion-like format
        const byEvent: Record<string, { conversions: number; users: number }> = {};
        for (const row of data) {
          if (!byEvent[row.eventName]) byEvent[row.eventName] = { conversions: 0, users: 0 };
          byEvent[row.eventName].conversions += row.eventCount;
          byEvent[row.eventName].users += row.users;
        }
        const totalUsers = Object.values(byEvent).reduce((s, v) => s + v.users, 0) || 1;
        setEventsPageData(Object.entries(byEvent).map(([eventName, v]) => ({
          eventName, conversions: v.conversions, users: v.users,
          rate: Math.round((v.conversions / totalUsers) * 100 * 10) / 10,
        })).sort((a, b) => b.conversions - a.conversions));
      }
    } catch { setEventsPageData(null); }
    finally { setEventsPageLoading(false); }
  };

  const runExplorer = async (event?: string, page?: string) => {
    if (!ws) return;
    setExplorerLoading(true);
    try {
      const params = new URLSearchParams({ days: String(days) });
      if (event) params.set('event', event);
      if (page) params.set('page', page);
      const res = await fetch(`/api/public/analytics-event-explorer/${ws.id}?${params}`);
      const data = await res.json();
      if (Array.isArray(data)) setExplorerData(data);
    } catch { setExplorerData([]); }
    finally { setExplorerLoading(false); }
  };

  const loadEventTrend = async (eventName: string) => {
    if (!ws) return;
    setGa4SelectedEvent(eventName);
    try {
      const res = await fetch(`/api/public/analytics-event-trend/${ws.id}?days=${days}&event=${encodeURIComponent(eventName)}`);
      const data = await res.json();
      if (Array.isArray(data)) setGa4EventTrend(data);
    } catch { setGa4EventTrend([]); }
  };

  const handlePasswordSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!passwordInput.trim()) return;
    setAuthLoading(true);
    setAuthError('');
    try {
      const res = await fetch(`/api/public/auth/${workspaceId}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: passwordInput }),
      });
      if (res.ok) {
        setAuthenticated(true);
        sessionStorage.setItem(`dash_auth_${workspaceId}`, 'true');
        if (ws) loadDashboardData(ws);
      } else {
        setAuthError('Incorrect password');
      }
    } catch {
      setAuthError('Authentication failed');
    } finally { setAuthLoading(false); }
  };

  const loadSearchData = async (wsId: string, numDays: number) => {
    try {
      const [ovRes, trRes] = await Promise.all([
        fetch(`/api/public/search-overview/${wsId}?days=${numDays}`),
        fetch(`/api/public/performance-trend/${wsId}?days=${numDays}`),
      ]);
      const [ovData, trData] = await Promise.all([ovRes.json(), trRes.json()]);
      if (ovData.error) throw new Error(ovData.error);
      setOverview(ovData);
      setTrend(Array.isArray(trData) ? trData : []);
    } catch (err) {
      console.error('Search data load error:', err);
    }
  };

  const changeDays = (d: number) => {
    setDays(d);
    if (ws) {
      loadSearchData(ws.id, d);
      if (ws.ga4PropertyId) loadGA4Data(ws.id, d);
    }
  };

  const askAi = async (question: string) => {
    if (!question.trim() || !ws) return;
    if (!overview && !ga4Overview) return;
    setChatMessages(prev => [...prev, { role: 'user', content: question.trim() }]);
    setChatInput('');
    setChatLoading(true);
    try {
      const context: Record<string, unknown> = { days };
      if (overview) {
        context.search = {
          dateRange: overview.dateRange, totalClicks: overview.totalClicks,
          totalImpressions: overview.totalImpressions, avgCtr: overview.avgCtr,
          avgPosition: overview.avgPosition, topQueries: overview.topQueries.slice(0, 15), topPages: overview.topPages.slice(0, 10),
        };
      }
      if (ga4Overview) {
        context.ga4 = {
          overview: ga4Overview,
          topPages: ga4Pages.slice(0, 10),
          sources: ga4Sources.slice(0, 8),
          devices: ga4Devices,
          events: ga4Events.slice(0, 15),
          conversions: ga4Conversions.slice(0, 10),
          countries: ga4Countries.slice(0, 8),
        };
      }
      const res = await fetch(`/api/public/search-chat/${ws.id}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: question.trim(), context }),
      });
      const data = await res.json();
      setChatMessages(prev => [...prev, { role: 'assistant', content: data.error ? `Error: ${data.error}` : data.answer }]);
    } catch {
      setChatMessages(prev => [...prev, { role: 'assistant', content: 'Sorry, something went wrong.' }]);
    } finally { setChatLoading(false); }
  };

  const handleSort = (key: SortKey) => { if (sortKey === key) setSortAsc(!sortAsc); else { setSortKey(key); setSortAsc(false); } };
  const sortedQueries = () => {
    if (!overview) return [];
    return [...overview.topQueries].sort((a, b) => sortAsc ? a[sortKey] - b[sortKey] : b[sortKey] - a[sortKey]);
  };

  const getInsights = () => {
    if (!overview) return null;
    const q = overview.topQueries;
    return {
      lowHanging: q.filter(x => x.position > 5 && x.position <= 20 && x.impressions > 30),
      topPerformers: q.filter(x => x.position <= 3 && x.clicks > 5),
      ctrOpps: q.filter(x => x.position <= 10 && x.ctr < 3 && x.impressions > 50),
      highImpLowClick: q.filter(x => x.impressions > 100 && x.clicks < 5),
      page1: q.filter(x => x.position <= 10).length,
      top3: q.filter(x => x.position <= 3).length,
    };
  };

  if (loading) return (
    <div className="min-h-screen bg-[#0f1219] text-zinc-200">
      <header className="border-b border-zinc-800">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center gap-4">
          <div className="h-6 w-24 bg-zinc-800 rounded animate-pulse" />
          <div className="w-px h-8 bg-zinc-800" />
          <div><div className="h-5 w-40 bg-zinc-800 rounded animate-pulse" /><div className="h-3 w-28 bg-zinc-800/50 rounded animate-pulse mt-1.5" /></div>
        </div>
        <div className="max-w-6xl mx-auto px-6 pb-3 flex gap-4">
          {[1,2,3,4].map(i => <div key={i} className="h-4 w-20 bg-zinc-800/50 rounded animate-pulse" />)}
        </div>
      </header>
      <main className="max-w-6xl mx-auto px-6 py-6">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {[1,2,3,4,5].map(i => <div key={i} className="bg-zinc-900 rounded-xl p-4 border border-zinc-800"><div className="h-4 w-4 bg-zinc-800 rounded mb-2 animate-pulse" /><div className="h-7 w-16 bg-zinc-800 rounded animate-pulse" /><div className="h-3 w-20 bg-zinc-800/50 rounded animate-pulse mt-2" /></div>)}
        </div>
      </main>
    </div>
  );
  if (error || !ws) return (
    <div className="min-h-screen bg-[#0f1219] flex items-center justify-center">
      <div className="text-center">
        <p className="text-red-400 text-sm mb-3">{error || 'Dashboard not found'}</p>
        <button onClick={() => window.location.reload()} className="text-xs text-zinc-400 hover:text-zinc-200 px-3 py-1.5 rounded-lg border border-zinc-700 hover:border-zinc-600 transition-colors">Try Again</button>
      </div>
    </div>
  );

  // Password gate
  if (ws.requiresPassword && !authenticated) return (
    <div className="min-h-screen bg-[#0f1219] flex items-center justify-center">
      <div className="w-full max-w-sm">
        <div className="bg-zinc-900 rounded-2xl border border-zinc-800 p-8 shadow-2xl shadow-black/40">
          <div className="flex flex-col items-center mb-6">
            <img src="/logo.svg" alt="hmpsn studio" className="h-7 opacity-60 mb-4" />
            <div className="w-12 h-12 rounded-2xl bg-teal-500/10 flex items-center justify-center mb-4">
              <Lock className="w-6 h-6 text-teal-400" />
            </div>
            <h2 className="text-lg font-semibold text-zinc-200">{ws.name}</h2>
            <p className="text-xs text-zinc-500 mt-1">Enter the password to access this dashboard</p>
          </div>
          <form onSubmit={handlePasswordSubmit} className="space-y-4">
            <div>
              <input
                type="password"
                value={passwordInput}
                onChange={e => { setPasswordInput(e.target.value); setAuthError(''); }}
                placeholder="Dashboard password"
                className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-sm text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-teal-500 transition-colors"
                autoFocus
              />
              {authError && <p className="text-xs text-red-400 mt-2">{authError}</p>}
            </div>
            <button
              type="submit"
              disabled={authLoading || !passwordInput.trim()}
              className="w-full py-3 rounded-xl bg-gradient-to-r from-teal-600 to-emerald-600 hover:from-teal-500 hover:to-emerald-500 disabled:opacity-50 text-white text-sm font-medium transition-all flex items-center justify-center gap-2"
            >
              {authLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Access Dashboard'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );

  const insights = getInsights();
  const togglePage = (id: string) => setExpandedPages(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const filteredPages = auditDetail?.audit.pages.filter(p => {
    if (auditSearch && !p.page.toLowerCase().includes(auditSearch.toLowerCase()) && !toLiveUrl(p.url, ws?.liveDomain).toLowerCase().includes(auditSearch.toLowerCase())) return false;
    if (severityFilter === 'all') return true;
    return p.issues.some(i => i.severity === severityFilter);
  }) || [];

  const categoryStats = auditDetail ? (() => {
    const cats: Record<string, { errors: number; warnings: number; infos: number }> = {};
    auditDetail.audit.pages.forEach(p => p.issues.forEach(i => {
      const cat = i.category || 'other';
      if (!cats[cat]) cats[cat] = { errors: 0, warnings: 0, infos: 0 };
      if (i.severity === 'error') cats[cat].errors++; else if (i.severity === 'warning') cats[cat].warnings++; else cats[cat].infos++;
    }));
    return cats;
  })() : {};

  const updateApprovalItem = async (batchId: string, itemId: string, update: { status?: string; clientValue?: string; clientNote?: string }) => {
    try {
      const res = await fetch(`/api/public/approvals/${workspaceId}/${batchId}/${itemId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(update),
      });
      const updated = await res.json();
      if (updated.id) {
        setApprovalBatches(prev => prev.map(b => b.id === batchId ? updated : b));
      }
    } catch { /* skip */ }
    setEditingApproval(null);
    setEditDraft('');
  };

  const applyApprovedBatch = async (batchId: string) => {
    setApplyingBatch(batchId);
    try {
      const res = await fetch(`/api/public/approvals/${workspaceId}/${batchId}/apply`, { method: 'POST' });
      const data = await res.json();
      if (data.applied > 0) {
        loadApprovals(workspaceId);
      }
    } catch { /* skip */ }
    setApplyingBatch(null);
  };

  const pendingApprovals = approvalBatches.reduce((sum, b) => sum + b.items.filter(i => i.status === 'pending').length, 0);

  const NAV = [
    { id: 'overview' as ClientTab, label: 'Overview', icon: LayoutDashboard },
    { id: 'search' as ClientTab, label: 'Search', icon: Search },
    { id: 'health' as ClientTab, label: 'Site Health', icon: Shield },
    { id: 'analytics' as ClientTab, label: 'Analytics', icon: LineChart },
    ...(approvalBatches.length > 0 ? [{ id: 'approvals' as ClientTab, label: 'Approvals', icon: ClipboardCheck }] : []),
  ];

  return (
    <div className="min-h-screen bg-[#0f1219] text-zinc-200">
      {/* Header */}
      <header className="border-b border-zinc-800">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <img src="/logo.svg" alt="hmpsn studio" className="h-8 opacity-80" />
            <div className="w-px h-8 bg-zinc-800" />
            <div>
              <h1 className="text-lg font-semibold">{ws.name}</h1>
              <p className="text-xs text-zinc-500 mt-0.5">Performance Dashboard{(overview || audit || ga4Overview) && <span className="ml-2 text-zinc-600">· Updated {new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>}</p>
            </div>
          </div>
          {(overview || ga4Overview) && (
            <div className="flex items-center gap-1 bg-zinc-900 rounded-lg border border-zinc-800 p-0.5">
              {[7, 28, 90].map(d => (
                <button key={d} onClick={() => changeDays(d)}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${days === d ? 'bg-zinc-700 text-zinc-200' : 'text-zinc-500 hover:text-zinc-300'}`}
                >{d}d</button>
              ))}
            </div>
          )}
        </div>
        <div className="max-w-6xl mx-auto px-6">
          <nav className="flex items-center gap-1 -mb-px overflow-x-auto scrollbar-none">
            {NAV.map(t => {
              const Icon = t.icon;
              const active = tab === t.id;
              const hasData = (t.id === 'overview') ||
                (t.id === 'search' && !!overview) ||
                (t.id === 'health' && !!audit) ||
                (t.id === 'analytics' && !!ga4Overview) ||
                (t.id === 'approvals' && approvalBatches.length > 0);
              return (
                <button key={t.id} onClick={() => setTab(t.id)}
                  className={`flex items-center gap-1.5 px-4 py-3 text-xs font-medium border-b-2 transition-colors ${
                    active ? 'border-teal-500 text-teal-400' :
                    'border-transparent text-zinc-500 hover:text-zinc-300 hover:border-zinc-700'
                  }`}>
                  <Icon className="w-3.5 h-3.5" /> {t.label}
                  {t.id === 'approvals' && pendingApprovals > 0 && <span className="ml-1 px-1.5 py-0.5 text-[9px] font-bold rounded-full bg-violet-500 text-white">{pendingApprovals}</span>}
                  {hasData && !active && t.id !== 'approvals' && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400/60" />}
                </button>
              );
            })}
          </nav>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-6 space-y-5">

        {/* ════════════ OVERVIEW TAB ════════════ */}
        {tab === 'overview' && (<>
          {/* Adaptive key metrics row */}
          {(() => {
            const cards: { icon: typeof Users; label: string; value: string; color: string; td: number[]; onClick: () => void }[] = [];
            if (audit) cards.push({ icon: Shield, label: 'Site Health', value: String(audit.siteScore), color: audit.siteScore >= 80 ? '#34d399' : audit.siteScore >= 60 ? '#fbbf24' : '#f87171', td: [], onClick: () => setTab('health') });
            if (ga4Overview) {
              cards.push({ icon: Users, label: 'Users', value: ga4Overview.totalUsers.toLocaleString(), color: '#2dd4bf', td: ga4Trend.map(d => d.users), onClick: () => setTab('analytics') });
              cards.push({ icon: Globe, label: 'Sessions', value: ga4Overview.totalSessions.toLocaleString(), color: '#60a5fa', td: ga4Trend.map(d => d.sessions), onClick: () => setTab('analytics') });
            }
            if (overview) {
              cards.push({ icon: MousePointer, label: 'Clicks', value: overview.totalClicks.toLocaleString(), color: '#60a5fa', td: trend.map(t => t.clicks), onClick: () => setTab('search') });
              cards.push({ icon: Eye, label: 'Impressions', value: overview.totalImpressions.toLocaleString(), color: '#2dd4bf', td: trend.map(t => t.impressions), onClick: () => setTab('search') });
            }
            if (ga4Overview && !overview) cards.push({ icon: Activity, label: 'Bounce Rate', value: `${ga4Overview.bounceRate}%`, color: ga4Overview.bounceRate > 60 ? '#f87171' : '#34d399', td: [], onClick: () => setTab('analytics') });
            if (cards.length === 0) return null;
            return (
              <div className={`grid gap-3 ${cards.length <= 3 ? 'grid-cols-' + cards.length : cards.length === 4 ? 'grid-cols-2 sm:grid-cols-4' : 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-5'}`}>
                {cards.map((card, i) => { const Icon = card.icon; return (
                  <button key={i} onClick={card.onClick} className="bg-zinc-900 rounded-xl p-4 border border-zinc-800 hover:border-zinc-700 transition-colors text-left">
                    <div className="flex items-center justify-between mb-1"><Icon className="w-4 h-4" style={{ color: card.color }} />{card.td.length > 2 && <MiniSparkline data={card.td} color={card.color} />}</div>
                    <div className="text-2xl font-bold" style={{ color: card.label === 'Site Health' ? card.color : undefined }}>{card.value}</div>
                    <div className="text-[10px] text-zinc-500 mt-0.5">{card.label}</div>
                  </button>
                ); })}
              </div>
            );
          })()}

          {/* Unified trend + highlights */}
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
            {/* Left: single trend chart (3/5 width) */}
            <div className="lg:col-span-3 space-y-5">
              {ga4Trend.length > 2 && (
                <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-xs font-medium text-zinc-400">Traffic Trend</span>
                    {ga4Overview && <span className="text-[10px] text-zinc-600">{ga4Overview.dateRange.start} — {ga4Overview.dateRange.end}</span>}
                  </div>
                  <svg viewBox="0 0 400 100" className="w-full h-24" preserveAspectRatio="none">
                    {(() => {
                      const maxU = Math.max(...ga4Trend.map(d => d.users), 1);
                      const maxS = Math.max(...ga4Trend.map(d => d.sessions), 1);
                      const xStep = 400 / Math.max(ga4Trend.length - 1, 1);
                      const mkPath = (vals: number[], max: number) => vals.map((v, i) => `${i === 0 ? 'M' : 'L'}${i * xStep},${95 - (v / max) * 85}`).join(' ');
                      return (<>
                        <path d={mkPath(ga4Trend.map(d => d.sessions), maxS)} fill="none" stroke="rgba(96,165,250,0.4)" strokeWidth="1.5" />
                        <path d={mkPath(ga4Trend.map(d => d.users), maxU)} fill="none" stroke="#2dd4bf" strokeWidth="2" />
                        <path d={`${mkPath(ga4Trend.map(d => d.users), maxU)} L${(ga4Trend.length - 1) * xStep},95 L0,95 Z`} fill="url(#overviewGa4)" opacity="0.12" />
                        <defs><linearGradient id="overviewGa4" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#2dd4bf" /><stop offset="100%" stopColor="transparent" /></linearGradient></defs>
                      </>);
                    })()}
                  </svg>
                  <div className="flex items-center gap-4 mt-2">
                    <span className="flex items-center gap-1.5 text-[10px] text-zinc-500"><span className="w-3 h-0.5 rounded bg-teal-400 inline-block" /> Users</span>
                    <span className="flex items-center gap-1.5 text-[10px] text-zinc-500"><span className="w-3 h-0.5 rounded bg-blue-400/40 inline-block" /> Sessions</span>
                  </div>
                </div>
              )}
              {!ga4Trend.length && trend.length > 2 && (
                <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-xs font-medium text-zinc-400">Search Performance</span>
                    {overview && <span className="text-[10px] text-zinc-600">{overview.dateRange.start} — {overview.dateRange.end}</span>}
                  </div>
                  <div className="space-y-3">
                    <div><div className="text-[10px] text-blue-400 mb-1">Clicks</div><TrendChart data={trend} metric="clicks" color="#60a5fa" /></div>
                    <div><div className="text-[10px] text-teal-400 mb-1">Impressions</div><TrendChart data={trend} metric="impressions" color="#2dd4bf" /></div>
                  </div>
                </div>
              )}
              {/* Pinned key events on overview */}
              {sortedConversions.filter(c => isEventPinned(c.eventName)).length > 0 && (
                <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2"><Zap className="w-4 h-4 text-teal-400" /><span className="text-xs font-medium text-zinc-300">Key Events</span></div>
                    <button onClick={() => setTab('analytics')} className="text-[10px] text-teal-400 hover:text-teal-300">View all →</button>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {sortedConversions.filter(c => isEventPinned(c.eventName)).slice(0, 6).map((c, i) => (
                      <div key={i} className="bg-zinc-800/30 rounded-lg p-3">
                        <div className="text-[10px] text-zinc-400 truncate mb-1">{eventDisplayName(c.eventName)}</div>
                        <div className="text-lg font-bold text-zinc-200">{c.conversions.toLocaleString()}</div>
                        {c.rate > 0 && <div className="text-[10px] text-emerald-400">{c.rate}% rate</div>}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {!overview && !audit && !ga4Overview && (
                <div className="bg-gradient-to-br from-teal-500/10 via-zinc-900 to-emerald-500/10 rounded-xl border border-zinc-800 p-8 text-center">
                  <div className="w-12 h-12 rounded-2xl bg-teal-500/10 flex items-center justify-center mx-auto mb-4"><BarChart3 className="w-6 h-6 text-teal-400" /></div>
                  <h2 className="text-lg font-semibold text-zinc-200 mb-2">{ws.name}</h2>
                  <p className="text-sm text-zinc-400">Your dashboard is being configured. Data will appear here once set up by your web team.</p>
                </div>
              )}
            </div>

            {/* Right: highlights (2/5 width) */}
            <div className="lg:col-span-2 space-y-4">
              {insights && insights.lowHanging.length > 0 && (
                <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Target className="w-4 h-4 text-amber-400" />
                    <span className="text-xs font-medium text-zinc-300">Top Opportunities</span>
                  </div>
                  <div className="space-y-1.5">
                    {insights.lowHanging.slice(0, 3).map((q, i) => (
                      <div key={i} className="flex items-center justify-between text-[11px] py-1.5 px-2.5 rounded-lg bg-zinc-800/30">
                        <span className="text-zinc-300 truncate mr-2">{q.query}</span>
                        <span className="text-amber-400 font-medium flex-shrink-0">#{q.position}</span>
                      </div>
                    ))}
                  </div>
                  {insights.lowHanging.length > 3 && <button onClick={() => setTab('search')} className="text-[10px] text-teal-400 hover:text-teal-300 mt-2">+{insights.lowHanging.length - 3} more →</button>}
                </div>
              )}
              {auditDetail && auditDetail.audit.errors > 0 && (
                <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <AlertTriangle className="w-4 h-4 text-red-400" />
                    <span className="text-xs font-medium text-zinc-300">Critical Issues</span>
                    <span className="text-[10px] text-red-400/70 ml-auto">{auditDetail.audit.errors}</span>
                  </div>
                  <div className="space-y-1.5">
                    {auditDetail.audit.pages.flatMap(p => p.issues.filter(i => i.severity === 'error').map(i => ({ ...i, pageName: p.page }))).slice(0, 3).map((issue, i) => (
                      <div key={i} className="text-[11px] py-1.5 px-2.5 rounded-lg bg-red-500/5 border border-red-500/10">
                        <div className="text-red-400 font-medium">{issue.message}</div>
                        <div className="text-zinc-600 mt-0.5 truncate">{issue.pageName}</div>
                      </div>
                    ))}
                  </div>
                  <button onClick={() => setTab('health')} className="text-[10px] text-teal-400 hover:text-teal-300 mt-2">View full audit →</button>
                </div>
              )}
              {audit && !(auditDetail?.audit.errors) && (
                <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
                  <div className="flex items-center gap-2 mb-2"><CheckCircle2 className="w-4 h-4 text-green-400" /><span className="text-xs font-medium text-zinc-300">Site Health</span></div>
                  <div className="flex items-center gap-3">
                    <div className={`text-2xl font-bold ${audit.siteScore >= 80 ? 'text-green-400' : audit.siteScore >= 60 ? 'text-amber-400' : 'text-red-400'}`}>{audit.siteScore}</div>
                    <div><div className="text-[10px] text-zinc-400">{audit.totalPages} pages</div><div className="text-[10px] text-zinc-600">{new Date(audit.createdAt).toLocaleDateString()}</div></div>
                  </div>
                  <button onClick={() => setTab('health')} className="text-[10px] text-teal-400 hover:text-teal-300 mt-1.5">Details →</button>
                </div>
              )}
              {insights && insights.topPerformers.length > 0 && (
                <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
                  <div className="flex items-center gap-2 mb-2"><Zap className="w-4 h-4 text-green-400" /><span className="text-xs font-medium text-zinc-300">Top Performers</span></div>
                  <div className="space-y-1.5">
                    {insights.topPerformers.slice(0, 3).map((q, i) => (
                      <div key={i} className="flex items-center justify-between text-[11px] py-1.5 px-2.5 rounded-lg bg-zinc-800/30">
                        <span className="text-zinc-300 truncate mr-2">{q.query}</span>
                        <span className="text-green-400 font-medium flex-shrink-0">#{q.position}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </>)}

        {/* ════════════ SEARCH TAB ════════════ */}
        {tab === 'search' && (<>
          {overview ? (<>
            {/* Compact metrics bar */}
            <div className="bg-zinc-900 rounded-xl border border-zinc-800 px-5 py-3 flex items-center justify-between flex-wrap gap-3">
              {[
                { label: 'Clicks', value: overview.totalClicks.toLocaleString(), color: 'text-blue-400' },
                { label: 'Impressions', value: overview.totalImpressions.toLocaleString(), color: 'text-teal-400' },
                { label: 'CTR', value: `${overview.avgCtr}%`, color: 'text-emerald-400' },
                { label: 'Avg Position', value: String(overview.avgPosition), color: 'text-amber-400' },
              ].map(m => (
                <div key={m.label} className="flex items-center gap-2">
                  <span className="text-[10px] text-zinc-500 uppercase tracking-wider">{m.label}</span>
                  <span className={`text-sm font-bold ${m.color}`}>{m.value}</span>
                </div>
              ))}
            </div>

            {trend.length > 2 && (
              <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs font-medium text-zinc-400">Performance Trend</span>
                  <span className="text-[10px] text-zinc-600">{overview.dateRange.start} — {overview.dateRange.end}</span>
                </div>
                <DualTrendChart data={trend} />
              </div>
            )}

            {insights && (
              <div className="space-y-3">
                <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
                  <div className="text-xs font-medium text-zinc-300 mb-3">Search Health Summary</div>
                  <div className="grid grid-cols-4 gap-3">
                    <div className="text-center"><div className={`text-lg font-bold ${insights.page1 > 5 ? 'text-green-400' : 'text-amber-400'}`}>{insights.page1}</div><div className="text-[10px] text-zinc-500">Page 1 Rankings</div></div>
                    <div className="text-center"><div className={`text-lg font-bold ${insights.top3 > 2 ? 'text-green-400' : 'text-amber-400'}`}>{insights.top3}</div><div className="text-[10px] text-zinc-500">Top 3 Rankings</div></div>
                    <div className="text-center"><div className={`text-lg font-bold ${overview.avgCtr > 3 ? 'text-green-400' : overview.avgCtr > 1.5 ? 'text-amber-400' : 'text-red-400'}`}>{overview.avgCtr}%</div><div className="text-[10px] text-zinc-500">Avg CTR</div></div>
                    <div className="text-center"><div className={`text-lg font-bold ${insights.lowHanging.length > 0 ? 'text-amber-400' : 'text-green-400'}`}>{insights.lowHanging.length}</div><div className="text-[10px] text-zinc-500">Opportunities</div></div>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  {insights.lowHanging.length > 0 && <InsightCard icon={Target} color="amber" title="Low-Hanging Fruit" count={insights.lowHanging.length} desc="Ranking 5-20 with impressions — push to page 1" items={insights.lowHanging.slice(0, 8).map(q => ({ label: q.query, value: `#${q.position}`, sub: `${q.impressions} imp` }))} />}
                  {insights.topPerformers.length > 0 && <InsightCard icon={Shield} color="green" title="Top Performers" count={insights.topPerformers.length} desc="Top 3 with real clicks — protect these" items={insights.topPerformers.slice(0, 8).map(q => ({ label: q.query, value: `#${q.position}`, sub: `${q.clicks} clicks` }))} />}
                  {insights.ctrOpps.length > 0 && <InsightCard icon={TrendingDown} color="red" title="CTR Opportunities" count={insights.ctrOpps.length} desc="Page 1 but CTR under 3%" items={insights.ctrOpps.slice(0, 8).map(q => ({ label: q.query, value: `${q.ctr}% CTR`, sub: `#${q.position}` }))} />}
                  {insights.highImpLowClick.length > 0 && <InsightCard icon={AlertTriangle} color="orange" title="Visibility Without Clicks" count={insights.highImpLowClick.length} desc="100+ impressions, under 5 clicks" items={insights.highImpLowClick.slice(0, 8).map(q => ({ label: q.query, value: `${q.clicks} clicks`, sub: `${q.impressions} imp` }))} />}
                </div>
              </div>
            )}

            <div className="bg-zinc-900 rounded-xl border border-zinc-800 overflow-hidden">
              <table className="w-full text-xs">
                <thead><tr className="border-b border-zinc-800">
                  <th className="text-left py-3 px-4 text-zinc-500 font-medium">Query</th>
                  {(['clicks', 'impressions', 'ctr', 'position'] as SortKey[]).map(key => (
                    <th key={key} className="text-right py-3 px-3 text-zinc-500 font-medium">
                      <button onClick={() => handleSort(key)} className="flex items-center gap-1 ml-auto hover:text-zinc-300">
                        {key === 'ctr' ? 'CTR' : key.charAt(0).toUpperCase() + key.slice(1)}
                        {sortKey === key && <ArrowUpDown className="w-3 h-3" />}
                      </button>
                    </th>
                  ))}
                </tr></thead>
                <tbody>{sortedQueries().map((q, i) => (
                  <tr key={i} className="border-b border-zinc-800/50 hover:bg-zinc-800/30">
                    <td className="py-2.5 px-4 text-zinc-300 font-medium">{q.query}</td>
                    <td className="py-2.5 px-3 text-right text-blue-400 font-semibold">{q.clicks}</td>
                    <td className="py-2.5 px-3 text-right text-zinc-400">{q.impressions.toLocaleString()}</td>
                    <td className="py-2.5 px-3 text-right text-emerald-400">{q.ctr}%</td>
                    <td className="py-2.5 px-3 text-right"><span className={q.position <= 10 ? 'text-green-400' : q.position <= 20 ? 'text-amber-400' : 'text-red-400'}>{q.position}</span></td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          </>) : (
            <div className="text-center py-16">
              <Search className="w-8 h-8 text-zinc-600 mx-auto mb-2" />
              <p className="text-sm text-zinc-500">Search data is not yet available</p>
              <p className="text-xs text-zinc-600 mt-1">Search Console will be configured by your web team.</p>
            </div>
          )}
        </>)}

        {/* ════════════ SITE HEALTH TAB ════════════ */}
        {tab === 'health' && (<>
          {auditDetail ? (
            <div className="space-y-5">
              <div className="grid grid-cols-3 gap-5">
                {/* Score ring */}
                <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-6 flex flex-col items-center justify-center">
                  <ScoreRing score={auditDetail.audit.siteScore} size={140} />
                  <div className="text-xs text-zinc-500 mt-3">{auditDetail.audit.totalPages} pages scanned</div>
                  <div className="text-[10px] text-zinc-600">{new Date(auditDetail.createdAt).toLocaleDateString()}</div>
                  {auditDetail.previousScore != null && (
                    <div className={`text-xs mt-1 ${auditDetail.audit.siteScore > auditDetail.previousScore ? 'text-green-400' : auditDetail.audit.siteScore < auditDetail.previousScore ? 'text-red-400' : 'text-zinc-500'}`}>
                      {auditDetail.audit.siteScore > auditDetail.previousScore ? '↑' : '↓'} {Math.abs(auditDetail.audit.siteScore - auditDetail.previousScore)} from previous
                    </div>
                  )}
                </div>
                {/* Severity buttons */}
                <div className="space-y-3">
                  {([
                    { sev: 'error' as const, count: auditDetail.audit.errors, label: 'Errors', Icon: AlertTriangle },
                    { sev: 'warning' as const, count: auditDetail.audit.warnings, label: 'Warnings', Icon: Info },
                    { sev: 'info' as const, count: auditDetail.audit.infos, label: 'Info', Icon: CheckCircle2 },
                  ]).map(s => {
                    const sc = SEV[s.sev];
                    return (
                      <button key={s.sev} onClick={() => setSeverityFilter(severityFilter === s.sev ? 'all' : s.sev)}
                        className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl border transition-colors ${severityFilter === s.sev ? `${sc.bg} ${sc.border}` : 'bg-zinc-900 border-zinc-800 hover:border-zinc-700'}`}>
                        <s.Icon className={`w-4 h-4 ${sc.text}`} />
                        <span className="text-sm font-medium text-zinc-300">{s.label}</span>
                        <span className={`text-xl font-bold ml-auto ${sc.text}`}>{s.count}</span>
                      </button>
                    );
                  })}
                </div>
                {/* Score history + category breakdown */}
                <div className="space-y-3">
                  {auditDetail.scoreHistory.length >= 2 && (
                    <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
                      <div className="text-xs font-medium text-zinc-400 mb-2">Score History</div>
                      <ScoreHistoryChart history={auditDetail.scoreHistory} />
                    </div>
                  )}
                  <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
                    <div className="text-xs font-medium text-zinc-400 mb-3">Issues by Category</div>
                    <div className="space-y-2">
                      {Object.entries(categoryStats).map(([cat, counts]) => {
                        const info = CAT_LABELS[cat] || { label: cat, color: '#71717a' };
                        return (
                          <div key={cat} className="flex items-center gap-2">
                            <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: info.color }} />
                            <span className="text-[11px] text-zinc-400 flex-1">{info.label}</span>
                            <div className="flex items-center gap-1.5 text-[10px]">
                              {counts.errors > 0 && <span className="text-red-400">{counts.errors}E</span>}
                              {counts.warnings > 0 && <span className="text-amber-400">{counts.warnings}W</span>}
                              {counts.infos > 0 && <span className="text-blue-400">{counts.infos}I</span>}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>

              {/* Site-wide issues */}
              {auditDetail.audit.siteWideIssues.length > 0 && (
                <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
                  <div className="text-xs font-medium text-zinc-400 mb-3">Site-Wide Issues</div>
                  <div className="space-y-2">
                    {auditDetail.audit.siteWideIssues.map((issue, i) => {
                      const sc = SEV[issue.severity] || SEV.info;
                      return (
                        <div key={i} className={`px-3 py-2.5 rounded-lg ${sc.bg} border ${sc.border}`}>
                          <div className={`text-xs font-medium ${sc.text}`}>{issue.message}</div>
                          <div className="text-[10px] text-zinc-500 mt-0.5">{issue.recommendation}</div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Page-by-page breakdown */}
              <div className="bg-zinc-900 rounded-xl border border-zinc-800 overflow-hidden">
                <div className="px-4 py-3 border-b border-zinc-800 flex items-center gap-3">
                  <span className="text-xs font-medium text-zinc-300">Page Breakdown</span>
                  <div className="flex-1" />
                  <div className="flex items-center gap-1 bg-zinc-800 rounded-lg p-0.5">
                    {(['all', 'error', 'warning', 'info'] as const).map(s => (
                      <button key={s} onClick={() => setSeverityFilter(s)}
                        className={`px-2.5 py-1 rounded-md text-[10px] font-medium transition-colors ${
                          severityFilter === s ? (s === 'all' ? 'bg-zinc-700 text-zinc-200' : `${SEV[s].bg} ${SEV[s].text}`) : 'text-zinc-500 hover:text-zinc-300'
                        }`}>{s === 'all' ? 'All' : s.charAt(0).toUpperCase() + s.slice(1)}</button>
                    ))}
                  </div>
                  <input type="text" value={auditSearch} onChange={e => setAuditSearch(e.target.value)} placeholder="Search pages..."
                    className="bg-zinc-800 border border-zinc-700 rounded-lg px-2.5 py-1.5 text-[11px] text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-zinc-600 w-40" />
                </div>
                <div className="divide-y divide-zinc-800/50 max-h-[600px] overflow-y-auto">
                  {filteredPages.map(page => {
                    const isExp = expandedPages.has(page.pageId);
                    const pageIssues = severityFilter === 'all' ? page.issues : page.issues.filter(i => i.severity === severityFilter);
                    const errs = page.issues.filter(i => i.severity === 'error').length;
                    const warns = page.issues.filter(i => i.severity === 'warning').length;
                    return (
                      <div key={page.pageId}>
                        <button onClick={() => togglePage(page.pageId)} className="w-full flex items-center gap-3 px-4 py-3 hover:bg-zinc-800/30 transition-colors text-left">
                          <ChevronDown className={`w-3.5 h-3.5 text-zinc-600 transition-transform ${isExp ? '' : '-rotate-90'}`} />
                          <div className="flex-1 min-w-0">
                            <div className="text-xs font-medium text-zinc-300 truncate">{page.page}</div>
                            <div className="text-[10px] text-zinc-600 truncate">{toLiveUrl(page.url, ws.liveDomain)}</div>
                          </div>
                          <div className="flex items-center gap-2 flex-shrink-0">
                            {errs > 0 && <span className="text-[10px] text-red-400 bg-red-500/10 px-1.5 py-0.5 rounded">{errs} err</span>}
                            {warns > 0 && <span className="text-[10px] text-amber-400 bg-amber-500/10 px-1.5 py-0.5 rounded">{warns} warn</span>}
                            <div className={`text-xs font-bold ${page.score >= 80 ? 'text-green-400' : page.score >= 60 ? 'text-amber-400' : 'text-red-400'}`}>{page.score}</div>
                          </div>
                        </button>
                        {isExp && pageIssues.length > 0 && (
                          <div className="px-4 pb-3 pl-11 space-y-1.5">
                            {pageIssues.map((issue, i) => {
                              const sc = SEV[issue.severity] || SEV.info;
                              return (
                                <div key={i} className={`px-3 py-2 rounded-lg ${sc.bg} border ${sc.border}`}>
                                  <div className="flex items-start gap-2">
                                    <span className={`text-[10px] font-medium uppercase ${sc.text} flex-shrink-0 mt-0.5`}>{issue.severity}</span>
                                    <div>
                                      <div className="text-[11px] text-zinc-300">{issue.message}</div>
                                      <div className="text-[10px] text-zinc-500 mt-0.5">{issue.recommendation}</div>
                                      {issue.value && <div className="text-[10px] text-zinc-600 mt-0.5 font-mono">Current: {issue.value}</div>}
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                  {filteredPages.length === 0 && <div className="px-4 py-8 text-center text-xs text-zinc-600">No pages match your filters</div>}
                </div>
              </div>
            </div>
          ) : audit ? (
            <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-6">
              <div className="flex items-center gap-4">
                <ScoreRing score={audit.siteScore} size={100} />
                <div>
                  <div className="text-sm font-medium text-zinc-200">Site Health Score</div>
                  <div className="text-xs text-zinc-500">{audit.totalPages} pages • {new Date(audit.createdAt).toLocaleDateString()}</div>
                  <div className="flex gap-3 mt-2"><span className="text-xs text-red-400">{audit.errors} errors</span><span className="text-xs text-amber-400">{audit.warnings} warnings</span></div>
                </div>
              </div>
            </div>
          ) : (
            <div className="text-center py-16">
              <Shield className="w-8 h-8 text-zinc-600 mx-auto mb-2" />
              <p className="text-sm text-zinc-500">No site audit available yet</p>
              <p className="text-xs text-zinc-600 mt-1">Ask your team to run a site audit for detailed health metrics.</p>
            </div>
          )}
        </>)}

        {/* ════════════ ANALYTICS TAB ════════════ */}
        {tab === 'analytics' && (<>
          {!ga4Overview ? (
            <div className="text-center py-16">
              <div className="w-16 h-16 rounded-2xl bg-zinc-900 border border-zinc-800 flex items-center justify-center mx-auto mb-4"><LineChart className="w-8 h-8 text-zinc-700" /></div>
              <h3 className="text-sm font-medium text-zinc-400">Analytics Not Configured</h3>
              <p className="text-xs text-zinc-600 mt-1 max-w-sm mx-auto">Google Analytics 4 has not been linked to this workspace yet. Contact your web team to enable it.</p>
            </div>
          ) : (<>
            {/* GA4 Overview Cards */}
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
              {[
                { label: 'Users', value: ga4Overview.totalUsers.toLocaleString(), color: 'text-teal-400' },
                { label: 'Sessions', value: ga4Overview.totalSessions.toLocaleString(), color: 'text-blue-400' },
                { label: 'Page Views', value: ga4Overview.totalPageviews.toLocaleString(), color: 'text-teal-400' },
                { label: 'Avg Duration', value: `${Math.floor(ga4Overview.avgSessionDuration / 60)}m ${Math.floor(ga4Overview.avgSessionDuration % 60)}s`, color: 'text-amber-400' },
                { label: 'Bounce Rate', value: `${ga4Overview.bounceRate}%`, color: ga4Overview.bounceRate > 60 ? 'text-red-400' : 'text-emerald-400' },
                { label: 'New Users', value: `${ga4Overview.newUserPercentage}%`, color: 'text-teal-400' },
              ].map(c => (
                <div key={c.label} className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
                  <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">{c.label}</div>
                  <div className={`text-xl font-bold ${c.color}`}>{c.value}</div>
                </div>
              ))}
            </div>

            {/* Traffic Trend Chart */}
            {ga4Trend.length > 0 && (
              <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-5 mb-6">
                <h3 className="text-sm font-semibold text-zinc-300 mb-4">Traffic Trend</h3>
                <svg viewBox={`0 0 800 200`} className="w-full h-48">
                  {(() => {
                    const maxV = Math.max(...ga4Trend.map(d => d.users), 1);
                    const maxS = Math.max(...ga4Trend.map(d => d.sessions), 1);
                    const maxP = Math.max(...ga4Trend.map(d => d.pageviews), 1);
                    const xStep = 800 / Math.max(ga4Trend.length - 1, 1);
                    const mkPath = (vals: number[], max: number) => vals.map((v, i) => `${i === 0 ? 'M' : 'L'}${i * xStep},${190 - (v / max) * 170}`).join(' ');
                    return (<>
                      <path d={mkPath(ga4Trend.map(d => d.pageviews), maxP)} fill="none" stroke="rgba(45,212,191,0.3)" strokeWidth="1.5" />
                      <path d={mkPath(ga4Trend.map(d => d.sessions), maxS)} fill="none" stroke="rgba(96,165,250,0.5)" strokeWidth="1.5" />
                      <path d={mkPath(ga4Trend.map(d => d.users), maxV)} fill="none" stroke="rgba(45,212,191,0.9)" strokeWidth="2" />
                      <path d={`${mkPath(ga4Trend.map(d => d.users), maxV)} L${(ga4Trend.length - 1) * xStep},190 L0,190 Z`} fill="url(#ga4grad)" opacity="0.15" />
                      <defs><linearGradient id="ga4grad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#2dd4bf" /><stop offset="100%" stopColor="transparent" /></linearGradient></defs>
                    </>);
                  })()}
                </svg>
                <div className="flex items-center justify-center gap-6 mt-2">
                  <span className="flex items-center gap-1.5 text-[10px] text-zinc-500"><span className="w-3 h-0.5 rounded bg-teal-400 inline-block" /> Users</span>
                  <span className="flex items-center gap-1.5 text-[10px] text-zinc-500"><span className="w-3 h-0.5 rounded bg-blue-400 inline-block" /> Sessions</span>
                  <span className="flex items-center gap-1.5 text-[10px] text-zinc-500"><span className="w-3 h-0.5 rounded bg-teal-400/40 inline-block" /> Pageviews</span>
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
              {/* Top Pages */}
              <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-5">
                <h3 className="text-sm font-semibold text-zinc-300 mb-3">Top Pages</h3>
                <div className="space-y-1 max-h-[350px] overflow-y-auto">
                  {ga4Pages.slice(0, 15).map((p, i) => (
                    <div key={i} className="flex items-center gap-2 py-1.5 px-2 rounded-lg hover:bg-zinc-800/50">
                      <span className="text-[10px] text-zinc-600 w-5 text-right">{i + 1}</span>
                      <span className="text-xs text-zinc-300 flex-1 truncate font-mono">{p.path}</span>
                      <span className="text-xs text-teal-400 font-medium tabular-nums">{p.pageviews.toLocaleString()}</span>
                      <span className="text-[10px] text-zinc-500 w-14 text-right">{p.users.toLocaleString()} u</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Traffic Sources */}
              <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-5">
                <h3 className="text-sm font-semibold text-zinc-300 mb-3">Traffic Sources</h3>
                <div className="space-y-2">
                  {ga4Sources.slice(0, 10).map((s, i) => {
                    const totalSessions = ga4Sources.reduce((sum, x) => sum + x.sessions, 0);
                    const pct = totalSessions > 0 ? (s.sessions / totalSessions) * 100 : 0;
                    return (
                      <div key={i} className="relative">
                        <div className="flex items-center gap-2 py-1.5 px-2 rounded-lg relative z-10">
                          <span className="text-xs text-zinc-300 flex-1 truncate">{s.source}{s.medium !== '(none)' ? ` / ${s.medium}` : ''}</span>
                          <span className="text-xs text-blue-400 font-medium tabular-nums">{s.sessions.toLocaleString()}</span>
                          <span className="text-[10px] text-zinc-500 w-12 text-right">{pct.toFixed(1)}%</span>
                        </div>
                        <div className="absolute inset-0 rounded-lg bg-blue-500/5" style={{ width: `${pct}%` }} />
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Device Breakdown */}
              {ga4Devices.length > 0 && (
                <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-5">
                  <h3 className="text-sm font-semibold text-zinc-300 mb-4">Devices</h3>
                  <div className="flex items-center gap-6">
                    {/* Donut-like bars */}
                    <div className="flex-1 space-y-3">
                      {ga4Devices.map((d, i) => {
                        const colors = ['bg-teal-500', 'bg-blue-500', 'bg-emerald-500', 'bg-amber-500'];
                        const textColors = ['text-teal-400', 'text-blue-400', 'text-teal-400', 'text-amber-400'];
                        return (
                          <div key={i}>
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-xs text-zinc-300 capitalize">{d.device}</span>
                              <span className={`text-xs font-medium ${textColors[i % textColors.length]}`}>{d.percentage}%</span>
                            </div>
                            <div className="h-2 rounded-full bg-zinc-800 overflow-hidden">
                              <div className={`h-full rounded-full ${colors[i % colors.length]}`} style={{ width: `${d.percentage}%` }} />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}

              {/* Top Countries */}
              {ga4Countries.length > 0 && (
                <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-5">
                  <h3 className="text-sm font-semibold text-zinc-300 mb-3">Top Countries</h3>
                  <div className="space-y-1">
                    {ga4Countries.slice(0, 10).map((c, i) => {
                      const maxUsers = ga4Countries[0]?.users || 1;
                      return (
                        <div key={i} className="flex items-center gap-2 py-1.5 px-2 rounded-lg hover:bg-zinc-800/50">
                          <span className="text-[10px] text-zinc-600 w-5 text-right">{i + 1}</span>
                          <span className="text-xs text-zinc-300 flex-1">{c.country}</span>
                          <div className="w-20 h-1.5 rounded-full bg-zinc-800 overflow-hidden">
                            <div className="h-full rounded-full bg-emerald-500" style={{ width: `${(c.users / maxUsers) * 100}%` }} />
                          </div>
                          <span className="text-xs text-emerald-400 font-medium tabular-nums w-12 text-right">{c.users.toLocaleString()}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* ── Event Modules (Grouped) ── */}
            {(ga4Conversions.length > 0 || ga4Events.length > 0) && (() => {
              const activeConversions = eventsPageData || sortedConversions;
              const groups = (ws.eventGroups || []).slice().sort((a, b) => a.order - b.order);
              const getGroupEvents = (groupId: string) => activeConversions.filter(c => {
                const cfg = ws.eventConfig?.find(ec => ec.eventName === c.eventName);
                return cfg?.group === groupId;
              });
              const ungroupedEvents = activeConversions.filter(c => {
                const cfg = ws.eventConfig?.find(ec => ec.eventName === c.eventName);
                return !cfg?.group || !groups.find(g => g.id === cfg.group);
              });
              const renderEventCard = (c: GA4ConversionSummary, i: number) => {
                const isSelected = ga4SelectedEvent === c.eventName;
                const pinned = isEventPinned(c.eventName);
                return (
                  <button key={i} onClick={() => loadEventTrend(c.eventName)}
                    className={`text-left rounded-xl border p-4 transition-colors ${isSelected ? 'bg-teal-500/10 border-teal-500/30' : pinned ? 'bg-teal-500/5 border-teal-500/15 hover:border-teal-500/30' : 'bg-zinc-800/30 border-zinc-800 hover:border-zinc-700'}`}>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[10px] text-zinc-400 truncate max-w-[140px]">{eventDisplayName(c.eventName)}</span>
                      <div className="flex items-center gap-1.5">
                        {pinned && <span className="w-1.5 h-1.5 rounded-full bg-teal-400" title="Pinned" />}
                        {c.rate > 0 && <span className="text-[10px] font-medium text-emerald-400">{c.rate}%</span>}
                      </div>
                    </div>
                    <div className="text-xl font-bold text-zinc-200">{c.conversions.toLocaleString()}</div>
                    <div className="text-[10px] text-zinc-600 mt-0.5">{c.users.toLocaleString()} users</div>
                  </button>
                );
              };
              return (
                <div className="space-y-6 mt-6">
                  {/* Page filter for events */}
                  <div className="flex items-center gap-3">
                    <span className="text-[10px] text-zinc-500 uppercase tracking-wider">Filter by page</span>
                    <select
                      value={eventsPageFilter}
                      onChange={e => { setEventsPageFilter(e.target.value); fetchEventsForPage(e.target.value); }}
                      className="flex-1 max-w-xs px-2.5 py-1.5 bg-zinc-800 border border-zinc-700 rounded-lg text-xs text-zinc-200 focus:outline-none focus:border-teal-500"
                    >
                      <option value="">All Pages</option>
                      {ga4Pages.map((p, i) => (
                        <option key={i} value={p.path}>{p.path}</option>
                      ))}
                    </select>
                    {eventsPageLoading && <Loader2 className="w-3.5 h-3.5 animate-spin text-teal-400" />}
                    {eventsPageFilter && <button onClick={() => { setEventsPageFilter(''); setEventsPageData(null); }} className="text-[10px] text-zinc-500 hover:text-zinc-300">Clear</button>}
                  </div>

                  {/* Render each group as a module */}
                  {groups.map(group => {
                    const groupEvents = getGroupEvents(group.id);
                    if (groupEvents.length === 0) return null;
                    return (
                      <div key={group.id} className="bg-zinc-900 rounded-xl border border-zinc-800 p-5">
                        <div className="flex items-center gap-2 mb-4">
                          <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: group.color }} />
                          <h3 className="text-sm font-semibold text-zinc-300">{group.name}</h3>
                          <span className="text-[10px] text-zinc-600 ml-auto">{groupEvents.length} events</span>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                          {groupEvents.map(renderEventCard)}
                        </div>
                      </div>
                    );
                  })}
                  {/* Ungrouped events */}
                  {ungroupedEvents.length > 0 && (
                    <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-5">
                      <h3 className="text-sm font-semibold text-zinc-300 mb-1">{groups.length > 0 ? 'Other Events' : 'Key Events'}</h3>
                      <p className="text-[10px] text-zinc-600 mb-4">{groups.length > 0 ? 'Events not assigned to a group' : 'Custom and conversion events tracked on your site'}</p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                        {ungroupedEvents.slice(0, 12).map(renderEventCard)}
                      </div>
                    </div>
                  )}

                  {/* No events for this page */}
                  {eventsPageFilter && activeConversions.length === 0 && !eventsPageLoading && (
                    <div className="text-center py-8 text-xs text-zinc-600">No events found for {eventsPageFilter}</div>
                  )}

                  {/* Event Trend (shown when an event is selected) */}
                  {ga4SelectedEvent && ga4EventTrend.length > 2 && (
                    <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-5">
                      <div className="flex items-center justify-between mb-3">
                        <div>
                          <h3 className="text-sm font-semibold text-zinc-300">{eventDisplayName(ga4SelectedEvent)}</h3>
                          <p className="text-[10px] text-zinc-600">Daily event count over the selected period</p>
                        </div>
                        <button onClick={() => { setGa4SelectedEvent(null); setGa4EventTrend([]); }} className="text-[10px] text-zinc-500 hover:text-zinc-300">Clear</button>
                      </div>
                      <svg viewBox="0 0 800 120" className="w-full h-28" preserveAspectRatio="none">
                        {(() => {
                          const maxV = Math.max(...ga4EventTrend.map(d => d.eventCount), 1);
                          const xStep = 800 / Math.max(ga4EventTrend.length - 1, 1);
                          const points = ga4EventTrend.map((d, i) => `${i * xStep},${110 - (d.eventCount / maxV) * 100}`);
                          const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p}`).join(' ');
                          return (<>
                            <path d={linePath} fill="none" stroke="#2dd4bf" strokeWidth="2" />
                            <path d={`${linePath} L${(ga4EventTrend.length - 1) * xStep},110 L0,110 Z`} fill="url(#evtGrad)" opacity="0.15" />
                            {ga4EventTrend.map((d, i) => (
                              <circle key={i} cx={i * xStep} cy={110 - (d.eventCount / maxV) * 100} r="2.5" fill="#2dd4bf" opacity="0.6" />
                            ))}
                            <defs><linearGradient id="evtGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#2dd4bf" /><stop offset="100%" stopColor="transparent" /></linearGradient></defs>
                          </>);
                        })()}
                      </svg>
                      <div className="flex items-center justify-between mt-2 text-[10px] text-zinc-600">
                        <span>{ga4EventTrend[0]?.date}</span>
                        <span>Total: {ga4EventTrend.reduce((s, d) => s + d.eventCount, 0).toLocaleString()}</span>
                        <span>{ga4EventTrend[ga4EventTrend.length - 1]?.date}</span>
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}

            {/* ── Collapsible Event Explorer ── */}
            <div className="bg-zinc-900 rounded-xl border border-zinc-800 overflow-hidden mt-6">
              <button onClick={() => setShowExplorer(!showExplorer)} className="w-full flex items-center justify-between px-5 py-3 hover:bg-zinc-800/30 transition-colors">
                <div className="flex items-center gap-2">
                  <Filter className="w-4 h-4 text-teal-400" />
                  <span className="text-sm font-medium text-zinc-400">Event Explorer</span>
                </div>
                {showExplorer ? <ChevronUp className="w-4 h-4 text-zinc-500" /> : <ChevronDown className="w-4 h-4 text-zinc-500" />}
              </button>
              {showExplorer && (
                <div className="px-5 pb-5">
                  <p className="text-[10px] text-zinc-600 mb-4">Break down events by page, or see which events fire on a specific page.</p>
                  <div className="flex flex-wrap items-end gap-3 mb-4">
                    <div className="flex-1 min-w-[180px]">
                      <label className="text-[10px] text-zinc-500 mb-1 block">Event Name</label>
                      <select value={explorerEvent} onChange={e => setExplorerEvent(e.target.value)}
                        className="w-full px-2.5 py-1.5 bg-zinc-800 border border-zinc-700 rounded-lg text-xs text-zinc-200 focus:outline-none focus:border-teal-500">
                        <option value="">All events</option>
                        {ga4Events.map(ev => (
                          <option key={ev.eventName} value={ev.eventName}>{eventDisplayName(ev.eventName)}</option>
                        ))}
                      </select>
                    </div>
                    <div className="flex-1 min-w-[180px]">
                      <label className="text-[10px] text-zinc-500 mb-1 block">Page Path (contains)</label>
                      <input value={explorerPage} onChange={e => setExplorerPage(e.target.value)}
                        placeholder="/contact, /blog, etc."
                        onKeyDown={e => e.key === 'Enter' && runExplorer(explorerEvent || undefined, explorerPage || undefined)}
                        className="w-full px-2.5 py-1.5 bg-zinc-800 border border-zinc-700 rounded-lg text-xs text-zinc-200 focus:outline-none focus:border-teal-500 placeholder:text-zinc-600" />
                    </div>
                    <button onClick={() => runExplorer(explorerEvent || undefined, explorerPage || undefined)}
                      className="px-4 py-1.5 rounded-lg bg-teal-600 hover:bg-teal-500 text-white text-xs font-medium transition-colors flex items-center gap-1.5">
                      {explorerLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Search className="w-3 h-3" />} Explore
                    </button>
                    {explorerData.length > 0 && (
                      <button onClick={() => { setExplorerData([]); setExplorerEvent(''); setExplorerPage(''); }}
                        className="px-3 py-1.5 rounded-lg text-xs text-zinc-500 hover:text-zinc-300 transition-colors">Clear</button>
                    )}
                  </div>
                  {explorerData.length > 0 && (
                    <div className="overflow-x-auto">
                      <table className="w-full text-left">
                        <thead>
                          <tr className="border-b border-zinc-800">
                            <th className="text-[10px] text-zinc-500 font-medium uppercase tracking-wider py-2 pr-3">Event</th>
                            <th className="text-[10px] text-zinc-500 font-medium uppercase tracking-wider py-2 pr-3">Page</th>
                            <th className="text-[10px] text-zinc-500 font-medium uppercase tracking-wider py-2 pr-3 text-right">Count</th>
                            <th className="text-[10px] text-zinc-500 font-medium uppercase tracking-wider py-2 text-right">Users</th>
                          </tr>
                        </thead>
                        <tbody>
                          {explorerData.map((row, i) => {
                            const maxCount = explorerData[0]?.eventCount || 1;
                            const pct = (row.eventCount / maxCount) * 100;
                            return (
                              <tr key={i} className="border-b border-zinc-800/50 hover:bg-zinc-800/30">
                                <td className="py-2 pr-3">
                                  <button onClick={() => { setExplorerEvent(row.eventName); runExplorer(row.eventName, explorerPage || undefined); }}
                                    className="text-xs text-teal-400 hover:text-teal-300">{eventDisplayName(row.eventName)}</button>
                                </td>
                                <td className="py-2 pr-3">
                                  <button onClick={() => { setExplorerPage(row.pagePath); runExplorer(explorerEvent || undefined, row.pagePath); }}
                                    className="text-xs text-zinc-300 hover:text-zinc-100 font-mono truncate max-w-[250px] block">{row.pagePath}</button>
                                </td>
                                <td className="py-2 pr-3 text-right">
                                  <div className="flex items-center justify-end gap-2">
                                    <div className="w-16 h-1 rounded-full bg-zinc-800 overflow-hidden">
                                      <div className="h-full rounded-full bg-teal-500/40" style={{ width: `${pct}%` }} />
                                    </div>
                                    <span className="text-xs text-zinc-200 tabular-nums font-medium">{row.eventCount.toLocaleString()}</span>
                                  </div>
                                </td>
                                <td className="py-2 text-right text-xs text-zinc-500 tabular-nums">{row.users.toLocaleString()}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                      <div className="text-[10px] text-zinc-600 mt-2 text-right">{explorerData.length} results</div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </>)}
        </>)}
      </main>

      {/* Floating AI Chat */}
      {(overview || audit || ga4Overview) && (<>
        {!chatOpen && (
          <button onClick={() => setChatOpen(true)}
            className="fixed bottom-6 right-6 flex items-center gap-2 px-4 py-3 rounded-full bg-gradient-to-r from-teal-600 to-emerald-600 hover:from-teal-500 hover:to-emerald-500 text-white text-sm font-medium shadow-lg shadow-teal-900/30 transition-all z-50">
            <Sparkles className="w-4 h-4" /> Ask AI
          </button>
        )}
        {chatOpen && (
          <div className="fixed bottom-6 right-6 w-96 bg-zinc-900 rounded-2xl border border-zinc-800 shadow-2xl shadow-black/40 overflow-hidden z-50 flex flex-col max-h-[500px]">
            <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800 flex-shrink-0">
              <div className="flex items-center gap-2"><Sparkles className="w-4 h-4 text-teal-400" /><span className="text-sm font-medium text-zinc-200">AI Assistant</span><span className="text-[10px] text-zinc-500 bg-zinc-800 px-1.5 py-0.5 rounded">GPT-4o</span></div>
              <button onClick={() => setChatOpen(false)} className="text-zinc-500 hover:text-zinc-300"><X className="w-4 h-4" /></button>
            </div>
            <div className="flex-1 overflow-y-auto">
              {chatMessages.length === 0 && (
                <div className="p-4 space-y-3">
                  <p className="text-xs text-zinc-500">Ask anything about your site performance:</p>
                  <div className="grid grid-cols-1 gap-2">
                    {QUICK_QUESTIONS.map((q, i) => (
                      <button key={i} onClick={() => askAi(q)} className="text-left px-3 py-2.5 rounded-lg bg-zinc-800/50 hover:bg-zinc-800 border border-zinc-800 text-[11px] text-zinc-300 transition-colors">
                        <MessageSquare className="w-3 h-3 text-teal-400 mb-1" />{q}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {chatMessages.length > 0 && (
                <div className="p-4 space-y-4">
                  {chatMessages.map((msg, i) => (
                    <div key={i} className={`flex gap-3 ${msg.role === 'user' ? 'justify-end' : ''}`}>
                      {msg.role === 'assistant' && <div className="w-6 h-6 rounded-lg bg-teal-500/10 flex items-center justify-center flex-shrink-0 mt-0.5"><Sparkles className="w-3 h-3 text-teal-400" /></div>}
                      <div className={`max-w-[85%] rounded-xl px-3.5 py-2.5 ${msg.role === 'user' ? 'bg-teal-600/20 border border-teal-500/20 text-xs text-zinc-200' : 'bg-zinc-800/50 border border-zinc-800'}`}>
                        {msg.role === 'assistant' ? <RenderMarkdown text={msg.content} /> : msg.content}
                      </div>
                    </div>
                  ))}
                  {chatLoading && (
                    <div className="flex gap-3"><div className="w-6 h-6 rounded-lg bg-teal-500/10 flex items-center justify-center"><Loader2 className="w-3 h-3 text-teal-400 animate-spin" /></div>
                      <div className="bg-zinc-800/50 border border-zinc-800 rounded-xl px-3.5 py-2.5"><div className="flex gap-1"><div className="w-1.5 h-1.5 rounded-full bg-zinc-500 animate-bounce" /><div className="w-1.5 h-1.5 rounded-full bg-zinc-500 animate-bounce" style={{ animationDelay: '150ms' }} /><div className="w-1.5 h-1.5 rounded-full bg-zinc-500 animate-bounce" style={{ animationDelay: '300ms' }} /></div></div>
                    </div>
                  )}
                  <div ref={chatEndRef} />
                </div>
              )}
            </div>
            <div className="px-4 py-3 border-t border-zinc-800 flex gap-2 flex-shrink-0">
              <input type="text" value={chatInput} onChange={e => setChatInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && askAi(chatInput)}
                placeholder="Ask about your site data..." className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-xs text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-teal-500" disabled={chatLoading} />
              <button onClick={() => askAi(chatInput)} disabled={chatLoading || !chatInput.trim()} className="px-3 py-2 bg-teal-600 hover:bg-teal-500 disabled:opacity-50 rounded-lg transition-colors"><Send className="w-3.5 h-3.5" /></button>
            </div>
          </div>
        )}
      </>)}

        {/* ════════════ APPROVALS TAB ════════════ */}
        {tab === 'approvals' && (<>
          <div className="space-y-6">
            <div className="flex items-center gap-3">
              <ClipboardCheck className="w-5 h-5 text-violet-400" />
              <div>
                <h2 className="text-sm font-semibold text-zinc-200">SEO Change Approvals</h2>
                <p className="text-[10px] text-zinc-500 mt-0.5">Review proposed SEO changes, make edits if needed, then approve to push live.</p>
              </div>
              {pendingApprovals > 0 && (
                <span className="ml-auto px-2 py-0.5 text-[10px] font-medium rounded-full bg-violet-500/20 border border-violet-500/30 text-violet-300">
                  {pendingApprovals} pending
                </span>
              )}
            </div>

            {approvalsLoading && (
              <div className="flex items-center justify-center py-12"><Loader2 className="w-5 h-5 animate-spin text-zinc-500" /></div>
            )}

            {!approvalsLoading && approvalBatches.length === 0 && (
              <div className="text-center py-16">
                <div className="w-16 h-16 rounded-2xl bg-zinc-900 border border-zinc-800 flex items-center justify-center mx-auto mb-4">
                  <ClipboardCheck className="w-8 h-8 text-zinc-700" />
                </div>
                <h3 className="text-sm font-medium text-zinc-400 mb-1">No pending approvals</h3>
                <p className="text-[10px] text-zinc-600">Your agency will send SEO changes here for your review.</p>
              </div>
            )}

            {approvalBatches.map(batch => {
              const batchPending = batch.items.filter(i => i.status === 'pending').length;
              const batchApproved = batch.items.filter(i => i.status === 'approved').length;
              const batchApplied = batch.items.filter(i => i.status === 'applied').length;
              const batchRejected = batch.items.filter(i => i.status === 'rejected').length;
              const isApplying = applyingBatch === batch.id;

              return (
                <div key={batch.id} className="bg-zinc-900 rounded-xl border border-zinc-800 overflow-hidden">
                  {/* Batch header */}
                  <div className="px-5 py-4 border-b border-zinc-800 flex items-center justify-between">
                    <div>
                      <h3 className="text-sm font-medium text-zinc-200">{batch.name}</h3>
                      <p className="text-[10px] text-zinc-500 mt-0.5">
                        {new Date(batch.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                        {' · '}{batch.items.length} change{batch.items.length !== 1 ? 's' : ''}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {batchPending > 0 && <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-400">{batchPending} pending</span>}
                      {batchApproved > 0 && <span className="text-[10px] px-2 py-0.5 rounded-full bg-green-500/10 border border-green-500/30 text-green-400">{batchApproved} approved</span>}
                      {batchApplied > 0 && <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-500/10 border border-blue-500/30 text-blue-400">{batchApplied} applied</span>}
                      {batchRejected > 0 && <span className="text-[10px] px-2 py-0.5 rounded-full bg-red-500/10 border border-red-500/30 text-red-400">{batchRejected} rejected</span>}
                    </div>
                  </div>

                  {/* Items */}
                  <div className="divide-y divide-zinc-800/50">
                    {batch.items.map(item => {
                      const isEditing = editingApproval === item.id;
                      const displayValue = item.clientValue || item.proposedValue;
                      const fieldLabel = item.field === 'seoTitle' ? 'SEO Title' : 'Meta Description';
                      const statusColors = {
                        pending: 'bg-amber-500/10 border-amber-500/30 text-amber-400',
                        approved: 'bg-green-500/10 border-green-500/30 text-green-400',
                        rejected: 'bg-red-500/10 border-red-500/30 text-red-400',
                        applied: 'bg-blue-500/10 border-blue-500/30 text-blue-400',
                      };

                      return (
                        <div key={item.id} className="px-5 py-4">
                          <div className="flex items-start justify-between gap-4 mb-2">
                            <div className="min-w-0">
                              <div className="flex items-center gap-2 mb-1">
                                <span className="text-xs font-medium text-zinc-300 truncate">{item.pageTitle}</span>
                                <span className={`text-[9px] px-1.5 py-0.5 rounded border ${statusColors[item.status]}`}>{item.status}</span>
                              </div>
                              <span className="text-[10px] text-zinc-600">/{item.pageSlug} · {fieldLabel}</span>
                            </div>
                          </div>

                          {/* Current vs proposed */}
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
                            <div>
                              <div className="text-[10px] text-zinc-500 mb-1">Current</div>
                              <div className="text-[11px] text-zinc-400 bg-zinc-800/30 rounded-lg px-3 py-2 min-h-[2rem]">
                                {item.currentValue || <span className="italic text-zinc-600">Empty</span>}
                              </div>
                            </div>
                            <div>
                              <div className="text-[10px] text-zinc-500 mb-1 flex items-center gap-1">
                                Proposed
                                {item.clientValue && <span className="text-violet-400">(edited by you)</span>}
                              </div>
                              {isEditing ? (
                                <div className="space-y-2">
                                  {item.field === 'seoTitle' ? (
                                    <input
                                      type="text"
                                      value={editDraft}
                                      onChange={e => setEditDraft(e.target.value)}
                                      className="w-full px-3 py-1.5 bg-zinc-800 border border-violet-500/50 rounded-lg text-xs text-zinc-200 focus:outline-none focus:border-violet-400"
                                    />
                                  ) : (
                                    <textarea
                                      value={editDraft}
                                      onChange={e => setEditDraft(e.target.value)}
                                      rows={2}
                                      className="w-full px-3 py-1.5 bg-zinc-800 border border-violet-500/50 rounded-lg text-xs text-zinc-200 focus:outline-none focus:border-violet-400 resize-none"
                                    />
                                  )}
                                  <div className="flex gap-1.5">
                                    <button
                                      onClick={() => updateApprovalItem(batch.id, item.id, { clientValue: editDraft })}
                                      className="px-2.5 py-1 bg-violet-600 hover:bg-violet-500 rounded text-[10px] font-medium transition-colors"
                                    >Save Edit</button>
                                    <button
                                      onClick={() => { setEditingApproval(null); setEditDraft(''); }}
                                      className="px-2.5 py-1 bg-zinc-800 hover:bg-zinc-700 rounded text-[10px] text-zinc-400 transition-colors"
                                    >Cancel</button>
                                  </div>
                                </div>
                              ) : (
                                <div className="text-[11px] text-zinc-200 bg-zinc-800/30 rounded-lg px-3 py-2 min-h-[2rem]">
                                  {displayValue}
                                </div>
                              )}
                            </div>
                          </div>

                          {/* Actions */}
                          {item.status === 'pending' && !isEditing && (
                            <div className="flex items-center gap-2 mt-3">
                              <button
                                onClick={() => updateApprovalItem(batch.id, item.id, { status: 'approved' })}
                                className="flex items-center gap-1 px-3 py-1.5 bg-green-600/80 hover:bg-green-500 rounded-lg text-[10px] font-medium transition-colors"
                              >
                                <Check className="w-3 h-3" /> Approve
                              </button>
                              <button
                                onClick={() => { setEditingApproval(item.id); setEditDraft(displayValue); }}
                                className="flex items-center gap-1 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-lg text-[10px] font-medium text-zinc-300 transition-colors"
                              >
                                <Edit3 className="w-3 h-3" /> Edit
                              </button>
                              <button
                                onClick={() => updateApprovalItem(batch.id, item.id, { status: 'rejected' })}
                                className="flex items-center gap-1 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-lg text-[10px] font-medium text-red-400 transition-colors"
                              >
                                <X className="w-3 h-3" /> Reject
                              </button>
                            </div>
                          )}
                          {item.status === 'approved' && (
                            <div className="flex items-center gap-2 mt-3 text-[10px] text-green-400">
                              <Check className="w-3 h-3" /> Approved — will be applied when you push changes live
                            </div>
                          )}
                          {item.status === 'applied' && (
                            <div className="flex items-center gap-2 mt-3 text-[10px] text-blue-400">
                              <CheckCircle2 className="w-3 h-3" /> Applied to live site
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {/* Batch actions */}
                  {batchApproved > 0 && (
                    <div className="px-5 py-4 border-t border-zinc-800 bg-zinc-900/50 flex items-center justify-between">
                      <span className="text-[11px] text-zinc-400">
                        {batchApproved} approved change{batchApproved !== 1 ? 's' : ''} ready to push
                      </span>
                      <button
                        onClick={() => applyApprovedBatch(batch.id)}
                        disabled={isApplying}
                        className="flex items-center gap-1.5 px-4 py-2 bg-green-600 hover:bg-green-500 disabled:opacity-50 rounded-lg text-xs font-medium transition-colors"
                      >
                        {isApplying ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                        {isApplying ? 'Applying...' : 'Push Approved Changes Live'}
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>)}

      {/* Powered by footer */}
      <footer className="border-t border-zinc-800/50 mt-12">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <span className="text-[10px] text-zinc-700">Powered by hmpsn studio</span>
          <a href="https://hmpsn.studio" target="_blank" rel="noopener noreferrer" className="text-[10px] text-zinc-700 hover:text-zinc-500 transition-colors">hmpsn.studio</a>
        </div>
      </footer>
    </div>
  );
}

function InsightCard({ icon: Icon, color, title, count, desc, items }: {
  icon: typeof Target; color: string; title: string; count: number; desc: string;
  items: Array<{ label: string; value: string; sub: string }>;
}) {
  const colorMap: Record<string, { text: string }> = {
    amber: { text: 'text-amber-400' }, green: { text: 'text-green-400' },
    red: { text: 'text-red-400' }, orange: { text: 'text-orange-400' },
  };
  const c = colorMap[color] || colorMap.amber;
  return (
    <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
      <div className="flex items-center gap-1.5 mb-3">
        <Icon className={`w-4 h-4 ${c.text}`} />
        <span className={`text-xs font-medium ${c.text}`}>{title}</span>
        <span className="text-[10px] text-zinc-600 ml-auto">{count} queries</span>
      </div>
      <p className="text-[10px] text-zinc-500 mb-2">{desc}</p>
      <div className="space-y-1.5">
        {items.map((item, i) => (
          <div key={i} className="flex items-center justify-between text-[11px] py-1 px-2 rounded bg-zinc-800/30">
            <span className="text-zinc-300 truncate mr-2">{item.label}</span>
            <div className="flex items-center gap-2 flex-shrink-0">
              <span className="text-zinc-500">{item.sub}</span>
              <span className={`${c.text} font-medium`}>{item.value}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
