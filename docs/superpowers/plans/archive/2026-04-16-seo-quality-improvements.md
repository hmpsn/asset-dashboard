# SEO Quality Improvements (Tiers 1 & 2) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

## Overview

Implement 11 targeted config, formula, and filter changes across 6 server files to reduce noise and improve SEO recommendation quality. Changes cover: keyword opportunity scoring (CPC factor, volume/difficulty rebalance), content decay noise thresholds, zero-volume keyword filtering, branded competitor query suppression, content gap impact scoring, and stripping AI-hallucinated metrics from bulk analysis.

No new data flows, endpoints, shared types, DB migrations, or frontend changes required.

## Pre-requisites

- [ ] Working directory is clean (`git status` shows no uncommitted changes)
- [ ] `npm run typecheck` passes before any work begins

---

## Task Dependencies

```
Parallel Batch 1 (all independent — different files):
  Task 1 (content-decay.ts)        ∥
  Task 2 (keyword-recommendations) ∥
  Task 3 (keyword-strategy.ts)     ∥
  Task 4 (analytics-intelligence)  ∥
  Task 5 (recommendations.ts)      ∥
  Task 6 (jobs.ts)

Sequential after Parallel Batch 1:
  Task 7 (Quality Gates)
```

**Why Task 2 is atomic:** All 5 keyword-recommendations changes (scoring rebalance, CPC factor, volume filter, call site, model, context window) touch the same file. They must be done by a single agent in sequence — splitting them across agents would cause merge conflicts.

**Why Tasks 1–6 are parallel:** Each task owns exactly one file (or one file + its test). No shared output is produced that another parallel task depends on. `opportunityScore` export (Task 2) does not need to be committed before analytics-intelligence changes (Task 4) — they are in different files with no import dependency.

---

## Task 1 — content-decay.ts: traffic floor + temperature (Model: haiku)

**Owns:**
- `server/content-decay.ts`

**Must not touch:**
- All other files

Two pure config changes. No test surface.

**Files:**
- Modify: `server/content-decay.ts:168`
- Modify: `server/content-decay.ts:282`

- [ ] **Step 1: Raise minimum clicks threshold from 5 to 25**

In `server/content-decay.ts` line 168, change:
```ts
if (!prev || prev.clicks < 5) continue; // Skip pages with no previous data or very low traffic
```
to:
```ts
if (!prev || prev.clicks < 25) continue; // Skip pages with no previous data or very low traffic
```

- [ ] **Step 2: Lower AI temperature from 0.7 to 0.3**

In `server/content-decay.ts` line 282, change:
```ts
    temperature: 0.7,
```
to:
```ts
    temperature: 0.3,
```

- [ ] **Step 3: Typecheck**

```bash
npm run typecheck
```
Expected: zero errors

- [ ] **Step 4: Commit**

```bash
git add server/content-decay.ts
git commit -m "fix(seo): raise content decay traffic floor to 25 clicks, lower AI temp to 0.3"
```

---

## Task 2 — keyword-recommendations.ts: scoring overhaul + volume filter + model upgrade (Model: sonnet)

**Owns:**
- `server/keyword-recommendations.ts`
- `tests/unit/keyword-recommendations.test.ts` (create)

**Must not touch:**
- All other files

Five changes to the same file, done sequentially within this task. TDD: write tests for `opportunityScore` first, then export + implement, then update call site.

**Context for executor:**
- `opportunityScore` is currently a private function (not exported). Export it with `@internal` JSDoc.
- `KeywordCandidate.cpc` is `number` (not optional) — passing `c.cpc` to the scorer is always type-safe.
- `c.source === 'pattern'` identifies the user's seed keyword (always keep it even if volume < 10). Only filter `semrush_related` candidates with low volume.
- The AI ranking path (`aiRankKeywords`) is called at line ~176 only when `useAI = true` — the model upgrade at line 238 affects only that path.

**Files:**
- Modify: `server/keyword-recommendations.ts:33-39` (function signature, weights, CPC bonus)
- Modify: `server/keyword-recommendations.ts:131-134` (volume filter + CPC call site)
- Modify: `server/keyword-recommendations.ts:229` (context window)
- Modify: `server/keyword-recommendations.ts:238` (model)
- Create: `tests/unit/keyword-recommendations.test.ts`

- [ ] **Step 1: Write failing unit tests**

Create `tests/unit/keyword-recommendations.test.ts`:

```ts
/**
 * Unit tests for the opportunityScore scoring function in keyword-recommendations.ts.
 * Verifies the 55/45 volume/difficulty weighting and CPC bonus behavior.
 */
import { describe, it, expect } from 'vitest';
import { opportunityScore } from '../../server/keyword-recommendations.js';

describe('opportunityScore', () => {
  it('returns 0 for zero-volume keywords', () => {
    expect(opportunityScore(0, 50)).toBe(0);
  });

  it('returns higher score for lower difficulty at equal volume', () => {
    const easyKw = opportunityScore(1000, 20);
    const hardKw = opportunityScore(1000, 80);
    expect(easyKw).toBeGreaterThan(hardKw);
  });

  it('returns higher score for higher volume at equal difficulty', () => {
    const lowVol = opportunityScore(100, 50);
    const highVol = opportunityScore(10000, 50);
    expect(highVol).toBeGreaterThan(lowVol);
  });

  it('high-volume keyword (1000 vol, 50 KD) beats low-volume (10 vol, 5 KD)', () => {
    // Old 40/60 weighting: 10-vol/5-KD scored ~65, beating 1000-vol/50-KD at ~54.
    // New 55/45 weighting: 1000-vol/50-KD scores ~56, 10-vol/5-KD scores ~54.
    const bigVol = opportunityScore(1000, 50);
    const smallVol = opportunityScore(10, 5);
    expect(bigVol).toBeGreaterThan(smallVol);
  });

  it('CPC bonus adds exactly 10 points for $5+ CPC (max bonus)', () => {
    const noCpc = opportunityScore(1000, 50, 0);
    const highCpc = opportunityScore(1000, 50, 5);
    expect(highCpc).toBe(noCpc + 10);
  });

  it('CPC bonus is proportional — $2.50 CPC adds 5 points', () => {
    const noCpc = opportunityScore(1000, 50, 0);
    const midCpc = opportunityScore(1000, 50, 2.5);
    expect(midCpc).toBe(noCpc + 5);
  });

  it('CPC bonus caps at 10 points even for very high CPC', () => {
    const capped = opportunityScore(1000, 50, 100);
    const maxBonus = opportunityScore(1000, 50, 5);
    expect(capped).toBe(maxBonus);
  });

  it('default CPC is 0 when argument is omitted', () => {
    expect(opportunityScore(1000, 50)).toBe(opportunityScore(1000, 50, 0));
  });

  it('maximum score (100k vol, 0 KD, $10 CPC) does not exceed 110', () => {
    // volScore=100, diffScore=100, cpcBonus=10 → 100*0.55 + 100*0.45 + 10 = 110
    const maxScore = opportunityScore(100000, 0, 10);
    expect(maxScore).toBeLessThanOrEqual(110);
    expect(maxScore).toBeGreaterThanOrEqual(0);
  });
});
```

- [ ] **Step 2: Run tests — expect compile/import failure (function not exported yet)**

```bash
npx vitest run tests/unit/keyword-recommendations.test.ts
```
Expected: FAIL — `opportunityScore` is not exported

- [ ] **Step 3: Export opportunityScore and rewrite formula**

In `server/keyword-recommendations.ts`, replace lines 33–39:
```ts
function opportunityScore(volume: number, difficulty: number): number {
  // Normalize volume: log scale (0 = 0, 10 = 33, 100 = 50, 1000 = 67, 10000 = 83, 100000 = 100)
  const volScore = volume <= 0 ? 0 : Math.min(100, (Math.log10(volume) / 5) * 100);
  // Invert difficulty: 0 difficulty = 100 score, 100 difficulty = 0 score
  const diffScore = 100 - difficulty;
  // Weighted: 40% volume, 60% difficulty (prefer achievable keywords)
  return Math.round(volScore * 0.4 + diffScore * 0.6);
}
```
with:
```ts
/** @internal exported for unit testing */
export function opportunityScore(volume: number, difficulty: number, cpc: number = 0): number {
  // Normalize volume: log scale (0 = 0, 10 = 33, 100 = 50, 1000 = 67, 10000 = 83, 100000 = 100)
  const volScore = volume <= 0 ? 0 : Math.min(100, (Math.log10(volume) / 5) * 100);
  // Invert difficulty: 0 difficulty = 100 score, 100 difficulty = 0 score
  const diffScore = 100 - difficulty;
  // CPC bonus: up to 10 points for high commercial intent (CPC $5+ = max bonus)
  const cpcBonus = Math.min(10, cpc * 2);
  // Weighted: 55% volume, 45% difficulty, plus CPC bonus
  return Math.round(volScore * 0.55 + diffScore * 0.45 + cpcBonus);
}
```

- [ ] **Step 4: Run tests — expect all 9 PASS**

```bash
npx vitest run tests/unit/keyword-recommendations.test.ts
```
Expected: 9 PASS

- [ ] **Step 5: Add volume filter and pass CPC to opportunityScore call site**

In `server/keyword-recommendations.ts`, replace lines 131–134:
```ts
  // Score and sort by opportunity
  const scored = candidates
    .map(c => ({ ...c, _score: opportunityScore(c.volume, c.difficulty) }))
    .sort((a, b) => b._score - a._score);
```
with:
```ts
  // Score and sort by opportunity
  const scored = candidates
    .filter(c => c.source === 'pattern' || c.volume >= 10) // Keep seed keyword; filter low-volume related keywords
    .map(c => ({ ...c, _score: opportunityScore(c.volume, c.difficulty, c.cpc) }))
    .sort((a, b) => b._score - a._score);
```

- [ ] **Step 6: Widen business context window from 1000 to 2500 chars**

In `server/keyword-recommendations.ts`, inside the template string for the AI prompt (around line 229), change:
```ts
${businessContext.slice(0, 1000)}
```
to:
```ts
${businessContext.slice(0, 2500)}
```

- [ ] **Step 7: Upgrade AI model from gpt-4.1-nano to gpt-4.1-mini**

In `server/keyword-recommendations.ts` at line 238, change:
```ts
    model: 'gpt-4.1-nano',
```
to:
```ts
    model: 'gpt-4.1-mini',
```

- [ ] **Step 8: Run tests — confirm all 9 still PASS**

```bash
npx vitest run tests/unit/keyword-recommendations.test.ts
```
Expected: 9 PASS

- [ ] **Step 9: Commit**

```bash
git add server/keyword-recommendations.ts tests/unit/keyword-recommendations.test.ts
git commit -m "feat(seo): rebalance opportunityScore 55/45, add CPC bonus, filter <10-vol keywords, upgrade AI model"
```

---

## Task 3 — keyword-strategy.ts: widen content snippet (Model: haiku)

**Owns:**
- `server/routes/keyword-strategy.ts`

**Must not touch:**
- All other files

**Files:**
- Modify: `server/routes/keyword-strategy.ts:991`

- [ ] **Step 1: Widen content snippet from 400 to 800 chars**

In `server/routes/keyword-strategy.ts` at line 991, change:
```ts
        if (p.contentSnippet) entry += `\n  Content: ${p.contentSnippet.slice(0, 400)}`;
```
to:
```ts
        if (p.contentSnippet) entry += `\n  Content: ${p.contentSnippet.slice(0, 800)}`;
```

- [ ] **Step 2: Commit**

```bash
git add server/routes/keyword-strategy.ts
git commit -m "fix(seo): double content snippet context from 400 to 800 chars in strategy batch prompt"
```

---

## Task 4 — analytics-intelligence.ts: filter branded queries from ranking opportunities and cannibalization (Model: sonnet)

**Owns:**
- `server/analytics-intelligence.ts`
- `tests/unit/analytics-intelligence.test.ts`

**Must not touch:**
- `server/competitor-brand-filter.ts` (already has all the logic needed — do NOT add code there)
- All other files

**Context for executor:**
- `extractBrandTokens` and `isBrandedQuery` are already imported at line 38 of `analytics-intelligence.ts`. No new imports needed.
- `extractBrandTokens(domain: string): string[]` — takes a single domain string, returns brand tokens (e.g. `"hubspot.com"` → `["hubspot"]`)
- `isBrandedQuery(keyword: string, tokens: string[]): boolean` — word-boundary match
- `ws.competitorDomains` is `string[] | undefined` on the workspace — guard with `?? []`
- Both `computeRankingOpportunities` and `computeCannibalizationInsights` are already exported. The `brandTokens` parameter is **optional** — existing tests that call these with one argument continue to compile and pass.
- The orchestrator (`computeAndPersistInsights`) already has `const ws = getWorkspace(workspaceId)` at line 1055. Extract brand tokens inside the `if (normQueryPageData.length > 0)` block (around line 1168), before the first compute call.
- Pass `brandTokens` directly (not a ternary). The functions already guard on `brandTokens?.length` — empty arrays are a no-op.

**Files:**
- Modify: `server/analytics-intelligence.ts:242-250` (computeRankingOpportunities)
- Modify: `server/analytics-intelligence.ts:290-302` (computeCannibalizationInsights)
- Modify: `server/analytics-intelligence.ts` (~line 1168, orchestrator)
- Modify: `tests/unit/analytics-intelligence.test.ts`

- [ ] **Step 1: Write failing tests for branded query filtering**

In `tests/unit/analytics-intelligence.test.ts`, append the following after the final `isStale` describe block (before end of file):

```ts
// ── Branded Query Filtering ───────────────────────────────────────

describe('computeRankingOpportunities — branded query filter', () => {
  // All three rows qualify by position (4-20) and impressions (>=50)
  const queryPageData: QueryPageRow[] = [
    { query: 'hubspot pricing', page: 'https://example.com/blog/crm-guide', clicks: 5, impressions: 500, ctr: 0.01, position: 8 },
    { query: 'best crm software', page: 'https://example.com/services', clicks: 10, impressions: 600, ctr: 0.017, position: 10 },
    { query: 'hubspot alternatives', page: 'https://example.com/blog/alternatives', clicks: 8, impressions: 400, ctr: 0.02, position: 7 },
  ];

  it('filters out queries containing competitor brand tokens', () => {
    const results = computeRankingOpportunities(queryPageData, ['hubspot']);
    const queries = results.map(r => r.data.query);
    expect(queries).not.toContain('hubspot pricing');
    expect(queries).not.toContain('hubspot alternatives');
    expect(queries).toContain('best crm software');
  });

  it('returns all qualifying results when no brandTokens provided', () => {
    const results = computeRankingOpportunities(queryPageData);
    expect(results.length).toBe(3);
  });

  it('returns all qualifying results when brandTokens is empty array', () => {
    const results = computeRankingOpportunities(queryPageData, []);
    expect(results.length).toBe(3);
  });
});

describe('computeCannibalizationInsights — branded query filter', () => {
  const queryPageData: QueryPageRow[] = [
    // Branded cannibalization — navigational, not actionable
    { query: 'salesforce crm', page: 'https://example.com/page-a', clicks: 20, impressions: 800, ctr: 0.025, position: 5 },
    { query: 'salesforce crm', page: 'https://example.com/page-b', clicks: 15, impressions: 600, ctr: 0.025, position: 9 },
    // Non-branded cannibalization — should remain
    { query: 'seo services', page: 'https://example.com/seo', clicks: 50, impressions: 1000, ctr: 0.05, position: 5 },
    { query: 'seo services', page: 'https://example.com/services', clicks: 20, impressions: 800, ctr: 0.025, position: 9 },
  ];

  it('filters out cannibalization for branded competitor queries', () => {
    const results = computeCannibalizationInsights(queryPageData, ['salesforce']);
    const queries = results.map(r => r.data.query);
    expect(queries).not.toContain('salesforce crm');
    expect(queries).toContain('seo services');
  });

  it('returns all cannibalization results when no brandTokens provided', () => {
    const results = computeCannibalizationInsights(queryPageData);
    expect(results.length).toBe(2);
  });

  it('returns all cannibalization results when brandTokens is empty array', () => {
    const results = computeCannibalizationInsights(queryPageData, []);
    expect(results.length).toBe(2);
  });
});
```

- [ ] **Step 2: Run — expect TypeScript compile failure**

```bash
npx vitest run tests/unit/analytics-intelligence.test.ts
```
Expected: FAIL — "Expected 1 arguments, but got 2" type error

- [ ] **Step 3: Update computeRankingOpportunities signature and filter**

In `server/analytics-intelligence.ts`, replace lines 242–250:
```ts
export function computeRankingOpportunities(
  queryPageData: QueryPageRow[],
): ComputedInsight<QuickWinData>[] {
  const candidates = queryPageData.filter(
    row =>
      row.position >= QUICK_WIN_MIN_POSITION &&
      row.position <= QUICK_WIN_MAX_POSITION &&
      row.impressions >= QUICK_WIN_MIN_IMPRESSIONS,
  );
```
with:
```ts
export function computeRankingOpportunities(
  queryPageData: QueryPageRow[],
  brandTokens?: string[],
): ComputedInsight<QuickWinData>[] {
  const candidates = queryPageData.filter(
    row =>
      row.position >= QUICK_WIN_MIN_POSITION &&
      row.position <= QUICK_WIN_MAX_POSITION &&
      row.impressions >= QUICK_WIN_MIN_IMPRESSIONS &&
      (!brandTokens?.length || !isBrandedQuery(row.query, brandTokens)),
  );
```

- [ ] **Step 4: Update computeCannibalizationInsights signature and filter**

In `server/analytics-intelligence.ts`, find `computeCannibalizationInsights` (around line 290). Replace the function signature and the opening `for` loop:
```ts
export function computeCannibalizationInsights(
  queryPageData: QueryPageRow[],
): ComputedInsight<CannibalizationData>[] {
  // Group rows by query, keeping only top-20 results
  const byQuery = new Map<string, QueryPageRow[]>();
  for (const row of queryPageData) {
    if (row.position > 20) continue;
    const existing = byQuery.get(row.query) ?? [];
    existing.push(row);
    byQuery.set(row.query, existing);
  }
```
with:
```ts
export function computeCannibalizationInsights(
  queryPageData: QueryPageRow[],
  brandTokens?: string[],
): ComputedInsight<CannibalizationData>[] {
  // Group rows by query, keeping only top-20 results
  const byQuery = new Map<string, QueryPageRow[]>();
  for (const row of queryPageData) {
    if (row.position > 20) continue;
    if (brandTokens?.length && isBrandedQuery(row.query, brandTokens)) continue;
    const existing = byQuery.get(row.query) ?? [];
    existing.push(row);
    byQuery.set(row.query, existing);
  }
```

- [ ] **Step 5: Extract brand tokens in orchestrator and pass to both call sites**

In `server/analytics-intelligence.ts`, inside `computeAndPersistInsights`, find the `if (normQueryPageData.length > 0)` block (around line 1168). Replace the opening and both compute calls — the only new code is the brand token extraction loop and the `brandTokens` arguments:

```ts
  if (normQueryPageData.length > 0) {
    const brandTokens: string[] = [];
    for (const domain of (ws.competitorDomains ?? [])) {
      brandTokens.push(...extractBrandTokens(domain));
    }

    const rankingOpps = computeRankingOpportunities(normQueryPageData, brandTokens);
    for (const insight of rankingOpps.slice(0, 20)) {
      enrichAndUpsert({
        insightType: 'ranking_opportunity',
        pageId: insight.pageId,
        data: insight.data,
        severity: insight.severity,
      });
    }
    deleteStaleInsightsByType(workspaceId, 'ranking_opportunity', cycleStart);
    log.info({ workspaceId, count: Math.min(rankingOpps.length, 20) }, 'Computed ranking opportunities');

    const cannibalization = computeCannibalizationInsights(normQueryPageData, brandTokens);
    for (const insight of cannibalization.slice(0, 15)) {
      enrichAndUpsert({
        insightType: 'cannibalization',
        pageId: insight.pageId,
        data: insight.data,
        severity: insight.severity,
      });
    }
```

Do not change any code after the `cannibalization` loop — only the block opening and the two compute call lines change.

- [ ] **Step 6: Run analytics-intelligence unit tests — expect all PASS**

```bash
npx vitest run tests/unit/analytics-intelligence.test.ts
```
Expected: all existing tests PASS (optional param is backward-compatible) + all 6 new branded-filter tests PASS

- [ ] **Step 7: Commit**

```bash
git add server/analytics-intelligence.ts tests/unit/analytics-intelligence.test.ts
git commit -m "fix(seo): filter branded competitor queries from ranking opportunities and cannibalization insights"
```

---

## Task 5 — recommendations.ts: volume/difficulty-aware content gap impact scoring (Model: sonnet)

**Owns:**
- `server/recommendations.ts`

**Must not touch:**
- All other files

**Context for executor:**
- `ContentGap` in `shared/types/workspace.ts` has `volume?: number` and `difficulty?: number` — both are optional. Guard before using.
- The formula is a pure expression replacement at line 606. The `cg` variable is the current `ContentGap` in the loop.
- Expected scores (for manual sense-check, not asserted in tests): `high`+10k vol → 85; `high`+0 vol → 65; `medium`+1k vol+KD80 → 55.

**Files:**
- Modify: `server/recommendations.ts:606`

- [ ] **Step 1: Replace static impact score with volume/difficulty-aware formula**

In `server/recommendations.ts` at line 606, replace:
```ts
        const impactScore = cg.priority === 'high' ? 65 : cg.priority === 'medium' ? 45 : 25;
```
with:
```ts
        const baseScore = cg.priority === 'high' ? 65 : cg.priority === 'medium' ? 45 : 25;
        // Boost impact score based on actual volume data when available
        const volumeBoost = cg.volume && cg.volume > 0
          ? Math.min(25, Math.round((Math.log10(cg.volume) / 5) * 25)) // up to +25 for high-volume gaps
          : 0;
        const difficultyPenalty = cg.difficulty && cg.difficulty > 60
          ? Math.round((cg.difficulty - 60) * 0.25) // -0 to -10 for very hard keywords
          : 0;
        const impactScore = Math.max(10, Math.min(100, baseScore + volumeBoost - difficultyPenalty));
```

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```
Expected: zero errors

- [ ] **Step 3: Commit**

```bash
git add server/recommendations.ts
git commit -m "fix(seo): use volume/difficulty data in content gap impact scoring formula"
```

---

## Task 6 — jobs.ts: zero out AI-hallucinated metrics in bulk analysis (Model: haiku)

**Owns:**
- `server/routes/jobs.ts`

**Must not touch:**
- All other files

**Context for executor:**
- `semrushBlock` is declared as `const semrushBlock = ''` at line 772 (it is never non-empty in this code path). The `!semrushBlock` guard is always true here, but it mirrors the pattern in `server/routes/keyword-strategy.ts:1051` and future-proofs against anyone adding SEMRush support to bulk analysis.
- The `analysis` object at line 813 is typed `any` (result of `JSON.parse`). Direct property assignment is valid.

**Files:**
- Modify: `server/routes/jobs.ts` (line 813)

- [ ] **Step 1: Zero out hallucinated keyword metrics after JSON.parse**

In `server/routes/jobs.ts`, find (around line 813):
```ts
                  const analysis = JSON.parse(aiResult.text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, ''));
                  batchResults.push({ page, analysis });
```
Replace with:
```ts
                  const analysis = JSON.parse(aiResult.text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, ''));
                  // SEMRush was skipped for bulk analysis — zero out AI-hallucinated metrics
                  // to prevent false confidence. Real data is fetched during individual page analysis.
                  if (!semrushBlock) {
                    analysis.keywordDifficulty = 0;
                    analysis.monthlyVolume = 0;
                  }
                  batchResults.push({ page, analysis });
```

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```
Expected: zero errors

- [ ] **Step 3: Commit**

```bash
git add server/routes/jobs.ts
git commit -m "fix(seo): zero AI-hallucinated keywordDifficulty/monthlyVolume in bulk page analysis"
```

---

## Task 7 — Quality Gates (Model: sonnet)

Run after all parallel tasks (1–6) are complete and their commits are present.

- [ ] **Step 1: Full typecheck**

```bash
npm run typecheck
```
Expected: zero errors

- [ ] **Step 2: Production build**

```bash
npx vite build
```
Expected: build succeeds, no errors

- [ ] **Step 3: Full test suite**

```bash
npx vitest run
```
Expected: all tests pass — including the 9 new `keyword-recommendations` unit tests and 6 new `analytics-intelligence` branded-filter tests

- [ ] **Step 4: pr-check**

```bash
npx tsx scripts/pr-check.ts
```
Expected: zero violations

- [ ] **Step 5: Update roadmap.json if this is a tracked item**

Mark any applicable items `"pending"` → `"done"` and run:
```bash
npx tsx scripts/sort-roadmap.ts
```

- [ ] **Step 6: Request code review**

This is a single-agent task (< 10 files). Use `superpowers:requesting-code-review`.

---

## Systemic Improvements

**Shared utilities to extract:** None needed. `competitor-brand-filter.ts` already provides `extractBrandTokens` and `isBrandedQuery` — this plan consumes them correctly.

**pr-check rules to consider:** A rule catching `gpt-4.1-nano` usage in substantive analysis paths (vs. lightweight classification) could prevent future regressions, but is low-priority given the small surface area. File under future work.

**Test coverage additions this plan requires:**
- `tests/unit/keyword-recommendations.test.ts` (new) — 9 tests for `opportunityScore` formula, weights, and CPC bonus
- `tests/unit/analytics-intelligence.test.ts` (extend) — 6 tests for branded query filter on both compute functions

---

## Verification Strategy

| Change | Verification |
|--------|-------------|
| Traffic floor / temperature | `npm run typecheck` — no behavioral test surface; logic is correct by inspection |
| `opportunityScore` rebalance + CPC | `npx vitest run tests/unit/keyword-recommendations.test.ts` — 9 tests |
| Volume filter | Covered by `opportunityScore` tests (filter uses `c.source`/`c.volume` which are typed on `KeywordCandidate`) |
| Model / context window | `npm run typecheck` — no test surface for config values |
| Strategy snippet length | `npm run typecheck` — no test surface for prompt slice size |
| Branded filter | `npx vitest run tests/unit/analytics-intelligence.test.ts` — 6 new tests + all existing pass |
| Content gap impact scoring | `npm run typecheck` — formula is pure arithmetic, verified by inspection against examples in task |
| Hallucinated metrics | `npm run typecheck` + existing `tests/integration/jobs-routes.test.ts` covers the bulk analysis path |
| Full suite | `npx vitest run` |
| Build integrity | `npx vite build` |
| Convention compliance | `npx tsx scripts/pr-check.ts` |

---

## Key Type Facts (for all executors)

- `KeywordCandidate.cpc` is `number` (non-optional) — always safe to pass to `opportunityScore`
- `ContentGap.volume` and `ContentGap.difficulty` are `number | undefined` — guard before use
- `ws.competitorDomains` is `string[] | undefined` — use `?? []` when iterating
- `extractBrandTokens(domain: string): string[]` — single domain in, tokens out
- `isBrandedQuery(keyword: string, tokens: string[]): boolean` — word-boundary match, min 2-char tokens
- `computeRankingOpportunities` and `computeCannibalizationInsights` new `brandTokens?: string[]` param is **optional** — backward-compatible with all existing callers
