// server/workspace-learnings.ts
// Workspace Learnings module — aggregates outcome data into structured learnings
// that get injected into AI prompts, making every AI feature smarter over time.

import crypto from 'node:crypto';
import db from './db/index.js';
import { createStmtCache } from './db/stmt-cache.js';
import { createLogger } from './logger.js';
import { getActionsByWorkspace, getOutcomesForAction } from './outcome-tracking.js';
import { rowToWorkspaceLearnings } from './db/outcome-mappers.js';
import type { WorkspaceLearningsRow } from './db/outcome-mappers.js';
import type {
  WorkspaceLearnings,
  ContentLearnings,
  StrategyLearnings,
  TechnicalLearnings,
  OverallLearnings,
  LearningsConfidence,
  LearningsTrend,
  ActionType,
  TrackedAction,
  ActionOutcome,
} from '../shared/types/outcome-tracking.js';

const log = createLogger('workspace-learnings');

// --- Prepared statements ---

const stmts = createStmtCache(() => ({
  getCached: db.prepare('SELECT * FROM workspace_learnings WHERE workspace_id = ?'),
  upsert: db.prepare(`
    INSERT OR REPLACE INTO workspace_learnings (id, workspace_id, learnings, computed_at)
    VALUES (@id, @workspace_id, @learnings, @computed_at)
  `),
  delete: db.prepare('DELETE FROM workspace_learnings WHERE workspace_id = ?'),
  allWorkspaceIds: db.prepare('SELECT DISTINCT workspace_id FROM tracked_actions'),
}));

// --- Helpers ---

const CONTENT_ACTION_TYPES: ActionType[] = [
  'content_published',
  'brief_created',
  'content_refreshed',
  'voice_calibrated',
];

const STRATEGY_ACTION_TYPES: ActionType[] = [
  'strategy_keyword_added',
  'insight_acted_on',
];

const TECHNICAL_ACTION_TYPES: ActionType[] = [
  'schema_deployed',
  'audit_fix_applied',
  'internal_link_added',
  'meta_updated',
];

type ScoredActionWithOutcome = {
  action: TrackedAction;
  outcome: ActionOutcome;
};

function isWin(score: ActionOutcome['score']): boolean {
  return score === 'win' || score === 'strong_win';
}

function isStrongWin(score: ActionOutcome['score']): boolean {
  return score === 'strong_win';
}

function computeConfidence(count: number): LearningsConfidence {
  if (count >= 25) return 'high';
  if (count >= 10) return 'medium';
  return 'low';
}

function computeTrend(scoredItems: ScoredActionWithOutcome[]): LearningsTrend {
  if (scoredItems.length < 6) return 'stable';

  // Sort by measured_at descending, compare recent half vs older half
  const sorted = [...scoredItems].sort(
    (a, b) => new Date(b.outcome.measuredAt).getTime() - new Date(a.outcome.measuredAt).getTime()
  );

  const halfLen = Math.floor(sorted.length / 2);
  const recentHalf = sorted.slice(0, halfLen);
  const olderHalf = sorted.slice(halfLen);

  const recentWinRate = recentHalf.filter(x => isWin(x.outcome.score)).length / recentHalf.length;
  const olderWinRate = olderHalf.filter(x => isWin(x.outcome.score)).length / olderHalf.length;

  const diff = recentWinRate - olderWinRate;
  if (diff > 0.08) return 'improving';
  if (diff < -0.08) return 'declining';
  return 'stable';
}

function computeWinRate(items: ScoredActionWithOutcome[]): number {
  if (items.length === 0) return 0;
  const wins = items.filter(x => isWin(x.outcome.score)).length;
  return Math.round((wins / items.length) * 100) / 100;
}

// --- Content learnings ---

function computeContentLearnings(items: ScoredActionWithOutcome[]): ContentLearnings | null {
  const contentItems = items.filter(x => CONTENT_ACTION_TYPES.includes(x.action.actionType));
  if (contentItems.length < 10) return null;

  // Win rate by format — inferred from sourceType or actionType
  const winRateByFormat: Record<string, number> = {};
  const formatGroups: Record<string, ScoredActionWithOutcome[]> = {};

  for (const item of contentItems) {
    // Use sourceType as format proxy when available, otherwise actionType
    const format = item.action.sourceType || item.action.actionType;
    if (!formatGroups[format]) formatGroups[format] = [];
    formatGroups[format].push(item);
  }

  for (const [format, group] of Object.entries(formatGroups)) {
    if (group.length >= 3) {
      winRateByFormat[format] = computeWinRate(group);
    }
  }

  // Average days to page 1 — approximated from checkpoint_days for wins with positive position delta
  const page1Items = contentItems.filter(x => {
    if (!isWin(x.outcome.score)) return false;
    const baseline = x.action.baselineSnapshot.position;
    const current = x.outcome.metricsSnapshot.position;
    if (baseline == null || current == null) return false;
    return current <= 10 && baseline > 10;
  });

  const avgDaysToPage1 =
    page1Items.length >= 3
      ? Math.round(
          page1Items.reduce((sum, x) => sum + x.outcome.checkpointDays, 0) / page1Items.length
        )
      : null;

  // Best performing topics — keywords from wins
  const topicWins = contentItems
    .filter(x => isWin(x.outcome.score) && x.action.targetKeyword)
    .map(x => x.action.targetKeyword as string);

  const topicCounts: Record<string, number> = {};
  for (const topic of topicWins) {
    topicCounts[topic] = (topicCounts[topic] ?? 0) + 1;
  }

  const bestPerformingTopics = Object.entries(topicCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([topic]) => topic);

  // Optimal word count — placeholder (no word count in schema, derive from insights if available)
  const optimalWordCount = null;

  // Refresh recovery rate
  const refreshItems = contentItems.filter(x => x.action.actionType === 'content_refreshed');
  const refreshRecoveryRate =
    refreshItems.length >= 3 ? computeWinRate(refreshItems) : 0;

  // Voice score correlation — average voice score delta for voice_calibrated wins
  const voiceItems = contentItems.filter(
    x => x.action.actionType === 'voice_calibrated' && isWin(x.outcome.score)
  );
  const voiceScoreCorrelation =
    voiceItems.length >= 3
      ? Math.round(
          (voiceItems.reduce((sum, x) => {
            const baseVoice = x.action.baselineSnapshot.voice_score ?? 0;
            const currVoice = x.outcome.metricsSnapshot.voice_score ?? 0;
            return sum + (currVoice - baseVoice);
          }, 0) /
            voiceItems.length) *
            100
        ) / 100
      : null;

  return {
    winRateByFormat,
    avgDaysToPage1,
    bestPerformingTopics,
    optimalWordCount,
    refreshRecoveryRate,
    voiceScoreCorrelation,
  };
}

// --- Strategy learnings ---

function computeStrategyLearnings(items: ScoredActionWithOutcome[]): StrategyLearnings | null {
  const strategyItems = items.filter(x => STRATEGY_ACTION_TYPES.includes(x.action.actionType));
  if (strategyItems.length < 10) return null;

  // Win rate by difficulty range (binned from keyword difficulty proxied by position baseline)
  const difficultyBins: Record<string, ScoredActionWithOutcome[]> = {
    '0-20': [],
    '21-40': [],
    '41-60': [],
    '61-80': [],
    '81-100': [],
  };

  for (const item of strategyItems) {
    const pos = item.action.baselineSnapshot.position;
    if (pos == null) continue;
    // Approximate difficulty from baseline position: lower position = harder
    // Bin by position buckets that loosely map to difficulty
    if (pos >= 51) difficultyBins['0-20'].push(item);
    else if (pos >= 31) difficultyBins['21-40'].push(item);
    else if (pos >= 21) difficultyBins['41-60'].push(item);
    else if (pos >= 11) difficultyBins['61-80'].push(item);
    else difficultyBins['81-100'].push(item);
  }

  const winRateByDifficultyRange: Record<string, number> = {};
  for (const [range, group] of Object.entries(difficultyBins)) {
    if (group.length >= 3) {
      winRateByDifficultyRange[range] = computeWinRate(group);
    }
  }

  // Win rate by checkpoint — what fraction of actions scored at each checkpoint are wins
  const checkpointGroups: Record<string, ScoredActionWithOutcome[]> = {};
  for (const item of strategyItems) {
    const key = String(item.outcome.checkpointDays);
    if (!checkpointGroups[key]) checkpointGroups[key] = [];
    checkpointGroups[key].push(item);
  }

  const winRateByCheckpoint: Record<string, number> = {};
  for (const [days, group] of Object.entries(checkpointGroups)) {
    if (group.length >= 3) {
      winRateByCheckpoint[`${days}d`] = computeWinRate(group);
    }
  }

  // Best intent types — derived from sourceType
  const intentWins = strategyItems
    .filter(x => isWin(x.outcome.score))
    .map(x => x.action.sourceType);

  const intentCounts: Record<string, number> = {};
  for (const intent of intentWins) {
    intentCounts[intent] = (intentCounts[intent] ?? 0) + 1;
  }

  const bestIntentTypes = Object.entries(intentCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([intent]) => intent);

  // Keyword volume sweet spot — from impressions baseline (proxy for search volume)
  const impressionValues = strategyItems
    .filter(x => isWin(x.outcome.score) && x.action.baselineSnapshot.impressions != null)
    .map(x => x.action.baselineSnapshot.impressions as number);

  const keywordVolumeSweetSpot =
    impressionValues.length >= 5
      ? {
          min: Math.round(Math.min(...impressionValues)),
          max: Math.round(Math.max(...impressionValues)),
        }
      : null;

  return {
    winRateByDifficultyRange,
    winRateByCheckpoint,
    bestIntentTypes,
    keywordVolumeSweetSpot,
  };
}

// --- Technical learnings ---

function computeTechnicalLearnings(items: ScoredActionWithOutcome[]): TechnicalLearnings | null {
  const techItems = items.filter(x => TECHNICAL_ACTION_TYPES.includes(x.action.actionType));
  if (techItems.length < 10) return null;

  // Win rate by fix type (actionType)
  const fixTypeGroups: Record<string, ScoredActionWithOutcome[]> = {};
  for (const item of techItems) {
    const key = item.action.actionType;
    if (!fixTypeGroups[key]) fixTypeGroups[key] = [];
    fixTypeGroups[key].push(item);
  }

  const winRateByFixType: Record<string, number> = {};
  for (const [fixType, group] of Object.entries(fixTypeGroups)) {
    if (group.length >= 2) {
      winRateByFixType[fixType] = computeWinRate(group);
    }
  }

  // Schema types that led to rich results
  const schemaWins = techItems.filter(
    x =>
      x.action.actionType === 'schema_deployed' &&
      isWin(x.outcome.score) &&
      x.outcome.metricsSnapshot.rich_result_appearing === true
  );

  const schemaTypes = [...new Set(schemaWins.map(x => x.action.sourceType))].slice(0, 5);

  // Average health score improvement
  const healthItems = techItems.filter(
    x =>
      isWin(x.outcome.score) &&
      x.action.baselineSnapshot.page_health_score != null &&
      x.outcome.metricsSnapshot.page_health_score != null
  );

  const avgHealthScoreImprovement =
    healthItems.length >= 3
      ? Math.round(
          (healthItems.reduce((sum, x) => {
            const delta =
              (x.outcome.metricsSnapshot.page_health_score ?? 0) -
              (x.action.baselineSnapshot.page_health_score ?? 0);
            return sum + delta;
          }, 0) /
            healthItems.length) *
            10
        ) / 10
      : 0;

  // Internal link effectiveness
  const linkItems = techItems.filter(x => x.action.actionType === 'internal_link_added');
  const internalLinkEffectiveness = linkItems.length >= 2 ? computeWinRate(linkItems) : 0;

  return {
    winRateByFixType,
    schemaTypesWithRichResults: schemaTypes,
    avgHealthScoreImprovement,
    internalLinkEffectiveness,
  };
}

// --- Overall learnings ---

function computeOverallLearnings(
  items: ScoredActionWithOutcome[]
): OverallLearnings {
  const totalWinRate = computeWinRate(items);

  const strongWins = items.filter(x => isStrongWin(x.outcome.score)).length;
  const strongWinRate =
    items.length > 0 ? Math.round((strongWins / items.length) * 100) / 100 : 0;

  // Top action types by win rate (min 3 samples)
  const typeGroups: Record<string, ScoredActionWithOutcome[]> = {};
  for (const item of items) {
    const key = item.action.actionType;
    if (!typeGroups[key]) typeGroups[key] = [];
    typeGroups[key].push(item);
  }

  const topActionTypes = Object.entries(typeGroups)
    .filter(([, group]) => group.length >= 3)
    .map(([type, group]) => ({
      type,
      winRate: computeWinRate(group),
      count: group.length,
    }))
    .sort((a, b) => b.winRate - a.winRate)
    .slice(0, 5);

  const recentTrend = computeTrend(items);

  return {
    totalWinRate,
    strongWinRate,
    topActionTypes,
    recentTrend,
  };
}

// --- Core compute function ---

export function computeWorkspaceLearnings(workspaceId: string): WorkspaceLearnings {
  const actions = getActionsByWorkspace(workspaceId);
  const now = new Date().toISOString();

  // Collect all scored outcomes (measurement_complete = true, score is a real verdict)
  const scored: ScoredActionWithOutcome[] = [];

  for (const action of actions) {
    if (!action.measurementComplete) continue;
    const outcomes = getOutcomesForAction(action.id);
    // outcomes ordered ASC by checkpoint_days — last valid = most recent checkpoint
    const validOutcomes = outcomes.filter(o =>
      o.score != null && o.score !== 'insufficient_data' && o.score !== 'inconclusive'
    );
    if (validOutcomes.length > 0) {
      scored.push({ action, outcome: validOutcomes[validOutcomes.length - 1] });
    }
  }

  const totalScoredActions = scored.length;
  const confidence = computeConfidence(totalScoredActions);

  const content = computeContentLearnings(scored);
  const strategy = computeStrategyLearnings(scored);
  const technical = computeTechnicalLearnings(scored);
  const overall = computeOverallLearnings(scored);

  return {
    workspaceId,
    computedAt: now,
    confidence,
    totalScoredActions,
    content,
    strategy,
    technical,
    overall,
  };
}

// --- Cache management ---

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export function getWorkspaceLearnings(
  workspaceId: string,
  _domain?: string
): WorkspaceLearnings | null {
  const row = stmts().getCached.get(workspaceId) as WorkspaceLearningsRow | undefined;

  if (row) {
    const age = Date.now() - new Date(row.computed_at).getTime();
    if (age < CACHE_TTL_MS) {
      return rowToWorkspaceLearnings(row);
    }
  }

  // Recompute
  const learnings = computeWorkspaceLearnings(workspaceId);

  if (learnings.totalScoredActions === 0) {
    // No current data — return stale cache rather than nothing, so AI prompts
    // don't lose historical context due to a transient data gap.
    // Touch the row's computed_at so we don't recompute on every subsequent call
    // until the next 24h window.
    if (row) {
      stmts().upsert.run({ id: row.id, workspace_id: workspaceId, learnings: row.learnings, computed_at: new Date().toISOString() });
      return rowToWorkspaceLearnings(row);
    }
    return null;
  }

  const id = crypto.randomUUID();
  stmts().upsert.run({
    id,
    workspace_id: workspaceId,
    learnings: JSON.stringify({
      confidence: learnings.confidence,
      totalScoredActions: learnings.totalScoredActions,
      content: learnings.content,
      strategy: learnings.strategy,
      technical: learnings.technical,
      overall: learnings.overall,
    }),
    computed_at: learnings.computedAt,
  });

  log.info({ workspaceId, totalScoredActions: learnings.totalScoredActions }, 'Workspace learnings computed and cached');

  return learnings;
}

// --- Prompt formatting ---

export function formatLearningsForPrompt(
  learnings: WorkspaceLearnings,
  domain: 'content' | 'strategy' | 'technical' | 'all'
): string {
  if (learnings.confidence === 'low') return '';

  const lines: string[] = [];
  const { overall, totalScoredActions, confidence } = learnings;

  lines.push(
    `WORKSPACE LEARNINGS (${totalScoredActions} tracked outcomes, ${confidence} confidence):`
  );

  // Overall win rate
  const winPct = Math.round(overall.totalWinRate * 100);
  const strongPct = Math.round(overall.strongWinRate * 100);
  lines.push(
    `- Overall win rate: ${winPct}% (${strongPct}% strong wins)`
  );

  // Trend
  if (overall.recentTrend !== 'stable') {
    lines.push(`- Recent trend: ${overall.recentTrend}`);
  }

  // Top action types
  if (overall.topActionTypes.length > 0) {
    const top = overall.topActionTypes
      .slice(0, 3)
      .map(t => `${t.type.replace(/_/g, ' ')} (${Math.round(t.winRate * 100)}%)`)
      .join(', ');
    lines.push(`- Highest-performing actions: ${top}`);
  }

  // Content learnings
  if ((domain === 'content' || domain === 'all') && learnings.content) {
    const c = learnings.content;

    const topFormats = Object.entries(c.winRateByFormat)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 2);
    if (topFormats.length >= 2) {
      const [f1, r1] = topFormats[0];
      const [f2, r2] = topFormats[1];
      lines.push(
        `- ${f1.replace(/_/g, ' ')} outperforms ${f2.replace(/_/g, ' ')} (${Math.round(r1 * 100)}% vs ${Math.round(r2 * 100)}% win rate)`
      );
    }

    if (c.avgDaysToPage1 != null) {
      lines.push(`- Content reaches page 1 in ~${c.avgDaysToPage1} days on average`);
    }

    if (c.refreshRecoveryRate > 0) {
      lines.push(
        `- Content refreshes recover traffic ${Math.round(c.refreshRecoveryRate * 100)}% of the time`
      );
    }

    if (c.bestPerformingTopics.length > 0) {
      lines.push(`- Best performing topics: ${c.bestPerformingTopics.slice(0, 3).join(', ')}`);
    }
  }

  // Strategy learnings
  if ((domain === 'strategy' || domain === 'all') && learnings.strategy) {
    const s = learnings.strategy;

    const topDifficulty = Object.entries(s.winRateByDifficultyRange)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 1);
    if (topDifficulty.length > 0) {
      const [range, rate] = topDifficulty[0];
      lines.push(
        `- Keywords with difficulty ${range} have highest win rate (${Math.round(rate * 100)}%)`
      );
    }

    if (s.keywordVolumeSweetSpot) {
      lines.push(
        `- Optimal keyword impressions range: ${s.keywordVolumeSweetSpot.min}–${s.keywordVolumeSweetSpot.max}/month`
      );
    }

    if (s.bestIntentTypes.length > 0) {
      lines.push(`- Best intent types: ${s.bestIntentTypes.join(', ')}`);
    }
  }

  // Technical learnings
  if ((domain === 'technical' || domain === 'all') && learnings.technical) {
    const t = learnings.technical;

    const topFix = Object.entries(t.winRateByFixType)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 1);
    if (topFix.length > 0) {
      const [fixType, rate] = topFix[0];
      lines.push(
        `- ${fixType.replace(/_/g, ' ')} has highest technical win rate (${Math.round(rate * 100)}%)`
      );
    }

    if (t.schemaTypesWithRichResults.length > 0) {
      lines.push(
        `- Schema types producing rich results: ${t.schemaTypesWithRichResults.join(', ')}`
      );
    }

    if (t.avgHealthScoreImprovement > 0) {
      lines.push(`- Average health score improvement after fixes: +${t.avgHealthScoreImprovement}`);
    }

    if (t.internalLinkEffectiveness > 0) {
      lines.push(
        `- Internal link additions improve rankings ${Math.round(t.internalLinkEffectiveness * 100)}% of the time`
      );
    }
  }

  // Cap at ~500 tokens: trim to 10 bullets max
  const header = lines[0];
  const bullets = lines.slice(1).slice(0, 9);
  return [header, ...bullets].join('\n');
}

// --- Cache invalidation ---

export function invalidateLearningsCache(workspaceId: string): void {
  stmts().delete.run(workspaceId);
  log.info({ workspaceId }, 'Workspace learnings cache invalidated');
}

// --- Batch recompute (for daily cron) ---

export async function recomputeAllWorkspaceLearnings(): Promise<void> {
  const rows = stmts().allWorkspaceIds.all() as Array<{ workspace_id: string }>;
  const workspaceIds = rows.map(r => r.workspace_id);

  log.info({ count: workspaceIds.length }, 'Starting batch recompute of workspace learnings');

  for (const workspaceId of workspaceIds) {
    try {
      const learnings = computeWorkspaceLearnings(workspaceId);

      if (learnings.totalScoredActions === 0) continue;

      const id = crypto.randomUUID();
      stmts().upsert.run({
        id,
        workspace_id: workspaceId,
        learnings: JSON.stringify({
          confidence: learnings.confidence,
          totalScoredActions: learnings.totalScoredActions,
          content: learnings.content,
          strategy: learnings.strategy,
          technical: learnings.technical,
          overall: learnings.overall,
        }),
        computed_at: learnings.computedAt,
      });

      log.info(
        { workspaceId, totalScoredActions: learnings.totalScoredActions, confidence: learnings.confidence },
        'Workspace learnings recomputed'
      );
    } catch (err) {
      log.error({ workspaceId, err }, 'Failed to recompute workspace learnings');
    }
  }

  log.info({ count: workspaceIds.length }, 'Batch recompute of workspace learnings complete');
}
