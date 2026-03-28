import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Loader2, Globe, Monitor, Smartphone, Tablet,
  BarChart3, Zap, Target, Leaf, ArrowRight,
  UserPlus, UserCheck, FileText, TrendingUp, Eye,
} from 'lucide-react';
import { SectionCard, DateRangeSelector, DataList, EmptyState, MetricToggleCard } from './ui';
import { DATE_PRESETS_FULL } from './ui';
import { fmtNum as formatNumber } from '../utils/formatNumbers';
import { useAdminGA4 } from '../hooks/admin';
import { useAnalyticsOverview } from '../hooks/admin/useAnalyticsOverview';
import { useInsightFeed } from '../hooks/admin/useInsightFeed';
import { AnnotatedTrendChart } from './charts/AnnotatedTrendChart';
import type { TrendLine } from './charts/AnnotatedTrendChart';
import { InsightFeed } from './insights';

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
  const [activeTrafficLines, setActiveTrafficLines] = useState<Set<string>>(new Set(['users', 'sessions']));
  const [eventsExpanded, setEventsExpanded] = useState(true);

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

      {/* ── 1. MetricToggleCards ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <MetricToggleCard
          label="Users"
          value={formatNumber(overview.totalUsers)}
          delta={comparison ? `${comparison.changePercent.users > 0 ? '+' : ''}${comparison.changePercent.users}%` : '—'}
          deltaPositive={(comparison?.changePercent.users ?? 0) >= 0}
          color="#14b8a6"
          active={activeTrafficLines.has('users')}
          onClick={() => setActiveTrafficLines(prev => {
            const next = new Set(prev);
            if (next.has('users')) { if (next.size > 1) next.delete('users'); } else if (next.size < 3) { next.add('users'); }
            return next;
          })}
        />
        <MetricToggleCard
          label="Sessions"
          value={formatNumber(overview.totalSessions)}
          delta={comparison ? `${comparison.changePercent.sessions > 0 ? '+' : ''}${comparison.changePercent.sessions}%` : '—'}
          deltaPositive={(comparison?.changePercent.sessions ?? 0) >= 0}
          color="#3b82f6"
          active={activeTrafficLines.has('sessions')}
          onClick={() => setActiveTrafficLines(prev => {
            const next = new Set(prev);
            if (next.has('sessions')) { if (next.size > 1) next.delete('sessions'); } else if (next.size < 3) { next.add('sessions'); }
            return next;
          })}
        />
        <MetricToggleCard
          label="Bounce Rate"
          value={`${overview.bounceRate}%`}
          delta={comparison ? `${comparison.change.bounceRate > 0 ? '+' : ''}${comparison.change.bounceRate}%` : '—'}
          deltaPositive={(comparison?.change.bounceRate ?? 0) >= 0}
          invertDelta
          color="#f97316"
          active
          onClick={() => {}}
        />
        <MetricToggleCard
          label="Avg Duration"
          value={formatDuration(overview.avgSessionDuration)}
          delta={comparison ? `${comparison.change.avgSessionDuration > 0 ? '+' : ''}${formatDuration(Math.abs(comparison.change.avgSessionDuration))}` : '—'}
          deltaPositive={(comparison?.change.avgSessionDuration ?? 0) >= 0}
          color="#a78bfa"
          active
          onClick={() => {}}
        />
      </div>

      {/* ── 2. Traffic Trend Chart (always visible) ── */}
      {overviewData.trendData.length > 1 && (
        <SectionCard title="Traffic Trend">
          <AnnotatedTrendChart
            data={overviewData.trendData}
            lines={TRAFFIC_LINES.map(l => ({ ...l, active: activeTrafficLines.has(l.key) }))}
            annotations={overviewData.annotations}
            dateKey="date"
            height={220}
            onCreateAnnotation={
              overviewData.createAnnotation.mutate
                ? (date, label, category) => overviewData.createAnnotation.mutate({ date, label, category })
                : undefined
            }
            onToggleLine={(key) => {
              setActiveTrafficLines(prev => {
                const next = new Set(prev);
                if (next.has(key)) {
                  if (next.size > 1) next.delete(key);
                } else if (next.size < 3) {
                  next.add(key);
                }
                return next;
              });
            }}
            maxActiveLines={3}
          />
        </SectionCard>
      )}

      {/* ── 3. Compact Traffic Insights Feed ── */}
      <InsightFeed
        feed={feed}
        loading={feedLoading}
        domain="traffic"
        showFilterChips
        limit={5}
      />

      {/* ── 4. Growth Signals + Engagement Analysis (side by side) ── */}
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

      {/* ── 5. Organic vs All Traffic ── */}
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

      {/* ── 6. Two-column grid — table spans all rows, sidebar cards stack ── */}
      <div className="grid grid-cols-1 lg:grid-cols-[2fr_1fr] lg:grid-rows-4 gap-3">
        {/* Left: Top Pages — spans all 4 rows */}
        <SectionCard title="Top Pages" className="lg:row-span-4 flex flex-col max-h-[80vh]">
          <div className="space-y-1 overflow-y-auto flex-1 min-h-0">
            {topPages.map((p, i) => (
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

        {/* Right column: each card occupies one grid row */}
          <SectionCard title="Traffic Sources">
            <div className="space-y-2 max-h-[200px] overflow-y-auto">
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

          {/* New vs Returning */}
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
              <EmptyState icon={Target} title="No segment data" description="No new vs returning data available." className="py-4" />
            )}
          </SectionCard>
      </div>

      {/* ── 9. Events & Conversions (collapsible, collapsed by default) ── */}
      <SectionCard>
        <button
          onClick={() => setEventsExpanded(!eventsExpanded)}
          className="w-full flex items-center justify-between text-sm font-semibold text-zinc-200"
        >
          <span>Events &amp; Conversions</span>
          <span className="text-xs text-zinc-500">
            {conversions.length} tracked event{conversions.length !== 1 ? 's' : ''} {eventsExpanded ? '▴' : '▾'}
          </span>
        </button>
        {eventsExpanded && (
          <div className="mt-4 space-y-4">
            {/* Key Events grid */}
            {conversions.length > 0 ? (
              <div>
                <div className="text-xs text-zinc-500 font-medium mb-2 flex items-center gap-1.5">
                  <Zap className="w-3.5 h-3.5 text-amber-400" /> Key Events
                </div>
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
              </div>
            ) : (
              <div className="text-center py-6">
                <Zap className="w-8 h-8 text-zinc-700 mx-auto mb-2" />
                <p className="text-xs text-zinc-500">No custom events tracked yet</p>
              </div>
            )}

            {/* Landing Pages table */}
            {landingPages.length > 0 && (
              <div>
                <div className="text-xs text-zinc-500 font-medium mb-2 flex items-center gap-1.5">
                  <ArrowRight className="w-3.5 h-3.5 text-teal-400" /> Top Landing Pages
                </div>
                <div className="rounded-lg border border-zinc-800 overflow-hidden">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-zinc-800 bg-zinc-900/50">
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
                </div>
              </div>
            )}
          </div>
        )}
      </SectionCard>

    </div>
  );
}

export { TrafficDetail };
