# The Issue — Client P0 Persona Review (advisory)

**Date:** 2026-06-20  ·  **Method:** loop closure — the SAME 7 client-discovery personas re-reviewed the BUILT P0 surface against their OWN discovery asks (idealFirstScreen / indispensable / wouldLeaveOrDistrustIf / noiseToCut).  ·  **Grounding:** faithful code digest of the committed P0 (flag `the-issue-client-spine`, OFF).

> Discovery (the clients’ spec): [discovery + gap](../specs/2026-06-20-the-issue-client-discovery-spec.md). Re-design spec: [redesign](../specs/2026-06-20-the-issue-client-redesign-design.md). Plan: [P0 plan](../plans/2026-06-20-the-issue-client-dashboard-p0-plan.md). Advisory only — no code changes from this review.

---

# P0 Client-Persona Review — "The Issue" Client Surface

> **ADVISORY ONLY — NOTHING SHIPS WITHOUT OWNER SIGN-OFF.**
> Flag `the-issue-client-spine` is **OFF** in production; the flag-OFF render path is byte-identical to the old surface, so this review describes a dark-launched build, not anything customers can see today. P0 was scoped as a **trust spine on honestly-labeled GA4 estimates**, with named items (local map/reviews, portfolio rollup, named-record reconciliation, export, push/return-hook) **deferred to P1/P2 by design**. This is a clean-room loop closure: we ran discovery to extract the clients' own spec, built P0 to it, and the **same 7 personas** re-reviewed the build. Read this as "did we deliver what they asked for," not "is this finished."

---

## 1. Bottom line

- **We built the trust spine they asked for, and they felt it.** Every one of the 6 single-front-door personas independently named the same wins: dollar verdict leads, the 0–100 vanity ring is exiled to a collapsed drawer, the content plan is demoted from hero to evidence, and the number is honestly banded ("~$12,000", "~7×") and labeled an estimate. The reorder from "ROI buried behind *See full report*" to "ROI leads" is the single most-cited improvement across the panel.

- **The honesty engineering is the real product win, not a side effect.** Personas who came in primed to churn over spin (the churned ex-client, the burned HVAC owner, the skeptical dentist) singled out *the disclosure line and the refusal to fabricate a baseline* as what earned trust — "an agency admitting the edge of its own number is the single thing I never got before." For a panel whose #1 leave-trigger is fake precision, building less confidence into the number bought more credibility.

- **The most important still-open thing is not one feature — it's that "honest estimate" ≠ "verifiable proof," and verification is concentrated in P1.** Five of six customers used near-identical language: they'll *trust the GA4 estimate as a direction* but won't *stake the renewal, expand spend, or put it in front of a CFO/partner/board* until it reconciles to their reality (front desk, HubSpot, CRM, clinic phones). That reconciliation is P1 by design — but it's the half they care about most.

- **Separating real gaps from planned deferrals matters here.** The genuine P0 *misses* (not deferrals) are narrow: the **dollarized "next bets" card** the B2B-SaaS lead says the spec scoped for P0 reads as quietly dropped; **commercial-keyword/competitor SOV is correct but buried** in the collapsed drawer for segments where it's money, not vanity; and **outcomes have no quality filter** (raw GA4 key-events), so "qualified lead" can include reschedules, students, and tire-kickers. Everything else they flagged is contracted-and-signposted P1/P2.

- **One persona was not moved at all — and it's the non-customer by design.** The franchise/multi-location operator (`isCustomer: false`) correctly reports the build serves a business he doesn't run: the verdict is a single-workspace blob with no location dimension, and his indispensable feature (ranked portfolio triage) is gated to a **P2** child flag, behind even P1. For *him*, P0 is "the trust spine without the product on top."

- **Watch-item that recurs unprompted: the number is only as honest as one admin input.** Multiple personas flagged that a misset `valuePerOutcome`, an unpinned/wrong GA4 event set, or a vague free-text unit label silently produces a *wrong-but-confident, estimate-labeled* number the client can't sanity-check from their seat. The honesty layer prevents false *precision*; it does not yet prevent a confident *wrong* estimate.

- **Promote/hold read: PROMOTE to staging for owner sign-off.** This is a genuine, well-executed step toward what the clients asked for and it earns the login back for every customer persona. It does **not** yet earn expansion or "never cancel" from anyone — that verdict is explicitly gated on P1 (reconciliation + export + return-hook). Ship P0 as the trust foundation; treat P1 as the revenue unlock, not a nice-to-have.

---

## 2. Did we build their spec?

| Persona | builtToMySpec | The one thing that lands | The one thing still open |
|---|---|---|---|
| **Owner-dentist** (local SMB, customer) | mostly | Dollar verdict + "~7× your retainer" leads; ROI un-collapsed; kitchen hidden under the hood | Map-pack + Google-reviews status absent from P0 (P1) — half his front screen for a local dentist |
| **B2B-SaaS marketing lead** (customer) | mostly | Vanity exile + honest provenance; dollar-vs-retainer leads, ring buried | HubSpot/CRM reconciliation + board export (P1); plus a genuine P0 miss: dollarized "next bets" card |
| **VC / board member** (customer) | partially | Killed the green-arrow wall; dollars lead, no false precision, no fabricated baseline | CAC-vs-paid + payback + share-of-pipeline slope — his indispensable, all P1/P2 |
| **Pro-services marketing lead** (customer) | partially | Spine inversion + "curated by your strategist" colleague tone; homework above the fold | Named title/firm inbound (P1) + topic-vs-named-competitor authority (P2); no forwardable one-pager |
| **HVAC owner-operator** (local SMB, customer) | mostly | The money frame he'd "read aloud": "you pay ~$1,500, we drove ~$12,000," honestly labeled | A lead count he can **verify** against his front desk — call tracking + reconciliation (P1) |
| **Churned ex-agency client** (customer) | mostly | Verdict + dated baseline + volunteered methodology limits; can render red | Clickable-to-live-page work log (P1) + reconciliation to his phone (P1) |
| **Franchise / multi-location** (NON-customer) | partially | Vanity demotion + honesty layer + deterministic segment resolution | Portfolio rollup + ranked location triage — his entire job, gated to **P2** |

**Cross-persona pattern.** The panel is unanimous on the *spine* and split on the *altitude*. Everyone validated the same three moves — **lead with dollars, exile vanity, refuse to fake the number** — which is exactly the trust spine P0 set out to build. The divergence is purely about *whose denominator wins*: P0 ships one honest altitude (estimated outcome value ÷ retainer), and that altitude fits the SMB/local personas almost exactly, fits the operator (B2B/pro-services) "mostly," and is structurally wrong for the board (wants CAC vs paid) and the franchise (wants per-location). No persona accused the build of spin; the recurring sentence is "I trust it as a direction, not as proof," and proof is the P1 work. The deferrals were *told*, which every persona explicitly credited as "a deferral I was warned about isn't a betrayal."

---

## 3. The before/after on the original discovery blockers

The discovery surfaced five hard-blockers — the things that made the *old* surface fail. Status of each against the built P0, grounded in the digest:

- **The missing "Act-on / verdict" (old surface had no plain-English conclusion).** **RESOLVED.** Slot 1 `IssueVerdictHeadline` now leads with a verdict sentence from `baselineVerdict()` ("N {outcomeNoun}, up from M since we started"), and the "what needs me" loop is hoisted to slot 0 (`ActionQueueStrip`) + slot 4 (`IssueLoopFooter`). Every customer persona confirmed the conclusion-first, "the-ball-is-in-your-court" shape landed. This was the strongest, most universally felt fix.

- **The inverted hierarchy (vanity/activity on top, ROI buried behind "See full report").** **RESOLVED.** The ROI/money frame (`ROIDashboard`) is un-collapsed and promoted to slot 3; the content plan is demoted to slot 5; rankings, `CompactStatBar`, and per-page traffic tables are pushed into the collapsed slot-6 `<details>`. The dentist, HVAC, churned, VC, and pro-services personas all named this reordering as the single biggest improvement, in nearly identical words.

- **The no-baseline number (a figure with nothing to compare against).** **RESOLVED, honestly.** The baseline is engagement-anchored to `workspace.createdAt`, read from the earliest GA4 snapshot and re-aggregated through the *same* pinned-event filter, with a dual trend ("vs last period · since we started"). Critically, when no anchor exists it degrades to "we're establishing your baseline now" with **no fabricated delta** — the panel repeatedly cited this honest degradation as trust-building rather than disappointing.

- **The invented visibility score (the meaningless 0–100 composite).** **RESOLVED.** The 0–100 ring is removed from the headline entirely and survives only inside the collapsed slot-6 drawer. The VC ("a visibility score of 82 means nothing I can put in a model") and dentist both confirmed it's off their first screen. The verdict computes *only* when the flag is on, `outcomeValue` is set, and a real GA4 snapshot exists — otherwise it degrades, so there is no fabrication path.

- **The fabricated competitor rows (invented competitive data).** **PARTIALLY RESOLVED.** There are no fabricated competitor rows on the surface; `CompetitorGapsSection` is now real, segment-gated (`showCompetitorAuthority`, default true), and drawn from actual keyword-gap data — but it lives in the collapsed slot-6 drawer. For the B2B-SaaS and pro-services personas, the *substance* is honest but the *prominence* is wrong (commercial SOV is their money view, not vanity), and the pro-services persona's specific ask — *topic-vs-named-competitor authority* — is a distinct surface scoped to P2 that does not exist yet. So: fabrication eliminated, prominence/specificity deferred.

---

## 4. What is still open

### P0 polish (could fix now — these read as misses, not deferrals)

- **Dollarized "next bets" card.** The B2B-SaaS lead reports the spec scoped a `NextBetsCard` ("3 plays — here's what each is worth") reframing existing rec `estimatedGain` into dollars as *P0*, but the built spine only surfaces recs inside the demoted content plan with no per-play $ projection. This is the one item that reads as quietly dropped rather than phased — and it's the proactive-strategy lever the operator personas would pay more for. Worth confirming against the spec and either building or explicitly re-scoping to P1.
- **Surface commercial-keyword / competitor SOV for the segments where it's money.** `CompetitorGapsSection` and `StrategyRequestedKeywordTrendSection` are correct in substance but buried in collapsed slot 6 for B2B-SaaS and pro-services, where those *are* the money terms, not vanity. A segment-aware promotion (don't require a click to expand for these segments) is a layout change, not new data.
- **Outcome quality framing.** Counts are raw GA4 key-events with no quality dimension, so a reschedule, a robocall, a student, or a vendor can inflate the "qualified lead" count. True quality scoring is P1 (needs reconciliation), but the *label* could be tightened now — e.g. consistently "tracked conversions" rather than "qualified leads/new patients/inquiries," which currently overclaims relative to what GA4 can actually distinguish.
- **Client-visible note of *which* events are counted.** Multiple personas want to be able to answer "counted how?" if a CFO/partner asks. Surfacing the pinned-event set (or at least a "counting these events" affordance) is a small honesty add that hardens the number's defensibility.
- **Explicit "Nothing needed from you right now" reassurance.** The dentist asked for the affirmative empty-state line; `ActionQueueStrip` renders null when empty rather than affirming. Minor, optional per spec, but a cheap trust beat.

### Deferred P1/P2 (by design — name them so the gap to "decisive" is explicit)

These are *why the customers say "staying and watching" rather than "renewing and expanding."* Be honest with yourself: until these ship, the panel is cautiously retained, not decisive.

- **Named-record reconciliation** (call tracking / CRM / form capture; `actual_reconciled` provenance; `namedRecordsAvailable` flips true) — **the most-named gap on the whole panel.** This is the verify-against-reality half of nearly every customer's *indispensable* ask. Until it lands, the number is honest but uncheckable.
- **Board/exec/partner/owner one-pager export** (`exportProfile` defined-but-unused). The literal monthly return-hook for the operator, VC, pro-services, and franchise personas — without it they're still rebuilding the view in slides.
- **Push / SMS return hook** (`the-issue-client-return-hook`). Every persona self-identified as a once-a-month-at-invoice-time user; the push is what converts a dashboard-they-forget into a service-they-feel.
- **Local map-pack + Google-reviews insert** (`showLocalMapAndReviews` renders null). Half the dentist's front screen; the data source (`local-seo.ts`) already exists, which makes the absence sting more.
- **Multi-location portfolio rollup + ranked triage** (`showPortfolioRollup` renders null; gated to **P2**). The franchise operator's entire reason to be a customer.
- **CAC-vs-paid altitude + payback + share-of-pipeline slope + compounding-asset/moat view** (P1/P2). The board member's indispensable; the operator's expansion trigger (HubSpot pipeline → influenced revenue).

**Honest read:** the customers will likely not become "decisive" (renew-without-thinking, expand spend, forward to a CFO/board) until the **reconciliation + export + return-hook** trio ships. P0 earns the login and stops the churn; P1 earns the expansion.

---

## 5. Recommendation

**Yes — P0 is a real step toward what the clients wanted, and a well-aimed one.** It built precisely the layer discovery said was broken (the trust spine), and it did so with an honesty discipline the panel did not expect and explicitly rewarded. The most dangerous failure mode for this product — an agency dashboard that spins — was architected against, not papered over. Every customer persona moved from some flavor of "about to churn / forgettable export" to "I'd open this before a meeting / I'll give it a real quarter."

**Promote-to-staging read: GO, for owner sign-off and staging verification.** Caveats to carry: it's flag-OFF in prod (safe), the flag-ON path depends entirely on correct admin config (`outcomeValue` + pinned events), and the empty-verdict degradation — honest as it is — could read as "nothing's working" to a once-a-month user on a misconfigured workspace. Verify the configured-vs-unconfigured states on staging before any rollout.

**The 1–3 things to decide:**

1. **Is the dollarized "next bets" card a dropped P0 or a re-scoped P1?** Resolve the spec discrepancy the B2B-SaaS persona flagged — this is the only item that reads as a silent miss rather than a deliberate deferral, and it's a paid-upgrade lever.
2. **Lock the P1 sequence to the trust-completing trio first: reconciliation → export → push.** That ordering is what converts the unanimous "trust as a direction" into "stake the renewal / expand spend." It outranks the CAC altitude and the multi-location rollup for revenue impact across the customer panel.
3. **Decide whether to tighten the P0 outcome *label* now** (raw GA4 conversions framed as "tracked conversions," not "qualified leads/new patients") to close the small overclaim gap before staging, since true quality filtering is itself P1.

---

## Appendix — per-persona scorecard

**Owner-dentist (local SMB, customer) — builtToMySpec: mostly**
- *Delivered well:* Dollar verdict + "~7× retainer" leads; ROI un-collapsed; honest banded estimate; no fabricated deltas; "names available with call & CRM tracking" honest IOU; jargon gone from his view.
- *Still missing:* Map-pack ("dentist near me") + Google-reviews status (P1) — half his front screen for a local dentist; front-desk reconciliation (P1); push hook (P1); junk-filtering on the count (P1).
- *New concerns:* "Qualified lead" headline is really a GA4 conversion, not a verified new-patient call — if his front desk count diverges before reconciliation, the extended trust evaporates; the number is only as good as the admin pinning the right events and value.
- *Moved read:* Moved him to "cautiously staying and watching," not "renewing and expanding" — retained, not yet expanded.
- *Killer line:* "For a single-location dentist that's not a side dish, that's half the meal."

**B2B-SaaS marketing lead (customer) — builtToMySpec: mostly**
- *Delivered well:* Vanity exile is real not cosmetic; grown-up provenance handling; honest anti-spin baseline copy; "what needs me" structurally solved; deferrals signposted as honest upsells.
- *Still missing:* Dollarized next-bets card (reads as a genuine **P0 miss**); commercial SOV buried (prominence bug); board export (P1); push (P1); HubSpot/CRM reconciliation to influenced revenue (P1).
- *New concerns:* Free-text unit label + admin-set per-outcome value could read generic or be silently mis-valued with no client-side sanity check; verdict depends on the right events being pinned; empty verdict on a misconfigured workspace could read as "nothing's working."
- *Moved read:* "Stay and lean in," re-sign at renewal — not yet expand; expansion gated on CRM reconciliation + forwardable export.
- *Killer line:* "This is the version I actually wanted, and I didn't expect to say that."

**VC / board member (customer) — builtToMySpec: partially**
- *Delivered well:* Killed the green-arrow wall; dollars lead, score follows; refused false precision; honest degradation reads like a measurement instrument; provenance enum + swap-in-place verdict make the P1 CAC promise credible.
- *Still missing:* CAC-vs-paid (his indispensable), payback-in-months, share-of-pipeline slope, compounding/moat view, an honest all-in denominator (retainer-only divisor today) — all P1/P2 or absent.
- *New concerns:* "Evergreen" framing suppresses MoM and could recreate the all-green problem in spirit (no QoQ path to render a bad quarter red); segment is a manual admin override (a flatter-the-number lever); retainer-as-divisor could harden as the de-facto denominator before the all-in cost is built.
- *Moved read:* Moved less than the personas it's built for, and that's fair — stays and keeps funding, will **not** put a GA4 estimate in a board deck or expand budget until reconciled CAC-vs-paid + quarterly push ship.
- *Killer line:* "They nailed the trust spine and the operator's altitude first… my altitude is next."

**Pro-services marketing lead (customer) — builtToMySpec: partially**
- *Delivered well:* The inversion he most wanted (verdict-and-proof first, cockpit in a drawer); grown-up honesty on the dollar number; homework is first-class; "curated by your strategist" colleague voice; dual-trend baseline.
- *Still missing:* No quality filter on outcomes (**truly missing** — students/vendors inflate the count); named title/firm-tagged clickable inbound (P1, his trust linchpin); topic-vs-named-competitor authority (P2, his biggest credibility gap); partner-byline approve-before-publish gate (P2); forwardable one-pager (P1).
- *New concerns:* His segment barely does anything live at P0 ("segment-adaptive" is contract-only scaffolding for him); the verdict noun depends on an admin typing the right unit label; an "estimate" label protects the agency from overclaiming but doesn't yet arm him to win the budget argument with a skeptical partner.
- *Moved read:* Partially moved — would open it before a partner meeting, no longer reaching for the replacement list — but cannot yet defend the line item to partners; holding budget, not expanding.
- *Killer line:* "The foundation is right. Now build the part that's actually mine."

**HVAC owner-operator (local SMB, customer) — builtToMySpec: mostly**
- *Delivered well:* The money frame he'd "read aloud," un-collapsed and honestly labeled; architected directly against the rankings-up-phones-quiet pattern that fired his last agency; honest, tamper-resistant before/after baseline; homework surfaced, work-log demoted.
- *Still missing:* A lead count he can **believe** against his front desk (verification *is* the product for him); revenue/closed-job attribution (P1); call tracking + lead-quality flagging in-area vs tire-kickers (P1); push notification (P1).
- *Moved read:* Moved, but not to "never question the invoice" — keeps paying through P0, holds expansion dollars until the number reconciles to his office and shows up in his inbox.
- *Killer line:* "It's a believable estimate, not the proof I'd bet the renewal on."

**Churned ex-agency client (customer) — builtToMySpec: mostly**
- *Delivered well:* Verdict leads with money + dated baseline; honesty engineering better than expected (no real data → no number, not a fabrication); methodology line volunteers its own limits; can render red honestly; SEO machinery demoted; honest IOU instead of a fake "view names" link.
- *Still missing:* Clickable verifiable work-log link (P1 — touches his core "what did I pay for" need); reconciliation to his phone/inbox (P1, the half he cares most about); call tracking + lead quality (P1); event-driven push (P1); export / no-lock-in (P1).
- *New concerns:* The headline is only as honest as the admin's per-lead value, which he can't see or challenge from his seat; no reconciliation guard during the P0 window means a GA4-vs-phone divergence could go unexplained; "estimate with AI" value-basis makes him nervous even flagged lowest-confidence.
- *Moved read:* Moved from "about to churn" to "willing to give it a real quarter" — stays and watches, won't pay more; expands if P1 reconciliation + push land, gone if the estimate quietly drifts from his phone.
- *Killer line:* "An agency admitting the edge of its own number is the single thing I never got before."

**Franchise / multi-location operator (NON-customer) — builtToMySpec: partially**
- *Delivered well:* Vanity genuinely demoted; the best-in-class honesty layer (banding, always-on disclosure, no fabricated number); 22-row table correctly *not* the front door; slots 0/4 give "meter running / needs my sign-off" at the right altitude; segment resolved deterministically and correctly from location count.
- *Still missing:* **Shape problem, not just a deferral** — the verdict is a single-workspace GA4 blob with no location dimension, answering the wrong question for him; ranked portfolio triage (his "this IS the product," gated to **P2**, behind even P1); top-3 overperformers + "X of 22 clean" rollup; per-location attribution (P1); owner/board one-pager (P1, defined-but-unused); break alerts + deep-link push (P1).
- *New concerns:* Roadmap-sequencing risk — his indispensable feature is a P2 child flag behind P1, so P0 polished a spine he can't use at his altitude; a confident single dollar number for 22 locations invites mistrust the first time it disagrees with a clinic manager, with no per-location breakout to sanity-check; silent-restatement edge if an admin re-pins events; `showLocalMapAndReviews` is configured true for his segment but renders null, so his profile "asks for" surfaces that aren't there.
- *Moved read:* **Not moved** — would not renew or expand on this; stays month-to-month waiting to see if P1/P2 ship. (Consistent with `isCustomer: false`.)
- *Killer line:* "You've built me an honest dashboard for a business I don't run."
