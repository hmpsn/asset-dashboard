/**
 * recommendations routes — extracted from server/index.ts
 */
import { Router } from 'express';

import { requireAuthenticatedClientPortalAuth, requireClientPortalAuth } from '../middleware.js';
import { requireWorkspaceAccess } from '../auth.js';
import { isFeatureEnabled } from '../feature-flags.js';
import { validate, z } from '../middleware/validate.js';
import db from '../db/index.js';
import { createLogger } from '../logger.js';
import { recordAction, getActionBySource } from '../outcome-tracking.js';
import {
  loadRecommendations,
  computeRecommendationSummary,
  updateRecommendationStatus,
  dismissRecommendation,
  isCuratedForClient,
} from '../recommendations.js';
import { recommendationOutcomeActionType } from '../domains/recommendations/outcome-action-type.js';
import {
  getOperatorOverrides,
  getSortOrderMap,
  setWordingOverride,
  setSortOrders,
  applyWordingOverrides,
  RecWordingOverrideError,
} from '../rec-operator-overrides.js';
import {
  sendRecommendation,
  strikeRecommendation,
  unstrikeRecommendation,
  throttleRecommendation,
  fixRecommendation,
  approveRecommendation,
  REC_POLICY_REGISTRY,
} from '../recommendation-lifecycle.js';
import { addRecDiscussionEntry, listRecDiscussion } from '../rec-discussion.js';
import { notifyClientCuratedRecsSent } from '../email.js';
import { createJob, hasActiveJob } from '../jobs.js';
import { runRecommendationGenerationJob } from '../recommendation-generation-job.js';
import { captureBaselineFromGsc } from '../outcome-measurement.js';
import { getLatestSnapshot } from '../reports.js';
import { updatePageState, getPageIdBySlug, getWorkspace, buildClientPortalUrl, computeEffectiveTier } from '../workspaces.js';
import type { EffectiveTier } from '../workspaces.js';
import { normalizePageUrl } from '../utils/page-address.js';
import { broadcastToWorkspace } from '../broadcast.js';
import { WS_EVENTS } from '../ws-events.js';
import { invalidateIntelligenceCache } from '../intelligence/cache-invalidation.js';
import { BACKGROUND_JOB_TYPES } from '../../shared/types/background-jobs.js';
import { addActivity } from '../activity-log.js';
import { stripEmvFromPublicRecs, toPublicRecommendationSet } from '../recommendation-public-projection.js';
import {
  applyBulkRecommendationAction,
  mintCompetitorRecommendation,
  mintManualRecommendation,
} from '../recommendation-route-mutations.js';
import {
  RECOMMENDATION_TRANSITIONS,
  validateTransition,
  InvalidTransitionError,
} from '../state-machines.js';
import type { Recommendation, ClientFacingClientStatus, ClientRecResponseSummary } from '../../shared/types/recommendations.js';
import {
  MANUAL_REC_ALLOWED_TYPES,
  REC_WORDING_TITLE_MAX,
  REC_WORDING_INSIGHT_MAX,
  type OperatorOverridesResponse,
} from '../../shared/types/rec-operator-steering.js';
import { mirrorRecommendationToDeliverable } from '../domains/inbox/recommendation-dual-write.js';
import { createContentRequest } from '../content-requests.js';
import { buildStrategyCardContextFromRec } from '../recommendation-strategy-card-context.js';
import type { StrategyCardContext } from '../../shared/types/content.js';

const log = createLogger('routes:recommendations');
const router = Router();

/** Internal sentinel (L6): thrown inside the act-on transaction when the rec vanishes mid-flight
 *  so the whole greenlight+request unit rolls back and the route can map it to a 404. */
class RecGoneError extends Error {}

// ─── Recommendation Engine ─────────────────────────────────────────
// Generate (or re-generate) prioritized recommendations for a workspace.
// Soft-gated (requireClientPortalAuth): password-set workspaces require a
// session; passwordless/demo portals pass through (the client calls this with a
// cookie-only fetch). Matches the sibling PATCH/DELETE routes below.
router.post('/api/public/recommendations/:workspaceId/generate', requireAuthenticatedClientPortalAuth(), async (req, res) => {
  try {
    const { workspaceId } = req.params;
    if (!getWorkspace(workspaceId)) return res.status(404).json({ error: 'Workspace not found' });
    const active = hasActiveJob(BACKGROUND_JOB_TYPES.RECOMMENDATIONS_GENERATION, workspaceId);
    if (active) return res.json({ jobId: active.id, existing: true });

    const job = createJob(BACKGROUND_JOB_TYPES.RECOMMENDATIONS_GENERATION, {
      workspaceId,
      message: 'Generating recommendations...',
    });
    res.json({ jobId: job.id });
    setTimeout(() => {
      void runRecommendationGenerationJob(job.id, workspaceId, 'explicit');
    }, 100);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// List current recommendations — returns the last-known/empty set.
//
// COST: this read path must NEVER run the heavy generateRecommendations()
// pipeline inline (it holds the HTTP connection through a multi-step
// audit/AI/store walk). The SEO_AUDIT background job already regenerates the
// set post-audit (server/routes/jobs.ts), and POST .../generate is the explicit
// regenerate path. On a cache-miss we return an empty set quickly; an unknown
// workspace is an honest 404 (previously a 500 thrown from inline generation).
//
// Soft-gated (requireClientPortalAuth): password-set workspaces require a
// session; passwordless/demo portals pass through so the client InsightsEngine /
// useRecommendations hook keeps working without a token.
router.get('/api/public/recommendations/:workspaceId', requireClientPortalAuth(), (req, res) => {
  try {
    const { workspaceId } = req.params;
    let set = loadRecommendations(workspaceId);
    if (!set) {
      // No cached set. Distinguish unknown workspace (honest 404) from a known
      // workspace that simply hasn't generated yet (return an empty set — do NOT
      // generate inline).
      if (!getWorkspace(workspaceId)) {
        return res.status(404).json({ error: 'Workspace not found' });
      }
      set = {
        workspaceId,
        generatedAt: new Date().toISOString(),
        recommendations: [],
        summary: computeRecommendationSummary([]),
      };
    }
    // Filter by status if requested
    const status = req.query.status as string | undefined;
    const priority = req.query.priority as string | undefined;
    // Strategy "The Issue" §7 (P2-5) — the curated client feed reads ?clientStatus=sent to fetch
    // ONLY the recs the operator has put in front of the client. Filters on the RAW rec.clientStatus
    // (pre-projection); only the post-send client-facing values are meaningful here (a request for
    // 'system'/'curated' returns nothing, since those are operator-axis states the client never sees).
    const clientStatus = req.query.clientStatus as string | undefined;
    // The Issue §7 — the restricted clientStatus projection + the ?clientStatus filter are gated on
    // the per-workspace flag, so a non-Issue workspace's public read stays byte-identical to legacy.
    const exposeClientStatus = isFeatureEnabled('strategy-the-issue', workspaceId);
    // Effective tier feeds the audit-blocker #1 `actOn` descriptor. Resolved ONLY on the flag-ON
    // path (inside the exposeClientStatus block below) so the flag-OFF read does zero extra DB work
    // and stays byte-identical; the default 'free' is never used when the flag is off (actOn is
    // gated on exposeClientStatus, so it is absent then regardless of this value).
    let effectiveTier: EffectiveTier = 'free';
    let recs = set.recommendations;
    if (status) recs = recs.filter(r => r.status === status);
    if (priority) recs = recs.filter(r => r.priority === priority);
    if (exposeClientStatus && clientStatus) recs = recs.filter(r => r.clientStatus === clientStatus);
    // The Issue (operator-steering) — flag-gated, so a non-Issue workspace's public read stays
    // byte-identical to legacy. Apply the operator's wording corrections (title/insight, DISPLAY
    // only — never baked) THEN order by the operator's client-facing running order (recs with a
    // sort_order first, ascending; the rest after in their existing order via a stable sort).
    if (exposeClientStatus) {
      const ws = getWorkspace(workspaceId);
      if (ws) effectiveTier = computeEffectiveTier(ws);
      recs = applyWordingOverrides(workspaceId, recs);
      const sortOrderMap = getSortOrderMap(workspaceId);
      if (sortOrderMap.size > 0) {
        recs = recs
          .map((r, i) => ({ r, i }))
          .sort((a, b) => {
            const aOrder = sortOrderMap.get(a.r.id);
            const bOrder = sortOrderMap.get(b.r.id);
            // Operator-ordered recs first (ascending); un-ordered recs keep their natural order
            // after them. The index tiebreaker (a.i - b.i) makes the sort stable.
            if (aOrder !== undefined && bOrder !== undefined) return aOrder - bOrder || a.i - b.i;
            if (aOrder !== undefined) return -1;
            if (bOrder !== undefined) return 1;
            return a.i - b.i;
          })
          .map(({ r }) => r);
      }
    }
    res.json(toPublicRecommendationSet(set, recs, exposeClientStatus, effectiveTier));
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// Update recommendation status (pending → in_progress → completed).
// This endpoint IS the rec-completion path — it sets the recommendation to
// completed and mirrors the affected pages to live state. There is no separate
// rec to resolve; resolving here would be circular.
// rec-refresh-ok
router.patch('/api/public/recommendations/:workspaceId/:recId', requireAuthenticatedClientPortalAuth(), (req, res) => {
  const { workspaceId, recId } = req.params;
  const { status } = req.body;
  if (!status || !['pending', 'in_progress', 'completed', 'dismissed'].includes(status)) {
    return res.status(400).json({ error: 'Valid status required: pending, in_progress, completed, dismissed' });
  }
  let rec: Recommendation | null;
  try {
    rec = updateRecommendationStatus(workspaceId, recId, status);
  } catch (err) {
    return res.status(400).json({ error: err instanceof Error ? err.message : 'Invalid status transition' });
  }
  if (!rec) return res.status(404).json({ error: 'Recommendation not found' });
  const updatedPageStateIds: string[] = [];
  // When recommendation is completed, mark affected pages as live
  if (status === 'completed' && rec.affectedPages && rec.affectedPages.length > 0) {
    // Build slug→pageId map from audit snapshot
    const slugToPageId = new Map<string, string>();
    const ws = getWorkspace(workspaceId);
    if (ws?.webflowSiteId) {
      const snapshot = getLatestSnapshot(ws.webflowSiteId);
      if (snapshot) {
        for (const page of snapshot.audit.pages) {
          slugToPageId.set(normalizePageUrl(page.slug), page.pageId);
        }
      }
    }
    // Check which pages still have other active recommendations
    const allRecs = loadRecommendations(workspaceId);
    const pagesWithActiveRecs = new Set<string>();
    if (allRecs) {
      for (const r of allRecs.recommendations) {
        if (r.id !== rec.id && r.status !== 'completed' && r.status !== 'dismissed') {
          for (const p of r.affectedPages) pagesWithActiveRecs.add(normalizePageUrl(p));
        }
      }
    }
    for (const pageSlug of rec.affectedPages) {
      const normalizedPageSlug = normalizePageUrl(pageSlug);
      if (pagesWithActiveRecs.has(normalizedPageSlug)) continue;
      const resolvedPageId = slugToPageId.get(normalizedPageSlug)
        ?? getPageIdBySlug(workspaceId, normalizedPageSlug)
        ?? pageSlug;
      updatePageState(workspaceId, resolvedPageId, {
        status: 'live',
        source: 'recommendation',
        recommendationId: rec.id,
      });
      updatedPageStateIds.push(resolvedPageId);
    }
  }
  // Record for outcome tracking — idempotent. This is intentionally outside the
  // page-state block: strategy, keyword-gap, topic-cluster, and local recs can be
  // completed without affectedPages but still need outcome-learning calibration.
  if (status === 'completed') {
    try {
      if (workspaceId && !getActionBySource('recommendation', recId)) {
        const pageUrl = rec.affectedPages?.[0] ?? null;
        const action = recordAction({ // recordAction-ok: workspaceId guarded by if condition
          workspaceId,
          actionType: recommendationOutcomeActionType(rec.type, rec.source),
          sourceType: 'recommendation',
          sourceId: recId,
          pageUrl,
          targetKeyword: null,
          baselineSnapshot: {
            captured_at: new Date().toISOString(),
          },
          // P4: snapshot the OV predicted EMV (CPC-proxy placeholder) onto the durable
          // outcome row so the P6 realized-vs-predicted calibration loop has a pairing.
          // null when this rec carries no opportunity (legacy row / OV not yet attached).
          predictedEmv: rec.opportunity?.predictedEmv ?? null,
          attribution: 'platform_executed',
        });
        if (pageUrl) void captureBaselineFromGsc(action.id, workspaceId, pageUrl);
      }
    } catch (err) {
      log.warn({ err, recId }, 'Failed to record outcome action for recommendation completion');
    }
  }
  invalidateIntelligenceCache(workspaceId);
  if (updatedPageStateIds.length > 0) {
    broadcastToWorkspace(workspaceId, WS_EVENTS.PAGE_STATE_UPDATED, {
      pageIds: updatedPageStateIds,
      source: 'recommendation',
      recommendationId: rec.id,
    });
  }
  broadcastToWorkspace(workspaceId, WS_EVENTS.RECOMMENDATIONS_UPDATED, { recId, status });
  if (status === 'dismissed') {
    addActivity(
      workspaceId,
      'rec_dismissed',
      `Recommendation dismissed: ${rec.title}`,
      rec.description,
    );
  } else {
    addActivity(
      workspaceId,
      'rec_status_updated',
      `Recommendation updated: ${rec.title}`,
      `Status changed to "${status}"`,
    );
  }
  // Client-facing single-rec response — strip the admin/AI-only dollar figures
  // (emvPerWeek / roiPerEffortDay) just like the GET route does (owner constraint).
  // Resolve the effective tier ONLY on the flag-ON path so the flag-OFF response stays
  // byte-identical (no actOn, no extra DB read); the tier feeds the audit-blocker #1 descriptor.
  const exposeClientStatus = isFeatureEnabled('strategy-the-issue', workspaceId);
  const effectiveTier: EffectiveTier = exposeClientStatus
    ? (() => { const ws = getWorkspace(workspaceId); return ws ? computeEffectiveTier(ws) : 'free'; })()
    : 'free';
  res.json(stripEmvFromPublicRecs([rec], exposeClientStatus, effectiveTier)[0]);
});

// Dismiss a recommendation
router.delete('/api/public/recommendations/:workspaceId/:recId', requireAuthenticatedClientPortalAuth(), (req, res) => {
  const { workspaceId, recId } = req.params;
  // Read before dismiss so we have context for the activity log.
  const existing = loadRecommendations(workspaceId);
  const recToLog = existing?.recommendations.find(r => r.id === recId) ?? null;
  let ok: boolean;
  try {
    ok = dismissRecommendation(workspaceId, recId);
  } catch (err) {
    return res.status(400).json({ error: err instanceof Error ? err.message : 'Invalid status transition' });
  }
  if (!ok) return res.status(404).json({ error: 'Recommendation not found' });
  invalidateIntelligenceCache(workspaceId);
  broadcastToWorkspace(workspaceId, WS_EVENTS.RECOMMENDATIONS_UPDATED, { recId, status: 'dismissed', deleted: true });
  addActivity(
    workspaceId,
    'rec_dismissed',
    `Recommendation dismissed: ${recToLog?.title ?? recId}`,
    recToLog?.description,
  );
  res.json({ ok: true });
});

// ─── Strategy "The Issue" §7 — client greenlight ("Act on this") ─────────────────────────────
// POST /api/public/recommendations/:workspaceId/:recId/act-on
//
// The client's "Act on this" on a SENT curated rec. Per the owner correction this is a content
// REQUEST (approval), NOT generation: NOTHING is pre-generated or generated on the fly. It:
//   1. sets clientStatus → approved via the single-writer (approveRecommendation; validates
//      CLIENT_REC_TRANSITIONS — never RecStatus, never the operator curation axis), AND
//   2. creates a DURABLE server-side content REQUEST carrying the rec id + targetKeyword + the rec's
//      StrategyCardContext (briefId stays null — the operator decides whether/when to create the
//      brief later), AND
//   3. creates a TrackedAction (the greenlight→result attribution join, spec §7 C2) keyed to the
//      rec id + targetKeyword so a later milestone resolves back to the originating move.
// It MUST NOT fire fixContext (admin-only navigation state) and MUST NOT call any brief/post
// generator. Soft-gated like the sibling client routes (passwordless portals pass through).
//
// Maps the rec's priority axis (fix_now/fix_soon/fix_later/ongoing) onto the content-request
// priority vocabulary (high/medium/low) the request list + brief generator expect.
function recPriorityToRequestPriority(priority: Recommendation['priority']): string {
  switch (priority) {
    case 'fix_now':
      return 'high';
    case 'fix_soon':
      return 'medium';
    default:
      return 'low'; // fix_later / ongoing
  }
}

router.post(
  '/api/public/recommendations/:workspaceId/:recId/act-on',
  requireAuthenticatedClientPortalAuth(),
  (req, res) => {
    const { workspaceId, recId } = req.params;
    const ws = getWorkspace(workspaceId);
    if (!ws) return res.status(404).json({ error: 'Workspace not found' });

    // Read the rec BEFORE mutating so we can derive the content-request fields + attribution.
    const set = loadRecommendations(workspaceId);
    const recBefore = set?.recommendations.find((r) => r.id === recId) ?? null;
    if (!recBefore) return res.status(404).json({ error: 'Recommendation not found' });

    // Audit-blocker #1 — server-authoritative pricing gate (NO Stripe I/O; runs BEFORE the L6
    // db.transaction() so a rejected request creates NOTHING). Additive under strategy-the-issue so
    // the route stays byte-identical when the flag is OFF: a Free-tier client greenlighting a
    // MONETIZABLE rec (REC_POLICY_REGISTRY) is rejected with 403 + the required upgrade tier. The
    // route — not the hidden button — is the gate; the `actOn: locked` projection is its UI mirror.
    const exposeClientStatus = isFeatureEnabled('strategy-the-issue', workspaceId);
    const effectiveTier = computeEffectiveTier(ws);
    if (
      exposeClientStatus &&
      effectiveTier === 'free' &&
      (REC_POLICY_REGISTRY[recBefore.type]?.monetizable ?? false)
    ) {
      return res.status(403).json({ error: 'This move is available on the Growth plan.', requiredTier: 'growth' });
    }

    // L6: the greenlight (clientStatus → approved) and the durable content-request creation are
    // ONE atomic unit — a throw between them must not leave an approved rec with no request (an
    // orphaned greenlight the client believes took effect but that produced no work item). Wrap
    // BOTH writes in a single outer db.transaction(): approveRecommendation opens its own inner
    // txn (mutateRec), which better-sqlite3 nests via savepoint into this outer one (the same
    // nesting the bulk route relies on), so the pair commits or rolls back together. recordAction,
    // broadcasts, and activity logging stay OUTSIDE the txn (post-commit side effects).
    let rec: Recommendation;
    let request: ReturnType<typeof createContentRequest>;
    try {
      const result = db.transaction(() => {
        // Single-writer greenlight: clientStatus sent|discussing → approved (validates the client axis).
        const approved = approveRecommendation(workspaceId, recId);
        // null = rec vanished mid-flight (already 404'd on recBefore, but re-guard inside the txn).
        // Throw to roll back so a vanished rec never leaves a half-written request.
        if (!approved) throw new RecGoneError();

        // Build the StrategyCardContext stamped onto the durable request — the SAME derivation the
        // rec→deliverable adapter uses (one source of truth so the two §7 stamps never drift).
        const cardContext: StrategyCardContext = buildStrategyCardContextFromRec(approved);

        // The durable content REQUEST — nothing generated (briefId stays null; initialStatus
        // 'requested' = queued, no brief yet). A targetKeyword is required by the request model;
        // fall back to the rec title when the rec carries none (e.g. a technical rec).
        const targetKeyword = approved.targetKeyword?.trim() || approved.title;
        const createdRequest = createContentRequest(workspaceId, {
          topic: approved.title,
          targetKeyword,
          intent: cardContext.intent || 'informational',
          priority: recPriorityToRequestPriority(approved.priority),
          rationale: approved.insight,
          source: 'client',
          recommendationId: approved.id,
          strategyCardContext: cardContext,
          initialStatus: 'requested', // queued; NOTHING generated — the operator works it later
          // M1/L1: each greenlight is a DISTINCT durable intent. The default keyword-scoped dedupe
          // would return a pre-existing request row for the same targetKeyword and NEVER stamp this
          // rec's recommendationId / strategyCardContext, silently breaking the C2/C3 attribution
          // join (two recs sharing a keyword would collapse onto one row pointing at neither).
          // Disable dedupe so every act-on mints its own lineage-stamped row.
          dedupe: false,
        });
        return { rec: approved, request: createdRequest };
      })();
      rec = result.rec;
      request = result.request;
    } catch (err) {
      if (err instanceof InvalidTransitionError) return res.status(400).json({ error: err.message });
      if (err instanceof RecGoneError) return res.status(404).json({ error: 'Recommendation not found' });
      throw err;
    }

    // Greenlight → result attribution (spec §7 C2/C5). Idempotent: a re-act-on (or a later
    // mark-delivered) keyed to the same rec id must not double-record. attribution 'platform_executed'
    // — the agency executes the greenlit work. baselineSnapshot timestamped now so the P6
    // realized-vs-predicted loop has a pairing; predictedEmv snapshotted when the rec carries it.
    try {
      if (!getActionBySource('recommendation', rec.id)) {
        recordAction({ // recordAction-ok: workspaceId is the path param, validated by getWorkspace above
          workspaceId,
          actionType: recommendationOutcomeActionType(rec.type, rec.source),
          sourceType: 'recommendation',
          sourceId: rec.id,
          pageUrl: rec.affectedPages?.[0] ?? null,
          targetKeyword: rec.targetKeyword ?? null,
          baselineSnapshot: { captured_at: new Date().toISOString() },
          predictedEmv: rec.opportunity?.predictedEmv ?? null,
          attribution: 'platform_executed',
        });
      }
    } catch (err) {
      log.warn({ err, recId: rec.id }, 'Failed to record greenlight attribution for act-on');
    }

    invalidateIntelligenceCache(workspaceId);
    // Both halves of the feedback loop (data-flow rule #6): the clientStatus change AND the new
    // content request must each broadcast so admin + client React Query caches invalidate.
    broadcastToWorkspace(workspaceId, WS_EVENTS.RECOMMENDATIONS_UPDATED, { recId, clientStatus: 'approved' });
    broadcastToWorkspace(workspaceId, WS_EVENTS.CONTENT_REQUEST_CREATED, { id: request.id, recommendationId: rec.id });
    addActivity(
      workspaceId,
      'rec_status_updated',
      `Client greenlit recommendation: ${rec.title}`,
      `"Act on this" created content request ${request.id}`,
    );

    // Client-facing response — strip the admin/AI-only fields (mirror the GET/PATCH routes). act-on
    // is a The-Issue action, so expose the restricted clientStatus (the client must see their
    // greenlight took effect) + the actOn descriptor, gated on the per-workspace flag (exposeClientStatus
    // + effectiveTier resolved once at the top of the handler for the pricing gate).
    res.json({
      recommendation: stripEmvFromPublicRecs([rec], exposeClientStatus, effectiveTier)[0],
      requestId: request.id,
    });
  },
);

// ─── Strategy "The Issue" §7 — client-safe loop summary ──────────────────────────────────────
// GET /api/public/recommendations/:workspaceId/responses
//
// Counts of the client's own responses to sent recs (approved / declined / discussing) + the most
// recent few — powers the curated feed's loop footer ("you've greenlit N moves · 1 in discussion").
// Client-safe: only rec TITLES (already client-facing prose) + the restricted clientStatus + a
// respondedAt proxy (updatedAt — the single-writer bumps it on every clientStatus mutation). NEVER
// admin/AI-only fields, lifecycle, cascade, or $/ROI. Mirrors the server-only
// ClientSignalsSlice.recResponses shape; this is the dedicated CLIENT read.
//
// LITERAL '/responses' segment — there is no GET '/:workspaceId/:recId' route to shadow it, but it
// is placed in the public block above the admin section for locality. Soft-gated like the GET set.
router.get(
  '/api/public/recommendations/:workspaceId/responses',
  requireClientPortalAuth(),
  (req, res) => { // activity-ok: read-only
    const { workspaceId } = req.params;
    if (!getWorkspace(workspaceId)) return res.status(404).json({ error: 'Workspace not found' });
    const set = loadRecommendations(workspaceId);
    const recs: Recommendation[] = set?.recommendations ?? [];
    const responded = recs.filter(
      (r) =>
        r.clientStatus === 'approved' ||
        r.clientStatus === 'declined' ||
        r.clientStatus === 'discussing',
    );
    const recent = [...responded]
      .sort((a, b) => Date.parse(b.updatedAt ?? b.createdAt) - Date.parse(a.updatedAt ?? a.createdAt))
      .slice(0, 5)
      .map((r) => ({
        title: r.title,
        clientStatus: (r.clientStatus ?? 'sent') as ClientFacingClientStatus,
        respondedAt: r.updatedAt ?? r.createdAt,
      }));
    const summary: ClientRecResponseSummary = {
      approved: responded.filter((r) => r.clientStatus === 'approved').length,
      declined: responded.filter((r) => r.clientStatus === 'declined').length,
      discussing: responded.filter((r) => r.clientStatus === 'discussing').length,
      recent,
    };
    res.json(summary);
  },
);

// ─── Admin endpoints ────────────────────────────────────────────────────────
// These routes are NOT prefixed with /api/public/ so they are admin-only
// (protected by the global APP_PASSWORD HMAC gate in app.ts). They return the
// full rec data including the admin/AI-only dollar fields (emvPerWeek, etc.)
// that are stripped on the public client-facing routes above.

// Admin list — returns the full set for a workspace (all statuses, no EMV strip).
// Supports ?status= and ?priority= filters.
router.get('/api/recommendations/:workspaceId', requireWorkspaceAccess('workspaceId'), (req, res) => { // activity-ok: read-only
  try {
    const { workspaceId } = req.params;
    const set = loadRecommendations(workspaceId);
    if (!set) {
      if (!getWorkspace(workspaceId)) {
        return res.status(404).json({ error: 'Workspace not found' });
      }
      return res.json({
        workspaceId,
        generatedAt: new Date().toISOString(),
        recommendations: [],
        summary: computeRecommendationSummary([]),
      });
    }
    const status = req.query.status as string | undefined;
    const priority = req.query.priority as string | undefined;
    let recs = set.recommendations;
    if (status) recs = recs.filter(r => r.status === status);
    if (priority) recs = recs.filter(r => r.priority === priority);
    // The Issue (operator-steering) — apply wording overrides for DISPLAY only so the cockpit shows
    // the operator-corrected title/insight. Returns shallow clones; the base blob is never mutated
    // (loadRecommendations stays pure — overrides are never baked back). Not flag-gated: an empty
    // override table is a no-op (byte-identical), and the admin cockpit is already a flag-ON surface.
    recs = applyWordingOverrides(workspaceId, recs);
    res.json({ ...set, recommendations: recs });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// Admin un-dismiss — transitions a dismissed rec back to pending.
// Uses validateTransition (dismissed → pending is a legal backward edge in
// RECOMMENDATION_TRANSITIONS) so any future machine changes are honoured.
router.patch('/api/recommendations/:workspaceId/:recId/undismiss', requireWorkspaceAccess('workspaceId'), (req, res) => {
  const { workspaceId, recId } = req.params;
  const set = loadRecommendations(workspaceId);
  if (!set) return res.status(404).json({ error: 'Workspace has no recommendation set' });
  const rec = set.recommendations.find(r => r.id === recId);
  if (!rec) return res.status(404).json({ error: 'Recommendation not found' });
  try {
    validateTransition('recommendation', RECOMMENDATION_TRANSITIONS, rec.status, 'pending');
  } catch (err) {
    if (err instanceof InvalidTransitionError) {
      return res.status(400).json({ error: err.message });
    }
    throw err;
  }
  const updated = updateRecommendationStatus(workspaceId, recId, 'pending');
  if (!updated) return res.status(404).json({ error: 'Recommendation not found after transition' });
  invalidateIntelligenceCache(workspaceId);
  broadcastToWorkspace(workspaceId, WS_EVENTS.RECOMMENDATIONS_UPDATED, { recId, status: 'pending' });
  addActivity(
    workspaceId,
    'rec_status_updated',
    `Recommendation un-dismissed: ${rec.title}`,
    `Status restored to "pending"`,
  );
  res.json(updated);
});

// ─── Strategy v3 curation lifecycle (admin-only) ─────────────────────────────
// All routes mutate the SEPARATE clientStatus/lifecycle axes via the single-writer
// (server/recommendation-lifecycle.ts) — NEVER RecStatus. A struck rec must never be
// swept to 'completed' and read as "✓ done" to the client (the trust-critical graft).
// They are admin-only (no /api/public/ prefix → covered by the global APP_PASSWORD HMAC
// gate; requireWorkspaceAccess passes through for HMAC callers).

// ── Strategy v3 P3 — bulk lifecycle (Send / Throttle / Strike over N recs) ──────
// Applies the per-rec single-writer (sendRecommendation/throttleRecommendation/
// strikeRecommendation) to all N recs in ONE db.transaction() so the batch is atomic
// (spec §4.4). The single-writer functions DO NOT broadcast or log activity (that is the
// route's job, like the per-row routes above) — so this route logs one rec_* activity per
// successfully-mutated rec and fires ONE RECOMMENDATIONS_UPDATED broadcast after the txn
// (not N). InvalidTransitionError on an individual rec (e.g. already approved/declined) is
// swallowed per-rec inside the txn so one illegal rec does not roll back the whole batch —
// it is simply not counted in `modified`. Bulk Strike still arm-then-confirms (confirmStrike).
const bulkRecActionSchema = z.object({
  recIds: z.array(z.string()).min(1).max(200),
  action: z.enum(['send', 'throttle', 'strike']),
  throttleDays: z.union([z.literal(7), z.literal(30), z.literal(90)]).optional(),
  note: z.string().max(2000).optional(),
  confirmStrike: z.boolean().optional(),
});

router.post(
  '/api/recommendations/:workspaceId/bulk',
  requireWorkspaceAccess('workspaceId'),
  validate(bulkRecActionSchema),
  (req, res) => {
    const { workspaceId } = req.params;
    const { recIds, action, throttleDays, note, confirmStrike } = req.body as z.infer<typeof bulkRecActionSchema>;

    // Bulk Strike still arm-then-confirms (spec §4.4) — refuse without explicit confirmation.
    if (action === 'strike' && !confirmStrike) {
      return res.status(400).json({ error: 'Bulk strike requires confirmStrike' });
    }
    if (action === 'throttle' && !throttleDays) {
      return res.status(400).json({ error: 'Throttle requires throttleDays (7, 30, or 90)' });
    }

    // ONE transaction over all N (spec §4.4). The helper returns committed recs so activity logging
    // happens AFTER commit (no logs on a rolled-back batch).
    const mutated = applyBulkRecommendationAction({
      workspaceId,
      recIds,
      action,
      throttleDays,
    });

    // Post-commit side effects (one broadcast, per-rec activity) — mirror the per-row routes.
    for (const rec of mutated) {
      if (action === 'send') {
        // Bulk note is intentionally replicated per-rec: each rec owns its own discussion thread,
        // so the shared rationale must land on each (a 30-rec send with one note → 30 entries).
        if (note) addRecDiscussionEntry(workspaceId, rec.id, 'strategist', note);
        // Close-the-loop half #1 (spec §7 / P2-2): mirror EACH sent rec into the unified deliverable
        // so the bulk send reaches the client feed exactly like the per-row /send. Best-effort
        // (never throws), runs outside the committed txn (upsertDeliverable owns its own). // rec-mirror-ok
        mirrorRecommendationToDeliverable(workspaceId, rec);
        addActivity(workspaceId, 'rec_sent', `Recommendation sent to client: ${rec.title}`, note || rec.description);
      } else if (action === 'throttle') {
        addActivity(workspaceId, 'rec_throttled', `Recommendation throttled ${throttleDays}d: ${rec.title}`, rec.description);
      } else {
        addActivity(workspaceId, 'rec_struck', `Recommendation struck: ${rec.title}`, rec.description);
      }
    }
    if (mutated.length > 0) {
      invalidateIntelligenceCache(workspaceId);
      broadcastToWorkspace(workspaceId, WS_EVENTS.RECOMMENDATIONS_UPDATED, { action, count: mutated.length, reason: 'bulk' });
    }

    // Doorbell email (spec §7.1) — bulk Send is the canonical "recs are ready in your hub"
    // scenario, so fire ONE curated_recs_sent for the WHOLE batch (recCount: mutated.length),
    // never one-per-rec. Mirrors the per-row /send route's call signature + URL construction.
    // Wrapped so a transient mail failure never fails an already-committed bulk transition.
    if (action === 'send' && mutated.length > 0) {
      try {
        const ws = getWorkspace(workspaceId);
        if (ws?.clientEmail) {
          const origin = req.get('origin') || `${req.protocol}://${req.get('host')}`;
          notifyClientCuratedRecsSent({
            clientEmail: ws.clientEmail,
            workspaceName: ws.name,
            workspaceId,
            recCount: mutated.length,
            dashboardUrl: buildClientPortalUrl(origin, workspaceId),
          });
        }
      } catch (err) {
        log.warn({ err, workspaceId }, 'Failed to send curated_recs_sent doorbell email for bulk send');
      }
    }

    return res.json({ modified: mutated.length });
  },
);

// ── P4 Lane C — competitor-gap rec mint (idempotent) ────────────────────────────
// Mints a `type:'competitor'` Recommendation from a keyword gap so the per-row
// "Send to client" affordance in CompetitiveIntel has something to send. NOTHING else
// in the platform mints a competitor rec (the generators never do), so without this the
// send button could never fire. Idempotent: if a competitor rec for the same
// targetKeyword already exists, it is RETURNED rather than duplicated (safe on
// double-click). The minted rec satisfies recommendationSchema (else it would be
// silently dropped on the next loadRecommendations) — the field set + types mirror the
// keyword_gap branch in server/recommendations.ts.
//
// LITERAL route placed before the `:recId/*` param routes below so 'competitor-rec' is
// never swallowed as a :recId segment (route-ordering rule).
//
// Admin-only (no /api/public/ prefix → global APP_PASSWORD HMAC gate; requireWorkspaceAccess
// passes through for HMAC callers).
const competitorRecMintSchema = z.object({
  keyword: z.string().min(1).max(200),
  competitorDomain: z.string().max(255).optional(),
  title: z.string().max(300).optional(),
  description: z.string().max(2000).optional(),
  insight: z.string().max(2000).optional(),
});

router.post(
  '/api/recommendations/:workspaceId/competitor-rec',
  requireWorkspaceAccess('workspaceId'),
  validate(competitorRecMintSchema),
  (req, res) => {
    const { workspaceId } = req.params;
    if (!getWorkspace(workspaceId)) return res.status(404).json({ error: 'Workspace not found' });
    const { keyword, competitorDomain, title, description, insight } =
      req.body as z.infer<typeof competitorRecMintSchema>;

    const { rec, created } = mintCompetitorRecommendation(workspaceId, {
      keyword,
      competitorDomain,
      title,
      description,
      insight,
    });
    if (!created) return res.json(rec);

    invalidateIntelligenceCache(workspaceId);
    broadcastToWorkspace(workspaceId, WS_EVENTS.RECOMMENDATIONS_UPDATED, {
      recId: rec.id,
      type: 'competitor',
      reason: 'mint',
    });
    addActivity(
      workspaceId,
      'rec_status_updated',
      `Competitor recommendation created: ${rec.title}`,
      rec.description,
    );
    res.json(rec);
  },
);

// ─── The Issue (operator-steering) — correct wording / add a rec / reorder ───────────
// All admin-only (no /api/public/ prefix → global APP_PASSWORD HMAC gate; requireWorkspaceAccess
// passes through for HMAC callers). The two LITERAL routes (reorder, manual-rec) + the
// operator-overrides GET are placed BEFORE the `:recId/*` param routes so their path segment is
// never swallowed as a :recId (route-ordering rule). Overrides apply ONLY at display boundaries —
// never baked into the recommendation_sets blob (loadRecommendations stays pure).

// GET operator overrides (wording + running order) for the steering UI.
router.get(
  '/api/recommendations/:workspaceId/operator-overrides',
  requireWorkspaceAccess('workspaceId'),
  (req, res) => { // activity-ok: read-only
    const { workspaceId } = req.params;
    if (!getWorkspace(workspaceId)) return res.status(404).json({ error: 'Workspace not found' });
    const { wording, sortOrder } = getOperatorOverrides(workspaceId);
    const body: OperatorOverridesResponse = {
      workspaceId,
      wording: Object.fromEntries(wording),
      sortOrder: Object.fromEntries(sortOrder),
    };
    res.json(body);
  },
);

// PATCH reorder — persist the client-facing running order. Every recId must exist AND be curated
// for the client (isCuratedForClient) in the current set, else 400. The archetype-grouped curation
// view is unaffected; this orders ONLY the client-facing projection.
const reorderRecsSchema = z.object({
  recIds: z.array(z.string().min(1)).min(1).max(500),
});
router.patch(
  '/api/recommendations/:workspaceId/reorder',
  requireWorkspaceAccess('workspaceId'),
  validate(reorderRecsSchema),
  (req, res) => {
    const { workspaceId } = req.params;
    const { recIds } = req.body as z.infer<typeof reorderRecsSchema>;
    const set = loadRecommendations(workspaceId);
    if (!set) {
      if (!getWorkspace(workspaceId)) return res.status(404).json({ error: 'Workspace not found' });
      return res.status(404).json({ error: 'Workspace has no recommendation set' });
    }
    // Reject duplicate ids (a duplicate would collapse to a single sort_order — ambiguous order).
    if (new Set(recIds).size !== recIds.length) {
      return res.status(400).json({ error: 'recIds: duplicate recommendation id' });
    }
    const curatedIds = new Set(set.recommendations.filter(isCuratedForClient).map(r => r.id));
    for (const recId of recIds) {
      if (!curatedIds.has(recId)) {
        return res.status(400).json({ error: `recIds: ${recId} is not a curated client-facing recommendation` });
      }
    }
    setSortOrders(workspaceId, recIds);
    broadcastToWorkspace(workspaceId, WS_EVENTS.RECOMMENDATIONS_UPDATED, { reason: 'reorder' });
    addActivity(
      workspaceId,
      'rec_status_updated',
      'Client running order updated',
      `Reordered ${recIds.length} client-facing recommendation(s)`,
    );
    res.json({ ok: true });
  },
);

// POST manual-rec — mint the operator-authored recommendation the system missed. Generalizes the
// competitor-rec mint: source 'manual:<hex>', actionType 'manual', clientStatus 'system',
// lifecycle 'active', status 'pending'. The auto-resolve retention branch (isOperatorMintedRec)
// keeps it across regen; an explicit strike removes it. Type must be in MANUAL_REC_ALLOWED_TYPES
// (cannibalization is excluded — it needs a urlSetKey + competing-page set the operator can't
// hand-author here).
const createManualRecSchema = z.object({
  type: z.enum(MANUAL_REC_ALLOWED_TYPES),
  title: z.string().min(1).max(REC_WORDING_TITLE_MAX),
  insight: z.string().min(1).max(REC_WORDING_INSIGHT_MAX),
  description: z.string().max(2000).optional(),
  priority: z.enum(['fix_now', 'fix_soon', 'fix_later', 'ongoing']).optional(),
  targetKeyword: z.string().max(200).optional(),
  affectedPages: z.array(z.string().max(500)).max(100).optional(),
});
router.post(
  '/api/recommendations/:workspaceId/manual-rec',
  requireWorkspaceAccess('workspaceId'),
  validate(createManualRecSchema),
  (req, res) => {
    const { workspaceId } = req.params;
    if (!getWorkspace(workspaceId)) return res.status(404).json({ error: 'Workspace not found' });
    const { type, title, insight, description, priority, targetKeyword, affectedPages } =
      req.body as z.infer<typeof createManualRecSchema>;

    const rec = mintManualRecommendation(workspaceId, {
      type,
      title,
      insight,
      description,
      priority,
      targetKeyword,
      affectedPages,
    });

    invalidateIntelligenceCache(workspaceId);
    broadcastToWorkspace(workspaceId, WS_EVENTS.RECOMMENDATIONS_UPDATED, {
      recId: rec.id,
      type,
      reason: 'manual-mint',
    });
    addActivity(
      workspaceId,
      'rec_status_updated',
      `Recommendation added: ${rec.title}`,
      rec.insight,
    );
    res.json(rec);
  },
);

// PATCH wording — correct a rec's title/insight. recId-keyed override survives regen via
// id-continuity (applyLifecycleCarryOver carries the rec id old→new). An absent/empty field clears
// that override (restores the source wording); an all-cleared row is deleted. DISPLAY-only — never
// baked into the recommendation_sets blob. This is a `:recId/*` param route, placed after the
// literal routes above.
const recWordingSchema = z.object({
  title: z.string().max(REC_WORDING_TITLE_MAX).optional(),
  insight: z.string().max(REC_WORDING_INSIGHT_MAX).optional(),
});
router.patch(
  '/api/recommendations/:workspaceId/:recId/wording',
  requireWorkspaceAccess('workspaceId'),
  validate(recWordingSchema),
  (req, res) => {
    const { workspaceId, recId } = req.params;
    const set = loadRecommendations(workspaceId);
    if (!set) {
      if (!getWorkspace(workspaceId)) return res.status(404).json({ error: 'Workspace not found' });
      return res.status(404).json({ error: 'Workspace has no recommendation set' });
    }
    const rec = set.recommendations.find(r => r.id === recId);
    if (!rec) return res.status(404).json({ error: 'Recommendation not found' });
    const { title, insight } = req.body as z.infer<typeof recWordingSchema>;
    try {
      setWordingOverride(workspaceId, recId, { title, insight });
    } catch (err) {
      if (err instanceof RecWordingOverrideError) return res.status(400).json({ error: err.message });
      throw err;
    }
    broadcastToWorkspace(workspaceId, WS_EVENTS.RECOMMENDATIONS_UPDATED, { recId, reason: 'wording' });
    addActivity(
      workspaceId,
      'rec_status_updated',
      `Recommendation wording edited: ${title || rec.title}`,
      'Operator corrected the title/insight wording.',
    );
    res.json({ ok: true });
  },
);

// Send a curated rec to the client (clientStatus: curated/system → sent; stamps sentAt).
// Fires the curated_recs_sent doorbell email (spec §7.1). An optional note-on-send is
// recorded as a strategist discussion entry so it lands above the rec on the client overview.
router.patch('/api/recommendations/:workspaceId/:recId/send', requireWorkspaceAccess('workspaceId'), (req, res) => {
  const { workspaceId, recId } = req.params;
  const note = typeof req.body?.note === 'string' ? req.body.note.trim() : '';
  let rec: Recommendation | null;
  try {
    rec = sendRecommendation(workspaceId, recId);
  } catch (err) {
    if (err instanceof InvalidTransitionError) return res.status(400).json({ error: err.message });
    throw err;
  }
  if (!rec) return res.status(404).json({ error: 'Recommendation not found' });
  // Optional note-on-send → a strategist discussion entry (the narrative lever).
  if (note) addRecDiscussionEntry(workspaceId, recId, 'strategist', note);
  // Close-the-loop half #1 (spec §7 / P2-2): mirror the sent rec into the unified deliverable so it
  // reaches the client feed/inbox. Best-effort + fires DELIVERABLE_SENT itself (never throws). // rec-mirror-ok
  mirrorRecommendationToDeliverable(workspaceId, rec);
  invalidateIntelligenceCache(workspaceId);
  broadcastToWorkspace(workspaceId, WS_EVENTS.RECOMMENDATIONS_UPDATED, { recId, clientStatus: 'sent' });
  addActivity(workspaceId, 'rec_sent', `Recommendation sent to client: ${rec.title}`, note || rec.description);
  // Doorbell email — batched per curation session by the 'action' throttle bucket. CTA deep-links to
  // the client curated hub (the overview where sent recs surface). Per-rec ?rec= auto-open is a Phase-4
  // enhancement (the receiver lands in P4); a batched "N recs ready" email correctly points at the hub.
  const ws = getWorkspace(workspaceId);
  if (ws?.clientEmail) {
    const origin = req.get('origin') || `${req.protocol}://${req.get('host')}`;
    notifyClientCuratedRecsSent({
      clientEmail: ws.clientEmail,
      workspaceName: ws.name,
      workspaceId,
      recCount: 1,
      dashboardUrl: buildClientPortalUrl(origin, workspaceId),
    });
  }
  res.json(rec);
});

// Strike a rec (lifecycle: active → struck; stamps struckAt). Permanent suppression — the rec
// won't be re-suggested. rec_struck is ADMIN-ONLY activity (must never read as "we decided not
// to do this" to the client). The arm-then-confirm UX is client-side (Lane B); the server
// commits a single struck transition + keeps Undo open via /unstrike.
router.patch('/api/recommendations/:workspaceId/:recId/strike', requireWorkspaceAccess('workspaceId'), (req, res) => {
  const { workspaceId, recId } = req.params;
  let rec: Recommendation | null;
  try {
    rec = strikeRecommendation(workspaceId, recId);
  } catch (err) {
    if (err instanceof InvalidTransitionError) return res.status(400).json({ error: err.message });
    throw err;
  }
  if (!rec) return res.status(404).json({ error: 'Recommendation not found' });
  invalidateIntelligenceCache(workspaceId);
  broadcastToWorkspace(workspaceId, WS_EVENTS.RECOMMENDATIONS_UPDATED, { recId, lifecycle: 'struck' });
  addActivity(workspaceId, 'rec_struck', `Recommendation struck: ${rec.title}`, rec.description);
  res.json(rec);
});

// Undo a strike (lifecycle: struck → active). Clears the lifecycle suppression + cascade
// metadata; the strategy-item restore for reversible cascade is a Phase-5 caller concern.
router.patch('/api/recommendations/:workspaceId/:recId/unstrike', requireWorkspaceAccess('workspaceId'), (req, res) => {
  const { workspaceId, recId } = req.params;
  let rec: Recommendation | null;
  try {
    rec = unstrikeRecommendation(workspaceId, recId);
  } catch (err) {
    if (err instanceof InvalidTransitionError) return res.status(400).json({ error: err.message });
    throw err;
  }
  if (!rec) return res.status(404).json({ error: 'Recommendation not found' });
  invalidateIntelligenceCache(workspaceId);
  broadcastToWorkspace(workspaceId, WS_EVENTS.RECOMMENDATIONS_UPDATED, { recId, lifecycle: 'active' });
  addActivity(workspaceId, 'rec_status_updated', `Recommendation strike undone: ${rec.title}`, 'Restored to active');
  res.json(rec);
});

// Throttle a rec (lifecycle: active → throttled) for 7/30/90 days. Resurface is ON-READ
// (no cron) — isActiveRec re-includes it once throttledUntil passes.
router.patch('/api/recommendations/:workspaceId/:recId/throttle', requireWorkspaceAccess('workspaceId'), (req, res) => {
  const { workspaceId, recId } = req.params;
  const days = req.body?.days;
  if (days !== 7 && days !== 30 && days !== 90) {
    return res.status(400).json({ error: 'days must be one of 7, 30, 90' });
  }
  let rec: Recommendation | null;
  try {
    rec = throttleRecommendation(workspaceId, recId, days);
  } catch (err) {
    if (err instanceof InvalidTransitionError) return res.status(400).json({ error: err.message });
    throw err;
  }
  if (!rec) return res.status(404).json({ error: 'Recommendation not found' });
  invalidateIntelligenceCache(workspaceId);
  broadcastToWorkspace(workspaceId, WS_EVENTS.RECOMMENDATIONS_UPDATED, { recId, lifecycle: 'throttled' });
  addActivity(workspaceId, 'rec_throttled', `Recommendation throttled ${days}d: ${rec.title}`, rec.description);
  res.json(rec);
});

// Fix — mark the rec as agency-executed work (routes to the existing RecStatus completion spine
// via the single-writer). Distinct from Send; this is "we'll do it ourselves" on the INTERNAL
// triage axis — NOT a clientStatus change.
router.patch('/api/recommendations/:workspaceId/:recId/fix', requireWorkspaceAccess('workspaceId'), (req, res) => {
  const { workspaceId, recId } = req.params;
  let rec: Recommendation | null;
  try {
    rec = fixRecommendation(workspaceId, recId);
  } catch (err) {
    if (err instanceof InvalidTransitionError) return res.status(400).json({ error: err.message });
    throw err;
  }
  if (!rec) return res.status(404).json({ error: 'Recommendation not found' });
  // Greenlight→attribution (spec §7 C5): a SILENT fix still earns "we handled this" credit. Every
  // fix path — client-greenlit OR operator-silent — creates a TrackedAction ('platform_executed');
  // the only difference is whether it surfaced as a client decision. Idempotent: keyed to the rec id
  // so a rec already credited (e.g. a prior act-on or the completion route) is not double-recorded.
  try {
    if (!getActionBySource('recommendation', rec.id)) {
      recordAction({ // recordAction-ok: workspaceId is the path param on an admin-gated route
        workspaceId,
        actionType: recommendationOutcomeActionType(rec.type, rec.source),
        sourceType: 'recommendation',
        sourceId: rec.id,
        pageUrl: rec.affectedPages?.[0] ?? null,
        targetKeyword: rec.targetKeyword ?? null,
        baselineSnapshot: { captured_at: new Date().toISOString() },
        predictedEmv: rec.opportunity?.predictedEmv ?? null,
        attribution: 'platform_executed',
      });
    }
  } catch (err) {
    log.warn({ err, recId: rec.id }, 'Failed to record attribution for silent /fix');
  }
  invalidateIntelligenceCache(workspaceId);
  broadcastToWorkspace(workspaceId, WS_EVENTS.RECOMMENDATIONS_UPDATED, { recId, status: rec.status });
  addActivity(workspaceId, 'rec_status_updated', `Recommendation marked as agency work: ${rec.title}`, rec.description);
  res.json(rec);
});

// Read a rec's discussion thread (admin cockpit Discuss filter). Read-only — no mutation,
// no broadcast, no activity log entry.
router.get('/api/recommendations/:workspaceId/:recId/discussion', requireWorkspaceAccess('workspaceId'), (req, res) => { // activity-ok: read-only
  const { workspaceId, recId } = req.params;
  res.json(listRecDiscussion(workspaceId, recId));
});

// Append a strategist reply to a rec's discussion thread. Broadcasts the discussion-specific
// event so the cockpit Discuss filter + the client thread re-fetch.
router.post('/api/recommendations/:workspaceId/:recId/discussion', requireWorkspaceAccess('workspaceId'), (req, res) => {
  const { workspaceId, recId } = req.params;
  const body = typeof req.body?.body === 'string' ? req.body.body.trim() : '';
  if (!body) return res.status(400).json({ error: 'body must be a non-empty string' });
  const entry = addRecDiscussionEntry(workspaceId, recId, 'strategist', body);
  broadcastToWorkspace(workspaceId, WS_EVENTS.RECOMMENDATIONS_DISCUSSION_UPDATED, { recId });
  addActivity(workspaceId, 'rec_status_updated', `Strategist replied on: ${recId}`, body);
  res.json(entry);
});

export default router;
