import { useState } from 'react';
import {
  Search, Target, Shield, TrendingDown, AlertTriangle,
  ArrowUpDown, Activity, ChevronDown, ChevronRight, Sparkles, Table2,
} from 'lucide-react';
import { RankTrackingSection } from '../shared/RankTable';
import { CompactStatBar, EmptyState, SectionCard } from '../ui';
import { DualTrendChart, InsightCard } from './helpers';
import { Explainer } from './SeoGlossary';
import type {
  SearchOverview, PerformanceTrend, SearchComparison, SortKey,
} from './types';

interface SearchInsights {
  lowHanging: { query: string; position: number; impressions: number; clicks: number; ctr: number }[];
  topPerformers: { query: string; position: number; clicks: number; impressions: number; ctr: number }[];
  ctrOpps: { query: string; position: number; ctr: number; impressions: number; clicks: number }[];
  highImpLowClick: { query: string; impressions: number; clicks: number; position: number; ctr: number }[];
  page1: number;
  top3: number;
}

interface SearchTabProps {
  overview: SearchOverview | null;
  searchComparison: SearchComparison | null;
  trend: PerformanceTrend[];
  annotations: { id: string; date: string; label: string; description?: string; color?: string }[];
  rankHistory: { date: string; positions: Record<string, number> }[];
  latestRanks: { query: string; position: number; clicks: number; impressions: number; ctr: number; change?: number }[];
  insights: SearchInsights | null;
}

function buildTakeaway(overview: SearchOverview, comparison: SearchComparison | null, insights: SearchInsights | null): string {
  const parts: string[] = [];
  if (comparison) {
    const clickDelta = comparison.changePercent.clicks;
    if (clickDelta > 10) parts.push(`Clicks are up ${clickDelta}% — nice momentum.`);
    else if (clickDelta < -10) parts.push(`Clicks dropped ${Math.abs(clickDelta)}% — worth investigating.`);
    else parts.push('Traffic is holding steady.');
  }
  if (insights) {
    if (insights.lowHanging.length > 3) parts.push(`${insights.lowHanging.length} keywords are close to page 1 — easy wins.`);
    if (insights.ctrOpps.length > 2) parts.push(`${insights.ctrOpps.length} page-1 keywords have low CTR — title/description improvements could help.`);
    if (insights.top3 >= 5) parts.push(`${insights.top3} keywords in top 3 — strong authority.`);
  }
  if (parts.length === 0) parts.push(`Your site received ${overview.totalClicks.toLocaleString()} clicks from ${overview.totalImpressions.toLocaleString()} impressions this period.`);
  return parts.join(' ');
}

export function SearchTab({
  overview, searchComparison, trend, annotations,
  rankHistory, latestRanks, insights,
}: SearchTabProps) {
  const [sortKey, setSortKey] = useState<SortKey>('clicks');
  const [sortAsc, setSortAsc] = useState(false);
  const [searchSubTab, setSearchSubTab] = useState<'queries' | 'pages'>('queries');
  const [showRawData, setShowRawData] = useState(false);

  const handleSort = (key: SortKey) => { if (sortKey === key) setSortAsc(!sortAsc); else { setSortKey(key); setSortAsc(false); } };
  const sortedQueries = () => {
    if (!overview) return [];
    return [...overview.topQueries].sort((a, b) => sortAsc ? a[sortKey] - b[sortKey] : b[sortKey] - a[sortKey]);
  };
  const sortedPages = () => {
    if (!overview) return [];
    return [...overview.topPages].sort((a, b) => sortAsc ? a[sortKey] - b[sortKey] : b[sortKey] - a[sortKey]);
  };

  if (!overview) {
    return <EmptyState icon={Search} title="Search data coming soon" description="Once Google Search Console is connected, you'll see how people find your site through Google — keywords, clicks, and ranking positions." />;
  }

  const insightCards = insights ? [
    insights.lowHanging.length > 0 ? { icon: Target, color: 'amber', title: 'Low-Hanging Fruit', count: insights.lowHanging.length, desc: 'Ranking 5-20 with impressions — push to page 1', items: insights.lowHanging.slice(0, 8).map(q => ({ label: q.query, value: `#${q.position}`, sub: `${q.impressions} imp` })) } : null,
    insights.topPerformers.length > 0 ? { icon: Shield, color: 'green', title: 'Top Performers', count: insights.topPerformers.length, desc: 'Top 3 with real clicks — protect these', items: insights.topPerformers.slice(0, 8).map(q => ({ label: q.query, value: `#${q.position}`, sub: `${q.clicks} clicks` })) } : null,
    insights.ctrOpps.length > 0 ? { icon: TrendingDown, color: 'red', title: 'CTR Opportunities', count: insights.ctrOpps.length, desc: 'Page 1 but CTR under 3%', items: insights.ctrOpps.slice(0, 8).map(q => ({ label: q.query, value: `${q.ctr}% CTR`, sub: `#${q.position}` })) } : null,
    insights.highImpLowClick.length > 0 ? { icon: AlertTriangle, color: 'orange', title: 'Visibility Without Clicks', count: insights.highImpLowClick.length, desc: '100+ impressions, under 5 clicks', items: insights.highImpLowClick.slice(0, 8).map(q => ({ label: q.query, value: `${q.clicks} clicks`, sub: `${q.impressions} imp` })) } : null,
  ].filter(Boolean) as { icon: React.ComponentType<{ className?: string }>; color: string; title: string; count: number; desc: string; items: { label: string; value: string; sub: string }[] }[] : [];

  return (<>
    {/* Header with takeaway */}
    <div className="mb-2">
      <h2 className="text-xl font-semibold text-zinc-100">Search Performance</h2>
      <p className="text-sm text-zinc-500 mt-1">{overview.dateRange.start} — {overview.dateRange.end}</p>
    </div>

    {/* AI-style takeaway */}
    {/* pr-check-disable-next-line -- AI takeaway summary bar; compact bar with no section header */}
    <div className="bg-zinc-900/60 border border-zinc-800 rounded-xl px-5 py-3.5 flex items-start gap-3">
      <Sparkles className="w-4 h-4 text-teal-400 mt-0.5 shrink-0" />
      <p className="text-xs text-zinc-300 leading-relaxed">{buildTakeaway(overview, searchComparison, insights)}</p>
    </div>

    {/* Compact metrics bar */}
    <CompactStatBar items={[
      { label: 'Clicks', value: overview.totalClicks.toLocaleString(), valueColor: 'text-blue-400', sub: searchComparison ? `${searchComparison.changePercent.clicks > 0 ? '+' : ''}${searchComparison.changePercent.clicks}%` : undefined, subColor: searchComparison ? (searchComparison.changePercent.clicks >= 0 ? 'text-emerald-400' : 'text-red-400') : undefined },
      { label: 'Impressions', value: overview.totalImpressions.toLocaleString(), valueColor: 'text-teal-400', sub: searchComparison ? `${searchComparison.changePercent.impressions > 0 ? '+' : ''}${searchComparison.changePercent.impressions}%` : undefined, subColor: searchComparison ? (searchComparison.changePercent.impressions >= 0 ? 'text-emerald-400' : 'text-red-400') : undefined },
      { label: 'CTR', value: `${overview.avgCtr}%`, valueColor: 'text-emerald-400', sub: searchComparison ? `${searchComparison.change.ctr > 0 ? '+' : ''}${searchComparison.change.ctr}pp` : undefined, subColor: searchComparison ? (searchComparison.change.ctr >= 0 ? 'text-emerald-400' : 'text-red-400') : undefined },
      { label: 'Avg Position', value: String(overview.avgPosition), valueColor: 'text-amber-400', sub: searchComparison ? `${searchComparison.change.position < 0 ? '↑' : searchComparison.change.position > 0 ? '↓' : ''}${Math.abs(searchComparison.change.position)}` : undefined, subColor: searchComparison ? (searchComparison.change.position <= 0 ? 'text-emerald-400' : 'text-red-400') : undefined },
    ]} />

    {/* Insights — the hero section */}
    {insights && (
      <div className="space-y-3">
        {/* Search Health Summary */}
        <SectionCard title="Search Health Summary">

          <div className="grid grid-cols-4 gap-3">
            <div className="text-center">
              <div className={`text-lg font-bold ${insights.page1 > 5 ? 'text-green-400' : 'text-amber-400'}`}>{insights.page1}</div>
              <div className="text-[11px] text-zinc-500">Page 1 Rankings</div>
              <div className={`text-[10px] mt-0.5 ${insights.page1 >= 10 ? 'text-green-400/70' : insights.page1 >= 3 ? 'text-amber-400/70' : 'text-zinc-600'}`}>{insights.page1 >= 10 ? 'Strong visibility' : insights.page1 >= 3 ? 'Room to grow' : 'Building up'}</div>
            </div>
            <div className="text-center">
              <div className={`text-lg font-bold ${insights.top3 > 2 ? 'text-green-400' : 'text-amber-400'}`}>{insights.top3}</div>
              <div className="text-[11px] text-zinc-500">Top 3 Rankings</div>
              <div className={`text-[10px] mt-0.5 ${insights.top3 >= 5 ? 'text-green-400/70' : insights.top3 >= 1 ? 'text-amber-400/70' : 'text-zinc-600'}`}>{insights.top3 >= 5 ? 'Dominant positions' : insights.top3 >= 1 ? 'Competitive' : 'Opportunity ahead'}</div>
            </div>
            <div className="text-center">
              <div className={`text-lg font-bold ${overview.avgCtr > 3 ? 'text-green-400' : overview.avgCtr > 1.5 ? 'text-amber-400' : 'text-red-400'}`}>{overview.avgCtr}%</div>
              <div className="text-[11px] text-zinc-500 flex items-center justify-center gap-0.5">Avg CTR<Explainer term="ctr" /></div>
              <div className={`text-[10px] mt-0.5 ${overview.avgCtr > 3 ? 'text-green-400/70' : overview.avgCtr > 1.5 ? 'text-amber-400/70' : 'text-red-400/70'}`}>{overview.avgCtr > 3 ? 'Above average' : overview.avgCtr > 1.5 ? 'Typical range' : 'Needs attention'}</div>
            </div>
            <div className="text-center">
              <div className={`text-lg font-bold ${insights.lowHanging.length > 0 ? 'text-amber-400' : 'text-green-400'}`}>{insights.lowHanging.length}</div>
              <div className="text-[11px] text-zinc-500">Opportunities</div>
              <div className={`text-[10px] mt-0.5 ${insights.lowHanging.length > 5 ? 'text-amber-400/70' : insights.lowHanging.length > 0 ? 'text-teal-400/70' : 'text-green-400/70'}`}>{insights.lowHanging.length > 5 ? 'Quick wins available' : insights.lowHanging.length > 0 ? 'A few to capture' : 'Fully optimized'}</div>
            </div>
          </div>
        </SectionCard>

        {/* Insight cards — full-width for 1, 2-col for 2+ */}
        {insightCards.length === 1 ? (
          <InsightCard {...insightCards[0]} />
        ) : insightCards.length > 1 ? (
          <div className="grid grid-cols-2 gap-3">
            {insightCards.map((card, i) => <InsightCard key={i} {...card} />)}
          </div>
        ) : null}
      </div>
    )}

    {/* Trend chart */}
    {trend.length > 2 && (
      <SectionCard title="Performance Trend" titleExtra={<span className="text-[11px] text-zinc-500">{overview.dateRange.start} — {overview.dateRange.end}</span>}>
        <DualTrendChart data={trend} annotations={annotations} />
      </SectionCard>
    )}

    {/* Rank Tracking */}
    <RankTrackingSection rankHistory={rankHistory} latestRanks={latestRanks} />

    {/* Annotations (read-only, managed from admin) */}
    {annotations.length > 0 && (
      <SectionCard title="Timeline Annotations" titleIcon={<Activity className="w-4 h-4 text-zinc-400" />} titleExtra={<span className="text-[11px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-500">{annotations.length}</span>}>
        <div className="space-y-1.5">
          {annotations.map(ann => (
            <div key={ann.id} className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-zinc-950/50">
              <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: ann.color || '#2dd4bf' }} />
              <span className="text-[11px] text-zinc-500 flex-shrink-0">{ann.date}</span>
              <span className="text-xs text-zinc-300 flex-1 truncate">{ann.label}</span>
              {ann.description && <span className="text-[11px] text-zinc-500 truncate max-w-[120px]">{ann.description}</span>}
            </div>
          ))}
        </div>
      </SectionCard>
    )}

    {/* Raw data tables — collapsible, secondary */}
    {/* pr-check-disable-next-line -- Collapsible raw-data table wrapper with custom toggle button; not a static section card */}
    <div className="bg-zinc-900 rounded-xl border border-zinc-800 overflow-hidden">
      <button
        onClick={() => setShowRawData(!showRawData)}
        className="w-full px-5 py-3.5 flex items-center gap-2 hover:bg-zinc-800/30 transition-colors text-left"
      >
        {showRawData ? <ChevronDown className="w-3.5 h-3.5 text-zinc-500" /> : <ChevronRight className="w-3.5 h-3.5 text-zinc-500" />}
        <Table2 className="w-4 h-4 text-zinc-400" />
        <span className="text-sm font-medium text-zinc-300">Raw Data</span>
        <span className="text-[11px] text-zinc-500 ml-1">{overview.topQueries.length} queries, {overview.topPages.length} pages</span>
      </button>
      {showRawData && (
        <>
          <div className="flex items-center gap-1 px-4 pb-1 border-t border-zinc-800">
            {(['queries', 'pages'] as const).map(st => (
              <button key={st} onClick={() => setSearchSubTab(st)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${searchSubTab === st ? 'bg-zinc-700 text-zinc-200' : 'text-zinc-500 hover:text-zinc-300'}`}
              >{st === 'queries' ? 'Queries' : 'Pages'}</button>
            ))}
          </div>
          <table className="w-full text-xs">
            <thead><tr className="border-b border-zinc-800">
              <th className="text-left py-3 px-4 text-zinc-500 font-medium">{searchSubTab === 'queries' ? 'Query' : 'Page'}</th>
              {(['clicks', 'impressions', 'ctr', 'position'] as SortKey[]).map(key => (
                <th key={key} className="text-right py-3 px-3 text-zinc-500 font-medium">
                  <button onClick={() => handleSort(key)} className="flex items-center gap-1 ml-auto hover:text-zinc-300">
                    {key === 'ctr' ? 'CTR' : key.charAt(0).toUpperCase() + key.slice(1)}
                    <Explainer term={key === 'ctr' ? 'ctr' : key} />
                    {sortKey === key && <ArrowUpDown className="w-3 h-3" />}
                  </button>
                </th>
              ))}
            </tr></thead>
            <tbody>
              {searchSubTab === 'queries' && sortedQueries().map((q, i) => (
                <tr key={i} className="border-b border-zinc-800/50 hover:bg-zinc-800/30">
                  <td className="py-2.5 px-4 text-zinc-300 font-medium">{q.query}</td>
                  <td className="py-2.5 px-3 text-right text-blue-400 font-semibold">{q.clicks}</td>
                  <td className="py-2.5 px-3 text-right text-zinc-400">{q.impressions.toLocaleString()}</td>
                  <td className="py-2.5 px-3 text-right text-emerald-400">{q.ctr}%</td>
                  <td className="py-2.5 px-3 text-right"><span className={q.position <= 10 ? 'text-green-400' : q.position <= 20 ? 'text-amber-400' : 'text-red-400'}>{q.position}</span></td>
                </tr>
              ))}
              {searchSubTab === 'pages' && sortedPages().map((p, i) => {
                let pagePath: string;
                try { pagePath = new URL(p.page).pathname; } catch { pagePath = p.page; }
                return (
                  <tr key={i} className="border-b border-zinc-800/50 hover:bg-zinc-800/30">
                    <td className="py-2.5 px-4 text-zinc-300 font-medium max-w-xs truncate">{pagePath}</td>
                    <td className="py-2.5 px-3 text-right text-blue-400 font-semibold">{p.clicks}</td>
                    <td className="py-2.5 px-3 text-right text-zinc-400">{p.impressions.toLocaleString()}</td>
                    <td className="py-2.5 px-3 text-right text-emerald-400">{p.ctr}%</td>
                    <td className="py-2.5 px-3 text-right"><span className={p.position <= 10 ? 'text-green-400' : p.position <= 20 ? 'text-amber-400' : 'text-red-400'}>{p.position}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </>
      )}
    </div>
  </>);
}
