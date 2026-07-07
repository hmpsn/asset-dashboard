// @ds-rebuilt
import { useCallback, useEffect, useRef, useState } from 'react';
import { BarChart3, MapPin, Settings2, Star, type LucideIcon } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { ApiError } from '../../api/client';
import { useGbpReviews, useLocalGbpRefresh, useLocalSeo, useLocalSeoRefresh } from '../../hooks/admin';
import { useBackgroundTasks } from '../../hooks/useBackgroundTasks';
import { useFeatureFlag } from '../../hooks/useFeatureFlag';
import { useWorkspaceEvents } from '../../hooks/useWorkspaceEvents';
import { queryKeys } from '../../lib/queryKeys';
import { WS_EVENTS } from '../../lib/wsEvents';
import { BACKGROUND_JOB_TYPES } from '../../../shared/types/background-jobs';
import { useToast } from '../Toast';
import { LocalSeoMarketSetupDrawer } from '../local-seo/LocalSeoMarketSetupDrawer';
import {
  Button,
  ErrorState,
  FilterChip,
  InlineBanner,
  LensSwitcher,
  MetricTile,
  PageHeader,
  SearchField,
  Skeleton,
  Toolbar,
  ToolbarSpacer,
} from '../ui';
import { LocalPresenceOverview } from './LocalPresenceOverview';
import { LocalPresenceReviewsPipeline } from './LocalPresenceReviewsPipeline';
import { LocalPresenceSetup } from './LocalPresenceSetup';
import { LocalPresenceVisibility } from './LocalPresenceVisibility';
import { mutationErrorMessage } from './localPresenceMutationFeedback';
import {
  LOCAL_PRESENCE_FILTERS,
  LOCAL_PRESENCE_LENSES,
  type LocalPresenceLens,
  useLocalPresenceSurfaceState,
} from './useLocalPresenceSurfaceState';

interface LocalPresenceSurfaceProps {
  workspaceId: string;
}

const DATE_FORMAT = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});

const LENS_ICONS: Record<LocalPresenceLens, LucideIcon> = {
  overview: MapPin,
  visibility: BarChart3,
  reviews: Star,
  setup: Settings2,
};

function isLockedError(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 402 || error.status === 403);
}

function formatFreshness(value?: string): string {
  if (!value) return 'No scan yet';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return 'No scan yet';
  return `Last scanned ${DATE_FORMAT.format(parsed)}`;
}

function formatRating(value?: number): string {
  return typeof value === 'number' ? value.toFixed(1) : '—';
}

export function LocalPresenceSurface({ workspaceId }: LocalPresenceSurfaceProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const state = useLocalPresenceSurfaceState();
  const localSeo = useLocalSeo(workspaceId);
  const gbpReviews = useGbpReviews(workspaceId);
  const localRefresh = useLocalSeoRefresh(workspaceId);
  const gbpRefresh = useLocalGbpRefresh(workspaceId);
  const gbpAggregateEnabled = useFeatureFlag('local-gbp');
  const { findActiveJob } = useBackgroundTasks();
  const [setupOpen, setSetupOpen] = useState(false);
  const setupAutoOpenRef = useRef(false);

  const data = localSeo.data;
  const report = data?.report;
  const gbp = gbpReviews.data;
  const activeLocalJob = findActiveJob({
    type: BACKGROUND_JOB_TYPES.LOCAL_SEO_REFRESH,
    workspaceId,
  });
  const activeGbpJob = findActiveJob({
    type: BACKGROUND_JOB_TYPES.LOCAL_GBP_REFRESH,
    workspaceId,
  });
  const localRefreshing = localRefresh.isPending || Boolean(activeLocalJob);
  const gbpRefreshing = gbpRefresh.isPending || Boolean(activeGbpJob);
  const canLocalRefresh = Boolean(report && report.activeMarketCount > 0 && report.workspacePosture !== 'non_local');

  const invalidateLocalPresence = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: queryKeys.admin.localSeo(workspaceId) });
    queryClient.invalidateQueries({ queryKey: queryKeys.admin.localGbpReviews(workspaceId) });
    queryClient.invalidateQueries({ queryKey: queryKeys.admin.keywordCommandCenter(workspaceId) });
  }, [queryClient, workspaceId]);

  const invalidateGbpConnection = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: queryKeys.admin.gbpConnection() });
    queryClient.invalidateQueries({ queryKey: queryKeys.admin.gbpWorkspaceMappings(workspaceId) });
  }, [queryClient, workspaceId]);

  const invalidateGbpReviews = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: queryKeys.admin.gbpAuthenticatedReviews(workspaceId) });
    queryClient.invalidateQueries({ queryKey: queryKeys.admin.localGbpReviews(workspaceId) });
  }, [queryClient, workspaceId]);

  const invalidateGbpReviewResponses = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: queryKeys.admin.gbpReviewResponses(workspaceId) });
    queryClient.invalidateQueries({ queryKey: queryKeys.admin.gbpAuthenticatedReviews(workspaceId) });
    queryClient.invalidateQueries({ queryKey: queryKeys.admin.workspaceDeliverables(workspaceId) });
  }, [queryClient, workspaceId]);

  useWorkspaceEvents(workspaceId, {
    // ws-invalidation-ok — rebuilt Local Presence owns its local SEO read model while mounted outside the legacy local-seo page.
    [WS_EVENTS.LOCAL_SEO_UPDATED]: invalidateLocalPresence,
    // ws-invalidation-ok — aggregate GBP snapshots update the Local Presence overview and map-pack context.
    [WS_EVENTS.LOCAL_GBP_SNAPSHOTS_REFRESHED]: invalidateLocalPresence,
    // ws-invalidation-ok — authenticated GBP connection and mapping chips are workspace-scoped.
    [WS_EVENTS.GBP_CONNECTION_UPDATED]: invalidateGbpConnection,
    // ws-invalidation-ok — authenticated review sync updates the Reviews pipeline and aggregate readouts.
    [WS_EVENTS.GBP_REVIEWS_UPDATED]: invalidateGbpReviews,
    // ws-invalidation-ok — response workflow mutations update the Reviews pipeline and client deliverable state.
    [WS_EVENTS.GBP_REVIEW_RESPONSES_UPDATED]: invalidateGbpReviewResponses,
  });

  useEffect(() => {
    if (state.lens !== 'setup') {
      setupAutoOpenRef.current = false;
      return;
    }
    if (!data?.featureEnabled || setupAutoOpenRef.current) return;
    setupAutoOpenRef.current = true;
    setSetupOpen(true);
  }, [data?.featureEnabled, state.lens]);

  const handleSetLens = (lens: LocalPresenceLens) => {
    state.setLens(lens);
    if (lens === 'setup' && data?.featureEnabled) setSetupOpen(true);
  };

  const startLocalRescan = () => {
    localRefresh.mutate({}, {
      onSuccess: () => toast('Local visibility re-scan started', 'success'),
      onError: (error) => toast(mutationErrorMessage(error, 'Local visibility re-scan failed'), 'error'),
    });
  };

  const startGbpRefresh = () => {
    gbpRefresh.mutate(undefined, {
      onSuccess: () => toast('GBP + reviews refresh started', 'success'),
      onError: (error) => toast(mutationErrorMessage(error, 'GBP + reviews refresh failed'), 'error'),
    });
  };

  if (isLockedError(localSeo.error)) {
    return (
      <div className="flex min-h-full flex-col gap-5">
        <PageHeader
          title="Local Presence"
          subtitle="Local markets, map-pack visibility, and Google Business Profile review operations."
        />
        <ErrorState
          type="permission"
          title="Local Presence is locked"
          message="This workspace plan does not include Local Presence access yet."
          className="min-h-[420px]"
        />
      </div>
    );
  }

  if (localSeo.isLoading && !data) {
    return (
      <div className="flex min-h-full flex-col gap-5" aria-label="Loading Local Presence">
        <PageHeader
          title="Local Presence"
          subtitle="Local markets, map-pack visibility, and Google Business Profile review operations."
        />
        <Skeleton className="h-[52px] w-full" />
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          {Array.from({ length: 5 }).map((_, index) => <Skeleton key={index} className="h-[92px] w-full" />)}
        </div>
        <Skeleton className="h-[320px] w-full" />
      </div>
    );
  }

  if (localSeo.isError && !data) {
    return (
      <div className="flex min-h-full flex-col gap-5">
        <PageHeader
          title="Local Presence"
          subtitle="Local markets, map-pack visibility, and Google Business Profile review operations."
        />
        <ErrorState
          type="data"
          title="Local Presence did not load"
          message="Local SEO data could not load. Keyword and ranking data were not changed."
          action={{ label: 'Retry', onClick: () => void localSeo.refetch() }}
          className="min-h-[420px]"
        />
      </div>
    );
  }

  if (!data?.featureEnabled || !report) return null;

  const activeFilter = LOCAL_PRESENCE_FILTERS.find((filter) => filter.id === state.filter)?.label ?? 'All';
  const owned = gbpAggregateEnabled ? gbp?.owned ?? null : null;

  return (
    <div className="flex min-h-full flex-col gap-5">
      <PageHeader
        title="Local Presence"
        subtitle="Local markets, map-pack visibility, and Google Business Profile review operations."
      />

      <Toolbar label="Local Presence view controls" className="w-full">
        <LensSwitcher
          id="local-presence-rebuilt-lens"
          options={LOCAL_PRESENCE_LENSES.map((lens) => ({
            value: lens.id,
            label: lens.label,
            icon: LENS_ICONS[lens.id],
            count: lens.id === 'reviews'
              ? undefined
              : lens.id === 'visibility'
                ? report.checkedKeywordCount
                : lens.id === 'setup'
                  ? report.configuredMarketCount
                  : report.activeMarketCount,
          }))}
          value={state.lens}
          onChange={(value) => handleSetLens(value as LocalPresenceLens)}
          size="sm"
        />
        <SearchField
          value={state.searchInput}
          onChange={state.setSearchInput}
          placeholder="Search reviews or competitors"
          className="min-w-[220px] flex-1"
        />
        <ToolbarSpacer />
        <span className="t-caption text-[var(--brand-text-muted)]">{formatFreshness(report.lastCapturedAt)}</span>
        <Button size="sm" variant="secondary" disabled={!canLocalRefresh || localRefreshing} onClick={startLocalRescan}>
          {localRefreshing ? 'Re-scanning' : 'Re-scan'}
        </Button>
        {gbpAggregateEnabled && (
          <Button size="sm" variant="ghost" disabled={gbpRefreshing} onClick={startGbpRefresh}>
            {gbpRefreshing ? 'Refreshing GBP' : 'Refresh GBP'}
          </Button>
        )}
      </Toolbar>

      <div className="flex flex-wrap gap-2" aria-label="Local Presence filters">
        {LOCAL_PRESENCE_FILTERS.map((filter) => (
          <FilterChip
            key={filter.id}
            label={filter.label}
            active={state.filter === filter.id}
            onClick={() => state.setFilter(filter.id)}
          />
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <MetricTile label="Markets" value={report.activeMarketCount} sub={`${report.configuredMarketCount} configured`} accent="var(--blue)" />
        <MetricTile label="Checked" value={report.checkedKeywordCount} sub={activeFilter} accent="var(--blue)" />
        <MetricTile label="Visible" value={report.visibleCount} sub="local matches" accent="var(--emerald)" />
        <MetricTile label={gbpAggregateEnabled ? 'Reviews' : 'Local packs'} value={gbpAggregateEnabled ? (owned?.reviewCount ?? '—') : report.localPackPresentCount} sub={gbpAggregateEnabled ? `${formatRating(owned?.rating)} rating` : 'packs detected'} accent="var(--blue)" />
        <MetricTile label="Needs review" value={report.possibleMatchCount + report.notVisibleCount + report.degradedCount} sub="posture issues" accent="var(--amber)" />
      </div>

      {localSeo.isError && data && (
        <InlineBanner tone="warning" title="Summary may be stale">
          <div className="flex flex-wrap items-center gap-2">
            <span>Local Presence data did not refresh, so the last loaded numbers are still shown.</span>
            <Button size="sm" variant="secondary" onClick={() => void localSeo.refetch()}>
              Retry summary
            </Button>
          </div>
        </InlineBanner>
      )}

      {state.lens === 'overview' && (
        <LocalPresenceOverview
          workspaceId={workspaceId}
          data={data}
          gbp={gbp}
          onOpenSetup={() => setSetupOpen(true)}
        />
      )}
      {state.lens === 'visibility' && (
        <LocalPresenceVisibility
          workspaceId={workspaceId}
          data={data}
          search={state.search}
          filter={state.filter}
        />
      )}
      {state.lens === 'reviews' && (
        <LocalPresenceReviewsPipeline
          workspaceId={workspaceId}
          desk={state.desk}
          setDesk={state.setDesk}
          search={state.search}
        />
      )}
      {state.lens === 'setup' && (
        <LocalPresenceSetup
          workspaceId={workspaceId}
          data={data}
          onOpenSetup={() => setSetupOpen(true)}
        />
      )}

      <LocalSeoMarketSetupDrawer
        workspaceId={workspaceId}
        data={data}
        open={setupOpen}
        onClose={() => setSetupOpen(false)}
      />
    </div>
  );
}
