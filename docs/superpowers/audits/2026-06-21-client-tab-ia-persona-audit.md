# Client Dashboard IA — Persona Audit (simplification + progressive depth)

**Date:** 2026-06-21
**Mode:** persona-audit (evaluative + generative hybrid) — via the `persona-audit` skill (7-persona panel over a code-grounded map of all 11 client tabs).
**ADVISORY ONLY — no code was changed.** For owner review; resolutions go through the normal spec → plan → build cycle.
**Tested:** the owner's proposed simplification (`overview · content · analytics+performance · rankings/keywords · site-health · inbox`) + the philosophy "a dashboard the client looks forward to opening weekly but doesn't have to — busy client lives on the overview; interested client digs deeper."
**Panel:** the 7 client discovery personas — non-marketing SMB founder/check-signer, local dentist, churned skeptic, VC/board reviewer, in-house SaaS marketer, professional-services/consulting marketer, multi-location operator.

---

## Bottom line

Your instinct to go **11 → ~6** is right and the panel backs it. Two adjustments make it land:

1. **The Overview reframe is worth more than the tab cuts combined — do it first.** Verdict-first (real leads/calls/form-fills this period vs last + honest provenance), wire a real month-over-month delta, and demote the composite health-score / predictions / "we called it" theater. The spine already exists in The Issue build — it's gated behind the legacy composite-score wall and its MoM delta is hard-coded null ("establishing your baseline").
2. **Swap your standalone `content` tab for a standalone `Results` tab.** The panel wants content *review* to live in Inbox (where the approve-before-publish action already is) and ROI to be a first-class, **shareable** destination — three personas call ROI the single screen they'd forward to a boss/board, and the owner's 6-tab list silently drops it.

**Recommended shape: `Overview · Results · Analytics · Rankings · Inbox`** + `brand`/`plans` in settings — **5 weekly tabs, every one tied to a real client goal.** Treat **multi-location** as a separate IA track, not a blocker.

---

## Headline findings

**1. The Overview reframe is the whole ballgame, not the tab count.** 6/7 personas rated the proposal `needs_changes` (1 `wrong_for_me`) — but almost none objected to *fewer tabs*. They objected to **what leads the Overview.** Every glance-and-go persona (checksigner, dentist, vc-board, skeptic) independently asked to kill the composite 0–100 health score, the 15+ insight feed, predictions/"we called it," and the "curated by your strategist" byline — and lead with a **measured outcome line + agency-work-shipped + honest provenance label.** That single change satisfies more persona pain than the entire tab reshuffle.

**2. Two cuts the owner treats as optional are consensus-critical, and one merge is a silent regression.**
- **ROI must not be folded away.** The 6-tab list drops a standalone ROI/Value surface — but skeptic, vc-board, *and* saas-marketer flagged that as the change that would make them distrust the simplification ("kill the ROI tab and I lose the one screen I show my boss"). ROI is the proof spine, not a sub-section.
- **Site-health standalone splits the panel** — 5 want it folded to a chip, 1 (saas) wants it kept.
- **The multi-location operator is structurally stranded** by *any* single-workspace IA — disqualifying for that segment, confirmed in code (client dashboard is single-workspace; locations exist only admin-side). A separate track, not a tab-tuning issue.

---

## Recommended client IA (5 primary tabs + settings)

| Tab | Client goal it serves |
|-----|-----|
| **Overview** | Verdict-first home: leads/calls/form-fills this period vs last (real counts, honest provenance), what the agency shipped, traffic direction in one sentence, site-OK chip, action banner deep-linking into Inbox. *The only screen the busy client needs.* |
| **Results** (rename `roi`, promote) | The money/proof spine as a first-class, **shareable** destination: conversion count → organic value → return-on-retainer → "since we started" delta → one-click methodology. *The artifact forwarded to a boss/board.* |
| **Analytics** (merge `performance` + `search` + `analytics`) | One deep tab for the engaged month: GSC query/page tables, keyword-insight cuts, traffic/sources/events; site-health detail as a sub-section. *Confirm visibility/traffic are moving right; pull quick-win levers.* |
| **Rankings** (merge `strategy` + keyword/rankings) | Where the engaged client steers strategy: page→keyword map, validate/decline keywords, content gaps, competitor/authority signal. *Guide what the agency prioritizes.* |
| **Inbox** | The one do-work tab: approve/request-changes/decline content, briefs, posts, keyword decisions; apply-to-site; conversations. *Act on everything pending in one place.* |
| *Settings/account* | `brand` (contact/NAP) + `plans` (billing/upgrade) — touched rarely, not weekly nav. |

**Vs the owner's proposal:** ADOPT the analytics+performance and rankings/keywords merges + Overview-as-home (consensus). REFINE: fold site-health rather than standalone it (5/7; one dissent). DIFFER: cut the standalone `content` tab, add a first-class `Results` tab (panel wants the inverse of the owner's content-keep/ROI-drop). Net is still simpler — **5 tabs, not 6.**

---

## Current-11 → proposed mapping (with what's lost)

| Current | Action | What is LOST + who loses it |
|---|---|---|
| overview | **KEEP + reframe** verdict-first | If the legacy composite-score body stays the default, every glance-and-go persona loses trust. The reframe is the point. |
| performance | **MERGE → Analytics** | Nothing if the merge preserves GSC query/page tables + keyword-insight cuts + per-event trends. Risk: a sloppy merge that keeps chrome and drops the lever lists (saas-marketer's core value). |
| search | **MERGE → Analytics** | Redundant today (Performance already fuses Search+Analytics). Low-hanging-fruit / CTR-opportunity cuts must survive (saas + consulting). |
| analytics | **MERGE → Analytics** (anchor) | Nothing — it's the destination. |
| health | **FOLD → Analytics sub-section + Overview chip** | Discoverability of the fix list/cart drops a click. saas-marketer (only standalone user) loses fastest access. *Contested — §below.* |
| strategy | **MERGE → Rankings**; route keyword approve/decline → Inbox | Lost: the effort-matrix framing (intentional — busy personas call it busywork). Kept: page→keyword map + validate/decline. Consulting wants a *stronger* authority signal than exists. |
| inbox | **KEEP** standalone (non-negotiable, 7/7) | Nothing. Absorbs content brief/post review + keyword decisions. |
| plans | **CUT from weekly nav → billing link** | Nothing weekly (7/7 never-touched). Keep upgrade path reachable. |
| roi | **KEEP + rename → Results + promote** | If folded (owner's implicit plan): skeptic, vc-board, saas-marketer lose their single most-valued surface. Keeping it standalone is a consensus requirement. |
| content-plan | **CUT as tab → page approvals → Inbox; roadmap folds into Rankings if anywhere** | Consulting loses the bird's-eye roadmap *view* (their *action* moves to Inbox). Every other persona calls it effort-signaling. |
| brand | **CUT → account settings** | Nothing weekly (7/7 never-touched). |

---

## Progressive-depth verdict

**Overview stands alone for glance-and-go?** Today: no/partly. **After the reframe: yes** for checksigner, dentist, vc-board; "launchpad" for skeptic — *only if* the Overview adds/promotes:
1. **Real outcome counts as the hero** (the `OutcomeCountBand` spine).
2. **A real month-over-month delta** — wire `baseline`/`priorPeriod` so it reads "41 calls, +9 vs last month," not "establishing your baseline." *For glance-and-go, "is it more than last month?" IS the product.* The hard-coded null is the single highest-leverage fix.
3. **Honest provenance label kept visible** (estimate / measured / reconciled) — strip it and skeptic + vc-board call it fluff.
4. **Agency-work-shipped surfaced** (not buried in a sidebar) — checksigner: "show me what the agency did."
5. **Demote, don't delete:** health score → chip; insight feed → "more detail" link; predictions / "we called it" / curated byline → cut.
6. **Outcome-language CTAs** ("Get more patient calls," not "Find Keywords").

**Deep tabs optional-not-abandoned for the diggers?** Yes — saas + consulting *expect* overview-as-launchpad with fast drill-in. Conditions: (a) the Analytics merge must not drop the query/page lever lists; (b) Rankings must carry a real authority signal, not a Premium-gated keyword-gap teaser.

**Who gets stranded?** The **multi-location / franchise operator**, structurally, by any single-workspace IA (confirmed in code). Not fixable by tab-tuning — a separate track (location leaderboard on Overview + a `Locations` drill-down + location-tagged Inbox/Results). The simplification is *correct for single-site clients and disqualifying for portfolio operators.*

---

## Consensus vs contested

**SAFE — ship without an owner call (every relevant persona agrees):**
- Cut `brand` → settings (7/7 never-touched).
- Cut/bury `plans` → billing link (7/7).
- Merge `performance` + `search` + `analytics` → one Analytics tab (universal; even diggers want one combined tab).
- Merge `strategy` + keyword/rankings → one Rankings tab (universal).
- Reframe Overview to lead with measured outcomes + provenance; demote/cut the composite health score, predictions, "we called it" (all 4 glance-and-go personas; diggers neutral-to-positive).
- Keep Inbox standalone (7/7).

**CONTESTED — explicit owner call:**
- **Standalone `content` tab vs route-to-Inbox** — consulting wants a deep content surface; everyone else calls it busywork. *Lean: cut the tab, keep the deep brief/post-review pipeline inside Inbox (satisfies consulting's actual action). Verify with the content-heavy segment.*
- **Site-health: fold vs standalone** — 5 fold, 1 keep (saas), 1 indifferent. *Lean: fold to Analytics sub-section + Overview chip.*
- **`content-plan` roadmap grid** — cut for 6/7; consulting loses the bird's-eye *view* (not the action). *Owner call: roadmap view as a Rankings sub-section, or is per-page approval in Inbox enough?*
- **ROI placement** — not contested in *value* (3 personas load-bearing), only vs the owner's implicit fold. *Lean: keep standalone as `Results`.*

---

## Effort / risk + phasing

| Change | Effort | Flag-gateable | Risk |
|---|---|---|---|
| Verdict-first Overview as the **default** render (un-gate the spine) | S–M | ✅ (flip flag default) | Low — code exists; demote-not-delete limits blast radius |
| **Wire real MoM delta** (drop "establishing your baseline" for active accounts) | M | ✅ | Med — data plumbing + honest empty-state for new accounts. **Highest-value item.** |
| Demote health score→chip; insights→"more detail"; cut predictions/"we called it"/byline | S | ✅ per element | Low |
| Outcome-language CTAs | S | ✅ | Low |
| Merge performance+search+analytics → Analytics | M | ✅ | Med — *must* preserve query/page tables + keyword cuts + per-event trends |
| Fold health → Analytics sub-section + Overview chip | M | ✅ | Med — keep fix-list discoverable; contested |
| Merge strategy+rankings → Rankings; keyword decisions → Inbox | M–L | ✅ | Med — Inbox routing is the fiddly part |
| Rename roi → Results + promote | S | ✅ | Low — mostly nav/labeling |
| Content brief/post review → Inbox; cut content/content-plan tabs | M–L | ✅ | Med–High — don't dumb down the deep brief/post editor (consulting's fear) |
| brand + plans → settings/account | S–M | ✅ | Low |
| **Multi-location IA** (leaderboard + Locations tab + location-tagged Inbox/Results) | L | ✅ | High — net-new dimension; **separate track** |

**Phasing:** **P1** = Overview reframe + MoM delta (highest value, mostly flag-flip + plumbing, low risk). **P2** = the two safe merges + brand/plans → settings. **P3** = Results promotion + content→Inbox + health fold (contested/heavier, after owner calls). **Multi-location = separate track.**

---

## Per-persona panel

| Persona | Lean | Opens weekly | Never touches | Cannot lose | Proposal | Overview alone? |
|---|---|---|---|---|---|---|
| SMB founder / check-signer | glance | overview, inbox | search, analytics, strategy, content-plan, brand, plans, performance | Plain-English "is my money working" (real leads/calls vs last month) | needs_changes | partly |
| Local dentist | glance | overview, inbox | everything else | Outcome count in plain words (calls + new-patient bookings vs last month) | needs_changes | partly |
| Churned skeptic | glance | overview, inbox, roi | plans, brand, content-plan, analytics, performance, strategy | Measured-outcome verdict **with provenance label** | needs_changes | partly |
| VC / board | glance | overview, roi | almost everything | Verdict-first money frame (org value, return-on-retainer, provenance) | needs_changes | partly |
| SaaS marketer | digs deep | overview, performance, search, roi, strategy, inbox | brand, plans, content-plan | Keyword/query drill-down (GSC tables + low-hanging-fruit/CTR cuts) | needs_changes | no |
| Consulting marketer | digs deep | inbox, content-plan, strategy, performance | plans, brand, health, analytics | Approve-before-publish on the actual article + brief E-E-A-T | needs_changes | no |
| Multi-location operator | mixed | overview, inbox, roi, performance | brand, plans, content-plan, search, analytics, strategy, health | A location leaderboard (worst→best in one screen) | **wrong_for_me** | no |

**Verbatim signal:** *Dentist* — "Just tell me how many people called or booked from Google this month and whether that's more than last month — everything else is your job." *VC* — "Show me the dollar value of organic, what it cost, and whether that number is real or a guess." *SaaS* — "Kill the ROI tab and I lose the one screen I show my boss." *Multi-location* — "If I can't see which three of my twelve locations are bleeding in one screen, your dashboard is a report card for a store I never asked about."

---

## Fast-follows / out-of-scope

- **Multi-location / franchise IA** (separate track, L): location leaderboard + `Locations` drill-down + location-tagged Inbox/Results. Without it, portfolio operators stay unserved.
- **Authority / E-E-A-T signal in Rankings** (M): consulting + saas want backlink/DA trend and "who outranks us" — today thin/Premium-gated (Growth sees an empty placeholder; stop showing it).
- **Per-published-piece outcome attribution** (M): "did the article I approved earn clicks" — connects approvals → Results.
- **Provenance honesty for new accounts** (S): keep the explicit "establishing your baseline" state when nothing is measured — do not fabricate a delta.
- **Settings/account home** (S): confirm a coherent destination exists before cutting `brand`/`plans` from nav.

---

*Generated by the `persona-audit` skill (Map → 7-persona Panel → Synthesize). Structured per-persona + per-tab data: `2026-06-21-client-tab-ia-persona-audit.verdicts.json`.*
