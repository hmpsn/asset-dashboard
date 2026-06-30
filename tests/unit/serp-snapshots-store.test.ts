import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  getLatestSerpSnapshots,
  getSerpSnapshotsByQuery,
  storeSerpSnapshots,
} from '../../server/serp-snapshots-store.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';

let workspaceId = '';

beforeEach(() => {
  workspaceId = createWorkspace(`SERP Snapshots ${Date.now()}`).id;
});

afterEach(() => {
  if (workspaceId) deleteWorkspace(workspaceId);
  workspaceId = '';
});

describe('serp-snapshots-store', () => {
  it('round-trips a snapshot: position, features, tri-state flags, matched_url', () => {
    storeSerpSnapshots(workspaceId, '2026-06-24', [
      {
        query: 'cold brew',
        position: 1,
        matchedUrl: 'https://x.com/a',
        features: ['featured_snippet', 'organic'],
        aiOverviewCited: null,
        aiOverviewPresent: false,
      },
    ]);

    const latest = getLatestSerpSnapshots(workspaceId);
    expect(latest).toHaveLength(1);
    const snapshot = latest[0];
    expect(snapshot.position).toBe(1);
    expect(snapshot.features).toEqual(['featured_snippet', 'organic']);
    // tri-state: false (0) survives; null → undefined.
    expect(snapshot.aiOverviewPresent).toBe(false);
    expect(snapshot.aiOverviewCited).toBeUndefined();
    expect(snapshot.matchedUrl).toBe('https://x.com/a');
    expect(snapshot.date).toBe('2026-06-24');
    expect(snapshot.workspaceId).toBe(workspaceId);
    // query is normalized via keywordComparisonKey.
    expect(snapshot.query).toBe('cold brew');
  });

  it('upserts on (workspace_id, date, query) — second store UPDATES, not duplicates', () => {
    storeSerpSnapshots(workspaceId, '2026-06-24', [
      {
        query: 'cold brew',
        position: 1,
        matchedUrl: 'https://x.com/a',
        features: ['featured_snippet'],
        aiOverviewPresent: false,
      },
    ]);
    storeSerpSnapshots(workspaceId, '2026-06-24', [
      {
        query: 'cold brew',
        position: 3,
        matchedUrl: 'https://x.com/b',
        features: ['organic'],
        aiOverviewPresent: true,
      },
    ]);

    const latest = getLatestSerpSnapshots(workspaceId);
    expect(latest).toHaveLength(1);
    expect(latest[0].position).toBe(3);
    expect(latest[0].matchedUrl).toBe('https://x.com/b');
    expect(latest[0].features).toEqual(['organic']);
    expect(latest[0].aiOverviewPresent).toBe(true);
  });

  it('round-trips undefined position / matched_url to undefined (not 0 / empty-string)', () => {
    storeSerpSnapshots(workspaceId, '2026-06-24', [
      {
        query: 'not ranking',
        position: undefined,
        matchedUrl: undefined,
        features: ['ai_overview'],
        aiOverviewPresent: true,
        aiOverviewCited: true,
      },
    ]);

    const latest = getLatestSerpSnapshots(workspaceId);
    expect(latest).toHaveLength(1);
    expect(latest[0].position).toBeUndefined();
    expect(latest[0].matchedUrl).toBeUndefined();
    expect(latest[0].features).toEqual(['ai_overview']);
    expect(latest[0].aiOverviewPresent).toBe(true);
    expect(latest[0].aiOverviewCited).toBe(true);
  });

  it('getLatestSerpSnapshots returns the most recent row per query (max date)', () => {
    storeSerpSnapshots(workspaceId, '2026-06-20', [
      { query: 'cold brew', position: 5, features: [] },
    ]);
    storeSerpSnapshots(workspaceId, '2026-06-24', [
      { query: 'cold brew', position: 2, features: [] },
    ]);

    const latest = getLatestSerpSnapshots(workspaceId);
    expect(latest).toHaveLength(1);
    expect(latest[0].date).toBe('2026-06-24');
    expect(latest[0].position).toBe(2);
  });

  it('getSerpSnapshotsByQuery returns all snapshots for one query, date-descending', () => {
    storeSerpSnapshots(workspaceId, '2026-06-20', [
      { query: 'cold brew', position: 5, features: [] },
    ]);
    storeSerpSnapshots(workspaceId, '2026-06-24', [
      { query: 'cold brew', position: 2, features: [] },
    ]);
    storeSerpSnapshots(workspaceId, '2026-06-22', [
      { query: 'cold brew', position: 3, features: [] },
    ]);

    const history = getSerpSnapshotsByQuery(workspaceId, 'Cold Brew');
    expect(history.map(s => s.date)).toEqual(['2026-06-24', '2026-06-22', '2026-06-20']);
    expect(history.map(s => s.position)).toEqual([2, 3, 5]);
  });

  it('scopes reads by workspace_id', () => {
    const otherWorkspaceId = createWorkspace(`SERP Other ${Date.now()}`).id;
    try {
      storeSerpSnapshots(workspaceId, '2026-06-24', [
        { query: 'cold brew', position: 1, features: [] },
      ]);
      storeSerpSnapshots(otherWorkspaceId, '2026-06-24', [
        { query: 'cold brew', position: 9, features: [] },
      ]);

      expect(getLatestSerpSnapshots(workspaceId)[0].position).toBe(1);
      expect(getLatestSerpSnapshots(otherWorkspaceId)[0].position).toBe(9);
    } finally {
      deleteWorkspace(otherWorkspaceId);
    }
  });
});
