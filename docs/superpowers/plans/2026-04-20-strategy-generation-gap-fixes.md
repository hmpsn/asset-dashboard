# Strategy Generation Gap Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix six quick-win bugs, wire missing intelligence signals and add a safety guard, and clean up tech debt across the keyword strategy generation pipeline — shipped as three sequential PRs.

**Architecture:** Nearly all changes are in `server/routes/keyword-strategy.ts` (~2200 lines), with small satellite touches to `server/routes/jobs.ts`, `server/ws-events.ts`, `src/lib/wsEvents.ts`, and `server/routes/content-briefs.ts`. PRs are sequential: PR1 must merge to staging before PR2 starts, PR2 before PR3.

**Tech Stack:** Express/TypeScript backend, Server-Sent Events (SSE) for streaming progress, SQLite via better-sqlite3, React Query + WebSocket broadcasts for frontend cache invalidation, Vitest for unit/integration tests.

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

## PR 1: Quick-Win Bug Fixes

> ⚠️ **Task 1a is already done.** `generateRecommendations` is already called after strategy generation via the `recsInFlight` guard at `keyword-strategy.ts:2174–2181`. Skip it.

### File Map

| File | What changes |
|------|-------------|
| `server/ws-events.ts` | Add `STRATEGY_UPDATED` constant |
| `src/lib/wsEvents.ts` | Mirror `STRATEGY_UPDATED` constant |
| `server/routes/keyword-strategy.ts` | Tasks 1b, 1c, 1d, 1f |
| `server/routes/jobs.ts` | Task 1e |
| `tests/integration/keyword-strategy-incremental-sse.test.ts` | New — tests Task 1b |

---

### Task 1 — Add STRATEGY_UPDATED event constants (prerequisite for Task 6)

**Files:**
- Modify: `server/ws-events.ts`
- Modify: `src/lib/wsEvents.ts`

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

### Task 2 — SSE done event on incremental early exit (spec 1b)

**Files:**
- Modify: `server/routes/keyword-strategy.ts` (lines 901–913)
- Create: `tests/integration/keyword-strategy-incremental-sse.test.ts`

**Background:** When `mode=incremental` and all pages are already fresh, the handler returns early at line 901–913. On the SSE path it calls `sendProgress('complete', ...)` then `res.end()`, but never sends a `data:` event with `{ done: true }`. The frontend (`src/components/KeywordStrategy.tsx`) checks `evt.done && evt.strategy` to invalidate React Query caches — without this event the UI appears to hang after an incremental no-op.

- [ ] **Step 1: Write the failing test**

Create `tests/integration/keyword-strategy-incremental-sse.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestContext } from './helpers.js';
import { seedWorkspace } from '../fixtures/workspace-seed.js';

// Before using port 13320, verify it's free:
// grep -r 'createTestContext(' tests/ | grep -v node_modules
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

Replace only the `if (wantsStream)` branch with:

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

### Task 3 — Wrap uncaught new URL() in GSC summary (spec 1c)

**Files:**
- Modify: `server/routes/keyword-strategy.ts` (line 1255)

**Background:** Line 1255 calls `new URL(r.page).pathname` without try/catch. Every other `new URL()` in this file is wrapped. A single malformed GSC URL crashes the entire strategy generation for that workspace.

- [ ] **Step 1: Fix the unwrapped call**

Find line 1254–1255 in `server/routes/keyword-strategy.ts`:

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

### Task 4 — Fix stale competitorDomainsAtLastFetch (spec 1d)

**Files:**
- Modify: `server/routes/keyword-strategy.ts` (line 747)

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

Replace the `competitorDomainsAtLastFetch` line:

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

### Task 5 — Forward mode parameter from job system (spec 1e)

**Files:**
- Modify: `server/routes/jobs.ts` (lines 537–544)

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

### Task 6 — Broadcast STRATEGY_UPDATED via WebSocket (spec 1f)

**Files:**
- Modify: `server/routes/keyword-strategy.ts` (~line 2122)

**Background:** After strategy is saved at line 2122, no WebSocket event is broadcast. Any open tab must poll or refresh to see the new strategy. The pattern from `server/routes/page-strategy.ts:143` (`broadcastToWorkspace(id, WS_EVENTS.BLUEPRINT_GENERATED, {...})`) is the model.

- [ ] **Step 1: Verify imports not already present**

```bash
grep -n "broadcastToWorkspace\|WS_EVENTS" server/routes/keyword-strategy.ts | head -10
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

| File | What changes |
|------|-------------|
| `server/routes/keyword-strategy.ts` | Tasks 2a, 2b, 2c |
| `tests/unit/keyword-strategy-declined-filter.test.ts` | New — tests Task 2b logic |
| `tests/integration/keyword-strategy-concurrent-guard.test.ts` | New — tests Task 2c |

---

### Task 7 — Wire performanceDeltas into strategy intelligence block (spec 2a)

**Files:**
- Modify: `server/routes/keyword-strategy.ts` (~line 1383)

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

Make sure `insights` is in scope (it is — it's loaded via `getInsights(ws.id)` earlier in the same try block).

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

### Task 8 — Hard-filter declined keywords from pool and AI output (spec 2b)

**Files:**
- Modify: `server/routes/keyword-strategy.ts` (~line 999 and content gap post-processing)
- Create: `tests/unit/keyword-strategy-declined-filter.test.ts`

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

Expected: PASS. This validates the logic before wiring it into the route.

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

After the AI returns results and `strategy` is populated (search for `strategy.pageMap` first reference after the OpenAI call — around line 1500+), find a suitable location after `strategy` is first available and add:

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

Note: `declinedSet` is defined in Step 3's scope. If this post-generation code is in a different scope, recompute: `const declinedSet = new Set(declinedKeywords.map(k => k.toLowerCase()));`.

- [ ] **Step 5: Add post-generation filter on contentGaps**

Find the `filterBrandedContentGaps` call in the file (search: `grep -n "filterBrandedContentGaps" server/routes/keyword-strategy.ts`). Add a declined filter immediately after it:

```typescript
// Filter declined keywords from content gap targets (mirrors filterBrandedContentGaps)
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

### Task 9 — Add concurrent generation guard (spec 2c)

**Files:**
- Modify: `server/routes/keyword-strategy.ts` (~line 65, ~line 230, ~line 901, ~line 2181, ~line 2182)
- Create: `tests/integration/keyword-strategy-concurrent-guard.test.ts`

**Background:** Two simultaneous strategy generations for the same workspace race to `updateWorkspace` — whichever finishes last wins, possibly overwriting a more complete result. A module-level `Set<string>` guard (mirroring the existing `recsInFlight` at line 65) returns 409 on duplicate in-flight requests.

- [ ] **Step 1: Write the failing test**

Before creating the file, verify the next available port:

```bash
grep -r 'createTestContext(' tests/ --include="*.ts" | grep -o '1[0-9]\{4\}' | sort -n | tail -5
```

Use the next port after the highest found. The plan assumes 13321 — adjust if taken.

Create `tests/integration/keyword-strategy-concurrent-guard.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestContext } from './helpers.js';
import { seedWorkspace } from '../fixtures/workspace-seed.js';

const PORT = 13321; // verify free before using

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

    // Fire both concurrently — one should get 409
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

In the POST handler, find the `getConfiguredProvider` call (~line 230). Immediately after it, add the guard:

```typescript
const provider = getConfiguredProvider(ws.seoDataProvider);

if (activeGenerations.has(ws.id)) {
  return res.status(409).json({ error: 'A keyword strategy is already being generated for this workspace' });
}
activeGenerations.add(ws.id);
```

All existing early returns before this point (usage limit, missing API key) fire before `activeGenerations.add` and do not need cleanup.

- [ ] **Step 5: Clean up on incremental early exit**

In the early-exit block (~line 901–913, modified by Task 2 in PR1), add `activeGenerations.delete` before `return`:

```typescript
if (pagesToAnalyze.length === 0) {
  log.info({ workspaceId: ws.id }, 'Incremental mode: all pages already fresh, skipping re-analysis');
  sendProgress('complete', 'All pages are already up to date — no re-analysis needed.', 1.0);
  if (keepalive) clearInterval(keepalive);
  activeGenerations.delete(ws.id);  // ← add this line
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

Confirm every `return` that fires after `activeGenerations.add(ws.id)` has a preceding `activeGenerations.delete(ws.id)`, or is reached only via the catch block (which now handles cleanup).

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

| File | What changes |
|------|-------------|
| `server/routes/keyword-strategy.ts` | Tasks 3b, 3c, 3d |
| `server/routes/content-briefs.ts` | Task 3a (flag rename) |
| `shared/types/feature-flags.ts` | Task 3a (remove stale flag if registered) |
| `tests/unit/question-keyword-matching.test.ts` | New — tests Task 3b logic |

---

### Task 10 — Consolidate dual feature flags (spec 3a)

**Files:**
- Modify: `server/routes/keyword-strategy.ts` (line 865)
- Modify: `server/routes/content-briefs.ts` (confirm usage)
- Modify: `shared/types/feature-flags.ts` (if `outcome-adaptive-pipeline` is registered)

**Background:** `outcome-adaptive-pipeline` (in keyword-strategy.ts:865 and content-briefs.ts) and `outcome-ai-injection` (in seo-context.ts, content-brief.ts, workspace-intelligence.ts, monthly-digest.ts) gate the same behavior: loading workspace learnings and injecting into AI prompts. Keeping `outcome-ai-injection` (more widely used). `monthly-digest.ts` already uses `outcome-ai-injection` — confirmed.

- [ ] **Step 1: Audit all occurrences**

```bash
grep -rn "outcome-adaptive-pipeline\|outcome-ai-injection" server/ --include="*.ts"
```

Document every file and line. Expected: `outcome-adaptive-pipeline` in keyword-strategy.ts and possibly content-briefs.ts; `outcome-ai-injection` everywhere else.

- [ ] **Step 2: Replace all outcome-adaptive-pipeline occurrences**

In every file from Step 1 that uses `outcome-adaptive-pipeline`, replace with `outcome-ai-injection`. Use Edit tool per file. For `server/routes/keyword-strategy.ts` at line 865:

```typescript
// Before
if (isFeatureEnabled('outcome-adaptive-pipeline')) {
```

```typescript
// After
if (isFeatureEnabled('outcome-ai-injection')) {
```

Apply the same replacement to `server/routes/content-briefs.ts` at whatever line Step 1 identified.

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

### Task 11 — Improve question-keyword matching for content gaps (spec 3b)

**Files:**
- Modify: `server/routes/keyword-strategy.ts` (lines 1710–1715)
- Create: `tests/unit/question-keyword-matching.test.ts`

**Background:** The filter at line 1712 checks only the first word of the target keyword: `includes(...split(' ')[0])`. For a target like `"technical seo"`, it only checks `"technical"`, causing false positives. Multi-word overlap (require at least 2 matching words, or all words if target has only 1) is more precise.

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

- [ ] **Step 2: Run the test to verify it passes (pure logic)**

```bash
npx vitest run tests/unit/question-keyword-matching.test.ts
```

Expected: PASS. Confirms the logic before wiring.

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

### Task 12 — Consume buildStrategySignals in strategy generation (spec 3c)

**Files:**
- Modify: `server/routes/keyword-strategy.ts` (~line 1388)

**Background:** `buildStrategySignals` is imported at line 50 but never called during strategy generation. It returns `StrategySignal[]` where each has a `detail` field (not `summary` — do not use `s.summary`). The `insights` array is already in scope at the `buildStrategyIntelligenceBlock` call site.

- [ ] **Step 1: Verify the import and confirm it's unused**

```bash
grep -n "buildStrategySignals" server/routes/keyword-strategy.ts
```

Expected: one line (the import at line 50). If it already appears elsewhere, read that code before proceeding.

- [ ] **Step 2: Add the signals call after the intelligence block**

Find the `buildStrategyIntelligenceBlock` call (~line 1383–1388) — now with the `contentDecayDeltas` from Task 7 (PR2). Immediately after the closing `});` of the `buildStrategyIntelligenceBlock` call, add:

```typescript
// Append feedback-loop signals to give the AI real performance context
const stratSignals = buildStrategySignals(insights);
if (stratSignals.length > 0) {
  intelligenceBlock += `\n\nSTRATEGY SIGNALS (analytics feedback loop — use to prioritize recommendations):\n${stratSignals.slice(0, 10).map(s => `- [${s.type}] ${s.detail}`).join('\n')}`;
}
```

Note: `intelligenceBlock` is a `string` variable in scope. `insights` is already in scope from `getInsights(ws.id)` earlier in the same try block.

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

### Task 13 — Replace strategy: any with StrategyOutput type (spec 3d)

**Files:**
- Modify: `server/routes/keyword-strategy.ts` (line 881 + downstream)

**Background:** `let strategy: any` at line 881 hides all type errors in the AI response handling. Replacing it with a typed interface surfaces mismatches at compile time. All fields should start as optional to avoid breaking the large surface area of downstream usage.

- [ ] **Step 1: Find the StrategyIntelligenceInput type location**

```bash
grep -n "interface Strat\|type Strat\|StrategyIntelligenceInput" server/routes/keyword-strategy.ts | head -10
```

Note the line number where similar types are defined (around line 128). This is where `StrategyOutput` will be added.

- [ ] **Step 2: Define StrategyOutput and nested interfaces**

Immediately after the `StrategyIntelligenceInput` interface definition (or adjacent to it in the file), add these interfaces:

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

Replace:

```typescript
let strategy: StrategyOutput;
```

If the eslint-disable comment is only for this line, remove it too.

- [ ] **Step 4: Fix downstream type errors iteratively**

```bash
npm run typecheck 2>&1 | head -80
```

For each error, apply the minimal fix:

- **Property does not exist** → add the field (as optional) to the relevant interface
- **Type 'X' is not assignable to type 'Y'** → narrow with `?.` or add a cast where the field is set from the parsed JSON (e.g., `strategy = parsed as StrategyOutput`)
- **Object is possibly undefined** → add `?.` optional chaining
- For array iteration like `strategy.pageMap.map(...)` → use `strategy.pageMap?.map(...)` or `(strategy.pageMap ?? []).map(...)`

Repeat until `npm run typecheck` returns zero errors.

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

## Quality Gates (all three PRs)

Before opening each PR, all four must pass with zero errors:

```bash
npm run typecheck && npx vite build && npx vitest run && npx tsx scripts/pr-check.ts
```

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
| 2a Wire performanceDeltas (content decay) | Task 7 | ✅ Note: position fields unavailable in ContentDecayData, set to 0 |
| 2b Hard-filter declined keywords | Task 8 | ✅ Pool + pageMap + contentGaps |
| 2c Concurrent generation guard | Task 9 | ✅ |
| 3a Consolidate feature flags | Task 10 | ✅ Keep `outcome-ai-injection` |
| 3b Improve question-keyword matching | Task 11 | ✅ |
| 3c Consume buildStrategySignals | Task 12 | ✅ Uses `s.detail` not `s.summary` |
| 3d Replace strategy: any | Task 13 | ✅ |
