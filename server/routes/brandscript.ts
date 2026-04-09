import { Router } from 'express';
import { requireWorkspaceAccess } from '../auth.js';
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

router.get('/api/brandscripts/:workspaceId/:id', requireWorkspaceAccess('workspaceId'), (req, res) => {
  const bs = getBrandscript(req.params.workspaceId, req.params.id);
  if (!bs) return res.status(404).json({ error: 'Not found' });
  res.json(bs);
});

router.post('/api/brandscripts/:workspaceId', requireWorkspaceAccess('workspaceId'), (req, res) => {
  const { name, frameworkType, sections } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  res.json(createBrandscript(req.params.workspaceId, name, frameworkType || 'storybrand', sections || []));
});

router.put('/api/brandscripts/:workspaceId/:id/sections', requireWorkspaceAccess('workspaceId'), (req, res) => {
  const { sections } = req.body;
  if (!sections) return res.status(400).json({ error: 'sections required' });
  const result = updateBrandscriptSections(req.params.workspaceId, req.params.id, sections);
  if (!result) return res.status(404).json({ error: 'Not found' });
  res.json(result);
});

router.delete('/api/brandscripts/:workspaceId/:id', requireWorkspaceAccess('workspaceId'), (req, res) => {
  const ok = deleteBrandscript(req.params.workspaceId, req.params.id);
  if (!ok) return res.status(404).json({ error: 'Not found' });
  res.json({ deleted: true });
});

// AI: Import from text
router.post('/api/brandscripts/:workspaceId/import', requireWorkspaceAccess('workspaceId'), async (req, res) => {
  const { name, rawText } = req.body;
  if (!rawText) return res.status(400).json({ error: 'rawText required' });
  try {
    const bs = await importBrandscript(req.params.workspaceId, name || 'Imported Brandscript', rawText);
    res.json(bs);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Import failed' });
  }
});

// AI: Complete empty sections
router.post('/api/brandscripts/:workspaceId/:id/complete', requireWorkspaceAccess('workspaceId'), async (req, res) => {
  try {
    const bs = await completeBrandscript(req.params.workspaceId, req.params.id);
    if (!bs) return res.status(404).json({ error: 'Not found' });
    res.json(bs);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Completion failed' });
  }
});

export default router;
