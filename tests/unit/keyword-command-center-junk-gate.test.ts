/**
 * Task 2 — pure unit spec for the two-tier junk gate applied at the candidate
 * boundary in `addCandidateKeysFromBundle`.
 *
 * These assertions ARE the spec for the per-source gating decision: one fixture
 * of EACH population, asserting keep/drop with no DB and no HTTP. The test calls
 * `__candidateKeysForTest(bundle)` which returns the set of normalized candidate
 * keys that SURVIVE the gates — exactly the keys that can become rows.
 *
 * Coverage Contract (docs/superpowers/plans/2026-06-05-keyword-universe-overhaul.md):
 *  - TIER 1 (isJunkKeywordString): EVERY population — malformed strings dropped.
 *  - TIER 2 (isStrategyPoolEligibleKeyword): DISCOVERY ONLY (contentGaps +
 *    keywordGaps) — low-actionability NOISE dropped, real not-yet-ranking
 *    discovery RETAINED. Never applied to ranking/curated.
 */
import { describe, it, expect } from 'vitest';
import { __candidateKeysForTest } from '../../server/keyword-command-center.js';
import type { CommandCenterSourceBundle } from '../../server/keyword-command-center.js';
import { keywordComparisonKey } from '../../shared/keyword-normalization.js';
import { TRACKED_KEYWORD_STATUS, TRACKED_KEYWORD_SOURCE, type TrackedKeyword } from '../../shared/types/rank-tracking.js';
import type { ContentGap, KeywordGapItem, KeywordStrategy, PageKeywordMap } from '../../shared/types/workspace.js';
import type { LatestRank } from '../../shared/types/rank-tracking.js';

const JUNK_BOOLEAN = '"teeth whitening" "new patient" discount or special or package or offer';
const LOW_ACTIONABILITY = 'paper tiger'; // matches LOW_ACTIONABILITY_PHRASES (server/keyword-intelligence/rules.ts)

function makeTracked(query: string, overrides: Partial<TrackedKeyword> = {}): TrackedKeyword {
  return {
    query,
    pinned: false,
    addedAt: '2026-05-30T00:00:00.000Z',
    status: TRACKED_KEYWORD_STATUS.ACTIVE,
    source: TRACKED_KEYWORD_SOURCE.MANUAL,
    ...overrides,
  };
}

function makeLatestRank(query: string, overrides: Partial<LatestRank> = {}): LatestRank {
  return {
    query,
    position: 12,
    clicks: 0,
    impressions: 5,
    ctr: 0,
    ...overrides,
  };
}

function makeKeywordGap(keyword: string, overrides: Partial<KeywordGapItem> = {}): KeywordGapItem {
  return {
    keyword,
    volume: 500,
    difficulty: 40,
    competitorPosition: 4,
    competitorDomain: 'competitor.com',
    ...overrides,
  };
}

function makeContentGap(targetKeyword: string, overrides: Partial<ContentGap> = {}): ContentGap {
  return {
    topic: `Topic for ${targetKeyword}`,
    targetKeyword,
    intent: 'commercial',
    priority: 'high',
    rationale: 'test',
    volume: 600,
    difficulty: 30,
    ...overrides,
  };
}

function makeStrategy(overrides: Partial<KeywordStrategy> = {}): KeywordStrategy {
  return {
    siteKeywords: [],
    siteKeywordMetrics: [],
    opportunities: [],
    generatedAt: '2026-05-30T00:00:00.000Z',
    ...overrides,
  } as KeywordStrategy;
}

function emptyBundle(overrides: Partial<CommandCenterSourceBundle> = {}): CommandCenterSourceBundle {
  return {
    workspaceId: 'ws-junk',
    strategy: null,
    pageMap: [],
    contentGaps: [],
    keywordGaps: [],
    trackedKeywords: [],
    latestRanks: [],
    feedback: new Map(),
    lostVisibilityRows: [],
    includeStrategyUx: false,
    ...overrides,
  };
}

function survives(bundle: CommandCenterSourceBundle, keyword: string): boolean {
  return __candidateKeysForTest(bundle).has(keywordComparisonKey(keyword));
}

describe('two-tier junk gate — per-source candidate gating decision', () => {
  // ── TIER 1 (every population) ──────────────────────────────────────────────
  it('TIER 1: drops a malformed boolean/quoted string from a discovery keyword_gap', () => {
    const bundle = emptyBundle({ keywordGaps: [makeKeywordGap(JUNK_BOOLEAN)] });
    expect(survives(bundle, JUNK_BOOLEAN)).toBe(false);
  });

  it('TIER 1: drops a malformed boolean/quoted string from a content_gap', () => {
    const bundle = emptyBundle({ contentGaps: [makeContentGap(JUNK_BOOLEAN)] });
    expect(survives(bundle, JUNK_BOOLEAN)).toBe(false);
  });

  it('TIER 1: drops a malformed boolean/quoted string even from the RANKING population', () => {
    // Ranking is Tier-1 only, but Tier-1 still applies — a research-syntax/boolean
    // string is never a real keyword regardless of source.
    const bundle = emptyBundle({ latestRanks: [makeLatestRank(JUNK_BOOLEAN, { clicks: 99 })] });
    expect(survives(bundle, JUNK_BOOLEAN)).toBe(false);
  });

  it('TIER 1: drops a research-syntax string from a curated tracked keyword', () => {
    const bundle = emptyBundle({ trackedKeywords: [makeTracked('site:example.com pricing')] });
    expect(survives(bundle, 'site:example.com pricing')).toBe(false);
  });

  // ── TIER 2 (discovery only) ────────────────────────────────────────────────
  it('TIER 2: drops a low-actionability discovery keyword_gap (LOW_ACTIONABILITY_PHRASES)', () => {
    const bundle = emptyBundle({ keywordGaps: [makeKeywordGap(LOW_ACTIONABILITY)] });
    expect(survives(bundle, LOW_ACTIONABILITY)).toBe(false);
  });

  it('TIER 2: drops a low-actionability discovery content_gap', () => {
    const bundle = emptyBundle({ contentGaps: [makeContentGap(LOW_ACTIONABILITY)] });
    expect(survives(bundle, LOW_ACTIONABILITY)).toBe(false);
  });

  it('TIER 2 is NOT applied to ranking: a low-actionability GSC query with clicks SURVIVES', () => {
    // Same string that Tier-2 drops as discovery is KEPT when it is empirical
    // ranking data — a clicked keyword is never relevance-dropped.
    const bundle = emptyBundle({ latestRanks: [makeLatestRank(LOW_ACTIONABILITY, { clicks: 12 })] });
    expect(survives(bundle, LOW_ACTIONABILITY)).toBe(true);
  });

  it('TIER 2 is NOT applied to curated: a low-actionability tracked keyword SURVIVES', () => {
    const bundle = emptyBundle({ trackedKeywords: [makeTracked(LOW_ACTIONABILITY)] });
    expect(survives(bundle, LOW_ACTIONABILITY)).toBe(true);
  });

  it('TIER 2 is NOT applied to strategy siteKeywords: a low-actionability strategy keyword SURVIVES', () => {
    const bundle = emptyBundle({ strategy: makeStrategy({ siteKeywords: [LOW_ACTIONABILITY] }) });
    expect(survives(bundle, LOW_ACTIONABILITY)).toBe(true);
  });

  // ── HEADLINE invariant: real not-yet-ranking discovery is RETAINED ─────────
  it('HEADLINE: a real competitor keyword_gap (0 clicks/0 impressions, real volume) SURVIVES both gates', () => {
    const bundle = emptyBundle({
      keywordGaps: [makeKeywordGap('invisalign cost', { volume: 1900, difficulty: 40, competitorPosition: 4 })],
    });
    expect(survives(bundle, 'invisalign cost')).toBe(true);
  });

  it('HEADLINE: a real discovery content_gap with real volume SURVIVES both gates', () => {
    const bundle = emptyBundle({
      contentGaps: [makeContentGap('dental implants cost', { volume: 2400, difficulty: 50 })],
    });
    expect(survives(bundle, 'dental implants cost')).toBe(true);
  });

  // ── Legitimate keywords containing 'or'/'and' substrings must NOT be tripped ─
  it('does not false-positive a legitimate keyword containing "or"/"and" inside words', () => {
    const bundle = emptyBundle({ keywordGaps: [makeKeywordGap('organic android repair near me')] });
    expect(survives(bundle, 'organic android repair near me')).toBe(true);
  });
});
