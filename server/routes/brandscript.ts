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
    res.json(bs);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Import failed' });
  }
});

router.post('/api/brandscripts/:workspaceId', requireWorkspaceAccess('workspaceId'), validate(createBrandscriptSchema), (req, res) => {
  const { name, frameworkType, sections } = req.body;
  const bs = createBrandscript(req.params.workspaceId, name, frameworkType, sections);
  addActivity(req.params.workspaceId, 'brandscript_created', `Created brandscript "${bs.name}"`);
  broadcastToWorkspace(req.params.workspaceId, WS_EVENTS.BRANDSCRIPT_UPDATED, { brandscriptId: bs.id });
  clearSeoContextCache(req.params.workspaceId);
  res.json(bs);
});

router.get('/api/brandscripts/:workspaceId/:id', requireWorkspaceAccess('workspaceId'), (req, res) => {
  const bs = getBrandscript(req.params.workspaceId, req.params.id);
  if (!bs) return res.status(404).json({ error: 'Not found' });
  res.json(bs);
});

router.put('/api/brandscripts/:workspaceId/:id/sections', requireWorkspaceAccess('workspaceId'), validate(updateSectionsSchema), (req, res) => {
  const { sections } = req.body;
  const result = updateBrandscriptSections(req.params.workspaceId, req.params.id, sections);
  if (!result) return res.status(404).json({ error: 'Not found' });
  broadcastToWorkspace(req.params.workspaceId, WS_EVENTS.BRANDSCRIPT_UPDATED, { brandscriptId: req.params.id });
  clearSeoContextCache(req.params.workspaceId);
  res.json(result);
});

router.delete('/api/brandscripts/:workspaceId/:id', requireWorkspaceAccess('workspaceId'), (req, res) => {
  const ok = deleteBrandscript(req.params.workspaceId, req.params.id);
  if (!ok) return res.status(404).json({ error: 'Not found' });
  addActivity(req.params.workspaceId, 'brandscript_deleted', 'Deleted brandscript');
  broadcastToWorkspace(req.params.workspaceId, WS_EVENTS.BRANDSCRIPT_UPDATED, { brandscriptId: req.params.id, deleted: true });
  clearSeoContextCache(req.params.workspaceId);
  res.json({ deleted: true });
});

// AI: Complete empty sections
router.post('/api/brandscripts/:workspaceId/:id/complete', requireWorkspaceAccess('workspaceId'), async (req, res) => {
  try {
    const bs = await completeBrandscript(req.params.workspaceId, req.params.id);
    if (!bs) return res.status(404).json({ error: 'Not found' });
    addActivity(req.params.workspaceId, 'brandscript_completed', `AI completed sections in brandscript "${bs.name}"`);
    broadcastToWorkspace(req.params.workspaceId, WS_EVENTS.BRANDSCRIPT_UPDATED, { brandscriptId: req.params.id });
    clearSeoContextCache(req.params.workspaceId);
    res.json(bs);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Completion failed' });
  }
});

export default router;
