# SEO Keyword Pipeline Correctness + Drawer Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix four data pipeline correctness bugs that cause ~40–50% of client-facing keywords to show missing or misleading data, then rebuild the keyword drawer and list to speak plain English to small-business clients.

**Architecture:** Phase 1 is pure server-side: fix `computeOpportunityScore` null vs 0, content gap filtering, enrichment cap, and add background enrichment when tracked keywords are added. Phase 2 is pure frontend: add an `enrichmentStatus` field computed in `buildKeywordRow`, then use it to drive three UX states (gathering / limited / enriched) with a completely redesigned drawer hierarchy.

**Tech Stack:** Express + TypeScript (server), React 19 + TailwindCSS 4 (frontend), DataForSEO via `getConfiguredProvider()`, existing `isLoadingFeedback` / `feedbackLoading` state patterns, Tailwind animate utilities for skeleton pulse.

---

## Pre-requisites

- [ ] `staging` branch is green
- [ ] DataForSEO provider is configured (`DATAFORSEO_LOGIN` + `DATAFORSEO_PASSWORD` env vars present)
- [ ] Existing tests passing: `npx vitest run`

---

## Phase 1 — Data Pipeline Correctness

### Phase 1 Contracts (exported for Phase 2)

After Phase 1 merges, the following are guaranteed:

| Contract | Detail |
|----------|--------|
| `computeOpportunityScore` return type | `number \| undefined` — returns `undefined` (not `0`) when no enrichment data present |
| Content gap filter | All keywords kept in output (including volume=0); sorted positive-volume-first |
| Site keyword enrichment cap | 30 (was 15) |
| Tracked keyword add | Background enrichment fires for the new keyword; next strategy GET picks it up from cache |

---

### Task 1 — Fix `computeOpportunityScore` null vs 0 (Model: haiku)

**Owns:** `server/routes/keyword-strategy.ts` lines 87–105 only
**Must not touch:** Any other part of keyword-strategy.ts, any other file

**Context:** `computeOpportunityScore` currently returns `0` when no enrichment data is present. This is indistinguishable from a keyword that was enriched and genuinely scored 0. Callers that check `score > 0` silently treat unenriched keywords as zero-scored. Fix: return `undefined` instead.

The function lives at line 87 of `server/routes/keyword-strategy.ts`. Its return type is currently `number`. The call site at line 2016 assigns the result to `cg.opportunityScore` whose type in `shared/types` is `?: number` (optional), so `undefined` is already compatible — no type file changes needed.

- [ ] **Step 1: Write the failing test**

Add to `tests/unit/keyword-strategy-helpers.test.ts` (create file if it doesn't exist):

```typescript
import { describe, it, expect } from 'vitest';
import { computeOpportunityScore } from '../../server/routes/keyword-strategy.js';

describe('computeOpportunityScore', () => {
  it('returns undefined when no enrichment data present', () => {
    expect(computeOpportunityScore({})).toBeUndefined();
  });

  it('returns undefined when volume is 0 and no other signals', () => {
    expect(computeOpportunityScore({ volume: 0 })).toBeUndefined();
  });

  it('returns a number when difficulty alone is present', () => {
    const score = computeOpportunityScore({ difficulty: 30 });
    expect(typeof score).toBe('number');
    expect(score).toBeGreaterThan(0);
  });

  it('returns a number when volume is positive', () => {
    const score = computeOpportunityScore({ volume: 500, difficulty: 30 });
    expect(typeof score).toBe('number');
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThanOrEqual(100);
  });

  it('returns a higher score for rising trend', () => {
    const rising = computeOpportunityScore({ volume: 500, difficulty: 30, trendDirection: 'rising' });
    const stable = computeOpportunityScore({ volume: 500, difficulty: 30, trendDirection: 'stable' });
    expect(rising!).toBeGreaterThan(stable!);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/unit/keyword-strategy-helpers.test.ts --reporter=verbose
```

Expected: FAIL — `computeOpportunityScore({})` returns `0`, not `undefined`

- [ ] **Step 3: Change return type and early-return value**

In `server/routes/keyword-strategy.ts` at lines 87–105, change:

```typescript
export function computeOpportunityScore(cg: {
  volume?: number;
  difficulty?: number;
  impressions?: number;
  trendDirection?: string;
}): number {
  const hasData = (cg.volume != null && cg.volume > 0)
    || cg.difficulty != null
    || (cg.impressions != null && cg.impressions > 0);
  if (!hasData) return 0;
```

To:

```typescript
export function computeOpportunityScore(cg: {
  volume?: number;
  difficulty?: number;
  impressions?: number;
  trendDirection?: string;
}): number | undefined {
  const hasData = (cg.volume != null && cg.volume > 0)
    || cg.difficulty != null
    || (cg.impressions != null && cg.impressions > 0);
  if (!hasData) return undefined;
```

Leave all other lines (97–105) unchanged.

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run tests/unit/keyword-strategy-helpers.test.ts --reporter=verbose
```

Expected: all 5 tests PASS

- [ ] **Step 5: Typecheck**

```bash
npm run typecheck
```

Expected: zero errors (opportunityScore field is already `?: number` — undefined is compatible)

- [ ] **Step 6: Commit**

```bash
git add tests/unit/keyword-strategy-helpers.test.ts server/routes/keyword-strategy.ts
git commit -m "fix(keyword-strategy): computeOpportunityScore returns undefined for unenriched keywords"
```

---

### Task 2 — Fix content gap filtering + raise site keyword cap (Model: haiku)

**Owns:** `server/routes/keyword-strategy.ts` lines 2252–2290 only
**Must not touch:** Any other part of keyword-strategy.ts, any other file

**Context:**

**Bug A (lines 2267–2289):** Content gaps with `volume=0` and `impressions=0` are silently dropped from the client view. This means keywords the AI identified as strategic opportunities disappear after enrichment, with no explanation to the client. The intent was to remove low-quality suggestions, but the effect is confusing: a keyword that exists before enrichment vanishes after it.

Fix: keep all keywords. Sort positive-volume first, then unenriched (no data), then volume=0 last. Don't drop any.

**Bug B (line 2254):** `missing.slice(0, 15)` — only 15 site keywords enriched via API. Raise to 30.

- [ ] **Step 1: Write the failing test**

Add a new `describe` block to `tests/unit/keyword-strategy-helpers.test.ts`:

```typescript
// In the same file as Task 1's tests — add this describe block

describe('content gap sort order', () => {
  // Helper: simulate what the strategy route does with contentGaps
  function sortGaps(gaps: Array<{ volume?: number; impressions?: number; priority?: string }>) {
    const prioWeight = (p?: string) => p === 'high' ? 3 : p === 'medium' ? 2 : 1;
    return [...gaps].sort(
      (a, b) =>
        // volume=0 sorts after positive volume AND after unenriched (null)
        ((b.volume ?? -1) - (a.volume ?? -1)) ||
        prioWeight(b.priority) - prioWeight(a.priority)
    );
  }

  it('keeps volume=0 keywords (does not drop them)', () => {
    const gaps = [
      { volume: 500, priority: 'high' },
      { volume: 0, priority: 'high' },      // should be kept, not dropped
      { volume: undefined, priority: 'low' }, // unenriched — should be kept
    ];
    const sorted = sortGaps(gaps);
    expect(sorted).toHaveLength(3);
  });

  it('sorts positive volume before unenriched before zero volume', () => {
    const gaps = [
      { volume: 0, priority: 'high' },
      { volume: undefined, priority: 'low' },
      { volume: 500, priority: 'high' },
    ];
    const sorted = sortGaps(gaps);
    expect(sorted[0].volume).toBe(500);
    expect(sorted[1].volume).toBeUndefined(); // unenriched (null/-1 sort) before 0
    expect(sorted[2].volume).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify the sort test passes (it documents intended behavior)**

```bash
npx vitest run tests/unit/keyword-strategy-helpers.test.ts --reporter=verbose
```

The sort helper in the test is self-contained — the test should pass. This verifies the sort logic before we apply it.

- [ ] **Step 3: Fix content gap filtering (lines 2263–2290)**

Replace lines 2263–2290 in `server/routes/keyword-strategy.ts` with:

```typescript
    // ── Impact-based sorting (no filtering — keep all keywords including volume=0) ──
    // Previously dropped volume=0 keywords, but that silently removed AI-identified
    // opportunities after enrichment. Now we keep all and sort: positive-volume first,
    // then unenriched (no data yet), then confirmed-zero-volume at bottom.
    if (strategy.contentGaps?.length) {
      const prioWeight = (p: string) => p === 'high' ? 3 : p === 'medium' ? 2 : 1;
      strategy.contentGaps = [...strategy.contentGaps].sort(
        (a: StrategyContentGap, b: StrategyContentGap) =>
          // Use -1 sentinel for unenriched (null/undefined) so it sorts between
          // positive volume (≥0) and confirmed zero (0).
          // Positive volume: b.volume=500 → 500, a.volume=null → -1 → b wins ✓
          // Unenriched vs zero: b.volume=null → -1, a.volume=0 → 0 → a.volume wins,
          //   meaning null sorts BEFORE 0 (unenriched before confirmed-zero) ✓
          ((b.volume ?? -1) - (a.volume ?? -1)) ||
          prioWeight(b.priority ?? '') - prioWeight(a.priority ?? '')
      );
      log.info(`Content gaps: ${strategy.contentGaps.length} total (sorted, none dropped)`);
    }
```

- [ ] **Step 4: Raise site keyword enrichment cap (line 2254)**

Change `missing.slice(0, 15)` to `missing.slice(0, 30)`:

```typescript
          const extra = await provider.getKeywordMetrics(missing.slice(0, 30), ws.id);
```

- [ ] **Step 5: Typecheck**

```bash
npm run typecheck
```

Expected: zero errors

- [ ] **Step 6: Run full test suite**

```bash
npx vitest run --reporter=verbose 2>&1 | tail -20
```

Expected: all tests pass

- [ ] **Step 7: Commit**

```bash
git add server/routes/keyword-strategy.ts tests/unit/keyword-strategy-helpers.test.ts
git commit -m "fix(keyword-strategy): keep volume=0 gaps in output, raise site keyword enrichment cap to 30"
```

---

### Task 3 — Background enrichment for tracked keywords at add-time (Model: sonnet)

**Owns:** `server/routes/public-content.ts` lines 453–461 only
**Must not touch:** `server/rank-tracking.ts`, `server/routes/keyword-strategy.ts`, any other file

**Context:** When a client adds a keyword via the "Add Strategy Keyword" input, the POST `/api/public/tracked-keywords/:workspaceId` handler calls `addTrackedKeyword()` (sync) and immediately returns. No enrichment ever runs. The next time the strategy GET route runs, the keyword is present but has no volume/difficulty data.

Fix: after the sync add, fire a background (fire-and-forget) call to `provider.getKeywordMetrics([keyword], ws.id)`. The response is returned immediately (the enrichment doesn't block it). The metrics are stored in the DataForSEO L1 cache (`keyword_metrics_cache` table) so the next strategy GET picks them up.

The POST route needs to become `async` to use `provider`. Use `getConfiguredProvider` from `../seo-data-provider.js` — already imported in keyword-strategy.ts, needs to be added here.

**Important:** Enrichment must not throw on failure — it's best-effort. Wrap in try/catch inside the background promise, log errors with `log.warn`, never reject.

- [ ] **Step 1: Write the integration test**

Create `tests/integration/tracked-keywords-enrichment.test.ts`:

```typescript
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { createTestContext } from './helpers.js';
import { seedWorkspace } from '../fixtures/workspace-seed.js';

const ctx = createTestContext(13317);

describe('POST /api/public/tracked-keywords/:workspaceId — background enrichment', () => {
  let workspaceId: string;
  let cleanup: () => void;

  beforeAll(async () => {
    await ctx.start();
    const seed = await seedWorkspace();
    workspaceId = seed.workspaceId;
    cleanup = seed.cleanup;
  });

  afterAll(async () => {
    cleanup();
    await ctx.stop();
  });

  it('returns 200 and the updated keywords list immediately (does not block on enrichment)', async () => {
    const start = Date.now();
    const res = await ctx.post(`/api/public/tracked-keywords/${workspaceId}`, {
      keyword: 'seo strategy',
    });
    const elapsed = Date.now() - start;
    expect(res.status).toBe(200);
    expect(res.body.keywords).toBeInstanceOf(Array);
    expect(res.body.keywords.some((k: { query: string }) => k.query === 'seo strategy')).toBe(true);
    // Response must not wait for enrichment (DataForSEO can take 1-3s)
    expect(elapsed).toBeLessThan(500);
  });

  it('returns 200 even when no SEO provider is configured', async () => {
    // When no provider configured, enrichment is skipped silently
    const res = await ctx.post(`/api/public/tracked-keywords/${workspaceId}`, {
      keyword: 'another keyword',
    });
    expect(res.status).toBe(200);
    expect(res.body.keywords).toBeInstanceOf(Array);
  });
});
```

- [ ] **Step 2: Run test to verify it fails (or passes for the non-enrichment assertions)**

```bash
npx vitest run tests/integration/tracked-keywords-enrichment.test.ts --reporter=verbose
```

- [ ] **Step 3: Add `'client_keyword_tracked'` to `ActivityType` in `server/activity-log.ts`**

Open `server/activity-log.ts`. Find the `ActivityType` union (line ~18). Add the new value after `'client_keyword_feedback'`:

```typescript
// Before:
| 'client_keyword_feedback'

// After:
| 'client_keyword_feedback'
| 'client_keyword_tracked'
```

Do NOT add to `CLIENT_VISIBLE_TYPES` — this is an internal tracking event, not client-visible.

- [ ] **Step 4: Add provider import to public-content.ts**

At the top of `server/routes/public-content.ts`, add `getConfiguredProvider` after existing imports. `isProgrammingError` is already imported — do not add it again:

```typescript
import { getConfiguredProvider } from '../seo-data-provider.js';
```

- [ ] **Step 5: Make the POST handler async, add broadcast + activity + background enrichment**

Replace the POST handler at lines 453–461 of `server/routes/public-content.ts`:

```typescript
router.post('/api/public/tracked-keywords/:workspaceId', validate(addTrackedKeywordSchema), async (req, res) => {
  const ws = getWorkspace(req.params.workspaceId);
  if (!ws) return res.status(404).json({ error: 'Workspace not found' });
  const keyword = sanitizeString(req.body?.keyword || '').toLowerCase().trim();
  if (!keyword || keyword.length < 2) return res.status(400).json({ error: 'Keyword must be at least 2 characters' });
  if (keyword.length > 120) return res.status(400).json({ error: 'Keyword too long' });
  const actor = getClientActor(req);
  const keywords = addTrackedKeyword(ws.id, keyword);
  addActivity(ws.id, 'client_keyword_tracked', `"${keyword}" added to strategy keywords`, '', {}, actor ?? undefined);
  broadcastToWorkspace(ws.id, WS_EVENTS.STRATEGY_UPDATED, { keyword });
  res.json({ keywords });

  // Fire-and-forget: pre-warm the DataForSEO cache for this keyword so the next
  // strategy GET has volume/difficulty data available immediately.
  const provider = getConfiguredProvider(ws.seoDataProvider ?? undefined);
  if (provider) {
    provider.getKeywordMetrics([keyword], ws.id).catch((err: unknown) => {
      if (isProgrammingError(err)) log.warn({ err }, 'tracked-keyword enrichment: programming error');
      // Non-critical — enrichment will run again on next strategy generation
    });
  }
});
```

- [ ] **Step 6: Typecheck**

```bash
npm run typecheck
```

Expected: zero errors

- [ ] **Step 7: Run the integration test**

```bash
npx vitest run tests/integration/tracked-keywords-enrichment.test.ts --reporter=verbose
```

Expected: all tests pass

- [ ] **Step 8: Run pr-check**

```bash
npx tsx scripts/pr-check.ts
```

Expected: 0 errors

- [ ] **Step 9: Commit**

```bash
git add server/activity-log.ts server/routes/public-content.ts tests/integration/tracked-keywords-enrichment.test.ts
git commit -m "feat(tracked-keywords): broadcast + activity + background DataForSEO enrichment on add"
```

---

### Phase 1 Wrap-Up

After all three Phase 1 tasks commit:

- [ ] Run full suite: `npx vitest run`
- [ ] Build: `npx vite build`
- [ ] pr-check: `npx tsx scripts/pr-check.ts`
- [ ] Push to staging: `git push origin staging`
- [ ] Open PR to staging, get review, merge
- [ ] Verify on staging deploy: add a tracked keyword, wait 10s, reload strategy — check that volume/KD appear

---

## Phase 2 — Drawer + List Redesign

**Depends on:** Phase 1 merged and green on staging.

### Phase 2 Contracts consumed from Phase 1

- `computeOpportunityScore` returns `undefined` for unenriched → safe to distinguish from scored keywords
- Content gaps with `volume=0` now appear in client output → frontend must render them (not hide them)

---

### Task 4 — Add `enrichmentStatus` to keyword rows (Model: haiku)

**Owns:** `src/components/client/StrategyTab.tsx` — `StrategyKeywordTableRow` interface (lines 93–115) and `buildKeywordRow` function (lines 630–689) only
**Must not touch:** Any other part of StrategyTab.tsx, any other file

**Context:** `enrichmentStatus` is computed client-side from the data present on each keyword row. It drives which UX state the drawer renders. It does not require any server changes.

Three states:
- `'enriched'`: `volume != null` AND `difficulty != null` — full API data available
- `'partial'`: any of volume, difficulty, impressions, currentPosition are non-null — some signal exists
- `'unenriched'`: none of the above — keyword was added but no API data has arrived yet

- [ ] **Step 1: Add `enrichmentStatus` to `StrategyKeywordTableRow`**

In `StrategyTab.tsx`, update the `StrategyKeywordTableRow` interface (lines 93–115):

```typescript
interface StrategyKeywordTableRow extends PriorityKeywordItem {
  role: StrategyKeywordRole;
  roleLabel: 'Strategy Keyword' | 'Page Opportunity' | 'Content Opportunity' | 'Keyword Idea';
  roleDetail: string;
  opportunityLabel: string;
  opportunityDetail: string;
  opportunityTone: OpportunityTone;
  opportunityScore?: number;
  nextMoveLabel: string;
  nextMoveDetail: string;
  volume?: number;
  difficulty?: number;
  currentPosition?: number;
  pagePath?: string;
  pageTitle?: string;
  searchIntent?: string;
  impressions?: number;
  clicks?: number;
  metricsSource?: string;
  contextSources: string[];
  rationale?: string;
  trendDirection?: 'rising' | 'declining' | 'stable';
  enrichmentStatus: 'enriched' | 'partial' | 'unenriched';
}
```

- [ ] **Step 2: Compute `enrichmentStatus` in `buildKeywordRow`**

In `buildKeywordRow` (lines 630–689), add before the `return` statement:

```typescript
    const enrichmentStatus: 'enriched' | 'partial' | 'unenriched' = (() => {
      if (volume != null && difficulty != null) return 'enriched';
      if (volume != null || difficulty != null || impressions != null || currentPosition != null) return 'partial';
      return 'unenriched';
    })();
```

And add `enrichmentStatus` to the return object:

```typescript
    return {
      ...item,
      ...role,
      ...opportunity,
      ...nextMove,
      opportunityScore,
      volume,
      difficulty,
      currentPosition,
      pagePath,
      pageTitle: page?.pageTitle,
      searchIntent: page?.searchIntent ?? contentGap?.intent,
      impressions,
      clicks: page?.clicks,
      metricsSource,
      contextSources,
      rationale: contentGap?.rationale,
      trendDirection: contentGap?.trendDirection,
      enrichmentStatus,
    };
```

- [ ] **Step 3: Typecheck**

```bash
npm run typecheck
```

Expected: zero errors

- [ ] **Step 4: Commit**

```bash
git add src/components/client/StrategyTab.tsx
git commit -m "feat(strategy-tab): add enrichmentStatus field to keyword rows"
```

---

### Task 5 — Rebuild the keyword drawer (Model: sonnet)

**Owns:** `src/components/client/StrategyTab.tsx` — the drawer render section (lines ~1787–2022)
**Must not touch:** State declarations, list zone render, everything outside the drawer IIFE block. Do not touch `buildKeywordRow`, `StrategyKeywordTableRow`, or the list zone renders.

**Context:** The drawer currently leads with a raw metrics strip (Volume / Difficulty / Trend) that clients can't interpret. The redesign restructures information into: Verdict → Opportunity (plain English) → Your Position → The Move → foldable Evidence.

#### New drawer information hierarchy

```
[Keyword name — large]
[Role badge]
[Confidence statement — plain English, driven by enrichmentStatus]

── Opportunity ─────────────────
Audience:    "~2.4k searches/month" OR "Focused audience" OR "Data being gathered"
Competition: "Approachable — good entry point" OR "Moderate" OR "Competitive"
Momentum:    "Interest growing" OR "Steady demand" OR "Declining — review timing"

── Your Position ───────────────  (only if currentPosition or impressions present)
[rank card + impressions card]

── Why it's in the strategy ────
[rationale text]

── Next move ───────────────────
[existing next move section]

── See the numbers ─────────────  (foldable)
Volume: 480/mo · KD: 24 · CPC: $2.40
Sources: [existing signals chips]
```

#### Enrichment state behavior

| `enrichmentStatus` | Audience field | Competition field | Momentum field |
|---|---|---|---|
| `'enriched'` | Formatted volume ("~2.4k/mo" or "Focused audience" for <100) | Plain English KD label | Trend label |
| `'partial'` | Whatever data is present, others show "Gathering…" | Same | Same |
| `'unenriched'` | Entire Opportunity section replaced by a single message: *"We're collecting search data for this keyword. Metrics will appear within 24 hours."* with a subtle pulse animation | — | — |

#### Translation functions (add these as `const` helpers near the top of the component body, above `roleBadgeClass`)

```typescript
  const fmtAudience = (volume?: number): string => {
    if (volume == null) return 'Gathering…';
    if (volume === 0) return 'Very niche or emerging term';
    if (volume < 100) return 'Small, focused audience';
    return `~${fmtNum(volume)} searches/month`;
  };

  const fmtCompetition = (difficulty?: number): string => {
    if (difficulty == null) return 'Gathering…';
    if (difficulty < 30) return 'Approachable — good entry point';
    if (difficulty < 50) return 'Moderate competition';
    if (difficulty < 75) return 'Competitive';
    return 'Highly competitive';
  };

  const fmtMomentum = (direction?: 'rising' | 'declining' | 'stable'): string => {
    if (!direction) return 'Gathering…';
    if (direction === 'rising') return 'Interest growing';
    if (direction === 'stable') return 'Steady demand';
    return 'Declining — worth reviewing timing';
  };

  const confidenceStatement = (row: StrategyKeywordTableRow): string => {
    if (row.enrichmentStatus === 'unenriched') return 'Gathering data';
    if (row.enrichmentStatus === 'partial') return 'Partial signal';
    if ((row.opportunityScore ?? 0) >= 60) return 'Strong opportunity';
    if ((row.opportunityScore ?? 0) >= 30) return 'Moderate opportunity';
    return 'In your strategy';
  };

  const confidenceColor = (row: StrategyKeywordTableRow): string => {
    if (row.enrichmentStatus === 'unenriched') return 'text-[var(--brand-text-muted)]';
    if (row.enrichmentStatus === 'partial') return 'text-amber-400';
    if ((row.opportunityScore ?? 0) >= 60) return 'text-emerald-400';
    if ((row.opportunityScore ?? 0) >= 30) return 'text-teal-400';
    return 'text-[var(--brand-text-muted)]';
  };
```

Also add `drawerEvidence` open/close state at the top of the component state block:

```typescript
  const [drawerEvidenceOpen, setDrawerEvidenceOpen] = useState(false);
```

And reset it when drawer opens — in `openOrSwapDrawer`:

```typescript
  const openOrSwapDrawer = useCallback((keyword: string) => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
      setDrawerClosing(false);
    }
    setDrawerEvidenceOpen(false);
    setOpenKeywordDrawer(keyword);
  }, []);
```

#### Client-friendly signal label map

Replace the raw `contextSources` array in the drawer with these translated labels:

```typescript
  const signalLabel: Record<string, string> = {
    'Generated strategy': 'Identified in your strategy',
    'Rank tracking': 'You\'re actively tracking this',
    'Client request': 'You added this keyword',
    'Page map': 'Linked to a page on your site',
    'Content recommendation': 'AI-recommended content topic',
    'Competitor gap': 'Competitors rank here — you don\'t yet',
  };
```

#### Implementation steps

- [ ] **Step 1: Add state and helper functions**

Add `drawerEvidenceOpen` state near the other drawer state declarations (after `drawerClosing`, line ~197).

Add `fmtAudience`, `fmtCompetition`, `fmtMomentum`, `confidenceStatement`, `confidenceColor`, and `signalLabel` to the component body — place them immediately after `roleBadgeClass` (line ~749).

Update `openOrSwapDrawer` to reset `drawerEvidenceOpen` as shown above.

- [ ] **Step 2: Rebuild the drawer render**

Replace the entire drawer IIFE block (from `{(openKeywordDrawer || drawerClosing) && (() => {` through the closing `})()}`) with the following:

```tsx
      {(openKeywordDrawer || drawerClosing) && (() => {
        const allRows: StrategyKeywordTableRow[] = [...sortedConfirmed, ...keywordIdeaRows];
        const liveRow = allRows.find(r => r.normalized === openKeywordDrawer);
        if (liveRow) drawerSnapshotRef.current = liveRow;
        const drawerRow = liveRow ?? drawerSnapshotRef.current;
        if (!drawerRow) return null;
        const isConfirmed = drawerRow.status === 'client' || drawerRow.status === 'strategy';
        const isRemoving = removingKeyword === drawerRow.normalized;
        const unenriched = drawerRow.enrichmentStatus === 'unenriched';
        return (
          <>
            {/* Backdrop */}
            <div
              className="fixed inset-0 z-[var(--z-modal-backdrop)]" // fixed-inset-ok — keyword detail drawer backdrop
              onClick={closeDrawer}
              aria-hidden="true"
            />

            {/* Drawer panel */}
            <div
              ref={drawerRef}
              role="dialog"
              aria-modal="true"
              aria-label={`Keyword details: ${drawerRow.label}`}
              tabIndex={-1}
              className={`fixed inset-x-0 bottom-0 h-[70vh] sm:inset-x-auto sm:inset-y-0 sm:right-0 sm:h-auto sm:w-full sm:max-w-sm bg-[var(--surface-2)] border-t border-[var(--brand-border)] sm:border-t-0 sm:border-l z-[var(--z-modal)] flex flex-col overflow-hidden duration-200 rounded-t-[var(--radius-signature-lg)] sm:rounded-none outline-none ${drawerClosing ? 'animate-out slide-out-to-right fill-mode-forwards' : 'animate-in slide-in-from-right'}`} // pr-check-disable-next-line -- Brand signature radius intentional for bottom-sheet drawer top corners on mobile
            >
              {/* Header */}
              <div className="flex items-start justify-between gap-3 px-4 pt-4 pb-3 border-b border-[var(--brand-border)] flex-shrink-0">
                <div className="min-w-0 flex-1">
                  <div className="t-page font-semibold text-[var(--brand-text-bright)] leading-snug break-words mb-1.5">
                    {drawerRow.label}
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-[var(--radius-pill)] border t-caption-sm font-medium ${roleBadgeClass(drawerRow.role)}`}>
                      {({ content: 'Content to write', page: 'Page to optimize', strategy: 'Strategy keyword', idea: 'Keyword idea' } as Record<string, string>)[drawerRow.role] ?? drawerRow.roleLabel}
                    </span>
                    <span className={`t-caption-sm font-medium ${confidenceColor(drawerRow)}`}>
                      {confidenceStatement(drawerRow)}
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  aria-label="Close keyword detail"
                  className="flex-shrink-0 mt-0.5 w-7 h-7 flex items-center justify-center rounded-[var(--radius-sm)] text-[var(--brand-text-muted)] hover:text-[var(--brand-text)] hover:bg-[var(--surface-3)] transition-colors"
                  onClick={closeDrawer}
                >
                  <Icon as={X} size="sm" />
                </button>
              </div>

              {/* Scrollable body */}
              <div className="flex-1 overflow-y-auto flex flex-col gap-5 px-4 py-4">

                {/* Opportunity section — plain English */}
                {unenriched ? (
                  <div className="rounded-[var(--radius-lg)] bg-[var(--surface-3)] px-3 py-3 flex items-start gap-2.5">
                    <div className="w-1.5 h-1.5 rounded-full bg-[var(--brand-text-muted)] mt-1.5 animate-pulse flex-shrink-0" />
                    <p className="t-caption text-[var(--brand-text-muted)] leading-relaxed">
                      We're collecting search data for this keyword. Volume and competition metrics will appear within 24 hours.
                    </p>
                  </div>
                ) : (
                  <div className="flex flex-col gap-1.5">
                    <div className="t-caption-sm font-medium text-[var(--brand-text-muted)] uppercase tracking-wider mb-0.5">Opportunity</div>
                    <div className="grid grid-cols-1 gap-1">
                      <div className="flex items-center justify-between py-1.5 border-b border-[var(--brand-border)]/40">
                        <span className="t-caption text-[var(--brand-text-muted)]">Audience</span>
                        <span className="t-caption font-medium text-[var(--brand-text)]">{fmtAudience(drawerRow.volume)}</span>
                      </div>
                      <div className="flex items-center justify-between py-1.5 border-b border-[var(--brand-border)]/40">
                        <span className="t-caption text-[var(--brand-text-muted)]">Competition</span>
                        <span className="t-caption font-medium text-[var(--brand-text)]">{fmtCompetition(drawerRow.difficulty)}</span>
                      </div>
                      <div className="flex items-center justify-between py-1.5">
                        <span className="t-caption text-[var(--brand-text-muted)]">Momentum</span>
                        <span className={`t-caption font-medium ${
                          drawerRow.trendDirection === 'rising' ? 'text-emerald-400' :
                          drawerRow.trendDirection === 'declining' ? 'text-red-400' :
                          'text-[var(--brand-text)]'
                        }`}>{fmtMomentum(drawerRow.trendDirection)}</span>
                      </div>
                    </div>
                  </div>
                )}

                {/* Your position — only if rank or GSC data present */}
                {(drawerRow.currentPosition != null || (drawerRow.impressions != null && drawerRow.impressions > 0)) && (
                  <div>
                    <div className="t-caption-sm font-medium text-[var(--brand-text-muted)] uppercase tracking-wider mb-1.5">Your position</div>
                    <div className="grid grid-cols-2 gap-3">
                      {drawerRow.currentPosition != null && (
                        <div className="bg-[var(--surface-3)] rounded-[var(--radius-lg)] px-3 py-2.5">
                          <div className="t-caption-sm text-[var(--brand-text-muted)] mb-0.5">Current rank</div>
                          <div className={`t-stat-sm font-semibold ${
                            drawerRow.currentPosition <= 10 ? 'text-emerald-400' :
                            drawerRow.currentPosition <= 30 ? 'text-amber-400' :
                            'text-[var(--brand-text)]'
                          }`}>#{drawerRow.currentPosition}</div>
                          <div className="t-caption-sm text-[var(--brand-text-muted)] mt-0.5">
                            {drawerRow.currentPosition <= 10 ? 'On page 1' :
                             drawerRow.currentPosition <= 20 ? 'Top of page 2' : 'Page 2+'}
                          </div>
                        </div>
                      )}
                      {drawerRow.impressions != null && drawerRow.impressions > 0 && (
                        <div className="bg-[var(--surface-3)] rounded-[var(--radius-lg)] px-3 py-2.5">
                          <div className="t-caption-sm text-[var(--brand-text-muted)] mb-0.5">Monthly impressions</div>
                          <div className="t-stat-sm font-semibold text-blue-400">
                            {drawerRow.impressions >= 1000 ? `${(drawerRow.impressions / 1000).toFixed(1)}k` : drawerRow.impressions}
                          </div>
                          <div className="t-caption-sm text-[var(--brand-text-muted)] mt-0.5">via Google Search</div>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Why it's in the strategy */}
                {(drawerRow.rationale ?? drawerRow.opportunityDetail) && (
                  <div>
                    <div className="t-caption-sm font-medium text-[var(--brand-text-muted)] uppercase tracking-wider mb-1.5">Why it's in the strategy</div>
                    <p className="t-body text-[var(--brand-text-muted)] leading-relaxed">
                      {drawerRow.rationale ?? drawerRow.opportunityDetail}
                    </p>
                  </div>
                )}

                {/* Next move */}
                <div className="bg-[var(--surface-3)] rounded-[var(--radius-lg)] p-3">
                  <div className="t-caption-sm font-medium text-[var(--brand-text-muted)] uppercase tracking-wider mb-1.5">Next move</div>
                  <p className="t-body text-[var(--brand-text)] leading-relaxed mb-3">
                    {drawerRow.nextMoveDetail}
                  </p>
                  {drawerRow.role === 'content' && (
                    <Button variant="primary" size="sm" onClick={() => { onTabChange?.('content'); closeDrawer(); }}>
                      Request content
                    </Button>
                  )}
                  {(drawerRow.role === 'page' || drawerRow.role === 'strategy') && drawerRow.pagePath && (
                    <Button variant="secondary" size="sm" onClick={() => { onTabChange?.('health'); closeDrawer(); }}>
                      Go to page
                    </Button>
                  )}
                </div>

                {/* Foldable: See the numbers */}
                <div>
                  <button
                    type="button"
                    className="flex items-center gap-1.5 t-caption-sm text-[var(--brand-text-muted)] hover:text-[var(--brand-text)] transition-colors"
                    onClick={() => setDrawerEvidenceOpen(v => !v)}
                    aria-expanded={drawerEvidenceOpen}
                  >
                    <ChevronDown className={`w-3.5 h-3.5 transition-transform ${drawerEvidenceOpen ? '' : '-rotate-90'}`} />
                    See the numbers
                  </button>
                  {drawerEvidenceOpen && (
                    <div className="mt-2 flex flex-col gap-2.5">
                      {/* Raw metrics */}
                      {!unenriched && (
                        <div className="flex flex-wrap gap-x-4 gap-y-1">
                          {drawerRow.volume != null && (
                            <span className="t-caption text-[var(--brand-text-muted)]">
                              Volume: <span className="text-[var(--brand-text)]">{drawerRow.volume ? `${fmtNum(drawerRow.volume)}/mo` : '—'}</span>
                            </span>
                          )}
                          {drawerRow.difficulty != null && (
                            <span className="t-caption text-[var(--brand-text-muted)]">
                              KD: <span className="text-[var(--brand-text)]">{drawerRow.difficulty}</span>
                            </span>
                          )}
                        </div>
                      )}
                      {/* Signals — client-friendly labels */}
                      {drawerRow.contextSources.length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                          {drawerRow.searchIntent && (
                            <span className={`px-2 py-0.5 rounded-[var(--radius-sm)] border t-caption capitalize ${intentColor(drawerRow.searchIntent)}`}>
                              {drawerRow.searchIntent} intent
                            </span>
                          )}
                          {drawerRow.contextSources.map(src => (
                            <span
                              key={src}
                              className="px-2 py-0.5 bg-[var(--surface-3)] border border-[var(--brand-border)] rounded-[var(--radius-sm)] t-caption text-[var(--brand-text-muted)]"
                            >
                              {signalLabel[src] ?? src}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>

              </div>

              {/* Footer */}
              <div className="px-4 py-3 border-t border-[var(--brand-border)] flex-shrink-0">
                {isConfirmed ? (
                  <button
                    type="button"
                    className="t-caption text-[var(--brand-text-muted)] hover:text-red-400 transition-colors disabled:opacity-50"
                    disabled={isRemoving}
                    onClick={async () => {
                      await removePriorityKeyword(drawerRow);
                      closeDrawer();
                    }}
                  >
                    {isRemoving ? 'Removing…' : 'Remove from strategy'}
                  </button>
                ) : (
                  <div className="flex items-center gap-3">
                    <Button
                      variant="primary"
                      size="sm"
                      loading={addingKeyword}
                      disabled={addingKeyword}
                      onClick={async () => { await addStrategyKeyword(drawerRow.label); closeDrawer(); }}
                    >
                      Add to strategy
                    </Button>
                    <button
                      type="button"
                      className="t-caption text-[var(--brand-text-muted)] hover:text-[var(--brand-text)] transition-colors disabled:opacity-40"
                      disabled={isLoadingFeedback(drawerRow.label)}
                      onClick={async () => { await submitFeedback(drawerRow.label, 'declined', 'suggestion'); closeDrawer(); }}
                    >
                      Dismiss
                    </button>
                  </div>
                )}
              </div>

            </div>
          </>
        );
      })()}
```

- [ ] **Step 3: Typecheck**

```bash
npm run typecheck
```

Expected: zero errors. If `drawerEvidenceOpen` is missing, add `const [drawerEvidenceOpen, setDrawerEvidenceOpen] = useState(false);` in the state block.

- [ ] **Step 4: Run pr-check**

```bash
npx tsx scripts/pr-check.ts
```

Expected: 0 errors

- [ ] **Step 5: Commit**

```bash
git add src/components/client/StrategyTab.tsx
git commit -m "feat(strategy-tab): rebuild keyword drawer with plain-English metrics and enrichment states"
```

---

### Task 6 — Enhance list rows: inline role indicators + opportunity strength (Model: haiku)

**Owns:** `src/components/client/StrategyTab.tsx` — confirmed zone and suggestion zone render sections only (lines ~828–944)
**Must not touch:** Drawer, state declarations, buildKeywordRow, helpers

**Context:** List rows currently show only the keyword label and a sublabel. Two improvements:
1. Add a tiny colored dot on each confirmed row indicating role (matches `roleBadgeClass` colors)
2. Add a subtle bar fill on suggestion rows indicating relative opportunity strength

These are purely visual additions with no logic changes.

- [ ] **Step 1: Add role dot to confirmed rows**

In the confirmed zone row render (around line 837), add a role dot before the text block:

```tsx
                  <div
                    className={`w-1.5 h-1.5 rounded-full flex-shrink-0 mt-0.5 ${
                      row.role === 'content' ? 'bg-emerald-400' :
                      row.role === 'page' ? 'bg-blue-400' :
                      row.role === 'strategy' ? 'bg-teal-400' :
                      'bg-[var(--brand-text-muted)]'
                    }`}
                  />
```

Place it as the first child of the outer `div` before the `<div className="flex-1 min-w-0">` text block. The row's `flex items-center gap-3` layout will space it correctly.

- [ ] **Step 2: Add enrichment indicator to confirmed row sublabel**

In the confirmed zone, `roleSubLabel(row)` generates the sublabel. When `row.enrichmentStatus === 'unenriched'`, append `· data pending` to the sublabel so clients know data is coming:

```tsx
                      <div className="t-caption text-[var(--brand-text-muted)] truncate">
                        {roleSubLabel(row)}{row.enrichmentStatus === 'unenriched' ? ' · data pending' : ''}
                      </div>
```

- [ ] **Step 3: Add opportunity strength indicator to suggestion rows**

In the suggestion zone rows (around line 902), add a thin left accent bar whose opacity reflects opportunity score:

```tsx
                  className={`relative flex items-center gap-3 px-3 py-2.5 rounded-[var(--radius-lg)] bg-blue-500/5 border border-blue-500/20 cursor-pointer hover:border-blue-500/30 transition-colors overflow-hidden`}
```

Add as the first child inside this div:

```tsx
                  {/* Opportunity strength accent */}
                  <div
                    className="absolute left-0 top-0 bottom-0 w-0.5 bg-blue-400 rounded-l-[var(--radius-lg)]"
                    style={{ opacity: Math.max(0.2, Math.min(1, (row.opportunityScore ?? 0) / 100)) }}
                  />
```

- [ ] **Step 4: Typecheck + pr-check**

```bash
npm run typecheck && npx tsx scripts/pr-check.ts
```

Expected: zero errors

- [ ] **Step 5: Commit**

```bash
git add src/components/client/StrategyTab.tsx
git commit -m "feat(strategy-tab): add role dots, enrichment indicators, and opportunity bars to list rows"
```

---

### Phase 2 Wrap-Up

After all Phase 2 tasks commit:

- [ ] Full test suite: `npx vitest run`
- [ ] Build: `npx vite build`
- [ ] pr-check: `npx tsx scripts/pr-check.ts`
- [ ] Push to staging and verify in browser:
  - [ ] Open a keyword with full data — confirm plain-English Opportunity section
  - [ ] Add a fresh tracked keyword — confirm it shows "Gathering data" state in drawer
  - [ ] Expand "See the numbers" — confirm raw metrics appear
  - [ ] Confirmed rows show colored dots
  - [ ] Suggestion rows show left-edge accent bar
- [ ] Update `FEATURE_AUDIT.md`: update "Strategy Keywords" entry to note drawer redesign
- [ ] Update `BRAND_DESIGN_LANGUAGE.md`: note `fmtAudience`, `fmtCompetition`, `fmtMomentum` translation layer
- [ ] `data/roadmap.json`: mark relevant items done

---

## Task Dependencies

```
Phase 1 — all sequential (one file each, safe to run in order):
  Task 1 (computeOpportunityScore fix)
  Task 2 (content gap filter + cap raise)
  Task 3 (background enrichment on add)
  ↓
  Phase 1 PR merged + green on staging
  ↓
Phase 2:
  Task 4 (enrichmentStatus field) — must land first, others depend on it
  ↓
  Task 5 (drawer rebuild)  ←→  Task 6 (list row enhancements)
  (sequential — both edit StrategyTab.tsx; run Task 5 first, Task 6 second)
```

---

## Cross-Phase Contracts

| Phase 1 exports | Phase 2 consumes |
|---|---|
| `computeOpportunityScore` returns `undefined` for unenriched | Phase 2 checks `enrichmentStatus` derived from data presence, not score value — compatible |
| Volume=0 content gaps kept in output | Phase 2 `fmtAudience(0)` renders "Very niche or emerging term" — handles it correctly |
| Tracked keyword enrichment warms L1 cache | Phase 2 `enrichmentStatus` transitions from `'unenriched'` → `'enriched'` on next strategy load |

---

## Systemic Improvements

**Out of scope (future work):**
- "Last enriched" timestamp in the drawer footer — the design spec included this but the server doesn't store an enrichment timestamp. Implementing it would require a DB migration to add `enriched_at` to `keyword_metrics_cache`. Defer to a separate task.

**Shared utilities:**
- `fmtAudience`, `fmtCompetition`, `fmtMomentum` — currently component-local. If other tabs ever need plain-English metric translation, extract to `src/lib/kwMetrics.ts`. Not needed for this feature.

**pr-check rules to consider after this ships:**
- Flag direct `volume != null` checks in drawer render code — should use `enrichmentStatus` instead
- Flag raw `difficulty` exposed to clients without translation layer

**New tests introduced:**
- `tests/unit/keyword-strategy-helpers.test.ts` — computeOpportunityScore, sort logic
- `tests/integration/tracked-keywords-enrichment.test.ts` — background enrichment on add

---

## Verification Strategy

**Phase 1:**
```bash
# Unit tests
npx vitest run tests/unit/keyword-strategy-helpers.test.ts --reporter=verbose

# Integration test
npx vitest run tests/integration/tracked-keywords-enrichment.test.ts --reporter=verbose

# Full suite
npx vitest run

# Add a keyword via the client UI, wait 10 seconds, reload strategy page
# → keyword should show volume/KD in drawer (if DataForSEO cache hit)
```

**Phase 2:**
```bash
# Typecheck
npm run typecheck

# Build
npx vite build

# pr-check
npx tsx scripts/pr-check.ts

# Browser: open /client/:workspaceId/strategy
# 1. Click a keyword with full data → drawer shows Audience/Competition/Momentum in plain English
# 2. "See the numbers" → expands to show raw KD/volume
# 3. Add a new tracked keyword → drawer shows "Gathering data" pulsing state
# 4. Confirmed rows → colored left dots visible
# 5. Suggestion rows → left accent bars visible with varying opacity
```
