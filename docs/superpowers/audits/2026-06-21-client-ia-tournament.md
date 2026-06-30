# Client Dashboard IA — Resolution Tournament (+ persona gut-check)

**Date:** 2026-06-21
**ADVISORY ONLY — no code changed.** Owner ratifies before any build; resolutions feed the normal pre-plan-audit → writing-plans → build cycle.
**Method:** 3 cross-functional teams (distinct theses) drafted competing client-IA solutions → 5-judge panel scored all three → head judge synthesized the winner + grafts. Then a **lightweight persona gut-check** ran the 7 client personas over the synthesized winner (the one artifact no team or judge had seen). Built on `2026-06-21-client-tab-ia-persona-audit.md`.

---

## Bottom line

**Ratify the 4-tab two-speed shell — `Overview · Inbox · Results · Deep Dive`** (+ a conditional `Locations` tab for portfolio accounts; `brand`/`plans` → settings). 11 weekly tabs → **4**. The winning plan (Team RUTHLESS) takes simplification + progressive-depth + feasibility; four grafts from Team PROOF fix its weaknesses (a vague depth label, under-leveraged proof). The **persona gut-check validated it 5/7 `serves_me`, 2 `mostly`, zero blockers** — with two cheap hero refinements folded into P1.

**Ship P1 first: the Overview reframe + real month-over-month delta.** It's the audit's single highest-leverage fix, mostly a flag-flip plus data plumbing, and delivers most of the value before a single tab moves.

---

## 1. Winner + judge tally

**WINNER: Team RUTHLESS — Two-Speed Simplifier**, with grafts from Team PROOF.

| Judge (lens) | RUTHLESS | PROOF | ADAPTIVE |
|---|---|---|---|
| Client-Goal Advocate | 7 | **9** | 8 |
| Anti-Bloat / Simplification | **9** | 6 | 3 |
| Progressive-Depth | **9** | 7 | 6 |
| Engineering Feasibility | **9** | 7 | 4 |
| Trust / Honesty | 8 | **9** | 6 |
| **Total** | **42** | **38** | **27** |

RUTHLESS wins 3/5 lenses + the aggregate, and the two it wins are the brief's primary axes (simplification, progressive depth) at the lowest build cost (every step reuses an existing asset). PROOF wins the two "soft" lenses (persona-fit, honesty) but *adds* surface where the mandate was subtraction. ADAPTIVE (segment-adaptive IA) was rejected by three judges as complexity-dressed-as-flexibility — a segment engine + visibility registry is more total complexity than the 11 flat tabs it replaces, with a live mis-segmentation risk.

**Grafts from PROOF (named by the judges):** (A) embedded **"Share this view"** export on the Overview; (B) **per-piece outcome attribution** in Results ("the article you approved earned X clicks") — bestIdeaToGraft by *two* judges; (C) rename the vague "Explore" → **"Deep Dive"** with named Analytics/Rankings sub-tabs; (D) **provenance + banded `~$` must travel with the export** (a hard release gate, unsolved by all three plans).

---

## 2. The locked IA — 11 → 4 weekly (+ conditional 5th)

| Tab | Role | Current tabs that map in |
|---|---|---|
| **Overview** | Verdict home + forwardable proof. Outcome hero (real leads/calls/form-fills this period + **real MoM delta** + provenance label), agency-work-shipped strip, traffic direction, site-OK chip, one approval banner → Inbox, embedded **"Share this view."** Stands 100% alone for the busy client. | `overview` (reframed) |
| **Inbox** | The one do-work tab: approve/request-changes/decline content (approve-before-publish on the real article — **deep editor preserved**), briefs, posts, keyword decisions, page-plan approvals, conversations. | `inbox` + `content` (review) + `content-plan` (approvals) + `strategy` (keyword decisions) |
| **Results** | Shareable proof spine (renamed `roi`, promoted to slot #2): conversion count → organic value → return-on-retainer → since-we-started → methodology/provenance → **per-piece attribution**. Board-ready export. | `roi` |
| **Deep Dive** | The single opt-in depth zone, named sub-tabs **Analytics · Rankings**: GSC query/page tables, keyword cuts, traffic/sources/events, site-health fix-list (Analytics), page→keyword map, validate/decline, content gaps, authority signal, demoted roadmap view (Rankings). Overview "see detail" deep-links here. | `performance` + `search` + `analytics` + `strategy` + `health` + `content-plan` roadmap |
| **Locations** *(conditional — only when >1 location)* | Worst→best leaderboard + per-location drill-down; Overview hero swaps to a leaderboard strip; Inbox/Results gain a location filter. | net-new (separate track) |
| *Settings / account* | `brand` (contact/NAP) + `plans` (billing) — reachable, never weekly nav. | `brand` + `plans` |

---

## 3. Contested calls — resolved (none escalate as blockers)

- **(a) standalone `content` tab → CUT, route review into Inbox.** Action (approve-before-publish on the real article + E-E-A-T brief) preserved in Inbox > Reviews, editor *not* dumbed down; the `content:'reviews'` alias is already wired. 6/7 personas + all judges agree.
- **(b) site-health → FOLD** to an Overview site-OK chip + a *pinned* Deep Dive > Analytics fix-list sub-section. No composite 0–100 score. (Lone dissenter is a digger who lives in Deep Dive anyway.)
- **(c) `content-plan` roadmap grid → CUT as a tab;** per-page approvals → Inbox, roadmap *view* survives demoted (default-collapsed) in Deep Dive > Rankings. Keep the action, demote the view.

---

## 4. Overview reframe + progressive depth (+ gut-check refinements)

**The reframe (P1, universal):** Overview leads with a single outcome **hero** — *"41 calls + 12 form-fills from Google this month — up 9 vs last month (measured)."*
- **Highest-leverage fix:** wire the **real MoM delta** (`baseline`/`priorPeriod`) — drop the hard-coded `null`; keep the honest "establishing your baseline" empty-state for genuinely new accounts (never fabricate a delta).
- Provenance label stays inline. Agency-work-shipped strip, traffic sentence, site-OK chip, one approval banner, "Share this view" export.
- **Demote:** 0–100 health score → chip; insights feed → "see detail" link. **Cut:** predictions / "we called it" / "curated by your strategist" byline.
- Outcome-language CTAs ("Get more patient calls," not "Find Keywords").

**Two refinements from the persona gut-check (fold into P1 — both reuse existing features):**
1. **Typed outcome breakout in the hero, not a blended "leads"** (dentist): show calls vs form-fills/bookings separately with the delta on the key one — surface the existing **P1a `OutcomeTypeBreakdown`** in the hero rather than a single blended count.
2. **Make the hero count clickable to the actual lead list** (check-signer): one tap from "12 leads" → the named-lead "receipts" (the existing **P1b my-leads** view), so the number is verifiable, not faith-based. *"Show me the 12."*

**Progressive depth — two speeds, one named boundary.** SPEED 1 (busy, ~4 personas): Overview answers "is it working + up vs last month"; Inbox holds the only actions; Results is forwardable straight from Overview. SPEED 2 (~2 diggers): one **Deep Dive** tab with named Analytics·Rankings sub-tabs; nothing hidden or Premium-emptied. The contract: depth never bleeds upward (no tables/scores/jargon above the boundary), and nothing on Overview is a dead end (every "see detail" deep-links to the specific sub-tab via `?tab=`).

---

## 5. Multi-location — resolved

**Separate, flag-gated, conditional track — NOT a first-class adaptive segment.** The client-locations module is server-only today (no public serialization, no client read path, no components — true greenfield); a segment engine would be the highest-effort/highest-risk change for the most marginal gain, and a cross-site aggregation is exactly where provenance tiers can get silently blended. When it ships (P5, its own timeline, never blocking P1–P4): leaderboard hero (conditional >1 location) + conditional Locations drill-down (read-only roll-up, honestly labeled — no faked per-location login) + location filter on Inbox/Results. The single-site 6/7 majority never sees any of it. The multi-location persona explicitly endorsed shipping it right as a deliberate second phase over a half-baked first-wave bolt-on.

---

## 6. Phased plan (one PR per phase)

Add flags `client-ia-v2` (nav shell) + `client-locations` (portfolio) to `shared/types/feature-flags.ts` before the first commit; `the-issue-client-spine` already exists.

| Phase | What | Effort / risk |
|---|---|---|
| **P1 — Overview reframe + real MoM delta** *(SHIP FIRST)* | Un-gate the verdict-first spine as default; wire real MoM delta (honest empty-state for new accounts); demote health-score→chip + insights→link; cut predictions/"we called it"/byline; outcome CTAs. **+ gut-check refinements:** typed outcome breakout in the hero + clickable count → named-lead list. | M / med |
| **P2 — Collapse to the 4-tab shell** | Merge performance+search+analytics & strategy+rankings → **Deep Dive** (named sub-tabs, `?tab=` two-halves); rename `roi` → **Results** + promote; fold site-health → chip + pinned Analytics sub-section; `brand`/`plans` → settings (confirm a settings home first). | L / med |
| **P3 — Content + roadmap into Inbox / Deep Dive** | Route content brief/post review → Inbox > Reviews (preserve the deep editor); page-plan approvals → Inbox; cut `content` + `content-plan` tabs; roadmap → collapsed Deep Dive > Rankings. | M / med |
| **P4 — Overview Share/Export + per-piece attribution** (grafts A/B/D) | "Share this view" on Overview + Results; approvals → Results attribution. **Gate D:** provenance label + banded `~$` MUST render in the export (cropping "estimate" or showing count×rate as an exact dollar is release-blocking). | M / med |
| **P5 — Multi-location track** *(separate, non-blocking)* | Leaderboard hero (conditional) + Locations drill-down + location-tagged Inbox/Results. Gate D: no cross-site provenance blending. | L / high |

---

## 7. Persona gut-check on the winning plan

The 7 client personas reviewed the **synthesized** winner (the artifact no team/judge had seen — the open loop). **Result: 5 `serves_me`, 2 `mostly`, 0 `dropped_something` (no blockers).**

| Persona | Verdict | Note |
|---|---|---|
| Churned skeptic | **serves_me** | Read the real code; praised that the dollar is *banded* even on a measured count ("self-suspicion I want from a vendor"); provenance inline, kill-the-move in Inbox, math in Results. |
| VC / board | **serves_me** | Money frame gets two homes (hero + Results); "Share this view" closes the shareability gap. |
| SaaS marketer | **serves_me** | Lever lists intact + one click deep in Deep Dive > Analytics, not Premium-gated; Results stays standalone; health pinned alongside the tables. |
| Consulting marketer | **serves_me** | Approve-before-publish editor fully preserved in Inbox; roadmap-as-collapsed-sub-section is fine ("a glance-at, not a do-work view"); authority signal is real, not a teaser. |
| Multi-location operator | **serves_me** | Leaderboard + drill-down is the exact ask; prefers it shipped right as a deliberate second phase over a half-baked bolt-on; read-only roll-up is fine for now. |
| SMB founder / check-signer | **mostly** | Wants the hero count **clickable to the actual lead list** ("show me the 12") — receipts, not just an honesty label. → **folded into P1 (refinement #2).** |
| Local dentist | **mostly** | Wants calls vs **new-patient bookings broken out** (not a blended "leads") with the delta on bookings. → **folded into P1 (refinement #1).** |

Both `mostly` notes are cheap hero refinements reusing existing features (P1a typed breakdown, P1b named-leads), now in P1. **The full evaluative persona review is deliberately deferred to the built surface** (flag-ON, real data) per the verification rule — a paper plan can't surface "this empty state feels broken."

---

## 8. Open owner decisions (none block P1)

1. **Deep Dive label** — "Deep Dive" is the synthesis pick (replacing the vague "Explore"). Owner may prefer "Details" / "The Numbers" / "Insights." Brand-voice call.
2. **Consulting Content tab — fast-follow or never?** Cut for now (action preserved in Inbox). If post-launch consulting churn signals the lost *browse* matters, a single conditional Content tab (not the full segment engine) is the cheap remedy. Pre-commit or wait for signal?
3. **Settings/account home exists?** P2 moves `brand`/`plans` there — confirm a coherent destination exists, or build a minimal one. *(Blocks P2.)*
4. **Multi-location priority** — P5 right after P4, or defer until single-site IA is validated in production? (Must not block P1–P4.)
5. **Banded-`$` export wording** — the exact honesty phrasing on a board-bound export ("~$X, estimated from measured conversions"). *(Blocks P4.)*

---

## 9. Acceptance criteria (per phase, testable)

**Global (every phase):** typecheck + vite build + full vitest + pr-check + `lint:hooks` clean. **Flag-OFF byte-identical** DOM snapshot vs pre-change `main`. **Flag-ON real-render smoke** through `GET /api/public/workspace/:id` (the real client read path).

- **P1:** active account renders a non-null signed MoM delta + inline provenance; new account renders the honest "establishing your baseline" + NEVER a fabricated delta (both fixtures); composite score/predictions/byline absent flag-ON; hero outcome is **typed-broken-out** (calls vs form-fills) and the count **deep-links to the named-lead list**.
- **P2:** Deep Dive renders both named sub-tabs; `?tab=analytics|rankings` deep-link honored; the Analytics merge preserves GSC query/page tables + keyword cuts + per-event trends (assert lever lists present); `roi`→Results redirect; `brand`/`plans` absent from weekly nav.
- **P3:** content review reachable in Inbox > Reviews with the deep editor feature-complete (assert editor capabilities, not just presence); `content`/`content-plan` tabs absent + redirect; roadmap default-collapsed in Deep Dive > Rankings.
- **P4:** export artifact contains the provenance label + banded `~$` (assert "estimate/measured" qualifier present, count×rate never an unqualified exact dollar) — release-blocking; per-piece attribution number matches the measured source (no fabricated value).
- **P5:** single-site account: leaderboard/Locations/filters ALL absent; portfolio account: leaderboard worst→best + per-location drill-down + filters function; no cross-location provenance-tier blending.

---

**Bottom line for the owner:** Ratify the **4-tab two-speed shell** (Overview · Inbox · Results · Deep Dive + conditional Locations), grafts folded in, validated by the personas (5 serves / 2 mostly / 0 blockers). **Ship P1 first** — the Overview reframe + real MoM delta + the two hero refinements. Decisions in §8 are real but none block P1. Next step on your go: `pre-plan-audit` → `writing-plans` for P1.

*Tournament: 3 teams → 5 judges → head-judge synthesis. Gut-check: 7-persona light pass on the winner. Structured data: `2026-06-21-client-ia-tournament.verdicts.json`.*
