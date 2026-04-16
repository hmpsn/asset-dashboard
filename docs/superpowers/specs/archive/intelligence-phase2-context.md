# Unified Workspace Intelligence — Phase 2 Context Brief

> **Purpose:** This document carries forward everything verified during Phase 1 planning and execution so the Phase 2 plan starts from ground truth, not assumptions. Read this BEFORE writing the Phase 2 plan.
> **Last updated:** 2026-03-31 (post PR 2A merge to staging)

---

## What Phase 1 Built (verified against actual code March 31 2026)

| File | Key Exports | Status |
|------|-------------|--------|
| `shared/types/intelligence.ts` | `WorkspaceIntelligence`, `IntelligenceSlice`, `IntelligenceOptions`, `PromptFormatOptions`, `ContentPipelineSummary`, all 8 slice interfaces | ✅ Phase 1 |
| `shared/types/feature-flags.ts` | `intelligence-shadow-mode` flag + **15 bridge flags** (all default OFF) | ✅ Phase 1 + 2A |
| `server/workspace-intelligence.ts` | `buildWorkspaceIntelligence()`, `formatForPrompt()`, `invalidateIntelligenceCache()`, `getIntelligenceCacheStats()` | ✅ Phase 1 |
| `server/workspace-data.ts` | `getWorkspacePages()`, `getWorkspaceAllPages()`, `invalidatePageCache()`, `getPageCacheStats()`, **`getContentPipelineSummary()`**, **`invalidateContentPipelineCache()`** | ✅ Phase 1 + 2A |
| `server/intelligence-cache.ts` | `LRUCache` (with `get()`, `set()`, `delete()`, `markStale()`, `deleteByPrefix()`, **`peek()`**, `stats()`), `singleFlight()` | ✅ Phase 1 + 2A |
| `server/bridge-infrastructure.ts` | `executeBridge()`, `fireBridge()`, `debounceBridge()`, `withWorkspaceLock()`, `getBridgeFlags()`, `readSubCache()`, `writeSubCache()`, `invalidateSubCache()`, `invalidateSubCachePrefix()`, pre-configured debounced instances | ✅ Phase 2A |
| `server/routes/intelligence.ts` | `GET /api/intelligence/:workspaceId`, `GET /api/intelligence/health` (includes bridge flags) | ✅ Phase 1 + 2A |
| `src/hooks/admin/useWorkspaceIntelligence.ts` | `useWorkspaceIntelligence(wsId, slices?, pagePath?, learningsDomain?)` | ✅ Phase 1 |
| `src/api/intelligence.ts` | `intelligenceApi.getIntelligence()`, `intelligenceApi.getHealth()` | ✅ Phase 1 |
| `src/lib/queryKeys.ts` | `queryKeys.admin.intelligence(wsId, slices?, pagePath?, learningsDomain?)` | ✅ Phase 1 |
| `server/ws-events.ts` | `INTELLIGENCE_CACHE_UPDATED` event | ✅ Phase 1 |
| `server/db/migrations/043-intelligence-caching-layer.sql` | `intelligence_sub_cache`, `content_pipeline_cache`, `suggested_briefs` tables; `resolution_source` column on `analytics_insights` | ✅ Phase 1 |
| `server/constants.ts` | `STUDIO_URL`, `STUDIO_BOT_UA` constants | ✅ Phase 1 |
| `tests/bridge-infrastructure.test.ts` | 9 tests covering executeBridge, fireBridge, debounceBridge, withWorkspaceLock | ✅ Phase 2A |
| `tests/bridge-pairing.test.ts` | Structural test: every file calling `clearSeoContextCache` must also call `invalidateIntelligenceCache` | ✅ Phase 2A |

### Phase 1 Slices Implemented

- `seoContext` — fully assembled from `buildSeoContext()` with `_skipShadow` recursion guard
- `insights` — fully assembled from `getInsights()`, capped at 100, grouped by type/severity
- `learnings` — assembled from `getWorkspaceLearnings()` + `getPlaybooks()`, gated by `outcome-ai-injection` flag

### Phase 1 Slices STUBBED (return undefined)

- `pageProfile` — Phase 3
- `contentPipeline` — Phase 2C
- `siteHealth` — Phase 2C
- `clientSignals` — Phase 3+
- `operational` — Phase 3+

---

## Spec vs Reality — Key Deltas (discovered during Phase 1)

These are differences between the original spec (`unified-workspace-intelligence.md`) and what was actually built. **Phase 2 plans must use the "reality" column, not the spec.**

| Area | Original Spec | Actual Implementation |
|------|---------------|----------------------|
| `buildSeoContext()` signature | 3 params: `(workspaceId?, pagePath?, learningsDomain?)` | 4 params: added `internalOpts?: { _skipShadow?: boolean }` to prevent circular recursion |
| `useWorkspaceIntelligence()` hook | 2 params: `(workspaceId, slices?)` | 4 params: `(workspaceId, slices?, pagePath?, learningsDomain?)` |
| Query key factory | `['admin-intelligence', wsId, slices.join(',')]` | `['admin-intelligence', wsId, pagePath, learningsDomain, ...sortedSlices]` |
| `getWorkspacePages()` | Single function returning published pages | Two functions: `getWorkspacePages()` (published, no CMS templates) and `getWorkspaceAllPages()` (all live, no drafts/archived) |
| Page cache invalidation | Simple `Map.delete()` | Generation counter pattern for race-safe invalidation |
| Page cache token resolution | `token ∣∣ process.env.WEBFLOW_API_TOKEN` | `token ∣∣ undefined` — lets `webflowFetch()` handle env var fallback internally |
| `getContentPipelineSummary()` | Spec said Phase 1 | ✅ **Shipped in PR 2A** — implemented in `workspace-data.ts` with 5-min persistent cache |
| Persona parsing | Spec assumed working | Always returns `[]` — TODO in Phase 2+ (unchanged) |
| Barrel export for hook | Spec assumed present | ✅ **Fixed in PR 2A** — `useWorkspaceIntelligence` now exported from `src/hooks/admin/index.ts` |
| Shadow-mode soak | Spec required 3-day soak before Phase 2 | **Skipped** — minimal traffic, user opted to proceed |
| Shadow-mode comparison | Spec implied full comparison | Only compares `brandVoice` + `businessContext` (2 of 5 fields); comparison is currently a no-op (both sides from same call chain — documented in code, Task 21 fixes) |
| Stale-while-revalidate | Spec defined serve-stale behavior | Stale entries logged but never served — falls through to recompute |
| `workspace-data.ts` single-flight | Spec assumed shared `singleFlight()` | ✅ **Fixed in PR 2A** — uses shared `singleFlight()` from `intelligence-cache.ts`; stale fallback uses `peek()` |
| Page cache eviction | Spec said LRU with max 100 | ✅ **Fixed in PR 2A** — now uses `LRUCache<PageCacheEntry>(100)`; `getPageCacheStats()` returns real LRU stats |
| Bridge flag count | Spec says 16 | **Actually 15** — bridge #6 intentionally skipped (spec numbering goes #5 → #7). Both `BRIDGE_FLAGS` array and `feature-flags.ts` have 15 entries. |

---

## Phase 2 Scope: 3-PR Strategy

Phase 2 is split into 3 PRs for incremental verification. Each PR is independently deployable and testable.

### PR 2A — Bridge Infrastructure + Tech Debt

**Goal:** Build the execution framework. No bridges fire. Nothing changes for end users.

**Includes:**
1. Bridge execution wrapper (`executeBridge()`) with logging, dry-run, feature flag check, timeout
2. Per-bridge feature flags (16 new flags, all default OFF) in `shared/types/feature-flags.ts`
3. Debounce utility (`debounceBridge()`) with per-bridge delay policies
4. Per-workspace mutex (`withWorkspaceLock()`) for bridges that modify shared rows
5. `getContentPipelineSummary()` data accessor in `workspace-data.ts`
6. Page cache → LRU migration (replace plain `Map` with `LRUCache`)
7. `workspace-data.ts` → shared `singleFlight()` (preserve fallback-on-error behavior)
8. Barrel export for `useWorkspaceIntelligence` hook
9. Persona parsing stub resolution (make `personas` optional in type, or populate from `personasBlock`)

**Verification:** All existing tests pass. Health endpoint reports correct cache stats. No behavioral changes.

### PR 2B — Low-Risk Write-Time Bridges

**Goal:** Wire the simplest bridges — cache invalidation and single-table mutations. Each bridge flag-gated.

**Includes:**
- **Bridge #3** — Strategy updated → invalidate intelligence cache (debounce 2s)
- **Bridge #5** — Page analysis complete → clear SEO context + intelligence cache (debounce 2s)
- **Bridge #11** — Knowledge/strategy mutation → cascade cache invalidation (debounce 2s)
- **Bridge #7** — Action recorded → auto-resolve related insights to `in_progress` (no debounce)
- **Bridge #13** — Action recorded → create annotation on timeline (no debounce)
- **Bridge #2** — Content decay detected → auto-suggest brief (no debounce)
  - Requires: CRUD API endpoints for `suggested_briefs` table (table exists from migration 043)
  - Requires: Admin UI for viewing/accepting/dismissing suggestions (or defer UI to 2C)

**Not included:** Bridge #4 — already exists in `routes/insights.ts:40-64`. Verify test coverage only.

**Verification:** Enable each bridge flag individually on staging. Trigger the source event, verify the effect. Disable and verify no side effects.

### PR 2C — Complex Bridges + Slice Assembly

**Goal:** Wire bridges that modify existing data (need transactions, dedup) and fill in stubbed slices.

**Includes:**
- **Bridge #1** — Outcome scored → reweight insight impact scores (debounce 5s, workspace mutex)
- **Bridge #10** — Anomaly confirmed → boost insight severity (debounce 5s, workspace mutex)
- **Bridge #12** — Audit complete → generate `page_health` insights (transaction, dedup)
- **Bridge #15** — Audit stored → create site health insights (transaction, dedup)
- Assemble `contentPipeline` slice (uses `getContentPipelineSummary()` from PR 2A)
- Assemble `siteHealth` slice (reads latest audit snapshot + schema validation)
- Expand shadow-mode comparison to all 5 fields (brandVoice, businessContext, strategy, knowledgeBase, personas)

**Verification:** Each bridge with dedicated integration tests. Deduplication verified. Transaction rollback on failure verified.

### Explicitly Deferred to Phase 3+

- Read-time enrichments (bridges #6, #8, #9, #16) — change query behavior, not write behavior
- `clientSignals` and `operational` slice assembly
- `pageProfile` slice assembly
- Client intelligence endpoint (`/api/public/intelligence/:workspaceId`)
- AI endpoint migration from `buildSeoContext()` to full intelligence
- Persona parsing from `personasBlock` string
- Suggested briefs admin UI (if deferred from 2B)
- `formatForPrompt()` cold-start behavior
- Onboarding completeness tracking

---

## Verified Function Signatures (confirmed accurate March 31 2026)

These were verified line-by-line during Phase 1. Use these exact signatures — don't guess.

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

// server/workspace-intelligence.ts
export async function buildWorkspaceIntelligence(
  workspaceId: string,
  opts?: IntelligenceOptions,
): Promise<WorkspaceIntelligence>

export function formatForPrompt(
  intelligence: WorkspaceIntelligence,
  opts?: PromptFormatOptions,
): string

export function invalidateIntelligenceCache(workspaceId: string): void
export function getIntelligenceCacheStats(): { entries: number; maxEntries: number }

// server/workspace-data.ts
export async function getWorkspacePages(workspaceId: string, siteId: string): Promise<WebflowPage[]>
export async function getWorkspaceAllPages(workspaceId: string, siteId: string): Promise<WebflowPage[]>
export function invalidatePageCache(workspaceId: string): void
export function getPageCacheStats(): { entries: number; maxEntries: number }
export function getContentPipelineSummary(workspaceId: string): ContentPipelineSummary  // PR 2A
export function invalidateContentPipelineCache(workspaceId: string): void               // PR 2A

// server/intelligence-cache.ts
export class LRUCache<T> {
  constructor(maxEntries: number)
  get(key: string): { data: T; stale: boolean } | null  // hard-deletes on TTL expiry
  set(key: string, value: T, ttlMs: number): void
  delete(key: string): void
  markStale(key: string): void
  deleteByPrefix(prefix: string): number
  peek(key: string): T | null  // PR 2A — returns data WITHOUT TTL enforcement; use in error fallback paths
  clear(): void
  get size(): number
  stats(): { entries: number; maxEntries: number }
}
export function singleFlight<T>(key: string, fn: () => Promise<T>): Promise<T>

// server/bridge-infrastructure.ts (PR 2A — all new)
export async function executeBridge(
  flag: FeatureFlagKey,
  workspaceId: string,
  fn: () => Promise<void> | void,
  opts?: { timeoutMs?: number; dryRun?: boolean },
): Promise<void>
// NEVER throws. Feature-flag gated. Times out after timeoutMs (default 5000ms).
// Use for async callers only. Sync callers must use fireBridge().

export function fireBridge(
  flag: FeatureFlagKey,
  workspaceId: string,
  fn: () => Promise<void> | void,
  opts?: { timeoutMs?: number; dryRun?: boolean },
): void
// Fire-and-forget wrapper for sync callers (recordAction, saveSnapshot).
// Deliberately discards Promise — safe because executeBridge catches internally.

export function debounceBridge(
  flag: FeatureFlagKey,
  delayMs: number,
): (workspaceId: string, fn: () => Promise<void> | void) => void
// Factory — returns a debounced executor. Last call within delayMs wins per workspace.

export async function withWorkspaceLock<T>(
  workspaceId: string,
  fn: () => Promise<T>,
): Promise<T>
// Per-workspace FIFO mutex. Use for bridges modifying shared rows (insight scores, audit snapshots).

export function getBridgeFlags(): Record<string, boolean>

// Pre-configured debounced instances (import directly, don't create new ones):
export const debouncedStrategyInvalidate    // 'bridge-strategy-invalidate', 2s
export const debouncedPageAnalysisInvalidate // 'bridge-page-analysis-invalidate', 2s
export const debouncedSettingsCascade        // 'bridge-settings-cascade', 2s
export const debouncedOutcomeReweight        // 'bridge-outcome-reweight', 5s
export const debouncedAnomalyBoost           // 'bridge-anomaly-boost', 5s

// Sub-cache utilities (for surgical per-slice cache invalidation):
export function readSubCache<T>(workspaceId: string, key: string): T | null
export function writeSubCache(workspaceId: string, key: string, data: unknown, ttlSeconds: number): void
export function invalidateSubCache(workspaceId: string, key: string): void
export function invalidateSubCachePrefix(workspaceId: string, prefix: string): void
// NOTE: readSubCache handles SQLite datetime('now') UTC normalization internally.

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

// server/seo-context.ts
export function clearSeoContextCache(workspaceId?: string): void
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
  // resolution_source: TEXT — added by migration 043, now in TS interface
}
```

---

## Verified Database Schemas

### Tables Phase 2 Bridges Will Write To

| Table | Key Columns | Notes |
|-------|-------------|-------|
| `analytics_insights` | `id, workspace_id, page_id, insight_type, data, severity, impact_score, resolution_source` | `resolution_source` added in 043. Bridge-written rows must set this. |
| `tracked_actions` | `id, workspace_id, action_type, source_type, source_id, page_url, ...` | Many optional columns with defaults. |
| `analytics_annotations` | `id, workspace_id, date, label, category, created_by` | **No `pageUrl` column** — annotation is workspace-scoped. Bridge #13 can set `label` to include page context. |
| `suggested_briefs` | `id, workspace_id, keyword, page_url, source, reason, priority, status, ...` | Created in 043. Empty until Bridge #2 populates it. |
| `intelligence_sub_cache` | `workspace_id, cache_key, ttl_seconds, cached_at, data` | Created in 043. For surgical cache invalidation. |
| `content_pipeline_cache` | `workspace_id, summary_json, cached_at` | Created in 043. Pre-computed pipeline counts. |

### Tables Phase 2 Bridges Will Read From

| Table | Exists | Notes |
|-------|--------|-------|
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

## PR 2A Verified Findings — Critical for 2B Implementers

1. **`fireBridge()` for sync callers, `executeBridge()` for async** — `recordAction()` and `saveSnapshot()` are synchronous. Any bridge post-hook added to these functions MUST use `fireBridge()`, not `executeBridge()` (floating promise). `fireBridge()` internally calls `void executeBridge(...)` to silence the promise.

2. **Bridge-pairing test must stay green** — `tests/bridge-pairing.test.ts` asserts that every file calling `clearSeoContextCache` also calls `invalidateIntelligenceCache`. Bridge #3 (strategy invalidate), Bridge #5 (page analysis), and Bridge #11 (settings cascade) all touch cache invalidation. If any of these tasks adds a `clearSeoContextCache` call, `invalidateIntelligenceCache` must be in the same file. Run `npx vitest run tests/bridge-pairing.test.ts` after each cache-invalidation change.

3. **Use pre-configured debounced instances** — do NOT call `debounceBridge()` to create new instances. Import the pre-configured exports from `bridge-infrastructure.ts` directly: `debouncedStrategyInvalidate`, `debouncedPageAnalysisInvalidate`, `debouncedSettingsCascade`. These maintain state across calls and are what the plan refers to.

4. **`LRUCache.peek()` for error fallback paths** — if any PR 2B/2C code reads from an LRU cache in an error handler and wants to return stale data, use `cache.peek(key)` not `cache.get(key)`. `get()` hard-deletes expired entries before returning null, making fallbacks unreachable after TTL expiry.

5. **SQLite `datetime('now')` timestamps need UTC normalization** — any code reading a `datetime('now')` column and computing age via `new Date(row.cached_at)` must normalize: `row.cached_at.endsWith('Z') ? row.cached_at : row.cached_at.replace(' ', 'T') + 'Z'`. The `readSubCache` function already handles this internally. New code that reads other timestamp columns from SQLite must apply the same pattern.

6. **`resolution_source` on `analytics_insights`** — added by migration 043. When Bridge #7 auto-resolves insights, it must set `resolution_source = 'bridge-action-auto-resolve'`. The `resolveInsight()` function signature may need to be updated to accept this field (Task 6B).

---

## Discovered Caveats for Phase 2

1. **`annotations.pageUrl` doesn't exist** — the `analytics_annotations` table has no page URL column. Bridge #13 should encode page context in the `label` field instead of requiring a schema migration.

2. **Rank history is shallow** — `page_keywords` stores `current_position` + `previous_position` only. No deep historical series. `PageProfileSlice.rankHistory.best` must be derived from current/previous, not a historical scan. (Phase 3 concern)

3. **No dedicated hourly GSC sync cron** — GSC data is fetched on-demand, not on a schedule. Any bridge depending on "fresh GSC data" must trigger its own fetch or accept staleness.

4. **Anomaly detection runs every 12 hours** — not 6. Bridge #10 (anomaly → boost) fires at most twice daily.

5. **Only 2 tables are truly unbounded** — `chat_sessions` and `audit_snapshots`. All others have cleanup mechanisms.

6. **`buildSeoContext()` has 26 callers** — not 23. If Phase 2 changes the delegation from shadow-mode to real, all 26 must be regression-tested. (Phase 3 concern — Phase 2 does not change delegation)

7. **Bridge #4 already exists** — `routes/insights.ts:40-64` already records a tracked action when an insight is resolved. Phase 2 should verify test coverage only, not re-implement.

8. **`broadcastToWorkspace()` requires an active WebSocket connection** — if no admin/client is connected, the broadcast is a no-op. Bridges should not depend on broadcasts for data consistency — they're for UI reactivity only.

9. **Shadow-mode always passes in Phase 1** — because the intelligence assembler calls `buildSeoContext()` with `_skipShadow`, and that same function populates the cache that the shadow comparison reads from. Mismatches can only appear once the assembler populates fields from different sources (Phase 3+).

10. **Per-workspace Webflow tokens** — `getWorkspacePages()` correctly resolves `ws?.webflowToken` before falling back to env var. Domain/subdomain lookups in link-checker, pagespeed, redirect-scanner also use per-workspace tokens now.

11. **`workspace-data.ts` fallback-on-error** — the inline single-flight pattern returns stale cached data on API failure instead of propagating errors. When migrating to shared `singleFlight()` in PR 2A, must wrap with fallback behavior to preserve this graceful degradation.

---

## Phase 1 Deferred Items (must address in Phase 2)

| Item | Where | Status |
|------|-------|--------|
| **Page cache has no bounded eviction** — plain `Map` with no max size | `server/workspace-data.ts` | ✅ PR 2A — LRUCache(100) |
| **`workspace-data.ts` duplicates single-flight** — inline instead of shared utility | `server/workspace-data.ts` | ✅ PR 2A — uses shared `singleFlight()`; stale fallback uses `peek()` |
| **`personas` always empty array** — stub in assembler | `server/workspace-intelligence.ts` | ✅ PR 2A — `workspace?.personas ?? []` |
| **No barrel export for hook** | `src/hooks/admin/index.ts` | ✅ PR 2A |
| **`getContentPipelineSummary()` not implemented** | `server/workspace-data.ts` | ✅ PR 2A — 5-min persistent cache, invalidation exported |
| **Shadow-mode compares only 2/5 fields** | `server/seo-context.ts` | ⏳ PR 2C Task 21 |
| **Shadow-mode comparison is currently a no-op** — both sides from same `buildSeoContext()` call chain; documented in code with Task 21 note. Fires assembler for latency/error telemetry but field comparison never catches divergence. | `server/seo-context.ts:171` | ⏳ PR 2C Task 21 |
| **Phase 1 page accessor behavioral change** — `getWorkspacePages()`/`getWorkspaceAllPages()` return `[]` when no workspace matches `siteId`. `seo-audit.ts` scanner functions now log `warn` when wsId is null. | `server/workspace-data.ts` | Monitor / Phase 3 |

---

## Planning Protocol

Before writing the Phase 2 plan:
1. Read this document end-to-end — every verified signature, delta, and caveat
2. Run `pre-plan-audit` skill to grep all bridge trigger points in the codebase
3. Verify Phase 1 files still match the exports table at the top
4. For each bridge, identify the exact file + line where the trigger hook will be inserted
5. Map file ownership for parallel agent dispatch — no file touched by two agents
