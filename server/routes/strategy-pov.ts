import { Router } from 'express';
import { requireWorkspaceAccess } from '../auth.js';
import { aiLimiter } from '../middleware.js';
import { validate, z } from '../middleware/validate.js';
import { getStrategyPov, bumpStrategyPovVersion } from '../strategy-pov-store.js';
import { generateStrategyPov, POV_UNCHANGED } from '../strategy-pov-generator.js';
import { invalidateIntelligenceCache } from '../workspace-intelligence.js';
import { broadcastToWorkspace } from '../broadcast.js';
import { WS_EVENTS } from '../ws-events.js';
import { addActivity } from '../activity-log.js';
import { createLogger } from '../logger.js';
import { randomUUID } from 'crypto';
import type { StrategyPovVariant } from '../../shared/types/strategy-pov.js';

const log = createLogger('strategy-pov-routes');
const router = Router();

const variantQuerySchema = z.enum(['admin', 'client']);

function readVariant(raw: unknown): StrategyPovVariant {
  const parsed = variantQuerySchema.safeParse(raw);
  return parsed.success ? parsed.data : 'admin';
}

// Operator edit body — every field optional; clearing is allowed (empty string / empty array).
// leadMoveRecId may be cleared to null. Cross-referenced against StrategyPov (shared/types).
const patchPovSchema = z.object({
  situation: z.string().optional(),
  leadSentence: z.string().optional(),
  wins: z.array(z.string()).optional(),
  flags: z.array(z.string()).optional(),
  leadMoveRecId: z.string().nullable().optional(),
});

// GET /api/workspaces/:workspaceId/strategy-pov — resolved POV (override ∪ draft), null if none.
router.get(
  '/api/workspaces/:workspaceId/strategy-pov',
  requireWorkspaceAccess('workspaceId'),
  (req, res) => {
    try {
      const pov = getStrategyPov(req.params.workspaceId);
      res.json({ pov });
    } catch (err) {
      log.error({ err, workspaceId: req.params.workspaceId }, 'Failed to fetch strategy POV');
      res.status(500).json({ error: 'Failed to fetch strategy POV' });
    }
  },
);

// POST /api/workspaces/:workspaceId/strategy-pov/generate — generate (or return cached on no-change).
// Literal segment 'generate' registered before the deeper PATCH/param routes (route ordering rule).
router.post(
  '/api/workspaces/:workspaceId/strategy-pov/generate',
  requireWorkspaceAccess('workspaceId'),
  aiLimiter,
  async (req, res) => {
    const { workspaceId } = req.params;
    const variant = readVariant(req.query.variant);
    try {
      const pov = await generateStrategyPov(workspaceId, { variant });
      addActivity(workspaceId, 'strategy_pov_generated', 'Strategy POV generated');
      res.json({ pov });
    } catch (err) {
      if (err instanceof Error && err.message === POV_UNCHANGED) {
        try {
          const existing = getStrategyPov(workspaceId);
          if (!existing) {
            log.error({ workspaceId }, 'POV_UNCHANGED received but no cached POV exists');
            res.status(500).json({ error: 'Failed to generate strategy POV' });
            return;
          }
          res.json({ pov: existing, unchanged: true });
        } catch (readErr) {
          log.error({ readErr, workspaceId }, 'Failed to read cached POV after POV_UNCHANGED');
          res.status(500).json({ error: 'Failed to generate strategy POV' });
        }
        return;
      }
      log.error({ err, workspaceId }, 'Failed to generate strategy POV');
      res.status(500).json({ error: 'Failed to generate strategy POV' });
    }
  },
);

// POST /api/workspaces/:workspaceId/strategy-pov/regenerate — force a fresh draft (bypass cache).
router.post(
  '/api/workspaces/:workspaceId/strategy-pov/regenerate',
  requireWorkspaceAccess('workspaceId'),
  aiLimiter,
  async (req, res) => {
    const { workspaceId } = req.params;
    const variant = readVariant(req.query.variant);
    try {
      const pov = await generateStrategyPov(workspaceId, { variant, regenerateNonce: randomUUID() });
      addActivity(workspaceId, 'strategy_pov_generated', 'Strategy POV regenerated');
      res.json({ pov });
    } catch (err) {
      log.error({ err, workspaceId }, 'Failed to regenerate strategy POV');
      res.status(500).json({ error: 'Failed to regenerate strategy POV' });
    }
  },
);

// PATCH /api/workspaces/:workspaceId/strategy-pov — operator edit: bump version, persist override,
// broadcast STRATEGY_POV_GENERATED, invalidate the intelligence cache (the POV feeds AI context).
router.patch(
  '/api/workspaces/:workspaceId/strategy-pov',
  requireWorkspaceAccess('workspaceId'),
  validate(patchPovSchema),
  (req, res) => {
    const { workspaceId } = req.params;
    try {
      const next = bumpStrategyPovVersion(workspaceId, req.body);
      if (!next) {
        res.status(404).json({ error: 'No strategy POV to edit — generate one first' });
        return;
      }
      addActivity(workspaceId, 'strategy_pov_generated', 'Strategy POV edited');
      broadcastToWorkspace(workspaceId, WS_EVENTS.STRATEGY_POV_GENERATED, {});
      invalidateIntelligenceCache(workspaceId);
      res.json({ pov: next });
    } catch (err) {
      log.error({ err, workspaceId }, 'Failed to edit strategy POV');
      res.status(500).json({ error: 'Failed to edit strategy POV' });
    }
  },
);

export default router;
