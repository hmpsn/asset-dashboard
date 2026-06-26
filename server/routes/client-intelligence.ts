/**
 * client-intelligence.ts — Client-facing intelligence endpoint
 * Spec: docs/superpowers/specs/unified-workspace-intelligence.md §23
 *
 * Tier-gated, scrubbed view of WorkspaceIntelligence. NEVER returns:
 * knowledgeBase, brandVoice, churnRisk, impact_score, operational slice,
 * strategy_alignment insight type, or bridge source tags.
 */
import { Router } from 'express';
import { requireClientPortalAuth } from '../middleware.js';
import { computeEffectiveTier, getWorkspace } from '../workspaces.js';
import { buildWorkspaceIntelligence } from '../workspace-intelligence.js';
import { createLogger } from '../logger.js';
import {
  buildClientIntelligenceView,
  clientIntelligenceSlicesForTier,
} from '../client-insight-view-model.js';

const router = Router();
const log = createLogger('client-intelligence');

// GET /api/public/intelligence/:workspaceId
router.get('/api/public/intelligence/:workspaceId', requireClientPortalAuth(), async (req, res) => {
  const ws = getWorkspace(req.params.workspaceId);
  if (!ws) return res.status(404).json({ error: 'Workspace not found' });

  const tier = computeEffectiveTier(ws);
  const slices = clientIntelligenceSlicesForTier(tier);

  try {
    const intel = await buildWorkspaceIntelligence(ws.id, { slices });
    const response = buildClientIntelligenceView(intel, tier);

    return res.json(response);
  } catch (err) {
    log.error({ workspaceId: ws.id, err }, 'Client intelligence assembly failed');
    return res.status(500).json({ error: 'Intelligence unavailable — try again shortly' });
  }
});

export default router;
