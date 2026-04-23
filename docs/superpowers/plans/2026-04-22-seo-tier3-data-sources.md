# SEO Tier 3 Quality Improvements — Data Source Integration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate GSC query data, SEMRush enrichment, and issue-type-specific recovery rates into six SEO recommendation pipelines so every page-level AI prompt gets the richest available data (not just `ws.keywordStrategy.businessContext`).

**Architecture:** Six small enrichment changes across five backend files. Each change adds a new data fetch (GSC query-page rows, SEMRush batch lookup, or rate-lookup table) before an existing AI call or summary calculation, then injects the new data into the existing prompt/calculation. No new routes, no new DB columns, no new shared types except the `DecayContext.topQueries` and `generateBrief` context extensions.

**Tech Stack:** Express + TypeScript, better-sqlite3, OpenAI (gpt-4.1-mini), Google Search Console API, SEMRush provider. No new dependencies.

---

## Overview

Six discrete enrichments:

| Item | File | What it adds |
|------|------|--------------|
| 12 | `server/keyword-recommendations.ts` | GSC queries as keyword candidates alongside SEMRush related terms |
| 13 | `server/content-decay.ts` | Per-page GSC query breakdown injected into the decay refresh AI prompt |
| 13b | `server/content-brief.ts` + `server/routes/content-requests.ts` | When a brief is generated for a request whose `targetPageSlug` matches a decaying page, inject the decay query context |
| 13c | `server/copy-refresh.ts` | `DecayContext.topQueries` populated from GSC, injected into the section-refresh AI prompt |
| 14 | `server/routes/jobs.ts` | Pre-fetch SEMRush metrics for top-N pages by existing primary keyword before the bulk analyze batch loop |
| 15 | `server/recommendations.ts` | Issue-type-specific recovery rates replacing the flat 12% in `estimatedGain` text and summary math |

All six are independent (different files, different functions), so they can be dispatched as one parallel batch of six tasks.

---

## Pre-requisites

- [ ] Spec committed (this document serves as both spec and plan — the user supplied a detailed implementation-ready spec inline)
- [ ] Pre-plan accuracy audit complete (done 2026-04-22). Findings folded into the plan below; line numbers in the spec drifted by up to 7 lines — all edit steps now anchor on string patterns instead of raw line numbers
- [ ] **Task 0 (pre-commit shared contracts) must land before Tasks 1 and 5 dispatch.** Two contracts:
  1. `KeywordCandidate.source` union in `shared/types/content.ts` must include `'gsc'` (currently `'pattern' | 'semrush_related' | 'ai_suggested'`). Task 1 inserts candidates with `source: 'gsc'` and will fail typecheck otherwise.
  2. `SeedWorkspaceOverrides` in `tests/fixtures/workspace-seed.ts` must accept `seoDataProvider?: string` and persist it to the workspace row, OR the test files must run a direct `db.prepare('UPDATE workspaces SET seo_data_provider = ? WHERE id = ?').run(...)` after seeding. Task 5's test needs this to exercise `getConfiguredProvider(ws?.seoDataProvider)`. Task 1's test also benefits. Pick the fixture-extension path — cleaner and reusable.

### Task 0 — Pre-commit contracts (Model: haiku — sequential, must land first)

**Files:**
- Modify: `shared/types/content.ts` (union extension)
- Modify: `tests/fixtures/workspace-seed.ts` (fixture signature + INSERT column)

**Steps:**

- [ ] **Extend the `KeywordCandidate.source` union**

Find the `KeywordCandidate` interface in `shared/types/content.ts`. The current `source` field reads:

```ts
source: 'pattern' | 'semrush_related' | 'ai_suggested';
```

Change to:

```ts
source: 'pattern' | 'semrush_related' | 'ai_suggested' | 'gsc';
```

- [ ] **Extend `SeedWorkspaceOverrides`**

In `tests/fixtures/workspace-seed.ts`, find the `SeedWorkspaceOverrides` interface (it currently accepts `tier`, `webflowToken`, `clientPassword`, `gscPropertyUrl`, `ga4PropertyId`). Add `seoDataProvider?: string` to the interface. Then in the seed function, thread that option into the workspace INSERT alongside the other optional columns. If the `workspaces` table doesn't have a `seo_data_provider` column exposed via the seed path, read the existing column list from the INSERT statement in that file and extend it following the same pattern; do not introduce a migration.

`webflowSiteId` is auto-generated during seed — tests must read it from the seed result (`seed.workspace.webflowSiteId`), not pass it in. The plan's test snippets that set `webflowSiteId: 'site_test_gsc'` are wrong; Task 1 and Task 2 tests should be adjusted to read from the seed result instead.

- [ ] **Verify typecheck still clean**

Run: `npm run typecheck`
Expected: zero errors. (This catches any other consumer of `KeywordCandidate.source` that may have exhaustive switches.)

- [ ] **Commit**

```bash
git add shared/types/content.ts tests/fixtures/workspace-seed.ts
git commit -m "chore(contracts): extend KeywordCandidate.source union and SeedWorkspaceOverrides for Tier 3 SEO enrichment"
```

---

## Task Dependencies

```
Sequential contract commit (must land first):
  Task 0 (shared contracts: KeywordCandidate.source union + seed fixture)

Parallel after Task 0:
  Task 1 (Item 12)  ∥  Task 2 (Item 13)  ∥  Task 3 (Item 13b)
  Task 4 (Item 13c) ∥  Task 5 (Item 14)  ∥  Task 6 (Item 15)

Sequential after parallel batch:
  Task 7 (Verification: typecheck, build, pr-check, tests)
  Task 8 (Docs: FEATURE_AUDIT.md, roadmap.json)
```

Rationale: Task 0 commits shared contracts (a type union and a test fixture) that Task 1 and Task 5 both depend on. Every other task owns a disjoint set of files. No task modifies `app.ts` or a barrel export.

### File Ownership Summary

| Task | Owns (create/modify) | Must not touch |
|------|----------------------|----------------|
| 1 | `server/keyword-recommendations.ts`, `tests/integration/keyword-recommendations-gsc.test.ts` | everything else |
| 2 | `server/content-decay.ts`, `tests/integration/content-decay-queries.test.ts` | everything else |
| 3 | `server/content-brief.ts`, `server/routes/content-requests.ts`, `tests/integration/content-brief-decay-context.test.ts` | everything else |
| 4 | `server/copy-refresh.ts`, `tests/integration/copy-refresh-queries.test.ts` | everything else |
| 5 | `server/routes/jobs.ts`, `tests/integration/bulk-analysis-semrush-prefetch.test.ts` | everything else |
| 6 | `server/recommendations.ts`, `tests/integration/recommendations-recovery-rates.test.ts` | everything else |
| 7 | (verification only — runs in main session, no code) | — |
| 8 | `FEATURE_AUDIT.md`, `data/roadmap.json`, `BRAND_DESIGN_LANGUAGE.md` (last only if applicable — it isn't for backend) | everything else |

---

## Model Assignments

| Task | Model | Reason |
|------|-------|--------|
| 1 (Item 12) | `sonnet` | Pattern-following with dedup/filter logic |
| 2 (Item 13) | `sonnet` | Prompt assembly with URL pathname matching |
| 3 (Item 13b) | `sonnet` | Two-file wiring (context type + caller fetch) |
| 4 (Item 13c) | `sonnet` | Interface extension + dynamic import + populate loop |
| 5 (Item 14) | `sonnet` | Pre-fetch loop with cache keying — needs edge-case awareness |
| 6 (Item 15) | `haiku` | Pure data-table lookup replacing a constant |
| 7 (verify) | `sonnet` | Full test-suite parse |
| 8 (docs) | `haiku` | FEATURE_AUDIT + roadmap entry transcription |

---

## Cross-Phase Contracts

This plan is **single-phase** (not multi-phase). No downstream phases depend on its outputs. No `docs/superpowers/plans/SEO_TIER3_CONTRACTS.md` is required.

---

## Task List

---

### Task 1 — Item 12: GSC queries as keyword candidates (Model: sonnet)

**Files:**
- Modify: `server/keyword-recommendations.ts:8` (add import), `:53-55` (filter function), `:104-108` (post-fetch enrichment block)
- Create: `tests/integration/keyword-recommendations-gsc.test.ts`

**Owns:** the two files above.
**Must not touch:** anything else.

- [ ] **Step 1: Read the current SEMRush fetch region**

Confirm `server/keyword-recommendations.ts` lines 104-108 still match the spec's anchor (`Promise.all([...getKeywordMetrics..., ...getRelatedKeywords])`). If the region has drifted, adjust anchors accordingly and report.

- [ ] **Step 2: Write the failing test**

Create `tests/integration/keyword-recommendations-gsc.test.ts` with port `13320`:

```ts
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { createTestContext } from './helpers.js';
import { seedWorkspace } from '../fixtures/workspace-seed.js';
import { getKeywordRecommendations, shouldIncludeKeywordCandidate } from '../../server/keyword-recommendations.js';

const ctx = createTestContext(13320);

describe('getKeywordRecommendations — GSC candidate enrichment', () => {
  let wsId: string;
  let cleanup: () => void;

  beforeAll(async () => {
    await ctx.start();
    const seed = seedWorkspace({
      gscPropertyUrl: 'https://example.com/',
    });
    wsId = seed.workspaceId;
    cleanup = seed.cleanup;
    // Note: webflowSiteId is auto-generated by the fixture. Task 1 production code
    // reads `ws.webflowSiteId` on the Workspace returned by getWorkspace — the
    // auto-generated value is sufficient for the path-check.

    // Mock getQueryPageData to return synthetic GSC rows
    vi.doMock('../../server/search-console.js', async (orig) => {
      const actual = await orig<typeof import('../../server/search-console.js')>();
      return {
        ...actual,
        getQueryPageData: async () => [
          { query: 'best plumber near me', page: 'https://example.com/plumbing', clicks: 50, impressions: 1200, position: 6.2, ctr: 4.1 },
          { query: 'plumber denver',        page: 'https://example.com/plumbing', clicks: 12, impressions: 340,  position: 9.1, ctr: 3.5 },
          { query: 'unrelated term',        page: 'https://example.com/other',    clicks: 2,  impressions: 40,   position: 22,  ctr: 5.0 },
          { query: 'low vol plumber',       page: 'https://example.com/plumbing', clicks: 0,  impressions: 3,    position: 40,  ctr: 0 },
        ],
      };
    });
  });

  afterAll(async () => {
    cleanup();
    await ctx.stop();
    vi.resetModules();
  });

  it('includes GSC queries with word overlap and impressions >= 10 as candidates', async () => {
    const result = await getKeywordRecommendations(wsId, 'plumber');
    const gsc = result.candidates.filter(c => c.source === 'gsc');
    expect(gsc.length).toBeGreaterThan(0);
    expect(gsc.some(c => c.keyword === 'best plumber near me')).toBe(true);
    // impressions < 10 dropped
    expect(gsc.some(c => c.keyword === 'low vol plumber')).toBe(false);
    // no word overlap dropped
    expect(gsc.some(c => c.keyword === 'unrelated term')).toBe(false);
  });

  it('shouldIncludeKeywordCandidate preserves gsc source', () => {
    expect(shouldIncludeKeywordCandidate('gsc', 0)).toBe(true);
    expect(shouldIncludeKeywordCandidate('gsc', 5)).toBe(true);
    expect(shouldIncludeKeywordCandidate('semrush_related', 5)).toBe(false);
    expect(shouldIncludeKeywordCandidate('pattern', 0)).toBe(true);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/integration/keyword-recommendations-gsc.test.ts`
Expected: FAIL (`source === 'gsc'` candidates do not exist yet, `shouldIncludeKeywordCandidate('gsc', 0)` returns `false`).

- [ ] **Step 4: Add the GSC import**

In `server/keyword-recommendations.ts`, find the existing import for `./search-console.js`. If none exists, add after line 8 (after the `seo-data-provider.js` import):

```ts
import { getQueryPageData } from './search-console.js';
```

Keep the import grouped with the other `./` imports at the top of the file (CLAUDE.md: imports at top of file, never mid-file).

- [ ] **Step 5: Update `shouldIncludeKeywordCandidate`**

Replace the body of `shouldIncludeKeywordCandidate` (currently at line 53-55):

```ts
export function shouldIncludeKeywordCandidate(source: string, volume: number): boolean {
  return source === 'pattern' || source === 'gsc' || volume >= 10;
}
```

- [ ] **Step 6: Add the GSC fetch block after the SEMRush Promise.all**

After the existing `Promise.all([...])` block (the one with `getKeywordMetrics` and `getRelatedKeywords`, currently lines 104-108), and after the `candidates` array is populated with seed + related keywords (i.e. after the `for (const r of related.slice(...))` loop), but **before** the `scored = candidates.filter(...)` step, insert:

```ts
  // Fetch GSC queries as additional candidates (proven search terms).
  // These are real queries the site already earns impressions for, complementing SEMRush's related-keyword universe.
  if (ws?.gscPropertyUrl && ws?.webflowSiteId) {
    try {
      const gscRows = await getQueryPageData(ws.webflowSiteId, ws.gscPropertyUrl, 90, { maxRows: 200 });
      const seedWords = new Set(
        seedKeyword.toLowerCase().split(/\s+/).filter(w => w.length > 2),
      );
      const relevantQueries = gscRows
        .filter(r => {
          const qWords = r.query.toLowerCase().split(/\s+/);
          return qWords.some(w => seedWords.has(w)) && r.impressions >= 10 && r.query.split(' ').length >= 2;
        })
        .sort((a, b) => b.impressions - a.impressions)
        .slice(0, 10);

      for (const r of relevantQueries) {
        if (!candidates.some(c => c.keyword.toLowerCase() === r.query.toLowerCase())) {
          candidates.push({
            keyword: r.query,
            volume: r.impressions, // GSC impressions used as volume proxy
            difficulty: 0,          // unknown — opportunityScore gives a conservative score
            cpc: 0,
            source: 'gsc',
            isRecommended: false,
          });
        }
      }
    } catch (err) {
      log.debug({ err, workspaceId }, 'GSC query enrichment failed — continuing without it');
    }
  }
```

The exact insertion point is immediately before the `// Score and sort by opportunity` comment (currently line 146).

- [ ] **Step 7: Run test to verify it passes**

Run: `npx vitest run tests/integration/keyword-recommendations-gsc.test.ts`
Expected: PASS (both `it` blocks green).

- [ ] **Step 8: Run the existing keyword-recommendations tests**

Run: `npx vitest run tests/integration/keyword-recommendations*.test.ts tests/unit/keyword-recommendations*.test.ts 2>&1 | tail -30`
Expected: PASS. If existing tests break, the new candidate source is leaking into a count assertion — adjust the test, not the production code.

- [ ] **Step 9: Commit**

```bash
git add server/keyword-recommendations.ts tests/integration/keyword-recommendations-gsc.test.ts
git commit -m "feat(keyword-recommendations): add GSC queries as candidate source (Item 12)"
```

---

### Task 2 — Item 13: GSC query breakdown in decay AI prompt (Model: sonnet)

**Files:**
- Modify: `server/content-decay.ts:9` (add import), `:253-287` (`generateRefreshRecommendation`)
- Create: `tests/integration/content-decay-queries.test.ts`

**Owns:** the two files above.
**Must not touch:** anything else. Note: `getQueryPageData` is already exported from `search-console.js` — do not modify it.

- [ ] **Step 1: Write the failing test**

Create `tests/integration/content-decay-queries.test.ts` with port `13321`:

```ts
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { createTestContext } from './helpers.js';
import { seedWorkspace } from '../fixtures/workspace-seed.js';

const ctx = createTestContext(13321);
let capturedPrompt = '';

vi.doMock('../../server/openai-helpers.js', async (orig) => {
  const actual = await orig<typeof import('../../server/openai-helpers.js')>();
  return {
    ...actual,
    callOpenAI: async (args: { messages: { role: string; content: string }[] }) => {
      capturedPrompt = args.messages[0].content;
      return { text: 'Refresh plan.' };
    },
  };
});

vi.doMock('../../server/search-console.js', async (orig) => {
  const actual = await orig<typeof import('../../server/search-console.js')>();
  return {
    ...actual,
    getQueryPageData: async () => [
      { query: 'best plumber near me', page: 'https://example.com/plumbing', clicks: 12, impressions: 800, position: 12.4, ctr: 1.5 },
      { query: 'plumber denver',        page: 'https://example.com/plumbing', clicks: 5,  impressions: 200, position: 14.1, ctr: 2.5 },
      { query: 'unrelated page term',   page: 'https://example.com/other',    clicks: 2,  impressions: 50,  position: 22.0, ctr: 4.0 },
    ],
  };
});

describe('generateRefreshRecommendation — GSC query breakdown', () => {
  let ws: import('../../server/workspaces.js').Workspace;
  let cleanup: () => void;

  beforeAll(async () => {
    await ctx.start();
    const seed = seedWorkspace({
      gscPropertyUrl: 'https://example.com/',
    });
    // webflowSiteId is auto-generated by the fixture; read it from the Workspace row
    ws = (await import('../../server/workspaces.js')).getWorkspace(seed.workspaceId)!;
    cleanup = seed.cleanup;
  });

  afterAll(async () => {
    cleanup();
    await ctx.stop();
    vi.resetModules();
  });

  it('injects top-impression queries for the specific page into the prompt', async () => {
    const { generateRefreshRecommendation } = await import('../../server/content-decay.js');
    await generateRefreshRecommendation(ws, {
      page: '/plumbing',
      currentClicks: 50, previousClicks: 200, clickDeclinePct: -75,
      currentImpressions: 2000, previousImpressions: 4000, impressionChangePct: -50,
      currentPosition: 12.4, previousPosition: 4.2, positionChange: 8.2,
      severity: 'critical',
    });
    expect(capturedPrompt).toContain('TOP SEARCH QUERIES FOR THIS PAGE');
    expect(capturedPrompt).toContain('best plumber near me');
    expect(capturedPrompt).toContain('plumber denver');
    // does not include queries from a different page
    expect(capturedPrompt).not.toContain('unrelated page term');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/integration/content-decay-queries.test.ts`
Expected: FAIL — prompt does not contain the expected substring.

- [ ] **Step 3: Add the import**

In `server/content-decay.ts`, modify line 9 (currently `import { getAllGscPages } from './search-console.js';`) to:

```ts
import { getAllGscPages, getQueryPageData } from './search-console.js';
```

- [ ] **Step 4: Add the query-breakdown block inside `generateRefreshRecommendation`**

Anchor by string, not line number — the spec's line numbers drifted by a few lines. Insert between the `formatForPrompt(intel, ...)` statement that produces `fullContext` and the `const prompt = ...` template literal that starts with ``You are an SEO content strategist. A page on this site is experiencing content decay``. Insert this block immediately after the `fullContext` assignment:

```ts
  // Fetch per-query GSC data for this specific page to show which queries are declining.
  let queryBreakdownBlock = '';
  if (ws.gscPropertyUrl && ws.webflowSiteId) {
    try {
      const qpData = await getQueryPageData(ws.webflowSiteId, ws.gscPropertyUrl, 90, { maxRows: 500 });
      const pageQueries = qpData
        .filter(r => {
          try { return new URL(r.page).pathname === page.page; } catch { return false; }
        })
        .sort((a, b) => b.impressions - a.impressions)
        .slice(0, 15);

      if (pageQueries.length > 0) {
        queryBreakdownBlock = `\n\nTOP SEARCH QUERIES FOR THIS PAGE (from Google Search Console — last 90 days):\n`;
        queryBreakdownBlock += pageQueries.map(q =>
          `- "${q.query}": ${q.clicks} clicks, ${q.impressions} impressions, pos ${q.position.toFixed(1)}, CTR ${q.ctr}%`,
        ).join('\n');
        queryBreakdownBlock += `\n\nUse these queries to understand what users are searching for when they find this page. Focus your refresh recommendations on improving relevance for the highest-impression queries.`;
      }
    } catch (err) {
      log.debug({ err, workspaceId: ws.id }, 'GSC query breakdown for decay page failed — continuing without it');
    }
  }
```

- [ ] **Step 5: Inject `queryBreakdownBlock` into the prompt**

Inside the `const prompt = \`...\`` template literal, find the exact substring:

```ts
${fullContext ? `SEO Context:\n${fullContext}\n` : ''}
```

and replace with:

```ts
${fullContext ? `SEO Context:\n${fullContext}\n` : ''}${queryBreakdownBlock}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run tests/integration/content-decay-queries.test.ts`
Expected: PASS.

- [ ] **Step 7: Run the existing content-decay tests**

Run: `npx vitest run tests/integration/content-decay*.test.ts tests/unit/content-decay*.test.ts 2>&1 | tail -20`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add server/content-decay.ts tests/integration/content-decay-queries.test.ts
git commit -m "feat(content-decay): include GSC query breakdown in refresh AI prompt (Item 13)"
```

---

### Task 3 — Item 13b: Decay query context in content briefs (Model: sonnet)

**Files:**
- Modify: `server/content-brief.ts:835-870` (add `decayQueryContext` to context type), `:1114` (inject into prompt template)
- Modify: `server/routes/content-requests.ts:22` (add `loadDecayAnalysis` import), `:183-249` (POST `/generate-brief` handler)
- Create: `tests/integration/content-brief-decay-context.test.ts`

**Owns:** the three files above.
**Must not touch:** anything else.

**Important constraint:** `ContentTopicRequest` does **not** have a `sourceUrl` field. It has `targetPageSlug`. Use `targetPageSlug` for matching decay pages — do NOT add a new field. If `targetPageSlug` is missing on a given request, skip the decay enrichment silently.

- [ ] **Step 1: Write the failing test**

Create `tests/integration/content-brief-decay-context.test.ts` with port `13322`:

```ts
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { createTestContext } from './helpers.js';
import { seedWorkspace } from '../fixtures/workspace-seed.js';

const ctx = createTestContext(13322);
let capturedBriefPrompt = '';

vi.doMock('../../server/openai-helpers.js', async (orig) => {
  const actual = await orig<typeof import('../../server/openai-helpers.js')>();
  return {
    ...actual,
    callOpenAI: async (args: { messages: { role: string; content: string }[] }) => {
      capturedBriefPrompt = args.messages[args.messages.length - 1].content;
      return { text: JSON.stringify({ executiveSummary: 'x', suggestedTitle: 't', suggestedMetaDesc: 'm', outline: [{ heading: 'H', notes: 'n', wordCount: 100 }], wordCountTarget: 1000, secondaryKeywords: [], contentFormat: 'guide', toneAndStyle: 'tone' }) };
    },
  };
});

describe('generateBrief — decay query context', () => {
  let cleanup: () => void;
  beforeAll(async () => { await ctx.start(); const s = seedWorkspace({}); cleanup = s.cleanup; });
  afterAll(async () => { cleanup(); await ctx.stop(); vi.resetModules(); });

  it('injects DECAY CONTEXT block when decayQueryContext is provided', async () => {
    const { generateBrief } = await import('../../server/content-brief.js');
    const s = seedWorkspace({});
    await generateBrief(s.workspaceId, 'best plumber', {
      decayQueryContext: 'DECAY CONTEXT: This page has lost 50% of search clicks. Top queries:\n- "best plumber denver": 10 clicks, 400 impressions, pos 15.0',
    });
    expect(capturedBriefPrompt).toContain('DECAY CONTEXT: This page has lost 50%');
    expect(capturedBriefPrompt).toContain('best plumber denver');
    s.cleanup();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/integration/content-brief-decay-context.test.ts`
Expected: FAIL — `decayQueryContext` is not an accepted field on the context parameter (TypeScript error) or the string is not in the prompt.

- [ ] **Step 3: Extend the `generateBrief` context type**

In `server/content-brief.ts`, find the `context` parameter type (currently defined inline at line 835-870). Add after the `pageAnalysisContext` field (currently ~line 866):

```ts
    /** If this brief is being generated for a decaying page, the pre-formatted decay query breakdown block to inject into the prompt. */
    decayQueryContext?: string;
```

- [ ] **Step 4: Inject `decayQueryContext` into the prompt**

In `server/content-brief.ts`, before the `const prompt = \`...\`` template literal (currently line 1106), add:

```ts
  const decayBlock = context.decayQueryContext ? `\n\n${context.decayQueryContext}` : '';
```

Then in the prompt template itself (currently line 1114), find the `${pageAnalysisBlock}` substring and replace with `${pageAnalysisBlock}${decayBlock}`:

```ts
${pagesStr}${keywordBlock}${brandVoiceBlock}${kwMapContext}${knowledgeBlock}${personasBlock}${providerMetricsBlock}${ga4Block}${pageAnalysisBlock}${decayBlock}${serpFeaturesDirectiveBlock}${referenceBlock}${serpBlock}${styleBlock}${templateBlock}${strategyCardBlock}${intelligenceBlock}${learningsBlock}
```

- [ ] **Step 5: Wire the caller in `server/routes/content-requests.ts`**

Modify the `getQueryPageData` import on line 22 to also pull `loadDecayAnalysis`:

```ts
import { getQueryPageData, getAllGscPages, getPageTrend } from '../search-console.js';
import { loadDecayAnalysis } from '../content-decay.js';
```

Inside the POST `/api/content-requests/:workspaceId/:id/generate-brief` handler, after the existing GSC `relatedQueries` block (currently ending at line 201) and before the SEO provider block (currently line 204), add:

```ts
    // If this content request targets a page that's decaying, compile a decay-specific query context.
    let decayQueryContext: string | undefined;
    if (request.targetPageSlug) {
      try {
        const decay = loadDecayAnalysis(req.params.workspaceId);
        const normalizeTarget = request.targetPageSlug.startsWith('/') ? request.targetPageSlug : `/${request.targetPageSlug}`;
        const decayPage = decay?.decayingPages.find(dp => dp.page === normalizeTarget);
        if (decayPage && ws.gscPropertyUrl && ws.webflowSiteId) {
          const qpRows = await getQueryPageData(ws.webflowSiteId, ws.gscPropertyUrl, 90, { maxRows: 500 });
          const pageQueries = qpRows
            .filter(r => { try { return new URL(r.page).pathname === decayPage.page; } catch { return false; } })
            .sort((a, b) => b.impressions - a.impressions)
            .slice(0, 15);
          if (pageQueries.length > 0) {
            decayQueryContext = `DECAY CONTEXT: This page has lost ${Math.abs(decayPage.clickDeclinePct)}% of search clicks. Top queries:\n` +
              pageQueries.map(q => `- "${q.query}": ${q.clicks} clicks, ${q.impressions} impressions, pos ${q.position.toFixed(1)}`).join('\n');
          }
        }
      } catch (err) {
        log.debug({ err }, 'Decay query context enrichment failed — continuing without it');
      }
    }
```

Then pass `decayQueryContext` into the `generateBrief` call. Find the `generateBrief(...)` invocation (currently line 239) and add the field to the options object:

```ts
    const brief = await generateBrief(req.params.workspaceId, request.targetKeyword, {
      relatedQueries,
      businessContext: ws.keywordStrategy?.businessContext || '',
      existingPages,
      keywordMetrics,
      relatedKeywords,
      providerLabel,
      pageType: request.pageType || 'blog',
      ga4PagePerformance,
      strategyCardContext,
      decayQueryContext,
    });
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run tests/integration/content-brief-decay-context.test.ts`
Expected: PASS.

- [ ] **Step 7: Run the existing content-brief and content-requests tests**

Run: `npx vitest run tests/integration/content-brief*.test.ts tests/integration/content-requests*.test.ts 2>&1 | tail -30`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add server/content-brief.ts server/routes/content-requests.ts tests/integration/content-brief-decay-context.test.ts
git commit -m "feat(content-brief): inject decay query context for briefs on decaying pages (Item 13b)"
```

---

### Task 4 — Item 13c: GSC query data in copy-refresh prompt (Model: sonnet)

**Files:**
- Modify: `server/copy-refresh.ts:21-26` (extend `DecayContext`), `:140-272` (`suggestCopyRefresh`), `:280-337` (`analyzeDecayForCopyRefresh`)
- Create: `tests/integration/copy-refresh-queries.test.ts`

**Owns:** the two files above.
**Must not touch:** anything else.

- [ ] **Step 1: Write the failing test**

Create `tests/integration/copy-refresh-queries.test.ts` with port `13323`:

```ts
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { createTestContext } from './helpers.js';
import { seedWorkspace } from '../fixtures/workspace-seed.js';

const ctx = createTestContext(13323);
let capturedPrompt = '';

vi.doMock('../../server/openai-helpers.js', async (orig) => {
  const actual = await orig<typeof import('../../server/openai-helpers.js')>();
  return {
    ...actual,
    callOpenAI: async (args: { messages: { role: string; content: string }[] }) => {
      capturedPrompt = args.messages[0].content;
      return { text: JSON.stringify({ suggestions: [] }) };
    },
  };
});

vi.doMock('../../server/copy-review.js', async (orig) => {
  const actual = await orig<typeof import('../../server/copy-review.js')>();
  return {
    ...actual,
    getSectionsForEntry: () => [
      { id: 'sec_1', sectionPlanItemId: 'sp_x_hero', generatedCopy: 'Old hero copy...' },
    ],
  };
});

describe('suggestCopyRefresh — topQueries in prompt', () => {
  let cleanup: () => void;
  beforeAll(async () => { await ctx.start(); const s = seedWorkspace({}); cleanup = s.cleanup; });
  afterAll(async () => { cleanup(); await ctx.stop(); vi.resetModules(); });

  it('includes topQueries in the AI prompt when provided', async () => {
    const { suggestCopyRefresh } = await import('../../server/copy-refresh.js');
    const s = seedWorkspace({});
    await suggestCopyRefresh(s.workspaceId, 'entry_x', {
      url: '/plumbing',
      decayType: 'click_decline',
      severity: 'critical',
      metrics: { clickDeclinePct: -60 },
      topQueries: [
        { query: 'best plumber near me', clicks: 10, impressions: 400, position: 15.2 },
        { query: 'plumber denver',        clicks: 3,  impressions: 120, position: 18.0 },
      ],
    });
    expect(capturedPrompt).toContain('Top search queries for this page');
    expect(capturedPrompt).toContain('best plumber near me');
    expect(capturedPrompt).toContain('pos 15.2');
    s.cleanup();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/integration/copy-refresh-queries.test.ts`
Expected: FAIL — `topQueries` is not an accepted field on `DecayContext`, or prompt does not contain the substring.

- [ ] **Step 3: Extend `DecayContext`**

In `server/copy-refresh.ts`, replace the existing `DecayContext` interface (currently lines 21-26) with:

```ts
export interface DecayContext {
  url: string;
  decayType: string;
  severity: string;
  metrics?: Record<string, number>;
  /** Top GSC queries for this page, ordered by impressions (highest first). Optional — enrichment is best-effort. */
  topQueries?: Array<{ query: string; clicks: number; impressions: number; position: number }>;
}
```

- [ ] **Step 4: Inject `queryStr` into the `suggestCopyRefresh` prompt**

In `suggestCopyRefresh`, after the `metricsStr` construction (currently line 171-173) and before the `const prompt = \`...\`` template (currently line 175), add:

```ts
  const queryStr = decayContext.topQueries?.length
    ? `\nTop search queries for this page:\n${decayContext.topQueries.map(q =>
        `- "${q.query}": ${q.clicks} clicks, ${q.impressions} impressions, pos ${q.position.toFixed(1)}`,
      ).join('\n')}`
    : '';
```

Then change the prompt template. The `Decay signals:` block currently reads:

```ts
Decay signals:
- URL: ${decayContext.url}
- Decay type: ${decayContext.decayType}
- Severity: ${decayContext.severity}
- Metrics: ${metricsStr}
```

Change the `- Metrics:` line to include `${queryStr}` at the end:

```ts
Decay signals:
- URL: ${decayContext.url}
- Decay type: ${decayContext.decayType}
- Severity: ${decayContext.severity}
- Metrics: ${metricsStr}${queryStr}
```

- [ ] **Step 5: Add `getWorkspace` import and populate `topQueries` in `analyzeDecayForCopyRefresh`**

In `server/copy-refresh.ts`, add to the existing top-of-file imports (group with other `./` imports):

```ts
import { getWorkspace } from './workspaces.js';
```

Inside `analyzeDecayForCopyRefresh`, after `const decay = loadDecayAnalysis(workspaceId);` and the early-return check (currently line 285-288), but before `const results: PageRefreshResult[] = [];` (line 290), add:

```ts
  // Fetch GSC query-page data once per workspace for all decaying-page enrichment.
  const ws = getWorkspace(workspaceId);
  let gscQueryData: Array<{ query: string; page: string; clicks: number; impressions: number; position: number }> = [];
  if (ws?.gscPropertyUrl && ws?.webflowSiteId) {
    try {
      const { getQueryPageData } = await import('./search-console.js'); // dynamic-import-ok: large module used only on decay path
      gscQueryData = await getQueryPageData(ws.webflowSiteId, ws.gscPropertyUrl, 90, { maxRows: 500 });
    } catch (err) {
      log.debug({ err, workspaceId }, 'GSC query data for copy refresh unavailable — continuing without it');
    }
  }
```

Then in the per-page loop, update the `decayContext` construction (currently line 296-308) to populate `topQueries`:

```ts
    const pageQueries = gscQueryData
      .filter(r => {
        try { return new URL(r.page).pathname === page.page; } catch { return false; }
      })
      .sort((a, b) => b.impressions - a.impressions)
      .slice(0, 10);

    const decayContext: DecayContext = {
      url: page.page,
      decayType: page.clickDeclinePct <= -50 ? 'severe_click_decline' : 'click_decline',
      severity: page.severity,
      metrics: {
        clickDeclinePct: page.clickDeclinePct,
        currentClicks: page.currentClicks,
        previousClicks: page.previousClicks,
        impressionChangePct: page.impressionChangePct,
        positionChange: page.positionChange,
        currentPosition: page.currentPosition,
      },
      topQueries: pageQueries.length > 0
        ? pageQueries.map(q => ({ query: q.query, clicks: q.clicks, impressions: q.impressions, position: q.position }))
        : undefined,
    };
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run tests/integration/copy-refresh-queries.test.ts`
Expected: PASS.

- [ ] **Step 7: Run existing copy-refresh tests**

Run: `npx vitest run tests/integration/copy-refresh*.test.ts tests/unit/copy-refresh*.test.ts 2>&1 | tail -20`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add server/copy-refresh.ts tests/integration/copy-refresh-queries.test.ts
git commit -m "feat(copy-refresh): pass GSC query data to section-refresh prompt (Item 13c)"
```

---

### Task 5 — Item 14: Pre-fetch SEMRush for top-N pages in bulk analysis (Model: sonnet)

**Files:**
- Modify: `server/routes/jobs.ts:56` (add `listPageKeywords`), import block; insert pre-fetch before `for (let i = 0; ...)` loop (currently line 728); replace `const semrushBlock = '';` (currently line 764)
- Create: `tests/integration/bulk-analysis-semrush-prefetch.test.ts`

**Owns:** the two files above.
**Must not touch:** anything else.

- [ ] **Step 1: Confirm imports already present**

In `server/routes/jobs.ts`, confirm that `getPageKeyword` is imported from `../page-keywords.js` (line 56). **Modify that import** to also pull `listPageKeywords`:

```ts
import { getPageKeyword, listPageKeywords, upsertPageKeywordsBatch, clearAnalysisFields, countPageKeywords, countAnalyzedPages } from '../page-keywords.js';
```

Then add a new import for the SEO data provider (grouped with other `../` imports at top of file):

```ts
import { getConfiguredProvider } from '../seo-data-provider.js';
```

- [ ] **Step 2: Write the failing test**

Create `tests/integration/bulk-analysis-semrush-prefetch.test.ts` with port `13324`. This is a unit-level integration test — rather than running the entire bulk-analyze job (which requires Webflow HTML fetching), exercise the pre-fetch logic via a small helper. **Before writing the test, check whether the pre-fetch block needs to be extracted into a named exported function** — if the PR cannot cover the logic without extracting, extract it as `export async function prefetchSemrushForTopPages(workspaceId, topN)` returning `Map<pagePath, block>`, and call that helper from the job loop. If extraction feels heavyweight, instead assert via smaller building blocks (see alternate test below).

Preferred test (requires extraction):

```ts
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { createTestContext } from './helpers.js';
import { seedWorkspace } from '../fixtures/workspace-seed.js';
import { upsertPageKeyword } from '../../server/page-keywords.js';

const ctx = createTestContext(13324);

vi.doMock('../../server/seo-data-provider.js', async (orig) => {
  const actual = await orig<typeof import('../../server/seo-data-provider.js')>();
  return {
    ...actual,
    getConfiguredProvider: () => ({
      name: 'semrush',
      getKeywordMetrics: async (kws: string[]) =>
        kws.map(k => ({ keyword: k, volume: 1000, difficulty: 40, cpc: 2.5, competition: 0.5 })),
      getRelatedKeywords: async () => [],
    }),
  };
});

describe('prefetchSemrushForTopPages — bulk analysis enrichment', () => {
  let wsId: string;
  let cleanup: () => void;
  beforeAll(async () => {
    await ctx.start();
    const s = seedWorkspace({ seoDataProvider: 'semrush' });
    wsId = s.workspaceId;
    cleanup = s.cleanup;
    upsertPageKeyword(wsId, { pagePath: '/plumbing',  primaryKeyword: 'best plumber', secondaryKeywords: [] });
    upsertPageKeyword(wsId, { pagePath: '/hvac',      primaryKeyword: 'hvac service', secondaryKeywords: [] });
  });
  afterAll(async () => { cleanup(); await ctx.stop(); vi.resetModules(); });

  it('returns a Map keyed by page path with REAL KEYWORD DATA blocks for pages with primary keywords', async () => {
    const { prefetchSemrushForTopPages } = await import('../../server/routes/jobs.js');
    const cache = await prefetchSemrushForTopPages(wsId, 10);
    expect(cache.get('/plumbing')).toContain('REAL KEYWORD DATA');
    expect(cache.get('/plumbing')).toContain('best plumber');
    expect(cache.get('/hvac')).toContain('hvac service');
  });
});
```

If extraction is declined by the implementer, fall back to this alternate assertion: seed two `page_keywords` rows, mock `getConfiguredProvider`, invoke the existing `POST /api/jobs/page-analysis/run` handler with a tiny page list, intercept `callOpenAI`, and assert one of the intercepted prompts contains `REAL KEYWORD DATA (from SEMRush — use these exact values`. The extraction path is simpler; prefer it.

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/integration/bulk-analysis-semrush-prefetch.test.ts`
Expected: FAIL — `prefetchSemrushForTopPages` is not exported, or (alternate) no prompt contains the substring.

- [ ] **Step 4: Extract the pre-fetch helper (preferred path)**

In `server/routes/jobs.ts`, before the route definition that owns the bulk analysis flow, add an exported helper:

```ts
/**
 * Pre-fetch SEMRush metrics for the top-N pages in a workspace that already have a primary keyword
 * assigned. Returns a Map from normalized page path (leading-slash) to a prompt-ready block.
 * Global SQLite cache in the SEMRush provider means repeat lookups cost zero API credits.
 */
export async function prefetchSemrushForTopPages(
  workspaceId: string,
  topN: number,
): Promise<Map<string, string>> {
  const cache = new Map<string, string>();
  const ws = getWorkspace(workspaceId);
  const provider = getConfiguredProvider(ws?.seoDataProvider);
  if (!provider) return cache;

  try {
    const existingPKs = listPageKeywords(workspaceId);
    const withKeywords = existingPKs
      .filter(pk => pk.primaryKeyword && pk.primaryKeyword.trim().length > 0)
      .slice(0, topN);
    if (withKeywords.length === 0) return cache;

    const keywords = withKeywords.map(pk => pk.primaryKeyword!);
    const metrics = await provider.getKeywordMetrics(keywords, workspaceId).catch(() => []);
    const metricsMap = new Map(metrics.map(m => [m.keyword.toLowerCase(), m]));

    for (const pk of withKeywords) {
      const m = metricsMap.get(pk.primaryKeyword!.toLowerCase());
      if (!m) continue;
      let block = `\n\nREAL KEYWORD DATA (from SEMRush — use these exact values, do NOT estimate):\n`;
      block += `- "${m.keyword}": vol ${m.volume.toLocaleString()}/mo, KD ${m.difficulty}/100, CPC $${m.cpc.toFixed(2)}, competition ${m.competition.toFixed(2)}`;
      const normalized = pk.pagePath.startsWith('/') ? pk.pagePath : `/${pk.pagePath}`;
      cache.set(normalized, block);
    }
    log.info({ workspaceId, cached: cache.size, attempted: withKeywords.length },
      'Pre-fetched SEMRush data for top pages in bulk analysis');
  } catch (err) {
    log.debug({ err, workspaceId }, 'SEMRush pre-fetch for bulk analysis failed — continuing without it');
  }
  return cache;
}
```

- [ ] **Step 5: Wire the helper into the bulk-analysis loop**

Inside the bulk analysis handler, immediately before `for (let i = 0; i < toAnalyze.length; i += BATCH) {` (currently line 728), add:

```ts
            const TOP_N_SEMRUSH = 10;
            const semrushCache = await prefetchSemrushForTopPages(paWsId, TOP_N_SEMRUSH);
```

Then replace the current `const semrushBlock = '';` line (currently line 764) with:

```ts
                  // Use pre-fetched SEMRush data for top pages; empty string for the rest.
                  const normalizedPath = page.path.startsWith('/') ? page.path : `/${page.path}`;
                  const semrushBlock = semrushCache.get(normalizedPath) || '';
```

The existing `applyBulkKeywordGuards(analysis, semrushBlock)` call (currently line 806) handles both cases correctly — pages with blocks keep real metrics, pages without get zeroed.

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run tests/integration/bulk-analysis-semrush-prefetch.test.ts`
Expected: PASS.

- [ ] **Step 7: Run the existing jobs tests**

Run: `npx vitest run tests/integration/jobs*.test.ts tests/integration/page-analysis*.test.ts 2>&1 | tail -30`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add server/routes/jobs.ts tests/integration/bulk-analysis-semrush-prefetch.test.ts
git commit -m "feat(jobs): pre-fetch SEMRush for top-N pages in bulk analysis (Item 14)"
```

---

### Task 6 — Item 15: Issue-type-specific recovery rates (Model: haiku)

**Files:**
- Modify: `server/recommendations.ts` — insert `RECOVERY_RATES` table and `getRecoveryRate` helper near top of file (after the existing `TrafficMap` interface, before `generateRecommendations`); update `estimatedGain` construction (currently lines 479-482); replace flat 12% in summary (currently lines 847-859)
- Create: `tests/integration/recommendations-recovery-rates.test.ts`

**Owns:** the two files above.
**Must not touch:** anything else.

- [ ] **Step 1: Write the failing test**

Create `tests/integration/recommendations-recovery-rates.test.ts` with port `13325`:

```ts
import { describe, it, expect } from 'vitest';
import { getRecoveryRate } from '../../server/recommendations.js';

describe('getRecoveryRate', () => {
  it('returns rate for a known issue type', () => {
    const r = getRecoveryRate('title');
    expect(r.perRec).toBe('10-25%');
    expect(r.summary).toBeCloseTo(0.18);
  });
  it('returns rate for a low-impact issue type', () => {
    const r = getRecoveryRate('og-image');
    expect(r.perRec).toBe('1-3%');
    expect(r.summary).toBeCloseTo(0.02);
  });
  it('returns default rate for unknown issue type', () => {
    const r = getRecoveryRate('made-up-issue');
    expect(r.perRec).toBe('5-15%');
    expect(r.summary).toBeCloseTo(0.12);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/integration/recommendations-recovery-rates.test.ts`
Expected: FAIL — `getRecoveryRate` is not exported from `../../server/recommendations.js`.

- [ ] **Step 3: Insert the `RECOVERY_RATES` table and helper**

In `server/recommendations.ts`, after the `TrafficMap` interface (currently line 39-40) and before the `// ─── Storage ──` comment, insert:

```ts
/** Issue-type-specific recovery rates for traffic estimation.
 * `perRec` is a user-facing percent range shown in estimatedGain text.
 * `summary` is the decimal multiplier applied to trafficAtRisk for the aggregate summary.
 * @internal exported for unit testing
 */
export interface RecoveryRate { perRec: string; summary: number }

const DEFAULT_RECOVERY: RecoveryRate = { perRec: '5-15%', summary: 0.12 };

const RECOVERY_RATES: Record<string, RecoveryRate> = {
  // High-impact content issues
  'title':                { perRec: '10-25%', summary: 0.18 },
  'meta-description':     { perRec: '5-15%',  summary: 0.10 },
  'h1':                   { perRec: '8-20%',  summary: 0.14 },
  'content-length':       { perRec: '10-30%', summary: 0.20 },
  'duplicate-title':      { perRec: '10-20%', summary: 0.15 },
  'duplicate-description':{ perRec: '5-10%',  summary: 0.08 },
  // Technical issues
  'canonical':            { perRec: '15-30%', summary: 0.22 },
  'indexability':         { perRec: '20-50%', summary: 0.35 },
  'robots':               { perRec: '15-40%', summary: 0.28 },
  'redirect-chains':      { perRec: '5-15%',  summary: 0.10 },
  'redirects':            { perRec: '10-25%', summary: 0.18 },
  'sitemap':              { perRec: '5-10%',  summary: 0.08 },
  'robots-txt':           { perRec: '5-15%',  summary: 0.10 },
  'response-time':        { perRec: '5-15%',  summary: 0.10 },
  'ssl':                  { perRec: '10-20%', summary: 0.15 },
  // Performance issues
  'cwv':                  { perRec: '5-15%',  summary: 0.10 },
  'cwv-lcp':              { perRec: '5-15%',  summary: 0.10 },
  'cwv-cls':              { perRec: '3-10%',  summary: 0.07 },
  'cwv-tbt':              { perRec: '3-10%',  summary: 0.07 },
  'render-blocking':      { perRec: '3-8%',   summary: 0.05 },
  // Low-impact issues
  'og-tags':              { perRec: '1-3%',   summary: 0.02 },
  'og-image':             { perRec: '1-3%',   summary: 0.02 },
  'img-alt':              { perRec: '2-5%',   summary: 0.03 },
  'structured-data':      { perRec: '5-15%',  summary: 0.10 },
  // Internal linking
  'internal-links':       { perRec: '5-15%',  summary: 0.10 },
  'link-text':            { perRec: '3-8%',   summary: 0.05 },
  'orphan-pages':         { perRec: '10-25%', summary: 0.18 },
};

export function getRecoveryRate(checkName: string): RecoveryRate {
  return RECOVERY_RATES[checkName] || DEFAULT_RECOVERY;
}
```

- [ ] **Step 4: Update `estimatedGain` construction for grouped audit recs**

In `generateRecommendations`, replace the block at lines 479-482:

```ts
      const estimatedGain =
        group.totalClicks > 0
          ? `Fixing this could increase organic clicks by 5-15% on ${group.pages.length} affected page${group.pages.length !== 1 ? 's' : ''}`
          : `Improves SEO health score and search engine compatibility across ${group.pages.length} page${group.pages.length !== 1 ? 's' : ''}`;
```

with:

```ts
      const rate = getRecoveryRate(group.check);
      const estimatedGain =
        group.totalClicks > 0
          ? `Fixing this could increase organic clicks by ${rate.perRec} on ${group.pages.length} affected page${group.pages.length !== 1 ? 's' : ''}`
          : `Improves SEO health score and search engine compatibility across ${group.pages.length} page${group.pages.length !== 1 ? 's' : ''}`;
```

- [ ] **Step 5: Replace the flat 12% in summary math**

Find the current summary block (currently lines 847-859):

```ts
  const activeRecs = recs.filter(r => r.status !== 'completed' && r.status !== 'dismissed');
  const totalTrafficAtRisk = activeRecs.reduce((s, r) => s + r.trafficAtRisk, 0);
  // Conservative 12% recovery rate on traffic at risk (actionable issues only)
  const actionableRecs = activeRecs.filter(r => r.priority === 'fix_now' || r.priority === 'fix_soon');
  const actionableTraffic = actionableRecs.reduce((s, r) => s + r.trafficAtRisk, 0);
  const actionableImpressions = actionableRecs.reduce((s, r) => s + r.impressionsAtRisk, 0);
  const summary = {
    fixNow: activeRecs.filter(r => r.priority === 'fix_now').length,
    fixSoon: activeRecs.filter(r => r.priority === 'fix_soon').length,
    fixLater: activeRecs.filter(r => r.priority === 'fix_later').length,
    ongoing: activeRecs.filter(r => r.priority === 'ongoing').length,
    totalImpactScore: activeRecs.reduce((s, r) => s + r.impactScore, 0),
    trafficAtRisk: totalTrafficAtRisk,
    estimatedRecoverableClicks: Math.round(actionableTraffic * 0.12),
    estimatedRecoverableImpressions: Math.round(actionableImpressions * 0.12),
  };
```

Replace with:

```ts
  const activeRecs = recs.filter(r => r.status !== 'completed' && r.status !== 'dismissed');
  const totalTrafficAtRisk = activeRecs.reduce((s, r) => s + r.trafficAtRisk, 0);
  const actionableRecs = activeRecs.filter(r => r.priority === 'fix_now' || r.priority === 'fix_soon');

  // Weighted recovery: each rec contributes traffic × its issue-specific recovery rate.
  let weightedRecoverableClicks = 0;
  let weightedRecoverableImpressions = 0;
  for (const r of actionableRecs) {
    const checkName = r.source?.startsWith('audit:site-wide:')
      ? r.source.replace('audit:site-wide:', '')
      : r.source?.startsWith('audit:')
        ? r.source.replace('audit:', '')
        : '';
    const rate = checkName ? getRecoveryRate(checkName) : DEFAULT_RECOVERY;
    weightedRecoverableClicks += r.trafficAtRisk * rate.summary;
    weightedRecoverableImpressions += r.impressionsAtRisk * rate.summary;
  }

  const summary = {
    fixNow: activeRecs.filter(r => r.priority === 'fix_now').length,
    fixSoon: activeRecs.filter(r => r.priority === 'fix_soon').length,
    fixLater: activeRecs.filter(r => r.priority === 'fix_later').length,
    ongoing: activeRecs.filter(r => r.priority === 'ongoing').length,
    totalImpactScore: activeRecs.reduce((s, r) => s + r.impactScore, 0),
    trafficAtRisk: totalTrafficAtRisk,
    estimatedRecoverableClicks: Math.round(weightedRecoverableClicks),
    estimatedRecoverableImpressions: Math.round(weightedRecoverableImpressions),
  };
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run tests/integration/recommendations-recovery-rates.test.ts`
Expected: PASS.

- [ ] **Step 7: Run existing recommendations tests**

Run: `npx vitest run tests/integration/recommendations*.test.ts tests/unit/recommendations*.test.ts 2>&1 | tail -20`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add server/recommendations.ts tests/integration/recommendations-recovery-rates.test.ts
git commit -m "feat(recommendations): issue-type-specific recovery rates (Item 15)"
```

---

### Task 7 — Verification (Model: sonnet)

Run in the main session after all six parallel tasks have merged back.

- [ ] **Step 1: Full typecheck**

Run: `npm run typecheck`
Expected: zero errors. (Not plain `npx tsc --noEmit` — that checks zero files per CLAUDE.md.)

- [ ] **Step 2: Production build**

Run: `npx vite build`
Expected: build succeeds.

- [ ] **Step 3: Full test suite**

Run: `npx vitest run 2>&1 | tail -60`
Expected: all suites pass. Failures outside the six files this plan touched are pre-existing and tracked separately — flag but do not fix in this PR unless caused by these changes.

- [ ] **Step 4: pr-check**

Run: `npx tsx scripts/pr-check.ts`
Expected: zero violations. Common failures and fixes:
- Bare `JSON.parse` on DB column → use `parseJsonSafe`. None expected here.
- `SUM()` without `COALESCE` → none expected.
- Local `let stmt` caching → none expected (no new DB access patterns added).
- Hard-coded studio name → n/a, backend prompts only.

- [ ] **Step 5: Six-item smoke check**

For each of the six items, run a manual smoke assertion against the test output to confirm the enrichment flows end-to-end:

```
Item 12 → npx vitest run tests/integration/keyword-recommendations-gsc.test.ts --reporter=verbose
Item 13 → npx vitest run tests/integration/content-decay-queries.test.ts --reporter=verbose
Item 13b → npx vitest run tests/integration/content-brief-decay-context.test.ts --reporter=verbose
Item 13c → npx vitest run tests/integration/copy-refresh-queries.test.ts --reporter=verbose
Item 14 → npx vitest run tests/integration/bulk-analysis-semrush-prefetch.test.ts --reporter=verbose
Item 15 → npx vitest run tests/integration/recommendations-recovery-rates.test.ts --reporter=verbose
```

All six must print PASS.

- [ ] **Step 6: Invoke code review**

Six files changed across two of the touchpoints + two files in Task 3 = ~9 files modified + 6 tests = ~15 files total. That crosses the scaled-review threshold. Invoke `scaled-code-review` per CLAUDE.md Quality Gates.

Fix every Critical and Important finding before merging. Do not defer fixable bugs.

---

### Task 8 — Docs (Model: haiku)

- [ ] **Step 1: Update `FEATURE_AUDIT.md`**

Add an entry under the appropriate SEO/analytics section summarizing each of the six items, with a link back to this plan file.

- [ ] **Step 2: Update `data/roadmap.json`**

For the Tier 3 SEO quality roadmap entry (the sprint item that triggered this plan), set `"status": "done"`, add a `"notes"` field with a one-line summary of all six items shipped, and run:

```bash
npx tsx scripts/sort-roadmap.ts
```

- [ ] **Step 3: `BRAND_DESIGN_LANGUAGE.md`**

No UI changes in this plan. Skip this step unless Task 7 surfaced a UI regression.

- [ ] **Step 4: Commit docs**

```bash
git add FEATURE_AUDIT.md data/roadmap.json
git commit -m "docs: mark Tier 3 SEO data-source improvements done"
```

---

## Systemic Improvements

### Shared utilities extracted
- `prefetchSemrushForTopPages(workspaceId, topN)` in `server/routes/jobs.ts` (Task 5) — reusable if other batch flows (e.g. strategy regeneration on large workspaces) later want the same hot-keyword prefetch pattern.
- `getRecoveryRate(checkName)` + `RECOVERY_RATES` table in `server/recommendations.ts` (Task 6) — a lookup table that other summary/reporting code can import if it also needs weighted traffic projections.

### Shared enrichment pattern (not extracted — below the 3× threshold)
Tasks 2, 3, and 4 each call `getQueryPageData(..., { maxRows: 500 })`, filter by `new URL(r.page).pathname === targetPath`, sort by impressions descending, slice the top-N, and format the result as a markdown list. This is three occurrences — right at the threshold. **Do not extract into a helper in this plan.** If a fourth caller appears, extract it as `getPageQueryBreakdown(workspaceId, pagePath, opts)` returning the sorted+sliced rows. Flag this to the code reviewer.

### pr-check rules to add
None required. The six changes don't introduce a new silent-failure class. The existing rules (`parseJsonSafe`, `createStmtCache`, `COALESCE(SUM)`) already cover this area.

### Test coverage added
Six new integration tests (one per item) at ports `13320`–`13325`. All use `seedWorkspace` + `createTestContext` + `vi.doMock` for external APIs (OpenAI, SEMRush provider, `getQueryPageData`). No new mock factories needed — existing fixtures cover the seed shape.

---

## Verification Strategy

| Surface | Verification |
|---------|--------------|
| Type safety | `npm run typecheck` — zero errors |
| Build | `npx vite build` — green |
| Unit/integration | `npx vitest run` — full suite green |
| pr-check | `npx tsx scripts/pr-check.ts` — zero violations |
| Per-item wiring | Six dedicated integration tests, one per item, each asserting the new data reaches the AI prompt / summary math |
| Regression | Run `tests/integration/keyword-recommendations*.test.ts`, `content-decay*`, `content-brief*`, `content-requests*`, `copy-refresh*`, `jobs*`, `recommendations*` — all must stay green |
| Code review | `scaled-code-review` (≥10 files changed) |

No UI changes → no preview screenshots, no `<TierGate>` audit, no BRAND_DESIGN_LANGUAGE update.

---

## Risks and Mitigations

- **GSC API rate limits.** Tasks 2, 3, 4 each call `getQueryPageData` per decay page / per brief generation. Existing call sites already use this endpoint — no new rate risk. All three calls are wrapped in try/catch with `log.debug` fallback, so GSC outages degrade gracefully.
- **SEMRush credit cost (Item 14).** The global SQLite cache (`getCachedMetricsBatch` inside the SEMRush provider) means repeated lookups cost zero credits. Worst case: first run of "Analyze All Pages" on a new workspace spends up to 10 credits. Acceptable per spec.
- **Pathname match false negatives.** All three pathname-matching sites use `new URL(r.page).pathname === page.page`. This works when `page.page` is a pathname (leading slash). Confirm seeding in tests uses leading-slash paths. If a workspace stores paths without leading slashes, Tasks 2/3/4 would silently match zero queries — add a normalization helper inline if needed, but do not extract (below the 3× threshold for a shared utility until proven).
- **Spec assumed `ContentRequest.sourceUrl` field that does not exist.** Task 3 addresses this by using `targetPageSlug` instead. No new field added. Documented in Task 3 preamble.

---

## Done Criteria

All of the following must be true before opening the PR to `staging`:

- [ ] 7 commits landed on the branch (6 feature + 1 docs; Task 7 is verification, no commit)
- [ ] `npm run typecheck` — clean
- [ ] `npx vite build` — green
- [ ] `npx vitest run` — green
- [ ] `npx tsx scripts/pr-check.ts` — clean
- [ ] FEATURE_AUDIT.md + roadmap.json updated
- [ ] scaled-code-review invoked; Critical/Important findings fixed in-PR
