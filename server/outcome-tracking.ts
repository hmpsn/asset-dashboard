// server/outcome-tracking.ts
// Core outcome tracking: recording actions, querying, and outcome storage

import crypto from 'node:crypto';
import db from './db/index.js';
import { createStmtCache } from './db/stmt-cache.js';
import { createLogger } from './logger.js';
import { rowToTrackedAction, rowToActionOutcome } from './db/outcome-mappers.js';
import type { TrackedActionRow, ActionOutcomeRow } from './db/outcome-mappers.js';
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
} from '../shared/types/outcome-tracking.js';
import { fireBridge, withWorkspaceLock, debouncedOutcomeReweight } from './bridge-infrastructure.js';
import { broadcastToWorkspace } from './broadcast.js';
import { WS_EVENTS } from './ws-events.js';

const log = createLogger('outcome-tracking');

const stmts = createStmtCache(() => ({
  insert: db.prepare(`
    INSERT INTO tracked_actions (id, workspace_id, action_type, source_type, source_id, page_url, target_keyword, baseline_snapshot, trailing_history, attribution, measurement_window, source_flag, baseline_confidence, context, created_at, updated_at)
    VALUES (@id, @workspace_id, @action_type, @source_type, @source_id, @page_url, @target_keyword, @baseline_snapshot, @trailing_history, @attribution, @measurement_window, @source_flag, @baseline_confidence, @context, @created_at, @updated_at)
  `),
  getById: db.prepare(`SELECT * FROM tracked_actions WHERE id = ?`),
  getByWorkspace: db.prepare(`SELECT * FROM tracked_actions WHERE workspace_id = ? ORDER BY created_at DESC`),
  getByWorkspaceAndType: db.prepare(`SELECT * FROM tracked_actions WHERE workspace_id = ? AND action_type = ? ORDER BY created_at DESC`),
  getByWorkspaceAndPage: db.prepare(`SELECT * FROM tracked_actions WHERE workspace_id = ? AND page_url = ? ORDER BY created_at DESC`),
  getBySourceTypeAndId: db.prepare(`SELECT * FROM tracked_actions WHERE source_type = ? AND source_id = ?`),
  getByWorkspaceAndSource: db.prepare(`SELECT * FROM tracked_actions WHERE workspace_id = ? AND source_type = ? AND source_id = ?`),
  getPendingMeasurement: db.prepare(`SELECT * FROM tracked_actions WHERE measurement_complete = 0`),
  getNotActedOn: db.prepare(`SELECT * FROM tracked_actions WHERE attribution = 'not_acted_on' AND measurement_complete = 0`),
  updateAttribution: db.prepare(`UPDATE tracked_actions SET attribution = ?, updated_at = datetime('now') WHERE id = ?`),
  markComplete: db.prepare(`UPDATE tracked_actions SET measurement_complete = 1, updated_at = datetime('now') WHERE id = ?`),
  updateContext: db.prepare(`UPDATE tracked_actions SET context = ?, updated_at = datetime('now') WHERE id = ?`),
  updateBaseline: db.prepare(`UPDATE tracked_actions SET baseline_snapshot = ?, updated_at = datetime('now') WHERE id = ?`),
  insertOutcome: db.prepare(`
    INSERT OR REPLACE INTO action_outcomes (id, action_id, checkpoint_days, metrics_snapshot, score, early_signal, delta_summary, competitor_context, measured_at)
    VALUES (@id, @action_id, @checkpoint_days, @metrics_snapshot, @score, @early_signal, @delta_summary, @competitor_context, @measured_at)
  `),
  getOutcomesByAction: db.prepare(`SELECT * FROM action_outcomes WHERE action_id = ? ORDER BY checkpoint_days ASC`),
  getScoredByWorkspace: db.prepare(`
    SELECT ta.*, ao.score AS outcome_score, ao.checkpoint_days AS outcome_checkpoint_days, ao.delta_summary AS outcome_delta_summary, ao.measured_at AS scored_at
    FROM tracked_actions ta
    JOIN action_outcomes ao ON ao.action_id = ta.id
    WHERE ta.workspace_id = ? AND ao.score IS NOT NULL AND ao.score NOT IN ('insufficient_data', 'inconclusive')
    ORDER BY ao.measured_at DESC
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
  archiveOld: db.prepare(`
    INSERT INTO tracked_actions_archive SELECT *, datetime('now') AS archived_at
    FROM tracked_actions
    WHERE measurement_complete = 1 AND updated_at < datetime('now', '-24 months')
  `),
  deleteArchived: db.prepare(`
    DELETE FROM tracked_actions
    WHERE measurement_complete = 1 AND updated_at < datetime('now', '-24 months')
  `),
  archiveOldOutcomes: db.prepare(`
    INSERT INTO action_outcomes_archive SELECT *, datetime('now') AS archived_at
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
    const { getInsights, resolveInsight } = await import('./analytics-insights-store.js');
    if (!params.pageUrl && !params.targetKeyword) return;
    const insights = getInsights(params.workspaceId);
    const related = insights.filter(i =>
      (params.pageUrl && i.pageId === params.pageUrl) ||
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
    if (related.length > 0) {
      broadcastToWorkspace(params.workspaceId, WS_EVENTS.INSIGHT_BRIDGE_UPDATED, {
        bridge: 'bridge_7_auto_resolve',
        count: related.length,
      });
    }
  });

  // ── Bridge #13: Create analytics annotation ───────────────────────
  fireBridge('bridge-action-annotation', params.workspaceId, async () => {
    const { createAnnotation } = await import('./analytics-annotations.js');
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

export function updateAttribution(actionId: string, attribution: Attribution): void {
  stmts().updateAttribution.run(attribution, actionId);
}

export function markActionComplete(actionId: string): void {
  stmts().markComplete.run(actionId);
}

export function updateActionContext(actionId: string, context: ActionContext): void {
  stmts().updateContext.run(JSON.stringify(context), actionId);
}

export function updateBaselineSnapshot(actionId: string, snapshot: BaselineSnapshot): void {
  stmts().updateBaseline.run(JSON.stringify(snapshot), actionId);
}

export function recordOutcome(params: {
  actionId: string;
  checkpointDays: 7 | 30 | 60 | 90;
  metricsSnapshot: BaselineSnapshot;
  score: OutcomeScore | null;
  earlySignal?: EarlySignal;
  deltaSummary: DeltaSummary;
  competitorContext?: object | null;
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
    });

    // Mark action complete after 90-day checkpoint
    if (params.checkpointDays === 90) {
      stmts().markComplete.run(params.actionId);
    }
  });

  doRecord();

  const rows = stmts().getOutcomesByAction.all(params.actionId) as ActionOutcomeRow[];
  const outcome = rows.find(r => r.checkpoint_days === params.checkpointDays);
  if (!outcome) throw new Error(`Failed to read back outcome for action ${params.actionId}`);

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
          const { getInsights, upsertInsight } = await import('./analytics-insights-store.js');
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
              // IDEMPOTENT: compute from the base score (before any outcome adjustment),
              // not the current impactScore which may already include a previous adjustment.
              // Store _outcomeBaseScore in data JSON so repeated invocations produce the same result.
              const dataObj = (insight.data ?? {}) as Record<string, unknown>;
              const baseScore = (typeof dataObj._outcomeBaseScore === 'number')
                ? dataObj._outcomeBaseScore
                : (insight.impactScore ?? 50);
              const adjusted = Math.max(0, Math.min(100, baseScore + scoreDelta));
              upsertInsight({
                workspaceId: insight.workspaceId,
                pageId: insight.pageId,
                insightType: insight.insightType,
                data: { ...dataObj, _outcomeBaseScore: baseScore },
                severity: insight.severity,
                pageTitle: insight.pageTitle,
                strategyKeyword: insight.strategyKeyword,
                strategyAlignment: insight.strategyAlignment,
                auditIssues: insight.auditIssues,
                pipelineStatus: insight.pipelineStatus,
                anomalyLinked: insight.anomalyLinked,
                impactScore: adjusted,
                domain: insight.domain,
              });
              modified++;
            }
          }
          return modified;
        });

        if (modifiedCount > 0) {
          const { broadcastToWorkspace: broadcast } = await import('./broadcast.js');
          const { WS_EVENTS: WS } = await import('./ws-events.js');
          broadcast(workspaceId, WS.INSIGHT_BRIDGE_UPDATED, { bridge: 'bridge_1_outcome_reweight' });
        }
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
