/**
 * content_plan_template deliverable adapter (PR-1a, DARK).
 *
 * Claims the content-plan "Template Review" approval batches
 * (`server/routes/content-plan-review.ts:199`, per-item `field:'content_plan_template'`,
 * name `Content Plan: <matrix> — Template Review`). The single item summarizes the page
 * template (page type, URL/keyword pattern, sections). A review artifact, not a page-field
 * write — `applyable=false`.
 */
import { registerAdapter, type DeliverableAdapter } from './types.js';
import {
  type ApprovalBatchInput,
  applyDisabledStub,
  approvalBatchSourceRef,
  buildApprovalBatchPayload,
  validateApprovalBatchSendable,
} from './approval-batch-shared.js';

export const contentPlanTemplateAdapter: DeliverableAdapter<ApprovalBatchInput> = {
  type: 'content_plan_template',
  validateSendable: (batch) => validateApprovalBatchSendable(batch),
  buildPayload: (batch) =>
    buildApprovalBatchPayload('content_plan_template', batch, (item) => ({
      field: item.field ?? null,
      applyable: false,
    })),
  sourceRef: (batch) => approvalBatchSourceRef('content_plan_template', batch),
  applyDeliverable: applyDisabledStub,
};

registerAdapter(contentPlanTemplateAdapter as DeliverableAdapter);
