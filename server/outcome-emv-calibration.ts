// server/outcome-emv-calibration.ts
// A5 (audit #20) — the scheduled P6 realized-vs-predicted calibration job + effort priors.
//
// Recomputes, per (workspace, action_type), two derived calibration signals from the
// predictedEmv snapshots that recordAction captures at completion time:
//
//  1. REALIZED-VS-PREDICTED RATIO — median(action_outcomes.attributed_value /
//     tracked_actions.predicted_emv) over conclusive, executed outcomes. This is the
//     pairing ov-calibration.ts:32-36 documents as the P6 basis flip: when
//     computeOvCalibration moves off the win-rate proxy, it consumes
//     getEmvCalibrationForWorkspace() instead of re-deriving pairs. `conclusive`
//     requires >= MIN_CALIBRATION_PAIRS pairs; below that the row is honestly
//     `inconclusive` with a NULL ratio (FM-2: missing data is never fabricated).
//
//  2. EFFORT PRIORS — median days from rec creation (recommendation read-model createdAt) to action
//     creation (tracked_actions.created_at — recordAction fires at completion time) per
//     action type. This is the "P5 derives real time-to-implement from action_outcomes
//     once history accrues" calibration path on DEFAULT_EFFORT_DAYS
//     (scoring/opportunity-value.ts:40). Consumers read getEffortPriorDays(); SEO Decision
//     Engine P2 threads this prior into OpportunityInput.effortDays at all 16
//     computeOpportunityValue call sites in recommendations.ts (via effortDaysFor()). It
//     overrides the per-branch DEFAULT_EFFORT_DAYS but is inert until >= MIN_EFFORT_SAMPLES
//     outcomes accrue (byte-identical fallback), and affects only ranking (roiPerEffortDay),
//     never predictedEmv. The realized/predicted calibration-BASIS swap (signal #1) remains
//     deferred pending GA4 revenue grounding.
//
// Honesty filters (A1 semantics):
//  - attribution='not_acted_on' contributes to NEITHER signal — an unexecuted
//    suggestion's outcome measures what would have happened, not realized value, and
//    its timestamps measure nothing we did.
//  - predicted_emv must be > 0 for a ratio pair (0 is the legacy zod round-trip
//    default meaning "unknown", and a 0 denominator is meaningless).
//  - effort samples require source_flag='live' AND attribution='platform_executed':
//    a backfilled action's created_at is the backfill RUN time, not completion time,
//    and externally executed completions carry detection lag — both would corrupt
//    the median.
//
// Scheduling: registered as a weekly server cron in server/outcome-crons.ts (the
// outcome-cron pattern — dynamic import, try/catch, startup timeout). It is scheduled
// platform maintenance, NOT user-triggered admin generation, so it lives here rather
// than the background job platform (no BACKGROUND_JOB_TYPES entry).
//
// The outcome_emv_calibration table (migration 131) is a fully derived snapshot —
// every run recomputes a workspace's rows inside one transaction (delete + reinsert;
// no user-authored metadata to preserve). Internal-only: no broadcast / intelligence
// invalidation until a slice or UI consumer exists.

import db from './db/index.js';
import { createStmtCache } from './db/stmt-cache.js';
import { createLogger } from './logger.js';
import { loadRecommendationSet } from './domains/recommendations/storage.js';
import type { ActionType } from '../shared/types/outcome-tracking.js';

const log = createLogger('outcome-emv-calibration');

/** Minimum realized/predicted pairs before a ratio is published (mirrors
 *  ov-calibration.ts MIN_OUTCOMES so the P6 basis flip keeps the same gate). */
export const MIN_CALIBRATION_PAIRS = 5;

/** Minimum live effort samples before a time-to-completion prior is published.
 *  Lower than the pair floor: effort accrues on every completed rec (no measured
 *  outcome required) and a median over 3 observations is already a usable PRIOR —
 *  it nudges a default, it does not gate scoring. */
export const MIN_EFFORT_SAMPLES = 3;

const DAY_MS = 24 * 60 * 60 * 1000;

// ─── Types (DB column + mapper lockstep with migration 131) ──────────────────

export interface OutcomeEmvCalibrationRow {
  workspace_id: string;
  action_type: string;
  status: string;
  pair_count: number;
  median_realization_ratio: number | null;
  effort_sample_count: number;
  median_effort_days: number | null;
  computed_at: string;
}

/** One per-(workspace, actionType) calibration snapshot. Server-internal for now —
 *  promote to shared/types/outcome-tracking.ts when a client/API surface appears. */
export interface EmvCalibrationEntry {
  workspaceId: string;
  actionType: ActionType;
  /** 'conclusive' only when pairCount >= MIN_CALIBRATION_PAIRS. */
  status: 'conclusive' | 'inconclusive';
  pairCount: number;
  /** median(attributed_value / predicted_emv); NULL when inconclusive — never fabricated. */
  medianRealizationRatio: number | null;
  effortSampleCount: number;
  /** Median observed days from rec creation to completion; NULL below MIN_EFFORT_SAMPLES. */
  medianEffortDays: number | null;
  computedAt: string;
}

export function rowToEmvCalibrationEntry(row: OutcomeEmvCalibrationRow): EmvCalibrationEntry {
  return {
    workspaceId: row.workspace_id,
    actionType: row.action_type as ActionType,
    status: row.status === 'conclusive' ? 'conclusive' : 'inconclusive',
    pairCount: row.pair_count,
    medianRealizationRatio: row.median_realization_ratio ?? null,
    effortSampleCount: row.effort_sample_count,
    medianEffortDays: row.median_effort_days ?? null,
    computedAt: row.computed_at,
  };
}

// ─── Prepared statements ──────────────────────────────────────────────────────

const stmts = createStmtCache(() => ({
  workspaceIdsWithActions: db.prepare(`SELECT DISTINCT workspace_id FROM tracked_actions`),
  // Realized/predicted pairs: ONE conclusive outcome per action (highest qualifying
  // checkpoint — the same dedup shape as getCalibrationOutcomesByWorkspace in
  // outcome-tracking.ts, so a 30+60 day action contributes one pair, not two).
  calibrationPairs: db.prepare(`
    SELECT ta.action_type AS action_type, ta.predicted_emv AS predicted_emv, ao.attributed_value AS attributed_value
    FROM action_outcomes ao
    JOIN tracked_actions ta ON ta.id = ao.action_id
    WHERE ta.workspace_id = ?
      AND ta.attribution != 'not_acted_on'
      AND ta.predicted_emv IS NOT NULL AND ta.predicted_emv > 0
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
  // Effort sample candidates: live, platform-executed, recommendation-sourced actions.
  // created_at is the completion timestamp (recordAction fires at completion); the
  // start timestamp comes from the recommendation read model's createdAt, joined in JS.
  effortCandidates: db.prepare(`
    SELECT action_type, source_id, created_at
    FROM tracked_actions
    WHERE workspace_id = ?
      AND source_type = 'recommendation'
      AND source_flag = 'live'
      AND attribution = 'platform_executed'
      AND source_id IS NOT NULL
  `),
  deleteForWorkspace: db.prepare(`DELETE FROM outcome_emv_calibration WHERE workspace_id = ?`),
  insertEntry: db.prepare(`
    INSERT INTO outcome_emv_calibration
      (workspace_id, action_type, status, pair_count, median_realization_ratio, effort_sample_count, median_effort_days, computed_at)
    VALUES
      (@workspace_id, @action_type, @status, @pair_count, @median_realization_ratio, @effort_sample_count, @median_effort_days, @computed_at)
  `),
  getByWorkspace: db.prepare(`SELECT * FROM outcome_emv_calibration WHERE workspace_id = ? ORDER BY action_type ASC`),
  effortPriors: db.prepare(`
    SELECT action_type, median_effort_days
    FROM outcome_emv_calibration
    WHERE workspace_id = ? AND median_effort_days IS NOT NULL
  `),
}));

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// ─── Per-workspace recompute ──────────────────────────────────────────────────

interface PairRow {
  action_type: string;
  predicted_emv: number;
  attributed_value: number;
}

interface EffortCandidateRow {
  action_type: string;
  source_id: string;
  created_at: string;
}

function recomputeWorkspace(workspaceId: string, computedAt: string): { conclusive: number; inconclusive: number } {
  // 1. Realized-vs-predicted ratio pairs, grouped by action type.
  const ratiosByType = new Map<string, number[]>();
  const pairs = stmts().calibrationPairs.all(workspaceId) as PairRow[];
  for (const pair of pairs) {
    if (!Number.isFinite(pair.attributed_value) || !Number.isFinite(pair.predicted_emv) || pair.predicted_emv <= 0) continue;
    const list = ratiosByType.get(pair.action_type) ?? [];
    list.push(pair.attributed_value / pair.predicted_emv);
    ratiosByType.set(pair.action_type, list);
  }

  // 2. Effort samples: recommendation createdAt → action created_at, grouped by action type.
  const effortByType = new Map<string, number[]>();
  const candidates = stmts().effortCandidates.all(workspaceId) as EffortCandidateRow[];
  if (candidates.length > 0) {
    const recCreatedAtById = new Map<string, number>();
    const set = loadRecommendationSet(workspaceId);
    if (set) {
      for (const rec of set.recommendations) {
        const ts = new Date(rec.createdAt).getTime();
        if (Number.isFinite(ts)) recCreatedAtById.set(rec.id, ts);
      }
    }
    for (const candidate of candidates) {
      const startMs = recCreatedAtById.get(candidate.source_id.trim());
      if (startMs == null) continue; // rec regenerated away — no start timestamp, skip (honest)
      const completedMs = new Date(candidate.created_at).getTime();
      if (!Number.isFinite(completedMs)) continue;
      const days = (completedMs - startMs) / DAY_MS;
      if (days < 0) continue; // clock skew / inconsistent read model — never emit a negative effort
      const list = effortByType.get(candidate.action_type) ?? [];
      list.push(days);
      effortByType.set(candidate.action_type, list);
    }
  }

  // 3. Persist one row per action type that has ANY signal (no junk rows for silent types).
  const actionTypes = new Set<string>([...ratiosByType.keys(), ...effortByType.keys()]);
  let conclusive = 0;
  let inconclusive = 0;

  const run = db.transaction(() => {
    stmts().deleteForWorkspace.run(workspaceId);
    for (const actionType of actionTypes) {
      const ratios = ratiosByType.get(actionType) ?? [];
      const efforts = effortByType.get(actionType) ?? [];
      const isConclusive = ratios.length >= MIN_CALIBRATION_PAIRS;
      if (isConclusive) conclusive++; else inconclusive++;
      stmts().insertEntry.run({
        workspace_id: workspaceId,
        action_type: actionType,
        status: isConclusive ? 'conclusive' : 'inconclusive',
        pair_count: ratios.length,
        median_realization_ratio: isConclusive ? median(ratios) : null,
        effort_sample_count: efforts.length,
        median_effort_days: efforts.length >= MIN_EFFORT_SAMPLES ? median(efforts) : null,
        computed_at: computedAt,
      });
    }
  });
  run();

  return { conclusive, inconclusive };
}

// ─── Public API ───────────────────────────────────────────────────────────────

export interface EmvCalibrationRunResult {
  workspacesProcessed: number;
  conclusiveEntries: number;
  inconclusiveEntries: number;
  errors: number;
}

/**
 * Recompute the realized-vs-predicted calibration + effort priors. With a workspaceId,
 * only that workspace; otherwise every workspace that has tracked actions. Safe to run
 * repeatedly — each run fully replaces a workspace's derived rows.
 */
export function runEmvCalibration(workspaceId?: string): EmvCalibrationRunResult {
  const workspaceIds: string[] = workspaceId
    ? [workspaceId]
    : (stmts().workspaceIdsWithActions.all() as Array<{ workspace_id: string }>).map(r => r.workspace_id);

  const computedAt = new Date().toISOString();
  const result: EmvCalibrationRunResult = { workspacesProcessed: 0, conclusiveEntries: 0, inconclusiveEntries: 0, errors: 0 };

  for (const wsId of workspaceIds) {
    try {
      const { conclusive, inconclusive } = recomputeWorkspace(wsId, computedAt);
      result.workspacesProcessed++;
      result.conclusiveEntries += conclusive;
      result.inconclusiveEntries += inconclusive;
    } catch (err) {
      result.errors++;
      log.error({ err, workspaceId: wsId }, 'EMV calibration recompute failed for workspace — skipping');
    }
  }

  log.info(result, 'runEmvCalibration complete');
  return result;
}

/** Calibration snapshot rows for a workspace (P6 ov-calibration basis-flip read path). */
export function getEmvCalibrationForWorkspace(workspaceId: string): EmvCalibrationEntry[] {
  const rows = stmts().getByWorkspace.all(workspaceId) as OutcomeEmvCalibrationRow[];
  return rows.map(rowToEmvCalibrationEntry);
}

/**
 * Observed time-to-completion priors (median days) per action type for a workspace.
 * Only action types that cleared MIN_EFFORT_SAMPLES appear — absence means "use the
 * platform default" (DEFAULT_EFFORT_DAYS in scoring/opportunity-value.ts), never 0.
 */
export function getEffortPriorDays(workspaceId: string): Partial<Record<ActionType, number>> {
  const rows = stmts().effortPriors.all(workspaceId) as Array<{ action_type: string; median_effort_days: number }>;
  const priors: Partial<Record<ActionType, number>> = {};
  for (const row of rows) {
    priors[row.action_type as ActionType] = row.median_effort_days;
  }
  return priors;
}
