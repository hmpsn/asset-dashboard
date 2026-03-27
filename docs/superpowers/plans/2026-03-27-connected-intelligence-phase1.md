# Connected Intelligence Engine — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform the analytics insight engine from a siloed GSC/GA4 computation layer into a connected intelligence system that enriches insights with page titles, strategy context, audit issues, and pipeline status — then surface them through an insight-first hub UX with toggleable charts, priority feeds, and progressive loading.

**Architecture:** Backend first (migration → engine enrichment → new insight types), then frontend (new components → rewire existing pages). Each task is independently testable. Backend tasks can run in parallel. Frontend tasks depend on backend being complete.

**Tech Stack:** TypeScript, SQLite (better-sqlite3), React 19, Recharts, TanStack React Query, Tailwind CSS 4, Vitest

**Spec:** `docs/superpowers/specs/2026-03-27-connected-intelligence-design.md` (Phase 1: sections 1.1–1.8)

---

## File Map

### New Files
| File | Responsibility |
|------|---------------|
| `server/db/migrations/038-intelligence-enrichment.sql` | Add enrichment columns + new insight types + rename quick_win |
| `server/insight-enrichment.ts` | Page title resolution, strategy alignment, audit/pipeline/anomaly linking |
| `src/components/insights/InsightFeed.tsx` | Priority-ranked insight feed (used on all insight sub-tabs) |
| `src/components/insights/InsightFeedItem.tsx` | Single feed row component |
| `src/components/insights/SummaryPills.tsx` | Clickable count badges for Overview |
| `src/components/insights/InsightSkeleton.tsx` | Skeleton loading state for feed items |
| `src/components/insights/index.ts` | Barrel export |
| `src/hooks/admin/useInsightFeed.ts` | React Query hook for enriched insights + feed transformation |
| `shared/types/insights.ts` | FeedInsight, FeedAction, EnrichedInsight, SummaryCount types |
| `tests/unit/insight-enrichment.test.ts` | Unit tests for enrichment logic |
| `tests/unit/insight-feed-transform.test.ts` | Unit tests for raw insight → FeedInsight transformation |
| `tests/component/InsightFeed.test.tsx` | Component tests for InsightFeed rendering |

### Modified Files
| File | Changes |
|------|---------|
| `shared/types/analytics.ts:177-184` | Add new InsightType values, keep backward compat |
| `server/analytics-intelligence.ts:198-240,552-779` | Remove content decay computation, add new insight types (ranking_mover, ctr_opportunity, serp_opportunity), call enrichment |
| `server/analytics-insights-store.ts:54-79` | Extend UpsertInsightParams with enrichment fields |
| `server/routes/public-analytics.ts:53-65` | Return enriched fields in API response |
| `src/hooks/admin/useAnalyticsOverview.ts:56-73` | Add pageviews, CTR, position to trendData |
| `src/components/charts/AnnotatedTrendChart.tsx:33-40` | Add toggleableLines prop, onToggleLine callback, line chips UI |
| `src/components/AnalyticsOverview.tsx` | Restructure to Insights/Metrics sub-tabs, replace InsightCards with InsightFeed |
| `src/components/SearchDetail.tsx:15,161-168` | Add Search Insights sub-tab as default, add AnnotatedTrendChart |
| `src/components/TrafficDetail.tsx:15,139-147` | Rename Overview→Breakdown, make Insights default, replace TrendChart with AnnotatedTrendChart |
| `src/lib/queryKeys.ts` | Add `admin.insightFeed` key |

---

## Task 1: Database Migration — Enrichment Columns + New Types

**Files:**
- Create: `server/db/migrations/038-intelligence-enrichment.sql`
- Modify: `shared/types/analytics.ts:177-186`

- [ ] **Step 1: Write the migration SQL**

```sql
-- 038-intelligence-enrichment.sql
-- Add enrichment columns to analytics_insights
ALTER TABLE analytics_insights ADD COLUMN page_title TEXT;
ALTER TABLE analytics_insights ADD COLUMN strategy_keyword TEXT;
ALTER TABLE analytics_insights ADD COLUMN strategy_alignment TEXT;
ALTER TABLE analytics_insights ADD COLUMN audit_issues TEXT;
ALTER TABLE analytics_insights ADD COLUMN pipeline_status TEXT;
ALTER TABLE analytics_insights ADD COLUMN anomaly_linked INTEGER DEFAULT 0;
ALTER TABLE analytics_insights ADD COLUMN impact_score REAL DEFAULT 0;
ALTER TABLE analytics_insights ADD COLUMN domain TEXT DEFAULT 'cross';

-- Rename quick_win → ranking_opportunity in existing rows
UPDATE analytics_insights SET insight_type = 'ranking_opportunity' WHERE insight_type = 'quick_win';
```

Save to `server/db/migrations/038-intelligence-enrichment.sql`.

- [ ] **Step 2: Update InsightType in shared types**

In `shared/types/analytics.ts`, replace the InsightType definition (lines 177–184) with:

```typescript
export type InsightType =
  | 'page_health'
  | 'ranking_opportunity'    // renamed from quick_win
  | 'content_decay'
  | 'cannibalization'
  | 'keyword_cluster'
  | 'competitor_gap'
  | 'conversion_attribution'
  | 'ranking_mover'          // new: position changes
  | 'ctr_opportunity'        // new: high-impression low-CTR
  | 'serp_opportunity'       // new: rich result eligible
  | 'strategy_alignment'     // new: strategy vs reality
  | 'anomaly_digest';        // new: surfaced anomalies

export type InsightDomain = 'search' | 'traffic' | 'cross';
```

- [ ] **Step 3: Add EnrichedInsight fields to AnalyticsInsight**

In `shared/types/analytics.ts`, extend the AnalyticsInsight interface (lines 188–196) to include the enrichment columns:

```typescript
export interface AnalyticsInsight {
  id: string;
  workspaceId: string;
  pageId: string | null;
  insightType: InsightType;
  data: Record<string, unknown>;
  severity: InsightSeverity;
  computedAt: string;
  // Enrichment fields (Phase 1)
  pageTitle?: string | null;
  strategyKeyword?: string | null;
  strategyAlignment?: 'aligned' | 'misaligned' | 'untracked' | null;
  auditIssues?: string | null;        // JSON array string
  pipelineStatus?: 'brief_exists' | 'in_progress' | 'published' | null;
  anomalyLinked?: boolean;
  impactScore?: number;
  domain?: InsightDomain;
}
```

- [ ] **Step 4: Verify migration runs**

Run: `npm run dev:server` — the server auto-runs pending migrations on startup. Check logs for `Migration 038-intelligence-enrichment.sql applied`.

If the dev server is already running, restart it.

- [ ] **Step 5: Verify build**

Run: `npx tsc --noEmit --skipLibCheck && npx vite build`

- [ ] **Step 6: Commit**

```bash
git add server/db/migrations/038-intelligence-enrichment.sql shared/types/analytics.ts
git commit -m "feat: add enrichment columns and new insight types to analytics_insights

Migration 038: page_title, strategy_keyword, strategy_alignment,
audit_issues, pipeline_status, anomaly_linked, impact_score, domain.
Renames quick_win → ranking_opportunity.
Adds InsightType values: ranking_mover, ctr_opportunity, serp_opportunity,
strategy_alignment, anomaly_digest."
```

---

## Task 2: Shared Types — FeedInsight + FeedAction

**Files:**
- Create: `shared/types/insights.ts`

- [ ] **Step 1: Create the FeedInsight types**

```typescript
// shared/types/insights.ts
import type { InsightType, InsightSeverity, InsightDomain } from './analytics.js';

/** A single item in the priority feed — transformed from AnalyticsInsight for display */
export interface FeedInsight {
  id: string;
  type: InsightType;
  severity: InsightSeverity;
  title: string;            // page title, not URL
  headline: string;         // "dropped to page 2", "CTR 1.2% vs 4.8% expected"
  context: string;          // "Position 4 → 11 · Lost ~2,400 clicks/mo · Strategy keyword match"
  pageUrl?: string;         // for drill-down navigation
  domain: InsightDomain;    // for tab filtering
  impactScore: number;      // for ranking (higher = show first)
  actions?: FeedAction[];   // "View in Strategy", "Create Brief", etc.
}

export interface FeedAction {
  label: string;            // "View in Strategy", "Create Brief", "View Audit"
  tab: string;              // navigation target (Page type)
  icon?: string;            // lucide icon name
}

/** Summary counts for the pill badges on Overview */
export interface SummaryCount {
  label: string;
  count: number;
  color: string;            // tailwind color name: 'red', 'amber', 'green', 'blue', 'purple'
  filterKey: string;        // used to filter feed when pill is clicked
}
```

- [ ] **Step 2: Export from shared/types barrel**

Check if `shared/types/index.ts` exists. If so, add `export * from './insights.js';`. If there's no barrel file, skip this step — the types will be imported directly.

- [ ] **Step 3: Verify build**

Run: `npx tsc --noEmit --skipLibCheck && npx vite build`

- [ ] **Step 4: Commit**

```bash
git add shared/types/insights.ts
git commit -m "feat: add FeedInsight, FeedAction, SummaryCount types"
```

---

## Task 3: Insight Enrichment Module

**Files:**
- Create: `server/insight-enrichment.ts`
- Create: `tests/unit/insight-enrichment.test.ts`

This is the core new backend module. It resolves page titles, checks strategy alignment, links audit issues, checks pipeline status, and computes impact scores.

- [ ] **Step 1: Write the enrichment test**

```typescript
// tests/unit/insight-enrichment.test.ts
import { describe, it, expect } from 'vitest';
import {
  resolvePageTitle,
  computeImpactScore,
  classifyDomain,
  cleanSlugToTitle,
} from '../../server/insight-enrichment.js';

describe('insight-enrichment', () => {
  describe('cleanSlugToTitle', () => {
    it('converts a slug to a readable title', () => {
      expect(cleanSlugToTitle('/blog/best-ai-coding-agents')).toBe('Best AI Coding Agents');
    });

    it('handles nested paths', () => {
      expect(cleanSlugToTitle('/docs/getting-started/installation')).toBe('Installation');
    });

    it('handles URLs with domain', () => {
      expect(cleanSlugToTitle('https://example.com/blog/my-post')).toBe('My Post');
    });

    it('returns empty string for root path', () => {
      expect(cleanSlugToTitle('/')).toBe('Home');
    });
  });

  describe('classifyDomain', () => {
    it('classifies GSC-only insight types as search', () => {
      expect(classifyDomain('ranking_mover')).toBe('search');
      expect(classifyDomain('ctr_opportunity')).toBe('search');
      expect(classifyDomain('ranking_opportunity')).toBe('search');
      expect(classifyDomain('serp_opportunity')).toBe('search');
      expect(classifyDomain('cannibalization')).toBe('search');
    });

    it('classifies GA4-centric types as traffic', () => {
      expect(classifyDomain('conversion_attribution')).toBe('traffic');
    });

    it('classifies mixed types as cross', () => {
      expect(classifyDomain('page_health')).toBe('cross');
      expect(classifyDomain('content_decay')).toBe('cross');
      expect(classifyDomain('keyword_cluster')).toBe('cross');
      expect(classifyDomain('competitor_gap')).toBe('cross');
      expect(classifyDomain('strategy_alignment')).toBe('cross');
      expect(classifyDomain('anomaly_digest')).toBe('cross');
    });
  });

  describe('computeImpactScore', () => {
    it('scores critical severity highest', () => {
      const critical = computeImpactScore('critical', { clicks: 100 });
      const warning = computeImpactScore('warning', { clicks: 100 });
      expect(critical).toBeGreaterThan(warning);
    });

    it('factors in traffic volume', () => {
      const highTraffic = computeImpactScore('warning', { clicks: 10000 });
      const lowTraffic = computeImpactScore('warning', { clicks: 10 });
      expect(highTraffic).toBeGreaterThan(lowTraffic);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/insight-enrichment.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement the enrichment module**

```typescript
// server/insight-enrichment.ts
import type { InsightType, InsightSeverity, InsightDomain, AnalyticsInsight } from '../shared/types/analytics.js';
import { listPageKeywords } from './db/page-keywords.js';
import { getWorkspace } from './db/workspaces.js';
import { listSnapshots } from './reports.js';
import { loadDecayAnalysis } from './content-decay.js';
import { createLogger } from './logger.js';

const log = createLogger('insight-enrichment');

// ── Page title resolution ──

/** Clean a URL slug into a human-readable title */
export function cleanSlugToTitle(urlOrPath: string): string {
  try {
    // Strip domain if present
    let path = urlOrPath;
    if (path.startsWith('http')) {
      path = new URL(path).pathname;
    }
    // Get last segment
    const segments = path.split('/').filter(Boolean);
    if (segments.length === 0) return 'Home';
    const last = segments[segments.length - 1];
    // Convert kebab-case to Title Case
    return last
      .replace(/[-_]/g, ' ')
      .replace(/\b\w/g, c => c.toUpperCase())
      .trim();
  } catch {
    return urlOrPath;
  }
}

/** Build a lookup map of URL → page title for a workspace */
export function buildPageTitleMap(workspaceId: string): Map<string, string> {
  const map = new Map<string, string>();
  try {
    const pageKeywords = listPageKeywords(workspaceId);
    for (const pk of pageKeywords) {
      if (pk.pageTitle && pk.pagePath) {
        map.set(pk.pagePath, pk.pageTitle);
        // Also map full URL variants
        if (!pk.pagePath.startsWith('http')) {
          map.set(`https://${pk.pagePath}`, pk.pageTitle);
        }
      }
    }
  } catch (e) {
    log.warn({ err: e, workspaceId }, 'Failed to build page title map');
  }
  return map;
}

/** Resolve a page title from multiple sources */
export function resolvePageTitle(
  pageId: string | null,
  titleMap: Map<string, string>,
): string {
  if (!pageId) return 'Workspace-level';

  // 1. Check page_keywords table
  const fromKeywords = titleMap.get(pageId);
  if (fromKeywords) return fromKeywords;

  // 2. Try matching just the path portion
  try {
    const path = pageId.startsWith('http') ? new URL(pageId).pathname : pageId;
    const fromPath = titleMap.get(path);
    if (fromPath) return fromPath;
  } catch { /* not a URL */ }

  // 3. Clean slug fallback
  return cleanSlugToTitle(pageId);
}

// ── Domain classification ──

const SEARCH_TYPES = new Set<InsightType>([
  'ranking_mover', 'ctr_opportunity', 'ranking_opportunity',
  'serp_opportunity', 'cannibalization',
]);

const TRAFFIC_TYPES = new Set<InsightType>([
  'conversion_attribution',
]);

export function classifyDomain(type: InsightType): InsightDomain {
  if (SEARCH_TYPES.has(type)) return 'search';
  if (TRAFFIC_TYPES.has(type)) return 'traffic';
  return 'cross';
}

// ── Impact scoring ──

const SEVERITY_WEIGHTS: Record<InsightSeverity, number> = {
  critical: 100,
  warning: 60,
  opportunity: 40,
  positive: 20,
};

export function computeImpactScore(
  severity: InsightSeverity,
  data: Record<string, unknown>,
): number {
  const base = SEVERITY_WEIGHTS[severity] ?? 30;
  // Factor in traffic volume (clicks or impressions or users)
  const traffic = Number(data.clicks ?? data.impressions ?? data.users ?? data.pageviews ?? 0);
  const trafficBonus = Math.min(Math.log10(Math.max(traffic, 1)) * 10, 50);
  return Math.round((base + trafficBonus) * 10) / 10;
}

// ── Strategy alignment ──

export interface StrategyPageMap {
  pagePath: string;
  primaryKeyword: string;
  secondaryKeywords?: string[];
}

export function checkStrategyAlignment(
  pageId: string | null,
  strategyPageMap: StrategyPageMap[],
): { keyword: string | null; alignment: 'aligned' | 'misaligned' | 'untracked' } {
  if (!pageId || strategyPageMap.length === 0) {
    return { keyword: null, alignment: 'untracked' };
  }

  // Normalize the pageId to a path for matching
  let path = pageId;
  try {
    if (path.startsWith('http')) path = new URL(path).pathname;
  } catch { /* use as-is */ }

  const match = strategyPageMap.find(p => {
    const stratPath = p.pagePath.startsWith('http')
      ? new URL(p.pagePath).pathname
      : p.pagePath;
    return stratPath === path || path.endsWith(stratPath) || stratPath.endsWith(path);
  });

  if (!match) return { keyword: null, alignment: 'untracked' };
  return { keyword: match.primaryKeyword, alignment: 'aligned' };
}

// ── Pipeline status ──

export function checkPipelineStatus(
  pageId: string | null,
  briefs: Array<{ targetUrl?: string; status: string }>,
  posts: Array<{ publishedSlug?: string; status: string }>,
): 'brief_exists' | 'in_progress' | 'published' | null {
  if (!pageId) return null;

  let path = pageId;
  try {
    if (path.startsWith('http')) path = new URL(path).pathname;
  } catch { /* use as-is */ }

  // Check published posts first
  const published = posts.find(p =>
    p.publishedSlug && (p.publishedSlug === path || path.endsWith(p.publishedSlug))
  );
  if (published) return 'published';

  // Check in-progress briefs
  const brief = briefs.find(b =>
    b.targetUrl && (b.targetUrl === path || path.endsWith(b.targetUrl) || b.targetUrl.endsWith(path))
  );
  if (brief) {
    return brief.status === 'in_progress' ? 'in_progress' : 'brief_exists';
  }

  return null;
}

// ── Batch enrichment ──

export interface EnrichmentContext {
  titleMap: Map<string, string>;
  strategyPageMap: StrategyPageMap[];
  briefs: Array<{ targetUrl?: string; status: string }>;
  posts: Array<{ publishedSlug?: string; status: string }>;
}

/** Build the enrichment context for a workspace (call once per computation cycle) */
export async function buildEnrichmentContext(workspaceId: string): Promise<EnrichmentContext> {
  const titleMap = buildPageTitleMap(workspaceId);

  let strategyPageMap: StrategyPageMap[] = [];
  try {
    const ws = getWorkspace(workspaceId);
    if (ws?.keywordStrategy) {
      const strategy = typeof ws.keywordStrategy === 'string'
        ? JSON.parse(ws.keywordStrategy)
        : ws.keywordStrategy;
      strategyPageMap = strategy.pageMap ?? [];
    }
  } catch (e) {
    log.warn({ err: e, workspaceId }, 'Failed to load strategy for enrichment');
  }

  // Briefs and posts — load from DB
  // These will be loaded via lazy imports to avoid circular deps
  let briefs: Array<{ targetUrl?: string; status: string }> = [];
  let posts: Array<{ publishedSlug?: string; status: string }> = [];
  try {
    const { listBriefs } = await import('./db/content-briefs.js');
    const { listPosts } = await import('./db/content-posts.js');
    briefs = listBriefs(workspaceId).map(b => ({
      targetUrl: b.targetUrl ?? undefined,
      status: b.status,
    }));
    posts = listPosts(workspaceId).map(p => ({
      publishedSlug: p.publishedSlug ?? undefined,
      status: p.status,
    }));
  } catch (e) {
    log.warn({ err: e, workspaceId }, 'Failed to load pipeline data for enrichment');
  }

  return { titleMap, strategyPageMap, briefs, posts };
}

/** Enrich a single insight with all context */
export function enrichInsight(
  insight: AnalyticsInsight,
  ctx: EnrichmentContext,
): Partial<AnalyticsInsight> {
  const pageTitle = resolvePageTitle(insight.pageId, ctx.titleMap);
  const { keyword, alignment } = checkStrategyAlignment(insight.pageId, ctx.strategyPageMap);
  const pipelineStatus = checkPipelineStatus(insight.pageId, ctx.briefs, ctx.posts);
  const domain = classifyDomain(insight.insightType);
  const impactScore = computeImpactScore(insight.severity, insight.data);

  return {
    pageTitle,
    strategyKeyword: keyword,
    strategyAlignment: alignment,
    pipelineStatus,
    domain,
    impactScore,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/insight-enrichment.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Verify build**

Run: `npx tsc --noEmit --skipLibCheck && npx vite build`

- [ ] **Step 6: Commit**

```bash
git add server/insight-enrichment.ts tests/unit/insight-enrichment.test.ts
git commit -m "feat: add insight enrichment module

Resolves page titles (page_keywords → cleaned slug fallback),
checks strategy alignment, pipeline status, domain classification,
and impact scoring. Includes unit tests."
```

---

## Task 4: Update Insights Store + API

**Files:**
- Modify: `server/analytics-insights-store.ts:54-79`
- Modify: `server/routes/public-analytics.ts:53-65`

- [ ] **Step 1: Extend UpsertInsightParams**

In `server/analytics-insights-store.ts`, update the `UpsertInsightParams` interface and the `upsertInsight` function to accept and persist the new enrichment columns. Read the file first to understand the exact current structure, then add the new fields to the INSERT statement and the params interface.

The new fields to add to UpsertInsightParams:
```typescript
pageTitle?: string | null;
strategyKeyword?: string | null;
strategyAlignment?: string | null;
auditIssues?: string | null;
pipelineStatus?: string | null;
anomalyLinked?: boolean;
impactScore?: number;
domain?: string;
```

Update the prepared statement to INSERT these columns. Use `?? null` for optional fields and `?? 0` for impactScore.

- [ ] **Step 2: Update the row-to-object mapper**

The `rowToInsight()` or equivalent mapper function needs to include the new columns when reading from the database. Map `anomaly_linked` (INTEGER) to boolean. Parse `audit_issues` as JSON string (keep as string — parsed on frontend).

- [ ] **Step 3: Update the public API response**

In `server/routes/public-analytics.ts`, the insights endpoint already returns `AnalyticsInsight[]` directly from the store. Since the store now includes enrichment fields, no route changes should be needed — verify that the response shape matches the updated `AnalyticsInsight` interface.

- [ ] **Step 4: Verify build**

Run: `npx tsc --noEmit --skipLibCheck && npx vite build`

- [ ] **Step 5: Run existing tests**

Run: `npx vitest run tests/unit/analytics-insights-store.test.ts`
Expected: All existing tests still PASS

- [ ] **Step 6: Commit**

```bash
git add server/analytics-insights-store.ts server/routes/public-analytics.ts
git commit -m "feat: extend insights store with enrichment columns

UpsertInsightParams now accepts pageTitle, strategyKeyword,
strategyAlignment, auditIssues, pipelineStatus, anomalyLinked,
impactScore, domain. API response includes all enrichment fields."
```

---

## Task 5: Engine — New Insight Types + Enrichment Integration

**Files:**
- Modify: `server/analytics-intelligence.ts`

This is the core engine task. It adds the 3 new computation functions (ranking_mover, ctr_opportunity, serp_opportunity), removes the duplicate content decay computation, renames quick_win references, and integrates the enrichment module.

- [ ] **Step 1: Add computeRankingMovers function**

Add after the existing compute functions (around line 290):

```typescript
/** Detect queries/pages with significant position changes */
function computeRankingMovers(
  currentQueryPages: QueryPageRow[],
  previousQueryPages: QueryPageRow[],
): Array<{ insightType: 'ranking_mover'; pageId: string; data: Record<string, unknown>; severity: InsightSeverity }> {
  const results: Array<{ insightType: 'ranking_mover'; pageId: string; data: Record<string, unknown>; severity: InsightSeverity }> = [];

  // Build lookup of previous positions by query+page
  const prevMap = new Map<string, QueryPageRow>();
  for (const row of previousQueryPages) {
    prevMap.set(`${row.query}::${row.page}`, row);
  }

  for (const curr of currentQueryPages) {
    const key = `${curr.query}::${curr.page}`;
    const prev = prevMap.get(key);
    if (!prev) continue;

    const positionChange = prev.position - curr.position; // positive = improved
    if (Math.abs(positionChange) < 3) continue; // Only flag significant changes

    const severity: InsightSeverity = positionChange < -5 ? 'critical'
      : positionChange < -3 ? 'warning'
      : positionChange > 5 ? 'positive'
      : 'opportunity';

    results.push({
      insightType: 'ranking_mover',
      pageId: curr.page,
      data: {
        query: curr.query,
        pageUrl: curr.page,
        currentPosition: Math.round(curr.position * 10) / 10,
        previousPosition: Math.round(prev.position * 10) / 10,
        positionChange: Math.round(positionChange * 10) / 10,
        currentClicks: curr.clicks,
        previousClicks: prev.clicks,
        impressions: curr.impressions,
      },
      severity,
    });
  }

  // Sort by absolute position change * impressions (most impactful first), cap at 30
  return results
    .sort((a, b) => {
      const aImpact = Math.abs(a.data.positionChange as number) * (a.data.impressions as number);
      const bImpact = Math.abs(b.data.positionChange as number) * (b.data.impressions as number);
      return bImpact - aImpact;
    })
    .slice(0, 30);
}
```

- [ ] **Step 2: Add computeCtrOpportunities function**

```typescript
/** Find high-impression queries with CTR below expected for their position */
function computeCtrOpportunities(
  queryPages: QueryPageRow[],
): Array<{ insightType: 'ctr_opportunity'; pageId: string; data: Record<string, unknown>; severity: InsightSeverity }> {
  const results: Array<{ insightType: 'ctr_opportunity'; pageId: string; data: Record<string, unknown>; severity: InsightSeverity }> = [];

  for (const qp of queryPages) {
    if (qp.impressions < 100) continue;
    const pos = Math.round(qp.position);
    if (pos < 1 || pos > 10) continue; // Only check page 1 positions

    const expectedCtr = EXPECTED_CTR_BY_POSITION[pos] ?? 0.02;
    const actualCtr = qp.ctr ?? (qp.clicks / qp.impressions);
    if (actualCtr >= expectedCtr * 0.7) continue; // Only flag if significantly below expected

    const estimatedClickGain = Math.round(qp.impressions * (expectedCtr - actualCtr));

    results.push({
      insightType: 'ctr_opportunity',
      pageId: qp.page,
      data: {
        query: qp.query,
        pageUrl: qp.page,
        currentPosition: Math.round(qp.position * 10) / 10,
        actualCtr: Math.round(actualCtr * 1000) / 10, // as percentage
        expectedCtr: Math.round(expectedCtr * 1000) / 10,
        impressions: qp.impressions,
        estimatedClickGain,
      },
      severity: estimatedClickGain > 1000 ? 'critical'
        : estimatedClickGain > 200 ? 'warning'
        : 'opportunity',
    });
  }

  return results
    .sort((a, b) => (b.data.estimatedClickGain as number) - (a.data.estimatedClickGain as number))
    .slice(0, 20);
}
```

- [ ] **Step 3: Add computeSerpOpportunities function**

```typescript
/** Find high-traffic pages that could benefit from schema markup */
function computeSerpOpportunities(
  gscPages: Array<{ page: string; clicks: number; impressions: number }>,
  schemaPages: Set<string>,  // pages that already have schema
): Array<{ insightType: 'serp_opportunity'; pageId: string; data: Record<string, unknown>; severity: InsightSeverity }> {
  const results: Array<{ insightType: 'serp_opportunity'; pageId: string; data: Record<string, unknown>; severity: InsightSeverity }> = [];

  for (const page of gscPages) {
    if (page.impressions < 500) continue;

    // Check if page already has schema
    const hasSchema = schemaPages.has(page.page) || schemaPages.has(new URL(page.page).pathname);
    if (hasSchema) continue;

    results.push({
      insightType: 'serp_opportunity',
      pageId: page.page,
      data: {
        pageUrl: page.page,
        impressions: page.impressions,
        clicks: page.clicks,
        reason: 'No structured data detected — adding schema could improve rich result eligibility',
      },
      severity: page.impressions > 10000 ? 'warning' : 'opportunity',
    });
  }

  return results
    .sort((a, b) => (b.data.impressions as number) - (a.data.impressions as number))
    .slice(0, 20);
}
```

- [ ] **Step 4: Update computeAndPersistInsights orchestrator**

In `computeAndPersistInsights()` (line 586+):

1. Import and call `buildEnrichmentContext()` at the start
2. Remove the `computeContentDecayInsights()` call — replace with delegation to `loadDecayAnalysis()` from content-decay.ts, mapping results into insight format
3. Rename all references from `quick_win` to `ranking_opportunity`
4. Add calls to the 3 new compute functions
5. After all insights are computed, run enrichment on each before upserting
6. Load schema page data for SERP opportunities (try/catch, graceful if unavailable)

The key changes to the orchestrator:

```typescript
// At top of computeAndPersistInsights:
const enrichCtx = await buildEnrichmentContext(workspaceId);

// After computing each insight batch, before upserting:
for (const insight of pageHealthInsights) {
  const enrichment = enrichInsight(
    { ...insight, workspaceId, insightType: insight.insightType } as AnalyticsInsight,
    enrichCtx,
  );
  upsertInsight({
    workspaceId,
    pageId: insight.pageId,
    insightType: insight.insightType,
    data: insight.data,
    severity: insight.severity,
    ...enrichment,
  });
}
```

Apply this pattern to ALL insight batches (page_health, ranking_opportunity, content_decay delegation, cannibalization, ranking_mover, ctr_opportunity, serp_opportunity, keyword_cluster, competitor_gap, conversion_attribution).

- [ ] **Step 5: Content decay delegation**

Replace the `computeContentDecayInsights()` call with:

```typescript
// Delegate content decay to the standalone engine
try {
  const decayAnalysis = loadDecayAnalysis(workspaceId);
  if (decayAnalysis?.decayingPages) {
    for (const page of decayAnalysis.decayingPages) {
      const severity: InsightSeverity = page.severity === 'critical' ? 'critical'
        : page.severity === 'warning' ? 'warning' : 'opportunity';
      const enrichment = enrichInsight(
        { pageId: page.url, insightType: 'content_decay', severity, data: page, workspaceId } as AnalyticsInsight,
        enrichCtx,
      );
      upsertInsight({
        workspaceId,
        pageId: page.url,
        insightType: 'content_decay',
        data: { ...page },
        severity,
        ...enrichment,
      });
    }
  }
} catch (e) {
  log.warn({ err: e, workspaceId }, 'Content decay delegation failed, skipping');
}
```

- [ ] **Step 6: Verify build + tests**

Run: `npx tsc --noEmit --skipLibCheck && npx vite build`
Run: `npx vitest run`

- [ ] **Step 7: Commit**

```bash
git add server/analytics-intelligence.ts server/insight-enrichment.ts
git commit -m "feat: add ranking_mover, ctr_opportunity, serp_opportunity computations

Integrates enrichment module into computation cycle. Delegates content
decay to standalone engine. Renames quick_win → ranking_opportunity.
All insights now enriched with page titles, strategy alignment,
pipeline status, domain classification, and impact scores."
```

---

## Task 6: Frontend — useInsightFeed Hook + Transform

**Files:**
- Create: `src/hooks/admin/useInsightFeed.ts`
- Create: `tests/unit/insight-feed-transform.test.ts`
- Modify: `src/lib/queryKeys.ts`

- [ ] **Step 1: Add query key**

In `src/lib/queryKeys.ts`, add inside the admin section:

```typescript
insightFeed: (wsId: string) => ['admin-insight-feed', wsId] as const,
```

- [ ] **Step 2: Write the transform test**

```typescript
// tests/unit/insight-feed-transform.test.ts
import { describe, it, expect } from 'vitest';
import { transformToFeedInsight, computeSummaryCounts } from '../../src/hooks/admin/useInsightFeed.js';
import type { AnalyticsInsight } from '../../shared/types/analytics.js';

const mockInsight = (overrides: Partial<AnalyticsInsight> = {}): AnalyticsInsight => ({
  id: 'test-1',
  workspaceId: 'ws-1',
  pageId: 'https://example.com/blog/seo-tips',
  insightType: 'ranking_mover',
  data: {
    query: 'seo tips',
    currentPosition: 3,
    previousPosition: 8,
    positionChange: 5,
    impressions: 50000,
    currentClicks: 2400,
  },
  severity: 'positive',
  computedAt: new Date().toISOString(),
  pageTitle: 'SEO Tips for 2026',
  domain: 'search',
  impactScore: 75,
  strategyKeyword: 'seo tips',
  strategyAlignment: 'aligned',
  pipelineStatus: null,
  ...overrides,
});

describe('transformToFeedInsight', () => {
  it('creates a FeedInsight from a ranking_mover insight', () => {
    const feed = transformToFeedInsight(mockInsight());
    expect(feed.title).toBe('SEO Tips for 2026');
    expect(feed.headline).toContain('position 8 → 3');
    expect(feed.domain).toBe('search');
    expect(feed.impactScore).toBe(75);
    expect(feed.severity).toBe('positive');
  });

  it('uses cleaned slug when pageTitle is null', () => {
    const feed = transformToFeedInsight(mockInsight({ pageTitle: null }));
    expect(feed.title).toBe('Seo Tips'); // cleaned from URL path
  });

  it('creates a FeedInsight from a ctr_opportunity', () => {
    const feed = transformToFeedInsight(mockInsight({
      insightType: 'ctr_opportunity',
      severity: 'warning',
      data: {
        query: 'ai coding agents',
        actualCtr: 1.2,
        expectedCtr: 4.8,
        impressions: 3000000,
        estimatedClickGain: 36000,
      },
    }));
    expect(feed.headline).toContain('CTR');
    expect(feed.context).toContain('3,000,000');
  });
});

describe('computeSummaryCounts', () => {
  it('counts insights by severity category', () => {
    const insights = [
      mockInsight({ severity: 'critical' }),
      mockInsight({ severity: 'critical' }),
      mockInsight({ severity: 'warning' }),
      mockInsight({ severity: 'opportunity' }),
      mockInsight({ severity: 'positive' }),
      mockInsight({ severity: 'positive' }),
      mockInsight({ severity: 'positive' }),
    ];
    const counts = computeSummaryCounts(insights.map(transformToFeedInsight));
    const drops = counts.find(c => c.filterKey === 'drops');
    expect(drops?.count).toBe(2); // critical
    const wins = counts.find(c => c.filterKey === 'wins');
    expect(wins?.count).toBe(3); // positive
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run tests/unit/insight-feed-transform.test.ts`
Expected: FAIL — module not found

- [ ] **Step 4: Implement the hook and transforms**

```typescript
// src/hooks/admin/useInsightFeed.ts
import { useQuery } from '@tanstack/react-query';
import { getSafe } from '../../api/client.js';
import { queryKeys } from '../../lib/queryKeys.js';
import type { AnalyticsInsight, InsightDomain } from '../../../shared/types/analytics.js';
import type { FeedInsight, SummaryCount } from '../../../shared/types/insights.js';

// ── Transform: AnalyticsInsight → FeedInsight ──

function cleanSlugToTitle(urlOrPath: string): string {
  try {
    let path = urlOrPath;
    if (path.startsWith('http')) path = new URL(path).pathname;
    const segments = path.split('/').filter(Boolean);
    if (segments.length === 0) return 'Home';
    const last = segments[segments.length - 1];
    return last.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase()).trim();
  } catch { return urlOrPath; }
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
  return String(n);
}

export function transformToFeedInsight(insight: AnalyticsInsight): FeedInsight {
  const d = insight.data;
  const title = insight.pageTitle || (insight.pageId ? cleanSlugToTitle(insight.pageId) : 'Unknown page');
  const domain = (insight.domain as InsightDomain) ?? 'cross';
  const impactScore = insight.impactScore ?? 0;

  let headline = '';
  let context = '';
  const contextParts: string[] = [];

  switch (insight.insightType) {
    case 'ranking_mover': {
      const prev = d.previousPosition as number;
      const curr = d.currentPosition as number;
      const change = d.positionChange as number;
      if (change > 0) {
        headline = `climbed to position ${curr}`;
      } else {
        headline = curr > 10 ? `dropped to page 2` : `fell to position ${curr}`;
      }
      contextParts.push(`Position ${prev} → ${curr}`);
      if (d.currentClicks) contextParts.push(`${formatNumber(d.currentClicks as number)} clicks`);
      if (d.query) contextParts.push(`"${d.query}"`);
      break;
    }
    case 'ctr_opportunity': {
      headline = `CTR ${d.actualCtr}% vs ${d.expectedCtr}% expected`;
      if (d.impressions) contextParts.push(`${formatNumber(d.impressions as number)} impressions`);
      if (d.estimatedClickGain) contextParts.push(`Est. +${formatNumber(d.estimatedClickGain as number)} clicks with optimization`);
      if (d.query) contextParts.push(`"${d.query}"`);
      break;
    }
    case 'ranking_opportunity': {
      const pos = d.currentPosition as number;
      headline = pos <= 11 ? `${Math.ceil(11 - pos)} positions from page 1` : `position ${pos} — optimization candidate`;
      if (d.impressions) contextParts.push(`${formatNumber(d.impressions as number)} impressions`);
      if (d.estimatedTrafficGain) contextParts.push(`Est. +${formatNumber(d.estimatedTrafficGain as number)} clicks`);
      break;
    }
    case 'content_decay': {
      const pct = d.deltaPercent as number;
      headline = `lost ${Math.abs(Math.round(pct))}% traffic`;
      if (d.baselineClicks) contextParts.push(`${formatNumber(d.baselineClicks as number)} → ${formatNumber(d.currentClicks as number)} clicks`);
      break;
    }
    case 'page_health': {
      const score = d.score as number;
      headline = score >= 70 ? `health score ${score}` : `health score ${score} — needs attention`;
      if (d.clicks) contextParts.push(`${formatNumber(d.clicks as number)} clicks`);
      if (d.position) contextParts.push(`avg pos ${(d.position as number).toFixed(1)}`);
      break;
    }
    case 'serp_opportunity': {
      headline = 'eligible for rich results';
      if (d.impressions) contextParts.push(`${formatNumber(d.impressions as number)} impressions`);
      if (d.reason) contextParts.push(d.reason as string);
      break;
    }
    case 'cannibalization': {
      headline = `${(d.pages as string[])?.length ?? 2} pages competing for same query`;
      if (d.query) contextParts.push(`"${d.query}"`);
      break;
    }
    case 'conversion_attribution': {
      headline = `drove ${formatNumber(d.conversions as number)} conversions`;
      if (d.sessions) contextParts.push(`${formatNumber(d.sessions as number)} sessions`);
      if (d.conversionRate) contextParts.push(`${(d.conversionRate as number).toFixed(1)}% rate`);
      break;
    }
    default: {
      headline = insight.insightType.replace(/_/g, ' ');
    }
  }

  // Add strategy alignment to context
  if (insight.strategyKeyword) {
    contextParts.push(`Strategy: "${insight.strategyKeyword}"`);
  }
  if (insight.pipelineStatus === 'brief_exists') {
    contextParts.push('Brief in pipeline');
  } else if (insight.pipelineStatus === 'in_progress') {
    contextParts.push('Content in progress');
  }

  context = contextParts.join(' · ');

  return {
    id: insight.id,
    type: insight.insightType,
    severity: insight.severity,
    title,
    headline,
    context,
    pageUrl: insight.pageId ?? undefined,
    domain,
    impactScore,
  };
}

// ── Summary counts ──

export function computeSummaryCounts(feed: FeedInsight[]): SummaryCount[] {
  let drops = 0, opportunities = 0, wins = 0;

  for (const item of feed) {
    if (item.severity === 'critical' || item.severity === 'warning') drops++;
    else if (item.severity === 'opportunity') opportunities++;
    else if (item.severity === 'positive') wins++;
  }

  // Content-type counts
  const schemaGaps = feed.filter(f => f.type === 'serp_opportunity').length;
  const decaying = feed.filter(f => f.type === 'content_decay').length;

  return [
    { label: 'drops', count: drops, color: 'red', filterKey: 'drops' },
    { label: 'opportunities', count: opportunities, color: 'amber', filterKey: 'opportunities' },
    { label: 'wins', count: wins, color: 'green', filterKey: 'wins' },
    ...(schemaGaps > 0 ? [{ label: 'schema gaps', count: schemaGaps, color: 'blue', filterKey: 'schema' }] : []),
    ...(decaying > 0 ? [{ label: 'decaying pages', count: decaying, color: 'purple', filterKey: 'decay' }] : []),
  ];
}

// ── Hook ──

export function useInsightFeed(workspaceId: string, enabled = true) {
  const query = useQuery({
    queryKey: queryKeys.admin.insightFeed(workspaceId),
    queryFn: () => getSafe<AnalyticsInsight[]>(`/api/public/insights/${workspaceId}`, []),
    enabled,
    staleTime: 5 * 60 * 1000, // 5 min
    select: (raw) => {
      const insights = Array.isArray(raw) ? raw : [];
      const feed = insights
        .map(transformToFeedInsight)
        .sort((a, b) => b.impactScore - a.impactScore);
      const summary = computeSummaryCounts(feed);
      return { feed, summary };
    },
  });

  return {
    feed: query.data?.feed ?? [],
    summary: query.data?.summary ?? [],
    isLoading: query.isLoading,
    error: query.error,
  };
}
```

- [ ] **Step 5: Run tests**

Run: `npx vitest run tests/unit/insight-feed-transform.test.ts`
Expected: All tests PASS

- [ ] **Step 6: Verify build**

Run: `npx tsc --noEmit --skipLibCheck && npx vite build`

- [ ] **Step 7: Commit**

```bash
git add src/hooks/admin/useInsightFeed.ts tests/unit/insight-feed-transform.test.ts src/lib/queryKeys.ts
git commit -m "feat: add useInsightFeed hook with transform and summary counts

Transforms raw AnalyticsInsight[] into FeedInsight[] with human-readable
headlines, context lines, and impact-ranked sorting. Includes summary
count computation for pill badges. Unit tested."
```

---

## Task 7: Frontend — InsightFeed Components

**Files:**
- Create: `src/components/insights/InsightFeedItem.tsx`
- Create: `src/components/insights/InsightSkeleton.tsx`
- Create: `src/components/insights/SummaryPills.tsx`
- Create: `src/components/insights/InsightFeed.tsx`
- Create: `src/components/insights/index.ts`

- [ ] **Step 1: Create InsightFeedItem**

```typescript
// src/components/insights/InsightFeedItem.tsx
import { AlertTriangle, TrendingUp, TrendingDown, Target, Zap, Search, Eye } from 'lucide-react';
import type { FeedInsight } from '../../../shared/types/insights.js';

const SEVERITY_CONFIG = {
  critical: { icon: TrendingDown, bg: 'bg-red-500/10', text: 'text-red-400', badge: 'Critical' },
  warning: { icon: AlertTriangle, bg: 'bg-amber-500/10', text: 'text-amber-400', badge: 'Warning' },
  opportunity: { icon: Target, bg: 'bg-blue-500/10', text: 'text-blue-400', badge: 'Opportunity' },
  positive: { icon: TrendingUp, bg: 'bg-emerald-500/10', text: 'text-emerald-400', badge: 'Win' },
} as const;

export function InsightFeedItem({ insight }: { insight: FeedInsight }) {
  const config = SEVERITY_CONFIG[insight.severity];
  const Icon = config.icon;

  return (
    <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg px-3 py-2.5 flex items-center gap-3">
      <div className={`w-7 h-7 rounded-md flex items-center justify-center flex-shrink-0 ${config.bg}`}>
        <Icon className={`w-3.5 h-3.5 ${config.text}`} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-xs text-zinc-200 font-medium truncate">
          {insight.title} <span className="text-zinc-500 font-normal">— {insight.headline}</span>
        </div>
        {insight.context && (
          <div className="text-[11px] text-zinc-500 truncate mt-0.5">{insight.context}</div>
        )}
      </div>
      <span className={`px-2 py-0.5 rounded text-[9px] font-medium flex-shrink-0 ${config.bg} ${config.text}`}>
        {config.badge}
      </span>
    </div>
  );
}
```

- [ ] **Step 2: Create InsightSkeleton**

```typescript
// src/components/insights/InsightSkeleton.tsx
import { Skeleton } from '../ui';

export function InsightSkeleton({ count = 5 }: { count?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="bg-zinc-900/50 border border-zinc-800 rounded-lg px-3 py-2.5 flex items-center gap-3">
          <Skeleton className="w-7 h-7 rounded-md flex-shrink-0" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-3.5 w-3/4" />
            <Skeleton className="h-3 w-1/2" />
          </div>
          <Skeleton className="h-5 w-16 rounded flex-shrink-0" />
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Create SummaryPills**

```typescript
// src/components/insights/SummaryPills.tsx
import { useState } from 'react';
import type { SummaryCount } from '../../../shared/types/insights.js';
import { Skeleton } from '../ui';

const PILL_COLORS: Record<string, { dot: string; activeBg: string }> = {
  red: { dot: 'bg-red-400', activeBg: 'bg-red-500/15 border-red-500/30' },
  amber: { dot: 'bg-amber-400', activeBg: 'bg-amber-500/15 border-amber-500/30' },
  green: { dot: 'bg-emerald-400', activeBg: 'bg-emerald-500/15 border-emerald-500/30' },
  blue: { dot: 'bg-blue-400', activeBg: 'bg-blue-500/15 border-blue-500/30' },
  purple: { dot: 'bg-purple-400', activeBg: 'bg-purple-500/15 border-purple-500/30' },
};

interface SummaryPillsProps {
  counts: SummaryCount[];
  activeFilter: string | null;
  onFilter: (filterKey: string | null) => void;
  loading?: boolean;
}

export function SummaryPills({ counts, activeFilter, onFilter, loading }: SummaryPillsProps) {
  if (loading) {
    return (
      <div className="flex gap-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-8 w-28 rounded-lg" />
        ))}
      </div>
    );
  }

  return (
    <div className="flex gap-2 flex-wrap">
      {counts.map(pill => {
        const colors = PILL_COLORS[pill.color] ?? PILL_COLORS.blue;
        const isActive = activeFilter === pill.filterKey;
        return (
          <button
            key={pill.filterKey}
            onClick={() => onFilter(isActive ? null : pill.filterKey)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs transition-all border ${
              isActive
                ? colors.activeBg
                : 'bg-zinc-800/50 border-zinc-800 hover:border-zinc-700'
            }`}
          >
            <span className={`w-2 h-2 rounded-full ${colors.dot}`} />
            <span className="text-zinc-200 font-semibold tabular-nums">{pill.count}</span>
            <span className="text-zinc-500">{pill.label}</span>
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 4: Create InsightFeed**

```typescript
// src/components/insights/InsightFeed.tsx
import { useState } from 'react';
import type { FeedInsight, SummaryCount } from '../../../shared/types/insights.js';
import type { InsightDomain } from '../../../shared/types/analytics.js';
import { InsightFeedItem } from './InsightFeedItem.js';
import { InsightSkeleton } from './InsightSkeleton.js';
import { SummaryPills } from './SummaryPills.js';

interface InsightFeedProps {
  feed: FeedInsight[];
  summary?: SummaryCount[];
  loading?: boolean;
  domain?: InsightDomain;     // filter to a specific domain (for detail tabs)
  limit?: number;             // cap items (for Overview top-5)
  showPills?: boolean;        // show summary pills (Overview only)
  showFilterChips?: boolean;  // show All/Drops/Opportunities/Wins chips (detail tabs)
  onViewAll?: () => void;     // "View all →" callback
}

const FILTER_CHIPS = [
  { key: null, label: 'All' },
  { key: 'drops', label: 'Drops' },
  { key: 'opportunities', label: 'Opportunities' },
  { key: 'wins', label: 'Wins' },
] as const;

export function InsightFeed({
  feed,
  summary,
  loading,
  domain,
  limit,
  showPills,
  showFilterChips,
  onViewAll,
}: InsightFeedProps) {
  const [activeFilter, setActiveFilter] = useState<string | null>(null);

  // Filter by domain
  let filtered = domain ? feed.filter(f => f.domain === domain || f.domain === 'cross') : feed;

  // Filter by severity/type via pills or chips
  if (activeFilter) {
    filtered = filtered.filter(f => {
      if (activeFilter === 'drops') return f.severity === 'critical' || f.severity === 'warning';
      if (activeFilter === 'opportunities') return f.severity === 'opportunity';
      if (activeFilter === 'wins') return f.severity === 'positive';
      if (activeFilter === 'schema') return f.type === 'serp_opportunity';
      if (activeFilter === 'decay') return f.type === 'content_decay';
      return true;
    });
  }

  const totalFiltered = filtered.length;
  const displayed = limit ? filtered.slice(0, limit) : filtered;

  return (
    <div className="space-y-3">
      {/* Summary pills (Overview) */}
      {showPills && summary && (
        <SummaryPills
          counts={summary}
          activeFilter={activeFilter}
          onFilter={setActiveFilter}
          loading={loading}
        />
      )}

      {/* Filter chips (detail tabs) */}
      {showFilterChips && (
        <div className="flex gap-1.5">
          {FILTER_CHIPS.map(chip => (
            <button
              key={chip.key ?? 'all'}
              onClick={() => setActiveFilter(chip.key)}
              className={`px-3 py-1 rounded-md text-[11px] font-medium transition-colors ${
                activeFilter === chip.key
                  ? 'bg-teal-600 text-white'
                  : 'bg-zinc-800/50 text-zinc-400 hover:text-zinc-200'
              }`}
            >
              {chip.label}
            </button>
          ))}
        </div>
      )}

      {/* Feed items or skeleton */}
      {loading ? (
        <InsightSkeleton count={limit ?? 5} />
      ) : displayed.length > 0 ? (
        <div className="space-y-1.5">
          {displayed.map(item => (
            <InsightFeedItem key={item.id} insight={item} />
          ))}
        </div>
      ) : (
        <div className="text-center py-8 text-xs text-zinc-500">
          {activeFilter ? 'No insights match this filter' : 'No insights available yet — check back after analytics sync'}
        </div>
      )}

      {/* View all link */}
      {onViewAll && totalFiltered > (limit ?? Infinity) && (
        <div className="text-center pt-1">
          <button onClick={onViewAll} className="text-[11px] text-teal-400 hover:text-teal-300 transition-colors">
            View all {totalFiltered} insights →
          </button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Create barrel export**

```typescript
// src/components/insights/index.ts
export { InsightFeed } from './InsightFeed.js';
export { InsightFeedItem } from './InsightFeedItem.js';
export { InsightSkeleton } from './InsightSkeleton.js';
export { SummaryPills } from './SummaryPills.js';
```

- [ ] **Step 6: Verify build**

Run: `npx tsc --noEmit --skipLibCheck && npx vite build`

- [ ] **Step 7: Commit**

```bash
git add src/components/insights/
git commit -m "feat: add InsightFeed, InsightFeedItem, SummaryPills, InsightSkeleton

Priority-ranked insight feed with severity icons/badges, clickable
summary pills with filter toggle, skeleton loading states.
Used on all three insight sub-tabs."
```

---

## Task 8: AnnotatedTrendChart — Toggleable Lines

**Files:**
- Modify: `src/components/charts/AnnotatedTrendChart.tsx:26-40,149-267`

- [ ] **Step 1: Extend TrendLine and props interfaces**

In `AnnotatedTrendChart.tsx`, update the interfaces:

```typescript
export interface TrendLine {
  key: string;
  color: string;
  yAxisId: 'left' | 'right';
  label: string;
  active?: boolean;  // whether this line is currently displayed
}

interface AnnotatedTrendChartProps {
  data: Record<string, unknown>[];
  lines: TrendLine[];              // ALL available lines (active + inactive)
  annotations: Annotation[];
  dateKey?: string;
  height?: number;
  onCreateAnnotation?: (date: string, label: string, category: string) => void;
  onToggleLine?: (key: string) => void;  // callback when a line chip is clicked
  maxActiveLines?: number;                // default 3
}
```

- [ ] **Step 2: Add line toggle chips above the chart**

Inside the chart component, add a row of toggleable chips between the title and the chart. Active lines show as solid colored chips, inactive lines show as outline chips. Clicking calls `onToggleLine`. If already at `maxActiveLines`, clicking an inactive chip does nothing (or deselects the least-recently-toggled line — simpler to just prevent).

```typescript
// Line toggle chips (render between chart header and ResponsiveContainer)
{onToggleLine && (
  <div className="flex gap-1 mb-2">
    {lines.map(line => {
      const isActive = line.active !== false;
      const atMax = lines.filter(l => l.active !== false).length >= (maxActiveLines ?? 3);
      return (
        <button
          key={line.key}
          onClick={() => onToggleLine(line.key)}
          disabled={!isActive && atMax}
          className={`px-2 py-0.5 rounded text-[10px] font-medium transition-all ${
            isActive
              ? 'text-white'
              : atMax
                ? 'border text-zinc-600 border-zinc-800 cursor-not-allowed'
                : 'border hover:border-opacity-60'
          }`}
          style={isActive
            ? { backgroundColor: line.color }
            : { borderColor: `${line.color}60`, color: line.color }
          }
        >
          {line.label}
        </button>
      );
    })}
  </div>
)}
```

- [ ] **Step 3: Filter chart rendering to active lines only**

In the chart's `Area` rendering loop, only render lines where `line.active !== false`:

```typescript
{lines.filter(l => l.active !== false).map(line => (
  <Area
    key={line.key}
    type="monotone"
    dataKey={line.key}
    // ... existing props
  />
))}
```

Similarly, conditionally render Y-axes based on whether any active line uses them.

- [ ] **Step 4: Verify build**

Run: `npx tsc --noEmit --skipLibCheck && npx vite build`

- [ ] **Step 5: Commit**

```bash
git add src/components/charts/AnnotatedTrendChart.tsx
git commit -m "feat: add toggleable line chips to AnnotatedTrendChart

Lines have active/inactive state. Solid chip = active, outline = inactive.
Max 3 active lines enforced. onToggleLine callback for parent state mgmt."
```

---

## Task 9: useAnalyticsOverview — Expanded Trend Data

**Files:**
- Modify: `src/hooks/admin/useAnalyticsOverview.ts:56-73`

- [ ] **Step 1: Add pageviews, CTR, and position to trendData**

In the `trendData` assembly (lines 56–73), the current merge only includes `clicks`, `impressions`, `users`, `sessions`. Extend to include `pageviews` from GA4 trend and `ctr`/`position` from GSC trend.

Read the GSC and GA4 trend data shapes first to confirm field availability. GSC trend data includes `ctr` and `position` per day. GA4 trend data includes `pageviews` per day.

Update the merge logic:
```typescript
// In the GSC trend loop:
entry.clicks = row.clicks;
entry.impressions = row.impressions;
entry.ctr = Math.round((row.ctr ?? 0) * 1000) / 10; // as percentage
entry.position = Math.round((row.position ?? 0) * 10) / 10;

// In the GA4 trend loop:
entry.users = row.users;
entry.sessions = row.sessions;
entry.pageviews = row.pageviews;
```

- [ ] **Step 2: Update the return type**

Add the new fields to the `AnalyticsOverviewData` interface's `trendData` type.

- [ ] **Step 3: Verify build**

Run: `npx tsc --noEmit --skipLibCheck && npx vite build`

- [ ] **Step 4: Commit**

```bash
git add src/hooks/admin/useAnalyticsOverview.ts
git commit -m "feat: expand trendData with pageviews, CTR, position

All 6 metrics now available for chart toggles:
clicks, impressions, ctr, position (GSC), users, sessions, pageviews (GA4)."
```

---

## Task 10: Rewire AnalyticsOverview — Insights/Metrics Sub-tabs

**Files:**
- Modify: `src/components/AnalyticsOverview.tsx`

- [ ] **Step 1: Add sub-tab state and imports**

Replace the current single-view layout with Insights/Metrics sub-tabs. Import `InsightFeed`, `useInsightFeed`, `TabBar`. The current StatCards + InsightCards become the "Metrics" sub-tab. The new priority feed + summary pills + chart become the "Insights" sub-tab (default).

```typescript
type SubTab = 'insights' | 'metrics';
const [subTab, setSubTab] = useState<SubTab>('insights');
```

- [ ] **Step 2: Build the Insights sub-tab**

Layout order:
1. `SummaryPills` (from `useInsightFeed` summary data)
2. `InsightFeed` (top 5, showPills, with "View all →" that navigates to relevant detail tab)
3. `AnnotatedTrendChart` with toggleable lines (Clicks + Users default, Impressions + Sessions available)
4. Compact annotations section

Use `useInsightFeed(workspaceId)` for the feed data.

- [ ] **Step 3: Move existing content to Metrics sub-tab**

The current StatCards grid (6 cards) and InsightCards component become the "Metrics" sub-tab content. Keep them exactly as they are but wrap in `{subTab === 'metrics' && (<>...</>)}`.

- [ ] **Step 4: Update TREND_LINES to support toggling**

Replace the static 2-line `TREND_LINES` with a 4-line array where Clicks and Users are active by default:

```typescript
const [activeLines, setActiveLines] = useState<Set<string>>(new Set(['clicks', 'users']));

const ALL_OVERVIEW_LINES: TrendLine[] = [
  { key: 'clicks', color: '#60a5fa', yAxisId: 'left', label: 'Clicks' },
  { key: 'impressions', color: '#8b5cf6', yAxisId: 'left', label: 'Impressions' },
  { key: 'users', color: '#14b8a6', yAxisId: 'right', label: 'Users' },
  { key: 'sessions', color: '#3b82f6', yAxisId: 'right', label: 'Sessions' },
];

const chartLines = ALL_OVERVIEW_LINES
  .filter(l => overview.hasGsc || l.yAxisId !== 'left')
  .filter(l => overview.hasGa4 || l.yAxisId !== 'right')
  .map(l => ({ ...l, active: activeLines.has(l.key) }));

const handleToggleLine = (key: string) => {
  setActiveLines(prev => {
    const next = new Set(prev);
    if (next.has(key)) { next.delete(key); }
    else if (next.size < 3) { next.add(key); }
    return next;
  });
};
```

- [ ] **Step 5: Verify build**

Run: `npx tsc --noEmit --skipLibCheck && npx vite build`

- [ ] **Step 6: Commit**

```bash
git add src/components/AnalyticsOverview.tsx
git commit -m "feat: restructure AnalyticsOverview with Insights/Metrics sub-tabs

Insights (default): summary pills → priority feed (top 5) → toggleable
chart (4 lines, 2 active default) → annotations.
Metrics: existing StatCards + InsightCards."
```

---

## Task 11: Rewire SearchDetail — Add Insights Tab + Chart

**Files:**
- Modify: `src/components/SearchDetail.tsx:15,161-168`

- [ ] **Step 1: Add Search Insights as default sub-tab**

Change the `DataTab` type and tab navigation:

```typescript
type DataTab = 'insights' | 'queries' | 'pages';
const [tab, setTab] = useState<DataTab>('insights');
```

Update the TabBar:
```typescript
<TabBar
  tabs={[
    { id: 'insights', label: 'Search Insights', icon: Target },
    { id: 'queries', label: 'Queries', icon: Search },
    { id: 'pages', label: 'Pages', icon: FileText },
  ]}
  active={tab}
  onChange={id => setTab(id as DataTab)}
/>
```

- [ ] **Step 2: Add InsightFeed for search domain**

```typescript
{tab === 'insights' && (
  <>
    <InsightFeed
      feed={feed}
      loading={feedLoading}
      domain="search"
      showFilterChips
    />
  </>
)}
```

Import `useInsightFeed` and destructure `feed` and `feedLoading`.

- [ ] **Step 3: Add AnnotatedTrendChart with search-specific lines**

Above the InsightFeed (or below, depending on visual hierarchy), add the chart:

```typescript
const SEARCH_LINES: TrendLine[] = [
  { key: 'clicks', color: '#60a5fa', yAxisId: 'left', label: 'Clicks' },
  { key: 'impressions', color: '#8b5cf6', yAxisId: 'left', label: 'Impressions' },
  { key: 'ctr', color: '#f59e0b', yAxisId: 'right', label: 'CTR %' },
  { key: 'position', color: '#ef4444', yAxisId: 'right', label: 'Avg Position' },
];
```

Pass trend data and annotations from `useAnalyticsOverview`. Add toggle state management matching the pattern from Task 10.

- [ ] **Step 4: Verify build**

Run: `npx tsc --noEmit --skipLibCheck && npx vite build`

- [ ] **Step 5: Commit**

```bash
git add src/components/SearchDetail.tsx
git commit -m "feat: add Search Insights tab and AnnotatedTrendChart to SearchDetail

Default tab is now Search Insights with domain-filtered priority feed.
Chart shows Clicks + Impressions (default), CTR + Avg Position available.
Annotations visible on search chart."
```

---

## Task 12: Rewire TrafficDetail — Rename + Insights Default + AnnotatedTrendChart

**Files:**
- Modify: `src/components/TrafficDetail.tsx:15,22-57,139-147`

- [ ] **Step 1: Update tab structure**

```typescript
type DataTab = 'insights' | 'breakdown' | 'events';
const [tab, setTab] = useState<DataTab>('insights');
```

Update TabBar — rename "Overview" to "Breakdown", make Insights default:
```typescript
<TabBar
  tabs={[
    { id: 'insights', label: 'Traffic Insights', icon: Target },
    { id: 'breakdown', label: 'Breakdown', icon: BarChart3 },
    { id: 'events', label: 'Events', icon: Zap },
  ]}
  active={tab}
  onChange={id => setTab(id as DataTab)}
/>
```

- [ ] **Step 2: Replace TrendChart with AnnotatedTrendChart**

Remove the local `TrendChart` component (lines 22–57). Replace with `AnnotatedTrendChart` using traffic-specific lines:

```typescript
const TRAFFIC_LINES: TrendLine[] = [
  { key: 'users', color: '#14b8a6', yAxisId: 'left', label: 'Users' },
  { key: 'sessions', color: '#3b82f6', yAxisId: 'left', label: 'Sessions' },
  { key: 'pageviews', color: '#10b981', yAxisId: 'left', label: 'Pageviews' },
];
```

Pass annotations from `useAnalyticsOverview`. Add toggle state.

- [ ] **Step 3: Add InsightFeed to insights tab**

Move the existing Insights tab content (Traffic Health Summary, Growth Signals, etc.) below an `InsightFeed` component filtered to `domain="traffic"`. The existing detailed sections remain as additional context below the feed.

- [ ] **Step 4: Rename tab references**

Change all `tab === 'overview'` conditions to `tab === 'breakdown'`.

- [ ] **Step 5: Verify build**

Run: `npx tsc --noEmit --skipLibCheck && npx vite build`

- [ ] **Step 6: Update tests**

Check if any tests reference the old "Overview" tab or "overview" DataTab value. Update accordingly.

Run: `npx vitest run`

- [ ] **Step 7: Commit**

```bash
git add src/components/TrafficDetail.tsx
git commit -m "feat: restructure TrafficDetail — Insights default, Overview→Breakdown

Insights tab now default with traffic-domain priority feed.
Overview renamed to Breakdown to avoid hub-level naming collision.
TrendChart replaced with AnnotatedTrendChart (Users + Sessions default,
Pageviews available). Annotations visible on traffic chart."
```

---

## Task 13: Final Verification + Docs

**Files:**
- Modify: `FEATURE_AUDIT.md`
- Modify: `BRAND_DESIGN_LANGUAGE.md`
- Modify: `data/roadmap.json`

- [ ] **Step 1: Full build verification**

Run: `npx tsc --noEmit --skipLibCheck && npx vite build`
Run: `npx vitest run`

All tests must pass. Zero type errors. Build succeeds.

- [ ] **Step 2: Update FEATURE_AUDIT.md**

Add/update entries for:
- Analytics Hub — now insight-first with priority feeds, toggleable charts
- Connected Intelligence Engine — enrichment module, new insight types
- InsightFeed component — new UI primitive

- [ ] **Step 3: Update BRAND_DESIGN_LANGUAGE.md**

Document new components and color patterns:
- InsightFeedItem severity colors (red/amber/blue/green)
- SummaryPills color mapping
- Line toggle chip interaction pattern

- [ ] **Step 4: Update data/roadmap.json**

Mark relevant roadmap items as done. Check for items related to:
- Analytics hub improvements
- Insight engine enhancements
- Chart improvements

- [ ] **Step 5: Commit all docs**

```bash
git add FEATURE_AUDIT.md BRAND_DESIGN_LANGUAGE.md data/roadmap.json
git commit -m "docs: update feature audit, design language, and roadmap for Phase 1

Connected Intelligence Engine Phase 1 complete: insight-first tabs,
priority feed, toggleable charts, new insight types, enrichment module."
```

---

## Dependency Graph

```
Task 1 (Migration) ─────────────────────────────────────────┐
Task 2 (Shared Types) ──────────────────────────────────────┤
                                                             │
Task 3 (Enrichment Module) ──── depends on 1, 2 ────────────┤
Task 4 (Store + API Update) ── depends on 1, 2 ─────────────┤
                                                             │
Task 5 (Engine: New Types) ─── depends on 3, 4 ─────────────┤
                                                             │
Task 6 (useInsightFeed Hook) ─ depends on 2, 4 ─────────────┤ (can start after 4)
Task 7 (InsightFeed Components) ── depends on 2 ─────────────┤ (can start after 2)
Task 8 (Chart Toggle) ──────── independent ──────────────────┤
Task 9 (Trend Data Expansion) ─ independent ─────────────────┤
                                                             │
Task 10 (Rewire Overview) ──── depends on 6, 7, 8, 9 ───────┤
Task 11 (Rewire SearchDetail) ─ depends on 6, 7, 8, 9 ──────┤
Task 12 (Rewire TrafficDetail) ─ depends on 6, 7, 8, 9 ─────┤
                                                             │
Task 13 (Verification + Docs) ─ depends on ALL ─────────────┘
```

**Parallel execution opportunities:**
- Tasks 1+2 can run in parallel
- Tasks 3+4 can run in parallel (both depend on 1+2)
- Tasks 7+8+9 can run in parallel (independent of backend)
- Task 6 can start once Task 4 completes
- Tasks 10+11+12 can run in parallel once their deps are met
