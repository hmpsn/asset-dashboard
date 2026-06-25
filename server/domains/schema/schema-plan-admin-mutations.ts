import { deleteBatch } from '../../approvals.js';
import { addActivity } from '../../activity-log.js';
import { broadcastToWorkspace } from '../../broadcast.js';
import {
  cancelSchemaPlanDeliverable,
  mirrorSchemaPlanToDeliverable,
  syncSchemaPlanDeliverable,
} from '../inbox/schema-plan-dual-write.js';
import { notifyApprovalReady } from '../../email.js';
import { createLogger } from '../../logger.js';
import {
  deleteSchemaPlan,
  deleteSchemaSnapshot,
  getSchemaPlan,
  updateSchemaPlanRoles,
  updateSchemaPlanStatus,
} from '../../schema-store.js';
import { broadcastSchemaPlanUpdated, getActiveSchemaPlanGenerationJobId } from '../../schema-plan-generation-job.js';
import { invalidateIntelligenceCache } from '../../intelligence/cache-invalidation.js';
import {
  getClientPortalUrl,
  getWorkspace,
} from '../../workspaces.js';
import { WS_EVENTS } from '../../ws-events.js';
import type { CanonicalEntity, PageRoleAssignment, SchemaSitePlan } from '../../../shared/types/schema-plan.js';

const log = createLogger('schema-plan-admin-mutations');

type SchemaPlanMutationError =
  | { ok: false; status: 404; error: string }
  | { ok: false; status: 409; error: string; jobId: string }
  | { ok: false; status: 422; error: string };

type SchemaPlanMutationResult<T> = SchemaPlanMutationError | { ok: true; value: T };

function schemaPlanConflict(workspaceId: string): SchemaPlanMutationError | null {
  const jobId = getActiveSchemaPlanGenerationJobId(workspaceId);
  if (!jobId) return null;
  return {
    ok: false,
    status: 409,
    error: 'Schema plan generation is in progress. Wait for it to finish before editing this plan.',
    jobId,
  };
}

function broadcastSchemaPlanEvent(
  siteId: string,
  workspaceId: string,
  action: Parameters<typeof broadcastSchemaPlanUpdated>[1]['action'],
  status?: Parameters<typeof broadcastSchemaPlanUpdated>[1]['status'],
): void {
  broadcastSchemaPlanUpdated(workspaceId, { siteId, action, status });
}

function broadcastSchemaSnapshotDeleted(siteId: string, workspaceId: string): void {
  broadcastToWorkspace(workspaceId, WS_EVENTS.SCHEMA_SNAPSHOT_UPDATED, {
    siteId,
    action: 'deleted',
  });
}

export function updateSchemaPlanForAdmin(
  siteId: string,
  pageRoles: PageRoleAssignment[],
  canonicalEntities?: CanonicalEntity[],
): SchemaPlanMutationResult<SchemaSitePlan> {
  const existing = getSchemaPlan(siteId);
  if (!existing) return { ok: false, status: 404, error: 'No plan found for this site' };

  const conflict = schemaPlanConflict(existing.workspaceId);
  if (conflict) return conflict;

  const plan = updateSchemaPlanRoles(siteId, pageRoles, canonicalEntities);
  if (!plan) return { ok: false, status: 404, error: 'No plan found for this site' };

  invalidateIntelligenceCache(plan.workspaceId);
  syncSchemaPlanDeliverable(plan);
  broadcastSchemaPlanEvent(siteId, plan.workspaceId, 'updated', plan.status);
  return { ok: true, value: plan };
}

export function sendSchemaPlanToClientForReview(
  siteId: string,
): SchemaPlanMutationResult<{ plan: SchemaSitePlan }> {
  const plan = getSchemaPlan(siteId);
  if (!plan) return { ok: false, status: 404, error: 'No plan found. Generate one first.' };

  const conflict = schemaPlanConflict(plan.workspaceId);
  if (conflict) return conflict;

  // State-machine precondition: only draft plans may be sent to the client.
  // (client_changes_requested → sent_to_client is also legal but the UI re-routes
  // to draft first; this guard matches the state-machine map exactly.)
  if (plan.status !== 'draft' && plan.status !== 'client_changes_requested') {
    return {
      ok: false,
      status: 422,
      error: `Cannot send a plan with status '${plan.status}' to the client. Revise the plan first.`,
    };
  }

  const ws = getWorkspace(plan.workspaceId);
  if (!ws) return { ok: false, status: 404, error: 'Workspace not found' };

  const updated = updateSchemaPlanStatus(siteId, 'sent_to_client');
  const effectivePlan = updated || plan;

  const mirrored = mirrorSchemaPlanToDeliverable(ws.id, effectivePlan);
  if (mirrored) {
    broadcastToWorkspace(ws.id, WS_EVENTS.DELIVERABLE_SENT, {
      deliverableId: mirrored.id,
      type: mirrored.type,
    });
  }

  if (ws.clientEmail) {
    notifyApprovalReady({
      clientEmail: ws.clientEmail,
      workspaceName: ws.name,
      workspaceId: ws.id,
      batchName: 'Schema Strategy Review',
      itemCount: plan.pageRoles.length,
      dashboardUrl: getClientPortalUrl(ws),
    });
  }

  broadcastSchemaPlanEvent(siteId, ws.id, 'sent_to_client', effectivePlan.status);
  broadcastToWorkspace(ws.id, WS_EVENTS.SCHEMA_PLAN_SENT, { siteId });
  addActivity(ws.id, 'schema_plan_sent', 'Schema strategy sent to client for review', `${plan.pageRoles.length} pages`);
  invalidateIntelligenceCache(ws.id);
  return { ok: true, value: { plan: effectivePlan } };
}

export function activateSchemaPlanForAdmin(
  siteId: string,
): SchemaPlanMutationResult<SchemaSitePlan> {
  const existing = getSchemaPlan(siteId);
  if (!existing) return { ok: false, status: 404, error: 'No plan found' };

  const conflict = schemaPlanConflict(existing.workspaceId);
  if (conflict) return conflict;

  const plan = updateSchemaPlanStatus(siteId, 'active');
  if (!plan) return { ok: false, status: 404, error: 'No plan found' };

  invalidateIntelligenceCache(plan.workspaceId);
  syncSchemaPlanDeliverable(plan);
  broadcastSchemaPlanEvent(siteId, plan.workspaceId, 'activated', plan.status);
  return { ok: true, value: plan };
}

export function deleteSchemaPlanForAdmin(
  siteId: string,
): SchemaPlanMutationResult<{ success: true }> {
  const plan = getSchemaPlan(siteId);
  if (!plan) return { ok: false, status: 404, error: 'No plan found for this site' };

  const conflict = schemaPlanConflict(plan.workspaceId);
  if (conflict) return conflict;

  deleteSchemaPlan(siteId);

  const snapshotDeleted = deleteSchemaSnapshot(siteId);
  if (snapshotDeleted) broadcastSchemaSnapshotDeleted(siteId, plan.workspaceId);

  let cacheInvalidated = false;
  if (plan.clientPreviewBatchId) {
    if (deleteBatch(plan.workspaceId, plan.clientPreviewBatchId)) cacheInvalidated = true;
  }

  const ws = getWorkspace(plan.workspaceId);
  if (ws) {
    addActivity(ws.id, 'schema_plan_deleted', 'Schema site plan retracted', 'Plan deleted by admin');
    if (!cacheInvalidated) invalidateIntelligenceCache(ws.id);
    cancelSchemaPlanDeliverable(ws.id, siteId);
    broadcastSchemaPlanEvent(siteId, ws.id, 'deleted');
  } else {
    log.warn({ siteId, workspaceId: plan.workspaceId }, 'deleteSchemaPlanForAdmin: workspace missing after plan delete');
  }

  return { ok: true, value: { success: true } };
}
