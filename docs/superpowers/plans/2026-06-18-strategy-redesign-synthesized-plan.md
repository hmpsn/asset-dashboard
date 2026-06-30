# Strategy Page Redesign (redesign-of-the-redesign) — SYNTHESIZED IMPLEMENTATION PLAN

> **Status:** locked design + phased plan — ready for `writing-plans` task-level expansion.
> **Date:** 2026-06-18
> **Base spec:** Team **unison** (tournament winner, avg 42.7/50) — `docs/superpowers/specs/2026-06-18-strategy-redesign-team-unison.md`
> **Grafts:** strongest judge-flagged ideas from eng-led (41.7), design-led (41.3), pm-led (38.3). Each graft is attributed inline with **[GRAFT: team]**.
> **Flag:** existing `strategy-command-center` (no new umbrella flag) + narrow child flags per phase.
> **Branch base:** continues the v3 line (cockpit + lifecycle already merged to staging behind the flag).
> **Companion contracts:** `docs/rules/strategy-recommendations.md`, `docs/rules/data-flow.md`, `docs/rules/route-removal-checklist.md`, `docs/superpowers/specs/2026-06-18-strategy-v3-curation-cockpit-design.md`.

---

## 0. Why this plan exists + what changed from the winning spec

Strategy v3 (Phases 0–3) built a real **recommendation curation cockpit + two-axis lifecycle engine** behind `strategy-command-center`, but left the visible information architecture untouched. The operator's verdict: *"nothing looks different; keyword stuff never moved; What Changed never moved up."* This is a **product failure expressed through the IA layer** — the engine is good and invisible. This plan fixes the IA + usability layer **on top of** the cockpit; we do not rebuild the cockpit.

The unison spec is the base. This plan applies **six grafts** the judge panel flagged from the runners-up, each of which materially improves the base. Two of them **override** a unison decision because a codebase fact verified during this synthesis pass proves the base was wrong on storage:

### Verified codebase facts that drive the grafts (checked this session)

| Fact | File:line | Consequence |
|---|---|---|
| `tracked_keywords` IS delete-then-reinserted on the rank-tracking sync path. `replaceAllTrackedKeywordRows()` runs `DELETE FROM tracked_keywords WHERE workspace_id = ?` then re-inserts rows from `keywordToParams()` — a **fixed column list** that would NOT carry a new curation column. | `server/tracked-keywords-store.ts:184` (deleteAll), `:282` (replaceAll), called from `server/rank-tracking.ts:235` | **Unison's "extend `tracked_keywords` with `curated_set_position`" is UNSAFE** — the column is clobbered to NULL on every rank-tracking sync. **OVERRIDE with the dedicated-table graft.** |
| `CannibalizationTriage` infers durable resolution from `tracked_actions`, not the regenerable `cannibalization_issues` row. | `src/components/strategy/CannibalizationTriage.tsx:84-94` | The proven precedent for any "keep"/"resolved" flag on a delete-then-reinsert managed set. **Reuse for Topic Clusters + Content Gaps keeps.** |
| `sendRecommendation()` + `REC_POLICY_REGISTRY` exist; `keyword_gap`/`topic_cluster`/`content_refresh` are already `sendChannel:'rec'`; `cannibalization` is `sendChannel:'deliverable'`. | `server/recommendation-lifecycle.ts:38-51` | Keyword-opportunity / decaying-page / cluster / gap sends route for free. **No `competitor` RecType exists** → one registry add needed. |
| `StrategyRecommendationPayload` exists and is **unconsumed**. | `shared/types/recommendations.ts:221` | The mint-on-demand adapter for a domain item that is not yet a rec. |
| `strategy-command-center` flag exists, default `false`, group `Strategy`, key list at `:357`. No child flags exist. | `shared/types/feature-flags.ts:289`,`:357` | Child flags must be appended to BOTH the defaults map and the group `keys` array before first commit. |
| Render order today: `…cockpit?? actQueue → "Reference & Analysis" divider (KeywordStrategy.tsx:413-415) → cannibalization (passive) → strategyDiff (BURIED, :419) → siteKeywords → opportunities → intelligenceSignals → howItWorks`. Leak: `localSeoEl`/`clientFeedbackCombinedEl`/`settingsEl` render outside the tabs (`:388,395,396`). | `src/components/KeywordStrategy.tsx` | Confirms every IA claim in the spec. `id:'rankings', label:'Rankings'` (`:55`) → label-only rename is safe. |
| `IntelligenceSignals.tsx:49` renders `Computed {timeAgo(..., {style:'long'})} ago` — `timeAgo` already returns "X ago" → **double-"ago" bug**. | `src/components/strategy/IntelligenceSignals.tsx:49` | One-char fix, rides Phase 1. |

### The six grafts (attribution)

1. **[GRAFT: eng-led + design-led] Dedicated `strategy_keyword_set` table with a single reconciler as the ONLY writer, grafted into `persistKeywordStrategy`'s existing `writeKeywordStrategy` transaction (`keyword-strategy-persistence.ts:169`) — NOT `saveRecommendations()`, which has no transaction at all.** OVERRIDES unison §3.1 (`extend tracked_keywords`). This is the only storage design provably immune to the verified delete-then-reinsert clobber at `tracked-keywords-store.ts:184`. (§3.1 below.)
2. **[GRAFT: pm-led + eng-led] Mint Intelligence Signals as REAL recs at strategy-gen time (Option A)** rather than read-time synthesis or a client-side mapper. The existing `RECOMMENDATIONS_UPDATED` broadcast + `applyLifecycleCarryOver` carry-over then cover folded signals automatically with zero new broadcast wiring; the rec set stays the single authoritative queue that `isActiveRec()` governs. OVERRIDES unison §5.6 (client-side `signalToRecRow` synthetic-row mapper). (§3.4 below.)
3. **[GRAFT: design-led] Decision-pipeline framing — What Changed renders ABOVE the cockpit, and the "Reference & Analysis" divider is removed entirely.** Unison already promotes What Changed under the nudges/Orient strip; design-led sharpens the rationale: the divider is a *psychological off-ramp* where the surface got buried in the first place. Orient → What Changed → act, divider deleted. (§4① below.)
4. **[GRAFT: design-led + pm-led] `tracked_actions` durable-keep pattern for Topic Clusters and Content Gaps managed sets** — reusing the verified `CannibalizationTriage` precedent so managed sets never put a keep-flag on a delete-then-reinsert table. (§3.2 below.)
5. **[GRAFT: pm-led] The PM plan-review gate as a reviewable contract:** any task that says "build a send adapter for X" MUST answer (a) which rec-lifecycle route and (b) why a new source type is required — with **"the client needs a custom renderer"** as the ONLY acceptable new-source-type answer — backed by a pr-check rule. (§3.3 + §6 below.)
6. **[GRAFT: pm-led + design-led] P1-as-trust-recovery gate:** block all later phases until What Changed + scannable + the double-"ago" fix are on staging AND the operator has personally seen the page changed. (§7 P1 below.)

Everywhere else, this plan IS the unison spec.

---

## Pre-plan audit corrections (applied)

A pre-plan audit re-verified this plan against the live codebase and found 8 plan-TEXT errors (no design change). Each was corrected against the cited `file:line`. Provenance:

1. **[CRITICAL] §3.1 transactional seam corrected.** `reconcileStrategyKeywordSet` was grafted from the wrong seam (`saveRecommendations()` — `recommendations.ts` has ZERO `db.transaction`) → the correct one: `persistKeywordStrategy`'s `writeKeywordStrategy = db.transaction(...)` (`keyword-strategy-persistence.ts:169`), after the migration-088–090 sibling reconcilers (`:212-214`). Tracks the keyword-strategy regen, not recommendation regen. **Gate A — CLOSED.**
2. **[CRITICAL] §3.1/§8 risk restated.** "nested-transaction / SQLITE lock" → the real risk: `saveRecommendations()` has NO transaction, so the reconciler would run non-atomically there; better-sqlite3 `db.transaction()` doesn't nest and siblings self-open, so a MISSING txn is the hazard. Durability test now exercises the wired path (`persistKeywordStrategy` regen + `replaceAllTrackedKeywordRows` sync). **Gate B — CLOSED.**
3. **[CRITICAL] §5.5 brief pre-seed retargeted.** New `shared/types/content-gap.ts ContentGapFixContext` → extend the EXISTING `FixContext` (`src/App.tsx:77-98`). All four receiver layers made explicit tasks; sender field-name divergence (`primaryKeyword` @:78 vs `pageName` @:86) resolved; `serpFeatures` precedence vs `content-brief.ts:1240` decided; end-to-end read-path test added.
4. **[CRITICAL] #12c added as a named separate track.** The client-dashboard 3-layer recommendation delivery system (Phase 6b / paused v3 Phase 4) is now a Non-goal companion **client-delivery track**, cross-referenced from §3.3 as the outbound half of this plan's inbound admin send spine.
5. **[IMPORTANT] §3.3 competitor RecType lockstep expanded 1 → 5.** Enumerated `REC_POLICY_REGISTRY` + `REC_TYPE_ACT_CATEGORY` (`recCategoryMap.ts:12`) + `REC_TYPE_ADMIN_TAB` (`recTypeTab.ts:15`) + `REC_TYPE_TAB` (`InsightsEngine.tsx:39`) + `TYPE_ICONS` (`InsightsEngine.tsx:99`).
6. **[IMPORTANT] §3.3 "whyLine path" item resolved.** No RecType-keyed whyLine switch exists (`cockpitRowModel.ts:83` is data-driven) → competitor copy routes through `WhyHowResult` (§5.2); cannibalization note softened (it never enters the RecSet, so `/send` needs no deliverable-spine branch).
7. **[IMPORTANT] orphaned-leaf dispositions made explicit.** `OpportunitiesList` (cut), `LostQueryRecoveryCard` (keep-reserved), `RequestedKeywordTriage` (cut — client-requested-keyword action lives in `ClientKeywordFeedback`/`feedback.addRequestedKeyword`, `useKeywordFeedback.ts:23-44`), `DecisionQueue` (cut). Replaces the vague "P4 clean up orphans."
8. **[MINOR] #9b "research-seed" demoted** to an explicit §1 Non-goal / parking-lot line (data source + sync-vs-job + owning phase + inventory entry required before it becomes a task).

---

## 1. Goals + non-goals (from unison §1, unchanged)

### Goals
1. Promote **What Changed** to the top of Overview (above the cockpit, divider removed — graft 3).
2. Make every long list **scannable** via ONE shared `useShowMore` primitive (cap ~5 + show-more + progressive disclosure).
3. **Re-home the keyword surfaces** out of Overview into a renamed **"Keywords & Rankings"** tab with a curated **managed working set** (add/remove/keep, auto-replenish, search-and-add).
4. Make **Content the money page:** managed Content Gaps with pre-seeded briefs, managed Topic Clusters, Decaying Pages with send, the actionable `CannibalizationTriage` swapped in for the passive `CannibalizationAlert`.
5. **Universalize Send-to-client** through the rec lifecycle / deliverable spine — never per-card.
6. **Fold Intelligence Signals into the cockpit** as real recs (graft 2) and delete the standalone card (fixing the double-"ago" bug in the same pass).
7. **Consolidate Settings + Local SEO config** into one collapsed "strategy config" entry; dedupe the Local SEO panel rendering in both Strategy and the Keyword Hub.
8. Surface **why → how → projected result** uniformly on every rec / gap / cluster.

### Non-goals (explicit cuts — unison §1, all three teams converged)
- **Per-row recommendation table.** The whole-blob `RecommendationSet` storage stays (`server/recommendations.ts`). Roadmap-deferred.
- **Splitting Backlinks to its own `links` page.** Nav-level decision affecting the whole admin sitemap; carries a route-removal-checklist pass for zero backend logic moved. Defer; revisit after operators use the redesigned Competitive tab.
- **A new `ClientActionSourceType`** for any strategy surface. Hard constraint (§3.3).
- **A new umbrella feature flag.** Everything behind `strategy-command-center`; narrow child flags only.
- **Paid-topic monetization spine** (behind `strategy-paid-topics`, out of scope).
- **Retroactive enrichment of historical recs.** We build the why/how/result *presenter*; no backfill pipeline.
- **Topic Cluster "research-seed" (#9b) — PARKING LOT, not scoped here.** Pre-seeding a cluster with researched supporting content/keywords is a net-new generation path (own data source, own job-vs-sync decision, own inventory entry) that this redesign does not define. The Content-tab Topic Clusters surface ships **managed (`tracked_actions` keep) + why/how/result only**. If research-seed is pursued later it needs its own scoping pass — data source, sync-vs-background-job, owning phase, and a `data/features.json` entry — before it becomes a task. Do not treat "+ research-seed" as in-scope.
- **The client-dashboard 3-layer recommendation delivery system (#12c) — SEPARATE COMPANION TRACK, not built here.** This plan builds the entire **admin** send-to-client spine (§3.3 — the *outbound/inbound* counterpart that mints recs, sets `clientStatus`, and routes deliverables). The **client-side delivery surface** that renders those sent deliverables in the 3-layer client recommendation view (#12c in the walkthrough feedback, tied to **Phase 6b / the paused v3 Phase 4 "client curated overview"**) is its companion **client-delivery track** and is explicitly out of scope here. They are two halves of one contract: the admin send spine in this plan is the **inbound** half; #12c is the **client-facing outbound** half. Naming it here ensures sent deliverables aren't built into a void — the client surface that consumes them is tracked separately and must land for the round-trip to close. Cross-ref: §3.3 (admin spine) ↔ #12c (client render).

---

## 2. Current state (grounded — anchors every later claim)

Orchestrator: `src/components/KeywordStrategy.tsx` (exported `KeywordStrategyPanel`). **One layout today** (`strategyLayout`). `commandCenterEnabled = useFeatureFlag('strategy-command-center')` swaps **cockpit (ON) vs v2 ActQueue (OFF)** *inside Overview* only — NOT a whole-page fork. **Flag-OFF today already renders the 4-tab command-center IA** with the v2 ActQueue.

Gates every new surface respects:
- `isRealStrategy = strategy?.generatedAt != null` — a server shell renders the empty state, not the tabs.
- `useActQueue = isRealStrategy && hasActiveRecommendations`.
- `cockpitEl` built only when `commandCenterEnabled && isRealStrategy`.

**The leak:** `clientFeedbackCombinedEl` + `settingsEl` + `localSeoEl` render *outside* the tabs (`:388,395,396`), bleeding onto all four tabs. Inline comment flags this as interim "until StrategyCockpit re-homes them."

**Orphaned actionable leaves** (`src/components/strategy/index.ts:28-42` — "NOT yet wired… Do NOT delete"): `CannibalizationTriage` (the actionable one — Overview ships passive `CannibalizationAlert`; **wired** into Content, §5.4), `OpportunitiesList`, `LostQueryRecoveryCard`, `RequestedKeywordTriage`, `DecisionQueue`. `NeedsAttentionStrip`/`CurationMeter`/`CurationBulkActionBar` ARE used by `StrategyCockpit`; `DecayingPagesCard` IS wired into Content. **Each remaining orphan gets an explicit wire/cut/keep-reserved disposition in its owning phase (P4 cleanup) — see §7 Phase 4.** Note `RequestedKeywordTriage` is a true orphan: `KeywordStrategy.tsx:298`'s `onAdd={feedback.addRequestedKeyword}` feeds `ClientKeywordFeedback`, not this card; the client-requested-keyword action already lives in the Client Keyword Feedback log.

**Importer facts that gate the work:**
- `CannibalizationAlert` imported by `KeywordStrategy.tsx` AND `ContentPipeline.tsx` → keep the component; remove only from Strategy.
- `CannibalizationTriage` has zero production importers → confirmed orphan, safe to wire.

---

## 3. Data model — the load-bearing engineering decisions

### 3.1 Curated keyword managed-set — DEDICATED TABLE **[GRAFT: eng-led + design-led, OVERRIDES unison §3.1]**

**The trap (verified this session):** `strategy.siteKeywords` is read-only on the strategy blob and overwritten wholesale on regen. The normalized tables (`keyword_gaps`, `topic_clusters`, `cannibalization_issues`) are delete-then-reinsert on regen. **And `tracked_keywords` itself is delete-then-reinserted** via `replaceAllTrackedKeywordRows()` (`tracked-keywords-store.ts:282`, `DELETE` at `:184`) on the rank-tracking sync path (`rank-tracking.ts:235`) — its re-insert uses a fixed `keywordToParams()` column list. **Therefore a curation column added to `tracked_keywords` would be clobbered to NULL on every sync.** Unison's "two orthogonal columns on `tracked_keywords`" decision is rejected on this evidence.

**Decision (LOCKED): a dedicated `strategy_keyword_set` table whose SOLE writer is a reconciler grafted into the existing `writeKeywordStrategy = db.transaction(...)` in `persistKeywordStrategy` (`keyword-strategy-persistence.ts:169`), immediately after the migration-088–090 sibling reconcilers (`:212-214`).** This is the one design provably immune to the clobber: regen never writes the table from the keyword-sync path, and the reconciler is the single mutation entry. (Seam justification + the rejected `saveRecommendations()` seam are detailed in the reconciler bullet below.)

```sql
-- migration 139-strategy-keyword-set.sql
CREATE TABLE strategy_keyword_set (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id  TEXT NOT NULL,
  keyword       TEXT NOT NULL,              -- normalized lowercase-trimmed
  source        TEXT NOT NULL,              -- 'regen_computed' | 'client_request' | 'manual_add'
  kept_at       TEXT,                       -- ISO; set when operator explicitly keeps (survives regen)
  removed_at    TEXT,                       -- ISO; set when operator removes a slot (excluded from replenish)
  slot_order    INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL,
  UNIQUE(workspace_id, keyword)
);
CREATE INDEX idx_strategy_keyword_set_ws ON strategy_keyword_set(workspace_id);
```

No default, no backfill (follows the migration-121 safety model). A keyword is "in the managed set" iff it has an active row with `removed_at IS NULL`.

**Domain module (platform-organization rule):** `server/domains/strategy/managed-keyword-set.ts` — `createStmtCache()`/`stmts()` prepared statements, `rowToX()` mapper, typed interface in `shared/types/strategy-keyword-set.ts`. **No route-handler logic.** Exports:
- `getStrategyKeywordSet(workspaceId)` → active rows ordered by `slot_order`.
- `reconcileStrategyKeywordSet(workspaceId, strategy)` — **the ONLY writer wired into regen.** Grafts into the existing **`persistKeywordStrategy`'s `writeKeywordStrategy = db.transaction(...)`** (`server/keyword-strategy-persistence.ts:169`), called immediately **AFTER** the existing `replaceAllKeywordGaps` / `replaceAllTopicClusters` / `replaceAllCannibalizationIssues` reconciler calls (`keyword-strategy-persistence.ts:212-214`). That is the ONLY seam with (a) the existing shared `db.transaction()`, (b) the freshly-computed `strategy.siteKeywords` the reconciler must diff against, and (c) the precedent sibling reconcilers extracted in migrations 088–090. **NOT `saveRecommendations()`** — `server/recommendations.ts` has ZERO `db.transaction` calls and `saveRecommendations` (`recommendations.ts:406-413`, called at `:2554`) is a bare `recStmts().upsert.run(...)`, so hooking the reconciler there would run it non-atomically. **Which regen does the set track?** It tracks the **keyword-strategy** regeneration (`persistKeywordStrategy`, where `strategy.siteKeywords` is freshly produced) — NOT the recommendation regen (`generateRecommendations`, which reads `ws.keywordStrategy.siteKeywords` stale off the blob). If a future need requires syncing the set on recommendation regen, that is **net-new transaction work inside `generateRecommendations`** (which has no `db.transaction` today), not "extend an existing txn." Shape (no AI calls inside the txn — `ai-call-before-DB-write` pr-check covers this): (1) `SELECT *` once, build a `Set`; (2) diff against the new `strategy.siteKeywords`, insert net-new as `source:'regen_computed'`; (3) **auto-replenish:** for each row with `removed_at` set, fill the vacancy from the opportunity pool ranked by `estimatedGain`/`opportunity_score`, inserting `source:'regen_computed'` and stamping the new slot.
- `addStrategyKeyword(workspaceId, keyword, source)`, `removeStrategyKeyword(workspaceId, keyword)`, `keepStrategyKeyword(workspaceId, keyword)` — operator mutations, each inside `db.transaction()`, each calling `addActivity()`. `removeStrategyKeyword` sets `removed_at` (NOT a delete — the keyword stays for replenish-exclusion) and calls the replenish step inside the same txn.

**Auto-replenish UX (design):** surface "Added from opportunities" on a replenished row (silent replenish erodes trust).

**Search-and-add:** reuse the existing `keyword-command-center.ts` search path (do not hand-roll a query). Inline text input, one-click add, no confirmation dialog (remove is the undo). Dedup via the existing `assertKeywordNotAlreadyTargeted` guard before insert. Volume enrichment for manually-added keywords is deferred to a background `site_keyword_metrics` upsert — **not** blocking the add call (keeps P3 add latency low).

**Add-from-client-requests:** the client-requested-keyword decision surface is the **Client Keyword Feedback log** (`ClientKeywordFeedback`, re-homed into Keywords & Rankings — §4②.4), whose concrete approve handler is `feedback.addRequestedKeyword` → KCC `ADD_TO_STRATEGY` (`useKeywordFeedback.ts:23-44`). "Promote approved client keyword to set" is a one-line `addStrategyKeyword(…, 'client_request')` call added to that same handler. (This is the home for feedback #2's "client-requested keyword = action"; the orphaned `RequestedKeywordTriage` card is CUT, not wired — §7 Phase 4.)

**Events + activity (both halves required):**
- New `WS_EVENTS.STRATEGY_KEYWORD_SET_UPDATED` in `server/ws-events.ts` (registered before any frontend reference).
- Frontend `useWorkspaceEvents(workspaceId, WS_EVENTS.STRATEGY_KEYWORD_SET_UPDATED, …)` invalidating `queryKeys.admin.strategyKeywordSet` (a new key).
- New ActivityTypes (admin-only): `strategy_keyword_kept`, `strategy_keyword_removed`, `strategy_keyword_added`. Register in the closed `ActivityType` union same-commit.

**Durability test is the Phase-3 gate (exercises the ACTUAL wired path):** curate a set → run a **keyword-strategy regen via `persistKeywordStrategy`** (the seam the reconciler is wired into) **AND** a **rank-tracking sync via `replaceAllTrackedKeywordRows`** (the `tracked-keywords-store.ts:184` `deleteAll` clobber) → assert active rows + `kept_at` survive both. This proves the dedicated `strategy_keyword_set` table is immune to both write paths. This is the verified-clobber regression guard.

**Seam-risk note (NOT a nesting hazard):** the real risk the override removes is that the seam unison originally named (`saveRecommendations()`) has **no transaction at all**, so a reconciler hooked there would run as separate autocommit statements — non-atomic. better-sqlite3 `db.transaction()` does **not** nest by default, and the sibling reconcilers (`replaceAllKeywordGaps`/`replaceAllTopicClusters`/`replaceAllCannibalizationIssues`) self-open their own statements inside the enclosing txn, so **nesting is NOT the hazard — a MISSING transaction is.** Grafting into `writeKeywordStrategy` (`:169`) puts the reconciler inside an already-open atomic boundary, which is exactly what's wanted.

### 3.2 Managed sets for Topic Clusters + Content Gaps — `tracked_actions` keep **[GRAFT: design-led + pm-led]**

Topic Clusters and Content Gaps live on delete-then-reinsert normalized tables (`topic_clusters`, `content_gaps`). A `keep_flag` column on them works in dev and is clobbered after the first background regen. **Infer "keep" / "in progress" from durable `tracked_actions`** — the exact precedent verified in `CannibalizationTriage.tsx:84-94`.

- New `tracked_actions` type values: `topic_cluster_keep`, `content_gap_keep` (document in the table constraint or the action-type enum; register in `shared/types/outcome-tracking.ts` `ActionType` union same-commit).
- The component queries `tracked_actions` for the workspace, filters to its own `sourceType` (so rec-sourced actions don't collide — the CannibalizationTriage filtering pattern), and cross-references on render. Regen rewrites `topic_clusters`/`content_gaps`; the `tracked_actions` row survives.
- **Do NOT add a `keep_flag` column to `topic_clusters`/`content_gaps`.** Enforced in review against the verified clobber class.

This reuses the existing `tracked_actions` write/read infra — near-zero net-new beyond two enum values.

### 3.3 Universal send-to-client (the spine that already exists) + the PM gate **[GRAFT: pm-led]**

> **Scope note — this is the INBOUND/admin half only.** §3.3 builds the admin spine that mints recs, sets `clientStatus`, and routes deliverables. The **client-facing render** of those sent deliverables (the 3-layer client recommendation overview, **#12c**) is the companion **client-delivery track** and is a Non-goal here (§1) — built in **Phase 6b / the paused v3 Phase 4 client curated overview**. Both halves are required for the round-trip to close; do not assume sent deliverables surface to the client within this plan's scope.

The spine is **fully built**; we route through it. Two mechanisms, in order of preference:

1. **Rec lifecycle (clientStatus axis) — DEFAULT.** `PATCH /api/recommendations/:ws/:recId/send` → `sendRecommendation()` (`server/recommendation-lifecycle.ts`) routes by `REC_POLICY_REGISTRY[type].sendChannel`. `sendChannel:'rec'` mutates `clientStatus` (`system → curated → sent`); **NEVER writes RecStatus** (the trust-critical invariant). Covers keyword opportunities, decaying pages, competitor, gaps, clusters. For a domain item not yet a rec, mint via `StrategyRecommendationPayload` (`shared/types/recommendations.ts:221`, unconsumed) so it enters the single authoritative `RecommendationSet` and `isActiveRec()` governs visibility.
2. **Deliverable spine (bespoke client card) — ONLY when a custom renderer is truly needed.** `sendChannel:'deliverable'` routes `cannibalization` (and `content_decay`) to the `client_actions` → `client_deliverable` path with a dedicated renderer (`CannibalizationRenderer`, dispatched by `DeliverableDetailModal.tsx`). We add no new ones.

**Routing per surface:**

| Surface | Send path | New source type? | Notes |
|---|---|---|---|
| Keyword opportunity ("interested in this one?") | Mint a `keyword_gap` rec **at regen** → `sendRecommendation()` (`sendChannel:'rec'`). | No | "Yes" also joins the managed set (§3.1). Mint-at-regen keeps the rec set the single queue (unison §11 trade — eng-preferred). |
| Decaying page ("should we refresh?") | `content_refresh` rec → `PATCH …/send` (`content_refresh` already `sendChannel:'rec'`). | No | `DecayingPagesCard` gets a teal "Send to client" button. |
| Competitor ("act on this gap") | Add `competitor` (or `competitive_gap`) RecType — the union value + the **one-commit 5-map lockstep** (see below). Send via `sendRecommendation()`. | No | Client-visible competitor renderer ships gated behind `strategy-competitor-send` so a deliverable can't land before its renderer exists. |
| Cannibalization | Already routes through the `cannibalization` **deliverable** spine — `client_actions`/`client_deliverable`. **Does NOT enter the RecSet**, so the `/send` route needs no deliverable-spine branch. | No (exists) | Swap `CannibalizationAlert` → `CannibalizationTriage` in the IA. |

**Competitor RecType — the one-commit 5-map + registry lockstep (LOCKED).** Adding `competitor` (or `competitive_gap`) to the `RecType` union forces same-commit entries in FOUR exhaustive `Record<RecType, …>` maps PLUS the policy registry. A `RecType` value missing from any one is a compile error (the maps are exhaustive) or a silent fall-through default — enumerate ALL FIVE in the competitor task body:
1. **`REC_POLICY_REGISTRY`** (`server/recommendation-lifecycle.ts:37`) — `{ sendChannel:'rec', cascadeOnStrike:false, monetizable:false }` (verified: no `competitor` RecType exists today).
2. **`REC_TYPE_ACT_CATEGORY`** (`src/lib/recCategoryMap.ts:12`) — Act-queue filter category.
3. **`REC_TYPE_ADMIN_TAB`** (`src/lib/recTypeTab.ts:15`) — admin `Page` the rec deep-links to.
4. **`REC_TYPE_TAB`** (`src/components/strategy/InsightsEngine.tsx:39`) — InsightsEngine tab routing.
5. **`TYPE_ICONS`** (`src/components/strategy/InsightsEngine.tsx:99`) — per-type icon.

Then send via `sendRecommendation()`. Bespoke competitor client copy is presented through the shared `WhyHowResult` presenter (§5.2) — there is no RecType-keyed `whyLine` switch to extend (see §5.2 note).

**Hard constraint (LOCKED): no new `ClientActionSourceType` in this redesign.** The 6-part lockstep (source type + payload + adapter + renderer + activity + state machine) is reserved.

**The PM plan-review gate (graft 5), operationalized as a reviewable contract:**
> Any task in the expanded plan that says "build a send adapter for X" MUST answer, in the task body: **(a)** which rec-lifecycle route (`sendChannel:'rec'` via mint, or `sendChannel:'deliverable'`), and **(b)** why a new source type is required. The **ONLY** acceptable answer to (b) is "the client needs a custom renderer the deliverable spine cannot serve." Any other answer → the task is auto-rewritten to `sendRecommendation()`.

This is backed by a **net-new pr-check rule** (`strategy-send-must-route-through-lifecycle`): flag any new `clientActions.create()` call inside `src/components/strategy/**` OR any new string added to the `ClientActionSourceType` union, unless it carries an inline justification hatch naming the bespoke renderer. (Inline hatch placement per `feedback_pr_check_hatch_placement` — pattern-based rule, hatch on the same line.)

### 3.4 Signal-fold — MINT AT GEN TIME (Option A) **[GRAFT: pm-led + eng-led, OVERRIDES unison §5.6]**

Unison §5.6 proposed a client-side `signalToRecRow` synthetic-row mapper. **Override:** mint signals as **real recs during `generateRecommendations()`** (`server/recommendations.ts:1194`), either mapping onto existing `keyword_gap`/`topic_cluster` RecTypes or carrying a `source:'signal'` discriminator on the minted rec. Why this wins:
- The existing `RECOMMENDATIONS_UPDATED` broadcast (`recommendations.ts:2564`) + `applyLifecycleCarryOver` (`:598`) cover folded signals **automatically** — zero new broadcast wiring, no hybrid read path, no synthetic-row discriminant for write-path gating.
- The rec set stays the single authoritative queue that `isActiveRec()` (`:642`) governs — no window where a signal exists but no rec governs it (the partial-active-filter risk).
- Carry-over already builds `oldByKey` as a `Map` (`:600`, O(n)) — good. **Performance gate (eng, before the fold ships):** audit every other carry-over consumer for an inner `.find()` on old recs; convert any O(n²) scan to the `Map` lookup before the fold lands.

Net-new: a `mintSignalRecs(signals, existingRecs)` step inside `generateRecommendations()` that dedups by `insightId`/`sourceKey` via `buildMergeKey`. Then delete `intelligenceSignalsEl` (`KeywordStrategy.tsx:253,422`).

**Fix the `Computed X ago ago` double-"ago" bug** (`IntelligenceSignals.tsx:49` — drop the literal `' ago'`; `timeAgo(..., {style:'long'})` already returns "X ago"). Per the trust-recovery gate (graft 6), this one-char fix **rides Phase 1**, decoupled from the fold, so it cannot silently re-defer with the fold.

### 3.5 The two lifecycle axes are never conflated (unison §3.3, unchanged)

Every new surface that lists/counts/renders recs MUST route through `isActiveRec(rec, now?)` (`recommendations.ts:642`) — the single active-set predicate. **Strike/throttle/send NEVER write `RecStatus`.** Carry-over (`applyLifecycleCarryOver`) and auto-resolve exemption (`isExemptFromAutoResolve`) unchanged. **New pr-check rule (`incomplete-rec-filter`):** in `src/components/strategy/*`, a `status === 'dismissed'`/`!== 'dismissed'` filter without an adjacent `isActiveRec` call is flagged. Add before Phase 2 touches any rec-listing surface.

---

## 4. Tab IA + render order — all 4 tabs

The 4-tab structure (`overview | content | rankings | competitive`) is correct; the **render order within tabs** is wrong. The `?tab=` literal ids stay in `KeywordStrategy.tsx` (the deep-link contract test scans for them). "Rankings" is **renamed in the UI label only** to "Keywords & Rankings"; its `id` literal stays `rankings` (`STRATEGY_INTERIOR_TABS:55`).

### ① Overview = decide & act — DECISION PIPELINE **[GRAFT: design-led]**

**New render order (LOCKED):**
1. `feedbackNudgeEl` + `realLeaves.stalenessNudges` (transient nudges).
2. **Orient** (`OrientZone`) — compact metric strip (visibility score + clicks + impressions + position), NOT a hero. The trend sparkline is a `useShowMore`/expand item, not default-visible.
3. **What Changed** (`StrategyDiff`) — **promoted to immediately below Orient, ABOVE the cockpit.** This is a decision pipeline: **orient → what changed → act.** Promoting above the *divider* is not enough — the divider is the psychological off-ramp where the surface got buried; everything below it reads as safe-to-skip. **It must sit above the cockpit.** Renders nothing when `!hasChanges` (lean on the existing guard). **Do NOT "fix" its amber-bordered non-SectionCard chrome** — it carries an intentional `pr-check-disable` brand-asymmetric signature (`StrategyDiff.tsx:41`). The JSX shuffle MUST NOT drop the `useWorkspaceEvents` handler that refetches `queryKeys.admin.strategyDiff` on `STRATEGY_UPDATED` — code-review gate item.
4. **The Cockpit** (`StrategyCockpit`) — full width, no competing cards beside it. Signals fold in here as real rec rows (§3.4). Cannibalization/gaps/clusters appear as rec ROWS that open their rich cards. `CurationBulkActionBar` surfaced for multi-select send.
5. **Collapsed "strategy config"** at the bottom behind a disclosure toggle (provider, page limit, business context, local market/location) — §5.7. Accordion header shows a one-line state summary even when collapsed.

**Removed from Overview:** the **"Reference & Analysis" divider — deleted entirely** (graft 3); `IntelligenceSignals` standalone (folded — §3.4); `StrategyHowItWorks` (static explainer → `?` tooltip / "About this page" collapsible in `PageHeader`); `SiteTargetKeywords` + `KeywordOpportunities` (move to Keywords & Rankings); the unconditional `ClientKeywordFeedback` leak (moves to Keywords & Rankings).

### ② Keywords & Rankings (renamed from "Rankings")
1. **Tab header** with the "Open the Keyword Hub" deep-link (`buildHubDeepLinkQuery` + `adminPath(ws, 'seo-keywords')`) — top-right, visible without scrolling. The managed set is a curated slice, not a Hub replacement.
2. **Site Target Keywords — managed working set** (§3.1). Three visual states: In set (teal dot/badge), Removed (zinc), Candidate (no dot). Inline search-and-add at top. "Added from opportunities" annotation on auto-replenished rows.
3. **Keyword Opportunities** — per-row "interested in this one?" → `sendRecommendation()` (`keyword_gap` rec, minted at regen); "yes" also joins the set.
4. **Client Keyword Feedback log** (`ClientKeywordFeedback`) — moved from the leak; collapsible (reference, not action).
5. **Ranking Distribution** + **Position Movements** (existing `StrategyRankingsTab` content).

### ③ Content = the money page
1. **Content Gaps** (managed via `tracked_actions` keep — §3.2 + send-to-client + briefs pre-seeded with full computed context — §5.5).
2. **CannibalizationTriage** (actionable pick-the-keeper + send — swapped in for passive `CannibalizationAlert`; §5.4). After Gaps, before Clusters (urgent — not last).
3. **Topic Clusters** (managed via `tracked_actions` keep — §3.2 + why/how/result). *(Cluster "research-seed" — #9b — is a Non-goal here; see §1.)*
4. **Decaying Pages** (`DecayingPagesCard`) — gains "Send to client — should we refresh?" via `content_refresh` rec (§3.3).

Keep the existing `hasContentTabContent` empty-state guard.

### ④ Competitive
**Share of Voice** (`ShareBar`) → **Competitor comparison** (`CompetitiveIntel`) with per-row "act on this gap" send (`competitor` RecType, §3.3) → **Keyword gaps** (`KeywordGaps`) → **Backlinks** (`BacklinkProfile`, stays — split deferred).

---

## 5. Each surface's behavior + reuse vs net-new

### 5.1 Global scannable lists — `useShowMore` (NET-NEW shared hook)
No `useShowMore` exists; surfaces cap ad-hoc (`TopicClusters.slice(0,10)`, `IntelligenceSignals.slice(0,10)`) or not at all (`ContentGaps` renders all `sorted`; `SiteTargetKeywords` renders all). Cockpit's `FIX_NOW_CAP=5` (`cockpitRowModel.ts:3`) is the reference.

**Build `src/hooks/useShowMore.ts` BEFORE any leaf is modified** (CLAUDE.md UI/UX rule #9). Signature: `useShowMore<T>(items: T[], initialCap = 5): { visible; hasMore; hiddenCount; showMore; showLess; expanded }`. Default cap **5**; "Show N more" is a **teal text link** with a count (`"Show 12 more content gaps"`, not "Show more"), low visual weight, secondary action — not a bordered button; in-place expand or drawer, **never a modal** for routine inspection.

Applied uniformly to: `ContentGaps`, `TopicClusters`, `KeywordOpportunities`, `SiteTargetKeywords`, `CannibalizationTriage`, Competitive keyword gaps. The cockpit keeps its `FIX_NOW_CAP` curated slice (don't duplicate). **Block any PR that hard-caps with inline `.slice(0, N)` without the show-more affordance.**

### 5.2 Why → how → projected result (consistent presenter)
Data exists per item (recs carry `insight`/`description`/`estimatedGain`/`impactBand`; gaps carry `rationale`/`competitorProof`/`volume`/`intent`; clusters carry `topCompetitor`/`coveragePercent`). Today only `cockpitRowModel.ts:83`'s clamped `whyLine` surfaces — and it is **data-driven** (`whyLine: clampLine(rec.description ?? '')`), NOT a RecType-keyed `switch`. **There is no per-RecType whyLine branch to extend** for the new `competitor` type (or any other); bespoke per-type copy is routed through the `WhyHowResult` presenter below, which reads the item's own data fields. Any task that proposes "add a whyLine path for X" is rewritten to "render X through `WhyHowResult`."

**Format scannable, not prose:** **Why** (one line, data-anchored: "Competitor X ranks P4; you rank P22") → **How** (the action verb on the primary teal CTA: "Generate brief"/"Send to client"/"Pick keeper") → **Result** (badge: prefer concrete `estimatedGain` `+~340 clicks/mo` blue badge; fall back to `impactBand` `High`/`Medium` emerald/amber ONLY when the estimate is absent — a bare "Medium impact" is zero trust signal). Compact row shows **Why only**; expanded shows all three.

Net-new: a shared `WhyHowResult` presenter (`src/components/strategy/shared/WhyHowResult.tsx`) that dedupes across cockpit rows + gap cards + cluster cards. Every tier has a fallback label — never an empty tier, never "undefined est."

**Why/how/result is a send prerequisite:** the send button is enabled only when `insight` is non-empty AND `impactBand`/`estimatedGain` resolves. A `sendable` gate enforces this — sending without projected-impact language is a client-experience regression.

### 5.3 Send-to-client UX (one universal affordance)
**One teal "Send to client" button + optional inline note field** (platform convention, pr-check `send-for-review-anti-pattern`). No "Send for Review"/"Flag for Client". Note is inline + collapsible, **never a modal** (bottom sheet on mobile). After send: row shows a muted-teal "Sent" pill, button disables; client response renders inline — "Client approved" (emerald) / "Client declined" (red) / "Discussing" (amber), read from `clientStatus`. **Bulk send via `CurationBulkActionBar`** — select 3–5 recs, send in one action (highest-leverage cockpit usability win).

### 5.4 Cannibalization re-home (reuse — ~zero net-new)
`CannibalizationTriage.tsx` is fully built (keeper-pick via `keeperPathOf`, Fix-in-editor, Mark-resolved → `cannibalization_resolved` outcome, Send-to-client via the `cannibalization` deliverable adapter; resolution inferred from durable `tracked_actions:84-94`). Work: **swap `CannibalizationAlert` → `CannibalizationTriage` in the Content tab.** Keep `CannibalizationAlert` (still imported by `ContentPipeline.tsx`); remove only from Strategy.

### 5.5 Brief pre-seed for ContentGaps (NET-NEW: extend the EXISTING fixContext contract)

**The carrier is the EXISTING `interface FixContext` at `src/App.tsx:77-98`** — NOT a new `shared/types/content-gap.ts` type (no such file exists; ALL fixContext senders route through `FixContext`). The two `ContentGaps.tsx` senders drop the rich gap fields:
- `ContentGaps.tsx:78` (content-pipeline) passes `{ targetRoute, primaryKeyword, pageType, autoGenerate }`.
- `ContentGaps.tsx:86` (seo-briefs) passes `{ targetRoute, pageName, pageType }`.
Both DROP `rationale`, `competitorProof`, `volume`, `intent`, `questionKeywords`, `serpFeatures`. Carrier is `navigate(…, { state: { fixContext } })`.

**(a) Type location — extend, don't fork.** Add the 6 optional fields to the EXISTING `FixContext` (`src/App.tsx:77-98`). If a narrower alias is desired, declare `ContentGapFixContext` an explicit **strict structural subset** of `FixContext` (so a `FixContext` value is always assignable) — never a parallel type. All fields `.optional()` so existing callers don't break (Zod clearable/optional rule).

```ts
// src/App.tsx — EXTEND the existing FixContext (do not create shared/types/content-gap.ts)
export interface FixContext {
  targetRoute: string;
  // …existing fields (pageId, pageSlug, pageName, primaryKeyword, pageType, autoGenerate, …)
  // NET-NEW content-gap pre-seed fields (all optional):
  rationale?: string;
  competitorProof?: string;
  volume?: number;
  intent?: string;
  questionKeywords?: string[];
  serpFeatures?: string[];
}
```

**(b) Make ALL FOUR receiver layers explicit tasks** — none read these fields today, so each is net-new wiring:
1. **`FixContext` type** (`src/App.tsx:77-98`) — add the 6 fields.
2. **`ContentBriefs.tsx` `handleGenerate` payload** (`ContentBriefs.tsx:469-491`, the `startBriefGenerationJob(...)` call) — fold the new fields into the `pageAnalysisContext` object it builds from `fixContextRef.current`.
3. **`StandaloneContentBriefGenerationParams.pageAnalysisContext`** (`server/content-brief-generation-job.ts:29-42`) — widen the `pageAnalysisContext` shape to carry the new fields, AND widen the param cast/validation at `server/routes/jobs.ts:287-288` (where `params.pageAnalysisContext` is type-narrowed onto `StandaloneContentBriefGenerationParams['pageAnalysisContext']`) so they aren't stripped at the HTTP boundary.
4. **The prompt-assembly block** (`server/content-brief.ts:1219-1230`, the `if (!pageAnalysisBlock && context.pageAnalysisContext)` branch) — actually emit the new fields into the brief prompt. A sender adding fields the receiver never reads repeats the bug.

**(c) Resolve the sender field-name divergence (so Zod/typing can't 400 the seo-briefs sender):** `ContentGaps.tsx:78` passes `primaryKeyword`; `ContentGaps.tsx:86` passes `pageName`. Make `primaryKeyword` optional on the consumed shape **OR** change `:86` to pass `primaryKeyword` (preferred — aligns both senders on one field). Pick one in the task body; do not leave both names live for the same value.

**(d) `serpFeatures` precedence vs the existing block.** `content-brief.ts:1240` already builds `serpFeaturesDirectiveBlock` from `matchedPage?.serpFeatures` (page_keywords-derived). The new `fixContext.serpFeatures` must NOT silently duplicate or override it. Decision required in the task body: **merge** (union the two feature lists, dedup) OR **precedence** (page_keywords-derived `matchedPage.serpFeatures` wins when present; `fixContext.serpFeatures` is the fallback when no matched page exists). State which, so the signal neither double-emits directives nor is silently dropped.

**(e) End-to-end read-path contract test (none exists today):** assert each new field is **READ by the generator** (appears in the assembled prompt / `pageAnalysisBlock`), not merely passed by the sender. This is the both-halves guard for the fixContext bug-class.

**Both halves (sender + all four receiver layers) ship in the SAME PR.**

### 5.6 Signal-fold — see §3.4 (mint at gen time, graft 2).

### 5.7 Config consolidation + Local SEO dedup (NET-NEW IA move, behind the flag)
`LocalSeoVisibilityPanel` renders in BOTH `KeywordStrategy.tsx:215` (`localSeoEl`, `mode="strategy"`) AND `KeywordHub.tsx:539`.
- **Visibility panel RESULTS home to `KeywordHub`** (the keyword-universe surface). Remove `localSeoEl` from `KeywordStrategy.tsx` entirely; the `mode="strategy"` prop becomes dead → clean up same commit.
- **Local SEO CONFIG** (provider, local market/location) folds into the new collapsed "strategy config" section in Strategy, alongside `StrategySettings`.

Touches BOTH files; both edits same PR, both behind the flag (flag-OFF keeps `localSeoEl` on every tab); snapshot-test gated (half a move leaves a stale duplicate).

---

## 6. The 4 global patterns — how each is implemented
1. **Scannable** → `useShowMore` shared hook (§5.1), built first, applied everywhere. Cap 5, teal "show N more" link, in-place/drawer disclosure.
2. **Why → how → projected result** → the `WhyHowResult` presenter (§5.2), compact=why / expanded=all three, send-prerequisite gate.
3. **Send-to-client = one universal mechanism** → rec lifecycle (`sendRecommendation`, clientStatus axis) + the deliverable spine for the two bespoke families (§3.3). **No per-card `clientActions.create`. No new `ClientActionSourceType`.** One teal button + optional note, "Sent" pill, bulk send via `CurationBulkActionBar`. Enforced by the PM gate + pr-check rule `strategy-send-must-route-through-lifecycle` (graft 5).
4. **Consolidate Settings + Local SEO** → one collapsed "strategy config" entry (§5.7) + dedupe the Local SEO panel (results → Hub, config → Strategy).

---

## 7. Phasing — front-load visible wins; phase-per-PR; staging-first

Phase-per-PR; never start phase N+1 until phase N is merged and green on staging. Each phase has a feature-class definition-of-done gate. **Each phase ships a visible screen change, not backend-only plumbing** (the signal-fold was deferred once as "plumbing" — every phase is framed as a visible change).

### Phase 1 — Visible wins, zero data-model change — **THE TRUST-RECOVERY GATE [GRAFT: pm-led + design-led]**

The proof the redesign is real. Ships fast, alone, not bundled with structural change.

- **What Changed promote** above the cockpit + **delete the "Reference & Analysis" divider** (JSX reorder; keep the `useWorkspaceEvents` handler + amber chrome) — graft 3.
- **`useShowMore` shared hook** + apply to `ContentGaps`, `TopicClusters`, `KeywordOpportunities`, `SiteTargetKeywords`.
- **CannibalizationTriage swap** in Content (zero-cost visible win all teams flagged; unison §11 pulls it from the foundation's P4 to P1 — `CannibalizationTriage` fully built, `CannibalizationAlert` stays for `ContentPipeline`).
- **Fix `Computed X ago ago`** bug (one-char, decoupled from the fold so it can't re-defer — §3.4).
- Demote `StrategyHowItWorks` → `?` tooltip in `PageHeader`.

**No backend, no migration, no managed-set, no new send paths.**

**GATE (graft 6 — HARD):** typecheck + build + vitest + pr-check; flag-OFF byte-identical snapshot on the real public read (`tests/integration/recommendations-public-allowlist.test.ts`); real-browser DOM probe (the design-system 5-layer verification — a collapsed grid / undefined token passes the first four layers; see `feedback_phase5_multilayer_verification`). **Block ALL of P2/P3/P4 until P1 is merged, green on staging, AND the operator has personally confirmed the page changed.** This is the mechanism that guarantees "nothing looks different" is answered first.

### Phase 2 — The big visible move (IA reorganization only)
- Rename "Rankings" → "Keywords & Rankings" (label only; `id` stays `rankings`).
- Move `SiteTargetKeywords` + `KeywordOpportunities` + `ClientKeywordFeedback` into that tab (existing behavior preserved — Track/View-in-Hub stays; passive display only).
- Add the prominent "Open the Keyword Hub" deep-link to the tab header.
- **Pre-commit the P3 shared contracts** even though the write-path UI isn't built: migration 139 (`strategy_keyword_set`), the `server/domains/strategy/managed-keyword-set.ts` interface + signatures, `shared/types/strategy-keyword-set.ts`, the 6 new optional fields on the EXISTING `FixContext` (`src/App.tsx:77-98`), the child flags, and the `tracked_actions` keep enum values (§3.2). Parallel agents need pre-committed shared contracts (multi-agent rule).

**Hard-scope: IA reorganization ONLY. No managed-set semantics here.** If add/remove/keep is scoped into P2, the write path eats weeks and the rename never ships.

**GATE:** deep-link contract test (`tests/contract/tab-deep-link-wiring.test.ts`) passes with the renamed label; flag-OFF byte-identical; mobile breakpoint pass.

### Phase 3 — Monetization spine + managed sets (the money phase)
- **Migration 139** (`strategy_keyword_set` dedicated table — graft 1) + `reconcileStrategyKeywordSet` wired as the SOLE writer inside `persistKeywordStrategy`'s `writeKeywordStrategy` txn (`keyword-strategy-persistence.ts:169`, after `:212-214`), tracking the keyword-strategy regen (§3.1).
- `addStrategyKeyword`/`removeStrategyKeyword`/`keepStrategyKeyword` + auto-replenish + search-and-add + add-from-client-requests, behind `strategy-keywords-managed-set`.
- Managed-set UI (add/remove/keep, three visual states, "Added from opportunities" annotation).
- **Managed Topic Clusters + Content Gaps via `tracked_actions` keep** (graft 4 — `topic_cluster_keep`/`content_gap_keep` enum values + read/cross-reference).
- **Send-to-client on Decaying Pages + Keyword Opportunities** via `sendRecommendation()` / mint-at-regen.
- **Why/how/result presenter** (here, not P4 — client sends without projected impact are weaker; data exists). Send-prerequisite gate.
- Brief pre-seed (extend the EXISTING `FixContext` at `src/App.tsx:77-98`; all four receiver layers — §5.5 — wired in the same PR).
- New `WS_EVENTS.STRATEGY_KEYWORD_SET_UPDATED` + handler + 3 activity types; new pr-check `incomplete-rec-filter` + `strategy-send-must-route-through-lifecycle` (graft 5).

**GATE:** managed-set survives a simulated regen AND a rank-tracking sync (the verified-clobber durability test — the Phase-3 regression guard); `isActiveRec`-only filtering verified; send-path integration exercises the **public read** (`GET /api/public/recommendations/:ws`), not the admin route; `strike-never-completed` exit-gate green; mobile pass for cockpit bulk-select + managed-set + why/how/result drawer.

### Phase 4 — Consolidation + cleanup (hardest, least daily-visible)
- **Signal-fold via mint-at-gen-time** (graft 2): `mintSignalRecs` inside `generateRecommendations()` + delete `intelligenceSignalsEl` (the `ago` bug already fixed in P1). Carry-over O(n²) audit before merge. Behind `strategy-signal-fold`.
- **Config consolidation** (Settings + Local SEO config → collapsed "strategy config") + **Local SEO dedup** (visibility → Hub, config → Strategy; remove `localSeoEl` + dead `mode="strategy"`).
- **Competitor send** (`competitor` RecType registry add + `CompetitiveIntel` send) with the client renderer gated behind `strategy-competitor-send`.
- Final flag-OFF cleanup pass (remove the outside-tabs leak now that everything is re-homed).
- **Orphaned-leaf disposition (explicit per leaf — no vague "clean up orphans").** Resolve each `index.ts:28-42` "NOT yet wired / Do NOT delete" leaf to exactly one of wire / cut / keep-reserved:
  - **`OpportunitiesList`** — **CUT.** Its job (per-row "interested in this one?" keyword opportunities) is taken over by the §4② Keyword Opportunities surface inside Keywords & Rankings, which sends via `sendRecommendation()`/mint-at-regen. No second opportunities list. Remove the export + file once P2's Keyword Opportunities is live.
  - **`LostQueryRecoveryCard`** — **KEEP-RESERVED.** No surface in the new IA consumes lost-query recovery, and the data path isn't in scope. Leave the export with the existing "Do NOT delete" note; revisit when a lost-query surface is specced. Do NOT wire blindly.
  - **`RequestedKeywordTriage`** — **CUT (functionality already lives elsewhere).** It is a genuine orphan (zero render sites; `KeywordStrategy.tsx:298`'s `onAdd={feedback.addRequestedKeyword}` feeds `ClientKeywordFeedback`, NOT this component). The client-REQUESTED-keyword decision surface in the new IA is the **Client Keyword Feedback log** (`ClientKeywordFeedback`) re-homed into Keywords & Rankings (§4②.4), whose existing approve handler is `feedback.addRequestedKeyword` → KCC `ADD_TO_STRATEGY` (`useKeywordFeedback.ts:23-44`). That handler is also where §3.1's "promote approved client keyword to the managed set" hooks (`addStrategyKeyword(…, 'client_request')`). This resolves feedback #2's "client-requested keyword = action" — the action lives in the Client Keyword Feedback log, not a separate triage card. Remove `RequestedKeywordTriage`'s export + file.
  - **`DecisionQueue`** — **CUT.** Superseded by the cockpit's curation queue (`StrategyCockpit` + `NeedsAttentionStrip`/`CurationBulkActionBar`), which is the single decision surface. No parallel decision queue. Remove the export + file.
- After the four dispositions, `index.ts:28-42` re-exports only genuinely-wired leaves (`DecayingPagesCard`, `CannibalizationTriage`, `NeedsAttentionStrip`, `CurationMeter`, `CurationBulkActionBar`).

**GATE:** flag-OFF still byte-identical after the leak removal; zero standalone signal cards post-fold (each signal type verified as a cockpit row in the correct facet); no "ago ago" in rendered output; Local SEO renders in exactly one place; no orphaned flag keys (`verify:feature-flags`); coverage ratchet not regressed.

**Phasing vs the foundation:** the foundation put cannibalization swap + signal-fold both in P4. This plan **pulls cannibalization to P1** (zero-cost visible win) and **keeps signal-fold + competitor + config in P4** (signal-fold's gen-time mint + carry-over perf audit; competitor's renderer guard; config is the flag-OFF-leak removal, safest last).

---

## 8. Testing + risks

### Testing (per phase)
- **Flag-OFF byte-identical snapshot** on the real public read (`recommendations-public-allowlist.test.ts`) — **every phase** (in each phase's acceptance checklist, not just final).
- **Deep-link contract test** (`tab-deep-link-wiring.test.ts`) — passes after the label rename (ids unchanged).
- **`isActiveRec`-only filtering** — `incomplete-rec-filter` pr-check + unit coverage per new rec-listing surface.
- **Managed-set durability (CRITICAL, graft 1 guard)** — curate a set, run a keyword-strategy regen via `persistKeywordStrategy` (the wired seam, `keyword-strategy-persistence.ts:169`) AND a rank-tracking sync via `replaceAllTrackedKeywordRows` (`tracked-keywords-store.ts:184` deleteAll), assert active rows + `kept_at` survive both. Mirrors `recommendation-regen-preserves-lifecycle.test.ts`.
- **Managed-set keep via `tracked_actions`** (graft 4) — mark a cluster/gap "keep" → regen → assert keep survives (read from `tracked_actions`).
- **fixContext both-halves (end-to-end read-path)** — assert the generator READS each new `FixContext` field (it reaches the assembled `pageAnalysisBlock`/prompt in `content-brief.ts:1219-1230`), not just that the `ContentGaps.tsx` sender passes them. Covers all four receiver layers (§5.5).
- **Send-path integration** — exercise `GET /api/public/recommendations/:ws` (the client read), not the admin GET. Assert `clientStatus` set and `RecStatus` untouched (extend `strike-never-completed`).
- **Signal-fold (graft 2)** — folded signals appear as active recs via `isActiveRec`; standalone card gone; carry-over keeps lifecycle across regen; assert no "ago ago".
- **PM-gate pr-check** (graft 5) — a test asserting a new `clientActions.create()` in `src/components/strategy/**` or a new `ClientActionSourceType` string without the inline hatch is flagged.
- **5-layer design-system verification** (typecheck + build + pr-check + review + real-browser DOM probe) for every phase with JSX/CSS change.
- **Mobile breakpoint pass** within each phase (cockpit bulk-select, managed-set add/remove/keep, why/how/result drawer).

Use `createEphemeralTestContext(import.meta.url)` for spawned-server integration tests; never bind fixed ports.

### Risks (ranked)
1. **Curated-set silently empties on regen / rank-tracking sync** (the verified `tracked-keywords-store.ts:184` clobber). Mitigation: dedicated `strategy_keyword_set` table + reconciler-only writer grafted into `persistKeywordStrategy`'s `writeKeywordStrategy` txn (graft 1) + the durability test gated before P3 merge. **Not a nesting risk:** the hazard is that the originally-named seam (`saveRecommendations()`) has NO transaction, so the reconciler would run non-atomically there; better-sqlite3 `db.transaction()` does not nest and the sibling reconcilers self-open, so a MISSING transaction — not a nested one — is the real failure mode the seam choice avoids. Durability test exercises **both** the wired keyword-strategy regen (`persistKeywordStrategy`) and a rank-tracking sync (`replaceAllTrackedKeywordRows`).
2. **Re-conflating the lifecycle axes / partial active-set filter.** Mitigation: `isActiveRec` everywhere + `incomplete-rec-filter` pr-check + never write `RecStatus` on send/strike/throttle.
3. **The visible-win gap (P1 slips or bundles).** Mitigation: the P1 trust-recovery gate (graft 6) — What Changed + scannable + cannibalization swap + `ago` fix, shipped alone, blocking all later phases until operator-confirmed on staging.
4. **Managed-set persistence scope creep into P2.** Mitigation: hard-scope P2 to IA move; managed-set is P3 behind `strategy-keywords-managed-set`.
5. **Flag-OFF drift / leaking new UI onto all four tabs.** Mitigation: gate every outside-tabs move; snapshot test in every phase's checklist; remove the leak only in P4.
6. **Per-card Send-to-client (universal-mechanism violation).** Mitigation: the PM gate (graft 5) + pr-check `strategy-send-must-route-through-lifecycle`; route everything through `sendRecommendation()`; client renderer behind `strategy-competitor-send`.
7. **Signal-fold silently re-deferring + the `ago` bug riding along.** Mitigation: `ago` fix lands in P1 (decoupled); the fold is a named P4 deliverable behind `strategy-signal-fold` with a zero-standalone acceptance test.
8. **Keep-flag on a delete-then-reinsert table for clusters/gaps.** Mitigation: `tracked_actions` durable pattern (graft 4); review blocks any `keep_flag` column on `topic_clusters`/`content_gaps`.
9. **Information-overload recurrence.** Mitigation: `useShowMore` before any surface ships; block inline `.slice` without show-more.
10. **What Changed demoted in the first revision.** Mitigation: Orient → What Changed → cockpit order requires explicit owner sign-off to change.

---

## 9. Reuse vs net-new summary

**Reuse (~90%):** `StrategyCockpit` + `CockpitRow` + `cockpitRowModel.ts` + `recCategoryMap.ts`; the two-axis lifecycle (`recommendation-lifecycle.ts`, `recommendations.ts` — `isActiveRec`, `applyLifecycleCarryOver`, `isExemptFromAutoResolve`); the send spine (`sendRecommendation`, `REC_POLICY_REGISTRY`, the cannibalization deliverable adapter, `clientActions.ts`, `DeliverableDetailModal`, `decision-renderers`); `StrategyRecommendationPayload` (declared, unconsumed); `CannibalizationTriage` (built, orphaned); the `tracked_actions` durable-state pattern; `useToggleSet`; `useKeywordFeedback`/`feedback.addRequestedKeyword`; `buildHubDeepLinkQuery`; `StrategyDiff`; the `fixContext` carrier; UI primitives.

**Net-new (named, minimal):**
- `src/hooks/useShowMore.ts` (P1)
- `WhyHowResult` presenter (`src/components/strategy/shared/WhyHowResult.tsx`) (P3)
- `mintSignalRecs()` in `server/recommendations.ts` (P4) — **mint-at-gen, graft 2**
- `strategy_keyword_set` table + migration 139 + `server/domains/strategy/managed-keyword-set.ts` + `shared/types/strategy-keyword-set.ts` (P3) — **dedicated table, graft 1**
- `WS_EVENTS.STRATEGY_KEYWORD_SET_UPDATED` + handler + 3 activity types (P3)
- `tracked_actions` enum values `topic_cluster_keep`/`content_gap_keep` + `ActionType` union entries (P3) — **graft 4**
- 6 new optional fields on the EXISTING `FixContext` (`src/App.tsx:77-98`) + all four receiver layers reading them (`ContentBriefs.tsx:469-491` → `content-brief-generation-job.ts:29-42` + `routes/jobs.ts:287-288` → `content-brief.ts:1219-1230`) (P3)
- `competitor` RecType — union value + the 5-map/registry lockstep (`REC_POLICY_REGISTRY` + `REC_TYPE_ACT_CATEGORY` + `REC_TYPE_ADMIN_TAB` + `REC_TYPE_TAB` + `TYPE_ICONS`); competitor copy via the existing `WhyHowResult` presenter, no new whyLine branch (§3.3, §5.2) (P4)
- Child flags: `strategy-keywords-managed-set` (P3), `strategy-competitor-send` (P4), `strategy-signal-fold` (P4)
- pr-check rules: `incomplete-rec-filter` (P3), `strategy-send-must-route-through-lifecycle` (P3, graft 5)

---

## 10. Locked design summary (one screen)

- **Tabs:** `overview | content | rankings | competitive` (ids unchanged; "Rankings" label → "Keywords & Rankings").
- **Overview pipeline:** nudges → Orient → **What Changed (above cockpit)** → Cockpit (signals folded as real recs; gaps/clusters/cannibalization as rec rows) → collapsed config. **Divider deleted.**
- **Keywords & Rankings:** managed Site Target Keywords + Keyword Opportunities (send) + Client Feedback log + Ranking Distribution + Position Movements + Hub deep-link.
- **Content:** Content Gaps (managed/`tracked_actions`/send/brief-preseed) → CannibalizationTriage (actionable) → Topic Clusters (managed/`tracked_actions`) → Decaying Pages (send).
- **Competitive:** Share of Voice → Competitor comparison (send, `competitor` RecType) → Keyword gaps → Backlinks.
- **4 global patterns:** scannable (`useShowMore`), why→how→result (`WhyHowResult`), one send mechanism (`sendRecommendation`/deliverable, PM-gated), consolidated config + Local SEO dedup.
- **Storage:** dedicated `strategy_keyword_set` (reconciler-only writer grafted into `persistKeywordStrategy`'s `writeKeywordStrategy` txn — NOT `saveRecommendations()`, which has no txn); `tracked_actions` keeps for clusters/gaps; signals minted as real recs at gen time. No `tracked_keywords` curation column (clobber-unsafe). No new `ClientActionSourceType`.
- **Flags:** `strategy-command-center` umbrella + `strategy-keywords-managed-set`, `strategy-competitor-send`, `strategy-signal-fold` children. Flag-OFF byte-identical every phase.
- **Phasing:** P1 visible wins (trust-recovery gate, blocks all later phases) → P2 IA move (contracts pre-committed) → P3 money + managed sets (single migration) → P4 consolidation + fold + competitor.

This plan is ready for `writing-plans` task-level expansion. Each phase is one flag-gated PR; the PM send-gate (graft 5) and the trust-recovery gate (graft 6) are enforced during task expansion and PR review.
