import { addActivity } from '../../activity-log.js';
import { getBatch, updateItem } from '../../approvals.js';
import { broadcastToWorkspace } from '../../broadcast.js';
import { notifyTeamActionApproved, notifyTeamChangesRequested } from '../../email.js';
import { createLogger } from '../../logger.js';
import { getPageState } from '../../page-edit-states.js';
import { getWorkspace, updatePageState } from '../../workspaces.js';
import { WS_EVENTS } from '../../ws-events.js';
import type { ApprovalBatch, ApprovalItem } from '../../../shared/types/approvals.js';

const log = createLogger('approval-batch-item-respond');

const APPROVAL_FIELD_LABELS: Record<string, string> = {
  seoTitle: 'SEO title',
  seo_title: 'SEO title',
  seoDescription: 'meta description',
  seo_description: 'meta description',
  schema: 'schema markup',
};

function approvalActivityLabel(field: string): string {
  return APPROVAL_FIELD_LABELS[field] ?? field.replace(/[_-]+/g, ' ');
}

function derivePageStatus(batch: ApprovalBatch, pageId: string): 'in-review' | 'approved' | 'rejected' {
  const pageItems = batch.items.filter(item => item.pageId === pageId);
  const statuses = pageItems.map(item => item.status);
  if (statuses.length === 0) return 'in-review';
  if (statuses.every(status => status === 'approved' || status === 'applied')) return 'approved';
  if (statuses.every(status => status === 'rejected')) return 'rejected';
  return 'in-review';
}

export interface RespondToApprovalBatchItemInput {
  workspaceId: string;
  batchId: string;
  itemId: string;
  update: Partial<Pick<ApprovalItem, 'status' | 'clientValue' | 'clientNote'>>;
  actor?: { id?: string; name?: string };
}

export interface RespondToApprovalBatchItemResult {
  batch: ApprovalBatch;
}

export function respondToApprovalBatchItem(
  input: RespondToApprovalBatchItemInput,
): RespondToApprovalBatchItemResult | null {
  const { workspaceId, batchId, itemId, update, actor } = input;
  const requestedStatus = update.status;
  const requestedNote = update.clientNote;
  const beforeBatch = getBatch(workspaceId, batchId);
  const beforeItem = beforeBatch?.items.find(item => item.id === itemId);

  const batch = updateItem(workspaceId, batchId, itemId, update);
  if (!batch) return null;

  const statusChanged = requestedStatus !== undefined && beforeItem?.status !== requestedStatus;

  if (requestedStatus === 'approved' || requestedStatus === 'rejected') {
    const item = batch.items.find(candidate => candidate.id === itemId);
    if (item) {
      const pageStatus = derivePageStatus(batch, item.pageId);
      const pageStateResult = updatePageState(workspaceId, item.pageId, {
        status: pageStatus,
        updatedBy: 'client',
        ...(requestedStatus === 'rejected' && requestedNote ? { rejectionNote: requestedNote } : {}),
      });
      if (!pageStateResult) {
        log.warn({ workspaceId, pageId: item.pageId, status: requestedStatus }, 'updatePageState returned null — workspace may not exist in DB');
      } else {
        log.info({ workspaceId, pageId: item.pageId, status: pageStateResult.status }, 'synced page edit state from approval');
      }

      const actorName = actor?.name || 'Client';
      const fieldLabel = approvalActivityLabel(item.field);
      const pageLabel = item.pageTitle || item.pageSlug || item.pageId;
      if (requestedStatus === 'approved' && statusChanged) {
        addActivity(
          workspaceId,
          'approval_applied',
          `${actorName} approved ${fieldLabel} changes for ${pageLabel}`,
          item.proposedValue ? `New value: ${item.proposedValue.slice(0, 80)}` : undefined,
          { batchId, itemId: item.id, pageId: item.pageId },
          actor,
        );
        const workspace = getWorkspace(workspaceId);
        notifyTeamActionApproved({
          workspaceId,
          workspaceName: workspace?.name || workspaceId,
          actionTitle: `SEO change approved: ${fieldLabel}`,
          sourceType: 'seo_approval',
          actionSummary: pageLabel,
          clientNote: requestedNote,
        });
      } else if (requestedStatus === 'rejected' && statusChanged) {
        addActivity(
          workspaceId,
          'changes_requested',
          `${actorName} requested changes to ${fieldLabel} for ${pageLabel}`,
          requestedNote || undefined,
          { batchId, itemId: item.id, pageId: item.pageId },
          actor,
        );
        const workspace = getWorkspace(workspaceId);
        notifyTeamChangesRequested({
          workspaceName: workspace?.name || workspaceId,
          workspaceId,
          topic: `SEO revision requested: ${fieldLabel}`,
          targetKeyword: pageLabel,
          feedback: requestedNote || '',
        });
      }
    }
  }

  if (requestedStatus === 'pending' && statusChanged) {
    const item = batch.items.find(candidate => candidate.id === itemId);
    if (item?.pageId) {
      const pageStatus = derivePageStatus(batch, item.pageId);
      if (pageStatus === 'in-review') {
        const currentState = getPageState(workspaceId, item.pageId);
        if (currentState?.status === 'approved' || currentState?.status === 'rejected') {
          updatePageState(workspaceId, item.pageId, {
            status: 'clean',
            updatedBy: 'client',
            rejectionNote: '',
          });
        }
      }

      updatePageState(workspaceId, item.pageId, {
        status: pageStatus,
        updatedBy: 'client',
        ...(pageStatus === 'in-review' ? { rejectionNote: '' } : {}),
      });

      addActivity(
        workspaceId,
        'approval_reverted',
        `${actor?.name || 'Client'} reverted ${approvalActivityLabel(item.field)} decision for ${item.pageTitle || item.pageSlug || item.pageId}`,
        undefined,
        { batchId, itemId: item.id, pageId: item.pageId },
        actor,
      );
    }
  }

  broadcastToWorkspace(workspaceId, WS_EVENTS.APPROVAL_UPDATE, {
    batchId,
    itemId,
    status: requestedStatus,
  });

  return { batch };
}
