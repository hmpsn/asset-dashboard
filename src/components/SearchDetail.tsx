import { useState, useRef, useEffect } from 'react';
import { Search, ExternalLink, ArrowUpDown, Loader2 } from 'lucide-react';
import { SectionCard, DateRangeSelector, EmptyState, MetricToggleCard, Icon } from './ui';
import { DATE_PRESETS_SEARCH } from './ui/constants';
import type { FeedInsight } from '../../shared/types/insights';
import { useAdminSearch } from '../hooks/admin';
import { useInsightFeed } from '../hooks/admin/useInsightFeed';
import { useAnalyticsAnnotations, useCreateAnnotation } from '../hooks/admin/useAnalyticsAnnotations';
import { useToggleSet } from '../hooks/useToggleSet';
import { InsightFeed } from './insights';
import { AnnotatedTrendChart } from './charts/AnnotatedTrendChart';
import type { TrendLine, ChartCallout } from './charts/AnnotatedTrendChart';
import { fmtNum } from '../utils/formatNumbers';

interface Props {
  siteId: string;
  workspaceId: string;
  gscPropertyUrl?: string;
}

type SortKey = 'clicks' | 'impressions' | 'ctr' | 'position';

const SEARCH_LINES: TrendLine[] = [
  { key: 'clicks', color: '#60a5fa', yAxisId: 'left', label: 'Clicks' },
  { key: 'impressions', color: '#22d3ee', yAxisId: 'left', label: 'Impressions' },
  { key: 'ctr', color: '#f59e0b', yAxisId: 'right', label: 'CTR %' },
  { key: 'position', color: '#ef4444', yAxisId: 'right', label: 'Avg Position' },
];

// ── Insight badge types + builder ──

type InsightBadge = { label: string; color: string; bgColor: string };

function buildBadgeMap(feed: FeedInsight[]): Map<string, InsightBadge> {
  const map = new Map<string, InsightBadge>();
  for (const f of feed) {
    if (f.domain !== 'search' && f.domain !== 'cross') continue;
    const url = f.pageUrl;
    if (!url) continue;
    let badge: InsightBadge | null = null;
    switch (f.type) {
      case 'ctr_opportunity':
        badge = { label: 'LOW CTR', color: 'text-red-400', bgColor: 'bg-red-500/10' }; break;
      case 'ranking_opportunity':
        badge = { label: 'NEAR P1', color: 'text-amber-400', bgColor: 'bg-amber-500/10' }; break;
      case 'cannibalization':
        badge = { label: 'CANNIBAL', color: 'text-amber-400', bgColor: 'bg-amber-500/10' }; break;
      case 'ranking_mover':
        badge = f.severity === 'positive'
          ? { label: 'RANK UP', color: 'text-emerald-400', bgColor: 'bg-emerald-500/10' }
          : { label: 'RANK DROP', color: 'text-red-400', bgColor: 'bg-red-500/10' }; break;
      case 'content_decay':
        badge = { label: 'DECAY', color: 'text-red-400', bgColor: 'bg-red-500/10' }; break;
    }
    if (badge && !map.has(url)) map.set(url, badge);
  }
  return map;
}

// ── Severity tint for table rows ──

function rowTint(badge: InsightBadge | undefined): string {
  if (!badge) return '';
  if (badge.color.includes('red')) return 'bg-red-500/[0.03]';
  if (badge.color.includes('amber')) return 'bg-amber-500/[0.03]';
  if (badge.color.includes('emerald')) return 'bg-emerald-500/[0.03]';
  return '';
}

export function SearchDetail({ siteId, workspaceId, gscPropertyUrl }: Props) {
  const [tableView, setTableView] = useState<'queries' | 'pages'>('queries');
  const [days, setDays] = useState(28);
  const [sortKey, setSortKey] = useState<SortKey>('clicks');
  const [sortAsc, setSortAsc] = useState(false);
  const [activeSearchLines, handleToggleLine] = useToggleSet(['clicks', 'impressions']);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const [sidebarHeight, setSidebarHeight] = useState(0);

  useEffect(() => {
    if (sidebarRef.current) {
      const h = sidebarRef.current.offsetHeight;
      if (h > 0 && h !== sidebarHeight) setSidebarHeight(h);
    }
  });

  const {
    overview, trend, devices, countries, searchTypes,
    comparison, isLoading, error,
  } = useAdminSearch(siteId, gscPropertyUrl, days);

  const { feed, isLoading: feedLoading } = useInsightFeed(workspaceId);
  const { data: annotations = [] } = useAnalyticsAnnotations(workspaceId);
  const createAnnotation = useCreateAnnotation(workspaceId);

  const chartLines = SEARCH_LINES.map(l => ({ ...l, active: activeSearchLines.has(l.key) }));

  // Map PerformanceTrend to chart-compatible format
  // ctr is already a percentage from GSC API (e.g., 6.3 for 6.3%), just round
  const chartData = trend.map(t => ({
    date: t.date,
    clicks: t.clicks,
    impressions: t.impressions,
    ctr: Math.round(t.ctr * 10) / 10,
    position: Math.round(t.position * 10) / 10,
  }));

  // Build callout bubbles from ranking drop insights — pin to insight's detected date or last chart date
  const searchFeed = feed.filter(f => f.domain === 'search' || f.domain === 'cross');
  const lastChartDate = chartData.length > 0 ? chartData[chartData.length - 1].date : '';
  const callouts: ChartCallout[] = searchFeed
    .filter(f => f.type === 'ranking_mover' && (f.severity === 'critical' || f.severity === 'warning'))
    .slice(0, 2)
    .map(f => ({
      date: f.detectedAt?.slice(0, 10) ?? lastChartDate,
      label: f.headline,
      detail: f.title,
      color: '#ef4444',
    }));

  // Build badge lookup for table rows
  const badgeMap = buildBadgeMap(feed);

  // Comparison delta helpers
  const hasDelta = comparison !== null;
  function fmtDelta(val: number, suffix = ''): string {
    if (!hasDelta) return '—';
    const sign = val > 0 ? '+' : '';
    return `${sign}${val.toFixed(1)}${suffix}`;
  }
  function isDeltaPositive(val: number): boolean {
    return val > 0;
  }

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc(!sortAsc);
    else { setSortKey(key); setSortAsc(false); }
  };

  function sortByKey<T extends Record<SortKey, number>>(items: T[]): T[] {
    return [...items].sort((a, b) => {
      const av = a[sortKey]; const bv = b[sortKey];
      return sortAsc ? av - bv : bv - av;
    });
  }

  if (!gscPropertyUrl) {
    return (
      <EmptyState
        icon={Search}
        title="Search Console not configured"
        description="Select a Search Console property in the workspace settings (gear icon) to view search data."
      />
    );
  }

  return (
    <div className="space-y-8">
      {/* Date range selector */}
      <div className="flex items-center justify-end">
        <DateRangeSelector
          options={DATE_PRESETS_SEARCH}
          selected={days}
          onChange={d => setDays(d)}
        />
      </div>

      {error && (
        <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 px-3 py-2 rounded-[var(--radius-sm)]">{error}</div>
      )}

      {isLoading && (
        <div className="flex items-center justify-center py-12 gap-3 text-[var(--brand-text-muted)]">
          <Icon as={Loader2} size="lg" className="animate-spin" />
          <p className="text-sm">Loading search data...</p>
        </div>
      )}

      {overview && !isLoading && (
        <>
          {/* Step 1: MetricToggleCards */}
          <div className="grid grid-cols-4 gap-3">
            <MetricToggleCard
              label="Clicks"
              value={fmtNum(overview.totalClicks)}
              delta={hasDelta ? fmtDelta(comparison!.changePercent.clicks, '%') : '—'}
              deltaPositive={hasDelta ? isDeltaPositive(comparison!.changePercent.clicks) : true}
              color="#60a5fa"
              active={activeSearchLines.has('clicks')}
              onClick={() => handleToggleLine('clicks')}
            />
            <MetricToggleCard
              label="Impressions"
              value={fmtNum(overview.totalImpressions)}
              delta={hasDelta ? fmtDelta(comparison!.changePercent.impressions, '%') : '—'}
              deltaPositive={hasDelta ? isDeltaPositive(comparison!.changePercent.impressions) : true}
              color="#22d3ee"
              active={activeSearchLines.has('impressions')}
              onClick={() => handleToggleLine('impressions')}
            />
            <MetricToggleCard
              label="CTR"
              value={`${overview.avgCtr}%`}
              delta={hasDelta ? fmtDelta(comparison!.change.ctr, 'pt') : '—'}
              deltaPositive={hasDelta ? isDeltaPositive(comparison!.change.ctr) : true}
              color="#f59e0b"
              active={activeSearchLines.has('ctr')}
              onClick={() => handleToggleLine('ctr')}
            />
            <MetricToggleCard
              label="Position"
              value={overview.avgPosition.toFixed(1)}
              delta={hasDelta ? fmtDelta(comparison!.change.position) : '—'}
              deltaPositive={hasDelta ? isDeltaPositive(comparison!.change.position) : true}
              color="#ef4444"
              active={activeSearchLines.has('position')}
              onClick={() => handleToggleLine('position')}
              invertDelta
            />
          </div>

          {/* Step 2: Always-visible chart */}
          {chartData.length > 0 && (
            <SectionCard title="Search Performance Trend">
              <AnnotatedTrendChart
                data={chartData}
                lines={chartLines}
                annotations={annotations}
                dateKey="date"
                height={220}
                callouts={callouts}
                onCreateAnnotation={(date, label, category) =>
                  createAnnotation.mutate({ date, label, category })
                }
                onToggleLine={handleToggleLine}
              />
            </SectionCard>
          )}

          {/* Step 4: Compact search insights feed */}
          <InsightFeed
            feed={feed}
            loading={feedLoading}
            domain="search"
            showFilterChips
            workspaceId={workspaceId}
            limit={5}
          />

          {/* Step 5+6+7: Two-column layout — table left, sidebar right */}
          <div className="flex flex-col lg:flex-row lg:items-start gap-3">
            {/* Left: Data table — height matches sidebar via ref measurement */}
            {/* pr-check-disable-next-line -- brand asymmetric signature on SearchDetail data-table card; non-SectionCard chrome */}
            <div
              className="bg-[var(--surface-2)] border border-[var(--brand-border)] flex flex-col min-w-0 lg:flex-[2] overflow-hidden rounded-[var(--radius-signature-lg)]"
              style={{ maxHeight: sidebarHeight > 0 ? `${sidebarHeight}px` : undefined }}
            >
              {/* Inline toggle header */}
              <div className="flex items-center gap-4 px-4 py-2.5 border-b border-[var(--brand-border)] shrink-0">
                <button
                  className={`text-xs font-semibold pb-1 ${tableView === 'queries' ? 'text-teal-400 border-b-2 border-teal-400' : 'text-[var(--brand-text-muted)]'}`}
                  onClick={() => setTableView('queries')}
                >Queries</button>
                <button
                  className={`text-xs font-semibold pb-1 ${tableView === 'pages' ? 'text-teal-400 border-b-2 border-teal-400' : 'text-[var(--brand-text-muted)]'}`}
                  onClick={() => setTableView('pages')}
                >Pages</button>
              </div>

              <div className="overflow-y-auto flex-1 min-h-0">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-[var(--surface-2)] z-10">
                  <tr className="border-b border-[var(--brand-border)]">
                    <th className="text-left py-3 px-4 text-[var(--brand-text-muted)] font-medium">
                      {tableView === 'queries' ? 'Query' : 'Page'}
                    </th>
                    {(['clicks', 'impressions', 'ctr', 'position'] as SortKey[]).map(key => (
                      <th key={key} className="text-right py-3 px-3 text-[var(--brand-text-muted)] font-medium">
                        <button
                          onClick={() => handleSort(key)}
                          className="flex items-center gap-1 ml-auto hover:text-[var(--brand-text-bright)] transition-colors"
                        >
                          {key === 'ctr' ? 'CTR' : key.charAt(0).toUpperCase() + key.slice(1)}
                          {sortKey === key && <Icon as={ArrowUpDown} size="sm" />}
                        </button>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {tableView === 'queries' && sortByKey(overview.topQueries).map((q, i) => {
                    const badge = badgeMap.get(q.query);
                    return (
                      <tr key={i} className={`border-b border-[var(--brand-border)]/50 hover:bg-[var(--surface-3)]/30 ${rowTint(badge)}`}>
                        <td className="py-2.5 px-4 text-[var(--brand-text-bright)] font-medium">
                          {q.query}
                          {badge && (
                            <span className={`t-micro font-semibold px-1 py-0.5 rounded ${badge.color} ${badge.bgColor} ml-1 whitespace-nowrap`}>
                              {badge.label}
                            </span>
                          )}
                        </td>
                        <td className="py-2.5 px-3 text-right text-blue-400 font-semibold">{q.clicks}</td>
                        <td className="py-2.5 px-3 text-right text-[var(--brand-text)]">{q.impressions.toLocaleString()}</td>
                        <td className="py-2.5 px-3 text-right text-emerald-400">{q.ctr}%</td>
                        <td className="py-2.5 px-3 text-right">
                          <span className={q.position <= 10 ? 'text-emerald-400' : q.position <= 20 ? 'text-amber-400' : 'text-red-400'}>
                            {q.position}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                  {tableView === 'pages' && sortByKey(overview.topPages).map((p, i) => {
                    let pagePath: string;
                    try { pagePath = new URL(p.page).pathname; } catch { pagePath = p.page; }
                    const badge = badgeMap.get(p.page);
                    return (
                      <tr key={i} className={`border-b border-[var(--brand-border)]/50 hover:bg-[var(--surface-3)]/30 ${rowTint(badge)}`}>
                        <td className="py-2.5 px-4 text-[var(--brand-text-bright)] font-medium max-w-xs truncate">
                          <a href={p.page} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 hover:text-blue-400 transition-colors">
                            {pagePath}
                            <Icon as={ExternalLink} size="sm" className="flex-shrink-0 text-[var(--brand-text-muted)]" />
                          </a>
                          {badge && (
                            <span className={`t-micro font-semibold px-1 py-0.5 rounded ${badge.color} ${badge.bgColor} ml-1 whitespace-nowrap`}>
                              {badge.label}
                            </span>
                          )}
                        </td>
                        <td className="py-2.5 px-3 text-right text-blue-400 font-semibold">{p.clicks}</td>
                        <td className="py-2.5 px-3 text-right text-[var(--brand-text)]">{p.impressions.toLocaleString()}</td>
                        <td className="py-2.5 px-3 text-right text-emerald-400">{p.ctr}%</td>
                        <td className="py-2.5 px-3 text-right">
                          <span className={p.position <= 10 ? 'text-emerald-400' : p.position <= 20 ? 'text-amber-400' : 'text-red-400'}>
                            {p.position}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                  {tableView === 'queries' && overview.topQueries.length === 0 && (
                    <tr><td colSpan={5} className="py-8"><EmptyState icon={Search} title="No queries data" description="No search query data available for this period." /></td></tr>
                  )}
                  {tableView === 'pages' && overview.topPages.length === 0 && (
                    <tr><td colSpan={5} className="py-8"><EmptyState icon={Search} title="No pages data" description="No page data available for this period." /></td></tr>
                  )}
                </tbody>
              </table>
              </div>
            </div>

            {/* Right: Sidebar cards — ref measured to set table height */}
            <div ref={sidebarRef} className="lg:flex-1 space-y-3">
              {devices.length > 0 && (
                <SectionCard title="Devices">
                  <div className="space-y-2.5">
                    {devices.map(d => {
                      const totalClicks = devices.reduce((s, x) => s + x.clicks, 0);
                      const pct = totalClicks > 0 ? ((d.clicks / totalClicks) * 100).toFixed(0) : '0';
                      return (
                        <div key={d.device}>
                          <div className="flex items-center justify-between t-caption-sm mb-1">
                            <span className="text-[var(--brand-text-bright)] capitalize">{d.device.toLowerCase()}</span>
                            <span className="text-[var(--brand-text-muted)]">{pct}% · pos {d.position}</span>
                          </div>
                          <div className="h-1.5 bg-[var(--surface-3)] rounded-full overflow-hidden">
                            <div className="h-full bg-blue-500 rounded-full transition-all" style={{ width: `${pct}%` }} />
                          </div>
                          <div className="flex items-center justify-between t-caption-sm text-[var(--brand-text-dim)] mt-0.5">
                            <span>{d.clicks.toLocaleString()} clicks</span>
                            <span>{d.ctr}% CTR</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </SectionCard>
              )}

              {countries.length > 0 && (
                <SectionCard title="Top Countries">
                  <div className="space-y-1.5">
                    {countries.slice(0, 8).map((c, i) => (
                      <div key={c.country} className="flex items-center justify-between t-caption-sm py-1 px-2 rounded bg-[var(--surface-3)]/30">
                        <div className="flex items-center gap-2">
                          <span className="text-[var(--brand-text-dim)] w-3 text-right">{i + 1}</span>
                          <span className="text-[var(--brand-text-bright)]">{c.country}</span>
                        </div>
                        <div className="flex items-center gap-3 text-[var(--brand-text-muted)]">
                          <span>{c.clicks.toLocaleString()} clicks</span>
                          <span className="text-[var(--brand-text-dim)]">pos {c.position}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </SectionCard>
              )}

              {searchTypes.length > 0 && (
                <SectionCard title="Search Types">
                  <div className="space-y-2.5">
                    {searchTypes.map(st => {
                      const totalClicks = searchTypes.reduce((s, x) => s + x.clicks, 0);
                      const pct = totalClicks > 0 ? ((st.clicks / totalClicks) * 100).toFixed(0) : '0';
                      return (
                        <div key={st.searchType}>
                          <div className="flex items-center justify-between t-caption-sm mb-1">
                            <span className="text-[var(--brand-text-bright)] capitalize">{st.searchType}</span>
                            <span className="text-[var(--brand-text-muted)]">{pct}%</span>
                          </div>
                          <div className="h-1.5 bg-[var(--surface-3)] rounded-full overflow-hidden">
                            <div className="h-full bg-teal-500 rounded-full transition-all" style={{ width: `${pct}%` }} />
                          </div>
                          <div className="flex items-center justify-between t-caption-sm text-[var(--brand-text-dim)] mt-0.5">
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
          </div>
        </>
      )}
    </div>
  );
}
