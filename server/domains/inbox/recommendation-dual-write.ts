/**
 * recommendation dual-write mirror (Strategy "The Issue" — Phase 2, close-the-loop half #1).
 *
 * At the recommendation SEND seam (the per-row `/send` route AND the `/bulk` send action in
 * server/routes/recommendations.ts — the two places `sendRecommendation` fires), mirror the
 * freshly-sent rec into the unified `client_deliverable` model via the registered `recommendation`
 * adapter + `upsertDeliverable`, born `awaiting_client`. This is what makes a sent rec actually
 * REACH the client surface (the unified feed/inbox renders from the deliverables query) — closing
 * the "operator send → client sees" half-loop the spec §7 / audit P2-2 flagged as open.
 *
 * Mirrors `client-action-dual-write.ts` exactly: hooking the send seam covers all send paths with
 * one mirror call. The mirror is best-effort and MUST NOT break the live send: any failure is
 * logged and swallowed (the rec's clientStatus is already 'sent' + the doorbell already queued).
 *
 * Reconcile R4-PR1 — VERIFIABLE authority: the mirror no longer returns a bare
 * `ClientDeliverable | null` (a shape that let ALL callers silently discard the failure). It returns
 * a typed `MirrorResult` so every one of the three call seams (per-row /send, bulk send, autosend
 * cron) OBSERVES the outcome and, on failure, writes a durable admin-only activity-log entry + a
 * Pino error instead of swallowing the divergence. See docs/rules/strategy-recommendations.md.
 *
 * Dedup: sourceRef = `recommendation:<id>`, so a re-send of the same rec collapses onto the one
 * existing deliverable row (upsertDeliverable keys on (ws, type, sourceRef)).
 *
 * Leaf rule: imports the registry + the store + the broadcast singleton + the logger; not imported
 * back by them. No feature flag gates this mirror — it runs unconditionally on every rec send (the
 * deliverable is dark client-side until the strategy-the-issue surface reads it).
 */
import type { Recommendation } from '../../../shared/types/recommendations.js';
import { upsertDeliverable } from '../../client-deliverables.js';
import { broadcastToWorkspace } from '../../broadcast.js';
import { WS_EVENTS } from '../../ws-events.js';
import { getAdapter } from './deliverable-adapters/index.js';
import type { RecommendationInput } from './deliverable-adapters/recommendation.js';
import { createLogger } from '../../logger.js';

const log = createLogger('recommendation-dual-write');

/**
 * The typed outcome of a dual-write mirror (Reconcile R4-PR1). Replaces the old
 * `ClientDeliverable | null` return that let every caller silently discard the failure.
 *
 *   { ok: true, deliverableId }         — mirror row created/deduped successfully
 *   { ok: true, skipped: true, reason } — the adapter benignly rejected a not-sendable input
 *                                         (nothing to mirror; NOT a failure to alert on)
 *   { ok: false, error }                — the store write threw; the caller MUST record a durable
 *                                         activity entry so the divergence is observable
 *
 * Both dual-write mirrors (recommendation + client_action) return this same shape so the three rec
 * callers and the client-action caller observe outcomes uniformly.
 */
export type MirrorResult =
  | { ok: true; deliverableId?: string; skipped?: boolean; reason?: string }
  | { ok: false; error: string };

/**
 * Mirror a freshly-sent recommendation into `client_deliverable`.
 * Returns a typed `MirrorResult`: `{ ok: true, deliverableId }` on success (or an adapter-rejected
 * skip, which is a benign not-sendable outcome, `{ ok: true }` with no id), and `{ ok: false, error }`
 * when the store write threw. NEVER throws — the live send must not be affected. Callers MUST observe
 * `ok` and log an activity entry on `false` (R4-PR1 — no more silent swallow).
 */
export function mirrorRecommendationToDeliverable(
  workspaceId: string,
  rec: Recommendation,
): MirrorResult {
  try {
    const adapter = getAdapter('recommendation');
    const input: RecommendationInput = { rec };

    // Guarantee 0 — the adapter rejects not-ready recs (no id, or no title/insight to present).
    // A rejection is a BENIGN skip (there was nothing sendable to mirror), NOT a failure the caller
    // must alert on — return ok:true with no deliverableId so the caller doesn't log a false alarm.
    const sendable = adapter.validateSendable(input);
    if (!sendable.ok) {
      log.warn(
        { workspaceId, recId: rec.id, reason: sendable.reason },
        'recommendation mirror skipped: adapter rejected the rec',
      );
      return { ok: true, skipped: true, reason: sendable.reason };
    }

    const built = adapter.buildPayload(input);
    const sourceRef = adapter.sourceRef(input);
    const nowIso = new Date().toISOString();

    const deliverable = upsertDeliverable({
      workspaceId,
      type: 'recommendation',
      kind: built.kind,
      // Send-time mirror: born awaiting_client (the client now has a decision to make).
      status: 'awaiting_client',
      title: built.title,
      summary: built.summary ?? null,
      payload: built.payload,
      externalRef: built.externalRef ?? null,
      parentDeliverableId: built.parentDeliverableId ?? null,
      sentAt: nowIso,
      generatedAt: nowIso,
      source: 'recommendation-mirror',
      sourceRef,
    });

    log.debug(
      { workspaceId, recId: rec.id, deliverableId: deliverable.id },
      'recommendation mirrored into client_deliverable (dual-write)',
    );
    // The unified client feed/inbox renders from the deliverables query and subscribes to
    // DELIVERABLE_SENT — required for the sent rec to appear live (Data Flow Rule #2). Reuses the
    // existing DELIVERABLE_SENT event (already has a frontend handler), so no new WS event.
    // Own try/catch: a transport failure must not poison the mirror result.
    try {
      broadcastToWorkspace(workspaceId, WS_EVENTS.DELIVERABLE_SENT, {
        deliverableId: deliverable.id,
        type: deliverable.type,
        status: deliverable.status,
      });
    } catch (broadcastErr) {
      log.warn(
        { err: broadcastErr, workspaceId, deliverableId: deliverable.id },
        'DELIVERABLE_SENT broadcast failed (swallowed)',
      );
    }
    return { ok: true, deliverableId: deliverable.id };
  } catch (err) {
    // Best-effort: the rec is already sent + the doorbell queued. A mirror failure must not
    // surface to the operator or roll back the live send — but it is NO LONGER swallowed silently.
    // The typed failure result flows back to the caller, which records a durable activity entry so
    // the divergence is observable (R4-PR1). This module still logs the Pino error for the trace.
    const error = err instanceof Error ? err.message : String(err);
    log.error({ err, workspaceId, recId: rec.id }, 'recommendation mirror failed (surfaced to caller)');
    return { ok: false, error };
  }
}
