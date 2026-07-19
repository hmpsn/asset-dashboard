// @ds-rebuilt
import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { useWorkspaces } from '../../hooks/admin';
import { queryKeys } from '../../lib/queryKeys';
import {
  Button,
  DateRangeSelector,
  ErrorState,
  Icon,
  LensSwitcher,
  Menu,
  PageHeader,
  Skeleton,
  Toolbar,
} from '../ui';
import { useAnalyticsAnnotations } from '../../hooks/admin/useAnalyticsAnnotations';
import { ANALYTICS_HUB_SECTION_PARAM, ANALYTICS_HUB_SECTIONS } from '../../routes';
import { useSearchTrafficSurfaceState, SEARCH_TRAFFIC_LENSES } from './useSearchTrafficSurfaceState';
import { useSearchTrafficGa4Data, useSearchTrafficSearchData } from './useSearchTrafficData';
import { OverviewLens } from './OverviewLens';
import { SearchLens } from './SearchLens';
import { TrafficLens } from './TrafficLens';
import { AnnotationsLens } from './AnnotationsLens';
import { BreakdownsDrawer } from './BreakdownsDrawer';
import type { SearchTrafficGa4Data, SearchTrafficLens, SearchTrafficSearchData } from './types';
import {
  dateRangeLabel,
  deltaLabel,
  formatNumber,
  formatPosition,
  formatScanTime,
} from './searchTrafficUtils';

interface SearchTrafficSurfaceProps {
  workspaceId: string;
}

const PAGE_SUBTITLE = 'Search visibility, site traffic, timeline context, and anomaly review.';
const HEADER_WRAP_CLASS = 'flex-col items-start gap-3 sm:flex-row sm:items-center [&_p]:whitespace-normal [&_p]:overflow-visible [&_p]:text-clip';
const SURFACE_WRAP_CLASS = 'mx-auto flex min-h-full w-full max-w-[1120px] flex-col gap-5 px-4 sm:px-[30px]';

const PRIMARY_DATE_OPTIONS = [
  { value: 28, label: '28d' },
  { value: 90, label: '90d' },
  { value: 365, label: '12m' },
];
const OVERFLOW_DATE_OPTIONS = [
  { value: 7, label: '7d' },
  { value: 14, label: '14d' },
  { value: 180, label: '6mo' },
  { value: 480, label: '16mo' },
];
const REPORT_LENSES = SEARCH_TRAFFIC_LENSES.map(({ id, label }) => ({ value: id, label }));

interface ReportNarrative {
  title: string;
  subtitle: string;
}

function reportNarrative(
  lens: SearchTrafficLens,
  searchData: SearchTrafficSearchData,
  trafficData: SearchTrafficGa4Data,
  annotationCount: number,
  gscConfigured: boolean,
  ga4Configured: boolean,
): ReportNarrative {
  if (lens === 'annotations') {
    return {
      title: annotationCount === 0
        ? 'No annotations explain this timeline yet.'
        : annotationCount === 1
          ? 'One annotation explains the timeline.'
          : `${formatNumber(annotationCount)} annotations explain the timeline.`,
      subtitle: 'Site changes, campaigns, and algorithm updates stay attached to the performance window they may have influenced.',
    };
  }

  if (lens === 'traffic') {
    if (!ga4Configured) {
      return {
        title: 'Site traffic needs a connected GA4 property.',
        subtitle: 'Annotations remain available while the traffic provider is disconnected.',
      };
    }
    if (!trafficData.overview) {
      return {
        title: 'Site traffic is unavailable for this window.',
        subtitle: trafficData.error ?? 'GA4 did not return an overview for the selected period.',
      };
    }
    const userDelta = trafficData.comparison?.changePercent.users;
    const movement = userDelta == null
      ? 'Site traffic for this period.'
      : Math.abs(userDelta) < 0.05
        ? 'Site users held steady this period.'
        : `Site users are ${userDelta > 0 ? 'up' : 'down'} ${deltaLabel(Math.abs(userDelta)).replace('+', '')} this period.`;
    return {
      title: movement,
      subtitle: `${formatNumber(trafficData.overview.totalUsers)} users generated ${formatNumber(trafficData.overview.totalSessions)} sessions and ${formatNumber(trafficData.overview.totalPageviews)} pageviews.`,
    };
  }

  if (lens === 'overview') {
    return {
      title: 'Search and site demand in one comparison.',
      subtitle: 'This compatibility view preserves the existing overview deep link while the primary reports remain separated.',
    };
  }

  if (!gscConfigured) {
    return {
      title: 'Search performance needs a connected property.',
      subtitle: 'Demand mix and query movement remain unavailable until Search Console is connected.',
    };
  }
  if (!searchData.overview) {
    return {
      title: 'Search performance is unavailable for this window.',
      subtitle: searchData.error ?? 'Search Console did not return an overview for the selected period.',
    };
  }
  const clickDelta = searchData.comparison?.changePercent.clicks;
  const movement = clickDelta == null
    ? 'Search performance for this period.'
    : Math.abs(clickDelta) < 0.05
      ? 'Search clicks held steady this period.'
      : `Search clicks are ${clickDelta > 0 ? 'up' : 'down'} ${deltaLabel(Math.abs(clickDelta)).replace('+', '')} this period.`;
  return {
    title: movement,
    subtitle: `${formatNumber(searchData.overview.totalClicks)} clicks from ${formatNumber(searchData.overview.totalImpressions)} impressions · ${formatPosition(searchData.overview.avgPosition)} average position.`,
  };
}

export function SearchTrafficSurface({ workspaceId }: SearchTrafficSurfaceProps) {
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const workspaces = useWorkspaces();
  const state = useSearchTrafficSurfaceState();
  const surfaceRef = useRef<HTMLDivElement>(null);
  const [drawerLens, setDrawerLens] = useState<'search' | 'traffic' | null>(null);
  const workspace = workspaces.data?.find((item) => item.id === workspaceId);
  const siteId = workspace?.webflowSiteId;
  const gscPropertyUrl = workspace?.gscPropertyUrl;
  const ga4PropertyId = workspace?.ga4PropertyId;
  const anomaliesFocusRequested = searchParams.get(ANALYTICS_HUB_SECTION_PARAM) === ANALYTICS_HUB_SECTIONS.anomalies;
  const searchData = useSearchTrafficSearchData(workspaceId, siteId, gscPropertyUrl, state.days, state.lens);
  const ga4Data = useSearchTrafficGa4Data(workspaceId, state.days, ga4PropertyId, state.lens);
  const annotations = useAnalyticsAnnotations(workspaceId);

  useEffect(() => {
    if (!anomaliesFocusRequested || (state.lens !== 'search' && state.lens !== 'traffic')) return;

    const root = surfaceRef.current;
    if (!root) return;

    const focusAnomalies = () => {
      // Both lenses intentionally keep their exact shared AnomalyAlerts mount. The receiver waits
      // for that existing async section instead of adding a second copy or a lens-specific fork.
      const anomalyButton = Array.from(root.querySelectorAll<HTMLButtonElement>('button'))
        .find((button) => button.textContent?.includes('Anomaly Alerts'));
      if (!anomalyButton) return false;

      const disclosure = anomalyButton.closest('details');
      if (disclosure) disclosure.open = true;
      anomalyButton.focus({ preventScroll: true });
      anomalyButton.scrollIntoView?.({ block: 'center' });
      return true;
    };

    if (focusAnomalies()) return;

    const observer = new MutationObserver(() => {
      if (focusAnomalies()) observer.disconnect();
    });
    observer.observe(root, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [anomaliesFocusRequested, state.lens, workspace?.id, workspaceId]);

  const rescanAnalytics = useCallback(() => {
    if (siteId) queryClient.invalidateQueries({ queryKey: queryKeys.admin.gscAll(`${workspaceId}:${siteId}`) });
    queryClient.invalidateQueries({ queryKey: queryKeys.admin.ga4All(workspaceId) });
    queryClient.invalidateQueries({ queryKey: queryKeys.admin.analyticsAnnotations(workspaceId) });
    queryClient.invalidateQueries({ queryKey: queryKeys.admin.insightFeed(workspaceId) });
    queryClient.invalidateQueries({ queryKey: queryKeys.admin.anomalyAlerts(workspaceId) });
    queryClient.invalidateQueries({ queryKey: queryKeys.admin.strategyKeywordSet(workspaceId) });
  }, [queryClient, siteId, workspaceId]);

  const dataWindow = state.lens === 'search'
    ? searchData.overview?.dateRange
    : state.lens === 'traffic'
      ? ga4Data.overview?.dateRange
      : searchData.overview?.dateRange ?? ga4Data.overview?.dateRange;
  const lastUpdated = formatScanTime(dataWindow?.end ? `${dataWindow.end}T12:00:00.000Z` : null);
  const overflowDate = OVERFLOW_DATE_OPTIONS.find((option) => option.value === state.days);
  const narrative = reportNarrative(
    state.lens,
    searchData,
    ga4Data,
    annotations.data?.length ?? 0,
    !!gscPropertyUrl,
    !!ga4PropertyId,
  );

  if (workspaces.isLoading && !workspace) {
    return (
      <div className={SURFACE_WRAP_CLASS} aria-label="Loading Search & Traffic">
        <Skeleton className="h-[72px] w-full" />
        <Skeleton className="h-[54px] w-full" />
        <Skeleton className="h-[320px] w-full" />
      </div>
    );
  }

  if (workspaces.isError && !workspace) {
    return (
      <div className={SURFACE_WRAP_CLASS}>
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
      <div className={SURFACE_WRAP_CLASS}>
        <PageHeader title="Search & Traffic" subtitle={PAGE_SUBTITLE} className={HEADER_WRAP_CLASS} />
        <ErrorState type="data" title="Workspace not found" message="Choose a workspace before reviewing analytics." className="min-h-[420px]" />
      </div>
    );
  }

  if (!siteId) {
    return (
      <div className={SURFACE_WRAP_CLASS}>
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
    <div ref={surfaceRef} className={SURFACE_WRAP_CLASS}>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-2">
          <span className="h-1.5 w-1.5 rounded-[var(--radius-pill)] bg-[var(--blue)]" aria-hidden="true" />
          <span className="t-micro font-semibold uppercase tracking-[0.14em] text-[var(--brand-text-muted)]">
            Search &amp; traffic · {workspace.name}
          </span>
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-2 lg:justify-end">
          {dataWindow && (
            <span className="t-caption-sm text-[var(--brand-text-muted)]">
              {lastUpdated ? `Data as of ${lastUpdated}` : dateRangeLabel(dataWindow)}
            </span>
          )}
          <div className="flex max-w-full items-center gap-1" role="group" aria-label="Analytics date range">
            <DateRangeSelector
              options={PRIMARY_DATE_OPTIONS}
              selected={state.days}
              onChange={state.setDays}
              className="[&_button]:px-2 [&_button]:py-1"
            />
            <Menu
              align="end"
              trigger={(
                <Button size="sm" variant={overflowDate ? 'secondary' : 'ghost'} aria-label="More date ranges">
                  {overflowDate?.label ?? 'More'}
                  <Icon name="chevronDown" size="sm" aria-hidden="true" />
                </Button>
              )}
              items={OVERFLOW_DATE_OPTIONS.map((option) => ({
                label: option.label,
                onSelect: () => state.setDays(option.value),
                trailing: state.days === option.value ? <Icon name="check" size="sm" aria-label="Selected" /> : undefined,
              }))}
            />
          </div>
          <Button size="sm" variant="secondary" onClick={rescanAnalytics}>
            <Icon name="refresh" size="sm" aria-hidden="true" />
            Re-scan
          </Button>
        </div>
      </div>

      <Toolbar label="Search and traffic reports" className="-mt-3 max-w-full overflow-x-auto pb-px">
        <LensSwitcher
          options={REPORT_LENSES}
          value={state.lens}
          onChange={(value) => state.setLens(value as SearchTrafficLens)}
          size="sm"
          mono
        />
      </Toolbar>

      <PageHeader
        title={narrative.title}
        subtitle={narrative.subtitle}
        variant="rebuilt-admin"
        className="max-w-[820px]"
      />

      {state.lens === 'overview' && (
        <OverviewLens
          workspaceId={workspaceId}
          gscPropertyUrl={gscPropertyUrl}
          ga4PropertyId={ga4PropertyId}
          days={state.days}
          searchData={searchData}
          ga4Data={ga4Data}
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
        <AnnotationsLens
          workspaceId={workspaceId}
          searchData={searchData}
          trafficData={ga4Data}
          searchConfigured={!!gscPropertyUrl}
          trafficConfigured={!!ga4PropertyId}
        />
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
