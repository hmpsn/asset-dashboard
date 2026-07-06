import { afterAll, describe, expect, it } from 'vitest';

import { buildKeywordCommandCenterRows } from '../../server/keyword-command-center.js';
import { addTrackedKeyword } from '../../server/rank-tracking.js';
import { computeKeywordValueScore } from '../../server/scoring/keyword-value-score.js';
import { buildKeywordValueScoringContext } from '../../server/scoring/keyword-value-context.js';
import { createWorkspace, deleteWorkspace, getWorkspace } from '../../server/workspaces.js';
import { keywordComparisonKey } from '../../shared/keyword-normalization.js';
import { TRACKED_KEYWORD_SOURCE } from '../../shared/types/rank-tracking.js';

describe('Keyword Command Center opportunity score row contract', () => {
  const workspaceId = createWorkspace('KCC Opportunity Score Contract').id;

  afterAll(() => {
    deleteWorkspace(workspaceId);
  });

  it('serializes the server-computed opportunityScore on scored /rows entries and omits it when unscored', async () => {
    const scoredKeyword = 'Emergency dentist chicago';
    const unscoredKeyword = 'Unscored placeholder keyword';

    addTrackedKeyword(workspaceId, scoredKeyword, {
      source: TRACKED_KEYWORD_SOURCE.MANUAL,
      volume: 700,
      difficulty: 22,
      cpc: 11,
      intent: 'commercial',
    });
    addTrackedKeyword(workspaceId, unscoredKeyword, {
      source: TRACKED_KEYWORD_SOURCE.MANUAL,
    });

    const workspace = getWorkspace(workspaceId);
    expect(workspace).not.toBeNull();
    const expectedScore = computeKeywordValueScore({
      keyword: scoredKeyword,
      volume: 700,
      difficulty: 22,
      cpc: 11,
      intent: 'commercial',
    }, buildKeywordValueScoringContext(workspace!));
    expect(expectedScore).toEqual(expect.any(Number));

    const response = await buildKeywordCommandCenterRows(workspaceId, {
      page: 1,
      pageSize: 10,
      sort: 'keyword',
    });

    expect(response).not.toBeNull();
    const scoredRow = response!.rows.find(row => row.normalizedKeyword === keywordComparisonKey(scoredKeyword));
    const unscoredRow = response!.rows.find(row => row.normalizedKeyword === keywordComparisonKey(unscoredKeyword));

    expect(scoredRow).toEqual(expect.objectContaining({
      normalizedKeyword: keywordComparisonKey(scoredKeyword),
      opportunityScore: expectedScore,
    }));
    expect(unscoredRow).toEqual(expect.objectContaining({
      normalizedKeyword: keywordComparisonKey(unscoredKeyword),
    }));
    expect(Object.prototype.hasOwnProperty.call(unscoredRow, 'opportunityScore')).toBe(false);
  });
});
