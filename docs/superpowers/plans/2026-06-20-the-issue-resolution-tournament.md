# The Issue — Audit Resolution Tournament (decision + locked spec)

**Date:** 2026-06-20  ·  **Method:** 3 cross-functional teams (each: client-persona advisor + admin/operator advisor + UI/UX + engineer + product → team lead) drafted competing resolution plans; a 5-dimension judge panel scored them; a head judge ranked, grafted the best ideas, and produced the single execution-ready spec below.

> This is the **final planning artifact**. Once the owner ratifies the one decision-register item (the "Act on this" pricing model), the next step is pure implementation against the acceptance criteria below.

---

All key claims verified against code: the cron auto-send at line 213 fires in the same tick (per-workspace, one-line guardable), `sendableRecIds` is a frontend derivation at `KeywordStrategy.tsx:502` (Ship-It's "server is already right" framing mis-locates it), the `discussing`-overlap red-line at `recommendations.ts:676-678` is real, and `createCartCheckoutSession` plumbing exists (Money-Surface's "no per-item checkout route" claim is overstated — the substrate is reusable). Here is the final decision.

---

# FINAL OWNER DECISION — "The Issue" Launch-Blocker Resolution

## 1. SCORECARD

| Dimension (weight) | Ship-It | Money-Surface | Less-Better |
|---|---|---|---|
| **Client Value** | 5 | **9** | 7 |
| **Revenue** | 6 | **8** | 5 |
| **Operator-Ops** | 7 | **9** | 8 |
| **Simplicity / Eng-Risk** | 7 | 6 | **9** |
| **Product / Design Craft** | 6 | **8** | 8 |
| **TOTAL (of 45)** | **31** | **40** | **37** |
| **Dimensions won** | 0 | 4 | 1 |
| **RANK** | 3rd | **1st** | 2nd |

**Money-Surface wins 4 of 5 dimensions and the aggregate (40/45). Less-Better is a strong 2nd (37) and wins the dimension that most threatens a clean launch — engineering risk.** Ship-It is honest and shippable but consistently least ambitious on the levers that turn "unfreeze the hand" into "value the surface."

---

## 2. RECOMMENDATION

**Money-Surface wins as the base plan.** It is the only plan that designs blocker #1 at the *contract boundary* — a server-computed `actOn` projection descriptor `{ mode, requiredTier }` gated exactly like `exposeClientStatus` — which structurally kills the re-derived-pricing drift hazard (the exact failure class our own predicate audit warns about) instead of patching it at the label. It also reads the buyer's psychology (confirm step + consequence line + in-card soft-yes), segments the re-sequence by vertical, and is the only plan that instruments the two real north-star metrics.

**But Money-Surface as-written carries the wrong risk budget for a "fix the blockers, protect the trust-critical core" launch** — judges flagged a ~4-5 day PR funding the most net-new surface against the public projection and billing authority. So the locked spec is **Money-Surface's architecture wrapped in Less-Better's discipline**, with three grafts:

- **From Less-Better:** the *delete-don't-manage* posture (cut `ClientRunningOrder`/`KeywordTargetsLens` at runtime), the **cold-workspace zero-empty-SectionCard screenshot as a hard acceptance artifact**, the **re-run flag-OFF byte-identical assertion after every step**, and the explicit `recommendation-lifecycle.ts` read-only fence.
- **From Ship-It:** the **POV staleness nudge** pulled into launch, and the **"Discuss this" verb** for non-monetizable moves (so they don't borrow the request affordance).
- **Correction applied to the base plan** (verified in code): `createCartCheckoutSession` + `pending_payment` plumbing in `server/stripe.ts` already exists and is reusable — so the Growth à-la-carte charge is a *fast-follow*, but a **cheaper** one than Money-Surface estimated, and the launch ships the structure that makes wiring it trivial.

---

## 3. THE LOCKED RESOLUTION SPEC

**One launch PR, single phase, ~3.5 days.** Everything inside `strategy-the-issue` branches; flag-OFF byte-identical re-asserted after every step. `recommendation-lifecycle.ts` is **read-only**.

### Blocker 1 — "Act on this" has no price/scope/tier
**Change (server-authoritative, no Stripe charge at launch):**
1. **Relabel** content-plan CTA "Act on this" → **"Request this"**; non-monetizable moves → **"Discuss this"** (graft from Ship-It). Success toast → *"Added to your plan — your strategist will scope and confirm before any work or charge."*
2. **Server tier-gate** in the act-on route (`server/routes/recommendations.ts`, ~L459, **before** the L6 `db.transaction()`, no Stripe I/O in the txn): `computeEffectiveTier(getWorkspace(workspaceId))` → Free + `monetizable` rec → `403 { error, requiredTier: 'growth' }`, no request created. The route is the gate; the hidden button is not.
3. **Server-computed projection descriptor** in `stripEmvFromPublicRecs`: flag-gated `actOn: { mode: 'included'|'priced'|'locked', requiredTier?: 'growth' }`, computed once from `computeEffectiveTier` + rec type. Free → `locked` (client renders `<TierGate>`, reusing the `CompetitorGaps` pattern); Growth/Premium → `included` for v1. Gated exactly like `exposeClientStatus` so it is **absent when the flag is off**.
4. **Single `ConfirmDialog`** before commit on all paid paths, naming the rec headline + the consequence line *"Your strategist will confirm scope before any work begins. Nothing is billed at this click."* (graft Less-Better's exact unfreeze copy).

**Acceptance criteria.**
- [ ] Free-tier `POST .../act-on` on a `monetizable` rec returns `403`; `list_content_requests` count unchanged; card renders `<TierGate>`, not an active button.
- [ ] Growth/Premium: confirm dialog (rec headline + consequence line) precedes any write; cancel writes nothing; confirm creates one lineage-stamped request (`dedupe:false` preserved), `clientStatus → approved`.
- [ ] No surface renders the string "Act on this"; non-monetizable moves read "Discuss this".
- [ ] **Flag-OFF: `actOn` descriptor absent from the public projection** (byte-identical diff assertion — the named #1 scrutiny target).
- [ ] L6 atomicity intact: a throw still rolls back greenlight + request together (existing test green).
- [ ] Integration test exercises `GET /api/public/workspace/:id`, not the admin GET; 44px CTA touch target.

### Blocker 2 — Client hierarchy inverted
**Change.** Pure JSX reorder in `TheIssueClientPage.tsx` (each section already `ErrorBoundary`-wrapped, hooks unconditional). Canonical order:
1. Your-turn strip → 2. `NarratedStatusHeadline` + health chip + **"curated by your strategist" byline** → 3. **`IssueContentPlanSection` (hero)** → 4. `IssueAlsoOnPlanSection` (local-visibility/technical leads here for local clients) → 5. **one compressed proof band** (CompactStatBar + ROI merged, collapsed, "See full report →") → 6. Wins → 7. Competitor snapshot → 8. `IssueLoopFooter`.

**Acceptance criteria.**
- [ ] At 375px, the content plan is the first full-width scrollable section after the status headline; ROI/numbers/wins all render below the first content card.
- [ ] ROI methodology disclosure (directional, not booked revenue) renders (moved, not dropped); the stray month-over-month stat is removed for evergreen consistency.
- [ ] Proof is one band, not two; reveal requires a user action.
- [ ] Diff is JSX-children reorder only; no hook/data-fetch change.

### Blocker 3 — Trust-ladder auto-send in the doorbell tick
**Change. Dark-launch.** Add OFF-by-default child flag `strategy-trust-ladder-autosend` to `FEATURE_FLAG_CATALOG`, grouped under `strategy-the-issue`. Guard the `runAutoSendForWorkspace(...)` call at `strategy-issue-cron.ts:213` with `if (!isFeatureEnabled('strategy-trust-ladder-autosend', workspaceId)) return;`. Doorbell + `STRATEGY_ISSUE_PUSHED` push untouched. `TrustLadderPanel` returns `null` when the flag is off. **Keep** the store, route, migration 144, `markRecommendationAutoSent`, `creditArchetypeCycleOnSend` inert (reverting a committed migration is riskier than a dormant table). Replace the swallowed-error semantics with a structured `log.warn` count assertion on any *enabled* batch (graft from Money-Surface — the only allowed cron behavior edit).

**Acceptance criteria.**
- [ ] With the flag OFF (default): cron rings the doorbell + broadcasts but `runAutoSendForWorkspace` is **not invoked** (spy assertion = zero auto-sends); `grep`-verified unreachable on the default path.
- [ ] No client receives a recommendation without a manual operator send.
- [ ] `npm run verify:feature-flags` passes; new child flag grouped, not orphaned.
- [ ] `TrustLadderPanel` does not render on a cold workspace.

### Blocker 4 — Admin cockpit 12-13 section wall
**Change.** Collapse `issueOverviewEl` (`KeywordStrategy.tsx` ~542-616) to the **5-beat spine**: `IssueHeader (config + Send)` → `StanceBar` → `DraftedPovEditor` → `BackingMovesQueue` → Send. Everything else into **one** "Supporting detail" disclosure collapsed by default: `ContentWorkOrderLens`, OrientZone, `StrategyDiff`, `CannibalizationTriage`, competitor deep-link.
- **`KeywordTargetsLens`:** dropped from the surface → single "Curated keyword targets →" deep-link row (not a SectionCard).
- **`ClientRunningOrder`:** **cut from v1** (the opportunity-value sort IS the running order); leave migration 145 + store inert. This also deletes its drifting inline `isCuratedForClient` copy.
- **Empty → `null`:** `ContentWorkOrderLens`, `TrustLadderPanel`, any remaining projection get an early `if (!items.length) return null;` (mirror `IssueAlsoOnPlanSection`).
- **Color unify:** export one `ARCHETYPE_ACCENT` from `recArchetypeMap.ts`; import on `StanceBar` + `BackingMovesQueue` (fixes the `authority_bet` teal/blue swap).

**Acceptance criteria.**
- [ ] **HARD ARTIFACT:** a cold-workspace screenshot at 1280px showing exactly the 5 spine sections above the fold and **zero empty SectionCard chrome** (no "curate moves above" placeholder). This screenshot is the reviewable gate.
- [ ] `ContentWorkOrderLens`/`TrustLadderPanel` return `null` when empty (component assertion).
- [ ] StanceBar archetype accent === BackingMovesQueue group-dot color for every archetype (single shared constant; test).
- [ ] `KeywordTargetsLens` + `ClientRunningOrder` render nothing on the default path; no `sort_order` reorder path reachable.
- [ ] StanceBar segments carry `aria-label="[N] [archetype] moves"`.

### Blocker 5 — Three competing send surfaces
**Change.** One canonical model (UI-layer only; `sendRecommendation`/`sendableRecIds` derivation byte-unchanged).
- Per-row + bulk-bar → **"Stage for issue"** / **"Stage N"** (staging only, no client write). Header **"Send issue"** = the one commit.
- **Live counter** near the queue header AND on the Send button: **"N staged · M already with client"** — N from `sendableRecIds.length`, M from the **shared `isCuratedForClient`** (consolidation below), so numerator/denominator share a source per the rate-display rule.
- **Disabled Send** carries an inline reason text node + `aria-disabled` + `aria-describedby` (not a tooltip): `stagedCount===0` → "Stage moves below to send." / all-curated → "Everything curated is already with your client."

**Acceptance criteria.**
- [ ] Only the header "Send issue" commits to the client; "send" language appears in exactly one place.
- [ ] Counter visible before and after a send, updates live; N and M derive from the one shared predicate module.
- [ ] Disabled Send always renders a visible inline reason + `aria-disabled`.
- [ ] `sendRecommendation` and `sendableRecIds` logic byte-unchanged.

### Blocker 6 — Fabricated blurred competitor rows
**Change.** Delete the invented rows at `CompetitorGapsSection.tsx:78-79`. If real competitor data exists → one **real** unblurred row ("Your top gap: [domain]"); else a generic placeholder ("Your strategist is mapping your competitive landscape") — no blur, no invented keyword strings, at any tier. The premium TierGate-the-payoff pattern may stay; only the fabricated teaser content is removed.

**Acceptance criteria.**
- [ ] `grep -rn "emergency service near me\|same-day repair" src/` returns zero.
- [ ] Either one real row OR one generic placeholder renders — never blurred fake rows; no `blur`-styled fabricated rows remain.

---

### Launch-included fast-follows (in the launch PR)
- **Predicate consolidation** → extract `isCuratedForClient` + `isActiveRec` to `shared/recommendation-predicates.ts` (verified: pure functions of `Recommendation`, no server deps). **Do this FIRST** so Blocker 5's counter shares one source. **Red-line: the `discussing`-overlap comment (`recommendations.ts:676-678`) MUST travel with the extraction.** Acceptance: `grep` returns a single `isCuratedForClient` source.
- **Content floor → 2 states** — drop the 4 "evaluating" filler cards + cross-tier dedup; show curated cards OR one honest line. (The sales-demo landing surface.)
- **In-card "Let's talk" soft-yes** — second per-card affordance opening the advisor pre-seeded with rec title + `targetKeyword` (`onOpenChat` already wired). Stacks vertically under "Request this" on mobile for 44px targets.
- **POV staleness nudge** (graft Ship-It) — when struck/edited recs diverge from POV `generatedAt`, show "Point of view may be out of date — regenerate?" under `DraftedPovEditor`. Reads `generatedAt`, never resets on it.
- **"Curated by your strategist" byline** — one sub-line on the status headline.
- **A11y (launch-blocking, not fast-follow):** StanceBar per-segment `aria-label`; 44px CTA touch targets; disabled-Send `aria-describedby`.

---

## EXPLICIT OUT-OF-SCOPE (will not appear in the launch PR)
- Growth **à-la-carte Stripe charge** for act-on (fast-follow #2 — cheaper than estimated; `createCartCheckoutSession`/`pending_payment` substrate already exists).
- Per-item checkout UI / quota-meter UI on the Issue surface beyond the Premium `included` descriptor.
- Portfolio/triage queue, in-cockpit greenlight inbox, POV-confidence badge (fast-follow #1).
- `ClientRunningOrder` reorder / drag / `sort_order` persistence (cut from v1; substrate dormant).
- Full POV honesty reflow on situation/wins/flags prose (multi-day NLP; staleness nudge is the interim).
- Outcome/export one-pager, "what moved" signal, GA4-conversion hero, funnel bridge.
- Period-over-period on the **client dashboard** (evergreen stays; only a future export view may be temporal).
- External client-facing name / strategist byline naming (owner/marketing).
- Trust-ladder decoupled-tick / veto-hold re-architecture (dark-launched, not rebuilt).
- Any change to `recommendation-lifecycle.ts` writers, `creditArchetypeCycleOnSend`, `markRecommendationAutoSent`, `sendRecommendation`, or `sendableRecIds` derivation.

---

## SEQUENCING — launch PR (one phase, ~3.5 days, de-risking order)
1. **Predicate consolidation** (keep `discussing` comment) + **cut `ClientRunningOrder`** — kills worst duplication first. ~2-3 hrs.
2. **Blocker 3** dark-launch (sub-flag + 1-line cron guard) — removes the dangerous path. ~1 hr.
3. **Blocker 6** competitor rows — early high-trust win. ~1-2 hrs.
4. **Blocker 2** client re-sequence + byline + content-floor-2-states + in-card soft-yes. ~half day.
5. **Blocker 5** canonical send + shared-source counter + disabled reason + color unify. ~half day.
6. **Blocker 4** admin spine + empty→null + drop `KeywordTargetsLens` + cold-workspace screenshot artifact. ~half-to-1 day.
7. **POV staleness nudge** + a11y. ~half day.
8. **Blocker 1** relabel + ConfirmDialog + server tier-gate + projection descriptor — **last** (only item touching public projection + billing authority; scrutinize the flag-OFF diff above all). ~1 day.

**Fast-follow order:** FF1 portfolio/`POV_UNCHANGED` triage + greenlight inbox + POV-confidence badge (before onboarding past ~5-8 accounts) → FF2 Growth à-la-carte Stripe charge (reuse `createCartCheckoutSession`) → FF3 outcome/export one-pager + "what moved" signal → FF4 external name → FF5 full POV reflow.

---

## STRONG CORE / FLAG-OFF / TRUST-CRITICAL PRESERVATION
| Invariant | How preserved |
|---|---|
| **Cut→POV-sentence live reflow** | `DraftedPovEditor` stays in the spine, never behind disclosure, never moved; spine reorder only repositions siblings. Component test in the gate set. |
| **Lost-keystroke guard** (reset keyed on `generatedAt` only) | Untouched. Staleness nudge *reads* `generatedAt` to compare, never resets on it. No refactor may re-key on `version`/`editedAt`. |
| **Archetype shortlist (cap 5 + show-more)** | Preserved in StanceBar; only its accent constant unified. |
| **Per-section ErrorBoundary** | Client reorder moves whole `<ErrorBoundary>` wrappers; isolation intact. |
| **Regen carry-over + no-baking** | All fixes are presentation-layer; `actOn` descriptor computed at the projection boundary, never persisted. `recommendation-lifecycle.ts` read-only. Regen-carry-over test (autoSent/clientStatus survive concurrent regen) stays in the gate set. |
| **L6 atomicity** | Tier gate placed **before** the txn (early reject); no Stripe I/O inside; `dedupe:false` untouched. |
| **`discussing` overlap** | Shared-module extraction is a verbatim move; the "NOT the complement of isActiveRec" comment travels with it. |
| **Flag-OFF byte-identical** | Every change additive under `strategy-the-issue`; `actOn` gated like `exposeClientStatus`; auto-send gets a second OFF flag. **Re-assert byte-identical after every step**, with the #1 projection change as the named scrutiny target. |

---

## 4. DECISION REGISTER (zero TBDs)

| # | Decision | Resolution |
|---|---|---|
| **D1 — Act-on pricing/tier model** | **OWNER — ratify in one line.** | **RECOMMENDED: Option A.** Tier-aware "Request this" — Free gated server-side (403 + `<TierGate>`), Growth/Premium = `included` request with confirm + consequence line; **launch ships the structure (gate + projection descriptor + Premium `included` mode); the Growth à-la-carte charge is fast-follow #2** (reusing existing `createCartCheckoutSession`). **Alt B:** retainer-only request, no tier gate — *rejected, leaves the free-SKU leak open.* **Alt C:** wire the Stripe charge now — *defer; substrate exists but it re-opens monetization UX the spec deferred.* **Engineer default if owner is silent by launch:** ship A's relabel + Free-gate + descriptor (safe under both A and C; only the Growth charge differs). |
| D2 — Relabel | **DECIDED.** "Act on this" → "Request this" (monetizable) / "Discuss this" (non-monetizable), all tiers. Not owner-gated. |
| D3 — Confirm step | **DECIDED.** Single `ConfirmDialog` with consequence line before any paid-tier write. |
| D4 — Stray month-over-month stat | **DECIDED.** Removed for evergreen consistency (client dashboard stays dateless; period-over-period lives only in the future export one-pager). |
| D5 — Trust ladder | **DECIDED.** Dark-launch behind `strategy-trust-ladder-autosend` (OFF). Subsystem inert, not deleted; migration 144 not reverted. |
| D6 — `ClientRunningOrder` | **DECIDED.** Cut from v1; substrate (migration 145, store) left dormant for clean re-enable on a concrete operator request. |
| D7 — `KeywordTargetsLens` | **DECIDED.** Dropped from cockpit → deep-link row into Keyword Hub. |
| D8 — Predicate consolidation target | **DECIDED.** `shared/recommendation-predicates.ts`; `discussing`-overlap comment is a red-line that must travel. |
| D9 — Premium quota source | **DECIDED (if A).** `included` mode reads the existing content-subscription/quota record; the request stamps the resolved billing disposition server-side. No manual reconcile. |
| D10 — In-card soft-yes | **DECIDED.** In launch PR (warm-lead valve; `onOpenChat` already wired). |
| D11 — External client-facing name | **OWNER (marketing).** Does not block launch; lock before any external demo/sale. |
| D12 — Competitor cold-state | **DECIDED.** One real row if data exists, else generic placeholder. No fabricated/blurred rows ever. |

---

## 5. DEFINITION OF DONE

**Gates (all must pass):**
- [ ] `npm run typecheck` — zero errors (`tsc -b`)
- [ ] `npx vite build` — succeeds
- [ ] `npx vitest run` — full suite green
- [ ] `npx tsx scripts/pr-check.ts` — zero errors
- [ ] `npm run verify:feature-flags` — `strategy-trust-ladder-autosend` grouped, no orphans
- [ ] `npm run verify:coverage-ratchet` — no regression
- [ ] **Flag-OFF byte-identical** — re-asserted after every step; `actOn` descriptor absent when flag off (named #1 target)
- [ ] **Cold-workspace screenshot artifact** — 5 spine sections, zero empty SectionCards
- [ ] **Cut→POV live-reflow** — manual + component test green
- [ ] **Regen carry-over** — autoSent/clientStatus survive concurrent regen (test)
- [ ] `runAutoSendForWorkspace()` grep-verified unreachable on the default path
- [ ] `grep "emergency service near me\|same-day repair" src/` returns zero
- [ ] "Request this"/"Discuss this" verified at all three tiers; one `isCuratedForClient` source
- [ ] Single shared predicate; counter N/M share a source
- [ ] Docs updated: `FEATURE_AUDIT.md`, `data/roadmap.json` (+ `sort-roadmap.ts`), `BRAND_DESIGN_LANGUAGE.md` (if tokens changed), spec decision register
- [ ] **D1 ratified by owner** (default A if silent)
- [ ] Parallel agents used → `scaled-code-review`; single-domain → `superpowers:requesting-code-review`; all surfaced bugs fixed in-PR

**Two success metrics (instrument before launch, on existing events):**
1. **Time-to-prepared** — median operator minutes from cron doorbell event → "Send issue" commit. **Target ≤15 min.**
2. **Client greenlight rate** — % of sent recs that receive an act-on within 14 days. **Target ≥40% @ 14d.**

---

## 6. WHY THIS IS THE FINAL PLANNING STEP

Every blocker now has a code-anchored fix with a binary acceptance test, the one genuine business decision (act-on pricing) is reduced to a one-line owner ratification with a safe engineer-default that ships regardless, and every other open question is decided in the register with zero TBDs. The plan takes Money-Surface's contract-boundary architecture (which structurally prevents the pricing-drift failure class) and constrains it with Less-Better's delete-don't-manage discipline and per-step byte-identical re-assertion — so the launch surface area shrinks rather than grows, the trust-critical reflow/no-baking core is fenced read-only, and the dangerous cron path is neutralized by a one-line flag guard. The next step is pure implementation in the stated de-risking order: there is nothing left to litigate, only to build and verify against the gates.

---

## Appendix A — Judge scorecard (raw)

### Judge: CLIENT VALUE — does the plan make the client genuinely value the surface, click "Act on this" without freezing, return to it, and defend the spend across all three customer segments (warm-lead/relationship, local SMB, B2B/CMO budget-defense)?

Dimension winner: **money**

- **money** — score `9/10`. Strongest on the actual client-value dimension. It is the only plan that treats the buyer's PSYCHOLOGY as the design target, not just the JSX: (1) it adds a CONFIRM STEP + consequence subline on the act-on card — directly killing the freeze ('am I being charged?') rather than only relabeling; (2) it pulls the in-card 'Let's talk' soft-yes INTO launch as the warm-lead capture, the single highest client-value graft for the relationship segment, where ship/craft defer it; (3) it segments the re-sequence — local clients let local-visibility lead via Also-on-plan instead of a forced content-first wall, the only plan that reads the buyer's vertical; (4) the 'curated by your strategist' byline makes the human moat visible at the point of purchase. On the B2B/CMO budget-defense segment it is the most honest: it explicitly carves the future export one-pager as the ONLY place period-over-period is allowed, keeping the client dash evergreen — squarely naming the customer-signal tension (evergreen kills budget defense) and routing it correctly. Server-computed actOn descriptor ({included|priced|locked}) means the client never sees a pricing contradiction. Loses a point only because at-launch it ships request-only for Growth too (no charge), so the upsell 'moment' it touts is structural, not live — the client sees 'request' but the differentiated value-capture lands a fast-follow later.
  - *Best idea to graft:* The confirm-step + consequence subline ('nothing is billed at this click — your strategist confirms scope first') PAIRED with the in-card 'Let's talk' soft-yes — together they convert the freeze into either a low-commitment request OR a warm conversation, covering both the decisive and the hesitant buyer in one card. This is the single most client-value-additive idea in the tournament and should be grafted into whichever plan wins.
  - *Biggest risk:* ~4-5 day launch PR is the largest of the three and the most likely to slip; if the timeline compresses, the client-value extras (soft-yes, byline, segmented re-sequence) are the first things cut — and those extras ARE its client-value edge, so a rushed Money-Surface degrades toward Ship-It while costing more.
- **craft** — score `7/10`. Second on client value. It correctly identifies that the buyer's freeze is a CLARITY problem and answers it with an inline confirm naming the rec headline + the explicit 'Nothing is billed at this click' reassurance — the single best anti-freeze copy in any plan, and it (like money) pulls the in-card 'Let's talk' soft-yes and the strategist byline INTO launch, so the warm-lead and relationship segments are served. The content-floor → 2-state cut (dropping the 'we're evaluating' filler — verified real at IssueContentPlanSection.tsx:150-160) directly raises perceived value on the sales-demo surface, the exact state a prospect lands on. Where it trails Money-Surface on THIS dimension: the re-sequence is a single global content-first order with no segment awareness (the local SMB whose value is local-visibility still gets content forced first), and on the B2B/CMO budget-defense segment it is the weakest — it names the funnel/export one-pager as 'the one genuine gap we accept at launch' and defers it furthest, with the least articulated bridge to how that buyer defends spend in the interim. Its philosophy (delete to four) is right for operator clutter but is neutral-to-slightly-negative for the budget-defense client who actually wanted MORE proof structure, not less.
  - *Best idea to graft:* The explicit 'Nothing is billed at this click' reassurance baked into the inline confirm copy — the most surgically precise unfreeze sentence in the tournament. It names the exact fear and disarms it in one line, costing nothing and requiring no pricing decision.
  - *Biggest risk:* Its 'less is more' instinct, applied to the client surface, risks under-serving the B2B/CMO budget-defense segment that needed richer proof/export structure — collapsing proof to a single hidden-behind-a-click band could read as the agency having LESS to show, the opposite of budget defense, for the one segment all three plans serve weakest.
- **ship** — score `5/10`. Resolves the blockers competently and unfreezes the hand at the FLOOR level — the 'Request this' relabel + no-charge subtitle ('Sent to your strategist — no charge yet') does remove the universal disqualifier, and the TierGate closes the free-SKU leak. But on the CLIENT-VALUE dimension specifically it is the thinnest of the three. It DEFERS the in-card 'Let's talk' soft-yes (explicitly 'borderline-defer', gated on schedule slack) — so the warm-lead/relationship segment, the highest-value buyer for a high-end agency, gets no in-card conversation path at launch beyond a scroll to the footer. Its re-sequence is correct but un-segmented (no local-vertical awareness). It does NOT pull the strategist byline into launch (leaves the human-curation moat invisible at point of purchase — the craft the customer is actually paying for). And on B2B/CMO budget-defense it is the most hand-wavy: 'lean on email/notification + the loop tally' is asserted, not designed. The fixes are honest and shippable, but the plan optimizes for FASTEST-PROMOTABLE (its own stated bet), and the trades it sacrifices — soft-yes, byline, segment-awareness — are precisely the client-value levers. A client will stop freezing, but this plan does the least to make them actively VALUE the surface or return to it.
  - *Best idea to graft:* The POV staleness nudge pulled into launch ('Point of view may be out of date — regenerate?') — a cheap, honest interim guard that protects client TRUST in the proof when an operator edits/cuts moves without regenerating; the partial-honesty gap is a genuine client-value risk and this is the cheapest credible mitigation, worth grafting into any winner.
  - *Biggest risk:* By deferring the soft-yes and byline and leaning on un-designed email/loop-tally for the return reason, it ships a surface that successfully removes the freeze but gives the client little positive reason to come back or to defend the spend — it clears the disqualifier without building the qualifier, so retention/expansion (the actual money outcome) is left to chance.

### Judge: REVENUE — does the plan turn Act-on-this into a real monetization loop (tier-gated, priced, no leak), drive retention/expansion, and avoid giving away the highest-margin SKU?

Dimension winner: **money**

- **money** — score `8/10`. Strongest revenue plan: the only one that designs the FULL monetization loop rather than just patching the leak. Builds the Premium included-quota counter (substrate confirmed — content_subscriptions has posts_per_month + incrementDeliveredPosts + resetPeriod), the Free-tier gate (server-authoritative via computeEffectiveTier at workspaces.ts:59, verified), a server-computed actOn projection descriptor so the client never re-derives pricing, AND names the Growth a-la-carte charge explicitly. It frames the upsell moment ('Uses 1 of 4 included briefs'), surfaces the human-curation moat at point of purchase (byline), keeps the warm-lead conversation in-card (soft-yes), and is the ONLY plan that instruments the two true revenue north-stars (greenlight rate ≥40%@14d, time-to-prepared) and identifies the real expansion ceiling (operator throughput / portfolio queue). Docked from 9 because it inherits the shared error all three plans make — it calls per-item Stripe 'multi-day, net-new, no per-item checkout route exists today.' That is wrong: createCartCheckoutSession (server/stripe.ts:382) ALREADY creates a content_request in pending_payment, assembles server-authoritative Stripe line_items with the Premium 10% content discount keyed off computeEffectiveTier, and fulfills on webhook. Act-on's highest-margin SKU could reuse this far more cheaply than the plan assumes, so deferring the Growth charge concedes more near-term margin than necessary.
  - *Best idea to graft:* The server-computed actOn projection descriptor { mode: 'included'|'priced'|'locked', requiredTier } emitted once at the stripEmvFromPublicRecs boundary so the client NEVER re-derives pricing — this kills the exact drift hazard that bit the duplicated predicate and is the single most important structural pattern for any priced surface; graft it even into the winning plan.
  - *Biggest risk:* Shipping the tier 'structure' (gate + descriptor + Premium counter) while deferring the Growth a-la-carte CHARGE means Growth clients greenlight a free 'your strategist will confirm scope' request for a full fast-follow cycle — the highest-margin content SKU still leaks for Growth at launch. Given cart-checkout already exists and is reusable, that revenue gap is self-inflicted and larger than the plan acknowledges.
- **ship** — score `6/10`. Revenue-SAFE but not revenue-GENERATING. It correctly closes the leak: relabel + TierGate on Free + a server-side 403 in the act-on route (the verified-missing gate — recommendations.ts has zero tier/monetizable/403 logic today, so this is the real fix), reading the monetizable flag that genuinely exists in REC_POLICY_REGISTRY (content/content_refresh/schema/accessibility = true, confirmed). That stops Free from minting the highest-margin SKU free and unfreezes the buyer. But Option A is request-only for ALL paid tiers — Growth and Premium get the same un-billed request — so it captures zero incremental margin, adds no quota meter, no upsell moment, no instrumentation, and explicitly recommends DEFERRING Option C (the only margin-capturing path) to fast-follow. On the money axis it is the floor that prevents bleeding, not a loop that earns. The plan even admits sacrificing 'margin capture today.' Correct minimum, low ambition.
  - *Best idea to graft:* The crisp 'the hidden button is not the gate — the route is' framing plus the explicit acceptance criterion that POST .../act-on returns 403 for Free-tier monetizable recs. Revenue protection must live server-side at the route, never in a client-hidden button; this is the non-negotiable security-of-revenue invariant every plan should adopt verbatim.
  - *Biggest risk:* Option A leaves Growth/Premium greenlighting the $250–800-class content SKU as a free retainer-bundled request with no quota cap and no per-item charge — and the plan defers the only fix (Option C) indefinitely with no committed date. The margin leak is closed only for Free; for paid tiers the most expensive deliverable stays uncapped, which is the larger dollar exposure.
- **craft** — score `5/10`. Most revenue-CONSERVATIVE by explicit design — it treats 'touches no Stripe code' as a virtue and ships Option A where no money moves at click. It does close the leak honestly (card-CTA tier gate reading the real monetizable flag, Free → upsell teaser, never a created request) and unfreezes the hand with the inline 'nothing is billed at this click' confirm, which is good trust hygiene. But on the money dimension it is the weakest: it adds no Premium quota counter, no priced path, no upsell instrumentation, no greenlight-rate metric framing, and frames Option C purely as an optional owner-gated fast-follow ('A vs C-now'). Its whole thesis — 'a flawless manual money surface beats a half-automated one' — optimizes craft and trust over capture. It even concedes the funded-segment funnel/budget-defense layer as 'the one genuine gap we accept,' which is precisely the retention/expansion lever the revenue dimension cares most about. Deleting clutter is right for the product but neutral-to-negative for monetization throughput.
  - *Best idea to graft:* Routing the request into the greenlight queue 'regardless of which option the owner picks' — decoupling the operational fulfillment path from the still-unresolved pricing decision so launch is never blocked on the owner's billing choice. That sequencing keeps the revenue loop shippable while the highest-leverage pricing question stays open.
  - *Biggest risk:* By proudly shipping zero billing mechanics and deferring all margin capture to an optional owner-gated fast-follow, it is the plan most likely to leave the highest-margin SKU monetized-by-relabel-only indefinitely. 'No Stripe code' reads as discipline but, given cart-checkout already exists, it is leaving the most money on the table of the three — and the evergreen-no-dates stance it preserves also kills the period-over-period budget-defense that drives renewal/expansion.

### Judge: operator-ops

Dimension winner: **money**

- **money** — score `9/10`. Strongest on the OPS dimension by a clear margin. Same 5-beat spine + empty→null collapse as the others, but it is the ONLY plan that treats operator throughput across a book as a first-class design problem rather than a deferral. It names the dropped-greenlight failure mode and answers it with an in-cockpit greenlight inbox, adds a POV-confidence/data-thinness badge (rich/thin/generic) so the operator rubber-stamps rich POVs and spends the 15 minutes only where the draft is sparse — the single highest-leverage cold-curate accelerator across many accounts — and pairs both with the POV_UNCHANGED portfolio/triage queue as an explicit, sequenced fast-follow #1 gated on ~5-8 accounts. On safety it is the most rigorous: dark-launches auto-send behind an OFF child flag (verified correct — line 213 is per-workspace gated so the one-line guard fully neuters it), AND adds count-assertion observability on the enabled batch (replacing the swallowed-error semantics I confirmed in code) AND keeps a regen-carry-over test in the gate set protecting the dormant writer. Decisively, it is the only plan to instrument two operator north-star metrics on existing events before launch — median doorbell→Send ≤15 min and greenlight rate ≥40% — so the 15-min claim is measured, not asserted. Canonical send model (stage→commit, live N-staged/M-with-client from a shared predicate, aria-described inline disabled reason) is fully specified. Cost: heaviest launch PR (~4-5 days), and folding the greenlight inbox / confidence badge into fast-follow #1 rather than launch means cold-curate ergonomics across a book are promised, not shipped, at v1.
  - *Best idea to graft:* The POV-confidence / data-thinness badge on DraftedPovEditor (rich/thin/generic): it directly compresses cold-curate time across a book by telling the operator which drafts are safe to rubber-stamp and which need real attention — the highest-leverage per-account triage signal, and grafts cleanly into any plan.
  - *Biggest risk:* Launch-PR scope creep: at ~4-5 days it is the longest, and the operator-throughput wins that justify the higher score (greenlight inbox, confidence badge, triage queue) are all fast-follows — so if those slip, v1's actual cold-curate-across-a-book ergonomics are no better than the cheaper plans while having paid for more.
- **craft** — score `8/10`. The safest and cleanest plan on a pure single-account read, and its safety acceptance criteria are the best-articulated of the three: 'runAutoSendForWorkspace() grep-verified unreachable on the default path' is a provable, testable safety artifact, and the 'cold-workspace screenshot showing zero empty SectionCards' is the single best cold-curate acceptance gate any plan offers — it nails the exact thing my dimension cares about (open cold, see a spine, not a wall of placeholders). It deletes its way to safety (cron path, KeywordTargetsLens, ClientRunningOrder, filler cards all leave the runtime) which is genuinely lower-risk than 'managing' dead surfaces. Strong send model, disabled-reason-as-inline-text-node (correctly rejecting tooltips for touch), and a sub-3s 'identify the canonical send action' usability criterion. Where it loses to money on MY dimension: it is thinner on scaling across a book. It correctly flags the portfolio/triage queue + greenlight inbox as 'before ~5-10 clients / FF1' but does not fund the per-account triage ergonomics (no confidence badge, no greenlight inbox in scope) and adds no operator throughput instrumentation — so it optimizes the single cold curate beautifully but says less about the 50th. Still a near-tie for the win on safety + cold-curate clarity alone.
  - *Best idea to graft:* The cold-workspace zero-empty-SectionCards screenshot as a required acceptance artifact: it turns 'collapse the wall' from a subjective claim into a binary, reviewable gate — the cleanest possible proof that the cold-curate experience is actually fixed.
  - *Biggest risk:* Its scaling story is a list of correctly-deferred fast-follows with no per-account triage ergonomics or throughput instrumentation in v1, so it proves a flawless single curate but leaves 'can one operator run a book in 15 min/account' unmeasured and unaided until FF1 lands.
- **ship** — score `7/10`. Operationally sound and the lowest-risk-per-change plan: it correctly weaponizes that the server is already right (sendableRecIds already excludes sent statuses, act-on already creates a request), so most fixes are honesty-not-behavior and the cockpit collapse + empty→null + dark-launch are all present and correct. The de-risking sequence (lowest-risk first, the one net-new gate last) is the most disciplined ordering of the three and the right instinct for a solo operator shipping fast. But on MY dimension it is the weakest of the three. Its scaling-across-a-book treatment is the thinnest — portfolio/POV_UNCHANGED triage is a one-line deferral with no greenlight-inbox or confidence-badge thinking, and it adds NO operator throughput instrumentation, so it cannot tell whether the 15-min cold-curate target is met. Its send-model section is also the muddiest: the predicate-consolidation paragraph tangles itself once ClientRunningOrder is cut (it half-acknowledges the target moved), where money and craft both state a clean single shared-predicate destination. Safety is fine (same dark-launch) but its acceptance criteria are spy/log assertions rather than craft's cleaner grep-unreachable artifact. Solid, promotable, but the least ambitious about the operator at scale.
  - *Best idea to graft:* Implementing in an explicit lowest-risk-first de-risking order with the single net-new gate (server-side act-on tier guard) sequenced last — the most operationally disciplined rollout ordering, so the send model is proven stable before the one behavior-changing edit lands.
  - *Biggest risk:* Its predicate-consolidation target is left ambiguous after ClientRunningOrder is cut (the inline duplicate it names for deletion is in a file it also removes), risking either a half-done consolidation that leaves the drift hazard the rule warns about, or a counter whose N and M silently drift from different sources.

### Judge: SIMPLICITY / FEASIBILITY / ENG-RISK

Dimension winner: **craft**

- **craft** — score `9/10`. Verified against code, this is the lowest-risk, most-buildable plan. Its organizing principle — 'delete our way to four' — is the single best risk-reduction move available: the three genuinely dangerous surfaces (cron auto-send at line 213, ClientRunningOrder's sort_order/migration-145 persistence, the redundant KeywordTargetsLens) are removed at RUNTIME via flag-bail and null-render, NOT re-architected. I confirmed cutting ClientRunningOrder deletes its duplicated isCuratedForClient (line 33) for free, so the predicate-consolidation surface shrinks rather than grows. Tightest scope (~2.5-3 days), explicit 'read-only: do NOT modify recommendation-lifecycle.ts' fence on the single-writer, and the protected-core list is mechanized into gates (grep-verified unreachable auto-send, cold-workspace zero-empty-SectionCard screenshot, byte-identical re-run AFTER EVERY STEP — not just at the end). The per-step re-assertion is the most disciplined regression guard of the three. Sequencing de-risks correctly: consolidation first, dark-launch second, pricing-touch last. Honest about the one hard problem it refuses to chase (full POV reflow on situation/wins/flags is 'multi-day, fragile' — correctly deferred to a staleness nudge). Minor deduction: leans on 'monetizable read from a shared export' without confirming an existing client-importable path for REC_POLICY_REGISTRY (it lives in a server lifecycle file), a small unverified import-surface assumption.
  - *Best idea to graft:* Re-run the flag-OFF byte-identical assertion AND the cut-to-POV reflow test after EVERY step, not once at PR end — turns latent regressions into immediately-visible ones during the build, which is the cheapest possible insurance for a flag-gated trust-critical surface.
  - *Biggest risk:* REC_POLICY_REGISTRY/monetizable lives in server/recommendation-lifecycle.ts which the plan also marks 'read-only, do NOT modify'; reading monetizable client-side may require a new shared export the plan assumes exists but did not verify, and a shared/ extraction of a server-lifecycle constant could pull server-only imports into the client bundle if done carelessly.
- **ship** — score `7/10`. Genuinely the fastest framing (~2.5-3.5 days) and four-of-six blockers are correctly identified as pure JSX/composition with zero behavior change — that part is sound and well-anchored. But its central rhetorical bet — 'weaponize the fact that the server is already right' — is partly imprecise against the code I read. sendableRecIds is NOT a server derivation; it lives at KeywordStrategy.tsx:502 in the FRONTEND and itself duplicates isActiveRec logic inline (a third copy). The fix is still UI-layer so the plan isn't WRONG, but a plan whose headline thesis mis-locates its load-bearing artifact carries hidden eng-risk: an implementer trusting 'server already correct, do not touch sendableRecIds derivation' may not realize the derivation is the duplicated client-side filter the consolidation is supposed to unify. The predicate-consolidation target is the muddiest of the three plans ('unify the client copy to a shared predicate' while simultaneously cutting the file holding that copy). Otherwise solid: dark-launch via one-line cron guard is correct, empty->null guards are right, and the de-risking order (lowest-risk first, net-new gate last) is good. The 'bonus, ~5 min' framing of the StanceBar/queue color unification and bundling it into Blocker 4 is fine but slightly understates the cross-file coordination.
  - *Best idea to graft:* Implement in explicit de-risking order — Blocker 6/3/2 (zero-risk, ship-today-regardless) first, the one net-new server gate (Blocker 1 tier guard touching the public route) dead last — so the send model and surface are stable before the only behavior-changing edit lands.
  - *Biggest risk:* The 'server is already right / UI-only' framing mis-locates sendableRecIds (it's a duplicated frontend filter at KeywordStrategy.tsx:502, not server-authoritative); an implementer who treats that derivation as untouchable while also trying to consolidate the predicate gets contradictory instructions, and the consolidation target is left ambiguous once ClientRunningOrder is cut.
- **money** — score `6/10`. The most technically precise plan on the predicate question — I verified its core feasibility claim is exactly right: both predicates are pure functions of Recommendation with no server deps, they DO extract cleanly to shared/recommendation-predicates.ts, and it is the ONLY plan that names the discussing-overlap comment as an explicit red-line that must travel with the extraction (the real trap, documented in-code at recommendations.ts:676). Its Blocker 1 shape — server tier-gate BEFORE the L6 txn, no Stripe I/O in the txn, a server-computed actOn projection descriptor gated exactly like exposeClientStatus so the client never re-derives pricing — is the most architecturally correct anti-drift design of the three. BUT on MY dimension it is the riskiest and largest: ~4-5 days vs ~2.5-3, and it deliberately funds the most net-new surface area. It adds a server-computed projection descriptor (new field on the public projection — the single highest-scrutiny flag-OFF byte-identical risk, which it acknowledges but still chooses), a Premium quota counter reading a content-subscription record, AND argues to pull portfolio-triage + greenlight-inbox toward launch-adjacent. More moving parts touching billing authority + the public projection = more flag-OFF and regression risk per unit of launch value. It splits the actual Stripe charge to a fast-follow (good), but ships the full tier STRUCTURE now, which is exactly the surface most likely to leak a flag-ON artifact into the flag-OFF path. Strong engineering, wrong risk budget for a 'fix the blockers, protect the core' launch.
  - *Best idea to graft:* Compute the act-on affordance ONCE server-side as a projection descriptor {mode:'included'|'priced'|'locked', requiredTier} gated identically to exposeClientStatus, so the client NEVER re-derives pricing — directly applying the codebase's authority-layered-field anti-drift law to the one place pricing could drift.
  - *Biggest risk:* It funds the most net-new surface (server projection descriptor + Premium quota counter + the full tier structure) touching both billing authority and the public projection — the exact code paths where a flag-ON artifact most easily leaks into the flag-OFF byte-identical path — and the larger ~4-5 day scope widens the regression window against the trust-critical core the task says to protect.

### Judge: PRODUCT / DESIGN CRAFT — is the result coherent and exceptional, does it tell one story across admin + client, and does it satisfy the finality requirements (per-blocker acceptance criteria, zero-TBD decision register, explicit out-of-scope, DoD + gates)?

Dimension winner: **money**

- **ship** — score `6/10`. Solid, promotable, and honest about its trades, but the LEAST design-ambitious of the three on my dimension. Acceptance criteria are testable per blocker, the A/B/C register has a default, and out-of-scope is explicit — finality is adequate. But the cross-surface STORY is thin: it treats the client surface as a relabel exercise and spends little on what the buyer feels. Two real craft defects: (1) Blocker 5's predicate-consolidation prose tangles itself — it consolidates a predicate while simultaneously deleting one of its two call sites (ClientRunningOrder), leaving the target muddy ('unify the client copy to a shared shared/-importable predicate' is hand-wavy where Money/Less name the exact module); (2) the blocker-1 client solution stops at label + TierGate + 403, missing the architectural insight (a server-resolved pricing descriptor) that both rivals reach. Coherent and shippable, not exceptional.
  - *Best idea to graft:* Splitting the non-content-move CTA into a distinct 'Discuss this' verb (vs 'Request this' for content) — the only plan that recognizes non-monetizable moves shouldn't borrow the request-this affordance at all; a genuine clarity win the others flatten.
  - *Biggest risk:* The muddied predicate-consolidation target (consolidate-while-deleting) risks an implementer shipping a half-consolidation, leaving a second drift hazard alive — the exact failure class the audit flags.
- **money** — score `8/10`. The most design-EXCEPTIONAL and the most complete admin→client story. Its blocker-1 fix is the standout craft move in the tournament: a server-computed actOn projection descriptor {mode:'included'|'priced'|'locked', requiredTier} gated exactly like exposeClientStatus, so the client NEVER re-derives pricing. That solves blocker #1 at the contract boundary — the precise predicate-drift failure class the audit warns about — not just at the label. It is also the only plan that sequences for buyer SEGMENT (local clients lead via Also-on-plan), makes the human-curation moat visible at point-of-purchase (byline), and keeps the warm-lead conversation in-card. Decision register has zero TBDs with a genuinely safe engineer-default (the A/B intersection). Finality is strong (gates, regen-carry-over test, flag-OFF byte-identical with the #1 projection as the named scrutiny target). Docked from 9 because the launch boundary is the loosest of the three — it pulls soft-yes + byline + content floor in and floats portfolio/inbox as 'launch-adjacent,' which softens the 'fixes not features' discipline the brief asked for.
  - *Best idea to graft:* The server-computed actOn projection descriptor (mode + requiredTier, gated like exposeClientStatus, absent flag-OFF) — design thinking AT the contract boundary that structurally kills the re-derived-pricing drift hazard. Worth grafting into any winning plan regardless of which one ships.
  - *Biggest risk:* Scope creep: ~4-5 day launch PR with the most items folded in, and the temptation to treat portfolio/greenlight-inbox as launch-adjacent could let the 'fixes only' boundary bleed and push the launch window.
- **craft** — score `8/10`. The most PHILOSOPHICALLY coherent plan and the strongest on pure finality. 'Delete our way to four' is a real thesis that maps onto every blocker (dangerous cron, second persistence layer, redundant lens, filler cards all leave the RUNTIME, not get 'managed') — and it directly serves the redesign's original anti-clutter intent better than any rival. It is the only plan that names an explicit acceptance ARTIFACT (cold-workspace screenshot = zero empty SectionCards) and the only one that mandates re-running the byte-identical assertion AFTER EVERY STEP and an explicit cut→POV reflow test on any DraftedPovEditor touch — finality that makes regressions visible, not latent. Out-of-scope is the tightest, DoD gates are grep-verifiable. Tied with Money on score but for the opposite strength: Money wins on cross-surface design AMBITION, Less-Better wins on DISCIPLINE + finality. Docked from 9 for two small craft slips: 'Premium may read Greenlight' introduces a third CTA label variant that mildly undercuts the one-canonical-verb goal, and the client-EXPERIENCE story (buyer segment, point-of-purchase framing) is less developed than Money's — it adds byline + soft-yes but doesn't think about WHO is reading.
  - *Best idea to graft:* Promoting the cold-workspace 'zero empty SectionCards' screenshot to a hard acceptance ARTIFACT (not a checkbox) — operationalizes blocker #4's intent in a way a reviewer literally cannot fudge, and is the cheapest highest-leverage finality device in the tournament.
  - *Biggest risk:* The third label variant ('Greenlight' for Premium) reintroduces send/commit verb ambiguity on the client side that blocker #5's one-canonical-verb discipline was meant to kill — a self-inflicted coherence nick.

---

## Appendix B — The three full team plans

### Team Ship-It (key: `ship`)

All insertion points confirmed. The cron auto-send is line 213 (a one-line call site to neuter), the act-on route is line 456, the trust-ladder sub-flag doesn't exist yet (needs adding to catalog), and the predicate is duplicated. I have everything I need to write the plan with zero guesses.

# RESOLUTION PLAN — Team Ship-It: "The Issue" launch-blockers

## 1. Strategy — the team bet

**Fastest promotable path: relabel and re-sequence, never rebuild.** Five of six blockers are pure UI/composition fixes inside the existing `strategy-the-issue` flag branch — JSX reorder, label changes, a derived counter, empty→`null` guards, and a one-line cron neuter. The server is already correct on the load-bearing logic (`sendableRecIds` already excludes already-sent statuses; the act-on route already creates a *request*, not generation), so most fixes are **communication honesty, not behavior change**. The single net-new logic gate — a server-side tier check on act-on — is a ~3-hour relabel-plus-gate, not a checkout build. We dark-launch the one genuinely dangerous surface (cron auto-send) behind a sub-flag rather than re-architecting the cron. One launch PR, ~2.5–3.5 days, every change inside `theIssueEnabled` branches so flag-OFF stays byte-identical and the trust-critical lifecycle is never touched.

---

## 2. Per-blocker resolution (all six, with testable acceptance criteria)

### Blocker 1 — "Act on this" has no price/scope/tier
**Change.** Relabel the CTA "Act on this" → **"Request this"** on content cards (`IssueContentCard.tsx`); non-content moves → **"Discuss this"**. Add one visible inline scope line driven by `effectiveTier` (already a prop on `TheIssueClientPage`) + the rec's `monetizable` flag (already on `REC_POLICY_REGISTRY`, `recommendation-lifecycle.ts:40`):
- **Free + monetizable** → `<TierGate>` soft-gate: button reads "Available on Growth", no POST possible.
- **Growth/Premium** → "Request this" enabled, subtitle: *"Sent to your strategist — no charge yet. They'll confirm scope before anything is billed."*
- Success toast changes from "we'll scope it and get to work" → *"Sent to your strategist — no charge yet."*

Add a **server-side tier guard** in the act-on route (`server/routes/recommendations.ts:456`): a Free-tier client POSTing a `monetizable` rec returns `403 { error }`. The hidden button is not the gate — the route is.

**Acceptance criteria.**
- [ ] Free-tier client renders a TierGate prompt (not an active button) on a `monetizable` content card; `POST .../act-on` for that rec returns 403 with `{ error }`.
- [ ] Growth/Premium client renders "Request this" + the visible no-charge scope line; POST succeeds and creates a content request (existing behavior unchanged).
- [ ] No card renders the words "Act on this" anywhere in the `strategy-the-issue` client surface.
- [ ] Success toast contains "no charge".
- [ ] Already-`approved`/`discussing` recs show a disabled CTA with reason ("Already requested" / "In discussion").
- [ ] 44px min touch target on the CTA; integration test exercises `GET /api/public/workspace/:id` read path, not the admin GET.

### Blocker 2 — Client hierarchy inverted (proof above the plan)
**Change.** Pure JSX reorder in `src/components/client/the-issue/TheIssueClientPage.tsx`. Each section is already an isolated `<ErrorBoundary>` and all hooks are unconditional above the return (Rules-of-Hooks safe). Move the content-plan + also-on-plan wrappers directly under `NarratedStatusHeadline`; compress the numbers strip + ROI into one lower-contrast "proof" band below the decision surface. Do **not** touch `ROIDashboard`/`WinsSurface` internals — move wrappers only.

Target order: **Your turn → narrated status headline → content plan (hero) → also on your plan → compressed proof band (numbers + ROI) → what's working / work-in-flight → competitors → footer (ask + the loop).**

**Acceptance criteria.**
- [ ] In DOM order, the content-plan section precedes the ROI/numbers band at every breakpoint, verified at 375px.
- [ ] ROI methodology disclosure ("directional, not booked revenue — we do NOT multiply by close rate/LTV") still renders (moved, not dropped).
- [ ] The single stray month-over-month stat is reconciled: removed for evergreen consistency (Ship-It default — cheapest; if owner wants it kept, that is a one-line owner toggle — see register D2a).
- [ ] No data-fetch or hook changes; diff is JSX-children reorder only.

### Blocker 3 — Trust-ladder auto-send fires in the doorbell tick
**Change. Dark-launch.** Add sub-flag `strategy-trust-ladder` (default OFF) to `FEATURE_FLAG_CATALOG` (`shared/types/feature-flags.ts`) and into the `strategy-the-issue` group's `keys` array. Guard the auto-send call site (`server/strategy-issue-cron.ts:213`, `runAutoSendForWorkspace(...)`) with `if (isFeatureEnabled('strategy-trust-ladder', workspaceId))`. The push + doorbell path (lines 180–201) is untouched and keeps working; only the unsafe leg goes dormant. On the admin side, `TrustLadderPanel` moves into the collapsed "Supporting detail" region (Blocker 4) and returns `null` when its toggles are empty. **Do not** delete the trust-ladder tables/store/route — dormant code is free; ripping it out is a migration risk for zero gain.

**Acceptance criteria.**
- [ ] With `strategy-trust-ladder` OFF (default), the weekly cron rings the doorbell and broadcasts `STRATEGY_ISSUE_PUSHED` but `runAutoSendForWorkspace` is **not** invoked (assert via spy/log: zero auto-sends).
- [ ] `npm run verify:feature-flags` passes with the new key grouped, not orphaned.
- [ ] `TrustLadderPanel` does not render above the fold on a cold workspace.
- [ ] No client receives a recommendation without a manual operator send.

### Blocker 4 — Admin cockpit is a 12–13 section wall
**Change.** Collapse `issueOverviewEl` (`src/components/KeywordStrategy.tsx`, ~lines 542–616) to a spine; everything else into one `<details>`/accordion "Supporting detail" region collapsed by default. Pure composition, no logic.
- **Above the fold:** `IssueHeader (config) → StanceBar → DraftedPovEditor → BackingMovesQueue → Send`.
- **Into "Supporting detail":** `TrustLadderPanel`, `ContentWorkOrderLens`, `OrientZone`, `CannibalizationTriage`, `StrategyDiff`, competitor link.
- **Drop `KeywordTargetsLens`** entirely → replace with a single "Curated keyword targets →" deep-link row (it restates the Keyword Hub). **Cut `ClientRunningOrder`** for launch (chevron reorder is a fiddle-knob; feed auto-sorts by opportunity value).
- **Empty → `null`:** add an early `if (!items.length) return null;` to `ContentWorkOrderLens`, `TrustLadderPanel` (and any remaining projection), copying the self-nulling pattern `IssueAlsoOnPlanSection` already uses. No empty `SectionCard` chrome on a cold workspace.
- **Bonus (~5 min, do it here):** fix the StanceBar↔queue color swap. Export ONE `ARCHETYPE_ACCENT` from `recArchetypeMap.ts`, import on both `StanceBar.tsx` and `BackingMovesQueue.tsx`. (`StanceBar` maps `authority_bet→teal`, queue maps it `→blue` — inverted.)

**Acceptance criteria.**
- [ ] Cold (thin) workspace renders exactly Header → StanceBar → DraftedPovEditor → BackingMovesQueue → Send footer above the fold, with zero empty `SectionCard` shells.
- [ ] `ContentWorkOrderLens` and `TrustLadderPanel` return `null` when they have no content (unit/component assertion).
- [ ] StanceBar archetype accent color === BackingMovesQueue group-dot color for every archetype (single shared constant; assert in test).
- [ ] StanceBar segments carry `aria-label="[N] [archetype] moves"`.
- [ ] `KeywordTargetsLens` and `ClientRunningOrder` are not rendered in the launch cockpit.

### Blocker 5 — Three competing send surfaces
**Change.** UI-layer only — the server is already correct (`sendableRecIds` excludes `clientStatus ∈ {sent,approved,declined,discussing}`, so re-sends are no-ops). **Do not change `sendRecommendation` or the `sendableRecIds` derivation.**
- Reframe per-row send and bulk-bar send as **"Stage for this issue"** (label change). Reserve header **"Send issue"** as the one canonical commit.
- Add a live counter **"N staged · M already with client"** near the queue header AND on the Send button. Both counts derive client-side from the rec set (`sendableRecIds.length`; sent-subset count) — no new endpoint.
- Disabled Send shows a reason string: `canSend === false` → "Everything curated is already with the client" / "Nothing active to send"; add `aria-disabled="true"` + `title`.
- **Consolidate the duplicated predicate** in this PR: extract `isCuratedForClient` to one shared module and import it on both sides; delete the inline copy at `ClientRunningOrder.tsx:33` (drift hazard) — but since `ClientRunningOrder` is cut from launch (Blocker 4), the consolidation target is the client-facing surface and server (`recommendations.ts` / `strategy-issue-lenses.ts` already import from `recommendations.ts`; unify the client copy to a shared `shared/`-importable predicate).

**Acceptance criteria.**
- [ ] Exactly one button labeled "Send issue" commits; per-row/bulk verbs read "Stage".
- [ ] Counter "N staged · M already with client" renders near the queue and on the Send button, and updates as recs are staged/struck.
- [ ] Disabled Send shows a human reason string and `aria-disabled`.
- [ ] One `isCuratedForClient` definition exists in the repo (grep returns a single source); no inline duplicate.
- [ ] `sendRecommendation` and `sendableRecIds` logic byte-unchanged.

### Blocker 6 — Fabricated blurred competitor rows
**Change.** Replace the invented "emergency service near me" / "same-day repair" teaser strings in the competitor snapshot with **either** one real single-row taste (top competitor from existing data) + "+ add competitors to unlock full view" **or** a generic non-fabricated placeholder ("Competitor data available — connect your competitor list in settings"). Ship-It default: show one real row if real data exists, else the generic placeholder. Zero fabricated data on a trust surface. Isolated to the competitor snapshot component; no server, no projection.

**Acceptance criteria.**
- [ ] Grep of the client surface returns zero occurrences of "emergency service near me" / "same-day repair" / any hard-coded fake competitor string.
- [ ] With no real competitor data → generic placeholder renders (no blurred fake rows). With real data → one real row + unlock CTA.
- [ ] No `blur`-styled fabricated rows remain.

---

## 3. "Act on this" monetization model — OWNER DECISION

This is the one business/pricing call. The UX/engineering contract is identical regardless of which the owner picks; only the gating depth differs.

**RECOMMENDED — Option A: Relabel + tier-gate (no checkout).** "Request this" with a `<TierGate>` on Free (`monetizable` recs only) + a **server-side** 403 guard in the act-on route, and a no-charge scope line for Growth/Premium. Closes the "am I being charged?" freeze AND the free-SKU revenue leak (Free can't request) in ~3–4 hrs, no pricing UI. **Ship this in the launch PR.**

**Alternative B — Confirm-sheet (most honest, slightly more build).** "Request this" always opens a confirm sheet showing scope + "included in your plan / quoted first" before commit. ~+1 day. Higher clarity, defers checkout. Pick if the owner wants an explicit confirm step at launch.

**Alternative C — Full priced à-la-carte checkout.** Wire act-on into the existing `SeoCart`/`decision-adapters` infra; Premium consumes included quota with a visible "X of N this month" counter, Growth gets a priced checkout. 1–2 days, margin-correct, but re-opens monetization UX the spec deferred. **Recommend deferring to fast-follow** — Option A removes the trust landmine and the leak today; per-item billing earns its build later.

> **What the owner must ratify before launch:** which of A/B/C. "No price/scope/tier of any kind" is **not** promotable — *some* answer is a hard launch gate. Default if no decision lands: ship Option A (the team recommendation).

---

## 4. Fast-follows — included vs deferred

**Included in launch PR (small, surgical, high-trust):**
- **Content floor → 2 states** — drop the 4 "we're evaluating" filler cards; show curated cards OR one honest "still sizing up your content opportunities" line. ~2 hrs; it's the sales-demo landing surface. *(Included — Engineer + Product agree it rides launch.)*
- **Predicate consolidation** — one shared `isCuratedForClient`. *(Included — documented drift hazard; cheapest to do while touching Blocker 5.)*
- **StanceBar/queue color unification** — one shared constant. *(Included — bundled into Blocker 4, ~5 min.)*
- **POV staleness nudge** — when struck/edited recs diverge from the POV's `generatedAt`, show inline "Point of view may be out of date — regenerate?" under `DraftedPovEditor`. *(Included — the cheap interim guard against the partial-honesty gap; one state check, one line.)*
- **Disabled-Send reason + aria** — *(Included — bundled into Blocker 5.)*

**Deferred (with rationale):**
- **In-card "Let's talk" soft-yes** — Client/UIUX advocate pulling it in as the pressure-release valve for pricing ambiguity. *Ship-It call: borderline-defer.* It needs an advisor pre-seed prop wire; if Option A lands clean and there's slack in the 3.5-day budget, pull it into launch as the warm-lead valve; otherwise first fast-follow. **Not a hard launch gate** because the footer advisor already exists.
- **Portfolio/triage queue off `POV_UNCHANGED`** — defer. Substrate is built; it gates *multi-account* scale (>~10 accounts), not single-account launch. First fast-follow.
- **Full POV reflow on situation/wins/flags** — defer. Multi-day AI-prompt correctness change; the staleness nudge is the launch-PR interim.
- **Outcome/export one-pager + funnel bridge** — defer. Net-new feature, not a fix. **Guard:** the ROI methodology disclosure must stay and the stray MoM stat must be reconciled (both in Blocker 2 acceptance) so the deferral doesn't bleed trust.
- **Trust-ladder decoupled re-architecture** — deferred behind the dark-launch flag; earns its build when the first auto-send is genuinely warranted.
- **External client-facing name** — owner/marketing decision, not engineering. Flag for owner; does not block launch.

---

## 5. Scope + explicit OUT-OF-SCOPE

**IN SCOPE (launch PR):** all 6 blockers + content-floor 2-state + predicate consolidation + color unification + POV staleness nudge + disabled-send reason/aria + the server-side act-on tier guard.

**OUT OF SCOPE (explicit, will not appear in the launch PR):**
- Any checkout / pricing UI / quota meter on the Issue surface (Option C).
- Portfolio/triage multi-account queue.
- Full POV honesty reflow on situation/wins/flags prose.
- Outcome/export one-pager, conversions→organic funnel bridge.
- Evergreen-vs-dated revisit architecture (return-to-weekly leans on email/notification; on-surface proof-of-work = the existing loop tally + work-in-flight signal).
- External client-facing name / strategist byline.
- Trust-ladder decoupled tick + veto-hold re-architecture (dormant behind flag).
- Any change to `recommendation-lifecycle.ts` writers, `creditArchetypeCycleOnSend`, `sendRecommendation`, or `sendableRecIds` derivation.

---

## 6. Sequencing — launch PR vs fast-follow + effort

**One launch PR, ~2.5–3.5 days, implemented in this de-risking order** (lowest risk first so the send model is stable before the one net-new gate):

| # | Task | Effort | Risk |
|---|------|--------|------|
| 1 | Blocker 6 — fabricated rows → real/placeholder | ~1–2 hrs | Very low |
| 2 | Blocker 3 — dark-launch auto-send (sub-flag + 1 guard) | ~30 min | Zero (dormant) |
| 3 | Blocker 2 — client hierarchy JSX reorder | ~2–3 hrs | Very low |
| 4 | Content floor → 2 states | ~2 hrs | Low |
| 5 | Blocker 5 — one send model + counter + disabled reason + predicate consolidation + color unify | ~half day | Low-med |
| 6 | Blocker 4 — admin spine + empty→null + drop KeywordTargetsLens/ClientRunningOrder | ~half day | Low |
| 7 | POV staleness nudge | ~30 min | Low |
| 8 | Blocker 1 — "Request this" relabel + TierGate + server-side act-on tier guard (Option A) | ~3–4 hrs | Med (touches public route + projection) |

**Fast-follow order:** in-card "Let's talk" → portfolio/`POV_UNCHANGED` triage → full POV reflow → outcome/export one-pager → trust-ladder decoupled re-architecture → external name.

---

## 7. Risk — how the strong core, flag-OFF, and trust-critical invariants are preserved

**Strong core protected (do NOT break):**
- **Cut→POV-sentence live reflow** — `DraftedPovEditor` stays mounted identically; the spine reorder (Blocker 4) only repositions sibling sections around it. Untouched.
- **Lost-keystroke guard** (draft reset keyed on `generatedAt` only) — not touched; the staleness nudge *reads* `generatedAt`, never resets on it.
- **Archetype shortlist (cap 5 + show-more)** — preserved in StanceBar; only its accent constant is unified.
- **Per-section ErrorBoundary** — the client reorder moves whole `<ErrorBoundary>` wrappers, keeping isolation intact.

**Flag-OFF byte-identical:** every change lives inside a `theIssueEnabled` ternary branch or is additive. The `command-center` flag-OFF path (`StrategyCockpit.tsx`) takes no new props and is not edited. The new `strategy-trust-ladder` sub-flag defaults OFF and only further gates code already behind `strategy-the-issue`. **Gate:** diff the `command-center` render with the flag OFF → byte-identical.

**Trust-critical regen carry-over + no-baking:** `recommendation-lifecycle.ts` writers and `creditArchetypeCycleOnSend` are NOT modified — dark-launching auto-send neuters only the cron's call site (`strategy-issue-cron.ts:213`), not the lifecycle credit (which remains flag-guarded and never throws on manual sends). Overrides continue to apply at display boundaries only, never baked; `markRecommendationAutoSent` stays transactional and simply isn't called while the sub-flag is OFF. **Gate:** existing rec-lifecycle tests pass unchanged; trust-ladder tables/store are not migrated or deleted.

**Definition of Done / gates (all must pass):**
- [ ] `npm run typecheck` — zero errors
- [ ] `npx vite build` — succeeds
- [ ] `npx vitest run` — full suite green
- [ ] `npx tsx scripts/pr-check.ts` — zero errors
- [ ] `npm run verify:feature-flags` — `strategy-trust-ladder` grouped, not orphaned
- [ ] Flag-OFF byte-identical (`command-center` render diff)
- [ ] Trust-critical regen carry-over + no-baking preserved (rec-lifecycle tests unchanged; lifecycle untouched)
- [ ] Every per-blocker acceptance criterion above is checked
- [ ] Owner has ratified the act-on monetization option (A/B/C) — default A
- [ ] Single-agent-per-domain → `superpowers:requesting-code-review`; if any part used parallel agents → `scaled-code-review`

---

## 8. Why this plan is exceptional — and what it deliberately sacrifices

**Exceptional because it weaponizes the fact that the server is already right.** The expensive-looking blockers (send model, act-on) collapse into label-and-honesty fixes the moment you confirm `sendableRecIds` already excludes sent statuses and act-on already creates a request, not generation. Four of six blockers are pure JSX/composition with zero behavior change and zero touch to any protected invariant. The one genuinely dangerous surface — the cron auto-send firing in the doorbell tick — is neutralized with a one-line flag guard instead of a multi-hour cron re-architecture, and the only net-new logic (a server-side tier guard) is the smallest possible gate that closes both the trust freeze and the revenue leak. The result is a single ~3-day PR that ships every launch-blocker resolution while leaving the praised core (live reflow, keystroke guard, no-baking) literally untouched.

**Deliberately sacrificed:**
- **Margin capture today.** Option A relabels-and-gates instead of billing per item; the highest-margin content SKU is request-only (free for Growth/Premium retainer) until Option C lands as a fast-follow. We accept a near-term revenue-capture gap to ship trust safely now.
- **The complete POV honesty guarantee.** situation/wins/flags prose can still assert a win you cut; we ship the "may be out of date — regenerate" nudge as the cheap interim and defer the multi-day reflow. There is a narrow window where an operator who ignores the nudge could send a slightly stale POV.
- **Trust-ladder automation value.** Dark-launched to zero until it's earned — solo-agency scale doesn't justify the auto-send risk this quarter.
- **The weekly return reason on-surface.** Evergreen-no-dates stays; we lean on email/notification + the loop tally for proof-of-work rather than building dated period-over-period views now (deferred with the outcome one-pager).

These are the right trades for "fastest promotable path": every sacrifice is a *deferral with a named guard*, not a hole — and none of them block a paying client from greenlighting a move instead of freezing.

---

**Key file map for the executing engineer:**
- Client reorder + content floor + ROI compress → `src/components/client/the-issue/TheIssueClientPage.tsx` (+ `IssueContentPlanSection.tsx`, `IssueContentCard.tsx`)
- Act-on relabel/TierGate + scope line → `IssueContentCard.tsx`; **server tier guard** → `server/routes/recommendations.ts:456`
- Admin spine + empty→null → `src/components/KeywordStrategy.tsx` (~542–616) + `ContentWorkOrderLens.tsx`, `TrustLadderPanel.tsx`; drop `KeywordTargetsLens.tsx`, `ClientRunningOrder.tsx` from render
- Send model + counter + disabled reason → `IssueHeader.tsx`, `BackingMovesQueue.tsx`/`CockpitRow`, bulk bar
- Predicate consolidation → extract from `server/recommendations.ts:681` `isCuratedForClient` to one shared source; delete inline copy at `ClientRunningOrder.tsx:33`
- Color unify → `recArchetypeMap.ts` (export `ARCHETYPE_ACCENT`) + `StanceBar.tsx` + `BackingMovesQueue.tsx`
- Cron dark-launch → `server/strategy-issue-cron.ts:213` guard; new sub-flag `strategy-trust-ladder` → `shared/types/feature-flags.ts` (catalog + group `keys`)
- Competitor rows → competitor snapshot component on the client surface
- POV staleness nudge → `DraftedPovEditor.tsx` (read `generatedAt` vs struck-rec divergence)

---

### Team Money-Surface (key: `money`)

I have everything I need. The two predicates are pure functions of `Recommendation` (only read `lifecycle`, `clientStatus`, `status`, `throttledUntil`) with no server-only dependencies — confirming the engineer's verdict that they extract cleanly to `shared/`. The `discussing` overlap is explicitly documented as a red-line. All six blocker anchors are verified.

I now have grounded confirmation of every claim. Here is the resolution plan.

---

# RESOLUTION PLAN — Team Money-Surface: "The Issue" Launch-Blocker Fixes

## 1. Strategy — the team bet

**The client dashboard is the profit engine, so we spend the launch PR turning the one conversion action from a trust landmine into a tier-aware revenue loop, and we re-sequence the client surface so the money (the content plan) is the first thing the buyer reads.** Five of six blockers are hours-to-a-day of pure frontend/relabel work that never touches the trust-critical core; the only one that crosses the billing authority and the public projection (#1) gets a *cheap correct* fix — server tier-gate at the route top + a server-computed projection descriptor + a "Request this" relabel — with the actual à-la-carte Stripe charge deliberately split into a fast-follow PR so launch is never gated on new checkout plumbing. We invest the "more now" budget exactly where Money-Surface's expansion ceiling actually sits — the operator throughput (greenlight inbox + portfolio triage) that lets one solo agency keep the money surface warm across a whole book — but we stage those as launch-adjacent fast-follows, not launch blockers. Everything ships behind `strategy-the-issue` (flag-OFF byte-identical), and the signature cut→POV-sentence reflow, the lost-keystroke guard, the regen carry-over, and the no-baking invariant are explicitly fenced off from every change.

---

## 2. Per-blocker resolution (all six)

### Blocker #1 — "Act on this" has no price/scope/tier

**Change.** Three coordinated edits, server-authoritative:

1. **Relabel** "Act on this" → **"Request this"** on every content-plan card (`IssueContentPlanSection.tsx`), and the success toast → *"Added to your plan — your strategist will scope it and confirm before any work or charge."* This is presentation-only, zero billing logic, and removes the authorization ambiguity on all tiers regardless of which pricing option the owner picks.
2. **Tier gate at the route top** (`server/routes/recommendations.ts`, act-on route, line ~459 — **before** the L6 `db.transaction()`, never inside it, no Stripe I/O in the txn). Call `computeEffectiveTier(getWorkspace(workspaceId))`:
   - `free` → `403 { error, requiredTier: 'growth' }`, no request created.
   - `growth` / `premium` → pass through to the existing greenlight (recommended v1 = relabel-only request; see §3 for the owner's à-la-carte option).
3. **Server-computed projection descriptor.** Add a flag-gated `actOn` affordance to the curated public rec projection inside `stripEmvFromPublicRecs(...)`: `{ mode: 'included' | 'priced' | 'locked', requiredTier?: 'growth' }`. Computed once server-side from `computeEffectiveTier` + rec type so the client **never re-derives pricing** (the documented drift hazard). Free → `locked` (client renders the `<TierGate>` "Growth feature" nudge, reusing the working `CompetitorGaps` pattern); Growth/Premium → `included` for v1. Gate its presence exactly like the existing `exposeClientStatus` arg so it is **absent when the flag is off**.
4. **Confirm step + consequence line** on the card: a one-line muted subline (`actOn.mode==='included'` → "Your strategist will confirm scope before any work begins.") and a single confirm before the POST commits (reuse `ConfirmDialog`). The current one-click+toast is the freeze trap.

**Acceptance criteria.**
- Free-tier client: `act-on` POST returns 403; the card renders a `<TierGate>` nudge, no content request row is created (assert `list_content_requests` count unchanged).
- Growth/Premium client: `act-on` succeeds, one lineage-stamped content request created (`dedupe:false` preserved), `clientStatus → approved`.
- Button label reads "Request this" on all tiers; a consequence subline is present on every content card; a confirm step precedes commit.
- Flag-OFF: the `actOn` descriptor is **absent** from the public projection (byte-identical diff assertion).
- The L6 atomic unit is untouched: a throw still rolls back both the greenlight and the request together (existing test stays green).

### Blocker #2 — Client hierarchy inverted

**Change.** Pure JSX reorder in `TheIssueClientPage.tsx` (one file; each section already independently `ErrorBoundary`-wrapped, no inter-section data dependency). New canonical order:

```
1. NarratedStatusHeadline      — evergreen headline + health chip + "see your numbers" link
2. ⭐ IssueContentPlanSection   — THE MONEY (moves up from position 4)
3. IssueAlsoOnPlanSection       — secondary moves (local-visibility/technical lead lives here)
4. Proof band (compressed)      — CompactStatBar + ROI collapsed into ONE band, "See full report →"
5. WinsSurface + OutcomeSummary — evergreen proof
6. CompetitorGapsSection        — one real row (see #6)
```

ROI + the numbers strip do not disappear — they collapse from two stacked full sections (current positions 2+3) into **one** proof band below the content plan. The full `ROIDashboard` moves behind a "See full report" link/expand.

**Acceptance criteria.**
- On mobile, the first scrollable section after the status headline is `IssueContentPlanSection`. ROI/numbers/wins all render **below** the first content card.
- Proof is one horizontal band, not two separate full-width sections.
- Flag-OFF byte-identical preserved (the whole page mounts under the flag).

### Blocker #3 — Trust-ladder auto-send in the doorbell tick

**Change. Dark-launch (cheapest + safest, ~1 hr).** Add an OFF-by-default child flag `strategy-trust-ladder-autosend` to `FEATURE_FLAG_CATALOG`. Gate the `runAutoSendForWorkspace(...)` call at `server/strategy-issue-cron.ts:213` behind `isFeatureEnabled('strategy-trust-ladder-autosend', workspaceId)`. The entire subsystem (store, route, panel, migration 144) stays byte-inert — zero schema change. The doorbell still rings; **no auto-send fires.** Add the audit's **count assertion**: emit a structured `log.warn` when an (enabled) auto-send batch sends 0 or an unexpected count — replacing the swallowed-error semantics with observability (the only cron behavior-edit allowed in the launch PR).

**Acceptance criteria.**
- With the child flag OFF (default), the cron tick rings the doorbell and `runAutoSendForWorkspace` is **not called** (assert via spy in cron test).
- No move reaches a paying client without explicit operator action.
- The TrustLadderPanel renders only behind progressive disclosure (#4) and never on a cold workspace.
- `verify:feature-flags` passes with the new child flag grouped under `strategy-the-issue`.

### Blocker #4 — Admin cockpit wall

**Change.** Collapse `issueOverviewEl` (`KeywordStrategy.tsx:542-616`) to a five-section spine; everything else behind one "Supporting detail" disclosure.

```
SPINE (cold default, above the fold):
  IssueHeader (config + Send issue w/ counter) → StanceBar → DraftedPovEditor → BackingMovesQueue → Send

SUPPORTING DETAIL (one disclosure region, collapsed by default):
  ContentWorkOrderLens · Orient glance · Cannibalization · StrategyDiff · Competitor link
```

- **Empty projections return `null`**, never an empty `SectionCard` (`KeywordTargetsLens`, `ContentWorkOrderLens`, `TrustLadderPanel`, and `ClientRunningOrder`-if-kept). `IssueAlsoOnPlanSection` already does this — mirror the pattern.
- `KeywordTargetsLens` → replaced by a single "Curated keyword targets →" deep-link into Keyword Hub (not a SectionCard).
- **Cut `ClientRunningOrder` from v1 entirely** (Money-Surface + operator + product all concur): the opportunity-value sort + top-move emphasis IS the running order. This drops the reorder panel from the scroll AND avoids maintaining the `sort_order` / migration-145 persistence path the spec deferred drag-reorder to avoid. Reintroduce only on a concrete operator request.
- **Keep one lens:** `ContentWorkOrderLens` (production-stage badge = real in-flight billable signal). Drop `KeywordTargetsLens` to the deep-link above.
- **Protect:** `DraftedPovEditor` (with the cut→POV reflow) stays in the spine, never behind disclosure.

**Acceptance criteria.**
- A freshly-loaded cold workspace shows exactly the 5 spine sections above the fold; the Supporting-detail region is collapsed by default.
- Zero empty `SectionCard` chrome on a cold workspace (assert no "curate moves above" placeholder renders).
- `ClientRunningOrder` is removed from the render tree; no `sort_order` reorder path is reachable from the v1 cockpit.
- The cut→POV-sentence reflow still fires (its component test stays green).

### Blocker #5 — Three competing send surfaces

**Change.** One commit, two staging actions (editorial draft → stage → publish model):

- Per-row "Send to client" → **"Stage for issue"** (queues into the staged set; does not reach the client).
- Bulk-bar "Send N" → **"Stage N"** (same).
- Header "Send issue" → **the one commit** that delivers all staged moves; always active when `stagedCount > 0`, shows `Send issue · N staged`.
- **Live counter strip** below `IssueHeader`, always visible: `N staged · M already with client`. **N and M must derive from the SAME shared predicate** introduced in fast-follow-#1 (`isCuratedForClient` gives M; `sendableRecIds` gives N) — CLAUDE.md rate-display rule (numerator/denominator share a source).
- **Disabled state carries a reason string** (`aria-disabled` + the string): `stagedCount===0` → "Stage moves below to send."; all-curated → "Everything curated is already with your client."

**Acceptance criteria.**
- Only the header Send commits to the client; per-row/bulk update staged status only (no public projection write).
- The `N staged · M already with client` counter is always visible and both numbers come from the shared predicate module.
- The disabled Send button always shows a reason string and `aria-disabled="true"`.

### Blocker #6 — Fabricated blurred competitor rows

**Change (~1-2 hrs, pure string/component).** Delete the fake "emergency service near me" / blurred teaser rows. Replace with:
- **If real competitor gap data exists:** one **real** unblurred row — `"Your top gap: [competitor domain]"` (strongest — proves the value).
- **If no real data:** a generic placeholder that visibly does NOT masquerade as the client's data — `"Your strategist is mapping your competitive landscape."` + a CTA to the full competitor page when available.

The premium TierGate-the-payoff pattern may stay; the **fabricated teaser content** is removed. No blur, no fake keyword strings, no invented domains, at any tier.

**Acceptance criteria.**
- Zero fabricated keyword strings or fake domains render in the competitor section at any tier (assert no hard-coded "near me"/teaser literals remain).
- Either exactly one real competitor row OR one generic placeholder renders — never blurred fake rows.

---

## 3. "Act on this" monetization model — OWNER DECISION

> **The locked spec's "NO pricing UI / no TierGate" decision is now reopened.** Every customer persona froze at the priceless button; Money-Surface's entire thesis dies if its one conversion action stays priceless and ungated. This is the central owner decision, not a detail. **The "Act on this" → "Request this" relabel ships regardless of which option is chosen** — it removes the authorization ambiguity without any checkout.

**RECOMMENDED — Option A: Tier-aware "Request this" reusing the existing à-la-carte cart.**

| Tier | Behavior | What the client sees |
|---|---|---|
| **Free** | Gated — no greenlight | `<TierGate>` "Greenlighting moves is a Growth feature" (reuse CompetitorGaps pattern) |
| **Growth** | Greenlight → **priced** content request → existing à-la-carte checkout ($75–800 SKUs already exist); no work enters the queue until payment clears | "This becomes a content request — about $X" → confirm → checkout |
| **Premium** | Greenlight consumes 1 of an included monthly quota, visible counter | "Uses 1 of your 4 included briefs (3 left)" |

*Why A:* resolves both directions of the defect (clients freeze / agency gives away the $250–800 SKU free) simultaneously, uses existing checkout infra, and creates a real upsell moment. **Engineering caveat (verified):** a clean per-item content-checkout *route* does not exist today (only `content-subscriptions.ts`); wiring act-on → a new Stripe Checkout session is multi-day. **So the launch PR ships Option A's *structure* — relabel + Free-tier gate + the server `actOn` projection descriptor + Premium quota counter — and the Growth à-la-carte *charge* is an explicit fast-follow PR.** This gives the owner the full model with launch un-gated on Stripe plumbing.

**Alternative B — Retainer-only request, no checkout (cheapest launch).** Relabel to "Request this" universally + inline "Included in your retainer — your strategist will confirm scope before any work or charge" + confirm step. Converts the trust landmine (removes the freeze) but **does NOT close the revenue leak** — Growth clients get the same free button as Premium. Viable only if the owner intends a flat-retainer-only model with no à-la-carte.

**Alternative C — Rename + disclosure only.** "Request this" + a tooltip, no tier logic. Cheapest possible; leaves the monetization gap fully open. Only acceptable if every client is on a flat retainer forever.

**Decision register (zero TBDs):**
- **D1 — Pricing model:** → **OWNER.** Recommended **A** (structure in launch PR, à-la-carte charge fast-follow). Engineer default if no owner response by launch: ship the **relabel + Free-gate + descriptor** (the A/B intersection — safe under both A and B; only the Growth charge differs).
- **D2 — Relabel:** **DECIDED** — "Act on this" → "Request this" everywhere, all tiers. Not owner-gated.
- **D3 — Premium quota source:** if A, the quota counter reads from the existing content-subscription/quota record; the request stamps the resolved billing disposition server-side so the operator never reconciles manually.
- **D4 — Confirm step:** **DECIDED** — single `ConfirmDialog` before commit on all options.

---

## 4. Fast-follows — included vs deferred

**INCLUDED in the launch PR (cheap, on-philosophy, de-risk a blocker):**
- **Consolidate `isCuratedForClient`/`sendable` into one shared module** (~1-2 hrs). The inline copy in `ClientRunningOrder.tsx:33-40` is a verbatim duplicate of the server canonical (`server/recommendations.ts:681`) and a documented drift hazard. Both predicates are pure functions of `Recommendation` (verified — no server deps) → extract `isCuratedForClient` + `isActiveRec` to `shared/recommendation-predicates.ts`, import both sides. **Do this BEFORE #5** so the counter's N and M share one source. **Red-line: the extracted `isCuratedForClient` MUST keep the `discussing`-overlap comment** ("NOT the complement of isActiveRec"). *(Note: since #4 cuts `ClientRunningOrder`, the consolidation lands in the #5 counter + the public projection — still the canonical fix.)*
- **Content floor → 2 states** (~half day, `IssueContentPlanSection.tsx`). Drop the up-to-4 "evaluating" filler cards + the cross-tier dedup pass. Either curated request cards or one honest line ("We're still sizing up your content opportunities — check back next week"). An 80%-filler hero is the exact state a sales demo lands on.
- **In-card "Let's talk about this" soft-yes** (~half day). Add a second per-card affordance that opens the advisor pre-seeded with the rec's context (rec title + `targetKeyword`). `onOpenChat` is already wired into the page — no new backend. This is Money-Surface's warm-lead capture (the conversation a high-end firm survives on); pull it into launch.
- **POV staleness nudge** (~2 hrs). When struck/edited recs diverge from the POV's `generatedAt`, show "POV may be out of date — regenerate". The cheap mitigation for the partial-honesty gap (the reflow covers only the lead sentence; situation/wins/flags are free prose that can assert a cut win). Closes the trust hole without the hard free-prose NLP problem.
- **"Curated by your strategist" byline** (copywriting, ~30 min). One line below the status headline making the human-curation moat visible at the point of purchase. Lock the external client-facing name before public sale.

**DEFERRED to fast-follow PR (real value, gates expansion not launch):**
- **Growth à-la-carte Stripe charge** for act-on (multi-day; no per-item checkout route exists today). The launch ships the tier *structure*; the charge wires after.
- **Portfolio/triage queue off `POV_UNCHANGED`** (multi-day). *Operator's #1 ask* and genuinely launch-adjacent for Money-Surface — the revenue loop doesn't compound past ~5-8 accounts without it — but it's a cross-workspace UI surface, not a client-surface launch blocker. **Sequence it as fast-follow #1, before onboarding past ~5 accounts.**
- **In-cockpit "new greenlights waiting" inbox** (medium). Surfaces pending act-on content requests in the operator's face so a greenlight is never dropped (a dropped greenlight = the exact moment the retention loop silently breaks). Pair with the triage queue as fast-follow #1.
- **POV-confidence / data-thinness badge** on `DraftedPovEditor` (rich/thin/generic). Lets the operator rubber-stamp rich POVs and spend minutes where the POV is sparse. Fast-follow #1.
- **Outcome/export one-pager** (multi-day; new render/export path). The B2B/CMO budget-defense ask — they won't expand without it — but not a launch blocker. The export view is **allowed to be period-over-period** (budget cycles are temporal) while the client dashboard stays evergreen.
- **"What moved since you last looked" activity signal** (medium). Restores the weekly-return reason the evergreen rule removed (state-of-work, not dates: "2 new moves added," "3 briefs in progress"). Evergreen-safe. Retention fast-follow.
- **Real GA4-conversion hero hook** (data-substrate dependent). Demote traffic-value to a secondary proxy when conversions are connected; put a real number behind the stated goal.
- **Full POV wins/flags reflow** (hard — no rec linkage). The staleness nudge is the launch mitigation; full reflow is a separate feature.

---

## 5. Scope + explicit OUT-OF-SCOPE

**IN scope (launch PR):** the six blockers; predicate consolidation; content floor → 2 states; in-card "Let's talk"; POV staleness nudge; strategist byline; the Option-A *structure* (relabel + Free-gate + projection descriptor + Premium counter).

**OUT of scope (launch PR), explicit:**
- Trust-ladder **auto-send** (dark-launched behind `strategy-trust-ladder-autosend`, OFF).
- Growth **à-la-carte Stripe charge** (fast-follow PR).
- `ClientRunningOrder` reorder / drag / chevron / `sort_order` persistence (cut from v1).
- Portfolio triage queue, in-cockpit greenlight inbox, POV-confidence badge (fast-follow #1).
- Outcome/export one-pager, "what moved" signal, GA4-conversion hero, full wins/flags reflow.
- External brand naming (copywriting/owner decision).
- The full competitor page (deferred in spec — stays deferred).
- Period-over-period data on the **client dashboard** (evergreen stays; only the future export view may be temporal).
- Trust-ladder **decoupling-to-a-later-tick** (explicitly rejected in favor of dark-launch — building more cron-correctness surface to defer a feature that saves seconds is the wrong trade at solo scale).

---

## 6. Sequencing — launch PR vs fast-follow + effort sizing

**Launch PR — internal order (the whole PR is one phase; sub-steps ordered for safety):**
1. **#6 competitor rows** (~1-2 hr) + **#2 re-sequence** (~2 hr) + **#3 dark-launch** (~1 hr) — all trivial, zero-risk, independent. Land first; **#2 and #6 should ship today regardless of the rest.**
2. **Predicate consolidation** (~1-2 hr) — unblocks #5's shared-source counter. Keep the `discussing`-overlap comment.
3. **#5 canonical send + counter** (~half day) and **#4 spine + null projections + cut ClientRunningOrder** (~1-1.5 days) — parallelizable, both pure frontend. Coordinate the one shared file (`KeywordStrategy.tsx` overview vs the individual lens/panel components — exclusive ownership per the multi-agent rule).
4. **Content floor → 2 states + in-card "Let's talk" + POV staleness nudge + byline** (~1 day) — fold in alongside #4 (same files).
5. **#1 tier gate + relabel + projection descriptor + Premium counter** (~1 day) — **last**; the only item touching the public projection + billing authority. Server gate + relabel + descriptor only; the à-la-carte charge is the separate fast-follow PR. Scrutinize the flag-OFF diff here above all.

**Total launch PR: ~4-5 engineering days.**

**Fast-follow PR #1 (before onboarding past ~5 accounts):** portfolio triage queue + in-cockpit greenlight inbox + POV-confidence badge. *(Money-Surface argues these are launch-adjacent — the revenue loop is operator-throughput-capped, not client-polish-capped.)*
**Fast-follow PR #2:** Growth à-la-carte Stripe charge for act-on.
**Fast-follow PR #3:** outcome/export one-pager + "what moved" signal + GA4-conversion hook.

**Instrument before launch (no new infra — joins on existing events):** (a) **time-to-prepared** — median operator minutes from cron doorbell event → "Send issue" commit (target ≤15 min); (b) **client greenlight rate** — % of sent recs that get an act-on within 7-14 days (target ≥40% @ 14d). These are the two north-star metrics for whether the client surface is actually the profit engine.

---

## 7. Risk — how the strong core, flag-OFF, and trust-critical invariants are preserved

| Protected invariant | How this plan preserves it |
|---|---|
| **Cut→POV-sentence live reflow** (signature, 9/10 praised) | `DraftedPovEditor` stays in the spine (#4), never behind disclosure, never moved. No edit touches its reflow logic. Component test stays in the gate set. |
| **Lost-keystroke guard** (draft reset keyed on `generatedAt` only) | Untouched. The staleness nudge reads `generatedAt` to *compare*, never to reset. |
| **Regen carry-over + no-baking** (overrides at display boundaries only) | The re-sequence (#2), relabel (#1), and content-floor change are all presentation-layer. The `actOn` descriptor is computed at the projection boundary, never persisted/baked. `autoSent`/`clientStatus` are written only by `sendRecommendation`/`markRecommendationAutoSent` inside their re-reading txns — no fix writes them. A regen-carry-over test (autoSent/clientStatus survive a concurrent regen) is in the gate set, protecting the auto-send writer even while dark-launched. |
| **L6 atomicity** (greenlight + request = one txn) | The tier gate goes **before** the txn (early reject); no Stripe I/O inside it; `dedupe:false` untouched (preserves C2/C3 attribution). |
| **`discussing` overlap** (isCuratedForClient ∩ isActiveRec) | The shared-module extraction is a verbatim move (verified: pure functions, no server deps); the "NOT the complement" comment travels with it. Counter N/M derive from this single source. |
| **Flag-OFF byte-identical** | Every change is additive under `strategy-the-issue`; the `actOn` descriptor is gated exactly like `exposeClientStatus`; auto-send gets a *second* OFF flag. **A flag-OFF byte-identical diff check is a hard gate, with the #1 projection change as the scrutiny target** (assert `actOn` absent when flag off). |

**Definition of Done — gates (all must pass):**
`npm run typecheck` (zero errors, `tsc -b`) · `npx vite build` · `npx vitest run` (full suite) · `npx tsx scripts/pr-check.ts` (zero errors) · `npm run verify:feature-flags` (new child flag grouped, no orphans) · `npm run verify:coverage-ratchet` · **flag-OFF byte-identical diff assertion** (projection `actOn` absent) · **regen carry-over test** (autoSent/clientStatus survive concurrent regen) · cut→POV reflow component test green · `scaled-code-review` skill invoked if any parallel agents used (Critical/Important fixed before merge) · docs updated (`FEATURE_AUDIT.md`, `data/roadmap.json` + `sort-roadmap.ts`, `BRAND_DESIGN_LANGUAGE.md` if UI tokens changed, the spec's decision register).

---

## 8. Why this plan is exceptional + what it deliberately sacrifices

**Exceptional because:** it fixes the universal disqualifier (#1) with the *cheapest correct* shape — server tier-gate + a single server-computed projection descriptor + a relabel — so the client never re-derives pricing (the exact drift that bit the predicate), while splitting the genuinely-multi-day Stripe charge into a fast-follow so launch is never hostage to checkout plumbing. It is the only plan that re-sequences for the buyer's *segment* (local clients let local-visibility lead via Also-on-plan, not a forced content-first), keeps the warm-lead conversation in-card (the soft-yes a high-end firm lives on), and makes the human-curation moat visible at the point of purchase (the byline) — directly serving the retention+expansion thesis. It honors every red-line from all five advisors with verified code anchors, and its decision register has zero TBDs: the only open question (D1 pricing) is framed as an owner choice with a recommended option, two alternatives, and a safe engineer-default if the owner is silent.

**Deliberately sacrifices:** (1) the **Growth à-la-carte revenue capture at launch** — we ship the gate structure but defer the actual charge, accepting that Growth clients greenlight against a "your strategist will confirm scope" request for one fast-follow cycle rather than gate launch on Stripe work; (2) the **portfolio triage queue + greenlight inbox** — Money-Surface's instinct is to fund these now (they're the real expansion ceiling), but at ≤5 launch accounts the operator can run the book without them, so they become launch-adjacent fast-follow #1 rather than launch blockers; (3) the **export one-pager** — the B2B/CMO budget-defense tool is real expansion value but needs a new render path, so the sophisticated-segment upsell waits one PR; (4) the **trust ladder entirely** — dark-launched, not decoupled, accepting we build zero auto-send correctness surface now in exchange for a hard guarantee that no unreviewed move ever reaches a paying client on a timer. The bet: a flawless *manual* money surface that converts and retains beats a half-automated one that occasionally betrays trust — and operator-throughput scaling, while the true ceiling, can follow the proven client surface by a single fast-follow without losing the launch window.

---

**Key files for the implementer (verified, absolute):**
- `/Users/joshuahampson/CascadeProjects/asset-dashboard-strategy/server/routes/recommendations.ts` — act-on route (~L455-557, gate goes at L459 before the L6 txn); `stripEmvFromPublicRecs` (L131) gets the `actOn` descriptor.
- `/Users/joshuahampson/CascadeProjects/asset-dashboard-strategy/server/recommendations.ts` — canonical `isActiveRec` (L662) + `isCuratedForClient` (L681) to extract to `shared/recommendation-predicates.ts` (keep the `discussing`-overlap comment).
- `/Users/joshuahampson/CascadeProjects/asset-dashboard-strategy/server/strategy-issue-cron.ts:213` — `runAutoSendForWorkspace` call to dark-launch behind `strategy-trust-ladder-autosend`; add the count assertion.
- `/Users/joshuahampson/CascadeProjects/asset-dashboard-strategy/src/components/client/the-issue/TheIssueClientPage.tsx` — section re-sequence (#2); ROI/stats collapse to one proof band.
- `/Users/joshuahampson/CascadeProjects/asset-dashboard-strategy/src/components/client/the-issue/IssueContentPlanSection.tsx` — relabel + consequence subline + confirm (#1), content floor → 2 states, in-card "Let's talk".
- `KeywordStrategy.tsx` `issueOverviewEl` (L542-616) — cockpit spine + null projections + cut `ClientRunningOrder` (#4); canonical send model + counter (#5).
- `src/components/.../ClientRunningOrder.tsx` (L33-40) — duplicated predicate (consolidate) / panel (cut from v1).
- `src/components/client/CompetitorGapsSection.tsx` — fabricated rows → one real row or generic placeholder (#6).
- `/Users/joshuahampson/CascadeProjects/asset-dashboard-strategy/shared/types/feature-flags.ts` — add `strategy-trust-ladder-autosend` child flag (OFF), grouped under `strategy-the-issue`.

---

### Team Less-Better (key: `craft`)

All key claims verified. The advisors' ground truth holds: cron auto-send fires synchronously at the same tick (`strategy-issue-cron.ts:213` inside `runIssuePushForWorkspaceInner` right after doorbell), `monetizable` flag already exists in `recommendation-lifecycle.ts:39-53` (content/content_refresh/schema/accessibility = true), the act-on handler at `recommendations.ts:456` does `approveRecommendation` + `createContentRequest` with no tier/price check, and the fabricated rows are at `CompetitorGapsSection.tsx:78-79`. I have everything I need.

---

# RESOLUTION PLAN — Team Less-Better: "The Issue"
### LESS, BUT FLAWLESS — the smallest exceptional surface

## 1. Strategy — the team bet

We are not fixing six things; we are deleting our way to four. The build re-created the clutter the redesign was meant to cure because it treated "never empty" and "more capability" as virtues. We invert that: **the launch surface is the five-beat curation spine plus a single client read in content-leads order, and everything else is cut or dark-launched.** Five of six blockers are copy/reorder/`null`-return/relabel — additive and cheap. The one expensive blocker (#1 pricing) we resolve with a **relabel + tier-gate that touches no Stripe code**, deferring per-item checkout as a fast-follow. The dangerous code (cron auto-send, running-order persistence, the second lens) is *removed at runtime*, not re-architected — cutting is both cheaper and safer here. We spend our remaining craft budget perfecting the one interaction that already makes this feel reimagined: the cut→POV-sentence live reflow, hardened with a staleness flag so partial honesty never reads as total honesty. The whole PR ships behind `strategy-the-issue`, flag-OFF byte-identical, with the trust-critical regen/no-baking invariants untouched.

---

## 2. Per-blocker resolution (all six)

### Blocker 1 — "Act on this" has no price/scope/tier
**Change.** Relabel the CTA and add a tier gate at the **card CTA only** (never a `<TierGate>` wrapper on the whole section), reading the `monetizable` flag already in `REC_POLICY_REGISTRY` (`recommendation-lifecycle.ts:39-53`).
- **Label:** `Act on this` → **`Request this`** (Growth/Free). Premium may read **`Greenlight`**. Edit `evergreenCopy.ts` + the content card.
- **Free tier:** button visible and clickable → tap shows the existing CompetitorGaps `<TierGate>` upsell pattern ("Requesting moves is a Growth feature → See plans"). Never hidden.
- **Growth/Premium:** button → one **inline confirm** (not a modal wall) naming the rec headline + a single honest scope line: *"This adds work to your agency's queue — your strategist scopes and confirms before anything is charged. Nothing is billed at this click."* Confirm → existing `act-on` path (`recommendations.ts:456` `approveRecommendation` + `createContentRequest`) unchanged.
- **Pricing/tier logic lives in the route layer + card** — never inside `mutateRec`/`approveRecommendation` (single-writer flips one axis only).
- Tag the `clientStatus → approved` write with `source: 'the-issue'` for the launch baseline metric.

**Acceptance criteria.**
- A Free user clicks the button and reaches the upsell in one tap; no `act-on` request is created.
- A Growth/Premium user sees a named inline confirm (rec headline + the scope sentence) before any write; cancel writes nothing.
- No tier ever sees an unlabeled commit or an "am I being charged?" state. The word "charge" only appears in the explicit *"nothing is billed"* reassurance.
- `monetizable` is read from a shared export, not re-declared.
- Contract test: act-on against a Free workspace returns the gate, not a created request.

---

### Blocker 2 — Client hierarchy inverted (proof above the plan)
**Change.** Pure JSX reorder in `TheIssueClientPage.tsx` (every section already `<ErrorBoundary>`-wrapped, all hooks run before the return — Rules-of-Hooks safe). New order:
0. Your-turn / pending strip (reuse `ActionQueueStrip`)
1. `NarratedStatusHeadline` + health chip (2 lines, evergreen) — with a one-line **"curated by your strategist"** sub-line (cheap craft signal)
2. **Content plan (the hero)** — `IssueContentPlanSection`, top move emphasized
3. Also on your plan (`IssueAlsoOnPlanSection`, compact, subordinate)
4. **One compressed proof beat** — site stats + ROI/organic value merged into a single band, **collapsed by default** with a visible "see your numbers" affordance
5. What's working (wins strip)
6. Competitor snapshot (thin — see #6)
7. `IssueLoopFooter` — ask-your-strategist + loop status + goal input

Do **not** split proof into two bands above and below. One beat, one location, below the decision surface.

**Acceptance criteria.**
- On a 375px viewport, the **content plan is the first full-width scrollable section** after the status headline.
- ROI numbers require a user action ("see your numbers") to reveal.
- Screenshot diff confirms no section above content except the status headline + your-turn strip.

---

### Blocker 3 — Trust-ladder auto-send fires with no review window
**Change.** **Dark-launch the entire subsystem behind a new sub-flag `strategy-issue-autosend` (default `false`).** Do not re-architect the cron.
- Gate the call at `strategy-issue-cron.ts:213` `runAutoSendForWorkspace(...)` on the flag — one-line hard bail (`if (!autosendEnabled) return;`). The body is already a no-op when nothing's earned; the flag makes the *intent* provable.
- `TrustLadderPanel` (`src/components/strategy/issue/TrustLadderPanel.tsx`) returns `null` when the sub-flag is off (kills two disabled toggles from the empty-wall too).
- **Keep** `runAutoSendForWorkspace`, the store, and migration 144 in place (inert) — reverting a committed migration is riskier than leaving an unused table. **Keep** `markRecommendationAutoSent` / `creditArchetypeCycleOnSend` wired (dead but safe — they route through the single-writer guard).
- Register `strategy-issue-autosend` in `FEATURE_FLAG_CATALOG`, grouped under the `strategy-the-issue` group.

**Acceptance criteria.**
- With the sub-flag off (default): `grep`-verified — `runAutoSendForWorkspace()` is unreachable from any active code path; no `TrustLadderPanel` renders; the cron stamps the week + rings the doorbell + stops.
- With the sub-flag on: existing wired behavior is byte-unchanged.
- `npm run verify:feature-flags` passes with the new catalogued, grouped sub-flag.

---

### Blocker 4 — Admin cockpit is a ~13-section single-scroll wall
**Change.** Collapse `issueOverviewEl` (`KeywordStrategy.tsx`, ~542-616) to the **five-beat spine**: `IssueHeader` → `StanceBar` → `DraftedPovEditor` → (`AddRecommendationModal` trigger) → `BackingMovesQueue` → **Send**.
- Everything below `BackingMovesQueue` moves into **one** collapsible "Supporting detail / Orientation & context" disclosure, collapsed by default: OrientZone, StrategyDiff, CannibalizationTriage (keeper-override stays reachable here), `ContentWorkOrderLens`, competitor deep-link.
- **`KeywordTargetsLens`: delete from this surface.** Replace with a single `Curated keyword targets →` text link into the Keyword Hub at the bottom of `BackingMovesQueue` (not a SectionCard).
- **`ClientRunningOrder`: cut** (also FF — see §4). Render `null`; leave migration 145 + the override store + route inert.
- **Empty projections must `return null`, not render empty SectionCards** — apply the `IssueAlsoOnPlanSection` pattern to `ContentWorkOrderLens` and any remaining projection (early-return `null` when curated input is empty).

**Acceptance criteria.**
- A cold workspace (no curated recs) shows **exactly the 5 spine elements** above the fold at 1280px. **Zero** placeholder SectionCards instructing the operator to "curate moves above." This cold-workspace screenshot is the explicit acceptance artifact.
- The "Supporting detail" region is collapsed on load; one chevron expands it.
- `KeywordTargetsLens` and `ClientRunningOrder` render nothing on the default path.

---

### Blocker 5 — Three competing send surfaces
**Change.** One canonical send model. Staging vs commit:
- Per-row + bulk-select become **staging**: per-row `Stage` / `Add to issue` with a staged checkmark; bulk bar `Stage N selected`. The word **"send" appears in exactly one place**.
- Header **`Send issue`** is the single commit (bulk over `sendableRecIds`, already correct at `KeywordStrategy.tsx:502`).
- **Persistent counter** near Send (not hover-only): **`N staged · M already with client`** — both derived from data in hand (`sendableRecIds.length`; count of `clientStatus==='sent'`). No new state.
- **Disabled Send** uses an **inline reason text node** (not a tooltip — tooltips fail on touch): "Nothing staged yet" / "All curated moves are already with this client", with `aria-describedby` to that node.

**Acceptance criteria.**
- A cold-opening operator identifies the canonical send action in <3s; only `Send issue` carries send language.
- The `N staged · M with client` counter is visible before and after a send and updates live.
- `canSend === false` always renders a visible inline reason; the disabled primary uses `aria-disabled` + `aria-describedby`, never bare `disabled`.

---

### Blocker 6 — Fabricated blurred competitor rows
**Change.** Delete the invented rows at `CompetitorGapsSection.tsx:78-79`. Replace with **one real single row** from actual competitor data when available, labeled "Top competitor" with no blur; otherwise a **single generic placeholder** ("Competitor data appears here once your strategy is generated") — no blur, no invented keyword strings.

**Acceptance criteria.**
- `grep -rn "emergency service near me\|same-day repair" src/` returns **zero** matches.
- No tier renders a blurred row containing invented keyword text. The blur affordance (which signals "we're hiding real data") is gone.

---

## 3. "Act on this" monetization model — OWNER DECISION

All three advisor roles (Client, Admin, Product, Engineer) converged on the same recommendation. **Owner must ratify one before Blocker 1 implementation begins; all three fit the same sprint.** Both acceptable client paths require the *same build* (money-context line + tier-gate + confirm on the card), so the build proceeds regardless; only the copy/quota detail differs.

| | **Option A — RECOMMENDED** | Option B | Option C |
|---|---|---|---|
| **Model** | Relabel `Request this` + tier-gate via `monetizable`. No money changes hands at click; operator scopes/bills out-of-band. Free → upgrade teaser; Growth → request into existing queue; Premium → `Greenlight`, request into queue. | Relabel only + global tooltip, **no tier gate**. | Relabel + tier gate + **build per-item Stripe checkout now**, or a Premium quota counter consuming included allotment. |
| **Stripe work** | **None.** | None. | **Multi-day, net-new** (no per-item checkout route exists today; only subscription Stripe). |
| **Closes free-SKU leak?** | **Yes** (Free can't mint free high-margin work). | **No** — leaves the margin bleed open. | Yes. |
| **Unfreezes the hand?** | **Yes** — "request" reads as conversation, not invoice. | Yes. | Yes, with most CMO trust (price visible). |
| **Cost / risk** | ~0.5 day / **LOW**. | ~1 hr / leaves liability. | Multi-day / payment-plumbing risk. |
| **Verdict** | **The Less-Better launch path.** | Rejected — re-opens blocker. | **Defer to fast-follow** if owner wants real billing. |

**Recommendation: Option A.** It resolves the universal-disqualifier ambiguity AND the margin leak with no payment plumbing. Per-item Stripe (Option C) becomes a clean fast-follow if the owner later wants money to move at click. **The single open decision for the owner is A vs C-now** (B is dismissed). Operationally, the request must route into the greenlight queue regardless of which the owner picks.

---

## 4. Fast-follows — included vs deferred

**INCLUDED in the launch PR** (cheap, de-risks the spine, or completes a blocker honestly):
- **Predicate consolidation** → new `recSendable.ts` (move `sendableRecIds`; reuse server `isCuratedForClient`/`isActiveRec`, shared `isThrottledOpen`). Do **first** — de-risks every other change. Cutting `ClientRunningOrder` deletes its drifting inline copy for free.
- **Content floor → 2 states** in `IssueContentPlanSection` — drop the 4 "evaluating" filler cards + the cross-tier dedup pass (pure subtraction; the demo must never look 80% non-actionable). Two states: curated cards, or one honest line "Your strategist is shaping your next move."
- **In-card "Let's talk"** secondary button on content cards — pre-seeds the advisor with the rec headline (the warm-lead path; today it's a scroll to the footer). Stacks vertically under "Request this" on mobile for 44px targets.
- **POV staleness nudge** — when `struckRecIds` / wording edits diverge from the POV `generatedAt`, show a subtle "Point of view may be out of date — regenerate." (Do **not** extend reflow to all fields — multi-day, fragile. The nudge is the honest, cheap guard against partial-honesty-read-as-total.)
- **`ARCHETYPE_ACCENT` unification** — one accent source for `StanceBar` + `BackingMovesQueue` (today `authority_bet` is teal in one, blue in the other — breaks color-as-wayfinding).
- **"Curated by your strategist" byline** — one sub-line on the status headline (no new component).
- **Accessibility (launch blockers, not fast-follows):** StanceBar per-segment `aria-label` + visible/focus archetype names (not `title` on divs); 44px touch targets on card CTAs; disabled Send `aria-describedby`.

**DEFERRED** (with rationale):
- **Portfolio/triage queue off `POV_UNCHANGED`** + **greenlight operator inbox** — net-new surfaces; **gate multi-account rollout, not single-account launch.** Flag explicitly: do these **before any sales push / before ~5-10 clients** (FF1 priority). The `POV_UNCHANGED` signal already exists; surfacing is cheap when it lands.
- **Per-item Stripe checkout** — only if owner picks Option C (§3).
- **Full POV honesty on all fields** (rec-linkage on situation/wins/flags) — hard; the staleness nudge covers the trust risk now.
- **Outcome/export one-pager** + **funnel/pipeline layer** — real budget-defense need, wrong phase, ~2-week build.
- **External client-facing name lock** — before any external demo/marketing.
- **Batch-undo for bulk strikes** — add when bulk volume actually hurts.
- **Running-order reorder UI** — substrate stays dormant (migration 145 + store inert) for clean re-enable.

---

## 5. Scope + explicit OUT-OF-SCOPE

**IN SCOPE (one launch PR, one phase):** the six blockers + the seven launch-included fast-follows above + the new `strategy-issue-autosend` sub-flag + the two success metrics instrumented.

**OUT OF SCOPE (explicit — do not piggyback):**
- Any Stripe / per-item checkout code (unless owner ratifies Option C, which then becomes its own PR).
- Portfolio triage queue, greenlight inbox, export one-pager, funnel layer.
- Re-architecting the cron into a second deferred tick + veto hold (we dark-launch instead).
- Reverting migrations 144/145, deleting `runAutoSendForWorkspace`/store/route, or removing the `sort_order` substrate.
- Extending the POV reflow to situation/wins/flags.
- Any new net-new client *feature* (the six are fixes, not features).
- Touching `recommendation-lifecycle.ts` beyond *reading* it.

---

## 6. Sequencing — launch PR vs fast-follow + effort sizing

**Gate 0 (blocking):** Owner ratifies the §3 register (A vs C-now). Implementation of Blocker 1 does not start until answered.

**Launch PR — single phase, ~2.5–3 days, in this order (each step de-risks the next):**
1. **Predicate consolidation** (`recSendable.ts`) + **cut `ClientRunningOrder`** — kills the worst duplication. ~2-3 hrs.
2. **Dark-launch trust ladder** (sub-flag at cron:213 + `TrustLadderPanel`→`null`) — removes the unsafe path first. ~1-2 hrs.
3. **Cockpit spine collapse** + `null` empty projections + drop `KeywordTargetsLens`. ~1 day.
4. **Fake competitor rows** (#6) — early, 30-min high-trust win. ~1-2 hrs.
5. **Canonical send model** + `N staged · M with client` counter + disabled reason (#5) — depends on the final spine from step 3. ~0.5-1 day.
6. **Client re-sequence** (#2) + **content floor → 2 states** + competitor placeholder — isolated to client component. ~0.5 day.
7. **"Request this" relabel + tier-gate** (#1, Option A) — last; needs the ratified option. ~0.5 day.
8. **Soft-yes "Let's talk"** + **POV staleness nudge** + **`ARCHETYPE_ACCENT` unification** + **a11y** + **byline**. ~0.5 day.

**Fast-follow PRs (post-merge, ordered by revenue impact):** FF1 portfolio triage queue + greenlight inbox (before any scale/sales) → FF2 per-item Stripe (only if Option C) → FF3 export one-pager → FF4 external name lock → FF5 full POV honesty.

---

## 7. Risk — how the strong core, flag-OFF, and invariants are preserved

- **Cut→POV-sentence live reflow (the signature):** untouched. Every fix works *around* `DraftedPovEditor`, not through it. The staleness nudge is additive (reads `generatedAt` vs `struckRecIds`); it does not alter the reflow path. **Explicit acceptance test required** for any PR touching `DraftedPovEditor`: operator cuts the lead backing move → its POV sentence vanishes before save.
- **Lost-keystroke guard:** draft reset stays keyed on `generatedAt` **only**. No refactor may re-key it on `version`/`editedAt` — called out so a reviewer catches it.
- **Archetype shortlist (cap 5 + show-more):** preserved; the spine collapse does not touch it.
- **Flag-OFF byte-identical:** every change stays inside the `(theIssueEnabled && …) ? … : null` branches; `TheIssueClientPage` never mounts flag-off. **Re-run the byte-identical assertion after every step.**
- **Trust-critical regen carry-over + no-baking:** overrides apply at display boundaries only, never baked. The `StanceBar` color fix and the POV staleness nudge persist **no** derived state. `mutateRec` single-writer atomicity, `creditArchetypeCycleOnSend`, and `markRecommendationAutoSent` are **read-only verified untouched** — pricing/tier logic lives in the route layer + card, never in the writer. Dark-launching auto-send leaves the credit chokepoint at `sendRecommendation` in place (harmless when flagged off).
- **Cron safety:** the one-line flag bail at cron:213 is strictly subtractive at runtime — the lowest-risk, highest-safety-ROI change in the plan.

---

## 8. Why this plan is exceptional — and what it deliberately sacrifices

**Exceptional because** it turns the report's biggest liabilities into *deletions*: the dangerous cron path, the second persistence layer, the redundant lens, and the filler cards all leave the runtime instead of getting "managed." The single expensive blocker is defused with a relabel + a flag the codebase already supports (`monetizable`), so the launch ships **no new payment risk**. The cold-workspace acceptance artifact (zero empty SectionCards) and the byte-identical re-run after every step make regressions visible, not latent. And the one thing that makes this feel reimagined — the cut→POV live reflow — is not just protected but *hardened*, so its partial honesty can never be mistaken for total honesty.

**Deliberately sacrificed:** at-click billing (deferred to Option C / FF), the running-order steering knob, the trust-ladder automation, the second proof band, the relevance-thumbs row, multi-account portfolio triage, and full POV honesty-on-all-fields. Each is a real capability — but each is YAGNI at solo-agency scale, a trust liability, or a clutter source, and shipping the smallest *flawless* surface beats shipping a larger ambiguous one. The funded-segment funnel/pipeline layer is the one genuine gap we accept at launch: this PR proves the curated POV + the relationship; the funnel earns the funded tier's budget defense next.

---

**Files the implementer touches (all verified to exist):** `src/components/client/the-issue/{TheIssueClientPage,IssueContentPlanSection,IssueContentCard,evergreenCopy}.tsx/.ts`; `src/components/client/CompetitorGapsSection.tsx` (rows at lines 78-79); `src/components/KeywordStrategy.tsx` (~502, 542-616); `src/components/strategy/issue/{ClientRunningOrder,TrustLadderPanel,KeywordTargetsLens,StanceBar,BackingMovesQueue,DraftedPovEditor}.tsx`; `server/strategy-issue-cron.ts:213`; `server/routes/recommendations.ts:456-558`; `shared/types/feature-flags.ts` (new `strategy-issue-autosend` sub-flag, grouped); new `recSendable.ts`. **Read-only (do NOT modify):** `server/recommendation-lifecycle.ts` (single-writer + `monetizable` registry).

**Definition of Done / gates (every PR):** `npm run typecheck` · `npx vite build` · `npx vitest run` (full) · `npx tsx scripts/pr-check.ts` · `npm run verify:feature-flags` (new sub-flag catalogued + grouped) · `npm run verify:coverage-ratchet` · **flag-OFF byte-identical assertion re-run** · **cut→POV live-reflow manual + test verification** · `runAutoSendForWorkspace()` grep-verified unreachable on the default path · **cold-workspace screenshot showing zero empty SectionCards** · `grep "emergency service near me\|same-day repair"` returns zero · "Request this" verified at all three tiers · live `N staged · M with client` counter verified before/after a send.

---
