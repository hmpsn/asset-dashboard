import { afterAll, describe, expect, it } from 'vitest';
import { keywordIdentityKeyV2 } from '../../shared/keyword-normalization.js';
import { buildKeywordCommandCenterReadProjection } from '../../server/domains/keyword-command-center/read-projection.js';
import { populateDraftRows } from '../../server/domains/keyword-command-center/read-model.js';
import type { DraftRow } from '../../server/domains/keyword-command-center/types.js';
import { upsertPageKeywordsBatch } from '../../server/page-keywords.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';

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

describe('Keyword Command Center monthly value projection', () => {
  const workspaceIds: string[] = [];

  afterAll(() => {
    for (const workspaceId of workspaceIds) deleteWorkspace(workspaceId);
  });

  it('returns null when page keywords carry no provider value evidence', () => {
    const workspace = createWorkspace('KCC Monthly Value Unavailable');
    workspaceIds.push(workspace.id);
    upsertPageKeywordsBatch(workspace.id, [{
      pagePath: '/services',
      pageTitle: 'Services',
      primaryKeyword: 'dental services',
      secondaryKeywords: [],
      clicks: 40,
    }]);

    const projection = buildKeywordCommandCenterReadProjection(workspace, { includeSummary: true });

    expect(projection.trafficValueMonthly).toBeNull();
  });

  it('returns null when every stored cpc is 0 (live rows store absent provider cpc as 0, not NULL)', () => {
    const workspace = createWorkspace('KCC Monthly Value Zero CPC');
    workspaceIds.push(workspace.id);
    upsertPageKeywordsBatch(workspace.id, [{
      pagePath: '/services',
      pageTitle: 'Services',
      primaryKeyword: 'dental services',
      secondaryKeywords: [],
      clicks: 40,
      cpc: 0,
    }]);

    const projection = buildKeywordCommandCenterReadProjection(workspace, { includeSummary: true });

    expect(projection.trafficValueMonthly).toBeNull();
  });

  it('returns the computed value when page keywords carry provider value evidence', () => {
    const workspace = createWorkspace('KCC Monthly Value Measured');
    workspaceIds.push(workspace.id);
    upsertPageKeywordsBatch(workspace.id, [{
      pagePath: '/services',
      pageTitle: 'Services',
      primaryKeyword: 'dental services',
      secondaryKeywords: [],
      clicks: 40,
      cpc: 2.5,
    }]);

    const projection = buildKeywordCommandCenterReadProjection(workspace, { includeSummary: true });

    expect(projection.trafficValueMonthly).toBe(100);
  });
});
