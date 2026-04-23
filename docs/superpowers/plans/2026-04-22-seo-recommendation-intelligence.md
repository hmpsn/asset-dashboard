# SEO Recommendation Intelligence — Implementation Plan

> References: [CLAUDE.md](../../../CLAUDE.md), [docs/PLAN_WRITING_GUIDE.md](../../PLAN_WRITING_GUIDE.md).
>
> **Pre-requisite:** The SEO Tier 3 data-source plan ([2026-04-22-seo-tier3-data-sources.md](./2026-04-22-seo-tier3-data-sources.md)) must be fully merged to `staging` before this plan starts. Specifically, Task 7 of that plan must be committed so `buildLearningsBoost`, `getRecoveryRate`, and `seasonalTag` are already in `server/recommendations.ts`.

## Overview

Five enhancements to the SEO recommendation engine drawn from the Tier 1 Quick Wins spec. All five modify `server/recommendations.ts` and must run **sequentially** — there is no parallelism. Each task commits independently so a regression in task N does not block tasks N-1 from merging.

| Task | Item | Change |
|------|------|--------|
| 1 | Item 2 | Conversion-rate multiplier in `getTrafficScore` — high-converting pages surface first |
| 2 | Item 4 | Authority-adjusted KD filtering for content gap recs |
| 3 | Item 1 | CTR gap → specific title/meta recommendations |
| 4 | Item 5 | Search intent mismatch detection |
| 5 | Item 6 | Diagnostic remediation → auto-created recommendations |

---

## Pre-Plan Audit — Current State (2026-04-22)

Verified against HEAD. Line numbers are current anchors for the implementation tasks.

| Item | Key finding |
|------|------------|
| Item 2 | `getTrafficScore()` at line 165, signature `(traffic, slug): number` — no conversion param yet. `ConversionAttributionData` confirmed in `shared/types/analytics.ts` with field `conversionRate` (percentage). `'conversion_attribution'` is a valid `InsightType`. `getInsights` not yet imported in `recommendations.ts`. |
| Item 4 | Content gap loop at lines 604–641; `impactScore` computed at line 617. `getDomainOverview` confirmed on `SeoDataProvider` interface. `ws.liveDomain` exists as optional `string` on workspace. |
| Item 1 | Content decay section ends at line 739 (not 726 as spec says). New CTR gap section inserts after 739. `getInsights` not yet imported (will be added by Task 1). `CtrOpportunityData` confirmed: `pageUrl`, `position`, `actualCtr`, `expectedCtr`, `impressions`, `estimatedClickGap`. `'ctr_opportunity'` is a valid `InsightType`. |
| Item 5 | `listPageKeywords` **already imported** in `recommendations.ts` (no new import needed). Returns `PageKeywordMap[]` with `searchIntent: string \| null`. Strategy section begins at line 555; `listPageKeywords(workspaceId)` call at line 645. Intent mismatch section inserts after line 681 (end of ranking opportunity loop). |
| Item 6 | `listDiagnosticReports` in `server/diagnostic-store.ts:110`. `RemediationAction` confirmed: `priority` (P0–P3), `title`, `description`, `effort` (low/medium/high), `impact` (high/medium/low), `owner` (dev/content/seo), `pageUrls?`. Diagnostic section inserts after line 739 (after content decay, before CTR gap if both land). |

**Import status for `server/recommendations.ts`:** does NOT yet import `getInsights` (analytics-insights-store), `getWorkspaceLearnings` (added by Tier 3 Task 7), or `listDiagnosticReports`. Does already import `listPageKeywords`.

---

## Task Dependencies

```
Sequential (same file — no parallelism possible):
  Task 1 (Item 2: conversion multiplier — modifies getTrafficScore)
    → Task 2 (Item 4: authority KD — modifies content gap section)
    → Task 3 (Item 1: CTR gap recs — inserts new section after line 739)
    → Task 4 (Item 5: intent mismatch — inserts new section after strategy loop)
    → Task 5 (Item 6: diagnostic recs — inserts new section last)
    → Task 6 (Verification)
    → Task 7 (Docs)
```

Rationale: all tasks own `server/recommendations.ts`. Task ordering is chosen so earlier tasks modify _existing_ code regions (top of file, existing loops) and later tasks _append_ new sections — minimizing conflict if an implementer accidentally starts the wrong task early.

---

## File Ownership Summary

| Task | Owns (create/modify) | Must not touch |
|------|----------------------|----------------|
| 1 | `server/recommendations.ts`, `tests/unit/recommendations-conversion.test.ts` | everything else |
| 2 | `server/recommendations.ts`, `tests/unit/recommendations-authority-kd.test.ts` | everything else |
| 3 | `server/recommendations.ts`, `tests/integration/recommendations-ctr-gap.test.ts` | everything else |
| 4 | `server/recommendations.ts`, `tests/unit/recommendations-intent-mismatch.test.ts` | everything else |
| 5 | `server/recommendations.ts`, `tests/integration/recommendations-diagnostic.test.ts` | everything else |
| 6 | (verification only) | — |
| 7 | `FEATURE_AUDIT.md`, `data/roadmap.json` | everything else |

---

## Model Assignments

| Task | Model | Reason |
|------|-------|--------|
| 1 (Item 2) | `sonnet` | New import + function signature change + call-site updates |
| 2 (Item 4) | `sonnet` | Dynamic provider import + loop modification |
| 3 (Item 1) | `sonnet` | New section + insight data mapping |
| 4 (Item 5) | `haiku` | Pure helper functions + loop insertion |
| 5 (Item 6) | `sonnet` | New import + nested loops + type mapping |
| 6 (verify) | `sonnet` | Full test-suite parse |
| 7 (docs) | `haiku` | FEATURE_AUDIT + roadmap entries |

---

## Task List

---

### Task 1 — Item 2: Conversion-weighted traffic scoring (Model: sonnet)

**Files:**
- Modify: `server/recommendations.ts` — add `getInsights` import; build conversion map; extend `getTrafficScore` signature; update call sites
- Create: `tests/unit/recommendations-conversion.test.ts`

**Owns:** the two files above.
**Must not touch:** anything else.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/recommendations-conversion.test.ts` (port 13333 — reserved but no server bind):

```ts
import { describe, it, expect } from 'vitest';
import { getTrafficScore } from '../../server/recommendations.js';

const traffic = {
  '/plumbing': { clicks: 100, impressions: 2000, pageviews: 150 },
  '/hvac':     { clicks: 50,  impressions: 1000, pageviews: 80  },
};

describe('getTrafficScore — conversion multiplier', () => {
  it('applies up to 1.5x boost for pages with CVR > 2%', () => {
    const base    = getTrafficScore(traffic, 'plumbing');
    const boosted = getTrafficScore(traffic, 'plumbing', 4.0); // 4% → boost
    expect(boosted).toBeGreaterThan(base);
    expect(boosted).toBeLessThanOrEqual(base * 1.5);
  });

  it('applies no boost for pages with CVR <= 2%', () => {
    const base = getTrafficScore(traffic, 'hvac');
    expect(getTrafficScore(traffic, 'hvac', 1.5)).toBe(base);
    expect(getTrafficScore(traffic, 'hvac', undefined)).toBe(base);
  });

  it('caps multiplier at 1.5x even for very high CVR', () => {
    const base = getTrafficScore(traffic, 'plumbing');
    expect(getTrafficScore(traffic, 'plumbing', 100)).toBe(base * 1.5);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/recommendations-conversion.test.ts`
Expected: FAIL — `getTrafficScore` is not exported.

- [ ] **Step 3: Add `getInsights` import and export `getTrafficScore`**

In `server/recommendations.ts`, add to the top-of-file imports (grouped with other `./` imports):

```ts
import { getInsights } from './analytics-insights-store.js';
```

Change the existing `function getTrafficScore` declaration at line 165 to `export function getTrafficScore`.

- [ ] **Step 4: Extend `getTrafficScore` signature**

Replace the current body of `getTrafficScore` (currently lines 165–174):

```ts
export function getTrafficScore(traffic: TrafficMap, slug: string, conversionRate?: number): number {
  const t = traffic[`/${slug}`] || traffic[slug];
  if (!t) return 0;
  const base = t.clicks * 2 + t.impressions * 0.1 + t.pageviews;
  // Pages with >2% CVR get up to 1.5x boost; drives high-converting pages to the top.
  const convMultiplier = conversionRate && conversionRate > 2
    ? Math.min(1.5, 1 + conversionRate / 20)
    : 1;
  return base * convMultiplier;
}
```

- [ ] **Step 5: Build the conversion map and pass it to `getTrafficScore` call sites**

> **Implementer note — page identifier gap:** `ConversionAttributionData` has no page path field (`sessions`, `conversions`, `conversionRate`, `estimatedRevenue` only). `AnalyticsInsight.pageId` (`string | null`) is the only page identifier. Before writing the map, open `server/analytics-intelligence.ts` and find `computeConversionAttributionInsights()` — it creates these insights; the `pageId` it stores is the id used in the `page_keywords` / snapshot tables. Then check whether `getLatestSnapshot()` returns pages with both `id` and `slug` so you can build a `Map<pageId, slug>` for the reverse lookup. If it does, key `conversionMap` by slug derived from that reverse map. If the snapshot doesn't expose IDs, use `getPageIdBySlug` applied to each slug in the traffic map (inversely) or query pages directly. Do not proceed with `insight.pageUrl` — that field does not exist on `AnalyticsInsight`.

Inside `generateRecommendations`, after the traffic map is built and after the snapshot pages are available, build the conversion map:

```ts
  // Build a pageId → slug reverse map from snapshot pages (adjust to actual snapshot shape).
  const pageIdToSlug = new Map<string, string>();
  for (const page of snapshot?.pages ?? []) {
    if (page.id && page.slug) pageIdToSlug.set(page.id, page.slug);
  }

  // Build page-level conversion rates from GA4 conversion_attribution insights.
  const conversionMap = new Map<string, number>(); // keyed by slug
  for (const insight of getInsights(workspaceId, 'conversion_attribution')) {
    const data = insight.data as import('../shared/types/analytics.js').ConversionAttributionData;
    if (data?.conversionRate != null && insight.pageId) {
      const slug = pageIdToSlug.get(insight.pageId);
      if (slug) conversionMap.set(slug, data.conversionRate);
    }
  }
```

Adjust `snapshot?.pages` to match the actual `AuditSnapshot` shape returned by `getLatestSnapshot`. Then update every `getTrafficScore(traffic, ...)` call in the file to pass the conversion rate:

```ts
getTrafficScore(traffic, slug, conversionMap.get(slug))
```

Grep the file for `getTrafficScore(` to find all call sites before editing.

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run tests/unit/recommendations-conversion.test.ts`
Expected: PASS.

- [ ] **Step 7: Run existing recommendations tests**

Run: `npx vitest run tests/integration/recommendations*.test.ts tests/unit/recommendations*.test.ts 2>&1 | tail -20`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add server/recommendations.ts tests/unit/recommendations-conversion.test.ts
git commit -m "feat(recommendations): conversion-rate multiplier in traffic scoring (Item 2)"
```

---

### Task 2 — Item 4: Authority-adjusted KD filtering (Model: sonnet)

**Files:**
- Modify: `server/recommendations.ts` — add domain strength fetch at start of `generateRecommendations`; adjust content gap `impactScore` and `estimatedGain`
- Create: `tests/unit/recommendations-authority-kd.test.ts`

**Owns:** the two files above.
**Must not touch:** anything else.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/recommendations-authority-kd.test.ts` (port 13334 — reserved, no server bind):

```ts
import { describe, it, expect } from 'vitest';
import { adjustKdImpactScore } from '../../server/recommendations.js';

describe('adjustKdImpactScore', () => {
  it('penalizes by 40% when KD is 30+ points above domain strength', () => {
    expect(adjustKdImpactScore(65, 80, 30)).toBe(Math.round(65 * 0.6));
  });
  it('penalizes by 20% when KD is 15-30 points above domain strength', () => {
    expect(adjustKdImpactScore(65, 50, 30)).toBe(Math.round(65 * 0.8));
  });
  it('boosts by 20% (capped 100) when KD is 20+ points below domain strength', () => {
    expect(adjustKdImpactScore(65, 10, 50)).toBe(Math.min(100, Math.round(65 * 1.2)));
  });
  it('returns original score when domain strength is 0', () => {
    expect(adjustKdImpactScore(65, 70, 0)).toBe(65);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/recommendations-authority-kd.test.ts`
Expected: FAIL — `adjustKdImpactScore` not exported.

- [ ] **Step 3: Extract `adjustKdImpactScore` helper**

After the `buildLearningsBoost` helper added by Tier 3 Task 7 (or after `getRecoveryRate` if Task 7 hasn't landed yet), add:

```ts
/** @internal exported for unit testing */
export function adjustKdImpactScore(baseScore: number, difficulty: number, domainStrength: number): number {
  if (!domainStrength) return baseScore;
  const kdGap = difficulty - domainStrength;
  if (kdGap > 30)  return Math.round(baseScore * 0.6);
  if (kdGap > 15)  return Math.round(baseScore * 0.8);
  if (kdGap < -20) return Math.min(100, Math.round(baseScore * 1.2));
  return baseScore;
}
```

- [ ] **Step 4: Fetch domain strength at start of `generateRecommendations`**

After the `learningsBoost` block (added by Tier 3 Task 7), add:

```ts
  let domainStrength = 0;
  if (ws?.liveDomain) {
    try {
      const { getConfiguredProvider } = await import('./seo-data-provider.js');
      const provider = getConfiguredProvider(ws.seoDataProvider);
      if (provider) {
        const overview = await provider.getDomainOverview(ws.liveDomain, workspaceId);
        if (overview) {
          domainStrength = overview.organicKeywords >= 1000 ? 80
            : overview.organicKeywords >= 100 ? 50
            : 20;
        }
      }
    } catch { /* non-critical */ }
  }
```

- [ ] **Step 5: Apply `adjustKdImpactScore` in the content gap loop**

In the content gap loop (anchor: the `impactScore` assignment around line 617, now shifted by prior tasks), replace the static `impactScore` assignment:

```ts
  let impactScore = cg.priority === 'high' ? 65 : cg.priority === 'medium' ? 45 : 25;
  if (cg.difficulty != null) {
    impactScore = adjustKdImpactScore(impactScore, cg.difficulty, domainStrength);
  }
```

Also append a difficulty note to `estimatedGain` when KD was adjusted. After computing `estimatedGain` for content gap recs, add:

```ts
  const kdNote = cg.difficulty && domainStrength
    ? (cg.difficulty - domainStrength > 15
        ? ` (KD ${cg.difficulty} may be challenging — consider building authority first)`
        : cg.difficulty - domainStrength < -20
          ? ` (KD ${cg.difficulty} is well within reach for your domain)`
          : '')
    : '';
  // Append kdNote to the estimatedGain string
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run tests/unit/recommendations-authority-kd.test.ts`
Expected: PASS.

- [ ] **Step 7: Run existing recommendations tests**

Run: `npx vitest run tests/integration/recommendations*.test.ts tests/unit/recommendations*.test.ts 2>&1 | tail -20`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add server/recommendations.ts tests/unit/recommendations-authority-kd.test.ts
git commit -m "feat(recommendations): authority-adjusted KD filtering for content gap recs (Item 4)"
```

---

### Task 3 — Item 1: CTR gap → title/meta recommendations (Model: sonnet)

**Files:**
- Modify: `server/recommendations.ts` — add CTR gap section after content decay (after line 739, shifted by prior tasks)
- Create: `tests/integration/recommendations-ctr-gap.test.ts`

**Owns:** the two files above.
**Must not touch:** anything else.

Note: `getInsights` is already imported by Task 1. Do not re-import.

- [ ] **Step 1: Write the failing test**

Create `tests/integration/recommendations-ctr-gap.test.ts` with port `13335`:

```ts
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { createTestContext } from './helpers.js';
import { seedWorkspace } from '../fixtures/workspace-seed.js';

const ctx = createTestContext(13335);

vi.doMock('../../server/analytics-insights-store.js', async (orig) => {
  const actual = await orig<typeof import('../../server/analytics-insights-store.js')>();
  return {
    ...actual,
    getInsights: (wsId: string, type?: string) => {
      if (type === 'ctr_opportunity') {
        return [{
          id: 'ins_ctr_1',
          workspaceId: wsId,
          insightType: 'ctr_opportunity',
          pageUrl: '/plumbing',
          data: {
            pageUrl: '/plumbing',
            position: 4.5,
            actualCtr: 1.2,
            expectedCtr: 6.0,
            impressions: 3200,
            estimatedClickGap: 153,
          },
          createdAt: new Date().toISOString(),
        }];
      }
      return actual.getInsights(wsId, type);
    },
  };
});

describe('generateRecommendations — CTR gap', () => {
  let wsId: string;
  let cleanup: () => void;
  beforeAll(async () => { await ctx.start(); const s = seedWorkspace({}); wsId = s.workspaceId; cleanup = s.cleanup; });
  afterAll(async () => { cleanup(); await ctx.stop(); vi.resetModules(); });

  it('creates a fix_now metadata rec for large CTR gaps', async () => {
    const { generateRecommendations } = await import('../../server/recommendations.js');
    const set = await generateRecommendations(wsId);
    const ctrRec = set.recommendations.find(r => r.source === 'insight:ctr_opportunity');
    expect(ctrRec).toBeDefined();
    expect(ctrRec?.priority).toBe('fix_now'); // estimatedClickGap 153 > 50
    expect(ctrRec?.type).toBe('metadata');
    expect(ctrRec?.trafficAtRisk).toBe(153);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/integration/recommendations-ctr-gap.test.ts`
Expected: FAIL — no `source: 'insight:ctr_opportunity'` recommendation produced.

- [ ] **Step 3: Add CTR gap section**

After the content decay `catch` block (anchor: the closing `}` of the `try { ... } catch (err) { log.warn ... }` wrapping the decay section — currently line ~739 before prior tasks shift it), add:

```ts
  // ── 4. CTR opportunity recommendations ──────────────────────────────────────
  try {
    const ctrInsights = getInsights(workspaceId, 'ctr_opportunity');
    const topCtr = [...ctrInsights]
      .sort((a, b) => {
        const aGap = (a.data as import('../shared/types/analytics.js').CtrOpportunityData).estimatedClickGap ?? 0;
        const bGap = (b.data as import('../shared/types/analytics.js').CtrOpportunityData).estimatedClickGap ?? 0;
        return bGap - aGap;
      })
      .slice(0, 10);

    for (const insight of topCtr) {
      const d = insight.data as import('../shared/types/analytics.js').CtrOpportunityData;
      const pageSlug = (d.pageUrl ?? '').replace(/^\//, '');
      const gap = d.estimatedClickGap ?? 0;
      recs.push({
        id: `rec_${crypto.randomBytes(6).toString('hex')}`,
        workspaceId,
        priority: gap > 50 ? 'fix_now' : 'fix_soon',
        type: 'metadata',
        title: `CTR Underperformance: /${pageSlug} (${d.actualCtr}% vs ${d.expectedCtr}% expected)`,
        description: `This page gets ${d.impressions?.toLocaleString()} impressions/mo at position #${d.position?.toFixed(1)} but only ${d.actualCtr}% CTR (expected ~${d.expectedCtr}%). Improving the title and meta description could add ~${gap} clicks/mo.`,
        insight: `CTR below expected for this position means the title/description isn't compelling enough to earn clicks. Target CTR for position ${d.position?.toFixed(1)} is ~${d.expectedCtr}%.`,
        impact: gap > 100 ? 'high' : gap > 30 ? 'medium' : 'low',
        effort: 'low',
        impactScore: Math.min(90, 40 + Math.round(gap / 2)),
        source: 'insight:ctr_opportunity',
        affectedPages: [pageSlug],
        trafficAtRisk: gap,
        impressionsAtRisk: 0,
        estimatedGain: `Optimizing title/meta could recover ~${gap} clicks/mo`,
        actionType: 'purchase',
        status: 'pending',
        assignedTo,
        createdAt: now,
        updatedAt: now,
      });
    }
  } catch (err) {
    log.warn({ err }, 'CTR opportunity insights unavailable for recommendations');
  }
```

Check the existing `recs.push(...)` call sites in the file to confirm the exact shape of a `Recommendation` object (especially `assignedTo` and `now` — they should already be in scope from earlier in `generateRecommendations`).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/integration/recommendations-ctr-gap.test.ts`
Expected: PASS.

- [ ] **Step 5: Run existing recommendations tests**

Run: `npx vitest run tests/integration/recommendations*.test.ts tests/unit/recommendations*.test.ts 2>&1 | tail -20`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/recommendations.ts tests/integration/recommendations-ctr-gap.test.ts
git commit -m "feat(recommendations): CTR gap recommendations from insight store (Item 1)"
```

---

### Task 4 — Item 5: Search intent mismatch detection (Model: haiku)

**Files:**
- Modify: `server/recommendations.ts` — add helper functions + intent mismatch loop after strategy ranking section (~line 681, shifted by prior tasks)
- Create: `tests/unit/recommendations-intent-mismatch.test.ts`

**Owns:** the two files above.
**Must not touch:** anything else.

Note: `listPageKeywords` is already imported — no new import needed.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/recommendations-intent-mismatch.test.ts` (port 13336 — reserved, no server bind):

```ts
import { describe, it, expect } from 'vitest';
import { inferPageType, isIntentMismatch } from '../../server/recommendations.js';

describe('inferPageType', () => {
  it('detects blog pages', () => {
    expect(inferPageType('blog/plumbing-tips')).toBe('blog');
    expect(inferPageType('articles/guide-to-hvac')).toBe('blog');
  });
  it('detects service pages', () => {
    expect(inferPageType('services/plumbing')).toBe('service');
    expect(inferPageType('solutions/hvac-repair')).toBe('service');
  });
  it('falls back to other', () => {
    expect(inferPageType('about')).toBe('other');
  });
});

describe('isIntentMismatch', () => {
  it('flags service/product pages targeting informational intent', () => {
    const r = isIntentMismatch('service', 'informational');
    expect(r.mismatch).toBe(true);
    expect(r.reason).toContain('blog post');
  });
  it('flags blog posts targeting transactional intent', () => {
    const r = isIntentMismatch('blog', 'transactional');
    expect(r.mismatch).toBe(true);
    expect(r.reason).toContain('service/product page');
  });
  it('does not flag well-matched pairs', () => {
    expect(isIntentMismatch('service', 'commercial').mismatch).toBe(false);
    expect(isIntentMismatch('blog', 'informational').mismatch).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/recommendations-intent-mismatch.test.ts`
Expected: FAIL — `inferPageType` and `isIntentMismatch` not exported.

- [ ] **Step 3: Add helper functions**

After the `adjustKdImpactScore` helper (added by Task 2), add:

```ts
/** @internal exported for unit testing */
export function inferPageType(slug: string): 'blog' | 'service' | 'landing' | 'product' | 'other' {
  const s = slug.toLowerCase();
  if (/(?:^|\/)(?:blog|articles?|news|posts?|guides?)/.test(s)) return 'blog';
  if (/(?:^|\/)(?:services?|solutions?|offerings?)/.test(s)) return 'service';
  if (/(?:^|\/)(?:products?|shop|store)/.test(s)) return 'product';
  if (/(?:^|\/)(?:landing|lp[-_])/.test(s)) return 'landing';
  return 'other';
}

/** @internal exported for unit testing */
export function isIntentMismatch(pageType: string, searchIntent: string): { mismatch: boolean; reason: string } {
  if ((pageType === 'service' || pageType === 'product') && searchIntent === 'informational') {
    return { mismatch: true, reason: `This ${pageType} page targets an informational keyword — consider creating a blog post for the informational query and retargeting this page to a commercial/transactional keyword.` };
  }
  if (pageType === 'blog' && searchIntent === 'transactional') {
    return { mismatch: true, reason: `This blog post targets a transactional keyword — consider creating a dedicated service/product page for this keyword instead.` };
  }
  return { mismatch: false, reason: '' };
}
```

- [ ] **Step 4: Add intent mismatch loop**

After the ranking opportunity loop in the strategy section (anchor: the closing `}` of the loop that processes `pageMap` entries at ~line 681, shifted by prior tasks), add:

```ts
  // ── Intent mismatch detection ──────────────────────────────────────────────
  const pageKws = listPageKeywords(workspaceId);
  let intentMismatchCount = 0;
  for (const pk of pageKws) {
    if (!pk.searchIntent || intentMismatchCount >= 10) break;
    const pageType = inferPageType(pk.pagePath);
    const { mismatch, reason } = isIntentMismatch(pageType, pk.searchIntent);
    if (!mismatch) continue;
    intentMismatchCount++;
    const pageSlug = pk.pagePath.replace(/^\//, '');
    recs.push({
      id: `rec_${crypto.randomBytes(6).toString('hex')}`,
      workspaceId,
      priority: 'fix_soon',
      type: 'strategy',
      title: `Intent Mismatch: /${pageSlug} (${pageType} page targeting ${pk.searchIntent} keyword)`,
      description: reason,
      insight: `Pages rank better when page type matches search intent. ${reason}`,
      impact: 'medium',
      effort: 'medium',
      impactScore: 50,
      source: `strategy:intent-mismatch:${pageSlug}`,
      affectedPages: [pageSlug],
      trafficAtRisk: 0,
      impressionsAtRisk: 0,
      estimatedGain: 'Aligning page type with intent typically improves CTR and conversion rate',
      actionType: 'manual',
      status: 'pending',
      assignedTo,
      createdAt: now,
      updatedAt: now,
    });
  }
```

Note: `listPageKeywords` is called again here. It was already called earlier in the function (line 645). To avoid a double DB read, check if the earlier result is stored in a variable and reuse it. If it is stored (likely as `const pageKws = listPageKeywords(workspaceId)` at line 645), reference that variable instead of calling again.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/unit/recommendations-intent-mismatch.test.ts`
Expected: PASS.

- [ ] **Step 6: Run existing recommendations tests**

Run: `npx vitest run tests/integration/recommendations*.test.ts tests/unit/recommendations*.test.ts 2>&1 | tail -20`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add server/recommendations.ts tests/unit/recommendations-intent-mismatch.test.ts
git commit -m "feat(recommendations): search intent mismatch detection (Item 5)"
```

---

### Task 5 — Item 6: Diagnostic remediation → auto-created recommendations (Model: sonnet)

**Files:**
- Modify: `server/recommendations.ts` — add `listDiagnosticReports` import; add diagnostic remediation section
- Create: `tests/integration/recommendations-diagnostic.test.ts`

**Owns:** the two files above.
**Must not touch:** anything else.

- [ ] **Step 1: Write the failing test**

Create `tests/integration/recommendations-diagnostic.test.ts` with port `13337`:

```ts
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { createTestContext } from './helpers.js';
import { seedWorkspace } from '../fixtures/workspace-seed.js';

const ctx = createTestContext(13337);

vi.doMock('../../server/diagnostic-store.js', async (orig) => {
  const actual = await orig<typeof import('../../server/diagnostic-store.js')>();
  return {
    ...actual,
    listDiagnosticReports: () => [{
      id: 'report_abc123',
      workspaceId: 'ws_test',
      status: 'completed',
      remediationActions: [
        {
          priority: 'P1',
          title: 'Fix broken internal links',
          description: 'Three pages have broken internal links reducing crawl efficiency.',
          effort: 'low',
          impact: 'high',
          owner: 'dev',
          pageUrls: ['/services/plumbing'],
        },
      ],
      createdAt: new Date().toISOString(),
    }],
  };
});

describe('generateRecommendations — diagnostic remediation', () => {
  let wsId: string;
  let cleanup: () => void;
  beforeAll(async () => { await ctx.start(); const s = seedWorkspace({}); wsId = s.workspaceId; cleanup = s.cleanup; });
  afterAll(async () => { cleanup(); await ctx.stop(); vi.resetModules(); });

  it('creates a fix_now rec from a completed diagnostic P1 action', async () => {
    const { generateRecommendations } = await import('../../server/recommendations.js');
    const set = await generateRecommendations(wsId);
    const diagRec = set.recommendations.find(r => r.source?.startsWith('diagnostic:'));
    expect(diagRec).toBeDefined();
    expect(diagRec?.priority).toBe('fix_now'); // P1 → fix_now
    expect(diagRec?.title).toContain('Diagnostic: Fix broken internal links');
    expect(diagRec?.type).toBe('technical'); // owner: 'dev' → technical
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/integration/recommendations-diagnostic.test.ts`
Expected: FAIL — no `source` starting with `diagnostic:` is produced.

- [ ] **Step 3: Add `listDiagnosticReports` import**

In `server/recommendations.ts`, add to the top-of-file imports:

```ts
import { listDiagnosticReports } from './diagnostic-store.js';
```

- [ ] **Step 4: Add diagnostic remediation section**

After the CTR gap section added by Task 3 (or after the content decay catch block if Task 3 hasn't run — anchor: the closing `}` of whichever section is last before the summary build), add:

```ts
  // ── 5. Diagnostic remediation recommendations ───────────────────────────────
  try {
    const reports = listDiagnosticReports(workspaceId);
    const completedReports = reports
      .filter(r => r.status === 'completed' && r.remediationActions?.length > 0)
      .slice(0, 3); // most recent 3

    const priorityMap: Record<string, RecPriority> = { P0: 'fix_now', P1: 'fix_now', P2: 'fix_soon', P3: 'fix_later' };
    const impactMap: Record<string, number> = { high: 75, medium: 55, low: 35 };

    for (const report of completedReports) {
      for (const action of report.remediationActions.slice(0, 5)) {
        const pageSlug = action.pageUrls?.[0]?.replace(/^\//, '') ?? '';
        const recType: RecType = action.owner === 'content' ? 'content' : 'technical';
        recs.push({
          id: `rec_${crypto.randomBytes(6).toString('hex')}`,
          workspaceId,
          priority: priorityMap[action.priority] ?? 'fix_soon',
          type: recType,
          title: `Diagnostic: ${action.title}`,
          description: action.description,
          insight: `Identified by deep diagnostic investigation (report ${report.id.slice(0, 8)}). ${action.description}`,
          impact: action.impact as 'high' | 'medium' | 'low',
          effort: action.effort as 'low' | 'medium' | 'high',
          impactScore: impactMap[action.impact] ?? 55,
          source: `diagnostic:${report.id}:${action.title.slice(0, 30)}`,
          affectedPages: action.pageUrls?.map(u => u.replace(/^\//, '')) ?? [],
          trafficAtRisk: 0,
          impressionsAtRisk: 0,
          estimatedGain: `Diagnostic-identified fix (${action.priority} priority, ${action.effort} effort)`,
          actionType: 'manual',
          status: 'pending',
          assignedTo,
          createdAt: now,
          updatedAt: now,
        });
      }
    }
  } catch (err) {
    log.warn({ err }, 'Diagnostic reports unavailable for recommendations');
  }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/integration/recommendations-diagnostic.test.ts`
Expected: PASS.

- [ ] **Step 6: Run existing recommendations tests**

Run: `npx vitest run tests/integration/recommendations*.test.ts tests/unit/recommendations*.test.ts 2>&1 | tail -20`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add server/recommendations.ts tests/integration/recommendations-diagnostic.test.ts
git commit -m "feat(recommendations): auto-create recs from completed diagnostic actions (Item 6)"
```

---

### Task 6 — Verification (Model: sonnet)

Run in the main session after all five sequential tasks have committed.

- [ ] **Step 1: Full typecheck**

Run: `npm run typecheck`
Expected: zero errors.

- [ ] **Step 2: Production build**

Run: `npx vite build`
Expected: build succeeds.

- [ ] **Step 3: Full test suite**

Run: `npx vitest run 2>&1 | tail -60`
Expected: all suites pass.

- [ ] **Step 4: pr-check**

Run: `npx tsx scripts/pr-check.ts`
Expected: zero violations.

- [ ] **Step 5: Per-item smoke check**

```
Item 2 → npx vitest run tests/unit/recommendations-conversion.test.ts --reporter=verbose
Item 4 → npx vitest run tests/unit/recommendations-authority-kd.test.ts --reporter=verbose
Item 1 → npx vitest run tests/integration/recommendations-ctr-gap.test.ts --reporter=verbose
Item 5 → npx vitest run tests/unit/recommendations-intent-mismatch.test.ts --reporter=verbose
Item 6 → npx vitest run tests/integration/recommendations-diagnostic.test.ts --reporter=verbose
```

All five must print PASS.

- [ ] **Step 6: Invoke code review**

Five tasks all modifying the same file = ~6 files total (recommendations.ts + 5 tests). Use `superpowers:requesting-code-review` (single-agent review is sufficient for same-file sequential work). Fix all Critical and Important findings before merging.

---

### Task 7 — Docs (Model: haiku)

- [ ] **Step 1: Update `FEATURE_AUDIT.md`**

Add entries for: conversion-weighted scoring, authority KD filtering, CTR gap recs, intent mismatch detection, diagnostic auto-creation.

- [ ] **Step 2: Update `data/roadmap.json`**

Mark the Tier 1 recommendation enhancements roadmap entry as `"status": "done"` with a notes field summarizing all five items. Run:

```bash
npx tsx scripts/sort-roadmap.ts
```

- [ ] **Step 3: Commit docs**

```bash
git add FEATURE_AUDIT.md data/roadmap.json
git commit -m "docs: mark Tier 1 recommendation intelligence items done"
```

---

## Systemic Improvements

### Exported helpers (testable units)

- `getTrafficScore(traffic, slug, conversionRate?)` — now exported; other modules that need a traffic proxy can import it
- `adjustKdImpactScore(base, difficulty, domainStrength)` — reusable for any future score that weights by domain authority
- `inferPageType(slug)` and `isIntentMismatch(pageType, intent)` — reusable for URL-based page classification across other intent-aware features

### Dedup: `getInsights` call consolidation

Tasks 1 and 3 both call `getInsights`. Since these are sequential tasks on the same file, the implementer of Task 3 should check if Task 1 already calls `getInsights('conversion_attribution')` and consolidate into a single call site if there's a natural place to batch them. If the calls are in separate sections (conversion map at top vs. CTR gap section at line ~739), leave them separate — both are wrapped in `try/catch` and are cheap reads.

### pr-check rules to add

None required. These changes don't introduce a new silent-failure class.

### Test coverage added

Five tests at ports 13333–13337. Two are full integration tests (`createTestContext`) — Items 1 and 6. Three are pure unit tests — Items 2, 4, 5.

---

## Verification Strategy

| Surface | Verification |
|---------|--------------|
| Type safety | `npm run typecheck` — zero errors |
| Build | `npx vite build` — green |
| Unit/integration | `npx vitest run` — full suite green |
| pr-check | `npx tsx scripts/pr-check.ts` — zero violations |
| Per-item | Five targeted tests, one per item |
| Code review | `superpowers:requesting-code-review` |

No UI changes → no preview screenshots, no BRAND_DESIGN_LANGUAGE update.

---

## Risks and Mitigations

- **`generateRecommendations` is already long.** Adding five more sections increases the function to ~900+ lines. If the code reviewer flags this as a structural concern, extract section-level helpers (`buildCtrGapRecs`, `buildDiagnosticRecs`, etc.) in a follow-up refactor — do not block this PR on it.
- **`getInsights` cold-read performance.** Each call reads from the insight store. Both calls (conversion map + CTR gap) are wrapped in `try/catch` and will no-op if the store is empty. No rate risk.
- **`getDomainOverview` credit cost (Item 4).** This is a live SEMRush call. It runs once per `generateRecommendations` invocation (not per rec). The existing SEMRush SQLite cache means repeated calls within the cache window cost zero credits. First call per domain per cache window costs one credit.
- **`listDiagnosticReports` returning empty.** If no completed reports exist, the loop body never runs. This is fine — the try/catch makes it safe regardless.
- **`listPageKeywords` double-read (Task 4).** If the variable from line 645 is in scope, reuse it. If not, a second DB read is acceptable (cheap, SQLite in-process).

---

## Done Criteria

All of the following must be true before opening the PR to `staging`:

- [ ] SEO Tier 3 data-sources plan fully merged to `staging` first
- [ ] 5 feature commits + 1 docs commit = 6 commits on the branch
- [ ] `npm run typecheck` — clean
- [ ] `npx vite build` — green
- [ ] `npx vitest run` — green
- [ ] `npx tsx scripts/pr-check.ts` — clean
- [ ] FEATURE_AUDIT.md + roadmap.json updated
- [ ] `superpowers:requesting-code-review` invoked; Critical/Important findings fixed in-PR
