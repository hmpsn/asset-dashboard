/**
 * Deterministic sub-type classifier for the approval_batch family (PR-1a, DARK).
 *
 * `approval_batches` physically stores five deliverable types in one table (design §7).
 * Both the dual-write seam (which adapter to mirror through) and the backfill (which type
 * each legacy row resolves to) need ONE deterministic rule that maps a legacy batch to
 * exactly one of the five sub-types. Discriminators, in priority order:
 *
 *   1. per-item `field === 'content_plan_sample'`   → content_plan_sample
 *   2. per-item `field === 'content_plan_template'` → content_plan_template
 *      (the content-plan routes set these synthetic fields explicitly —
 *       server/routes/content-plan-review.ts:207,257)
 *   3. batch name starts with `[Review]`            → audit_issue
 *      (the SEO Audit "Flag for Client" name — src/components/SeoAudit.tsx:177)
 *   4. batch name starts with `Schema`              → schema_item
 *      (Schema Suggester "Schema Review" — useSchemaSuggesterPublishingWorkflow.ts:68)
 *   5. otherwise                                     → seo_edit
 *      (SEO Editor / CMS Editor: "SEO Changes", "SEO Editor — N", "CMS Editor — …")
 *
 * The classifier is TOTAL: every batch resolves to exactly one type (seo_edit is the
 * exhaustive default), so the backfill's parity assertion (every legacy row → exactly one
 * type) holds by construction.
 */
import type { ApprovalBatch } from '../../../../shared/types/approvals.js';
import type { DeliverableType } from '../../../../shared/types/client-deliverable.js';

/** The five approval_batch-family deliverable types this PR owns. */
export const APPROVAL_BATCH_FAMILY_TYPES = [
  'seo_edit',
  'audit_issue',
  'schema_item',
  'content_plan_sample',
  'content_plan_template',
] as const;

export type ApprovalBatchFamilyType = (typeof APPROVAL_BATCH_FAMILY_TYPES)[number];

/**
 * Classify a legacy approval batch into exactly one of the five family sub-types.
 * Deterministic + total — see the module header for the discriminator priority.
 */
export function classifyApprovalBatch(batch: Pick<ApprovalBatch, 'name' | 'items'>): ApprovalBatchFamilyType {
  // 1/2: content-plan synthetic fields win (most specific discriminator).
  for (const item of batch.items) {
    if (item.field === 'content_plan_sample') return 'content_plan_sample';
    if (item.field === 'content_plan_template') return 'content_plan_template';
  }

  const name = (batch.name ?? '').trim();
  const lower = name.toLowerCase();

  // 3: SEO Audit "Flag for Client" — name prefix `[Review]`.
  if (lower.startsWith('[review]')) return 'audit_issue';

  // 4: Schema Suggester — name prefix `Schema`.
  if (lower.startsWith('schema')) return 'schema_item';

  // 5: exhaustive default — SEO/CMS editor.
  return 'seo_edit';
}

/** Narrowing helper for callers holding a `DeliverableType`. */
export function isApprovalBatchFamilyType(type: DeliverableType): type is ApprovalBatchFamilyType {
  return (APPROVAL_BATCH_FAMILY_TYPES as readonly string[]).includes(type);
}
