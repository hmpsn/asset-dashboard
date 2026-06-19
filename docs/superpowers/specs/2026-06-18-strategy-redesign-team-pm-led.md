# Strategy Page Redesign — Team "pm-led" Spec

> **Status:** proposed · **Date:** 2026-06-18 · **Owner team:** pm-led (Product Manager leading)
> **Flag:** `strategy-command-center` (existing; `shared/types/feature-flags.ts:59`) + 2 net-new child flags
> **Branch off:** `staging` (the v3 cockpit + lifecycle are already on staging behind the flag)
> **Decision lens (PM):** product coherence, the send-to-client monetization spine, scope discipline (YAGNI), and sequencing for visible wins. Where teammates conflict, I resolve toward what ships operator-visible value soonest and reads as one coherent product — and I say why inline.

---

## 0. Goal & Non-Goals

### Goal
Fix the **information architecture + usability layer** of the admin Strategy page so the operator's reaction — *"nothing looks different; keyword stuff never moved; what-changed never moved up"* — is answered on first load. The Strategy v3 curation cockpit + lifecycle engine (`StrategyCockpit`, `server/recommendation-lifecycle.ts`, the two-axis model) are correct and stay. We **reorganize the visible surfaces around the cockpit** and apply four build-once-reuse global patterns.

The single success test (Designer's framing, adopted): **an operator opening the page can answer "what needs my attention right now?" in under 10 seconds.**

### Non-Goals (explicit YAGNI cuts — PM decision)
1. **No per-row recommendation table.** The whole-blob `RecommendationSet` storage (`shared/types/recommendations.ts:82`, written by `saveRecommendations()`) stays. A per-row table is roadmap-deferred and nothing here needs it.
2. **No Backlinks split to a `links` page in this redesign.** The route exists in `src/routes.ts`, but all three teammates converge on *defer*. A fifth tab breaks the `TabBar` mobile limit (4), triggers the route-removal/addition checklist + `navRegistry.tsx`, and risks a near-empty page. **PM call: keep `BacklinkProfile` in Competitive; revisit in a dedicated competitive-intelligence sprint.** (Designer + Engineer + PM all agree; this closes the foundation's open question.)
3. **No new `ClientActionSourceType`** for keyword opportunities / competitor items. They route through the rec lifecycle `clientStatus` path (`sendRecommendation()`). The 6-part lockstep is reserved for items that genuinely need a bespoke client renderer (cannibalization already has one; nothing new does).
4. **No paid-topic monetization spine.** That is `strategy-paid-topics` (DEFERRED, already flagged off). Add-to-plan renders only where `rec.productType` already resolves a SKU.
5. **No redesign of `LocalSeoVisibilityPanel` internals.** It already supports `mode="strategy"`. We make a placement decision and remove one duplicate render — not a component rewrite.
6. **No client-facing UI changes.** Public projection (`stripEmvFromPublicRecs()`) already covers `clientStatus`; the client just sees more rec rows. We touch zero `src/components/client/` files except to confirm the existing `CannibalizationRenderer` path is reused.

---

## 1. Tab IA + Render Order (all 4 tabs)

Four tabs, each with one job. **The literal tab `id`s in `KeywordStrategy.tsx` stay `overview | content | rankings | competitive`** — only the *display label* of `rankings` changes. This is the `?tab=` two-halves contract: the contract test `tests/contract/tab-deep-link-wiring.test.ts` scans the file for these literals (`KeywordStrategy.tsx:51`). Changing an id is a silent deep-link break.

```
STRATEGY_INTERIOR_TABS = [
  { id: 'overview',    label: 'Overview' },
  { id: 'content',     label: 'Content' },
  { id: 'rankings',    label: 'Keywords & Rankings' },   // ← label-only rename
  { id: 'competitive', label: 'Competitive' },
]
```

### ① Overview — *decide & act* (render order top→bottom)
The current order inverts cognitive priority (Orient → Cockpit → buried What Changed → a passive "Reference & Analysis" wall). New locked order:

1. `feedbackNudgeEl` → `realLeaves.stalenessNudges` (unchanged transient nudges, stay at very top)
2. **`StrategyDiff` (What Changed)** — **PROMOTED from line 419 to here.** Keep its intentional amber-bordered non-`SectionCard` chrome (`StrategyDiff.tsx:41` has a `pr-check-disable` line — do **not** "fix" it into a SectionCard). It self-hides when `!hasChanges`, so on a no-change strategy the page opens on Orient — correct.
3. **`orientEl`** (OrientZone — visibility score + clicks/impressions/position). Blue data tokens.
4. **The Cockpit** — `(cockpitEl ?? actQueueEl) ?? {quickWins, lhf, keywordGaps}` fallback chain is **unchanged** (preserves the `useActQueue`/`hasActiveRecommendations` gate exactly). Intelligence Signals **fold in here** as rec rows (P4); cannibalization/gaps/clusters surface as cockpit rec rows that **open their rich cards**, not flattened.
5. **Collapsed "Strategy config" accordion** (P4) — Settings + Local SEO config, zero visual weight until opened.

**Deleted from Overview:** the "Reference & Analysis" divider and everything below it. `siteKeywords` + `opportunities` → move to Keywords & Rankings (P2). `cannibalization` → re-homed as actionable `CannibalizationTriage` in **Content** (P3). `intelligenceSignalsEl` → folded into cockpit + standalone card deleted (P4). `StrategyHowItWorks` → **deleted from Overview**, moved to a `?` tooltip on `PageHeader` (Designer's call, PM-approved: removes ~80px of dead vertical space; operators read it once).

### ② Keywords & Rankings (the big visible move — P2)
Render order:
1. **Site Target Keywords** — the curated managed working set (add/remove/keep + auto-replenish + search-and-add + add-from-client-requests). A true "top 10–20 we're actively targeting" slice, **distinct from the Keyword Hub universe, not a mirror.**
2. **Keyword Opportunities** — per-row "Send to client — interested in this one?" (routes through `sendRecommendation()`; approval joins the target set).
3. **Client Keyword Feedback log** — the approved/declined/requested history (`ClientKeywordFeedback`) **moves here** from its current always-rendered-outside-tabs leak.
4. Ranking Distribution + Position Movements (the current `StrategyRankingsTab` content).
5. **Local SEO visibility panel** (results) — its one home (PM decision below).
6. **"Open the Keyword Hub" deep-link** — `buildHubDeepLinkQuery()` + `adminPath(ws, 'seo-keywords')` for the full universe/research.

### ③ Content — *the money page* (P3)
Render order (keep the `hasContentTabContent` EmptyState guard):
1. **Content Gaps** — managed + Send-to-client + briefs **pre-seeded with the gap's full computed context** (not a bare keyword).
2. **Topic Clusters** — managed-set add/remove/keep + research-seed + why/how/result narrative.
3. **Decaying Pages** — `DecayingPagesCard` + "Should we refresh this?" Send-to-client (`content_decay` source type — already registered).
4. **Cannibalization** — re-homed as the **actionable `CannibalizationTriage`** (pick-the-keeper + Send-to-client). Today Overview shows passive `CannibalizationAlert` while `CannibalizationTriage` is orphaned (`index.ts:38`).

### ④ Competitive (light touch)
Render order (current `StrategyCompetitiveTab`): Share-of-voice (`ShareBar`) → `CompetitiveIntel` (with action/Send-to-client added, P4) → `BacklinkProfile` (stays here — non-goal #2) → keyword gaps (`KeywordGaps`).

---

## 2. Per-Surface Behavior — Reuse vs Net-New

| Surface | Behavior | Reuse | Net-new |
|---|---|---|---|
| **What Changed** | Promote to top of Overview. Self-hides when no changes. | `StrategyDiff.tsx` (100% reuse — JSX reorder only). `GET …/strategy-diff`, `queryKeys.admin.strategyDiff`, `strategy:updated` refetch. | **Nothing.** Verify `STRATEGY_UPDATED` still fires on every `addStrategyHistoryEntry` call site (Engineer's grep gate). |
| **Scannable lists** | Cap ~5 + "Show N more"; compact card; no layout shift; no scroll-in-scroll. | The cockpit's `FIX_NOW_CAP=5` (`cockpitRowModel.ts:3`) is the reference. `StrategyDiff` already expand/collapses. | **`useShowMore(items, cap=5)` hook + `<ScannableList>` wrapper** in `src/components/ui/`. Applied to ContentGaps, TopicClusters, KeywordOpportunities, competitor gaps. This is the #1 build-once-reuse miss today. |
| **Why → how → result** | Every actionable card shows: **Why** (data-backed, Blue metric) → **How** (action verb, Teal CTA) → **Result** (impactBand/estimatedGain; Emerald positive, amber uncertain). Progressive disclosure on expand. | Data already on objects: rec `insight`/`estimatedGain`/`impactBand`; gap `rationale`/`competitorProof`/`volume`/`intent`; cluster `topCompetitor*`. `CockpitRow` already renders the clamped `whyLine`. | A **consistent 3-tier presenter** rendering the *how* + *result* tiers (today only why shows). Every tier needs a fallback label — never an empty tier (Designer risk). |
| **Site Target Keywords** | Passive list → managed set: Keep (default, no badge) / Remove (red border + undo, frees a slot) / Add (teal border). `useToggleSet` with `min=1`. Auto-replenish animates a new teal row in. Inline search-and-add combobox at list bottom (not a modal). | `SiteTargetKeywords.tsx`, `useTrackKeyword`, `keywordTracking.ts`, `useToggleSet({min,max})`, `buildHubDeepLinkQuery`. | The **managed-set write path** (§3) + replenish logic + search endpoint. |
| **Keyword Opportunities** | Per-row "Send to client — interested in this one?" (teal **outline** button — visually distinct from solid "Send to client" content sends). Approval joins target set. | `KeywordOpportunities.tsx`, the rec `send` route, `StrategyRecommendationPayload` (typed, unconsumed). | A **`StrategyRecommendationPayload` → rec adapter** so a non-rec opportunity becomes a sendable rec via `clientStatus`. **No new source type.** |
| **Content Gaps** | Managed + Send-to-client + brief pre-seed. | `ContentGaps.tsx`, the `fixContext` navigation-state carrier, `ContentGapRow`. | Extend `fixContext` payload (§2.1) + the brief receiver to carry `rationale`/`competitorProof`/`volume`/`intent`/`questionKeywords`/`serpFeatures` — today both CTAs (`ContentGaps.tsx:78,86`) drop all of it. |
| **Topic Clusters** | Passive list → managed-set add/remove/keep + research-seed + why/how/result. | `TopicClusters.tsx`, the managed-set hook/store shared with Site Target Keywords. | Managed-set semantics applied (shares the §3 durable store pattern). |
| **Decaying Pages** | Add "Send to client — should we refresh?" | `DecayingPagesCard.tsx`, `clientActions.create(ws, { sourceType: 'content_decay', … })` — **the backend is done** (source type registered, deliverable spine handles it). | A single "Send to client" button wiring (no adapter, no new source type). |
| **Cannibalization** | Swap passive → actionable. | **`CannibalizationTriage.tsx` (100% built)** — keeper-pick (`keeperPathOf`), Fix-in-editor, Mark-resolved (`cannibalization_resolved` outcome), Send-to-client (`cannibalization` adapter). Resolution inferred from durable `tracked_actions` (`CannibalizationTriage.tsx:84`). | **One import swap** in the new IA. Keep `CannibalizationAlert` alive (ContentPipeline imports it). |
| **Intelligence Signals** | Fold into cockpit as rec rows; delete standalone card; fix double-"ago". | `StrategyCockpit` rec rows, `recCategoryMap.ts`, `useIntelligenceSignals`, `applyLifecycleCarryOver` (regen stability). | **Server-side** `mintSignalRecs(signals, existingRecs)` in `server/recommendations.ts` (Engineer's call — *not* a client-side mapper, which forks the read path). Delete `intelligenceSignalsEl` + fix `Computed X ago ago` (`IntelligenceSignals.tsx:49`) **same commit**. |
| **Config consolidation** | Settings + Local SEO config → one collapsed "Strategy config" accordion. Dedup Local SEO panel from Strategy↔Hub. | `StrategySettings`, `LocalSeoVisibilityPanel` (`mode="strategy"`). | Accordion wrapper + one duplicate-render removal (touches both `KeywordStrategy.tsx` and `KeywordHub.tsx` same commit). |

### 2.1 Brief pre-seed contract (`ContentGapFixContext`)
Extract the currently-inline `fixContext` shape to a typed interface in `shared/types/` (Engineer's requirement — it must be a shared contract before extending):

```ts
// shared/types/content-gap.ts (or co-located strategy types)
export interface ContentGapFixContext {
  targetRoute: string;
  primaryKeyword: string;
  pageType?: string;
  autoGenerate?: boolean;
  // net-new pass-through (all .optional() — existing callers without them must not 400):
  rationale?: string;
  competitorProof?: string;
  volume?: number;
  intent?: string;
  questionKeywords?: string[];
  serpFeatures?: string[];
}
```
The brief-generator receiver validates with Zod, **all new fields `.optional()`** so existing navigation-state callers stay valid (Zod clearable/optional rule).

---

## 3. Data Model — curated keyword set / managed sets / universal send

### 3.1 Curated keyword managed-set (the highest-risk net-new thing)

**PM decision (resolving the teammate split):** the Engineer's column-on-`tracked_keywords` approach wins over the PM's earlier "new `strategy_managed_keywords` table" instinct and the Designer's "new column on the strategy blob" suggestion. **Why:** `tracked_keywords` is already the authoritative keyword-lifecycle table and already survives regen (it is **not** delete-then-reinsert — that trap is `keyword_gaps`/`topic_clusters`/`cannibalization_issues`). A second table creates a join contract that diverges on every reconcile pass; the strategy blob is read-only and rewritten on regen. The column approach is the same decoupling pattern the team already chose twice (migrations 121 `strategy_owned`, 122 `sort_order`).

**Storage:** migration ~139 adds `curated_include INTEGER` (three-state, NO DEFAULT — mirrors `strategy_owned`) to `tracked_keywords`:
- `1` = operator pinned-in (survives regen)
- `0` = operator removed (excluded from replenish refill)
- `NULL` = strategy-managed default

**Reconcile shield (the cross-module trap the Engineer flagged — MANDATORY).** `tracked_keywords` already has an `isProtected()` guard (`server/rank-tracking-reconciliation.ts:71`) that shields `pinned` / client-requested / manual / gap keywords from auto-deprecation even when `strategy_owned===true`. **The managed-set "keep" must join that guard:** a `curated_include === 1` keyword must never be auto-deprecated. PM decision on *how*: **extend `isProtected()` to include `keyword.curatedInclude === true`** rather than reuse the existing `pinned` flag — `pinned` has its own client-facing semantics and overloading it would conflate operator-curation with the existing pin behavior. One added clause in `isProtected()`, same commit as the migration. Miss this and the operator's curated set silently empties on the next regen (the #1 silent-data-loss class).

**Replenish logic** (`reconcileCuratedTargetSet(workspaceId, strategy)`, called inside the existing regen transaction in `server/keyword-strategy-persistence.ts`):
```
cap            = workspace-configured target cap (default 15)
pins           = rows WHERE curated_include = 1
slotsToFill    = cap − pins.length
fill           = strategy.opportunities ORDER BY opportunity_score DESC
                 EXCLUDING rows WHERE curated_include = 0
                 LIMIT slotsToFill
```

**Search-and-add endpoint:** `POST /api/strategy/:ws/keywords/curated` → sets `curated_include = 1`, calls `trackKeyword()` if not already tracked. Must call `assertKeywordNotAlreadyTargeted(workspaceId, normalized)` (the dedup guard `rank-tracking.ts` already uses) before insert. **Broadcast `WS_EVENTS.STRATEGY_UPDATED`** after write; frontend handler invalidates `queryKeys.admin.strategy`. No new WS event. `addActivity()` on the curate/remove mutation.

**Removal:** `curated_include = 0` (not a delete — the keyword stays tracked, just drops from the curated working set and is excluded from replenish refill).

**Volume enrichment for manually-added keywords is deferred** (Engineer's cut): add/remove/keep storage + UI ship first; DataForSEO volume enrichment for hand-added keywords comes from a `site_keyword_metrics` upsert on a background pass, **not blocking the add call**. This keeps P3 add latency low.

### 3.2 Universal send-to-client (ONE mechanism — PM non-negotiable)

**Rule (PM + Engineer enforce in plan review):** no new `clientActions.create()` call in any strategy leaf. Every new send takes one of two existing paths:

| Item | Path | Why |
|---|---|---|
| Keyword opportunity | `sendRecommendation()` → `clientStatus = 'sent'` via `StrategyRecommendationPayload` → rec adapter | Client sees a rec row; no bespoke renderer needed |
| Decaying page | `clientActions.create(ws, { sourceType: 'content_decay', … })` | Source type + deliverable spine **already built** |
| Competitor item | `sendRecommendation()` → `clientStatus` | Client sees a rec row; no bespoke renderer |
| Cannibalization | `clientActions.create(ws, { sourceType: 'cannibalization', … })` | Already built; bespoke `CannibalizationRenderer` exists |

The send routes through `REC_POLICY_REGISTRY[type].sendChannel` (`server/recommendation-lifecycle.ts:35-51`): `'rec'` mutates `clientStatus`; `'deliverable'` routes content_decay/cannibalization to the deliverable spine. **The two-axis invariant holds: send NEVER writes `RecStatus`.** Public projection allow-list (`stripEmvFromPublicRecs()`, `routes/recommendations.ts:84`) already covers `clientStatus` — no allow-list change for these sends.

**PM gate:** any task saying "build a send adapter for X" must answer *which rec lifecycle route* and *why a new source type is required*. The only acceptable "new source type" answer is "the client needs a custom renderer" — otherwise the task is rewritten to use `sendRecommendation()`.

### 3.3 What Changed source (unchanged, documented for completeness)
`strategy_history` table, capped 5 rows/workspace (`keyword-strategy-persistence.ts:60-92`), snapshotted inside the write txn. Diff computed in `keyword-strategy-ux.ts`, served by `GET …/strategy-diff`.

---

## 4. The Four Global Patterns — Implementation

1. **Scannable** — `useShowMore(items, cap=5)` + `<ScannableList>` in `src/components/ui/`. Wraps (does not duplicate) the cockpit's `FIX_NOW_CAP`. Top-5 must be the **most actionable 5, sorted server-side** (Designer risk: cap must not bury must-act items; for the cockpit Fix-Now this is already urgency-filtered). Cap stays 5 on mobile.
2. **Why → how → result** — the 3-tier presenter (§2). Every tier has a fallback label; never an empty tier. This is both operator-trust and a client-send prerequisite (you cannot send what you cannot see the projected result for).
3. **Send-to-client = ONE mechanism** — §3.2. Enforced by a **net-new pr-check rule** blocking new `clientActions.create()` in `src/components/strategy/` leaves without routing through the shared paths (Designer + Engineer + PM all asked for this).
4. **Consolidate config** — Settings + Local SEO config → one collapsed accordion; Local SEO **visibility panel** gets one home. **PM placement decision (resolving the Strategy-vs-Hub-vs-both question):** the visibility *panel* lives in **Keywords & Rankings** (it is strategy-scoped data, not universe-scoped), with a deep-link from the Hub. Config (location/market) folds into the Strategy config accordion. Both the Strategy-side move and the Hub-side dedup land in the **same commit** (Designer's correctness gate — half a move leaves a stale duplicate).

---

## 5. `?tab=` + Flag-Gating + Flag-OFF Parity

### `?tab=` two-halves
Already wired (`resolveTabSearchParam` + sync effect, `KeywordStrategy.tsx:67-79`). The `rankings` label rename keeps the id literal, so the contract test (`tests/contract/tab-deep-link-wiring.test.ts`) still passes. v3's parallel `?rec=` client-wayfinding contract is untouched.

### Flag-gating
- **Parent flag:** `strategy-command-center` (existing) gates all net-new admin UI.
- **2 net-new child flags** (add to `shared/types/feature-flags.ts` + `FEATURE_FLAG_CATALOG` BEFORE first commit; `npm run verify:feature-flags` gate):
  - `strategy-managed-keyword-set` — gates the curated working-set add/remove/keep + replenish + search (P3). Lets the Keywords & Rankings *move* (P2) ship before the *write path* is proven.
  - `strategy-signal-fold` — gates `mintSignalRecs` + the standalone-card deletion (P4). The riskiest change gets its own kill switch.
  Both: `group: 'Strategy'`, `owner: 'analytics-intelligence'`, `rolloutTarget: 'staging-validation'`.

### Flag-OFF parity (the silent killer — PM puts this in every phase's acceptance checklist)
Flag-OFF must stay **byte-identical to today**. Today flag-OFF already renders the 4-tab command-center IA with the **v2 ActQueue** (not the cockpit) — the flag's narrow job is "v3 cockpit vs v2 act queue." Critical leaks to respect:
- `clientFeedbackCombinedEl` + `settingsEl` already render **outside** the tabs unconditionally (`KeywordStrategy.tsx:392`). Moving `ClientKeywordFeedback` → Keywords & Rankings and `StrategySettings` → the config accordion must be **flag-gated** so flag-OFF keeps them exactly where they are.
- `localSeoEl` renders on **every** tab today; deduping touches both `KeywordStrategy.tsx` and `KeywordHub.tsx`.
- **Gate:** the byte-identical-OFF snapshot on the **real public read** (`tests/integration/recommendations-public-allowlist.test.ts`) + a flag-OFF render snapshot of `KeywordStrategyPanel`. Run explicitly in **each** phase's acceptance checklist, not just final quality gates.

---

## 6. Phasing — front-load visible wins, phase-per-PR, staging-first

> Never open phase N+1 until N is merged and green on `staging`. Each phase = one PR.

### P1 — "the page looks different on first load" (one PR, fast, zero new surfaces)
- Promote `StrategyDiff` (What Changed) to top of Overview.
- Build `useShowMore` + `<ScannableList>`; apply to ContentGaps, TopicClusters, KeywordOpportunities, IntelligenceSignals.
- Fix the `Computed X ago ago` double-"ago" bug (`IntelligenceSignals.tsx:49`) in the same commit (it must not ride to staging un-fixed).
- Move `StrategyHowItWorks` → `PageHeader` `?` tooltip.
- **No structural moves, no new send paths, no managed-set.**
- *PM rationale:* this is the trust-recovery PR. The operator sees the two things they said were broken (What Changed buried, the unscrollable wall) fixed in one afternoon's worth of changes. **Block P2+ until this is on staging and the operator has seen it.**

### P2 — the big visible move (one PR)
- Rename `rankings` label → "Keywords & Rankings" (id unchanged).
- Move `SiteTargetKeywords` + `KeywordOpportunities` + `ClientKeywordFeedback` into that tab (flag-gated; flag-OFF keeps them where they are).
- **Pre-commit the managed-set contract:** migration 139 `curated_include` column + the `isProtected()` shield clause + `ContentGapFixContext` shared type + the 2 child flags — even though the P3 write-path UI isn't built yet. (Parallel agents need pre-committed shared contracts; PM's hardest-learned lesson.)

### P3 — the money + the managed set (one PR)
- Managed-set write path: `reconcileCuratedTargetSet`, `POST …/keywords/curated`, add/remove/keep UI, auto-replenish, inline search-and-add (volume enrichment deferred to background).
- Swap `CannibalizationAlert` → `CannibalizationTriage` in Content.
- Universal Send-to-client wiring: keyword opportunities (`StrategyRecommendationPayload`→rec adapter) + decaying pages (`content_decay`).
- Brief pre-seed: extend `fixContext` + Zod receiver.
- Why/how/result 3-tier presenter applied to cockpit rows + content gaps.
- *PM rationale:* the monetization spine lands here, **after** the send infra is verified end-to-end on existing rec types. A half-baked send trains the operator not to trust the button — worse than no send.

### P4 — the riskiest + the cleanup (one PR)
- Signal-fold: server-side `mintSignalRecs`, delete `intelligenceSignalsEl` + the standalone card. Acceptance: zero standalone signals; each signal type verified as a cockpit row in the correct category facet.
- Config consolidation: Settings + Local SEO config → collapsed accordion; Local SEO panel deduped (Strategy + Hub, same commit).
- Competitor Send-to-client.
- Clean up the orphaned-leaf list in `src/components/strategy/index.ts:28-42` (only those now genuinely wired).
- *PM rationale:* the signal-fold has real design risk (which signal types → which rec categories) and has slipped once already (v2 Task 2.2). It gets its own kill flag and lands last so it gates **no** earlier client value.

---

## 7. Testing

| Phase | Tests |
|---|---|
| **Every phase** | Flag-OFF byte-identical snapshot of `KeywordStrategyPanel` + the real public-read allow-list test (`recommendations-public-allowlist.test.ts`). `?tab=` contract test (`tab-deep-link-wiring.test.ts`) green. `npm run verify:feature-flags`. |
| **P1** | `useShowMore` unit test (cap, show-more, no layout shift). Snapshot: What Changed renders above OrientZone. Assert no `Computed … ago ago`. |
| **P2** | Tab label "Keywords & Rankings" with id `rankings`. Flag-gated move: flag-OFF keeps `ClientKeywordFeedback`/`StrategySettings` outside tabs. Migration 139 applies; `curated_include` three-state read. |
| **P3** | **Reconcile shield test (CRITICAL):** a `curated_include=1` keyword survives a regen that drops it from `siteKeywords` (asserts `isProtected()` clause). Replenish fills exactly `cap − pins`, excludes `curated_include=0`. `POST …/keywords/curated` dedups via `assertKeywordNotAlreadyTargeted`. Send-via-`sendRecommendation` sets `clientStatus='sent'` and **never** `RecStatus` (extend the `strike-never-completed` exit-gate family). Brief pre-seed: extended `fixContext` validates; a caller without new fields does not 400. Cannibalization swap: `CannibalizationTriage` renders, `CannibalizationAlert` still imports clean in ContentPipeline. |
| **P4** | `mintSignalRecs` dedups by `insightId`/`sourceKey`; carry-over keeps lifecycle across regen. Zero standalone signal cards post-fold. Local SEO panel renders exactly once across Strategy + Hub. |

Use `createEphemeralTestContext(import.meta.url)` for spawned-server integration tests; never bind fixed ports.

---

## 8. Risks

| Risk | Mitigation | Owner-of-risk |
|---|---|---|
| **Curated set silently empties on regen** (reconcile auto-deprecation ignores `curated_include`) | The `isProtected()` clause + its dedicated test ship in the **same commit** as migration 139. Cross-module file no task "owns" — PM names it explicitly in the P3 plan. | Engineer |
| **Re-conflating the two lifecycle axes** | Every new rec-listing/counting surface routes through `isActiveRec()`; send/strike/throttle never write `RecStatus`. Extend the `strike-never-completed` exit-gate family. | Engineer |
| **Send built per-card** | pr-check rule (pattern 3) blocks new `clientActions.create()` in strategy leaves. PM plan-review gate on every "send adapter" task. | PM |
| **Flag-OFF drift / new UI leaking onto all tabs** | Byte-identical-OFF snapshot in **every** phase's acceptance checklist; flag-gate every move of `clientFeedbackCombinedEl`/`settingsEl`/`localSeoEl`. | All |
| **Signal-fold re-defers + double-"ago" rides along** | Double-"ago" fixed in **P1** independent of the fold. Fold gets its own `strategy-signal-fold` flag + a concrete zero-standalone acceptance test in P4. | PM |
| **Why/how/result ships incomplete** (result tier blank when `estimatedGain` null) | Every tier defines a fallback label before landing — never an empty tier. | Designer |
| **Local SEO dedup lands half-done** | Strategy move + Hub dedup in the **same commit**; test asserts exactly-one render. | Designer |
| **Orphan-leaf assumption** (`index.ts:28-42` claims components re-homed that never were — `CannibalizationTriage` is the proof) | Audit each leaf's actual importers before assuming wired; only clean up genuinely-wired leaves in P4. | Engineer |

---

## 9. Net-New Inventory (kept minimal — every item named)

**Net-new files/exports:**
- `src/components/ui/` — `useShowMore` hook + `<ScannableList>` (P1)
- `shared/types/` — `ContentGapFixContext` interface (P2)
- `server/db/migrations/139-*.sql` — `curated_include` column (P2/P3)
- `server/keyword-strategy-persistence.ts` — `reconcileCuratedTargetSet()` (P3)
- `server/routes/strategy*.ts` — `POST /api/strategy/:ws/keywords/curated` (P3)
- A `StrategyRecommendationPayload` → rec adapter (consumes the already-typed, unconsumed interface) (P3)
- `server/recommendations.ts` — `mintSignalRecs()` (P4)
- 2 child feature flags + 1 pr-check rule (send-spine guard)

**Everything else is reuse:** the recommendation engine, the v3 single-writer/lifecycle, `CannibalizationTriage`, the deliverable adapter spine, `sendRecommendation()`, `StrategyDiff`, `useToggleSet`, `useTrackKeyword`, the intelligence slices, the design-system primitives, the `fixContext` carrier, and the existing flag.
