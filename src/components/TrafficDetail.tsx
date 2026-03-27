import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Loader2, Globe, Monitor, Smartphone, Tablet,
  BarChart3, Zap, Target, Leaf, ArrowRight,
  UserPlus, UserCheck, FileText, TrendingUp, Eye, AlertTriangle,
} from 'lucide-react';
import { SectionCard, TabBar, DateRangeSelector, DataList, EmptyState } from './ui';
import { DATE_PRESETS_FULL } from './ui';
import { fmtNum as formatNumber } from '../utils/formatNumbers';
import { useAdminGA4 } from '../hooks/admin';
import { useAnalyticsOverview } from '../hooks/admin/useAnalyticsOverview';
import { useInsightFeed } from '../hooks/admin/useInsightFeed';
import { AnnotatedTrendChart } from './charts/AnnotatedTrendChart';
import type { TrendLine } from './charts/AnnotatedTrendChart';
import { InsightFeed } from './insights';

type DataTab = 'insights' | 'breakdown' | 'events';

interface Props {
  workspaceId: string;
  ga4PropertyId?: string;
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

const TRAFFIC_LINES: TrendLine[] = [
  { key: 'users', color: '#14b8a6', yAxisId: 'left', label: 'Users' },
  { key: 'sessions', color: '#3b82f6', yAxisId: 'left', label: 'Sessions' },
  { key: 'pageviews', color: '#10b981', yAxisId: 'left', label: 'Pageviews' },
];

function TrafficDetail({ workspaceId, ga4PropertyId }: Props) {
  const [days, setDays] = useState(28);
  const [tab, setTab] = useState<DataTab>('insights');
  const [activeTrafficLines, setActiveTrafficLines] = useState<Set<string>>(new Set(['users', 'sessions']));

  const queryClient = useQueryClient();

  const {
    overview, topPages, sources, devices, countries,
    comparison, newVsReturning, organic, landingPages, conversions,
    isLoading: loading, error,
  } = useAdminGA4(workspaceId, days, !!ga4PropertyId);

  const overviewData = useAnalyticsOverview(
    workspaceId,
    undefined,
    undefined,
    ga4PropertyId,
    days,
  );

  const { feed, isLoading: feedLoading } = useInsightFeed(workspaceId);

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

  return (
    <div className="space-y-5">
      {/* Date range + loading indicator */}
      <div className="flex items-center justify-between">
        <p className="text-xs text-zinc-500">{overview.dateRange.start} — {overview.dateRange.end}</p>
        <div className="flex items-center gap-2">
          {loading && <Loader2 className="w-3.5 h-3.5 animate-spin text-zinc-500" />}
          <DateRangeSelector options={DATE_PRESETS_FULL} selected={days} onChange={setDays} />
        </div>
      </div>

      {/* Tab navigation */}
      <TabBar
        tabs={[
          { id: 'insights', label: 'Traffic Insights', icon: Target },
          { id: 'breakdown', label: 'Breakdown', icon: BarChart3 },
          { id: 'events', label: 'Events', icon: Zap },
        ]}
        active={tab}
        onChange={id => setTab(id as DataTab)}
      />

      {/* ═══════ INSIGHTS TAB ═══════ */}
      {tab === 'insights' && (
        <div className="space-y-4">
          {/* Insight Feed — traffic domain, priority first */}
          <InsightFeed
            feed={feed}
            loading={feedLoading}
            domain="traffic"
            showFilterChips
          />

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
        </div>
      )}

      {/* ═══════ BREAKDOWN TAB ═══════ */}
      {tab === 'breakdown' && (<>
        {/* Annotated Trend Chart */}
        {overviewData.trendData.length > 1 && (
          <SectionCard title="Daily Trend">
            <AnnotatedTrendChart
              data={overviewData.trendData}
              lines={TRAFFIC_LINES.map(l => ({ ...l, active: activeTrafficLines.has(l.key) }))}
              annotations={overviewData.annotations}
              onCreateAnnotation={
                overviewData.createAnnotation.mutate
                  ? (date, label, category) => overviewData.createAnnotation.mutate({ date, label, category })
                  : undefined
              }
              onToggleLine={(key) => {
                setActiveTrafficLines(prev => {
                  const next = new Set(prev);
                  if (next.has(key)) next.delete(key);
                  else if (next.size < 3) next.add(key);
                  return next;
                });
              }}
              maxActiveLines={3}
            />
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
