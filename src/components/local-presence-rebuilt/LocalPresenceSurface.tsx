// @ds-rebuilt
import { useCallback, useEffect, useRef, useState } from 'react';
import { MapPin, Star, type LucideIcon } from 'lucide-react';
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
  Icon,
  InlineBanner,
  LensSwitcher,
  PageHeader,
  SearchField,
  Skeleton,
} from '../ui';
import { LocalPresenceOverview } from './LocalPresenceOverview';
import { LocalPresenceReviewsPipeline } from './LocalPresenceReviewsPipeline';
import { LocalPresenceVisibility } from './LocalPresenceVisibility';
import { mutationErrorMessage } from './localPresenceMutationFeedback';
import { useLocalPresenceSurfaceState } from './useLocalPresenceSurfaceState';

interface LocalPresenceSurfaceProps {
  workspaceId: string;
}

const DATE_FORMAT = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});

const LOCAL_PRESENCE_MODES = [
  { id: 'presence', label: 'Rank & profile' },
  { id: 'reviews', label: 'Reviews & replies' },
] as const;

type LocalPresenceMode = typeof LOCAL_PRESENCE_MODES[number]['id'];

const MODE_ICONS: Record<LocalPresenceMode, LucideIcon> = {
  presence: MapPin,
  reviews: Star,
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

  const activeMode: LocalPresenceMode = state.lens === 'reviews' ? 'reviews' : 'presence';

  const handleSetMode = (mode: LocalPresenceMode) => {
    state.setLens(mode === 'reviews' ? 'reviews' : 'overview');
  };

  const closeSetup = () => {
    setSetupOpen(false);
    if (state.lens === 'setup') state.setLens('overview');
  };

  return (
    <div className="mx-auto flex min-h-full w-full max-w-[1120px] flex-col gap-[14px] px-4 pb-[90px] pt-[26px] sm:px-[30px]">
      <div className="flex flex-wrap items-center gap-2 t-mono text-[var(--brand-text-dim)]">
        <span className="h-[7px] w-[7px] rounded-[var(--radius-pill)] bg-[var(--blue)]" aria-hidden="true" />
        <h1 className="t-mono font-semibold uppercase tracking-[0.09em] text-[var(--blue)]">Local Presence</h1>
        <span aria-hidden="true">·</span>
        <span>{formatFreshness(report.lastCapturedAt)}</span>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Button size="sm" variant="ghost" onClick={() => setSetupOpen(true)}>
            <Icon name="settings" size="sm" />
            Configure market
          </Button>
          <Button size="sm" variant="secondary" disabled={!canLocalRefresh || localRefreshing} onClick={startLocalRescan}>
            <Icon name="refresh" size="sm" />
            {localRefreshing ? 'Re-scanning' : 'Re-scan'}
          </Button>
          {gbpAggregateEnabled && (
            <Button size="sm" variant="ghost" disabled={gbpRefreshing} onClick={startGbpRefresh}>
              {gbpRefreshing ? 'Refreshing GBP' : 'Refresh GBP'}
            </Button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <LensSwitcher
          id="local-presence-rebuilt-lens"
          options={LOCAL_PRESENCE_MODES.map((mode) => ({
            value: mode.id,
            label: mode.label,
            icon: MODE_ICONS[mode.id],
          }))}
          value={activeMode}
          onChange={(value) => handleSetMode(value as LocalPresenceMode)}
          size="sm"
          className="w-full sm:w-fit [&>button]:min-w-0 [&>button]:flex-1 [&>button]:px-2 sm:[&>button]:flex-none sm:[&>button]:px-[11px] [&_svg]:hidden sm:[&_svg]:block"
        />
        {activeMode === 'reviews' && (
          <SearchField
            value={state.searchInput}
            onChange={state.setSearchInput}
            placeholder="Search reviews"
            className="min-w-[220px] max-w-[360px] flex-1"
          />
        )}
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

      {activeMode === 'presence' && (
        <div className="flex flex-col gap-4">
          <LocalPresenceOverview
            workspaceId={workspaceId}
            data={data}
            gbp={gbpAggregateEnabled ? gbp : undefined}
            onOpenSetup={() => setSetupOpen(true)}
          />
          <LocalPresenceVisibility
            workspaceId={workspaceId}
            data={data}
            gbp={gbpAggregateEnabled ? gbp : undefined}
            search={state.search}
            searchInput={state.searchInput}
            filter={state.filter}
            onSearchInputChange={state.setSearchInput}
            onFilterChange={state.setFilter}
            onOpenReviews={() => state.setLens('reviews')}
          />
        </div>
      )}
      {activeMode === 'reviews' && (
        <LocalPresenceReviewsPipeline
          workspaceId={workspaceId}
          desk={state.desk}
          setDesk={state.setDesk}
          search={state.search}
        />
      )}
      <LocalSeoMarketSetupDrawer
        workspaceId={workspaceId}
        data={data}
        open={setupOpen}
        onClose={closeSetup}
      />
    </div>
  );
}
