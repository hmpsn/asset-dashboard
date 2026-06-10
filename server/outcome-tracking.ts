// server/outcome-tracking.ts
// Core outcome tracking: recording actions, querying, and outcome storage

import crypto from 'node:crypto';
import db from './db/index.js';
import { createStmtCache } from './db/stmt-cache.js';
import { createLogger } from './logger.js';
import { rowToTrackedAction, rowToActionOutcome } from './db/outcome-mappers.js';
import type { TrackedActionRow, ActionOutcomeRow } from './db/outcome-mappers.js';
import { parseJsonFallback } from './db/json-validation.js';
import type {
  TrackedAction,
  ActionOutcome,
  ActionType,
  Attribution,
  BaselineSnapshot,
  TrailingHistory,
  ActionContext,
  SourceFlag,
  BaselineConfidence,
  OutcomeScore,
  DeltaSummary,
  EarlySignal,
  TopWin,
} from '../shared/types/outcome-tracking.js';
import type { ROIHighlight } from '../shared/types/narrative.js';
import { fireBridge, withWorkspaceLock, debouncedOutcomeReweight } from './bridge-infrastructure.js';
import { broadcastToWorkspace } from './broadcast.js';
import { WS_EVENTS } from './ws-events.js';
import { applyScoreAdjustment } from './insight-score-adjustments.js';
import { toInsightPageId } from './helpers.js';

const log = createLogger('outcome-tracking');

function broadcastOutcomeEvent(workspaceId: string, event: string, payload: object): void {
  try {
    broadcastToWorkspace(workspaceId, event, payload);
  } catch (err) {
    if (err instanceof Error && err.message.includes('broadcastToWorkspace() called before init')) {
      log.debug({ workspaceId, event }, 'Skipped outcome broadcast before WebSocket init');
      return;
    }
    throw err;
  }
}

const stmts = createStmtCache(() => ({
  insert: db.prepare(`
    INSERT INTO tracked_actions (id, workspace_id, action_type, source_type, source_id, page_url, target_keyword, baseline_snapshot, trailing_history, attribution, measurement_window, source_flag, baseline_confidence, context, predicted_emv, created_at, updated_at)
    VALUES (@id, @workspace_id, @action_type, @source_type, @source_id, @page_url, @target_keyword, @baseline_snapshot, @trailing_history, @attribution, @measurement_window, @source_flag, @baseline_confidence, @context, @predicted_emv, @created_at, @updated_at)
  `),
  getById: db.prepare(`SELECT * FROM tracked_actions WHERE id = ?`),
  getByWorkspace: db.prepare(`SELECT * FROM tracked_actions WHERE workspace_id = ? ORDER BY created_at DESC`),
  getByWorkspaceAndType: db.prepare(`SELECT * FROM tracked_actions WHERE workspace_id = ? AND action_type = ? ORDER BY created_at DESC`),
  getByWorkspaceAndPage: db.prepare(`SELECT * FROM tracked_actions WHERE workspace_id = ? AND page_url = ? ORDER BY created_at DESC`),
  getBySourceTypeAndId: db.prepare(`SELECT * FROM tracked_actions WHERE source_type = ? AND source_id = ?`),
  getByWorkspaceAndSource: db.prepare(`SELECT * FROM tracked_actions WHERE workspace_id = ? AND source_type = ? AND source_id = ?`),
  getPendingMeasurement: db.prepare(`SELECT * FROM tracked_actions WHERE measurement_complete = 0`),
  getNotActedOn: db.prepare(`SELECT * FROM tracked_actions WHERE attribution = 'not_acted_on' AND measurement_complete = 0`),
  updateAttribution: db.prepare(`UPDATE tracked_actions SET attribution = ?, updated_at = datetime('now') WHERE id = ? AND workspace_id = ?`),
  markComplete: db.prepare(`UPDATE tracked_actions SET measurement_complete = 1, updated_at = datetime('now') WHERE id = ? AND workspace_id = ?`),
  updateContext: db.prepare(`UPDATE tracked_actions SET context = ?, updated_at = datetime('now') WHERE id = ? AND workspace_id = ?`),
  updateBaseline: db.prepare(`UPDATE tracked_actions SET baseline_snapshot = ?, updated_at = datetime('now') WHERE id = ? AND workspace_id = ?`),
  insertOutcome: db.prepare(`
    INSERT OR REPLACE INTO action_outcomes (id, action_id, checkpoint_days, metrics_snapshot, score, early_signal, delta_summary, competitor_context, measured_at, attributed_value, value_basis)
    VALUES (@id, @action_id, @checkpoint_days, @metrics_snapshot, @score, @early_signal, @delta_summary, @competitor_context, @measured_at, @attributed_value, @value_basis)
  `),
  getOutcomesByAction: db.prepare(`SELECT * FROM action_outcomes WHERE action_id = ? ORDER BY checkpoint_days ASC`),
  // Returns ONE win-scored outcome per action_id (the highest checkpoint that scored
  // a win) for a workspace, ordered by measured_at DESC.
  // The correlated subquery deduplicates: an action with wins at day 30 AND day 60
  // emits only the day-60 row instead of appearing twice in the client digest.
  getWinsWithValueByWorkspace: db.prepare(`
    SELECT ao.*, ta.page_url, ta.action_type
    FROM action_outcomes ao
    JOIN tracked_actions ta ON ta.id = ao.action_id
    WHERE ta.workspace_id = ?
      AND ao.score IN ('strong_win', 'win')
      AND ao.checkpoint_days = (
        SELECT MAX(ao2.checkpoint_days)
        FROM action_outcomes ao2
        WHERE ao2.action_id = ao.action_id
          AND ao2.score IN ('strong_win', 'win')
      )
    ORDER BY ao.measured_at DESC
    LIMIT ?
  `),
  getScoredByWorkspace: db.prepare(`
    SELECT ta.*, ao.score AS outcome_score, ao.checkpoint_days AS outcome_checkpoint_days, ao.delta_summary AS outcome_delta_summary, ao.measured_at AS scored_at
    FROM tracked_actions ta
    JOIN action_outcomes ao ON ao.action_id = ta.id
    WHERE ta.workspace_id = ? AND ao.score IS NOT NULL AND ao.score NOT IN ('insufficient_data', 'inconclusive')
    ORDER BY ao.measured_at DESC
  `),
  // Conclusive scored outcomes WITH a realized attributed_value for a workspace,
  // deduplicated to the highest checkpoint per action (so a 30+60 day action is
  // counted once). Feeds the OV realized-$ calibration (server/scoring/ov-calibration.ts);
  // read-only and independent of the legacy buildOutcomeAdjustment win-rate path.
  getCalibrationOutcomesByWorkspace: db.prepare(`
    SELECT ao.score AS score, ao.attributed_value AS attributed_value, ta.action_type AS action_type, ta.predicted_emv AS predicted_emv
    FROM action_outcomes ao
    JOIN tracked_actions ta ON ta.id = ao.action_id
    WHERE ta.workspace_id = ?
      AND ao.attributed_value IS NOT NULL
      AND ao.score IS NOT NULL
      AND ao.score NOT IN ('insufficient_data', 'inconclusive')
      AND ao.checkpoint_days = (
        SELECT MAX(ao2.checkpoint_days)
        FROM action_outcomes ao2
        WHERE ao2.action_id = ao.action_id
          AND ao2.attributed_value IS NOT NULL
          AND ao2.score IS NOT NULL
          AND ao2.score NOT IN ('insufficient_data', 'inconclusive')
      )
  `),
  countByWorkspace: db.prepare(`
    SELECT
      COUNT(*) AS total,
      COALESCE(SUM(CASE WHEN measurement_complete = 1 THEN 1 ELSE 0 END), 0) AS scored,
      COALESCE(SUM(CASE WHEN measurement_complete = 0 THEN 1 ELSE 0 END), 0) AS pending
    FROM tracked_actions WHERE workspace_id = ?
  `),
  getRecentByWorkspace: db.prepare(`
    SELECT * FROM tracked_actions WHERE workspace_id = ? ORDER BY created_at DESC LIMIT ?
  `),
  // EXPLICIT column list (NOT SELECT *). P4 added predicted_emv to BOTH tables via ALTER,
  // but ALTER TABLE always appends at the END: on tracked_actions predicted_emv lands after
  // updated_at, while on the archive it lands AFTER the pre-existing archived_at (migration 041).
  // A positional `SELECT *, datetime('now')` would therefore map predicted_emv→archived_at and
  // datetime('now')→predicted_emv — corrupting the archive (caught by the P4 archive round-trip
  // test). Naming every column makes the copy order-independent and migration-safe forever, the
  // same fix migration 106 applied to archiveOldOutcomes.
  archiveOld: db.prepare(`
    INSERT INTO tracked_actions_archive
      (id, workspace_id, action_type, source_type, source_id, page_url, target_keyword,
       baseline_snapshot, trailing_history, attribution, measurement_window, measurement_complete,
       source_flag, baseline_confidence, context, created_at, updated_at, predicted_emv, archived_at)
    SELECT
       id, workspace_id, action_type, source_type, source_id, page_url, target_keyword,
       baseline_snapshot, trailing_history, attribution, measurement_window, measurement_complete,
       source_flag, baseline_confidence, context, created_at, updated_at, predicted_emv, datetime('now')
    FROM tracked_actions
    WHERE measurement_complete = 1 AND updated_at < datetime('now', '-24 months')
  `),
  // Global retention sweep paired with archiveOld; intentionally
  // operates across all workspaces to enforce the 24-month archive policy.
  // ws-scope-ok
  deleteArchived: db.prepare(`
    DELETE FROM tracked_actions
    WHERE measurement_complete = 1 AND updated_at < datetime('now', '-24 months')
  `),
  // Explicit column list prevents positional misalignment caused by migration 106
  // appending attributed_value/value_basis to the END of action_outcomes but
  // BEFORE archived_at (which already existed from migration 041) in the archive.
  // SELECT * positional insert would map attributed_value→archived_at, corrupting data.
  archiveOldOutcomes: db.prepare(`
    INSERT INTO action_outcomes_archive
      (id, action_id, checkpoint_days, metrics_snapshot, score, early_signal, delta_summary, competitor_context, measured_at, attributed_value, value_basis, archived_at)
    SELECT
      id, action_id, checkpoint_days, metrics_snapshot, score, early_signal, delta_summary, competitor_context, measured_at, attributed_value, value_basis, datetime('now')
    FROM action_outcomes
    WHERE action_id IN (SELECT id FROM tracked_actions_archive)
  `),
}));

// --- Public API ---

export interface RecordActionParams {
  workspaceId: string;
  actionType: ActionType;
  sourceType: string;
  sourceId?: string | null;
  pageUrl?: string | null;
  targetKeyword?: string | null;
  baselineSnapshot: BaselineSnapshot;
  trailingHistory?: TrailingHistory;
  attribution?: Attribution;
  measurementWindow?: number;
  sourceFlag?: SourceFlag;
  baselineConfidence?: BaselineConfidence;
  context?: ActionContext;
  /** SEO Gen-Quality P4: OV `predictedEmv` snapshot (CPC-proxy placeholder). Optional —
   *  defaults to null. Threaded at the recommendation-completion write site
   *  (rec.opportunity?.predictedEmv); null on the outcome-backfill path and the
   *  post/insight recordAction sites (which carry no rec opportunity). */
  predictedEmv?: number | null;
}

export function recordAction(params: RecordActionParams): TrackedAction {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const month = new Date().getMonth() + 1;
  const quarter = Math.ceil(month / 3);

  const context: ActionContext = {
    ...params.context,
    seasonalTag: { month, quarter },
  };

  stmts().insert.run({
    id,
    workspace_id: params.workspaceId,
    action_type: params.actionType,
    source_type: params.sourceType,
    source_id: params.sourceId ?? null,
    page_url: params.pageUrl ?? null,
    target_keyword: params.targetKeyword ?? null,
    baseline_snapshot: JSON.stringify(params.baselineSnapshot),
    trailing_history: JSON.stringify(params.trailingHistory ?? { metric: '', dataPoints: [] }),
    attribution: params.attribution ?? 'platform_executed',
    measurement_window: params.measurementWindow ?? 90,
    source_flag: params.sourceFlag ?? 'live',
    baseline_confidence: params.baselineConfidence ?? 'exact',
    context: JSON.stringify(context),
    predicted_emv: params.predictedEmv ?? null,
    created_at: now,
    updated_at: now,
  });

  log.info({ actionType: params.actionType, workspaceId: params.workspaceId, pageUrl: params.pageUrl }, 'Action recorded');

  const row = stmts().getById.get(id) as TrackedActionRow | undefined;
  if (!row) throw new Error(`Failed to read back tracked action ${id}`);

  // ── Bridge #7: Auto-resolve related insights ──────────────────────
  // If this action relates to a page or keyword, auto-resolve matching insights to 'in_progress'
  // NOTE: recordAction() is SYNC — use fireBridge (fire-and-forget), not executeBridge
  fireBridge('bridge-action-auto-resolve', params.workspaceId, async () => {
    const { getInsights, resolveInsight } = await import('./analytics-insights-store.js'); // dynamic-import-ok: avoids circular dep
    if (!params.pageUrl && !params.targetKeyword) return { modified: 0 };
    const insights = getInsights(params.workspaceId);
    const normalizedPageUrl = params.pageUrl ? toInsightPageId(params.pageUrl) : null;
    const related = insights.filter(i =>
      (normalizedPageUrl && i.pageId === normalizedPageUrl) ||
      (params.targetKeyword && i.strategyKeyword === params.targetKeyword),
    ).filter(i =>
      i.resolutionStatus !== 'resolved' &&
      i.resolutionStatus !== 'in_progress',
    );
    for (const insight of related) {
      resolveInsight(insight.id, params.workspaceId, 'in_progress',
        `Auto-progressed: action "${params.actionType}" recorded`,
        'bridge_7_action_auto_resolve',
      );
    }
    return { modified: related.length };
  });

  // ── Bridge #13: Create analytics annotation ───────────────────────
  fireBridge('bridge-action-annotation', params.workspaceId, async () => {
    const { createAnnotation } = await import('./analytics-annotations.js'); // dynamic-import-ok: avoids circular dep
    const pageCtx = params.pageUrl ? ` (${params.pageUrl})` : '';
    const date = new Date().toISOString().split('T')[0];
    const label = `Action: ${params.actionType}${pageCtx}`;
    createAnnotation({
      workspaceId: params.workspaceId,
      date,
      label,
      category: 'site_change',
      createdBy: 'bridge:action-annotation',
    });
    // This bridge dispatches a domain-specific ANNOTATION_BRIDGE_CREATED
    // event, not the generic INSIGHT_BRIDGE_UPDATED that executeBridge()
    // auto-broadcasts when a BridgeResult is returned. The event payload
    // includes the date and label for the analytics chart annotation
    // marker, which the auto path doesn't carry. Keeping the inline
    // broadcast is intentional.
    // bridge-broadcast-ok
    broadcastToWorkspace(params.workspaceId, WS_EVENTS.ANNOTATION_BRIDGE_CREATED, {
      bridge: 'bridge_13_action_annotation',
      date,
      label,
    });
  });

  return rowToTrackedAction(row);
}

export function getAction(id: string): TrackedAction | null {
  const row = stmts().getById.get(id) as TrackedActionRow | undefined;
  return row ? rowToTrackedAction(row) : null;
}

export function getActionsByWorkspace(workspaceId: string): TrackedAction[] {
  const rows = stmts().getByWorkspace.all(workspaceId) as TrackedActionRow[];
  return rows.map(rowToTrackedAction);
}

export function getActionsByWorkspaceAndType(workspaceId: string, actionType: ActionType): TrackedAction[] {
  const rows = stmts().getByWorkspaceAndType.all(workspaceId, actionType) as TrackedActionRow[];
  return rows.map(rowToTrackedAction);
}

export function getActionsByPage(workspaceId: string, pageUrl: string): TrackedAction[] {
  const rows = stmts().getByWorkspaceAndPage.all(workspaceId, pageUrl) as TrackedActionRow[];
  return rows.map(rowToTrackedAction);
}

export function getActionBySource(sourceType: string, sourceId: string): TrackedAction | null {
  const row = stmts().getBySourceTypeAndId.get(sourceType, sourceId) as TrackedActionRow | undefined;
  return row ? rowToTrackedAction(row) : null;
}

export function getActionByWorkspaceAndSource(workspaceId: string, sourceType: string, sourceId: string): TrackedAction | null {
  const row = stmts().getByWorkspaceAndSource.get(workspaceId, sourceType, sourceId) as TrackedActionRow | undefined;
  return row ? rowToTrackedAction(row) : null;
}

export function getPendingActions(): TrackedAction[] {
  const rows = stmts().getPendingMeasurement.all() as TrackedActionRow[];
  return rows.map(rowToTrackedAction);
}

export function getNotActedOnActions(): TrackedAction[] {
  const rows = stmts().getNotActedOn.all() as TrackedActionRow[];
  return rows.map(rowToTrackedAction);
}

export function updateAttribution(actionId: string, workspaceId: string, attribution: Attribution): boolean {
  const result = stmts().updateAttribution.run(attribution, actionId, workspaceId);
  return result.changes > 0;
}

export function markActionComplete(actionId: string, workspaceId: string): boolean {
  const result = stmts().markComplete.run(actionId, workspaceId);
  return result.changes > 0;
}

export function updateActionContext(actionId: string, workspaceId: string, context: ActionContext): boolean {
  const result = stmts().updateContext.run(JSON.stringify(context), actionId, workspaceId);
  if (result.changes > 0) {
    broadcastOutcomeEvent(workspaceId, WS_EVENTS.OUTCOME_LEARNINGS_UPDATED, {
      actionId,
      action: 'context_updated',
    });
  }
  return result.changes > 0;
}

export function updateBaselineSnapshot(actionId: string, workspaceId: string, snapshot: BaselineSnapshot): boolean {
  const result = stmts().updateBaseline.run(JSON.stringify(snapshot), actionId, workspaceId);
  return result.changes > 0;
}

export function recordOutcome(params: {
  actionId: string;
  checkpointDays: 7 | 30 | 60 | 90;
  metricsSnapshot: BaselineSnapshot;
  score: OutcomeScore | null;
  earlySignal?: EarlySignal;
  deltaSummary: DeltaSummary;
  competitorContext?: object | null;
  /** Dollar value attributed to this outcome (e.g. clicks_delta × page CPC). Omit or pass null when inconclusive. */
  attributedValue?: number | null;
  /** How attributedValue was computed (e.g. 'clicks_delta_x_cpc'). Omit or pass null when attributedValue is null. */
  valueBasis?: string | null;
}): ActionOutcome {
  const id = crypto.randomUUID();

  const doRecord = db.transaction(() => {
    stmts().insertOutcome.run({
      id,
      action_id: params.actionId,
      checkpoint_days: params.checkpointDays,
      metrics_snapshot: JSON.stringify(params.metricsSnapshot),
      score: params.score,
      early_signal: params.earlySignal ?? null,
      delta_summary: JSON.stringify(params.deltaSummary),
      competitor_context: JSON.stringify(params.competitorContext ?? {}),
      measured_at: new Date().toISOString(),
      attributed_value: params.attributedValue ?? null,
      value_basis: params.valueBasis ?? null,
    });

    // Mark action complete after 90-day checkpoint.
    // markComplete requires both id AND workspace_id; look up the row inside the
    // transaction so workspace_id is available without adding it to the public API.
    if (params.checkpointDays === 90) {
      const actionRow = stmts().getById.get(params.actionId) as TrackedActionRow | undefined;
      if (actionRow) {
        stmts().markComplete.run(params.actionId, actionRow.workspace_id);
      }
    }
  });

  doRecord();

  const rows = stmts().getOutcomesByAction.all(params.actionId) as ActionOutcomeRow[];
  const outcome = rows.find(r => r.checkpoint_days === params.checkpointDays);
  if (!outcome) throw new Error(`Failed to read back outcome for action ${params.actionId}`);
  const actionRowForBroadcast = stmts().getById.get(params.actionId) as TrackedActionRow | undefined;
  if (
    actionRowForBroadcast &&
    params.score != null &&
    params.score !== 'insufficient_data' &&
    params.score !== 'inconclusive' &&
    (params.checkpointDays === 30 || params.checkpointDays === 60 || params.checkpointDays === 90)
  ) {
    broadcastOutcomeEvent(actionRowForBroadcast.workspace_id, WS_EVENTS.OUTCOME_LEARNINGS_UPDATED, {
      actionId: params.actionId,
      checkpointDays: params.checkpointDays,
      score: params.score,
    });
  }

  // ── Bridge #1: Outcome → reweight insight scores ──────────────────
  // Only fire for scores that produce a non-zero adjustment (win/strong_win/loss).
  // Skip neutral/insufficient_data/inconclusive to avoid acquiring workspace lock for a no-op.
  //
  // IMPORTANT: debouncedOutcomeReweight uses last-call-wins semantics keyed by workspaceId.
  // The callback must NOT capture per-outcome context (page_url, score) because only the
  // last callback survives when multiple outcomes are recorded in quick succession.
  // Instead, re-query all recently scored actions and reweight ALL non-resolved insights.
  const actionableScores = new Set(['strong_win', 'win', 'loss']);
  if (params.score && actionableScores.has(params.score)) {
    const actionRow = stmts().getById.get(params.actionId) as TrackedActionRow | undefined;
    if (actionRow) {
      const workspaceId = actionRow.workspace_id;
      debouncedOutcomeReweight(workspaceId, async () => {
        const modifiedCount = await withWorkspaceLock(workspaceId, async () => {
          const { getInsights, upsertInsight, cloneInsightParams } = await import('./analytics-insights-store.js'); // dynamic-import-ok: avoids circular dep
          const insights = getInsights(workspaceId);
          const nonResolved = insights.filter(i => i.resolutionStatus !== 'resolved');

          // Re-query recent scored actions to compute a net adjustment per insight.
          // This handles batch outcomes correctly — every scored action contributes.
          const scoredRows = stmts().getScoredByWorkspace.all(workspaceId) as Array<TrackedActionRow & {
            outcome_score: string; outcome_checkpoint_days: number; scored_at: string;
          }>;

          // Build a map of page_url → latest score delta
          const pageScoreMap = new Map<string, number>();
          for (const row of scoredRows) {
            const pageUrl = row.page_url;
            if (!pageUrl || pageScoreMap.has(pageUrl)) continue; // first = most recent
            const delta =
              row.outcome_score === 'strong_win' ? -20 :
              row.outcome_score === 'win'        ? -10 :
              row.outcome_score === 'loss'       ?  15 :
              0;
            if (delta !== 0) pageScoreMap.set(pageUrl, delta);
          }

          let modified = 0;
          for (const insight of nonResolved) {
            const scoreDelta = pageScoreMap.get(insight.pageId ?? '') ?? 0;
            if (scoreDelta !== 0) {
              const { data: newData, adjustedScore } = applyScoreAdjustment(
                insight.data, insight.impactScore ?? 50, 'outcome', scoreDelta,
              );
              if (adjustedScore !== insight.impactScore) {
                upsertInsight({
                  ...cloneInsightParams(insight),
                  data: newData,
                  impactScore: adjustedScore,
                });
                modified++;
              }
            }
          }
          return modified;
        });
        return { modified: modifiedCount };
      });
    }
  }

  return rowToActionOutcome(outcome);
}

export function getOutcomesForAction(actionId: string): ActionOutcome[] {
  const rows = stmts().getOutcomesByAction.all(actionId) as ActionOutcomeRow[];
  return rows.map(rowToActionOutcome);
}

export function getWorkspaceCounts(workspaceId: string): { total: number; scored: number; pending: number } {
  const row = stmts().countByWorkspace.get(workspaceId) as { total: number; scored: number; pending: number } | undefined;
  return row ?? { total: 0, scored: 0, pending: 0 };
}

export function getRecentActions(workspaceId: string, limit = 50): TrackedAction[] {
  const rows = stmts().getRecentByWorkspace.all(workspaceId, limit) as TrackedActionRow[];
  return rows.map(rowToTrackedAction);
}

/** Win scores that qualify an outcome as a win for the RECENT WINS section. */
export const WIN_SCORES: OutcomeScore[] = ['strong_win', 'win'];

/**
 * Core wins computation from a pre-fetched actions list.
 * Used by getTopWinsForWorkspace and by assembleLearnings (which already holds the actions
 * list from the weCalledIt loop, avoiding a second getActionsByWorkspace call).
 *
 * @param getOutcomes Optional outcomes accessor. When provided (e.g. a memoized wrapper in
 *   assembleLearnings), the caller controls caching so the same action's outcomes are never
 *   fetched twice across multiple loops. Without it, getOutcomesForAction is called per-action.
 */
export function getTopWinsFromActions(
  actions: TrackedAction[],
  limit = 10,
  getOutcomes?: (actionId: string) => ActionOutcome[],
): TopWin[] {
  const fetchOutcomes = getOutcomes ?? getOutcomesForAction;
  const wins: TopWin[] = [];

  // A1: an unexecuted suggestion is not a win anywhere. `not_acted_on` actions are
  // proposals the workspace never acted on; any outcome attached to them is a measure
  // of what would have happened, not of work we did. Excluding them here covers every
  // wins surface in one place — the admin overview/top-wins/client "we called it"
  // routes (getTopWinsForWorkspace) AND the intelligence slice's topWins — so no
  // caller can resurrect a phantom win by forgetting the filter.
  const executedActions = actions.filter(a => a.attribution !== 'not_acted_on');

  // Iterate the full capped set before sorting — an early break here would mean sort()
  // only operates on whichever wins appeared first chronologically, not highest-impact.
  // limit is enforced via slice(0, limit) after the sort below.
  for (const action of executedActions.slice(0, 50)) { // guard: cap N+1 queries for large workspaces
    const outcomes = fetchOutcomes(action.id);
    for (const outcome of outcomes) {
      if (outcome.score && WIN_SCORES.includes(outcome.score)) {
        wins.push({
          actionId: action.id,
          actionType: action.actionType,
          pageUrl: action.pageUrl,
          targetKeyword: action.targetKeyword,
          delta: outcome.deltaSummary,
          score: outcome.score,
          createdAt: action.createdAt,
          scoredAt: outcome.measuredAt ?? action.updatedAt,
        });
      }
    }
  }

  wins.sort((a, b) => Math.abs(b.delta.delta_percent) - Math.abs(a.delta.delta_percent));
  return wins.slice(0, limit);
}

/**
 * Returns top wins for a workspace sorted by absolute delta (highest impact first).
 * Extracted from routes/outcomes.ts so the intelligence assembler can use it.
 * For callers that already hold the actions list, use getTopWinsFromActions directly.
 */
export function getTopWinsForWorkspace(workspaceId: string, limit = 10): TopWin[] {
  return getTopWinsFromActions(getActionsByWorkspace(workspaceId), limit);
}

/**
 * Builds ROI highlights for a workspace from the live action_outcomes table.
 * Replaces getROIHighlights() from the dead roi_attributions table (Task 2.3).
 * Returns win-scored outcomes ordered by recency, shaped as ROIHighlight.
 * clicksGained is taken from deltaSummary.delta_absolute when primary_metric is clicks;
 * falls back to 0 for non-clicks metrics so the field is always a number.
 */
export function getROIHighlightsFromOutcomes(workspaceId: string, limit = 10): ROIHighlight[] {
  interface WinRow extends ActionOutcomeRow {
    page_url: string | null;
    action_type: string;
  }
  const rows = stmts().getWinsWithValueByWorkspace.all(workspaceId, limit) as WinRow[];
  return rows.map(row => {
    const delta = parseJsonFallback<{
      primary_metric?: string;
      delta_absolute?: number;
      delta_percent?: number;
      direction?: string;
    }>(row.delta_summary, {});

    const clicksGained =
      delta.primary_metric === 'clicks' && typeof delta.delta_absolute === 'number'
        ? delta.delta_absolute
        : 0;

    const pageUrl = row.page_url ?? '';
    const pageTitle = pageUrl
      ? (pageUrl.split('/').filter(Boolean).pop() ?? 'Home')
          .split('-').map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
      : 'Site';

    const actionLabel: Record<string, string> = {
      content_published: 'Content published',
      content_refreshed: 'Content refresh',
      meta_updated: 'Meta update applied',
      schema_deployed: 'Schema markup added',
      audit_fix_applied: 'SEO fix applied',
      internal_link_added: 'Internal link added',
      brief_created: 'Brief created',
      strategy_keyword_added: 'Keyword strategy update',
      insight_acted_on: 'Insight acted on',
      voice_calibrated: 'Voice calibrated',
    };
    const action = actionLabel[row.action_type] ?? row.action_type;

    const scoreLabel: Record<string, string> = {
      strong_win: 'Strong win',
      win: 'Win',
    };
    const scoreText = scoreLabel[row.score ?? ''] ?? 'Improvement';
    const deltaText =
      typeof delta.delta_percent === 'number'
        ? ` (+${Math.round(Math.abs(delta.delta_percent))}%)`
        : '';
    const result = `${scoreText}${deltaText}`;

    const attributedValue = typeof row.attributed_value === 'number' ? row.attributed_value : null;

    return { pageTitle, pageUrl, action, result, clicksGained, attributedValue };
  });
}

/** A conclusive scored outcome carrying a realized attributed_value. Read-only
 *  input to the OV realized-$ calibration (server/scoring/ov-calibration.ts). */
export interface CalibrationOutcome {
  score: OutcomeScore;
  attributedValue: number;
  actionType: string;
  /** SEO Gen-Quality P4: the OV predicted EMV snapshotted at recordAction time (CPC-proxy
   *  placeholder; null when none was available). P6 pairs this with attributedValue to learn
   *  the realized-vs-predicted calibration multiplier. P4 does NOT change the calibration
   *  basis — it only carries the field so the data accrues. */
  predictedEmv: number | null;
}

/**
 * Conclusive scored outcomes (one per action, highest checkpoint) that carry a
 * realized attributed_value for a workspace. Independent read path — does NOT
 * touch the legacy buildOutcomeAdjustment win-rate calibration.
 */
export function getCalibrationOutcomes(workspaceId: string): CalibrationOutcome[] {
  const rows = stmts().getCalibrationOutcomesByWorkspace.all(workspaceId) as Array<{
    score: string | null;
    attributed_value: number | null;
    action_type: string;
    predicted_emv: number | null;
  }>;
  return rows
    .filter((r): r is { score: string; attributed_value: number; action_type: string; predicted_emv: number | null } =>
      r.score != null && typeof r.attributed_value === 'number' && Number.isFinite(r.attributed_value))
    .map(r => ({ score: r.score as OutcomeScore, attributedValue: r.attributed_value, actionType: r.action_type, predictedEmv: r.predicted_emv ?? null }));
}

export function archiveOldActions(): { archived: number } {
  const doArchive = db.transaction(() => {
    const archiveResult = stmts().archiveOld.run();
    if (archiveResult.changes > 0) {
      stmts().archiveOldOutcomes.run();
      stmts().deleteArchived.run(); // CASCADE removes action_outcomes rows
    }
    return archiveResult.changes;
  });

  const archived = doArchive();
  if (archived > 0) {
    log.info({ archived }, 'Archived old tracked actions');
  }
  return { archived };
}
