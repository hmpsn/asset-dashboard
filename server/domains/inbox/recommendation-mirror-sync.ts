/**
 * recommendation mirror status sync (Reconcile R4-PR1 — the authority split, respond half).
 *
 * The client "Act on this" greenlight (POST /api/public/recommendations/:ws/:recId/act-on) flips a
 * sent rec's `clientStatus` → 'approved' via the single-writer. Under the ratified two-axis authority
 * split the DELIVERABLE SPINE owns client-delivery state, so the rec-sourced `client_deliverable`
 * mirror born `awaiting_client` at /send MUST advance to 'approved' in lockstep — otherwise the two
 * halves DIVERGE BY CONSTRUCTION (the audit-named blind spot: "act-on never advances the mirror").
 *
 * This is the exact sibling of `approval-batch-mirror-sync.ts`: find the deterministic
 * `recommendation:<id>` mirror via `findBySourceRef`, move its status THROUGH THE DELIVERABLE STORE
 * (`upsertDeliverable` — pr-check forbids a direct table insert here) guarded by
 * `getDeliverableTransitions`, and fire `DELIVERABLE_UPDATED` (reused — it already has full frontend
 * invalidation coverage in ClientDashboard / UnifiedInbox / ClientDeliverablesPane; no new WS event).
 *
 * Best-effort + self-swallowing: the client's greenlight (the durable content request + the rec
 * clientStatus flip) is the source of truth and has ALREADY committed by the time this runs. A mirror
 * sync failure must NEVER surface to the client or roll back the greenlight — it is logged (and the
 * read-only `deliverable-divergence-sweep` will surface any resulting drift for repair).
 *
 * Idempotent: a re-act-on onto an already-'approved' mirror is a no-op that returns the existing row.
 * A mirror already in a terminal/decided state (echo from another path) logs at debug and no-ops.
 *
 * Leaf rule: imports the store + broadcast singleton + state-machine + logger + shared types only;
 * not imported back by them.
 */
import type { Recommendation } from '../../../shared/types/recommendations.js';
import type {
  ClientDeliverable,
  DeliverableStatus,
} from '../../../shared/types/client-deliverable.js';
import { findBySourceRef, upsertDeliverable } from '../../client-deliverables.js';
import { broadcastToWorkspace } from '../../broadcast.js';
import { WS_EVENTS } from '../../ws-events.js';
import { getDeliverableTransitions } from '../../state-machines.js';
import { createLogger } from '../../logger.js';

const log = createLogger('recommendation-mirror-sync');

/** The deterministic per-rec natural key (mirrors the recommendation adapter's sourceRef). */
export function recommendationSourceRef(recId: string): string {
  return `recommendation:${recId}`;
}

function safeBroadcast(workspaceId: string, event: string, deliverable: ClientDeliverable): void {
  try {
    broadcastToWorkspace(workspaceId, event, {
      deliverableId: deliverable.id,
      type: deliverable.type,
      status: deliverable.status,
    });
  } catch (err) {
    log.warn(
      { err, workspaceId, deliverableId: deliverable.id, event },
      'deliverable broadcast failed (swallowed)',
    );
  }
}

/** Move an existing mirror row to a new status THROUGH the store (never a direct table write),
 *  preserving every other column (delete-then-reinsert-safe: we pass the whole existing row back). */
function moveMirrorStatus(
  existing: ClientDeliverable,
  status: DeliverableStatus,
  opts: { decidedAt?: string | null; clientResponseNote?: string | null } = {},
): ClientDeliverable {
  return upsertDeliverable({
    id: existing.id,
    workspaceId: existing.workspaceId,
    type: existing.type,
    kind: existing.kind,
    status,
    title: existing.title,
    summary: existing.summary,
    payload: existing.payload,
    note: existing.note,
    clientResponseNote:
      opts.clientResponseNote !== undefined ? opts.clientResponseNote : existing.clientResponseNote,
    externalRef: existing.externalRef,
    parentDeliverableId: existing.parentDeliverableId,
    sentAt: existing.sentAt,
    decidedAt: opts.decidedAt !== undefined ? opts.decidedAt : existing.decidedAt,
    dueAt: existing.dueAt,
    appliedAt: existing.appliedAt,
    generatedAt: existing.generatedAt,
    source: existing.source,
    sourceRef: existing.sourceRef,
  });
}

/**
 * Advance the rec-sourced deliverable mirror to a client-response status when the client acts on the
 * rec. `target` is the deliverable status the client decision maps to:
 *   act-on (greenlight)    → 'approved'
 *   decline                → 'declined'
 *   discussing             → (no deliverable status; the mirror stays awaiting_client) — omit the call
 *
 * Returns the updated mirror (or the existing one when already at target / no legal edge), or null
 * when no mirror exists yet (a rec sent before the dual-write shipped, or a skipped mint). NEVER
 * throws — the client greenlight has already committed.
 */
export function syncRecommendationDeliverableStatus(
  workspaceId: string,
  rec: Pick<Recommendation, 'id'>,
  target: DeliverableStatus,
  opts: { clientResponseNote?: string | null } = {},
): ClientDeliverable | null {
  try {
    const existing = findBySourceRef(
      workspaceId,
      'recommendation',
      recommendationSourceRef(rec.id),
    );
    if (!existing) {
      // No mirror to advance (rec sent pre-dual-write, or its mint was skipped/failed). The
      // divergence sweep surfaces this drift; the greenlight itself is unaffected.
      log.debug(
        { workspaceId, recId: rec.id, target },
        'rec mirror sync skipped: no mirror row found (divergence sweep will surface it)',
      );
      return null;
    }
    if (existing.status === target) return existing;

    const allowed = getDeliverableTransitions(existing.type)[existing.status];
    if (!allowed?.includes(target)) {
      const mirrorAlreadyDecided =
        existing.status === 'declined' ||
        existing.status === 'approved' ||
        existing.status === 'applied' ||
        existing.status === 'cancelled' ||
        existing.status === 'expired';
      log[mirrorAlreadyDecided ? 'debug' : 'warn'](
        { workspaceId, recId: rec.id, from: existing.status, to: target },
        mirrorAlreadyDecided
          ? 'rec mirror sync skipped: mirror already decided (act-on echo)'
          : 'rec mirror sync skipped: unexpected illegal deliverable transition',
      );
      return existing;
    }

    const deliverable = moveMirrorStatus(existing, target, {
      decidedAt: existing.decidedAt ?? new Date().toISOString(),
      ...(opts.clientResponseNote != null ? { clientResponseNote: opts.clientResponseNote } : {}),
    });
    safeBroadcast(workspaceId, WS_EVENTS.DELIVERABLE_UPDATED, deliverable);
    log.debug(
      { workspaceId, recId: rec.id, deliverableId: deliverable.id, status: target },
      'rec mirror advanced to client-response status',
    );
    return deliverable;
  } catch (err) {
    log.error({ err, workspaceId, recId: rec.id, target }, 'rec mirror status sync failed (swallowed)');
    return null;
  }
}
