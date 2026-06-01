/**
 * Backfill: mirror legacy `approval_batches` rows into the unified `client_deliverable`
 * model (PR-1a cutover tooling — NOT run automatically).
 *
 * Run during the approval-family cutover, AFTER migrations 111/112 are applied and the
 * dual-write seam is live (so fresh batches already mirror):
 *
 *   npx tsx scripts/backfill-deliverables-approval.ts            # backfill
 *   npx tsx scripts/backfill-deliverables-approval.ts --dry-run  # report only, no writes
 *   npx tsx scripts/backfill-deliverables-approval.ts --check    # parity assertion only
 *
 * Idempotent: each batch maps to a stable `sourceRef` of `<type>:<batchId>`, and the
 * script SKIPS any batch whose deliverable already exists (true INSERT ... ON CONFLICT
 * DO NOTHING semantics layered over the store's upsert). Re-running is a no-op.
 *
 * Determinism + parity: `classifyApprovalBatch` is a TOTAL classifier — every legacy row
 * resolves to exactly one of the five sub-types (seo_edit is the exhaustive default). The
 * parity assertion (`assertEveryBatchResolvesToOneType`) fails loudly if any row resolves
 * to zero or many types, so the migration cannot silently drop or double-count a batch.
 *
 * Apply stays disabled (D-apply): backfilled rows are born `awaiting_client` /
 * `approved` (mapped from the legacy batch status) with `applyable=false` items.
 */
import db from '../server/db/index.js';
import { parseJsonFallback } from '../server/db/json-validation.js';
import { approvalItemSchema } from '../server/schemas/approval-schemas.js';
import type { ApprovalBatch, ApprovalItem } from '../shared/types/approvals.js';
import type { DeliverableStatus } from '../shared/types/client-deliverable.js';
import { findBySourceRef, upsertDeliverable } from '../server/client-deliverables.js';
import { getAdapter } from '../server/domains/inbox/deliverable-adapters/index.js';
import {
  APPROVAL_BATCH_FAMILY_TYPES,
  classifyApprovalBatch,
  type ApprovalBatchFamilyType,
} from '../server/domains/inbox/deliverable-adapters/approval-batch-classifier.js';

interface ApprovalBatchRow {
  id: string;
  workspace_id: string;
  site_id: string;
  name: string;
  items: string;
  status: string;
  note: string | null;
  created_at: string;
  updated_at: string;
}

/** Read every legacy approval batch from the DB (cutover tooling reads the old table). */
function readAllBatches(): ApprovalBatch[] {
  const rows = db.prepare('SELECT * FROM approval_batches').all() as ApprovalBatchRow[];
  return rows.map(rowToBatch);
}

/** Parse a raw approval_batches row into an ApprovalBatch (mirrors server/approvals.ts). */
function rowToBatch(row: ApprovalBatchRow): ApprovalBatch {
  const rawItems = parseJsonFallback<unknown[]>(row.items, []);
  const items: ApprovalItem[] = [];
  for (const raw of rawItems) {
    if (typeof raw !== 'object' || raw === null) continue;
    const obj = raw as Record<string, unknown>;
    if (!obj.status) obj.status = 'pending';
    const result = approvalItemSchema.safeParse(obj);
    if (result.success) items.push(result.data as ApprovalItem);
  }
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    siteId: row.site_id,
    name: row.name,
    items,
    status: row.status as ApprovalBatch['status'],
    note: row.note ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Map a legacy batch status onto the unified deliverable status vocabulary (design §4.2).
 * Backfilled rows reflect the legacy decision state; apply is NOT replayed (D-apply).
 */
function mapBatchStatus(status: ApprovalBatch['status']): DeliverableStatus {
  switch (status) {
    case 'approved':
      return 'approved';
    case 'applied':
      return 'applied';
    case 'rejected':
      return 'changes_requested';
    case 'partial':
      return 'partial';
    case 'pending':
    default:
      return 'awaiting_client';
  }
}

/**
 * PARITY ASSERTION: every legacy batch resolves to EXACTLY ONE family type. Throws on any
 * batch that resolves to zero or to multiple types — the migration must not silently drop
 * or double-count a row. (The classifier is total + single-valued, so this holds by
 * construction; the assertion is a guard against future classifier drift.)
 */
export function assertEveryBatchResolvesToOneType(batches: ApprovalBatch[]): void {
  const familySet = new Set<string>(APPROVAL_BATCH_FAMILY_TYPES);
  for (const batch of batches) {
    const type = classifyApprovalBatch(batch);
    if (!familySet.has(type)) {
      throw new Error(
        `parity violation: batch ${batch.id} ("${batch.name}") classified as '${type}', not one of the ${APPROVAL_BATCH_FAMILY_TYPES.length} family types`,
      );
    }
  }
}

interface BackfillResult {
  total: number;
  byType: Record<ApprovalBatchFamilyType, number>;
  inserted: number;
  skipped: number;
}

/**
 * Backfill all legacy batches. Idempotent: skips batches whose deliverable already exists
 * (DO-NOTHING semantics). When `dryRun` is true, classifies + counts but writes nothing.
 */
export function backfillApprovalDeliverables(opts: { dryRun?: boolean } = {}): BackfillResult {
  const batches = readAllBatches();
  // Fail loud before writing anything if the classifier is not total/single-valued.
  assertEveryBatchResolvesToOneType(batches);

  const byType = Object.fromEntries(
    APPROVAL_BATCH_FAMILY_TYPES.map((t) => [t, 0]),
  ) as Record<ApprovalBatchFamilyType, number>;
  let inserted = 0;
  let skipped = 0;

  for (const batch of batches) {
    const type = classifyApprovalBatch(batch);
    byType[type] += 1;

    const adapter = getAdapter(type);
    const sourceRef = adapter.sourceRef(batch);

    // DO-NOTHING: a deliverable for this (ws, type, sourceRef) already exists → skip.
    if (sourceRef != null && findBySourceRef(batch.workspaceId, type, sourceRef) != null) {
      skipped += 1;
      continue;
    }

    if (opts.dryRun) continue;

    const built = adapter.buildPayload(batch);
    upsertDeliverable({
      workspaceId: batch.workspaceId,
      type,
      kind: built.kind,
      status: mapBatchStatus(batch.status),
      title: built.title,
      summary: built.summary ?? null,
      payload: built.payload,
      note: batch.note ?? null,
      externalRef: built.externalRef ?? null,
      parentDeliverableId: built.parentDeliverableId ?? null,
      sentAt: batch.createdAt,
      generatedAt: batch.createdAt,
      source: 'backfill-approval',
      sourceRef,
      items: built.items,
    });
    inserted += 1;
  }

  return { total: batches.length, byType, inserted, skipped };
}

// ── CLI entry (only when invoked directly, not when imported by tests) ─────────
const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const dryRun = process.argv.includes('--dry-run');
  const checkOnly = process.argv.includes('--check');

  if (checkOnly) {
    const batches = readAllBatches();
    assertEveryBatchResolvesToOneType(batches);
    console.log(`parity OK: ${batches.length} legacy batches each resolve to exactly one type`);
  } else {
    const result = backfillApprovalDeliverables({ dryRun });
    console.log(dryRun ? 'DRY RUN (no writes):' : 'Backfill complete:');
    console.log(`  total legacy batches: ${result.total}`);
    console.log(`  by type:`, result.byType);
    console.log(`  inserted: ${result.inserted}`);
    console.log(`  skipped (already mirrored): ${result.skipped}`);
  }
}
