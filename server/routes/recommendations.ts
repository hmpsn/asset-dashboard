/**
 * recommendations routes — extracted from server/index.ts
 */
import crypto from 'crypto';
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
  saveRecommendations,
  computeRecommendationSummary,
  updateRecommendationStatus,
  dismissRecommendation,
  recommendationOutcomeActionType,
} from '../recommendations.js';
import {
  sendRecommendation,
  strikeRecommendation,
  unstrikeRecommendation,
  throttleRecommendation,
  fixRecommendation,
  approveRecommendation,
} from '../recommendation-lifecycle.js';
import { addRecDiscussionEntry, listRecDiscussion } from '../rec-discussion.js';
import { notifyClientCuratedRecsSent } from '../email.js';
import { createJob, hasActiveJob } from '../jobs.js';
import { runRecommendationGenerationJob } from '../recommendation-generation-job.js';
import { captureBaselineFromGsc } from '../outcome-measurement.js';
import { getLatestSnapshot } from '../reports.js';
import { updatePageState, getPageIdBySlug, getWorkspace, buildClientPortalUrl } from '../workspaces.js';
import { normalizePageUrl } from '../helpers.js';
import { broadcastToWorkspace } from '../broadcast.js';
import { WS_EVENTS } from '../ws-events.js';
import { invalidateIntelligenceCache } from '../workspace-intelligence.js';
import { BACKGROUND_JOB_TYPES } from '../../shared/types/background-jobs.js';
import { addActivity } from '../activity-log.js';
import {
  RECOMMENDATION_TRANSITIONS,
  validateTransition,
  InvalidTransitionError,
} from '../state-machines.js';
import type { Recommendation, RecommendationSet, ClientFacingClientStatus, ClientRecResponseSummary } from '../../shared/types/recommendations.js';
import { computeImpactBand } from '../../shared/types/impact-band.js';
import { mirrorRecommendationToDeliverable } from '../domains/inbox/recommendation-dual-write.js';
import { createContentRequest } from '../content-requests.js';
import { buildStrategyCardContextFromRec } from '../recommendation-strategy-card-context.js';
import type { StrategyCardContext } from '../../shared/types/content.js';

const log = createLogger('routes:recommendations');
const router = Router();

/**
 * Strip the admin/AI-only dollar/ROI fields from each rec before responding on a
 * PUBLIC (client-facing) route. Per owner decision the client sees the ROI badge +
 * relative value + component breakdown bars, never the raw $/wk exposure
 * (`emvPerWeek`), the horizon projection (`predictedEmv`, P4 — a CPC-proxy that
 * would read as a dollar figure), nor the internal ROI quantity (`roiPerEffortDay`).
 * The OpportunityScore is allow-listed (value, confidence, groundedSpine, components,
 * calibration, calibrationVersion, modelVersion pass through; the raw $/ROI fields above
 * are dropped) so the client #1 card can still render its "why this is #1" breakdown.
 * (The projection below is an explicit allow-list, not a strip-from-spread — see the
 * note above stripEmvFromPublicRecs.)
 *
 * `estimatedGain` (P4, Contract 3) is a TOP-LEVEL rec field, NOT inside `opportunity`,
 * and it renders LIVE at InsightsEngine.tsx. The chosen gain form is NON-DOLLARIZED
 * (an outcome-oriented relative-magnitude phrase — see buildOvGainString in
 * server/recommendations.ts), so the client sees a real gain string. This function is
 * the always-on safety net: it SANITIZES `estimatedGain` by neutralizing any dollar
 * exposure (a `$nnn` / `$/wk` substring), so even a future dollarized variant (P6) or a
 * renderer that forgets to gate cannot leak a raw money figure to a client. Non-dollarized
 * strings pass through unchanged.
 */
const DOLLAR_EXPOSURE_RE = /\$\s?[\d,.]+(?:\s*\/\s*\w+)?/g;
function sanitizePublicGain(gain: string): string {
  // Replace any "$1,234" / "$1,234/wk" run with a neutral, non-dollarized token.
  const cleaned = gain.replace(DOLLAR_EXPOSURE_RE, 'high-value').trim();
  return cleaned.length > 0 ? cleaned : 'Estimated to drive meaningful organic growth';
}

/** Restricted post-send statuses a client may ever observe (mirrors ClientFacingClientStatus). A
 *  rec in 'system'/'curated' (pre-send operator axis) must NEVER expose its clientStatus to the
 *  client — only the post-send states leak, and only as the restricted value. */
const CLIENT_FACING_STATUSES: readonly ClientFacingClientStatus[] = ['sent', 'approved', 'declined', 'discussing'];
function clientFacingStatus(status: Recommendation['clientStatus']): ClientFacingClientStatus | undefined {
  return status && (CLIENT_FACING_STATUSES as readonly string[]).includes(status)
    ? (status as ClientFacingClientStatus)
    : undefined;
}

/** The shape a public rec read emits: the allow-listed Recommendation fields plus the two
 *  Strategy "The Issue" §7 client-facing projections (restricted clientStatus + synthetic
 *  `delivered`). `delivered` is NOT a DB column — it is derived from the rec's completion state. */
type PublicRecommendation = Recommendation & { delivered?: boolean };

// Strategy v3 (spec §7.4 / 00-contracts §4 readers) — the public rec projection is an explicit
// ALLOW-LIST, not a blocklist. A blocklist (`...rec` minus a few keys) silently leaks every NEW
// admin-only field the moment it is added (the v3 lifecycle axis: throttledUntil/struckAt/sentAt/
// cascade/lifecycle/clientStatus/sendChannel). This names ONLY client-safe fields, so a future
// admin-only field is leak-proof by default. The OpportunityScore is itself allow-listed (raw
// emvPerWeek/predictedEmv/roiPerEffortDay never copied), and estimatedGain is dollar-sanitized.
//
// Strategy "The Issue" §7 (P2-5): a RESTRICTED clientStatus (only the post-send states sent/
// approved/declined/discussing — never the operator-axis system/curated) + a synthetic `delivered`
// flag are projected so the curated client feed can render the loop ("you've greenlit N moves") and
// "what's working" (the client's own delivered moves). A pre-send rec exposes NEITHER (clientStatus
// stays absent → byte-identical to the legacy/flag-OFF read).
function stripEmvFromPublicRecs(recs: Recommendation[], exposeClientStatus = false): PublicRecommendation[] {
  return recs.map((r) => {
    const safeGain = typeof r.estimatedGain === 'string' ? sanitizePublicGain(r.estimatedGain) : r.estimatedGain;
    const out: PublicRecommendation = {
      id: r.id,
      workspaceId: r.workspaceId,
      priority: r.priority,
      type: r.type,
      title: r.title,
      description: r.description,
      insight: r.insight,
      impact: r.impact,
      effort: r.effort,
      impactScore: r.impactScore,
      source: r.source,
      affectedPages: r.affectedPages,
      trafficAtRisk: r.trafficAtRisk,
      impressionsAtRisk: r.impressionsAtRisk,
      estimatedGain: safeGain,
      actionType: r.actionType,
      status: r.status,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    };
    // Client-safe optional fields — copied only when present (preserves byte-identical absence).
    if (r.productType !== undefined) out.productType = r.productType;
    if (r.productPrice !== undefined) out.productPrice = r.productPrice;
    if (r.targetKeyword !== undefined) out.targetKeyword = r.targetKeyword;
    if (r.assignedTo !== undefined) out.assignedTo = r.assignedTo;
    if (r.backfilled !== undefined) out.backfilled = r.backfilled;
    // OpportunityScore: allow-list the client-safe sub-fields; raw $/ROI never copied.
    if (r.opportunity) {
      const { emvPerWeek: rawEmvPerWeek, predictedEmv: _predictedEmv, roiPerEffortDay: _roiPerEffortDay, ...publicOpportunity } = r.opportunity;
      out.opportunity = publicOpportunity as Recommendation['opportunity'];
      // D-IMPACT: project the stripped weekly EMV into a banded monthly impactBand (undefined below floor).
      const impactBand = computeImpactBand(rawEmvPerWeek);
      if (impactBand) out.impactBand = impactBand;
    }
    // Strategy "The Issue" §7 — restricted clientStatus + synthetic `delivered`, projected ONLY when
    // the caller passes exposeClientStatus=true (gated on the per-workspace strategy-the-issue flag).
    // A non-Issue workspace's public read is byte-identical to the legacy payload (NO clientStatus/
    // delivered key). Post-send states only (pre-send recs expose nothing even when ON). `delivered`
    // (RecStatus 'completed') powers "what's working" — the client's own greenlit-and-delivered moves.
    if (exposeClientStatus) {
      const cfStatus = clientFacingStatus(r.clientStatus);
      if (cfStatus) {
        out.clientStatus = cfStatus;
        out.delivered = r.status === 'completed';
      }
    }
    return out;
  });
}

/** Public-route response: a RecommendationSet whose recs have emvPerWeek stripped. */
function toPublicRecommendationSet(set: RecommendationSet, recs: Recommendation[], exposeClientStatus = false): RecommendationSet {
  return { ...set, recommendations: stripEmvFromPublicRecs(recs, exposeClientStatus) };
}

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
    let recs = set.recommendations;
    if (status) recs = recs.filter(r => r.status === status);
    if (priority) recs = recs.filter(r => r.priority === priority);
    if (exposeClientStatus && clientStatus) recs = recs.filter(r => r.clientStatus === clientStatus);
    res.json(toPublicRecommendationSet(set, recs, exposeClientStatus));
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
  res.json(stripEmvFromPublicRecs([rec], isFeatureEnabled('strategy-the-issue', workspaceId))[0]);
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
    if (!getWorkspace(workspaceId)) return res.status(404).json({ error: 'Workspace not found' });

    // Read the rec BEFORE mutating so we can derive the content-request fields + attribution.
    const set = loadRecommendations(workspaceId);
    const recBefore = set?.recommendations.find((r) => r.id === recId) ?? null;
    if (!recBefore) return res.status(404).json({ error: 'Recommendation not found' });

    // Single-writer greenlight: clientStatus sent|discussing → approved (validates the client axis).
    let rec: Recommendation | null;
    try {
      rec = approveRecommendation(workspaceId, recId);
    } catch (err) {
      if (err instanceof InvalidTransitionError) return res.status(400).json({ error: err.message });
      throw err;
    }
    if (!rec) return res.status(404).json({ error: 'Recommendation not found' });

    // Build the StrategyCardContext stamped onto the durable request — the SAME derivation the
    // rec→deliverable adapter uses (one source of truth so the two §7 stamps never drift).
    const cardContext: StrategyCardContext = buildStrategyCardContextFromRec(rec);

    // The durable content REQUEST — nothing generated (briefId stays null; initialStatus 'requested'
    // = queued, no brief yet). A targetKeyword is required by the request model; fall back to the rec
    // title when the rec carries none (e.g. a technical rec) so the request is still durable.
    const targetKeyword = rec.targetKeyword?.trim() || rec.title;
    const request = createContentRequest(workspaceId, {
      topic: rec.title,
      targetKeyword,
      intent: cardContext.intent || 'informational',
      priority: recPriorityToRequestPriority(rec.priority),
      rationale: rec.insight,
      source: 'client',
      recommendationId: rec.id,
      strategyCardContext: cardContext,
      initialStatus: 'requested', // queued; NOTHING generated — the operator works it later
    });

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
    // greenlight took effect) gated on the per-workspace flag.
    res.json({
      recommendation: stripEmvFromPublicRecs([rec], isFeatureEnabled('strategy-the-issue', workspaceId))[0],
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

    // ONE transaction over all N (spec §4.4). The single-writer re-reads the set inside its own
    // txn per rec; better-sqlite3 nests these into this outer txn so the batch commits atomically.
    // Collect mutated recs so activity logging happens AFTER commit (no logs on a rolled-back batch).
    const mutated: Recommendation[] = [];
    const apply = db.transaction(() => {
      for (const recId of recIds) {
        let rec: Recommendation | null = null;
        try {
          if (action === 'send') rec = sendRecommendation(workspaceId, recId);
          else if (action === 'throttle') rec = throttleRecommendation(workspaceId, recId, throttleDays!);
          else rec = strikeRecommendation(workspaceId, recId);
        } catch (err) {
          // An illegal edge for one rec (e.g. already approved/declined on Send) must not roll
          // back the whole batch — skip it. Non-transition errors still propagate (real failures).
          if (err instanceof InvalidTransitionError) continue;
          throw err;
        }
        if (rec) mutated.push(rec);
      }
    });
    apply();

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

    const set = loadRecommendations(workspaceId) ?? {
      workspaceId,
      generatedAt: new Date().toISOString(),
      recommendations: [] as Recommendation[],
      summary: computeRecommendationSummary([]),
    };

    // Idempotent: a competitor rec for the same targetKeyword already exists → return it (no dup).
    const existing = set.recommendations.find(
      r => r.type === 'competitor' && r.targetKeyword === keyword,
    );
    if (existing) return res.json(existing);

    const now = new Date().toISOString();
    const competitorLabel = competitorDomain ? `${competitorDomain} ` : 'A competitor ';
    const rec: Recommendation = {
      id: `rec_${crypto.randomBytes(6).toString('hex')}`,
      workspaceId,
      type: 'competitor',
      priority: 'fix_soon',
      title: title || `Target "${keyword}" (competitor gap)`,
      description:
        description ||
        `${competitorLabel}ranks for "${keyword}" — you don't. Targeting this term captures demand a competitor already owns.`,
      insight:
        insight ||
        `Competitors ranking for high-demand keywords you ignore is lost organic traffic. Building content or optimizing a page for "${keyword}" lets you compete for a term with proven search demand.`,
      impact: 'medium',
      effort: 'medium',
      impactScore: 60,
      source: `competitor:${keyword}`,
      affectedPages: [],
      trafficAtRisk: 0,
      impressionsAtRisk: 0,
      estimatedGain: `Capturing "${keyword}" targets a term a competitor already ranks for`,
      actionType: 'manual',
      targetKeyword: keyword,
      status: 'pending',
      clientStatus: 'system',
      lifecycle: 'active',
      createdAt: now,
      updatedAt: now,
    };

    set.recommendations.push(rec);
    set.summary = computeRecommendationSummary(set.recommendations);
    saveRecommendations(set);
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
