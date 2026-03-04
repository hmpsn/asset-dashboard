import { useState, useEffect, useRef } from 'react';
import {
  Loader2, Search, TrendingUp, TrendingDown, Eye, MousePointer,
  BarChart3, ExternalLink, Link2, Unplug, ArrowUpDown,
  Sparkles, Send, AlertTriangle, Target, Zap, Shield, MessageSquare, X,
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

interface GscSite {
  siteUrl: string;
  permissionLevel: string;
}

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface Props {
  siteId: string;
}

function MiniSparkline({ data, color }: { data: number[]; color: string }) {
  if (data.length < 2) return null;
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;
  const w = 120;
  const h = 32;
  const points = data.map((v, i) => {
    const x = (i / (data.length - 1)) * w;
    const y = h - ((v - min) / range) * (h - 4) - 2;
    return `${x},${y}`;
  }).join(' ');

  return (
    <svg width={w} height={h} className="flex-shrink-0">
      <polyline fill="none" stroke={color} strokeWidth="1.5" points={points} strokeLinejoin="round" />
    </svg>
  );
}

function TrendChart({ data, metric, color, height = 80 }: { data: PerformanceTrend[]; metric: keyof PerformanceTrend; color: string; height?: number }) {
  if (data.length < 2) return null;
  const values = data.map(d => d[metric] as number);
  const max = Math.max(...values);
  const min = Math.min(...values);
  const range = max - min || 1;
  const w = 100;

  const points = values.map((v, i) => {
    const x = (i / (values.length - 1)) * w;
    const y = 100 - ((v - min) / range) * 90 - 5;
    return `${x},${y}`;
  }).join(' ');

  const areaPoints = `0,100 ${points} ${w},100`;

  return (
    <svg viewBox={`0 0 ${w} 100`} className="w-full" style={{ height }} preserveAspectRatio="none">
      <defs>
        <linearGradient id={`grad-${metric}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.2" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon fill={`url(#grad-${metric})`} points={areaPoints} />
      <polyline fill="none" stroke={color} strokeWidth="1.5" points={points} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  );
}

// Simple markdown-ish renderer for AI chat responses
function RenderMarkdown({ text }: { text: string }) {
  const lines = text.split('\n');
  return (
    <div className="space-y-1.5">
      {lines.map((line, i) => {
        if (line.startsWith('### ')) return <h4 key={i} className="text-xs font-semibold text-zinc-200 mt-2">{line.slice(4)}</h4>;
        if (line.startsWith('## ')) return <h3 key={i} className="text-sm font-semibold text-zinc-200 mt-2">{line.slice(3)}</h3>;
        if (line.startsWith('# ')) return <h2 key={i} className="text-sm font-bold text-zinc-200 mt-2">{line.slice(2)}</h2>;
        if (line.startsWith('- **')) {
          const match = line.match(/^- \*\*(.+?)\*\*(.*)$/);
          if (match) return <div key={i} className="flex gap-1.5 text-[11px]"><span className="text-zinc-500 mt-0.5">•</span><span><strong className="text-zinc-200">{match[1]}</strong><span className="text-zinc-400">{match[2]}</span></span></div>;
        }
        if (line.startsWith('- ')) return <div key={i} className="flex gap-1.5 text-[11px] text-zinc-400"><span className="text-zinc-500 mt-0.5">•</span><span>{line.slice(2)}</span></div>;
        if (line.match(/^\d+\. /)) return <div key={i} className="text-[11px] text-zinc-400 ml-2">{line}</div>;
        if (line.trim() === '') return <div key={i} className="h-1" />;
        // Bold inline
        const boldParsed = line.replace(/\*\*(.+?)\*\*/g, '<b class="text-zinc-200">$1</b>');
        const codeParsed = boldParsed.replace(/`(.+?)`/g, '<code class="bg-zinc-800 px-1 rounded text-zinc-300 text-[10px]">$1</code>');
        return <p key={i} className="text-[11px] text-zinc-400 leading-relaxed" dangerouslySetInnerHTML={{ __html: codeParsed }} />;
      })}
    </div>
  );
}

type SortKey = 'clicks' | 'impressions' | 'ctr' | 'position';
type DataTab = 'queries' | 'pages' | 'insights';

const QUICK_QUESTIONS = [
  'What are my biggest SEO opportunities right now?',
  'Which pages should I optimize first for more traffic?',
  'Why is my CTR low and how can I improve it?',
  'What content should I create next based on search data?',
];

export function SearchConsole({ siteId }: Props) {
  const [status, setStatus] = useState<{ configured: boolean; connected: boolean } | null>(null);
  const [gscSites, setGscSites] = useState<GscSite[]>([]);
  const [selectedSite, setSelectedSite] = useState<string>('');
  const [overview, setOverview] = useState<SearchOverview | null>(null);
  const [trend, setTrend] = useState<PerformanceTrend[]>([]);
  const [loading, setLoading] = useState(true);
  const [dataLoading, setDataLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<DataTab>('queries');
  const [days, setDays] = useState(28);
  const [sortKey, setSortKey] = useState<SortKey>('clicks');
  const [sortAsc, setSortAsc] = useState(false);

  // AI Chat state
  const [chatOpen, setChatOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  // Check connection status on mount
  useEffect(() => {
    fetch(`/api/google/status/${siteId}`)
      .then(r => r.json())
      .then(d => {
        setStatus(d);
        if (d.connected) loadGscSites();
        else setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [siteId]);

  const loadGscSites = async () => {
    try {
      const res = await fetch(`/api/google/gsc-sites/${siteId}`);
      const sites = await res.json();
      if (Array.isArray(sites)) {
        setGscSites(sites);
        if (sites.length > 0) {
          setSelectedSite(sites[0].siteUrl);
          await loadData(sites[0].siteUrl);
        }
      } else if (sites.error) {
        setError(sites.error);
      }
    } catch {
      setError('Failed to load GSC sites');
    } finally {
      setLoading(false);
    }
  };

  const loadData = async (gscUrl?: string, d?: number) => {
    const siteUrl = gscUrl || selectedSite;
    const numDays = d || days;
    if (!siteUrl) return;
    setDataLoading(true);
    setError(null);
    try {
      const [overviewRes, trendRes] = await Promise.all([
        fetch(`/api/google/search-overview/${siteId}?gscSiteUrl=${encodeURIComponent(siteUrl)}&days=${numDays}`),
        fetch(`/api/google/performance-trend/${siteId}?gscSiteUrl=${encodeURIComponent(siteUrl)}&days=${numDays}`),
      ]);
      const [overviewData, trendData] = await Promise.all([overviewRes.json(), trendRes.json()]);
      if (overviewData.error) throw new Error(overviewData.error);
      setOverview(overviewData);
      setTrend(Array.isArray(trendData) ? trendData : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load data');
    } finally {
      setDataLoading(false);
    }
  };

  const connectGoogle = async () => {
    try {
      const res = await fetch(`/api/google/auth-url/${siteId}`);
      const data = await res.json();
      if (data.url) {
        window.open(data.url, '_blank', 'width=600,height=700');
      } else {
        setError(data.error || 'Could not get auth URL');
      }
    } catch {
      setError('Failed to start Google auth');
    }
  };

  const disconnectGoogle = async () => {
    await fetch(`/api/google/disconnect/${siteId}`, { method: 'POST' });
    setStatus({ configured: status?.configured || false, connected: false });
    setOverview(null);
    setTrend([]);
    setGscSites([]);
    setSelectedSite('');
  };

  const askAi = async (question: string) => {
    if (!question.trim() || !overview) return;
    const userMsg: ChatMessage = { role: 'user', content: question.trim() };
    setChatMessages(prev => [...prev, userMsg]);
    setChatInput('');
    setChatLoading(true);
    try {
      const context = {
        dateRange: overview.dateRange,
        days,
        totalClicks: overview.totalClicks,
        totalImpressions: overview.totalImpressions,
        avgCtr: overview.avgCtr,
        avgPosition: overview.avgPosition,
        topQueries: overview.topQueries,
        topPages: overview.topPages,
        trendSummary: trend.length > 1 ? {
          firstDay: trend[0],
          lastDay: trend[trend.length - 1],
          totalDays: trend.length,
        } : null,
      };
      const res = await fetch(`/api/google/search-chat/${siteId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: question.trim(), context }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setChatMessages(prev => [...prev, { role: 'assistant', content: data.answer }]);
    } catch {
      setChatMessages(prev => [...prev, { role: 'assistant', content: 'Sorry, I couldn\'t process that question. Please try again.' }]);
    } finally {
      setChatLoading(false);
    }
  };

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc(!sortAsc);
    else { setSortKey(key); setSortAsc(false); }
  };

  const sortQueries = (items: SearchQuery[]): SearchQuery[] => {
    return [...items].sort((a, b) => {
      const av = a[sortKey]; const bv = b[sortKey];
      return sortAsc ? (av as number) - (bv as number) : (bv as number) - (av as number);
    });
  };

  const sortPages = (items: SearchPage[]): SearchPage[] => {
    return [...items].sort((a, b) => {
      const av = a[sortKey]; const bv = b[sortKey];
      return sortAsc ? (av as number) - (bv as number) : (bv as number) - (av as number);
    });
  };

  // Compute insights from data
  const getInsights = () => {
    if (!overview) return { lowHanging: [], topPerformers: [], ctrOpps: [], highImpLowClick: [], brandedVsNon: { branded: 0, nonBranded: 0 } };

    const lowHanging = overview.topQueries.filter(q => q.position > 5 && q.position <= 20 && q.impressions > 30);
    const topPerformers = overview.topQueries.filter(q => q.position <= 3 && q.clicks > 5);
    const ctrOpps = overview.topQueries.filter(q => q.position <= 10 && q.ctr < 3 && q.impressions > 50);
    const highImpLowClick = overview.topQueries.filter(q => q.impressions > 100 && q.clicks < 5);

    // Try to detect branded queries (containing likely brand terms from the site URL)
    let brandTerms: string[] = [];
    try {
      const hostname = new URL(selectedSite).hostname.replace('www.', '').split('.')[0];
      brandTerms = [hostname.toLowerCase()];
    } catch { /* ignore */ }
    const branded = overview.topQueries.filter(q => brandTerms.some(b => q.query.toLowerCase().includes(b)));
    const nonBranded = overview.topQueries.filter(q => !brandTerms.some(b => q.query.toLowerCase().includes(b)));

    return { lowHanging, topPerformers, ctrOpps, highImpLowClick, brandedVsNon: { branded: branded.length, nonBranded: nonBranded.length } };
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-3 text-zinc-500">
        <Loader2 className="w-6 h-6 animate-spin" />
        <p className="text-sm">Checking Google connection...</p>
      </div>
    );
  }

  // Not connected state
  if (!status?.connected) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-5">
        <div className="w-16 h-16 rounded-2xl bg-zinc-900 flex items-center justify-center border border-zinc-800">
          <Search className="w-8 h-8 text-zinc-500" />
        </div>
        <div className="text-center max-w-md">
          <p className="text-sm font-medium text-zinc-300">Google Search Console</p>
          <p className="text-xs text-zinc-500 mt-1">
            Connect your Google account to see search queries, clicks, impressions, and ranking positions for your site.
          </p>
        </div>
        {!status?.configured ? (
          <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg px-4 py-3 max-w-sm text-center">
            <p className="text-xs text-amber-400 font-medium">Google OAuth not configured</p>
            <p className="text-[11px] text-amber-400/70 mt-1">
              Add <code className="bg-amber-500/20 px-1 rounded">GOOGLE_CLIENT_ID</code> and{' '}
              <code className="bg-amber-500/20 px-1 rounded">GOOGLE_CLIENT_SECRET</code> to your .env file.
            </p>
          </div>
        ) : (
          <button
            onClick={connectGoogle}
            className="flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium transition-colors"
            style={{ backgroundColor: 'var(--brand-mint)', color: '#0f1219' }}
          >
            <Link2 className="w-4 h-4" /> Connect Google Account
          </button>
        )}
        {error && (
          <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 px-3 py-2 rounded-lg max-w-sm">{error}</div>
        )}
      </div>
    );
  }

  const insights = overview ? getInsights() : null;

  return (
    <div className="space-y-5">
      {/* Top bar */}
      <div className="flex items-center gap-3">
        {gscSites.length > 1 ? (
          <select
            value={selectedSite}
            onChange={e => { setSelectedSite(e.target.value); loadData(e.target.value); }}
            className="px-3 py-2 bg-zinc-900 border border-zinc-800 rounded-lg text-sm focus:outline-none"
          >
            {gscSites.map(s => (
              <option key={s.siteUrl} value={s.siteUrl}>{s.siteUrl}</option>
            ))}
          </select>
        ) : gscSites.length === 1 ? (
          <div className="text-sm text-zinc-300 flex items-center gap-2">
            <Search className="w-4 h-4 text-zinc-500" />
            <span className="truncate">{selectedSite}</span>
          </div>
        ) : null}
        <div className="flex-1" />
        <button
          onClick={() => setChatOpen(!chatOpen)}
          className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
            chatOpen ? 'bg-violet-600 text-white' : 'bg-gradient-to-r from-violet-600/80 to-fuchsia-600/80 hover:from-violet-500 hover:to-fuchsia-500 text-white'
          }`}
        >
          <Sparkles className="w-3.5 h-3.5" /> Ask AI
        </button>
        <div className="flex items-center gap-1 bg-zinc-900 rounded-lg border border-zinc-800 p-0.5">
          {[7, 28, 90].map(d => (
            <button
              key={d}
              onClick={() => { setDays(d); loadData(undefined, d); }}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                days === d ? 'bg-zinc-700 text-zinc-200' : 'text-zinc-500 hover:text-zinc-300'
              }`}
            >
              {d}d
            </button>
          ))}
        </div>
        <button
          onClick={disconnectGoogle}
          className="flex items-center gap-1.5 px-3 py-2 bg-zinc-800 hover:bg-zinc-700 rounded-lg text-xs font-medium transition-colors text-zinc-400"
        >
          <Unplug className="w-3.5 h-3.5" /> Disconnect
        </button>
      </div>

      {error && (
        <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 px-3 py-2 rounded-lg">{error}</div>
      )}

      {dataLoading && (
        <div className="flex items-center justify-center py-12 gap-3 text-zinc-500">
          <Loader2 className="w-5 h-5 animate-spin" />
          <p className="text-sm">Loading search data...</p>
        </div>
      )}

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

          {/* Quick questions */}
          {chatMessages.length === 0 && (
            <div className="p-4 space-y-3">
              <p className="text-xs text-zinc-500">Ask anything about your search performance. Try one of these:</p>
              <div className="grid grid-cols-2 gap-2">
                {QUICK_QUESTIONS.map((q, i) => (
                  <button
                    key={i}
                    onClick={() => askAi(q)}
                    className="text-left px-3 py-2.5 rounded-lg bg-zinc-800/50 hover:bg-zinc-800 border border-zinc-800 text-[11px] text-zinc-300 transition-colors"
                  >
                    <MessageSquare className="w-3 h-3 text-violet-400 mb-1" />
                    {q}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Chat messages */}
          {chatMessages.length > 0 && (
            <div className="max-h-80 overflow-y-auto p-4 space-y-4">
              {chatMessages.map((msg, i) => (
                <div key={i} className={`flex gap-3 ${msg.role === 'user' ? 'justify-end' : ''}`}>
                  {msg.role === 'assistant' && (
                    <div className="w-6 h-6 rounded-lg bg-violet-500/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <Sparkles className="w-3 h-3 text-violet-400" />
                    </div>
                  )}
                  <div className={`max-w-[85%] rounded-xl px-3.5 py-2.5 ${
                    msg.role === 'user'
                      ? 'bg-violet-600/20 border border-violet-500/20 text-xs text-zinc-200'
                      : 'bg-zinc-800/50 border border-zinc-800'
                  }`}>
                    {msg.role === 'assistant' ? <RenderMarkdown text={msg.content} /> : msg.content}
                  </div>
                </div>
              ))}
              {chatLoading && (
                <div className="flex gap-3">
                  <div className="w-6 h-6 rounded-lg bg-violet-500/10 flex items-center justify-center flex-shrink-0">
                    <Loader2 className="w-3 h-3 text-violet-400 animate-spin" />
                  </div>
                  <div className="bg-zinc-800/50 border border-zinc-800 rounded-xl px-3.5 py-2.5">
                    <div className="flex gap-1">
                      <div className="w-1.5 h-1.5 rounded-full bg-zinc-500 animate-bounce" style={{ animationDelay: '0ms' }} />
                      <div className="w-1.5 h-1.5 rounded-full bg-zinc-500 animate-bounce" style={{ animationDelay: '150ms' }} />
                      <div className="w-1.5 h-1.5 rounded-full bg-zinc-500 animate-bounce" style={{ animationDelay: '300ms' }} />
                    </div>
                  </div>
                </div>
              )}
              <div ref={chatEndRef} />
            </div>
          )}

          {/* Chat input */}
          <div className="px-4 py-3 border-t border-zinc-800">
            <div className="flex gap-2">
              <input
                type="text"
                value={chatInput}
                onChange={e => setChatInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && !e.shiftKey && askAi(chatInput)}
                placeholder="Ask about your search data..."
                className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-xs text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-violet-500"
                disabled={chatLoading}
              />
              <button
                onClick={() => askAi(chatInput)}
                disabled={chatLoading || !chatInput.trim()}
                className="px-3 py-2 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 rounded-lg transition-colors"
              >
                <Send className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      )}

      {overview && !dataLoading && (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-4 gap-3">
            <div className="bg-zinc-900 rounded-xl p-4 border border-zinc-800">
              <div className="flex items-center justify-between mb-1">
                <MousePointer className="w-4 h-4 text-blue-400" />
                <MiniSparkline data={trend.map(t => t.clicks)} color="#60a5fa" />
              </div>
              <div className="text-2xl font-bold text-zinc-200">{overview.totalClicks.toLocaleString()}</div>
              <div className="text-[10px] text-zinc-500 mt-0.5">Total Clicks</div>
            </div>
            <div className="bg-zinc-900 rounded-xl p-4 border border-zinc-800">
              <div className="flex items-center justify-between mb-1">
                <Eye className="w-4 h-4 text-purple-400" />
                <MiniSparkline data={trend.map(t => t.impressions)} color="#a78bfa" />
              </div>
              <div className="text-2xl font-bold text-zinc-200">{overview.totalImpressions.toLocaleString()}</div>
              <div className="text-[10px] text-zinc-500 mt-0.5">Total Impressions</div>
            </div>
            <div className="bg-zinc-900 rounded-xl p-4 border border-zinc-800">
              <div className="flex items-center justify-between mb-1">
                <TrendingUp className="w-4 h-4 text-emerald-400" />
                <MiniSparkline data={trend.map(t => t.ctr)} color="#34d399" />
              </div>
              <div className="text-2xl font-bold text-zinc-200">{overview.avgCtr}%</div>
              <div className="text-[10px] text-zinc-500 mt-0.5">Avg CTR</div>
            </div>
            <div className="bg-zinc-900 rounded-xl p-4 border border-zinc-800">
              <div className="flex items-center justify-between mb-1">
                <BarChart3 className="w-4 h-4 text-amber-400" />
                <MiniSparkline data={trend.map(t => t.position)} color="#fbbf24" />
              </div>
              <div className="text-2xl font-bold text-zinc-200">{overview.avgPosition}</div>
              <div className="text-[10px] text-zinc-500 mt-0.5">Avg Position</div>
            </div>
          </div>

          {/* Trend chart */}
          {trend.length > 2 && (
            <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-medium text-zinc-400">Performance Trend</span>
                <span className="text-[10px] text-zinc-600">{overview.dateRange.start} — {overview.dateRange.end}</span>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="text-[10px] text-blue-400 mb-1">Clicks</div>
                  <TrendChart data={trend} metric="clicks" color="#60a5fa" />
                </div>
                <div>
                  <div className="text-[10px] text-purple-400 mb-1">Impressions</div>
                  <TrendChart data={trend} metric="impressions" color="#a78bfa" />
                </div>
              </div>
            </div>
          )}

          {/* Tab navigation */}
          <div className="flex items-center gap-0.5">
            {([
              { id: 'queries' as DataTab, label: 'Top Queries', icon: Search },
              { id: 'pages' as DataTab, label: 'Top Pages', icon: ExternalLink },
              { id: 'insights' as DataTab, label: 'Insights', icon: Zap },
            ]).map(t => {
              const Icon = t.icon;
              return (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-medium transition-colors ${
                    tab === t.id ? 'bg-zinc-800 text-zinc-200' : 'text-zinc-500 hover:text-zinc-300'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" /> {t.label}
                </button>
              );
            })}
          </div>

          {/* Insights tab */}
          {tab === 'insights' && insights && (
            <div className="space-y-3">
              {/* Branded vs Non-branded */}
              <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
                <div className="text-xs font-medium text-zinc-300 mb-3">Query Breakdown</div>
                <div className="flex items-center gap-4">
                  <div className="flex-1">
                    <div className="flex items-center justify-between text-[11px] mb-1.5">
                      <span className="text-zinc-400">Branded</span>
                      <span className="text-blue-400 font-medium">{insights.brandedVsNon.branded}</span>
                    </div>
                    <div className="h-2 bg-zinc-800 rounded-full overflow-hidden">
                      <div className="h-full bg-blue-500 rounded-full" style={{ width: `${overview.topQueries.length > 0 ? (insights.brandedVsNon.branded / overview.topQueries.length) * 100 : 0}%` }} />
                    </div>
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center justify-between text-[11px] mb-1.5">
                      <span className="text-zinc-400">Non-branded</span>
                      <span className="text-emerald-400 font-medium">{insights.brandedVsNon.nonBranded}</span>
                    </div>
                    <div className="h-2 bg-zinc-800 rounded-full overflow-hidden">
                      <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${overview.topQueries.length > 0 ? (insights.brandedVsNon.nonBranded / overview.topQueries.length) * 100 : 0}%` }} />
                    </div>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                {/* Low-hanging fruit */}
                {insights.lowHanging.length > 0 && (
                  <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
                    <div className="flex items-center gap-1.5 mb-3">
                      <Target className="w-4 h-4 text-amber-400" />
                      <span className="text-xs font-medium text-amber-400">Low-Hanging Fruit</span>
                      <span className="text-[10px] text-zinc-600 ml-auto">{insights.lowHanging.length} queries</span>
                    </div>
                    <p className="text-[10px] text-zinc-500 mb-2">Ranking 5-20 with impressions — small optimizations could push these to page 1</p>
                    <div className="space-y-1.5">
                      {insights.lowHanging.slice(0, 8).map((q, i) => (
                        <div key={i} className="flex items-center justify-between text-[11px] py-1 px-2 rounded bg-zinc-800/30">
                          <span className="text-zinc-300 truncate mr-2">{q.query}</span>
                          <div className="flex items-center gap-2 flex-shrink-0">
                            <span className="text-zinc-500">{q.impressions} imp</span>
                            <span className="text-amber-400 font-medium">#{q.position}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Top performers */}
                {insights.topPerformers.length > 0 && (
                  <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
                    <div className="flex items-center gap-1.5 mb-3">
                      <Shield className="w-4 h-4 text-green-400" />
                      <span className="text-xs font-medium text-green-400">Top Performers</span>
                      <span className="text-[10px] text-zinc-600 ml-auto">{insights.topPerformers.length} queries</span>
                    </div>
                    <p className="text-[10px] text-zinc-500 mb-2">Top 3 positions with real clicks — protect these rankings</p>
                    <div className="space-y-1.5">
                      {insights.topPerformers.slice(0, 8).map((q, i) => (
                        <div key={i} className="flex items-center justify-between text-[11px] py-1 px-2 rounded bg-zinc-800/30">
                          <span className="text-zinc-300 truncate mr-2">{q.query}</span>
                          <div className="flex items-center gap-2 flex-shrink-0">
                            <span className="text-blue-400">{q.clicks} clicks</span>
                            <span className="text-green-400 font-medium">#{q.position}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* CTR opportunities */}
                {insights.ctrOpps.length > 0 && (
                  <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
                    <div className="flex items-center gap-1.5 mb-3">
                      <TrendingDown className="w-4 h-4 text-red-400" />
                      <span className="text-xs font-medium text-red-400">CTR Opportunities</span>
                      <span className="text-[10px] text-zinc-600 ml-auto">{insights.ctrOpps.length} queries</span>
                    </div>
                    <p className="text-[10px] text-zinc-500 mb-2">Ranking on page 1 but CTR under 3% — improve titles & meta descriptions</p>
                    <div className="space-y-1.5">
                      {insights.ctrOpps.slice(0, 8).map((q, i) => (
                        <div key={i} className="flex items-center justify-between text-[11px] py-1 px-2 rounded bg-zinc-800/30">
                          <span className="text-zinc-300 truncate mr-2">{q.query}</span>
                          <div className="flex items-center gap-2 flex-shrink-0">
                            <span className="text-red-400">{q.ctr}% CTR</span>
                            <span className="text-zinc-500">#{q.position}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* High impressions, low clicks */}
                {insights.highImpLowClick.length > 0 && (
                  <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
                    <div className="flex items-center gap-1.5 mb-3">
                      <AlertTriangle className="w-4 h-4 text-orange-400" />
                      <span className="text-xs font-medium text-orange-400">Visibility Without Clicks</span>
                      <span className="text-[10px] text-zinc-600 ml-auto">{insights.highImpLowClick.length} queries</span>
                    </div>
                    <p className="text-[10px] text-zinc-500 mb-2">100+ impressions but under 5 clicks — being seen but not clicked</p>
                    <div className="space-y-1.5">
                      {insights.highImpLowClick.slice(0, 8).map((q, i) => (
                        <div key={i} className="flex items-center justify-between text-[11px] py-1 px-2 rounded bg-zinc-800/30">
                          <span className="text-zinc-300 truncate mr-2">{q.query}</span>
                          <div className="flex items-center gap-2 flex-shrink-0">
                            <span className="text-purple-400">{q.impressions} imp</span>
                            <span className="text-orange-400">{q.clicks} clicks</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Score-style summary */}
              <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
                <div className="text-xs font-medium text-zinc-300 mb-3">Search Health Summary</div>
                <div className="grid grid-cols-4 gap-3">
                  <div className="text-center">
                    <div className={`text-lg font-bold ${overview.topQueries.filter(q => q.position <= 10).length > 5 ? 'text-green-400' : 'text-amber-400'}`}>
                      {overview.topQueries.filter(q => q.position <= 10).length}
                    </div>
                    <div className="text-[10px] text-zinc-500">Page 1 Rankings</div>
                  </div>
                  <div className="text-center">
                    <div className={`text-lg font-bold ${overview.topQueries.filter(q => q.position <= 3).length > 2 ? 'text-green-400' : 'text-amber-400'}`}>
                      {overview.topQueries.filter(q => q.position <= 3).length}
                    </div>
                    <div className="text-[10px] text-zinc-500">Top 3 Rankings</div>
                  </div>
                  <div className="text-center">
                    <div className={`text-lg font-bold ${overview.avgCtr > 3 ? 'text-green-400' : overview.avgCtr > 1.5 ? 'text-amber-400' : 'text-red-400'}`}>
                      {overview.avgCtr}%
                    </div>
                    <div className="text-[10px] text-zinc-500">Avg CTR</div>
                  </div>
                  <div className="text-center">
                    <div className={`text-lg font-bold ${insights.lowHanging.length > 0 ? 'text-amber-400' : 'text-green-400'}`}>
                      {insights.lowHanging.length}
                    </div>
                    <div className="text-[10px] text-zinc-500">Opportunities</div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Data tables */}
          {(tab === 'queries' || tab === 'pages') && (
            <div className="bg-zinc-900 rounded-xl border border-zinc-800 overflow-hidden">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-zinc-800">
                    <th className="text-left py-3 px-4 text-zinc-500 font-medium">
                      {tab === 'queries' ? 'Query' : 'Page'}
                    </th>
                    {(['clicks', 'impressions', 'ctr', 'position'] as SortKey[]).map(key => (
                      <th key={key} className="text-right py-3 px-3 text-zinc-500 font-medium">
                        <button
                          onClick={() => handleSort(key)}
                          className="flex items-center gap-1 ml-auto hover:text-zinc-300 transition-colors"
                        >
                          {key === 'ctr' ? 'CTR' : key.charAt(0).toUpperCase() + key.slice(1)}
                          {sortKey === key && <ArrowUpDown className="w-3 h-3" />}
                        </button>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {tab === 'queries' && sortQueries(overview.topQueries).map((q, i) => (
                    <tr key={i} className="border-b border-zinc-800/50 hover:bg-zinc-800/30">
                      <td className="py-2.5 px-4 text-zinc-300 font-medium">{q.query}</td>
                      <td className="py-2.5 px-3 text-right text-blue-400 font-semibold">{q.clicks}</td>
                      <td className="py-2.5 px-3 text-right text-zinc-400">{q.impressions.toLocaleString()}</td>
                      <td className="py-2.5 px-3 text-right text-emerald-400">{q.ctr}%</td>
                      <td className="py-2.5 px-3 text-right">
                        <span className={q.position <= 10 ? 'text-green-400' : q.position <= 20 ? 'text-amber-400' : 'text-red-400'}>
                          {q.position}
                        </span>
                      </td>
                    </tr>
                  ))}
                  {tab === 'pages' && sortPages(overview.topPages).map((p, i) => {
                    let pagePath: string;
                    try { pagePath = new URL(p.page).pathname; } catch { pagePath = p.page; }
                    return (
                      <tr key={i} className="border-b border-zinc-800/50 hover:bg-zinc-800/30">
                        <td className="py-2.5 px-4 text-zinc-300 font-medium max-w-xs truncate">
                          <a href={p.page} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 hover:text-blue-400 transition-colors">
                            {pagePath}
                            <ExternalLink className="w-3 h-3 flex-shrink-0 text-zinc-600" />
                          </a>
                        </td>
                        <td className="py-2.5 px-3 text-right text-blue-400 font-semibold">{p.clicks}</td>
                        <td className="py-2.5 px-3 text-right text-zinc-400">{p.impressions.toLocaleString()}</td>
                        <td className="py-2.5 px-3 text-right text-emerald-400">{p.ctr}%</td>
                        <td className="py-2.5 px-3 text-right">
                          <span className={p.position <= 10 ? 'text-green-400' : p.position <= 20 ? 'text-amber-400' : 'text-red-400'}>
                            {p.position}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
