import type {
  ClientSafeLearningsProjection,
  IntelligenceOptions,
  LearningsSlice,
  ROIAttribution,
  WeCalledItEntry,
} from '../../shared/types/intelligence.js';
import type {
  ActionOutcome,
  TopWin,
  TrackedAction,
  WorkspaceLearnings,
} from '../../shared/types/outcome-tracking.js';
import { isClientVisibleOutcomeAction } from '../../shared/types/action-catalog.js';
import { createLogger } from '../logger.js';
import { isProgrammingError } from '../errors.js';

const log = createLogger('workspace-intelligence/learnings');

const ACTION_PHRASES: Record<string, string> = {
  insight_acted_on: 'insight follow-up',
  content_published: 'content publication',
  brief_created: 'brief creation',
  strategy_keyword_added: 'strategy keyword addition',
  schema_deployed: 'schema deployment',
  audit_fix_applied: 'audit fix',
  content_refreshed: 'content refresh',
  internal_link_added: 'internal link addition',
  meta_updated: 'metadata update',
  voice_calibrated: 'voice calibration',
  competitor_gap_closed: 'competitor gap closure',
  cluster_published: 'topic cluster publication',
  cannibalization_resolved: 'cannibalization fix',
  local_visibility_won: 'local visibility win',
  local_service_added: 'local service addition',
};

const METRIC_LABELS: Record<string, string> = {
  clicks: 'Clicks',
  impressions: 'Impressions',
  sessions: 'Sessions',
  conversions: 'Conversions',
  ctr: 'CTR',
  position: 'Position',
  page_health_score: 'Page health score',
  voice_score: 'Voice score',
};

function humanizeUnderscore(value: string): string {
  return value.replace(/_/g, ' ');
}

function formatActionPhrase(actionType: string): string {
  return ACTION_PHRASES[actionType] ?? humanizeUnderscore(actionType);
}

function formatMetricLabel(metric: string | undefined): string {
  if (!metric) return 'Primary metric';
  return METRIC_LABELS[metric] ?? humanizeUnderscore(metric).replace(/\b\w/g, char => char.toUpperCase());
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 }).format(value);
}

function formatScoreLabel(score: string | null): string {
  if (!score) return 'strong win';
  return humanizeUnderscore(score);
}

function formatOutcomeNarrative(actionType: string, outcome: ActionOutcome): string {
  const delta = outcome.deltaSummary;
  if (
    delta
    && Number.isFinite(delta.baseline_value)
    && Number.isFinite(delta.current_value)
  ) {
    const direction = delta.direction === 'declined'
      ? 'declined'
      : delta.direction === 'stable'
        ? 'held steady'
        : 'improved';
    const percent = Number.isFinite(delta.delta_percent)
      ? ` (${delta.direction === 'declined' ? '-' : delta.direction === 'improved' ? '+' : ''}${formatNumber(Math.abs(delta.delta_percent))}%)`
      : '';
    return `${formatMetricLabel(delta.primary_metric)} ${direction} from ${formatNumber(delta.baseline_value)} to ${formatNumber(delta.current_value)}${percent}.`;
  }

  return `${formatActionPhrase(actionType)} was recorded as a ${formatScoreLabel(outcome.score)}.`;
}

function buildOutcomeNarrativeSurfaces(
  actions: TrackedAction[],
  getOutcomes: (actionId: string) => ActionOutcome[],
): { roiAttribution: ROIAttribution[]; weCalledIt: WeCalledItEntry[] } {
  const roiAttribution: ROIAttribution[] = [];
  const weCalledIt: WeCalledItEntry[] = [];

  // Build ROI attribution from live outcome data (replaces the dead
  // roi_attributions read). Cap matches the former store contract.
  for (const action of actions.slice(0, 50)) {
    if (roiAttribution.length >= 10) break;
    const outcomes = getOutcomes(action.id);
    const winOutcome = outcomes
      .filter(o => o.score === 'strong_win' || o.score === 'win')
      .sort((a, b) => b.checkpointDays - a.checkpointDays)[0];
    if (winOutcome) {
      const clicksBefore = action.baselineSnapshot.clicks ?? 0;
      const clicksAfter = winOutcome.metricsSnapshot.clicks ?? 0;
      roiAttribution.push({
        actionId: action.id,
        pageUrl: action.pageUrl ?? '',
        actionType: action.actionType,
        clicksBefore,
        clicksAfter,
        clickGain: clicksAfter - clicksBefore,
        measuredAt: winOutcome.measuredAt ?? '',
      });
    }
  }

  for (const action of actions.slice(0, 50)) {
    if (weCalledIt.length >= 5) break;
    const strongWin = getOutcomes(action.id).find(o => o.score === 'strong_win');
    if (strongWin) {
      weCalledIt.push({
        actionId: action.id,
        prediction: `${formatActionPhrase(action.actionType)} on ${action.pageUrl ?? 'site'}`,
        outcome: formatOutcomeNarrative(action.actionType, strongWin),
        score: 'strong_win',
        pageUrl: action.pageUrl ?? '',
        measuredAt: strongWin.measuredAt ?? '',
      });
    }
  }

  return { roiAttribution, weCalledIt };
}

export async function assembleLearnings(
  workspaceId: string,
  opts?: IntelligenceOptions,
): Promise<LearningsSlice> {
  let summary: ReturnType<Awaited<typeof import('../workspace-learnings.js')>['getWorkspaceLearnings']> | undefined;
  let playbooks: ReturnType<Awaited<typeof import('../outcome-playbooks.js')>['getPlaybooks']> = [];
  let availability: LearningsSlice['availability'] = 'no_data';

  // A1: administrative kill-switch. When learnings are disabled for this workspace,
  // short-circuit to availability:'disabled' so consumers degrade to general best
  // practices (per the LearningsSlice.availability contract) — skipping all
  // summary/outcome/playbook reads.
  try {
    const { isLearningsDisabled } = await import('../workspace-learnings.js'); // dynamic-import-ok - intelligence slices lazy-load optional subsystems for graceful degradation
    if (isLearningsDisabled(workspaceId)) {
      return {
        availability: 'disabled',
        summary: null,
        confidence: null,
        topActionTypes: [],
        overallWinRate: 0,
        recentTrend: null,
        playbooks: [],
        roiAttribution: [],
        topWins: [],
        weCalledIt: [],
        winRateByActionType: {},
        scoringConfig: undefined,
        clientProjection: null,
      };
    }
  } catch (err) {
    log.debug({ err, workspaceId }, 'assembleLearnings: disable-switch read failed, continuing');
  }

  try {
    const { getWorkspaceLearnings } = await import('../workspace-learnings.js'); // dynamic-import-ok - intelligence slices lazy-load optional subsystems for graceful degradation
    summary = getWorkspaceLearnings(workspaceId, opts?.learningsDomain ?? 'all');
    availability = summary ? 'ready' : 'no_data';
  } catch (err) {
    availability = 'degraded';
    log.warn({ err, workspaceId }, 'assembleLearnings: core data load failed, degrading to empty learnings');
  }

  try {
    const { getPlaybooks } = await import('../outcome-playbooks.js'); // dynamic-import-ok - intelligence slices lazy-load optional subsystems for graceful degradation
    playbooks = getPlaybooks(workspaceId);
  } catch (err) {
    log.debug({ err, workspaceId }, 'assembleLearnings: playbooks optional, degrading gracefully');
  }

  // ROI attribution, WeCalledIt entries, and top wins — all from the live action_outcomes table.
  // roi_attributions (dead table, zero writers) is no longer consulted (Task 2.3).
  let roiAttribution: ROIAttribution[] = [];
  let weCalledIt: WeCalledItEntry[] = [];
  let topWins: TopWin[] = [];
  let clientSummary: WorkspaceLearnings | null = null;
  let clientRoiAttribution: ROIAttribution[] = [];
  let clientWeCalledIt: WeCalledItEntry[] = [];
  let clientTopWins: TopWin[] = [];
  try {
    const { getActionsByWorkspace, getOutcomesForAction, getTopWinsFromActions } = await import('../outcome-tracking.js'); // dynamic-import-ok - intelligence slices lazy-load optional subsystems for graceful degradation
    // A1: exclude `not_acted_on` actions before building ANY win surface. These are
    // suggestions the workspace never executed — their outcomes are not our wins.
    // getTopWinsFromActions filters internally too, but roiAttribution/weCalledIt loop
    // over this list directly, so filter once here for all three surfaces.
    const actions = getActionsByWorkspace(workspaceId).filter(a => a.attribution !== 'not_acted_on');
    // Lazy-caching outcomes accessor: fetches on first access, caches the result.
    // Shared between getTopWinsFromActions, roiAttribution, and the weCalledIt loop so
    // each action's outcomes are queried at most once.
    const outcomesCache = new Map<string, ActionOutcome[]>();
    const cachedGetOutcomes = (actionId: string): ActionOutcome[] => {
      if (!outcomesCache.has(actionId)) {
        outcomesCache.set(actionId, getOutcomesForAction(actionId));
      }
      return outcomesCache.get(actionId)!;
    };
    topWins = getTopWinsFromActions(actions, 5, cachedGetOutcomes);
    ({ roiAttribution, weCalledIt } = buildOutcomeNarrativeSurfaces(actions, cachedGetOutcomes));

    // Public/client consumers receive a separately-derived projection. Filter
    // before every cap so hidden workflow rows cannot displace legitimate client
    // outcomes, while the normal/admin slice above remains unchanged.
    const clientActions = actions.filter(action => isClientVisibleOutcomeAction(action.actionType));
    clientTopWins = getTopWinsFromActions(clientActions, 5, cachedGetOutcomes);
    ({
      roiAttribution: clientRoiAttribution,
      weCalledIt: clientWeCalledIt,
    } = buildOutcomeNarrativeSurfaces(clientActions, cachedGetOutcomes));

    const clientScored = clientActions.flatMap(action => {
      const validOutcomes = cachedGetOutcomes(action.id).filter(outcome => (
        (outcome.checkpointDays === 30 || outcome.checkpointDays === 60 || outcome.checkpointDays === 90)
        && outcome.score != null
        && outcome.score !== 'insufficient_data'
        && outcome.score !== 'inconclusive'
      ));
      const outcome = validOutcomes[validOutcomes.length - 1];
      return outcome ? [{ action, outcome }] : [];
    });
    if (clientScored.length > 0) {
      try {
        const { computeWorkspaceLearningsFromScored } = await import('../workspace-learnings.js'); // dynamic-import-ok - client projection reuses canonical learnings math without creating a facade cycle
        clientSummary = computeWorkspaceLearningsFromScored(workspaceId, clientScored);
      } catch (err) {
        // Client projection failure must fail closed without erasing the intact
        // admin outcome surfaces assembled above.
        log.warn({ err, workspaceId }, 'assembleLearnings: client projection unavailable');
      }
    }
  } catch (err) {
    if (isProgrammingError(err)) {
      log.warn({ err, workspaceId }, 'assembleLearnings: programming error in outcome-tracking — check export names');
    } else {
      log.debug({ err, workspaceId }, 'assembleLearnings: outcome data optional, degrading gracefully');
    }
  }

  let scoringConfig: LearningsSlice['scoringConfig'];
  try {
    const { getWorkspace } = await import('../workspaces.js'); // dynamic-import-ok - intelligence slices lazy-load optional subsystems for graceful degradation
    const ws = getWorkspace(workspaceId);
    scoringConfig = ws?.scoringConfig ?? undefined;
  } catch (err) {
    log.debug({ err, workspaceId }, 'assembleLearnings: scoringConfig optional, degrading gracefully');
  }

  const clientProjection: ClientSafeLearningsProjection | null = clientSummary
    ? {
        availability: 'ready',
        summary: clientSummary,
        confidence: clientSummary.confidence,
        topActionTypes: clientSummary.overall.topActionTypes.slice(0, 5),
        overallWinRate: clientSummary.overall.totalWinRate,
        recentTrend: clientSummary.overall.recentTrend,
        playbooks: playbooks.filter(playbook => (
          playbook.actionSequence.every(step => isClientVisibleOutcomeAction(step.actionType))
        )),
        topWins: clientTopWins,
        winRateByActionType: Object.fromEntries(
          clientSummary.overall.topActionTypes.map(entry => [entry.type, entry.winRate]),
        ),
        roiAttribution: clientRoiAttribution,
        weCalledIt: clientWeCalledIt,
        scoringConfig: scoringConfig
          ? Object.fromEntries(
              Object.entries(scoringConfig).filter(([actionType]) => (
                isClientVisibleOutcomeAction(actionType)
              )),
            )
          : undefined,
      }
    : null;

  // A6 (audit #22): cross-workspace platform priors as the FALLBACK tier. Only populated
  // when this workspace's OWN availability is no_data/degraded — `ready` keeps its own
  // learnings (availability stays authoritative) and `disabled` suppresses priors too.
  // These are anonymized aggregates (no workspace ids/titles/urls); the assembler reads
  // them as a labeled benchmark, never as this workspace's own results.
  let platformPriors: LearningsSlice['platformPriors'];
  if (availability === 'no_data' || availability === 'degraded') {
    try {
      const { getPlatformPriors } = await import('../platform-learnings-priors.js'); // dynamic-import-ok - intelligence slices lazy-load optional subsystems for graceful degradation
      const priors = getPlatformPriors();
      if (priors.length > 0) platformPriors = priors;
    } catch (err) {
      log.debug({ err, workspaceId }, 'assembleLearnings: platform priors optional, degrading gracefully');
    }
  }

  return {
    availability,
    summary: summary ?? null,
    confidence: summary?.confidence ?? null,
    topActionTypes: summary?.overall.topActionTypes.slice(0, 5) ?? [],
    overallWinRate: summary?.overall.totalWinRate ?? 0,
    recentTrend: summary?.overall.recentTrend ?? null,
    playbooks,
    roiAttribution,
    topWins,
    weCalledIt,
    winRateByActionType: Object.fromEntries(
      (summary?.overall.topActionTypes ?? []).map(t => [t.type, t.winRate]),
    ),
    platformPriors,
    scoringConfig,
    clientProjection,
  };
}
