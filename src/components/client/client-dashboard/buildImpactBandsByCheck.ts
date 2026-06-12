// ── Impact bands by audit check adapter ─────────────────────────
//
// Bridges the client-facing Recommendation array (R1-A lane, which carries
// `impactBand` projected by the server) to the `impactBandsByCheck` prop
// expected by HealthTab (R1-B lane), whose keys match AUDIT_CHECK_TO_FIX_TYPE.
//
// Field mapping:
//   rec.source follows the pattern `audit:<check>` or `audit:site-wide:<check>`
//   (built by RecSource.audit / RecSource.auditSiteWide in server/recommendations.ts).
//   Extracting the check name from source is the direct path — it gives us the
//   exact check string the HealthTab rows key against (e.g. 'title', 'structured-data').
//
//   Non-audit recs (source = 'strategy:...', 'decay:...', etc.) carry no check
//   identity relevant to the HealthTab, so they are silently skipped.
//
// Merge rule (multiple recs → same check):
//   Take the rec with the highest band (high > medium > low). When two recs share
//   the same band level, prefer the one with the larger upper bound of monthlyRangeUsd
//   (more impact shown rather than less). This is deliberately conservative: we
//   never fabricate a combined range by summing recs; we surface the single
//   strongest signal from the recommendation set.

import type { Recommendation } from '../../../../shared/types/recommendations.js';
import type { ImpactBand } from '../../../../shared/types/fix-catalog.js';

/** Ordinal for band level comparison (higher = better / wider). */
const BAND_RANK: Record<ImpactBand['band'], number> = {
  low: 0,
  medium: 1,
  high: 2,
};

/**
 * Extract the audit check name from a rec `source` string.
 * - `audit:title`           → `title`
 * - `audit:site-wide:canonical` → `canonical`
 * - anything else           → `null` (non-audit source, skip)
 */
function auditCheckFromSource(source: string): string | null {
  if (source.startsWith('audit:site-wide:')) {
    return source.slice('audit:site-wide:'.length) || null;
  }
  if (source.startsWith('audit:')) {
    return source.slice('audit:'.length) || null;
  }
  return null;
}

/**
 * Whether `next` dominates `existing` for the same check.
 * Returns true when next should replace existing in the map.
 */
function dominates(next: ImpactBand, existing: ImpactBand): boolean {
  const nextRank = BAND_RANK[next.band];
  const existingRank = BAND_RANK[existing.band];
  if (nextRank !== existingRank) return nextRank > existingRank;
  // Same band level: prefer the wider upper bound.
  const nextUpper = next.monthlyRangeUsd?.[1] ?? 0;
  const existingUpper = existing.monthlyRangeUsd?.[1] ?? 0;
  return nextUpper > existingUpper;
}

/**
 * Build a `Record<auditCheck, ImpactBand>` from the client-facing recommendation
 * array. Only recs with an `audit:` source prefix AND a populated `impactBand`
 * are included. When multiple recs map to the same check the highest band wins
 * (tie-broken by the larger `monthlyRangeUsd` upper bound).
 *
 * Returns an empty object when `recs` is empty or contains no audit-sourced
 * impacted recs — callers receive a defined (but empty) map and never need to
 * guard for undefined.
 */
export function buildImpactBandsByCheck(
  recs: Recommendation[],
): Record<string, ImpactBand> {
  const result: Record<string, ImpactBand> = {};

  for (const rec of recs) {
    if (!rec.impactBand) continue; // no impact data → skip

    const check = auditCheckFromSource(rec.source);
    if (!check) continue; // non-audit source → not relevant to HealthTab checks

    const existing = result[check];
    if (!existing || dominates(rec.impactBand, existing)) {
      result[check] = rec.impactBand;
    }
  }

  return result;
}
