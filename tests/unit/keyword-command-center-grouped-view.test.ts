import { afterEach, describe, expect, it } from 'vitest';

import { buildKeywordCommandCenterGroupedView } from '../../server/keyword-command-center.js';
import { upsertPageKeywordsBatch } from '../../server/page-keywords.js';
import { storeRankSnapshot } from '../../server/rank-tracking.js';
import { replaceAllTopicClusters } from '../../server/topic-clusters.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';

describe('Keyword Command Center grouped view', () => {
  const cleanup = new Set<string>();

  afterEach(() => {
    for (const workspaceId of cleanup) deleteWorkspace(workspaceId);
    cleanup.clear();
  });

  it('groups every matching skinny row beyond the 100-row list page cap with server rollups', async () => {
    const workspace = createWorkspace(`KCC grouped page ${Date.now()}`);
    cleanup.add(workspace.id);
    const keywords = Array.from({ length: 105 }, (_, index) => `service keyword ${index + 1}`);

    upsertPageKeywordsBatch(workspace.id, [{
      pagePath: '/services',
      pageTitle: 'Services',
      primaryKeyword: keywords[0],
      secondaryKeywords: keywords.slice(1),
      topicCluster: 'Services cluster',
    }]);
    replaceAllTopicClusters(workspace.id, [{
      topic: 'Services cluster',
      keywords,
      ownedCount: 105,
      totalCount: 105,
      coveragePercent: 100,
      gap: [],
    }]);
    storeRankSnapshot(workspace.id, '2026-07-10', keywords.map((query, index) => ({
      query,
      position: index + 1,
      clicks: 2,
      impressions: 10,
      ctr: 20,
    })));

    const grouped = await buildKeywordCommandCenterGroupedView(workspace.id, {
      groupBy: 'page',
      filter: 'all',
      sort: 'keyword',
      direction: 'asc',
    });

    expect(grouped?.totalRows).toBe(105);
    expect(grouped?.groups).toHaveLength(1);
    expect(grouped?.groups[0]).toMatchObject({
      id: '/services',
      title: 'Services',
      rollup: {
        keywordCount: 105,
        clicks: 210,
        impressions: 1050,
      },
    });
    expect(grouped?.groups[0].rows).toHaveLength(105);
    expect(grouped?.groups[0].rollup.averagePosition).toBeCloseTo(53);
  });

  it('groups cluster membership and lifecycle counts on the server without client averages', async () => {
    const workspace = createWorkspace(`KCC grouped variants ${Date.now()}`);
    cleanup.add(workspace.id);
    upsertPageKeywordsBatch(workspace.id, [{
      pagePath: '/implants',
      pageTitle: 'Implants',
      primaryKeyword: 'dental implants',
      secondaryKeywords: ['implant dentist'],
      topicCluster: 'Implants cluster',
    }]);
    replaceAllTopicClusters(workspace.id, [{
      topic: 'Implants cluster',
      keywords: ['dental implants', 'implant dentist'],
      ownedCount: 2,
      totalCount: 3,
      coveragePercent: 67,
      gap: ['implant cost'],
    }]);

    const clusterView = await buildKeywordCommandCenterGroupedView(workspace.id, { groupBy: 'cluster' });
    const lifecycleView = await buildKeywordCommandCenterGroupedView(workspace.id, { groupBy: 'lifecycleStage' });

    expect(clusterView?.groups).toEqual([
      expect.objectContaining({
        id: 'Implants cluster',
        title: 'Implants cluster',
        meta: '2/3 covered',
        rollup: expect.objectContaining({ keywordCount: 2, averagePosition: null }),
        rows: expect.arrayContaining([
          expect.objectContaining({ keyword: 'dental implants' }),
          expect.objectContaining({ keyword: 'implant dentist' }),
        ]),
      }),
    ]);
    expect(lifecycleView?.groups.reduce((total, group) => total + group.rollup.keywordCount, 0)).toBe(2);
    expect(lifecycleView?.groups).toHaveLength(5);
  });
});
