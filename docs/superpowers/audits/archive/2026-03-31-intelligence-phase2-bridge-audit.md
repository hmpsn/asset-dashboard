# Intelligence Phase 2 — Bridge Trigger Points Audit

**Date:** 2026-03-31
**Spec:** `docs/superpowers/specs/intelligence-phase2-context.md`
**Total findings:** 16 bridge trigger categories audited across ~40 server files

---

## Bridge #1 — Outcome Scored → Reweight Insight Scores (PR 2C)

**Trigger function:** `recordOutcome()` in `server/outcome-tracking.ts:193-229`

**Signature:**
```typescript
export function recordOutcome(params: {
  actionId: string;
  checkpointDays: 7 | 30 | 60 | 90;
  metricsSnapshot: BaselineSnapshot;
  score: OutcomeScore | null;
  earlySignal?: EarlySignal;
  deltaSummary: DeltaSummary;
  competitorContext?: object | null;
}): ActionOutcome
```

**All callers (4 — all in `server/outcome-measurement.ts`):**

| Line | Context | Score |
|------|---------|-------|
| 279 | Insufficient data edge case | `'insufficient_data'` |
| 311 | No GSC baseline | `'inconclusive'` |
| 341 | All metrics undefined | `'inconclusive'` |
| 380 | Normal scoring path | Computed score |

**Trigger:** Daily cron via `measurePendingOutcomes()`. All 4 calls are in the same function.

**Hook strategy:** Add post-hook AFTER `recordOutcome()` returns in `outcome-measurement.ts`. The `measureOutcome()` function already has the `action` variable with `workspaceId` and page data needed for Bridge #1.

**Important:** `recordOutcome()` uses `db.transaction()` internally (inserts outcome + marks complete at 90d). Bridge #1 must run AFTER the transaction commits, not inside it.

---

## Bridge #2 — Content Decay → Auto-Suggest Brief (PR 2B)

**Trigger function:** `analyzeContentDecay()` in `server/content-decay.ts:98`

**Signature:**
```typescript
export async function analyzeContentDecay(ws: Workspace): Promise<DecayAnalysis>
```

**All callers (1):**

| File | Line | Route |
|------|------|-------|
| `server/routes/content-decay.ts` | 20 | `POST /api/content-decay/:workspaceId/analyze` |

**Hook strategy:** Add post-hook in the route handler after `analyzeContentDecay()` returns. The `DecayAnalysis` result contains `decayingPages` array — each page can generate a suggested brief.

**DB target:** `suggested_briefs` table (exists from migration 043, zero CRUD endpoints exist yet).

---

## Bridge #3 — Strategy Updated → Invalidate Cache (PR 2B)

**Trigger:** Keyword strategy saved via `updateWorkspace({keywordStrategy})`

**All trigger points (3):**

| File | Line | Context |
|------|------|---------|
| `server/routes/keyword-strategy.ts` | 1772 | Full strategy generation (POST) |
| `server/routes/keyword-strategy.ts` | 1915 | Partial strategy update (PATCH) |
| `server/routes/public-portal.ts` | 481 | Business context update via portal |

**Existing invalidation:** Lines 1773 and 1916 already call `clearSeoContextCache(ws.id)`.

**Hook strategy:** Add `invalidateIntelligenceCache(ws.id)` alongside existing `clearSeoContextCache()` calls. Use debounce (2s) since strategy generation may trigger multiple saves.

**Note:** `invalidateIntelligenceCache()` is currently defined but **never called anywhere** in the codebase.

---

## Bridge #4 — Insight Resolved → Record Action (ALREADY EXISTS)

**Location:** `server/routes/insights.ts:40-64`

**Verified code:** Route `PUT /api/insights/:workspaceId/:insightId/resolve` already calls `recordAction()` with `actionType: 'insight_acted_on'` when status is `'resolved'`.

**Action needed:** Verify test coverage only. No new code required.

---

## Bridge #5 — Page Analysis Complete → Clear Caches (PR 2B)

**Trigger function:** `upsertPageKeyword()` in `server/page-keywords.ts:255`

**Signature:**
```typescript
export function upsertPageKeyword(workspaceId: string, entry: PageKeywordMap): void
```

**All callers (2 + 1 batch variant):**

| File | Line | Context |
|------|------|---------|
| `server/routes/webflow-keywords.ts` | 151 | Single page analysis saved |
| `server/routes/jobs.ts` | 833 | Batch via `upsertPageKeywordsBatch()` (transactional) |

**Related batch function:** `replaceAllPageKeywords(ws.id, pageMap)` called at keyword-strategy.ts:1740 after strategy generation.

**Hook strategy:** Add `clearSeoContextCache(wsId)` + `invalidateIntelligenceCache(wsId)` after `upsertPageKeyword()` calls. Debounce 2s for batch operations.

**Note:** `clearSeoContextCache` is already called at keyword-strategy.ts:1773 after strategy save, but NOT after individual page analysis in webflow-keywords.ts.

---

## Bridge #7 — Action Recorded → Auto-Resolve Insights (PR 2B)

**Trigger function:** `recordAction()` in `server/outcome-tracking.ts:100-135`

**Signature:**
```typescript
export function recordAction(params: RecordActionParams): TrackedAction
```

**All callers (13 across 10 files):**

| File | Line | Action Type |
|------|------|-------------|
| `server/outcome-backfill.ts` | 82 | `content_published` (backfill) |
| `server/outcome-backfill.ts` | 123 | `insight_acted_on` (backfill) |
| `server/outcome-backfill.ts` | 181 | `audit_fix_applied` (backfill) |
| `server/routes/workspaces.ts` | 438 | `voice_calibrated` |
| `server/routes/content-posts.ts` | 184 | `content_published` |
| `server/routes/insights.ts` | 44 | `insight_acted_on` |
| `server/routes/content-decay.ts` | 50 | `content_refreshed` |
| `server/routes/webflow-analysis.ts` | 252 | `internal_link_added` |
| `server/routes/keyword-strategy.ts` | 1777 | `strategy_keyword_added` |
| `server/routes/outcomes.ts` | 291 | Manual action (API) |
| `server/routes/webflow-schema.ts` | 208 | `schema_deployed` |
| `server/routes/recommendations.ts` | 100 | `audit_fix_applied` |
| `server/routes/content-briefs.ts` | 188 | `brief_created` |
| `server/routes/approvals.ts` | 315 | `meta_updated` |

**Post-hook infrastructure:** NONE exists. `recordAction()` does a simple INSERT and returns.

**Hook strategy:** Two options:
1. **Modify `recordAction()` to accept an optional post-hook callback** — cleanest but touches outcome-tracking.ts which many files import
2. **Add bridge calls at each call site** — more verbose but zero risk to existing behavior

**Recommended:** Option 1 — add a `afterRecord?: (action: TrackedAction) => void` parameter, or better yet, call bridge infrastructure directly inside `recordAction()` since all callers already have workspaceId.

**Bridge #7 logic:** After action recorded, query `getInsights(workspaceId)` for insights matching `action.pageUrl` or `action.targetKeyword`, update their `resolutionStatus` to `'in_progress'`.

---

## Bridge #10 — Anomaly Confirmed → Boost Insight Severity (PR 2C)

**Trigger:** Anomaly-to-insight conversion in `server/anomaly-detection.ts:544-596`

**Existing flow:** `runAnomalyDetection()` (line 451) already calls `upsertAnomalyDigestInsight()` for each detected anomaly. This maps anomaly type/severity to insight domain and computes impact score.

**Hook strategy:** After `upsertAnomalyDigestInsight()` call at line 584, add bridge that queries existing insights for the same page and boosts their `impact_score`. Use workspace mutex since this modifies existing rows.

**Frequency:** Runs every 12 hours. Max twice daily per workspace.

---

## Bridge #11 — Knowledge/Strategy Updated → Cascade Invalidation (PR 2B)

**Trigger:** Workspace settings save via `updateWorkspace()`

**All trigger points:**

| File | Line | Context |
|------|------|---------|
| `server/routes/workspaces.ts` | 207 | `PATCH /api/workspaces/:id` — general settings update |
| `server/routes/workspaces.ts` | 209 | Already calls `clearSeoContextCache(req.params.id)` |

**Related generation routes (return data but DON'T auto-persist):**
- `POST /api/workspaces/:id/generate-brand-voice` (line 378) — returns `{ brandVoice }`, doesn't save
- `POST /api/workspaces/:id/generate-knowledge-base` (line 306) — returns `{ knowledgeBase }`, doesn't save
- `POST /api/workspaces/:id/generate-personas` (line 460) — returns `{ personas }`, doesn't save

**Note:** These generation routes return data to the frontend, which then calls PATCH to save. So the PATCH route (line 207) is the single trigger point.

**Hook strategy:** Add `invalidateIntelligenceCache(req.params.id)` alongside existing `clearSeoContextCache()` at line 209. Debounce 2s.

---

## Bridge #12 — Audit Complete → Generate Insights (PR 2C)

**Trigger function:** `saveSnapshot()` in `server/reports.ts:109`

**Schema:**
```sql
INSERT INTO audit_snapshots
  (id, site_id, site_name, created_at, audit, logo_url, action_items, previous_score)
VALUES (@id, @site_id, @site_name, @created_at, @audit, @logo_url, @action_items, @previous_score)
```

**Existing audit-to-insight flow:** `computePageHealthScores()` in `server/analytics-intelligence.ts:170-225` creates `page_health` insights from GSC/GA4 data, NOT from audit snapshots. No code currently reads `audit_snapshots` to generate insights.

**Hook strategy:** After `saveSnapshot()`, parse the audit JSON for critical/warning issues and create `page_health` insights. Must deduplicate against existing insights (same workspace + page + type). Requires `db.transaction()` for multi-INSERT.

---

## Bridge #13 — Action Recorded → Create Annotation (PR 2B)

**Same trigger as Bridge #7:** `recordAction()` — all 13 call sites listed above.

**Target function:** `createAnnotation()` in `server/analytics-annotations.ts`

**Signature:**
```typescript
export function createAnnotation(opts: {
  workspaceId: string; date: string; label: string; category: string; createdBy?: string
}): { id: string }
```

**Schema confirmed:** `analytics_annotations` table has NO `pageUrl` column.
- Columns: `id, workspace_id, date, label, category, created_by, created_at`
- Bridge #13 should encode page context in `label` field (e.g., "Content published: /blog/post-title")

---

## Bridge #15 — Audit Stored → Site Health Insights (PR 2C)

**Same trigger as Bridge #12:** `saveSnapshot()` in `server/reports.ts:109`

**Distinction from #12:** Bridge #12 generates per-page `page_health` insights from audit issues. Bridge #15 generates workspace-level site health summary insights.

**Hook strategy:** Same hook point as #12, but generates different insight type/data. Both can share the same post-`saveSnapshot()` hook with separate bridge IDs.

---

## Database Schemas (Verified)

### `suggested_briefs` (migration 043)
```sql
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
```
**Existing CRUD:** NONE — no store functions, no route endpoints.

### `intelligence_sub_cache` (migration 043)
```sql
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
```

### `content_pipeline_cache` (migration 043)
```sql
CREATE TABLE IF NOT EXISTS content_pipeline_cache (
  workspace_id TEXT PRIMARY KEY,
  summary_json TEXT NOT NULL DEFAULT '{}',
  cached_at TEXT NOT NULL DEFAULT (datetime('now')),
  invalidated_at TEXT,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);
```
**Existing CRUD:** NONE — no store functions.

### `analytics_annotations` (migration 036)
```sql
CREATE TABLE IF NOT EXISTS analytics_annotations (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  date TEXT NOT NULL,
  label TEXT NOT NULL,
  category TEXT NOT NULL,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```
**Confirmed:** NO `pageUrl` column.

### Content Pipeline Tables (status columns)

| Table | Status Column | Values |
|-------|--------------|--------|
| `content_briefs` | **NONE** | N/A — count all rows |
| `content_posts` | `status` | `'generating'` default |
| `content_matrices` | **NONE** | N/A — count all rows |
| `content_topic_requests` | `status` | `'requested'` default |
| `work_orders` | `status` | `'pending'` default |
| `seo_suggestions` | `status` | `'pending'`, `'applied'`, `'dismissed'` |

**Existing aggregate functions:** NONE — no functions currently aggregate pipeline counts.

---

## Cache Invalidation Audit

### Current callers of `invalidateIntelligenceCache()`:
**ZERO** — defined in `workspace-intelligence.ts:303-306` but never called anywhere.

### Current callers of `invalidatePageCache()`:
**ZERO** — defined in `workspace-data.ts` but never called anywhere.

### Current callers of `clearSeoContextCache()`:
| File | Line | Context |
|------|------|---------|
| `server/routes/keyword-strategy.ts` | 1773 | After full strategy generation |
| `server/routes/keyword-strategy.ts` | 1916 | After partial strategy update |
| `server/routes/workspaces.ts` | 209 | After workspace settings PATCH |

---

## Infrastructure Recommendations

### 1. Shared Bridge Post-Hook Pattern
Rather than adding bridge calls at 13+ `recordAction()` call sites, modify `recordAction()` to invoke bridge infrastructure internally. Same for `recordOutcome()` (4 call sites) and `saveSnapshot()`.

### 2. pr-check Rule Addition
Add a check for `invalidateIntelligenceCache` to ensure it's called whenever `clearSeoContextCache` is called — they should always be paired.

### 3. `getContentPipelineSummary()` Queries
Needs 6 COUNT queries:
```sql
SELECT COUNT(*) FROM content_briefs WHERE workspace_id = ?
SELECT COUNT(*), status FROM content_posts WHERE workspace_id = ? GROUP BY status
SELECT COUNT(*) FROM content_matrices WHERE workspace_id = ?
SELECT COUNT(*), status FROM content_topic_requests WHERE workspace_id = ? GROUP BY status
SELECT COUNT(*), status FROM work_orders WHERE workspace_id = ? GROUP BY status
SELECT COUNT(*), status FROM seo_suggestions WHERE workspace_id = ? GROUP BY status
```

### 4. Test Coverage Gaps
- Bridge #4 (insight → action) has no dedicated test
- `suggested_briefs` table has no tests
- `content_pipeline_cache` table has no tests

---

## Parallelization Strategy

### PR 2A — Sequential (infrastructure)
All new files, no conflicts:
1. `server/bridge-infrastructure.ts` — execution wrapper, debounce, mutex (NEW FILE)
2. `shared/types/feature-flags.ts` — add 16 bridge flags (SHARED, must be first)
3. `server/workspace-data.ts` — LRU migration + singleFlight + `getContentPipelineSummary()` (SINGLE OWNER)
4. `src/hooks/admin/index.ts` — barrel export (TRIVIAL)

### PR 2B — Parallel (2-3 agents possible)
- **Agent A:** Bridges #3, #5, #11 (cache invalidation bridges — touch routes only)
  - Owns: routes/keyword-strategy.ts, routes/workspaces.ts, routes/webflow-keywords.ts, routes/jobs.ts
- **Agent B:** Bridges #7, #13 (recordAction post-hooks)
  - Owns: server/outcome-tracking.ts (add post-hook), bridge handler for auto-resolve + annotate
- **Agent C:** Bridge #2 + suggested_briefs CRUD
  - Owns: server/suggested-briefs.ts (NEW), routes/suggested-briefs.ts (NEW), routes/content-decay.ts

### PR 2C — Sequential (complex, needs careful review)
- Bridges #1, #10 (score modification — need mutex, dedup)
- Bridges #12, #15 (audit → insights — need transaction, dedup)
- Slice assembly (contentPipeline, siteHealth)
- Shadow-mode expansion

### Model Assignments

| Task Type | Model | Reasoning |
|-----------|-------|-----------|
| Feature flag registration | Haiku | Mechanical additions to types file |
| Barrel export | Haiku | Single-line addition |
| Cache invalidation bridges (#3, #5, #11) | Haiku | Add 1-2 lines after existing code |
| Bridge infrastructure (wrapper, debounce, mutex) | Sonnet | New module with patterns from spec |
| `getContentPipelineSummary()` | Sonnet | 6 SQL queries + cache logic |
| `recordAction` post-hook + bridges #7, #13 | Sonnet | Modifies existing function signature |
| Suggested briefs CRUD + bridge #2 | Sonnet | New store + routes + bridge logic |
| Score modification bridges (#1, #10) | Opus | Needs careful dedup + mutex reasoning |
| Audit → insights bridges (#12, #15) | Opus | Transaction + dedup + multi-table |
| Slice assembly | Sonnet | Assembly from existing data |
| Shadow-mode expansion | Sonnet | Comparison logic extension |
| Orchestration / review | Opus | Cross-agent conflict detection |
