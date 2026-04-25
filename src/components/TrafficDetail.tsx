import { useState, useRef, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Loader2, Globe, Monitor, Smartphone, Tablet,
  BarChart3, Zap, Target, Leaf, ArrowRight,
  UserPlus, UserCheck, FileText, TrendingUp, Eye,
} from 'lucide-react';
import { SectionCard, DateRangeSelector, DataList, EmptyState, MetricToggleCard, Icon, Button } from './ui';
import { DATE_PRESETS_FULL } from './ui';
import { fmtNum as formatNumber } from '../utils/formatNumbers';
import { useAdminGA4 } from '../hooks/admin';
import { useAnalyticsOverview } from '../hooks/admin/useAnalyticsOverview';
import { useInsightFeed } from '../hooks/admin/useInsightFeed';
import { queryKeys } from '../lib/queryKeys';
import { useToggleSet } from '../hooks/useToggleSet';
import { AnnotatedTrendChart } from './charts/AnnotatedTrendChart';
import type { TrendLine } from './charts/AnnotatedTrendChart';
import { InsightFeed } from './insights';

interface Props {
  workspaceId: string;
  ga4PropertyId?: string;
}

const DeviceIcon = ({ device }: { device: string }) => {
  const d = device.toLowerCase();
  if (d === 'desktop') return <Icon as={Monitor} size="sm" />;
  if (d === 'mobile') return <Icon as={Smartphone} size="sm" />;
  if (d === 'tablet') return <Icon as={Tablet} size="sm" />;
  return <Icon as={Globe} size="sm" />;
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
  const [activeTrafficLines, handleToggleTrafficLine] = useToggleSet(['users', 'sessions']);
  const [eventsExpanded, setEventsExpanded] = useState(false);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const [sidebarHeight, setSidebarHeight] = useState(0);

  useEffect(() => {
    if (sidebarRef.current) {
      const h = sidebarRef.current.offsetHeight;
      if (h > 0 && h !== sidebarHeight) setSidebarHeight(h);
    }
  });

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

  const retry = () => queryClient.invalidateQueries({ queryKey: queryKeys.admin.ga4All(workspaceId) });

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
      <div className="flex flex-col items-center justify-center py-16 gap-3 text-[var(--brand-text-muted)]">
        <Icon as={Loader2} size="xl" className="animate-spin text-teal-400" />
        <p className="text-sm">Loading analytics data...</p>
      </div>
    );
  }

  if (error && !overview) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-4">
        <div className="bg-red-500/10 border border-red-500/30 rounded-[var(--radius-sm)] px-4 py-3 max-w-md text-center">
          <p className="text-red-400 text-sm font-medium mb-1">Failed to Load Analytics</p>
          <p className="text-xs text-red-400/70">{error}</p>
        </div>
        <Button variant="primary" size="md" onClick={retry}>Retry</Button>
      </div>
    );
  }

  if (!overview) return null;

  return (
    <div className="space-y-8">
      {/* Date range + loading indicator */}
      <div className="flex items-center justify-between">
        <p className="text-xs text-[var(--brand-text-muted)]">{overview.dateRange.start} — {overview.dateRange.end}</p>
        <div className="flex items-center gap-2">
          {loading && <Icon as={Loader2} size="sm" className="animate-spin text-[var(--brand-text-muted)]" />}
          <DateRangeSelector options={DATE_PRESETS_FULL} selected={days} onChange={setDays} />
        </div>
      </div>

      {/* ── 1. MetricToggleCards ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <MetricToggleCard
          label="Users"
          value={formatNumber(overview.totalUsers)}
          delta={comparison ? `${comparison.changePercent.users > 0 ? '+' : ''}${comparison.changePercent.users.toFixed(1)}%` : '—'}
          deltaPositive={(comparison?.changePercent.users ?? 0) >= 0}
          color="#14b8a6"
          active={activeTrafficLines.has('users')}
          onClick={() => handleToggleTrafficLine('users')}
        />
        <MetricToggleCard
          label="Sessions"
          value={formatNumber(overview.totalSessions)}
          delta={comparison ? `${comparison.changePercent.sessions > 0 ? '+' : ''}${comparison.changePercent.sessions.toFixed(1)}%` : '—'}
          deltaPositive={(comparison?.changePercent.sessions ?? 0) >= 0}
          color="#3b82f6"
          active={activeTrafficLines.has('sessions')}
          onClick={() => handleToggleTrafficLine('sessions')}
        />
        <MetricToggleCard
          label="Bounce Rate"
          value={`${overview.bounceRate}%`}
          delta={comparison ? `${comparison.change.bounceRate > 0 ? '+' : ''}${comparison.change.bounceRate.toFixed(1)}pt` : '—'}
          deltaPositive={(comparison?.change.bounceRate ?? 0) > 0}
          invertDelta
          color="#f97316"
          active
          displayOnly
        />
        <MetricToggleCard
          label="Avg Duration"
          value={formatDuration(overview.avgSessionDuration)}
          delta={comparison ? `${comparison.change.avgSessionDuration > 0 ? '+' : comparison.change.avgSessionDuration < 0 ? '-' : ''}${formatDuration(Math.abs(comparison.change.avgSessionDuration))}` : '—'}
          deltaPositive={(comparison?.change.avgSessionDuration ?? 0) > 0}
          color="#22d3ee"
          active
          displayOnly
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
            onToggleLine={handleToggleTrafficLine}
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
        workspaceId={workspaceId}
        limit={5}
      />

      {/* ── 4. Growth Signals + Engagement Analysis (side by side) ── */}
      <div className={`grid gap-4 ${comparison ? 'grid-cols-2' : 'grid-cols-1'}`}>
        {/* Growth Signals */}
        {comparison && (
          <SectionCard title="Growth Signals" titleIcon={<Icon as={TrendingUp} size="sm" className="text-emerald-400" />}>
            <div className="space-y-2">
              {[
                { label: 'User growth', value: comparison.changePercent.users },
                { label: 'Session growth', value: comparison.changePercent.sessions },
                { label: 'Pageview growth', value: comparison.changePercent.pageviews },
              ].map(g => (
                <div key={g.label} className="flex items-center justify-between text-xs py-1.5 px-2 rounded bg-[var(--surface-3)]/30">
                  <span className="text-[var(--brand-text)]">{g.label}</span>
                  <span className={`font-medium ${g.value > 0 ? 'text-emerald-400' : g.value < 0 ? 'text-red-400' : 'text-[var(--brand-text-muted)]'}`}>
                    {g.value > 0 ? '+' : ''}{g.value}%
                  </span>
                </div>
              ))}
              {comparison.change.bounceRate !== 0 && (
                <div className="flex items-center justify-between text-xs py-1.5 px-2 rounded bg-[var(--surface-3)]/30">
                  <span className="text-[var(--brand-text)]">Bounce rate change</span>
                  <span className={`font-medium ${comparison.change.bounceRate < 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {comparison.change.bounceRate > 0 ? '+' : ''}{comparison.change.bounceRate}pt
                  </span>
                </div>
              )}
            </div>
          </SectionCard>
        )}

        {/* Engagement Analysis */}
        <SectionCard title="Engagement Analysis" titleIcon={<Icon as={Eye} size="sm" className="text-blue-400" />}>
          <div className="space-y-2">
            {newVsReturning.map(seg => (
              <div key={seg.segment} className="flex items-center justify-between text-xs py-1.5 px-2 rounded bg-[var(--surface-3)]/30">
                <span className="text-[var(--brand-text)] capitalize">{seg.segment} user engagement</span>
                <span className={`font-medium ${seg.engagementRate > 60 ? 'text-emerald-400' : seg.engagementRate > 40 ? 'text-amber-400' : 'text-red-400'}`}>
                  {seg.engagementRate}%
                </span>
              </div>
            ))}
            {topPages.length > 0 && (
              <div className="flex items-center justify-between text-xs py-1.5 px-2 rounded bg-[var(--surface-3)]/30">
                <span className="text-[var(--brand-text)]">Top page avg. engagement</span>
                <span className="text-[var(--brand-text-bright)] font-medium">{formatDuration(topPages[0].avgEngagementTime)}</span>
              </div>
            )}
            {organic && (
              <div className="flex items-center justify-between text-xs py-1.5 px-2 rounded bg-[var(--surface-3)]/30">
                <span className="text-[var(--brand-text)]">Organic avg. engagement</span>
                <span className="text-[var(--brand-text-bright)] font-medium">{formatDuration(organic.avgEngagementTime)}</span>
              </div>
            )}
          </div>
        </SectionCard>
      </div>

      {/* ── 5. Organic vs All Traffic ── */}
      {organic && (
        <SectionCard title="Organic vs All Traffic" titleIcon={<Icon as={Leaf} size="sm" className="text-emerald-400" />}>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <div className="t-caption-sm text-[var(--brand-text-muted)] mb-2">Users</div>
              <div className="flex items-center gap-2 mb-1">
                <div className="h-2 flex-1 bg-[var(--surface-3)] rounded-full overflow-hidden">
                  <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${organic.shareOfTotalUsers}%` }} />
                </div>
                <span className="t-caption-sm text-emerald-400 font-medium w-10 text-right">{organic.shareOfTotalUsers}%</span>
              </div>
              <div className="t-caption-sm text-[var(--brand-text-muted)]">{formatNumber(organic.organicUsers)} of {formatNumber(overview.totalUsers)}</div>
            </div>
            <div>
              <div className="t-caption-sm text-[var(--brand-text-muted)] mb-2">Bounce Rate</div>
              <div className="flex items-center gap-3">
                <div className="text-center flex-1">
                  <div className="text-sm font-bold text-emerald-400">{organic.organicBounceRate}%</div>
                  <div className="t-caption-sm text-[var(--brand-text-muted)]">Organic</div>
                </div>
                <div className="text-[var(--brand-border-hover)]">vs</div>
                <div className="text-center flex-1">
                  <div className="text-sm font-bold text-[var(--brand-text-bright)]">{overview.bounceRate}%</div>
                  <div className="t-caption-sm text-[var(--brand-text-muted)]">All</div>
                </div>
              </div>
            </div>
            <div>
              <div className="t-caption-sm text-[var(--brand-text-muted)] mb-2">Engagement</div>
              <div className="flex items-center gap-3">
                <div className="text-center flex-1">
                  <div className="text-sm font-bold text-emerald-400">{organic.engagementRate}%</div>
                  <div className="t-caption-sm text-[var(--brand-text-muted)]">Organic</div>
                </div>
                <div className="text-[var(--brand-border-hover)]">vs</div>
                <div className="text-center flex-1">
                  <div className="text-sm font-bold text-[var(--brand-text-bright)]">{(100 - overview.bounceRate).toFixed(1)}%</div>
                  <div className="t-caption-sm text-[var(--brand-text-muted)]">All Traffic</div>
                </div>
              </div>
            </div>
          </div>
        </SectionCard>
      )}

      {/* ── 6. Two-column layout — table left, sidebar right ── */}
      <div className="flex flex-col lg:flex-row lg:items-start gap-3">
        {/* Left: Top Pages — height matches sidebar via ref measurement */}
        {/* pr-check-disable-next-line -- brand asymmetric signature on TrafficDetail top-pages card; non-SectionCard chrome */}
        <div
          className="bg-[var(--surface-2)] border border-[var(--brand-border)] flex flex-col overflow-hidden min-w-0 lg:flex-[2] rounded-[var(--radius-signature-lg)]"
          style={{ maxHeight: sidebarHeight > 0 ? `${sidebarHeight}px` : undefined }}
        >
          <div className="flex items-center px-4 py-3 border-b border-[var(--brand-border)] shrink-0">
            <span className="text-sm font-semibold text-[var(--brand-text-bright)]">Top Pages</span>
          </div>
          <div className="space-y-1 overflow-y-auto flex-1 min-h-0 p-2">
            {topPages.map((p, i) => (
              <div key={i} className="flex items-center gap-2 py-1.5 px-2 rounded-[var(--radius-sm)] hover:bg-[var(--surface-3)]/50 min-w-0">
                <span className="t-caption-sm text-[var(--brand-text-muted)] w-5 text-right shrink-0">{i + 1}</span>
                <span className="text-xs text-[var(--brand-text-bright)] flex-1 truncate font-mono min-w-0">{p.path}</span>
                <span className="text-xs text-blue-400 font-medium tabular-nums">{p.pageviews.toLocaleString()}</span>
                <span className="t-caption-sm text-[var(--brand-text-muted)] w-14 text-right">{formatNumber(p.users)} u</span>
              </div>
            ))}
            {topPages.length === 0 && <EmptyState icon={FileText} title="No top pages data" description="No page data available for the selected time period." className="py-4" />}
          </div>
        </div>

        {/* Right: Sidebar cards — ref measured to set table height */}
        <div ref={sidebarRef} className="lg:flex-1 space-y-3">
          <SectionCard title="Traffic Sources">
            <div className="space-y-2 max-h-[200px] overflow-y-auto">
              {(() => {
                const totalSessions = sources.reduce((sum, x) => sum + x.sessions, 0);
                return sources.slice(0, 10).map((s, i) => {
                  const pct = totalSessions > 0 ? (s.sessions / totalSessions) * 100 : 0;
                  return (
                    <div key={i} className="relative">
                      <div className="flex items-center gap-2 py-1.5 px-2 rounded-[var(--radius-sm)] relative z-10">
                        <span className="text-xs text-[var(--brand-text-bright)] flex-1 truncate">{s.source || '(direct)'}{s.medium !== '(none)' ? ` / ${s.medium}` : ''}</span>
                        <span className="text-xs text-blue-400 font-medium tabular-nums">{s.sessions.toLocaleString()}</span>
                        <span className="t-caption-sm text-[var(--brand-text-muted)] w-12 text-right">{pct.toFixed(1)}%</span>
                      </div>
                      <div className="absolute inset-0 rounded-[var(--radius-sm)] bg-blue-500/5" style={{ width: `${pct}%` }} />
                    </div>
                  );
                });
              })()}
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
                      <span className="text-[var(--brand-text-bright)] capitalize">{d.device}</span>
                      <span className="text-[var(--brand-text-muted)]">{d.percentage}%</span>
                    </div>
                    <div className="h-1.5 bg-[var(--surface-3)] rounded-full overflow-hidden">
                      <div className="h-full bg-blue-500 rounded-full transition-all" style={{ width: `${d.percentage}%` }} />
                    </div>
                  </div>
                  <span className="text-xs text-[var(--brand-text-muted)] tabular-nums w-10 text-right">{formatNumber(d.users)}</span>
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
                  const SegIcon = isNew ? UserPlus : UserCheck;
                  return (
                    <div key={seg.segment}>
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-1.5">
                          <Icon as={SegIcon} size="sm" className={isNew ? 'text-cyan-400' : 'text-emerald-400'} />
                          <span className="text-xs text-[var(--brand-text-bright)] capitalize">{seg.segment}</span>
                        </div>
                        <span className="text-xs text-[var(--brand-text-muted)]">{seg.percentage}%</span>
                      </div>
                      <div className="h-1.5 bg-[var(--surface-3)] rounded-full overflow-hidden mb-1">
                        <div className={`h-full rounded-full transition-all ${isNew ? 'bg-cyan-500' : 'bg-emerald-500'}`} style={{ width: `${seg.percentage}%` }} />
                      </div>
                      <div className="flex items-center gap-3 t-caption-sm text-[var(--brand-text-muted)]">
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
      </div>

      {/* ── 9. Events & Conversions (collapsible, collapsed by default) ── */}
      <SectionCard>
        <button
          onClick={() => setEventsExpanded(!eventsExpanded)}
          className="w-full flex items-center justify-between text-sm font-semibold text-[var(--brand-text-bright)]"
        >
          <span>Events &amp; Conversions</span>
          <span className="text-xs text-[var(--brand-text-muted)]">
            {conversions.length} tracked event{conversions.length !== 1 ? 's' : ''} {eventsExpanded ? '▴' : '▾'}
          </span>
        </button>
        {eventsExpanded && (
          <div className="mt-4 space-y-4">
            {/* Key Events grid */}
            {conversions.length > 0 ? (
              <div>
                <div className="text-xs text-[var(--brand-text-muted)] font-medium mb-2 flex items-center gap-1.5">
                  <Icon as={Zap} size="sm" className="text-amber-400" /> Key Events
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                  {conversions.map((c, i) => (
                    <div key={i} className="bg-[var(--surface-3)]/30 border border-[var(--brand-border)] p-3 rounded-[var(--radius-signature)]">
                      <div className="t-caption-sm text-[var(--brand-text)] truncate mb-1">{c.eventName.replace(/_/g, ' ')}</div>
                      <div className="text-xl font-bold text-[var(--brand-text-bright)]">{c.conversions.toLocaleString()}</div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="t-caption-sm text-[var(--brand-text-muted)]">{c.users.toLocaleString()} users</span>
                        {c.rate > 0 && <span className="t-caption-sm font-medium text-emerald-400">{c.rate}%</span>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="text-center py-6">
                <Icon as={Zap} size="2xl" className="text-[var(--brand-border-hover)] mx-auto mb-2" />
                <p className="text-xs text-[var(--brand-text-muted)]">No custom events tracked yet</p>
              </div>
            )}

            {/* Landing Pages table */}
            {landingPages.length > 0 && (
              <div>
                <div className="text-xs text-[var(--brand-text-muted)] font-medium mb-2 flex items-center gap-1.5">
                  <Icon as={ArrowRight} size="sm" className="text-teal-400" /> Top Landing Pages
                </div>
                {/* pr-check-disable-next-line -- brand asymmetric signature on TrafficDetail landing-pages table card; non-SectionCard chrome */}
                <div className="border border-[var(--brand-border)] overflow-hidden rounded-[var(--radius-signature-lg)]">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-[var(--brand-border)] bg-[var(--surface-2)]/50">
                        <th className="text-left py-3 px-4 text-[var(--brand-text-muted)] font-medium">Landing Page</th>
                        <th className="text-right py-3 px-3 text-[var(--brand-text-muted)] font-medium">Sessions</th>
                        <th className="text-right py-3 px-3 text-[var(--brand-text-muted)] font-medium">Users</th>
                        <th className="text-right py-3 px-3 text-[var(--brand-text-muted)] font-medium">Bounce</th>
                        <th className="text-right py-3 px-3 text-[var(--brand-text-muted)] font-medium">Conversions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {landingPages.slice(0, 20).map((p, i) => (
                        <tr key={i} className="border-b border-[var(--brand-border)]/50 hover:bg-[var(--surface-3)]/30">
                          <td className="py-2.5 px-4 text-[var(--brand-text-bright)] truncate max-w-[300px] font-mono">{p.landingPage}</td>
                          <td className="py-2.5 px-3 text-right text-blue-400">{p.sessions.toLocaleString()}</td>
                          <td className="py-2.5 px-3 text-right text-[var(--brand-text)]">{p.users.toLocaleString()}</td>
                          <td className="py-2.5 px-3 text-right">
                            <span className={p.bounceRate > 70 ? 'text-red-400' : p.bounceRate > 50 ? 'text-amber-400' : 'text-emerald-400'}>
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
