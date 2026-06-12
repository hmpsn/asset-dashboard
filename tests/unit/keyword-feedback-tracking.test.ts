import { describe, expect, it } from 'vitest';
import { trackedKeywordSourceForFeedback } from '../../server/keyword-feedback-tracking.js';
import { TRACKED_KEYWORD_SOURCE } from '../../shared/types/rank-tracking.js';

describe('trackedKeywordSourceForFeedback', () => {
  it('preserves genuinely non-client feedback origins in rank-tracking lifecycle metadata', () => {
    // These four are unchanged by Wave 3d-ii — they map to real, non-strategy,
    // non-client provenance labels.
    expect(trackedKeywordSourceForFeedback('content_gap')).toBe(TRACKED_KEYWORD_SOURCE.CONTENT_GAP);
    expect(trackedKeywordSourceForFeedback('keyword_gap')).toBe(TRACKED_KEYWORD_SOURCE.CONTENT_GAP);
    expect(trackedKeywordSourceForFeedback('opportunity')).toBe(TRACKED_KEYWORD_SOURCE.RECOMMENDATION);
    expect(trackedKeywordSourceForFeedback(undefined)).toBe(TRACKED_KEYWORD_SOURCE.CLIENT_REQUESTED);
  });

  it('DE-LAUNDER: page_map and topic_cluster approvals are CLIENT_REQUESTED, not STRATEGY_*', () => {
    // Wave 3d-ii: a client approving a page_map / topic_cluster keyword is a CLIENT
    // request. Mapping it to a STRATEGY_* source let reconcile force-deprecate it
    // (it reads ownership off the source enum) — silently destroying client data.
    expect(trackedKeywordSourceForFeedback('page_map')).toBe(TRACKED_KEYWORD_SOURCE.CLIENT_REQUESTED);
    expect(trackedKeywordSourceForFeedback('topic_cluster')).toBe(TRACKED_KEYWORD_SOURCE.CLIENT_REQUESTED);
  });

  it('regression: page_map / topic_cluster NEVER map to either STRATEGY_* source', () => {
    // Hard guard against re-laundering — the exact reintroduction hazard.
    for (const source of ['page_map', 'topic_cluster'] as const) {
      const mapped = trackedKeywordSourceForFeedback(source);
      expect(mapped).not.toBe(TRACKED_KEYWORD_SOURCE.STRATEGY_PRIMARY);
      expect(mapped).not.toBe(TRACKED_KEYWORD_SOURCE.STRATEGY_SITE_KEYWORD);
    }
  });
});
