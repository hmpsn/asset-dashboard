import { afterEach, describe, expect, it } from 'vitest';

import { buildKeywordCommandCenterSummary } from '../../server/keyword-command-center.js';
import { storeRankSnapshot } from '../../server/rank-tracking.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';

describe('Keyword Command Center summary rank rollups', () => {
  const cleanup = new Set<string>();

  afterEach(() => {
    for (const workspaceId of cleanup) deleteWorkspace(workspaceId);
    cleanup.clear();
  });

  it('uses adjacent 28-day snapshot windows and computes impression-weighted deltas', async () => {
    const workspace = createWorkspace(`KCC summary rollups ${Date.now()}`);
    cleanup.add(workspace.id);

    storeRankSnapshot(workspace.id, '2026-05-16', [
      { query: 'dental implants', position: 30, clicks: 4, impressions: 50, ctr: 8 },
    ]);
    storeRankSnapshot(workspace.id, '2026-06-12', [
      { query: 'dental implants', position: 12, clicks: 5, impressions: 50, ctr: 10 },
      { query: 'emergency dentist', position: 20, clicks: 15, impressions: 150, ctr: 10 },
    ]);
    // Inside the current window, but not the latest observation. The current KPI
    // must use the latest snapshot because every snapshot already represents a
    // rolling 28-day GSC period.
    storeRankSnapshot(workspace.id, '2026-06-13', [
      { query: 'dental implants', position: 2, clicks: 99, impressions: 100, ctr: 99 },
    ]);
    storeRankSnapshot(workspace.id, '2026-07-10', [
      { query: 'dental implants', position: 4, clicks: 10, impressions: 100, ctr: 10 },
      { query: 'emergency dentist', position: 10, clicks: 30, impressions: 300, ctr: 10 },
    ]);

    const summary = await buildKeywordCommandCenterSummary(workspace.id);

    expect(summary?.rankKpis).toEqual({
      windowDays: 28,
      currentPeriod: {
        startDate: '2026-06-13',
        endDate: '2026-07-10',
        snapshotDate: '2026-07-10',
        averagePosition: 8.5,
        clicks: 40,
        impressions: 400,
      },
      comparisonPeriod: {
        startDate: '2026-05-16',
        endDate: '2026-06-12',
        snapshotDate: '2026-06-12',
        averagePosition: 18,
        clicks: 20,
        impressions: 200,
      },
      deltas: {
        averagePosition: 9.5,
        clicksPercent: 100,
        impressionsPercent: 100,
      },
    });
  });

  it('keeps the current average but omits deltas when the prior window has no snapshot', async () => {
    const workspace = createWorkspace(`KCC summary no prior ${Date.now()}`);
    cleanup.add(workspace.id);
    storeRankSnapshot(workspace.id, '2026-07-10', [
      { query: 'cosmetic dentistry', position: 7, clicks: 0, impressions: 0, ctr: 0 },
      { query: 'emergency dentist', position: 11, clicks: 0, impressions: 0, ctr: 0 },
    ]);

    const summary = await buildKeywordCommandCenterSummary(workspace.id);

    expect(summary?.rankKpis.currentPeriod.averagePosition).toBe(9);
    expect(summary?.rankKpis.comparisonPeriod).toMatchObject({
      startDate: '2026-05-16',
      endDate: '2026-06-12',
      snapshotDate: null,
      averagePosition: null,
      clicks: null,
      impressions: null,
    });
    expect(summary?.rankKpis.deltas).toEqual({
      averagePosition: null,
      clicksPercent: null,
      impressionsPercent: null,
    });
  });

  it('returns explicit unavailable rank KPIs when no snapshots exist', async () => {
    const workspace = createWorkspace(`KCC summary empty ${Date.now()}`);
    cleanup.add(workspace.id);

    const summary = await buildKeywordCommandCenterSummary(workspace.id);

    expect(summary?.rankKpis).toEqual({
      windowDays: 28,
      currentPeriod: {
        startDate: null,
        endDate: null,
        snapshotDate: null,
        averagePosition: null,
        clicks: null,
        impressions: null,
      },
      comparisonPeriod: {
        startDate: null,
        endDate: null,
        snapshotDate: null,
        averagePosition: null,
        clicks: null,
        impressions: null,
      },
      deltas: {
        averagePosition: null,
        clicksPercent: null,
        impressionsPercent: null,
      },
    });
  });
});
