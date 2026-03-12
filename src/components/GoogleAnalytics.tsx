import { useState, useEffect, useCallback } from 'react';
import {
  Loader2, Users, Eye, Clock, ArrowUpDown, Globe, Monitor, Smartphone, Tablet,
  TrendingUp, TrendingDown, BarChart3, Zap, Target, Leaf, ArrowRight,
  AlertTriangle, UserPlus, UserCheck,
} from 'lucide-react';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip } from 'recharts';
import { PageHeader, StatCard, SectionCard, TabBar, DateRangeSelector, DataList, EmptyState } from './ui';
import { DATE_PRESETS_FULL } from './ui/constants';
import { fmtNum as formatNumber } from '../utils/formatNumbers';

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

interface GA4PeriodComparison {
  current: GA4Overview;
  previous: GA4Overview;
  change: { users: number; sessions: number; pageviews: number; bounceRate: number; avgSessionDuration: number };
  changePercent: { users: number; sessions: number; pageviews: number };
}

interface GA4NewVsReturning {
  segment: string;
  users: number;
  sessions: number;
  bounceRate: number;
  engagementRate: number;
  avgEngagementTime: number;
  percentage: number;
}

interface GA4OrganicOverview {
  organicUsers: number;
  organicSessions: number;
  organicPageviews: number;
  organicBounceRate: number;
  engagementRate: number;
  avgEngagementTime: number;
  shareOfTotalUsers: number;
  dateRange: { start: string; end: string };
}

interface GA4LandingPage {
  landingPage: string;
  sessions: number;
  users: number;
  bounceRate: number;
  avgEngagementTime: number;
  conversions: number;
}

interface GA4ConversionSummary {
  eventName: string;
  conversions: number;
  users: number;
  rate: number;
}

type DataTab = 'overview' | 'events' | 'insights';

interface Props {
  workspaceId: string;
  ga4PropertyId?: string;
}

// ── Mini trend chart (Recharts) ──
function TrendChart({ data, dataKey, color }: { data: GA4DailyTrend[]; dataKey: 'users' | 'sessions' | 'pageviews'; color: string }) {
  if (data.length < 2) return null;
  return (
    <div>
      <ResponsiveContainer width="100%" height={120}>
        <AreaChart data={data} margin={{ top: 4, right: 0, bottom: 16, left: 0 }}>
          <defs>
            <linearGradient id={`grad-ga4-${dataKey}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.2} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <XAxis dataKey="date" tick={{ fill: '#52525b', fontSize: 10 }} tickLine={false} axisLine={false} interval={data.length - 2} />
          <YAxis hide domain={['dataMin', 'dataMax']} />
          <Tooltip content={({ active, payload }) => {
            if (!active || !payload?.length) return null;
            const row = payload[0]?.payload as GA4DailyTrend | undefined;
            if (!row) return null;
            return (
              <div className="bg-zinc-900 border border-zinc-700 rounded-lg shadow-xl shadow-black/40 min-w-[140px] overflow-hidden">
                <div className="px-3 py-1.5 border-b border-zinc-800 text-[11px] font-semibold text-zinc-200">{row.date}</div>
                <div className="px-3 py-1.5 space-y-1">
                  {[{ label: 'Users', key: 'users' as const, c: '#60a5fa' }, { label: 'Sessions', key: 'sessions' as const, c: '#a78bfa' }, { label: 'Pageviews', key: 'pageviews' as const, c: '#34d399' }].map(m => (
                    <div key={m.key} className="flex justify-between text-[11px]"><span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full inline-block" style={{ backgroundColor: m.c }} />{m.label}</span><span className="text-zinc-200 font-medium">{row[m.key].toLocaleString()}</span></div>
                  ))}
                </div>
              </div>
            );
          }} />
          <Area type="monotone" dataKey={dataKey} stroke={color} strokeWidth={2} fill={`url(#grad-ga4-${dataKey})`} dot={false} activeDot={{ r: 4, fill: color, stroke: '#18181b', strokeWidth: 2 }} />
        </AreaChart>
      </ResponsiveContainer>
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
  const [comparison, setComparison] = useState<GA4PeriodComparison | null>(null);
  const [newVsReturning, setNewVsReturning] = useState<GA4NewVsReturning[]>([]);
  const [organic, setOrganic] = useState<GA4OrganicOverview | null>(null);
  const [landingPages, setLandingPages] = useState<GA4LandingPage[]>([]);
  const [conversions, setConversions] = useState<GA4ConversionSummary[]>([]);
  const [trendMetric, setTrendMetric] = useState<'users' | 'sessions' | 'pageviews'>('users');
  const [tab, setTab] = useState<DataTab>('overview');

  const loadData = useCallback(async (numDays: number) => {
    setLoading(true);
    setError(null);
    try {
      const qs = `?days=${numDays}`;
      const [ov, tr, tp, sr, dv, ct, cmp, nvr, org, lp, conv] = await Promise.all([
        fetch(`/api/public/analytics-overview/${workspaceId}${qs}`).then(r => r.json()),
        fetch(`/api/public/analytics-trend/${workspaceId}${qs}`).then(r => r.json()),
        fetch(`/api/public/analytics-top-pages/${workspaceId}${qs}`).then(r => r.json()),
        fetch(`/api/public/analytics-sources/${workspaceId}${qs}`).then(r => r.json()),
        fetch(`/api/public/analytics-devices/${workspaceId}${qs}`).then(r => r.json()),
        fetch(`/api/public/analytics-countries/${workspaceId}${qs}`).then(r => r.json()),
        fetch(`/api/public/analytics-comparison/${workspaceId}${qs}`).then(r => r.json()).catch(() => null),
        fetch(`/api/public/analytics-new-vs-returning/${workspaceId}${qs}`).then(r => r.json()).catch(() => []),
        fetch(`/api/public/analytics-organic/${workspaceId}${qs}`).then(r => r.json()).catch(() => null),
        fetch(`/api/public/analytics-landing-pages/${workspaceId}${qs}`).then(r => r.json()).catch(() => []),
        fetch(`/api/public/analytics-conversions/${workspaceId}${qs}`).then(r => r.json()).catch(() => []),
      ]);
      if (ov.error) throw new Error(ov.error);
      setOverview(ov);
      setTrend(Array.isArray(tr) ? tr : []);
      setTopPages(Array.isArray(tp) ? tp : []);
      setSources(Array.isArray(sr) ? sr : []);
      setDevices(Array.isArray(dv) ? dv : []);
      setCountries(Array.isArray(ct) ? ct : []);
      if (cmp && !cmp.error) setComparison(cmp);
      if (Array.isArray(nvr)) setNewVsReturning(nvr);
      if (org && !org.error) setOrganic(org);
      if (Array.isArray(lp)) setLandingPages(lp);
      if (Array.isArray(conv)) setConversions(conv);
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
    { label: 'Users', value: formatNumber(overview.totalUsers), icon: Users, iconColor: '#14b8a6', delta: comparison?.change.users },
    { label: 'Sessions', value: formatNumber(overview.totalSessions), icon: ArrowUpDown, iconColor: '#3b82f6', delta: comparison?.change.sessions },
    { label: 'Pageviews', value: formatNumber(overview.totalPageviews), icon: Eye, iconColor: '#10b981', delta: comparison?.change.pageviews },
    { label: 'Avg. Duration', value: formatDuration(overview.avgSessionDuration), icon: Clock, iconColor: '#fbbf24' },
    { label: 'Bounce Rate', value: `${overview.bounceRate}%`, icon: overview.bounceRate > 60 ? TrendingDown : TrendingUp, iconColor: overview.bounceRate > 60 ? '#f87171' : '#10b981' },
    { label: 'New Users', value: `${overview.newUserPercentage}%`, icon: UserPlus, iconColor: '#06b6d4' },
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

      {/* Overview metrics with sparklines + deltas */}
      <div className="grid grid-cols-6 gap-3">
        {metrics.map(m => (
          <StatCard
            key={m.label}
            label={m.label}
            value={m.value}
            icon={m.icon}
            iconColor={m.iconColor}
            delta={m.delta}
          />
        ))}
      </div>

      {/* Period comparison */}
      {comparison && (
        <SectionCard title={`vs Previous ${days} Days`} titleIcon={<TrendingUp className="w-4 h-4 text-zinc-500" />}>
          <div className="grid grid-cols-5 gap-4">
            {[
              { label: 'Users', val: comparison.current.totalUsers.toLocaleString(), abs: comparison.change.users, pct: comparison.changePercent.users as number | null, invert: false },
              { label: 'Sessions', val: comparison.current.totalSessions.toLocaleString(), abs: comparison.change.sessions, pct: comparison.changePercent.sessions as number | null, invert: false },
              { label: 'Pageviews', val: comparison.current.totalPageviews.toLocaleString(), abs: comparison.change.pageviews, pct: comparison.changePercent.pageviews as number | null, invert: false },
              { label: 'Bounce Rate', val: `${comparison.current.bounceRate}%`, abs: comparison.change.bounceRate, pct: null as number | null, invert: true },
              { label: 'Avg Duration', val: formatDuration(comparison.current.avgSessionDuration), abs: comparison.change.avgSessionDuration, pct: null as number | null, invert: false },
            ].map(m => {
              const isPositive = m.invert ? m.abs < 0 : m.abs > 0;
              const isNeutral = Math.abs(m.abs) < 0.1;
              const fmtAbs = m.label === 'Avg Duration' ? `${m.abs >= 0 ? '+' : '-'}${formatDuration(Math.abs(m.abs))}` : m.label === 'Bounce Rate' ? `${m.abs >= 0 ? '+' : ''}${m.abs}%` : `${m.abs >= 0 ? '+' : ''}${m.abs.toLocaleString()}`;
              return (
                <div key={m.label}>
                  <div className="text-[11px] text-zinc-500 mb-1">{m.label}</div>
                  <div className="text-base font-bold text-zinc-200">{m.val}</div>
                  <div className={`text-[11px] font-medium mt-0.5 ${isNeutral ? 'text-zinc-500' : isPositive ? 'text-emerald-400' : 'text-red-400'}`}>
                    {fmtAbs}
                    {m.pct !== null && ` (${m.pct >= 0 ? '+' : ''}${m.pct}%)`}
                  </div>
                </div>
              );
            })}
          </div>
        </SectionCard>
      )}

      {/* Tab navigation */}
      <TabBar
        tabs={[
          { id: 'overview', label: 'Overview', icon: BarChart3 },
          { id: 'events', label: 'Events', icon: Zap },
          { id: 'insights', label: 'Insights', icon: Target },
        ]}
        active={tab}
        onChange={id => setTab(id as DataTab)}
      />

      {/* ═══════ OVERVIEW TAB ═══════ */}
      {tab === 'overview' && (<>
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

        {/* Top Pages (richer) + Sources (with bars) */}
        <div className="grid grid-cols-2 gap-4">
          <SectionCard title="Top Pages">
            <div className="space-y-1 max-h-[350px] overflow-y-auto">
              {topPages.slice(0, 15).map((p, i) => (
                <div key={i} className="flex items-center gap-2 py-1.5 px-2 rounded-lg hover:bg-zinc-800/50">
                  <span className="text-[11px] text-zinc-500 w-5 text-right">{i + 1}</span>
                  <span className="text-xs text-zinc-300 flex-1 truncate font-mono">{p.path}</span>
                  <span className="text-xs text-teal-400 font-medium tabular-nums">{p.pageviews.toLocaleString()}</span>
                  <span className="text-[11px] text-zinc-500 w-14 text-right">{formatNumber(p.users)} u</span>
                </div>
              ))}
              {topPages.length === 0 && <p className="text-xs text-zinc-500">No data</p>}
            </div>
          </SectionCard>

          <SectionCard title="Traffic Sources">
            <div className="space-y-2 max-h-[350px] overflow-y-auto">
              {sources.slice(0, 10).map((s, i) => {
                const totalSessions = sources.reduce((sum, x) => sum + x.sessions, 0);
                const pct = totalSessions > 0 ? (s.sessions / totalSessions) * 100 : 0;
                return (
                  <div key={i} className="relative">
                    <div className="flex items-center gap-2 py-1.5 px-2 rounded-lg relative z-10">
                      <span className="text-xs text-zinc-300 flex-1 truncate">{s.source || '(direct)'}{s.medium !== '(none)' ? ` / ${s.medium}` : ''}</span>
                      <span className="text-xs text-blue-400 font-medium tabular-nums">{s.sessions.toLocaleString()}</span>
                      <span className="text-[11px] text-zinc-500 w-12 text-right">{pct.toFixed(1)}%</span>
                    </div>
                    <div className="absolute inset-0 rounded-lg bg-blue-500/5" style={{ width: `${pct}%` }} />
                  </div>
                );
              })}
              {sources.length === 0 && <p className="text-xs text-zinc-500">No data</p>}
            </div>
          </SectionCard>
        </div>

        {/* Devices + Countries + New vs Returning */}
        <div className="grid grid-cols-3 gap-4">
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

          <SectionCard title="New vs Returning">
            {newVsReturning.length > 0 ? (
              <div className="space-y-3">
                {newVsReturning.map(seg => {
                  const isNew = seg.segment.toLowerCase() === 'new';
                  const Icon = isNew ? UserPlus : UserCheck;
                  return (
                    <div key={seg.segment}>
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-1.5">
                          <Icon className={`w-3.5 h-3.5 ${isNew ? 'text-cyan-400' : 'text-emerald-400'}`} />
                          <span className="text-xs text-zinc-300 capitalize">{seg.segment}</span>
                        </div>
                        <span className="text-xs text-zinc-500">{seg.percentage}%</span>
                      </div>
                      <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden mb-1">
                        <div className={`h-full rounded-full transition-all ${isNew ? 'bg-cyan-500' : 'bg-emerald-500'}`} style={{ width: `${seg.percentage}%` }} />
                      </div>
                      <div className="flex items-center gap-3 text-[10px] text-zinc-500">
                        <span>{seg.users.toLocaleString()} users</span>
                        <span>{seg.engagementRate}% engaged</span>
                        <span>{formatDuration(seg.avgEngagementTime)}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-xs text-zinc-500">No data</p>
            )}
          </SectionCard>
        </div>

        {/* Organic Search Overview */}
        {organic && (
          <SectionCard title="Organic Search" titleIcon={<Leaf className="w-4 h-4 text-emerald-400" />}>
            <div className="grid grid-cols-4 gap-4">
              <div>
                <div className="text-[11px] text-zinc-500 mb-1">Organic Users</div>
                <div className="text-lg font-bold text-emerald-400">{formatNumber(organic.organicUsers)}</div>
                <div className="text-[11px] text-zinc-500 mt-0.5">{organic.shareOfTotalUsers}% of total</div>
              </div>
              <div>
                <div className="text-[11px] text-zinc-500 mb-1">Organic Sessions</div>
                <div className="text-lg font-bold text-zinc-200">{formatNumber(organic.organicSessions)}</div>
              </div>
              <div>
                <div className="text-[11px] text-zinc-500 mb-1">Engagement Rate</div>
                <div className={`text-lg font-bold ${organic.engagementRate > 50 ? 'text-green-400' : 'text-amber-400'}`}>{organic.engagementRate}%</div>
              </div>
              <div>
                <div className="text-[11px] text-zinc-500 mb-1">Organic Bounce</div>
                <div className={`text-lg font-bold ${organic.organicBounceRate > 60 ? 'text-red-400' : 'text-green-400'}`}>{organic.organicBounceRate}%</div>
              </div>
            </div>
          </SectionCard>
        )}
      </>)}

      {/* ═══════ EVENTS TAB ═══════ */}
      {tab === 'events' && (<>
        {conversions.length > 0 ? (
          <SectionCard title="Key Events" titleIcon={<Zap className="w-4 h-4 text-amber-400" />}>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {conversions.map((c, i) => (
                <div key={i} className="bg-zinc-800/30 rounded-lg border border-zinc-800 p-3">
                  <div className="text-[11px] text-zinc-400 truncate mb-1">{c.eventName.replace(/_/g, ' ')}</div>
                  <div className="text-xl font-bold text-zinc-200">{c.conversions.toLocaleString()}</div>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-[11px] text-zinc-500">{c.users.toLocaleString()} users</span>
                    {c.rate > 0 && <span className="text-[11px] font-medium text-emerald-400">{c.rate}%</span>}
                  </div>
                </div>
              ))}
            </div>
          </SectionCard>
        ) : (
          <SectionCard>
            <div className="text-center py-8">
              <Zap className="w-8 h-8 text-zinc-700 mx-auto mb-2" />
              <p className="text-xs text-zinc-500">No custom events tracked yet</p>
            </div>
          </SectionCard>
        )}

        {/* Landing Pages table */}
        {landingPages.length > 0 && (
          <SectionCard title="Top Landing Pages" titleIcon={<ArrowRight className="w-4 h-4 text-teal-400" />} noPadding>
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-zinc-800">
                  <th className="text-left py-3 px-4 text-zinc-500 font-medium">Landing Page</th>
                  <th className="text-right py-3 px-3 text-zinc-500 font-medium">Sessions</th>
                  <th className="text-right py-3 px-3 text-zinc-500 font-medium">Users</th>
                  <th className="text-right py-3 px-3 text-zinc-500 font-medium">Bounce</th>
                  <th className="text-right py-3 px-3 text-zinc-500 font-medium">Conversions</th>
                </tr>
              </thead>
              <tbody>
                {landingPages.slice(0, 20).map((p, i) => (
                  <tr key={i} className="border-b border-zinc-800/50 hover:bg-zinc-800/30">
                    <td className="py-2.5 px-4 text-zinc-300 truncate max-w-[300px] font-mono">{p.landingPage}</td>
                    <td className="py-2.5 px-3 text-right text-blue-400">{p.sessions.toLocaleString()}</td>
                    <td className="py-2.5 px-3 text-right text-zinc-400">{p.users.toLocaleString()}</td>
                    <td className="py-2.5 px-3 text-right">
                      <span className={p.bounceRate > 70 ? 'text-red-400' : p.bounceRate > 50 ? 'text-amber-400' : 'text-green-400'}>
                        {p.bounceRate}%
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-right text-emerald-400">{p.conversions}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </SectionCard>
        )}
      </>)}

      {/* ═══════ INSIGHTS TAB ═══════ */}
      {tab === 'insights' && (<>
        {/* Traffic Health Summary */}
        <SectionCard title="Traffic Health Summary">
          <div className="grid grid-cols-4 gap-3">
            <div className="text-center">
              <div className={`text-lg font-bold ${overview.bounceRate < 50 ? 'text-green-400' : overview.bounceRate < 65 ? 'text-amber-400' : 'text-red-400'}`}>
                {overview.bounceRate}%
              </div>
              <div className="text-[11px] text-zinc-500">Bounce Rate</div>
            </div>
            <div className="text-center">
              <div className={`text-lg font-bold ${overview.avgSessionDuration > 120 ? 'text-green-400' : overview.avgSessionDuration > 60 ? 'text-amber-400' : 'text-red-400'}`}>
                {formatDuration(overview.avgSessionDuration)}
              </div>
              <div className="text-[11px] text-zinc-500">Avg Session</div>
            </div>
            <div className="text-center">
              <div className={`text-lg font-bold ${organic ? (organic.shareOfTotalUsers > 30 ? 'text-green-400' : organic.shareOfTotalUsers > 15 ? 'text-amber-400' : 'text-red-400') : 'text-zinc-500'}`}>
                {organic ? `${organic.shareOfTotalUsers}%` : '—'}
              </div>
              <div className="text-[11px] text-zinc-500">Organic Share</div>
            </div>
            <div className="text-center">
              <div className={`text-lg font-bold ${conversions.length > 3 ? 'text-green-400' : conversions.length > 0 ? 'text-amber-400' : 'text-red-400'}`}>
                {conversions.length}
              </div>
              <div className="text-[11px] text-zinc-500">Tracked Events</div>
            </div>
          </div>
        </SectionCard>

        <div className="grid grid-cols-2 gap-4">
          {/* Growth Signals */}
          {comparison && (
            <SectionCard title="Growth Signals" titleIcon={<TrendingUp className="w-4 h-4 text-emerald-400" />}>
              <div className="space-y-2">
                {[
                  { label: 'User growth', value: comparison.changePercent.users },
                  { label: 'Session growth', value: comparison.changePercent.sessions },
                  { label: 'Pageview growth', value: comparison.changePercent.pageviews },
                ].map(g => (
                  <div key={g.label} className="flex items-center justify-between text-xs py-1.5 px-2 rounded bg-zinc-800/30">
                    <span className="text-zinc-400">{g.label}</span>
                    <span className={`font-medium ${g.value > 0 ? 'text-emerald-400' : g.value < 0 ? 'text-red-400' : 'text-zinc-500'}`}>
                      {g.value > 0 ? '+' : ''}{g.value}%
                    </span>
                  </div>
                ))}
                {comparison.change.bounceRate !== 0 && (
                  <div className="flex items-center justify-between text-xs py-1.5 px-2 rounded bg-zinc-800/30">
                    <span className="text-zinc-400">Bounce rate change</span>
                    <span className={`font-medium ${comparison.change.bounceRate < 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {comparison.change.bounceRate > 0 ? '+' : ''}{comparison.change.bounceRate}%
                    </span>
                  </div>
                )}
              </div>
            </SectionCard>
          )}

          {/* Engagement Analysis */}
          <SectionCard title="Engagement Analysis" titleIcon={<Eye className="w-4 h-4 text-blue-400" />}>
            <div className="space-y-2">
              {newVsReturning.map(seg => (
                <div key={seg.segment} className="flex items-center justify-between text-xs py-1.5 px-2 rounded bg-zinc-800/30">
                  <span className="text-zinc-400 capitalize">{seg.segment} user engagement</span>
                  <span className={`font-medium ${seg.engagementRate > 60 ? 'text-green-400' : seg.engagementRate > 40 ? 'text-amber-400' : 'text-red-400'}`}>
                    {seg.engagementRate}%
                  </span>
                </div>
              ))}
              {topPages.length > 0 && (
                <div className="flex items-center justify-between text-xs py-1.5 px-2 rounded bg-zinc-800/30">
                  <span className="text-zinc-400">Top page avg. engagement</span>
                  <span className="text-zinc-300 font-medium">{formatDuration(topPages[0].avgEngagementTime)}</span>
                </div>
              )}
              {organic && (
                <div className="flex items-center justify-between text-xs py-1.5 px-2 rounded bg-zinc-800/30">
                  <span className="text-zinc-400">Organic avg. engagement</span>
                  <span className="text-zinc-300 font-medium">{formatDuration(organic.avgEngagementTime)}</span>
                </div>
              )}
            </div>
          </SectionCard>
        </div>

        {/* Organic vs Total */}
        {organic && (
          <SectionCard title="Organic vs All Traffic" titleIcon={<Leaf className="w-4 h-4 text-emerald-400" />}>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <div className="text-[11px] text-zinc-500 mb-2">Users</div>
                <div className="flex items-center gap-2 mb-1">
                  <div className="h-2 flex-1 bg-zinc-800 rounded-full overflow-hidden">
                    <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${organic.shareOfTotalUsers}%` }} />
                  </div>
                  <span className="text-[11px] text-emerald-400 font-medium w-10 text-right">{organic.shareOfTotalUsers}%</span>
                </div>
                <div className="text-[10px] text-zinc-500">{formatNumber(organic.organicUsers)} of {formatNumber(overview.totalUsers)}</div>
              </div>
              <div>
                <div className="text-[11px] text-zinc-500 mb-2">Bounce Rate</div>
                <div className="flex items-center gap-3">
                  <div className="text-center flex-1">
                    <div className="text-sm font-bold text-emerald-400">{organic.organicBounceRate}%</div>
                    <div className="text-[10px] text-zinc-500">Organic</div>
                  </div>
                  <div className="text-zinc-700">vs</div>
                  <div className="text-center flex-1">
                    <div className="text-sm font-bold text-zinc-300">{overview.bounceRate}%</div>
                    <div className="text-[10px] text-zinc-500">All</div>
                  </div>
                </div>
              </div>
              <div>
                <div className="text-[11px] text-zinc-500 mb-2">Engagement</div>
                <div className="flex items-center gap-3">
                  <div className="text-center flex-1">
                    <div className="text-sm font-bold text-emerald-400">{organic.engagementRate}%</div>
                    <div className="text-[10px] text-zinc-500">Organic</div>
                  </div>
                  <div className="text-zinc-700">vs</div>
                  <div className="text-center flex-1">
                    <div className="text-sm font-bold text-zinc-300">{overview.newUserPercentage}%</div>
                    <div className="text-[10px] text-zinc-500">New Users</div>
                  </div>
                </div>
              </div>
            </div>
          </SectionCard>
        )}

        {/* Next Steps */}
        <div className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-zinc-900/50 border border-zinc-800 flex-wrap">
          <span className="text-[11px] text-zinc-500 font-medium uppercase tracking-wider mr-1">Next steps →</span>
          {organic && organic.shareOfTotalUsers < 30 && (
            <span className="flex items-center gap-1 text-[11px] text-teal-400/80 bg-teal-500/5 px-2 py-1 rounded border border-teal-500/10">
              <Leaf className="w-3 h-3" /> Organic share is low — build a <strong className="text-teal-400">Keyword Strategy</strong>
            </span>
          )}
          {overview.bounceRate > 60 && (
            <span className="flex items-center gap-1 text-[11px] text-teal-400/80 bg-teal-500/5 px-2 py-1 rounded border border-teal-500/10">
              <AlertTriangle className="w-3 h-3" /> High bounce rate — review landing pages in <strong className="text-teal-400">SEO Editor</strong>
            </span>
          )}
          {conversions.length === 0 && (
            <span className="flex items-center gap-1 text-[11px] text-teal-400/80 bg-teal-500/5 px-2 py-1 rounded border border-teal-500/10">
              <Zap className="w-3 h-3" /> No events tracked — set up conversion tracking
            </span>
          )}
        </div>
      </>)}

    </div>
  );
}

export { GoogleAnalytics };
