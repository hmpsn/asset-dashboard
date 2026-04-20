# Strategy Generation Gap Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix six quick-win bugs, wire missing intelligence signals and add a safety guard, and clean up tech debt across the keyword strategy generation pipeline — shipped as three sequential PRs.

**Architecture:** Nearly all changes are in `server/routes/keyword-strategy.ts` (~2200 lines), with small satellite touches to `server/routes/jobs.ts`, `server/ws-events.ts`, `src/lib/wsEvents.ts`, and `server/routes/content-briefs.ts`. PRs are sequential: PR1 must merge to staging before PR2 starts, PR2 before PR3.

**Tech Stack:** Express/TypeScript backend, Server-Sent Events (SSE) for streaming progress, SQLite via better-sqlite3, React Query + WebSocket broadcasts for frontend cache invalidation, Vitest for unit/integration tests.

---

## Pre-requisites

- [ ] Spec reviewed and accepted (provided inline — no separate spec file)
- [ ] Pre-plan audit: **not required** — these are targeted bug fixes and single-site changes, not "all/every/throughout" refactors. Task 3a (flag consolidation) is a simple grep-and-replace of two string literals across ~6 files.
- [ ] No shared contracts to pre-commit — all types already exist; no new shared-types files needed

---

## Key File Reference

| Symbol | Location |
|--------|----------|
| `recsInFlight` guard (existing pattern) | `keyword-strategy.ts:65` |
| `let strategy: any` | `keyword-strategy.ts:881` |
| `declinedKeywords` declaration | `keyword-strategy.ts:851` |
| Incremental early-exit block | `keyword-strategy.ts:901–913` |
| `filterBrandedKeywords` call | `keyword-strategy.ts:999` |
| GSC summary with unwrapped `new URL()` | `keyword-strategy.ts:1255` |
| `competitorDomainsAtLastFetch` update | `keyword-strategy.ts:747` |
| `buildStrategyIntelligenceBlock` call | `keyword-strategy.ts:~1383` |
| `buildStrategySignals` import | `keyword-strategy.ts:50` |
| `updateWorkspace` save after generation | `keyword-strategy.ts:2122` |
| Success `return` | `keyword-strategy.ts:~2181` |
| Outer `catch` block | `keyword-strategy.ts:~2182` |
| `broadcastToWorkspace` source | `server/broadcast.js` |
| `WS_EVENTS` source | `server/ws-events.ts` |
| `StrategySignal.detail` field | `shared/types/insights.ts:31` |
| `ContentDecayData` shape | `shared/types/analytics.ts:263` |

---

## Task Dependencies

### PR 1

Tasks 1, 2, 3, 4, 5 are logically independent but Tasks 2–4 all modify `keyword-strategy.ts`. Safest sequential order:

```
Task 1 (ws-events.ts, wsEvents.ts)   ← parallel-safe with everything
Task 5 (jobs.ts)                     ← parallel-safe with everything

Sequential on keyword-strategy.ts (Tasks 2→3→4 can run back-to-back on same file):
  Task 2 (lines 901–913)
  Task 3 (line 1255)
  Task 4 (line 747)

Sequential after Task 1 (imports Task 1's new constant):
  Task 6 (lines ~2122 + import block)
```

**Recommended execution for single agent:** 1 → 5 → 2 → 3 → 4 → 6  
**For parallel dispatch:** Batch A: Task 1 ∥ Task 5 → Batch B: Tasks 2, 3, 4 (sequential on same file) → Task 6

### PR 2

All three tasks modify `keyword-strategy.ts`. Must be sequential. Task 9 modifies the early-exit block introduced by PR1 Task 2 — PR1 must be merged first.

```
Task 7 (~line 1383–1390)
Task 8 (~lines 999, post-pageMap, contentGaps)
Task 9 (~lines 65, 230, 901, 2181, catch)
```

### PR 3

Task 13 (type replacement) touches code throughout the file. Must run last.

```
Task 10 (keyword-strategy.ts:865, content-briefs.ts)
Task 11 (keyword-strategy.ts:1710–1715)
Task 12 (keyword-strategy.ts:~1388)
Task 13 (keyword-strategy.ts throughout — run last)
```

---

## PR 1: Quick-Win Bug Fixes

> ⚠️ **Task 1a is already done.** `generateRecommendations` is called post-generation via the `recsInFlight` guard at `keyword-strategy.ts:2174–2181`. Skip it.

### File Map

| File | Tasks |
|------|-------|
| `server/ws-events.ts` | Task 1 |
| `src/lib/wsEvents.ts` | Task 1 |
| `server/routes/keyword-strategy.ts` | Tasks 2, 3, 4, 6 |
| `server/routes/jobs.ts` | Task 5 |
| `tests/integration/keyword-strategy-incremental-sse.test.ts` | Task 2 (new) |

---

### Task 1 — Add STRATEGY_UPDATED event constants (Model: haiku)

**Owns:** `server/ws-events.ts`, `src/lib/wsEvents.ts`  
**Must not touch:** any file not listed above

- [ ] **Step 1: Add constant to server ws-events.ts**

In `server/ws-events.ts`, after line 105 (`RECOMMENDATIONS_UPDATED: 'recommendations:updated',`) and before `} as const;`, add:

```typescript
  // Keyword Strategy
  STRATEGY_UPDATED: 'strategy:updated',
```

- [ ] **Step 2: Mirror in frontend wsEvents.ts**

In `src/lib/wsEvents.ts`, after line 69 (`RECOMMENDATIONS_UPDATED: 'recommendations:updated',`) and before `} as const;`, add:

```typescript
  // Keyword Strategy
  STRATEGY_UPDATED: 'strategy:updated',
```

- [ ] **Step 3: Typecheck**

```bash
npm run typecheck
```

Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
git add server/ws-events.ts src/lib/wsEvents.ts
git commit -m "feat(ws-events): add STRATEGY_UPDATED event constant"
```

---

### Task 2 — SSE done event on incremental early exit (Model: sonnet)

**Owns:** `server/routes/keyword-strategy.ts` lines 901–913, `tests/integration/keyword-strategy-incremental-sse.test.ts`  
**Must not touch:** line 747 (Task 4), line 1255 (Task 3), lines 2122+ (Task 6), `server/ws-events.ts` (Task 1)

**Background:** When `mode=incremental` and all pages are already fresh, the handler returns early at line 901–913. On the SSE path it calls `sendProgress('complete', ...)` then `res.end()`, but never sends a `data:` event with `{ done: true }`. The frontend (`src/components/KeywordStrategy.tsx`) checks `evt.done && evt.strategy` to invalidate React Query caches — without this event the UI appears to hang after an incremental no-op.

- [ ] **Step 1: Write the failing test**

Create `tests/integration/keyword-strategy-incremental-sse.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestContext } from './helpers.js';
import { seedWorkspace } from '../fixtures/workspace-seed.js';

// Verify port is free: grep -r 'createTestContext(' tests/ | grep -o '1[0-9]\{4\}' | sort -n | tail -5
const PORT = 13320;

describe('keyword strategy — incremental early exit SSE', () => {
  let ctx: Awaited<ReturnType<typeof createTestContext>>;
  let cleanup: () => void;
  let workspaceId: string;

  beforeAll(async () => {
    ctx = await createTestContext(PORT);
    const seeded = await seedWorkspace(ctx.db);
    workspaceId = seeded.workspace.id;
    cleanup = seeded.cleanup;
  });

  afterAll(async () => {
    cleanup();
    await ctx.close();
  });

  it('sends { done: true, upToDate: true } data event on SSE incremental no-op', async () => {
    // With no pages seeded and mode=incremental, pagesToAnalyze.length === 0 → early exit.
    const res = await fetch(
      `http://localhost:${PORT}/api/webflow/keyword-strategy/${workspaceId}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
          ...(process.env.APP_PASSWORD ? { 'x-auth-token': process.env.APP_PASSWORD } : {}),
        },
        body: JSON.stringify({ mode: 'incremental' }),
      }
    );

    expect(res.ok).toBe(true);
    const text = await res.text();
    const dataLines = text.split('\n').filter(l => l.startsWith('data: '));
    const events = dataLines.map(l => {
      try { return JSON.parse(l.slice(6)); } catch { return null; }
    }).filter(Boolean);

    expect(events.length).toBeGreaterThan(0);
    const doneEvent = events.find((e: Record<string, unknown>) => e.done === true);
    expect(doneEvent).toBeDefined();
    expect(doneEvent?.upToDate).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run tests/integration/keyword-strategy-incremental-sse.test.ts
```

Expected: FAIL — `doneEvent` is `undefined` because the current code never sends a `data:` event on the early-exit SSE path.

- [ ] **Step 3: Implement the fix**

In `server/routes/keyword-strategy.ts`, find the early-exit block at lines 901–913:

```typescript
if (pagesToAnalyze.length === 0) {
  log.info({ workspaceId: ws.id }, 'Incremental mode: all pages already fresh, skipping re-analysis');
  sendProgress('complete', 'All pages are already up to date — no re-analysis needed.', 1.0);
  if (keepalive) clearInterval(keepalive);
  // Match the dual-response pattern used at the normal exit (line ~1999):
  // SSE callers already got progress events + the sendProgress('complete') above.
  // JSON callers need a proper response body — res.end() gives them an empty 200.
  if (wantsStream) {
    res.end();
  } else {
    res.json({ ok: true, upToDate: true, freshPageCount: pagesToPreserve.length });
  }
  return;
}
```

Replace the `if (wantsStream)` branch:

```typescript
if (pagesToAnalyze.length === 0) {
  log.info({ workspaceId: ws.id }, 'Incremental mode: all pages already fresh, skipping re-analysis');
  sendProgress('complete', 'All pages are already up to date — no re-analysis needed.', 1.0);
  if (keepalive) clearInterval(keepalive);
  if (wantsStream) {
    res.write(`data: ${JSON.stringify({ done: true, strategy: ws.keywordStrategy, upToDate: true })}\n\n`);
    res.end();
  } else {
    res.json({ ok: true, upToDate: true, freshPageCount: pagesToPreserve.length });
  }
  return;
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest run tests/integration/keyword-strategy-incremental-sse.test.ts
```

Expected: PASS.

- [ ] **Step 5: Typecheck**

```bash
npm run typecheck
```

Expected: zero errors.

- [ ] **Step 6: Commit**

```bash
git add server/routes/keyword-strategy.ts tests/integration/keyword-strategy-incremental-sse.test.ts
git commit -m "fix(keyword-strategy): send done SSE data event on incremental early exit"
```

---

### Task 3 — Wrap uncaught new URL() in GSC summary (Model: haiku)

**Owns:** `server/routes/keyword-strategy.ts` line 1255  
**Must not touch:** lines 901–913 (Task 2), line 747 (Task 4), lines 2122+ (Task 6)

**Background:** Line 1255 calls `new URL(r.page).pathname` without try/catch. Every other `new URL()` in this file is wrapped. A single malformed GSC URL crashes the entire strategy generation for that workspace.

- [ ] **Step 1: Fix the unwrapped call**

Find lines 1254–1255 in `server/routes/keyword-strategy.ts`:

```typescript
gscSummary = `\n\nTop GSC queries (last 90 days):\n` +
  topGsc.map(r => `- "${r.query}" → ${new URL(r.page).pathname} (pos: ${r.position.toFixed(1)}, clicks: ${r.clicks}, imp: ${r.impressions})`).join('\n');
```

Replace with:

```typescript
gscSummary = `\n\nTop GSC queries (last 90 days):\n` +
  topGsc.map(r => {
    let pagePath: string;
    try { pagePath = new URL(r.page).pathname; } catch { pagePath = r.page; }
    return `- "${r.query}" → ${pagePath} (pos: ${r.position.toFixed(1)}, clicks: ${r.clicks}, imp: ${r.impressions})`;
  }).join('\n');
```

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```

Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add server/routes/keyword-strategy.ts
git commit -m "fix(keyword-strategy): wrap new URL() in GSC summary with try/catch"
```

---

### Task 4 — Fix stale competitorDomainsAtLastFetch (Model: haiku)

**Owns:** `server/routes/keyword-strategy.ts` line 747  
**Must not touch:** lines 901–913 (Task 2), line 1255 (Task 3), lines 2122+ (Task 6)

**Background:** At line 747, `updateWorkspace` saves `competitorDomainsAtLastFetch: ws.competitorDomains ?? []`. But `ws` is a stale snapshot captured at request start — if the user submitted new `competitorDomains` in the request body, those were already saved to the DB at line 235 but `ws` still reflects the old value. The local variable `competitorDomains` (line 235) is the correct source.

- [ ] **Step 1: Fix the stale reference**

Find lines 744–748 in `server/routes/keyword-strategy.ts`:

```typescript
if (fetchCompetitors && (competitorKeywordData.length > 0 || keywordGaps.length > 0)) {
  updateWorkspace(ws.id, {
    competitorLastFetchedAt: new Date().toISOString(),
    competitorDomainsAtLastFetch: ws.competitorDomains ?? [],
  });
```

Replace `ws.competitorDomains ?? []` with `competitorDomains`:

```typescript
if (fetchCompetitors && (competitorKeywordData.length > 0 || keywordGaps.length > 0)) {
  updateWorkspace(ws.id, {
    competitorLastFetchedAt: new Date().toISOString(),
    competitorDomainsAtLastFetch: competitorDomains,
  });
```

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```

Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add server/routes/keyword-strategy.ts
git commit -m "fix(keyword-strategy): use request-body competitorDomains not stale ws snapshot for competitorDomainsAtLastFetch"
```

---

### Task 5 — Forward mode parameter from job system (Model: haiku)

**Owns:** `server/routes/jobs.ts` lines 537–544  
**Must not touch:** any file in `server/routes/keyword-strategy.ts`

**Background:** The job system calls the strategy endpoint internally but never forwards the `mode` parameter. A job queued with `params.mode: 'incremental'` silently runs a full regeneration instead.

- [ ] **Step 1: Extract and forward mode**

Find lines 537–544 in `server/routes/jobs.ts`:

```typescript
const businessContext = (params.businessContext as string) || stratWs.keywordStrategy?.businessContext || '';
const semrushMode = (params.semrushMode as string) || 'none';
const competitorDomains = (params.competitorDomains as string[]) || stratWs.competitorDomains || [];
const maxPages = params.maxPages != null ? Number(params.maxPages) : undefined;
const stratRes = await fetch(stratUrl, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...(APP_PASSWORD ? { 'x-auth-token': APP_PASSWORD } : {}) },
  body: JSON.stringify({ businessContext, semrushMode, competitorDomains, maxPages }),
});
```

Replace with:

```typescript
const businessContext = (params.businessContext as string) || stratWs.keywordStrategy?.businessContext || '';
const semrushMode = (params.semrushMode as string) || 'none';
const competitorDomains = (params.competitorDomains as string[]) || stratWs.competitorDomains || [];
const maxPages = params.maxPages != null ? Number(params.maxPages) : undefined;
const mode = (params.mode as string) || 'full';
const stratRes = await fetch(stratUrl, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...(APP_PASSWORD ? { 'x-auth-token': APP_PASSWORD } : {}) },
  body: JSON.stringify({ businessContext, semrushMode, competitorDomains, maxPages, mode }),
});
```

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```

Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add server/routes/jobs.ts
git commit -m "fix(jobs): forward mode parameter when calling keyword strategy endpoint"
```

---

### Task 6 — Broadcast STRATEGY_UPDATED via WebSocket (Model: sonnet)

**Owns:** `server/routes/keyword-strategy.ts` import block + lines 2122–2124  
**Must not touch:** lines 901–913 (Task 2), line 1255 (Task 3), line 747 (Task 4), `server/ws-events.ts` (owned by Task 1 — read-only here)

**Background:** After strategy is saved at line 2122, no WebSocket event is broadcast. Any open tab must poll or refresh to see the new strategy. The pattern from `server/routes/page-strategy.ts:143` (`broadcastToWorkspace(id, WS_EVENTS.BLUEPRINT_GENERATED, {...})`) is the model. Depends on Task 1 having added `STRATEGY_UPDATED` to `WS_EVENTS`.

- [ ] **Step 1: Verify imports not already present**

```bash
grep -n "broadcastToWorkspace\|from.*ws-events" server/routes/keyword-strategy.ts | head -10
```

Expected: no results (neither is currently imported in this file).

- [ ] **Step 2: Add imports**

In `server/routes/keyword-strategy.ts`, add these two lines after the last existing `import` statement (before `const log = createLogger('keyword-strategy');` at line 60):

```typescript
import { broadcastToWorkspace } from '../broadcast.js';
import { WS_EVENTS } from '../ws-events.js';
```

- [ ] **Step 3: Add broadcast call**

Find line 2122 in `server/routes/keyword-strategy.ts`:

```typescript
updateWorkspace(ws.id, { keywordStrategy });
clearSeoContextCache(ws.id);
```

Add the broadcast immediately after `updateWorkspace`:

```typescript
updateWorkspace(ws.id, { keywordStrategy });
broadcastToWorkspace(ws.id, WS_EVENTS.STRATEGY_UPDATED, {
  pageCount: pageMap.length,
  siteKeywords: keywordStrategy.siteKeywords?.length || 0,
});
clearSeoContextCache(ws.id);
```

- [ ] **Step 4: Typecheck + build**

```bash
npm run typecheck && npx vite build
```

Expected: zero errors.

- [ ] **Step 5: Run full test suite**

```bash
npx vitest run
```

Expected: all tests pass.

- [ ] **Step 6: Run pr-check**

```bash
npx tsx scripts/pr-check.ts
```

Expected: zero errors.

- [ ] **Step 7: Commit**

```bash
git add server/routes/keyword-strategy.ts
git commit -m "feat(keyword-strategy): broadcast STRATEGY_UPDATED websocket event after generation"
```

---

## PR 2: Wire Missing Intelligence + Safety Guards

> **Prerequisite:** PR 1 merged to staging and verified before starting.

### File Map

| File | Tasks |
|------|-------|
| `server/routes/keyword-strategy.ts` | Tasks 7, 8, 9 |
| `tests/unit/keyword-strategy-declined-filter.test.ts` | Task 8 (new) |
| `tests/integration/keyword-strategy-concurrent-guard.test.ts` | Task 9 (new) |

---

### Task 7 — Wire performanceDeltas into intelligence block (Model: sonnet)

**Owns:** `server/routes/keyword-strategy.ts` lines ~1383–1390 and import line 46  
**Must not touch:** lines ~999 (Task 8), lines ~65/230/901/2181/catch (Task 9)

**Background:** `buildStrategyIntelligenceBlock` at line 1383 accepts `performanceDeltas?: Array<{ query, positionDelta, clicksDelta, currentPosition }>` but always receives `undefined`. Content decay insights from `getInsights(ws.id)` (already fetched in the same try-block) can fill this field, giving the AI visibility into pages losing organic clicks.

⚠️ **Type mismatch:** `ContentDecayData` (`shared/types/analytics.ts:263`) only has `{ baselineClicks, currentClicks, deltaPercent, baselinePeriod, currentPeriod }` — no `query` or position data. Use `insight.pageId` as the `query` proxy. Set `positionDelta: 0` and `currentPosition: 0`. The renderer still surfaces the click-delta signal usefully.

- [ ] **Step 1: Add ContentDecayData to existing analytics import**

Find line 46 in `server/routes/keyword-strategy.ts`:

```typescript
import type { KeywordClusterData, CompetitorGapData, ConversionAttributionData } from '../../shared/types/analytics.js';
```

Replace:

```typescript
import type { KeywordClusterData, CompetitorGapData, ConversionAttributionData, ContentDecayData } from '../../shared/types/analytics.js';
```

- [ ] **Step 2: Map content_decay insights and wire them**

Find the `buildStrategyIntelligenceBlock` call (~line 1383):

```typescript
intelligenceBlock = buildStrategyIntelligenceBlock({
  keywordClusters: keywordClusters.length > 0 ? keywordClusters : undefined,
  competitorGaps: competitorGaps.length > 0 ? competitorGaps : undefined,
  conversionPages: conversionPages.length > 0 ? conversionPages : undefined,
  performanceDeltas: undefined,
});
```

Replace with:

```typescript
const contentDecayDeltas = insights
  .filter(i => i.insightType === 'content_decay')
  .map(i => {
    const d = i.data as ContentDecayData;
    return {
      query: i.pageId || '',
      positionDelta: 0,
      clicksDelta: d.currentClicks - d.baselineClicks,
      currentPosition: 0,
    };
  })
  .filter(d => d.query);

intelligenceBlock = buildStrategyIntelligenceBlock({
  keywordClusters: keywordClusters.length > 0 ? keywordClusters : undefined,
  competitorGaps: competitorGaps.length > 0 ? competitorGaps : undefined,
  conversionPages: conversionPages.length > 0 ? conversionPages : undefined,
  performanceDeltas: contentDecayDeltas.length > 0 ? contentDecayDeltas : undefined,
});
```

`insights` is already in scope from `getInsights(ws.id)` earlier in the same try block.

- [ ] **Step 3: Typecheck**

```bash
npm run typecheck
```

Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
git add server/routes/keyword-strategy.ts
git commit -m "feat(keyword-strategy): wire content_decay insights into intelligence block performanceDeltas"
```

---

### Task 8 — Hard-filter declined keywords from pool and AI output (Model: sonnet)

**Owns:** `server/routes/keyword-strategy.ts` lines ~999 (pool filter), post-generation pageMap filter, contentGaps filter; `tests/unit/keyword-strategy-declined-filter.test.ts`  
**Must not touch:** lines ~1383–1390 (Task 7), lines ~65/230/901/2181/catch (Task 9)

**Background:** `declinedKeywords` (loaded at line 851) are injected as a prompt instruction, but the AI can still slip them through. Three hard filters are needed: (1) remove from keyword pool before the AI sees it, (2) strip from `pageMap` primary/secondary keywords after generation, (3) strip from `contentGaps` by `targetKeyword`. This mirrors how `filterBrandedKeywords` and `filterBrandedContentGaps` work.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/keyword-strategy-declined-filter.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';

function filterDeclinedFromPool(
  keywordPool: Map<string, unknown>,
  declinedKeywords: string[]
): number {
  const declinedSet = new Set(declinedKeywords.map(k => k.toLowerCase()));
  let removed = 0;
  for (const [kw] of keywordPool) {
    if (declinedSet.has(kw)) { keywordPool.delete(kw); removed++; }
  }
  return removed;
}

describe('filterDeclinedFromPool', () => {
  it('removes exact case-insensitive matches', () => {
    const pool = new Map<string, unknown>([
      ['seo agency', {}],
      ['bad keyword', {}],
      ['good term', {}],
    ]);
    const removed = filterDeclinedFromPool(pool, ['Bad Keyword']);
    expect(removed).toBe(1);
    expect(pool.has('bad keyword')).toBe(false);
    expect(pool.has('seo agency')).toBe(true);
  });

  it('returns 0 when no matches', () => {
    const pool = new Map<string, unknown>([['seo', {}]]);
    const removed = filterDeclinedFromPool(pool, ['ppc']);
    expect(removed).toBe(0);
    expect(pool.size).toBe(1);
  });

  it('handles empty declined list gracefully', () => {
    const pool = new Map<string, unknown>([['seo', {}]]);
    const removed = filterDeclinedFromPool(pool, []);
    expect(removed).toBe(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it passes (pure logic)**

```bash
npx vitest run tests/unit/keyword-strategy-declined-filter.test.ts
```

Expected: PASS. Confirms the logic before wiring.

- [ ] **Step 3: Add hard filter on keyword pool**

In `server/routes/keyword-strategy.ts`, find line 999 (the `filterBrandedKeywords` call):

```typescript
const brandedRemoved = filterBrandedKeywords(keywordPool, competitorDomains);
log.info(`Keyword pool: ${keywordPool.size} unique terms ...`);
```

Add the declined filter immediately after `filterBrandedKeywords`:

```typescript
const brandedRemoved = filterBrandedKeywords(keywordPool, competitorDomains);
// Hard filter: remove declined keywords before the AI sees the pool (prompt instruction is soft)
const declinedSet = new Set(declinedKeywords.map(k => k.toLowerCase()));
let declinedPoolRemoved = 0;
for (const [kw] of keywordPool) {
  if (declinedSet.has(kw)) { keywordPool.delete(kw); declinedPoolRemoved++; }
}
if (declinedPoolRemoved > 0) log.info(`Removed ${declinedPoolRemoved} declined keywords from keyword pool`);
log.info(`Keyword pool: ${keywordPool.size} unique terms ...`);
```

- [ ] **Step 4: Add post-generation filter on pageMap**

After `strategy` is first populated from the AI response (search `grep -n "strategy\.pageMap" server/routes/keyword-strategy.ts | head -5` to find the first assignment after the AI call), add:

```typescript
// Post-generation: hard filter declined keywords from pageMap assignments
if (declinedKeywords.length > 0 && strategy.pageMap?.length) {
  for (const pm of strategy.pageMap) {
    if (pm.primaryKeyword && declinedSet.has(pm.primaryKeyword.toLowerCase())) {
      pm.primaryKeyword = '';
    }
    if (pm.secondaryKeywords?.length) {
      pm.secondaryKeywords = pm.secondaryKeywords.filter(
        (k: string) => !declinedSet.has(k.toLowerCase())
      );
    }
  }
}
```

Note: `declinedSet` is declared in Step 3. If this post-generation code is outside that scope, recompute: `const declinedSet = new Set(declinedKeywords.map(k => k.toLowerCase()));` before using it.

- [ ] **Step 5: Add post-generation filter on contentGaps**

Find the `filterBrandedContentGaps` call (`grep -n "filterBrandedContentGaps" server/routes/keyword-strategy.ts`). Add immediately after:

```typescript
// Filter declined keywords from content gap targets (mirrors filterBrandedContentGaps pattern)
if (declinedKeywords.length > 0 && strategy.contentGaps?.length) {
  strategy.contentGaps = strategy.contentGaps.filter(
    (cg: { targetKeyword?: string }) =>
      !cg.targetKeyword || !declinedSet.has(cg.targetKeyword.toLowerCase())
  );
}
```

- [ ] **Step 6: Typecheck + full suite**

```bash
npm run typecheck && npx vitest run
```

Expected: zero type errors, all tests pass.

- [ ] **Step 7: Commit**

```bash
git add server/routes/keyword-strategy.ts tests/unit/keyword-strategy-declined-filter.test.ts
git commit -m "feat(keyword-strategy): hard-filter declined keywords from pool and AI output"
```

---

### Task 9 — Add concurrent generation guard (Model: sonnet)

**Owns:** `server/routes/keyword-strategy.ts` lines ~65 (new Set), ~230 (guard entry), ~901 (early-exit cleanup), ~2181 (success cleanup), catch block ~2182; `tests/integration/keyword-strategy-concurrent-guard.test.ts`  
**Must not touch:** lines ~1383–1390 (Task 7), lines ~999/post-pageMap/contentGaps (Task 8)

**Background:** Two simultaneous strategy generations for the same workspace race to `updateWorkspace` — whichever finishes last wins, possibly overwriting a more complete result. A module-level `Set<string>` guard (mirroring the existing `recsInFlight` at line 65) returns 409 on duplicate in-flight requests.

- [ ] **Step 1: Write the failing test**

Verify port is free:

```bash
grep -r 'createTestContext(' tests/ --include="*.ts" | grep -o '1[0-9]\{4\}' | sort -n | tail -5
```

Expected: highest is 13320 (from Task 2's test). Use 13321.

Create `tests/integration/keyword-strategy-concurrent-guard.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestContext } from './helpers.js';
import { seedWorkspace } from '../fixtures/workspace-seed.js';

const PORT = 13321;

describe('keyword strategy — concurrent generation guard', () => {
  let ctx: Awaited<ReturnType<typeof createTestContext>>;
  let cleanup: () => void;
  let workspaceId: string;

  beforeAll(async () => {
    ctx = await createTestContext(PORT);
    const seeded = await seedWorkspace(ctx.db);
    workspaceId = seeded.workspace.id;
    cleanup = seeded.cleanup;
  });

  afterAll(async () => {
    cleanup();
    await ctx.close();
  });

  it('returns 409 when a generation is already in flight for the same workspace', async () => {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(process.env.APP_PASSWORD ? { 'x-auth-token': process.env.APP_PASSWORD } : {}),
    };
    const body = JSON.stringify({});

    const [res1, res2] = await Promise.all([
      fetch(`http://localhost:${PORT}/api/webflow/keyword-strategy/${workspaceId}`, {
        method: 'POST', headers, body,
      }),
      fetch(`http://localhost:${PORT}/api/webflow/keyword-strategy/${workspaceId}`, {
        method: 'POST', headers, body,
      }),
    ]);

    const statuses = [res1.status, res2.status];
    expect(statuses).toContain(409);

    const failedRes = res1.status === 409 ? res1 : res2;
    const json = await failedRes.json();
    expect(json.error).toMatch(/already being generated/i);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run tests/integration/keyword-strategy-concurrent-guard.test.ts
```

Expected: FAIL — both requests currently race without a 409.

- [ ] **Step 3: Add module-level guard Set**

In `server/routes/keyword-strategy.ts`, immediately after the `recsInFlight` declaration at line 65:

```typescript
const recsInFlight = new Set<string>();
```

Add:

```typescript
const activeGenerations = new Set<string>();
```

- [ ] **Step 4: Add guard at handler entry**

In the POST handler, find the `getConfiguredProvider` call (~line 230). Immediately after it:

```typescript
const provider = getConfiguredProvider(ws.seoDataProvider);

if (activeGenerations.has(ws.id)) {
  return res.status(409).json({ error: 'A keyword strategy is already being generated for this workspace' });
}
activeGenerations.add(ws.id);
```

All existing early returns before this point (usage limit, missing API key) fire before `activeGenerations.add` — they do not need cleanup.

- [ ] **Step 5: Clean up on incremental early exit**

In the early-exit block at lines 901–913 (modified by PR1 Task 2), add `activeGenerations.delete` before `return`:

```typescript
if (pagesToAnalyze.length === 0) {
  log.info({ workspaceId: ws.id }, 'Incremental mode: all pages already fresh, skipping re-analysis');
  sendProgress('complete', 'All pages are already up to date — no re-analysis needed.', 1.0);
  if (keepalive) clearInterval(keepalive);
  activeGenerations.delete(ws.id);
  if (wantsStream) {
    res.write(`data: ${JSON.stringify({ done: true, strategy: ws.keywordStrategy, upToDate: true })}\n\n`);
    res.end();
  } else {
    res.json({ ok: true, upToDate: true, freshPageCount: pagesToPreserve.length });
  }
  return;
}
```

- [ ] **Step 6: Clean up on success path**

Find the `return;` at the end of the success path (~line 2181, after the `recsInFlight` block). Add cleanup on the line immediately before it:

```typescript
activeGenerations.delete(ws.id);
return;
```

- [ ] **Step 7: Clean up in error catch block**

Find the outer `catch (err)` at ~line 2182:

```typescript
} catch (err) {
  if (keepalive) clearInterval(keepalive);
```

Add cleanup at the very top of the catch body:

```typescript
} catch (err) {
  activeGenerations.delete(ws.id);
  if (keepalive) clearInterval(keepalive);
```

- [ ] **Step 8: Verify all exit paths are covered**

```bash
grep -n "activeGenerations.delete\|return res\.\|^    return;" server/routes/keyword-strategy.ts | head -30
```

Confirm every `return` that fires after `activeGenerations.add(ws.id)` either has a preceding `activeGenerations.delete(ws.id)` or routes through the catch block (which now handles cleanup).

- [ ] **Step 9: Run the test to verify it passes**

```bash
npx vitest run tests/integration/keyword-strategy-concurrent-guard.test.ts
```

Expected: PASS.

- [ ] **Step 10: Typecheck + build + full suite + pr-check**

```bash
npm run typecheck && npx vite build && npx vitest run && npx tsx scripts/pr-check.ts
```

Expected: all pass, zero errors.

- [ ] **Step 11: Commit**

```bash
git add server/routes/keyword-strategy.ts tests/integration/keyword-strategy-concurrent-guard.test.ts
git commit -m "feat(keyword-strategy): add concurrent generation guard — 409 on duplicate workspace request"
```

---

## PR 3: Tech Debt Cleanup

> **Prerequisite:** PR 2 merged to staging and verified before starting.

### File Map

| File | Tasks |
|------|-------|
| `server/routes/keyword-strategy.ts` | Tasks 11, 12, 13 |
| `server/routes/content-briefs.ts` | Task 10 |
| `shared/types/feature-flags.ts` | Task 10 |
| `tests/unit/question-keyword-matching.test.ts` | Task 11 (new) |

---

### Task 10 — Consolidate dual feature flags (Model: haiku)

**Owns:** `server/routes/keyword-strategy.ts` line 865, `server/routes/content-briefs.ts` (flag line), `shared/types/feature-flags.ts`  
**Must not touch:** lines 1710–1715 (Task 11), lines ~1388 (Task 12), line 881+ (Task 13)

**Background:** `outcome-adaptive-pipeline` (in keyword-strategy.ts:865 and content-briefs.ts) and `outcome-ai-injection` (in seo-context.ts, content-brief.ts, workspace-intelligence.ts, monthly-digest.ts) gate the same behavior. Keeping `outcome-ai-injection` — it's more widely used and already used in monthly-digest.ts.

- [ ] **Step 1: Audit all occurrences**

```bash
grep -rn "outcome-adaptive-pipeline\|outcome-ai-injection" server/ --include="*.ts"
```

Document every file and line. Expected: `outcome-adaptive-pipeline` only in keyword-strategy.ts and content-briefs.ts; `outcome-ai-injection` everywhere else.

- [ ] **Step 2: Replace all outcome-adaptive-pipeline occurrences**

For each file identified in Step 1 using `outcome-adaptive-pipeline`, replace with `outcome-ai-injection`. In `server/routes/keyword-strategy.ts` at line 865:

```typescript
// Before
if (isFeatureEnabled('outcome-adaptive-pipeline')) {
```

```typescript
// After
if (isFeatureEnabled('outcome-ai-injection')) {
```

Apply the same replacement in `server/routes/content-briefs.ts`.

- [ ] **Step 3: Verify no remaining occurrences**

```bash
grep -rn "outcome-adaptive-pipeline" server/ --include="*.ts"
```

Expected: no output.

- [ ] **Step 4: Check shared/types/feature-flags.ts**

```bash
grep -n "outcome-adaptive-pipeline\|outcome-ai-injection" shared/types/feature-flags.ts
```

If `outcome-adaptive-pipeline` appears as a registered flag value, remove it. If `outcome-ai-injection` is not registered, add it following the existing pattern in that file.

- [ ] **Step 5: Typecheck + build**

```bash
npm run typecheck && npx vite build
```

Expected: zero errors.

- [ ] **Step 6: Commit**

```bash
git add server/routes/keyword-strategy.ts server/routes/content-briefs.ts shared/types/feature-flags.ts
git commit -m "refactor(feature-flags): consolidate outcome-adaptive-pipeline into outcome-ai-injection"
```

---

### Task 11 — Improve question-keyword matching for content gaps (Model: haiku)

**Owns:** `server/routes/keyword-strategy.ts` lines 1710–1715, `tests/unit/question-keyword-matching.test.ts`  
**Must not touch:** line 865 (Task 10), lines ~1388 (Task 12), line 881+ (Task 13)

**Background:** The filter at line 1712 checks only the first word of the target keyword: `includes(...split(' ')[0])`. For `"technical seo"`, it only checks `"technical"`, causing false positives. Multi-word overlap (require ≥2 matching words, or all words if target has only 1) is more precise.

- [ ] **Step 1: Write the test**

Create `tests/unit/question-keyword-matching.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';

function improvedFilter(targetKeyword: string, questionKeyword: string): boolean {
  const targetWords = targetKeyword.toLowerCase().split(/\s+/);
  const qLower = questionKeyword.toLowerCase();
  const matchCount = targetWords.filter(w => qLower.includes(w)).length;
  return matchCount >= Math.min(2, targetWords.length);
}

describe('improved question-keyword matching', () => {
  it('requires both words for a 2-word target', () => {
    expect(improvedFilter('technical seo', 'how to do technical seo')).toBe(true);
    expect(improvedFilter('technical seo', 'technical writing tips')).toBe(false);
  });

  it('single-word target only requires 1 match', () => {
    expect(improvedFilter('seo', 'how to improve seo rankings')).toBe(true);
    expect(improvedFilter('seo', 'unrelated topic')).toBe(false);
  });

  it('3-word target requires at least 2 matches', () => {
    expect(improvedFilter('local seo strategy', 'local seo for small business')).toBe(true);
    expect(improvedFilter('local seo strategy', 'some other content')).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify the logic**

```bash
npx vitest run tests/unit/question-keyword-matching.test.ts
```

Expected: PASS. Confirms logic before wiring.

- [ ] **Step 3: Apply the fix**

Find lines 1710–1715 in `server/routes/keyword-strategy.ts`:

```typescript
if (allQuestionKws.length > 0) {
  const relatedQs = allQuestionKws.flatMap(q => q.questions)
    .filter(q => q.keyword.toLowerCase().includes(cg.targetKeyword.toLowerCase().split(' ')[0]))
    .slice(0, 3)
    .map(q => q.keyword);
  if (relatedQs.length > 0) cg.questionKeywords = relatedQs;
}
```

Replace with:

```typescript
if (allQuestionKws.length > 0) {
  const targetWords = cg.targetKeyword.toLowerCase().split(/\s+/);
  const relatedQs = allQuestionKws.flatMap(q => q.questions)
    .filter(q => {
      const qLower = q.keyword.toLowerCase();
      const matchCount = targetWords.filter(w => qLower.includes(w)).length;
      return matchCount >= Math.min(2, targetWords.length);
    })
    .slice(0, 3)
    .map(q => q.keyword);
  if (relatedQs.length > 0) cg.questionKeywords = relatedQs;
}
```

- [ ] **Step 4: Typecheck**

```bash
npm run typecheck
```

Expected: zero errors.

- [ ] **Step 5: Commit**

```bash
git add server/routes/keyword-strategy.ts tests/unit/question-keyword-matching.test.ts
git commit -m "fix(keyword-strategy): improve question-keyword matching to require 2-word overlap"
```

---

### Task 12 — Consume buildStrategySignals in generation (Model: sonnet)

**Owns:** `server/routes/keyword-strategy.ts` ~lines 1388–1395  
**Must not touch:** line 865 (Task 10), lines 1710–1715 (Task 11), line 881+ (Task 13)

**Background:** `buildStrategySignals` is imported at line 50 but never called during strategy generation. It returns `StrategySignal[]` where each has a `detail` field (not `summary` — do not use `s.summary`). The `insights` array is already in scope at the `buildStrategyIntelligenceBlock` call site. `contentDecayDeltas` is also already in scope from Task 7 (PR2).

- [ ] **Step 1: Verify the import is unused**

```bash
grep -n "buildStrategySignals" server/routes/keyword-strategy.ts
```

Expected: one result (the import at line 50). If it already appears elsewhere in the file, read that code before proceeding.

- [ ] **Step 2: Add the signals call after the intelligence block**

Find the `buildStrategyIntelligenceBlock` call (~lines 1383–1388). Immediately after its closing `});`, add:

```typescript
// Append feedback-loop signals to give the AI real performance context
const stratSignals = buildStrategySignals(insights);
if (stratSignals.length > 0) {
  intelligenceBlock += `\n\nSTRATEGY SIGNALS (analytics feedback loop — use to prioritize recommendations):\n${stratSignals.slice(0, 10).map(s => `- [${s.type}] ${s.detail}`).join('\n')}`;
}
```

- [ ] **Step 3: Typecheck + build**

```bash
npm run typecheck && npx vite build
```

Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
git add server/routes/keyword-strategy.ts
git commit -m "feat(keyword-strategy): consume buildStrategySignals in intelligence block for AI context"
```

---

### Task 13 — Replace strategy: any with StrategyOutput type (Model: opus)

**Owns:** `server/routes/keyword-strategy.ts` — new interface definitions (~line 128 area) + line 881 + all downstream usages  
**Must not touch:** line 865 (Task 10), lines 1710–1715 (Task 11), lines ~1388–1395 (Task 12)

**Background:** `let strategy: any` at line 881 hides all type errors in the AI response handling. Replacing with a typed interface surfaces mismatches at compile time. All fields start optional to avoid breaking the large downstream surface area.

- [ ] **Step 1: Find the interface definition zone**

```bash
grep -n "interface Strat\|interface.*Input\|StrategyIntelligenceInput" server/routes/keyword-strategy.ts | head -10
```

Note the line where `StrategyIntelligenceInput` is defined (~line 128). This is where the new interfaces go.

- [ ] **Step 2: Define StrategyOutput and nested interfaces**

Immediately after the `StrategyIntelligenceInput` interface definition, add:

```typescript
interface StrategyPageMapEntry {
  pagePath: string;
  primaryKeyword: string;
  secondaryKeywords?: string[];
  intent?: string;
  rationale?: string;
  impressions?: number;
  clicks?: number;
  trendDirection?: string;
  serpFeatures?: string[];
  serpTargeting?: string[];
  questionKeywords?: string[];
  validated?: boolean;
  volume?: number;
  difficulty?: number;
}

interface StrategyContentGap {
  topic?: string;
  targetKeyword: string;
  intent?: string;
  priority?: string;
  rationale?: string;
  suggestedPageType?: string;
  competitorProof?: string;
  impressions?: number;
  trendDirection?: string;
  serpFeatures?: string[];
  serpTargeting?: string[];
  questionKeywords?: string[];
}

interface StrategyQuickWin {
  pagePath: string;
  action: string;
  estimatedImpact?: string;
  rationale?: string;
}

interface StrategyKeywordFix {
  pagePath: string;
  newPrimaryKeyword: string;
}

interface StrategyOutput {
  siteKeywords?: string[];
  opportunities?: string[];
  contentGaps?: StrategyContentGap[];
  quickWins?: StrategyQuickWin[];
  keywordFixes?: StrategyKeywordFix[];
  pageMap?: StrategyPageMapEntry[];
}
```

- [ ] **Step 3: Replace let strategy: any**

Find line 881:

```typescript
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let strategy: any;
```

Replace (remove the eslint-disable comment too):

```typescript
let strategy: StrategyOutput;
```

- [ ] **Step 4: Fix downstream type errors iteratively**

```bash
npm run typecheck 2>&1 | head -80
```

For each error:
- **Property does not exist** → add the field (optional) to the relevant interface
- **Type 'X' not assignable to 'Y'** → use optional chaining or cast the parsed JSON: `strategy = parsed as StrategyOutput`
- **Object possibly undefined** → add `?.` or `?? []`
- Array iterations like `strategy.pageMap.map(...)` → use `(strategy.pageMap ?? []).map(...)`

Repeat until zero errors.

- [ ] **Step 5: Typecheck + build + full suite + pr-check**

```bash
npm run typecheck && npx vite build && npx vitest run && npx tsx scripts/pr-check.ts
```

Expected: all pass, zero errors.

- [ ] **Step 6: Commit**

```bash
git add server/routes/keyword-strategy.ts
git commit -m "refactor(keyword-strategy): replace strategy: any with typed StrategyOutput interface"
```

---

## Systemic Improvements

### Shared utilities
- **`filterDeclinedFromPool`**: Task 8 inlines the declined-keyword filter loop. If a second call site emerges (e.g., a future quick-wins filter), extract to a named function alongside `filterBrandedKeywords` in `server/competitor-brand-filter.ts`. YAGNI for now — leave inline until the second use case appears.

### pr-check rules to add
- **Unwrapped `new URL()` in server files**: A rule that flags `new URL(` not followed within 2 lines by `} catch` or `// url-fetch-ok` would have caught Task 3's bug before it shipped. Authoring guide: `docs/rules/pr-check-rule-authoring.md`.
- **Stale `ws.X` after `updateWorkspace`**: Mechanizing Task 4's bug class (reading `ws.competitorDomains` after already saving a new value to DB) is complex — skip for now.

### New test coverage
| Test file | What it covers |
|-----------|---------------|
| `tests/integration/keyword-strategy-incremental-sse.test.ts` | SSE done event on incremental no-op exit (Task 2) |
| `tests/unit/keyword-strategy-declined-filter.test.ts` | Declined keyword pool filter logic (Task 8) |
| `tests/integration/keyword-strategy-concurrent-guard.test.ts` | 409 on concurrent generation for same workspace (Task 9) |
| `tests/unit/question-keyword-matching.test.ts` | Multi-word question-keyword overlap filter (Task 11) |

---

## Verification Strategy

### Per-PR quality gate (run before opening each PR)

```bash
npm run typecheck && npx vite build && npx vitest run && npx tsx scripts/pr-check.ts
```

All four must pass with zero errors.

### PR 1 specific
- Task 2: `npx vitest run tests/integration/keyword-strategy-incremental-sse.test.ts --reporter=verbose` — verify `done: true` event appears in the SSE stream
- Task 6: Run `grep -n "broadcastToWorkspace\|WS_EVENTS" server/routes/keyword-strategy.ts` — verify both imports and the call site appear

### PR 2 specific
- Task 8: `npx vitest run tests/unit/keyword-strategy-declined-filter.test.ts --reporter=verbose`
- Task 9: `npx vitest run tests/integration/keyword-strategy-concurrent-guard.test.ts --reporter=verbose` — verify 409 appears in output
- Task 9 exit-path coverage: `grep -n "activeGenerations.delete" server/routes/keyword-strategy.ts` — expect exactly 3 results (early exit, success path, catch block)

### PR 3 specific
- Task 10: `grep -rn "outcome-adaptive-pipeline" server/` — expect zero results
- Task 13: `npm run typecheck` with zero errors is the primary gate — type safety is the whole point

### Staging gate
Each PR merges to `staging` first. After deploy verification on staging, merge `staging → main`. See `docs/workflows/deploy.md`.

---

## Spec Coverage

| Spec item | Task | Notes |
|-----------|------|-------|
| 1a Auto-regenerate recommendations | — | Already implemented at lines 2174–2181 via `recsInFlight` |
| 1b SSE done event on incremental early exit | Task 2 | ✅ |
| 1c Wrap new URL() in GSC summary | Task 3 | ✅ |
| 1d Fix stale competitorDomainsAtLastFetch | Task 4 | ✅ |
| 1e Forward mode from job system | Task 5 | ✅ |
| 1f WebSocket broadcast after strategy generation | Tasks 1 + 6 | ✅ |
| 2a Wire performanceDeltas (content decay) | Task 7 | ✅ Position fields unavailable in ContentDecayData — set to 0, click delta still useful |
| 2b Hard-filter declined keywords | Task 8 | ✅ Pool + pageMap + contentGaps |
| 2c Concurrent generation guard | Task 9 | ✅ |
| 3a Consolidate feature flags | Task 10 | ✅ Keep `outcome-ai-injection` |
| 3b Improve question-keyword matching | Task 11 | ✅ |
| 3c Consume buildStrategySignals | Task 12 | ✅ Uses `s.detail` not `s.summary` |
| 3d Replace strategy: any | Task 13 | ✅ |
