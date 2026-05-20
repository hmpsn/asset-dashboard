import { describe, expect, it } from 'vitest';

import { processContentPlan } from '../../src/hooks/client/useClientQueries';

describe('processContentPlan keyword equality', () => {
  it('stores content plan keyword status by canonical key while preserving cell display data', () => {
    const result = processContentPlan([{
      id: 'matrix_1',
      workspaceId: 'ws_1',
      name: 'Q2 plan',
      cells: [{
        id: 'cell_1',
        contentMatrixId: 'matrix_1',
        targetKeyword: 'SEO Audit Tool - Near-Me',
        status: 'approved',
        sortOrder: 0,
        createdAt: '2026-05-20T00:00:00.000Z',
        updatedAt: '2026-05-20T00:00:00.000Z',
      }],
      createdAt: '2026-05-20T00:00:00.000Z',
      updatedAt: '2026-05-20T00:00:00.000Z',
    }]);

    expect(result.keywords.get('seo audit tool near me')).toBe('approved');
    expect(result.keywords.get('seo audit tool - near-me')).toBeUndefined();
  });
});
