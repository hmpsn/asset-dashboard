# Strategy v3 — Consolidated UX Recommendations

**Date:** 2026-06-17
**Role:** UX synthesis chair (consolidating five specialist lens audits over the Strategy-v3 mockups)
**Lenses:** (1) Information Architecture & Grouping · (2) Cognitive Load & Density · (3) Client Engagement & Adoption · (4) Admin Workflow Ergonomics · (5) Visual Hierarchy, Brand & Clarity
**Surfaces reviewed:** `admin-cockpit-polished.html` (curation cockpit / Act queue) · `client-overview-v2.html` (curated client overview) · `client-overview.html` (standalone variant) · `client-delivery-model.html` (D1 A/B/C) · `scope-map.html`
**Companion doc:** [RECOMMENDATION.md](./RECOMMENDATION.md) (architecture/feasibility synthesis — the spine this UX layer rides on)

This doc consolidates the five UX audits into a buildable spec. It leads with the **grouping verdict** (Josh's core "not one massive list" worry), then tiers the changes by cross-lens consensus, then resolves where auditors disagreed.

---

## 1. THE GROUPING VERDICT (Josh's "not one massive list" question)

**Answer: HYBRID, on BOTH surfaces. Not grouped sections. Not a pure ranked list + filter chips. A small, capped, always-visible priority anchor pinned above an impact-ranked, count-labeled, faceted list.**

This is **unanimous across all five lenses** — the single highest-consensus finding in the entire committee. Every auditor independently arrived at the same model and the same name for it:

| Surface | The pinned anchor | The body below it |
|---|---|---|
| **Admin cockpit (Act queue)** | `Fix now · N` — hard-capped at ~5, the critical/`fix_now` band, **always visible regardless of the active category chip** | impact-ranked, count-labeled, **faceted** list (filter chips) |
| **Client overview** | `Needs your decision · N` — the decision-state group that always leads when recs > ~3 | the curated finite set (≤5 visible), then a `done` terminator |

### Why NOT grouped sections
Splitting Sent / Throttled / Struck (admin) or status-buckets (client) into separate stacked sections **re-introduces the exact multi-card sprawl this redesign is killing** (Lens 1, Lens 2). The lifecycle states should render as **visual strata _inside_ one list** — the opacity ramp (1.0 active → .92 sent → .62 struck) + colored nudge bands the mockup already nails. The chips ARE the sectioning; rows render their state inline.

### Why NOT a pure ranked-list-with-chips
Filter chips are **necessary but not sufficient** (Lens 1's central ruling). They make any single facet short, but the moment the operator clicks a category chip (e.g. "Content"), the impact ranking **re-bases inside that category** and the cross-category "what's on fire right now" signal is lost. A pure ranked list has no stable, always-visible "do these N emergencies first" anchor. At 144 active recs the page **looks** organized (chips, counts, opacity strata) yet the operator still can't answer "what are my 3 real emergencies" without expanding and mentally re-sorting. That is the same cognitive wall in better clothing.

### Why the hybrid wins
It is the only model that survives BOTH the 144-item reality AND the category-filter interaction without losing the "what's on fire" signal — while keeping the engaging, finite, curated feel. The pinned anchor is cross-cutting (ignores the active filter); the faceted body handles throughput.

### Page grouping (top-level IA) — LOCK these
1. **Admin:** the cockpit ("What to do next") **IS the Overview tab's hero**, sitting below the Orient zone — it is NOT a separate surface. The mockup shows the Act queue full-width with no tab chrome, leaving the cockpit-vs-tabs relationship structurally ambiguous. **Resolve explicitly in the spec and render the tab bar in the cockpit** so the operator's location is never ambiguous. (Lens 1)
2. **Admin 4-tab interior IA** (Overview / Content / Rankings / Competitive) is sound — it pre-segments by domain before any list renders, which is the primary defense against sprawl. **But lock the `Rankings → "Keywords & Rankings"` rebalance** (move Site Target Keywords + Keyword Opportunities there) so no tab renders near-hollow. An IA with a hollow tab teaches users not to click it. Fix the cut; don't ship the imbalance. (Lens 1, feedback #11)
3. **Client overview vertical order (D6b):** `Briefing recap → Layer-1 stand-card → Layer-3 curated recs → finite done-state`. The v2 mockup **opens cold on the stand-card and omits the Briefing entirely** — restore it. The stand-card is the DATA layer; the narrative recap introduces it. (Lens 1, Lens 2, Lens 3 all flag this independently.)
4. **Apply the SAME hybrid pattern inside every interior admin tab** (small priority/summary header + faceted-or-finite list) so the grouping language is consistent tab-to-tab. Consistency of the grouping model IS wayfinding. (Lens 1)

---

## 2. MUST-DO (high consensus, high impact — bake into the spec)

These are the changes 3+ lenses flagged independently, or that a single lens flagged as a hard brand-law / trust violation. Ship none of the mockups' code without these.

### M1 — Pin the hybrid priority anchor on both surfaces *(Lens 1, 2, 3, 4 — unanimous)*
Implement the grouping verdict above. Admin: `Fix now · N` capped at ~5, always visible across category filters. Client: `Needs your decision · N` leads when recs > ~3; ≤3 stays flat. This is the single change that resolves the "one massive list / can't reach the bottom" fear (feedback #3) on both halves.

### M2 — Counts on EVERY facet, so triage never requires expanding *(Lens 1, 2, 4)*
Put a live count on every category chip (`Content 41 · Technical 12 · Quick wins 9`), on the `Fix now` header, and on the client `Needs your decision (N)`. Both operator and client must answer "how many true emergencies / asks do I have" **without expanding anything**. Directly kills feedback #3's "impossible to get to the bottom."

### M3 — Split the two conflated chip axes *(Lens 1, 2, 5 — flagged by three lenses as an interaction-ambiguity bug)*
The cockpit currently mixes lifecycle counts (Active / Sent / Approved / Throttled — mutually-exclusive status) and category filters (Content / Technical / Quick wins — additive) on **one flex row separated only by a spacer**. The user cannot predict whether clicking "Content" clears "Sent" or stacks. Fix:
- **Left axis (lifecycle):** pill-style **segmented control, single-select**, with the active count baked in.
- **Right axis (category):** outlined **toggle chips, multi-select**, each carrying its own count.
- Separate with a divider or `Filter:` label — never one undifferentiated row.

### M4 — **HARD BRAND-LAW FIX: remove violet (`#a78bfa`) from the admin "Struck" state** *(Lens 5 — must-fix before any code copies the mockup palette)*
CLAUDE.md forbids the violet/indigo hue family outright; purple is admin-AI-only (AdminChat / SeoAudit). A lifecycle status is not AI. This will fail `grep -r "violet"` in pr-check. Use **muted-zinc or red-muted** for the struck/retired state (struck rows are already at .62 opacity — lean on that). **Doubly wrong, doubly cheap to fix.**

### M5 — **HARD BRAND-LAW FIX: score-ring color band** *(Lens 5 — trust-critical)*
The client ring fills **emerald at score 64**. Per `scoreColor()` / `scoreColorClass()`, 64 is the **AMBER band** (≥60 → `#fbbf24`); emerald is **≥80 only**. Painting a 64 success-green misrepresents health and breaks Law 3 — and a client who later learns they were "in the amber" loses trust. Drive **both ring fill and numeral** from `scoreColor()`. **Keep the `▲ +5 this month` trend in emerald** — this tells the truer story: amber score, positive momentum.

### M6 — Separate paid vs free CTAs + add a no-commit preview *(Lens 2, 3, 5 — three lenses, trust + monetization)*
`Add to plan · $499` and `Approve refresh` are currently **identical teal-gradient primaries**, but one spends money and one is free. A client can fat-finger a purchase and feel tricked.
- Included actions (`Approve refresh`) → **solid teal-gradient primary**.
- Paid add-ons (`Add to plan`) → **teal-OUTLINE secondary**, price as a visible chip **next to the impact band, NOT buried inside the button label**, plus a `See what's included →` / `Preview the plan` ghost link, and a confirm/hover step on the priced commit.
- Never let the only path on a paid item be a hard-priced button.

### M7 — Bulk operations in the cockpit — THE operator job is a batch *(Lens 4 — flagged as the #1 ergonomic gap)*
The operator's literal job is "curate a handful out of 144, repeatedly," yet every action is one-row-at-a-time (Strike 30 technical recs = 30 clicks). Add:
- **Multi-select:** checkbox per row + `select all in current filter` + shift-click range.
- **Sticky bulk-action bar** on selection: `Send N to client` / `Throttle N` / `Strike N`.
- This converts a ~100-click cycle into ~5 clicks — **the single highest-leverage change in the cockpit.** The current design polishes the per-row interaction while ignoring that the JOB is a batch.

### M8 — Kill "Show 139 more"; add sort + lead with the top slice *(Lens 1, 2, 4 — three lenses)*
"Show 139 more" recreates the exact infinite-scroll wall feedback #3 complained ABOUT. Replace with:
- **A sort control** (by $ value / impact / age) so the highest-value recs are always at the top and the operator **never has to reach "the bottom."**
- A curated **TOP slice** as the default view (e.g. top 8–10 by value with Send prominent), gating the long tail behind explicit `See all 144`.
- (Density note from Lens 2: the cockpit default can show ~8–10 rows — the operator wants density; ~5 belongs on the *client* surface, not here.)

### M9 — Make Strike always-reversible / two-stage on EVERY rec *(Lens 4 — misfire risk on a speed-scanned list)*
Strike writes a permanent `don't re-suggest` suppression (the `keyword_feedback` declined-row design) even for CTR/technical recs — that IS a downstream consequence (the operator never sees that rec type again). An instant, no-confirm Strike on a fast-scanned 144-row list is a misfire waiting to happen. **Arm-then-confirm inline everywhere** (`Strike — won't be re-suggested · [confirm] [cancel]`), keep `[Undo]` on struck rows. Reserve the heavier one-line confirm only for cascading keyword strikes.

### M10 — Promote the "proof it's working" win to a HERO *(Lens 3 — the single strongest retention element, currently a footnote; Lens 1 & 5 concur)*
The win (`the page we refreshed is +30%`) — the literal answer to "is this worth paying for?" — is demoted to a thin one-line tinted banner in the stand-card footer, visually weaker than the four read-only stats. D6b explicitly elevated WinsSurface ("we called it") to a **featured** proof element. Make it a **full-width emerald proof-strip directly under the headline, ABOVE the four stats**, with explicit **`we recommended → you approved → here's the result`** three-step micro-attribution so the client viscerally connects their own past Approve click to the payoff. Make wins **structurally outrank stats**. (Respect the D6b empty-state-suppression rule: show only when a real attributed win exists.)

### M11 — Design the quiet/empty month as a first-class reassuring screen *(Lens 3 — named the single biggest retention risk)*
Every mockup depicts a rich, busy month. An agency client's actual experience is **mostly quiet months — exactly when they churn.** With the win demoted to a conditional footnote (and required to hide when empty), the Briefing absent, and the rec list empty, a quiet month collapses to a bare ring + a lonely `✓ that's everything` line — which reads as *"did they forget about my account / what am I paying for?"* The finite done-state is brilliant in a busy month and **dangerous in an empty one.** When `recs=0`:
- Keep the stand-card + a **featured past win**.
- Replace the rec list with a deliberate, substantial reassurance: *"Nothing needs your decision this month — your team is heads-down executing the 2 things you already approved. Next check-in: [date]."*
- **Show in-progress approved work** so "quiet" reads as "they're working," not "they vanished."
- The page must **never collapse to a hollow shell.**

---

## 3. SHOULD-DO (strong single-lens or two-lens consensus, clear value)

### S1 — Reduce the client micro-status line from four crammed states to one ask *(Lens 1, 2, 3, 5)*
`4 from your team · 1 approved · 1 in discussion · 2 waiting on you` crams four states into one 13px gray run; `waiting on you` (the only ask) is buried last and visually identical to passive states. Lead with the **only number that requires the client** (`2 need your decision`, teal/bold); demote already-handled counts (approved / in discussion) to a muted secondary line or hover. Make the header micro-line the **single source of truth for status vocabulary** — every card pill must map to exactly one token in it (today `waiting on you` has no matching card pill).

### S2 — Fix at-rest density of the admin row *(Lens 2, 4, 5)*
- **Demote Throttle + Strike into a `⋯` overflow menu**, leaving **Send (primary) + Fix (secondary)** as the only standing buttons — cuts per-row button density nearly in half across 144 rows and reserves visual weight for the most-run action.
- **Make the send-note panel a click-to-open disclosure** — never render it expanded at rest (the mockup shows it open inline, nearly doubling the first row's height and pushing the queue down).
- **Single-line clamp the why/how/result string** (ellipsis on `How:`, full text on row-expand) so every active row is **uniform height** — uniform height is what lets an operator scan 144 items without re-anchoring.

### S3 — Promote D4 self-managing nudges into a pinned "Needs your attention" strip *(Lens 4)*
The stale / superseded / newly-replied nudges are currently passive counts buried behind the Sent filter. Aggregate them into a **pinned strip at the top of the cockpit** (`these 4 sent recs went stale · these 2 got client replies`) so the operator sees the loop's follow-up decisions **on open**, without hunting. **Render nudge actions as real buttons** (same pill style, smaller), not bracketed text links — today they look like inert annotations. Add attention badges to status chips (`Sent 6 · 2 stale`, `Approved 3 · 1 new`, red = new reply, amber = stale). Show the auto-resurface clock on throttled rows (`Throttled · resurfaces in 23d`) so throttle reads as a snooze, not a black hole.

### S4 — Make "Discuss" the EASIEST action, not the weakest *(Lens 3, 5)*
The lowest-commitment, highest-trust action (just ask a question) is currently a muted ghost button and a navigate-away dead-end; the in-discussion card has no input affordance. Give every rec a one-tap inline **`Ask a question`** composer (no navigation), and on in-discussion cards show the latest strategist reply inline with a reply box. Lowering the cost of the safe action is the **biggest lever for engaging hesitant clients** who aren't ready to approve or buy. Give the in-discussion card a real footer (a `View thread →` button + left accent rule) so its non-actionable status is structural, not just textual.

### S5 — Restore the segmented progress bar as the finite-list signal *(Lens 1, 2, 5)*
The standalone `client-overview.html` had a 3-segment progress bar (approved / discussing / waiting) — the strongest 5-second "here's your finite part" device — and the v2 mockup dropped it. **Pick ONE finite-list signal, not two:** the progress bar OR the micro-count line. The progress bar is the stronger grok device; if kept, reduce the micro-line to a single emphasized `waiting on you` count.

### S6 — Cap the CLIENT curated list at ~5 with a `View N more` expander *(Lens 2)*
3 recs is the happy path, but the mockup gives no answer for an 8-rec month. The finite, scannable list **IS the product** — never let the curated surface itself paginate at the moment of engagement. Cap at ~5 visible, expander for the rest, and keep the `that's everything that needs a decision` terminator as the **reward state when nothing is hidden.**

### S7 — Set a vertical priority budget on the client overview *(Lens 2, 3)*
The first decision-requiring rec must land within **~1.5 screens**. If `Briefing + Layer-1 + recs` can't fit, compress Layer-1 to the lean stand-card (ring + one inline stat line + conditional win) and push the full Briefing one scroll down — **the decision must outrank the recap.** Apply the D6b `hide-when-empty` rule ruthlessly to every Layer-1 / Briefing / Wins block so a quiet month gets **SHORTER, not hollow.** (This is the antidote to Lens 2's "biggest risk": the finite-list/empty-suppression discipline is applied to the recs but must also apply to the data blocks above them.)

### S8 — Admin cross-tab deep-link chips (rec → its evidence tab) *(Lens 1)*
Recs live on Overview but their evidence (cannibalization, clusters, backlinks) lives on Content / Competitive. The admin counterpart to the client's `?rec=` inline pointers: every Act-queue row referencing tab-owned evidence carries a **deep-link chip** into that tab's triage. Without it, the cockpit forces blind curation or tab-hopping.

### S9 — Add a "preview as client" affordance on the Send panel *(Lens 4 — admin↔client loop)*
The operator sends **blind** — the cockpit row shows admin framing (`Refresh /blog/... · CTR 0%`); the client sees a fully reframed card (`Refresh your top guide before it slips further`). For a "narrative-control" product this is a real gap and the renderer **already exists.** Show the reframed client card inline before commit so the operator verifies the narrative — and can confirm whether the month will read as empty/hollow before shipping it.

### S10 — Add a "Share a win" lever in the cockpit *(Lens 3, 4)*
The note-on-send is framed entirely around recommendations/asks; there's no equivalent "send good news" action. The client surface needs a steady supply of wins (for M10's hero proof-strip) and **that supply must originate in the cockpit.** Without it the client side skews toward "here's more to approve/buy" over "here's proof it worked" — inverting the trust ratio that drives retention.

---

## 4. CONSIDER (lower consensus, judgment calls, or polish)

- **C1 — Differentiate action pills with leading icons** (paper-plane / wrench / clock / strike-through) so they're distinguishable pre-attentively, not just by reading labels. *(Lens 4, 5)*
- **C2 — Three fixed, color-coded tag slots per admin row** `[severity] [value] [lifecycle]`, always same order/colors, so the operator parses **position not just color** — today red/blue/emerald pills float in one cluster with no positional semantics. Add a thin **left-edge lifecycle accent rail** (teal=active, emerald=sent, blue=superseded, muted=struck). *(Lens 5)*
- **C3 — Keyboard ergonomics for the speed loop:** `j/k` row nav, `s`=Send, `t`=Throttle, `x`=Strike (armed), `Enter`=confirm, `Esc`=cancel. An operator running this weekly will live in the keyboard. *(Lens 4)*
- **C4 — One-keystroke "Send now"** on the inline panel (Enter submits, Esc cancels) so the no-note path (the common case) is zero extra clicks. *(Lens 4)*
- **C5 — Widen the client type ramp** so page > section-label > card-title is three clear tiers: h1 → 22px/700, card titles → 15px/600, and **promote `Recommended this month` from a 12px uppercase footnote to a real h2 (16–17px sentence case)** — it's the second-most-important thing on the page styled as a tertiary label. *(Lens 5)*
- **C6 — Crown a hero stat** in the client 4-stat strip: make **Clicks** the hero (24px, it's the value proxy), demote Impressions/Keywords/Avg-position to 16px, and replace tiny `▲` glyphs with a proper `TrendBadge`. Or demote the whole strip to one inline line (`10.5k clicks · 941k impressions · #4.2 avg`) so recs sit higher. *(Lens 2, 5)*
- **C7 — Collapse redundant positive-affect signals:** ring trend + per-stat `▲` arrows + win bar are **three** "improving" cues. Keep the ring trend as headline proof, **drop the per-stat arrows** (they imply every stat moved up — won't always be true, erodes trust), keep the win bar only on a real attributed win. *(Lens 2, 5)*
- **C8 — Inline-pointer hygiene:** render the client inline pointer **only** when that screen has a live curated rec (no `0 recommendations` hollow state, per D6b); aggregate to one chip per screen (`N recommendations here →`), never stack multiple. Add a contextual back-link on each rec card (`seen on your /blog/... →`) so the D1 blend is bidirectional. *(Lens 2, 3)*
- **C9 — "Bulk Throttle the rest for this month"** escape hatch + a "this cycle" curation meter (`4 sent this month · a healthy curated set`) so the operator can declare the cycle done and gets feedback they're hitting the finite-handful north star instead of quietly recreating a wall. *(Lens 4)*
- **C10 — Band the cockpit into "To curate" (Active) vs "In flight" (Sent/Approved/Throttled)** as a structural divider so the operator isn't mode-switching row-to-row between raw triage and client-lifecycle management. Keep it one surface (honors D3). *(Lens 4)* — **see Conflict #2 for the tension with the unified hybrid model.**
- **C11 — Don't carry `[Approve]` bracketed pseudo-buttons forward** from the brainstorm mockups into the build — map every affordance to a real `Badge`/`Button` primitive. Keep the scope-map Four-Laws color-key as the canonical legend pattern. *(Lens 5)*

---

## 5. WHERE AUDITORS CONFLICTED — and the resolution

### Conflict 1 — Default visible row count in the admin cockpit (~5 vs ~8–10)
- **Lens 2 (Density):** the `Show 139 more` cap showing ~4–5 rows is "the single most important cognitive-load decision" and praised it.
- **Lens 4 (Ergonomics):** ~4–5 "feels too aggressive for an operator who wants throughput"; the cockpit can show more per page because the operator WANTS density; the client overview is where ~5 belongs.
- **Resolution:** **Lens 4 wins for the cockpit, Lens 2's instinct wins for the client.** They're not actually in conflict once you separate the surfaces — both agree ~5 is the *client* number. Set the **cockpit default to ~8–10 visible** (operator wants throughput) and the **client curated list to ~5** (engagement, never paginate). The real shared point both lenses make is that **`Show 139 more` itself is wrong** (M8) — replace it with sort + top-slice regardless of the exact N.

### Conflict 2 — One unified hybrid list vs. banding the cockpit into "To curate" / "In flight"
- **Lens 1 (IA):** keep lifecycle states as **visual strata within ONE list** (opacity ramp + nudge bands); the chips ARE the sectioning. Splitting into sections re-introduces sprawl.
- **Lens 4 (Ergonomics):** the cockpit mixes raw-system recs (Active) and client-lifecycle recs (Sent/Approved/Throttled) in one list, forcing constant mode-switching; **band it into two zones.**
- **Resolution:** **Reconcile via the lifecycle segmented control (M3), not a hard section split.** The single-select lifecycle segmented control already _is_ the "To curate vs In flight" mode switch — selecting `Active` shows the triage firehose; selecting `Sent`/`Approved`/`Throttled` shows the in-flight set. This gives Lens 4 its mode separation **without** Lens 1's feared stacked-sections sprawl (you're never looking at both modes at once in a single scroll). The `Fix now` pin (M1) stays cross-cutting above whichever lifecycle mode is active. **Do not** build a permanent visual divider that renders both zones simultaneously — that's the sprawl Lens 1 warns against. The segmented control is the divider.

### Conflict 3 — Progress bar vs. micro-status line (which finite-list signal)
- **Lens 5 (Visual):** "Re-introduce the segmented progress bar... it is the single best 'finite set, here's your part' device."
- **Lens 2 (Density):** "Pick ONE finite-list signal, not two... the progress bar is the stronger 5-second-grok device" — explicitly warns against shipping both (double status-encoding the client must decode).
- **Resolution:** **No real conflict — both favor the progress bar; Lens 2 adds the discipline.** Ship the **progress bar** as the primary finite signal AND reduce the micro-line to a **single emphasized `waiting on you` count** (S1 + S5). Don't ship the full 4-state micro-line alongside the bar — that's the redundancy Lens 2 flags. Bar = visual "how much is left"; one bold count = "your part."

### Conflict 4 — How much to front-load Layer-1 data above the recs
- **Lens 1 / Lens 3 (IA, Engagement):** the D6b stack `Briefing → Layer-1 → recs` is correct and grounds the asks; keeps the page substantial in quiet months; **restore the Briefing.**
- **Lens 2 (Density):** the same stack is "correct in principle but dangerous in execution" — three substantial blocks can bury the decision below the fold (its named biggest risk).
- **Resolution:** **Both are right; satisfy both with a vertical priority budget (S7).** Keep the D6b order and restore the Briefing (Lens 1/3), but **enforce the ~1.5-screen budget and ruthless hide-when-empty** (Lens 2) so the first decision always lands above the fold and quiet months shrink rather than pad. The Briefing returns as a **compressed one-to-two-line dated opener**, not the full multi-element story stacked at rest — that satisfies Lens 3's warmth requirement and Lens 2's density ceiling simultaneously. The disagreement is about execution discipline, not the IA — and the budget is the discipline.

### Conflict 5 — Is the design "close / refinement-only" or does it have a structural hole?
- **Lenses 1, 2, 3, 5** broadly call this "a strong foundation, refinements not a rebuild."
- **Lens 4** is the dissenter: the cockpit "optimizes the wrong unit of work" — a beautifully tuned per-row interaction bolted onto a list, when the job is a **batch** operation; without multi-select + bulk + sort it's a "click-tax every cycle."
- **Resolution:** **Lens 4's dissent is correct and must be honored — but it's still additive, not a rebuild.** The per-row model IS good; the missing batch/selection layer **sits on top of it** (M7, M8). "The polish hides the gap" is the key insight: every individual piece looks done, so the missing batch layer is easy to ship without. **Treat M7 (bulk ops) as a MUST-DO, not a refinement** — it's the one place "refinement-only" framing would let a real hole ship. Everywhere else, "refinement not rebuild" holds.

---

## 6. Build sequencing note (ties to the architecture spine)

These UX changes graft cleanly onto the **Design-A base + B/C grafts** in [RECOMMENDATION.md](./RECOMMENDATION.md):
- M4, M5 (brand-law fixes) and M3 (chip-axis split) are **near-free** and should land in the first cockpit/overview PR — they're trust-critical and pr-check-blocking.
- M10/M11/S7 (hero win, quiet-month state, vertical budget) belong in the **client `RecommendedThisMonth` / overview PR** (architecture Graft 4) — sub-split it, as that doc already cautions P5 is over-packed.
- M7/M8/S3 (bulk ops, sort, attention strip) are the **cockpit-ergonomics PR** — the highest-leverage admin work, and the one place to resist "refinement-only" framing.
- The hybrid anchor (M1) + counts (M2) are the **shared grouping primitive** — build the priority-pin + faceted-list component once, reuse on both surfaces and inside every interior tab (page-grouping point 4).

**Net UX verdict:** the design does NOT default to the "one massive list" Josh feared — both surfaces already carry real structure. The right model is unambiguous and consistent across surfaces: a **HYBRID** (capped, always-visible priority anchor over an impact-ranked, count-labeled, faceted list). The remaining work is concrete and mostly cheap: split the conflated chip axes, count every facet, fix two brand-law color slips, separate paid/free CTAs, promote the proof-win to a hero, design the quiet month as a real screen, and — the one place not to under-rate — add the batch/selection layer the operator's actual job demands. None of these are rebuilds. They are the difference between a list that *looks* grouped and a cockpit that genuinely *is*.
