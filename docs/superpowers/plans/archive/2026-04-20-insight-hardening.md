# Insight Hardening — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden the insight pipeline by fixing the dedup skip logic, tightening the type system, hardening ~74 silent server catches across 32 files, and converting the storage report to async.

**Architecture:** Five independent fix areas targeting (1) Bridge #12's dedup skip in `scheduled-audits.ts`, (2) ~74 silent catch blocks across 32 server files (NOT the top-6 files from the roadmap spec — those are already hardened), (3) the `AnalyticsInsight` type from `Record<string,unknown>` to `InsightDataMap[T]` generic, (4) KeywordStrategy schema/interface drift, and (5) converting `getStorageReport()` to async using a new `dirSizeAsync()` helper (the existing sync `dirSize()` must stay to avoid breaking the 4 prune functions).

**Tech Stack:** TypeScript, SQLite, Express, Vitest

---

## ⚠️ Pre-work: Fix C status

**Bridge #10 reversal is already fully implemented.** The roadmap item `anomaly-boost-reversal-mechanism` described as "never reverses" is done. Both paths exist:

- **Periodic reversal**: `server/anomaly-detection.ts:776-820` — runs in every `runAnomalyScan()` call; removes boost when no undismissed recent anomalies remain for a workspace
- **Dismiss-triggered reversal**: `reverseAnomalyBoostIfNoneRemain()` at line 241, called from `dismissAnomaly()` at line 211

An integration test at `tests/integration/anomaly-boost-reversal.test.ts` (port 13253) covers both paths.

**No Fix C work is needed.** Mark the roadmap item `anomaly-boost-reversal-mechanism` as `"done"` when you update `data/roadmap.json`.

---

## Pre-requisites

- [ ] Read `CLAUDE.md` Section "Code Conventions" and "Data Flow Rules"
- **Fix D pre-plan audit (inline):** A pre-plan audit was performed via codebase grep before this plan was written. The "Fix D: Reality check" section above documents findings — the roadmap spec's file list was ~70% stale (top-6 files already hardened). The corrected 32-file/~74-catch list in Tasks 2-5 is the verified output of that audit. No separate audit artifact was created; the findings are embedded in the plan.

---

## Files Modified

| File | Task | Change |
|------|------|--------|
| `server/scheduled-audits.ts` | Task 1 | Remove dedup-skip at line ~199 |
| `tests/integration/scheduled-audits-dedup.test.ts` | Task 1 | New integration test (port 13314) |
| `server/insight-enrichment.ts` | Task 2 | Harden ~5 silent catch blocks (0 `isProgrammingError` uses currently) |
| `server/sales-audit.ts` | Task 2 | Harden 6 silent catch blocks |
| `server/webflow-assets.ts` | Task 3 | Harden 5 silent catch blocks |
| `server/seo-audit-site-checks.ts` | Task 3 | Harden 4 silent catch blocks |
| `server/routes/webflow-seo.ts` | Task 3 | Harden ~7 remaining silent catch blocks |
| `server/routes/roadmap.ts` | Task 4 | Harden 4 silent catch blocks |
| `server/helpers.ts` | Task 4 | Harden 4 silent catch blocks + remove `as unknown as PageHealthData` type cast (Fix E read-site) |
| `server/webflow-pages.ts` | Task 5 | Harden 3 silent catch blocks |
| `server/seo-audit.ts` | Task 5 | Harden 3 silent catch blocks |
| `server/recommendations.ts` | Task 5 | Harden 3 silent catch blocks |
| `server/internal-links.ts` | Task 5 | Harden 3 silent catch blocks |
| *(24 more files with 1-2 catches each — see Fix D notes)* | Task 5 sweep | Harden remaining ~30 catches |
| `shared/types/analytics.ts` | Task 6 | Make `AnalyticsInsight<T>` generic |
| `server/analytics-insights-store.ts` | Task 6 | Make `UpsertInsightParams<T>`, `upsertInsight<T>`, `cloneInsightParams<T>` generic; remove `as never` from `cloneInsightParams` |
| `server/insight-score-adjustments.ts` | Task 6 | Make `applyScoreAdjustment<T>` generic |
| `server/anomaly-detection.ts` | Task 7 | Replace `as never` casts at lines ~270, ~753, ~806 |
| `tests/integration/anomaly-boost-reversal.test.ts` | Task 7 | Update `as never` casts in test file |
| `server/outcome-tracking.ts` | Task 8 | Replace `as never` cast at line ~341 |
| `server/admin-chat-context.ts` | Task 8 | Replace `as unknown as XData` with type predicates |
| `server/content-brief.ts` | Task 8 | Replace `as unknown as XData` with type predicates |
| ~~`server/helpers.ts`~~ | ~~Task 8~~ | Moved to Task 4 to avoid dual-ownership conflict |
| `scripts/pr-check.ts` | Task 9 | Remove `exclude: ['shared/types/analytics.ts']` at line ~1696 |
| `server/schemas/workspace-schemas.ts` | Task 10 | Add `siteKeywordMetrics` + `generatedAt` to `keywordStrategySchema` |
| `server/workspaces.ts` | Task 10 | Remove `as unknown as KeywordStrategy` cast at line ~130 |
| `server/storage-stats.ts` | Task 11 | Add `dirSizeAsync()`, convert `getStorageReport` to async (sync `dirSize` stays) |
| `server/routes/health.ts` | Task 11 | Await `getStorageReport()` in route handler |
| `tests/integration/health-routes.test.ts` | Task 11 | Reduce timeout from 120_000 to 30_000 |
| `data/roadmap.json` | Task 12 | Mark completed items done, run sort-roadmap |
| `FEATURE_AUDIT.md` | Task 12 | Update entries for completed fixes |

---

## Task 1 — Fix Dedup: Upsert Instead of Skip (Model: sonnet)

**Owns:** `server/scheduled-audits.ts`, `tests/integration/scheduled-audits-dedup.test.ts`
**Must not touch:** Any other file

**Context:** Bridge #12 in `runScheduledAudit()` at `server/scheduled-audits.ts:~195-199` currently checks if a non-resolved `audit_finding` insight exists for a page and skips the upsert entirely. This means insight data (issue count, messages) never gets refreshed on subsequent audits unless the insight was resolved. The underlying `upsertInsight()` SQL already uses `ON CONFLICT DO UPDATE` that omits `resolution_status/note/resolved_at` — so removing the skip will refresh data while preserving resolution state.

**Functional impact:** Audit findings in the client dashboard will always reflect the latest audit results instead of freezing at the first-run values.

- [ ] **Step 1: Write the failing test**

Create `tests/integration/scheduled-audits-dedup.test.ts` (port 13314):

```typescript
/**
 * Integration test: audit_finding insight dedup — upsert updates data, preserves resolution.
 *
 * Verifies Bridge #12 behavior after the dedup-skip fix:
 * - First audit creates the insight
 * - Second audit with different issue data UPDATES the insight (not skips)
 * - A resolved insight keeps its resolution status after re-audit
 *
 * Port: 13314
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestContext } from './helpers.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';
import { upsertInsight, getInsights, resolveInsight } from '../../server/analytics-insights-store.js';

const ctx = createTestContext(13314);

let wsId = '';

beforeAll(async () => {
  await ctx.startServer();
  const ws = createWorkspace('Dedup Test Workspace');
  wsId = ws.id;
}, 25_000);

afterAll(() => {
  deleteWorkspace(wsId);
  ctx.stopServer();
});

describe('audit_finding insight dedup fix', () => {
  it('re-upsert refreshes issue data on a non-resolved insight', () => {
    // Simulate first bridge run: create insight with 2 issues
    const first = upsertInsight({
      workspaceId: wsId,
      insightType: 'audit_finding',
      pageId: '/test-page',
      pageTitle: '/test-page',
      severity: 'warning',
      data: { scope: 'page', issueCount: 2, issueMessages: 'missing-alt; slow-lcp', source: 'bridge_12' },
      impactScore: 50,
      bridgeSource: 'bridge-audit-page-health',
    });
    expect(first.data).toMatchObject({ issueCount: 2 });

    // Simulate second bridge run: same page, now 5 issues
    const second = upsertInsight({
      workspaceId: wsId,
      insightType: 'audit_finding',
      pageId: '/test-page',
      pageTitle: '/test-page',
      severity: 'critical',
      data: { scope: 'page', issueCount: 5, issueMessages: 'missing-alt; slow-lcp; missing-h1; duplicate-title; no-robots', source: 'bridge_12' },
      impactScore: 80,
      bridgeSource: 'bridge-audit-page-health',
    });
    expect(second.data).toMatchObject({ issueCount: 5 });

    // Fetch from store — there should be only ONE insight (upserted, not duplicated)
    const all = getInsights(wsId).filter(i => i.insightType === 'audit_finding' && i.pageId === '/test-page');
    expect(all).toHaveLength(1);
    expect(all[0].data).toMatchObject({ issueCount: 5, issueMessages: expect.stringContaining('missing-h1') });
  });

  it('re-upsert does NOT reset resolution status', () => {
    // Create insight and resolve it
    upsertInsight({
      workspaceId: wsId,
      insightType: 'audit_finding',
      pageId: '/resolved-page',
      severity: 'warning',
      data: { scope: 'page', issueCount: 1, issueMessages: 'missing-alt', source: 'bridge_12' },
      impactScore: 50,
      bridgeSource: 'bridge-audit-page-health',
    });
    const insights = getInsights(wsId).filter(i => i.insightType === 'audit_finding' && i.pageId === '/resolved-page');
    expect(insights).toHaveLength(1);
    resolveInsight(insights[0].id, wsId, 'resolved', 'Fixed manually', 'admin');

    // Re-upsert (simulates second audit run)
    upsertInsight({
      workspaceId: wsId,
      insightType: 'audit_finding',
      pageId: '/resolved-page',
      severity: 'critical',
      data: { scope: 'page', issueCount: 3, issueMessages: 'new-issue-1; new-issue-2; new-issue-3', source: 'bridge_12' },
      impactScore: 80,
      bridgeSource: 'bridge-audit-page-health',
    });

    const after = getInsights(wsId).filter(i => i.insightType === 'audit_finding' && i.pageId === '/resolved-page');
    expect(after).toHaveLength(1);
    // Data refreshed
    expect(after[0].data).toMatchObject({ issueCount: 3 });
    // Resolution preserved
    expect(after[0].resolutionStatus).toBe('resolved');
  });
});
```

- [ ] **Step 2: Run test to verify it passes (confirms store layer is correct)**

```bash
npx vitest run tests/integration/scheduled-audits-dedup.test.ts --reporter=verbose
```

Both tests should pass — they test `upsertInsight()` directly, confirming the SQL layer already handles upsert-with-preserved-resolution correctly. The bridge fix (next step) is what changes behavior at the call-site level.

- [ ] **Step 3: Remove the dedup-skip in scheduled-audits.ts**

In `server/scheduled-audits.ts`, find the Bridge #12 block (around line 191). The current code:

```typescript
        // Deduplicate: skip if identical audit_finding insight exists for this page
        const existingForPage = existing.find(
          i => i.insightType === 'audit_finding' && i.pageId === page.pageId && i.resolutionStatus !== 'resolved',
        );
        if (existingForPage) continue;

        upsertInsight({
```

Replace with (remove the 5 lines, keep only the upsertInsight call):

```typescript
        upsertInsight({
```

The `existing` variable (from `getInsights(ws.id)`) is still used by other bridges in the same function — do NOT remove it.

- [ ] **Step 4: Typecheck + full test suite**

```bash
npm run typecheck && npx vitest run
```

Expected: zero errors, all tests pass.

- [ ] **Step 5: Commit**

```bash
git add server/scheduled-audits.ts tests/integration/scheduled-audits-dedup.test.ts
git commit -m "fix(insights): upsert audit_finding data on re-audit instead of skipping

Bridge #12 previously skipped the upsert if a non-resolved audit_finding
insight already existed for a page, meaning issue data never refreshed
between audits. The SQL upsert already preserves resolution_status/note/
resolved_at via the ON CONFLICT clause, so removing the skip is safe."
```

---

## ⚠️ Fix D: Reality check before starting

The roadmap spec listed admin-chat-context.ts (26), webflow-seo.ts (21), keyword-strategy.ts (10), content-requests.ts (9) as top-priority. **These are already done:**
- `admin-chat-context.ts`: 22 `isProgrammingError` uses already applied
- `routes/keyword-strategy.ts`: 17 uses already applied
- `routes/content-requests.ts`: 8 uses already applied
- `routes/webflow-seo.ts`: most hardened; ~7 silent catches remain

**Actual remaining work (32 files, ~74 catches)** — verified via codebase grep:

| File | Silent catches |
|------|---------------|
| `server/routes/webflow-seo.ts` | 7 |
| `server/sales-audit.ts` | 6 |
| `server/webflow-assets.ts` | 5 |
| `server/seo-audit-site-checks.ts` | 4 |
| `server/routes/roadmap.ts` | 4 |
| `server/helpers.ts` | 4 |
| `server/webflow-pages.ts` | 3 |
| `server/seo-audit.ts` | 3 |
| `server/recommendations.ts` | 3 |
| `server/internal-links.ts` | 3 |
| `server/insight-enrichment.ts` | ~5 (comment-only, 0 `isProgrammingError` currently) |
| `server/storage-stats.ts` | 2 (in chat session scan — see Task 12) |
| *(20 more files with 1-2 catches each)* | ~30 |

---

## Task 2 — Fix D Batch 1: insight-enrichment.ts + sales-audit.ts (Model: sonnet)

**Owns:** `server/insight-enrichment.ts`, `server/sales-audit.ts`
**Must not touch:** Any other file

**Context:** `insight-enrichment.ts` has 0 `isProgrammingError` uses and ~5 silent `// keep original` / `// fall through` catches. `sales-audit.ts` has 6. Neither file imports `isProgrammingError` yet.

**Critical special cases — do NOT use `isProgrammingError` for:**
- Catches wrapping `new URL(userInput)` → use `log.debug` for both branches (TypeError for invalid URLs is expected input validation)
- Catches in `insight-enrichment.ts` marked `// Enrichment failure must never block insight storage` → keep as-is or add `log.debug` only

- [ ] **Step 1: Catalog all silent catches**

```bash
grep -n 'catch' server/insight-enrichment.ts | head -20
grep -n 'catch' server/sales-audit.ts | head -20
```

Note which catches wrap `new URL()` calls (use `log.debug` only) vs general logic (use `isProgrammingError` split).

- [ ] **Step 2: Verify/add imports to both files**

```bash
grep -n '^import' server/insight-enrichment.ts | head -5
grep -n '^import' server/sales-audit.ts | head -5
```

Add at top with existing imports if missing:
```typescript
import { isProgrammingError } from './errors.js';
import { createLogger } from './logger.js';
const log = createLogger('<module-name>');
```

- [ ] **Step 3: Apply pattern to each silent catch**

For non-URL-parse catches:
```typescript
} catch (err) {
  if (isProgrammingError(err)) {
    log.warn({ err }, '<module>/<context>: unexpected error');
  } else {
    log.debug({ err }, '<module>/<context>: degrading gracefully');
  }
}
```

For `new URL()` catches:
```typescript
} catch {
  log.debug('insight-enrichment/url-parse: invalid URL in page data — skipping pathname fallback');
}
```

- [ ] **Step 4: Typecheck + commit**

```bash
npm run typecheck
git add server/insight-enrichment.ts server/sales-audit.ts
git commit -m "fix(server): harden silent catches in insight-enrichment and sales-audit"
```

---

## Task 3 — Fix D Batch 2: webflow-assets.ts + seo-audit-site-checks.ts + webflow-seo.ts (Model: sonnet)

**Owns:** `server/webflow-assets.ts`, `server/seo-audit-site-checks.ts`, `server/routes/webflow-seo.ts`
**Must not touch:** Any other file

**Context:** All three files make external Webflow/GSC API calls. Catches wrapping network/API calls should use `log.debug` for both branches (TypeError from `fetch()` is expected degradation). The `isProgrammingError` split applies to internal logic catches only.

- [ ] **Step 1: Catalog catches**

```bash
grep -n 'catch' server/webflow-assets.ts | head -15
grep -n 'catch' server/seo-audit-site-checks.ts | head -10
grep -n 'catch' server/routes/webflow-seo.ts | head -15
```

- [ ] **Step 2: Verify/add imports to each file**

Import path for routes: `import { isProgrammingError } from '../errors.js';`
Import path for server root: `import { isProgrammingError } from './errors.js';`

- [ ] **Step 3: Apply pattern**

For external API call catches → `log.debug` only (no `isProgrammingError` split).
For internal logic catches → full `isProgrammingError` split.

- [ ] **Step 4: Typecheck + commit**

```bash
npm run typecheck
git add server/webflow-assets.ts server/seo-audit-site-checks.ts server/routes/webflow-seo.ts
git commit -m "fix(server): harden silent catches in webflow-assets, seo-audit-site-checks, webflow-seo"
```

---

## Task 4 — Fix D Batch 3: routes/roadmap.ts + helpers.ts (Model: sonnet)

**Owns:** `server/routes/roadmap.ts`, `server/helpers.ts`
**Must not touch:** Any other file

> **Note:** `server/helpers.ts` is also touched by the Fix E type-predicate changes. To avoid a parallel-agent merge conflict, Task 4 owns ALL changes to `helpers.ts` — both the catch hardening (this task) and the type-predicate fix (which would otherwise be Task 8). **Task 4 must run AFTER Task 6 commits the generic types**, then apply both change sets to helpers.ts in one commit.

- [ ] **Step 1: Catalog catches**

```bash
grep -n 'catch' server/routes/roadmap.ts | head -10
grep -n 'catch' server/helpers.ts | head -15
```

- [ ] **Step 2: Apply catch-hardening pattern to helpers.ts**

For `helpers.ts`, note any catches wrapping `new URL()` calls — those stay as `log.debug`-only since malformed URLs from GSC/external data are expected validation failures.

- [ ] **Step 3: Apply type-predicate fix to helpers.ts (after Task 6 is committed)**

Fix the `as unknown as PageHealthData` cast at line ~288. Narrow the insight before accessing data:
```typescript
const healthInsights = allInsights.filter(
  (i): i is AnalyticsInsight<'page_health'> => i.insightType === 'page_health' && !!i.pageId
);
for (const insight of healthInsights) {
  insightsMap.set(insight.pageId!, {
    healthScore: insight.data.score,
    // ...
  });
}
```

Ensure `AnalyticsInsight` is imported with the generic: `import type { AnalyticsInsight, ... } from '../shared/types/analytics.js'`.

- [ ] **Step 4: Typecheck + commit**

```bash
npm run typecheck
git add server/routes/roadmap.ts server/helpers.ts
git commit -m "fix(server): harden catches and remove type cast in routes/roadmap and helpers"
```

---

## Task 5 — Fix D Batch 4: Remaining 20+ files sweep (Model: sonnet)

**Owns:** All remaining server files with silent catches (see list below)
**Must not touch:** Any file already handled in Tasks 2-4

**Context:** 20+ files each have 1-2 silent catches. Handle as a single sweep.

- [ ] **Step 1: Get the full remaining list**

```bash
grep -rl '} catch {' server/ | grep -v node_modules
grep -rn 'catch (err) {$' server/ | grep -v 'isProgrammingError\|log\.' | grep -v node_modules | head -50
```

Known remaining files from audit: `server/webflow-pages.ts`, `server/seo-audit.ts`, `server/recommendations.ts`, `server/internal-links.ts`, `server/semrush.ts`, `server/schema-suggester.ts`, `server/routes/webflow-cms.ts`, `server/routes/jobs.ts`, `server/providers/dataforseo-provider.ts`, `server/openai-helpers.ts`, `server/monthly-report.ts`, `server/db/migrate-json.ts`, `server/competitor-schema.ts`, `server/websocket.ts`, `server/routes/site-architecture.ts`, `server/routes/public-portal.ts`, `server/routes/misc.ts`, `server/redirect-scanner.ts`, `server/processor.ts`, `server/pagespeed.ts`, `server/email-queue.ts`, `server/churn-signals.ts`, `server/audit-page.ts`, `server/aeo-page-review.ts`

Note: Do NOT touch `server/storage-stats.ts` catches here — those are addressed in Task 11.

- [ ] **Step 2: Apply pattern to each file** (same procedure as Task 2 Step 3)

For each file: verify imports exist, apply `isProgrammingError` split to internal-logic catches, use `log.debug` for network/external-API catches. Watch for `new URL()` patterns.

- [ ] **Step 3: Run pr-check sweep + full test suite**

```bash
npx tsx scripts/pr-check.ts --all
npm run typecheck
npx vitest run
```

- [ ] **Step 4: Commit per-file or as a batch**

```bash
git add server/webflow-pages.ts server/seo-audit.ts server/recommendations.ts # ... etc
git commit -m "fix(server): harden remaining silent catch blocks across 20+ server files"
```

---

## Task 6 — Fix E1: Make AnalyticsInsight Generic (shared type commit) (Model: sonnet)

**Owns:** `shared/types/analytics.ts`, `server/analytics-insights-store.ts`, `server/insight-score-adjustments.ts`
**Must not touch:** Any other file

**Context:** This commit establishes the generic type contract that Tasks 7-8 depend on. Must be committed BEFORE Tasks 7-8 are dispatched. After this commit, callers that pass `data: someRecordType as never` will get a type error — those are exactly the write sites that Tasks 7-8 will fix.

- [ ] **Step 1: Update AnalyticsInsight in shared/types/analytics.ts**

Find line ~209 (the `AnalyticsInsight` interface). Replace:

```typescript
export interface AnalyticsInsight {
  id: string;
  workspaceId: string;
  pageId: string | null;
  insightType: InsightType;
  data: Record<string, unknown>;
```

with:

```typescript
export interface AnalyticsInsight<T extends InsightType = InsightType> {
  id: string;
  workspaceId: string;
  pageId: string | null;
  insightType: T;
  data: InsightDataMap[T];
```

Leave all other fields unchanged.

- [ ] **Step 2: Update UpsertInsightParams in analytics-insights-store.ts**

Find `export interface UpsertInsightParams` (around line 154). Replace:

```typescript
export interface UpsertInsightParams {
  workspaceId: string;
  pageId: string | null;
  insightType: InsightType;
  data: InsightDataMap[InsightType];
```

with:

```typescript
export interface UpsertInsightParams<T extends InsightType = InsightType> {
  workspaceId: string;
  pageId: string | null;
  insightType: T;
  data: InsightDataMap[T];
```

- [ ] **Step 3: Update upsertInsight signature in analytics-insights-store.ts**

Find `export function upsertInsight(params: UpsertInsightParams)` (around line 173). Replace with:

```typescript
export function upsertInsight<T extends InsightType>(params: UpsertInsightParams<T>): AnalyticsInsight<T> {
```

Add a cast at the return site since `rowToInsight` returns the wide form:

```typescript
  const row = stmts().selectOne.get(params.workspaceId, params.pageId, params.insightType) as InsightRow;
  return rowToInsight(row) as AnalyticsInsight<T>;
```

- [ ] **Step 4: Update cloneInsightParams in analytics-insights-store.ts**

After this task both `AnalyticsInsight.data` and `UpsertInsightParams.data` are `InsightDataMap[T]` — the `as never` cast at line ~139 is no longer needed and its comment becomes wrong. Make the function generic:

```typescript
export function cloneInsightParams<T extends InsightType>(insight: AnalyticsInsight<T>): UpsertInsightParams<T> {
  return {
    workspaceId: insight.workspaceId,
    pageId: insight.pageId,
    insightType: insight.insightType,
    data: insight.data,  // no cast needed: both sides are now InsightDataMap[T]
    severity: insight.severity,
    pageTitle: insight.pageTitle,
    strategyKeyword: insight.strategyKeyword,
    strategyAlignment: insight.strategyAlignment,
    auditIssues: insight.auditIssues,
    pipelineStatus: insight.pipelineStatus,
    anomalyLinked: insight.anomalyLinked,
    impactScore: insight.impactScore,
    domain: insight.domain,
    resolutionSource: insight.resolutionSource,
    bridgeSource: insight.bridgeSource,
  };
}
```

- [ ] **Step 5: Make applyScoreAdjustment generic in insight-score-adjustments.ts**

Replace the `ScoreAdjustmentResult` interface and function signature:

```typescript
export interface ScoreAdjustmentResult<T extends Record<string, unknown> = Record<string, unknown>> {
  data: T & { _originalBaseScore?: number; _scoreAdjustments?: Record<string, number> };
  adjustedScore: number;
}

export function applyScoreAdjustment<T extends Record<string, unknown>>(
  currentData: T,
  currentImpactScore: number,
  bridgeKey: string,
  delta: number,
): ScoreAdjustmentResult<T> {
```

Update the return statement:

```typescript
  return {
    data: {
      ...currentData,
      _originalBaseScore: originalBase,
      _scoreAdjustments: existingAdj,
    } as T & { _originalBaseScore?: number; _scoreAdjustments?: Record<string, number> },
    adjustedScore,
  };
```

- [ ] **Step 6: Run typecheck — expect errors at remaining `as never` call sites**

```bash
npm run typecheck 2>&1 | grep 'never' | head -20
```

You should see type errors in `anomaly-detection.ts`, `outcome-tracking.ts`, `anomaly-boost-reversal.test.ts`. These are exactly the files Tasks 7-8 will fix.

- [ ] **Step 7: Commit the shared type contract**

```bash
git add shared/types/analytics.ts server/analytics-insights-store.ts server/insight-score-adjustments.ts
git commit -m "refactor(types): make AnalyticsInsight<T> and UpsertInsightParams<T> generic

Tightens the insight data contract from Record<string,unknown> to
InsightDataMap[T]. applyScoreAdjustment and cloneInsightParams are also
made generic. Call sites with 'as never' casts will type-error until
updated in the next commit."
```

---

## Task 7 — Fix E2: Remove Write-Site Casts in anomaly-detection + outcome-tracking (Model: sonnet)

**Owns:** `server/anomaly-detection.ts`, `server/outcome-tracking.ts`, `tests/integration/anomaly-boost-reversal.test.ts`
**Must not touch:** Any file not in this list; Task 8 owns `content-brief.ts`, `admin-chat-context.ts`, `helpers.ts`

**Context:** After Task 6, `applyScoreAdjustment` preserves the generic type. Bridge callbacks that loop over `allInsights: AnalyticsInsight[]` (T=InsightType) pass `insight.data` through `applyScoreAdjustment`. Since union types don't extend `Record<string,unknown>` directly, the intermediate cast `insight.data as unknown as Record<string,unknown>` is still needed to call `applyScoreAdjustment`. The returned `newData` can then be cast as `as unknown as typeof insight.data` (cleaner than `as never`).

Note: `server/reports.ts` was mentioned in the original roadmap notes but has NO `as never` casts — skip it.

- [ ] **Step 1: Fix anomaly-detection.ts — three `as never` casts at lines ~270, ~753, ~806**

For each site:
```typescript
// Before:
data: newData as never,

// After:
data: newData as unknown as typeof insight.data,
```

- [ ] **Step 2: Fix outcome-tracking.ts — one `as never` cast at line ~341**

Same replacement.

- [ ] **Step 3: Fix anomaly-boost-reversal.test.ts — `as never` casts**

The test uses `applyScoreAdjustment` and then passes result to `upsertInsight`. After Task 6 the generic types flow through, but the test may still need explicit type annotations. Check whether the casts are still needed after the generic change. If so, replace `as never` with the concrete type, e.g.:

```typescript
// For a page_health insight:
data: boostedData as unknown as PageHealthData & { _originalBaseScore?: number; _scoreAdjustments?: Record<string, number> },
```

Or more simply, if the generic inference works end-to-end, just remove the cast entirely.

- [ ] **Step 4: Typecheck + run anomaly tests**

```bash
npm run typecheck
npx vitest run tests/integration/anomaly-boost-reversal.test.ts --reporter=verbose
```

- [ ] **Step 5: Commit**

```bash
git add server/anomaly-detection.ts server/outcome-tracking.ts tests/integration/anomaly-boost-reversal.test.ts
git commit -m "refactor(insights): replace 'as never' bridge casts with typed assertions"
```

---

## Task 8 — Fix E2: Remove Read-Site Casts (Model: sonnet)

**Owns:** `server/admin-chat-context.ts`, `server/content-brief.ts`
**Must not touch:** `server/helpers.ts` (owned by Task 4 — both catch changes and type-predicate fix), any other file

**Context:** These files filter `AnalyticsInsight[]` by `insightType` and cast `insight.data`. With `AnalyticsInsight<T>` generic, a type predicate in the filter narrows T and eliminates the cast. The `helpers.ts` predicate fix is handled in Task 4 to avoid a merge conflict (Task 4 already owns that file).

- [ ] **Step 1: Fix admin-chat-context.ts — cast sites for page_health, ranking_opportunity, content_decay, cannibalization, keyword_cluster, anomaly_digest**

Replace filter+cast chains:
```typescript
// Before:
.filter(i => i.insightType === 'page_health')
.map(i => ({ ...(i.data as unknown as PageHealthData), pageTitle: i.pageTitle }))

// After:
.filter((i): i is AnalyticsInsight<'page_health'> => i.insightType === 'page_health')
.map(i => ({ ...i.data, pageTitle: i.pageTitle }))
```

Ensure `AnalyticsInsight` is imported with the generic in scope: `import type { AnalyticsInsight, ... } from '../shared/types/analytics.js'`.

- [ ] **Step 2: Fix content-brief.ts — four cast sites at lines ~1075-1085**

```typescript
cannibalizationInsights: allInsights
  .filter((i): i is AnalyticsInsight<'cannibalization'> => i.insightType === 'cannibalization')
  .map(i => i.data),
decayInsights: allInsights
  .filter((i): i is AnalyticsInsight<'content_decay'> => i.insightType === 'content_decay')
  .map(i => ({ pageId: i.pageId || '', ...i.data })),
quickWins: allInsights
  .filter((i): i is AnalyticsInsight<'ranking_opportunity'> => i.insightType === 'ranking_opportunity')
  .map(i => ({ pageUrl: i.data.pageUrl, query: i.data.query, currentPosition: i.data.currentPosition, estimatedTrafficGain: i.data.estimatedTrafficGain })),
pageHealthScores: allInsights
  .filter((i): i is AnalyticsInsight<'page_health'> => i.insightType === 'page_health' && !!i.pageId)
  .map(i => ({ pageId: i.pageId!, ...i.data })),
```

- [ ] **Step 3: Typecheck + full test suite**

```bash
npm run typecheck && npx vitest run
```

- [ ] **Step 4: Commit**

```bash
git add server/admin-chat-context.ts server/content-brief.ts
git commit -m "refactor(insights): use type predicates to eliminate read-site casts"
```

---

## Task 9 — Fix E3: Remove pr-check Grandfather Exception (Model: haiku)

**Owns:** `scripts/pr-check.ts`
**Must not touch:** Any other file

**Must run AFTER Tasks 6, 7, 8 are complete and passing.**

- [ ] **Step 1: Verify no remaining Record<string,unknown> in analytics.ts**

```bash
grep -n 'Record<string, unknown>' shared/types/analytics.ts
```

Expected: zero results.

- [ ] **Step 2: Remove the exclude lines in scripts/pr-check.ts at lines ~1693-1696**

Remove:
```typescript
    / Grandfather exception: AnalyticsInsight.data is the discriminated-union
    // container (InsightDataMap narrows it at the read boundary). This is the
    // one legitimate escape hatch and is documented in the insight rules.
    exclude: ['shared/types/analytics.ts'],
```

- [ ] **Step 3: Run pr-check + typecheck**

```bash
npx tsx scripts/pr-check.ts --all
npm run typecheck
```

- [ ] **Step 4: Commit**

```bash
git add scripts/pr-check.ts
git commit -m "refactor(pr-check): remove AnalyticsInsight.data Record<string,unknown> exception"
```

---

## Task 10 — Fix E4: KeywordStrategy Schema Drift (Model: sonnet)

**Owns:** `server/schemas/workspace-schemas.ts`, `server/workspaces.ts`
**Must not touch:** `shared/types/workspace.ts`

**Context:** `workspaces.ts:~130` has `as unknown as KeywordStrategy`. The schema is missing `siteKeywordMetrics` (in the TS interface) and the fallback object includes `generatedAt` (not in the interface). Fix: add both to the schema, remove the cast.

- [ ] **Step 1: Update keywordStrategySchema in server/schemas/workspace-schemas.ts**

```typescript
export const keywordStrategySchema = z.object({
  siteKeywords: z.array(z.string()),
  pageMap: z.array(pageKeywordMapSchema).optional(),
  opportunities: z.array(z.string()),
  siteKeywordMetrics: z.array(z.object({
    keyword: z.string(),
    volume: z.number(),
    difficulty: z.number(),
  })).optional(),
  generatedAt: z.string().optional(),
}).passthrough();
```

- [ ] **Step 2: Remove the cast in server/workspaces.ts at line ~130**

```typescript
  if (row.keyword_strategy) {
    const ks = parseJsonSafe(row.keyword_strategy, keywordStrategySchema, null, { workspaceId: row.id, field: 'keyword_strategy', table: 'workspaces' });
    ws.keywordStrategy = ks ?? { siteKeywords: [], pageMap: [], opportunities: [] };
  }
```

- [ ] **Step 3: Typecheck**

```bash
npm run typecheck
```

If TypeScript still complains, add the missing field to `KeywordStrategy` in `shared/types/workspace.ts` or tighten the schema further.

- [ ] **Step 4: Commit**

```bash
git add server/schemas/workspace-schemas.ts server/workspaces.ts
git commit -m "fix(schema): align keywordStrategySchema with KeywordStrategy interface"
```

---

## Task 11 — Fix F: Convert getStorageReport to Async (Model: sonnet)

**Owns:** `server/storage-stats.ts`, `server/routes/health.ts`, `tests/integration/health-routes.test.ts`
**Must not touch:** Any other file

**Context:** `getStorageReport()` uses synchronous `fs.*Sync` calls which block the Node.js event loop during storage scans. The fix adds a new `dirSizeAsync()` helper and converts only `getStorageReport()` to async. The original `dirSize()` MUST stay synchronous — `pruneBackups()` calls it at line ~260 and all 4 prune functions (`pruneChatSessions`, `pruneBackups`, `pruneReportSnapshots`, `pruneActivityLogs`) are synchronous. Do NOT convert `dirSize()` itself.

- [ ] **Step 1: Add dirSizeAsync() below the existing dirSize() function in storage-stats.ts**

After the closing `}` of `dirSize()` (after line ~59), add:

```typescript
/** Async variant of dirSize — used by getStorageReport() to avoid blocking the event loop. */
async function dirSizeAsync(dirPath: string): Promise<{ bytes: number; files: number }> {
  let bytes = 0;
  let files = 0;
  try {
    await fs.promises.access(dirPath);
    const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dirPath, entry.name);
      try {
        if (entry.isDirectory()) {
          const sub = await dirSizeAsync(full);
          bytes += sub.bytes;
          files += sub.files;
        } else if (entry.isFile()) {
          bytes += (await fs.promises.stat(full)).size;
          files++;
        }
      } catch (err) {
        if (isProgrammingError(err)) log.warn({ err }, 'storage-stats/dirSizeAsync: programming error');
      }
    }
  } catch (err) {
    if (isProgrammingError(err)) log.warn({ err }, 'storage-stats/dirSizeAsync: programming error');
  }
  return { bytes, files };
}
```

- [ ] **Step 2: Convert getStorageReport() to async using dirSizeAsync**

Change signature and replace all `dirSize()` calls in this function with `await dirSizeAsync()`. Also convert the chat session scan to use `fs.promises`:

```typescript
export async function getStorageReport(): Promise<StorageReport> {
  const dataRoot = DATA_BASE || path.join(process.env.HOME || '', '.asset-dashboard');
  const breakdown: DirStats[] = [];
  let totalBytes = 0;
  let totalFiles = 0;

  for (const sub of knownDirs) {
    const dirPath = path.join(dataRoot, sub);
    const stats = await dirSizeAsync(dirPath);
    if (stats.bytes > 0 || stats.files > 0) {
      breakdown.push({ name: sub, bytes: stats.bytes, fileCount: stats.files, label: CATEGORY_LABELS[sub] || sub });
      totalBytes += stats.bytes;
      totalFiles += stats.files;
    }
  }

  try {
    const uploadRoot = getUploadRoot();
    const uploadStats = await dirSizeAsync(uploadRoot);
    if (uploadStats.bytes > 0) {
      breakdown.push({ name: 'uploads', bytes: uploadStats.bytes, fileCount: uploadStats.files, label: CATEGORY_LABELS.uploads });
      totalBytes += uploadStats.bytes;
      totalFiles += uploadStats.files;
    }
  } catch (err) {
    if (isProgrammingError(err)) log.warn({ err }, 'storage-stats: programming error');
  }

  try {
    const optRoot = getOptRoot();
    const optStats = await dirSizeAsync(optRoot);
    if (optStats.bytes > 0) {
      breakdown.push({ name: 'optimized', bytes: optStats.bytes, fileCount: optStats.files, label: CATEGORY_LABELS.optimized });
      totalBytes += optStats.bytes;
      totalFiles += optStats.files;
    }
  } catch (err) {
    if (isProgrammingError(err)) log.warn({ err }, 'storage-stats: programming error');
  }

  breakdown.sort((a, b) => b.bytes - a.bytes);

  const chatDir = path.join(dataRoot, 'chat-sessions');
  let chatSessionCount = 0;
  let oldestChatSession: string | null = null;
  try {
    const wsDirs = (await fs.promises.readdir(chatDir, { withFileTypes: true }).catch(() => [])).filter(d => d.isDirectory());
    for (const wsDir of wsDirs) {
      const wsPath = path.join(chatDir, wsDir.name);
      const files = (await fs.promises.readdir(wsPath).catch(() => [])).filter((f: string) => f.endsWith('.json'));
      chatSessionCount += files.length;
      for (const file of files) {
        try {
          const raw = await fs.promises.readFile(path.join(wsPath, file), 'utf-8');
          const data = JSON.parse(raw);
          if (data.createdAt && (!oldestChatSession || data.createdAt < oldestChatSession)) {
            oldestChatSession = data.createdAt;
          }
        } catch { /* skip malformed session files */ }
      }
    }
  } catch { /* chatDir not found or inaccessible */ }

  const retentionDays = parseInt(process.env.BACKUP_RETENTION_DAYS || '7', 10);
  return { totalBytes, totalFiles, breakdown, backupRetentionDays: retentionDays, chatSessionCount, oldestChatSession, timestamp: new Date().toISOString() };
}
```

- [ ] **Step 3: Update the route handler in server/routes/health.ts**

```typescript
router.get('/api/admin/storage-stats', async (_req, res) => {
  try {
    const report = await getStorageReport();
    res.json(report);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to get storage stats' });
  }
});
```

- [ ] **Step 4: Reduce test timeout in health-routes.test.ts at line ~67**

```typescript
  it('GET /api/admin/storage-stats returns report', async () => {
    const res = await api('/api/admin/storage-stats');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('totalBytes');
    expect(body).toHaveProperty('breakdown');
    expect(body).toHaveProperty('timestamp');
  }, 30_000);
```

- [ ] **Step 5: Typecheck + run storage test**

```bash
npm run typecheck
npx vitest run tests/integration/health-routes.test.ts --reporter=verbose
```

Verify storage stats test passes within 30s.

- [ ] **Step 6: Full test suite + build**

```bash
npm run typecheck && npx vitest run && npx vite build
```

- [ ] **Step 7: Commit**

```bash
git add server/storage-stats.ts server/routes/health.ts tests/integration/health-routes.test.ts
git commit -m "fix(storage-stats): add dirSizeAsync, convert getStorageReport to async

Adds dirSizeAsync() alongside the existing sync dirSize() (which must
remain sync — pruneBackups/pruneChatSessions/etc. call it synchronously).
getStorageReport now uses async fs.promises throughout. Route handler
updated to await. Test timeout reduced from 120s to 30s."
```

---

## Task 12 — Post-Task: Quality Gates and Docs (Model: sonnet)

**Owns:** `data/roadmap.json`, `FEATURE_AUDIT.md`
**Must not touch:** Any source file

- [ ] **Step 1: Full quality gates**

```bash
npm run typecheck && npx vite build && npx vitest run && npx tsx scripts/pr-check.ts --all
```

All must pass.

- [ ] **Step 2: Update data/roadmap.json**

Mark done:
- `anomaly-boost-reversal-mechanism` — "Already implemented. Both periodic and dismiss-triggered reversal confirmed in anomaly-boost-reversal.test.ts."
- Dedup fix item — "Fixed Bridge #12 skip in scheduled-audits.ts"
- `#576` (catch hardening) — "Applied isProgrammingError pattern to 32 files (~74 catches)"
- `#580` (AnalyticsInsight generic) — "AnalyticsInsight<T>, UpsertInsightParams<T>, cloneInsightParams<T> generic; as-never casts removed"
- `#581` (KeywordStrategy schema) — "Added siteKeywordMetrics + generatedAt, removed as-unknown-as cast"

```bash
npx tsx scripts/sort-roadmap.ts
```

- [ ] **Step 3: Update FEATURE_AUDIT.md**

Add/update entries for dedup fix, generic types, catch hardening.

- [ ] **Step 4: Invoke code review**

This plan touches 30+ files across parallel tasks — use `superpowers:scaled-code-review` (not `requesting-code-review`). Per CLAUDE.md: parallel-agent work requires `scaled-code-review`.

- [ ] **Step 5: data/features.json**

No update needed — this is infrastructure hardening, not a client-visible or sales-relevant feature.

---

## Task Dependencies

```
Independent (no ordering constraints, can run in parallel):
  Task 1  (Dedup fix)
  Tasks 2, 3, 5  (Fix D batches — different file sets, no shared files)
  Task 10 (KeywordStrategy schema)
  Task 11 (async storage-stats)

Note: Tasks 2-3 and 5 own different files and can be parallel.
Task 4 is SEQUENTIAL after Task 6 — it owns server/helpers.ts and must
apply both the catch-hardening AND the type-predicate fix in one commit
to avoid dual-ownership conflict with Task 8's helpers.ts changes.

Sequential (strict order):
  Task 6 (E1 generic types — commit first)
    → Task 4  (Fix D helpers.ts — catch-harden + type-predicate in one commit)
    → Tasks 7 + 8 (parallel — different file sets, helpers.ts excluded from 8)
      → Task 9 (remove pr-check exception — after 7+8 land)

Final:
  Task 12 (quality gates + docs — runs last)
```

---

## Systemic Improvements

- **New pr-check rule candidate:** Flag `upsertInsight({ data: ... as never })` now that the generic is in place — callers should use properly typed forms.
- **`?lite=true` mode for storage stats:** The chat session JSON parsing in `getStorageReport` reads every session file to find `oldestChatSession`. A `?lite=true` query param could skip this and return only byte/file counts — good follow-up for large installs.
- **Fix D remaining scope:** Tasks 2-5 cover ~74 catches across 32 files. After landing, run `grep -rc '} catch {' server/` to confirm no new silent catches were introduced.

---

## Verification Strategy

- `npm run typecheck` — zero errors after each task
- `npx vitest run` — full suite green after each batch
- `npx vite build` — production build after Task 12
- `npx tsx scripts/pr-check.ts --all` — after Task 5 (Fix D) and after Task 9 (exception removed)
- `npx vitest run tests/integration/anomaly-boost-reversal.test.ts` — after Task 7
- `npx vitest run tests/integration/health-routes.test.ts` — after Task 11
- `npx vitest run tests/integration/scheduled-audits-dedup.test.ts` — after Task 1
