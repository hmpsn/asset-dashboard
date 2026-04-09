import { Router } from 'express';
import { requireWorkspaceAccess } from '../auth.js';
import { addActivity } from '../activity-log.js';
import { broadcastToWorkspace } from '../broadcast.js';
import { WS_EVENTS } from '../ws-events.js';
import {
  getOrCreateVoiceProfile, updateVoiceProfile,
  addVoiceSample, deleteVoiceSample,
  listCalibrationSessions,
  generateCalibrationVariations, refineVariation,
} from '../voice-calibration.js';

const router = Router();

// Get or create voice profile (includes samples)
router.get('/api/voice/:workspaceId', requireWorkspaceAccess('workspaceId'), (req, res) => {
  res.json(getOrCreateVoiceProfile(req.params.workspaceId));
});

// Update voice profile (DNA, guardrails, modifiers, status)
router.patch('/api/voice/:workspaceId', requireWorkspaceAccess('workspaceId'), (req, res) => {
  const result = updateVoiceProfile(req.params.workspaceId, req.body);
  if (!result) return res.status(500).json({ error: 'Update failed' });
  addActivity(req.params.workspaceId, 'voice_profile_updated', 'Updated voice profile');
  broadcastToWorkspace(req.params.workspaceId, WS_EVENTS.VOICE_PROFILE_UPDATED, { workspaceId: req.params.workspaceId });
  res.json(result);
});

// List calibration sessions
router.get('/api/voice/:workspaceId/sessions', requireWorkspaceAccess('workspaceId'), (req, res) => {
  res.json(listCalibrationSessions(req.params.workspaceId));
});

// Add voice sample
router.post('/api/voice/:workspaceId/samples', requireWorkspaceAccess('workspaceId'), (req, res) => {
  const { content, contextTag, source } = req.body;
  if (!content) return res.status(400).json({ error: 'content required' });
  const sample = addVoiceSample(req.params.workspaceId, content, contextTag, source);
  addActivity(req.params.workspaceId, 'voice_sample_added', `Added voice sample${contextTag ? ` (${contextTag})` : ''}`);
  broadcastToWorkspace(req.params.workspaceId, WS_EVENTS.VOICE_PROFILE_UPDATED, { sampleId: sample.id });
  res.json(sample);
});

// Delete voice sample
router.delete('/api/voice/:workspaceId/samples/:sampleId', requireWorkspaceAccess('workspaceId'), (req, res) => {
  const ok = deleteVoiceSample(req.params.workspaceId, req.params.sampleId);
  if (!ok) return res.status(404).json({ error: 'Not found' });
  addActivity(req.params.workspaceId, 'voice_sample_deleted', 'Deleted voice sample');
  broadcastToWorkspace(req.params.workspaceId, WS_EVENTS.VOICE_PROFILE_UPDATED, { sampleId: req.params.sampleId, deleted: true });
  res.json({ deleted: true });
});

// Generate calibration variations
router.post('/api/voice/:workspaceId/calibrate', requireWorkspaceAccess('workspaceId'), async (req, res) => {
  const { promptType, steeringNotes } = req.body;
  if (!promptType) return res.status(400).json({ error: 'promptType required' });
  try {
    const session = await generateCalibrationVariations(req.params.workspaceId, promptType, steeringNotes);
    addActivity(req.params.workspaceId, 'voice_calibrated', `Generated voice calibration variations for ${promptType}`);
    broadcastToWorkspace(req.params.workspaceId, WS_EVENTS.VOICE_PROFILE_UPDATED, { sessionId: session.id });
    res.json(session);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Calibration failed' });
  }
});

// Refine a specific variation with steering direction
router.post('/api/voice/:workspaceId/calibrate/:sessionId/refine', requireWorkspaceAccess('workspaceId'), async (req, res) => {
  const { variationIndex, direction } = req.body;
  if (variationIndex === undefined || !direction) return res.status(400).json({ error: 'variationIndex and direction required' });
  try {
    const session = await refineVariation(req.params.workspaceId, req.params.sessionId, variationIndex, direction);
    if (!session) return res.status(404).json({ error: 'Session or variation not found' });
    broadcastToWorkspace(req.params.workspaceId, WS_EVENTS.VOICE_PROFILE_UPDATED, { sessionId: req.params.sessionId });
    res.json(session);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Refinement failed' });
  }
});

export default router;
