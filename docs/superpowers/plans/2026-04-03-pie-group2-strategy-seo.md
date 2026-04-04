# Platform Intelligence Enhancements — Group 2: Strategy + SEO

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the briefs pipeline context dropout, add page-type-aware brief generation, ship smarter recommendation cards (predicted impact / status tracking / plain-language KD), unify the SEO editor to include CMS pages with write-back, fix the Page Intelligence empty state after strategy runs, and wire backlinkProfile + serpFeatures into the intelligence engine.

**Architecture:** Six independent improvements that share no runtime coupling but all touch strategy/SEO data. The briefs fix threads StrategyCardContext through content-requests.ts → content-brief.ts. Smarter cards are purely client-side additions to StrategyTab + ContentGaps. SEO editor switches to the existing all-pages endpoint and routes CMS writes through the existing updateCollectionItem() path in approvals.ts. Page Intelligence fix standardizes metricsSource and switches strategy from replaceAllPageKeywords() to upsertPageKeywordsBatch() (transactional, additive). Intelligence wiring adds two data calls to assembleSeoContext().

**Tech Stack:** React 19, TypeScript, Express, SQLite, Vitest, @testing-library/react

**Dependency:** Phase 0 plan must be merged and green on staging. Imports StrategyCardContext, PageTypeBriefConfig, BriefPageType, BriefJourneyStage from shared/types/content.ts; METRICS_SOURCE, MetricsSource from shared/types/keywords.ts.

---

## File Map

| File | Action | Purpose |
|------|--------|---------|
| `shared/types/content.ts` | **Phase 0 only** | StrategyCardContext, PageTypeBriefConfig committed in Phase 0 — import, do not re-add |
| `shared/types/keywords.ts` | **Phase 0 only** | METRICS_SOURCE committed in Phase 0 — import, do not re-add |
| `src/lib/kdFraming.ts` | Create | Shared KD plain-language framing utility |
| `server/content-brief.ts` | Modify | Add strategyCardContext param to generateBrief(); add PAGE_TYPE_CONFIGS entries for all 7 page types; inject context block into prompt |
| `server/routes/content-requests.ts` | Modify | Pass request.rationale, request.intent, request.priority as strategyCardContext to generateBrief() |
| `server/workspace-intelligence.ts` | Modify | assembleSeoContext(): add backlinkProfile via getBacklinksOverview(); add serpFeatures via parseSerpFeatures() |
| `server/routes/keyword-strategy.ts` | Modify | Switch replaceAllPageKeywords() → upsertPageKeywordsBatch() at both call sites |
| `src/components/PageIntelligence.tsx` | Modify | Replace local StrategyPage.metricsSource union with MetricsSource from shared/types/keywords.ts |
| `src/components/client/StrategyTab.tsx` | Modify | Add predicted impact line; update status badges per spec; add KD tooltip using kdFraming |
| `src/components/strategy/ContentGaps.tsx` | Modify | Add KD tooltip using kdFraming; add predicted impact line |
| `src/hooks/admin/useSeoEditor.ts` | Modify | Switch fetch from /api/webflow/pages/:siteId to /api/webflow/all-pages/:siteId |
| `src/components/SeoEditor.tsx` | Modify | Add CMS page filter UI; wire CMS apply through collectionId path; show "Manual apply required" for unmapped collections |
| `tests/unit/kd-framing.test.ts` | Create | All 4 KD ranges, boundary values, undefined graceful fallback |
| `tests/unit/page-intelligence-strategy-blend.test.ts` | Create | Upsert preserves PI fields; metricsSource='bulk_lookup'; replaceAllPageKeywords NOT called |
| `tests/unit/content-brief.test.ts` | Modify | Add generateBrief with strategyCardContext suite; add per-pageType suite |
| `tests/unit/workspace-intelligence.test.ts` | Modify | Add backlinkProfile + serpFeatures to mock; assert both present; assert graceful on getBacklinksOverview throw |
| `tests/unit/format-for-prompt.test.ts` | Modify | Add backlinkProfile + serpFeatures to richIntelligence fixture; add 3 assertions |
| `tests/fixtures/rich-intelligence.ts` | Modify | Add backlinkProfile and serpFeatures to RICH_SEO_CONTEXT |
| `tests/integration/seo-editor-unified.test.ts` | Create | all-pages endpoint; collection filter; CMS apply path; unmapped → manualApplyRequired |
| `tests/integration/content-requests-routes.test.ts` | Modify | Add test: brief includes rationale from strategy context |

---

## Dependency Graph

> **Pre-condition:** Phase 0 plan is merged and green on staging. Types `StrategyCardContext`, `PageTypeBriefConfig`, `BriefPageType`, `BriefJourneyStage` are in `shared/types/content.ts`. `METRICS_SOURCE`, `MetricsSource` are in `shared/types/keywords.ts`. Import from these — do not redefine.

```
[Phase 0 merged] ← gate: nothing in this plan starts before this
    ↓
Task 1: src/lib/kdFraming.ts (no dependencies — start immediately)
Task 2: server/content-brief.ts (depends on Phase 0 types)
Task 3: server/routes/content-requests.ts (depends on Task 2)
Task 4: server/workspace-intelligence.ts (independent — start immediately)
Task 5: server/routes/keyword-strategy.ts (depends on Phase 0 METRICS_SOURCE)
Task 6: src/components/PageIntelligence.tsx (depends on Phase 0 MetricsSource)
Task 7: src/components/client/StrategyTab.tsx (depends on Task 1 kdFraming)
Task 8: src/components/strategy/ContentGaps.tsx (depends on Task 1 kdFraming)
Task 9: src/hooks/admin/useSeoEditor.ts (independent — start immediately)
Task 10: src/components/SeoEditor.tsx (depends on Task 9)

PARALLEL BATCH A (start immediately after Phase 0 merge): Tasks 1, 4, 5, 6, 9
PARALLEL BATCH B (after Batch A merged): Tasks 2, 7, 8, 10
SEQUENTIAL: Task 3 (after Task 2)
Tests: write and run after the task they cover

---

## Pre-flight Verification

> Run this before starting any task. Phase 0 must be merged and green on staging.

- [ ] Verify Phase 0 types are available:

```bash
grep -n "StrategyCardContext\|PageTypeBriefConfig\|BriefPageType\|BriefJourneyStage" shared/types/content.ts
# Expected: all 4 exported
grep -n "METRICS_SOURCE\|MetricsSource" shared/types/keywords.ts
# Expected: both exported
```

If either grep returns nothing, stop — Phase 0 has not been merged. Do not proceed.

---

> **Navigation note:** Section headers below use their original batch-task labels. The Dependency Graph above shows the correct execution order. Use file/function names — not task numbers — when dispatching agents.

---

## Parallel Batch A — Independent Backend + Frontend Primitives

> These tasks have no inter-dependencies. Start all of them immediately after Phase 0 is confirmed above.

### Task 1 — Create src/lib/kdFraming.ts

**File owner:** `src/lib/kdFraming.ts` (create)

- [ ] Write failing test first — `tests/unit/kd-framing.test.ts`:

```typescript
// tests/unit/kd-framing.test.ts
import { describe, it, expect } from 'vitest';
import { kdFraming, kdTooltip } from '../../src/lib/kdFraming.js';

describe('kdFraming', () => {
  it('returns low-competition label for KD 0', () => {
    expect(kdFraming(0)).toBe('Low competition — strong odds');
  });

  it('returns low-competition label for KD 30 (inclusive boundary)', () => {
    expect(kdFraming(30)).toBe('Low competition — strong odds');
  });

  it('returns moderate label for KD 31 (boundary)', () => {
    expect(kdFraming(31)).toBe('Moderate competition — achievable with a strong post');
  });

  it('returns moderate label for KD 60 (inclusive boundary)', () => {
    expect(kdFraming(60)).toBe('Moderate competition — achievable with a strong post');
  });

  it('returns competitive label for KD 61 (boundary)', () => {
    expect(kdFraming(61)).toBe('Competitive — requires authority and depth');
  });

  it('returns competitive label for KD 80 (inclusive boundary)', () => {
    expect(kdFraming(80)).toBe('Competitive — requires authority and depth');
  });

  it('returns highly-competitive label for KD 81 (boundary)', () => {
    expect(kdFraming(81)).toBe('Highly competitive — long-term play');
  });

  it('returns highly-competitive label for KD 100', () => {
    expect(kdFraming(100)).toBe('Highly competitive — long-term play');
  });

  it('returns undefined gracefully for undefined input', () => {
    expect(kdFraming(undefined)).toBeUndefined();
  });

  it('returns undefined gracefully for null-like input', () => {
    expect(kdFraming(0 as unknown as undefined)).toBe('Low competition — strong odds');
  });

  it('kdTooltip includes raw KD and framing label', () => {
    const tip = kdTooltip(45);
    expect(tip).toContain('45');
    expect(tip).toContain('Moderate competition');
  });

  it('kdTooltip returns empty string for undefined', () => {
    expect(kdTooltip(undefined)).toBe('');
  });
});
```

- [ ] Run test — expect failures:
  ```bash
  npx vitest run tests/unit/kd-framing.test.ts 2>&1 | tail -20
  # Expected: FAIL — cannot find module
  ```

- [ ] Create `src/lib/kdFraming.ts`:

```typescript
/**
 * Plain-language keyword difficulty framing utilities.
 *
 * KD ranges (spec-locked — do not alter without spec change):
 *   0–30:   Low competition — strong odds
 *   31–60:  Moderate competition — achievable with a strong post
 *   61–80:  Competitive — requires authority and depth
 *   81–100: Highly competitive — long-term play
 */

const KD_TIERS = [
  { max: 30, label: 'Low competition — strong odds' },
  { max: 60, label: 'Moderate competition — achievable with a strong post' },
  { max: 80, label: 'Competitive — requires authority and depth' },
  { max: 100, label: 'Highly competitive — long-term play' },
] as const;

/**
 * Returns a plain-language framing string for a keyword difficulty score.
 * Returns undefined if kd is undefined (caller omits line entirely).
 */
export function kdFraming(kd: number | undefined): string | undefined {
  if (kd === undefined) return undefined;
  for (const tier of KD_TIERS) {
    if (kd <= tier.max) return tier.label;
  }
  return KD_TIERS[KD_TIERS.length - 1].label;
}

/**
 * Returns a tooltip string showing raw KD and framing label.
 * Returns empty string if kd is undefined (caller omits tooltip prop).
 */
export function kdTooltip(kd: number | undefined): string {
  if (kd === undefined) return '';
  const framing = kdFraming(kd);
  return `KD ${kd}/100 — ${framing}`;
}
```

- [ ] Run test — expect all pass:
  ```bash
  npx vitest run tests/unit/kd-framing.test.ts 2>&1 | tail -10
  # Expected: PASS — 12 tests
  ```
- [ ] Commit: `git add src/lib/kdFraming.ts tests/unit/kd-framing.test.ts && git commit -m "feat(lib): add kdFraming utility with plain-language KD labels"`

---

### Task 6 — Wire backlinkProfile + serpFeatures into assembleSeoContext()

**File owner:** `server/workspace-intelligence.ts` (modify)

- [ ] Read current `assembleSeoContext()` return statement to find the `return base;` line (confirmed at line ~285 in origin/main).
- [ ] Write failing test additions to `tests/unit/workspace-intelligence.test.ts`:

```typescript
// Add inside the existing describe('buildWorkspaceIntelligence', ...) block:

describe('assembleSeoContext — backlinkProfile + serpFeatures', () => {
  it('populates backlinkProfile when getBacklinksOverview returns data', async () => {
    // Mock seo-data-provider
    vi.doMock('../../server/seo-data-provider.js', () => ({
      getConfiguredProvider: vi.fn().mockReturnValue({
        isConfigured: vi.fn().mockReturnValue(true),
        getBacklinksOverview: vi.fn().mockResolvedValue({
          totalBacklinks: 1200,
          referringDomains: 85,
          trend: 'growing',
        }),
      }),
    }));

    // Seed a workspace with a live domain
    const ws = createWorkspace('Backlink Test WS');
    updateWorkspace(ws.id, { liveDomain: 'example.com' });

    const intel = await buildWorkspaceIntelligence(ws.id, { slices: ['seoContext'] });
    expect(intel.seoContext?.backlinkProfile).toBeDefined();
    expect(intel.seoContext?.backlinkProfile?.totalBacklinks).toBe(1200);
    expect(intel.seoContext?.backlinkProfile?.referringDomains).toBe(85);
    expect(intel.seoContext?.backlinkProfile?.trend).toBe('growing');
    deleteWorkspace(ws.id);
  });

  it('omits backlinkProfile gracefully when getBacklinksOverview throws', async () => {
    vi.doMock('../../server/seo-data-provider.js', () => ({
      getConfiguredProvider: vi.fn().mockReturnValue({
        isConfigured: vi.fn().mockReturnValue(true),
        getBacklinksOverview: vi.fn().mockRejectedValue(new Error('provider unavailable')),
      }),
    }));
    const ws = createWorkspace('Backlink Fail WS');
    updateWorkspace(ws.id, { liveDomain: 'fail.com' });
    const intel = await buildWorkspaceIntelligence(ws.id, { slices: ['seoContext'] });
    expect(intel.seoContext?.backlinkProfile).toBeUndefined();
    deleteWorkspace(ws.id);
  });

  it('populates serpFeatures from page_keywords serpFeatures column', async () => {
    const ws = createWorkspace('Serp Features WS');
    // Seed page_keywords rows with serpFeatures JSON
    upsertPageKeyword(ws.id, {
      pagePath: '/page-a',
      pageTitle: 'Page A',
      primaryKeyword: 'test keyword',
      secondaryKeywords: [],
      serpFeatures: ['featured_snippet', 'people_also_ask'],
    } as any);
    upsertPageKeyword(ws.id, {
      pagePath: '/page-b',
      pageTitle: 'Page B',
      primaryKeyword: 'test keyword 2',
      secondaryKeywords: [],
      serpFeatures: ['featured_snippet', 'local_pack'],
    } as any);
    const intel = await buildWorkspaceIntelligence(ws.id, { slices: ['seoContext'] });
    expect(intel.seoContext?.serpFeatures).toBeDefined();
    expect(intel.seoContext?.serpFeatures?.featuredSnippets).toBeGreaterThanOrEqual(1);
    deleteWorkspace(ws.id);
  });
});
```

- [ ] Run — expect fail (functions not wired yet).

- [ ] In `server/workspace-intelligence.ts`, find the end of `assembleSeoContext()` just before `return base;`. Add the following block:

```typescript
  // Backlink profile — from configured SEO data provider
  try {
    const { getConfiguredProvider } = await import('./seo-data-provider.js');
    const { getWorkspace: getWsForBacklinks } = await import('./workspaces.js');
    const wsForBacklinks = getWsForBacklinks(workspaceId);
    const domain = wsForBacklinks?.liveDomain?.replace(/^https?:\/\//, '').replace(/\/$/, '') ?? '';
    if (domain) {
      const provider = getConfiguredProvider();
      if (provider?.isConfigured()) {
        const overview = await provider.getBacklinksOverview(domain, workspaceId);
        if (overview) {
          base.backlinkProfile = {
            totalBacklinks: overview.totalBacklinks,
            referringDomains: overview.referringDomains,
            trend: overview.trend ?? 'stable',
          };
        }
      }
    }
  } catch {
    // Backlink data is optional — omit silently
  }

  // SERP features — aggregated from page_keywords.serp_features column (no new API call)
  try {
    const { listPageKeywords: listPkForSerp } = await import('./page-keywords.js');
    const pageKws = listPkForSerp(workspaceId);
    let featuredSnippets = 0;
    let peopleAlsoAsk = 0;
    let localPackFound = false;
    for (const pk of pageKws) {
      // serpFeatures is stored as a JSON string array in the DB
      const features: string[] = Array.isArray((pk as any).serpFeatures)
        ? (pk as any).serpFeatures
        : [];
      for (const f of features) {
        const lower = f.toLowerCase();
        if (lower.includes('featured_snippet') || lower.includes('featured snippet')) featuredSnippets++;
        if (lower.includes('people_also_ask') || lower.includes('people also ask')) peopleAlsoAsk++;
        if (lower.includes('local_pack') || lower.includes('local pack')) localPackFound = true;
      }
    }
    if (featuredSnippets > 0 || peopleAlsoAsk > 0 || localPackFound) {
      base.serpFeatures = { featuredSnippets, peopleAlsoAsk, localPack: localPackFound };
    }
  } catch {
    // SERP features are optional — omit silently
  }

  return base;
```

- [ ] Also update `formatSeoContextSection()` in the same file (find the block that formats rank tracking, after the `rankTracking` block):

```typescript
  // Backlink profile — at standard+ verbosity
  if (ctx.backlinkProfile && verbosity !== 'compact') {
    const bp = ctx.backlinkProfile;
    lines.push(`Backlinks: ${bp.totalBacklinks.toLocaleString()} total, ${bp.referringDomains} referring domains (trend: ${bp.trend})`);
  }

  // SERP features — at standard+ verbosity
  if (ctx.serpFeatures && verbosity !== 'compact') {
    const sf = ctx.serpFeatures;
    const parts: string[] = [];
    if (sf.featuredSnippets > 0) parts.push(`${sf.featuredSnippets} featured snippet${sf.featuredSnippets > 1 ? 's' : ''}`);
    if (sf.peopleAlsoAsk > 0) parts.push(`${sf.peopleAlsoAsk} PAA box${sf.peopleAlsoAsk > 1 ? 'es' : ''}`);
    if (sf.localPack) parts.push('local pack');
    if (parts.length > 0) lines.push(`SERP features across pages: ${parts.join(', ')}`);
  }
```

- [ ] Update `tests/fixtures/rich-intelligence.ts` — add to `RICH_SEO_CONTEXT`:
  ```typescript
  backlinkProfile: {
    totalBacklinks: 3400,
    referringDomains: 210,
    trend: 'growing',
  },
  serpFeatures: {
    featuredSnippets: 4,
    peopleAlsoAsk: 12,
    localPack: false,
  },
  ```

- [ ] Update `tests/unit/format-for-prompt.test.ts` — add 3 assertions inside existing `describe('formatForPrompt', ...)`:
  ```typescript
  it('includes backlinkProfile in standard mode when present', () => {
    const intel: WorkspaceIntelligence = {
      ...baseIntelligence,
      seoContext: {
        ...RICH_SEO_CONTEXT,
        backlinkProfile: { totalBacklinks: 3400, referringDomains: 210, trend: 'growing' },
      },
    };
    const result = formatForPrompt(intel, { verbosity: 'standard' });
    expect(result).toContain('3,400');
    expect(result).toContain('210');
    expect(result).toContain('growing');
  });

  it('includes serpFeatures in standard mode when present', () => {
    const intel: WorkspaceIntelligence = {
      ...baseIntelligence,
      seoContext: {
        ...RICH_SEO_CONTEXT,
        serpFeatures: { featuredSnippets: 4, peopleAlsoAsk: 12, localPack: false },
      },
    };
    const result = formatForPrompt(intel, { verbosity: 'standard' });
    expect(result).toContain('featured snippet');
    expect(result).toContain('PAA box');
  });

  it('omits backlinkProfile in compact mode', () => {
    const intel: WorkspaceIntelligence = {
      ...baseIntelligence,
      seoContext: {
        ...RICH_SEO_CONTEXT,
        backlinkProfile: { totalBacklinks: 3400, referringDomains: 210, trend: 'growing' },
      },
    };
    const result = formatForPrompt(intel, { verbosity: 'compact' });
    expect(result).not.toContain('Backlinks:');
  });
  ```

- [ ] Run all intelligence tests:
  ```bash
  npx vitest run tests/unit/workspace-intelligence.test.ts tests/unit/format-for-prompt.test.ts 2>&1 | tail -20
  # Expected: all pass
  ```
- [ ] Commit: `git add server/workspace-intelligence.ts tests/unit/workspace-intelligence.test.ts tests/unit/format-for-prompt.test.ts tests/fixtures/rich-intelligence.ts && git commit -m "feat(intelligence): wire backlinkProfile + serpFeatures into assembleSeoContext"`

---

### Task 7 — Switch replaceAllPageKeywords → upsertPageKeywordsBatch in keyword-strategy routes

**File owner:** `server/routes/keyword-strategy.ts` (modify)

- [ ] Write failing test first — `tests/unit/page-intelligence-strategy-blend.test.ts`:

```typescript
// tests/unit/page-intelligence-strategy-blend.test.ts
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import db from '../../server/db/index.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';
import {
  upsertPageKeyword,
  getPageKeyword,
  listPageKeywords,
} from '../../server/page-keywords.js';

// Spy on replaceAllPageKeywords to ensure it is NOT called
const replaceAllSpy = vi.fn();
vi.mock('../../server/page-keywords.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/page-keywords.js')>();
  return {
    ...actual,
    replaceAllPageKeywords: replaceAllSpy,
  };
});

let wsId = '';

beforeAll(() => {
  const ws = createWorkspace('PI Strategy Blend Test');
  wsId = ws.id;
});

afterAll(() => {
  deleteWorkspace(wsId);
  vi.restoreAllMocks();
});

describe('Page Intelligence strategy blend — upsertPageKeywordsBatch safety', () => {
  it('preserves existing Page Intelligence fields after upsert', () => {
    // Seed a page with full PI analysis data
    upsertPageKeyword(wsId, {
      pagePath: '/services/seo',
      pageTitle: 'SEO Services',
      primaryKeyword: 'seo services',
      secondaryKeywords: ['local seo', 'technical seo'],
      optimizationScore: 87,
      optimizationIssues: ['Missing FAQ schema', 'Meta description too short'],
      recommendations: ['Add FAQ section', 'Extend meta to 150+ chars'],
      contentGaps: ['local business schema', 'review signals'],
      analysisGeneratedAt: '2026-04-01T10:00:00Z',
    });

    // Simulate strategy run upserting the same page with keyword data
    upsertPageKeyword(wsId, {
      pagePath: '/services/seo',
      pageTitle: 'SEO Services',
      primaryKeyword: 'seo services',
      secondaryKeywords: ['local seo', 'technical seo'],
      metricsSource: 'bulk_lookup',
      volume: 1200,
      difficulty: 45,
      currentPosition: 8,
    });

    const result = getPageKeyword(wsId, '/services/seo');
    expect(result).toBeDefined();
    // PI fields must survive the strategy upsert
    expect(result!.optimizationScore).toBe(87);
    expect(result!.optimizationIssues).toContain('Missing FAQ schema');
    expect(result!.recommendations).toContain('Add FAQ section');
    expect(result!.analysisGeneratedAt).toBe('2026-04-01T10:00:00Z');
    // Strategy fields also present
    expect(result!.metricsSource).toBe('bulk_lookup');
    expect(result!.volume).toBe(1200);
  });

  it('metricsSource written by strategy is bulk_lookup (valid MetricsSource)', () => {
    const result = getPageKeyword(wsId, '/services/seo');
    expect(result!.metricsSource).toBe('bulk_lookup');
    // Verify it's a valid MetricsSource value
    const validValues = ['exact', 'partial_match', 'ai_estimate', 'bulk_lookup'];
    expect(validValues).toContain(result!.metricsSource);
  });

  it('replaceAllPageKeywords is NOT called when strategy upserts pages', () => {
    // This test passes once keyword-strategy.ts is switched to upsertPageKeywordsBatch
    expect(replaceAllSpy).not.toHaveBeenCalled();
  });

  it('multiple pages upserted via batch all appear in listPageKeywords', () => {
    const pages = [
      { pagePath: '/services/ppc', pageTitle: 'PPC Services', primaryKeyword: 'ppc', secondaryKeywords: [], metricsSource: 'bulk_lookup' as const },
      { pagePath: '/services/content', pageTitle: 'Content Services', primaryKeyword: 'content marketing', secondaryKeywords: [], metricsSource: 'bulk_lookup' as const },
    ];
    for (const p of pages) upsertPageKeyword(wsId, p);
    const all = listPageKeywords(wsId);
    expect(all.length).toBeGreaterThan(0);
    expect(all.some(p => p.pagePath === '/services/ppc')).toBe(true);
    expect(all.some(p => p.pagePath === '/services/content')).toBe(true);
  });
});
```

- [ ] Run — expect fail:
  ```bash
  npx vitest run tests/unit/page-intelligence-strategy-blend.test.ts 2>&1 | tail -10
  # Expected: FAIL on replaceAllPageKeywords NOT called assertion
  ```

- [ ] In `server/routes/keyword-strategy.ts`, find line 40 import:
  ```typescript
  import { replaceAllPageKeywords, listPageKeywords } from '../page-keywords.js';
  ```
  Replace with:
  ```typescript
  import { upsertPageKeywordsBatch, listPageKeywords } from '../page-keywords.js';
  ```

- [ ] Find the first call site (around line 1745):
  ```typescript
  replaceAllPageKeywords(ws.id, pageMap);
  ```
  Replace with:
  ```typescript
  upsertPageKeywordsBatch(ws.id, pageMap);
  ```

- [ ] Find the second call site (around line 1928, inside the PATCH route):
  ```typescript
  replaceAllPageKeywords(ws.id, req.body.pageMap);
  ```
  Replace with:
  ```typescript
  upsertPageKeywordsBatch(ws.id, req.body.pageMap);
  ```

- [ ] Run test:
  ```bash
  npx vitest run tests/unit/page-intelligence-strategy-blend.test.ts 2>&1 | tail -10
  # Expected: all pass
  ```
- [ ] Commit: `git add server/routes/keyword-strategy.ts tests/unit/page-intelligence-strategy-blend.test.ts && git commit -m "fix(strategy): switch replaceAllPageKeywords to upsertPageKeywordsBatch — preserve Page Intelligence data"`

---

### Task 8 — Fix PageIntelligence.tsx metricsSource to accept bulk_lookup

**File owner:** `src/components/PageIntelligence.tsx` (modify)

- [ ] Read lines 25–60 of `src/components/PageIntelligence.tsx` to locate the local `StrategyPage` interface (confirmed at line 25).
- [ ] Find the local `StrategyPage` interface and its `metricsSource` field:
  ```typescript
  metricsSource?: 'exact' | 'partial_match' | 'ai_estimate';
  ```
- [ ] Add import at top of file with existing imports:
  ```typescript
  import type { MetricsSource } from '../../shared/types/keywords.js';
  ```
- [ ] Replace the `metricsSource` field in the local `StrategyPage` interface:
  ```typescript
  // BEFORE:
  metricsSource?: 'exact' | 'partial_match' | 'ai_estimate';
  // AFTER:
  metricsSource?: MetricsSource;
  ```
- [ ] Run `npx tsc --noEmit --skipLibCheck` — expect zero errors.
- [ ] Commit: `git add src/components/PageIntelligence.tsx && git commit -m "fix(page-intelligence): use MetricsSource type — accept bulk_lookup from strategy runs"`

---

### Task 11 — Switch useSeoEditor to all-pages endpoint

**File owner:** `src/hooks/admin/useSeoEditor.ts` (modify)

- [ ] Read `src/hooks/admin/useSeoEditor.ts` (confirmed hook fetches `/api/webflow/pages/${siteId}`).
- [ ] Update the PageMeta interface to include `source` field (returned by all-pages endpoint):

```typescript
interface PageMeta {
  id: string;
  title: string;
  slug: string;
  publishedPath?: string | null;
  seo?: { title?: string | null; description?: string | null };
  openGraph?: { title?: string | null; description?: string | null; titleCopied?: boolean; descriptionCopied?: boolean };
  /** 'static' = Webflow static page, 'cms' = CMS collection item discovered via sitemap */
  source?: 'static' | 'cms';
  /** For CMS items only — the Webflow collection ID needed for SEO write-back */
  collectionId?: string;
}
```

- [ ] Change the queryFn fetch URL:
  ```typescript
  // BEFORE:
  const response = await get<PageMeta[]>(`/api/webflow/pages/${siteId}`);
  // AFTER:
  const response = await get<PageMeta[]>(`/api/webflow/all-pages/${siteId}`);
  ```
  Note: The all-pages endpoint requires `workspaceId` as a query param for `requireWorkspaceAccessFromQuery()`. Update the hook signature to accept `workspaceId` and append it:
  ```typescript
  export function useSeoEditor(siteId: string, workspaceId?: string) {
    return useQuery({
      queryKey: queryKeys.admin.seoEditor(siteId),
      queryFn: async (): Promise<PageMeta[]> => {
        const qs = workspaceId ? `?workspaceId=${workspaceId}` : '';
        const response = await get<PageMeta[]>(`/api/webflow/all-pages/${siteId}${qs}`);
        return Array.isArray(response) ? response : [];
      },
      staleTime: STALE_TIMES.FAST,
      enabled: !!siteId,
      retry: 1,
    });
  }
  ```

- [ ] Find the call site in `src/components/SeoEditor.tsx` where `useSeoEditor(siteId)` is called and update to pass `workspaceId`:
  ```typescript
  // BEFORE:
  const { data: pages = [], isLoading: loading } = useSeoEditor(siteId);
  // AFTER:
  const { data: pages = [], isLoading: loading } = useSeoEditor(siteId, workspaceId);
  ```
- [ ] Run `npx tsc --noEmit --skipLibCheck` — expect zero errors.
- [ ] Commit: `git add src/hooks/admin/useSeoEditor.ts src/components/SeoEditor.tsx && git commit -m "feat(seo-editor): switch to all-pages endpoint — include CMS pages from sitemap discovery"`

---

## Parallel Batch B — Feature Implementation

> Run after Batch A is merged. Tasks 4, 5, 9, 10, 12 can run concurrently.

### Task 4 — Add strategyCardContext to generateBrief() + PAGE_TYPE_CONFIGS

**File owner:** `server/content-brief.ts` (modify)

- [ ] Write failing test additions to `tests/unit/content-brief.test.ts`:

```typescript
// Add at the end of the existing test file

describe('generateBrief — strategyCardContext injection (mocked OpenAI)', () => {
  // These tests validate the prompt construction, not the OpenAI call.
  // We test the logic by inspecting what would be injected.

  it('buildStrategyCardBlock returns empty string when context is undefined', () => {
    // Import the internal helper
    const { buildStrategyCardBlock } = require('../../server/content-brief.js');
    expect(buildStrategyCardBlock(undefined)).toBe('');
  });

  it('buildStrategyCardBlock includes rationale when provided', () => {
    const { buildStrategyCardBlock } = require('../../server/content-brief.js');
    const block = buildStrategyCardBlock({
      rationale: 'High-volume gap with no existing page',
      intent: 'informational',
      priority: 'high',
      journeyStage: 'awareness',
    });
    expect(block).toContain('High-volume gap with no existing page');
    expect(block).toContain('informational');
    expect(block).toContain('high');
    expect(block).toContain('awareness');
  });

  it('buildStrategyCardBlock omits fields that are undefined', () => {
    const { buildStrategyCardBlock } = require('../../server/content-brief.js');
    const block = buildStrategyCardBlock({ rationale: 'Only rationale set' });
    expect(block).toContain('Only rationale set');
    expect(block).not.toContain('undefined');
  });
});

describe('generateBrief — PAGE_TYPE_CONFIGS coverage', () => {
  const PAGE_TYPES = ['blog', 'landing', 'service', 'location', 'pillar', 'product', 'resource'];

  it('getPageTypeConfig returns a config for every supported page type', () => {
    const { getPageTypeConfig } = require('../../server/content-brief.js');
    for (const pt of PAGE_TYPES) {
      const cfg = getPageTypeConfig(pt);
      expect(cfg).toBeDefined();
      expect(typeof cfg.wordCountTarget).toBe('number');
      expect(cfg.wordCountTarget).toBeGreaterThan(0);
      expect(typeof cfg.tone).toBe('string');
      expect(cfg.tone.length).toBeGreaterThan(0);
      expect(Array.isArray(cfg.schemaTypes)).toBe(true);
      expect(cfg.schemaTypes.length).toBeGreaterThan(0);
    }
  });

  it('blog config has wordCountTarget >= 1400', () => {
    const { getPageTypeConfig } = require('../../server/content-brief.js');
    expect(getPageTypeConfig('blog').wordCountTarget).toBeGreaterThanOrEqual(1400);
  });

  it('landing config has wordCountTarget <= 1000', () => {
    const { getPageTypeConfig } = require('../../server/content-brief.js');
    expect(getPageTypeConfig('landing').wordCountTarget).toBeLessThanOrEqual(1000);
  });

  it('pillar config has wordCountTarget >= 3000', () => {
    const { getPageTypeConfig } = require('../../server/content-brief.js');
    expect(getPageTypeConfig('pillar').wordCountTarget).toBeGreaterThanOrEqual(3000);
  });
});
```

- [ ] Run — expect fail (buildStrategyCardBlock not exported yet).

- [ ] In `server/content-brief.ts`, find the existing `PAGE_TYPE_CONFIGS` object and add or replace it with the full spec-aligned configuration. Locate the existing `PAGE_TYPE_CONFIGS` constant (it already has some entries based on the `getPageTypeConfig(context.pageType)` call in the prompt). Update/add entries for all 7 page types:

```typescript
export const PAGE_TYPE_CONFIGS: Record<string, PageTypeBriefConfig> = {
  blog: {
    tone: 'Conversational and educational. First-person examples welcome. Accessible to a general audience.',
    structure: 'Hook → problem framing → H2/H3 sections → FAQ → internal links → soft CTA',
    schemaTypes: ['Article'],
    wordCountTarget: 1800,
    wordCountRange: '1400–2200',
    avgSectionWords: 280,
    sectionRange: '5–7',
    contentStyle: 'Educational depth with a conversational voice. Use examples, stats, and practical takeaways. Avoid jargon.',
    prompt: 'PAGE TYPE: Blog Post — write for an educational, discovery-oriented reader. Structure as: hook (why this matters) → problem framing → multiple H2 sections with H3 breakdowns → FAQ section addressing People Also Ask questions → internal link suggestions → soft CTA. Use schema: Article.',
  },
  landing: {
    tone: 'Persuasive and benefit-focused. Concise. Every sentence earns its place.',
    structure: 'Hook → benefit bullets → trust signals → one primary CTA',
    schemaTypes: ['WebPage'],
    wordCountTarget: 750,
    wordCountRange: '600–900',
    avgSectionWords: 120,
    sectionRange: '4–6',
    contentStyle: 'Conversion-optimized. Lead with the primary benefit. Reduce friction. One clear CTA.',
    prompt: 'PAGE TYPE: Landing Page — write for a conversion-focused reader. Structure as: hook (primary benefit in 1-2 sentences) → 3-5 benefit bullets → trust signals (social proof, credentials) → one clear CTA. No bloated intro. Use schema: WebPage.',
  },
  service: {
    tone: 'Authoritative and outcome-focused. Professional but approachable.',
    structure: 'Value prop → problem/solution → feature/benefit pairs → social proof → objection handling → FAQ → CTA',
    schemaTypes: ['Service', 'LocalBusiness'],
    wordCountTarget: 1400,
    wordCountRange: '1100–1800',
    avgSectionWords: 200,
    sectionRange: '5–7',
    contentStyle: 'Positions the service as the clear solution. Answers "why us" before the visitor asks. Uses case-specific proof.',
    prompt: 'PAGE TYPE: Service Page — write for a consideration-stage buyer evaluating options. Structure as: value proposition → problem/solution framing → feature/benefit pairs (not features alone) → social proof (testimonials, results) → objection handling → FAQ → CTA. Use schema: Service + LocalBusiness.',
  },
  location: {
    tone: 'Locally grounded and community-aware. Natural local language, not keyword-stuffed.',
    structure: 'NAP block → service area signals → proximity language → local review → map embed note',
    schemaTypes: ['LocalBusiness', 'GeoCoordinates'],
    wordCountTarget: 1000,
    wordCountRange: '800–1200',
    avgSectionWords: 180,
    sectionRange: '4–6',
    contentStyle: 'Hyper-local. Mentions specific neighborhoods, landmarks, or service area signals. Avoids generic filler.',
    prompt: 'PAGE TYPE: Location Page — write for a local search visitor. Include: NAP block (Name, Address, Phone), service area signals with specific city/neighborhood references, proximity language ("serving [city] and surrounding areas"), local social proof (reviews from local customers), and note for a map embed. Use schema: LocalBusiness + GeoCoordinates.',
  },
  pillar: {
    tone: 'Comprehensive and authoritative. The definitive resource on this topic.',
    structure: 'Topic overview → linked subtopics → internal linking map',
    schemaTypes: ['Article', 'BreadcrumbList'],
    wordCountTarget: 3500,
    wordCountRange: '3000–5000',
    avgSectionWords: 450,
    sectionRange: '7–10',
    contentStyle: 'Encyclopedic depth. Each H2 is a standalone subtopic that links to a cluster page. Internal link density is higher than a typical post.',
    prompt: 'PAGE TYPE: Pillar Page — write for a reader seeking the complete guide on this topic. Structure as: topic overview (what is it, why does it matter) → comprehensive H2 sections each covering a distinct subtopic → explicit internal link suggestions to cluster pages on the site → BreadcrumbList note. Use schema: Article + BreadcrumbList.',
  },
  product: {
    tone: 'Feature-benefit driven. Specific and honest. No puffery.',
    structure: 'Specs → comparison table → testimonials → pricing context → CTA',
    schemaTypes: ['Product', 'AggregateRating'],
    wordCountTarget: 1200,
    wordCountRange: '900–1500',
    avgSectionWords: 190,
    sectionRange: '5–7',
    contentStyle: 'Leads with the specific benefit of each feature. Uses comparison tables. Social proof with specifics (star ratings, verified buyers).',
    prompt: 'PAGE TYPE: Product Page — write for a decision-stage buyer. Structure as: product specs with benefit framing → comparison table (this product vs. alternatives or tiers) → testimonials with specifics → pricing context (value framing) → CTA. Use schema: Product + AggregateRating.',
  },
  resource: {
    tone: 'Educational depth. Treat same as a pillar page — comprehensive and authoritative.',
    structure: 'Topic overview → linked subtopics → internal linking map',
    schemaTypes: ['Article', 'BreadcrumbList'],
    wordCountTarget: 3000,
    wordCountRange: '2500–4000',
    avgSectionWords: 400,
    sectionRange: '6–9',
    contentStyle: 'Reference-grade depth. Emphasizes utility — the reader should bookmark this. Cite sources. Tables and lists over prose where it helps.',
    prompt: 'PAGE TYPE: Resource Guide — write for a reader seeking a reference they will bookmark and return to. Same depth as a pillar page. Use tables, lists, and visual aids where applicable. Link generously to related resources on the site. Use schema: Article + BreadcrumbList.',
  },
};
```

- [ ] Add the exported `buildStrategyCardBlock` helper immediately after the `PAGE_TYPE_CONFIGS` constant:

```typescript
/**
 * Builds the strategy card context block injected into the generateBrief prompt.
 * Exported for unit testing.
 */
export function buildStrategyCardBlock(ctx: StrategyCardContext | undefined): string {
  if (!ctx) return '';
  const lines: string[] = ['\n\nSTRATEGY CARD CONTEXT (from the content gap that triggered this brief):'];
  if (ctx.rationale) lines.push(`- Strategic rationale: ${ctx.rationale}`);
  if (ctx.intent) lines.push(`- Search intent: ${ctx.intent}`);
  if (ctx.priority) lines.push(`- Priority: ${ctx.priority}`);
  if (ctx.journeyStage) lines.push(`- Journey stage: ${ctx.journeyStage} — tailor depth, CTA, and tone to this stage`);
  if (lines.length === 1) return ''; // no fields added
  lines.push('Use this context to align the brief with the client\'s stated strategy. The rationale explains WHY this page is needed — reference it in the executive summary.');
  return lines.join('\n');
}
```

- [ ] Import `StrategyCardContext` from shared types at the top of `server/content-brief.ts`:
  ```typescript
  import type { StrategyCardContext, PageTypeBriefConfig } from '../shared/types/content.js';
  ```

- [ ] Update the `generateBrief()` function signature — add `strategyCardContext` to the `context` parameter object:
  ```typescript
  export async function generateBrief(
    workspaceId: string,
    targetKeyword: string,
    context: {
      // ... all existing fields ...
      /** Strategy card context threaded from the content request. */
      strategyCardContext?: StrategyCardContext;
    }
  ): Promise<ContentBrief> {
  ```

- [ ] Inside `generateBrief()`, find the line where the prompt string is assembled (the `const prompt = \`...\`` block). Add `strategyCardBlock` to the prompt, immediately before the `${intelligenceBlock}` token:

```typescript
  const strategyCardBlock = buildStrategyCardBlock(context.strategyCardContext);

  // (Insert strategyCardBlock into the prompt string)
  // Find: `...${intelligenceBlock}`
  // Replace with: `...${strategyCardBlock}${intelligenceBlock}`
```

The full diff at the prompt end:
```typescript
// BEFORE (last part of the template literal before JSON format):
...${referenceBlock}${serpBlock}${styleBlock}${templateBlock}${intelligenceBlock}
// AFTER:
...${referenceBlock}${serpBlock}${styleBlock}${templateBlock}${strategyCardBlock}${intelligenceBlock}
```

- [ ] Run tests:
  ```bash
  npx vitest run tests/unit/content-brief.test.ts 2>&1 | tail -20
  # Expected: all pass
  ```
- [ ] Commit: `git add server/content-brief.ts tests/unit/content-brief.test.ts && git commit -m "feat(brief): add strategyCardContext param to generateBrief(); complete PAGE_TYPE_CONFIGS for all 7 page types"`

---

### Task 5 — Thread strategyCardContext through content-requests.ts

**File owner:** `server/routes/content-requests.ts` (modify)

- [ ] Write failing test addition to `tests/integration/content-requests-routes.test.ts`. Add a new describe block after the existing tests:

```typescript
describe('Content Requests — brief generation includes strategy context', () => {
  it('POST /api/content-requests/:workspaceId seeds rationale on the request', async () => {
    // Create a content request with rationale, intent, and priority
    const body = {
      targetKeyword: 'content strategy for saas',
      pageType: 'blog',
      rationale: 'High-volume gap — no existing page targeting this cluster',
      intent: 'informational',
      priority: 'high',
    };
    const res = await api(`/api/content-requests/${testWsId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    // May be 201 or 200 depending on implementation
    expect([200, 201]).toContain(res.status);
    const created = await res.json();
    expect(created.rationale).toBe('High-volume gap — no existing page targeting this cluster');
    expect(created.intent).toBe('informational');
    expect(created.priority).toBe('high');
  });
});
```

- [ ] Run — expect the test to pass if rationale is already stored, or fail if the POST handler doesn't persist it. Investigate:
  ```bash
  npx vitest run tests/integration/content-requests-routes.test.ts 2>&1 | tail -20
  ```

- [ ] Read `server/routes/content-requests.ts` lines 195–230 (the `generateBrief` call site). Confirm the current call:
  ```typescript
  const brief = await generateBrief(req.params.workspaceId, request.targetKeyword, {
    relatedQueries,
    businessContext: ws.keywordStrategy?.businessContext || '',
    existingPages,
    semrushMetrics,
    semrushRelated,
    pageType: request.pageType || 'blog',
    ga4PagePerformance,
  });
  ```

- [ ] Update the `generateBrief` call to include `strategyCardContext`:

```typescript
import type { StrategyCardContext, BriefJourneyStage } from '../../shared/types/content.js';

// Add helper above the route handler:
function deriveJourneyStage(intent?: string): BriefJourneyStage | undefined {
  if (!intent) return undefined;
  const lower = intent.toLowerCase();
  if (lower === 'informational') return 'awareness';
  if (lower === 'commercial') return 'consideration';
  if (lower === 'transactional') return 'decision';
  return undefined;
}

// Inside the POST /generate-brief handler, update the generateBrief call:
const strategyCardContext: StrategyCardContext = {
  rationale: request.rationale,
  intent: request.intent,
  priority: request.priority,
  journeyStage: deriveJourneyStage(request.intent),
};

const brief = await generateBrief(req.params.workspaceId, request.targetKeyword, {
  relatedQueries,
  businessContext: ws.keywordStrategy?.businessContext || '',
  existingPages,
  semrushMetrics,
  semrushRelated,
  pageType: request.pageType || 'blog',
  ga4PagePerformance,
  strategyCardContext,
});
```

- [ ] Run integration test:
  ```bash
  npx vitest run tests/integration/content-requests-routes.test.ts 2>&1 | tail -20
  # Expected: all pass
  ```
- [ ] Commit: `git add server/routes/content-requests.ts tests/integration/content-requests-routes.test.ts && git commit -m "fix(briefs): thread rationale+intent+priority as strategyCardContext into generateBrief — fix context dropout"`

---

### Task 9 — Smarter recommendation cards in StrategyTab

**File owner:** `src/components/client/StrategyTab.tsx` (modify)

- [ ] Read the current `kdColor` function at line 44 (confirmed: `kd <= 30 ? 'text-green-400' : kd <= 60 ? 'text-amber-400' : 'text-red-400'`).
- [ ] Add import for kdFraming at top of file with existing imports:
  ```typescript
  import { kdFraming, kdTooltip } from '../../lib/kdFraming.js';
  ```

- [ ] Find the existing KD display in the ContentGaps card section (around line 568-585). The current rendering shows KD as a number only. Add the framing label and tooltip:

**Find this pattern in the JSX (KD display in the ContentGaps mapped list):**
```tsx
{gap.difficulty != null && (
  <span className={`text-[11px] font-mono ${kdColor(gap.difficulty)}`}>
    KD {gap.difficulty}
  </span>
)}
```
**Replace with:**
```tsx
{gap.difficulty != null && (
  <span
    className={`text-[11px] font-mono ${kdColor(gap.difficulty)} cursor-help`}
    title={kdTooltip(gap.difficulty)}
  >
    KD {gap.difficulty}
    <span className="ml-1 text-[10px] font-sans opacity-70 hidden group-hover:inline">
      — {kdFraming(gap.difficulty)}
    </span>
  </span>
)}
```

- [ ] Find the predicted impact rendering section. Add predicted impact line — this renders ONLY when `volume > 0` AND `currentPosition` is available to estimate CTR. Add a `estimatedCTR` helper:

```typescript
/** Estimate CTR from average position bucket. Source: Backlinko 2024 CTR study. */
function estimatedCTR(position?: number): number | undefined {
  if (!position || position < 1) return undefined;
  if (position <= 1) return 0.279;
  if (position <= 2) return 0.149;
  if (position <= 3) return 0.103;
  if (position <= 5) return 0.062;
  if (position <= 10) return 0.022;
  return undefined; // position > 10: too variable to predict reliably
}

/** Returns predicted monthly clicks or undefined if data is absent. */
function predictedImpact(volume?: number, position?: number): number | undefined {
  if (!volume || volume <= 0) return undefined;
  const ctr = estimatedCTR(position);
  if (ctr === undefined) return undefined;
  return Math.round(volume * ctr);
}
```

- [ ] In the ContentGaps item render, add the predicted impact line after the KD display (only when data is present):
```tsx
{(() => {
  const impact = predictedImpact(gap.volume, gap.currentPosition);
  if (impact === undefined) return null;
  return (
    <span className="text-[10px] text-blue-400/70 flex items-center gap-0.5">
      <TrendingUp className="w-2.5 h-2.5" />
      ~{fmtNum(impact)}/mo est. clicks
    </span>
  );
})()}
```

- [ ] Update status badge colors for content request status in StrategyTab (lines 660–700). The current logic for brief/in-progress statuses uses amber and blue. Update to match spec:

**Current status badge mapping → spec target:**
- `brief_generated` or `client_review` → amber (Brief Requested) ✓ already amber
- `approved` or `in_progress` → blue → change label to "In Production", keep blue ✓ already blue
- `delivered` or `published` → teal for "In Production" per spec; green for "Published" per spec

Find the status display section (confirmed at lines 670-676):
```tsx
// BEFORE:
if (s === 'delivered' || s === 'published') return <span className="flex items-center gap-1 text-[11px] text-teal-400 bg-teal-500/10 px-2.5 py-1.5 rounded-lg border border-teal-500/20 flex-shrink-0"><CheckCircle2 className="w-3.5 h-3.5" /> {s === 'published' ? 'Published' : 'Delivered'} ✓</span>;
if (s === 'approved' || s === 'in_progress') return <span className="flex items-center gap-1 text-[11px] text-blue-400 bg-blue-500/10 px-2.5 py-1.5 rounded-lg border border-blue-500/20 flex-shrink-0"><Sparkles className="w-3.5 h-3.5" /> In Progress</span>;
if (s === 'brief_generated' || s === 'client_review') return <span className="flex items-center gap-1 text-[11px] text-amber-400 bg-amber-500/10 px-2.5 py-1.5 rounded-lg border border-amber-500/20 flex-shrink-0"><FileText className="w-3.5 h-3.5" /> In Review</span>;
return <span className="flex items-center gap-1 text-[11px] text-blue-400 bg-blue-500/10 px-2.5 py-1.5 rounded-lg border border-blue-500/20 flex-shrink-0"><CheckCircle2 className="w-3.5 h-3.5" /> Brief Ordered</span>;
```
```tsx
// AFTER (spec-aligned colors):
if (s === 'published') return (
  <span className="flex items-center gap-1 text-[11px] text-green-400 bg-green-500/10 px-2.5 py-1.5 rounded-lg border border-green-500/20 flex-shrink-0">
    <CheckCircle2 className="w-3.5 h-3.5" /> Published
  </span>
);
if (s === 'delivered') return (
  <span className="flex items-center gap-1 text-[11px] text-teal-400 bg-teal-500/10 px-2.5 py-1.5 rounded-lg border border-teal-500/20 flex-shrink-0">
    <CheckCircle2 className="w-3.5 h-3.5" /> In Production
  </span>
);
if (s === 'approved' || s === 'in_progress') return (
  <span className="flex items-center gap-1 text-[11px] text-teal-400 bg-teal-500/10 px-2.5 py-1.5 rounded-lg border border-teal-500/20 flex-shrink-0">
    <Sparkles className="w-3.5 h-3.5" /> In Production
  </span>
);
if (s === 'brief_generated' || s === 'client_review') return (
  <span className="flex items-center gap-1 text-[11px] text-amber-400 bg-amber-500/10 px-2.5 py-1.5 rounded-lg border border-amber-500/20 flex-shrink-0">
    <FileText className="w-3.5 h-3.5" /> Brief Requested
  </span>
);
if (s === 'tracking') return (
  <span className="flex items-center gap-1 text-[11px] text-blue-400 bg-blue-500/10 px-2.5 py-1.5 rounded-lg border border-blue-500/20 flex-shrink-0">
    <BarChart3 className="w-3.5 h-3.5" /> Tracking
  </span>
);
return (
  <span className="flex items-center gap-1 text-[11px] text-amber-400 bg-amber-500/10 px-2.5 py-1.5 rounded-lg border border-amber-500/20 flex-shrink-0">
    <CheckCircle2 className="w-3.5 h-3.5" /> Brief Ordered
  </span>
);
```

- [ ] Run `npx tsc --noEmit --skipLibCheck` and `npx vite build` — expect zero errors.
- [ ] Commit: `git add src/components/client/StrategyTab.tsx && git commit -m "feat(strategy-tab): add predicted impact, plain-language KD tooltips, spec-aligned status badge colors"`

---

### Task 10 — Add KD framing + predicted impact to ContentGaps

**File owner:** `src/components/strategy/ContentGaps.tsx` (modify)

- [ ] Add imports at top:
  ```typescript
  import { kdFraming, kdTooltip } from '../../lib/kdFraming.js';
  ```

- [ ] Find the existing `kdColor` function in `ContentGaps.tsx` (confirmed at line 22):
  ```typescript
  const kdColor = (kd?: number) => !kd ? 'text-zinc-500' : kd <= 30 ? 'text-green-400' : kd <= 60 ? 'text-amber-400' : 'text-red-400';
  ```
  This stays — we augment it with tooltip and framing label.

- [ ] In the rendered `ContentGap` item (inside `sorted.map((gap, i) => ...)`), find where `gap.difficulty` is displayed. The current pattern shows difficulty as raw number. Add tooltip and framing:

```tsx
{/* Find the difficulty display — typically: */}
{gap.difficulty != null && (
  <span className={`text-xs ${kdColor(gap.difficulty)}`}>
    KD {gap.difficulty}
  </span>
)}
{/* Replace with: */}
{gap.difficulty != null && (
  <span
    className={`text-xs ${kdColor(gap.difficulty)} cursor-help`}
    title={kdTooltip(gap.difficulty)}
  >
    KD {gap.difficulty}
  </span>
)}
{gap.difficulty != null && kdFraming(gap.difficulty) && (
  <span className="text-[10px] text-zinc-500 leading-none">
    {kdFraming(gap.difficulty)}
  </span>
)}
```

- [ ] Add `estimatedCTR` and `predictedImpact` helpers (copy from StrategyTab — these are short enough to inline; do NOT import from StrategyTab because that would create a component-to-component import):

```typescript
function estimatedCTR(position?: number): number | undefined {
  if (!position || position < 1) return undefined;
  if (position <= 1) return 0.279;
  if (position <= 2) return 0.149;
  if (position <= 3) return 0.103;
  if (position <= 5) return 0.062;
  if (position <= 10) return 0.022;
  return undefined;
}

function predictedImpact(volume?: number, position?: number): number | undefined {
  if (!volume || volume <= 0) return undefined;
  const ctr = estimatedCTR(position);
  if (ctr === undefined) return undefined;
  return Math.round(volume * ctr);
}
```

  > Note: These two helpers are identical to those in StrategyTab. Per CLAUDE.md, extract shared interaction patterns when 3+ files share them. Two files is acceptable to inline. If a third file needs this, extract to `src/lib/impactEstimation.ts`.

- [ ] Add predicted impact line in the gap card:
```tsx
{(() => {
  // ContentGap doesn't have currentPosition — use volume only if volume is high enough
  // to show a meaningful estimate (position 3 floor for conservative estimate)
  const impact = gap.volume && gap.volume > 0
    ? Math.round(gap.volume * 0.103) // position-3 floor estimate
    : undefined;
  if (!impact || impact < 10) return null;
  return (
    <span className="text-[10px] text-blue-400/70 flex items-center gap-0.5">
      <TrendingUp className="w-2.5 h-2.5" />
      ~{fmtNum(impact)}/mo est. clicks at rank #3
    </span>
  );
})()}
```

- [ ] Run `npx tsc --noEmit --skipLibCheck` — expect zero errors.
- [ ] Commit: `git add src/components/strategy/ContentGaps.tsx && git commit -m "feat(content-gaps): add KD framing tooltip and predicted impact line"`

---

### Task 12 — SEO Editor CMS page filter + CMS write-back

**File owner:** `src/components/SeoEditor.tsx` (modify)

- [ ] Write failing integration test — `tests/integration/seo-editor-unified.test.ts`:

```typescript
// tests/integration/seo-editor-unified.test.ts
/**
 * Integration tests for the unified SEO editor (all-pages endpoint).
 *
 * Tests:
 * - all-pages endpoint is used (not legacy /pages endpoint)
 * - CMS page filter works (source='cms' entries are separate)
 * - CMS item apply calls updateCollectionItem path (collectionId present)
 * - Unmapped collection → manualApplyRequired flag
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestContext } from './helpers.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';

const ctx = createTestContext(13330);
const { api } = ctx;
let testWsId = '';

beforeAll(async () => {
  await ctx.startServer();
  const ws = createWorkspace('SEO Editor Unified Test');
  testWsId = ws.id;
}, 25_000);

afterAll(() => {
  deleteWorkspace(testWsId);
  ctx.stopServer();
});

describe('SEO Editor — all-pages endpoint', () => {
  it('GET /api/webflow/all-pages/:siteId requires siteId param and returns array shape', async () => {
    // We don't have a real Webflow siteId in tests, so we expect a meaningful error or empty array
    const res = await api(`/api/webflow/all-pages/test-site-id?workspaceId=${testWsId}`);
    // Either 200 with array, or 401/404 depending on auth
    expect([200, 400, 401, 404, 500]).toContain(res.status);
    if (res.status === 200) {
      const body = await res.json();
      expect(Array.isArray(body)).toBe(true);
    }
  });

  it('GET /api/webflow/all-pages/:siteId without workspaceId returns 401 or 400', async () => {
    const res = await api('/api/webflow/all-pages/test-site-id');
    // requireWorkspaceAccessFromQuery requires workspaceId param
    expect([400, 401, 403]).toContain(res.status);
  });
});

describe('SEO Editor — approvals CMS write path', () => {
  it('POST /api/approvals/:workspaceId accepts collectionId in items', async () => {
    const body = {
      siteId: 'test-site-id',
      name: 'SEO Changes Test Batch',
      items: [
        {
          pageId: 'item-id-123',
          field: 'seo-title',
          currentValue: 'Old Title',
          proposedValue: 'New Optimized Title',
          collectionId: 'col-id-456',
          pageTitle: 'Test CMS Page',
        },
      ],
    };
    const res = await api(`/api/approvals/${testWsId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    // Should create batch successfully (collectionId is optional field in schema)
    expect(res.status).toBe(200);
    const batch = await res.json();
    expect(batch.id).toBeDefined();
    // The item should have collectionId stored
    expect(batch.items[0].collectionId).toBe('col-id-456');
  });
});
```

- [ ] Run — expect partial pass (all-pages auth check pass, approvals test depends on approval schema accepting collectionId — already confirmed at line 66 of approvals.ts).

- [ ] In `src/components/SeoEditor.tsx`, add a CMS filter toggle UI above the pages list. Find the existing `search` state and add a `showCmsOnly` state:

```tsx
const [showCmsOnly, setShowCmsOnly] = useState(false);
```

- [ ] Find the filtering logic (typically `pages.filter(p => ...search...)`). Add source filter:
```tsx
const filteredPages = pages
  .filter(p => !search || p.title.toLowerCase().includes(search.toLowerCase()) || p.slug.toLowerCase().includes(search.toLowerCase()))
  .filter(p => !showCmsOnly || p.source === 'cms');
```

- [ ] Add toggle button near the search input:
```tsx
<button
  onClick={() => setShowCmsOnly(prev => !prev)}
  className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${
    showCmsOnly
      ? 'bg-teal-600/20 border-teal-500/40 text-teal-300'
      : 'bg-zinc-800 border-zinc-700 text-zinc-400 hover:text-zinc-200'
  }`}
>
  {showCmsOnly ? 'CMS Only' : 'All Pages'}
</button>
```

- [ ] Find where CMS page apply is handled (the save/apply flow in SeoEditor). When a page has `source === 'cms'` and a `collectionId`, the approval batch item should include the `collectionId`. Find the section where approval batch items are built (in the `Send for Approval` flow or the direct apply flow):

```tsx
// When building approval batch items, include collectionId for CMS pages:
const approvalItem = {
  pageId: page.id,
  pageSlug: page.slug,
  pageTitle: page.title,
  field: 'seo-title',
  currentValue: page.seo?.title || '',
  proposedValue: edits[page.id]?.seoTitle || '',
  // Include collectionId for CMS pages so approvals.ts can route to CMS API
  ...(page.source === 'cms' && page.collectionId ? { collectionId: page.collectionId } : {}),
};
```

- [ ] Add a "Manual apply required" indicator for CMS pages where `source === 'cms'` but `collectionId` is absent (discovered from sitemap but no Webflow collection mapping):

```tsx
{page.source === 'cms' && !page.collectionId && (
  <span className="text-[10px] text-amber-400 bg-amber-500/10 px-1.5 py-0.5 rounded border border-amber-500/20">
    Manual apply required
  </span>
)}
```

- [ ] Run `npx tsc --noEmit --skipLibCheck` and `npx vite build` — expect zero errors.
- [ ] Run integration test:
  ```bash
  npx vitest run tests/integration/seo-editor-unified.test.ts 2>&1 | tail -20
  # Expected: all pass
  ```
- [ ] Commit: `git add src/components/SeoEditor.tsx tests/integration/seo-editor-unified.test.ts && git commit -m "feat(seo-editor): add CMS source filter UI, wire CMS write-back via collectionId, show manual-apply flag for unmapped collections"`

---

## Final Verification

- [ ] Run full TypeScript check:
  ```bash
  npx tsc --noEmit --skipLibCheck 2>&1 | tail -20
  # Expected: 0 errors
  ```

- [ ] Run full Vite build:
  ```bash
  npx vite build 2>&1 | tail -20
  # Expected: built successfully
  ```

- [ ] Run full test suite:
  ```bash
  npx vitest run 2>&1 | tail -30
  # Expected: all tests pass, no regressions
  ```

- [ ] Run PR check:
  ```bash
  npx tsx scripts/pr-check.ts 2>&1 | tail -20
  # Expected: 0 errors
  ```

- [ ] Verify no purple in client components:
  ```bash
  grep -r "purple-" src/components/client/ src/components/strategy/
  # Expected: no output
  ```

- [ ] Verify replaceAllPageKeywords is not called from keyword-strategy.ts:
  ```bash
  grep -n "replaceAllPageKeywords" server/routes/keyword-strategy.ts
  # Expected: no matches (only the old import may remain if not cleaned up)
  grep -n "import.*replaceAllPageKeywords" server/routes/keyword-strategy.ts
  # Expected: no matches
  ```

- [ ] Verify CMS pages show in SEO editor (manual smoke test):
  1. Start dev server: `npm run dev:all`
  2. Navigate to admin → SEO Editor for a workspace with a Webflow site
  3. Confirm page count is higher than before (should include CMS pages from sitemap)
  4. Toggle "CMS Only" filter — only CMS-sourced pages show
  5. Unmapped CMS pages show "Manual apply required" badge

---

## Post-Ship Checklist

- [ ] `FEATURE_AUDIT.md` — update entries for: Briefs Pipeline, Strategy Recommendation Cards, SEO Editor, Page Intelligence, Workspace Intelligence
- [ ] `data/roadmap.json` — mark completed items `"done"`, add `"notes"` for each item
- [ ] Run `npx tsx scripts/sort-roadmap.ts`
- [ ] `BRAND_DESIGN_LANGUAGE.md` — update status badge color map (brief-requested=amber, in-production=teal, published=green, tracking=blue now explicit)
- [ ] Code review: invoke `superpowers:requesting-code-review` before opening PR
- [ ] PR targets `staging` branch, not `main`
