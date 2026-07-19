import { afterEach, describe, expect, it } from 'vitest';

import { measureSqlExecutionsForTest } from '../../server/db/index.js';
import { getRankHistoryRows, storeRankSnapshot } from '../../server/rank-tracking.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';

describe('getRankHistoryRows', () => {
  const cleanup = new Set<string>();

  afterEach(() => {
    for (const workspaceId of cleanup) deleteWorkspace(workspaceId);
    cleanup.clear();
  });

  it('batches visible keywords into one snapshot read and computes honest seven-day deltas', async () => {
    const workspace = createWorkspace(`Row rank history ${Date.now()}`);
    cleanup.add(workspace.id);

    storeRankSnapshot(workspace.id, '2026-06-20', [
      { query: 'Cosmetic Dentistry', position: 18, clicks: 1, impressions: 20, ctr: 5 },
      { query: 'Emergency Dentist', position: 22, clicks: 1, impressions: 20, ctr: 5 },
    ]);
    storeRankSnapshot(workspace.id, '2026-07-01', [
      { query: 'Cosmetic Dentistry', position: 12, clicks: 2, impressions: 30, ctr: 6.7 },
      { query: 'Emergency Dentist', position: 20, clicks: 1, impressions: 25, ctr: 4 },
    ]);
    storeRankSnapshot(workspace.id, '2026-07-04', [
      { query: 'Cosmetic Dentistry', position: 10, clicks: 3, impressions: 35, ctr: 8.6 },
    ]);
    storeRankSnapshot(workspace.id, '2026-07-08', [
      { query: 'Cosmetic Dentistry', position: 7, clicks: 4, impressions: 40, ctr: 10 },
      { query: 'Emergency Dentist', position: 18, clicks: 2, impressions: 30, ctr: 6.7 },
    ]);

    const measured = await measureSqlExecutionsForTest(() => getRankHistoryRows(
      workspace.id,
      ['Emergency Dentist', 'cosmetic dentistry', 'No snapshots'],
    ));

    expect(measured.count).toBe(1);
    expect(measured.result).toEqual({
      windowDays: 7,
      series: [
        {
          query: 'Emergency Dentist',
          points: [
            { date: '2026-06-20', position: 22 },
            { date: '2026-07-01', position: 20 },
            { date: '2026-07-08', position: 18 },
          ],
          delta7d: 2,
        },
        {
          query: 'cosmetic dentistry',
          points: [
            { date: '2026-06-20', position: 18 },
            { date: '2026-07-01', position: 12 },
            { date: '2026-07-04', position: 10 },
            { date: '2026-07-08', position: 7 },
          ],
          delta7d: 5,
        },
        { query: 'No snapshots', points: [] },
      ],
    });
  });

  it('does not fabricate a delta from two points outside the same seven-day window', () => {
    const workspace = createWorkspace(`Sparse row rank history ${Date.now()}`);
    cleanup.add(workspace.id);

    storeRankSnapshot(workspace.id, '2026-06-20', [
      { query: 'Sparse keyword', position: 15, clicks: 1, impressions: 10, ctr: 10 },
    ]);
    storeRankSnapshot(workspace.id, '2026-07-08', [
      { query: 'Sparse keyword', position: 9, clicks: 2, impressions: 20, ctr: 10 },
    ]);

    expect(getRankHistoryRows(workspace.id, ['Sparse keyword'])).toEqual({
      windowDays: 7,
      series: [{
        query: 'Sparse keyword',
        points: [
          { date: '2026-06-20', position: 15 },
          { date: '2026-07-08', position: 9 },
        ],
      }],
    });
  });
});
