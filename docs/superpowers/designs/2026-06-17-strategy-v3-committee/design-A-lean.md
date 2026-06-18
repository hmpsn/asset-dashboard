# Strategy v3 — Design A: "Lean / reuse-maximal / fastest-to-value"

**Date:** 2026-06-17
**Author lens:** Minimize net-new code; lean hardest on what's already built; sequence for the fastest path to client-visible value; ruthless YAGNI.
**Ground-truth inputs:** [audit findings](../../audits/2026-06-17-strategy-v2-feedback-audit-findings.md) (D1–D4, Forks A/B/C, orphan audit, S/M/L/XL) · [walkthrough notes](../../notes/2026-06-17-strategy-v2-walkthrough-feedback.md) (#1–#12 + themes).
**Locked decisions honored:** D1 (curated "Recommended this month" overview + inline pointers), D2 (hybrid — recs use a lightweight client lifecycle status, work-products stay deliverables), D3 (cockpit = Act queue with Active/Sent/Approved/Throttled filters + Send/Fix/Throttle/Strike), D4 (self-managing + learning lifecycle, reusing outcome-tracking/workspace-learnings).

---

## 1. Thesis (one paragraph)

Strategy v3 is **not a rebuild — it is the v2 command-center finished, with the send-to-client spine threaded through it.** Every "new" capability Josh asked for already has a proven production mechanism living in the repo: the cannibalization send pipeline (`sendToClient()` + a registered adapter), the keyword-strategy PATCH write path (`PATCH /api/webflow/keyword-strategy/:id` is transactional, snapshots history, and regenerates recs), the declined-keyword AI-synthesis filter (`getDeclinedKeywords()` is already injected as a hard suppression into the synthesis prompt — Fork B's "removed-set" half is *already built*), the merge carry-over that preserves `dismissed` across regens (`buildMergeKey`), and the entire outcome-tracking + workspace-learnings backend (D4 is a thin wiring layer, not new infra). The lean play is therefore: **(a)** add exactly ONE new lightweight client-lifecycle status field to the recommendation entity and ONE generic admin status-mutation endpoint; **(b)** re-home the rich orphaned leaves that v2 silently reverted to passive cards; **(c)** generalize three already-proven mechanisms (`sendToClient` adapter → a `strategy_recommendation` type, the PATCH path → a `useManagedKeywordSet` hook, the declined-filter → a kept-set companion overlay); **(d)** extract ONE `<ShowMoreList>` primitive and sweep ~9 sites. Net-new code is dominated by glue, one status field, one overlay column-set, and per-type renderers — not new subsystems. We ship client-visible value in Phase 1 (re-homed cannibalization send + promote What Changed + bug), defer all net-new infra (overlay, lifecycle) behind it, and keep every phase flag-gated, staging-first, and byte-identical when `strategy-command-center` is OFF.

---

## 2. Architecture — the recommendation lifecycle + cockpit + curated overview + learning mechanics

### 2.0 The single new concept: a *client-facing lifecycle status* riding the existing rec entity (D2)

We do **not** introduce a new deliverable type for recommendations. Per D2, recommendations are not deliverables — they are a curation/narrative layer. The entire lifecycle is **one new field on the existing `Recommendation` entity plus extending the existing `RecStatus` union** — "just a flag through the intelligence engine," exactly Josh's steer.

```
Today:   RecStatus = pending | in_progress | completed | dismissed
v3 add:  RecStatus = ... | struck | throttled                    (admin curation states)
v3 add:  Recommendation.clientStatus?: ClientRecStatus            (NEW lightweight field)
         ClientRecStatus = 'system' | 'sent' | 'approved' | 'discussing' | 'declined'
         Recommendation.sentAt?: string                          (reuse the decision-model sentAt precedent)
         Recommendation.throttledUntil?: string                  (mirror suggested-briefs snooze)
```

- `struck` / `throttled` are **admin curation states** (Layer-2 curation: which raw recs are valid/promoted). They live in the existing `RecStatus` union, filtered exactly like `dismissed` already is in `ActQueue` and the server summary, and carried across regen via the existing `buildMergeKey` carry-over (the `dismissed`-preservation precedent extends verbatim).
- `clientStatus` is the **Layer-3 lifecycle** the curated client overview reads. A rec with `clientStatus='sent'` appears in "Recommended this month"; `'approved'`/`'declined'`/`'discussing'` are the client's response, fed back as an outcome signal (D4).
- **Why a field, not a deliverable:** the deliverable spine (`sendToClient()`) is for *work-products* (briefs, the cannibalization consolidation, content refreshes) where the client approves a concrete unit of work. A recommendation is a *narrative proposal* — lighter, reversible, and queryable as a status filter on the existing rec set. This is exactly D2's hybrid.

> **One subtlety to honor:** strike/throttle/send are status transitions, so they MUST go through `validateTransition('recommendation', ...)` (CLAUDE.md state-machine rule). We add the new edges to `RECOMMENDATION_TRANSITIONS` in `server/state-machines.ts`: `pending → struck`, `pending → throttled`, `throttled → pending` (auto/manual un-throttle), `struck → pending` (un-strike), and the `clientStatus` edges (`system → sent → approved|declining|declined`). Adding an edge that isn't listed is the documented bug pattern.

### 2.1 Admin cockpit — the Act queue is the curation surface (D3)

The cockpit is the **existing `ActQueue` component, extended**, not a new surface. D3 = status filters in the same Act queue.

**Admin UI:**
- **Filter chips** become two rows: the existing *category* chips (All / Content / Technical / Quick wins) plus a new *lifecycle* row — **Active / Sent / Approved / Throttled** (D3). `Active` = today's default (`status ∉ {dismissed, completed, struck, throttled}` AND `clientStatus ∉ {sent, approved}`); `Sent` = `clientStatus='sent'`; `Approved` = `clientStatus='approved'`; `Throttled` = `status='throttled'`. Pure client-side `.filter()` over the already-fetched set — zero new fetches.
- **Row actions** on `RecommendationRow`: **Fix** (exists today — navigate-to-tab), **Strike** (soft/reversible cascade), **Throttle** (defer N days), **Send to client** (the spine). Four buttons, three of them new but all thin status mutations.
- **Pagination (#3.1):** cap the rendered list at N=8 with the shared `<ShowMoreList>` primitive (§3.4). Replaces today's uncapped `visible.map(...)`.
- **Live refresh:** `ActQueue` gains a `useWorkspaceEvents(workspaceId, [RECOMMENDATIONS_UPDATED], () => invalidate)` handler. The event constant already exists in `server/ws-events.ts:135`; today the queue doesn't live-refresh. This is a 1-handler add (the data-flow rule's "both halves" — server already broadcasts, frontend half is missing).

**Server (the only genuinely net-new admin plumbing):**
- ONE generic admin endpoint: `PATCH /api/recommendations/:workspaceId/:recId/curate` taking `{ action: 'strike' | 'throttle' | 'unthrottle' | 'unstrike', throttleDays?: number }`. Today the only admin rec-mutation route is `/undismiss` — there is no generic status-mutation endpoint, confirmed by audit. This single route + a `useRecCuration` mutation hook covers Strike/Throttle/Un-throttle.
- Send reuses the spine via a per-row Send modal that calls a thin `POST /api/recommendations/:workspaceId/:recId/send` (sets `clientStatus='sent'`, `sentAt`, broadcasts). See §2.2.

### 2.2 Send-to-client — generalize the cannibalization spine (the monetization backbone)

**The mechanism already exists and is proven.** `server/domains/inbox/send-to-client.ts` runs five structural guarantees behind every send; `server/domains/inbox/deliverable-adapters/cannibalization.ts` is the registered reference adapter; `content-decay.ts` is the *smallest* adapter (74 lines) and the better template. The adapter registry barrel is append-only (one `import './<type>.js'` line per new type).

**Two send shapes, both lean:**

1. **Recommendation send (D2 — NOT a deliverable).** A per-row "Send to client" sets `clientStatus='sent'` + `sentAt` on the rec and broadcasts `RECOMMENDATIONS_UPDATED`. The client reads `clientStatus='sent'` recs into "Recommended this month." "Discuss" is a light thread on the rec (a tiny `rec_discussion` table: `recId, workspaceId, author, body, createdAt` — or, leaner still for v1, reuse the existing client-action note thread). **This is the cheapest path** and is the spine for #3 (rec send), #6b (keyword-opp send, modeled as a `recType` — see §3), #12b (competitor send, modeled as a `recType=competitive`).
2. **Work-product send (D2 — IS a deliverable).** Cannibalization consolidation (#4) and decaying-page refresh (#10) are concrete work units → they use the **existing** `sendToClient('cannibalization', …)` / `sendToClient('content_decay', …)` adapters verbatim. #10 is **S**: the `content_decay` adapter already exists; we only add the Send button to `DecayingPagesCard`. #4 is **S**: re-home `CannibalizationTriage`, whose Send already calls the cannibalization adapter.

**Admin UI for both:** a single "Send to client" button + optional inline note (the CLAUDE.md Admin Send Convention — never "Send for Review"/"Flag for Client"). The note drives Decisions-vs-Conversations routing for the deliverable shape; for the rec shape it seeds the discussion thread.

**Client UI:** §2.3.

### 2.3 Curated client overview — "Recommended this month" + inline pointers (D1, resolves Fork C)

D1 is locked: the client hub is a curated **"Recommended this month"** overview — short, finite, each rec = *why → result → one action* (Approve / Add·$ / Discuss) — with light **inline pointers** on the data screens.

**Client UI — three concrete pieces, all reusing built surfaces:**

1. **"Recommended this month" card** — a new client component `RecommendedThisMonth.tsx` mounted in `OverviewTab` (and slotted into `HealthTab.actionPlanSlot`, which already exists as a prop). It reads `GET /api/public/recommendations/:id` filtered to `clientStatus='sent'` (the existing public recs endpoint, no new fetch infra — just a server-side filter on the public projection). Each row renders the **why → result → one action** layout (§3 — the same row layout the admin uses, so build once). Actions: **Approve** (`clientStatus='sent' → 'approved'`), **Discuss** (opens the light thread), **Add ($)** for purchasable recs (reuses the existing `productType`/`productPrice` fields on `Recommendation` + the existing per-item purchase flow). Finite by construction (operator only sends a handful).
2. **Inline pointers** — a tiny `<InlinePointer count={n} onJump={…}>` chip ("💡 1 recommendation here →") rendered on the relevant client data screens (Health, Keyword map, Page detail) when a `sent` rec targets that surface. Clicking jumps to the overview, deep-linked. This is a ~30-line presentational component fed by the same `sent`-recs query, grouped by `recType`→surface. No new data.
3. **Fork C resolution (the Layer-2 flip safety):** **The client keeps seeing Layer-2 raw recs in the existing `InsightsEngine` Action Plan and the Health-tab upsell — UNCHANGED — when the flag is OFF or for tiers/workspaces without a curated set.** The flag-ON behavior is **additive, not subtractive**: "Recommended this month" is a *new curated rollup on top*, and the inline pointers are *new chips*. We do **NOT** empty `InsightsEngine` by hiding raw recs. **The only flip:** when ≥1 `clientStatus='sent'` rec exists, `InsightsEngine`'s Action Plan **prefers** the curated set as its lead block and demotes raw system recs to a collapsed "More observations" disclosure (Layer 2 stays reachable, never deleted). This honors D1 (curated hub, not a firehose) while keeping the Health upsell and Action Plan populated — the exact Fork-C hazard the audit flagged ("naively hiding raw Layer-2 empties those surfaces"). **No surface is ever emptied; the curated set is layered above the raw set.**

> **Lean rationale for Fork C:** the cheapest *and* safest resolution is additive layering, not replacement. We never touch the raw-rec read path that powers `InsightsEngine`/Health; we add a curated read path beside it and re-order. Reversible by flag. Zero risk of empty client surfaces.

### 2.4 Self-managing + learning lifecycle (D4 — thin layer on built infra)

D4: nothing persists indefinitely; the system nudges about sent recs, flags supersession, and feeds client response into the existing learning backend. **All four de-risk anchors exist:** `outcome-tracking.ts` (`OutcomeScore`, `EarlySignal`, `LearningsTrend`, EMV calibration), `workspace-learnings.ts`, `learnings-slice.ts`, the outcome crons, and `sentAt` on the decision model.

**Net-new is thin and reuses existing cron + nudge surfaces:**

1. **Staleness nudges** — extend the existing `StrategyStalenessNudges` component (already in `src/components/strategy/`) and the existing signal-recompute cron (Phase 5c). A sent rec with `clientStatus='sent'` and `sentAt` older than N days with no response mints a meta-nudge: *"Sent to client 14 days ago, not accepted — Throttle / Re-send / Drop?"* The nudge is a derived read over the rec set (no new table) surfaced in the cockpit. The three actions are the **existing** curate/send endpoints — no new mutations.
2. **Supersession** — at regen, the existing `buildMergeKey` carry-over already matches old↔new recs by stable source key. We add ONE check: if a newer rec outranks (higher `opportunity.value`) a still-`sent` rec sharing the same `affectedPages`/target, flag the old one `superseded` (a derived UI badge, not a status — "a better rec now exists"). Cheapest: compute in the nudge pass, render a badge + "Replace with the newer rec?" action.
3. **Client response as an outcome signal** — when the client Approves/Declines/ignores a sent rec, write a `TrackedAction` via the existing `outcome-tracking.ts` API (the `strategy_keyword_added` / generic action types already exist; add at most one `actionType='recommendation_responded'` if none fits). This feeds the existing `workspace-learnings` + `learnings-slice` pipeline verbatim — D4's "Layer 2 watching Layer 3" is mostly *calling functions that already exist* at the response seam in §2.2/§2.3.

> **D4 lean stance:** resist building a new "lifecycle engine." The nudges are derived reads computed in the existing cron; supersession is one comparison in the existing merge pass; the learning feedback is one `recordTrackedAction()` call at the response seam. No new subsystem.

---

## 3. The keyword / content half

### 3.1 The Strategy ↔ Hub boundary (the locked principle: curated-vs-universe)

**Principle:** Strategy = *decide / act / orient*; the Keyword Hub = *the full keyword universe + deep research*; the **curated top-10-20 working set** is the interesting middle and lives **on Strategy → the "Keywords & Rankings" tab** (#11), linking out to the Hub. This resolves #1, #2, #6, #11 as one boundary.

- **#1 Strategy Settings + Local SEO config** → fold into ONE collapsed "Strategy setup" surface (provider + page limit + business context + local market/location). The config-vs-visibility split already exists (`LocalSeoVisibilityPanel mode='strategy'` = config vs `mode='keywords'` = visibility). **Dedup:** `LocalSeoVisibilityPanel` renders in BOTH `KeywordStrategy.tsx` and `KeywordHub.tsx` — pick ONE home: **config** folds into Strategy setup; the **visibility panel** lives in the Hub only (single home). Effort **M**.
- **#2 Client Keyword Feedback** → the component already takes separable `requested`/`declined`/`approved` props. Route: **requested** keywords → the Act/curated surface (Keywords & Rankings — they're an *action*); **declined + approved log** → the Hub (reference). No rewrite. Effort **S**.
- **#12a Backlinks → Links page** → `BacklinkProfile` is self-contained (workspaceId-only). Add a Backlinks tab to the existing `links` Page route; remove from Competitive; fix the `siteId!` assertion so it loads without a connected site. Effort **M**.

### 3.2 "Keywords & Rankings" tab (#11) — relabel + compose, don't rebuild

The Rankings tab shell + `?tab=` receiver already exist. **Relabel to "Keywords & Rankings" (keep the route id — no `Page`/`ClientTab` union change, so no route-removal-checklist churn; only the tab label changes).** It composes: Ranking Distribution (exists) + the curated managed keyword set (§3.3) + Keyword Opportunities with Send (#6b) + the requested-keyword triage (#2) + a "Full universe & deep research →" link to the Hub. This fills the "almost empty" tab AND gives the curated keyword work a Strategy-side home. Effort **M** (mostly composition).

> **`?tab=` two-halves contract:** the relabel keeps the existing receiver wiring; we only verify the deep-link still initializes from `searchParams.get('tab')`. No new tab id, so no contract-test churn.

### 3.3 Managed sets — add / remove / keep, over the existing PATCH path

**The entire write path exists.** `PATCH /api/webflow/keyword-strategy/:id` accepts full `siteKeywords[]` and `topicClusters[]` (table-backed), is transactional, snapshots `strategy_history` (so "What Changed" attributes the human edit), and queues rec regen. We add **ONE hook**, `useManagedKeywordSet`, a thin wrapper over the existing `keywords.patchStrategy` API client.

- **#6 curated keyword set** — `SiteTargetKeywords` becomes actionable (add / remove / keep, search-and-add, add-from-client-recommendations). The hook PATCHes `siteKeywords[]`. **Blocked by Fork B** (overlay) — without it, the next Refresh wipes curation. See §4.
- **#9a add/remove clusters** — same hook PATCHes `topicClusters[]`. Remove-cluster is the cheap first win. Blocked by the same Fork B overlay for clusters.
- **Auto-replenish (#6 "remove one → a replacement pops in"):** pull from `opportunities`/`keywordGaps`, **skipping just-removed + client-declined keywords** — `keyword_feedback` already filters declined (`getDeclinedKeywords`), so the declined-skip is free. The just-removed skip is the kept/removed overlay (§4).
- **#9c why → how → result on clusters** — `TopicCluster` (in `shared/types/workspace.ts:119`) lacks narrative. Add **net-new** `rationale?: string` + `projectedImpact?: string` fields (the only net-new type fields in the whole keyword half — confirmed by audit; #9a/#9b also want them). Recs and gaps already carry the data (`insight`/`description`/`impactBand`, `OpportunityComponent.evidence`) — for those it's a rendering/framing change, not new fields.

### 3.4 The shared `<ShowMoreList>` primitive (the single biggest systemic lever)

Show-more is implemented twice (drifting) and *faked* by silent `.slice(0,N)` in ~9 cards (silent data loss — Josh literally can't reach the bottom of 144 recs). Extract ONE `<ShowMoreList items cap=N renderItem>` (+ a `useShowMore` hook) and sweep: ActQueue (#3.1), Content Gaps (#8b), the managed sets (#6 truncation), cluster lists, etc. Convert every silent cap into cap-with-show-more. Effort **L** (the sweep, not the primitive).

### 3.5 Brief pre-seeding (#8a) — the mapper exists; the wiring is missing

`StrategyCardContext` + `buildStrategyCardBlock()` already exist (purpose-built prompt-injection in `server/content-brief.ts:602`). The gap: the brief-generation params (`FixContext` / `StandaloneContentBriefGenerationParams`) **don't carry `strategyCardContext`**, so naive wiring silently drops it. Lean fix: add `strategyCardContext?: StrategyCardContext` to the brief-gen params, and build **ONE** mapper `gap|rec → StrategyCardContext` reused at all 3 handoff sites (ContentGaps Draft/Generate brief, Act-queue Fix, KeywordGaps Create-brief). Effort **M**, very high value (briefs are the monetization output, currently starting blank).

### 3.6 #9b research off a cluster — wiring, not infra (deferred)

The research service is fully built + array-seedable (`getKeywordIdeas`, `research_keywords`, the jobs platform). Per-cluster "Run research" → `getKeywordIdeas(cluster.keywords)` as a background job. This is **L** and net-new UX/wiring — deferred to the last phase per YAGNI (it's exploratory, lowest client-value-per-effort).

### 3.7 Dedups / orphan cleanup

- Delete `OpportunitiesList`, `DecisionQueue` (superseded by `ActQueue`, no net loss).
- Fix the **stale, actively-misleading** `index.ts` orphan comment ("re-homed by Strategy v2" when they weren't) in the same commit as the re-homing.
- Lock **ONE home per concern** to avoid double-render: cannibalization is BOTH a passive card AND an Act-queue rec type — when `CannibalizationTriage` is re-homed, remove the passive `CannibalizationAlert` from Overview. Same for the signal-fold vs `keyword_gap` recs (#7).

---

## 4. Explicit resolutions

### Fork A — Send substrate → **RESOLVED by D2 (hybrid).**
- **Recommendations** use the lightweight `clientStatus` field on the existing rec entity (NOT a deliverable, NOT `client_actions`). Strike/throttle/send = status transitions.
- **Work-products** (cannibalization, decaying-page refresh, briefs) use the **existing unified `sendToClient()` deliverable spine** with their **already-registered adapters** (`cannibalization`, `content_decay`). No new generic admin send route for work-products is needed because the adapters + `sendToClient()` already exist and are proven; we add only thin per-row Send buttons that call them.
- **Lean win:** we sidestep the Fork-A "legacy vs unified substrate" dilemma entirely — recs don't touch either substrate (they're a field), and work-products already live on the unified path. `coerceType`'s silent `seo_edit` fallback is a non-issue because we register no new deliverable type for recs.

### Fork B — Persistence-across-regeneration overlay → **RESOLVED: a kept/removed overlay that mirrors the already-built declined-keyword filter.**
- **The removed-set half already exists.** `getDeclinedKeywords()` is already injected into the AI synthesis prompt as a hard suppression (`keyword-strategy-ai-synthesis.ts:321-333`): *"DECLINED KEYWORDS … do NOT suggest them."* The synthesis already honors a removed-set.
- **The net-new is the kept-set companion + a removed-set for curated keywords/clusters that isn't a client decline.** We add an `operator_managed_set` overlay (one small table or two TEXT columns on the strategy: `keptKeywords[]`, `removedKeywords[]`, and `keptClusters[]`/`removedClusters[]`). The synthesis pass reads BOTH: **kept** items are pinned into `siteKeywords`/`topicClusters` even if the AI wouldn't re-derive them; **removed** items are suppressed exactly like declined keywords (reuse the existing injection block, generalized to "operator-removed" alongside "client-declined").
- **Resolution rule:** on PATCH from `useManagedKeywordSet`, the diff vs the prior set updates the overlay (added→kept, deleted→removed). On Refresh, the synthesis honors the overlay. This is the *same* "persist-across-regeneration" constraint already specced (unbuilt) for the cannibalization keeper-override roadmap item — one overlay model serves both.
- **Lean win:** we don't invent a new merge engine — we generalize the existing declined-keyword suppression to "operator-removed" and add a symmetric pin list. The synthesis already has the injection seam; we add ~one prompt block + one read.
- **Gate:** managed sets (#6, #9a) ship **only after** this overlay lands. "Until the overlay exists, the managed-set feature is a trust-destroying mirage" — honored by phasing (the overlay is Phase 4a, managed sets Phase 4b).

### Fork C — Layer-2 flip safety → **RESOLVED: additive layering, never subtractive (see §2.3).**
The client keeps seeing raw Layer-2 recs in `InsightsEngine`/Health (unchanged). "Recommended this month" + inline pointers are *added on top*; when ≥1 `sent` rec exists, the curated set leads and raw recs demote to a collapsed disclosure (never deleted). No surface is ever emptied. Reversible by flag.

### LostQuery fate → **RESOLVED: add a `lost_query` rec type, retire the orphaned card.**
- The `LostQueryRecoveryCard` is a **silent total loss** (orphaned AND no `lost_query` rec type — lost-query recovery vanished from v2). The lean, on-architecture fix that matches the v2 intent ("the Act queue absorbs these as rec types") is to **add `lost_query` to the `RecType` union** and mint lost-query recs into the unified set — they then flow through the Act queue, get Strike/Throttle/Send, and the why→how→result layout for free. **Retire the standalone card** (delete it from `index.ts`; it becomes a rec type, not a card). This is cheaper long-term than re-homing a bespoke card AND it restores the lost functionality through the spine everyone else uses. Effort **M** (new rec type registration: union + data interface + minter + renderer case — the 4-part contract).
- Requires the full `RecType` registration contract (audit's "new insight type" discipline applied to rec types): union + typed data + minting source + renderer.

### Other open items
- **Throttle semantics (Q2):** **auto-resurface after N days** (default 14), reusing the `suggested-briefs` snooze precedent (`status='snoozed'` + `snoozed_until` → here `status='throttled'` + `throttledUntil`). Mirror the snooze branch in merge carry-over. Operator can also manually un-throttle. Lean: copy the snooze mechanism.
- **Strike cascade (Q1):** **type-routed + soft/reversible** (see §5).
- **Auto-replenish source + rule:** pull from `opportunities` then `keywordGaps`, highest `opportunity.value` first, **skipping** operator-removed (overlay) + client-declined (`keyword_feedback`).
- **Keep the v2 flag:** **keep `strategy-command-center`** as the umbrella flag (still OFF on prod) — this is v2 *finished*, not a v3 track. New sub-phases gate under it (or thin child flags where a phase must dark-launch independently). No new top-level track.
- **#5 What Changed + #7 signal-fold reverse locked decisions:** amend the v2 plan in-commit (promote `StrategyDiff`; do the deferred Task 2.2 signal-fold; remove the standalone `IntelligenceSignals` card) so the next executor doesn't re-revert.
- **Orphan cleanup + stale comment:** §3.7.

---

## 5. Key risks & how they're handled

### Risk 1 — Strike cascade must be soft / reversible and must NOT auto-resolve to `completed`.
This is the **biggest engineering risk** (audit). The hazard: the merge block auto-resolves recs whose source vanished to `completed` (`resolveRecommendationsForChange`, `recommendations.ts:463-503`, and the merge-tail auto-resolve). If Strike removes a keyword and that removal makes the gap vanish, the struck rec could read as **"✓ done"** to the client — a lie.

**Handling (lean + safe):**
- **Strike writes a soft, reversible suppression, never a hard delete.** Type-routed (Q1): keyword/cluster/local-gap recs → cascade = write a **`keyword_feedback` declined row** (the existing soft mechanism that already suppresses regen AND the gap, and is reversible by deleting the feedback row) + set `status='struck'`. CTR/technical/decay recs → **plain `struck`** (nothing downstream to remove).
- **`struck` is a DISTINCT terminal-ish state from `completed`.** It carries across regen via `buildMergeKey` (the `dismissed`-preservation precedent), filtered out of the active queue and out of the client surfaces. Because the cascade uses `keyword_feedback` (soft) and NOT a `page_keywords` hard delete, the gap doesn't "vanish into completed" — it's suppressed-as-declined, which the synthesis already honors.
- **Explicit guard:** the cascade path must verify the struck rec is **not** swept into the `completed` auto-resolve branch. We add a guard in `resolveRecommendationsForChange` and the merge tail: `if (rec.status === 'struck') continue;` alongside the existing `if (rec.status === 'completed' || rec.status === 'dismissed') continue;`. One-line guard at each of the two auto-resolve loops (lines ~484 and ~572). Plus a unit test asserting a struck rec whose gap was removed reads as `struck`, never `completed`.
- **Reversible:** un-strike = delete the `keyword_feedback` row + `struck → pending` (a legal backward edge we add). Throttle is reversible by definition.

### Risk 2 — The overlay (Fork B).
Handled in §4. The lean de-risk is that we **don't build a new merge engine** — we generalize the *already-working* declined-keyword suppression (which the synthesis already honors at a proven seam) and add a symmetric kept-pin list. The risk surface is one prompt block + one read + the diff-to-overlay update on PATCH. We ship the overlay as its own phase (4a) BEFORE any managed-set UI (4b), with a test proving a Refresh after a curation edit preserves the kept set and suppresses the removed set.

### Risk 3 — The Layer-2 flip (Fork C).
Handled in §2.3 by additive layering. The de-risk is that we **never touch the raw-rec read path** powering `InsightsEngine`/Health — we add a curated read beside it and re-order. Byte-identical when the flag is OFF; when ON, surfaces only gain content, never lose it. A contract test asserts `InsightsEngine` renders ≥ the same recs when a curated set exists (the raw set demotes to a disclosure, never disappears).

### Risk 4 — Double-render on re-home.
Lock ONE home per concern (§3.7). Verified in diff review per re-homing PR; the stale `index.ts` comment is corrected in the same commit.

---

## 6. Phase-per-PR decomposition (flag-gated, staging-first, each shippable, byte-identical flag-OFF)

Umbrella flag: **`strategy-command-center`** (kept, still OFF on prod). Sub-phases dark-launch under it; where a phase must ship before the umbrella flips, it gets a thin child flag.

| Phase | PR scope | Effort | Ships client value? | Notes / gates |
|---|---|---|---|---|
| **P0 — Decisions (no code)** | Amend the v2 plan in-commit for #5 (promote What Changed) + #7 (signal-fold), record Fork A/B/C + LostQuery resolutions in the plan. | **S** | — | Prevents the next executor re-reverting locked decisions. |
| **P1 — Quick wins + foundations** | Re-home `CannibalizationTriage` (restores keeper+fix+resolve+**send** instantly — uses the existing cannibalization adapter); remove passive `CannibalizationAlert`; promote `StrategyDiff` to top of Reference; fix the "Computed X ago ago" bug (`IntelligenceSignals.tsx:49`) + test; extract `<ShowMoreList>`/`useShowMore` + cap ActQueue at N; add the `RECOMMENDATIONS_UPDATED` `useWorkspaceEvents` handler to ActQueue; fix the stale `index.ts` orphan comment. | **M** | **YES** (cannibalization send live; What Changed promoted) | Fastest path to value. Cannibalization send works on day one because its adapter + renderer already exist. |
| **P2 — Lifecycle field + admin curation endpoint** | Extend `RecStatus` (`struck`/`throttled`) + add `Recommendation.clientStatus`/`sentAt`/`throttledUntil`; add transitions to `state-machines.ts`; ONE generic `PATCH .../curate` endpoint + `useRecCuration` hook; carry `struck`/`throttled` across regen via `buildMergeKey`; the **strike auto-resolve guard** (Risk 1) + unit test; the snooze-mirrored throttle + auto-un-throttle in the cron. **No client UI yet.** | **L** | partial (admin Strike/Throttle live) | Foundation for the spine. Heaviest server phase but mostly status-plumbing + the critical strike guard. |
| **P3 — The send spine + why→how→result layout** | Per-row "Send to client" on `RecommendationRow` (recs → `clientStatus='sent'` + light discuss thread); decaying-page Send (#10 — reuses `content_decay` adapter); the shared why→how→result row layout (rec/gap rendering change; `TopicCluster.rationale`/`projectedImpact` net-new fields). | **M** | **YES** (recs sendable; richer rows) | The why→how→result layout is built ONCE here and reused by the client overview (P5). |
| **P4a — Fork B overlay** | The `operator_managed_set` kept/removed overlay; generalize the declined-keyword suppression to "operator-removed"; add the kept-pin block to the synthesis; PATCH-diff→overlay update; **Refresh-preserves-curation test**. | **M** | — (infra) | MUST land before P4b. The "trust-destroying mirage" gate. |
| **P4b — Managed sets + Keywords&Rankings + boundary** | `useManagedKeywordSet`; `SiteTargetKeywords`/clusters become add/remove/keep + auto-replenish (skip removed+declined); relabel Rankings → "Keywords & Rankings" + compose (#11); route #2 feedback (requested→Act, log→Hub); fold #1 Strategy setup + dedup Local SEO; #12a backlinks→Links page; **LostQuery → `lost_query` rec type** + retire card. | **L** | **YES** (curated keyword management; cleaner boundary) | Depends on P4a (overlay) + P2 (rec types for LostQuery). |
| **P5 — Client reframe (D1) + D4 learning + enrichment** | `RecommendedThisMonth` client card (reads `clientStatus='sent'`) + inline pointers; the additive Fork-C layering in `InsightsEngine`/Health; brief pre-seed (#8a — `strategyCardContext` wiring + one mapper at 3 sites); signal-fold Task 2.2 + remove standalone card (#7); keyword-opp Send (#6b, `recType`); D4 staleness nudges + supersession badge + client-response→`recordTrackedAction`. | **L** | **YES** (the curated client experience — the keystone) | The narrative-controlled client surface. Reuses the P3 why→how→result layout + the built outcome-tracking backend. |
| **P6 — Deferred / exploratory** | Competitor send (#12b, gate on DataForSEO data presence); cluster research (#9b — `getKeywordIdeas` per cluster as a job). | **L** | partial | Lowest value-per-effort; YAGNI-deferred to last. |

**Sequencing logic (fastest-to-value):** P1 ships client-visible value (cannibalization send) on day one with zero net-new infra. P2–P3 build the cheap field-based spine. The expensive net-new infra (P4a overlay) is deferred behind proven quick wins. The keystone client experience (P5) reuses everything built in P1–P4. Exploratory work (P6) is last.

---

## 7. Coverage table — all 12 feedback notes (+ orphans + bug)

| Note | What it asks | This design's resolution | Phase | Effort |
|---|---|---|---|---|
| **#1** | Strategy Settings + Local SEO consolidation; dedup Hub | Fold config into ONE "Strategy setup" surface; visibility panel = Hub only (single home) | P4b | M |
| **#2** | Client Keyword Feedback placement | requested→Act/Keywords&Rankings; declined+approved log→Hub (component already separable) | P4b | S |
| **#3** | Act queue: pagination + strike + throttle + send + "the rec layer" | `<ShowMoreList>` cap (P1); `struck`/`throttled` + `clientStatus` field + curate endpoint (P2); per-row Send (P3); D3 lifecycle filters | P1/P2/P3 | S/L/M |
| **#4** | Cannibalization keeper-pick + send + client feedback | Re-home `CannibalizationTriage` (keeper+fix+resolve+send already built via the cannibalization adapter); remove passive alert | P1 | S |
| **#5** | Promote "What Changed" | Un-retire + promote `StrategyDiff` to top of Reference; amend plan in-commit | P0/P1 | S |
| **#6** | Curated managed keyword set (add/remove/keep, auto-replenish) | `useManagedKeywordSet` over the existing PATCH path; auto-replenish skips removed+declined — **gated on Fork B overlay** | P4a→P4b | L |
| **#6b** | Keyword opportunities → send-to-client "interested?" | Model as a `recType` (keyword opportunity) → flows through the send spine | P5 | L |
| **#7** | Intelligence Signals — keep/kill/change | Do the deferred Task 2.2: fold signals into the Act queue (dedup vs `keyword_gap`), remove the standalone card | P5 | M |
| **#8a** | Pre-seed brief generator with card's real data | Wire `strategyCardContext` into brief-gen params + ONE gap/rec→context mapper at 3 handoff sites (`buildStrategyCardBlock` already exists) | P5 | M |
| **#8b** | Lists too long — show-more / compact (global) | The shared `<ShowMoreList>` primitive + sweep ~9 sites (kills silent `.slice(0,N)` losses) | P1 (primitive)/ongoing | L |
| **#9a** | Topic clusters → add/remove (managed set) | Same `useManagedKeywordSet` PATCHing `topicClusters[]` — gated on Fork B overlay | P4b | M |
| **#9b** | Research off a cluster | Per-cluster "Run research" → `getKeywordIdeas(cluster.keywords)` as a job (wiring, not infra) — deferred | P6 | L |
| **#9c** | Cluster why→how→result narrative | The shared why→how→result row layout; `TopicCluster.rationale`/`projectedImpact` net-new fields | P3 | M |
| **#10** | Decaying pages → send-to-client | Add Send button → reuses the existing `content_decay` adapter (near-zero server work) | P3 | S |
| **#11** | Rankings tab too empty → keyword surfaces | Relabel "Keywords & Rankings"; compose distribution + curated set + opps(send) + requested + Hub link | P4b | M |
| **#12a** | Backlinks → its own Links page | Move `BacklinkProfile` to the existing `links` page tab; fix `siteId!`; remove from Competitive | P4b | M |
| **#12b** | Competitor → action + send | Model as `recType=competitive`; gate on DataForSEO data presence; deferred | P6 | M |
| **#12c** | KEYSTONE — client dashboard as a 3-layer rec system | L1 data (exists) + L2 raw recs (kept, additive Fork-C) + L3 curated "Recommended this month" + inline pointers (D1); admin Strategy = curation cockpit | P5 | L |
| **BUG** | "Computed X ago ago" double-ago | 1-line fix at `IntelligenceSignals.tsx:49` + test assertion | P1 | S |
| **Orphan: LostQuery** | Silent total loss | Add `lost_query` rec type → flows through the spine; retire the orphaned card | P4b | M |
| **Orphan: CannibalizationTriage** | Built-but-orphaned | Re-home (P1) | P1 | S |
| **Orphan: RequestedKeywordTriage** | Orphaned, contradicts Decision #7 | Re-home into Keywords&Rankings (the #2 requested→Act route) | P4b | S |
| **Orphan: OpportunitiesList/DecisionQueue** | Dead, superseded by ActQueue | Delete in cleanup; fix stale `index.ts` comment | P1 | S |

**All 12 notes + the 4 orphans + the bug are covered.** The two genuinely net-new infra pieces (Fork B overlay, the lifecycle field) are isolated to P2 and P4a; everything else is re-home, generalize-a-proven-mechanism, or a thin field/glue.

---

## Appendix — the "already built, lean-on-it" inventory (grounded)

| Capability | Where it lives | How v3 reuses it |
|---|---|---|
| Unified send spine + 5 guarantees | `server/domains/inbox/send-to-client.ts` | Work-product sends (cannibalization, decay) call it verbatim |
| Cannibalization adapter (reference) | `…/deliverable-adapters/cannibalization.ts` | Re-home `CannibalizationTriage` → send works day one |
| Content-decay adapter (smallest template) | `…/deliverable-adapters/content-decay.ts` | #10 Send button reuses it |
| Adapter registry (append-only barrel) | `…/deliverable-adapters/index.ts` | No new rec adapter needed (recs are a field, D2) |
| Keyword-strategy PATCH (transactional + history + regen) | `server/routes/keyword-strategy.ts:468` | `useManagedKeywordSet` wraps it for #6/#9a |
| Declined-keyword AI suppression (Fork B "removed" half) | `keyword-strategy-ai-synthesis.ts:321` | Generalize to "operator-removed" + add kept-pins |
| `keyword_feedback` declined filter | `server/keyword-feedback.ts` | Strike cascade target (soft/reversible) + auto-replenish skip |
| Merge carry-over preserving `dismissed` | `recommendations.ts:buildMergeKey` | Carry `struck`/`throttled` identically |
| Auto-resolve-to-completed (the strike HAZARD) | `recommendations.ts:463`, merge tail | Add `struck` guard (Risk 1) |
| `RECOMMENDATIONS_UPDATED` event | `server/ws-events.ts:135` | ActQueue gains the missing `useWorkspaceEvents` handler |
| Public recs endpoint (client read) | `server/routes/recommendations.ts:128` | Filter `clientStatus='sent'` for "Recommended this month" |
| Client Action Plan / Health slot (Fork C surfaces) | `InsightsEngine.tsx`, `HealthTab.actionPlanSlot` | Additive curated layer; raw recs demote, never deleted |
| Outcome-tracking + learnings (D4) | `outcome-tracking.ts`, `workspace-learnings.ts`, `learnings-slice.ts` | Client response → `recordTrackedAction`; nudges = derived reads |
| `StrategyCardContext` + `buildStrategyCardBlock` (#8a) | `server/content-brief.ts:602`, `shared/types/content.ts:604` | Wire into brief-gen params + ONE mapper |
| Snooze precedent (throttle) | `suggested-briefs` (`status='snoozed'`) | Mirror as `throttled` + `throttledUntil` |
| ActQueue (cockpit base) | `src/components/strategy/ActQueue.tsx` | Extend with lifecycle filters + row actions + cap |
