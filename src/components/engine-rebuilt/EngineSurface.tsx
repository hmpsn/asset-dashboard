// @ds-rebuilt
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { BarChart3, ClipboardList, FileText, ListChecks, Network, Settings2, Target } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
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
  EmptyState,
  ErrorState,
  GroupBlock,
  Icon,
  InlineBanner,
  LensSwitcher,
  MetricTile,
  PageContainer,
  PageHeader,
  ProgressIndicator,
  Skeleton,
  Toolbar,
  ToolbarSpacer,
  ProvenanceChip,
} from '../ui';
import {
  StrategyHeaderActions,
  StrategyStalenessNudges,
  StrategyEmptyState,
  StrategyCockpit,
} from '../strategy';
import { StrategyDiff } from '../strategy/StrategyDiff';
import { IntelligenceSignals } from '../strategy/IntelligenceSignals';
import { LostQueryRecoveryCard } from '../strategy/LostQueryRecoveryCard';
import { StanceBar } from '../strategy/issue/StanceBar';
import { DraftedPovEditor } from '../strategy/issue/DraftedPovEditor';
import { BackingMovesQueue } from '../strategy/issue/BackingMovesQueue';
import { AddRecommendationModal } from '../strategy/issue/AddRecommendationModal';
import { CurationMeter } from '../strategy/CurationMeter';
import { NeedsAttentionStrip, type AttentionKind } from '../strategy/NeedsAttentionStrip';
import { buildAttentionItems, countSentThisCycle } from '../strategy/cockpitAttention';
import { toCockpitRow, sortRecs, FIX_NOW_CAP, bucketOf } from '../strategy/cockpitRowModel';
import { LocalSeoMarketSetupDrawer } from '../local-seo/LocalSeoMarketSetupDrawer';
import { EngineWorkQueue } from './EngineWorkQueue';
import { EngineMoveDrawer } from './EngineMoveDrawer';
import { EngineOperations } from './EngineOperations';
import { ENGINE_LENSES, type EngineLens, useEngineSurfaceState } from './useEngineSurfaceState';
import { formatDate, formatMoney, provenanceBasis } from './engineFormatters';
import { mutationErrorMessage } from './engineMutationFeedback';

interface EngineSurfaceProps {
  workspaceId: string;
}

const LENS_ICONS: Record<EngineLens, LucideIcon> = {
  spine: Target,
  changes: ClipboardList,
  signals: BarChart3,
  pov: FileText,
  moves: ListChecks,
  operations: Settings2,
};

function initialsFor(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean).slice(0, 2);
  return (parts.map((part) => part[0]).join('') || 'WS').toUpperCase();
}

function moneyFrameMeta(precomputedAt: string | undefined): string {
  return precomputedAt ? `Precomputed ${formatDate(precomputedAt)}` : 'No cached frame yet';
}

function EngineEmptyIcon({ className }: { className?: string }) {
  return <Icon name="target" className={className} />;
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
}) {
  const displayedVerdict = verdict || 'Draft the client-facing verdict before sending the update.';
  const displayedExplanation = explanation || 'The client preview will combine the verdict, value frame, and proof once a point of view is drafted.';
  const moveCount = totalMoves > 0 ? `${curatedCount} / ${totalMoves}` : '—';

  return (
    <div data-testid="engine-trust-spine-preview">
      <GroupBlock
        title={`What ${workspaceName} sees - the trust spine`}
        meta="Verdict first, dollar value, then proof"
        headingLevel="h2"
      >
        <div className="overflow-hidden rounded-[var(--radius-lg)] border border-[var(--brand-border)] bg-[var(--surface-1)]">
          <div className="flex h-8 items-center gap-2 border-b border-[var(--brand-border)] bg-[var(--surface-3)] px-3">
            <span className="h-2 w-2 bg-[var(--red)]" style={{ borderRadius: 'var(--radius-pill)' }} aria-hidden="true" />
            <span className="h-2 w-2 bg-[var(--amber)]" style={{ borderRadius: 'var(--radius-pill)' }} aria-hidden="true" />
            <span className="h-2 w-2 bg-[var(--emerald)]" style={{ borderRadius: 'var(--radius-pill)' }} aria-hidden="true" />
            <span className="ml-1 truncate t-micro text-[var(--brand-text-muted)]">client portal preview</span>
            <span className="ml-auto flex-none">
              {basis ? <ProvenanceChip basis={basis} /> : <Badge label="proof pending" tone="zinc" variant="soft" size="sm" />}
            </span>
          </div>
          <div className="grid gap-5 p-5 lg:grid-cols-[minmax(0,1.2fr)_minmax(260px,.8fr)]">
            <div className="min-w-0">
              <div className="t-label text-[var(--teal)]">Where {workspaceName} stands this quarter</div>
              <h3 className="mt-2 t-page font-semibold text-[var(--brand-text-bright)]">{displayedVerdict}</h3>
              <p className="mt-2 max-w-[64ch] t-body text-[var(--brand-text-muted)]">{displayedExplanation}</p>
              <div className="mt-4 flex flex-wrap gap-2">
                <Badge label={`${stagedCount} staged`} tone="teal" variant="soft" size="sm" />
                <Badge label={`${curatedCount} with client`} tone="blue" variant="soft" size="sm" />
              </div>
            </div>

            <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-1">
              <MetricTile
                label="Pipeline value at stake"
                value={valueAtStake}
                accent="var(--brand-text-bright)"
              />
              <MetricTile
                label="Recovered so far"
                value={recoveredSoFar}
                accent="var(--teal)"
              />
              <MetricTile
                label="Backing moves live"
                value={moveCount}
                accent="var(--blue)"
              />
            </div>
          </div>

          <div className="flex items-start gap-3 border-t border-[var(--brand-border)] bg-[var(--surface-2)] px-5 py-3">
            <Icon name="trophy" size="md" className="mt-0.5 text-[var(--emerald)]" />
            <p className="m-0 t-body text-[var(--brand-text-muted)]">
              The client sees the verdict, value frame, and proof before this update is sent.
            </p>
          </div>
        </div>
      </GroupBlock>
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

  const workspaceName = engine.workspace?.webflowSiteName || engine.workspace?.name || 'Workspace';
  const workspaceInitials = initialsFor(workspaceName);
  const strategy = engine.strategy;
  const moneyFrame = engine.homeQuery.data?.moneyFrame ?? null;
  const basis = provenanceBasis(moneyFrame?.provenance);
  const selectedMove = useMemo(
    () => engine.cockpitRecs.find((rec) => rec.id === selectedMoveId) ?? null,
    [engine.cockpitRecs, selectedMoveId],
  );
  const attentionItems = useMemo(() => buildAttentionItems(engine.cockpitRecs), [engine.cockpitRecs]);
  const sentThisCycle = useMemo(() => countSentThisCycle(engine.cockpitRecs), [engine.cockpitRecs]);
  const fixNow = useMemo(
    () => sortRecs(engine.cockpitRecs.filter((rec) => toCockpitRow(rec).isFixNow), 'value').slice(0, FIX_NOW_CAP),
    [engine.cockpitRecs],
  );
  const hasWordingOverride = Object.values(engine.operatorSteering.wording).some(
    (override) => !!override && (!!override.title || !!override.insight),
  );
  const povMayBeStale =
    !!engine.strategyPov.pov &&
    !!engine.strategyPov.pov.generatedAt &&
    (engine.struckRecIds.length > 0 || hasWordingOverride);
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

  if ((engine.keywordQuery.isLoading || engine.homeQuery.isLoading) && !engine.keywordQuery.data) {
    return (
      <PageContainer width="wide" className="min-h-full">
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

  if (engine.keywordQuery.isError && !engine.keywordQuery.data) {
    return (
      <PageContainer width="wide" className="min-h-full">
        <PageHeader title="Insights Engine" subtitle="Operator strategy, curation, and evidence." />
        <ErrorState
          type="data"
          title="Engine data did not load"
          message="Retry the strategy read before reviewing operator work."
          action={{ label: 'Retry', onClick: () => void engine.keywordQuery.refetch() }}
          className="min-h-[420px]"
        />
      </PageContainer>
    );
  }

  return (
    <PageContainer width="wide" className="min-h-full" gap={false}>
      <div data-testid="engine-rebuilt-surface" className="flex flex-col gap-[var(--section-gap)]">
        <PageHeader
          title="Insights Engine"
          subtitle={headerSubtitle}
          icon={<Icon name="target" size="lg" className="text-[var(--teal)]" />}
          className="flex-col items-start gap-3 sm:flex-row sm:items-center [&>div:last-child]:w-full sm:[&>div:last-child]:w-auto"
          actions={(
            <div data-testid="engine-header-actions" className="flex w-full max-w-full flex-col items-stretch gap-2 sm:w-auto sm:items-end">
              <div className="flex w-full flex-col items-stretch gap-2 sm:w-auto sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
                <div className="w-full min-w-0 sm:w-auto">{headerActions}</div>
                <span className="t-caption-sm text-[var(--brand-text-muted)] tabular-nums sm:text-right">
                  {engine.stagedCount} staged · {engine.curatedCount} already with client
                </span>
                <Button
                  variant="primary"
                  size="md"
                  className="w-full sm:w-auto"
                  disabled={!canSendIssue || engine.issueBulkSend.isPending}
                  loading={engine.issueBulkSend.isPending}
                  onClick={engine.sendIssue}
                >
                  <Icon name="send" size="sm" />
                  Send issue
                </Button>
              </div>
              {!canSendIssue && (
                <span className="t-caption-sm text-[var(--brand-text-muted)] sm:text-right">
                  Stage moves below to send.
                </span>
              )}
            </div>
          )}
        />

        {state.invalidLens && (
          <InlineBanner
            tone="warning"
            title="Unknown Engine lens"
            message="The requested lens is not active, so Engine opened the spine."
            data-testid="engine-invalid-lens-fallback"
          />
        )}
        {state.invalidTab && (
          <InlineBanner
            tone="warning"
            title="Unknown Strategy tab"
            message="This rebuilt surface uses lens links. Engine opened the default spine."
            data-testid="engine-invalid-tab-fallback"
          />
        )}

        <CommandCenterVerdict
          eyebrow="Operator verdict"
          iconName={engine.strategyPov.pov?.verdictHeadline ? 'gauge' : 'info'}
          title={engine.strategyPov.pov?.verdictHeadline ?? 'No server verdict drafted yet'}
          description={
            engine.strategyPov.pov?.verdictHeadline
              ? (engine.strategyPov.pov.situation || engine.strategyPov.pov.leadSentence)
              : 'Generate or regenerate the point of view to receive the server-owned verdict headline.'
          }
          meta={(
            <div className="flex flex-wrap items-center justify-end gap-2">
              {basis ? <ProvenanceChip basis={basis} /> : <Badge label="money frame missing" tone="zinc" variant="soft" size="sm" />}
              {moneyFrame?.precomputedAt && (
                <span className="t-caption-sm text-[var(--brand-text-muted)]">
                  {formatDate(moneyFrame.precomputedAt)}
                </span>
              )}
            </div>
          )}
        />

        <div className="grid gap-3 md:grid-cols-3">
          <MetricTile
            label="Value at stake"
            value={formatMoney(moneyFrame?.valueAtStake)}
            sub={moneyFrameMeta(moneyFrame?.precomputedAt)}
            accent="var(--brand-text-bright)"
            icon={Target}
          />
          <MetricTile
            label="Recovered so far"
            value={formatMoney(moneyFrame?.recoveredSoFar)}
            sub={basis ? `${basis} basis` : 'Awaiting cron snapshot'}
            accent="var(--blue)"
            icon={BarChart3}
          />
          <MetricTile
            label="Backing moves"
            value={engine.cockpitRecs.length || '—'}
            sub={`${engine.stagedCount} staged · ${engine.curatedCount} with client`}
            accent="var(--teal)"
            icon={Network}
          />
        </div>

        {!moneyFrame && (
          <InlineBanner
            tone="info"
            title="Cached money frame is not ready"
            message="The admin money-frame cron has not precomputed this workspace yet, so Engine shows absence instead of calculating live."
          />
        )}

        <Toolbar label="Engine controls" className="w-full">
          <LensSwitcher
            options={ENGINE_LENSES.map((lens) => ({
              value: lens.id,
              label: lens.label,
              icon: LENS_ICONS[lens.id],
              count: lens.id === 'moves' ? engine.cockpitRecs.length : undefined,
            }))}
            value={state.lens}
            onChange={(value) => state.setLens(value as EngineLens)}
            size="sm"
          />
          <ToolbarSpacer />
          <span className="t-caption-sm text-[var(--brand-text-muted)]">
            {engine.homeQuery.dataUpdatedAt ? `Data as of ${formatDate(new Date(engine.homeQuery.dataUpdatedAt))}` : 'Freshness unavailable'}
          </span>
          <Button
            variant="secondary"
            size="sm"
            onClick={handleRefresh}
            loading={engine.homeQuery.isFetching || engine.keywordQuery.isFetching}
          >
            <Icon name="refresh" size="sm" />
            Refresh
          </Button>
        </Toolbar>

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

        {!engine.isRealStrategy ? (
          <div data-testid="engine-empty-strategy">
            <StrategyEmptyState />
          </div>
        ) : (
          <>
            {state.lens === 'spine' && (
              <div className="space-y-6" data-testid="engine-lens-spine">
                <StanceBar recs={engine.cockpitRecs} />
                <DraftedPovEditor
                  pov={engine.strategyPov.pov}
                  onEdit={engine.strategyPov.edit}
                  struckRecIds={engine.struckRecIds}
                  onRegenerate={engine.strategyPov.regenerate}
                  isGenerating={engine.strategyPov.isGenerating}
                />
                {povMayBeStale && (
                  <InlineBanner
                    tone="warning"
                    title="Point of view may be out of date"
                    message="Cut or edited backing moves can make the drafted point of view stale."
                  >
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => engine.strategyPov.regenerate()}
                      loading={engine.strategyPov.isGenerating}
                      disabled={engine.strategyPov.isGenerating}
                    >
                      Regenerate
                    </Button>
                  </InlineBanner>
                )}
                <BackingMovesQueue
                  workspaceId={workspaceId}
                  recs={engine.cockpitRecs}
                  actions={engine.lifecycleActions}
                  onCut={engine.markCut}
                  shortlistCap={5}
                  onEditWording={engine.operatorSteering.editWording}
                  stagedCount={engine.stagedCount}
                  curatedCount={engine.curatedCount}
                  stagedRecIds={engine.stagedRecIds}
                  onStage={engine.toggleStage}
                  onStageMany={engine.stageMany}
                  onAddRec={() => setAddRecOpen(true)}
                />
                <ClientTrustSpinePreview
                  workspaceName={workspaceName}
                  verdict={engine.strategyPov.pov?.verdictHeadline}
                  explanation={engine.strategyPov.pov?.situation || engine.strategyPov.pov?.leadSentence}
                  valueAtStake={formatMoney(moneyFrame?.valueAtStake)}
                  recoveredSoFar={formatMoney(moneyFrame?.recoveredSoFar)}
                  basis={basis}
                  stagedCount={engine.stagedCount}
                  curatedCount={engine.curatedCount}
                  totalMoves={engine.cockpitRecs.length}
                />
              </div>
            )}

            {state.lens === 'changes' && (
              <div className="space-y-4" data-testid="engine-lens-changes">
                <StrategyDiff workspaceId={workspaceId} />
              </div>
            )}

            {state.lens === 'signals' && (
              <div className="space-y-4" data-testid="engine-lens-signals">
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
                <IntelligenceSignals workspaceId={workspaceId} />
                <LostQueryRecoveryCard workspaceId={workspaceId} />
              </div>
            )}

            {state.lens === 'pov' && (
              <div className="space-y-4" data-testid="engine-lens-pov">
                <StanceBar recs={engine.cockpitRecs} />
                <DraftedPovEditor
                  pov={engine.strategyPov.pov}
                  onEdit={engine.strategyPov.edit}
                  struckRecIds={engine.struckRecIds}
                  onRegenerate={engine.strategyPov.regenerate}
                  isGenerating={engine.strategyPov.isGenerating}
                />
              </div>
            )}

            {state.lens === 'moves' && (
              <div className="space-y-5" data-testid="engine-lens-moves">
                <CurationMeter sentThisCycle={sentThisCycle} />
                <NeedsAttentionStrip items={attentionItems} onAct={handleAttentionAct} />

                {fixNow.length > 0 && (
                  <EngineWorkQueue
                    workQueue={{
                      streams: {
                        opt: fixNow.filter((rec) => bucketOf(rec) === 'active').length,
                        send: fixNow.filter((rec) => rec.clientStatus === 'sent' || rec.clientStatus === 'approved').length,
                        money: fixNow.filter((rec) => (rec.opportunity?.value ?? 0) >= 1000).length,
                        unclassified: 0,
                      },
                      items: fixNow.map((rec) => engine.moveQueueItems.find((item) => item.id === rec.id)).filter((item): item is WorkQueueItem => !!item),
                    }}
                    stream="all"
                    onStreamChange={() => undefined}
                    activeSourceTypes={new Set()}
                    sourceTypeCounts={engine.moveQueueSourceCounts}
                    onToggleSourceType={() => undefined}
                    onClearSourceTypes={() => undefined}
                    clientName={workspaceName}
                    clientInitials={workspaceInitials}
                    onOpenItem={(item) => setSelectedMoveId(item.id)}
                    title={`Fix now · ${fixNow.length}`}
                    emptyTitle="No fix-now moves"
                  />
                )}

                <EngineWorkQueue
                  workQueue={{
                    streams: {
                      opt: engine.moveQueueItems.filter((item) => item.stream === 'opt').length,
                      send: engine.moveQueueItems.filter((item) => item.stream === 'send').length,
                      money: engine.moveQueueItems.filter((item) => item.stream === 'money').length,
                      unclassified: engine.moveQueueItems.filter((item) => item.stream === 'unclassified').length,
                    },
                    items: engine.moveQueueItems,
                  }}
                  stream={state.stream}
                  onStreamChange={state.setStream}
                  activeSourceTypes={state.activeSourceTypes}
                  sourceTypeCounts={engine.moveQueueSourceCounts}
                  onToggleSourceType={state.toggleSourceType}
                  onClearSourceTypes={state.clearSourceTypes}
                  clientName={workspaceName}
                  clientInitials={workspaceInitials}
                  onOpenItem={(item) => setSelectedMoveId(item.id)}
                  title="Move drawer index"
                  emptyTitle="No moves match this view"
                />

                <StrategyCockpit
                  workspaceId={workspaceId}
                  recs={engine.cockpitRecs}
                  actions={engine.lifecycleActions}
                />
              </div>
            )}

            {state.lens === 'operations' && (
              <EngineOperations
                workspaceId={workspaceId}
                engine={engine}
                onOpenLocalSeoSetup={() => setLocalSeoSetupOpen(true)}
              />
            )}
          </>
        )}

        {engine.stagedCount > 0 && (
          <div
            className="sticky bottom-4 z-[var(--z-sticky)] flex items-center justify-between gap-4 rounded-[var(--radius-lg)] border bg-[var(--surface-2)] px-4 py-3 shadow-[var(--shadow-lg)]"
            style={{ borderColor: 'color-mix(in srgb, var(--teal) 35%, var(--brand-border))' }}
            data-testid="engine-docked-send-bar"
          >
            <span className="t-caption-sm text-[var(--brand-text-muted)] tabular-nums">
              {engine.stagedCount} staged · {engine.curatedCount} already with client
            </span>
            <Button
              variant="primary"
              size="sm"
              loading={engine.issueBulkSend.isPending}
              disabled={!engine.stagedCount || engine.issueBulkSend.isPending}
              onClick={engine.sendIssue}
              data-testid="engine-docked-send-btn"
            >
              <Icon name="send" size="sm" />
              Send {engine.stagedCount} staged
            </Button>
          </div>
        )}

        <EngineMoveDrawer
          open={selectedMove !== null}
          rec={selectedMove}
          workspaceId={workspaceId}
          actions={engine.lifecycleActions}
          cannibalizationEntries={strategy?.cannibalization ?? []}
          onClose={() => setSelectedMoveId(null)}
        />

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
