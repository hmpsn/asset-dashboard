import type { RecType } from '../../../shared/types/recommendations.ts';
import type { ActionType } from '../../../shared/types/outcome-tracking.js';

/**
 * @internal exported for unit testing
 *
 * Maps a recommendation's `type` (+ `source`) to the {@link ActionType} its outcome is
 * tracked under. This mapping feeds `winRateByActionType` calibration, so a NEW `RecType`
 * that silently fell through to `audit_fix_applied` would distort calibration (G2). The
 * `switch` is therefore EXHAUSTIVE over `RecType`: the `never` assignment in `default`
 * makes adding a `RecType` to the union a COMPILE error until the author either gives it an
 * explicit outcome case here or consciously adds it to the audit-fix family below. This
 * compile-time guarantee is stronger than a pr-check rule and is the enforcement the
 * `docs/rules/seo-generation-quality.md` "new rec types" contract refers to for the
 * RecType→ActionType half (the source-category lockstep half is the pr-check rule).
 */
export function recommendationOutcomeActionType(type: RecType, source: string): ActionType {
  switch (type) {
    case 'content_refresh':
      return 'content_refreshed';
    case 'metadata':
      return 'meta_updated';
    case 'schema':
      return 'schema_deployed';
    case 'content':
      return 'content_published';
    case 'strategy':
      return source.startsWith('strategy:content-gap') ? 'content_published' : 'insight_acted_on';
    // ── SEO Gen-Quality P5 · first-class orphan-subsystem recs ──
    // Distinct ActionTypes (NOT the audit_fix_applied family) so winRateByActionType stays
    // honestly calibrated for each subsystem (the contract's "honest calibration" requirement).
    case 'keyword_gap':
    // P4 competitor send (Lane C) extends the RecType union with `competitor`; a competitor rec
    // succeeds when the competitor gap is closed — the same outcome as keyword_gap. Mapped here
    // so the union stays exhaustive.
    case 'competitor':
      return 'competitor_gap_closed';
    case 'topic_cluster':
      return 'cluster_published';
    case 'cannibalization':
      return 'cannibalization_resolved';
    // ── SEO Gen-Quality P7.1 · first-class local-visibility recs ──
    // Distinct ActionTypes (NOT audit_fix_applied) so winRateByActionType stays honestly
    // calibrated for the local subsystem. local_visibility (competitor-brand + not-visible)
    // wins when the business starts appearing in the pack; local_service_gap is "added" when
    // the previously-untargeted service term begins ranking.
    case 'local_visibility':
      return 'local_visibility_won';
    case 'local_service_gap':
      return 'local_service_added';
    case 'technical':
    case 'performance':
    case 'accessibility':
    case 'aeo':
      // Audit-fix family — these map to the generic audit_fix_applied outcome by design.
      // A new RecType must NOT silently join this family: add an explicit case above unless
      // it is genuinely an audit fix, in which case add it to this list deliberately.
      return 'audit_fix_applied';
    default: {
      const _exhaustive: never = type;
      void _exhaustive;
      return 'audit_fix_applied';
    }
  }
}
