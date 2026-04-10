import { Router } from 'express';
import { requireWorkspaceAccess } from '../auth.js';
import { validate, z } from '../middleware/validate.js';
import { addActivity } from '../activity-log.js';
import { broadcastToWorkspace } from '../broadcast.js';
import { WS_EVENTS } from '../ws-events.js';
import {
  getOrCreateVoiceProfile, updateVoiceProfile,
  addVoiceSample, deleteVoiceSample,
  listCalibrationSessions,
  generateCalibrationVariations, refineVariation,
} from '../voice-calibration.js';
import { clearSeoContextCache } from '../seo-context.js';

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
  humorStyle: z.string(),
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

// Get or create voice profile (includes samples)
router.get('/api/voice/:workspaceId', requireWorkspaceAccess('workspaceId'), (req, res) => {
  res.json(getOrCreateVoiceProfile(req.params.workspaceId));
});

// Update voice profile (DNA, guardrails, modifiers, status)
router.patch('/api/voice/:workspaceId', requireWorkspaceAccess('workspaceId'), validate(updateVoiceProfileSchema), (req, res) => {
  const result = updateVoiceProfile(req.params.workspaceId, req.body);
  addActivity(req.params.workspaceId, 'voice_profile_updated', 'Updated voice profile');
  broadcastToWorkspace(req.params.workspaceId, WS_EVENTS.VOICE_PROFILE_UPDATED, { workspaceId: req.params.workspaceId });
  clearSeoContextCache(req.params.workspaceId);
  res.json(result);
});

// List calibration sessions
router.get('/api/voice/:workspaceId/sessions', requireWorkspaceAccess('workspaceId'), (req, res) => {
  res.json(listCalibrationSessions(req.params.workspaceId));
});

// Add voice sample
router.post('/api/voice/:workspaceId/samples', requireWorkspaceAccess('workspaceId'), validate(addSampleSchema), (req, res) => {
  const { content, contextTag, source } = req.body;
  const sample = addVoiceSample(req.params.workspaceId, content, contextTag, source);
  addActivity(req.params.workspaceId, 'voice_sample_added', `Added voice sample${contextTag ? ` (${contextTag})` : ''}`);
  broadcastToWorkspace(req.params.workspaceId, WS_EVENTS.VOICE_PROFILE_UPDATED, { sampleId: sample.id });
  clearSeoContextCache(req.params.workspaceId);
  res.json(sample);
});

// Delete voice sample
router.delete('/api/voice/:workspaceId/samples/:sampleId', requireWorkspaceAccess('workspaceId'), (req, res) => {
  const ok = deleteVoiceSample(req.params.workspaceId, req.params.sampleId);
  if (!ok) return res.status(404).json({ error: 'Not found' });
  addActivity(req.params.workspaceId, 'voice_sample_deleted', 'Deleted voice sample');
  broadcastToWorkspace(req.params.workspaceId, WS_EVENTS.VOICE_PROFILE_UPDATED, { sampleId: req.params.sampleId, deleted: true });
  clearSeoContextCache(req.params.workspaceId);
  res.json({ deleted: true });
});

// Generate calibration variations
router.post('/api/voice/:workspaceId/calibrate', requireWorkspaceAccess('workspaceId'), validate(calibrateSchema), async (req, res) => {
  const { promptType, steeringNotes } = req.body;
  try {
    const session = await generateCalibrationVariations(req.params.workspaceId, promptType, steeringNotes);
    addActivity(req.params.workspaceId, 'voice_calibrated', `Generated voice calibration variations for ${promptType}`);
    broadcastToWorkspace(req.params.workspaceId, WS_EVENTS.VOICE_PROFILE_UPDATED, { sessionId: session.id });
    clearSeoContextCache(req.params.workspaceId);
    res.json(session);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Calibration failed' });
  }
});

// Refine a specific variation with steering direction
router.post('/api/voice/:workspaceId/calibrate/:sessionId/refine', requireWorkspaceAccess('workspaceId'), validate(refineSchema), async (req, res) => {
  const { variationIndex, direction } = req.body;
  try {
    const session = await refineVariation(req.params.workspaceId, req.params.sessionId, variationIndex, direction);
    if (!session) return res.status(404).json({ error: 'Session or variation not found' });
    broadcastToWorkspace(req.params.workspaceId, WS_EVENTS.VOICE_PROFILE_UPDATED, { sessionId: req.params.sessionId });
    clearSeoContextCache(req.params.workspaceId);
    res.json(session);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Refinement failed' });
  }
});

export default router;
