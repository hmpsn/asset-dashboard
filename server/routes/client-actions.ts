import { Router } from 'express';
import { requireWorkspaceAccess } from '../auth.js';
import { validate, z } from '../middleware/validate.js';
import { requireClientPortalAuth, getClientActor } from '../middleware.js';
import { addActivity } from '../activity-log.js';
import { broadcastToWorkspace } from '../broadcast.js';
import {
  createClientAction,
  listClientActions,
  updateClientAction,
  getClientAction,
  getActiveClientActionBySource,
} from '../client-actions.js';
import { getClientPortalUrl, getWorkspace } from '../workspaces.js';
import { notifyApprovalReady, notifyTeamActionApproved } from '../email.js';
import { enqueuePlaybook } from '../playbooks.js';
import { invalidateIntelligenceCache } from '../workspace-intelligence.js';
import { WS_EVENTS } from '../ws-events.js';
import { InvalidTransitionError } from '../state-machines.js';

const router = Router();

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

function broadcastActionUpdate(workspaceId: string, actionId: string, action: string) {
  broadcastToWorkspace(workspaceId, WS_EVENTS.CLIENT_ACTION_UPDATE, { actionId, action });
  invalidateIntelligenceCache(workspaceId);
}

router.post('/api/client-actions/:workspaceId', requireWorkspaceAccess('workspaceId'), validate(createActionSchema), (req, res) => {
  const workspaceId = req.params.workspaceId;
  const existing = req.body.sourceId
    ? getActiveClientActionBySource(workspaceId, req.body.sourceType, req.body.sourceId)
    : null;
  if (existing) return res.json(existing);

  const action = createClientAction({ workspaceId, ...req.body });
  addActivity(workspaceId, 'client_action_sent', `Sent to client: ${action.title}`, action.summary, { actionId: action.id, sourceType: action.sourceType });
  const ws = getWorkspace(workspaceId);
  if (ws?.clientEmail) {
    notifyApprovalReady({
      clientEmail: ws.clientEmail,
      workspaceName: ws.name,
      workspaceId,
      batchName: action.title,
      itemCount: 1,
      dashboardUrl: getClientPortalUrl(ws),
    });
  }
  broadcastActionUpdate(workspaceId, action.id, 'created');
  res.json(action);
});

router.get('/api/client-actions/:workspaceId', requireWorkspaceAccess('workspaceId'), (req, res) => {
  res.json(listClientActions(req.params.workspaceId));
});

router.patch('/api/client-actions/:workspaceId/:actionId', requireWorkspaceAccess('workspaceId'), validate(adminUpdateSchema), (req, res) => {
  const existing = getClientAction(req.params.workspaceId, req.params.actionId);
  if (!existing) return res.status(404).json({ error: 'Client action not found' });
  let updated;
  try {
    updated = updateClientAction(req.params.workspaceId, req.params.actionId, req.body);
  } catch (err) {
    if (err instanceof InvalidTransitionError) {
      return res.status(409).json({ error: err.message });
    }
    throw err;
  }
  if (!updated) return res.status(404).json({ error: 'Client action not found' });
  if (req.body.status === 'completed' && existing.status !== 'completed') {
    addActivity(req.params.workspaceId, 'client_action_completed', `Completed client action: ${updated.title}`, updated.summary, { actionId: updated.id, sourceType: updated.sourceType });
  }
  broadcastActionUpdate(req.params.workspaceId, req.params.actionId, 'updated');
  res.json(updated);
});

router.get('/api/public/client-actions/:workspaceId', requireClientPortalAuth(), (req, res) => {
  res.json(listClientActions(req.params.workspaceId));
});

router.patch('/api/public/client-actions/:workspaceId/:actionId/respond', requireClientPortalAuth(), validate(publicRespondSchema), (req, res) => {
  const existing = getClientAction(req.params.workspaceId, req.params.actionId);
  if (!existing) return res.status(404).json({ error: 'Client action not found' });
  if (existing.status !== 'pending') {
    return res.status(409).json({ error: 'This action is no longer awaiting client response' });
  }
  let updated;
  try {
    updated = updateClientAction(req.params.workspaceId, req.params.actionId, {
      status: req.body.status,
      clientNote: req.body.clientNote,
    });
  } catch (err) {
    if (err instanceof InvalidTransitionError) {
      return res.status(409).json({ error: err.message });
    }
    throw err;
  }
  if (!updated) return res.status(404).json({ error: 'Client action not found' });
  const actor = getClientActor(req, req.params.workspaceId);
  addActivity(
    req.params.workspaceId,
    req.body.status === 'approved' ? 'client_action_approved' : 'client_action_changes_requested',
    `${actor?.name || 'Client'} ${req.body.status === 'approved' ? 'approved' : 'requested changes on'} ${updated.title}`,
    req.body.clientNote || undefined,
    { actionId: updated.id, sourceType: updated.sourceType },
    actor,
  );
  broadcastActionUpdate(req.params.workspaceId, req.params.actionId, 'responded');

  if (req.body.status === 'approved') {
    const ws = getWorkspace(req.params.workspaceId);
    notifyTeamActionApproved({
      workspaceId: req.params.workspaceId,
      workspaceName: ws?.name || req.params.workspaceId,
      actionTitle: updated.title,
      sourceType: updated.sourceType,
      actionSummary: updated.summary,
      clientNote: req.body.clientNote,
      dashboardUrl: ws ? getClientPortalUrl(ws) : undefined,
    });
    enqueuePlaybook(req.params.workspaceId, updated);
  }

  res.json(updated);
});

export default router;
