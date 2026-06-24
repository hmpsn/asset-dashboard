import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createEphemeralTestContext } from './helpers.js';
import {
  getLostVisibilityCount,
  upsertDiscoveredQueries,
} from '../../server/client-discovered-queries.js';
import db from '../../server/db/index.js';
import { createWorkspace, deleteWorkspace, updateWorkspace } from '../../server/workspaces.js';

const ctx = createEphemeralTestContext(import.meta.url);
const { api, postJson } = ctx;

let workspaceId = '';

beforeAll(async () => {
  await ctx.startServer();
  workspaceId = createWorkspace('Keyword Command Center Route Test').id;
}, 25_000);

afterAll(async () => {
  deleteWorkspace(workspaceId);
  await ctx.stopServer();
});

describe('Keyword Command Center routes', () => {
  it('legacy full GET endpoint is removed so callers use split read models', async () => {
    const res = await api(`/api/webflow/keyword-command-center/${workspaceId}`);
    expect(res.status).toBe(404);
  });

  it('GET summary, rows, and detail expose split read models', async () => {
    await postJson(`/api/webflow/keyword-command-center/${workspaceId}/actions`, {
      action: 'track',
      keyword: 'Split Route Keyword',
    });

    const summary = await api(`/api/webflow/keyword-command-center/${workspaceId}/summary`);
    expect(summary.status).toBe(200);
    const summaryBody = await summary.json();
    expect(summaryBody).toEqual(expect.objectContaining({
      counts: expect.objectContaining({ total: expect.any(Number) }),
      filters: expect.any(Array),
      summarizedAt: expect.any(String),
    }));
    expect(summaryBody.rows).toBeUndefined();

    const rows = await api(`/api/webflow/keyword-command-center/${workspaceId}/rows?search=split&page=1&pageSize=2`);
    expect(rows.status).toBe(200);
    const rowsBody = await rows.json();
    expect(rowsBody.pageInfo).toEqual(expect.objectContaining({
      page: 1,
      pageSize: 2,
      totalRows: expect.any(Number),
    }));
    expect(rowsBody.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ normalizedKeyword: 'split route keyword' }),
    ]));
    expect(rowsBody.rows[0].explanation).toBeUndefined();

    const detail = await api(`/api/webflow/keyword-command-center/${workspaceId}/detail?keyword=${encodeURIComponent('Split Route Keyword')}`);
    expect(detail.status).toBe(200);
    await expect(detail.json()).resolves.toEqual(expect.objectContaining({
      row: expect.objectContaining({ normalizedKeyword: 'split route keyword' }),
    }));
  });

  it('POST track activates a keyword and protected lifecycle actions require explicit confirmation', async () => {
    const track = await postJson(`/api/webflow/keyword-command-center/${workspaceId}/actions`, {
      action: 'track',
      keyword: 'Route Test Keyword',
    });
    expect(track.status).toBe(200);
    await expect(track.json()).resolves.toEqual(expect.objectContaining({
      ok: true,
      keyword: 'route test keyword',
    }));

    const pause = await postJson(`/api/webflow/keyword-command-center/${workspaceId}/actions`, {
      action: 'pause_tracking',
      keyword: 'Route Test Keyword',
    });
    expect(pause.status).toBe(409);
    await expect(pause.json()).resolves.toEqual({
      error: 'Manual keyword requires explicit confirmation before this action.',
    });

    const retire = await postJson(`/api/webflow/keyword-command-center/${workspaceId}/actions`, {
      action: 'retire',
      keyword: 'Route Test Keyword',
    });
    expect(retire.status).toBe(409);
    await expect(retire.json()).resolves.toEqual({
      error: 'Manual keyword requires explicit confirmation before this action.',
    });

    const forcedRetire = await postJson(`/api/webflow/keyword-command-center/${workspaceId}/actions`, {
      action: 'retire',
      keyword: 'Route Test Keyword',
      force: true,
    });
    expect(forcedRetire.status).toBe(200);

    const read = await api(`/api/webflow/keyword-command-center/${workspaceId}/detail?keyword=${encodeURIComponent('Route Test Keyword')}`);
    expect(read.status).toBe(200);
    const body = await read.json();
    expect(body.row).toEqual(expect.objectContaining({
      normalizedKeyword: 'route test keyword',
      lifecycleStatus: 'retired',
    }));
  });

  it('POST pause or retire returns 404 when the keyword is not tracked', async () => {
    const pause = await postJson(`/api/webflow/keyword-command-center/${workspaceId}/actions`, {
      action: 'pause_tracking',
      keyword: 'Untracked Route Keyword',
    });
    expect(pause.status).toBe(404);
    await expect(pause.json()).resolves.toEqual({ error: 'Keyword is not tracked' });

    const retire = await postJson(`/api/webflow/keyword-command-center/${workspaceId}/actions`, {
      action: 'retire',
      keyword: 'Untracked Route Keyword',
    });
    expect(retire.status).toBe(404);
    await expect(retire.json()).resolves.toEqual({ error: 'Keyword is not tracked' });
  });

  it('POST /actions/bulk applies action to multiple keywords and returns summary', async () => {
    const res = await postJson(`/api/webflow/keyword-command-center/${workspaceId}/actions/bulk`, {
      action: 'track',
      keywords: ['bulk-kw-1', 'bulk-kw-2', 'bulk-kw-3'],
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual(expect.objectContaining({
      action: 'track',
      applied: 3,
      skipped: 0,
      failed: 0,
    }));
    expect(body.items).toHaveLength(3);
  });

  it('POST /actions/bulk rejects request with no keywords', async () => {
    const res = await postJson(`/api/webflow/keyword-command-center/${workspaceId}/actions/bulk`, {
      action: 'pause_tracking',
      keywords: [],
    });
    expect(res.status).toBe(400);
  });

  it('POST /actions/bulk rejects request with too many keywords', async () => {
    const keywords = Array.from({ length: 51 }, (_, i) => `kw-${i}`);
    const res = await postJson(`/api/webflow/keyword-command-center/${workspaceId}/actions/bulk`, {
      action: 'pause_tracking',
      keywords,
    });
    expect(res.status).toBe(400);
  });

  it('POST /actions/bulk rejects non-bulk-eligible actions', async () => {
    const res = await postJson(`/api/webflow/keyword-command-center/${workspaceId}/actions/bulk`, {
      action: 'restore',
      keywords: ['kw'],
    });
    expect(res.status).toBe(400);
  });
});

describe('KCC summary geoLabel', () => {
  it('includes geoLabel when primary market has providerLocationCode', async () => {
    const markets = await api(`/api/local-seo/${workspaceId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        markets: [{
          label: 'Test City',
          city: 'Austin',
          stateOrRegion: 'TX',
          country: 'US',
          providerLocationCode: 1022162,
          status: 'active',
        }],
      }),
    });
    expect(markets.status).toBe(200);
    const marketsData = await markets.json();
    const marketId = marketsData.markets[0].id;

    const setPrimary = await api(`/api/local-seo/${workspaceId}/markets/${marketId}/set-primary`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(setPrimary.status).toBe(200);

    const res = await api(`/api/webflow/keyword-command-center/${workspaceId}/summary`);
    expect(res.status).toBe(200);
    const summary = await res.json();
    expect(summary.geoLabel).toBe('Austin, TX');
  });

  it('omits geoLabel when no primary market is set', async () => {
    const freshWsId = createWorkspace('KCC Summary No Geo Test').id;
    try {
      const res = await api(`/api/webflow/keyword-command-center/${freshWsId}/summary`);
      expect(res.status).toBe(200);
      const summary = await res.json();
      expect(summary.geoLabel).toBeUndefined();
    } finally {
      deleteWorkspace(freshWsId);
    }
  });
});

describe('discovered_queries integration', () => {
  let wsId = '';

  beforeEach(() => {
    wsId = createWorkspace(`DQ Test ${Date.now()}`).id;
  });

  afterEach(() => {
    if (wsId) deleteWorkspace(wsId);
    wsId = '';
  });

  it('upsertDiscoveredQueries populates the table after snapshot', () => {
    upsertDiscoveredQueries(
      wsId,
      [{ query: 'teeth whitening', position: 8.0, clicks: 10, impressions: 200, ctr: 5.0 }],
      '2026-05-22',
    );
    const row = db.prepare(
      'SELECT * FROM discovered_queries WHERE workspace_id = ? AND query = ?',
    ).get(wsId, 'teeth whitening') as Record<string, unknown>;
    expect(row).toBeTruthy();
    expect(row.snapshot_count).toBe(1);
    expect(row.status).toBe('active');
  });

  it('KCC summary endpoint returns lostVisibility count', async () => {
    db.prepare(`
      INSERT INTO discovered_queries
        (workspace_id, query, first_seen, last_seen, snapshot_count, total_impressions, status)
      VALUES (?, 'lost keyword', '2026-01-01', '2026-01-01', 5, 100, 'lost_visibility')
    `).run(wsId);

    const res = await api(`/api/webflow/keyword-command-center/${wsId}/summary`);
    expect(res.status).toBe(200);
    const body = await res.json() as { counts: { lostVisibility?: number } };
    expect(body.counts.lostVisibility).toBe(1);
    expect(getLostVisibilityCount(wsId)).toBe(1);
  });

  it('second upsert with same query increments snapshot_count without duplicate rows', () => {
    upsertDiscoveredQueries(
      wsId,
      [{ query: 'teeth whitening', position: 8.0, clicks: 10, impressions: 200, ctr: 5.0 }],
      '2026-05-22',
    );
    upsertDiscoveredQueries(
      wsId,
      [{ query: 'teeth whitening', position: 7.5, clicks: 12, impressions: 220, ctr: 5.5 }],
      '2026-05-23',
    );
    const count = db.prepare(
      'SELECT COUNT(*) AS count FROM discovered_queries WHERE workspace_id = ? AND query = ?',
    ).get(wsId, 'teeth whitening') as { count: number };
    expect(count.count).toBe(1);
    const row = db.prepare(
      'SELECT snapshot_count FROM discovered_queries WHERE workspace_id = ? AND query = ?',
    ).get(wsId, 'teeth whitening') as { snapshot_count: number };
    expect(row.snapshot_count).toBe(2);
  });
});
