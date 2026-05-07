import type { IntelligenceOptions, LearningsSlice, ROIAttribution, WeCalledItEntry } from '../../shared/types/intelligence.js';
import type { ActionOutcome, TopWin } from '../../shared/types/outcome-tracking.js';
import { createLogger } from '../logger.js';
import { isFeatureEnabled } from '../feature-flags.js';
import { isProgrammingError } from '../errors.js';

const log = createLogger('workspace-intelligence/learnings');

export async function assembleLearnings(
  workspaceId: string,
  opts?: IntelligenceOptions,
): Promise<LearningsSlice> {
  // Only assemble if feature flag is enabled
  if (!isFeatureEnabled('outcome-ai-injection')) {
    return {
      summary: null,
      confidence: null,
      topActionTypes: [],
      overallWinRate: 0,
      recentTrend: null,
      playbooks: [],
    };
  }

  let summary: ReturnType<Awaited<typeof import('../workspace-learnings.js')>['getWorkspaceLearnings']> | undefined;
  let playbooks: ReturnType<Awaited<typeof import('../outcome-playbooks.js')>['getPlaybooks']> = [];
  try {
    const { getWorkspaceLearnings } = await import('../workspace-learnings.js'); // dynamic-import-ok - intelligence slices lazy-load optional subsystems for graceful degradation
    const { getPlaybooks } = await import('../outcome-playbooks.js'); // dynamic-import-ok - intelligence slices lazy-load optional subsystems for graceful degradation
    summary = getWorkspaceLearnings(workspaceId, opts?.learningsDomain ?? 'all');
    playbooks = getPlaybooks(workspaceId);
  } catch (err) {
    log.warn({ err, workspaceId }, 'assembleLearnings: core data load failed, degrading to empty learnings');
  }

  // ROI attribution enrichment
  let roiAttribution: ROIAttribution[] = [];
  try {
    const { getROIAttributionsRaw } = await import('../roi-attribution.js'); // dynamic-import-ok - intelligence slices lazy-load optional subsystems for graceful degradation
    const rows = getROIAttributionsRaw(workspaceId, 10);
    roiAttribution = rows.map(h => ({
      actionId: h.id,
      pageUrl: h.pageUrl,
      actionType: h.actionType,
      clicksBefore: h.clicksBefore,
      clicksAfter: h.clicksAfter,
      clickGain: h.clickGain,
      measuredAt: h.measuredAt,
    }));
  } catch (err) {
    log.debug({ err, workspaceId }, 'assembleLearnings: ROI attribution optional, degrading gracefully');
  }

  // WeCalledIt entries — actions with strong_win outcomes
  let weCalledIt: WeCalledItEntry[] = [];
  let topWins: TopWin[] = [];
  try {
    const { getActionsByWorkspace, getOutcomesForAction, getTopWinsFromActions } = await import('../outcome-tracking.js'); // dynamic-import-ok - intelligence slices lazy-load optional subsystems for graceful degradation
    const actions = getActionsByWorkspace(workspaceId);
    // Lazy-caching outcomes accessor: fetches on first access, caches the result.
    // Shared between getTopWinsFromActions and the weCalledIt loop so each action's
    // outcomes are queried at most once, while preserving both loops' early-exit behaviour.
    const outcomesCache = new Map<string, ActionOutcome[]>();
    const cachedGetOutcomes = (actionId: string): ActionOutcome[] => {
      if (!outcomesCache.has(actionId)) {
        outcomesCache.set(actionId, getOutcomesForAction(actionId));
      }
      return outcomesCache.get(actionId)!;
    };
    topWins = getTopWinsFromActions(actions, 5, cachedGetOutcomes);
    for (const action of actions.slice(0, 50)) {
      if (weCalledIt.length >= 5) break;
      const outcomes = cachedGetOutcomes(action.id);
      const strongWin = outcomes.find(o => o.score === 'strong_win');
      if (strongWin) {
        weCalledIt.push({
          actionId: action.id,
          prediction: `${action.actionType} on ${action.pageUrl ?? 'site'}`,
          outcome: 'strong_win',
          score: 'strong_win',
          pageUrl: action.pageUrl ?? '',
          measuredAt: strongWin.measuredAt ?? '',
        });
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

  return {
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
    scoringConfig,
  };
}
