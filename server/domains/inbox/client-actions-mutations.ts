import { addActivity } from '../../activity-log.js';
import { createClientAction, getActiveClientActionBySource, getClientAction, updateClientAction } from '../../client-actions.js';
import { notifyApprovalReady, notifyTeamActionApproved } from '../../email.js';
import { enqueuePlaybook } from '../../playbooks.js';
import { mutationError, runWorkspaceMutation } from '../../workspace-mutation-helper.js';
import { getClientPortalUrl, getWorkspace } from '../../workspaces.js';
import { broadcastToWorkspace } from '../../broadcast.js';
import { invalidateIntelligenceCache } from '../../workspace-intelligence.js';
import { WS_EVENTS } from '../../ws-events.js';
import { InvalidTransitionError } from '../../state-machines.js';
import type { ClientAction, ClientActionPayload, ClientActionSourceType } from '../../../shared/types/client-actions.js';

type ClientActor = { id?: string; name?: string } | undefined;

export type CreateClientActionRequest = {
  sourceType: ClientActionSourceType;
  sourceId?: string;
  title: string;
  summary: string;
  payload?: ClientActionPayload;
  priority?: 'high' | 'medium' | 'low';
  clientNote?: string;
};

export type UpdateClientActionRequest = {
  title?: string;
  summary?: string;
  payload?: ClientActionPayload;
  priority?: 'high' | 'medium' | 'low';
  status?: ClientAction['status'];
  clientNote?: string;
};

export type RespondToClientActionRequest = {
  status: 'approved' | 'changes_requested';
  clientNote?: string;
};

function broadcastActionUpdate(workspaceId: string, actionId: string, action: string) {
  broadcastToWorkspace(workspaceId, WS_EVENTS.CLIENT_ACTION_UPDATE, { actionId, action });
  invalidateIntelligenceCache(workspaceId);
}

export function createAdminClientAction(workspaceId: string, input: CreateClientActionRequest): ClientAction {
  const { action } = runWorkspaceMutation({
    workspaceId,
    defaultErrorMessage: 'Failed to create client action',
    readBeforeWrite: ({ workspaceId: currentWorkspaceId }) => {
      if (!input.sourceId) return null;
      return getActiveClientActionBySource(currentWorkspaceId, input.sourceType, input.sourceId);
    },
    mutate: ({ workspaceId: currentWorkspaceId, existing }) => {
      if (existing) {
        return { action: existing, isDuplicate: true as const };
      }
      return {
        action: createClientAction({ workspaceId: currentWorkspaceId, ...input }),
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
  return action;
}

export function updateAdminClientAction(
  workspaceId: string,
  actionId: string,
  updates: UpdateClientActionRequest,
): ClientAction {
  return runWorkspaceMutation({
    workspaceId,
    defaultErrorMessage: 'Failed to update client action',
    readBeforeWrite: ({ workspaceId: currentWorkspaceId }) => getClientAction(currentWorkspaceId, actionId),
    mutate: ({ workspaceId: currentWorkspaceId, existing }) => {
      if (!existing) throw mutationError(404, 'Client action not found');
      const next = updateClientAction(currentWorkspaceId, actionId, updates);
      if (!next) throw mutationError(404, 'Client action not found');
      return next;
    },
    onActivity: ({ workspaceId: currentWorkspaceId, existing, result }) => {
      if (!existing) return;
      if (updates.status === 'completed' && existing.status !== 'completed') {
        addActivity(
          currentWorkspaceId,
          'client_action_completed',
          `Completed client action: ${result.title}`,
          result.summary,
          { actionId: result.id, sourceType: result.sourceType },
        );
      }
    },
    onBroadcast: ({ workspaceId: currentWorkspaceId, result }) => {
      broadcastActionUpdate(currentWorkspaceId, result.id, 'updated');
    },
    mapError: error => {
      if (error instanceof InvalidTransitionError) {
        return { status: 409, error: error.message };
      }
      return null;
    },
  });
}

export function respondToPublicClientAction(
  workspaceId: string,
  actionId: string,
  response: RespondToClientActionRequest,
  actor: ClientActor,
): ClientAction {
  const updated = runWorkspaceMutation({
    workspaceId,
    defaultErrorMessage: 'Failed to respond to client action',
    readBeforeWrite: ({ workspaceId: currentWorkspaceId }) => getClientAction(currentWorkspaceId, actionId),
    mutate: ({ workspaceId: currentWorkspaceId, existing }) => {
      if (!existing) throw mutationError(404, 'Client action not found');
      if (existing.status !== 'pending') {
        throw mutationError(409, 'This action is no longer awaiting client response');
      }
      const next = updateClientAction(currentWorkspaceId, actionId, {
        status: response.status,
        clientNote: response.clientNote,
      });
      if (!next) throw mutationError(404, 'Client action not found');
      return next;
    },
    onActivity: ({ workspaceId: currentWorkspaceId, result }) => {
      addActivity(
        currentWorkspaceId,
        response.status === 'approved' ? 'client_action_approved' : 'client_action_changes_requested',
        `${actor?.name || 'Client'} ${response.status === 'approved' ? 'approved' : 'requested changes on'} ${result.title}`,
        response.clientNote || undefined,
        { actionId: result.id, sourceType: result.sourceType },
        actor,
      );
    },
    onBroadcast: ({ workspaceId: currentWorkspaceId, result }) => {
      broadcastActionUpdate(currentWorkspaceId, result.id, 'responded');
    },
    mapError: error => {
      if (error instanceof InvalidTransitionError) {
        return { status: 409, error: error.message };
      }
      return null;
    },
  });

  if (response.status === 'approved') {
    const ws = getWorkspace(workspaceId);
    notifyTeamActionApproved({
      workspaceId,
      workspaceName: ws?.name || workspaceId,
      actionTitle: updated.title,
      sourceType: updated.sourceType,
      actionSummary: updated.summary,
      clientNote: response.clientNote,
      dashboardUrl: ws ? getClientPortalUrl(ws) : undefined,
    });
    enqueuePlaybook(workspaceId, updated);
  }

  return updated;
}
