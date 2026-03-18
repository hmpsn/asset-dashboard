/**
 * content-templates routes — CRUD for Content Templates (scalable content planning).
 */
import { Router } from 'express';
import {
  listTemplates,
  getTemplate,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  duplicateTemplate,
} from '../content-templates.js';
import { createLogger } from '../logger.js';

const router = Router();
const log = createLogger('content-templates-routes');

// List all templates for a workspace
router.get('/api/content-templates/:workspaceId', (req, res) => {
  const templates = listTemplates(req.params.workspaceId);
  res.json(templates);
});

// Get a specific template
router.get('/api/content-templates/:workspaceId/:templateId', (req, res) => {
  const template = getTemplate(req.params.workspaceId, req.params.templateId);
  if (!template) return res.status(404).json({ error: 'Template not found' });
  res.json(template);
});

// Create a new template
router.post('/api/content-templates/:workspaceId', (req, res) => {
  try {
    const { name, description, pageType, variables, sections, urlPattern, keywordPattern, titlePattern, metaDescPattern, cmsFieldMap, toneAndStyle } = req.body;
    if (!name) return res.status(400).json({ error: 'name is required' });

    const template = createTemplate(req.params.workspaceId, {
      name,
      description,
      pageType,
      variables,
      sections,
      urlPattern,
      keywordPattern,
      titlePattern,
      metaDescPattern,
      cmsFieldMap,
      toneAndStyle,
    });

    res.status(201).json(template);
  } catch (err) {
    log.error({ err, workspaceId: req.params.workspaceId }, 'Failed to create template');
    res.status(500).json({ error: 'Failed to create template' });
  }
});

// Update an existing template
router.put('/api/content-templates/:workspaceId/:templateId', (req, res) => {
  try {
    const updated = updateTemplate(req.params.workspaceId, req.params.templateId, req.body);
    if (!updated) return res.status(404).json({ error: 'Template not found' });
    res.json(updated);
  } catch (err) {
    log.error({ err, workspaceId: req.params.workspaceId, templateId: req.params.templateId }, 'Failed to update template');
    res.status(500).json({ error: 'Failed to update template' });
  }
});

// Delete a template
router.delete('/api/content-templates/:workspaceId/:templateId', (req, res) => {
  const deleted = deleteTemplate(req.params.workspaceId, req.params.templateId);
  if (!deleted) return res.status(404).json({ error: 'Template not found' });
  res.json({ ok: true });
});

// Duplicate a template
router.post('/api/content-templates/:workspaceId/:templateId/duplicate', (req, res) => {
  try {
    const { name } = req.body;
    const copy = duplicateTemplate(req.params.workspaceId, req.params.templateId, name);
    if (!copy) return res.status(404).json({ error: 'Template not found' });
    res.status(201).json(copy);
  } catch (err) {
    log.error({ err, workspaceId: req.params.workspaceId, templateId: req.params.templateId }, 'Failed to duplicate template');
    res.status(500).json({ error: 'Failed to duplicate template' });
  }
});

export default router;
