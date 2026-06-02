/**
 * unified-inbox-read — the client-facing unified deliverable read assembly (PR-2a, DARK).
 *
 * Backs `GET /api/public/deliverables/:workspaceId` (server/routes/deliverables.ts). Assembles
 * ONE client-facing deliverable list from the hybrid model (design §13-D1):
 *   • PHYSICAL  — the migrated types in `client_deliverable` (read via `listDeliverables`).
 *   • PROJECTED — copy entries + content requests, exposed through the SAME ClientDeliverable
 *                 interface at read time via each adapter's `projectFromSource()` (no physical row).
 *
 * The list is filtered to CLIENT-FACING statuses (what the client is actually being asked to look
 * at): the active queue (`awaiting_client`, `changes_requested`, `partial`) plus recently-decided
 * items (`approved`, `declined`) so the inbox can show "just approved" context. Internal lifecycle
 * states (`draft`, `applied`, `expired`, `cancelled`, the order/production internals) are excluded.
 *
 * This is a PURE read: it writes nothing. The `client_deliverable` table is empty until the
 * per-type send-path cutover flips (Phase 1), so in production this returns only the projected
 * copy/content_request entries — that's expected and correct (the endpoint is exercised with
 * seeded rows in tests). Leaf-ish: imports the store + source readers + the projected adapters.
 *
 * IMPORTANT: this module does NOT depend on any `unified-*` flag. The flag gates whether the
 * CLIENT fetches this endpoint (src/hooks/client/useUnifiedInbox.ts) — the read itself is inert
 * (empty physical table) until cutover, so gating here would be redundant and the endpoint must
 * remain testable with seeded rows regardless of flag state.
 */
import { listDeliverables } from '../../client-deliverables.js';
import { getSectionsForEntry, getMetadata } from '../../copy-review.js';
import { listBlueprints } from '../../page-strategy.js';
import { listContentRequests } from '../../content-requests.js';
import { copySectionAdapter } from './deliverable-adapters/copy-section.js';
import { contentRequestAdapter } from './deliverable-adapters/content-request.js';
import type {
  ClientDeliverable,
  DeliverableStatus,
} from '../../../shared/types/client-deliverable.js';
import { createLogger } from '../../logger.js';

const log = createLogger('unified-inbox-read');

/**
 * Statuses the client is actively being shown in the unified inbox. The active queue plus
 * recently-decided context. (`draft`/`applied`/`expired`/`cancelled` and the order/production
 * internals are NOT client-facing inbox items.)
 */
const CLIENT_FACING_STATUSES: ReadonlySet<DeliverableStatus> = new Set<DeliverableStatus>([
  'awaiting_client',
  'changes_requested',
  'partial',
  'approved',
  'declined',
]);

export function isClientFacingDeliverableStatus(status: DeliverableStatus): boolean {
  return CLIENT_FACING_STATUSES.has(status);
}

/** Sort newest-sent first (the inbox shows the most recently sent at the top), id as a stable tiebreak. */
function bySentDesc(a: ClientDeliverable, b: ClientDeliverable): number {
  const ak = a.sentAt ?? a.createdAt;
  const bk = b.sentAt ?? b.createdAt;
  if (ak !== bk) return ak < bk ? 1 : -1;
  return a.id < b.id ? 1 : -1;
}

/**
 * Project all copy entries for a workspace through the copy_section adapter. One deliverable per
 * blueprint ENTRY (design §13-D1). We assemble the adapter's projection input from the source
 * readers (getSectionsForEntry + getMetadata) so the adapter stays a leaf that never reads the
 * source tables itself. Entries with no sections are skipped (nothing to review).
 */
function projectCopyEntries(workspaceId: string): ClientDeliverable[] {
  const out: ClientDeliverable[] = [];
  if (!copySectionAdapter.projectFromSource) return out;
  for (const bp of listBlueprints(workspaceId)) {
    for (const entry of bp.entries ?? []) {
      const sections = getSectionsForEntry(entry.id, workspaceId);
      if (sections.length === 0) continue;
      const metadata = getMetadata(entry.id, workspaceId);
      out.push(
        copySectionAdapter.projectFromSource({
          workspaceId,
          blueprintId: bp.id,
          entryId: entry.id,
          entryName: entry.name,
          sections,
          metadata,
        }),
      );
    }
  }
  return out;
}

/**
 * Project all content requests for a workspace through the content_request adapter. One
 * deliverable per request (design §13-D1, M4).
 */
function projectContentRequests(workspaceId: string): ClientDeliverable[] {
  const out: ClientDeliverable[] = [];
  if (!contentRequestAdapter.projectFromSource) return out;
  for (const request of listContentRequests(workspaceId)) {
    out.push(contentRequestAdapter.projectFromSource(request));
  }
  return out;
}

/**
 * Assemble the FULL unified deliverable list for a workspace: physical (`client_deliverable`) +
 * projected (copy/content_request), newest-sent first, WITHOUT any status filter. The single
 * assembly the two reads share — `listClientFacingDeliverables` (client) filters this to the
 * client-facing statuses; the admin pane (PR-2b) keeps every status so the operator sees the whole
 * picture (E2). Internal/no-op only — no flag dependency.
 */
function assembleAllDeliverables(workspaceId: string): ClientDeliverable[] {
  const physical = listDeliverables(workspaceId);
  const projectedCopy = projectCopyEntries(workspaceId);
  const projectedRequests = projectContentRequests(workspaceId);

  const all = [...physical, ...projectedCopy, ...projectedRequests];
  all.sort(bySentDesc);
  return all;
}

/**
 * The unified client-facing deliverable list for a workspace: physical (`client_deliverable`) +
 * projected (copy/content_request), filtered to client-facing statuses, newest-sent first.
 */
export function listClientFacingDeliverables(workspaceId: string): ClientDeliverable[] {
  const all = assembleAllDeliverables(workspaceId).filter((d) =>
    isClientFacingDeliverableStatus(d.status),
  );

  log.debug(
    { workspaceId, clientFacing: all.length },
    'assembled unified client-facing deliverable list',
  );
  return all;
}

/**
 * The FULL unified deliverable list for a workspace (EVERY status), newest-sent first. Backs the
 * admin "Client Deliverables" pane (PR-2b) — the operator view of everything sent to the client,
 * across all five types. The route annotates each row with the status axis + stale flag (see
 * server/domains/inbox/admin-inbox-read.ts). Like the client read, this is a pure inert read until
 * cutover (the physical table is empty), exercised with seeded rows in tests.
 */
export function listAllWorkspaceDeliverables(workspaceId: string): ClientDeliverable[] {
  const all = assembleAllDeliverables(workspaceId);
  log.debug({ workspaceId, total: all.length }, 'assembled full workspace deliverable list (admin)');
  return all;
}
