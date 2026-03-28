// src/components/AnalyticsOverview.tsx
import { useState } from 'react';
import { BarChart3, Loader2 } from 'lucide-react';
import { MetricToggleCard, SectionCard, DateRangeSelector, EmptyState, DATE_PRESETS_SEARCH } from './ui';
import { AnnotatedTrendChart, type TrendLine } from './charts/AnnotatedTrendChart';
import { AnalyticsAnnotations } from './AnalyticsAnnotations';
import { InsightFeed } from './insights';
import { useAnalyticsOverview } from '../hooks/admin/useAnalyticsOverview';
import { useInsightFeed } from '../hooks/admin/useInsightFeed';
import { fmtNum } from '../utils/formatNumbers';

interface Props {
  workspaceId: string;
  siteId?: string;
  gscPropertyUrl?: string;
  ga4PropertyId?: string;
}

const ALL_OVERVIEW_LINES: TrendLine[] = [
  { key: 'clicks', color: '#60a5fa', yAxisId: 'left', label: 'Clicks' },
  { key: 'impressions', color: '#8b5cf6', yAxisId: 'left', label: 'Impressions' },
  { key: 'ctr', color: '#f59e0b', yAxisId: 'left', label: 'Avg CTR' },
  { key: 'position', color: '#ef4444', yAxisId: 'right', label: 'Avg Position' },
  { key: 'users', color: '#14b8a6', yAxisId: 'right', label: 'Users' },
  { key: 'sessions', color: '#3b82f6', yAxisId: 'right', label: 'Sessions' },
];

type CardKey = 'clicks' | 'impressions' | 'ctr' | 'position' | 'users' | 'sessions';

interface CardConfig {
  key: CardKey;
  label: string;
  color: string;
  invertDelta?: boolean;
  formatValue: (overview: ReturnType<typeof useAnalyticsOverview>) => string;
  getDelta: (overview: ReturnType<typeof useAnalyticsOverview>) => number | null;
}

const GSC_CARDS: CardConfig[] = [
  {
    key: 'clicks',
    label: 'Clicks',
    color: '#60a5fa',
    formatValue: (o) => fmtNum(o.gscClicks),
    getDelta: (o) => o.gscClicksDelta,
  },
  {
    key: 'impressions',
    label: 'Impressions',
    color: '#8b5cf6',
    formatValue: (o) => fmtNum(o.gscImpressions),
    getDelta: (o) => o.gscImpressionsDelta,
  },
  {
    key: 'ctr',
    label: 'Avg CTR',
    color: '#f59e0b',
    formatValue: (o) => o.gscImpressions > 0
      ? `${((o.gscClicks / o.gscImpressions) * 100).toFixed(1)}%`
      : '0.0%',
    getDelta: (_o) => null, // CTR delta not exposed by hook; omit rather than show wrong value
  },
  {
    key: 'position',
    label: 'Avg Position',
    color: '#ef4444',
    invertDelta: true,
    formatValue: (o) => o.gscPosition.toFixed(1),
    getDelta: (o) => o.gscPositionDelta,
  },
];

const GA4_CARDS: CardConfig[] = [
  {
    key: 'users',
    label: 'Users',
    color: '#14b8a6',
    formatValue: (o) => fmtNum(o.ga4Users),
    getDelta: (o) => o.ga4UsersDelta,
  },
  {
    key: 'sessions',
    label: 'Sessions',
    color: '#3b82f6',
    formatValue: (o) => fmtNum(o.ga4Sessions),
    getDelta: (o) => o.ga4SessionsDelta,
  },
];

function formatDeltaLabel(delta: number | null): string {
  if (delta === null) return '—';
  const sign = delta > 0 ? '+' : '';
  return `${sign}${delta.toFixed(1)}%`;
}

function isDeltaPositive(delta: number | null): boolean {
  return delta !== null && delta > 0;
}

export function AnalyticsOverview({ workspaceId, siteId, gscPropertyUrl, ga4PropertyId }: Props) {
  const [days, setDays] = useState(28);
  const [activeLines, setActiveLines] = useState<Set<string>>(new Set(['clicks', 'users']));
  const [showAllInsights, setShowAllInsights] = useState(false);

  const overview = useAnalyticsOverview(workspaceId, siteId, gscPropertyUrl, ga4PropertyId, days);
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
        if (next.size > 1) next.delete(key); // keep at least 1 active
      } else if (next.size < 3) {
        next.add(key);
      }
      return next;
    });
  };

  const chartLines = ALL_OVERVIEW_LINES
    .filter(l => {
      if (['clicks', 'impressions', 'ctr', 'position'].includes(l.key)) return overview.hasGsc;
      return overview.hasGa4;
    })
    .map(l => ({ ...l, active: activeLines.has(l.key) }));

  return (
    <div className="space-y-6">
      {/* Date range selector */}
      <div className="flex justify-end">
        <DateRangeSelector options={DATE_PRESETS_SEARCH} selected={days} onChange={setDays} />
      </div>

      {/* Search Performance metric cards */}
      {overview.hasGsc && (
        <div className="space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">Search Performance</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {GSC_CARDS.map(card => {
              const delta = card.getDelta(overview);
              return (
                <MetricToggleCard
                  key={card.key}
                  label={card.label}
                  value={card.formatValue(overview)}
                  delta={formatDeltaLabel(delta)}
                  deltaPositive={isDeltaPositive(delta)}
                  color={card.color}
                  active={activeLines.has(card.key)}
                  onClick={() => handleToggleLine(card.key)}
                  invertDelta={card.invertDelta}
                />
              );
            })}
          </div>
        </div>
      )}

      {/* Site Traffic metric cards */}
      {overview.hasGa4 && (
        <div className="space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">Site Traffic</p>
          <div className="grid grid-cols-2 gap-3 sm:w-1/2">
            {GA4_CARDS.map(card => {
              const delta = card.getDelta(overview);
              return (
                <MetricToggleCard
                  key={card.key}
                  label={card.label}
                  value={card.formatValue(overview)}
                  delta={formatDeltaLabel(delta)}
                  deltaPositive={isDeltaPositive(delta)}
                  color={card.color}
                  active={activeLines.has(card.key)}
                  onClick={() => handleToggleLine(card.key)}
                />
              );
            })}
          </div>
        </div>
      )}

      {/* Unified trend chart with toggle cards above */}
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

      {/* Priority insight feed */}
      <SectionCard title="Priority Insights">
        <InsightFeed
          feed={feed}
          summary={summary}
          loading={feedLoading}
          showPills
          limit={showAllInsights ? undefined : 5}
          onViewAll={() => setShowAllInsights(true)}
        />
      </SectionCard>

      {/* Annotations CRUD */}
      <AnalyticsAnnotations workspaceId={workspaceId} />
    </div>
  );
}
