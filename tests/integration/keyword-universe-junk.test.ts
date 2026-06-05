/**
 * keyword-universe-junk.test.ts — Task 2 integration test (port 13903).
 *
 * Exercises the REAL Keyword Command Center rows read path
 *   GET /api/webflow/keyword-command-center/:workspaceId/rows?filter=all
 * to prove the two-tier junk gate (server/keyword-command-center.ts,
 * addCandidateKeysFromBundle) behaves per the Coverage Contract:
 *
 *  HEADLINE (owner invariant): a real not-yet-ranking competitor keyword_gap
 *    (0 clicks/0 impressions, real volume) APPEARS — discovery is retained.
 *  TIER-1: a malformed boolean/quoted keyword_gap is ABSENT.
 *  TIER-2-NOT-ON-RANKING: a GSC ranking query (with clicks) that would fail the
 *    relevance heuristic STILL appears.
 *  TIER-2-ON-DISCOVERY: a low-actionability provider gap (LOW_ACTIONABILITY_PHRASES)
 *    is ABSENT.
 *  IMPRESSION-ONLY: an impression-only GSC ranking query appears (empirical
 *    ranking retained; Tier-1 passes; Tier-2 not applied).
 *
 * Seeds via the real keyword_gaps / content_gaps / rank-snapshot / tracked write
 * paths (the same paths production uses).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestContext } from './helpers.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';
import { addTrackedKeyword, storeRankSnapshot } from '../../server/rank-tracking.js';
import { replaceAllKeywordGaps } from '../../server/keyword-gaps.js';
import { replaceAllContentGaps } from '../../server/content-gaps.js';
import { keywordComparisonKey } from '../../shared/keyword-normalization.js';
import { KEYWORD_COMMAND_CENTER_FILTERS } from '../../shared/types/keyword-command-center.js';
import type {
  KeywordCommandCenterRowsResponse,
  KeywordCommandCenterSummaryResponse,
} from '../../shared/types/keyword-command-center.js';
import type { KeywordGapItem, ContentGap } from '../../shared/types/workspace.js';

const ctx = createTestContext(13903); // port-ok: next free after 13902
const { api } = ctx;

let workspaceId = '';

const base = () => `/api/webflow/keyword-command-center/${workspaceId}`;

// The owner-observed malformed string — quotes + boolean operators (Tier-1).
const JUNK_BOOLEAN = '"teeth whitening" "new patient" discount or special or package or offer';
// A LOW_ACTIONABILITY_PHRASES entry (server/keyword-intelligence/rules.ts) seeded as a
// DISCOVERY-ONLY gap (no ranking twin) → Tier-2 must drop it.
const LOW_ACTIONABILITY_DISCOVERY = 'list of all domain name extensions';
// A different LOW_ACTIONABILITY_PHRASES entry seeded ONLY as a GSC ranking query with
// clicks → being empirical ranking, Tier-2 must NOT be applied; it stays.
const LOW_ACTIONABILITY_RANKING = 'paper tiger';

function gap(keyword: string, overrides: Partial<KeywordGapItem> = {}): KeywordGapItem {
  return {
    keyword,
    volume: 500,
    difficulty: 40,
    competitorPosition: 4,
    competitorDomain: 'competitor.com',
    ...overrides,
  };
}

function contentGap(targetKeyword: string, overrides: Partial<ContentGap> = {}): ContentGap {
  return {
    topic: `Topic: ${targetKeyword}`,
    targetKeyword,
    intent: 'commercial',
    priority: 'high',
    rationale: 'seeded test gap',
    volume: 600,
    difficulty: 30,
    ...overrides,
  };
}

beforeAll(async () => {
  await ctx.startServer();
  workspaceId = createWorkspace('Keyword Universe Junk Integration').id;

  // DISCOVERY (Population C) — keyword_gaps.
  replaceAllKeywordGaps(workspaceId, [
    // HEADLINE: real not-yet-ranking competitor gap — must be RETAINED.
    gap('invisalign cost', { volume: 1900, difficulty: 40, competitorPosition: 4 }),
    // TIER-1: malformed boolean/quoted string — must be DROPPED.
    gap(JUNK_BOOLEAN),
    // TIER-2: low-actionability provider gap (discovery-only) — must be DROPPED.
    gap(LOW_ACTIONABILITY_DISCOVERY),
  ]);

  // DISCOVERY (Population C) — content_gaps. A real gap retained.
  replaceAllContentGaps(workspaceId, [
    contentGap('teeth whitening cost', { volume: 800 }), // real → RETAINED
  ]);

  // RANKING (Population A) — GSC snapshot. A low-actionability string WITH clicks
  // proves Tier-2 is NOT applied to the ranking source loop. Plus an impression-only
  // empirical ranking query (0 clicks) that must also be retained.
  storeRankSnapshot(workspaceId, '2026-05-30', [
    { query: LOW_ACTIONABILITY_RANKING, position: 6.0, clicks: 12, impressions: 240, ctr: 5.0 },
    { query: 'teeth cleaning sarasota', position: 70.0, clicks: 0, impressions: 4, ctr: 0 },
  ]);

  // CURATED (Population B) — a tracked keyword so the workspace has a non-empty universe.
  addTrackedKeyword(workspaceId, 'dentist near me', { volume: 1200, difficulty: 35 });
}, 30_000);

afterAll(async () => {
  if (workspaceId) deleteWorkspace(workspaceId);
  await ctx.stopServer();
});

async function fetchAllRows(): Promise<KeywordCommandCenterRowsResponse> {
  const res = await api(`${base()}/rows?filter=all&page=1&pageSize=100`);
  expect(res.status).toBe(200);
  return (await res.json()) as KeywordCommandCenterRowsResponse;
}

async function fetchSummary(): Promise<KeywordCommandCenterSummaryResponse> {
  const res = await api(`${base()}/summary`);
  expect(res.status).toBe(200);
  return (await res.json()) as KeywordCommandCenterSummaryResponse;
}

function facetCount(body: KeywordCommandCenterSummaryResponse, id: string): number {
  return body.filters.find((f) => f.id === id)?.count ?? -1;
}

function hasKeyword(body: KeywordCommandCenterRowsResponse, keyword: string): boolean {
  const target = keywordComparisonKey(keyword);
  return body.rows.some((r) => keywordComparisonKey(r.keyword) === target);
}

describe('Keyword Universe two-tier junk gate (real GET /rows?filter=all)', () => {
  it('HEADLINE: a real not-yet-ranking competitor keyword_gap (0 clicks/0 impressions) APPEARS', async () => {
    const body = await fetchAllRows();
    expect(hasKeyword(body, 'invisalign cost')).toBe(true);
  });

  it('TIER-1: the malformed boolean/quoted keyword_gap is ABSENT', async () => {
    const body = await fetchAllRows();
    expect(hasKeyword(body, JUNK_BOOLEAN)).toBe(false);
  });

  it('TIER-2: a discovery-only low-actionability provider gap (LOW_ACTIONABILITY_PHRASES) is ABSENT', async () => {
    // Seeded ONLY as a keyword_gap (no ranking twin), so its absence proves Tier-2
    // dropped the discovery candidate, not merely a string filter.
    const body = await fetchAllRows();
    expect(hasKeyword(body, LOW_ACTIONABILITY_DISCOVERY)).toBe(false);
  });

  it('TIER-2 NOT on ranking: a low-actionability GSC ranking query (clicks=12) STILL APPEARS', async () => {
    // Same low-actionability class as the dropped discovery gap, but seeded as
    // empirical ranking with clicks — Tier-2 must not relevance-drop it.
    const body = await fetchAllRows();
    expect(hasKeyword(body, LOW_ACTIONABILITY_RANKING)).toBe(true);
  });

  it('IMPRESSION-ONLY: an impression-only GSC ranking query (0 clicks) APPEARS', async () => {
    const body = await fetchAllRows();
    expect(hasKeyword(body, 'teeth cleaning sarasota')).toBe(true);
  });
});

/**
 * F1 regression guard — the /summary badges and /rows?filter=all must agree on
 * the SAME gated universe. Before the bundle-level gate, the summary recomputed
 * counts from RAW source loops (no gate), so its `counts.total` /
 * `filterCounts.all` / `rawEvidence` facet over-counted the 2 junk keyword_gaps
 * that the gated /rows path excludes. Numerator and denominator must share a
 * source (CLAUDE.md).
 *
 * The seed (beforeAll) has exactly: 1 real keyword_gap (invisalign cost), 1
 * Tier-1-junk keyword_gap (JUNK_BOOLEAN), 1 Tier-2-junk keyword_gap
 * (LOW_ACTIONABILITY_DISCOVERY) — so the gated rawEvidence facet sees only the
 * real one, and summary `total` must equal rows `totalRows`.
 */
describe('F1: /summary counts agree with the gated /rows?filter=all universe', () => {
  it('summary counts.total EQUALS rows pageInfo.totalRows (both exclude the 2 junk gaps)', async () => {
    const rows = await fetchAllRows();
    const summary = await fetchSummary();
    // Both paths now derive from the same gated candidate universe.
    expect(summary.counts.total).toBe(rows.pageInfo.totalRows);
    // And the `all` facet mirrors counts.total.
    expect(facetCount(summary, KEYWORD_COMMAND_CENTER_FILTERS.ALL)).toBe(rows.pageInfo.totalRows);
  });

  it('summary rawEvidence facet counts only the gated competitor gap (the 2 junk gaps are excluded)', async () => {
    const summary = await fetchSummary();
    const rows = await fetchAllRows();
    // Of the 3 seeded keyword_gaps, only `invisalign cost` survives the gate, and
    // it is the only one that is raw-evidence-only (no strategy/tracked/feedback
    // twin) — so the gated rawEvidence facet is exactly 1.
    expect(facetCount(summary, KEYWORD_COMMAND_CENTER_FILTERS.RAW_EVIDENCE)).toBe(1);
    // The real competitor gap appears in the gated rows (sanity: gate kept it).
    expect(hasKeyword(rows, 'invisalign cost')).toBe(true);
  });
});

/**
 * F2 regression guard — the /detail endpoint must not return a junk keyword.
 * /detail builds its own bundle and passed the FULL unfiltered gaps to
 * populateDraftRows, so a Tier-1-junk gap keyword had a base source and returned
 * a 200 row. With the bundle-level gate, the junk gap is dropped before the
 * keyword narrow, so hasBaseSource is false and the route returns 404.
 */
describe('F2: /detail on a junk keyword returns not-found (gated)', () => {
  it('Tier-1-junk keyword_gap → /detail 404 (never surfaced)', async () => {
    const res = await api(`${base()}/detail?keyword=${encodeURIComponent(JUNK_BOOLEAN)}`);
    expect(res.status).toBe(404);
  });

  it('Tier-2-junk keyword_gap → /detail 404 (never surfaced)', async () => {
    const res = await api(`${base()}/detail?keyword=${encodeURIComponent(LOW_ACTIONABILITY_DISCOVERY)}`);
    expect(res.status).toBe(404);
  });

  it('the real competitor gap → /detail 200 (gate kept it)', async () => {
    const res = await api(`${base()}/detail?keyword=${encodeURIComponent('invisalign cost')}`);
    expect(res.status).toBe(200);
  });
});
