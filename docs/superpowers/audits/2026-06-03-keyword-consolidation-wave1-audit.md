# Keyword Surface Consolidation — Wave 1 Pre-Plan Audit
**Date:** 2026-06-03 · **Spec:** docs/plans/2026-06-03-keyword-surface-consolidation-plan.md · **Scope:** Wave 1 (flag-agnostic stability quick wins)
**Total findings:** 58 across 34 files.

## Findings by item

### #1 — `tracked_keywords` read-modify-write lost-update race (TXN_WRAP)
The `tracked_keywords` JSON blob is mutated by a `readConfig()` (SELECT) → mutate-in-JS → `writeConfig()` (single full-blob UPSERT) sequence in every public mutator. The write alone is atomic; the **race is the read→mutate→write spread across two separate statements**. Two concurrent writers read the same blob and last-write-wins, silently dropping a keyword. Fix = wrap each mutator's read+write together in `db.transaction(updater).immediate()`, **nesting-safe** (better-sqlite3 throws on nested transactions, and two writers run inside the KCC outer transaction). Every writer below must be covered — a missed writer means the race survives on that path.

| File:line | What | Fix type | Status |
|---|---|---|---|
| server/rank-tracking.ts:147-165 | `readConfig()` (getConfig.get SELECT) + `writeConfig()` (upsertConfig.run full-blob UPSERT) — the two separate statements that constitute the RMW primitive | TXN_WRAP | unguarded — read & write are separate prepared statements, no enclosing txn |
| server/rank-tracking.ts:187-195 | `updateTrackedKeywords(wsId, updater)` — THE central RMW funnel (reconcile, upsertByKey, retire all route through it). No `.transaction/.immediate` | TXN_WRAP | unguarded |
| server/rank-tracking.ts:251-262 | `addTrackedKeyword()` — read L259 → addToConfig → write L260 | TXN_WRAP | unguarded |
| server/rank-tracking.ts:264-275 | `addTrackedKeywords()` (batch) — read L268 → loop → write L273. Called inside keyword-feedback's own `db.transaction` → nesting hazard | TXN_WRAP | unguarded |
| server/rank-tracking.ts:277-283 | `removeTrackedKeyword()` — read L279 → filter → write L281 | TXN_WRAP | unguarded |
| server/rank-tracking.ts:285-292 | `togglePinKeyword()` — read L287 → flip pinned → write L290 | TXN_WRAP | unguarded |
| server/keyword-command-center.ts:2213-2270 | `upsertTrackedKeywordByKey()` → delegates to `updateTrackedKeywords` (L2222). **Runs inside KCC outer `db.transaction()` (L2327, calls at L2331/2341/2372)** | TXN_WRAP | unguarded-but-nested-in-outer-txn |
| server/keyword-command-center.ts:2272-2283 | `retireTrackedKeyword()` → delegates to `updateTrackedKeywords` (L2275). Called L2353/2359/2366 inside same outer txn | TXN_WRAP | unguarded-but-nested-in-outer-txn |
| server/rank-tracking-reconciliation.ts:138-159 | `reconcileStrategyRankTracking()` — full-array rebuild via `updateTrackedKeywords` (L159). Highest-stakes RMW (rewrites every row per strategy gen) | TXN_WRAP | unguarded |
| server/keyword-strategy-follow-ons.ts:35-39 | `seedKeywordStrategyTrackedKeywords()` → calls reconcile (L39). The generation entry point; strategy-regen racing a manual add | TXN_WRAP | unguarded (invokes the reconcile RMW) |
| server/keyword-strategy-generation.ts:520 | **SECOND seed/reconcile entry point** — task named only :328; both generation branches reach the reconcile RMW | TXN_WRAP | unguarded (additional entry point beyond originally-named set) |
| server/keyword-feedback.ts:166-172 | `saveKeywordFeedback()` (singular) — feedback upsert (L166) + `addTrackedKeyword()` (L169) when approved, **two writes with no shared txn** | TXN_WRAP | unguarded |
| server/keyword-feedback.ts:190-217 | `saveBulkKeywordFeedback()` wraps writes in `db.transaction()` (L196) — but **deferred, NOT `.immediate()`**; inner read→write = SQLITE_BUSY_SNAPSHOT risk (PR #1030) | TXN_WRAP | guarded by `db.transaction()` but not `.immediate()` (busy-snapshot risk) |
| server/routes/public-content.ts:643-675 | POST `/api/public/tracked-keywords/:wsId` — route TOCTOU: read L650 → alreadyTracked check → `addTrackedKeyword` L652. Public/unauth = highest concurrency exposure | TXN_WRAP | unguarded (underlying `addTrackedKeyword`) |
| server/routes/public-content.ts:677-690 | DELETE `/api/public/tracked-keywords/:wsId` — read L682 → `removeTrackedKeyword` L684 | TXN_WRAP | unguarded |
| server/routes/rank-tracking.ts:50-86 | Admin routes: POST→`addTrackedKeyword` (L55), DELETE→`removeTrackedKeyword` (L71), PATCH pin→`togglePinKeyword` (L84); each reads `wasTracked` first | TXN_WRAP | unguarded (underlying writers) |
| server/db/migrate-json.ts:1003-1026 | ONLY other direct writer of the column (`INSERT OR IGNORE`). One-time migration, single-writer at migration time | OTHER | not-a-runtime-RMW (out of scope; listed so it is not mistaken for a missed writer) |

**Writers beyond the originally-named set (would have been missed):** (1) `keyword-strategy-generation.ts:520` — a second seed/reconcile entry point (task named only :328); (2) `keyword-feedback.ts:169` — the singular `saveKeywordFeedback` path calls `addTrackedKeyword` unguarded (task named only the bulk `addTrackedKeywords:213`); (3) `public-content.ts:684` — the DELETE route's `removeTrackedKeyword`. **Good news:** no runtime writer mutates the blob outside the `rank-tracking.ts` exported API — wrapping at that layer covers everything. The only direct-column writer outside it is the migration (out of scope).

### #11 — duplicate rank-tracking query keys (QUERY_KEY_CONSOLIDATE)
`rankTrackingKeywords` and `rankTrackingKeywordRows` are two distinct cache buckets backed by the **same fetcher** (`rankTracking.keywords()` → GET `/api/rank-tracking/:id/keywords`). Consolidate to `rankTrackingKeywords`; delete the Rows key. Two Rows-only invalidations (togglePin, snapshot) must be **re-pointed**, not deleted, or those mutations stop refreshing the list. Reconcile the Set-vs-array `select` shape divergence.

| File:line | What | Fix type | Status |
|---|---|---|---|
| src/lib/queryKeys.ts:92 | DEF `rankTrackingKeywords(wsId)` → `['admin-rank-tracking-keywords', wsId]` | QUERY_KEY_CONSOLIDATE | keep |
| src/lib/queryKeys.ts:93 | DEF `rankTrackingKeywordRows(wsId)` → `['admin-rank-tracking-keyword-rows', wsId]` — same endpoint as L92 | QUERY_KEY_CONSOLIDATE | delete-target |
| src/api/seo.ts:116-117 | `rankTracking.keywords(wsId)` → GET `/api/rank-tracking/${wsId}/keywords` — the single shared queryFn for both keys | QUERY_KEY_CONSOLIDATE | single-endpoint-both-keys |
| src/components/KeywordStrategy.tsx:111-118 | READ `rankTrackingKeywords`; `select` maps rows→`Set<string>` (keywordTrackingKey). staleTime 5min | QUERY_KEY_CONSOLIDATE | read-Set-shape |
| src/components/RankTracker.tsx:171-176 | READ `rankTrackingKeywordRows`; same fetcher, consumes raw `TrackedKeyword[]`. staleTime 60s — central read that must switch keys | QUERY_KEY_CONSOLIDATE | read-array-shape |
| src/components/KeywordStrategy.tsx:224-227 | `setQueryData` on `rankTrackingKeywords` ONLY (appends to Set) — **asymmetry: RankTracker rows go stale until 60s refetch** | QUERY_KEY_CONSOLIDATE | setQueryData-one-key-asymmetry |
| src/components/RankTracker.tsx:216-217 | addKeyword invalidates BOTH keys (symmetric) — delete L216 (Rows), keep L217 | QUERY_KEY_CONSOLIDATE | invalidate-both |
| src/components/RankTracker.tsx:225-226 | removeKeyword invalidates BOTH — delete L225 (Rows), keep L226 | QUERY_KEY_CONSOLIDATE | invalidate-both |
| src/components/RankTracker.tsx:235-237 | togglePin invalidates **ONLY Rows** — must be **re-pointed** to `rankTrackingKeywords` (not deleted) or the list never refreshes on pin | QUERY_KEY_CONSOLIDATE | invalidate-Rows-ONLY-asymmetry |
| src/components/RankTracker.tsx:246 | snapshot invalidates **ONLY Rows** (no sibling) — must be re-pointed to `rankTrackingKeywords`. Easy to miss (not adjacent to a keep-key line) | QUERY_KEY_CONSOLIDATE | invalidate-Rows-ONLY-no-sibling |
| src/hooks/admin/useKeywordCommandCenter.ts:48-49 | action onSuccess invalidates BOTH — delete L49 (Rows) | QUERY_KEY_CONSOLIDATE | invalidate-both |
| src/hooks/admin/useKeywordCommandCenter.ts:64-65 | bulkAction onSuccess invalidates BOTH — delete L65 (Rows) | QUERY_KEY_CONSOLIDATE | invalidate-both |
| src/hooks/useWsInvalidation.ts:377-378 | STRATEGY_UPDATED invalidates BOTH — delete L378 (Rows) | QUERY_KEY_CONSOLIDATE | invalidate-both |
| src/hooks/useWsInvalidation.ts:392-393 | RANK_TRACKING_UPDATED invalidates BOTH — delete L393 (Rows) | QUERY_KEY_CONSOLIDATE | invalidate-both |

**Full site list (9 actions):** delete the Rows definition (queryKeys.ts:93); migrate the only Rows reader (RankTracker.tsx:172 → `rankTrackingKeywords`); **re-point** the 2 Rows-only invalidations (RankTracker.tsx:235 togglePin, :246 snapshot) to `rankTrackingKeywords`; delete the 6 redundant paired Rows invalidations (RankTracker.tsx:216 & 225; useKeywordCommandCenter.ts:49 & 65; useWsInvalidation.ts:378 & 393); reconcile the Set (KeywordStrategy:112) vs array (RankTracker:172) shape by giving each `useQuery` its own `select` against the one key.

### #13 — unauthenticated public recommendations GET that auto-runs heavy generation (ROUTE_AUTH_OR_JOB)
The public GET is unauthenticated and, on cache-miss, `await`s the full heavy rec-generation inline, holding the HTTP connection — both an auth hole and a DoS-amplification cost path. **Flag-surface caveat:** scope the fix to the route/job boundary only (add auth + return last-known/enqueue); do not touch `generateRecommendations` internals.

| File:line | What | Fix type | Status |
|---|---|---|---|
| server/routes/recommendations.ts:80-86 | GET `/api/public/recommendations/:wsId` — no auth middleware (`// public-no-auth-ok` hatch); on miss `await generateRecommendations()` inline (L85). The auth hole AND the cost path | ROUTE_AUTH_OR_JOB | unguarded + inline heavy gen on miss |
| server/routes/recommendations.ts:70-77 | Sibling POST `/generate` — also unauth (same hatch), `await generateRecommendations()` inline L72. The only 2 zero-auth `/api/public/` routes in the tree | ROUTE_AUTH_OR_JOB | unguarded + inline heavy gen |
| server/app.ts:269-286 | Client-session gate only enforces when `ws.clientPassword` set (L277) — passwordless workspaces short-circuit → leak + inline gen for anyone with the wsId | ROUTE_AUTH_OR_JOB | global gate insufficient on passwordless workspaces |
| server/middleware.ts:216-235 | FIX (a): `requireAuthenticatedClientPortalAuth('workspaceId')` — 404s unknown ws, 401s passwordless-by-URL (unlike `requireClientPortalAuth`). Precedent: rank-tracking.ts:129/137 | ROUTE_AUTH_OR_JOB | available precedent (preferred guard) |
| server/routes/jobs.ts:235-243 | FIX (b): SEO_AUDIT job already `await generateRecommendations(ws.id)` post-audit, then `loadRecommendations` (L243). The GET's inline gen is a redundant fallback | ROUTE_AUTH_OR_JOB | enqueue+return-last-known precedent confirmed |
| shared/types/background-jobs.ts:1-22 | No dedicated `RECOMMENDATIONS_GENERATION` job type (rides inside SEO_AUDIT). Needed only if enqueue option chosen (+ BACKGROUND_JOB_METADATA, `resultBehavior: 'domain-store'`) | PREVENTION | no dedicated job type (gap for enqueue option) |
| src/hooks/useRecommendations.ts:13-46 | Both `useRecommendationSet`/`useRecommendations` GET this route on every mount (staleTime 60s) → first-load cache-miss = synchronous heavy gen in the unauth request | EFFICIENCY | GET is the default client fetch; inline gen on first load |
| server/routes/recommendations.ts:80-97 (sweep) | Sweep result: this is the ONLY public GET that awaits heavy multi-step gen on a plain cache-miss with no auth. Single-route fix, not a class | ROUTE_AUTH_OR_JOB | no other public GET shares the shape |

### #21 — orphan disposition (DEAD_CODE_DELETE / HELD)
Three audited orphans. KeywordAnalysis and PageKeywordMap have zero production importers and are deletable; FixRecommendations is **HELD** (gen-quality reader lists name it live). KeywordAnalysis delete is gated by two CI-failing references that must change in the same commit.

| File:line | What | Fix type | Status |
|---|---|---|---|
| src/components/KeywordAnalysis.tsx:77 | ZERO prod importers (no JSX/route/lazy/barrel). Only other mention is a stale comment at webflow-keywords.ts:38 | DEAD_CODE_DELETE | orphan-confirmed; delete BLOCKED by a live contract test (next row) |
| tests/contract/page-intelligence-seo-editor-correctness.test.ts:16-25 | `readFileSync('src/components/KeywordAnalysis.tsx')` asserting source contains `keywords.analyze({`, `workspaceId,`, `slug,`, `pagePath: resolvePagePath(page)`, `pageTitle`. ENOENT on delete | DEAD_CODE_DELETE | must remove the "legacy KeywordAnalysis analysis" describe block in same commit |
| src/components/strategy/PageKeywordMap.tsx:65 | `PageKeywordMapPanel` — ZERO prod importers AND zero test refs. Cleanest delete | DEAD_CODE_DELETE | orphan-confirmed (zero imports, zero tests) |
| src/components/strategy/PageKeywordMap.tsx:7 | Imports LIVE `SeoCopyPanel` (used L275); SeoCopyPanel is imported by PageIntelligenceStrategySection.tsx — do NOT touch it on delete | DEAD_CODE_DELETE | leave-SeoCopyPanel-untouched |
| src/components/client/FixRecommendations.tsx:353 | Zero prod mounts, but named LIVE in gen-quality rules/plan reader lists (seo-generation-quality.md:53/95/289; gen-quality-plan:103/116/178/229). Reconcile before disposition | OTHER | HELD/parked — do NOT delete |
| tests/component/client/FixRecommendations.test.tsx:3 | Importer #1 of FixRecommendations (mocks useCart, renders). Stays (component HELD) | EXISTING_COVERAGE | importer, test stays |
| tests/components/client/client-components.test.tsx:1117 | Importer #2 of FixRecommendations (audit fixtures). Stays. Only test importer of any of the three besides KeywordAnalysis's contract test | EXISTING_COVERAGE | importer, test stays |
| src/App.tsx | ZERO refs to any of the three. No barrel/index.ts in the three dirs; no lazy/dynamic import; app has no Page/View routing union → route-removal-checklist N/A | DEAD_CODE_DELETE | no-route/no-barrel/no-Page-union |
| scripts/pr-check.ts:4875 | "Page component missing PageHeader" rule's `PAGE_COMPONENTS` array lists KeywordAnalysis.tsx and does `readFileSync` → crashes whole pr-check on missing file | DEAD_CODE_DELETE | must remove array entry in same commit |
| tests/pr-check.test.ts:4322 | Synthetic temp fixture path `KeywordAnalysis.ts` (note `.ts`, not `.tsx`) — not a real importer | EXISTING_COVERAGE | no action (false-positive guard) |
| docs/migration-inventory.md:146,304 | :146 PageKeywordMap, :304 FixRecommendations — non-CI doc hygiene. Prune PageKeywordMap line; keep FixRecommendations (HELD) | DEAD_CODE_DELETE | doc-inventory prune (non-CI) |

**What else changes on delete:**
- **KeywordAnalysis.tsx** (gated by 2 real CI references): remove the "legacy KeywordAnalysis analysis" describe block in `tests/contract/page-intelligence-seo-editor-correctness.test.ts:16-25`; remove the `PAGE_COMPONENTS` entry in `scripts/pr-check.ts:4875`. No App.tsx/barrel/Page-union changes (none exist). `tests/pr-check.test.ts:4322` needs no action (synthetic `.ts` path). Optionally prune docs/migration-inventory.md.
- **strategy/PageKeywordMap.tsx** (clean delete): no tests, no pr-check refs. Do **not** touch its live sibling `src/components/strategy/SeoCopyPanel.tsx`. Prune docs/migration-inventory.md:146.
- **FixRecommendations.tsx — HELD:** do not delete; its two tests stay; its inventory entry stays. Reconcile against the gen-quality plan before any disposition.

### #22 — dead `strategy.quickWins` blob fallback (DEAD_CODE_DELETE)
The blob's `quickWins` field is stripped on every write and boot-migrated out, so the `strategy.quickWins || []` fallback can never fire; the live source is the `quick_wins` table.

| File:line | What | Fix type | Status |
|---|---|---|---|
| server/recommendations.ts:1439 | `strategyQuickWins.length > 0 ? strategyQuickWins : (strategy.quickWins || [])` — the blob fallback is dead; live source is `listQuickWins` (L1438). `strategy` = raw `ws.keywordStrategy` (L1170) | DEAD_CODE_DELETE | dead-fallback |
| server/keyword-strategy-persistence.ts:96 | `delete strategyMeta.quickWins` on every write (alongside contentGaps/keywordGaps/topicClusters/cannibalization strips L95-99); never re-added | DEAD_CODE_DELETE | symmetric strip confirmed |
| server/quick-wins.ts:151 | Boot-time idempotent `migrateFromJsonBlob()` (`if countQuickWins>0 return`, L153) `delete strategy.quickWins` (L151) → blob field resolves to undefined→`[]` | DEAD_CODE_DELETE | idempotent migration + strip confirmed |
| src/components/KeywordStrategy.tsx:739 | `<QuickWins quickWins={strategy.quickWins || []} />` — the frontend `|| []` dead fallback (single site; do not touch other quickWins consumers) | DEAD_CODE_DELETE | dead fallback confirmed, single site |

### #19a — dead `topicClusters` / `cannibalization` Zod schema branches (DEAD_CODE_DELETE)
Both are `.optional()` blob branches that are stripped on write and live in normalized tables (migrations 089/090). **Not a silent-failure bug** (they are optional, so `parseJsonSafe` never zeroes data) — pure cleanup. Zero readers off the raw blob.

| File:line | What | Fix type | Status |
|---|---|---|---|
| server/schemas/workspace-schemas.ts:165-175 | `keywordStrategySchema.topicClusters` Zod branch — declared but stripped on write, never read off blob (table topic_clusters, mig 089) | DEAD_CODE_DELETE | dead schema branch |
| server/schemas/workspace-schemas.ts:176-190 | `keywordStrategySchema.cannibalization` Zod branch — same (table cannibalization_issues, mig 090) | DEAD_CODE_DELETE | dead schema branch |
| server/routes/keyword-strategy.ts:225,227 | Route reassembly `topicClustersFromTable.length>0 ? ... : (strategy?.topicClusters || [])` (and cannibalization L227) — dead blob fallbacks (table-first). Also `delete rest.topicClusters/.cannibalization` on write at :90-91 | DEAD_CODE_DELETE | dead blob fallbacks in route reassembly |
| src/components/KeywordStrategy.tsx:758,763 | Reads `strategy.topicClusters`/`.cannibalization` — but `strategy = keywordData?.strategy` (L79) is the route-reassembled object (from tables), NOT the raw blob → confirms branches safe to delete | DEAD_CODE_DELETE | frontend reads reassembled object, not raw blob |
| server/keyword-strategy-enrichment.ts:872 | DISAMBIGUATION: reads `strategy.quickWins`/builds topicClusters/cannibalization on the IN-MEMORY pre-persist object (also ai-synthesis.ts:1671, routes/jobs.ts:122). Generation-surface, flag-related — does NOT keep schema alive; OUT of Wave-1 scope | OTHER | in-memory pre-persist access — do not touch |

### 3x-parse — redundant `getTrackedKeywords` re-read per mutation (EFFICIENCY)
Each of the 4 single/batch mutators reads the blob for the mutation, then re-calls `getTrackedKeywords()` (a second full parse + per-item Zod) for its return value when the post-mutation array is already in hand. `updateTrackedKeywords` (L187) is the correct single-parse template. Folds naturally into the #1 txn refactor.

| File:line | What | Fix type | Status |
|---|---|---|---|
| server/rank-tracking.ts:147 | `readConfig` does `parseJsonSafeArray` + per-item `normalizeTrackedKeywords` (L126) Zod — each mutation parses 2x where 1x suffices | EFFICIENCY | 4 helpers double-parse; updateTrackedKeywords is the template |
| server/rank-tracking.ts:261 | `addTrackedKeyword` re-calls `getTrackedKeywords` after `writeConfig` (L260); return `config.trackedKeywords` (apply active filter inline) instead | EFFICIENCY | 1 redundant full parse+Zod per call |
| server/rank-tracking.ts:274 | `addTrackedKeywords` (batch) — same re-read after write (L273) | EFFICIENCY | 1 redundant full parse+Zod per call |
| server/rank-tracking.ts:282 | `removeTrackedKeyword` — filtered array already in hand; re-read after write (L281) | EFFICIENCY | 1 redundant full parse+Zod per call |
| server/rank-tracking.ts:291 | `togglePinKeyword` — mutated array already in hand; re-read after write (L290) | EFFICIENCY | 1 redundant full parse+Zod per call |

## Existing coverage
- **pr-check "Multi-step DB writes outside db.transaction()" (scripts/pr-check.ts:1930-1998).** Fires only when it finds **2+ `db.prepare().run()` WRITE statements** within `TXN_PAIR_MAX_DISTANCE` in one function with no `db.transaction(` lookbehind; it explicitly requires `.run(` (L1963). **Why the #1 race slipped past it:** the tracked_keywords RMW writers each have exactly **ONE** `.run()` (`upsertConfig.run` in `writeConfig`); the read is `getConfig.get()` (a SELECT, not a write). The rule structurally counts only writes, so a read-then-single-write blob-overwrite is invisible to it. That is precisely why `updateTrackedKeywords`/`addTrackedKeyword`/etc. are not flagged.
- **pr-check "AI call before db.prepare without transaction guard" (pr-check.ts:2001).** Guards the AI-race pattern; no AI call sits between `readConfig` and `writeConfig`, so it does not apply to #1.
- **pr-check "Inline React Query string key (use queryKeys.*)" (pr-check.ts:3396).** Forces the centralized factory but cannot detect two distinct factory keys backing the same endpoint — so the `rankTrackingKeywords`/`rankTrackingKeywordRows` duplication (#11) passes.
- **pr-check "Public route under /api/public/ missing client-portal auth" (pr-check.ts:7217-7307).** WOULD fire on recommendations.ts but is suppressed by the inline `// public-no-auth-ok` hatch (lines 70/80) and the rule's own exclude comment (:7233-7234, "recommendations.ts and stripe.ts have mixed auth coverage"). Removing the hatch + adding the middleware turns this rule into the #13 enforcer.
- **pr-check "Background generation in high-churn routes" (pr-check.ts:4486).** Guards detached post-response gen but only for `BACKGROUND_GENERATION_ROUTE_BASENAMES` (jobs/content-posts/content-briefs/content-requests/keyword-strategy/webflow-schema/workspaces). recommendations.ts is NOT in scope, so its inline `generateRecommendations()` is unguarded by both this rule and the (hatched) auth rule.
- **Partial #1 coverage:** `saveBulkKeywordFeedback` (keyword-feedback.ts:196) and KCC `applyKeywordCommandCenterActionInternal` (keyword-command-center.ts:2327) already wrap in `db.transaction()` — but **deferred, not `.immediate()`**, and they perform a read inside the deferred txn (busy-snapshot risk per PR #1030). Memory note keyword-strategy-db-lock-flake.md: the blessed rule is "convert vulnerable non-nested deferred read→write writers to BEGIN IMMEDIATE."
- **#11 test coverage:** queryKeys-coverage.test.ts:143-144 asserts only the `rankTrackingKeywords` shape (no assertion on the Rows key — deleting it breaks no test). useWsInvalidation-pure.test.ts:456/274 assert only the keep key. No frontend cache-coherence test crosses the two readers.
- **#13 test coverage:** recommendations-read-routes.test.ts documents the GET auto-generates on first call and asserts 500 for unknown ws, but runs in no-auth/passwordless mode (:81) — gives false confidence; no auth-positive/negative test exists.
- **#21 coverage:** the two CI-failing references (page-intelligence-seo-editor-correctness.test.ts:16-25 readFileSync; pr-check.ts:4875 PAGE_COMPONENTS readFileSync) double as the things that prove the file is currently contract-tracked AND the things that must change on delete.
- **#19a/#22 coverage:** boot-time idempotent migrations + persistence strips fully cover the data side; only the dead CODE remains. CLAUDE.md "Schema vs stored shape" rule enforces fields be `.optional()` to avoid fallback wipeout — it has no concept of an optional-but-dead branch, so #19a passes it.
- **Test infra:** createTestContext(port) (helpers.ts:38) + assertConcurrentGenerateSafe (helpers.ts:371, two Promise.all POSTs → asserts exactly 1 row) / assertIdempotentGenerate (:409). keyword-strategy-concurrent-guard.test.ts (PORT 13321, two simultaneous POSTs → one 409) is the two-writer template; tracked-keywords-enrichment.test.ts (PORT 13334) exercises the public tracked-keywords route. Latest migration = 116; next free = 117 (Wave-1 #1 is code-only, no migration). Next free integration port = **13886**.
- **No automated dead-code detector exists:** no knip/ts-prune/unimported config or devDependency, no source-inventory contract test — which is why three orphans survived undetected.

## Infrastructure recommendations

**1. Shared utility to extract (Phase-0 for #1).** A single nesting-safe `withTrackedKeywordsTxn(workspaceId, updater)` helper in `rank-tracking.ts` that opens `BEGIN IMMEDIATE` (mirroring the existing `keyword-strategy-persistence.ts:183-191` IMMEDIATE pattern — never revert IMMEDIATE per PR #1030), reads the config once, applies `updater`, writes once, commits — guarding on `db.inTransaction` so it no-ops the inner transaction when already inside the KCC outer `db.transaction()` (keyword-command-center.ts:2327). Route all 5 direct writers (`updateTrackedKeywords`, `addTrackedKeyword`, `addTrackedKeywords`, `removeTrackedKeyword`, `togglePinKeyword`) and the reconcile path through it. This **fixes the race in one place**, **collapses the 3x-parse redundancy** (one read inside the txn), and gives the new pr-check rule a single blessed call site. Also flip `saveBulkKeywordFeedback`'s `db.transaction()` (keyword-feedback.ts:196) to `.immediate()`.

**2. Forward-looking pr-check rules (Wave-1-relevant only).**
   - **NEW (#1): ban bare `tracked_keywords` RMW outside the txn-guarded helper** — pattern-match `readConfig(...)`/`get()`+`JSON.stringify`+`.run()` of a blob column in the same function with no enclosing `db.transaction(...).immediate()`, OR require all blob writers route through `withTrackedKeywordsTxn`. The existing "Multi-step DB writes" rule misses this (single write after a SELECT). Maps to plan §8.
   - **NEW (extend existing): flag deferred `db.transaction(() => { read → .run() })` not `.immediate()`** — the SQLITE_BUSY_SNAPSHOT pattern (PR #1030); would catch keyword-feedback.ts:196.
   - **Noted for later waves (author stubs, do not enforce now):** ban new positionColor/rank-color defs outside the authority module (#4, Wave 2); ban hand-rolled keyword/rank tables outside KeywordTable (#3, Wave 2); require `keywordComparisonKey` for keyword equality (#6/#12, Wave 3 — rank-tracking.ts already has 6+ local `normalizeQuery` call sites this would target). A dead-code detector (knip/ts-prune CI step) to catch future orphans like #21.

**3. Test coverage additions.**
   - **#1 concurrency (NEW, PORT 13886):** fire N concurrent `addTrackedKeyword`/POST tracked-keywords for DISTINCT keywords against one workspace via `Promise.all`; assert ALL survive in the blob (blob-merge survival — distinct from `assertConcurrentGenerateSafe`'s row-count semantics). Add a reconcile-vs-manual-add race test (strategy regen via `seedKeywordStrategyTrackedKeywords` racing a manual add; assert the manual keyword survives the rebuild). Add a **nesting-safety** test: `updateTrackedKeywords` inside the KCC outer txn must NOT throw.
   - **#11 cache-coherence (NEW):** a mutation-lifecycle-invalidation-style contract test asserting add/remove/**togglePin**/snapshot each invalidate the single consolidated `rankTrackingKeywords` key, and that KeywordStrategy's Set reader + RankTracker's array reader both refresh from the one key. Add a queryKeys-coverage assertion that `rankTrackingKeywordRows` no longer exists.
   - **#13 route auth (NEW):** auth-negative integration test — GET `/api/public/recommendations/:id` on a workspace WITH `clientPassword` set and no session must 401 (current read-routes test only covers passwordless mode).

**4. Root cause per finding.**
   - **#1:** read and write are separate prepared statements with no enclosing transaction; the existing multi-step-write rule only counts `.run()` writes, so a single-write-after-SELECT blob overwrite is invisible → silent lost-update under concurrency.
   - **#11:** two cache buckets backed by one fetcher with no rule mapping queryKey→endpoint; asymmetric invalidation (togglePin/setQueryData touch only one key) leaves the sibling surface stale.
   - **#13:** a `/api/public/` route hatched out of the auth rule + not in the background-gen allowlist, doing inline heavy gen on a read-path cache-miss; the passwordless-workspace short-circuit (app.ts:277) widens the leak.
   - **#21:** no dead-code/source-inventory detector → orphans accreted; hard-coded `readFileSync` paths in contract tests/pr-check arrays couple file deletes to those lists.
   - **#22 / #19a:** normalization migrations (088-090) moved fields to tables and strip them on write, but the now-orphaned blob schema branches and `|| []` fallbacks were never removed; the "Schema vs stored shape" rule has no concept of an optional-but-dead branch.
   - **3x-parse:** mutators re-call the full-parse getter for their return value instead of returning the post-mutation array already in scope (the correct pattern exists in `updateTrackedKeywords`).

## Parallelization strategy

**Phase 0 (shared infra, blocks #1 only):** extract the nesting-safe `withTrackedKeywordsTxn` helper in `rank-tracking.ts` and flip `saveBulkKeywordFeedback` to `.immediate()`. Doing #1 as a helper extraction also absorbs the **3x-parse** efficiency item (single read inside the txn) — so #1 and 3x-parse are one work unit owned by one agent.

**Parallel after Phase 0 (independent, parallel-safe during the gen-quality soak):**
- **#1 + 3x-parse** — owns `server/rank-tracking.ts`, `rank-tracking-reconciliation.ts`, `keyword-strategy-follow-ons.ts`, `keyword-feedback.ts`, `keyword-command-center.ts` (the two nested delegators), the public/admin tracked-keyword routes, the new pr-check rule, and the new concurrency test (PORT 13886). Self-contained server/test ownership.
- **#11** — owns `src/lib/queryKeys.ts`, `src/components/RankTracker.tsx`, `src/components/KeywordStrategy.tsx`, `src/hooks/admin/useKeywordCommandCenter.ts`, `src/hooks/useWsInvalidation.ts`, and the new cache-coherence test. Frontend-only; no file overlap with #1.
- **#21** — owns the orphan deletes (`KeywordAnalysis.tsx`, `strategy/PageKeywordMap.tsx`) + the same-commit edits to `tests/contract/page-intelligence-seo-editor-correctness.test.ts` and `scripts/pr-check.ts:4875` + doc prune. FixRecommendations HELD (no touch). Overlaps pr-check.ts with #1's new rule — coordinate the single pr-check.ts edit or sequence those two commits.
- **#22** — owns the `strategy.quickWins || []` deletes at `server/recommendations.ts:1439` + `src/components/KeywordStrategy.tsx:739`. Note KeywordStrategy.tsx is also touched by #11 — sequence #22's one-line edit after #11 or assign both to the same owner to avoid a conflict.
- **#19a** — owns the dead Zod branches `server/schemas/workspace-schemas.ts:165-190` + dead route fallbacks `server/routes/keyword-strategy.ts:225/227`. Independent.

**The one coupling to flag:** **#13 touches `recommendations.ts`, which is on the gen-quality flag surface.** Per the plan caveat (Wave 1 line 111), scope #13 strictly to the route/job boundary (add `requireAuthenticatedClientPortalAuth()` + replace inline `await generateRecommendations` with `loadRecommendations()` / optional enqueue; remove the two `// public-no-auth-ok` hatches and the pr-check exclude mention) and do NOT alter `generateRecommendations` internals — or defer #13 to the front of Wave 2 — to avoid muddying canary attribution. **Secondary file-overlap couplings:** `scripts/pr-check.ts` is edited by both #1 (new rule) and #21 (PAGE_COMPONENTS prune); `src/components/KeywordStrategy.tsx` is edited by #11, #22, and #19a-adjacent reads — assign overlapping files to a single owner or sequence the edits.

## Model assignments

| Item | Model | Reasoning |
|---|---|---|
| #1 tracked_keywords IMMEDIATE wrap + nesting-safe helper + concurrency test + new pr-check rule | Sonnet (Opus if helper-extraction touches the KCC nested-txn boundary) | Local judgment + better-sqlite3 nested-txn constraint + new concurrency test; the nesting-safety requirement raises risk |
| 3x-parse (folded into #1) | Sonnet | Same work unit as #1; `updateTrackedKeywords` is the in-repo template |
| #11 query-key collapse + togglePin/snapshot re-point + 4-site invalidation update + Set/array select reconcile | Sonnet | Multi-site frontend judgment + cache-coherence test + shape divergence |
| #13 recommendations.ts route/job-boundary change | Opus (or Sonnet under tight flag-surface scope) | On the gen-quality flag surface — must stay strictly at the route/job boundary to protect canary attribution; cross-context reviewer = Opus |
| #22 strategy.quickWins `|| []` fallback delete | Haiku | Mechanical, two single-line sites, no judgment |
| #19a dead Zod-branch + dead route-fallback removal | Haiku | Mechanical optional-branch removal, no correctness risk (already optional+stripped) |
| #21 orphan deletion (KeywordAnalysis, PageKeywordMap) + same-commit test/pr-check/doc edits | Haiku (Sonnet to manage the 2 CI-coupled edits) | Deletion is mechanical, but the page-intelligence contract test + PAGE_COMPONENTS prune must land in the same commit — Sonnet if the coupling needs care |
| All cross-context / flag-surface reviews | Opus | Per plan §7 ladder |

## Handoff
Ready for writing-plans.