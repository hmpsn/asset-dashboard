/**
 * recommendations routes — extracted from server/index.ts
 */
import { Router } from 'express';

import { requireClientPortalAuth } from '../middleware.js';
import { createLogger } from '../logger.js';
import { recordAction, getActionBySource } from '../outcome-tracking.js';
import {
  loadRecommendations,
  computeRecommendationSummary,
  updateRecommendationStatus,
  dismissRecommendation,
  recommendationOutcomeActionType,
} from '../recommendations.js';
import { createJob, hasActiveJob } from '../jobs.js';
import { runRecommendationGenerationJob } from '../recommendation-generation-job.js';
import { captureBaselineFromGsc } from '../outcome-measurement.js';
import { getLatestSnapshot } from '../reports.js';
import { updatePageState, getPageIdBySlug, getWorkspace } from '../workspaces.js';
import { normalizePageUrl } from '../helpers.js';
import { broadcastToWorkspace } from '../broadcast.js';
import { WS_EVENTS } from '../ws-events.js';
import { invalidateIntelligenceCache } from '../workspace-intelligence.js';
import { BACKGROUND_JOB_TYPES } from '../../shared/types/background-jobs.js';
import type { Recommendation, RecommendationSet } from '../../shared/types/recommendations.js';

const log = createLogger('routes:recommendations');
const router = Router();

/**
 * Strip the admin/AI-only dollar/ROI fields from each rec before responding on a
 * PUBLIC (client-facing) route. Per owner decision the client sees the ROI badge +
 * relative value + component breakdown bars, never the raw $/wk exposure
 * (`emvPerWeek`), the horizon projection (`predictedEmv`, P4 — a CPC-proxy that
 * would read as a dollar figure), nor the internal ROI quantity (`roiPerEffortDay`).
 * The rest of the OpportunityScore (value, confidence, groundedSpine, components,
 * calibration, calibrationVersion, modelVersion) is preserved so the client #1 card
 * can render its "why this is #1" breakdown.
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

function stripEmvFromPublicRecs(recs: Recommendation[]): Recommendation[] {
  return recs.map(r => {
    // Sanitize the top-level gain string (defense-in-depth: no raw $/wk to a client).
    const safeGain = typeof r.estimatedGain === 'string' ? sanitizePublicGain(r.estimatedGain) : r.estimatedGain;
    const base: Recommendation = safeGain === r.estimatedGain ? r : { ...r, estimatedGain: safeGain };
    if (!base.opportunity) return base;
    const { emvPerWeek: _emvPerWeek, predictedEmv: _predictedEmv, roiPerEffortDay: _roiPerEffortDay, ...publicOpportunity } = base.opportunity;
    return { ...base, opportunity: publicOpportunity as Recommendation['opportunity'] };
  });
}

/** Public-route response: a RecommendationSet whose recs have emvPerWeek stripped. */
function toPublicRecommendationSet(set: RecommendationSet, recs: Recommendation[]): RecommendationSet {
  return { ...set, recommendations: stripEmvFromPublicRecs(recs) };
}

// ─── Recommendation Engine ─────────────────────────────────────────
// Generate (or re-generate) prioritized recommendations for a workspace.
// Soft-gated (requireClientPortalAuth): password-set workspaces require a
// session; passwordless/demo portals pass through (the client calls this with a
// cookie-only fetch). Matches the sibling PATCH/DELETE routes below.
router.post('/api/public/recommendations/:workspaceId/generate', requireClientPortalAuth(), async (req, res) => {
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
    let recs = set.recommendations;
    if (status) recs = recs.filter(r => r.status === status);
    if (priority) recs = recs.filter(r => r.priority === priority);
    res.json(toPublicRecommendationSet(set, recs));
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// Update recommendation status (pending → in_progress → completed).
// This endpoint IS the rec-completion path — it sets the recommendation to
// completed and mirrors the affected pages to live state. There is no separate
// rec to resolve; resolving here would be circular.
// rec-refresh-ok
router.patch('/api/public/recommendations/:workspaceId/:recId', requireClientPortalAuth(), (req, res) => {
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
  // Client-facing single-rec response — strip the admin/AI-only dollar figures
  // (emvPerWeek / roiPerEffortDay) just like the GET route does (owner constraint).
  res.json(stripEmvFromPublicRecs([rec])[0]);
});

// Dismiss a recommendation
router.delete('/api/public/recommendations/:workspaceId/:recId', requireClientPortalAuth(), (req, res) => {
  const { workspaceId, recId } = req.params;
  let ok: boolean;
  try {
    ok = dismissRecommendation(workspaceId, recId);
  } catch (err) {
    return res.status(400).json({ error: err instanceof Error ? err.message : 'Invalid status transition' });
  }
  if (!ok) return res.status(404).json({ error: 'Recommendation not found' });
  invalidateIntelligenceCache(workspaceId);
  broadcastToWorkspace(workspaceId, WS_EVENTS.RECOMMENDATIONS_UPDATED, { recId, status: 'dismissed', deleted: true });
  res.json({ ok: true });
});

export default router;
