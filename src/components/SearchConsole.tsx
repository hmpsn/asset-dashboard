import { useState, useEffect } from 'react';
import {
  Loader2, Search, TrendingUp, TrendingDown, Eye, MousePointer,
  BarChart3, ExternalLink, Link2, Unplug, ArrowUpDown,
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
      <polyline
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        points={points}
        strokeLinejoin="round"
      />
    </svg>
  );
}

type SortKey = 'clicks' | 'impressions' | 'ctr' | 'position';

export function SearchConsole({ siteId }: Props) {
  const [status, setStatus] = useState<{ configured: boolean; connected: boolean } | null>(null);
  const [gscSites, setGscSites] = useState<GscSite[]>([]);
  const [selectedSite, setSelectedSite] = useState<string>('');
  const [overview, setOverview] = useState<SearchOverview | null>(null);
  const [trend, setTrend] = useState<PerformanceTrend[]>([]);
  const [loading, setLoading] = useState(true);
  const [dataLoading, setDataLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<'queries' | 'pages'>('queries');
  const [days, setDays] = useState(28);
  const [sortKey, setSortKey] = useState<SortKey>('clicks');
  const [sortAsc, setSortAsc] = useState(false);

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

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc(!sortAsc);
    else { setSortKey(key); setSortAsc(false); }
  };

  const sortQueries = (items: SearchQuery[]): SearchQuery[] => {
    return [...items].sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      return sortAsc ? (av as number) - (bv as number) : (bv as number) - (av as number);
    });
  };

  const sortPages = (items: SearchPage[]): SearchPage[] => {
    return [...items].sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      return sortAsc ? (av as number) - (bv as number) : (bv as number) - (av as number);
    });
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

  return (
    <div className="space-y-5">
      {/* Top bar: site selector + date range + disconnect */}
      <div className="flex items-center gap-3">
        {gscSites.length > 1 && (
          <select
            value={selectedSite}
            onChange={e => { setSelectedSite(e.target.value); loadData(e.target.value); }}
            className="px-3 py-2 bg-zinc-900 border border-zinc-800 rounded-lg text-sm focus:outline-none"
          >
            {gscSites.map(s => (
              <option key={s.siteUrl} value={s.siteUrl}>{s.siteUrl}</option>
            ))}
          </select>
        )}
        {gscSites.length === 1 && (
          <div className="text-sm text-zinc-300 flex items-center gap-2">
            <Search className="w-4 h-4 text-zinc-500" />
            <span className="truncate">{selectedSite}</span>
          </div>
        )}
        <div className="flex-1" />
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

          {/* Date range */}
          <div className="text-[10px] text-zinc-600 text-center">
            {overview.dateRange.start} — {overview.dateRange.end}
          </div>

          {/* Queries / Pages tabs */}
          <div className="flex items-center gap-0.5 mb-1">
            <button
              onClick={() => setTab('queries')}
              className={`px-4 py-2 rounded-lg text-xs font-medium transition-colors ${
                tab === 'queries' ? 'bg-zinc-800 text-zinc-200' : 'text-zinc-500 hover:text-zinc-300'
              }`}
            >
              Top Queries
            </button>
            <button
              onClick={() => setTab('pages')}
              className={`px-4 py-2 rounded-lg text-xs font-medium transition-colors ${
                tab === 'pages' ? 'bg-zinc-800 text-zinc-200' : 'text-zinc-500 hover:text-zinc-300'
              }`}
            >
              Top Pages
            </button>
          </div>

          {/* Data table */}
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

          {/* Quick insights */}
          {overview.topQueries.length > 0 && (
            <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4 space-y-3">
              <div className="text-sm font-medium text-zinc-300">Quick Insights</div>
              <div className="grid grid-cols-2 gap-3">
                {(() => {
                  const lowHanging = overview.topQueries.filter(q => q.position > 5 && q.position <= 15 && q.impressions > 50);
                  if (lowHanging.length === 0) return null;
                  return (
                    <div className="bg-zinc-950/50 rounded-lg p-3">
                      <div className="flex items-center gap-1.5 mb-2">
                        <TrendingUp className="w-3.5 h-3.5 text-amber-400" />
                        <span className="text-xs font-medium text-amber-400">Low-Hanging Fruit</span>
                      </div>
                      <p className="text-[11px] text-zinc-400 mb-2">
                        Queries ranking 5-15 with decent impressions — small improvements could push these to page 1:
                      </p>
                      <div className="space-y-1">
                        {lowHanging.slice(0, 5).map((q, i) => (
                          <div key={i} className="flex items-center justify-between text-[11px]">
                            <span className="text-zinc-300 truncate mr-2">{q.query}</span>
                            <span className="text-amber-400 flex-shrink-0">pos {q.position}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })()}
                {(() => {
                  const highCtr = overview.topQueries.filter(q => q.ctr > 5 && q.position <= 3);
                  if (highCtr.length === 0) return null;
                  return (
                    <div className="bg-zinc-950/50 rounded-lg p-3">
                      <div className="flex items-center gap-1.5 mb-2">
                        <TrendingDown className="w-3.5 h-3.5 text-green-400" />
                        <span className="text-xs font-medium text-green-400">Top Performers</span>
                      </div>
                      <p className="text-[11px] text-zinc-400 mb-2">
                        Queries you're dominating — protect these rankings:
                      </p>
                      <div className="space-y-1">
                        {highCtr.slice(0, 5).map((q, i) => (
                          <div key={i} className="flex items-center justify-between text-[11px]">
                            <span className="text-zinc-300 truncate mr-2">{q.query}</span>
                            <span className="text-green-400 flex-shrink-0">{q.ctr}% CTR</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })()}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
