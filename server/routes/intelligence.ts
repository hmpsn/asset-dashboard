// server/routes/intelligence.ts
// Intelligence API endpoint — serves WorkspaceIntelligence to frontend.
// Spec: docs/superpowers/specs/unified-workspace-intelligence.md §8

import { Router } from 'express';
import { requireWorkspaceAccess } from '../auth.js';
import { buildWorkspaceIntelligence, getIntelligenceCacheStats } from '../workspace-intelligence.js';
import { getPageCacheStats } from '../workspace-data.js';
import { createLogger } from '../logger.js';
import { getBridgeFlags } from '../bridge-infrastructure.js';
import type { IntelligenceSlice } from '../../shared/types/intelligence.js';

const log = createLogger('intelligence-route');

const VALID_SLICES: Set<string> = new Set([
  'seoContext', 'insights', 'learnings', 'pageProfile',
  'contentPipeline', 'siteHealth', 'clientSignals', 'operational',
]);

const router = Router();

// GET /api/intelligence/health — cache stats for observability (§18)
// MUST be registered BEFORE the :workspaceId param route to avoid shadowing
router.get('/api/intelligence/health', (_req, res) => {
  res.json({
    caches: {
      intelligence: getIntelligenceCacheStats(),
      pages: getPageCacheStats(),
    },
    bridgeFlags: getBridgeFlags(),
  });
});

// GET /api/intelligence/:workspaceId — fetch intelligence for a workspace
router.get(
  '/api/intelligence/:workspaceId',
  requireWorkspaceAccess('workspaceId'),
  async (req, res) => {
    try {
      const { workspaceId } = req.params;
      const slicesParam = req.query.slices as string | undefined;
      const pagePath = req.query.pagePath as string | undefined;
      const learningsDomain = req.query.learningsDomain as 'content' | 'strategy' | 'technical' | 'all' | undefined;

      // Parse slices from comma-separated query param
      let slices: IntelligenceSlice[] | undefined;
      if (slicesParam) {
        const requested = slicesParam.split(',').filter(s => VALID_SLICES.has(s));
        if (requested.length > 0) {
          slices = requested as IntelligenceSlice[];
        }
      }

      const intelligence = await buildWorkspaceIntelligence(workspaceId, { // bwi-all-ok: admin endpoint, intentionally assembles all slices when no param provided
        slices,
        pagePath: pagePath || undefined,
        learningsDomain: learningsDomain || undefined,
      });

      res.json(intelligence);
    } catch (err) {
      log.error({ err, workspaceId: req.params.workspaceId }, 'Intelligence fetch failed');
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    }
  },
);

export default router;
