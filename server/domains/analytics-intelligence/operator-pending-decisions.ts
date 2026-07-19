import { Buffer } from 'node:buffer';

import type { OperationalSlice } from '../../../shared/types/intelligence.js';
import { listBatches } from '../../approvals.js';
import { listClientActions } from '../../client-actions.js';
import { listRequests } from '../../requests.js';

const PENDING_DECISION_LIMIT = 25;
const MAX_LABEL_BYTES = 160;

type PendingDecision = NonNullable<
  OperationalSlice['pendingDecisions']
>['items'][number];

const PRIORITY_RANK: Record<PendingDecision['priority'], number> = {
  urgent: 0,
  high: 1,
  medium: 2,
  low: 3,
};

function boundedLabel(value: string, fallback: string): string {
  const normalized = value.replace(/\s+/g, ' ').trim() || fallback;
  if (Buffer.byteLength(normalized, 'utf8') <= MAX_LABEL_BYTES) {
    return normalized;
  }

  let bounded = '';
  let byteLength = 0;
  for (const character of normalized) {
    const characterBytes = Buffer.byteLength(character, 'utf8');
    if (byteLength + characterBytes > MAX_LABEL_BYTES) break;
    bounded += character;
    byteLength += characterBytes;
  }
  return bounded.trimEnd();
}

function comparePendingDecisions(
  left: PendingDecision,
  right: PendingDecision,
): number {
  const priorityDifference =
    PRIORITY_RANK[left.priority] - PRIORITY_RANK[right.priority];
  if (priorityDifference !== 0) return priorityDifference;

  const createdAtDifference = left.createdAt.localeCompare(right.createdAt);
  if (createdAtDifference !== 0) return createdAtDifference;

  const sourceTypeDifference = left.sourceType.localeCompare(right.sourceType);
  if (sourceTypeDifference !== 0) return sourceTypeDifference;

  return left.sourceId.localeCompare(right.sourceId);
}

/**
 * Builds the payload-free operational queue consumed by compact MCP read models.
 * The result contains only durable references and bounded display metadata.
 */
export function buildOperatorPendingDecisions(
  workspaceId: string,
): NonNullable<OperationalSlice['pendingDecisions']> {
  const approvalItems: PendingDecision[] = listBatches(workspaceId).flatMap(
    (batch) =>
      batch.items
        .filter((item) => item.status === 'pending')
        .map((item) => ({
          sourceType: 'approval_item' as const,
          sourceId: item.id,
          parentId: batch.id,
          label: boundedLabel(
            `${batch.name}: ${item.pageTitle} — ${item.field}`,
            'Pending approval',
          ),
          priority: 'medium' as const,
          createdAt: item.createdAt,
        })),
  );

  const clientRequests: PendingDecision[] = listRequests(workspaceId)
    .filter((request) => request.status === 'new')
    .map((request) => ({
      sourceType: 'client_request' as const,
      sourceId: request.id,
      parentId: null,
      label: boundedLabel(request.title, 'New client request'),
      priority: request.priority,
      createdAt: request.createdAt,
    }));

  const clientActions: PendingDecision[] = listClientActions(workspaceId)
    .filter((action) => action.status === 'pending')
    .map((action) => ({
      sourceType: 'client_action' as const,
      sourceId: action.id,
      parentId: null,
      label: boundedLabel(action.title, 'Pending client action'),
      priority: action.priority,
      createdAt: action.createdAt,
    }));

  const pending = [...approvalItems, ...clientRequests, ...clientActions].sort(
    comparePendingDecisions,
  );

  return {
    total: pending.length,
    counts: {
      approvals: approvalItems.length,
      requests: clientRequests.length,
      clientActions: clientActions.length,
    },
    items: pending.slice(0, PENDING_DECISION_LIMIT),
  };
}
