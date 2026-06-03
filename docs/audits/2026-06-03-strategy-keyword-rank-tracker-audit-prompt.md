# MASTER AUDIT PROMPT — Strategy + Keywords + Rank Tracker (UI/UX + Architecture)

> **Run mode:** READ-ONLY audit of `/Users/joshuahampson/CascadeProjects/asset-dashboard` (hmpsn.studio — React 19 client + Express/TS server + SQLite). **Do NOT edit any file.** Every finding MUST cite `file:line`. This prompt is self-contained; the grounded surface/data/handoff lists below are authoritative — treat them as the coverage checklist, not as exhaustive proof. Verify each cited location before asserting a finding.

## 1. OBJECTIVE

Audit the **entire** strategy + keywords + rank-tracker functionality (admin and client) and produce a ranked findings register plus a prioritized improvement plan. The owner's six goals — every finding must map to at least one:

1. **Remove duplicates** — especially the multiple keyword/rank "tables" and repeated displays of the same data.
2. **Fix strange / inconsistent UI/UX** — presentation, terminology, formatting, empty/loading states, sort/filter conventions.
3. **Clarify how the Keywords page and the Rank Tracker page work with one another** — overlap, handoff, redundancy, and user confusion. Treat this as a first-class dimension.
4. **Platform stability** — heavy per-request generation, blob parse/RMW cost, copy-pasted read paths that can silently diverge, un-normalized join keys, race conditions.
5. **Make it easier to recognize gaps + decide what to focus on next** — discoverability, single-source-of-truth views, and a clear "what's missing / what's next" signal.
6. **Level up the platform + strategy generation overall** — coherence of the generation pipeline, the data model, and the surfaces it feeds.

**Deliverable framing:** this audit is an inventory-grounded *evaluation + plan*, NOT a from-scratch rebuild. Recommend a rebuild of any sub-system **only** with an explicit cost/benefit justification.

**Respect the dark launch:** a large SEO generation-quality rebuild (P0-P5) and a local-SEO track (P7) shipped behind the `seo-generation-quality` flag (keyword universe, content_gaps / keyword_gaps / topic_clusters / cannibalization recs, OV scoring, local rec types). Do not flag flagged-but-incomplete behavior as a defect; instead note where the new work *increases* duplication or terminology drift and where consolidation must preserve flag boundaries.

---

## 2. GROUNDED SCOPE — coverage checklist (every surface + data source MUST be touched)

Mark each item COVERED / NOT-APPLICABLE with a one-line note. Do not omit any.

### 2A. Admin UI surfaces
- [ ] `src/App.tsx:435-465` — page→component routing (`seo-strategy`, `seo-keywords`, `page-intelligence`, `seo-ranks`)
- [ ] `src/components/KeywordCommandCenter.tsx` — "Keywords" (canonical operating list); hand-rolled grid via `src/components/keyword-command-center/VariantSubRow.tsx:6` + `KeywordRow.tsx`, 19 filter chips, 5 StatCards. Subtitle/positioning copy at `KeywordCommandCenter.tsx:363`; `view_rankings` deep-link handling at `:252-255`
- [ ] `src/components/KeywordStrategy.tsx` (`KeywordStrategyPanel`) — ~12 sub-cards; Site Target Keywords badges (`:782-812`), Keyword Opportunities text list (`:816-831`), Ranking Distribution / Search Intent Mix (`:700-734`), `VOLUME_THRESHOLD` at `:34`, `trackKeyword()` at `:219-231`, track button `:799-807`
- [ ] `src/components/RankTracker.tsx` — hand-rolled rank grid (`~:478`), inline position-color (`~:520`), `Strategy`/`Client` source badges (`~:510`), disambiguation banner (`:380-384`), empty state pointing back to Strategy (`:566`), local `expandedQuery` state only (`:169`) — confirms NO `useSearchParams`/`location.state`
- [ ] `src/components/PageIntelligence.tsx` + `src/components/page-intelligence/*` — `PageIntelligencePageRow.tsx`, `pageIntelligenceDisplay.ts` (`positionColor`/`kdColor`), `PageIntelligenceTrackKeywordButton`, `LocalSeoVisibilityBadge`
- [ ] `src/components/workspace-home/RankingsSnapshot.tsx:43` — "Top Rankings" divide-y rows (4th rank style)
- [ ] `src/components/strategy/ContentGaps.tsx` — content_gaps cards (`opportunityScore/100`)
- [ ] `src/components/strategy/KeywordGaps.tsx` — "Raw Competitor Evidence" flex rows
- [ ] `src/components/strategy/LowHangingFruit.tsx` — pages #4–20 flex rows
- [ ] `src/components/strategy/TopicClusters.tsx` — coverage% signature card
- [ ] `src/components/strategy/QuickWins.tsx` — quick-win rows
- [ ] `src/components/strategy/CannibalizationAlert.tsx` — items + action chips (used by `KeywordStrategy.tsx:22`)
- [ ] `src/components/strategy/StrategyDiff.tsx` — added/lost/reassigned diff
- [ ] `src/components/admin/CannibalizationAlert.tsx` — warnings + tier (used by `ContentPipeline.tsx:11`) — **second cannibalization component**
- [ ] `src/components/local-seo/LocalSeoVisibilityPanel.tsx` — modes `strategy`/`keywords`/`page`; exports `LocalSeoVisibilityBadge` (the model for good cross-surface sharing)
- [ ] `src/components/layout/Sidebar.tsx:67,81,82` + `src/components/layout/Breadcrumbs.tsx:9-11` + `src/routes.ts:7` — nav grouping (Strategy + Keywords under "SEO STRATEGY"; Rank Tracker under "MONITORING")

### 2B. Client UI surfaces
- [ ] `src/components/client/ClientDashboard.tsx:743,753` — tab routing (`strategy`, `performance`, `inbox`, Overview)
- [ ] `src/components/client/StrategyTab.tsx` + `src/components/client/strategy/*` — `StrategyKeywordsSection.tsx` (dot-list rows; format `:31-36`; sort by `opportunityScore` desc `:65`), `StrategyContentOpportunitiesSection.tsx` (`ContentGapCard` `:93`), `StrategyPageKeywordMapSection.tsx`, plus Business Priorities / Declined Keywords / Keyword Drawer / Next Steps / Page Improvements / Refresh Summary / Snapshot sections
- [ ] `src/components/client/SearchTab.tsx` — own `<table>` (`:197`) AND `RankTrackingSection` (`:150`); Low-Hanging Fruit / Top Performers / CTR Opportunities / Visibility-Without-Clicks cards
- [ ] `src/components/client/PageKeywordMapContent.tsx` — shared by StrategyPageKeywordMapSection + InboxTab; local `positionColor`/`positionTone` (`:69`)
- [ ] `src/components/client/InsightsEngine.tsx` — rec feed, `keyword_gap`→`seo-strategy` deep links
- [ ] `src/components/client/Briefing/RecommendedForYou.tsx` + `InsightsBriefingPage.tsx` — briefing rec rows
- [ ] `src/components/client/PerformanceTab.tsx:114-138` — Search/Analytics sub-tabs
- [ ] `src/components/shared/RankTable.tsx` — canonical primitive (`RankTable` `:79`, `RankTrackingSection` `:136`, `RankHistoryChart`, `RankChange`, exported `positionColor` `:6`)

### 2C. Orphaned / dead surfaces (triage: remove, wire, or account for)
- [ ] `src/components/KeywordAnalysis.tsx` (~27KB / 551 LOC) — zero imports in `src`/`server`; has its own `PageHeader title="Keyword Analysis"`. **Confirm dead, recommend disposition.**
- [ ] `src/components/strategy/PageKeywordMap.tsx` (~17KB) — orphaned admin analog of client `PageKeywordMapContent.tsx` (inline-editable + `SeoCopyPanel`); same `PageKeywordMap` interface re-declared. **Confirm dead.**
- [ ] `src/components/client/FixRecommendations.tsx` (~32KB) — referenced only in `tests/component/.../FixRecommendations.test.tsx`; no production mount. **Confirm effectively dead.**

### 2D. Server data sources, generation, read paths, handoff
- [ ] **Persistence:** `workspaces.keywordStrategy` blob (`server/keyword-strategy-persistence.ts:93-117,170`); `page_keywords` (`server/page-keywords.ts`, mig 024/051); `content_gaps` (`server/content-gaps.ts`, mig 086/115); `quick_wins` (087); `keyword_gaps` (088); `topic_clusters` (089); `cannibalization_issues` (090/094); `rank_tracking_config.tracked_keywords` JSON blob (`server/rank-tracking.ts:60-165`, mig 003:193); `rank_snapshots` (003:199); `strategy_history` (030, baked blob `:154-167`); `keyword_feedback` (020/029); `keyword_metrics_cache` (025); `content_gap_votes` (021); recommendations set (`server/recommendations.ts:418,1124`); local-SEO tables (096/098/101, `server/local-seo.ts`)
- [ ] **Generation (write):** `server/keyword-strategy-generation.ts`; `server/keyword-strategy-universe.ts:218` (`buildKeywordUniverse`, reads `getTrackedKeywords` `:420`); `-ai-synthesis.ts`, `-enrichment.ts`, `-seo-data.ts`, `-pages.ts`, `-sanitizer.ts`; `server/keyword-intelligence/rules.ts` (admission funnel); provider layer `server/seo-data-provider.ts` → `server/providers/{dataforseo,semrush,fake}-provider.ts`, `server/provider-keyword-metrics.ts`; persist `server/keyword-strategy-persistence.ts:52` (one `BEGIN IMMEDIATE` txn `:183-191`)
- [ ] **Triple blob+table reassembly (the central duplication):** admin `server/routes/keyword-strategy.ts:212-264`; client `server/routes/public-content.ts:125-260`; Command Center `server/keyword-command-center.ts:1139-1145,1261-1298,1868-1872,2087-2099`. Verify each `table.length>0 ? table : blob` fallback and the lack of a shared assembler.
- [ ] **Other consumers:** `server/recommendations.ts:25-40,1170,1226,1438,1494,1580,1713,1769,1937`; `server/admin-chat-context.ts`, `server/keyword-strategy-ux.ts`, `server/keyword-strategy-ai-synthesis.ts`, `server/local-seo.ts` (all call `getTrackedKeywords`)
- [ ] **Routes:** `server/app.ts:297-347`; `server/routes/keyword-strategy.ts` (incl. diff `:297-329`, feedback→track `:564-608`); `server/routes/rank-tracking.ts:55-58,100,129-139`; `server/routes/keyword-command-center.ts`; `server/routes/recommendations.ts:70,80` (**unauthenticated public route** — `public-no-auth-ok`, deferred to `audit-drift-public-route-auth-sweep-followup`); `server/routes/public-content.ts:125`; `server/routes/public-portal.ts:334-615`
- [ ] **Handoff engine:** `server/rank-tracking-reconciliation.ts:60-138,185-201` (`reconcileStrategyRankTracking`, auto-deprecate/replace unless pinned); `server/keyword-strategy-follow-ons.ts:35,51-62` (`seedKeywordStrategyTrackedKeywords`); `server/keyword-feedback.ts:19-20,169,213` (approve→`addTrackedKeyword(s)`); `server/keyword-command-center.ts:2338-2348,2350-2379,2407` (TRACK→MANUAL `:2344`, PROMOTE_EVIDENCE→RECOMMENDATION, lifecycle actions); `server/rank-tracking-scheduler.ts:33-55` (daily snapshot cron); `getLatestRanks` active-filter (`server/rank-tracking.ts:349,355-356`)
- [ ] **Contracts / shared types:** `docs/rules/keyword-command-center.md` (surface boundaries: Command Center = lifecycle, Rank Tracker = measurement-only, Strategy = generation), `docs/rules/seo-generation-quality.md`, `docs/rules/local-seo-visibility.md`, `shared/keyword-normalization.ts` (`keywordComparisonKey`), `shared/types/{keyword-command-center,rank-tracking,keyword-strategy-ux,keyword-strategy}.ts`
- [ ] **Client API + query keys:** `src/api/{seo,keywordCommandCenter,misc}.ts` (`misc.ts:169` recommendations), `src/hooks/admin/useKeywordCommandCenter.ts`, `src/lib/queryKeys.ts:93` (the two query keys `rankTrackingKeywordRows` vs `rankTrackingKeywords` for one endpoint; see `RankTracker.tsx:172`, `KeywordStrategy.tsx:111`)

---

## 3. AUDIT DIMENSIONS (score every covered surface 1–5 on each; cite evidence)

1. **Duplication** — same data rendered/computed by ≥2 implementations; bypassing a shared primitive. Anchor cases to verify: D1 (≥4 hand-rolled rank/keyword tables vs `shared/RankTable.tsx`), D2 (two `CannibalizationAlert`), D3 (content-gaps rendered twice), D4 (`positionColor` reimplemented ≥4×), D5 (page→keyword map two ways). Server: triple blob+table reassembly; recommendations re-deriving strategy logic.
2. **UX consistency** — keyword-row presentation (U1), volume/difficulty formats `1.2k/mo · KD 45` vs `1,234/mo · KD 45%` vs `45/100` (U2), source/provenance badges (U3), empty/loading primitives (U4), sort/filter defaults (U6).
3. **Data-source coherence** — number of stores for "this workspace's keywords" (blob `siteKeywords`/`siteKeywordMetrics`, `page_keywords`, `tracked_keywords` blob, `keyword_gaps`); the three `contentGaps` forms; baked-blob vs live-table diff shapes; reconciliation by string-equality only (no FK).
4. **Stability** — heavy auto-generate-on-GET (`recommendations.ts` ~130KB/2400+ LOC; `keyword-command-center.ts` ~107KB; OOM guard / `listPageKeywordsLite` vs `listPageKeywords` at `:1141`); full-blob parse+Zod per tracked-keyword read; full-array RMW on every tracked-keyword mutation (`rank-tracking.ts:187-195`); copy-paste drift across the 3 read paths; reconciliation×manual-edit race on the same blob; unauthenticated public recommendations route.
5. **Discoverability / gap-recognition** — can a user tell which page to use for what? Is there a single source-of-truth tracked-keyword view? Does the UI explain auto-deprecation? Is there a clear "what's missing / what to focus on next" signal across Strategy/Keywords/Rank Tracker/Recommendations?
6. **Terminology** — provenance vocabulary (Strategy/Client/lifecycle/role-dots/source enum), rank-vs-local-visibility split (the RankTracker disambiguation banner is itself evidence of confusion), positioning copy that has three surfaces each gesturing at the others with no authoritative division of labor.
7. **(First-class) Keywords ↔ Rank Tracker relationship** — the four write paths into `TrackedKeyword` and their inconsistent source tags; the missing keyword-level deep-link (KCC `view_rankings` → unfiltered Rank Tracker); nav-group split; snapshot-scope vs tracked-scope mismatch; invisible/destructive auto-deprecation; `TrackedKeyword` as the un-normalized join key.

---

## 4. METHOD (structured for multi-agent fan-out)

Run as parallel lanes, then a single synthesis pass. Each lane returns findings in the Section-5 schema with `file:line` evidence.

- **Lane A — Admin keyword/rank surfaces** (2A + 2C orphans): inventory render styles, map each to its data hook/endpoint, catalog duplication (D1/D2/D4/D5) and UX inconsistencies (U1–U6).
- **Lane B — Client keyword/rank surfaces** (2B): same, plus admin↔client duplicate pairs (D3 content-gaps; client vs admin PageKeywordMap; client vs admin ContentGaps).
- **Lane C — Server data model + read paths** (2D persistence + triple reassembly + generation): map every store, prove the 3 copy-pasted reassemblies, list overlapping models, flag normalization violations.
- **Lane D — Keywords ↔ Rank Tracker handoff** (2D handoff + dimension 7): trace all four write paths, the deep-link gap, reconciliation auto-deprecation, snapshot-vs-tracked mismatch, query-key duplication.
- **Lane E — Stability + recommendations engine**: per-request cost, OOM guards, blob RMW, auth gap, recommendations re-deriving strategy logic.

**Per-lane steps:** (1) inventory the surfaces/sources; (2) map the data flow store→route→hook→component; (3) find duplication/inconsistency; (4) score against the dimensions; (5) **adversarially verify** every finding by re-opening the cited `file:line` and confirming the claim (especially "orphan" / "dead" claims — confirm zero production imports — and "duplicate" claims — confirm the two implementations truly diverge). Discard or downgrade anything that does not survive verification.

**Synthesis pass:** merge lanes, dedupe overlapping findings, rank by severity×reach, then produce Section 5 outputs.

---

## 5. REQUIRED OUTPUT

### 5.1 Findings register (ranked)
A table ordered by severity (Critical / High / Medium / Low), each row:

| # | Surface(s) (file:line) | Dimension(s) | Severity | The duplicate / inconsistency / risk (evidence) | Concrete recommendation | Consolidation risk |
|---|---|---|---|---|---|---|

Severity rubric: **Critical** = data divergence / instability that can mislead a user or break per-request; **High** = clear duplication or confusion across primary surfaces; **Medium** = local inconsistency; **Low** = cosmetic. Every row must cite verified `file:line` and map to ≥1 owner goal.

### 5.2 Prioritized improvement plan
Not a from-scratch rebuild unless justified. Must include:

1. **Consolidation targets** — collapse the ≥4 rank/keyword tables onto a single canonical primitive (extend `shared/RankTable.tsx` and/or a new shared keyword-row), unify the two `CannibalizationAlert`s, the two content-gaps renderers, the duplicate `positionColor`, and the duplicate page→keyword maps. For each: the canonical component to keep, what to delete/migrate, and the risk.
2. **A single canonical keyword-table / component** — define the one keyword-row primitive + one provenance vocabulary + one volume/difficulty format + one empty/loading state, and list every call site to migrate.
3. **The keywords ↔ rank-tracker model** — propose the authoritative division of labor (per `docs/rules/keyword-command-center.md`), a keyword-level deep-link (KCC→Rank Tracker with the keyword pre-selected, honoring the `?tab=` two-halves contract), nav-grouping fix, a single source-of-truth tracked-keyword view, and UI for auto-deprecation transparency.
4. **Server consolidation** — one shared blob+table assembler to replace the three copy-pasted reassemblies; a decision on normalizing `tracked_keywords` out of the JSON blob (with migration risk); reducing recommendations' re-derivation of strategy logic.
5. **Stability fixes** — auto-generate-on-GET cost, blob RMW/parse, the unauthenticated public recommendations route, reconciliation×edit race.
6. **Orphan disposition** — remove/wire/account for `KeywordAnalysis.tsx`, `strategy/PageKeywordMap.tsx`, `client/FixRecommendations.tsx`.
7. **Next-focus signal** — a concrete proposal for how the platform should surface "what's missing / what to do next" across Strategy/Keywords/Rank Tracker/Recommendations so the owner can recognize gaps and prioritize.

Sequence the plan in waves (quick wins → shared primitives → data-model consolidation → relationship/UX redesign), noting dependencies and what must ship behind / preserve the `seo-generation-quality` flag boundaries.

### 5.3 Coverage attestation
Reproduce the Section-2 checklist with COVERED / N-A per item, so no surface or data source was skipped.

---

## 6. GUARDRAILS
- **Read-only.** Make no edits; this run audits and plans only.
- **Cite `file:line`** for every claim; adversarially re-verify before asserting (especially dead-code and duplicate claims).
- **Flag risky consolidations** explicitly — anything touching the single `BEGIN IMMEDIATE` persist txn, the tracked-keyword blob RMW, the reconciliation auto-deprecation, or the three read paths must call out divergence/regression risk and a safe migration order.
- **Respect the dark launch.** Do not report flagged-incomplete `seo-generation-quality` (P0-P5) / local-SEO (P7) behavior as defects; preserve flag boundaries in every recommendation.
- **No rebuild by default.** Prefer consolidation onto existing canonical primitives; justify any rebuild with cost/benefit.
- **Honor existing contracts** in `docs/rules/keyword-command-center.md`, `docs/rules/seo-generation-quality.md`, `docs/rules/local-seo-visibility.md`, and the codebase's "normalize large repeated arrays out of JSON columns" rule (CLAUDE.md) — cite where current code violates them.