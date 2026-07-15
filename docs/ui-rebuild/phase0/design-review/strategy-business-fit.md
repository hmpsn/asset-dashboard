# Design Review — Business Fit: Is This the Right Build for hmpsn.studio?

**Reviewer seat:** Strategy / business-fit (advisory, no code changes)
**Date:** 2026-07-02
**Question:** Is the proposed UI Rebuild Kit (`hmpsn studio Design System/`) the right platform build for a solo-founder SEO/web-analytics agency whose model is 3 tiers (Free/Growth/Premium) + per-item content purchases + 14-day trial, and whose retention thesis is "The Issue" verdict-first client feed?

## Verdict

**Right build with corrections — the admin half is right; the client half has the retention thesis nailed on one screen and the revenue model designed on zero screens.**

The admin rebuild is a genuine solo-operator fit: the `Today` home collapses four triage systems into one cross-client work queue with an explicit monetization-plays stream, the scope×audience surface model matches how a one-person agency actually curates and sends, and the 18-surface map lines up with the pending roadmap (Local Presence, AI Visibility, Recommendations, Outcomes). The client Overview mockup is a faithful, high-quality implementation of the Issue spec's trust spine. But the kit treats monetization as prose, not design: tier gates, trial, per-item purchase, and upgrade moments — the entire client-side revenue machinery that pays for the business — have no designed home in any kit artifact, the parity instrument is blind to them, and the one client the mockup renders is shown receiving Premium-level service under a Growth badge. Correct those and this is the right build.

---

## Findings

### F1 — BLOCKER · The client-side monetization machinery has no home anywhere in the kit

The business model (MONETIZATION.md: Free $0 / Growth $249 / Premium $999, per-item briefs & posts, 14-day trial, UX soft-gating via `<TierGate>`) is entirely absent from the rebuild's design artifacts:

- **18-surface map** (UI Rebuild Handoff Brief, Part 2): the two client-facing surfaces are "Recommendations" and "Client portal." There is no surface — client or admin-composed — for plans, upgrade, trial, checkout, or per-item purchase.
- **Platform Parity Ledger** ("every live function's home, same or better"): zero matches for `cart`, `checkout`, `purchase`, `Client portal`, `Plans`, `trial`, `TierGate`. Its only Stripe rows are admin-side (Settings config, Revenue dashboard, content-subscription plan CRUD in `mockup/pipeline.js:476-539`). The instrument that is supposed to prove "nothing today may be lost" cannot see the client revenue surface at all.
- **Client Dashboard Mockup.html** (47KB): the only monetization artifact is a static "Growth plan" badge. No locked state, no trial banner, no upgrade moment, no purchase flow. `grep` for tier/upgrade/trial/unlock returns one placeholder sentence.
- **Content & Access Conventions**: the permissions matrix is **role-based only** (Operator / Admin / Client). The platform's real access model is role × tier × trial — server-side it is elaborate and live (`computeEffectiveTier`, trial-aware; see FEATURE_AUDIT.md #522's server-authoritative cpc tier gate, and the Issue act-on route's `403 { requiredTier: 'growth' }`). A single microcopy example ("Keyword strategy is on the Growth plan." + path) is the only trace of tiers in the whole conventions doc.
- **Client Dashboard Plan.html** is the one place monetization is addressed — and only as direction: "Plans & ROI stop being standing tabs. Upgrade math appears at the ceiling — when a client hits a tier-gated quick win… the value case is right there." That is the *right* direction (it matches the Issue spec §D: "make the upsell a transparent ROI math problem, not a sales pitch"), but no ceiling moment, gate state, or value-math component is designed anywhere. The direction has no artifact.

**Why blocker:** the Phase 0 mandate is additive-only parity, and losing a function is a hard stop. The functions most likely to be lost by omission are precisely the ones no ledger row, no surface, and no mockup covers — and they are the ones that produce revenue. A rebuild executed off these artifacts as-is would ship a client dashboard with the paywall designed out of it.

**Correction:** (a) add a tier axis to the Content & Access permissions matrix and to Handoff Brief template field 5 (the "locked" state must specify *which tier* locks and what the upgrade moment shows); (b) add parity-ledger rows for TierGate/trial/Plans/ROI/cart-checkout/content-purchase with explicit homes; (c) design the "ceiling" upgrade moment and the per-item "Request this" → priced/included/locked descriptor (the server already ships `actOn: { mode: 'included'|'priced'|'locked', requiredTier }` — FEATURE_AUDIT B1) as first-class components before any client surface is built.

### F2 — MAJOR · The client mockup renders Premium-tier service semantics under a Growth badge

The mockup's client is "Bayview Dental · **Growth plan**", yet the Overview shows: "**Your turn — 2 approvals**", "**Curated by your strategist**", and an "**Ask your strategist**" chat entry (Client Dashboard Mockup.html, header + `renderOverview()`). Per MONETIZATION.md, Growth is explicitly the **zero-human-touch** tier ("pure SaaS margin with zero human touch… No requests, no approvals, no team hours"); SEO change approvals and strategist touch are the Premium value proposition ($999/mo with 3 included hours). Built as-is, the design either (a) over-promises founder labor at $249/mo — fatal for a solo operator whose scarce resource is exactly that labor — or (b) silently redefines the tier structure without an owner decision. Either the mockup's badge/copy must change, or MONETIZATION.md must, deliberately. (Sample copy is declared "indicative" in the Handoff Brief, but this is not copy drift — it is the service model of the surface.)

### F3 — MAJOR · Three conflicting client IAs live inside the kit, and one of them is already ratified and shipped

- **Shipped + owner-ratified (flag-ON, "The Issue")**: Overview · Inbox · Results · Deep Dive (+Settings) — the kit's own Client Surface Sweep calls it "the current, *correct* design… **The current one already won** — finish the cutover, don't redesign."
- **Client Dashboard Plan** proposes: Overview · Performance · Strategy · Inbox.
- **Client Dashboard Mockup** builds: Overview · Performance · Deep Dive · Inbox · **Brand** (five tabs, four of which are `placeholder()` stubs).

The Handoff Brief correctly gates this behind the Phase 0 "client dashboard decision (new vs reuse/evolve)" — good. But the kit's artifacts pull in three directions, and the Sweep's diagnosis of the platform's #1 client-surface disease is *exactly* "the new thing was built beside the old thing and the old thing was never retired" (CL1–CL5: load-bearing flag, ROI/Results fork, orphaned tabs). A fresh third IA risks repeating that pattern at larger scale and relitigating a decision the owner ratified in June 2026. **Correction:** the Phase 0 decision should default to the Sweep's own recommendation — finish the Issue cutover and *evolve* it with the mockup's genuinely additive ideas (the hero verdict band, the "Request this" move cards, Brand-as-trust-panel) — with "net-new parallel client shell" carrying the burden of proof.

### F4 — MAJOR · The client-dashboard decision would be made off one designed screen

In the mockup, only the Overview is real; `placeholder(k)` returns stub cards for performance/deepdive/inbox/brand ("Building this next — the Overview sets the pattern"). But the retention thesis is not Overview-only: the Issue spec's non-negotiable #3 (the "what needs ME" queue with an explicit "nothing needed" state) lives in Inbox; the trust guards around approvals/reviews (professional-services persona: "I'd churn over a single embarrassing piece") live in Inbox; and the pay-more moments (F1) live mostly *outside* Overview (quick wins at the gate = Strategy/Deep Dive; call-tracking upsell = Performance). Signing off a client-dashboard direction on the verdict screen alone is signing off the easy 20%. The Client Dashboard Plan itself says the Overview is "the whole bet in one screen" for *hierarchy* — it is not the whole bet for *revenue* or the *action loop*.

### F5 — MAJOR · What the rebuild does not solve: retention lives off-dashboard, and the kit is dashboard-only

The Issue spec §F is unambiguous: "**Do not design for habitual logins. Nobody at any segment will build the habit.** The dashboard is where you land from a notification." The two universal retention mechanics are (1) event-driven push tied to money/customers/blocked decisions and (2) the forwardable zero-edit export. The kit covers the export (the mockup has "Generating a shareable PDF of your results") but nothing else in the return loop: no notification/email design, no push-cadence surface, and the roadmap's own pending items in this loop (platform-wide email preference center + CAN-SPAM; The Issue P1 named-record reconciliation — the #1 trust guard, "numbers must reconcile with the client's own reality") are untouched by, and unmentioned in, the rebuild. This is not a defect of the kit so much as a scope truth the business plan must hold: **the rebuild polishes the room clients visit once a month; the thing that brings them back is not in scope.** It should be named in the plan so the rebuild isn't mistaken for the retention investment.

### F6 — MINOR · Free-tier and trial client experience is undesigned

The mockup assumes a fully-populated Growth workspace. The Free tier is the top of the funnel (MONETIZATION.md: "Free tier costs zero team effort… every insight naturally pushes toward Growth") and the 14-day trial is the conversion window — neither has a designed client view, an establishing state, or a trial-countdown moment. The Surface Model designs cold-start beautifully for the *admin* cockpit ("Cold start = onboarding, not empty") but there is no client-side equivalent. The Client Dashboard Plan's A5 ("on the free tier half the tabs have no data — a navigation tax") names the problem and then the mockup doesn't address it.

### F7 — MINOR · Opportunity-cost sequencing: an 18-surface re-presentation ahead of pending revenue features

`data/roadmap.json` pending items include the Strategy v3 **paid-topic monetization spine** (deferred), the entire **Self-Service & Growth** sprint (5/5 pending: self-service Webflow/GSC/GA4 onboarding, marketplace listing — the scale levers for a solo founder), implementation-hours tracking (Premium allowance), and the post-subscription welcome moment. The rebuild is explicitly "a re-presentation, not a reduction" (Handoff Brief) — zero new capability by mandate. That's a defensible engineering posture, but for a solo founder it means the calendar cost of 18 surfaces is paid before any conversion feature ships. **Correction:** sequence the fan-out so client-facing + monetization-adjacent surfaces (Client portal, Recommendations, Pipeline) land early, and keep the rebuild from becoming a freeze on revenue work.

### F8 — PRAISE · The admin IA is a genuine solo-operator design, not ceremony

- `mockup/home.js` header comment: "Replaces WorkspaceHome's 9 stat cards + FOUR separate triage systems with ONE unified work queue, organized around the operator's real question: WHAT SHOULD I WORK ON TODAY?" — with three streams, one of which is explicitly "**What monetization plays can grow revenue — ours and the client's**", and provenance-aware money chips (estimate → measured → actual) forward-compatible with the Reconcile ladder.
- The Surface Model's scope×audience grid + "send boundary" + graduation path ("a technical fix only graduates into the Engine when it becomes a proof point") is exactly the curation workflow The Issue shipped (curate → stage → send), and it kills the cross-client/within-client navigation confusion at the model level.
- Consolidations (Keywords 2→1, Site Audit 3→1) reduce, not add, operator surface area. This is the opposite of ceremony.

### F9 — PRAISE · The client Overview is a faithful build of the Issue spec's spine

The mockup's own code comment says it: "`══ OVERVIEW = THE ISSUE ══`". Slot by slot against the spec (Part 1 §B): the dollarized verdict with baseline ("~$18,400/mo · 4.6× your retainer · 59 new-patient actions, up from 21 since we started"), outcome counts in human units ("41 calls · 12 form fills · 6 bookings"), the "Your turn" decision queue leading the page, outcome-tagged shipped work ("Published 'Same-day crowns in Austin' — calls +3.1 · ≈ $960 in added new-patient value"), competitor framing by named local rivals, and a shareable-PDF export. Estimate-labeling discipline (the `~` and `≈`) is present. This is the retention thesis rendered correctly — the correction load is everything *around* this screen, not this screen.

### F10 — PRAISE · Roadmap alignment of the surface map is strong

The 18 surfaces include Local Presence (`local.js`, `local-reviews.js`, `local-setup.js` → GBP sprint, Intelligence Quality local items), AI Visibility (`aivis.js` → pending AI-visibility client KPI), Recommendations, Outcomes, Competitors — each matching a pending or active sprint in `data/roadmap.json`. The rebuild will not strand the current program of work; it gives its outputs better homes.

---

## Recommendations (ranked)

1. **Design the tier layer before any client surface is built.** Add a tier×trial axis to the Content & Access permissions matrix and Handoff Brief field 5; add parity-ledger rows for TierGate, trial, Plans/ROI, cart-checkout, and per-item purchase; design the "upgrade at the ceiling" moment and the included/priced/locked act-on states as system components. (F1)
2. **Resolve the Growth-badge / strategist-touch contradiction explicitly** — either fix the mockup's tier semantics or deliberately revise MONETIZATION.md; do not let a build agent inherit the ambiguity. (F2)
3. **Make the Phase 0 client-dashboard decision default to "finish the Issue cutover and evolve it"** per the kit's own Client Surface Sweep; require the net-new shell option to prove it won't recreate the build-beside-never-retire pattern (CL1–CL5). (F3)
4. **Do not sign off the client direction on Overview alone** — require at least Inbox (the action loop + trust guards) and one pay-more moment designed before the gate closes. (F4)
5. **Name the retention scope boundary in the plan:** the rebuild is the landing surface; the return hooks (event push, email preference center, named-record reconciliation) are separate, still-pending work and must not be deprioritized because "the client dashboard was just rebuilt." (F5)
6. **Design the Free-tier and trial client states** (soft-gated view + trial moment) as part of the client-dashboard proposal, not after. (F6)
7. **Sequence the fan-out revenue-first** (Client portal, Recommendations, Pipeline early) so monetization-adjacent surfaces land before long-tail admin tools. (F7)

## Evidence index

- `hmpsn studio Design System/UI Rebuild Handoff Brief.html` — Phase 0 mandate, 18-surface map, per-surface template (field 5 permissions), house rules.
- `hmpsn studio Design System/Surface Model.html` — scope×audience grid, send boundary, cold-start onboarding.
- `hmpsn studio Design System/Client Dashboard Plan.html` — A1–A7 audit, four-tab proposal, "upgrade math at the ceiling" (prose only).
- `hmpsn studio Design System/Client Dashboard Mockup.html` — "OVERVIEW = THE ISSUE" render; `placeholder()` stubs for other tabs; "Growth plan" badge + approvals/strategist copy; no tier/upgrade/trial UI (grep-verified).
- `hmpsn studio Design System/Client Surface Sweep.html` — "the current one already won… finish the switch"; CL1–CL5 cracks; provenance contract praise.
- `hmpsn studio Design System/Platform Parity Ledger.html` — Stripe rows admin-only; zero client portal/cart/checkout/purchase/plans/trial rows (grep-verified).
- `hmpsn studio Design System/Content & Access Conventions.html` — role-only permissions matrix; single Growth-plan locked-state microcopy example.
- `hmpsn studio Design System/mockup/home.js` (header comment, work queue), `mockup/pipeline.js:476-539` (content-subscription pricing), `mockup/settings.js:204` (Stripe connect).
- `MONETIZATION.md` — tier structure and per-tier service semantics (Growth = zero human touch; approvals = Premium).
- `docs/superpowers/specs/2026-06-20-the-issue-client-discovery-spec.md` Part 1 — spine, money mechanics, trust guards, §F return hooks, §G non-negotiables.
- `data/roadmap.json` — pending: The Issue P1 reconciliation + email preference center; Strategy v3 deferred monetization spine; Self-Service & Growth (5/5); Client Dashboard Followups (hours tracking, welcome moment).
- `FEATURE_AUDIT.md` #522 + Strategy v3 entry — live server-authoritative tier gates (`computeEffectiveTier`, act-on `requiredTier`), cart-checkout and TierGates as shipped client money flows.
