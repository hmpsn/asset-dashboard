import { Router } from 'express';
import { requireWorkspaceAccess } from '../auth.js';
import { validate, z } from '../middleware/validate.js';
import { requireClientPortalAuth, getClientActor } from '../middleware.js';
import {
  listClientActions,
} from '../client-actions.js';
import { toClientInboxItem, toClientInboxItems } from '../serializers/client-safe.js';
import { createLogger } from '../logger.js';
import {
  WorkspaceMutationError,
} from '../workspace-mutation-helper.js';
import {
  createAdminClientAction,
  updateAdminClientAction,
  respondToPublicClientAction,
} from '../domains/inbox/client-actions-mutations.js';

const router = Router();
const log = createLogger('routes:client-actions');

const sourceTypeSchema = z.enum(['aeo_change', 'internal_link', 'redirect_proposal', 'content_decay']);
const statusSchema = z.enum(['pending', 'approved', 'changes_requested', 'completed', 'archived']);

const createActionSchema = z.object({
  sourceType: sourceTypeSchema,
  sourceId: z.string().max(200).optional(),
  title: z.string().min(1).max(300),
  summary: z.string().min(1).max(3000),
  payload: z.record(z.string(), z.unknown()).optional(),
  priority: z.enum(['high', 'medium', 'low']).optional(),
  clientNote: z.string().max(2000).optional(),
}).strict();

const adminUpdateSchema = z.object({
  title: z.string().min(1).max(300).optional(),
  summary: z.string().min(1).max(3000).optional(),
  payload: z.record(z.string(), z.unknown()).optional(),
  priority: z.enum(['high', 'medium', 'low']).optional(),
  status: statusSchema.optional(),
  clientNote: z.string().max(2000).optional(),
}).strict();

const publicRespondSchema = z.object({
  status: z.enum(['approved', 'changes_requested']),
  clientNote: z.string().max(2000).optional(),
}).strict();

router.post('/api/client-actions/:workspaceId', requireWorkspaceAccess('workspaceId'), validate(createActionSchema), (req, res) => {
  const workspaceId = req.params.workspaceId;
  try {
    const action = createAdminClientAction(workspaceId, req.body);
    res.json(toClientInboxItem(action));
  } catch (err) {
    if (err instanceof WorkspaceMutationError) {
      return res.status(err.status).json({ error: err.message });
    }
    log.error({ err, workspaceId }, 'Failed to create client action');
    res.status(500).json({ error: 'Failed to create client action' });
  }
});

router.get('/api/client-actions/:workspaceId', requireWorkspaceAccess('workspaceId'), (req, res) => {
  res.json(toClientInboxItems(listClientActions(req.params.workspaceId)));
});

router.patch('/api/client-actions/:workspaceId/:actionId', requireWorkspaceAccess('workspaceId'), validate(adminUpdateSchema), (req, res) => {
  try {
    const updated = updateAdminClientAction(req.params.workspaceId, req.params.actionId, req.body);
    res.json(toClientInboxItem(updated));
  } catch (err) {
    if (err instanceof WorkspaceMutationError) {
      return res.status(err.status).json({ error: err.message });
    }
    log.error({ err, workspaceId: req.params.workspaceId, actionId: req.params.actionId }, 'Failed to update client action');
    res.status(500).json({ error: 'Failed to update client action' });
  }
});

router.get('/api/public/client-actions/:workspaceId', requireClientPortalAuth(), (req, res) => {
  res.json(toClientInboxItems(listClientActions(req.params.workspaceId)));
});

router.patch('/api/public/client-actions/:workspaceId/:actionId/respond', requireClientPortalAuth(), validate(publicRespondSchema), (req, res) => {
  const actor = getClientActor(req, req.params.workspaceId);
  try {
    const updated = respondToPublicClientAction(req.params.workspaceId, req.params.actionId, req.body, actor);
    res.json(toClientInboxItem(updated));
  } catch (err) {
    if (err instanceof WorkspaceMutationError) {
      return res.status(err.status).json({ error: err.message });
    }
    log.error(
      { err, workspaceId: req.params.workspaceId, actionId: req.params.actionId },
      'Failed to respond to client action',
    );
    res.status(500).json({ error: 'Failed to respond to client action' });
  }
});

export default router;
