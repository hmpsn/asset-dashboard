/**
 *
 * Exercises the REAL Keyword Command Center read path
 *   GET /api/webflow/keyword-command-center/:workspaceId/rows
 *   GET /api/webflow/keyword-command-center/:workspaceId/summary
 * to prove the flag-gated coverage UNCAP (`keyword-universe-full`):
 *
 *  COVERAGE: with the flag ON, EVERY GSC ranked-untracked query with clicks>0 OR
 *    impressions>0 appears across pages (no top-50 cap); with the flag OFF the
 *    universe stays capped at the old top-50-by-impressions behavior.
 *  DROPPED-BY-OLD-CAP: a clicked query that ranked ~#80-by-impressions (dropped by
 *    the old 50-cap) is present under the flag.
 *  VALUE-ORDERED CEILING: with >2000 candidates the universe truncates at the
 *    UNIVERSE_SAFETY_CEILING=2000 BY VALUE — the high-value head is retained, the
 *    lowest-value tail is dropped — and the summary discloses it honestly
 *    (rawEvidenceTotal > rawEvidenceReturned).
 *  COUNT PARITY (Task 2 invariant still holds under the flag): summary counts agree
 *    with rows totalRows.
 *  FLAG-OFF PARITY (the hard bar): the flag-OFF /rows + /summary output for a fixed
 *    seeded workspace equals the pre-Task-3 capped baseline (top-50-by-impressions),
 *    and is deterministic across calls.
 *
 * Seeds via the real rank-snapshot write path (the same path production uses).
 * Per-workspace flag is flipped via setWorkspaceFlagOverride (the canary path),
 * so default-OFF resolution stays byte-identical for every other workspace.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createEphemeralTestContext } from './helpers.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';
import { storeRankSnapshot } from '../../server/rank-tracking.js';
import { setWorkspaceFlagOverride } from '../../server/feature-flags.js';
import { keywordComparisonKey } from '../../shared/keyword-normalization.js';
import type {
  KeywordCommandCenterRowsResponse,
  KeywordCommandCenterSummaryResponse,
} from '../../shared/types/keyword-command-center.js';

const ctx = createEphemeralTestContext(import.meta.url);
const { api } = ctx;

const FLAG = 'keyword-universe-full' as const;

// Two workspaces: one we flip the flag ON for, one we leave OFF (parity baseline).
let onWorkspaceId = '';
let offWorkspaceId = '';
let ceilingWorkspaceId = '';

const base = (id: string) => `/api/webflow/keyword-command-center/${id}`;

type SnapQuery = { query: string; position: number; clicks: number; impressions: number; ctr: number };

/**
 * 60 GSC ranked-untracked queries WITH clicks — above the old 50 cap. Descending
 * impressions so the OLD cap (top-50-by-impressions) would keep #1..#50 and drop
 * #51..#60. One of the dropped ones (rank ~#55) is given high clicks but low
 * impressions so we can assert the flag keeps clicked queries the old cap dropped.
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

// A query that, by impressions, lands at rank ~#80 (i.e. would be cut by the
// 50-cap) but HAS clicks — must appear under the flag (clicks make it valuable).
const CLICKED_BUT_LOW_IMPRESSIONS = 'rank eighty clicked query';

beforeAll(async () => {
  await ctx.startServer();

  onWorkspaceId = createWorkspace('Keyword Universe Coverage ON').id;
  offWorkspaceId = createWorkspace('Keyword Universe Coverage OFF').id;

  const sixty = build60RankedQueries();
  // Add the clicked-but-low-impressions query: impressions below all 60 (so it is
  // far past the impressions-desc top-50), but clicks present.
  const clicked: SnapQuery = {
    query: CLICKED_BUT_LOW_IMPRESSIONS,
    position: 80,
    clicks: 9,
    impressions: 3, // tiny → past the top-50-by-impressions cut
    ctr: 0.5,
  };
  const seed = [...sixty, clicked];

  storeRankSnapshot(onWorkspaceId, '2026-05-30', seed);
  storeRankSnapshot(offWorkspaceId, '2026-05-30', seed);

  // Flip the flag ON for ONE workspace only (per-workspace canary override).
  setWorkspaceFlagOverride(FLAG, onWorkspaceId, true);
  // offWorkspaceId is left at the default (OFF) — no override row.
}, 60_000);

afterAll(async () => {
  if (onWorkspaceId) {
    setWorkspaceFlagOverride(FLAG, onWorkspaceId, null);
    deleteWorkspace(onWorkspaceId);
  }
  if (offWorkspaceId) deleteWorkspace(offWorkspaceId);
  if (ceilingWorkspaceId) {
    setWorkspaceFlagOverride(FLAG, ceilingWorkspaceId, null);
    deleteWorkspace(ceilingWorkspaceId);
  }
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

describe('Keyword Universe coverage UNCAP (flag ON, real GET /rows + /summary)', () => {
  it('FLAG ON: all 60 clicked ranked-untracked queries appear across pages (totalRows >= 60)', async () => {
    const firstPage = await fetchRows(onWorkspaceId, 'filter=all&page=1&pageSize=100');
    expect(firstPage.pageInfo.totalRows).toBeGreaterThanOrEqual(60);

    const keys = await fetchAllKeywords(onWorkspaceId);
    for (let i = 0; i < 60; i++) {
      const q = `coverage query ${String(i).padStart(3, '0')}`;
      expect(hasKeyword(keys, q)).toBe(true);
    }
  });

  it('FLAG ON: a clicked query that was rank ~#80-by-impressions (dropped by the old 50-cap) is present', async () => {
    const keys = await fetchAllKeywords(onWorkspaceId);
    expect(hasKeyword(keys, CLICKED_BUT_LOW_IMPRESSIONS)).toBe(true);
  });

  it('FLAG ON: summary counts agree with rows totalRows (Task 2 count parity still holds)', async () => {
    const rows = await fetchRows(onWorkspaceId, 'filter=all&page=1&pageSize=100');
    const summary = await fetchSummary(onWorkspaceId);
    expect(summary.counts.total).toBe(rows.pageInfo.totalRows);
  });
});

describe('Keyword Universe coverage — flag OFF parity (the hard bar)', () => {
  it('FLAG OFF: the rank-evidence universe stays capped (totalRows <= 50, old behavior preserved)', async () => {
    const body = await fetchRows(offWorkspaceId, 'filter=all&page=1&pageSize=100');
    // The OFF workspace's only universe is the 61 ranked-untracked queries, capped
    // at the old RANK_EVIDENCE_ROW_LIMIT (50). Nothing else is seeded.
    expect(body.pageInfo.totalRows).toBeLessThanOrEqual(50);
  });

  it('FLAG OFF: keeps the top-50-BY-IMPRESSIONS slice (clicked-but-low-impressions query is ABSENT)', async () => {
    const keys = await fetchAllKeywords(offWorkspaceId);
    // The old cap is impressions-ordered; the clicked-but-tiny-impressions query is
    // past the top-50 cut and therefore must NOT appear when the flag is OFF.
    expect(hasKeyword(keys, CLICKED_BUT_LOW_IMPRESSIONS)).toBe(false);
    // And the highest-impressions query (000) is present.
    expect(hasKeyword(keys, 'coverage query 000')).toBe(true);
  });

  it('FLAG OFF: output is deterministic across calls (byte-identical totals/first page)', async () => {
    const a = await fetchRows(offWorkspaceId, 'filter=all&page=1&pageSize=100&sort=priority');
    const b = await fetchRows(offWorkspaceId, 'filter=all&page=1&pageSize=100&sort=priority');
    expect(b.pageInfo.totalRows).toBe(a.pageInfo.totalRows);
    expect(b.rows.map((r) => r.keyword)).toEqual(a.rows.map((r) => r.keyword));
    const sa = await fetchSummary(offWorkspaceId);
    const sb = await fetchSummary(offWorkspaceId);
    expect(sb.counts.total).toBe(sa.counts.total);
    expect(sb.rawEvidenceTotal).toBe(sa.rawEvidenceTotal);
    expect(sb.rawEvidenceReturned).toBe(sa.rawEvidenceReturned);
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
    setWorkspaceFlagOverride(FLAG, ceilingWorkspaceId, true);
  });

  it('FLAG ON, >2000 candidates: totalRows == 2000 and the ceiling is honestly disclosed', async () => {
    const rows = await fetchRows(ceilingWorkspaceId, 'filter=all&page=1&pageSize=100');
    expect(rows.pageInfo.totalRows).toBe(2000);

    const summary = await fetchSummary(ceilingWorkspaceId);
    // Honest disclosure: the true pre-ceiling universe (2001) exceeds what was kept
    // (2000), so the banner-driving inequality holds.
    expect(summary.rawEvidenceTotal).toBeGreaterThan(summary.rawEvidenceReturned);
    expect(summary.rawEvidenceReturned).toBeLessThanOrEqual(2000);
  });

  it('FLAG ON, >2000 candidates: value-ordered truncation keeps the high-value head, drops the lowest-value tail', async () => {
    const keys = await fetchAllKeywords(ceilingWorkspaceId);
    expect(hasKeyword(keys, 'ceiling high value keyword')).toBe(true);
    // The single lowest-value query (1 impression, 0 clicks) is the one the value-
    // ordered ceiling drops.
    expect(hasKeyword(keys, 'ceiling lowest value keyword')).toBe(false);
  });
});
