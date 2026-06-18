# Strategy v3 — Design C: "Product-led / client-engagement + learning-loop maximal"

**Date:** 2026-06-17
**Team:** Design Committee — Design C (client experience + agency↔client narrative + self-managing learning loop)
**Philosophy/lens:** Push D1 (curated client overview + inline pointers) and D4 (self-managing + learning lifecycle) the furthest. Optimize for client engagement, agency narrative control, monetization, and the "wow" — while staying byte-identical flag-OFF, phase-per-PR, staging-first, and grounded in the ~75–80%-built reality.
**Ground truth honored:** `docs/superpowers/audits/2026-06-17-strategy-v2-feedback-audit-findings.md` (forks A/B/C, D1–D4, orphan audit, S/M/L/XL efforts) + `docs/superpowers/notes/2026-06-17-strategy-v2-walkthrough-feedback.md` (notes #1–#12 + north-star constraints).

---

## 1. Thesis (one paragraph)

Strategy v3 turns the admin Strategy page into a **curation cockpit** and the client dashboard into a **narrative-controlled "Recommended this month" storefront** — and closes the loop between them so the system *manages its own recommendations and gets visibly smarter from client behavior.* Every actionable item on the admin side (rec, cannibalization, keyword opportunity, decaying page, competitor, topic cluster) becomes a **why → how → projected-result story** that the operator can **Send / Fix / Throttle / Strike** through one lightweight client-facing lifecycle (`system → curated → sent → approved | discussing | declined`). On the client side those sent recs roll up into a short, finite, **engaging curated overview** (D1), with **inline pointers** on the data screens ("💡 1 recommendation here →") so the rec shows up *where it's relevant* — never a wall of AI firehose. The learning layer (D4) watches the curation loop itself: it nudges the operator about stale sent recs, flags supersession ("a better rec now exists for this"), and feeds **client approve/decline/ignore as an outcome signal** into the already-built `outcome-tracking` / `workspace-learnings` infra so the EMV calibration and rec ordering measurably improve over time. The whole thing is a thin, mostly-reframing layer on proven mechanisms (cannibalization send spine, `keyword_feedback` declined overlay, snooze precedent, OutcomeScore/EarlySignal), shipped phase-per-PR behind the existing `strategy-command-center` flag.

---

## 2. Architecture — the recommendation lifecycle + cockpit + curated client overview + inline pointers + learning/staleness/supersession (admin AND client for each)

### 2.0 The one lifecycle that powers everything (D2 / D3 / D4)

Per **D2 (hybrid)**, recommendations get a **lightweight client-facing lifecycle field** on the recommendation entity — they are NOT promoted to deliverables. Work-products (content briefs, the cannibalization consolidation card) stay deliverables on the proven Inbox spine.

```
RecClientStatus =
  'system'      // engine-minted, admin-only (Layer 2 raw) — the default
  'curated'     // operator promoted it in the cockpit but hasn't sent (staging shelf)
  'sent'        // visible to the client in "Recommended this month" (sentAt set, staleness clock starts)
  'approved'    // client clicked Approve (retainer) or Add·$ (à-la-carte) → becomes work
  'discussing'  // client clicked Discuss → light thread on the rec
  'declined'    // client passed → outcome signal + feeds keyword_feedback when keyword-typed
  'throttled'   // operator deferred (throttledUntil) — D3
  'struck'      // operator rejected (soft, reversible, cascades) — D3
```

This is stored **alongside** `RecStatus` (`pending|in_progress|completed|dismissed`), which keeps its engine meaning. **`struck` and `throttled` are NOT `RecStatus` values** — they are `RecClientStatus`, deliberately decoupled so they never collide with the merge/auto-resolve loop (see §5). `system` is the byte-identical-OFF default: when the flag is off, every rec is `system` and the admin/client surfaces render exactly as today.

New shared type (in `shared/types/recommendations.ts`, additive, all optional → legacy/flag-OFF rows unaffected):

```ts
export type RecClientStatus =
  | 'system' | 'curated' | 'sent' | 'approved' | 'discussing' | 'declined' | 'throttled' | 'struck';

export interface Recommendation {
  // ...existing fields...
  clientStatus?: RecClientStatus;   // absent → treated as 'system'
  sentAt?: string | null;           // staleness clock (mirrors deliverable sentAt precedent)
  throttledUntil?: string | null;   // snooze precedent
  supersededBy?: string | null;     // recId of the better rec (D4 supersession)
  clientResponseAt?: string | null;  // when approved/discussing/declined happened (outcome timestamp)
}
```

A new state machine `RECOMMENDATION_CLIENT_TRANSITIONS` in `server/state-machines.ts` governs legal moves (e.g. `sent → approved | discussing | declined | throttled`; `struck → curated` (un-strike); `throttled → curated` (un-throttle); `declined` is terminal-ish but reopenable to `curated`). Every cockpit action calls `validateTransition()` first — a move not listed is a bug, per project law.

### 2.1 Admin — the cockpit (D3: Act queue with status filters + Send/Fix/Throttle/Strike)

**Single surface, no extra tab.** The Act queue (`src/components/strategy/ActQueue.tsx`) gains a **status filter strip** layered above the existing category chips (All / Content / Technical / Quick wins):

```
[ Active 112 ] [ Curated 4 ] [ Sent 18 ] [ Approved 6 ] [ Throttled 9 ]      ← D3 client-status chips (row 1)
[ All ] [ Content ] [ Technical ] [ Quick wins ]                              ← existing category chips (row 2)
```

- **Active** = `clientStatus ∈ {system, curated}` AND `RecStatus ∈ {pending, in_progress}` (the engine's live feed; default view).
- **Sent / Approved / Throttled** filter on `clientStatus`. **Struck** is hidden by default with a small "Show struck (N)" toggle (so strikes are reversible & auditable, never a black hole).

**Row actions** (`RecommendationRow`) — the four D3 verbs, each a status transition ("just a flag" steer, verified against `client-signals-slice.ts` dismissed-filter precedent):

| Action | Transition | Cascade / side-effect |
|---|---|---|
| **Send** | `* → sent` (sets `sentAt`) | Writes `clientStatus='sent'`; broadcasts `RECOMMENDATIONS_UPDATED`; client overview picks it up. No deliverable created (recs ≠ deliverables, D2). |
| **Fix** | unchanged | Existing `onFix` → navigate to the owning tab with **pre-seeded `strategyCardContext`** (§2.6, #8a). |
| **Throttle** | `* → throttled` (sets `throttledUntil`) | Mirrors the `suggested-briefs` snooze precedent. Auto-resurfaces after N days (default 30) OR manual un-throttle. Merge carry-over must preserve `throttled` (§5). |
| **Strike** | `* → struck` | **Soft, reversible, type-routed cascade** (§5). Writes a `keyword_feedback` declined row for keyword/cluster/local recs; plain status-suppress for CTR/technical/decay. NEVER a hard page-keyword delete; NEVER auto-resolves to `completed`. |

**Foundation tasks first** (the audit's "engine de-risk"): there is **no admin status-mutation endpoint today** (only public/client routes + admin GET/undismiss) and **no `RECOMMENDATIONS_UPDATED` workspace-events handler on the Act queue** (it doesn't live-refresh). So Phase 1 adds: `PATCH /api/recommendations/:workspaceId/:recId/client-status` (admin, HMAC-gated — never `requireAuth`, per auth law), a `useRecommendationClientStatus` mutation hook, and a `useWorkspaceEvents(workspaceId, { [RECOMMENDATIONS_UPDATED]: ... })` handler that invalidates `queryKeys.admin.recommendations`. (`RECOMMENDATIONS_UPDATED` already exists in `server/ws-events.ts:135` — only the handler is missing.)

**Pagination (#3.1):** the queue currently renders the full active set (`visible.map`) with no cap. Replace with the **shared `<ShowMoreList>` primitive** (§3, #8b) — cap at N (default 8), "Show N more". This is the same primitive that sweeps ~9 silently-capped cards.

### 2.2 Admin — the curated overview "preview" (narrative control before send)

A small **"This month's client view" preview panel** at the top of the cockpit (collapsible, admin-only) shows exactly what the client currently sees in their "Recommended this month" overview — the *sent* recs, in order, with the same why → result → action framing. This is the agency's **narrative-control cockpit**: the operator sees the client's curated story as a finite, sendable artifact, not a side-effect. Powered by the same read path as the client overview (§2.3), just rendered admin-side with extra controls (re-order, un-send, throttle-from-here). This is the "wow" for the operator: *you literally see and control the client's narrative.*

### 2.3 Client — the "Recommended this month" curated overview (D1)

**The client's hub.** A new client component `<RecommendedThisMonth>` (in `src/components/client/`, gated by `strategy-command-center` via `<FeatureFlag>`), mounted at the top of `OverviewTab.tsx`. It reads a **new curated projection** `GET /api/public/recommendations/:workspaceId/curated` returning ONLY `clientStatus='sent'|'approved'|'discussing'` recs (never raw `system` — that's the Layer-2 flip, §5/Fork C). Each rec is one card:

```
┌─────────────────────────────────────────────┐
│ 💡  Refresh "Best AI coding agents 2026"      │
│                                               │
│ WHY    Traffic on this page is down 34% as    │   ← narrative, outcome-oriented
│        3 competitors published fresher takes. │
│ RESULT Could recover ~480 visits/mo and       │   ← impactBand only (EMV stripped)
│        reclaim position 4→2.                   │
│                                               │
│ [ Approve ]   [ Add · $250 ]   [ Discuss ]    │   ← one decision, three doors
└─────────────────────────────────────────────┘
```

- **Short + finite** (cap ~6 via `<ShowMoreList>`), each rec = **why → result → one action** (D1). No admin jargon, **no purple** (verified law; `grep -r "purple-" src/components/client/` gate). Teal CTAs, blue data, emerald success.
- **Approve** = retainer-included → transitions `sent → approved`, records an outcome action (`ActionType` per rec type, e.g. `content_refreshed`, `strategy_keyword_added`), and dual-writes the resulting work-product as a deliverable via the proven spine (the rec spawns a brief/work-order — recs ≠ deliverables, but an *approved* rec *creates* one).
- **Add · $price** = à-la-carte → Stripe Checkout (existing per-item purchase wiring), then same `approved` transition + work spawn. This is the **monetization path made delightful** (rec → send → approve/add·$ → work → invoice), all from one card.
- **Discuss** = `sent → discussing` → opens a **light thread on the rec** (D2 "Discuss = a light thread on the rec," NOT a full Inbox deliverable). Reuses the existing rec-comment/thread surface; the operator sees it in the cockpit and can revise + re-send.
- **Header micro-story:** "3 things we recommend this month · 1 approved · 1 in discussion" — a finite, satisfying progress line, not a count of 144.

**Empty state** (action-oriented per UI law): "Your strategy is on track this month — nothing needs your decision right now. We'll surface new recommendations as opportunities appear."

### 2.4 Client — inline pointers (D1 second half)

On the relevant **data screens** (Health/Insights, Rankings, Content), a tiny **`<InlinePointer>`** chip appears where a sent rec is relevant: **"💡 1 recommendation here →"** that deep-links into `<RecommendedThisMonth>` scrolled/anchored to that rec (`?rec=<id>`, two-halves deep-link contract — sender appends, receiver reads `useSearchParams`). Mapping is by `affectedPages` / `targetKeyword` → screen. This is the "rec shows up where it's relevant" half of D1's blend — engagement without duplication: the rec lives in ONE place (the overview), the pointer is a wayfinding breadcrumb, not a second render (avoids the audit's double-render hazard).

### 2.5 The learning / staleness / supersession mechanics (D4) — "Layer 2 watching Layer 3"

D4 is the differentiator. Net-new is a **thin layer on built infra** (`outcome-tracking.ts`, `workspace-learnings.ts`, `learnings-slice.ts`, outcome crons, `sentAt`). Three mechanics:

**(a) Staleness nudges (admin meta-recs).** A daily cron (extend the existing intelligence-recompute / outcome cron) scans `clientStatus='sent'` recs where `now - sentAt > STALE_DAYS` (default 21) and `clientResponseAt IS NULL`. It mints a **meta-nudge** surfaced in the cockpit's "Curation health" strip: *"'Refresh X' has been available to the client for 24 days, not accepted — Re-send / Throttle / Drop?"* with one-click actions. This is the self-managing pillar: nothing persists indefinitely.

**(b) Supersession (admin).** On regen, if a newer rec covers the same `affectedPages`/`targetKeyword` as an already-`sent` rec with a higher `opportunity.value`, the new rec is tagged `supersededBy`-pointed and the cockpit flags: *"A stronger recommendation now exists for this page — replace the sent one?"* Operator confirms → the old sent rec transitions to `curated` (un-sent) and the new one to `sent`, with a single client-facing swap (the client sees the better story, never two). Grounded in the existing merge/source-key matching (`server/recommendations.ts` merge phase).

**(c) Client response as an outcome signal (the learning flywheel).** Approve/Discuss/Decline/ignore are written as outcome signals into the EXISTING backend:
- **Approve** → `recordAction()` with the rec's `ActionType` + snapshot baseline (already the outcome path) → EarlySignal (`on_track|no_movement|too_early`) accrues → EMV calibration (`OpportunityScore.calibration` 0.75–1.25) tightens.
- **Decline** → for keyword-typed recs, writes a `keyword_feedback` declined row (so regen never re-suggests it — the overlay already filters declined, §3/§5) AND a `workspace-learnings` negative signal ("client passes on X-type recs") that down-weights that rec category in future ordering.
- **Ignore** (sent, no response past STALE_DAYS) → a weak "no_movement on the *curation* loop" signal — the system learns which rec *framings* don't convert, not just which *topics* don't perform.

**Why this is the "wow":** over a few cycles, the client's "Recommended this month" overview measurably reorders toward what *this client* approves, and the operator sees a **"Learnings"** line in the cockpit: *"This client approves content refreshes 3× more than technical fixes — we're surfacing more of those."* The learning backend is visibly improving the recommendations. This is `learnings-slice.ts` + `LearningsTrend` surfaced in a human sentence, plus the cross-system feedback both-halves rule (server broadcast + frontend invalidate) satisfied.

> **D4 grounding caveat (honest):** the outcome backend keys on `ActionType` (content/keyword/schema actions). "Client declined a *framing*" is a net-new signal *category* — I model it as a `workspace-learnings` entry, not a new `OutcomeScore`, to avoid polluting the EMV-calibration math with non-execution signals. The framing-learning is advisory (reorders the cockpit), the execution-learning is authoritative (calibrates EMV). This respects the "deterministic-first / advisory until validated" eval law.

---

## 3. The keyword / content half (Strategy↔Hub boundary, "Keywords & Rankings" tab, managed sets, Fork-B overlay, dedups)

### 3.1 The Strategy↔Hub boundary principle (resolves #1, #2, #6, #11)

**Principle (locked):** **Strategy = decide / act / orient + the curated working slice; Keyword Hub = the full keyword universe + deep research.** The curated top-10–20 set is the *Strategy-flavored truncated slice*; the Hub is the universe. One home per concern.

- **#11 — Rankings tab → "Keywords & Rankings."** Relabel the tab (keep the route id, two-halves `?tab=rankings` receiver intact). It composes: Ranking Distribution (existing) + the **curated managed keyword set** (#6) + **Keyword Opportunities (send-to-client)** (#6b) + **client requested keywords** (#2 routing) + a prominent **"Open Keyword Hub for the full universe + deep research →"** deep-link (existing `keywordHubDeepLink`). Fills the empty tab AND gives keyword management a Strategy-side home.
- **#1 — Strategy Settings + Local SEO config fold.** Per Josh's direction (b): one collapsed **"Strategy setup"** entry (provider + page limit + business context + local market/location). The config/visibility split already exists (`LocalSeoVisibilityPanel` `mode='strategy'` = config vs `mode='keywords'` = visibility). Fold the **config** into "Strategy setup"; keep the **visibility panel** in the Hub as its single home — **remove `LocalSeoVisibilityPanel` from `KeywordStrategy.tsx`** (it renders in BOTH today; pick the Hub). Dedup confirmed by audit.
- **#2 — Client Keyword Feedback routing.** The component already takes separable requested/declined/approved props. Route **requested → the Act/curated area** (a client asked to add a keyword = an *action*, surfaces as a "client requested this keyword" row in Keywords & Rankings, operator Adds/Declines), and the **declined+approved LOG → the Hub** (reference history). No rewrite.

### 3.2 Managed sets — add / remove / keep / auto-replenish (#6, #9a)

Both `siteKeywords` (curated set, blob) and `topicClusters` (table-backed) become **editable managed sets** via ONE shared hook `useManagedKeywordSet` over the existing `keywords.patchStrategy` write path (the audit confirms the entire transactional PATCH route exists: `keyword-strategy/:id` accepts `siteKeywords[]` and full `topicClusters[]`, snapshots history, regens recs).

- **Remove** a keyword/cluster → writes it to the **kept/removed overlay** (Fork B, §3.3) AND (for keywords) a `keyword_feedback` declined-or-removed row.
- **Keep** → marks it in the kept-set so regen never drops it.
- **Auto-replenish** → on remove, pull a replacement from the `opportunities`/`keywordGaps` pool, **skipping just-removed + client-declined** (`keyword_feedback` already filters declined). The replacement is *suggested* (operator confirms), not silently injected.
- **Search-and-add** + **add from client recommendations** (#2 requested → this set) close the keyword collaboration loop (#2 log ← #6b send ← #6 destination).

**3-store discipline (audit law):** the curated set is the `siteKeywords` blob; `page_keywords` (per-page targeting) and `tracked_keywords` (the Track button) are NOT conflated — the managed-set UI writes only the blob + overlay + feedback.

### 3.3 Fork B resolution — the persistence-across-regeneration overlay

**THE gating decision for managed sets.** Without it, the audit warns: *"the managed-set feature is a trust-destroying mirage"* — operator curation silently vanishes the moment they click Refresh, because `siteKeywords`/`opportunities`/`topicClusters` are AI-regenerated every run.

**Resolution — a `respected-edits` overlay, modeled directly on the proven `keyword_feedback` declined-filter precedent** (which the regen synthesis *already honors* via a post-generation hard filter at `keyword-strategy-ai-synthesis.ts:1521`). New table `strategy_curation_overlay`:

```sql
CREATE TABLE strategy_curation_overlay (
  workspace_id TEXT NOT NULL,
  entity_type  TEXT NOT NULL,   -- 'keyword' | 'cluster'
  entity_key   TEXT NOT NULL,   -- normalizeKeyword(keyword) | cluster slug
  decision     TEXT NOT NULL,   -- 'kept' | 'removed'
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (workspace_id, entity_type, entity_key)
);
```

The synthesis pass honors it with the **same hard-filter pattern that already works for declined keywords** — a `post-generation overlay reconciliation` step right beside the existing declined filter:
1. After AI mints `siteKeywords`/`topicClusters`, **drop any `removed`-overlay entries** (mirrors the declined filter exactly).
2. **Re-inject any `kept`-overlay entries** the AI dropped (the keep guarantee).

This is the *same* "persist-across-regeneration" constraint already specced (but unbuilt) for the cannibalization keeper-override roadmap item — so it's **one overlay mechanism serving managed sets AND the cannibalization keeper**. The overlay is small, table-backed, and rides the proven filter path — not a net-new synthesis rewrite. **`useManagedKeywordSet` writes the overlay transactionally with the PATCH** so an add/remove is durable before the next Refresh.

### 3.4 The dedups & why→how→result (#9c)

- **#12a — backlinks → Links page.** `BacklinkProfile` is self-contained (workspaceId only). Add a Backlinks tab to the existing `links` Page; remove from Competitive; fix the `siteId!` assertion so it loads without a connected site. Competitive tab keeps share-of-voice + keyword gaps + competitor comparison (and becomes a send-to-client surface, #12b).
- **#9c — why → how → result.** The data already ships for recs/gaps (`OpportunityComponent.evidence`, `insight`, `description`, `impactBand`). Only `TopicCluster` needs a **net-new `rationale` + `projectedImpact` field** (which #9a/#9b also want). This is the SAME row layout that powers every send card (you can't send "interested?" without why+result) — build the layout once, reuse on recs, gaps, clusters, opportunities.
- **#9b — research off a cluster.** Wiring, not new infra: per-cluster "Run research" → `getKeywordIdeas(cluster keywords)` via the existing research service + jobs platform (a `start_keyword_strategy_generation`-style background job). Background-job law: returns `{ jobId }`, surfaces via `useBackgroundTasks` + `NotificationBell`.

---

## 4. Explicit resolutions — Fork B, LostQuery, and every open item

| Open item | Resolution |
|---|---|
| **Fork B (overlay)** | `strategy_curation_overlay` table (kept/removed) honored by the synthesis pass via the proven `keyword_feedback` hard-filter pattern; ONE overlay serves managed sets + cannibalization keeper. (§3.3) |
| **Fork A (send substrate)** | **Recs use D2's lightweight `clientStatus` on the rec entity — NOT the deliverable substrate.** Recs ≠ deliverables. The client overview reads `sent` recs directly. Concrete work-products (briefs, cannibalization consolidation) keep the proven `client_deliverable` spine. This sidesteps the `coerceType → seo_edit` corruption hazard for recs entirely (no per-type send registration needed for the rec path; the deliverable path keeps its existing registered types). One **generic admin send route** is still added — but for recs it's a `clientStatus` PATCH, not a deliverable mint. |
| **Fork C / Layer-2 flip** | **Client sees curated-only (`sent`+) in "Recommended this month," BUT raw `system` recs still power InsightsEngine/Health internally** via a separate read. The flip is *additive*: the curated overview is the new hero; the existing raw-rec surfaces (Action Plan, Health upsell) keep their data so they don't empty (§5). Flag-OFF: no curated overview, raw surfaces unchanged → byte-identical. |
| **LostQueryRecoveryCard (silent total loss)** | **Add a `lost_query` rec type** (not just re-home the card). Rationale: the whole v3 thesis is "every actionable item is a why→how→result rec you can Send/Strike/Throttle." A lost-query recovery is exactly that — a content/CTR opportunity. Re-homing the standalone card would re-create the orphan/double-render problem; minting it as a first-class `RecType` puts it in the ONE Act queue with Send-to-client ("we lost these queries — want us to recover them?"). Effort: M (new rec type registration — union + XData + Zod + renderer, per the 4-in-one-commit law). The orphaned card is then deleted in cleanup. |
| **Strategy↔Hub boundary + "Keywords & Rankings" tab** | Strategy = decide/act/orient + curated slice; Hub = universe + deep research. Rankings tab → "Keywords & Rankings" (relabel, keep id), composes distribution + managed set + opportunities(send) + requested + Hub link. (§3.1) |
| **Shared show-more primitive** | Extract ONE `useShowMore` / `<ShowMoreList>` (the audit's "single biggest systemic lever"), sweep ~9 silently-`.slice(0,N)`-capped cards + the Act queue + Content Gaps. Sequence with #9c (same rows). (§3, Phase 1) |
| **Brief pre-seeding (#8a)** | Add `strategyCardContext?` to `FixContext` + `StandaloneContentBriefGenerationParams` (currently MISSING — naive wiring silently drops it). Build ONE mapper (gap/rec/cluster → `StrategyCardContext` via the existing `buildStrategyCardBlock`) and wire it at the 3 handoff sites (Act-queue Fix, ContentGaps Draft/Create-brief, cluster→brief). (§2.6 ref / Phase 5) |
| **why→how→result layout** | One row-layout component reused across recs/gaps/clusters/opportunities + every send card. Data exists except `TopicCluster.rationale`/`projectedImpact` (net-new fields). (§3.4) |
| **Orphan cleanup** | Re-home `CannibalizationTriage` (restores keeper+fix+resolve+send) replacing passive `CannibalizationAlert`; re-home `RequestedKeywordTriage` into Keywords & Rankings (honors locked Decision #7); **promote** `StrategyDiff` "What Changed" (un-retire — amend plan Decision #3 in-commit, #5); do the signal-fold Task 2.2 + remove the standalone `IntelligenceSignals` card (#7); delete `OpportunitiesList`/`DecisionQueue`/orphaned-LostQuery card; **fix the stale, misleading `index.ts` orphan comment in the same commit.** |
| **Throttle semantics** | Auto-resurface after N days (default 30) — the snooze precedent — with manual un-throttle. Merge carry-over must preserve `throttled` (§5). |
| **Auto-replenish source/rule** | Pull from `opportunities`/`keywordGaps`, skip just-removed + client-declined (overlay + `keyword_feedback`); replacement is *suggested* (operator confirms). |
| **Layer-2 client surface** | Curated overview is the client hero; raw `system` recs stay internal-only powering existing engine surfaces (not a new client surface). (§5) |
| **Umbrella flag** | **Keep the existing `strategy-command-center` flag** (still OFF on prod) as the umbrella for the whole v3 track — no new top-level flag. Each phase dark-launches sub-behavior under it; finer sub-flags (e.g. `strategy-curation-loop`) only if a phase needs independent rollout. |
| **#1 Local SEO visibility home** | Hub (single home); config folds into "Strategy setup." |
| **`bug` "Computed X ago ago"** | 1-line fix (`IntelligenceSignals.tsx:49`) + test assertion. Phase 1. |

---

## 5. Key RISKS and how this design handles them

### Risk A — Strike cascade must be soft, reversible, and NOT auto-resolve to `completed`
**The biggest engineering risk (audit-confirmed).** `autoResolveByAffectedPages` (`server/recommendations.ts:451–489`) marks any non-dismissed rec whose `affectedPages` vanish as `completed`. So a hard cascade (strike a keyword-gap rec → *delete* the page-keyword) would make the struck rec's source vanish → it auto-flips to `completed` → reads as **"✓ done"** to the client. Unacceptable.

**Mitigations (all three):**
1. **Soft cascade target.** Strike writes a `keyword_feedback` declined row (and/or `removed` overlay entry) — which *suppresses regeneration of the gap* without deleting any page-keyword. The source doesn't "vanish," it's *suppressed at mint*. Reversible (un-strike removes the declined row).
2. **`struck` is `RecClientStatus`, not `RecStatus`.** The merge/auto-resolve loop only reads `RecStatus` and explicitly skips `completed|dismissed`. A struck rec keeps `RecStatus='pending'` but `clientStatus='struck'`; the Act queue's Active filter excludes `clientStatus='struck'`. So it disappears from the operator's view without ever touching the `completed` branch.
3. **Type-routed cascade.** keyword/cluster/local → declined-overlay cascade; CTR/technical/decay → plain status-suppress (nothing downstream to remove), matching Josh's Q1. **Verification gate:** an integration test that strikes a keyword-gap rec, runs a regen, and asserts the rec is NOT `completed` and the client curated projection does NOT show it (the audit's explicit "verify the dismissed-vs-completed branch").

### Risk B — The Fork B overlay (curation silently vanishing on Refresh)
Handled in §3.3: the overlay rides the **already-working** declined-filter path in synthesis (`keyword-strategy-ai-synthesis.ts:1521`), so the persistence guarantee uses a proven mechanism rather than a net-new synthesis rewrite. **Verification gate:** integration test — add/keep/remove via `useManagedKeywordSet`, trigger a full strategy regen, assert kept survives + removed stays gone.

### Risk C — The Layer-2 flip emptying client InsightsEngine / Health upsell
**Verified concrete:** `src/components/client/InsightsEngine.tsx:161` reads `/api/public/recommendations/:id` (raw recs) to power the Action Plan + Health upsell. Naively "hiding raw Layer-2 to show only curated Layer-3" empties those surfaces.

**Resolution — additive, not subtractive.** The curated overview is a **new** read (`/api/public/recommendations/:id/curated` → `sent`+ only). The existing raw `/api/public/recommendations/:id` endpoint is **unchanged** — InsightsEngine/Health keep their data. Flag-ON, the *narrative emphasis* shifts (curated overview is the hero at the top of OverviewTab; raw recs recede to a "more signals" disclosure or stay powering Health), but **no surface is emptied**. Flag-OFF, the curated overview doesn't mount → byte-identical. A later, deliberate, separately-flagged decision can dim the raw surfaces once the curated overview proves out — but v3 ships the flip as purely additive to de-risk. **Verification gate:** flag-OFF snapshot test on the public recommendations endpoint + InsightsEngine render = byte-identical to current.

### Risk D — Double-render / orphan hazards
One home per concern (audit law): cannibalization is EITHER the Act-queue rec type OR the triage card, not both; lost-query is a rec type, not a re-homed card; signals fold into the queue and the standalone card is removed. The misleading `index.ts` orphan comment is fixed in the same commit it stops being true. Inline pointers (§2.4) are wayfinding chips, not second renders.

### Risk E — Monetization correctness (rate/denominator + Stripe paths real)
The "Add · $price" path reuses the **existing per-item content-purchase Stripe Checkout** wiring (not invented). Any rate/count shown ("1 approved of 3") shares a single source (the curated projection) per the numerator/denominator law. Approved→work→invoice spawns a real deliverable/work-order via the proven spine.

---

## 6. Phase-per-PR decomposition (S/M/L/XL, flag-gated, staging-first, each shippable)

**Umbrella flag:** `strategy-command-center` (existing, OFF on prod). Every phase byte-identical flag-OFF. Phase N+1 not started until N is merged + green on staging.

### Phase 0 — Decisions + plan amendments (S)
Lock Fork A (recs use `clientStatus`, work-products keep deliverables) · Fork B (overlay) · Fork C (additive flip) · LostQuery (`lost_query` rec type). Amend the locked plan for the #5 (un-retire What Changed) and #7 (signal-fold) reversals **in-commit** so the next executor doesn't re-revert. Pre-commit shared contracts: `RecClientStatus` type, `RECOMMENDATION_CLIENT_TRANSITIONS` state machine, overlay table migration, `strategy_curation_overlay` interface. **Effort: S.**

### Phase 1 — Quick wins + cockpit foundations (M)
- "ago ago" bug + test (S) · re-home `CannibalizationTriage` replacing passive alert (S) · promote `StrategyDiff` "What Changed" (S).
- Extract `useShowMore`/`<ShowMoreList>` primitive + sweep ~9 capped cards + Act queue cap-N (L within this phase — the systemic lever).
- **Foundation:** admin `PATCH .../client-status` endpoint + `useRecommendationClientStatus` hook + `RECOMMENDATIONS_UPDATED` `useWorkspaceEvents` handler (the Act queue's missing live-refresh). Fix the stale `index.ts` orphan comment.
**Effort: M** (the show-more sweep dominates). Shippable: cleaner page, live-refreshing queue, no client change yet.

### Phase 2 — The send spine + why→how→result layout (M)
- The one `RecClientStatus` lifecycle wired end-to-end: cockpit **status filter strip** (Active/Curated/Sent/Approved/Throttled + Show-struck) + **Send** action (`* → sent`).
- The why→how→result **row layout** (reused across recs/gaps; `TopicCluster.rationale`/`projectedImpact` added).
- Decaying-page Send (#10, S — reuses `content_decay`) rides this.
**Effort: M.** Shippable admin-side: operator can curate + send; client overview not yet built (sent recs exist but no client surface → still byte-identical client-side until Phase 3).

### Phase 3 — The client curated overview + inline pointers + Layer-2 flip (L)
- `<RecommendedThisMonth>` client component + `/api/public/recommendations/:id/curated` read + Approve / Add·$ / Discuss (D1).
- `<InlinePointer>` chips on data screens (`?rec=` deep-link).
- The **additive** Layer-2 flip (curated hero; raw surfaces unchanged) + flag-OFF byte-identical verification.
- Monetization wiring (Add·$ → existing Stripe Checkout → approved → work spawn).
**Effort: L.** Shippable: the full agency→client narrative storefront. **The "wow" lands here.**

### Phase 4 — Strike + Throttle + signal-fold (L)
- **Strike** (soft/reversible/type-routed cascade, §5 Risk A) + verification gate.
- **Throttle** (snooze precedent, auto-resurface N days) + merge carry-over preservation.
- Task 2.2 signal-fold → Act queue + remove standalone `IntelligenceSignals` (#7) + `lost_query` rec type registration.
**Effort: L.** Shippable: cockpit fully actionable (Send/Fix/Throttle/Strike all live).

### Phase 5 — Managed keyword/content surfaces (L)
- Fork-B overlay table + synthesis reconciliation → `useManagedKeywordSet` → curated set (#6) + clusters add/remove/keep (#9a).
- "Keywords & Rankings" tab compose (#11) + #2 routing + #1 Local SEO config fold/dedup + #12a backlinks→Links page.
- Brief pre-seed mapper (#8a) at the 3 handoff sites.
**Effort: L.** Shippable: the keyword half + grounded briefs.

### Phase 6 — The learning loop (D4) + enrichment (L)
- Staleness nudges cron + "Curation health" strip · supersession flagging · client-response-as-outcome wiring (Approve→`recordAction`, Decline→`keyword_feedback`+learnings, Ignore→framing signal) + the cockpit "Learnings" sentence.
- Keyword-opportunity Send (#6b, type `opportunities` first) · cluster research (#9b) · competitor Send (#12b, last/gated on data).
**Effort: L (XL if competitor + research both land here — split if so).** Shippable: the self-managing learning flywheel + remaining send types.

> **Total realistic envelope:** Phase 0 S · Phase 1 M · Phases 2 M · 3 L · 4 L · 5 L · 6 L/XL. The L/XL phases are L because they're mostly *wiring proven infra* (overlay rides the declined-filter; outcome signals ride `outcome-tracking`; send rides the lifecycle flag), not net-new systems — consistent with the audit's "~75–80% built."

---

## 7. Coverage table — all 12 feedback notes + orphans

| Note | Addressed by | Phase | Effort |
|---|---|---|---|
| **#1** Strategy Settings + Local SEO | "Strategy setup" config fold; Local SEO config→setup, visibility→Hub (dedup remove from `KeywordStrategy.tsx`) | 5 | M |
| **#2** Client Keyword Feedback | requested→Keywords&Rankings action row; declined/approved log→Hub | 5 | S |
| **#3.1** Act queue length | `<ShowMoreList>` cap-N | 1 | S |
| **#3.2** Strike + cascade | Soft/reversible/type-routed cascade (declined-overlay), `struck` clientStatus, never auto-`completed` (§5 Risk A) | 4 | L |
| **#3.3** Throttle | `throttled`+`throttledUntil`, snooze precedent, auto-resurface N days, merge carry-over preserved | 4 | M |
| **#3.4/#3.5** Send to client | `* → sent` lifecycle transition + cockpit status strip | 2 | M |
| **#4** Cannibalization | Re-home `CannibalizationTriage` (keeper+fix+resolve+send) replacing passive alert; keeper-override via overlay | 1 | S |
| **#5** What Changed | Un-retire + promote `StrategyDiff`; amend plan Decision #3 in-commit | 1 | S |
| **#6** Curated keyword set | `useManagedKeywordSet` over `patchStrategy` + Fork-B overlay; add/remove/keep + auto-replenish | 5 | L |
| **#6b** Keyword-opp send | Type `opportunities`, per-opp Send ("interested?") | 6 | L |
| **#7** Intelligence Signals | Fold into Act queue (Task 2.2), remove standalone card | 4 | M |
| **#8a** Brief pre-seed | `strategyCardContext` mapper at 3 handoff sites (add to `FixContext`+params) | 5 | M |
| **#8b** Info overload | `<ShowMoreList>` global sweep (~9 sites) | 1 | L |
| **#9a** Add/remove clusters | `useManagedKeywordSet` on `topicClusters` + overlay | 5 | M |
| **#9b** Research off clusters | Per-cluster "Run research" → `getKeywordIdeas` + jobs platform | 6 | L |
| **#9c** why→how→result | One row layout reused; `TopicCluster.rationale`/`projectedImpact` net-new | 2 (layout) / 5 (cluster) | M |
| **#10** Decaying-page send | Send button reusing `content_decay` | 2 | S |
| **#11** Rankings→"Keywords & Rankings" | Relabel (keep id); compose distribution + managed set + opps + requested + Hub link | 5 | M |
| **#12a** Backlinks→Links page | Backlinks tab on `links` Page; remove from Competitive; fix `siteId!` | 5 | M |
| **#12b** Competitor send | `strategy_recommendation` recType=competitive; gate on data; last | 6 | M |
| **#12c** 3-layer keystone | Curated overview (L3) + inline pointers + additive L2 flip + cockpit = the whole v3 | 2–3 | (spine) |
| **BUG** "ago ago" | 1-line fix + test | 1 | S |
| **Orphan: LostQueryRecoveryCard** | New `lost_query` rec type (not re-home); delete card | 4 | M |
| **Orphan: RequestedKeywordTriage** | Re-home into Keywords&Rankings (honors locked Decision #7) | 5 | S |
| **Orphan: OpportunitiesList/DecisionQueue** | Delete in cleanup (superseded by ActQueue) | 1 | S |
| **Orphan: stale `index.ts` comment** | Fix in the same commit it stops being true | 1 | S |
| **D1 client overview + pointers** | `<RecommendedThisMonth>` + `<InlinePointer>` | 3 | L |
| **D4 learning/staleness/supersession** | Staleness cron + supersession + client-response→outcome/learnings | 6 | L |

**All 12 notes + every orphan + D1–D4 + 3 forks covered.**

---

## 8. What makes THIS design distinctive (the product/client lens)

1. **The client "Recommended this month" storefront is a genuine product, not an Inbox pile** — short, finite, why→result→one-action, with inline pointers so recs surface *where they're relevant*. This is the engagement bet most other framings under-invest in.
2. **The learning loop is visible to both sides** — the operator sees "this client approves refreshes 3× more, we're surfacing more"; the client's overview measurably reorders toward what they say yes to. The learning backend stops being invisible plumbing and becomes the "wow."
3. **Monetization is one delightful path** — rec → send → Approve/Add·$/Discuss → work → invoice, all from one card, reusing real Stripe wiring.
4. **Recs ≠ deliverables (D2) sidesteps the Fork-A corruption hazard** — the rec path never touches `coerceType`/`seo_edit`; only real work-products use the deliverable spine.
5. **Every risky flip is additive** — the Layer-2 flip empties nothing; strike is soft/reversible and provably never auto-`completed`; the overlay rides a filter that already works.
