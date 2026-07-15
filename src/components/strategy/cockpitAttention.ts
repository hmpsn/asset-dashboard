// Client mirror of server/recommendation-staleness.ts scanWorkspaceStaleness (+ new_reply). The server
// module is the authority but is server-only; keep these predicates in lockstep. Same brittleness class
// as isActiveRec — fast-follow: extract pure predicates to shared/.

import type { Recommendation } from '../../../shared/types/recommendations';
import type { AttentionItem, AttentionKind } from './NeedsAttentionStrip';

const DAY_MS = 24 * 60 * 60 * 1000;

/** A sent rec is "stale" once it has waited this long for a client decision. Mirrors the server's
 *  STALE_SENT_REC_THRESHOLD_DAYS. */
const STALE_SENT_REC_THRESHOLD_DAYS = 14;

/**
 * Pure age classifier for a single rec — mirrors classifyStaleSentRec on the server. Returns the
 * stale-sent age (in whole days) ONLY when the rec is clientStatus==='sent', has a parseable sentAt,
 * and the wait meets the threshold. `now` is injected for tests.
 */
function classifyStaleSentRec(
  rec: Pick<Recommendation, 'clientStatus' | 'sentAt'>,
  now: number,
): { ageDays: number } | null {
  if (rec.clientStatus !== 'sent') return null;
  if (!rec.sentAt) return null;
  const sentMs = Date.parse(rec.sentAt);
  if (!Number.isFinite(sentMs)) return null;
  const ageDays = Math.floor((now - sentMs) / DAY_MS);
  if (ageDays < STALE_SENT_REC_THRESHOLD_DAYS) return null;
  return { ageDays };
}

/**
 * Find the first affected page of `rec` also covered by a NEWER active-and-uncurated rec — mirrors
 * the server's supersession predicate (other.clientStatus 'system'|'curated', not struck/throttled,
 * createdAt newer than rec.sentAt, affectedPages overlap). Returns the first overlapping page, or
 * null when no rec supersedes this one.
 */
function firstSupersedingPage(rec: Recommendation, recs: Recommendation[]): string | null {
  const recPages = new Set(rec.affectedPages ?? []);
  const sentMs = Date.parse(rec.sentAt ?? '');
  if (!Number.isFinite(sentMs)) return null;

  for (const other of recs) {
    if (other.id === rec.id) continue;
    if (other.clientStatus !== 'system' && other.clientStatus !== 'curated') continue;
    if (other.lifecycle === 'struck' || other.lifecycle === 'throttled') continue;
    if (!(Date.parse(other.createdAt) > sentMs)) continue;
    const overlap = (other.affectedPages ?? []).find((p) => recPages.has(p));
    if (overlap) return overlap;
  }
  return null;
}

/**
 * Derive the cockpit's "Needs your attention" items from the rec set (pure — no DB, no persistence).
 * Three kinds, in the same precedence the server uses for sent recs:
 *  - superseded — a stale_sent rec whose affected pages are now covered by a newer active/uncurated rec.
 *  - stale_sent — a sent rec past the threshold with no client response and no supersession.
 *  - new_reply  — UI-only (the server scan does not emit this): every rec the client is discussing.
 * `now` is injected for tests (defaults to Date.now()).
 */
export function buildAttentionItems(recs: Recommendation[], now: number = Date.now()): AttentionItem[] {
  const items: AttentionItem[] = [];

  for (const rec of recs) {
    const stale = classifyStaleSentRec(rec, now);
    if (!stale) continue;

    const supersedingPage = firstSupersedingPage(rec, recs);
    if (supersedingPage !== null) {
      items.push({
        recId: rec.id,
        title: rec.title,
        kind: 'superseded' satisfies AttentionKind,
        detail: `A newer recommendation now covers ${supersedingPage || 'the same pages'}`,
      });
    } else {
      items.push({
        recId: rec.id,
        title: rec.title,
        kind: 'stale_sent' satisfies AttentionKind,
        detail: `No client response in ${stale.ageDays} days`,
      });
    }
  }

  for (const rec of recs) {
    if (rec.clientStatus !== 'discussing') continue;
    items.push({
      recId: rec.id,
      title: rec.title,
      kind: 'new_reply' satisfies AttentionKind,
      detail: 'Client discussion is active on this move',
    });
  }

  return items;
}

/** Count of recs currently live-sent to the client (clientStatus 'sent', excluding any since
 *  throttled-open) — drives the CurationMeter "N sent" nudge. Excludes throttled-open sent recs
 *  so the meter agrees with the cockpit's 'sent' lifecycle-tab count: partitionByLifecycle
 *  reclassifies a throttled-open sent rec under 'throttled' (its isThrottledOpen check runs
 *  first), so counting all 'sent' here would overshoot the tab. `now` injected for tests. */
export function countSentThisCycle(recs: Recommendation[], now: number = Date.now()): number {
  return recs.filter(
    (r) =>
      r.clientStatus === 'sent' &&
      // throttled-open mirror of cockpitRowModel.isThrottledOpen (kept inline to stay deterministic via `now`)
      !(r.lifecycle === 'throttled' && r.throttledUntil != null && Date.parse(r.throttledUntil) > now),
  ).length;
}
