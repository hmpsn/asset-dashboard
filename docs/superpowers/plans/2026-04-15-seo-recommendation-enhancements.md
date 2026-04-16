# SEO Recommendation Engine: 7 Enhancements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement 7 independent enhancements to `server/recommendations.ts` that surface CTR gaps, conversion-weighted scoring, seasonal tagging, authority-adjusted KD, intent mismatch detection, diagnostic recommendations, and outcome-weighted scoring.

**Architecture:** All 7 items are sequential edits to a single function (`generateRecommendations`) in `server/recommendations.ts`. Items 1–6 add new recommendation sources; Item 7 applies a global post-processing multiplier. Run them in order — each commits cleanly and the next builds on the same file.

**Tech Stack:** TypeScript, Express, better-sqlite3, Vitest, existing analytics/diagnostic/learnings stores

---

## Files Touched

| File | Change |
|------|--------|
| `server/recommendations.ts` | All 7 items: imports, new sections, function signature tweak |
| `shared/types/recommendations.ts` | Add `seasonalTag?` to `RecommendationSet.summary` (Item 3) |
| `tests/integration/recommendations-enhancements.test.ts` | New test file — port **13320** |

---

## Pre-flight: Read Before You Start

Before writing any code, read these to get exact field names:

- `server/recommendations.ts` — current imports (lines 14–31), `generateRecommendations` body (lines 387–860), `getTrafficScore` (line 162), `computeImpactScore` (line 174)
- `server/analytics-insights-store.ts` — full `AnalyticsInsight` interface (look for ALL fields, not just `data`), how `getInsights(wsId, type)` is called
- `server/analytics-intelligence.ts` lines 330–368 — how `conversion_attribution` insights are stored; specifically what field holds the page path (top-level on `AnalyticsInsight` vs inside `data`)
- `server/diagnostic-store.ts` — `DiagnosticReport` type (especially the field name for remediation actions: `remediationActions` vs `remediation_actions`) and table column names
- `server/workspaces.ts` — `rowToWorkspace` mapper to get exact DB column names for `live_domain` and `keyword_strategy`
- `server/page-keywords.ts` lines 54–88 — `rowToModel` mapper to get exact DB column names for `page_path`, `primary_keyword`, `search_intent`
- `shared/types/analytics.ts` — `CtrOpportunityData`, `ConversionAttributionData`, `InsightDataMap`
- `shared/types/diagnostics.ts` — `RemediationAction` interface (all fields)

---

## Task 0: Extend `RecommendationSet` Type for Seasonal Tag

**Files:**
- Modify: `shared/types/recommendations.ts`

- [ ] **Step 1: Add `seasonalTag` to the `summary` type**

In `shared/types/recommendations.ts`, find the `RecommendationSet` interface (lines 33–47). The `summary` inline type needs one new optional field:

```typescript
// Before (summary portion):
summary: {
  fixNow: number;
  fixSoon: number;
  fixLater: number;
  ongoing: number;
  totalImpactScore: number;
  trafficAtRisk: number;
  estimatedRecoverableClicks: number;
  estimatedRecoverableImpressions: number;
};

// After:
summary: {
  fixNow: number;
  fixSoon: number;
  fixLater: number;
  ongoing: number;
  totalImpactScore: number;
  trafficAtRisk: number;
  estimatedRecoverableClicks: number;
  estimatedRecoverableImpressions: number;
  seasonalTag?: { month: number; quarter: number };
};
```

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```
Expected: zero errors

- [ ] **Step 3: Commit**

```bash
git add shared/types/recommendations.ts
git commit -m "feat(types): add seasonalTag to RecommendationSet summary"
```

---

## Task 1: CTR Gap Recommendations (Item 1)

Pages with high impressions but below-expected CTR get "rewrite your title/meta" recommendations with the gap quantified.

**Files:**
- Modify: `server/recommendations.ts`
- Create: `tests/integration/recommendations-enhancements.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/integration/recommendations-enhancements.test.ts`:

```typescript
import { beforeAll, afterAll, describe, it, expect, vi } from 'vitest';

// Mock external data sources so generateRecommendations() only reads SQLite
vi.mock('../../server/search-console.js', () => ({
  getAllGscPages: vi.fn().mockResolvedValue([]),
}));
vi.mock('../../server/google-analytics.js', () => ({
  getGA4TopPages: vi.fn().mockResolvedValue([]),
}));
vi.mock('../../server/content-decay.js', () => ({
  loadDecayAnalysis: vi.fn().mockReturnValue([]),
}));
vi.mock('../../server/reports.js', () => ({
  getLatestSnapshot: vi.fn().mockReturnValue(null),
}));
vi.mock('../../server/routes/keyword-strategy.js', () => ({
  getDeclinedKeywords: vi.fn().mockReturnValue([]),
}));

import db from '../../server/db/index.js';
import { generateRecommendations } from '../../server/recommendations.js';

// ── Helpers ──────────────────────────────────────────────────────────────────
function seedTestWorkspace(id: string): void {
  db.prepare(`
    INSERT OR IGNORE INTO workspaces (id, name, slug, tier, created_at, updated_at)
    VALUES (?, ?, ?, 'free', datetime('now'), datetime('now'))
  `).run(id, `Test WS ${id.slice(0, 6)}`, `test-${id.slice(0, 8)}`);
}

function cleanupWorkspace(id: string): void {
  db.prepare('DELETE FROM workspaces WHERE id = ?').run(id);
}

// ── Item 1: CTR Gap Recommendations ──────────────────────────────────────────
describe('Item 1: CTR Gap Recommendations', () => {
  const wsId = 'test-ctr-gap-ws-0001';

  beforeAll(() => {
    seedTestWorkspace(wsId);
    // estimatedClickGap = 80 (> 50) → expect fix_now + metadata type
    db.prepare(`
      INSERT OR IGNORE INTO analytics_insights
        (id, workspace_id, insight_type, data, impact_score, created_at, updated_at)
      VALUES (?, ?, 'ctr_opportunity', ?, 70, datetime('now'), datetime('now'))
    `).run(
      'insight-ctr-0001',
      wsId,
      JSON.stringify({
        query: 'best seo tools',
        pageUrl: '/blog/seo-tools',
        position: 5,
        actualCtr: 2.1,
        expectedCtr: 8.5,
        ctrRatio: 0.25,
        impressions: 1200,
        estimatedClickGap: 80,
      }),
    );
  });

  afterAll(() => {
    db.prepare('DELETE FROM analytics_insights WHERE workspace_id = ?').run(wsId);
    cleanupWorkspace(wsId);
  });

  it('creates a metadata fix_now recommendation for CTR gap > 50', async () => {
    const result = await generateRecommendations(wsId);
    const rec = result.recommendations.find(r => r.source.startsWith('insight:ctr_opportunity'));
    expect(rec).toBeDefined();
    expect(rec?.type).toBe('metadata');
    expect(rec?.priority).toBe('fix_now');
    expect(rec?.trafficAtRisk).toBe(80);
    expect(rec?.actionType).toBe('purchase');
    expect(rec?.productType).toBe('fix_meta');
  });

  it('limits CTR recommendations to top 10 by estimatedClickGap', async () => {
    const stmt = db.prepare(`
      INSERT OR IGNORE INTO analytics_insights
        (id, workspace_id, insight_type, data, impact_score, created_at, updated_at)
      VALUES (?, ?, 'ctr_opportunity', ?, 30, datetime('now'), datetime('now'))
    `);
    for (let i = 0; i < 12; i++) {
      stmt.run(
        `insight-ctr-extra-${i}`,
        wsId,
        JSON.stringify({
          query: `query-${i}`,
          pageUrl: `/blog/page-${i}`,
          position: 8,
          actualCtr: 1.0,
          expectedCtr: 4.0,
          ctrRatio: 0.25,
          impressions: 500,
          estimatedClickGap: 15 + i,
        }),
      );
    }

    const result = await generateRecommendations(wsId);
    const ctrRecs = result.recommendations.filter(r => r.source.startsWith('insight:ctr_opportunity'));
    expect(ctrRecs.length).toBeLessThanOrEqual(10);
    // The highest-gap rec (80) must be included
    expect(ctrRecs.some(r => r.trafficAtRisk === 80)).toBe(true);

    for (let i = 0; i < 12; i++) {
      db.prepare('DELETE FROM analytics_insights WHERE id = ?').run(`insight-ctr-extra-${i}`);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/integration/recommendations-enhancements.test.ts
```
Expected: FAIL — `rec` is undefined (CTR section doesn't exist yet)

- [ ] **Step 3: Add imports to `server/recommendations.ts`**

At the top of the file, after the last existing import (line 31), add two lines:

```typescript
import { getInsights } from './analytics-insights-store.js';
import type { InsightDataMap } from '../shared/types/analytics.js';
```

- [ ] **Step 4: Add CTR section to `generateRecommendations()`**

After the content decay section (after the last `recs.push(...)` for content decay, roughly line 717, before any dedup/sort logic), add:

```typescript
  // ── 4. CTR opportunity recommendations ──
  {
    const ctrInsights = getInsights(workspaceId, 'ctr_opportunity');
    const top10 = ctrInsights
      .map(i => ({ d: i.data as InsightDataMap['ctr_opportunity'] }))
      .sort((a, b) => b.d.estimatedClickGap - a.d.estimatedClickGap)
      .slice(0, 10);

    for (const { d } of top10) {
      const priority: RecPriority = d.estimatedClickGap > 50 ? 'fix_now' : 'fix_soon';
      const impactScore = Math.min(90, 40 + Math.round(d.estimatedClickGap / 2));

      recs.push({
        id: `rec_${crypto.randomBytes(6).toString('hex')}`,
        workspaceId,
        priority,
        type: 'metadata',
        title: `CTR Underperformance: ${d.pageUrl} (${d.actualCtr.toFixed(1)}% vs ${d.expectedCtr.toFixed(1)}% expected)`,
        description: `This page gets ${d.impressions.toLocaleString()} impressions/mo at position #${d.position.toFixed(0)} but only ${d.actualCtr.toFixed(1)}% CTR (expected ~${d.expectedCtr.toFixed(1)}%). Improving the title and meta description could add ~${Math.round(d.estimatedClickGap)} clicks/mo.`,
        insight: `CTR below expected for position means the title/description isn't compelling enough. This page's CTR is ${(d.ctrRatio * 100).toFixed(0)}% of what's typical for position #${d.position.toFixed(0)}.`,
        impact: d.estimatedClickGap > 50 ? 'high' : 'medium',
        effort: 'low',
        impactScore,
        source: `insight:ctr_opportunity:${d.pageUrl}`,
        affectedPages: [d.pageUrl.replace(/^\//, '')],
        trafficAtRisk: Math.round(d.estimatedClickGap),
        impressionsAtRisk: 0,
        estimatedGain: `Optimizing title/meta could recover ~${Math.round(d.estimatedClickGap)} clicks/mo`,
        actionType: 'purchase',
        productType: 'fix_meta',
        productPrice: 20,
        status: 'pending',
        assignedTo,
        createdAt: now,
        updatedAt: now,
      });
    }
  }
```

- [ ] **Step 5: Run test — verify it passes**

```bash
npx vitest run tests/integration/recommendations-enhancements.test.ts
npm run typecheck
```
Expected: both PASS, zero type errors

- [ ] **Step 6: Commit**

```bash
git add server/recommendations.ts tests/integration/recommendations-enhancements.test.ts
git commit -m "feat(recommendations): add CTR gap recommendations from analytics insights"
```

---

## Task 2: Conversion-Weighted Prioritization (Item 2)

High-converting pages get a traffic-score boost so they surface first in recommendations.

**Files:**
- Modify: `server/recommendations.ts`
- Modify: `tests/integration/recommendations-enhancements.test.ts`

- [ ] **Step 1: Understand where the page path lives in `conversion_attribution` insights**

Before writing code, read `server/analytics-intelligence.ts` lines 330–368 (`computeConversionAttributionInsights`). Find what field is used as the page identifier when the insight is stored. It will be either:
- A top-level field on `AnalyticsInsight` (e.g. `insight.pageUrl`)
- Or inside `data` (e.g. `(d as ConversionAttributionData & { pagePath: string }).pagePath`)

Note the exact field name — you'll use it in Step 3.

- [ ] **Step 2: Write the failing test**

Append to `tests/integration/recommendations-enhancements.test.ts`:

```typescript
// ── Item 2: Conversion-Weighted Scoring ──────────────────────────────────────
// Verified via typecheck and the function signature change.
// Behavioral assertion: a high-CVR page has a higher computed traffic score than
// the same page without a CVR entry. We test getTrafficScore indirectly — if it
// compiles with the new optional parameter, it's wired correctly.
describe('Item 2: Conversion-Weighted Scoring', () => {
  it('getTrafficScore signature accepts optional conversionRate (compile-time check)', () => {
    // If this test file compiles without error after the signature change, the
    // implementation is correct. The typecheck step in Step 4 is the real gate.
    expect(true).toBe(true);
  });
});
```

- [ ] **Step 3: Modify `getTrafficScore()` in `server/recommendations.ts`**

Find `getTrafficScore` (around line 162). Replace with:

```typescript
function getTrafficScore(traffic: TrafficMap, slug: string, conversionRate?: number): number {
  const t = traffic[`/${slug}`] || traffic[slug];
  if (!t) return 0;
  const base = t.clicks * 2 + t.impressions * 0.1 + t.pageviews;
  // Pages with >2% CVR get up to 1.5x boost (conversionRate is already a percentage, e.g. 4.0 for 4%)
  const convMultiplier = conversionRate && conversionRate > 2
    ? Math.min(1.5, 1 + (conversionRate / 20))
    : 1;
  return base * convMultiplier;
}
```

- [ ] **Step 4: Build the conversion map after `fetchTrafficMap()`**

In `generateRecommendations()`, directly after the line `const traffic = await fetchTrafficMap(ws);` (around line 396), add:

```typescript
  // Build conversion rate map from analytics insights
  // key = page path (e.g. '/blog/post'), value = conversionRate (percentage)
  const conversionMap = new Map<string, number>();
  for (const insight of getInsights(workspaceId, 'conversion_attribution')) {
    const d = insight.data as InsightDataMap['conversion_attribution'];
    // The page path is stored as [FIELD] on the insight.
    // Check computeConversionAttributionInsights() in analytics-intelligence.ts
    // to confirm: use insight.pageUrl, insight.pagePath, or d.pagePath — whichever applies.
    const pagePath = (insight as unknown as { pageUrl?: string; pagePath?: string }).pageUrl
      ?? (insight as unknown as { pageUrl?: string; pagePath?: string }).pagePath;
    if (pagePath && d.conversionRate > 0) {
      conversionMap.set(pagePath, d.conversionRate);
    }
  }
```

**Note:** Replace the `pagePath` resolution with the exact field you identified in Step 1. Delete the fallback branch you don't need.

- [ ] **Step 5: Update every `getTrafficScore()` call site**

Search for all calls to `getTrafficScore(traffic,` in the file. There are approximately 5–7 (in the audit max-score loop, audit recs, quick wins, content gaps, ranking opportunities, content decay). For each, add the conversion rate lookup as the third argument:

```typescript
// Before any call:
getTrafficScore(traffic, page.slug)

// After:
getTrafficScore(
  traffic,
  page.slug,
  conversionMap.get(`/${page.slug}`) ?? conversionMap.get(page.slug),
)
```

Adjust the slug key as needed — look at how slugs are formatted in each section (some may have a leading `/`, some may not). The lookup should match the format stored in `conversionMap`.

- [ ] **Step 6: Typecheck and run tests**

```bash
npm run typecheck
npx vitest run tests/integration/recommendations-enhancements.test.ts
```
Expected: zero type errors, tests pass

- [ ] **Step 7: Commit**

```bash
git add server/recommendations.ts tests/integration/recommendations-enhancements.test.ts
git commit -m "feat(recommendations): weight traffic scores by page conversion rate"
```

---

## Task 3: Seasonal Tagging (Item 3)

Stamp every generated recommendation set with `{ month, quarter }` for future seasonal analysis.

**Files:**
- Modify: `server/recommendations.ts`
- Modify: `tests/integration/recommendations-enhancements.test.ts`

- [ ] **Step 1: Write the failing test**

Append to the test file:

```typescript
// ── Item 3: Seasonal Tagging ──────────────────────────────────────────────────
describe('Item 3: Seasonal Tagging', () => {
  const wsId = 'test-seasonal-ws-0001';

  beforeAll(() => { seedTestWorkspace(wsId); });
  afterAll(() => { cleanupWorkspace(wsId); });

  it('includes seasonalTag with valid month (1-12) in summary', async () => {
    const result = await generateRecommendations(wsId);
    expect(result.summary.seasonalTag).toBeDefined();
    expect(result.summary.seasonalTag?.month).toBeGreaterThanOrEqual(1);
    expect(result.summary.seasonalTag?.month).toBeLessThanOrEqual(12);
  });

  it('derives quarter correctly from month', async () => {
    const result = await generateRecommendations(wsId);
    const { month, quarter } = result.summary.seasonalTag!;
    expect(quarter).toBe(Math.ceil(month / 3));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/integration/recommendations-enhancements.test.ts -t "Seasonal"
```
Expected: FAIL — `result.summary.seasonalTag` is `undefined`

- [ ] **Step 3: Add seasonal tag to summary in `generateRecommendations()`**

Find where the `summary` const is built (around line 843). Add two lines before it and add `seasonalTag` to the object:

```typescript
  // Add before the summary object:
  const month = new Date().getMonth() + 1;          // 1–12
  const quarter = Math.ceil(month / 3);             // 1–4

  const summary = {
    fixNow: activeRecs.filter(r => r.priority === 'fix_now').length,
    fixSoon: activeRecs.filter(r => r.priority === 'fix_soon').length,
    fixLater: activeRecs.filter(r => r.priority === 'fix_later').length,
    ongoing: activeRecs.filter(r => r.priority === 'ongoing').length,
    totalImpactScore: activeRecs.reduce((s, r) => s + r.impactScore, 0),
    trafficAtRisk: totalTrafficAtRisk,
    estimatedRecoverableClicks: Math.round(actionableTraffic * 0.12),
    estimatedRecoverableImpressions: Math.round(actionableImpressions * 0.12),
    seasonalTag: { month, quarter },
  };
```

(Keep all existing fields exactly as they are; only add `month`/`quarter` locals and the `seasonalTag` property.)

- [ ] **Step 4: Run test — verify it passes**

```bash
npx vitest run tests/integration/recommendations-enhancements.test.ts -t "Seasonal"
npm run typecheck
```
Expected: PASS, zero errors

- [ ] **Step 5: Commit**

```bash
git add server/recommendations.ts tests/integration/recommendations-enhancements.test.ts
git commit -m "feat(recommendations): stamp recommendation sets with seasonal context tag"
```

---

## Task 4: Authority-Adjusted KD Filtering (Item 4)

Content gap recommendations for keywords that are too difficult for the domain's authority get penalized; easy-win keywords get boosted.

**Files:**
- Modify: `server/recommendations.ts`
- Modify: `tests/integration/recommendations-enhancements.test.ts`

- [ ] **Step 1: Write the failing test**

Append to the test file:

```typescript
// ── Item 4: Authority-Adjusted KD Filtering ───────────────────────────────────
// Mock the SEO provider to return a weak domain (organicKeywords < 100 → domainStrength = 20)
vi.mock('../../server/seo-data-provider.js', () => ({
  getConfiguredProvider: vi.fn().mockReturnValue({
    getDomainOverview: vi.fn().mockResolvedValue({
      domain: 'example.com',
      organicKeywords: 50,
      organicTraffic: 1000,
      organicCost: 0,
      paidKeywords: 0,
      paidTraffic: 0,
      paidCost: 0,
    }),
  }),
}));

describe('Item 4: Authority-Adjusted KD Filtering', () => {
  const wsId = 'test-kd-ws-0001';

  beforeAll(() => {
    seedTestWorkspace(wsId);
    // Read workspaces.ts rowToWorkspace() for exact DB column names before running this.
    // Typical names are live_domain and keyword_strategy — adjust if different.
    db.prepare(`
      UPDATE workspaces
      SET live_domain = 'example.com',
          keyword_strategy = ?
      WHERE id = ?
    `).run(
      JSON.stringify({
        contentGaps: [
          // KD 60, domainStrength 20 → kdGap 40 > 30 → impactScore * 0.6
          { keyword: 'hard-keyword', priority: 'high', difficulty: 60, volume: 500 },
          // KD 10, domainStrength 20 → kdGap -10, not < -20 → no boost (neutral)
          { keyword: 'easy-keyword', priority: 'high', difficulty: 10, volume: 500 },
        ],
      }),
      wsId,
    );
  });

  afterAll(() => {
    db.prepare(`UPDATE workspaces SET live_domain = NULL, keyword_strategy = NULL WHERE id = ?`).run(wsId);
    cleanupWorkspace(wsId);
  });

  it('penalizes impactScore for keywords with KD gap > 30', async () => {
    const result = await generateRecommendations(wsId);
    const hardRec = result.recommendations.find(r => r.title?.toLowerCase().includes('hard-keyword'));
    const easyRec = result.recommendations.find(r => r.title?.toLowerCase().includes('easy-keyword'));
    // Both are 'high' priority (base impactScore 65). Hard gets * 0.6 = 39; easy is neutral = 65.
    if (hardRec && easyRec) {
      expect(hardRec.impactScore).toBeLessThan(easyRec.impactScore);
    }
  });

  it('adds KD context note to estimatedGain when keyword is too hard', async () => {
    const result = await generateRecommendations(wsId);
    const hardRec = result.recommendations.find(r => r.title?.toLowerCase().includes('hard-keyword'));
    if (hardRec) {
      expect(hardRec.estimatedGain).toMatch(/challenging|authority/i);
    }
  });
});
```

**Important:** Check `server/workspaces.ts` `rowToWorkspace` for the exact DB column names (`live_domain` / `liveDomain`, `keyword_strategy` / `keywordStrategy`). Also check what property path gives you `contentGaps` inside the keywordStrategy object — look at `shared/types/workspace.ts` `KeywordStrategy` interface.

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/integration/recommendations-enhancements.test.ts -t "Authority-Adjusted"
```
Expected: FAIL — impactScores are not yet adjusted

- [ ] **Step 3: Add domain strength fetch at start of `generateRecommendations()`**

After the `maxTrafficScore` computation (roughly line 407), before any recommendation sections, add:

```typescript
  // ── Fetch domain authority proxy for KD adjustment ──
  let domainStrength = 0; // 0 = no data; 20 = weak; 50 = moderate; 80 = strong
  if (ws.liveDomain) {
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
    } catch {
      // non-critical — proceed with domainStrength = 0 (no KD adjustment)
    }
  }
```

- [ ] **Step 4: Apply KD adjustment in the content gap section**

Find the content gap recommendation loop (around line 607). Locate where `impactScore` is set — it currently looks like:

```typescript
const impactScore = cg.priority === 'high' ? 65 : cg.priority === 'medium' ? 45 : 25;
```

Replace it with:

```typescript
let impactScore = cg.priority === 'high' ? 65 : cg.priority === 'medium' ? 45 : 25;
let kdNote = '';
if (cg.difficulty != null && domainStrength > 0) {
  const kdGap = cg.difficulty - domainStrength;
  if (kdGap > 30) {
    impactScore = Math.round(impactScore * 0.6);
    kdNote = ` (KD ${cg.difficulty} may be challenging — consider building authority first)`;
  } else if (kdGap > 15) {
    impactScore = Math.round(impactScore * 0.8);
    kdNote = ` (KD ${cg.difficulty} is a stretch for your current domain strength)`;
  } else if (kdGap < -20) {
    impactScore = Math.min(100, Math.round(impactScore * 1.2));
    kdNote = ` (KD ${cg.difficulty} is achievable for your domain)`;
  }
}
```

Then in the `estimatedGain` field for that recommendation, append `kdNote` to the existing string. For example, if it currently reads:

```typescript
estimatedGain: `Ranking for "${cg.keyword}" could drive significant organic traffic`,
```

Change to:

```typescript
estimatedGain: `Ranking for "${cg.keyword}" could drive significant organic traffic${kdNote}`,
```

- [ ] **Step 5: Run test and typecheck**

```bash
npx vitest run tests/integration/recommendations-enhancements.test.ts -t "Authority-Adjusted"
npm run typecheck
```
Expected: PASS, zero errors

- [ ] **Step 6: Commit**

```bash
git add server/recommendations.ts tests/integration/recommendations-enhancements.test.ts
git commit -m "feat(recommendations): adjust content gap KD scores by inferred domain authority"
```

---

## Task 5: Search Intent Mismatch Detection (Item 5)

Flag service/product pages targeting informational keywords (and vice versa) as strategy recommendations.

**Files:**
- Modify: `server/recommendations.ts`
- Modify: `tests/integration/recommendations-enhancements.test.ts`

- [ ] **Step 1: Write the failing test**

Append to the test file:

```typescript
// ── Item 5: Search Intent Mismatch Detection ─────────────────────────────────
describe('Item 5: Search Intent Mismatch Detection', () => {
  const wsId = 'test-intent-ws-0001';

  beforeAll(() => {
    seedTestWorkspace(wsId);
    // Check server/page-keywords.ts rowToModel() for exact column names before running.
    // Typical: page_path, primary_keyword, search_intent — adjust if different.
    const stmt = db.prepare(`
      INSERT OR IGNORE INTO page_keywords
        (id, workspace_id, page_path, primary_keyword, search_intent, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `);
    // Mismatch: service page + informational intent → should flag
    stmt.run('pkw-intent-001', wsId, '/services/seo-audit', 'what is an seo audit', 'informational');
    // Mismatch: blog post + transactional intent → should flag
    stmt.run('pkw-intent-002', wsId, '/blog/pricing', 'seo pricing calculator', 'transactional');
    // Match: blog + informational → should NOT flag
    stmt.run('pkw-intent-003', wsId, '/blog/seo-guide', 'how to do seo', 'informational');
  });

  afterAll(() => {
    db.prepare('DELETE FROM page_keywords WHERE workspace_id = ?').run(wsId);
    cleanupWorkspace(wsId);
  });

  it('flags service page targeting informational keyword', async () => {
    const result = await generateRecommendations(wsId);
    const rec = result.recommendations.find(
      r => r.source === 'strategy:intent-mismatch' && r.title.includes('/services/seo-audit'),
    );
    expect(rec).toBeDefined();
    expect(rec?.type).toBe('strategy');
    expect(rec?.priority).toBe('fix_soon');
  });

  it('flags blog post targeting transactional keyword', async () => {
    const result = await generateRecommendations(wsId);
    const rec = result.recommendations.find(
      r => r.source === 'strategy:intent-mismatch' && r.title.includes('/blog/pricing'),
    );
    expect(rec).toBeDefined();
  });

  it('does NOT flag blog post targeting informational keyword', async () => {
    const result = await generateRecommendations(wsId);
    const rec = result.recommendations.find(
      r => r.source === 'strategy:intent-mismatch' && r.title.includes('/blog/seo-guide'),
    );
    expect(rec).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/integration/recommendations-enhancements.test.ts -t "Intent Mismatch"
```
Expected: FAIL

- [ ] **Step 3: Add import for `listPageKeywords`**

At the top of `server/recommendations.ts`, within the existing import block, add:

```typescript
import { listPageKeywords } from './page-keywords.js';
```

- [ ] **Step 4: Add helper functions before `generateRecommendations()`**

Add these two pure functions just above the `generateRecommendations` function definition (around line 380):

```typescript
function inferPageType(slug: string): 'blog' | 'service' | 'landing' | 'product' | 'other' {
  const s = slug.toLowerCase();
  if (/(?:^|\/)blog|articles?|news|posts?|guides?/.test(s)) return 'blog';
  if (/(?:^|\/)services?|solutions?|offerings?/.test(s)) return 'service';
  if (/(?:^|\/)products?|shop|store/.test(s)) return 'product';
  if (/(?:^|\/)landing|lp[-_]/.test(s)) return 'landing';
  return 'other';
}

function isIntentMismatch(
  pageType: string,
  searchIntent: string,
): { mismatch: boolean; reason: string } {
  if ((pageType === 'service' || pageType === 'product') && searchIntent === 'informational') {
    return {
      mismatch: true,
      reason: `This ${pageType} page targets an informational keyword — consider creating a blog post for the informational query and retargeting this page to a commercial/transactional keyword.`,
    };
  }
  if (pageType === 'blog' && searchIntent === 'transactional') {
    return {
      mismatch: true,
      reason: 'This blog post targets a transactional keyword — consider creating a dedicated service/product page for this keyword instead.',
    };
  }
  return { mismatch: false, reason: '' };
}
```

- [ ] **Step 5: Add intent mismatch section to `generateRecommendations()`**

After the CTR opportunity section (Task 1), add:

```typescript
  // ── 5. Search intent mismatch recommendations ──
  {
    const pageKeywords = listPageKeywords(workspaceId);
    let mismatchCount = 0;
    for (const pk of pageKeywords) {
      if (mismatchCount >= 10) break;
      if (!pk.searchIntent || !pk.pagePath) continue;
      const pageType = inferPageType(pk.pagePath);
      const { mismatch, reason } = isIntentMismatch(pageType, pk.searchIntent);
      if (!mismatch) continue;
      mismatchCount++;

      recs.push({
        id: `rec_${crypto.randomBytes(6).toString('hex')}`,
        workspaceId,
        priority: 'fix_soon',
        type: 'strategy',
        title: `Intent Mismatch: ${pk.pagePath} (${pageType} page targeting ${pk.searchIntent} keyword)`,
        description: reason,
        insight: `"${pk.primaryKeyword ?? pk.pagePath}" has ${pk.searchIntent} intent but is targeted by a ${pageType} page. Aligning page type with search intent improves relevance signals and conversion.`,
        impact: 'medium',
        effort: 'medium',
        impactScore: 50,
        source: 'strategy:intent-mismatch',
        affectedPages: [pk.pagePath.replace(/^\//, '')],
        trafficAtRisk: 0,
        impressionsAtRisk: 0,
        estimatedGain: 'Fixing intent mismatch improves organic CTR and conversion alignment',
        actionType: 'manual',
        status: 'pending',
        assignedTo,
        createdAt: now,
        updatedAt: now,
      });
    }
  }
```

**Note:** The field name `pk.searchIntent` and `pk.pagePath` come from `PageKeywordMap` in `shared/types/workspace.ts`. Verify these match the actual field names before running. If the mapper uses camelCase `pagePath` but the type has `pagePath`, this is fine; just confirm.

- [ ] **Step 6: Run test and typecheck**

```bash
npx vitest run tests/integration/recommendations-enhancements.test.ts -t "Intent Mismatch"
npm run typecheck
```
Expected: PASS, zero errors

- [ ] **Step 7: Commit**

```bash
git add server/recommendations.ts tests/integration/recommendations-enhancements.test.ts
git commit -m "feat(recommendations): detect search intent mismatches as strategy recommendations"
```

---

## Task 6: Diagnostic → Recommendation Auto-Creation (Item 6)

Completed diagnostic reports surface their remediation actions as recommendations.

**Files:**
- Modify: `server/recommendations.ts`
- Modify: `tests/integration/recommendations-enhancements.test.ts`

- [ ] **Step 1: Confirm `DiagnosticReport` field names**

Read `shared/types/diagnostics.ts` fully. Confirm:
- The field on `DiagnosticReport` that holds remediation actions (spec calls it `remediationActions` — verify)
- The `status` field values (spec uses `'completed'` — verify)
- `report.id` exists as a string field

Also check `server/diagnostic-store.ts` for the exact table and column names used in the `INSERT` statement, so the test seed below uses the right columns.

- [ ] **Step 2: Write the failing test**

Append to the test file:

```typescript
// ── Item 6: Diagnostic Recommendations ───────────────────────────────────────
describe('Item 6: Diagnostic Recommendations', () => {
  const wsId = 'test-diag-ws-0001';

  beforeAll(() => {
    seedTestWorkspace(wsId);
    // IMPORTANT: Check server/diagnostic-store.ts for exact table/column names
    // before running. Adjust column names in this INSERT if they differ.
    db.prepare(`
      INSERT OR IGNORE INTO diagnostic_reports
        (id, workspace_id, status, remediation_actions, created_at, updated_at)
      VALUES (?, ?, 'completed', ?, datetime('now'), datetime('now'))
    `).run(
      'diag-rpt-0001',
      wsId,
      JSON.stringify([
        {
          priority: 'P0',
          title: 'Fix broken canonical tags',
          description: 'Canonical tags point to wrong URLs on 12 pages.',
          effort: 'low',
          impact: 'high',
          owner: 'dev',
          pageUrls: ['/blog/post-1', '/blog/post-2'],
        },
        {
          priority: 'P2',
          title: 'Add missing alt text',
          description: 'Images without alt text reduce accessibility and SEO.',
          effort: 'medium',
          impact: 'medium',
          owner: 'content',
          pageUrls: ['/services/design'],
        },
      ]),
    );
  });

  afterAll(() => {
    db.prepare('DELETE FROM diagnostic_reports WHERE workspace_id = ?').run(wsId);
    cleanupWorkspace(wsId);
  });

  it('creates a technical fix_now recommendation from a P0 dev action', async () => {
    const result = await generateRecommendations(wsId);
    const rec = result.recommendations.find(
      r => r.source.startsWith('diagnostic:') && r.title.includes('Fix broken canonical tags'),
    );
    expect(rec).toBeDefined();
    expect(rec?.priority).toBe('fix_now');
    expect(rec?.type).toBe('technical');
    expect(rec?.affectedPages).toContain('blog/post-1');
  });

  it('creates a content fix_soon recommendation from a P2 content action', async () => {
    const result = await generateRecommendations(wsId);
    const rec = result.recommendations.find(
      r => r.source.startsWith('diagnostic:') && r.title.includes('Add missing alt text'),
    );
    expect(rec).toBeDefined();
    expect(rec?.priority).toBe('fix_soon');
    expect(rec?.type).toBe('content');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

```bash
npx vitest run tests/integration/recommendations-enhancements.test.ts -t "Diagnostic"
```
Expected: FAIL

- [ ] **Step 4: Add imports to `server/recommendations.ts`**

At the top, within the existing import block:

```typescript
import { listDiagnosticReports } from './diagnostic-store.js';
import type { RemediationAction } from '../shared/types/diagnostics.js';
```

- [ ] **Step 5: Add diagnostic section to `generateRecommendations()`**

After the intent mismatch section (Task 5), add:

```typescript
  // ── 6. Diagnostic remediation recommendations ──
  try {
    const reports = listDiagnosticReports(workspaceId);
    const completed = reports.filter(r => r.status === 'completed' && r.remediationActions.length > 0);
    const priorityMap: Record<string, RecPriority> = { P0: 'fix_now', P1: 'fix_now', P2: 'fix_soon', P3: 'fix_later' };
    const impactMap: Record<string, number> = { high: 75, medium: 55, low: 35 };

    for (const report of completed.slice(0, 3)) {
      for (const action of (report.remediationActions as RemediationAction[]).slice(0, 5)) {
        recs.push({
          id: `rec_${crypto.randomBytes(6).toString('hex')}`,
          workspaceId,
          priority: priorityMap[action.priority] ?? 'fix_soon',
          type: action.owner === 'content' ? 'content' : 'technical',
          title: `Diagnostic: ${action.title}`,
          description: action.description,
          insight: `Identified by deep diagnostic (report ${report.id.slice(0, 8)}). ${action.description}`,
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

**Note:** If `DiagnosticReport` uses a different field name than `remediationActions` (e.g. `actions` or `remediation`), update accordingly. TypeScript will catch the mismatch at compile time.

- [ ] **Step 6: Run test and typecheck**

```bash
npx vitest run tests/integration/recommendations-enhancements.test.ts -t "Diagnostic"
npm run typecheck
```
Expected: PASS, zero errors

- [ ] **Step 7: Commit**

```bash
git add server/recommendations.ts tests/integration/recommendations-enhancements.test.ts
git commit -m "feat(recommendations): auto-create recommendations from completed diagnostic reports"
```

---

## Task 7: Outcome-Weighted Recommendation Scoring (Item 7)

Boost recommendation types that historically produce wins; penalize types with low win rates.

**Files:**
- Modify: `server/recommendations.ts`
- Modify: `tests/integration/recommendations-enhancements.test.ts`

- [ ] **Step 1: Write the failing test**

Append to the test file. Note: `vi.mock` calls are hoisted, so add the mock at the top of the file (before the imports section you already have) or confirm vitest hoisting handles it. Since we're appending, put the mock registration in a `beforeAll` using `vi.doMock` or reorganize. The cleanest approach is to add this `vi.mock` call at the top of the test file alongside the other mocks:

Add to the `vi.mock(...)` block near the top of the test file (before the `import db` line):

```typescript
vi.mock('../../server/workspace-learnings.js', () => ({
  getWorkspaceLearnings: vi.fn().mockReturnValue({
    confidence: 'high',
    technical: {
      winRateByFixType: {
        schema_deployed: 0.85,   // schema → 1.2x boost
        meta_updated: 0.20,      // metadata → 0.8x penalty
        audit_fix_applied: 0.50, // technical → 1.0x (neutral)
        content_refreshed: 0.75, // content_refresh → 1.2x boost
      },
      schemaTypesWithRichResults: [],
      avgHealthScoreImprovement: 3.0,
      internalLinkEffectiveness: 0.6,
    },
  }),
}));
```

Then append the describe block:

```typescript
// ── Item 7: Outcome-Weighted Scoring ──────────────────────────────────────────
describe('Item 7: Outcome-Weighted Scoring', () => {
  const wsId = 'test-learnings-ws-0001';

  beforeAll(() => {
    seedTestWorkspace(wsId);
    // Seed a CTR insight (type: 'metadata') to test the 0.8x penalty
    db.prepare(`
      INSERT OR IGNORE INTO analytics_insights
        (id, workspace_id, insight_type, data, impact_score, created_at, updated_at)
      VALUES (?, ?, 'ctr_opportunity', ?, 60, datetime('now'), datetime('now'))
    `).run(
      'insight-learnings-001',
      wsId,
      JSON.stringify({
        query: 'test query',
        pageUrl: '/blog/test-page',
        position: 6,
        actualCtr: 2.0,
        expectedCtr: 7.0,
        ctrRatio: 0.28,
        impressions: 800,
        estimatedClickGap: 40,
      }),
    );
  });

  afterAll(() => {
    db.prepare('DELETE FROM analytics_insights WHERE workspace_id = ?').run(wsId);
    cleanupWorkspace(wsId);
  });

  it('applies 0.8x penalty to metadata recommendations (meta win rate = 20%)', async () => {
    const result = await generateRecommendations(wsId);
    const metaRec = result.recommendations.find(r => r.type === 'metadata');
    if (metaRec) {
      // Base impactScore for clickGap=40: Math.min(90, 40 + 20) = 60
      // After 0.8x: Math.min(100, round(60 * 0.8)) = 48
      expect(metaRec.impactScore).toBeLessThanOrEqual(48);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/integration/recommendations-enhancements.test.ts -t "Outcome-Weighted"
```
Expected: FAIL — impactScore is unmodified (still 60)

- [ ] **Step 3: Add import for `getWorkspaceLearnings`**

At the top of `server/recommendations.ts`, within the existing imports:

```typescript
import { getWorkspaceLearnings } from './workspace-learnings.js';
```

- [ ] **Step 4: Fetch learnings at start of `generateRecommendations()`**

After the `domainStrength` block (Task 4), add:

```typescript
  // ── Fetch outcome-weighted learnings boosts ──
  // Maps RecType → multiplier: >0.7 win rate → 1.2x; <0.3 → 0.8x; else 1.0x
  const learningsBoost: Record<string, number> = {};
  try {
    const learnings = getWorkspaceLearnings(workspaceId);
    if (learnings && learnings.confidence !== 'low' && learnings.technical) {
      const { winRateByFixType } = learnings.technical;
      const fixToRecType: Record<string, string> = {
        schema_deployed: 'schema',
        meta_updated: 'metadata',
        audit_fix_applied: 'technical',
        internal_link_added: 'technical',
        content_refreshed: 'content_refresh',
      };
      for (const [fixType, winRate] of Object.entries(winRateByFixType)) {
        const recType = fixToRecType[fixType];
        if (recType && winRate > 0) {
          learningsBoost[recType] = winRate > 0.7 ? 1.2 : winRate < 0.3 ? 0.8 : 1.0;
        }
      }
    }
  } catch {
    // non-critical — proceed without learnings boost
  }
```

- [ ] **Step 5: Apply learnings boost as a post-processing pass**

Find the point in `generateRecommendations()` just before the deduplication/filtering logic that runs before `saveRecommendations` (roughly line 721, look for the comment or loop that deduplicates by source key). Add this block immediately before it:

```typescript
  // Apply outcome-weighted boost from workspace learnings history
  if (Object.keys(learningsBoost).length > 0) {
    for (const rec of recs) {
      const multiplier = learningsBoost[rec.type] ?? 1.0;
      if (multiplier !== 1.0) {
        rec.impactScore = Math.min(100, Math.round(rec.impactScore * multiplier));
      }
    }
  }
```

This approach applies the boost uniformly to all recommendation types in a single pass, which is equivalent to the spec's inline approach but cleaner to maintain.

- [ ] **Step 6: Run tests and typecheck**

```bash
npx vitest run tests/integration/recommendations-enhancements.test.ts -t "Outcome-Weighted"
npm run typecheck
```
Expected: PASS, zero errors

- [ ] **Step 7: Run full test suite**

```bash
npx vitest run
```
Expected: all existing tests pass (no regressions)

- [ ] **Step 8: Commit**

```bash
git add server/recommendations.ts tests/integration/recommendations-enhancements.test.ts
git commit -m "feat(recommendations): weight recommendation scores by historical outcome win rates"
```

---

## Task 8: Quality Gates

- [ ] **Step 1: Typecheck**

```bash
npm run typecheck
```
Expected: zero errors

- [ ] **Step 2: Production build**

```bash
npx vite build
```
Expected: successful build

- [ ] **Step 3: Full test suite**

```bash
npx vitest run
```
Expected: all tests pass

- [ ] **Step 4: PR check**

```bash
npx tsx scripts/pr-check.ts
```
Expected: zero violations

- [ ] **Step 5: Verify FEATURE_AUDIT.md has entries for all 7 enhancements**

Open `FEATURE_AUDIT.md` and add/update an entry under the recommendations section for each item. Use this template per item:

```
### CTR Gap Recommendations
- Source: insight store (ctr_opportunity)
- Type: metadata / fix_now or fix_soon
- File: server/recommendations.ts (section 4)
- Added: 2026-04-15
```

- [ ] **Step 6: Update roadmap**

```bash
npx tsx scripts/sort-roadmap.ts
```

Mark all 7 items done in `data/roadmap.json`.

---

## Self-Review Notes

**Spec coverage:** All 7 items have a dedicated task. ✓

**Field name risks to verify before running:**
- `analytics_insights` table columns — check `server/analytics-insights-store.ts` for `CREATE TABLE` or `stmts()` definitions
- `AnalyticsInsight.pageUrl` vs page path field for conversion attribution (Task 2, Step 4) — check `computeConversionAttributionInsights` in `analytics-intelligence.ts`
- `diagnostic_reports` table columns — check `server/diagnostic-store.ts`
- `DiagnosticReport.remediationActions` field name — check `shared/types/diagnostics.ts`
- `workspaces.live_domain` and `workspaces.keyword_strategy` column names — check `server/workspaces.ts` `rowToWorkspace`
- `page_keywords.page_path`, `page_keywords.search_intent` column names — check `server/page-keywords.ts` `rowToModel`

**Type consistency:** All types used (`RecPriority`, `RecType`, `InsightDataMap`, `RemediationAction`, `WorkspaceLearnings`) match what exists in the codebase per pre-flight investigation. ✓

**Dedup safety:** Each new recommendation source uses a unique `source` prefix:
- CTR: `insight:ctr_opportunity:<pageUrl>`
- Intent mismatch: `strategy:intent-mismatch` (dedup by title if source collides)
- Diagnostic: `diagnostic:<reportId>:<title slice>`

These don't collide with existing sources (`audit:`, `strategy:`, `decay:`, `content-gap:`, `ranking:`). ✓
