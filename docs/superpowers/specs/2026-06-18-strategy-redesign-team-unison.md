# Strategy Page Redesign (the redesign-of-the-redesign) — Team UNISON spec

**Date:** 2026-06-18
**Team:** unison (balanced lead — product, engineering, design weigh equally)
**Status:** spec, ready for `pre-plan-audit` → `writing-plans`
**Flag:** existing `strategy-command-center` (no new umbrella flag) + two narrowly-scoped child flags
**Branch base:** continues the v3 line (cockpit + lifecycle already merged to staging behind the flag)

---

## 0. Why this exists (the problem statement)

Strategy v3 (Phases 0–3) built a real **recommendation curation cockpit + two-axis lifecycle engine** and merged it to staging behind `strategy-command-center`. But it left the **visible information architecture untouched**, so the operator's verdict was: *"nothing looks different; keyword stuff never moved; What Changed never moved up."* That is a **product failure expressed through the IA layer**, not an engine failure. The engine is good and invisible.

This work fixes the IA + usability layer **on top of** the existing cockpit and lifecycle. We reorganize everything around the cockpit; we do not rebuild it. Net-new code is minimal and named. The single test of success: an operator opens the page in Phase 1 and *immediately sees the page has changed* — before any plumbing-heavy phase ships.

### The balanced-lead lens (how UNISON decides)

Product, engineering, and design each get an equal vote. Where they conflict we name the trade and pick the integrated optimum:

- **Product** wants the visible win first and the monetization spine protected.
- **Engineering** wants durable storage decisions that don't re-create the migration-121 laundering bug, and zero new `ClientActionSourceType`s.
- **Design** wants one scannable pattern, one send affordance, and the "What Changed" promotion locked.

These three rarely conflict here — the unusual property of this redesign is that the cheapest engineering path (reuse the cockpit row + rec lifecycle) is *also* the best UX path (one consistent surface) *and* the best product path (ship visible wins without new infrastructure). The two real trades are called out in §11.

---

## 1. Goal + non-goals

### Goals

1. **Promote "What Changed" to the top of Overview.** It is currently buried at the bottom (the operator's loudest complaint). Pure JSX reorder.
2. **Make every long list scannable** via ONE shared primitive (cap ~5 + "show more" + progressive disclosure), not per-card ad-hoc caps.
3. **Re-home the keyword surfaces** out of Overview into a renamed **"Keywords & Rankings"** tab, and give them a curated **managed working set** (add/remove/keep, auto-replenish, search-and-add).
4. **Make Content the money page:** managed Content Gaps with pre-seeded briefs, managed Topic Clusters, Decaying Pages with send, and the **actionable `CannibalizationTriage`** swapped in for the passive `CannibalizationAlert`.
5. **Universalize Send-to-client** through the existing rec lifecycle / deliverable spine — never per-card.
6. **Fold Intelligence Signals into the cockpit** as rec rows and delete the standalone card (fixing the `Computed X ago ago` bug in the same pass).
7. **Consolidate Settings + Local SEO config** into one collapsed "strategy config" entry; dedupe the Local SEO panel that renders in both Strategy and the Keyword Hub.
8. Surface **why → how → projected result** uniformly on every rec / gap / cluster — both an operator-trust and a client-send prerequisite.

### Non-goals (explicit cuts)

- **Per-row recommendation table.** The whole-blob `RecommendationSet` storage stays (`server/recommendations.ts`). Deferred to roadmap, as before.
- **Splitting Backlinks to its own `links` page.** The route exists in `src/routes.ts` but `BacklinkProfile` has zero send wiring and the Competitive tab is the lightest. **UNISON position: defer.** It is a nav-level decision affecting the whole admin sitemap, not a Strategy-local change; it carries a route-removal-checklist pass for zero backend logic moved. Revisit after operators use the redesigned Competitive tab. (All three teammates independently agreed to cut it.)
- **A new `ClientActionSourceType` for any strategy surface.** Hard constraint — see §4.
- **A new umbrella feature flag.** Everything ships behind the existing `strategy-command-center`; only two narrow child flags are added (§8).
- **Paid-topic monetization spine.** Already deferred behind `strategy-paid-topics`; out of scope here.
- **Mobile-only redesign.** Mobile breakpoint passes are required *within* each phase (§9), not a separate workstream.

---

## 2. Current state (grounded, so every later claim is anchored)

Orchestrator: `src/components/KeywordStrategy.tsx` (exported `KeywordStrategyPanel`, 463 lines). **There is exactly one layout today** (`strategyLayout`, line ~383). The legacy sequential layout was already deleted in the v2 cutover. The `commandCenterEnabled` flag (`useFeatureFlag('strategy-command-center')`) now only swaps **cockpit (ON) vs v2 ActQueue (OFF)** *inside Overview* — it is NOT a whole-page fork. **Flag-OFF today already renders the 4-tab command-center IA** with the v2 ActQueue.

Gates that every new surface must respect:
- `isRealStrategy = strategy?.generatedAt != null`. A server shell (`generatedAt: null`) renders the empty state, not the tabs. `realLeaves` is null unless `isRealStrategy && strategy`.
- `useActQueue = isRealStrategy && hasActiveRecommendations`. The cockpit/ActQueue replaces the quick-wins/LHF/keyword-gaps fallback only once the rec set has content.
- `cockpitEl` is built only when `commandCenterEnabled && isRealStrategy`.

**The known leak:** `clientFeedbackCombinedEl` (ClientKeywordFeedback) + `settingsEl` (StrategySettings) + `localSeoEl` (LocalSeoVisibilityPanel) render *outside* the tabs (lines ~387–397), so they bleed onto all four tabs. The inline comment flags this as interim "until StrategyCockpit re-homes them."

Current Overview render order (the JSX, lines ~401–425): `feedbackNudge → stalenessNudges → orientEl → (cockpit ?? actQueue ?? {quickWins, lhf, keywordGaps}) → "Reference & Analysis" divider → cannibalization (PASSIVE CannibalizationAlert) → strategyDiff (What Changed, BURIED) → siteKeywords → opportunities → intelligenceSignals → howItWorks`.

**Orphaned actionable leaves** (`src/components/strategy/index.ts` lines 28–42 — "NOT yet wired… reserved for v3 cockpit. Do NOT delete"): `CannibalizationTriage` (the actionable one — Overview ships the passive `CannibalizationAlert` instead), `OpportunitiesList`, `LostQueryRecoveryCard`, `RequestedKeywordTriage`, `DecisionQueue`. (`NeedsAttentionStrip`, `CurationMeter`, `CurationBulkActionBar` ARE used by `StrategyCockpit`; `DecayingPagesCard` IS wired into Content.)

**Verified importer facts that gate the work:**
- `CannibalizationAlert` is imported by `KeywordStrategy.tsx` AND `ContentPipeline.tsx` → **keep the component; only remove it from Strategy.**
- `CannibalizationTriage` has zero production importers (only its own type/index/self) → confirmed orphan, safe to wire in.
- `tracked_keywords` writes go through `keyword-command-center.ts` using `INSERT … ON CONFLICT(workspace_id, keyword) DO UPDATE` (upsert, NOT delete-reinsert) → **adding curation columns is durable-safe** (mitigates the engineer's top risk; see §3).

---

## 3. Data model for the curated keyword set / managed sets / universal send

This section is the load-bearing engineering decision. Three teammates converged; UNISON locks the integrated version.

### 3.1 Curated keyword managed-set (Site Target Keywords as add/remove/keep)

**Problem:** `strategy.siteKeywords` is a read-only field on the strategy blob (`server/workspaces.ts` ~line 166); regen overwrites it wholesale. The normalized tables (`keyword_gaps`, `topic_clusters`, `cannibalization_issues`) are **delete-then-reinsert on regen** and cannot hold a durable "keep" flag. The precedent for durable state across regen is `CannibalizationTriage.tsx:84–94` — infer durable state from `tracked_actions`, not the regenerable row.

**Decision (LOCKED): extend `tracked_keywords`, do NOT create a new table.**

`tracked_keywords` (migration 118) already has `source`, `pinned`, `strategy_owned`, `status`. Its writer is **upsert** (`ON CONFLICT(workspace_id, keyword) DO UPDATE`), confirmed in `keyword-command-center.ts` — so columns survive regen reconcile. Migration `139-strategy-keyword-curation-set.sql` adds two **orthogonal** columns:

```sql
ALTER TABLE tracked_keywords ADD COLUMN curated_set_position INTEGER;   -- NULL = not curated; 1..20 = slot
ALTER TABLE tracked_keywords ADD COLUMN curated_set_added_at TEXT;      -- ISO; provenance for "added from opportunities" UX
```

No default, no backfill (follows the migration-121 safety model exactly). A keyword is "in the managed set" iff `curated_set_position IS NOT NULL AND status != 'deprecated'`.

**Orthogonality rule (mitigates the laundering-bug class):** `strategy_owned` is written ONLY by reconcile (`server/rank-tracking-reconciliation.ts`). `curated_set_position` / `curated_set_added_at` are written ONLY by the new curation path. They never collide. The upsert preserves curation columns across reconcile because reconcile's `ON CONFLICT DO UPDATE` set-list does not touch them.

**Pre-plan-audit MUST verify (engineer risk #1/#2):** confirm reconcile's tracked_keywords write is genuinely upsert-preserving (no `DELETE WHERE workspace_id` before reinsert). The keyword-command-center read confirms the upsert shape, but the reconciliation module's write must be read directly before migration 139 is written. If reconcile is ever delete-reinsert, migration 139 must carry the curation columns through reinsert — a meaningful reconcile change, not a trivial add. **This is a Phase-3 gate, not an assumption.**

**Write path:** new function `updateKeywordCurationSet(workspaceId, changes: { keyword: string; action: 'add' | 'remove' | 'keep' }[])` in **`server/keyword-command-center.ts`** (the existing `tracked_keywords` owner — NOT a new file), inside the existing transaction wrapper. It writes ONLY `curated_set_position` / `curated_set_added_at`.

**Auto-replenish:** when a removal vacates a slot, promote the top un-curated item from `strategy.opportunities` into the vacated position, stamping `curated_set_added_at`. Runs **inside the same curation transaction** (cheap, avoids a second broadcast). The UX surfaces "Added from opportunities" on the replenished row (design requirement — silent replenish erodes trust).

**Search-and-add:** reuse the existing `keyword-command-center.ts` search path; do not hand-roll a query. Inline text input, one-click add, no confirmation dialog (remove is the undo).

**Add-from-client-requests:** `useKeywordFeedback` + `feedback.addRequestedKeyword` already exist. "Promote approved client keyword to curated set" is a one-line `updateKeywordCurationSet` call inside the existing approve handler.

**Events + activity (both halves required):**
- New `WS_EVENTS.KEYWORD_CURATION_UPDATED` constant in `server/ws-events.ts`.
- Frontend `useWorkspaceEvents(workspaceId, WS_EVENTS.KEYWORD_CURATION_UPDATED, …)` invalidating `queryKeys.admin.keywordStrategy` (the existing key returns `siteKeywords`).
- New ActivityTypes (admin-only, not client-visible): `keyword_removed_from_curated_set`, `keyword_promoted_to_curated_set`. Register in the closed `ActivityType` union same-commit. (`keyword_added` already exists.)

### 3.2 Universal send-to-client (the spine that already exists)

The spine is **fully built**; we route through it. Three send mechanisms, in order of preference:

1. **Rec lifecycle (clientStatus axis) — DEFAULT.** `PATCH /api/recommendations/:ws/:recId/send` → `sendRecommendation()` (`server/recommendation-lifecycle.ts:81`) routes by `REC_POLICY_REGISTRY[type].sendChannel`. `sendChannel: 'rec'` mutates `clientStatus` (`system → curated → sent`); it **NEVER writes RecStatus** (the trust-critical invariant). This covers keyword opportunities, decaying pages, competitor, gaps, clusters.
2. **Deliverable spine (bespoke client card) — only when a custom renderer is truly needed.** `sendChannel: 'deliverable'` routes `content_decay` / `cannibalization` to the `client_actions` → `client_deliverable` path with a dedicated renderer (`CannibalizationRenderer` in `src/components/client/decision-renderers.tsx`, dispatched by `DeliverableDetailModal.tsx`). Only `cannibalization` and `content_decay` use this today; we add no new ones.
3. **`StrategyRecommendationPayload` → rec adapter (mint-on-demand)** — for a domain item that is not yet a rec. `StrategyRecommendationPayload` (`shared/types/recommendations.ts:221`) exists and is unconsumed. It mints a rec so the item enters the single authoritative `RecommendationSet` and `isActiveRec()` governs its visibility.

**Routing decisions, per surface:**

| Surface | Send path | New source type? | Notes |
|---|---|---|---|
| Keyword opportunity ("interested in this one?") | Mint/locate a `keyword_gap` rec → `sendRecommendation()` (`sendChannel:'rec'`). **UNISON: mint at regen** so the rec set stays the single queue and `isActiveRec` governs visibility (engineer-preferred over lazy mint-on-send). | **No** | "Yes" also joins the curated set (§3.1). |
| Decaying page ("should we refresh?") | `content_refresh` rec → `PATCH …/send`. `content_decay` `ClientActionSourceType` + adapter already exist; mint a `content_refresh` rec if absent. | **No** | DecayingPagesCard gets a teal "Send to client" button. |
| Competitor ("act on this gap") | Add `competitor` RecType to `REC_POLICY_REGISTRY` with `{ sendChannel: 'rec', cascadeOnStrike: false, monetizable: false }` (two-line registry add). Send via `sendRecommendation()`. | **No** | The **client-visible competitor renderer** ships gated behind a child flag so a deliverable can't land before its renderer exists (engineer's partial-delivery guard). See §8. |
| Cannibalization | Already routes through `cannibalization` deliverable adapter (built). | No (exists) | Just swap `CannibalizationAlert` → `CannibalizationTriage` in the IA. |

**Hard constraint (all three teammates, LOCKED):** **no new `ClientActionSourceType` in this redesign.** Anyone proposing one is redirected to the rec lifecycle unless they can prove a bespoke client renderer the deliverable spine cannot serve. The 6-part lockstep (source type + payload + adapter + renderer + activity + state machine) is reserved.

### 3.3 The two lifecycle axes are never conflated (the #1 historical bug)

Every new surface that lists, counts, or renders recommendations MUST route through `isActiveRec(rec, now?)` (`server/recommendations.ts:638`) — the single active-set predicate. **Strike/throttle/send NEVER write `RecStatus`.** A new "managed keyword keep" flag MUST NOT live on the regenerable normalized tables (§3.1 handles this). Carry-over (`applyLifecycleCarryOver`) and auto-resolve exemption (`isExemptFromAutoResolve`) are unchanged — new surfaces must not bypass them.

**New pr-check rule proposed (engineer):** in `src/components/strategy/*`, a `status === 'dismissed'` / `status !== 'dismissed'` filter without an adjacent `isActiveRec` call is flagged as a candidate `incomplete-rec-filter`. Add it before Phase 2 touches any rec-listing surface.

---

## 4. Tab IA + render order — all 4 tabs

The 4-tab structure (`overview | content | rankings | competitive`) is correct; the **render order within tabs** is wrong. The `?tab=` literal ids stay in `KeywordStrategy.tsx` (the deep-link contract test scans for them — see §8). The Rankings tab is **renamed in the UI label only** to "Keywords & Rankings"; its `id` literal stays `rankings`.

### ① Overview = decide & act

**New render order (LOCKED — design owns this, product + engineering concur):**

1. `feedbackNudgeEl` + `stalenessNudges` (unchanged — transient nudges).
2. **What Changed** (`StrategyDiff`) — **promoted to position immediately under the nudges/orient strip.** Not an interstitial, not collapsed-by-default. Renders nothing when `!hasChanges` (the existing guard — lean on it, do not hide the slot). **Do NOT "fix" its amber-bordered non-SectionCard chrome into a SectionCard** — it carries an intentional `pr-check-disable` brand-asymmetric signature (`StrategyDiff.tsx:41`). Reads `queryKeys.admin.strategyDiff`, refetches on `WS_EVENTS.STRATEGY_UPDATED`. The JSX shuffle must NOT drop that `useWorkspaceEvents` handler — code-review gate item.
3. **OrientZone** — stays a compact metric strip (visibility score + clicks + impressions + position), NOT a hero.
4. **The Cockpit** (`StrategyCockpit`) — full width, no competing cards beside it. Signals fold in here as rec rows (§5.6). `CurationBulkActionBar` is surfaced for multi-select send.
5. **Collapsed "strategy config"** at the bottom behind a disclosure toggle (provider, page limit, business context, local market/location) — §5.7.

**Removed from Overview:** the "Reference & Analysis" divider (it signals "stop reading"), `IntelligenceSignals` standalone (folded — §5.6), `StrategyHowItWorks` (static explainer in a daily tool is noise — moves to onboarding/docs), `SiteTargetKeywords` + `KeywordOpportunities` (move to Keywords & Rankings — §4②), the unconditional `ClientKeywordFeedback` leak (moves to Keywords & Rankings).

### ② Keywords & Rankings (renamed from "Rankings")

Render order:

1. **Tab header** with the "Open the Keyword Hub" deep-link (`buildHubDeepLinkQuery` + `adminPath(ws, 'seo-keywords')`) — **top-right, visible without scrolling.** The managed set is a curated slice, not a Hub replacement.
2. **Site Target Keywords — managed working set** (§3.1). Three visual states at a glance: In set (teal dot/badge), Removed (zinc), Candidate (no dot). Inline search-and-add input at top. "Added from opportunities" annotation on auto-replenished rows.
3. **Keyword Opportunities** — per-row "interested in this one?" → `sendRecommendation()` (`keyword_gap` rec); "yes" also joins the target set (§3.2).
4. **Client Keyword Feedback log** (`ClientKeywordFeedback`) — moved here from the unconditional leak; collapsible section (reference, not action).
5. **Ranking Distribution** + **Position Movements** (the existing `StrategyRankingsTab` content) below.

### ③ Content = the money page

Render order (design: cannibalization is urgent — not last):

1. **Content Gaps** (managed + send-to-client + briefs **pre-seeded with full computed context** — §5.5).
2. **CannibalizationTriage** (the actionable pick-the-keeper + send — swapped in for the passive `CannibalizationAlert`; §5.4). Placed after Gaps, before Clusters.
3. **Topic Clusters** (managed set add/remove/keep + research-seed + why/how/result narrative).
4. **Decaying Pages** (`DecayingPagesCard`) — gains a "Send to client — should we refresh?" button via `content_refresh` rec (§3.2).

Keep the existing `hasContentTabContent` empty-state guard.

### ④ Competitive

Render order: **Share of Voice** (`ShareBar`) → **Competitor comparison** (`CompetitiveIntel`) with per-row "act on this gap" send (`competitor` RecType, §3.2) → **Keyword gaps** (`KeywordGaps`) → **Backlinks** (`BacklinkProfile`, stays here — split deferred, §1 non-goals).

---

## 5. Each surface's behavior + reuse vs net-new

### 5.1 Global scannable lists — `useShowMore` (NET-NEW shared hook)

No `useShowMore` exists today; surfaces cap ad-hoc (`TopicClusters.slice(0,10)`, `IntelligenceSignals.slice(0,10)`) or not at all (ContentGaps renders all `sorted`). The cockpit's `FIX_NOW_CAP = 5` (`cockpitRowModel.ts:3`) is the reference implementation.

**Build `src/hooks/useShowMore.ts` BEFORE any leaf is modified** (CLAUDE.md UI/UX rule #9 — extract-shared-interaction-pattern). Signature: `useShowMore<T>(items: T[], { initialCap = 5 }): { visible: T[]; allVisible: boolean; hasMore: boolean; remaining: number; showMore(): void; reset(): void }`.

Design contract (LOCKED): default cap **5**; "show N more" is a **teal text link** (low visual weight, secondary action), not a bordered button; expanded stays expanded unless the list exceeds 15. The row is always compact; progressive disclosure opens **in-place expand or a drawer, never a modal** for routine inspection.

Applied uniformly to: ContentGaps, TopicClusters, KeywordOpportunities, Competitive keyword gaps, the cockpit beyond Fix-Now. **Design blocks any PR that hard-caps a list inline with `.slice(0, N)` without the show-more affordance** — silent truncation is worse than a wall.

### 5.2 Why → how → projected result (consistent presenter)

The DATA exists per item (recs carry `insight`, `description`, `estimatedGain`/`impactBand`/`opportunity.components[].evidence`; gaps carry `rationale`/`competitorProof`/`volume`/`intent`; clusters carry `topCompetitor`/`coveragePercent`). Today only `cockpitRowModel.ts:83`'s clamped `whyLine` surfaces; how + result are not surfaced uniformly.

**Format must be scannable, not prose (design LOCKED):**
- **Why** (one line, data-anchored): "Competitor X ranks P4 for this term; you rank P22."
- **How** (one line, action): "Create a [content type] targeting [keyword cluster]."
- **Result** (badge, not prose): `+~340 clicks/mo` (blue data badge) or `High`/`Medium` impact (emerald/amber per impactBand).

Compact row shows **Why only**; expanded state (drawer/accordion) shows all three. Reuse: extend the existing `whyLine` rendering rather than a new component where possible; a small shared presenter (`WhyHowResult`) is acceptable net-new if it dedupes across cockpit rows + gap cards + cluster cards.

**Why/how/result is a send prerequisite (product + design LOCKED):** the send button is enabled only when `insight` is non-empty AND `impactBand` (or `estimatedGain`) resolves. A `sendable` validation gate enforces this. Sending a keyword opportunity or decaying page without projected-impact language is a client-experience regression, not an improvement.

### 5.3 Send-to-client UX (one universal affordance)

**One button: "Send to client" — teal — with an optional inline note field.** Platform convention; enforced by pr-check `send-for-review-anti-pattern`. No "Send for Review" / "Flag for Client".

Design additions:
- **Send state encoded on the row**, not just a status badge: after send the row shows a "Sent" teal pill; the button disables with "Sent" text.
- **Bulk send for the cockpit:** surface the existing `CurationBulkActionBar` — select 3–5 recs, send in one action. Individual sends on a 144-rec wall is unusable; this is the highest-leverage cockpit usability win.

### 5.4 Cannibalization re-home (reuse — ~zero net-new)

`CannibalizationTriage.tsx` is fully built (keeper-pick via `keeperPathOf`, Fix-in-editor, Mark-resolved → records `cannibalization_resolved` outcome, Send-to-client via the `cannibalization` deliverable adapter; resolution inferred from durable `tracked_actions`, not the regenerable issue row). Work: **swap `CannibalizationAlert` → `CannibalizationTriage` in the Content tab.** Keep `CannibalizationAlert` (still imported by `ContentPipeline.tsx`); remove it only from Strategy. The passive version must not appear anywhere in Strategy after the swap.

### 5.5 Brief pre-seed for ContentGaps (NET-NEW: extend the fixContext contract)

`ContentGaps.tsx:78,86` passes only `{ targetRoute, primaryKeyword, pageType }` and DROPS `rationale`, `competitorProof`, `volume`, `intent`, `questionKeywords`, `serpFeatures`. The carrier is the React Router `navigate(…, { state: { fixContext } })` pattern (untyped today).

**Both halves ship in the same PR (engineer LOCKED — this is exactly the bug-class this fixes):**
- Define `ContentGapFixContext` in `shared/types/` (or `src/types/` at minimum): `{ targetRoute; primaryKeyword; pageType?; rationale?; competitorProof?; volume?; intent?; questionKeywords?; serpFeatures?; autoGenerate? }`.
- The brief-generator receivers in `seo-briefs` and `content-pipeline` read the new fields. If the sender adds fields the receiver never reads, the bug repeats.

### 5.6 Signal-fold (NET-NEW: a mapper, no table)

`IntelligenceSignals` produces `StrategySignal[]` from the existing slice pipeline. Convert to cockpit rows via `signalToRecRow(signal): SyntheticCockpitRow` — a **pure function in `src/components/strategy/cockpitRowModel.ts`** (no backend routes, no DB columns). Synthetic rows carry a discriminant (`synthetic: true`) so lifecycle write paths (`sendRecommendation`, `strikeRecommendation`) gate on it — **you cannot send or strike a signal that isn't persisted.** Then delete `intelligenceSignalsEl`.

**Fix the `Computed X ago ago` double-"ago" bug in the same commit** (`IntelligenceSignals.tsx:49` — `Computed {timeAgo(...)} ago`; `timeAgo` already returns "X ago", so drop the literal " ago"). Do not ship the fold while leaving the bug live on staging. This was specced as v2 Task 2.2 and deferred once; it must not silently re-defer.

### 5.7 Config consolidation + Local SEO dedup (NET-NEW IA move, behind the flag)

`LocalSeoVisibilityPanel` renders in BOTH `KeywordStrategy.tsx:216` (`localSeoEl`, `mode="strategy"`) AND `KeywordHub.tsx:539`.

**UNISON decision (engineer + design):**
- **Visibility panel RESULTS stay in `KeywordHub`** (it is the keyword-universe surface). Remove `localSeoEl` from `KeywordStrategy.tsx` entirely. The `mode="strategy"` prop becomes dead → clean it up in the same commit.
- **Local SEO CONFIG** (provider, local market/location) folds into the new collapsed "strategy config" section in Strategy, alongside `StrategySettings`.

This touches BOTH files and ships behind the flag (flag-OFF keeps `localSeoEl` on every tab — see §8). The config + the visibility panel are two different things; keep them separate in analysis.

---

## 6. The 4 global patterns — how each is implemented

1. **Scannable** → `useShowMore` shared hook (§5.1), built first, applied everywhere. Cap 5, teal "show more" link, in-place/drawer disclosure.
2. **Why → how → projected result** → the `WhyHowResult` presenter (§5.2), data already on every item, compact=why / expanded=all three, and a **send prerequisite** gate.
3. **Send-to-client = one universal mechanism** → the rec lifecycle (`sendRecommendation`, clientStatus axis) + the deliverable spine for the two bespoke families (§3.2/§5.3). **No per-card `clientActions.create`. No new `ClientActionSourceType`.** One teal "Send to client" button + optional note, "Sent" pill on the row, bulk send via `CurationBulkActionBar`.
4. **Consolidate Settings + Local SEO** → one collapsed "strategy config" entry (§5.7) + dedupe the Local SEO panel (results → Hub, config → Strategy).

---

## 7. `?tab=` + flag-gating + flag-OFF-parity story

### `?tab=` deep-link two-halves contract

The receiver (`KeywordStrategy.tsx`) already reads `searchParams.get('tab')` via `resolveTabSearchParam` + a sync effect. **Renaming "Rankings" → "Keywords & Rankings" changes the LABEL only; the `id` literal stays `rankings`.** All four literal ids (`overview | content | rankings | competitive`) stay in the file so the contract test (`tests/contract/tab-deep-link-wiring.test.ts`) keeps recognizing the receiver. v3's parallel `?rec=` contract is unaffected.

### Flag-gating

Everything net-new ships behind the existing `strategy-command-center` (`shared/types/feature-flags.ts:59`, default `false`, `group: 'Strategy'`, owner `analytics-intelligence`). Two narrow child flags (added to the catalog + the keys group BEFORE the first commit; `npm run verify:feature-flags` gate):

- `strategy-keywords-managed-set` — gates the curated managed-set write path + UI (Phase 3). Lets the tab rename + surface move (Phase 2) ship before the persistence layer is ready.
- `strategy-competitor-send` — gates the **client-visible** competitor deliverable renderer so a `competitor` deliverable can't land in the client inbox before the renderer exists (engineer's partial-delivery guard).

No new umbrella flag (product LOCKED — flag proliferation makes flag-OFF parity harder to reason about).

### Flag-OFF parity (byte-identical to today)

Today flag-OFF renders the 4-tab command-center IA with the v2 ActQueue (not the cockpit). **Flag-OFF must stay byte-identical to today's flag-OFF.** Every IA move (What Changed promote, keyword surface move, config consolidation, Local SEO dedup, signal-fold, cannibalization swap) is gated so flag-OFF is unchanged.

**The leak is the trap:** `clientFeedbackCombinedEl` + `settingsEl` + `localSeoEl` render *outside* the tabs unconditionally today. Moving them must be flag-gated — when the flag is OFF they must render exactly where they do now. Gates:
- Exit-gate snapshot test on the **real public read** (`tests/integration/recommendations-public-allowlist.test.ts`) — flag-OFF byte-identical.
- Flag-ON no-admin-key-leak test.
- **PR checklist item (product):** "verified flag-OFF render is byte-identical to pre-PR baseline" on every PR touching the orchestrator's outside-tabs region.

---

## 8. Phasing (front-load visible wins; phase-per-PR; staging-first)

Phase-per-PR; never start phase N+1 until phase N is merged and green on staging. Each phase has a feature-class definition-of-done gate.

### Phase 1 — Visible wins, zero data-model change (ships in days)

The proof-of-concept that the redesign is real. **Must ship together, fast, not bundled with structural change** (product's #1 risk: a slipped/bundled P1 ships another "nothing looks different").

- **What Changed promote** (JSX reorder; keep the `useWorkspaceEvents` handler + amber chrome).
- **`useShowMore` shared hook** + apply to ContentGaps, TopicClusters, KeywordOpportunities.
- **CannibalizationTriage swap** in Content (engineer + design argue this is P1, not P4 — it's a JSX swap that unblocks the operator finding the actionable surface immediately; UNISON moves it up from the foundation's P4).
- **Fix `Computed X ago ago`** bug (one-char fix, ride-along).

Gate: typecheck + build + vitest + pr-check; flag-OFF byte-identical snapshot; real-browser DOM probe (the design-system 5-layer verification — a collapsed grid / undefined token can pass typecheck+build+pr-check+review).

### Phase 2 — The big visible move (IA reorganization only)

- Rename "Rankings" → "Keywords & Rankings" (label only; `id` stays `rankings`).
- Move `SiteTargetKeywords` + `KeywordOpportunities` + `ClientKeywordFeedback` into that tab (existing behavior preserved — Track/View-in-Hub stays).
- Add the prominent "Open the Keyword Hub" deep-link to the tab header.

**Hard-scope (product LOCKED): IA reorganization ONLY. No managed-set semantics here.** If engineering scopes add/remove/keep into Phase 2, the write path eats weeks and the tab rename never ships. Move existing components; keep current behavior.

Gate: deep-link contract test passes with the renamed tab; flag-OFF byte-identical; mobile breakpoint pass.

### Phase 3 — Monetization spine activation + managed sets

- **Migration 139** (curated-set columns) — **gated by the reconcile-write verification** (§3.1; pre-plan-audit gate).
- `updateKeywordCurationSet` + auto-replenish + search-and-add + add-from-client-requests.
- Managed-set UI (add/remove/keep, three visual states, "Added from opportunities" annotation), behind `strategy-keywords-managed-set`.
- Managed Topic Clusters + Content Gaps add/remove/keep.
- **Send-to-client on Decaying Pages + Keyword Opportunities** via `sendRecommendation()` / mint-at-regen.
- **Why/how/result presenter** (here, not P4 — client sends without projected impact are weaker; data already exists). Send prerequisite gate.
- Brief pre-seed (`ContentGapFixContext`, both halves).

This is the money phase — strategy surfaces start generating client deliverables. New `WS_EVENTS.KEYWORD_CURATION_UPDATED` + handler + activity types; new pr-check `incomplete-rec-filter`.

Gate: managed-set survives a simulated regen (durability test); `isActiveRec`-only filtering verified; integration test exercises the **public read path** (`GET /api/public/recommendations/:ws`), not the admin route; mobile pass for the cockpit bulk-select + managed-set + why/how/result drawer.

### Phase 4 — Consolidation + cleanup (hardest, least daily-visible)

- **Signal-fold:** `signalToRecRow` mapper + delete `intelligenceSignalsEl` (the `ago` bug already fixed in P1).
- **Config consolidation** (Settings + Local SEO config → collapsed "strategy config") + **Local SEO dedup** (visibility → Hub, config → Strategy; remove `localSeoEl` + dead `mode="strategy"`).
- **Competitor send** (`competitor` RecType registry add + `CompetitiveIntel` send) with the **client renderer gated behind `strategy-competitor-send`**.
- Final flag-OFF cleanup pass (remove the outside-tabs leak now that everything is re-homed).
- Remove `StrategyHowItWorks` from Strategy + the "Reference & Analysis" divider.

Gate: flag-OFF still byte-identical after the leak is removed; no orphaned flag keys; coverage ratchet not regressed.

**Phasing rationale vs the foundation:** the foundation suggested cannibalization swap + signal-fold both in P4. UNISON **pulls the cannibalization swap into P1** (it's a zero-cost visible win all three teammates independently flagged) and **keeps signal-fold + competitor + config in P4** (signal-fold has lifecycle-discriminant implications; competitor needs the renderer guard; config consolidation is the flag-OFF-leak removal, safest last).

---

## 9. Testing + risks

### Testing

- **Flag-OFF byte-identical snapshot** on the real public read (`tests/integration/recommendations-public-allowlist.test.ts`) — every phase.
- **Deep-link contract test** (`tests/contract/tab-deep-link-wiring.test.ts`) — passes after the label rename (ids unchanged).
- **`isActiveRec`-only filtering** — new pr-check `incomplete-rec-filter` + unit coverage for every new rec-listing surface.
- **Managed-set durability** — integration test: curate a set, simulate a regen/reconcile, assert `curated_set_position` survives.
- **fixContext both-halves** — test the brief receiver reads the new `ContentGapFixContext` fields (not just that the sender passes them).
- **Send-path integration** — exercise `GET /api/public/recommendations/:ws` (the client read), not the admin GET (false-confidence trap).
- **Signal-fold** — synthetic-row discriminant prevents send/strike on un-persisted signals; the `ago` bug fix is asserted.
- **5-layer design-system verification** (typecheck + build + pr-check + review + **real-browser DOM probe**) for every phase with JSX/CSS change — a collapsed grid or undefined token passes the first four.
- **Mobile breakpoint pass** within each phase (not after) — cockpit bulk-select, managed-set add/remove/keep, why/how/result drawer.

### Risks (ranked)

1. **Re-conflating the lifecycle axes / partial active-set filter.** Mitigation: `isActiveRec` everywhere + `incomplete-rec-filter` pr-check + never write RecStatus on send/strike/throttle.
2. **The visible-win gap (P1 slips or bundles).** Mitigation: P1 is What-Changed + scannable + cannibalization swap, shipped together, fast, alone.
3. **Managed-set persistence trap (Phase 2 scope creep).** Mitigation: hard-scope Phase 2 to IA move; managed-set is Phase 3 behind `strategy-keywords-managed-set`.
4. **Reconcile delete-reinsert clobbering `curated_set_position`.** Mitigation: pre-plan-audit reads the reconcile write directly before migration 139; if delete-reinsert, carry columns through reinsert.
5. **Flag-OFF drift / leaking new UI onto all four tabs.** Mitigation: gate every outside-tabs move; snapshot test; PR checklist item; remove the leak only in P4.
6. **Per-card Send-to-client (universal-mechanism violation).** Mitigation: route everything through `sendRecommendation()` / deliverable spine; no new `ClientActionSourceType`; client renderer behind `strategy-competitor-send`.
7. **Signal-fold silently re-deferring + the `ago` bug riding along.** Mitigation: `ago` fix lands in P1 (decoupled); the fold is a named P4 deliverable with a discriminant test.
8. **What Changed getting demoted in the first revision.** Mitigation: Orient → What Changed order requires explicit owner sign-off to change (design LOCKED).
9. **Information-overload recurrence** (5 cards × 4 sections × 3 tabs). Mitigation: `useShowMore` before any surface ships; design blocks inline `.slice` without show-more.

---

## 10. Reuse vs net-new summary

**Reuse (the spine, ~90%):** `StrategyCockpit` + `CockpitRow` + `cockpitRowModel.ts` + `recCategoryMap.ts`; the two-axis lifecycle (`recommendation-lifecycle.ts`, `recommendations.ts` — `isActiveRec`, `applyLifecycleCarryOver`, `isExemptFromAutoResolve`); the send spine (`sendRecommendation`, `REC_POLICY_REGISTRY`, the cannibalization deliverable adapter, `clientActions.ts`, `DeliverableDetailModal`, `decision-renderers`); `CannibalizationTriage` (built, orphaned); `tracked_keywords` + its upsert writer; `useToggleSet`; `useKeywordFeedback`/`feedback.addRequestedKeyword`; `buildHubDeepLinkQuery`; `StrategyDiff`; the `fixContext` carrier; UI primitives.

**Net-new (named, minimal):** `useShowMore` hook; `WhyHowResult` presenter; `signalToRecRow` mapper + synthetic-row discriminant; `updateKeywordCurationSet` + migration 139 (two columns); `WS_EVENTS.KEYWORD_CURATION_UPDATED` + handler + 2 activity types; `ContentGapFixContext` type + receiver reads; `competitor` RecType registry entry; two child flags; one pr-check rule (`incomplete-rec-filter`).

---

## 11. The two real trade-offs (where the disciplines diverged, and the call)

1. **Cannibalization swap timing — P4 (foundation) vs P1 (eng + design).** Product's instinct is "P1 = pure visible wins, no structural change." But the swap is a JSX one-liner with zero data change and it directly answers "where's the actionable surface?" **UNISON pulls it to P1** — the eng-cheapness and the UX-payoff outweigh the purity of "P1 = What-Changed only." Risk accepted: P1 grows by one swap; mitigated because `CannibalizationTriage` is fully built and `CannibalizationAlert` stays for `ContentPipeline`.

2. **Keyword-opportunity send — mint-at-regen vs mint-on-send.** Design/product don't care about the timing; engineering does (mint-at-regen keeps the rec set the single authoritative queue so `isActiveRec` governs visibility correctly). **UNISON sides with engineering** — lazy mint-on-send creates a window where an opportunity exists but no rec governs it, inviting a partial active-set filter (risk #1). The cost (slightly larger rec set per regen) is acceptable.

Everywhere else the three disciplines converged — the unusual property noted in §0: the cheapest engineering path is also the best UX and product path.
