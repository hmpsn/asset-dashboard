// server/deliverable-divergence-sweep.ts
// Reconcile R4-PR1 — the READ-ONLY rec↔deliverable divergence sweep.
//
// The two-axis authority split keeps the recommendation triage/suppression axis and the
// client-delivery axis separate, with the DELIVERABLE SPINE as the authoritative record of
// client-delivery STATE. The dual-write + act-on mirror-sync now keep the two in lockstep going
// forward — but the audit named two divergence-BY-CONSTRUCTION paths that could already have
// produced drift, or could drift again if a mirror write silently fails:
//
//   1. act-on never advanced the mirror     → rec clientStatus 'approved'/'declined' while the
//                                              recommendation:<id> deliverable is still awaiting_client
//   2. deliverable respond never advanced the rec → the deliverable is decided (approved/declined)
//                                              while the rec is still 'sent'/'discussing'
//
// This sweep COMPARES the two and REPORTS the pairs that disagree. It is a pure detector: it MUTATES
// NOTHING (no upsert, no status write, no broadcast, no activity). Repair is a deliberate follow-up
// (the R4-PR2 DB trigger + the backfill/verify PR); making the sweep write would recreate exactly the
// silent, hard-to-audit reconciliation the two-axis split is trying to eliminate.
//
// Flag-gated per workspace behind 'strategy-divergence-sweep' (dark-launch, staging-first) — mirrors
// the runSentRecStalenessScan pattern in recommendation-staleness.ts. The dev DB has 0 sent recs and
// 0 rec mirrors locally, so the real-data behavior is only observable on staging (the flag-ON soak in
// the backfill/verify PR is load-bearing, not optional).

import type { Recommendation } from '../shared/types/recommendations.js';
import type { ClientDeliverable, DeliverableStatus } from '../shared/types/client-deliverable.js';
import { createLogger } from './logger.js';
import { listWorkspaces } from './workspaces.js';
import { loadRecommendations } from './recommendations.js';
import { findBySourceRef } from './client-deliverables.js';
import { isFeatureEnabled } from './feature-flags.js';
import { recommendationSourceRef } from './domains/inbox/recommendation-mirror-sync.js';

const log = createLogger('deliverable-divergence-sweep');

/** The rec clientStatus values that MUST have a matching client-delivery mirror. A rec that is only
 *  system/curated has not been sent, so no mirror is expected (its absence is NOT divergence). */
export type ClientResponseStatus = 'sent' | 'discussing' | 'approved' | 'declined';

const CLIENT_RESPONSE_STATUSES: ReadonlySet<string> = new Set<ClientResponseStatus>([
  'sent',
  'discussing',
  'approved',
  'declined',
]);

/** Why a rec↔mirror pair is flagged as divergent. */
export type DivergenceKind =
  /** rec has been sent/decided but NO recommendation:<id> mirror exists (mint never happened). */
  | 'missing_mirror'
  /** rec is decided (approved/declined) but the mirror is still awaiting_client (path #1: act-on
   *  never advanced the mirror). */
  | 'mirror_behind'
  /** the mirror is decided (approved/declined) but the rec is still sent/discussing (path #2:
   *  deliverable respond never advanced the rec). */
  | 'rec_behind'
  /** both sides are decided but DISAGREE (rec approved ↔ mirror declined, or vice-versa). */
  | 'decision_conflict';

/** One divergent rec↔deliverable pair. Read-only: carries the observed states, never a fix. */
export interface DivergentPair {
  workspaceId: string;
  recId: string;
  recClientStatus: ClientResponseStatus;
  /** The mirror's status, or null when no mirror row exists (missing_mirror). */
  mirrorStatus: DeliverableStatus | null;
  deliverableId: string | null;
  kind: DivergenceKind;
}

export interface DivergenceSweepResult {
  workspacesScanned: number;
  pairsChecked: number;
  divergentPairs: DivergentPair[];
}

/**
 * The canonical deliverable status a rec clientStatus is EXPECTED to mirror. Used to detect
 * disagreement. `sent`/`discussing` both map to the pre-decision `awaiting_client` hold; `approved`
 * and `declined` map to their terminal client-response counterparts.
 */
function expectedMirrorStatus(recClientStatus: ClientResponseStatus): DeliverableStatus {
  switch (recClientStatus) {
    case 'approved':
      return 'approved';
    case 'declined':
      return 'declined';
    case 'sent':
    case 'discussing':
      return 'awaiting_client';
  }
}

/**
 * Pure comparator for ONE rec against its (already-resolved) mirror. Returns a DivergentPair when the
 * two disagree, or null when they agree (or when the rec is not in a client-response state, so no
 * mirror is expected). Deterministic — no DB, no I/O. The mirror is passed in so this stays testable
 * and the sweep controls the read.
 */
export function classifyDivergence(
  workspaceId: string,
  rec: Pick<Recommendation, 'id' | 'clientStatus'>,
  mirror: Pick<ClientDeliverable, 'id' | 'status'> | null,
): DivergentPair | null {
  const recClientStatus = rec.clientStatus;
  if (!recClientStatus || !CLIENT_RESPONSE_STATUSES.has(recClientStatus)) return null;
  const rcs = recClientStatus as ClientResponseStatus;

  // A sent/decided rec with no mirror at all — the mint never happened (or a pre-dual-write rec).
  if (!mirror) {
    return {
      workspaceId,
      recId: rec.id,
      recClientStatus: rcs,
      mirrorStatus: null,
      deliverableId: null,
      kind: 'missing_mirror',
    };
  }

  const expected = expectedMirrorStatus(rcs);
  if (mirror.status === expected) return null; // agree — not divergent

  // They disagree — classify the direction.
  const recDecided = rcs === 'approved' || rcs === 'declined';
  const mirrorDecided = mirror.status === 'approved' || mirror.status === 'declined';

  let kind: DivergenceKind;
  if (recDecided && !mirrorDecided) {
    // rec approved/declined, mirror still awaiting_client (or changes_requested/partial) — path #1.
    kind = 'mirror_behind';
  } else if (!recDecided && mirrorDecided) {
    // rec still sent/discussing, mirror already approved/declined — path #2.
    kind = 'rec_behind';
  } else if (recDecided && mirrorDecided) {
    // both decided but to DIFFERENT outcomes (approved ↔ declined) — a genuine conflict.
    kind = 'decision_conflict';
  } else {
    // Neither decided yet the statuses differ (e.g. rec 'sent' but mirror 'changes_requested').
    // Treat as mirror ahead of the rec's pre-decision hold — surface as rec_behind for follow-up.
    kind = 'rec_behind';
  }

  return {
    workspaceId,
    recId: rec.id,
    recClientStatus: rcs,
    mirrorStatus: mirror.status,
    deliverableId: mirror.id,
    kind,
  };
}

/**
 * Scan ONE workspace's rec set against its deliverable mirrors. Read-only: resolves each sent/decided
 * rec's recommendation:<id> mirror via findBySourceRef and classifies disagreement. Returns the
 * divergent pairs + the number of client-response recs checked. Mutates nothing.
 */
export function sweepWorkspaceDivergence(workspaceId: string): {
  pairsChecked: number;
  divergentPairs: DivergentPair[];
} {
  const set = loadRecommendations(workspaceId);
  if (!set || set.recommendations.length === 0) {
    return { pairsChecked: 0, divergentPairs: [] };
  }

  let pairsChecked = 0;
  const divergentPairs: DivergentPair[] = [];

  for (const rec of set.recommendations) {
    if (!rec.clientStatus || !CLIENT_RESPONSE_STATUSES.has(rec.clientStatus)) continue;
    pairsChecked++;
    const mirror = findBySourceRef(workspaceId, 'recommendation', recommendationSourceRef(rec.id));
    const divergence = classifyDivergence(workspaceId, rec, mirror);
    if (divergence) divergentPairs.push(divergence);
  }

  return { pairsChecked, divergentPairs };
}

/**
 * The read-only divergence sweep pass (R4-PR1). Flag-gated per workspace behind
 * 'strategy-divergence-sweep'. For every enabled workspace, compare rec clientStatus against the
 * recommendation:<id> deliverable mirror and collect the pairs that disagree. It writes a Pino
 * warning per divergent pair (observability for the staging soak) but MUTATES NOTHING — no repair,
 * no broadcast, no activity. Returns the full divergent-pair report.
 */
export function runDeliverableDivergenceSweep(): DivergenceSweepResult {
  let workspacesScanned = 0;
  let pairsChecked = 0;
  const divergentPairs: DivergentPair[] = [];

  for (const ws of listWorkspaces()) {
    // Per-workspace flag check (dark-launch, staging-only until validated).
    if (!isFeatureEnabled('strategy-divergence-sweep', ws.id)) continue;
    workspacesScanned++;

    const { pairsChecked: checked, divergentPairs: pairs } = sweepWorkspaceDivergence(ws.id);
    pairsChecked += checked;
    for (const pair of pairs) {
      divergentPairs.push(pair);
      log.warn(
        {
          workspaceId: pair.workspaceId,
          recId: pair.recId,
          recClientStatus: pair.recClientStatus,
          mirrorStatus: pair.mirrorStatus,
          deliverableId: pair.deliverableId,
          kind: pair.kind,
        },
        'rec↔deliverable divergence detected (read-only report — no mutation)',
      );
    }
  }

  log.info(
    { workspacesScanned, pairsChecked, divergentPairs: divergentPairs.length },
    'Deliverable divergence sweep complete',
  );
  return { workspacesScanned, pairsChecked, divergentPairs };
}
