/**
 * Backfill: mirror legacy `schema_site_plans` rows into the unified `client_deliverable` model
 * (PR-1c cutover tooling — NOT run automatically).
 *
 * Run during the schema_plan cutover, AFTER the dual-write seam is live (so freshly-sent plans
 * already mirror):
 *
 *   npx tsx scripts/backfill-deliverables-schema-plan.ts            # backfill
 *   npx tsx scripts/backfill-deliverables-schema-plan.ts --dry-run  # report only, no writes
 *   npx tsx scripts/backfill-deliverables-schema-plan.ts --check    # 1:1 site→workspace assertion only
 *
 * Idempotent + sourceRef normalization (design §4.5): every plan routes through the adapter's own
 * `sourceRef()` — the stable `schema_plan:<siteId>` key — so a backfill collapses onto the SAME
 * row a fresh dual-write produces. It then SKIPS any plan whose deliverable already exists
 * (DO-NOTHING). Re-running is a no-op.
 *
 * siteId → owning workspace (assert 1:1): `schema_site_plans` stores `workspace_id` per row, so
 * the owning workspace is read straight off the row — NOT guessed. We still ASSERT the mapping is
 * 1:1 per siteId (one site must not map to two workspaces): if a siteId appears under more than
 * one workspace_id, the conflicting rows are SKIPPED with a logged warning (the migration must
 * not silently pick the wrong owner). A site with a single workspace backfills normally.
 *
 * Only plans that have actually been SENT (status `sent_to_client` / `client_approved` /
 * `client_changes_requested` / `active`) carry a client-facing deliverable; a `draft` plan was
 * never sent, so it is skipped (there is nothing to mirror). Empty plans are also skipped
 * (adapter Guarantee 0).
 *
 * Apply stays a separate operator transition for this type (D-apply): backfilled rows reflect the
 * legacy plan status; apply is NOT replayed.
 */
import db from '../server/db/index.js';
import { parseJsonFallback } from '../server/db/json-validation.js';
import type {
  CanonicalEntity,
  PageRoleAssignment,
  SchemaSitePlan,
} from '../shared/types/schema-plan.js';
import type { DeliverableStatus } from '../shared/types/client-deliverable.js';
import { findBySourceRef, upsertDeliverable } from '../server/client-deliverables.js';
import { getAdapter } from '../server/domains/inbox/deliverable-adapters/index.js';
import type { SchemaPlanInput } from '../server/domains/inbox/deliverable-adapters/schema-plan.js';
import { createLogger } from '../server/logger.js';

const log = createLogger('backfill-deliverables-schema-plan');

interface PlanRow {
  id: string;
  site_id: string;
  workspace_id: string;
  site_url: string;
  canonical_entities: string;
  page_roles: string;
  status: string;
  client_preview_batch_id: string | null;
  generated_at: string;
  updated_at: string;
}

/** Plan statuses that mean the plan has been sent to (or acted on by) the client. */
const SENT_STATUSES = new Set<SchemaSitePlan['status']>([
  'sent_to_client',
  'client_approved',
  'client_changes_requested',
  'active',
]);

/** Read every legacy schema_site_plan from the DB (cutover tooling reads the old table). */
function readAllPlans(): SchemaSitePlan[] {
  const rows = db.prepare('SELECT * FROM schema_site_plans').all() as PlanRow[];
  return rows.map(rowToPlan);
}

/** Parse a raw schema_site_plans row into a SchemaSitePlan (mirrors schema-store.ts:rowToPlan). */
function rowToPlan(row: PlanRow): SchemaSitePlan {
  const parsedEntities = parseJsonFallback<unknown>(row.canonical_entities, []);
  const canonicalEntities = Array.isArray(parsedEntities) ? (parsedEntities as CanonicalEntity[]) : [];
  const parsedRoles = parseJsonFallback<unknown>(row.page_roles, []);
  const pageRoles = Array.isArray(parsedRoles) ? (parsedRoles as PageRoleAssignment[]) : [];
  return {
    id: row.id,
    siteId: row.site_id,
    workspaceId: row.workspace_id,
    siteUrl: row.site_url,
    canonicalEntities,
    pageRoles,
    status: row.status as SchemaSitePlan['status'],
    clientPreviewBatchId: row.client_preview_batch_id || undefined,
    generatedAt: row.generated_at,
    updatedAt: row.updated_at,
  };
}

/** Map a legacy plan status onto the unified deliverable status vocabulary (design §4.2). */
function mapPlanStatus(status: SchemaSitePlan['status']): DeliverableStatus {
  switch (status) {
    case 'client_approved':
      return 'approved';
    case 'client_changes_requested':
      return 'changes_requested';
    case 'active':
      // The operator activated/published the strategy — the closest unified terminal is `applied`.
      return 'applied';
    case 'sent_to_client':
    default:
      return 'awaiting_client';
  }
}

/**
 * 1:1 site→workspace assertion. Returns the set of siteIds that map to MORE THAN ONE workspace
 * (a not-1:1 conflict). The backfill skips those rows with a logged warning rather than silently
 * picking an owner. An empty set means every siteId maps to exactly one workspace (the expected
 * case — `schema_site_plans` is keyed by site_id).
 */
export function findSiteWorkspaceConflicts(plans: SchemaSitePlan[]): Set<string> {
  const bySite = new Map<string, Set<string>>();
  for (const plan of plans) {
    if (!bySite.has(plan.siteId)) bySite.set(plan.siteId, new Set());
    bySite.get(plan.siteId)!.add(plan.workspaceId);
  }
  const conflicts = new Set<string>();
  for (const [siteId, workspaceIds] of bySite) {
    if (workspaceIds.size > 1) {
      conflicts.add(siteId);
      log.warn(
        { siteId, workspaceIds: [...workspaceIds] },
        'schema-plan backfill: siteId maps to >1 workspace (not 1:1) — skipping conflicting rows',
      );
    }
  }
  return conflicts;
}

interface BackfillResult {
  total: number;
  inserted: number;
  skipped: number;
  conflicts: number;
}

/**
 * Backfill all legacy schema_site_plans. Idempotent: routes every plan through the adapter's
 * stable `sourceRef()` (`schema_plan:<siteId>`) and skips plans whose deliverable already exists
 * (DO-NOTHING). Skips draft (never-sent) plans, not-ready (empty) plans, and rows whose siteId is
 * not 1:1 with a workspace. When `dryRun` is true, classifies + counts but writes nothing.
 */
export function backfillSchemaPlanDeliverables(opts: { dryRun?: boolean } = {}): BackfillResult {
  const plans = readAllPlans();
  const conflictSites = findSiteWorkspaceConflicts(plans);
  const adapter = getAdapter('schema_plan');

  let inserted = 0;
  let skipped = 0;
  let conflicts = 0;

  for (const plan of plans) {
    // Not-1:1 site→workspace → skip (logged in findSiteWorkspaceConflicts).
    if (conflictSites.has(plan.siteId)) {
      conflicts += 1;
      skipped += 1;
      continue;
    }

    // A draft plan was never sent → no client-facing deliverable to mirror.
    if (!SENT_STATUSES.has(plan.status)) {
      skipped += 1;
      continue;
    }

    const input: SchemaPlanInput = { plan };

    // Guarantee 0: skip a not-ready (empty) plan.
    const sendable = adapter.validateSendable(input);
    if (!sendable.ok) {
      skipped += 1;
      continue;
    }

    const sourceRef = adapter.sourceRef(input);

    // DO-NOTHING: a deliverable for this (ws, schema_plan, sourceRef) already exists → skip.
    if (sourceRef != null && findBySourceRef(plan.workspaceId, 'schema_plan', sourceRef) != null) {
      skipped += 1;
      continue;
    }

    if (opts.dryRun) {
      inserted += 1; // would-insert count
      continue;
    }

    const built = adapter.buildPayload(input);
    upsertDeliverable({
      workspaceId: plan.workspaceId,
      type: 'schema_plan',
      kind: built.kind,
      status: mapPlanStatus(plan.status),
      title: built.title,
      summary: built.summary ?? null,
      payload: built.payload,
      externalRef: built.externalRef ?? null,
      parentDeliverableId: built.parentDeliverableId ?? null,
      sentAt: plan.updatedAt,
      generatedAt: plan.generatedAt,
      source: 'backfill-schema-plan',
      sourceRef,
    });
    inserted += 1;
  }

  return { total: plans.length, inserted, skipped, conflicts };
}

// ── CLI entry (only when invoked directly, not when imported by tests) ─────────
const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const dryRun = process.argv.includes('--dry-run');
  const checkOnly = process.argv.includes('--check');

  if (checkOnly) {
    const plans = readAllPlans();
    const conflicts = findSiteWorkspaceConflicts(plans);
    if (conflicts.size === 0) {
      console.log(`1:1 OK: ${plans.length} schema plans, every siteId maps to exactly one workspace`);
    } else {
      console.log(`1:1 VIOLATION: ${conflicts.size} siteId(s) map to >1 workspace:`, [...conflicts]);
      process.exitCode = 1;
    }
  } else {
    const result = backfillSchemaPlanDeliverables({ dryRun });
    console.log(dryRun ? 'DRY RUN (no writes):' : 'Backfill complete:');
    console.log(`  total schema plans: ${result.total}`);
    console.log(`  inserted: ${result.inserted}`);
    console.log(`  skipped (already mirrored / draft / not sendable / conflict): ${result.skipped}`);
    console.log(`  conflicts (siteId not 1:1 with workspace, skipped): ${result.conflicts}`);
  }
}
