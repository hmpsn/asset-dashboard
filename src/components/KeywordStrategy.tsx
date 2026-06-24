import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Target, FileText, HelpCircle, Plus, Search, ArrowRight, AlertTriangle } from 'lucide-react';
import { AIContextIndicator, TabBar, ErrorState, EmptyState, ProgressIndicator, NextStepsCard, LoadingState, PageHeader, Icon, Tooltip, IconButton, Button, ClickableRow } from './ui';
import { isCuratedForClient } from '../../shared/recommendation-predicates';
import { formatDate } from '../utils/formatDates';
import { kdColor } from './page-intelligence/pageIntelligenceDisplay';
import { useKeywordStrategy, useLocalSeo } from '../hooks/admin';
import { useAdminRecommendationSet } from '../hooks/admin/useAdminRecommendations';
import { useRecommendationLifecycle } from '../hooks/admin/useRecommendationLifecycle';
import { useContentDecay } from '../hooks/admin/useContentDecay';
import { useStrategyKeywordSet } from '../hooks/admin/useStrategyKeywordSet';
import { useStrategyPov } from '../hooks/admin/useStrategyPov';
import { useOperatorSteering } from '../hooks/admin/useOperatorSteering';
import { useRecBulkMutation } from '../hooks/admin/useRecBulkMutation';
import { useFeatureFlag } from '../hooks/useFeatureFlag';
import { useToggleSet, UNBOUNDED_TOGGLE_SET_OPTIONS } from '../hooks/useToggleSet';
import { resolveTabSearchParam, clearTabSearchParam } from '../lib/tab-search-param';
import { RefreshOrderingPrompt } from './keyword-strategy/RefreshOrderingPrompt';
import { ContentGaps } from './strategy/ContentGaps';
import { QuickWins } from './strategy/QuickWins';
import { KeywordGaps } from './strategy/KeywordGaps';
import { LowHangingFruit } from './strategy/LowHangingFruit';
import { TopicClusters } from './strategy/TopicClusters';
import { CannibalizationAlert } from './ui/CannibalizationAlert';
import { CannibalizationTriage } from './strategy/CannibalizationTriage';
import { StrategyDiff } from './strategy/StrategyDiff';
import { IntelligenceSignals } from './strategy/IntelligenceSignals';
import { StrategyConfigPanel } from './strategy/StrategyConfigPanel';
import { IssueHeader } from './strategy/issue/IssueHeader';
import { StanceBar } from './strategy/issue/StanceBar';
import { DraftedPovEditor } from './strategy/issue/DraftedPovEditor';
import { BackingMovesQueue } from './strategy/issue/BackingMovesQueue';
import { AddRecommendationModal } from './strategy/issue/AddRecommendationModal';
import { TrustLadderPanel } from './strategy/issue/TrustLadderPanel';
import { ContentWorkOrderLens } from './strategy/issue/ContentWorkOrderLens';
import { IssueSetupReadiness } from './strategy/issue/IssueSetupReadiness';
import { AdminLeadsReadout } from './strategy/issue/AdminLeadsReadout';
import { useConversionTrackingStatus } from '../hooks/admin/useConversionTrackingStatus';
import { useAdminLeads } from '../hooks/admin/useAdminLeads';
import { isThrottledOpen } from './strategy/cockpitRowModel';
import { LocalSeoVisibilityPanel } from './local-seo/LocalSeoVisibilityPanel';
import { LocalSeoMarketSetupDrawer } from './local-seo/LocalSeoMarketSetupDrawer';
import { adminPath } from '../routes';
import {
  useStrategyMetrics,
  useStrategySettings,
  useStrategyGeneration,
  useTrackKeyword,
  useKeywordFeedback,
  StrategyHeaderActions,
  StrategyFeedbackNudge,
  ClientKeywordFeedback,
  StrategySettings,
  StrategyStalenessNudges,
  StrategyEmptyState,
  OrientZone,
  ActQueue,
  StrategyCockpit,
  DecayingPagesCard,
  StrategyRankingsTab,
  StrategyCompetitiveTab,
  SiteTargetKeywords,
  KeywordOpportunities,
  StrategyHowItWorks,
} from './strategy';

// Strategy v2 interior tabs (command-center layout). Overview = Orient + Act + reference;
// Content = the content "money page"; Rankings = position distribution + movements;
// Competitive = share of voice + keyword gaps + backlinks (the "research mode" surface).
// The literal ids appear here so the ?tab= deep-link contract test recognizes this receiver.
// NOTE: tab id 'rankings' is intentionally unchanged so ?tab=rankings deep-links keep working.
// flag-ON renames the label to 'Keywords & Rankings'; flag-OFF keeps 'Rankings'. id never changes.
type StrategyInteriorTab = 'overview' | 'content' | 'rankings' | 'competitive';
const makeStrategyInteriorTabs = (commandCenterEnabled: boolean): { id: StrategyInteriorTab; label: string }[] => [
  { id: 'overview', label: 'Overview' },
  { id: 'content', label: 'Content' },
  { id: 'rankings', label: commandCenterEnabled ? 'Keywords & Rankings' : 'Rankings' },
  { id: 'competitive', label: 'Competitive' },
];
// Stable reference used only for id-lookup (deep-link resolution, tab validation) — labels irrelevant here.
const STRATEGY_INTERIOR_TABS: { id: StrategyInteriorTab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'content', label: 'Content' },
  { id: 'rankings', label: 'Rankings' },
  { id: 'competitive', label: 'Competitive' },
];

interface Props {
  workspaceId: string;
  siteId?: string;
}

export function KeywordStrategyPanel({ workspaceId }: Props) {
  const navigate = useNavigate();
  // Strategy v2 interior tab (?tab= deep-link, two-halves contract — mirrors ContentPipeline).
  const [searchParams, setSearchParams] = useSearchParams();
  const [interiorTab, setInteriorTab] = useState<StrategyInteriorTab>(() =>
    resolveTabSearchParam<StrategyInteriorTab>(searchParams.get('tab'), {
      validValues: STRATEGY_INTERIOR_TABS.map((t) => t.id),
      fallback: 'overview',
    }),
  );
  useEffect(() => {
    const param = searchParams.get('tab');
    if (param && STRATEGY_INTERIOR_TABS.some((t) => t.id === param) && param !== interiorTab) {
      setInteriorTab(param as StrategyInteriorTab);
    }
  }, [searchParams]); // eslint-disable-line react-hooks/exhaustive-deps -- sync interior tab to external ?tab= changes only

  // React Query hook replaces manual data fetching
  const { data: keywordData, isLoading: loading, isAuxLoading, isError: strategyFetchError, refetch: refetchStrategy } = useKeywordStrategy(workspaceId);
  const strategy = keywordData?.strategy || null;
  // A "real" strategy has been generated by the AI pipeline (non-null generatedAt).
  // The server may synthesize a shell { pageMap, generatedAt: null, siteKeywords: [], opportunities: [] }
  // when page_keywords rows exist but no strategy blob — that case must render as "no strategy yet"
  // in this component, while still exposing pageMap via Page Intelligence separately.
  const isRealStrategy = strategy?.generatedAt != null;
  const displayedSeoDataMode = strategy?.seoDataMode;

  // Local ↔ Strategy sync status — present when workspace posture is local or hybrid.
  const localSync = keywordData?.strategy?.strategyUx?.localSync;

  // ── Logic hooks (extracted from this orchestrator in Phase 0) ──
  const settings = useStrategySettings(keywordData, strategy, workspaceId);
  const generation = useStrategyGeneration({
    workspaceId,
    localSync,
    buildStrategyGenerationParams: settings.buildStrategyGenerationParams,
  });
  const tracking = useTrackKeyword(workspaceId);
  const feedback = useKeywordFeedback(workspaceId);
  const metrics = useStrategyMetrics(strategy, feedback.rows, isRealStrategy);
  // Flag gate: flag-ON renders v3 StrategyCockpit; flag-OFF preserves the v2 Act queue exactly.
  // Called unconditionally here (before all early returns) — Rules of Hooks.
  const commandCenterEnabled = useFeatureFlag('strategy-command-center');
  // The Issue (Phase 1) — strict superset of the command-center cockpit. Read UNCONDITIONALLY
  // here (before all early returns — Rules of Hooks). The flag MUST be read on its own line, never
  // on the RHS of `commandCenterEnabled && useFeatureFlag(...)` — short-circuit evaluation would
  // make the hook call conditional (Rules-of-Hooks violation). When ON, the Overview renders a
  // third composed branch (IssueHeader → StanceBar → DraftedPovEditor → BackingMovesQueue →
  // supporting surfaces). flag-OFF keeps the command-center / legacy branches byte-identical:
  // theIssueEnabled gates a NEW branch only; it never alters the existing two.
  const theIssueFlag = useFeatureFlag('strategy-the-issue');
  const theIssueEnabled = commandCenterEnabled && theIssueFlag;
  // P3 Lane D — managed keyword working set. Called unconditionally (Rules of Hooks).
  // M1 — the managed-set UI is part of the v3 command-center redesign, so it must be gated on
  // BOTH flags. Without the `commandCenterEnabled &&` composition the managed UI would leak into
  // the command-center-OFF Overview whenever the child flag is on; gating on both keeps the
  // flag-OFF Overview display-only / byte-identical. enabled is also re-gated inside the hook on
  // workspaceId.
  const managedSetFlag = useFeatureFlag('strategy-keywords-managed-set');
  const managedSetEnabled = commandCenterEnabled && managedSetFlag;
  // P4 Lane C — competitor send. Doubly gated: requires both flags ON (same composition rule as
  // managedSetEnabled above). Called unconditionally (Rules of Hooks).
  const competitorSendFlag = useFeatureFlag('strategy-competitor-send');
  const competitorSendEnabled = commandCenterEnabled && competitorSendFlag;
  // P4 Lane B — local market label + setup drawer. Called unconditionally (Rules of Hooks).
  // flag-ON: passes localMarketLabel + onOpenLocalSeoSetup to StrategyConfigPanel so the
  // collapsed summary shows the active market and the config buttons are reachable.
  // flag-OFF: hook still runs (Rules of Hooks), but localSeoSetupOpen state is never set
  // and LocalSeoMarketSetupDrawer is not rendered (commandCenterEnabled gate below).
  const localSeo = useLocalSeo(workspaceId);
  const [localSeoSetupOpen, setLocalSeoSetupOpen] = useState(false);
  const primaryMarket = localSeo.data?.markets?.find((m) => m.status === 'active');
  const {
    managedKeywordSet,
    addStrategyKeyword,
    removeStrategyKeyword,
    keepStrategyKeyword,
  } = useStrategyKeywordSet(workspaceId, managedSetEnabled);
  // The v2 Act queue reads the unified recommendation set (separately generated from the strategy
  // blob). Read it here too — sharing the React Query cache with ActQueue — to decide whether the
  // queue actually has content yet; if not, the legacy action sections stay as a fallback.
  const { data: recommendationSet } = useAdminRecommendationSet(workspaceId);
  const hasActiveRecommendations = (recommendationSet?.recommendations ?? []).some(
    (r) => r.status !== 'dismissed' && r.status !== 'completed',
  );
  // Strategy v3 — lifecycle actions wired to admin routes; cockpit consumes the full rec set
  // (it has its own lifecycle/category facets + Fix-now pin, so it filters internally).
  const lifecycleActions = useRecommendationLifecycle(workspaceId);
  const cockpitRecs = recommendationSet?.recommendations ?? [];
  // ── The Issue (Phase 1) hooks/state — all called UNCONDITIONALLY (Rules of Hooks). ──
  // The drafted POV. `enabled = theIssueEnabled` so flag-OFF makes ZERO network calls.
  const strategyPov = useStrategyPov(workspaceId, theIssueEnabled);
  // The atomic bulk-send route (the cockpit's existing send spine) — reused for "Send issue".
  const issueBulkSend = useRecBulkMutation(workspaceId);
  // cut→sentence contract: cutting a backing move strikes its POV sentence live.
  const [struckRecIds, setStruckRecIds] = useState<string[]>([]);
  // Blocker 5 staging set — the recs the operator has staged for the ONE client commit (the header
  // "Send issue"). Per-row "Stage for issue" toggles membership; nothing is written to the client
  // until "Send issue" commits this set. useToggleSet (UNBOUNDED) = the shared toggle-set primitive
  // (no hand-rolled has?delete:add). Declared with the other hooks (before any early return).
  const [stagedRecIds, toggleStage, setStagedRecIds] = useToggleSet<string>([], UNBOUNDED_TOGGLE_SET_OPTIONS);
  // Operator steering (§11/§12): wording overrides + client running order + add-a-rec.
  // `enabled = theIssueEnabled` so flag-OFF makes ZERO network calls (byte-identical OFF).
  const operatorSteering = useOperatorSteering(workspaceId, theIssueEnabled);
  const [addRecOpen, setAddRecOpen] = useState(false);
  // ── The Issue (Client) P1b — admin setup-readiness + named-leads (Lane B). Read UNCONDITIONALLY
  // (Rules of Hooks). Gated on the-issue-client-measured-capture; flag-OFF → both hooks no-op (no
  // fetch, no WS subscription) and the panels below are not mounted → byte-identical cockpit. ──
  const measuredCapture = useFeatureFlag('the-issue-client-measured-capture');
  const { status: conversionStatus, isLoading: conversionStatusLoading } =
    useConversionTrackingStatus(workspaceId, measuredCapture);
  // Captured-leads page size — "Load more" widens the limit (capped server-side at 200) so the readout's
  // "Showing X of Y" footer is an affordance, not a dead-end. Unconditional state (Rules of Hooks).
  const LEADS_PAGE = 50;
  const LEADS_MAX = 200;
  const [leadsLimit, setLeadsLimit] = useState(LEADS_PAGE);
  const { leads: capturedLeads, total: capturedLeadsTotal, isLoading: capturedLeadsLoading } =
    useAdminLeads(workspaceId, { limit: leadsLimit }, measuredCapture);
  // The readiness rollup rides the status endpoint (A4). It carries the resolved provenance, segment
  // label, and pre-formatted value line — IssueSetupReadiness reads them straight off `readiness` so the
  // cockpit never reconstructs the Measured/Estimate pill from an all-time count heuristic (which could
  // disagree with the period-scoped client number).
  const setupReadiness = conversionStatus?.readiness ?? null;
  // Content-tab emptiness (v2) — used to render an action-oriented EmptyState rather than a blank
  // tab when no content opportunities exist.
  const { data: contentDecayData } = useContentDecay(workspaceId);

  // Competitor domains as a clean array — consumed by the Competitive tab (StrategyCompetitiveTab)
  // so the CSV/newline parse lives in exactly one place.
  const competitorList = settings.competitors.split(/[,\n]+/).map((c) => c.trim()).filter(Boolean);

  // intentColor is consumed by ContentGaps — kept in the orchestrator and passed down.
  const intentColor = (intent?: string) => {
    switch (intent) {
      case 'commercial': return 'text-accent-info bg-blue-500/10 border-blue-500/20';
      case 'informational': return 'text-accent-success bg-emerald-500/10 border-emerald-500/20';
      case 'transactional': return 'text-accent-warning bg-amber-500/10 border-amber-500/20';
      case 'navigational': return 'text-accent-cyan bg-cyan-500/10 border-cyan-500/20';
      default: return 'text-[var(--brand-text)] bg-zinc-500/10 border-zinc-500/20'; // raw-zinc-ok
    }
  };

  if (loading) {
    return <LoadingState message="Loading keyword strategy..." />;
  }

  if (strategyFetchError) {
    return (
      <ErrorState
        type="general"
        title="Failed to load keyword strategy"
        message="There was a problem loading your keyword strategy. Please try again."
        action={{ label: 'Retry', onClick: () => void refetchStrategy() }}
      />
    );
  }

  if (!workspaceId) {
    return (
      <div className="text-center py-16 text-[var(--brand-text-muted)] t-body">
        No workspace selected. Link a workspace to generate a keyword strategy.
      </div>
    );
  }

  // Header subtitle: artifact freshness once a real strategy exists.
  const headerSubtitle = !isRealStrategy
    ? 'AI-powered keyword mapping for your entire site'
    : `Generated ${formatDate(strategy?.generatedAt)} · ${strategy?.pageMap?.length ?? 0} pages mapped`;

  // ── Shared elements (defined once; the two layouts arrange the same elements differently) ──
  const headerActions = (
    <StrategyHeaderActions
      isRealStrategy={isRealStrategy}
      generating={generation.generating}
      localSyncApplies={!!localSync?.applies}
      localNeedsRefresh={!!localSync?.localNeedsRefresh}
      refreshPending={generation.refresh.isPending}
      onIncremental={() => generation.generateStrategy('incremental')}
      onFullRefresh={() => generation.refresh.mutate({
        thenRegenerateStrategy: true,
        strategyGeneration: settings.buildStrategyGenerationParams(),
      })}
      onGenerate={() => generation.generateStrategy('full')}
    />
  );

  // flag-ON: a `?` icon button in the PageHeader actions area shows StrategyHowItWorks content
  // as a Tooltip (the "About this page" affordance replaces the inline section).
  // flag-OFF: plain PageHeader with no tooltip — byte-identical to today's render.
  const howItWorksTooltipContent = commandCenterEnabled && isRealStrategy ? (
    <StrategyHowItWorks displayedSeoDataMode={displayedSeoDataMode} hasAnyRanking={metrics.hasAnyRanking} />
  ) : null;

  // The Issue branch renders its own IssueHeader ("The Issue") as page chrome — suppress the base
  // "Keyword Strategy" PageHeader so the two don't stack. flag-OFF / command-center-only keep the
  // base header byte-identical. (The StrategyConfigPanel is mounted inside IssueHeader, not here,
  // so suppressing headerEl does not affect the config panel.)
  const headerEl = theIssueEnabled ? null : commandCenterEnabled ? (
    <PageHeader
      title="Keyword Strategy"
      subtitle={headerSubtitle}
      icon={<Icon as={Target} size="lg" className="text-accent-brand" />}
      actions={
        <div className="flex items-center gap-2">
          {howItWorksTooltipContent && (
            <Tooltip content={howItWorksTooltipContent} placement="bottom" contentClassName="max-w-sm">
              <IconButton icon={HelpCircle} label="About this page" variant="ghost" size="sm" />
            </Tooltip>
          )}
          {headerActions}
        </div>
      }
    />
  ) : (
    <PageHeader
      title="Keyword Strategy"
      subtitle={headerSubtitle}
      icon={<Icon as={Target} size="lg" className="text-accent-brand" />}
      actions={headerActions}
    />
  );

  const refreshPromptEl = localSync?.applies && localSync.localNeedsRefresh ? (
    <RefreshOrderingPrompt
      open={generation.refreshOrderingPromptOpen}
      reason={localSync.localNeedsRefreshReason ?? 'stale'}
      lastLocalRefreshAt={localSync.lastLocalRefreshAt}
      onFullRefresh={() => {
        generation.refresh.mutate({
          thenRegenerateStrategy: true,
          strategyGeneration: settings.buildStrategyGenerationParams(),
        });
        generation.setRefreshOrderingPromptOpen(false);
      }}
      onGenerateAnyway={() => {
        generation.setRefreshOrderingPromptOpen(false);
        void generation.runStartJob('full');
      }}
      onCancel={() => generation.setRefreshOrderingPromptOpen(false)}
    />
  ) : null;

  const aiContextEl = !isRealStrategy && !generation.generating
    ? <AIContextIndicator workspaceId={workspaceId} feature="strategy" />
    : null;

  // flag-OFF only: LocalSeoVisibilityPanel (results) rendered outside tabs (today's behaviour,
  // byte-identical). flag-ON (P4 Lane B): Local SEO results de-dup to KeywordHub (mode='keywords')
  // and local market config moves into StrategyConfigPanel — so localSeoEl is null here when ON.
  const localSeoEl = !commandCenterEnabled ? (
    <LocalSeoVisibilityPanel
      workspaceId={workspaceId}
      mode="strategy"
      onOpenKeywords={() => navigate(adminPath(workspaceId, 'seo-keywords'))}
    />
  ) : null;

  const feedbackNudgeEl = metrics.feedbackNewerThanStrategy ? (
    <StrategyFeedbackNudge
      requestedCount={metrics.requestedFeedback.length}
      declinedCount={metrics.declinedFeedback.length}
    />
  ) : null;

  // flag-OFF only: settingsEl rendered outside tabs (today's behaviour, byte-identical).
  // flag-ON: settings are consolidated into StrategyConfigPanel at the bottom of the Overview tab.
  const settingsEl = !commandCenterEnabled ? (
    <StrategySettings
      workspaceId={workspaceId}
      isAuxLoading={isAuxLoading}
      settingsOpen={settings.settingsOpen}
      setSettingsOpen={settings.setSettingsOpen}
      seoDataAvailable={settings.seoDataAvailable}
      seoDataMode={settings.seoDataMode}
      setSeoDataMode={settings.setSeoDataMode}
      maxPages={settings.maxPages}
      setMaxPages={settings.setMaxPages}
      competitors={settings.competitors}
      setCompetitors={settings.setCompetitors}
      businessContext={settings.businessContext}
      setBusinessContext={settings.setBusinessContext}
      contextOpen={settings.contextOpen}
      setContextOpen={settings.setContextOpen}
      discoveringCompetitors={settings.discoveringCompetitors}
      discoverError={settings.discoverError}
      onDiscoverCompetitors={settings.discoverCompetitors}
    />
  ) : null;

  const intelligenceSignalsEl = <IntelligenceSignals workspaceId={workspaceId} />;

  const progressEl = (
    <ProgressIndicator
      status={generation.generating ? 'running' : 'idle'}
      step={generation.activeStrategyJob?.message || (generation.startingStrategyJob ? 'Starting keyword strategy job...' : undefined)}
      percent={generation.activeStrategyJob?.total ? Math.round(((generation.activeStrategyJob.progress ?? 0) / generation.activeStrategyJob.total) * 100) : undefined}
    />
  );

  const errorEl = generation.error ? (
    <ErrorState
      type="general"
      title="Strategy Generation Failed"
      message={generation.error}
      action={{ label: 'Try Again', onClick: () => generation.generateStrategy('full') }}
    />
  ) : null;

  const nextStepsEl = generation.showNextSteps && isRealStrategy && !generation.generating ? (
    <NextStepsCard
      title="Strategy ready"
      variant="success"
      onDismiss={() => generation.setShowNextSteps(false)}
      staggerIndex={0}
      steps={[
        {
          label: 'Review Quick Wins',
          onClick: () => { generation.setShowNextSteps(false); setTimeout(() => document.getElementById('quick-wins-section')?.scrollIntoView({ behavior: 'smooth' }), 150); },
          estimatedTime: '2 min',
        },
      ]}
    />
  ) : null;

  const emptyStateEl = !isRealStrategy && !generation.generating ? <StrategyEmptyState /> : null;

  // P3 Lane D — client-request approve handler: goes through the existing
  // feedback.addRequestedKeyword → KCC ADD_TO_STRATEGY path, then additionally
  // writes to the managed set when managedSetEnabled. Per plan: do NOT create
  // a parallel promotion handler — use the existing KCC path as the primary.
  const handleApproveClientKeyword = (keyword: string) => {
    feedback.addRequestedKeyword(keyword);
    if (managedSetEnabled) {
      addStrategyKeyword(keyword, 'client_request');
    }
  };

  const clientFeedbackCombinedEl = (
    <ClientKeywordFeedback
      rows={feedback.rows}
      requested={metrics.requestedFeedback}
      declined={metrics.declinedFeedback}
      approved={metrics.approvedFeedback}
      addPending={feedback.addPending}
      addError={feedback.addError}
      onAdd={handleApproveClientKeyword}
      onDismissError={() => feedback.setAddError(null)}
    />
  );

  // Real-strategy leaf elements — identical in both layouts; only the grouping/order differs.
  const realLeaves = isRealStrategy && strategy ? {
    stalenessNudges: (
      <StrategyStalenessNudges
        hasVolumeValidation={metrics.hasVolumeValidation}
        localSyncApplies={!!localSync?.applies}
        strategyStaleVsLocal={!!localSync?.strategyStaleVsLocal}
        lastLocalRefreshAt={localSync?.lastLocalRefreshAt}
        lastStrategyGeneratedAt={localSync?.lastStrategyGeneratedAt}
        dismissedRefreshAt={generation.dismissedRefreshAt}
        onDismiss={() => generation.setDismissedRefreshAt(localSync?.lastLocalRefreshAt ?? null)}
        onGenerate={() => generation.generateStrategy('full')}
      />
    ),
    quickWins: (
      <div id="quick-wins-section">
        <QuickWins quickWins={strategy.quickWins ?? []} />
      </div>
    ),
    lhf: <LowHangingFruit pages={metrics.lowHangingFruit} />,
    contentGaps: <ContentGaps contentGaps={strategy.contentGaps || []} workspaceId={workspaceId} intentColor={intentColor} />,
    keywordGaps: (
      <KeywordGaps
        keywordGaps={strategy.keywordGaps || []}
        difficultyColor={kdColor}
        workspaceId={workspaceId}
        navigate={navigate}
      />
    ),
    topicClusters: strategy.topicClusters && strategy.topicClusters.length > 0
      ? <TopicClusters clusters={strategy.topicClusters} workspaceId={workspaceId} />
      : null,
    decayingPages: <DecayingPagesCard workspaceId={workspaceId} />,
    // flag-ON: actionable CannibalizationTriage (send-to-client, mark-resolved, fix-in-editor).
    // flag-OFF: passive CannibalizationAlert — byte-identical to today's render.
    cannibalization: strategy.cannibalization && strategy.cannibalization.length > 0
      ? (commandCenterEnabled
          ? <CannibalizationTriage entries={strategy.cannibalization} workspaceId={workspaceId} />
          : <CannibalizationAlert entries={strategy.cannibalization} />)
      : null,
    strategyDiff: <StrategyDiff workspaceId={workspaceId} />,
    siteKeywords: (
      <SiteTargetKeywords
        workspaceId={workspaceId}
        siteKeywords={strategy.siteKeywords}
        siteKeywordMetrics={strategy.siteKeywordMetrics}
        trackedKeywords={tracking.trackedKeywords}
        trackingPending={tracking.trackingPending}
        trackingErrors={tracking.trackingErrors}
        onTrack={tracking.trackKeyword}
        managedKeywordSet={managedSetEnabled ? managedKeywordSet : undefined}
        managedSetEnabled={managedSetEnabled}
        onAddToSet={managedSetEnabled ? addStrategyKeyword : undefined}
        onRemoveFromSet={managedSetEnabled ? removeStrategyKeyword : undefined}
        onKeepInSet={managedSetEnabled ? keepStrategyKeyword : undefined}
      />
    ),
    opportunities: <KeywordOpportunities opportunities={strategy.opportunities} />,
    howItWorks: <StrategyHowItWorks displayedSeoDataMode={displayedSeoDataMode} hasAnyRanking={metrics.hasAnyRanking} />,
  } : null;

  // Strategy command-center Orient zone (the cutover baseline — always rendered for a real strategy).
  const orientEl = isRealStrategy
    ? <OrientZone orient={strategy?.strategyUx?.orient} />
    : null;
  // Act zone — the unified impact-ranked recommendation queue. It replaces the quick-wins / LHF /
  // keyword-gaps sections ONLY once the recommendation set actually has content. Until then (fresh
  // strategy before regen runs, a pre-engine workspace, or a fetch error) those sections stay as a
  // fallback so no actionable content is hidden behind an empty queue.
  const useActQueue = isRealStrategy && hasActiveRecommendations;
  const actQueueEl = useActQueue ? <ActQueue workspaceId={workspaceId} /> : null;
  // v3 cockpit element — only constructed when the flag is on, reuses the already-fetched rec set.
  const cockpitEl = (commandCenterEnabled && isRealStrategy)
    ? <StrategyCockpit workspaceId={workspaceId} recs={cockpitRecs} actions={lifecycleActions} />
    : null;

  // ── The Issue (Phase 1) overview composition — only built when theIssueEnabled && real strategy. ──
  // The set "Send issue" ships: active, not-yet-sent recs (the operator's curated candidates).
  // Sendable = ACTIVE (server isActiveRec semantics) AND clientStatus not in {sent, approved,
  // declined, discussing}. This mirrors server isActiveRec (struck/completed/dismissed excluded;
  // throttle auto-resurfaces once EXPIRED, so an expired throttle is sendable — reuse the shared
  // isThrottledOpen predicate, not a blanket lifecycle==='throttled' exclusion) PLUS the curated
  // exclusions (isActiveRec already drops sent/approved/declined; 'discussing' is excluded here
  // because a discussing rec is already in front of the client and must not be re-sent).
  const sendableRecIds = cockpitRecs
    .filter(
      (r) =>
        r.lifecycle !== 'struck' &&
        !isThrottledOpen(r) &&
        r.status !== 'completed' &&
        r.status !== 'dismissed' &&
        r.clientStatus !== 'sent' &&
        r.clientStatus !== 'approved' &&
        r.clientStatus !== 'declined' &&
        r.clientStatus !== 'discussing',
    )
    .map((r) => r.id);
  // Blocker 5 staging: a rec is "stageable" iff it is in the staged set AND still sendable. Reconciling
  // against sendableRecIds keeps the set honest if a staged rec was struck/sent/throttled out from
  // under it. Per-row/bulk staging never writes to the client — only "Send issue" commits.
  const sendableSet = new Set(sendableRecIds);
  const stagedSendableIds = [...stagedRecIds].filter((id) => sendableSet.has(id));
  // toggleStage comes from useToggleSet (above). Bulk "Stage N" adds the selection (a set UNION, not
  // a toggle) — the toggle primitive only handles single keys.
  const stageMany = (recIds: string[]) =>
    setStagedRecIds((prev) => new Set([...prev, ...recIds]));
  const handleSendIssue = () => {
    if (stagedSendableIds.length === 0) return;
    // The ONE client commit (Blocker 5): send the staged set, then clear it.
    issueBulkSend.mutate(
      { recIds: stagedSendableIds, action: 'send' },
      { onSuccess: () => setStagedRecIds(new Set()) },
    );
  };
  // Blocker 5 live counter — "N staged · M already with client". N (staged) is the staged-and-still-
  // sendable count; M (already with client) is the curated set via the SHARED isCuratedForClient
  // predicate (recommendation-predicates.ts — the single source the server projection also uses).
  // Both derive from the one cockpitRecs set, so numerator and denominator share a source.
  const stagedCount = stagedSendableIds.length;
  const curatedCount = cockpitRecs.filter(isCuratedForClient).length;
  // POV-staleness signal: the drafted POV is stale when backing moves have diverged from it since it
  // was drafted — either a backing move was CUT (struck this session) or the operator has applied a
  // wording OVERRIDE to a rec (the override exists only because the operator changed the rec after the
  // draft, so the POV's prose may now reference outdated wording). We READ pov.generatedAt only to
  // anchor that a POV exists to be stale; we NEVER reset any draft on generatedAt here — the
  // lost-keystroke guard (reset keyed on generatedAt) lives wholly inside DraftedPovEditor and is
  // untouched. A struck backing move always diverges from a POV drafted before the cut.
  const hasWordingOverride = Object.values(operatorSteering.wording).some(
    (o) => !!o && (!!o.title || !!o.insight),
  );
  const povMayBeStale =
    !!strategyPov.pov &&
    !!strategyPov.pov.generatedAt &&
    (struckRecIds.length > 0 || hasWordingOverride);
  const issueConfigPanelProps = {
    workspaceId,
    isAuxLoading,
    settingsOpen: settings.settingsOpen,
    setSettingsOpen: settings.setSettingsOpen,
    seoDataAvailable: settings.seoDataAvailable,
    seoDataMode: settings.seoDataMode,
    setSeoDataMode: settings.setSeoDataMode,
    maxPages: settings.maxPages,
    setMaxPages: settings.setMaxPages,
    competitors: settings.competitors,
    setCompetitors: settings.setCompetitors,
    businessContext: settings.businessContext,
    setBusinessContext: settings.setBusinessContext,
    contextOpen: settings.contextOpen,
    setContextOpen: settings.setContextOpen,
    discoveringCompetitors: settings.discoveringCompetitors,
    discoverError: settings.discoverError,
    onDiscoverCompetitors: settings.discoverCompetitors,
    providerName: settings.selectedSeoDataProvider === 'dataforseo' ? 'DataForSEO' : settings.selectedSeoDataProvider,
    localMarketLabel: primaryMarket?.label,
    onOpenLocalSeoSetup: () => setLocalSeoSetupOpen(true),
  };
  const issueOverviewEl = (theIssueEnabled && isRealStrategy && strategy) ? (
    // Blocker 4 — the 5-beat SPINE above the fold (IssueHeader [config + the canonical Send-issue
    // button] → StanceBar → DraftedPovEditor → BackingMovesQueue), then everything else collapsed
    // into ONE "Supporting detail" disclosure (closed by default). KeywordTargetsLens is dropped
    // for a single deep-link row; ClientRunningOrder is cut from v1. Empty lenses self-null so a
    // cold workspace shows zero empty SectionCard chrome.
    <div className="space-y-8">
      {/* The Issue (Client) P1b — setup-readiness checklist (Lane B). Slot-0, ABOVE IssueHeader:
          the integrity guard that earns a trustworthy number is the first config chrome the operator
          sees. Flag-gated on measured-capture; renders NOTHING when OFF → byte-identical cockpit. */}
      {measuredCapture && setupReadiness && (
        <IssueSetupReadiness
          workspaceId={workspaceId}
          readiness={setupReadiness}
          status={conversionStatus}
          loading={conversionStatusLoading}
        />
      )}
      <IssueHeader
        subtitle={headerSubtitle}
        onSendIssue={handleSendIssue}
        isSending={issueBulkSend.isPending}
        canSend={stagedCount > 0}
        configPanelProps={issueConfigPanelProps}
        stagedCount={stagedCount}
        curatedCount={curatedCount}
        regenerateActions={headerActions}
      />
      <StanceBar recs={cockpitRecs} />
      <DraftedPovEditor
        pov={strategyPov.pov}
        onEdit={strategyPov.edit}
        struckRecIds={struckRecIds}
        onRegenerate={strategyPov.regenerate}
        isGenerating={strategyPov.isGenerating}
      />
      {/* POV-staleness nudge — directly under the editor. Shows when cut/edited backing moves have
          diverged from the drafted POV (anchored on pov.generatedAt; never resets on it). Reuses the
          existing regenerate action. */}
      {povMayBeStale && (
        <div className="flex items-center justify-between gap-3 rounded-[var(--radius-lg)] border border-amber-500/30 bg-amber-500/5 px-4 py-3">
          <span className="flex items-center gap-2 t-caption-sm text-amber-400">
            <Icon as={AlertTriangle} size="sm" className="text-amber-400 shrink-0" />
            Point of view may be out of date — regenerate?
          </span>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => strategyPov.regenerate()}
            loading={strategyPov.isGenerating}
            disabled={strategyPov.isGenerating}
          >
            Regenerate
          </Button>
        </div>
      )}
      {/* Operator steering §12 — add a rec the system missed (mints into the curation queue). */}
      <div className="flex justify-end">
        <Button
          variant="secondary"
          icon={Plus}
          onClick={() => setAddRecOpen(true)}
          disabled={operatorSteering.isPending}
        >
          Add a recommendation
        </Button>
      </div>
      <BackingMovesQueue
        workspaceId={workspaceId}
        recs={cockpitRecs}
        actions={lifecycleActions}
        onCut={(id) => setStruckRecIds((s) => [...s, id])}
        shortlistCap={5}
        onEditWording={operatorSteering.editWording}
        stagedCount={stagedCount}
        curatedCount={curatedCount}
        stagedRecIds={stagedRecIds}
        onStage={toggleStage}
        onStageMany={stageMany}
      />
      {/* ── Supporting detail — collapsed by default. Everything that is NOT the 5-beat spine lives
          here so the cockpit opens to the decision, not a wall. ── */}
      <details className="group rounded-[var(--radius-lg)] border border-[var(--brand-border)] bg-[var(--surface-2)]">
        <summary className="flex cursor-pointer items-center justify-between gap-3 px-4 py-3 t-ui font-medium text-[var(--brand-text)] select-none">
          <span>Supporting detail</span>
          <Icon
            as={ArrowRight}
            size="sm"
            className="text-[var(--brand-text-muted)] transition-transform group-open:rotate-90"
          />
        </summary>
        <div className="space-y-6 border-t border-[var(--brand-border)] px-4 py-4">
          {/* The Issue (Client) P1b — the operator's captured named-leads (Lane B). Progressive
              disclosure — lives inside the collapsed "Supporting detail" so the cold cockpit stays
              decision-first. Flag-gated; absent when OFF → byte-identical. */}
          {measuredCapture && (
            <AdminLeadsReadout
              leads={capturedLeads}
              total={capturedLeadsTotal}
              loading={capturedLeadsLoading}
              onConnectCta={() => navigate(adminPath(workspaceId, 'workspace-settings') + '?tab=dashboard')}
              onLoadMore={leadsLimit < LEADS_MAX ? () => setLeadsLimit((l) => Math.min(l + LEADS_PAGE, LEADS_MAX)) : undefined}
            />
          )}
          {/* KeywordTargetsLens dropped — one deep-link row into the Keyword Hub instead. */}
          <ClickableRow
            onClick={() => navigate(adminPath(workspaceId, 'seo-keywords'))}
            className="flex items-center gap-3 px-3 py-2.5 rounded-[var(--radius-lg)] bg-[var(--surface-3)]/40 border border-[var(--brand-border)]/60"
          >
            <div className="w-8 h-8 rounded-[var(--radius-lg)] bg-[var(--surface-3)] flex items-center justify-center flex-shrink-0">
              <Icon as={Search} size="md" className="text-accent-brand" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="t-ui font-medium text-[var(--brand-text-bright)]">Curated keyword targets</div>
              <div className="t-caption-sm text-[var(--brand-text-muted)] truncate">
                Open the curated keyword &amp; topic targets in the Keyword Hub
              </div>
            </div>
            <Icon as={ArrowRight} size="sm" className="text-[var(--brand-text-muted)] flex-shrink-0" />
          </ClickableRow>
          {/* Read-projection lenses + supporting surfaces (each self-nulls when empty). */}
          <ContentWorkOrderLens workspaceId={workspaceId} theIssueEnabled={theIssueEnabled} />
          <TrustLadderPanel workspaceId={workspaceId} theIssueEnabled={theIssueEnabled} />
          {orientEl}
          {/* Content gaps — restored here so the SERP-feature / AI-Overview chips (rendered by the
              shared ContentGapRow) are reachable to the admin in "The Issue" layout. They sit in the
              collapsed supporting detail (decision-first spine stays untouched); ContentGaps self-nulls
              when empty so a cold cockpit shows no chrome. */}
          {realLeaves?.contentGaps}
          {realLeaves?.cannibalization}
          {realLeaves?.strategyDiff}
          <div className="flex justify-end">
            <Button variant="link" onClick={() => navigate(adminPath(workspaceId, 'competitors'))}>
              Competitor intelligence →
            </Button>
          </div>
        </div>
      </details>
      <AddRecommendationModal
        open={addRecOpen}
        onClose={() => setAddRecOpen(false)}
        onCreate={(payload) => {
          operatorSteering.addManualRec(payload);
          setAddRecOpen(false);
        }}
        isPending={operatorSteering.isPending}
      />
    </div>
  ) : null;

  const handleInteriorTabChange = (id: string) => {
    setInteriorTab(id as StrategyInteriorTab);
    const next = clearTabSearchParam(searchParams);
    if (next) setSearchParams(next, { replace: true });
  };

  // Content-tab presence — drives the EmptyState when nothing is actionable (a common early state).
  const hasContentGaps = (strategy?.contentGaps?.length ?? 0) > 0;
  const hasTopicClusters = (strategy?.topicClusters?.length ?? 0) > 0;
  const hasDecayingPages = (contentDecayData?.decayingPages?.length ?? 0) > 0;
  const hasContentTabContent = hasContentGaps || hasTopicClusters || hasDecayingPages;

  // flag-ON: tab labels rendered with 'Keywords & Rankings'; flag-OFF: 'Rankings'.
  // Tab ids are always from the stable STRATEGY_INTERIOR_TABS constant so deep-link resolution is unaffected.
  const displayedTabs = makeStrategyInteriorTabs(commandCenterEnabled);

  // ── Strategy command-center layout (the baseline): page chrome + interior tabs (Overview / Content) ──
  const strategyLayout = (
    <div className="space-y-8">
      {headerEl}
      {refreshPromptEl}
      {aiContextEl}
      {localSeoEl}
      {progressEl}
      {errorEl}
      {nextStepsEl}
      {/* flag-OFF: clientFeedbackCombinedEl rendered unconditionally above tabs (today's behaviour, byte-identical).
          flag-ON: clientFeedbackCombinedEl moves INTO the Keywords & Rankings tab — not rendered here. */}
      {!commandCenterEnabled && clientFeedbackCombinedEl}
      {settingsEl}
      {emptyStateEl}
      {realLeaves && (
        <>
          <TabBar tabs={displayedTabs} active={interiorTab} onChange={handleInteriorTabChange} />
          {interiorTab === 'overview' && (
            theIssueEnabled ? (
              // ── The Issue (Phase 1): a THIRD composed branch (strict superset of command-center).
              // Built above as issueOverviewEl. Leaves the existing flag-ON / flag-OFF branches
              // untouched — this branch only ADDS the issue cockpit, byte-identical OFF. ──
              issueOverviewEl
            ) : commandCenterEnabled ? (
              // ── flag-ON: decision-pipeline IA (graft 3) ──
              // Order: nudges → Orient → What Changed (promoted) → cockpit → cannibalization → StrategyConfigPanel.
              // "Reference & Analysis" divider deleted entirely (psychological off-ramp removed).
              // CannibalizationTriage used (actionable) instead of passive CannibalizationAlert.
              // SiteTargetKeywords + KeywordOpportunities + clientFeedback moved to the "Keywords & Rankings"
              // tab (P2 Lane A). IntelligenceSignals removed (P4 Lane A folds signals into cockpit recs).
              // StrategyHowItWorks demoted to ? tooltip in PageHeader; NOT rendered inline here.
              // StrategyConfigPanel replaces the outside-tabs settingsEl + localSeoEl (P4 Lane B).
              <div className="space-y-8">
                {feedbackNudgeEl}
                {realLeaves.stalenessNudges}
                {orientEl}
                {realLeaves.strategyDiff}
                {cockpitEl ?? (
                  <>
                    {realLeaves.quickWins}
                    {realLeaves.lhf}
                    {realLeaves.keywordGaps}
                  </>
                )}
                {realLeaves.cannibalization}
                <StrategyConfigPanel
                  workspaceId={workspaceId}
                  isAuxLoading={isAuxLoading}
                  settingsOpen={settings.settingsOpen}
                  setSettingsOpen={settings.setSettingsOpen}
                  seoDataAvailable={settings.seoDataAvailable}
                  seoDataMode={settings.seoDataMode}
                  setSeoDataMode={settings.setSeoDataMode}
                  maxPages={settings.maxPages}
                  setMaxPages={settings.setMaxPages}
                  competitors={settings.competitors}
                  setCompetitors={settings.setCompetitors}
                  businessContext={settings.businessContext}
                  setBusinessContext={settings.setBusinessContext}
                  contextOpen={settings.contextOpen}
                  setContextOpen={settings.setContextOpen}
                  discoveringCompetitors={settings.discoveringCompetitors}
                  discoverError={settings.discoverError}
                  onDiscoverCompetitors={settings.discoverCompetitors}
                  providerName={settings.selectedSeoDataProvider === 'dataforseo' ? 'DataForSEO' : settings.selectedSeoDataProvider}
                  localMarketLabel={primaryMarket?.label}
                  onOpenLocalSeoSetup={() => setLocalSeoSetupOpen(true)}
                />
              </div>
            ) : (
              // ── flag-OFF: today's render order — byte-identical ──
              <div className="space-y-8">
                {feedbackNudgeEl}
                {realLeaves.stalenessNudges}
                {orientEl}
                {actQueueEl ?? (
                  <>
                    {realLeaves.quickWins}
                    {realLeaves.lhf}
                    {realLeaves.keywordGaps}
                  </>
                )}
                {/* ── Reference & Analysis ── */}
                <div className="border-t border-[var(--brand-border)] my-6 flex items-center gap-3">
                  <span className="t-caption text-[var(--brand-text-muted)] uppercase tracking-wide">Reference & Analysis</span>
                  <div className="flex-1 border-t border-[var(--brand-border)]" />
                </div>
                {realLeaves.cannibalization}
                {realLeaves.strategyDiff}
                {realLeaves.siteKeywords}
                {realLeaves.opportunities}
                {intelligenceSignalsEl}
                {realLeaves.howItWorks}
              </div>
            )
          )}
          {interiorTab === 'content' && (
            <div className="space-y-8">
              {hasContentTabContent ? (
                <>
                  <p className="t-caption text-[var(--brand-text-muted)]">Reference view — actionable content items also surface in the Act queue on Overview.</p>
                  {commandCenterEnabled ? (
                    // flag-ON: maxVisible={5} caps both scannable leaves.
                    <>
                      <ContentGaps contentGaps={strategy?.contentGaps || []} workspaceId={workspaceId} intentColor={intentColor} maxVisible={5} />
                      {strategy?.topicClusters && strategy.topicClusters.length > 0 && (
                        <TopicClusters clusters={strategy.topicClusters} workspaceId={workspaceId} maxVisible={5} />
                      )}
                      {realLeaves.decayingPages}
                    </>
                  ) : (
                    // flag-OFF: byte-identical to today
                    <>
                      {realLeaves.contentGaps}
                      {realLeaves.topicClusters}
                      {realLeaves.decayingPages}
                    </>
                  )}
                </>
              ) : (
                <EmptyState
                  icon={FileText}
                  title="No content opportunities yet"
                  description="Generate or refresh your strategy to surface content gaps, topic-cluster gaps, and decaying pages to act on."
                />
              )}
            </div>
          )}
          {interiorTab === 'rankings' && (
            commandCenterEnabled && isRealStrategy && strategy ? (
              // flag-ON: "Keywords & Rankings" tab — Hub deep-link at top, then keyword surfaces,
              // then existing distribution/movements content from StrategyRankingsTab.
              <StrategyRankingsTab
                metrics={metrics}
                workspaceId={workspaceId}
                navigate={navigate}
                keywordSurfaces={{
                  siteKeywords: (
                    <SiteTargetKeywords
                      workspaceId={workspaceId}
                      siteKeywords={strategy.siteKeywords ?? []}
                      siteKeywordMetrics={strategy.siteKeywordMetrics}
                      trackedKeywords={tracking.trackedKeywords}
                      trackingPending={tracking.trackingPending}
                      trackingErrors={tracking.trackingErrors}
                      onTrack={tracking.trackKeyword}
                      maxVisible={5}
                      managedKeywordSet={managedSetEnabled ? managedKeywordSet : undefined}
                      managedSetEnabled={managedSetEnabled}
                      onAddToSet={managedSetEnabled ? addStrategyKeyword : undefined}
                      onRemoveFromSet={managedSetEnabled ? removeStrategyKeyword : undefined}
                      onKeepInSet={managedSetEnabled ? keepStrategyKeyword : undefined}
                    />
                  ),
                  opportunities: (
                    <KeywordOpportunities
                      opportunities={strategy.opportunities ?? []}
                      maxVisible={5}
                      // C3 — the v3 send spine: passing enableSend + workspaceId + navigate is what
                      // makes the "Interested?"→send path AND the onAddToStrategySet seam reachable.
                      // Without these props showSend stays false and the whole send affordance is dead
                      // code. Gated on commandCenterEnabled (v3-redesign feature); the flag-OFF Overview
                      // mount keeps enableSend off so it stays byte-identical.
                      enableSend={commandCenterEnabled}
                      workspaceId={workspaceId}
                      navigate={navigate}
                      onAddToStrategySet={managedSetEnabled
                        ? (kw: string) => addStrategyKeyword(kw, 'manual_add')
                        : undefined}
                    />
                  ),
                  clientFeedback: clientFeedbackCombinedEl,
                }}
              />
            ) : (
              // flag-OFF: today's Rankings tab, byte-identical.
              <StrategyRankingsTab metrics={metrics} workspaceId={workspaceId} navigate={navigate} />
            )
          )}
          {interiorTab === 'competitive' && (
            <StrategyCompetitiveTab
              workspaceId={workspaceId}
              competitors={competitorList}
              seoDataAvailable={settings.seoDataAvailable}
              keywordGaps={strategy?.keywordGaps || []}
              navigate={navigate}
              commandCenterEnabled={commandCenterEnabled}
              competitorSendEnabled={competitorSendEnabled}
            />
          )}
        </>
      )}
      {/* P4 Lane B — local market setup drawer, only mounted when flag is ON and data is available.
          Controlled by localSeoSetupOpen; opened via onOpenLocalSeoSetup passed to StrategyConfigPanel. */}
      {commandCenterEnabled && localSeo.data && (
        <LocalSeoMarketSetupDrawer
          workspaceId={workspaceId}
          data={localSeo.data}
          open={localSeoSetupOpen}
          onClose={() => setLocalSeoSetupOpen(false)}
        />
      )}
    </div>
  );

  // Command-center layout is the baseline (v2 cutover) — interior ?tab= tabs, no Analysis/Guide TabBar.
  return strategyLayout;
}
