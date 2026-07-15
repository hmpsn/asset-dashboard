import { describe, expect, it } from 'vitest';
import { keywordIdentityKeyV2 } from '../../shared/keyword-normalization.js';
import { populateDraftRows } from '../../server/domains/keyword-command-center/read-model.js';
import type { DraftRow } from '../../server/domains/keyword-command-center/types.js';

describe('Keyword Command Center v2 read model', () => {
  it('keeps site-only C, C#, and C++ metrics in distinct rows', async () => {
    const rows = new Map<string, DraftRow>();
    await populateDraftRows(rows, {
      workspaceId: 'v2-site-only-read-model',
      strategy: {
        siteKeywords: ['C', 'C#', 'C++'],
        siteKeywordMetrics: [
          { keyword: 'C', volume: 100, difficulty: 10 },
          { keyword: 'C#', volume: 200, difficulty: 20 },
          { keyword: 'C++', volume: 300, difficulty: 30 },
        ],
        opportunities: [],
        generatedAt: '2026-07-13T12:00:00.000Z',
      },
      pageMap: [],
      contentGaps: [],
      keywordGaps: [],
      trackedKeywords: [],
      latestRanks: [],
      feedback: new Map(),
      includeStrategyUx: false,
    });

    const exactRows = new Map([...new Set(rows.values())].map(row => [keywordIdentityKeyV2(row.keyword), row]));

    expect(exactRows.get(keywordIdentityKeyV2('C'))).toMatchObject({
      keyword: 'C',
      metrics: { volume: 100, difficulty: 10 },
    });
    expect(exactRows.get(keywordIdentityKeyV2('C#'))).toMatchObject({
      keyword: 'C#',
      metrics: { volume: 200, difficulty: 20 },
    });
    expect(exactRows.get(keywordIdentityKeyV2('C++'))).toMatchObject({
      keyword: 'C++',
      metrics: { volume: 300, difficulty: 30 },
    });
  });
});
