import { addActivity } from '../../activity-log.js';
import {
  createBatch,
  deleteBatch,
  getBatch,
} from '../../approvals.js';
import { broadcastToWorkspace } from '../../broadcast.js';
import { mirrorApprovalBatchToDeliverable } from './approval-batch-dual-write.js';
import { notifyApprovalReady } from '../../email.js';
import { getPageState } from '../../page-edit-states.js';
import {
  clearPageState,
  getClientPortalUrl,
  getWorkspace,
  updatePageState,
} from '../../workspaces.js';
import { WS_EVENTS } from '../../ws-events.js';
import type { ApprovalBatch, ApprovalItem } from '../../../shared/types/approvals.js';

type CreateApprovalBatchItemInput = Omit<ApprovalItem, 'id' | 'status' | 'createdAt' | 'updatedAt'>;

export interface CreateApprovalBatchForClientInput {
  workspaceId: string;
  siteId: string;
  name: string;
  note?: string;
  items: CreateApprovalBatchItemInput[];
}

export function createApprovalBatchForClient(
  input: CreateApprovalBatchForClientInput,
): ApprovalBatch {
  const { workspaceId, siteId, name, note, items } = input;
  const batch = createBatch(workspaceId, siteId, name, items, note);

  mirrorApprovalBatchToDeliverable(workspaceId, batch, { note, source: 'approvals-send' });

  for (const item of items) {
    if (item.pageId) {
      updatePageState(workspaceId, item.pageId, {
        status: 'in-review',
        fields: [item.field],
        approvalBatchId: batch.id,
        updatedBy: 'admin',
      });
    }
  }

  const ws = getWorkspace(workspaceId);
  if (ws?.clientEmail) {
    const dashUrl = getClientPortalUrl(ws);
    notifyApprovalReady({
      clientEmail: ws.clientEmail,
      workspaceName: ws.name,
      workspaceId,
      batchName: batch.name,
      itemCount: items.length,
      dashboardUrl: dashUrl,
    });
  }

  addActivity(
    workspaceId,
    'approval_sent',
    `Sent "${batch.name}" to client for review`,
    `${items.length} item${items.length !== 1 ? 's' : ''} awaiting client review`,
    {
      batchId: batch.id,
      itemCount: items.length,
      pageIds: items.map(item => item.pageId).filter(Boolean),
    },
  );

  broadcastToWorkspace(workspaceId, WS_EVENTS.APPROVAL_UPDATE, {
    batchId: batch.id,
    action: 'created',
  });

  return batch;
}

export function deleteApprovalBatchForClient(
  workspaceId: string,
  batchId: string,
): ApprovalBatch | null {
  const batch = getBatch(workspaceId, batchId);
  if (!batch) return null;

  const pageIdsToClear: string[] = [];
  for (const item of batch.items) {
    if (!item.pageId) continue;
    const state = getPageState(workspaceId, item.pageId);
    if (
      (state?.status === 'in-review' || state?.status === 'approved' || state?.status === 'rejected')
      && state.approvalBatchId === batchId
    ) {
      pageIdsToClear.push(item.pageId);
    }
  }

  if (!deleteBatch(workspaceId, batchId)) return null;

  for (const pageId of pageIdsToClear) {
    clearPageState(workspaceId, pageId);
  }

  addActivity(
    workspaceId,
    'approval_deleted',
    `Deleted approval batch "${batch.name}"`,
    `${batch.items.length} item${batch.items.length !== 1 ? 's' : ''} removed from client review`,
    {
      batchId,
      itemCount: batch.items.length,
      pageIds: batch.items.map(item => item.pageId).filter(Boolean),
    },
  );

  broadcastToWorkspace(workspaceId, WS_EVENTS.APPROVAL_UPDATE, {
    batchId,
    action: 'deleted',
  });

  return batch;
}
