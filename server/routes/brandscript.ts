import { Router } from 'express';
import { requireWorkspaceAccess } from '../auth.js';
import { validate, z } from '../middleware/validate.js';
import { addActivity } from '../activity-log.js';
import { broadcastToWorkspace } from '../broadcast.js';
import { WS_EVENTS } from '../ws-events.js';
import {
  listBrandscripts, getBrandscript, createBrandscript,
  updateBrandscriptSections, deleteBrandscript,
  listTemplates, createTemplate,
  importBrandscript, completeBrandscript,
} from '../brandscript.js';
import { clearSeoContextCache } from '../seo-context.js';
import { invalidateIntelligenceCache } from '../workspace-intelligence.js';
import { aiLimiter } from '../middleware.js';
import { incrementIfAllowed, decrementUsage } from '../usage-tracking.js';
import { sanitizeErrorMessage } from '../helpers.js';
import { getWorkspace } from '../workspaces.js';

const router = Router();

// ── Zod schemas ─────────────────────────────────────────────────────────────

const templateSectionSchema = z.object({
  title: z.string().min(1),
  purpose: z.string().min(1),
});

const createTemplateSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional().default(''),
  sections: z.array(templateSectionSchema).min(1),
});

const brandscriptSectionInputSchema = z.object({
  id: z.string().optional(),
  title: z.string().min(1),
  purpose: z.string().optional(),
  content: z.string().optional(),
});

const createBrandscriptSchema = z.object({
  name: z.string().min(1),
  frameworkType: z.string().optional().default('storybrand'),
  sections: z.array(brandscriptSectionInputSchema).optional().default([]),
});

const updateSectionsSchema = z.object({
  sections: z.array(brandscriptSectionInputSchema),
  expectedUpdatedAt: z.string().optional(),
});

const importBrandscriptSchema = z.object({
  name: z.string().optional(),
  rawText: z.string().min(1),
});

// ── Routes ──────────────────────────────────────────────────────────────────

// Templates
router.get('/api/brandscript-templates', (_req, res) => {
  res.json(listTemplates());
});

router.post('/api/brandscript-templates', validate(createTemplateSchema), (req, res) => {
  const { name, description, sections } = req.body;
  res.json(createTemplate(name, description, sections));
});

// CRUD — use :workspaceId everywhere
router.get('/api/brandscripts/:workspaceId', requireWorkspaceAccess('workspaceId'), (req, res) => {
  res.json(listBrandscripts(req.params.workspaceId));
});

// AI: Import from text — MUST be before /:workspaceId/:id to avoid shadowing
router.post('/api/brandscripts/:workspaceId/import', requireWorkspaceAccess('workspaceId'), validate(importBrandscriptSchema), async (req, res) => {
  const { name, rawText } = req.body;
  try {
    const bs = await importBrandscript(req.params.workspaceId, name || 'Imported Brandscript', rawText);
    addActivity(req.params.workspaceId, 'brandscript_imported', `Imported brandscript "${bs.name}"`);
    broadcastToWorkspace(req.params.workspaceId, WS_EVENTS.BRANDSCRIPT_UPDATED, { brandscriptId: bs.id });
    clearSeoContextCache(req.params.workspaceId);
    invalidateIntelligenceCache(req.params.workspaceId);
    res.json(bs);
  } catch (err) {
    res.status(500).json({ error: sanitizeErrorMessage(err, 'Import failed') });
  }
});

router.post('/api/brandscripts/:workspaceId', requireWorkspaceAccess('workspaceId'), validate(createBrandscriptSchema), (req, res) => {
  const { name, frameworkType, sections } = req.body;
  const bs = createBrandscript(req.params.workspaceId, name, frameworkType, sections);
  addActivity(req.params.workspaceId, 'brandscript_created', `Created brandscript "${bs.name}"`);
  broadcastToWorkspace(req.params.workspaceId, WS_EVENTS.BRANDSCRIPT_UPDATED, { brandscriptId: bs.id });
  clearSeoContextCache(req.params.workspaceId);
  invalidateIntelligenceCache(req.params.workspaceId);
  res.json(bs);
});

router.get('/api/brandscripts/:workspaceId/:id', requireWorkspaceAccess('workspaceId'), (req, res) => {
  const bs = getBrandscript(req.params.workspaceId, req.params.id);
  if (!bs) return res.status(404).json({ error: 'Not found' });
  res.json(bs);
});

router.put('/api/brandscripts/:workspaceId/:id/sections', requireWorkspaceAccess('workspaceId'), validate(updateSectionsSchema), (req, res) => {
  const { sections, expectedUpdatedAt } = req.body;

  // Staleness check: if the caller passes the updatedAt it last saw, reject
  // with 409 when the DB row has been modified since then.
  if (expectedUpdatedAt) {
    const current = getBrandscript(req.params.workspaceId, req.params.id);
    if (!current) return res.status(404).json({ error: 'Not found' });
    if (current.updatedAt > expectedUpdatedAt) {
      return res.status(409).json({ error: 'This brandscript was updated by another session. Reload to see the latest changes.' });
    }
  }

  const result = updateBrandscriptSections(req.params.workspaceId, req.params.id, sections);
  if (!result) return res.status(404).json({ error: 'Not found' });
  addActivity(
    req.params.workspaceId,
    'brandscript_sections_updated',
    `Updated sections for brandscript "${result.name}"`,
  );
  broadcastToWorkspace(req.params.workspaceId, WS_EVENTS.BRANDSCRIPT_UPDATED, { brandscriptId: req.params.id });
  clearSeoContextCache(req.params.workspaceId);
  invalidateIntelligenceCache(req.params.workspaceId);
  res.json(result);
});

router.delete('/api/brandscripts/:workspaceId/:id', requireWorkspaceAccess('workspaceId'), (req, res) => {
  // Read name before delete so the activity log can include it.
  const existing = getBrandscript(req.params.workspaceId, req.params.id);
  const ok = deleteBrandscript(req.params.workspaceId, req.params.id);
  if (!ok) return res.status(404).json({ error: 'Not found' });
  addActivity(
    req.params.workspaceId,
    'brandscript_deleted',
    existing ? `Deleted brandscript "${existing.name}"` : 'Deleted brandscript',
  );
  broadcastToWorkspace(req.params.workspaceId, WS_EVENTS.BRANDSCRIPT_UPDATED, { brandscriptId: req.params.id, deleted: true });
  clearSeoContextCache(req.params.workspaceId);
  invalidateIntelligenceCache(req.params.workspaceId);
  res.json({ deleted: true });
});

// AI: Complete empty sections
router.post(
  '/api/brandscripts/:workspaceId/:id/complete',
  requireWorkspaceAccess('workspaceId'),
  aiLimiter,
  async (req, res) => {
    const ws = getWorkspace(req.params.workspaceId);
    const tier = (ws?.tier ?? 'free') as string;

    if (!incrementIfAllowed(req.params.workspaceId, tier, 'brandscript_generations')) {
      return res.status(429).json({
        error: 'Monthly limit reached for your tier',
        code: 'usage_limit',
      });
    }

    try {
      const bs = await completeBrandscript(req.params.workspaceId, req.params.id);
      if (!bs) {
        decrementUsage(req.params.workspaceId, 'brandscript_generations');
        return res.status(404).json({ error: 'Not found' });
      }
      addActivity(req.params.workspaceId, 'brandscript_completed', `AI completed sections in brandscript "${bs.name}"`);
      broadcastToWorkspace(req.params.workspaceId, WS_EVENTS.BRANDSCRIPT_UPDATED, { brandscriptId: req.params.id });
      clearSeoContextCache(req.params.workspaceId);
      invalidateIntelligenceCache(req.params.workspaceId);
      res.json(bs);
    } catch (err) {
      decrementUsage(req.params.workspaceId, 'brandscript_generations');
      res.status(500).json({ error: sanitizeErrorMessage(err, 'Completion failed') });
    }
  },
);

export default router;
