import { describe, expect, it } from 'vitest';
import { trackedKeywordSourceForFeedback } from '../../server/keyword-feedback-tracking.js';
import { TRACKED_KEYWORD_SOURCE } from '../../shared/types/rank-tracking.js';

describe('trackedKeywordSourceForFeedback', () => {
  it('preserves feedback origin in rank-tracking lifecycle metadata', () => {
    expect(trackedKeywordSourceForFeedback('content_gap')).toBe(TRACKED_KEYWORD_SOURCE.CONTENT_GAP);
    expect(trackedKeywordSourceForFeedback('keyword_gap')).toBe(TRACKED_KEYWORD_SOURCE.CONTENT_GAP);
    expect(trackedKeywordSourceForFeedback('opportunity')).toBe(TRACKED_KEYWORD_SOURCE.RECOMMENDATION);
    expect(trackedKeywordSourceForFeedback('page_map')).toBe(TRACKED_KEYWORD_SOURCE.STRATEGY_PRIMARY);
    expect(trackedKeywordSourceForFeedback('topic_cluster')).toBe(TRACKED_KEYWORD_SOURCE.STRATEGY_SITE_KEYWORD);
    expect(trackedKeywordSourceForFeedback(undefined)).toBe(TRACKED_KEYWORD_SOURCE.CLIENT_REQUESTED);
  });
});
