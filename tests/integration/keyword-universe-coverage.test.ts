/**
 *
 * Exercises the REAL Keyword Command Center read path
 *   GET /api/webflow/keyword-command-center/:workspaceId/rows
 *   GET /api/webflow/keyword-command-center/:workspaceId/summary
 * to prove the (now unconditional) keyword-universe coverage UNCAP:
 *
 *  COVERAGE: EVERY GSC ranked-untracked query with clicks>0 OR impressions>0
 *    appears across pages (no top-50 cap).
 *  NO-LONGER-DROPPED-BY-OLD-CAP: a clicked query that ranked ~#80-by-impressions
 *    (would have been dropped by the retired 50-cap) is present.
 *  VALUE-ORDERED CEILING: with >2000 candidates the universe truncates at the
 *    UNIVERSE_SAFETY_CEILING=2000 BY VALUE — the high-value head is retained, the
 *    lowest-value tail is dropped — and the summary discloses it honestly
 *    (rawEvidenceTotal > rawEvidenceReturned).
 *  COUNT PARITY (Task 2 invariant still holds): summary counts agree with rows
 *    totalRows.
 *
 * Seeds via the real rank-snapshot write path (the same path production uses).
 *
 * The `keyword-universe-full` flag that used to gate this coverage was retired in
 * flag-sunset Wave 2b (2026-07-02): it was globally ON in prod, so this uncapped,
 * value-ordered coverage is now the sole path for every workspace — no flag flip
 * needed, and there is no more OFF/capped state to assert parity against.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createEphemeralTestContext } from './helpers.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';
import { storeRankSnapshot } from '../../server/rank-tracking.js';
import { keywordComparisonKey } from '../../shared/keyword-normalization.js';
import type {
  KeywordCommandCenterRowsResponse,
  KeywordCommandCenterSummaryResponse,
} from '../../shared/types/keyword-command-center.js';

const ctx = createEphemeralTestContext(import.meta.url);
const { api } = ctx;

let coverageWorkspaceId = '';
let ceilingWorkspaceId = '';

const base = (id: string) => `/api/webflow/keyword-command-center/${id}`;

type SnapQuery = { query: string; position: number; clicks: number; impressions: number; ctr: number };

/**
 * 60 GSC ranked-untracked queries WITH clicks — above the OLD (retired) 50 cap.
 * Descending impressions so the old cap (top-50-by-impressions) would have kept
 * #1..#50 and dropped #51..#60. One of the formerly-dropped ones (rank ~#55) is
 * given high clicks but low impressions so we can assert clicked queries the old
 * cap dropped are now present.
 */
function build60RankedQueries(): SnapQuery[] {
  const out: SnapQuery[] = [];
  for (let i = 0; i < 60; i++) {
    // impressions strictly descending: 6000, 5900, ... so impressions-desc order is i.
    out.push({
      query: `coverage query ${String(i).padStart(3, '0')}`,
      position: 5 + (i % 50),
      clicks: 1 + (i % 7), // every query has clicks>0
      impressions: 6000 - i * 100,
      ctr: 1.0,
    });
  }
  return out;
}

// A query that, by impressions, lands at rank ~#80 (i.e. would have been cut by the
// retired 50-cap) but HAS clicks — must appear now (clicks make it valuable).
const CLICKED_BUT_LOW_IMPRESSIONS = 'rank eighty clicked query';

beforeAll(async () => {
  await ctx.startServer();

  coverageWorkspaceId = createWorkspace('Keyword Universe Coverage').id;

  const sixty = build60RankedQueries();
  // Add the clicked-but-low-impressions query: impressions below all 60 (so it is
  // far past the impressions-desc top-50), but clicks present.
  const clicked: SnapQuery = {
    query: CLICKED_BUT_LOW_IMPRESSIONS,
    position: 80,
    clicks: 9,
    impressions: 3, // tiny → past the (retired) top-50-by-impressions cut
    ctr: 0.5,
  };
  const seed = [...sixty, clicked];

  storeRankSnapshot(coverageWorkspaceId, '2026-05-30', seed);
}, 60_000);

afterAll(async () => {
  if (coverageWorkspaceId) deleteWorkspace(coverageWorkspaceId);
  if (ceilingWorkspaceId) deleteWorkspace(ceilingWorkspaceId);
  await ctx.stopServer();
});

async function fetchRows(id: string, qs = 'filter=all&page=1&pageSize=100'): Promise<KeywordCommandCenterRowsResponse> {
  const res = await api(`${base(id)}/rows?${qs}`);
  expect(res.status).toBe(200);
  return (await res.json()) as KeywordCommandCenterRowsResponse;
}

async function fetchSummary(id: string): Promise<KeywordCommandCenterSummaryResponse> {
  const res = await api(`${base(id)}/summary`);
  expect(res.status).toBe(200);
  return (await res.json()) as KeywordCommandCenterSummaryResponse;
}

/** Fetch every page and return the union of row keywords (normalized). */
async function fetchAllKeywords(id: string): Promise<Set<string>> {
  const keys = new Set<string>();
  let page = 1;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const body = await fetchRows(id, `filter=all&page=${page}&pageSize=100`);
    for (const r of body.rows) {
      const k = keywordComparisonKey(r.keyword);
      if (k) keys.add(k);
    }
    if (!body.pageInfo.hasNextPage) break;
    page += 1;
    if (page > 50) break; // safety
  }
  return keys;
}

function hasKeyword(keys: Set<string>, keyword: string): boolean {
  const target = keywordComparisonKey(keyword);
  return target ? keys.has(target) : false;
}

describe('Keyword Universe coverage UNCAP (real GET /rows + /summary)', () => {
  it('all 60 clicked ranked-untracked queries appear across pages (totalRows >= 60)', async () => {
    const firstPage = await fetchRows(coverageWorkspaceId, 'filter=all&page=1&pageSize=100');
    expect(firstPage.pageInfo.totalRows).toBeGreaterThanOrEqual(60);

    const keys = await fetchAllKeywords(coverageWorkspaceId);
    for (let i = 0; i < 60; i++) {
      const q = `coverage query ${String(i).padStart(3, '0')}`;
      expect(hasKeyword(keys, q)).toBe(true);
    }
  });

  it('a clicked query that was rank ~#80-by-impressions (would have been dropped by the retired 50-cap) is present', async () => {
    const keys = await fetchAllKeywords(coverageWorkspaceId);
    expect(hasKeyword(keys, CLICKED_BUT_LOW_IMPRESSIONS)).toBe(true);
  });

  it('summary counts agree with rows totalRows (Task 2 count parity still holds)', async () => {
    const rows = await fetchRows(coverageWorkspaceId, 'filter=all&page=1&pageSize=100');
    const summary = await fetchSummary(coverageWorkspaceId);
    expect(summary.counts.total).toBe(rows.pageInfo.totalRows);
  });
});

describe('Keyword Universe coverage — value-ordered safety ceiling (UNIVERSE_SAFETY_CEILING=2000)', () => {
  // Heavier seed: build its own workspace so the page-bounded tests above stay fast.
  beforeAll(() => {
    ceilingWorkspaceId = createWorkspace('Keyword Universe Coverage Ceiling').id;
    const queries: SnapQuery[] = [];
    // One unmistakable HIGH-VALUE query (huge impressions) and one unmistakable
    // LOWEST-VALUE query (1 impression, 0 clicks). 1999 filler in between → 2001 total.
    queries.push({ query: 'ceiling high value keyword', position: 1, clicks: 500, impressions: 5000, ctr: 10 });
    for (let i = 0; i < 1999; i++) {
      queries.push({
        query: `ceiling filler ${String(i).padStart(4, '0')}`,
        position: 10 + (i % 80),
        clicks: 2,
        impressions: 50 + (i % 40), // all comfortably above the lowest-value one
        ctr: 1,
      });
    }
    queries.push({ query: 'ceiling lowest value keyword', position: 99, clicks: 0, impressions: 1, ctr: 0 });
    storeRankSnapshot(ceilingWorkspaceId, '2026-05-30', queries);
  });

  it('>2000 candidates: totalRows == 2000 and the ceiling is honestly disclosed', async () => {
    const rows = await fetchRows(ceilingWorkspaceId, 'filter=all&page=1&pageSize=100');
    expect(rows.pageInfo.totalRows).toBe(2000);

    const summary = await fetchSummary(ceilingWorkspaceId);
    // Honest disclosure: the true pre-ceiling universe (2001) exceeds what was kept
    // (2000), so the banner-driving inequality holds.
    expect(summary.rawEvidenceTotal).toBeGreaterThan(summary.rawEvidenceReturned);
    expect(summary.rawEvidenceReturned).toBeLessThanOrEqual(2000);
  });

  it('>2000 candidates: value-ordered truncation keeps the high-value head, drops the lowest-value tail', async () => {
    const keys = await fetchAllKeywords(ceilingWorkspaceId);
    expect(hasKeyword(keys, 'ceiling high value keyword')).toBe(true);
    // The single lowest-value query (1 impression, 0 clicks) is the one the value-
    // ordered ceiling drops.
    expect(hasKeyword(keys, 'ceiling lowest value keyword')).toBe(false);
  });
});
