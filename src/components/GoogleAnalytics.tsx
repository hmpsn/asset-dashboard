import { useState, useEffect, useCallback } from 'react';
import {
  Loader2, Users, Eye, Clock, ArrowUpDown, Globe, Monitor, Smartphone, Tablet,
  TrendingUp, TrendingDown, BarChart3,
} from 'lucide-react';

interface GA4Overview {
  totalUsers: number;
  totalSessions: number;
  totalPageviews: number;
  avgSessionDuration: number;
  bounceRate: number;
  newUserPercentage: number;
  dateRange: { start: string; end: string };
}

interface GA4DailyTrend {
  date: string;
  users: number;
  sessions: number;
  pageviews: number;
}

interface GA4TopPage {
  path: string;
  pageviews: number;
  users: number;
  avgEngagementTime: number;
}

interface GA4TopSource {
  source: string;
  medium: string;
  users: number;
  sessions: number;
}

interface GA4DeviceBreakdown {
  device: string;
  users: number;
  sessions: number;
  percentage: number;
}

interface GA4CountryBreakdown {
  country: string;
  users: number;
  sessions: number;
}

interface Props {
  workspaceId: string;
  ga4PropertyId?: string;
}

// ── Mini trend chart (SVG) ──
function TrendChart({ data, dataKey, color }: { data: GA4DailyTrend[]; dataKey: 'users' | 'sessions' | 'pageviews'; color: string }) {
  if (data.length < 2) return null;
  const values = data.map(d => d[dataKey]);
  const max = Math.max(...values, 1);
  const min = Math.min(...values);
  const W = 600;
  const H = 120;
  const pad = { top: 10, bottom: 20, left: 0, right: 0 };
  const plotW = W - pad.left - pad.right;
  const plotH = H - pad.top - pad.bottom;

  const points = values.map((v, i) => ({
    x: pad.left + (i / (values.length - 1)) * plotW,
    y: pad.top + plotH - ((v - min) / (max - min || 1)) * plotH,
  }));

  const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ');
  const area = `${line} L${points[points.length - 1].x},${H - pad.bottom} L${points[0].x},${H - pad.bottom} Z`;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-[120px]">
      <defs>
        <linearGradient id={`grad-${dataKey}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.2" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#grad-${dataKey})`} />
      <path d={line} fill="none" stroke={color} strokeWidth="2" />
      {/* First and last date labels */}
      <text x={pad.left} y={H - 4} fill="#52525b" fontSize="10" textAnchor="start">{data[0].date}</text>
      <text x={W - pad.right} y={H - 4} fill="#52525b" fontSize="10" textAnchor="end">{data[data.length - 1].date}</text>
    </svg>
  );
}

const DeviceIcon = ({ device }: { device: string }) => {
  const d = device.toLowerCase();
  if (d === 'desktop') return <Monitor className="w-3.5 h-3.5" />;
  if (d === 'mobile') return <Smartphone className="w-3.5 h-3.5" />;
  if (d === 'tablet') return <Tablet className="w-3.5 h-3.5" />;
  return <Globe className="w-3.5 h-3.5" />;
};

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}m ${s}s`;
}

function formatNumber(n: number): string {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return n.toLocaleString();
}

function GoogleAnalytics({ workspaceId, ga4PropertyId }: Props) {
  const [days, setDays] = useState(28);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [overview, setOverview] = useState<GA4Overview | null>(null);
  const [trend, setTrend] = useState<GA4DailyTrend[]>([]);
  const [topPages, setTopPages] = useState<GA4TopPage[]>([]);
  const [sources, setSources] = useState<GA4TopSource[]>([]);
  const [devices, setDevices] = useState<GA4DeviceBreakdown[]>([]);
  const [countries, setCountries] = useState<GA4CountryBreakdown[]>([]);
  const [trendMetric, setTrendMetric] = useState<'users' | 'sessions' | 'pageviews'>('users');

  const loadData = useCallback(async (numDays: number) => {
    setLoading(true);
    setError(null);
    try {
      const qs = `?days=${numDays}`;
      const [ov, tr, tp, sr, dv, ct] = await Promise.all([
        fetch(`/api/public/analytics-overview/${workspaceId}${qs}`).then(r => r.json()),
        fetch(`/api/public/analytics-trend/${workspaceId}${qs}`).then(r => r.json()),
        fetch(`/api/public/analytics-top-pages/${workspaceId}${qs}`).then(r => r.json()),
        fetch(`/api/public/analytics-sources/${workspaceId}${qs}`).then(r => r.json()),
        fetch(`/api/public/analytics-devices/${workspaceId}${qs}`).then(r => r.json()),
        fetch(`/api/public/analytics-countries/${workspaceId}${qs}`).then(r => r.json()),
      ]);
      if (ov.error) throw new Error(ov.error);
      setOverview(ov);
      setTrend(Array.isArray(tr) ? tr : []);
      setTopPages(Array.isArray(tp) ? tp : []);
      setSources(Array.isArray(sr) ? sr : []);
      setDevices(Array.isArray(dv) ? dv : []);
      setCountries(Array.isArray(ct) ? ct : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load analytics data');
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    if (ga4PropertyId) loadData(days);
  }, [ga4PropertyId, loadData, days]);

  // ── Not configured state ──
  if (!ga4PropertyId) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-3">
        <div className="w-16 h-16 rounded-2xl bg-zinc-900 flex items-center justify-center">
          <BarChart3 className="w-8 h-8 text-zinc-600" />
        </div>
        <p className="text-sm text-zinc-400">Google Analytics not configured</p>
        <p className="text-xs text-zinc-600 max-w-md text-center">
          Connect Google in Settings and select a GA4 property for this workspace to view analytics data.
        </p>
      </div>
    );
  }

  if (loading && !overview) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-3 text-zinc-500">
        <Loader2 className="w-6 h-6 animate-spin" />
        <p className="text-sm">Loading analytics data...</p>
      </div>
    );
  }

  if (error && !overview) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-4">
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-3 max-w-md text-center">
          <p className="text-red-400 text-sm font-medium mb-1">Failed to Load Analytics</p>
          <p className="text-xs text-red-400/70">{error}</p>
        </div>
        <button onClick={() => loadData(days)} className="px-4 py-2 rounded-lg text-sm font-medium bg-violet-600 hover:bg-violet-500 transition-colors">
          Retry
        </button>
      </div>
    );
  }

  if (!overview) return null;

  const metrics = [
    { label: 'Users', value: formatNumber(overview.totalUsers), icon: Users, color: 'text-violet-400' },
    { label: 'Sessions', value: formatNumber(overview.totalSessions), icon: ArrowUpDown, color: 'text-blue-400' },
    { label: 'Pageviews', value: formatNumber(overview.totalPageviews), icon: Eye, color: 'text-emerald-400' },
    { label: 'Avg. Duration', value: formatDuration(overview.avgSessionDuration), icon: Clock, color: 'text-amber-400' },
    { label: 'Bounce Rate', value: `${overview.bounceRate}%`, icon: overview.bounceRate > 60 ? TrendingDown : TrendingUp, color: overview.bounceRate > 60 ? 'text-red-400' : 'text-emerald-400' },
    { label: 'New Users', value: `${overview.newUserPercentage}%`, icon: Users, color: 'text-pink-400' },
  ];

  const trendColors: Record<string, string> = { users: '#8b5cf6', sessions: '#3b82f6', pageviews: '#10b981' };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-zinc-200">Google Analytics</h2>
          <p className="text-xs text-zinc-500 mt-0.5">
            {overview.dateRange.start} — {overview.dateRange.end}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {loading && <Loader2 className="w-3.5 h-3.5 animate-spin text-zinc-500" />}
          <div className="flex rounded-lg overflow-hidden border border-zinc-700">
            {[7, 14, 28, 90].map(d => (
              <button
                key={d}
                onClick={() => setDays(d)}
                className={`px-2.5 py-1 text-[11px] font-medium transition-colors ${
                  days === d ? 'bg-violet-600 text-white' : 'bg-zinc-800 text-zinc-500 hover:text-zinc-300'
                }`}
              >
                {d}d
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Overview metrics */}
      <div className="grid grid-cols-6 gap-3">
        {metrics.map(m => {
          const Icon = m.icon;
          return (
            <div key={m.label} className="bg-zinc-900 rounded-xl p-3 border border-zinc-800">
              <div className="flex items-center gap-1.5 mb-1.5">
                <Icon className={`w-3.5 h-3.5 ${m.color}`} />
                <span className="text-[10px] text-zinc-500 font-medium">{m.label}</span>
              </div>
              <div className="text-xl font-bold text-zinc-200">{m.value}</div>
            </div>
          );
        })}
      </div>

      {/* Trend chart */}
      {trend.length > 1 && (
        <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-medium text-zinc-300">Daily Trend</span>
            <div className="flex rounded-lg overflow-hidden border border-zinc-700">
              {(['users', 'sessions', 'pageviews'] as const).map(k => (
                <button
                  key={k}
                  onClick={() => setTrendMetric(k)}
                  className={`px-2 py-0.5 text-[10px] font-medium capitalize transition-colors ${
                    trendMetric === k ? 'bg-zinc-700 text-zinc-200' : 'bg-zinc-800 text-zinc-500 hover:text-zinc-300'
                  }`}
                >
                  {k}
                </button>
              ))}
            </div>
          </div>
          <TrendChart data={trend} dataKey={trendMetric} color={trendColors[trendMetric]} />
        </div>
      )}

      {/* Two-column: Top Pages + Sources */}
      <div className="grid grid-cols-2 gap-4">
        {/* Top Pages */}
        <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
          <h3 className="text-sm font-medium text-zinc-300 mb-3">Top Pages</h3>
          <div className="space-y-1.5 max-h-[300px] overflow-y-auto">
            {topPages.slice(0, 15).map((page, i) => (
              <div key={page.path} className="flex items-center gap-2 text-xs py-1">
                <span className="text-zinc-600 w-4 text-right flex-shrink-0">{i + 1}</span>
                <span className="text-zinc-300 truncate flex-1 min-w-0" title={page.path}>{page.path}</span>
                <span className="text-zinc-500 flex-shrink-0 tabular-nums">{formatNumber(page.pageviews)}</span>
              </div>
            ))}
            {topPages.length === 0 && <p className="text-xs text-zinc-600">No data</p>}
          </div>
        </div>

        {/* Traffic Sources */}
        <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
          <h3 className="text-sm font-medium text-zinc-300 mb-3">Traffic Sources</h3>
          <div className="space-y-1.5 max-h-[300px] overflow-y-auto">
            {sources.map((src, i) => {
              const maxSessions = sources[0]?.sessions || 1;
              return (
                <div key={`${src.source}-${src.medium}`} className="flex items-center gap-2 text-xs py-1">
                  <span className="text-zinc-600 w-4 text-right flex-shrink-0">{i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-zinc-300 truncate">{src.source || '(direct)'}</span>
                      <span className="text-zinc-600">/</span>
                      <span className="text-zinc-500 truncate">{src.medium || '(none)'}</span>
                    </div>
                    <div className="mt-0.5 h-1 bg-zinc-800 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-violet-500/40 rounded-full"
                        style={{ width: `${(src.sessions / maxSessions) * 100}%` }}
                      />
                    </div>
                  </div>
                  <span className="text-zinc-500 flex-shrink-0 tabular-nums">{formatNumber(src.sessions)}</span>
                </div>
              );
            })}
            {sources.length === 0 && <p className="text-xs text-zinc-600">No data</p>}
          </div>
        </div>
      </div>

      {/* Two-column: Devices + Countries */}
      <div className="grid grid-cols-2 gap-4">
        {/* Devices */}
        <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
          <h3 className="text-sm font-medium text-zinc-300 mb-3">Devices</h3>
          <div className="space-y-2">
            {devices.map(d => (
              <div key={d.device} className="flex items-center gap-3">
                <DeviceIcon device={d.device} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between text-xs mb-0.5">
                    <span className="text-zinc-300 capitalize">{d.device}</span>
                    <span className="text-zinc-500">{d.percentage}%</span>
                  </div>
                  <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-violet-500 rounded-full transition-all"
                      style={{ width: `${d.percentage}%` }}
                    />
                  </div>
                </div>
                <span className="text-xs text-zinc-500 tabular-nums w-10 text-right">{formatNumber(d.users)}</span>
              </div>
            ))}
            {devices.length === 0 && <p className="text-xs text-zinc-600">No data</p>}
          </div>
        </div>

        {/* Countries */}
        <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
          <h3 className="text-sm font-medium text-zinc-300 mb-3">Top Countries</h3>
          <div className="space-y-1.5 max-h-[200px] overflow-y-auto">
            {countries.map((c, i) => {
              const maxUsers = countries[0]?.users || 1;
              return (
                <div key={c.country} className="flex items-center gap-2 text-xs py-0.5">
                  <span className="text-zinc-600 w-4 text-right flex-shrink-0">{i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-0.5">
                      <span className="text-zinc-300 truncate">{c.country}</span>
                      <span className="text-zinc-500 tabular-nums">{formatNumber(c.users)}</span>
                    </div>
                    <div className="h-1 bg-zinc-800 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-emerald-500/40 rounded-full"
                        style={{ width: `${(c.users / maxUsers) * 100}%` }}
                      />
                    </div>
                  </div>
                </div>
              );
            })}
            {countries.length === 0 && <p className="text-xs text-zinc-600">No data</p>}
          </div>
        </div>
      </div>
    </div>
  );
}

export { GoogleAnalytics };
