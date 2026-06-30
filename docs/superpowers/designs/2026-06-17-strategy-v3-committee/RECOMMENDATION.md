# Strategy v3 — Committee Synthesis & Recommendation

**Date:** 2026-06-17
**Role:** Synthesis chair (aggregating three lens judges over three designs)
**Inputs:** [design-A-lean.md](./design-A-lean.md) · [design-B-platform.md](./design-B-platform.md) · [design-C-product.md](./design-C-product.md) · three judge scorecards (feasibility, product-ux, architecture)

---

## 1. Score tally

| Design | Feasibility | Product-UX | Architecture | **Total** | Rank-1s | Ever-last? |
|---|---|---|---|---|---|---|
| **A — lean / reuse-maximal** | **9** | 7 | 7 | **23** | 1 (feasibility) | **No** |
| **C — product / engagement** | 7 | **9** | 7 | **23** | 1 (product-ux) | Yes (architecture) |
| **B — platform / architecture-first** | 6 | 7 | **9** | **22** | 1 (architecture) | Yes (feasibility) |

Per-lens rankings:

| Lens | 1st | 2nd | 3rd |
|---|---|---|---|
| Feasibility & risk | **A** | C | B |
| Product / UX | **C** | B | A |
| Architecture | **B** | A | C |

**Aggregate ordering: A ≈ C (23) > B (22).** The tie between A and C is broken below.

---

## 2. Winner: **Design A (lean / reuse-maximal), with grafts from B and C**

### Why A wins the tie with C (and the field)

A and C tie on raw points (23 each), but **A is the only design no judge ranked last**, and it wins on the single dimension that the founder's own steer makes load-bearing.

1. **It honors the audit's central, code-verified finding and Josh's explicit steer.** The audit says this is "~75–80% reframing + finishing the send-to-client spine… not a major shift," and Josh asked for **"just a flag/status through the intelligence engine."** A is built around exactly that: one new lifecycle field, one generic curate endpoint, re-home the orphaned leaves, and generalize three already-proven mechanisms (the cannibalization send adapter, the keyword-strategy PATCH path, the declined-keyword synthesis suppression). The feasibility judge verified the load-bearing facts against the repo and confirmed A's "reuse, don't rebuild" phasing is the best-grounded of the three.

2. **Fastest, lowest-risk path to client value.** A ships client-visible value in **Phase 1 with zero net-new infra** — re-homed cannibalization send works day-one because the adapter + renderer already exist (`cannibalization.ts`, `content-decay.ts`, `RECOMMENDATIONS_UPDATED` at `ws-events.ts:135`). The two genuinely net-new pieces (the Fork-B overlay, the lifecycle field) are quarantined behind proven quick wins, and the trust-mirage gate (overlay P4a must land before managed-set UI P4b) is respected.

3. **It is never the architectural or product *loser*.** C is ranked last on architecture (it under-builds the engine layer and inverts its dependency graph by shipping the client storefront before the curation engine that feeds it). B is ranked last on feasibility (it reframes an 80%-built reframe as "the moment we install the recommendation-lifecycle substrate," adding a net-new single-writer service, a policy registry, and two XL phases — over-engineering against the steer). A's worst placements are a 2nd (architecture) and a 3rd (product-ux) — and both of those weaknesses are *graftable fixes from B and C*, not structural rebuilds.

### A's one real, must-fix weakness (the graft target)

All three judges independently flagged the **same** architectural flaw in A, and it is the most important thing this synthesis carries forward:

> **A folds `struck`/`throttled` into the `RecStatus` union** (the same axis the merge/auto-resolve/summary machinery reads) and patches the collision with literal `if (rec.status === 'struck') continue;` guards at the two auto-resolve loops. **B and C both adopt the structurally safer firewall: keep strike/throttle on a *separate* axis the loop cannot see.**

The code is unambiguous on why this matters: `resolveRecommendationsForChange` (`recommendations.ts:484`), the second auto-resolve loop (`:572`), `computeRecommendationSummary`'s active filter (`:600`), and `buildMergeKey` carry-over all branch on `RecStatus`. Overloading that union means **every future status-reader becomes a place a struck rec can silently leak as "✓ done" to the client** — the exact trust-destroying "done"-lie the audit's #1 risk and the locked north star warn against. The product-ux judge further verified A undercounts the guard surface: it claims "two one-line guards" but there are **at least three filter sites (484, 572, 600) plus merge carry-over branches (≈2376/2392) plus a `validateTransition` edge.**

**This is the #1 graft (below). We take A's phasing and reuse discipline, but we replace A's RecStatus-overloading with B/C's separate-axis model before any code ships.**

---

## 3. Grafts — the best ideas from the runners-up to fold into A

These are the concrete improvements the synthesis pulls from B and C into the A-based spec. They are ordered by importance.

### Graft 1 (CRITICAL — from B and C) — Strike/throttle live on a separate axis from `RecStatus`, not inside it

Replace A's `RecStatus = … | struck | throttled` with a **dedicated client-lifecycle field decoupled from `RecStatus`** (B calls it `RecLifecycle`; C calls it `RecClientStatus` — same idea). `RecStatus` keeps its execution meaning (`pending|in_progress|completed|dismissed`); the curation/delivery axis is a separate optional field (absent ⇒ `system`, preserving flag-OFF byte-identical behavior). A struck rec keeps `RecStatus='pending'` and is filtered out **by lifecycle before the status loops run**, so it can *never* be swept to `completed` by `resolveRecommendationsForChange`. This solves the audit's #1 risk by **separation rather than by guards** — strictly more robust, and it removes the leaky-abstraction debt A would otherwise thread through every status-reader. (A already plans `clientStatus` for the client side; this graft simply moves `struck`/`throttled` onto that same separate axis instead of overloading `RecStatus`, collapsing A's slightly muddled two-place model into one clean axis.)

- **Verification gate (from C):** an integration test that strikes a keyword-gap rec, runs a regen, and asserts the rec is NOT `completed` **and** is absent from the curated client projection.
- **Keep from A:** the *cascade* mechanism is still A's soft/reversible, type-routed cascade — keyword/cluster/local recs write a `keyword_feedback` declined row (reversible by deleting it); CTR/technical/decay recs are a plain lifecycle strike. A and B and C all agree on this; only the axis placement changes.

### Graft 2 (from B) — A single-writer lifecycle module + a per-RecType policy registry

A wires existing seams (good for velocity) but answers "will this scale to future rec types without rework?" worse than B. Fold in B's **single-writer `recommendation-lifecycle.ts`** (the one place lifecycle is mutated — mirroring how `send-to-client.ts` is the single deliverable writer; route handlers never touch the field directly) and the **per-`RecType` policy registry** (`cascadeOnStrike`, `outcomeActionType`, `sendOpensThread`, `clientSurface` as one row per type). This makes the next rec type *a policy row, not a five-site edit* — directly attacking the drift the audit documents (`useShowMore` implemented twice, cannibalization double-rendered).

- **Right-size it (heed B's own YAGNI tension + the feasibility judge):** adopt the single-writer + policy registry as the encapsulation boundary, but **do not** also adopt B's full 8-state lifecycle ceremony or pre-commit the entire registry skeleton in a heavy contracts-only P0. Seed the registry with only the rec types that need differentiated cascade *today* (keyword_gap, topic_cluster, content_decay, cannibalization, technical) and let it grow. This keeps A's lean phasing while capturing B's extensibility win where it is cheapest.

### Graft 3 (from B) — ONE overlay model honored by ALL regenerated sets

A's Fork-B resolution ("generalize the declined filter + add a kept-pin list") is correct but, as both the feasibility and architecture judges note, A *understates* it: the existing post-gen hard filter (`keyword-strategy-ai-synthesis.ts`, the real `.filter()` C correctly located near `:1519/:1521`) covers **`siteKeywords` only** — clusters and opportunities need net-new reconciliation. Fold in B's cleaner framing: **one `strategy_set_overlay` table (set-kinds: `site_keywords` | `topic_clusters` | `opportunities`)** with a **pure, unit-testable `applyOverlay(generatedSet, overlay)`** function at the synthesis output boundary, honored by every regenerated set, and explicitly **subsuming the cannibalization keeper-override roadmap item** as one more consumer (don't build two). C's grounding detail is the most accurate substrate claim and should be cited in the spec: the overlay "rides a filter that already works."

- **Re-rate the effort honestly:** the cluster + opportunity reconciliation and the kept-pin guarantee are net-new with no precedent — this is **M-to-L**, not M. Keep A's gate (overlay phase lands before any managed-set UI) with a `Refresh-preserves-curation` test as the phase's exit criterion.

### Graft 4 (from C) — Treat the client overview as a *product*, with explicit texture and per-risk verification gates

A's curated overview is functionally correct but the thinnest on product texture (the product-ux judge's core demerit). Fold in C's concrete client-experience design, which costs almost nothing on top of A's already-planned `RecommendedThisMonth` component:

- **Card story:** the literal `why → result → one action` card layout (Approve / Add·$ / Discuss), EMV stripped to `impactBand` only, teal CTA, no purple (`grep -r "purple-" src/components/client/` gate).
- **Finite header micro-story:** "3 things we recommend this month · 1 approved · 1 in discussion" — a satisfying finite progress line, not a count of 144.
- **Action-oriented empty state:** "Your strategy is on track this month — nothing needs your decision right now."
- **Additive Fork-C resolution made explicit + named snapshot test (C's Risk C):** keep the existing `/api/public/recommendations/:id` endpoint **unchanged** (verified read at `InsightsEngine.tsx:159-161`), add a **separate** `/curated` read; flag-OFF byte-identical, asserted by a flag-OFF snapshot test on the public endpoint. This is the same additive resolution A already chose, but C's named-gate discipline is the graft.
- **Monetization spine grounded in real Stripe wiring (C's Risk E):** rec → send → Approve / Add·$ (existing per-item Stripe Checkout) → approved → work spawn → invoice, with the **rate/denominator law** respected (any "1 approved of 3" shares the single curated-projection source).

### Graft 5 (from C) — Inline pointers as wayfinding chips, and D4 framing-signal honesty

- **Inline pointers** (`<InlinePointer count={n}>` "💡 1 recommendation here →") deep-linked via `?rec=<id>` (two-halves contract) are explicitly a **wayfinding breadcrumb, not a second render** — dodging the double-render hazard. A and C agree; adopt C's explicit framing.
- **D4 framing-decline honesty caveat (C's standout judgment):** model "client declined a *framing*" as an **advisory `workspace-learnings` entry, NOT a new `OutcomeScore`**, so the EMV-calibration math stays authoritative and uncontaminated. This respects the deterministic-first eval law and is the sharpest understanding of the outcome-tracking boundary in the committee — fold it into A's D4 wiring verbatim.

---

## 4. Dissent / minority views worth preserving

1. **The architecture judge's dissent (B should win).** On a pure architecture-and-maintainability lens, B scored 9 and won decisively, because it makes the orthogonal-axis call *and* builds the only real scalability mechanism (single-writer service + policy registry). The synthesis does **not** adopt B as the base — its feasibility cost (net-new single-writer subsystem, policy registry, two XL phases, slower-to-value) is judged too high against an 80%-built codebase and Josh's "just a flag" steer. **But the dissent is honored structurally:** Grafts 1 and 2 import B's two best ideas (separate axis + single-writer/policy registry, right-sized) into the A base. If, during build, the policy registry proves it's carrying real weight (≥4 rec types with genuinely differentiated cascade), revisit promoting more of B's substrate.

2. **The product-ux judge's dissent (C should win).** On the client-engagement lens, C scored 9 and won, because it is the only design that treats the locked north star (curated, engaging, NOT a firehose) as the *central product problem*. The synthesis honors this via Graft 4 (the full client-experience texture) and Graft 5. **One C idea is deliberately NOT grafted wholesale:** C's admin "This month's client view" preview panel (§2.2) is net-new admin surface the audit never scoped, and C's "Curation health strip" rebuilds the verified-existing `StrategyStalenessNudges.tsx` that A and B correctly reuse. **Carry the preview-panel idea as a P6/post-MVP nice-to-have, not an MVP requirement** — the operator narrative-control "wow" is real, but it is the cheapest thing to defer and the leanest base should not pay for it up front. The staleness/curation-health surface should **reuse `StrategyStalenessNudges`, per A/B**, not rebuild.

3. **Shared inaccuracy flagged by ALL THREE judges — #8a is cheaper than every design claims (verified).** All three designs assert `strategyCardContext` is "MISSING from `FixContext` / `StandaloneContentBriefGenerationParams`." The synthesis chair **verified against the repo that this is false:** `strategyCardContext` already exists at `server/content-brief.ts:1123`, is consumed at `:1380`, and is populated at `server/content-brief-generation-job.ts:339-377`. **#8a is therefore an M-overstatement in all three plans — re-rate it down to S/M** (the field exists; the remaining work is the one gap/rec→context mapper at the handoff sites, not adding the field to the params). Fix this in the spec so the executor doesn't budget phantom work.

4. **C's effort optimism (preserve as a phasing caution).** Two judges flagged that C's Phase 3 (storefront + `/curated` endpoint + Stripe + Layer-2 flip + inline pointers + work-spawn) and Phase 6 (cron + supersession + 3 outcome wirings + 3 send types) are each really 2–3 PRs rated as one L. **When grafting C's client-experience scope into A's P5, keep A's instinct to sub-split** — and note A's own P5 is already over-packed (storefront + Fork-C flip + D4 + supersession + brief pre-seed + signal-fold + #6b); it should be sub-split in practice regardless. This is a planning caution to carry into the implementation plan, not a design defect.

---

## 5. Recommended path forward

**Base the spec on Design A (lean / reuse-maximal),** preserving its thesis ("v2 command-center *finished*, send spine threaded through"), its reuse inventory, its fastest-to-value phase ordering, and its byte-identical flag-OFF discipline under the existing (OFF) `strategy-command-center` flag — **with the five grafts above folded in.** Concretely:

1. **Before any code:** rewrite A's §2.0 to put `struck`/`throttled` on the **separate client-lifecycle axis** (Graft 1), collapsing A's two-place model. This is non-negotiable — it is the one flaw all three judges independently caught.
2. **Adopt B's single-writer `recommendation-lifecycle.ts` + a right-sized per-`RecType` policy registry** (Graft 2) as the mutation boundary — seeded with today's rec types only, not a heavy contracts-only P0.
3. **Adopt B's one `strategy_set_overlay` model + pure `applyOverlay()`** honored by all regenerated sets and subsuming the cannibalization keeper-override (Graft 3); re-rate the overlay phase **M→L** and keep A's "overlay before managed-set UI" trust-mirage gate.
4. **Fold C's client-experience texture, additive Fork-C resolution with named snapshot test, grounded Stripe monetization with the rate/denominator law, inline-pointer wayfinding, and the D4 framing-signal-as-advisory honesty** (Grafts 4–5) into A's P5 — and **sub-split A's P5** (it is over-packed).
5. **Reuse `StrategyStalenessNudges` for the staleness/curation-health surface** (per A/B); carry C's admin preview panel as a deferred P6 nice-to-have, not MVP.
6. **Correct #8a down to S/M** — `strategyCardContext` is already wired (verified `content-brief.ts:1123/1380`, `content-brief-generation-job.ts:339-377`); only the gap/rec→context mapper at the handoff sites remains.

**Verification gates to carry into every phase** (the committee's collective best practice): strike-never-`completed` integration test (Graft 1); `Refresh-preserves-curation` overlay test (Graft 3); flag-OFF byte-identical public-endpoint snapshot test (Graft 4); and the `?tab=`/`?rec=` two-halves deep-link contract for the inline pointers (Graft 5).

**Net:** A gives us the safest, fastest, most steer-faithful spine; B's separate-axis firewall and single-writer/policy registry remove A's one real architectural debt and buy future-rec-type extensibility cheaply; C's product texture and per-risk gates make the client surface the engaging storefront the north star actually demands. The recommended spec is **A-with-B's-substrate-discipline-and-C's-product-skin.**
