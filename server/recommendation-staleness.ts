// server/recommendation-staleness.ts
// Strategy v3 (spec §4.5, §8) — the self-managing nudge engine for SENT recs.
// Flag-gated behind 'strategy-staleness-scan' (contract §10). Idempotent with NO
// persisted nudge state and NO migration (contract §0): the nudge array is derived
// fresh on every scan from clientStatus==='sent' + sentAt age; the admin-only
// rec_nudge_stale activity is deduplicated via the activity log. Mirrors the
// action_backlog_alert dedup pattern in outcome-crons.ts.

import type { Recommendation } from '../shared/types/recommendations.js';
import { createLogger } from './logger.js';
import { listWorkspaces } from './workspaces.js';
import { loadRecommendations } from './recommendations.js';
import { addActivity, countActivityByType, listActivityByType } from './activity-log.js';
import { isFeatureEnabled } from './feature-flags.js';
import { broadcastToWorkspace } from './broadcast.js';
import { WS_EVENTS } from './ws-events.js';

const log = createLogger('recommendation-staleness');

const DAY_MS = 24 * 60 * 60 * 1000;

/** A sent rec is "stale" once it has been waiting for a client decision this long. */
export const STALE_SENT_REC_THRESHOLD_DAYS = 14;

/** Dedup window for the nudge activity — matches the staleness cadence so a sent rec that
 *  stays stale across two daily ticks is not re-logged every day. */
const NUDGE_DEDUP_DAYS = STALE_SENT_REC_THRESHOLD_DAYS;

/** Read enough recent rec_nudge_stale rows to cover the dedup window. This LIMIT applies
 *  ONLY to rec_nudge_stale rows (listActivityByType is type-scoped), so unrelated high-volume
 *  activity (portal_session/content/audit) can never push a nudge row past the cap and cause a
 *  false "not deduped" → re-write every tick. 500 is comfortably above the max plausible
 *  nudges-per-window (one per sent rec per kind). */
const NUDGE_ACTIVITY_READ_LIMIT = 500;

/** The kinds of attention a sent rec can need. 'stale_sent' = no response past the
 *  threshold; 'superseded' = a newer active rec covers the same affected pages. */
export type RecNudgeKind = 'stale_sent' | 'superseded';

/** One derived nudge for a single rec — never persisted; recomputed each scan. */
export interface RecStalenessNudge {
  recId: string;
  title: string;
  nudgeKind: RecNudgeKind;
  ageDays: number;
}

export interface StalenessScanResult {
  workspacesScanned: number;
  nudgesWritten: number;
}

/**
 * Pure age classifier for a single rec. Returns a nudge ONLY when the rec is
 * clientStatus==='sent', has a sentAt, the client has NOT responded, and the wait
 * exceeds STALE_SENT_REC_THRESHOLD_DAYS. Deterministic — `now` is injected for tests.
 */
export function classifyStaleSentRec(
  rec: Pick<Recommendation, 'clientStatus' | 'sentAt'>,
  now: number = Date.now(),
): { nudgeKind: 'stale_sent'; ageDays: number } | null {
  if (rec.clientStatus !== 'sent') return null;
  if (!rec.sentAt) return null;
  const sentMs = Date.parse(rec.sentAt);
  if (!Number.isFinite(sentMs)) return null;
  const ageDays = Math.floor((now - sentMs) / DAY_MS);
  if (ageDays < STALE_SENT_REC_THRESHOLD_DAYS) return null;
  return { nudgeKind: 'stale_sent', ageDays };
}

/**
 * Derive every attention nudge for a workspace's rec set (pure — no DB, no persistence).
 * Two kinds: stale_sent (a sent rec past the threshold with no client response) and
 * superseded (a stale sent rec whose affectedPages overlap a NEWER active, not-yet-sent
 * rec — the new rec replaces the old ask). Recomputed each scan; never stored.
 */
export function scanWorkspaceStaleness(
  recs: Recommendation[],
  now: number = Date.now(),
): RecStalenessNudge[] {
  const nudges: RecStalenessNudge[] = [];

  for (const rec of recs) {
    const stale = classifyStaleSentRec(rec, now);
    if (!stale) continue;

    // Supersession: any NEWER rec that is active-and-uncurated (clientStatus 'system'|'curated',
    // not struck/throttled) covering at least one of this rec's affected pages.
    const recPages = new Set(rec.affectedPages ?? []);
    const superseded = recs.some(other => {
      if (other.id === rec.id) return false;
      if (other.clientStatus !== 'system' && other.clientStatus !== 'curated') return false;
      if (other.lifecycle === 'struck' || other.lifecycle === 'throttled') return false;
      const otherNewer = Date.parse(other.createdAt) > Date.parse(rec.sentAt!);
      if (!otherNewer) return false;
      return (other.affectedPages ?? []).some(p => recPages.has(p));
    });

    nudges.push({
      recId: rec.id,
      title: rec.title,
      nudgeKind: superseded ? 'superseded' : 'stale_sent',
      ageDays: stale.ageDays,
    });
  }

  return nudges;
}

/** Read recent rec_nudge_stale activities and project their metadata for exact dedup matching. */
function listRecentNudgeActivities(
  workspaceId: string,
  sinceMs: number,
): Array<{ recId: string; nudgeKind: RecNudgeKind }> {
  return listActivityByType(workspaceId, 'rec_nudge_stale', NUDGE_ACTIVITY_READ_LIMIT)
    .filter(a => Date.parse(a.createdAt) >= sinceMs)
    .map(a => {
      const meta = a.metadata as Record<string, unknown> | undefined;
      return {
        recId: String(meta?.recId ?? ''),
        nudgeKind: (meta?.nudgeKind ?? 'stale_sent') as RecNudgeKind,
      };
    });
}

/** True if an exact recId+nudgeKind nudge activity already exists within the dedup window.
 *  countActivityByType is type-coarse, so we read the recent rec_nudge_stale entries and match
 *  the metadata exactly — two distinct recs (or kinds) never collide, and a re-stale rec
 *  re-nudges once the window passes. */
function hasNudgeActivity(workspaceId: string, recId: string, nudgeKind: RecNudgeKind, now: number): boolean {
  // Fast path: if the workspace has no rec_nudge_stale activity at all in the window, skip the read.
  if (countActivityByType(workspaceId, 'rec_nudge_stale', NUDGE_DEDUP_DAYS) === 0) return false;
  const sinceMs = now - NUDGE_DEDUP_DAYS * DAY_MS;
  const recent = listRecentNudgeActivities(workspaceId, sinceMs);
  return recent.some(a => a.recId === recId && a.nudgeKind === nudgeKind);
}

/**
 * The self-managing nudge pass (spec §8). Flag-gated behind 'strategy-staleness-scan'.
 * For every workspace: derive its attention nudges via scanWorkspaceStaleness, and for each
 * NEW nudge (deduplicated on recId+nudgeKind within NUDGE_DEDUP_DAYS) write one admin-only
 * rec_nudge_stale activity and broadcast RECOMMENDATIONS_UPDATED so the cockpit's
 * "Needs your attention" strip refetches. NO persisted nudge state, NO migration (contract §0).
 */
export function runSentRecStalenessScan(now: number = Date.now()): StalenessScanResult {
  let workspacesScanned = 0;
  let nudgesWritten = 0;

  for (const ws of listWorkspaces()) {
    // Per-workspace flag check (multi-tenant rollout — staging-only until validated).
    if (!isFeatureEnabled('strategy-staleness-scan', ws.id)) continue;
    workspacesScanned++;

    const set = loadRecommendations(ws.id);
    if (!set || set.recommendations.length === 0) continue;

    const nudges = scanWorkspaceStaleness(set.recommendations as Recommendation[], now);
    if (nudges.length === 0) continue;

    let wroteForWorkspace = false;
    for (const nudge of nudges) {
      // Idempotent: skip if a rec_nudge_stale activity for THIS rec+kind already fired
      // within the dedup window.
      if (hasNudgeActivity(ws.id, nudge.recId, nudge.nudgeKind, now)) continue;

      addActivity(
        ws.id,
        'rec_nudge_stale',
        nudge.nudgeKind === 'superseded'
          ? `Sent recommendation superseded — "${nudge.title}"`
          : `Sent recommendation waiting ${nudge.ageDays}d — "${nudge.title}"`,
        nudge.nudgeKind === 'superseded'
          ? 'A newer recommendation covers the same pages. Consider striking or re-sending.'
          : `No client response in ${nudge.ageDays} days. Consider a nudge or throttle.`,
        { recId: nudge.recId, nudgeKind: nudge.nudgeKind, ageDays: nudge.ageDays },
      );
      nudgesWritten++;
      wroteForWorkspace = true;
    }

    if (wroteForWorkspace) {
      broadcastToWorkspace(ws.id, WS_EVENTS.RECOMMENDATIONS_UPDATED, { reason: 'staleness_scan' });
    }
  }

  log.info({ workspacesScanned, nudgesWritten }, 'Sent-rec staleness scan complete');
  return { workspacesScanned, nudgesWritten };
}

export { log as recStalenessLog };
