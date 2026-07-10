// @ds-rebuilt
import { useCallback, useMemo, useState } from 'react';
import { Activity, BarChart3, RefreshCw, Search, StickyNote } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useWorkspaces } from '../../hooks/admin';
import { useWorkspaceEvents } from '../../hooks/useWorkspaceEvents';
import { queryKeys } from '../../lib/queryKeys';
import { WS_EVENTS } from '../../lib/wsEvents';
import {
  Button,
  ErrorState,
  FormSelect,
  LensSwitcher,
  PageHeader,
  Skeleton,
  Toolbar,
  ToolbarSpacer,
} from '../ui';
import { useAnalyticsAnnotations } from '../../hooks/admin/useAnalyticsAnnotations';
import { useSearchTrafficSurfaceState, SEARCH_TRAFFIC_LENSES } from './useSearchTrafficSurfaceState';
import { useSearchTrafficGa4Data, useSearchTrafficSearchData } from './useSearchTrafficData';
import { OverviewLens } from './OverviewLens';
import { SearchLens } from './SearchLens';
import { TrafficLens } from './TrafficLens';
import { AnnotationsLens } from './AnnotationsLens';
import { BreakdownsDrawer } from './BreakdownsDrawer';
import type { SearchTrafficLens } from './types';
import { dateRangeLabel, formatScanTime } from './searchTrafficUtils';

interface SearchTrafficSurfaceProps {
  workspaceId: string;
}

const PAGE_SUBTITLE = 'Search visibility, site traffic, timeline context, and anomaly review.';
const HEADER_WRAP_CLASS = 'flex-col items-start gap-3 sm:flex-row sm:items-center [&_p]:whitespace-normal [&_p]:overflow-visible [&_p]:text-clip';

const LENS_ICONS: Record<SearchTrafficLens, typeof BarChart3> = {
  overview: BarChart3,
  search: Search,
  traffic: Activity,
  annotations: StickyNote,
};

const DATE_OPTIONS = [
  { value: '7', label: '7 days' },
  { value: '14', label: '14 days' },
  { value: '28', label: '28 days' },
  { value: '90', label: '90 days' },
  { value: '180', label: '6 months' },
  { value: '365', label: '1 year' },
  { value: '480', label: '16 months' },
];

export function SearchTrafficSurface({ workspaceId }: SearchTrafficSurfaceProps) {
  const queryClient = useQueryClient();
  const workspaces = useWorkspaces();
  const state = useSearchTrafficSurfaceState();
  const [drawerLens, setDrawerLens] = useState<'search' | 'traffic' | null>(null);
  const workspace = workspaces.data?.find((item) => item.id === workspaceId);
  const siteId = workspace?.webflowSiteId;
  const gscPropertyUrl = workspace?.gscPropertyUrl;
  const ga4PropertyId = workspace?.ga4PropertyId;
  const searchData = useSearchTrafficSearchData(workspaceId, siteId, gscPropertyUrl, state.days);
  const ga4Data = useSearchTrafficGa4Data(workspaceId, state.days, ga4PropertyId);
  const annotations = useAnalyticsAnnotations(workspaceId);

  const invalidateAnalytics = useCallback(() => {
    if (siteId) queryClient.invalidateQueries({ queryKey: queryKeys.admin.gscAll(`${workspaceId}:${siteId}`) });
    queryClient.invalidateQueries({ queryKey: queryKeys.admin.ga4All(workspaceId) });
    queryClient.invalidateQueries({ queryKey: queryKeys.admin.analyticsAnnotations(workspaceId) });
    queryClient.invalidateQueries({ queryKey: queryKeys.admin.insightFeed(workspaceId) });
    queryClient.invalidateQueries({ queryKey: queryKeys.admin.anomalyAlerts(workspaceId) });
    queryClient.invalidateQueries({ queryKey: queryKeys.admin.strategyKeywordSet(workspaceId) });
  }, [queryClient, siteId, workspaceId]);

  useWorkspaceEvents(workspaceId, {
    // ws-invalidation-ok — rebuilt Search & Traffic owns the admin analytics read-model refresh while mounted outside the legacy AnalyticsHub.
    [WS_EVENTS.ANNOTATION_BRIDGE_CREATED]: invalidateAnalytics,
    // ws-invalidation-ok — insight bridge changes affect the filtered insight windows shown on this surface.
    [WS_EVENTS.INSIGHT_BRIDGE_UPDATED]: invalidateAnalytics,
    // ws-invalidation-ok — resolved insights must disappear from the filtered insight windows.
    [WS_EVENTS.INSIGHT_RESOLVED]: invalidateAnalytics,
    // ws-invalidation-ok — anomaly scan/ack/dismiss actions update the actionable panel on this surface.
    [WS_EVENTS.ANOMALIES_UPDATE]: invalidateAnalytics,
    // ws-invalidation-ok — keyword strategy membership drives the strategy dot on query rows.
    [WS_EVENTS.STRATEGY_KEYWORD_SET_UPDATED]: invalidateAnalytics,
  });

  const lensOptions = useMemo(() => SEARCH_TRAFFIC_LENSES.map((lens) => {
    let count: number | undefined;
    if (lens.id === 'search') count = searchData.overview?.topQueries.length;
    if (lens.id === 'traffic') count = ga4Data.topPages.length || undefined;
    if (lens.id === 'annotations') count = annotations.data?.length;
    return {
      value: lens.id,
      label: lens.label,
      icon: LENS_ICONS[lens.id],
      count,
    };
  }), [annotations.data?.length, ga4Data.topPages.length, searchData.overview?.topQueries.length]);

  const dataWindow = searchData.overview?.dateRange ?? ga4Data.overview?.dateRange;
  const lastUpdated = formatScanTime(dataWindow?.end ? `${dataWindow.end}T12:00:00.000Z` : null);

  if (workspaces.isLoading && !workspace) {
    return (
      <div className="flex min-h-full flex-col gap-5" aria-label="Loading Search & Traffic">
        <Skeleton className="h-[72px] w-full" />
        <Skeleton className="h-[54px] w-full" />
        <Skeleton className="h-[320px] w-full" />
      </div>
    );
  }

  if (workspaces.isError && !workspace) {
    return (
      <div className="flex min-h-full flex-col gap-5">
        <PageHeader title="Search & Traffic" subtitle={PAGE_SUBTITLE} className={HEADER_WRAP_CLASS} />
        <ErrorState
          type="data"
          title="Workspace details did not load"
          message="Retry the workspace read before reviewing analytics."
          action={{ label: 'Retry', onClick: () => workspaces.refetch() }}
          className="min-h-[420px]"
        />
      </div>
    );
  }

  if (!workspace) {
    return (
      <div className="flex min-h-full flex-col gap-5">
        <PageHeader title="Search & Traffic" subtitle={PAGE_SUBTITLE} className={HEADER_WRAP_CLASS} />
        <ErrorState type="data" title="Workspace not found" message="Choose a workspace before reviewing analytics." className="min-h-[420px]" />
      </div>
    );
  }

  if (!siteId) {
    return (
      <div className="flex min-h-full flex-col gap-5">
        <PageHeader title="Search & Traffic" subtitle={PAGE_SUBTITLE} className={HEADER_WRAP_CLASS} />
        <ErrorState
          type="permission"
          title="Connect a site first"
          message="This analytics surface requires a workspace site before Search Console or GA4 reads can run."
          className="min-h-[420px]"
        />
      </div>
    );
  }

  return (
    <div className="flex min-h-full flex-col gap-5">
      <PageHeader
        title="Search & Traffic"
        subtitle={PAGE_SUBTITLE}
        className={HEADER_WRAP_CLASS}
        actions={(
          <div className="flex flex-wrap items-center justify-end gap-2">
            <span className="t-ui text-[var(--brand-text-muted)]">
              {lastUpdated ? `Data as of ${lastUpdated}` : dateRangeLabel(dataWindow)}
            </span>
            <Button size="sm" variant="secondary" onClick={invalidateAnalytics}>
              <RefreshCw size={14} aria-hidden="true" />
              Re-scan
            </Button>
          </div>
        )}
      />

      <Toolbar label="Search and traffic controls">
        <LensSwitcher
          options={lensOptions}
          value={state.lens}
          onChange={(value) => state.setLens(value as SearchTrafficLens)}
          size="sm"
        />
        <ToolbarSpacer />
        <FormSelect
          value={String(state.days)}
          onChange={(value) => state.setDays(Number(value))}
          options={DATE_OPTIONS}
          aria-label="Analytics date range"
          className="min-w-[130px]"
        />
      </Toolbar>

      {state.lens === 'overview' && (
        <OverviewLens
          workspaceId={workspaceId}
          siteId={siteId}
          gscPropertyUrl={gscPropertyUrl}
          ga4PropertyId={ga4PropertyId}
          days={state.days}
          searchData={searchData}
        />
      )}

      {state.lens === 'search' && (
        <SearchLens
          workspaceId={workspaceId}
          data={searchData}
          tableMode={state.tableMode}
          onTableModeChange={state.setTableMode}
          onOpenBreakdowns={() => setDrawerLens('search')}
          configured={!!gscPropertyUrl}
        />
      )}

      {state.lens === 'traffic' && (
        <TrafficLens
          workspaceId={workspaceId}
          ga4PropertyId={ga4PropertyId}
          days={state.days}
          data={ga4Data}
          onOpenBreakdowns={() => setDrawerLens('traffic')}
        />
      )}

      {state.lens === 'annotations' && (
        <AnnotationsLens workspaceId={workspaceId} />
      )}

      <BreakdownsDrawer
        open={drawerLens !== null}
        onClose={() => setDrawerLens(null)}
        lens={drawerLens ?? 'search'}
        search={searchData}
        ga4={ga4Data}
      />
    </div>
  );
}

export default SearchTrafficSurface;
