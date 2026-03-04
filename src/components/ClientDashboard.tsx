import { useState, useEffect, useRef } from 'react';
import {
  Loader2, Search, TrendingUp, TrendingDown, Eye, MousePointer,
  BarChart3, ArrowUpDown, Sparkles, Send, AlertTriangle,
  Target, Zap, Shield, MessageSquare, X, ChevronDown,
  CheckCircle2, Info, LayoutDashboard, LineChart, Lock,
  Users, Globe, Activity,
} from 'lucide-react';

interface SearchQuery { query: string; clicks: number; impressions: number; ctr: number; position: number; }
interface SearchPage { page: string; clicks: number; impressions: number; ctr: number; position: number; }
interface SearchOverview {
  totalClicks: number; totalImpressions: number; avgCtr: number; avgPosition: number;
  topQueries: SearchQuery[]; topPages: SearchPage[];
  dateRange: { start: string; end: string };
}
interface PerformanceTrend { date: string; clicks: number; impressions: number; ctr: number; position: number; }
interface EventDisplayConfig { eventName: string; displayName: string; pinned: boolean; group?: string; }
interface WorkspaceInfo { id: string; name: string; webflowSiteId?: string; webflowSiteName?: string; gscPropertyUrl?: string; ga4PropertyId?: string; liveDomain?: string; eventConfig?: EventDisplayConfig[]; requiresPassword?: boolean; }
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
interface Props { workspaceId: string; }

type SortKey = 'clicks' | 'impressions' | 'ctr' | 'position';
type ClientTab = 'overview' | 'search' | 'health' | 'analytics';

const SEV = {
  error: { bg: 'bg-red-500/10', border: 'border-red-500/20', text: 'text-red-400' },
  warning: { bg: 'bg-amber-500/10', border: 'border-amber-500/20', text: 'text-amber-400' },
  info: { bg: 'bg-blue-500/10', border: 'border-blue-500/20', text: 'text-blue-400' },
} as const;

const CAT_LABELS: Record<string, { label: string; color: string }> = {
  content: { label: 'Content', color: '#60a5fa' }, technical: { label: 'Technical', color: '#a78bfa' },
  social: { label: 'Social', color: '#f472b6' }, performance: { label: 'Performance', color: '#fbbf24' },
  accessibility: { label: 'Accessibility', color: '#34d399' },
};

const QUICK_QUESTIONS = [
  'What are my biggest SEO opportunities right now?',
  'Which pages should I optimize first for more traffic?',
  'Why is my CTR low and how can I improve it?',
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

/** Rewrite webflow.io URLs to live domain */
function toLiveUrl(url: string, liveDomain?: string): string {
  if (!liveDomain || !url) return url;
  return url.replace(/https?:\/\/[^/]+\.webflow\.io/, liveDomain.replace(/\/$/, ''));
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
  const [authenticated, setAuthenticated] = useState(false);
  const [passwordInput, setPasswordInput] = useState('');
  const [authError, setAuthError] = useState('');
  const [authLoading, setAuthLoading] = useState(false);

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

  const loadDashboardData = (data: WorkspaceInfo) => {
    if (data.gscPropertyUrl) loadSearchData(data.id, 28);
    fetch(`/api/public/audit-summary/${data.id}`).then(r => r.json()).then(a => { if (a?.id) setAudit(a); }).catch(() => {});
    fetch(`/api/public/audit-detail/${data.id}`).then(r => r.json()).then(d => { if (d?.id) setAuditDetail(d); }).catch(() => {});
    if (data.ga4PropertyId) loadGA4Data(data.id, 28);
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

  const changeDays = (d: number) => { setDays(d); if (ws) loadSearchData(ws.id, d); };

  const askAi = async (question: string) => {
    if (!question.trim() || !overview || !ws) return;
    setChatMessages(prev => [...prev, { role: 'user', content: question.trim() }]);
    setChatInput('');
    setChatLoading(true);
    try {
      const context = {
        dateRange: overview.dateRange, days, totalClicks: overview.totalClicks,
        totalImpressions: overview.totalImpressions, avgCtr: overview.avgCtr,
        avgPosition: overview.avgPosition, topQueries: overview.topQueries, topPages: overview.topPages,
      };
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
    <div className="min-h-screen bg-[#0a0a1a] text-zinc-200">
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
    <div className="min-h-screen bg-[#0a0a1a] flex items-center justify-center">
      <div className="text-center">
        <p className="text-red-400 text-sm mb-3">{error || 'Dashboard not found'}</p>
        <button onClick={() => window.location.reload()} className="text-xs text-zinc-400 hover:text-zinc-200 px-3 py-1.5 rounded-lg border border-zinc-700 hover:border-zinc-600 transition-colors">Try Again</button>
      </div>
    </div>
  );

  // Password gate
  if (ws.requiresPassword && !authenticated) return (
    <div className="min-h-screen bg-[#0a0a1a] flex items-center justify-center">
      <div className="w-full max-w-sm">
        <div className="bg-zinc-900 rounded-2xl border border-zinc-800 p-8 shadow-2xl shadow-black/40">
          <div className="flex flex-col items-center mb-6">
            <img src="/logo.svg" alt="hmpsn studio" className="h-5 opacity-60 mb-4" />
            <div className="w-12 h-12 rounded-2xl bg-violet-500/10 flex items-center justify-center mb-4">
              <Lock className="w-6 h-6 text-violet-400" />
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
                className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-sm text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-violet-500 transition-colors"
                autoFocus
              />
              {authError && <p className="text-xs text-red-400 mt-2">{authError}</p>}
            </div>
            <button
              type="submit"
              disabled={authLoading || !passwordInput.trim()}
              className="w-full py-3 rounded-xl bg-gradient-to-r from-violet-600 to-fuchsia-600 hover:from-violet-500 hover:to-fuchsia-500 disabled:opacity-50 text-white text-sm font-medium transition-all flex items-center justify-center gap-2"
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

  const NAV = [
    { id: 'overview' as ClientTab, label: 'Overview', icon: LayoutDashboard },
    { id: 'search' as ClientTab, label: 'Search', icon: Search },
    { id: 'health' as ClientTab, label: 'Site Health', icon: Shield },
    { id: 'analytics' as ClientTab, label: 'Analytics', icon: LineChart },
  ];

  return (
    <div className="min-h-screen bg-[#0a0a1a] text-zinc-200">
      {/* Header */}
      <header className="border-b border-zinc-800">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <img src="/logo.svg" alt="hmpsn studio" className="h-6 opacity-80" />
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
                (t.id === 'analytics' && !!ga4Overview);
              return (
                <button key={t.id} onClick={() => setTab(t.id)}
                  className={`flex items-center gap-1.5 px-4 py-3 text-xs font-medium border-b-2 transition-colors ${
                    active ? 'border-violet-500 text-violet-400' :
                    'border-transparent text-zinc-500 hover:text-zinc-300 hover:border-zinc-700'
                  }`}>
                  <Icon className="w-3.5 h-3.5" /> {t.label}
                  {hasData && !active && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400/60" />}
                </button>
              );
            })}
          </nav>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-6 space-y-5">

        {/* ════════════ OVERVIEW TAB ════════════ */}
        {tab === 'overview' && (<>
          {/* Score cards row */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            {audit ? (
              <button onClick={() => setTab('health')} className="bg-zinc-900 rounded-xl p-4 border border-zinc-800 hover:border-zinc-700 transition-colors text-left">
                <div className="flex items-center justify-between mb-1">
                  <Shield className="w-4 h-4" style={{ color: audit.siteScore >= 80 ? '#34d399' : audit.siteScore >= 60 ? '#fbbf24' : '#f87171' }} />
                  {audit.previousScore != null && (
                    <span className={`text-[10px] font-medium ${audit.siteScore > audit.previousScore ? 'text-green-400' : audit.siteScore < audit.previousScore ? 'text-red-400' : 'text-zinc-500'}`}>
                      {audit.siteScore > audit.previousScore ? '↑' : '↓'}{Math.abs(audit.siteScore - audit.previousScore)}
                    </span>
                  )}
                </div>
                <div className="text-2xl font-bold" style={{ color: audit.siteScore >= 80 ? '#34d399' : audit.siteScore >= 60 ? '#fbbf24' : '#f87171' }}>{audit.siteScore}</div>
                <div className="text-[10px] text-zinc-500 mt-0.5">Site Health</div>
              </button>
            ) : (
              <div className="bg-zinc-900 rounded-xl p-4 border border-zinc-800">
                <Shield className="w-4 h-4 text-zinc-700 mb-1" />
                <div className="text-2xl font-bold text-zinc-700">—</div>
                <div className="text-[10px] text-zinc-600 mt-0.5">Site Health</div>
              </div>
            )}
            {overview ? (
              [
                { icon: MousePointer, label: 'Total Clicks', value: overview.totalClicks.toLocaleString(), color: '#60a5fa', td: trend.map(t => t.clicks) },
                { icon: Eye, label: 'Impressions', value: overview.totalImpressions.toLocaleString(), color: '#a78bfa', td: trend.map(t => t.impressions) },
                { icon: TrendingUp, label: 'Avg CTR', value: `${overview.avgCtr}%`, color: '#34d399', td: trend.map(t => t.ctr) },
                { icon: BarChart3, label: 'Avg Position', value: String(overview.avgPosition), color: '#fbbf24', td: trend.map(t => t.position) },
              ].map((card, i) => { const Icon = card.icon; return (
                <button key={i} onClick={() => setTab('search')} className="bg-zinc-900 rounded-xl p-4 border border-zinc-800 hover:border-zinc-700 transition-colors text-left">
                  <div className="flex items-center justify-between mb-1"><Icon className="w-4 h-4" style={{ color: card.color }} /><MiniSparkline data={card.td} color={card.color} /></div>
                  <div className="text-2xl font-bold text-zinc-200">{card.value}</div>
                  <div className="text-[10px] text-zinc-500 mt-0.5">{card.label}</div>
                </button>
              ); })
            ) : (
              Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="bg-zinc-900 rounded-xl p-4 border border-zinc-800">
                  <div className="w-4 h-4 rounded bg-zinc-800 mb-1" />
                  <div className="text-2xl font-bold text-zinc-700">—</div>
                  <div className="text-[10px] text-zinc-600 mt-0.5">{['Clicks', 'Impressions', 'CTR', 'Position'][i]}</div>
                </div>
              ))
            )}
          </div>

          {/* GA4 Analytics cards row */}
          {ga4Overview && (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {[
                { icon: Users, label: 'Users', value: ga4Overview.totalUsers.toLocaleString(), color: '#a78bfa', td: ga4Trend.map(d => d.users) },
                { icon: Globe, label: 'Sessions', value: ga4Overview.totalSessions.toLocaleString(), color: '#60a5fa', td: ga4Trend.map(d => d.sessions) },
                { icon: Eye, label: 'Page Views', value: ga4Overview.totalPageviews.toLocaleString(), color: '#2dd4bf', td: ga4Trend.map(d => d.pageviews) },
                { icon: Activity, label: 'Bounce Rate', value: `${ga4Overview.bounceRate}%`, color: ga4Overview.bounceRate > 60 ? '#f87171' : '#34d399', td: [] },
              ].map((card, i) => { const Icon = card.icon; return (
                <button key={i} onClick={() => setTab('analytics')} className="bg-zinc-900 rounded-xl p-4 border border-zinc-800 hover:border-zinc-700 transition-colors text-left">
                  <div className="flex items-center justify-between mb-1"><Icon className="w-4 h-4" style={{ color: card.color }} />{card.td.length > 2 && <MiniSparkline data={card.td} color={card.color} />}</div>
                  <div className="text-2xl font-bold text-zinc-200">{card.value}</div>
                  <div className="text-[10px] text-zinc-500 mt-0.5">{card.label}</div>
                </button>
              ); })}
            </div>
          )}

          {/* Two-column layout */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <div className="space-y-5">
              {trend.length > 2 && (
                <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-xs font-medium text-zinc-400">Performance Trend</span>
                    {overview && <span className="text-[10px] text-zinc-600">{overview.dateRange.start} — {overview.dateRange.end}</span>}
                  </div>
                  <div className="space-y-3">
                    <div><div className="text-[10px] text-blue-400 mb-1">Clicks</div><TrendChart data={trend} metric="clicks" color="#60a5fa" /></div>
                    <div><div className="text-[10px] text-purple-400 mb-1">Impressions</div><TrendChart data={trend} metric="impressions" color="#a78bfa" /></div>
                  </div>
                </div>
              )}
              {ga4Trend.length > 2 && (
                <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-xs font-medium text-zinc-400">Traffic Trend</span>
                    {ga4Overview && <span className="text-[10px] text-zinc-600">{ga4Overview.dateRange.start} — {ga4Overview.dateRange.end}</span>}
                  </div>
                  <svg viewBox="0 0 400 100" className="w-full h-20" preserveAspectRatio="none">
                    {(() => {
                      const maxU = Math.max(...ga4Trend.map(d => d.users), 1);
                      const maxS = Math.max(...ga4Trend.map(d => d.sessions), 1);
                      const xStep = 400 / Math.max(ga4Trend.length - 1, 1);
                      const mkPath = (vals: number[], max: number) => vals.map((v, i) => `${i === 0 ? 'M' : 'L'}${i * xStep},${95 - (v / max) * 85}`).join(' ');
                      return (<>
                        <path d={mkPath(ga4Trend.map(d => d.sessions), maxS)} fill="none" stroke="rgba(96,165,250,0.4)" strokeWidth="1.5" />
                        <path d={mkPath(ga4Trend.map(d => d.users), maxU)} fill="none" stroke="#a78bfa" strokeWidth="2" />
                        <path d={`${mkPath(ga4Trend.map(d => d.users), maxU)} L${(ga4Trend.length - 1) * xStep},95 L0,95 Z`} fill="url(#overviewGa4)" opacity="0.12" />
                        <defs><linearGradient id="overviewGa4" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#a78bfa" /><stop offset="100%" stopColor="transparent" /></linearGradient></defs>
                      </>);
                    })()}
                  </svg>
                  <div className="flex items-center gap-4 mt-2">
                    <span className="flex items-center gap-1.5 text-[10px] text-zinc-500"><span className="w-3 h-0.5 rounded bg-violet-400 inline-block" /> Users</span>
                    <span className="flex items-center gap-1.5 text-[10px] text-zinc-500"><span className="w-3 h-0.5 rounded bg-blue-400/40 inline-block" /> Sessions</span>
                  </div>
                </div>
              )}
              {auditDetail && auditDetail.scoreHistory.length >= 2 && (
                <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
                  <div className="text-xs font-medium text-zinc-400 mb-3">Health Score Trend</div>
                  <ScoreHistoryChart history={auditDetail.scoreHistory} />
                </div>
              )}
              {!overview && !audit && !ga4Overview && (
                <div className="bg-gradient-to-br from-violet-500/10 via-zinc-900 to-fuchsia-500/10 rounded-xl border border-zinc-800 p-8 text-center">
                  <div className="w-12 h-12 rounded-2xl bg-violet-500/10 flex items-center justify-center mx-auto mb-4"><BarChart3 className="w-6 h-6 text-violet-400" /></div>
                  <h2 className="text-lg font-semibold text-zinc-200 mb-2">{ws.name}</h2>
                  <p className="text-sm text-zinc-400">Your dashboard is being configured. Data will appear here once set up by your web team.</p>
                </div>
              )}
            </div>

            <div className="space-y-5">
              {insights && insights.lowHanging.length > 0 && (
                <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <Target className="w-4 h-4 text-amber-400" />
                    <span className="text-xs font-medium text-zinc-300">Top Opportunities</span>
                    <span className="text-[10px] text-zinc-600 ml-auto">{insights.lowHanging.length} queries</span>
                  </div>
                  <p className="text-[10px] text-zinc-500 mb-2">Queries ranking 5-20 with good impressions — potential to reach page 1</p>
                  <div className="space-y-1.5">
                    {insights.lowHanging.slice(0, 5).map((q, i) => (
                      <div key={i} className="flex items-center justify-between text-[11px] py-1.5 px-2.5 rounded-lg bg-zinc-800/30">
                        <span className="text-zinc-300 truncate mr-2">{q.query}</span>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <span className="text-zinc-500">{q.impressions} imp</span>
                          <span className="text-amber-400 font-medium">#{q.position}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                  {insights.lowHanging.length > 5 && <button onClick={() => setTab('search')} className="text-[10px] text-violet-400 hover:text-violet-300 mt-2">View all {insights.lowHanging.length} →</button>}
                </div>
              )}
              {auditDetail && auditDetail.audit.errors > 0 && (
                <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <AlertTriangle className="w-4 h-4 text-red-400" />
                    <span className="text-xs font-medium text-zinc-300">Critical Issues</span>
                    <span className="text-[10px] text-red-400/70 ml-auto">{auditDetail.audit.errors} errors</span>
                  </div>
                  <div className="space-y-1.5">
                    {auditDetail.audit.pages.flatMap(p => p.issues.filter(i => i.severity === 'error').map(i => ({ ...i, pageName: p.page }))).slice(0, 5).map((issue, i) => (
                      <div key={i} className="text-[11px] py-1.5 px-2.5 rounded-lg bg-red-500/5 border border-red-500/10">
                        <div className="text-red-400 font-medium">{issue.message}</div>
                        <div className="text-zinc-600 mt-0.5">{issue.pageName}</div>
                      </div>
                    ))}
                  </div>
                  <button onClick={() => setTab('health')} className="text-[10px] text-violet-400 hover:text-violet-300 mt-2">View full audit →</button>
                </div>
              )}
              {audit && !(auditDetail?.audit.errors) && (
                <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
                  <div className="flex items-center gap-2 mb-3"><CheckCircle2 className="w-4 h-4 text-green-400" /><span className="text-xs font-medium text-zinc-300">Site Health</span></div>
                  <div className="flex items-center gap-3">
                    <div className={`text-3xl font-bold ${audit.siteScore >= 80 ? 'text-green-400' : audit.siteScore >= 60 ? 'text-amber-400' : 'text-red-400'}`}>{audit.siteScore}</div>
                    <div><div className="text-xs text-zinc-400">{audit.totalPages} pages scanned</div><div className="text-[10px] text-zinc-600">{new Date(audit.createdAt).toLocaleDateString()}</div></div>
                  </div>
                  <button onClick={() => setTab('health')} className="text-[10px] text-violet-400 hover:text-violet-300 mt-2">View details →</button>
                </div>
              )}
              {insights && insights.topPerformers.length > 0 && (
                <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
                  <div className="flex items-center gap-2 mb-3"><Zap className="w-4 h-4 text-green-400" /><span className="text-xs font-medium text-zinc-300">Top Performers</span></div>
                  <div className="space-y-1.5">
                    {insights.topPerformers.slice(0, 5).map((q, i) => (
                      <div key={i} className="flex items-center justify-between text-[11px] py-1.5 px-2.5 rounded-lg bg-zinc-800/30">
                        <span className="text-zinc-300 truncate mr-2">{q.query}</span>
                        <div className="flex items-center gap-2 flex-shrink-0"><span className="text-zinc-500">{q.clicks} clicks</span><span className="text-green-400 font-medium">#{q.position}</span></div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {/* GA4 Traffic Sources (compact) */}
              {ga4Sources.length > 0 && (
                <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2"><Globe className="w-4 h-4 text-blue-400" /><span className="text-xs font-medium text-zinc-300">Traffic Sources</span></div>
                    <button onClick={() => setTab('analytics')} className="text-[10px] text-violet-400 hover:text-violet-300">View all →</button>
                  </div>
                  <div className="space-y-1.5">
                    {ga4Sources.slice(0, 5).map((s, i) => {
                      const totalSessions = ga4Sources.reduce((sum, x) => sum + x.sessions, 0);
                      const pct = totalSessions > 0 ? (s.sessions / totalSessions) * 100 : 0;
                      return (
                        <div key={i} className="relative">
                          <div className="flex items-center justify-between text-[11px] py-1.5 px-2.5 rounded-lg relative z-10">
                            <span className="text-zinc-300 truncate mr-2">{s.source}{s.medium !== '(none)' ? ` / ${s.medium}` : ''}</span>
                            <div className="flex items-center gap-2 flex-shrink-0">
                              <span className="text-blue-400 font-medium tabular-nums">{s.sessions.toLocaleString()}</span>
                              <span className="text-zinc-600 w-10 text-right">{pct.toFixed(0)}%</span>
                            </div>
                          </div>
                          <div className="absolute inset-0 rounded-lg bg-blue-500/5" style={{ width: `${pct}%` }} />
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
              {/* GA4 Device Breakdown (compact) */}
              {ga4Devices.length > 0 && (
                <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
                  <div className="flex items-center gap-2 mb-3"><Activity className="w-4 h-4 text-teal-400" /><span className="text-xs font-medium text-zinc-300">Devices</span></div>
                  <div className="space-y-2.5">
                    {ga4Devices.map((d, i) => {
                      const colors = ['bg-violet-500', 'bg-blue-500', 'bg-teal-500'];
                      const textColors = ['text-violet-400', 'text-blue-400', 'text-teal-400'];
                      return (
                        <div key={i}>
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-[11px] text-zinc-400 capitalize">{d.device}</span>
                            <span className={`text-[11px] font-medium ${textColors[i % textColors.length]}`}>{d.percentage}%</span>
                          </div>
                          <div className="h-1.5 rounded-full bg-zinc-800 overflow-hidden">
                            <div className={`h-full rounded-full ${colors[i % colors.length]}`} style={{ width: `${d.percentage}%` }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>
        </>)}

        {/* ════════════ SEARCH TAB ════════════ */}
        {tab === 'search' && (<>
          {overview ? (<>
            <div className="grid grid-cols-4 gap-3">
              {[
                { icon: MousePointer, label: 'Total Clicks', value: overview.totalClicks.toLocaleString(), color: '#60a5fa', td: trend.map(t => t.clicks) },
                { icon: Eye, label: 'Total Impressions', value: overview.totalImpressions.toLocaleString(), color: '#a78bfa', td: trend.map(t => t.impressions) },
                { icon: TrendingUp, label: 'Avg CTR', value: `${overview.avgCtr}%`, color: '#34d399', td: trend.map(t => t.ctr) },
                { icon: BarChart3, label: 'Avg Position', value: String(overview.avgPosition), color: '#fbbf24', td: trend.map(t => t.position) },
              ].map((card, i) => { const Icon = card.icon; return (
                <div key={i} className="bg-zinc-900 rounded-xl p-4 border border-zinc-800">
                  <div className="flex items-center justify-between mb-1"><Icon className="w-4 h-4" style={{ color: card.color }} /><MiniSparkline data={card.td} color={card.color} /></div>
                  <div className="text-2xl font-bold text-zinc-200">{card.value}</div>
                  <div className="text-[10px] text-zinc-500 mt-0.5">{card.label}</div>
                </div>
              ); })}
            </div>

            {trend.length > 2 && (
              <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs font-medium text-zinc-400">Performance Trend</span>
                  <span className="text-[10px] text-zinc-600">{overview.dateRange.start} — {overview.dateRange.end}</span>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div><div className="text-[10px] text-blue-400 mb-1">Clicks</div><TrendChart data={trend} metric="clicks" color="#60a5fa" /></div>
                  <div><div className="text-[10px] text-purple-400 mb-1">Impressions</div><TrendChart data={trend} metric="impressions" color="#a78bfa" /></div>
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
                { label: 'Users', value: ga4Overview.totalUsers.toLocaleString(), color: 'text-violet-400' },
                { label: 'Sessions', value: ga4Overview.totalSessions.toLocaleString(), color: 'text-blue-400' },
                { label: 'Page Views', value: ga4Overview.totalPageviews.toLocaleString(), color: 'text-teal-400' },
                { label: 'Avg Duration', value: `${Math.floor(ga4Overview.avgSessionDuration / 60)}m ${Math.floor(ga4Overview.avgSessionDuration % 60)}s`, color: 'text-amber-400' },
                { label: 'Bounce Rate', value: `${ga4Overview.bounceRate}%`, color: ga4Overview.bounceRate > 60 ? 'text-red-400' : 'text-emerald-400' },
                { label: 'New Users', value: `${ga4Overview.newUserPercentage}%`, color: 'text-fuchsia-400' },
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
                      <path d={mkPath(ga4Trend.map(d => d.users), maxV)} fill="none" stroke="rgba(167,139,250,0.9)" strokeWidth="2" />
                      <path d={`${mkPath(ga4Trend.map(d => d.users), maxV)} L${(ga4Trend.length - 1) * xStep},190 L0,190 Z`} fill="url(#ga4grad)" opacity="0.15" />
                      <defs><linearGradient id="ga4grad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#a78bfa" /><stop offset="100%" stopColor="transparent" /></linearGradient></defs>
                    </>);
                  })()}
                </svg>
                <div className="flex items-center justify-center gap-6 mt-2">
                  <span className="flex items-center gap-1.5 text-[10px] text-zinc-500"><span className="w-3 h-0.5 rounded bg-violet-400 inline-block" /> Users</span>
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
                      <span className="text-xs text-violet-400 font-medium tabular-nums">{p.pageviews.toLocaleString()}</span>
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
                        const colors = ['bg-violet-500', 'bg-blue-500', 'bg-teal-500', 'bg-amber-500'];
                        const textColors = ['text-violet-400', 'text-blue-400', 'text-teal-400', 'text-amber-400'];
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

            {/* ── Key Metrics & Events ── */}
            {(ga4Conversions.length > 0 || ga4Events.length > 0) && (
              <div className="space-y-6 mt-6">
                {/* Conversion / Custom Events */}
                {sortedConversions.length > 0 && (
                  <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-5">
                    <h3 className="text-sm font-semibold text-zinc-300 mb-1">Key Events</h3>
                    <p className="text-[10px] text-zinc-600 mb-4">Custom and conversion events tracked on your site (excludes default GA4 events)</p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                      {sortedConversions.slice(0, 9).map((c, i) => {
                        const isSelected = ga4SelectedEvent === c.eventName;
                        const pinned = isEventPinned(c.eventName);
                        return (
                          <button key={i} onClick={() => loadEventTrend(c.eventName)}
                            className={`text-left rounded-xl border p-4 transition-colors ${isSelected ? 'bg-violet-500/10 border-violet-500/30' : pinned ? 'bg-violet-500/5 border-violet-500/15 hover:border-violet-500/30' : 'bg-zinc-800/30 border-zinc-800 hover:border-zinc-700'}`}>
                            <div className="flex items-center justify-between mb-2">
                              <span className="text-[10px] text-zinc-400 truncate max-w-[140px]">{eventDisplayName(c.eventName)}</span>
                              <div className="flex items-center gap-1.5">
                                {pinned && <span className="w-1.5 h-1.5 rounded-full bg-violet-400" title="Pinned" />}
                                {c.rate > 0 && <span className="text-[10px] font-medium text-emerald-400">{c.rate}%</span>}
                              </div>
                            </div>
                            <div className="text-xl font-bold text-zinc-200">{c.conversions.toLocaleString()}</div>
                            <div className="text-[10px] text-zinc-600 mt-0.5">{c.users.toLocaleString()} users</div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
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
                          <path d={linePath} fill="none" stroke="#a78bfa" strokeWidth="2" />
                          <path d={`${linePath} L${(ga4EventTrend.length - 1) * xStep},110 L0,110 Z`} fill="url(#evtGrad)" opacity="0.15" />
                          {ga4EventTrend.map((d, i) => (
                            <circle key={i} cx={i * xStep} cy={110 - (d.eventCount / maxV) * 100} r="2.5" fill="#a78bfa" opacity="0.6" />
                          ))}
                          <defs><linearGradient id="evtGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#a78bfa" /><stop offset="100%" stopColor="transparent" /></linearGradient></defs>
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

                {/* All Events Table */}
                {ga4Events.length > 0 && (
                  <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-5">
                    <h3 className="text-sm font-semibold text-zinc-300 mb-1">All Tracked Events</h3>
                    <p className="text-[10px] text-zinc-600 mb-3">Every event tracked by Google Analytics on your site</p>
                    <div className="overflow-x-auto">
                      <table className="w-full text-left">
                        <thead>
                          <tr className="border-b border-zinc-800">
                            <th className="text-[10px] text-zinc-500 font-medium uppercase tracking-wider py-2 pr-4">Event</th>
                            <th className="text-[10px] text-zinc-500 font-medium uppercase tracking-wider py-2 pr-4 text-right">Count</th>
                            <th className="text-[10px] text-zinc-500 font-medium uppercase tracking-wider py-2 text-right">Users</th>
                            <th className="text-[10px] text-zinc-500 font-medium uppercase tracking-wider py-2 w-8" />
                          </tr>
                        </thead>
                        <tbody>
                          {ga4Events.map((ev, i) => {
                            const maxCount = ga4Events[0]?.eventCount || 1;
                            const pct = (ev.eventCount / maxCount) * 100;
                            return (
                              <tr key={i} className="border-b border-zinc-800/50 hover:bg-zinc-800/30">
                                <td className="py-2 pr-4">
                                  <div className="flex items-center gap-2">
                                    <span className="text-xs text-zinc-300">{eventDisplayName(ev.eventName)}</span>
                                    {eventDisplayName(ev.eventName) !== ev.eventName.replace(/_/g, ' ') && <span className="text-[10px] text-zinc-600 font-mono ml-1">{ev.eventName}</span>}
                                  </div>
                                  <div className="h-1 rounded-full bg-zinc-800 mt-1 max-w-[200px]">
                                    <div className="h-full rounded-full bg-violet-500/40" style={{ width: `${pct}%` }} />
                                  </div>
                                </td>
                                <td className="py-2 pr-4 text-right text-xs text-zinc-200 tabular-nums font-medium">{ev.eventCount.toLocaleString()}</td>
                                <td className="py-2 text-right text-xs text-zinc-500 tabular-nums">{ev.users.toLocaleString()}</td>
                                <td className="py-2 text-right">
                                  <button onClick={() => loadEventTrend(ev.eventName)} className="text-[10px] text-violet-400 hover:text-violet-300" title="View trend">↗</button>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            )}
          </>)}
        </>)}
      </main>

      {/* Floating AI Chat */}
      {(overview || audit || ga4Overview) && (<>
        {!chatOpen && (
          <button onClick={() => setChatOpen(true)}
            className="fixed bottom-6 right-6 flex items-center gap-2 px-4 py-3 rounded-full bg-gradient-to-r from-violet-600 to-fuchsia-600 hover:from-violet-500 hover:to-fuchsia-500 text-white text-sm font-medium shadow-lg shadow-violet-900/30 transition-all z-50">
            <Sparkles className="w-4 h-4" /> Ask AI
          </button>
        )}
        {chatOpen && (
          <div className="fixed bottom-6 right-6 w-96 bg-zinc-900 rounded-2xl border border-zinc-800 shadow-2xl shadow-black/40 overflow-hidden z-50 flex flex-col max-h-[500px]">
            <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800 flex-shrink-0">
              <div className="flex items-center gap-2"><Sparkles className="w-4 h-4 text-violet-400" /><span className="text-sm font-medium text-zinc-200">AI Assistant</span><span className="text-[10px] text-zinc-500 bg-zinc-800 px-1.5 py-0.5 rounded">GPT-4o</span></div>
              <button onClick={() => setChatOpen(false)} className="text-zinc-500 hover:text-zinc-300"><X className="w-4 h-4" /></button>
            </div>
            <div className="flex-1 overflow-y-auto">
              {chatMessages.length === 0 && (
                <div className="p-4 space-y-3">
                  <p className="text-xs text-zinc-500">Ask anything about your search performance:</p>
                  <div className="grid grid-cols-1 gap-2">
                    {QUICK_QUESTIONS.map((q, i) => (
                      <button key={i} onClick={() => askAi(q)} className="text-left px-3 py-2.5 rounded-lg bg-zinc-800/50 hover:bg-zinc-800 border border-zinc-800 text-[11px] text-zinc-300 transition-colors">
                        <MessageSquare className="w-3 h-3 text-violet-400 mb-1" />{q}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {chatMessages.length > 0 && (
                <div className="p-4 space-y-4">
                  {chatMessages.map((msg, i) => (
                    <div key={i} className={`flex gap-3 ${msg.role === 'user' ? 'justify-end' : ''}`}>
                      {msg.role === 'assistant' && <div className="w-6 h-6 rounded-lg bg-violet-500/10 flex items-center justify-center flex-shrink-0 mt-0.5"><Sparkles className="w-3 h-3 text-violet-400" /></div>}
                      <div className={`max-w-[85%] rounded-xl px-3.5 py-2.5 ${msg.role === 'user' ? 'bg-violet-600/20 border border-violet-500/20 text-xs text-zinc-200' : 'bg-zinc-800/50 border border-zinc-800'}`}>
                        {msg.role === 'assistant' ? <RenderMarkdown text={msg.content} /> : msg.content}
                      </div>
                    </div>
                  ))}
                  {chatLoading && (
                    <div className="flex gap-3"><div className="w-6 h-6 rounded-lg bg-violet-500/10 flex items-center justify-center"><Loader2 className="w-3 h-3 text-violet-400 animate-spin" /></div>
                      <div className="bg-zinc-800/50 border border-zinc-800 rounded-xl px-3.5 py-2.5"><div className="flex gap-1"><div className="w-1.5 h-1.5 rounded-full bg-zinc-500 animate-bounce" /><div className="w-1.5 h-1.5 rounded-full bg-zinc-500 animate-bounce" style={{ animationDelay: '150ms' }} /><div className="w-1.5 h-1.5 rounded-full bg-zinc-500 animate-bounce" style={{ animationDelay: '300ms' }} /></div></div>
                    </div>
                  )}
                  <div ref={chatEndRef} />
                </div>
              )}
            </div>
            <div className="px-4 py-3 border-t border-zinc-800 flex gap-2 flex-shrink-0">
              <input type="text" value={chatInput} onChange={e => setChatInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && askAi(chatInput)}
                placeholder="Ask about your search data..." className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-xs text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-violet-500" disabled={chatLoading} />
              <button onClick={() => askAi(chatInput)} disabled={chatLoading || !chatInput.trim()} className="px-3 py-2 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 rounded-lg transition-colors"><Send className="w-3.5 h-3.5" /></button>
            </div>
          </div>
        )}
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
