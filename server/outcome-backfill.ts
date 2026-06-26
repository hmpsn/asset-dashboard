// server/outcome-backfill.ts
// Retroactively creates tracked actions from historical data so the system
// launches with months of learnings instead of starting from zero.

import db from './db/index.js';
import { createStmtCache } from './db/stmt-cache.js';
import { createLogger } from './logger.js';
import { recordAction, getActionBySource, fillPredictedEmvIfNull } from './outcome-tracking.js';
import { recommendationOutcomeActionType } from './recommendations.js';
import { loadRecommendationSet } from './domains/recommendations/storage.js';
import type { RecType } from '../shared/types/recommendations.js';

const log = createLogger('outcome-backfill');

// ─── DB row types ────────────────────────────────────────────────────────────

interface ContentPostRow {
  id: string;
  workspace_id: string;
  target_keyword: string | null;
  published_at: string | null;
}

interface AnalyticsInsightRow {
  id: string;
  workspace_id: string;
  page_id: string | null;
  resolution_status: string | null;
  resolved_at: string | null;
}

interface WorkspaceIdRow {
  id: string;
}

// ─── Prepared statement cache ────────────────────────────────────────────────

const stmts = createStmtCache(() => ({
  allWorkspaceIds: db.prepare(`SELECT id FROM workspaces`),
  publishedPosts: db.prepare(`
    SELECT id, workspace_id, target_keyword, published_at
    FROM content_posts
    WHERE workspace_id = ? AND published_at IS NOT NULL
  `),
  resolvedInsights: db.prepare(`
    SELECT id, workspace_id, page_id, resolution_status, resolved_at
    FROM analytics_insights
    WHERE workspace_id = ? AND resolution_status = 'resolved'
  `),
  // A5 repair pass: recommendation-sourced actions that never captured a predictedEmv
  // snapshot (pre-A5 backfill rows + live completions of opportunity-less recs).
  nullEmvRecActions: db.prepare(`
    SELECT id, source_id
    FROM tracked_actions
    WHERE workspace_id = ? AND source_type = 'recommendation' AND predicted_emv IS NULL
  `),
}));

// ─── Sub-backfill functions ───────────────────────────────────────────────────

/**
 * Backfill published content posts as 'content_published' actions.
 * Idempotent: skips any post that already has a tracked action via source_type='post'.
 */
export function backfillPublishedContent(workspaceId: string): number {
  const rows = stmts().publishedPosts.all(workspaceId) as ContentPostRow[];
  let count = 0;

  for (const post of rows) {
    try {
      const existing = getActionBySource('post', post.id);
      if (existing) continue;

      if (post.workspace_id) {
        recordAction({ // recordAction-ok: workspaceId guarded by if (post.workspace_id)
          workspaceId: post.workspace_id,
          actionType: 'content_published',
          sourceType: 'post',
          sourceId: post.id,
          pageUrl: null,
          targetKeyword: post.target_keyword ?? null,
          baselineSnapshot: {
            captured_at: post.published_at ?? new Date().toISOString(),
          },
          sourceFlag: 'backfill',
          baselineConfidence: 'estimated',
          attribution: 'platform_executed',
        });
        count++;
      }
    } catch (err) {
      log.warn(
        { err, workspaceId, postId: post.id },
        'Failed to backfill published content post — skipping'
      );
    }
  }

  log.info({ workspaceId, count }, 'backfillPublishedContent complete');
  return count;
}

/**
 * Backfill resolved analytics insights as 'insight_acted_on' actions.
 * Idempotent: skips insights that already have a tracked action via source_type='insight'.
 */
export function backfillResolvedInsights(workspaceId: string): number {
  const rows = stmts().resolvedInsights.all(workspaceId) as AnalyticsInsightRow[];
  let count = 0;

  for (const insight of rows) {
    try {
      const existing = getActionBySource('insight', insight.id);
      if (existing) continue;

      if (insight.workspace_id) {
        recordAction({ // recordAction-ok: workspaceId guarded by if (insight.workspace_id)
          workspaceId: insight.workspace_id,
          actionType: 'insight_acted_on',
          sourceType: 'insight',
          sourceId: insight.id,
          pageUrl: insight.page_id ?? null,
          targetKeyword: null,
          baselineSnapshot: {
            captured_at: insight.resolved_at ?? new Date().toISOString(),
          },
          sourceFlag: 'backfill',
          baselineConfidence: 'estimated',
          attribution: 'platform_executed',
        });
        count++;
      }
    } catch (err) {
      log.warn(
        { err, workspaceId, insightId: insight.id },
        'Failed to backfill resolved insight — skipping'
      );
    }
  }

  log.info({ workspaceId, count }, 'backfillResolvedInsights complete');
  return count;
}

/**
 * Backfill completed recommendations as 'audit_fix_applied' actions.
 * Recommendations are read through the canonical recommendation read model:
 * normalized rows are authoritative, with the legacy blob as fallback only.
 * Idempotent: skips recommendations that already have a tracked action via source_type='recommendation'.
 */
export function backfillCompletedRecommendations(workspaceId: string): number {
  const set = loadRecommendationSet(workspaceId);
  if (!set) return 0;

  const completed = set.recommendations.filter(r => r.status === 'completed');
  let count = 0;

  for (const rec of completed) {
    try {
      const recId = typeof rec.id === 'string' ? rec.id.trim() : '';
      if (!recId) {
        log.warn(
          { workspaceId, rec },
          'Skipping malformed completed recommendation during backfill (missing id)',
        );
        continue;
      }

      const existing = getActionBySource('recommendation', recId);
      if (existing) continue;

      const firstAffectedPage = Array.isArray(rec.affectedPages)
        ? rec.affectedPages.find((page): page is string => typeof page === 'string' && page.trim().length > 0) ?? null
        : null;

      // A1: attribute each completed rec to its mapped ActionType instead of
      // hardcoding audit_fix_applied. recommendationOutcomeActionType is exhaustive
      // over RecType and falls through to audit_fix_applied for unknown/legacy values,
      // so a regenerated row that dropped `type` lands on the historical default.
      const actionType = typeof rec.type === 'string' && rec.type.length > 0
        ? recommendationOutcomeActionType(rec.type as RecType, rec.source ?? '')
        : 'audit_fix_applied';

      if (workspaceId) {
        recordAction({ // recordAction-ok: workspaceId guarded by if (workspaceId)
          workspaceId,
          actionType,
          sourceType: 'recommendation',
          sourceId: recId,
          pageUrl: firstAffectedPage,
          targetKeyword: null,
          baselineSnapshot: {
            captured_at: new Date().toISOString(),
          },
          sourceFlag: 'backfill',
          baselineConfidence: 'estimated',
          // A5 (audit #20): snapshot the rec's OV predictedEmv from the current
          // recommendation read model — the same field the live PATCH-completion route
          // snapshots (routes/recommendations.ts).
          // Pre-A5 this was hardcoded null, so every rec completed via the in-place
          // resolver (resolveRecommendationsForChange records no action; this weekly
          // pass is its catch-up) lost the P6 realized-vs-predicted pairing. Honest
          // null when the rec carries no opportunity (legacy row / OV not attached).
          predictedEmv: rec.opportunity?.predictedEmv ?? null,
          attribution: 'platform_executed',
        });
        count++;
      }
    } catch (err) {
      log.warn(
        { err, workspaceId, recId: rec.id },
        'Failed to backfill completed recommendation — skipping'
      );
    }
  }

  log.info({ workspaceId, count }, 'backfillCompletedRecommendations complete');
  return count;
}

/**
 * A5 (audit #20) repair pass: fill MISSING predictedEmv snapshots on existing
 * recommendation-sourced tracked actions from the current recommendation read model.
 *
 * Why these rows exist: (a) every pre-A5 backfill row hardcoded predicted_emv = NULL,
 * and (b) live completions of recs that had no opportunity attached at completion time
 * stored an honest NULL even though a later regen may have attached one.
 *
 * Best-effort semantics, documented: the read model's predictedEmv is the rec's CURRENT
 * prediction, which can postdate action time for regenerated sets — an acceptable
 * estimate for the P6 calibration pairing, far better than no pairing. Three guards
 * keep it honest:
 *  - never overwrites: fillPredictedEmvIfNull is gated on `predicted_emv IS NULL`;
 *  - never fills from a 0/absent prediction (0 is the legacy zod round-trip default,
 *    meaning "unknown", and a 0 denominator is useless to the ratio calibration);
 *  - actions whose rec no longer exists are left NULL (no oracle to consult).
 *
 * Idempotent by construction: filled rows stop matching the `predicted_emv IS NULL`
 * candidate query, so a second run is a natural no-op.
 */
export function backfillPredictedEmvSnapshots(workspaceId: string): number {
  const candidates = stmts().nullEmvRecActions.all(workspaceId) as Array<{ id: string; source_id: string | null }>;
  if (candidates.length === 0) return 0;

  const set = loadRecommendationSet(workspaceId);
  if (!set) return 0;

  const emvByRecId = new Map<string, number>();
  for (const rec of set.recommendations) {
    const emv = rec.opportunity?.predictedEmv;
    if (rec.id && typeof emv === 'number' && Number.isFinite(emv) && emv > 0) {
      emvByRecId.set(rec.id, emv);
    }
  }
  if (emvByRecId.size === 0) return 0;

  let filled = 0;
  const run = db.transaction(() => {
    for (const action of candidates) {
      const recId = action.source_id?.trim();
      if (!recId) continue;
      const emv = emvByRecId.get(recId);
      if (emv == null) continue;
      if (fillPredictedEmvIfNull(action.id, workspaceId, emv)) filled++;
    }
  });
  run();

  if (filled > 0) {
    log.info({ workspaceId, filled, candidates: candidates.length }, 'backfillPredictedEmvSnapshots complete');
  }
  return filled;
}

// ─── Main entry point ─────────────────────────────────────────────────────────

export interface BackfillResult {
  backfilledCount: number;
  errors: number;
}

/**
 * Run the full backfill for one or all workspaces.
 * If workspaceId is provided, only that workspace is processed.
 * Otherwise, all workspace IDs are queried and each is backfilled.
 *
 * This function is idempotent — running it twice will not create duplicates.
 */
export function runBackfill(workspaceId?: string): BackfillResult {
  const workspaceIds: string[] = workspaceId
    ? [workspaceId]
    : (stmts().allWorkspaceIds.all() as WorkspaceIdRow[]).map(r => r.id);

  let backfilledCount = 0;
  let errors = 0;

  for (const wsId of workspaceIds) {
    try {
      const posts = backfillPublishedContent(wsId);
      const insights = backfillResolvedInsights(wsId);
      const recs = backfillCompletedRecommendations(wsId);
      // A5: runs AFTER the rec pass so newly created actions are already snapshotted
      // (they no longer match the NULL candidate query) and only genuine pre-A5 /
      // opportunity-less-at-completion rows get the best-effort fill.
      const emvFills = backfillPredictedEmvSnapshots(wsId);
      backfilledCount += posts + insights + recs;
      log.info({ workspaceId: wsId, posts, insights, recs, emvFills }, 'Workspace backfill complete');
    } catch (err) {
      errors++;
      log.error({ err, workspaceId: wsId }, 'Workspace backfill failed — skipping');
    }
  }

  log.info({ backfilledCount, errors, workspaceCount: workspaceIds.length }, 'runBackfill complete');
  return { backfilledCount, errors };
}
