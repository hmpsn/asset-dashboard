import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Loader2, Globe, Monitor, Smartphone, Tablet,
  BarChart3, Zap, Target, Leaf, ArrowRight,
  UserPlus, UserCheck, FileText,
} from 'lucide-react';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip } from 'recharts';
import { SectionCard, TabBar, DateRangeSelector, DataList, EmptyState } from './ui';
import { DATE_PRESETS_SEARCH } from './ui';
import { fmtNum as formatNumber } from '../utils/formatNumbers';
import type { GA4DailyTrend } from '../../shared/types/analytics';
import { useAdminGA4 } from '../hooks/admin';

type DataTab = 'overview' | 'events';

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

function TrafficDetail({ workspaceId, ga4PropertyId }: Props) {
  const [days, setDays] = useState(28);
  const [trendMetric, setTrendMetric] = useState<'users' | 'sessions' | 'pageviews'>('users');
  const [tab, setTab] = useState<DataTab>('overview');

  const queryClient = useQueryClient();

  const {
    overview, trend, topPages, sources, devices, countries,
    newVsReturning, organic, landingPages, conversions,
    isLoading: loading, error,
  } = useAdminGA4(workspaceId, days, !!ga4PropertyId);

  const retry = () => queryClient.invalidateQueries({ queryKey: ['admin-ga4-overview', workspaceId] });

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
        <button onClick={retry} className="px-4 py-2 rounded-lg text-sm font-medium bg-teal-600 hover:bg-teal-500 transition-colors">
          Retry
        </button>
      </div>
    );
  }

  if (!overview) return null;

  const trendColors: Record<string, string> = { users: '#14b8a6', sessions: '#3b82f6', pageviews: '#10b981' };

  return (
    <div className="space-y-5">
      {/* Date range + loading indicator */}
      <div className="flex items-center justify-between">
        <p className="text-xs text-zinc-500">{overview.dateRange.start} — {overview.dateRange.end}</p>
        <div className="flex items-center gap-2">
          {loading && <Loader2 className="w-3.5 h-3.5 animate-spin text-zinc-500" />}
          <DateRangeSelector options={DATE_PRESETS_SEARCH} selected={days} onChange={setDays} />
        </div>
      </div>

      {/* Tab navigation */}
      <TabBar
        tabs={[
          { id: 'overview', label: 'Overview', icon: BarChart3 },
          { id: 'events', label: 'Events', icon: Zap },
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
              {topPages.length === 0 && <EmptyState icon={FileText} title="No top pages data" description="No page data available for the selected time period." className="py-4" />}
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
              {sources.length === 0 && <EmptyState icon={Globe} title="No traffic sources data" description="No source data available for the selected time period." className="py-4" />}
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
              {devices.length === 0 && <EmptyState icon={Monitor} title="No device data" description="No device data available for the selected time period." className="py-4" />}
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
              <EmptyState icon={Target} title="No events data" description="No event data available for the selected time period." className="py-4" />
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

    </div>
  );
}

export { TrafficDetail };
