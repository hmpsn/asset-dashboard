import { Router } from 'express';
import { requireWorkspaceAccess } from '../auth.js';
import { validate, z } from '../middleware/validate.js';
import { addActivity } from '../activity-log.js';
import { broadcastToWorkspace } from '../broadcast.js';
import { WS_EVENTS } from '../ws-events.js';
import {
  listDeliverables, getDeliverable,
  generateDeliverable, refineDeliverable,
  setDeliverableStatus, updateDeliverableContent, exportDeliverables,
} from '../brand-identity.js';
import {
  isReleasedBrandDeliverableType,
  RELEASED_BRAND_DELIVERABLE_TYPES,
  type DeliverableTier,
} from '../../shared/types/brand-engine.js';
import { invalidateIntelligenceCache } from '../intelligence/cache-invalidation.js';
import { InvalidTransitionError } from '../state-machines.js';
import { computeEffectiveTier, getWorkspace } from '../workspaces.js';
import { incrementIfAllowed, decrementUsage } from '../usage-tracking.js';
import { aiLimiter } from '../middleware.js';
import { sanitizeErrorMessage } from '../utils/text.js';
import { createLogger } from '../logger.js';

const router = Router();
const log = createLogger('brand-identity-routes');

function runBrandIdentityPostCommitEffect(
  workspaceId: string,
  effect: 'activity' | 'broadcast' | 'intelligence-cache',
  run: () => void,
): void {
  try {
    run();
  } catch (err) {
    log.warn({ err, workspaceId, effect }, 'brand identity post-commit effect failed');
  }
}

function refundBrandIdentityUsage(workspaceId: string): void {
  try {
    decrementUsage(workspaceId, 'brandscript_generations');
  } catch (err) {
    log.warn({ err, workspaceId }, 'failed to refund brand identity usage');
  }
}

// ── Zod schemas ─────────────────────────────────────────────────────────────

// Compatibility boundary: this is the legacy single-deliverable paid generator.
// `naming` is durable vocabulary reserved for the reviewed MCP brand pipeline and
// intentionally stays excluded here until that pipeline owns its generation gates.
const deliverableTypeSchema = z.enum(RELEASED_BRAND_DELIVERABLE_TYPES);

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
  status: z.enum(['approved', 'draft']).optional(),
  content: z.string().trim().min(1).optional(),
}).refine(
  (data) => typeof data.status !== 'undefined' || typeof data.content !== 'undefined',
  { message: 'Provide at least one field to update' },
);

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
router.post('/api/brand-identity/:workspaceId/generate', requireWorkspaceAccess('workspaceId'), aiLimiter, validate(generateDeliverableSchema), async (req, res) => {
  const { deliverableType } = req.body;
  const ws = getWorkspace(req.params.workspaceId);
  if (!ws) return res.status(404).json({ error: 'Workspace not found' });
  const tier = computeEffectiveTier(ws);
  if (!incrementIfAllowed(ws.id, tier, 'brandscript_generations')) {
    return res.status(429).json({ error: 'Monthly limit reached for your tier', code: 'usage_limit' });
  }

  let result: Awaited<ReturnType<typeof generateDeliverable>>;
  try {
    result = await generateDeliverable(req.params.workspaceId, deliverableType);
  } catch (err) {
    refundBrandIdentityUsage(ws.id);
    return res.status(500).json({ error: sanitizeErrorMessage(err, 'Generation failed') });
  }

  runBrandIdentityPostCommitEffect(req.params.workspaceId, 'activity', () => {
    addActivity(req.params.workspaceId, 'brand_deliverable_generated', `Generated ${deliverableType.replace(/_/g, ' ')} deliverable`);
  });
  runBrandIdentityPostCommitEffect(req.params.workspaceId, 'broadcast', () => {
    broadcastToWorkspace(req.params.workspaceId, WS_EVENTS.BRAND_IDENTITY_UPDATED, { deliverableType });
  });
  runBrandIdentityPostCommitEffect(req.params.workspaceId, 'intelligence-cache', () => {
    invalidateIntelligenceCache(req.params.workspaceId);
  });
  return res.json(result);
});

// Refine a deliverable with steering direction
router.post('/api/brand-identity/:workspaceId/:id/refine', requireWorkspaceAccess('workspaceId'), aiLimiter, validate(refineDeliverableSchema), async (req, res) => {
  const { direction } = req.body;
  const ws = getWorkspace(req.params.workspaceId);
  if (!ws) return res.status(404).json({ error: 'Workspace not found' });
  const target = getDeliverable(req.params.workspaceId, req.params.id);
  if (target && !isReleasedBrandDeliverableType(target.deliverableType)) {
    return res.status(400).json({ error: 'Unsupported legacy brand deliverable type' });
  }
  const tier = computeEffectiveTier(ws);
  if (!incrementIfAllowed(ws.id, tier, 'brandscript_generations')) {
    return res.status(429).json({ error: 'Monthly limit reached for your tier', code: 'usage_limit' });
  }

  let result: Awaited<ReturnType<typeof refineDeliverable>>;
  try {
    result = await refineDeliverable(req.params.workspaceId, req.params.id, direction);
  } catch (err) {
    refundBrandIdentityUsage(ws.id);
    return res.status(500).json({ error: sanitizeErrorMessage(err, 'Refinement failed') });
  }
  if (!result) {
    refundBrandIdentityUsage(ws.id);
    return res.status(404).json({ error: 'Not found' });
  }

  runBrandIdentityPostCommitEffect(req.params.workspaceId, 'activity', () => {
    addActivity(req.params.workspaceId, 'brand_deliverable_refined', `Refined ${result.deliverableType.replace(/_/g, ' ')} deliverable`);
  });
  runBrandIdentityPostCommitEffect(req.params.workspaceId, 'broadcast', () => {
    broadcastToWorkspace(req.params.workspaceId, WS_EVENTS.BRAND_IDENTITY_UPDATED, { deliverableId: req.params.id });
  });
  runBrandIdentityPostCommitEffect(req.params.workspaceId, 'intelligence-cache', () => {
    invalidateIntelligenceCache(req.params.workspaceId);
  });
  return res.json(result);
});

// Update status (approve / revert to draft)
router.patch('/api/brand-identity/:workspaceId/:id', requireWorkspaceAccess('workspaceId'), validate(patchDeliverableSchema), (req, res) => {
  const { status, content } = req.body as { status?: 'approved' | 'draft'; content?: string };
  const workspaceId = req.params.workspaceId;
  const deliverableId = req.params.id;

  let result = null;
  if (typeof content !== 'undefined') {
    result = updateDeliverableContent(workspaceId, deliverableId, content);
    if (!result) return res.status(404).json({ error: 'Not found' });
    const typeLabel = result.deliverableType.replace(/_/g, ' ');
    addActivity(workspaceId, 'brand_deliverable_refined', `Edited ${typeLabel} deliverable`);
  }

  if (typeof status !== 'undefined') {
    try {
      result = setDeliverableStatus(workspaceId, deliverableId, status);
    } catch (err) {
      if (err instanceof InvalidTransitionError) return res.status(409).json({ error: err.message });
      throw err;
    }
    if (!result) return res.status(404).json({ error: 'Not found' });
    const typeLabel = result.deliverableType.replace(/_/g, ' ');
    if (status === 'approved') {
      addActivity(workspaceId, 'brand_deliverable_approved', `Approved ${typeLabel} deliverable`);
    } else {
      addActivity(workspaceId, 'brand_deliverable_reverted', `Reverted ${typeLabel} deliverable to draft`);
    }
  }

  if (!result) return res.status(404).json({ error: 'Not found' });
  broadcastToWorkspace(workspaceId, WS_EVENTS.BRAND_IDENTITY_UPDATED, { deliverableId, status, contentUpdated: typeof content !== 'undefined' });
  invalidateIntelligenceCache(workspaceId);
  res.json(result);
});

export default router;
