# Keyword Surface Consolidation — Wave 3 Pre-Plan Audit

**Date:** 2026-06-03
**Scope:** Server data-model consolidation (Wave 3 of the keyword-surface-consolidation master plan). The riskiest wave — it carries real DB migrations.
**Branch/worktree:** `feat/keyword-consolidation-wave3` (off the latest staging; Waves 1, 2, 2b shipped). Latest migration = `116-tracked-action-predicted-emv.sql`; next = **117**.
**Wave 3 targets:** #2 single `assembleStoredKeywordStrategy(workspaceId)` (table-as-truth); #12 promote `tracked_keywords` blob → row table; #6/#7 persist provenance + retire `inferTrackedKeywordSources`; #18 `strategy_history` typed schema + FK; #19b normalize `siteKeywordMetrics` out of the blob; #20 diff-based upserts to shrink persist lock-hold.
**Total findings:** 5 lanes, ~60 distinct file:line findings, 35 risks. Cross-lane consensus is strong: the five lanes independently converge on the same read-path map, the same migration-safety ordering, and the same "never strip a blob whose Zod field is not `.optional()`" rule.

> **Key correction to the prompt framing (all lanes agree):** the prompt says "4 copy-pasted read-path reassemblies." There are actually **FIVE distinct files** — `keyword-strategy.ts`, `public-content.ts`, `keyword-command-center.ts` (itself FOUR internal call sites), `seo-context-slice.ts`, `recommendations.ts`. KCC alone has 4 reassembly sites, so the assembler swap is **~8 call sites across 5 files**, not 4. `recommendations.ts` is a 6th-onward consumer that re-derives independently and is **seo-generation-quality flag-surface-sensitive**.

---

## Findings by dimension

### Dimension A — #2 the assembler & the read-path map

Five read paths reassemble the keyword strategy today, with **divergent fallback policies** — the exact silent-divergence the plan targets. `assembleStoredKeywordStrategy` does **not yet exist** (grep-confirmed across all lanes).

| File:line | What |
|---|---|
| `server/routes/keyword-strategy.ts:212-263` | READ PATH 1 (admin GET). `pageMap`=table-only; `contentGaps` (L218-219) + `keywordGaps` (L222-223) **STILL have blob-fallback ternaries**; `quickWins`/`topicClusters`/`cannibalization` table-only (Wave-1 stripped). `serializeKeywordStrategy` (L74-112) re-strips the 5 arrays + `semrushMode` from the blob before re-attaching table values. |
| `server/routes/public-content.ts:125-269` | READ PATH 2 — **THE public read surface** (`GET /api/public/seo-strategy/:id`). DIVERGENCE: STILL has blob-fallback for **ALL FIVE** arrays (contentGaps L133-134, quickWins L137-138, keywordGaps L141-142, topicClusters L145-146, cannibalization L147-148). Explicit client-safe WHITELIST at L183-265 incl. `siteKeywordMetrics` from blob (L185) and the `backfilled` honesty flag (L220). |
| `server/keyword-command-center.ts:1139-1153, 1261-1305, 1868-1894, 2056-2112` | READ PATHS 3 & 4 — **FOUR KCC reassemblies** (bundle, summary/universe, filtered-bundle, single-keyword). All table-only for contentGaps/keywordGaps (no blob fallback). Reads `siteKeywords`/`siteKeywordMetrics` direct from blob. Calls `inferTrackedKeywordSources` at 3 of 4 sites (1153/1297/2102). Lite path uses `listPageKeywordsLite`. |
| `server/intelligence/seo-context-slice.ts:28-99` | READ PATH (intelligence slice). Spreads the **WHOLE blob** (L50) then overrides only `pageMap` (L51) + `contentGaps` (L52). **Does NOT read keyword_gaps/topic_clusters/cannibalization/quick_wins tables** — so for migrated workspaces those arrays are **already EMPTY in AI context today** (latent bug the assembler fixes). Promise-returning, per-source try/catch graceful degradation. |
| `server/recommendations.ts:1170,1226,1493,1579,1712,1936` | READ PATH (recs re-derivation). Mixes blob (`siteKeywords`/`siteKeywordMetrics`/`opportunities`, L1170) + tables (listContentGaps/KeywordGaps/QuickWins/TopicClusters/Cannibalization). Heaviest consumer (auto-gen-on-GET). **On the seo-gen-quality flag surface.** |
| _(proposed)_ `assembleStoredKeywordStrategy(workspaceId)` | ONE function, table-as-truth, no per-request `length>0?table:blob` ternary. Place in owned module (`server/keyword-strategy-assembler.ts` or extend `keyword-strategy-persistence.ts`). Typed return shape defined in `shared/types/` BEFORE impl. |

**Risks (dimension A):**
- **admin↔public fallback asymmetry** — admin is table-only for 3 arrays, public is dual-basis for all 5; KCC/recs/slice are table-only. The same field resolves to blob OR table depending on which path a request hits. The assembler must collapse to ONE policy.
- **The `backfilled` honesty flag (SEO-genquality P2) MUST survive** the assembler's `contentGaps` projection along with all 17 whitelisted gap fields — a naive assembler returning a different `ContentGap` shape silently breaks it. Covered by `tests/integration/seo-genquality-p2-backfilled-public-read.test.ts:62-74`.
- **`seo-context-slice` has no fallback** and skips 4 tables — assembler restores parity but must stay degradation-safe (sync assembler + slice keeps its try/catch, or expose a degradation-safe variant).

### Dimension B — Blob-strip migration surface (#2 backfill + #19b normalize)

The persist write path **already strips** the 6 table-backed arrays from the blob (table-as-truth on WRITE). `siteKeywordMetrics` is the one array still living in the blob.

| File:line | What |
|---|---|
| `server/keyword-strategy-persistence.ts:92-117` | PERSIST WRITE-PATH. Deletes pageMap/contentGaps/quickWins/keywordGaps/topicClusters/cannibalization from the blob (L94-99). Still WRITES into blob: `siteKeywords`, `opportunities`, `siteKeywordMetrics` (L102, `length>0?…:undefined`), `competitorKeywordData` (L103, `.slice(0,150)`), `questionKeywords` (L104), `searchSignals.*` (L108-115). #19b targets `siteKeywordMetrics`. |
| `server/keyword-strategy-generation.ts:307` (+393/500) | #19b CLOSED-LOOP HAZARD. Incremental no-op path passes `existingStrategy?.siteKeywordMetrics ?? []` — READS old blob value and WRITES it back. #19b must cut BOTH the blob write (`persistence.ts:102`) AND the `existingStrategy` source (gen `:307`) together, or metrics vanish on the next incremental run. |
| `server/rank-tracking-reconciliation.ts:66-79` | #19b RECONCILE JOIN to preserve. `buildTargets()` iterates `siteKeywords` and joins `siteKeywordMetrics` by `normalizeQuery` (L72) to attach volume/difficulty to STRATEGY_SITE_KEYWORD targets. Options type is `Pick<KeywordStrategy,'siteKeywords'|'siteKeywordMetrics'|'generatedAt'>` (L41). If metrics moves to a table, this join's data source must move with it or every site-keyword target loses its baseline. |
| `server/index.ts:42-68` | MIGRATION EXECUTION ORDER. `runMigrations()` (SQL, ONE outer IMMEDIATE txn, FK OFF) runs FIRST; then 6 idempotent JS blob-strip boot migrations run UNCONDITIONALLY every startup, OUTSIDE that txn, FK back ON, before `createApp()`. A **SQL-only 117 cannot run JS normalize/dedupe** (`normalizeKeywordGap`/`normalizeQuickWin`/`keywordComparisonKey`) — any normalizing backfill must be a JS boot step here. |
| `server/content-gaps.ts:214-251` | BOOT MIGRATION (the canonical template) **and a divergence hazard**. It is the ONLY boot migration using a **non-transactional, non-CAS-guarded** read→mutate→blind-UPDATE — quick-wins/keyword-gaps/topic-clusters/cannibalization all use `migrateOne.immediate()` + `WHERE id=? AND keyword_strategy=?` CAS. Under a concurrent persist it can LOST-UPDATE the whole `keyword_strategy` column. Harden to the CAS pattern this wave. |
| `server/schemas/workspace-schemas.ts:156-173` | `keywordStrategySchema` is `.passthrough()`, all fields `.optional()` incl. `siteKeywordMetrics` (L160). #19a dead Zod branches (topicClusters/cannibalization) are **ALREADY removed** — do NOT re-flag. When #19b strips siteKeywordMetrics, the field must STAY `.optional()` so the stripped blob still parses. |
| `shared/types/workspace.ts:149-209` | DB-column/mapper lockstep master list. Table-backed: pageMap, contentGaps, quickWins, keywordGaps, topicClusters, cannibalization. Still in blob: siteKeywords, `siteKeywordMetrics` (#19b), opportunities, competitorKeywordData, questionKeywords, searchSignals. |

**Risks (dimension B):**
- **IDEMPOTENT-SKIP STALE-BLOB**: all 6 boot migrations skip workspaces whose table already has rows (`countX>0`). A partially-migrated workspace (table populated, blob array NOT stripped) keeps a stale array forever; if a regen ever empties the table, the `length>0?table:blob` ternary **resurrects** the stale blob. A forced 117 backfill for #2 must UNCONDITIONALLY strip for ALL workspaces, only after every read path reads the table.
- **BACKFILL-BEFORE-STRIP is load-bearing**: there is NO existing boot-strip migration for the blob arrays; the ternaries are the ONLY thing protecting legacy un-migrated workspaces. Deleting a ternary before backfilling = permanent public-facing data loss.
- **#19b blast radius ≥20 readers** (reconciliation:72, KCC:316/810/1261/1463/1518/1642/2056/2112, keyword-strategy-ux:374, public-content:185, inferTrackedKeywordSources:316, generation:307/393/440/500, persistence:102, enrichment). Under `.passthrough()`, a missed reader **silently** falls to `?? []` — every reader must be repointed in the SAME PR.

### Dimension C — #12 `tracked_keywords` row table

Today: `rank_tracking_config.tracked_keywords TEXT` (one JSON blob per workspace, PK `workspace_id`, FK+CASCADE added in mig 019). The single riskiest migration: **5 writers + 11–13 read consumers**, all already funneled through `getTrackedKeywords` / `withTrackedKeywordsTxn` (Wave-1).

| File:line | What |
|---|---|
| `server/rank-tracking.ts:147-226` | The blob layer to dissolve. `readConfig` (parse + `normalizeTrackedKeywords` dedup by `keywordComparisonKey`) → `writeConfig` (`JSON.stringify` whole array). `withTrackedKeywordsTxn` (L207-226) = Wave-1 BEGIN IMMEDIATE wrapper + `db.inTransaction` nesting guard. #12 must preserve: `.immediate()` semantics, the nesting guard, the post-mutation return value, and `keywordComparisonKey` as the `normalized_query` PK. |
| `server/rank-tracking.ts:122-145, 181-185` | `normalizeQuery = keywordComparisonKey` (lowercase → strip non-alphanumeric → collapse spaces → trim) = the `normalized_query` column value. Store BOTH `normalized_query` (PK) and raw `query` (display). JS dedup keeps FIRST + DROPS blanks; a raw `UNIQUE … DO UPDATE` keeps LAST + could insert blank — **JS normalize/dedup must run BEFORE the per-row writes**. Active-filter = `status ?? ACTIVE` (NULL = active). |
| _(new)_ `server/db/migrations/117-tracked-keywords-rows.sql` | Schema mirroring the 088/090 precedent: PK `(workspace_id, normalized_query)`, FK `workspace_id → workspaces(id) ON DELETE CASCADE`, columns for every TrackedKeyword field (nullable except query/pinned/added_at), `idx_tracked_keywords_workspace` + `idx_tracked_keywords_status(workspace_id, status)`. NOTE the table name `tracked_keywords` collides with the existing **column** `rank_tracking_config.tracked_keywords` — disambiguate in docs/grep. |
| _(new)_ `migrateTrackedKeywordsFromConfigBlob()` in `server/index.ts:46-68` | Backfill is a JS boot step (NOT in 117.sql), template = `keyword-gaps.ts:130-191`: read config rows → parse+normalize → per-workspace `.immediate()` (skip if `countTrackedKeywordRows>0`), insert rows, then CAS-strip the blob `WHERE workspace_id=? AND tracked_keywords=?`. |
| `server/db/migrate-json.ts:1003-1026` | **The ONLY raw-column writer outside the module** (legacy JSON-file importer). Writes the blob directly via `INSERT OR IGNORE`. Under a row table this must EITHER route through `addTrackedKeywords()` OR be sequenced so its blob is picked up by the backfill — else it orphans an un-migrated blob. |
| `server/rank-tracking-reconciliation.ts:159-232` | The HARDEST writer to port. Its updater **rebuilds the ENTIRE set** (deprecates/replaces strategy-owned non-pinned keywords no longer in targets, L179-198) — intrinsically a **full-set replace, not a sparse upsert**. The row-table writer MUST compute deletions (`current-keys − next-keys → DELETE`), not just upserts, or stale deprecated rows persist. |
| `server/keyword-command-center.ts:2213-2283` | KCC writers `upsertTrackedKeywordByKey` + `retireTrackedKeyword`. KCC wraps these in an **outer `db.transaction()`** → the inner `withTrackedKeywordsTxn` NO-OPs its BEGIN (nesting guard). The diff-upsert must NOT open its own IMMEDIATE when nested. |
| `server/keyword-feedback.ts:169,194-217` | Feedback approve writers (`addTrackedKeyword`/`addTrackedKeywords`), bulk path in its own `.immediate()`. Safe under nesting guard as long as they keep routing through `withTrackedKeywordsTxn`. |
| `scripts/pr-check.ts:7858-7920` | The bare-RMW guard customCheck keys on `readConfig`/`writeConfig` names. Under the row table these may be renamed → the rule goes **dead-letter** unless re-authored to ban bare `tracked_keywords` row SELECT…INSERT/UPDATE outside the txn helper. Must be updated in the same PR (+ the `withTrackedKeywordsTxn` doc comment + `docs/rules/keyword-surface-consolidation.md`). |

**Consumers (must all keep working when the blob becomes a row table):** READERS via `getTrackedKeywords` (~13 files): rank-tracking, rank-tracking-reconciliation, keyword-strategy-ai-synthesis, keyword-command-center, local-seo, keyword-strategy-universe, keyword-strategy-ux, recommendations, admin-chat-context, seo-context-slice, routes/keyword-strategy, routes/public-content, routes/rank-tracking. WRITERS (7): rank-tracking, reconciliation, keyword-command-center, keyword-feedback, routes/rank-tracking, routes/public-content, schemas/public-content. `getTrackedKeywords` stays the public API — swap its internals only.

**Risks (dimension C):**
- **LOST-UPDATE regression via partial port**: dropping to bare per-row autocommit, or naively converting reconcile's full-set rebuild to upsert-only (no DELETE), re-opens the race or accumulates stale deprecated rows. The diff (delete-absent + upsert-present) MUST run inside the same IMMEDIATE; preserve the nesting guard.
- **NULL-STATUS legacy default**: SQL filter must be `status='active' OR status IS NULL`; `rowToTrackedKeyword` must return **undefined** (not `'active'`, not `null`) for NULL columns so the JSON payload is byte-identical and React Query / Wave-4 `togglePin` partial-invalidation stay stable.
- **STRIP-BEFORE-FLIP data loss**: stripping the blob before the live read reads the table means a deploy revert reads an empty blob → all tracked keywords vanish. Table+backfill (read still blob) → flip read → verify on staging → strip, in separate PRs.
- **FK+CASCADE coverage**: the new table MUST carry the FK+CASCADE (precedent 088/090). Verify `tracked-keywords-lifecycle.test.ts` covers workspace-delete cascade.

### Dimension D — #6/#7 Provenance

`inferTrackedKeywordSources` (read-time re-inference) exists ONLY because `tracked_keywords` never stored a durable origin pointer. #6/#7 persists `sourcePageId`/`sourceGapKey` at promotion and retires the inference.

| File:line | What |
|---|---|
| `server/keyword-command-center.ts:307-342` | DEF of `inferTrackedKeywordSources`. Re-infers source for `UNKNOWN`-only rows: siteKeywordMetrics→STRATEGY_PRIMARY, siteKeywords→STRATEGY_SITE_KEYWORD, feedback→CLIENT_REQUESTED, contentGaps→CONTENT_GAP. Pure (no write-back). **Cannot recover MANUAL or RECOMMENDATION** — those stay UNKNOWN, so a backfill relying solely on this ladder mis-buckets legacy manual/recommendation rows. |
| `server/keyword-command-center.ts:1153, 1297, 2102` | The **3** live read-path call sites (bundle, summary/keys-collection, single-keyword). Comments warn bundle-level application is required so `sourceKeysForRows` + `trackedKeywordMatchesFilter` + `protectedReason` agree. All 3 must drop the inference in lockstep or filters disagree per-surface. |
| `server/keyword-feedback-tracking.ts:10-24` | `trackedKeywordSourceForFeedback` — **THE LAUNDERING**. Maps `page_map → STRATEGY_PRIMARY`, `topic_cluster → STRATEGY_SITE_KEYWORD`; default (incl. undefined) → CLIENT_REQUESTED. Schema default is `'content_gap'`. A client/admin approval gets stamped as strategy-owned. |
| `server/rank-tracking-reconciliation.ts:50-67, 118` | `isStrategyOwned(kw) = source ∈ {STRATEGY_PRIMARY, STRATEGY_SITE_KEYWORD}`. Auto-deprecates every `isStrategyOwned && !pinned` keyword no longer in targets. **Consequence of the laundering**: a client-approved keyword sent via page_map/topic_cluster feedback becomes strategy-owned → silently auto-deprecated on the next regen, despite the client explicitly requesting it. `mergeTarget` (L118) also OVERWRITES existing source. |
| `server/keyword-command-center.ts:280-286, 2165-2169, 2200-2211` | `protectedReason()` (the only auto-deprecation guard) protects pinned/CLIENT_REQUESTED/MANUAL — NOT laundered STRATEGY_* rows. `trackedSourceForMerge` decides source on KCC upsert. Design target: introduce an explicit `strategyOwned` boolean so protection + auto-deprecation read the flag, not the source enum. |
| `shared/types/rank-tracking.ts:1-47` | `TrackedKeyword` has `pagePath?`/`pageTitle?` but **NO `sourcePageId`/`sourceGapKey`**. Add both here FIRST (shared type before impl), then mirror into `trackedKeywordSchema` (`.optional()`), `AddTrackedKeywordOptions`, and the row table (#12). |
| `shared/types/workspace.ts:21-66` + `server/db/migrations/086-content-gaps.sql:32` | Pointer keys identified: `PageKeywordMap` has **NO stable id** (keyed by mutable `pagePath`) → `sourcePageId` must reference the `page_keywords` PK / normalized pagePath. `content_gaps` PK is `(workspace_id, target_keyword)` → `sourceGapKey = keywordComparisonKey(target_keyword)` (a natural stable key, not a synthetic id). |
| 5 source-stamping write paths | (1) reconciliation:75,89 (STRATEGY seed); (2) keyword-feedback:170,207 (approve, laundered); (3) KCC:2332/2342-2343/2373 (actions); (4) public-content:653 (CLIENT_REQUESTED); (5) routes/rank-tracking:57 (MANUAL). These 5 are where `sourcePageId`/`sourceGapKey` should be persisted **additively** — none do today. |
| WS-broadcast `source` vocab | DIVERGENCE-WITH-CARE: broadcast payloads carry a separate `source` axis (`keyword_strategy`/`command_center`/`manual`/`client`/`strategy`) = WHICH SURFACE emitted the event, NOT keyword provenance. **Do NOT collapse onto `TRACKED_KEYWORD_SOURCE`** — rename the broadcast field (`origin`/`trigger`). |

**Risks (dimension D):**
- **Laundering data-loss (highest)**: existing laundered rows must be migrated or they keep auto-deprecating. `protectedReason` does not protect STRATEGY_* sources.
- **Backfill under-recovery**: the inference ladder can't recover MANUAL/RECOMMENDATION — never guess; leave them UNKNOWN explicitly or add a separate heuristic.
- **Pointer instability**: `sourcePageId` as `pagePath` is mutable (page rename orphans provenance); use the `page_keywords` PK. `sourceGapKey` = normalized `target_keyword` is stable.
- **Order trap**: retire `inferTrackedKeywordSources` only AFTER `sourcePageId`/`sourceGapKey` exist AND are backfilled (requires #12 row table to hold the columns AND #19b so STRATEGY_PRIMARY inference is replaced by a stored source). Deleting early regresses KCC `IN_STRATEGY` count + `lifecycleStatus` (both read `keyword.source` directly).
- **Stopping the laundering is a behavior change** (not extraction) — needs a named fixture and a check that previously-laundered keywords are not suddenly auto-deprecated.

### Dimension E — Safety + persist txn + #18 + #20

| File:line | What |
|---|---|
| `server/keyword-strategy-persistence.ts:119-191` | THE PERSIST TXN (do NOT revert). One `db.transaction(...).immediate()`: 6 prior-state READS (L122-127) → page rewrite → 5 destructive `replaceAll*` (L148-152) → `strategy_history` INSERT + prune-to-5 (L164-167) → `updateWorkspace` blob (L170) → addActivity/recordAction. **Reads-before-writes** is the EXACT reason `.immediate()` is mandatory (SQLITE_BUSY_SNAPSHOT / PR#1030). #20 optimizes lock-HOLD within it, never reverts. |
| `server/page-keywords.ts:519-546, 291-319` | #20 CANONICAL MODEL ALREADY EXISTS: upsert-each-then-DELETE-orphans (`NOT IN`) with `preserve_analysis_fields` + ~16 `CASE WHEN … COALESCE(excluded.x, page_keywords.x)`. Replicate this for the other 5 tables; preserve the `run.immediate()`→SAVEPOINT nesting behavior under the persist txn. |
| `server/content-gaps.ts:181-190` + quick-wins:103 / keyword-gaps:100 / topic-clusters:130 / cannibalization-issues:165 | #20 TARGETS — all 5 `replaceAll*` do `deleteAll` + re-INSERT every row, each its own nested txn → SAVEPOINT under the IMMEDIATE lock. Convert to diff upserts. **METADATA rule**: `content_gaps.backfilled` (mig 115) must be COALESCE-preserved (or re-supplied via `modelToParams`); the other 4 tables have **NO created_at/sort_order** columns — so #20's only win there is reduced churn. Do not over-engineer COALESCE where there is nothing to preserve. |
| `server/db/migrations/030-strategy-history.sql` | #18 target. `{id, workspace_id TEXT (NO FK), strategy_json TEXT, page_map_json TEXT, generated_at}` + index only — untyped JSON, no FK, no module/mapper (inline `db.prepare` writer at persistence:164; 3 inline readers). Mig 030 ran AFTER mig 019's CASCADE pass → strategy_history was NEVER in the orphan-cleanup recreate → workspace deletes orphan its rows permanently. |
| `server/keyword-strategy-ux.ts:40-51,306-318` + `routes/keyword-strategy.ts:274-300` + `seo-context-slice.ts:181` | #18 CONSUMER MAP. Two baked-blob readers use **divergent untyped `parseJsonFallback` shapes**: diff route reads `{siteKeywords, contentGaps.targetKeyword}`; ux reads the SAME two fields independently; slice reads only `generated_at`. The typed schema must cover BOTH fields or the diff/UX panels silently empty. All 3 readers + the writer move to a typed module in one commit. |
| `docs/audits/2026-06-03-…audit-prompt.md:130` + master plan §11 | SAFE MIGRATION ORDER guardrails: #1 (IMMEDIATE) DONE; #1 before #12; #2 before #12; never #1+#12 in one PR; owner-gate the backfill on staging before each strip. |

**Risks (dimension E):**
- **Persist-txn revert**: any #20 change that converts a nested `db.transaction()` to a bare BEGIN, moves reads after writes, or drops `.immediate()` reintroduces the SQLITE_BUSY_SNAPSHOT flake. The reads-before-writes ordering is load-bearing.
- **#18 FK migration**: SQLite cannot `ALTER ADD FOREIGN KEY` — requires a table-rebuild (create-new-with-FK + `INSERT SELECT` copying AUTOINCREMENT id explicitly + drop + rename + recreate index), inside `runMigrations`' FK-OFF outer txn. **Pre-existing orphan rows will FK-violate on rebuild** — add an orphan-cleanup DELETE (mig-019 pattern) first.
- **#18 baked-snapshot shape**: if the typed schema changes the snapshot shape, the diff/refresh-summary readers (`parseJsonFallback` → `{}`) break silently.

### Dimension F — Test coverage & verification

| File:line | What |
|---|---|
| `tests/integration/seo-genquality-p2-backfilled-public-read.test.ts:62-74` | The public-read-path TEMPLATE. Hits `GET /api/public/seo-strategy/:id`, asserts `backfilled` survives the explicit whitelist. The model for #2 (assembler byte-identity) and #19b (siteKeywordMetrics survives). |
| `tests/integration/tracked-keywords-concurrency.test.ts` (port 13886) | The Wave-1 safety net #12 MUST NOT regress. T1a (deferred→IMMEDIATE SQLITE_BUSY_SNAPSHOT via a 2nd raw connection), T1b (nesting/savepoint + rollback inheritance), T1c (reconcile manual-keyword preservation + 3x-parse return value). #12 changes T1a's premise (single-blob-row snapshot) → **rewrite, do not delete**. |
| `tests/integration/public-content-routes.test.ts` + `fixture-keyword-strategy-routes.test.ts` | Public read + admin route coverage. Each assembler/strip swap needs a public GET assertion (the actual read path), not just the admin fixture. |
| `tests/unit/migration-data-preservation.test.ts` | CASCADE + `PRAGMA table_info` fresh-DB pattern — template for the #18 FK CASCADE test and #12/#19b column-assertion tests. |
| `scripts/pr-check.ts` CHECKS array (~165 rules today) | New rules: (1) ban bare `tracked_keywords` RMW outside the txn helper; (2) require `keywordComparisonKey` for keyword equality; (3) ban new strategy blob+table reassembly outside `assembleStoredKeywordStrategy`. Run `npm run rules:generate`; bump rule count in CLAUDE.md. |

**Risks (dimension F):**
- Per-PR verification: `npm run typecheck && npx vite build && npx vitest run && npx tsx scripts/pr-check.ts && npm run verify:feature-flags && npm run verify:coverage-ratchet` + migration-specific fresh-DB + CASCADE tests + the public-read test for #2/#19b. **Kill orphan 13xxx ports before commit** (asset-dashboard test-ports memory) or the pre-commit hook flakes.

---

## The assembler contract (#2)

```ts
// shared/types/keyword-strategy.ts — define BEFORE implementation (Data-Flow rule #5)
interface StoredKeywordStrategy {
  siteKeywords: string[];
  opportunities: string[];
  siteKeywordMetrics?: KeywordStrategySiteKeywordMetric[]; // stays blob-sourced until #19b
  pageMap: PageKeywordMap[];
  contentGaps: ContentGap[];          // MUST carry the 17 whitelisted fields incl. `backfilled`
  quickWins: QuickWin[];
  keywordGaps: KeywordGapItem[];
  topicClusters: TopicCluster[];
  cannibalization: CannibalizationItem[];
  businessContext: string;
  seoDataMode; seoDataStatus;
  searchSignals?;
  generatedAt: string | null;
}

// server/keyword-strategy-assembler.ts (or extend keyword-strategy-persistence.ts)
function assembleStoredKeywordStrategy(workspaceId: string): StoredKeywordStrategy | null;
```

**Documented fallback policy (single):** **table-as-truth.** No per-request `length>0 ? table : blob` ternary. Returns `null` only when the blob is absent AND all 6 tables are empty (the existing short-circuit at `keyword-strategy.ts:227` / `public-content.ts:149-158`). **Caveat:** the assembler must keep a table-or-blob fallback **until the forced strip PR lands** — table-as-truth would drop data for un-migrated legacy workspaces before backfill. So: ship the assembler with the fallback baked in, then remove the fallback in the strip PR.

**Out of the assembler (route-layer concerns):** `strategyUx`, the public client-safe whitelist projection (`public-content.ts:183-265`), and `computeOpportunityScore` defaults. The assembler returns the **full internal shape**; the route serializes the whitelist. Do NOT leak internal fields to the client.

**Consumer-swap list (one consumer per PR, riskiest = public last):**
1. `server/routes/public-content.ts:125-269` — public read (covered by p2-backfilled-public-read + client-strategy tests).
2. `server/routes/keyword-strategy.ts:212-263` — admin route (delete `serializeKeywordStrategy`'s re-strip once the assembler owns it).
3. `server/intelligence/seo-context-slice.ts:28-99` — restores parity (currently skips 4 tables); keep degradation-safe.
4. The 4 KCC sites (`1139`/`1261`/`1868`/`2056`) — serve the Lite path (`listPageKeywordsLite`) too.
5. `server/recommendations.ts:1170+` — **EXCLUDE from Wave 3 or do dead-last** with a flag-OFF byte-identity test (seo-gen-quality canary surface; "reduce recs re-derivation" is a soft goal, not a hard #2 dependency).

**Public-read-test requirement:** every assembler/strip swap MUST exercise `GET /api/public/seo-strategy/:id` (the actual public read path), asserting byte-identical output + `backfilled` survival, not just the admin GET.

---

## `tracked_keywords` row table (#12)

**Schema (migration 117, precedent 088/090):**
```sql
CREATE TABLE IF NOT EXISTS tracked_keywords (
  workspace_id TEXT NOT NULL,
  normalized_query TEXT NOT NULL,      -- = keywordComparisonKey(query), the PK component
  query TEXT NOT NULL,                 -- raw display text
  pinned INTEGER NOT NULL DEFAULT 0,
  added_at TEXT NOT NULL,
  source TEXT, status TEXT,
  page_path TEXT, page_title TEXT,
  strategy_generated_at TEXT, last_strategy_seen_at TEXT,
  intent TEXT, volume REAL, difficulty REAL, cpc REAL,
  authority_posture TEXT,
  baseline_position REAL, baseline_clicks REAL, baseline_impressions REAL,
  replaced_by TEXT, deprecated_at TEXT,
  source_page_id TEXT, source_gap_key TEXT,    -- #6/#7 provenance (additive)
  PRIMARY KEY (workspace_id, normalized_query),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);
CREATE INDEX idx_tracked_keywords_workspace ON tracked_keywords(workspace_id);
CREATE INDEX idx_tracked_keywords_status   ON tracked_keywords(workspace_id, status);
```

**Mapper:** `rowToTrackedKeyword()` targets `shared/types/rank-tracking.ts:27-47` EXACTLY — **NULL columns → `undefined`** (omitted by `JSON.stringify`), never `null`, so the HTTP payload is byte-identical to the blob path.

**Upsert/delete (the diff seam):** keep `withTrackedKeywordsTxn(workspaceId, updater)` signature identical so all writers are untouched at the call site. Internally `run()` becomes: (1) `SELECT * WHERE workspace_id=?` → `TrackedKeyword[]`; (2) run `updater` + `normalizeTrackedKeywords` **in JS** (preserves global dedup-by-normalizeQuery + blank-drop that a per-row UNIQUE cannot replicate); (3) compute the diff (delete-absent + upsert-present via `INSERT … ON CONFLICT(workspace_id, normalized_query) DO UPDATE`) under the **same BEGIN IMMEDIATE**. Preserve the `db.inTransaction` NO-OP nesting guard.

**Compatibility read:** `getTrackedKeywords(includeInactive?)` keeps its signature; the active filter becomes `WHERE status='active' OR status IS NULL`.

**Consumers:** ~13 read modules + 7 writer modules (enumerated in Dimension C). Reconciliation is the hardest (full-set replace → must compute deletions). `migrate-json.ts:1003-1026` is the hidden raw-column writer. The `pr-check` bare-RMW rule + `withTrackedKeywordsTxn` doc comment + `docs/rules/keyword-surface-consolidation.md` must be updated in the migration PR.

---

## Provenance (#6/#7)

**Pointer-persist design:** add `sourcePageId?: string` + `sourceGapKey?: string` to `TrackedKeyword` (`shared/types/rank-tracking.ts:27-47`) FIRST, then `trackedKeywordSchema` (`.optional()`), `AddTrackedKeywordOptions`, and the row table. Keys: `sourceGapKey = keywordComparisonKey(target_keyword)` (stable — `content_gaps` PK); `sourcePageId =` the `page_keywords` PK / normalized pagePath (NOT mutable `pagePath`). Persist additively at the 5 write paths with **fill-if-empty** semantics (mirror `addTrackedKeywordToConfig` adopt/keep rules). `sourcePageId`/`sourceGapKey` are **admin-only** — do NOT add to the public client whitelist.

**Laundering fix:** make `trackedKeywordSourceForFeedback` return `CLIENT_REQUESTED` for `page_map`/`topic_cluster` (or record approval-origin separately) so a client/admin approval is never auto-deprecatable. Introduce an explicit `strategyOwned` boolean; `reconcileStrategyRankTracking` + `protectedReason` read the flag, not the source enum. The WS-broadcast `source` field is a different axis — **rename to `origin`/`trigger`, do not collapse**.

**`inferTrackedKeywordSources` retirement path:** keep as a read-time fallback ONLY until the #12 backfill stamps + verifies real sources. The backfill must run `inferTrackedKeywordSources` **ONCE** to stamp persisted source (it can't recover MANUAL/RECOMMENDATION — leave those UNKNOWN explicitly, never guess). Then delete the function at all 3 call sites (`1153`/`1297`/`2102`) in **one change**. Grep CLAUDE.md/docs/rules for references when removing (retire-a-public-function rule).

---

## SAFE MIGRATION ORDER + recommended PR split

All five lanes independently converge on a **5-PR phase-per-PR split**, so each migration is isolated and revertable without entangling the assembler or provenance work.

| PR | Scope | Migration risk | Touches persist txn? | Touches read paths? | Touches reconcile? | Required tests |
|---|---|---|---|---|---|---|
| **3a** | `assembleStoredKeywordStrategy` — **pure extraction** onto the existing read paths (NO migration, NO strip; keep the table-or-blob fallback). Swap one consumer per commit. | **none** | no | yes (all 5) | no | `GET /api/public/seo-strategy/:id` byte-identity (assert `backfilled` + 17 fields) + admin fixture test |
| **3b** | #19b normalize `siteKeywordMetrics` — mig 117 + table + mappers + CAS boot-strip + public-whitelist update + Zod stays `.optional()`. Cut blob write (`persistence:102`) AND `existingStrategy` source (`generation:307`) **together**. Rewire ~20 readers incl. reconcile join (`:72`). | **medium** | yes (replaceAll add) | yes (public:185) | yes (buildTargets join) | public-read test (metrics survives) + reconcile baseline test (volume/difficulty still attach) |
| **3c** | #12 `tracked_keywords` row table — mig 118 + store module (`rowToTrackedKeyword`, diff upsert/delete, `listTrackedKeywordRows`, `migrateTrackedKeywordsFromConfigBlob` running `inferTrackedKeywordSources` once). **Dual-read first** (read still blob), owner-reviews staging backfill, THEN a follow-up strips. | **high** | no | yes (all consumers) | yes (full-set replace) | rewritten `tracked-keywords-concurrency.test.ts` (T1a/b/c on the row store) + CASCADE test + public-read shape test |
| **3d** | #6/#7 provenance pointers `sourcePageId`/`sourceGapKey` + retire `inferTrackedKeywordSources` (3 sites in lockstep) + stop feedback laundering + rename WS-broadcast `source`→`origin`. Depends on 3c's persisted source. | **medium** (behavior change) | no | yes (KCC ×3) | yes (`isStrategyOwned`/`protectedReason`) | named fixture (laundered keywords not auto-deprecated) + KCC `IN_STRATEGY` count test |
| **3e** | #18 `strategy_history` typed + FK (table-rebuild, orphan-cleanup first) + #20 diff-based persist upserts (preserve `.immediate()`, reads-before-writes, page_keywords COALESCE/`backfilled` metadata). | **medium** | **yes** (#20) | no | no | concurrent-writer test (no SQLITE_BUSY_SNAPSHOT) + #18 CASCADE/fresh-DB + diff route shape test |

**Invariants to honor on every PR:**
- **Backfill-before-assembler / backfill-before-strip**: never strip a blob (or remove a read-path ternary) before its table is populated for ALL workspaces and verified on staging. Never combine table-create + blob-strip + remove-fallback in one PR.
- **One consumer per PR** for the assembler swap; riskiest (public) last.
- **Never revert IMMEDIATE** (`persistence.ts:191`, `withTrackedKeywordsTxn`) — Wave-1 SQLITE_BUSY_SNAPSHOT fix (PR#1030). #20 optimizes lock-HOLD inside the same IMMEDIATE.
- **DB-column + mapper lockstep**: every new column = migration SQL + Row interface + `rowToX()` + `upsertX()` write + (if client-facing) public whitelist + client shared type + Zod schema, ALL in one commit.
- **Schema-vs-stored-shape**: the **single highest silent-data-loss risk** is stripping a blob field whose Zod field is not `.optional()`. Gate every strip on confirming `.optional()` first (`workspace-schemas.ts`).
- **Never #1+#12 in one PR; #1 before #12; #2 before #12** (plan §11).
- **`recommendations.ts` excluded** from the #2 assembler in Wave 3 (or dead-last with flag-OFF byte-identity) — seo-gen-quality canary surface.

---

## Infrastructure recommendations

- **Shared assembler:** create `server/keyword-strategy-assembler.ts` exporting `assembleStoredKeywordStrategy(workspaceId)`; define `StoredKeywordStrategy` in `shared/types/` before implementation. This is the one seam that collapses the admin↔public fallback asymmetry and fixes the latent `seo-context-slice` empty-arrays bug.
- **New stores (content-gaps.ts:1-251 is the canonical template):** `tracked_keywords` (#12) and `site_keyword_metrics` (#19b) each need Row interface + `rowToModel`/`modelToParams` + `replaceAll`/`list`/`upsert` + CAS-guarded `migrateFromJsonBlob` boot step registered in `server/index.ts:46-68`. Harden `content-gaps.ts:214-251` boot migration to the CAS pattern the other 4 already use.
- **pr-check rules** (`scripts/pr-check.ts` CHECKS array): (1) ban bare `tracked_keywords` RMW outside the txn helper (re-author the existing `readConfig`/`writeConfig` customCheck); (2) require `keywordComparisonKey` for keyword equality; (3) ban new strategy blob+table reassembly outside `assembleStoredKeywordStrategy`. Run `npm run rules:generate`; bump the rule count in CLAUDE.md (currently ~165).
- **Tests:** templates exist — `seo-genquality-p2-backfilled-public-read.test.ts` (public-read byte-identity for #2/#19b), `tracked-keywords-concurrency.test.ts` port 13886 (rewrite for #12, do not delete), `migration-data-preservation.test.ts` (CASCADE + `PRAGMA table_info` for #18 FK + new-column assertions).
- **Next migration number = 117** (verified: max existing `116-tracked-action-predicted-emv.sql`; 117/118 absent). 3b uses 117; 3c uses 118.
- **Next free integration port = 13888** (max used 13887; **13886 is reserved** for the concurrency test). Budget 13888–13895 for the 3b–3e PR test files.
- **Pre-commit hygiene:** kill orphan 13xxx ports before commit/push (asset-dashboard test-ports memory) or the pre-commit hook flakes.