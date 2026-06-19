# Strategy Redesign (IA + Usability Layer) — Team eng-led Spec

> **Author:** Backend Engineer (lead), synthesizing PM + Engineer + Designer perspectives.
> **Date:** 2026-06-18
> **Status:** Spec — ready for `pre-plan-audit` → `writing-plans`.
> **Branch base:** off `staging` (v3 cockpit already merged there behind `strategy-command-center`).
> **Flag:** all net-new admin UI ships behind the existing `strategy-command-center` flag (`shared/types/feature-flags.ts:59`), staging-first, phase-per-PR.

This is a **redesign of the redesign**. Strategy v3 (Phases 0–3) built a deep recommendation **curation cockpit + two-axis lifecycle engine** and merged it to staging — but left the visible information architecture untouched, so the operator's reaction was "nothing looks different; keyword stuff never moved; What Changed never moved up." This work fixes the **IA + usability layer** around the cockpit. The cockpit and lifecycle engine stay; we reorganize everything around them.

**Leadership steer that resolves every contested call below:** the data model, reuse of existing modules (rec engine, intelligence slices, v3 single-writer/lifecycle, deliverable infra), typed contracts, migration safety, and performance (144-rec scannability, the curated-set store) drive the decision. Where teammates conflict, I decide toward the **most robust, least-net-new, most-reusable** implementation, and say why inline.

---

## 1. Goal + Non-Goals

### Goal

Make the already-built Strategy v3 cockpit **legible and actionable**:

1. **Promote What Changed** to the top of Overview (the 198-update change-log was buried at the bottom — the #5 complaint).
2. **One job per tab** across the 4-tab IA (Overview / Keywords & Rankings / Content / Competitive), with no surface leaking outside the tabs.
3. **Four global, build-once-reuse patterns** applied everywhere: scannable lists, why→how→result, one universal Send-to-client mechanism, consolidated config.
4. **Curated "Site Target Keywords" working set** — a durable, add/remove/keep, auto-replenishing top-10-20 slice on the renamed Keywords & Rankings tab, distinct from the Keyword Hub universe.
5. **Fold Intelligence Signals into the cockpit** as rec rows and delete the standalone card; **re-home cannibalization** from the passive `CannibalizationAlert` to the actionable, already-built `CannibalizationTriage`.

**Operator-observable success criteria (PM, adopted):**
- After P1: opening Strategy shows **What Changed before anything else**; no scroll needed to know if the last regen did anything.
- After P2: Rankings is gone; **Keywords & Rankings** is the obvious home for keyword targeting — operator never looks in Overview for it.
- After P3: operator can **Send a keyword opportunity, a decaying-page refresh ask, or a competitor insight to a client without leaving Strategy** — one teal button, one optional note, one confirm, no per-card variation.
- After P4: the standalone Intelligence Signals card is gone; cannibalization shows the actionable triage; config appears in exactly one place (not both Strategy and the Keyword Hub).

### Non-Goals (cut/deferred — with rationale)

- **No per-row recommendations table.** The `RecommendationSet` stays a whole-blob JSON store rewritten by `saveRecommendations()` (`server/recommendations.ts`). Per-row normalization is already on the roadmap and out of scope here. (Engineer steer: do not destabilize the single-writer.)
- **No new `ClientActionSourceType`** (`keyword_opportunity`, `decaying_page`, `competitor_gap`). The 6-part lockstep (source type + payload + adapter + renderer + activity type + state machine) is the heavy path. **All strategy sends route through the rec lifecycle (`sendRecommendation()` → `clientStatus`).** Unanimous across PM + Engineer; I make it a hard gate. The only legitimate new source type is a genuinely bespoke client card — and cannibalization already proves that case is already built.
- **No consumer for `StrategyRecommendationPayload`** (`shared/types/recommendations.ts:221`). It is currently unconsumed, predates the rec lifecycle, and its semantics overlap confusingly with `clientStatus`. Leave it dormant. (Engineer steer.)
- **No Backlinks split to a `links` page.** The `'links'` route exists in `src/routes.ts`, but splitting `BacklinkProfile` out is pure IA with zero backend payoff and no operator ask. Default-resolve the open question to **defer**; keep Backlinks in Competitive. (PM + Engineer agree.)
- **No discussion-substrate surfacing.** `rec_discussion` (migration 138) + routes exist but surfacing them in the tab IA is a future engagement feature, not a redesign priority.
- **No managed-set write path in P2.** Display first (P2), durable write path second (P3) — so the IA is observable on staging before we lock the persistence shape. (PM steer; Engineer concurs the migration is the single schema commit and belongs in P3.)
- **No flag-OFF behavior change, ever.** Flag-OFF must stay **byte-identical to today** (which renders the 4-tab command-center IA with the v2 ActQueue). Any flag-OFF delta is an automatic bloat/regression flag.

---

## 2. Tab IA + Render Order (all 4 tabs)

The four-tab structure (`STRATEGY_INTERIOR_TABS`, `KeywordStrategy.tsx:52`) is correct and stays. **The tab `id` literals (`overview | content | rankings | competitive`) MUST remain unchanged in the file** — only the `rankings` **display label** changes to "Keywords & Rankings". The `?tab=` two-halves contract test (`tests/contract/tab-deep-link-wiring.test.ts`) and the `resolveTabSearchParam` receiver (`KeywordStrategy.tsx:69`) both gate this.

**Mobile (Designer, adopted):** the tab bar is a horizontally-scrollable strip on mobile (not a dropdown); labels may truncate ("Keywords" not "Keywords & Rankings").

### Chrome (rendered OUTSIDE the tabs — flag-ON target state)

Today `localSeoEl`, `clientFeedbackCombinedEl`, and `settingsEl` leak onto **all four tabs** (the known leak, `KeywordStrategy.tsx:392`). Designer's #1 layout fix: under flag-ON, **nothing renders outside the tab content area except** `headerEl`, `refreshPromptEl`, `errorEl`, and the empty/progress states. Everything else moves into a tab.

| Element | Flag-OFF (unchanged) | Flag-ON target |
|---|---|---|
| `headerEl`, `refreshPromptEl`, `errorEl`, `progressEl`, `nextStepsEl` | outside tabs | outside tabs (unchanged) |
| `localSeoEl` (LocalSeoVisibilityPanel) | outside tabs, every tab | **removed from Strategy** (see §5 Config + §4 boundary) |
| `clientFeedbackCombinedEl` (ClientKeywordFeedback) | outside tabs, every tab | **moved into Keywords & Rankings tab** |
| `settingsEl` (StrategySettings) | outside tabs, every tab | **collapsed into "Strategy config" accordion in Overview** |

### ① Overview — *decide & act*

**Flag-ON render order (Designer's locked sequence):**

1. `realLeaves.stalenessNudges` (kept — staleness is orient-level)
2. **`orientEl`** — OrientZone: visibility score + clicks/impressions/position (3-stat row desktop, 1-up stacked mobile; `CompactStatBar` fallback when the grid collapses).
3. **What Changed (`strategyDiff`) — PROMOTED to the top of the actionable zone.** Keeps its intentional amber-bordered non-SectionCard chrome (`StrategyDiff.tsx:41` has a `pr-check-disable` line — **do NOT normalize it into a SectionCard**). Renders only `hasChanges`; reads `queryKeys.admin.strategyDiff`, refetches on `STRATEGY_UPDATED` broadcast.
4. **The Cockpit** (`cockpitEl` = `<StrategyCockpit>`, flag-ON) — the v3 curation surface. Cannibalization, gaps, clusters, and (P4) folded signals appear as **rec ROWS** that open their rich expansions inline, not as flattened standalone cards.
5. **Collapsed "Strategy config" accordion** (P4) — provider, page limit, business context, local market/location. Accordion header shows a one-line summary even when collapsed: `Provider: DataForSEO · Limit: 500 pages · Market: Austin, TX` (Designer Risk 3 — config must surface its state).

**Removed from Overview (flag-ON):** the "Reference & Analysis" divider and everything below it — passive `CannibalizationAlert`, `StrategyHowItWorks`, `siteKeywords`, `opportunities`, standalone `IntelligenceSignals`. The `feedbackNudge` leading element moves below the first actionable zone or is removed (Designer — noise before context).

**`StrategyHowItWorks`** moves to a `?` tooltip on the page header (Designer — static explainer visible to 50×-repeat users is noise).

### ② Keywords & Rankings — *the keyword working set* (renamed from "Rankings")

**Flag-ON render order:**

1. **Site Target Keywords** — the curated, add/remove/keep, auto-replenishing working set (see §3). P2 ships passive display; P3 ships the write path.
2. **Keyword Opportunities** — per-row "Send to client" ("interested in this one?"); a yes-response joins the target set (P3).
3. **Client Keyword Feedback log** (`ClientKeywordFeedback`) — moved here from the leaked chrome; the approved/declined history lives here.
4. **Ranking Distribution** + **Position Movements** (existing `StrategyRankingsTab` content).
5. **"Open the Keyword Hub" deep-link** — `buildHubDeepLinkQuery()` + `adminPath(ws, 'seo-keywords')` for the full universe/research.

### ③ Content — *the money page*

**Flag-ON render order** (guarded by `hasContentTabContent`, else `EmptyState`):

1. **Content Gaps** — scannable (cap 5), managed + Send-to-client, **briefs pre-seeded with the gap's full computed context** (§2.6 of the brief; the `fixContext` extension — P3).
2. **Topic Clusters** — scannable, managed-set add/remove/keep + research-seed + why/how/result narrative.
3. **Decaying Pages** (`DecayingPagesCard`) — Refresh/Review + **Send "should we refresh?"** (new — routes through rec lifecycle, §3).
4. **Cannibalization re-homed as actionable `CannibalizationTriage`** — pick-the-keeper + Send-to-client (P4 swap; see §3).

### ④ Competitive

**Flag-ON render order** (existing `StrategyCompetitiveTab` composition):

1. Share-of-voice bar + competitor comparison — **with action / Send-to-client** (P3, new RecType — §3).
2. `BacklinkProfile` (stays here — Backlinks split deferred).
3. Keyword gaps.

---

## 3. Surface-by-surface: behavior + reuse vs net-new

| Surface | Behavior | Reuse | Net-new (named) |
|---|---|---|---|
| **What Changed promotion** | Move `strategyDiff` to top of Overview actionable zone; keep amber chrome. | `StrategyDiff.tsx`, `queryKeys.admin.strategyDiff`, `strategy_history` table (cap 5, `keyword-strategy-persistence.ts:60`). | Zero. Pure JSX reorder behind the flag. |
| **Scannable lists** | Every list leaf caps at 5 + "Show N more" (teal text link, not a button) / "Show less". | Cockpit `FIX_NOW_CAP=5` is the proof of concept. | **`useShowMore(items, initialCap=5)` shared hook** → `{ visible, hasMore, showMore, showLess }`. Built once in P1, applied to ContentGaps, TopicClusters, KeywordOpportunities, position movements, competitor gaps. **This is the #1 build-once-reuse miss** — no shared primitive exists today (ContentGaps renders all `sorted`). |
| **Why → how → result** | Three zones on every actionable row, in order: **Why** (1 line, `t-caption` muted — never empty; if the data doesn't exist the row doesn't render) → **How** (the action verb on the primary CTA: "Add to brief", "Send to client", "Pick keeper", "Refresh this page") → **Result** (`t-caption` teal, projected outcome from `impactBand`/`estimatedGain`; show nothing rather than "undefined est."). | Data already exists per item: recs carry `insight`/`description`/`estimatedGain`/`impactBand`; gaps carry `rationale`/`competitorProof`/`volume`/`intent`; clusters carry `topCompetitor`/`coveragePercent`. Cockpit already renders a clamped `whyLine` (`cockpitRowModel.ts:83`). | **A consistent why/how/result presenter** (visual template, not an API change). Surface the *how* and *result* uniformly (today only the clamped whyLine shows). |
| **Site Target Keywords (managed set)** | Add/remove/keep working set; auto-replenish a removed slot from the opportunity pool; inline search-and-add; add-from-client-requests. Survives regen. | `SiteTargetKeywords.tsx` (passive display + `useTrackKeyword` + View-in-Hub); `useToggleSet(defaults,{min,max})` for keep/remove state; `ClientKeywordFeedback` + `useKeywordFeedback.addRequestedKeyword` as the client-request source. | **New durable store `strategy_keyword_set` + domain module `server/domains/strategy/managed-keyword-set.ts`** (see §4). |
| **Universal Send-to-client** | One teal "Send to client" button + optional inline note → dispatch. Identical UX across recs, keyword opportunities, decaying pages, competitor items. Post-send: row dims to zinc-600 + teal `clientStatus` badge ("Sent"/"Client approved"/"Discussing"), does not disappear. | **The spine is fully built.** `sendRecommendation()` routes by `REC_POLICY_REGISTRY[type].sendChannel`; for RecTypes with `sendChannel:'rec'` it stamps `clientStatus`. Routes `PATCH /api/recommendations/:ws/:recId/send` (+ bulk `POST`, one transaction). `clientStatus` safe fields are exposed via `stripEmvFromPublicRecs()`. Cannibalization (`sendChannel:'deliverable'`) is the bespoke-card proof. | **One new RecType `competitive_gap`** (see below). Keyword-opportunity send rides existing `keyword_gap` (already `sendChannel:'rec'`). Decaying-page send rides an existing decay RecType (`content_decay`/`content_refresh`). |
| **Signal-fold** | Fold `IntelligenceSignals` into cockpit rows; delete the standalone card; fix the double-"ago" bug in the same commit. | Cockpit already renders rec rows with category facets; `recCategoryMap.ts` maps every RecType. `keyword_gap`/`topic_cluster` already overlap signal "Gap" semantics. | **Mint signals as real recs at strategy-gen time** (Engineer-preferred Option A — see §4). Then `RECOMMENDATIONS_UPDATED` covers them automatically; no separate broadcast/hybrid query. **Delete `intelligenceSignalsEl`** (`KeywordStrategy.tsx`) + **fix `IntelligenceSignals.tsx:49`** ("Computed X ago **ago**" — `timeAgo(..., {style:'long'})` already returns "X ago"; drop the literal `' ago'`). |
| **Cannibalization re-home** | Swap passive `CannibalizationAlert` → actionable `CannibalizationTriage` in the Content tab (and remove the passive one from Strategy; keep the component — still used by ContentPipeline + legacy). | **100% built.** `CannibalizationTriage.tsx`: keeper-pick (`keeperPathOf`), Fix-in-editor, Mark-resolved (records `cannibalization_resolved` outcome), Send-to-client (`cannibalization` deliverable adapter). Resolution inferred from durable `tracked_actions` (`:84-94`), not the clobbered issue row. | Near-zero — a leaf swap. |
| **Brief pre-seed (#8a)** | Content-gap "Generate Brief" CTA carries the gap's full computed context, not a bare keyword. | `fixContext` navigation-state pattern (receiver reads `location.state.fixContext`). | **Extend `fixContext` payload + brief-generator receiver** to carry `rationale`, `competitorProof`, `volume`, `intent`, `questionKeywords`, `serpFeatures` (today both CTAs at `ContentGaps.tsx:78,86` DROP all of it). |
| **Config consolidation** | Collapse `StrategySettings` + Local SEO config into one "Strategy config" accordion; dedupe `LocalSeoVisibilityPanel` (renders in BOTH Strategy and Keyword Hub). | `StrategySettings`, `LocalSeoVisibilityPanel`. | Accordion wrapper with always-visible state summary. **Panel results home → Keyword Hub** (the Hub is "every keyword"; Local SEO is a keyword-visibility surface — PM steer). Remove `localSeoEl` from Strategy behind the flag. |

### Why `competitive_gap` is the ONLY new RecType (and the boundary on new types)

Verified against the live union (`shared/types/recommendations.ts:6`) and the policy registry (`server/recommendation-lifecycle.ts:38-51`):

- `keyword_gap` **exists** with `sendChannel:'rec'` → keyword opportunities send for free.
- A content-decay RecType **exists** (`content_refresh`/`content_decay` in the send spine) → decaying-page send routes through it.
- **No `competitive_gap`/`competitor` RecType exists.** Competitor Send-to-client requires adding **one** value to the `RecType` union AND a registry entry — the lighter "RecType lockstep": (1) `RecType` union, (2) `REC_POLICY_REGISTRY` entry (`sendChannel:'rec', cascadeOnStrike:false, monetizable:false`), (3) `recCategoryMap.ts` facet, (4) a renderer/whyLine path. This is NOT the heavy `ClientActionSourceType` 6-part lockstep, and stays entirely inside the rec lifecycle.

**Hard gate (PM + Engineer + lead):** no new `ClientActionSourceType` in this redesign. Enforce with a pr-check rule that flags any new `clientActions.create()` call inside `src/components/strategy/**` unless it carries an inline justification comment. The spine is built; the only real risk is engineers not knowing it exists.

---

## 4. Data model — curated keyword set / managed sets / universal send

### 4.1 `strategy_keyword_set` — the curated working set (the single schema migration in this redesign)

**The trap (Trap #1, all three teammates flagged it):** `strategy.siteKeywords` is a read-only field on the strategy JSON blob (`server/workspaces.ts ~166`). The normalized tables (`keyword_gaps`, `topic_clusters`, `cannibalization_issues`) are **delete-then-reinsert on every regen** — a `kept_at` flag added to any of them is clobbered on the next regen. The durable precedent is `CannibalizationTriage` inferring resolution from `tracked_actions` (`:84-94`).

**Decision (lead, adopting the Engineer's design):** a dedicated `strategy_keyword_set` table — **not** another JSON column on the workspace row, **not** a flag on the normalized tables.

```
CREATE TABLE strategy_keyword_set (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id  TEXT NOT NULL,
  keyword       TEXT NOT NULL,              -- normalized lowercase-trimmed
  source        TEXT NOT NULL,              -- 'regen_computed' | 'client_request' | 'manual_add'
  kept_at       TEXT,                       -- ISO; set when operator explicitly keeps
  removed_at    TEXT,                       -- ISO; set when operator removes a slot
  created_at    TEXT NOT NULL,
  UNIQUE(workspace_id, keyword)
);
CREATE INDEX idx_strategy_keyword_set_ws ON strategy_keyword_set(workspace_id);
```

**Survives regen because regen never writes it.** Regen writes `keyword_gaps` + the strategy blob, then a **post-regen reconciler** merges. The reconciler is the **ONLY writer** to this table and runs **inside the existing `saveRecommendations()` / regen `db.transaction()`** (extend there, not a separate route-level write — prevents the regen↔managed-set race that would corrupt the kept-set). Reconciler shape (kept fast, no AI calls inside the txn — `ai-call-before-DB-write` pr-check covers this):

1. `SELECT * FROM strategy_keyword_set WHERE workspace_id = ?` once at the top; build a `Set` of existing keywords.
2. Diff against the new `strategy.siteKeywords`; insert only net-new (`source:'regen_computed'`).
3. **Auto-replenish:** for each row with `removed_at` set, fill the vacancy from the opportunity pool ranked by `estimatedGain` (insert the next unused opportunity keyword as `source:'regen_computed'`).

**Domain module (platform-organization rule):** `server/domains/strategy/managed-keyword-set.ts` — upsert helper, reconciler function, `rowToX()` mapper, typed interface in `shared/types/strategy-keyword-set.ts`. **No route-handler logic.** Reads use a `createStmtCache()`/`stmts()` prepared-statement cache.

**Manual mutations** (operator add/remove/keep, accept-client-request) go through a thin route → domain module, each inside `db.transaction()`, each calling `addActivity()` with a typed ActivityType registered same-commit (`strategy_keyword_kept` / `strategy_keyword_removed` / `strategy_keyword_added` — admin-only).

**Frontend state:** `useToggleSet(defaults, { min: 5, max: 20 })` for the keep/remove UI; server is the source of truth (the toggle set hydrates from `queryKeys.admin.strategyKeywordSet`).

### 4.2 Universal send — routes entirely through the existing rec lifecycle

No new storage. All strategy sends invoke `sendRecommendation(workspaceId, recId)` (single-writer, `server/recommendations.ts`), which stamps `clientStatus` (`system → curated → sent`) and `sentAt` and **never writes `RecStatus`** (the trust-critical invariant; exit-gate `strike-never-completed`). The public projection is leak-proof: `stripEmvFromPublicRecs()` (`server/routes/recommendations.ts:84`) enumerates only client-safe fields, so the admin lifecycle axis (`throttledUntil`/`struckAt`/`cascade`/`lifecycle`) is never serialized. Adding `clientStatus` display on a row needs **no allow-list change** (it's already client-safe).

**Every reader of recs (new surfaces included) routes through `isActiveRec()`** (`server/recommendations.ts:642`) — the single active-set predicate. New surfaces MUST NOT re-implement a partial active filter and MUST NOT write `RecStatus` for strike/throttle/send (Trap #1 — the #1 historical bug).

### 4.3 Signal-fold storage (Option A — mint at gen time)

**Decision (Engineer-preferred, lead-adopted):** mint signals as **real recs** during `generateRecommendations()` — either a dedicated `signal_promoted` mapping onto existing `keyword_gap`/`topic_cluster` RecTypes, or a `source:'signal'` discriminator on the minted rec. **Reject** the read-time synthesis option (a separate broadcast path + hybrid query). Minting at gen time means the existing `RECOMMENDATIONS_UPDATED` broadcast + `applyLifecycleCarryOver` carry-over cover folded signals automatically, with zero new broadcast wiring.

**Performance gate (Engineer, MANDATORY before the fold ships):** folding signals grows the rec set. `applyLifecycleCarryOver` builds `oldByKey` as a `Map<mergeKey, OldRec>` once (`server/recommendations.ts:600`) — already O(n), good. But audit every other carry-over consumer for an inner `.find()` on old recs; convert any O(n²) scan to the same `Map` lookup **before** the fold ships, not after.

---

## 5. The 4 global patterns — implementation

1. **Scannable** — `useShowMore(items, initialCap=5)` shared hook (`src/hooks/useShowMore.ts`), returns `{ visible, hasMore, showMore, showLess }`. Applied to ContentGaps, TopicClusters, KeywordOpportunities, position movements, competitor gaps. Affordance = teal text link, not a button. Built once in **P1** so the pattern can't drift (the cockpit's `FIX_NOW_CAP=5` stays as-is — it already implements this; generalize, don't duplicate). **Designer Risk 2 gate:** scannable caps on ContentGaps + TopicClusters are a P1 deliverable — if they slip to P3, the Content tab becomes the new 144-item wall.

2. **Why → how → result** — a shared presenter (visual template) consumed by cockpit rows, ContentGaps, TopicClusters, KeywordOpportunities. Builds from existing fields (`insight`/`description`/`estimatedGain`/`impactBand`; gap `rationale`/`competitorProof`). **Designer Risk 1 gate:** review verifies `insight` is legible at `t-caption`, `estimatedGain` never renders "undefined est.", and the three zones are visually distinct (not three lines of the same gray).

3. **Send-to-client = ONE mechanism** — `sendRecommendation()` for all RecTypes; the cannibalization deliverable adapter for the one bespoke card. UX: teal "Send to client" + inline note (slides down below the row on desktop; **bottom sheet on mobile** — Designer's single mobile divergence, since an inline sliding field over a scrolling touch list is a trap). No "Flag for Client"/"Send for Review"/"Request feedback" buttons (pr-check `send-for-review-anti-pattern`). Post-send: row dims + teal `clientStatus` badge, stays visible.

4. **Consolidate Settings + Local SEO** — one collapsed "Strategy config" accordion (Overview) with an always-visible one-line state summary. Local SEO **config** folds in; the **visibility panel results** home to the Keyword Hub (dedupe — remove `localSeoEl` from Strategy). Touches BOTH `KeywordStrategy.tsx` AND `KeywordHub.tsx` (Trap #4) — both edits in the same PR, both behind the flag, snapshot-test gated.

---

## 6. `?tab=` + flag-gating + flag-OFF-parity story

- **`?tab=` two-halves contract:** keep the literal tab `id`s (`overview|content|rankings|competitive`) in `STRATEGY_INTERIOR_TABS` (`KeywordStrategy.tsx:52`) — only the `rankings` *label* becomes "Keywords & Rankings". The sender appends `?tab=`; the receiver (`resolveTabSearchParam`, `:69`) reads `searchParams.get('tab')`. Gated by `tests/contract/tab-deep-link-wiring.test.ts`. The v3 `?rec=` wayfinding contract is unaffected.
- **Flag-gating:** all net-new UI is behind `strategy-command-center` (default `false`, `rolloutTarget:'staging-validation'`, group `Strategy`). The flag's job is now narrowly "v3 cockpit vs v2 ActQueue" inside Overview AND "new IA vs leaked-chrome IA" — it is **not** a whole-page fork. Any **child** flag (none currently planned; if a phase needs one) must be added to `shared/types/feature-flags.ts` **before** the first commit (`npm run verify:feature-flags` gate).
- **Flag-OFF parity (byte-identical):** flag-OFF today renders the 4-tab command-center IA with the v2 ActQueue and the leaked `clientFeedbackCombinedEl`/`settingsEl`/`localSeoEl`. **All moves (promote What Changed, move ClientKeywordFeedback, collapse Settings, dedupe Local SEO, fold Signals, re-home cannibalization) are inside `commandCenterEnabled === true` branches only.** The gate is the byte-identical snapshot on the **real public read** (`tests/integration/recommendations-public-allowlist.test.ts`) + flag-ON no-admin-key-leak. **Add "run the flag-OFF snapshot test" to the PR checklist for every phase that touches `KeywordStrategy.tsx`** (PM + Trap #4).

---

## 7. Phasing (front-load visible wins; phase-per-PR; staging-first)

Each phase is exactly one PR; phase N+1 does not start until phase N is merged and green on `staging`.

### P1 — Visible wins, zero migrations (one week)
- Promote `strategyDiff` (What Changed) to top of Overview (keep amber chrome).
- Build `useShowMore` and apply to ContentGaps, TopicClusters, KeywordOpportunities, position movements, competitor gaps.
- **No data-model work.** No managed-set, no why/how/result, no signal-fold (PM Risk 3 — hold P1 scope tight so the fast-feedback value survives).
- **Migrations:** none. **Validates the tab structure before any storage change.**

### P2 — The big visible structural move, zero migrations
- Rename Rankings → "Keywords & Rankings" (label only; keep `id='rankings'`).
- Move keyword surfaces there: passive `SiteTargetKeywords` display, `KeywordOpportunities`, `ClientKeywordFeedback` (out of leaked chrome).
- **Passive managed-set display only — no write path** (PM steer: observe the IA on staging before locking persistence).
- **Migrations:** none. Frontend-only; deep-link contract test is the gate.

### P3 — The revenue phase: managed-set writes + universal send (the only migration)
- **Migration:** `strategy_keyword_set` table + `server/domains/strategy/managed-keyword-set.ts` (upsert, reconciler wired into regen txn, typed interface, unique `(workspace_id, keyword)`).
- Managed-set write path: add/remove/keep persistence, auto-replenish, search-and-add, add-from-client-requests. `STRATEGY_KEYWORD_SET_UPDATED` registered in `server/ws-events.ts` **before** any frontend reference; matching `useWorkspaceEvents(ws, WS_EVENTS.STRATEGY_KEYWORD_SET_UPDATED, …)` handler invalidating `queryKeys.admin.strategy` AND `queryKeys.admin.strategyKeywordSet`.
- Universal Send-to-client wired on keyword opportunities (`keyword_gap`), decaying pages (decay RecType), and competitor (**new `competitive_gap` RecType** + registry + facet + renderer). All via `sendRecommendation()`.
- Brief pre-seed: extend `fixContext` + the brief-generator receiver.
- New ActivityTypes (`strategy_keyword_*`, plus any `rec_sent` reuse) registered same-commit.

### P4 — Cleanup + enrichment, no migrations
- Why → how → result presenter across cockpit rows, ContentGaps, TopicClusters, KeywordOpportunities.
- Signal-fold: mint signals as recs at gen time, delete `intelligenceSignalsEl`, **fix the double-"ago" bug in the same commit** (`IntelligenceSignals.tsx:49`). Performance audit of carry-over before merge.
- Cannibalization re-home: swap `CannibalizationAlert` → `CannibalizationTriage` in Content tab.
- Config consolidation: collapse Settings + Local SEO config into the accordion; dedupe `LocalSeoVisibilityPanel` (results → Keyword Hub). Touches `KeywordStrategy.tsx` + `KeywordHub.tsx`.
- **PM gate:** if P4 ships without the signal-fold, treat it as an explicit decision to *never* do it (it was already deferred once in v2) — not a silent re-deferral.

> **Why this ordering vs the foundation's rough P1–P4:** identical spine. I front-load P1/P2 as pure visible IA (zero migrations) so the operator sees the transformation in week one and the tab structure is validated before the single `strategy_keyword_set` migration lands in P3. The Engineer's "one migration, in P3" and the PM's "display-first, write-second" both point here; I make P3 the sole schema commit so migration risk is isolated to one reviewable PR.

---

## 8. Testing + Risks

### Testing (per phase)
- **P1:** component tests for `useShowMore` (cap, showMore, showLess, reset); snapshot/DOM assertion that What Changed renders above the cockpit when `hasChanges`. **Flag-OFF byte-identical snapshot** on the real public read.
- **P2:** `tests/contract/tab-deep-link-wiring.test.ts` passes with the relabeled tab; integration test that `?tab=rankings` deep-links to "Keywords & Rankings"; flag-OFF snapshot.
- **P3:** integration tests for `strategy_keyword_set` CRUD + **reconciler-survives-regen** (add keep flag → run regen → assert flag persists — the Trap #1 regression guard); race test that the reconciler is the sole writer inside the regen txn; send-path integration through `sendRecommendation()` for `keyword_gap`/decay/`competitive_gap` asserting `clientStatus` set and `RecStatus` untouched; **public-read integration** (not admin GET) for any new client-facing field; `verify:feature-flags`.
- **P4:** `strike-never-completed` exit-gate green before merge; signal-fold integration (folded signals appear as active recs via `isActiveRec`, standalone card gone); assert no "ago ago" in rendered output; cannibalization re-home renders `CannibalizationTriage` not `CannibalizationAlert`; `grep -r "purple-" src/components/client/` clean.
- **Every phase:** `npm run typecheck && npx vite build && npx vitest run && npx tsx scripts/pr-check.ts`.

### Risks (ranked)
1. **Managed-set persistence trap (highest).** A `kept_at` column on `keyword_gaps`/`topic_clusters`/`cannibalization_issues` is clobbered on regen. **Mitigation:** the dedicated `strategy_keyword_set` table + reconciler-survives-regen test, gated before P3 merge. State this explicitly in the P3 plan before any code.
2. **Send-to-client fragmentation.** Four separate send paths instead of one. **Mitigation:** hard gate — no new `ClientActionSourceType`; pr-check rule flagging `clientActions.create()` in `src/components/strategy/**` without justification; all sends through `sendRecommendation()`.
3. **Lifecycle-axis re-conflation.** A new surface re-implements a partial active filter or writes `RecStatus` on strike/throttle/send. **Mitigation:** mandate `isActiveRec()` as the only filter; `strike-never-completed` exit-gate green before P4.
4. **Flag-OFF drift / chrome leak.** Moving `clientFeedbackCombinedEl`/`settingsEl`/`localSeoEl` could change flag-OFF. **Mitigation:** all moves inside `commandCenterEnabled` branches; flag-OFF snapshot on the PR checklist for every `KeywordStrategy.tsx`-touching phase.
5. **Signal-fold silently re-deferred + the "ago ago" bug riding along.** **Mitigation:** named P4 acceptance criterion with the bug fix as a required co-commit; if dropped, it's an explicit "never do it" decision.
6. **Carry-over performance under a larger rec set.** **Mitigation:** audit carry-over for O(n²) `.find()` scans, convert to `Map` lookups before the fold ships.
7. **Orphan-leaf false-assumption.** `index.ts:28-42` lists components as "re-homed" that were never wired (CannibalizationTriage is the proof). **Mitigation:** audit each leaf's actual importers before assuming it's wired (`pre-plan-audit` will catch this).

### Net-new inventory (everything else is reuse)
- `src/hooks/useShowMore.ts` (P1)
- `strategy_keyword_set` table + migration + `server/domains/strategy/managed-keyword-set.ts` + `shared/types/strategy-keyword-set.ts` (P3)
- `STRATEGY_KEYWORD_SET_UPDATED` ws-event + handler (P3)
- `competitive_gap` RecType (union + registry + facet + renderer) (P3)
- `fixContext` payload extension + brief receiver (P3)
- why/how/result presenter (P4)
- pr-check rule: `clientActions.create()` in strategy components requires justification (P3)
- New ActivityTypes: `strategy_keyword_kept|removed|added` (admin-only, P3)

Everything else — the cockpit, lifecycle engine, `sendRecommendation`, deliverable adapter, `CannibalizationTriage`, `SiteTargetKeywords`, `useToggleSet`, `StrategyDiff`, intelligence slices, `isActiveRec`/carry-over, the public allow-list — is **reuse**.
