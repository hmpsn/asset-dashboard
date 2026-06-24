I'll synthesize the audit from the 6 surface scans. The scans are comprehensive and consistent; I have everything needed to produce the structured Markdown directly.

# Pre-Plan Audit — SEO Decision Engine P6: National Advanced-SERP Rank + AI-Overview Citation

**Phase class:** First PAID Group C phase. Flag `national-serp-tracking`. Depends on P4 (geo-targeting) + P5 (credit-budget-gate). **Dark risk: HIGHEST** — AI-Overview citation is a net-new sales concept with zero UI surface today.

Working dir: `/Users/joshuahampson/CascadeProjects/asset-dashboard-seo-audit`

---

## 1. Surface Inventory

### Provider layer (DataForSEO advanced-SERP)
- **Only existing SERP method:** `getLocalVisibility()` at `server/providers/dataforseo-provider.ts:1224` — calls `serp/google/organic/live/advanced` (request body `:1271-1276`) but parses **only** `local_pack` items via `extractLocalPackItems()` (`:719-741`).
- `serp_item_types` array is read as **string labels only** (`:620-621`), concatenated into `serpFeatures`. **No nested extraction** of `featured_snippet.text`, `people_also_ask[].question/answer`, or `ai_overview.references/owner`.
- `ranked_keywords` shows the organic-parse model: `rank_group` (`:1340`), `url`+`etv` (`:1356-1357`).
- Reusable infra: `runDataForSeoOperation()` wrapper (`:497-550`), `readCache`/`writeCache` (`:211-227`), `logCreditUsage` (`:152-157`), `CreditEntry` schema (`:126-134`), `CACHE_TTL_LOCAL_VISIBILITY=168h` (`:197`).
- `SeoDataProvider` interface (`server/seo-data-provider.ts:102-148`) defines **only** `getLocalVisibility` — **no national SERP method**.
- `seo-provider-signals.ts:58-61` — `aiOverview` detection is a string-presence check only; no `answer_text`/`references[]` parse.
- `historical_serps` / `historical_rank_overview` are **zero-referenced** in the codebase (backfill needs net-new integration).

### Storage / rank-data layer
- Position today is **GSC average position**, not true SERP rank. `rank_snapshots` table (`server/db/migrations/003-per-workspace.sql:198-206`): `(workspace_id, date, queries JSON)` with `{query, position, clicks, impressions, ctr}`.
- `tracked_keywords` row table (migration `118-tracked-keywords.sql:19-48`), PK `(workspace_id, normalized_query)`, dual-written with the config blob. Mapper in `server/tracked-keywords-store.ts` (`rowToTrackedKeyword` `:96-123`, `replaceAllTrackedKeywordRows` `:206-251`).
- Read/write path: `storeRankSnapshot`/`readSnapshots`/`buildLatestRanks` (`server/rank-tracking.ts`), surfaced via `KeywordCommandCenterMetrics.currentPosition` (`server/keyword-command-center.ts:1230-1313`).
- **No per-keyword SERP-detail table** (matched URL, features) exists.

### Job layer
- Authoritative template: `runLocalSeoRefreshJob` (`server/local-seo.ts:2775-3030`). Pattern: global serialization via `hasActiveJob` (no workspaceId, one refresh platform-wide — 512MB Render constraint), concurrency=1, `waitForMemoryHeadroom()` before each ~20-30MB SERP allocation (`:114-162`), per-item progress, broadcast every 20 items, pre/post cancellation checks, fire-and-forget chained jobs.
- Route pattern: `server/routes/local-seo.ts:220-259` (`hasActiveJob` workspace+global → `createJob` → `registerAbort` → fire-and-forget).
- Jobs API: `createJob` (`server/jobs.ts:219`), `updateJob` (`:247`), cancellation (`:310-352`), `hasActiveJob` (`:354-370`).
- Budget gate (P5): `assertCreditBudget` (`server/credit-budget-gate.ts:153`), `evaluateCreditBudget` (`:127`), `budgetEnforcementEnabled=false` observe-only (`:28`).
- UI: `useBackgroundTasks.tsx:126-129` (JOB_UPDATED listener) → `NotificationBell.tsx:36-100` (progress bar + cancel).

### Insight layer
- Reference type `ranking_mover`: union `shared/types/analytics.ts:198`, `RankingMoverData` `:320-330`, map entry `:544`, Zod `server/schemas/insight-schemas.ts:138-148`+`:265`, admin renderer `src/hooks/admin/useInsightFeed.ts:75-97`, client icon/action `src/components/client/InsightsDigest.tsx:388/425`, `classifyDomain` `server/insight-enrichment.ts:78-102`, compute `server/analytics-intelligence.ts:676-719`, orchestration+stale-cleanup `:1376-1390`.

### UI layer — DARK surfaces (zero today)
- **Primary dark risk:** `KeywordDetailDrawer.tsx` shows `currentPosition` as a single decimal `#4.2` (`:462-464`). National-rank section (`:455-504`) renders sparkline/clicks/impressions but **no matched URL, no rank-source, no SERP features, no AI-Overview indicator**.
- `serpBadges()` helper exists at `src/components/shared/ContentGapRow.tsx:226-250` (supports `ai_overview` key, 3 label sets) but is mounted **only** in ContentGapRow (`:387`) — never in the keyword drawer.
- `KeywordCommandCenterMetrics` (`shared/types/keyword-command-center.ts:111-125`) lacks `rankSource`, `aiOverviewCited`, `serpFeatures`, `matchedUrl`.
- Zero grep hits for `aiOverviewCited`/`citati` in `src/`.
- Public portal serialization `server/routes/public-portal.ts:60-91` — no allow-list entry for the new fields.

---

## 2. Data Model Decision

**Decision: NEW `serp_snapshots` table** (parallel to `rank_snapshots`), **NOT** extending `tracked_keywords`.

**Rationale:** `tracked_keywords` is keyword *metadata* (one row per keyword); SERP rank is *time-series* (one row per keyword per date). Extending `tracked_keywords` would conflate the two and break the delete-then-reinsert `replaceAllTrackedKeywordRows` pattern. A parallel table keeps `rank_snapshots` (GSC) stable while adding true-SERP detail, and keeps the mapper lockstep clean.

### Migration 153 — `153-serp-snapshots.sql`
```sql
CREATE TABLE IF NOT EXISTS serp_snapshots (
  workspace_id    TEXT NOT NULL,
  date            TEXT NOT NULL,
  query           TEXT NOT NULL,          -- normalized via keywordComparisonKey
  position        INTEGER NOT NULL,       -- true SERP rank (1-based)
  matched_url     TEXT,                   -- destination URL from SERP organic result
  features        TEXT DEFAULT '[]',      -- JSON string[] of SERP feature labels
  ai_overview_cited   INTEGER,            -- tri-state NULL/0/1 (owner-domain in ai_overview.references)
  ai_overview_present INTEGER,            -- tri-state NULL/0/1 (ai_overview block on SERP at all)
  PRIMARY KEY (workspace_id, date, query),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_serp_snapshots_query ON serp_snapshots(workspace_id, query);
```
> Note: the scan's draft schema duplicated `clicks/impressions/ctr` from `rank_snapshots`. **Omit those** — they live in `rank_snapshots` (GSC source) and duplicating them violates the rate-display single-source rule. `serp_snapshots` stores only true-SERP-sourced data. Join on `(workspace_id, date, query)` at read time.

### DB-column + mapper + public-serialization lockstep checklist
- [ ] Migration `153-serp-snapshots.sql` (schema above) — next after `152-workspace-target-geo.sql`.
- [ ] `SerpSnapshotRow` interface + `SerpSnapshot` in-memory type in new `server/serp-snapshots-store.ts`.
- [ ] `rowToSerpSnapshot()` mapper — `NULL → undefined`; `features` via `parseJsonSafeArray(row.features, z.string(), { workspaceId, table: 'serp_snapshots' })`; `ai_overview_cited`/`ai_overview_present` as tri-state `0/1/NULL` → `boolean | undefined`.
- [ ] Write: `storeSerpSnapshots(workspaceId, date, snapshots[])` — upsert per `(workspace_id, date, query)` inside `db.transaction()`.
- [ ] Read: `getLatestSerpSnapshots(workspaceId)` / `getSerpSnapshotsByQuery(workspaceId, query)` mirroring `readSnapshots`.
- [ ] Extend `KeywordCommandCenterMetrics` (`shared/types/keyword-command-center.ts:111-125`): `rankSource?`, `matchedUrl?`, `serpFeatures?`, `aiOverviewCited?`, `aiOverviewPresent?`.
- [ ] Merge into metrics in `keyword-command-center.ts:1230-1313` (alongside `currentPosition`).
- [ ] **Public portal allow-list** (`public-portal.ts:60-91`): add `rankSource, aiOverviewCited, matchedUrl, serpFeatures`; explicitly **strip** admin-only provenance. Integration test must exercise `GET /api/public/...`, not the admin GET.
- [ ] `keywordComparisonKey` normalization applied to `serp_snapshots.query` PK so it joins to `rank_snapshots`/`tracked_keywords`.

---

## 3. Insight 7-Part Lockstep (`serp_feature_opportunity`, mirror `ranking_mover`)

| # | Part | File:line | Reference (`ranking_mover`) |
|---|------|-----------|------------------------------|
| 1 | `InsightType` union | `shared/types/analytics.ts` — add after `:200` (`serp_opportunity`) | `:198` |
| 2 | `SerpFeatureOpportunityData` interface + `InsightDataMap` entry | `shared/types/analytics.ts` — interface after `:353`; map entry after `:546` | iface `:320-330`, map `:544` |
| 3 | Zod schema + `INSIGHT_DATA_SCHEMA_MAP` | `server/schemas/insight-schemas.ts` — schema after `:170`; map entry after `:267` | `:138-148` / `:265` |
| 4 | Admin renderer case + client icon/action | `src/hooks/admin/useInsightFeed.ts` case after `:178`; `src/components/client/InsightsDigest.tsx` icon `:388`, action `:425` | renderer `:75-97`, icon/action `:376-436` |
| 5 | `classifyDomain` → `searchTypes` | `server/insight-enrichment.ts:83` (add to array) | `:78-102` |
| 6 | `computeSerpFeatureOpportunities()` + orchestration + `deleteStaleInsightsByType` | `server/analytics-intelligence.ts` — fn after `:719`; orchestration after the `serp_opportunity` call (~`:1430`) | compute `:676-719`, orchestration `:1376-1390` |
| 7 | (Optional) `INSIGHT_FILTER_KEYS.FEATURES` pill + summary count | `shared/types/analytics.ts:563-571`; `src/components/insights/InsightFeed.tsx`; `useInsightFeed.ts:459-485` | filter keys `:563-571` |

**Interface field reconciliation (the two scans diverged — pick ONE):**
Scan-4 proposed page-centric fields (`pageUrl, featureType, eligibleQueries[], estimatedClickGain, schemaRecommendation`); Scan-6 proposed keyword-centric (`keyword, currentPosition, hasAiOverview, hasLocalPack, estimatedMonthlyCitations`). **Recommendation: keyword-centric**, because P6's data source is per-tracked-keyword SERP snapshots, and `pageId` cardinality should be the matched page URL (one row per page per §8.1 of `analytics-insights.md`). Final shape:
```typescript
export interface SerpFeatureOpportunityData extends InsightDataBase {
  keyword: string;
  matchedUrl: string;            // becomes pageId
  currentPosition: number;
  presentFeatures: string[];     // ['featured_snippet','people_also_ask','ai_overview',...]
  aiOverviewPresent: boolean;
  aiOverviewCited: boolean;      // owner domain in ai_overview.references
  estimatedMonthlyCitations: number;
}
```

**Lockstep traps (must ship together):** missing `InsightDataMap` entry → TS discriminated-union failure; missing Zod schema → silent `parseJsonSafe` fallback at read; missing `classifyDomain` → defaults to `'cross'`; stale-cleanup inside a data guard → orphaned insights when provider disconnected; `pageId=null` on a multi-row type → UNIQUE-constraint collapse. Verify: `grep -rn "serp_feature_opportunity" shared/ server/ src/ | wc -l` (expect hits in all 8 docs/rules locations).

---

## 4. Implementation Units (bounded tasks, dependencies, file ownership)

| Unit | Task | Owns (exclusive) | Depends on |
|------|------|------------------|------------|
| **U0** Contracts (pre-commit) | New types: `NationalSerpResult` (provider return), `SerpSnapshotRow`/`SerpSnapshot`, `KeywordCommandCenterMetrics` extension, `SerpFeatureOpportunityData`+union+map. Flag catalog entry. Migration 153 file. | `shared/types/keyword-command-center.ts`, `shared/types/analytics.ts` (additive), `shared/types/feature-flags.ts`, `server/db/migrations/153-*.sql` | — (lands first, single commit) |
| **U1** Provider method | `getNationalSerp(keyword, {locationCode?, device?})` on `SeoDataProvider` + `DataForSeoProvider`. Parse organic owners (`rank_group`/`url`), `featured_snippet`, `people_also_ask`, `ai_overview` (+`references`/`owner`). Reuse `runDataForSeoOperation`, `readCache`/`writeCache` (168h TTL), `logCreditUsage`. **Add `getNationalSerp` no-op/throw to any Fake/stub provider impls.** | `server/providers/dataforseo-provider.ts`, `server/seo-data-provider.ts` | U0 |
| **U2** Storage | `server/serp-snapshots-store.ts`: row+mapper, `storeSerpSnapshots`, `getLatestSerpSnapshots`, `getSerpSnapshotsByQuery`. | new `server/serp-snapshots-store.ts` | U0, migration 153 |
| **U3** Job + route | `national_serp_refresh` in `BACKGROUND_JOB_TYPES`+metadata. `runNationalSerpRefreshJob` (port from `runLocalSeoRefreshJob`: concurrency=1, `waitForMemoryHeadroom`, progress/20, cancel checks). `POST /api/rank-tracking/:workspaceId/refresh-national` with `hasActiveJob` workspace+global. `assertCreditBudget` at **route entry** AND per-keyword. | `shared/types/background-jobs.ts`, new job fn in `server/national-serp.ts` (or `rank-tracking.ts`), `server/routes/rank-tracking.ts` | U1, U2 |
| **U4** Insight | `computeSerpFeatureOpportunities()` reading `serp_snapshots`; 7-part lockstep parts 5+6; broadcast + `deleteStaleInsightsByType`. | `server/analytics-intelligence.ts`, `server/insight-enrichment.ts` (+ parts 1-3 in `analytics.ts`/`insight-schemas.ts` if not in U0) | U0, U2 |
| **U5** Insight renderers | Part 4 admin case + client icon/action; optional part 7 pill. | `src/hooks/admin/useInsightFeed.ts`, `src/components/client/InsightsDigest.tsx` | U0 (types) |
| **U6** Drawer UI | Rank-source badge, matched-URL line, SERP-feature badges (import `serpBadges`), AI-Overview citation badge (emerald/zinc, **never purple**). Thread fields through props. | `src/components/keyword-command-center/KeywordDetailDrawer.tsx` | U0 (metrics type) |
| **U7** Public serialization | Allow-list `rankSource, aiOverviewCited, matchedUrl, serpFeatures` in `public-portal.ts`; strip admin-only. | `server/routes/public-portal.ts` | U0 |
| **U8** Flag + tests | Flag catalog/group lockstep + lifecycle anchor test; unit (`runNationalSerpRefreshJob`, FM-2 fetch-error, budget would-block), integration (route + budget OFF/ON + **public** read path), contract (`insight-renderer-coverage`). | `tests/unit/national-serp-tracking.test.ts`, `tests/integration/national-serp-routes.test.ts`, augment `tests/contract/insight-renderer-coverage.test.ts`, `tests/unit/feature-flag-lifecycle.test.ts` | all above |

---

## 5. Cost Model + Budget Decision

**Endpoint cost:** `serp/google/organic/live/advanced` = **$0.002–0.003/call**, one call per (keyword, location, device).

| Scenario | Calls/mo | Cost/mo |
|----------|----------|---------|
| 25 kw × monthly | 25 | $0.05–0.08 |
| 100 kw × weekly | ~400 | $0.80–1.20 |
| 200 kw × weekly | ~800 | $1.60–2.40 |

Growth budget = 2,000 credits ≈ 666K calls at $0.003 — **enormous headroom**. Realistic usage uses <0.2% of budget.

**Budget enforcement decision: STAY observe-only** (`budgetEnforcementEnabled=false`) at P6 launch.
- Cost-per-call is trivial and growth headroom is vast; premature enforcement risks false-blocking high-value keyword sets and — critically — flipping the flag retroactively blocks **every** workspace that already consumed credits via P5 local-seo refreshes.
- `assertCreditBudget` must still be **wired** (logs would-block) so the enforcement flip is a one-line change later.
- Cached reads are 0-cost (`credit-budget-gate.ts:94`) — a budget-exhausted workspace can still **read** stale snapshots; the contract must distinguish "can't refresh" from "can't read."
- **Tier access:** Free = **NO** (0 budget, hard-block when enforcement eventually on). Growth = YES. Premium = YES. Gate the refresh route + UI button behind Growth+ and `<TierGate>`.

**Enforcement trigger (post-launch):** enable per-workspace if any workspace exceeds ~80% of growth budget monthly.

---

## 6. Flag + CI Traps

**Flag:** `national-serp-tracking` joins the existing **`SEO Decision Engine`** group (created in P4 with `geo-targeting`) — **do not create a new group**. Roadmap item `seo-engine-p6-national-serp-rank-ai-overview` gates it as Group C.

Catalog entry (`shared/types/feature-flags.ts`, after `geo-targeting` `:578-582`):
```typescript
'national-serp-tracking': {
  label: 'National SERP rank tracking — keyword position + SERP features in target market',
  group: 'SEO Decision Engine',
  lifecycle: {
    owner: 'analytics-intelligence',
    createdAt: '<commit date>',          // must equal today on commit day
    rolloutTarget: 'staging-validation',
    removalCondition: 'Promote to default once national SERP snapshots + serp_feature_opportunity insights validated on staging and cost acceptable.',
    linkedRoadmapItemId: 'seo-engine-p6-national-serp-rank-ai-overview',
    staleAuditCadence: 'weekly',
    lastReviewedAt: '<commit date>',
  },
},
```

**CI gotchas:**
1. **Group lockstep** — `assertFeatureFlagGroupingConsistency()` (`feature-flags.ts:634-660`) runs at import; the flag must appear in **both** `FEATURE_FLAG_GROUPS['SEO Decision Engine']` and `FEATURE_FLAG_CATALOG` or import-time fails.
2. **Lifecycle anchor test** — add an explicit `it(...)` in `tests/unit/feature-flag-lifecycle.test.ts` asserting group + `createdAt` + `linkedRoadmapItemId`; set the test's as-of date **explicitly** so it doesn't drift.
3. **Insight contract test** — `tests/contract/insight-renderer-coverage.test.ts:75-110` fails unless `serp_feature_opportunity` has admin case + `INSIGHT_TYPE_ICONS` + `INSIGHT_TYPE_ACTIONS` entries.
4. **Component-test `useFeatureFlag` mock** — any KeywordDetailDrawer / InsightsDigest component test that newly reads `national-serp-tracking` must mock the flag (default OFF) so flag-OFF = no-fetch behavior is the test default.
5. **`createdAt`/`lastReviewedAt` = commit day** or the lifecycle test drifts.

---

## 7. Dark-Output Checks (each gets a surface or conscious defer)

| Dark output | Surface decision | Where |
|-------------|------------------|-------|
| **AI-Overview citation indicator** (zero today, HIGHEST risk) | **MUST SHIP.** Per-keyword emerald (cited) / zinc (not cited) badge in drawer. **Never purple** (client-facing Four Laws). | `KeywordDetailDrawer.tsx:454-456` |
| **Rank-source distinction** (`Live SERP #3` vs `GSC avg #4.2`) | **MUST SHIP.** Badge under position; `rankSource: 'live_serp' \| 'gsc_average' \| 'tracking_baseline'`. Same number, 3 trust levels — invisible today. | `KeywordDetailDrawer.tsx:462-464` |
| **Matched URL** | **MUST SHIP.** Line in National-rank section, mirror local-seo market display. | `KeywordDetailDrawer.tsx:455-504` (after ~`:475`) |
| **serpBadges mounting** | **MUST SHIP.** Import existing `serpBadges()` from ContentGapRow, render `'plain'` set; maps `ai_overview → 'AI Overview'`. | `KeywordDetailDrawer.tsx` ← `ContentGapRow.tsx:226-250` |
| **Public serialization of new fields** | **MUST SHIP** (or client portal silently omits). Allow-list in public-portal; integration test on public endpoint. | `public-portal.ts:60-91` |
| **Workspace-level "AI Citations: X" KPI rollup** | **DEFER to P7** (Stage-4 in scan). Per-keyword badge is sufficient for P6 acceptance. | — |
| **`serp_feature_gained`/`_lost` insight types** | **DEFER to P7.** P6 ships only `serp_feature_opportunity`. | — |

**Four Laws guard:** `grep "purple-\|violet-\|indigo-" src/components/keyword-command-center/KeywordDetailDrawer.tsx` must be empty post-change. AI-citation badge = emerald (success) / zinc (neutral); rank-source + features = blue (data).

---

## 8. OWNER DECISIONS (highest leverage — needed before plan)

1. **Refresh cadence** — Weekly / biweekly / manual-only?
   **Recommend: Weekly default, with per-workspace override in settings.** (Cost is trivial; weekly keeps national ranks fresh enough for non-local keywords.)
2. **Tracked keywords per workspace per refresh** — Fixed 25–100, or per-workspace cap?
   **Recommend: Mirror local-seo — default 100, min 25, max 300 cap.**
3. **Budget enforcement: flip to enforce, or stay observe-only?**
   **Recommend: Stay observe-only at launch.** Wire `assertCreditBudget` (logs would-block), monitor growth-tier usage on staging 1–2 weeks. Flipping now retroactively blocks every workspace already using P5 local-seo.
4. **Which tiers get national tracking?**
   **Recommend: Growth + Premium only; Free excluded** (0 budget). Gate route + UI behind `<TierGate>`.
5. **Backfill depth** — Use `historical_serps`/`historical_rank_overview` (both zero-referenced, net-new integration), or start snapshots fresh?
   **Recommend: Start fresh (no backfill) for P6.** Historical endpoints are unvalidated, add a whole new integration surface, and aren't required by the acceptance criteria. Defer backfill to a follow-up if clients ask for trend history.

*Secondary:* **When does `serp_feature_opportunity` fire?** Recommend: only when ≥1 SERP feature is detected AND a rank snapshot exists (avoid noise, mirrors P5 local-visibility pattern).

---

## 9. Parallelization

**Wave 0 — Contracts (sequential, single commit, blocks everything):** U0 — all shared types, flag catalog entry, migration 153 file. *Must land and be committed before any parallel dispatch (pre-commit shared contracts rule).*

**Wave 1 — Backend fan-out (3 parallel, exclusive ownership):**
- U1 Provider (`dataforseo-provider.ts`, `seo-data-provider.ts`) — **also requires validating real DataForSEO response schema for `ai_overview.references`/`owner` before coding** (the single biggest unknown).
- U2 Storage (`serp-snapshots-store.ts`) — independent of U1.
- U7 Public serialization (`public-portal.ts`) — independent.

**Wave 2 — Integration (sequential where dependent):**
- U3 Job + route (needs U1 + U2).
- U4 Insight compute (needs U2; lockstep parts 5/6).

**Wave 3 — Frontend fan-out (2 parallel):**
- U5 Insight renderers (`useInsightFeed.ts`, `InsightsDigest.tsx`).
- U6 Drawer UI (`KeywordDetailDrawer.tsx`).

**Wave 4 — Tests + flag verification:** U8 (after all code lands) — unit/integration/contract + flag lifecycle anchor. Then full gate: `npm run typecheck && npx vite build && npx vitest run && npx tsx scripts/pr-check.ts && npm run verify:feature-flags`.

**Hard sequencing:** U0 → everything. U1+U2 → U3. U2 → U4. U0 → U5/U6 (types only). **Diff-review checkpoint after Wave 1 and Wave 3** (grep duplicates, tsc, full suite) per multi-agent coordination rules.

**Critical path:** U0 → U1 (DataForSEO schema validation is the gating unknown) → U3 → U8.

---

**Single biggest pre-implementation risk:** the nested DataForSEO `serp/google/organic/live/advanced` response shape for `featured_snippet`, `people_also_ask`, and especially `ai_overview.references`/`owner` is **unparsed and unvalidated** today — only string labels are read. Validate against a real/representative response (build a fixture) **before** U1 coding, or the entire AI-Overview citation feature ships on guessed field names.