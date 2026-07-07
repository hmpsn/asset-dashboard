// @ds-rebuilt
import { useCallback, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useKeywordStrategy } from '../../hooks/admin/useKeywordStrategy';
import { useFeatureFlag } from '../../hooks/useFeatureFlag';
import { useWorkspaceEvents } from '../../hooks/useWorkspaceEvents';
import { queryKeys } from '../../lib/queryKeys';
import { WS_EVENTS } from '../../lib/wsEvents';
import { adminPath } from '../../routes';
import { useStrategySettings } from '../strategy/hooks/useStrategySettings';
import {
  Button,
  EmptyState,
  ErrorState,
  FilterChip,
  Icon,
  InlineBanner,
  PageHeader,
  Skeleton,
  Toolbar,
  ToolbarSpacer,
} from '../ui';
import { BacklinkProfileCard } from './BacklinkProfileCard';
import { CompetitorAlerts } from './CompetitorAlerts';
import { HeadToHeadTable } from './HeadToHeadTable';
import { KeywordGapsCard } from './KeywordGapsCard';
import { ShareOfVoice } from './ShareOfVoice';
import { useCompetitiveIntel } from './useCompetitiveIntel';
import type { KeywordGap } from './types';

interface CompetitorsSurfaceProps {
  workspaceId: string;
}

const DATE_FORMAT = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});

function parseCompetitors(value: string | undefined): string[] {
  return (value ?? '')
    .split(/[,\n]+/)
    .map((domain) => domain.trim())
    .filter(Boolean);
}

function EmptyIcon({ className }: { className?: string }) {
  return <Icon name="swords" className={className} />;
}

function ProviderIcon({ className }: { className?: string }) {
  return <Icon name="key" className={className} />;
}

function formatScanTime(value: string | null | undefined): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : DATE_FORMAT.format(parsed);
}

export function CompetitorsSurface({ workspaceId }: CompetitorsSurfaceProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const keywordStrategy = useKeywordStrategy(workspaceId);
  const data = keywordStrategy.data;
  const strategy = data?.strategy ?? null;
  const settings = useStrategySettings(data, strategy, workspaceId, true);
  const fallbackCompetitors = data?.workspaceData?.competitorDomains ?? [];
  const competitorList = useMemo(() => {
    const fromSettings = parseCompetitors(settings.competitors);
    return fromSettings.length > 0 ? fromSettings : fallbackCompetitors;
  }, [fallbackCompetitors, settings.competitors]);
  const seoDataAvailable = settings.seoDataAvailable;
  const keywordGaps = (strategy?.keywordGaps ?? []) as KeywordGap[];
  const commandCenterEnabled = useFeatureFlag('strategy-command-center');
  const competitorSendFlag = useFeatureFlag('strategy-competitor-send');
  const competitorSendEnabled = commandCenterEnabled && competitorSendFlag;
  const competitiveIntel = useCompetitiveIntel(workspaceId, competitorList, seoDataAvailable);
  const lastScanned = formatScanTime(competitiveIntel.data?.fetchedAt);

  const invalidateCompetitors = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: queryKeys.admin.keywordStrategy(workspaceId) });
    queryClient.invalidateQueries({ queryKey: queryKeys.admin.competitorIntelAll(workspaceId) });
    queryClient.invalidateQueries({ queryKey: queryKeys.admin.backlinkProfile(workspaceId) });
    queryClient.invalidateQueries({ queryKey: queryKeys.admin.competitorAlerts(workspaceId) });
  }, [queryClient, workspaceId]);

  useWorkspaceEvents(workspaceId, {
    // ws-invalidation-ok - rebuilt Competitors owns its workspace-scoped strategy refresh because it is mounted outside the legacy Strategy tab composition.
    [WS_EVENTS.STRATEGY_UPDATED]: invalidateCompetitors,
  });

  const handleRescan = () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.admin.competitorIntelAll(workspaceId) });
    queryClient.invalidateQueries({ queryKey: queryKeys.admin.backlinkProfile(workspaceId) });
    queryClient.invalidateQueries({ queryKey: queryKeys.admin.competitorAlerts(workspaceId) });
    void competitiveIntel.refetch();
  };

  const loadingStrategy = keywordStrategy.isLoading || keywordStrategy.isAuxLoading;

  if (keywordStrategy.isError && !data) {
    return (
      <div className="flex min-h-full flex-col gap-5">
        <PageHeader
          title="Competitors"
          subtitle="Share of voice, keyword gaps, backlinks, and competitor movement."
        />
        <ErrorState
          type="data"
          title="Competitor setup did not load"
          message="Retry the workspace strategy read before checking competitor intelligence."
          action={{ label: 'Retry', onClick: () => keywordStrategy.refetch() }}
          className="min-h-[420px]"
        />
      </div>
    );
  }

  return (
    <div className="flex min-h-full flex-col gap-5">
      <PageHeader
        title="Competitors"
        subtitle="Share of voice, keyword gaps, backlinks, and competitor movement."
        actions={(
          <div className="flex flex-wrap items-center justify-end gap-2">
            {lastScanned && <span className="t-caption-sm text-[var(--brand-text-muted)]">Last scanned {lastScanned}</span>}
            <Button size="sm" variant="secondary" onClick={handleRescan} disabled={competitorList.length === 0 || !seoDataAvailable}>
              <Icon name="refresh" size="sm" />
              Re-scan
            </Button>
          </div>
        )}
      />

      {loadingStrategy && !data ? (
        <div className="flex flex-col gap-3" aria-label="Loading competitor intelligence">
          <Skeleton className="h-[48px] w-full" />
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {Array.from({ length: 4 }).map((_, index) => <Skeleton key={index} className="h-[92px] w-full" />)}
          </div>
          <Skeleton className="h-[260px] w-full" />
        </div>
      ) : (
        <>
          <Toolbar label="Competitor set controls" className="w-full">
            <div className="flex min-w-0 flex-wrap items-center gap-2" aria-label="Configured competitor set">
              {competitorList.length > 0 ? (
                competitorList.map((domain) => (
                  <FilterChip key={domain} label={domain} />
                ))
              ) : (
                <span className="t-caption-sm text-[var(--brand-text-muted)]">No competitor domains configured</span>
              )}
            </div>
            <ToolbarSpacer />
            <Button size="sm" variant="secondary" onClick={() => navigate(adminPath(workspaceId, 'workspace-settings'))}>
              <Icon name="settings" size="sm" />
              Edit set
            </Button>
          </Toolbar>

          {!seoDataAvailable ? (
            <EmptyState
              icon={ProviderIcon}
              title="Competitive intelligence requires DataForSEO"
              description="Configure a provider in Workspace Settings to load live domain, keyword, and backlink comparisons."
              action={(
                <Button size="sm" variant="primary" onClick={() => navigate(adminPath(workspaceId, 'workspace-settings'))}>
                  <Icon name="settings" size="sm" />
                  Open Workspace Settings
                </Button>
              )}
            />
          ) : competitorList.length === 0 ? (
            <EmptyState
              icon={EmptyIcon}
              title="Add competitor domains"
              description="This page reads the saved competitor set. Add domains in Workspace Settings before scanning."
              action={(
                <Button size="sm" variant="primary" onClick={() => navigate(adminPath(workspaceId, 'workspace-settings'))}>
                  <Icon name="settings" size="sm" />
                  Edit competitor set
                </Button>
              )}
            />
          ) : (
            <>
              {keywordStrategy.isError && data && (
                <InlineBanner tone="warning" title="Competitor setup may be stale">
                  The latest strategy settings did not refresh, so this view is using the last loaded competitor set.
                </InlineBanner>
              )}

              <CompetitorAlerts workspaceId={workspaceId} competitorCount={competitorList.length} />
              <ShareOfVoice data={competitiveIntel.data} isLoading={competitiveIntel.isLoading} />
              <HeadToHeadTable
                data={competitiveIntel.data}
                isLoading={competitiveIntel.isLoading}
                isFetching={competitiveIntel.isFetching}
                isError={competitiveIntel.isError}
                error={competitiveIntel.error}
                onRetry={() => { void competitiveIntel.refetch(); }}
              />
              <KeywordGapsCard
                workspaceId={workspaceId}
                liveGaps={competitiveIntel.data?.keywordGaps ?? []}
                cachedGaps={keywordGaps}
                liveError={competitiveIntel.isError}
                showSend={competitorSendEnabled}
              />
              <BacklinkProfileCard workspaceId={workspaceId} />
            </>
          )}
        </>
      )}
    </div>
  );
}
