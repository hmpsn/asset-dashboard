/**
 * Task 1 (Keyword Universe Overhaul) — Sort correctness unit tests.
 *
 * The two sort stages of the page-bounded pipeline MUST agree, or page-1 ≠
 * global-top-N. These tests pin:
 *   - clicks sort (desc by default; direction:'asc' reverses)
 *   - difficulty sort (by KD, NOT volume)
 *   - rank sort (position 1 before 9; missing position LAST in BOTH directions)
 *   - the DRIFT GUARD: candidate-sorted key order === row-sorted key order for
 *     the same fixture set, for every sort.
 *
 * Both sorters are unified behind a single comparator factory keyed by
 * KeywordCommandCenterSort, so they cannot drift.
 */
import { describe, it, expect } from 'vitest';
import {
  candidateSortForQuery,
  sortRowsForQuery,
  __candidateRowMetricParityForTest,
  type CommandCenterSourceBundle,
  type RowCandidateKey,
} from '../../server/keyword-command-center';
import type {
  KeywordCommandCenterRow,
  KeywordCommandCenterSort,
} from '../../shared/types/keyword-command-center';
import { keywordComparisonKey } from '../../shared/keyword-normalization';
import { TRACKED_KEYWORD_SOURCE, TRACKED_KEYWORD_STATUS, type LatestRank, type TrackedKeyword } from '../../shared/types/rank-tracking';

// ---------------------------------------------------------------------------
// Fixtures — same five keywords, expressed as both candidates and rows, with
// known clicks / difficulty / position / demand. The "key" is the comparison
// key (normalized) and is identical across the two representations so the
// drift guard can compare ordered key arrays directly.
// ---------------------------------------------------------------------------

interface Spec {
  key: string;
  keyword: string;
  clicks?: number;
  difficulty?: number;
  position?: number;
  demand: number;
}

const SPECS: Spec[] = [
  { key: 'alpha', keyword: 'alpha', clicks: 50, difficulty: 10, position: 9, demand: 100 },
  { key: 'bravo', keyword: 'bravo', clicks: 10, difficulty: 80, position: 1, demand: 400 },
  { key: 'charlie', keyword: 'charlie', clicks: 200, difficulty: 40, position: 3, demand: 50 },
  // delta: NO clicks, NO difficulty, NO position (the "missing always last" case)
  { key: 'delta', keyword: 'delta', demand: 250 },
  { key: 'echo', keyword: 'echo', clicks: 75, difficulty: 40, position: 3, demand: 250 },
];

function toCandidate(s: Spec): RowCandidateKey {
  return {
    key: s.key,
    keyword: s.keyword,
    sourcePriority: 2,
    demand: s.demand,
    rank: s.position,
    clicks: s.clicks,
    difficulty: s.difficulty,
  };
}

function toRow(s: Spec): KeywordCommandCenterRow {
  return {
    keyword: s.keyword,
    normalizedKeyword: s.key,
    lifecycleStatus: 'raw_evidence',
    statusLabel: 'Raw Evidence',
    sourceLabels: [],
    metrics: {
      volume: s.demand,
      difficulty: s.difficulty,
      currentPosition: s.position,
      clicks: s.clicks,
    },
    tracking: { status: 'not_tracked' },
    nextActions: [],
    isProtected: false,
  };
}

function candidateOrder(sort: KeywordCommandCenterSort, direction?: 'asc' | 'desc'): string[] {
  return SPECS.map(toCandidate).sort(candidateSortForQuery(sort, direction)).map((c) => c.key);
}

function rowOrder(sort: KeywordCommandCenterSort, direction?: 'asc' | 'desc'): string[] {
  return SPECS.map(toRow).sort(sortRowsForQuery(sort, direction)).map((r) => r.normalizedKeyword);
}

describe('keyword-command-center sort — clicks', () => {
  it('orders by clicks descending by default', () => {
    // clicks: charlie 200, echo 75, alpha 50, bravo 10, delta (missing → last)
    expect(rowOrder('clicks')).toEqual(['charlie', 'echo', 'alpha', 'bravo', 'delta']);
    expect(candidateOrder('clicks')).toEqual(['charlie', 'echo', 'alpha', 'bravo', 'delta']);
  });

  it("direction:'asc' reverses the clicks order but keeps missing LAST", () => {
    // asc: bravo 10, alpha 50, echo 75, charlie 200, delta (missing still last)
    expect(rowOrder('clicks', 'asc')).toEqual(['bravo', 'alpha', 'echo', 'charlie', 'delta']);
    expect(candidateOrder('clicks', 'asc')).toEqual(['bravo', 'alpha', 'echo', 'charlie', 'delta']);
  });
});

describe('keyword-command-center sort — difficulty', () => {
  it('orders by difficulty (KD) descending, NOT by volume', () => {
    // difficulty: bravo 80, charlie 40, echo 40 (tiebreak keyword → charlie<echo),
    // alpha 10, delta (missing → last). If it sorted by volume, bravo(400) would
    // still lead but echo(250)/delta(250)/charlie(50) would reorder differently.
    expect(rowOrder('difficulty')).toEqual(['bravo', 'charlie', 'echo', 'alpha', 'delta']);
    expect(candidateOrder('difficulty')).toEqual(['bravo', 'charlie', 'echo', 'alpha', 'delta']);
  });

  it("direction:'asc' reverses difficulty but keeps missing LAST", () => {
    // asc: alpha 10, charlie 40, echo 40 (keyword tiebreak), bravo 80, delta last
    expect(rowOrder('difficulty', 'asc')).toEqual(['alpha', 'charlie', 'echo', 'bravo', 'delta']);
    expect(candidateOrder('difficulty', 'asc')).toEqual(['alpha', 'charlie', 'echo', 'bravo', 'delta']);
  });
});

describe('keyword-command-center sort — opportunity (the Hub default)', () => {
  // opportunity = volume-weighted × ease(1 − difficulty). alpha (demand 100, KD 10)
  // is the most winnable; bravo (demand 400, KD 80) is high-volume but hard, so it
  // scores LOW — opportunity must NOT collapse to volume.
  it('leads with the most winnable keyword (high value × low difficulty), not the highest volume', () => {
    const desc = rowOrder('opportunity');
    expect(desc[0]).toBe('alpha');            // best opportunity, despite low volume
    expect(desc[desc.length - 1]).toBe('bravo'); // worst opportunity, despite high volume
  });

  it("direction:'asc' reverses the opportunity order", () => {
    const asc = rowOrder('opportunity', 'asc');
    expect(asc[0]).toBe('bravo');
    expect(asc[asc.length - 1]).toBe('alpha');
  });

  it('candidate order === row order for opportunity (drift guard, both directions)', () => {
    expect(candidateOrder('opportunity')).toEqual(rowOrder('opportunity'));
    expect(candidateOrder('opportunity', 'asc')).toEqual(rowOrder('opportunity', 'asc'));
  });
});

describe('keyword-command-center sort — rank', () => {
  it('puts position 1 before 9 and missing position LAST', () => {
    // position: bravo 1, charlie 3, echo 3 (keyword tiebreak), alpha 9, delta missing → last
    const rows = rowOrder('rank');
    expect(rows.indexOf('bravo')).toBeLessThan(rows.indexOf('alpha'));
    expect(rows).toEqual(['bravo', 'charlie', 'echo', 'alpha', 'delta']);
    expect(candidateOrder('rank')).toEqual(['bravo', 'charlie', 'echo', 'alpha', 'delta']);
  });

  it("keeps missing position LAST even with direction:'desc' (null is never flipped to the top)", () => {
    // desc: alpha 9, charlie 3, echo 3 (keyword tiebreak), bravo 1, delta STILL last
    const rows = rowOrder('rank', 'desc');
    expect(rows.at(-1)).toBe('delta');
    expect(rows).toEqual(['alpha', 'charlie', 'echo', 'bravo', 'delta']);
    const cands = candidateOrder('rank', 'desc');
    expect(cands.at(-1)).toBe('delta');
    expect(cands).toEqual(['alpha', 'charlie', 'echo', 'bravo', 'delta']);
  });
});

describe('keyword-command-center sort — keyword', () => {
  it('orders alphabetically ascending by default and reverses with desc', () => {
    expect(rowOrder('keyword')).toEqual(['alpha', 'bravo', 'charlie', 'delta', 'echo']);
    expect(candidateOrder('keyword')).toEqual(['alpha', 'bravo', 'charlie', 'delta', 'echo']);
    expect(rowOrder('keyword', 'desc')).toEqual(['echo', 'delta', 'charlie', 'bravo', 'alpha']);
    expect(candidateOrder('keyword', 'desc')).toEqual(['echo', 'delta', 'charlie', 'bravo', 'alpha']);
  });
});

describe('keyword-command-center sort — DRIFT GUARD', () => {
  const sorts: KeywordCommandCenterSort[] = ['keyword', 'demand', 'rank', 'clicks', 'difficulty'];
  const directions: Array<'asc' | 'desc' | undefined> = [undefined, 'asc', 'desc'];

  for (const sort of sorts) {
    for (const direction of directions) {
      it(`candidate order === row order for sort='${sort}' direction='${direction ?? 'default'}'`, () => {
        expect(candidateOrder(sort, direction)).toEqual(rowOrder(sort, direction));
      });
    }
  }
});

// ---------------------------------------------------------------------------
// DATA-PARITY drift guard. The comparator-only guard above can't catch the bug
// where the two stages feed DIFFERENT numbers to the same comparator. These
// tests assert candidate sort-metrics EQUAL the evaluated-row sort-metrics per
// key for clicks/rank/difficulty/demand, over bundles that exercise each of the
// three confirmed divergences (self-rank skip, variant aggregation, difficulty
// precedence). They FAIL on the pre-fix candidate stage.
// ---------------------------------------------------------------------------

function trackedKeyword(query: string, extra: Partial<TrackedKeyword> = {}): TrackedKeyword {
  return {
    query,
    pinned: false,
    addedAt: '2026-01-01T00:00:00.000Z',
    source: TRACKED_KEYWORD_SOURCE.MANUAL,
    status: TRACKED_KEYWORD_STATUS.ACTIVE,
    ...extra,
  };
}

function rank(query: string, position: number, clicks: number, impressions: number): LatestRank {
  return { query, position, clicks, impressions, ctr: impressions ? (clicks / impressions) * 100 : 0 };
}

function bundle(overrides: Partial<CommandCenterSourceBundle>): CommandCenterSourceBundle {
  return {
    workspaceId: 'ws-test',
    pageMap: [],
    contentGaps: [],
    keywordGaps: [],
    trackedKeywords: [],
    latestRanks: [],
    feedback: new Map(),
    includeStrategyUx: false,
    ...overrides,
  };
}

async function assertMetricParity(b: CommandCenterSourceBundle): Promise<void> {
  const { candidate, row } = await __candidateRowMetricParityForTest(b);
  // Every key the row stage materializes must also be a candidate with EQUAL
  // sort-metrics (and vice versa for keys the candidate stage produces).
  for (const [key, rowMetrics] of row) {
    const cand = candidate.get(key);
    expect(cand, `candidate missing key ${key}`).toBeDefined();
    expect({ key, ...cand }).toEqual({ key, ...rowMetrics });
  }
}

describe('keyword-command-center — candidate/row DATA parity', () => {
  it('self-rank: a tracked multi-token keyword that is also a GSC query keeps its OWN clicks/rank', async () => {
    // "victim keyword phrase" is tracked AND a GSC ranking query. Pre-fix the
    // candidate loop `continue`d it as a self-variant, so its candidate clicks
    // stayed undefined while its row clicks were 9000 — a clicks/rank drift.
    const b = bundle({
      trackedKeywords: [trackedKeyword('victim keyword phrase', { volume: 100, difficulty: 33 })],
      latestRanks: [
        rank('victim keyword phrase', 2.0, 9000, 50000),
        rank('unrelated filler one', 5.0, 5, 100),
        rank('unrelated filler two', 6.0, 3, 80),
      ],
    });
    const { candidate, row } = await __candidateRowMetricParityForTest(b);
    const key = keywordComparisonKey('victim keyword phrase');
    expect(row.get(key)?.clicks).toBe(9000);
    expect(candidate.get(key)?.clicks).toBe(9000); // <-- undefined before the fix
    expect(candidate.get(key)?.rank).toBe(2.0);
    await assertMetricParity(b);
  });

  it('variant aggregation: a parent whose clicks come only from a variant query shows the summed clicks', async () => {
    // Multi-token parent with NO direct rank; its clicks/impressions come from a
    // true variant ("blue widgets for sale" ⊃ "blue widgets"). The row stage sums
    // them onto the parent + takes MIN position; the candidate stage must match.
    const b = bundle({
      trackedKeywords: [trackedKeyword('blue widgets', { volume: 200 })],
      latestRanks: [
        rank('blue widgets for sale', 4.0, 120, 3000),
        rank('cheap blue widgets online', 7.0, 30, 900),
      ],
    });
    const { candidate, row } = await __candidateRowMetricParityForTest(b);
    const key = keywordComparisonKey('blue widgets');
    expect(row.get(key)?.clicks).toBe(150); // 120 + 30, summed onto the parent
    expect(candidate.get(key)?.clicks).toBe(150);
    expect(candidate.get(key)?.rank).toBe(4.0); // MIN(4, 7)
    await assertMetricParity(b);
  });

  it('difficulty precedence: tracked difficulty (last writer) wins over siteKeywordMetric difficulty', async () => {
    // "shared keyword" is BOTH a siteKeywordMetric (KD 20, merged first) and an
    // active tracked keyword (KD 70, merged last). Row stage = last-writer-wins =
    // 70. Pre-fix candidate = first-writer-wins = 20 → difficulty drift.
    const b = bundle({
      strategy: {
        siteKeywords: [],
        siteKeywordMetrics: [{ keyword: 'shared keyword', volume: 500, difficulty: 20 }],
        opportunities: [],
      } as unknown as CommandCenterSourceBundle['strategy'],
      trackedKeywords: [trackedKeyword('shared keyword', { volume: 500, difficulty: 70 })],
    });
    const { candidate, row } = await __candidateRowMetricParityForTest(b);
    const key = keywordComparisonKey('shared keyword');
    expect(row.get(key)?.difficulty).toBe(70);
    expect(candidate.get(key)?.difficulty).toBe(70); // <-- 20 before the fix
    await assertMetricParity(b);
  });

  it('combined bundle: every key agrees on demand/clicks/rank/difficulty', async () => {
    const b = bundle({
      strategy: {
        siteKeywords: [],
        siteKeywordMetrics: [{ keyword: 'shared keyword', volume: 500, difficulty: 20 }],
        opportunities: [],
      } as unknown as CommandCenterSourceBundle['strategy'],
      trackedKeywords: [
        trackedKeyword('shared keyword', { volume: 500, difficulty: 70 }),
        trackedKeyword('victim keyword phrase', { volume: 100, difficulty: 33 }),
        trackedKeyword('blue widgets', { volume: 200 }),
      ],
      contentGaps: [
        { topic: 'Guide', targetKeyword: 'content gap keyword', intent: 'informational', priority: 'high', rationale: 'x', volume: 300, difficulty: 55 },
      ],
      keywordGaps: [
        { keyword: 'competitor gap kw', volume: 400, difficulty: 60, competitorPosition: 3, competitorDomain: 'rival.com' },
      ],
      latestRanks: [
        rank('victim keyword phrase', 2.0, 9000, 50000),
        rank('blue widgets for sale', 4.0, 120, 3000),
        rank('cheap blue widgets online', 7.0, 30, 900),
        rank('standalone gsc query', 3.0, 42, 1200),
      ],
    });
    await assertMetricParity(b);
  });
});

// ---------------------------------------------------------------------------
// Phase 1 Task 1.1 — intent symmetry. The candidate resolver and the row stage
// must resolve `intent` from the SAME three sources in the SAME source order
// (pageMap.searchIntent → contentGaps.intent → trackedKeywords.intent), so
// last-writer-wins resolves identically on both sides. Drives the SAME parity
// probe (extended to expose intent) so a one-sided source add fails loudly.
// ---------------------------------------------------------------------------

describe('keyword-command-center — intent symmetry (Task 1.1)', () => {
  it('carries intent from trackedKeywords, pageMap.searchIntent, and contentGaps on BOTH stages', async () => {
    const b = bundle({
      trackedKeywords: [trackedKeyword('tracked kw', { volume: 100, intent: 'commercial' })],
      pageMap: [{
        pagePath: '/page-kw',
        pageTitle: 'Page KW',
        primaryKeyword: 'page kw',
        secondaryKeywords: [],
        searchIntent: 'transactional',
        volume: 200,
        difficulty: 40,
      }],
      contentGaps: [
        { topic: 'Guide', targetKeyword: 'gap kw', intent: 'informational', priority: 'high', rationale: 'x', volume: 300, difficulty: 55 },
      ],
    });
    const { candidate, row } = await __candidateRowMetricParityForTest(b);

    const trackedKey = keywordComparisonKey('tracked kw');
    const pageKey = keywordComparisonKey('page kw');
    const gapKey = keywordComparisonKey('gap kw');

    // candidate side
    expect(candidate.get(trackedKey)?.intent).toBe('commercial');
    expect(candidate.get(pageKey)?.intent).toBe('transactional');   // searchIntent → intent
    expect(candidate.get(gapKey)?.intent).toBe('informational');
    // row side — symmetric
    expect(row.get(trackedKey)?.intent).toBe('commercial');
    expect(row.get(pageKey)?.intent).toBe('transactional');
    expect(row.get(gapKey)?.intent).toBe('informational');

    // and the probe-wide parity assertion still holds with intent in the projection
    await assertMetricParity(b);
  });

  it('last-writer-wins: trackedKeywords.intent overrides pageMap.searchIntent for the same key (both stages agree)', async () => {
    // The same key appears as both a page primary keyword (searchIntent) AND a
    // tracked keyword (intent). trackedKeywords merge LAST in both stages, so its
    // intent must win on BOTH sides.
    const b = bundle({
      pageMap: [{
        pagePath: '/shared',
        pageTitle: 'Shared',
        primaryKeyword: 'shared intent kw',
        secondaryKeywords: [],
        searchIntent: 'informational',
        volume: 200,
      }],
      trackedKeywords: [trackedKeyword('shared intent kw', { volume: 200, intent: 'transactional' })],
    });
    const { candidate, row } = await __candidateRowMetricParityForTest(b);
    const key = keywordComparisonKey('shared intent kw');
    expect(candidate.get(key)?.intent).toBe('transactional'); // tracked wins
    expect(row.get(key)?.intent).toBe('transactional');
    await assertMetricParity(b);
  });
});
