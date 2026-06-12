import { useState } from 'react';
import {
  Search, Target, Shield, TrendingDown, AlertTriangle,
  Activity, ChevronDown, ChevronRight, Sparkles, Table2,
} from 'lucide-react';
import { KeywordTable, RankTrackingSection } from '../shared/RankTable';
import type { KeywordTableRow } from '../shared/RankTable';
import { CompactStatBar, EmptyState, SectionCard, Icon, ClickableRow, Button, FreshnessStamp, type Tier } from '../ui';
import { DualTrendChart, InsightCard } from './helpers';
import { CompetitorGapsSection } from './CompetitorGapsSection';
import { Explainer } from './SeoGlossary';
import type {
  SearchOverview, PerformanceTrend, SearchComparison, SortKey,
} from './types';
import { normalizePageUrl } from '../../lib/pathUtils';

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
  dataUpdatedAt?: number | null;
  /** For the Premium competitor-gap section (self-fetching, tier-gated). */
  workspaceId?: string;
  tier?: Tier;
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
  rankHistory, latestRanks, insights, dataUpdatedAt,
  workspaceId, tier,
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
    insights.topPerformers.length > 0 ? { icon: Shield, color: 'emerald', title: 'Top Performers', count: insights.topPerformers.length, desc: 'Top 3 with real clicks — protect these', items: insights.topPerformers.slice(0, 8).map(q => ({ label: q.query, value: `#${q.position}`, sub: `${q.clicks} clicks` })) } : null,
    insights.ctrOpps.length > 0 ? { icon: TrendingDown, color: 'red', title: 'CTR Opportunities', count: insights.ctrOpps.length, desc: 'Page 1 but CTR under 3%', items: insights.ctrOpps.slice(0, 8).map(q => ({ label: q.query, value: `${q.ctr}% CTR`, sub: `#${q.position}` })) } : null,
    insights.highImpLowClick.length > 0 ? { icon: AlertTriangle, color: 'amber', title: 'Visibility Without Clicks', count: insights.highImpLowClick.length, desc: '100+ impressions, under 5 clicks', items: insights.highImpLowClick.slice(0, 8).map(q => ({ label: q.query, value: `${q.clicks} clicks`, sub: `${q.impressions} imp` })) } : null,
  ].filter(Boolean) as { icon: React.ComponentType<{ className?: string }>; color: string; title: string; count: number; desc: string; items: { label: string; value: string; sub: string }[] }[] : [];

  return (<>
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <p className="t-caption-sm text-[var(--brand-text-muted)]">{overview.dateRange.start} — {overview.dateRange.end}</p>
      <FreshnessStamp value={dataUpdatedAt} />
    </div>

    {/* AI-style takeaway */}
    <SectionCard variant="subtle" noPadding>
      <div className="px-5 py-3.5 flex items-start gap-3">
        <Icon as={Sparkles} size="md" className="text-accent-brand mt-0.5 shrink-0" />
        <p className="t-body text-[var(--brand-text)] leading-relaxed">{buildTakeaway(overview, searchComparison, insights)}</p>
      </div>
    </SectionCard>

    {/* Compact metrics bar */}
    <CompactStatBar items={[
      { label: 'Clicks', value: overview.totalClicks.toLocaleString(), valueColor: 'text-accent-info', sub: searchComparison ? `${searchComparison.changePercent.clicks > 0 ? '+' : ''}${searchComparison.changePercent.clicks}%` : undefined, subColor: searchComparison ? (searchComparison.changePercent.clicks >= 0 ? 'text-accent-success' : 'text-accent-danger') : undefined },
      { label: 'Impressions', value: overview.totalImpressions.toLocaleString(), valueColor: 'text-accent-info', sub: searchComparison ? `${searchComparison.changePercent.impressions > 0 ? '+' : ''}${searchComparison.changePercent.impressions}%` : undefined, subColor: searchComparison ? (searchComparison.changePercent.impressions >= 0 ? 'text-accent-success' : 'text-accent-danger') : undefined },
      { label: 'CTR', value: `${overview.avgCtr}%`, valueColor: 'text-accent-success', sub: searchComparison ? `${searchComparison.change.ctr > 0 ? '+' : ''}${searchComparison.change.ctr}pp` : undefined, subColor: searchComparison ? (searchComparison.change.ctr >= 0 ? 'text-accent-success' : 'text-accent-danger') : undefined },
      { label: 'Avg Position', value: String(overview.avgPosition), valueColor: 'text-accent-warning', sub: searchComparison ? `${searchComparison.change.position < 0 ? '↑' : searchComparison.change.position > 0 ? '↓' : ''}${Math.abs(searchComparison.change.position)}` : undefined, subColor: searchComparison ? (searchComparison.change.position <= 0 ? 'text-accent-success' : 'text-accent-danger') : undefined },
    ]} />

    {/* Insights — the hero section */}
    {insights && (
      <div className="space-y-3">
        {/* Search Health Summary */}
        <SectionCard title="Search Health Summary">

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="text-center">
              <div className={`t-stat-sm ${insights.page1 > 5 ? 'text-accent-success' : 'text-accent-warning'}`}>{insights.page1}</div>
              <div className="t-caption-sm text-[var(--brand-text-muted)]">Page 1 Rankings</div>
              <div className={`t-caption-sm mt-0.5 ${insights.page1 >= 10 ? 'text-accent-success' : insights.page1 >= 3 ? 'text-accent-warning' : 'text-[var(--brand-text-faint)]'}`}>{insights.page1 >= 10 ? 'Strong visibility' : insights.page1 >= 3 ? 'Room to grow' : 'Building up'}</div>
            </div>
            <div className="text-center">
              <div className={`t-stat-sm ${insights.top3 > 2 ? 'text-accent-success' : 'text-accent-warning'}`}>{insights.top3}</div>
              <div className="t-caption-sm text-[var(--brand-text-muted)]">Top 3 Rankings</div>
              <div className={`t-caption-sm mt-0.5 ${insights.top3 >= 5 ? 'text-accent-success' : insights.top3 >= 1 ? 'text-accent-warning' : 'text-[var(--brand-text-faint)]'}`}>{insights.top3 >= 5 ? 'Dominant positions' : insights.top3 >= 1 ? 'Competitive' : 'Opportunity ahead'}</div>
            </div>
            <div className="text-center">
              <div className={`t-stat-sm ${overview.avgCtr > 3 ? 'text-accent-success' : overview.avgCtr > 1.5 ? 'text-accent-warning' : 'text-accent-danger'}`}>{overview.avgCtr}%</div>
              <div className="t-caption-sm text-[var(--brand-text-muted)] flex items-center justify-center gap-0.5">Avg CTR<Explainer term="ctr" /></div>
              <div className={`t-caption-sm mt-0.5 ${overview.avgCtr > 3 ? 'text-accent-success' : overview.avgCtr > 1.5 ? 'text-accent-warning' : 'text-accent-danger'}`}>{overview.avgCtr > 3 ? 'Above average' : overview.avgCtr > 1.5 ? 'Typical range' : 'Needs attention'}</div>
            </div>
            <div className="text-center">
              <div className={`t-stat-sm ${insights.lowHanging.length > 0 ? 'text-accent-warning' : 'text-accent-success'}`}>{insights.lowHanging.length}</div>
              <div className="t-caption-sm text-[var(--brand-text-muted)]">Opportunities</div>
              <div className={`t-caption-sm mt-0.5 ${insights.lowHanging.length > 5 ? 'text-accent-warning' : insights.lowHanging.length > 0 ? 'text-accent-brand' : 'text-accent-success'}`}>{insights.lowHanging.length > 5 ? 'Quick wins available' : insights.lowHanging.length > 0 ? 'A few to capture' : 'Fully optimized'}</div>
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
      <SectionCard title="Performance Trend" action={<span className="t-caption-sm text-[var(--brand-text-muted)]">{overview.dateRange.start} — {overview.dateRange.end}</span>}>
        <DualTrendChart data={trend} annotations={annotations} />
      </SectionCard>
    )}

    {/* Rank Tracking */}
    <RankTrackingSection rankHistory={rankHistory} latestRanks={latestRanks} />

    {/* Competitor keyword gaps — Premium-exclusive benchmarking (R2-A).
        Self-fetching + tier-gated; Growth/free see a soft-gate upsell. */}
    {workspaceId && tier && (
      <CompetitorGapsSection workspaceId={workspaceId} tier={tier} />
    )}

    {/* Timeline notes (read-only, managed by your team) */}
    {annotations.length > 0 && (
      <SectionCard title="Timeline Notes" titleIcon={<Icon as={Activity} size="md" className="text-[var(--brand-text-muted)]" />} titleExtra={<span className="t-caption-sm px-1.5 py-0.5 rounded-[var(--radius-sm)] bg-[var(--surface-3)] text-[var(--brand-text-muted)]">{annotations.length}</span>}>
        <p className="t-caption-sm text-[var(--brand-text-muted)] mb-2">
          Need to add or update a timeline note? Message your team in Inbox conversations.
        </p>
        <div className="space-y-1.5">
          {annotations.map(ann => (
            <div key={ann.id} className="flex items-center gap-2 px-2 py-1.5 rounded-[var(--radius-lg)] bg-[var(--surface-1)]/50">
              <span className="w-2 h-2 rounded-[var(--radius-pill)] flex-shrink-0" style={{ backgroundColor: ann.color || '#2dd4bf' }} />
              <span className="t-caption-sm text-[var(--brand-text-muted)] flex-shrink-0">{ann.date}</span>
              <span className="t-caption text-[var(--brand-text)] flex-1 truncate">{ann.label}</span>
              {ann.description && <span className="t-caption-sm text-[var(--brand-text-muted)] truncate max-w-[120px]">{ann.description}</span>}
            </div>
          ))}
        </div>
      </SectionCard>
    )}

    {/* Detailed keyword/page tables — collapsible, secondary */}
    {/* Wave 2b B2 (fixed): raw table → KeywordTable.
        - position is a first-class sortable column via positionFormat="raw"
        - Explainer header tooltips restored via headerTooltips prop
        - Empty query/page table now shows EmptyState (improvement over silent empty tbody) */}
    <SectionCard noPadding>
      <ClickableRow
        onClick={() => setShowRawData(!showRawData)}
        className="px-5 py-3.5 flex items-center gap-2"
      >
        {showRawData ? <Icon as={ChevronDown} size="md" className="text-[var(--brand-text-muted)]" /> : <Icon as={ChevronRight} size="md" className="text-[var(--brand-text-muted)]" />}
        <Icon as={Table2} size="md" className="text-[var(--brand-text-muted)]" />
        <span className="t-ui font-medium text-[var(--brand-text-bright)]">All Keywords & Pages</span>
        <span className="t-caption-sm text-[var(--brand-text-muted)] ml-1">{overview.topQueries.length} queries, {overview.topPages.length} pages</span>
      </ClickableRow>
      {showRawData && (
        <>
          <div className="border-t border-[var(--brand-border)]">
            {/* Tracked-vs-all distinction: this table shows all queries from GSC for the selected period.
                The Keyword Rank Tracking section above tracks a curated set of keywords over time. */}
            <p className="t-caption-sm text-[var(--brand-text-muted)] px-4 pt-2 pb-0">
              All queries this period from Search Console — different from the tracked keywords above.
            </p>
            <div className="flex items-center gap-1 px-4 pb-1 pt-1">
              {(['queries', 'pages'] as const).map(st => (
                <Button
                  key={st}
                  variant="ghost"
                  size="sm"
                  onClick={() => setSearchSubTab(st)}
                  className={`rounded-[var(--radius-md)] t-ui font-medium ${searchSubTab === st ? 'bg-[var(--brand-border-hover)] text-[var(--brand-text-bright)]' : 'text-[var(--brand-text-muted)] hover:text-[var(--brand-text-bright)]'}`}
                >
                  {st === 'queries' ? 'Queries' : 'Pages'}
                </Button>
              ))}
            </div>
          </div>
          {searchSubTab === 'queries' && (
            <KeywordTable<KeywordTableRow>
              rows={sortedQueries().map(q => ({
                query: q.query,
                position: q.position,
                clicks: q.clicks,
                impressions: q.impressions,
                ctr: q.ctr,
              }))}
              columns={['clicks', 'impressions', 'ctr', 'position']}
              positionFormat="raw"
              sort={{
                key: sortKey,
                direction: sortAsc ? 'asc' : 'desc',
                onSort: (k) => handleSort(k as SortKey),
              }}
              headerTooltips={{
                clicks: <Explainer term="clicks" />,
                impressions: <Explainer term="impressions" />,
                ctr: <Explainer term="ctr" />,
                position: <Explainer term="position" />,
              }}
              emptyState={{ icon: Search, title: 'No queries data', description: 'No search query data available for this period.' }}
              className="rounded-none border-x-0 border-b-0"
            />
          )}
          {searchSubTab === 'pages' && (
            <KeywordTable<KeywordTableRow>
              rows={sortedPages().map(p => ({
                query: normalizePageUrl(p.page),
                position: p.position,
                clicks: p.clicks,
                impressions: p.impressions,
                ctr: p.ctr,
                pagePath: p.page,
              }))}
              columns={['clicks', 'impressions', 'ctr', 'position']}
              positionFormat="raw"
              sort={{
                key: sortKey,
                direction: sortAsc ? 'asc' : 'desc',
                onSort: (k) => handleSort(k as SortKey),
              }}
              headerTooltips={{
                clicks: <Explainer term="clicks" />,
                impressions: <Explainer term="impressions" />,
                ctr: <Explainer term="ctr" />,
                position: <Explainer term="position" />,
              }}
              emptyState={{ icon: Search, title: 'No pages data', description: 'No page data available for this period.' }}
              className="rounded-none border-x-0 border-b-0"
            />
          )}
        </>
      )}
    </SectionCard>
  </>);
}
