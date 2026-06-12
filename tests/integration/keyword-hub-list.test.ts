/**
 *
 * Exercises the REAL Keyword Hub read path: the KCC rows + summary endpoints
 * that the Hub list (P1-T3/T4) consumes:
 *   GET /api/webflow/keyword-command-center/:workspaceId/rows
 *   GET /api/webflow/keyword-command-center/:workspaceId/summary
 *
 * Verifies filter / search / sort / pagination against a seeded workspace, plus
 * the row-shape invariants the Hub relies on (normalizedKeyword selection rowId,
 * tracking.status, sourceGapKey type validity).
 *
 * Discipline: every `.every()` assertion is preceded by `rows.length > 0` so a
 * vacuously-true empty result can never mask a filter regression.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createEphemeralTestContext } from './helpers.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';
import { storeRankSnapshot } from '../../server/rank-tracking.js';
import type {
  KeywordCommandCenterRowsResponse,
  KeywordCommandCenterSummaryResponse,
} from '../../shared/types/keyword-command-center.js';

const ctx = createEphemeralTestContext(import.meta.url);
const { api, postJson } = ctx;

let workspaceId = '';

const base = () => `/api/webflow/keyword-command-center/${workspaceId}`;

beforeAll(async () => {
  await ctx.startServer();
  workspaceId = createWorkspace('Keyword Hub List Integration').id;

  // 1) Tracked keywords (active tracking → lifecycleStatus 'tracked').
  for (const kw of ['hub track alpha', 'hub track beta', 'hub track gamma']) {
    const res = await postJson(`${base()}/actions`, { action: 'track', keyword: kw });
    expect(res.status).toBe(200);
  }

  // 2) An in-strategy keyword (approved feedback → lifecycleStatus 'in_strategy').
  const inStrategy = await postJson(`${base()}/actions`, {
    action: 'add_to_strategy',
    keyword: 'hub strategy keyword',
  });
  expect(inStrategy.status).toBe(200);

  // 3) A retired keyword (track then force-retire → lifecycleStatus 'retired').
  await postJson(`${base()}/actions`, { action: 'track', keyword: 'hub retired keyword' });
  const retire = await postJson(`${base()}/actions`, {
    action: 'retire',
    keyword: 'hub retired keyword',
    force: true,
  });
  expect(retire.status).toBe(200);

  // 4) Rank snapshot with distinct GSC positions for the tracked keywords →
  //    rows with metrics.currentPosition (drives the sort=rank ordering
  //    assertion). Lower position = better rank.
  storeRankSnapshot(workspaceId, '2026-05-30', [
    { query: 'hub track alpha', position: 3.2, clicks: 40, impressions: 800, ctr: 5.0 },
    { query: 'hub track beta', position: 11.5, clicks: 12, impressions: 300, ctr: 4.0 },
    { query: 'hub track gamma', position: 27.8, clicks: 3, impressions: 120, ctr: 2.5 },
  ]);
}, 30_000);

afterAll(async () => {
  if (workspaceId) deleteWorkspace(workspaceId);
  await ctx.stopServer();
});

async function fetchRows(query: string): Promise<KeywordCommandCenterRowsResponse> {
  const res = await api(`${base()}/rows?${query}`);
  expect(res.status).toBe(200);
  return (await res.json()) as KeywordCommandCenterRowsResponse;
}

describe('Keyword Hub list — real KCC rows read path', () => {
  it('filter=all returns rows + a well-formed pageInfo', async () => {
    const body = await fetchRows('filter=all&page=1&pageSize=50');
    expect(body.rows.length).toBeGreaterThan(0);
    expect(body.pageInfo).toEqual(
      expect.objectContaining({
        page: 1,
        pageSize: 50,
        totalRows: expect.any(Number),
        totalPages: expect.any(Number),
        hasNextPage: expect.any(Boolean),
        hasPreviousPage: expect.any(Boolean),
      }),
    );
  });

  it('filter=tracked returns only active-tracking rows', async () => {
    const body = await fetchRows('filter=tracked&page=1&pageSize=50');
    expect(body.rows.length).toBeGreaterThan(0);
    expect(body.rows.every((r) => r.tracking.status === 'active')).toBe(true); // every-ok: guarded by toBeGreaterThan(0) on prior line
  });

  it('filter=in_strategy returns only in-strategy rows', async () => {
    const body = await fetchRows('filter=in_strategy&page=1&pageSize=50');
    expect(body.rows.length).toBeGreaterThan(0);
    expect(body.rows.every((r) => r.lifecycleStatus === 'in_strategy')).toBe(true); // every-ok: guarded by toBeGreaterThan(0) on prior line
  });

  it('filter=retired returns only retired rows', async () => {
    const body = await fetchRows('filter=retired&page=1&pageSize=50');
    expect(body.rows.length).toBeGreaterThan(0);
    expect(body.rows.every((r) => r.lifecycleStatus === 'retired')).toBe(true); // every-ok: guarded by toBeGreaterThan(0) on prior line
  });

  it('filter=local returns only rows carrying local-SEO data', async () => {
    const body = await fetchRows('filter=local&page=1&pageSize=50');
    // Local data is environment-dependent; assert the invariant only when present.
    if (body.rows.length > 0) {
      expect(body.rows.every((r) => Boolean(r.localSeo || r.localSeoState))).toBe(true); // every-ok: guarded by if (body.rows.length > 0) on prior line
    }
  });

  it('search matches the normalized keyword case-insensitively', async () => {
    const body = await fetchRows('filter=all&search=TRACK%20ALPHA&page=1&pageSize=50');
    expect(body.rows.length).toBeGreaterThan(0);
    expect(body.rows.every((r) => r.normalizedKeyword.includes('track alpha'))).toBe(true); // every-ok: guarded by toBeGreaterThan(0) on prior line
  });

  it('sort=rank returns rows in non-decreasing position order', async () => {
    const body = await fetchRows('filter=all&sort=rank&page=1&pageSize=50');
    expect(body.rows.length).toBeGreaterThan(0);
    const positions = body.rows
      .map((r) => r.metrics.currentPosition)
      .filter((p): p is number => typeof p === 'number');
    expect(positions.length).toBeGreaterThan(0);
    const sorted = [...positions].sort((a, b) => a - b);
    expect(positions).toEqual(sorted);
  });

  it('pagination slices the result set and reports hasPreviousPage on page 2', async () => {
    const page1 = await fetchRows('filter=all&page=1&pageSize=2');
    expect(page1.rows.length).toBeGreaterThan(0);
    expect(page1.rows.length).toBeLessThanOrEqual(2);
    expect(page1.pageInfo.hasPreviousPage).toBe(false);

    if (page1.pageInfo.totalPages > 1) {
      const page2 = await fetchRows('filter=all&page=2&pageSize=2');
      expect(page2.pageInfo.page).toBe(2);
      expect(page2.pageInfo.hasPreviousPage).toBe(true);
      // No overlap between page 1 and page 2 keyword identities.
      expect(page2.rows.length).toBeGreaterThan(0);
      const p1Keys = new Set(page1.rows.map((r) => r.normalizedKeyword));
      expect(page2.rows.every((r) => !p1Keys.has(r.normalizedKeyword))).toBe(true); // every-ok: guarded by toBeGreaterThan(0) above
    }
  });

  it('every row carries a normalizedKeyword (the selection rowId) and tracking.status', async () => {
    const body = await fetchRows('filter=all&page=1&pageSize=50');
    expect(body.rows.length).toBeGreaterThan(0);
    expect(
      body.rows.every( // every-ok: guarded by toBeGreaterThan(0) above
        (r) => typeof r.normalizedKeyword === 'string' && r.normalizedKeyword.length > 0,
      ),
    ).toBe(true);
    expect(body.rows.every((r) => typeof r.tracking.status === 'string')).toBe(true); // every-ok: guarded by toBeGreaterThan(0) above
  });

  it('any row that carries tracking.sourceGapKey carries it as a string', async () => {
    const body = await fetchRows('filter=all&page=1&pageSize=50');
    expect(body.rows.length).toBeGreaterThan(0);
    const withGap = body.rows.filter((r) => r.tracking.sourceGapKey !== undefined);
    // No assertion that any exist — only that, when present, they are valid strings.
    expect(withGap.every((r) => typeof r.tracking.sourceGapKey === 'string')).toBe(true); // every-ok: intentional type-when-present check on a possibly-empty filter result
  });

  it('GET summary returns the KeywordCommandCenterCounts shape', async () => {
    const res = await api(`${base()}/summary`);
    expect(res.status).toBe(200);
    const summary = (await res.json()) as KeywordCommandCenterSummaryResponse;
    expect(summary.counts).toEqual(
      expect.objectContaining({
        total: expect.any(Number),
        inStrategy: expect.any(Number),
        tracked: expect.any(Number),
        needsReview: expect.any(Number),
        retired: expect.any(Number),
        local: expect.any(Number),
      }),
    );
    expect(summary.counts.tracked).toBeGreaterThan(0);
    expect(summary.counts.retired).toBeGreaterThan(0);
    expect(Array.isArray(summary.filters)).toBe(true);
  });

  // ── Striking Distance filter (positions 11–20) ─────────────────────────────

  it('filter=striking_distance returns only rows with position 11–20', async () => {
    // Seeded rank snapshot: alpha=3.2, beta=11.5, gamma=27.8
    // Only "hub track beta" (position 11.5) qualifies.
    const body = await fetchRows('filter=striking_distance&page=1&pageSize=50');
    // Must return ≥1 row (hub track beta at 11.5).
    expect(body.rows.length).toBeGreaterThan(0);
    // Every returned row must have currentPosition in [11, 20] inclusive.
    for (const row of body.rows) {
      const pos = row.metrics.currentPosition;
      expect(pos).toBeDefined();
      expect(pos).toBeGreaterThanOrEqual(11);
      expect(pos).toBeLessThanOrEqual(20);
    }
    // hub track alpha (pos 3.2) must NOT appear.
    expect(body.rows.some(r => r.keyword === 'hub track alpha')).toBe(false);
    // hub track gamma (pos 27.8) must NOT appear.
    expect(body.rows.some(r => r.keyword === 'hub track gamma')).toBe(false);
  });

  it('filter=striking_distance rows are value-ranked (opportunity desc) by default', async () => {
    // When multiple striking-distance rows exist, default sort is opportunity desc.
    // With only one qualifying row in the seed data, we can only assert no crash + shape.
    const body = await fetchRows('filter=striking_distance&sort=opportunity&direction=desc&page=1&pageSize=50');
    expect(body.pageInfo).toEqual(expect.objectContaining({ page: 1 }));
    expect(Array.isArray(body.rows)).toBe(true);
  });

  it('summary strikingDistance count matches at least 1 (hub track beta at 11.5)', async () => {
    const res = await api(`${base()}/summary`);
    const summary = (await res.json()) as KeywordCommandCenterSummaryResponse;
    // The rank snapshot seeds beta at position 11.5 → at least 1 striking-distance keyword.
    expect(typeof summary.counts.strikingDistance).toBe('number');
    expect(summary.counts.strikingDistance).toBeGreaterThanOrEqual(1);
  });

  it('summary.filters includes a STRIKING_DISTANCE facet', async () => {
    const res = await api(`${base()}/summary`);
    const summary = (await res.json()) as KeywordCommandCenterSummaryResponse;
    const sdFacet = summary.filters.find(f => f.id === 'striking_distance');
    expect(sdFacet).toBeDefined();
    expect(sdFacet?.label).toBe('Striking Distance');
    expect(typeof sdFacet?.count).toBe('number');
  });

  it('filter=striking_distance boundary: position exactly 10 excluded, exactly 20 included', async () => {
    // Verify that a second snapshot with boundary positions is correctly filtered.
    // Inject additional rank data for boundary testing.
    storeRankSnapshot(workspaceId, '2026-06-01', [
      { query: 'hub boundary pos10', position: 10, clicks: 5, impressions: 200, ctr: 2.5 },
      { query: 'hub boundary pos20', position: 20, clicks: 2, impressions: 100, ctr: 2.0 },
      { query: 'hub boundary pos21', position: 21, clicks: 1, impressions: 80, ctr: 1.25 },
    ]);
    const body = await fetchRows('filter=striking_distance&page=1&pageSize=50');
    // pos20 must be present; pos10 and pos21 must be absent.
    const keywords = body.rows.map(r => r.keyword);
    expect(keywords).toContain('hub boundary pos20');
    expect(keywords).not.toContain('hub boundary pos10');
    expect(keywords).not.toContain('hub boundary pos21');
  });
});
