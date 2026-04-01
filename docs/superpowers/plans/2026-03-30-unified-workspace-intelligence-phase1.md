# Unified Workspace Intelligence Layer — Phase 1: Foundation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the intelligence layer's core infrastructure (types, assembler, cache, shared data accessor, API endpoint, frontend hook) as a shadow system alongside existing code — no existing behavior changes until shadow mode validation passes.

**Architecture:** Three-layer system (shared data accessors → intelligence core → consumers) built additively. Phase 1 creates Layers 1-2 and the API surface for Layer 3, plus migrates 20 Webflow page callers to the shared accessor. `buildSeoContext()` delegation operates in shadow/comparison mode behind a feature flag — always returns the old result until validated.

**Tech Stack:** TypeScript, Express, SQLite (better-sqlite3), React Query, Vitest

**Spec:** `docs/superpowers/specs/unified-workspace-intelligence.md` (35 sections, 1747 lines)

**Approach:** Shadow system — everything built alongside existing code, nothing removed. 7 PRs for Phase 1, one per execution batch.

---

## PR Strategy

Each execution batch ships as a single PR to `staging`. All PRs merge sequentially — PR N+1 cannot open until PR N is merged and CI is green.

| PR | Branch Name | Tasks | Title | What Ships |
|----|------------|-------|-------|------------|
| **1** | `feat/intelligence-types-migration-cache` | 1, 2, 3 | `feat(intelligence): shared types, migration 043, LRU cache` | Types in `shared/types/intelligence.ts`, feature flag, DB tables (`intelligence_sub_cache`, `content_pipeline_cache`, `suggested_briefs`), `resolution_source` column, LRU cache + single-flight utility. No runtime behavior changes. |
| **2** | `feat/intelligence-data-accessor-formatter` | 4, 6 | `feat(intelligence): shared page accessor + prompt formatter` | `getWorkspacePages()` cached accessor in `workspace-data.ts`, `formatForPrompt()` with 3 verbosity levels. No callers migrated yet — accessor exists but isn't consumed. |
| **3** | `feat/intelligence-core-assembler` | 5 | `feat(intelligence): core assembler with per-slice graceful degradation` | `buildWorkspaceIntelligence()` in `workspace-intelligence.ts` — assembles seoContext, insights, learnings slices. LRU cached, single-flighted, structured logging. `INTELLIGENCE_CACHE_UPDATED` WS event added. |
| **4** | `feat/intelligence-api-migration-observability` | 7, 9, 11 | `feat(intelligence): API route, page accessor migration, observability` | `GET /api/intelligence/:workspaceId` + `/health` endpoints, 20 `listPages()` callers migrated to `getWorkspacePages()`, cache hit/miss/latency logging. This is the largest PR — 20+ files touched. |
| **5** | `feat/intelligence-frontend-hook` | 8 | `feat(intelligence): frontend hook + API client` | `useWorkspaceIntelligence()` React Query hook, `intelligenceApi` client, `queryKeys.admin.intelligence()` factory. Frontend can now consume intelligence data (not wired into any component yet). |
| **6** | `feat/intelligence-shadow-mode` | 10 | `feat(intelligence): shadow-mode comparison in buildSeoContext` | Fire-and-forget comparison in `buildSeoContext()` when `intelligence-shadow-mode` flag is on. Logs mismatches, never changes return value. This is the validation mechanism for the entire layer. |
| **7** | `test/intelligence-integration` | 12 | `test(intelligence): integration tests + test seed utility` | `seedIntelligenceTestData()` fixture, integration tests for slice assembly, caching, invalidation, graceful degradation. Final validation that everything works end-to-end. |

### PR Review Protocol

- **PR 1-3:** Low risk — new files only, no existing behavior changes. Fast review.
- **PR 4:** Highest risk — touches 20 existing files. Review each `listPages()` → `getWorkspacePages()` replacement. Verify no callsite was missed with: `grep -rn "listPages" server/ --include="*.ts" | grep -v workspace-data | grep -v webflow-pages | grep -v test`
- **PR 5:** Low risk — new frontend files only.
- **PR 6:** Medium risk — modifies `seo-context.ts`. Verify fire-and-forget pattern doesn't block the return. Flag defaults to off.
- **PR 7:** Low risk — test files only.

### Post-Merge: Shadow Mode Soak

After PR 7 merges to `staging`:
1. Enable `intelligence-shadow-mode` flag on staging
2. Monitor Pino logs for `Intelligence shadow-mode mismatch detected` warnings for 3 days
3. Monitor `/api/intelligence/health` cache stats
4. Zero mismatches after 3 days → Phase 1 validated → proceed to Phase 2 plan

---

## File Map

### New files (create)

| File | Responsibility |
|------|---------------|
| `shared/types/intelligence.ts` | All intelligence layer type definitions |
| `server/workspace-intelligence.ts` | Core assembler: `buildWorkspaceIntelligence()` + `formatForPrompt()` |
| `server/workspace-data.ts` | Shared data accessors: `getWorkspacePages()`, `getContentPipelineSummary()` |
| `server/intelligence-cache.ts` | LRU cache implementation + single-flight dedup |
| `server/routes/intelligence.ts` | API endpoint: `GET /api/intelligence/:workspaceId` |
| `src/hooks/admin/useWorkspaceIntelligence.ts` | React Query hook for intelligence data |
| `src/api/intelligence.ts` | Frontend API client for intelligence endpoints |
| `server/db/migrations/043-intelligence-caching-layer.sql` | New tables + `resolution_source` column |
| `tests/unit/workspace-intelligence.test.ts` | Unit tests for core assembler |
| `tests/unit/workspace-data.test.ts` | Unit tests for shared data accessors |
| `tests/unit/intelligence-cache.test.ts` | Unit tests for LRU cache |
| `tests/unit/format-for-prompt.test.ts` | Unit tests for prompt formatter |
| `tests/fixtures/intelligence-seed.ts` | Shared test data seeding utility |

### Modified files (touch)

| File | Change |
|------|--------|
| `server/ws-events.ts` | Add `INTELLIGENCE_CACHE_UPDATED` event constant |
| `src/lib/queryKeys.ts` | Add `intelligence` factory function |
| `server/app.ts` | Import + mount intelligence route |
| `server/seo-context.ts` | Add shadow-mode delegation (behind feature flag) |
| `shared/types/feature-flags.ts` | Add `intelligence-shadow-mode` flag |
| `server/feature-flags.ts` | No changes needed (auto-picks up new flag) |
| 20 files with `listPages()` calls | Replace with `getWorkspacePages()` |

---

## Dependency Graph

```
Task 1 (types) ──────────────────────────┐
Task 2 (migration) ─────────────────────┤
                                          ├── Task 5 (assembler) ── Task 7 (API route) ── Task 8 (frontend hook)
Task 3 (LRU cache) ─────────────────────┤                              │
Task 4 (shared data accessor) ──────────┤                              │
                                          │                              ├── Task 10 (shadow delegation)
Task 6 (prompt formatter) ──────────────┘                              │
                                                                         │
Task 9 (page accessor migration - 20 files) ── independent, can run after Task 4
                                                                         │
Task 11 (observability) ── can run after Task 5                          │
Task 12 (integration tests) ── final, after all above
```

**Parallel opportunities:**
- Tasks 1, 2, 3 can run in parallel (no dependencies)
- Task 4 depends on Task 1 (types)
- Task 9 depends on Task 4 only (independent of intelligence core)
- Task 11 can run after Task 5

---

## Model Assignments

| Task | Model | Rationale |
|------|-------|-----------|
| 1. Shared Types | **Sonnet** | Type design requires judgment on interface shapes |
| 2. DB Migration | **Haiku** | Mechanical SQL, follows established migration patterns |
| 3. LRU Cache + Single-Flight | **Sonnet** | Algorithm implementation + test design |
| 4. Shared Data Accessor | **Sonnet** | DI pattern, error handling, cache strategy |
| 5. Core Assembler | **Opus** | Central orchestration, cross-system integration, graceful degradation |
| 6. Prompt Formatter | **Sonnet** | Template logic with verbosity tiers |
| 7. API Route | **Haiku** | Mechanical Express route following existing patterns |
| 8. Frontend Hook + API Client | **Haiku** | Mechanical, follows existing hook/api patterns exactly |
| 9. Page Accessor Migration (20 files) | **Haiku** | Mechanical find-and-replace, 4 batches |
| 10. Shadow-Mode Delegation | **Opus** | Touches core `buildSeoContext()`, high judgment needed |
| 11. Observability Logging | **Haiku** | Adding structured log calls to existing functions |
| 12. Integration Tests + Seed | **Sonnet** | Test design against real DB, seed data accuracy |

---

## Execution Batches

| Batch | Tasks | Mode | Rationale |
|-------|-------|------|-----------|
| **1** | 1, 2, 3 | **Parallel** | No dependencies between them |
| **2** | 4, 6 | **Parallel** | Both depend on Task 1 (types) only |
| **3** | 5 | **Sequential** | Depends on Tasks 1, 3, 4 — core assembler is the integration point |
| **4** | 7, 9, 11 | **Parallel** | 7 depends on 5; 9 depends on 4; 11 depends on 5 — but no mutual dependencies |
| **5** | 8 | **Sequential** | Depends on Task 7 (API route must exist for frontend to call) |
| **6** | 10 | **Sequential** | Depends on Task 5 — touches `seo-context.ts`, needs careful review |
| **7** | 12 | **Sequential** | Integration tests validate everything — must run last |

**Review checkpoints:** After each batch, run `npx tsc --noEmit --skipLibCheck && npx vite build` and review diffs for conflicts before starting the next batch.

---

## Task 1: Shared Types

**Files:**
- Create: `shared/types/intelligence.ts`
- Modify: `shared/types/feature-flags.ts`

**Docs to check:**
- Spec §3 (interfaces), §11 (type inventory), §14 (feature flags), §31 (versioning)
- `shared/types/outcome-tracking.ts` for existing type patterns
- `shared/types/analytics.ts` for `AnalyticsInsight`, `InsightType`, `InsightSeverity`
- `shared/types/workspace.ts` for `KeywordStrategy`, `AudiencePersona`, `PageKeywordMap`

- [ ] **Step 1: Create the intelligence types file**

```typescript
// shared/types/intelligence.ts
// Unified Workspace Intelligence Layer — shared types for server and frontend.
// Spec: docs/superpowers/specs/unified-workspace-intelligence.md §3, §11

import type { AnalyticsInsight, InsightType, InsightSeverity } from './analytics.js';
import type { KeywordStrategy, AudiencePersona, PageKeywordMap } from './workspace.js';
import type {
  TrackedAction,
  ActionOutcome,
  WorkspaceLearnings,
  ActionPlaybook,
  LearningsConfidence,
  LearningsTrend,
} from './outcome-tracking.js';

// ── Slice selection ─────────────────────────────────────────────────────

export type IntelligenceSlice =
  | 'seoContext'
  | 'insights'
  | 'learnings'
  | 'pageProfile'
  | 'contentPipeline'
  | 'siteHealth'
  | 'clientSignals'
  | 'operational';

// ── Options ─────────────────────────────────────────────────────────────

export interface IntelligenceOptions {
  /** Which slices to include (default: all available) */
  slices?: IntelligenceSlice[];
  /** Page-specific context (triggers per-page enrichment) */
  pagePath?: string;
  /** Domain filter for learnings */
  learningsDomain?: 'content' | 'strategy' | 'technical' | 'all';
  /** Token budget hint for downstream prompt formatting */
  tokenBudget?: number;
}

// ── Core return type ────────────────────────────────────────────────────

export interface WorkspaceIntelligence {
  version: 1;
  workspaceId: string;
  assembledAt: string; // ISO timestamp — consumers know data freshness

  seoContext?: SeoContextSlice;
  insights?: InsightsSlice;
  learnings?: LearningsSlice;
  pageProfile?: PageProfileSlice;
  contentPipeline?: ContentPipelineSlice;
  siteHealth?: SiteHealthSlice;
  clientSignals?: ClientSignalsSlice;
  operational?: OperationalSlice;
}

// ── Slice interfaces ────────────────────────────────────────────────────

export interface SeoContextSlice {
  strategy: KeywordStrategy | undefined;
  brandVoice: string;
  businessContext: string;
  personas: AudiencePersona[];
  knowledgeBase: string;
  pageKeywords?: PageKeywordMap;
}

export interface InsightsSlice {
  all: AnalyticsInsight[];
  byType: Partial<Record<InsightType, AnalyticsInsight[]>>;
  bySeverity: Record<InsightSeverity, number>;
  topByImpact: AnalyticsInsight[];
  forPage?: AnalyticsInsight[];
}

export interface LearningsSlice {
  summary: WorkspaceLearnings | null;
  confidence: LearningsConfidence | null;
  /** Top action types by win rate — from summary.overall.topActionTypes */
  topActionTypes: Array<{ type: string; winRate: number; count: number }>;
  overallWinRate: number;
  recentTrend: LearningsTrend | null;
  playbooks: ActionPlaybook[];
  forPage?: {
    actions: TrackedAction[];
    outcomes: ActionOutcome[];
    hasActiveAction: boolean;
  };
}

export interface PageProfileSlice {
  pagePath: string;
  primaryKeyword: string | null;
  searchIntent: string | null;
  optimizationScore: number | null;
  recommendations: string[];
  contentGaps: string[];
  insights: AnalyticsInsight[];
  actions: TrackedAction[];
  auditIssues: string[];
  schemaStatus: 'valid' | 'warnings' | 'errors' | 'none';
  linkHealth: { inbound: number; outbound: number; orphan: boolean };
  seoEdits: { currentTitle: string; currentMeta: string; lastEditedAt: string | null };
  /** Note: page_keywords stores current_position + previous_position only — not full history.
   *  'best' is derived from current/previous; trend from delta. Not a deep historical series. */
  rankHistory: { current: number | null; best: number | null; trend: 'up' | 'down' | 'stable' };
  contentStatus: 'has_brief' | 'has_post' | 'published' | 'decay_detected' | null;
  cwvStatus: 'good' | 'needs_improvement' | 'poor' | null;
}

export interface ContentPipelineSlice {
  briefs: { total: number; byStatus: Record<string, number> };
  posts: { total: number; byStatus: Record<string, number> };
  matrices: { total: number; cellsPlanned: number; cellsPublished: number };
  requests: { pending: number; inProgress: number; delivered: number };
  workOrders: { active: number };
  coverageGaps: string[];
  seoEdits: { pending: number; applied: number; inReview: number };
}

export interface SiteHealthSlice {
  auditScore: number | null;
  auditScoreDelta: number | null;
  deadLinks: number;
  redirectChains: number;
  schemaErrors: number;
  orphanPages: number;
  cwvPassRate: { mobile: number | null; desktop: number | null };
}

export interface ClientSignalsSlice {
  keywordFeedback: { approved: string[]; rejected: string[] };
  contentGapVotes: { topic: string; votes: number }[];
  businessPriorities: string[];
  approvalPatterns: { approvalRate: number; avgResponseTime: number | null };
  recentChatTopics: string[];
  churnRisk: 'low' | 'medium' | 'high' | null;
}

export interface OperationalSlice {
  recentActivity: { type: string; description: string; timestamp: string }[];
  /** Note: analytics_annotations table does NOT have a pageUrl column.
   *  pageUrl is optional — populated only if derivable from context. May need schema update in Phase 3. */
  annotations: { date: string; label: string; pageUrl?: string }[];
  pendingJobs: number;
}

// ── Prompt formatter options ────────────────────────────────────────────

export type PromptVerbosity = 'compact' | 'standard' | 'detailed';

export interface PromptFormatOptions {
  sections?: IntelligenceSlice[];
  verbosity?: PromptVerbosity;
  tokenBudget?: number;
  learningsDomain?: 'content' | 'strategy' | 'technical' | 'all';
  pagePath?: string;
}

// ── Content pipeline summary (for shared data accessor) ─────────────────

export interface ContentPipelineSummary {
  briefs: { total: number; byStatus: Record<string, number> };
  posts: { total: number; byStatus: Record<string, number> };
  matrices: { total: number; cellsPlanned: number; cellsPublished: number };
  requests: { pending: number; inProgress: number; delivered: number };
  workOrders: { active: number };
  seoEdits: { pending: number; applied: number; inReview: number };
}
```

- [ ] **Step 2: Add feature flag for shadow mode**

In `shared/types/feature-flags.ts`, add to the `FEATURE_FLAGS` object:

```typescript
  'intelligence-shadow-mode': false,
```

Add it after the existing `'outcome-ai-injection': false` line.

- [ ] **Step 3: Verify types compile**

Run: `npx tsc --noEmit --skipLibCheck`
Expected: Zero errors

- [ ] **Step 4: Commit**

```bash
git add shared/types/intelligence.ts shared/types/feature-flags.ts
git commit -m "feat(intelligence): add shared types for workspace intelligence layer

Defines WorkspaceIntelligence interface with 8 optional slices,
IntelligenceOptions, PromptFormatOptions, and ContentPipelineSummary.
Adds intelligence-shadow-mode feature flag (default: off).

Spec: docs/superpowers/specs/unified-workspace-intelligence.md §3, §11, §14"
```

---

## Task 2: Database Migration

**Files:**
- Create: `server/db/migrations/043-intelligence-caching-layer.sql`

**Docs to check:**
- Spec §15 (database migrations), §19 (rollback — resolution_source column), §28 (suggested_briefs table)
- Existing migrations in `server/db/migrations/` for patterns

- [ ] **Step 1: Create migration file**

```sql
-- 043-intelligence-caching-layer.sql
-- Unified Workspace Intelligence Layer — Phase 1 foundation tables
-- Spec: docs/superpowers/specs/unified-workspace-intelligence.md §15

-- Add bridge source tagging to analytics_insights (for rollback auditability, §19)
-- Nullable — existing rows get NULL, new bridge-written rows get 'bridge_N_name'
ALTER TABLE analytics_insights ADD COLUMN resolution_source TEXT;

-- Workspace-level intelligence sub-caches (for surgical invalidation)
CREATE TABLE IF NOT EXISTS intelligence_sub_cache (
  workspace_id TEXT NOT NULL,
  cache_key TEXT NOT NULL,
  ttl_seconds INTEGER NOT NULL,
  cached_at TEXT NOT NULL DEFAULT (datetime('now')),
  invalidated_at TEXT,
  data TEXT NOT NULL,
  PRIMARY KEY (workspace_id, cache_key),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);

-- Content pipeline summary cache (pre-computed counts)
CREATE TABLE IF NOT EXISTS content_pipeline_cache (
  workspace_id TEXT PRIMARY KEY,
  summary_json TEXT NOT NULL DEFAULT '{}',
  cached_at TEXT NOT NULL DEFAULT (datetime('now')),
  invalidated_at TEXT,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);

-- Suggested briefs (auto-generated by Bridge #2 in Phase 2: decay → brief)
-- Created now so the table exists; populated by Phase 2 bridges
CREATE TABLE IF NOT EXISTS suggested_briefs (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  keyword TEXT NOT NULL,
  page_url TEXT,
  source TEXT NOT NULL DEFAULT 'content_decay',
  reason TEXT NOT NULL,
  priority TEXT NOT NULL DEFAULT 'medium',
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at TEXT,
  snoozed_until TEXT,
  dismissed_keyword_hash TEXT,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_suggested_briefs_workspace ON suggested_briefs(workspace_id, status);
```

- [ ] **Step 2: Verify migration runs**

Run: `npm run dev:server` (starts server, which runs pending migrations on boot)
Expected: Server starts without errors, logs show migration 043 applied.

If server doesn't auto-run migrations, check how existing migrations are applied and follow the same pattern.

- [ ] **Step 3: Verify column was added**

Run: `sqlite3 data/dashboard.db ".schema analytics_insights" | grep resolution_source`
Expected: Shows `resolution_source TEXT` in the schema output.

- [ ] **Step 4: Commit**

```bash
git add server/db/migrations/043-intelligence-caching-layer.sql
git commit -m "feat(intelligence): add migration 043 — intelligence cache tables + resolution_source

Creates intelligence_sub_cache, content_pipeline_cache, suggested_briefs tables.
Adds resolution_source column to analytics_insights for bridge audit tagging.
All additive — no existing data modified.

Spec: docs/superpowers/specs/unified-workspace-intelligence.md §15, §19, §28"
```

---

## Task 3: LRU Cache + Single-Flight Utility

**Files:**
- Create: `server/intelligence-cache.ts`
- Create: `tests/unit/intelligence-cache.test.ts`

**Docs to check:**
- Spec §13 (performance — single-flight), §30 (stale cache policy), §33 (memory budget)

- [ ] **Step 1: Write failing tests for LRU cache**

```typescript
// tests/unit/intelligence-cache.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LRUCache, singleFlight } from '../../server/intelligence-cache.js';

describe('LRUCache', () => {
  let cache: LRUCache<string>;

  beforeEach(() => {
    cache = new LRUCache<string>(3); // max 3 entries
  });

  it('stores and retrieves values', () => {
    cache.set('a', 'value-a', 60_000);
    expect(cache.get('a')).toEqual({ data: 'value-a', stale: false });
  });

  it('returns null for missing keys', () => {
    expect(cache.get('missing')).toBeNull();
  });

  it('evicts least recently accessed when full', () => {
    cache.set('a', '1', 60_000);
    cache.set('b', '2', 60_000);
    cache.set('c', '3', 60_000);
    // Access 'a' to make it recent
    cache.get('a');
    // Add 'd' — should evict 'b' (least recently accessed)
    cache.set('d', '4', 60_000);
    expect(cache.get('b')).toBeNull();
    expect(cache.get('a')).not.toBeNull();
    expect(cache.get('d')).not.toBeNull();
  });

  it('returns null for expired entries', () => {
    cache.set('a', 'value', 1); // 1ms TTL
    // Wait for expiry
    vi.advanceTimersByTime(10);
    // Expired entries return null (not stale — natural expiry triggers recompute)
    expect(cache.get('a')).toBeNull();
  });

  it('deletes entries', () => {
    cache.set('a', 'value', 60_000);
    cache.delete('a');
    expect(cache.get('a')).toBeNull();
  });

  it('marks entries as stale and returns them with stale flag', () => {
    cache.set('a', 'value', 60_000);
    cache.markStale('a');
    const result = cache.get('a');
    expect(result).toEqual({ data: 'value', stale: true });
  });

  it('reports size correctly', () => {
    expect(cache.size).toBe(0);
    cache.set('a', '1', 60_000);
    cache.set('b', '2', 60_000);
    expect(cache.size).toBe(2);
  });

  it('deletes entries by prefix', () => {
    cache.set('intelligence:ws-1:all', '1', 60_000);
    cache.set('intelligence:ws-1:seo', '2', 60_000);
    cache.set('intelligence:ws-2:all', '3', 60_000);
    const deleted = cache.deleteByPrefix('intelligence:ws-1:');
    expect(deleted).toBe(2);
    expect(cache.size).toBe(1);
    expect(cache.get('intelligence:ws-2:all')).not.toBeNull();
  });

  it('clears all entries', () => {
    cache.set('a', '1', 60_000);
    cache.set('b', '2', 60_000);
    cache.clear();
    expect(cache.size).toBe(0);
  });

  it('enforces max staleness of 24 hours', () => {
    cache.set('a', 'value', 60_000);
    cache.markStale('a');
    // Manually age the entry beyond 24 hours
    vi.advanceTimersByTime(25 * 60 * 60 * 1000);
    expect(cache.get('a')).toBeNull();
  });
});

describe('singleFlight', () => {
  it('deduplicates concurrent calls for the same key', async () => {
    let callCount = 0;
    const fn = async () => {
      callCount++;
      await new Promise(r => setTimeout(r, 50));
      return 'result';
    };

    const [r1, r2, r3] = await Promise.all([
      singleFlight('key1', fn),
      singleFlight('key1', fn),
      singleFlight('key1', fn),
    ]);

    expect(callCount).toBe(1);
    expect(r1).toBe('result');
    expect(r2).toBe('result');
    expect(r3).toBe('result');
  });

  it('allows different keys to run independently', async () => {
    let callCount = 0;
    const fn = async () => {
      callCount++;
      return 'result';
    };

    await Promise.all([
      singleFlight('key1', fn),
      singleFlight('key2', fn),
    ]);

    expect(callCount).toBe(2);
  });

  it('cleans up after completion so subsequent calls re-execute', async () => {
    let callCount = 0;
    const fn = async () => {
      callCount++;
      return 'result';
    };

    await singleFlight('key1', fn);
    await singleFlight('key1', fn);

    expect(callCount).toBe(2);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/intelligence-cache.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement LRU cache and single-flight**

```typescript
// server/intelligence-cache.ts
// LRU cache with TTL, stale marking, and single-flight dedup.
// Spec: docs/superpowers/specs/unified-workspace-intelligence.md §13, §30, §33

const MAX_STALENESS_MS = 24 * 60 * 60 * 1000; // 24 hours — §30

interface CacheEntry<T> {
  value: T;
  cachedAt: number;
  ttlMs: number;
  accessedAt: number;
  stale: boolean;
}

export class LRUCache<T> {
  private cache = new Map<string, CacheEntry<T>>();

  constructor(private maxEntries: number) {}

  get(key: string): { data: T; stale: boolean } | null {
    const entry = this.cache.get(key);
    if (!entry) return null;

    const now = Date.now();
    const age = now - entry.cachedAt;

    // Max staleness: never serve data older than 24 hours (§30)
    if (age > MAX_STALENESS_MS) {
      this.cache.delete(key);
      return null;
    }

    // Natural TTL expiry: return null to trigger recompute
    if (!entry.stale && age > entry.ttlMs) {
      this.cache.delete(key);
      return null;
    }

    entry.accessedAt = now;
    return { data: entry.value, stale: entry.stale };
  }

  set(key: string, value: T, ttlMs: number): void {
    if (this.cache.size >= this.maxEntries && !this.cache.has(key)) {
      this.evictLeastRecent();
    }
    this.cache.set(key, {
      value,
      cachedAt: Date.now(),
      ttlMs,
      accessedAt: Date.now(),
      stale: false,
    });
  }

  delete(key: string): void {
    this.cache.delete(key);
  }

  /** Mark an entry as stale (invalidated but recomputation pending/failed) */
  markStale(key: string): void {
    const entry = this.cache.get(key);
    if (entry) entry.stale = true;
  }

  /** Delete all entries whose key starts with prefix */
  deleteByPrefix(prefix: string): number {
    let deleted = 0;
    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix)) {
        this.cache.delete(key);
        deleted++;
      }
    }
    return deleted;
  }

  clear(): void {
    this.cache.clear();
  }

  get size(): number {
    return this.cache.size;
  }

  /** Returns current cache stats for health endpoint (§18) */
  stats(): { entries: number; maxEntries: number } {
    return { entries: this.cache.size, maxEntries: this.maxEntries };
  }

  private evictLeastRecent(): void {
    let oldestKey: string | null = null;
    let oldestTime = Infinity;
    for (const [k, v] of this.cache) {
      if (v.accessedAt < oldestTime) {
        oldestKey = k;
        oldestTime = v.accessedAt;
      }
    }
    if (oldestKey) this.cache.delete(oldestKey);
  }
}

// ── Single-flight dedup ─────────────────────────────────────────────────

const inflight = new Map<string, Promise<unknown>>();

/**
 * Ensures only one instance of `fn` runs for a given key at a time.
 * Concurrent callers receive the same Promise result.
 * After completion, the key is removed so future calls re-execute.
 */
export async function singleFlight<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const existing = inflight.get(key);
  if (existing) return existing as Promise<T>;

  const promise = fn().finally(() => {
    inflight.delete(key);
  });
  inflight.set(key, promise);
  return promise;
}
```

- [ ] **Step 4: Enable fake timers for timer-dependent tests**

The tests that use `vi.advanceTimersByTime` need fake timers. Update the test file — add at the top of the describe blocks that need it:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Add inside the LRUCache describe, before the timer-dependent tests:
// For tests that check expiry, use fake timers
describe('LRUCache with timers', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  // Move the timer-dependent tests here
});
```

Actually, restructure the test: the timer-dependent tests (expired entries, max staleness) need `vi.useFakeTimers()`, but the LRU cache uses `Date.now()` which is mocked by fake timers. We need to be more careful — the `set()` call records `Date.now()` at insert time, then `get()` checks `Date.now()` at read time. With fake timers, we can control both.

Restructure so that the expired-entry test and max-staleness test are in a separate describe block with fake timers enabled. All other tests work with real timers since they don't need time advancement.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/unit/intelligence-cache.test.ts`
Expected: All tests PASS

- [ ] **Step 6: Verify types compile**

Run: `npx tsc --noEmit --skipLibCheck`
Expected: Zero errors

- [ ] **Step 7: Commit**

```bash
git add server/intelligence-cache.ts tests/unit/intelligence-cache.test.ts
git commit -m "feat(intelligence): add LRU cache with TTL, stale marking, and single-flight dedup

LRUCache supports max entries, TTL expiry, stale marking for failed recomputation,
and 24-hour max staleness policy. singleFlight deduplicates concurrent calls.
Both are used by the intelligence assembler (next task).

Spec: docs/superpowers/specs/unified-workspace-intelligence.md §13, §30, §33"
```

---

## Task 4: Shared Data Accessor — `workspace-data.ts`

**Files:**
- Create: `server/workspace-data.ts`
- Create: `tests/unit/workspace-data.test.ts`

**Docs to check:**
- Spec §5 (shared data accessor code), §6 (tiered cache strategy)
- `server/webflow-pages.ts` for `listPages()` and `filterPublishedPages()` signatures
- `server/db/index.ts` for db import pattern

- [ ] **Step 1: Write failing tests for page accessor**

```typescript
// tests/unit/workspace-data.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// We'll mock the Webflow API and workspace lookup
vi.mock('../../server/webflow-pages.js', () => ({
  listPages: vi.fn(),
  filterPublishedPages: vi.fn((pages: unknown[]) => pages),
}));

vi.mock('../../server/db/workspaces.js', () => ({
  getWorkspace: vi.fn(),
}));

import { getWorkspacePages, invalidatePageCache } from '../../server/workspace-data.js';
import { listPages } from '../../server/webflow-pages.js';
import { getWorkspace } from '../../server/db/workspaces.js';

const mockListPages = vi.mocked(listPages);
const mockGetWorkspace = vi.mocked(getWorkspace);

describe('getWorkspacePages', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invalidatePageCache('ws-1'); // Clear cache between tests
    mockGetWorkspace.mockReturnValue({ id: 'ws-1', webflowToken: 'token-123' } as any);
    mockListPages.mockResolvedValue([
      { id: 'p1', title: 'Home', slug: 'home' },
      { id: 'p2', title: 'About', slug: 'about' },
    ] as any);
  });

  it('fetches pages from Webflow API on cache miss', async () => {
    const pages = await getWorkspacePages('ws-1', 'site-1');
    expect(pages).toHaveLength(2);
    expect(mockListPages).toHaveBeenCalledOnce();
    expect(mockListPages).toHaveBeenCalledWith('site-1', 'token-123');
  });

  it('returns cached pages on subsequent calls', async () => {
    await getWorkspacePages('ws-1', 'site-1');
    await getWorkspacePages('ws-1', 'site-1');
    expect(mockListPages).toHaveBeenCalledOnce(); // Only one API call
  });

  it('returns empty array when workspace has no token', async () => {
    mockGetWorkspace.mockReturnValue({ id: 'ws-1', webflowToken: null } as any);
    const pages = await getWorkspacePages('ws-1', 'site-1');
    expect(pages).toEqual([]);
    expect(mockListPages).not.toHaveBeenCalled();
  });

  it('returns fresh data after cache invalidation', async () => {
    await getWorkspacePages('ws-1', 'site-1');
    invalidatePageCache('ws-1');
    await getWorkspacePages('ws-1', 'site-1');
    expect(mockListPages).toHaveBeenCalledTimes(2);
  });

  it('maintains separate caches per workspace', async () => {
    mockGetWorkspace.mockImplementation((id: string) =>
      ({ id, webflowToken: `token-${id}` }) as any
    );
    await getWorkspacePages('ws-1', 'site-1');
    await getWorkspacePages('ws-2', 'site-2');
    expect(mockListPages).toHaveBeenCalledTimes(2);
    // Invalidating ws-1 doesn't affect ws-2
    invalidatePageCache('ws-1');
    await getWorkspacePages('ws-2', 'site-2');
    expect(mockListPages).toHaveBeenCalledTimes(2); // Still 2 — ws-2 cache hit
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/workspace-data.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement the shared data accessor**

```typescript
// server/workspace-data.ts
// Shared data accessors — cached, workspace-scoped access to frequently-fetched data.
// Spec: docs/superpowers/specs/unified-workspace-intelligence.md §5

import { listPages, filterPublishedPages } from './webflow-pages.js';
import { createLogger } from './logger.js';

const log = createLogger('workspace-data');

// ── Types ───────────────────────────────────────────────────────────────

interface PageCacheEntry {
  pages: Awaited<ReturnType<typeof listPages>>;
  fetchedAt: number;
}

// ── Page cache ──────────────────────────────────────────────────────────

const PAGE_CACHE_TTL = 10 * 60 * 1000; // 10 minutes
const pageCache = new Map<string, PageCacheEntry>();
const pageInflight = new Map<string, Promise<Awaited<ReturnType<typeof listPages>>>>();

/**
 * Get published Webflow pages for a workspace, with 10-minute caching.
 * Replaces 20 independent listPages() + filterPublishedPages() calls.
 *
 * @param workspaceId - Workspace ID (for cache key and token lookup)
 * @param siteId - Webflow site ID
 * @param getWorkspaceFn - Workspace lookup function (injected to avoid circular deps)
 */
export async function getWorkspacePages(
  workspaceId: string,
  siteId: string,
  getWorkspaceFn?: (id: string) => { webflowToken?: string | null } | null,
): Promise<Awaited<ReturnType<typeof listPages>>> {
  const key = `${workspaceId}:${siteId}`;

  // Check cache
  const cached = pageCache.get(key);
  if (cached && Date.now() - cached.fetchedAt < PAGE_CACHE_TTL) {
    return cached.pages;
  }

  // Single-flight: if another call is already fetching, wait for it
  const existing = pageInflight.get(key);
  if (existing) return existing;

  // Resolve workspace token
  let token: string | null | undefined;
  if (getWorkspaceFn) {
    token = getWorkspaceFn(workspaceId)?.webflowToken;
  } else {
    // Dynamic import to avoid circular dependency at module load time
    const { getWorkspace } = await import('./db/workspaces.js');
    token = getWorkspace(workspaceId)?.webflowToken;
  }

  if (!token) return [];

  const promise = listPages(siteId, token)
    .then(raw => {
      const pages = filterPublishedPages(raw);
      pageCache.set(key, { pages, fetchedAt: Date.now() });
      log.info({ workspaceId, siteId, pageCount: pages.length }, 'Page cache refreshed');
      return pages;
    })
    .catch(err => {
      log.warn({ workspaceId, siteId, err }, 'Failed to fetch Webflow pages');
      // Return stale cache if available
      const stale = pageCache.get(key);
      if (stale) return stale.pages;
      return [];
    })
    .finally(() => {
      pageInflight.delete(key);
    });

  pageInflight.set(key, promise);
  return promise;
}

/**
 * Invalidate page cache for a workspace. Called on workspace settings save.
 */
export function invalidatePageCache(workspaceId: string): void {
  for (const key of pageCache.keys()) {
    if (key.startsWith(`${workspaceId}:`)) {
      pageCache.delete(key);
    }
  }
  log.debug({ workspaceId }, 'Page cache invalidated');
}

/**
 * Cache stats for health endpoint (§18).
 */
export function getPageCacheStats(): { entries: number; maxEntries: number } {
  return { entries: pageCache.size, maxEntries: 100 };
}
```

- [ ] **Step 4: Update tests — inject getWorkspaceFn to avoid import mocking issues**

The implementation uses dependency injection for workspace lookup (to avoid circular deps). Update tests to use this:

```typescript
// In the test file, replace the mock setup:
// Remove the vi.mock for workspaces.js since we're using DI now
// Update each test call to pass getWorkspaceFn:

const mockGetWorkspace = vi.fn().mockReturnValue({ webflowToken: 'token-123' });

// In test:
const pages = await getWorkspacePages('ws-1', 'site-1', mockGetWorkspace);
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/unit/workspace-data.test.ts`
Expected: All tests PASS

- [ ] **Step 6: Verify types compile**

Run: `npx tsc --noEmit --skipLibCheck`
Expected: Zero errors

- [ ] **Step 7: Commit**

```bash
git add server/workspace-data.ts tests/unit/workspace-data.test.ts
git commit -m "feat(intelligence): add shared Webflow page accessor with 10-min cache

getWorkspacePages() replaces 20 independent listPages() calls with a cached,
single-flighted accessor. 10-minute TTL, workspace-scoped invalidation,
graceful fallback to stale cache on API error.

Spec: docs/superpowers/specs/unified-workspace-intelligence.md §5"
```

---

## Task 5: Core Assembler — `workspace-intelligence.ts`

**Files:**
- Create: `server/workspace-intelligence.ts`
- Create: `tests/unit/workspace-intelligence.test.ts`
- Modify: `server/ws-events.ts` (add event constant)

**Docs to check:**
- Spec §3 (architecture), §12 (error handling), §13 (performance), §14 (feature flags), §18 (observability)
- `server/seo-context.ts` for `buildSeoContext()` internals
- `server/analytics-insights-store.ts` for `getInsights()`
- `server/workspace-learnings.ts` for `getWorkspaceLearnings()`
- `server/outcome-tracking.ts` for `getActionsByPage()`

- [ ] **Step 1: Add WebSocket event constant**

In `server/ws-events.ts`, add to the `WS_EVENTS` object, after the `OUTCOME_PLAYBOOK_DISCOVERED` line:

```typescript
  // Intelligence layer cache
  INTELLIGENCE_CACHE_UPDATED: 'intelligence:cache_updated',
```

- [ ] **Step 2: Write failing tests for the assembler**

```typescript
// tests/unit/workspace-intelligence.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock all subsystem dependencies
vi.mock('../../server/seo-context.js', () => ({
  buildSeoContext: vi.fn(),
}));
vi.mock('../../server/analytics-insights-store.js', () => ({
  getInsights: vi.fn(),
}));
vi.mock('../../server/workspace-learnings.js', () => ({
  getWorkspaceLearnings: vi.fn(),
}));
vi.mock('../../server/outcome-tracking.js', () => ({
  getActionsByPage: vi.fn(),
  getOutcomesForAction: vi.fn(),
}));
vi.mock('../../server/feature-flags.js', () => ({
  isFeatureEnabled: vi.fn().mockReturnValue(true),
}));

import { buildWorkspaceIntelligence } from '../../server/workspace-intelligence.js';
import { buildSeoContext } from '../../server/seo-context.js';
import { getInsights } from '../../server/analytics-insights-store.js';
import { getWorkspaceLearnings } from '../../server/workspace-learnings.js';

const mockBuildSeoContext = vi.mocked(buildSeoContext);
const mockGetInsights = vi.mocked(getInsights);
const mockGetLearnings = vi.mocked(getWorkspaceLearnings);

describe('buildWorkspaceIntelligence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockBuildSeoContext.mockReturnValue({
      strategy: undefined,
      brandVoiceBlock: 'Test brand voice',
      businessContext: 'Test context',
      personasBlock: '',
      knowledgeBlock: '',
      keywordBlock: '',
      fullContext: '',
    } as any);
    mockGetInsights.mockReturnValue([]);
    mockGetLearnings.mockReturnValue(null);
  });

  it('returns a valid WorkspaceIntelligence object with version and timestamp', async () => {
    const result = await buildWorkspaceIntelligence('ws-1');
    expect(result.version).toBe(1);
    expect(result.workspaceId).toBe('ws-1');
    expect(result.assembledAt).toBeDefined();
    expect(new Date(result.assembledAt).getTime()).not.toBeNaN();
  });

  it('assembles only requested slices', async () => {
    const result = await buildWorkspaceIntelligence('ws-1', { slices: ['seoContext'] });
    expect(result.seoContext).toBeDefined();
    expect(result.insights).toBeUndefined();
    expect(result.learnings).toBeUndefined();
  });

  it('assembles all slices when none specified', async () => {
    const result = await buildWorkspaceIntelligence('ws-1');
    // seoContext always populates (buildSeoContext is mocked to return data)
    expect(result.seoContext).toBeDefined();
    // insights populates (even if empty array)
    expect(result.insights).toBeDefined();
  });

  it('gracefully handles subsystem failure — returns partial data', async () => {
    mockBuildSeoContext.mockImplementation(() => { throw new Error('SEO context failed'); });
    mockGetInsights.mockReturnValue([
      { id: '1', insightType: 'content_decay', severity: 'warning', impactScore: 5 },
    ] as any);

    const result = await buildWorkspaceIntelligence('ws-1', { slices: ['seoContext', 'insights'] });
    // seoContext failed — should be undefined, not throw
    expect(result.seoContext).toBeUndefined();
    // insights should still work
    expect(result.insights).toBeDefined();
    expect(result.insights!.all).toHaveLength(1);
  });

  it('caps insights at 100 by impact score', async () => {
    const manyInsights = Array.from({ length: 150 }, (_, i) => ({
      id: `insight-${i}`,
      insightType: 'content_decay',
      severity: 'warning',
      impactScore: i,
    }));
    mockGetInsights.mockReturnValue(manyInsights as any);

    const result = await buildWorkspaceIntelligence('ws-1', { slices: ['insights'] });
    expect(result.insights!.all.length).toBeLessThanOrEqual(100);
    // Should have the highest impact scores
    expect(result.insights!.all[0].impactScore).toBe(149);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run tests/unit/workspace-intelligence.test.ts`
Expected: FAIL — module not found

- [ ] **Step 4: Implement the core assembler**

```typescript
// server/workspace-intelligence.ts
// Core intelligence assembler — query-time assembly of all subsystem data.
// Spec: docs/superpowers/specs/unified-workspace-intelligence.md §3, §12, §13

import { createLogger } from './logger.js';
import { isFeatureEnabled } from './feature-flags.js';
import { LRUCache, singleFlight } from './intelligence-cache.js';
import type {
  WorkspaceIntelligence,
  IntelligenceOptions,
  IntelligenceSlice,
  SeoContextSlice,
  InsightsSlice,
  LearningsSlice,
} from '../shared/types/intelligence.js';
import type { AnalyticsInsight, InsightType, InsightSeverity } from '../shared/types/analytics.js';

const log = createLogger('workspace-intelligence');

// ── Cache (§13, §33) ───────────────────────────────────────────────────

const intelligenceCache = new LRUCache<WorkspaceIntelligence>(200);
const INTELLIGENCE_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// ── Assembly ────────────────────────────────────────────────────────────

const ALL_SLICES: IntelligenceSlice[] = [
  'seoContext', 'insights', 'learnings', 'pageProfile',
  'contentPipeline', 'siteHealth', 'clientSignals', 'operational',
];

export async function buildWorkspaceIntelligence(
  workspaceId: string,
  opts?: IntelligenceOptions,
): Promise<WorkspaceIntelligence> {
  const cacheKey = buildCacheKey(workspaceId, opts);

  // Check cache
  const cached = intelligenceCache.get(cacheKey);
  if (cached && !cached.stale) return cached.data;

  // Single-flight dedup (§13)
  return singleFlight(cacheKey, async () => {
    const start = Date.now();
    const requestedSlices = opts?.slices ?? ALL_SLICES;

    const result: WorkspaceIntelligence = {
      version: 1,
      workspaceId,
      assembledAt: new Date().toISOString(),
    };

    // Assemble each requested slice independently (§12)
    for (const slice of requestedSlices) {
      try {
        await assembleSlice(result, workspaceId, slice, opts);
      } catch (err) {
        log.warn({ workspaceId, slice, err }, 'Intelligence slice assembly failed — skipping');
        // result[slice] remains undefined — consumers check for presence
      }
    }

    // Cache the result
    intelligenceCache.set(cacheKey, result, INTELLIGENCE_CACHE_TTL);

    // Observability (§18)
    log.info({
      workspaceId,
      assembly_ms: Date.now() - start,
      slices_requested: requestedSlices,
      slices_returned: Object.keys(result).filter(k => !['version', 'workspaceId', 'assembledAt'].includes(k)),
    }, 'Intelligence assembled');

    return result;
  });
}

// ── Slice assemblers ────────────────────────────────────────────────────

async function assembleSlice(
  result: WorkspaceIntelligence,
  workspaceId: string,
  slice: IntelligenceSlice,
  opts?: IntelligenceOptions,
): Promise<void> {
  switch (slice) {
    case 'seoContext':
      result.seoContext = await assembleSeoContext(workspaceId, opts);
      break;
    case 'insights':
      result.insights = await assembleInsights(workspaceId, opts);
      break;
    case 'learnings':
      result.learnings = await assembleLearnings(workspaceId, opts);
      break;
    // Phase 1: pageProfile, contentPipeline, siteHealth, clientSignals, operational
    // are stubbed — they return undefined (slice not present in result).
    // Full assembly implemented in Phases 2-4.
    case 'pageProfile':
    case 'contentPipeline':
    case 'siteHealth':
    case 'clientSignals':
    case 'operational':
      log.debug({ workspaceId, slice }, 'Slice not yet implemented — skipping');
      break;
  }
}

async function assembleSeoContext(
  workspaceId: string,
  opts?: IntelligenceOptions,
): Promise<SeoContextSlice> {
  const { buildSeoContext } = await import('./seo-context.js');
  const ctx = buildSeoContext(workspaceId, opts?.pagePath, opts?.learningsDomain ?? 'all');

  return {
    strategy: ctx.strategy,
    brandVoice: ctx.brandVoiceBlock,
    businessContext: ctx.businessContext,
    personas: [], // TODO: parse from personasBlock or load directly in Phase 2
    knowledgeBase: ctx.knowledgeBlock,
  };
}

async function assembleInsights(
  workspaceId: string,
  opts?: IntelligenceOptions,
): Promise<InsightsSlice> {
  const { getInsights } = await import('./analytics-insights-store.js');
  const all: AnalyticsInsight[] = getInsights(workspaceId);

  // Cap at 100, sorted by impact score descending (§13)
  const sorted = [...all].sort((a, b) => (b.impactScore ?? 0) - (a.impactScore ?? 0));
  const capped = sorted.slice(0, 100);

  // Group by type
  const byType: Partial<Record<InsightType, AnalyticsInsight[]>> = {};
  for (const insight of capped) {
    const list = byType[insight.insightType] ?? [];
    list.push(insight);
    byType[insight.insightType] = list;
  }

  // Count by severity
  const bySeverity: Record<InsightSeverity, number> = {
    critical: 0, warning: 0, opportunity: 0, positive: 0,
  };
  for (const insight of capped) {
    bySeverity[insight.severity] = (bySeverity[insight.severity] ?? 0) + 1;
  }

  // Top 10 by impact
  const topByImpact = capped.slice(0, 10);

  // Page-specific filtering
  let forPage: AnalyticsInsight[] | undefined;
  if (opts?.pagePath) {
    forPage = capped.filter(i => i.pageId === opts.pagePath);
  }

  return { all: capped, byType, bySeverity, topByImpact, forPage };
}

async function assembleLearnings(
  workspaceId: string,
  opts?: IntelligenceOptions,
): Promise<LearningsSlice> {
  // Only assemble if feature flag is enabled
  if (!isFeatureEnabled('outcome-ai-injection')) {
    return {
      summary: null,
      confidence: null,
      topActionTypes: [],
      overallWinRate: 0,
      recentTrend: null,
      playbooks: [],
    };
  }

  const { getWorkspaceLearnings } = await import('./workspace-learnings.js');
  const { getPlaybooks } = await import('./outcome-playbooks.js');
  const summary = getWorkspaceLearnings(workspaceId, opts?.learningsDomain ?? 'all');
  const playbooks = getPlaybooks(workspaceId);

  return {
    summary,
    confidence: summary?.confidence ?? null,
    topActionTypes: summary?.overall.topActionTypes.slice(0, 5) ?? [],
    overallWinRate: summary?.overall.totalWinRate ?? 0,
    recentTrend: summary?.overall.recentTrend ?? null,
    playbooks,
  };
}

// ── Cache management ────────────────────────────────────────────────────

function buildCacheKey(workspaceId: string, opts?: IntelligenceOptions): string {
  const slices = (opts?.slices ?? ALL_SLICES).sort().join(',');
  const page = opts?.pagePath ?? '';
  return `intelligence:${workspaceId}:${slices}:${page}`;
}

/** Invalidate all cached intelligence for a workspace */
export function invalidateIntelligenceCache(workspaceId: string): void {
  const deleted = intelligenceCache.deleteByPrefix(`intelligence:${workspaceId}:`);
  log.debug({ workspaceId, entriesDeleted: deleted }, 'Intelligence cache invalidated');
}

/** Cache stats for health endpoint (§18) */
export function getIntelligenceCacheStats() {
  return intelligenceCache.stats();
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/unit/workspace-intelligence.test.ts`
Expected: All tests PASS

- [ ] **Step 6: Verify types compile and build succeeds**

Run: `npx tsc --noEmit --skipLibCheck && npx vite build`
Expected: Zero errors, build succeeds

- [ ] **Step 7: Commit**

```bash
git add server/workspace-intelligence.ts server/ws-events.ts tests/unit/workspace-intelligence.test.ts
git commit -m "feat(intelligence): add core assembler with per-slice assembly and caching

buildWorkspaceIntelligence() queries subsystems, returns typed WorkspaceIntelligence.
Per-slice try/catch for graceful degradation, 100-insight cap, LRU cache with
single-flight dedup, structured observability logging. Phase 1 implements seoContext,
insights, learnings slices; remaining slices stubbed for Phase 2-4.

Spec: docs/superpowers/specs/unified-workspace-intelligence.md §3, §12, §13, §18"
```

---

## Task 6: Prompt Formatter — `formatForPrompt()`

**Files:**
- Modify: `server/workspace-intelligence.ts` (add formatForPrompt function)
- Create: `tests/unit/format-for-prompt.test.ts`

**Docs to check:**
- Spec §3 section 2c (format behavior, verbosity levels, backward compat)
- Spec §20 (AI cost — token budgets per verbosity)
- Spec §29 (zero-data cold start prompt behavior)

- [ ] **Step 1: Write failing tests for prompt formatter**

```typescript
// tests/unit/format-for-prompt.test.ts
import { describe, it, expect } from 'vitest';
import { formatForPrompt } from '../../server/workspace-intelligence.js';
import type { WorkspaceIntelligence } from '../../shared/types/intelligence.js';

const baseIntelligence: WorkspaceIntelligence = {
  version: 1,
  workspaceId: 'ws-1',
  assembledAt: '2026-03-30T12:00:00.000Z',
};

const richIntelligence: WorkspaceIntelligence = {
  ...baseIntelligence,
  seoContext: {
    strategy: undefined,
    brandVoice: 'Professional, authoritative, data-driven',
    businessContext: 'SEO agency serving mid-market B2B companies',
    personas: [],
    knowledgeBase: 'We specialize in technical SEO and content strategy.',
  },
  insights: {
    all: [
      { id: '1', insightType: 'content_decay', severity: 'warning', impactScore: 8, pageId: '/blog/old-post' } as any,
      { id: '2', insightType: 'ranking_opportunity', severity: 'opportunity', impactScore: 6, pageId: '/services' } as any,
    ],
    byType: {},
    bySeverity: { critical: 0, warning: 1, opportunity: 1, positive: 0 },
    topByImpact: [],
  },
  learnings: {
    summary: null,
    confidence: 'medium',
    topActionTypes: [
      { type: 'content_refreshed', winRate: 0.72, count: 10 },
      { type: 'meta_updated', winRate: 0.45, count: 8 },
    ],
    overallWinRate: 0.58,
    recentTrend: 'improving',
    playbooks: [],
  },
};

describe('formatForPrompt', () => {
  it('returns a non-empty string for empty intelligence', () => {
    const result = formatForPrompt(baseIntelligence);
    expect(result).toBeTruthy();
    expect(typeof result).toBe('string');
    // Cold-start behavior (§29): should indicate limited data
    expect(result).toContain('Limited data available');
  });

  it('includes brand voice in compact mode', () => {
    const result = formatForPrompt(richIntelligence, { verbosity: 'compact' });
    expect(result).toContain('Professional');
  });

  it('includes insight counts in standard mode', () => {
    const result = formatForPrompt(richIntelligence, { verbosity: 'standard' });
    expect(result).toContain('warning');
    expect(result).toContain('opportunity');
  });

  it('includes win rates in detailed mode', () => {
    const result = formatForPrompt(richIntelligence, { verbosity: 'detailed' });
    expect(result).toContain('content_refreshed');
    expect(result).toContain('72%'); // 0.72 winRate → 72%
    expect(result).toContain('10 actions');
  });

  it('omits sections for undefined slices', () => {
    const partial: WorkspaceIntelligence = {
      ...baseIntelligence,
      seoContext: richIntelligence.seoContext,
      // No insights, no learnings
    };
    const result = formatForPrompt(partial, { verbosity: 'detailed' });
    expect(result).toContain('Professional');
    expect(result).not.toContain('Insights');
  });

  it('defaults to standard verbosity', () => {
    const result = formatForPrompt(richIntelligence);
    // Standard includes insights summary but not full learnings breakdown
    expect(result).toContain('warning');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/format-for-prompt.test.ts`
Expected: FAIL — formatForPrompt not exported

- [ ] **Step 3: Implement formatForPrompt**

Add to `server/workspace-intelligence.ts`:

```typescript
import type { PromptFormatOptions, PromptVerbosity } from '../shared/types/intelligence.js';

// ── Prompt formatter (§3 section 2c) ────────────────────────────────────

export function formatForPrompt(
  intelligence: WorkspaceIntelligence,
  opts?: PromptFormatOptions,
): string {
  const verbosity = opts?.verbosity ?? 'standard';
  const sections: string[] = [];

  sections.push('[Workspace Intelligence]');

  // Cold-start detection (§29)
  const hasData = intelligence.seoContext || intelligence.insights?.all.length || intelligence.learnings?.summary;
  if (!hasData) {
    sections.push('This workspace is newly onboarded. Limited data available.');
    if (intelligence.seoContext?.brandVoice) {
      sections.push(`Brand voice: ${intelligence.seoContext.brandVoice}`);
    }
    sections.push('Recommendation: Focus on establishing baseline data before making optimization decisions.');
    return sections.join('\n');
  }

  // SEO Context
  if (intelligence.seoContext) {
    sections.push(formatSeoContext(intelligence.seoContext, verbosity));
  }

  // Insights
  if (intelligence.insights && intelligence.insights.all.length > 0) {
    sections.push(formatInsights(intelligence.insights, verbosity));
  }

  // Learnings
  if (intelligence.learnings) {
    sections.push(formatLearnings(intelligence.learnings, verbosity));
  }

  return sections.filter(Boolean).join('\n\n');
}

function formatSeoContext(ctx: SeoContextSlice, verbosity: PromptVerbosity): string {
  const lines: string[] = ['## SEO Context'];

  if (ctx.brandVoice) lines.push(`Brand voice: ${ctx.brandVoice}`);
  if (ctx.businessContext) lines.push(`Business: ${ctx.businessContext}`);

  if (verbosity === 'detailed') {
    if (ctx.knowledgeBase) lines.push(`Knowledge: ${ctx.knowledgeBase}`);
    if (ctx.strategy) lines.push(`Strategy: ${ctx.strategy.siteKeywords?.length ?? 0} site keywords`);
  }

  return lines.join('\n');
}

function formatInsights(insights: InsightsSlice, verbosity: PromptVerbosity): string {
  const lines: string[] = ['## Active Insights'];
  const { bySeverity } = insights;

  lines.push(`Summary: ${bySeverity.critical} critical, ${bySeverity.warning} warning, ${bySeverity.opportunity} opportunity, ${bySeverity.positive} positive`);

  const limit = verbosity === 'compact' ? 3 : verbosity === 'standard' ? 5 : 10;
  const top = insights.topByImpact.length > 0 ? insights.topByImpact : insights.all;
  for (const insight of top.slice(0, limit)) {
    lines.push(`- [${insight.severity}] ${insight.insightType}: impact ${insight.impactScore ?? 'n/a'}${insight.pageId ? ` (${insight.pageId})` : ''}`);
  }

  return lines.join('\n');
}

function formatLearnings(learnings: LearningsSlice, verbosity: PromptVerbosity): string {
  if (!learnings.summary && learnings.topActionTypes.length === 0) return '';

  const lines: string[] = ['## Outcome Learnings'];

  if (learnings.recentTrend) lines.push(`Trend: ${learnings.recentTrend}`);
  if (learnings.confidence) lines.push(`Confidence: ${learnings.confidence}`);
  if (learnings.overallWinRate > 0) lines.push(`Overall win rate: ${Math.round(learnings.overallWinRate * 100)}%`);

  if (verbosity === 'detailed' || verbosity === 'standard') {
    if (learnings.topActionTypes.length > 0) {
      lines.push('Win rates by action type:');
      for (const { type, winRate, count } of learnings.topActionTypes) {
        lines.push(`  ${type}: ${Math.round(winRate * 100)}% (${count} actions)`);
      }
    }
  }

  return lines.join('\n');
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/format-for-prompt.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Verify types compile**

Run: `npx tsc --noEmit --skipLibCheck`
Expected: Zero errors

- [ ] **Step 6: Commit**

```bash
git add server/workspace-intelligence.ts tests/unit/format-for-prompt.test.ts
git commit -m "feat(intelligence): add formatForPrompt with 3 verbosity levels

Compact (~500 tokens): brand + top 3 insights + win rate summary.
Standard (~1500 tokens): full keyword context + top 5 insights + learnings.
Detailed (~3000 tokens): everything including knowledge base + all insights.
Cold-start detection returns minimal context for empty workspaces.

Spec: docs/superpowers/specs/unified-workspace-intelligence.md §3.2c, §20, §29"
```

---

## Task 7: API Route — `GET /api/intelligence/:workspaceId`

**Files:**
- Create: `server/routes/intelligence.ts`
- Modify: `server/app.ts` (import + mount)

**Docs to check:**
- Spec §8 (frontend integration — endpoint definition)
- `server/routes/insights.ts` for route pattern reference
- `server/app.ts` for route registration pattern

- [ ] **Step 1: Create the route module**

```typescript
// server/routes/intelligence.ts
// Intelligence API endpoint — serves WorkspaceIntelligence to frontend.
// Spec: docs/superpowers/specs/unified-workspace-intelligence.md §8

import { Router } from 'express';
import { requireWorkspaceAccess } from '../auth.js';
import { buildWorkspaceIntelligence, getIntelligenceCacheStats } from '../workspace-intelligence.js';
import { getPageCacheStats } from '../workspace-data.js';
import { createLogger } from '../logger.js';
import type { IntelligenceSlice } from '../../shared/types/intelligence.js';

const log = createLogger('intelligence-route');

const VALID_SLICES: Set<string> = new Set([
  'seoContext', 'insights', 'learnings', 'pageProfile',
  'contentPipeline', 'siteHealth', 'clientSignals', 'operational',
]);

const router = Router();

// GET /api/intelligence/health — cache stats for observability (§18)
// MUST be registered BEFORE the :workspaceId param route to avoid shadowing
router.get('/api/intelligence/health', (req, res) => {
  res.json({
    caches: {
      intelligence: getIntelligenceCacheStats(),
      pages: getPageCacheStats(),
    },
  });
});

// GET /api/intelligence/:workspaceId — fetch intelligence for a workspace
router.get(
  '/api/intelligence/:workspaceId',
  requireWorkspaceAccess('workspaceId'),
  async (req, res) => {
    try {
      const { workspaceId } = req.params;
      const slicesParam = req.query.slices as string | undefined;
      const pagePath = req.query.pagePath as string | undefined;

      // Parse slices from comma-separated query param
      let slices: IntelligenceSlice[] | undefined;
      if (slicesParam) {
        const requested = slicesParam.split(',').filter(s => VALID_SLICES.has(s));
        if (requested.length > 0) {
          slices = requested as IntelligenceSlice[];
        }
      }

      const intelligence = await buildWorkspaceIntelligence(workspaceId, {
        slices,
        pagePath: pagePath || undefined,
      });

      res.json(intelligence);
    } catch (err) {
      log.error({ err, workspaceId: req.params.workspaceId }, 'Intelligence fetch failed');
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    }
  },
);

export default router;
```

- [ ] **Step 2: Register the route in app.ts**

In `server/app.ts`:

Add import (with the other route imports, alphabetically):
```typescript
import intelligenceRouter from './routes/intelligence.js';
```

Add mount (with the other `app.use()` calls, before the Sentry error handler):
```typescript
  app.use(intelligenceRouter);
```

- [ ] **Step 3: Verify types compile and build succeeds**

Run: `npx tsc --noEmit --skipLibCheck && npx vite build`
Expected: Zero errors, build succeeds

- [ ] **Step 4: Manual smoke test**

Run: `npm run dev:all`
Then: `curl http://localhost:3001/api/intelligence/health`
Expected: JSON response with cache stats

Then: `curl -H "x-auth-token: <your-token>" http://localhost:3001/api/intelligence/<a-workspace-id>?slices=seoContext,insights`
Expected: JSON response with WorkspaceIntelligence shape

- [ ] **Step 5: Commit**

```bash
git add server/routes/intelligence.ts server/app.ts
git commit -m "feat(intelligence): add API endpoint GET /api/intelligence/:workspaceId

Serves WorkspaceIntelligence via query params: slices (comma-separated),
pagePath. Includes /api/intelligence/health endpoint for cache stats.
Health route registered before param route to avoid shadowing.

Spec: docs/superpowers/specs/unified-workspace-intelligence.md §8, §18"
```

---

## Task 8: Frontend Hook + API Client

**Files:**
- Create: `src/api/intelligence.ts`
- Create: `src/hooks/admin/useWorkspaceIntelligence.ts`
- Modify: `src/lib/queryKeys.ts` (add intelligence factory)

**Docs to check:**
- Spec §8 (frontend integration — hook definition, query key factory)
- `src/hooks/admin/useOutcomes.ts` for hook pattern
- `src/api/outcomes.ts` for API client pattern
- `src/lib/queryKeys.ts` for factory pattern

- [ ] **Step 1: Add query key factory**

In `src/lib/queryKeys.ts`, add to the `admin` object (after the existing `intelligenceSignals` key):

```typescript
    intelligence: (wsId: string, slices?: string[]) =>
      ['admin-intelligence', wsId, slices?.sort().join(',') ?? 'all'] as const,
```

- [ ] **Step 2: Create API client**

```typescript
// src/api/intelligence.ts
// Frontend API client for the intelligence layer.
// Spec: docs/superpowers/specs/unified-workspace-intelligence.md §8

import { get } from './client';
import type { WorkspaceIntelligence, IntelligenceSlice } from '../../shared/types/intelligence.js';

export const intelligenceApi = {
  /** Fetch workspace intelligence with optional slice filtering */
  getIntelligence(
    workspaceId: string,
    slices?: IntelligenceSlice[],
    pagePath?: string,
    signal?: AbortSignal,
  ): Promise<WorkspaceIntelligence> {
    const params = new URLSearchParams();
    if (slices?.length) params.set('slices', slices.join(','));
    if (pagePath) params.set('pagePath', pagePath);
    const qs = params.toString();
    return get<WorkspaceIntelligence>(
      `/api/intelligence/${workspaceId}${qs ? `?${qs}` : ''}`,
      signal,
    );
  },

  /** Fetch intelligence cache health stats */
  getHealth(signal?: AbortSignal) {
    return get<{ caches: Record<string, { entries: number; maxEntries: number }> }>(
      '/api/intelligence/health',
      signal,
    );
  },
};
```

- [ ] **Step 3: Create the React hook**

```typescript
// src/hooks/admin/useWorkspaceIntelligence.ts
// React Query hook for the Unified Workspace Intelligence Layer.
// Spec: docs/superpowers/specs/unified-workspace-intelligence.md §8

import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '../../lib/queryKeys';
import { intelligenceApi } from '../../api/intelligence';
import type { IntelligenceSlice } from '../../../shared/types/intelligence.js';

/**
 * Fetches workspace intelligence via the API.
 * Returns typed WorkspaceIntelligence with optional slice filtering.
 *
 * @param workspaceId - Workspace to fetch intelligence for
 * @param slices - Optional array of slices to include (default: all)
 * @param pagePath - Optional page path for per-page enrichment
 */
export function useWorkspaceIntelligence(
  workspaceId: string,
  slices?: IntelligenceSlice[],
  pagePath?: string,
) {
  return useQuery({
    queryKey: queryKeys.admin.intelligence(workspaceId, slices),
    queryFn: ({ signal }) => intelligenceApi.getIntelligence(workspaceId, slices, pagePath, signal),
    enabled: !!workspaceId,
    staleTime: 5 * 60 * 1000, // 5 min — matches server cache TTL
  });
}
```

- [ ] **Step 4: Verify types compile and build succeeds**

Run: `npx tsc --noEmit --skipLibCheck && npx vite build`
Expected: Zero errors, build succeeds

- [ ] **Step 5: Commit**

```bash
git add src/api/intelligence.ts src/hooks/admin/useWorkspaceIntelligence.ts src/lib/queryKeys.ts
git commit -m "feat(intelligence): add frontend hook and API client

useWorkspaceIntelligence() hook fetches intelligence via React Query with
5-min staleTime matching server cache TTL. queryKeys.admin.intelligence()
factory function added for type-safe key management.

Spec: docs/superpowers/specs/unified-workspace-intelligence.md §8"
```

---

## Task 9: Migrate 20 Webflow Page Callers

**Files:**
- Modify: 20 files that call `listPages()` + `filterPublishedPages()` directly

**Docs to check:**
- Spec §5 (migration plan — "each replacement is mechanical")
- `server/workspace-data.ts` for `getWorkspacePages()` signature

This task is split into 4 internal commits within PR #4. Each commit replaces 5 call sites for manageable diffs.

**Important pattern:** Each file currently does something like:
```typescript
const pages = filterPublishedPages(await listPages(siteId, token));
```
Replace with:
```typescript
const pages = await getWorkspacePages(workspaceId, siteId);
```

The workspaceId and siteId are always available in context (either from route params or function args). The token lookup is handled internally by `getWorkspacePages()`.

- [ ] **Step 1: Identify all 20 call sites**

Run: `grep -rn "listPages\|filterPublishedPages" server/ --include="*.ts" | grep -v "workspace-data.ts" | grep -v "webflow-pages.ts" | grep -v ".test."`

This gives the exact files and line numbers to modify.

- [ ] **Step 2: Batch 1 — Replace first 5-6 files**

For each file:
1. Add import: `import { getWorkspacePages } from '../workspace-data.js';` (adjust path as needed)
2. Replace `filterPublishedPages(await listPages(siteId, token))` with `await getWorkspacePages(workspaceId, siteId)`
3. Remove unused `listPages`/`filterPublishedPages` imports if they're no longer needed

- [ ] **Step 3: Verify batch 1 compiles and builds**

Run: `npx tsc --noEmit --skipLibCheck && npx vite build`
Expected: Zero errors

- [ ] **Step 4: Commit batch 1**

```bash
git add <files from batch 1>
git commit -m "refactor(intelligence): migrate batch 1 of listPages() callers to shared accessor

Replaces direct listPages() + filterPublishedPages() calls with cached
getWorkspacePages() in: <list files>. 5/20 migrated.

Spec: docs/superpowers/specs/unified-workspace-intelligence.md §5"
```

- [ ] **Step 5-8: Repeat for batches 2-4**

Same pattern for remaining files. Each batch gets its own commit. Final commit message: "20/20 migrated."

- [ ] **Step 9: Verify no direct listPages calls remain outside workspace-data.ts**

Run: `grep -rn "listPages" server/ --include="*.ts" | grep -v "workspace-data.ts" | grep -v "webflow-pages.ts" | grep -v ".test." | grep -v "// definition"`

Expected: Zero results (all calls routed through the shared accessor)

- [ ] **Step 10: Full build verify**

Run: `npx tsc --noEmit --skipLibCheck && npx vite build`
Expected: Zero errors, build succeeds

---

## Task 10: Shadow-Mode SEO Context Delegation

**Files:**
- Modify: `server/seo-context.ts`

**Docs to check:**
- Spec §3.2c (backward compatibility — delegates internally, same return type)
- Spec §14 (feature flag — `intelligence-shadow-mode`)
- Spec §16 (relationship to existing systems — seo-context delegates)

- [ ] **Step 1: Read current `buildSeoContext()` to understand the return shape**

Read `server/seo-context.ts` lines 55-150 to understand exactly what `buildSeoContext()` returns and how the cache works.

- [ ] **Step 2: Add shadow-mode comparison**

At the end of `buildSeoContext()`, BEFORE the return statement, add:

```typescript
  // Shadow-mode intelligence delegation (§14, §16)
  // When enabled, builds via intelligence layer in parallel and logs discrepancies.
  // ALWAYS returns the original result — shadow mode is observation-only.
  if (isFeatureEnabled('intelligence-shadow-mode')) {
    try {
      const { buildWorkspaceIntelligence } = await import('./workspace-intelligence.js');
      const intel = await buildWorkspaceIntelligence(workspaceId ?? '', {
        slices: ['seoContext'],
        pagePath,
        learningsDomain,
      });

      if (intel.seoContext) {
        // Compare key fields
        const mismatches: string[] = [];
        if (intel.seoContext.brandVoice !== result.brandVoiceBlock) {
          mismatches.push('brandVoice');
        }
        if (intel.seoContext.businessContext !== result.businessContext) {
          mismatches.push('businessContext');
        }
        if (mismatches.length > 0) {
          log.warn({ workspaceId, mismatches }, 'Intelligence shadow-mode mismatch detected');
        } else {
          log.debug({ workspaceId }, 'Intelligence shadow-mode: results match');
        }
      }
    } catch (err) {
      log.warn({ workspaceId, err }, 'Intelligence shadow-mode comparison failed');
    }
  }
```

**Note:** `seo-context.ts` already imports `isFeatureEnabled` from `./feature-flags.js` (line 6) — no new import needed.

- [ ] **Step 3: Make buildSeoContext async**

The shadow-mode code uses `await import(...)`. If `buildSeoContext` is currently synchronous, it needs to become async. Check the current signature — if it's already returning cached data synchronously, the shadow comparison should be fire-and-forget instead:

```typescript
  // Fire-and-forget — don't await, don't block the return
  if (isFeatureEnabled('intelligence-shadow-mode')) {
    void (async () => {
      try {
        // ... comparison code from above
      } catch (err) {
        log.warn({ workspaceId, err }, 'Intelligence shadow-mode comparison failed');
      }
    })();
  }
```

This ensures zero performance impact on existing callers.

- [ ] **Step 4: Verify types compile and build succeeds**

Run: `npx tsc --noEmit --skipLibCheck && npx vite build`
Expected: Zero errors

- [ ] **Step 5: Commit**

```bash
git add server/seo-context.ts
git commit -m "feat(intelligence): add shadow-mode delegation in buildSeoContext

When intelligence-shadow-mode flag is enabled, buildSeoContext() fires
a non-blocking comparison against buildWorkspaceIntelligence(). Logs
mismatches for validation. Always returns the original result — zero
impact on existing behavior. Flag defaults to off.

Spec: docs/superpowers/specs/unified-workspace-intelligence.md §14, §16"
```

---

## Task 11: Observability Logging

**Files:**
- Modify: `server/workspace-intelligence.ts` (already has basic logging, enhance)
- Modify: `server/workspace-data.ts` (add cache hit/miss logging)

**Docs to check:**
- Spec §18 (observability — required metrics table)

- [ ] **Step 1: Enhance workspace-intelligence.ts logging**

The assembler (Task 5) already logs `assembly_ms` and `slices_returned`. Add cache hit/miss tracking:

```typescript
// In buildWorkspaceIntelligence, after the cache check:
  const cached = intelligenceCache.get(cacheKey);
  if (cached && !cached.stale) {
    log.debug({ workspaceId, cache_hit: true, stale: false }, 'Intelligence cache hit');
    return cached.data;
  }
  if (cached?.stale) {
    log.debug({ workspaceId, cache_hit: true, stale: true }, 'Intelligence cache hit (stale)');
  }
```

- [ ] **Step 2: Add cache hit/miss logging to workspace-data.ts**

In `getWorkspacePages()`, after the cache check:

```typescript
  if (cached && Date.now() - cached.fetchedAt < PAGE_CACHE_TTL) {
    log.debug({ workspaceId, siteId, cache_hit: true }, 'Page cache hit');
    return cached.pages;
  }
  log.debug({ workspaceId, siteId, cache_hit: false }, 'Page cache miss');
```

- [ ] **Step 3: Verify types compile**

Run: `npx tsc --noEmit --skipLibCheck`
Expected: Zero errors

- [ ] **Step 4: Commit**

```bash
git add server/workspace-intelligence.ts server/workspace-data.ts
git commit -m "feat(intelligence): add structured observability logging

Cache hit/miss, assembly latency, stale data serving all logged as
structured Pino fields for aggregation. Metrics: intelligence.cache_hit,
workspace_data.pages.cache_hit, intelligence.assembly_ms.

Spec: docs/superpowers/specs/unified-workspace-intelligence.md §18"
```

---

## Task 12: Integration Tests + Test Seed

**Files:**
- Create: `tests/fixtures/intelligence-seed.ts`
- Create: `tests/unit/intelligence-integration.test.ts`

**Docs to check:**
- Spec §17 (testing strategy — integration tests, test data seeding)

- [ ] **Step 1: Create test seed utility**

```typescript
// tests/fixtures/intelligence-seed.ts
// Shared test data for intelligence layer tests.
// Spec: docs/superpowers/specs/unified-workspace-intelligence.md §17

import { randomUUID } from 'crypto';
import db from '../../server/db/index.js';

export interface SeededWorkspace {
  workspaceId: string;
  cleanup: () => void;
}

/**
 * Seeds a test workspace with intelligence-relevant data.
 * Returns the workspace ID and a cleanup function.
 */
export function seedIntelligenceTestData(): SeededWorkspace {
  const workspaceId = `test-intel-${randomUUID().slice(0, 8)}`;

  // Create workspace
  db.prepare(`
    INSERT INTO workspaces (id, name, domain, created_at, updated_at)
    VALUES (?, 'Test Intelligence Workspace', 'test.example.com', datetime('now'), datetime('now'))
  `).run(workspaceId);

  // Seed analytics insights (mix of types and severities)
  const insightTypes = ['content_decay', 'ranking_opportunity', 'ctr_opportunity', 'page_health', 'competitor_gap'];
  const severities = ['critical', 'warning', 'opportunity', 'positive'];
  for (let i = 0; i < 10; i++) {
    db.prepare(`
      INSERT INTO analytics_insights (id, workspace_id, page_id, insight_type, data, severity, domain, impact_score, computed_at)
      VALUES (?, ?, ?, ?, '{}', ?, 'search', ?, datetime('now'))
    `).run(
      `insight-${workspaceId}-${i}`,
      workspaceId,
      `/page-${i % 3}`,
      insightTypes[i % insightTypes.length],
      severities[i % severities.length],
      10 - i,
    );
  }

  // Seed tracked actions
  for (let i = 0; i < 5; i++) {
    db.prepare(`
      INSERT INTO tracked_actions (id, workspace_id, action_type, source_type, source_id, page_url, created_at, updated_at)
      VALUES (?, ?, 'content_refreshed', 'insight', ?, '/page-0', datetime('now'), datetime('now'))
    `).run(
      `action-${workspaceId}-${i}`,
      workspaceId,
      `insight-${workspaceId}-${i}`,
    );
  }

  // Seed annotations
  db.prepare(`
    INSERT INTO analytics_annotations (id, workspace_id, date, label, category, created_at)
    VALUES (?, ?, date('now'), 'Test annotation', 'action', datetime('now'))
  `).run(`ann-${workspaceId}-1`, workspaceId);

  const cleanup = () => {
    db.prepare('DELETE FROM analytics_annotations WHERE workspace_id = ?').run(workspaceId);
    db.prepare('DELETE FROM tracked_actions WHERE workspace_id = ?').run(workspaceId);
    db.prepare('DELETE FROM analytics_insights WHERE workspace_id = ?').run(workspaceId);
    db.prepare('DELETE FROM workspaces WHERE id = ?').run(workspaceId);
  };

  return { workspaceId, cleanup };
}
```

- [ ] **Step 2: Write integration tests**

```typescript
// tests/unit/intelligence-integration.test.ts
import { describe, it, expect, afterAll } from 'vitest';
import { seedIntelligenceTestData } from '../../tests/fixtures/intelligence-seed.js';
import { buildWorkspaceIntelligence, invalidateIntelligenceCache } from '../../server/workspace-intelligence.js';

describe('Intelligence Layer Integration', () => {
  const { workspaceId, cleanup } = seedIntelligenceTestData();

  afterAll(() => {
    cleanup();
  });

  it('assembles insights slice from seeded data', async () => {
    invalidateIntelligenceCache(workspaceId);
    const result = await buildWorkspaceIntelligence(workspaceId, { slices: ['insights'] });

    expect(result.version).toBe(1);
    expect(result.workspaceId).toBe(workspaceId);
    expect(result.insights).toBeDefined();
    expect(result.insights!.all.length).toBeGreaterThan(0);
    expect(result.insights!.all.length).toBeLessThanOrEqual(100);

    // Verify severity counts add up
    const { bySeverity } = result.insights!;
    const totalBySeverity = bySeverity.critical + bySeverity.warning + bySeverity.opportunity + bySeverity.positive;
    expect(totalBySeverity).toBe(result.insights!.all.length);
  });

  it('returns partial data when one slice fails', async () => {
    invalidateIntelligenceCache(workspaceId);
    // seoContext will fail for a test workspace (no real Webflow connection)
    // insights should still work
    const result = await buildWorkspaceIntelligence(workspaceId, {
      slices: ['seoContext', 'insights'],
    });

    // One slice may fail, the other should succeed
    expect(result.insights).toBeDefined();
    // seoContext may or may not be defined depending on workspace config
    // The key assertion: no exception thrown
  });

  it('caches results across calls', async () => {
    invalidateIntelligenceCache(workspaceId);
    const result1 = await buildWorkspaceIntelligence(workspaceId, { slices: ['insights'] });
    const result2 = await buildWorkspaceIntelligence(workspaceId, { slices: ['insights'] });

    // Same assembledAt timestamp means cache hit
    expect(result1.assembledAt).toBe(result2.assembledAt);
  });

  it('returns fresh data after cache invalidation', async () => {
    const result1 = await buildWorkspaceIntelligence(workspaceId, { slices: ['insights'] });
    invalidateIntelligenceCache(workspaceId);
    const result2 = await buildWorkspaceIntelligence(workspaceId, { slices: ['insights'] });

    // Different assembledAt means fresh assembly
    expect(result1.assembledAt).not.toBe(result2.assembledAt);
  });
});
```

- [ ] **Step 3: Run integration tests**

Run: `npx vitest run tests/unit/intelligence-integration.test.ts`
Expected: All tests PASS

- [ ] **Step 4: Run full test suite to verify no regressions**

Run: `npx vitest run`
Expected: All existing tests still pass

- [ ] **Step 5: Final build verify**

Run: `npx tsc --noEmit --skipLibCheck && npx vite build`
Expected: Zero errors, build succeeds

- [ ] **Step 6: Commit**

```bash
git add tests/fixtures/intelligence-seed.ts tests/unit/intelligence-integration.test.ts
git commit -m "test(intelligence): add integration tests and test seed utility

seedIntelligenceTestData() creates a workspace with 10 insights, 5 actions,
and 1 annotation. Integration tests verify slice assembly, partial failure
graceful degradation, caching, and invalidation against a real SQLite DB.

Spec: docs/superpowers/specs/unified-workspace-intelligence.md §17"
```

---

## Post-Phase 1 Checklist

After all 12 tasks are complete:

- [ ] Run full quality gates: `npx tsc --noEmit --skipLibCheck && npx vite build && npx vitest run`
- [ ] Run PR check: `npx tsx scripts/pr-check.ts`
- [ ] Update `FEATURE_AUDIT.md` — add entry for "Unified Workspace Intelligence Layer (Phase 1)"
- [ ] Update `data/roadmap.json` — mark Phase 1 item as done
- [ ] Verify no `violet`/`indigo` in `src/components/`: `grep -r "violet\|indigo" src/components/`
- [ ] Verify no direct `listPages()` calls outside `workspace-data.ts`: `grep -rn "listPages" server/ --include="*.ts" | grep -v workspace-data | grep -v webflow-pages | grep -v test`
- [ ] Deploy to staging, enable `intelligence-shadow-mode` flag via env var
- [ ] Monitor Pino logs for shadow-mode mismatches for 3 days
- [ ] Monitor `/api/intelligence/health` endpoint for cache stats
- [ ] After 3-day soak with zero mismatches: Phase 1 is validated, proceed to Phase 2 plan

---

## Phase 2 Preview (next plan, after Phase 1 soak)

Phase 2 covers event bridges. It will be a separate plan document created after Phase 1 is merged and validated on staging. Key deliverables:
- Bridge execution wrapper with per-bridge feature flags and dry-run mode
- Write-time bridges: #1 (outcome→reweight), #2 (decay→brief), #3 (strategy→cache), #5 (analysis→cache), #7 (action→resolve), #10 (anomaly→boost), #11 (knowledge→cascade), #12 (audit→insights), #13 (action→annotate)
- Standalone bridges: #14 (learnings→signals), #15 (audit→insights)
- Source tagging on all bridge-written data
- Debouncing and concurrency controls
