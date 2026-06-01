/**
 * Backfill: mirror legacy `client_actions` rows into the unified `client_deliverable` model
 * (PR-1b cutover tooling — NOT run automatically).
 *
 * Run during the client_action-family cutover, AFTER the dual-write seam is live (so fresh
 * actions already mirror):
 *
 *   npx tsx scripts/backfill-deliverables-client-action.ts            # backfill
 *   npx tsx scripts/backfill-deliverables-client-action.ts --dry-run  # report only, no writes
 *   npx tsx scripts/backfill-deliverables-client-action.ts --check    # parity assertion only
 *
 * Idempotent + sourceId normalization (audit §B.4): the legacy producers keyed
 * `client_actions.source_id` on a TIMESTAMP for redirect/internal_link (`redirects:<ts>` /
 * `internal-links:<ts>`), so a backfill that reused the legacy id would NOT dedupe against
 * fresh dual-written rows (which use the stable `redirect:<siteId>` / `internal_link:<siteId>`
 * key). This script instead routes EVERY row through the adapter's own `sourceRef()` — the
 * stable site/page key — so legacy + fresh collapse onto ONE row per (ws, type, sourceRef).
 * It then SKIPS any row whose deliverable already exists (DO-NOTHING). Re-running is a no-op.
 *
 * Determinism + parity: `clientActionDeliverableType` is a TOTAL map — every legacy row
 * resolves to exactly one of the four family types. `assertEveryActionResolvesToOneType` fails
 * loudly if any row resolves outside the family so the migration cannot silently drop a row.
 *
 * Apply stays a permanent no-op for this family (D-apply — manual operator queue): backfilled
 * rows are born `awaiting_client` / `approved` (mapped from the legacy action status).
 */
import db from '../server/db/index.js';
import { parseJsonFallback } from '../server/db/json-validation.js';
import type {
  ClientAction,
  ClientActionPayload,
  ClientActionSourceType,
  ClientActionStatus,
} from '../shared/types/client-actions.js';
import type { DeliverableStatus } from '../shared/types/client-deliverable.js';
import { findBySourceRef, upsertDeliverable } from '../server/client-deliverables.js';
import { getWorkspace } from '../server/workspaces.js';
import { getAdapter } from '../server/domains/inbox/deliverable-adapters/index.js';
import {
  CLIENT_ACTION_FAMILY_TYPES,
  type ClientActionFamilyType,
  type ClientActionInput,
  clientActionDeliverableType,
} from '../server/domains/inbox/deliverable-adapters/client-action-shared.js';

interface ClientActionRow {
  id: string;
  workspace_id: string;
  source_type: string;
  source_id: string | null;
  title: string;
  summary: string;
  payload: string;
  status: string;
  priority: string;
  client_note: string | null;
  created_at: string;
  updated_at: string;
}

const VALID_SOURCES: ClientActionSourceType[] = [
  'aeo_change',
  'internal_link',
  'redirect_proposal',
  'content_decay',
];

/** Read every legacy client_action from the DB (cutover tooling reads the old table). */
function readAllActions(): ClientAction[] {
  const rows = db.prepare('SELECT * FROM client_actions').all() as ClientActionRow[];
  return rows.map(rowToAction);
}

/** Parse a raw client_actions row into a ClientAction (mirrors server/client-actions.ts). */
function rowToAction(row: ClientActionRow): ClientAction {
  const sourceType = VALID_SOURCES.includes(row.source_type as ClientActionSourceType)
    ? (row.source_type as ClientActionSourceType)
    : 'aeo_change';
  const priority = row.priority === 'high' || row.priority === 'low' ? row.priority : 'medium';
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    sourceType,
    sourceId: row.source_id ?? undefined,
    title: row.title,
    summary: row.summary,
    payload: parseJsonFallback<ClientActionPayload>(row.payload, {}),
    status: row.status as ClientActionStatus,
    priority,
    clientNote: row.client_note ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Map a legacy client_action status onto the unified deliverable status vocabulary
 * (design §4.2). Backfilled rows reflect the legacy decision state; apply is NOT replayed
 * (D-apply — this family has no automated apply).
 */
function mapActionStatus(status: ClientActionStatus): DeliverableStatus {
  switch (status) {
    case 'approved':
      return 'approved';
    case 'changes_requested':
      return 'changes_requested';
    case 'completed':
      // The manual work was executed by the operator/agency. The closest unified terminal
      // state for a manual-queue family is `applied` (the change was made).
      return 'applied';
    case 'archived':
      return 'cancelled';
    case 'pending':
    default:
      return 'awaiting_client';
  }
}

/**
 * PARITY ASSERTION: every legacy action resolves to EXACTLY ONE family type. Throws on any
 * action that resolves outside the four-type family — the migration must not silently drop a
 * row. (The type map is total + single-valued, so this holds by construction; the assertion
 * guards against future drift.)
 */
export function assertEveryActionResolvesToOneType(actions: ClientAction[]): void {
  const familySet = new Set<string>(CLIENT_ACTION_FAMILY_TYPES);
  for (const action of actions) {
    const type = clientActionDeliverableType(action.sourceType);
    if (!familySet.has(type)) {
      throw new Error(
        `parity violation: action ${action.id} ("${action.title}") classified as '${type}', not one of the ${CLIENT_ACTION_FAMILY_TYPES.length} family types`,
      );
    }
  }
}

interface BackfillResult {
  total: number;
  byType: Record<ClientActionFamilyType, number>;
  inserted: number;
  skipped: number;
  unkeyed: number;
}

/**
 * Backfill all legacy client_actions. Idempotent: routes every row through the adapter's stable
 * `sourceRef()` (NORMALIZING the legacy timestamp-keyed sourceId — audit §B.4) and skips rows
 * whose deliverable already exists (DO-NOTHING). When `dryRun` is true, classifies + counts but
 * writes nothing. Rows whose sourceRef cannot be resolved (no siteId / no page path) are counted
 * as `unkeyed` and inserted as distinct rows (sourceRef null never dedupes — design §4.5).
 */
export function backfillClientActionDeliverables(opts: { dryRun?: boolean } = {}): BackfillResult {
  const actions = readAllActions();
  // Fail loud before writing anything if the type map is not total/single-valued.
  assertEveryActionResolvesToOneType(actions);

  // Cache workspace → siteId so a large backfill does not re-query per row.
  const siteIdCache = new Map<string, string | null>();
  const resolveSiteId = (workspaceId: string): string | null => {
    if (!siteIdCache.has(workspaceId)) {
      siteIdCache.set(workspaceId, getWorkspace(workspaceId)?.webflowSiteId ?? null);
    }
    return siteIdCache.get(workspaceId) ?? null;
  };

  const byType = Object.fromEntries(
    CLIENT_ACTION_FAMILY_TYPES.map((t) => [t, 0]),
  ) as Record<ClientActionFamilyType, number>;
  let inserted = 0;
  let skipped = 0;
  let unkeyed = 0;

  for (const action of actions) {
    const type = clientActionDeliverableType(action.sourceType);
    const adapter = getAdapter(type);
    const input: ClientActionInput = { action, siteId: resolveSiteId(action.workspaceId) };

    // Guarantee 0: skip not-ready rows (empty arrays, content_decay with no keyword per B13).
    const sendable = adapter.validateSendable(input);
    if (!sendable.ok) {
      skipped += 1;
      continue;
    }

    // sourceId NORMALIZATION (audit §B.4): the new stable key, NOT the legacy timestamp id.
    const sourceRef = adapter.sourceRef(input);
    if (sourceRef == null) unkeyed += 1;

    // DO-NOTHING: a deliverable for this (ws, type, sourceRef) already exists → skip.
    if (sourceRef != null && findBySourceRef(action.workspaceId, type, sourceRef) != null) {
      skipped += 1;
      continue;
    }

    // byType counts rows that would be / are inserted (excludes skipped), matching `inserted`.
    byType[type] += 1;
    if (opts.dryRun) continue;

    const built = adapter.buildPayload(input);
    upsertDeliverable({
      workspaceId: action.workspaceId,
      type,
      kind: built.kind,
      status: mapActionStatus(action.status),
      title: built.title,
      summary: built.summary ?? null,
      payload: built.payload,
      note: action.clientNote ?? null,
      externalRef: built.externalRef ?? null,
      parentDeliverableId: built.parentDeliverableId ?? null,
      sentAt: action.createdAt,
      generatedAt: action.createdAt,
      source: 'backfill-client-action',
      sourceRef,
      items: built.items,
    });
    inserted += 1;
  }

  return { total: actions.length, byType, inserted, skipped, unkeyed };
}

// ── CLI entry (only when invoked directly, not when imported by tests) ─────────
const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const dryRun = process.argv.includes('--dry-run');
  const checkOnly = process.argv.includes('--check');

  if (checkOnly) {
    const actions = readAllActions();
    assertEveryActionResolvesToOneType(actions);
    console.log(`parity OK: ${actions.length} legacy client_actions each resolve to exactly one type`);
  } else {
    const result = backfillClientActionDeliverables({ dryRun });
    console.log(dryRun ? 'DRY RUN (no writes):' : 'Backfill complete:');
    console.log(`  total legacy client_actions: ${result.total}`);
    console.log(`  by type:`, result.byType);
    console.log(`  inserted: ${result.inserted}`);
    console.log(`  skipped (already mirrored / not sendable): ${result.skipped}`);
    console.log(`  unkeyed (no stable sourceRef, inserted distinct): ${result.unkeyed}`);
  }
}
