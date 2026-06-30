/**
 * Phase 2 Task 2.1 — content-gap opportunity score spine swap.
 *
 * Calls `enrichKeywordStrategy` directly (no HTTP boot; no 13xxx port needed)
 * with a real workspace.
 *
 * Value-first content-gap scoring is now UNCONDITIONAL (the former
 * `keyword-value-scoring` flag has been retired). `computeOpportunityScore`
 * remains only as the value-first signal-gate FALLBACK.
 *
 * The two gaps:
 *   - 'what causes bad breath'  — informational, high volume (22000), diff 40
 *   - 'teeth cleaning sarasota' — transactional, low volume (480), diff 30, CPC 6
 *
 * Value-first: transactional/local gap scores higher than informational, and
 * the opportunityScore field diverges from the legacy `computeOpportunityScore(cg)`.
 *
 * relaxConservatism is tested both OFF and ON to prove the scoring path is
 * independent of the P4 flag (the spec §10 matrix).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';
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

describe('content-gap opportunityScore — value-first spine swap', () => {
  it('P4 OFF: transactional gap opportunityScore exceeds informational (value-first)', async () => {
    const result = await enrichKeywordStrategy(makeEnrichOptions(workspaceId, makeStrategy(), false));
    const gaps = result.strategy.contentGaps!;
    const infoScore = gaps.find(g => g.targetKeyword === 'what causes bad breath')!.opportunityScore!;
    const txnScore = gaps.find(g => g.targetKeyword === 'teeth cleaning sarasota')!.opportunityScore!;

    expect(txnScore).toBeGreaterThan(infoScore);
  });

  it('the opportunityScore field itself reflects value-first ordering (independent of the final volume-based sort)', async () => {
    // The opportunity score sort (line 629) correctly reorders by value-first, but the
    // subsequent impact-based sort (line 877) re-sorts by volume-bucket descending.
    // Both gaps have positive volume (bucket 2), so the final array order is by volume desc
    // (info 22000 > txn 480). The VALUE-FIRST CONTRACT is in the opportunityScore FIELD,
    // not in the final array position — both gaps still carry the value-first scores.
    const result = await enrichKeywordStrategy(makeEnrichOptions(workspaceId, makeStrategy(), false));
    const gaps = result.strategy.contentGaps!;
    const infoScore = gaps.find(g => g.targetKeyword === 'what causes bad breath')!.opportunityScore!;
    const txnScore = gaps.find(g => g.targetKeyword === 'teeth cleaning sarasota')!.opportunityScore!;
    // The value-first score correctly ranks transactional above informational.
    expect(txnScore).toBeGreaterThan(infoScore);
    // The legacy (volume-led) score would have informational leading — confirm we diverge.
    expect(infoScore).not.toBe(computeOpportunityScore(INFO_GAP));
  });
});

// ── PR kwv-real-cpc: cpc-fed value score ─────────────────────────────────────────────────
// When a content gap carries a real CPC, the commercialValue component is higher than the
// CPC_UNKNOWN (0.5) proxy path. Value-first scoring is unconditional now.
// relaxConservatism=true exercises the full OV / EMV path where CPC matters most.
describe('content-gap cpc — value score uses real CPC (kwv-real-cpc)', () => {
  function strategyWith(gap: StrategyContentGap): StrategyOutput {
    return { pageMap: [], contentGaps: [{ ...gap }], quickWins: [], siteKeywords: [] };
  }

  it('a content gap with a real cpc scores higher than the same gap with no cpc (commercialValue uses real CPC)', async () => {
    const withCpc = await enrichKeywordStrategy(
      makeEnrichOptions(
        workspaceId,
        strategyWith({ targetKeyword: 'commercial widget', intent: 'commercial', priority: 'high', volume: 1000, difficulty: 40, cpc: 15 }),
        true,
      ),
    );
    const noCpc = await enrichKeywordStrategy(
      makeEnrichOptions(
        workspaceId,
        strategyWith({ targetKeyword: 'commercial widget', intent: 'commercial', priority: 'high', volume: 1000, difficulty: 40 }),
        true,
      ),
    );
    const a = withCpc.strategy.contentGaps!.find(g => g.targetKeyword === 'commercial widget')!.opportunityScore!;
    const b = noCpc.strategy.contentGaps!.find(g => g.targetKeyword === 'commercial widget')!.opportunityScore!;
    expect(a).toBeGreaterThan(b);
  });
});

// ── Full-derive intent at enrichment:611 (score-consolidation PR 1 — review fix) ──────────
// StrategyContentGap.intent is a FREE-FORM AI-synthesized string (NOT the strict 4-bucket
// ContentGap.intent), so under the consolidated single classifier a 'comparison' intent
// reclassifies to commercial (0.7) instead of the old inline coercion's null → 0.5 default.
// This runs on the canonical relaxConservatism=true path, so it shifts cg.opportunityScore
// on every strategy generation. Proves the site is NOT value-inert.
describe('content-gap intent — full-derive at enrichment:611', () => {
  function strategyWith(...gaps: StrategyContentGap[]): StrategyOutput {
    return { pageMap: [], contentGaps: gaps.map(g => ({ ...g })), quickWins: [], siteKeywords: [] };
  }
  // Same volume/difficulty, non-local keywords — isolate the provided intent as the only variable.
  const COMPARISON_GAP: StrategyContentGap = { targetKeyword: 'widget comparison guide', intent: 'comparison', priority: 'medium', volume: 1000, difficulty: 40 };
  const COMMERCIAL_GAP: StrategyContentGap = { targetKeyword: 'premium widget options', intent: 'commercial', priority: 'medium', volume: 1000, difficulty: 40 };
  const INFORMATIONAL_GAP: StrategyContentGap = { targetKeyword: 'widget facts overview', intent: 'informational', priority: 'medium', volume: 1000, difficulty: 40 };

  it('a comparison-intent gap scores identically to a commercial-intent gap (comparison→commercial)', async () => {
    // relaxConservatism=true exercises the :611 intent through computeOpportunityValue.
    const result = await enrichKeywordStrategy(makeEnrichOptions(workspaceId, strategyWith(COMPARISON_GAP, COMMERCIAL_GAP), true));
    const gaps = result.strategy.contentGaps!;
    const cmp = gaps.find(g => g.targetKeyword === 'widget comparison guide')!.opportunityScore!;
    const com = gaps.find(g => g.targetKeyword === 'premium widget options')!.opportunityScore!;
    // PRE-MIGRATION: comparison→null→0.5 weight ≠ commercial→0.7 weight → different score.
    // POST-MIGRATION: both derive to 'commercial' → identical score.
    expect(cmp).toBe(com);
  });

  it('a comparison-intent gap outranks an informational gap (commercial 0.7 > informational 0.3)', async () => {
    const result = await enrichKeywordStrategy(makeEnrichOptions(workspaceId, strategyWith(COMPARISON_GAP, INFORMATIONAL_GAP), true));
    const gaps = result.strategy.contentGaps!;
    const cmp = gaps.find(g => g.targetKeyword === 'widget comparison guide')!.opportunityScore!;
    const inf = gaps.find(g => g.targetKeyword === 'widget facts overview')!.opportunityScore!;
    expect(cmp).toBeGreaterThan(inf);
  });
});
