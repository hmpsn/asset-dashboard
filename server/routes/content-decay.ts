/**
 * Content Decay routes — analyze decaying content, generate refresh recommendations
 */
import { Router } from 'express';
import { analyzeContentDecay, loadDecayAnalysis, generateBatchRecommendations } from '../content-decay.js';
import { refreshContentDecayInsights } from '../analytics-intelligence.js';
import { getWorkspace } from '../workspaces.js';
import { requireWorkspaceAccess } from '../auth.js';
import { requireClientPortalAuth } from '../middleware.js';
import { createLogger } from '../logger.js';
import { recordAction, getActionByWorkspaceAndSource } from '../outcome-tracking.js';
import { fireBridge } from '../bridge-infrastructure.js';
import { createSuggestedBrief } from '../suggested-briefs-store.js';
import { broadcastToWorkspace } from '../broadcast.js';
import { WS_EVENTS } from '../ws-events.js';

const router = Router();
const log = createLogger('content-decay');

// Run decay analysis for a workspace
router.post('/api/content-decay/:workspaceId/analyze', requireWorkspaceAccess('workspaceId'), async (req, res) => {
  try {
    const ws = getWorkspace(req.params.workspaceId);
    if (!ws) return res.status(404).json({ error: 'Workspace not found' });
    const analysis = await analyzeContentDecay(ws);

    // Refresh content_decay insights so the insights page reflects fresh data
    // immediately instead of waiting for the 24-hour staleness window.
    try {
      await refreshContentDecayInsights(ws.id);
    } catch (err) {
      log.warn({ err, workspaceId: ws.id }, 'Failed to refresh content decay insights after analysis');
    }

    // Bridge #2: Create suggested briefs for top decaying pages
    fireBridge('bridge-decay-suggested-brief', ws.id, () => {
      const topDecaying = analysis.decayingPages.slice(0, 5);
      for (const page of topDecaying) {
        const clickDelta = page.currentClicks - page.previousClicks;
        createSuggestedBrief({
          workspaceId: ws.id,
          keyword: page.title || page.page,
          pageUrl: page.page,
          source: 'content_decay',
          reason: `Content decay: ${Math.abs(clickDelta)} fewer clicks (${page.clickDeclinePct.toFixed(0)}% decline), severity: ${page.severity}`,
          priority: page.severity === 'critical' ? 'high' : page.severity === 'warning' ? 'medium' : 'low',
        });
      }
      if (topDecaying.length > 0) {
        // This bridge dispatches a domain-specific SUGGESTED_BRIEF_UPDATED
        // event, not the generic INSIGHT_BRIDGE_UPDATED that
        // executeBridge() auto-broadcasts when a BridgeResult is returned.
        // The event payload carries `count` so the suggested-briefs panel
        // can refresh its specific list without invalidating every
        // insight cache. Keeping the inline broadcast is intentional.
        // bridge-broadcast-ok
        broadcastToWorkspace(ws.id, WS_EVENTS.SUGGESTED_BRIEF_UPDATED, {
          bridge: 'bridge_2_decay_suggested_brief',
          count: topDecaying.length,
        });
      }
    });

    res.json(analysis);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: msg });
  }
});

// Get cached decay analysis
router.get('/api/content-decay/:workspaceId', requireWorkspaceAccess('workspaceId'), (req, res) => {
  const analysis = loadDecayAnalysis(req.params.workspaceId);
  if (!analysis) return res.json(null);
  res.json(analysis);
});

// Generate AI refresh recommendations for top decaying pages
router.post('/api/content-decay/:workspaceId/recommendations', requireWorkspaceAccess('workspaceId'), async (req, res) => {
  try {
    const ws = getWorkspace(req.params.workspaceId);
    if (!ws) return res.status(404).json({ error: 'Workspace not found' });
    const existing = loadDecayAnalysis(req.params.workspaceId);
    if (!existing) return res.status(404).json({ error: 'Run decay analysis first' });
    const maxPages = req.body.maxPages || 5;
    const updated = await generateBatchRecommendations(ws, existing, maxPages);

    try {
      for (const rec of updated.decayingPages?.slice(0, 3) ?? []) {
        const sourceId = rec.page ?? null;
        if (!sourceId) continue;
        if (getActionByWorkspaceAndSource(req.params.workspaceId, 'content_decay', sourceId)) continue;
        if (req.params.workspaceId) {
          recordAction({ // recordAction-ok: workspaceId guarded by if (req.params.workspaceId)
            workspaceId: req.params.workspaceId,
            actionType: 'content_refreshed',
            sourceType: 'content_decay',
            sourceId,
            pageUrl: sourceId,
            targetKeyword: null,
            baselineSnapshot: { captured_at: new Date().toISOString() },
            attribution: 'not_acted_on',
          });
        }
      }
    } catch (err) {
      log.warn({ err }, 'Failed to record outcome actions for decay recommendations');
    }

    res.json(updated);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: msg });
  }
});

// Public: Get decay analysis (client dashboard)
router.get('/api/public/content-decay/:workspaceId', requireClientPortalAuth(), (req, res) => {
  const analysis = loadDecayAnalysis(req.params.workspaceId);
  if (!analysis) return res.json(null);
  res.json(analysis);
});

export default router;
