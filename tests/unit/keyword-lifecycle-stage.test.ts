import { describe, expect, it } from 'vitest';

import { deriveLifecycleStage } from '../../server/scoring/keyword-lifecycle-stage.js';
import {
  KEYWORD_COMMAND_CENTER_STATUS,
  KEYWORD_LIFECYCLE_STAGES,
  type KeywordCommandCenterRow,
} from '../../shared/types/keyword-command-center.js';
import { TRACKED_KEYWORD_SOURCE, TRACKED_KEYWORD_STATUS } from '../../shared/types/rank-tracking.js';

function makeRow(overrides: Partial<KeywordCommandCenterRow> = {}): KeywordCommandCenterRow {
  return {
    keyword: 'test keyword',
    normalizedKeyword: 'test keyword',
    lifecycleStatus: KEYWORD_COMMAND_CENTER_STATUS.RAW_EVIDENCE,
    statusLabel: 'Raw Evidence',
    sourceLabels: [],
    metrics: {},
    tracking: { status: 'not_tracked' },
    nextActions: [],
    isProtected: false,
    ...overrides,
  };
}

describe('deriveLifecycleStage', () => {
  it('buckets rows into all five lifecycle stages', () => {
    const publishedPaths = new Set(['/published-page']);

    expect(deriveLifecycleStage(makeRow({
      metrics: { currentPosition: 2 },
    }), publishedPaths)).toBe(KEYWORD_LIFECYCLE_STAGES.WINNING);

    expect(deriveLifecycleStage(makeRow({
      metrics: { currentPosition: 12 },
    }), publishedPaths)).toBe(KEYWORD_LIFECYCLE_STAGES.RANKING);

    expect(deriveLifecycleStage(makeRow({
      lifecycleStatus: KEYWORD_COMMAND_CENTER_STATUS.IN_STRATEGY,
      tracking: {
        status: TRACKED_KEYWORD_STATUS.ACTIVE,
        source: TRACKED_KEYWORD_SOURCE.STRATEGY_SITE_KEYWORD,
        pagePath: '/published-page',
      },
    }), publishedPaths)).toBe(KEYWORD_LIFECYCLE_STAGES.PUBLISHED);

    expect(deriveLifecycleStage(makeRow({
      lifecycleStatus: KEYWORD_COMMAND_CENTER_STATUS.IN_STRATEGY,
      tracking: {
        status: TRACKED_KEYWORD_STATUS.ACTIVE,
        source: TRACKED_KEYWORD_SOURCE.STRATEGY_SITE_KEYWORD,
        pagePath: '/unpublished-page',
      },
    }), publishedPaths)).toBe(KEYWORD_LIFECYCLE_STAGES.TARGETED);

    expect(deriveLifecycleStage(makeRow(), publishedPaths)).toBe(KEYWORD_LIFECYCLE_STAGES.DISCOVERED);
  });

  it('prioritizes actual ranking position over content state', () => {
    const publishedPaths = new Set(['/published-page']);
    const row = makeRow({
      lifecycleStatus: KEYWORD_COMMAND_CENTER_STATUS.IN_STRATEGY,
      metrics: { currentPosition: 11 },
      tracking: {
        status: TRACKED_KEYWORD_STATUS.ACTIVE,
        source: TRACKED_KEYWORD_SOURCE.STRATEGY_SITE_KEYWORD,
        pagePath: '/published-page',
      },
    });

    expect(deriveLifecycleStage(row, publishedPaths)).toBe(KEYWORD_LIFECYCLE_STAGES.RANKING);
  });

  it('normalizes assigned page paths before checking published content', () => {
    const row = makeRow({
      lifecycleStatus: KEYWORD_COMMAND_CENTER_STATUS.IN_STRATEGY,
      tracking: {
        status: TRACKED_KEYWORD_STATUS.ACTIVE,
        source: TRACKED_KEYWORD_SOURCE.STRATEGY_SITE_KEYWORD,
        pagePath: 'https://example.com/services/emergency-dentist?utm=ignore',
      },
    });

    expect(deriveLifecycleStage(row, new Set(['/services/emergency-dentist']))).toBe(KEYWORD_LIFECYCLE_STAGES.PUBLISHED);
  });
});
