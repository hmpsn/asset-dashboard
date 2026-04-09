import { Router } from 'express';
import { requireWorkspaceAccess } from '../auth.js';
import { addActivity } from '../activity-log.js';
import { broadcastToWorkspace } from '../broadcast.js';
import { WS_EVENTS } from '../ws-events.js';
import {
  listBrandscripts, getBrandscript, createBrandscript,
  updateBrandscriptSections, deleteBrandscript,
  listTemplates, createTemplate,
  importBrandscript, completeBrandscript,
} from '../brandscript.js';

const router = Router();

// Templates
router.get('/api/brandscript-templates', (_req, res) => {
  res.json(listTemplates());
});

router.post('/api/brandscript-templates', (req, res) => {
  const { name, description, sections } = req.body;
  if (!name || !sections?.length) return res.status(400).json({ error: 'name and sections required' });
  res.json(createTemplate(name, description || '', sections));
});

// CRUD — use :workspaceId everywhere
router.get('/api/brandscripts/:workspaceId', requireWorkspaceAccess('workspaceId'), (req, res) => {
  res.json(listBrandscripts(req.params.workspaceId));
});

// AI: Import from text — MUST be before /:workspaceId/:id to avoid shadowing
router.post('/api/brandscripts/:workspaceId/import', requireWorkspaceAccess('workspaceId'), async (req, res) => {
  const { name, rawText } = req.body;
  if (!rawText) return res.status(400).json({ error: 'rawText required' });
  try {
    const bs = await importBrandscript(req.params.workspaceId, name || 'Imported Brandscript', rawText);
    addActivity(req.params.workspaceId, 'brandscript_imported', `Imported brandscript "${bs.name}"`);
    broadcastToWorkspace(req.params.workspaceId, WS_EVENTS.BRANDSCRIPT_UPDATED, { brandscriptId: bs.id });
    res.json(bs);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Import failed' });
  }
});

router.post('/api/brandscripts/:workspaceId', requireWorkspaceAccess('workspaceId'), (req, res) => {
  const { name, frameworkType, sections } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  const bs = createBrandscript(req.params.workspaceId, name, frameworkType || 'storybrand', sections || []);
  addActivity(req.params.workspaceId, 'brandscript_created', `Created brandscript "${bs.name}"`);
  broadcastToWorkspace(req.params.workspaceId, WS_EVENTS.BRANDSCRIPT_UPDATED, { brandscriptId: bs.id });
  res.json(bs);
});

router.get('/api/brandscripts/:workspaceId/:id', requireWorkspaceAccess('workspaceId'), (req, res) => {
  const bs = getBrandscript(req.params.workspaceId, req.params.id);
  if (!bs) return res.status(404).json({ error: 'Not found' });
  res.json(bs);
});

router.put('/api/brandscripts/:workspaceId/:id/sections', requireWorkspaceAccess('workspaceId'), (req, res) => {
  const { sections } = req.body;
  if (!sections) return res.status(400).json({ error: 'sections required' });
  const result = updateBrandscriptSections(req.params.workspaceId, req.params.id, sections);
  if (!result) return res.status(404).json({ error: 'Not found' });
  broadcastToWorkspace(req.params.workspaceId, WS_EVENTS.BRANDSCRIPT_UPDATED, { brandscriptId: req.params.id });
  res.json(result);
});

router.delete('/api/brandscripts/:workspaceId/:id', requireWorkspaceAccess('workspaceId'), (req, res) => {
  const ok = deleteBrandscript(req.params.workspaceId, req.params.id);
  if (!ok) return res.status(404).json({ error: 'Not found' });
  addActivity(req.params.workspaceId, 'brandscript_deleted', 'Deleted brandscript');
  broadcastToWorkspace(req.params.workspaceId, WS_EVENTS.BRANDSCRIPT_UPDATED, { brandscriptId: req.params.id, deleted: true });
  res.json({ deleted: true });
});

// AI: Complete empty sections
router.post('/api/brandscripts/:workspaceId/:id/complete', requireWorkspaceAccess('workspaceId'), async (req, res) => {
  try {
    const bs = await completeBrandscript(req.params.workspaceId, req.params.id);
    if (!bs) return res.status(404).json({ error: 'Not found' });
    addActivity(req.params.workspaceId, 'brandscript_completed', `AI completed sections in brandscript "${bs.name}"`);
    broadcastToWorkspace(req.params.workspaceId, WS_EVENTS.BRANDSCRIPT_UPDATED, { brandscriptId: req.params.id });
    res.json(bs);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Completion failed' });
  }
});

export default router;
