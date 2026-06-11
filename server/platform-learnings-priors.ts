// server/platform-learnings-priors.ts
// A6 (audit #22) — anonymized cross-workspace win-rate priors.
//
// Aggregates a single platform-wide win rate PER action type across ALL workspaces,
// from the same tracked_actions + action_outcomes join that computeWorkspaceLearnings
// reads per workspace. Recomputed by the weekly cron in server/outcome-crons.ts.
//
// PURPOSE — the no_data/degraded FALLBACK tier. When a workspace has not yet
// accumulated its own measured outcomes (LearningsSlice.availability === 'no_data')
// or the learnings subsystem failed for a run ('degraded'), consumers may now receive
// a platform-level prior — a clearly-labeled cross-workspace benchmark — instead of
// nothing. LearningsSlice.availability stays AUTHORITATIVE: a workspace with
// availability 'ready' keeps its own learnings and never sees a platform prior.
//
// ANONYMIZATION IS THE REVIEW AXIS (pattern precedent: keyword_metrics_cache):
//  - Stored rows hold ZERO workspace-identifying data — no workspace ids, titles,
//    URLs, or keywords. A row is a pure aggregate keyed only on action_type.
//  - COHORT FLOOR: a prior is published only when >= MIN_COHORT_WORKSPACES distinct
//    workspaces contributed scored outcomes for that action type. Below the floor the
//    row is NOT inserted, so a single workspace's data can never be reverse-identified
//    (FM-2: insufficient cohort -> absent, never a fabricated baseline).
//  - SAMPLE FLOOR: >= MIN_PRIOR_SAMPLES total scored actions behind the rate.
//
// A1 honesty inputs (mirror computeWorkspaceLearnings exactly, applied cross-workspace):
//  - attribution='not_acted_on' actions are EXCLUDED — they were never executed, so
//    scoring them fabricates wins/losses.
//  - only the latest qualifying 30/60/90-day outcome per action counts, and only when
//    its score is conclusive (not insufficient_data / inconclusive). A 30+60+90 action
//    contributes exactly one win/loss, not three.
//
// The platform_learnings_priors table (migration 133) is a fully DERIVED snapshot —
// every run recomputes ALL rows inside one transaction (delete + reinsert; no
// user-authored metadata to preserve). Not workspace-scoped; no broadcast /
// intelligence invalidation (the weekly slice rebuild picks up new priors).

import db from './db/index.js';
import { createStmtCache } from './db/stmt-cache.js';
import { createLogger } from './logger.js';
import type { ActionType } from '../shared/types/outcome-tracking.js';
import type { PlatformPriorEntry } from '../shared/types/intelligence.js';

const log = createLogger('platform-learnings-priors');

/**
 * Minimum DISTINCT workspaces that must contribute scored outcomes before a prior is
 * published. The anonymization floor — below 3 workspaces an aggregate can leak a
 * single workspace's specifics (with 2, one party can subtract its own data to
 * recover the other's). Never lower this without a privacy review.
 */
export const MIN_COHORT_WORKSPACES = 3;

/**
 * Minimum total scored actions behind a published rate. Mirrors the EMV
 * MIN_CALIBRATION_PAIRS floor so a prior is statistically meaningful, not a coin flip.
 */
export const MIN_PRIOR_SAMPLES = 5;

// ─── Types (DB column + mapper lockstep with migration 133) ──────────────────

export interface PlatformLearningsPriorRow {
  action_type: string;
  win_rate: number;
  contributing_workspaces: number;
  scored_actions: number;
  computed_at: string;
}

export function rowToPlatformPrior(row: PlatformLearningsPriorRow): PlatformPriorEntry {
  return {
    actionType: row.action_type,
    winRate: row.win_rate,
    contributingWorkspaces: row.contributing_workspaces,
    scoredActions: row.scored_actions,
  };
}

// ─── Prepared statements ──────────────────────────────────────────────────────

const stmts = createStmtCache(() => ({
  // One conclusive outcome per action (the latest qualifying checkpoint — same MAX
  // dedup shape as computeWorkspaceLearnings, so a 30+60+90 action is one row), with
  // its workspace_id and a win flag. not_acted_on excluded (A1). Cross-workspace — no
  // workspace filter; the workspace_id is read only to COUNT distinct contributors and
  // is never persisted.
  scoredOutcomes: db.prepare(`
    SELECT ta.workspace_id AS workspace_id,
           ta.action_type AS action_type,
           CASE WHEN ao.score IN ('win', 'strong_win') THEN 1 ELSE 0 END AS is_win
    FROM action_outcomes ao
    JOIN tracked_actions ta ON ta.id = ao.action_id
    WHERE ta.attribution != 'not_acted_on'
      AND ao.score IS NOT NULL
      AND ao.score NOT IN ('insufficient_data', 'inconclusive')
      AND ao.checkpoint_days IN (30, 60, 90)
      AND ao.checkpoint_days = (
        SELECT MAX(ao2.checkpoint_days)
        FROM action_outcomes ao2
        WHERE ao2.action_id = ao.action_id
          AND ao2.score IS NOT NULL
          AND ao2.score NOT IN ('insufficient_data', 'inconclusive')
          AND ao2.checkpoint_days IN (30, 60, 90)
      )
  `),
  deleteAll: db.prepare(`DELETE FROM platform_learnings_priors`),
  insertEntry: db.prepare(`
    INSERT INTO platform_learnings_priors
      (action_type, win_rate, contributing_workspaces, scored_actions, computed_at)
    VALUES
      (@action_type, @win_rate, @contributing_workspaces, @scored_actions, @computed_at)
  `),
  getAll: db.prepare(`SELECT * FROM platform_learnings_priors ORDER BY action_type ASC`),
}));

interface ScoredOutcomeRow {
  workspace_id: string;
  action_type: string;
  is_win: number;
}

// ─── Recompute ──────────────────────────────────────────────────────────────

interface PerTypeAccumulator {
  wins: number;
  total: number;
  workspaces: Set<string>;
}

export interface PlatformPriorsRunResult {
  publishedEntries: number;
  suppressedBelowFloor: number;
}

/**
 * Recompute the platform-wide priors from every workspace's scored outcomes. Fully
 * replaces all rows inside one transaction. Only action types that clear BOTH the
 * cohort and sample floors are published (FM-2: below either floor -> absent).
 */
export function recomputePlatformPriors(): PlatformPriorsRunResult {
  const byType = new Map<string, PerTypeAccumulator>();
  const rows = stmts().scoredOutcomes.all() as ScoredOutcomeRow[];
  for (const row of rows) {
    let acc = byType.get(row.action_type);
    if (!acc) {
      acc = { wins: 0, total: 0, workspaces: new Set<string>() };
      byType.set(row.action_type, acc);
    }
    acc.total += 1;
    if (row.is_win === 1) acc.wins += 1;
    acc.workspaces.add(row.workspace_id);
  }

  const computedAt = new Date().toISOString();
  let publishedEntries = 0;
  let suppressedBelowFloor = 0;

  const run = db.transaction(() => {
    stmts().deleteAll.run();
    for (const [actionType, acc] of byType) {
      const cohort = acc.workspaces.size;
      if (cohort < MIN_COHORT_WORKSPACES || acc.total < MIN_PRIOR_SAMPLES) {
        suppressedBelowFloor += 1;
        continue;
      }
      stmts().insertEntry.run({
        action_type: actionType,
        win_rate: acc.wins / acc.total,
        contributing_workspaces: cohort,
        scored_actions: acc.total,
        computed_at: computedAt,
      });
      publishedEntries += 1;
    }
  });
  run();

  log.info({ publishedEntries, suppressedBelowFloor }, 'recomputePlatformPriors complete');
  return { publishedEntries, suppressedBelowFloor };
}

// ─── Public read API ──────────────────────────────────────────────────────────

/** All published platform priors (already past both floors). */
export function getPlatformPriors(): PlatformPriorEntry[] {
  const rows = stmts().getAll.all() as PlatformLearningsPriorRow[];
  return rows.map(rowToPlatformPrior);
}

/**
 * The platform win rate for one action type, or null when no prior cleared the floors
 * for it (FM-2: absence, never a fabricated baseline). Consumed by the fallback seam in
 * server/outcome-learning-default-path.ts.
 */
export function getPlatformPriorWinRate(actionType: ActionType): number | null {
  const priors = getPlatformPriors();
  const match = priors.find(p => p.actionType === actionType);
  return match ? match.winRate : null;
}
