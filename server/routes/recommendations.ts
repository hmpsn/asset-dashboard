/**
 * recommendations routes — extracted from server/index.ts
 */
import { Router } from 'express';

import { requireWorkspaceAccess } from '../auth.js';
const router = Router();

import {
  generateRecommendations,
  loadRecommendations,
  updateRecommendationStatus,
  dismissRecommendation,
} from '../recommendations.js';
import { getLatestSnapshot } from '../reports.js';
import { updatePageState, getPageIdBySlug, getWorkspace } from '../workspaces.js';

// ─── Recommendation Engine ─────────────────────────────────────────
// Generate (or re-generate) prioritized recommendations for a workspace
router.post('/api/public/recommendations/:workspaceId/generate', async (req, res) => {
  try {
    const set = await generateRecommendations(req.params.workspaceId);
    res.json(set);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// List current recommendations (returns cached set, or generates if none exist)
router.get('/api/public/recommendations/:workspaceId', async (req, res) => {
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

// Update recommendation status (pending → in_progress → completed)
router.patch('/api/public/recommendations/:workspaceId/:recId', (req, res) => {
  const { status } = req.body;
  if (!status || !['pending', 'in_progress', 'completed', 'dismissed'].includes(status)) {
    return res.status(400).json({ error: 'Valid status required: pending, in_progress, completed, dismissed' });
  }
  const rec = updateRecommendationStatus(req.params.workspaceId, req.params.recId, status);
  if (!rec) return res.status(404).json({ error: 'Recommendation not found' });
  // When recommendation is completed, mark affected pages as live
  if (status === 'completed' && rec.affectedPages && rec.affectedPages.length > 0) {
    const workspaceId = req.params.workspaceId;
    // Build slug→pageId map from audit snapshot
    const slugToPageId = new Map<string, string>();
    const ws = getWorkspace(workspaceId);
    if (ws?.webflowSiteId) {
      const snapshot = getLatestSnapshot(ws.webflowSiteId);
      if (snapshot) {
        for (const page of snapshot.audit.pages) {
          const slug = page.slug.replace(/^\//, '');
          slugToPageId.set(slug, page.pageId);
          slugToPageId.set(`/${slug}`, page.pageId);
        }
      }
    }
    // Check which pages still have other active recommendations
    const allRecs = loadRecommendations(workspaceId);
    const pagesWithActiveRecs = new Set<string>();
    if (allRecs) {
      for (const r of allRecs.recommendations) {
        if (r.id !== rec.id && r.status !== 'completed' && r.status !== 'dismissed') {
          for (const p of r.affectedPages) pagesWithActiveRecs.add(p);
        }
      }
    }
    for (const pageSlug of rec.affectedPages) {
      if (pagesWithActiveRecs.has(pageSlug)) continue;
      const resolvedPageId = slugToPageId.get(pageSlug)
        ?? getPageIdBySlug(workspaceId, pageSlug)
        ?? pageSlug;
      updatePageState(workspaceId, resolvedPageId, {
        status: 'live',
        source: 'recommendation',
        recommendationId: rec.id,
      });
    }
  }
  res.json(rec);
});

// Dismiss a recommendation
router.delete('/api/public/recommendations/:workspaceId/:recId', (req, res) => {
  const ok = dismissRecommendation(req.params.workspaceId, req.params.recId);
  if (!ok) return res.status(404).json({ error: 'Recommendation not found' });
  res.json({ ok: true });
});

export default router;
