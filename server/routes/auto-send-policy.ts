/**
 * The Issue — Phase 4 trust-ladder routes.
 *
 *   GET   /api/auto-send-policy/:workspaceId            → AutoSendPolicyResponse (2 eligible rows)
 *   PATCH /api/auto-send-policy/:workspaceId/:archetype → { enabled } → updated AutoSendPolicyResponse
 *
 * Admin surface — `requireWorkspaceAccess` (NEVER requireAuth; the HMAC admin gate covers it).
 * Eligibility + earned-gating are enforced at the store (typed AutoSendPolicyError); the route maps
 * a `not_eligible`/`not_earned` error to a 400 {error}. The PATCH param is additionally guarded
 * against the two eligible archetypes before any store read (the `validate()` middleware only checks
 * the body). On a successful enable/disable the route broadcasts STRATEGY_AUTOSEND_POLICY_UPDATED so
 * the cockpit's TrustLadderPanel refreshes, and returns the FULL updated response.
 */
import { Router } from 'express';
import { requireWorkspaceAccess } from '../auth.js';
import { validate } from '../middleware/validate.js';
import { broadcastToWorkspace } from '../broadcast.js';
import { WS_EVENTS } from '../ws-events.js';
import { createLogger } from '../logger.js';
import {
  getAutoSendPolicies,
  setAutoSendPolicyEnabled,
  AutoSendPolicyError,
} from '../strategy-autosend-store.js';
import {
  autoSendPatchBodySchema,
  autoSendArchetypeParamSchema,
} from '../schemas/auto-send-policy-schemas.js';
import { AUTOSEND_TRUST_THRESHOLD } from '../../shared/types/strategy-autosend.js';
import type { AutoSendPolicyResponse } from '../../shared/types/strategy-autosend.js';

const log = createLogger('auto-send-policy-routes');
const router = Router();

function buildResponse(workspaceId: string): AutoSendPolicyResponse {
  return {
    workspaceId,
    threshold: AUTOSEND_TRUST_THRESHOLD,
    policies: getAutoSendPolicies(workspaceId),
  };
}

// GET /api/auto-send-policy/:workspaceId — the trust-ladder state for the 2 eligible archetypes.
router.get(
  '/api/auto-send-policy/:workspaceId',
  requireWorkspaceAccess('workspaceId'),
  (req, res) => {
    try {
      res.json(buildResponse(req.params.workspaceId));
    } catch (err) {
      log.error({ err, workspaceId: req.params.workspaceId }, 'Failed to fetch auto-send policy');
      res.status(500).json({ error: 'Failed to fetch auto-send policy' });
    }
  },
);

// PATCH /api/auto-send-policy/:workspaceId/:archetype — enable/disable an eligible archetype.
router.patch(
  '/api/auto-send-policy/:workspaceId/:archetype',
  requireWorkspaceAccess('workspaceId'),
  validate(autoSendPatchBodySchema),
  (req, res) => {
    const { workspaceId } = req.params;
    // Param guard (validate() only checks the body): reject non-eligible archetype strings up front.
    const parsedArchetype = autoSendArchetypeParamSchema.safeParse(req.params.archetype);
    if (!parsedArchetype.success) {
      res.status(400).json({ error: `archetype: not auto-send-eligible` });
      return;
    }
    const { enabled } = req.body as { enabled: boolean };

    try {
      setAutoSendPolicyEnabled(workspaceId, parsedArchetype.data, enabled);
      broadcastToWorkspace(workspaceId, WS_EVENTS.STRATEGY_AUTOSEND_POLICY_UPDATED, {
        archetype: parsedArchetype.data,
        enabled,
      });
      res.json(buildResponse(workspaceId));
    } catch (err) {
      if (err instanceof AutoSendPolicyError) {
        res.status(400).json({ error: err.message });
        return;
      }
      log.error({ err, workspaceId, archetype: parsedArchetype.data }, 'Failed to update auto-send policy');
      res.status(500).json({ error: 'Failed to update auto-send policy' });
    }
  },
);

export default router;
