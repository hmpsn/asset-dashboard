/**
 * seo_edit deliverable adapter (PR-1a, DARK).
 *
 * Claims the SEO Editor / CMS Editor approval batches (the default approval_batch
 * sub-type — "SEO Changes", "SEO Editor — N pages", "CMS Editor — collection"). The
 * per-item `field` passes through verbatim (it is already the SPECIFIC writable field:
 * `seoTitle` / `seoDescription` for static pages, a CMS field slug for collection items).
 *
 * Apply stays DISABLED this PR (D-apply): `appliesOnApprove` is omitted (default false),
 * so `respondToDeliverable` never calls `applyDeliverable`.
 */
import { registerAdapter, type DeliverableAdapter } from './types.js';
import {
  type ApprovalBatchInput,
  applyDisabledStub,
  approvalBatchSourceRef,
  buildApprovalBatchPayload,
  respondToApprovalBatchSource,
  validateApprovalBatchSendable,
} from './approval-batch-shared.js';

export const seoEditAdapter: DeliverableAdapter<ApprovalBatchInput> = {
  type: 'seo_edit',
  validateSendable: (batch) => validateApprovalBatchSendable(batch),
  buildPayload: (batch) =>
    buildApprovalBatchPayload('seo_edit', batch, (item) => ({
      // SEO/CMS editor items already carry the SPECIFIC writable field.
      field: item.field ?? null,
      // Apply disabled this PR (D-apply); the field is correct so this flips to true at cutover.
      applyable: false,
    })),
  sourceRef: (batch) => approvalBatchSourceRef('seo_edit', batch),
  // R2: propagate the client decision to the legacy approval batch (the source the apply
  // logic reads). approve → items approved; changes_requested/declined → items rejected.
  respondToSource: respondToApprovalBatchSource,
  // apply opt-out — D-apply. Stub throws if ever reached.
  applyDeliverable: applyDisabledStub,
};

registerAdapter(seoEditAdapter as DeliverableAdapter);
