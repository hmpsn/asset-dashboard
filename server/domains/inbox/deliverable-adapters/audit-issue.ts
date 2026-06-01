/**
 * audit_issue deliverable adapter (PR-1a, DARK) — THE B1 FIX.
 *
 * Claims the SEO Audit "Flag for Client" batches (`src/components/SeoAudit.tsx:175`,
 * name prefix `[Review]`). The live B1 bug: `SeoAudit.tsx:172` collapses EVERY non-title
 * audit check to `field:'seoDescription'`, so an approved H1 / broken-links / schema /
 * alt-text / og-tags item would (once apply is wired) overwrite the page's meta
 * description with recommendation prose.
 *
 * This adapter resolves a REAL per-check `field` and sets `applyable=false` for every
 * non-meta check, so an approved non-meta audit item can NEVER write the page's meta
 * description. The per-check map + non-meta default lives in `approval-batch-shared.ts`
 * (`auditCheckField` / `isAuditCheckApplyable`); unknown checks default to NON-applyable.
 *
 * Authority for the check: the post-cutover producer carries an explicit `check` on each
 * item (so the real field is recoverable). When `check` is absent (the legacy B1 shape,
 * where only the collapsed `field` survives), we DO NOT trust the collapsed field — we
 * fall back to NON-applyable + a null field, because a `seoDescription` we cannot prove
 * came from a meta-description check is exactly the B1 hazard. Apply stays disabled this
 * PR regardless (D-apply).
 */
import type { ApprovalItem } from '../../../../shared/types/approvals.js';
import { registerAdapter, type DeliverableAdapter } from './types.js';
import {
  type ApprovalBatchInput,
  applyDisabledStub,
  approvalBatchSourceRef,
  auditCheckField,
  buildApprovalBatchPayload,
  validateApprovalBatchSendable,
} from './approval-batch-shared.js';

/**
 * Resolve the writable field + applyability for an audit item. Keys on the explicit
 * `check` (post-cutover producers carry it). When `check` is present, the per-check map
 * is authoritative: title/meta-description → applyable with their real field; everything
 * else → non-applyable with field=null (B1 kill). When `check` is absent, fall back to
 * the literal meta fields ONLY (never a collapsed seoDescription we cannot verify).
 */
export function resolveAuditItemField(item: ApprovalItem): { field: string | null; applyable: boolean } {
  const raw = item as ApprovalItem & { check?: unknown };
  const check = typeof raw.check === 'string' ? raw.check : null;

  if (check) {
    const field = auditCheckField(check);
    // applyable is gated on BOTH a meta field AND the post-cutover apply flip (D-apply
    // keeps it false this PR). The field carries the real target either way.
    return { field, applyable: false };
  }

  // Legacy B1 shape: no `check` survived. The collapsed `field` is untrustworthy for any
  // value other than the two literal meta fields, and even those are non-applyable while
  // apply is disabled. A non-meta-looking field is recorded as non-applyable with null.
  const legacyField = (item.field ?? '').trim();
  if (legacyField === 'seoTitle' || legacyField === 'seoDescription') {
    return { field: legacyField, applyable: false };
  }
  return { field: null, applyable: false };
}

export const auditIssueAdapter: DeliverableAdapter<ApprovalBatchInput> = {
  type: 'audit_issue',
  validateSendable: (batch) => validateApprovalBatchSendable(batch),
  buildPayload: (batch) =>
    buildApprovalBatchPayload('audit_issue', batch, (item) => resolveAuditItemField(item)),
  sourceRef: (batch) => approvalBatchSourceRef('audit_issue', batch),
  // apply opt-out — D-apply. Stub throws if ever reached. Even after the field map soaks,
  // only meta checks become applyable; non-meta checks stay applyable=false forever.
  applyDeliverable: applyDisabledStub,
};

registerAdapter(auditIssueAdapter as DeliverableAdapter);
