// src/components/AnalyticsOverview.tsx
import { useState } from 'react';
import { BarChart3, MousePointer, Eye, ArrowUpDown, Users, Activity, TrendingDown, Loader2, Target } from 'lucide-react';
import { StatCard, SectionCard, DateRangeSelector, EmptyState, DATE_PRESETS_SEARCH, TabBar } from './ui';
import { AnnotatedTrendChart, type TrendLine } from './charts/AnnotatedTrendChart';
import { AnalyticsAnnotations } from './AnalyticsAnnotations';
import { InsightCards } from './client/InsightCards';
import { InsightFeed } from './insights';
import { useAnalyticsOverview } from '../hooks/admin/useAnalyticsOverview';
import { useInsightFeed } from '../hooks/admin/useInsightFeed';
import { useClientInsights } from '../hooks/client/useClientQueries';

interface Props {
  workspaceId: string;
  siteId?: string;
  gscPropertyUrl?: string;
  ga4PropertyId?: string;
}

type SubTab = 'insights' | 'metrics';

const ALL_OVERVIEW_LINES: TrendLine[] = [
  { key: 'clicks', color: '#60a5fa', yAxisId: 'left', label: 'Clicks' },
  { key: 'impressions', color: '#8b5cf6', yAxisId: 'left', label: 'Impressions' },
  { key: 'users', color: '#14b8a6', yAxisId: 'right', label: 'Users' },
  { key: 'sessions', color: '#3b82f6', yAxisId: 'right', label: 'Sessions' },
];

export function AnalyticsOverview({ workspaceId, siteId, gscPropertyUrl, ga4PropertyId }: Props) {
  const [days, setDays] = useState(28);
  const [subTab, setSubTab] = useState<SubTab>('insights');
  const [activeLines, setActiveLines] = useState<Set<string>>(new Set(['clicks', 'users']));

  const overview = useAnalyticsOverview(workspaceId, siteId, gscPropertyUrl, ga4PropertyId, days);
  const { data: insights = [], isLoading: insightsLoading } = useClientInsights(workspaceId, true);
  const { feed, summary, isLoading: feedLoading } = useInsightFeed(workspaceId);

  if (overview.isLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="w-5 h-5 animate-spin text-teal-400" />
        <span className="ml-2 text-sm text-zinc-500">Loading analytics...</span>
      </div>
    );
  }

  if (!overview.hasGsc && !overview.hasGa4) {
    return (
      <EmptyState
        icon={BarChart3}
        title="No analytics connected"
        description="Connect Google Search Console or Google Analytics in workspace settings to see data here."
      />
    );
  }

  const handleCreateAnnotation = (date: string, label: string, category: string) => {
    overview.createAnnotation.mutate({ date, label, category });
  };

  const handleToggleLine = (key: string) => {
    setActiveLines(prev => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else if (next.size < 3) {
        next.add(key);
      }
      return next;
    });
  };

  const chartLines = ALL_OVERVIEW_LINES
    .filter(l => overview.hasGsc || l.yAxisId !== 'left')
    .filter(l => overview.hasGa4 || l.yAxisId !== 'right')
    .map(l => ({ ...l, active: activeLines.has(l.key) }));

  return (
    <div className="space-y-6">
      {/* Date range selector */}
      <div className="flex justify-end">
        <DateRangeSelector options={DATE_PRESETS_SEARCH} selected={days} onChange={setDays} />
      </div>

      {/* Sub-tab navigation */}
      <TabBar
        tabs={[
          { id: 'insights', label: 'Insights', icon: Target },
          { id: 'metrics', label: 'Metrics', icon: BarChart3 },
        ]}
        active={subTab}
        onChange={id => setSubTab(id as SubTab)}
      />

      {/* Insights sub-tab (default) */}
      {subTab === 'insights' && (
        <div className="space-y-6">
          {/* Priority insight feed */}
          <SectionCard title="Priority Insights">
            <InsightFeed
              feed={feed}
              summary={summary}
              loading={feedLoading}
              showPills
              limit={5}
              onViewAll={() => setSubTab('insights')}
            />
          </SectionCard>

          {/* Unified trend chart with annotations */}
          {overview.trendData.length > 0 && (
            <SectionCard
              title="Performance Trend"
              titleExtra={<span className="text-[11px] text-zinc-500">{days}d</span>}
            >
              <AnnotatedTrendChart
                data={overview.trendData}
                lines={chartLines}
                annotations={overview.annotations}
                onCreateAnnotation={handleCreateAnnotation}
                onToggleLine={handleToggleLine}
                maxActiveLines={3}
                height={260}
              />
            </SectionCard>
          )}

          {/* Annotations CRUD */}
          <AnalyticsAnnotations workspaceId={workspaceId} />
        </div>
      )}

      {/* Metrics sub-tab */}
      {subTab === 'metrics' && (
        <div className="space-y-6">
          {/* Headline metrics */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {overview.hasGsc && (
              <>
                <StatCard
                  label="Clicks"
                  value={overview.gscClicks.toLocaleString()}
                  delta={overview.gscClicksDelta ?? undefined}
                  deltaLabel="%"
                  icon={MousePointer}
                  iconColor="#60a5fa"
                  sub="GSC"
                />
                <StatCard
                  label="Impressions"
                  value={overview.gscImpressions.toLocaleString()}
                  delta={overview.gscImpressionsDelta ?? undefined}
                  deltaLabel="%"
                  icon={Eye}
                  iconColor="#22d3ee"
                  sub="GSC"
                />
                <StatCard
                  label="Avg Position"
                  value={overview.gscPosition.toFixed(1)}
                  delta={overview.gscPositionDelta ?? undefined}
                  deltaLabel="%"
                  invertDelta
                  icon={ArrowUpDown}
                  iconColor="#fbbf24"
                  sub="GSC"
                />
              </>
            )}
            {overview.hasGa4 && (
              <>
                <StatCard
                  label="Users"
                  value={overview.ga4Users.toLocaleString()}
                  delta={overview.ga4UsersDelta ?? undefined}
                  deltaLabel="%"
                  icon={Users}
                  iconColor="#14b8a6"
                  sub="GA4"
                />
                <StatCard
                  label="Sessions"
                  value={overview.ga4Sessions.toLocaleString()}
                  delta={overview.ga4SessionsDelta ?? undefined}
                  deltaLabel="%"
                  icon={Activity}
                  iconColor="#3b82f6"
                  sub="GA4"
                />
                <StatCard
                  label="Bounce Rate"
                  value={`${overview.ga4BounceRate.toFixed(1)}%`}
                  delta={overview.ga4BounceRateDelta ?? undefined}
                  deltaLabel="%"
                  invertDelta
                  icon={TrendingDown}
                  iconColor="#ef4444"
                  sub="GA4"
                />
              </>
            )}
          </div>

          {/* Intelligence InsightCards */}
          <InsightCards
            workspaceId={workspaceId}
            insights={insights}
            tier="growth"
            loading={insightsLoading}
          />
        </div>
      )}
    </div>
  );
}
