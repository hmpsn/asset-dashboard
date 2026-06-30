# Strategy v3 — Curation Cockpit + Curated Client Delivery (Design Spec)

**Date:** 2026-06-18
**Status:** Design approved (visual + decisions locked); spec for review before `writing-plans`.
**Branch:** `strategy-v2-phase-6b-client-reframe` (v2 phases 4/5/6a/6b already on staging).
**Feature flag umbrella:** `strategy-command-center` (default OFF on prod).

**Source of truth (read these for full rationale):**
- Decision log D1–D9 + the 12 walkthrough feedback notes + the built-feature audit: `docs/superpowers/audits/2026-06-17-strategy-v2-feedback-audit-findings.md`
- Committee designs + verdict (base = Design A + 5 grafts): `docs/superpowers/designs/2026-06-17-strategy-v3-committee/{design-A-lean,design-B-platform,design-C-product,RECOMMENDATION}.md`
- UX panel audit (grouping verdict + 11 must / 10 should / 11 consider): `…/UX-RECOMMENDATIONS.md`
- Blind-spot sweep (8 resolve-now / 20 fold / 5 deferred): `…/BLINDSPOT-SWEEP.md`
- Client overview version-compare (32-row keep/reuse/retire matrix): `…/OVERVIEW-COMPARE.md`
- Locked visuals: `.superpowers/brainstorm/87873-1781755283/content/{admin-cockpit-v3,client-overview-v3}.html`

---

## 1. Goal

Turn the admin Strategy page into a **curation cockpit** — where the operator triages the system's recommendations and curates a handful to send to clients — and turn the client dashboard into a **curated, narrative-controlled delivery surface** where those recommendations land as an engaging, finite, decision-shaped "Recommended this month," grounded in the client's own data and proof.

**The three-layer model (the keystone):** L1 = raw data/signals · L2 = system-generated recommendations · L3 = the curated, operator-approved recommendations the client actually sees and acts on. The agency controls the narrative between L2 and L3.

## 2. Non-goals (explicitly out of scope for v3)

- **Client Dashboard v2** — the full visual/IA rethink of every client tab. v3 produces the *curated overview as the design north-star*; v2 rolls it out everywhere later (separate track).
- **The paid-topic monetization spine** — a generic `strategy_addon` SKU + rec→cart bridge + product map for keyword/topic rec types. Deferred to a **roadmap item** (D8). v3 renders `Add to plan` only where a product already exists.
- **Per-tier "included allowance" model** (the literal mixed free+paid screen). v3 uses tier-driven CTAs.
- Per-row recommendation table (whole-blob storage stays; Graft-2 single-writer + transaction is the in-MVP mitigation), per-workspace reporting timezone, C's admin "client view preview" panel, automated Stripe refunds. All → roadmap.

## 3. The two surfaces (held together)

Every feature below decides its admin AND client halves in the same breath (north-star #1).

| | Admin — Curation Cockpit | Client — Curated Overview |
|---|---|---|
| **Lives in** | Strategy → Overview tab (the cockpit IS the tab's hero) | Client Home/Overview |
| **Grouping** | `Fix now · N` pin → faceted Act queue (hybrid) | `Needs your decision · N` lead → finite curated set → done-state |
| **The unit** | a system recommendation, with full lifecycle controls | a *sent* recommendation, framed why → result → one action |
| **Reads** | all recs via `isActiveRec()` + lifecycle filters | only `clientStatus='sent'` recs, via a dedicated curated read |

---

## 4. Admin Curation Cockpit

Reference visual: `admin-cockpit-v3.html`.

### 4.1 Grouping (the hybrid — UX verdict D7)
- A **`Fix now · N`** group, hard-capped (~5), **pinned above** the faceted list and **visible regardless of the active category chip**. (A pure ranked-list-with-chips loses the "what's on fire" signal the moment a category is selected.)
- **Two chip axes, visually distinct:**
  - **Lifecycle** = a single-select **segmented control** (Active *N* / Sent *N* / Approved *N* / Throttled *N*) — this doubles as the "to curate" vs "in flight" mode switch (no permanent dual-zone divider).
  - **Category** = multi-select **counted toggle chips** (Content *N* · Technical *N* · Quick wins *N*).
- **Counts on every facet** so the operator triages without expanding.
- **Sort control** (value / impact / age). **"Show 139 more" is removed** — lead with a curated top slice (~8) by value, plus an explicit "See all *N*" and a "Throttle the rest for this month" loop-closer.
- Lifecycle states render as **visual strata inside one list** (opacity ramp + left-edge accent rail + nudge bands), never as separate stacked sections.

### 4.2 Row model
- One row = title + **three fixed tag slots** `[severity][value][lifecycle]` (always same order/colors) + a **single-line-clamped** why/how/result string (uniform row height for scanning) + a **left-edge lifecycle accent rail** (teal=active / emerald=sent / blue=superseded / muted=struck).
- **Actions:** `Send to client` (primary) · `Fix` (secondary) · `⋯` overflow holds `Throttle` + `Strike`.
- **Brand-law fix (M4):** the "Struck" state uses **muted-zinc**, never violet.

### 4.3 The four row actions + the 3 confirmed micro-choices
- **Send** → opens an inline **note-on-send** panel (the narrative-control lever). **↵ Enter sends immediately** (zero-friction no-note path); Esc cancels; or type a note that lands above the rec on the client overview. *(Confirmed micro-choice 1.)*
- **Fix** → marks the rec as agency-executed work (routes to the existing work spine; see §6.3 for the deliverable-vs-rec split).
- **Throttle** → a **7 / 30 / 90-day picker**; the row then shows a **visible auto-resurface clock** ("resurfaces in 23d"). Resurface is **on-read** (no cron, no race). *(Confirmed micro-choice 2.)*
- **Strike** → **arm-then-confirm on EVERY rec type** (one click arms an inline "Strike — won't be re-suggested · [confirm] [cancel]"); a struck row always keeps **[Undo]**. Cascading keyword strikes additionally carry the "removes from strategy — reversible" line. **No strike is ever a single-click commit.** *(Confirmed micro-choice 3 — the audit overruled the earlier "instant for CTR/technical" plan; even those write a permanent suppression.)*

### 4.4 Bulk operations (M7 — the structural must-do)
The operator's job is a **batch over ~144**, not one row at a time. Provide:
- Multi-select checkbox per row + shift-click range + **select-all-in-filter**.
- **`select-all-in-filter` is a predicate operation** (filter descriptor + optional exclusions) — curate-by-predicate, NOT N mounted checkboxes — so the cap-at-8 view and "apply to all 144 matching" coexist without virtualization. (Reuse the `KeywordBulkActionBar` / `BulkOperations` patterns.)
- A **sticky bulk-action bar** on selection: `Send N` / `Throttle N` / `Strike N` (bulk Strike still arm-then-confirms). All N mutations wrap in **one transaction**.

### 4.5 Self-managing loop, for the operator (S3 + D4)
- A pinned **"Needs your attention · N"** strip at the top aggregates, across all statuses: stale sent recs ("available 14d, no response"), supersessions, and **new client replies**. Nudge actions are **real buttons**, not bracketed text.
- Attention badges on the lifecycle chips (e.g. "Sent 6 · 2 stale", "Approved 3 · 1 new").
- A **"this cycle" curation meter** in the header ("4 sent · a healthy curated set") + a one-time coachmark framing *curate, don't just send* (reuse `ContentPipelineGuide`).

---

## 5. Client Curated Overview

Reference visual: `client-overview-v3.html`. **Composition verdict (D9):** narrative DNA + proof surfaces + the canonical split-CTA rec card come from the **ungated** overview; the visibility **score** + rec-card intelligence come from the **gated** version.

### 5.1 Vertical order (locked) + the ~1.5-screen budget
**Briefing recap → Layer-1 stand-card → Layer-3 curated recs → done-state.** The first decision-requiring rec must land within ~1.5 screens; every Layer-1/Briefing block hides when empty (quiet months get *shorter*, not hollow).

### 5.2 Briefing opener (KEEP from ungated)
Reuse the `WeeklyOpener + DateLine + IssueSummaryLine` masthead trio + the `dynamicSubtitle` "narrate the biggest number" prose engine. Fold the gated `StrategyRefreshSummarySection` New/Moved/Retired framing in as change-context. Warm, dated, human — never opens cold on a ring.

### 5.3 Layer-1 stand-card
- **ONE ring = the gated CTR-weighted visibility score** (`StrategyClientOrientHeader`'s `visibilityScore` + `verdict()/signed()/positionSub()` helpers), **not** the ungated composite `HealthScoreCard`. Graft `HealthScoreCard`'s expandable "what makes up this score" disclosure onto it. **Retire** both ungated rings AND the gated Snapshot `/100`. *(Requires wiring the visibility/orient metrics onto the HOME read — today they only flow on the strategy tab via `strategyData.strategyUx.orient`; surfaced on the home read in Phase 4, see §10.)*
- **Brand-law fix (M5):** the ring fills from `scoreColor()` — at 64 that is **amber**, not emerald; the `▲ +5` trend stays emerald (mid score, positive momentum).
- **Hero win proof-strip (M10), ABOVE the stats:** the `WinsSurface` dated, $-quantified win row, promoted to the hero slot, with **"we recommended → you approved → here's the result"** attribution. *(Data gap — see §6.6; if the approval-link can't be proven, soften to the two steps the data supports.)*
- **Lean single-line stats** using the briefing `PulseStrip` data model (hero metric = Clicks); retire the duplicate `StatCard` grid.
- `OutcomeSummary` as the results surface. (Note: `ROIDashboard` is NOT in the overview — it is the separate `roi` tab; do not plan to "reuse it from here.")

### 5.4 Layer-3 — the ONE curated recs layer
- Header: **"Needs your decision · N"** (one emphasized ask; demote handled counts to a muted secondary line) + a **3-segment progress bar** (approved / in-discussion / remaining) — *net-new UI*.
- When recs > ~3, **group by decision-state** ("Needs your decision" leads; "In motion" collapses to one summary row). At ≤3, flat.
- **Cap the visible set at ~5** with a "View N more"; keep the **"That's everything that needs a decision this month"** done-state as the reward when nothing is hidden.
- **Rec card** = benefit-framed title → one **why** sentence with the evidence span highlighted (carry the `#1 Priority` "why this is your top priority" contribution-bar pattern) → impact band → action. Built from the ungated `RecommendedForYou` split-CTA card (canonical) with the gated `ContentGapCard` reason copy as co-feeder.
- **CTAs are tier-driven (decision 2):** `assignedTo='team'` (Premium) → "Approve — we'll do it"; otherwise → a **priced** action where a product exists. Drive every label/state off `assignedTo` + `productType`, never a hardcoded "Included" string. Paid action = **teal outline** + a **cost band** ("$499 add-on", price OUT of the button label) + "See what's included →" + a confirm step. **`Add to plan` renders only where `rec.productType` already resolves** (briefs/schema/accessibility); otherwise the rec offers Approve/Discuss only (decision 1).
- **Discuss is the easiest action:** a one-tap inline **"Ask a question"** composer (no navigation); the in-discussion card shows the strategist's latest reply inline with a reply box — *net-new conversational rec state*.

### 5.5 The quiet/empty month (M11) — a first-class screen
When `clientStatus='sent'` recs = 0, do **not** collapse to a hollow shell. Compose: stand-card + a **featured past win still compounding** + a "Nothing needs your decision this month" reassurance + an **in-progress approved-work** block (promote `AgencyWorkFeed`'s in-progress list) + a **dated next check-in**. This is the #1 churn moment.

### 5.6 Tri-state emptiness (fold FP14)
The curated read returns one of: `never_curated` (cold-start onboarding), `curated_but_quiet` (the M11 on-track screen), `stale_or_failed` (last compute > threshold OR provider error → "we're refreshing your data," NOT "on track"). The reassuring copy is gated behind the freshness check so a broken pipeline never reads as "you're on track."

### 5.7 Inline pointers (D1 blend)
Light `?rec=` wayfinding chips on relevant data screens ("💡 1 recommendation here →") that jump into the hub. Render **only** when that screen has a live curated rec (no "0 recommendations" hollow state); aggregate to one chip per screen. Build `InlinePointer` as a ~30-line presentational chip; the receiver reads `useSearchParams.get('rec')`, matches sent recs, scrolls/highlights. **Add a `?rec=` two-halves contract test** mirroring the `?tab=` one.

---

## 6. Data model & recommendation lifecycle

### 6.1 The separate lifecycle axis (D2 + Graft 1)
Recommendations carry a **lightweight client-facing lifecycle status on a SEPARATE axis** from the existing internal `RecStatus` (`pending|in_progress|completed|dismissed`):

```
clientStatus:  system → curated → sent → (approved | declined | discussing)
lifecycle:     active | throttled(throttledUntil) | struck(struckAt, cascade)
```

`strike` / `throttle` / `send` are transitions on these axes — **never** `RecStatus` values. This is the trust-critical graft: a struck rec must never be swept to `completed` and read as "✓ done" to the client. Recs are **NOT** deliverables (work-products stay on the deliverable/Inbox spine).

### 6.2 Single-writer module + atomicity (Graft 2 + fold FP2)
All blob mutations go through one `server/recommendation-lifecycle.ts` single-writer module with a **per-RecType policy registry**. Every mutation wraps in `db.transaction()` that **re-reads the set inside the txn** (not the stale route copy), applies the single-field delta, recomputes summary, upserts. New curate/send endpoints route through the **same per-workspace mutex** the regen scheduler uses. `generateRecommendations` re-reads existing and re-applies lifecycle-axis fields in the same synchronous tick as `saveRecommendations`.

### 6.3 Overlay + carry-over through regeneration (Graft 3 + fold FP1, FP7)
- **One `applyOverlay()`** honored by every regenerated set (subsumes the cannibalization keeper-override). The merge **explicitly copies ALL lifecycle-axis fields** (`clientStatus`, `sentAt`, `throttledUntil`, `struckAt`, cascade metadata) onto every matched merged rec — for every matched oldRec **regardless of `RecStatus`**. Exit gate: a *regen-preserves-lifecycle* integration test (send a rec, regen, assert `clientStatus` still `sent`).
- **Deliverable-vs-rec de-dup:** RecTypes with a registered deliverable adapter (`content_decay`, `cannibalization`) set `sendChannel='deliverable'` in the policy registry; their Send routes to the deliverable spine and the rec reads its lifecycle from `client_actions` state (NOT an independent `clientStatus`). Guard: a rec with an active deliverable cannot also be `clientStatus='sent'`.

### 6.4 One active-set predicate (fold FP4)
A single shared `isActiveRec(rec)` (status not completed/dismissed AND lifecycle not struck/throttled-until-future AND `clientStatus` not in {sent,approved,declined}) routes **every** reader: `computeRecommendationSummary`, the operational-slice counter, the Act queue, and the public projection. The pre-plan audit enumerates every reader. Test: `summary.topRecommendationId` is never a struck/throttled/sent rec.

### 6.5 Auto-resolve exemption (resolve-now RN5)
Exempt recs with `clientStatus ∈ {sent, discussing, approved}` from the destructive auto-resolve → `completed` sweep. When such a rec's condition is genuinely fixed, transition it to a **new positive terminal state** the client reads as "we handled this" (feeds the `WinsSurface` proof), recording an outcome **only with truthful attribution** (`platform_executed` only if the agency did the work — never on a fix the client/Google did).

### 6.6 Rec ↔ outcome linkage for the proof chain (fold FP19)
When a client approves a sent rec and work spawns, write the concrete `TrackedAction` with `sourceType='recommendation'`, `sourceId=recId` (reuse the work's concrete `ActionType` per the Graft-5 resolution — no new generic ActionType). The hero proof-strip reads outcomes filtered to recommendation-sourced actions. *(If the "you approved it" step can't be linked for a given win, the proof-strip softens to "we recommended → result.")*

### 6.7 Discuss substrate (resolve-now RN7)
Net-new minimal `rec_discussion(recId, workspaceId, author, body, createdAt)` table + a `RECOMMENDATIONS_DISCUSSION_UPDATED` event + a "Discussing" lifecycle filter **in the cockpit (NOT the Inbox)**. This honors "recs ≠ deliverables" and stays decoupled. (The single `client_note` column is not a thread; reusing the client-action spine is forbidden by D2.)

### 6.8 `lost_query` (resolve-now RN8) — stays a re-homed bespoke card
Do NOT promote `lost_query` to a `RecType` for MVP (it has no `OpportunityInput.branch`, so it would be unsortable and band-less). Re-home `LostQueryRecoveryCard` as a bespoke card. Only promote it later (6-part registration behind the policy registry) if Act-queue curation of lost queries becomes a hard requirement.

---

## 7. Send / notify / respond spine

### 7.1 Client doorbell (resolve-now RN3)
Add a **`curated_recs_sent`** `EmailEventType` in the **'action' throttle bucket** (3/day, respects the 5/day global cap), fired from the rec-send endpoint, **batching one curation session** into a single "N recommendations ready for your decision" email deep-linking to the hub (`?rec=` / overview). **Do NOT reuse `recommendations_ready`** — its 14-day audit cooldown silently swallows curated sends. Without this, the "hub they return to" has no trigger.

### 7.2 Client respond path (fold FP6)
- A `CLIENT_REC_TRANSITIONS` state map in `server/state-machines.ts` covering the **client-side** transitions `sent → {approved | declined | discussing}` (the operator-side `system → curated → sent` transitions are admin-only and validated separately). Both axes are distinct from `RecStatus` transitions.
- A dedicated authenticated client route `POST /api/public/recommendations/:ws/:recId/respond {action}` that mutates **only the lifecycle axis** (never `RecStatus`, never the completion side-effects).
- A separate `GET …/curated` read returning `clientStatus='sent'` recs with its **own** query key (`queryKeys.client.curatedRecommendations`), wired into both `wsInvalidation` branches for `RECOMMENDATIONS_UPDATED`. The raw read path + shared key stay untouched (byte-identical gate holds).

### 7.3 Spend authorization (resolve-now RN6 / decision 4)
A new **`requireClientOwner`** guard threads the client role from the JWT into `res.locals`. **Spend-bearing actions** (`Add to plan`, any Approve that spawns paid work) require **`client_owner`** — and the account may have **multiple owners** (the guard checks "is an owner," not "is the sole owner"). `client_member` can Discuss and **flag intent** ("request this") for an owner to confirm. Approve-without-spend (Premium "we'll do it, included") stays open to members.

### 7.4 Public projection = allow-list (fold FP3)
Convert the public rec serialization to an explicit **allow-list** of client-safe fields (or strip every new admin-only field in the same commit it is introduced). Two tests as a P2 exit gate: the flag-OFF **byte-identical** snapshot AND a flag-ON assertion that **no admin-only key** (`throttledUntil`, `struck*`, `supersession*`, operator notes) appears in the public payload on the real public read path.

### 7.5 Activity, slices, notifications (fold FP9, FP10, FP11)
- Register `rec_sent` / `rec_struck` / `rec_throttled` / `rec_approved` in the closed `ActivityType` union in the same commit; classify `rec_sent` + `rec_approved` → `CLIENT_VISIBLE_TYPES`, `rec_struck` / `rec_throttled` → admin-only. Every new public route calls `addActivity` + broadcasts `RECOMMENDATIONS_UPDATED`; the Act-queue `useWorkspaceEvents` handler covers the new mutations.
- Add a `recResponses` field to **`ClientSignalsSlice`** (`{approved, declined, discussing, recentResponses[]}`) read inside `assembleClientSignals` (data-flow rule #6 — the outcome write alone is not enough for AdminChat/strategy to see the loop).
- Add a `recResponses` count to the admin notifications payload + a **NotificationBell** entry ("N client recommendation responses"); `RECOMMENDATIONS_UPDATED` already invalidates `admin.workspaceHome`.

---

## 8. Self-managing / learning loop (D4)

- **Throttle resurface = on-read** (MVP): `throttledUntil` filters the Act queue server-side; the rec auto-reappears as Active once the date passes — no cron, no transition, no race. (Open cockpit won't live-refresh at the exact clock edge — acceptable.)
- **Staleness nudge engine** = a net-new lightweight cron pass `runSentRecStalenessScan()` (or grafted into the outcome-crons 24h tick), **behind its own child flag**, idempotent (key on `recId + nudgeKind`), feeding a `StrategyStalenessNudges` server nudge-array prop. Supersession flags via the same pass.
- **Client response → learning:** APPROVE → the concrete `ActionType` already minted when work spawns; DECLINE/IGNORE → **advisory `workspace-learnings` only**, never a `TrackedAction`, never a new `Attribution` value. (Resolves the §2.4-vs-Graft-5 contradiction.) Reuse the existing outcome-tracking backend (`outcome-tracking.ts`, `workspace-learnings.ts`, `learnings-slice.ts`).

---

## 9. Reconcile / retire inventory (D6b + D9)

**Absorb into the ONE curated recs layer** (don't double-show): ungated `RecommendedForYou`, `ActionQueueStrip`, `InsightsDigest`, `MonthlyDigest`, `#1 Priority` card; gated `StrategyNextStepsSection`, `StrategyContentOpportunitiesSection`/`ContentGapCard`, `StrategyPageImprovementsSection`, `StrategyRefreshSummarySection`.
**Keep & feature:** Briefing masthead trio + `dynamicSubtitle`, `WinsSurface` (hero), `OutcomeSummary`, the gated visibility score + helpers, `PulseStrip` (lean stats), `AgencyWorkFeed` in-progress block (for quiet-month).
**Retire:** the ungated contextual CTA banner, `PredictionShowcaseCard`, `IntelligenceSummaryCard`, the Content-Opportunities sidebar preview, the duplicate `StatCard` grid, the legacy Recent-Work timeline; the gated interior TabBar IA, `StrategyNextStepsSection` (as a separate surface), the **`StrategySnapshotSection` `/100` headline score** (double-score clarity flaw — keep only its 4-tile counts), the gated Snapshot ring. The workbench surfaces (business priorities, keyword tables, page-keyword map, declined, feedback summary, requested-trend) **stay on the standalone strategy tab — v3 links into them, never embeds them.**

---

## 10. Phasing (phase-per-PR, flag-gated, staging-first)

> Exact task decomposition is the job of `writing-plans`. The **grounded parallelization map** (verified file ownership, 31-row collision matrix, 25 execution lanes, 13 pre-commit contracts, model assignments) is the authoritative input: **`docs/superpowers/audits/2026-06-18-strategy-v3-audit.md`**.

**Execution shape (verified):** `Stage 1 (sequenced gate): P0 → P1` · `Stage 2 (parallel tracks): Track B P2→P3 ‖ Track C P4` · `Stage 3: P5 (5A/5B block on Track C; 5C/5D/5E need only P2)`. Cross-phase parallelism is modest (6→5); the real win is **within-phase lane fan-out** (P1=4 lanes, P2=3, P4=5) → ~40–45% calendar reduction, ZERO write-collisions **iff the 13 pre-commit contracts land in Phase 1 before any Stage-2 dispatch.** Migration ledger (REUSE flag): `rec_discussion` = 138 (no flag-retirement migration). `curated_recs_sent` email is built in **Phase 2** (fired from the send endpoint, §7.1) — not Phase 4. The `rec_discussion` read contract is **pre-committed in Phase 1** so the client discuss UI (P4) builds against it while P2 builds the substrate.

- **Phase 0 — v2 cutover + legacy deletion (decision 3; flag = REUSE).** Run the still-pending v2 "delete legacy layout" phase: the flag-**OFF** baseline becomes the validated **command-center** (legacy branch deleted from the shared components `KeywordStrategy.tsx`, `client/StrategyTab.tsx`, `ClientDashboard.tsx`); the `strategy-command-center` flag is **kept** and its **ON** branch is what v3 builds into. Byte-identical-OFF re-bases to the command-center. Grep-confirm every deletion is unreferenced before removing it. **Hard prerequisite — it edits the shared components Stage 2 builds on, so it merges before P2/P4.**
- **Phase 1 — lifecycle foundation.** The separate-axis fields + `recommendation-lifecycle.ts` single-writer module (transactional) + `isActiveRec()` + carry-over + Zod/enum lockstep + allow-list public projection + `RECOMMENDATIONS_UPDATED` event/handlers. Exit gates: regen-preserves-lifecycle test, strike-never-completed test, flag-OFF byte-identical snapshot.
- **Phase 2 — cockpit curation.** Hybrid grouping + chip axes + sort + row model + the 4 actions (Send/Fix/Throttle/Strike with the 3 micro-choices) + per-row Send endpoint + `rec_discussion` substrate + auto-resolve exemption.
- **Phase 3 — bulk + self-managing.** Bulk-by-predicate + sticky bar + "Needs your attention" strip + staleness scan (child flag) + curation meter + NotificationBell + `ClientSignalsSlice` wiring.
- **Phase 4 — client curated overview.** Composition per §5 (Briefing → visibility score → hero win → curated recs → done/quiet-month) + tier-driven CTAs + client respond endpoint + `requireClientOwner` + `curated_recs_sent` email + tri-state emptiness + `?rec=` pointers. Additive, behind the flag, with a flag-OFF snapshot.
- **Phase 5 — reconcile/retire sweep + enrichment.** Absorb/retire per §9; brief pre-seed (#8a, `strategyCardContext` already wired); cluster add/remove/research (#9); keyword-opportunity "interested?" send (#6b).

Each phase: one PR, merged to `staging` and verified before the next; `<FeatureFlag>` dark-launches incomplete phases. Add any new flags to `shared/types/feature-flags.ts` before the first commit. Generate the feature guardrails (CLAUDE.md rules for reusable patterns, a `docs/rules/strategy-recommendations.md` contract doc, per-phase acceptance checklists) before Phase 1 code.

## 11. Monetization (v1 = tier-driven, no dead buttons)

- CTA label/state derive from `assignedTo` + `productType`. Premium → "we'll do it." Growth/Free → priced where a product exists, else Approve/Discuss only.
- `Add to plan` shows **only** where `mapToProduct` already resolves a SKU. The keyword/topic paid-checkout spine is **deferred** (roadmap, child-flagged).
- Snapshot the tier at send/approve so a mid-trial Approve doesn't re-price at day-14.
- **Projection guard (fold FP15):** every dollar/traffic number on a curated card comes from `impactBand` (capped, banded, methodology popover), with "estimate, not a guarantee" framing. The flag-OFF snapshot asserts no public rec field exceeds the cap.
- **Refund/cancel (fold FP16):** a paid rec whose work-order is `pending_payment`/`in_progress` is locked from operator strike (or strike requires a "this cancels a paid item" confirm); client-cancel cancels the work-order and leaves payment as a manual-refund task ("contact your strategist"). No auto Stripe refund in v1; never promise one in UI.

## 12. Deferred → roadmap (capture, don't lose)

Add roadmap entries (D8): the paid-topic monetization spine; the per-tier included-allowance model (mixed free+paid screen); per-row recommendation table; per-workspace reporting timezone; admin "client view preview" panel; automated Stripe refunds; `lost_query` as a first-class rec type; Client Dashboard v2 full rethink.

## 13. Acceptance gates (cross-phase)

- `npm run typecheck` · `npx vite build` · `npx vitest run` · `npx tsx scripts/pr-check.ts` green every phase.
- Flag-OFF **byte-identical** snapshot test on the public read; flag-ON **no-admin-key-leak** test.
- regen-preserves-lifecycle; strike-never-`completed`; concurrency (curate-during-regen survives); `isActiveRec` excludes struck/throttled/sent from summary/top; `?rec=` two-halves contract; the real **public** read path is exercised (not the admin GET).
- Multi-agent work → `scaled-code-review` before merge; every surfaced bug fixed in-PR (no "pre-existing/out-of-scope" deferral).

---

*End of design spec. Next: spec self-review → user review → pre-plan audit → `writing-plans`.*
