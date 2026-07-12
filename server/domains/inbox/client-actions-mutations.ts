import { addActivity } from '../../activity-log.js';
import { createClientAction, getActiveClientActionBySource, getClientAction, updateClientAction } from '../../client-actions.js';
import { notifyApprovalReady, notifyTeamActionApproved } from '../../email.js';
import { enqueuePlaybook } from '../../playbooks.js';
import { mutationError, runWorkspaceMutation } from '../../workspace-mutation-helper.js';
import { getClientPortalUrl, getWorkspace } from '../../workspaces.js';
import { broadcastToWorkspace } from '../../broadcast.js';
import { clearIntelligenceCache } from '../../intelligence/cache-clear.js';
import { WS_EVENTS } from '../../ws-events.js';
import { InvalidTransitionError } from '../../state-machines.js';
import type { ClientAction, ClientActionPayload, ClientActionSourceType } from '../../../shared/types/client-actions.js';
import { applyClientActionFeedbackLoop } from './client-action-feedback-loop.js';
import { mirrorClientActionToDeliverable } from './client-action-dual-write.js';
import { createLogger } from '../../logger.js';

const log = createLogger('client-actions-mutations');

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
  clearIntelligenceCache(workspaceId);
  broadcastToWorkspace(workspaceId, WS_EVENTS.CLIENT_ACTION_UPDATE, { actionId, action });
}

export function createAdminClientAction(workspaceId: string, input: CreateClientActionRequest): ClientAction {
  const { action, isDuplicate } = runWorkspaceMutation({
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
  // Dual-write mirror: mirror the freshly-created action into the unified
  // client_deliverable model. Runs UNCONDITIONALLY (no feature flag) and broadcasts
  // DELIVERABLE_SENT for the live unified Inbox. This single seam covers all four producer
  // routes (redirect / internal_link / aeo_change / content_decay). Skipped for duplicates
  // (the legacy create itself returned the existing row). Best-effort — it can NEVER break the
  // legacy create, but the failure is NO LONGER swallowed: R4-PR1 makes the outcome observable.
  if (!isDuplicate) {
    const mirror = mirrorClientActionToDeliverable(workspaceId, action);
    if (!mirror.ok) {
      // Durable, observable failure record (R4-PR1) — the legacy action reached the client but its
      // unified-deliverable mirror did not, so admin + client views can DIVERGE. Admin-only audit
      // (rec_status_updated is deliberately NOT in CLIENT_VISIBLE_TYPES). The read-only divergence
      // sweep will also surface it for repair. Guarded so a logging failure can't break the create.
      try {
        addActivity(
          workspaceId,
          'rec_status_updated',
          `Client-deliverable mirror failed for "${action.title}"`,
          `The action reached the client but its unified deliverable mirror did not write (${mirror.error}). Admin/client views may diverge until reconciled.`,
          { actionId: action.id, sourceType: action.sourceType, mirrorError: mirror.error },
        );
      } catch (activityErr) {
        log.error({ err: activityErr, workspaceId, actionId: action.id }, 'failed to record client-action mirror-failure activity');
      }
      log.error({ workspaceId, actionId: action.id, error: mirror.error }, 'client-action dual-write mirror failed (observed by caller)');
    }
  }
  return action;
}

export function updateAdminClientAction(
  workspaceId: string,
  actionId: string,
  updates: UpdateClientActionRequest,
): ClientAction {
  const updated = runWorkspaceMutation({
    workspaceId,
    defaultErrorMessage: 'Failed to update client action',
    readBeforeWrite: ({ workspaceId: currentWorkspaceId }) => getClientAction(currentWorkspaceId, actionId),
    mutate: ({ workspaceId: currentWorkspaceId, existing }) => {
      if (!existing) throw mutationError(404, 'Client action not found');
      const next = updateClientAction(currentWorkspaceId, actionId, updates);
      if (!next) throw mutationError(404, 'Client action not found');
      const feedbackStatus =
        updates.status === 'completed' && existing.status !== 'completed'
          ? 'completed'
          : updates.status === 'approved' && existing.status !== 'approved'
            ? 'approved'
            : null;
      if (feedbackStatus) {
        applyClientActionFeedbackLoop(currentWorkspaceId, next, feedbackStatus);
      }
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
  return updated;
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
      if (response.status === 'approved') {
        applyClientActionFeedbackLoop(currentWorkspaceId, next, 'approved');
      }
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
