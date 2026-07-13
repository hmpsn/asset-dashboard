import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  getLatestSerpSnapshots,
  getSerpSnapshotsByQuery,
  storeSerpSnapshots,
} from '../../server/serp-snapshots-store.js';
import db from '../../server/db/index.js';
import { computeSerpFeatureOpportunities } from '../../server/domains/analytics-intelligence/computations.js';
import { setWorkspaceFlagOverride } from '../../server/feature-flags.js';
import { addTrackedKeyword } from '../../server/rank-tracking.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';

let workspaceId = '';

beforeEach(() => {
  workspaceId = createWorkspace(`SERP Snapshots ${Date.now()}`).id;
});

afterEach(() => {
  if (workspaceId) setWorkspaceFlagOverride('national-serp-tracking', workspaceId, null);
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

  it('selects max date before observed time when a historical observation arrives later', () => {
    storeSerpSnapshots(workspaceId, '2026-06-24', [{
      query: 'cold brew', position: 2, features: [], observedAt: '2026-06-24T12:00:00.000Z',
    }]);
    storeSerpSnapshots(workspaceId, '2026-06-20', [{
      query: 'cold brew', position: 9, features: [], observedAt: '2026-07-01T12:00:00.000Z',
    }]);

    expect(getLatestSerpSnapshots(workspaceId)[0]).toMatchObject({
      date: '2026-06-24', position: 2,
    });
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

  it('keeps punctuation-sensitive and Unicode-only identities distinct', () => {
    storeSerpSnapshots(workspaceId, '2026-06-24', [
      { query: 'C', position: 1, features: ['organic'], observedAt: '2026-06-24T10:00:00.000Z' },
      { query: 'C#', position: 2, features: ['featured_snippet'], observedAt: '2026-06-24T10:01:00.000Z' },
      { query: '東京 歯医者', position: 3, features: ['local_pack'], observedAt: '2026-06-24T10:02:00.000Z' },
    ]);

    const latest = getLatestSerpSnapshots(workspaceId);
    expect(latest.filter(row => row.identityVersion === 'v2').map(row => row.query).sort())
      .toEqual(['C', 'C#', '東京 歯医者'].sort());
    expect(getSerpSnapshotsByQuery(workspaceId, 'C')[0].position).toBe(1);
    expect(getSerpSnapshotsByQuery(workspaceId, 'C#')[0].position).toBe(2);
    expect(getSerpSnapshotsByQuery(workspaceId, '東京 歯医者')[0].position).toBe(3);

    const legacyJapanese = db.prepare(`
      SELECT COUNT(*) AS count FROM serp_snapshots
      WHERE workspace_id = ? AND date = ? AND query = ''
    `).get(workspaceId, '2026-06-24') as { count: number };
    expect(legacyJapanese.count).toBe(0);
  });

  it('selects one coherent observation deterministically regardless of input order', () => {
    const observations = [
      {
        query: 'Cafe\u0301', position: 7, matchedUrl: 'https://x.com/decomposed',
        features: ['organic'], aiOverviewPresent: false, observedAt: '2026-06-24T12:00:00.000Z',
      },
      {
        query: 'Café', position: 2, matchedUrl: 'https://x.com/composed',
        features: ['ai_overview'], aiOverviewPresent: true, observedAt: '2026-06-24T12:00:00.000Z',
      },
    ];
    storeSerpSnapshots(workspaceId, '2026-06-24', observations);
    const forward = getSerpSnapshotsByQuery(workspaceId, 'Café')[0];

    storeSerpSnapshots(workspaceId, '2026-06-24', [...observations].reverse());
    const reverse = getSerpSnapshotsByQuery(workspaceId, 'Café')[0];

    expect(reverse).toMatchObject({
      query: forward.query,
      position: forward.position,
      matchedUrl: forward.matchedUrl,
      features: forward.features,
      aiOverviewPresent: forward.aiOverviewPresent,
    });
    expect([forward.position, forward.matchedUrl, forward.features]).toEqual([
      7, 'https://x.com/decomposed', ['organic'],
    ]);
  });

  it('archives an unmarked v1 row before rebuilding the rollback projection', () => {
    db.prepare(`
      INSERT INTO serp_snapshots (
        workspace_id, date, query, position, matched_url, features,
        ai_overview_cited, ai_overview_present
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(workspaceId, '2026-06-24', 'c', 9, 'https://legacy.example/c', '["legacy"]', 0, 1);

    storeSerpSnapshots(workspaceId, '2026-06-24', [{
      query: 'C#', position: 2, matchedUrl: 'https://fresh.example/c-sharp',
      features: ['fresh'], observedAt: '2026-06-24T13:00:00.000Z',
    }]);

    const archived = db.prepare(`
      SELECT position, matched_url, features FROM serp_snapshot_v1_legacy_aliases
      WHERE workspace_id = ? AND date = ? AND query_v1 = ?
    `).get(workspaceId, '2026-06-24', 'c') as { position: number; matched_url: string; features: string };
    expect(archived).toEqual({ position: 9, matched_url: 'https://legacy.example/c', features: '["legacy"]' });

    const visible = getLatestSerpSnapshots(workspaceId);
    expect(visible.some(row => row.identityVersion === 'v1' && row.position === 9)).toBe(true);
    expect(visible.some(row => row.identityVersion === 'v2' && row.position === 2)).toBe(true);
  });

  it('does not attribute an ambiguous legacy v1 SERP alias to C or C# volume', () => {
    setWorkspaceFlagOverride('national-serp-tracking', workspaceId, true);
    addTrackedKeyword(workspaceId, 'C', { volume: 100 });
    addTrackedKeyword(workspaceId, 'C#', { volume: 900 });
    db.prepare(`
      INSERT INTO serp_snapshots (
        workspace_id, date, query, position, matched_url, features,
        ai_overview_cited, ai_overview_present
      ) VALUES (?, '2026-06-24', 'c', 3, 'https://example.com/c', '["ai_overview"]', 0, 1)
    `).run(workspaceId);

    const opportunities = computeSerpFeatureOpportunities(workspaceId);
    expect(opportunities).toHaveLength(1);
    expect(opportunities[0].data.estimatedMonthlyCitations).toBe(0);
  });

  it('falls back to unmarked legacy history when no v2 observation exists', () => {
    const insert = db.prepare(`
      INSERT INTO serp_snapshots (
        workspace_id, date, query, position, matched_url, features,
        ai_overview_cited, ai_overview_present
      ) VALUES (?, ?, ?, ?, NULL, '[]', NULL, NULL)
    `);
    insert.run(workspaceId, '2026-06-20', 'legacy keyword', 8);
    insert.run(workspaceId, '2026-06-24', 'legacy keyword', 4);

    const history = getSerpSnapshotsByQuery(workspaceId, 'Legacy Keyword');
    expect(history.map(row => [row.date, row.position, row.identityVersion])).toEqual([
      ['2026-06-24', 4, 'v1'],
      ['2026-06-20', 8, 'v1'],
    ]);
  });

  it('retains only the newest 180 dates in both SERP stores', () => {
    for (let day = 1; day <= 181; day++) {
      const date = new Date(Date.UTC(2025, 0, day)).toISOString().slice(0, 10);
      storeSerpSnapshots(workspaceId, date, [{
        query: 'retention keyword',
        position: day,
        features: [],
        observedAt: `${date}T12:00:00.000Z`,
      }]);
    }

    const legacy = db.prepare(`
      SELECT COUNT(DISTINCT date) AS count FROM serp_snapshots WHERE workspace_id = ?
    `).get(workspaceId) as { count: number };
    const v2 = db.prepare(`
      SELECT COUNT(DISTINCT date) AS count FROM serp_snapshots_v2_compat WHERE workspace_id = ?
    `).get(workspaceId) as { count: number };
    const markers = db.prepare(`
      SELECT COUNT(DISTINCT date) AS count FROM serp_snapshot_v1_projection_keys WHERE workspace_id = ?
    `).get(workspaceId) as { count: number };
    expect({ legacy: legacy.count, v2: v2.count, markers: markers.count })
      .toEqual({ legacy: 180, v2: 180, markers: 180 });
  });
});
