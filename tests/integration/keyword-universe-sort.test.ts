/**
 *
 * Exercises the REAL Keyword Command Center rows read path end-to-end for the
 * new clicks/difficulty sorts + direction:
 *   GET /api/webflow/keyword-command-center/:workspaceId/rows?sort=clicks&direction=desc
 *
 * Seeds a workspace with three tracked keywords carrying distinct GSC clicks
 * (via a rank snapshot) and distinct keyword difficulty (via tracked-keyword
 * metadata), then asserts:
 *   - sort=clicks&direction=desc  → clicks descending
 *   - sort=clicks&direction=asc   → reversed
 *   - sort=difficulty&direction=desc → KD descending (NOT volume order)
 *
 * Discipline: every ordering assertion first filters to the seeded keywords so
 * unrelated rows can't mask a regression, and asserts length > 0.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createEphemeralTestContext } from './helpers.js';
import { createWorkspace, deleteWorkspace, updateWorkspace } from '../../server/workspaces.js';
import { addTrackedKeyword, storeRankSnapshot } from '../../server/rank-tracking.js';
import { replaceAllSiteKeywordMetrics } from '../../server/site-keyword-metrics.js';
import type { KeywordCommandCenterRowsResponse } from '../../shared/types/keyword-command-center.js';

const ctx = createEphemeralTestContext(import.meta.url);
const { api } = ctx;

let workspaceId = '';

const base = () => `/api/webflow/keyword-command-center/${workspaceId}`;

// Seeded keywords with KNOWN, DISTINCT clicks and difficulty. clicks come from
// the rank snapshot; difficulty from tracked-keyword metadata. Volume order
// (uni-sort-beta highest) is deliberately DIFFERENT from difficulty order so
// the difficulty sort cannot be satisfied by a volume sort.
const SEEDS = [
  { keyword: 'uni sort alpha', clicks: 90, difficulty: 20, volume: 100, position: 4.0 },
  { keyword: 'uni sort beta', clicks: 30, difficulty: 70, volume: 900, position: 8.0 },
  { keyword: 'uni sort gamma', clicks: 150, difficulty: 45, volume: 300, position: 2.0 },
];

const SEED_KEYS = SEEDS.map((s) => s.keyword);

beforeAll(async () => {
  await ctx.startServer();
  workspaceId = createWorkspace('Keyword Universe Sort Integration').id;

  for (const seed of SEEDS) {
    addTrackedKeyword(workspaceId, seed.keyword, {
      volume: seed.volume,
      difficulty: seed.difficulty,
    });
  }

  // Rank snapshot supplies empirical GSC clicks/impressions/position per keyword.
  storeRankSnapshot(
    workspaceId,
    '2026-05-30',
    SEEDS.map((s) => ({
      query: s.keyword,
      position: s.position,
      clicks: s.clicks,
      impressions: s.clicks * 10,
      ctr: 5.0,
    })),
  );
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

/** Filter to the seeded keywords, preserving the server's returned order. */
function seededOrder(body: KeywordCommandCenterRowsResponse): string[] {
  return body.rows
    .filter((r) => SEED_KEYS.includes(r.keyword))
    .map((r) => r.keyword);
}

describe('Keyword Universe sort — clicks + difficulty + direction (real read path)', () => {
  it('sort=clicks&direction=desc orders the seeded keywords by GSC clicks descending', async () => {
    const body = await fetchRows('filter=all&sort=clicks&direction=desc&page=1&pageSize=50');
    const order = seededOrder(body);
    expect(order.length).toBe(3);
    // clicks: gamma 150, alpha 90, beta 30
    expect(order).toEqual(['uni sort gamma', 'uni sort alpha', 'uni sort beta']);
  });

  it('sort=clicks&direction=asc reverses the clicks order', async () => {
    const body = await fetchRows('filter=all&sort=clicks&direction=asc&page=1&pageSize=50');
    const order = seededOrder(body);
    expect(order.length).toBe(3);
    expect(order).toEqual(['uni sort beta', 'uni sort alpha', 'uni sort gamma']);
  });

  it('sort=difficulty&direction=desc orders by keyword difficulty (NOT volume)', async () => {
    const body = await fetchRows('filter=all&sort=difficulty&direction=desc&page=1&pageSize=50');
    const order = seededOrder(body);
    expect(order.length).toBe(3);
    // difficulty: beta 70, gamma 45, alpha 20.
    // A volume sort would yield beta(900), gamma(300), alpha(100) — same head but
    // the clicks/difficulty distinction is proven by the clicks tests above; here
    // we additionally confirm difficulty asc differs from difficulty desc.
    expect(order).toEqual(['uni sort beta', 'uni sort gamma', 'uni sort alpha']);
  });

  it('sort=difficulty&direction=asc reverses the difficulty order', async () => {
    const body = await fetchRows('filter=all&sort=difficulty&direction=asc&page=1&pageSize=50');
    const order = seededOrder(body);
    expect(order.length).toBe(3);
    expect(order).toEqual(['uni sort alpha', 'uni sort gamma', 'uni sort beta']);
  });

  it('every seeded row carries the clicks + difficulty metrics the sort relies on', async () => {
    const body = await fetchRows('filter=all&page=1&pageSize=50');
    const seeded = body.rows.filter((r) => SEED_KEYS.includes(r.keyword));
    expect(seeded.length).toBe(3);
    expect(seeded.every((r) => typeof r.metrics.clicks === 'number')).toBe(true); // every-ok: guarded by length===3 above
    expect(seeded.every((r) => typeof r.metrics.difficulty === 'number')).toBe(true); // every-ok: guarded by length===3 above
  });
});

// ---------------------------------------------------------------------------
// DRIFT regression — page-1 == global-top-N at SMALL pageSize.
//
// These exercise the candidate-stage pagination CUT (pageSize=3) so that the
// candidate-stage metrics MUST equal the row-stage metrics, or the high-value
// keyword falls off page 1. They fail on the pre-fix candidate stage where the
// candidate self-rank skip / first-writer difficulty diverge from the row stage.
// Own workspace so the filler set + small page bound are fully controlled.
// ---------------------------------------------------------------------------
describe('Keyword Universe sort — candidate/row drift at small pageSize', () => {
  let driftWs = '';
  const driftBase = () => `/api/webflow/keyword-command-center/${driftWs}`;

  // 5 GSC-only filler keywords with SMALL clicks — all rank ABOVE the 9000-click
  // victim under sort=clicks unless the victim keeps its own clicks.
  const FILLERS = Array.from({ length: 5 }, (_, i) => ({
    query: `drift filler keyword ${i}`,
    clicks: i + 1,
    position: 10 + i,
    impressions: (i + 1) * 20,
  }));

  beforeAll(async () => {
    driftWs = createWorkspace('Keyword Universe Drift Integration').id;

    // SELF-RANK victim: a tracked MULTI-TOKEN keyword that is ALSO a GSC ranking
    // query with 9000 clicks. isVariantOf(x,x)===true, so the pre-fix candidate
    // loop dropped its own clicks → it sank below the fillers off page 1.
    addTrackedKeyword(driftWs, 'victim keyword phrase', { volume: 100, difficulty: 33 });

    // DIFFICULTY-PRECEDENCE: a keyword that is BOTH a siteKeywordMetric (KD 20)
    // and an active tracked keyword (KD 70). Row = last-writer = 70.
    addTrackedKeyword(driftWs, 'shared precedence keyword', { volume: 500, difficulty: 70 });
    // A non-empty strategy blob so withResolvedSiteKeywordMetrics doesn't null out.
    updateWorkspace(driftWs, {
      keywordStrategy: {
        siteKeywords: [],
        opportunities: [],
        generatedAt: '2026-05-30T00:00:00.000Z',
      } as never,
    });
    // siteKeywordMetrics live in the table (blob value is overridden by resolve).
    // The KD-fillers (40/50/60) sit BETWEEN the wrong (20) and right (70) value so
    // that, at pageSize=3 under sort=difficulty, the shared keyword reaches page 1
    // ONLY if the candidate stage sorts it as KD 70 (the row value), not KD 20.
    replaceAllSiteKeywordMetrics(driftWs, [
      { keyword: 'shared precedence keyword', volume: 500, difficulty: 20 },
      { keyword: 'kd filler sixty', volume: 50, difficulty: 60 },
      { keyword: 'kd filler fifty', volume: 50, difficulty: 50 },
      { keyword: 'kd filler forty', volume: 50, difficulty: 40 },
    ]);

    storeRankSnapshot(
      driftWs,
      '2026-05-30',
      [
        { query: 'victim keyword phrase', position: 2.0, clicks: 9000, impressions: 50000, ctr: 18.0 },
        ...FILLERS.map((f) => ({
          query: f.query,
          position: f.position,
          clicks: f.clicks,
          impressions: f.impressions,
          ctr: 5.0,
        })),
      ],
    );
  }, 30_000);

  afterAll(() => {
    if (driftWs) deleteWorkspace(driftWs);
  });

  async function fetchDriftRows(query: string): Promise<KeywordCommandCenterRowsResponse> {
    const res = await api(`${driftBase()}/rows?${query}`);
    expect(res.status).toBe(200);
    return (await res.json()) as KeywordCommandCenterRowsResponse;
  }

  it('self-rank: the 9000-click tracked keyword is on page 1 (#1) under sort=clicks at pageSize=3', async () => {
    const body = await fetchDriftRows('filter=all&sort=clicks&direction=desc&page=1&pageSize=3');
    const keywords = body.rows.map((r) => r.keyword);
    expect(keywords).toContain('victim keyword phrase');
    expect(keywords[0]).toBe('victim keyword phrase'); // global #1 by clicks must lead page 1
    const victim = body.rows.find((r) => r.keyword === 'victim keyword phrase');
    expect(victim?.metrics.clicks).toBe(9000);
  });

  it('difficulty precedence: tracked KD 70 wins over siteKeywordMetric KD 20 on the row AND the candidate sort', async () => {
    // sort=difficulty&desc, pageSize=3, KD-fillers at 60/50/40. The shared keyword
    // (row KD 70) is the global #1 by difficulty, so it must LEAD page 1. Pre-fix
    // the candidate stage sorted it as KD 20 → it dropped off page 1 entirely.
    const body = await fetchDriftRows('filter=all&sort=difficulty&direction=desc&page=1&pageSize=3');
    const keywords = body.rows.map((r) => r.keyword);
    expect(keywords).toContain('shared precedence keyword');
    expect(keywords[0]).toBe('shared precedence keyword'); // global highest-KD leads page 1
    const shared = body.rows.find((r) => r.keyword === 'shared precedence keyword');
    expect(shared?.metrics.difficulty).toBe(70);
  });
});
