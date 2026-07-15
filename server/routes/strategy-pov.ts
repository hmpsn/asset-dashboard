import { Router } from 'express';
import { requireWorkspaceAccess } from '../auth.js';
import { aiLimiter } from '../middleware.js';
import { validate, z } from '../middleware/validate.js';
import { getStrategyPov, bumpStrategyPovVersion } from '../strategy-pov-store.js';
import {
  generateStrategyPov,
  getStrategyPovRefreshAvailable,
  POV_GENERATION_SUPERSEDED,
  POV_REFRESH_AVAILABLE,
  POV_UNCHANGED,
} from '../strategy-pov-generator.js';
import { invalidateIntelligenceCache } from '../intelligence/cache-invalidation.js';
import { broadcastToWorkspace } from '../broadcast.js';
import { WS_EVENTS } from '../ws-events.js';
import { addActivity } from '../activity-log.js';
import { createLogger } from '../logger.js';
import { randomUUID } from 'crypto';
import type { StrategyPovResponse, StrategyPovVariant } from '../../shared/types/strategy-pov.js';

const log = createLogger('strategy-pov-routes');
const router = Router();

const variantQuerySchema = z.enum(['admin', 'client']);

function readVariant(raw: unknown): StrategyPovVariant {
  const parsed = variantQuerySchema.safeParse(raw);
  return parsed.success ? parsed.data : 'admin';
}

async function readRefreshAvailable(
  workspaceId: string,
  variant: StrategyPovVariant,
): Promise<boolean> {
  try {
    return await getStrategyPovRefreshAvailable(workspaceId, variant);
  } catch (err) {
    // Freshness is advisory metadata. Never hide a last-good operator draft
    // because one intelligence slice was temporarily unavailable.
    log.warn({ err, workspaceId, variant }, 'POV freshness unavailable — returning last-good draft');
    return false;
  }
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
  async (req, res) => {
    try {
      const { workspaceId } = req.params;
      const variant = readVariant(req.query.variant);
      const pov = getStrategyPov(workspaceId);
      const refreshAvailable = pov
        ? await readRefreshAvailable(workspaceId, variant)
        : false;
      res.json({ pov, refreshAvailable } satisfies StrategyPovResponse);
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
      // The POV feeds AI context — invalidate so downstream reads see the fresh draft. The
      // generator already broadcasts STRATEGY_POV_GENERATED; all three write paths
      // (generate / regenerate / PATCH) now invalidate the intelligence cache consistently.
      invalidateIntelligenceCache(workspaceId);
      res.json({ pov, refreshAvailable: false } satisfies StrategyPovResponse);
    } catch (err) {
      if (err instanceof Error && (
        err.message === POV_UNCHANGED
        || err.message === POV_GENERATION_SUPERSEDED
        || err.message === POV_REFRESH_AVAILABLE
      )) {
        try {
          const existing = getStrategyPov(workspaceId);
          if (!existing) {
            log.error({ workspaceId, signal: err.message }, 'POV control signal received but no cached POV exists');
            res.status(500).json({ error: 'Failed to generate strategy POV' });
            return;
          }
          const editPreserved = err.message === POV_REFRESH_AVAILABLE;
          res.json({
            pov: existing,
            refreshAvailable: editPreserved,
            ...(editPreserved ? { editPreserved: true } : { unchanged: true }),
          } satisfies StrategyPovResponse);
        } catch (readErr) {
          log.error({ readErr, workspaceId }, 'Failed to read cached POV after control signal');
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
      // POV feeds AI context — invalidate consistently with generate + PATCH. The generator
      // already broadcasts STRATEGY_POV_GENERATED.
      invalidateIntelligenceCache(workspaceId);
      res.json({ pov, refreshAvailable: false } satisfies StrategyPovResponse);
    } catch (err) {
      if (err instanceof Error && (
        err.message === POV_REFRESH_AVAILABLE
        || err.message === POV_GENERATION_SUPERSEDED
      )) {
        const existing = getStrategyPov(workspaceId);
        if (existing) {
          const editPreserved = err.message === POV_REFRESH_AVAILABLE;
          res.json({
            pov: existing,
            refreshAvailable: editPreserved,
            ...(editPreserved ? { editPreserved: true } : { unchanged: true }),
          } satisfies StrategyPovResponse);
          return;
        }
      }
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
  async (req, res) => {
    const { workspaceId } = req.params;
    const variant = readVariant(req.query.variant);
    try {
      const next = bumpStrategyPovVersion(workspaceId, req.body);
      if (!next) {
        res.status(404).json({ error: 'No strategy POV to edit — generate one first' });
        return;
      }
      addActivity(workspaceId, 'strategy_pov_generated', 'Strategy POV edited');
      broadcastToWorkspace(workspaceId, WS_EVENTS.STRATEGY_POV_GENERATED, {});
      invalidateIntelligenceCache(workspaceId);
      const refreshAvailable = await readRefreshAvailable(workspaceId, variant);
      // Freshness assembly is asynchronous. A second PATCH can land while this
      // request awaits it, so re-read the resolved authority before responding.
      const latest = getStrategyPov(workspaceId) ?? next;
      res.json({ pov: latest, refreshAvailable } satisfies StrategyPovResponse);
    } catch (err) {
      log.error({ err, workspaceId }, 'Failed to edit strategy POV');
      res.status(500).json({ error: 'Failed to edit strategy POV' });
    }
  },
);

export default router;
