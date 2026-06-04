# Keyword Surface Consolidation — Wave 3 (server data-model)

> Contract + test-centric (per `PLAN_WRITING_GUIDE.md`). Exhaustive scope: `docs/superpowers/audits/2026-06-03-keyword-consolidation-wave3-audit.md` (5 read paths / ~8 call sites, the migration surface, hazards). Branch `feat/keyword-consolidation-wave3` off staging (Waves 1/2/2b shipped). **The riskiest wave — real DB migrations.**

**Goal:** one `assembleStoredKeywordStrategy` (table-as-truth), `tracked_keywords` → row table, provenance pointers, `siteKeywordMetrics` normalized, `strategy_history` typed+FK, persist lock-hold shrunk — without data loss.

## Hard invariants (every PR)
- **Backfill-before-strip:** never strip a blob array / remove a read-path `length>0?table:blob` fallback until its table is populated for ALL workspaces and **verified on staging** (owner-gate). Never combine table-create + blob-strip + remove-fallback in one PR.
- **One consumer per PR/commit** for the assembler swap; **public read path last**.
- **Never revert `IMMEDIATE`** (`keyword-strategy-persistence.ts:191`, `withTrackedKeywordsTxn`) — the PR#1030 SQLITE_BUSY_SNAPSHOT fix. #20 optimizes lock-HOLD *inside* the same IMMEDIATE; reads-before-writes is load-bearing.
- **DB-column + mapper lockstep:** new column = migration SQL + Row interface + `rowToX()` + `upsertX()` + (client-facing → public whitelist + client type) + Zod, all one commit.
- **Schema-vs-stored-shape (highest silent-data-loss risk):** gate every blob strip on the field being `.optional()`/`.passthrough()` in `workspace-schemas.ts` first.
- **`#1` (done) before `#12`; `#2` before `#12`; never `#1`+`#12` in one PR.**
- **`recommendations.ts` excluded** from the #2 swap in Wave 3 (seo-gen-quality canary surface) — or dead-last with a flag-OFF byte-identity test.
- **Public-read test on every strip/swap:** exercise `GET /api/public/seo-strategy/:id` (the real read path), asserting byte-identity + `backfilled` survival — not just the admin GET.
- Kill orphan 13xxx ports before commit. Next migration = **117**; next free port = **13888** (13886 reserved).

## PR split (5 PRs, phase-per-PR, each its own review + CI + staging merge)

### 3a — `assembleStoredKeywordStrategy` (PURE EXTRACTION, no migration) — risk: none
**Contract:** define `StoredKeywordStrategy` in `shared/types/keyword-strategy.ts` FIRST (the full internal shape: siteKeywords/opportunities/siteKeywordMetrics?/pageMap/contentGaps/quickWins/keywordGaps/topicClusters/cannibalization). Create `server/keyword-strategy-assembler.ts:assembleStoredKeywordStrategy(workspaceId): StoredKeywordStrategy | null` — **table-as-truth, but KEEP the table-or-blob fallback baked in** (so legacy un-migrated workspaces don't lose data before the later strip PRs). Returns `null` on the existing short-circuit (no blob + all tables empty). The assembler returns the **full internal shape**; routes keep their own whitelist projection (`public-content.ts:183-265`) + `strategyUx` + `computeOpportunityScore` defaults — do NOT move those in.
**Consumer swap (one per commit, riskiest last):** (1) `intelligence/seo-context-slice.ts:28-99` (restores parity — it currently skips 4 tables, a latent AI-context bug; keep degradation-safe), (2) the 4 KCC sites (`keyword-command-center.ts:1139/1261/1868/2056`), (3) `routes/keyword-strategy.ts:212-263` (admin; delete `serializeKeywordStrategy`'s re-strip once the assembler owns it), (4) **`routes/public-content.ts:125-269` LAST** (public). `recommendations.ts` NOT swapped this wave.
**Tests:** `GET /api/public/seo-strategy/:id` byte-identity (assert `backfilled` + the 17 whitelisted gap fields survive) — model on `tests/integration/seo-genquality-p2-backfilled-public-read.test.ts`; admin fixture test; the seo-context-slice now returns the 4 previously-empty tables.
**pr-check:** add a rule banning new strategy blob+table reassembly outside `assembleStoredKeywordStrategy` (forward-looking).

### 3b — normalize `siteKeywordMetrics` out of the blob (#19b) — risk: medium (migration)
Migration 117 + `site_keyword_metrics` store (Row + `rowToModel`/`modelToParams` + `replaceAll`/`list` + **CAS-guarded** `migrateFromJsonBlob` boot step in `server/index.ts`, template `content-gaps.ts`). **Cut the blob write (`keyword-strategy-persistence.ts:102`) AND the generation `existingStrategy?.siteKeywordMetrics` source (`keyword-strategy-generation.ts:307`) TOGETHER** (the closed-loop hazard — else metrics vanish on the next incremental run). Rewire ~20 readers incl. the **reconcile join** (`rank-tracking-reconciliation.ts:72`, joins metrics to siteKeywords by `normalizeQuery`) + the public whitelist (`public-content.ts:185`). Zod stays `.optional()`. **Owner-gate the staging backfill before the strip.** Tests: public-read (metrics survives) + reconcile-baseline (volume/difficulty still attach).

### 3c — `tracked_keywords` blob → row table (#12) — risk: high (migration)
Migration 118 + the row table (schema in the audit: PK `(workspace_id, normalized_query)`, FK CASCADE, lifecycle + provenance columns). New store: `rowToTrackedKeyword` (NULL→`undefined` for byte-identity), the diff upsert/delete **inside `withTrackedKeywordsTxn`** (keep its signature + the `db.inTransaction` nesting guard — all writers untouched at call sites), `migrateTrackedKeywordsFromConfigBlob` (runs `inferTrackedKeywordSources` ONCE to stamp source; leave MANUAL/RECOMMENDATION UNKNOWN, never guess). **Dual-read first** (read still falls back to blob), **owner-reviews the staging backfill, THEN a follow-up strips the blob.** Reconciliation (full-set replace → compute deletions) is the hardest consumer; `migrate-json.ts:1003-1026` is the hidden raw writer. Re-author the bare-`tracked_keywords`-RMW pr-check rule. Tests: **rewrite** `tracked-keywords-concurrency.test.ts` (T1a/b/c on the row store — do NOT delete; #12 changes T1a's single-blob-row premise) + CASCADE + public-read shape.

### 3d — provenance pointers + retire `inferTrackedKeywordSources` (#6/#7) — risk: medium (behavior)
Add `sourcePageId?`/`sourceGapKey?` to `TrackedKeyword` + Zod (`.optional()`) + the row table (`sourceGapKey = keywordComparisonKey(target_keyword)`; `sourcePageId =` page_keywords PK, NOT mutable pagePath). Persist additively at the 5 write paths (fill-if-empty). **Stop the laundering:** `trackedKeywordSourceForFeedback` returns `CLIENT_REQUESTED` for page_map/topic_cluster (or record approval-origin separately); introduce an explicit `strategyOwned` boolean that `reconcileStrategyRankTracking`/`protectedReason` read **instead of the source enum**; rename the WS-broadcast `source`→`origin` (different axis). Retire `inferTrackedKeywordSources` at all 3 KCC sites in ONE change (after 3c's backfill stamps source). `sourcePageId`/`sourceGapKey` are admin-only (NOT in the public whitelist). Tests: laundered keywords not auto-deprecated; KCC `IN_STRATEGY` count.

### 3e — `strategy_history` typed+FK (#18) + diff-based persist upserts (#20) — risk: medium
#18: typed schema + validated read (not `parseJsonFallback`) + `FK … ON DELETE CASCADE` via a **table-rebuild** (SQLite can't `ALTER ADD FK`) inside `runMigrations`' FK-OFF txn, with an **orphan-cleanup DELETE first** (mig-019 pattern). #20: diff-based upserts over delete-all+reinsert to shrink the persist lock-hold — **preserve `.immediate()`, reads-before-writes, and the page_keywords COALESCE/`created_at`/`sort_order`/`backfilled` metadata-preservation rule.** Tests: concurrent-writer (no SQLITE_BUSY_SNAPSHOT) + #18 CASCADE/fresh-DB + diff-route shape.

## pr-check rules (across the wave)
(1) ban bare `tracked_keywords` RMW outside `withTrackedKeywordsTxn`; (2) require `keywordComparisonKey` for keyword equality; (3) ban new strategy blob+table reassembly outside `assembleStoredKeywordStrategy`. `npm run rules:generate`; bump CLAUDE.md count.

## Verification (per PR)
`npm run typecheck && npx vite build && npx vitest run && npx tsx scripts/pr-check.ts && npm run verify:feature-flags && npm run verify:coverage-ratchet` + the migration's fresh-DB/CASCADE tests + the public-read test. Whole-PR adversarial review before merge.
