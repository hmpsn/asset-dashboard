import { useState, useRef, useEffect } from 'react';
import { Search, ExternalLink, Loader2 } from 'lucide-react';
import { SectionCard, DateRangeSelector, EmptyState, MetricToggleCard, Icon, Button } from './ui';
import { DATE_PRESETS_SEARCH, CHART_SERIES_COLORS, positionColor } from './ui/constants';
import type { FeedInsight } from '../../shared/types/insights';
import { useAdminSearch } from '../hooks/admin';
import { useInsightFeed } from '../hooks/admin/useInsightFeed';
import { useAnalyticsAnnotations, useCreateAnnotation } from '../hooks/admin/useAnalyticsAnnotations';
import { useToggleSet } from '../hooks/useToggleSet';
import { normalizePageUrl } from '../lib/pathUtils';
import { InsightFeed } from './insights';
import { AnnotatedTrendChart } from './charts/AnnotatedTrendChart';
import type { TrendLine, ChartCallout } from './charts/AnnotatedTrendChart';
import { fmtNum } from '../utils/formatNumbers';
import { KeywordTable } from './shared/RankTable';
import type { KeywordTableRow } from './shared/RankTable';

interface Props {
  siteId: string;
  workspaceId: string;
  gscPropertyUrl?: string;
}

type SortKey = 'clicks' | 'impressions' | 'ctr' | 'position';

const SEARCH_LINES: TrendLine[] = [
  { key: 'clicks', color: CHART_SERIES_COLORS.blue, yAxisId: 'left', label: 'Clicks' },
  { key: 'impressions', color: '#22d3ee', yAxisId: 'left', label: 'Impressions' }, // chart-hex-ok — cyan-400 for impressions axis contrast
  { key: 'ctr', color: CHART_SERIES_COLORS.amber, yAxisId: 'right', label: 'CTR %' },
  { key: 'position', color: CHART_SERIES_COLORS.red, yAxisId: 'right', label: 'Avg Position' },
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
  } = useAdminSearch(workspaceId, siteId, gscPropertyUrl, days);

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
              color={CHART_SERIES_COLORS.blue}
              active={activeSearchLines.has('clicks')}
              onClick={() => handleToggleLine('clicks')}
            />
            <MetricToggleCard
              label="Impressions"
              value={fmtNum(overview.totalImpressions)}
              delta={hasDelta ? fmtDelta(comparison!.changePercent.impressions, '%') : '—'}
              deltaPositive={hasDelta ? isDeltaPositive(comparison!.changePercent.impressions) : true}
              color="#22d3ee" // chart-hex-ok — cyan-400 for impressions axis contrast
              active={activeSearchLines.has('impressions')}
              onClick={() => handleToggleLine('impressions')}
            />
            <MetricToggleCard
              label="CTR"
              value={`${overview.avgCtr}%`}
              delta={hasDelta ? fmtDelta(comparison!.change.ctr, 'pt') : '—'}
              deltaPositive={hasDelta ? isDeltaPositive(comparison!.change.ctr) : true}
              color={CHART_SERIES_COLORS.amber}
              active={activeSearchLines.has('ctr')}
              onClick={() => handleToggleLine('ctr')}
            />
            <MetricToggleCard
              label="Position"
              value={overview.avgPosition.toFixed(1)}
              delta={hasDelta ? fmtDelta(comparison!.change.position) : '—'}
              deltaPositive={hasDelta ? isDeltaPositive(comparison!.change.position) : true}
              color={CHART_SERIES_COLORS.red}
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
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className={`text-xs font-semibold pb-1 px-0 py-0 rounded-none bg-transparent hover:bg-transparent ${tableView === 'queries' ? 'text-teal-400 border-b-2 border-teal-400' : 'text-[var(--brand-text-muted)]'}`}
                  onClick={() => setTableView('queries')}
                >
                  Queries
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className={`text-xs font-semibold pb-1 px-0 py-0 rounded-none bg-transparent hover:bg-transparent ${tableView === 'pages' ? 'text-teal-400 border-b-2 border-teal-400' : 'text-[var(--brand-text-muted)]'}`}
                  onClick={() => setTableView('pages')}
                >
                  Pages
                </Button>
              </div>

              {/* Wave 2b B2: raw table → KeywordTable. Chrome changes noted:
                  1. Sticky thead removed (KeywordTable uses overflow-hidden; parent scroll still works).
                  2. Per-row insight tinting (rowTint) removed (KeywordTable has no per-row bg slot).
                  3. Position shows raw decimal with positionColor via renderActions (not rounded #N).
                  4. Page keyword cell shows path + ExternalLink icon via renderKeywordMeta (not a full anchor). */}
              <div className="overflow-y-auto flex-1 min-h-0">
                {tableView === 'queries' && (
                  <KeywordTable<KeywordTableRow>
                    rows={sortByKey(overview.topQueries).map(q => ({
                      query: q.query,
                      clicks: q.clicks,
                      impressions: q.impressions,
                      ctr: q.ctr,
                    }))}
                    columns={['clicks', 'impressions', 'ctr']}
                    sort={{
                      key: sortKey,
                      direction: sortAsc ? 'asc' : 'desc',
                      onSort: (k) => handleSort(k as SortKey),
                    }}
                    emptyState={{ icon: Search, title: 'No queries data', description: 'No search query data available for this period.' }}
                    renderKeywordMeta={(r) => {
                      const badge = badgeMap.get(r.query);
                      return badge ? (
                        <span className={`t-micro font-semibold px-1 py-0.5 rounded-[var(--radius-sm)] ${badge.color} ${badge.bgColor} ml-1 whitespace-nowrap`}>
                          {badge.label}
                        </span>
                      ) : null;
                    }}
                    renderActions={(r) => {
                      const q = overview.topQueries.find(x => x.query === r.query);
                      return q ? <span className={positionColor(q.position)}>{q.position}</span> : null;
                    }}
                    className="rounded-none border-0"
                  />
                )}
                {tableView === 'pages' && (
                  <KeywordTable<KeywordTableRow & { _page: string }>
                    rows={sortByKey(overview.topPages).map(p => ({
                      query: normalizePageUrl(p.page),
                      clicks: p.clicks,
                      impressions: p.impressions,
                      ctr: p.ctr,
                      _page: p.page,
                    }))}
                    columns={['clicks', 'impressions', 'ctr']}
                    sort={{
                      key: sortKey,
                      direction: sortAsc ? 'asc' : 'desc',
                      onSort: (k) => handleSort(k as SortKey),
                    }}
                    emptyState={{ icon: Search, title: 'No pages data', description: 'No page data available for this period.' }}
                    renderKeywordMeta={(r) => {
                      const badge = badgeMap.get(r._page);
                      return (
                        <>
                          <a href={r._page} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 hover:text-teal-400 transition-colors ml-1">
                            <Icon as={ExternalLink} size="sm" className="flex-shrink-0 text-[var(--brand-text-muted)]" />
                          </a>
                          {badge && (
                            <span className={`t-micro font-semibold px-1 py-0.5 rounded-[var(--radius-sm)] ${badge.color} ${badge.bgColor} ml-1 whitespace-nowrap`}>
                              {badge.label}
                            </span>
                          )}
                        </>
                      );
                    }}
                    renderActions={(r) => {
                      const p = overview.topPages.find(x => normalizePageUrl(x.page) === r.query);
                      return p ? <span className={positionColor(p.position)}>{p.position}</span> : null;
                    }}
                    className="rounded-none border-0"
                  />
                )}
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
                          <div className="h-1.5 bg-[var(--surface-3)] rounded-[var(--radius-pill)] overflow-hidden">
                            <div className="h-full bg-blue-500 rounded-[var(--radius-pill)] transition-all" style={{ width: `${pct}%` }} />
                          </div>
                          <div className="flex items-center justify-between t-caption-sm text-[var(--brand-text-muted)] mt-0.5">
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
                      <div key={c.country} className="flex items-center justify-between t-caption-sm py-1 px-2 rounded-[var(--radius-sm)] bg-[var(--surface-3)]/30">
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
                          <div className="h-1.5 bg-[var(--surface-3)] rounded-[var(--radius-pill)] overflow-hidden">
                            <div className="h-full bg-teal-500 rounded-[var(--radius-pill)] transition-all" style={{ width: `${pct}%` }} />
                          </div>
                          <div className="flex items-center justify-between t-caption-sm text-[var(--brand-text-muted)] mt-0.5">
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
