/**
 * Recommendation lifecycle predicates — the SINGLE source of truth, shared between server and client.
 *
 * These pure functions of a Recommendation were previously defined in server/recommendations.ts and
 * re-implemented inline on the client (the leak/drift bug pattern). They are extracted here so the
 * server projection, the admin cockpit, and the client feed all key off ONE implementation — and so
 * the admin "N staged · M already with client" counter can share its source with the server (the
 * numerator/denominator-share-a-source rule). server/recommendations.ts re-exports both for back-compat.
 */
import type { Recommendation } from './types/recommendations.js';

/**
 * The "active" (proposable/in-play for the operator) set. A rec is active iff:
 *   - RecStatus is not terminal (not completed, not dismissed), AND
 *   - it is not permanently struck, AND
 *   - it is not throttled into the future (throttle auto-resurfaces on-read once the date passes), AND
 *   - the client has not already received/resolved it (clientStatus not sent/approved/declined).
 * Absent v3 fields ⇒ legacy rec ⇒ treated as clientStatus:'system', lifecycle:'active'.
 * Imported by EVERY reader so no surface re-implements a partial filter (the leak bug pattern).
 */
export function isActiveRec(rec: Recommendation, now: number = Date.now()): boolean {
  if (rec.status === 'completed' || rec.status === 'dismissed') return false;
  if (rec.lifecycle === 'struck') return false;
  if (rec.lifecycle === 'throttled' && rec.throttledUntil && Date.parse(rec.throttledUntil) > now) return false;
  if (rec.clientStatus === 'sent' || rec.clientStatus === 'approved' || rec.clientStatus === 'declined') return false;
  return true;
}

/**
 * The Issue — the client-curated (client-seen) set (spec §16 / §7). A rec is "curated for the
 * client" iff the operator has sent it and it is not struck: clientStatus ∈ {sent, approved,
 * discussing}. Powers the client feed projection, the admin "what the client sees" preview, and
 * the loop strip. `declined` is excluded (the client said no).
 *
 * NOTE: this is NOT the complement of isActiveRec. They DELIBERATELY OVERLAP on `discussing` — a
 * discussing rec is both still-active for the operator (isActiveRec → true) AND visible to the
 * client (isCuratedForClient → true). Never assume isActiveRec(rec) === !isCuratedForClient(rec).
 * Imported by every reader of the curated set — never re-implement.
 */
export function isCuratedForClient(rec: Recommendation): boolean {
  if (rec.lifecycle === 'struck') return false;
  return rec.clientStatus === 'sent' || rec.clientStatus === 'approved' || rec.clientStatus === 'discussing';
}
