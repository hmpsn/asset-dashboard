import { TRACKED_KEYWORD_SOURCE, type TrackedKeywordSource } from '../shared/types/rank-tracking.js';
import type { KeywordFeedbackBody } from './schemas/keyword-feedback.js';

type KeywordFeedbackSource = KeywordFeedbackBody['source'];

/**
 * Keep rank-tracking lifecycle metadata aligned with the surface that produced
 * the approved keyword feedback. Unknown or omitted feedback remains client-led.
 *
 * Wave 3d-ii DE-LAUNDER: page_map and topic_cluster feedback NO LONGER map to
 * STRATEGY_PRIMARY / STRATEGY_SITE_KEYWORD. A client approving a page_map or
 * topic_cluster keyword is a CLIENT request — laundering it into a STRATEGY_*
 * source caused reconcile (which used to read the source enum for ownership) to
 * force-deprecate it the moment it was not a current strategy target, silently
 * destroying client-requested data. These cases now fall through to the default
 * (CLIENT_REQUESTED, which is protected). Strategy OWNERSHIP is established only by
 * reconcile via the decoupled `strategyOwned` flag — never inferred from source.
 *
 * content_gap / keyword_gap → CONTENT_GAP and opportunity → RECOMMENDATION are
 * unchanged (those are genuinely non-strategy, non-client provenance labels).
 */
export function trackedKeywordSourceForFeedback(source: KeywordFeedbackSource | undefined): TrackedKeywordSource {
  switch (source) {
    case 'content_gap':
    case 'keyword_gap':
      return TRACKED_KEYWORD_SOURCE.CONTENT_GAP;
    case 'opportunity':
      return TRACKED_KEYWORD_SOURCE.RECOMMENDATION;
    // page_map and topic_cluster intentionally fall through to default
    // (CLIENT_REQUESTED) — see the DE-LAUNDER note above. Do NOT re-add
    // STRATEGY_* arms here; that reintroduces the destructive laundering bug.
    default:
      return TRACKED_KEYWORD_SOURCE.CLIENT_REQUESTED;
  }
}
