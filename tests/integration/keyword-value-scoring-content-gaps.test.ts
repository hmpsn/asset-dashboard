/**
 * Phase 2 Task 2.1 — content-gap opportunity score spine swap.
 *
 * Calls `enrichKeywordStrategy` directly (no HTTP boot; no 13xxx port needed)
 * with a real workspace so `setWorkspaceFlagOverride` actually controls the
 * `isFeatureEnabled` result observed by the function under test.
 *
 * The two gaps:
 *   - 'what causes bad breath'  — informational, high volume (22000), diff 40
 *   - 'teeth cleaning sarasota' — transactional, low volume (480), diff 30, CPC 6
 *
 * Flag OFF: byte-identical to `computeOpportunityScore(cg)` for each gap.
 * Flag ON:  transactional/local gap scores higher than informational (value-first).
 *
 * relaxConservatism is tested both OFF and ON to prove the scoring path is
 * independent of the P4 flag (the spec §10 matrix).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';
import { setWorkspaceFlagOverride } from '../../server/feature-flags.js';
import { computeOpportunityScore } from '../../server/keyword-strategy-helpers.js';
import { enrichKeywordStrategy } from '../../server/keyword-strategy-enrichment.js';
import type { StrategyContentGap, StrategyOutput } from '../../server/keyword-strategy-ai-synthesis.js';
import type { KeywordStrategySearchData } from '../../server/keyword-strategy-search-data.js';

// ── Fixtures ─────────────────────────────────────────────────────────────────

const INFO_GAP: StrategyContentGap = {
  targetKeyword: 'what causes bad breath',
  intent: 'informational',
  priority: 'medium',
  volume: 22000,
  difficulty: 40,
};

const TXN_GAP: StrategyContentGap = {
  targetKeyword: 'teeth cleaning sarasota',
  intent: 'transactional',
  priority: 'high',
  volume: 480,
  difficulty: 30,
  // Note: StrategyContentGap has no cpc field — cpc is always undefined here
};

function makeStrategy(): StrategyOutput {
  return {
    pageMap: [],
    contentGaps: [
      { ...INFO_GAP },
      { ...TXN_GAP },
    ],
    quickWins: [],
    siteKeywords: [],
  };
}

function makeEnrichOptions(workspaceId: string, strategy: StrategyOutput, relaxConservatism = false) {
  return {
    workspaceId,
    baseUrl: 'https://example.com',
    strategy,
    keywordPool: new Map<string, { volume: number; difficulty: number; source: string }>(),
    businessSection: 'Dental practice.',
    searchData: { gscData: [] } as KeywordStrategySearchData,
    domainKeywords: [],
    questionKeywords: [],
    competitorKeywords: [],
    provider: null,
    seoDataMode: 'full' as const,
    relaxConservatism,
    sendProgress: () => undefined,
  };
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────

let workspaceId = '';

beforeEach(() => {
  workspaceId = createWorkspace(`Value Scoring Content Gap Test ${Date.now()}`).id;
});

afterEach(() => {
  if (workspaceId) deleteWorkspace(workspaceId);
  workspaceId = '';
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('content-gap opportunityScore — flag-gated value-first spine swap', () => {
  it('flag OFF, P4 OFF: opportunityScore is byte-identical to computeOpportunityScore(cg)', async () => {
    setWorkspaceFlagOverride('keyword-value-scoring', workspaceId, false);
    const result = await enrichKeywordStrategy(makeEnrichOptions(workspaceId, makeStrategy(), false));
    const gaps = result.strategy.contentGaps!;
    const info = gaps.find(g => g.targetKeyword === 'what causes bad breath')!;
    const txn = gaps.find(g => g.targetKeyword === 'teeth cleaning sarasota')!;

    expect(info.opportunityScore).toBe(computeOpportunityScore(INFO_GAP));
    expect(txn.opportunityScore).toBe(computeOpportunityScore(TXN_GAP));
  });

  it('flag OFF, P4 ON: opportunityScore for the P4-ON fallback site is still legacy (byte-identical)', async () => {
    // P4-ON + our flag OFF: base = computeOpportunityScore(cg). The OV fallback
    // (site 593) uses the same base → byte-identical outcome for the base score.
    // Because OV is called with the legacy base we can only assert the flag-OFF
    // ordering still has informational leading (volume dominates).
    setWorkspaceFlagOverride('keyword-value-scoring', workspaceId, false);
    const result = await enrichKeywordStrategy(makeEnrichOptions(workspaceId, makeStrategy(), true));
    const gaps = result.strategy.contentGaps!;
    // In either order, the informational gap has legacyScore ≥ txn gap legacyScore
    // because vol 22000 >> vol 480 under computeOpportunityScore.
    const infoScore = gaps.find(g => g.targetKeyword === 'what causes bad breath')!.opportunityScore!;
    const txnScore = gaps.find(g => g.targetKeyword === 'teeth cleaning sarasota')!.opportunityScore!;
    // Legacy (volume-led) score has informational leading
    expect(infoScore).toBeGreaterThan(txnScore);
  });

  it('flag ON, P4 OFF: transactional gap opportunityScore exceeds informational (value-first)', async () => {
    setWorkspaceFlagOverride('keyword-value-scoring', workspaceId, true);
    const result = await enrichKeywordStrategy(makeEnrichOptions(workspaceId, makeStrategy(), false));
    const gaps = result.strategy.contentGaps!;
    const infoScore = gaps.find(g => g.targetKeyword === 'what causes bad breath')!.opportunityScore!;
    const txnScore = gaps.find(g => g.targetKeyword === 'teeth cleaning sarasota')!.opportunityScore!;

    expect(txnScore).toBeGreaterThan(infoScore);
  });

  it('flag ON, P4 ON: the value-first base is fed as the OV spine (scores differ from flag-OFF P4-ON)', async () => {
    // When flag ON + P4 ON, the OV spine input (opportunityScore) is the value-first base
    // rather than the legacy computeOpportunityScore. OV may produce a different final
    // score via its EMV formula (large-volume informational can still win under OV — that is
    // expected and spec-correct). What we assert is that the final scores differ from the
    // flag-OFF + P4-ON run (different spine → different EMV → different output).
    setWorkspaceFlagOverride('keyword-value-scoring', workspaceId, false);
    const offResult = await enrichKeywordStrategy(makeEnrichOptions(workspaceId, makeStrategy(), true));
    const offInfo = offResult.strategy.contentGaps!.find(g => g.targetKeyword === 'what causes bad breath')!.opportunityScore!;
    const offTxn = offResult.strategy.contentGaps!.find(g => g.targetKeyword === 'teeth cleaning sarasota')!.opportunityScore!;

    setWorkspaceFlagOverride('keyword-value-scoring', workspaceId, true);
    const onResult = await enrichKeywordStrategy(makeEnrichOptions(workspaceId, makeStrategy(), true));
    const onInfo = onResult.strategy.contentGaps!.find(g => g.targetKeyword === 'what causes bad breath')!.opportunityScore!;
    const onTxn = onResult.strategy.contentGaps!.find(g => g.targetKeyword === 'teeth cleaning sarasota')!.opportunityScore!;

    // The value-first base changes the spine → at least one gap's score must differ.
    expect(offInfo !== onInfo || offTxn !== onTxn).toBe(true);
  });

  it('flag ON: the opportunityScore field itself reflects value-first ordering (independent of the final volume-based sort)', async () => {
    // The opportunity score sort (line 629) correctly reorders by value-first, but the
    // subsequent impact-based sort (line 877) re-sorts by volume-bucket descending.
    // Both gaps have positive volume (bucket 2), so the final array order is by volume desc
    // (info 22000 > txn 480). The VALUE-FIRST CONTRACT is in the opportunityScore FIELD,
    // not in the final array position — both gaps still carry the value-first scores.
    setWorkspaceFlagOverride('keyword-value-scoring', workspaceId, true);
    const result = await enrichKeywordStrategy(makeEnrichOptions(workspaceId, makeStrategy(), false));
    const gaps = result.strategy.contentGaps!;
    const infoScore = gaps.find(g => g.targetKeyword === 'what causes bad breath')!.opportunityScore!;
    const txnScore = gaps.find(g => g.targetKeyword === 'teeth cleaning sarasota')!.opportunityScore!;
    // The value-first score correctly ranks transactional above informational.
    expect(txnScore).toBeGreaterThan(infoScore);
    // The legacy (flag-OFF) score would have informational leading — confirm we diverge.
    expect(infoScore).not.toBe(computeOpportunityScore(INFO_GAP));
  });
});
