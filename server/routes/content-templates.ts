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
import { addActivity } from '../activity-log.js';
import { broadcastToWorkspace } from '../broadcast.js';
import { WS_EVENTS } from '../ws-events.js';
import {
  mutationError,
  runWorkspaceMutation,
  WorkspaceMutationError,
} from '../workspace-mutation-helper.js';

import { requireWorkspaceAccess } from '../auth.js';
const router = Router();
const log = createLogger('content-templates-routes');

function notifyContentPlanUpdated(workspaceId: string, payload: Record<string, unknown>) {
  broadcastToWorkspace(workspaceId, WS_EVENTS.CONTENT_UPDATED, { domain: 'content-plan', ...payload });
}

// List all templates for a workspace
router.get('/api/content-templates/:workspaceId', requireWorkspaceAccess('workspaceId'), (req, res) => {
  const templates = listTemplates(req.params.workspaceId);
  res.json(templates);
});

// Get a specific template
router.get('/api/content-templates/:workspaceId/:templateId', requireWorkspaceAccess('workspaceId'), (req, res) => {
  const template = getTemplate(req.params.workspaceId, req.params.templateId);
  if (!template) return res.status(404).json({ error: 'Template not found' });
  res.json(template);
});

// Create a new template
router.post('/api/content-templates/:workspaceId', requireWorkspaceAccess('workspaceId'), (req, res) => {
  try {
    const { name, description, pageType, variables, sections, urlPattern, keywordPattern, titlePattern, metaDescPattern, cmsFieldMap, toneAndStyle } = req.body;
    if (!name) return res.status(400).json({ error: 'name is required' });

    const template = runWorkspaceMutation({
      workspaceId: req.params.workspaceId,
      defaultErrorMessage: 'Failed to create template',
      mutate: ({ workspaceId }) => createTemplate(workspaceId, {
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
      }),
      onActivity: ({ workspaceId, result }) => {
        addActivity(
          workspaceId,
          'content_updated',
          `Created content template "${result.name}"`,
          `Page type: ${result.pageType}`,
          { templateId: result.id, action: 'template_created' },
        );
      },
      onBroadcast: ({ workspaceId, result }) => {
        notifyContentPlanUpdated(workspaceId, { templateId: result.id, action: 'template_created' });
      },
    });

    res.status(201).json(template);
  } catch (err) {
    if (err instanceof WorkspaceMutationError) {
      return res.status(err.status).json({ error: err.message });
    }
    log.error({ err, workspaceId: req.params.workspaceId }, 'Failed to create template');
    res.status(500).json({ error: 'Failed to create template' });
  }
});

// Update an existing template
router.put('/api/content-templates/:workspaceId/:templateId', requireWorkspaceAccess('workspaceId'), (req, res) => {
  try {
    const updated = runWorkspaceMutation({
      workspaceId: req.params.workspaceId,
      defaultErrorMessage: 'Failed to update template',
      mutate: ({ workspaceId }) => {
        const next = updateTemplate(workspaceId, req.params.templateId, req.body);
        if (!next) throw mutationError(404, 'Template not found');
        return next;
      },
      onActivity: ({ workspaceId, result }) => {
        addActivity(
          workspaceId,
          'content_updated',
          `Updated content template "${result.name}"`,
          undefined,
          { templateId: result.id, action: 'template_updated' },
        );
      },
      onBroadcast: ({ workspaceId, result }) => {
        notifyContentPlanUpdated(workspaceId, { templateId: result.id, action: 'template_updated' });
      },
    });
    res.json(updated);
  } catch (err) {
    if (err instanceof WorkspaceMutationError) {
      return res.status(err.status).json({ error: err.message });
    }
    log.error({ err, workspaceId: req.params.workspaceId, templateId: req.params.templateId }, 'Failed to update template');
    res.status(500).json({ error: 'Failed to update template' });
  }
});

// Delete a template
router.delete('/api/content-templates/:workspaceId/:templateId', requireWorkspaceAccess('workspaceId'), (req, res) => {
  try {
    runWorkspaceMutation({
      workspaceId: req.params.workspaceId,
      defaultErrorMessage: 'Failed to delete template',
      readBeforeWrite: ({ workspaceId }) => getTemplate(workspaceId, req.params.templateId),
      mutate: ({ workspaceId, existing }) => {
        if (!existing) throw mutationError(404, 'Template not found');
        const deleted = deleteTemplate(workspaceId, req.params.templateId);
        if (!deleted) throw mutationError(404, 'Template not found');
        return existing;
      },
      onActivity: ({ workspaceId, result }) => {
        addActivity(
          workspaceId,
          'content_updated',
          `Deleted content template "${result.name}"`,
          undefined,
          { templateId: result.id, action: 'template_deleted' },
        );
      },
      onBroadcast: ({ workspaceId, result }) => {
        notifyContentPlanUpdated(workspaceId, { templateId: result.id, action: 'template_deleted', deleted: true });
      },
    });
    res.json({ ok: true });
  } catch (err) {
    if (err instanceof WorkspaceMutationError) {
      return res.status(err.status).json({ error: err.message });
    }
    log.error({ err, workspaceId: req.params.workspaceId, templateId: req.params.templateId }, 'Failed to delete template');
    res.status(500).json({ error: 'Failed to delete template' });
  }
});

// Duplicate a template
router.post('/api/content-templates/:workspaceId/:templateId/duplicate', requireWorkspaceAccess('workspaceId'), (req, res) => {
  try {
    const { name } = req.body;
    const copy = runWorkspaceMutation({
      workspaceId: req.params.workspaceId,
      defaultErrorMessage: 'Failed to duplicate template',
      mutate: ({ workspaceId }) => {
        const duplicated = duplicateTemplate(workspaceId, req.params.templateId, name);
        if (!duplicated) throw mutationError(404, 'Template not found');
        return duplicated;
      },
      onActivity: ({ workspaceId, result }) => {
        addActivity(
          workspaceId,
          'content_updated',
          `Duplicated content template "${result.name}"`,
          undefined,
          { templateId: result.id, sourceTemplateId: req.params.templateId, action: 'template_duplicated' },
        );
      },
      onBroadcast: ({ workspaceId, result }) => {
        notifyContentPlanUpdated(workspaceId, { templateId: result.id, action: 'template_duplicated' });
      },
    });
    res.status(201).json(copy);
  } catch (err) {
    if (err instanceof WorkspaceMutationError) {
      return res.status(err.status).json({ error: err.message });
    }
    log.error({ err, workspaceId: req.params.workspaceId, templateId: req.params.templateId }, 'Failed to duplicate template');
    res.status(500).json({ error: 'Failed to duplicate template' });
  }
});

export default router;
