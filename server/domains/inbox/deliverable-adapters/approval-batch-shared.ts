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
 * R2 — respond propagation: `respondToApprovalBatchSource` maps a deliverable back to its
 * legacy batch (via `payload.legacyBatchId`) and drives the SHARED `respondToApprovalBatch`
 * service so a unified-inbox decision writes the REAL approval items (not just the mirror).
 * approve → items approved; changes_requested/declined → items rejected. The service owns the
 * team email, so the adapter returns `{ handled: true }` for the no-double-notify contract.
 *
 * Leaf rule: this module imports shared types + the store input shape + the R2 respond
 * service (which itself imports the approvals store / email / broadcast — none of which import
 * back into the adapters, so there is no circular value-import).
 */
import type { ApprovalBatch, ApprovalItem } from '../../../../shared/types/approvals.js';
import type {
  BuiltDeliverablePayload,
  DeliverableSourceDecision,
  RespondToSourceOptions,
  RespondToSourceResult,
  SendableResult,
} from './types.js';
import type { UpsertDeliverableItemInput } from '../../../client-deliverables.js';
import type { ClientDeliverable, DeliverableType } from '../../../../shared/types/client-deliverable.js';
import { auditWritableFieldForCheck } from '../../../../shared/types/seo-audit.js';
import { createLogger } from '../../../logger.js';

const log = createLogger('approval-batch-shared');

interface ApprovalItemDecision {
  legacyItemId: string;
  status: 'approved' | 'rejected';
  note?: string | null;
  clientValue?: string | null;
}

type ApprovalBatchResponseLifecycleModule = {
  respondToApprovalBatch: (
    workspaceId: string,
    batchId: string,
    decision: 'approved' | 'rejected',
    opts?: {
      note?: string | null;
      actor?: RespondToSourceOptions['actor'];
      itemDecisions?: ApprovalItemDecision[];
    },
  ) => unknown;
};

function inboxDomainModulePath(name: 'approval-batch-response-lifecycle'): `../${typeof name}.js` {
  return `../${name}.js`;
}

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
  return auditWritableFieldForCheck(check);
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
 * one, else null. NOTE: resolveAuditItemField keys on `check` FIRST; it only falls back to
 * `item.field` when no check survived, and even then trusts ONLY the two literal meta
 * values (seoTitle/seoDescription) — never a collapsed non-meta `field`. Do not "simplify"
 * the resolver to key on `item.field` directly; that would reintroduce B1.
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

/**
 * Read the legacy approval-batch id off a mirrored deliverable's payload. Every
 * approval_batch-family adapter stashes it as `payload.legacyBatchId`
 * (`buildApprovalBatchPayload`), so this is the deliverable → source mapping for the family.
 */
function legacyBatchId(deliverable: ClientDeliverable): string | null {
  const id = (deliverable.payload as { legacyBatchId?: unknown })?.legacyBatchId;
  return typeof id === 'string' && id.trim() ? id : null;
}

/**
 * R2 source propagation for the whole approval_batch family. Maps the deliverable back to its
 * legacy batch and drives the SHARED respondToApprovalBatch service:
 *   - approved                       → every pending item approved
 *   - changes_requested / declined   → every pending item rejected (client note carried through)
 *
 * The shared service fires the team email + APPROVAL_UPDATE broadcast + activity, so this
 * returns `{ handled: true }` (the source path owns the team notification — no double-notify).
 * A missing/legacy-less payload or absent batch is a swallowed best-effort miss (the
 * deliverable mirror has already moved); we still report `handled: true` so the unified path
 * does not ALSO send a deliverable-level team email for a family whose canonical surface is the
 * source batch. Throws InvalidTransitionError only if an item is in an illegal state for the
 * move (the route/caller surfaces it as a 4xx).
 */
export async function respondToApprovalBatchSource(
  workspaceId: string,
  deliverable: ClientDeliverable,
  decision: DeliverableSourceDecision,
  opts: RespondToSourceOptions = {},
): Promise<RespondToSourceResult> {
  const batchId = legacyBatchId(deliverable);
  if (!batchId) {
    log.warn(
      { workspaceId, deliverableId: deliverable.id, type: deliverable.type },
      'approval_batch respondToSource: no legacyBatchId in payload — source not updated',
    );
    return { handled: true };
  }
  // approve → approved; changes_requested / declined → rejected (the family's reject path).
  const batchDecision = decision === 'approved' ? 'approved' : 'rejected';

  // R3 per-item subset: when the client APPROVED the deliverable but flagged a subset of items
  // and/or EDITED a subset (item 2), build per-item decisions from the deliverable's typed items[]
  // (the unflagged → approved, the flagged → rejected, each carrying the just-typed flag note +
  // the edited proposed value → clientValue). The deliverable→legacy mapping is
  // `itemPayload.legacyItemId` (the approval_item.id stashed by batchItemsToDeliverableItems).
  // Items with no legacyItemId are skipped with a warn (they cannot be propagated to the source).
  // Only meaningful on approve — a whole-deliverable reject (changes_requested/declined) rejects
  // everything regardless (edits are discarded — the team is redoing the work).
  const itemDecisions =
    decision === 'approved'
      ? buildItemDecisions(workspaceId, deliverable, opts.flaggedItems ?? [], opts.editedItems ?? [])
      : undefined;

  const { respondToApprovalBatch } =
    await import(inboxDomainModulePath('approval-batch-response-lifecycle')) as ApprovalBatchResponseLifecycleModule; // dynamic-import-ok: breaks approval-batch adapter↔response lifecycle cycle
  respondToApprovalBatch(workspaceId, batchId, batchDecision, {
    note: opts.note ?? null,
    actor: opts.actor,
    itemDecisions,
  });
  return { handled: true };
}

/**
 * Build the per-item decision list for R3 subset-approve + item 2 edit-before-approve. Returns
 * `undefined` when NO items were flagged AND none were edited (so `respondToApprovalBatch` falls
 * back to its whole-batch approve-all-pending path — the R2 back-compat behavior). When at least one
 * item is flagged OR edited, every deliverable item with a `legacyItemId` becomes an explicit
 * decision: flagged → rejected, unflagged → approved.
 *
 * The flagged subset carries the typed flag note the client entered in the detail modal. For a
 * flagged (held) item we persist `notesMap.get(item.id) ?? item.clientNote ?? null` — preferring
 * the just-typed note over any stale persisted note (which is null for a freshly-mirrored item).
 *
 * Item 2 — the edited subset (seoTitle / seoDescription) carries `clientValue` per item; the source
 * write persists it on the legacy approval item (the apply path prefers `clientValue || proposedValue`).
 * Editing is orthogonal to flagging: an item can be edited AND approved, edited AND held, or just
 * approved/held with no edit.
 */
function buildItemDecisions(
  workspaceId: string,
  deliverable: ClientDeliverable,
  flaggedItems: { itemId: string; note?: string }[],
  editedItems: { itemId: string; value: string }[],
): ApprovalItemDecision[] | undefined {
  if (flaggedItems.length === 0 && editedItems.length === 0) return undefined;
  const flagged = new Set(flaggedItems.map((f) => f.itemId));
  const notesMap = new Map<string, string>();
  for (const f of flaggedItems) {
    if (typeof f.note === 'string' && f.note.trim()) notesMap.set(f.itemId, f.note);
  }
  const editsMap = new Map<string, string>();
  for (const e of editedItems) {
    if (typeof e.value === 'string') editsMap.set(e.itemId, e.value);
  }
  const items = deliverable.items ?? [];
  const decisions: ApprovalItemDecision[] = [];
  for (const item of items) {
    const legacyItemId = (item.itemPayload as { legacyItemId?: unknown } | null)?.legacyItemId;
    if (typeof legacyItemId !== 'string' || !legacyItemId.trim()) {
      log.warn(
        { workspaceId, deliverableId: deliverable.id, deliverableItemId: item.id },
        'approval_batch respondToSource: deliverable item has no legacyItemId — skipping per-item propagation for it',
      );
      continue;
    }
    const isFlagged = flagged.has(item.id);
    // Item 2 — the edited value, if the client edited this item; falls back to any already-persisted
    // clientValue (so a re-respond does not clobber a prior edit), else undefined (leave untouched).
    const editedValue = editsMap.has(item.id) ? editsMap.get(item.id)! : item.clientValue ?? null;
    decisions.push({
      legacyItemId,
      status: isFlagged ? 'rejected' : 'approved',
      // For a flagged (held) item, prefer the just-typed flag note over any stale persisted note.
      note: isFlagged ? notesMap.get(item.id) ?? item.clientNote ?? null : item.clientNote ?? null,
      clientValue: editedValue,
    });
  }
  // If the deliverable carried no items (or none had a legacyItemId) there is nothing to drive
  // per-item; returning undefined lets the whole-batch path approve all pending (safe fallback).
  return decisions.length > 0 ? decisions : undefined;
}
