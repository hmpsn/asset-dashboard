import { useState } from 'react';
import { Search, ExternalLink, ArrowUpDown, Loader2 } from 'lucide-react';
import { SectionCard, DateRangeSelector, EmptyState, MetricToggleCard } from './ui';
import { DATE_PRESETS_SEARCH } from './ui/constants';
import type { SearchQuery, SearchPage } from '../../shared/types/analytics';
import type { FeedInsight } from '../../shared/types/insights';
import { useAdminSearch } from '../hooks/admin';
import { useInsightFeed } from '../hooks/admin/useInsightFeed';
import { useAnalyticsAnnotations, useCreateAnnotation } from '../hooks/admin/useAnalyticsAnnotations';
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
  { key: 'impressions', color: '#8b5cf6', yAxisId: 'left', label: 'Impressions' },
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
  const [activeSearchLines, setActiveSearchLines] = useState<Set<string>>(new Set(['clicks', 'impressions']));

  const {
    overview, trend, devices, countries, searchTypes,
    comparison, isLoading, error,
  } = useAdminSearch(siteId, gscPropertyUrl, days);

  const { feed, isLoading: feedLoading } = useInsightFeed(workspaceId);
  const { data: annotations = [] } = useAnalyticsAnnotations(workspaceId);
  const createAnnotation = useCreateAnnotation(workspaceId);

  const handleToggleLine = (key: string) => {
    setActiveSearchLines(prev => {
      const next = new Set(prev);
      if (next.has(key)) {
        if (next.size > 1) next.delete(key);
      } else if (next.size < 3) {
        next.add(key);
      }
      return next;
    });
  };

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

  // Build callout bubbles from ranking drop insights
  const searchFeed = feed.filter(f => f.domain === 'search' || f.domain === 'cross');
  const callouts: ChartCallout[] = searchFeed
    .filter(f => f.type === 'ranking_mover' && (f.severity === 'critical' || f.severity === 'warning'))
    .slice(0, 2)
    .map(f => ({
      date: chartData.length > 0 ? chartData[chartData.length - 1].date : '',
      label: f.headline,
      detail: f.title,
      color: '#ef4444',
    }));

  // Build badge lookup for table rows
  const badgeMap = buildBadgeMap(feed);

  // Comparison delta helpers
  const hasDelta = comparison !== null;
  function fmtDelta(val: number, suffix = ''): string {
    if (!hasDelta) return '\u2014';
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
    <div className="space-y-5">
      {/* Date range selector */}
      <div className="flex items-center justify-end">
        <DateRangeSelector
          options={DATE_PRESETS_SEARCH}
          selected={days}
          onChange={d => setDays(d)}
        />
      </div>

      {error && (
        <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 px-3 py-2 rounded-lg">{error}</div>
      )}

      {isLoading && (
        <div className="flex items-center justify-center py-12 gap-3 text-zinc-500">
          <Loader2 className="w-5 h-5 animate-spin" />
          <p className="text-sm">Loading search data...</p>
        </div>
      )}

      {overview && !isLoading && (
        <>
          {/* Step 1: MetricToggleCards */}
          <div className="grid grid-cols-4 gap-2">
            <MetricToggleCard
              label="Clicks"
              value={fmtNum(overview.totalClicks)}
              delta={hasDelta ? fmtDelta(comparison!.changePercent.clicks, '%') : '\u2014'}
              deltaPositive={hasDelta ? isDeltaPositive(comparison!.changePercent.clicks) : true}
              color="#60a5fa"
              active={activeSearchLines.has('clicks')}
              onClick={() => handleToggleLine('clicks')}
            />
            <MetricToggleCard
              label="Impressions"
              value={fmtNum(overview.totalImpressions)}
              delta={hasDelta ? fmtDelta(comparison!.changePercent.impressions, '%') : '\u2014'}
              deltaPositive={hasDelta ? isDeltaPositive(comparison!.changePercent.impressions) : true}
              color="#8b5cf6"
              active={activeSearchLines.has('impressions')}
              onClick={() => handleToggleLine('impressions')}
            />
            <MetricToggleCard
              label="CTR"
              value={`${overview.avgCtr}%`}
              delta={hasDelta ? fmtDelta(comparison!.change.ctr, 'pt') : '\u2014'}
              deltaPositive={hasDelta ? isDeltaPositive(comparison!.change.ctr) : true}
              color="#f59e0b"
              active={activeSearchLines.has('ctr')}
              onClick={() => handleToggleLine('ctr')}
            />
            <MetricToggleCard
              label="Position"
              value={overview.avgPosition.toFixed(1)}
              delta={hasDelta ? fmtDelta(comparison!.change.position) : '\u2014'}
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
            limit={5}
          />

          {/* Step 5+6+7: Two-column layout — data table + breakdowns sidebar */}
          <div className="grid grid-cols-1 lg:grid-cols-[2fr_1fr] gap-3">
            {/* Left: Data table with inline Queries/Pages toggle */}
            <SectionCard noPadding>
              {/* Inline toggle header */}
              <div className="flex items-center gap-4 px-4 py-2.5 border-b border-zinc-800">
                <button
                  className={`text-xs font-semibold pb-1 ${tableView === 'queries' ? 'text-teal-400 border-b-2 border-teal-400' : 'text-zinc-500'}`}
                  onClick={() => setTableView('queries')}
                >Queries</button>
                <button
                  className={`text-xs font-semibold pb-1 ${tableView === 'pages' ? 'text-teal-400 border-b-2 border-teal-400' : 'text-zinc-500'}`}
                  onClick={() => setTableView('pages')}
                >Pages</button>
              </div>

              <div className="max-h-[450px] overflow-y-auto">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-zinc-900 z-10">
                  <tr className="border-b border-zinc-800">
                    <th className="text-left py-3 px-4 text-zinc-500 font-medium">
                      {tableView === 'queries' ? 'Query' : 'Page'}
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
                  {tableView === 'queries' && sortQueries(overview.topQueries).map((q, i) => {
                    const badge = badgeMap.get(q.query);
                    return (
                      <tr key={i} className={`border-b border-zinc-800/50 hover:bg-zinc-800/30 ${rowTint(badge)}`}>
                        <td className="py-2.5 px-4 text-zinc-300 font-medium">
                          {q.query}
                          {badge && (
                            <span className={`text-[7px] font-semibold px-1 py-0.5 rounded ${badge.color} ${badge.bgColor} ml-1 whitespace-nowrap`}>
                              {badge.label}
                            </span>
                          )}
                        </td>
                        <td className="py-2.5 px-3 text-right text-blue-400 font-semibold">{q.clicks}</td>
                        <td className="py-2.5 px-3 text-right text-zinc-400">{q.impressions.toLocaleString()}</td>
                        <td className="py-2.5 px-3 text-right text-emerald-400">{q.ctr}%</td>
                        <td className="py-2.5 px-3 text-right">
                          <span className={q.position <= 10 ? 'text-green-400' : q.position <= 20 ? 'text-amber-400' : 'text-red-400'}>
                            {q.position}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                  {tableView === 'pages' && sortPages(overview.topPages).map((p, i) => {
                    let pagePath: string;
                    try { pagePath = new URL(p.page).pathname; } catch { pagePath = p.page; }
                    const badge = badgeMap.get(p.page);
                    return (
                      <tr key={i} className={`border-b border-zinc-800/50 hover:bg-zinc-800/30 ${rowTint(badge)}`}>
                        <td className="py-2.5 px-4 text-zinc-300 font-medium max-w-xs truncate">
                          <a href={p.page} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 hover:text-blue-400 transition-colors">
                            {pagePath}
                            <ExternalLink className="w-3 h-3 flex-shrink-0 text-zinc-500" />
                          </a>
                          {badge && (
                            <span className={`text-[7px] font-semibold px-1 py-0.5 rounded ${badge.color} ${badge.bgColor} ml-1 whitespace-nowrap`}>
                              {badge.label}
                            </span>
                          )}
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
            </SectionCard>

            {/* Right: Breakdowns sidebar */}
            <div className="space-y-3">
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
          </div>
        </>
      )}
    </div>
  );
}
