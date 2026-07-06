import { afterAll, describe, expect, it } from 'vitest';

import db from '../../server/db/index.js';
import { buildKeywordCommandCenterSummary } from '../../server/keyword-command-center.js';
import { upsertPageKeywordsBatch } from '../../server/page-keywords.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';

function roiSnapshotCount(workspaceId: string): number {
  const row = db.prepare('SELECT COUNT(*) AS total FROM roi_snapshots WHERE workspace_id = ?').get(workspaceId) as { total: number };
  return row.total;
}

describe('Keyword Command Center traffic value summary contract', () => {
  const valuedWorkspaceId = createWorkspace('KCC Traffic Value Contract').id;
  const emptyWorkspaceId = createWorkspace('KCC Traffic Value Empty Contract').id;

  afterAll(() => {
    deleteWorkspace(valuedWorkspaceId);
    deleteWorkspace(emptyWorkspaceId);
  });

  it('serializes monthly traffic value without writing ROI snapshots', async () => {
    upsertPageKeywordsBatch(valuedWorkspaceId, [{
      pagePath: '/services',
      pageTitle: 'Services',
      primaryKeyword: 'dentist near me',
      secondaryKeywords: [],
      clicks: 100,
      impressions: 1_000,
      cpc: 3.5,
    }]);

    const before = roiSnapshotCount(valuedWorkspaceId);
    const summary = await buildKeywordCommandCenterSummary(valuedWorkspaceId);
    const after = roiSnapshotCount(valuedWorkspaceId);

    expect(summary).toEqual(expect.objectContaining({
      trafficValueMonthly: 350,
    }));
    expect(after).toBe(before);
  });

  it('uses null, not 0, when no ROI page source exists', async () => {
    const before = roiSnapshotCount(emptyWorkspaceId);
    const summary = await buildKeywordCommandCenterSummary(emptyWorkspaceId);
    const after = roiSnapshotCount(emptyWorkspaceId);

    expect(summary).toEqual(expect.objectContaining({
      trafficValueMonthly: null,
    }));
    expect(after).toBe(before);
  });
});
