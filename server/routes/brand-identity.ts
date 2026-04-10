import { Router } from 'express';
import { requireWorkspaceAccess } from '../auth.js';
import { validate, z } from '../middleware/validate.js';
import { addActivity } from '../activity-log.js';
import { broadcastToWorkspace } from '../broadcast.js';
import { WS_EVENTS } from '../ws-events.js';
import {
  listDeliverables, getDeliverable,
  generateDeliverable, refineDeliverable,
  approveDeliverable, exportDeliverables,
} from '../brand-identity.js';
import type { DeliverableTier } from '../../shared/types/brand-engine.js';

const router = Router();

// ── Zod schemas ─────────────────────────────────────────────────────────────

const deliverableTypeSchema = z.enum([
  'mission', 'vision', 'values', 'tagline', 'elevator_pitch',
  'archetypes', 'personality_traits', 'voice_guidelines', 'tone_examples',
  'messaging_pillars', 'differentiators', 'positioning_matrix', 'brand_story',
  'personas', 'customer_journey', 'objection_handling', 'emotional_triggers',
]);

const deliverableTierSchema = z.enum(['essentials', 'professional', 'premium']);

const generateDeliverableSchema = z.object({
  deliverableType: deliverableTypeSchema,
});

const refineDeliverableSchema = z.object({
  direction: z.string().min(1),
});

// Only `approved` is supported right now — narrow the schema to match.
const patchDeliverableSchema = z.object({
  status: z.literal('approved'),
});

// ── Routes ──────────────────────────────────────────────────────────────────

// List deliverables (all or by tier)
router.get('/api/brand-identity/:workspaceId', requireWorkspaceAccess('workspaceId'), (req, res) => {
  const tierParam = req.query.tier;
  let tier: DeliverableTier | undefined;
  if (typeof tierParam === 'string') {
    const parsed = deliverableTierSchema.safeParse(tierParam);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid tier' });
    tier = parsed.data;
  }
  res.json(listDeliverables(req.params.workspaceId, tier));
});

// Export approved deliverables as markdown — MUST be before /:id to avoid shadowing
router.get('/api/brand-identity/:workspaceId/export', requireWorkspaceAccess('workspaceId'), (req, res) => {
  const tierParam = req.query.tier;
  let tier: DeliverableTier | undefined;
  if (typeof tierParam === 'string') {
    const parsed = deliverableTierSchema.safeParse(tierParam);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid tier' });
    tier = parsed.data;
  }
  const markdown = exportDeliverables(req.params.workspaceId, tier);
  res.type('text/markdown').send(markdown);
});

// Get single deliverable with version history
router.get('/api/brand-identity/:workspaceId/:id', requireWorkspaceAccess('workspaceId'), (req, res) => {
  const result = getDeliverable(req.params.workspaceId, req.params.id);
  if (!result) return res.status(404).json({ error: 'Not found' });
  res.json(result);
});

// Generate a deliverable
router.post('/api/brand-identity/:workspaceId/generate', requireWorkspaceAccess('workspaceId'), validate(generateDeliverableSchema), async (req, res) => {
  const { deliverableType } = req.body;
  try {
    const result = await generateDeliverable(req.params.workspaceId, deliverableType);
    addActivity(req.params.workspaceId, 'brand_deliverable_generated', `Generated ${deliverableType.replace(/_/g, ' ')} deliverable`);
    broadcastToWorkspace(req.params.workspaceId, WS_EVENTS.BRAND_IDENTITY_UPDATED, { deliverableType });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Generation failed' });
  }
});

// Refine a deliverable with steering direction
router.post('/api/brand-identity/:workspaceId/:id/refine', requireWorkspaceAccess('workspaceId'), validate(refineDeliverableSchema), async (req, res) => {
  const { direction } = req.body;
  try {
    const result = await refineDeliverable(req.params.workspaceId, req.params.id, direction);
    if (!result) return res.status(404).json({ error: 'Not found' });
    broadcastToWorkspace(req.params.workspaceId, WS_EVENTS.BRAND_IDENTITY_UPDATED, { deliverableId: req.params.id });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Refinement failed' });
  }
});

// Update status (approve / reset to draft)
router.patch('/api/brand-identity/:workspaceId/:id', requireWorkspaceAccess('workspaceId'), validate(patchDeliverableSchema), (req, res) => {
  const result = approveDeliverable(req.params.workspaceId, req.params.id);
  if (!result) return res.status(404).json({ error: 'Not found' });
  addActivity(req.params.workspaceId, 'brand_deliverable_approved', `Approved ${result.deliverableType.replace(/_/g, ' ')} deliverable`);
  broadcastToWorkspace(req.params.workspaceId, WS_EVENTS.BRAND_IDENTITY_UPDATED, { deliverableId: req.params.id, status: 'approved' });
  res.json(result);
});

export default router;
