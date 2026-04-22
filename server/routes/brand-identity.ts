import { Router } from 'express';
import { requireWorkspaceAccess } from '../auth.js';
import { validate, z } from '../middleware/validate.js';
import { addActivity } from '../activity-log.js';
import { broadcastToWorkspace } from '../broadcast.js';
import { WS_EVENTS } from '../ws-events.js';
import {
  listDeliverables, getDeliverable,
  generateDeliverable, refineDeliverable,
  setDeliverableStatus, exportDeliverables,
} from '../brand-identity.js';
import type { DeliverableTier } from '../../shared/types/brand-engine.js';
import { clearSeoContextCache } from '../seo-context.js';
import { invalidateIntelligenceCache } from '../workspace-intelligence.js';
import { getWorkspace } from '../workspaces.js';
import { checkUsageLimit, incrementUsage } from '../usage-tracking.js';

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

// Toggleable between `approved` and `draft` — reverting lets admins walk back
// an approval without deleting the deliverable. `setDeliverableStatus` fires
// the auto-sample side-effect only on the first draft→approved transition;
// re-approvals and approved→draft reversions are no-ops for that side effect.
const patchDeliverableSchema = z.object({
  status: z.enum(['approved', 'draft']),
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
    const ws = getWorkspace(req.params.workspaceId);
    if (!ws) return res.status(404).json({ error: 'Workspace not found' });
    const usage = checkUsageLimit(ws.id, ws.tier || 'free', 'strategy_generations');
    if (!usage.allowed) return res.status(429).json({ error: 'Monthly AI generation limit reached', used: usage.used, limit: usage.limit });

    const result = await generateDeliverable(req.params.workspaceId, deliverableType);
    incrementUsage(ws.id, 'strategy_generations');
    addActivity(req.params.workspaceId, 'brand_deliverable_generated', `Generated ${deliverableType.replace(/_/g, ' ')} deliverable`);
    broadcastToWorkspace(req.params.workspaceId, WS_EVENTS.BRAND_IDENTITY_UPDATED, { deliverableType });
    clearSeoContextCache(req.params.workspaceId);
    invalidateIntelligenceCache(req.params.workspaceId);
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
    addActivity(req.params.workspaceId, 'brand_deliverable_refined', `Refined ${result.deliverableType.replace(/_/g, ' ')} deliverable`);
    broadcastToWorkspace(req.params.workspaceId, WS_EVENTS.BRAND_IDENTITY_UPDATED, { deliverableId: req.params.id });
    clearSeoContextCache(req.params.workspaceId);
    invalidateIntelligenceCache(req.params.workspaceId);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Refinement failed' });
  }
});

// Update status (approve / revert to draft)
router.patch('/api/brand-identity/:workspaceId/:id', requireWorkspaceAccess('workspaceId'), validate(patchDeliverableSchema), (req, res) => {
  const { status } = req.body as { status: 'approved' | 'draft' };
  const result = setDeliverableStatus(req.params.workspaceId, req.params.id, status);
  if (!result) return res.status(404).json({ error: 'Not found' });
  const typeLabel = result.deliverableType.replace(/_/g, ' ');
  if (status === 'approved') {
    addActivity(req.params.workspaceId, 'brand_deliverable_approved', `Approved ${typeLabel} deliverable`);
  } else {
    addActivity(req.params.workspaceId, 'brand_deliverable_reverted', `Reverted ${typeLabel} deliverable to draft`);
  }
  broadcastToWorkspace(req.params.workspaceId, WS_EVENTS.BRAND_IDENTITY_UPDATED, { deliverableId: req.params.id, status });
  clearSeoContextCache(req.params.workspaceId);
  invalidateIntelligenceCache(req.params.workspaceId);
  res.json(result);
});

export default router;
