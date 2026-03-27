import { useState } from 'react';
import { Search, ExternalLink, ArrowUpDown, Loader2, Target, FileText } from 'lucide-react';
import { SectionCard, TabBar, DateRangeSelector, EmptyState } from './ui';
import { DATE_PRESETS_SEARCH } from './ui/constants';
import type { SearchQuery, SearchPage } from '../../shared/types/analytics';
import { useAdminSearch } from '../hooks/admin';
import { useInsightFeed } from '../hooks/admin/useInsightFeed';
import { useAnalyticsAnnotations, useCreateAnnotation } from '../hooks/admin/useAnalyticsAnnotations';
import { InsightFeed } from './insights';
import { AnnotatedTrendChart } from './charts/AnnotatedTrendChart';
import type { TrendLine } from './charts/AnnotatedTrendChart';

interface Props {
  siteId: string;
  workspaceId: string;
  gscPropertyUrl?: string;
}

type SortKey = 'clicks' | 'impressions' | 'ctr' | 'position';
type DataTab = 'insights' | 'queries' | 'pages';

const SEARCH_LINES: TrendLine[] = [
  { key: 'clicks', color: '#60a5fa', yAxisId: 'left', label: 'Clicks' },
  { key: 'impressions', color: '#8b5cf6', yAxisId: 'left', label: 'Impressions' },
  { key: 'ctr', color: '#f59e0b', yAxisId: 'right', label: 'CTR %' },
  { key: 'position', color: '#ef4444', yAxisId: 'right', label: 'Avg Position' },
];

export function SearchDetail({ siteId, workspaceId, gscPropertyUrl }: Props) {
  const [tab, setTab] = useState<DataTab>('insights');
  const [days, setDays] = useState(28);
  const [sortKey, setSortKey] = useState<SortKey>('clicks');
  const [sortAsc, setSortAsc] = useState(false);
  const [activeSearchLines, setActiveSearchLines] = useState<Set<string>>(new Set(['clicks', 'impressions']));

  const {
    overview, trend, devices, countries, searchTypes,
    isLoading, error,
  } = useAdminSearch(siteId, gscPropertyUrl, days);

  const { feed, isLoading: feedLoading } = useInsightFeed(workspaceId);
  const { data: annotations = [] } = useAnalyticsAnnotations(workspaceId);
  const createAnnotation = useCreateAnnotation(workspaceId);

  const handleToggleLine = (key: string) => {
    setActiveSearchLines(prev => {
      const next = new Set(prev);
      if (next.has(key)) {
        if (next.size > 1) next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const chartLines = SEARCH_LINES.map(l => ({ ...l, active: activeSearchLines.has(l.key) }));

  // Map PerformanceTrend to chart-compatible format (ctr already as decimal, convert to %)
  const chartData = trend.map(t => ({
    date: t.date,
    clicks: t.clicks,
    impressions: t.impressions,
    ctr: Math.round(t.ctr * 100 * 10) / 10,
    position: Math.round(t.position * 10) / 10,
  }));

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
          {/* Device + Country + Search Type breakdowns */}
          {(devices.length > 0 || countries.length > 0 || searchTypes.length > 0) && (
            <div className="grid grid-cols-3 gap-3">
              {/* Device breakdown */}
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

              {/* Country breakdown */}
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

              {/* Search type breakdown */}
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
          )}

          {/* Tab navigation */}
          <TabBar
            tabs={[
              { id: 'insights', label: 'Search Insights', icon: Target },
              { id: 'queries', label: 'Queries', icon: Search },
              { id: 'pages', label: 'Pages', icon: FileText },
            ]}
            active={tab}
            onChange={id => setTab(id as DataTab)}
          />

          {/* Insights tab */}
          {tab === 'insights' && (
            <>
              {chartData.length > 0 && (
                <SectionCard title="Search Performance Trend">
                  <AnnotatedTrendChart
                    data={chartData}
                    lines={chartLines}
                    annotations={annotations}
                    dateKey="date"
                    height={220}
                    onCreateAnnotation={(date, label, category) =>
                      createAnnotation.mutate({ date, label, category })
                    }
                    onToggleLine={handleToggleLine}
                  />
                </SectionCard>
              )}
              <InsightFeed
                feed={feed}
                loading={feedLoading}
                domain="search"
                showFilterChips
              />
            </>
          )}

          {/* Data tables */}
          {(tab === 'queries' || tab === 'pages') && (
            <SectionCard noPadding>
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-zinc-800">
                    <th className="text-left py-3 px-4 text-zinc-500 font-medium">
                      {tab === 'queries' ? 'Query' : 'Page'}
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
                  {tab === 'queries' && sortQueries(overview.topQueries).map((q, i) => (
                    <tr key={i} className="border-b border-zinc-800/50 hover:bg-zinc-800/30">
                      <td className="py-2.5 px-4 text-zinc-300 font-medium">{q.query}</td>
                      <td className="py-2.5 px-3 text-right text-blue-400 font-semibold">{q.clicks}</td>
                      <td className="py-2.5 px-3 text-right text-zinc-400">{q.impressions.toLocaleString()}</td>
                      <td className="py-2.5 px-3 text-right text-emerald-400">{q.ctr}%</td>
                      <td className="py-2.5 px-3 text-right">
                        <span className={q.position <= 10 ? 'text-green-400' : q.position <= 20 ? 'text-amber-400' : 'text-red-400'}>
                          {q.position}
                        </span>
                      </td>
                    </tr>
                  ))}
                  {tab === 'pages' && sortPages(overview.topPages).map((p, i) => {
                    let pagePath: string;
                    try { pagePath = new URL(p.page).pathname; } catch { pagePath = p.page; }
                    return (
                      <tr key={i} className="border-b border-zinc-800/50 hover:bg-zinc-800/30">
                        <td className="py-2.5 px-4 text-zinc-300 font-medium max-w-xs truncate">
                          <a href={p.page} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 hover:text-blue-400 transition-colors">
                            {pagePath}
                            <ExternalLink className="w-3 h-3 flex-shrink-0 text-zinc-500" />
                          </a>
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
            </SectionCard>
          )}
        </>
      )}
    </div>
  );
}
