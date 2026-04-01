# Unified Workspace Intelligence Layer — Design Spec

> **Status:** Active — Phases 1-2 complete, Phase 3 in planning
> **Module map:** [MODULE_OWNERSHIP_MAP.md](../MODULE_OWNERSHIP_MAP.md) — which files feed which intelligence slice
> **Author:** Claude (brainstorm session, March 30 2026)
> **Last updated:** April 1 2026 — Phase 3 scope finalized with exhaustive 14-agent codebase audit + 6-agent deep sweep
> **Scope:** Platform-wide intelligence unification, shared data accessors, event bridges, prompt formatting
> **Approach:** Hybrid — query-time assembly + targeted event bridges (Option C)

---

## 1. Problem Statement

The platform has 4 intelligence subsystems (SEO Context Builder, Analytics Intelligence Store, Outcome Engine, Page Keywords Store) and 39 data sources that operate in silos. Features independently fetch the same data (22 duplicate `listPages()` calls across the codebase, 26 `buildSeoContext()` callers, 12+ GA4/GSC endpoint variants called from multiple routes), intelligence doesn't flow between subsystems, and most AI features only see partial context. The Outcome Engine learns what works but that knowledge rarely reaches the features that make recommendations.

**Impact:**
- AI-generated briefs miss 40% of available intelligence (CTR opportunities, competitor gaps, outcome learnings)
- 8+ admin components consume zero cross-system intelligence
- Content decay recommendations don't know if a prior refresh already failed
- Keyword recommendations ignore empirical win-rate data
- Client narratives can't reference "we called it right" outcome history
- Estimated $500–1500/month in redundant external API calls (Webflow rate-limit sensitive)

---

## 2. Design Decisions (from brainstorm)

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Architecture | **Hybrid** — query-time assembly + targeted event bridges | Gets unified query interface AND bidirectional engine wiring without over-engineering an event bus for a single-server monolith |
| Return type | **Structured data + prompt formatter** | Structured `WorkspaceIntelligence` for UI components; `formatForPrompt()` companion for 26 AI endpoints |
| Cache strategy | **Tiered freshness + surgical invalidation** | Brand/personas 30m, page keywords 10m, insights until recompute (6h), learnings 24h. Event-invalidation on: strategy save, outcome scored, workspace settings, audit complete |
| API dedup | **Webflow page cache now, extensible surface** | `getWorkspacePages()` in `workspace-data.ts`, designed for future `getWorkspaceAnalytics()` etc. Old features migrate opportunistically |
| Event bridges | **16 targeted bridges** | Write-time hooks + read-time enrichments at specific mutation points. No generic event bus |

---

## 3. Architecture — Three Layers

### Layer 1: Shared Data Accessors (`server/workspace-data.ts`)

A new module providing cached, workspace-scoped access to frequently-fetched data. Designed as an extensible surface — starts with the highest-impact accessor, others added incrementally.

**Phase 1 (this spec):**
```typescript
// Cached Webflow page list — replaces 22 independent listPages() calls
getWorkspacePages(workspaceId: string, siteId: string): Promise<WebflowPage[]>
// TTL: 10 minutes, invalidated on workspace settings change

// Content pipeline summary — briefs, posts, matrices, requests in one query
getContentPipelineSummary(workspaceId: string): ContentPipelineSummary
// TTL: 5 minutes, invalidated on content mutations
```

**Future (extensible surface, same pattern):**
```typescript
getWorkspaceAnalytics(workspaceId, dateRange): AnalyticsSnapshot    // future
getWorkspaceSearchData(workspaceId, dateRange): SearchSnapshot       // future
getPageContent(url): ScrapedPageContent                              // future
```

**Design contract:**
- Every accessor is workspace-scoped with a typed return
- Every accessor has a configurable TTL with manual `invalidate(workspaceId)` support
- New features import from `workspace-data.ts`; existing features migrate opportunistically
- Cache key pattern: `${accessorName}:${workspaceId}[:${extraKey}]`

---

### Layer 2: Intelligence Core (`server/workspace-intelligence.ts`)

The central orchestrator that queries all subsystems and returns a unified intelligence object.

#### 2a. Core Function

```typescript
interface IntelligenceOptions {
  // Which slices to include (default: all available)
  slices?: IntelligenceSlice[];
  // Page-specific context (triggers per-page enrichment)
  pagePath?: string;
  // Domain filter for learnings
  learningsDomain?: 'content' | 'strategy' | 'technical' | 'all';
  // Token budget hint for downstream prompt formatting
  tokenBudget?: number;
}

type IntelligenceSlice =
  | 'seoContext'        // brand voice, keywords, personas, knowledge
  | 'insights'          // analytics intelligence (11 types)
  | 'learnings'         // outcome engine learnings + playbooks
  | 'pageProfile'       // per-page keywords, analysis, health, history
  | 'contentPipeline'   // briefs, posts, matrices, requests, coverage
  | 'siteHealth'        // audit, links, redirects, schema validation, CWV
  | 'clientSignals'     // keyword feedback, gap votes, approval patterns, priorities
  | 'operational';      // churn signals, annotations, activity summary

async function buildWorkspaceIntelligence(
  workspaceId: string,
  opts?: IntelligenceOptions
): Promise<WorkspaceIntelligence>
```

#### 2b. Return Type

```typescript
interface WorkspaceIntelligence {
  version: number;      // Interface version for backward compat (§31) — currently 1
  workspaceId: string;
  assembledAt: string;  // ISO timestamp — consumers know data freshness

  // SEO Context (from existing buildSeoContext)
  seoContext?: {
    strategy: KeywordStrategy | undefined;
    brandVoice: string;
    businessContext: string;
    businessProfile: BusinessProfile | null;  // industry, goals, target audience (from workspace settings)
    personas: AudiencePersona[];
    knowledgeBase: string;
    pageKeywords?: PageKeywordMap;  // when pagePath provided (from shared/types/workspace.ts)
    rankTracking?: { trackedKeywords: number; avgPosition: number | null; positionChanges: { improved: number; declined: number; stable: number } };
    keywordRecommendations?: { nextOpportunities: { keyword: string; difficulty: number; volume: number; winRateFit: number }[] };
    strategyHistory?: { revisionsCount: number; lastRevisedAt: string; trajectory: string };  // how strategy has evolved
    backlinkProfile?: { totalBacklinks: number; referringDomains: number; trend: 'growing' | 'stable' | 'declining' };  // SEMRush data
    serpFeatures?: { featuredSnippets: number; peopleAlsoAsk: number; localPack: boolean };  // SERP feature presence
  };

  // Analytics Intelligence (from analytics-insights-store)
  // Note: 12 InsightType values exist (including anomaly_digest)
  insights?: {
    all: AnalyticsInsight[];
    byType: Record<InsightType, AnalyticsInsight[]>;
    bySeverity: { critical: number; warning: number; opportunity: number; positive: number };
    topByImpact: AnalyticsInsight[];  // top 10 by impactScore
    forPage?: AnalyticsInsight[];     // when pagePath provided (filtered by pageId field)
  };

  // Outcome Engine (from workspace-learnings + outcome-tracking)
  learnings?: {
    summary: WorkspaceLearnings | null;
    confidence: 'high' | 'medium' | 'low' | null;
    topWins: TrackedAction[];           // top 5 recent wins
    winRateByActionType: Record<string, number>;
    recentTrend: 'improving' | 'stable' | 'declining' | null;
    playbooks: ActionPlaybook[];
    weCalledIt: WeCalledItEntry[];      // outcome proof — "we predicted this improvement"
    roiAttribution?: {                  // per-action click gains (from roi-attribution.ts)
      totalClickGain: number;
      topActions: { actionId: string; clickGain: number; actionType: string }[];
    };
    forPage?: {                          // when pagePath provided
      actions: TrackedAction[];
      outcomes: ActionOutcome[];
      hasActiveAction: boolean;
    };
  };

  // Per-Page Profile (assembled when pagePath provided)
  pageProfile?: {
    pagePath: string;
    primaryKeyword: string | null;
    searchIntent: string | null;
    optimizationScore: number | null;
    recommendations: string[];
    contentGaps: string[];
    insights: AnalyticsInsight[];       // page-specific insights
    actions: TrackedAction[];           // outcome history for this page
    auditIssues: string[];              // from latest audit snapshot
    schemaStatus: 'valid' | 'warnings' | 'errors' | 'none';
    linkHealth: { inbound: number; outbound: number; orphan: boolean };
    seoEdits: { currentTitle: string; currentMeta: string; lastEditedAt: string | null };
    rankHistory: { current: number | null; best: number | null; trend: 'up' | 'down' | 'stable' };
    contentStatus: 'has_brief' | 'has_post' | 'published' | 'decay_detected' | null;
    cwvStatus: 'good' | 'needs_improvement' | 'poor' | null;
  };

  // Content Pipeline Intelligence
  contentPipeline?: {
    briefs: { total: number; byStatus: Record<string, number> };
    posts: { total: number; byStatus: Record<string, number> };
    matrices: { total: number; cellsPlanned: number; cellsPublished: number };
    requests: { pending: number; inProgress: number; delivered: number };
    coverageGaps: string[];  // keywords targeted by strategy but no brief/post exists
    seoEdits: { pending: number; applied: number; inReview: number };
    subscriptions: { active: number; totalPages: number };  // recurring content generation commitments
    schemaDeployment: { planned: number; deployed: number; types: string[] };  // schema progress
    rewritePlaybook?: { patterns: string[]; lastUsedAt: string | null };  // rewrite patterns from routes/rewrite-chat.ts — extracted at assembly time from chat history
  };

  // Site Health Summary
  siteHealth?: {
    auditScore: number | null;
    auditScoreDelta: number | null;  // vs previous snapshot
    deadLinks: number;
    redirectChains: number;
    schemaErrors: number;
    orphanPages: number;  // from site-architecture.ts gap analysis
    aeoReadiness: { pagesChecked: number; passingRate: number } | null;  // from aeo-page-review.ts
    cwvPassRate: { mobile: number | null; desktop: number | null };  // aggregated from pagespeed.ts CrUX field data (not per-page Lighthouse)
  };

  // Client Feedback Signals
  clientSignals?: {
    keywordFeedback: { approved: string[]; rejected: string[]; patterns: { approveRate: number; topRejectionReasons: string[] } };
    contentGapVotes: { topic: string; votes: number }[];
    businessPriorities: string[];   // from client-business-priorities or workspace.businessProfile
    approvalPatterns: { approvalRate: number; avgResponseTime: number | null };
    recentChatTopics: string[];     // aggregated from admin + client chat sessions
    churnRisk: 'low' | 'medium' | 'high' | null;
    churnSignals: { type: string; severity: string; detectedAt: string }[];  // raw signals (8 types)
    roi: { organicValue: number; growth: number; period: string } | null;    // ROI data from roi.ts
    engagement: {                   // client activity patterns
      lastLoginAt: string | null;
      loginFrequency: 'daily' | 'weekly' | 'monthly' | 'inactive';
      chatSessionCount: number;     // last 30 days
      portalUsage: { pageViews: number; featuresUsed: string[] } | null;  // Phase 4: client portal tracking
    };
    compositeHealthScore: number | null;  // 0-100 unified score, formula below
  };
  // compositeHealthScore = weighted average:
  //   40% churn component: 100 if no signals, 60 if low risk, 30 if medium, 0 if high
  //   30% ROI component: 100 if growth > 10%, 70 if stable, 40 if declining, 0 if no data
  //   30% engagement component: 100 if daily login, 70 if weekly, 40 if monthly, 0 if inactive
  // Returns null if fewer than 2 of 3 components have data (insufficient signal)

  // Operational Intelligence
  operational?: {
    recentActivity: { type: string; description: string; timestamp: string }[];  // last 10
    annotations: { date: string; label: string; pageUrl?: string }[];
    pendingJobs: number;
    timeSaved: { totalMinutes: number; byFeature: Record<string, number> };  // AI usage log aggregation
    approvalQueue: { pending: number; oldestAge: number | null };  // blocked workflow state
    recommendationQueue: { fixNow: number; fixSoon: number; fixLater: number };  // prioritized action backlog
    actionBacklog: { pendingMeasurement: number; oldestAge: number | null };  // outcome tracking backlog
    detectedPlaybooks: string[];  // patterns detected by outcome engine
    workOrders: { active: number; pending: number };  // from work-orders.ts
  };
}
```

#### 2c. Prompt Formatter

```typescript
interface PromptFormatOptions {
  // Which sections to include (default: all available in the intelligence object)
  sections?: IntelligenceSlice[];
  // Verbosity level
  verbosity?: 'compact' | 'standard' | 'detailed';
  // Max approximate token count (will summarize/truncate to fit)
  tokenBudget?: number;
  // Domain focus for learnings
  learningsDomain?: 'content' | 'strategy' | 'technical' | 'all';
  // Page-specific: include page profile block
  pagePath?: string;
}

function formatForPrompt(
  intelligence: WorkspaceIntelligence,
  opts?: PromptFormatOptions
): string
```

**Format behavior:**
- `compact` (~500 tokens): key metrics, top 3 insights, win rate summary, primary keyword, brand voice, business context, knowledge base summary
- `standard` (~1500 tokens): full keyword block, top 5 insights with context, learnings summary, page profile if available, content pipeline status, personas summary (names + roles), rank tracking highlights, ROI summary
- `detailed` (~3000 tokens): everything including full personas, knowledge base, all insights, full learnings breakdown, site health, client signals, backlink profile, SERP features, strategy history, time-saved metrics

**IMPORTANT: Personas must ALWAYS be formatted** when present in seoContext, regardless of verbosity. At `compact`, format as a one-line list of persona names. At `standard`, include names + roles. At `detailed`, include full descriptions. The current implementation silently drops personas — this is a bug, not a design choice.

**Backward compatibility:** `buildSeoContext()` continues to work with the same function signature and `SeoContext` return type. Current signature: `buildSeoContext(workspaceId?: string, pagePath?: string, learningsDomain: 'content' | 'strategy' | 'technical' | 'all' = 'strategy'): SeoContext`. Internally it delegates to `buildWorkspaceIntelligence({ slices: ['seoContext'] })` and maps the result back to the existing `SeoContext` shape (`keywordBlock`, `brandVoiceBlock`, `businessContext`, `personasBlock`, `knowledgeBlock`, `fullContext`, `strategy`). Existing consumers don't need to change immediately — they get the same interface with richer data under the hood.

---

### Layer 3: Consumers

#### Server-side (AI features)
Existing 26 endpoints that call `buildSeoContext()` migrate to:
```typescript
const intelligence = buildWorkspaceIntelligence(workspaceId, {
  slices: ['seoContext', 'insights', 'learnings', 'contentPipeline'],
  pagePath: slug,
  learningsDomain: 'content',
});
const context = formatForPrompt(intelligence, {
  verbosity: 'standard',
  tokenBudget: 2000,
});
```

#### Frontend (admin UI)
New React hook:
```typescript
// Fetches intelligence via API, returns typed data
function useWorkspaceIntelligence(
  workspaceId: string,
  slices?: IntelligenceSlice[]
): UseQueryResult<WorkspaceIntelligence>
```

New API endpoint:
```
GET /api/intelligence/:workspaceId?slices=insights,learnings,pageProfile&pagePath=/about
```

#### Client portal
Filtered subset with narrative framing — no admin-only data, no purple, outcome-oriented language:
```
GET /api/public/intelligence/:workspaceId
```

---

## 4. Event Bridges (15 active, #6 skipped)

### Write-Time Hooks (9 active)
These execute immediately after a mutation.

| # | Trigger | Action | Implementation | Status |
|---|---------|--------|----------------|--------|
| 1 | **Outcome scored** (90-day checkpoint complete) | Re-weight related insight severity using win/loss data | In `recordOutcome()`: query insights for same page/keyword, adjust `impact_score` by outcome | ⚠️ Infrastructure built, not wired |
| 2 | **Content decay detected** | Auto-create suggested brief entry in pipeline | In `analyzeContentDecay()` (`server/content-decay.ts`): if no existing brief for keyword, insert pipeline suggestion. **Note:** Requires new `suggested_briefs` DB table + API endpoints (no existing store for auto-suggested briefs). Migration 043 should include this table. Content decay currently runs as part of anomaly detection or ad-hoc, not a dedicated cron. | ✅ |
| 3 | **Strategy/knowledge updated** | Invalidate intelligence cache + trigger downstream refresh | In workspace settings save + strategy generation: `invalidateIntelligenceCache(wsId)` | ✅ |
| 4 | **Insight resolved by admin** | Record `insight_acted_on` action in Outcome Engine | **Already implemented** in `server/routes/insights.ts:40-64`. No additional work needed — verify test coverage only. | ✅ Pre-existing |
| 5 | **Page analysis complete** | Clear SEO context cache for that page path | In `upsertPageKeyword()`: `clearSeoContextCache(wsId)` + `invalidateIntelligenceCache(wsId)` | ✅ |
| 7 | **Any action recorded** (`recordAction`) | Auto-resolve related unresolved insights to "in_progress" | Post-`recordAction()` hook: query insights by page_url/keyword, update `resolution_status = 'in_progress'` | ✅ |
| 10 | **Anomaly detected for page with existing insight** | Boost that insight's severity | In `upsertAnomalyDigestInsight()`: query existing insights for same page, increase `impact_score` | ⚠️ Infrastructure built, not wired |
| 11 | **Knowledge/strategy mutation** | Cascade cache invalidation across all dependent caches | Extend existing `clearSeoContextCache()` to also clear intelligence cache and notify downstream | ✅ |
| 12 | **Audit/analysis findings generated** | Create insights from audit issues, link health, schema errors | Post-audit: map top issues to `page_health` insights in the insights store | ⚠️ Infrastructure built, not wired |
| 13 | **Any action recorded** (`recordAction`) | Auto-create annotation on performance timeline | Post-`recordAction()` hook: insert annotation with action label, date, page URL | ✅ |

### Bridge 14: Outcome learnings updated → recompute intelligence signals (write-time, cron-triggered)
In `recomputeAllWorkspaceLearnings()` (daily cron): after learnings are updated, call `invalidateIntelligenceCache(workspaceId)` so downstream queries reflect latest win patterns. Status: ⚠️ Not yet wired (deferred from Phase 2).

### Bridge 15: Scheduled audit complete → generate insights from findings (write-time)
In `scheduledAuditComplete()` handler: map critical/warning audit issues to `page_health` insights. Deduplicate against existing insights (same workspace + page + type). Status: ⚠️ Infrastructure built, not wired.

### Read-Time Enrichments (3 active, #6 skipped)
These query additional data when computing results, not on mutation.

| # | When computing... | Also check... | Purpose | Status |
|---|-------------------|---------------|---------|--------|
| ~~6~~ | ~~Anomaly for a page~~ | ~~`getActionsByPage()` for tracked actions~~ | ~~Distinguish organic decline from action-related regression~~ | ❌ Skipped — low value |
| 8 | **Content decay for a page** | `getActionsByPage()` for prior refresh actions + outcomes | Tag as "repeat_decay" if prior refresh didn't hold. Boost priority | Phase 3A |
| 9 | **Keyword recommendations** | `getWorkspaceLearnings()` for win-rate-by-KD-range | Weight recommendations toward KD ranges with empirical wins | Phase 3A |
| 16 | **Client-facing narratives** | `churnSignals` for workspace | Adjust narrative tone — more value-demonstration language for at-risk clients | Phase 3B |

---

## 5. Shared Data Accessor: `workspace-data.ts`

### `getWorkspacePages()`

```typescript
interface WorkspacePageCache {
  pages: WebflowPage[];
  fetchedAt: number;
}

const PAGE_CACHE_TTL = 10 * 60 * 1000; // 10 minutes
const pageCache = new Map<string, WorkspacePageCache>();

export async function getWorkspacePages(
  workspaceId: string,
  siteId: string
): Promise<WebflowPage[]> {
  const key = `${workspaceId}:${siteId}`;
  const cached = pageCache.get(key);
  if (cached && Date.now() - cached.fetchedAt < PAGE_CACHE_TTL) {
    return cached.pages;
  }

  const workspace = getWorkspace(workspaceId);
  const token = workspace?.webflowToken;
  if (!token) return [];

  // listPages signature: listPages(siteId: string, tokenOverride?: string)
  const raw = await listPages(siteId, token);
  const pages = filterPublishedPages(raw);
  pageCache.set(key, { pages, fetchedAt: Date.now() });
  return pages;
}

export function invalidatePageCache(workspaceId: string): void {
  for (const key of pageCache.keys()) {
    if (key.startsWith(`${workspaceId}:`)) pageCache.delete(key);
  }
}
```

**Migration plan:** Replace all 22 `listPages()` + `filterPublishedPages()` call sites with `getWorkspacePages()`. Each replacement is mechanical — same data, cached.

### `getContentPipelineSummary()`

```typescript
export function getContentPipelineSummary(workspaceId: string): ContentPipelineSummary {
  // Queries briefs, posts, matrices, requests, work orders, seo edits
  // Returns counts by status + coverage gap detection
  // TTL: 5 minutes
}
```

### Future accessor pattern (for reference):
```typescript
// All follow the same shape:
export async function getWorkspace[DataType](
  workspaceId: string,
  ...extraParams
): Promise<TypedResult> {
  // 1. Check cache by key
  // 2. If fresh, return cached
  // 3. If stale, fetch/compute
  // 4. Store in cache, return
}

export function invalidate[DataType]Cache(workspaceId: string): void {
  // Clear cache entries for workspace
}
```

---

## 6. Tiered Cache Strategy

| Data Source | TTL | Invalidation Events | Rationale |
|-------------|-----|---------------------|-----------|
| Brand voice, personas, knowledge | 30 min | Workspace settings save | Rarely changes; manual edits are the only trigger |
| Page keywords / analysis | 10 min | Page analysis complete, strategy updated | Changes during active work sessions |
| Analytics insights | Until recompute (6h) | Force refresh via API | Underlying GSC/GA4 data is itself cached 15 min |
| Outcome learnings | 24h | New outcome scored | Matches daily cron cadence; surgical invalidation on scoring events |
| Webflow pages | 10 min | Workspace settings save | Balances freshness vs Webflow rate limits |
| Content pipeline summary | 5 min | Brief/post/matrix mutation | Changes frequently during active content work |
| Site health summary | Until next audit | Audit complete | Audit snapshots are the authoritative source |
| Client signals | 30 min | Feedback/vote/approval mutation | Low-frequency changes |
| Operational data | 5 min | Activity/approval/job mutations | Changes frequently during active work; same TTL as content pipeline |
| Page profile (composite) | 5 min | Page analysis, audit, outcome scored | Governed by shortest constituent TTL (page keywords = 10m, but outcomes can change any time) |
| SEMRush backlink/SERP data | 24h | None (daily refresh if accessed) | External API with rate limits; data changes slowly. Pre-cached on first access, not fetched during assembly. Falls back gracefully to `null` if unavailable — assembly must never block on SEMRush. |
| Assembled intelligence (full object) | 5 min | Any sub-cache invalidation | Short TTL as meta-cache; sub-caches provide the real freshness guarantees |

**Invalidation implementation:** Each sub-cache has an `invalidate(workspaceId)` function. The meta-cache (`buildWorkspaceIntelligence` result) is invalidated when any sub-cache is invalidated. Surgical invalidation points:

1. `workspace.save()` → invalidate brand/personas/knowledge + pages + intelligence
2. `recordOutcome()` at 90-day checkpoint → invalidate learnings + intelligence
3. `upsertPageKeyword()` → invalidate page keywords + SEO context + intelligence
4. `generateStrategy()` → invalidate strategy + page keywords + intelligence
5. `auditComplete` event → invalidate site health + intelligence
6. `createBrief/publishPost/updateMatrix` → invalidate content pipeline + intelligence

---

## 7. Data Sources — Complete Inventory (39)

### External APIs (6)
1. Google Search Console — queries, pages, CTR, position, impressions
2. Google Analytics 4 — sessions, users, conversions, engagement, landing pages
3. Webflow API — pages, CMS collections, assets, custom code
4. SEO Data Provider (SEMRush / DataForSEO) — keyword metrics, competitors, backlinks
5. PageSpeed Insights — Core Web Vitals, Lighthouse scores, opportunities
6. Competitor Crawl — competitor schema, content, structure

### Workspace Identity & Knowledge (5)
7. Brand Voice — tone, style guidelines
8. Brand Docs — brand documentation files (.txt/.md)
9. Knowledge Base + Knowledge Docs — business knowledge, services, FAQs
10. Audience Personas — pain points, goals, objections, buying stage, content format
11. Voice Calibration Scores — brand voice match quality per page

### Site Structure & Technical Health (9)
12. Sitemap / CMS Pages — published page inventory
13. Site Architecture Tree — parent/child/sibling relationships, hub detection
14. Audit Snapshots — historical site health scores, per-page issues
15. Internal Link Health — orphan pages, link density, inbound/outbound counts
16. Redirect Chains — broken redirects, chain depth, ghost URLs
17. Dead Links — 404s, timeouts, source pages
18. Schema Validation Status — errors/warnings/valid per page, rich results eligibility
19. Page Weight — payload sizes, asset breakdown
20. Core Web Vitals — LCP, INP, CLS, field data pass/fail

### Content Pipeline (7)
21. Content Briefs — keyword targets, outlines, SERP analysis, E-E-A-T guidance
22. Content Posts — generated/published content, version history, voice scores
23. Content Matrices — bulk content planning grids, cell status tracking
24. Content Requests — client-driven demand signals, priority, rationale
25. Content Decay Analysis — pages with declining metrics, refresh recommendations
26. Work Orders — fix/schema work in progress
27. SEO Editor (title/meta) — per-page suggestions, applied changes, edit states

### SEO Strategy & Performance (5)
28. Keyword Strategy — site keywords, page map, content gaps, quick wins, topic clusters
29. Page Keywords (per-page) — primary/secondary keywords, search intent, optimization score
30. Rank History (180d) — daily position snapshots for tracked keywords
31. Schema Plan — page role assignments, entity registry, competitor schema intel
32. Keyword Recommendations — AI-scored keyword opportunities

### Client Feedback Signals (5)
33. Keyword Feedback — thumbs up/down on strategy keywords
34. Content Gap Votes — client-voted content priorities
35. Business Priorities — submitted during onboarding or settings
36. Approval Patterns — approval/rejection rates, response times
37. Chat Topics — recent client chat session topics

### Operational Intelligence (4)
38. Activity Log — chronological feed of all platform actions
39. Churn Signals — at-risk client indicators (no login, low engagement)
— Anomaly Digests — detected metric anomalies (already in insights store)
— Annotations — timeline markers (already consumed; bridge #13 auto-creates new ones)

---

## 8. Frontend Integration

### Admin: `useWorkspaceIntelligence()` hook

```typescript
// src/hooks/admin/useWorkspaceIntelligence.ts
export function useWorkspaceIntelligence(
  workspaceId: string,
  slices?: IntelligenceSlice[]
) {
  return useQuery({
    queryKey: queryKeys.admin.intelligence(workspaceId, slices),
    queryFn: () => get<WorkspaceIntelligence>(
      `/api/intelligence/${workspaceId}?slices=${(slices || []).join(',')}`
    ),
    staleTime: 5 * 60 * 1000, // 5 min — matches server cache TTL
  });
}
```

**Component wiring (8 admin components to enrich):**

| Component | Slices needed | What it gains |
|-----------|---------------|---------------|
| WorkspaceHome | insights, learnings, contentPipeline, siteHealth | Intelligence-first dashboard: top insights, win rate, pipeline health |
| RankTracker | insights (ranking_mover, ranking_opportunity), learnings | Highlight momentum keywords, show which rank changes correlate with actions |
| SeoEditor | pageProfile, insights (per-page), siteHealth | Page-level health context, "did our last edit help?" outcome data |
| ContentPipeline | learnings (content domain), contentPipeline, insights (decay) | Which content topics win, pipeline coverage gaps, decay priorities |
| KeywordStrategy | learnings (strategy domain), insights, clientSignals | KD range win rates, client keyword feedback, proven difficulty bands |
| SchemaSuggester | insights (serp_opportunity), learnings, siteHealth | SERP opportunity prioritization, schema success patterns |
| SiteArchitecture | insights, siteHealth | Page traffic overlay, orphan detection + link health |
| PageIntelligence | pageProfile (full) | Complete per-page intelligence profile |

### Client: filtered intelligence endpoint

```
GET /api/public/intelligence/:workspaceId
```

Returns a subset of `WorkspaceIntelligence` with:
- No admin-only insight types (strategy_alignment)
- No purple/admin framing
- Outcome data framed as "here's what's working" not "here's our win rate"
- Churn-aware tone adjustment (more value-demonstration language for at-risk clients)
- `assembledAt` timestamp for freshness indication

### Query key factory addition

Add to `src/lib/queryKeys.ts`:
```typescript
intelligence: (wsId: string, slices?: IntelligenceSlice[]) =>
  ['admin-intelligence', wsId, slices?.sort().join(',') ?? 'all'] as const,
```

### WebSocket cache invalidation

New event constant in `server/ws-events.ts`:
```typescript
INTELLIGENCE_CACHE_UPDATED: 'intelligence:cache_updated',
```

```typescript
// Frontend handler in useWsInvalidation.ts
case WS_EVENTS.INTELLIGENCE_CACHE_UPDATED:
  queryClient.invalidateQueries({ queryKey: queryKeys.admin.intelligence(workspaceId) });
  queryClient.invalidateQueries({ queryKey: ['client-intelligence', workspaceId] });
  break;
```

Broadcast whenever any sub-cache is invalidated server-side.

---

## 9. Infrastructure Improvements (discovered during audit)

These aren't part of the core intelligence layer but were identified as gaps that should be addressed in the same body of work:

### 9a. Data Retention Policies — Phase 4
2 tables grow unbounded with no cleanup. 3 others have existing cleanup but may need policy review:

| Table | Current cleanup | Proposed retention | Action needed |
|-------|----------------|-------------------|---------------|
| `activity_log` | MAX_ENTRIES=500 cap per workspace (in `addActivity()`) | Adequate for now | None — already bounded |
| `anomalies` | Time-based `deleteOlderThan` in detection code | Adequate for now | None — already bounded |
| `chat_sessions` | **None** — `_deleteSession` prepared but no automatic cleanup | 6 months | Add daily cron, delete old sessions |
| `audit_snapshots` | **None** — no DELETE or cleanup found | Keep latest 10 per workspace | Add post-audit cleanup |
| `llms_txt_cache` | Manual delete available but no automatic cleanup | 90 days since last generation | Add weekly cron |

### 9b. Scheduled Intelligence Refresh — Phase 4
Currently intelligence signals only recompute on-demand. Add:
- Intelligence signal recomputation every 6 hours (piggybacking on existing cron infrastructure)
- Keyword recommendation refresh every 12 hours
- Content pipeline signals refresh every 6 hours
- Broadcast `INTELLIGENCE_SIGNALS_UPDATED` after each refresh

### 9c. Freshness Timestamps — Phase 4
All intelligence API responses must include `assembledAt` (already in the spec). Client-facing endpoints must also include per-slice `computedAt` timestamps so the frontend can show "Last updated: 2h ago" indicators.

### 9d. Keyword Metrics Cache Auto-Cleanup — Phase 3A (minor, add to 3A-7 scheduler work)
`keyword_metrics_cache` cleanup is currently manual-only. Add to daily cron: `cleanupStaleEntries(60)`.

### 9e. Frontend Intelligence Hook Wiring
Of the three outcome hooks defined in `src/hooks/admin/useOutcomes.ts`:
- `useOutcomeLearnings` — imported by `OutcomeLearningsPanel.tsx` ✓
- `useOutcomePlaybooks` — imported by `OutcomePlaybooks.tsx` ✓
- `useOutcomeTimeline` — **defined but never imported by any component**

The new `useWorkspaceIntelligence` hook provides a unified alternative for components that need cross-system intelligence rather than single-subsystem data. Existing outcome hooks remain valid for the dedicated Outcome Dashboard components.

---

## 10. Migration Strategy

### Phase approach
This is a large system touching every feature. Implementation should be phased:

**Phase 1 — Foundation (core layer + shared data)** ✅ COMPLETE
- ✅ Created `workspace-data.ts` with `getWorkspacePages()` + `getContentPipelineSummary()`
- ✅ Created `workspace-intelligence.ts` with `buildWorkspaceIntelligence()` + `formatForPrompt()`
- ✅ Created shared types in `shared/types/intelligence.ts`
- ✅ `buildSeoContext()` shadow-mode comparison (delegates + compares)
- ✅ API endpoint (`/api/intelligence/:workspaceId`) + `useWorkspaceIntelligence` hook
- ✅ LRU cache with single-flight dedup + persistent sub-caching layer
- ✅ Cold-start detection in `formatForPrompt()` (§29)

**Phase 2 — Event bridges (write-time hooks)** ⚠️ MOSTLY COMPLETE (4 bridges unwired)
- ✅ Bridge infrastructure: `fireBridge()`, `debouncedOutcomeReweight()`, `withWorkspaceLock()`, per-bridge feature flags (15 flags in `shared/types/feature-flags.ts`)
- ✅ Bridges wired and verified: #2 (decay→brief), #3 (strategy→invalidate), #5 (page analysis→invalidate), #7 (action→auto-resolve), #11 (settings→cascade), #13 (action→annotate)
- ✅ Bridge #4 (insight resolved→action) — pre-existing, verified
- ⚠️ **Bridge #1 (outcome→reweight)** — `debouncedOutcomeReweight` defined in bridge-infrastructure.ts but NEVER imported or called. `recordOutcome()` does not trigger insight reweighting.
- ⚠️ **Bridge #10 (anomaly→boost)** — `debouncedAnomalyBoost` defined but never called from anomaly-detection.ts or anywhere else.
- ⚠️ **Bridge #12 (audit→page_health insights)** — `bridge-audit-page-health` flag defined but `fireBridge()` never called. (Note: `analytics-intelligence.ts` creates page_health insights via the pre-bridge path, but the bridge-based creation from audit completion was never wired.)
- ⚠️ **Bridge #15 (audit→site_health insights)** — Same pattern: flag defined, never triggered.
- ⚠️ `contentPipeline` and `siteHealth` slices — the spec claimed "assembled via route-level assembly" but in reality `workspace-intelligence.ts` still logs "Slice not yet implemented" for both. The `workspace-home.ts` route assembles a separate `contentPipeline` object, but this is NOT the intelligence layer — the `/api/intelligence/:wsId` endpoint returns nothing for these slices.
- ✅ Suggested briefs store + API endpoints for Bridge #2
- ✅ WebSocket handlers for bridge events on frontend

**Implementation notes (Phase 1-2 deltas from original spec):**
- Bridge #6 (anomaly→action annotation enrichment) intentionally skipped — low value
- `buildWorkspaceIntelligence()` is async; `buildSeoContext()` is sync (26 callers). The shadow-mode comparison works by calling `buildWorkspaceIntelligence()` fire-and-forget from the sync path.
- `formatForPrompt()` currently only formats 3 slices: `seoContext`, `insights`, `learnings`. No other slices are formatted.
- `tokenBudget` is defined in `IntelligenceOptions` but truncation logic is not yet implemented.
- **All 5 remaining slice assemblers** (`contentPipeline`, `siteHealth`, `pageProfile`, `clientSignals`, `operational`) are stubbed — they log "Slice not yet implemented" and return undefined. The intelligence API returns nothing for these slices.
- `INTELLIGENCE_CACHE_UPDATED` WebSocket event is defined in both server and frontend ws-events files but never broadcast or handled.
- **4 bridges have infrastructure (flags + debounce functions) but are not wired to their trigger points:** #1, #10, #12, #15. These must be completed in Phase 3A before the slice assemblers can use their output.

**Phase 3A — Complete the intelligence layer (purely additive, zero behavior changes)** ← CURRENT

The goal of 3A is to make `buildWorkspaceIntelligence()` return **all 8 slices with real data** and `formatForPrompt()` produce rich context for all of them. No existing callers change — this is additive infrastructure only.

*3A-1: Populate all 5 remaining slice assemblers*

Each stubbed slice gets a real assembler function wiring in the data sources identified by the codebase audit (55+ modules, only 5 currently connected):

| Slice | Data sources to wire in | Modules |
|-------|------------------------|---------|
| `contentPipeline` | Briefs in flight, posts in generation, matrices planned, content requests, decay analysis, suggested briefs (Bridge #2), coverage gaps, keyword recommendations, **content subscriptions** (recurring generation commitments), **schema deployment progress** (planned vs deployed schema types + deployment queue), **publication timing intelligence** (optimal scheduling + keyword gaps), **cannibalization warnings** (active keyword overlaps between pages/cells) | `content-brief.ts`, `content-posts-db.ts`, `content-matrices.ts`, `content-requests.ts`, `content-decay.ts`, `suggested-briefs-store.ts`, `keyword-recommendations.ts`, `workspace-data.ts` (getContentPipelineSummary), `content-subscriptions.ts`, `schema-plan.ts`, `schema-store.ts` (deployed schemas), `schema-queue.ts` (pending deployments), `content-calendar-intelligence.ts` (timing + gaps), `cannibalization-detection.ts` (keyword overlaps) |
| `siteHealth` | Audit score + delta, dead links, redirect chains, schema errors, CWV pass rate, performance snapshots (PageSpeed), link checker results, SEO change velocity, anomaly count + types, **redirect chain/404 details** (chain depth, broken targets), **AEO readiness** (author, dates, FAQ schema per page), **schema validation** (JSON-LD compliance status), **PageSpeed fetch** (Lighthouse + CrUX field data) | `reports.ts` (audit snapshots), `performance-store.ts`, `pagespeed.ts` (CWV fetcher), `link-checker.ts`, `redirect-scanner.ts` (chain detection), `redirect-store.ts` (scan results), `seo-change-tracker.ts`, `anomaly-detection.ts`, `aeo-page-review.ts` (AEO checks), `schema-validator.ts` (JSON-LD compliance) |
| `pageProfile` | Site architecture node, page performance (CWV), page anomalies, page-level outcomes, page recommendations, page keyword analysis, page SEO changes, **page rank history** (keyword positions over 180 days), **page-level ROI attribution** (before/after metrics per action), **page decay status** (click decline detection + prior refresh outcomes) | `site-architecture.ts`, `performance-store.ts`, `anomaly-detection.ts`, `outcome-tracking.ts` (getActionsByPage), `recommendations.ts`, `page-keywords.ts`, `seo-change-tracker.ts`, `rank-tracking.ts` (per-page position history), `roi-attribution.ts` (page-level action metrics), `content-decay.ts` (per-page decay detection) |
| `clientSignals` | Churn signals (8 types), approval/sign-off status + delays, ROI data (organic traffic value + growth), **ROI attribution** (per-action click gains), engagement metrics (login frequency, chat activity), keyword feedback **patterns** (approve/decline trends, not just raw votes), content gap vote **patterns** (topic interest signals), content request patterns, **business priorities** (stated strategic goals), **client feedback** (bug/feature/general reports — direct sentiment), **service requests** (non-content requests with notes + attachments), **chat history patterns** (topic frequency + engagement depth) | `churn-signals.ts`, `approvals.ts`, `roi.ts`, `roi-attribution.ts`, `activity-log.ts`, `keyword-feedback.ts`, `content-requests.ts`, `content-gap-votes` (DB), `client-business-priorities` (DB), `feedback.ts` (client sentiment), `client-users.ts` (login frequency), `requests.ts` (service requests), `chat-memory.ts` (chat patterns) |
| `operational` | Activity log (recent timeline), approval queue, recommendation priority queue (fix_now/fix_soon/fix_later), action backlog (pending measurements), detected playbooks, anomaly alerts, SEO change tracker, **time-saved metrics** (AI usage log — minutes saved per feature), **background job status** (pending/running/failed jobs), **work order queue** (active orders linked to payments), **timeline annotations** (date-labeled events for analytics context), **insight acceptance rate** (which insight types users value vs dismiss) | `activity-log.ts`, `approvals.ts`, `recommendations.ts`, `outcome-tracking.ts` (getPendingActions), `outcome-playbooks.ts`, `anomaly-detection.ts`, `seo-change-tracker.ts`, `usage-tracking.ts` (time-saved), `jobs.ts` (job queue status), `work-orders.ts` (payment-linked orders), `annotations.ts` + `analytics-annotations.ts` (timeline events), `insight-feedback.ts` (acceptance patterns) |

Also enrich existing slices:
| Slice | Additional data sources | Modules |
|-------|------------------------|---------|
| `seoContext` | Rank tracking data (tracked keywords + position changes), keyword recommendations (next opportunities), **strategy history** (trajectory — how strategy has evolved), **businessProfile** (industry, goals, target audience from workspace settings — currently only used by schema-gen), **backlink profile** (SEMRush referring domains + trend), **SERP features** (featured snippets, PAA presence) | `rank-tracking.ts`, `keyword-recommendations.ts`, `strategy_history` (DB), `workspaces.ts` (getWorkspace → businessProfile), SEMRush MCP (backlinks, SERP) |
| `learnings` | **ROI attribution** (per-action click gains — direct evidence of "was this worth doing?"), **WeCalledItEntry** (outcome proof — predictions that came true, used for client narratives) | `roi-attribution.ts`, `outcome-tracking.ts` (weCalledIt entries) |

*3A-2: Expand `formatForPrompt()` to all 8 slices + fix formatting gaps*

**Bug fixes in existing formatters:**
- **Fix: Personas silently dropped** — `formatSeoContextSection()` never includes personas despite them being in the data object. Add persona formatting at all verbosity levels (compact: names only, standard: names + roles, detailed: full descriptions).
- **Fix: knowledgeBase only at "detailed"** — most consumers use compact/standard and miss domain knowledge entirely. Move knowledgeBase to **standard** verbosity (one-line summary at compact).
- **Fix: businessProfile not formatted** — add business context from `businessProfile` (industry, goals) at standard+ verbosity.
- **Fix: WeCalledItEntry not formatted** — add "outcome proof" items in learnings section at standard+ verbosity ("We predicted X and it happened").

Add format functions for each new slice with verbosity-aware output:

| Slice | compact | standard | detailed |
|-------|---------|----------|----------|
| `contentPipeline` | Counts only (briefs: 3, posts: 1, gaps: 5) | + top coverage gaps + decay alerts + subscriptions | + full brief/post titles + matrix breakdown + schema deployment |
| `siteHealth` | Score + critical issues count | + performance summary + anomaly count | + link health + schema errors + change velocity |
| `pageProfile` | Keywords + health score | + architecture position + recent outcomes | + full recommendation list + change history |
| `clientSignals` | Churn risk level + ROI trend + composite health | + engagement summary + approval delays | + full signal breakdown + feedback items + chat topics |
| `operational` | Pending counts (approvals, actions, recs) | + top priority recommendations + recent activity + time-saved | + full timeline + playbook suggestions |

*3A-3: Implement `tokenBudget` truncation (§20)*

The truncation priority chain from §20, currently unimplemented:
1. Drop `operational` first (lowest value density)
2. Truncate `insights` to top 5
3. Drop `clientSignals`
4. Summarize `learnings` to one-line
5. Never drop `seoContext`

*3A-4: Complete unwired Phase 2 bridges (#1, #10, #12, #15) + read-time bridges (#8, #9, #14)*

**Phase 2 debt — write-time bridges with infrastructure built but never wired to trigger points:**

- **Bridge #1** (outcome→reweight insight scores): `debouncedOutcomeReweight` exists in `bridge-infrastructure.ts` but `recordOutcome()` in `outcome-tracking.ts` never calls it. Wire: import `debouncedOutcomeReweight` + `withWorkspaceLock` in `outcome-tracking.ts`, add the reweight logic after outcome recording (query scored actions, compute page→score map, adjust non-resolved insight impact scores). Only fire for actionable scores (strong_win, win, loss).
- **Bridge #10** (anomaly→boost insight severity): `debouncedAnomalyBoost` exists but is never called. Wire: in `anomaly-detection.ts` after detecting anomalies for a page, call `debouncedAnomalyBoost(workspaceId, ...)` to boost existing insights for the same page.
- **Bridge #12** (audit complete→page_health insights): `bridge-audit-page-health` flag defined but `fireBridge()` never called. Wire: after audit completion (in `scheduled-audits.ts` or audit route), call `fireBridge('bridge-audit-page-health', wsId, ...)` to create/update `page_health` insights from critical audit issues.
- **Bridge #15** (audit complete→site_health insights): Same pattern. Wire: `fireBridge('bridge-audit-site-health', wsId, ...)` to create site-level health insights from aggregate audit findings.

**New read-time bridges:**

- **Bridge #8**: Content decay → check `getActionsByPage()` for prior refresh actions + outcomes. Tag as `repeat_decay` if prior refresh scored `loss`. Boost priority. Feed into `contentPipeline` slice.
- **Bridge #9**: Keyword recommendations → query `getWorkspaceLearnings()` for win-rate-by-KD-range. Weight recommendations toward KD ranges with empirical wins. Feed into `seoContext` enrichment.
- **Bridge #14**: Outcome learnings updated → recompute intelligence signals. Deferred from Phase 2 batch 4. Wired in `recomputeAllWorkspaceLearnings()` daily cron.

*3A-5: Absorb mini context builders*

Three modules build their own "intelligence" independently of the intelligence layer. Their logic should be **extracted into slice assemblers** so every consumer benefits:

| Builder to absorb | Current location | Absorb into |
|-------------------|-----------------|-------------|
| `buildBriefIntelligenceBlock()` | `content-brief.ts` | `insights` slice (cannibalization warnings, decay alerts, quick wins, page health) — already partially there via insights, but brief-specific enrichment should be a `pageProfile` query |
| `buildPlanContextForPage()` | `schema-suggester.ts` | `seoContext` (strategy) + `pageProfile` (architecture, keywords) + `siteHealth` (schema errors) |
| `buildPageAnalysisContext()` | `seo-context.ts` | `pageProfile` slice (audit issues, recommendations, keyword analysis for a specific page) |

**Important — two-step absorption:**
- **Phase 3A ("extract"):** The slice assemblers are built to pull the same underlying data these builders use. The existing builder functions continue to work — no callers change. Both paths coexist.
- **Phase 3B ("replace"):** Callers that used these builders switch to `formatForPrompt()`. The builder functions become dead code and are removed. This is when "absorbed" is fully complete.

*3A-6: Wire `INTELLIGENCE_CACHE_UPDATED` WebSocket event*

Already defined in both `server/ws-events.ts` and `src/ws-events.ts` but never broadcast. Add `broadcastToWorkspace(wsId, WS_EVENTS.INTELLIGENCE_CACHE_UPDATED, ...)` in `invalidateIntelligenceCache()`. Frontend `useWebSocket` handler invalidates the `useWorkspaceIntelligence` React Query key.

*3A-7: Background scheduler → intelligence cache invalidation*

Background schedulers produce data consumed by intelligence slices but don't invalidate the cache, causing up to 5 minutes of stale data after job completion. Add `invalidateIntelligenceCache(workspaceId)` at the end of each scheduler's workspace processing:

| Scheduler | File | Invalidates slice(s) |
|-----------|------|---------------------|
| Scheduled audits | `scheduled-audits.ts` | `siteHealth` (audit score changed) |
| Churn signal detection | `churn-signals.ts` | `clientSignals` (new churn signals) |
| Anomaly detection | `anomaly-detection.ts` | `siteHealth` + `insights` (new anomalies + anomaly digest insights) |
| Outcome measurement | `outcome-crons.ts` | `learnings` (new scores computed) |
| Learnings recomputation | `outcome-crons.ts` | `learnings` (aggregated learnings updated) |
| Playbook detection | `outcome-crons.ts` | `learnings` (new playbook patterns) |

Since these run infrequently (6-24h intervals), the invalidation cost is negligible.

*3A-8: Shared types expansion*

New/updated interfaces in `shared/types/intelligence.ts` for the 5 new slice shapes:
- `ContentPipelineSlice` (expand beyond current summary — add subscriptions, schema progress, rewritePlaybook)
- `SiteHealthSlice` (expand beyond current audit-only shape)
- `PageProfileSlice` (new)
- `ClientSignalsSlice` (new — includes keyword feedback patterns, business priorities, ROI, engagement metrics, churn signals, composite health score, content gap vote patterns)
- `OperationalSlice` (new — includes timeSaved, approvalQueue, recommendationQueue, actionBacklog, detectedPlaybooks)
- Expand `SeoContextSlice` to include rank tracking + keyword recs + strategy history + businessProfile + backlink profile + SERP features
- Expand `LearningsSlice` to include ROI attribution data + WeCalledItEntry references
- New supporting types: `BusinessProfile`, `RewritePlaybook`, `BacklinkProfile`, `SerpFeatures`, `EngagementMetrics`, `CompositeHealthScore`
- Ensure all existing slice types match §3 return type definitions (15 type gaps identified by audit)

**3A quality gate:** Compare `/api/intelligence/:wsId` response (all 8 slices populated) against each individual data source. Every number in the intelligence response must match the underlying store. No behavior changes to validate — just data correctness.

---

**Phase 3B — Migrate consumers to the intelligence layer (behavior changes)**

3B changes what AI endpoints and frontend components actually receive. The intelligence layer is proven correct from 3A; now we switch consumers to use it.

*3B-1: AI endpoint migration (27 callers, prioritized by frequency and risk)*

**Migration pattern for each caller:**
```typescript
// Before (caller-specific context assembly):
const ctx = buildSeoContext(workspaceId, pagePath, 'content');
const prompt = `${ctx.fullContext}\n\nGenerate a brief for...`;

// After (unified intelligence):
const intel = await buildWorkspaceIntelligence(workspaceId, { pagePath, learningsDomain: 'content' });
const context = formatForPrompt(intel, { verbosity: 'compact' });
const prompt = `${context}\n\nGenerate a brief for...`;
```

Migration order (lowest risk → highest risk):

| Batch | Callers | Verbosity | Risk | Rationale |
|-------|---------|-----------|------|-----------|
| B1 | `llms-txt-generator.ts`, `routes/misc.ts` (smart name) | compact | Very low | Currently get ZERO context — any intelligence is an improvement, no regression possible |
| B2 | `schema-suggester.ts`, `schema-plan.ts`, `anomaly-detection.ts` | standard | Low | Currently bypass buildSeoContext entirely — switching to intelligence adds context they never had |
| B3 | `content-brief.ts`, `content-posts-ai.ts`, `content-decay.ts` | compact | Medium | Currently use buildSeoContext + additional builders. Replace buildSeoContext + buildBriefIntelligenceBlock with formatForPrompt |
| B4 | `routes/webflow-seo.ts`, `aeo-page-review.ts`, `internal-links.ts`, `keyword-recommendations.ts` | compact/standard | Medium | Currently use buildSeoContext + buildPageAnalysisContext. Replace with formatForPrompt (page-aware via pagePath option) |
| B5 | `seo-audit.ts`, `routes/rewrite-chat.ts`, `routes/jobs.ts` | standard/detailed | Medium-high | Audit and chat are user-facing, quality-sensitive |
| B6 | `admin-chat-context.ts` | detailed | High | 947 lines, 35 data sources, 15-category classifier. Partial migration: delegate 5 intelligence-covered categories (search, audit, content, strategy, insights) to `buildWorkspaceIntelligence()`. Keep question classifier + chat-specific formatting + remaining 10 categories. |
| B7 | `insight-narrative.ts`, `monthly-digest.ts`, `routes/public-analytics.ts` (search-chat) | compact/detailed | Medium | **Client-facing AI features.** Currently build context independently. Narrative reframing gains access to learnings ("we've seen title changes produce 2x CTR for your site"). Monthly digest gains personalized outcomes ("organic traffic value grew $X"). Client chat gets same partial migration as admin chat (B6 pattern). |

**Per-batch quality gate:** Generate sample outputs using both old and new paths. Compare for relevance, accuracy, actionability. Only proceed to next batch if equal or better. Document findings.

*3B-2: Frontend consolidation (60-80 API calls → 30-40 for dashboard views)*

Migrate frontend hooks from individual API calls to `useWorkspaceIntelligence()` where the intelligence layer now provides the same data:

| Current hook(s) | Calls saved | Replace with |
|----------------|-------------|--------------|
| `useContentPipeline` (4 calls: briefs, posts, matrices, decay) | 4 → 0 | `useWorkspaceIntelligence({ slices: ['contentPipeline'] })` |
| `useContentCalendar` (4 calls: briefs, posts, requests, matrices) | 4 → 0 | `useWorkspaceIntelligence({ slices: ['contentPipeline'] })` |
| `useWorkspaceOverviewData` (6 calls: overview, activity, anomalies, presence, feedback, time-saved) | 4 → 0 | `useWorkspaceIntelligence({ slices: ['operational', 'siteHealth'] })` (keep presence + time-saved as individual) |
| `useOutcomeScorecard` + `useOutcomeLearnings` + `useOutcomePlaybooks` | 3 → 0 | `useWorkspaceIntelligence({ slices: ['learnings'] })` for summary views (detail views keep individual hooks) |

**Important:** Frontend migration is incremental. Components that need full detail (e.g., individual brief editing, post versioning) keep their dedicated hooks. Only summary/dashboard views switch to intelligence.

*3B-3: Bridge #16 + bridge execution dashboard*

- **Bridge #16**: Client-facing narratives → query `clientSignals` slice (populated in 3A) to adjust narrative tone. More value-demonstration language for at-risk clients. Note: This fires during 3B batch B7 narrative generation (server-side), NOT the Phase 4 client intelligence API endpoint (which is a separate consumer).
- **Bridge execution dashboard**: Admin UI showing bridge status, recent executions, error counts. Uses the bridge metadata already logged by `fireBridge()`.

*3B-4: Wire admin components to `useWorkspaceIntelligence()`*

Components that currently fetch data individually switch to the intelligence hook for cross-system context:
- Strategy views get win-rate data from learnings
- Pipeline views get decay history from siteHealth
- Audit views get related insights + outcome history

*3B-5: Fix broken WebSocket feedback loops*

The deep audit found events broadcast into the void and silent mutations. These must be fixed for the intelligence layer's real-time invalidation to work correctly:

**Broken events (broadcast but never handled on frontend):**

| Event | Broadcast by | Fix |
|-------|-------------|-----|
| `feedback:new` | `feedback.ts` | Define `FEEDBACK_CREATED` in `WS_EVENTS`, add handler in `useWsInvalidation` to invalidate feedback query key |
| `feedback:update` | `feedback.ts` | Define `FEEDBACK_UPDATED` in `WS_EVENTS`, add handler |
| `post-updated` | `routes/content-posts.ts` | Define `POST_UPDATED` in `WS_EVENTS`, add handler to invalidate content post query keys |

**Silent mutations (no broadcast at all):**

| Mutation | File | Fix |
|----------|------|-----|
| Annotation creation | `routes/annotations.ts` | Broadcast `ANNOTATION_BRIDGE_CREATED` (already defined) |
| AEO review operations | `routes/aeo-review.ts` | Broadcast `WORKSPACE_UPDATED` or new `AEO_REVIEW_COMPLETE` event |
| Churn signal dismissal | `routes/churn-signals.ts` | Broadcast to invalidate churn signal query key |
| Keyword strategy save | `routes/keyword-strategy.ts` | Already calls `invalidateIntelligenceCache()` but doesn't broadcast `INTELLIGENCE_CACHE_UPDATED` — fixed by 3A-6 |

**3B quality gate:** Full AI quality comparison (§22) — 10 briefs + 5 strategies generated via both old and new paths. Side-by-side comparison for relevance, accuracy, actionability, hallucination rate. Frontend: verify no regressions in dashboard load time, data accuracy, empty states. All WebSocket events verified: defined → broadcast → handled → cache invalidated.

---

*Deferred to Phase 4:*
- Topic clusters in intelligence payload (lower priority, depends on cluster detection quality)
- Real shadow-mode divergence detection (meaningful only after 3B migration is complete)
- Complete `admin-chat-context.ts` migration (3B starts partial migration of 5 categories; Phase 4 completes remaining 10 as clientSignals/operational slices mature)
- GA4/GSC analytics accessor migration (original spec §5 "future" — `getWorkspaceAnalytics()`, `getWorkspaceSearchData()` — deferred because `api-cache.ts` handles these adequately and the frontend hooks for analytics detail views need the full per-metric granularity)

**Phase 4 — Client portal + infrastructure**
- Client intelligence endpoint with tier-gated narrative framing (§23)
- Complete `admin-chat-context.ts` migration (remaining 10 question categories as clientSignals/operational slices mature)
- Complete client `search-chat` migration (same pattern — Phase 3B starts, Phase 4 finishes)
- Data retention policies (intelligence cache, outcome archives, old insights)
- Scheduled intelligence refresh crons (proactive cache warming for active workspaces)
- Freshness timestamp infrastructure (`lastUpdatedAt` per slice)
- Topic clusters in intelligence payload
- GA4/GSC analytics accessor migration (if warranted by usage patterns) — raw GA4/GSC metrics as an `analytics` slice
- Monthly reports/emails powered by intelligence (currently use raw queries — migrate to `formatForPrompt()` with `detailed` verbosity)
- Client portal usage tracking (login frequency, feature engagement, page views → feeds `clientSignals.engagement.portalUsage`)
- Proactive client notifications powered by intelligence — 5 identified opportunities:
  1. "New opportunity detected" when high-impact insight created for client's pages
  2. "Action complete" when outcome measurement finishes with win/strong_win
  3. "Content ready for review" when brief/post enters approval state
  4. "Monthly performance summary" digest email powered by intelligence context
  5. "At-risk alert" internal notification when composite health score drops below threshold
- Competitor schema intelligence — aggregate competitor schema types from SEMRush into `seoContext`
- Admin chat session history aggregation → `clientSignals.recentChatTopics` (analyze topic frequency for pattern detection)

---

## 11. Shared Types (`shared/types/intelligence.ts`)

New file exporting:
- `IntelligenceSlice` union type
- `IntelligenceOptions` interface
- `WorkspaceIntelligence` interface (and all nested interfaces)
- `PromptFormatOptions` interface
- `ContentPipelineSummary` interface
- `PageProfile` interface

**Existing types referenced by the intelligence interfaces (DO NOT redefine):**
- `KeywordStrategy` — `shared/types/workspace.ts`
- `AudiencePersona` — `shared/types/workspace.ts` (note: NOT `Persona`)
- `PageKeywordMap` — `shared/types/workspace.ts` (note: NOT `PageKeywordAnalysis`)
- `TrackedAction`, `ActionOutcome`, `WorkspaceLearnings`, `ActionPlaybook`, `OutcomeScore` — `shared/types/outcome-tracking.ts`
- `AnalyticsInsight`, `InsightType`, `InsightSeverity` — `shared/types/analytics.ts`
- `WebflowPage` — `server/webflow-pages.ts` (server-only; re-export or reference from intelligence types)

All types defined BEFORE implementation begins (per multi-agent coordination rules).

---

## 12. Error Handling & Graceful Degradation

The intelligence layer MUST follow the existing `admin-chat-context.ts` pattern: **no subsystem failure should crash the assembly.** Every data source is optional.

### Assembly pattern

```typescript
function buildWorkspaceIntelligence(workspaceId: string, opts?: IntelligenceOptions): WorkspaceIntelligence {
  const result: WorkspaceIntelligence = { workspaceId, assembledAt: new Date().toISOString() };

  for (const slice of requestedSlices) {
    try {
      result[slice] = assembleSlice(workspaceId, slice, opts);
    } catch (err) {
      logger.warn({ workspaceId, slice, err }, 'Intelligence slice assembly failed — skipping');
      // result[slice] remains undefined — consumers check for presence
    }
  }

  return result;
}
```

### Rules

1. **Every slice is independently try/caught** — a failed insights query doesn't prevent learnings from loading
2. **Consumers must check for presence** — `if (intelligence.insights)` before accessing, never assume a slice exists
3. **Log failures with context** — unlike current silent `.catch(() => null)` pattern, log which slice failed and why (Pino structured logging)
4. **Async sources use timeout** — any external API call within assembly gets a 5-second timeout via `Promise.race()` to prevent hung requests from blocking the full assembly
5. **`formatForPrompt()` handles missing slices** — omits sections for undefined slices, never errors on partial data

### Frontend behavior

The `useWorkspaceIntelligence` hook returns partial data as it becomes available. Components render whatever slices are present and show `<Skeleton>` placeholders for missing ones. No error boundaries triggered for missing intelligence slices — only for complete API failures.

---

## 13. Performance & Memory Management

### Assembly cost

`buildWorkspaceIntelligence()` with all slices queries ~10 subsystems (not 39 raw data sources — most sources are pre-aggregated in the 4 existing stores). Estimated assembly time:

| Slice | Source | Cost | Notes |
|-------|--------|------|-------|
| seoContext | In-memory cache (5-min TTL) | <1ms | Already cached by `buildSeoContext()` |
| insights | SQLite query | ~5ms | `getInsights()` — add LIMIT 100 to prevent unbounded reads |
| learnings | SQLite + in-memory (24h TTL) | <1ms | Already cached by `getWorkspaceLearnings()` |
| pageProfile | SQLite (3 queries) | ~10ms | page_keywords + insights + actions for one page |
| contentPipeline | SQLite (5 COUNT queries) | ~5ms | Aggregate counts, not full row reads |
| siteHealth | SQLite (cached audit snapshot) | <1ms | Latest snapshot already in memory after first read |
| clientSignals | SQLite (3 queries) | ~5ms | keyword_feedback + gap_votes + approvals |
| operational | SQLite (2 queries) | ~3ms | Recent activity + annotations |

**Total estimated: ~30ms for full assembly** (all slices). Most consumers request 2-3 slices, so typical cost is <10ms.

### Memory limits

1. **Intelligence meta-cache**: In-memory `Map<string, { value: WorkspaceIntelligence; expiry: number }>` with **max 200 entries** (LRU eviction). Each entry ~10-50KB depending on workspace size.
2. **Webflow page cache**: In-memory `Map` with max 100 entries (one per workspace:siteId pair). Each entry ~5-20KB.
3. **Insights returned to intelligence**: Capped at top 100 by impact_score (not unbounded `getInsights()`)
4. **Actions/outcomes in page profile**: Capped at most recent 20 per page

### Cache stampede prevention

When a cache entry expires and multiple concurrent requests hit `buildWorkspaceIntelligence()`, we use a **single-flight pattern**: the first request computes; concurrent requests wait for the same Promise rather than triggering parallel recomputation.

```typescript
const inflight = new Map<string, Promise<WorkspaceIntelligence>>();

function buildWorkspaceIntelligence(wsId, opts) {
  const key = cacheKey(wsId, opts);
  if (inflight.has(key)) return inflight.get(key)!;

  const promise = doAssembly(wsId, opts).finally(() => inflight.delete(key));
  inflight.set(key, promise);
  return promise;
}
```

---

## 14. Feature Flag Strategy

The intelligence layer uses the existing `outcome-ai-injection` feature flag for gradual rollout. This flag already gates learnings injection in `seo-context.ts`, `monthly-digest.ts`, and `admin-chat-context.ts`.

### Rollout phases

| Phase | Flag state | Behavior |
|-------|-----------|----------|
| **Development** | OFF (default) | `buildWorkspaceIntelligence()` exists but `buildSeoContext()` still used directly. New code can opt-in. |
| **Staging validation** | ON via env var | All intelligence features active on staging. Verify correctness + performance. |
| **Production soft launch** | ON via admin UI | Enable globally. Monitor Pino logs for slice failures, Sentry for errors. |
| **Production full** | ON + migrate consumers | Existing `buildSeoContext()` callers migrated to full intelligence. Flag becomes permanent ON. |

### Feature flag usage in intelligence layer

```typescript
// In buildWorkspaceIntelligence():
if (requestedSlices.includes('learnings')) {
  if (isFeatureEnabled('outcome-ai-injection')) {
    result.learnings = assembleLearningsSlice(workspaceId, opts);
  }
  // If flag is OFF, learnings slice is simply omitted — consumers handle absence
}
```

The flag gates the **new intelligence slices** (learnings, clientSignals, operational), not the entire layer. SEO context assembly always works regardless of flag state.

---

## 15. Database Migrations

One new migration required: `043-intelligence-caching-layer.sql`

### Existing infrastructure (no changes needed except `resolution_source` column added above)

| Table | Migration(s) | Used by bridges | Notes |
|-------|-------------|-----------------|-------|
| `analytics_annotations` | 036-analytics-annotations.sql | Bridge #13 (auto-annotate) | Columns: workspace_id, date, label, category, created_by |
| `analytics_insights` | 035 (create), 037 (fix unique), 038 (enrichment + impact_score), 040 (resolution_status/note/resolved_at) | Bridges #1, 4, 7, 10, 12, 15 | Note: `page_id` column (maps to `pageId` in TS via `rowToInsight()`) |
| `tracked_actions` + `action_outcomes` + `workspace_learnings` + `action_playbooks` | 041-outcome-tracking.sql | Bridges #4, 6, 8, 13, 14 | |
| `feature_flag_overrides` | 042-feature-flag-overrides.sql | Feature flag rollout, per-bridge flags | Columns: key (PK), enabled, updated_at |

**Note:** Migration numbering is non-sequential — some numbers have multiple files (035, 036, 037 each have two migration files for different features).

### New migration

```sql
-- 043-intelligence-caching-layer.sql

-- Add bridge source tagging to analytics_insights (for rollback auditability, §19)
-- Column does NOT currently exist — required for Bridge #7, #12, #15 source tagging
ALTER TABLE analytics_insights ADD COLUMN resolution_source TEXT;

-- Workspace-level intelligence sub-caches (for surgical invalidation)
CREATE TABLE IF NOT EXISTS intelligence_sub_cache (
  workspace_id TEXT NOT NULL,
  cache_key TEXT NOT NULL,  -- 'seoContext', 'insights', 'learnings', etc.
  ttl_seconds INTEGER NOT NULL,
  cached_at TEXT NOT NULL DEFAULT (datetime('now')),
  invalidated_at TEXT,
  data TEXT NOT NULL,  -- JSON blob
  PRIMARY KEY (workspace_id, cache_key),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);

-- Suggested briefs (auto-generated by Bridge #2: decay → brief)
CREATE TABLE IF NOT EXISTS suggested_briefs (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  keyword TEXT NOT NULL,
  page_url TEXT,
  source TEXT NOT NULL DEFAULT 'content_decay',  -- origin: 'content_decay', 'coverage_gap', etc.
  reason TEXT NOT NULL,  -- human-readable reason for suggestion
  priority TEXT NOT NULL DEFAULT 'medium',  -- 'high', 'medium', 'low'
  status TEXT NOT NULL DEFAULT 'pending',  -- 'pending', 'accepted', 'dismissed'
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at TEXT,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_suggested_briefs_workspace ON suggested_briefs(workspace_id, status);

-- Content pipeline summary cache (pre-computed counts)
CREATE TABLE IF NOT EXISTS content_pipeline_cache (
  workspace_id TEXT PRIMARY KEY,
  summary_json TEXT NOT NULL DEFAULT '{}',
  cached_at TEXT NOT NULL DEFAULT (datetime('now')),
  invalidated_at TEXT,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);
```

**Note:** The primary intelligence meta-cache (`buildWorkspaceIntelligence` result) is **in-memory only** with 5-min TTL — it doesn't need DB persistence because it's cheap to recompute from the sub-caches. The DB-backed sub-caches are for expensive computations (content pipeline aggregation) that survive server restarts.

---

## 16. Relationship to Existing Systems

### `admin-chat-context.ts` — coexists, then gradually delegates

This file already assembles ~35 data sources (conditionally, based on question classification) with a 15-category question classifier using `Promise.allSettled()`. The intelligence layer does NOT replace it immediately. Instead:

**Phase 1:** `admin-chat-context.ts` continues to work as-is. `buildWorkspaceIntelligence()` is a parallel system.

**Phase 3A:** No changes to `admin-chat-context.ts`. Intelligence layer becomes complete in the background.

**Phase 3B (Batch B6 — last migration batch):** Partial migration:
1. Keep its question classification logic (15 categories — unique to chat)
2. For 5 categories already covered by intelligence slices, delegate data assembly:
   - `strategy` → `seoContext` slice (strategy + rank tracking + keyword recs)
   - `audit` → `siteHealth` slice (audit score, links, schema, performance)
   - `content` → `contentPipeline` slice (briefs, posts, matrices, requests, decay)
   - `insights` → `insights` slice (analytics intelligence)
   - `search` → `seoContext` slice (rank tracking data, keyword performance)
3. Keep direct imports for remaining 10 categories (analytics/GA4, performance, approvals, activity, ranks detail, competitors, client, page_analysis, content_review, general) — these either need granularity the intelligence layer doesn't provide or don't have complete slice coverage yet
4. Keep its prompt formatting logic (chat-specific formatting differs from generic `formatForPrompt()`)

**Phase 4 (complete):** Once `clientSignals` and `operational` slices are fully mature, migrate remaining categories:
   - `client` → `clientSignals` slice
   - `approvals` → `operational` slice
   - `activity` → `operational` slice
   - `general` → multiple slices (full intelligence with `detailed` verbosity)
   - `performance` → `siteHealth` slice (once PageSpeed + CWV data is in the slice)

The question classifier and chat-specific formatting remain permanently — they're unique to chat.

This avoids a risky big-bang migration. The chat context module is the most complex consumer (947 lines, ~35 data sources, 15-category question classifier) and should be the last to fully migrate.

### `insight-feedback.ts` — replaced by event bridges

This file's orchestrator function `runFeedbackLoops(workspaceId)` is called after insight computation completes. It calls `buildStrategySignals(insights): StrategySignal[]` and `buildPipelineSignals(insights): PipelineSignal[]`, then broadcasts `WS_EVENTS.INTELLIGENCE_SIGNALS_UPDATED` with signal counts. Bridges #2, #14, and the scheduled intelligence refresh (Section 9b) replace this functionality:

- `buildStrategySignals()` → absorbed into Bridge #14 (learnings → recompute signals)
- `buildPipelineSignals()` → absorbed into Bridge #2 (decay → auto-suggest brief)
- The broadcast logic moves to the bridge implementation

The signal builder functions themselves (`buildStrategySignals`, `buildPipelineSignals`) are preserved as utility functions — only the `runFeedbackLoops` orchestration layer changes.

### `seo-context.ts` — delegates internally

`buildSeoContext()` continues to work with its existing signature. Internally it delegates to `buildWorkspaceIntelligence({ slices: ['seoContext'] })` and maps the result back to the `SeoContext` return type. The 26 existing callers don't need to change.

---

## 17. Testing Strategy

### Unit tests

| Module | What to test | Pattern |
|--------|-------------|---------|
| `workspace-data.ts` | Cache hit/miss, TTL expiry, invalidation, concurrent requests return same data | Mock `listPages()`, assert cache behavior |
| `workspace-intelligence.ts` | Slice assembly, partial failure graceful degradation, cache key generation, single-flight dedup | Mock each subsystem, verify partial results when one throws |
| `formatForPrompt()` | Verbosity levels produce correct token ranges, missing slices omitted gracefully, token budget truncation | Snapshot tests for each verbosity level with known intelligence data |
| Event bridges (each) | Trigger fires, correct downstream mutation occurs, idempotency (duplicate trigger doesn't double-write) | Mock the trigger, assert the side effect |

### Integration tests

| Scenario | What to verify |
|----------|---------------|
| Full assembly with live DB | `buildWorkspaceIntelligence()` with all slices returns valid typed object from seeded test workspace |
| Bridge #7 (action → auto-resolve insight) | `recordAction()` for a page with unresolved insight → insight status becomes 'in_progress' |
| Bridge #13 (action → auto-annotate) | `recordAction()` → annotation row created with correct date/label/pageUrl |
| Bridge #1 (outcome scored → insight reweight) | `recordOutcome()` with 'strong_win' → related insight's `impact_score` increases |
| Cache invalidation cascade | `updateWorkspace()` → intelligence cache invalidated → next `buildWorkspaceIntelligence()` returns fresh data |
| Webflow page cache dedup | Two concurrent `getWorkspacePages()` calls → only one `listPages()` API call |

### E2E tests (Playwright)

| Scenario | What to verify |
|----------|---------------|
| Admin dashboard shows intelligence | Navigate to WorkspaceHome → intelligence data renders (win rate, top insights, pipeline health) |
| Strategy page shows learnings | Navigate to KeywordStrategy → KD range win rates visible |
| Action creates annotation | Publish content → performance chart shows annotation at today's date |

### Test data seeding

Create a `test/fixtures/intelligence-seed.ts` that populates a test workspace with:
- 10 analytics insights (mix of types and severities)
- 5 tracked actions with outcomes (3 wins, 1 loss, 1 neutral)
- Workspace learnings computed from the actions
- 3 content briefs, 2 published posts, 1 content request
- Keyword strategy with page map
- 1 audit snapshot with issues
- 2 annotations

This seed is reusable across all intelligence layer tests.

### Regression protection

After the intelligence layer ships, add these checks to `scripts/pr-check.ts`:
- No direct `listPages()` + `filterPublishedPages()` calls outside of `workspace-data.ts` (enforce the shared accessor)
- No new `buildSeoContext()` calls in new files (should use `buildWorkspaceIntelligence` instead)
- No `recordAction()` calls without a corresponding `// Bridge #7/#13 handled by post-hook` comment or direct bridge call

---

## 18. Observability & Metrics

The intelligence layer ships with structured metrics from day one. Without observability, we're flying blind on whether the layer is actually helping.

### Required metrics (Pino structured logs)

| Metric | Log field | Purpose |
|--------|-----------|---------|
| Assembly latency | `intelligence.assembly_ms` | Track P50/P95/P99 per workspace. Alert if P95 > 200ms |
| Cache hit/miss per slice | `intelligence.cache.{slice}.hit` | Verify dedup is working. Target: >80% hit rate after warm-up |
| Bridge execution count | `bridge.{id}.executed` | Confirm bridges are firing |
| Bridge execution latency | `bridge.{id}.duration_ms` | Catch slow bridges before they cause cron timeouts |
| Bridge failure count | `bridge.{id}.failed` | Alert if any bridge fails >5% of invocations |
| Webflow API calls saved | `workspace_data.pages.cache_hit` | Quantify the 22→1 dedup. Report weekly |
| Token usage per AI call | `ai.{endpoint}.context_tokens` | Track cost delta before/after intelligence injection |
| Slice assembly failure | `intelligence.slice.{name}.error` | Per-slice failure rate — catch degraded assemblies |

### Implementation

All metrics are emitted as structured Pino log fields (not a separate metrics system). The existing `createLogger(module)` pattern is used:

```typescript
const logger = createLogger('workspace-intelligence');

// After assembly:
logger.info({
  workspaceId,
  assembly_ms: elapsed,
  slices_requested: opts?.slices ?? 'all',
  slices_returned: Object.keys(result).filter(k => k !== 'workspaceId' && k !== 'assembledAt'),
  cache_hits: cacheStats,
}, 'Intelligence assembled');
```

Render log drain can aggregate these for dashboards. No external metrics service required for Phase 1.

### Health check endpoint

```
GET /api/intelligence/health
```

Returns per-workspace cache stats, bridge execution counts (last 24h), and current memory usage. Admin-only (behind HMAC auth gate). Used for debugging "why is workspace X showing stale data?"

---

## 19. Rollback Strategy & Bridge Source Tagging

### The risk

Event bridges perform write-side mutations. If a bridge has a bug:
- Bridge #1 could inflate impact scores across all insights
- Bridge #7 could auto-resolve insights that shouldn't be resolved
- Bridge #13 could flood the annotation timeline with noise

These mutations are mixed into existing tables alongside user-generated data, making them hard to identify and revert.

### Source tagging (mandatory for all bridge writes)

Every row written by a bridge includes a `source` field identifying the bridge:

```typescript
// Bridge #7: auto-resolve insight
db.prepare(`
  UPDATE analytics_insights
  SET resolution_status = 'in_progress',
      resolution_source = 'bridge_7_auto_resolve',
      resolved_at = datetime('now')
  WHERE id = ?
`).run(insightId);

// Bridge #13: auto-annotate
createAnnotation({
  workspaceId,
  date: new Date().toISOString().split('T')[0],
  label: `Action: ${action.label}`,
  category: 'action',
  createdBy: 'bridge_13_auto_annotate',
});
```

**Convention:** `bridge_{number}_{short_name}` as the source identifier. This enables:
- `SELECT * FROM analytics_insights WHERE resolution_source LIKE 'bridge_%'` — find all bridge-written data
- Bulk revert: `UPDATE analytics_insights SET resolution_status = 'unresolved', resolution_source = NULL WHERE resolution_source = 'bridge_7_auto_resolve' AND resolved_at > '2026-04-01'`

### Dry-run mode

Phase 2 bridges ship with a `INTELLIGENCE_BRIDGES_DRY_RUN` env var. When enabled:
- Bridges log what they *would* do (with full context) but don't write
- This runs on staging for 1 week before enabling writes
- Per-bridge dry-run is also possible via the bridge feature flag map (see §24)

### Revert procedure

If a bridge is found to be writing incorrect data:
1. Disable the specific bridge via per-bridge feature flag (§24)
2. Query affected rows: `WHERE resolution_source = 'bridge_N_...' AND resolved_at > {deploy_date}`
3. Revert with targeted UPDATE/DELETE
4. Fix the bridge logic
5. Re-enable with dry-run first

---

## 20. AI Cost Impact Analysis

### Token budget by verbosity

| Verbosity | Approximate tokens | When to use |
|-----------|-------------------|-------------|
| `compact` | ~500 | High-frequency endpoints: brief generation, rewrites, alt text, meta descriptions |
| `standard` | ~1,500 | Medium-frequency: strategy generation, content analysis, schema suggestions |
| `detailed` | ~3,000 | Low-frequency: full audit, monthly digest, admin chat (complex questions) |

### Cost estimation

Assumptions: GPT-4.1 at ~$2/M input tokens, ~$8/M output tokens. Claude at ~$3/M input, ~$15/M output.

| Scenario | Current context tokens | With intelligence | Delta | Monthly cost delta (est.) |
|----------|----------------------|-------------------|-------|--------------------------|
| Brief generation (×200/mo) | ~800 (seoContext only) | ~1,300 (compact) | +500 | +$0.20 |
| Strategy generation (×50/mo) | ~1,200 | ~2,700 (standard) | +1,500 | +$0.15 |
| Admin chat (×500/mo) | ~3,000 (full context) | ~3,000 (detailed, same) | 0 | $0 (already paying this) |
| Content rewrite (×300/mo) | ~600 | ~1,100 (compact) | +500 | +$0.30 |
| Monthly digest (×20/mo) | ~2,000 | ~5,000 (detailed) | +3,000 | +$0.12 |

**Estimated total monthly cost increase: ~$1–3/month** at current usage. This is negligible — the intelligence quality improvement vastly outweighs the cost.

### Default verbosity per endpoint category

To prevent accidental cost bloat, each AI endpoint category has a default verbosity:

```typescript
const ENDPOINT_VERBOSITY_DEFAULTS: Record<string, PromptFormatOptions['verbosity']> = {
  // Batch B1 (currently zero context — any intelligence is an improvement)
  'llms-txt': 'compact',
  'smart-name': 'compact',
  // Batch B2 (currently bypass buildSeoContext entirely)
  'schema-suggestion': 'standard',
  'schema-plan': 'standard',
  'anomaly-summary': 'compact',
  // Batch B3 (content generation — high frequency)
  'brief-generation': 'compact',
  'content-post': 'compact',
  'content-rewrite': 'compact',
  'content-decay': 'compact',
  // Batch B4 (page-specific SEO — medium frequency)
  'seo-rewrite': 'compact',
  'aeo-review': 'compact',
  'internal-links': 'compact',
  'keyword-analysis': 'standard',
  // Batch B5 (user-facing, quality-sensitive)
  'seo-audit': 'standard',
  'rewrite-chat': 'standard',
  'background-job': 'standard',
  // Batch B6 (admin chat — most complex)
  'admin-chat': 'detailed',
  // Batch B7 (client-facing AI features)
  'insight-narrative': 'compact',
  'monthly-digest': 'detailed',
  'client-chat': 'detailed',
  // Future
  'full-audit': 'detailed',
};
```

### Model context window safety

`formatForPrompt()` accepts `tokenBudget` and enforces it via truncation priority:
1. If over budget, drop `operational` slice first (lowest value density)
2. Then truncate `insights` to top 5 (from 10)
3. Then drop `clientSignals`
4. Then summarize `learnings` to one-line summary
5. Never drop `seoContext` (core context always needed)

This priority chain is configurable per-call but has sensible defaults. GPT-4.1 (128K) and Claude (200K) both have ample room — truncation only matters for `compact` verbosity where callers want minimal injection.

---

## 21. Backfill Strategy

### Cold start behavior

When the intelligence layer deploys, every workspace starts with empty caches.

**Policy: on-demand population, no retroactive backfill.**

Rationale:
- Assembly is fast (~30ms) — the first request populates the cache with negligible UX impact
- Retroactive backfill for bridges (#13 annotations, #2 suggested briefs) would create misleading historical data — users would see annotations for actions that happened months ago suddenly appear on their timeline
- The `assembledAt` timestamp tells consumers how fresh the data is

### Per-slice cold start behavior

| Slice | Cold start return | UX |
|-------|-------------------|-----|
| seoContext | Populated immediately (delegates to existing `buildSeoContext()`) | No change from current |
| insights | Empty array if no insights computed yet | "No insights yet — data collection in progress" empty state |
| learnings | `null` summary, `'low'` confidence | "Not enough data to show learnings" |
| pageProfile | All fields null/empty | Skeleton → "Analyze this page to see its profile" CTA |
| contentPipeline | All zeros | Accurately reflects empty pipeline |
| siteHealth | All nulls | "Run your first audit to see site health" CTA |
| clientSignals | Empty arrays, null churnRisk | Hidden in client portal (no section rendered) |
| operational | Empty arrays, 0 pending jobs | Minimal — just shows "no recent activity" |

### Cache warming (optional optimization)

If cold start latency becomes noticeable for high-traffic workspaces:
```typescript
// Run once after deploy, or as a background job
async function warmIntelligenceCache(workspaceIds: string[]) {
  for (const wsId of workspaceIds) {
    await buildWorkspaceIntelligence(wsId, { slices: ['seoContext', 'insights', 'learnings'] });
    // Stagger to avoid burst
    await sleep(100);
  }
}
```

This is not required for Phase 1 but is available if needed.

---

## 22. Deployment Sequencing & Soak Times

### Phase soak requirements

| Phase | Minimum soak on staging | Minimum soak on production | Gate to next phase |
|-------|------------------------|---------------------------|-------------------|
| Phase 1 (foundation) | 3 days | 1 week | Cache hit rate >80%, zero Sentry errors from intelligence module, assembly P95 <100ms |
| Phase 2 (bridges) | 5 days (includes dry-run) | 2 weeks | All bridges firing correctly (verified via logs), zero data corruption, no cron timeout increase |
| Phase 3A (slice completion) | 2 days | 3 days | All 8 slice assemblers return real data, formatForPrompt covers all 8 slices, tokenBudget truncation works, every intelligence API value matches underlying store, zero Sentry errors |
| Phase 3B (consumer migration) | 5 days | 1 week | AI quality comparison passes (10 briefs + 5 strategies, old vs new path — equal or better), all 6 migration batches complete, frontend dashboard load ≤ current, no empty states regression |
| Phase 4 (client + infra) | 3 days | 1 week | Client portal renders correctly, retention crons running, no data leakage across workspaces, admin-chat-context fully migrated |

### Phase 2 deployment sequence (bridges are high-risk)

1. Deploy bridge code with `INTELLIGENCE_BRIDGES_DRY_RUN=true`
2. Soak 3 days on staging, review dry-run logs
3. Enable bridges one at a time (via per-bridge flags), starting with lowest-risk:
   - **Batch 1** (low-risk, read-only side effects): Bridge #5 (cache clear), Bridge #3 (cache invalidation), Bridge #11 (cascade invalidation)
   - **Batch 2** (medium-risk, write new rows): Bridge #13 (auto-annotate), Bridge #2 (suggested briefs)
   - **Batch 3** (higher-risk, modify existing rows): Bridge #7 (auto-resolve), Bridge #1 (reweight scores), Bridge #10 (boost severity)
   - **Batch 4** (cross-system): Bridge #12 (audit→insights), Bridge #14 (learnings→signals), Bridge #15 (audit→insights)
4. Each batch soaks 2 days before enabling the next

### Phase 3A → 3B gate: Data correctness verification

Before any consumer migration (3B), verify 3A data correctness:
1. For each of the 8 slices, compare `/api/intelligence/:wsId` response values against the underlying store queries
2. Verify `formatForPrompt()` output at all 3 verbosity levels — check for truncation bugs, missing sections, token budget violations
3. Verify `INTELLIGENCE_CACHE_UPDATED` WebSocket fires on invalidation
4. Run `npx vitest run` — all existing tests pass (3A is additive, nothing should break)

### Phase 3B gate: AI quality comparison (per-batch)

Each migration batch (B1-B7) requires a quality comparison before proceeding to the next:

**For each batch:**
1. Generate sample outputs using BOTH old path (current) and new path (intelligence layer)
2. Compare side-by-side for: relevance, factual accuracy, actionability, hallucination rate
3. Document findings in a comparison log
4. Only proceed if new path is **equal or better**

**Full comparison (before declaring 3B complete):**
- 10 content briefs (Batch B3) — old buildSeoContext + buildBriefIntelligenceBlock vs. formatForPrompt(compact)
- 5 keyword strategies (Batch B4) — old buildSeoContext vs. formatForPrompt(standard)
- 5 SEO rewrites (Batch B4) — old buildSeoContext + buildPageAnalysisContext vs. formatForPrompt(compact, { pagePath })
- 3 admin chat conversations (Batch B6) — old assembleAdminContext vs. partial intelligence delegation
- 3 schema suggestions (Batch B2) — old buildPlanContextForPage (no SEO context) vs. formatForPrompt(standard)
- 3 client insight narratives (Batch B7) — old template-based reframing vs. intelligence-enriched narratives
- 1 monthly digest (Batch B7) — old independent data assembly vs. intelligence-powered digest with learnings + outcomes

**Expected improvement areas:** Batches B1 and B2 (callers that currently get zero or minimal context) should show clear quality improvements. Batches B3-B5 should be equal or better. Batch B6 (admin chat) should maintain quality while reducing code complexity. Batch B7 (client AI) should show the most visible improvement — clients see richer, more personalized narratives.

---

## 23. Client Endpoint Security

### Authentication

`GET /api/public/intelligence/:workspaceId` uses the same auth stack as all `/api/public/` routes:
- Client JWT (24h, per-workspace) via `Authorization: Bearer` header or `token` cookie
- `requireWorkspaceAccess` middleware validates the JWT's `workspaceId` matches the URL parameter
- No cross-workspace access possible — JWT is scoped to exactly one workspace

### Tier-based filtering

The client intelligence endpoint applies tier gating server-side:

```typescript
function filterForClientTier(intelligence: WorkspaceIntelligence, tier: 'free' | 'growth' | 'premium'): ClientIntelligence {
  return {
    // All tiers: basic insights summary, pipeline status
    insightsSummary: intelligence.insights ? summarizeForClient(intelligence.insights) : null,
    pipelineStatus: intelligence.contentPipeline ? formatPipelineForClient(intelligence.contentPipeline) : null,

    // Growth+: outcome learnings, win highlights
    ...(tier !== 'free' && {
      learningHighlights: intelligence.learnings ? formatLearningsForClient(intelligence.learnings) : null,
    }),

    // Premium only: full page profiles, client signals, site health detail
    ...(tier === 'premium' && {
      pageProfiles: intelligence.pageProfile ?? null,
      siteHealthDetail: intelligence.siteHealth ?? null,
      clientSignals: intelligence.clientSignals ?? null,
    }),
  };
}
```

### Data scrubbing

The client endpoint NEVER returns:
- Raw insight `impact_score` values (internal ranking metric)
- Admin-only insight types (`strategy_alignment`)
- `churnRisk` field (internal operational signal)
- `operational` slice (admin-only)
- Bridge source tags (`resolution_source`)
- Raw keyword difficulty scores (reframed as "competition level: high/medium/low")

### Rate limiting

The client intelligence endpoint inherits the global API rate limiter. No additional endpoint-specific limiting needed for Phase 4 — monitor usage post-launch and add if necessary.

---

## 24. Per-Bridge Feature Flags

### Kill switch map

Each bridge has an independent enable/disable toggle, stored as a simple config object:

```typescript
// server/intelligence-bridges.ts
const BRIDGE_FLAGS: Record<number, { enabled: boolean; dryRun: boolean }> = {
  1:  { enabled: true, dryRun: false },  // outcome → reweight
  2:  { enabled: true, dryRun: false },  // decay → brief
  3:  { enabled: true, dryRun: false },  // strategy → cache
  // Bridge 4 is already implemented natively — no flag needed
  5:  { enabled: true, dryRun: false },  // page analysis → cache
  // Bridge 6 intentionally skipped — low value (anomaly → action annotation enrichment)
  7:  { enabled: true, dryRun: false },  // action → auto-resolve
  8:  { enabled: true, dryRun: false },  // decay → check prior refresh (read-time)
  9:  { enabled: true, dryRun: false },  // recommendations → check win rates (read-time)
  10: { enabled: true, dryRun: false },  // anomaly → boost severity
  11: { enabled: true, dryRun: false },  // knowledge → cascade invalidation
  12: { enabled: true, dryRun: false },  // audit → insights
  13: { enabled: true, dryRun: false },  // action → annotate
  14: { enabled: true, dryRun: false },  // learnings → signals
  15: { enabled: true, dryRun: false },  // audit → insights
  16: { enabled: true, dryRun: false },  // churn → tone (read-time)
};
```

### Override mechanism

Three-tier priority (same pattern as existing feature flags):
1. **DB override** — `feature_flag_overrides` table: `bridge_1_enabled`, `bridge_1_dry_run`
2. **Environment variable** — `BRIDGE_1_ENABLED=false`, `BRIDGE_1_DRY_RUN=true`
3. **Hardcoded default** — the map above

### Bridge execution wrapper

```typescript
function executeBridge(bridgeId: number, workspaceId: string, fn: () => void): void {
  const flags = getBridgeFlags(bridgeId);
  if (!flags.enabled) return;

  const logger = createLogger(`bridge-${bridgeId}`);
  const start = Date.now();

  try {
    if (flags.dryRun) {
      logger.info({ workspaceId, bridgeId, dryRun: true }, 'Bridge would execute (dry-run)');
      return;
    }
    fn();
    logger.info({ workspaceId, bridgeId, duration_ms: Date.now() - start }, 'Bridge executed');
  } catch (err) {
    logger.error({ workspaceId, bridgeId, err, duration_ms: Date.now() - start }, 'Bridge failed');
    // Bridge failures never propagate — the triggering operation succeeds regardless
  }
}
```

---

## 25. Concurrency, Debouncing & Write Amplification

### Per-workspace mutex for bridge execution

Bridges that modify shared rows (Bridges #1, #7, #10) need mutual exclusion to prevent race conditions:

```typescript
const workspaceLocks = new Map<string, Promise<void>>();

async function withWorkspaceLock(workspaceId: string, fn: () => Promise<void>): Promise<void> {
  const existing = workspaceLocks.get(workspaceId);
  const execute = async () => {
    if (existing) await existing.catch(() => {}); // wait for prior
    await fn();
  };
  const promise = execute().finally(() => {
    if (workspaceLocks.get(workspaceId) === promise) {
      workspaceLocks.delete(workspaceId);
    }
  });
  workspaceLocks.set(workspaceId, promise);
  return promise;
}
```

This is a lightweight in-memory lock (not distributed — single-server monolith). It ensures that two concurrent bridge executions for the same workspace serialize rather than race.

### Debounce for burst events

High-frequency events (GSC sync delivers 50+ keyword updates, page crawl syncs 20+ pages) must be debounced:

```typescript
const bridgeDebounce = new Map<string, NodeJS.Timeout>();

function debounceBridge(bridgeId: number, workspaceId: string, fn: () => void, delayMs = 2000): void {
  const key = `${bridgeId}:${workspaceId}`;
  const existing = bridgeDebounce.get(key);
  if (existing) clearTimeout(existing);

  bridgeDebounce.set(key, setTimeout(() => {
    bridgeDebounce.delete(key);
    executeBridge(bridgeId, workspaceId, fn);
  }, delayMs));
}
```

**Debounce policy:**
- Bridges #3, #5, #11 (cache invalidation): debounce 2 seconds — multiple invalidations within 2s collapse into one
- Bridges #1, #10 (score modification): debounce 5 seconds — wait for batch of outcomes/anomalies to settle
- Bridges #7, #13 (per-action): NO debounce — each action should create its own annotation and resolve its own insight immediately
- Bridge #2 (decay → brief): NO debounce — decay detection runs at most once per cron cycle

### Batch coalesce for cache invalidation

When multiple events invalidate the same cache within the debounce window, only one recomputation fires:

```typescript
// In invalidateIntelligenceCache():
// Instead of immediately recomputing, mark as stale
// The next read triggers recomputation (lazy invalidation)
function invalidateIntelligenceCache(workspaceId: string): void {
  intelligenceCache.delete(workspaceId); // just delete — don't recompute
  // The single-flight pattern in buildWorkspaceIntelligence() handles the rest
}
```

---

## 26. Bridge Transactional Guarantees

### Rule: every bridge that writes to 2+ tables uses `db.transaction()`

Per CLAUDE.md: "Multi-step DB mutations must use `db.transaction()`". This applies to all write-time bridges.

### Per-bridge transaction boundaries

| Bridge | Tables touched | Transaction? | Notes |
|--------|---------------|-------------|-------|
| #1 (outcome → reweight) | `analytics_insights` (UPDATE) | Single table — no transaction needed, single UPDATE |
| #2 (decay → brief) | `suggested_briefs` (INSERT) | Single table — no transaction needed |
| #3 (strategy → cache) | In-memory cache only | N/A |
| #5 (page analysis → cache) | In-memory cache only | N/A |
| #7 (action → auto-resolve) | `analytics_insights` (UPDATE) | Single table — no transaction needed |
| #10 (anomaly → boost) | `analytics_insights` (UPDATE) | Single table — no transaction needed |
| #11 (knowledge → cascade) | In-memory cache only | N/A |
| #12 (audit → insights) | `analytics_insights` (multiple INSERTs) | **YES — transaction** — inserting N insight rows from one audit must be atomic |
| #13 (action → annotate) | `analytics_annotations` (INSERT) | Single table — no transaction needed |
| #14 (learnings → signals) | In-memory recomputation | N/A |
| #15 (audit → insights) | `analytics_insights` (multiple INSERTs) | **YES — transaction** — same as #12 |

### Bridge #12/#15 transaction pattern

```typescript
executeBridge(12, workspaceId, () => {
  const doInsert = db.transaction((issues: AuditIssue[]) => {
    for (const issue of issues) {
      // Deduplicate: skip if insight already exists for this page + type
      const existing = stmts().findInsight.get(workspaceId, issue.pageUrl, 'page_health');
      if (existing) continue;

      stmts().insertInsight.run({
        id: crypto.randomUUID(),
        workspaceId,
        type: 'page_health',
        source: 'bridge_12_audit_insights',
        // ... other fields
      });
    }
  });
  doInsert(auditIssues);
});
```

---

## 27. Cron Timeout Risk & Async Bridge Execution

### The risk

Existing cron jobs on Render have implicit timeouts. If bridges run synchronously within cron handlers, they extend execution time:

| Cron | Frequency | Current duration (est.) | Added bridge overhead | Risk |
|------|-----------|------------------------|----------------------|------|
| Scheduled audit checker | Hourly (checks if due per workspace `intervalDays`) | ~60s per workspace when triggered | Bridge #12/#15 (audit→insights): ~100ms per issue batch | **Medium** — but audit is already slow |
| Learnings recompute (`outcome-crons.ts`) | Daily | ~5s per workspace | Bridge #14 (signals recompute): ~50ms | **Low** |
| Anomaly detection | **12 hours** | ~20s per workspace | Bridge #10 (boost severity): ~10ms per anomaly | **Low** |
| Outcome measurement | Daily | ~10s per workspace | Bridges #1 (reweight): ~20ms per outcome | **Low** |
| Content decay (triggered within anomaly detection or ad-hoc) | Not a dedicated cron | ~10s per workspace | Bridge #2 (suggested briefs): ~20ms per decay item | **Medium** — 50 decaying pages = 1s |

**Note:** There is no dedicated hourly GSC sync cron. GSC data is fetched on-demand via route handlers. Cache invalidation bridges (#3, #5) fire on workspace settings save and page analysis completion, not cron triggers.

### Policy: bridges run synchronously but with a hard timeout

Most bridge overhead is negligible (<50ms). The risk is manageable with:

1. **Per-bridge timeout**: 5 seconds max. If a bridge hasn't completed in 5s, log a warning and move on.
2. **Bridge failures never block the parent operation**: The triggering cron/mutation always succeeds. Bridge failure is logged but swallowed (already enforced by `executeBridge()` wrapper).
3. **Monitor bridge duration**: If any bridge consistently takes >1s, refactor to async (queue for background processing).

### Escape hatch: async bridge execution

If a bridge is too slow for synchronous execution, it can be enqueued instead:

```typescript
// Future pattern (not needed for Phase 2 launch, but designed in)
function enqueueBridge(bridgeId: number, workspaceId: string, payload: unknown): void {
  // Insert into a lightweight job queue table
  db.prepare(`
    INSERT INTO bridge_queue (bridge_id, workspace_id, payload, created_at)
    VALUES (?, ?, ?, datetime('now'))
  `).run(bridgeId, workspaceId, JSON.stringify(payload));
}

// Processed by a background cron every 30s
```

This is NOT implemented in Phase 2 but the `executeBridge()` wrapper makes the switch transparent to callers.

---

## 28. Suggested Briefs UX Lifecycle

### User-facing workflow

Bridge #2 creates `suggested_briefs` rows. These surface in the Content Pipeline UI as a new "Suggested" tab or section:

### Admin experience

1. **Visibility**: Suggested briefs appear in the Content Pipeline page with a distinct visual treatment (dashed border, "AI Suggested" badge in teal)
2. **Actions per suggestion**:
   - **Accept** → creates a real content brief (pre-populated with the keyword, page URL, and reason), removes the suggestion
   - **Dismiss** → soft-deletes the suggestion (`status = 'dismissed'`), won't re-suggest the same keyword+page for 90 days
   - **Snooze** → hides for 30 days (`status = 'snoozed'`, `snoozed_until` timestamp)
3. **Bulk actions**: Select multiple suggestions → bulk accept (creates briefs) or bulk dismiss

### Accumulation limits

- **Max 20 pending suggestions per workspace** — if limit reached, new suggestions replace the lowest-priority existing ones
- **Auto-expire after 60 days** — suggestions older than 60 days are automatically dismissed (decay data that old is stale)
- **Deduplication**: never create a suggestion if a brief already exists for the same keyword, or if a suggestion for the same keyword+page was dismissed within the last 90 days

### Client visibility

Suggested briefs are NOT visible in the client portal. They're an internal workflow tool for the agency admin. Clients see the resulting briefs after acceptance.

### DB schema additions (extend `suggested_briefs` table)

```sql
ALTER TABLE suggested_briefs ADD COLUMN snoozed_until TEXT;
ALTER TABLE suggested_briefs ADD COLUMN dismissed_keyword_hash TEXT;  -- for 90-day dedup
```

---

## 29. Zero-Data & Onboarding Workspaces

### Problem

A brand-new workspace has no GSC connected, no pages, no keywords, no audit history. Every data accessor returns empty. The intelligence layer must handle this gracefully — not with errors, not with misleading empty dashboards, but with helpful onboarding prompts.

### Per-accessor empty-state returns

| Accessor | Empty state return | Type |
|----------|-------------------|------|
| `getWorkspacePages()` | `[]` | Empty array |
| `getContentPipelineSummary()` | All zeros | `ContentPipelineSummary` with 0 counts |
| `buildSeoContext()` | Generic context (no brand, no keywords) | `SeoContext` with empty blocks |
| Insights query | `[]` | Empty array |
| Learnings query | `{ summary: null, confidence: null }` | Null summary |
| Page keywords | `null` | No analysis |
| Audit snapshot | `null` | No audit |
| Client signals | Empty arrays, `null` churn | No signals |

### `formatForPrompt()` cold-start behavior

When assembling a prompt for a workspace with no intelligence data:

```typescript
// If all slices are empty/null, formatForPrompt returns a minimal context block:
`[Workspace Intelligence]
This workspace is newly onboarded. Limited data available.
${brandVoice ? `Brand voice: ${brandVoice}` : 'No brand voice configured yet.'}
${strategy ? `Strategy: ${strategy.summary}` : 'No keyword strategy generated yet.'}
Recommendation: Focus on establishing baseline data before making optimization decisions.`
```

This prevents AI features from hallucinating recommendations based on no data — the prompt explicitly tells the model that data is limited.

### Frontend empty states

Components using `useWorkspaceIntelligence()` check for cold-start conditions:

```typescript
const { data: intelligence } = useWorkspaceIntelligence(workspaceId, ['insights', 'learnings']);

// In render:
if (!intelligence?.insights?.all.length && !intelligence?.learnings?.summary) {
  return <EmptyState
    icon={<SparklesIcon />}
    title="Intelligence is warming up"
    description="Connect your data sources and run your first audit to start seeing cross-system intelligence."
    cta={{ label: "Configure workspace", onClick: () => navigate(adminPath(workspaceId, 'settings')) }}
  />;
}
```

### Onboarding progress tracking

The intelligence health check (§18) includes an "onboarding completeness" score:

```typescript
interface OnboardingStatus {
  hasWebflow: boolean;
  hasGsc: boolean;
  hasGa4: boolean;
  hasBrandVoice: boolean;
  hasStrategy: boolean;
  hasAudit: boolean;
  completeness: number; // 0-100
}
```

This helps both the admin ("your workspace is 40% set up") and the intelligence layer ("don't try to compute learnings for a workspace with no tracked actions").

---

## 30. Stale Cache Serving Policy

### The problem

When a sub-cache is invalidated but recomputation fails (DB error, timeout, external API down), the system must decide: serve stale data, serve nothing, or error?

### Policy: serve stale with staleness indicator

```typescript
interface CacheEntry<T> {
  data: T;
  cachedAt: number;
  ttl: number;
  stale: boolean; // true if invalidated but recomputation failed
}

function getFromCache<T>(key: string): { data: T; stale: boolean } | null {
  const entry = cache.get(key);
  if (!entry) return null;

  const expired = Date.now() - entry.cachedAt > entry.ttl;
  if (expired && !entry.stale) {
    // TTL expired naturally — try to recompute
    return null; // cache miss, triggers fresh assembly
  }
  if (entry.stale) {
    // Invalidated but recomputation failed — serve stale with flag
    return { data: entry.data, stale: true };
  }
  return { data: entry.data, stale: false };
}
```

### Consumer-specific behavior

| Consumer | Stale data behavior |
|----------|-------------------|
| **AI prompts** (`formatForPrompt`) | Serve stale — slightly outdated context is better than no context. Add `[Note: Some data may be up to {age} old]` to prompt when stale |
| **Admin UI** | Serve stale with visual indicator — yellow "Last updated: 2h ago" badge. Never block rendering |
| **Client portal** | Serve stale silently — clients don't need to know about infrastructure staleness. The `assembledAt` timestamp is available but not prominently displayed |
| **Background jobs/crons** | Skip stale data — crons should use fresh data or skip the workspace. Log a warning and retry next cycle |

### Maximum staleness

No data older than **24 hours** is ever served, even as stale. If a cache entry is >24h old and recomputation keeps failing, the slice returns `undefined` (as if no data exists). This prevents severely outdated intelligence from causing harm.

---

## 31. Interface Versioning

### Response version field

The `WorkspaceIntelligence` interface includes a version:

```typescript
interface WorkspaceIntelligence {
  version: 1;  // Incremented when breaking changes are made to the shape
  workspaceId: string;
  assembledAt: string;
  // ... slices
}
```

### Compatibility rules

1. **Adding new optional fields**: Non-breaking. No version bump needed. Frontend ignores unknown fields.
2. **Adding a new slice**: Non-breaking. Frontend checks `if (intelligence.newSlice)` — undefined means not available.
3. **Changing a field type or removing a field**: Breaking. Requires version bump + frontend migration.
4. **`formatForPrompt()` output changes**: Non-breaking for AI endpoints (they just pass the string to the model). No versioning needed.

### Deploy safety

During a rolling deploy, the frontend might be on version N+1 while the backend is still on version N. Since all slices are optional and consumers check for presence, this is safe — the frontend simply doesn't render data it doesn't receive.

The `version` field is primarily for debugging ("which version of the intelligence schema is this workspace running?") and future-proofing, not for active branching logic.

---

## 32. Developer Guardrails & Documentation

### "How to add intelligence to a new feature" guide

Create `docs/adding-intelligence.md` (internal, not shipped):

```markdown
# Adding Intelligence to a Feature

## For AI endpoints (server-side)
1. Import `buildWorkspaceIntelligence` from `server/workspace-intelligence.ts`
2. Choose slices relevant to your feature
3. Call `formatForPrompt()` with appropriate verbosity
4. Inject the result into your prompt

## For admin components (frontend)
1. Import `useWorkspaceIntelligence` from `src/hooks/admin/`
2. Choose slices relevant to your component
3. Handle loading + empty states
4. NEVER directly query intelligence subsystems — use the hook

## For new data sources
1. Add accessor to `server/workspace-data.ts`
2. Add slice to `WorkspaceIntelligence` interface
3. Add assembly logic in `workspace-intelligence.ts`
4. Add formatter section in `formatForPrompt()`
5. Update this guide
```

### PR check rules (additions to `scripts/pr-check.ts`)

Phase 1 ships with these new automated checks:

```typescript
// No direct subsystem queries in new AI features
// (existing files grandfathered, new files must use intelligence layer)
{
  name: 'intelligence-layer-usage',
  pattern: /getInsights|getWorkspaceLearnings|getActionsByPage/,
  exclude: ['workspace-intelligence.ts', 'workspace-data.ts', /* existing files */],
  message: 'New files should use buildWorkspaceIntelligence() instead of querying subsystems directly',
},

// No inline query keys for intelligence
{
  name: 'intelligence-query-keys',
  pattern: /queryKey:\s*\[['"]admin-intelligence/,
  message: 'Use queryKeys.admin.intelligence() factory, not inline strings',
},
```

### Onboarding for new features

When a new admin component or AI endpoint is created, the PR template includes:
- [ ] Does this feature need workspace intelligence? If yes, which slices?
- [ ] Is the intelligence hook wired with proper empty state handling?
- [ ] Is the verbosity level appropriate for the call frequency?

---

## 33. Memory Budget

### Cache memory ceiling

Instead of a flat entry count, caches enforce a memory budget:

| Cache | Max entries | Est. per-entry size | Memory ceiling |
|-------|------------|--------------------|--------------|
| Intelligence meta-cache | 200 | 10–50 KB | ~10 MB |
| Webflow page cache | 100 | 5–20 KB | ~2 MB |
| SEO context cache (existing) | 100 | 2–5 KB | ~0.5 MB |
| Content pipeline cache | 100 | 1–3 KB | ~0.3 MB |
| Bridge debounce timers | ~50 | <1 KB | Negligible |
| Single-flight inflight map | ~10 | Promise ref only | Negligible |

**Total estimated memory: ~13 MB maximum** across all intelligence layer caches. On a 512 MB Render instance, this is ~2.5% of available memory — well within safe limits.

### LRU implementation

All in-memory caches use a simple LRU with max-entries eviction:

```typescript
class LRUCache<T> {
  private cache = new Map<string, { value: T; accessedAt: number }>();
  constructor(private maxEntries: number) {}

  get(key: string): T | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;
    entry.accessedAt = Date.now();
    return entry.value;
  }

  set(key: string, value: T): void {
    if (this.cache.size >= this.maxEntries) {
      // Evict least recently accessed
      let oldest: string | null = null;
      let oldestTime = Infinity;
      for (const [k, v] of this.cache) {
        if (v.accessedAt < oldestTime) { oldest = k; oldestTime = v.accessedAt; }
      }
      if (oldest) this.cache.delete(oldest);
    }
    this.cache.set(key, { value, accessedAt: Date.now() });
  }

  delete(key: string): void { this.cache.delete(key); }
  clear(): void { this.cache.clear(); }
  get size(): number { return this.cache.size; }
}
```

### Memory monitoring

The health check endpoint (§18) reports current cache sizes:

```json
{
  "caches": {
    "intelligence": { "entries": 42, "maxEntries": 200 },
    "pages": { "entries": 15, "maxEntries": 100 },
    "seoContext": { "entries": 38, "maxEntries": 100 },
    "pipeline": { "entries": 12, "maxEntries": 100 }
  }
}
```

If any cache is consistently at >90% capacity, it's a signal to either increase the limit or investigate whether workspaces are being evicted too aggressively.

---

## 34. Non-Goals (explicitly out of scope)

- **Generic event bus** — we use targeted bridges, not pub/sub infrastructure
- **Real-time intelligence streaming** — query-time assembly with caching is sufficient
- **GA4/GSC accessor migration in Phases 1-3** — existing `api-cache.ts` handles these adequately for now; conditionally deferred to Phase 4 if usage patterns warrant it
- **Full frontend redesign** — admin components get intelligence data via hook; visual changes are incremental
- **New insight types** — the intelligence layer consumes existing insight types; adding new types is a separate effort
- **Copy & Brand Engine integration** — the intelligence layer is designed to support it, but the Copy Engine spec is a separate body of work
- **Distributed caching** — single-server monolith; in-memory LRU with DB-backed sub-caches is sufficient
- **Bridge job queue** — bridges run synchronously with timeout; async queue designed in but not implemented unless needed

---

## 35. Success Criteria

### Functional
1. **Every AI feature** gets full platform intelligence via one function call (27 callers migrated)
2. **Zero duplicate Webflow API calls** across features (down from 22) ✅ Phase 1
3. **Outcome learnings** visibly inform keyword recommendations and insight prioritization
4. **Actions auto-resolve** related insights and auto-create timeline annotations ✅ Phase 2
5. **Admin components** show cross-system intelligence (win rates in strategy, decay history in pipeline)
6. **Client narratives** reference outcome history ("we predicted this improvement")
7. **All data retention** policies defined and enforced via cron (Phase 4)
8. **`buildSeoContext()` backward compat** — existing consumers work without changes ✅ Phase 1
9. **All 8 intelligence slices** return real data from 20+ underlying modules (Phase 3A)
10. **5 admin AI callers** that currently get zero SEO context gain full intelligence (Phase 3B batch B1-B2)
10a. **3 client AI features** (narratives, digest, chat) gain intelligence context (Phase 3B batch B7 — partial for search-chat, completed in Phase 4)
11. **Mini context builders absorbed** — `buildBriefIntelligenceBlock`, `buildPlanContextForPage`, `buildPageAnalysisContext` replaced by intelligence slice queries (Phase 3B)
12. **Frontend API calls reduced** from 60-80 to 30-40 per workspace dashboard load (Phase 3B — ~15 calls consolidated via intelligence hook; remaining calls are detail-view hooks that stay individual)
13. **Content decay → outcome → refresh cycle connected** — repeat_decay detection via Bridge #8 (Phase 3A)
14. **Client health score unified** — churn signals + ROI + engagement in `clientSignals` slice (Phase 3A)

### Operational
15. **Cache hit rate >80%** after 1 week of production traffic ✅ Phase 1
16. **Assembly P95 <100ms** for full intelligence (all 8 slices)
17. **Zero bridge-related data corruption** through Phase 2 soak period ✅ Phase 2
18. **All bridges independently toggleable** via per-bridge feature flags ✅ Phase 2
19. **Every bridge write tagged** with source identifier for auditability ✅ Phase 2
20. **Zero cross-workspace data leakage** verified by integration tests
21. **Memory usage <15 MB** across all intelligence layer caches
22. **Zero-data workspaces** render helpful onboarding states, never errors
23. **AI quality comparison passes** for all 7 migration batches (Phase 3B gate)
24. **Background schedulers invalidate intelligence cache** after producing new data (Phase 3A)
25. **Zero broken WebSocket feedback loops** — every broadcast has a frontend handler (Phase 3B)
26. **Client input signals flow into intelligence** — keyword feedback patterns, business priorities, gap votes inform AI recommendations (Phase 3A)
27. **Personas always formatted** — formatForPrompt() includes persona context at every verbosity level (Phase 3A bug fix)
28. **Composite client health score computed** — single 0-100 number combining churn risk + ROI + engagement (Phase 3A)
29. **Outcome proof ("we called it") in intelligence** — WeCalledItEntry available in learnings slice for client narratives (Phase 3A)
30. **SEMRush data connected** — backlink profile + SERP features flow into seoContext slice (Phase 3A)
31. **Monthly reports use intelligence** — email generation powered by formatForPrompt() instead of raw queries (Phase 4)
32. **Time-saved metrics in operational slice** — AI usage log aggregated for workspace productivity measurement (Phase 3A)

---

## 36. Codebase Audit Findings (April 2026)

> Added after Phases 1-2 completion. Full codebase audit identified gaps not visible when the original spec was written.

### Scale of the opportunity

| Metric | Before intelligence layer | After Phase 3B target |
|--------|--------------------------|----------------------|
| Data modules in codebase | 55+ | — |
| Connected to intelligence layer | 5 (9%) | 30+ (55%) |
| AI callers (callOpenAI/callAnthropic) | 27 | — |
| AI callers using formatForPrompt() | 0 (0%) | 30 (100% — 27 admin + 3 client) |
| Frontend hooks using useWorkspaceIntelligence | 1 (WorkspaceHome) | 10+ |
| API calls per workspace dashboard load | 60-80 | 30-40 |

### Parallel "mini intelligence assemblers" discovered

The original spec assumed `buildSeoContext()` was the only context builder. The audit found **5 independent context assembly patterns**:

| Builder | Location | Purpose | Absorbed by |
|---------|----------|---------|-------------|
| `buildSeoContext()` | seo-context.ts | Strategy, brand voice, personas, knowledge | `seoContext` slice (Phase 1) |
| `buildKeywordMapContext()` | seo-context.ts | Keyword assignments for cannibalization prevention | `seoContext` slice (Phase 3A) |
| `buildPageAnalysisContext()` | seo-context.ts | Page audit issues + recommendations | `pageProfile` slice (Phase 3A) |
| `buildBriefIntelligenceBlock()` | content-brief.ts | Cannibalization, decay, quick wins, page health | `pageProfile` + `insights` slices (Phase 3A) |
| `buildPlanContextForPage()` | schema-suggester.ts | Business context + architecture + competitor schemas | `seoContext` + `pageProfile` + `siteHealth` slices (Phase 3A) |
| `assembleAdminContext()` | admin-chat-context.ts | 35 data sources with question classification | Partial migration Phase 3B B6, complete Phase 4 |

### AI callers with zero intelligence context

5 of 27 AI callers receive no SEO/brand context at all:

| Caller | File | Current context | Impact |
|--------|------|----------------|--------|
| LLMs.txt generator | llms-txt-generator.ts | Page URL + title only | Generates page summaries without brand awareness |
| Smart image naming | routes/misc.ts | Alt text + page title | Names images without brand/strategy context |
| Schema suggester | schema-suggester.ts | Custom page context only | Generates schema without knowing brand voice or personas |
| Schema site plan | schema-plan.ts | Architecture + strategy | Plans schemas without learnings or insight data |
| Anomaly summaries | anomaly-detection.ts | Raw anomaly data only | Summarizes anomalies without business context |

### Cross-system connections not yet made

| Connection | Status | Phase |
|------------|--------|-------|
| Rank tracking → seoContext slice | Missing — tracked keyword performance invisible to AI | 3A |
| Site architecture → pageProfile slice | Missing — structural context for pages | 3A |
| Performance snapshots → siteHealth slice | Missing — PageSpeed/CWV data not in health assessment | 3A |
| Churn signals → clientSignals slice | Missing — client risk invisible to intelligence | 3A |
| ROI data → clientSignals slice | Missing — organic traffic value not surfaced | 3A |
| Activity log → operational slice | Missing — temporal context for all actions | 3A |
| Approval queue → operational slice | Missing — blocked workflow state invisible | 3A |
| Recommendations → operational slice | Missing — prioritized action queue not in intelligence | 3A |
| Content decay → outcome → refresh cycle | Broken — decay doesn't know about prior refresh outcomes | 3A (Bridge #8) |
| Keyword recs → learnings win rates | Missing — recommendations ignore empirical data | 3A (Bridge #9) |
| ROI attribution → learnings slice | Missing — per-action click gains not in intelligence | 3A |
| Client keyword feedback → clientSignals | Missing — approve/decline patterns don't inform AI | 3A |
| Client business priorities → clientSignals | Missing — stated goals don't weight recommendations | 3A |
| Content gap votes → clientSignals | Missing — client interest signals invisible to AI | 3A |
| Strategy history → seoContext | Missing — AI sees current strategy but not trajectory | 3A |
| Content subscriptions → contentPipeline | Missing — recurring commitments invisible | 3A |
| Schema deployment → contentPipeline | Missing — schema progress invisible | 3A |

### Client-facing AI features disconnected from intelligence

3 client-facing AI features build context independently, missing all intelligence:

| Feature | File | Current context | What intelligence adds |
|---------|------|----------------|----------------------|
| Insight narratives | `insight-narrative.ts` | Template-based reframing | Learnings-enriched narratives ("title changes produce 2x CTR for your site") |
| Monthly digest | `monthly-digest.ts` | Independent GSC+GA4+audit queries | Personalized outcomes + ROI attribution ("organic value grew $X because of Y") |
| Client insights chat | `routes/public-analytics.ts` (search-chat) | Own SEO context + rich blocks | Full intelligence context matching admin chat pattern |

### Broken WebSocket feedback loops

| Event | Issue | Impact |
|-------|-------|--------|
| `feedback:new` / `feedback:update` | Broadcast but no frontend handler | Client feedback appears silently, UI doesn't refresh |
| `post-updated` | Broadcast but no frontend handler | Content post edits don't refresh content views |
| `INTELLIGENCE_CACHE_UPDATED` | Defined but never broadcast | Frontend can't react to cache invalidation |
| Annotation creation | No broadcast at all | Annotations created silently |
| AEO review operations | No broadcast at all | Review results don't signal completion |
| Churn signal dismissal | No broadcast at all | Dismissed signals don't refresh UI |

### Background schedulers don't invalidate intelligence cache

6 schedulers produce data consumed by intelligence slices but don't trigger cache invalidation, causing stale data for up to 5 minutes after job completion.

### Prompt formatting gaps (discovered in final sweep)

| Gap | Current behavior | Fix (Phase) |
|-----|-----------------|-------------|
| Personas silently dropped | `formatSeoContextSection()` never formats `seoContext.personas` | 3A-2 (bug fix) |
| knowledgeBase gated to "detailed" only | Most callers use compact/standard → domain knowledge invisible | 3A-2 (move to standard, summary at compact) |
| businessProfile not in intelligence | `getWorkspace().businessProfile` (industry, goals) used only by schema-gen | 3A-1 (add to seoContext slice) |
| rewritePlaybook not in intelligence | `rewrite-chat` uses independent playbook lookup | 3A-1 (add to contentPipeline slice) |
| WeCalledItEntry not surfaced | Outcome proof ("we predicted this") exists but intelligence doesn't reference | 3A-1 (add to learnings slice) |
| ROI attribution not in learnings | Per-action click gains computed but not exposed in intelligence | 3A-1 (add to learnings slice) |
| Composite health score doesn't exist | Churn signals, ROI, and engagement are separate — no unified "client health" number | 3A-1 (compute in clientSignals assembler) |
| Time-saved metrics not in intelligence | AI usage log tracks minutes saved per feature but not aggregated in operational slice | 3A-1 (add to operational slice) |

### External data sources not yet connected

| Source | Status | Phase |
|--------|--------|-------|
| SEMRush backlink data | Available via MCP but not in intelligence | 3A (add to seoContext.backlinkProfile) |
| SEMRush SERP features | Available via MCP but not in intelligence | 3A (add to seoContext.serpFeatures) |
| Competitor schema types | Available via SEMRush but siloed | Phase 4 (lower priority) |
| Raw GA4/GSC analytics | Available via api-cache.ts but not in any slice | Phase 4 (explicit analytics slice if warranted) |
| Chat session history | Admin + client chat logs exist but not aggregated | Phase 4 (topic frequency analysis → clientSignals) |

### Systems that should consume intelligence but don't

| System | Currently uses | Should use | Phase |
|--------|---------------|-----------|-------|
| Monthly report emails | Raw queries per metric | `formatForPrompt(intel, { verbosity: 'detailed' })` | Phase 4 |
| Email notification templates | Hard-coded text | Intelligence-informed personalization | Phase 4 |
| Client portal pages | Individual API calls | `useWorkspaceIntelligence()` hook | Phase 4 |
| Content subscription renewal | No intelligence context | Pipeline + learnings for recommendation | Phase 4 |

### Missing tracking (prevents intelligence from being complete)

| What's missing | Impact | Phase |
|----------------|--------|-------|
| Client portal usage (logins, page views, features used) | Can't compute engagement metrics or detect churn signals | Phase 4 |
| Email open/click tracking | Can't measure notification effectiveness | Phase 4 (requires email provider integration) |
| Recommendation follow-through rate | Can't measure which rec categories drive action | 3A (operational slice tracks recommendation status) |
