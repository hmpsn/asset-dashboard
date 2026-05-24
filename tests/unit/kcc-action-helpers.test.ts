import { describe, expect, it } from 'vitest';

import {
  KEYWORD_COMMAND_CENTER_ACTIONS,
  KEYWORD_COMMAND_CENTER_STATUS,
  type KeywordCommandCenterRow,
} from '../../shared/types/keyword-command-center.js';
import { summarizeBulkAction } from '../../src/components/keyword-command-center/kccActionHelpers.js';

function row(overrides: Partial<KeywordCommandCenterRow>): KeywordCommandCenterRow {
  return {
    keyword: 'keyword',
    normalizedKeyword: 'keyword',
    lifecycleStatus: KEYWORD_COMMAND_CENTER_STATUS.TRACKED,
    statusLabel: 'Tracked',
    sourceLabels: [],
    metrics: {},
    tracking: { status: 'active', source: 'recommendation' },
    nextActions: [],
    isProtected: false,
    ...overrides,
  };
}

describe('summarizeBulkAction', () => {
  it('flags protected rows for protection-sensitive actions', () => {
    const summary = summarizeBulkAction([
      row({ keyword: 'safe', normalizedKeyword: 'safe' }),
      row({ keyword: 'manual', normalizedKeyword: 'manual', isProtected: true }),
    ], KEYWORD_COMMAND_CENTER_ACTIONS.PAUSE_TRACKING);

    expect(summary.protectedCount).toBe(1);
    expect(summary.requiresConfirmation).toBe(true);
  });

  it('counts not-tracked rows for tracking-only lifecycle actions', () => {
    const summary = summarizeBulkAction([
      row({ keyword: 'tracked', normalizedKeyword: 'tracked' }),
      row({ keyword: 'idea', normalizedKeyword: 'idea', tracking: { status: 'not_tracked' } }),
    ], KEYWORD_COMMAND_CENTER_ACTIONS.RETIRE);

    expect(summary.notTrackedCount).toBe(1);
    expect(summary.keywords).toEqual(['tracked', 'idea']);
  });
});
