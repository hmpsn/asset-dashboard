import type { IntelligenceOptions, LearningsSlice, ROIAttribution, WeCalledItEntry } from '../../shared/types/intelligence.js';
import type { ActionOutcome, TopWin } from '../../shared/types/outcome-tracking.js';
import { createLogger } from '../logger.js';
import { isProgrammingError } from '../errors.js';

const log = createLogger('workspace-intelligence/learnings');

export async function assembleLearnings(
  workspaceId: string,
  opts?: IntelligenceOptions,
): Promise<LearningsSlice> {
  let summary: ReturnType<Awaited<typeof import('../workspace-learnings.js')>['getWorkspaceLearnings']> | undefined;
  let playbooks: ReturnType<Awaited<typeof import('../outcome-playbooks.js')>['getPlaybooks']> = [];
  let availability: LearningsSlice['availability'] = 'no_data';
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
  try {
    const { getActionsByWorkspace, getOutcomesForAction, getTopWinsFromActions } = await import('../outcome-tracking.js'); // dynamic-import-ok - intelligence slices lazy-load optional subsystems for graceful degradation
    const actions = getActionsByWorkspace(workspaceId);
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

    // Build roiAttribution from live outcome data (replaces dead roi_attributions read).
    // clicksBefore / clicksAfter come from baseline_snapshot and metrics_snapshot respectively.
    // We cap at 10 to match the former roi_attributions limit.
    for (const action of actions.slice(0, 50)) {
      if (roiAttribution.length >= 10) break;
      const outcomes = cachedGetOutcomes(action.id);
      // Use the most-recent win outcome per action (highest checkpoint_days = most complete).
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
    scoringConfig,
  };
}
