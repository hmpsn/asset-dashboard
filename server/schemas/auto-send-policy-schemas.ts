/**
 * The Issue — Phase 4 trust-ladder route schemas.
 *
 * `autoSendPatchBodySchema` validates the PATCH body via the shared `validate()` middleware.
 * `autoSendArchetypeParamSchema` guards the `:archetype` path param against the two eligible
 * archetypes (`quick_win`, `technical`); the route runs it with `safeParse` and returns a 400 on a
 * miss (the `validate()` middleware only checks `req.body`, never params). The store enforces the
 * same eligibility (defence in depth), but the route param guard rejects garbage archetype strings
 * before any store read.
 */
import { z } from '../middleware/validate.js';
import { AUTOSEND_ELIGIBLE_ARCHETYPES } from '../../shared/types/strategy-autosend.js';

/** PATCH /api/auto-send-policy/:workspaceId/:archetype body. */
export const autoSendPatchBodySchema = z.object({
  enabled: z.boolean(),
});

/** Path param guard — must be one of the two eligible archetypes. */
export const autoSendArchetypeParamSchema = z.enum(AUTOSEND_ELIGIBLE_ARCHETYPES);
