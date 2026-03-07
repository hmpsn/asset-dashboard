import { useState, useEffect, useRef } from 'react';
import {
  Loader2, Search, TrendingUp, TrendingDown, Eye, MousePointer,
  BarChart3, ExternalLink, ArrowUpDown,
  Sparkles, Send, AlertTriangle, Target, Zap, Shield, MessageSquare, X,
} from 'lucide-react';
import { ChartPointDetail } from './ChartPointDetail';
import { PageHeader, StatCard, SectionCard, TabBar, DateRangeSelector, EmptyState } from './ui';
import { DATE_PRESETS_SEARCH } from './ui/constants';

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

interface DeviceBreakdown {
  device: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

interface CountryBreakdown {
  country: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

interface SearchTypeBreakdown {
  searchType: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

interface PeriodComparison {
  current: { clicks: number; impressions: number; ctr: number; position: number };
  previous: { clicks: number; impressions: number; ctr: number; position: number };
  change: { clicks: number; impressions: number; ctr: number; position: number };
  changePercent: { clicks: number; impressions: number; ctr: number; position: number };
}

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface Props {
  siteId: string;
  gscPropertyUrl?: string;
}

function TrendChart({ data, metric, color, height = 80 }: { data: PerformanceTrend[]; metric: keyof PerformanceTrend; color: string; height?: number }) {
  const [selected, setSelected] = useState<number | null>(null);
  if (data.length < 2) return null;
  const values = data.map(d => d[metric] as number);
  const max = Math.max(...values);
  const min = Math.min(...values);
  const range = max - min || 1;
  const w = 100;

  const pointCoords = values.map((v, i) => ({
    x: (i / (values.length - 1)) * w,
    y: 100 - ((v - min) / range) * 90 - 5,
  }));
  const points = pointCoords.map(p => `${p.x},${p.y}`).join(' ');
  const areaPoints = `0,100 ${points} ${w},100`;
  const bandW = w / data.length;

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${w} 100`} className="w-full" style={{ height }} preserveAspectRatio="none">
        <defs>
          <linearGradient id={`grad-${metric}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.2" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        <polygon fill={`url(#grad-${metric})`} points={areaPoints} />
        <polyline fill="none" stroke={color} strokeWidth="1.5" points={points} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
        {/* Clickable hit areas */}
        {pointCoords.map((p, i) => (
          <rect key={i} x={p.x - bandW / 2} y={0} width={bandW} height={100} fill="transparent" className="cursor-pointer" onClick={() => setSelected(selected === i ? null : i)} />
        ))}
        {/* Selected point indicator */}
        {selected !== null && pointCoords[selected] && (
          <>
            <line x1={pointCoords[selected].x} y1={0} x2={pointCoords[selected].x} y2={100} stroke={color} strokeWidth="0.5" strokeDasharray="2,1.5" opacity="0.6" vectorEffect="non-scaling-stroke" />
            <circle cx={pointCoords[selected].x} cy={pointCoords[selected].y} r="3" fill={color} stroke="#18181b" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
          </>
        )}
      </svg>
      {selected !== null && data[selected] && (
        <ChartPointDetail
          date={data[selected].date}
          xPct={(selected / (data.length - 1)) * 100}
          onClose={() => setSelected(null)}
          metrics={[
            { label: 'Clicks', value: data[selected].clicks, color: '#60a5fa' },
            { label: 'Impressions', value: data[selected].impressions, color: '#22d3ee' },
            { label: 'CTR', value: `${data[selected].ctr}%`, color: '#34d399' },
            { label: 'Position', value: data[selected].position, color: '#fbbf24' },
          ]}
        />
      )}
    </div>
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
        const codeParsed = boldParsed.replace(/`(.+?)`/g, '<code class="bg-zinc-800 px-1 rounded text-zinc-300 text-[11px]">$1</code>');
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

export function SearchConsole({ siteId, gscPropertyUrl }: Props) {
  const [overview, setOverview] = useState<SearchOverview | null>(null);
  const [trend, setTrend] = useState<PerformanceTrend[]>([]);
  const [devices, setDevices] = useState<DeviceBreakdown[]>([]);
  const [countries, setCountries] = useState<CountryBreakdown[]>([]);
  const [searchTypes, setSearchTypes] = useState<SearchTypeBreakdown[]>([]);
  const [comparison, setComparison] = useState<PeriodComparison | null>(null);
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

  // Load data when gscPropertyUrl is available
  useEffect(() => {
    if (gscPropertyUrl) {
      loadData(gscPropertyUrl);
    }
  }, [siteId, gscPropertyUrl]);

  const loadData = async (gscUrl?: string, d?: number) => {
    const siteUrl = gscUrl || gscPropertyUrl;
    const numDays = d || days;
    if (!siteUrl) return;
    setDataLoading(true);
    setError(null);
    const qs = `gscSiteUrl=${encodeURIComponent(siteUrl)}&days=${numDays}`;
    try {
      const [overviewRes, trendRes, devicesRes, countriesRes, typesRes, compRes] = await Promise.all([
        fetch(`/api/google/search-overview/${siteId}?${qs}`),
        fetch(`/api/google/performance-trend/${siteId}?${qs}`),
        fetch(`/api/google/search-devices/${siteId}?${qs}`).catch(() => null),
        fetch(`/api/google/search-countries/${siteId}?${qs}`).catch(() => null),
        fetch(`/api/google/search-types/${siteId}?${qs}`).catch(() => null),
        fetch(`/api/google/search-comparison/${siteId}?${qs}`).catch(() => null),
      ]);
      const [overviewData, trendData] = await Promise.all([overviewRes.json(), trendRes.json()]);
      if (overviewData.error) throw new Error(overviewData.error);
      setOverview(overviewData);
      setTrend(Array.isArray(trendData) ? trendData : []);
      // Non-critical data — parse if available
      if (devicesRes) try { const d = await devicesRes.json(); if (Array.isArray(d)) setDevices(d); } catch { /* */ }
      if (countriesRes) try { const d = await countriesRes.json(); if (Array.isArray(d)) setCountries(d); } catch { /* */ }
      if (typesRes) try { const d = await typesRes.json(); if (Array.isArray(d)) setSearchTypes(d); } catch { /* */ }
      if (compRes) try { const d = await compRes.json(); if (d && !d.error) setComparison(d); } catch { /* */ }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load data');
    } finally {
      setDataLoading(false);
    }
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
        devices: devices.length > 0 ? devices : undefined,
        countries: countries.length > 0 ? countries.slice(0, 5) : undefined,
        searchTypes: searchTypes.length > 0 ? searchTypes : undefined,
        periodComparison: comparison || undefined,
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
      const hostname = new URL(gscPropertyUrl || '').hostname.replace('www.', '').split('.')[0];
      brandTerms = [hostname.toLowerCase()];
    } catch { /* ignore */ }
    const branded = overview.topQueries.filter(q => brandTerms.some(b => q.query.toLowerCase().includes(b)));
    const nonBranded = overview.topQueries.filter(q => !brandTerms.some(b => q.query.toLowerCase().includes(b)));

    return { lowHanging, topPerformers, ctrOpps, highImpLowClick, brandedVsNon: { branded: branded.length, nonBranded: nonBranded.length } };
  };

  // Not configured state
  if (!gscPropertyUrl) {
    return (
      <EmptyState
        icon={Search}
        title="Search Console not configured"
        description="Select a Search Console property in the workspace settings (gear icon) to view search data."
      />
    );
  }

  const insights = overview ? getInsights() : null;

  return (
    <div className="space-y-5">
      {/* Top bar */}
      <PageHeader
        title="Search Console"
        subtitle={gscPropertyUrl}
        icon={<Search className="w-4 h-4 text-zinc-500" />}
        actions={<>
          <button
            onClick={() => setChatOpen(!chatOpen)}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
              chatOpen ? 'bg-teal-600 text-white' : 'bg-gradient-to-r from-teal-600 to-emerald-600 hover:from-teal-500 hover:to-emerald-500 text-white'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5" /> Ask AI
          </button>
          <DateRangeSelector
            options={DATE_PRESETS_SEARCH}
            selected={days}
            onChange={d => { setDays(d); loadData(undefined, d); }}
          />
        </>}
      />

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
              <Sparkles className="w-4 h-4 text-teal-400" />
              <span className="text-sm font-medium text-zinc-200">SEO AI Assistant</span>
              <span className="text-[11px] text-zinc-500 bg-zinc-800 px-1.5 py-0.5 rounded">GPT-4o</span>
            </div>
            <button onClick={() => setChatOpen(false)} className="text-zinc-500 hover:text-zinc-300" aria-label="Close chat"><X className="w-4 h-4" /></button>
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
                    <MessageSquare className="w-3 h-3 text-teal-400 mb-1" />
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
                    <div className="w-6 h-6 rounded-lg bg-teal-500/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <Sparkles className="w-3 h-3 text-teal-400" />
                    </div>
                  )}
                  <div className={`max-w-[85%] rounded-xl px-3.5 py-2.5 ${
                    msg.role === 'user'
                      ? 'bg-teal-600/20 border border-teal-500/20 text-xs text-zinc-200'
                      : 'bg-zinc-800/50 border border-zinc-800'
                  }`}>
                    {msg.role === 'assistant' ? <RenderMarkdown text={msg.content} /> : msg.content}
                  </div>
                </div>
              ))}
              {chatLoading && (
                <div className="flex gap-3">
                  <div className="w-6 h-6 rounded-lg bg-teal-500/10 flex items-center justify-center flex-shrink-0">
                    <Loader2 className="w-3 h-3 text-teal-400 animate-spin" />
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
                className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-xs text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-teal-500"
                disabled={chatLoading}
              />
              <button
                onClick={() => askAi(chatInput)}
                disabled={chatLoading || !chatInput.trim()}
                className="px-3 py-2 bg-teal-600 hover:bg-teal-500 disabled:opacity-50 rounded-lg transition-colors"
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
            <StatCard label="Total Clicks" value={overview.totalClicks.toLocaleString()} icon={MousePointer} iconColor="#60a5fa" sparklineData={trend.map(t => t.clicks)} sparklineColor="#60a5fa" />
            <StatCard label="Total Impressions" value={overview.totalImpressions.toLocaleString()} icon={Eye} iconColor="#22d3ee" sparklineData={trend.map(t => t.impressions)} sparklineColor="#22d3ee" />
            <StatCard label="Avg CTR" value={`${overview.avgCtr}%`} icon={TrendingUp} iconColor="#34d399" sparklineData={trend.map(t => t.ctr)} sparklineColor="#34d399" />
            <StatCard label="Avg Position" value={overview.avgPosition} icon={BarChart3} iconColor="#fbbf24" sparklineData={trend.map(t => t.position)} sparklineColor="#fbbf24" />
          </div>

          {/* Period comparison banner */}
          {comparison && (
            <SectionCard title={`vs Previous ${days} Days`} titleIcon={<TrendingUp className="w-4 h-4 text-zinc-500" />}>
              <div className="grid grid-cols-4 gap-4">
                {([
                  { label: 'Clicks', key: 'clicks' as const, color: 'blue' },
                  { label: 'Impressions', key: 'impressions' as const, color: 'cyan' },
                  { label: 'CTR', key: 'ctr' as const, color: 'emerald', suffix: '%' },
                  { label: 'Position', key: 'position' as const, color: 'amber', invert: true },
                ]).map(m => {
                  const pct = comparison.changePercent[m.key];
                  const abs = comparison.change[m.key];
                  const isPositive = m.invert ? abs < 0 : abs > 0;
                  const isNeutral = abs === 0;
                  return (
                    <div key={m.key} className="text-center">
                      <div className="text-[11px] text-zinc-500 mb-1">{m.label}</div>
                      <div className="text-sm font-semibold text-zinc-200">
                        {m.suffix ? `${comparison.current[m.key]}${m.suffix}` : comparison.current[m.key].toLocaleString()}
                      </div>
                      <div className={`text-[11px] font-medium mt-0.5 ${isNeutral ? 'text-zinc-500' : isPositive ? 'text-emerald-400' : 'text-red-400'}`}>
                        {abs >= 0 && !m.invert ? '+' : ''}{m.suffix ? abs.toFixed(1) + m.suffix : abs.toLocaleString()}
                        {' '}({pct >= 0 ? '+' : ''}{pct}%)
                      </div>
                    </div>
                  );
                })}
              </div>
            </SectionCard>
          )}

          {/* Trend chart */}
          {trend.length > 2 && (
            <SectionCard
              title="Performance Trend"
              action={<span className="text-[11px] text-zinc-500">{overview.dateRange.start} — {overview.dateRange.end}</span>}
            >
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="text-[11px] text-blue-400 mb-1">Clicks</div>
                  <TrendChart data={trend} metric="clicks" color="#60a5fa" />
                </div>
                <div>
                  <div className="text-[11px] text-cyan-400 mb-1">Impressions</div>
                  <TrendChart data={trend} metric="impressions" color="#22d3ee" />
                </div>
              </div>
            </SectionCard>
          )}

          {/* Device + Country + Search Type breakdowns */}
          {(devices.length > 0 || countries.length > 0 || searchTypes.length > 0) && (
            <div className="grid grid-cols-3 gap-3">
              {/* Device breakdown */}
              {devices.length > 0 && (
                <SectionCard title="Devices">
                  <div className="space-y-2.5">
                    {devices.map(d => {
                      const totalClicks = devices.reduce((s, x) => s + x.clicks, 0);
                      const pct = totalClicks > 0 ? ((d.clicks / totalClicks) * 100).toFixed(0) : '0';
                      return (
                        <div key={d.device}>
                          <div className="flex items-center justify-between text-[11px] mb-1">
                            <span className="text-zinc-300 capitalize">{d.device.toLowerCase()}</span>
                            <span className="text-zinc-500">{pct}% · pos {d.position}</span>
                          </div>
                          <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                            <div className="h-full bg-blue-500 rounded-full transition-all" style={{ width: `${pct}%` }} />
                          </div>
                          <div className="flex items-center justify-between text-[10px] text-zinc-600 mt-0.5">
                            <span>{d.clicks.toLocaleString()} clicks</span>
                            <span>{d.ctr}% CTR</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </SectionCard>
              )}

              {/* Country breakdown */}
              {countries.length > 0 && (
                <SectionCard title="Top Countries">
                  <div className="space-y-1.5">
                    {countries.slice(0, 8).map((c, i) => (
                      <div key={c.country} className="flex items-center justify-between text-[11px] py-1 px-2 rounded bg-zinc-800/30">
                        <div className="flex items-center gap-2">
                          <span className="text-zinc-600 w-3 text-right">{i + 1}</span>
                          <span className="text-zinc-300">{c.country}</span>
                        </div>
                        <div className="flex items-center gap-3 text-zinc-500">
                          <span>{c.clicks.toLocaleString()} clicks</span>
                          <span className="text-zinc-600">pos {c.position}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </SectionCard>
              )}

              {/* Search type breakdown */}
              {searchTypes.length > 0 && (
                <SectionCard title="Search Types">
                  <div className="space-y-2.5">
                    {searchTypes.map(st => {
                      const totalClicks = searchTypes.reduce((s, x) => s + x.clicks, 0);
                      const pct = totalClicks > 0 ? ((st.clicks / totalClicks) * 100).toFixed(0) : '0';
                      return (
                        <div key={st.searchType}>
                          <div className="flex items-center justify-between text-[11px] mb-1">
                            <span className="text-zinc-300 capitalize">{st.searchType}</span>
                            <span className="text-zinc-500">{pct}%</span>
                          </div>
                          <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                            <div className="h-full bg-teal-500 rounded-full transition-all" style={{ width: `${pct}%` }} />
                          </div>
                          <div className="flex items-center justify-between text-[10px] text-zinc-600 mt-0.5">
                            <span>{st.clicks.toLocaleString()} clicks · {st.impressions.toLocaleString()} imp</span>
                            <span>pos {st.position}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </SectionCard>
              )}
            </div>
          )}

          {/* Tab navigation */}
          <TabBar
            tabs={[
              { id: 'queries', label: 'Top Queries', icon: Search },
              { id: 'pages', label: 'Top Pages', icon: ExternalLink },
              { id: 'insights', label: 'Insights', icon: Zap },
            ]}
            active={tab}
            onChange={id => setTab(id as DataTab)}
          />

          {/* Insights tab */}
          {tab === 'insights' && insights && (
            <div className="space-y-3">
              {/* Branded vs Non-branded */}
              <SectionCard title="Query Breakdown">
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
              </SectionCard>

              <div className="grid grid-cols-2 gap-3">
                {/* Low-hanging fruit */}
                {insights.lowHanging.length > 0 && (
                  <SectionCard title="Low-Hanging Fruit" titleIcon={<Target className="w-4 h-4 text-amber-400" />} titleExtra={<span className="text-[11px] text-zinc-500">{insights.lowHanging.length} queries</span>}>
                    <p className="text-[11px] text-zinc-500 mb-2">Ranking 5-20 with impressions — small optimizations could push these to page 1</p>
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
                  </SectionCard>
                )}

                {/* Top performers */}
                {insights.topPerformers.length > 0 && (
                  <SectionCard title="Top Performers" titleIcon={<Shield className="w-4 h-4 text-green-400" />} titleExtra={<span className="text-[11px] text-zinc-500">{insights.topPerformers.length} queries</span>}>
                    <p className="text-[11px] text-zinc-500 mb-2">Top 3 positions with real clicks — protect these rankings</p>
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
                  </SectionCard>
                )}

                {/* CTR opportunities */}
                {insights.ctrOpps.length > 0 && (
                  <SectionCard title="CTR Opportunities" titleIcon={<TrendingDown className="w-4 h-4 text-red-400" />} titleExtra={<span className="text-[11px] text-zinc-500">{insights.ctrOpps.length} queries</span>}>
                    <p className="text-[11px] text-zinc-500 mb-2">Ranking on page 1 but CTR under 3% — improve titles & meta descriptions</p>
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
                  </SectionCard>
                )}

                {/* High impressions, low clicks */}
                {insights.highImpLowClick.length > 0 && (
                  <SectionCard title="Visibility Without Clicks" titleIcon={<AlertTriangle className="w-4 h-4 text-orange-400" />} titleExtra={<span className="text-[11px] text-zinc-500">{insights.highImpLowClick.length} queries</span>}>
                    <p className="text-[11px] text-zinc-500 mb-2">100+ impressions but under 5 clicks — being seen but not clicked</p>
                    <div className="space-y-1.5">
                      {insights.highImpLowClick.slice(0, 8).map((q, i) => (
                        <div key={i} className="flex items-center justify-between text-[11px] py-1 px-2 rounded bg-zinc-800/30">
                          <span className="text-zinc-300 truncate mr-2">{q.query}</span>
                          <div className="flex items-center gap-2 flex-shrink-0">
                            <span className="text-cyan-400">{q.impressions} imp</span>
                            <span className="text-orange-400">{q.clicks} clicks</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </SectionCard>
                )}
              </div>

              {/* Score-style summary */}
              <SectionCard title="Search Health Summary">
                <div className="grid grid-cols-4 gap-3">
                  <div className="text-center">
                    <div className={`text-lg font-bold ${overview.topQueries.filter(q => q.position <= 10).length > 5 ? 'text-green-400' : 'text-amber-400'}`}>
                      {overview.topQueries.filter(q => q.position <= 10).length}
                    </div>
                    <div className="text-[11px] text-zinc-500">Page 1 Rankings</div>
                  </div>
                  <div className="text-center">
                    <div className={`text-lg font-bold ${overview.topQueries.filter(q => q.position <= 3).length > 2 ? 'text-green-400' : 'text-amber-400'}`}>
                      {overview.topQueries.filter(q => q.position <= 3).length}
                    </div>
                    <div className="text-[11px] text-zinc-500">Top 3 Rankings</div>
                  </div>
                  <div className="text-center">
                    <div className={`text-lg font-bold ${overview.avgCtr > 3 ? 'text-green-400' : overview.avgCtr > 1.5 ? 'text-amber-400' : 'text-red-400'}`}>
                      {overview.avgCtr}%
                    </div>
                    <div className="text-[11px] text-zinc-500">Avg CTR</div>
                  </div>
                  <div className="text-center">
                    <div className={`text-lg font-bold ${insights.lowHanging.length > 0 ? 'text-amber-400' : 'text-green-400'}`}>
                      {insights.lowHanging.length}
                    </div>
                    <div className="text-[11px] text-zinc-500">Opportunities</div>
                  </div>
                </div>
              </SectionCard>

              {/* Cross-link tips */}
              <div className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-zinc-900/50 border border-zinc-800 flex-wrap">
                <span className="text-[11px] text-zinc-500 font-medium uppercase tracking-wider mr-1">Next steps →</span>
                {insights.lowHanging.length > 0 && (
                  <span className="flex items-center gap-1 text-[11px] text-teal-400/80 bg-teal-500/5 px-2 py-1 rounded border border-teal-500/10">
                    <Target className="w-3 h-3" /> Build a <strong className="text-teal-400">Keyword Strategy</strong> to organize these opportunities
                  </span>
                )}
                {insights.ctrOpps.length > 0 && (
                  <span className="flex items-center gap-1 text-[11px] text-teal-400/80 bg-teal-500/5 px-2 py-1 rounded border border-teal-500/10">
                    <Zap className="w-3 h-3" /> Improve CTR by rewriting titles in the <strong className="text-teal-400">SEO Editor</strong>
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Data tables */}
          {(tab === 'queries' || tab === 'pages') && (
            <SectionCard noPadding>
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
                            <ExternalLink className="w-3 h-3 flex-shrink-0 text-zinc-500" />
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
            </SectionCard>
          )}
        </>
      )}

    </div>
  );
}
