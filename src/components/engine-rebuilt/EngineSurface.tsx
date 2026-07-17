// @ds-rebuilt
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { BarChart3, ClipboardList, Network, Target } from 'lucide-react';
import type { WorkQueueItem } from '../../../shared/types/work-queue';
import { useEngineRebuilt } from '../../hooks/admin/useEngineRebuilt';
import { useToast } from '../Toast';
import { adminPath } from '../../routes';
import { queryKeys } from '../../lib/queryKeys';
import { RefreshOrderingPrompt } from '../keyword-strategy/RefreshOrderingPrompt';
import {
  Badge,
  Button,
  CommandCenterVerdict,
  Disclosure,
  Drawer,
  EmptyState,
  ErrorState,
  Icon,
  InlineBanner,
  LensSwitcher,
  MetricTile,
  PageContainer,
  PageHeader,
  ProgressIndicator,
  SectionCard,
  Skeleton,
  StatCard,
  Toolbar,
  ProvenanceChip,
} from '../ui';
import { RebuiltTopbarActions } from '../layout/RebuiltAppChrome';
import {
  StrategyHeaderActions,
  StrategyStalenessNudges,
  StrategyEmptyState,
} from '../strategy';
import { StrategyDiff } from '../strategy/StrategyDiff';
import { IntelligenceSignals } from '../strategy/IntelligenceSignals';
import { LostQueryRecoveryCard } from '../strategy/LostQueryRecoveryCard';
import { StanceBar } from '../strategy/issue/StanceBar';
import { DraftedPovEditor } from '../strategy/issue/DraftedPovEditor';
import { BackingMovesQueue } from '../strategy/issue/BackingMovesQueue';
import { AddRecommendationModal } from '../strategy/issue/AddRecommendationModal';
import { ContentWorkOrderLens } from '../strategy/issue/ContentWorkOrderLens';
import { KeywordTargetsLens } from '../strategy/issue/KeywordTargetsLens';
import { CurationMeter } from '../strategy/CurationMeter';
import { NeedsAttentionStrip, type AttentionKind } from '../strategy/NeedsAttentionStrip';
import { buildAttentionItems, countSentThisCycle } from '../strategy/cockpitAttention';
import { LocalSeoMarketSetupDrawer } from '../local-seo/LocalSeoMarketSetupDrawer';
import { EngineWorkQueue } from './EngineWorkQueue';
import { EngineMoveDrawer } from './EngineMoveDrawer';
import { EngineOperations } from './EngineOperations';
import { type EngineLens, useEngineSurfaceState } from './useEngineSurfaceState';
import { formatDate, formatMoney, provenanceBasis } from './engineFormatters';
import { mutationErrorMessage } from './engineMutationFeedback';

interface EngineSurfaceProps {
  workspaceId: string;
}

const ENGINE_SECTION_IDS: Record<EngineLens, string> = {
  spine: 'engine-orientation',
  changes: 'engine-what-changed',
  signals: 'engine-strategy-evidence',
  pov: 'engine-client-pov',
  moves: 'engine-backing-moves',
  operations: 'engine-operations',
};

const PROJECTION_LENSES = [
  { id: 'keywords', label: 'Keyword targets', icon: Target },
  { id: 'content', label: 'Content work orders', icon: ClipboardList },
] as const;

type ProjectionLens = typeof PROJECTION_LENSES[number]['id'];

const ENGINE_PAGE_STYLE = {
  maxWidth: 'calc(var(--page-max) - (2 * var(--page-pad-x)))',
  padding: 0,
} as const;

function initialsFor(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean).slice(0, 2);
  return (parts.map((part) => part[0]).join('') || 'WS').toUpperCase();
}

function moneyFrameMeta(precomputedAt: string | undefined): string {
  return precomputedAt ? `Updated ${formatDate(precomputedAt)}` : 'Measurement pending';
}

function concisePovHeadline(verdictHeadline: string | undefined, leadSentence: string | undefined): string | undefined {
  if (verdictHeadline) return verdictHeadline;
  if (!leadSentence) return undefined;
  const boundary = leadSentence.match(/,(["”]?)\s+(?:because|since|which)\b/i);
  const firstClause = boundary?.index === undefined
    ? leadSentence
    : `${leadSentence.slice(0, boundary.index)}${boundary[1]}`;
  const trimmed = firstClause.trim().replace(/,+$/, '');
  if (/[.!?]["”]?$/.test(trimmed)) return trimmed;
  if (/["”]$/.test(trimmed)) return `${trimmed.slice(0, -1)}.${trimmed.slice(-1)}`;
  return `${trimmed}.`;
}

function EngineEmptyIcon({ className }: { className?: string }) {
  return <Icon name="target" className={className} />;
}

function EngineProjectionLenses({
  workspaceId,
  stagedRecIds,
  isLoading,
  isError,
  isStale,
  onRetry,
}: {
  workspaceId: string;
  stagedRecIds: ReadonlySet<string>;
  isLoading: boolean;
  isError: boolean;
  isStale: boolean;
  onRetry: () => void;
}) {
  const [projectionLens, setProjectionLens] = useState<ProjectionLens>('keywords');

  return (
    <section
      id="engine-projections"
      data-testid="engine-section-projections"
      tabIndex={-1}
      className="outline-none"
      style={{ outline: 'none' }}
    >
      <SectionCard
        title="What each staged move becomes"
        subtitle="Staged moves project into targets and work orders, then link to the owning surface"
        titleIcon={<Icon name="layers" size="md" className="text-[var(--teal)]" />}
        className="[&>div:first-child]:flex-col [&>div:first-child]:items-stretch [&>div:first-child]:gap-3 sm:[&>div:first-child]:flex-row sm:[&>div:first-child]:items-center max-sm:[&>div:first-child_.t-body]:whitespace-normal max-sm:[&>div:first-child_.t-body]:overflow-visible max-sm:[&>div:first-child_.t-body]:text-clip"
        iconChip
        noPadding
        action={(
          <LensSwitcher
            options={PROJECTION_LENSES.map((lens) => ({
              value: lens.id,
              label: lens.label,
              icon: lens.icon,
            }))}
            value={projectionLens}
            onChange={(value) => setProjectionLens(value as ProjectionLens)}
            size="sm"
            className="w-full overflow-x-auto sm:w-fit max-sm:[&>button]:min-w-0 max-sm:[&>button]:flex-1 max-sm:[&>button]:whitespace-normal"
          />
        )}
      >
        {isLoading ? (
          <div data-testid="engine-projections-loading" className="space-y-3 p-4">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : isError ? (
          <div className="p-4">
            <ErrorState
              type="data"
              title="Projection data did not load"
              message="Retry the recommendation read before relying on staged keyword targets or content work orders."
              action={{ label: 'Retry projections', onClick: onRetry }}
            />
          </div>
        ) : (
          <>
            {isStale && (
              <InlineBanner tone="warning" title="Projections may be stale" className="m-3 mb-0">
                <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <span>The last staged recommendation set remains projected while the latest refresh is unavailable.</span>
                  <Button size="sm" variant="secondary" onClick={onRetry}>
                    Refresh projections
                  </Button>
                </div>
              </InlineBanner>
            )}
            {projectionLens === 'keywords' ? (
              <KeywordTargetsLens
                workspaceId={workspaceId}
                theIssueEnabled
                embedded
                includedRecIds={stagedRecIds}
                presentation="engine-spine"
              />
            ) : (
              <ContentWorkOrderLens
                workspaceId={workspaceId}
                theIssueEnabled
                embedded
                includedRecIds={stagedRecIds}
                presentation="engine-spine"
              />
            )}
          </>
        )}
      </SectionCard>
    </section>
  );
}

function ClientTrustSpinePreview({
  workspaceName,
  verdict,
  explanation,
  valueAtStake,
  recoveredSoFar,
  basis,
  stagedCount,
  curatedCount,
  totalMoves,
  recommendationsReady,
  recommendationsSummary,
  povLoading,
  povReadUnavailable,
}: {
  workspaceName: string;
  verdict: string | undefined;
  explanation: string | undefined;
  valueAtStake: string;
  recoveredSoFar: string;
  basis: ReturnType<typeof provenanceBasis>;
  stagedCount: number;
  curatedCount: number;
  totalMoves: number;
  recommendationsReady: boolean;
  recommendationsSummary: string;
  povLoading: boolean;
  povReadUnavailable: boolean;
}) {
  const displayedVerdict = verdict
    || (povReadUnavailable
      ? 'Point of view temporarily unavailable.'
      : povLoading
        ? 'Loading the saved point of view.'
        : 'Draft the client-facing verdict before sending the update.');
  const displayedExplanation = explanation
    || (povReadUnavailable
      ? 'The saved client narrative could not be read. Retry before sending this preview.'
      : povLoading
        ? 'The client narrative will appear here as soon as the saved point of view loads.'
        : 'The client preview will combine the verdict, value frame, and proof once a point of view is drafted.');
  const moveCount = recommendationsReady ? `${curatedCount} / ${totalMoves}` : '—';
  const moveSummary = recommendationsReady
    ? `${stagedCount} staged · ${curatedCount} with client`
    : recommendationsSummary;

  return (
    <div data-testid="engine-trust-spine-preview">
      <SectionCard
        title={`What ${workspaceName} sees — the trust spine`}
        subtitle="Verdict first, dollar value, then the proof"
        titleIcon={<Icon name="eye" size="md" className="text-[var(--teal)]" />}
        className="max-sm:[&>div:first-child_.t-body]:whitespace-normal max-sm:[&>div:first-child_.t-body]:overflow-visible max-sm:[&>div:first-child_.t-body]:text-clip"
        iconChip
      >
        <div
          data-testid="engine-client-portal-frame"
          className="dashboard-light overflow-hidden rounded-[var(--radius-lg)] border border-[var(--brand-border-strong)] bg-[var(--surface-1)] shadow-[var(--shadow-sm)]"
        >
          <div className="flex h-8 items-center gap-2 border-b border-[var(--brand-border)] bg-[var(--surface-3)] px-3">
            <span className="h-2 w-2 bg-[var(--red)]" style={{ borderRadius: 'var(--radius-pill)' }} aria-hidden="true" />
            <span className="h-2 w-2 bg-[var(--amber)]" style={{ borderRadius: 'var(--radius-pill)' }} aria-hidden="true" />
            <span className="h-2 w-2 bg-[var(--emerald)]" style={{ borderRadius: 'var(--radius-pill)' }} aria-hidden="true" />
            <span className="ml-1 truncate t-micro text-[var(--brand-text-muted)]">
              Client portal preview · {workspaceName}
            </span>
            <span className="ml-auto flex-none">
              {basis ? <ProvenanceChip basis={basis} /> : <Badge label="proof pending" tone="zinc" variant="soft" size="sm" />}
            </span>
          </div>
          <div className="p-5">
            <div className="min-w-0">
              <div className="t-label text-[var(--teal)]">Where you stand this quarter</div>
              <h3 className="mt-2 max-w-[26ch] t-stat-sm font-bold text-[var(--brand-text-bright)]">{displayedVerdict}</h3>
              <p className="mt-2 max-w-[52ch] t-ui text-[var(--brand-text-muted)]">{displayedExplanation}</p>
            </div>

            <div data-testid="engine-client-proof-row" className="mt-4 grid gap-3 sm:grid-cols-3">
              <div
                data-testid="engine-preview-recovered"
                className="min-w-[130px] overflow-hidden rounded-[var(--radius-signature)] border"
                style={{
                  background: 'color-mix(in srgb, var(--teal) 8%, var(--surface-2))',
                  border: '1px solid color-mix(in srgb, var(--teal) 28%, var(--brand-border))',
                  borderColor: 'color-mix(in srgb, var(--teal) 28%, var(--brand-border))',
                }}
              >
                <MetricTile
                  label="Recovered so far"
                  value={recoveredSoFar}
                  sub={`of ${valueAtStake} targeted`}
                  accent="var(--teal)"
                  className="min-w-0 border-0 bg-transparent"
                  style={{ background: 'transparent', borderColor: 'transparent' }}
                />
              </div>
              <MetricTile
                label="Pipeline value at stake"
                value={valueAtStake}
                accent="var(--brand-text-bright)"
              />
              <MetricTile
                label="Backing moves live"
                value={moveCount}
                sub={moveSummary}
                accent="var(--blue)"
              />
            </div>

          </div>
        </div>
      </SectionCard>
    </div>
  );
}

export function EngineSurface({ workspaceId }: EngineSurfaceProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const state = useEngineSurfaceState(workspaceId);
  const engine = useEngineRebuilt(workspaceId);
  const [selectedMoveId, setSelectedMoveId] = useState<string | null>(null);
  const [addRecOpen, setAddRecOpen] = useState(false);
  const [localSeoSetupOpen, setLocalSeoSetupOpen] = useState(false);
  const [povEditorOpen, setPovEditorOpen] = useState(false);

  const workspaceName = engine.workspace?.webflowSiteName || engine.workspace?.name || 'Workspace';
  const workspaceInitials = initialsFor(workspaceName);
  const strategy = engine.strategy;
  const moneyFrame = engine.homeQuery.data?.moneyFrame ?? null;
  const basis = provenanceBasis(moneyFrame?.provenance);
  const verdictTitle = concisePovHeadline(
    engine.strategyPov.pov?.verdictHeadline,
    engine.strategyPov.pov?.leadSentence,
  );
  const verdictExplanation = engine.strategyPov.pov?.situation
    || engine.strategyPov.pov?.leadSentence
    || undefined;
  const recommendationsHaveData = engine.recommendations.data !== undefined;
  const recommendationsInitialPending = !recommendationsHaveData && !engine.recommendations.isError;
  const recommendationsUnavailable = engine.recommendations.isError && !recommendationsHaveData;
  const recommendationsStale = engine.recommendations.isError && recommendationsHaveData;
  const povInitialLoading = engine.strategyPov.isLoading && !engine.strategyPov.pov;
  const povReadUnavailable = engine.strategyPov.isError && !engine.strategyPov.pov;
  const backingMovesValue = recommendationsHaveData ? engine.activeRecs.length : '—';
  const backingMovesSummary = recommendationsInitialPending
    ? 'Loading recommendation queue'
    : recommendationsUnavailable
      ? 'Recommendation queue unavailable'
      : `${engine.stagedCount} staged · ${engine.curatedCount} with client`;
  const selectedMove = useMemo(
    () => engine.cockpitRecs.find((rec) => rec.id === selectedMoveId) ?? null,
    [engine.cockpitRecs, selectedMoveId],
  );
  const attentionItems = useMemo(() => buildAttentionItems(engine.cockpitRecs), [engine.cockpitRecs]);
  const sentThisCycle = useMemo(() => countSentThisCycle(engine.cockpitRecs), [engine.cockpitRecs]);
  const headerSubtitle = !engine.isRealStrategy
    ? 'Operator command surface for strategy generation, curation, and evidence.'
    : `Generated ${formatDate(strategy?.generatedAt)} · ${strategy?.pageMap?.length ?? 0} pages mapped`;
  const headerActions = (
    <StrategyHeaderActions
      isRealStrategy={engine.isRealStrategy}
      generating={engine.generation.generating}
      localSyncApplies={!!engine.localSync?.applies}
      localNeedsRefresh={!!engine.localSync?.localNeedsRefresh}
      refreshPending={engine.generation.refresh.isPending}
      onIncremental={() => engine.generation.generateStrategy('incremental')}
      onFullRefresh={() => engine.generation.refresh.mutate({
        thenRegenerateStrategy: true,
        strategyGeneration: engine.settings.buildStrategyGenerationParams(),
      })}
      onGenerate={() => engine.generation.generateStrategy('full')}
    />
  );
  const canSendIssue = engine.stagedCount > 0;
  const sendHelperId = `engine-topbar-send-helper-${workspaceId}`;

  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.admin.workspaceHome(workspaceId) });
    queryClient.invalidateQueries({ queryKey: queryKeys.admin.keywordStrategy(workspaceId) });
    toast('Engine refresh started', 'success');
    void Promise.all([engine.homeQuery.refetch(), engine.keywordQuery.refetch()]).then((results) => {
      const failed = results.find((result) => result.error);
      if (failed?.error) {
        toast(mutationErrorMessage(failed.error, 'Engine refresh failed'), 'error');
      }
    });
  };

  const topbarActions = (
    <>
      <div className="min-w-max">{headerActions}</div>
      <Button
        variant="secondary"
        size="sm"
        onClick={handleRefresh}
        loading={engine.homeQuery.isFetching || engine.keywordQuery.isFetching}
      >
        <Icon name="refresh" size="sm" />
        Refresh
      </Button>
      {!canSendIssue && (
        <span id={sendHelperId} className="whitespace-nowrap t-caption-sm text-[var(--brand-text-muted)]">
          0 staged — stage moves below to send
        </span>
      )}
      <Button
        variant="primary"
        size="sm"
        loading={engine.issueBulkSend.isPending}
        disabled={engine.issueBulkSend.isPending || !canSendIssue}
        onClick={engine.sendIssue}
        data-testid="engine-topbar-send-btn"
        aria-describedby={!canSendIssue ? sendHelperId : undefined}
        title={!canSendIssue ? '0 staged — stage moves below to send' : undefined}
      >
        <Icon name="send" size="sm" />
        Send {engine.stagedCount} staged
      </Button>
    </>
  );

  const handleOpenSharedQueueItem = (item: WorkQueueItem) => {
    switch (item.sourceType) {
      case 'request':
      case 'churn_signal':
        navigate(`${adminPath(workspaceId, 'requests')}?tab=requests`); // inbox-legacy-filter-literal-ok -- admin Requests page deep-link, not the client inbox filter
        return;
      case 'work_order':
        navigate(adminPath(workspaceId, 'content-pipeline'));
        return;
      case 'content_decay':
        navigate(`${adminPath(workspaceId, 'content-pipeline')}?tab=content-health`);
        return;
      case 'content_request':
      case 'content_pipeline':
        navigate(`${adminPath(workspaceId, 'content-pipeline')}?tab=briefs`);
        return;
      case 'rank_drop':
        navigate(`${adminPath(workspaceId, 'seo-keywords')}?lens=rankings`);
        return;
      case 'audit_error':
        navigate(adminPath(workspaceId, 'seo-audit'));
        return;
      case 'setup_gap':
        navigate(`${adminPath(workspaceId, 'workspace-settings')}?tab=connections`);
        return;
    }
  };

  const handleAttentionAct = (recId: string, _kind: AttentionKind) => {
    state.setLens('moves');
    setSelectedMoveId(recId);
  };

  const refreshPrompt = engine.localSync?.applies && engine.localSync.localNeedsRefresh ? (
    <RefreshOrderingPrompt
      open={engine.generation.refreshOrderingPromptOpen}
      reason={engine.localSync.localNeedsRefreshReason ?? 'stale'}
      lastLocalRefreshAt={engine.localSync.lastLocalRefreshAt}
      onFullRefresh={() => {
        engine.generation.refresh.mutate({
          thenRegenerateStrategy: true,
          strategyGeneration: engine.settings.buildStrategyGenerationParams(),
        });
        engine.generation.setRefreshOrderingPromptOpen(false);
      }}
      onGenerateAnyway={() => {
        engine.generation.setRefreshOrderingPromptOpen(false);
        void engine.generation.runStartJob('full');
      }}
      onCancel={() => engine.generation.setRefreshOrderingPromptOpen(false)}
    />
  ) : null;

  const progress = (
    <ProgressIndicator
      status={engine.generation.generating ? 'running' : 'idle'}
      step={engine.generation.activeStrategyJob?.message || (engine.generation.startingStrategyJob ? 'Starting keyword strategy job...' : undefined)}
      percent={engine.generation.activeStrategyJob?.total
        ? Math.round(((engine.generation.activeStrategyJob.progress ?? 0) / engine.generation.activeStrategyJob.total) * 100)
        : undefined}
    />
  );

  const keywordSnapshotAvailable = engine.keywordQuery.data !== undefined;
  const homeSnapshotAvailable = engine.homeQuery.data !== undefined;
  const keywordReadUnavailable = engine.keywordQuery.isError && !keywordSnapshotAvailable;
  const homeReadUnavailable = engine.homeQuery.isError && !homeSnapshotAvailable;
  const initialSnapshotPending = !keywordReadUnavailable
    && !homeReadUnavailable
    && (!keywordSnapshotAvailable || !homeSnapshotAvailable);

  useEffect(() => {
    if (!state.rawLens || state.invalidLens) return;
    const target = document.getElementById(ENGINE_SECTION_IDS[state.lens]);
    if (!target) return;
    target.focus({ preventScroll: true });
    target.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  }, [
    engine.homeQuery.isLoading,
    engine.isRealStrategy,
    engine.keywordQuery.isLoading,
    state.invalidLens,
    state.lens,
    state.rawLens,
  ]);

  if (initialSnapshotPending) {
    return (
      <PageContainer width="default" className="min-h-full" style={ENGINE_PAGE_STYLE}>
        <div data-testid="engine-rebuilt-loading" className="flex flex-col gap-5">
          <Skeleton className="h-[72px] w-full" />
          <Skeleton className="h-[148px] w-full" />
          <div className="grid gap-3 md:grid-cols-3">
            <Skeleton className="h-[112px] w-full" />
            <Skeleton className="h-[112px] w-full" />
            <Skeleton className="h-[112px] w-full" />
          </div>
          <Skeleton className="h-[420px] w-full" />
        </div>
      </PageContainer>
    );
  }

  if (keywordReadUnavailable || homeReadUnavailable) {
    const bothReadsUnavailable = keywordReadUnavailable && homeReadUnavailable;
    const retryUnavailableReads = () => {
      const retries: Array<Promise<unknown>> = [];
      if (keywordReadUnavailable) retries.push(engine.keywordQuery.refetch());
      if (homeReadUnavailable) retries.push(engine.homeQuery.refetch());
      void Promise.all(retries);
    };
    return (
      <PageContainer width="default" className="min-h-full" style={ENGINE_PAGE_STYLE}>
        <PageHeader title="Insights Engine" subtitle="Operator strategy, curation, and evidence." />
        <ErrorState
          type="data"
          title={homeReadUnavailable && !keywordReadUnavailable
            ? 'Engine summary did not load'
            : 'Engine data did not load'}
          message={bothReadsUnavailable
            ? 'Retry the strategy and aggregate workspace reads before reviewing operator work.'
            : keywordReadUnavailable
              ? 'Retry the strategy read before reviewing operator work.'
              : 'Retry the aggregate workspace read before relying on value, freshness, and work-queue evidence.'}
          action={{ label: 'Retry', onClick: retryUnavailableReads }}
          className="min-h-[420px]"
        />
      </PageContainer>
    );
  }

  return (
    <PageContainer width="default" className="min-h-full" gap={false} style={ENGINE_PAGE_STYLE}>
      <div data-testid="engine-rebuilt-surface" className="flex flex-col gap-[var(--space-4)]">
        <RebuiltTopbarActions
          fallback={(
            <div
              data-testid="engine-topbar-actions-fallback"
              className="flex max-w-full items-center justify-end gap-2 overflow-x-auto"
            >
              {topbarActions}
            </div>
          )}
        >
          {topbarActions}
        </RebuiltTopbarActions>

        {state.invalidLens && (
          <InlineBanner
            tone="warning"
            title="Unknown Engine view"
            message="The requested view is not available, so Engine opened the strategy overview."
            data-testid="engine-invalid-lens-fallback"
          />
        )}
        {state.invalidTab && (
          <InlineBanner
            tone="warning"
            title="Unknown Strategy link"
            message="Engine opened the default strategy overview."
            data-testid="engine-invalid-tab-fallback"
          />
        )}

        <div data-testid="engine-opening-cluster" className="flex flex-col gap-0">
          <Toolbar label="Insights Engine controls" className="w-full" align="center">
            <div className="min-w-0 flex-1 sm:flex sm:items-center sm:gap-3">
              <h1 className="t-label m-0 flex-none text-[var(--teal)]">
                Insights Engine · {workspaceName}
              </h1>
              <p className="mt-1 t-caption-sm text-[var(--brand-text-muted)] sm:mt-0">
                {headerSubtitle}
                {' · '}
                {engine.homeQuery.dataUpdatedAt
                  ? `Data as of ${formatDate(new Date(engine.homeQuery.dataUpdatedAt))}`
                  : 'Freshness unavailable'}
              </p>
            </div>
          </Toolbar>

          <section
            id={ENGINE_SECTION_IDS.spine}
            data-testid="engine-section-orientation"
            tabIndex={-1}
            className="space-y-[var(--space-4)] outline-none"
            style={{ outline: 'none' }}
          >
            <div
              id={ENGINE_SECTION_IDS.changes}
              data-testid="engine-section-changes"
              tabIndex={-1}
              className="outline-none"
              style={{ outline: 'none' }}
            >
              <StrategyDiff
                key={state.lens === 'changes' && state.rawLens ? 'changes-open' : 'changes-default'}
                workspaceId={workspaceId}
                defaultExpanded={state.lens === 'changes' && !!state.rawLens}
                presentation="engine-spine"
              />
            </div>
            <StrategyStalenessNudges
              hasVolumeValidation={engine.metrics.hasVolumeValidation}
              localSyncApplies={!!engine.localSync?.applies}
              strategyStaleVsLocal={!!engine.localSync?.strategyStaleVsLocal}
              lastLocalRefreshAt={engine.localSync?.lastLocalRefreshAt}
              lastStrategyGeneratedAt={engine.localSync?.lastStrategyGeneratedAt}
              dismissedRefreshAt={engine.generation.dismissedRefreshAt}
              onDismiss={() => engine.generation.setDismissedRefreshAt(engine.localSync?.lastLocalRefreshAt ?? null)}
              onGenerate={() => engine.generation.generateStrategy('full')}
            />
            <CommandCenterVerdict
              iconName={null}
              title={(
                <span className="block max-w-[26ch] font-bold">
                  {verdictTitle
                    ?? (povReadUnavailable
                      ? 'Point of view temporarily unavailable'
                      : povInitialLoading
                        ? 'Loading point of view'
                        : 'No strategy verdict drafted yet')}
                </span>
              )}
              description={(
                <span className="t-page">
                  {verdictTitle
                    ? verdictExplanation
                    : povReadUnavailable
                      ? 'Retry the saved point of view read before reviewing or sending the client narrative.'
                      : povInitialLoading
                        ? 'The saved client narrative is being loaded.'
                        : 'Generate or refresh the point of view to draft the opening verdict.'}
                </span>
              )}
              className="px-7 py-6"
            />
          </section>
        </div>

        <section
          id="engine-value-frame"
          data-testid="engine-section-value-frame"
          tabIndex={-1}
          className="space-y-3 outline-none"
          style={{ outline: 'none' }}
        >
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[1.3fr_repeat(3,minmax(0,1fr))]">
            <StatCard
              label="Pipeline value at stake"
              value={formatMoney(moneyFrame?.valueAtStake)}
              sub={moneyFrameMeta(moneyFrame?.precomputedAt)}
              size="hero"
              tone="teal"
              valueColor="text-[var(--teal)]"
              iconColor="var(--teal)"
              icon={Target}
              trailing={basis
                ? <ProvenanceChip basis={basis} />
                : <Badge label="proof pending" tone="zinc" variant="soft" size="sm" />}
            />
            <MetricTile
              label="Recovered so far"
              value={formatMoney(moneyFrame?.recoveredSoFar)}
              sub={basis ? `${basis} basis` : 'Measurement pending'}
              accent="var(--blue)"
              icon={BarChart3}
            />
            <MetricTile
              label="Backing moves live"
              value={backingMovesValue}
              sub={backingMovesSummary}
              accent="var(--blue)"
              icon={Network}
            />
            <MetricTile
              label="Average position"
              value={Number.isFinite(engine.metrics.avgPos) && engine.metrics.ranked.length > 0
                ? `#${engine.metrics.avgPos.toFixed(1)}`
                : '—'}
              sub={engine.metrics.ranked.length > 0
                ? `${engine.metrics.ranked.length} ranked pages`
                : 'Ranking evidence pending'}
              accent="var(--blue)"
              icon={BarChart3}
            />
          </div>

          {!moneyFrame && (
            <InlineBanner
              tone="info"
              title="Value proof is still being prepared"
              message="No measured value snapshot is available yet. Engine will show it after the next data refresh."
            />
          )}
        </section>

        {engine.homeQuery.isError && engine.homeQuery.data && (
          <InlineBanner
            tone="warning"
            title="Summary may be stale"
            message="The latest aggregate refresh failed, so the last loaded Engine numbers are still shown."
          >
            <Button variant="link" size="sm" onClick={handleRefresh}>Retry</Button>
          </InlineBanner>
        )}

        {refreshPrompt}
        {progress}
        {engine.generation.error && (
          <ErrorState
            type="general"
            title="Strategy generation failed"
            message={engine.generation.error}
            action={{ label: 'Try again', onClick: () => engine.generation.generateStrategy('full') }}
          />
        )}

        {!engine.isRealStrategy ? (
          <div data-testid="engine-empty-strategy">
            <StrategyEmptyState />
          </div>
        ) : (
          <>
            <section
              id={ENGINE_SECTION_IDS.pov}
              data-testid="engine-section-pov"
              tabIndex={-1}
              className="space-y-4 outline-none"
              style={{ outline: 'none' }}
            >
              {povInitialLoading ? (
                <SectionCard
                  title={`The point of view we send ${workspaceName}`}
                  subtitle="Loading the saved client narrative"
                  titleIcon={<Icon name="file" size="md" className="text-[var(--teal)]" />}
                  iconChip
                >
                  <div data-testid="engine-pov-loading" className="space-y-3">
                    <Skeleton className="h-5 w-2/3" />
                    <Skeleton className="h-16 w-full" />
                  </div>
                </SectionCard>
              ) : povReadUnavailable ? (
                <ErrorState
                  type="data"
                  title="Point of view did not load"
                  message="Retry the saved POV read. Generate and regenerate remain separate actions."
                  action={{ label: 'Retry', onClick: engine.strategyPov.retry }}
                />
              ) : (
                <DraftedPovEditor
                  pov={engine.strategyPov.pov}
                  title={`The point of view we send ${workspaceName}`}
                  subtitle="The plain-language read the client opens with"
                  onEdit={engine.strategyPov.edit}
                  struckRecIds={engine.struckRecIds}
                  onRegenerate={engine.strategyPov.regenerate}
                  isGenerating={engine.strategyPov.isGenerating}
                  presentation="engine-summary"
                  stagedCount={recommendationsHaveData ? engine.stagedCount : undefined}
                  onOpenEditor={() => setPovEditorOpen(true)}
                />
              )}
              {engine.strategyPov.isError && engine.strategyPov.pov && (
                <InlineBanner
                  tone="warning"
                  title="Point of view may be stale"
                  message="The latest POV read failed, so the last saved narrative remains visible."
                >
                  <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <span>The latest POV read failed, so the last saved narrative remains visible.</span>
                    <Button variant="secondary" size="sm" onClick={engine.strategyPov.retry}>Retry</Button>
                  </div>
                </InlineBanner>
              )}
              {!povReadUnavailable && engine.strategyPov.refreshAvailable && (
                <InlineBanner
                  tone="warning"
                  title="Point of view refresh available"
                >
                  <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <span>
                      {engine.strategyPov.pov?.editedAt
                        ? 'Evidence or brand voice changed after your edits. Your saved wording was preserved; regenerate only when you are ready to replace it.'
                        : 'Evidence or brand voice changed since this point of view was generated. Regenerate when you are ready to replace it with a current draft.'}
                    </span>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => engine.strategyPov.regenerate()}
                      loading={engine.strategyPov.isGenerating}
                      disabled={engine.strategyPov.isGenerating}
                      className="flex-shrink-0"
                    >
                      Regenerate
                    </Button>
                  </div>
                </InlineBanner>
              )}
              {!povReadUnavailable && engine.strategyPov.generateError != null && (
                <InlineBanner
                  tone="error"
                  title="Point of view update failed"
                  message={mutationErrorMessage(
                    engine.strategyPov.generateError,
                    'The current point of view is still safe. Try regenerating again in a moment.',
                  )}
                />
              )}
            </section>

            <section
              id="engine-stance"
              data-testid="engine-section-stance"
              tabIndex={-1}
              className="outline-none"
              style={{ outline: 'none' }}
            >
              <SectionCard
                title="How we are spending the effort"
                subtitle="Where this quarter's work is allocated"
                titleIcon={<Icon name="filter" size="md" className="text-[var(--teal)]" />}
                iconChip
              >
                {recommendationsInitialPending ? (
                  <Skeleton className="h-14 w-full" />
                ) : recommendationsUnavailable ? (
                  <InlineBanner
                    tone="warning"
                    title="Effort allocation unavailable"
                    message="The recommendation queue must load before Engine can show its allocation."
                  />
                ) : (
                  <StanceBar recs={engine.activeRecs} />
                )}
              </SectionCard>
            </section>

            <section
              id={ENGINE_SECTION_IDS.signals}
              data-testid="engine-section-strategy-evidence"
              tabIndex={-1}
              className="space-y-4 outline-none"
              style={{ outline: 'none' }}
            >
              <IntelligenceSignals
                workspaceId={workspaceId}
                title="Signals the Engine is watching"
                subtitle="Strategy-relevant patterns detected across rankings, content, and intent"
                initialLimit={4}
                presentation="engine-spine"
              />
              <LostQueryRecoveryCard workspaceId={workspaceId} />
            </section>

            <section
              id={ENGINE_SECTION_IDS.moves}
              data-testid="engine-section-backing-moves"
              tabIndex={-1}
              className="space-y-5 outline-none"
              style={{ outline: 'none' }}
            >
              {(sentThisCycle > 0 || attentionItems.length > 0) && (
                <div
                  data-testid="engine-move-support-row"
                  className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-start"
                >
                  <CurationMeter sentThisCycle={sentThisCycle} presentation="engine-spine" />
                  <NeedsAttentionStrip
                    items={attentionItems}
                    onAct={handleAttentionAct}
                    presentation="engine-spine"
                  />
                </div>
              )}
              {recommendationsStale && (
                <InlineBanner tone="warning" title="Recommendation queue may be stale">
                  <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <span>The latest refresh failed, so Engine is keeping the last loaded moves visible.</span>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => void engine.recommendations.refetch()}
                    >
                      Retry
                    </Button>
                  </div>
                </InlineBanner>
              )}
              {recommendationsInitialPending ? (
                <div data-testid="engine-recommendations-loading">
                  <SectionCard
                    title="Backing moves"
                    subtitle="Loading the recommendations staged to back this point of view"
                    titleIcon={<Icon name="layers" size="md" className="text-[var(--teal)]" />}
                    iconChip
                  >
                    <div className="space-y-3">
                      <Skeleton className="h-20 w-full" />
                      <Skeleton className="h-20 w-full" />
                    </div>
                  </SectionCard>
                </div>
              ) : recommendationsUnavailable ? (
                <ErrorState
                  type="data"
                  title="Recommendation queue did not load"
                  message="Retry the canonical recommendation read before reviewing or sending Backing Moves."
                  action={{ label: 'Retry', onClick: () => void engine.recommendations.refetch() }}
                />
              ) : (
                <BackingMovesQueue
                  workspaceId={workspaceId}
                  recs={engine.activeRecs}
                  actions={engine.lifecycleActions}
                  onCut={engine.markCut}
                  shortlistCap={1}
                  subtitle="The recommendations staged to back this point of view"
                  onEditWording={engine.operatorSteering.editWording}
                  stagedCount={engine.stagedCount}
                  curatedCount={engine.curatedCount}
                  stagedRecIds={engine.stagedSendableSet}
                  stageableRecIds={engine.sendableSet}
                  onStage={engine.toggleStage}
                  onStageMany={engine.stageMany}
                  onAddRec={() => setAddRecOpen(true)}
                  onOpenDetails={setSelectedMoveId}
                  presentation="engine-spine"
                />
              )}

            </section>

            <EngineProjectionLenses
              workspaceId={workspaceId}
              stagedRecIds={engine.stagedSendableSet}
              isLoading={recommendationsInitialPending}
              isError={recommendationsUnavailable}
              isStale={recommendationsStale}
              onRetry={() => { void engine.recommendations.refetch(); }}
            />

            <ClientTrustSpinePreview
              workspaceName={workspaceName}
              verdict={verdictTitle}
              explanation={verdictExplanation}
              valueAtStake={formatMoney(moneyFrame?.valueAtStake)}
              recoveredSoFar={formatMoney(moneyFrame?.recoveredSoFar)}
              basis={basis}
              stagedCount={engine.stagedCount}
              curatedCount={engine.curatedCount}
              totalMoves={engine.cockpitRecs.length}
              recommendationsReady={recommendationsHaveData}
              recommendationsSummary={backingMovesSummary}
              povLoading={povInitialLoading}
              povReadUnavailable={povReadUnavailable}
            />

          </>
        )}

        <section
          id={ENGINE_SECTION_IDS.operations}
          data-testid="engine-section-operations"
          tabIndex={-1}
          className="outline-none"
          style={{ outline: 'none' }}
        >
          <Disclosure
            key={state.lens === 'operations' && state.rawLens ? 'operations-open' : 'operations-closed'}
            defaultOpen={state.lens === 'operations' && !!state.rawLens}
            summary={(
              <div className="min-w-0">
                <h2 className="t-ui font-semibold text-[var(--brand-text-bright)]">
                  Setup and operator tools
                </h2>
                <p className="mt-1 t-body font-normal text-[var(--brand-text-muted)]">
                  Configuration, trust controls, client signals, and cross-surface work.
                </p>
              </div>
            )}
          >
            <div className="space-y-5 pt-2">
              <EngineOperations
                workspaceId={workspaceId}
                engine={engine}
                onOpenLocalSeoSetup={() => setLocalSeoSetupOpen(true)}
              />
              <EngineWorkQueue
                workQueue={engine.workQueue}
                stream={state.stream}
                onStreamChange={state.setStream}
                activeSourceTypes={state.activeSourceTypes}
                sourceTypeCounts={engine.workQueueSourceCounts}
                onToggleSourceType={state.toggleSourceType}
                onClearSourceTypes={state.clearSourceTypes}
                clientName={workspaceName}
                clientInitials={workspaceInitials}
                onOpenItem={handleOpenSharedQueueItem}
                title="Shared operator queue"
              />
            </div>
          </Disclosure>
        </section>

        <EngineMoveDrawer
          open={selectedMove !== null}
          rec={selectedMove}
          cannibalizationEntries={strategy?.cannibalization ?? []}
          onClose={() => setSelectedMoveId(null)}
        />

        <Drawer
          open={povEditorOpen}
          onClose={() => setPovEditorOpen(false)}
          title={`Edit the point of view we send ${workspaceName}`}
          subtitle="Edit the complete client narrative or regenerate it from the current strategy."
          width="min(620px, 94vw)"
        >
          <DraftedPovEditor
            pov={engine.strategyPov.pov}
            title="Point of view details"
            subtitle="Situation, lead move, wins, and flags"
            onEdit={engine.strategyPov.edit}
            struckRecIds={engine.struckRecIds}
            onRegenerate={engine.strategyPov.regenerate}
            isGenerating={engine.strategyPov.isGenerating}
          />
        </Drawer>

        <AddRecommendationModal
          open={addRecOpen}
          onClose={() => setAddRecOpen(false)}
          onCreate={(payload) => {
            engine.operatorSteering.addManualRec(payload);
            setAddRecOpen(false);
          }}
          isPending={engine.operatorSteering.isPending}
        />

        {engine.localSeo.data && (
          <LocalSeoMarketSetupDrawer
            workspaceId={workspaceId}
            data={engine.localSeo.data}
            open={localSeoSetupOpen}
            onClose={() => setLocalSeoSetupOpen(false)}
          />
        )}

        {!engine.isRealStrategy && engine.generation.generating && (
          <EmptyState
            icon={EngineEmptyIcon}
            title="Strategy generation is running"
            description="The Engine will populate once the background job finishes."
          />
        )}
      </div>
    </PageContainer>
  );
}

export default EngineSurface;
