/**
 * recommendations routes — extracted from server/index.ts
 */
import { Router } from 'express';

import { requireClientPortalAuth } from '../middleware.js';
import { createLogger } from '../logger.js';
import { recordAction, getActionBySource } from '../outcome-tracking.js';
import {
  generateRecommendations,
  loadRecommendations,
  updateRecommendationStatus,
  dismissRecommendation,
} from '../recommendations.js';
import { getLatestSnapshot } from '../reports.js';
import { updatePageState, getPageIdBySlug, getWorkspace } from '../workspaces.js';
import { normalizePageUrl } from '../helpers.js';
import { broadcastToWorkspace } from '../broadcast.js';
import { WS_EVENTS } from '../ws-events.js';
import { invalidateIntelligenceCache } from '../workspace-intelligence.js';

const log = createLogger('routes:recommendations');
const router = Router();

// ─── Recommendation Engine ─────────────────────────────────────────
// Generate (or re-generate) prioritized recommendations for a workspace
router.post('/api/public/recommendations/:workspaceId/generate', async (req, res) => { // public-no-auth-ok: deferred to audit-drift-public-route-auth-sweep-followup
  try {
    const set = await generateRecommendations(req.params.workspaceId);
    res.json(set);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// List current recommendations (returns cached set, or generates if none exist)
router.get('/api/public/recommendations/:workspaceId', async (req, res) => { // public-no-auth-ok: deferred to audit-drift-public-route-auth-sweep-followup
  try {
    let set = loadRecommendations(req.params.workspaceId);
    if (!set) {
      // Auto-generate on first request
      set = await generateRecommendations(req.params.workspaceId);
    }
    // Filter by status if requested
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
  const rec = updateRecommendationStatus(workspaceId, recId, status);
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
    // Record for outcome tracking — idempotent
    try {
      if (workspaceId && !getActionBySource('recommendation', recId)) recordAction({ // recordAction-ok: workspaceId guarded by if condition
        workspaceId,
        actionType: 'audit_fix_applied',
        sourceType: 'recommendation',
        sourceId: recId,
        pageUrl: rec.affectedPages?.[0] ?? null,
        targetKeyword: null,
        baselineSnapshot: {
          captured_at: new Date().toISOString(),
        },
        attribution: 'platform_executed',
      });
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
  res.json(rec);
});

// Dismiss a recommendation
router.delete('/api/public/recommendations/:workspaceId/:recId', requireClientPortalAuth(), (req, res) => {
  const { workspaceId, recId } = req.params;
  const ok = dismissRecommendation(workspaceId, recId);
  if (!ok) return res.status(404).json({ error: 'Recommendation not found' });
  invalidateIntelligenceCache(workspaceId);
  broadcastToWorkspace(workspaceId, WS_EVENTS.RECOMMENDATIONS_UPDATED, { recId, status: 'dismissed', deleted: true });
  res.json({ ok: true });
});

export default router;
