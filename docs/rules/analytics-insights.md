# Analytics Insights Engine — Rules & Contracts

> Read this before working on anything in `analytics-intelligence.ts`, `analytics-insights-store.ts`,
> `shared/types/analytics.ts`, or any component that reads from the insight store.

---

## 1. New Insight Type Registration Checklist

Adding a new `InsightType` value **requires all eight of these**. TypeScript will
catch a missing `InsightType` union entry, but will NOT catch a missing `InsightDataMap` entry,
missing Zod schema, or missing frontend renderer — those fail silently at runtime.

- [ ] Add value to `InsightType` union in `shared/types/analytics.ts`
- [ ] Define a typed `XData` interface for the `data` field in `shared/types/analytics.ts`
- [ ] Add `type_value: XData` entry to `InsightDataMap` in `shared/types/analytics.ts`
  — **never leave as `Record<string, unknown>`** — that defeats the discriminated union
- [ ] Add Zod schema `xDataSchema` in `server/schemas/insight-schemas.ts` matching the interface field-for-field
- [ ] Add computation function in `server/analytics-intelligence.ts`
- [ ] Add domain classification in `server/insight-enrichment.ts` → `classifyDomain()`
- [ ] Add impact score formula in `server/insight-enrichment.ts` → `computeImpactScore()`
- [ ] Add renderer case in `InsightFeedItem` (or equivalent frontend component)

**Verification after adding a new type:**
```bash
grep -rn "YOUR_NEW_TYPE" shared/types/ server/ src/
```
Expect hits in all 8 locations.

**Current types and their data interfaces:**

| InsightType | Data Interface | Zod Schema | Status |
|---|---|---|---|
| `page_health` | `PageHealthData` | needs schema | existing |
| `ranking_opportunity` | `QuickWinData` | needs schema | existing (renamed from `quick_win`) |
| `content_decay` | `ContentDecayData` | needs schema | existing |
| `cannibalization` | `CannibalizationData` | needs schema | existing |
| `keyword_cluster` | `KeywordClusterData` | needs schema | existing |
| `competitor_gap` | `CompetitorGapData` | needs schema | existing |
| `conversion_attribution` | `ConversionAttributionData` | needs schema | existing |
| `ranking_mover` | `RankingMoverData` | needs schema | Phase 1 |
| `ctr_opportunity` | `CtrOpportunityData` | needs schema | Phase 1 |
| `serp_opportunity` | `SerpOpportunityData` | needs schema | Phase 1 |
| `strategy_alignment` | ⚠️ `Record<string,unknown>` — needs typed interface | needs schema | Phase 1 |
| `anomaly_digest` | `AnomalyDigestData` | needs schema | Phase 2 |
| `audit_finding` | `AuditFindingData` | needs schema | existing (bridge-generated per-page and site-level audit issues) |
| `site_health` | `SiteHealthInsightData` | needs schema | existing (Bridge #15 — site-level audit health summary) |
| `emerging_keyword` | `EmergingKeywordData` | ✓ | Tier 2 Phase 5 |
| `competitor_alert` | `CompetitorAlertData` | ✓ | Tier 2 Phase 5 |
| `freshness_alert` | `FreshnessAlertData` | ✓ | Tier 2 Phase 6 |

---

## 2. DB Column + Mapper Lockstep

When adding columns to `analytics_insights` (or any insight-adjacent table), these four must ship
in the same commit. TypeScript will not catch a mapper that silently ignores a new DB column.

1. **Migration SQL** — `server/db/migrations/XXXX-*.sql`
2. **Row interface** — `InsightRow` in `analytics-insights-store.ts`
3. **Read mapper** — `rowToInsight()` in `analytics-insights-store.ts`
4. **Write path** — `upsertInsight()` parameters in `analytics-insights-store.ts`

Current `analytics_insights` columns added in Phase 1:
`page_title`, `strategy_keyword`, `strategy_alignment`, `audit_issues` (JSON),
`pipeline_status`, `anomaly_linked`, `impact_score`, `domain`

Phase 3 resolution columns (added alongside `resolveInsight()` / admin action queue):
`resolution_status`, `resolution_note`, `resolved_at`, `resolution_source`, `bridge_source`

Note: `resolution_status`, `resolution_note`, and `resolved_at` are intentionally **omitted** from the `upsertInsight()` ON CONFLICT UPDATE clause — background recomputation must not overwrite admin resolution decisions.

---

## 3. Enrichment Field Fallback Chain

Enrichment fields are computed at insight-store time, not at query time. Each field must have an
explicit fallback so that insights always render — degraded is acceptable, broken is not.

**Page title resolution order** (stop at first match):
1. `page_keywords.page_title` — from keyword strategy analysis
2. Webflow page metadata title — from `webflow_pages` table if available
3. Cleaned slug fallback — `/blog/best-ai-coding-agents` → `"Best AI Coding Agents"`

**Enrichment field fallback rules:**
- `pageTitle` — required for display; use cleaned slug if all else fails, never render raw URL
- `strategyKeyword` — optional; `null` if page not in strategy
- `strategyAlignment` — default to `'untracked'` if page not in strategy, never `null` in the feed
- `auditIssues` — optional; omit if no linked issues, do not default to `[]`
- `pipelineStatus` — optional; `null` is acceptable, means no brief/post exists
- `domain` — required; default to `'cross'` if not deterministic from insight type
- `impactScore` — required; default to `0`, never `null` or `undefined`

**If enrichment entirely fails** (e.g. no strategy loaded, DB error): the raw insight must still
be stored and rendered with null enrichment fields. Never block insight storage on enrichment.

---

## 4. Feedback Loop Completeness

Every cross-system write triggered by the insight engine (insights → strategy, insights → pipeline)
requires both halves or neither. A server broadcast without a frontend handler is dead data. A
frontend handler without a server broadcast never fires.

**Required pair for each feedback loop:**
- Server: call `broadcastToWorkspace(workspaceId, { type: 'EVENT_NAME', ... })`
- Frontend: `useWorkspaceEvents` handler that calls `queryClient.invalidateQueries({ queryKey: queryKeys.admin.X(workspaceId) })`

**Existing broadcast events to reuse where applicable:**
- `strategy_updated` → invalidates `queryKeys.admin.keywordStrategy(workspaceId)`
- `brief_created` → invalidates `queryKeys.admin.briefs(workspaceId)`

When adding a new feedback loop event, add it to both the server broadcast call AND the
`useWorkspaceEvents` handler in the relevant frontend component before marking the task done.

---

## 5. Anomaly Deduplication Contract

Anomaly insights use **upsert-not-insert** semantics. Getting this wrong floods the insight feed
with duplicate entries every detection cycle (the job runs every 12h).

**Upsert key:** `(workspaceId, anomaly_type, metric)` — one active entry per combination.

**On detection:**
- If a matching active entry exists → update `data` (current value, duration) and `computedAt`
- If no matching entry exists → insert new entry
- Display as: `"Traffic down 30% — ongoing for 5 days"`, not 10 separate entries

**On resolution:**
- Mark the existing entry resolved (add `resolvedAt` to `data`)
- Next detection cycle creates a fresh entry if the anomaly recurs

Do NOT use `insertOrReplace` or the standard `upsertInsight()` without the deduplication key check.
Write a dedicated `upsertAnomalyDigestInsight()` that enforces the key.

---

## 6. Client vs Admin Insight Framing

Phase 3 adds client-facing insight views. The framing rules are strict:

| Concern | Admin | Client |
|---|---|---|
| Language | Action-oriented, technical | Narrative, outcome-oriented |
| Example | "Dropped to page 2 — position 4→11, lost ~2,400 clicks/mo" | "We detected a ranking change and are working on a recovery plan" |
| Color | Any per Three Laws | No purple. Never. |
| Premium features | Direct | Wrapped in `<TierGate>` |
| Raw metrics | OK | Translate to business impact |

**Enforcement:**
- Client-facing insight components go in `src/components/client/` — never in `src/components/admin/`
- Any component rendering insight data for clients must have `// CLIENT-FACING` comment at top
- Run `grep -r "purple-" src/components/client/` as part of Phase 3 acceptance check

---

## 7. Implementation Process Guardrails (Phase 2 Lessons)

These rules apply to **every task** in Phase 3 implementation. Each one maps to a real bug found in Phase 2.

### 7.1 DB Statement Caching — Use `stmts()`, Never Bare `db.prepare()`

Any function in `analytics-insights-store.ts` or `roi-attribution.ts` that calls `db.prepare()` inline will re-compile the statement on every call. Use the module-level `stmts()` cache pattern instead.

**Pattern:**
```typescript
// ✅ Correct — compiled once
function stmts() {
  return cache ??= {
    selectUnresolved: getDb().prepare(`SELECT * FROM analytics_insights WHERE ...`),
    updateResolution: getDb().prepare(`UPDATE analytics_insights SET ...`),
  };
}

// ❌ Wrong — compiles on every call
export function getUnresolvedInsights(workspaceId: string) {
  const db = getDb();
  return db.prepare(`SELECT * FROM analytics_insights WHERE ...`).all(workspaceId);
}
```

The plan code for `roi-attribution.ts`, `resolveInsight()`, `getUnresolvedInsights()`, and `getInsightById()` uses bare `db.prepare()`. When implementing, move all prepared statements into the `stmts()` cache.

### 7.2 Imports at Top of File Only

When modifying an existing file (e.g. `analytics-insights-store.ts`, `routes/public-analytics.ts`), add **all** new `import` statements at the top of the file alongside existing imports. Never add imports adjacent to the code that uses them — even if the plan shows them that way.

**Verification after each file edit:**
```bash
grep -n "^import" server/the-file-you-edited.ts | tail -20
```
Confirm there are no import blocks after line ~30 (past the header imports section).

### 7.3 Express Route Ordering — Literal Before Param

Any new route with a **literal segment** at the same path level as an existing `/:paramId` route will be unreachable unless registered first.

**Before adding a route, check:**
```bash
grep -n "router\.\(get\|put\|post\|delete\)" server/routes/the-file.ts
```
If an existing `/:workspaceId/:anythingElse` param route is present, your literal route (e.g., `/:workspaceId/narrative`) must appear **before** it in the file.

Phase 3's `/api/public/insights/:workspaceId/narrative` and `/:workspaceId/digest` go into `public-analytics.ts`. Check whether that file has a `/:workspaceId/:tab` style catch-all.

### 7.4 `parseJsonSafe` for All Inline JSON Parsing

Code in `insight-narrative.ts` that calls `JSON.parse(insight.auditIssues)` directly must instead use `parseJsonSafe`/`parseJsonFallback` from `server/db/json-validation.ts`. Bare `JSON.parse` on DB columns can throw if the stored value is malformed.

```typescript
// ✅ Correct
import { parseJsonFallback } from './db/json-validation.js';
const issues = parseJsonFallback<string[]>(insight.auditIssues, []);

// ❌ Wrong
const issues = JSON.parse(insight.auditIssues);
```

### 7.5 Full Test Suite Before Finishing

The quality gate for Phase 3 is `npx vitest run` (full suite, not just the new test files). A passing build does not mean tests pass. Run the full suite and verify zero failures before marking complete.

```bash
npm run typecheck && npx vite build && npx vitest run
```

### 7.6 Subagent Diff Review After Parallel Tasks

After parallel subagents complete Tasks 1–4 (which involve different modules), do a combined diff review before starting Tasks 5+. Check for:
- Duplicate imports in any shared file
- Conflicting additions to `shared/types/analytics.ts` or `src/lib/queryKeys.ts`
- `rowToInsight()` mapping all new resolution fields

---

## Phase Acceptance Checklists

### Phase 1 Gate

Before marking Phase 1 complete, verify ALL of the following:

- [ ] Every new insight type (`ranking_mover`, `ctr_opportunity`, `serp_opportunity`) registered in all 8 locations (Section 1)
- [ ] `strategy_alignment` and `anomaly_digest` have typed interfaces replacing `Record<string,unknown>`
- [ ] `analytics_insights` migration, `InsightRow`, `rowToInsight()`, `upsertInsight()` in sync (Section 2)
- [ ] Every insight in the feed shows a page title, not a raw URL — verify by calling `getInsights(workspaceId)` on a workspace with data and confirming `insight.pageTitle` is non-null and non-URL-shaped on at least one result
- [ ] `computeContentDecayInsights()` removed from `analytics-intelligence.ts`; content-decay.ts delegation is the only path; grep confirms no dead calls
- [ ] `INSIGHT_FILTER_KEYS` constant used for all filter key string literals — no bare string literals like `'drops'` in component files
- [ ] `AnnotatedTrendChart` max-3 active lines enforced — adding a 4th deactivates the oldest
- [ ] `npm run typecheck` — zero errors
- [ ] `npx vite build` — clean

### Phase 2 Gate

Before marking Phase 2 complete, verify ALL of the following:

- [ ] Each feedback loop (insights → strategy, insights → pipeline) calls `broadcastToWorkspace()` with correct event (Section 4)
- [ ] Corresponding `useWorkspaceEvents` handlers invalidate correct React Query keys
- [ ] Anomaly deduplication: inserting the same `(workspaceId, anomaly_type, metric)` twice produces one feed entry, not two — verify with a test or manual check (Section 5)
- [ ] Dedicated `upsertAnomalyDigestInsight()` used for anomaly inserts — standard `upsertInsight()` not used for anomaly type
- [ ] Admin Chat `buildInsightsContext()` includes `pageTitle`, `strategyAlignment`, `pipelineStatus` in its output
- [ ] `npm run typecheck` — zero errors
- [ ] `npx vite build` — clean

### Phase 3 Gate

Before marking Phase 3 complete, verify ALL of the following:

**Client Framing:**
- [ ] No admin-framed insight text in any component under `src/components/client/` — no position numbers, no CTR%, no jargon
- [ ] `grep -r "purple-" src/components/client/` — zero matches
- [ ] `strategy_alignment` and `keyword_cluster` insight types are excluded from `buildClientInsights()` — verify with grep or unit test
- [ ] All client components have `// CLIENT-FACING` comment at top of file
- [ ] All premium client insight features wrapped in `<TierGate tier="growth">` (or higher)

**ROI Attribution:**
- [ ] Migration 040 is applied — `roi_attributions` table exists (`SELECT name FROM sqlite_master WHERE type='table' AND name='roi_attributions'`)
- [ ] `recordOptimization()` inserts a row with `clicks_before`, `impressions_before`, `position_before` populated from actual GSC data (not zeros)
- [ ] `measureOutcome()` updates the row after `measurement_window_days` (default 14)
- [ ] `getROIHighlights()` returns typed `ROIHighlight[]` — not `any[]` — with `pageTitle`, `action`, `result`, `clicksGained`
- [ ] At minimum, `brief_published` action type is wired to `recordOptimization()` in the content publish path

**Monthly Digest:**
- [ ] `generateMonthlyDigest()` returns all required sections: `summary`, `wins`, `issuesAddressed`, `metrics`, `roiHighlights`
- [ ] `summary` field is non-empty — either AI-generated or deterministic fallback (never empty string)
- [ ] `GET /api/public/insights/:workspaceId/digest` responds 200 with valid `MonthlyDigestData` shape (test with `curl` or Vitest integration test)
- [ ] `MonthlyDigest` client component renders without crashing when `roiHighlights` is empty array

**Admin Action Queue:**
- [ ] `resolveInsight()` updates `resolution_status` in `analytics_insights` — confirm with a DB query after calling it
- [ ] `getUnresolvedInsights()` excludes resolved items — confirm it doesn't return rows where `resolution_status = 'resolved'`
- [ ] `PUT /api/admin/insights/:insightId/resolve` broadcasts `insight_resolved` event via `broadcastToWorkspace`
- [ ] Frontend `useWorkspaceEvents` handler for `insight_resolved` invalidates `actionQueue` React Query key

**Process Guardrails:**
- [ ] All new DB statements in `roi-attribution.ts` and `analytics-insights-store.ts` use `stmts()` cache, not bare `db.prepare()` (Section 7.1)
- [ ] No imports added mid-file in any modified route file (Section 7.2)
- [ ] `/narrative` and `/digest` routes in `public-analytics.ts` registered before any `/:workspaceId/:param` catch-all (Section 7.3)
- [ ] `parseJsonSafe`/`parseJsonFallback` used wherever `insight.auditIssues` or other JSON columns are parsed (Section 7.4)
- [ ] `npx vitest run` — zero failures (full suite, not just new tests — Section 7.5)
- [ ] `npm run typecheck` — zero errors
- [ ] `npx vite build` — clean

---

## 8. Phase Authoring Conventions (Tier 2 Lessons)

These rules apply when adding a new computation phase to `runIntelligenceCycle()` in
`server/analytics-intelligence.ts`. Each maps to a real bug found in the Tier 2 scaled review.

### 8.1 `pageId` Cardinality — Never `null` for Multi-Row Types

Before choosing `pageId`, answer: **how many rows does this phase generate per workspace per cycle?**

| Cardinality | Correct `pageId` | Wrong |
|---|---|---|
| Exactly one row per workspace | `null` (e.g. `anomaly_digest`) | |
| One row per page/path | `p.pagePath` (e.g. `freshness_alert`) | `null` |
| One row per keyword | `` `keyword_type::${kw.keyword}` `` (e.g. `emerging_keyword`) | `null` |
| One row per domain+keyword | `` `alert_type::${domain}::${kw ?? 'domain'}` `` (e.g. `competitor_alert`) | `null` |

**Why it matters:** the `analytics_insights` table has a UNIQUE constraint on
`(workspace_id, COALESCE(page_id, '__workspace__'), insight_type)`. Passing `null` for
a multi-row type silently collapses all rows to one — only the last upsert survives.
This produces no TypeScript error and no runtime exception. The feed looks empty.

### 8.2 Stale Cleanup Placement — Unconditional, Outside Try

Every phase must prune rows from previous cycles using `deleteStaleInsightsByType()`.
The placement must be:

```typescript
// ✅ Correct: outside the if-guard AND outside the try block
if (ws.liveDomain) {
  try {
    // ... generate insights
  } catch (err) {
    log.warn({ err, workspaceId }, '...');
  }
}
deleteStaleInsightsByType(workspaceId, 'your_type', cycleStart); // ← here

// ✅ Also correct: unconditional block, delete after catch
{
  try {
    // ... generate insights
  } catch (err) {
    log.warn({ err, workspaceId }, '...');
  }
  deleteStaleInsightsByType(workspaceId, 'your_type', cycleStart); // ← here, after catch
}

// ❌ Wrong: inside the if-guard (missed when liveDomain is cleared)
if (ws.liveDomain) {
  try { ... } catch { ... }
  deleteStaleInsightsByType(...); // inside if — skipped when liveDomain removed
}

// ❌ Wrong: inside the try block (missed when listX() throws)
try {
  const pageKws = listPageKeywords(workspaceId);
  // ... generate
  deleteStaleInsightsByType(...); // inside try — skipped on any error above
} catch { ... }
```

**Why it matters:** if a workspace previously had `liveDomain` set (or the provider configured)
and generated insights, then the condition is later cleared, the cleanup is skipped every cycle
and orphaned insights remain in the client feed indefinitely.

### 8.3 Phase Numbering — Append New Phases at the End

New phases must be appended after the last existing phase, not inserted between existing numbered
phases. Out-of-sequence numbering (e.g. 3B → 5 → 6 → 3C → 4) makes the file hard to navigate
and signals the phase was added hastily. Renumber all phases in the same commit if needed.

### 8.4 JSDoc on Insight Data Fields — No "Percentage" Annotation on Raw Counts

When documenting fields in `XData` interfaces in `shared/types/analytics.ts`, only apply the
`/** Already a percentage (e.g., 6.3 for 6.3%). Do NOT multiply by 100. */` annotation to fields
that are actually stored as percentages (e.g., CTR, change percent). Fields like `impressions`,
`clicks`, `volume`, and `position` are raw counts/integers — annotating them as percentages
causes future consumers to incorrectly divide by 100. If in doubt, add a `// units: raw count`
or `// units: integer position` inline comment instead.
