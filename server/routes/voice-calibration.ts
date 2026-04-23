import { Router } from 'express';
import { requireWorkspaceAccess } from '../auth.js';
import { validate, z } from '../middleware/validate.js';
import { addActivity } from '../activity-log.js';
import { broadcastToWorkspace } from '../broadcast.js';
import { WS_EVENTS } from '../ws-events.js';
import {
  getVoiceProfile, createVoiceProfile, updateVoiceProfile,
  VoiceProfileStateTransitionError,
  addVoiceSample, deleteVoiceSample,
  listCalibrationSessions,
  generateCalibrationVariations, refineVariation,
  saveVariationFeedback,
} from '../voice-calibration.js';
import { clearSeoContextCache } from '../seo-context.js';
import { invalidateIntelligenceCache } from '../workspace-intelligence.js';
import { aiLimiter } from '../middleware.js';
import { incrementIfAllowed, decrementUsage } from '../usage-tracking.js';
import { sanitizeErrorMessage } from '../helpers.js';
import { getWorkspace } from '../workspaces.js';
import {
  createVoiceProfileSchema,
  saveVariationFeedbackSchema,
} from '../schemas/voice-calibration.js';

const router = Router();

// ── Zod schemas ─────────────────────────────────────────────────────────────

const voiceSampleContextSchema = z.enum(['headline', 'body', 'cta', 'about', 'service', 'social', 'seo']);
const voiceSampleSourceSchema = z.enum([
  'manual', 'transcript_extraction', 'calibration_loop', 'identity_approved', 'copy_approved',
]);
const voiceProfileStatusSchema = z.enum(['draft', 'calibrating', 'calibrated']);

const toneSpectrumSchema = z.object({
  formal_casual: z.number().min(1).max(10),
  serious_playful: z.number().min(1).max(10),
  technical_accessible: z.number().min(1).max(10),
});

const voiceDNASchema = z.object({
  personalityTraits: z.array(z.string()),
  toneSpectrum: toneSpectrumSchema,
  sentenceStyle: z.string(),
  vocabularyLevel: z.string(),
  // Optional to match `VoiceDNA.humorStyle?: string` — clearing the field in
  // the UI sends an empty string; allow both omission and empty.
  humorStyle: z.string().optional(),
});

const voiceGuardrailsSchema = z.object({
  forbiddenWords: z.array(z.string()),
  requiredTerminology: z.array(z.object({ use: z.string(), insteadOf: z.string() })),
  toneBoundaries: z.array(z.string()),
  antiPatterns: z.array(z.string()),
});

const contextModifierSchema = z.object({
  context: z.string(),
  description: z.string(),
});

const updateVoiceProfileSchema = z.object({
  status: voiceProfileStatusSchema.optional(),
  voiceDNA: voiceDNASchema.optional(),
  guardrails: voiceGuardrailsSchema.optional(),
  contextModifiers: z.array(contextModifierSchema).optional(),
}).strict(); // .strict() rejects unknown keys — tighter than the default strip behavior

const addSampleSchema = z.object({
  content: z.string().min(1),
  contextTag: voiceSampleContextSchema.optional(),
  source: voiceSampleSourceSchema.optional(),
});

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

// Explicitly create voice profile (A5: no longer auto-created on GET)
router.post('/api/voice/:workspaceId',
  requireWorkspaceAccess('workspaceId'),
  validate(createVoiceProfileSchema),
  (req, res) => {
    try {
      const profile = createVoiceProfile(req.params.workspaceId);
      addActivity(req.params.workspaceId, 'voice_profile_created', 'Created voice profile');
      broadcastToWorkspace(req.params.workspaceId, WS_EVENTS.VOICE_PROFILE_UPDATED, {});
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
    const result = updateVoiceProfile(req.params.workspaceId, req.body);
    addActivity(req.params.workspaceId, 'voice_profile_updated', 'Updated voice profile');
    broadcastToWorkspace(req.params.workspaceId, WS_EVENTS.VOICE_PROFILE_UPDATED, { workspaceId: req.params.workspaceId });
    clearSeoContextCache(req.params.workspaceId);
    invalidateIntelligenceCache(req.params.workspaceId);
    res.json(result);
  } catch (err) {
    if (err instanceof Error && err.message === 'No voice profile exists for this workspace') {
      return res.status(404).json({ error: 'Voice profile not found. Create one first via POST /api/voice/:workspaceId' });
    }
    // Illegal status transitions (e.g. draft → calibrated) are user-input errors,
    // not server failures. Return 400 with a descriptive message so the client
    // can surface "finish calibration first" rather than a generic 500.
    if (err instanceof VoiceProfileStateTransitionError) {
      return res.status(400).json({ error: err.message, from: err.from, to: err.to });
    }
    throw err;
  }
});

// List calibration sessions
router.get('/api/voice/:workspaceId/sessions', requireWorkspaceAccess('workspaceId'), (req, res) => {
  res.json(listCalibrationSessions(req.params.workspaceId));
});

// Add voice sample
router.post('/api/voice/:workspaceId/samples', requireWorkspaceAccess('workspaceId'), validate(addSampleSchema), (req, res) => {
  const { content, contextTag, source } = req.body;
  try {
    const sample = addVoiceSample(req.params.workspaceId, content, contextTag, source);
    addActivity(req.params.workspaceId, 'voice_sample_added', `Added voice sample${contextTag ? ` (${contextTag})` : ''}`);
    broadcastToWorkspace(req.params.workspaceId, WS_EVENTS.VOICE_PROFILE_UPDATED, { sampleId: sample.id });
    clearSeoContextCache(req.params.workspaceId);
    invalidateIntelligenceCache(req.params.workspaceId);
    res.json(sample);
  } catch (err) {
    if (err instanceof Error && err.message === 'No voice profile exists for this workspace') {
      return res.status(404).json({ error: 'Voice profile not found. Create one first via POST /api/voice/:workspaceId' });
    }
    throw err;
  }
});

// Delete voice sample
router.delete('/api/voice/:workspaceId/samples/:sampleId', requireWorkspaceAccess('workspaceId'), (req, res) => {
  const ok = deleteVoiceSample(req.params.workspaceId, req.params.sampleId);
  if (!ok) return res.status(404).json({ error: 'Not found' });
  addActivity(req.params.workspaceId, 'voice_sample_deleted', 'Deleted voice sample');
  broadcastToWorkspace(req.params.workspaceId, WS_EVENTS.VOICE_PROFILE_UPDATED, { sampleId: req.params.sampleId, deleted: true });
  clearSeoContextCache(req.params.workspaceId);
  invalidateIntelligenceCache(req.params.workspaceId);
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
    const tier = (ws?.tier ?? 'free') as string;
    if (!incrementIfAllowed(req.params.workspaceId, tier, 'voice_calibrations')) {
      return res.status(429).json({ error: 'Monthly limit reached for your tier', code: 'usage_limit' });
    }
    try {
      const session = await generateCalibrationVariations(req.params.workspaceId, promptType, steeringNotes);
      addActivity(req.params.workspaceId, 'voice_calibrated', `Generated voice calibration variations for ${promptType}`);
      broadcastToWorkspace(req.params.workspaceId, WS_EVENTS.VOICE_PROFILE_UPDATED, { sessionId: session.id });
      clearSeoContextCache(req.params.workspaceId);
      invalidateIntelligenceCache(req.params.workspaceId);
      res.json(session);
    } catch (err) {
      decrementUsage(req.params.workspaceId, 'voice_calibrations');
      if (err instanceof Error && err.message === 'No voice profile exists for this workspace') {
        return res.status(404).json({ error: 'Voice profile not found. Create one first via POST /api/voice/:workspaceId' });
      }
      res.status(500).json({ error: sanitizeErrorMessage(err, 'Calibration failed') });
    }
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
    const tier = (ws?.tier ?? 'free') as string;
    if (!incrementIfAllowed(req.params.workspaceId, tier, 'voice_calibrations')) {
      return res.status(429).json({ error: 'Monthly limit reached for your tier', code: 'usage_limit' });
    }
    try {
      const session = await refineVariation(req.params.workspaceId, req.params.sessionId, variationIndex, direction);
      if (!session) {
        decrementUsage(req.params.workspaceId, 'voice_calibrations');
        return res.status(404).json({ error: 'Session or variation not found' });
      }
      addActivity(req.params.workspaceId, 'voice_refined', `Refined voice calibration variation for ${session.promptType}`);
      broadcastToWorkspace(req.params.workspaceId, WS_EVENTS.VOICE_PROFILE_UPDATED, { sessionId: req.params.sessionId });
      clearSeoContextCache(req.params.workspaceId);
      invalidateIntelligenceCache(req.params.workspaceId);
      res.json(session);
    } catch (err) {
      decrementUsage(req.params.workspaceId, 'voice_calibrations');
      if (err instanceof Error && err.message === 'No voice profile exists for this workspace') {
        return res.status(404).json({ error: 'Voice profile not found. Create one first via POST /api/voice/:workspaceId' });
      }
      res.status(500).json({ error: sanitizeErrorMessage(err, 'Refinement failed') });
    }
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
