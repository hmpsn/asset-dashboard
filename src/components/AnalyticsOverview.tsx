// src/components/AnalyticsOverview.tsx
import { useState } from 'react';
import { BarChart3, MousePointer, Eye, ArrowUpDown, Users, Activity, TrendingDown, Loader2 } from 'lucide-react';
import { StatCard, SectionCard, DateRangeSelector, EmptyState, DATE_PRESETS_SEARCH } from './ui';
import { AnnotatedTrendChart, type TrendLine } from './charts/AnnotatedTrendChart';
import { AnalyticsAnnotations } from './AnalyticsAnnotations';
import { InsightCards } from './client/InsightCards';
import { useAnalyticsOverview } from '../hooks/admin/useAnalyticsOverview';
import { useClientInsights } from '../hooks/client/useClientQueries';

interface Props {
  workspaceId: string;
  siteId?: string;
  gscPropertyUrl?: string;
  ga4PropertyId?: string;
}

const TREND_LINES: TrendLine[] = [
  { key: 'clicks', color: '#60a5fa', yAxisId: 'left', label: 'Clicks (GSC)' },
  { key: 'users', color: '#14b8a6', yAxisId: 'right', label: 'Users (GA4)' },
];

export function AnalyticsOverview({ workspaceId, siteId, gscPropertyUrl, ga4PropertyId }: Props) {
  const [days, setDays] = useState(28);
  const overview = useAnalyticsOverview(workspaceId, siteId, gscPropertyUrl, ga4PropertyId, days);
  const { data: insights = [], isLoading: insightsLoading } = useClientInsights(workspaceId, true);

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

  return (
    <div className="space-y-6">
      {/* Date range selector */}
      <div className="flex justify-end">
        <DateRangeSelector presets={DATE_PRESETS_SEARCH} value={days} onChange={setDays} />
      </div>

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
              icon={TrendingDown}
              iconColor="#ef4444"
              sub="GA4"
            />
          </>
        )}
      </div>

      {/* Unified trend chart with annotations */}
      {overview.trendData.length > 0 && (
        <SectionCard
          title="Performance Trend"
          titleExtra={<span className="text-[11px] text-zinc-500">{days}d</span>}
        >
          <AnnotatedTrendChart
            data={overview.trendData}
            lines={TREND_LINES.filter(
              l => (l.key === 'clicks' && overview.hasGsc) || (l.key === 'users' && overview.hasGa4),
            )}
            annotations={overview.annotations}
            onCreateAnnotation={handleCreateAnnotation}
            height={260}
          />
        </SectionCard>
      )}

      {/* Intelligence InsightCards */}
      <InsightCards
        workspaceId={workspaceId}
        insights={insights}
        tier="growth"
        loading={insightsLoading}
      />

      {/* Annotations CRUD */}
      <AnalyticsAnnotations workspaceId={workspaceId} />
    </div>
  );
}
