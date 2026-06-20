# ADMIN REFRAME REVIEW — "The Issue" (advisory + directional)

> **READ THIS FIRST.** This document is **advisory and directional**, not a build spec. It exists to inform *where* the admin side of "The Issue" should go now that the client side has become outcome-denominated. **Nothing here changes code.** Every recommendation below is **HELD until the client side stabilizes (≥ P1a done).** The one exception to "don't build yet" is alignment work that is *already in P1a scope* — see §5. Treat the rest as a deferred admin-reframe phase, not a backlog to start mining.

---

## 1. The reframe thesis

The same through-line shows up in all five operator personas, said five different ways. Strip the persona-specific framing and it is one shift:

- **From curating the input to owning the output.** Today the operator curates recommendations (keep/cut/park/stage/edit) and never sees the dollar verdict the client now opens on. The job has to flip from "curate the rec list" to "**produce and stand behind the client's dollar verdict** — and curate the moves and prose that grow it."
- **The number is now the deliverable; the rec feed is the substrate beneath it.** The content plan was demoted to evidence on the client side. The admin side has to make the same demotion: archetype mix and "value 73" tags become secondary metadata; the verdict and its trend become the headline the operator works against.
- **The operator now owns the *integrity* of the number, not just the feed.** P1a makes a measured verdict depend entirely on one admin's setup — value, pinned-and-typed events, the Webflow webhook, the confirm. A misset value yields a confident-but-wrong client headline. That integrity job currently has no home in the weekly flow; the reframe must give it one.
- **Curation must speak the client's currency.** The operator curates in archetype/severity/score; the client buys outcomes and dollars. Until every staged move can be read as "+~N leads / +~$X toward the number," the operator literally cannot curate "the moves that grow the number."
- **The operator should never ship a number they've never looked at.** Preview-as-client was removed in Phase 1. At the exact moment the deliverable became a high-stakes dollar claim, the operator lost the ability to read their own headline before sending. The reframe restores "Send issue" to mean "I have seen what they will see, and it is honest."

---

## 2. What the admin must gain

Five cross-persona needs. Each is named here with the personas that demanded it.

1. **A verdict mirror at the top of the cockpit.** Before curating anything, the operator must see the *exact* sentence the client will read — provenance label (`estimate_ga4` vs `measured_action`), baseline anchor, dollar band — rendered from the *same* `computeROI().outcomeVerdict` / `baselineVerdict()` source the client reads (never a falsely-precise admin-only number). *Demanded by all five personas* — it is the single most-repeated ask in the set (solo founder's "verdict mirror," scaling operator's "North Star at top of IssueHeader," onboarding operator's "show the dollar," economics owner's "IssueVerdictBar slot-0," storyteller's "verdict slot under the title").

2. **An integrity strip the operator can't send around.** A compact, in-cockpit readout of whether *this* issue's number is honest: value set (+ basis), segment confirmed, events pinned + typed, Webflow forms connected + last-lead freshness, baseline exists, resolved provenance — each a one-click deep-link into the relevant `ClientDashboardTab` control. The P1a verification readout, *promoted out of Settings into the cockpit.* *Demanded by solo founder, onboarding operator, economics owner, storyteller* — and required at portfolio scale by the scaling operator.

3. **Recommendations framed by projected outcome / $ impact.** A per-rec outcome-impact tag on `CockpitRow` ("+~N leads" / "defends ~$X"), sourced from the *client-safe* band (`impactBand.monthlyRangeUsd` × `valuePerOutcome`, banded via `fmtEstimate` — never raw `emvPerWeek`), with the queue sortable by $ contribution. *Demanded by all five* — the economics owner is most pointed ("re-express 'value 73' as projected $"), the storyteller specifies the exact safe source field.

4. **A guided conversion-tracking setup wired into the operator's workflow.** The act that graduates the number from estimate to measured (pin + type events, paste webhook, confirm) cannot live as a once-and-forget Settings card. It needs an ordered, progress-bearing first-run flow (reuse `OnboardingChecklist`) reachable from the send path, plus integrity guardrails on the load-bearing inputs (a sanity band on value-per-outcome, a "last 90d would have read ~$Y" preview, an echo of the exact client-facing sentence). *Demanded most sharply by the onboarding operator*; the integrity guardrails are co-demanded by the solo founder ("the one input it lives or dies by").

5. **A cross-client outcome-triage for scale.** A portfolio surface denominated in the *client's verdict* — current dollar verdict, baseline delta (up/flat/down), provenance tier, and setup-state per client — sorted by "verdict weakening / highest-$-at-risk," with an integrity alarm wired to the number's *trustworthiness* (stale capture / `reconcileFormCountVsGa4` discrepancy / unset value / verdict-down), not win-rate mechanics. *Demanded by the scaling operator* — the only persona whose whole lens is the book of 20–40 clients. The key insight: this surface **already exists** as `OutcomesOverview` / `WorkspaceOutcomeOverview` / `GET /api/outcomes/overview`; it is denominated in the *wrong units* (win rate, actions tracked) and needs re-denominating in place, not a net-new page.

---

## 3. What to keep

The cockpit got real things right. The reframe must inherit these, not regress them:

- **The 5-beat spine shape** (header → stance → POV → queue → send) and "open to the decision, not a wall" — collapsing everything else into one "Supporting detail" disclosure. The skeleton is correct for an outcome cockpit; only the *content* of beats 1–3 graduates from recs to the number. Every persona explicitly said keep the spine.
- **The single-commit send model.** The word "send" living in exactly one place (`IssueHeader`), per-row/bulk verbs that only *stage*, the atomic bulk-send route, numerator/denominator sharing one source (`cockpitRecs` + `isCuratedForClient`). This is the operator's safety rail against accidental client writes. **Do not add a second commit path** for the verdict — extend this one. Teach the counter to also speak verdict-readiness; do not split it.
- **The cut → POV-sentence reflow** (cutting the lead move's backing card removes its sentence live) and the staleness nudge, plus the lost-keystroke guard (draft reset keyed only on `generatedAt`). This co-design between curation and narration is exactly the integrity wiring the new direction needs *more* of — reuse it, repoint it to the verdict.
- **Fast curation verbs** — keep / cut (strike + cascade confirm) / park (throttle, resurfaces in Nd) / stage / inline edit wording / inline edit POV / add-a-recommendation, with commit-on-blur wording overrides. Operator steering over the exact words is *more* important when the client reads a dollar claim, not less.
- **Flag-OFF byte-identical discipline + one-PR-per-phase.** The client side shipped gated and OFF-identical. The admin reframe ships the same way.
- **The honesty engineering itself** — provenance labels, `fmtEstimate()` banding, no fabricated baseline/delta, the "establishing your baseline now" degradation. The cockpit must *mirror* this honesty, never override it: the operator sees the same labeled estimate the client sees, never a precision the client can't.
- **Config-as-page-chrome** (`StrategyConfigPanel` mounted in `IssueHeader`, not tab-buried) and the inline disabled-reason on Send. The right instinct — surface it where they work, explain it inline. The new verdict mirror and integrity strip slot in as *siblings* of config chrome.
- **The data model in `ClientDashboardTab`** — basis-precedence value input (`client_provided` > `agency_estimate` > `ai_enriched`), read-only local segment axis with only the non-local 3-way overridable, the event pin/rename/group model. The model is right; it needs to be *surfaced into* the cockpit, not relocated wholesale.

---

## 4. What changes

Directional, grouped. None of this is sequenced for now — see §5.

### Cockpit (the single-workspace curation surface)

- **Add a verdict mirror as the new beat-0**, above `IssueHeader`'s curation chrome: the client's exact verdict sentence + provenance tier + baseline + dollar band + trend-vs-last-cycle, read from `computeROI().outcomeVerdict` / `baselineVerdict()`. No new endpoint. This is the "pop in cold, land on the number" fix.
- **Add an integrity strip** between the verdict mirror and `StanceBar`: value/basis · segment · events pinned+typed · Webflow forms connected + last-lead freshness · baseline status · resolved provenance — each a one-click deep-link into `ClientDashboardTab`. Promote the P1a verification readout out of Settings into here.
- **Make Send setup-aware (one gate, conscience added).** Keep the single button; extend the existing `disabledReason`/secondary-text mechanism — never block, just warn loudly: "Client will see a count-only verdict — set an outcome value?" / "Number ships as estimate, not measured" / "Verdict is flat vs last period — narrate it before sending." Surface the dollar the client will see in the send confirm.
- **Re-denominate the rec substrate.** Per-rec projected-$ tag on `CockpitRow` from the client-safe band (guard against ever rendering raw `emvPerWeek`); default-sort the queue by $ contribution when a value exists, falling back to the abstract score only when it doesn't; show "—" honestly for rec with no band rather than fabricating.
- **Give `StanceBar` a money mode** — a second segmented read (or toggle) showing each archetype's share of the staged issue's projected $ and the total delta vs last cycle. Lead with the money stance; demote the archetype mix to a secondary toggle. Reuse `ARCHETYPE_ACCENT` so it's a render change, not a new visual language.
- **Repoint the POV to the number.** Seed the drafted POV from the outcome delta first, moves second; relabel "The one move I'd bring" toward "Why the number moved / what moves it next"; thread the outcome noun (`displayName`/`unitLabel`) + the lead move's projected $ into the prose; extend the staleness nudge to fire when staged $ no longer explains the verdict.
- **Build the missing `NextBetsCard`** ("3 plays — here's what each could be worth," from `impactBand` × `valuePerOutcome`) — the documented P0 reframe miss, flagged twice in the client review and named by the storyteller and economics personas as the operator's proactive expansion lever.
- **Restore preview-as-client as a first-class control** — a real toggle / side-by-side rendering live `TheIssueClientPage` for this workspace, so "Send issue" means "I've seen the deliverable." It was removed only because the client page didn't exist yet; it does now.

### Setup / onboarding (making the number provable)

- **Give the P1a setup a spine.** Replace the six independent collapsed Settings cards with an ordered, progress-bearing first-run flow (reuse `OnboardingChecklist`: set the outcome value → confirm segment → pin & type key conversions → connect Webflow capture → confirm a measured lead landed → curate & send the first Issue). Keep the individual cards as the *edit destinations*; give them an ordering and a "what done looks like."
- **Make the setup cockpit-reachable**, not Settings-only — a modal or the integrity strip's deep-links, surfaced on the send path where the operator actually is.
- **Add integrity guardrails to the load-bearing inputs** — a plausibility band on value-per-outcome ($800 vs $8,000), a "with this value, last 90d would have read ~$Y" preview, an explicit echo of the client-facing sentence the operator is about to make true, and a warning on empty/ambiguous outcome-type mappings before `conversionTrackingConfirmedAt` can flip.
- **Add provenance-ladder literacy at the point of control** — "Now: ~$11,000 (estimate). Confirm tracking → 23 form fills · 41 calls, tracked on your site (measured)." Make the estimate → measured graduation visible and operator-driven, and keep the hard rule absolute (provenance flips to `measured_action` *only* on confirmed setup; never the instant a flag flips).
- **Add a recurring tracking-health signal to the weekly flow** — the cockpit (not just Settings) nudges when tracking decays: stale webhook, unpinned/untyped event, unset value, missing baseline. The once-and-forget setup stays honest week over week.

### Scale / portfolio (the book of clients)

- **Reframe `OutcomesOverview` in place into a verdict-denominated triage** ("The Book"). Extend `WorkspaceOutcomeOverview` with `currentVerdictValue`, `baselineDelta` (direction vs engagement-start), `provenance`, and `setupState`; extend `GET /api/outcomes/overview` to populate them from `computeROI().outcomeVerdict` per workspace. Default-sort by verdict-weakening / highest-$-at-risk; keep win rate as a secondary column, not the headline. Reuse the existing table shell, drill-to-workspace, and attention-sort UX — don't build a net-new page.
- **Add a setup-integrity column per row** — "valueSet · N pinned · M typed · forms connected · last lead 2h" — derived from value + event config + form-capture status + `conversionTrackingConfirmedAt`. A client with no value or zero typed events renders "Setup incomplete — estimate only," linking straight to that client's tracking section.
- **Add a provenance-ladder rollup strip** — "Book: 9 estimate · 14 measured · 0 reconciled" — clickable to filter, so the operator can run a "graduate the book to measured" campaign instead of discovering one estimate-stuck client at a time.
- **Wire the portfolio integrity alarm to trustworthiness, not trend** — surface `reconcileFormCountVsGa4` discrepancies, stale-capture, verdict-down, and "estimate-only after N days live" as `attentionReason` values. (A client whose tracking silently broke can currently read green because win rate is fine.) This is the single highest-leverage portfolio change.
- **Add a portfolio entry point to nav** ("Book / Outcomes") as the default landing when running many clients, with drill-through that opens each cockpit on its verdict — one denomination from book to cockpit. **Do not introduce a cross-client bulk-send** that bypasses per-client curation; the single-commit discipline must survive at scale.

---

## 5. Sequencing

**The big admin reframe is deferred.** It is held until the client side stabilizes (≥ P1a done), for one structural reason: every recommendation above reads from `computeROI().outcomeVerdict`, `baselineVerdict()`, provenance tiers, and the conversion-tracking setup state — *all of which P1a is still landing.* Building the admin mirror against a moving server seam means rework. The verdict mirror, integrity strip, $-denominated recs, money-mode StanceBar, NextBetsCard, preview-as-client, and the entire portfolio re-denomination are a **dedicated admin-reframe phase after P1a is green on staging.** Do not start them now.

**What is cheap to fold into P1a now — alignment, not new build:**

- **The conversion-tracking setup is *already* P1a Lane C.** It is being built in `ClientDashboardTab` + the new `the-issue-conversion-tracking` routes regardless. The cheap, in-scope move is to **align its design now so the later cockpit lift is trivial**, specifically:
  - Build the Lane C verification readout as a **self-contained, reusable component** (value/basis · segment · pinned+typed · forms-connected · last-lead · provenance), not inline JSX welded to the Settings tab. Same readout the cockpit integrity strip and the portfolio setup-column will later consume. This is the single highest-leverage alignment decision.
  - Give Lane C's setup steps an **ordering and completion model** compatible with `OnboardingChecklist` even while it still lives in Settings, so the later "give it a spine" change is a re-mount, not a rewrite.
  - Add the **integrity guardrails on the value input** (sanity band + "last 90d would have read ~$Y" + client-sentence echo) *while building the value card*, since that's where the input lives — these don't depend on the cockpit and directly de-risk the "one misset input → confident-wrong headline" watch-item every persona named.
  - Keep the **provenance flip rule absolute** in Lane C (`measured_action` only on `conversionTrackingConfirmedAt`) — it's the integrity spine the whole reframe inherits; getting it exactly right now means nothing downstream has to unwind it.

- **One zero-cost contract note for P1a:** ensure `computeROI().outcomeVerdict` / `baselineVerdict()` are shaped as a **clean server seam the admin can later read without forking** — same source, same banding, same provenance label the client reads. If P1a already returns this cleanly (it should, since the client consumes it), the later verdict mirror is a read, not new infrastructure. Verify it; don't build against it yet.

**Everything else — hold.** The verdict mirror in the cockpit, the integrity strip's *promotion* into the cockpit, the $-denominated rec tags, money-mode StanceBar, NextBetsCard, restored preview-as-client, and the full `OutcomesOverview` → "The Book" re-denomination are the deferred admin-reframe phase. Revisit this document to scope that phase once P1a is merged and the client spine is stable.

---

## Appendix — per-persona

**Solo founder-operator (weekly, time-poor, pops in cold).**
- *Current friction:* curates the input (recs + prose) but never sees the output the client leads with; the number they're on the hook for lives in a separate Settings tab; POV is narrated around the wrong noun; staged ≠ measured and the gap is invisible; no preview-as-client; P1a's integrity job has no home in the weekly flow.
- *Reframe needs:* a verdict mirror at the top; an integrity strip they can't send around; POV co-authored with the number; outcome-denominated rec framing; preview-as-client restored; a recurring tracking-health signal in the weekly loop.
- *Keep:* single-commit send model; the 5-beat spine; inline editable POV + cut→sentence + lost-keystroke guard; the verb set; the honesty engineering; the `ClientDashboardTab` data model.
- *Change:* `OutcomeVerdictMirror` as beat-0; `NumberIntegrityStrip` with deep-links; send-time soft warning; repoint POV lead field; per-rec outcome-impact tag + outcome lens on StanceBar; restore preview-as-client; pull setup into a cockpit-reachable flow + decay nudge; re-label the header counter with a verdict-state chip.
- *Thesis:* flip from "curate the rec list" to "produce and stand behind the client's dollar verdict" — open on the same number the client opens on, expose its integrity inline, curate toward it.
- *Killer question:* When I pop in cold and hit Send, can I see — on this one screen — the exact verdict my client will read, whether it's measured or estimate, and whether it's honest right now — or am I shipping a number I've never looked at?

**Scaling operator (20–40 clients, portfolio/triage lens).**
- *Current friction:* the cockpit is single-workspace by construction with no portfolio entry point; the admin is blind to the dollar verdict it exists to grow; a cross-client surface exists but is denominated in win-rate mechanics, not the client's verdict; no setup/integrity triage at book scale; provenance tier invisible across the book; "attention needed" wired to the wrong signal.
- *Reframe needs:* a portfolio triage denominated in the client's verdict; a setup/integrity column at book scale; a provenance-ladder rollup; an integrity alarm denominated in trustworthiness not trend; the verdict as North Star inside each cockpit with per-rec $ contribution; a drill path that opens each cockpit on its verdict.
- *Keep:* single-commit discipline (no cross-client bulk-send); the verb set + cascade safety; `DraftedPovEditor`; the existing `OutcomesOverview` substrate (reframe in place); StanceBar as a secondary read; config-as-chrome + freshness subtitle; flag-OFF byte-identical.
- *Change:* reframe `OutcomesOverview` into "The Book" (extend `WorkspaceOutcomeOverview` + the overview endpoint); setup-integrity column per row; provenance-ladder summary strip; portfolio integrity alarm via `attentionReason`; hoist the verdict into `IssueHeader`; per-`CockpitRow` $ contribution; a "Book / Outcomes" nav entry point.
- *Keep (denomination):* one denomination from book to cockpit.
- *Thesis:* reframe from "curate one cockpit at a time" to "operate a book of provable dollar verdicts" — triage by which number is weakening or unmeasured, curate toward that same verdict.
- *Killer question:* When a client's verdict drops — or tracking silently breaks (GA4 says 47, webhook says 12) — does the operator running 30 clients find out from a portfolio triage before the client does, or only by opening that one cockpit by luck?

**New-client onboarding operator (makes the verdict real, then sends the first Issue).**
- *Current friction:* setup is a scavenger hunt across two pages with no map/ordering/progress; the cockpit is blind to the number it's curating; can ship a broken verdict with zero warning (`canSend = stagedCount > 0`); the outcome-value input is a free-text footgun with no sanity band or preview; P1a setup is planned into the same buried tab; no single readout of the number's health.
- *Reframe needs:* a single "Number readiness" surface reachable from the cockpit; a setup-aware Send; the dollar shown in the curation surface; a guided ordered first-run setup (reuse `OnboardingChecklist`); provenance literacy at the input; integrity guardrails on the load-bearing inputs.
- *Keep:* single canonical Send + counter + inline disabled-reason; config-as-chrome; the P0 value card's honesty framing ("No outcome value set — count-only verdict" is the seed of the readiness model); read-only local segment axis; event pin/rename/group model; the stage-vs-send model + verbs; the hard provenance rule.
- *Change:* "Number readiness" panel in the spine with deep-links + current verdict; setup-aware `canSend`/`disabledReason`; show the dollar near `BackingMovesQueue`; replace six collapsed cards with an ordered progress flow; build Lane C as a cockpit-reachable wizard; integrity guardrails on the value form; provenance-ladder copy at the point of control.
- *Thesis:* shift from "curate a list and send it" to "own the integrity of one dollar number and the moves that grow it" — the cockpit absorbs setup-readiness and the live verdict instead of leaving them in Settings.
- *Killer question:* When an onboarding operator hits Send for a brand-new client, does the cockpit guarantee that client opens on a verdict the operator has actually made real — value set, segment confirmed, tracking confirmed — or can the single button still ship a confident headline backed by nothing?

**Agency owner / operator (economics lens — time saved, dollars made).**
- *Current friction:* the cockpit is blind to the number the client opens on; rec value is denominated in a meaningless unit ("value 73"); the integrity work P1a says the operator owns lives entirely outside the cockpit; StanceBar measures craft-stance not money-stance; zero retention/expansion surface where the money-maker actually works; the Send button has no economic conscience; the POV curates rec-prose not the dollar narrative.
- *Reframe needs:* a verdict header seen first, with trend vs last cycle; dollar-denominated rec ranking sorted by $; an integrity strip in the cockpit that gates/warns Send; a money stance alongside or replacing the craft stance; an operator-facing expansion-moment surface (gated on the trust guard); send-with-economic-conscience; segment-aware altitude via `resolveSegmentProfile`.
- *Keep:* the single canonical Send surface (no second commit path); staging-then-commit + verbs; the cut→POV-sentence contract; inline editing; config-as-chrome + inline disabled-reason; brand-law discipline.
- *Change:* `IssueVerdictBar` as slot-0; re-denominate `CockpitRow` value tag + queue sort to dollars; `IntegrityStrip` in `IssueHeader`; money-mode `StanceBar`; `OperatorExpansionPanel` (gated on trust guard); economically-conscious Send; feed the verdict into `DraftedPovEditor`; consume `resolveSegmentProfile` in the cockpit.
- *Thesis:* reframe from "curate a list and write a POV" to "grow and guarantee a number, then narrate it" — surface the verdict at the top, rank curation by dollar impact, prove integrity inline, flag the expansion moment when the trust guard holds.
- *Killer question:* If you sat operator and client side-by-side — client opens on a dollar verdict, operator opens on an archetype-mix bar and "value 73" tags — which screen is actually steering the number the business lives or dies on, and why is the person paid to grow it the one who can't see it?

**Strategist-storyteller (owns the POV and the narrative behind the number).**
- *Current friction:* curates the issue blind to the verdict; moves carry no dollar tag despite the rec type already carrying `impactBand`; the spec-scoped `NextBetsCard` is quietly missing; StanceBar tells the wrong story under an outcome model; can't preview-as-client; owns the number's integrity but gets no health readout in the cockpit; POV vocabulary is SEO-flavored, unbound to the dollar story.
- *Reframe needs:* the verdict live at the top (same source as the client); a dollar tag on every move from the client-safe `impactBand.monthlyRangeUsd` (never raw `emvPerWeek`); a running "staged set is worth ~$X toward the verdict" total; the `NextBetsCard` built as the proactive lever; a number-integrity readout where they curate; preview-as-client restored; POV fields bound to the outcome story (noun + projected $) with the staleness nudge extended.
- *Keep:* single-canonical-send discipline; `DraftedPovEditor` + cut→sentence + lost-keystroke guard; the verb set; the honesty engineering mirrored exactly (no precision the client can't see); add-a-recommendation (accepting a projected $); config-as-chrome + shortlist-to-5 queue.
- *Change:* Verdict slot in `IssueHeader`; projected-$ tag as a 4th `CockpitRow` slot (guard against raw `emvPerWeek`, show "—" honestly); reframe StanceBar / add a `StagedValueBar`; build `NextBetsCard`; `NumberIntegrityBanner` gating a confident Send; restore preview-as-client; extend the POV contract (outcome noun + lead-move $, staleness on $-divergence, regenerate prompt speaks in outcomes/dollars); per-move outcome-noun preview on `CockpitRow`.
- *Thesis:* shift from "curate a rec list and draft a POV over it" to "curate the outcome narrative — see the verdict, tie every staged move to its projected $, own the integrity of the setup that makes the number provable." The job is no longer "which recs do I send" but "is my story, and the number under it, true and worth backing — and can I see both before Send."
- *Killer question:* If a client read "~$11,000 from your tracked conversions" and emailed "which of the moves you're working drives that number, and what's the next one worth?" — could you answer from the cockpit without leaving it, or would you reverse-engineer a verdict you've never seen from an archetype mix and a generic value tag?
