import { TRACKED_KEYWORD_SOURCE, type TrackedKeywordSource } from '../shared/types/rank-tracking.js';
import type { KeywordFeedbackBody } from './schemas/keyword-feedback.js';

type KeywordFeedbackSource = KeywordFeedbackBody['source'];

/**
 * Keep rank-tracking lifecycle metadata aligned with the surface that produced
 * the approved keyword feedback. Unknown or omitted feedback remains client-led.
 */
export function trackedKeywordSourceForFeedback(source: KeywordFeedbackSource | undefined): TrackedKeywordSource {
  switch (source) {
    case 'content_gap':
    case 'keyword_gap':
      return TRACKED_KEYWORD_SOURCE.CONTENT_GAP;
    case 'opportunity':
      return TRACKED_KEYWORD_SOURCE.RECOMMENDATION;
    case 'page_map':
      return TRACKED_KEYWORD_SOURCE.STRATEGY_PRIMARY;
    case 'topic_cluster':
      return TRACKED_KEYWORD_SOURCE.STRATEGY_SITE_KEYWORD;
    default:
      return TRACKED_KEYWORD_SOURCE.CLIENT_REQUESTED;
  }
}
