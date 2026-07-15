/**
 * Voice calibration and finalization HTTP adapters.
 *
 * @reads workspaces, voice_profiles, voice_samples, voice_calibration_sessions,
 *   voice_profile_finalizations, voice_finalization_authorizations
 * @writes voice_profiles, voice_samples, voice_calibration_sessions,
 *   voice_profile_finalizations, voice_finalization_authorizations, activity_log,
 *   tracked_actions, intelligence_cache, monthly_digest_cache
 */
import { Router, type Request, type Response } from 'express';

import type { GenerationOperatorAttribution } from '../../shared/types/generation-evidence.js';
import type {
  CreateVoiceFinalizationAuthorizationRequest,
  FinalizeBrandVoiceRequest,
} from '../../shared/types/voice-finalization.js';
import { requireWorkspaceAccess } from '../auth.js';
import { validate, z } from '../middleware/validate.js';
import { addActivity } from '../activity-log.js';
import { broadcastToWorkspace } from '../broadcast.js';
import { WS_EVENTS } from '../ws-events.js';
import {
  getVoiceProfile, createVoiceProfile, updateVoiceProfileWithResult,
  attestVoiceSample,
  VoiceProfileRevisionConflictError,
  VoiceProfileStateTransitionError,
  VoiceSampleAttestationError,
  addVoiceSample, deleteVoiceSample,
  listCalibrationSessions,
  generateCalibrationVariations, refineVariation,
  saveVariationFeedback,
} from '../voice-calibration.js';
import { invalidateIntelligenceCache } from '../intelligence/cache-invalidation.js';
import { aiLimiter } from '../middleware.js';
import { incrementIfAllowed, decrementUsage } from '../usage-tracking.js';
import { sanitizeErrorMessage } from '../utils/text.js';
import { computeEffectiveTier, getWorkspace } from '../workspaces.js';
import {
  createVoiceFinalizationAuthorizationBodySchema,
  createVoiceProfileSchema,
  attestVoiceSampleSchema,
  finalizeBrandVoiceBodySchema,
  getBrandVoiceReadinessQuerySchema,
  saveVariationFeedbackSchema,
  updateVoiceProfileSchema,
  voiceSampleInputSchema,
  type CreateVoiceFinalizationAuthorizationBody,
  type FinalizeBrandVoiceBody,
} from '../schemas/voice-calibration.js';
import { createLogger } from '../logger.js';
import {
  createVoiceFinalizationAuthorization,
  finalizeBrandVoice,
  getBrandVoicePage,
  VoiceFinalizationAuthorizationError,
  VoiceFinalizationConflictError,
  VoiceFinalizationIdempotencyConflictError,
  VoiceFinalizationNotFoundError,
  VoiceFinalizationPreconditionError,
  VoiceFinalizationReadConflictError,
  VoiceFinalizationReadCursorError,
} from '../domains/brand/voice-finalization.js';
import { applyVoiceFinalizationPostCommitEffects } from '../domains/brand/voice-finalization-effects.js';

const router = Router();
const log = createLogger('voice-calibration-routes');

function runVoicePostCommitEffect(
  workspaceId: string,
  effect: 'activity' | 'broadcast' | 'intelligence-cache',
  run: () => void,
): void {
  try {
    run();
  } catch (err) {
    log.warn({ err, workspaceId, effect }, 'voice calibration post-commit effect failed');
  }
}

function refundVoiceUsage(workspaceId: string): void {
  try {
    decrementUsage(workspaceId, 'voice_calibrations');
  } catch (err) {
    log.warn({ err, workspaceId }, 'failed to refund voice calibration usage');
  }
}

function operatorFromRequest(req: Request): GenerationOperatorAttribution {
  if (req.user) {
    return {
      actorType: 'operator',
      actorId: req.user.id,
      actorLabel: req.user.name,
    };
  }
  return {
    actorType: 'operator',
    actorId: 'admin-hmac',
    actorLabel: 'Admin operator',
  };
}

function applyAuthorizationPostCommitEffects(
  workspaceId: string,
  result: ReturnType<typeof createVoiceFinalizationAuthorization>,
): void {
  const { authorization } = result;
  runVoicePostCommitEffect(workspaceId, 'activity', () => {
    addActivity(
      workspaceId,
      'voice_profile_updated',
      'Authorized voice finalization',
      `Authorized voice profile revision ${authorization.expectedProfileRevision} for MCP finalization.`,
      {
        authorizationId: authorization.authorizationId,
        profileRevision: authorization.expectedProfileRevision,
        expiresAt: authorization.expiresAt,
      },
      {
        id: authorization.authorizedBy.actorId,
        name: authorization.authorizedBy.actorLabel,
      },
    );
  });
  runVoicePostCommitEffect(workspaceId, 'broadcast', () => {
    // Workspace broadcasts are shared with client subscribers. Keep this to an
    // invalidation-only payload: authorization identity and bearer material stay
    // behind the admin boundary.
    broadcastToWorkspace(workspaceId, WS_EVENTS.VOICE_PROFILE_UPDATED, { workspaceId });
  });
}

function sendVoiceFinalizationError(
  res: Response,
  err: unknown,
): boolean {
  if (err instanceof VoiceFinalizationNotFoundError) {
    res.status(404).json({ error: err.message, code: err.code });
    return true;
  }
  if (err instanceof VoiceFinalizationConflictError) {
    res.status(409).json({
      error: err.message,
      code: err.code,
      expectedRevision: err.expected,
      actualRevision: err.actual,
    });
    return true;
  }
  if (err instanceof VoiceFinalizationIdempotencyConflictError) {
    res.status(409).json({ error: err.message, code: err.code });
    return true;
  }
  if (err instanceof VoiceFinalizationPreconditionError) {
    res.status(422).json({ error: err.message, code: err.code });
    return true;
  }
  if (err instanceof VoiceFinalizationAuthorizationError) {
    // Keep invalid, expired, consumed, and cross-workspace token failures
    // indistinguishable so this endpoint cannot become an authorization-state oracle.
    res.status(401).json({
      error: 'Voice finalization authorization is invalid or expired',
      code: err.code,
    });
    return true;
  }
  if (err instanceof VoiceFinalizationReadCursorError) {
    res.status(400).json({ error: err.message, code: err.code });
    return true;
  }
  if (err instanceof VoiceFinalizationReadConflictError) {
    res.status(409).json({ error: err.message, code: err.code });
    return true;
  }
  return false;
}

// ── Zod schemas ─────────────────────────────────────────────────────────────

const calibrateSchema = z.object({
  promptType: z.string().min(1),
  steeringNotes: z.string().optional(),
});

const refineSchema = z.object({
  variationIndex: z.number().int().min(0),
  direction: z.string().min(1),
});

// ── Routes ──────────────────────────────────────────────────────────────────

// Get voice profile (returns null when not yet created — call POST to create)
router.get('/api/voice/:workspaceId', requireWorkspaceAccess('workspaceId'), (req, res) => {
  res.json(getVoiceProfile(req.params.workspaceId) ?? null);
});

// Read finalization readiness without exposing private intake questionnaire data.
router.get('/api/voice/:workspaceId/readiness', requireWorkspaceAccess('workspaceId'), (req, res) => {
  const workspaceId = req.params.workspaceId;
  try {
    const query = getBrandVoiceReadinessQuerySchema.safeParse(req.query);
    if (!query.success) {
      return res.status(400).json({ error: 'Invalid brand voice readiness query' });
    }
    if (!getWorkspace(workspaceId)) {
      throw new VoiceFinalizationNotFoundError('Workspace not found');
    }
    res.json(getBrandVoicePage({
      workspaceId,
      anchorLimit: query.data.anchorLimit,
      anchorCursor: query.data.anchorCursor,
    }));
  } catch (err) {
    if (sendVoiceFinalizationError(res, err)) return;
    log.error({ err, workspaceId }, 'failed to read brand voice readiness');
    res.status(500).json({ error: 'Failed to read brand voice readiness' });
  }
});

// Explicitly create voice profile (A5: no longer auto-created on GET)
router.post('/api/voice/:workspaceId',
  requireWorkspaceAccess('workspaceId'),
  validate(createVoiceProfileSchema),
  (req, res) => {
    const workspaceId = req.params.workspaceId;
    try {
      const profile = createVoiceProfile(workspaceId);
      runVoicePostCommitEffect(workspaceId, 'activity', () => {
        addActivity(workspaceId, 'voice_profile_created', 'Created voice profile');
      });
      runVoicePostCommitEffect(workspaceId, 'broadcast', () => {
        broadcastToWorkspace(workspaceId, WS_EVENTS.VOICE_PROFILE_UPDATED, {});
      });
      runVoicePostCommitEffect(workspaceId, 'intelligence-cache', () => {
        invalidateIntelligenceCache(workspaceId);
      });
      res.status(201).json(profile);
    } catch (err) {
      if (err instanceof Error && /already exists/.test(err.message)) {
        return res.status(409).json({ error: 'Voice profile already exists' });
      }
      throw err;
    }
  },
);

// Update voice profile (DNA, guardrails, modifiers, status)
router.patch('/api/voice/:workspaceId', requireWorkspaceAccess('workspaceId'), validate(updateVoiceProfileSchema), (req, res) => {
  try {
    const result = updateVoiceProfileWithResult(req.params.workspaceId, req.body);
    if (result.changed) {
      runVoicePostCommitEffect(req.params.workspaceId, 'activity', () => {
        addActivity(req.params.workspaceId, 'voice_profile_updated', 'Updated voice profile');
      });
      runVoicePostCommitEffect(req.params.workspaceId, 'broadcast', () => {
        broadcastToWorkspace(req.params.workspaceId, WS_EVENTS.VOICE_PROFILE_UPDATED, { workspaceId: req.params.workspaceId });
      });
      runVoicePostCommitEffect(req.params.workspaceId, 'intelligence-cache', () => {
        invalidateIntelligenceCache(req.params.workspaceId);
      });
    }
    res.json(result.profile);
  } catch (err) {
    if (err instanceof Error && err.message === 'No voice profile exists for this workspace') {
      return res.status(404).json({ error: 'Voice profile not found. Create one first via POST /api/voice/:workspaceId' });
    }
    // Domain transition failures are user-input errors, not server failures.
    // The domain deliberately reserves `calibrated` for POST /finalize so
    // internal callers receive the same typed transition error as HTTP callers.
    if (err instanceof VoiceProfileStateTransitionError) {
      return res.status(400).json({ error: err.message, from: err.from, to: err.to });
    }
    throw err;
  }
});

// Finalize a brand voice directly as the authenticated human operator.
router.post(
  '/api/voice/:workspaceId/finalize',
  requireWorkspaceAccess('workspaceId'),
  validate(finalizeBrandVoiceBodySchema),
  (req, res) => {
    const workspaceId = req.params.workspaceId;
    try {
      const finalizedBy = operatorFromRequest(req);
      const body = req.body as FinalizeBrandVoiceBody;
      // Zod v3 types `.min(1)` as an array even though validation guarantees a
      // non-empty list. Narrow only that field at this validated boundary.
      const request: FinalizeBrandVoiceRequest = {
        workspaceId,
        ...body,
        anchorSelectors: body.anchorSelectors as FinalizeBrandVoiceRequest['anchorSelectors'],
        finalizedBy,
        executionActor: finalizedBy,
      };
      const result = finalizeBrandVoice(request);
      applyVoiceFinalizationPostCommitEffects(workspaceId, result);
      res.status(result.created ? 201 : 200).json(result);
    } catch (err) {
      if (sendVoiceFinalizationError(res, err)) return;
      log.error({ err, workspaceId }, 'failed to finalize brand voice');
      res.status(500).json({ error: 'Failed to finalize brand voice' });
    }
  },
);

// Create a short-lived, exact, one-time authorization for MCP execution. The
// bearer token is returned by the domain only at creation and is never persisted
// in recoverable form.
router.post(
  '/api/voice/:workspaceId/finalization-authorizations',
  requireWorkspaceAccess('workspaceId'),
  validate(createVoiceFinalizationAuthorizationBodySchema),
  (req, res) => {
    const workspaceId = req.params.workspaceId;
    try {
      const authorizedBy = operatorFromRequest(req);
      const body = req.body as CreateVoiceFinalizationAuthorizationBody;
      const request: CreateVoiceFinalizationAuthorizationRequest = {
        workspaceId,
        ...body,
        anchorSelectors: body.anchorSelectors as
          CreateVoiceFinalizationAuthorizationRequest['anchorSelectors'],
        authorizedBy,
      };
      const result = createVoiceFinalizationAuthorization(request);
      applyAuthorizationPostCommitEffects(workspaceId, result);
      res.status(201).json(result);
    } catch (err) {
      if (sendVoiceFinalizationError(res, err)) return;
      log.error({ err, workspaceId }, 'failed to create voice finalization authorization');
      res.status(500).json({ error: 'Failed to create voice finalization authorization' });
    }
  },
);

// List calibration sessions
router.get('/api/voice/:workspaceId/sessions', requireWorkspaceAccess('workspaceId'), (req, res) => {
  res.json(listCalibrationSessions(req.params.workspaceId));
});

// Add voice sample
router.post('/api/voice/:workspaceId/samples', requireWorkspaceAccess('workspaceId'), validate(voiceSampleInputSchema), (req, res) => {
  const { content, contextTag, source } = req.body;
  const workspaceId = req.params.workspaceId;
  try {
    if (source === 'operator_attested') {
      return res.status(400).json({
        error: 'Operator-attested samples must use the explicit attestation endpoint',
      });
    }
    const sample = addVoiceSample(workspaceId, content, contextTag, source);
    runVoicePostCommitEffect(workspaceId, 'activity', () => {
      addActivity(workspaceId, 'voice_sample_added', `Added voice sample${contextTag ? ` (${contextTag})` : ''}`);
    });
    runVoicePostCommitEffect(workspaceId, 'broadcast', () => {
      broadcastToWorkspace(workspaceId, WS_EVENTS.VOICE_PROFILE_UPDATED, { sampleId: sample.id });
    });
    runVoicePostCommitEffect(workspaceId, 'intelligence-cache', () => {
      invalidateIntelligenceCache(workspaceId);
    });
    res.json(sample);
  } catch (err) {
    if (err instanceof Error && err.message === 'No voice profile exists for this workspace') {
      return res.status(404).json({ error: 'Voice profile not found. Create one first via POST /api/voice/:workspaceId' });
    }
    throw err;
  }
});

// Human operator attestation is the only path that promotes an MCP proposal
// into finalization-eligible voice evidence.
router.post(
  '/api/voice/:workspaceId/samples/:sampleId/attest',
  requireWorkspaceAccess('workspaceId'),
  validate(attestVoiceSampleSchema),
  (req, res) => {
    const workspaceId = req.params.workspaceId;
    try {
      const sample = attestVoiceSample(
        workspaceId,
        req.params.sampleId,
        req.body.expectedProfileRevision,
      );
      const operator = operatorFromRequest(req);
      runVoicePostCommitEffect(workspaceId, 'activity', () => {
        addActivity(
          workspaceId,
          'voice_profile_updated',
          'Confirmed chat-proposed voice sample',
          'A human operator confirmed a chat-proposed sample as authentic brand voice.',
          { sampleId: sample.id, source: sample.source },
          { id: operator.actorId, name: operator.actorLabel },
        );
      });
      runVoicePostCommitEffect(workspaceId, 'broadcast', () => {
        broadcastToWorkspace(workspaceId, WS_EVENTS.VOICE_PROFILE_UPDATED, {
          sampleId: sample.id,
          attested: true,
        });
      });
      runVoicePostCommitEffect(workspaceId, 'intelligence-cache', () => {
        invalidateIntelligenceCache(workspaceId);
      });
      res.json(sample);
    } catch (err) {
      if (err instanceof VoiceProfileRevisionConflictError) {
        return res.status(409).json({
          error: err.message,
          expectedRevision: err.expectedRevision,
          actualRevision: err.actualRevision,
        });
      }
      if (err instanceof VoiceSampleAttestationError) {
        return res.status(422).json({ error: err.message });
      }
      if (err instanceof Error && err.message === 'No voice profile exists for this workspace') {
        return res.status(404).json({ error: 'Voice profile not found' });
      }
      throw err;
    }
  },
);

// Delete voice sample
router.delete('/api/voice/:workspaceId/samples/:sampleId', requireWorkspaceAccess('workspaceId'), (req, res) => {
  const workspaceId = req.params.workspaceId;
  const ok = deleteVoiceSample(workspaceId, req.params.sampleId);
  if (!ok) return res.status(404).json({ error: 'Not found' });
  runVoicePostCommitEffect(workspaceId, 'activity', () => {
    addActivity(workspaceId, 'voice_sample_deleted', 'Deleted voice sample');
  });
  runVoicePostCommitEffect(workspaceId, 'broadcast', () => {
    broadcastToWorkspace(workspaceId, WS_EVENTS.VOICE_PROFILE_UPDATED, { sampleId: req.params.sampleId, deleted: true });
  });
  runVoicePostCommitEffect(workspaceId, 'intelligence-cache', () => {
    invalidateIntelligenceCache(workspaceId);
  });
  res.json({ deleted: true });
});

// Generate calibration variations
router.post('/api/voice/:workspaceId/calibrate',
  requireWorkspaceAccess('workspaceId'),
  aiLimiter,
  validate(calibrateSchema),
  async (req, res) => {
    const { promptType, steeringNotes } = req.body;
    const ws = getWorkspace(req.params.workspaceId);
    if (!ws) return res.status(404).json({ error: 'Workspace not found' });
    const tier = computeEffectiveTier(ws);
    if (!incrementIfAllowed(req.params.workspaceId, tier, 'voice_calibrations')) {
      return res.status(429).json({ error: 'Monthly limit reached for your tier', code: 'usage_limit' });
    }

    let session: Awaited<ReturnType<typeof generateCalibrationVariations>>;
    try {
      session = await generateCalibrationVariations(req.params.workspaceId, promptType, steeringNotes);
    } catch (err) {
      refundVoiceUsage(req.params.workspaceId);
      if (err instanceof Error && err.message === 'No voice profile exists for this workspace') {
        return res.status(404).json({ error: 'Voice profile not found. Create one first via POST /api/voice/:workspaceId' });
      }
      return res.status(500).json({ error: sanitizeErrorMessage(err, 'Calibration failed') });
    }

    runVoicePostCommitEffect(req.params.workspaceId, 'activity', () => {
      addActivity(
        req.params.workspaceId,
        'voice_profile_updated',
        'Generated voice calibration variations',
        `Generated draft voice variations for ${promptType}.`,
      );
    });
    runVoicePostCommitEffect(req.params.workspaceId, 'broadcast', () => {
      broadcastToWorkspace(req.params.workspaceId, WS_EVENTS.VOICE_PROFILE_UPDATED, { sessionId: session.id });
    });
    runVoicePostCommitEffect(req.params.workspaceId, 'intelligence-cache', () => {
      invalidateIntelligenceCache(req.params.workspaceId);
    });
    return res.json(session);
  },
);

// Refine a specific variation with steering direction
router.post('/api/voice/:workspaceId/calibrate/:sessionId/refine',
  requireWorkspaceAccess('workspaceId'),
  aiLimiter,
  validate(refineSchema),
  async (req, res) => {
    const { variationIndex, direction } = req.body;
    const ws = getWorkspace(req.params.workspaceId);
    if (!ws) return res.status(404).json({ error: 'Workspace not found' });
    const tier = computeEffectiveTier(ws);
    if (!incrementIfAllowed(req.params.workspaceId, tier, 'voice_calibrations')) {
      return res.status(429).json({ error: 'Monthly limit reached for your tier', code: 'usage_limit' });
    }

    let session: Awaited<ReturnType<typeof refineVariation>>;
    try {
      session = await refineVariation(req.params.workspaceId, req.params.sessionId, variationIndex, direction);
    } catch (err) {
      refundVoiceUsage(req.params.workspaceId);
      if (err instanceof Error && err.message === 'No voice profile exists for this workspace') {
        return res.status(404).json({ error: 'Voice profile not found. Create one first via POST /api/voice/:workspaceId' });
      }
      return res.status(500).json({ error: sanitizeErrorMessage(err, 'Refinement failed') });
    }
    if (!session) {
      refundVoiceUsage(req.params.workspaceId);
      return res.status(404).json({ error: 'Session or variation not found' });
    }

    runVoicePostCommitEffect(req.params.workspaceId, 'activity', () => {
      addActivity(req.params.workspaceId, 'voice_refined', `Refined voice calibration variation for ${session.promptType}`);
    });
    runVoicePostCommitEffect(req.params.workspaceId, 'broadcast', () => {
      broadcastToWorkspace(req.params.workspaceId, WS_EVENTS.VOICE_PROFILE_UPDATED, { sessionId: req.params.sessionId });
    });
    runVoicePostCommitEffect(req.params.workspaceId, 'intelligence-cache', () => {
      invalidateIntelligenceCache(req.params.workspaceId);
    });
    return res.json(session);
  },
);

// Persist per-variation feedback (I8 backend half)
router.post('/api/voice/:workspaceId/calibration-feedback',
  requireWorkspaceAccess('workspaceId'),
  validate(saveVariationFeedbackSchema),
  (req, res) => {
    const { sessionId, variationIndex, feedback } = req.body;
    try {
      saveVariationFeedback(req.params.workspaceId, sessionId, variationIndex, feedback);
      broadcastToWorkspace(req.params.workspaceId, WS_EVENTS.VOICE_PROFILE_UPDATED, { sessionId });
      res.status(204).send();
    } catch (err) {
      if (err instanceof Error && err.message === 'Session not found') {
        return res.status(404).json({ error: 'Session not found' });
      }
      res.status(500).json({ error: sanitizeErrorMessage(err, 'Failed to save feedback') });
    }
  },
);

export default router;
