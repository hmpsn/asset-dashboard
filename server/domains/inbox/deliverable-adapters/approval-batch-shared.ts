/**
 * Shared machinery for the approval_batch deliverable family (PR-1a, DARK).
 *
 * The legacy `approval_batches` table physically stores FIVE deliverable types in one
 * table (design §7 / audit §A): `seo_edit`, `audit_issue`, `schema_item`,
 * `content_plan_sample`, `content_plan_template`. Each Phase-1 adapter
 * (`seo-edit.ts`, `audit-issue.ts`, …) wraps the SAME `ApprovalBatch` input shape and
 * differs only in (a) which legacy batches it claims (the classifier) and (b) the
 * per-item `field` / `applyable` resolution.
 *
 * THE B1 FIX LIVES HERE. `src/components/SeoAudit.tsx:172` hardcodes every non-title
 * audit check to `field:'seoDescription'`, so an approved H1 / broken-links / schema /
 * alt-text audit item would (once apply is wired) overwrite the page's meta description
 * with the recommendation prose. The `audit_issue` adapter instead resolves a REAL
 * per-check `field` and sets `applyable=false` for every non-meta check, so an approved
 * non-meta audit item can NEVER write the page's meta description.
 *
 * Apply stays DISABLED in this PR (D-apply / risk §9): adapters opt OUT of
 * `appliesOnApprove`, so `respondToDeliverable` never calls `applyDeliverable`. The
 * adapters expose an `applyDeliverable` stub that throws "not wired until cutover" to
 * make the disabled-apply contract explicit (it is unreachable while `appliesOnApprove`
 * is false).
 *
 * Leaf rule: this module imports only shared types + the store input shape; it is NOT
 * imported back by the store/service (no circular value-import).
 */
import type { ApprovalBatch, ApprovalItem } from '../../../../shared/types/approvals.js';
import type {
  BuiltDeliverablePayload,
  SendableResult,
} from './types.js';
import type { UpsertDeliverableItemInput } from '../../../client-deliverables.js';
import type { ClientDeliverable, DeliverableType } from '../../../../shared/types/client-deliverable.js';

/**
 * The adapter input for every approval_batch-family type: the legacy ApprovalBatch as
 * built by `server/approvals.ts:createBatch`. Dual-write seams pass the freshly-created
 * batch straight through; the backfill passes a row read from `approval_batches`.
 */
export type ApprovalBatchInput = ApprovalBatch;

// ── B1: the real per-check field map ──────────────────────────────────────────
//
// Enumerated from the audit producers (server/audit-page.ts, server/sales-audit.ts,
// server/seo-audit*.ts) via `grep -hoE "check: '[a-z0-9-]+'"`. ONLY the meta checks map
// to a writable page field; every other check is structural/technical/social and its
// "proposed value" is recommendation prose, NOT a meta value — those are NON-applyable.

/** Audit checks whose proposed value is a real SEO title. */
const TITLE_CHECKS = new Set<string>(['title', 'duplicate-title']);
/** Audit checks whose proposed value is a real meta description. */
const META_DESCRIPTION_CHECKS = new Set<string>(['meta-description', 'duplicate-description']);

/**
 * Resolve the SPECIFIC writable page field for an audit check, or null when the check
 * does not target a writable meta field. A non-null result is a meta field the apply
 * path could (post-cutover) write; null means the item is informational/structural and
 * MUST be non-applyable.
 *
 * Default: UNKNOWN check → null (never applyable). This is the B1 safety default — a
 * future audit check we have not enumerated can never silently inherit `seoDescription`.
 */
export function auditCheckField(check: string): string | null {
  const normalized = (check || '').trim().toLowerCase();
  if (TITLE_CHECKS.has(normalized)) return 'seoTitle';
  if (META_DESCRIPTION_CHECKS.has(normalized)) return 'seoDescription';
  return null;
}

/**
 * Is this audit check applyable (i.e. the apply path may write the page's meta field)?
 * Only the title + meta-description checks are. H1, broken-links, schema, alt-text,
 * og-tags, canonical, viewport, … are all NON-applyable (B1).
 */
export function isAuditCheckApplyable(check: string): boolean {
  return auditCheckField(check) !== null;
}

// ── Item → client_deliverable_item mapping ─────────────────────────────────────

/** How a single ApprovalItem maps to a client_deliverable_item, per family type. */
interface ItemFieldResolution {
  /** The SPECIFIC target field (the B1 fix lives in audit_issue's resolver). */
  field: string | null;
  /** Whether the client may apply this item (false for non-meta audit checks). */
  applyable: boolean;
}

/**
 * Map an ApprovalBatch's items to `client_deliverable_item[]`. The per-item field +
 * applyable is computed by `resolve`, which differs per family type:
 *   - seo_edit / schema_item / content_plan_*: field passes through, applyable=false
 *     (apply stays disabled this PR — D-apply).
 *   - audit_issue: field is resolved from the per-check map (B1); applyable=false for
 *     every non-meta check.
 */
export function batchItemsToDeliverableItems(
  batch: ApprovalBatchInput,
  resolve: (item: ApprovalItem) => ItemFieldResolution,
): UpsertDeliverableItemInput[] {
  return batch.items.map((item, index): UpsertDeliverableItemInput => {
    const { field, applyable } = resolve(item);
    return {
      // Preserve the legacy item id so the round-trip + future backfill dedupe cleanly.
      id: undefined,
      status: mapItemStatus(item.status),
      targetRef: item.pageId ?? null,
      collectionId: item.collectionId ?? null,
      field,
      currentValue: item.currentValue ?? null,
      proposedValue: item.proposedValue ?? null,
      clientValue: item.clientValue ?? null,
      clientNote: item.clientNote ?? null,
      applyable,
      // Heterogeneous extras the typed columns do not carry (reason, slug, title) ride in
      // item_payload so the round-trip is lossless and the apply path can reconstruct context.
      itemPayload: {
        check: deriveCheck(item),
        reason: item.reason ?? null,
        pageSlug: item.pageSlug ?? null,
        pageTitle: item.pageTitle ?? null,
        publishedPath: item.publishedPath ?? null,
        legacyItemId: item.id,
      },
      sortOrder: index,
    };
  });
}

/**
 * The audit check key for an item. The B1 source builds items WITHOUT a `check` field
 * (it collapses to `field`), so for audit batches the check is not carried on the legacy
 * item. We stash whatever we can derive: an explicit `check` if a future producer adds
 * one, else null. The audit adapter's resolver keys on `item.field` directly (which the
 * B1 source sets to seoTitle/seoDescription) AND records the original field so the
 * non-meta-collapse is detectable in the round-trip test.
 */
function deriveCheck(item: ApprovalItem): string | null {
  const raw = item as ApprovalItem & { check?: unknown };
  return typeof raw.check === 'string' ? raw.check : null;
}

/** Map the legacy approval-item status onto the deliverable item status vocabulary. */
function mapItemStatus(status: ApprovalItem['status']): string {
  switch (status) {
    case 'approved':
      return 'approved';
    case 'rejected':
      return 'changes_requested';
    case 'applied':
      return 'applied';
    case 'pending':
    default:
      return 'awaiting_client';
  }
}

/**
 * The shared `buildPayload` body for the approval_batch family. Returns a `batch`-kind
 * deliverable carrying the per-item rows. `summary` echoes the item count; `payload`
 * keeps the legacy discriminators (siteId, original batch name) for traceability.
 */
export function buildApprovalBatchPayload(
  type: DeliverableType,
  batch: ApprovalBatchInput,
  resolve: (item: ApprovalItem) => ItemFieldResolution,
): BuiltDeliverablePayload {
  const items = batchItemsToDeliverableItems(batch, resolve);
  return {
    title: batch.name,
    summary: `${items.length} item${items.length !== 1 ? 's' : ''} for review`,
    kind: 'batch',
    payload: {
      family: 'approval_batch',
      subType: type,
      siteId: batch.siteId,
      legacyBatchId: batch.id,
      legacyName: batch.name,
    },
    items,
  };
}

/**
 * Shared `validateSendable` for the approval_batch family: a batch is sendable only when
 * it carries at least one item (an empty batch is a not-ready operator action).
 */
export function validateApprovalBatchSendable(batch: ApprovalBatchInput): SendableResult {
  if (!batch.items || batch.items.length === 0) {
    return { ok: false, reason: 'approval batch has no items' };
  }
  return { ok: true };
}

/**
 * Stable dedup key per legacy batch. Approval batches are NOT superseded on resend
 * (each send is a distinct operator action / a distinct review), so we key on the legacy
 * batch id — a re-mirror of the same batch updates the same row in place rather than
 * creating duplicates, while two different batches stay distinct.
 */
export function approvalBatchSourceRef(type: DeliverableType, batch: ApprovalBatchInput): string {
  return `${type}:${batch.id}`;
}

/**
 * The disabled-apply stub for the family. Apply stays a separate operator transition
 * during cutover (D-apply); adapters opt OUT of `appliesOnApprove`, so this is never
 * reached by `respondToDeliverable`. It throws to make the contract explicit if any
 * future caller wires it on prematurely (which would re-enable the B1 destructive write).
 */
export async function applyDisabledStub(_deliverable: ClientDeliverable): Promise<{ applied: number }> {
  throw new Error(
    'approval_batch apply is not wired until cutover (D-apply): apply stays disabled behind the flag until the field map soaks',
  );
}
