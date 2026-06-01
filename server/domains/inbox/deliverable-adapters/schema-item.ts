/**
 * schema_item deliverable adapter (PR-1a, DARK).
 *
 * Claims the Schema Suggester "Schema Review" approval batches
 * (`src/components/schema/useSchemaSuggesterPublishingWorkflow.ts:68`, name prefix
 * `Schema`). Schema-item batches carry per-page schema-markup proposals; the item field
 * is the schema target. Apply stays DISABLED this PR (D-apply); schema apply is an
 * operator-published transition (per design §4.2, schema does not auto-apply on approve).
 *
 * NOTE: this is the approval_batch `schema_item` sub-type, NOT the projected `schema_plan`
 * type (that is PR-1c, a different store + `external_ref`=siteId + `parent_deliverable_id`).
 */
import { registerAdapter, type DeliverableAdapter } from './types.js';
import {
  type ApprovalBatchInput,
  applyDisabledStub,
  approvalBatchSourceRef,
  buildApprovalBatchPayload,
  validateApprovalBatchSendable,
} from './approval-batch-shared.js';

export const schemaItemAdapter: DeliverableAdapter<ApprovalBatchInput> = {
  type: 'schema_item',
  validateSendable: (batch) => validateApprovalBatchSendable(batch),
  buildPayload: (batch) =>
    buildApprovalBatchPayload('schema_item', batch, (item) => ({
      // Schema items carry a 'schema' field; pass through. Non-applyable (operator publish).
      field: item.field ?? null,
      applyable: false,
    })),
  sourceRef: (batch) => approvalBatchSourceRef('schema_item', batch),
  applyDeliverable: applyDisabledStub,
};

registerAdapter(schemaItemAdapter as DeliverableAdapter);
