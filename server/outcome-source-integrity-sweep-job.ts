// server/outcome-source-integrity-sweep-job.ts
//
// Reconcile R6 (Task B12) — integrity sweep for `tracked_actions.(source_type, source_id)`.
//
// READ-ONLY. This job mutates nothing — it reports which tracked_actions rows point at a
// source row that no longer exists ("dangling" refs), grouped by source_type, per workspace.
// It exists to give B11's snapshot columns (source_label/source_snapshot, R6-PR1) and the
// resolveWinTitle() snapshot→live→generic fallback chain (server/routes/outcomes.ts) an
// evidence base: once this sweep is clean across the fleet, the generic-label fallback can be
// demoted with confidence instead of guesswork. See server/routes/outcomes.ts resolveWinTitle
// doc comment ("its demotion is B12's job, after the integrity sweep confirms zero danglers").
//
// The polymorphic (source_type, source_id) pair on tracked_actions references SOURCE KINDS
// that fall into three buckets, discovered by reading every recordAction() call site:
//
//   1. ROW-BACKED  — source_id is a real primary key in another table. A dangling ref here is
//      a genuine orphan (the source row was deleted/regenerated after the action was recorded).
//        insight             -> analytics_insights.id
//        recommendation      -> recommendation_items.id (R7 blob->rows cutover; B5)
//        post                -> content_posts.id
//        brief               -> content_briefs.id
//        content_request     -> content_briefs.id (misleadingly named: content-brief-generation-job.ts
//                               records the REQUEST-sourced brief under sourceType 'content_request',
//                               sourceId = brief.id — confirmed by reading the call site)
//        client_action       -> client_actions.id
//        gbp_review_response -> google_business_review_responses.id (B13 seam, added after this
//                               census was first written; verified table name via migration 161,
//                               workspace-scoped w/ FK ON DELETE CASCADE)
//
//   2. SELF-REF    — source_id is the workspace's own id (a workspace-level event, not a
//      sub-entity). Only "dangling" if the WORKSPACE itself was deleted, which cascades the
//      tracked_actions row too (ON DELETE CASCADE) — so these can never actually be found
//      dangling in practice. Reported as a zero-count bucket for completeness/observability.
//        strategy            -> workspaces.id
//        brand_voice         -> workspaces.id
//
//   3. NOT ROW-CHECKABLE — source_id is a synthetic key, a page path/URL, or an id addressable
//      only inside a JSON blob column (no indexed table lookup exists). These are intentionally
//      NOT reported as "dangling" (that would be a false positive) — they're reported in a
//      separate `notCheckable` bucket so the sweep is honest about its own coverage instead of
//      silently passing them.
//        strategy_page_keyword -> composite synthetic key (strategyPageKeywordSourceId); no
//                                  backing row ever existed for this sourceId shape.
//        content_decay         -> page path (rec.page), not a row id.
//        internal_link         -> page path (suggestion.toPage), not a row id.
//        schema                -> Webflow page id, not a local DB row.
//        approval               -> id of an item inside approval_batches.items JSON array; no
//                                  indexed per-item table exists to check existence against.
//        audit                  -> synthetic `${pageId}-${check}` bulk-accept-fix dedup key (B13
//                                  seam, added after this census; see recordBulkAcceptFixOutcomeAction
//                                  in server/webflow-seo-bulk-accept-fixes-job.ts). No backing row.
//
// Ticket B12 also names `strategy_page_keyword`, `approval`, `internal_link`, `content_decay`,
// `brand_voice`, `strategy`, `brief`, `recommendation` as "the ~8 source tables" — read-before-write
// investigation (grepping every recordAction() call site) confirmed only `recommendation` and
// `brief` are genuinely row-backed among that list; the rest are self-ref or non-row-checkable
// as documented above. Every bucket is still reported for completeness.

import db from './db/index.js';
import { createStmtCache } from './db/stmt-cache.js';
import { createLogger } from './logger.js';
import { getJob, updateJob, unregisterAbort, createJob, hasActiveJob, type Job } from './jobs.js';
import { isProgrammingError } from './errors.js';
import { BACKGROUND_JOB_TYPES } from '../shared/types/background-jobs.js';

const log = createLogger('outcome-source-integrity-sweep');

/** True while the job has been cancelled (cooperative cancel — checked between workspaces). */
function isCancelled(jobId: string): boolean {
  return getJob(jobId)?.status === 'cancelled';
}

const stmts = createStmtCache(() => ({
  allWorkspaceIds: db.prepare(`SELECT id FROM workspaces`),
  sourceRefsByWorkspace: db.prepare(`
    SELECT source_type, source_id
    FROM tracked_actions
    WHERE workspace_id = ? AND source_id IS NOT NULL
  `),
  existsInsight: db.prepare(`SELECT 1 FROM analytics_insights WHERE workspace_id = ? AND id = ?`),
  existsRecommendationItem: db.prepare(`SELECT 1 FROM recommendation_items WHERE workspace_id = ? AND id = ?`),
  existsPost: db.prepare(`SELECT 1 FROM content_posts WHERE workspace_id = ? AND id = ?`),
  existsBrief: db.prepare(`SELECT 1 FROM content_briefs WHERE workspace_id = ? AND id = ?`),
  existsClientAction: db.prepare(`SELECT 1 FROM client_actions WHERE workspace_id = ? AND id = ?`),
  // B13: gbp_review_response's sourceId is a real google_business_review_responses.id
  // (verified table name — migration 161). The table is workspace-scoped (workspace_id
  // FK to workspaces ON DELETE CASCADE), so this mirrors the other row-backed probes.
  existsGbpReviewResponse: db.prepare(`SELECT 1 FROM google_business_review_responses WHERE workspace_id = ? AND id = ?`),
}));

interface SourceRefRow {
  source_type: string;
  source_id: string;
}

/**
 * ROW-BACKED source_type -> existence-check function. Each function returns true when the
 * referenced row still exists (i.e. NOT dangling). Only source types confirmed row-backed by
 * reading their recordAction() call site are listed here — see the module doc comment above.
 */
const ROW_BACKED_CHECKS: Record<string, (workspaceId: string, sourceId: string) => boolean> = {
  insight: (workspaceId, sourceId) => !!stmts().existsInsight.get(workspaceId, sourceId),
  recommendation: (workspaceId, sourceId) => !!stmts().existsRecommendationItem.get(workspaceId, sourceId),
  post: (workspaceId, sourceId) => !!stmts().existsPost.get(workspaceId, sourceId),
  brief: (workspaceId, sourceId) => !!stmts().existsBrief.get(workspaceId, sourceId),
  // See module doc comment (bucket 1) — content_request-sourced actions snapshot the
  // GENERATED BRIEF's id as source_id, not a content_requests row id.
  content_request: (workspaceId, sourceId) => !!stmts().existsBrief.get(workspaceId, sourceId),
  client_action: (workspaceId, sourceId) => !!stmts().existsClientAction.get(workspaceId, sourceId),
  // B13 (D2): the GBP review-response publish seam records sourceType 'gbp_review_response'
  // with sourceId = the published google_business_review_responses.id (see
  // server/google-business-profile-review-response-publish-job.ts:recordGbpReviewReplyOutcomeAction).
  // A dangling ref here means the review-response row was deleted/regenerated after the
  // action was recorded — a genuine orphan, so it belongs in the row-backed bucket.
  gbp_review_response: (workspaceId, sourceId) => !!stmts().existsGbpReviewResponse.get(workspaceId, sourceId),
};

/** SELF-REF source_type -> its source_id is always the owning workspace's id. */
const SELF_REF_TYPES = new Set(['strategy', 'brand_voice']);

/**
 * Not row-checkable: source_id is a synthetic composite key, a page path/URL, or an id
 * addressable only inside a JSON blob column with no indexed lookup. Reporting these as
 * "dangling" would be a false positive, so they're tracked in their own bucket instead.
 *
 * B13 (D2): 'audit' is here because the bulk-accept-fixes seam records sourceType 'audit'
 * with a SYNTHETIC composite sourceId `${pageId}-${check}` (the applied-fix dedup key — see
 * server/webflow-seo-bulk-accept-fixes-job.ts:recordBulkAcceptFixOutcomeAction). No backing
 * row exists to check that key against, so it is not-checkable, not dangling.
 */
const NOT_CHECKABLE_TYPES = new Set(['strategy_page_keyword', 'content_decay', 'internal_link', 'schema', 'approval', 'audit']);

export interface DanglingRef {
  sourceType: string;
  sourceId: string;
}

export interface SourceTypeCoverage {
  sourceType: string;
  total: number;
  dangling: number;
}

export interface WorkspaceIntegrityResult {
  workspaceId: string;
  /** Total tracked_actions rows with a non-null source_id in this workspace. */
  totalRefs: number;
  /** Per-source-type breakdown for ROW-BACKED types only (total refs + dangling count). */
  rowBackedCoverage: SourceTypeCoverage[];
  /**
   * The actual dangling (source_type, source_id) pairs. CAPPED at MAX_DANGLING_PER_WORKSPACE —
   * `danglingRefs.length` is NOT authoritative for how many dangling refs this workspace has.
   * Always read `danglingTotal` for the true count and `danglingTruncated` to know whether this
   * enumeration is complete. This diagnostic gates the eventual demotion of resolveWinTitle's
   * generic fallback, so a consumer must never infer "drift is bounded" from a capped array.
   */
  danglingRefs: DanglingRef[];
  /** Authoritative per-workspace dangling count across all ROW-BACKED types — the true total,
   *  independent of the MAX_DANGLING_PER_WORKSPACE cap on the `danglingRefs` enumeration.
   *  Equals `sum(rowBackedCoverage[].dangling)`. */
  danglingTotal: number;
  /** True when `danglingTotal > MAX_DANGLING_PER_WORKSPACE`, i.e. `danglingRefs` is a truncated
   *  sample rather than the complete list. Lets a consumer distinguish "no more danglers" from
   *  "more danglers exist that were not enumerated". */
  danglingTruncated: boolean;
  /** Ref counts for source types this sweep cannot check (synthetic/page-ref/JSON-blob keys). */
  notCheckableCounts: Record<string, number>;
  /** Ref counts for self-ref types (source_id === workspaceId) — always 0 dangling in practice. */
  selfRefCounts: Record<string, number>;
  /** source_type values seen in the data that this sweep does not yet classify (neither row-backed, self-ref, nor known-not-checkable). Surfaced so a new recordAction() call site with an unrecognized sourceType doesn't silently vanish from the report. */
  unclassifiedTypes: string[];
}

export interface OutcomeSourceIntegritySweepResult {
  workspaceCount: number;
  totalDangling: number;
  workspaces: WorkspaceIntegrityResult[];
}

/** Cap on how many dangling refs are enumerated per workspace in the report — avoids an
 *  unbounded job.result payload on a badly-drifted workspace. Coverage counts are unaffected. */
const MAX_DANGLING_PER_WORKSPACE = 200;

/**
 * Sweep ONE workspace's tracked_actions rows for dangling (source_type, source_id) refs.
 * Pure read — issues only SELECT statements, never a mutation.
 */
export function sweepWorkspaceSourceIntegrity(workspaceId: string): WorkspaceIntegrityResult {
  const rows = stmts().sourceRefsByWorkspace.all(workspaceId) as SourceRefRow[];

  const coverageByType = new Map<string, { total: number; dangling: number }>();
  const danglingRefs: DanglingRef[] = [];
  const notCheckableCounts: Record<string, number> = {};
  const selfRefCounts: Record<string, number> = {};
  const unclassifiedTypes = new Set<string>();

  for (const row of rows) {
    const sourceType = row.source_type;
    const sourceId = row.source_id;
    if (!sourceId) continue; // guarded by the WHERE clause too; defensive for row-mapper drift

    const rowBackedCheck = ROW_BACKED_CHECKS[sourceType];
    if (rowBackedCheck) {
      const bucket = coverageByType.get(sourceType) ?? { total: 0, dangling: 0 };
      bucket.total++;
      const exists = rowBackedCheck(workspaceId, sourceId);
      if (!exists) {
        bucket.dangling++;
        if (danglingRefs.length < MAX_DANGLING_PER_WORKSPACE) {
          danglingRefs.push({ sourceType, sourceId });
        }
      }
      coverageByType.set(sourceType, bucket);
      continue;
    }

    if (SELF_REF_TYPES.has(sourceType)) {
      selfRefCounts[sourceType] = (selfRefCounts[sourceType] ?? 0) + 1;
      continue;
    }

    if (NOT_CHECKABLE_TYPES.has(sourceType)) {
      notCheckableCounts[sourceType] = (notCheckableCounts[sourceType] ?? 0) + 1;
      continue;
    }

    unclassifiedTypes.add(sourceType);
  }

  const rowBackedCoverage: SourceTypeCoverage[] = [...coverageByType.entries()]
    .map(([sourceType, { total, dangling }]) => ({ sourceType, total, dangling }))
    .sort((a, b) => a.sourceType.localeCompare(b.sourceType));

  // Authoritative true count — derived from coverage buckets, NOT from the (capped) danglingRefs
  // array, so it stays correct even when the enumeration was truncated.
  const danglingTotal = rowBackedCoverage.reduce((sum, c) => sum + c.dangling, 0);

  return {
    workspaceId,
    totalRefs: rows.length,
    rowBackedCoverage,
    danglingRefs,
    danglingTotal,
    danglingTruncated: danglingTotal > MAX_DANGLING_PER_WORKSPACE,
    notCheckableCounts,
    selfRefCounts,
    unclassifiedTypes: [...unclassifiedTypes].sort(),
  };
}

/**
 * Enqueue the fleet-wide outcome-source integrity sweep as a background job — the single entry
 * point a future cron caller will use (the cron itself lives in outcome-crons.ts, owned by a
 * concurrent ticket; wiring is deferred). Mirrors enqueueIntelligenceRecompute
 * (server/intelligence-recompute-job.ts): deduped via `hasActiveJob` so overlapping triggers
 * collapse to one run, and returns the created job (or the existing active job's record) so the
 * caller can observe it.
 *
 * FLEET-WIDE, not per-workspace: this sweep scans every workspace in one pass, so the job carries
 * NO workspaceId (createJob's workspaceId is left undefined → a global/no-owner job). It must NOT
 * be dispatched through the per-workspace POST /api/jobs path.
 *
 * Cancellation is status-only by design (M-2): the worker has no in-flight external I/O to abort,
 * so it polls `isCancelled` (job status) between workspaces and never registers an AbortController.
 * Deliberately NOT calling `registerAbort()` here keeps the abort-signal and status channels from
 * diverging — there is only one cancellation source of truth (the job status).
 */
export function enqueueOutcomeSourceIntegritySweep(): Job | null {
  const active = hasActiveJob(BACKGROUND_JOB_TYPES.OUTCOME_SOURCE_INTEGRITY_SWEEP);
  if (active) return active;
  const job = createJob(BACKGROUND_JOB_TYPES.OUTCOME_SOURCE_INTEGRITY_SWEEP, {
    message: 'Starting outcome source integrity sweep...',
  });
  setTimeout(() => { void runOutcomeSourceIntegritySweepJob(job.id); }, 100);
  return job;
}

/**
 * Background worker: sweeps every workspace's tracked_actions for dangling source refs and
 * writes the full report to job.result. READ-ONLY end to end — never calls a write statement,
 * never touches recordAction/updateAttribution/etc, and always returns `{ modified: 0 }`
 * semantics (there is nothing to modify; this is a report-only job).
 *
 * FM-2: any failure (e.g. a workspace's tracked_actions read throws) ends the job in `error`
 * status — a report job that silently "succeeds" with a partial/wrong picture is worse than one
 * that visibly fails.
 *
 * Cooperative cancellation: checked between workspaces (not mid-workspace — a single
 * workspace's sweep is cheap enough not to need a finer-grained check).
 */
export async function runOutcomeSourceIntegritySweepJob(jobId: string): Promise<void> {
  try {
    if (isCancelled(jobId)) return;
    updateJob(jobId, { status: 'running', progress: 0, message: 'Scanning workspaces...' });

    const workspaceIds = (stmts().allWorkspaceIds.all() as Array<{ id: string }>).map(r => r.id);
    const results: WorkspaceIntegrityResult[] = [];
    let totalDangling = 0;

    for (let i = 0; i < workspaceIds.length; i++) {
      if (isCancelled(jobId)) return;
      const workspaceId = workspaceIds[i];
      const result = sweepWorkspaceSourceIntegrity(workspaceId);
      results.push(result);
      // Use the authoritative per-workspace danglingTotal (true count, cap-independent) — never
      // the length of the capped danglingRefs array.
      totalDangling += result.danglingTotal;

      updateJob(jobId, {
        progress: i + 1,
        total: workspaceIds.length,
        message: `Scanned ${i + 1}/${workspaceIds.length} workspaces...`,
      });
    }

    const report: OutcomeSourceIntegritySweepResult = {
      workspaceCount: results.length,
      totalDangling,
      workspaces: results,
    };

    if (totalDangling > 0) {
      log.warn(
        { totalDangling, workspaceCount: results.length },
        'Outcome source integrity sweep found dangling tracked_actions source refs',
      );
    } else {
      log.info({ workspaceCount: results.length }, 'Outcome source integrity sweep found zero dangling refs');
    }

    // D2: surface ANY unclassified sourceType (neither row-backed, self-ref, nor
    // known-not-checkable) at warn level. Without this, a newly-minted recordAction()
    // sourceType silently falls into `unclassifiedTypes` — which emits NO warning on its
    // own (only totalDangling>0 does) — so the fleet could read "zero danglers" while a
    // whole unexamined ref-kind (potentially with real orphans) sits unchecked. This is
    // exactly how B13's gbp_review_response/audit seams went unclassified until D2.
    const unclassifiedFleetwide = [
      ...new Set(results.flatMap(r => r.unclassifiedTypes)),
    ].sort();
    if (unclassifiedFleetwide.length > 0) {
      log.warn(
        { unclassifiedTypes: unclassifiedFleetwide, workspaceCount: results.length },
        'Outcome source integrity sweep saw source types it does not classify — add them to ROW_BACKED_CHECKS / SELF_REF_TYPES / NOT_CHECKABLE_TYPES',
      );
    }

    // A racing cancel between the loop's last check and here leaves the job terminal-cancelled;
    // updateJob's transition guard drops this cancelled→done write, which is the desired outcome.
    updateJob(jobId, {
      status: 'done',
      progress: workspaceIds.length,
      total: workspaceIds.length,
      message: totalDangling > 0
        ? `Sweep complete — ${totalDangling} dangling ref${totalDangling === 1 ? '' : 's'} across ${results.length} workspaces`
        : `Sweep complete — zero dangling refs across ${results.length} workspaces`,
      result: report,
    });
  } catch (err) {
    if (isCancelled(jobId)) return;
    // M-1: this diagnostic job's own failure must be discoverable at the default `info` log level
    // in prod — a suppressed `debug` would hide that the evidence-gathering sweep silently died.
    // Programming errors stay at `warn` (they signal a code bug, not an operational failure).
    if (isProgrammingError(err)) log.warn({ err, jobId }, 'Outcome source integrity sweep failed with programming error');
    else log.info({ err, jobId }, 'Outcome source integrity sweep failed');
    updateJob(jobId, {
      status: 'error',
      error: err instanceof Error ? err.message : String(err),
      message: 'Integrity sweep failed',
    });
  } finally {
    unregisterAbort(jobId);
  }
}
