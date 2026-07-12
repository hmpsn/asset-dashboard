// server/workspace-learnings.ts
// Workspace Learnings module — aggregates outcome data into structured learnings
// that get injected into AI prompts, making every AI feature smarter over time.

import crypto from 'node:crypto';
import db from './db/index.js';
import { createStmtCache } from './db/stmt-cache.js';
import { createLogger } from './logger.js';
import { getActionsByWorkspace, getOutcomesForAction } from './outcome-tracking.js';
import { rowToWorkspaceLearnings } from './db/outcome-mappers.js';
import { parseJsonFallback } from './db/json-validation.js';
import { broadcastToWorkspace } from './broadcast.js';
import { WS_EVENTS } from './ws-events.js';
import { invalidateMonthlyDigestCache } from './monthly-digest-cache.js';
import { clearIntelligenceCache } from './intelligence/cache-clear.js';
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

// --- Administrative disable switch (A1) ---

/**
 * Process-local override registry for the learnings kill-switch. Seeded from the
 * OUTCOME_LEARNINGS_DISABLED_WORKSPACES env allow-list on first read and mutable
 * via setLearningsDisabled (admin routes / tests). A future PR can swap the
 * backing store to a DB column without changing the public signatures below.
 *
 * Anchored on globalThis so the static import (admin routes, tests) and the
 * dynamic import inside the learnings slice share ONE Map. Under the vitest ESM
 * loader a static and a dynamic import of the same module can evaluate to
 * separate instances; a per-module `new Map()` would then diverge between the
 * toggle writer and the slice reader. The global anchor makes the switch
 * authoritative regardless of how the module was imported.
 */
const LEARNINGS_DISABLED_KEY = Symbol.for('hmpsn.outcomeLearnings.disabledOverrides');
const globalAnchor = globalThis as unknown as { [LEARNINGS_DISABLED_KEY]?: Map<string, boolean> };
const learningsDisabledOverrides: Map<string, boolean> =
  globalAnchor[LEARNINGS_DISABLED_KEY] ?? (globalAnchor[LEARNINGS_DISABLED_KEY] = new Map<string, boolean>());
let envDisabledWorkspaces: Set<string> | null = null;

function getEnvDisabledWorkspaces(): Set<string> {
  if (envDisabledWorkspaces === null) {
    const raw = process.env.OUTCOME_LEARNINGS_DISABLED_WORKSPACES ?? '';
    envDisabledWorkspaces = new Set(
      raw.split(',').map(s => s.trim()).filter(Boolean),
    );
  }
  return envDisabledWorkspaces;
}

/**
 * Administrative kill-switch read (A1). Disabled workspaces report
 * `availability: 'disabled'` through the learnings slice so consumers degrade to
 * general best practices (per the LearningsSlice.availability contract). A
 * process-local override takes precedence over the env allow-list, so an admin
 * toggle wins over the deploy-time default.
 *
 * Exported contract consumed by the learnings slice (makes `disabled` reachable)
 * and downstream A4/A6/E5.
 *
 * SCOPE: gates AI/slice consumers only (assembleLearnings short-circuits to
 * availability:'disabled'). Admin outcome routes in server/routes/outcomes.ts
 * intentionally BYPASS this switch so quarantined data stays observable to operators —
 * disabling learnings hides them from the model, not from the admin who is debugging them.
 */
export function isLearningsDisabled(workspaceId: string): boolean {
  const override = learningsDisabledOverrides.get(workspaceId);
  if (override !== undefined) return override;
  return getEnvDisabledWorkspaces().has(workspaceId);
}

/**
 * Set the process-local administrative learnings override for a workspace.
 *
 * NOTE ON SEMANTICS: this writes an EXPLICIT override that takes precedence over the
 * env allow-list in BOTH directions:
 *   - `true`  → force-disabled regardless of env.
 *   - `false` → force-ENABLED regardless of env. This is NOT a "clear" — it is a
 *     permanent explicit-false override that will mask an env-listed workspace.
 * To restore env-list precedence (i.e. genuinely forget the override), call
 * {@link clearLearningsDisabledOverride} instead.
 *
 * Process-local; intended for admin routes and tests.
 */
export function setLearningsDisabled(workspaceId: string, disabled: boolean): void {
  learningsDisabledOverrides.set(workspaceId, disabled);
}

/**
 * Clear the process-local override for a workspace so {@link isLearningsDisabled} falls
 * back to the env allow-list. Use this rather than `setLearningsDisabled(id, false)`
 * when the intent is "stop overriding" rather than "force-enable". Trivially safe:
 * deleting an absent key is a no-op.
 */
export function clearLearningsDisabledOverride(workspaceId: string): void {
  learningsDisabledOverrides.delete(workspaceId);
}

// --- Learnings logic version ---

/**
 * Version stamp for the learnings COMPUTATION LOGIC, baked into every cached
 * payload. Bump this whenever a fix changes what a recompute would produce for the
 * SAME underlying outcome data — e.g. the A1 `not_acted_on` exclusion, the
 * phantom-metric guard, or the backfill re-attribution. A cached blob whose stamp
 * does not match the current version was produced by older (corrupt) logic and MUST
 * be treated as cache-invalid on read: recompute, and if the recompute is honestly
 * empty (`totalScoredActions === 0`) return the empty aggregate rather than serving
 * the pre-fix blob forever.
 *
 * Why this matters (the resurrection bug it fixes): post-A1, a workspace whose entire
 * history was `not_acted_on` recomputes to 0 scorable actions. The old code returned
 * the OLD cached blob in that case AND touched computed_at so it never expired —
 * serving the PRE-FIX corrupted aggregate indefinitely. The version gate breaks that
 * loop: an unversioned/old-version blob is never returned.
 *
 * v1: A1 — not_acted_on exclusion, phantom-metric guard, backfill re-attribution.
 */
export const LEARNINGS_LOGIC_VERSION = 1;

// --- Prepared statements ---

const stmts = createStmtCache(() => ({
  getCached: db.prepare('SELECT * FROM workspace_learnings WHERE workspace_id = ?'),
  upsert: db.prepare(`
    INSERT OR REPLACE INTO workspace_learnings (id, workspace_id, learnings, computed_at)
    VALUES (@id, @workspace_id, @learnings, @computed_at)
  `),
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
  'competitor_gap_closed',
  'cluster_published',
  'cannibalization_resolved',
  'local_visibility_won',
  'local_service_added',
];

const TECHNICAL_ACTION_TYPES: ActionType[] = [
  'schema_deployed',
  'audit_fix_applied',
  'internal_link_added',
  'meta_updated',
];

export type ScoredActionWithOutcome = {
  action: TrackedAction;
  outcome: ActionOutcome;
};

function isWin(score: ActionOutcome['score']): boolean {
  return score === 'win' || score === 'strong_win';
}

function isStrongWin(score: ActionOutcome['score']): boolean {
  return score === 'strong_win';
}

export function computeConfidence(count: number): LearningsConfidence {
  if (count >= 25) return 'high';
  if (count >= 10) return 'medium';
  return 'low';
}

export function computeTrend(scoredItems: ScoredActionWithOutcome[]): LearningsTrend {
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

export function computeWinRate(items: ScoredActionWithOutcome[]): number {
  if (items.length === 0) return 0;
  const wins = items.filter(x => isWin(x.outcome.score)).length;
  return Math.round((wins / items.length) * 100) / 100;
}

// --- Content learnings ---

export function computeContentLearnings(items: ScoredActionWithOutcome[]): ContentLearnings | null {
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

export function computeStrategyLearnings(items: ScoredActionWithOutcome[]): StrategyLearnings | null {
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

export function computeTechnicalLearnings(items: ScoredActionWithOutcome[]): TechnicalLearnings | null {
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

export function computeOverallLearnings(
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

  // Collect the latest usable scored 30/60/90-day outcome for every action.
  // 30/60-day verdicts can be meaningful before the 90-day completion flag flips.
  const scored: ScoredActionWithOutcome[] = [];

  for (const action of actions) {
    // A1: `not_acted_on` actions are suggestions the workspace never executed.
    // Scoring them as if they were executed fabricates wins/losses and corrupts
    // every win-rate, trend, and playbook downstream. Exclude them from aggregation.
    if (action.attribution === 'not_acted_on') continue;

    const outcomes = getOutcomesForAction(action.id);
    const validOutcomes = outcomes.filter(o =>
      (o.checkpointDays === 30 || o.checkpointDays === 60 || o.checkpointDays === 90) &&
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

/** Serialized form of the learnings blob stored in the JSON column. */
function serializeLearnings(learnings: WorkspaceLearnings): string {
  return JSON.stringify({
    logicVersion: LEARNINGS_LOGIC_VERSION,
    confidence: learnings.confidence,
    totalScoredActions: learnings.totalScoredActions,
    content: learnings.content,
    strategy: learnings.strategy,
    technical: learnings.technical,
    overall: learnings.overall,
  });
}

/**
 * The honest empty aggregate for a workspace with no scorable outcomes. Returned
 * (instead of a stale/old-version cached blob) when a recompute yields zero scored
 * actions and the only cache on disk was produced by stale logic. This is the
 * truthful "we have no learnings yet" answer rather than the pre-fix corrupted one.
 */
function emptyLearnings(workspaceId: string): WorkspaceLearnings {
  return {
    workspaceId,
    computedAt: new Date().toISOString(),
    confidence: 'low',
    totalScoredActions: 0,
    content: null,
    strategy: null,
    technical: null,
    overall: { totalWinRate: 0, strongWinRate: 0, topActionTypes: [], recentTrend: 'stable' },
  };
}

/**
 * Reads the `logicVersion` stamp from a raw cached row WITHOUT trusting the
 * structural mapper. A row written by pre-A1 logic has no stamp (or an older one);
 * either way it is cache-invalid and must be recomputed rather than served.
 */
function cachedLogicVersion(row: WorkspaceLearningsRow): number | null {
  const obj = parseJsonFallback<{ logicVersion?: unknown }>(row.learnings, {});
  return typeof obj.logicVersion === 'number' ? obj.logicVersion : null;
}

export function getWorkspaceLearnings(
  workspaceId: string,
  _domain?: string
): WorkspaceLearnings | null {
  const row = stmts().getCached.get(workspaceId) as WorkspaceLearningsRow | undefined;

  // A cached row is only trustworthy when its computation-logic version matches the
  // current one. A version mismatch (including a missing stamp from pre-A1 logic)
  // means the blob was produced by older, corrupt logic — treat it as cache-invalid
  // and fall through to recompute. This is what stops the stale-cache resurrection
  // bug: an unversioned blob can never be returned, and on a recompute that comes
  // back empty we return the honest empty aggregate below, not the old blob.
  const versionMatches = row ? cachedLogicVersion(row) === LEARNINGS_LOGIC_VERSION : false;

  if (row && versionMatches) {
    const age = Date.now() - new Date(row.computed_at).getTime();
    if (age < CACHE_TTL_MS) {
      const parsed = rowToWorkspaceLearnings(row);
      if (parsed) return parsed;
      // Corrupt or schema-drifted cache payload: recompute below instead of
      // silently returning null for a still-fresh row.
      log.warn({ workspaceId }, 'Cached workspace learnings payload invalid — recomputing');
    }
  } else if (row) {
    log.info(
      { workspaceId, cachedVersion: cachedLogicVersion(row), currentVersion: LEARNINGS_LOGIC_VERSION },
      'Cached workspace learnings logic-version mismatch — recomputing (stale blob will not be served)',
    );
  }

  // Recompute
  const learnings = computeWorkspaceLearnings(workspaceId);

  if (learnings.totalScoredActions === 0) {
    // No current scorable data after a recompute.
    if (row && versionMatches) {
      // The cached blob was produced by CURRENT logic — a transient data gap, not
      // corruption. Return the stale (but trustworthy) cache so AI prompts don't lose
      // historical context, and touch computed_at so we don't recompute every call.
      stmts().upsert.run({ id: row.id, workspace_id: workspaceId, learnings: row.learnings, computed_at: new Date().toISOString() });
      return rowToWorkspaceLearnings(row);
    }
    // No cache, OR the only cache is from stale/old logic. Returning the old blob
    // would resurrect the pre-fix corrupted aggregate forever, so persist + serve the
    // honest empty aggregate stamped with the current version instead.
    const empty = emptyLearnings(workspaceId);
    if (row) {
      stmts().upsert.run({
        id: row.id,
        workspace_id: workspaceId,
        learnings: serializeLearnings(empty),
        computed_at: empty.computedAt,
      });
      log.info({ workspaceId }, 'Replaced stale-version learnings cache with honest empty aggregate');
    }
    return row ? empty : null;
  }

  const id = crypto.randomUUID();
  stmts().upsert.run({
    id,
    workspace_id: workspaceId,
    learnings: serializeLearnings(learnings),
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

/** Returns workspace IDs that have scored outcomes (same set recomputeAll processes). */
export function getWorkspaceIdsWithOutcomes(): string[] {
  const rows = stmts().allWorkspaceIds.all() as Array<{ workspace_id: string }>;
  return rows.map(r => r.workspace_id);
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
        learnings: serializeLearnings(learnings),
        computed_at: learnings.computedAt,
      });

      invalidateMonthlyDigestCache(workspaceId);
      clearIntelligenceCache(workspaceId);
      broadcastToWorkspace(workspaceId, WS_EVENTS.OUTCOME_LEARNINGS_UPDATED, {
        totalScoredActions: learnings.totalScoredActions,
        confidence: learnings.confidence,
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
