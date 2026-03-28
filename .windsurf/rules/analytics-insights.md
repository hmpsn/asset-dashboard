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
- [ ] Add Zod schema `xDataSchema` in `server/schemas/content-schemas.ts` (or a new
  `server/schemas/insight-schemas.ts`) matching the interface field-for-field
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
- Frontend: `useWebSocket` handler that calls `queryClient.invalidateQueries(['relevant-key'])`

**Existing broadcast events to reuse where applicable:**
- `strategy_updated` → invalidates `['admin-keyword-strategy', workspaceId]`
- `brief_created` → invalidates `['admin-briefs', workspaceId]`

When adding a new feedback loop event, add it to both the server broadcast call AND the
`useWebSocket` handler in the relevant frontend component before marking the task done.

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
- [ ] `npx tsc --noEmit --skipLibCheck` — zero errors
- [ ] `npx vite build` — clean

### Phase 2 Gate

Before marking Phase 2 complete, verify ALL of the following:

- [ ] Each feedback loop (insights → strategy, insights → pipeline) calls `broadcastToWorkspace()` with correct event (Section 4)
- [ ] Corresponding `useWebSocket` handlers invalidate correct React Query keys
- [ ] Anomaly deduplication: inserting the same `(workspaceId, anomaly_type, metric)` twice produces one feed entry, not two — verify with a test or manual check (Section 5)
- [ ] Dedicated `upsertAnomalyDigestInsight()` used for anomaly inserts — standard `upsertInsight()` not used for anomaly type
- [ ] Admin Chat `buildInsightsContext()` includes `pageTitle`, `strategyAlignment`, `pipelineStatus` in its output
- [ ] `npx tsc --noEmit --skipLibCheck` — zero errors
- [ ] `npx vite build` — clean

### Phase 3 Gate

Before marking Phase 3 complete, verify ALL of the following:

- [ ] No admin-framed insight text in any component under `src/components/client/`
- [ ] `grep -r "purple-" src/components/client/` returns zero matches
- [ ] All premium insight features wrapped in `<TierGate>`
- [ ] ROI attribution: at least one content pipeline action links to a subsequent metric change — verify the data model supports the linkage
- [ ] Monthly digest generation tested end-to-end (trigger → generate → verify output structure)
- [ ] `npx tsc --noEmit --skipLibCheck` — zero errors
- [ ] `npx vite build` — clean
