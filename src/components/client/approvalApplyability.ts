import type { ApprovalBatch, ApprovalItem } from './types';
import { isClientApplyableFields } from '../../../shared/applyability';

/**
 * Legacy approval-batch applyability predicate (live consumers: ApprovalBatchCard footer +
 * client-approval-applyability unit test). Behavior-preserving thin delegation to the SINGLE
 * source of truth in `shared/applyability.ts` — the legacy `pageId` maps onto the shared
 * `targetRef`. See that module's header for why this mirrors the legacy ROUTE GATE
 * (field/pageId/collectionId), not the per-item `applyable` column.
 */
export function isClientApplyableApprovalItem(item: ApprovalItem): boolean {
  return isClientApplyableFields({
    field: item.field,
    targetRef: item.pageId,
    collectionId: item.collectionId ?? null,
  });
}

export function isClientApplyableBatch(batch: ApprovalBatch): boolean {
  return batch.items.length > 0 && batch.items.every(isClientApplyableApprovalItem);
}
