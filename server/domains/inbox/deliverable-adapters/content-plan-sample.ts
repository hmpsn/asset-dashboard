/**
 * content_plan_sample deliverable adapter (PR-1a, DARK).
 *
 * Claims the content-plan "Sample Review" approval batches
 * (`server/routes/content-plan-review.ts:267`, per-item `field:'content_plan_sample'`,
 * name `Content Plan: <matrix> — Sample Review (N pages)`). Each item is a planned page
 * (keyword + planned URL summary). These are review artifacts, not page-field writes —
 * `applyable=false` (the matrix-cell write is the operator-side apply, deferred to the
 * content_plan read/apply cutover, NOT this PR).
 */
import { registerAdapter, type DeliverableAdapter } from './types.js';
import {
  type ApprovalBatchInput,
  applyDisabledStub,
  approvalBatchSourceRef,
  buildApprovalBatchPayload,
  validateApprovalBatchSendable,
} from './approval-batch-shared.js';

export const contentPlanSampleAdapter: DeliverableAdapter<ApprovalBatchInput> = {
  type: 'content_plan_sample',
  validateSendable: (batch) => validateApprovalBatchSendable(batch),
  buildPayload: (batch) =>
    buildApprovalBatchPayload('content_plan_sample', batch, (item) => ({
      field: item.field ?? null,
      applyable: false,
    })),
  sourceRef: (batch) => approvalBatchSourceRef('content_plan_sample', batch),
  applyDeliverable: applyDisabledStub,
};

registerAdapter(contentPlanSampleAdapter as DeliverableAdapter);
