// @ds-rebuilt
import { useCallback, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useWorkspaces } from '../../hooks/admin';
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
  Icon,
  InlineBanner,
  SectionCard,
  Skeleton,
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

const SURFACE_WRAP_CLASS = 'mx-auto flex min-h-full w-full max-w-[1120px] flex-col gap-4 px-4 pb-[90px] sm:px-[30px]';

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

function CompetitorsHeader({
  competitorList,
  workspaceName,
  lastScanned,
  onEditSet,
  onRescan,
  rescanDisabled,
}: {
  competitorList: string[];
  workspaceName: string;
  lastScanned: string | null;
  onEditSet: () => void;
  onRescan: () => void;
  rescanDisabled: boolean;
}) {
  const scanLabel = lastScanned ? `Last scanned ${lastScanned}` : 'Ready for next scan';

  return (
    <header
      aria-label="Competitive intelligence header"
      className="flex flex-col gap-[14px]"
    >
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <span className="inline-flex h-[7px] w-[7px] flex-none rounded-[var(--radius-pill)] bg-[var(--orange)]" aria-hidden="true" />
        <span className="eyebrow font-semibold tracking-[0.09em] text-[var(--orange)]">
          Competitive intelligence · {workspaceName}
        </span>
        <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
          <span className="eyebrow inline-flex items-center gap-1.5 normal-case tracking-normal text-[var(--brand-text-muted)]">
            <Icon name="clock" size="sm" />
            Weekly check · {scanLabel}
          </span>
          <Button size="sm" variant="secondary" onClick={onRescan} disabled={rescanDisabled}>
            <Icon name="refresh" size="sm" />
            Re-scan
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
        <div className="inline-flex h-10 w-10 flex-none items-center justify-center rounded-[var(--radius-xl)] bg-[color-mix(in_srgb,var(--orange)_12%,transparent)] text-[var(--orange)]">
          <Icon name="swords" size="lg" />
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="t-h2 font-bold text-[var(--brand-text-bright)]">
            Competitors
          </h1>
          <p className="t-ui mt-1 text-[var(--brand-text)]">
            Share of voice, keyword gaps, backlinks, and competitor movement.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:max-w-[480px] sm:justify-end">
          {competitorList.length > 0 ? (
            competitorList.map((domain) => (
              <span
                key={domain}
                className="eyebrow inline-flex items-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--brand-border)] bg-[var(--surface-2)] px-[9px] py-[5px] leading-none normal-case tracking-normal text-[var(--brand-text)]"
              >
                <span className="h-1.5 w-1.5 rounded-[var(--radius-pill)] bg-[var(--orange)]" aria-hidden="true" />
                {domain}
              </span>
            ))
          ) : (
            <span className="t-mono text-[var(--brand-text-muted)]">No competitor domains configured</span>
          )}
          <Button size="sm" variant="secondary" onClick={onEditSet}>
            Edit set
          </Button>
        </div>
      </div>
    </header>
  );
}

function formatScanTime(value: string | null | undefined): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : DATE_FORMAT.format(parsed);
}

export function CompetitorsSurface({ workspaceId }: CompetitorsSurfaceProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const workspaces = useWorkspaces();
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
  const ownDomain = competitiveIntel.data?.domains.find((domain) => domain.isOwn)?.domain ?? null;
  const workspaceName = workspaces.data?.find((workspace) => workspace.id === workspaceId)?.name
    ?? ownDomain
    ?? 'Current workspace';

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
      <div data-testid="competitors-surface" className={SURFACE_WRAP_CLASS}>
        <CompetitorsHeader
          competitorList={competitorList}
          workspaceName={workspaceName}
          lastScanned={lastScanned}
          onEditSet={() => navigate(adminPath(workspaceId, 'workspace-settings'))}
          onRescan={handleRescan}
          rescanDisabled
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
    <div data-testid="competitors-surface" className={SURFACE_WRAP_CLASS}>
      <CompetitorsHeader
        competitorList={competitorList}
        workspaceName={workspaceName}
        lastScanned={lastScanned}
        onEditSet={() => navigate(adminPath(workspaceId, 'workspace-settings'))}
        onRescan={handleRescan}
        rescanDisabled={competitorList.length === 0 || !seoDataAvailable}
      />

      {loadingStrategy && !data ? (
        <div className="flex flex-col gap-3" aria-label="Loading competitor intelligence">
          <Skeleton className="h-[250px] w-full" />
          <Skeleton className="h-[210px] w-full" />
        </div>
      ) : (
        <>
          {!seoDataAvailable ? (
            <SectionCard variant="subtle" noPadding>
              <EmptyState
                icon={ProviderIcon}
                title="Connect an SEO data provider"
                description="Connect DataForSEO in Workspace Settings to load live domain, keyword, and backlink comparisons."
                action={(
                  <Button size="sm" variant="primary" onClick={() => navigate(adminPath(workspaceId, 'workspace-settings'))}>
                    <Icon name="settings" size="sm" />
                    Open Workspace Settings
                  </Button>
                )}
              />
            </SectionCard>
          ) : competitorList.length === 0 ? (
            <SectionCard variant="subtle" noPadding>
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
            </SectionCard>
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
              <BacklinkProfileCard workspaceId={workspaceId} domain={ownDomain} />
            </>
          )}
        </>
      )}
    </div>
  );
}
