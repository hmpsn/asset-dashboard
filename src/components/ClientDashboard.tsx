import { useState, useEffect, useRef } from 'react';
import {
  Loader2, Search, TrendingUp, TrendingDown, Eye, MousePointer,
  BarChart3, ArrowUpDown, Sparkles, Send, AlertTriangle,
  Target, Zap, Shield, MessageSquare, X,
} from 'lucide-react';

interface SearchQuery {
  query: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

interface SearchPage {
  page: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

interface SearchOverview {
  totalClicks: number;
  totalImpressions: number;
  avgCtr: number;
  avgPosition: number;
  topQueries: SearchQuery[];
  topPages: SearchPage[];
  dateRange: { start: string; end: string };
}

interface PerformanceTrend {
  date: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

interface WorkspaceInfo {
  id: string;
  name: string;
  webflowSiteId?: string;
  webflowSiteName?: string;
  gscPropertyUrl?: string;
}

interface AuditSummary {
  id: string;
  createdAt: string;
  siteScore: number;
  totalPages: number;
  errors: number;
  warnings: number;
  previousScore?: number;
}

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface Props {
  workspaceId: string;
}

type SortKey = 'clicks' | 'impressions' | 'ctr' | 'position';
type ClientTab = 'search' | 'insights' | 'audit';

function MiniSparkline({ data, color }: { data: number[]; color: string }) {
  if (data.length < 2) return null;
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;
  const w = 120, h = 32;
  const points = data.map((v, i) => `${(i / (data.length - 1)) * w},${h - ((v - min) / range) * (h - 4) - 2}`).join(' ');
  return (
    <svg width={w} height={h} className="flex-shrink-0">
      <polyline fill="none" stroke={color} strokeWidth="1.5" points={points} strokeLinejoin="round" />
    </svg>
  );
}

function TrendChart({ data, metric, color }: { data: PerformanceTrend[]; metric: keyof PerformanceTrend; color: string }) {
  if (data.length < 2) return null;
  const values = data.map(d => d[metric] as number);
  const max = Math.max(...values), min = Math.min(...values), range = max - min || 1, w = 100;
  const points = values.map((v, i) => `${(i / (values.length - 1)) * w},${100 - ((v - min) / range) * 90 - 5}`).join(' ');
  return (
    <svg viewBox={`0 0 ${w} 100`} className="w-full" style={{ height: 80 }} preserveAspectRatio="none">
      <defs>
        <linearGradient id={`cg-${metric}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.2" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon fill={`url(#cg-${metric})`} points={`0,100 ${points} ${w},100`} />
      <polyline fill="none" stroke={color} strokeWidth="1.5" points={points} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
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

const QUICK_QUESTIONS = [
  'What are my biggest SEO opportunities right now?',
  'Which pages should I optimize first for more traffic?',
  'Why is my CTR low and how can I improve it?',
  'What content should I create next based on search data?',
];

export function ClientDashboard({ workspaceId }: Props) {
  const [ws, setWs] = useState<WorkspaceInfo | null>(null);
  const [overview, setOverview] = useState<SearchOverview | null>(null);
  const [trend, setTrend] = useState<PerformanceTrend[]>([]);
  const [audit, setAudit] = useState<AuditSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<ClientTab>('search');
  const [days, setDays] = useState(28);
  const [sortKey, setSortKey] = useState<SortKey>('clicks');
  const [sortAsc, setSortAsc] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [chatMessages]);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/public/workspace/${workspaceId}`)
      .then(r => r.json())
      .then((data: WorkspaceInfo) => {
        if (!data.id) { setError('Workspace not found'); setLoading(false); return; }
        setWs(data);
        if (data.gscPropertyUrl) loadSearchData(data.id, 28);
        fetch(`/api/public/audit-summary/${data.id}`).then(r => r.json()).then(a => { if (a?.id) setAudit(a); }).catch(() => {});
        setLoading(false);
      })
      .catch(() => { setError('Failed to load dashboard'); setLoading(false); });
  }, [workspaceId]);

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
      setError(err instanceof Error ? err.message : 'Failed to load search data');
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
    return [...overview.topQueries].sort((a, b) => {
      const av = a[sortKey]; const bv = b[sortKey];
      return sortAsc ? av - bv : bv - av;
    });
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
    <div className="min-h-screen bg-[#0a0a1a] flex items-center justify-center">
      <div className="flex flex-col items-center gap-3 text-zinc-500">
        <Loader2 className="w-6 h-6 animate-spin" />
        <p className="text-sm">Loading dashboard...</p>
      </div>
    </div>
  );

  if (error || !ws) return (
    <div className="min-h-screen bg-[#0a0a1a] flex items-center justify-center">
      <div className="text-center">
        <p className="text-red-400 text-sm">{error || 'Dashboard not found'}</p>
      </div>
    </div>
  );

  const insights = getInsights();

  return (
    <div className="min-h-screen bg-[#0a0a1a] text-zinc-200">
      {/* Header */}
      <header className="border-b border-zinc-800 px-6 py-4">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold">{ws.webflowSiteName || ws.name}</h1>
            <p className="text-xs text-zinc-500 mt-0.5">Search Performance Dashboard</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setChatOpen(!chatOpen)}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-colors ${chatOpen ? 'bg-violet-600 text-white' : 'bg-gradient-to-r from-violet-600/80 to-fuchsia-600/80 hover:from-violet-500 hover:to-fuchsia-500 text-white'}`}
            >
              <Sparkles className="w-3.5 h-3.5" /> Ask AI
            </button>
            <div className="flex items-center gap-1 bg-zinc-900 rounded-lg border border-zinc-800 p-0.5">
              {[7, 28, 90].map(d => (
                <button key={d} onClick={() => changeDays(d)}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${days === d ? 'bg-zinc-700 text-zinc-200' : 'text-zinc-500 hover:text-zinc-300'}`}
                >{d}d</button>
              ))}
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-6 space-y-5">
        {/* AI Chat Panel */}
        {chatOpen && overview && (
          <div className="bg-zinc-900 rounded-xl border border-zinc-800 overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-violet-400" />
                <span className="text-sm font-medium text-zinc-200">SEO AI Assistant</span>
                <span className="text-[10px] text-zinc-500 bg-zinc-800 px-1.5 py-0.5 rounded">GPT-4o</span>
              </div>
              <button onClick={() => setChatOpen(false)} className="text-zinc-500 hover:text-zinc-300"><X className="w-4 h-4" /></button>
            </div>
            {chatMessages.length === 0 && (
              <div className="p-4 space-y-3">
                <p className="text-xs text-zinc-500">Ask anything about your search performance:</p>
                <div className="grid grid-cols-2 gap-2">
                  {QUICK_QUESTIONS.map((q, i) => (
                    <button key={i} onClick={() => askAi(q)} className="text-left px-3 py-2.5 rounded-lg bg-zinc-800/50 hover:bg-zinc-800 border border-zinc-800 text-[11px] text-zinc-300 transition-colors">
                      <MessageSquare className="w-3 h-3 text-violet-400 mb-1" />{q}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {chatMessages.length > 0 && (
              <div className="max-h-80 overflow-y-auto p-4 space-y-4">
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
            <div className="px-4 py-3 border-t border-zinc-800 flex gap-2">
              <input type="text" value={chatInput} onChange={e => setChatInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && askAi(chatInput)}
                placeholder="Ask about your search data..." className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-xs text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-violet-500" disabled={chatLoading} />
              <button onClick={() => askAi(chatInput)} disabled={chatLoading || !chatInput.trim()} className="px-3 py-2 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 rounded-lg transition-colors"><Send className="w-3.5 h-3.5" /></button>
            </div>
          </div>
        )}

        {/* Summary cards */}
        {overview && (
          <div className="grid grid-cols-4 gap-3">
            {[
              { icon: MousePointer, label: 'Total Clicks', value: overview.totalClicks.toLocaleString(), color: '#60a5fa', trendData: trend.map(t => t.clicks) },
              { icon: Eye, label: 'Total Impressions', value: overview.totalImpressions.toLocaleString(), color: '#a78bfa', trendData: trend.map(t => t.impressions) },
              { icon: TrendingUp, label: 'Avg CTR', value: `${overview.avgCtr}%`, color: '#34d399', trendData: trend.map(t => t.ctr) },
              { icon: BarChart3, label: 'Avg Position', value: String(overview.avgPosition), color: '#fbbf24', trendData: trend.map(t => t.position) },
            ].map((card, i) => {
              const Icon = card.icon;
              return (
                <div key={i} className="bg-zinc-900 rounded-xl p-4 border border-zinc-800">
                  <div className="flex items-center justify-between mb-1">
                    <Icon className="w-4 h-4" style={{ color: card.color }} />
                    <MiniSparkline data={card.trendData} color={card.color} />
                  </div>
                  <div className="text-2xl font-bold text-zinc-200">{card.value}</div>
                  <div className="text-[10px] text-zinc-500 mt-0.5">{card.label}</div>
                </div>
              );
            })}
          </div>
        )}

        {/* Trend charts */}
        {trend.length > 2 && (
          <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-medium text-zinc-400">Performance Trend</span>
              {overview && <span className="text-[10px] text-zinc-600">{overview.dateRange.start} — {overview.dateRange.end}</span>}
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div><div className="text-[10px] text-blue-400 mb-1">Clicks</div><TrendChart data={trend} metric="clicks" color="#60a5fa" /></div>
              <div><div className="text-[10px] text-purple-400 mb-1">Impressions</div><TrendChart data={trend} metric="impressions" color="#a78bfa" /></div>
            </div>
          </div>
        )}

        {/* Tabs */}
        {overview && (
          <div className="flex items-center gap-0.5">
            {([
              { id: 'search' as ClientTab, label: 'Top Queries', icon: Search },
              { id: 'insights' as ClientTab, label: 'Insights', icon: Zap },
              { id: 'audit' as ClientTab, label: 'Site Health', icon: Shield },
            ]).map(t => { const Icon = t.icon; return (
              <button key={t.id} onClick={() => setTab(t.id)} className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-medium transition-colors ${tab === t.id ? 'bg-zinc-800 text-zinc-200' : 'text-zinc-500 hover:text-zinc-300'}`}>
                <Icon className="w-3.5 h-3.5" /> {t.label}
              </button>
            ); })}
          </div>
        )}

        {/* Search tab - queries table */}
        {tab === 'search' && overview && (
          <div className="bg-zinc-900 rounded-xl border border-zinc-800 overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-zinc-800">
                  <th className="text-left py-3 px-4 text-zinc-500 font-medium">Query</th>
                  {(['clicks', 'impressions', 'ctr', 'position'] as SortKey[]).map(key => (
                    <th key={key} className="text-right py-3 px-3 text-zinc-500 font-medium">
                      <button onClick={() => handleSort(key)} className="flex items-center gap-1 ml-auto hover:text-zinc-300 transition-colors">
                        {key === 'ctr' ? 'CTR' : key.charAt(0).toUpperCase() + key.slice(1)}
                        {sortKey === key && <ArrowUpDown className="w-3 h-3" />}
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sortedQueries().map((q, i) => (
                  <tr key={i} className="border-b border-zinc-800/50 hover:bg-zinc-800/30">
                    <td className="py-2.5 px-4 text-zinc-300 font-medium">{q.query}</td>
                    <td className="py-2.5 px-3 text-right text-blue-400 font-semibold">{q.clicks}</td>
                    <td className="py-2.5 px-3 text-right text-zinc-400">{q.impressions.toLocaleString()}</td>
                    <td className="py-2.5 px-3 text-right text-emerald-400">{q.ctr}%</td>
                    <td className="py-2.5 px-3 text-right"><span className={q.position <= 10 ? 'text-green-400' : q.position <= 20 ? 'text-amber-400' : 'text-red-400'}>{q.position}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Insights tab */}
        {tab === 'insights' && insights && overview && (
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
              {insights.lowHanging.length > 0 && (
                <InsightCard icon={Target} color="amber" title="Low-Hanging Fruit" count={insights.lowHanging.length} desc="Ranking 5-20 with impressions — small optimizations could push to page 1" items={insights.lowHanging.slice(0, 8).map(q => ({ label: q.query, value: `#${q.position}`, sub: `${q.impressions} imp` }))} />
              )}
              {insights.topPerformers.length > 0 && (
                <InsightCard icon={Shield} color="green" title="Top Performers" count={insights.topPerformers.length} desc="Top 3 positions with real clicks — protect these rankings" items={insights.topPerformers.slice(0, 8).map(q => ({ label: q.query, value: `#${q.position}`, sub: `${q.clicks} clicks` }))} />
              )}
              {insights.ctrOpps.length > 0 && (
                <InsightCard icon={TrendingDown} color="red" title="CTR Opportunities" count={insights.ctrOpps.length} desc="Page 1 but CTR under 3% — improve titles & meta descriptions" items={insights.ctrOpps.slice(0, 8).map(q => ({ label: q.query, value: `${q.ctr}% CTR`, sub: `#${q.position}` }))} />
              )}
              {insights.highImpLowClick.length > 0 && (
                <InsightCard icon={AlertTriangle} color="orange" title="Visibility Without Clicks" count={insights.highImpLowClick.length} desc="100+ impressions but under 5 clicks" items={insights.highImpLowClick.slice(0, 8).map(q => ({ label: q.query, value: `${q.clicks} clicks`, sub: `${q.impressions} imp` }))} />
              )}
            </div>
          </div>
        )}

        {/* Audit tab */}
        {tab === 'audit' && (
          <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-6">
            {audit ? (
              <div className="space-y-4">
                <div className="flex items-center gap-4">
                  <div className={`text-4xl font-bold ${audit.siteScore >= 80 ? 'text-green-400' : audit.siteScore >= 60 ? 'text-amber-400' : 'text-red-400'}`}>{audit.siteScore}</div>
                  <div>
                    <div className="text-sm font-medium text-zinc-200">Site Health Score</div>
                    <div className="text-xs text-zinc-500">{audit.totalPages} pages scanned • {new Date(audit.createdAt).toLocaleDateString()}</div>
                    {audit.previousScore != null && (
                      <div className={`text-xs mt-0.5 ${audit.siteScore > audit.previousScore ? 'text-green-400' : audit.siteScore < audit.previousScore ? 'text-red-400' : 'text-zinc-500'}`}>
                        {audit.siteScore > audit.previousScore ? '↑' : audit.siteScore < audit.previousScore ? '↓' : '→'} {audit.siteScore > audit.previousScore ? '+' : ''}{audit.siteScore - audit.previousScore} from previous audit
                      </div>
                    )}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-3">
                    <div className="text-2xl font-bold text-red-400">{audit.errors}</div>
                    <div className="text-xs text-red-400/70">Errors</div>
                  </div>
                  <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg px-4 py-3">
                    <div className="text-2xl font-bold text-amber-400">{audit.warnings}</div>
                    <div className="text-xs text-amber-400/70">Warnings</div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-center py-8">
                <Shield className="w-8 h-8 text-zinc-600 mx-auto mb-2" />
                <p className="text-sm text-zinc-500">No audit has been run yet</p>
                <p className="text-xs text-zinc-600 mt-1">Ask your team to run a site audit for detailed health metrics.</p>
              </div>
            )}
          </div>
        )}

        {/* No search data state */}
        {!overview && !loading && (
          <div className="text-center py-16">
            <Search className="w-8 h-8 text-zinc-600 mx-auto mb-2" />
            <p className="text-sm text-zinc-500">Search data is not yet available</p>
            <p className="text-xs text-zinc-600 mt-1">Search Console may not be configured for this workspace yet.</p>
          </div>
        )}
      </main>
    </div>
  );
}

function InsightCard({ icon: Icon, color, title, count, desc, items }: {
  icon: typeof Target; color: string; title: string; count: number; desc: string;
  items: Array<{ label: string; value: string; sub: string }>;
}) {
  const colorMap: Record<string, { text: string; icon: string }> = {
    amber: { text: 'text-amber-400', icon: 'text-amber-400' },
    green: { text: 'text-green-400', icon: 'text-green-400' },
    red: { text: 'text-red-400', icon: 'text-red-400' },
    orange: { text: 'text-orange-400', icon: 'text-orange-400' },
  };
  const c = colorMap[color] || colorMap.amber;
  return (
    <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
      <div className="flex items-center gap-1.5 mb-3">
        <Icon className={`w-4 h-4 ${c.icon}`} />
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
