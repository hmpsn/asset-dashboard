/**
 * Strategy v3 (spec §6.2) — the SINGLE WRITER for the recommendation
 * client-facing lifecycle axis. All clientStatus / lifecycle mutations go through here so
 * the trust-critical invariant holds: strike/throttle/send NEVER write RecStatus.
 *
 * Each lifecycle mutation:
 *   1. opens a db.transaction() (atomic — no AI-call-before-write, all synchronous)
 *   2. re-reads the set INSIDE the txn (not a stale route copy)
 *   3. applies the single-field delta + (where applicable) a state-machine validateTransition guard
 *   4. recomputes the summary (so a sent/struck rec drops out of topRecommendationId)
 *   5. upserts via saveRecommendations
 *
 * Routing per RecType is decided by REC_POLICY_REGISTRY (sendChannel rec|deliverable).
 *
 * Concurrency: the regen scheduler's per-workspace single-flight (server/recommendation-regen-
 * scheduler.ts `runRecommendationRegen`) serializes the long-running regen. Lifecycle mutations
 * are short *synchronous* row-level read-modify-write txns, so the better-sqlite3 transaction itself
 * is the atomicity guard (it re-reads the freshest recommendation rows inside the txn, never a stale
 * route copy) — a regen that commits between a route read and this write cannot be clobbered
 * (spec §6.2).
 */
import {
  computeRecommendationSummary,
  updateRecommendationStatus,
} from './recommendations.js';
import { mutateRecommendationItem } from './domains/recommendations/storage.js';
import { validateTransition, RECOMMENDATION_TRANSITIONS, CLIENT_REC_TRANSITIONS } from './state-machines.js';
import { creditArchetypeCycleOnSend } from './strategy-autosend-store.js';
import { createLogger } from './logger.js';
import type { Recommendation, RecPolicyRegistry } from '../shared/types/recommendations.js';

const log = createLogger('recommendation-lifecycle');

/** Per-RecType curation policy (spec §6.2). content_decay/cannibalization route Send to the
 *  deliverable spine; everything else mutates clientStatus directly. keyword/topic strikes cascade
 *  (remove strategy items). An unlisted RecType cannot be curated until a policy is registered. */
export const REC_POLICY_REGISTRY: RecPolicyRegistry = {
  technical:        { sendChannel: 'rec', cascadeOnStrike: false, monetizable: false },
  content:          { sendChannel: 'rec', cascadeOnStrike: false, monetizable: true },
  content_refresh:  { sendChannel: 'rec', cascadeOnStrike: false, monetizable: true },
  schema:           { sendChannel: 'rec', cascadeOnStrike: false, monetizable: true },
  metadata:         { sendChannel: 'rec', cascadeOnStrike: false, monetizable: false },
  performance:      { sendChannel: 'rec', cascadeOnStrike: false, monetizable: false },
  accessibility:    { sendChannel: 'rec', cascadeOnStrike: false, monetizable: true },
  strategy:         { sendChannel: 'rec', cascadeOnStrike: false, monetizable: false },
  aeo:              { sendChannel: 'rec', cascadeOnStrike: false, monetizable: false },
  keyword_gap:      { sendChannel: 'rec', cascadeOnStrike: true,  monetizable: false },
  topic_cluster:    { sendChannel: 'rec', cascadeOnStrike: true,  monetizable: false },
  cannibalization:  { sendChannel: 'deliverable', cascadeOnStrike: false, monetizable: false },
  local_visibility: { sendChannel: 'rec', cascadeOnStrike: false, monetizable: false },
  local_service_gap:{ sendChannel: 'rec', cascadeOnStrike: false, monetizable: false },
  competitor:        { sendChannel: 'rec', cascadeOnStrike: false, monetizable: false },
};

/** Run a lifecycle mutation transactionally: re-read inside the txn, mutate the matched rec,
 *  recompute summary, persist. Returns the mutated rec (or null when the rec id is absent).
 *  The `apply` callback mutates ONLY the lifecycle axis — it must never touch `rec.status`. */
function mutateRec(
  workspaceId: string,
  recId: string,
  apply: (rec: Recommendation) => void,
): Recommendation | null {
  return mutateRecommendationItem(workspaceId, recId, apply, computeRecommendationSummary);
}

/** Send a curated rec to the client (clientStatus: curated → sent). Validates the operator
 *  curation edge and stamps sentAt + the policy's sendChannel. NEVER writes RecStatus. Throws
 *  InvalidTransitionError on an illegal edge (e.g. a rec already approved/declined). The caller
 *  (P2 route) handles the deliverable-spine branch for sendChannel==='deliverable' RecTypes
 *  before reaching here. Returns null when the rec id is absent. */
export function sendRecommendation(workspaceId: string, recId: string): Recommendation | null {
  const sent = mutateRec(workspaceId, recId, (rec) => {
    const from = rec.clientStatus ?? 'system';
    // curated→sent is the blessed edge; allow system→sent (operator skips the curate step) by
    // first validating system→curated then curated→sent, mirroring the two-edge path. An
    // already-sent/approved/declined rec has no outbound 'sent' edge → InvalidTransitionError.
    if (from === 'system') validateTransition('recommendation', RECOMMENDATION_TRANSITIONS, 'system', 'curated');
    validateTransition('recommendation', RECOMMENDATION_TRANSITIONS, from === 'system' ? 'curated' : from, 'sent');
    rec.clientStatus = 'sent';
    rec.sentAt = new Date().toISOString();
    // Stamp the routing channel from the policy so downstream readers know where this Send went.
    const policy = REC_POLICY_REGISTRY[rec.type];
    rec.sendChannel = policy?.sendChannel ?? 'rec';
  });
  // Trust-ladder cycle credit (The Issue Phase 4). The SINGLE chokepoint covering every send —
  // manual AND the cron's auto-send. Fires only after the send txn committed (sent !== null). The
  // helper is flag-guarded internally (a full no-op when strategy-the-issue is off), only credits
  // the two eligible archetypes, dedupes once-per-ISO-week, and NEVER throws into the send.
  if (sent) creditArchetypeCycleOnSend(workspaceId, sent.type);
  return sent;
}

/** The Issue Phase 4 — stamp `autoSent=true` on a rec the trust-ladder cron just auto-sent.
 *  Transactional via mutateRec (re-reads the set INSIDE the txn), so it cannot clobber a concurrent
 *  regen — the SAME single-writer guard that protects clientStatus. Without this the cron's plain
 *  load→mutate→save would lose the autoSent stamp (or clobber a regen) on an interleave. Pure
 *  bookkeeping: does NOT re-credit the cycle (sendRecommendation already did) and NEVER writes
 *  RecStatus. Returns the updated rec, or null when the rec id is absent. */
export function markRecommendationAutoSent(workspaceId: string, recId: string): Recommendation | null {
  return mutateRec(workspaceId, recId, (rec) => {
    rec.autoSent = true;
  });
}

/** Approve a sent rec on the CLIENT-side response axis (clientStatus: sent|discussing → approved).
 *  The single writer for the client "Act on this" greenlight (Strategy "The Issue" §7 half-loop #2).
 *  Validates ONLY against CLIENT_REC_TRANSITIONS (the client response axis) and mutates ONLY
 *  clientStatus — NEVER RecStatus, NEVER the operator curation axis. Throws InvalidTransitionError
 *  on an illegal edge (e.g. a rec the client already declined, or one never sent). Returns null when
 *  the rec id is absent. The route owns the durable content-request creation + the attribution
 *  TrackedAction; this writer only flips the client status. */
export function approveRecommendation(workspaceId: string, recId: string): Recommendation | null {
  return mutateRec(workspaceId, recId, (rec) => {
    const from = rec.clientStatus ?? 'system';
    // Only a sent/discussing rec can be approved by the client. CLIENT_REC_TRANSITIONS rejects
    // system/curated/approved/declined → approved (an un-sent or already-decided rec).
    validateTransition('recommendation_client', CLIENT_REC_TRANSITIONS, from, 'approved');
    rec.clientStatus = 'approved';
  });
}

/** Strike a rec — permanent suppression on the lifecycle axis (active → struck). Arm-then-confirm
 *  + Undo live in the UI (P2); this is the commit. NEVER writes RecStatus. Idempotent: a re-strike
 *  on an already-struck rec is a no-op that returns the struck rec (struckAt unchanged). cascade
 *  metadata is passed by the caller for keyword/topic strikes that also remove strategy items. */
export function strikeRecommendation(
  workspaceId: string,
  recId: string,
  cascade?: Recommendation['cascade'],
): Recommendation | null {
  return mutateRec(workspaceId, recId, (rec) => {
    if (rec.lifecycle === 'struck') return; // idempotent re-strike — keep the original struckAt
    rec.lifecycle = 'struck';
    rec.struckAt = new Date().toISOString();
    if (cascade) rec.cascade = cascade;
  });
}

/** Undo a strike (lifecycle: struck → active). Restores the rec to active and clears the
 *  suppression metadata. NEVER writes RecStatus. When the strike carried a reversible cascade,
 *  the actual strategy-item restore is performed by the cascade-owning strategy store at the
 *  route layer (P5) — this writer clears the lifecycle axis (the cascade payload it reads). */
export function unstrikeRecommendation(workspaceId: string, recId: string): Recommendation | null {
  return mutateRec(workspaceId, recId, (rec) => {
    rec.lifecycle = 'active';
    delete rec.throttledUntil;
    delete rec.struckAt;
    delete rec.cascade;
  });
}

/** Throttle a rec for N days (lifecycle: active → throttled). Sets throttledUntil = now + days;
 *  the rec auto-resurfaces on-read once the date passes (isActiveRec handles it — no cron).
 *  NEVER writes RecStatus. days is the curated 7/30/90 set (route validates the input). */
export function throttleRecommendation(
  workspaceId: string,
  recId: string,
  days: 7 | 30 | 90,
): Recommendation | null {
  return mutateRec(workspaceId, recId, (rec) => {
    rec.lifecycle = 'throttled';
    rec.throttledUntil = new Date(Date.now() + days * 86_400_000).toISOString();
  });
}

/** Fix — mark the rec as agency-executed work via the EXISTING RecStatus completion path
 *  (pending|in_progress → completed, state-machine guarded inside updateRecommendationStatus,
 *  which performs its own read-modify-write + summary recompute). Distinct from Send: this is
 *  "we'll do it ourselves" on the internal triage axis, NOT a client-facing clientStatus change.
 *  Returns the updated rec, or null when the rec id is absent. */
export function fixRecommendation(workspaceId: string, recId: string): Recommendation | null {
  return updateRecommendationStatus(workspaceId, recId, 'completed');
}

log.debug('recommendation-lifecycle single-writer loaded');
