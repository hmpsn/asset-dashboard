import { useState, useEffect, useCallback } from 'react';
import {
  Loader2, Users, Eye, Clock, ArrowUpDown, Globe, Monitor, Smartphone, Tablet,
  TrendingUp, TrendingDown, BarChart3,
} from 'lucide-react';
import { ChartPointDetail } from './ChartPointDetail';
import { PageHeader, StatCard, SectionCard, DateRangeSelector, DataList, EmptyState } from './ui';
import { DATE_PRESETS_FULL } from './ui/constants';

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
  const [selected, setSelected] = useState<number | null>(null);
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
  const bandW = W / data.length;

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-[120px]">
        <defs>
          <linearGradient id={`grad-${dataKey}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.2" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={area} fill={`url(#grad-${dataKey})`} />
        <path d={line} fill="none" stroke={color} strokeWidth="2" />
        {/* Clickable hit areas */}
        {points.map((p, i) => (
          <rect key={i} x={p.x - bandW / 2} y={0} width={bandW} height={H - pad.bottom} fill="transparent" className="cursor-pointer" onClick={() => setSelected(selected === i ? null : i)} />
        ))}
        {/* Selected point indicator */}
        {selected !== null && points[selected] && (
          <>
            <line x1={points[selected].x} y1={pad.top} x2={points[selected].x} y2={H - pad.bottom} stroke={color} strokeWidth="1" strokeDasharray="4,3" opacity="0.5" />
            <circle cx={points[selected].x} cy={points[selected].y} r="4" fill={color} stroke="#18181b" strokeWidth="2" />
          </>
        )}
        {/* First and last date labels */}
        <text x={pad.left} y={H - 4} fill="#52525b" fontSize="10" textAnchor="start">{data[0].date}</text>
        <text x={W - pad.right} y={H - 4} fill="#52525b" fontSize="10" textAnchor="end">{data[data.length - 1].date}</text>
      </svg>
      {selected !== null && data[selected] && (
        <ChartPointDetail
          date={data[selected].date}
          xPct={(selected / (data.length - 1)) * 100}
          onClose={() => setSelected(null)}
          metrics={[
            { label: 'Users', value: data[selected].users, color: '#60a5fa' },
            { label: 'Sessions', value: data[selected].sessions, color: '#a78bfa' },
            { label: 'Pageviews', value: data[selected].pageviews, color: '#34d399' },
          ]}
        />
      )}
    </div>
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
      <EmptyState
        icon={BarChart3}
        title="Google Analytics not configured"
        description="Connect Google in Settings and select a GA4 property for this workspace to view analytics data."
      />
    );
  }

  if (loading && !overview) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-3 text-zinc-500">
        <Loader2 className="w-6 h-6 animate-spin text-teal-400" />
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
        <button onClick={() => loadData(days)} className="px-4 py-2 rounded-lg text-sm font-medium bg-teal-600 hover:bg-teal-500 transition-colors">
          Retry
        </button>
      </div>
    );
  }

  if (!overview) return null;

  const metrics = [
    { label: 'Users', value: formatNumber(overview.totalUsers), icon: Users, color: 'text-teal-400' },
    { label: 'Sessions', value: formatNumber(overview.totalSessions), icon: ArrowUpDown, color: 'text-blue-400' },
    { label: 'Pageviews', value: formatNumber(overview.totalPageviews), icon: Eye, color: 'text-emerald-400' },
    { label: 'Avg. Duration', value: formatDuration(overview.avgSessionDuration), icon: Clock, color: 'text-amber-400' },
    { label: 'Bounce Rate', value: `${overview.bounceRate}%`, icon: overview.bounceRate > 60 ? TrendingDown : TrendingUp, color: overview.bounceRate > 60 ? 'text-red-400' : 'text-emerald-400' },
    { label: 'New Users', value: `${overview.newUserPercentage}%`, icon: Users, color: 'text-cyan-400' },
  ];

  const trendColors: Record<string, string> = { users: '#14b8a6', sessions: '#3b82f6', pageviews: '#10b981' };

  return (
    <div className="space-y-5">
      {/* Header */}
      <PageHeader
        title="Google Analytics"
        subtitle={`${overview.dateRange.start} — ${overview.dateRange.end}`}
        actions={<>
          {loading && <Loader2 className="w-3.5 h-3.5 animate-spin text-zinc-500" />}
          <DateRangeSelector options={DATE_PRESETS_FULL} selected={days} onChange={setDays} />
        </>}
      />

      {/* Overview metrics */}
      <div className="grid grid-cols-6 gap-3">
        {metrics.map(m => (
          <StatCard key={m.label} label={m.label} value={m.value} icon={m.icon} iconColor={m.color.replace('text-', '')} />
        ))}
      </div>

      {/* Trend chart */}
      {trend.length > 1 && (
        <SectionCard
          title="Daily Trend"
          action={
            <DateRangeSelector
              options={[{ label: 'Users', value: 0 }, { label: 'Sessions', value: 1 }, { label: 'Pageviews', value: 2 }]}
              selected={['users', 'sessions', 'pageviews'].indexOf(trendMetric)}
              onChange={i => setTrendMetric((['users', 'sessions', 'pageviews'] as const)[i])}
            />
          }
        >
          <TrendChart data={trend} dataKey={trendMetric} color={trendColors[trendMetric]} />
        </SectionCard>
      )}

      {/* Two-column: Top Pages + Sources */}
      <div className="grid grid-cols-2 gap-4">
        <SectionCard title="Top Pages">
          <DataList items={topPages.slice(0, 15).map(p => ({ label: p.path, value: formatNumber(p.pageviews) }))} />
        </SectionCard>

        <SectionCard title="Traffic Sources">
          <DataList items={sources.map(s => ({ label: `${s.source || '(direct)'} / ${s.medium || '(none)'}`, value: formatNumber(s.sessions) }))} />
        </SectionCard>
      </div>

      {/* Two-column: Devices + Countries */}
      <div className="grid grid-cols-2 gap-4">
        <SectionCard title="Devices">
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
                    <div className="h-full bg-teal-500 rounded-full transition-all" style={{ width: `${d.percentage}%` }} />
                  </div>
                </div>
                <span className="text-xs text-zinc-500 tabular-nums w-10 text-right">{formatNumber(d.users)}</span>
              </div>
            ))}
            {devices.length === 0 && <p className="text-xs text-zinc-500">No data</p>}
          </div>
        </SectionCard>

        <SectionCard title="Top Countries">
          <DataList
            items={countries.map(c => ({ label: c.country, value: formatNumber(c.users) }))}
            maxHeight="200px"
          />
        </SectionCard>
      </div>

    </div>
  );
}

export { GoogleAnalytics };
