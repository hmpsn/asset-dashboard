import { useState } from 'react';
import { Search, LineChart } from 'lucide-react';
import { SearchTab } from './SearchTab';
import { AnalyticsTab } from './AnalyticsTab';
import type {
  SearchOverview, PerformanceTrend, SearchComparison,
  GA4Overview, GA4DailyTrend, GA4TopPage, GA4TopSource,
  GA4DeviceBreakdown, GA4Event, GA4ConversionSummary,
  GA4Comparison, GA4NewVsReturning, GA4OrganicOverview, GA4LandingPage,
  WorkspaceInfo,
} from './types';

interface SearchInsights {
  lowHanging: { query: string; position: number; impressions: number; clicks: number; ctr: number }[];
  topPerformers: { query: string; position: number; clicks: number; impressions: number; ctr: number }[];
  ctrOpps: { query: string; position: number; ctr: number; impressions: number; clicks: number }[];
  highImpLowClick: { query: string; impressions: number; clicks: number; position: number; ctr: number }[];
  page1: number;
  top3: number;
}

interface PerformanceTabProps {
  // Search props
  overview: SearchOverview | null;
  searchComparison: SearchComparison | null;
  trend: PerformanceTrend[];
  annotations: { id: string; date: string; label: string; description?: string; color?: string }[];
  rankHistory: { date: string; positions: Record<string, number> }[];
  latestRanks: { query: string; position: number; clicks: number; impressions: number; ctr: number; change?: number }[];
  insights: SearchInsights | null;
  // Analytics props
  ga4Overview: GA4Overview | null;
  ga4Comparison: GA4Comparison | null;
  ga4Trend: GA4DailyTrend[];
  ga4Devices: GA4DeviceBreakdown[];
  ga4Pages: GA4TopPage[];
  ga4Sources: GA4TopSource[];
  ga4Organic: GA4OrganicOverview | null;
  ga4LandingPages: GA4LandingPage[];
  ga4NewVsReturning: GA4NewVsReturning[] | null;
  ga4Conversions: GA4ConversionSummary[];
  ga4Events: GA4Event[];
  ws: WorkspaceInfo;
  days: number;
  // Which sub-tab to start on
  initialSubTab?: 'search' | 'analytics';
}

export function PerformanceTab(props: PerformanceTabProps) {
  const hasSearch = !!props.overview;
  const hasAnalytics = !!props.ga4Overview;
  const [subTab, setSubTab] = useState<'search' | 'analytics'>(
    props.initialSubTab || (hasSearch ? 'search' : 'analytics')
  );

  return (
    <>
      {/* Sub-tab selector — only show when both data sources exist */}
      {(hasSearch || hasAnalytics) && (
        <div className="flex items-center gap-1 bg-zinc-900/60 rounded-lg border border-zinc-800 p-1 w-fit mb-1">
          <button
            onClick={() => setSubTab('search')}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-md text-xs font-medium transition-colors ${
              subTab === 'search'
                ? 'bg-zinc-700 text-zinc-200'
                : 'text-zinc-500 hover:text-zinc-300'
            }`}
          >
            <Search className="w-3.5 h-3.5" /> Search
          </button>
          <button
            onClick={() => setSubTab('analytics')}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-md text-xs font-medium transition-colors ${
              subTab === 'analytics'
                ? 'bg-zinc-700 text-zinc-200'
                : 'text-zinc-500 hover:text-zinc-300'
            }`}
          >
            <LineChart className="w-3.5 h-3.5" /> Analytics
          </button>
        </div>
      )}

      {subTab === 'search' && (
        <SearchTab
          overview={props.overview}
          searchComparison={props.searchComparison}
          trend={props.trend}
          annotations={props.annotations}
          rankHistory={props.rankHistory}
          latestRanks={props.latestRanks}
          insights={props.insights}
        />
      )}

      {subTab === 'analytics' && (
        <AnalyticsTab
          ga4Overview={props.ga4Overview}
          ga4Comparison={props.ga4Comparison}
          ga4Trend={props.ga4Trend}
          ga4Devices={props.ga4Devices}
          ga4Pages={props.ga4Pages}
          ga4Sources={props.ga4Sources}
          ga4Organic={props.ga4Organic}
          ga4LandingPages={props.ga4LandingPages}
          ga4NewVsReturning={props.ga4NewVsReturning}
          ga4Conversions={props.ga4Conversions}
          ga4Events={props.ga4Events}
          ws={props.ws}
          days={props.days}
        />
      )}
    </>
  );
}
