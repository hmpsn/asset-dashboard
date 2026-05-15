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
import { toClientInboxItem, toClientInboxItems } from '../serializers/client-safe.js';
import { createLogger } from '../logger.js';
import {
  mutationError,
  runWorkspaceMutation,
  WorkspaceMutationError,
} from './workspace-mutation-helper.js';

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

function broadcastActionUpdate(workspaceId: string, actionId: string, action: string) {
  broadcastToWorkspace(workspaceId, WS_EVENTS.CLIENT_ACTION_UPDATE, { actionId, action });
  invalidateIntelligenceCache(workspaceId);
}

router.post('/api/client-actions/:workspaceId', requireWorkspaceAccess('workspaceId'), validate(createActionSchema), (req, res) => {
  const workspaceId = req.params.workspaceId;
  try {
    const { action } = runWorkspaceMutation({
      workspaceId,
      defaultErrorMessage: 'Failed to create client action',
      readBeforeWrite: ({ workspaceId: currentWorkspaceId }) => {
        if (!req.body.sourceId) return null;
        return getActiveClientActionBySource(currentWorkspaceId, req.body.sourceType, req.body.sourceId);
      },
      mutate: ({ workspaceId: currentWorkspaceId, existing }) => {
        if (existing) {
          return { action: existing, isDuplicate: true as const };
        }
        return {
          action: createClientAction({ workspaceId: currentWorkspaceId, ...req.body }),
          isDuplicate: false as const,
        };
      },
      onActivity: ({ workspaceId: currentWorkspaceId, result }) => {
        if (result.isDuplicate) return;
        addActivity(currentWorkspaceId, 'client_action_sent', `Sent to client: ${result.action.title}`, result.action.summary, {
          actionId: result.action.id,
          sourceType: result.action.sourceType,
        });
      },
      onBroadcast: ({ workspaceId: currentWorkspaceId, result }) => {
        if (result.isDuplicate) return;
        const ws = getWorkspace(currentWorkspaceId);
        if (ws?.clientEmail) {
          notifyApprovalReady({
            clientEmail: ws.clientEmail,
            workspaceName: ws.name,
            workspaceId: currentWorkspaceId,
            batchName: result.action.title,
            itemCount: 1,
            dashboardUrl: getClientPortalUrl(ws),
          });
        }
        broadcastActionUpdate(currentWorkspaceId, result.action.id, 'created');
      },
    });
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
    const updated = runWorkspaceMutation({
      workspaceId: req.params.workspaceId,
      defaultErrorMessage: 'Failed to update client action',
      readBeforeWrite: ({ workspaceId }) => getClientAction(workspaceId, req.params.actionId),
      mutate: ({ workspaceId, existing }) => {
        if (!existing) throw mutationError(404, 'Client action not found');
        const next = updateClientAction(workspaceId, req.params.actionId, req.body);
        if (!next) throw mutationError(404, 'Client action not found');
        return next;
      },
      onActivity: ({ workspaceId, existing, result }) => {
        if (!existing) return;
        if (req.body.status === 'completed' && existing.status !== 'completed') {
          addActivity(workspaceId, 'client_action_completed', `Completed client action: ${result.title}`, result.summary, {
            actionId: result.id,
            sourceType: result.sourceType,
          });
        }
      },
      onBroadcast: ({ workspaceId, result }) => {
        broadcastActionUpdate(workspaceId, result.id, 'updated');
      },
      mapError: error => {
        if (error instanceof InvalidTransitionError) {
          return { status: 409, error: error.message };
        }
        return null;
      },
    });
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
    const updated = runWorkspaceMutation({
      workspaceId: req.params.workspaceId,
      defaultErrorMessage: 'Failed to respond to client action',
      readBeforeWrite: ({ workspaceId }) => getClientAction(workspaceId, req.params.actionId),
      mutate: ({ workspaceId, existing }) => {
        if (!existing) throw mutationError(404, 'Client action not found');
        if (existing.status !== 'pending') {
          throw mutationError(409, 'This action is no longer awaiting client response');
        }
        const next = updateClientAction(workspaceId, req.params.actionId, {
          status: req.body.status,
          clientNote: req.body.clientNote,
        });
        if (!next) throw mutationError(404, 'Client action not found');
        return next;
      },
      onActivity: ({ workspaceId, result }) => {
        addActivity(
          workspaceId,
          req.body.status === 'approved' ? 'client_action_approved' : 'client_action_changes_requested',
          `${actor?.name || 'Client'} ${req.body.status === 'approved' ? 'approved' : 'requested changes on'} ${result.title}`,
          req.body.clientNote || undefined,
          { actionId: result.id, sourceType: result.sourceType },
          actor,
        );
      },
      onBroadcast: ({ workspaceId, result }) => {
        broadcastActionUpdate(workspaceId, result.id, 'responded');
      },
      mapError: error => {
        if (error instanceof InvalidTransitionError) {
          return { status: 409, error: error.message };
        }
        return null;
      },
    });
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
