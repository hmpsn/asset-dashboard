// server/outcome-backfill.ts
// Retroactively creates tracked actions from historical data so the system
// launches with months of learnings instead of starting from zero.

import db from './db/index.js';
import { createStmtCache } from './db/stmt-cache.js';
import { parseJsonSafeArray } from './db/json-validation.js';
import { z } from './middleware/validate.js';
import { createLogger } from './logger.js';
import { recordAction, getActionBySource } from './outcome-tracking.js';

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

interface RecommendationSetRow {
  workspace_id: string;
  recommendations: string; // JSON blob
}

interface WorkspaceIdRow {
  id: string;
}

interface Recommendation {
  id: string;
  status: string;
  affectedPages?: string[];
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
  recommendationSet: db.prepare(`
    SELECT workspace_id, recommendations
    FROM recommendation_sets
    WHERE workspace_id = ?
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
 * Recommendations are stored as a JSON blob in recommendation_sets.recommendations.
 * Idempotent: skips recommendations that already have a tracked action via source_type='recommendation'.
 */
export function backfillCompletedRecommendations(workspaceId: string): number {
  const row = stmts().recommendationSet.get(workspaceId) as RecommendationSetRow | undefined;
  if (!row) return 0;

  const recommendationSchema = z.object({
    id: z.string(),
    status: z.string(),
    affectedPages: z.array(z.string()).optional(),
  });
  const recommendations = parseJsonSafeArray(
    row.recommendations,
    recommendationSchema,
    { field: 'recommendations', table: 'recommendation_sets' },
  ) as Recommendation[];

  const completed = recommendations.filter(r => r.status === 'completed');
  let count = 0;

  for (const rec of completed) {
    try {
      const existing = getActionBySource('recommendation', rec.id);
      if (existing) continue;

      const firstAffectedPage = rec.affectedPages?.[0] ?? null;

      if (workspaceId) {
        recordAction({ // recordAction-ok: workspaceId guarded by if (workspaceId)
          workspaceId,
          actionType: 'audit_fix_applied',
          sourceType: 'recommendation',
          sourceId: rec.id,
          pageUrl: firstAffectedPage,
          targetKeyword: null,
          baselineSnapshot: {
            captured_at: new Date().toISOString(),
          },
          sourceFlag: 'backfill',
          baselineConfidence: 'estimated',
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
      backfilledCount += posts + insights + recs;
      log.info({ workspaceId: wsId, posts, insights, recs }, 'Workspace backfill complete');
    } catch (err) {
      errors++;
      log.error({ err, workspaceId: wsId }, 'Workspace backfill failed — skipping');
    }
  }

  log.info({ backfilledCount, errors, workspaceCount: workspaceIds.length }, 'runBackfill complete');
  return { backfilledCount, errors };
}
