# Unified Workspace Intelligence — Phase 2 Context Brief

> **Purpose:** This document carries forward everything verified during Phase 1 planning so the Phase 2 plan starts from ground truth, not assumptions. Read this BEFORE writing the Phase 2 plan.

---

## What Phase 1 Built (verify these exist before planning Phase 2)

Before writing Phase 2, confirm these files exist and export what's expected:

| File | Key Exports | Status |
|------|-------------|--------|
| `shared/types/intelligence.ts` | `WorkspaceIntelligence`, `IntelligenceSlice`, `IntelligenceOptions`, `PromptFormatOptions`, `ContentPipelineSummary`, all 8 slice interfaces | Created in Phase 1 |
| `shared/types/feature-flags.ts` | `intelligence-shadow-mode` flag | Added in Phase 1 |
| `server/workspace-intelligence.ts` | `buildWorkspaceIntelligence()`, `formatForPrompt()`, `invalidateIntelligenceCache()`, `getIntelligenceCacheStats()` | Created in Phase 1 |
| `server/workspace-data.ts` | `getWorkspacePages()`, `getWorkspaceAllPages()`, `invalidatePageCache()`, `getPageCacheStats()` | Created in Phase 1 |
| `server/intelligence-cache.ts` | `LRUCache` (with `deleteByPrefix()`), `singleFlight()` | Created in Phase 1 |
| `server/routes/intelligence.ts` | `GET /api/intelligence/:workspaceId`, `GET /api/intelligence/health` | Created in Phase 1 |
| `src/hooks/admin/useWorkspaceIntelligence.ts` | `useWorkspaceIntelligence(wsId, slices?, pagePath?, learningsDomain?)` | Created in Phase 1 |
| `src/api/intelligence.ts` | `intelligenceApi.getIntelligence()`, `intelligenceApi.getHealth()` | Created in Phase 1 |
| `src/lib/queryKeys.ts` | `queryKeys.admin.intelligence(wsId, slices?, pagePath?, learningsDomain?)` | Added in Phase 1 |
| `server/ws-events.ts` | `INTELLIGENCE_CACHE_UPDATED` event | Added in Phase 1 |
| `server/db/migrations/043-intelligence-caching-layer.sql` | `intelligence_sub_cache`, `content_pipeline_cache`, `suggested_briefs` tables; `resolution_source` column on `analytics_insights` | Created in Phase 1 |

### Phase 1 Slices Implemented

- `seoContext` — fully assembled from `buildSeoContext()`
- `insights` — fully assembled from `getInsights()`, capped at 100, grouped by type/severity
- `learnings` — assembled from `getWorkspaceLearnings()` + `getPlaybooks()`

### Phase 1 Slices STUBBED (return undefined)

- `pageProfile` — Phase 2 or 3
- `contentPipeline` — Phase 2
- `siteHealth` — Phase 2 or 3
- `clientSignals` — Phase 3 or 4
- `operational` — Phase 3 or 4

---

## Phase 2 Scope: Event Bridges

Phase 2 implements the **event bridges** — reactive connections that fire when data changes in one subsystem and propagate effects to others.

### Spec Reference

Full bridge definitions: `docs/superpowers/specs/unified-workspace-intelligence.md` §4 (bridges 1-16), §24 (per-bridge feature flags), §25 (concurrency/debouncing), §26 (bridge transactions), §27 (cron integration)

### The 16 Bridges

| # | Trigger | Effect | Category |
|---|---------|--------|----------|
| 1 | Outcome scored → | Reweight insight impact scores | Write-time |
| 2 | Content decay detected → | Auto-suggest brief | Write-time |
| 3 | Strategy updated → | Invalidate intelligence cache | Write-time |
| 4 | Insight acted on → | Record tracked action | Write-time (already exists in `routes/insights.ts:40-64`) |
| 5 | Analysis complete → | Cache sub-results | Write-time |
| 6 | Client feedback → | Adjust keyword priorities | Write-time |
| 7 | Action completed → | Auto-resolve source insight | Write-time |
| 8 | Approval batch resolved → | Update strategy alignment | Write-time |
| 9 | Chat question asked → | Log topic for signals | Write-time |
| 10 | Anomaly confirmed → | Boost insight priority | Write-time |
| 11 | Knowledge base updated → | Cascade to brand voice cache | Write-time |
| 12 | Audit complete → | Generate audit-derived insights | Standalone |
| 13 | Action recorded → | Create timeline annotation | Write-time |
| 14 | Learnings recomputed → | Broadcast strategy signals | Standalone |
| 15 | Audit stored → | Create site health insights | Standalone |
| 16 | Content published → | Update pipeline cache | Write-time |

### Bridge Infrastructure Needed

1. **Bridge execution wrapper** — standardized try/catch, logging, dry-run mode, feature flag check
2. **Per-bridge feature flags** — 16 new flags in `shared/types/feature-flags.ts`
3. **Source tagging** — all bridge-written DB rows tagged with `resolution_source = 'bridge_N_name'` (column added in Phase 1 migration 043)
4. **Debouncing** — per spec §25:
   - Cache invalidation bridges: 2s debounce
   - Score modification bridges: 5s debounce
   - Per-action bridges: no debounce
5. **Bridge transactions** — multi-step bridges use `db.transaction()` per spec §26

---

## Verified Function Signatures (confirmed accurate March 2026)

These were verified line-by-line during Phase 1 planning. Use these exact signatures — don't guess.

### Core Functions

```typescript
// server/seo-context.ts (line 58)
export function buildSeoContext(
  workspaceId?: string,
  pagePath?: string,
  learningsDomain: 'content' | 'strategy' | 'technical' | 'all' = 'strategy',
  internalOpts?: { _skipShadow?: boolean }
): SeoContext
// SYNCHRONOUS. Returns SeoContext with: keywordBlock, brandVoiceBlock, businessContext,
// personasBlock, knowledgeBlock, fullContext, strategy
// NOTE: _skipShadow prevents circular recursion when called from buildWorkspaceIntelligence

// server/analytics-insights-store.ts (line 153)
export function getInsights(workspaceId: string, insightType?: InsightType): AnalyticsInsight[]
// Returns ALL insights (no status filter). Sorted by impact_score DESC.

// server/analytics-insights-store.ts
export function resolveInsight(insightId: string, workspaceId: string, status: string, note?: string): void

// server/workspace-learnings.ts (line 431)
export function getWorkspaceLearnings(workspaceId: string, _domain?: string): WorkspaceLearnings | null
// Second param is unused (underscore prefix). Returns null if no data.

// server/outcome-tracking.ts (line 100)
export function recordAction(params: RecordActionParams): TrackedAction
// IMPORTANT: workspaceId must be a valid FK to workspaces table. Never use siteId.

// server/outcome-tracking.ts (line 193)
export function recordOutcome(params: RecordOutcomeParams): ActionOutcome

// server/outcome-tracking.ts (line 152)
export function getActionsByPage(workspaceId: string, pageUrl: string): TrackedAction[]

// server/outcome-tracking.ts (line 231)
export function getOutcomesForAction(actionId: string): ActionOutcome[]

// server/outcome-playbooks.ts (line 36)
export function getPlaybooks(workspaceId: string): ActionPlaybook[]

// server/content-decay.ts
export function analyzeContentDecay(ws: Workspace): Promise<DecayAnalysis>
// NOTE: Function name is analyzeContentDecay, NOT computeContentDecay.

// server/webflow-pages.ts (line 25)
export async function listPages(siteId: string, tokenOverride?: string): Promise<WebflowPage[]>
// NOTE: siteId FIRST, then optional token override.

// server/webflow-pages.ts (line 34)
export function filterPublishedPages(pages: WebflowPage[]): WebflowPage[]

// server/insight-feedback.ts
export function buildStrategySignals(insights: AnalyticsInsight[]): StrategySignal[]
export function buildPipelineSignals(insights: AnalyticsInsight[]): PipelineSignal[]
export function runFeedbackLoops(workspaceId: string): void
// Broadcasts WS_EVENTS.INTELLIGENCE_SIGNALS_UPDATED

// server/feature-flags.ts (line 78)
export function isFeatureEnabled(flag: FeatureFlagKey): boolean

// server/analytics-annotations.ts
export function createAnnotation(opts: {
  workspaceId: string; date: string; label: string; category: string; createdBy?: string
}): { id: string }
```

### WebSocket Events

```typescript
// server/ws-events.ts — pattern: SCREAMING_CASE: 'kebab-case:snake_case'
// 20 WS_EVENTS + 9 ADMIN_EVENTS as of Phase 1
// Added in Phase 1: INTELLIGENCE_CACHE_UPDATED: 'intelligence:cache_updated'
// Already exists: INTELLIGENCE_SIGNALS_UPDATED (from insight-feedback.ts)
```

### Auth Middleware

```typescript
// server/auth.ts (line 99)
export function requireWorkspaceAccess(paramName: string = 'id'): RequestHandler
// Takes route PARAM NAME, not workspace ID. Returns Express middleware.
// HMAC auth users pass through (no JWT needed for admin routes).
// Safe for all routes — explicitly passes through when no JWT user present.
```

---

## Verified Type Structures

### WorkspaceLearnings (NESTED — not flat)

```typescript
interface WorkspaceLearnings {
  workspaceId: string;
  computedAt: string;
  confidence: LearningsConfidence;        // 'low' | 'medium' | 'high'
  totalScoredActions: number;
  content: ContentLearnings | null;       // winRateByFormat, avgDaysToPage1, etc.
  strategy: StrategyLearnings | null;     // winRateByDifficultyRange, bestIntentTypes, etc.
  technical: TechnicalLearnings | null;   // winRateByFixType, schemaTypesWithRichResults, etc.
  overall: OverallLearnings;              // totalWinRate, strongWinRate, topActionTypes[], recentTrend
}

interface OverallLearnings {
  totalWinRate: number;
  strongWinRate: number;
  topActionTypes: Array<{ type: string; winRate: number; count: number }>;
  recentTrend: LearningsTrend;           // 'improving' | 'stable' | 'declining'
}
```

### KeywordStrategy (field names)

```typescript
interface KeywordStrategy {
  siteKeywords: SiteKeyword[];   // NOT primaryKeywords
  pageMap: PageKeywordMap;       // optional in stored Zod schema
  opportunities: KeywordOpportunity[];
}
```

### AnalyticsInsight (key fields)

```typescript
interface AnalyticsInsight {
  id: string;
  workspaceId: string;
  pageId: string | null;           // camelCase in TS, page_id in DB
  insightType: InsightType;        // 12 values including anomaly_digest
  severity: InsightSeverity;       // 'critical' | 'warning' | 'opportunity' | 'positive'
  impactScore?: number;            // OPTIONAL — may be undefined
  resolutionStatus?: 'in_progress' | 'resolved' | null;
  resolutionNote?: string | null;
  resolvedAt?: string | null;
  // resolution_source: TEXT — added by migration 043, not yet in TS interface
}
```

---

## Verified Database Schemas

### Tables Phase 2 Bridges Will Write To

| Table | Key Columns | Notes |
|-------|-------------|-------|
| `analytics_insights` | `id, workspace_id, page_id, insight_type, data, severity, impact_score, resolution_source` | `resolution_source` added in 043. Bridge-written rows must set this. |
| `tracked_actions` | `id, workspace_id, action_type, source_type, source_id, page_url, ...` | Many optional columns with defaults. |
| `analytics_annotations` | `id, workspace_id, date, label, category, created_by` | No `pageUrl` column — annotation is workspace-scoped. |
| `suggested_briefs` | `id, workspace_id, keyword, page_url, source, reason, priority, status, ...` | Created in 043. Empty until Bridge #2 populates it. |
| `intelligence_sub_cache` | `workspace_id, cache_key, ttl_seconds, cached_at, data` | Created in 043. For surgical cache invalidation. |
| `content_pipeline_cache` | `workspace_id, summary_json, cached_at` | Created in 043. Pre-computed pipeline counts. |

### Tables Phase 2 Bridges Will Read From

| Table | Exists | Schema Verified |
|-------|--------|----------------|
| `content_briefs` | Yes | status column has defaults |
| `content_posts` | Yes | status column present |
| `content_matrices` | Yes | cells stored as JSON array |
| `content_topic_requests` | Yes | status: 'requested' default |
| `work_orders` | Yes | status: 'pending' default |
| `seo_suggestions` | Yes | status: 'pending', 'applied', 'dismissed' |
| `audit_snapshots` | Yes | audit JSON with score + previous_score |
| `redirect_snapshots` | Yes | result JSON with chains array |
| `schema_validations` | Yes | status: valid/warnings/errors |
| `keyword_feedback` | Yes | status: 'approved'/'declined' |
| `content_gap_votes` | Yes | vote: 'up'/'down' |
| `chat_sessions` | Yes | messages as JSON array |
| `churn_signals` | Yes | type, severity per workspace |
| `activity_log` | Yes | MAX_ENTRIES=500 |

---

## Discovered Caveats for Phase 2+

These are real data gaps or architectural notes discovered during Phase 1 audit:

1. **`annotations.pageUrl` doesn't exist** — the `analytics_annotations` table has no page URL column. Phase 2/3 needs a migration to add it, or derive page context from the triggering event.

2. **Rank history is shallow** — `page_keywords` stores `current_position` + `previous_position` only. No deep historical series. `PageProfileSlice.rankHistory.best` must be derived from current/previous, not a historical scan.

3. **No dedicated hourly GSC sync cron** — GSC data is fetched on-demand, not on a schedule. Any bridge depending on "fresh GSC data" must trigger its own fetch or accept staleness.

4. **Anomaly detection runs every 12 hours** — not 6. Bridge #10 (anomaly → boost) fires at most twice daily.

5. **Only 2 tables are truly unbounded** — `chat_sessions` and `audit_snapshots`. All others have cleanup mechanisms. Phase 2 bridges that write to these tables don't need their own cleanup.

6. **`buildSeoContext()` has 26 callers** — not 23. If Phase 2 changes the delegation from shadow-mode to real, all 26 must be regression-tested.

7. **Bridge #4 already exists** — `routes/insights.ts:40-64` already records a tracked action when an insight is resolved. Phase 2 should verify this, not re-implement it.

8. **`broadcastToWorkspace()` requires an active WebSocket connection** — if no admin/client is connected, the broadcast is a no-op. Bridges should not depend on broadcasts for data consistency — they're for UI reactivity only.

---

## Deferred Review Items (address in Phase 2)

These were flagged during Phase 1 code review and intentionally deferred. Each must be resolved in Phase 2:

| Item | Where | When to address |
|------|-------|-----------------|
| **`workspace-data.ts` duplicates single-flight** — uses inline Promise-based dedup instead of shared `singleFlight()` from `intelligence-cache.ts` | `server/workspace-data.ts` lines 47-84 | Phase 2, when adding more data accessors (content pipeline, site health). Refactor to shared utility since multiple accessors will need it. |
| **Page cache has no bounded eviction** — `pageCache` is a plain `Map` with no max size. `getPageCacheStats()` reports `maxEntries: 100` but nothing enforces it. | `server/workspace-data.ts` | Phase 2, same refactor. Switch to `LRUCache` from `intelligence-cache.ts` for automatic bounded eviction. |
| **Shadow-mode compares only 2 of 5 fields** — only `brandVoice` and `businessContext` are compared. `strategy`, `knowledgeBase`, and `personas` are not. | `server/seo-context.ts` lines 166-172 | During the 3-day staging soak. Expand comparison incrementally, verify no false positives before adding more fields. |
| **`personas` always empty array** — `assembleSeoContext` returns `personas: []` as a stub. Type declares it required, not optional. | `server/workspace-intelligence.ts` line 126, `shared/types/intelligence.ts` | Phase 2, when persona parsing is implemented. Either populate or make optional in the type. |
| **No barrel export for the hook** — `useWorkspaceIntelligence` is not re-exported from `src/hooks/admin/index.ts` | `src/hooks/admin/` | Phase 2, when the hook is first consumed by a component. |

---

## Shadow Mode Soak Findings (fill in after Phase 1 staging)

> **After the 3-day soak, record findings here before starting Phase 2 planning.**

- [ ] Total intelligence assemblies on staging: ___
- [ ] Shadow-mode mismatches found: ___
- [ ] Mismatch details (if any): ___
- [ ] Average assembly latency (ms): ___
- [ ] Cache hit rate: ___
- [ ] Any subsystem failures observed: ___
- [ ] Performance concerns: ___

---

## Planning Protocol Reminders

Before writing the Phase 2 plan:
1. Read `docs/rules/plan-accuracy-protocol.md` — the full audit methodology
2. Read this document end-to-end — every verified signature and schema
3. Run `pre-plan-audit` skill to grep all bridge trigger points in the codebase
4. Fill in the shadow mode soak findings above
5. Verify Phase 1 files still match the exports table at the top of this document
