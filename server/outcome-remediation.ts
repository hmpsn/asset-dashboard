// server/outcome-remediation.ts
// One-time historical-pollution remediation for outcome tracking (A1 audit #1).
//
// Two corrupted populations survive A1's go-forward fixes because they were written
// to disk by older logic, and the dedup keys (source_type+source_id) mean the broken
// rows can never be recreated correctly by re-running the backfill:
//
//   (a) Mislabeled backfill actions — backfillCompletedRecommendations USED to hardcode
//       actionType:'audit_fix_applied' for EVERY completed recommendation. A completed
//       `content` / `metadata` / `schema` rec all landed under audit_fix_applied, so
//       winRateByActionType / winRateByFixType are calibrated on the wrong action type.
//
//   (b) Phantom-metric outcomes — neutral/loss verdicts whose deltaSummary.primary_metric
//       is not a real BaselineSnapshot key (e.g. click_recovery, target_improvement,
//       content_produced). computeDelta read the missing key as 0, the delta was 0, and
//       the action fabricated a neutral/loss for a metric never measured. The A1 guard
//       (isMetricPresent) stops NEW ones; this remediation fixes the EXISTING rows.
//
// Both passes are idempotent by CONSTRUCTION, not by a marker: pass (a) only matches
// rows still labeled audit_fix_applied whose rec maps elsewhere — once relabeled they no
// longer match; pass (b) only matches neutral/loss outcomes with a phantom metric — once
// re-marked inconclusive they no longer match. A second run is therefore a natural no-op.
// This follows the established CAS-guarded idempotent startup-pass pattern (see
// migrateSiteKeywordMetricsFromBlob et al. wired in server/index.ts).

import db from './db/index.js';
import { createStmtCache } from './db/stmt-cache.js';
import { parseJsonFallback } from './db/json-validation.js';
import { createLogger } from './logger.js';
import { recommendationOutcomeActionType } from './domains/recommendations/outcome-action-type.js';
import { loadRecommendationSet } from './domains/recommendations/storage.js';
import type { RecType } from '../shared/types/recommendations.js';

const log = createLogger('outcome-remediation');

// Real metric keys that a BaselineSnapshot can carry. A delta_summary.primary_metric
// outside this set is "phantom" — it was never captured, so the recorded neutral/loss
// verdict is fabricated. Kept in lockstep with BaselineSnapshot in
// shared/types/outcome-tracking.ts (numeric metric fields only).
const REAL_METRIC_KEYS = new Set<string>([
  'position',
  'clicks',
  'impressions',
  'ctr',
  'sessions',
  'bounce_rate',
  'engagement_rate',
  'conversions',
  'page_health_score',
  'voice_score',
]);

interface RecommendationActionRow {
  id: string;
  workspace_id: string;
  source_id: string | null;
}

interface PhantomOutcomeRow {
  id: string;
  delta_summary: string;
  score: string;
}

const stmts = createStmtCache(() => ({
  // Actions backfilled from recommendations that are still labeled audit_fix_applied.
  mislabeledRecActions: db.prepare(`
    SELECT id, workspace_id, source_id
    FROM tracked_actions
    WHERE source_type = 'recommendation' AND action_type = 'audit_fix_applied'
  `),
  relabelAction: db.prepare(`
    UPDATE tracked_actions
    SET action_type = ?, updated_at = datetime('now')
    WHERE id = ? AND workspace_id = ?
  `),
  // Scored verdicts that could be phantom: only neutral/loss can be a fabricated verdict
  // (wins are real signal regardless; insufficient_data/inconclusive are already honest).
  scoredNeutralLossOutcomes: db.prepare(`
    SELECT id, delta_summary, score
    FROM action_outcomes
    WHERE score IN ('neutral', 'loss')
  `),
  remarkOutcomeInconclusive: db.prepare(`
    UPDATE action_outcomes
    SET score = 'inconclusive'
    WHERE id = ?
  `),
}));

/**
 * Pass (a): relabel recommendation-sourced tracked actions that were hardcoded to
 * audit_fix_applied by the pre-A1 backfill. Joins each action's source_id back to the
 * current recommendation read model and re-derives the correct ActionType via the same
 * recommendationOutcomeActionType mapping the fixed backfill now uses.
 *
 * - A rec that genuinely maps to audit_fix_applied (technical/performance/etc.) is left
 *   untouched (no-op UPDATE avoided).
 * - A rec that no longer exists (deleted/regenerated set) is left as-is and logged — we
 *   cannot know its original type, and audit_fix_applied is the historical default.
 *
 * @returns number of actions relabeled.
 */
export function remediateMislabeledRecommendationActions(): number {
  const actions = stmts().mislabeledRecActions.all() as RecommendationActionRow[];
  if (actions.length === 0) return 0;

  // Build a per-workspace rec-id → {type, source} index, parsing each workspace's
  // recommendation set at most once.
  const recIndexByWorkspace = new Map<string, Map<string, { type?: string; source?: string }>>();
  const getRecIndex = (workspaceId: string): Map<string, { type?: string; source?: string }> => {
    const cached = recIndexByWorkspace.get(workspaceId);
    if (cached) return cached;
    const index = new Map<string, { type?: string; source?: string }>();
    const set = loadRecommendationSet(workspaceId);
    if (set) {
      for (const rec of set.recommendations) {
        index.set(rec.id, { type: rec.type, source: rec.source });
      }
    }
    recIndexByWorkspace.set(workspaceId, index);
    return index;
  };

  let relabeled = 0;
  let missingRec = 0;

  const run = db.transaction(() => {
    for (const action of actions) {
      const recId = action.source_id?.trim();
      if (!recId) continue;
      const rec = getRecIndex(action.workspace_id).get(recId);
      if (!rec) {
        // Rec no longer exists — cannot re-derive its type. Leave + log (no oracle).
        missingRec++;
        continue;
      }
      if (!rec.type) continue; // legacy rec without a type: audit_fix_applied is correct.
      const correct = recommendationOutcomeActionType(rec.type as RecType, rec.source ?? '');
      if (correct !== 'audit_fix_applied') {
        stmts().relabelAction.run(correct, action.id, action.workspace_id);
        relabeled++;
      }
    }
  });
  run();

  if (relabeled > 0 || missingRec > 0) {
    log.info(
      { relabeled, missingRec, candidates: actions.length },
      'Remediated mislabeled recommendation-sourced actions (audit_fix_applied → mapped type)',
    );
  }
  return relabeled;
}

/**
 * Pass (b): re-mark neutral/loss outcomes whose delta_summary.primary_metric is not a
 * real BaselineSnapshot key. These verdicts were fabricated (computeDelta read the
 * missing key as 0). They become `inconclusive`, matching what the A1 phantom-metric
 * guard now records for new outcomes.
 *
 * @returns number of outcomes re-marked inconclusive.
 */
export function remediatePhantomMetricOutcomes(): number {
  const outcomes = stmts().scoredNeutralLossOutcomes.all() as PhantomOutcomeRow[];
  if (outcomes.length === 0) return 0;

  let remarked = 0;
  const run = db.transaction(() => {
    for (const outcome of outcomes) {
      const delta = parseJsonFallback<{ primary_metric?: unknown }>(outcome.delta_summary, {});
      const metric = typeof delta.primary_metric === 'string' ? delta.primary_metric : '';
      // Empty metric means we cannot prove it phantom — leave it (conservative).
      if (!metric || REAL_METRIC_KEYS.has(metric)) continue;
      stmts().remarkOutcomeInconclusive.run(outcome.id);
      remarked++;
    }
  });
  run();

  if (remarked > 0) {
    log.info({ remarked, candidates: outcomes.length }, 'Remediated phantom-metric outcomes (neutral/loss → inconclusive)');
  }
  return remarked;
}

/**
 * Run the full one-time historical remediation. Idempotent by construction — safe to
 * call on every startup; a second run is a natural no-op. Wired in server/index.ts.
 */
export function runOutcomeRemediation(): { relabeledActions: number; remarkedOutcomes: number } {
  let relabeledActions = 0;
  let remarkedOutcomes = 0;
  try {
    relabeledActions = remediateMislabeledRecommendationActions();
  } catch (err) {
    log.error({ err }, 'remediateMislabeledRecommendationActions failed — continuing');
  }
  try {
    remarkedOutcomes = remediatePhantomMetricOutcomes();
  } catch (err) {
    log.error({ err }, 'remediatePhantomMetricOutcomes failed — continuing');
  }
  return { relabeledActions, remarkedOutcomes };
}
