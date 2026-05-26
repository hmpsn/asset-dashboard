// server/routes/intelligence.ts
// Intelligence API endpoint — serves WorkspaceIntelligence to frontend.
// Spec: docs/superpowers/specs/unified-workspace-intelligence.md §8

import { Router } from 'express';
import { requireWorkspaceAccess } from '../auth.js';
import { buildWorkspaceIntelligence, getIntelligenceCacheStats } from '../workspace-intelligence.js';
import { getPageCacheStats } from '../workspace-data.js';
import { createLogger } from '../logger.js';
import { getBridgeFlags } from '../bridge-infrastructure.js';
import { isIntelligenceSlice } from '../../shared/types/intelligence.js';
import type { IntelligenceOptions, IntelligenceSlice } from '../../shared/types/intelligence.js';

const log = createLogger('intelligence-route');

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
      const siteId = req.query.siteId as string | undefined;
      const siteBaseUrl = req.query.siteBaseUrl as string | undefined;

      // Parse slices from comma-separated query param
      let slices: IntelligenceSlice[] | undefined;
      if (slicesParam) {
        const requested = slicesParam.split(',').map(s => s.trim()).filter(isIntelligenceSlice);
        if (requested.length > 0) {
          slices = requested;
        } else {
          return res.status(400).json({ error: 'No valid intelligence slices specified' });
        }
      }

      const opts: IntelligenceOptions = {
        slices,
        pagePath: pagePath || undefined,
        learningsDomain: learningsDomain || undefined,
        siteId: siteId || undefined,
        siteBaseUrl: siteBaseUrl || undefined,
      };

      const intelligence = await buildWorkspaceIntelligence(workspaceId, opts); // bwi-all-ok: admin endpoint intentionally assembles all registered slices when no slices param is provided

      res.json(intelligence);
    } catch (err) {
      log.error({ err, workspaceId: req.params.workspaceId }, 'Intelligence fetch failed');
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    }
  },
);

export default router;
